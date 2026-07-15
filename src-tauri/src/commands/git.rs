use crate::error::{AppErrorCode, CommandError, CommandResult};
use crate::git::blob::{GitBlobError, read_blob};
use crate::git::changed_files::{GitChangedFilesError, list_changed_files};
use crate::git::conflicts::{GitConflictError, list_conflicts};
use crate::git::executable::{
    GitExecutableError, GitVersion, MINIMUM_GIT_VERSION, ValidatedGitExecutable,
};
use crate::git::index::GitIndexError;
use crate::git::jobs::{GitJobError, GitJobs};
use crate::git::refs::{GitRefError, list_refs};
use crate::git::repository::{GitRepositoryError, GitRepositorySessions};
use crate::git::revision::{GitRevisionError, resolve_revision};
use crate::git::session::{
    GitSessionError, open_conflict_session, open_index_compare, open_revision_compare,
    open_working_tree_compare,
};
use crate::git::status::{GitStatusError, read_status};
use crate::git::tree::{GitTreeError, list_tree};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::State;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRuntimeStatus {
    pub version: GitVersion,
    pub minimum_version: GitVersion,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitTreePathRequest {
    pub opaque_id: String,
    pub generation: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitChangedFilesRequest {
    pub left_commit: crate::GitObjectId,
    pub right_commit: crate::GitObjectId,
    pub hard_limit: usize,
    pub request_generation: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusRequest {
    pub hard_limit: usize,
    pub request_generation: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitConflictsRequest {
    pub hard_limit: usize,
    pub request_generation: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRevisionCompareRequest {
    pub left_revision: crate::GitRevision,
    pub right_revision: crate::GitRevision,
    pub changed_file: crate::GitChangedFile,
    pub generation: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitWorkingTreeCompareRequest {
    pub revision: crate::GitRevision,
    pub path: crate::GitPathIdentity,
    pub generation: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitIndexCompareRequest {
    pub opaque_path_id: String,
    pub comparison: crate::GitIndexComparison,
    pub generation: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitConflictSessionRequest {
    pub opaque_path_id: String,
    pub generation: u64,
}

#[tauri::command]
pub fn check_git_availability() -> CommandResult<GitRuntimeStatus> {
    let executable = ValidatedGitExecutable::discover(None).map_err(CommandError::from)?;
    Ok(GitRuntimeStatus {
        version: executable.version(),
        minimum_version: MINIMUM_GIT_VERSION,
    })
}

#[tauri::command]
pub fn detect_git_repository(
    candidate_path: String,
    sessions: State<'_, GitRepositorySessions>,
    jobs: State<'_, GitJobs>,
) -> CommandResult<crate::GitRepositorySummary> {
    let summary = sessions
        .open(PathBuf::from(candidate_path), None)
        .map_err(CommandError::from)?;
    jobs.cancel_except(&summary.session_id)
        .map_err(CommandError::from)?;
    Ok(summary)
}

#[tauri::command]
pub fn close_git_repository(
    repository_session_id: String,
    sessions: State<'_, GitRepositorySessions>,
    jobs: State<'_, GitJobs>,
) -> CommandResult<()> {
    jobs.cancel_session(&repository_session_id)
        .map_err(CommandError::from)?;
    sessions
        .close(&repository_session_id)
        .map_err(CommandError::from)
}

#[tauri::command]
pub async fn list_git_refs(
    repository_session_id: String,
    kinds: Vec<crate::GitRefKind>,
    hard_limit: usize,
    job_id: u64,
    sessions: State<'_, GitRepositorySessions>,
    jobs: State<'_, GitJobs>,
) -> CommandResult<crate::GitRefList> {
    let session = sessions
        .get(&repository_session_id)
        .map_err(CommandError::from)?
        .ok_or_else(|| CommandError::git(AppErrorCode::GitNotRepository))?;
    let lease = jobs
        .start(&repository_session_id, job_id)
        .map_err(CommandError::from)?;
    tauri::async_runtime::spawn_blocking(move || {
        list_refs(&session, &kinds, hard_limit, lease.cancellation())
    })
    .await
    .map_err(|_| CommandError::git(AppErrorCode::GitCommandFailed))?
    .map_err(CommandError::from)
}

#[tauri::command]
pub async fn list_git_tree(
    repository_session_id: String,
    commit: crate::GitObjectId,
    path_prefix: Option<GitTreePathRequest>,
    hard_limit: usize,
    job_id: u64,
    sessions: State<'_, GitRepositorySessions>,
    jobs: State<'_, GitJobs>,
) -> CommandResult<crate::GitTreeList> {
    let session = sessions
        .get(&repository_session_id)
        .map_err(CommandError::from)?
        .ok_or_else(|| CommandError::git(AppErrorCode::GitNotRepository))?;
    let lease = jobs
        .start(&repository_session_id, job_id)
        .map_err(CommandError::from)?;
    tauri::async_runtime::spawn_blocking(move || {
        let path_prefix = path_prefix
            .as_ref()
            .map(|prefix| (prefix.opaque_id.as_str(), prefix.generation));
        list_tree(
            &session,
            &commit,
            path_prefix,
            hard_limit,
            lease.cancellation(),
        )
    })
    .await
    .map_err(|_| CommandError::git(AppErrorCode::GitCommandFailed))?
    .map_err(CommandError::from)
}

#[tauri::command]
pub async fn list_git_changed_files(
    repository_session_id: String,
    request: GitChangedFilesRequest,
    job_id: u64,
    sessions: State<'_, GitRepositorySessions>,
    jobs: State<'_, GitJobs>,
) -> CommandResult<crate::GitChangedFileList> {
    let _ = request.request_generation;
    let session = sessions
        .get(&repository_session_id)
        .map_err(CommandError::from)?
        .ok_or_else(|| CommandError::git(AppErrorCode::GitNotRepository))?;
    let lease = jobs
        .start(&repository_session_id, job_id)
        .map_err(CommandError::from)?;
    tauri::async_runtime::spawn_blocking(move || {
        list_changed_files(
            &session,
            &request.left_commit,
            &request.right_commit,
            request.hard_limit,
            lease.cancellation(),
        )
    })
    .await
    .map_err(|_| CommandError::git(AppErrorCode::GitCommandFailed))?
    .map_err(CommandError::from)
}

#[tauri::command]
pub async fn read_git_status(
    repository_session_id: String,
    request: GitStatusRequest,
    job_id: u64,
    sessions: State<'_, GitRepositorySessions>,
    jobs: State<'_, GitJobs>,
) -> CommandResult<crate::GitStatusSnapshot> {
    let _ = request.request_generation;
    let session = sessions
        .get(&repository_session_id)
        .map_err(CommandError::from)?
        .ok_or_else(|| CommandError::git(AppErrorCode::GitNotRepository))?;
    let lease = jobs
        .start(&repository_session_id, job_id)
        .map_err(CommandError::from)?;
    tauri::async_runtime::spawn_blocking(move || {
        read_status(&session, request.hard_limit, lease.cancellation())
    })
    .await
    .map_err(|_| CommandError::git(AppErrorCode::GitCommandFailed))?
    .map_err(CommandError::from)
}

#[tauri::command]
pub async fn list_git_conflicts(
    repository_session_id: String,
    request: GitConflictsRequest,
    job_id: u64,
    sessions: State<'_, GitRepositorySessions>,
    jobs: State<'_, GitJobs>,
) -> CommandResult<crate::GitConflictList> {
    let _ = request.request_generation;
    let session = sessions
        .get(&repository_session_id)
        .map_err(CommandError::from)?
        .ok_or_else(|| CommandError::git(AppErrorCode::GitNotRepository))?;
    let lease = jobs
        .start(&repository_session_id, job_id)
        .map_err(CommandError::from)?;
    tauri::async_runtime::spawn_blocking(move || {
        list_conflicts(&session, request.hard_limit, lease.cancellation())
    })
    .await
    .map_err(|_| CommandError::git(AppErrorCode::GitCommandFailed))?
    .map_err(CommandError::from)
}

#[tauri::command]
pub async fn read_git_blob(
    repository_session_id: String,
    object_id: crate::GitObjectId,
    job_id: u64,
    sessions: State<'_, GitRepositorySessions>,
    jobs: State<'_, GitJobs>,
) -> CommandResult<crate::GitBlobDocument> {
    let session = sessions
        .get(&repository_session_id)
        .map_err(CommandError::from)?
        .ok_or_else(|| CommandError::git(AppErrorCode::GitNotRepository))?;
    let lease = jobs
        .start(&repository_session_id, job_id)
        .map_err(CommandError::from)?;
    tauri::async_runtime::spawn_blocking(move || {
        read_blob(&session, &object_id, lease.cancellation())
    })
    .await
    .map_err(|_| CommandError::git(AppErrorCode::GitCommandFailed))?
    .map_err(CommandError::from)
}

#[tauri::command]
pub async fn open_git_revision_compare(
    repository_session_id: String,
    request: GitRevisionCompareRequest,
    job_id: u64,
    sessions: State<'_, GitRepositorySessions>,
    jobs: State<'_, GitJobs>,
) -> CommandResult<crate::GitCompareSession> {
    let session = sessions
        .get(&repository_session_id)
        .map_err(CommandError::from)?
        .ok_or_else(|| CommandError::git(AppErrorCode::GitNotRepository))?;
    let lease = jobs
        .start(&repository_session_id, job_id)
        .map_err(CommandError::from)?;
    tauri::async_runtime::spawn_blocking(move || {
        open_revision_compare(
            &session,
            &request.left_revision,
            &request.right_revision,
            &request.changed_file,
            request.generation,
            lease.cancellation(),
        )
    })
    .await
    .map_err(|_| CommandError::git(AppErrorCode::GitCommandFailed))?
    .map_err(CommandError::from)
}

#[tauri::command]
pub async fn open_git_working_tree_compare(
    repository_session_id: String,
    request: GitWorkingTreeCompareRequest,
    job_id: u64,
    sessions: State<'_, GitRepositorySessions>,
    jobs: State<'_, GitJobs>,
) -> CommandResult<crate::GitCompareSession> {
    let session = sessions
        .get(&repository_session_id)
        .map_err(CommandError::from)?
        .ok_or_else(|| CommandError::git(AppErrorCode::GitNotRepository))?;
    let lease = jobs
        .start(&repository_session_id, job_id)
        .map_err(CommandError::from)?;
    tauri::async_runtime::spawn_blocking(move || {
        open_working_tree_compare(
            &session,
            &request.revision,
            &request.path,
            request.generation,
            lease.cancellation(),
        )
    })
    .await
    .map_err(|_| CommandError::git(AppErrorCode::GitCommandFailed))?
    .map_err(CommandError::from)
}

#[tauri::command]
pub async fn open_git_index_compare(
    repository_session_id: String,
    request: GitIndexCompareRequest,
    job_id: u64,
    sessions: State<'_, GitRepositorySessions>,
    jobs: State<'_, GitJobs>,
) -> CommandResult<crate::GitCompareSession> {
    let session = sessions
        .get(&repository_session_id)
        .map_err(CommandError::from)?
        .ok_or_else(|| CommandError::git(AppErrorCode::GitNotRepository))?;
    let lease = jobs
        .start(&repository_session_id, job_id)
        .map_err(CommandError::from)?;
    tauri::async_runtime::spawn_blocking(move || {
        let path = crate::GitPathIdentity::new(request.opaque_path_id, "", Option::<String>::None);
        open_index_compare(
            &session,
            &path,
            request.comparison,
            request.generation,
            lease.cancellation(),
        )
    })
    .await
    .map_err(|_| CommandError::git(AppErrorCode::GitCommandFailed))?
    .map_err(CommandError::from)
}

#[tauri::command]
pub async fn open_git_conflict(
    repository_session_id: String,
    request: GitConflictSessionRequest,
    job_id: u64,
    sessions: State<'_, GitRepositorySessions>,
    jobs: State<'_, GitJobs>,
) -> CommandResult<crate::GitConflictSession> {
    let session = sessions
        .get(&repository_session_id)
        .map_err(CommandError::from)?
        .ok_or_else(|| CommandError::git(AppErrorCode::GitNotRepository))?;
    let lease = jobs
        .start(&repository_session_id, job_id)
        .map_err(CommandError::from)?;
    tauri::async_runtime::spawn_blocking(move || {
        let path = crate::GitPathIdentity::new(request.opaque_path_id, "", Option::<String>::None);
        open_conflict_session(&session, &path, request.generation, lease.cancellation())
    })
    .await
    .map_err(|_| CommandError::git(AppErrorCode::GitCommandFailed))?
    .map_err(CommandError::from)
}

#[tauri::command]
pub fn cancel_git_job(
    repository_session_id: String,
    job_id: u64,
    jobs: State<'_, GitJobs>,
) -> CommandResult<()> {
    jobs.cancel(&repository_session_id, job_id)
        .map_err(CommandError::from)
}

#[tauri::command]
pub fn resolve_git_revision(
    repository_session_id: String,
    raw_revision: String,
    request_generation: u64,
    sessions: State<'_, GitRepositorySessions>,
) -> CommandResult<crate::GitRevision> {
    let _ = request_generation;
    let session = sessions
        .get(&repository_session_id)
        .map_err(CommandError::from)?
        .ok_or_else(|| CommandError::git(AppErrorCode::GitNotRepository))?;
    resolve_revision(&session, &raw_revision).map_err(CommandError::from)
}

impl From<GitExecutableError> for CommandError {
    fn from(error: GitExecutableError) -> Self {
        match error {
            GitExecutableError::NotFound
            | GitExecutableError::ConfiguredPathNotAbsolute
            | GitExecutableError::NotRegularFile
            | GitExecutableError::NotExecutable => Self::git(AppErrorCode::GitNotFound),
            GitExecutableError::InvalidVersionOutput
            | GitExecutableError::VersionTooOld { .. }
            | GitExecutableError::CapabilityUnsupported => {
                Self::git(AppErrorCode::GitVersionUnsupported)
            }
            GitExecutableError::Probe(error) => error.into(),
        }
    }
}

impl From<GitRepositoryError> for CommandError {
    fn from(error: GitRepositoryError) -> Self {
        match error {
            GitRepositoryError::Executable(error) => error.into(),
            GitRepositoryError::Runner(error) => error.into(),
            GitRepositoryError::PathUnsupported => Self::git(AppErrorCode::GitPathUnsupported),
            GitRepositoryError::NotRepository => Self::git(AppErrorCode::GitNotRepository),
            GitRepositoryError::UnsafeRepository => Self::git(AppErrorCode::GitUnsafeRepository),
            GitRepositoryError::BareUnsupported => Self::git(AppErrorCode::GitBareUnsupported),
            GitRepositoryError::InvalidOutput
            | GitRepositoryError::InvalidHead
            | GitRepositoryError::SessionStateUnavailable => {
                Self::git(AppErrorCode::GitCommandFailed)
            }
        }
    }
}

impl From<GitRevisionError> for CommandError {
    fn from(error: GitRevisionError) -> Self {
        match error {
            GitRevisionError::Runner(error) => error.into(),
            GitRevisionError::InvalidRevision => Self::git(AppErrorCode::GitInvalidRevision),
            GitRevisionError::Ambiguous { .. } => Self::git(AppErrorCode::GitAmbiguousRevision),
            GitRevisionError::ObjectMissingLocal => Self::git(AppErrorCode::GitObjectMissingLocal),
            GitRevisionError::InvalidOutput => Self::git(AppErrorCode::GitCommandFailed),
        }
    }
}

impl From<GitJobError> for CommandError {
    fn from(_error: GitJobError) -> Self {
        Self::git(AppErrorCode::GitCommandFailed)
    }
}

impl From<GitRefError> for CommandError {
    fn from(error: GitRefError) -> Self {
        match error {
            GitRefError::Runner(error) => error.into(),
            GitRefError::InvalidKinds
            | GitRefError::InvalidLimit
            | GitRefError::CommandFailed
            | GitRefError::TruncatedOutput
            | GitRefError::InvalidFieldCount
            | GitRefError::InvalidRefName
            | GitRefError::InvalidObjectId
            | GitRefError::InvalidObjectType
            | GitRefError::InvalidPeel
            | GitRefError::DuplicateRef
            | GitRefError::TooManyRecords => Self::git(AppErrorCode::GitCommandFailed),
        }
    }
}

impl From<GitTreeError> for CommandError {
    fn from(error: GitTreeError) -> Self {
        match error {
            GitTreeError::Runner(error) => error.into(),
            GitTreeError::InvalidObjectId => Self::git(AppErrorCode::GitInvalidRevision),
            GitTreeError::ObjectMissingLocal => Self::git(AppErrorCode::GitObjectMissingLocal),
            GitTreeError::InvalidObjectType | GitTreeError::InvalidMode => {
                Self::git(AppErrorCode::GitObjectTypeUnsupported)
            }
            GitTreeError::UnknownPath | GitTreeError::PathUnsupported => {
                Self::git(AppErrorCode::GitPathUnsupported)
            }
            GitTreeError::InvalidLimit
            | GitTreeError::TruncatedOutput
            | GitTreeError::InvalidHeader
            | GitTreeError::InvalidSize
            | GitTreeError::InvalidPath
            | GitTreeError::DuplicatePath
            | GitTreeError::StalePath
            | GitTreeError::StateUnavailable => Self::git(AppErrorCode::GitCommandFailed),
        }
    }
}

impl From<GitBlobError> for CommandError {
    fn from(error: GitBlobError) -> Self {
        match error {
            GitBlobError::Runner(error) => error.into(),
            GitBlobError::InvalidObjectId => Self::git(AppErrorCode::GitInvalidRevision),
            GitBlobError::ObjectMissingLocal => Self::git(AppErrorCode::GitObjectMissingLocal),
            GitBlobError::ObjectTypeUnsupported => {
                Self::git(AppErrorCode::GitObjectTypeUnsupported)
            }
            GitBlobError::InvalidOutput
            | GitBlobError::SizeMismatch { .. }
            | GitBlobError::CacheUnavailable => Self::git(AppErrorCode::GitCommandFailed),
        }
    }
}

impl From<GitChangedFilesError> for CommandError {
    fn from(error: GitChangedFilesError) -> Self {
        match error {
            GitChangedFilesError::Runner(error) => error.into(),
            GitChangedFilesError::InvalidObjectId => Self::git(AppErrorCode::GitInvalidRevision),
            GitChangedFilesError::ObjectMissingLocal => {
                Self::git(AppErrorCode::GitObjectMissingLocal)
            }
            GitChangedFilesError::OutputTooLarge => Self::git(AppErrorCode::GitOutputTooLarge),
            GitChangedFilesError::InvalidLimit
            | GitChangedFilesError::TruncatedOutput
            | GitChangedFilesError::InvalidStatus
            | GitChangedFilesError::InvalidScore
            | GitChangedFilesError::MissingPath
            | GitChangedFilesError::InvalidPath
            | GitChangedFilesError::DuplicatePath
            | GitChangedFilesError::StaleGeneration
            | GitChangedFilesError::StateUnavailable => Self::git(AppErrorCode::GitCommandFailed),
        }
    }
}

impl From<GitStatusError> for CommandError {
    fn from(error: GitStatusError) -> Self {
        match error {
            GitStatusError::Runner(error) => error.into(),
            GitStatusError::OutputTooLarge => Self::git(AppErrorCode::GitOutputTooLarge),
            GitStatusError::InvalidLimit
            | GitStatusError::CommandFailed
            | GitStatusError::TruncatedOutput
            | GitStatusError::MissingBranch
            | GitStatusError::DuplicateHeader
            | GitStatusError::InvalidHeader
            | GitStatusError::InvalidBranch
            | GitStatusError::InvalidRecord
            | GitStatusError::InvalidStatus
            | GitStatusError::InvalidSubmodule
            | GitStatusError::InvalidMode
            | GitStatusError::InvalidObjectId
            | GitStatusError::InvalidScore
            | GitStatusError::MissingPath
            | GitStatusError::InvalidPath
            | GitStatusError::StateUnavailable
            | GitStatusError::StaleGeneration => Self::git(AppErrorCode::GitCommandFailed),
        }
    }
}

impl From<GitSessionError> for CommandError {
    fn from(error: GitSessionError) -> Self {
        match error {
            GitSessionError::InvalidRevision => Self::git(AppErrorCode::GitInvalidRevision),
            GitSessionError::UnsupportedStatus => Self::git(AppErrorCode::GitObjectTypeUnsupported),
            GitSessionError::UnknownPath | GitSessionError::PathUnsupported => {
                Self::git(AppErrorCode::GitPathUnsupported)
            }
            GitSessionError::PathOutsideRoot => Self::git(AppErrorCode::GitPathOutsideRoot),
            GitSessionError::SymlinkUnsupported => Self::git(AppErrorCode::GitSymlinkUnsupported),
            GitSessionError::WorkingTreeNotRegular => {
                Self::git(AppErrorCode::GitObjectTypeUnsupported)
            }
            GitSessionError::WorkingTreePermissionDenied => {
                Self::git(AppErrorCode::PermissionDenied)
            }
            GitSessionError::WorkingTreeChanged => Self::git(AppErrorCode::FileChanged),
            GitSessionError::IndexChanged
            | GitSessionError::UnmergedIndexPath
            | GitSessionError::ConflictNotFound
            | GitSessionError::ConflictStateChanged => {
                Self::git(AppErrorCode::GitConflictStateChanged)
            }
            GitSessionError::IntentToAddUnsupported => {
                Self::git(AppErrorCode::GitObjectTypeUnsupported)
            }
            GitSessionError::PathNotAtRevision => Self::git(AppErrorCode::GitPathNotAtRevision),
            GitSessionError::Cancelled => Self::git(AppErrorCode::GitCommandCancelled),
            GitSessionError::Tree(error) => error.into(),
            GitSessionError::Blob(error) => error.into(),
            GitSessionError::Index(error) => error.into(),
            GitSessionError::InvalidChangedFile
            | GitSessionError::WorkingTreeReadFailed
            | GitSessionError::StaleGeneration
            | GitSessionError::StateUnavailable => Self::git(AppErrorCode::GitCommandFailed),
        }
    }
}

impl From<GitIndexError> for CommandError {
    fn from(error: GitIndexError) -> Self {
        match error {
            GitIndexError::Runner(error) => error.into(),
            GitIndexError::OutputTooLarge => Self::git(AppErrorCode::GitOutputTooLarge),
            GitIndexError::IndexChanged => Self::git(AppErrorCode::GitConflictStateChanged),
            GitIndexError::UnknownPath
            | GitIndexError::PathUnsupported
            | GitIndexError::InvalidPath => Self::git(AppErrorCode::GitPathUnsupported),
            GitIndexError::CommandFailed
            | GitIndexError::TruncatedOutput
            | GitIndexError::InvalidTag
            | GitIndexError::InvalidMode
            | GitIndexError::InvalidObjectId
            | GitIndexError::InvalidStage
            | GitIndexError::InvalidRecord
            | GitIndexError::TooManyRecords
            | GitIndexError::UnexpectedPath
            | GitIndexError::DuplicateStage
            | GitIndexError::UnmergedPath
            | GitIndexError::IndexUnavailable
            | GitIndexError::StateUnavailable
            | GitIndexError::StaleGeneration => Self::git(AppErrorCode::GitCommandFailed),
        }
    }
}

impl From<GitConflictError> for CommandError {
    fn from(error: GitConflictError) -> Self {
        match error {
            GitConflictError::Runner(error) => error.into(),
            GitConflictError::OutputTooLarge => Self::git(AppErrorCode::GitOutputTooLarge),
            GitConflictError::IndexChanged | GitConflictError::OperationChanged => {
                Self::git(AppErrorCode::GitConflictStateChanged)
            }
            GitConflictError::InvalidLimit
            | GitConflictError::CommandFailed
            | GitConflictError::TruncatedOutput
            | GitConflictError::InvalidRecord
            | GitConflictError::InvalidMode
            | GitConflictError::InvalidObjectId
            | GitConflictError::InvalidStage
            | GitConflictError::InvalidPath
            | GitConflictError::DuplicateStage
            | GitConflictError::StateUnavailable
            | GitConflictError::StaleGeneration
            | GitConflictError::IndexUnavailable => Self::git(AppErrorCode::GitCommandFailed),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::runner::RunnerError;
    use serde_json::json;

    #[test]
    fn serializes_runtime_status_without_exposing_the_executable_path() {
        let status = GitRuntimeStatus {
            version: GitVersion::new(2, 50, 1),
            minimum_version: MINIMUM_GIT_VERSION,
        };

        assert_eq!(
            serde_json::to_value(status).expect("serialize runtime status"),
            json!({
                "version": { "major": 2, "minor": 50, "patch": 1 },
                "minimumVersion": { "major": 2, "minor": 45, "patch": 0 },
            })
        );
    }

    #[test]
    fn maps_discovery_version_and_runner_failures_to_stable_codes() {
        let cases = [
            (GitExecutableError::NotFound, AppErrorCode::GitNotFound),
            (
                GitExecutableError::VersionTooOld {
                    found: GitVersion::new(2, 44, 0),
                    minimum: MINIMUM_GIT_VERSION,
                },
                AppErrorCode::GitVersionUnsupported,
            ),
            (
                GitExecutableError::Probe(RunnerError::TimedOut),
                AppErrorCode::GitCommandTimeout,
            ),
        ];

        for (source, expected) in cases {
            assert_eq!(CommandError::from(source).code, expected);
        }
    }

    #[test]
    fn maps_repository_failures_without_raw_git_details() {
        let cases = [
            (
                GitRepositoryError::PathUnsupported,
                AppErrorCode::GitPathUnsupported,
            ),
            (
                GitRepositoryError::NotRepository,
                AppErrorCode::GitNotRepository,
            ),
            (
                GitRepositoryError::UnsafeRepository,
                AppErrorCode::GitUnsafeRepository,
            ),
            (
                GitRepositoryError::BareUnsupported,
                AppErrorCode::GitBareUnsupported,
            ),
            (
                GitRepositoryError::InvalidOutput,
                AppErrorCode::GitCommandFailed,
            ),
        ];

        for (source, expected) in cases {
            let error = CommandError::from(source);
            assert_eq!(error.code, expected);
            assert!(!error.message.contains("stderr"));
        }
    }

    #[test]
    fn maps_revision_failures_without_localized_stderr_or_candidates() {
        let cases = [
            (
                GitRevisionError::InvalidRevision,
                AppErrorCode::GitInvalidRevision,
            ),
            (
                GitRevisionError::Ambiguous {
                    candidates: vec![
                        "refs/heads/release".to_string(),
                        "refs/tags/release".to_string(),
                    ],
                },
                AppErrorCode::GitAmbiguousRevision,
            ),
            (
                GitRevisionError::ObjectMissingLocal,
                AppErrorCode::GitObjectMissingLocal,
            ),
            (
                GitRevisionError::InvalidOutput,
                AppErrorCode::GitCommandFailed,
            ),
        ];

        for (source, expected) in cases {
            let error = CommandError::from(source);
            assert_eq!(error.code, expected);
            assert!(!error.message.contains("refs/"));
            assert!(!error.message.contains("stderr"));
        }
    }

    #[test]
    fn maps_ref_parser_and_job_failures_to_stable_non_content_errors() {
        for source in [
            GitRefError::InvalidFieldCount,
            GitRefError::InvalidRefName,
            GitRefError::DuplicateRef,
            GitRefError::TooManyRecords,
        ] {
            let error = CommandError::from(source);
            assert_eq!(error.code, AppErrorCode::GitCommandFailed);
            assert!(!error.message.contains("refname"));
        }
        assert_eq!(
            CommandError::from(GitJobError::DuplicateJob).code,
            AppErrorCode::GitCommandFailed
        );
    }

    #[test]
    fn maps_tree_failures_without_path_or_object_details() {
        let cases = [
            (
                GitTreeError::InvalidObjectId,
                AppErrorCode::GitInvalidRevision,
            ),
            (
                GitTreeError::ObjectMissingLocal,
                AppErrorCode::GitObjectMissingLocal,
            ),
            (
                GitTreeError::InvalidObjectType,
                AppErrorCode::GitObjectTypeUnsupported,
            ),
            (
                GitTreeError::PathUnsupported,
                AppErrorCode::GitPathUnsupported,
            ),
            (GitTreeError::DuplicatePath, AppErrorCode::GitCommandFailed),
        ];
        for (source, expected) in cases {
            let error = CommandError::from(source);
            assert_eq!(error.code, expected);
            assert!(!error.message.contains("object ID"));
            assert!(!error.message.contains("path bytes"));
        }
    }

    #[test]
    fn maps_blob_failures_without_backend_output_or_content() {
        let cases = [
            (
                GitBlobError::InvalidObjectId,
                AppErrorCode::GitInvalidRevision,
            ),
            (
                GitBlobError::ObjectMissingLocal,
                AppErrorCode::GitObjectMissingLocal,
            ),
            (
                GitBlobError::ObjectTypeUnsupported,
                AppErrorCode::GitObjectTypeUnsupported,
            ),
            (
                GitBlobError::SizeMismatch {
                    expected: 4,
                    actual: 3,
                },
                AppErrorCode::GitCommandFailed,
            ),
            (
                GitBlobError::CacheUnavailable,
                AppErrorCode::GitCommandFailed,
            ),
        ];
        for (source, expected) in cases {
            let error = CommandError::from(source);
            assert_eq!(error.code, expected);
            assert!(!error.message.contains("expected"));
            assert!(!error.message.contains("actual"));
        }
    }

    #[test]
    fn maps_changed_file_failures_without_status_or_path_details() {
        let cases = [
            (
                GitChangedFilesError::InvalidObjectId,
                AppErrorCode::GitInvalidRevision,
            ),
            (
                GitChangedFilesError::ObjectMissingLocal,
                AppErrorCode::GitObjectMissingLocal,
            ),
            (
                GitChangedFilesError::OutputTooLarge,
                AppErrorCode::GitOutputTooLarge,
            ),
            (
                GitChangedFilesError::DuplicatePath,
                AppErrorCode::GitCommandFailed,
            ),
        ];
        for (source, expected) in cases {
            let error = CommandError::from(source);
            assert_eq!(error.code, expected);
            assert!(!error.message.contains("R100"));
            assert!(!error.message.contains("path bytes"));
        }
    }

    #[test]
    fn maps_status_failures_without_branch_or_path_details() {
        let cases = [
            (
                GitStatusError::OutputTooLarge,
                AppErrorCode::GitOutputTooLarge,
            ),
            (
                GitStatusError::InvalidBranch,
                AppErrorCode::GitCommandFailed,
            ),
            (GitStatusError::InvalidPath, AppErrorCode::GitCommandFailed),
            (
                GitStatusError::Runner(RunnerError::Cancelled),
                AppErrorCode::GitCommandCancelled,
            ),
        ];
        for (source, expected) in cases {
            let error = CommandError::from(source);
            assert_eq!(error.code, expected);
            assert!(!error.message.contains("feature/private"));
            assert!(!error.message.contains("path bytes"));
        }
    }

    #[test]
    fn maps_compare_session_failures_to_stable_non_content_errors() {
        let cases = [
            (
                GitSessionError::InvalidRevision,
                AppErrorCode::GitInvalidRevision,
            ),
            (
                GitSessionError::PathNotAtRevision,
                AppErrorCode::GitPathNotAtRevision,
            ),
            (
                GitSessionError::UnsupportedStatus,
                AppErrorCode::GitObjectTypeUnsupported,
            ),
            (
                GitSessionError::StaleGeneration,
                AppErrorCode::GitCommandFailed,
            ),
            (
                GitSessionError::Cancelled,
                AppErrorCode::GitCommandCancelled,
            ),
            (
                GitSessionError::PathOutsideRoot,
                AppErrorCode::GitPathOutsideRoot,
            ),
            (
                GitSessionError::SymlinkUnsupported,
                AppErrorCode::GitSymlinkUnsupported,
            ),
            (
                GitSessionError::WorkingTreePermissionDenied,
                AppErrorCode::PermissionDenied,
            ),
            (
                GitSessionError::WorkingTreeChanged,
                AppErrorCode::FileChanged,
            ),
            (
                GitSessionError::IntentToAddUnsupported,
                AppErrorCode::GitObjectTypeUnsupported,
            ),
            (
                GitSessionError::UnmergedIndexPath,
                AppErrorCode::GitConflictStateChanged,
            ),
            (
                GitSessionError::IndexChanged,
                AppErrorCode::GitConflictStateChanged,
            ),
        ];
        for (source, expected) in cases {
            let error = CommandError::from(source);
            assert_eq!(error.code, expected);
            assert!(!error.message.contains("empty.txt"));
            assert!(!error.message.contains(&"a".repeat(40)));
        }
    }

    #[test]
    fn maps_conflict_discovery_failures_without_stage_or_path_details() {
        let cases = [
            (
                GitConflictError::OutputTooLarge,
                AppErrorCode::GitOutputTooLarge,
            ),
            (
                GitConflictError::Runner(RunnerError::Cancelled),
                AppErrorCode::GitCommandCancelled,
            ),
            (
                GitConflictError::IndexChanged,
                AppErrorCode::GitConflictStateChanged,
            ),
            (
                GitConflictError::DuplicateStage,
                AppErrorCode::GitCommandFailed,
            ),
        ];
        for (source, expected) in cases {
            let error = CommandError::from(source);
            assert_eq!(error.code, expected);
            assert!(!error.message.contains("conflict.txt"));
            assert!(!error.message.contains(&"a".repeat(40)));
        }
    }
}
