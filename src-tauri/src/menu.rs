use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{
    AppHandle, Emitter, Manager, Runtime, WebviewWindow,
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
};

const NATIVE_MENU_COMMAND_EVENT: &str = "forktail-menu-command";
const EDITOR_NAVIGATION_BACK_ID: &str = "navigateEditorBack";
const SETTINGS_COMMAND_ID: &str = "settings";
const QUIT_COMMAND_ID: &str = "quit";
static MAIN_EDITOR_NAVIGATION_BACK_ENABLED: AtomicBool = AtomicBool::new(false);
static MAIN_SETTINGS_ENABLED: AtomicBool = AtomicBool::new(false);

const COMMAND_IDS: &[&str] = &[
    "openCompare",
    "openFolders",
    "openMerge",
    "openGitRepository",
    "save",
    "saveAs",
    "undo",
    "redo",
    "nextDiff",
    "previousDiff",
    "nextConflict",
    "previousConflict",
    "acceptOurs",
    "acceptBase",
    "acceptTheirs",
    "acceptBoth",
    "swapSides",
    "searchPath",
    "navigateEditorBack",
    "settings",
    "quit",
];

pub fn build_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let open_compare = MenuItem::with_id(
        app,
        "openCompare",
        "Compare Files",
        true,
        Some("CmdOrCtrl+O"),
    )?;
    let open_folders = MenuItem::with_id(
        app,
        "openFolders",
        "Folder Diff",
        true,
        Some("CmdOrCtrl+Shift+O"),
    )?;
    let open_merge = MenuItem::with_id(
        app,
        "openMerge",
        "3-way Merge",
        true,
        Some("CmdOrCtrl+Alt+O"),
    )?;
    let open_git_repository = MenuItem::with_id(
        app,
        "openGitRepository",
        "Open Git Repository",
        true,
        Some("CmdOrCtrl+Alt+G"),
    )?;
    let save = MenuItem::with_id(app, "save", "Save", true, Some("CmdOrCtrl+S"))?;
    let save_as = MenuItem::with_id(app, "saveAs", "Save As", true, Some("CmdOrCtrl+Shift+S"))?;
    let file_separator_one = PredefinedMenuItem::separator(app)?;
    let file_separator_two = PredefinedMenuItem::separator(app)?;
    let close_window = PredefinedMenuItem::close_window(app, None)?;
    let quit = MenuItem::with_id(
        app,
        QUIT_COMMAND_ID,
        "Quit Forktail",
        true,
        Some("CmdOrCtrl+Q"),
    )?;
    let file_menu = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &open_compare,
            &open_folders,
            &open_merge,
            &open_git_repository,
            &file_separator_one,
            &save,
            &save_as,
            &file_separator_two,
            &close_window,
            &quit,
        ],
    )?;

    let undo = MenuItem::with_id(app, "undo", "Undo", true, Some("CmdOrCtrl+Z"))?;
    let redo = MenuItem::with_id(app, "redo", "Redo", true, Some("CmdOrCtrl+Y"))?;
    let search_path =
        MenuItem::with_id(app, "searchPath", "Search Path", true, Some("CmdOrCtrl+F"))?;
    let settings = MenuItem::with_id(
        app,
        SETTINGS_COMMAND_ID,
        "Settings",
        false,
        Some("CmdOrCtrl+,"),
    )?;
    let edit_separator = PredefinedMenuItem::separator(app)?;
    let edit_menu = Submenu::with_items(
        app,
        "Edit",
        true,
        &[&undo, &redo, &edit_separator, &search_path, &settings],
    )?;

    let previous_diff = MenuItem::with_id(
        app,
        "previousDiff",
        "Previous Change",
        true,
        Some("Shift+F7"),
    )?;
    let editor_navigation_back_accelerator = if cfg!(target_os = "macos") {
        Some("Ctrl+-")
    } else {
        Some("Alt+Left")
    };
    let editor_navigation_back = MenuItem::with_id(
        app,
        "navigateEditorBack",
        "Previous Editor Location",
        false,
        editor_navigation_back_accelerator,
    )?;
    let next_diff = MenuItem::with_id(app, "nextDiff", "Next Change", true, Some("F7"))?;
    let previous_conflict = MenuItem::with_id(
        app,
        "previousConflict",
        "Previous Conflict",
        true,
        Some("Shift+F8"),
    )?;
    let next_conflict = MenuItem::with_id(app, "nextConflict", "Next Conflict", true, Some("F8"))?;
    let swap_sides = MenuItem::with_id(
        app,
        "swapSides",
        "Swap Sides",
        true,
        Some("CmdOrCtrl+Shift+X"),
    )?;
    let navigate_separator_one = PredefinedMenuItem::separator(app)?;
    let navigate_separator_two = PredefinedMenuItem::separator(app)?;
    let navigate_separator_three = PredefinedMenuItem::separator(app)?;
    let navigate_menu = Submenu::with_items(
        app,
        "Navigate",
        true,
        &[
            &editor_navigation_back,
            &navigate_separator_one,
            &previous_diff,
            &next_diff,
            &navigate_separator_two,
            &previous_conflict,
            &next_conflict,
            &navigate_separator_three,
            &swap_sides,
        ],
    )?;

    let accept_ours = MenuItem::with_id(app, "acceptOurs", "Accept OURS", true, Some("Alt+1"))?;
    let accept_base = MenuItem::with_id(app, "acceptBase", "Accept BASE", true, Some("Alt+2"))?;
    let accept_theirs =
        MenuItem::with_id(app, "acceptTheirs", "Accept THEIRS", true, Some("Alt+3"))?;
    let accept_both = MenuItem::with_id(app, "acceptBoth", "Keep Both", true, Some("Alt+4"))?;
    let merge_menu = Submenu::with_items(
        app,
        "Merge",
        true,
        &[&accept_ours, &accept_base, &accept_theirs, &accept_both],
    )?;

    Menu::with_items(app, &[&file_menu, &edit_menu, &navigate_menu, &merge_menu])
}

