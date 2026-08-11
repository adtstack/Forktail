use crate::domain::models::{
    DetachedFolderReviewContext, FolderReviewSideExpectation, FolderReviewTextPairRequest,
    OpenDetachedFolderReviewRequest,
};
use crate::error::{AppErrorCode, CommandError, CommandResult};
use std::collections::HashMap;
use std::sync::{Arc, Condvar, Mutex, MutexGuard, atomic::AtomicBool};
use std::time::{Duration, Instant};

pub const MAX_DETACHED_REVIEW_WINDOWS: usize = 8;
pub const MAX_DETACHED_REVIEW_SOURCE_BYTES: u64 = 256 * 1024 * 1024;
const MAX_SOURCE_REVIEW_TOKEN_BYTES: usize = 256;

#[derive(Debug, Clone, Hash, PartialEq, Eq)]
struct DetachedReviewIdentity {
    owner_label: String,
    source_review_token: String,
    scan_generation: u64,
    relative_path: String,
    left_expected: FolderReviewSideExpectation,
    right_expected: FolderReviewSideExpectation,
}

#[derive(Debug, Clone)]
struct DetachedReviewDescriptor {
    identity: DetachedReviewIdentity,
    left_root: String,
    right_root: String,
}

impl DetachedReviewDescriptor {
    fn from_open_request(
        owner_label: &str,
        request: OpenDetachedFolderReviewRequest,
    ) -> CommandResult<Self> {
        if owner_label != "main" {
            return Err(unknown_caller_error());
        }
        if request.source_review_token.is_empty()
            || request.source_review_token.len() > MAX_SOURCE_REVIEW_TOKEN_BYTES
            || request.source_review_token.chars().any(char::is_control)
            || request.scan_generation == 0
        {
            return Err(CommandError::new(
                AppErrorCode::DetachedSourceStale,
                "폴더 검토 기준이 더 이상 유효하지 않습니다. 폴더를 다시 비교하세요.",
            ));
        }
        if request.left_root.is_empty()
            || request.right_root.is_empty()
            || !is_safe_relative_path(&request.relative_path)
            || (request.left_expected == FolderReviewSideExpectation::Missing
                && request.right_expected == FolderReviewSideExpectation::Missing)
        {
            return Err(CommandError::new(
                AppErrorCode::PathConflict,
                "새 창에서 열 폴더 검토 항목의 경로가 안전하지 않습니다.",
            ));
        }

        Ok(Self {
            identity: DetachedReviewIdentity {
                owner_label: owner_label.to_string(),
                source_review_token: request.source_review_token,
                scan_generation: request.scan_generation,
                relative_path: request.relative_path,
                left_expected: request.left_expected,
                right_expected: request.right_expected,
            },
            left_root: request.left_root,
            right_root: request.right_root,
        })
    }

    fn pair_request(&self) -> FolderReviewTextPairRequest {
        FolderReviewTextPairRequest {
            left_root: self.left_root.clone(),
            right_root: self.right_root.clone(),
            relative_path: self.identity.relative_path.clone(),
            left_expected: self.identity.left_expected,
            right_expected: self.identity.right_expected,
        }
    }

