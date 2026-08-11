use crate::domain::models::{
    FileBackup, FileDocument, FileVersion, FolderReviewSideExpectation, FolderReviewTextPair,
    FolderReviewTextPairRequest, WriteResult,
};
use crate::error::{AppErrorCode, CommandError, CommandResult};
use crate::text::{DecodedTextContent, MAX_TEXT_BYTES, decode_text_bytes};
use same_file::Handle;
use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::{
    Arc, Mutex, OnceLock,
    atomic::{AtomicBool, Ordering},
};
use std::time::UNIX_EPOCH;
use tempfile::NamedTempFile;

const MAX_TEXT_FILE_BYTES: u64 = MAX_TEXT_BYTES;
const BACKUP_RETENTION_LIMIT: usize = 10;
const FOLDER_REVIEW_READ_CHUNK: usize = 64 * 1024;
const GIT_LFS_POINTER_SIGNATURE: &[u8] = b"version https://git-lfs.github.com/spec/v1";
static FOLDER_REVIEW_TEXT_READ_JOBS: OnceLock<Mutex<HashMap<u64, Arc<AtomicBool>>>> =
    OnceLock::new();

struct FolderReviewTextReadJob {
    job_id: u64,
    cancelled: Arc<AtomicBool>,
}

impl FolderReviewTextReadJob {
    fn register(job_id: u64) -> CommandResult<Self> {
        let mut jobs = folder_review_text_read_jobs()
            .lock()
            .expect("folder review text read job lock");
        if jobs.contains_key(&job_id) {
            return Err(CommandError::new(
                AppErrorCode::PathConflict,
                "같은 폴더 검토 읽기 작업이 이미 진행 중입니다.",
            ));
        }
        let cancelled = Arc::new(AtomicBool::new(false));
        jobs.insert(job_id, Arc::clone(&cancelled));
        Ok(Self { job_id, cancelled })
    }
}

impl Drop for FolderReviewTextReadJob {
    fn drop(&mut self) {
        folder_review_text_read_jobs()
            .lock()
            .expect("folder review text read job lock")
            .remove(&self.job_id);
    }
}

fn folder_review_text_read_jobs() -> &'static Mutex<HashMap<u64, Arc<AtomicBool>>> {
    FOLDER_REVIEW_TEXT_READ_JOBS.get_or_init(|| Mutex::new(HashMap::new()))
}

#[tauri::command]
pub fn read_text_file(path: String) -> CommandResult<FileDocument> {
    read_text_file_with_limit_and_hook(path, MAX_TEXT_FILE_BYTES, |_| Ok(()))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TextReadHook {
    AfterPreflight,
    BeforeRead,
    AfterChunk,
    AfterRead,
    BeforePathReopen,
}

#[derive(Debug)]
pub(crate) struct StableOpenedFile {
    path: PathBuf,
    file: fs::File,
    metadata: fs::Metadata,
    identity: Handle,
}

#[derive(Debug)]
struct StableFileSnapshot {
    path: PathBuf,
    bytes: Vec<u8>,
    metadata: fs::Metadata,
    identity: Handle,
}

fn read_text_file_with_limit_and_hook(
    path: String,
    max_bytes: u64,
    mut on_step: impl FnMut(TextReadHook) -> std::io::Result<()>,
) -> CommandResult<FileDocument> {
    let path_buf = PathBuf::from(&path);
    let snapshot =
        read_stable_file_snapshot_with_hook(&path_buf, max_bytes, || Ok(()), &mut on_step)?;

    let DecodedTextContent::Text(decoded) = decode_text_bytes(&snapshot.bytes) else {
        return Err(CommandError::new(
            AppErrorCode::BinaryFile,
            "선택한 파일은 텍스트로 안전하게 판별되지 않아 열지 않았습니다.",
        ));
    };
    let content_hash = blake3::hash(&snapshot.bytes).to_hex().to_string();

    Ok(FileDocument {
        path: snapshot.path.to_string_lossy().into_owned(),
        name: snapshot
            .path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.clone()),
        line_ending: decoded.line_ending,
        had_final_newline: decoded.had_final_newline,
        text: decoded.text,
        encoding: decoded.encoding,
        size: snapshot.metadata.len(),
        modified_ms: modified_ms(&snapshot.metadata),
        content_hash,
        is_binary: false,
        decode_had_errors: decoded.decode_had_errors,
    })
}

fn read_stable_file_snapshot_with_hook(
    path: &Path,
    max_bytes: u64,
    mut check_cancelled: impl FnMut() -> CommandResult<()>,
    on_step: &mut impl FnMut(TextReadHook) -> std::io::Result<()>,
) -> CommandResult<StableFileSnapshot> {
    let opened = open_stable_file_with_hook(path, max_bytes, on_step)?;
    read_opened_stable_file_with_hook(opened, max_bytes, &mut check_cancelled, on_step)
}

fn open_stable_file_with_hook(
    path: &Path,
    max_bytes: u64,
    on_step: &mut impl FnMut(TextReadHook) -> std::io::Result<()>,
) -> CommandResult<StableOpenedFile> {
    let preflight = fs::symlink_metadata(path).map_err(|error| {
        CommandError::io(
            AppErrorCode::PathConflict,
            "파일 메타데이터를 읽지 못했습니다",
            error,
        )
    })?;

    if preflight.file_type().is_symlink() || !preflight.is_file() {
        return Err(CommandError::new(
            AppErrorCode::PathConflict,
            "선택한 경로가 일반 파일이 아닙니다. 다른 파일을 선택하세요.",
        ));
    }
    if preflight.len() > max_bytes {
        return Err(text_file_too_large_error(max_bytes));
    }
    on_step(TextReadHook::AfterPreflight).map_err(|error| {
        CommandError::io(
            AppErrorCode::PathConflict,
            "파일 안전 검사를 완료하지 못했습니다",
            error,
        )
    })?;

    let options = stable_read_open_options();
    let file = options.open(path).map_err(|error| {
        CommandError::io(
            AppErrorCode::PathConflict,
            "파일을 안전하게 열지 못했습니다",
            error,
        )
    })?;
    let opened_metadata = file.metadata().map_err(|error| {
        CommandError::io(
            AppErrorCode::PathConflict,
            "열린 파일 메타데이터를 확인하지 못했습니다",
            error,
        )
    })?;
    if opened_metadata.file_type().is_symlink() || !opened_metadata.is_file() {
        return Err(CommandError::new(
            AppErrorCode::PathConflict,
            "선택한 경로가 일반 파일이 아닙니다. 다른 파일을 선택하세요.",
        ));
    }
    if opened_metadata.len() > max_bytes {
        return Err(text_file_too_large_error(max_bytes));
    }
    if !stable_metadata_matches(&preflight, &opened_metadata) {
        return Err(text_file_changed_during_read_error());
    }
    let identity = Handle::from_file(file.try_clone().map_err(|error| {
        CommandError::io(
            AppErrorCode::PathConflict,
            "열린 파일 handle을 복제하지 못했습니다",
            error,
        )
    })?)
    .map_err(|error| {
        CommandError::io(
            AppErrorCode::PathConflict,
            "열린 파일 identity를 확인하지 못했습니다",
            error,
        )
    })?;

    Ok(StableOpenedFile {
        path: path.to_path_buf(),
        file,
        metadata: opened_metadata,
        identity,
    })
}

fn read_opened_stable_file_with_hook(
    mut opened: StableOpenedFile,
    max_bytes: u64,
    check_cancelled: &mut impl FnMut() -> CommandResult<()>,
    on_step: &mut impl FnMut(TextReadHook) -> std::io::Result<()>,
) -> CommandResult<StableFileSnapshot> {
    check_cancelled()?;
    on_step(TextReadHook::BeforeRead).map_err(|error| {
        CommandError::io(
            AppErrorCode::PathConflict,
            "파일 읽기를 준비하지 못했습니다",
            error,
        )
    })?;

    let capacity =
        usize::try_from(opened.metadata.len()).map_err(|_| text_file_too_large_error(max_bytes))?;
    let read_limit = max_bytes
        .checked_add(1)
        .ok_or_else(|| text_file_too_large_error(max_bytes))?;
    let mut bytes = Vec::with_capacity(capacity);
    {
        let mut bounded = (&mut opened.file).take(read_limit);
        let mut chunk = [0_u8; FOLDER_REVIEW_READ_CHUNK];
        loop {
            check_cancelled()?;
            let read = bounded.read(&mut chunk).map_err(|error| {
                CommandError::io(AppErrorCode::PathConflict, "파일을 읽지 못했습니다", error)
            })?;
            if read == 0 {
                break;
            }
            bytes.extend_from_slice(&chunk[..read]);
            on_step(TextReadHook::AfterChunk).map_err(|error| {
                CommandError::io(
                    AppErrorCode::PathConflict,
                    "파일 읽기 상태를 확인하지 못했습니다",
                    error,
                )
            })?;
        }
    }
    if bytes.len() as u64 > max_bytes {
        return Err(text_file_too_large_error(max_bytes));
    }
    check_cancelled()?;
    on_step(TextReadHook::AfterRead).map_err(|error| {
        CommandError::io(
            AppErrorCode::PathConflict,
            "파일 읽기 결과를 확인하지 못했습니다",
            error,
        )
    })?;

    let final_metadata = opened.file.metadata().map_err(|error| {
        CommandError::io(
            AppErrorCode::PathConflict,
            "읽은 파일 메타데이터를 다시 확인하지 못했습니다",
            error,
        )
    })?;
    if final_metadata.len() > max_bytes {
        return Err(text_file_too_large_error(max_bytes));
    }
    if !final_metadata.is_file()
        || bytes.len() as u64 != final_metadata.len()
        || !stable_metadata_matches(&opened.metadata, &final_metadata)
    {
        return Err(text_file_changed_during_read_error());
    }

    on_step(TextReadHook::BeforePathReopen).map_err(|error| {
        CommandError::io(
            AppErrorCode::PathConflict,
            "파일 경로를 다시 확인하지 못했습니다",
            error,
        )
    })?;
    check_cancelled()?;
    let options = stable_read_open_options();
    let current_path_file = options
        .open(&opened.path)
        .map_err(|_| text_file_changed_during_read_error())?;
    let current_metadata = current_path_file
        .metadata()
        .map_err(|_| text_file_changed_during_read_error())?;
    if current_metadata.file_type().is_symlink()
        || !current_metadata.is_file()
        || current_metadata.len() > max_bytes
        || !stable_metadata_matches(&current_metadata, &final_metadata)
    {
        return Err(text_file_changed_during_read_error());
    }
    let current_handle = Handle::from_file(current_path_file).map_err(|error| {
        CommandError::io(
            AppErrorCode::PathConflict,
            "선택한 파일 identity를 다시 확인하지 못했습니다",
            error,
        )
    })?;
    if opened.identity != current_handle {
        return Err(text_file_changed_during_read_error());
    }

    Ok(StableFileSnapshot {
        path: opened.path,
        bytes,
        metadata: final_metadata,
        identity: opened.identity,
    })
}

fn stable_read_open_options() -> fs::OpenOptions {
    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        use windows::Win32::Storage::FileSystem::FILE_FLAG_OPEN_REPARSE_POINT;
        options.custom_flags(FILE_FLAG_OPEN_REPARSE_POINT.0);
    }
    options
}

fn stable_metadata_matches(left: &fs::Metadata, right: &fs::Metadata) -> bool {
    left.len() == right.len() && left.modified().ok() == right.modified().ok()
}

fn text_file_too_large_error(max_bytes: u64) -> CommandError {
    CommandError::new(
        AppErrorCode::TooLarge,
        format!(
            "현재 안전 한도는 {} MB입니다. 대용량 파일 모드는 후속 작업입니다.",
            max_bytes / 1024 / 1024
        ),
    )
}

