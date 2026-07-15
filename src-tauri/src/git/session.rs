use crate::domain::git::{
    GitBlobContent, GitBlobDocument, GitChangedFile, GitChangedFileStatus, GitCompareCapabilities,
    GitCompareSession, GitCompareSourceKind, GitHeadState, GitIndexComparison, GitIndexEntry,
    GitPathIdentity, GitPathPlatform, GitPathRegistryError, GitRevision, GitRevisionKind,
    GitRevisionPair, GitSnapshotContentState, GitSnapshotDocument, GitSnapshotOrigin,
    GitSnapshotUnavailableReason, GitTextMetadata, GitTreeEntry, GitTreeEntryKind,
    GitWorkingTreeVersion,
};
use crate::git::blob::{GitBlobError, read_blob};
use crate::git::index::{
    GitIndexError, index_entry_visible_against_head, index_fingerprint_matches,
    read_stage_zero_index_entry,
};
use crate::git::repository::GitRepositorySession;
use crate::git::runner::CancellationToken;
use crate::git::tree::{GitTreeError, list_tree};
use crate::text::{DecodedTextContent, MAX_TEXT_BYTES, decode_text_bytes};
use same_file::Handle;
use std::fs::{self, File, Metadata, OpenOptions};
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_REVISION_LABEL_BYTES: usize = 1024;
const SNAPSHOT_PATH_LOOKUP_LIMIT: usize = 2;
const SHORT_OBJECT_ID_LENGTH: usize = 12;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GitSessionError {
    InvalidRevision,
    InvalidChangedFile,
    UnsupportedStatus,
    UnknownPath,
    StaleGeneration,
    PathUnsupported,
    PathNotAtRevision,
    PathOutsideRoot,
    SymlinkUnsupported,
    WorkingTreeNotRegular,
    WorkingTreePermissionDenied,
    WorkingTreeReadFailed,
    WorkingTreeChanged,
    IntentToAddUnsupported,
    UnmergedIndexPath,
    IndexChanged,
    StateUnavailable,
    Cancelled,
    Tree(GitTreeError),
    Blob(GitBlobError),
    Index(GitIndexError),
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum SnapshotSidePlan {
    Missing(GitPathIdentity),
    Committed(GitPathIdentity),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum WorkingTreeReadStep {
    AfterPreflight,
    AfterRead,
}

struct WorkingTreePathPlan {
    identity: GitPathIdentity,
    raw_path: Vec<u8>,
    relative_path: PathBuf,
    candidate: PathBuf,
}

pub fn open_revision_compare(
    session: &GitRepositorySession,
    left_revision: &GitRevision,
    right_revision: &GitRevision,
    changed_file: &GitChangedFile,
    generation: u64,
    cancellation: &CancellationToken,
) -> Result<GitCompareSession, GitSessionError> {
    if cancellation.is_cancelled() {
        return Err(GitSessionError::Cancelled);
    }
    validate_revision(session, left_revision)?;
    validate_revision(session, right_revision)?;
    validate_generation(session, generation)?;

    let (left_plan, right_plan) = plan_changed_file(changed_file)?;
    let left_plan = canonicalize_plan(session, left_plan, generation)?;
    let right_plan = canonicalize_plan(session, right_plan, generation)?;
    let left = materialize_side(session, left_revision, left_plan, generation, cancellation)?;
    let right = materialize_side(
        session,
        right_revision,
        right_plan,
        generation,
        cancellation,
    )?;
    validate_generation(session, generation)?;

    let export_patch = is_patch_source(&left) && is_patch_source(&right);
    Ok(GitCompareSession {
        repository_id: session.summary().session_id.clone(),
        left,
        right,
        source_kind: GitCompareSourceKind::RevisionPair,
        revision_pair: Some(GitRevisionPair {
            left: left_revision.clone(),
            right: right_revision.clone(),
        }),
        revision: None,
        capabilities: GitCompareCapabilities {
            edit: false,
            save: false,
            hunk_copy: false,
            export_patch,
        },
        generation,
    })
}

pub fn open_working_tree_compare(
    session: &GitRepositorySession,
    revision: &GitRevision,
    path: &GitPathIdentity,
    generation: u64,
    cancellation: &CancellationToken,
) -> Result<GitCompareSession, GitSessionError> {
    open_working_tree_compare_inner(session, revision, path, generation, cancellation, |_| {})
}

pub fn open_index_compare(
    session: &GitRepositorySession,
    path: &GitPathIdentity,
    comparison: GitIndexComparison,
    generation: u64,
    cancellation: &CancellationToken,
) -> Result<GitCompareSession, GitSessionError> {
    if cancellation.is_cancelled() {
        return Err(GitSessionError::Cancelled);
    }
    validate_generation(session, generation)?;
    let revision = head_revision(session)?;
    let canonical_path = session
        .paths()
        .lock()
        .map_err(|_| GitSessionError::StateUnavailable)?
        .resolve_identity(&path.opaque_id, generation, current_path_platform())
        .map_err(map_path_error)?;
    let index_read =
        read_stage_zero_index_entry(session, &canonical_path, generation, cancellation)
            .map_err(map_index_error)?;
    let head = read_optional_committed_snapshot(
        session,
        &revision,
        canonical_path.clone(),
        generation,
        cancellation,
    )?;

    if matches!(head.content_state, GitSnapshotContentState::Missing)
        && index_read.entry.is_some()
        && !index_entry_visible_against_head(
            session,
            &canonical_path,
            &revision.resolved,
            generation,
            &index_read.fingerprint,
            cancellation,
        )
        .map_err(map_index_error)?
    {
        return Err(GitSessionError::IntentToAddUnsupported);
    }

    let index = if matches!(
        comparison,
        GitIndexComparison::HeadToIndex | GitIndexComparison::IndexToWorkingTree
    ) {
        Some(index_snapshot_document(
            session,
            &revision,
            canonical_path.clone(),
            index_read.entry.as_ref(),
            cancellation,
        )?)
    } else {
        None
    };
    let working = if matches!(
        comparison,
        GitIndexComparison::IndexToWorkingTree | GitIndexComparison::HeadToWorkingTree
    ) {
        let path_plan = prepare_working_tree_path(session, &canonical_path, generation)?;
        let mut working =
            read_working_tree_snapshot(session, &path_plan, cancellation, &mut |_| {})?;
        if index_read
            .entry
            .as_ref()
            .is_some_and(|entry| entry.skip_worktree)
            && matches!(working.content_state, GitSnapshotContentState::Missing)
        {
            working.content_state = GitSnapshotContentState::Unavailable {
                reason: GitSnapshotUnavailableReason::SparseWorkingTreeMissing,
            };
        }
        Some(working)
    } else {
        None
    };

    validate_generation(session, generation)?;
    if !index_fingerprint_matches(session, &index_read.fingerprint).map_err(map_index_error)? {
        return Err(GitSessionError::IndexChanged);
    }

    let (left, right, source_kind) = match comparison {
        GitIndexComparison::HeadToIndex => (
            head,
            index.ok_or(GitSessionError::StateUnavailable)?,
            GitCompareSourceKind::HeadIndex,
        ),
        GitIndexComparison::IndexToWorkingTree => (
            index.ok_or(GitSessionError::StateUnavailable)?,
            working.ok_or(GitSessionError::StateUnavailable)?,
            GitCompareSourceKind::IndexWorkingTree,
        ),
        GitIndexComparison::HeadToWorkingTree => (
            head,
            working.ok_or(GitSessionError::StateUnavailable)?,
            GitCompareSourceKind::RevisionWorkingTree,
        ),
    };
    let export_patch = is_patch_source(&left) && is_patch_source(&right);
    Ok(GitCompareSession {
        repository_id: session.summary().session_id.clone(),
        left,
        right,
        source_kind,
        revision_pair: None,
        revision: Some(revision),
        capabilities: GitCompareCapabilities {
            edit: false,
            save: false,
            hunk_copy: false,
            export_patch,
        },
        generation,
    })
}

fn head_revision(session: &GitRepositorySession) -> Result<GitRevision, GitSessionError> {
    let resolved = match &session.summary().head {
        GitHeadState::Unborn => return Err(GitSessionError::InvalidRevision),
        GitHeadState::Detached { object_id } | GitHeadState::Branch { object_id, .. } => {
            object_id.clone()
        }
    };
    Ok(GitRevision {
        raw_label: "HEAD".to_string(),
        resolved,
        kind: GitRevisionKind::Head,
        display_name: "HEAD".to_string(),
    })
}

fn index_snapshot_document(
    session: &GitRepositorySession,
    revision: &GitRevision,
    path: GitPathIdentity,
    entry: Option<&GitIndexEntry>,
    cancellation: &CancellationToken,
) -> Result<GitSnapshotDocument, GitSessionError> {
    let Some(entry) = entry else {
        return Ok(GitSnapshotDocument {
            origin: GitSnapshotOrigin::Missing,
            label: index_label(&path),
            read_only: true,
            object_id: None,
            path: Some(path),
            mode: None,
            text_metadata: None,
            working_tree_version: None,
            content_state: GitSnapshotContentState::Missing,
        });
    };
    let mut document = match entry.mode.as_str() {
        "100644" | "100755" => match read_blob(session, &entry.object_id, cancellation) {
            Ok(blob) => snapshot_document_from_blob(revision, path, entry.mode.clone(), blob),
            Err(GitBlobError::ObjectMissingLocal) => unavailable_snapshot_document(
                revision,
                path,
                entry.mode.clone(),
                entry.object_id.clone(),
            ),
            Err(error) => return Err(GitSessionError::Blob(error)),
        },
        "120000" => GitSnapshotDocument {
            origin: GitSnapshotOrigin::IndexStage,
            label: index_label(&path),
            read_only: true,
            object_id: Some(entry.object_id.clone()),
            path: Some(path),
            mode: Some(entry.mode.clone()),
            text_metadata: None,
            working_tree_version: None,
            content_state: GitSnapshotContentState::Symlink,
        },
        "160000" => GitSnapshotDocument {
            origin: GitSnapshotOrigin::IndexStage,
            label: index_label(&path),
            read_only: true,
            object_id: Some(entry.object_id.clone()),
            path: Some(path),
            mode: Some(entry.mode.clone()),
            text_metadata: None,
            working_tree_version: None,
            content_state: GitSnapshotContentState::Submodule,
        },
        _ => return Err(GitSessionError::StateUnavailable),
    };
    document.origin = GitSnapshotOrigin::IndexStage;
    document.label = index_label(
        document
            .path
            .as_ref()
            .ok_or(GitSessionError::StateUnavailable)?,
    );
    Ok(document)
}

fn index_label(path: &GitPathIdentity) -> String {
    format!("Index (stage 0) · {}", path.display_path)
}

fn open_working_tree_compare_inner<Hook>(
    session: &GitRepositorySession,
    revision: &GitRevision,
    path: &GitPathIdentity,
    generation: u64,
    cancellation: &CancellationToken,
    mut hook: Hook,
) -> Result<GitCompareSession, GitSessionError>
where
    Hook: FnMut(WorkingTreeReadStep),
{
    if cancellation.is_cancelled() {
        return Err(GitSessionError::Cancelled);
    }
    validate_revision(session, revision)?;
    validate_generation(session, generation)?;
    let path_plan = prepare_working_tree_path(session, path, generation)?;
    let left = read_optional_committed_snapshot(
        session,
        revision,
        path_plan.identity.clone(),
        generation,
        cancellation,
    )?;
    let right = read_working_tree_snapshot(session, &path_plan, cancellation, &mut hook)?;
    validate_generation(session, generation)?;

    let export_patch = is_patch_source(&left) && is_patch_source(&right);
    Ok(GitCompareSession {
        repository_id: session.summary().session_id.clone(),
        left,
        right,
        source_kind: GitCompareSourceKind::RevisionWorkingTree,
        revision_pair: None,
        revision: Some(revision.clone()),
        capabilities: GitCompareCapabilities {
            edit: false,
            save: false,
            hunk_copy: false,
            export_patch,
        },
        generation,
    })
}

fn prepare_working_tree_path(
    session: &GitRepositorySession,
    path: &GitPathIdentity,
    generation: u64,
) -> Result<WorkingTreePathPlan, GitSessionError> {
    let paths = session
        .paths()
        .lock()
        .map_err(|_| GitSessionError::StateUnavailable)?;
    let raw_path = paths
        .resolve(&path.opaque_id, generation, current_path_platform())
        .map_err(map_path_error)?
        .to_vec();
    let identity = paths
        .resolve_identity(&path.opaque_id, generation, current_path_platform())
        .map_err(map_path_error)?;
    drop(paths);

    let relative_path = raw_path_to_path_buf(raw_path.clone())?;
    if relative_path.as_os_str().is_empty()
        || relative_path.is_absolute()
        || relative_path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(GitSessionError::PathOutsideRoot);
    }
    let candidate = session.identity().root.join(&relative_path);
    ensure_no_symlinks(&session.identity().root, &relative_path)?;
    Ok(WorkingTreePathPlan {
        identity,
        raw_path,
        relative_path,
        candidate,
    })
}

fn read_optional_committed_snapshot(
    session: &GitRepositorySession,
    revision: &GitRevision,
    path: GitPathIdentity,
    generation: u64,
    cancellation: &CancellationToken,
) -> Result<GitSnapshotDocument, GitSessionError> {
    let tree = list_tree(
        session,
        &revision.resolved,
        Some((&path.opaque_id, generation)),
        SNAPSHOT_PATH_LOOKUP_LIMIT,
        cancellation,
    )
    .map_err(map_tree_error)?;
    match tree
        .entries
        .into_iter()
        .find(|entry| entry.path.opaque_id == path.opaque_id)
    {
        Some(entry) => snapshot_document_from_entry(session, revision, entry, cancellation),
        None => Ok(missing_snapshot_document(revision, path)),
    }
}

fn read_working_tree_snapshot<Hook>(
    session: &GitRepositorySession,
    plan: &WorkingTreePathPlan,
    cancellation: &CancellationToken,
    hook: &mut Hook,
) -> Result<GitSnapshotDocument, GitSessionError>
where
    Hook: FnMut(WorkingTreeReadStep),
{
    if cancellation.is_cancelled() {
        return Err(GitSessionError::Cancelled);
    }
    let Some(preflight) = working_tree_metadata(&plan.candidate)? else {
        return Ok(missing_working_tree_document(plan.identity.clone()));
    };
    validate_regular_metadata(&preflight)?;
    ensure_no_symlinks(&session.identity().root, &plan.relative_path)?;
    hook(WorkingTreeReadStep::AfterPreflight);

    let Some(rechecked) = working_tree_metadata(&plan.candidate)? else {
        return Err(GitSessionError::WorkingTreeChanged);
    };
    validate_regular_metadata(&rechecked)?;
    if metadata_version(&preflight) != metadata_version(&rechecked) {
        return Err(GitSessionError::WorkingTreeChanged);
    }
    ensure_no_symlinks(&session.identity().root, &plan.relative_path)?;
    let mut file = open_working_tree_file(&plan.candidate)?;
    let before = file.metadata().map_err(map_working_tree_io)?;
    validate_regular_metadata(&before)?;
    if metadata_version(&rechecked) != metadata_version(&before) {
        return Err(GitSessionError::WorkingTreeChanged);
    }
    verify_opened_working_tree_file(session, plan, &file)?;

    if before.len() > MAX_TEXT_BYTES {
        return Ok(working_tree_document(
            plan.identity.clone(),
            &before,
            None,
            GitSnapshotContentState::TooLarge,
        ));
    }

    let capacity =
        usize::try_from(before.len()).map_err(|_| GitSessionError::WorkingTreeReadFailed)?;
    let mut bytes = Vec::with_capacity(capacity.min(MAX_TEXT_BYTES as usize));
    file.by_ref()
        .take(MAX_TEXT_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(map_working_tree_io)?;
    if bytes.len() as u64 > MAX_TEXT_BYTES {
        return Err(GitSessionError::WorkingTreeChanged);
    }
    hook(WorkingTreeReadStep::AfterRead);

    let after = file.metadata().map_err(map_working_tree_io)?;
    if metadata_version(&before) != metadata_version(&after) {
        return Err(GitSessionError::WorkingTreeChanged);
    }
    verify_opened_working_tree_file(session, plan, &file)?;
    if cancellation.is_cancelled() {
        return Err(GitSessionError::Cancelled);
    }

    match decode_text_bytes(&bytes) {
        DecodedTextContent::Text(decoded) => Ok(working_tree_document(
            plan.identity.clone(),
            &after,
            Some(GitTextMetadata {
                encoding: decoded.encoding,
                line_ending: decoded.line_ending,
                had_final_newline: decoded.had_final_newline,
                decode_had_errors: decoded.decode_had_errors,
                size: after.len(),
            }),
            GitSnapshotContentState::Text { text: decoded.text },
        )),
        DecodedTextContent::Binary => Ok(working_tree_document(
            plan.identity.clone(),
            &after,
            None,
            GitSnapshotContentState::Binary,
        )),
    }
}

fn working_tree_metadata(candidate: &Path) -> Result<Option<Metadata>, GitSessionError> {
    match fs::symlink_metadata(candidate) {
        Ok(metadata) => Ok(Some(metadata)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(map_working_tree_io(error)),
    }
}

fn validate_regular_metadata(metadata: &Metadata) -> Result<(), GitSessionError> {
    if metadata.file_type().is_symlink() {
        Err(GitSessionError::SymlinkUnsupported)
    } else if !metadata.is_file() {
        Err(GitSessionError::WorkingTreeNotRegular)
    } else {
        Ok(())
    }
}

fn ensure_no_symlinks(root: &Path, relative_path: &Path) -> Result<(), GitSessionError> {
    let mut current = root.to_path_buf();
    for component in relative_path.components() {
        let Component::Normal(component) = component else {
            return Err(GitSessionError::PathOutsideRoot);
        };
        current.push(component);
        match fs::symlink_metadata(&current) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err(GitSessionError::SymlinkUnsupported);
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(error) => return Err(map_working_tree_io(error)),
        }
    }
    Ok(())
}

fn open_working_tree_file(candidate: &Path) -> Result<File, GitSessionError> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW);
    }
    match options.open(candidate) {
        Ok(file) => Ok(file),
        Err(error) => match fs::symlink_metadata(candidate) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                Err(GitSessionError::SymlinkUnsupported)
            }
            _ => Err(map_working_tree_io(error)),
        },
    }
}

