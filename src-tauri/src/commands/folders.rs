use crate::domain::models::{
    FolderCompareMode, FolderEntry, FolderEntryStatus, FolderScanOptions, FolderScanResult,
    FolderScanStats, FsEntryKind, FsEntryMeta,
};
use crate::error::{AppErrorCode, CommandError, CommandResult};
use ignore::WalkBuilder;
use std::collections::{BTreeSet, HashMap};
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::{Instant, UNIX_EPOCH};

const QUICK_HASH_CHUNK: usize = 64 * 1024;

#[derive(Debug, Clone)]
struct EntryRecord {
    path: PathBuf,
    meta: FsEntryMeta,
    error_message: Option<String>,
}

impl EntryRecord {
    fn ok(path: PathBuf, meta: FsEntryMeta) -> Self {
        Self {
            path,
            meta,
            error_message: None,
        }
    }

    fn scan_error(path: PathBuf, message: String) -> Self {
        Self {
            path,
            meta: FsEntryMeta {
                kind: FsEntryKind::Other,
                size: 0,
                modified_ms: None,
                hash: None,
            },
            error_message: Some(message),
        }
    }
}

#[tauri::command]
pub fn scan_directories(
    left_root: String,
    right_root: String,
    options: FolderScanOptions,
) -> CommandResult<FolderScanResult> {
    let started = Instant::now();
    let left_path = validate_root(&left_root, "왼쪽")?;
    let right_path = validate_root(&right_root, "오른쪽")?;

    let left_entries = collect_entries(&left_path, &options);
    let right_entries = collect_entries(&right_path, &options);
    let all_paths: BTreeSet<String> = left_entries
        .keys()
        .chain(right_entries.keys())
        .cloned()
        .collect();

    let mut entries = Vec::with_capacity(all_paths.len());
    let mut stats = FolderScanStats::default();

    for relative_path in all_paths {
        let left = left_entries.get(&relative_path);
        let right = right_entries.get(&relative_path);
        let entry = compare_entry(relative_path, left, right, options.compare_mode);
        update_stats(&mut stats, &entry.status);
        entries.push(entry);
    }

    Ok(FolderScanResult {
        left_root: left_path.to_string_lossy().into_owned(),
        right_root: right_path.to_string_lossy().into_owned(),
        entries,
        stats,
        duration_ms: started.elapsed().as_millis(),
    })
}

fn validate_root(value: &str, side: &str) -> CommandResult<PathBuf> {
    let path = PathBuf::from(value);
    let metadata = fs::metadata(&path).map_err(|error| {
        CommandError::io(
            AppErrorCode::PathConflict,
            &format!("{side} 폴더를 읽지 못했습니다"),
            error,
        )
    })?;
    if !metadata.is_dir() {
        return Err(CommandError::new(
            AppErrorCode::PathConflict,
            format!("{side} 경로가 폴더가 아닙니다."),
        ));
    }
    Ok(path)
}

fn collect_entries(root: &Path, options: &FolderScanOptions) -> HashMap<String, EntryRecord> {
    let mut builder = WalkBuilder::new(root);
    builder
        .standard_filters(false)
        .hidden(!options.include_hidden)
        .parents(options.respect_gitignore)
        .ignore(options.respect_gitignore)
        .git_ignore(options.respect_gitignore)
        .git_global(options.respect_gitignore)
        .git_exclude(options.respect_gitignore)
        .follow_links(options.follow_symlinks);

    let mut result = HashMap::new();
    for entry_result in builder.build() {
        let entry = match entry_result {
            Ok(entry) => entry,
            Err(error) => {
                let path = walk_error_path(root, result.len());
                insert_scan_error(&mut result, root, path, &error);
                continue;
            }
        };
        let path = entry.path();
        if path == root {
            continue;
        }

        let relative = relative_path(root, path);
        let metadata = match fs::symlink_metadata(path) {
            Ok(metadata) => metadata,
            Err(error) => {
                insert_scan_error(&mut result, root, path.to_path_buf(), &error);
                continue;
            }
        };
        let kind = if metadata.file_type().is_symlink() {
            FsEntryKind::Symlink
        } else if metadata.is_file() {
            FsEntryKind::File
        } else if metadata.is_dir() {
            FsEntryKind::Directory
        } else {
            FsEntryKind::Other
        };

        result.insert(
            relative,
            EntryRecord::ok(
                path.to_path_buf(),
                FsEntryMeta {
                    kind,
                    size: if metadata.is_file() {
                        metadata.len()
                    } else {
                        0
                    },
                    modified_ms: modified_ms(&metadata),
                    hash: None,
                },
            ),
        );
    }
    result
}