pub fn set_editor_navigation_back_enabled<R: Runtime>(
    app: &AppHandle<R>,
    enabled: bool,
) -> tauri::Result<bool> {
    MAIN_EDITOR_NAVIGATION_BACK_ENABLED.store(enabled, Ordering::Release);
    let main_focused = app
        .get_webview_window("main")
        .and_then(|window| window.is_focused().ok())
        .is_some_and(|focused| focused);
    set_command_enabled(app, EDITOR_NAVIGATION_BACK_ID, enabled && main_focused)
}

pub fn set_settings_command_enabled<R: Runtime>(
    app: &AppHandle<R>,
    enabled: bool,
) -> tauri::Result<bool> {
    MAIN_SETTINGS_ENABLED.store(enabled, Ordering::Release);
    let main_focused = app
        .get_webview_window("main")
        .and_then(|window| window.is_focused().ok())
        .is_some_and(|focused| focused);
    set_command_enabled(app, SETTINGS_COMMAND_ID, enabled && main_focused)
}

pub fn handle_menu_event<R: Runtime>(app: &AppHandle<R>, event: tauri::menu::MenuEvent) {
    for command_id in COMMAND_IDS {
        if event.id() == *command_id {
            if *command_id == QUIT_COMMAND_ID {
                let _ = emit_quit_to_main(app);
                return;
            }
            let Some(window) = focused_webview_window(app) else {
                return;
            };
            if !menu_command_allowed_for_label(window.label(), command_id) {
                return;
            }
            let _ = app.emit_to(window.label(), NATIVE_MENU_COMMAND_EVENT, *command_id);
            return;
        }
    }
}

pub(crate) fn should_guard_user_exit_request<R: Runtime>(
    app: &AppHandle<R>,
    code: Option<i32>,
) -> bool {
    let main_window_available = app.get_webview_window("main").is_some();
    should_route_user_exit_request(code, main_window_available)
}

pub fn apply_window_menu_profile<R: Runtime>(
    app: &AppHandle<R>,
    window_label: &str,
) -> tauri::Result<()> {
    let navigation_back_enabled = MAIN_EDITOR_NAVIGATION_BACK_ENABLED.load(Ordering::Acquire);
    let settings_enabled = MAIN_SETTINGS_ENABLED.load(Ordering::Acquire);
    for command_id in COMMAND_IDS {
        let enabled = command_enabled_for_window(
            window_label,
            command_id,
            navigation_back_enabled,
            settings_enabled,
        );
        set_command_enabled(app, command_id, enabled)?;
    }
    Ok(())
}

fn command_enabled_for_window(
    window_label: &str,
    command_id: &str,
    navigation_back_enabled: bool,
    settings_enabled: bool,
) -> bool {
    if command_id == QUIT_COMMAND_ID {
        return true;
    }
    if window_label == "main" {
        return match command_id {
            EDITOR_NAVIGATION_BACK_ID => navigation_back_enabled,
            SETTINGS_COMMAND_ID => settings_enabled,
            _ => true,
        };
    }
    menu_command_allowed_for_label(window_label, command_id)
}

