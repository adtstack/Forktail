use crate::commands::files::{
    FolderReviewObservedVersions, read_validated_folder_review_text_pair,
    validate_folder_review_text_pair,
};
use crate::detached_review::{
    DetachedReviewLoadPermit, DetachedReviewRegistry, DetachedReviewSideVersion,
    DetachedReviewVersionPair,
};
use crate::domain::models::{
    DetachedFolderReviewLoaded, DetachedFolderReviewOpenResult, DetachedFolderReviewVersionCheck,
    InvalidateDetachedFolderReviewSource, OpenDetachedFolderReviewRequest,
};
use crate::error::{AppErrorCode, CommandError, CommandResult};
use std::sync::atomic::AtomicBool;
use tauri::{
    AppHandle, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    webview::NewWindowResponse,
};

pub(crate) const DETACHED_FOLDER_REVIEW_ROUTE: &str = "index.html?surface=folder-review";

#[tauri::command]
pub async fn open_detached_folder_review(
    request: OpenDetachedFolderReviewRequest,
    caller: WebviewWindow,
    app: AppHandle,
    registry: State<'_, DetachedReviewRegistry>,
) -> CommandResult<DetachedFolderReviewOpenResult> {
    if caller.label() != "main" {
        return Err(unknown_main_caller_error());
    }
    let registry = registry.inner().clone();
    open_or_focus(&app, &registry, request).await
}

async fn open_or_focus(
    app: &AppHandle,
    registry: &DetachedReviewRegistry,
    request: OpenDetachedFolderReviewRequest,
) -> CommandResult<DetachedFolderReviewOpenResult> {
    let mut reservation = registry.reserve_open("main", request.clone())?;
    if !reservation.is_new() {
        let label = reservation.window_label().to_string();
        if app.get_webview_window(&label).is_none() {
            let wait_registry = registry.clone();
            let wait_label = label.clone();
            let created = tauri::async_runtime::spawn_blocking(move || {
                wait_registry.wait_until_window_created(&wait_label)
            })
            .await
            .map_err(|_| window_create_error())?;
            if !created {
                registry.destroy(&label);
                reservation = registry.reserve_open("main", request)?;
            }
        }
    }

    if !reservation.is_new() {
        let label = reservation.window_label().to_string();
        let window = app.get_webview_window(&label).ok_or_else(|| {
            registry.destroy(&label);
            window_create_error()
        })?;
        focus_window(&window)?;
        return Ok(DetachedFolderReviewOpenResult::Focused {
            window_label: label,
        });
    }

    let label = reservation.window_label().to_string();
    let title = registry.window_title(&reservation)?;
    let configured_dev_url = configured_dev_url(app);
    let build_result = WebviewWindowBuilder::new(
        app,
        &label,
        WebviewUrl::App(DETACHED_FOLDER_REVIEW_ROUTE.into()),
    )
    .title(title)
    .inner_size(1180.0, 760.0)
    .min_inner_size(760.0, 480.0)
    .visible(true)
    .focused(true)
    .on_navigation(move |url| detached_navigation_allowed(url, configured_dev_url.as_ref()))
    .on_new_window(|_, _| NewWindowResponse::Deny)
    .build();

    let window = match build_result {
        Ok(window) => window,
        Err(_) => {
            registry.rollback_creation(&reservation);
            return Err(window_create_error());
        }
    };
    if let Err(error) = registry.mark_window_created(&reservation) {
        let _ = window.close();
        registry.destroy(&label);
        return Err(error);
    }

    Ok(DetachedFolderReviewOpenResult::Created {
        window_label: label,
    })
}

#[tauri::command]
pub fn invalidate_detached_folder_review_source(
    request: InvalidateDetachedFolderReviewSource,
    caller: WebviewWindow,
    registry: State<'_, DetachedReviewRegistry>,
) -> CommandResult<()> {
    if caller.label() != "main" {
        return Err(unknown_main_caller_error());
    }
    registry.invalidate_source(
        caller.label(),
        &request.source_review_token,
        request.scan_generation,
    );
    Ok(())
}