fn compare_entry(
    relative_path: String,
    left: Option<&EntryRecord>,
    right: Option<&EntryRecord>,
    compare_mode: FolderCompareMode,
) -> FolderEntry {
    let left_path = left.map(|entry| entry.path.to_string_lossy().into_owned());
    let right_path = right.map(|entry| entry.path.to_string_lossy().into_owned());
    let mut left_meta = left.map(|entry| entry.meta.clone());
    let mut right_meta = right.map(|entry| entry.meta.clone());

    let (status, message) = if let Some(message) = scan_error_message(left, right) {
        (FolderEntryStatus::Error, Some(message))
    } else {
        match (left, right) {
            (Some(_), None) => (FolderEntryStatus::LeftOnly, None),
            (None, Some(_)) => (FolderEntryStatus::RightOnly, None),
            (Some(left_record), Some(right_record)) => {
                if left_record.meta.kind != right_record.meta.kind {
                    (
                        FolderEntryStatus::TypeMismatch,
                        Some("양쪽 항목의 종류가 다릅니다.".to_string()),
                    )
                } else if left_record.meta.kind != FsEntryKind::File {
                    (FolderEntryStatus::Same, None)
                } else {
                    match compare_files(
                        left_record,
                        right_record,
                        compare_mode,
                        left_meta.as_mut().expect("left metadata exists"),
                        right_meta.as_mut().expect("right metadata exists"),
                    ) {
                        Ok(true) => (FolderEntryStatus::Same, None),
                        Ok(false) => (FolderEntryStatus::Different, None),
                        Err(error) => (FolderEntryStatus::Error, Some(error.message)),
                    }
                }
            }
            (None, None) => (
                FolderEntryStatus::Error,
                Some("내부 오류: 양쪽 항목이 모두 없습니다.".to_string()),
            ),
        }
    };

    FolderEntry {
        relative_path,
        left_path,
        right_path,
        left: left_meta,
        right: right_meta,
        status,
        message,
    }
}

fn scan_error_message(left: Option<&EntryRecord>, right: Option<&EntryRecord>) -> Option<String> {
    let mut messages = Vec::new();
    if let Some(message) = left.and_then(|entry| entry.error_message.as_ref()) {
        messages.push(format!("왼쪽: {message}"));
    }
    if let Some(message) = right.and_then(|entry| entry.error_message.as_ref()) {
        messages.push(format!("오른쪽: {message}"));
    }

    if messages.is_empty() {
        None
    } else {
        Some(messages.join(" / "))
    }
}

fn insert_scan_error(
    result: &mut HashMap<String, EntryRecord>,
    root: &Path,
    path: PathBuf,
    error: &dyn std::fmt::Display,
) {
    let relative = relative_path(root, &path);
    result.insert(
        relative,
        EntryRecord::scan_error(
            path,
            format!("항목을 읽지 못했습니다. 권한 또는 링크 상태를 확인하세요. ({error})"),
        ),
    );
}

fn walk_error_path(root: &Path, index: usize) -> PathBuf {
    root.join(format!("__scan_error_{}__", index + 1))
}

