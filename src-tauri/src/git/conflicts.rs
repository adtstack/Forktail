use crate::commands::files::{AtomicTextWriteOptions, SaveStep, write_text_path_atomic_inner};
use crate::domain::git::{
    GitConflictEncodingPolicy, GitConflictEntry, GitConflictLineEndingPolicy, GitConflictList,
    GitConflictOperation, GitConflictResultFingerprint, GitConflictResultKind,
    GitConflictSaveAction, GitConflictSaveResult, GitConflictStage, GitConflictStageFingerprint,
    GitObjectAlgorithm, GitObjectId, GitPathIdentity, GitPathRegistryError,
};
use crate::error::{AppErrorCode, CommandError};
use crate::git::index::{GitIndexError, capture_index_fingerprint};
use crate::git::repository::GitRepositorySession;
use crate::git::runner::{CancellationToken, GitOperation, OutputStream, RunnerError};
use crate::git::session::{GitSessionError, conflict_result_candidate};
use crate::text::{DecodedTextContent, MAX_TEXT_BYTES, decode_text_bytes};
use same_file::Handle;
use std::collections::HashMap;
use std::fs::{self, File, Metadata, OpenOptions};
use std::io::Read;
use std::path::Path;
use std::time::UNIX_EPOCH;

pub const MAX_CONFLICT_ENTRIES: usize = 10_000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GitConflictError {
    Runner(RunnerError),
    InvalidLimit,
    CommandFailed,
    OutputTooLarge,
    TruncatedOutput,
    InvalidRecord,
    InvalidMode,
    InvalidObjectId,
    InvalidStage,
    InvalidPath,
    DuplicateStage,
    StateUnavailable,
    StaleGeneration,
    IndexUnavailable,
    IndexChanged,
    OperationChanged,
}

#[derive(Debug, Clone)]
pub struct ConflictSaveInput {
    pub path: GitPathIdentity,
    pub generation: u64,
    pub expected_stage_fingerprint: GitConflictStageFingerprint,
    pub expected_result_fingerprint: GitConflictResultFingerprint,
    pub text: String,
    pub encoding_policy: GitConflictEncodingPolicy,
    pub line_ending_policy: GitConflictLineEndingPolicy,
    pub create_backup: bool,
    pub explicit_overwrite_decision: bool,
}

