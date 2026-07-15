use crate::domain::models::{FileBackup, FileDocument, FileVersion, WriteResult};
use crate::error::{AppErrorCode, CommandError, CommandResult};
use crate::text::{DecodedTextContent, MAX_TEXT_BYTES, decode_text_bytes};
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use tempfile::NamedTempFile;

const MAX_TEXT_FILE_BYTES: u64 = MAX_TEXT_BYTES;
const BACKUP_RETENTION_LIMIT: usize = 10;

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

    let DecodedTextContent::Text(decoded) = decode_text_bytes(&bytes) else {
        return Err(CommandError::new(
            AppErrorCode::BinaryFile,
            "선택한 파일은 텍스트로 안전하게 판별되지 않아 열지 않았습니다.",
        ));
    };

    Ok(FileDocument {
        path: path_buf.to_string_lossy().into_owned(),
        name: path_buf
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.clone()),
        line_ending: decoded.line_ending,
        had_final_newline: decoded.had_final_newline,
        text: decoded.text,
        encoding: decoded.encoding,
        size: metadata.len(),
        modified_ms: modified_ms(&metadata),
        is_binary: false,
        decode_had_errors: decoded.decode_had_errors,
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
pub fn list_file_backups(path: String) -> CommandResult<Vec<FileBackup>> {
    let target = PathBuf::from(&path);
    let parent = target.parent().unwrap_or_else(|| Path::new("."));
    if !parent.exists() {
        return Err(CommandError::new(
            AppErrorCode::PathConflict,
            "백업을 찾을 상위 폴더가 존재하지 않습니다.",
        ));
    }

    backup_entries(&target)
}

#[tauri::command]
pub fn restore_text_file_backup(
    path: String,
    backup_path: String,
    expected_size: Option<u64>,
    expected_modified_ms: Option<u64>,
) -> CommandResult<WriteResult> {
    let target = PathBuf::from(&path);
    let backup = PathBuf::from(&backup_path);
    if !is_backup_for_target(&target, &backup) {
        return Err(CommandError::new(
            AppErrorCode::PathConflict,
            "선택한 백업이 이 파일의 백업으로 확인되지 않았습니다.",
        ));
    }

    let bytes = fs::read(&backup).map_err(|error| {
        CommandError::io(
            AppErrorCode::PathConflict,
            "백업 파일을 읽지 못했습니다",
            error,
        )
    })?;
    write_bytes_file_atomic_inner(
        path,
        &bytes,
        true,
        expected_size,
        expected_modified_ms,
        |_| Ok(()),
    )
}

#[tauri::command]
pub fn write_text_file_atomic(
    path: String,
    text: String,
    create_backup: bool,
    expected_size: Option<u64>,
    expected_modified_ms: Option<u64>,
    encoding: Option<String>,
) -> CommandResult<WriteResult> {
    write_text_file_atomic_inner(
        path,
        text,
        create_backup,
        expected_size,
        expected_modified_ms,
        encoding,
        |_| Ok(()),
    )
}

fn write_text_file_atomic_inner(
    path: String,
    text: String,
    create_backup: bool,
    expected_size: Option<u64>,
    expected_modified_ms: Option<u64>,
    encoding: Option<String>,
    before_step: impl FnMut(SaveStep) -> CommandResult<()>,
) -> CommandResult<WriteResult> {
    let encoded_text = encode_text_for_save(&text, encoding.as_deref());
    write_bytes_file_atomic_inner(
        path,
        &encoded_text,
        create_backup,
        expected_size,
        expected_modified_ms,
        before_step,
    )
}

fn write_bytes_file_atomic_inner(
    path: String,
    bytes: &[u8],
    create_backup: bool,
    expected_size: Option<u64>,
    expected_modified_ms: Option<u64>,
    mut before_step: impl FnMut(SaveStep) -> CommandResult<()>,
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

    before_step(SaveStep::TempCreate)?;
    let mut temporary = NamedTempFile::new_in(parent).map_err(|error| {
        CommandError::io(
            AppErrorCode::WriteFailed,
            "임시 파일을 만들지 못했습니다",
            error,
        )
    })?;

    if let Ok(metadata) = fs::metadata(&target) {
        before_step(SaveStep::PermissionCopy)?;
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

    before_step(SaveStep::Write)?;
    temporary.write_all(bytes).map_err(|error| {
        CommandError::io(
            AppErrorCode::WriteFailed,
            "임시 파일에 쓰지 못했습니다",
            error,
        )
    })?;
    before_step(SaveStep::Flush)?;
    temporary.flush().map_err(|error| {
        CommandError::io(
            AppErrorCode::WriteFailed,
            "임시 파일을 플러시하지 못했습니다",
            error,
        )
    })?;
    before_step(SaveStep::FileSync)?;
    temporary.as_file().sync_all().map_err(|error| {
        CommandError::io(
            AppErrorCode::WriteFailed,
            "임시 파일을 디스크에 동기화하지 못했습니다",
            error,
        )
    })?;

    let backup_path = if create_backup && target.exists() {
        let backup = next_backup_path(&target)?;
        before_step(SaveStep::BackupCopy)?;
        fs::copy(&target, &backup).map_err(|error| {
            CommandError::io(
                AppErrorCode::WriteFailed,
                "백업 파일을 만들지 못했습니다",
                error,
            )
        })?;
        let _ = prune_old_backups(&target);
        Some(backup)
    } else {
        None
    };

    before_step(SaveStep::Replace)?;
    replace_target(temporary, &target)?;
    before_step(SaveStep::ParentSync)?;
    let _ = sync_parent_directory(parent);

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
        bytes_written: bytes.len(),
        size: written_metadata.len(),
        modified_ms: modified_ms(&written_metadata),
    })
}