fn relative_path(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .ok()
        .filter(|relative| !relative.as_os_str().is_empty())
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

fn compare_files(
    left: &EntryRecord,
    right: &EntryRecord,
    compare_mode: FolderCompareMode,
    left_meta: &mut FsEntryMeta,
    right_meta: &mut FsEntryMeta,
) -> CommandResult<bool> {
    if left.meta.size != right.meta.size {
        return Ok(false);
    }

    match compare_mode {
        FolderCompareMode::Metadata => Ok(left.meta.modified_ms == right.meta.modified_ms),
        FolderCompareMode::QuickHash => {
            let left_hash = quick_hash(&left.path)?;
            let right_hash = quick_hash(&right.path)?;
            left_meta.hash = Some(left_hash.clone());
            right_meta.hash = Some(right_hash.clone());
            Ok(left_hash == right_hash)
        }
        FolderCompareMode::FullHash => {
            let left_hash = full_hash(&left.path)?;
            let right_hash = full_hash(&right.path)?;
            left_meta.hash = Some(left_hash.clone());
            right_meta.hash = Some(right_hash.clone());
            Ok(left_hash == right_hash)
        }
    }
}

fn quick_hash(path: &Path) -> CommandResult<String> {
    let mut file = fs::File::open(path).map_err(|error| {
        CommandError::io(
            AppErrorCode::ScanFailed,
            "빠른 해시를 위해 파일을 열지 못했습니다",
            error,
        )
    })?;
    let length = file
        .metadata()
        .map_err(|error| {
            CommandError::io(
                AppErrorCode::ScanFailed,
                "파일 크기를 읽지 못했습니다",
                error,
            )
        })?
        .len();
    let mut hasher = blake3::Hasher::new();
    hasher.update(&length.to_le_bytes());

    let first_length =
        usize::try_from(length.min(QUICK_HASH_CHUNK as u64)).unwrap_or(QUICK_HASH_CHUNK);
    let mut buffer = vec![0u8; first_length];
    file.read_exact(&mut buffer).map_err(|error| {
        CommandError::io(
            AppErrorCode::ScanFailed,
            "파일 앞부분을 읽지 못했습니다",
            error,
        )
    })?;
    hasher.update(&buffer);

    if length > QUICK_HASH_CHUNK as u64 {
        file.seek(SeekFrom::Start(length - QUICK_HASH_CHUNK as u64))
            .map_err(|error| {
                CommandError::io(
                    AppErrorCode::ScanFailed,
                    "파일 끝으로 이동하지 못했습니다",
                    error,
                )
            })?;
        let mut tail = vec![0u8; QUICK_HASH_CHUNK];
        file.read_exact(&mut tail).map_err(|error| {
            CommandError::io(
                AppErrorCode::ScanFailed,
                "파일 뒷부분을 읽지 못했습니다",
                error,
            )
        })?;
        hasher.update(&tail);
    }

    Ok(hasher.finalize().to_hex().to_string())
}

fn full_hash(path: &Path) -> CommandResult<String> {
    let mut file = fs::File::open(path).map_err(|error| {
        CommandError::io(
            AppErrorCode::ScanFailed,
            "전체 해시를 위해 파일을 열지 못했습니다",
            error,
        )
    })?;
    let mut hasher = blake3::Hasher::new();
    let mut buffer = [0u8; 128 * 1024];

    loop {
        let read = file.read(&mut buffer).map_err(|error| {
            CommandError::io(
                AppErrorCode::ScanFailed,
                "파일을 해시하지 못했습니다",
                error,
            )
        })?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }

    Ok(hasher.finalize().to_hex().to_string())
}

fn modified_ms(metadata: &fs::Metadata) -> Option<u64> {
    metadata
        .modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_millis() as u64)
}