#[tauri::command]
pub async fn load_detached_folder_review(
    caller: WebviewWindow,
    registry: State<'_, DetachedReviewRegistry>,
) -> CommandResult<DetachedFolderReviewLoaded> {
    let registry = registry.inner().clone();
    let permit = registry.begin_initial_load(caller.label())?;
    perform_load(registry, permit).await
}

#[tauri::command]
pub async fn reload_detached_folder_review(
    caller: WebviewWindow,
    registry: State<'_, DetachedReviewRegistry>,
) -> CommandResult<DetachedFolderReviewLoaded> {
    let registry = registry.inner().clone();
    let permit = registry.begin_reload(caller.label())?;
    perform_load(registry, permit).await
}

async fn perform_load(
    registry: DetachedReviewRegistry,
    permit: DetachedReviewLoadPermit,
) -> CommandResult<DetachedFolderReviewLoaded> {
    tauri::async_runtime::spawn_blocking(move || {
        let result = (|| {
            let validated =
                validate_folder_review_text_pair(&permit.pair_request, &permit.cancelled)?;
            let source_bytes = validated.source_bytes()?;
            let versions = version_pair(validated.observed_versions());
            registry.reserve_source_bytes(&permit, source_bytes)?;
            let pair = read_validated_folder_review_text_pair(validated, &permit.cancelled)?;
            registry.finish_load(&permit, source_bytes, versions)?;
            Ok(DetachedFolderReviewLoaded {
                context: permit.context.clone(),
                left: pair.left,
                right: pair.right,
                model_identity: permit.model_identity.clone(),
            })
        })();
        if result.is_err() {
            registry.fail_load(&permit);
        }
        result
    })
    .await
    .map_err(|_| {
        CommandError::new(
            AppErrorCode::ScanFailed,
            "별도 비교 창의 파일 읽기 worker를 완료하지 못했습니다.",
        )
    })?
}

#[tauri::command]
pub async fn check_detached_folder_review_versions(
    caller: WebviewWindow,
    registry: State<'_, DetachedReviewRegistry>,
) -> CommandResult<DetachedFolderReviewVersionCheck> {
    let registry = registry.inner().clone();
    let label = caller.label().to_string();
    tauri::async_runtime::spawn_blocking(move || {
        let (request, baseline) = registry.ready_versions(&label)?;
        let cancelled = AtomicBool::new(false);
        let validated = validate_folder_review_text_pair(&request, &cancelled)?;
        let current = version_pair(validated.observed_versions());
        let left_changed = current.left != baseline.left;
        let right_changed = current.right != baseline.right;
        Ok(DetachedFolderReviewVersionCheck {
            left_changed,
            right_changed,
            version_key: format!(
                "left:{}|right:{}",
                if left_changed { "changed" } else { "same" },
                if right_changed { "changed" } else { "same" },
            ),
        })
    })
    .await
    .map_err(|_| {
        CommandError::new(
            AppErrorCode::ScanFailed,
            "별도 비교 창의 파일 상태 확인 worker를 완료하지 못했습니다.",
        )
    })?
}

fn version_pair(observed: FolderReviewObservedVersions) -> DetachedReviewVersionPair {
    DetachedReviewVersionPair {
        left: side_version(observed.left),
        right: side_version(observed.right),
    }
}

fn side_version(observed: Option<(u64, Option<u64>)>) -> DetachedReviewSideVersion {
    match observed {
        Some((size, modified_ms)) => DetachedReviewSideVersion::Regular { size, modified_ms },
        None => DetachedReviewSideVersion::Missing,
    }
}

fn focus_window(window: &WebviewWindow) -> CommandResult<()> {
    window.unminimize().map_err(|_| window_create_error())?;
    window.show().map_err(|_| window_create_error())?;
    window.set_focus().map_err(|_| window_create_error())
}

fn detached_navigation_allowed(url: &tauri::Url, configured_dev_url: Option<&tauri::Url>) -> bool {
    if url.path() != "/index.html"
        || url.query() != Some("surface=folder-review")
        || url.fragment().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return false;
    }

    if is_packaged_app_origin(url) {
        return true;
    }

    configured_dev_url.is_some_and(|dev_url| same_origin(url, dev_url))
}