#[derive(Debug)]
pub enum GitConflictSaveError {
    ConflictStateChanged,
    ResultChanged,
    ResultUnsupported,
    UnresolvedMarkers,
    Cancelled,
    StateUnavailable,
    Write(CommandError),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ConflictSaveStep {
    AfterInitialValidation,
    BeforeBackupValidation,
    BeforeReplaceValidation,
    AtomicWrite(SaveStep),
}

struct CurrentConflictResult {
    fingerprint: GitConflictResultFingerprint,
    encoding: Option<String>,
    line_ending: Option<crate::LineEnding>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ParsedConflictEntry {
    path: Vec<u8>,
    stage1: Option<GitConflictStage>,
    stage2: Option<GitConflictStage>,
    stage3: Option<GitConflictStage>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ParsedConflictList {
    entries: Vec<ParsedConflictEntry>,
    truncated: bool,
    total_entries: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ConflictReadStep {
    AfterCommand,
}

#[derive(Debug, Clone, Copy)]
struct GroupState {
    materialized_index: Option<usize>,
    stage_mask: u8,
}

pub fn list_conflicts(
    session: &GitRepositorySession,
    hard_limit: usize,
    cancellation: &CancellationToken,
) -> Result<GitConflictList, GitConflictError> {
    list_conflicts_inner(session, hard_limit, cancellation, |_| {})
}

pub fn save_conflict_result(
    session: &GitRepositorySession,
    input: ConflictSaveInput,
    cancellation: &CancellationToken,
) -> Result<GitConflictSaveResult, GitConflictSaveError> {
    save_conflict_result_inner(session, input, cancellation, |_| Ok(()))
}

fn save_conflict_result_inner<Hook>(
    session: &GitRepositorySession,
    input: ConflictSaveInput,
    cancellation: &CancellationToken,
    mut hook: Hook,
) -> Result<GitConflictSaveResult, GitConflictSaveError>
where
    Hook: FnMut(ConflictSaveStep) -> Result<(), GitConflictSaveError>,
{
    if cancellation.is_cancelled() {
        return Err(GitConflictSaveError::Cancelled);
    }
    if has_unresolved_conflict_markers(&input.text) {
        return Err(GitConflictSaveError::UnresolvedMarkers);
    }
    validate_stage_fingerprint(
        session,
        &input.path,
        input.generation,
        &input.expected_stage_fingerprint,
        cancellation,
    )?;
    let target = conflict_result_candidate(session, &input.path, input.generation)
        .map_err(map_save_session_error)?;
    let current = read_current_conflict_result(&target)?;
    if !matches!(
        current.fingerprint.kind,
        GitConflictResultKind::Missing | GitConflictResultKind::RegularFile
    ) {
        return Err(GitConflictSaveError::ResultUnsupported);
    }
    if current.fingerprint != input.expected_result_fingerprint
        && !input.explicit_overwrite_decision
    {
        return Err(GitConflictSaveError::ResultChanged);
    }
    let baseline = current.fingerprint.clone();
    let line_ending = match input.line_ending_policy {
        GitConflictLineEndingPolicy::PreserveResult => current.line_ending,
        GitConflictLineEndingPolicy::Lf => Some(crate::LineEnding::Lf),
        GitConflictLineEndingPolicy::Crlf => Some(crate::LineEnding::Crlf),
        GitConflictLineEndingPolicy::Cr => Some(crate::LineEnding::Cr),
    };
    let text = apply_line_ending_policy(&input.text, line_ending);
    let encoding = match input.encoding_policy {
        GitConflictEncodingPolicy::PreserveResult => current.encoding,
        GitConflictEncodingPolicy::Utf8 => Some("UTF-8".to_string()),
    };
    hook(ConflictSaveStep::AfterInitialValidation)?;

    let (expected_size, expected_modified_ms) = match baseline.kind {
        GitConflictResultKind::RegularFile => (baseline.size, baseline.modified_ms),
        GitConflictResultKind::Missing => (None, None),
        GitConflictResultKind::Symlink | GitConflictResultKind::Directory => {
            return Err(GitConflictSaveError::ResultUnsupported);
        }
    };
    let mut captured_error = None;
    let written = write_text_path_atomic_inner(
        target.clone(),
        text,
        AtomicTextWriteOptions::new(
            input.create_backup,
            expected_size,
            expected_modified_ms,
            encoding,
        ),
        |step| {
            let validation_step = match step {
                SaveStep::BackupCopy => Some(ConflictSaveStep::BeforeBackupValidation),
                SaveStep::Replace => Some(ConflictSaveStep::BeforeReplaceValidation),
                _ => None,
            };
            if let Some(validation_step) = validation_step {
                if let Err(error) = hook(validation_step).and_then(|()| {
                    validate_save_state(
                        session,
                        &input.path,
                        input.generation,
                        &input.expected_stage_fingerprint,
                        &target,
                        &baseline,
                        cancellation,
                    )
                }) {
                    captured_error = Some(error);
                    return Err(CommandError::new(
                        AppErrorCode::FileChanged,
                        "Git 충돌 상태 또는 결과 파일이 변경됐습니다. 다시 불러오세요.",
                    ));
                }
            }
            if let Err(error) = hook(ConflictSaveStep::AtomicWrite(step)) {
                captured_error = Some(error);
                return Err(CommandError::new(
                    AppErrorCode::WriteFailed,
                    "충돌 결과 저장을 완료하지 못했습니다.",
                ));
            }
            Ok(())
        },
    );
    if let Some(error) = captured_error {
        return Err(error);
    }
    let write_result = written.map_err(GitConflictSaveError::Write)?;
    Ok(GitConflictSaveResult {
        write_result,
        action: GitConflictSaveAction::ConflictSaved,
    })
}

fn validate_save_state(
    session: &GitRepositorySession,
    path: &GitPathIdentity,
    generation: u64,
    expected_stage: &GitConflictStageFingerprint,
    target: &Path,
    expected_result: &GitConflictResultFingerprint,
    cancellation: &CancellationToken,
) -> Result<(), GitConflictSaveError> {
    validate_stage_fingerprint(session, path, generation, expected_stage, cancellation)?;
    let candidate =
        conflict_result_candidate(session, path, generation).map_err(map_save_session_error)?;
    if candidate != target {
        return Err(GitConflictSaveError::ConflictStateChanged);
    }
    let current = read_current_conflict_result(target)?;
    if &current.fingerprint != expected_result {
        return Err(GitConflictSaveError::ResultChanged);
    }
    Ok(())
}

fn validate_stage_fingerprint(
    session: &GitRepositorySession,
    path: &GitPathIdentity,
    generation: u64,
    expected: &GitConflictStageFingerprint,
    cancellation: &CancellationToken,
) -> Result<(), GitConflictSaveError> {
    let conflicts = list_conflicts(session, MAX_CONFLICT_ENTRIES, cancellation)
        .map_err(map_save_conflict_error)?;
    if conflicts.generation != generation {
        return Err(GitConflictSaveError::ConflictStateChanged);
    }
    let Some(entry) = conflicts
        .entries
        .iter()
        .find(|entry| entry.path.opaque_id == path.opaque_id)
    else {
        return Err(GitConflictSaveError::ConflictStateChanged);
    };
    let actual = GitConflictStageFingerprint {
        stage1: entry.stage1.clone(),
        stage2: entry.stage2.clone(),
        stage3: entry.stage3.clone(),
    };
    if &actual != expected {
        return Err(GitConflictSaveError::ConflictStateChanged);
    }
    Ok(())
}

fn read_current_conflict_result(
    target: &Path,
) -> Result<CurrentConflictResult, GitConflictSaveError> {
    let preflight = match fs::symlink_metadata(target) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(CurrentConflictResult {
                fingerprint: GitConflictResultFingerprint {
                    kind: GitConflictResultKind::Missing,
                    size: None,
                    modified_ms: None,
                    content_hash: None,
                },
                encoding: None,
                line_ending: None,
            });
        }
        Err(_) => return Err(GitConflictSaveError::StateUnavailable),
    };
    if preflight.file_type().is_symlink() {
        return Ok(non_regular_current_result(
            &preflight,
            GitConflictResultKind::Symlink,
        ));
    }
    if !preflight.is_file() {
        return Ok(non_regular_current_result(
            &preflight,
            GitConflictResultKind::Directory,
        ));
    }
    if preflight.len() > MAX_TEXT_BYTES {
        return Err(GitConflictSaveError::ResultUnsupported);
    }

    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW);
    }
    let mut file = options
        .open(target)
        .map_err(|_| GitConflictSaveError::ResultChanged)?;
    let before = file
        .metadata()
        .map_err(|_| GitConflictSaveError::ResultChanged)?;
    if !before.is_file() || metadata_version(&preflight) != metadata_version(&before) {
        return Err(GitConflictSaveError::ResultChanged);
    }
    verify_open_file(target, &file)?;
    let mut bytes = Vec::with_capacity(before.len() as usize);
    file.by_ref()
        .take(MAX_TEXT_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| GitConflictSaveError::StateUnavailable)?;
    if bytes.len() as u64 > MAX_TEXT_BYTES {
        return Err(GitConflictSaveError::ResultUnsupported);
    }
    let after = file
        .metadata()
        .map_err(|_| GitConflictSaveError::ResultChanged)?;
    if metadata_version(&before) != metadata_version(&after) {
        return Err(GitConflictSaveError::ResultChanged);
    }
    verify_open_file(target, &file)?;
    let DecodedTextContent::Text(decoded) = decode_text_bytes(&bytes) else {
        return Err(GitConflictSaveError::ResultUnsupported);
    };
    if decoded.decode_had_errors {
        return Err(GitConflictSaveError::ResultUnsupported);
    }
    Ok(CurrentConflictResult {
        fingerprint: GitConflictResultFingerprint {
            kind: GitConflictResultKind::RegularFile,
            size: Some(after.len()),
            modified_ms: modified_ms(&after),
            content_hash: Some(blake3::hash(&bytes).to_hex().to_string()),
        },
        encoding: Some(decoded.encoding),
        line_ending: Some(decoded.line_ending),
    })
}