fn verify_opened_working_tree_file(
    session: &GitRepositorySession,
    plan: &WorkingTreePathPlan,
    file: &File,
) -> Result<(), GitSessionError> {
    ensure_no_symlinks(&session.identity().root, &plan.relative_path)?;
    let canonical = fs::canonicalize(&plan.candidate).map_err(map_working_tree_io)?;
    let relative = canonical
        .strip_prefix(&session.identity().root)
        .map_err(|_| GitSessionError::PathOutsideRoot)?;
    if !relative_path_matches_raw(relative, &plan.raw_path) {
        return Err(GitSessionError::PathUnsupported);
    }
    let open_handle = Handle::from_file(file.try_clone().map_err(map_working_tree_io)?)
        .map_err(map_working_tree_io)?;
    let path_handle = Handle::from_path(&plan.candidate).map_err(map_working_tree_io)?;
    if open_handle != path_handle {
        return Err(GitSessionError::WorkingTreeChanged);
    }
    Ok(())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn raw_path_to_path_buf(raw_path: Vec<u8>) -> Result<PathBuf, GitSessionError> {
    use std::os::unix::ffi::OsStringExt;
    Ok(PathBuf::from(std::ffi::OsString::from_vec(raw_path)))
}

#[cfg(target_os = "macos")]
fn raw_path_to_path_buf(raw_path: Vec<u8>) -> Result<PathBuf, GitSessionError> {
    String::from_utf8(raw_path)
        .map(PathBuf::from)
        .map_err(|_| GitSessionError::PathUnsupported)
}

#[cfg(windows)]
fn raw_path_to_path_buf(raw_path: Vec<u8>) -> Result<PathBuf, GitSessionError> {
    String::from_utf8(raw_path)
        .map(PathBuf::from)
        .map_err(|_| GitSessionError::PathUnsupported)
}

#[cfg(not(any(unix, windows)))]
fn raw_path_to_path_buf(raw_path: Vec<u8>) -> Result<PathBuf, GitSessionError> {
    String::from_utf8(raw_path)
        .map(PathBuf::from)
        .map_err(|_| GitSessionError::PathUnsupported)
}

#[cfg(unix)]
fn relative_path_matches_raw(relative: &Path, raw_path: &[u8]) -> bool {
    use std::os::unix::ffi::OsStrExt;
    relative.as_os_str().as_bytes() == raw_path
}

#[cfg(windows)]
fn relative_path_matches_raw(relative: &Path, raw_path: &[u8]) -> bool {
    relative
        .components()
        .map(|component| match component {
            Component::Normal(component) => component.to_str(),
            _ => None,
        })
        .collect::<Option<Vec<_>>>()
        .map(|components| components.join("/").as_bytes() == raw_path)
        .unwrap_or(false)
}

#[cfg(not(any(unix, windows)))]
fn relative_path_matches_raw(relative: &Path, raw_path: &[u8]) -> bool {
    relative
        .to_str()
        .is_some_and(|path| path.as_bytes() == raw_path)
}

fn missing_working_tree_document(path: GitPathIdentity) -> GitSnapshotDocument {
    GitSnapshotDocument {
        origin: GitSnapshotOrigin::Missing,
        label: working_tree_label(&path),
        read_only: true,
        object_id: None,
        path: Some(path),
        mode: None,
        text_metadata: None,
        working_tree_version: None,
        content_state: GitSnapshotContentState::Missing,
    }
}

fn working_tree_document(
    path: GitPathIdentity,
    metadata: &Metadata,
    text_metadata: Option<GitTextMetadata>,
    content_state: GitSnapshotContentState,
) -> GitSnapshotDocument {
    GitSnapshotDocument {
        origin: GitSnapshotOrigin::WorkingTree,
        label: working_tree_label(&path),
        read_only: true,
        object_id: None,
        path: Some(path),
        mode: Some(working_tree_mode(metadata)),
        text_metadata,
        working_tree_version: Some(GitWorkingTreeVersion {
            size: metadata.len(),
            modified_ms: modified_ms(metadata),
        }),
        content_state,
    }
}

fn working_tree_label(path: &GitPathIdentity) -> String {
    format!("Working tree (disk) · {}", path.display_path)
}

#[cfg(unix)]
fn working_tree_mode(metadata: &Metadata) -> String {
    use std::os::unix::fs::PermissionsExt;
    if metadata.permissions().mode() & 0o111 == 0 {
        "100644".to_string()
    } else {
        "100755".to_string()
    }
}

#[cfg(not(unix))]
fn working_tree_mode(_metadata: &Metadata) -> String {
    "100644".to_string()
}

fn metadata_version(metadata: &Metadata) -> (u64, Option<SystemTime>) {
    (metadata.len(), metadata.modified().ok())
}

fn modified_ms(metadata: &Metadata) -> Option<u64> {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
}

fn map_working_tree_io(error: std::io::Error) -> GitSessionError {
    match error.kind() {
        std::io::ErrorKind::PermissionDenied => GitSessionError::WorkingTreePermissionDenied,
        std::io::ErrorKind::NotFound => GitSessionError::WorkingTreeChanged,
        _ => GitSessionError::WorkingTreeReadFailed,
    }
}

fn plan_changed_file(
    changed_file: &GitChangedFile,
) -> Result<(SnapshotSidePlan, SnapshotSidePlan), GitSessionError> {
    let old = changed_file.old_path.clone();
    let new = changed_file.new_path.clone();
    match changed_file.status {
        GitChangedFileStatus::Added => match (old, new) {
            (None, Some(path)) => Ok((
                SnapshotSidePlan::Missing(path.clone()),
                SnapshotSidePlan::Committed(path),
            )),
            _ => Err(GitSessionError::InvalidChangedFile),
        },
        GitChangedFileStatus::Deleted => match (old, new) {
            (Some(path), None) => Ok((
                SnapshotSidePlan::Committed(path.clone()),
                SnapshotSidePlan::Missing(path),
            )),
            _ => Err(GitSessionError::InvalidChangedFile),
        },
        GitChangedFileStatus::Modified | GitChangedFileStatus::TypeChanged => match (old, new) {
            (Some(old), Some(new)) if old.opaque_id == new.opaque_id => Ok((
                SnapshotSidePlan::Committed(old),
                SnapshotSidePlan::Committed(new),
            )),
            _ => Err(GitSessionError::InvalidChangedFile),
        },
        GitChangedFileStatus::Renamed => match (old, new) {
            (Some(old), Some(new)) if old.opaque_id != new.opaque_id => Ok((
                SnapshotSidePlan::Committed(old),
                SnapshotSidePlan::Committed(new),
            )),
            _ => Err(GitSessionError::InvalidChangedFile),
        },
        GitChangedFileStatus::Copied
        | GitChangedFileStatus::Unmerged
        | GitChangedFileStatus::Unknown => Err(GitSessionError::UnsupportedStatus),
    }
}

fn canonicalize_plan(
    session: &GitRepositorySession,
    plan: SnapshotSidePlan,
    generation: u64,
) -> Result<SnapshotSidePlan, GitSessionError> {
    let path = match &plan {
        SnapshotSidePlan::Missing(path) | SnapshotSidePlan::Committed(path) => path,
    };
    let canonical = session
        .paths()
        .lock()
        .map_err(|_| GitSessionError::StateUnavailable)?
        .resolve_identity(&path.opaque_id, generation, current_path_platform())
        .map_err(map_path_error)?;
    Ok(match plan {
        SnapshotSidePlan::Missing(_) => SnapshotSidePlan::Missing(canonical),
        SnapshotSidePlan::Committed(_) => SnapshotSidePlan::Committed(canonical),
    })
}

fn materialize_side(
    session: &GitRepositorySession,
    revision: &GitRevision,
    plan: SnapshotSidePlan,
    generation: u64,
    cancellation: &CancellationToken,
) -> Result<GitSnapshotDocument, GitSessionError> {
    match plan {
        SnapshotSidePlan::Missing(path) => Ok(missing_snapshot_document(revision, path)),
        SnapshotSidePlan::Committed(path) => {
            read_committed_snapshot(session, revision, path, generation, cancellation)
        }
    }
}

fn read_committed_snapshot(
    session: &GitRepositorySession,
    revision: &GitRevision,
    path: GitPathIdentity,
    generation: u64,
    cancellation: &CancellationToken,
) -> Result<GitSnapshotDocument, GitSessionError> {
    let tree = list_tree(
        session,
        &revision.resolved,
        Some((&path.opaque_id, generation)),
        SNAPSHOT_PATH_LOOKUP_LIMIT,
        cancellation,
    )
    .map_err(map_tree_error)?;
    let entry = tree
        .entries
        .into_iter()
        .find(|entry| entry.path.opaque_id == path.opaque_id)
        .ok_or(GitSessionError::PathNotAtRevision)?;
    snapshot_document_from_entry(session, revision, entry, cancellation)
}

fn snapshot_document_from_entry(
    session: &GitRepositorySession,
    revision: &GitRevision,
    entry: GitTreeEntry,
    cancellation: &CancellationToken,
) -> Result<GitSnapshotDocument, GitSessionError> {
    match entry.kind {
        GitTreeEntryKind::RegularFile | GitTreeEntryKind::ExecutableFile => {
            match read_blob(session, &entry.object_id, cancellation) {
                Ok(blob) => Ok(snapshot_document_from_blob(
                    revision, entry.path, entry.mode, blob,
                )),
                Err(GitBlobError::ObjectMissingLocal) => Ok(unavailable_snapshot_document(
                    revision,
                    entry.path,
                    entry.mode,
                    entry.object_id,
                )),
                Err(error) => Err(GitSessionError::Blob(error)),
            }
        }
        GitTreeEntryKind::Symlink => Ok(non_text_snapshot_document(
            revision,
            entry,
            GitSnapshotContentState::Symlink,
        )),
        GitTreeEntryKind::Submodule => Ok(non_text_snapshot_document(
            revision,
            entry,
            GitSnapshotContentState::Submodule,
        )),
    }
}

fn missing_snapshot_document(revision: &GitRevision, path: GitPathIdentity) -> GitSnapshotDocument {
    GitSnapshotDocument {
        origin: GitSnapshotOrigin::Missing,
        label: snapshot_label(revision, &path),
        read_only: true,
        object_id: None,
        path: Some(path),
        mode: None,
        text_metadata: None,
        working_tree_version: None,
        content_state: GitSnapshotContentState::Missing,
    }
}

fn snapshot_document_from_blob(
    revision: &GitRevision,
    path: GitPathIdentity,
    mode: String,
    blob: GitBlobDocument,
) -> GitSnapshotDocument {
    let label = snapshot_label(revision, &path);
    let object_id = Some(blob.object_id);
    let (text_metadata, content_state) = match blob.content {
        GitBlobContent::Text {
            text,
            encoding,
            line_ending,
            had_final_newline,
            decode_had_errors,
        } => (
            Some(GitTextMetadata {
                encoding,
                line_ending,
                had_final_newline,
                decode_had_errors,
                size: blob.size,
            }),
            GitSnapshotContentState::Text { text },
        ),
        GitBlobContent::Binary => (None, GitSnapshotContentState::Binary),
        GitBlobContent::TooLarge => (None, GitSnapshotContentState::TooLarge),
        GitBlobContent::LfsPointer {
            oid_sha256,
            referenced_size,
        } => (
            None,
            GitSnapshotContentState::LfsPointer {
                oid_sha256,
                referenced_size,
            },
        ),
    };
    GitSnapshotDocument {
        origin: GitSnapshotOrigin::CommittedBlob,
        label,
        read_only: true,
        object_id,
        path: Some(path),
        mode: Some(mode),
        text_metadata,
        working_tree_version: None,
        content_state,
    }
}

fn non_text_snapshot_document(
    revision: &GitRevision,
    entry: GitTreeEntry,
    content_state: GitSnapshotContentState,
) -> GitSnapshotDocument {
    GitSnapshotDocument {
        origin: GitSnapshotOrigin::CommittedBlob,
        label: snapshot_label(revision, &entry.path),
        read_only: true,
        object_id: Some(entry.object_id),
        path: Some(entry.path),
        mode: Some(entry.mode),
        text_metadata: None,
        working_tree_version: None,
        content_state,
    }
}

fn unavailable_snapshot_document(
    revision: &GitRevision,
    path: GitPathIdentity,
    mode: String,
    object_id: crate::GitObjectId,
) -> GitSnapshotDocument {
    GitSnapshotDocument {
        origin: GitSnapshotOrigin::CommittedBlob,
        label: snapshot_label(revision, &path),
        read_only: true,
        object_id: Some(object_id),
        path: Some(path),
        mode: Some(mode),
        text_metadata: None,
        working_tree_version: None,
        content_state: GitSnapshotContentState::Unavailable {
            reason: GitSnapshotUnavailableReason::ObjectMissingLocal,
        },
    }
}

fn snapshot_label(revision: &GitRevision, path: &GitPathIdentity) -> String {
    let short_length = revision.resolved.hex.len().min(SHORT_OBJECT_ID_LENGTH);
    format!(
        "{} ({}) · {}",
        revision.display_name,
        &revision.resolved.hex[..short_length],
        path.display_path,
    )
}

fn is_patch_source(document: &GitSnapshotDocument) -> bool {
    matches!(
        document.content_state,
        GitSnapshotContentState::Text { .. } | GitSnapshotContentState::Missing
    )
}

fn validate_revision(
    session: &GitRepositorySession,
    revision: &GitRevision,
) -> Result<(), GitSessionError> {
    if revision.resolved.algorithm != session.identity().object_format
        || !valid_revision_label(&revision.raw_label)
        || !valid_revision_label(&revision.display_name)
    {
        return Err(GitSessionError::InvalidRevision);
    }
    Ok(())
}

fn valid_revision_label(label: &str) -> bool {
    !label.is_empty()
        && label.len() <= MAX_REVISION_LABEL_BYTES
        && label.trim() == label
        && !label.chars().any(char::is_control)
}

fn validate_generation(
    session: &GitRepositorySession,
    generation: u64,
) -> Result<(), GitSessionError> {
    let current = session
        .paths()
        .lock()
        .map_err(|_| GitSessionError::StateUnavailable)?
        .generation();
    if current == generation {
        Ok(())
    } else {
        Err(GitSessionError::StaleGeneration)
    }
}

fn current_path_platform() -> GitPathPlatform {
    if cfg!(windows) {
        GitPathPlatform::Windows
    } else {
        GitPathPlatform::Unix
    }
}

fn map_path_error(error: GitPathRegistryError) -> GitSessionError {
    match error {
        GitPathRegistryError::UnknownOpaqueId => GitSessionError::UnknownPath,
        GitPathRegistryError::StaleGeneration => GitSessionError::StaleGeneration,
        GitPathRegistryError::PlatformConversionUnsupported => GitSessionError::PathUnsupported,
        GitPathRegistryError::EmptyPath
        | GitPathRegistryError::PathContainsNul
        | GitPathRegistryError::DuplicateOpaqueId
        | GitPathRegistryError::GenerationExhausted
        | GitPathRegistryError::OpaqueIdExhausted => GitSessionError::StateUnavailable,
    }
}

fn map_tree_error(error: GitTreeError) -> GitSessionError {
    match error {
        GitTreeError::UnknownPath => GitSessionError::UnknownPath,
        GitTreeError::StalePath => GitSessionError::StaleGeneration,
        GitTreeError::PathUnsupported => GitSessionError::PathUnsupported,
        other => GitSessionError::Tree(other),
    }
}

fn map_index_error(error: GitIndexError) -> GitSessionError {
    match error {
        GitIndexError::UnmergedPath => GitSessionError::UnmergedIndexPath,
        GitIndexError::IndexChanged => GitSessionError::IndexChanged,
        GitIndexError::UnknownPath => GitSessionError::UnknownPath,
        GitIndexError::StaleGeneration => GitSessionError::StaleGeneration,
        GitIndexError::PathUnsupported | GitIndexError::InvalidPath => {
            GitSessionError::PathUnsupported
        }
        GitIndexError::Runner(crate::git::runner::RunnerError::Cancelled) => {
            GitSessionError::Cancelled
        }
        other => GitSessionError::Index(other),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        GitSessionError, SnapshotSidePlan, missing_snapshot_document, plan_changed_file,
        snapshot_document_from_blob,
    };
    use crate::domain::git::{
        GitBlobContent, GitBlobDocument, GitChangedFile, GitChangedFileStatus,
        GitCompareSourceKind, GitObjectAlgorithm, GitObjectId, GitPathIdentity, GitRevision,
        GitRevisionKind, GitSnapshotContentState, GitSnapshotOrigin,
    };
    use crate::git::GIT_FIXTURE_LOCK;
    use crate::git::changed_files::list_changed_files;
    use crate::git::executable::ValidatedGitExecutable;
    use crate::git::repository::GitRepositorySession;
    use crate::git::runner::CancellationToken;
    use std::fs;
    use std::io::Write;
    use std::path::{Path, PathBuf};
    use std::process::{Command, Stdio};
    use tempfile::{TempDir, tempdir};

    fn sha1(hex_digit: char) -> GitObjectId {
        GitObjectId::try_new(GitObjectAlgorithm::Sha1, hex_digit.to_string().repeat(40))
            .expect("valid object ID")
    }

    fn path(id: &str, display: &str) -> GitPathIdentity {
        GitPathIdentity::new(id, display, Some(display))
    }

    fn changed(
        status: GitChangedFileStatus,
        old_path: Option<GitPathIdentity>,
        new_path: Option<GitPathIdentity>,
    ) -> GitChangedFile {
        GitChangedFile {
            status,
            old_path,
            new_path,
            similarity_score: None,
        }
    }

    fn revision() -> GitRevision {
        GitRevision {
            raw_label: "main".to_string(),
            resolved: sha1('a'),
            kind: GitRevisionKind::Branch,
            display_name: "main".to_string(),
        }
    }

    #[test]
    fn maps_supported_changed_statuses_to_explicit_snapshot_sides() {
        let old = path("old", "src/old.txt");
        let new = path("new", "src/new.txt");

        assert_eq!(
            plan_changed_file(&changed(
                GitChangedFileStatus::Added,
                None,
                Some(new.clone()),
            )),
            Ok((
                SnapshotSidePlan::Missing(new.clone()),
                SnapshotSidePlan::Committed(new.clone()),
            )),
        );
        assert_eq!(
            plan_changed_file(&changed(
                GitChangedFileStatus::Deleted,
                Some(old.clone()),
                None,
            )),
            Ok((
                SnapshotSidePlan::Committed(old.clone()),
                SnapshotSidePlan::Missing(old.clone()),
            )),
        );
        for status in [
            GitChangedFileStatus::Modified,
            GitChangedFileStatus::TypeChanged,
        ] {
            assert_eq!(
                plan_changed_file(&changed(status, Some(old.clone()), Some(old.clone()),)),
                Ok((
                    SnapshotSidePlan::Committed(old.clone()),
                    SnapshotSidePlan::Committed(old.clone()),
                )),
            );
        }
        assert_eq!(
            plan_changed_file(&changed(
                GitChangedFileStatus::Renamed,
                Some(old.clone()),
                Some(new.clone()),
            )),
            Ok((
                SnapshotSidePlan::Committed(old),
                SnapshotSidePlan::Committed(new),
            )),
        );
    }

    #[test]
    fn rejects_forward_compatible_statuses_and_malformed_path_shapes() {
        let same = path("same", "src/file.txt");
        for status in [
            GitChangedFileStatus::Copied,
            GitChangedFileStatus::Unmerged,
            GitChangedFileStatus::Unknown,
        ] {
            assert_eq!(
                plan_changed_file(&changed(status, Some(same.clone()), Some(same.clone()),)),
                Err(GitSessionError::UnsupportedStatus),
            );
        }

        assert_eq!(
            plan_changed_file(&changed(
                GitChangedFileStatus::Added,
                Some(same.clone()),
                Some(same.clone()),
            )),
            Err(GitSessionError::InvalidChangedFile),
        );
        assert_eq!(
            plan_changed_file(&changed(
                GitChangedFileStatus::Modified,
                Some(same.clone()),
                Some(path("other", "src/file.txt")),
            )),
            Err(GitSessionError::InvalidChangedFile),
        );
    }

    #[test]
    fn keeps_missing_distinct_from_a_real_empty_blob_and_labels_both() {
        let path = path("empty", "empty.txt");
        let revision = revision();
        let missing = missing_snapshot_document(&revision, path.clone());
        let empty = snapshot_document_from_blob(
            &revision,
            path,
            "100644".to_string(),
            GitBlobDocument {
                object_id: sha1('b'),
                size: 0,
                content: GitBlobContent::Text {
                    text: String::new(),
                    encoding: "UTF-8".to_string(),
                    line_ending: crate::LineEnding::None,
                    had_final_newline: true,
                    decode_had_errors: false,
                },
            },
        );

        assert_eq!(missing.origin, GitSnapshotOrigin::Missing);
        assert_eq!(missing.content_state, GitSnapshotContentState::Missing);
        assert_eq!(missing.object_id, None);
        assert!(missing.read_only);
        assert_eq!(empty.origin, GitSnapshotOrigin::CommittedBlob);
        assert!(matches!(
            empty.content_state,
            GitSnapshotContentState::Text { ref text } if text.is_empty()
        ));
        assert_eq!(
            empty.text_metadata.as_ref().map(|metadata| metadata.size),
            Some(0)
        );
        assert!(empty.object_id.is_some());
        assert!(empty.read_only);
        assert!(empty.label.contains("main"));
        assert!(empty.label.contains(&"a".repeat(12)));
        assert!(empty.label.contains("empty.txt"));
    }

    #[test]
    fn opens_revision_snapshots_without_mutating_repository_or_worktree_state() {
        let _fixture_guard = GIT_FIXTURE_LOCK.lock().expect("Git fixture lock");
        let fixture = revision_compare_fixture();
        let executable = ValidatedGitExecutable::discover(None).expect("validated Git");
        let session = GitRepositorySession::open(
            "repository-session-git-302".to_string(),
            fixture.root.clone(),
            executable,
        )
        .expect("open repository session");
        let cancellation = CancellationToken::new();
        let changes = list_changed_files(
            &session,
            &fixture.left.resolved,
            &fixture.right.resolved,
            100,
            &cancellation,
        )
        .expect("list changed files");
        let before = repository_fingerprint(&fixture.root);

        let empty = find_change(&changes.entries, GitChangedFileStatus::Added, "empty.txt");
        let empty_session = super::open_revision_compare(
            &session,
            &fixture.left,
            &fixture.right,
            empty,
            changes.generation,
            &cancellation,
        )
        .expect("open empty added file");
        assert_eq!(
            empty_session.left.content_state,
            GitSnapshotContentState::Missing
        );
        assert!(matches!(
            empty_session.right.content_state,
            GitSnapshotContentState::Text { ref text } if text.is_empty()
        ));
        assert!(empty_session.capabilities.export_patch);

        let modified = find_change(
            &changes.entries,
            GitChangedFileStatus::Modified,
            "modified.txt",
        );
        let modified_session = super::open_revision_compare(
            &session,
            &fixture.left,
            &fixture.right,
            modified,
            changes.generation,
            &cancellation,
        )
        .expect("open modified file");
        assert!(matches!(
            modified_session.left.content_state,
            GitSnapshotContentState::Text { ref text } if text == "before\n"
        ));
        assert!(matches!(
            modified_session.right.content_state,
            GitSnapshotContentState::Text { ref text } if text == "after\n"
        ));

        let deleted = find_change(
            &changes.entries,
            GitChangedFileStatus::Deleted,
            "deleted.txt",
        );
        let deleted_session = super::open_revision_compare(
            &session,
            &fixture.left,
            &fixture.right,
            deleted,
            changes.generation,
            &cancellation,
        )
        .expect("open deleted file");
        assert!(matches!(
            deleted_session.left.content_state,
            GitSnapshotContentState::Text { .. }
        ));
        assert_eq!(
            deleted_session.right.content_state,
            GitSnapshotContentState::Missing
        );

        let renamed = find_change(
            &changes.entries,
            GitChangedFileStatus::Renamed,
            "renamed.txt",
        );
        let renamed_session = super::open_revision_compare(
            &session,
            &fixture.left,
            &fixture.right,
            renamed,
            changes.generation,
            &cancellation,
        )
        .expect("open renamed file");
        assert!(renamed_session.left.label.contains("old-name.txt"));
        assert!(renamed_session.right.label.contains("renamed.txt"));

        let binary = find_change(&changes.entries, GitChangedFileStatus::Added, "binary.bin");
        let binary_session = super::open_revision_compare(
            &session,
            &fixture.left,
            &fixture.right,
            binary,
            changes.generation,
            &cancellation,
        )
        .expect("open binary file");
        assert_eq!(
            binary_session.right.content_state,
            GitSnapshotContentState::Binary
        );
        assert!(!binary_session.capabilities.export_patch);

        let type_change = find_change(
            &changes.entries,
            GitChangedFileStatus::TypeChanged,
            "type.txt",
        );
        let type_session = super::open_revision_compare(
            &session,
            &fixture.left,
            &fixture.right,
            type_change,
            changes.generation,
            &cancellation,
        )
        .expect("open type-changed file");
        assert!(matches!(
            type_session.left.content_state,
            GitSnapshotContentState::Text { .. }
        ));
        assert_eq!(
            type_session.right.content_state,
            GitSnapshotContentState::Symlink
        );
        assert!(!type_session.capabilities.export_patch);

        assert_eq!(repository_fingerprint(&fixture.root), before);
        session
            .paths()
            .lock()
            .expect("path registry")
            .refresh()
            .expect("refresh path generation");
        assert_eq!(
            super::open_revision_compare(
                &session,
                &fixture.left,
                &fixture.right,
                modified,
                changes.generation,
                &cancellation,
            ),
            Err(GitSessionError::StaleGeneration),
        );
        assert_eq!(repository_fingerprint(&fixture.root), before);
    }

    #[test]
    fn opens_revision_and_disk_working_tree_states_without_conflating_missing_or_binary() {
        let _fixture_guard = GIT_FIXTURE_LOCK.lock().expect("Git fixture lock");
        let fixture = working_tree_compare_fixture();
        let executable = ValidatedGitExecutable::discover(None).expect("validated Git");
        let session = GitRepositorySession::open(
            "repository-session-git-402".to_string(),
            fixture.root.clone(),
            executable,
        )
        .expect("open repository session");
        let paths = register_paths(
            &session,
            &[
                b"modified.txt",
                b"deleted.txt",
                b"untracked.txt",
                b"binary.bin",
                b"utf16.txt",
                b"large.txt",
            ],
        );
        let before = working_tree_fingerprint(&fixture.root);
        let cancellation = CancellationToken::new();

        let modified = super::open_working_tree_compare(
            &session,
            &fixture.revision,
            &paths[0],
            fixture_generation(&paths[0]),
            &cancellation,
        )
        .expect("modified working-tree compare");
        assert_eq!(
            modified.source_kind,
            GitCompareSourceKind::RevisionWorkingTree
        );
        assert_eq!(modified.revision.as_ref(), Some(&fixture.revision));
        assert!(modified.revision_pair.is_none());
        assert!(matches!(
            modified.left.content_state,
            GitSnapshotContentState::Text { ref text } if text == "committed\n"
        ));
        assert_eq!(modified.right.origin, GitSnapshotOrigin::WorkingTree);
        assert!(modified.right.label.contains("Working tree (disk)"));
        assert!(matches!(
            modified.right.content_state,
            GitSnapshotContentState::Text { ref text } if text == "disk change\n"
        ));
        assert!(modified.right.working_tree_version.is_some());
        assert!(modified.left.read_only && modified.right.read_only);
        assert!(!modified.capabilities.edit);
        assert!(!modified.capabilities.save);

        let deleted = super::open_working_tree_compare(
            &session,
            &fixture.revision,
            &paths[1],
            fixture_generation(&paths[1]),
            &cancellation,
        )
        .expect("deleted working-tree compare");
        assert!(matches!(
            deleted.left.content_state,
            GitSnapshotContentState::Text { .. }
        ));
        assert_eq!(
            deleted.right.content_state,
            GitSnapshotContentState::Missing
        );

        let untracked = super::open_working_tree_compare(
            &session,
            &fixture.revision,
            &paths[2],
            fixture_generation(&paths[2]),
            &cancellation,
        )
        .expect("untracked working-tree compare");
        assert_eq!(
            untracked.left.content_state,
            GitSnapshotContentState::Missing
        );
        assert_eq!(untracked.right.origin, GitSnapshotOrigin::WorkingTree);
        assert!(matches!(
            untracked.right.content_state,
            GitSnapshotContentState::Text { ref text } if text == "untracked\n"
        ));

        let binary = super::open_working_tree_compare(
            &session,
            &fixture.revision,
            &paths[3],
            fixture_generation(&paths[3]),
            &cancellation,
        )
        .expect("binary working-tree compare");
        assert_eq!(binary.left.content_state, GitSnapshotContentState::Missing);
        assert_eq!(binary.right.content_state, GitSnapshotContentState::Binary);
        assert!(!binary.capabilities.export_patch);

        let utf16 = super::open_working_tree_compare(
            &session,
            &fixture.revision,
            &paths[4],
            fixture_generation(&paths[4]),
            &cancellation,
        )
        .expect("UTF-16 working-tree compare");
        assert!(matches!(
            utf16.right.content_state,
            GitSnapshotContentState::Text { ref text } if text == "hi\n"
        ));
        assert_eq!(
            utf16
                .right
                .text_metadata
                .as_ref()
                .map(|metadata| metadata.encoding.as_str()),
            Some("UTF-16LE BOM")
        );

        let large = super::open_working_tree_compare(
            &session,
            &fixture.revision,
            &paths[5],
            fixture_generation(&paths[5]),
            &cancellation,
        )
        .expect("large working-tree compare");
        assert_eq!(large.right.content_state, GitSnapshotContentState::TooLarge);
        assert_eq!(working_tree_fingerprint(&fixture.root), before);
    }

    #[test]
    fn path_identity_matching_is_exact_instead_of_case_or_normalization_folded() {
        assert!(super::relative_path_matches_raw(
            Path::new("src/Exact.txt"),
            b"src/Exact.txt",
        ));
        assert!(!super::relative_path_matches_raw(
            Path::new("src/Exact.txt"),
            b"src/exact.txt",
        ));
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    #[test]
    fn opens_lossless_non_utf8_untracked_path_on_unix() {
        use std::os::unix::ffi::OsStringExt;

        let _fixture_guard = GIT_FIXTURE_LOCK.lock().expect("Git fixture lock");
        let fixture = working_tree_compare_fixture();
        let executable = ValidatedGitExecutable::discover(None).expect("validated Git");
        let session = GitRepositorySession::open(
            "repository-session-git-402-non-utf8".to_string(),
            fixture.root.clone(),
            executable,
        )
        .expect("open repository session");
        let raw_path = b"non-utf8-\xff.txt".to_vec();
        fs::write(
            fixture
                .root
                .join(std::ffi::OsString::from_vec(raw_path.clone())),
            b"lossless\n",
        )
        .expect("non-UTF-8 working file");
        let paths = register_paths(&session, &[raw_path.as_slice()]);
        let result = super::open_working_tree_compare(
            &session,
            &fixture.revision,
            &paths[0],
            fixture_generation(&paths[0]),
            &CancellationToken::new(),
        )
        .expect("non-UTF-8 working-tree compare");

        assert!(
            result
                .right
                .path
                .as_ref()
                .is_some_and(|path| path.utf8_path.is_none())
        );
        assert!(matches!(
            result.right.content_state,
            GitSnapshotContentState::Text { ref text } if text == "lossless\n"
        ));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn rejects_non_utf8_working_tree_path_when_the_platform_cannot_represent_it() {
        let _fixture_guard = GIT_FIXTURE_LOCK.lock().expect("Git fixture lock");
        let fixture = working_tree_compare_fixture();
        let executable = ValidatedGitExecutable::discover(None).expect("validated Git");
        let session = GitRepositorySession::open(
            "repository-session-git-402-non-utf8".to_string(),
            fixture.root.clone(),
            executable,
        )
        .expect("open repository session");
        let paths = register_paths(&session, &[b"non-utf8-\xff.txt"]);

        assert_eq!(
            super::open_working_tree_compare(
                &session,
                &fixture.revision,
                &paths[0],
                fixture_generation(&paths[0]),
                &CancellationToken::new(),
            ),
            Err(GitSessionError::PathUnsupported),
        );
    }

    #[test]
    fn rejects_root_escape_directory_and_stale_working_tree_paths() {
        let _fixture_guard = GIT_FIXTURE_LOCK.lock().expect("Git fixture lock");
        let fixture = working_tree_compare_fixture();
        let executable = ValidatedGitExecutable::discover(None).expect("validated Git");
        let session = GitRepositorySession::open(
            "repository-session-git-402-boundary".to_string(),
            fixture.root.clone(),
            executable,
        )
        .expect("open repository session");
        let paths = register_paths(&session, &[b"../outside.txt", b"directory"]);
        let generation = fixture_generation(&paths[0]);

        assert_eq!(
            super::open_working_tree_compare(
                &session,
                &fixture.revision,
                &paths[0],
                generation,
                &CancellationToken::new(),
            ),
            Err(GitSessionError::PathOutsideRoot),
        );
        assert_eq!(
            super::open_working_tree_compare(
                &session,
                &fixture.revision,
                &paths[1],
                generation,
                &CancellationToken::new(),
            ),
            Err(GitSessionError::WorkingTreeNotRegular),
        );

        session
            .paths()
            .lock()
            .expect("path registry")
            .refresh()
            .expect("refresh generation");
        assert_eq!(
            super::open_working_tree_compare(
                &session,
                &fixture.revision,
                &paths[0],
                generation,
                &CancellationToken::new(),
            ),
            Err(GitSessionError::StaleGeneration),
        );
    }

    #[test]
    fn rejects_external_change_after_disk_read_before_returning_snapshot() {
        let _fixture_guard = GIT_FIXTURE_LOCK.lock().expect("Git fixture lock");
        let fixture = working_tree_compare_fixture();
        let executable = ValidatedGitExecutable::discover(None).expect("validated Git");
        let session = GitRepositorySession::open(
            "repository-session-git-402-change-race".to_string(),
            fixture.root.clone(),
            executable,
        )
        .expect("open repository session");
        let race_path = fixture.root.join("external-change.txt");
        fs::write(&race_path, b"before\n").expect("external-change source");
        let paths = register_paths(&session, &[b"external-change.txt"]);
        let generation = fixture_generation(&paths[0]);

        let result = super::open_working_tree_compare_inner(
            &session,
            &fixture.revision,
            &paths[0],
            generation,
            &CancellationToken::new(),
            |step| {
                if step == super::WorkingTreeReadStep::AfterRead {
                    fs::write(&race_path, b"changed while reading\n")
                        .expect("inject external change");
                }
            },
        );

        assert_eq!(result, Err(GitSessionError::WorkingTreeChanged));
    }

    #[cfg(unix)]
    #[test]
    fn reports_permission_denial_without_returning_file_content() {
        use std::os::unix::fs::PermissionsExt;

        let _fixture_guard = GIT_FIXTURE_LOCK.lock().expect("Git fixture lock");
        let fixture = working_tree_compare_fixture();
        let executable = ValidatedGitExecutable::discover(None).expect("validated Git");
        let session = GitRepositorySession::open(
            "repository-session-git-402-permission".to_string(),
            fixture.root.clone(),
            executable,
        )
        .expect("open repository session");
        let protected_path = fixture.root.join("permission.txt");
        fs::write(&protected_path, b"private\n").expect("permission fixture");
        fs::set_permissions(&protected_path, fs::Permissions::from_mode(0o000))
            .expect("remove read permission");
        let paths = register_paths(&session, &[b"permission.txt"]);

        let result = super::open_working_tree_compare(
            &session,
            &fixture.revision,
            &paths[0],
            fixture_generation(&paths[0]),
            &CancellationToken::new(),
        );
        fs::set_permissions(&protected_path, fs::Permissions::from_mode(0o600))
            .expect("restore cleanup permission");

        assert_eq!(result, Err(GitSessionError::WorkingTreePermissionDenied));
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlink_and_file_to_symlink_race_before_returning_disk_content() {
        use std::os::unix::fs::symlink;

        let _fixture_guard = GIT_FIXTURE_LOCK.lock().expect("Git fixture lock");
        let fixture = working_tree_compare_fixture();
        let executable = ValidatedGitExecutable::discover(None).expect("validated Git");
        let session = GitRepositorySession::open(
            "repository-session-git-402-symlink".to_string(),
            fixture.root.clone(),
            executable,
        )
        .expect("open repository session");
        symlink(
            fixture
                .root
                .parent()
                .expect("fixture parent")
                .join("outside.txt"),
            fixture.root.join("link.txt"),
        )
        .expect("fixture symlink");
        fs::write(fixture.root.join("race.txt"), b"safe\n").expect("race source");
        let paths = register_paths(&session, &[b"link.txt", b"race.txt"]);
        let generation = fixture_generation(&paths[0]);

        assert_eq!(
            super::open_working_tree_compare(
                &session,
                &fixture.revision,
                &paths[0],
                generation,
                &CancellationToken::new(),
            ),
            Err(GitSessionError::SymlinkUnsupported),
        );

        let race_path = fixture.root.join("race.txt");
        let outside_path = fixture
            .root
            .parent()
            .expect("fixture parent")
            .join("outside.txt");
        let result = super::open_working_tree_compare_inner(
            &session,
            &fixture.revision,
            &paths[1],
            generation,
            &CancellationToken::new(),
            |step| {
                if step == super::WorkingTreeReadStep::AfterPreflight {
                    fs::remove_file(&race_path).expect("remove race source");
                    symlink(&outside_path, &race_path).expect("replace with symlink");
                }
            },
        );
        assert_eq!(result, Err(GitSessionError::SymlinkUnsupported));
    }

    struct WorkingTreeCompareFixture {
        _temp: TempDir,
        root: PathBuf,
        revision: GitRevision,
    }

    fn working_tree_compare_fixture() -> WorkingTreeCompareFixture {
        let temp = tempdir().expect("temporary working-tree repository");
        let root = temp.path().join("repository");
        fs::create_dir(&root).expect("repository root");
        git(&root, &["init"]);
        git(&root, &["config", "user.name", "Forktail Test"]);
        git(&root, &["config", "user.email", "forktail@example.invalid"]);
        fs::write(root.join("modified.txt"), b"committed\n").expect("tracked fixture");
        fs::write(root.join("deleted.txt"), b"deleted\n").expect("deleted fixture");
        git(&root, &["add", "--all"]);
        git(&root, &["commit", "-m", "working tree base"]);
        let revision = revision_from_head(&root, "HEAD");

        fs::write(root.join("modified.txt"), b"disk change\n").expect("working change");
        fs::remove_file(root.join("deleted.txt")).expect("working deletion");
        fs::write(root.join("untracked.txt"), b"untracked\n").expect("untracked fixture");
        fs::write(root.join("binary.bin"), [0, 1, 2, 3]).expect("binary fixture");
        fs::write(
            root.join("utf16.txt"),
            [0xff, 0xfe, b'h', 0, b'i', 0, b'\n', 0],
        )
        .expect("UTF-16 fixture");
        let large = fs::File::create(root.join("large.txt")).expect("large fixture");
        large
            .set_len(crate::text::MAX_TEXT_BYTES + 1)
            .expect("large sparse file");
        fs::create_dir(root.join("directory")).expect("directory fixture");
        fs::write(temp.path().join("outside.txt"), b"outside secret\n").expect("outside fixture");

        WorkingTreeCompareFixture {
            _temp: temp,
            root,
            revision,
        }
    }

    fn register_paths(session: &GitRepositorySession, paths: &[&[u8]]) -> Vec<GitPathIdentity> {
        let mut registry = session.paths().lock().expect("path registry");
        registry.refresh().expect("refresh paths");
        paths
            .iter()
            .map(|path| registry.register((*path).to_vec()).expect("register path"))
            .collect()
    }

    fn fixture_generation(path: &GitPathIdentity) -> u64 {
        path.opaque_id
            .split(':')
            .nth_back(1)
            .expect("opaque generation")
            .parse()
            .expect("numeric generation")
    }

    #[derive(Debug, PartialEq, Eq)]
    struct WorkingTreeFingerprint {
        head: Vec<u8>,
        index: Vec<u8>,
        status: Vec<u8>,
        files: Vec<(String, Option<Vec<u8>>)>,
    }

    fn working_tree_fingerprint(root: &Path) -> WorkingTreeFingerprint {
        let files = ["modified.txt", "deleted.txt", "untracked.txt", "binary.bin"]
            .into_iter()
            .map(|path| {
                let bytes = match fs::read(root.join(path)) {
                    Ok(bytes) => Some(bytes),
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
                    Err(error) => panic!("read working-tree fixture {path}: {error}"),
                };
                (path.to_string(), bytes)
            })
            .collect();
        WorkingTreeFingerprint {
            head: fs::read(root.join(".git/HEAD")).expect("HEAD fingerprint"),
            index: fs::read(root.join(".git/index")).expect("index fingerprint"),
            status: git_output(
                root,
                &[
                    "--no-optional-locks",
                    "-c",
                    "core.fsmonitor=false",
                    "status",
                    "--porcelain=v2",
                    "-z",
                    "--branch",
                    "--untracked-files=all",
                ],
            ),
            files,
        }
    }

    struct RevisionCompareFixture {
        _temp: TempDir,
        root: PathBuf,
        left: GitRevision,
        right: GitRevision,
    }

    #[derive(Debug, PartialEq, Eq)]
    struct RepositoryFingerprint {
        head: Vec<u8>,
        refs: Vec<u8>,
        index: Vec<u8>,
        status: Vec<u8>,
        worktree: Vec<(String, Option<Vec<u8>>)>,
    }

    fn revision_compare_fixture() -> RevisionCompareFixture {
        let temp = tempdir().expect("temporary repository");
        let root = temp.path().to_path_buf();
        git(&root, &["init"]);
        git(&root, &["config", "user.name", "Forktail Test"]);
        git(&root, &["config", "user.email", "forktail@example.invalid"]);
        fs::write(root.join("modified.txt"), b"before\n").expect("write modified fixture");
        fs::write(root.join("deleted.txt"), b"deleted\n").expect("write deleted fixture");
        fs::write(root.join("old-name.txt"), b"rename me\n").expect("write rename fixture");
        fs::write(root.join("type.txt"), b"target\n").expect("write type fixture");
        git(&root, &["add", "--all"]);
        git(&root, &["commit", "-m", "left"]);
        let left = revision_from_head(&root, "left");

        fs::write(root.join("modified.txt"), b"after\n").expect("modify fixture");
        fs::remove_file(root.join("deleted.txt")).expect("delete fixture");
        fs::rename(root.join("old-name.txt"), root.join("renamed.txt")).expect("rename fixture");
        fs::write(root.join("empty.txt"), b"").expect("write empty fixture");
        fs::write(root.join("binary.bin"), [0, 1, 2, 3]).expect("write binary fixture");
        git(&root, &["add", "--all"]);
        let symlink_blob = String::from_utf8(git_output(&root, &["hash-object", "-w", "type.txt"]))
            .expect("ASCII blob ID")
            .trim()
            .to_string();
        git(
            &root,
            &[
                "update-index",
                "--add",
                "--cacheinfo",
                &format!("120000,{symlink_blob},type.txt"),
            ],
        );
        git(&root, &["commit", "-m", "right"]);
        let right = revision_from_head(&root, "right");

        RevisionCompareFixture {
            _temp: temp,
            root,
            left,
            right,
        }
    }

    fn revision_from_head(root: &Path, label: &str) -> GitRevision {
        let hex = String::from_utf8(git_output(root, &["rev-parse", "HEAD"]))
            .expect("ASCII commit ID")
            .trim()
            .to_string();
        GitRevision {
            raw_label: label.to_string(),
            resolved: GitObjectId::try_new(GitObjectAlgorithm::Sha1, hex).expect("full commit ID"),
            kind: GitRevisionKind::Commit,
            display_name: label.to_string(),
        }
    }

    fn find_change<'a>(
        entries: &'a [GitChangedFile],
        status: GitChangedFileStatus,
        display_path: &str,
    ) -> &'a GitChangedFile {
        entries
            .iter()
            .find(|entry| {
                entry.status == status
                    && entry
                        .new_path
                        .as_ref()
                        .or(entry.old_path.as_ref())
                        .is_some_and(|path| path.display_path == display_path)
            })
            .expect("expected changed file")
    }

    fn repository_fingerprint(root: &Path) -> RepositoryFingerprint {
        let status = git_output(
            root,
            &[
                "status",
                "--porcelain=v2",
                "-z",
                "--branch",
                "--untracked-files=all",
            ],
        );
        let index_path = root.join(".git/index");
        let worktree = [
            "modified.txt",
            "deleted.txt",
            "old-name.txt",
            "renamed.txt",
            "type.txt",
            "empty.txt",
            "binary.bin",
        ]
        .into_iter()
        .map(|path| {
            let bytes = match fs::read(root.join(path)) {
                Ok(bytes) => Some(bytes),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
                Err(error) => panic!("read worktree fixture {path}: {error}"),
            };
            (path.to_string(), bytes)
        })
        .collect();
        RepositoryFingerprint {
            head: fs::read(root.join(".git/HEAD")).expect("HEAD file"),
            refs: git_output(root, &["show-ref", "--head"]),
            index: fs::read(&index_path).expect("index bytes"),
            status,
            worktree,
        }
    }

    fn git(root: &Path, arguments: &[&str]) {
        let output = Command::new("git")
            .current_dir(root)
            .args(arguments)
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_TERMINAL_PROMPT", "0")
            .output()
            .expect("run Git fixture command");
        assert!(
            output.status.success(),
            "git {arguments:?} failed: {}",
            String::from_utf8_lossy(&output.stderr),
        );
    }

    fn git_output(root: &Path, arguments: &[&str]) -> Vec<u8> {
        let mut child = Command::new("git")
            .current_dir(root)
            .args(arguments)
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_TERMINAL_PROMPT", "0")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("spawn Git fixture command");
        if let Some(mut stdin) = child.stdin.take() {
            stdin.write_all(&[]).expect("close fixture stdin");
        }
        let output = child
            .wait_with_output()
            .expect("wait for Git fixture command");
        assert!(
            output.status.success(),
            "git {arguments:?} failed: {}",
            String::from_utf8_lossy(&output.stderr),
        );
        output.stdout
    }
}