fn update_stats(stats: &mut FolderScanStats, status: &FolderEntryStatus) {
    match status {
        FolderEntryStatus::Same => stats.same += 1,
        FolderEntryStatus::Different => stats.different += 1,
        FolderEntryStatus::LeftOnly => stats.left_only += 1,
        FolderEntryStatus::RightOnly => stats.right_only += 1,
        FolderEntryStatus::TypeMismatch => stats.type_mismatch += 1,
        FolderEntryStatus::Error => stats.errors += 1,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn file_meta(size: u64) -> FsEntryMeta {
        FsEntryMeta {
            kind: FsEntryKind::File,
            size,
            modified_ms: Some(1_000),
            hash: None,
        }
    }

    #[test]
    fn scan_error_record_becomes_error_entry() {
        let left = EntryRecord::scan_error(
            PathBuf::from("/left/unreadable.txt"),
            "항목을 읽지 못했습니다.".to_string(),
        );
        let right = EntryRecord::ok(PathBuf::from("/right/unreadable.txt"), file_meta(5));

        let entry = compare_entry(
            "unreadable.txt".to_string(),
            Some(&left),
            Some(&right),
            FolderCompareMode::Metadata,
        );

        assert!(matches!(&entry.status, FolderEntryStatus::Error));
        assert_eq!(entry.relative_path, "unreadable.txt");
        assert!(
            entry
                .left_path
                .as_deref()
                .expect("left path")
                .contains("unreadable.txt")
        );
        assert!(entry.right.is_some());
        assert!(entry.message.expect("message").contains("왼쪽"));

        let mut stats = FolderScanStats::default();
        update_stats(&mut stats, &entry.status);
        assert_eq!(stats.errors, 1);
    }

    #[test]
    fn insert_scan_error_preserves_relative_path() {
        let root = Path::new("root");
        let error = std::io::Error::new(std::io::ErrorKind::PermissionDenied, "permission denied");
        let mut entries = HashMap::new();

        insert_scan_error(
            &mut entries,
            root,
            PathBuf::from("root").join("nested").join("file.txt"),
            &error,
        );

        let entry = entries.get("nested/file.txt").expect("error row");
        assert!(
            entry
                .error_message
                .as_ref()
                .expect("message")
                .contains("권한")
        );
        assert!(matches!(&entry.meta.kind, FsEntryKind::Other));
    }

    #[test]
    fn walk_error_path_uses_stable_synthetic_relative_path() {
        let root = Path::new("root");

        assert_eq!(
            relative_path(root, &walk_error_path(root, 0)),
            "__scan_error_1__"
        );
        assert_eq!(
            relative_path(root, &walk_error_path(root, 3)),
            "__scan_error_4__"
        );
    }

    #[test]
    fn hash_read_failure_isolated_to_error_entry() {
        let mut right_file = tempfile::NamedTempFile::new().expect("temp file");
        right_file.write_all(b"alpha").expect("write");
        let left = EntryRecord::ok(PathBuf::from("/missing/left.txt"), file_meta(5));
        let right = EntryRecord::ok(right_file.path().to_path_buf(), file_meta(5));

        let entry = compare_entry(
            "alpha.txt".to_string(),
            Some(&left),
            Some(&right),
            FolderCompareMode::QuickHash,
        );

        assert!(matches!(&entry.status, FolderEntryStatus::Error));
        assert!(entry.message.expect("message").contains("빠른 해시"));
    }

    #[test]
    fn quick_hash_changes_when_content_changes() {
        let mut left = tempfile::NamedTempFile::new().expect("temp file");
        let mut right = tempfile::NamedTempFile::new().expect("temp file");
        left.write_all(b"alpha").expect("write");
        right.write_all(b"bravo").expect("write");
        assert_ne!(
            quick_hash(left.path()).expect("hash"),
            quick_hash(right.path()).expect("hash")
        );
    }

    #[test]
    fn full_hash_is_stable() {
        let mut file = tempfile::NamedTempFile::new().expect("temp file");
        file.write_all(b"same content").expect("write");
        assert_eq!(
            full_hash(file.path()).expect("hash"),
            full_hash(file.path()).expect("hash")
        );
    }
}
