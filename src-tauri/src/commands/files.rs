use crate::domain::models::{FileDocument, FileVersion, LineEnding, WriteResult};
use crate::error::{AppErrorCode, CommandError, CommandResult};
use chardetng::EncodingDetector;
use encoding_rs::Encoding;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use tempfile::NamedTempFile;

const MAX_TEXT_FILE_BYTES: u64 = 64 * 1024 * 1024;
const BINARY_PROBE_BYTES: usize = 16 * 1024;

#[tauri::command]
pub fn read_text_file(path: String) -> CommandResult<FileDocument> {
    let path_buf = PathBuf::from(&path);
    let metadata = fs::metadata(&path_buf).map_err(|error| {
        CommandError::io(
            AppErrorCode::PathConflict,
            "파일 메타데이터를 읽지 못했습니다",
            error,
        )
    })?;

    if !metadata.is_file() {
        return Err(CommandError::new(
            AppErrorCode::PathConflict,
            "선택한 경로가 일반 파일이 아닙니다. 다른 파일을 선택하세요.",
        ));
    }
    if metadata.len() > MAX_TEXT_FILE_BYTES {
        return Err(CommandError::new(
            AppErrorCode::TooLarge,
            format!(
                "현재 안전 한도는 {} MB입니다. 대용량 파일 모드는 후속 작업입니다.",
                MAX_TEXT_FILE_BYTES / 1024 / 1024
            ),
        ));
    }

    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    fs::File::open(&path_buf)
        .map_err(|error| {
            CommandError::io(AppErrorCode::PathConflict, "파일을 열지 못했습니다", error)
        })?
        .read_to_end(&mut bytes)
        .map_err(|error| {
            CommandError::io(AppErrorCode::PathConflict, "파일을 읽지 못했습니다", error)
        })?;

    let bom = Encoding::for_bom(&bytes);
    let is_binary = bom.is_none() && bytes.iter().take(BINARY_PROBE_BYTES).any(|byte| *byte == 0);

    if is_binary {
        return Err(CommandError::new(
            AppErrorCode::BinaryFile,
            "선택한 파일은 텍스트로 안전하게 판별되지 않아 열지 않았습니다.",
        ));
    }

    let (text, encoding, decode_had_errors) = decode_text(&bytes, bom);

    Ok(FileDocument {
        path: path_buf.to_string_lossy().into_owned(),
        name: path_buf
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.clone()),
        line_ending: detect_line_ending(&text),
        had_final_newline: text.ends_with('\n') || text.ends_with('\r'),
        text,
        encoding,
        size: metadata.len(),
        modified_ms: modified_ms(&metadata),
        is_binary,
        decode_had_errors,
    })
}

#[tauri::command]
pub fn stat_text_file_version(path: String) -> CommandResult<FileVersion> {
    let path_buf = PathBuf::from(&path);
    let metadata = fs::metadata(&path_buf).map_err(|error| {
        CommandError::io(
            AppErrorCode::PathConflict,
            "파일 메타데이터를 확인하지 못했습니다",
            error,
        )
    })?;

    if !metadata.is_file() {
        return Err(CommandError::new(
            AppErrorCode::PathConflict,
            "선택한 경로가 일반 파일이 아닙니다. 다시 열거나 다른 파일을 선택하세요.",
        ));
    }

    Ok(FileVersion {
        path: path_buf.to_string_lossy().into_owned(),
        size: metadata.len(),
        modified_ms: modified_ms(&metadata),
    })
}

#[tauri::command]
pub fn write_text_file_atomic(
    path: String,
    text: String,
    create_backup: bool,
    expected_size: Option<u64>,
    expected_modified_ms: Option<u64>,
) -> CommandResult<WriteResult> {
    let target = PathBuf::from(&path);
    let parent = target.parent().unwrap_or_else(|| Path::new("."));
    if !parent.exists() {
        return Err(CommandError::new(
            AppErrorCode::PathConflict,
            "저장할 상위 폴더가 존재하지 않습니다.",
        ));
    }

    check_write_precondition(&target, expected_size, expected_modified_ms)?;

    let backup_path = if create_backup && target.exists() {
        let backup = next_backup_path(&target)?;
        fs::copy(&target, &backup).map_err(|error| {
            CommandError::io(
                AppErrorCode::WriteFailed,
                "백업 파일을 만들지 못했습니다",
                error,
            )
        })?;
        Some(backup)
    } else {
        None
    };

    let mut temporary = NamedTempFile::new_in(parent).map_err(|error| {
        CommandError::io(
            AppErrorCode::WriteFailed,
            "임시 파일을 만들지 못했습니다",
            error,
        )
    })?;

    if let Ok(metadata) = fs::metadata(&target) {
        temporary
            .as_file()
            .set_permissions(metadata.permissions())
            .map_err(|error| {
                CommandError::io(
                    AppErrorCode::WriteFailed,
                    "기존 파일 권한을 복사하지 못했습니다",
                    error,
                )
            })?;
    }

    temporary.write_all(text.as_bytes()).map_err(|error| {
        CommandError::io(
            AppErrorCode::WriteFailed,
            "임시 파일에 쓰지 못했습니다",
            error,
        )
    })?;
    temporary.flush().map_err(|error| {
        CommandError::io(
            AppErrorCode::WriteFailed,
            "임시 파일을 플러시하지 못했습니다",
            error,
        )
    })?;
    temporary.as_file().sync_all().map_err(|error| {
        CommandError::io(
            AppErrorCode::WriteFailed,
            "임시 파일을 디스크에 동기화하지 못했습니다",
            error,
        )
    })?;

    temporary.persist(&target).map_err(|error| {
        CommandError::io(
            AppErrorCode::WriteFailed,
            "최종 파일로 교체하지 못했습니다",
            error.error,
        )
    })?;

    let written_metadata = fs::metadata(&target).map_err(|error| {
        CommandError::io(
            AppErrorCode::WriteFailed,
            "저장한 파일 메타데이터를 확인하지 못했습니다",
            error,
        )
    })?;

    Ok(WriteResult {
        path: target.to_string_lossy().into_owned(),
        backup_path: backup_path.map(|value| value.to_string_lossy().into_owned()),
        bytes_written: text.len(),
        size: written_metadata.len(),
        modified_ms: modified_ms(&written_metadata),
    })
}