fn text_file_changed_during_read_error() -> CommandError {
    CommandError::new(
        AppErrorCode::FileChanged,
        "파일을 읽는 동안 다른 프로그램에서 변경됐습니다. 다시 열어 주세요.",
    )
}

#[tauri::command]
pub async fn read_folder_review_text_pair(
    request: FolderReviewTextPairRequest,
    job_id: u64,
) -> CommandResult<FolderReviewTextPair> {
    tauri::async_runtime::spawn_blocking(move || {
        read_folder_review_text_pair_blocking(request, job_id)
    })
    .await
    .map_err(|_| {
        CommandError::new(
            AppErrorCode::ScanFailed,
            "폴더 검토 파일 읽기 worker를 완료하지 못했습니다.",
        )
    })?
}

fn read_folder_review_text_pair_blocking(
    request: FolderReviewTextPairRequest,
    job_id: u64,
) -> CommandResult<FolderReviewTextPair> {
    let job = FolderReviewTextReadJob::register(job_id)?;
    read_folder_review_text_pair_service(request, &job.cancelled)
}

#[tauri::command]
pub fn cancel_folder_review_text_read(job_id: u64) -> CommandResult<()> {
    let cancelled = folder_review_text_read_jobs()
        .lock()
        .expect("folder review text read job lock")
        .get(&job_id)
        .cloned();
    if let Some(cancelled) = cancelled {
        cancelled.store(true, Ordering::Release);
    }
    Ok(())
}

pub(crate) enum ValidatedFolderReviewSide {
    Regular { opened: Box<StableOpenedFile> },
    Missing,
}

pub(crate) struct ValidatedFolderReviewTextPair {
    left_root: PathBuf,
    right_root: PathBuf,
    relative: PathBuf,
    left_expected: FolderReviewSideExpectation,
    right_expected: FolderReviewSideExpectation,
    left: ValidatedFolderReviewSide,
    right: ValidatedFolderReviewSide,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct FolderReviewObservedVersions {
    pub(crate) left: Option<(u64, Option<u64>)>,
    pub(crate) right: Option<(u64, Option<u64>)>,
}

impl ValidatedFolderReviewTextPair {
    pub(crate) fn source_bytes(&self) -> CommandResult<u64> {
        observed_side_size(&self.left)
            .checked_add(observed_side_size(&self.right))
            .ok_or_else(|| {
                CommandError::new(
                    AppErrorCode::TooLarge,
                    "폴더 검토 파일 쌍의 크기를 안전하게 계산할 수 없습니다.",
                )
            })
    }