fn non_regular_current_result(
    metadata: &Metadata,
    kind: GitConflictResultKind,
) -> CurrentConflictResult {
    CurrentConflictResult {
        fingerprint: GitConflictResultFingerprint {
            kind,
            size: Some(metadata.len()),
            modified_ms: modified_ms(metadata),
            content_hash: None,
        },
        encoding: None,
        line_ending: None,
    }
}

fn verify_open_file(target: &Path, file: &File) -> Result<(), GitConflictSaveError> {
    let current = fs::symlink_metadata(target).map_err(|_| GitConflictSaveError::ResultChanged)?;
    if current.file_type().is_symlink() || !current.is_file() {
        return Err(GitConflictSaveError::ResultChanged);
    }
    let open_handle = Handle::from_file(
        file.try_clone()
            .map_err(|_| GitConflictSaveError::StateUnavailable)?,
    )
    .map_err(|_| GitConflictSaveError::StateUnavailable)?;
    let path_handle = Handle::from_path(target).map_err(|_| GitConflictSaveError::ResultChanged)?;
    if open_handle != path_handle {
        return Err(GitConflictSaveError::ResultChanged);
    }
    Ok(())
}

fn metadata_version(metadata: &Metadata) -> (u64, Option<std::time::SystemTime>) {
    (metadata.len(), metadata.modified().ok())
}

fn modified_ms(metadata: &Metadata) -> Option<u64> {
    metadata
        .modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_millis() as u64)
}

fn apply_line_ending_policy(text: &str, line_ending: Option<crate::LineEnding>) -> String {
    let separator = match line_ending {
        Some(crate::LineEnding::Lf) => "\n",
        Some(crate::LineEnding::Crlf) => "\r\n",
        Some(crate::LineEnding::Cr) => "\r",
        Some(crate::LineEnding::Mixed | crate::LineEnding::None) | None => return text.to_string(),
    };
    text.replace("\r\n", "\n")
        .replace('\r', "\n")
        .replace('\n', separator)
}

fn has_unresolved_conflict_markers(text: &str) -> bool {
    let mut in_conflict = false;
    let mut has_separator = false;
    for line in text.lines() {
        if line.starts_with("<<<<<<<") {
            in_conflict = true;
            has_separator = false;
        } else if in_conflict && line == "=======" {
            has_separator = true;
        } else if in_conflict && has_separator && line.starts_with(">>>>>>>") {
            return true;
        }
    }
    false
}

fn map_save_conflict_error(error: GitConflictError) -> GitConflictSaveError {
    match error {
        GitConflictError::Runner(RunnerError::Cancelled) => GitConflictSaveError::Cancelled,
        _ => GitConflictSaveError::ConflictStateChanged,
    }
}

fn map_save_session_error(error: GitSessionError) -> GitConflictSaveError {
    match error {
        GitSessionError::Cancelled => GitConflictSaveError::Cancelled,
        GitSessionError::PathOutsideRoot
        | GitSessionError::PathUnsupported
        | GitSessionError::SymlinkUnsupported => GitConflictSaveError::ResultUnsupported,
        _ => GitConflictSaveError::ConflictStateChanged,
    }
}

fn list_conflicts_inner<Hook>(
    session: &GitRepositorySession,
    hard_limit: usize,
    cancellation: &CancellationToken,
    mut hook: Hook,
) -> Result<GitConflictList, GitConflictError>
where
    Hook: FnMut(ConflictReadStep),
{
    validate_limit(hard_limit)?;
    if cancellation.is_cancelled() {
        return Err(GitConflictError::Runner(RunnerError::Cancelled));
    }
    let expected_generation = session
        .paths()
        .lock()
        .map_err(|_| GitConflictError::StateUnavailable)?
        .generation();
    let index_before = capture_index_fingerprint(session).map_err(map_index_error)?;
    let operation_before =
        detect_conflict_operation(&session.identity().git_dir, &session.identity().common_dir);
    let output = session
        .executable()
        .runner()
        .run(
            GitOperation::Conflicts {
                repository: session.identity().root.clone(),
            },
            cancellation,
        )
        .map_err(map_runner_error)?;
    if !output.success {
        return Err(GitConflictError::CommandFailed);
    }
    hook(ConflictReadStep::AfterCommand);
    if cancellation.is_cancelled() {
        return Err(GitConflictError::Runner(RunnerError::Cancelled));
    }
    if capture_index_fingerprint(session).map_err(map_index_error)? != index_before {
        return Err(GitConflictError::IndexChanged);
    }
    let operation_after =
        detect_conflict_operation(&session.identity().git_dir, &session.identity().common_dir);
    if operation_after != operation_before {
        return Err(GitConflictError::OperationChanged);
    }
    let parsed =
        parse_conflict_records(&output.stdout, session.identity().object_format, hard_limit)?;
    let mut paths = session
        .paths()
        .lock()
        .map_err(|_| GitConflictError::StateUnavailable)?;
    if paths.generation() != expected_generation {
        return Err(GitConflictError::StaleGeneration);
    }
    let mut entries = Vec::with_capacity(parsed.entries.len());
    for entry in parsed.entries {
        entries.push(GitConflictEntry {
            path: paths.register(entry.path).map_err(map_path_error)?,
            stage1: entry.stage1,
            stage2: entry.stage2,
            stage3: entry.stage3,
        });
    }
    drop(paths);
    if capture_index_fingerprint(session).map_err(map_index_error)? != index_before {
        return Err(GitConflictError::IndexChanged);
    }
    if detect_conflict_operation(&session.identity().git_dir, &session.identity().common_dir)
        != operation_before
    {
        return Err(GitConflictError::OperationChanged);
    }
    Ok(GitConflictList {
        entries,
        operation: operation_before,
        truncated: parsed.truncated,
        total_entries: parsed.total_entries,
        generation: expected_generation,
    })
}