fn check_write_precondition(
    target: &Path,
    expected_size: Option<u64>,
    expected_modified_ms: Option<u64>,
) -> CommandResult<()> {
    if expected_size.is_none() && expected_modified_ms.is_none() {
        return Ok(());
    }

    let metadata = fs::metadata(target).map_err(|_| {
        CommandError::new(
            AppErrorCode::FileChanged,
            "저장 대상이 열린 뒤 삭제되거나 이동됐습니다. 다시 열거나 다른 이름으로 저장하세요.",
        )
    })?;
    if !metadata.is_file() {
        return Err(CommandError::new(
            AppErrorCode::FileChanged,
            "저장 대상이 일반 파일이 아니게 변경됐습니다. 다시 열거나 다른 이름으로 저장하세요.",
        ));
    }

    if let Some(size) = expected_size {
        if metadata.len() != size {
            return Err(file_changed_error());
        }
    }
    if let Some(expected_modified) = expected_modified_ms {
        if modified_ms(&metadata) != Some(expected_modified) {
            return Err(file_changed_error());
        }
    }

    Ok(())
}

fn file_changed_error() -> CommandError {
    CommandError::new(
        AppErrorCode::FileChanged,
        "저장 대상이 열린 뒤 다른 프로그램에서 변경됐습니다. 다시 열거나 다른 이름으로 저장하세요.",
    )
}

fn next_backup_path(target: &Path) -> CommandResult<PathBuf> {
    let base = PathBuf::from(format!("{}.bak", target.to_string_lossy()));
    if !base.exists() {
        return Ok(base);
    }

    for index in 1..10_000 {
        let candidate = PathBuf::from(format!("{}.bak.{index}", target.to_string_lossy()));
        if !candidate.exists() {
            return Ok(candidate);
        }
    }

    Err(CommandError::new(
        AppErrorCode::WriteFailed,
        "사용 가능한 백업 파일 이름을 찾지 못했습니다. 오래된 백업을 정리한 뒤 다시 저장하세요.",
    ))
}

fn decode_text(bytes: &[u8], bom: Option<(&'static Encoding, usize)>) -> (String, String, bool) {
    if let Some((encoding, bom_length)) = bom {
        let (decoded, _, had_errors) = encoding.decode(&bytes[bom_length..]);
        return (
            decoded.into_owned(),
            format!("{} BOM", encoding.name()),
            had_errors,
        );
    }

    let mut detector = EncodingDetector::new();
    detector.feed(bytes, true);
    let encoding = detector.guess(None, true);
    let (decoded, _, had_errors) = encoding.decode(bytes);
    (
        decoded.into_owned(),
        encoding.name().to_string(),
        had_errors,
    )
}

fn modified_ms(metadata: &fs::Metadata) -> Option<u64> {
    metadata
        .modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_millis() as u64)
}