    pub(crate) fn observed_versions(&self) -> FolderReviewObservedVersions {
        FolderReviewObservedVersions {
            left: observed_side_version(&self.left),
            right: observed_side_version(&self.right),
        }
    }
}

pub(crate) fn read_folder_review_text_pair_service(
    request: FolderReviewTextPairRequest,
    cancelled: &AtomicBool,
) -> CommandResult<FolderReviewTextPair> {
    let validated = validate_folder_review_text_pair(&request, cancelled)?;
    read_validated_folder_review_text_pair(validated, cancelled)
}

#[cfg(test)]
fn read_folder_review_text_pair_inner(
    request: FolderReviewTextPairRequest,
    cancelled: &AtomicBool,
) -> CommandResult<FolderReviewTextPair> {
    read_folder_review_text_pair_service(request, cancelled)
}

pub(crate) fn validate_folder_review_text_pair(
    request: &FolderReviewTextPairRequest,
    cancelled: &AtomicBool,
) -> CommandResult<ValidatedFolderReviewTextPair> {
    check_folder_review_read_cancelled(cancelled)?;
    let relative = validate_folder_review_relative_path(&request.relative_path)?;
    if request.left_expected == FolderReviewSideExpectation::Missing
        && request.right_expected == FolderReviewSideExpectation::Missing
    {
        return Err(CommandError::new(
            AppErrorCode::PathConflict,
            "폴더 검토 항목의 양쪽 파일이 모두 없는 상태는 열 수 없습니다.",
        ));
    }

    let left_root = canonical_folder_review_root(&request.left_root)?;
    let right_root = canonical_folder_review_root(&request.right_root)?;
    let left = validate_folder_review_side(&left_root, &relative, request.left_expected)?;
    let right = validate_folder_review_side(&right_root, &relative, request.right_expected)?;
    check_folder_review_read_cancelled(cancelled)?;

    Ok(ValidatedFolderReviewTextPair {
        left_root,
        right_root,
        relative,
        left_expected: request.left_expected,
        right_expected: request.right_expected,
        left,
        right,
    })
}

pub(crate) fn read_validated_folder_review_text_pair(
    validated: ValidatedFolderReviewTextPair,
    cancelled: &AtomicBool,
) -> CommandResult<FolderReviewTextPair> {
    read_validated_folder_review_text_pair_with_hook(validated, cancelled, |_, _| Ok(()))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FolderReviewPairSide {
    Left,
    Right,
}

fn read_validated_folder_review_text_pair_with_hook(
    validated: ValidatedFolderReviewTextPair,
    cancelled: &AtomicBool,
    mut on_step: impl FnMut(FolderReviewPairSide, TextReadHook) -> std::io::Result<()>,
) -> CommandResult<FolderReviewTextPair> {
    let observed_versions = validated.observed_versions();
    let left = read_validated_folder_review_side_snapshot(
        validated.left,
        cancelled,
        FolderReviewPairSide::Left,
        &mut on_step,
    )?;
    check_folder_review_read_cancelled(cancelled)?;
    let right = read_validated_folder_review_side_snapshot(
        validated.right,
        cancelled,
        FolderReviewPairSide::Right,
        &mut on_step,
    )?;
    check_folder_review_read_cancelled(cancelled)?;
    let final_left = validate_folder_review_side(
        &validated.left_root,
        &validated.relative,
        validated.left_expected,
    )?;
    let final_right = validate_folder_review_side(
        &validated.right_root,
        &validated.relative,
        validated.right_expected,
    )?;
    if observed_versions
        != (FolderReviewObservedVersions {
            left: observed_side_version(&final_left),
            right: observed_side_version(&final_right),
        })
    {
        return Err(CommandError::new(
            AppErrorCode::FileChanged,
            "폴더 검토 파일이 읽는 동안 변경됐습니다. 다시 시도하세요.",
        ));
    }

    verify_folder_review_side_snapshot(
        final_left,
        left.as_ref(),
        cancelled,
        FolderReviewPairSide::Left,
        &mut on_step,
    )?;
    verify_folder_review_side_snapshot(
        final_right,
        right.as_ref(),
        cancelled,
        FolderReviewPairSide::Right,
        &mut on_step,
    )?;
    check_folder_review_read_cancelled(cancelled)?;

    Ok(FolderReviewTextPair {
        left: left.map(folder_review_document_from_snapshot).transpose()?,
        right: right
            .map(folder_review_document_from_snapshot)
            .transpose()?,
    })
}

fn observed_side_size(side: &ValidatedFolderReviewSide) -> u64 {
    match side {
        ValidatedFolderReviewSide::Regular { opened } => opened.metadata.len(),
        ValidatedFolderReviewSide::Missing => 0,
    }
}

fn observed_side_version(side: &ValidatedFolderReviewSide) -> Option<(u64, Option<u64>)> {
    match side {
        ValidatedFolderReviewSide::Regular { opened } => {
            Some((opened.metadata.len(), modified_ms(&opened.metadata)))
        }
        ValidatedFolderReviewSide::Missing => None,
    }
}

fn validate_folder_review_relative_path(value: &str) -> CommandResult<PathBuf> {
    if value.is_empty()
        || value.starts_with('/')
        || value.starts_with('\\')
        || value.as_bytes().get(1) == Some(&b':')
        || value
            .split(['/', '\\'])
            .any(|segment| segment.is_empty() || segment == "." || segment == "..")
    {
        return Err(CommandError::new(
            AppErrorCode::PathConflict,
            "폴더 검토 항목의 상대 경로가 안전하지 않습니다.",
        ));
    }
    let path = PathBuf::from(value);
    if path.is_absolute()
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(CommandError::new(
            AppErrorCode::PathConflict,
            "폴더 검토 항목의 상대 경로가 안전하지 않습니다.",
        ));
    }
    Ok(path)
}

fn canonical_folder_review_root(value: &str) -> CommandResult<PathBuf> {
    let root = PathBuf::from(value);
    let metadata = fs::metadata(&root).map_err(|error| {
        CommandError::io(
            AppErrorCode::PathConflict,
            "폴더 검토 루트를 확인하지 못했습니다",
            error,
        )
    })?;
    if !metadata.is_dir() {
        return Err(CommandError::new(
            AppErrorCode::PathConflict,
            "폴더 검토 루트가 폴더가 아닙니다.",
        ));
    }
    fs::canonicalize(root).map_err(|error| {
        CommandError::io(
            AppErrorCode::PathConflict,
            "폴더 검토 루트의 실제 위치를 확인하지 못했습니다",
            error,
        )
    })
}

fn validate_folder_review_side(
    canonical_root: &Path,
    relative: &Path,
    expected: FolderReviewSideExpectation,
) -> CommandResult<ValidatedFolderReviewSide> {
    let candidate = canonical_root.join(relative);
    match (expected, fs::symlink_metadata(&candidate)) {
        (FolderReviewSideExpectation::Missing, Err(error))
            if error.kind() == std::io::ErrorKind::NotFound =>
        {
            ensure_existing_parent_contained(canonical_root, &candidate)?;
            Ok(ValidatedFolderReviewSide::Missing)
        }
        (FolderReviewSideExpectation::Missing, Ok(_)) => Err(folder_review_side_changed()),
        (FolderReviewSideExpectation::Missing, Err(error)) => Err(CommandError::io(
            AppErrorCode::FileChanged,
            "없어야 하는 폴더 검토 항목을 확인하지 못했습니다",
            error,
        )),
        (FolderReviewSideExpectation::RegularFile, Err(error)) => Err(CommandError::io(
            AppErrorCode::FileChanged,
            "폴더 검토 파일 상태가 스캔 뒤 변경됐습니다",
            error,
        )),
        (FolderReviewSideExpectation::RegularFile, Ok(metadata)) => {
            if metadata.file_type().is_symlink() || !metadata.is_file() {
                return Err(folder_review_side_changed());
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
            let parent = candidate.parent().ok_or_else(|| {
                CommandError::new(
                    AppErrorCode::PathConflict,
                    "폴더 검토 파일의 상위 폴더를 확인하지 못했습니다.",
                )
            })?;
            let canonical_parent = fs::canonicalize(parent).map_err(|error| {
                CommandError::io(
                    AppErrorCode::FileChanged,
                    "폴더 검토 파일 상위 폴더의 실제 위치를 확인하지 못했습니다",
                    error,
                )
            })?;
            if !canonical_parent.starts_with(canonical_root) {
                return Err(CommandError::new(
                    AppErrorCode::PathConflict,
                    "폴더 검토 파일이 선택한 루트 밖을 가리켜 열지 않았습니다.",
                ));
            }
            let file_name = candidate.file_name().ok_or_else(|| {
                CommandError::new(
                    AppErrorCode::PathConflict,
                    "폴더 검토 파일 이름을 안전하게 확인하지 못했습니다.",
                )
            })?;
            let contained_candidate = canonical_parent.join(file_name);
            let mut no_hook = |_| Ok(());
            let opened =
                open_stable_file_with_hook(&contained_candidate, MAX_TEXT_FILE_BYTES, &mut no_hook)
                    .map_err(folder_review_stable_read_error)?;
            if !stable_metadata_matches(&metadata, &opened.metadata) {
                return Err(folder_review_side_changed());
            }
            Ok(ValidatedFolderReviewSide::Regular {
                opened: Box::new(opened),
            })
        }
    }
}

fn ensure_existing_parent_contained(canonical_root: &Path, candidate: &Path) -> CommandResult<()> {
    let mut ancestor = candidate.parent();
    while let Some(path) = ancestor {
        match fs::canonicalize(path) {
            Ok(canonical_parent) => {
                return if canonical_parent.starts_with(canonical_root) {
                    Ok(())
                } else {
                    Err(CommandError::new(
                        AppErrorCode::PathConflict,
                        "폴더 검토 항목이 선택한 루트 밖을 가리켜 열지 않았습니다.",
                    ))
                };
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                ancestor = path.parent();
            }
            Err(error) => {
                return Err(CommandError::io(
                    AppErrorCode::PathConflict,
                    "폴더 검토 항목의 상위 폴더를 확인하지 못했습니다",
                    error,
                ));
            }
        }
    }
    Err(CommandError::new(
        AppErrorCode::PathConflict,
        "폴더 검토 항목의 루트 포함 여부를 확인하지 못했습니다.",
    ))
}

#[cfg(test)]
fn read_validated_folder_review_side_with_chunk_hook(
    side: ValidatedFolderReviewSide,
    cancelled: &AtomicBool,
    mut after_chunk: impl FnMut(),
) -> CommandResult<Option<FileDocument>> {
    let snapshot = read_validated_folder_review_side_snapshot(
        side,
        cancelled,
        FolderReviewPairSide::Left,
        &mut |_, step| {
            if step == TextReadHook::AfterChunk {
                after_chunk();
            }
            Ok(())
        },
    )?;
    snapshot
        .map(folder_review_document_from_snapshot)
        .transpose()
}

fn read_validated_folder_review_side_snapshot(
    side: ValidatedFolderReviewSide,
    cancelled: &AtomicBool,
    pair_side: FolderReviewPairSide,
    on_step: &mut impl FnMut(FolderReviewPairSide, TextReadHook) -> std::io::Result<()>,
) -> CommandResult<Option<StableFileSnapshot>> {
    let ValidatedFolderReviewSide::Regular { opened } = side else {
        return Ok(None);
    };
    let mut check_cancelled = || check_folder_review_read_cancelled(cancelled);
    let snapshot = read_opened_stable_file_with_hook(
        *opened,
        MAX_TEXT_FILE_BYTES,
        &mut check_cancelled,
        &mut |step| on_step(pair_side, step),
    )
    .map_err(folder_review_stable_read_error)?;
    Ok(Some(snapshot))
}

fn verify_folder_review_side_snapshot(
    current: ValidatedFolderReviewSide,
    delivered: Option<&StableFileSnapshot>,
    cancelled: &AtomicBool,
    pair_side: FolderReviewPairSide,
    on_step: &mut impl FnMut(FolderReviewPairSide, TextReadHook) -> std::io::Result<()>,
) -> CommandResult<()> {
    match (current, delivered) {
        (ValidatedFolderReviewSide::Missing, None) => Ok(()),
        (ValidatedFolderReviewSide::Regular { opened }, Some(delivered)) => {
            let mut check_cancelled = || check_folder_review_read_cancelled(cancelled);
            let current = read_opened_stable_file_with_hook(
                *opened,
                MAX_TEXT_FILE_BYTES,
                &mut check_cancelled,
                &mut |step| on_step(pair_side, step),
            )
            .map_err(folder_review_stable_read_error)?;
            let delivered_hash = blake3::hash(&delivered.bytes);
            let current_hash = blake3::hash(&current.bytes);
            if delivered.identity != current.identity
                || !stable_metadata_matches(&delivered.metadata, &current.metadata)
                || delivered.bytes != current.bytes
                || delivered_hash != current_hash
            {
                return Err(folder_review_file_changed_during_read_error());
            }
            Ok(())
        }
        _ => Err(folder_review_file_changed_during_read_error()),
    }
}

fn folder_review_document_from_snapshot(
    snapshot: StableFileSnapshot,
) -> CommandResult<FileDocument> {
    if snapshot.bytes.starts_with(GIT_LFS_POINTER_SIGNATURE) {
        return Err(CommandError::new(
            AppErrorCode::BinaryFile,
            "Git LFS 포인터는 실제 텍스트 파일로 열지 않았습니다.",
        ));
    }
    let DecodedTextContent::Text(decoded) = decode_text_bytes(&snapshot.bytes) else {
        return Err(CommandError::new(
            AppErrorCode::BinaryFile,
            "폴더 검토 파일은 텍스트로 안전하게 판별되지 않아 열지 않았습니다.",
        ));
    };
    let content_hash = blake3::hash(&snapshot.bytes).to_hex().to_string();

    Ok(FileDocument {
        path: snapshot.path.to_string_lossy().into_owned(),
        name: snapshot
            .path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default(),
        line_ending: decoded.line_ending,
        had_final_newline: decoded.had_final_newline,
        text: decoded.text,
        encoding: decoded.encoding,
        size: snapshot.metadata.len(),
        modified_ms: modified_ms(&snapshot.metadata),
        content_hash,
        is_binary: false,
        decode_had_errors: decoded.decode_had_errors,
    })
}

fn folder_review_stable_read_error(error: CommandError) -> CommandError {
    match error.code {
        AppErrorCode::TooLarge | AppErrorCode::Cancelled => error,
        _ => folder_review_file_changed_during_read_error(),
    }
}

fn folder_review_file_changed_during_read_error() -> CommandError {
    CommandError::new(
        AppErrorCode::FileChanged,
        "폴더 검토 파일이 읽는 동안 변경됐습니다. 다시 시도하세요.",
    )
}

fn check_folder_review_read_cancelled(cancelled: &AtomicBool) -> CommandResult<()> {
    if cancelled.load(Ordering::Acquire) {
        return Err(CommandError::new(
            AppErrorCode::Cancelled,
            "폴더 검토 파일 읽기를 취소했습니다.",
        ));
    }
    Ok(())
}

fn folder_review_side_changed() -> CommandError {
    CommandError::new(
        AppErrorCode::FileChanged,
        "폴더 검토 항목의 종류 또는 존재 상태가 스캔 뒤 변경됐습니다.",
    )
}

#[tauri::command]
pub fn stat_text_file_version(path: String) -> CommandResult<FileVersion> {
    let path_buf = PathBuf::from(&path);
    stat_text_file_version_with_hook(&path_buf, MAX_TEXT_FILE_BYTES, |_| Ok(()))
}

#[tauri::command]
pub fn stat_optional_text_file_version(path: String) -> CommandResult<Option<FileVersion>> {
    let path_buf = PathBuf::from(&path);
    match fs::symlink_metadata(&path_buf) {
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(CommandError::io(
                AppErrorCode::PathConflict,
                "저장 대상 메타데이터를 확인하지 못했습니다",
                error,
            ));
        }
    }
    stat_text_file_version_with_hook(&path_buf, MAX_TEXT_FILE_BYTES, |_| Ok(())).map(Some)
}

fn stat_text_file_version_with_hook(
    path: &Path,
    max_bytes: u64,
    mut on_step: impl FnMut(TextReadHook) -> std::io::Result<()>,
) -> CommandResult<FileVersion> {
    let snapshot = read_stable_file_snapshot_with_hook(path, max_bytes, || Ok(()), &mut on_step)?;
    Ok(FileVersion {
        path: snapshot.path.to_string_lossy().into_owned(),
        size: snapshot.metadata.len(),
        modified_ms: modified_ms(&snapshot.metadata),
        content_hash: blake3::hash(&snapshot.bytes).to_hex().to_string(),
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
    expected_content_hash: Option<String>,
) -> CommandResult<WriteResult> {
    restore_text_file_backup_with_hook(
        PathBuf::from(path),
        PathBuf::from(backup_path),
        expected_size,
        expected_modified_ms,
        expected_content_hash,
        MAX_TEXT_FILE_BYTES,
        |_| Ok(()),
    )
}

fn restore_text_file_backup_with_hook(
    target: PathBuf,
    backup: PathBuf,
    expected_size: Option<u64>,
    expected_modified_ms: Option<u64>,
    expected_content_hash: Option<String>,
    max_bytes: u64,
    mut on_step: impl FnMut(TextReadHook) -> std::io::Result<()>,
) -> CommandResult<WriteResult> {
    if !is_backup_for_target(&target, &backup) {
        return Err(CommandError::new(
            AppErrorCode::PathConflict,
            "선택한 백업이 이 파일의 백업으로 확인되지 않았습니다.",
        ));
    }

    let bytes = read_backup_file_bounded_with_hook(&backup, max_bytes, &mut on_step)?;
    write_bytes_file_atomic_inner(
        target,
        &bytes,
        AtomicTextWriteOptions::new(true, expected_size, expected_modified_ms, None)
            .with_expected_content_hash(expected_content_hash),
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
    expected_content_hash: Option<String>,
    encoding: Option<String>,
) -> CommandResult<WriteResult> {
    write_text_file_atomic_inner(
        path,
        text,
        AtomicTextWriteOptions::new(create_backup, expected_size, expected_modified_ms, encoding)
            .with_expected_content_hash(expected_content_hash),
        |_| Ok(()),
    )
}

#[tauri::command]
pub fn write_text_file_atomic_guarded(
    path: String,
    text: String,
    create_backup: bool,
    expected_size: Option<u64>,
    expected_modified_ms: Option<u64>,
    expected_content_hash: Option<String>,
    encoding: Option<String>,
) -> CommandResult<WriteResult> {
    let options =
        AtomicTextWriteOptions::new(create_backup, expected_size, expected_modified_ms, encoding)
            .with_expected_content_hash(expected_content_hash);
    write_text_file_atomic_inner(path, text, options.expect_absent(), |_| Ok(()))
}

pub(crate) struct AtomicTextWriteOptions {
    create_backup: bool,
    expected_size: Option<u64>,
    expected_modified_ms: Option<u64>,
    expected_content_hash: Option<String>,
    encoding: Option<String>,
    expected_absent: bool,
}

impl AtomicTextWriteOptions {
    pub(crate) fn new(
        create_backup: bool,
        expected_size: Option<u64>,
        expected_modified_ms: Option<u64>,
        encoding: Option<String>,
    ) -> Self {
        Self {
            create_backup,
            expected_size,
            expected_modified_ms,
            expected_content_hash: None,
            encoding,
            expected_absent: false,
        }
    }

    pub(crate) fn with_expected_content_hash(mut self, content_hash: Option<String>) -> Self {
        self.expected_content_hash = content_hash;
        self
    }

    fn expect_absent(mut self) -> Self {
        self.expected_absent = true;
        self
    }
}

pub(crate) fn write_text_file_atomic_inner(
    path: String,
    text: String,
    options: AtomicTextWriteOptions,
    before_step: impl FnMut(SaveStep) -> CommandResult<()>,
) -> CommandResult<WriteResult> {
    write_text_path_atomic_inner(PathBuf::from(path), text, options, before_step)
}

pub(crate) fn write_text_path_atomic_inner(
    path: PathBuf,
    text: String,
    options: AtomicTextWriteOptions,
    before_step: impl FnMut(SaveStep) -> CommandResult<()>,
) -> CommandResult<WriteResult> {
    let encoded_text = encode_text_for_save(&text, options.encoding.as_deref());
    write_bytes_file_atomic_inner(path, &encoded_text, options, before_step)
}

fn write_bytes_file_atomic_inner(
    target: PathBuf,
    bytes: &[u8],
    options: AtomicTextWriteOptions,
    before_step: impl FnMut(SaveStep) -> CommandResult<()>,
) -> CommandResult<WriteResult> {
    write_bytes_file_atomic_inner_with_parent_sync(
        target,
        bytes,
        options,
        before_step,
        sync_parent_directory,
    )
}

fn write_bytes_file_atomic_inner_with_parent_sync(
    target: PathBuf,
    bytes: &[u8],
    options: AtomicTextWriteOptions,
    mut before_step: impl FnMut(SaveStep) -> CommandResult<()>,
    sync_parent: impl FnOnce(&Path) -> std::io::Result<()>,
) -> CommandResult<WriteResult> {
    let AtomicTextWriteOptions {
        create_backup,
        expected_size,
        expected_modified_ms,
        expected_content_hash,
        expected_absent,
        ..
    } = options;
    let parent = target.parent().unwrap_or_else(|| Path::new("."));
    if !parent.exists() {
        return Err(CommandError::new(
            AppErrorCode::PathConflict,
            "저장할 상위 폴더가 존재하지 않습니다.",
        ));
    }

    check_write_precondition(
        &target,
        expected_size,
        expected_modified_ms,
        expected_content_hash.as_deref(),
        expected_absent,
    )?;

    before_step(SaveStep::TempCreate)?;
    let mut temporary = NamedTempFile::new_in(parent).map_err(|error| {
        CommandError::io(
            AppErrorCode::WriteFailed,
            "임시 파일을 만들지 못했습니다",
            error,
        )
    })?;

    if let Ok(metadata) = fs::symlink_metadata(&target) {
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err(CommandError::new(
                AppErrorCode::PathConflict,
                "저장 대상이 일반 파일이 아닙니다. 경로를 다시 확인하세요.",
            ));
        }
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

    check_write_precondition(
        &target,
        expected_size,
        expected_modified_ms,
        expected_content_hash.as_deref(),
        expected_absent,
    )?;

    let mut created_backup = if create_backup && target.exists() {
        let backup = next_backup_path(&target)?;
        before_step(SaveStep::BackupCopy)?;
        Some(copy_target_to_backup(&target, &backup)?)
    } else {
        None
    };

    let replace_result = (|| -> CommandResult<()> {
        before_step(SaveStep::Replace)?;
        check_write_precondition(
            &target,
            expected_size,
            expected_modified_ms,
            expected_content_hash.as_deref(),
            expected_absent,
        )?;
        if expected_absent {
            temporary.persist_noclobber(&target).map_err(|error| {
                let target_was_created = fs::symlink_metadata(&target).is_ok();
                CommandError::io(
                    if target_was_created || error.error.kind() == std::io::ErrorKind::AlreadyExists
                    {
                        AppErrorCode::FileChanged
                    } else {
                        AppErrorCode::WriteFailed
                    },
                    "새 저장 대상이 외부에서 생성되어 덮어쓰지 않았습니다",
                    error.error,
                )
            })?;
        } else {
            replace_target(temporary, &target)?;
        }
        Ok(())
    })();
    if let Err(error) = replace_result {
        if let Some(backup) = created_backup.as_mut() {
            backup.rollback()?;
        }
        return Err(error);
    }
    if let Some(backup) = created_backup.as_mut() {
        // The target has already been replaced. From this point onward the
        // pre-save bytes must remain available even if parent fsync reports an
        // uncertain durability result.
        backup.retain();
    }
    before_step(SaveStep::ParentSync)?;
    sync_parent(parent).map_err(|_| {
        CommandError::new(
            AppErrorCode::WriteFailed,
            "파일 내용은 교체됐지만 저장 폴더를 디스크에 동기화하지 못했습니다. 파일을 다시 열어 저장 상태를 확인한 뒤 다시 시도하세요.",
        )
    })?;

    let written_metadata = fs::metadata(&target).map_err(|error| {
        CommandError::io(
            AppErrorCode::WriteFailed,
            "저장한 파일 메타데이터를 확인하지 못했습니다",
            error,
        )
    })?;

    if created_backup.is_some() {
        // Retention is a post-success action. Pre-replace failures roll back
        // only this save's new backup and never delete existing history.
        let _ = prune_old_backups(&target);
    }

    Ok(WriteResult {
        path: target.to_string_lossy().into_owned(),
        backup_path: created_backup
            .as_ref()
            .map(|backup| backup.path().to_string_lossy().into_owned()),
        bytes_written: bytes.len(),
        size: written_metadata.len(),
        modified_ms: modified_ms(&written_metadata),
        content_hash: blake3::hash(bytes).to_hex().to_string(),
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
pub(crate) enum SaveStep {
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
        replace_target_windows(temporary, target)
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
    if attrs == windows::Win32::Storage::FileSystem::INVALID_FILE_ATTRIBUTES {
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
    if current == windows::Win32::Storage::FileSystem::INVALID_FILE_ATTRIBUTES {
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
    if current == windows::Win32::Storage::FileSystem::INVALID_FILE_ATTRIBUTES {
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
    expected_content_hash: Option<&str>,
    expected_absent: bool,
) -> CommandResult<()> {
    check_write_precondition_with_hook(
        target,
        expected_size,
        expected_modified_ms,
        expected_content_hash,
        expected_absent,
        |_| Ok(()),
    )
}

fn check_write_precondition_with_hook(
    target: &Path,
    expected_size: Option<u64>,
    expected_modified_ms: Option<u64>,
    expected_content_hash: Option<&str>,
    expected_absent: bool,
    mut on_step: impl FnMut(TextReadHook) -> std::io::Result<()>,
) -> CommandResult<()> {
    if expected_absent
        && (expected_size.is_some()
            || expected_modified_ms.is_some()
            || expected_content_hash.is_some())
    {
        return Err(CommandError::new(
            AppErrorCode::PathConflict,
            "존재하지 않는 저장 대상과 기존 파일 조건을 함께 사용할 수 없습니다.",
        ));
    }
    let metadata = match fs::symlink_metadata(target) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            if expected_absent
                || (expected_size.is_none()
                    && expected_modified_ms.is_none()
                    && expected_content_hash.is_none())
            {
                return Ok(());
            }
            return Err(CommandError::new(
                AppErrorCode::FileChanged,
                "저장 대상이 열린 뒤 삭제되거나 이동됐습니다. 다시 열거나 다른 이름으로 저장하세요.",
            ));
        }
        Err(error) => {
            if expected_absent
                || expected_size.is_some()
                || expected_modified_ms.is_some()
                || expected_content_hash.is_some()
            {
                return Err(file_changed_error());
            }
            return Err(CommandError::io(
                AppErrorCode::PathConflict,
                "저장 대상 메타데이터를 확인하지 못했습니다",
                error,
            ));
        }
    };
    if expected_absent {
        return Err(CommandError::new(
            AppErrorCode::FileChanged,
            "다른 프로그램이 저장 대상을 만들었습니다. 다시 저장하세요.",
        ));
    }
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(CommandError::new(
            if expected_size.is_none()
                && expected_modified_ms.is_none()
                && expected_content_hash.is_none()
            {
                AppErrorCode::PathConflict
            } else {
                AppErrorCode::FileChanged
            },
            "저장 대상이 일반 파일이 아닙니다. 다시 열거나 다른 경로를 선택하세요.",
        ));
    }

    if expected_size.is_none() && expected_modified_ms.is_none() && expected_content_hash.is_none()
    {
        return Ok(());
    }

    let observed = stat_text_file_version_with_hook(target, MAX_TEXT_FILE_BYTES, &mut on_step)
        .map_err(|_| file_changed_error())?;
    if let Some(size) = expected_size {
        if observed.size != size {
            return Err(file_changed_error());
        }
    }
    if let Some(expected_modified) = expected_modified_ms {
        if observed.modified_ms != Some(expected_modified) {
            return Err(file_changed_error());
        }
    }
    if let Some(expected_hash) = expected_content_hash {
        if observed.content_hash != expected_hash {
            return Err(file_changed_error());
        }
    }

    Ok(())
}

fn copy_target_to_backup(target: &Path, backup: &Path) -> CommandResult<CreatedBackup> {
    copy_target_to_backup_with_hook(target, backup, MAX_TEXT_FILE_BYTES, |_| Ok(()))
}

fn copy_target_to_backup_with_hook(
    target: &Path,
    backup: &Path,
    max_bytes: u64,
    mut on_step: impl FnMut(TextReadHook) -> std::io::Result<()>,
) -> CommandResult<CreatedBackup> {
    let source = read_verified_raw_snapshot_with_hook(target, max_bytes, &mut on_step)?;
    let parent = backup.parent().unwrap_or_else(|| Path::new("."));
    let mut temporary = NamedTempFile::new_in(parent).map_err(|error| {
        CommandError::io(
            AppErrorCode::WriteFailed,
            "백업 임시 파일을 만들지 못했습니다",
            error,
        )
    })?;
    temporary.write_all(&source.bytes).map_err(|error| {
        CommandError::io(
            AppErrorCode::WriteFailed,
            "백업 파일을 만들지 못했습니다",
            error,
        )
    })?;
    temporary.flush().map_err(|error| {
        CommandError::io(
            AppErrorCode::WriteFailed,
            "백업 파일을 플러시하지 못했습니다",
            error,
        )
    })?;
    temporary.as_file().sync_all().map_err(|error| {
        CommandError::io(
            AppErrorCode::WriteFailed,
            "백업 파일을 동기화하지 못했습니다",
            error,
        )
    })?;
    temporary
        .as_file()
        .set_permissions(source.metadata.permissions())
        .map_err(|error| {
            CommandError::io(
                AppErrorCode::WriteFailed,
                "백업 파일 권한을 설정하지 못했습니다",
                error,
            )
        })?;
    let identity = Handle::from_file(temporary.as_file().try_clone().map_err(|error| {
        CommandError::io(
            AppErrorCode::WriteFailed,
            "백업 임시 파일 handle을 복제하지 못했습니다",
            error,
        )
    })?)
    .map_err(|error| {
        CommandError::io(
            AppErrorCode::WriteFailed,
            "백업 임시 파일 identity를 확인하지 못했습니다",
            error,
        )
    })?;
    temporary.persist_noclobber(backup).map_err(|error| {
        CommandError::io(
            AppErrorCode::WriteFailed,
            "백업 파일을 확정하지 못했습니다",
            error.error,
        )
    })?;
    Ok(CreatedBackup::new(backup.to_path_buf(), identity))
}

#[derive(Debug)]
struct CreatedBackup {
    path: PathBuf,
    identity: Handle,
    retained: bool,
}

impl CreatedBackup {
    fn new(path: PathBuf, identity: Handle) -> Self {
        Self {
            path,
            identity,
            retained: false,
        }
    }

    fn path(&self) -> &Path {
        &self.path
    }

    fn retain(&mut self) {
        self.retained = true;
    }

    fn rollback(&mut self) -> CommandResult<()> {
        if self.retained {
            return Ok(());
        }
        remove_created_backup_if_same_identity(&self.path, &self.identity)?;
        self.retained = true;
        Ok(())
    }
}

impl Drop for CreatedBackup {
    fn drop(&mut self) {
        if !self.retained {
            let _ = remove_created_backup_if_same_identity(&self.path, &self.identity);
        }
    }
}

fn remove_created_backup_if_same_identity(path: &Path, identity: &Handle) -> CommandResult<()> {
    let file = match stable_read_open_options().open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => {
            return Err(CommandError::io(
                AppErrorCode::WriteFailed,
                "실패한 저장의 새 백업을 정리하지 못했습니다",
                error,
            ));
        }
    };
    let metadata = file.metadata().map_err(|error| {
        CommandError::io(
            AppErrorCode::WriteFailed,
            "실패한 저장의 새 백업 메타데이터를 확인하지 못했습니다",
            error,
        )
    })?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(CommandError::new(
            AppErrorCode::WriteFailed,
            "실패한 저장의 백업 경로가 바뀌어 자동 정리하지 않았습니다.",
        ));
    }
    let current_identity = Handle::from_file(file).map_err(|error| {
        CommandError::io(
            AppErrorCode::WriteFailed,
            "실패한 저장의 새 백업 identity를 확인하지 못했습니다",
            error,
        )
    })?;
    if &current_identity != identity {
        return Err(CommandError::new(
            AppErrorCode::WriteFailed,
            "실패한 저장의 백업 경로가 다른 파일로 바뀌어 자동 정리하지 않았습니다.",
        ));
    }
    fs::remove_file(path).map_err(|error| {
        CommandError::io(
            AppErrorCode::WriteFailed,
            "실패한 저장의 새 백업을 정리하지 못했습니다",
            error,
        )
    })
}

fn read_verified_raw_snapshot_with_hook(
    path: &Path,
    max_bytes: u64,
    on_step: &mut impl FnMut(TextReadHook) -> std::io::Result<()>,
) -> CommandResult<StableFileSnapshot> {
    let first = read_stable_file_snapshot_with_hook(path, max_bytes, || Ok(()), on_step)?;
    let current = read_stable_file_snapshot_with_hook(path, max_bytes, || Ok(()), on_step)?;
    let first_hash = blake3::hash(&first.bytes);
    let current_hash = blake3::hash(&current.bytes);
    if first.identity != current.identity
        || !stable_metadata_matches(&first.metadata, &current.metadata)
        || first_hash != current_hash
        || first.bytes != current.bytes
    {
        return Err(text_file_changed_during_read_error());
    }
    Ok(current)
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
    let metadata = fs::symlink_metadata(&path).ok()?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
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

fn read_backup_file_bounded_with_hook(
    backup: &Path,
    max_bytes: u64,
    on_step: &mut impl FnMut(TextReadHook) -> std::io::Result<()>,
) -> CommandResult<Vec<u8>> {
    read_verified_raw_snapshot_with_hook(backup, max_bytes, on_step)
        .map(|snapshot| snapshot.bytes)
        .map_err(|error| {
            if error.code == AppErrorCode::TooLarge {
                backup_too_large_error()
            } else {
                error
            }
        })
}

fn backup_too_large_error() -> CommandError {
    CommandError::new(
        AppErrorCode::TooLarge,
        "백업 파일이 64 MB 안전 한도를 넘어서 복원하지 않았습니다.",
    )
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

    fn backup_history(target: &Path) -> Vec<(String, Vec<u8>)> {
        backup_entries(target)
            .expect("list backup history")
            .into_iter()
            .map(|backup| {
                let bytes = fs::read(&backup.path).expect("read backup history entry");
                (backup.name, bytes)
            })
            .collect()
    }

    fn read_folder_review_text_pair(
        request: FolderReviewTextPairRequest,
        job_id: u64,
    ) -> CommandResult<FolderReviewTextPair> {
        read_folder_review_text_pair_blocking(request, job_id)
    }

    fn folder_pair_request(
        left_root: &Path,
        right_root: &Path,
        relative_path: &str,
        left_expected: FolderReviewSideExpectation,
        right_expected: FolderReviewSideExpectation,
    ) -> FolderReviewTextPairRequest {
        FolderReviewTextPairRequest {
            left_root: left_root.to_string_lossy().into_owned(),
            right_root: right_root.to_string_lossy().into_owned(),
            relative_path: relative_path.to_string(),
            left_expected,
            right_expected,
        }
    }

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
    fn folder_review_text_pair_reads_both_sides_and_cleans_terminal_job() {
        let left = tempfile::tempdir().expect("left temp dir");
        let right = tempfile::tempdir().expect("right temp dir");
        fs::create_dir_all(left.path().join("src")).expect("left src");
        fs::create_dir_all(right.path().join("src")).expect("right src");
        fs::write(left.path().join("src/App.tsx"), "left\n").expect("left file");
        fs::write(right.path().join("src/App.tsx"), "right\r\n").expect("right file");
        let request = folder_pair_request(
            left.path(),
            right.path(),
            "src/App.tsx",
            FolderReviewSideExpectation::RegularFile,
            FolderReviewSideExpectation::RegularFile,
        );

        let first = read_folder_review_text_pair(request.clone(), 7).expect("pair read");
        assert_eq!(first.left.expect("left document").text, "left\n");
        assert_eq!(first.right.expect("right document").text, "right\r\n");

        let second = read_folder_review_text_pair(request, 7).expect("job id was cleaned");
        assert!(second.left.is_some());
        assert!(second.right.is_some());
    }

    #[test]
    fn folder_review_text_pair_preserves_missing_side_and_rejects_state_change() {
        let left = tempfile::tempdir().expect("left temp dir");
        let right = tempfile::tempdir().expect("right temp dir");
        fs::write(left.path().join("only.txt"), "left only").expect("left file");
        let request = folder_pair_request(
            left.path(),
            right.path(),
            "only.txt",
            FolderReviewSideExpectation::RegularFile,
            FolderReviewSideExpectation::Missing,
        );

        let pair = read_folder_review_text_pair(request.clone(), 8).expect("one-sided pair");
        assert_eq!(pair.left.expect("left document").text, "left only");
        assert!(pair.right.is_none());

        fs::write(right.path().join("only.txt"), "appeared").expect("appeared file");
        let error = read_folder_review_text_pair(request, 9).expect_err("appearance is stale");
        assert_eq!(error.code, AppErrorCode::FileChanged);
        assert!(!error.message.contains("only.txt"));
    }

    #[test]
    fn folder_review_text_pair_rejects_unsafe_relative_paths_and_empty_pair() {
        let left = tempfile::tempdir().expect("left temp dir");
        let right = tempfile::tempdir().expect("right temp dir");
        for (index, relative_path) in [
            "",
            "/absolute.txt",
            "../outside.txt",
            "src//empty.txt",
            "src/./same.txt",
            "C:/absolute.txt",
        ]
        .into_iter()
        .enumerate()
        {
            let request = folder_pair_request(
                left.path(),
                right.path(),
                relative_path,
                FolderReviewSideExpectation::RegularFile,
                FolderReviewSideExpectation::Missing,
            );
            let error = read_folder_review_text_pair(request, 20 + index as u64)
                .expect_err("unsafe path is rejected");
            assert_eq!(error.code, AppErrorCode::PathConflict);
            if !relative_path.is_empty() {
                assert!(!error.message.contains(relative_path));
            }
        }

        let error = read_folder_review_text_pair(
            folder_pair_request(
                left.path(),
                right.path(),
                "missing.txt",
                FolderReviewSideExpectation::Missing,
                FolderReviewSideExpectation::Missing,
            ),
            30,
        )
        .expect_err("both missing is invalid");
        assert_eq!(error.code, AppErrorCode::PathConflict);
    }

    #[test]
    fn folder_review_text_pair_rejects_binary_lfs_and_too_large_without_partial_response() {
        let left = tempfile::tempdir().expect("left temp dir");
        let right = tempfile::tempdir().expect("right temp dir");
        fs::write(left.path().join("candidate.txt"), "safe left").expect("left file");
        let request = || {
            folder_pair_request(
                left.path(),
                right.path(),
                "candidate.txt",
                FolderReviewSideExpectation::RegularFile,
                FolderReviewSideExpectation::RegularFile,
            )
        };

        fs::write(right.path().join("candidate.txt"), b"text\0binary").expect("binary");
        let binary = read_folder_review_text_pair(request(), 31).expect_err("binary rejected");
        assert_eq!(binary.code, AppErrorCode::BinaryFile);
        assert!(!binary.message.contains("safe left"));

        let mut late_binary = vec![b'a'; 16 * 1024];
        late_binary.push(0);
        fs::write(right.path().join("candidate.txt"), late_binary).expect("late NUL binary");
        let late_binary =
            read_folder_review_text_pair(request(), 34).expect_err("late NUL binary rejected");
        assert_eq!(late_binary.code, AppErrorCode::BinaryFile);
        assert!(!late_binary.message.contains("safe left"));

        fs::write(
            right.path().join("candidate.txt"),
            b"version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 10\n",
        )
        .expect("lfs pointer");
        let lfs = read_folder_review_text_pair(request(), 32).expect_err("LFS rejected");
        assert_eq!(lfs.code, AppErrorCode::BinaryFile);

        let oversized = fs::File::create(right.path().join("candidate.txt")).expect("large file");
        oversized
            .set_len(MAX_TEXT_FILE_BYTES + 1)
            .expect("sparse large file");
        let too_large =
            read_folder_review_text_pair(request(), 33).expect_err("large file rejected");
        assert_eq!(too_large.code, AppErrorCode::TooLarge);
    }

    #[test]
    fn folder_review_text_pair_cancellation_duplicate_and_unknown_cancel_are_deterministic() {
        let left = tempfile::tempdir().expect("left temp dir");
        let right = tempfile::tempdir().expect("right temp dir");
        fs::write(left.path().join("file.txt"), "left").expect("left file");
        let request = folder_pair_request(
            left.path(),
            right.path(),
            "file.txt",
            FolderReviewSideExpectation::RegularFile,
            FolderReviewSideExpectation::Missing,
        );

        let cancelled = AtomicBool::new(true);
        let error = read_folder_review_text_pair_inner(request.clone(), &cancelled)
            .expect_err("pre-cancelled read");
        assert_eq!(error.code, AppErrorCode::Cancelled);

        let active = FolderReviewTextReadJob::register(40).expect("register active job");
        let duplicate = read_folder_review_text_pair(request, 40).expect_err("duplicate job id");
        assert_eq!(duplicate.code, AppErrorCode::PathConflict);
        drop(active);
        cancel_folder_review_text_read(40).expect("completed cancel is no-op");
        cancel_folder_review_text_read(999).expect("unknown cancel is no-op");
    }

    #[test]
    fn folder_review_text_pair_observes_cancellation_during_either_side_chunks() {
        let left = tempfile::tempdir().expect("left temp dir");
        let right = tempfile::tempdir().expect("right temp dir");
        let bytes = vec![b'x'; FOLDER_REVIEW_READ_CHUNK * 2];
        fs::write(left.path().join("file.txt"), &bytes).expect("left file");
        fs::write(right.path().join("file.txt"), &bytes).expect("right file");
        let relative = Path::new("file.txt");

        for root in [left.path(), right.path()] {
            let canonical_root = fs::canonicalize(root).expect("canonical root");
            let side = validate_folder_review_side(
                &canonical_root,
                relative,
                FolderReviewSideExpectation::RegularFile,
            )
            .expect("validated side");
            let cancelled = AtomicBool::new(false);
            let error = read_validated_folder_review_side_with_chunk_hook(side, &cancelled, || {
                cancelled.store(true, Ordering::Release)
            })
            .expect_err("chunk cancellation");
            assert_eq!(error.code, AppErrorCode::Cancelled);
        }
    }

    #[cfg(unix)]
    #[test]
    fn folder_review_text_pair_rejects_symlink_file_and_symlink_parent_escape() {
        use std::os::unix::fs::symlink;

        let left = tempfile::tempdir().expect("left temp dir");
        let right = tempfile::tempdir().expect("right temp dir");
        let outside = tempfile::tempdir().expect("outside temp dir");
        fs::write(outside.path().join("outside.txt"), "outside").expect("outside file");
        symlink(
            outside.path().join("outside.txt"),
            left.path().join("linked.txt"),
        )
        .expect("file symlink");
        let linked = folder_pair_request(
            left.path(),
            right.path(),
            "linked.txt",
            FolderReviewSideExpectation::RegularFile,
            FolderReviewSideExpectation::Missing,
        );
        let error = read_folder_review_text_pair(linked, 41).expect_err("symlink rejected");
        assert_eq!(error.code, AppErrorCode::FileChanged);

        symlink(outside.path(), left.path().join("escape")).expect("parent symlink");
        let escaped = folder_pair_request(
            left.path(),
            right.path(),
            "escape/outside.txt",
            FolderReviewSideExpectation::RegularFile,
            FolderReviewSideExpectation::Missing,
        );
        let error = read_folder_review_text_pair(escaped, 42).expect_err("escape rejected");
        assert_eq!(error.code, AppErrorCode::PathConflict);
    }

    #[cfg(unix)]
    #[test]
    fn folder_review_pair_rejects_transient_symlink_and_same_metadata_replacement() {
        use std::os::unix::fs::symlink;

        for replace_with_symlink in [true, false] {
            let left = tempfile::tempdir().expect("left temp dir");
            let right = tempfile::tempdir().expect("right temp dir");
            let outside = tempfile::tempdir().expect("outside temp dir");
            let target = left.path().join("candidate.txt");
            let moved = left.path().join("candidate-old.txt");
            let replacement = outside.path().join("replacement.txt");
            fs::write(&target, b"opened-bytes").expect("opened file");
            fs::write(right.path().join("candidate.txt"), b"right-stable").expect("right file");
            fs::write(&replacement, b"secret-bytes").expect("replacement file");
            let original_modified = fs::metadata(&target)
                .expect("target metadata")
                .modified()
                .expect("target modified");
            fs::OpenOptions::new()
                .write(true)
                .open(&replacement)
                .expect("replacement handle")
                .set_times(fs::FileTimes::new().set_modified(original_modified))
                .expect("match replacement modified time");
            let request = folder_pair_request(
                left.path(),
                right.path(),
                "candidate.txt",
                FolderReviewSideExpectation::RegularFile,
                FolderReviewSideExpectation::RegularFile,
            );
            let cancelled = AtomicBool::new(false);
            let validated = validate_folder_review_text_pair(&request, &cancelled)
                .expect("validated pair before replacement");
            let mut replaced = false;

            let error = read_validated_folder_review_text_pair_with_hook(
                validated,
                &cancelled,
                |side, step| {
                    if !replaced
                        && side == FolderReviewPairSide::Left
                        && step == TextReadHook::AfterRead
                    {
                        fs::rename(&target, &moved)?;
                        if replace_with_symlink {
                            symlink(&replacement, &target)?;
                        } else {
                            fs::rename(&replacement, &target)?;
                        }
                        replaced = true;
                    }
                    Ok(())
                },
            )
            .expect_err("path identity replacement must reject the pair");

            assert_eq!(error.code, AppErrorCode::FileChanged);
            assert!(!error.message.contains("secret-bytes"));
            assert_eq!(
                fs::read(right.path().join("candidate.txt")).expect("unchanged right"),
                b"right-stable"
            );
        }
    }

    #[cfg(unix)]
    #[test]
    fn folder_review_pair_rejects_torn_side_and_cross_side_mutation_without_partial_result() {
        for mutate_while_reading_right in [false, true] {
            let left = tempfile::tempdir().expect("left temp dir");
            let right = tempfile::tempdir().expect("right temp dir");
            let left_path = left.path().join("candidate.txt");
            let right_path = right.path().join("candidate.txt");
            let left_bytes = vec![b'a'; FOLDER_REVIEW_READ_CHUNK * 2];
            let right_bytes = vec![b'r'; FOLDER_REVIEW_READ_CHUNK * 2];
            fs::write(&left_path, &left_bytes).expect("left file");
            fs::write(&right_path, &right_bytes).expect("right file");
            let left_modified = fs::metadata(&left_path)
                .expect("left metadata")
                .modified()
                .expect("left modified");
            let request = folder_pair_request(
                left.path(),
                right.path(),
                "candidate.txt",
                FolderReviewSideExpectation::RegularFile,
                FolderReviewSideExpectation::RegularFile,
            );
            let cancelled = AtomicBool::new(false);
            let validated = validate_folder_review_text_pair(&request, &cancelled)
                .expect("validated pair before mutation");
            let mutation_side = if mutate_while_reading_right {
                FolderReviewPairSide::Right
            } else {
                FolderReviewPairSide::Left
            };
            let mut mutated = false;

            let error = read_validated_folder_review_text_pair_with_hook(
                validated,
                &cancelled,
                |side, step| {
                    if !mutated && side == mutation_side && step == TextReadHook::AfterChunk {
                        fs::write(&left_path, vec![b'b'; left_bytes.len()])?;
                        fs::OpenOptions::new()
                            .write(true)
                            .open(&left_path)?
                            .set_times(fs::FileTimes::new().set_modified(left_modified))?;
                        mutated = true;
                    }
                    Ok(())
                },
            )
            .expect_err("torn or cross-side mutation must reject the whole pair");

            assert_eq!(error.code, AppErrorCode::FileChanged);
            assert!(!error.message.contains("candidate.txt"));
            assert_eq!(fs::read(&right_path).expect("unchanged right"), right_bytes);
        }
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
        assert_eq!(
            document.content_hash,
            blake3::hash(&[0xEF, 0xBB, 0xBF, b'a', b'\n'])
                .to_hex()
                .to_string()
        );
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
    fn file_version_commands_return_the_current_raw_byte_hash() {
        let file = tempfile::NamedTempFile::new().expect("temp file");
        fs::write(file.path(), b"versioned\r\nbytes").expect("write version fixture");
        let expected_hash = blake3::hash(b"versioned\r\nbytes").to_hex().to_string();

        let required = stat_text_file_version(file.path().to_string_lossy().into_owned())
            .expect("required version");
        let optional = stat_optional_text_file_version(file.path().to_string_lossy().into_owned())
            .expect("optional version")
            .expect("version exists");

        assert_eq!(required.content_hash, expected_hash);
        assert_eq!(optional.content_hash, expected_hash);
    }

    #[cfg(unix)]
    #[test]
    fn file_version_commands_reject_symlinks_without_reading_target_content() {
        use std::os::unix::fs::symlink;

        let directory = tempfile::tempdir().expect("temp dir");
        let outside = directory.path().join("outside.txt");
        let selected = directory.path().join("selected.txt");
        let sentinel = "version-sentinel-content";
        fs::write(&outside, sentinel).expect("outside fixture");
        symlink(&outside, &selected).expect("selected symlink");

        let required = stat_text_file_version(selected.to_string_lossy().into_owned())
            .expect_err("required version rejects symlink");
        let optional = stat_optional_text_file_version(selected.to_string_lossy().into_owned())
            .expect_err("optional version rejects symlink");

        assert_eq!(required.code, AppErrorCode::PathConflict);
        assert_eq!(optional.code, AppErrorCode::PathConflict);
        assert!(!required.message.contains(sentinel));
        assert!(!optional.message.contains(sentinel));
        assert_eq!(
            fs::read_to_string(outside).expect("outside unchanged"),
            sentinel
        );
    }

    #[test]
    fn file_version_commands_reject_oversize_and_growth_with_bounded_reads() {
        let directory = tempfile::tempdir().expect("temp dir");
        let oversized = directory.path().join("oversized.txt");
        fs::File::create(&oversized)
            .expect("oversized fixture")
            .set_len(MAX_TEXT_FILE_BYTES + 1)
            .expect("sparse oversized fixture");

        let required = stat_text_file_version(oversized.to_string_lossy().into_owned())
            .expect_err("required version rejects oversized file");
        let optional = stat_optional_text_file_version(oversized.to_string_lossy().into_owned())
            .expect_err("optional version rejects oversized file");
        assert_eq!(required.code, AppErrorCode::TooLarge);
        assert_eq!(optional.code, AppErrorCode::TooLarge);

        let growing = directory.path().join("growing.txt");
        fs::write(&growing, b"small").expect("growing fixture");
        let error = stat_text_file_version_with_hook(&growing, 8, |step| {
            if step == TextReadHook::BeforeRead {
                fs::OpenOptions::new()
                    .write(true)
                    .open(&growing)?
                    .set_len(9)?;
            }
            Ok(())
        })
        .expect_err("growth after open must remain bounded");
        assert_eq!(error.code, AppErrorCode::TooLarge);
    }

    #[cfg(unix)]
    #[test]
    fn file_version_rejects_same_metadata_path_swap_after_hashing() {
        let directory = tempfile::tempdir().expect("temp dir");
        let target = directory.path().join("selected.txt");
        let moved = directory.path().join("selected-old.txt");
        let replacement = directory.path().join("replacement.txt");
        fs::write(&target, b"first").expect("selected fixture");
        let original_modified = fs::metadata(&target)
            .expect("selected metadata")
            .modified()
            .expect("selected modified");
        fs::write(&replacement, b"other").expect("replacement fixture");
        fs::OpenOptions::new()
            .write(true)
            .open(&replacement)
            .expect("replacement handle")
            .set_times(fs::FileTimes::new().set_modified(original_modified))
            .expect("match replacement modified time");

        let error = stat_text_file_version_with_hook(&target, MAX_TEXT_FILE_BYTES, |step| {
            if step == TextReadHook::BeforePathReopen {
                fs::rename(&target, &moved)?;
                fs::rename(&replacement, &target)?;
            }
            Ok(())
        })
        .expect_err("same-metadata path replacement must reject the version");

        assert_eq!(error.code, AppErrorCode::FileChanged);
    }

    #[cfg(unix)]
    #[test]
    fn write_precondition_transient_symlink_fails_closed_as_file_changed() {
        use std::os::unix::fs::symlink;

        let directory = tempfile::tempdir().expect("temp dir");
        let target = directory.path().join("target.txt");
        let moved = directory.path().join("target-old.txt");
        let outside = directory.path().join("outside.txt");
        fs::write(&target, b"safe").expect("target fixture");
        fs::write(&outside, b"secret-outside").expect("outside fixture");
        let metadata = fs::metadata(&target).expect("target metadata");
        let expected_hash = blake3::hash(b"safe").to_hex().to_string();
        let mut swapped = false;

        let error = check_write_precondition_with_hook(
            &target,
            Some(metadata.len()),
            modified_ms(&metadata),
            Some(&expected_hash),
            false,
            |step| {
                if !swapped && step == TextReadHook::AfterPreflight {
                    fs::rename(&target, &moved)?;
                    symlink(&outside, &target)?;
                    swapped = true;
                }
                Ok(())
            },
        )
        .expect_err("transient symlink must fail the write precondition closed");

        assert_eq!(error.code, AppErrorCode::FileChanged);
        assert!(!error.message.contains("secret-outside"));
        assert_eq!(
            fs::read_to_string(&outside).expect("outside unchanged"),
            "secret-outside"
        );
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
    fn general_reader_rejects_a_bomless_nul_after_the_initial_16_kib() {
        let directory = tempfile::tempdir().expect("temp dir");
        let target = directory.path().join("late-nul.txt");
        let mut bytes = vec![b'a'; 16 * 1024 + 1];
        bytes.push(0);
        fs::write(&target, bytes).expect("write late NUL fixture");

        let error = read_text_file(target.to_string_lossy().into_owned())
            .expect_err("late NUL must remain a binary rejection");

        assert_eq!(error.code, AppErrorCode::BinaryFile);
    }

    #[cfg(unix)]
    #[test]
    fn read_text_file_rejects_a_symlink_without_returning_target_content() {
        use std::os::unix::fs::symlink;

        let directory = tempfile::tempdir().expect("temp dir");
        let outside = directory.path().join("outside.txt");
        let selected = directory.path().join("selected.txt");
        let sentinel = "outside-content-sentinel";
        fs::write(&outside, sentinel).expect("write outside fixture");
        symlink(&outside, &selected).expect("create selected symlink");

        let error = read_text_file(selected.to_string_lossy().into_owned())
            .expect_err("symlink input must be rejected");

        assert_eq!(error.code, AppErrorCode::PathConflict);
        assert!(!error.message.contains(sentinel));
        assert_eq!(
            fs::read_to_string(&outside).expect("read outside fixture"),
            sentinel
        );
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
    fn bounded_general_reader_rejects_growth_past_the_limit_after_open() {
        let directory = tempfile::tempdir().expect("temp dir");
        let target = directory.path().join("growing.txt");
        fs::write(&target, b"small").expect("write initial fixture");

        let error =
            read_text_file_with_limit_and_hook(target.to_string_lossy().into_owned(), 8, |step| {
                if step == TextReadHook::BeforeRead {
                    fs::OpenOptions::new()
                        .write(true)
                        .open(&target)?
                        .set_len(9)?;
                }
                Ok(())
            })
            .expect_err("growth beyond the bounded read must be rejected");

        assert_eq!(error.code, AppErrorCode::TooLarge);
    }

    #[test]
    fn general_reader_rejects_metadata_change_after_content_read() {
        let directory = tempfile::tempdir().expect("temp dir");
        let target = directory.path().join("changing.txt");
        fs::write(&target, b"stable text").expect("write initial fixture");

        let error = read_text_file_with_limit_and_hook(
            target.to_string_lossy().into_owned(),
            MAX_TEXT_FILE_BYTES,
            |step| {
                if step == TextReadHook::AfterRead {
                    fs::OpenOptions::new()
                        .write(true)
                        .open(&target)?
                        .set_len(3)?;
                }
                Ok(())
            },
        )
        .expect_err("post-read metadata change must reject a stale document");

        assert_eq!(error.code, AppErrorCode::FileChanged);
    }

    #[cfg(unix)]
    #[test]
    fn general_reader_rejects_path_identity_replacement_after_content_read() {
        let directory = tempfile::tempdir().expect("temp dir");
        let target = directory.path().join("selected.txt");
        let moved = directory.path().join("selected-old.txt");
        let replacement = directory.path().join("replacement.txt");
        fs::write(&target, b"first").expect("write selected fixture");
        let selected_modified = fs::metadata(&target)
            .expect("selected metadata")
            .modified()
            .expect("selected modified time");
        fs::write(&replacement, b"other").expect("write same-size replacement");
        fs::OpenOptions::new()
            .write(true)
            .open(&replacement)
            .expect("open replacement")
            .set_times(fs::FileTimes::new().set_modified(selected_modified))
            .expect("match replacement modified time");

        let error = read_text_file_with_limit_and_hook(
            target.to_string_lossy().into_owned(),
            MAX_TEXT_FILE_BYTES,
            |step| {
                if step == TextReadHook::AfterRead {
                    fs::rename(&target, &moved)?;
                    fs::rename(&replacement, &target)?;
                }
                Ok(())
            },
        )
        .expect_err("same-metadata path replacement must reject the stale handle");

        assert_eq!(error.code, AppErrorCode::FileChanged);
    }

    #[test]
    fn writes_with_matching_precondition_and_returns_new_version() {
        let directory = tempfile::tempdir().expect("temp dir");
        let target = directory.path().join("merged.txt");
        fs::write(&target, "old").expect("write original");
        let original_metadata = fs::metadata(&target).expect("original metadata");
        let original_hash = blake3::hash(b"old").to_hex().to_string();

        let result = write_text_file_atomic(
            target.to_string_lossy().into_owned(),
            "new".to_string(),
            false,
            Some(original_metadata.len()),
            modified_ms(&original_metadata),
            Some(original_hash),
            None,
        )
        .expect("write succeeds");

        assert_eq!(fs::read_to_string(&target).expect("read written"), "new");
        assert_eq!(result.size, 3);
        assert_eq!(result.bytes_written, 3);
        assert!(result.modified_ms.is_some());
        assert_eq!(
            result.content_hash,
            blake3::hash(b"new").to_hex().to_string()
        );
    }

    #[test]
    fn rejects_same_size_same_mtime_external_content_change_before_backup() {
        let directory = tempfile::tempdir().expect("temp dir");
        let target = directory.path().join("same-metadata.txt");
        fs::write(&target, "open").expect("write opened bytes");
        let opened = read_text_file(target.to_string_lossy().into_owned()).expect("open document");
        let opened_modified = fs::metadata(&target)
            .expect("opened metadata")
            .modified()
            .expect("opened modified time");

        fs::write(&target, "else").expect("same-size external change");
        fs::OpenOptions::new()
            .write(true)
            .open(&target)
            .expect("open changed target")
            .set_times(fs::FileTimes::new().set_modified(opened_modified))
            .expect("restore original modified time");
        let changed_metadata = fs::metadata(&target).expect("changed metadata");
        assert_eq!(changed_metadata.len(), opened.size);
        assert_eq!(modified_ms(&changed_metadata), opened.modified_ms);

        let error = write_text_file_atomic(
            target.to_string_lossy().into_owned(),
            "save".to_string(),
            true,
            Some(opened.size),
            opened.modified_ms,
            Some(opened.content_hash),
            None,
        )
        .expect_err("content hash mismatch must reject save");

        assert_eq!(error.code, AppErrorCode::FileChanged);
        assert_eq!(
            fs::read_to_string(&target).expect("preserved target"),
            "else"
        );
        assert!(backup_entries(&target).expect("backup list").is_empty());
    }

    #[test]
    fn writes_new_file_without_backup_and_syncs_parent_directory() {
        let directory = tempfile::tempdir().expect("temp dir");
        let target = directory.path().join("new-file.txt");
        let mut parent_sync_attempted = false;

        let result = write_text_file_atomic_inner(
            target.to_string_lossy().into_owned(),
            "new file\n".to_string(),
            AtomicTextWriteOptions::new(true, None, None, None),
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
    fn parent_directory_sync_failure_reports_uncertain_durability_without_rollback() {
        let directory = tempfile::tempdir().expect("temp dir");
        let target = directory.path().join("target.txt");
        fs::write(&target, "original").expect("write original");

        let error = write_bytes_file_atomic_inner_with_parent_sync(
            target.clone(),
            b"replacement",
            AtomicTextWriteOptions::new(true, None, None, None),
            |_| Ok(()),
            |_| {
                Err(std::io::Error::other(
                    "injected parent directory sync fault",
                ))
            },
        )
        .expect_err("parent directory sync failure must be reported");

        assert_eq!(error.code, AppErrorCode::WriteFailed);
        assert!(error.message.contains("파일 내용은 교체됐지만"));
        assert_eq!(
            fs::read_to_string(&target).expect("read replacement"),
            "replacement",
            "post-replace durability failure must not roll back and discard new bytes"
        );

        let backups = backup_entries(&target).expect("list backups");
        assert_eq!(backups.len(), 1);
        assert_eq!(
            fs::read_to_string(&backups[0].path).expect("read original backup"),
            "original"
        );
    }

    #[cfg(unix)]
    #[test]
    fn atomic_writer_rejects_a_symlink_target_without_reading_or_replacing_it() {
        use std::os::unix::fs::symlink;

        let directory = tempfile::tempdir().expect("temp dir");
        let outside = directory.path().join("outside.txt");
        let target = directory.path().join("target.txt");
        fs::write(&outside, "outside secret").expect("outside fixture");
        symlink(&outside, &target).expect("target symlink");

        let error = write_text_file_atomic(
            target.to_string_lossy().into_owned(),
            "replacement".to_string(),
            true,
            None,
            None,
            None,
            None,
        )
        .expect_err("symlink target must be rejected");

        assert_eq!(error.code, AppErrorCode::PathConflict);
        assert_eq!(
            fs::read_to_string(&outside).expect("outside remains"),
            "outside secret"
        );
        assert!(
            fs::symlink_metadata(&target)
                .expect("symlink remains")
                .file_type()
                .is_symlink()
        );
        assert!(backup_entries(&target).expect("backup list").is_empty());
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
                AtomicTextWriteOptions::new(true, None, None, None),
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
            assert!(
                backup_entries(&target)
                    .expect("list backups after injected fault")
                    .is_empty(),
                "backup history changed after injected fault at {fault_step:?}"
            );
        }
    }

    #[test]
    fn patch_save_as_guards_absence_and_never_changes_repository_sources() {
        let directory = tempfile::tempdir().expect("temp dir");
        let repository = directory.path().join("repository");
        let git_dir = repository.join(".git");
        fs::create_dir_all(&git_dir).expect("create repository fixture");
        fs::write(git_dir.join("HEAD"), "ref: refs/heads/main\n").expect("write HEAD");
        fs::write(git_dir.join("index"), b"index snapshot").expect("write index");
        fs::write(git_dir.join("config"), "[core]\n\tbare = false\n").expect("write config");
        fs::write(repository.join("tracked.txt"), "tracked source\n").expect("write tracked");
        let source_before = [
            fs::read(git_dir.join("HEAD")).expect("read HEAD"),
            fs::read(git_dir.join("index")).expect("read index"),
            fs::read(git_dir.join("config")).expect("read config"),
            fs::read(repository.join("tracked.txt")).expect("read tracked"),
        ];
        let output = directory.path().join("review.patch");

        assert!(
            stat_optional_text_file_version(output.to_string_lossy().into_owned())
                .expect("missing output is valid")
                .is_none()
        );
        fs::write(&output, "created outside").expect("race creates target");
        let error = write_text_file_atomic_guarded(
            output.to_string_lossy().into_owned(),
            "patch output".to_string(),
            true,
            None,
            None,
            None,
            Some("UTF-8".to_string()),
        )
        .expect_err("newly created target must fail the absent precondition");

        assert_eq!(error.code, AppErrorCode::FileChanged);
        assert_eq!(
            fs::read_to_string(&output).expect("read output"),
            "created outside"
        );
        assert_eq!(
            source_before,
            [
                fs::read(git_dir.join("HEAD")).expect("read HEAD after"),
                fs::read(git_dir.join("index")).expect("read index after"),
                fs::read(git_dir.join("config")).expect("read config after"),
                fs::read(repository.join("tracked.txt")).expect("read tracked after"),
            ]
        );
    }

    #[test]
    fn patch_save_as_fault_preserves_existing_output_and_repository_sources() {
        let directory = tempfile::tempdir().expect("temp dir");
        let repository_source = directory.path().join("tracked.txt");
        let output = directory.path().join("review.patch");
        fs::write(&repository_source, "repository bytes").expect("write repository source");
        fs::write(&output, "previous patch").expect("write previous output");
        let version = stat_optional_text_file_version(output.to_string_lossy().into_owned())
            .expect("stat output")
            .expect("output exists");

        let error = write_text_file_atomic_inner(
            output.to_string_lossy().into_owned(),
            "replacement patch".to_string(),
            AtomicTextWriteOptions::new(
                true,
                Some(version.size),
                version.modified_ms,
                Some("UTF-8".to_string()),
            ),
            |step| {
                if step == SaveStep::Replace {
                    Err(CommandError::new(
                        AppErrorCode::WriteFailed,
                        "injected patch output fault",
                    ))
                } else {
                    Ok(())
                }
            },
        )
        .expect_err("injected patch output fault should fail");

        assert_eq!(error.code, AppErrorCode::WriteFailed);
        assert_eq!(
            fs::read_to_string(&output).expect("read output"),
            "previous patch"
        );
        assert_eq!(
            fs::read_to_string(&repository_source).expect("read repository source"),
            "repository bytes"
        );
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

    #[cfg(unix)]
    #[test]
    fn backup_listing_excludes_symlink_entries() {
        use std::os::unix::fs::symlink;

        let directory = tempfile::tempdir().expect("temp dir");
        let target = directory.path().join("merged.txt");
        let outside = directory.path().join("outside.txt");
        let linked_backup = directory.path().join("merged.txt.bak.1000");
        let regular_backup = directory.path().join("merged.txt.bak.2000");
        fs::write(&target, "current").expect("write target");
        fs::write(&outside, "outside bytes").expect("write outside fixture");
        symlink(&outside, &linked_backup).expect("create backup symlink");
        fs::write(&regular_backup, "regular backup").expect("write regular backup");

        let backups =
            list_file_backups(target.to_string_lossy().into_owned()).expect("list backups");

        assert_eq!(backups.len(), 1);
        assert_eq!(backups[0].name, "merged.txt.bak.2000");
    }

    #[cfg(unix)]
    #[test]
    fn restore_rejects_a_symlink_backup_without_changing_the_target() {
        use std::os::unix::fs::symlink;

        let directory = tempfile::tempdir().expect("temp dir");
        let target = directory.path().join("merged.txt");
        let outside = directory.path().join("outside.txt");
        let linked_backup = directory.path().join("merged.txt.bak.1000");
        fs::write(&target, "current").expect("write target");
        fs::write(&outside, "outside bytes").expect("write outside fixture");
        symlink(&outside, &linked_backup).expect("create backup symlink");

        let error = restore_text_file_backup(
            target.to_string_lossy().into_owned(),
            linked_backup.to_string_lossy().into_owned(),
            None,
            None,
            None,
        )
        .expect_err("symlink backup must be rejected");

        assert_eq!(error.code, AppErrorCode::PathConflict);
        assert_eq!(fs::read_to_string(&target).expect("read target"), "current");
        assert_eq!(
            fs::read_to_string(&outside).expect("read outside fixture"),
            "outside bytes"
        );
    }

    #[test]
    fn restore_rejects_an_oversized_backup_before_replacing_the_target() {
        let directory = tempfile::tempdir().expect("temp dir");
        let target = directory.path().join("merged.txt");
        let backup = directory.path().join("merged.txt.bak.1000");
        fs::write(&target, "current").expect("write target");
        fs::File::create(&backup)
            .expect("create sparse backup")
            .set_len(MAX_TEXT_FILE_BYTES + 1)
            .expect("set oversized backup length");

        let error = restore_text_file_backup(
            target.to_string_lossy().into_owned(),
            backup.to_string_lossy().into_owned(),
            None,
            None,
            None,
        )
        .expect_err("oversized backup must be rejected");

        assert_eq!(error.code, AppErrorCode::TooLarge);
        assert_eq!(fs::read_to_string(&target).expect("read target"), "current");
        let backups = backup_entries(&target).expect("list backups");
        assert_eq!(backups.len(), 1, "restore must not create a new backup");
        assert_eq!(PathBuf::from(&backups[0].path), backup);
    }

    #[test]
    fn restore_rejects_a_backup_shrunk_mid_read_without_changing_target_or_history() {
        let directory = tempfile::tempdir().expect("temp dir");
        let target = directory.path().join("merged.txt");
        let backup = directory.path().join("merged.txt.bak.1000");
        fs::write(&target, "current").expect("write target");
        fs::write(&backup, vec![b'r'; FOLDER_REVIEW_READ_CHUNK * 2])
            .expect("write multi-chunk backup");
        let backup_names_before = backup_entries(&target)
            .expect("list backups")
            .into_iter()
            .map(|entry| entry.name)
            .collect::<Vec<_>>();
        let mut shrunk = false;

        let error = restore_text_file_backup_with_hook(
            target.clone(),
            backup.clone(),
            None,
            None,
            None,
            MAX_TEXT_FILE_BYTES,
            |step| {
                if !shrunk && step == TextReadHook::AfterChunk {
                    fs::OpenOptions::new()
                        .write(true)
                        .open(&backup)?
                        .set_len((FOLDER_REVIEW_READ_CHUNK / 2) as u64)?;
                    shrunk = true;
                }
                Ok(())
            },
        )
        .expect_err("mid-read shrink must reject restore");

        assert_eq!(error.code, AppErrorCode::FileChanged);
        assert_eq!(fs::read_to_string(&target).expect("read target"), "current");
        assert_eq!(
            backup_entries(&target)
                .expect("list backups after shrink")
                .into_iter()
                .map(|entry| entry.name)
                .collect::<Vec<_>>(),
            backup_names_before
        );
    }

    #[test]
    fn restore_rejects_same_metadata_backup_rewrite_without_torn_bytes() {
        let directory = tempfile::tempdir().expect("temp dir");
        let target = directory.path().join("merged.txt");
        let backup = directory.path().join("merged.txt.bak.1000");
        fs::write(&target, "current").expect("write target");
        fs::write(&backup, b"restored").expect("write backup");
        let original_modified = fs::metadata(&backup)
            .expect("backup metadata")
            .modified()
            .expect("backup modified time");
        let mut rewritten = false;

        let error = restore_text_file_backup_with_hook(
            target.clone(),
            backup.clone(),
            None,
            None,
            None,
            MAX_TEXT_FILE_BYTES,
            |step| {
                if !rewritten && step == TextReadHook::AfterRead {
                    fs::write(&backup, b"intruder")?;
                    fs::OpenOptions::new()
                        .write(true)
                        .open(&backup)?
                        .set_times(fs::FileTimes::new().set_modified(original_modified))?;
                    rewritten = true;
                }
                Ok(())
            },
        )
        .expect_err("same-metadata rewrite must reject restore");

        assert_eq!(error.code, AppErrorCode::FileChanged);
        assert_eq!(fs::read_to_string(&target).expect("read target"), "current");
        assert_eq!(
            fs::read(&backup).expect("read rewritten backup"),
            b"intruder"
        );
    }

    #[cfg(unix)]
    #[test]
    fn restore_rejects_a_same_metadata_backup_path_swap() {
        let directory = tempfile::tempdir().expect("temp dir");
        let target = directory.path().join("merged.txt");
        let backup = directory.path().join("merged.txt.bak.1000");
        let moved = directory.path().join("merged.txt.bak.moved");
        let replacement = directory.path().join("replacement.txt");
        fs::write(&target, "current").expect("write target");
        fs::write(&backup, b"restored").expect("write backup");
        let original_modified = fs::metadata(&backup)
            .expect("backup metadata")
            .modified()
            .expect("backup modified time");
        fs::write(&replacement, b"intruder").expect("write replacement");
        fs::OpenOptions::new()
            .write(true)
            .open(&replacement)
            .expect("open replacement")
            .set_times(fs::FileTimes::new().set_modified(original_modified))
            .expect("match replacement mtime");
        let mut swapped = false;

        let error = restore_text_file_backup_with_hook(
            target.clone(),
            backup.clone(),
            None,
            None,
            None,
            MAX_TEXT_FILE_BYTES,
            |step| {
                if !swapped && step == TextReadHook::BeforePathReopen {
                    fs::rename(&backup, &moved)?;
                    fs::rename(&replacement, &backup)?;
                    swapped = true;
                }
                Ok(())
            },
        )
        .expect_err("same-metadata backup path swap must reject restore");

        assert_eq!(error.code, AppErrorCode::FileChanged);
        assert_eq!(fs::read_to_string(&target).expect("read target"), "current");
        assert_eq!(fs::read(&backup).expect("read swapped path"), b"intruder");
        assert_eq!(fs::read(&moved).expect("read original backup"), b"restored");
    }

    #[test]
    fn restore_rejects_a_backup_that_grows_past_the_bounded_read_limit() {
        let directory = tempfile::tempdir().expect("temp dir");
        let target = directory.path().join("merged.txt");
        let backup = directory.path().join("merged.txt.bak.1000");
        fs::write(&target, "current").expect("write target");
        fs::write(&backup, b"small").expect("write backup");
        let mut grown = false;

        let error = restore_text_file_backup_with_hook(
            target.clone(),
            backup.clone(),
            None,
            None,
            None,
            8,
            |step| {
                if !grown && step == TextReadHook::BeforeRead {
                    fs::OpenOptions::new()
                        .write(true)
                        .open(&backup)?
                        .set_len(9)?;
                    grown = true;
                }
                Ok(())
            },
        )
        .expect_err("growth past the bounded limit must reject restore");

        assert_eq!(error.code, AppErrorCode::TooLarge);
        assert_eq!(fs::read_to_string(&target).expect("read target"), "current");
        assert_eq!(backup_entries(&target).expect("list backups").len(), 1);
    }

    #[test]
    fn backup_creation_rejects_a_growing_source_without_persisting_a_backup() {
        let directory = tempfile::tempdir().expect("temp dir");
        let target = directory.path().join("merged.txt");
        let backup = directory.path().join("merged.txt.bak.1000");
        fs::write(&target, b"small").expect("write target");
        let mut grown = false;

        let error = copy_target_to_backup_with_hook(&target, &backup, 8, |step| {
            if !grown && step == TextReadHook::BeforeRead {
                fs::OpenOptions::new()
                    .write(true)
                    .open(&target)?
                    .set_len(9)?;
                grown = true;
            }
            Ok(())
        })
        .expect_err("growing backup source must be rejected");

        assert_eq!(error.code, AppErrorCode::TooLarge);
        assert!(!backup.exists());
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
    fn file_changed_after_backup_staging_rolls_back_new_backup_and_retention_changes() {
        let directory = tempfile::tempdir().expect("temp dir");
        let target = directory.path().join("merged.txt");
        fs::write(&target, b"current").expect("write target");
        for index in 0..BACKUP_RETENTION_LIMIT {
            fs::write(
                directory
                    .path()
                    .join(format!("merged.txt.bak.{}", 1000 + index)),
                format!("old {index}"),
            )
            .expect("write backup");
        }
        let opened = stat_text_file_version(target.to_string_lossy().into_owned())
            .expect("stat target before save");
        let opened_modified = fs::metadata(&target)
            .expect("target metadata")
            .modified()
            .expect("target modified time");
        let history_before = backup_history(&target);
        let mut changed = false;

        let error = write_text_file_atomic_inner(
            target.to_string_lossy().into_owned(),
            "replacement".to_string(),
            AtomicTextWriteOptions::new(
                true,
                Some(opened.size),
                opened.modified_ms,
                Some("UTF-8".to_string()),
            )
            .with_expected_content_hash(Some(opened.content_hash)),
            |step| {
                if !changed && step == SaveStep::Replace {
                    fs::write(&target, b"outside").expect("write external replacement");
                    fs::OpenOptions::new()
                        .write(true)
                        .open(&target)
                        .expect("open external replacement")
                        .set_times(fs::FileTimes::new().set_modified(opened_modified))
                        .expect("restore external replacement mtime");
                    changed = true;
                }
                Ok(())
            },
        )
        .expect_err("final precondition must reject external change");

        assert_eq!(error.code, AppErrorCode::FileChanged);
        assert_eq!(fs::read(&target).expect("read external target"), b"outside");
        assert_eq!(backup_history(&target), history_before);
    }

    #[test]
    fn replace_failure_rolls_back_new_backup_without_pruning_existing_history() {
        let directory = tempfile::tempdir().expect("temp dir");
        let target = directory.path().join("merged.txt");
        fs::write(&target, b"current").expect("write target");
        for index in 0..BACKUP_RETENTION_LIMIT {
            fs::write(
                directory
                    .path()
                    .join(format!("merged.txt.bak.{}", 1000 + index)),
                format!("old {index}"),
            )
            .expect("write backup");
        }
        let history_before = backup_history(&target);

        let error = write_text_file_atomic_inner(
            target.to_string_lossy().into_owned(),
            "replacement".to_string(),
            AtomicTextWriteOptions::new(true, None, None, Some("UTF-8".to_string())),
            |step| {
                if step == SaveStep::Replace {
                    Err(CommandError::new(
                        AppErrorCode::WriteFailed,
                        "injected replace failure",
                    ))
                } else {
                    Ok(())
                }
            },
        )
        .expect_err("replace failure must fail save");

        assert_eq!(error.code, AppErrorCode::WriteFailed);
        assert_eq!(fs::read(&target).expect("read target"), b"current");
        assert_eq!(backup_history(&target), history_before);
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
            Some(blake3::hash(b"current").to_hex().to_string()),
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
    // SAV-003/SAV-006: Windows atomic replace and backup transaction safety.
    //
    // These tests only compile and run on Windows. They are executed in the
    // GitHub Actions windows-2022 runner (see ci.yml). macOS/Linux cannot
    // validate the Windows ReplaceFile/MoveFileEx path that forktail ships to
    // Windows users, so a non-Windows run cannot close this platform evidence.
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
        let _ = clear_readonly_attribute(&target);
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

        // The backup is prepared before replacement, but a failed replace
        // rolls back only that new entry. Existing retention history must not
        // change for a save that never replaced the target.
        let backups = backup_entries(&target).expect("list backup history");
        assert!(
            backups.is_empty(),
            "failed replace must roll back this save's new backup"
        );

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
            None,
        )
        .expect("write succeeds");

        assert_eq!(
            fs::read_to_string(&target).expect("read written"),
            "새 내용"
        );
    }
}