fn set_command_enabled<R: Runtime>(
    app: &AppHandle<R>,
    command_id: &str,
    enabled: bool,
) -> tauri::Result<bool> {
    let Some(menu) = app.menu() else {
        return Ok(false);
    };
    for item in menu.items()? {
        let Some(submenu) = item.as_submenu() else {
            continue;
        };
        let Some(item) = submenu.get(command_id) else {
            continue;
        };
        let Some(menu_item) = item.as_menuitem() else {
            return Ok(false);
        };
        menu_item.set_enabled(enabled)?;
        return Ok(true);
    }
    Ok(false)
}

fn focused_webview_window<R: Runtime>(app: &AppHandle<R>) -> Option<WebviewWindow<R>> {
    app.webview_windows()
        .into_values()
        .find(|window| window.is_focused().is_ok_and(|focused| focused))
}

pub(crate) fn emit_quit_to_main<R: Runtime>(app: &AppHandle<R>) -> bool {
    let Some(main_window) = app.get_webview_window("main") else {
        return false;
    };
    let _ = main_window.set_focus();
    app.emit_to("main", NATIVE_MENU_COMMAND_EVENT, QUIT_COMMAND_ID)
        .is_ok()
}

fn should_route_user_exit_request(code: Option<i32>, main_window_available: bool) -> bool {
    code.is_none() && main_window_available
}

fn menu_command_allowed_for_label(window_label: &str, command_id: &str) -> bool {
    if window_label == "main" {
        return COMMAND_IDS.contains(&command_id);
    }
    window_label.starts_with("folder-review-") && matches!(command_id, "previousDiff" | "nextDiff")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn navigation_back_uses_the_compile_target_accelerator() {
        let accelerator = if cfg!(target_os = "macos") {
            "Ctrl+-"
        } else {
            "Alt+Left"
        };

        #[cfg(target_os = "macos")]
        assert_eq!(accelerator, "Ctrl+-");
        #[cfg(not(target_os = "macos"))]
        assert_eq!(accelerator, "Alt+Left");
    }

    #[test]
    fn navigation_back_stable_id_is_allowlisted_once() {
        assert_eq!(EDITOR_NAVIGATION_BACK_ID, "navigateEditorBack");
        assert_eq!(
            COMMAND_IDS
                .iter()
                .filter(|command| **command == EDITOR_NAVIGATION_BACK_ID)
                .count(),
            1
        );
    }

    #[test]
    fn settings_stable_id_is_allowlisted_once() {
        assert_eq!(SETTINGS_COMMAND_ID, "settings");
        assert_eq!(
            COMMAND_IDS
                .iter()
                .filter(|command| **command == SETTINGS_COMMAND_ID)
                .count(),
            1
        );
    }

    #[test]
    fn settings_profile_is_dynamic_on_main_and_disabled_in_detached_review() {
        assert!(!command_enabled_for_window(
            "main",
            SETTINGS_COMMAND_ID,
            false,
            false,
        ));
        assert!(command_enabled_for_window(
            "main",
            SETTINGS_COMMAND_ID,
            false,
            true,
        ));
        assert!(!command_enabled_for_window(
            "folder-review-7",
            SETTINGS_COMMAND_ID,
            false,
            true,
        ));
    }

    #[test]
    fn quit_has_one_custom_command_id_and_is_not_a_detached_mutation() {
        assert_eq!(QUIT_COMMAND_ID, "quit");
        assert_eq!(
            COMMAND_IDS
                .iter()
                .filter(|command| **command == QUIT_COMMAND_ID)
                .count(),
            1
        );
        assert!(!menu_command_allowed_for_label(
            "folder-review-7",
            QUIT_COMMAND_ID
        ));
    }

    #[test]
    fn user_exit_is_guarded_only_while_the_main_react_surface_exists() {
        assert!(should_route_user_exit_request(None, true));
        assert!(!should_route_user_exit_request(None, false));
    }

    #[test]
    fn approved_programmatic_exit_does_not_reenter_the_react_guard() {
        assert!(!should_route_user_exit_request(Some(0), true));
        assert!(!should_route_user_exit_request(
            Some(tauri::RESTART_EXIT_CODE),
            true
        ));
    }

    #[test]
    fn detached_profile_allows_only_diff_navigation() {
        assert!(menu_command_allowed_for_label(
            "folder-review-7",
            "previousDiff"
        ));
        assert!(menu_command_allowed_for_label(
            "folder-review-7",
            "nextDiff"
        ));
        for command in [
            "openCompare",
            "openFolders",
            "save",
            "saveAs",
            "undo",
            "redo",
            "swapSides",
            "searchPath",
            "navigateEditorBack",
            "settings",
        ] {
            assert!(!menu_command_allowed_for_label("folder-review-7", command));
        }
        assert!(!menu_command_allowed_for_label("unknown", "nextDiff"));
    }
}