fn parse_conflict_records(
    output: &[u8],
    algorithm: GitObjectAlgorithm,
    hard_limit: usize,
) -> Result<ParsedConflictList, GitConflictError> {
    validate_limit(hard_limit)?;
    if output.is_empty() {
        return Ok(ParsedConflictList {
            entries: Vec::new(),
            truncated: false,
            total_entries: 0,
        });
    }
    if !output.ends_with(&[0]) {
        return Err(GitConflictError::TruncatedOutput);
    }
    let mut entries = Vec::<ParsedConflictEntry>::new();
    let mut groups = HashMap::<Vec<u8>, GroupState>::new();
    let mut total_entries = 0_u64;
    for record in output[..output.len() - 1].split(|byte| *byte == 0) {
        let (path, stage, value) = parse_conflict_record(record, algorithm)?;
        let stage_bit = 1_u8 << stage;
        if let Some(group) = groups.get_mut(path.as_slice()) {
            if group.stage_mask & stage_bit != 0 {
                return Err(GitConflictError::DuplicateStage);
            }
            group.stage_mask |= stage_bit;
            if let Some(index) = group.materialized_index {
                set_stage(&mut entries[index], stage, value)?;
            }
            continue;
        }

        total_entries = total_entries
            .checked_add(1)
            .ok_or(GitConflictError::StateUnavailable)?;
        let materialized_index = if entries.len() < hard_limit {
            let mut entry = ParsedConflictEntry {
                path: path.clone(),
                stage1: None,
                stage2: None,
                stage3: None,
            };
            set_stage(&mut entry, stage, value)?;
            entries.push(entry);
            Some(entries.len() - 1)
        } else {
            None
        };
        groups.insert(
            path,
            GroupState {
                materialized_index,
                stage_mask: stage_bit,
            },
        );
    }
    Ok(ParsedConflictList {
        entries,
        truncated: total_entries > hard_limit as u64,
        total_entries,
    })
}

fn parse_conflict_record(
    record: &[u8],
    algorithm: GitObjectAlgorithm,
) -> Result<(Vec<u8>, u8, GitConflictStage), GitConflictError> {
    let tab = record
        .iter()
        .position(|byte| *byte == b'\t')
        .ok_or(GitConflictError::InvalidRecord)?;
    let header = &record[..tab];
    let path = &record[tab + 1..];
    validate_path(path)?;
    let fields = header.split(|byte| *byte == b' ').collect::<Vec<_>>();
    if fields.len() != 3 || fields.iter().any(|field| field.is_empty()) {
        return Err(GitConflictError::InvalidRecord);
    }
    let mode = std::str::from_utf8(fields[0]).map_err(|_| GitConflictError::InvalidMode)?;
    if !matches!(mode, "100644" | "100755" | "120000" | "160000") {
        return Err(GitConflictError::InvalidMode);
    }
    let object = std::str::from_utf8(fields[1]).map_err(|_| GitConflictError::InvalidObjectId)?;
    let object_id = GitObjectId::try_new(algorithm, object.to_string())
        .map_err(|_| GitConflictError::InvalidObjectId)?;
    let stage = match fields[2] {
        [b'1'] => 1,
        [b'2'] => 2,
        [b'3'] => 3,
        _ => return Err(GitConflictError::InvalidStage),
    };
    Ok((
        path.to_vec(),
        stage,
        GitConflictStage {
            mode: mode.to_string(),
            object_id,
        },
    ))
}

fn set_stage(
    entry: &mut ParsedConflictEntry,
    stage: u8,
    value: GitConflictStage,
) -> Result<(), GitConflictError> {
    let slot = match stage {
        1 => &mut entry.stage1,
        2 => &mut entry.stage2,
        3 => &mut entry.stage3,
        _ => return Err(GitConflictError::InvalidStage),
    };
    if slot.replace(value).is_some() {
        Err(GitConflictError::DuplicateStage)
    } else {
        Ok(())
    }
}

fn validate_path(path: &[u8]) -> Result<(), GitConflictError> {
    if path.is_empty()
        || path.starts_with(b"/")
        || path.contains(&0)
        || path
            .split(|byte| *byte == b'/')
            .any(|component| component.is_empty() || matches!(component, b"." | b".."))
    {
        Err(GitConflictError::InvalidPath)
    } else {
        Ok(())
    }
}

fn validate_limit(hard_limit: usize) -> Result<(), GitConflictError> {
    if (1..=MAX_CONFLICT_ENTRIES).contains(&hard_limit) {
        Ok(())
    } else {
        Err(GitConflictError::InvalidLimit)
    }
}

fn detect_conflict_operation(git_dir: &Path, common_dir: &Path) -> GitConflictOperation {
    let directories = if git_dir == common_dir {
        vec![git_dir]
    } else {
        vec![git_dir, common_dir]
    };
    if directories.iter().any(|directory| {
        regular_directory_marker(directory, "rebase-merge")
            || regular_directory_marker(directory, "rebase-apply")
    }) {
        GitConflictOperation::Rebase
    } else if directories
        .iter()
        .any(|directory| regular_file_marker(directory, "CHERRY_PICK_HEAD"))
    {
        GitConflictOperation::CherryPick
    } else if directories
        .iter()
        .any(|directory| regular_file_marker(directory, "REVERT_HEAD"))
    {
        GitConflictOperation::Revert
    } else if directories
        .iter()
        .any(|directory| regular_file_marker(directory, "MERGE_HEAD"))
    {
        GitConflictOperation::Merge
    } else {
        GitConflictOperation::Unknown
    }
}

