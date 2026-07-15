use serde::{Deserialize, Serialize};

pub type CommandResult<T> = Result<T, CommandError>;

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AppErrorCode {
    Cancelled,
    NotFound,
    PermissionDenied,
    TooLarge,
    BinaryFile,
    UnsupportedEncoding,
    PathConflict,
    FileChanged,
    WriteFailed,
    ScanFailed,
    MergeFailed,
    GitNotFound,
    GitVersionUnsupported,
    GitCommandTimeout,
    GitCommandCancelled,
    GitOutputTooLarge,
    GitCommandFailed,
    GitNotRepository,
    GitUnsafeRepository,
    GitBareUnsupported,
    GitInvalidRevision,
    GitAmbiguousRevision,
    GitPathNotAtRevision,
    GitObjectMissingLocal,
    GitObjectTypeUnsupported,
    GitBlobTooLarge,
    GitBinaryBlob,
    GitLfsPointer,
    GitPathUnsupported,
    GitPathOutsideRoot,
    GitSymlinkUnsupported,
    GitConflictStateChanged,
    GitMultipleMergeBases,
    GitUnrelatedHistories,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    pub code: AppErrorCode,
    pub message: String,
}

impl CommandError {
    pub fn new(code: AppErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    pub fn io(default_code: AppErrorCode, context: &str, error: std::io::Error) -> Self {
        match error.kind() {
            std::io::ErrorKind::NotFound => Self::new(
                AppErrorCode::NotFound,
                format!(
                    "{context} 경로를 찾을 수 없습니다. 파일 또는 폴더가 이동됐는지 확인하세요."
                ),
            ),
            std::io::ErrorKind::PermissionDenied => Self::new(
                AppErrorCode::PermissionDenied,
                format!("{context} 권한이 없습니다. 권한을 확인한 뒤 다시 시도하세요."),
            ),
            _ => Self::new(
                default_code,
                format!(
                    "{context} 작업을 완료하지 못했습니다. 다른 경로를 선택하거나 다시 시도하세요."
                ),
            ),
        }
    }

    pub fn git(code: AppErrorCode) -> Self {
        let message = match code {
            AppErrorCode::GitNotFound => {
                "Git을 찾을 수 없습니다. Git을 설치하거나 실행 파일 설정을 확인하세요."
            }
            AppErrorCode::GitVersionUnsupported => {
                "지원하지 않는 Git 버전입니다. Git을 업데이트한 뒤 다시 시도하세요."
            }
            AppErrorCode::GitCommandTimeout => {
                "Git 작업 시간이 초과됐습니다. 저장소 상태를 확인한 뒤 다시 시도하세요."
            }
            AppErrorCode::GitCommandCancelled => "Git 작업을 취소했습니다.",
            AppErrorCode::GitOutputTooLarge => {
                "Git 결과가 안전한 처리 한도를 넘었습니다. 범위를 줄여 다시 시도하세요."
            }
            AppErrorCode::GitCommandFailed => {
                "Git 작업을 완료하지 못했습니다. 저장소 상태를 확인한 뒤 다시 시도하세요."
            }
            AppErrorCode::GitNotRepository => {
                "이 폴더는 Git 저장소가 아닙니다. 다른 폴더를 선택하거나 일반 파일 비교를 사용하세요."
            }
            AppErrorCode::GitUnsafeRepository => {
                "Git이 이 저장소의 소유권을 신뢰하지 않습니다. 저장소 소유권과 Git 설정을 확인하세요."
            }
            AppErrorCode::GitBareUnsupported => {
                "bare Git 저장소는 아직 지원하지 않습니다. worktree가 있는 저장소를 선택하세요."
            }
            AppErrorCode::GitInvalidRevision => {
                "Git revision을 찾을 수 없습니다. branch, tag, commit hash 또는 HEAD~3 형식을 확인하세요."
            }
            AppErrorCode::GitAmbiguousRevision => {
                "여러 ref 또는 object가 같은 이름과 일치합니다. full ref 이름이나 더 긴 commit hash를 사용하세요."
            }
            AppErrorCode::GitPathNotAtRevision => {
                "이 파일은 선택한 revision에 없습니다. 다른 path 또는 revision을 선택하세요."
            }
            AppErrorCode::GitObjectMissingLocal => {
                "이 snapshot은 로컬에 없습니다. Forktail은 자동 fetch하지 않습니다."
            }
            AppErrorCode::GitObjectTypeUnsupported => {
                "지원하지 않는 Git object 종류입니다. 다른 파일을 선택하세요."
            }
            AppErrorCode::GitBlobTooLarge => {
                "Git object가 너무 큽니다. 64 MiB 이하의 텍스트 object를 선택하세요."
            }
            AppErrorCode::GitBinaryBlob => {
                "이 Git object는 텍스트로 안전하게 열 수 없습니다. metadata만 표시합니다."
            }
            AppErrorCode::GitLfsPointer => {
                "이 파일은 Git LFS pointer입니다. Forktail은 LFS 내용을 자동 다운로드하지 않습니다."
            }
            AppErrorCode::GitPathUnsupported => {
                "이 Git path는 현재 운영체제에서 안전하게 열 수 없습니다. 다른 파일을 선택하세요."
            }
            AppErrorCode::GitPathOutsideRoot => {
                "선택한 path가 저장소 worktree 밖을 가리켜 열 수 없습니다."
            }
            AppErrorCode::GitSymlinkUnsupported => {
                "Git symlink 대상은 자동으로 따라가지 않습니다. 일반 파일을 선택하세요."
            }
            AppErrorCode::GitConflictStateChanged => {
                "Git 충돌 상태가 열린 뒤 변경됐습니다. 다시 불러온 뒤 저장하세요."
            }
            AppErrorCode::GitMultipleMergeBases => {
                "merge base가 여러 개라 자동 preview를 만들 수 없습니다. revision을 다시 선택하세요."
            }
            AppErrorCode::GitUnrelatedHistories => {
                "두 revision의 공통 history를 찾을 수 없습니다. 다른 revision을 선택하세요."
            }
            _ => "Git 작업을 완료하지 못했습니다. 저장소 상태를 확인한 뒤 다시 시도하세요.",
        };
        Self::new(code, message)
    }
}

impl From<crate::git::runner::RunnerError> for CommandError {
    fn from(error: crate::git::runner::RunnerError) -> Self {
        use crate::git::runner::RunnerError;

        let code = match error {
            RunnerError::InvalidExecutable | RunnerError::SpawnFailed => AppErrorCode::GitNotFound,
            RunnerError::TimedOut => AppErrorCode::GitCommandTimeout,
            RunnerError::Cancelled => AppErrorCode::GitCommandCancelled,
            RunnerError::OutputTooLarge(_) => AppErrorCode::GitOutputTooLarge,
            RunnerError::ForbiddenOperation
            | RunnerError::ProcessControlFailed
            | RunnerError::WaitFailed
            | RunnerError::StreamReadFailed(_) => AppErrorCode::GitCommandFailed,
        };
        Self::git(code)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::io::{Error, ErrorKind};

    #[test]
    fn serializes_stable_contract_shape() {
        let error = CommandError::new(AppErrorCode::TooLarge, "파일이 너무 큽니다.");
        let value = serde_json::to_value(error).expect("serialize error");

        assert_eq!(
            value,
            json!({
                "code": "TOO_LARGE",
                "message": "파일이 너무 큽니다."
            })
        );
    }

    #[test]
    fn serializes_all_error_codes_to_stable_strings() {
        let codes = [
            AppErrorCode::Cancelled,
            AppErrorCode::NotFound,
            AppErrorCode::PermissionDenied,
            AppErrorCode::TooLarge,
            AppErrorCode::BinaryFile,
            AppErrorCode::UnsupportedEncoding,
            AppErrorCode::PathConflict,
            AppErrorCode::FileChanged,
            AppErrorCode::WriteFailed,
            AppErrorCode::ScanFailed,
            AppErrorCode::MergeFailed,
            AppErrorCode::GitNotFound,
            AppErrorCode::GitVersionUnsupported,
            AppErrorCode::GitCommandTimeout,
            AppErrorCode::GitCommandCancelled,
            AppErrorCode::GitOutputTooLarge,
            AppErrorCode::GitCommandFailed,
            AppErrorCode::GitNotRepository,
            AppErrorCode::GitUnsafeRepository,
            AppErrorCode::GitBareUnsupported,
            AppErrorCode::GitInvalidRevision,
            AppErrorCode::GitAmbiguousRevision,
            AppErrorCode::GitPathNotAtRevision,
            AppErrorCode::GitObjectMissingLocal,
            AppErrorCode::GitObjectTypeUnsupported,
            AppErrorCode::GitBlobTooLarge,
            AppErrorCode::GitBinaryBlob,
            AppErrorCode::GitLfsPointer,
            AppErrorCode::GitPathUnsupported,
            AppErrorCode::GitPathOutsideRoot,
            AppErrorCode::GitSymlinkUnsupported,
            AppErrorCode::GitConflictStateChanged,
            AppErrorCode::GitMultipleMergeBases,
            AppErrorCode::GitUnrelatedHistories,
        ];
        let values = serde_json::to_value(&codes[..]).expect("serialize codes");

        assert_eq!(
            values,
            json!([
                "CANCELLED",
                "NOT_FOUND",
                "PERMISSION_DENIED",
                "TOO_LARGE",
                "BINARY_FILE",
                "UNSUPPORTED_ENCODING",
                "PATH_CONFLICT",
                "FILE_CHANGED",
                "WRITE_FAILED",
                "SCAN_FAILED",
                "MERGE_FAILED",
                "GIT_NOT_FOUND",
                "GIT_VERSION_UNSUPPORTED",
                "GIT_COMMAND_TIMEOUT",
                "GIT_COMMAND_CANCELLED",
                "GIT_OUTPUT_TOO_LARGE",
                "GIT_COMMAND_FAILED",
                "GIT_NOT_REPOSITORY",
                "GIT_UNSAFE_REPOSITORY",
                "GIT_BARE_UNSUPPORTED",
                "GIT_INVALID_REVISION",
                "GIT_AMBIGUOUS_REVISION",
                "GIT_PATH_NOT_AT_REVISION",
                "GIT_OBJECT_MISSING_LOCAL",
                "GIT_OBJECT_TYPE_UNSUPPORTED",
                "GIT_BLOB_TOO_LARGE",
                "GIT_BINARY_BLOB",
                "GIT_LFS_POINTER",
                "GIT_PATH_UNSUPPORTED",
                "GIT_PATH_OUTSIDE_ROOT",
                "GIT_SYMLINK_UNSUPPORTED",
                "GIT_CONFLICT_STATE_CHANGED",
                "GIT_MULTIPLE_MERGE_BASES",
                "GIT_UNRELATED_HISTORIES",
            ])
        );
    }

    #[test]
    fn generic_git_command_failure_has_friendly_copy_without_process_details() {
        let error = CommandError::git(AppErrorCode::GitCommandFailed);
        let value = serde_json::to_value(error).expect("serialize Git error");

        assert_eq!(
            value,
            json!({
                "code": "GIT_COMMAND_FAILED",
                "message": "Git 작업을 완료하지 못했습니다. 저장소 상태를 확인한 뒤 다시 시도하세요."
            })
        );
        assert!(!value.to_string().contains("stderr"));
        assert!(!value.to_string().contains("argv"));
    }

    #[test]
    fn maps_runner_failures_without_exposing_stream_or_process_details() {
        use crate::git::runner::{OutputStream, RunnerError};

        let cases = [
            (RunnerError::InvalidExecutable, AppErrorCode::GitNotFound),
            (RunnerError::TimedOut, AppErrorCode::GitCommandTimeout),
            (RunnerError::Cancelled, AppErrorCode::GitCommandCancelled),
            (
                RunnerError::OutputTooLarge(OutputStream::Stderr),
                AppErrorCode::GitOutputTooLarge,
            ),
            (
                RunnerError::StreamReadFailed(OutputStream::Stdout),
                AppErrorCode::GitCommandFailed,
            ),
        ];

        for (runner_error, expected_code) in cases {
            let error = CommandError::from(runner_error);
            assert_eq!(error.code, expected_code);
            assert!(!error.message.contains("stderr"));
            assert!(!error.message.contains("stdout"));
        }
    }

    #[test]
    fn maps_not_found_io_to_stable_code() {
        let error = CommandError::io(
            AppErrorCode::PathConflict,
            "파일을 읽지 못했습니다",
            Error::from(ErrorKind::NotFound),
        );

        assert_eq!(error.code, AppErrorCode::NotFound);
    }

    #[test]
    fn maps_permission_io_to_stable_code() {
        let error = CommandError::io(
            AppErrorCode::WriteFailed,
            "파일을 저장하지 못했습니다",
            Error::from(ErrorKind::PermissionDenied),
        );

        assert_eq!(error.code, AppErrorCode::PermissionDenied);
    }

    #[test]
    fn keeps_default_code_for_other_io_errors() {
        let error = CommandError::io(
            AppErrorCode::ScanFailed,
            "폴더를 스캔하지 못했습니다",
            Error::from(ErrorKind::UnexpectedEof),
        );

        assert_eq!(error.code, AppErrorCode::ScanFailed);
    }
}