fn encode_text_for_save(text: &str, encoding: Option<&str>) -> Vec<u8> {
    match encoding
        .unwrap_or("UTF-8")
        .trim()
        .to_ascii_uppercase()
        .as_str()
    {
        "UTF-8 BOM" => {
            let mut bytes = Vec::with_capacity(3 + text.len());
            bytes.extend_from_slice(&[0xEF, 0xBB, 0xBF]);
            bytes.extend_from_slice(text.as_bytes());
            bytes
        }
        "UTF-16LE BOM" => {
            let mut bytes = Vec::with_capacity(2 + text.len() * 2);
            bytes.extend_from_slice(&[0xFF, 0xFE]);
            for unit in text.encode_utf16() {
                bytes.extend_from_slice(&unit.to_le_bytes());
            }
            bytes
        }
        "UTF-16BE BOM" => {
            let mut bytes = Vec::with_capacity(2 + text.len() * 2);
            bytes.extend_from_slice(&[0xFE, 0xFF]);
            for unit in text.encode_utf16() {
                bytes.extend_from_slice(&unit.to_be_bytes());
            }
            bytes
        }
        _ => text.as_bytes().to_vec(),
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SaveStep {
    TempCreate,
    PermissionCopy,
    Write,
    Flush,
    FileSync,
    BackupCopy,
    Replace,
    ParentSync,
}

#[cfg(unix)]
fn sync_parent_directory(parent: &Path) -> std::io::Result<()> {
    fs::File::open(parent)?.sync_all()
}

#[cfg(not(unix))]
fn sync_parent_directory(_parent: &Path) -> std::io::Result<()> {
    Ok(())
}

/// Replace `target` with the prepared `temporary` file.
///
/// On Unix this delegates to `tempfile`'s `persist`, which is a single `rename(2)`
/// and is atomic on the same filesystem.
///
/// On Windows the situation is different: `rename` cannot overwrite an existing
/// file, so `tempfile`'s `persist` falls back to `MoveFileExW` with
/// `MOVEFILE_REPLACE_EXISTING`. That works in the common case but can fail when
/// the target is read-only, or when another process holds an exclusive handle
/// (editor, antivirus, indexer). When the target exists and is read-only we
/// temporarily clear the read-only attribute before the replace and restore the
/// original attribute on the new file afterwards, so the user never loses data
/// to a Windows permission quirk and the file's read-only intent is preserved.
/// A locked file still surfaces as `WRITE_FAILED` — that is the safe outcome,
/// because the original bytes are left untouched.
fn replace_target(temporary: NamedTempFile, target: &Path) -> CommandResult<()> {
    #[cfg(windows)]
    {
        return replace_target_windows(temporary, target);
    }

    #[cfg(not(windows))]
    {
        temporary.persist(target).map_err(|error| {
            CommandError::io(
                AppErrorCode::WriteFailed,
                "최종 파일로 교체하지 못했습니다",
                error.error,
            )
        })?;
        Ok(())
    }
}

#[cfg(windows)]
fn replace_target_windows(temporary: NamedTempFile, target: &Path) -> CommandResult<()> {
    // Snapshot the read-only flag before replacing so we can restore it on the
    // new file. If the target does not exist or attributes cannot be read we
    // treat it as not read-only and proceed with the normal replace.
    let was_readonly = target_exists_and_is_readonly(target);

    if was_readonly {
        // Clear read-only on the existing target so the replace can succeed.
        // The temp file already inherits the target's permissions earlier in
        // the pipeline, so we only need to flip this one attribute.
        if let Some(code) = clear_readonly_attribute(target) {
            return Err(CommandError::new(
                AppErrorCode::PermissionDenied,
                format!("파일이 읽기 전용입니다. 속성을 확인한 뒤 다시 저장하세요. (code {code})"),
            ));
        }
    }

    let persist_result = temporary.persist(target);
    let outcome = persist_result.map_err(|error| {
        CommandError::io(
            AppErrorCode::WriteFailed,
            "최종 파일로 교체하지 못했습니다. 파일이 다른 프로그램에서 사용 중일 수 있습니다.",
            error.error,
        )
    });

    if was_readonly && outcome.is_ok() {
        // Restore read-only on the freshly replaced file so the user's intent
        // (a read-only file) is preserved across the save.
        let _ = set_readonly_attribute(target);
    }

    outcome?;

    Ok(())
}

#[cfg(windows)]
fn target_exists_and_is_readonly(target: &Path) -> bool {
    use windows::Win32::Storage::FileSystem::{FILE_ATTRIBUTE_READONLY, GetFileAttributesW};

    let Some(wide) = to_wide_path(target) else {
        return false;
    };
    // SAFETY: GetFileAttributesW reads file metadata. The wide string is a
    // valid null-terminated UTF-16 path built from the target Path.
    let attrs = unsafe { GetFileAttributesW(windows::core::PCWSTR(wide.as_ptr())) };
    if attrs == windows::Win32::Storage::FileSystem::INVALID_FILE_ATTRIBUTES.0 {
        return false;
    }
    (attrs & FILE_ATTRIBUTE_READONLY.0) != 0
}

#[cfg(windows)]
fn clear_readonly_attribute(target: &Path) -> Option<u32> {
    use windows::Win32::Storage::FileSystem::{
        FILE_ATTRIBUTE_READONLY, GetFileAttributesW, SetFileAttributesW,
    };

    let Some(wide) = to_wide_path(target) else {
        return Some(0);
    };
    let ptr = windows::core::PCWSTR(wide.as_ptr());
    // SAFETY: GetFileAttributesW / SetFileAttributesW read/modify file
    // metadata only; no memory aliasing concerns. The path is null-terminated.
    let current = unsafe { GetFileAttributesW(ptr) };
    if current == windows::Win32::Storage::FileSystem::INVALID_FILE_ATTRIBUTES.0 {
        return Some(0);
    }
    let cleared = current & !FILE_ATTRIBUTE_READONLY.0;
    // SAFETY: as above.
    let ok = unsafe {
        SetFileAttributesW(
            ptr,
            windows::Win32::Storage::FileSystem::FILE_FLAGS_AND_ATTRIBUTES(cleared),
        )
    };
    ok.is_err().then_some(cleared)
}

#[cfg(windows)]
fn set_readonly_attribute(target: &Path) -> Option<u32> {
    use windows::Win32::Storage::FileSystem::{
        FILE_ATTRIBUTE_READONLY, GetFileAttributesW, SetFileAttributesW,
    };

    let Some(wide) = to_wide_path(target) else {
        return Some(0);
    };
    let ptr = windows::core::PCWSTR(wide.as_ptr());
    // SAFETY: same rationale as clear_readonly_attribute.
    let current = unsafe { GetFileAttributesW(ptr) };
    if current == windows::Win32::Storage::FileSystem::INVALID_FILE_ATTRIBUTES.0 {
        return Some(0);
    }
    let with_readonly = current | FILE_ATTRIBUTE_READONLY.0;
    // SAFETY: as above.
    let ok = unsafe {
        SetFileAttributesW(
            ptr,
            windows::Win32::Storage::FileSystem::FILE_FLAGS_AND_ATTRIBUTES(with_readonly),
        )
    };
    ok.is_err().then_some(with_readonly)
}

#[cfg(windows)]
fn to_wide_path(path: &Path) -> Option<Vec<u16>> {
    use std::os::windows::ffi::OsStrExt;
    let mut wide: Vec<u16> = path.as_os_str().encode_wide().collect();
    wide.push(0);
    Some(wide)
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
    let timestamp = current_timestamp_ms();
    let base = PathBuf::from(format!("{}.bak.{timestamp}", target.to_string_lossy()));

    for index in 0..10_000 {
        let candidate = if index == 0 {
            base.clone()
        } else {
            PathBuf::from(format!(
                "{}.bak.{timestamp}.{index}",
                target.to_string_lossy()
            ))
        };
        if !candidate.exists() {
            return Ok(candidate);
        }
    }

    Err(CommandError::new(
        AppErrorCode::WriteFailed,
        "사용 가능한 백업 파일 이름을 찾지 못했습니다. 오래된 백업을 정리한 뒤 다시 저장하세요.",
    ))
}

fn backup_entries(target: &Path) -> CommandResult<Vec<FileBackup>> {
    let parent = target.parent().unwrap_or_else(|| Path::new("."));
    let mut backups = fs::read_dir(parent)
        .map_err(|error| {
            CommandError::io(
                AppErrorCode::PathConflict,
                "백업 목록을 읽지 못했습니다",
                error,
            )
        })?
        .filter_map(|entry| backup_entry_from_dir_entry(target, entry.ok()?))
        .collect::<Vec<_>>();

    backups.sort_by(|left, right| {
        backup_sort_key(&right.path)
            .cmp(&backup_sort_key(&left.path))
            .then_with(|| right.modified_ms.cmp(&left.modified_ms))
            .then_with(|| right.name.cmp(&left.name))
    });
    Ok(backups)
}

fn backup_entry_from_dir_entry(target: &Path, entry: fs::DirEntry) -> Option<FileBackup> {
    let path = entry.path();
    if !is_backup_for_target(target, &path) {
        return None;
    }
    let metadata = entry.metadata().ok()?;
    if !metadata.is_file() {
        return None;
    }

    Some(FileBackup {
        path: path.to_string_lossy().into_owned(),
        name: path.file_name()?.to_string_lossy().into_owned(),
        size: metadata.len(),
        modified_ms: modified_ms(&metadata),
    })
}

fn prune_old_backups(target: &Path) -> CommandResult<()> {
    let backups = backup_entries(target)?;
    for backup in backups.into_iter().skip(BACKUP_RETENTION_LIMIT) {
        let _ = fs::remove_file(backup.path);
    }
    Ok(())
}

fn is_backup_for_target(target: &Path, backup: &Path) -> bool {
    if target.parent().unwrap_or_else(|| Path::new("."))
        != backup.parent().unwrap_or_else(|| Path::new("."))
    {
        return false;
    }

    let Some(target_name) = target.file_name().map(|name| name.to_string_lossy()) else {
        return false;
    };
    let Some(backup_name) = backup.file_name().map(|name| name.to_string_lossy()) else {
        return false;
    };
    let backup_prefix = format!("{target_name}.bak");
    backup_name == backup_prefix || backup_name.starts_with(&format!("{backup_prefix}."))
}

fn backup_sort_key(path: &str) -> u128 {
    path.rsplit(".bak.")
        .next()
        .and_then(|suffix| suffix.split('.').next())
        .and_then(|value| value.parse::<u128>().ok())
        .unwrap_or(0)
}

fn current_timestamp_ms() -> u128 {
    UNIX_EPOCH
        .elapsed()
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

fn modified_ms(metadata: &fs::Metadata) -> Option<u64> {
    metadata
        .modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_millis() as u64)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::models::LineEnding;
    use crate::text::detect_line_ending;
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
    fn shared_decoder_preserves_file_binary_bom_and_newline_semantics() {
        use crate::text::{DecodedTextContent, decode_text_bytes};

        assert_eq!(
            decode_text_bytes(b"text\0binary"),
            DecodedTextContent::Binary
        );
        let DecodedTextContent::Text(decoded) = decode_text_bytes(&[0xFF, 0xFE, b'a', 0, b'\n', 0])
        else {
            panic!("UTF-16 BOM must be text");
        };
        assert_eq!(decoded.text, "a\n");
        assert_eq!(decoded.encoding, "UTF-16LE BOM");
        assert_eq!(decoded.line_ending, LineEnding::Lf);
        assert!(decoded.had_final_newline);
        assert!(!decoded.decode_had_errors);
    }

    #[test]
    fn maps_missing_file_to_not_found_code() {
        let directory = tempfile::tempdir().expect("temp dir");
        let missing = directory.path().join("missing.txt");

        let error = read_text_file(missing.to_string_lossy().into_owned())
            .expect_err("missing file should be rejected");

        assert_eq!(error.code, AppErrorCode::NotFound);
    }

    #[test]
    fn reads_empty_text_files_without_treating_them_as_binary() {
        let file = tempfile::NamedTempFile::new().expect("temp file");

        let document = read_text_file(file.path().to_string_lossy().into_owned())
            .expect("empty file should open");

        assert_eq!(document.text, "");
        assert!(matches!(document.line_ending, LineEnding::None));
        assert!(!document.had_final_newline);
        assert!(!document.is_binary);
        assert_eq!(document.size, 0);
    }

    #[test]
    fn preserves_utf_bom_encoding_metadata_when_reading_text() {
        let mut file = tempfile::NamedTempFile::new().expect("temp file");
        file.write_all(&[0xEF, 0xBB, 0xBF, b'a', b'\n'])
            .expect("write utf8 bom text");

        let document = read_text_file(file.path().to_string_lossy().into_owned())
            .expect("utf8 bom text should open");

        assert_eq!(document.text, "a\n");
        assert_eq!(document.encoding, "UTF-8 BOM");
        assert!(document.had_final_newline);
        assert!(matches!(document.line_ending, LineEnding::Lf));
    }

    #[test]
    fn decodes_utf16le_bom_text_without_flagging_nul_bytes_as_binary() {
        let mut file = tempfile::NamedTempFile::new().expect("temp file");
        file.write_all(&[0xFF, 0xFE, b'a', 0x00, b'\n', 0x00])
            .expect("write utf16le bom text");

        let document = read_text_file(file.path().to_string_lossy().into_owned())
            .expect("utf16le bom text should open");

        assert_eq!(document.text, "a\n");
        assert_eq!(document.encoding, "UTF-16LE BOM");
        assert!(!document.decode_had_errors);
        assert!(document.had_final_newline);
    }

    #[test]
    fn reports_missing_final_newline_as_document_metadata() {
        let mut file = tempfile::NamedTempFile::new().expect("temp file");
        file.write_all(b"last line")
            .expect("write text without final newline");

        let document =
            read_text_file(file.path().to_string_lossy().into_owned()).expect("text should open");

        assert_eq!(document.text, "last line");
        assert!(!document.had_final_newline);
        assert!(matches!(document.line_ending, LineEnding::None));
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
            None,
        )
        .expect("write succeeds");

        assert_eq!(fs::read_to_string(&target).expect("read written"), "new");
        assert_eq!(result.size, 3);
        assert_eq!(result.bytes_written, 3);
        assert!(result.modified_ms.is_some());
    }

    #[test]
    fn writes_new_file_without_backup_and_syncs_parent_directory() {
        let directory = tempfile::tempdir().expect("temp dir");
        let target = directory.path().join("new-file.txt");
        let mut parent_sync_attempted = false;

        let result = write_text_file_atomic_inner(
            target.to_string_lossy().into_owned(),
            "new file\n".to_string(),
            true,
            None,
            None,
            None,
            |step| {
                if step == SaveStep::ParentSync {
                    parent_sync_attempted = true;
                }
                Ok(())
            },
        )
        .expect("write succeeds");

        assert_eq!(
            fs::read_to_string(&target).expect("read new file"),
            "new file\n"
        );
        assert_eq!(result.backup_path, None);
        assert_eq!(result.size, 9);
        assert!(parent_sync_attempted);
    }

    #[test]
    fn pre_replace_save_faults_preserve_existing_target() {
        for fault_step in [
            SaveStep::TempCreate,
            SaveStep::PermissionCopy,
            SaveStep::Write,
            SaveStep::Flush,
            SaveStep::FileSync,
            SaveStep::BackupCopy,
            SaveStep::Replace,
        ] {
            let directory = tempfile::tempdir().expect("temp dir");
            let target = directory.path().join("target.txt");
            fs::write(&target, "original").expect("write original");

            let error = write_text_file_atomic_inner(
                target.to_string_lossy().into_owned(),
                "replacement".to_string(),
                true,
                None,
                None,
                None,
                |step| {
                    if step == fault_step {
                        Err(CommandError::new(
                            AppErrorCode::WriteFailed,
                            format!("injected save fault at {step:?}"),
                        ))
                    } else {
                        Ok(())
                    }
                },
            )
            .expect_err("injected save fault should fail");

            assert_eq!(error.code, AppErrorCode::WriteFailed);
            assert_eq!(
                fs::read_to_string(&target).expect("read preserved target"),
                "original",
                "target changed after injected fault at {fault_step:?}"
            );
        }
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
            None,
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
    fn creates_timestamped_backup_without_overwriting_existing_backups() {
        let directory = tempfile::tempdir().expect("temp dir");
        let target = directory.path().join("merged.txt");

        fs::write(&target, "old").expect("write original");

        let result = write_text_file_atomic(
            target.to_string_lossy().into_owned(),
            "new".to_string(),
            true,
            None,
            None,
            None,
        )
        .expect("write succeeds");

        let backup_path = PathBuf::from(result.backup_path.expect("backup path"));
        let backup_name = backup_path
            .file_name()
            .expect("backup file name")
            .to_string_lossy();
        assert!(backup_name.starts_with("merged.txt.bak."));
        assert_eq!(
            fs::read_to_string(&backup_path).expect("read backup"),
            "old"
        );
        assert_eq!(fs::read_to_string(&target).expect("read written"), "new");
    }

    #[test]
    fn lists_backups_newest_first_and_ignores_unrelated_files() {
        let directory = tempfile::tempdir().expect("temp dir");
        let target = directory.path().join("merged.txt");
        fs::write(&target, "current").expect("write target");
        fs::write(directory.path().join("merged.txt.bak.1000"), "old").expect("write backup");
        fs::write(directory.path().join("merged.txt.bak.3000"), "new").expect("write backup");
        fs::write(directory.path().join("other.txt.bak.9999"), "other").expect("write other");

        let backups =
            list_file_backups(target.to_string_lossy().into_owned()).expect("list backups");

        assert_eq!(backups.len(), 2);
        assert_eq!(backups[0].name, "merged.txt.bak.3000");
        assert_eq!(backups[1].name, "merged.txt.bak.1000");
    }

    #[test]
    fn prunes_old_backups_after_save() {
        let directory = tempfile::tempdir().expect("temp dir");
        let target = directory.path().join("merged.txt");
        fs::write(&target, "current").expect("write target");
        for index in 0..BACKUP_RETENTION_LIMIT {
            fs::write(
                directory
                    .path()
                    .join(format!("merged.txt.bak.{}", 1000 + index)),
                format!("old {index}"),
            )
            .expect("write backup");
        }

        write_text_file_atomic(
            target.to_string_lossy().into_owned(),
            "new".to_string(),
            true,
            None,
            None,
            None,
        )
        .expect("write succeeds");

        let backups =
            list_file_backups(target.to_string_lossy().into_owned()).expect("list backups");
        assert_eq!(backups.len(), BACKUP_RETENTION_LIMIT);
        assert!(
            backups
                .iter()
                .all(|backup| backup.name != "merged.txt.bak.1000")
        );
    }

    #[test]
    fn restores_backup_through_atomic_save_and_backs_up_current_target() {
        let directory = tempfile::tempdir().expect("temp dir");
        let target = directory.path().join("merged.txt");
        let backup = directory.path().join("merged.txt.bak.1000");
        fs::write(&target, "current").expect("write target");
        let target_metadata = fs::metadata(&target).expect("target metadata");
        fs::write(&backup, "restored").expect("write backup");

        let result = restore_text_file_backup(
            target.to_string_lossy().into_owned(),
            backup.to_string_lossy().into_owned(),
            Some(target_metadata.len()),
            modified_ms(&target_metadata),
        )
        .expect("restore succeeds");

        assert_eq!(
            fs::read_to_string(&target).expect("read restored target"),
            "restored"
        );
        let current_backup = result.backup_path.expect("backup current target");
        assert_eq!(
            fs::read_to_string(current_backup).expect("read current backup"),
            "current"
        );
    }

    #[test]
    fn rejects_restore_from_unrelated_backup_path() {
        let directory = tempfile::tempdir().expect("temp dir");
        let target = directory.path().join("merged.txt");
        let unrelated = directory.path().join("other.txt.bak.1000");
        fs::write(&target, "current").expect("write target");
        fs::write(&unrelated, "other").expect("write unrelated");

        let error = restore_text_file_backup(
            target.to_string_lossy().into_owned(),
            unrelated.to_string_lossy().into_owned(),
            None,
            None,
        )
        .expect_err("unrelated backup should be rejected");

        assert_eq!(error.code, AppErrorCode::PathConflict);
        assert_eq!(fs::read_to_string(&target).expect("read target"), "current");
    }

    #[test]
    fn writes_utf8_bom_when_requested() {
        let directory = tempfile::tempdir().expect("temp dir");
        let target = directory.path().join("utf8-bom.txt");

        let result = write_text_file_atomic(
            target.to_string_lossy().into_owned(),
            "hello\n".to_string(),
            false,
            None,
            None,
            Some("UTF-8 BOM".to_string()),
        )
        .expect("write succeeds");

        assert_eq!(
            fs::read(&target).expect("read written bytes"),
            [0xEF, 0xBB, 0xBF, b'h', b'e', b'l', b'l', b'o', b'\n']
        );
        assert_eq!(result.bytes_written, 9);
        assert_eq!(result.size, 9);
    }

    #[test]
    fn writes_utf16le_bom_when_requested() {
        let directory = tempfile::tempdir().expect("temp dir");
        let target = directory.path().join("utf16le.txt");

        let result = write_text_file_atomic(
            target.to_string_lossy().into_owned(),
            "A한\n".to_string(),
            false,
            None,
            None,
            Some("UTF-16LE BOM".to_string()),
        )
        .expect("write succeeds");

        assert_eq!(
            fs::read(&target).expect("read written bytes"),
            [0xFF, 0xFE, 0x41, 0x00, 0x5C, 0xD5, 0x0A, 0x00]
        );
        assert_eq!(result.bytes_written, 8);
        assert_eq!(result.size, 8);
    }

    #[test]
    fn writes_utf16be_bom_when_requested() {
        let directory = tempfile::tempdir().expect("temp dir");
        let target = directory.path().join("utf16be.txt");

        let result = write_text_file_atomic(
            target.to_string_lossy().into_owned(),
            "A한\n".to_string(),
            false,
            None,
            None,
            Some("UTF-16BE BOM".to_string()),
        )
        .expect("write succeeds");

        assert_eq!(
            fs::read(&target).expect("read written bytes"),
            [0xFE, 0xFF, 0x00, 0x41, 0xD5, 0x5C, 0x00, 0x0A]
        );
        assert_eq!(result.bytes_written, 8);
        assert_eq!(result.size, 8);
    }

    #[test]
    fn falls_back_to_plain_utf8_for_unsupported_save_encoding() {
        let directory = tempfile::tempdir().expect("temp dir");
        let target = directory.path().join("legacy.txt");

        let result = write_text_file_atomic(
            target.to_string_lossy().into_owned(),
            "café\n".to_string(),
            false,
            None,
            None,
            Some("windows-1252".to_string()),
        )
        .expect("write succeeds");

        assert_eq!(
            fs::read(&target).expect("read written bytes"),
            "café\n".as_bytes()
        );
        assert_eq!(result.bytes_written, 6);
        assert_eq!(result.size, 6);
    }

    // ---------------------------------------------------------------------------
    // SAV-007: Windows atomic replace safety.
    //
    // These tests only compile and run on Windows. They are executed in the
    // GitHub Actions windows-2022 runner (see ci.yml). macOS/Linux cannot
    // validate the Windows ReplaceFile/MoveFileEx path that forktail ships to
    // Windows users, and the backlog explicitly forbids closing SAV-007 from a
    // non-Windows run.
    // ---------------------------------------------------------------------------

    #[cfg(windows)]
    #[test]
    fn replaces_target_atomically_on_windows() {
        let directory = tempfile::tempdir().expect("temp dir");
        let target = directory.path().join("windows-replace.txt");
        fs::write(&target, "original").expect("write original");

        write_text_file_atomic(
            target.to_string_lossy().into_owned(),
            "replacement".to_string(),
            false,
            None,
            None,
            None,
        )
        .expect("write succeeds");

        assert_eq!(
            fs::read_to_string(&target).expect("read written"),
            "replacement"
        );
    }

    #[cfg(windows)]
    #[test]
    fn preserves_target_when_locked_by_another_handle_on_windows() {
        // Open the target with a sharing mode that denies write, mimicking an
        // editor or antivirus handle. The replace must fail and the original
        // bytes must survive untouched.
        use std::os::windows::fs::OpenOptionsExt;
        use windows::Win32::Storage::FileSystem::FILE_SHARE_READ;

        let directory = tempfile::tempdir().expect("temp dir");
        let target = directory.path().join("locked.txt");
        fs::write(&target, "original").expect("write original");

        let _deny_write_handle = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(FILE_SHARE_READ.0)
            .open(&target)
            .expect("open read-only handle that denies write");

        let error = write_text_file_atomic(
            target.to_string_lossy().into_owned(),
            "replacement".to_string(),
            false,
            None,
            None,
            None,
        )
        .expect_err("replace on locked file should fail");

        assert!(
            error.code == AppErrorCode::WriteFailed,
            "expected WRITE_FAILED for locked file, got {:?}",
            error.code
        );
        assert_eq!(
            fs::read_to_string(&target).expect("read preserved target"),
            "original",
            "locked target must not be modified"
        );
        // _deny_write_handle dropped here, releasing the lock.
    }

    #[cfg(windows)]
    #[test]
    fn maps_locked_file_to_actionable_error_on_windows() {
        use std::os::windows::fs::OpenOptionsExt;
        use windows::Win32::Storage::FileSystem::FILE_SHARE_READ;

        let directory = tempfile::tempdir().expect("temp dir");
        let target = directory.path().join("locked-actionable.txt");
        fs::write(&target, "original").expect("write original");

        let _handle = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(FILE_SHARE_READ.0)
            .open(&target)
            .expect("open handle");

        let error = write_text_file_atomic(
            target.to_string_lossy().into_owned(),
            "replacement".to_string(),
            false,
            None,
            None,
            None,
        )
        .expect_err("locked file should produce an error");

        // The error message must point the user at "another program" rather
        // than emitting a raw OS code.
        assert!(
            error.message.contains("다른 프로그램") || error.message.contains("사용 중"),
            "expected actionable message about another program, got: {}",
            error.message
        );
    }

    #[cfg(windows)]
    #[test]
    fn rejects_readonly_target_with_clear_error_on_windows() {
        let directory = tempfile::tempdir().expect("temp dir");
        let target = directory.path().join("readonly.txt");
        fs::write(&target, "original").expect("write original");

        // Mark the file read-only, then try to save. forktail should clear the
        // attribute for the duration of the replace and restore it afterwards,
        // so this save actually succeeds and the file remains read-only.
        let mut perms = fs::metadata(&target).expect("metadata").permissions();
        perms.set_readonly(true);
        fs::set_permissions(&target, perms).expect("set readonly");

        let result = write_text_file_atomic(
            target.to_string_lossy().into_owned(),
            "replacement".to_string(),
            false,
            None,
            None,
            None,
        );

        // Two acceptable outcomes:
        //  1. The save succeeds AND the target is read-only again afterwards
        //     (forktail cleared + restored the attribute) — preferred path.
        //  2. The save fails with PermissionDenied AND the target is untouched.
        match result {
            Ok(result) => {
                assert_eq!(
                    fs::read_to_string(&target).expect("read written"),
                    "replacement"
                );
                assert!(
                    fs::metadata(&target)
                        .expect("metadata")
                        .permissions()
                        .readonly(),
                    "read-only flag should be restored after a successful save"
                );
                let _ = result;
            }
            Err(error) => {
                assert!(
                    error.code == AppErrorCode::PermissionDenied
                        || error.code == AppErrorCode::WriteFailed,
                    "expected PERMISSION_DENIED or WRITE_FAILED for read-only target, got {:?}",
                    error.code
                );
                assert_eq!(
                    fs::read_to_string(&target).expect("read preserved target"),
                    "original",
                    "read-only target must not be modified on failure"
                );
            }
        }

        // Restore writability so tempdir cleanup works.
        let mut perms = fs::metadata(&target).expect("metadata").permissions();
        perms.set_readonly(false);
        let _ = fs::set_permissions(&target, perms);
    }

    #[cfg(windows)]
    #[test]
    fn keeps_backup_and_target_consistent_when_replace_fails_on_windows() {
        use std::os::windows::fs::OpenOptionsExt;
        use windows::Win32::Storage::FileSystem::FILE_SHARE_READ;

        let directory = tempfile::tempdir().expect("temp dir");
        let target = directory.path().join("backup-consistency.txt");
        fs::write(&target, "original").expect("write original");

        // Lock the target so the replace step fails AFTER the backup is created.
        let _deny_write_handle = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(FILE_SHARE_READ.0)
            .open(&target)
            .expect("open deny-write handle");

        let error = write_text_file_atomic(
            target.to_string_lossy().into_owned(),
            "replacement".to_string(),
            true, // create_backup = true
            None,
            None,
            None,
        )
        .expect_err("replace should fail on locked file");

        assert!(
            error.code == AppErrorCode::WriteFailed,
            "expected WRITE_FAILED, got {:?}",
            error.code
        );

        // The original target must be byte-identical to what we started with.
        assert_eq!(
            fs::read_to_string(&target).expect("read preserved target"),
            "original",
            "target must be unchanged when replace fails"
        );

        // A backup must exist (created before the replace attempt) and contain
        // the pre-save original bytes. This is the documented SAV-007 policy:
        // a backup made before a failed replace is retained so the user can
        // recover, while the live file is never corrupted.
        let parent = target.parent().expect("parent dir");
        let backup_prefix = "backup-consistency.txt.bak.";
        let backups: Vec<_> = fs::read_dir(parent)
            .expect("read dir")
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .filter(|name| name.starts_with(backup_prefix))
            .collect();
        assert!(
            !backups.is_empty(),
            "a backup should have been created before the failed replace"
        );
        for backup_name in &backups {
            let backup_bytes = fs::read_to_string(parent.join(backup_name)).expect("read backup");
            assert_eq!(
                backup_bytes, "original",
                "backup must contain the pre-save original bytes"
            );
        }

        // Restore writability for tempdir cleanup.
        drop(_deny_write_handle);
    }

    #[cfg(windows)]
    #[test]
    fn preserves_unicode_path_target_on_windows() {
        let directory = tempfile::tempdir().expect("temp dir");
        // CJK + combining marks exercise UTF-16 path handling on Windows.
        let target = directory.path().join("비교-ファイル.txt");
        fs::write(&target, "원본").expect("write original");

        write_text_file_atomic(
            target.to_string_lossy().into_owned(),
            "새 내용".to_string(),
            false,
            None,
            None,
            None,
        )
        .expect("write succeeds");

        assert_eq!(
            fs::read_to_string(&target).expect("read written"),
            "새 내용"
        );
    }
}