fn regular_file_marker(directory: &Path, name: &str) -> bool {
    fs::symlink_metadata(directory.join(name))
        .is_ok_and(|metadata| !metadata.file_type().is_symlink() && metadata.is_file())
}

fn regular_directory_marker(directory: &Path, name: &str) -> bool {
    fs::symlink_metadata(directory.join(name))
        .is_ok_and(|metadata| !metadata.file_type().is_symlink() && metadata.is_dir())
}

fn map_runner_error(error: RunnerError) -> GitConflictError {
    match error {
        RunnerError::OutputTooLarge(OutputStream::Stdout) => GitConflictError::OutputTooLarge,
        other => GitConflictError::Runner(other),
    }
}

fn map_index_error(error: GitIndexError) -> GitConflictError {
    match error {
        GitIndexError::IndexChanged => GitConflictError::IndexChanged,
        GitIndexError::IndexUnavailable => GitConflictError::IndexUnavailable,
        GitIndexError::Runner(error) => GitConflictError::Runner(error),
        _ => GitConflictError::StateUnavailable,
    }
}

fn map_path_error(error: GitPathRegistryError) -> GitConflictError {
    match error {
        GitPathRegistryError::StaleGeneration => GitConflictError::StaleGeneration,
        GitPathRegistryError::EmptyPath | GitPathRegistryError::PathContainsNul => {
            GitConflictError::InvalidPath
        }
        GitPathRegistryError::DuplicateOpaqueId
        | GitPathRegistryError::UnknownOpaqueId
        | GitPathRegistryError::PlatformConversionUnsupported
        | GitPathRegistryError::GenerationExhausted
        | GitPathRegistryError::OpaqueIdExhausted => GitConflictError::StateUnavailable,
    }
}

#[cfg(test)]
mod tests {
    use super::{
        ConflictReadStep, ConflictSaveInput, ConflictSaveStep, GitConflictError,
        GitConflictSaveError, detect_conflict_operation, list_conflicts_inner,
        parse_conflict_records, save_conflict_result, save_conflict_result_inner,
    };
    use crate::commands::files::SaveStep;
    use crate::domain::git::{
        GitConflictEncodingPolicy, GitConflictLineEndingPolicy, GitConflictOperation,
        GitConflictSaveAction, GitObjectAlgorithm,
    };
    use crate::error::{AppErrorCode, CommandError};
    use crate::git::executable::ValidatedGitExecutable;
    use crate::git::repository::GitRepositorySession;
    use crate::git::runner::CancellationToken;
    use std::ffi::OsStr;
    use std::fs;
    use std::path::PathBuf;
    use std::process::{Command, Output, Stdio};
    use std::sync::MutexGuard;
    use tempfile::{TempDir, tempdir};

    fn record(mode: &[u8], object: &[u8], stage: u8, path: &[u8]) -> Vec<u8> {
        let mut output = Vec::new();
        output.extend_from_slice(mode);
        output.push(b' ');
        output.extend_from_slice(object);
        output.push(b' ');
        output.push(stage);
        output.push(b'\t');
        output.extend_from_slice(path);
        output.push(0);
        output
    }

    #[test]
    fn groups_stage_sets_with_explicit_missing_modes_and_lossless_paths() {
        let object = b"a".repeat(40);
        let mut output = Vec::new();
        for stage in [b'1', b'2', b'3'] {
            output.extend(record(
                b"100644",
                &object,
                stage,
                b"both\tmodified\n\xff.txt",
            ));
        }
        for stage in [b'2', b'3'] {
            output.extend(record(b"100755", &object, stage, b"add-add.sh"));
        }
        for stage in [b'1', b'2'] {
            output.extend(record(b"100644", &object, stage, b"deleted-by-theirs"));
        }
        for stage in [b'1', b'3'] {
            output.extend(record(b"100644", &object, stage, b"deleted-by-ours"));
        }
        output.extend(record(b"120000", &object, b'2', b"type-change"));
        output.extend(record(b"100644", &object, b'3', b"type-change"));
        output.extend(record(b"100644", &object, b'1', b"renamed-old"));
        output.extend(record(b"100644", &object, b'3', b"renamed-new"));

        let parsed = parse_conflict_records(&output, GitObjectAlgorithm::Sha1, 20)
            .expect("valid conflict stages");

        assert_eq!(parsed.entries.len(), 7);
        assert_eq!(parsed.entries[0].path, b"both\tmodified\n\xff.txt");
        assert!(parsed.entries[0].stage1.is_some());
        assert!(parsed.entries[0].stage2.is_some());
        assert!(parsed.entries[0].stage3.is_some());
        assert!(parsed.entries[1].stage1.is_none());
        assert!(parsed.entries[2].stage3.is_none());
        assert!(parsed.entries[3].stage2.is_none());
        assert_eq!(parsed.entries[4].stage2.as_ref().unwrap().mode, "120000");
        assert_eq!(parsed.entries[4].stage3.as_ref().unwrap().mode, "100644");
        assert!(!parsed.truncated);
    }