    fn context(&self) -> DetachedFolderReviewContext {
        let normalized = self.identity.relative_path.replace('\\', "/");
        let mut segments = normalized.split('/').collect::<Vec<_>>();
        let file_name = match segments.pop() {
            Some(value) => value.to_string(),
            None => "file".to_string(),
        };
        DetachedFolderReviewContext {
            file_name,
            parent_relative_path: segments.join("/"),
            relative_path: normalized,
            left_root: self.left_root.clone(),
            right_root: self.right_root.clone(),
            left_missing: self.identity.left_expected == FolderReviewSideExpectation::Missing,
            right_missing: self.identity.right_expected == FolderReviewSideExpectation::Missing,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DetachedReviewPhase {
    Creating,
    Loading,
    Ready,
    Error,
    Closing,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum DetachedReviewSideVersion {
    Regular { size: u64, modified_ms: Option<u64> },
    Missing,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DetachedReviewVersionPair {
    pub(crate) left: DetachedReviewSideVersion,
    pub(crate) right: DetachedReviewSideVersion,
}

#[derive(Debug)]
struct DetachedReviewSession {
    session_id: u64,
    window_label: String,
    descriptor: DetachedReviewDescriptor,
    phase: DetachedReviewPhase,
    operation_revision: u64,
    active_cancel: Arc<AtomicBool>,
    delivered_versions: Option<DetachedReviewVersionPair>,
    retained_source_bytes: u64,
    accounted_source_bytes: u64,
    stale: bool,
    window_created: bool,
}

#[derive(Debug, Default)]
struct RegistryInner {
    by_identity: HashMap<DetachedReviewIdentity, u64>,
    by_label: HashMap<String, u64>,
    sessions: HashMap<u64, DetachedReviewSession>,
    next_session_id: u64,
    accounted_source_bytes: u64,
}

#[derive(Debug)]
struct RegistryShared {
    inner: Mutex<RegistryInner>,
    creation_changed: Condvar,
}

#[derive(Debug, Clone)]
pub(crate) struct DetachedReviewRegistry {
    shared: Arc<RegistryShared>,
    max_windows: usize,
    max_source_bytes: u64,
}

impl Default for DetachedReviewRegistry {
    fn default() -> Self {
        Self::with_limits(
            MAX_DETACHED_REVIEW_WINDOWS,
            MAX_DETACHED_REVIEW_SOURCE_BYTES,
        )
    }
}

#[derive(Debug, Clone)]
pub(crate) struct OpenReservation {
    session_id: u64,
    window_label: String,
    new: bool,
}

impl OpenReservation {
    pub(crate) fn window_label(&self) -> &str {
        &self.window_label
    }

    pub(crate) fn is_new(&self) -> bool {
        self.new
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LoadKind {
    Initial,
    Reload,
}

#[derive(Debug, Clone)]
pub(crate) struct DetachedReviewLoadPermit {
    session_id: u64,
    operation_revision: u64,
    kind: LoadKind,
    pub(crate) pair_request: FolderReviewTextPairRequest,
    pub(crate) context: DetachedFolderReviewContext,
    pub(crate) model_identity: String,
    pub(crate) cancelled: Arc<AtomicBool>,
}

#[cfg(test)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct DetachedReviewRegistrySnapshot {
    pub(crate) active_count: usize,
    pub(crate) retained_source_bytes: u64,
}

impl DetachedReviewRegistry {
    pub(crate) fn with_limits(max_windows: usize, max_source_bytes: u64) -> Self {
        Self {
            shared: Arc::new(RegistryShared {
                inner: Mutex::new(RegistryInner::default()),
                creation_changed: Condvar::new(),
            }),
            max_windows,
            max_source_bytes,
        }
    }

    #[cfg(test)]
    fn with_next_session_id_for_test(next_session_id: u64) -> Self {
        let registry = Self::default();
        registry.lock_inner().next_session_id = next_session_id;
        registry
    }

    pub(crate) fn reserve_open(
        &self,
        owner_label: &str,
        request: OpenDetachedFolderReviewRequest,
    ) -> CommandResult<OpenReservation> {
        let descriptor = DetachedReviewDescriptor::from_open_request(owner_label, request)?;
        let mut inner = self.lock_inner();

        if let Some(session_id) = inner.by_identity.get(&descriptor.identity).copied() {
            let session = inner
                .sessions
                .get(&session_id)
                .ok_or_else(registry_state_error)?;
            return Ok(OpenReservation {
                session_id,
                window_label: session.window_label.clone(),
                new: false,
            });
        }
        if inner.sessions.len() >= self.max_windows {
            return Err(CommandError::new(
                AppErrorCode::DetachedWindowLimit,
                format!(
                    "별도 비교 창은 최대 {}개까지 열 수 있습니다. 창을 닫은 뒤 다시 시도하세요.",
                    self.max_windows
                ),
            ));
        }

        let session_id = inner.next_session_id.checked_add(1).ok_or_else(|| {
            CommandError::new(
                AppErrorCode::DetachedWindowCreateFailed,
                "새 비교 창 식별자를 만들 수 없습니다. 앱을 다시 시작한 뒤 시도하세요.",
            )
        })?;
        let window_label = format!("folder-review-{session_id}");
        if inner.by_label.contains_key(&window_label) {
            return Err(registry_state_error());
        }
        inner.next_session_id = session_id;
        inner
            .by_identity
            .insert(descriptor.identity.clone(), session_id);
        inner.by_label.insert(window_label.clone(), session_id);
        inner.sessions.insert(
            session_id,
            DetachedReviewSession {
                session_id,
                window_label: window_label.clone(),
                descriptor,
                phase: DetachedReviewPhase::Creating,
                operation_revision: 0,
                active_cancel: Arc::new(AtomicBool::new(false)),
                delivered_versions: None,
                retained_source_bytes: 0,
                accounted_source_bytes: 0,
                stale: false,
                window_created: false,
            },
        );

        Ok(OpenReservation {
            session_id,
            window_label,
            new: true,
        })
    }

    pub(crate) fn window_title(&self, reservation: &OpenReservation) -> CommandResult<String> {
        let inner = self.lock_inner();
        let session = inner
            .sessions
            .get(&reservation.session_id)
            .filter(|session| session.window_label == reservation.window_label)
            .ok_or_else(unknown_caller_error)?;
        Ok(detached_window_title(&session.descriptor.context()))
    }

    pub(crate) fn mark_window_created(&self, reservation: &OpenReservation) -> CommandResult<()> {
        let mut inner = self.lock_inner();
        let session = inner
            .sessions
            .get_mut(&reservation.session_id)
            .filter(|session| session.window_label == reservation.window_label && !session.stale)
            .ok_or_else(|| {
                CommandError::new(
                    AppErrorCode::DetachedSourceStale,
                    "폴더 비교가 갱신되어 새 창 열기를 중단했습니다.",
                )
            })?;
        session.window_created = true;
        self.shared.creation_changed.notify_all();
        Ok(())
    }

    pub(crate) fn rollback_creation(&self, reservation: &OpenReservation) {
        let mut inner = self.lock_inner();
        let remove = inner
            .sessions
            .get(&reservation.session_id)
            .is_some_and(|session| {
                session.window_label == reservation.window_label
                    && session.phase == DetachedReviewPhase::Creating
                    && !session.window_created
            });
        if remove {
            remove_session(&mut inner, reservation.session_id);
        }
        self.shared.creation_changed.notify_all();
    }

    pub(crate) fn wait_until_window_created(&self, window_label: &str) -> bool {
        let mut inner = self.lock_inner();
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            let Some(session_id) = inner.by_label.get(window_label).copied() else {
                return false;
            };
            let Some(session) = inner.sessions.get(&session_id) else {
                return false;
            };
            if session.window_created {
                return true;
            }
            if session.stale || session.phase == DetachedReviewPhase::Closing {
                return false;
            }
            let Some(remaining) = deadline.checked_duration_since(Instant::now()) else {
                return false;
            };
            let (next_inner, timed_out) =
                match self.shared.creation_changed.wait_timeout(inner, remaining) {
                    Ok((guard, timeout)) => (guard, timeout.timed_out()),
                    Err(poisoned) => {
                        let (guard, timeout) = poisoned.into_inner();
                        (guard, timeout.timed_out())
                    }
                };
            inner = next_inner;
            if timed_out {
                return false;
            }
        }
    }

    pub(crate) fn begin_initial_load(
        &self,
        window_label: &str,
    ) -> CommandResult<DetachedReviewLoadPermit> {
        self.begin_load(window_label, LoadKind::Initial)
    }

    pub(crate) fn begin_reload(
        &self,
        window_label: &str,
    ) -> CommandResult<DetachedReviewLoadPermit> {
        self.begin_load(window_label, LoadKind::Reload)
    }

    fn begin_load(
        &self,
        window_label: &str,
        kind: LoadKind,
    ) -> CommandResult<DetachedReviewLoadPermit> {
        let mut inner = self.lock_inner();
        let session_id = inner
            .by_label
            .get(window_label)
            .copied()
            .ok_or_else(unknown_caller_error)?;
        let session = inner
            .sessions
            .get_mut(&session_id)
            .ok_or_else(registry_state_error)?;
        if session.stale {
            return Err(CommandError::new(
                AppErrorCode::DetachedSourceStale,
                "원본 폴더 비교가 갱신되었습니다. 이 창을 닫고 다시 여세요.",
            ));
        }
        let allowed = match kind {
            LoadKind::Initial => {
                matches!(
                    session.phase,
                    DetachedReviewPhase::Creating | DetachedReviewPhase::Error
                ) && session.delivered_versions.is_none()
            }
            LoadKind::Reload => session.phase == DetachedReviewPhase::Ready,
        };
        if !allowed {
            return Err(CommandError::new(
                AppErrorCode::DetachedInvalidState,
                "현재 창 상태에서는 이 읽기 작업을 시작할 수 없습니다.",
            ));
        }
        session.operation_revision =
            session.operation_revision.checked_add(1).ok_or_else(|| {
                CommandError::new(
                    AppErrorCode::DetachedInvalidState,
                    "비교 창 작업 번호를 더 이상 만들 수 없습니다. 창을 닫고 다시 여세요.",
                )
            })?;
        session.phase = DetachedReviewPhase::Loading;
        session.active_cancel = Arc::new(AtomicBool::new(false));

        Ok(DetachedReviewLoadPermit {
            session_id,
            operation_revision: session.operation_revision,
            kind,
            pair_request: session.descriptor.pair_request(),
            context: session.descriptor.context(),
            model_identity: format!("detached-model-{}", session.session_id),
            cancelled: Arc::clone(&session.active_cancel),
        })
    }

    pub(crate) fn reserve_source_bytes(
        &self,
        permit: &DetachedReviewLoadPermit,
        source_bytes: u64,
    ) -> CommandResult<()> {
        let mut inner = self.lock_inner();
        let (retained_source_bytes, accounted_source_bytes) = {
            let session = active_load_session_mut(&mut inner, permit)?;
            (
                session.retained_source_bytes,
                session.accounted_source_bytes,
            )
        };
        let desired_accounted = retained_source_bytes.max(source_bytes);
        let without_session = inner
            .accounted_source_bytes
            .checked_sub(accounted_source_bytes)
            .ok_or_else(registry_state_error)?;
        let next_total = without_session
            .checked_add(desired_accounted)
            .ok_or_else(source_budget_error)?;
        if next_total > self.max_source_bytes {
            return Err(source_budget_error());
        }
        let session = active_load_session_mut(&mut inner, permit)?;
        session.accounted_source_bytes = desired_accounted;
        inner.accounted_source_bytes = next_total;
        Ok(())
    }

    pub(crate) fn finish_load(
        &self,
        permit: &DetachedReviewLoadPermit,
        source_bytes: u64,
        versions: DetachedReviewVersionPair,
    ) -> CommandResult<()> {
        let mut inner = self.lock_inner();
        let (stale, accounted_source_bytes) = {
            let session = active_load_session_mut(&mut inner, permit)?;
            (session.stale, session.accounted_source_bytes)
        };
        if stale {
            return Err(CommandError::new(
                AppErrorCode::DetachedSourceStale,
                "폴더 비교가 갱신되어 이전 파일 읽기 결과를 표시하지 않았습니다.",
            ));
        }
        let without_session = inner
            .accounted_source_bytes
            .checked_sub(accounted_source_bytes)
            .ok_or_else(registry_state_error)?;
        let next_total = without_session
            .checked_add(source_bytes)
            .ok_or_else(source_budget_error)?;
        if next_total > self.max_source_bytes {
            return Err(source_budget_error());
        }
        let session = active_load_session_mut(&mut inner, permit)?;
        session.retained_source_bytes = source_bytes;
        session.accounted_source_bytes = source_bytes;
        session.delivered_versions = Some(versions);
        session.phase = DetachedReviewPhase::Ready;
        inner.accounted_source_bytes = next_total;
        Ok(())
    }

    pub(crate) fn fail_load(&self, permit: &DetachedReviewLoadPermit) {
        let mut inner = self.lock_inner();
        let current_total = inner.accounted_source_bytes;
        let accounting = {
            let Some(session) = inner.sessions.get_mut(&permit.session_id) else {
                return;
            };
            if session.operation_revision != permit.operation_revision
                || session.phase != DetachedReviewPhase::Loading
            {
                return;
            }
            let accounting = (
                session.accounted_source_bytes,
                session.retained_source_bytes,
            );
            session.accounted_source_bytes = session.retained_source_bytes;
            session.phase =
                if permit.kind == LoadKind::Reload && session.delivered_versions.is_some() {
                    DetachedReviewPhase::Ready
                } else {
                    DetachedReviewPhase::Error
                };
            accounting
        };
        inner.accounted_source_bytes = current_total
            .saturating_sub(accounting.0)
            .saturating_add(accounting.1);
    }

    pub(crate) fn ready_versions(
        &self,
        window_label: &str,
    ) -> CommandResult<(FolderReviewTextPairRequest, DetachedReviewVersionPair)> {
        let inner = self.lock_inner();
        let session_id = inner
            .by_label
            .get(window_label)
            .copied()
            .ok_or_else(unknown_caller_error)?;
        let session = inner
            .sessions
            .get(&session_id)
            .ok_or_else(registry_state_error)?;
        if session.phase != DetachedReviewPhase::Ready {
            return Err(CommandError::new(
                AppErrorCode::DetachedInvalidState,
                "파일 버전은 비교 내용이 준비된 뒤 확인할 수 있습니다.",
            ));
        }
        let versions = session
            .delivered_versions
            .clone()
            .ok_or_else(registry_state_error)?;
        Ok((session.descriptor.pair_request(), versions))
    }

    pub(crate) fn invalidate_source(
        &self,
        owner_label: &str,
        source_review_token: &str,
        scan_generation: u64,
    ) {
        let mut inner = self.lock_inner();
        for session in inner.sessions.values_mut() {
            let identity = &session.descriptor.identity;
            if identity.owner_label == owner_label
                && identity.source_review_token == source_review_token
                && identity.scan_generation == scan_generation
                && session.phase != DetachedReviewPhase::Ready
            {
                session.stale = true;
                session
                    .active_cancel
                    .store(true, std::sync::atomic::Ordering::Release);
            }
        }
        self.shared.creation_changed.notify_all();
    }

    pub(crate) fn destroy(&self, window_label: &str) {
        let mut inner = self.lock_inner();
        let Some(session_id) = inner.by_label.get(window_label).copied() else {
            return;
        };
        if let Some(session) = inner.sessions.get_mut(&session_id) {
            session.phase = DetachedReviewPhase::Closing;
            session
                .active_cancel
                .store(true, std::sync::atomic::Ordering::Release);
        }
        remove_session(&mut inner, session_id);
        self.shared.creation_changed.notify_all();
    }

    pub(crate) fn close_all_labels(&self) -> Vec<String> {
        let mut inner = self.lock_inner();
        let labels = inner.by_label.keys().cloned().collect::<Vec<_>>();
        for session in inner.sessions.values_mut() {
            session.phase = DetachedReviewPhase::Closing;
            session
                .active_cancel
                .store(true, std::sync::atomic::Ordering::Release);
        }
        self.shared.creation_changed.notify_all();
        labels
    }

    #[cfg(test)]
    pub(crate) fn snapshot(&self) -> DetachedReviewRegistrySnapshot {
        let inner = self.lock_inner();
        DetachedReviewRegistrySnapshot {
            active_count: inner.sessions.len(),
            retained_source_bytes: inner.accounted_source_bytes,
        }
    }

    fn lock_inner(&self) -> MutexGuard<'_, RegistryInner> {
        match self.shared.inner.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        }
    }
}

fn active_load_session_mut<'a>(
    inner: &'a mut RegistryInner,
    permit: &DetachedReviewLoadPermit,
) -> CommandResult<&'a mut DetachedReviewSession> {
    let session = inner
        .sessions
        .get_mut(&permit.session_id)
        .ok_or_else(unknown_caller_error)?;
    if session.operation_revision != permit.operation_revision
        || session.phase != DetachedReviewPhase::Loading
    {
        return Err(CommandError::new(
            AppErrorCode::DetachedInvalidState,
            "완료 시점이 지난 비교 창 읽기 결과를 적용하지 않았습니다.",
        ));
    }
    Ok(session)
}

fn remove_session(inner: &mut RegistryInner, session_id: u64) {
    let Some(session) = inner.sessions.remove(&session_id) else {
        return;
    };
    inner.by_identity.remove(&session.descriptor.identity);
    inner.by_label.remove(&session.window_label);
    inner.accounted_source_bytes = inner
        .accounted_source_bytes
        .saturating_sub(session.accounted_source_bytes);
}

fn is_safe_relative_path(value: &str) -> bool {
    let normalized = value.replace('\\', "/");
    !normalized.is_empty()
        && !normalized.starts_with('/')
        && !normalized.starts_with("//")
        && normalized.as_bytes().get(1) != Some(&b':')
        && normalized
            .split('/')
            .all(|segment| !segment.is_empty() && segment != "." && segment != "..")
}

pub(crate) fn detached_window_title(context: &DetachedFolderReviewContext) -> String {
    let file = sanitize_title_segment(&context.file_name, "file");
    let parent = sanitize_title_segment(&context.parent_relative_path, "root");
    truncate_title(&format!("{file} — {parent} — forktail"), 160)
}

fn sanitize_title_segment(value: &str, fallback: &str) -> String {
    let sanitized = value
        .chars()
        .filter(|character| !character.is_control())
        .map(|character| match character {
            '\n' | '\r' | '\t' => ' ',
            _ => character,
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if sanitized.is_empty() {
        fallback.to_string()
    } else {
        sanitized
    }
}

fn truncate_title(value: &str, max_chars: usize) -> String {
    if value.chars().count() <= max_chars {
        return value.to_string();
    }
    let mut truncated = value
        .chars()
        .take(max_chars.saturating_sub(1))
        .collect::<String>();
    truncated.push('…');
    truncated
}

fn unknown_caller_error() -> CommandError {
    CommandError::new(
        AppErrorCode::DetachedUnknownWindow,
        "이 창에 연결된 폴더 비교 세션을 찾을 수 없습니다. 창을 닫고 다시 여세요.",
    )
}

fn registry_state_error() -> CommandError {
    CommandError::new(
        AppErrorCode::DetachedInvalidState,
        "비교 창 상태를 확인하지 못했습니다. 창을 닫고 다시 여세요.",
    )
}

fn source_budget_error() -> CommandError {
    CommandError::new(
        AppErrorCode::DetachedSourceByteLimit,
        "별도 비교 창의 파일 용량 한도(256 MiB)를 넘었습니다. 다른 창을 닫고 다시 시도하세요.",
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::models::{FolderReviewSideExpectation, OpenDetachedFolderReviewRequest};
    use std::collections::HashSet;
    use std::sync::{Arc, Barrier};

    #[test]
    fn exact_identity_is_reserved_once_even_under_concurrent_open() {
        let registry = Arc::new(DetachedReviewRegistry::default());
        let barrier = Arc::new(Barrier::new(100));
        let mut threads = Vec::new();

        for _ in 0..100 {
            let registry = Arc::clone(&registry);
            let barrier = Arc::clone(&barrier);
            threads.push(std::thread::spawn(move || {
                barrier.wait();
                registry.reserve_open("main", request("src/main.rs"))
            }));
        }

        let reservations = threads
            .into_iter()
            .map(|thread| thread.join().expect("join reservation").expect("reserve"))
            .collect::<Vec<_>>();
        let labels = reservations
            .iter()
            .map(OpenReservation::window_label)
            .collect::<HashSet<_>>();

        assert_eq!(labels, HashSet::from(["folder-review-1"]));
        assert_eq!(reservations.iter().filter(|item| item.is_new()).count(), 1);
        assert_eq!(registry.snapshot().active_count, 1);
    }

    #[test]
    fn open_request_rejects_every_non_main_caller() {
        let registry = DetachedReviewRegistry::default();
        assert_eq!(
            registry
                .reserve_open("folder-review-1", request("src/main.rs"))
                .expect_err("child must not open another child")
                .code,
            crate::error::AppErrorCode::DetachedUnknownWindow,
        );
        assert_eq!(registry.snapshot().active_count, 0);
    }

    #[test]
    fn duplicate_is_returned_before_count_limit_and_destroy_releases_the_slot() {
        let registry = DetachedReviewRegistry::with_limits(2, 256);
        let first = registry
            .reserve_open("main", request("one.txt"))
            .expect("first");
        registry
            .reserve_open("main", request("two.txt"))
            .expect("second");

        let duplicate = registry
            .reserve_open("main", request("one.txt"))
            .expect("duplicate");
        assert!(!duplicate.is_new());
        assert_eq!(duplicate.window_label(), first.window_label());
        assert_eq!(
            registry
                .reserve_open("main", request("three.txt"))
                .expect_err("third must hit count limit")
                .code,
            crate::error::AppErrorCode::DetachedWindowLimit,
        );

        registry.destroy(first.window_label());
        registry
            .reserve_open("main", request("three.txt"))
            .expect("released slot");
        assert_eq!(registry.snapshot().active_count, 2);
    }

    #[test]
    fn source_budget_reservation_rolls_back_without_dropping_ready_bytes() {
        let registry = DetachedReviewRegistry::with_limits(8, 256);
        let reservation = registry
            .reserve_open("main", request("one.txt"))
            .expect("reserve");
        let initial = registry
            .begin_initial_load(reservation.window_label())
            .expect("begin load");
        registry
            .reserve_source_bytes(&initial, 120)
            .expect("reserve bytes");
        registry
            .finish_load(&initial, 120, version_pair(120))
            .expect("finish load");
        assert_eq!(registry.snapshot().retained_source_bytes, 120);

        let reload = registry
            .begin_reload(reservation.window_label())
            .expect("begin reload");
        assert_eq!(
            registry
                .reserve_source_bytes(&reload, 300)
                .expect_err("oversize reload")
                .code,
            crate::error::AppErrorCode::DetachedSourceByteLimit,
        );
        registry.fail_load(&reload);
        assert_eq!(registry.snapshot().retained_source_bytes, 120);

        registry.destroy(reservation.window_label());
        assert_eq!(registry.snapshot().retained_source_bytes, 0);
    }

    #[test]
    fn checked_label_allocation_fails_without_reusing_an_identity() {
        let registry = DetachedReviewRegistry::with_next_session_id_for_test(u64::MAX);
        assert_eq!(
            registry
                .reserve_open("main", request("overflow.txt"))
                .expect_err("allocator must fail closed")
                .code,
            crate::error::AppErrorCode::DetachedWindowCreateFailed,
        );
        assert_eq!(registry.snapshot().active_count, 0);
    }

    #[test]
    fn creation_rollback_removes_only_its_unbuilt_reservation() {
        let registry = DetachedReviewRegistry::default();
        let failed = registry
            .reserve_open("main", request("failed.txt"))
            .expect("reserve");
        registry.rollback_creation(&failed);
        assert_eq!(registry.snapshot().active_count, 0);

        let created = registry
            .reserve_open("main", request("ready.txt"))
            .expect("reserve");
        assert_eq!(created.window_label(), "folder-review-2");
        registry
            .mark_window_created(&created)
            .expect("mark created");
        registry.rollback_creation(&created);
        assert_eq!(registry.snapshot().active_count, 1);
    }

    #[test]
    fn title_uses_only_sanitized_relative_context() {
        let context = DetachedFolderReviewContext {
            file_name: "main\n.rs".to_string(),
            parent_relative_path: "src\tprivate".to_string(),
            relative_path: "src/main.rs".to_string(),
            left_root: "/secret/left".to_string(),
            right_root: "/secret/right".to_string(),
            left_missing: false,
            right_missing: false,
        };
        let title = detached_window_title(&context);

        assert_eq!(title, "main.rs — srcprivate — forktail");
        assert!(!title.contains("/secret/"));
    }

    #[test]
    fn invalidation_cancels_loading_but_preserves_a_ready_snapshot() {
        let registry = DetachedReviewRegistry::default();
        let loading = registry
            .reserve_open("main", request("loading.txt"))
            .expect("reserve");
        let loading_permit = registry
            .begin_initial_load(loading.window_label())
            .expect("begin loading");
        registry
            .reserve_source_bytes(&loading_permit, 20)
            .expect("reserve bytes");
        registry.invalidate_source("main", "review-7", 3);
        assert!(
            loading_permit
                .cancelled
                .load(std::sync::atomic::Ordering::Acquire)
        );
        assert_eq!(
            registry
                .finish_load(&loading_permit, 20, version_pair(20))
                .expect_err("stale completion must be rejected")
                .code,
            crate::error::AppErrorCode::DetachedSourceStale,
        );
        registry.fail_load(&loading_permit);
        assert_eq!(registry.snapshot().retained_source_bytes, 0);

        let ready_request = OpenDetachedFolderReviewRequest {
            source_review_token: "review-ready".to_string(),
            ..request("ready.txt")
        };
        let ready = registry
            .reserve_open("main", ready_request)
            .expect("reserve ready");
        let ready_permit = registry
            .begin_initial_load(ready.window_label())
            .expect("begin ready");
        registry
            .reserve_source_bytes(&ready_permit, 40)
            .expect("reserve bytes");
        registry
            .finish_load(&ready_permit, 40, version_pair(40))
            .expect("finish ready");
        registry.invalidate_source("main", "review-ready", 3);
        assert!(registry.ready_versions(ready.window_label()).is_ok());
        assert_eq!(registry.snapshot().retained_source_bytes, 40);
    }

    #[test]
    fn destroy_cancels_an_operation_and_rejects_its_late_completion() {
        let registry = DetachedReviewRegistry::default();
        let reservation = registry
            .reserve_open("main", request("close.txt"))
            .expect("reserve");
        let permit = registry
            .begin_initial_load(reservation.window_label())
            .expect("begin load");
        registry
            .reserve_source_bytes(&permit, 64)
            .expect("reserve bytes");

        registry.destroy(reservation.window_label());

        assert!(permit.cancelled.load(std::sync::atomic::Ordering::Acquire));
        assert_eq!(registry.snapshot().active_count, 0);
        assert_eq!(registry.snapshot().retained_source_bytes, 0);
        assert_eq!(
            registry
                .finish_load(&permit, 64, version_pair(64))
                .expect_err("late completion must fail")
                .code,
            crate::error::AppErrorCode::DetachedUnknownWindow,
        );
    }

    #[test]
    fn close_all_wakes_each_operation_and_waits_for_destroy_to_release_entries() {
        let registry = DetachedReviewRegistry::default();
        let first = registry
            .reserve_open("main", request("one.txt"))
            .expect("first");
        let second = registry
            .reserve_open("main", request("two.txt"))
            .expect("second");
        let first_load = registry
            .begin_initial_load(first.window_label())
            .expect("load first");
        let second_load = registry
            .begin_initial_load(second.window_label())
            .expect("load second");

        let mut labels = registry.close_all_labels();
        labels.sort();

        assert_eq!(labels, ["folder-review-1", "folder-review-2"]);
        assert!(
            first_load
                .cancelled
                .load(std::sync::atomic::Ordering::Acquire)
        );
        assert!(
            second_load
                .cancelled
                .load(std::sync::atomic::Ordering::Acquire)
        );
        assert_eq!(registry.snapshot().active_count, 2);
        registry.destroy(first.window_label());
        registry.destroy(second.window_label());
        assert_eq!(registry.snapshot().active_count, 0);
    }

    #[test]
    fn repeated_rescan_close_and_app_exit_races_leave_no_orphan_state() {
        for cycle in 0..100 {
            let registry = DetachedReviewRegistry::default();
            let rescan = registry
                .reserve_open("main", request(&format!("rescan-{cycle}.txt")))
                .expect("reserve rescan race");
            let rescan_load = registry
                .begin_initial_load(rescan.window_label())
                .expect("begin rescan load");
            registry
                .reserve_source_bytes(&rescan_load, 64)
                .expect("reserve rescan bytes");

            registry.invalidate_source("main", "review-7", 3);
            assert!(
                rescan_load
                    .cancelled
                    .load(std::sync::atomic::Ordering::Acquire)
            );
            assert!(
                registry
                    .finish_load(&rescan_load, 64, version_pair(64))
                    .is_err()
            );
            registry.fail_load(&rescan_load);
            registry.destroy(rescan.window_label());

            let closing = registry
                .reserve_open("main", request(&format!("close-{cycle}.txt")))
                .expect("reserve close race");
            let closing_load = registry
                .begin_initial_load(closing.window_label())
                .expect("begin close load");
            registry
                .reserve_source_bytes(&closing_load, 32)
                .expect("reserve close bytes");
            registry.destroy(closing.window_label());
            assert!(
                closing_load
                    .cancelled
                    .load(std::sync::atomic::Ordering::Acquire)
            );
            assert!(
                registry
                    .finish_load(&closing_load, 32, version_pair(32))
                    .is_err()
            );

            let exiting = registry
                .reserve_open("main", request(&format!("exit-{cycle}.txt")))
                .expect("reserve app-exit race");
            let exiting_load = registry
                .begin_initial_load(exiting.window_label())
                .expect("begin app-exit load");
            let labels = registry.close_all_labels();
            assert_eq!(labels, vec![exiting.window_label().to_string()]);
            assert!(
                exiting_load
                    .cancelled
                    .load(std::sync::atomic::Ordering::Acquire)
            );
            for label in labels {
                registry.destroy(&label);
            }

            let snapshot = registry.snapshot();
            assert_eq!(snapshot.active_count, 0);
            assert_eq!(snapshot.retained_source_bytes, 0);
        }
    }

    fn request(relative_path: &str) -> OpenDetachedFolderReviewRequest {
        OpenDetachedFolderReviewRequest {
            source_review_token: "review-7".to_string(),
            scan_generation: 3,
            left_root: "/left".to_string(),
            right_root: "/right".to_string(),
            relative_path: relative_path.to_string(),
            left_expected: FolderReviewSideExpectation::RegularFile,
            right_expected: FolderReviewSideExpectation::RegularFile,
        }
    }

    fn version_pair(size: u64) -> DetachedReviewVersionPair {
        DetachedReviewVersionPair {
            left: DetachedReviewSideVersion::Regular {
                size,
                modified_ms: Some(10),
            },
            right: DetachedReviewSideVersion::Regular {
                size: 0,
                modified_ms: Some(10),
            },
        }
    }
}