fn detect_line_ending(text: &str) -> LineEnding {
    if text.is_empty() {
        return LineEnding::None;
    }

    let bytes = text.as_bytes();
    let mut crlf = 0usize;
    let mut bare_lf = 0usize;
    let mut bare_cr = 0usize;
    let mut index = 0usize;

    while index < bytes.len() {
        match bytes[index] {
            b'\r' if bytes.get(index + 1) == Some(&b'\n') => {
                crlf += 1;
                index += 2;
            }
            b'\r' => {
                bare_cr += 1;
                index += 1;
            }
            b'\n' => {
                bare_lf += 1;
                index += 1;
            }
            _ => index += 1,
        }
    }

    let kinds = usize::from(crlf > 0) + usize::from(bare_lf > 0) + usize::from(bare_cr > 0);
    match (kinds, crlf > 0, bare_lf > 0, bare_cr > 0) {
        (0, _, _, _) => LineEnding::None,
        (1, true, _, _) => LineEnding::Crlf,
        (1, _, true, _) => LineEnding::Lf,
        (1, _, _, true) => LineEnding::Cr,
        _ => LineEnding::Mixed,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn detects_line_endings() {
        assert!(matches!(detect_line_ending("a\nb\n"), LineEnding::Lf));
        assert!(matches!(detect_line_ending("a\r\nb\r\n"), LineEnding::Crlf));
        assert!(matches!(detect_line_ending("a\rb\r"), LineEnding::Cr));
        assert!(matches!(detect_line_ending("a\r\nb\n"), LineEnding::Mixed));
        assert!(matches!(detect_line_ending("abc"), LineEnding::None));
    }

    #[test]
    fn rejects_binary_files_with_stable_code() {
        let mut file = tempfile::NamedTempFile::new().expect("temp file");
        file.write_all(b"text\0binary")
            .expect("write binary marker");

        let error = match read_text_file(file.path().to_string_lossy().into_owned()) {
            Ok(_) => panic!("binary file should be rejected"),
            Err(error) => error,
        };

        assert_eq!(error.code, AppErrorCode::BinaryFile);
    }

    #[test]
    fn rejects_files_above_text_size_cap_before_reading() {
        let file = tempfile::NamedTempFile::new().expect("temp file");
        file.as_file()
            .set_len(MAX_TEXT_FILE_BYTES + 1)
            .expect("set oversized length");

        let error = match read_text_file(file.path().to_string_lossy().into_owned()) {
            Ok(_) => panic!("oversized file should be rejected"),
            Err(error) => error,
        };

        assert_eq!(error.code, AppErrorCode::TooLarge);
        assert!(error.message.contains("64 MB"));
    }

    #[test]
    fn writes_with_matching_precondition_and_returns_new_version() {
        let directory = tempfile::tempdir().expect("temp dir");
        let target = directory.path().join("merged.txt");
        fs::write(&target, "old").expect("write original");
        let original_metadata = fs::metadata(&target).expect("original metadata");

        let result = write_text_file_atomic(
            target.to_string_lossy().into_owned(),
            "new".to_string(),
            false,
            Some(original_metadata.len()),
            modified_ms(&original_metadata),
        )
        .expect("write succeeds");

        assert_eq!(fs::read_to_string(&target).expect("read written"), "new");
        assert_eq!(result.size, 3);
        assert_eq!(result.bytes_written, 3);
        assert!(result.modified_ms.is_some());
    }

    #[test]
    fn rejects_changed_file_precondition_before_backup() {
        let directory = tempfile::tempdir().expect("temp dir");
        let target = directory.path().join("merged.txt");
        fs::write(&target, "old").expect("write original");
        let original_metadata = fs::metadata(&target).expect("original metadata");
        fs::write(&target, "changed outside").expect("external change");

        let error = write_text_file_atomic(
            target.to_string_lossy().into_owned(),
            "new".to_string(),
            true,
            Some(original_metadata.len()),
            modified_ms(&original_metadata),
        )
        .expect_err("changed file should be rejected");

        assert_eq!(error.code, AppErrorCode::FileChanged);
        assert_eq!(
            fs::read_to_string(&target).expect("read unchanged target"),
            "changed outside"
        );
        assert!(!PathBuf::from(format!("{}.bak", target.to_string_lossy())).exists());
    }

    #[test]
    fn creates_numbered_backup_without_overwriting_existing_backups() {
        let directory = tempfile::tempdir().expect("temp dir");
        let target = directory.path().join("merged.txt");
        let first_backup = PathBuf::from(format!("{}.bak", target.to_string_lossy()));
        let second_backup = PathBuf::from(format!("{}.bak.1", target.to_string_lossy()));
        let expected_backup = PathBuf::from(format!("{}.bak.2", target.to_string_lossy()));

        fs::write(&target, "old").expect("write original");
        fs::write(&first_backup, "previous backup").expect("write first backup");
        fs::write(&second_backup, "second backup").expect("write second backup");

        let result = write_text_file_atomic(
            target.to_string_lossy().into_owned(),
            "new".to_string(),
            true,
            None,
            None,
        )
        .expect("write succeeds");

        assert_eq!(
            result.backup_path,
            Some(expected_backup.to_string_lossy().into_owned())
        );
        assert_eq!(
            fs::read_to_string(&first_backup).expect("read first backup"),
            "previous backup"
        );
        assert_eq!(
            fs::read_to_string(&second_backup).expect("read second backup"),
            "second backup"
        );
        assert_eq!(
            fs::read_to_string(&expected_backup).expect("read expected backup"),
            "old"
        );
        assert_eq!(fs::read_to_string(&target).expect("read written"), "new");
    }
}