    #[test]
    fn rejects_duplicate_invalid_and_truncated_stage_records_and_bounds_groups() {
        let object = b"b".repeat(40);
        let mut duplicate = record(b"100644", &object, b'2', b"same");
        duplicate.extend(record(b"100644", &object, b'2', b"same"));
        assert_eq!(
            parse_conflict_records(&duplicate, GitObjectAlgorithm::Sha1, 10),
            Err(GitConflictError::DuplicateStage),
        );

        let cases = [
            (
                record(b"10064x", &object, b'1', b"bad-mode"),
                GitConflictError::InvalidMode,
            ),
            (
                record(b"100644", b"abcd", b'1', b"bad-object"),
                GitConflictError::InvalidObjectId,
            ),
            (
                record(b"100644", &object, b'0', b"bad-stage"),
                GitConflictError::InvalidStage,
            ),
            (
                record(b"100644", &object, b'4', b"bad-stage"),
                GitConflictError::InvalidStage,
            ),
            (
                record(b"100644", &object, b'1', b"../escape"),
                GitConflictError::InvalidPath,
            ),
            (
                {
                    let mut truncated = record(b"100644", &object, b'1', b"file");
                    truncated.pop();
                    truncated
                },
                GitConflictError::TruncatedOutput,
            ),
        ];
        for (output, expected) in cases {
            assert_eq!(
                parse_conflict_records(&output, GitObjectAlgorithm::Sha1, 10),
                Err(expected),
            );
        }

        let mut bounded = record(b"100644", &object, b'1', b"a");
        bounded.extend(record(b"100644", &object, b'2', b"b"));
        let parsed = parse_conflict_records(&bounded, GitObjectAlgorithm::Sha1, 1)
            .expect("validate complete output but bound materialized groups");
        assert_eq!(parsed.entries.len(), 1);
        assert!(parsed.truncated);
        assert_eq!(parsed.total_entries, 2);
    }