fn is_packaged_app_origin(url: &tauri::Url) -> bool {
    matches!(
        (url.scheme(), url.host_str(), url.port()),
        ("tauri", Some("localhost"), None) | ("http" | "https", Some("tauri.localhost"), None)
    )
}

fn same_origin(url: &tauri::Url, expected: &tauri::Url) -> bool {
    url.scheme() == expected.scheme()
        && url.host_str() == expected.host_str()
        && url.port_or_known_default() == expected.port_or_known_default()
}

fn configured_dev_url(app: &AppHandle) -> Option<tauri::Url> {
    #[cfg(dev)]
    {
        app.config().build.dev_url.clone()
    }
    #[cfg(not(dev))]
    {
        let _ = app;
        None
    }
}

fn unknown_main_caller_error() -> CommandError {
    CommandError::new(
        AppErrorCode::DetachedUnknownWindow,
        "새 비교 창은 폴더 비교 화면에서만 열 수 있습니다.",
    )
}

fn window_create_error() -> CommandError {
    CommandError::new(
        AppErrorCode::DetachedWindowCreateFailed,
        "새 비교 창을 열거나 앞으로 가져오지 못했습니다. 다시 시도하세요.",
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn child_route_and_label_inputs_are_path_free_constants() {
        assert_eq!(
            DETACHED_FOLDER_REVIEW_ROUTE,
            "index.html?surface=folder-review"
        );
        assert!(!DETACHED_FOLDER_REVIEW_ROUTE.contains("root"));
        assert!(!DETACHED_FOLDER_REVIEW_ROUTE.contains("token"));
        assert!(!DETACHED_FOLDER_REVIEW_ROUTE.contains("path="));
    }

    #[test]
    fn navigation_allows_only_the_exact_packaged_surface_route() {
        for allowed in [
            "tauri://localhost/index.html?surface=folder-review",
            "http://tauri.localhost/index.html?surface=folder-review",
            "https://tauri.localhost/index.html?surface=folder-review",
        ] {
            let url = tauri::Url::parse(allowed).expect("parse packaged app URL");
            assert!(
                detached_navigation_allowed(&url, None),
                "expected packaged route to be allowed: {allowed}"
            );
        }

        for rejected in [
            "tauri://localhost/",
            "tauri://localhost/index.html",
            "tauri://localhost/index.html?surface=main",
            "tauri://localhost/index.html?surface=folder-review&path=/private/file",
            "tauri://localhost/index.html?surface=folder-review&extra=true",
            "tauri://localhost/index.html?surface=folder-review#main",
            "tauri://localhost/nested/index.html?surface=folder-review",
            "tauri://localhost/index.html/?surface=folder-review",
            "http://tauri.localhost:1420/index.html?surface=folder-review",
            "https://tauri.localhost.example/index.html?surface=folder-review",
            "https://example.com/index.html?surface=folder-review",
        ] {
            let url = tauri::Url::parse(rejected).expect("parse rejected URL");
            assert!(
                !detached_navigation_allowed(&url, None),
                "expected route to be rejected: {rejected}"
            );
        }
    }

    #[test]
    fn navigation_allows_only_the_configured_dev_surface_route() {
        let allowed = tauri::Url::parse("http://localhost:1420/index.html?surface=folder-review")
            .expect("parse configured dev URL");
        let configured_dev_url =
            tauri::Url::parse("http://localhost:1420").expect("parse configured dev origin");
        assert!(detached_navigation_allowed(
            &allowed,
            Some(&configured_dev_url)
        ));

        for rejected in [
            "http://localhost:1420/",
            "http://localhost:1420/index.html",
            "http://localhost:1420/index.html?surface=folder-review&extra=true",
            "http://localhost:1420/index.html?surface=folder-review#detached",
            "http://localhost:1421/index.html?surface=folder-review",
            "http://127.0.0.1:1420/index.html?surface=folder-review",
            "https://localhost:1420/index.html?surface=folder-review",
        ] {
            let url = tauri::Url::parse(rejected).expect("parse rejected dev URL");
            assert!(
                !detached_navigation_allowed(&url, Some(&configured_dev_url)),
                "expected dev route to be rejected: {rejected}"
            );
        }

        assert!(!detached_navigation_allowed(&allowed, None));
    }
}
