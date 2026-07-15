use crate::error::{AppErrorCode, CommandError, CommandResult};
use crate::git::executable::{
    GitExecutableError, GitVersion, MINIMUM_GIT_VERSION, ValidatedGitExecutable,
};
use serde::Serialize;

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
}