    #[test]
    fn detects_operation_markers_without_following_symlinks() {
        let temp = tempdir().expect("operation marker root");
        let git_dir = temp.path().join("git-dir");
        let common_dir = temp.path().join("common-dir");
        fs::create_dir_all(&git_dir).expect("git dir");
        fs::create_dir_all(&common_dir).expect("common dir");

        assert_eq!(
            detect_conflict_operation(&git_dir, &common_dir),
            GitConflictOperation::Unknown
        );
        fs::write(git_dir.join("MERGE_HEAD"), b"object\n").expect("merge marker");
        assert_eq!(
            detect_conflict_operation(&git_dir, &common_dir),
            GitConflictOperation::Merge
        );
        fs::remove_file(git_dir.join("MERGE_HEAD")).expect("remove merge marker");
        fs::create_dir(git_dir.join("rebase-merge")).expect("rebase marker");
        assert_eq!(
            detect_conflict_operation(&git_dir, &common_dir),
            GitConflictOperation::Rebase
        );
        fs::remove_dir(git_dir.join("rebase-merge")).expect("remove rebase marker");
        fs::write(common_dir.join("CHERRY_PICK_HEAD"), b"object\n").expect("cherry-pick marker");
        assert_eq!(
            detect_conflict_operation(&git_dir, &common_dir),
            GitConflictOperation::CherryPick
        );

        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;
            fs::remove_file(common_dir.join("CHERRY_PICK_HEAD")).expect("remove marker");
            symlink("elsewhere", git_dir.join("REVERT_HEAD")).expect("marker symlink");
            assert_eq!(
                detect_conflict_operation(&git_dir, &common_dir),
                GitConflictOperation::Unknown
            );
        }
    }

    #[test]
    fn lists_real_conflict_stages_without_mutation_and_rejects_index_race() {
        let _guard = git_fixture_guard();
        let fixture = ConflictFixture::new();
        let session = fixture.session("conflict-discovery");
        let before = fixture.fingerprint();

        let conflicts = list_conflicts_inner(&session, 100, &CancellationToken::new(), |_| {})
            .expect("list actual merge conflict");
        assert_eq!(conflicts.operation, GitConflictOperation::Merge);
        assert_eq!(conflicts.entries.len(), 1);
        assert_eq!(conflicts.entries[0].path.display_path, "conflict.txt");
        assert!(conflicts.entries[0].stage1.is_some());
        assert!(conflicts.entries[0].stage2.is_some());
        assert!(conflicts.entries[0].stage3.is_some());
        assert_eq!(fixture.fingerprint(), before);

        let index_path = fixture.repository.join(".git/index");
        let original_index = fs::read(&index_path).expect("index before race");
        let result = list_conflicts_inner(&session, 100, &CancellationToken::new(), |step| {
            if step == ConflictReadStep::AfterCommand {
                fs::write(&index_path, b"changed during conflict discovery")
                    .expect("inject index race");
            }
        });
        fs::write(&index_path, original_index).expect("restore index fixture");
        assert_eq!(result, Err(GitConflictError::IndexChanged));
    }

    #[test]
    fn saves_only_the_conflict_result_with_backup_and_keeps_git_state_unmerged() {
        let _guard = git_fixture_guard();
        let fixture = ConflictFixture::new();
        let session = fixture.session("conflict-save");
        let cancellation = CancellationToken::new();
        let opened = fixture.open_conflict(&session, &cancellation);
        let git_before = fixture.git_state_fingerprint();
        let original_result = fs::read(fixture.repository.join("conflict.txt")).expect("Result");

        let saved = save_conflict_result(
            &session,
            ConflictSaveInput {
                path: opened.path.clone(),
                generation: opened.generation,
                expected_stage_fingerprint: opened.stage_fingerprint.clone(),
                expected_result_fingerprint: opened.result_fingerprint.clone(),
                text: "resolved without markers\n".to_string(),
                encoding_policy: GitConflictEncodingPolicy::PreserveResult,
                line_ending_policy: GitConflictLineEndingPolicy::PreserveResult,
                create_backup: true,
                explicit_overwrite_decision: false,
            },
            &cancellation,
        )
        .expect("save conflict Result");

        assert_eq!(saved.action, GitConflictSaveAction::ConflictSaved);
        assert_eq!(
            fs::read_to_string(fixture.repository.join("conflict.txt")).expect("saved Result"),
            "resolved without markers\n"
        );
        let backup = saved
            .write_result
            .backup_path
            .as_ref()
            .expect("backup path");
        assert_eq!(fs::read(backup).expect("backup bytes"), original_result);
        assert_eq!(fixture.git_state_fingerprint(), git_before);
        let still_unmerged = list_conflicts_inner(&session, 100, &cancellation, |_| {})
            .expect("refresh conflict state");
        assert_eq!(still_unmerged.entries.len(), 1);
    }

    #[test]
    fn rejects_unresolved_text_and_stale_result_or_stage_without_touching_the_result() {
        let _guard = git_fixture_guard();
        let fixture = ConflictFixture::new();
        let session = fixture.session("conflict-save-stale");
        let cancellation = CancellationToken::new();
        let opened = fixture.open_conflict(&session, &cancellation);
        let target = fixture.repository.join("conflict.txt");
        let original = fs::read(&target).expect("original Result");
        let input = ConflictSaveInput {
            path: opened.path.clone(),
            generation: opened.generation,
            expected_stage_fingerprint: opened.stage_fingerprint.clone(),
            expected_result_fingerprint: opened.result_fingerprint.clone(),
            text: "<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> other\n".to_string(),
            encoding_policy: GitConflictEncodingPolicy::Utf8,
            line_ending_policy: GitConflictLineEndingPolicy::Lf,
            create_backup: true,
            explicit_overwrite_decision: false,
        };

        assert!(matches!(
            save_conflict_result(&session, input.clone(), &cancellation),
            Err(GitConflictSaveError::UnresolvedMarkers)
        ));
        assert_eq!(fs::read(&target).expect("unresolved rejection"), original);

        fs::write(&target, b"external change\n").expect("external Result change");
        let externally_changed = fs::read(&target).expect("changed Result");
        let mut clean = input;
        clean.text = "resolved\n".to_string();
        assert!(matches!(
            save_conflict_result(&session, clean.clone(), &cancellation),
            Err(GitConflictSaveError::ResultChanged)
        ));
        assert_eq!(
            fs::read(&target).expect("stale rejection"),
            externally_changed
        );

        fs::remove_file(&target).expect("delete Result externally");
        assert!(matches!(
            save_conflict_result(&session, clean.clone(), &cancellation),
            Err(GitConflictSaveError::ResultChanged)
        ));
        assert!(!target.exists());
        fs::write(&target, &externally_changed).expect("restore external Result");

        fixture.run(["add", "--", "conflict.txt"]);
        clean.explicit_overwrite_decision = true;
        assert!(matches!(
            save_conflict_result(&session, clean, &cancellation),
            Err(GitConflictSaveError::ConflictStateChanged)
        ));
        assert_eq!(
            fs::read(&target).expect("stage rejection"),
            externally_changed
        );
    }

    #[test]
    fn creates_an_explicitly_missing_result_without_backup() {
        let _guard = git_fixture_guard();
        let fixture = ConflictFixture::new();
        let session = fixture.session("conflict-save-missing");
        let cancellation = CancellationToken::new();
        let opened = fixture.open_conflict(&session, &cancellation);
        let target = fixture.repository.join("conflict.txt");
        fs::remove_file(&target).expect("remove Result before open");
        let missing = crate::git::session::open_conflict_session(
            &session,
            &opened.path,
            opened.generation,
            &cancellation,
        )
        .expect("open missing Result");

        let saved = save_conflict_result(
            &session,
            ConflictSaveInput {
                path: missing.path,
                generation: missing.generation,
                expected_stage_fingerprint: missing.stage_fingerprint,
                expected_result_fingerprint: missing.result_fingerprint,
                text: "new Result\n".to_string(),
                encoding_policy: GitConflictEncodingPolicy::Utf8,
                line_ending_policy: GitConflictLineEndingPolicy::Lf,
                create_backup: true,
                explicit_overwrite_decision: false,
            },
            &cancellation,
        )
        .expect("save missing Result");

        assert_eq!(saved.write_result.backup_path, None);
        assert_eq!(
            fs::read_to_string(target).expect("created Result"),
            "new Result\n"
        );
    }

    #[cfg(unix)]
    #[test]
    fn rejects_a_conflict_result_symlink_without_reading_or_replacing_its_target() {
        use std::os::unix::fs::symlink;

        let _guard = git_fixture_guard();
        let fixture = ConflictFixture::new();
        let session = fixture.session("conflict-save-symlink");
        let cancellation = CancellationToken::new();
        let opened = fixture.open_conflict(&session, &cancellation);
        let target = fixture.repository.join("conflict.txt");
        let outside = fixture._temp.path().join("outside-secret.txt");
        fs::write(&outside, b"outside secret\n").expect("outside fixture");
        fs::remove_file(&target).expect("remove Result");
        symlink(&outside, &target).expect("Result symlink");

        let result = save_conflict_result(
            &session,
            ConflictSaveInput {
                path: opened.path,
                generation: opened.generation,
                expected_stage_fingerprint: opened.stage_fingerprint,
                expected_result_fingerprint: opened.result_fingerprint,
                text: "replacement\n".to_string(),
                encoding_policy: GitConflictEncodingPolicy::Utf8,
                line_ending_policy: GitConflictLineEndingPolicy::Lf,
                create_backup: true,
                explicit_overwrite_decision: true,
            },
            &cancellation,
        );

        assert!(matches!(
            result,
            Err(GitConflictSaveError::ResultUnsupported)
        ));
        assert_eq!(
            fs::read_to_string(&outside).expect("outside remains"),
            "outside secret\n"
        );
        assert!(
            fs::symlink_metadata(&target)
                .expect("symlink remains")
                .file_type()
                .is_symlink()
        );
    }

    #[test]
    fn a_pre_replace_race_or_atomic_write_fault_preserves_the_original_result() {
        let _guard = git_fixture_guard();
        let fixture = ConflictFixture::new();
        let session = fixture.session("conflict-save-race");
        let cancellation = CancellationToken::new();
        let opened = fixture.open_conflict(&session, &cancellation);
        let target = fixture.repository.join("conflict.txt");
        let input = ConflictSaveInput {
            path: opened.path,
            generation: opened.generation,
            expected_stage_fingerprint: opened.stage_fingerprint,
            expected_result_fingerprint: opened.result_fingerprint,
            text: "resolved\n".to_string(),
            encoding_policy: GitConflictEncodingPolicy::Utf8,
            line_ending_policy: GitConflictLineEndingPolicy::Lf,
            create_backup: true,
            explicit_overwrite_decision: false,
        };

        let original = fs::read(&target).expect("original Result");
        for fault_step in [SaveStep::BackupCopy, SaveStep::Replace] {
            let result =
                save_conflict_result_inner(&session, input.clone(), &cancellation, |step| {
                    if step == ConflictSaveStep::AtomicWrite(fault_step) {
                        return Err(GitConflictSaveError::Write(CommandError::new(
                            AppErrorCode::WriteFailed,
                            "injected conflict save fault",
                        )));
                    }
                    Ok(())
                });
            assert!(matches!(result, Err(GitConflictSaveError::Write(_))));
            assert_eq!(
                fs::read(&target).expect("fault preserves Result"),
                original,
                "Result changed after {fault_step:?} fault"
            );
        }

        let result = save_conflict_result_inner(&session, input, &cancellation, |step| {
            if step == ConflictSaveStep::BeforeReplaceValidation {
                fs::write(&target, b"raced externally\n").expect("inject Result race");
            }
            Ok(())
        });
        assert!(matches!(result, Err(GitConflictSaveError::ResultChanged)));
        assert_eq!(
            fs::read_to_string(&target).expect("race bytes"),
            "raced externally\n"
        );
    }

    fn git_fixture_guard() -> MutexGuard<'static, ()> {
        crate::git::GIT_FIXTURE_LOCK
            .lock()
            .expect("Git fixture lock")
    }

    struct ConflictFixture {
        _temp: TempDir,
        repository: PathBuf,
        home: PathBuf,
        git: PathBuf,
    }

    impl ConflictFixture {
        fn new() -> Self {
            let temp = tempdir().expect("conflict fixture root");
            let repository = temp.path().join("Conflict Repository 한글");
            let home = temp.path().join("isolated-home");
            fs::create_dir_all(&repository).expect("repository root");
            fs::create_dir_all(&home).expect("fixture home");
            fs::write(home.join(".gitconfig"), b"").expect("empty global config");
            let git = ValidatedGitExecutable::discover(None)
                .expect("supported Git")
                .path()
                .to_path_buf();
            let fixture = Self {
                _temp: temp,
                repository,
                home,
                git,
            };
            fixture.run(["init", "-b", "main", "."]);
            fs::write(fixture.repository.join("conflict.txt"), b"base\n").expect("base");
            fixture.run(["add", "--", "conflict.txt"]);
            fixture.commit("base");
            fixture.run(["checkout", "-b", "other"]);
            fs::write(fixture.repository.join("conflict.txt"), b"other\n").expect("other");
            fixture.run(["add", "--", "conflict.txt"]);
            fixture.commit("other");
            fixture.run(["checkout", "main"]);
            fs::write(fixture.repository.join("conflict.txt"), b"main\n").expect("main");
            fixture.run(["add", "--", "conflict.txt"]);
            fixture.commit("main");
            let merge = fixture.run_allow_failure(["merge", "--no-edit", "other"]);
            assert!(!merge.status.success(), "fixture merge must conflict");
            fixture
        }

        fn session(&self, id: &str) -> GitRepositorySession {
            GitRepositorySession::open(
                id.to_string(),
                self.repository.clone(),
                ValidatedGitExecutable::discover(Some(self.git.clone()))
                    .expect("fixture Git runtime"),
            )
            .expect("open fixture session")
        }

        fn commit(&self, message: &str) {
            self.run([
                "-c",
                "user.name=Forktail Fixture",
                "-c",
                "user.email=fixture@example.invalid",
                "commit",
                "--no-gpg-sign",
                "-m",
                message,
            ]);
        }

        fn fingerprint(&self) -> (Vec<u8>, Vec<u8>, Vec<u8>) {
            (
                fs::read(self.repository.join(".git/HEAD")).expect("HEAD"),
                fs::read(self.repository.join(".git/index")).expect("index"),
                fs::read(self.repository.join("conflict.txt")).expect("result"),
            )
        }

        fn git_state_fingerprint(&self) -> (Vec<u8>, Vec<u8>, Vec<u8>) {
            (
                fs::read(self.repository.join(".git/HEAD")).expect("HEAD"),
                self.run(["show-ref", "--head"]).stdout,
                fs::read(self.repository.join(".git/index")).expect("index"),
            )
        }

        fn open_conflict(
            &self,
            session: &GitRepositorySession,
            cancellation: &CancellationToken,
        ) -> crate::GitConflictSession {
            let conflicts =
                list_conflicts_inner(session, 100, cancellation, |_| {}).expect("list conflict");
            let entry = conflicts.entries.first().expect("conflict entry");
            crate::git::session::open_conflict_session(
                session,
                &entry.path,
                conflicts.generation,
                cancellation,
            )
            .expect("open conflict")
        }

        fn run<I, S>(&self, arguments: I) -> Output
        where
            I: IntoIterator<Item = S>,
            S: AsRef<OsStr>,
        {
            let output = self.run_allow_failure(arguments);
            assert!(
                output.status.success(),
                "fixture Git failed: {}",
                String::from_utf8_lossy(&output.stderr)
            );
            output
        }

        fn run_allow_failure<I, S>(&self, arguments: I) -> Output
        where
            I: IntoIterator<Item = S>,
            S: AsRef<OsStr>,
        {
            let mut command = Command::new(&self.git);
            command
                .current_dir(&self.repository)
                .args(arguments)
                .env_clear()
                .env("HOME", &self.home)
                .env("USERPROFILE", &self.home)
                .env("GIT_CONFIG_NOSYSTEM", "1")
                .env("GIT_CONFIG_GLOBAL", self.home.join(".gitconfig"))
                .env("GIT_TERMINAL_PROMPT", "0")
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped());
            for key in ["SYSTEMROOT", "WINDIR", "TEMP", "TMP", "TMPDIR", "LANG"] {
                if let Some(value) = std::env::var_os(key) {
                    command.env(key, value);
                }
            }
            command.output().expect("fixture Git output")
        }
    }
}
