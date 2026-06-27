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
        ];
        let values = serde_json::to_value(codes).expect("serialize codes");

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
            ])
        );
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
