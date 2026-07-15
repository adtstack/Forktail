use crate::error::{AppErrorCode, CommandError, CommandResult};
use crate::git::executable::{
    GitExecutableError, GitVersion, MINIMUM_GIT_VERSION, ValidatedGitExecutable,
};
use crate::git::jobs::{GitJobError, GitJobs};
use crate::git::refs::{GitRefError, list_refs};
use crate::git::repository::{GitRepositoryError, GitRepositorySessions};
use crate::git::revision::{GitRevisionError, resolve_revision};
use serde::Serialize;
use std::path::PathBuf;
use tauri::State;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRuntimeStatus {
    pub version: GitVersion,
    pub minimum_version: GitVersion,
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
}
