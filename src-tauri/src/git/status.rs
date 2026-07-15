use crate::domain::git::{
    GitObjectAlgorithm, GitObjectId, GitPathIdentity, GitPathRegistryError, GitStatusBranch,
    GitStatusBranchState, GitStatusChangeKind, GitStatusEntry, GitStatusSnapshot,
    GitSubmoduleStatus, GitUnmergedStatusEntry,
};
use crate::git::repository::GitRepositorySession;
use crate::git::runner::{CancellationToken, GitOperation, RunnerError, STATUS_STDOUT_CAP};

pub const MAX_STATUS_ENTRIES: usize = 10_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GitStatusError {
    Runner(RunnerError),
    InvalidLimit,
    CommandFailed,
    OutputTooLarge,
    TruncatedOutput,
    MissingBranch,
    DuplicateHeader,
    InvalidHeader,
    InvalidBranch,
    InvalidRecord,
    InvalidStatus,
    InvalidSubmodule,
    InvalidMode,
    InvalidObjectId,
    InvalidScore,
    MissingPath,
    InvalidPath,
    StateUnavailable,
    StaleGeneration,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ParsedStatusSnapshot {
    branch: GitStatusBranch,
    entries: Vec<ParsedStatusEntry>,
    untracked: Vec<Vec<u8>>,
    truncated: bool,
    total_entries: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum ParsedStatusEntry {
    Tracked(ParsedTrackedStatusEntry),
    Unmerged(ParsedUnmergedStatusEntry),
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ParsedTrackedStatusEntry {
    index_change: Option<GitStatusChangeKind>,
    worktree_change: Option<GitStatusChangeKind>,
    submodule: GitSubmoduleStatus,
    head_mode: Option<String>,
    index_mode: Option<String>,
    worktree_mode: Option<String>,
    head_object: Option<GitObjectId>,
    index_object: Option<GitObjectId>,
    path: Vec<u8>,
    original_path: Option<Vec<u8>>,
    similarity_score: Option<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ParsedUnmergedStatusEntry {
    conflict_code: String,
    submodule: GitSubmoduleStatus,
    stage1_mode: Option<String>,
    stage2_mode: Option<String>,
    stage3_mode: Option<String>,
    worktree_mode: Option<String>,
    stage1_object: Option<GitObjectId>,
    stage2_object: Option<GitObjectId>,
    stage3_object: Option<GitObjectId>,
    path: Vec<u8>,
}

#[derive(Default)]
struct BranchHeaders {
    oid: Option<Vec<u8>>,
    head: Option<Vec<u8>>,
    upstream: Option<Vec<u8>>,
    ahead_behind: Option<(u64, u64)>,
}

pub fn read_status(
    session: &GitRepositorySession,
    limit: usize,
    cancellation: &CancellationToken,
) -> Result<GitStatusSnapshot, GitStatusError> {
    validate_limit(limit)?;
    let expected_generation = session
        .paths()
        .lock()
        .map_err(|_| GitStatusError::StateUnavailable)?
        .generation();
    let output = session
        .executable()
        .runner()
        .run(
            GitOperation::Status {
                repository: session.identity().root.clone(),
            },
            cancellation,
        )
        .map_err(GitStatusError::Runner)?;
    if !output.success {
        return Err(GitStatusError::CommandFailed);
    }
    let parsed = parse_status_records(&output.stdout, session.identity().object_format, limit)?;
    materialize_status(session, expected_generation, parsed)
}

fn parse_status_records(
    output: &[u8],
    algorithm: GitObjectAlgorithm,
    limit: usize,
) -> Result<ParsedStatusSnapshot, GitStatusError> {
    validate_limit(limit)?;
    if output.len() > STATUS_STDOUT_CAP {
        return Err(GitStatusError::OutputTooLarge);
    }
    if output.is_empty() {
        return Err(GitStatusError::MissingBranch);
    }
    if !output.ends_with(b"\0") {
        return Err(GitStatusError::TruncatedOutput);
    }

    let records = output[..output.len() - 1]
        .split(|byte| *byte == 0)
        .collect::<Vec<_>>();
    let mut headers = BranchHeaders::default();
    let mut entries = Vec::new();
    let mut untracked = Vec::new();
    let mut total_entries = 0u64;
    let mut index = 0usize;
    while index < records.len() {
        let record = records[index];
        index += 1;
        if record.starts_with(b"# ") {
            parse_header(record, &mut headers)?;
            continue;
        }

        total_entries = total_entries
            .checked_add(1)
            .ok_or(GitStatusError::OutputTooLarge)?;
        let store = total_entries <= limit as u64;
        match record.first().copied() {
            Some(b'1') => {
                let entry = parse_ordinary_record(record, algorithm)?;
                if store {
                    entries.push(ParsedStatusEntry::Tracked(entry));
                }
            }
            Some(b'2') => {
                let original_path = records.get(index).ok_or(GitStatusError::MissingPath)?;
                index += 1;
                validate_path(original_path)?;
                let entry = parse_rename_record(record, original_path, algorithm)?;
                if store {
                    entries.push(ParsedStatusEntry::Tracked(entry));
                }
            }
            Some(b'u') => {
                let entry = parse_unmerged_record(record, algorithm)?;
                if store {
                    entries.push(ParsedStatusEntry::Unmerged(entry));
                }
            }
            Some(b'?') => {
                let path = record
                    .strip_prefix(b"? ")
                    .ok_or(GitStatusError::InvalidRecord)?;
                validate_path(path)?;
                if store {
                    untracked.push(path.to_vec());
                }
            }
            _ => return Err(GitStatusError::InvalidRecord),
        }
    }

    Ok(ParsedStatusSnapshot {
        branch: build_branch(headers, algorithm)?,
        entries,
        untracked,
        truncated: total_entries > limit as u64,
        total_entries,
    })
}

fn parse_header(record: &[u8], headers: &mut BranchHeaders) -> Result<(), GitStatusError> {
    if let Some(value) = record.strip_prefix(b"# branch.oid ") {
        set_header(&mut headers.oid, value)
    } else if let Some(value) = record.strip_prefix(b"# branch.head ") {
        set_header(&mut headers.head, value)
    } else if let Some(value) = record.strip_prefix(b"# branch.upstream ") {
        set_header(&mut headers.upstream, value)
    } else if let Some(value) = record.strip_prefix(b"# branch.ab ") {
        if headers.ahead_behind.is_some() {
            return Err(GitStatusError::DuplicateHeader);
        }
        headers.ahead_behind = Some(parse_ahead_behind(value)?);
        Ok(())
    } else {
        Ok(())
    }
}

fn set_header(slot: &mut Option<Vec<u8>>, value: &[u8]) -> Result<(), GitStatusError> {
    if slot.is_some() {
        return Err(GitStatusError::DuplicateHeader);
    }
    if value.is_empty() {
        return Err(GitStatusError::InvalidHeader);
    }
    *slot = Some(value.to_vec());
    Ok(())
}

fn parse_ahead_behind(value: &[u8]) -> Result<(u64, u64), GitStatusError> {
    let fields = value.split(|byte| *byte == b' ').collect::<Vec<_>>();
    if fields.len() != 2 {
        return Err(GitStatusError::InvalidHeader);
    }
    let ahead = parse_prefixed_u64(fields[0], b'+')?;
    let behind = parse_prefixed_u64(fields[1], b'-')?;
    Ok((ahead, behind))
}

fn parse_prefixed_u64(value: &[u8], prefix: u8) -> Result<u64, GitStatusError> {
    let digits = value
        .strip_prefix(&[prefix])
        .ok_or(GitStatusError::InvalidHeader)?;
    let text = std::str::from_utf8(digits).map_err(|_| GitStatusError::InvalidHeader)?;
    text.parse().map_err(|_| GitStatusError::InvalidHeader)
}

fn build_branch(
    headers: BranchHeaders,
    algorithm: GitObjectAlgorithm,
) -> Result<GitStatusBranch, GitStatusError> {
    let oid = headers.oid.ok_or(GitStatusError::MissingBranch)?;
    let head = headers.head.ok_or(GitStatusError::MissingBranch)?;
    let display_name = parse_header_text(&head)?;
    let state = if oid == b"(initial)" {
        if head == b"(detached)" {
            return Err(GitStatusError::InvalidBranch);
        }
        GitStatusBranchState::Unborn { display_name }
    } else {
        let object_id = parse_required_object_id(&oid, algorithm)?;
        if head == b"(detached)" {
            GitStatusBranchState::Detached { object_id }
        } else {
            GitStatusBranchState::Branch {
                display_name,
                object_id,
            }
        }
    };
    let upstream = headers
        .upstream
        .as_deref()
        .map(parse_header_text)
        .transpose()?;
    if headers.ahead_behind.is_some() && upstream.is_none() {
        return Err(GitStatusError::InvalidBranch);
    }
    let (ahead, behind) = match headers.ahead_behind {
        Some((ahead, behind)) => (Some(ahead), Some(behind)),
        None => (None, None),
    };
    Ok(GitStatusBranch {
        state,
        upstream,
        ahead,
        behind,
    })
}

fn parse_header_text(value: &[u8]) -> Result<String, GitStatusError> {
    let value = std::str::from_utf8(value).map_err(|_| GitStatusError::InvalidHeader)?;
    if value.is_empty() || value.chars().any(char::is_control) {
        return Err(GitStatusError::InvalidHeader);
    }
    Ok(value.to_string())
}

fn parse_ordinary_record(
    record: &[u8],
    algorithm: GitObjectAlgorithm,
) -> Result<ParsedTrackedStatusEntry, GitStatusError> {
    let fields = split_fields(record, 9)?;
    if fields[0] != b"1" {
        return Err(GitStatusError::InvalidRecord);
    }
    let (index_change, worktree_change) = parse_xy(fields[1])?;
    if matches!(
        index_change,
        Some(GitStatusChangeKind::Renamed | GitStatusChangeKind::Copied)
    ) || matches!(
        worktree_change,
        Some(GitStatusChangeKind::Renamed | GitStatusChangeKind::Copied)
    ) || (index_change.is_none() && worktree_change.is_none())
    {
        return Err(GitStatusError::InvalidStatus);
    }
    validate_path(fields[8])?;
    Ok(ParsedTrackedStatusEntry {
        index_change,
        worktree_change,
        submodule: parse_submodule(fields[2])?,
        head_mode: parse_mode(fields[3])?,
        index_mode: parse_mode(fields[4])?,
        worktree_mode: parse_mode(fields[5])?,
        head_object: parse_object_id(fields[6], algorithm)?,
        index_object: parse_object_id(fields[7], algorithm)?,
        path: fields[8].to_vec(),
        original_path: None,
        similarity_score: None,
    })
}

fn parse_rename_record(
    record: &[u8],
    original_path: &[u8],
    algorithm: GitObjectAlgorithm,
) -> Result<ParsedTrackedStatusEntry, GitStatusError> {
    let fields = split_fields(record, 10)?;
    if fields[0] != b"2" {
        return Err(GitStatusError::InvalidRecord);
    }
    let (index_change, worktree_change) = parse_xy(fields[1])?;
    let (score_kind, similarity_score) = parse_score(fields[8])?;
    if index_change != Some(score_kind) && worktree_change != Some(score_kind) {
        return Err(GitStatusError::InvalidStatus);
    }
    validate_path(fields[9])?;
    Ok(ParsedTrackedStatusEntry {
        index_change,
        worktree_change,
        submodule: parse_submodule(fields[2])?,
        head_mode: parse_mode(fields[3])?,
        index_mode: parse_mode(fields[4])?,
        worktree_mode: parse_mode(fields[5])?,
        head_object: parse_object_id(fields[6], algorithm)?,
        index_object: parse_object_id(fields[7], algorithm)?,
        path: fields[9].to_vec(),
        original_path: Some(original_path.to_vec()),
        similarity_score: Some(similarity_score),
    })
}

fn parse_unmerged_record(
    record: &[u8],
    algorithm: GitObjectAlgorithm,
) -> Result<ParsedUnmergedStatusEntry, GitStatusError> {
    let fields = split_fields(record, 11)?;
    if fields[0] != b"u"
        || !matches!(
            fields[1],
            b"DD" | b"AU" | b"UD" | b"UA" | b"DU" | b"AA" | b"UU"
        )
    {
        return Err(GitStatusError::InvalidStatus);
    }
    validate_path(fields[10])?;
    Ok(ParsedUnmergedStatusEntry {
        conflict_code: std::str::from_utf8(fields[1])
            .map_err(|_| GitStatusError::InvalidStatus)?
            .to_string(),
        submodule: parse_submodule(fields[2])?,
        stage1_mode: parse_mode(fields[3])?,
        stage2_mode: parse_mode(fields[4])?,
        stage3_mode: parse_mode(fields[5])?,
        worktree_mode: parse_mode(fields[6])?,
        stage1_object: parse_object_id(fields[7], algorithm)?,
        stage2_object: parse_object_id(fields[8], algorithm)?,
        stage3_object: parse_object_id(fields[9], algorithm)?,
        path: fields[10].to_vec(),
    })
}

fn split_fields(record: &[u8], count: usize) -> Result<Vec<&[u8]>, GitStatusError> {
    let fields = record
        .splitn(count, |byte| *byte == b' ')
        .collect::<Vec<_>>();
    if fields.len() != count || fields.iter().any(|field| field.is_empty()) {
        return Err(GitStatusError::InvalidRecord);
    }
    Ok(fields)
}

fn parse_xy(
    value: &[u8],
) -> Result<(Option<GitStatusChangeKind>, Option<GitStatusChangeKind>), GitStatusError> {
    if value.len() != 2 {
        return Err(GitStatusError::InvalidStatus);
    }
    Ok((parse_change(value[0])?, parse_change(value[1])?))
}

fn parse_change(value: u8) -> Result<Option<GitStatusChangeKind>, GitStatusError> {
    match value {
        b'.' => Ok(None),
        b'M' => Ok(Some(GitStatusChangeKind::Modified)),
        b'T' => Ok(Some(GitStatusChangeKind::TypeChanged)),
        b'A' => Ok(Some(GitStatusChangeKind::Added)),
        b'D' => Ok(Some(GitStatusChangeKind::Deleted)),
        b'R' => Ok(Some(GitStatusChangeKind::Renamed)),
        b'C' => Ok(Some(GitStatusChangeKind::Copied)),
        _ => Err(GitStatusError::InvalidStatus),
    }
}

fn parse_submodule(value: &[u8]) -> Result<GitSubmoduleStatus, GitStatusError> {
    if value == b"N..." {
        return Ok(GitSubmoduleStatus {
            is_submodule: false,
            commit_changed: false,
            tracked_changes: false,
            untracked_changes: false,
        });
    }
    if value.len() != 4
        || value[0] != b'S'
        || !matches!(value[1], b'.' | b'C')
        || !matches!(value[2], b'.' | b'M')
        || !matches!(value[3], b'.' | b'U')
    {
        return Err(GitStatusError::InvalidSubmodule);
    }
    Ok(GitSubmoduleStatus {
        is_submodule: true,
        commit_changed: value[1] == b'C',
        tracked_changes: value[2] == b'M',
        untracked_changes: value[3] == b'U',
    })
}

fn parse_mode(value: &[u8]) -> Result<Option<String>, GitStatusError> {
    if value.len() != 6 || !value.iter().all(|byte| matches!(byte, b'0'..=b'7')) {
        return Err(GitStatusError::InvalidMode);
    }
    if value.iter().all(|byte| *byte == b'0') {
        return Ok(None);
    }
    Ok(Some(
        std::str::from_utf8(value)
            .map_err(|_| GitStatusError::InvalidMode)?
            .to_string(),
    ))
}

fn parse_object_id(
    value: &[u8],
    algorithm: GitObjectAlgorithm,
) -> Result<Option<GitObjectId>, GitStatusError> {
    if value.iter().all(|byte| *byte == b'0') {
        let expected = match algorithm {
            GitObjectAlgorithm::Sha1 => 40,
            GitObjectAlgorithm::Sha256 => 64,
            GitObjectAlgorithm::Unknown => value.len(),
        };
        if value.len() != expected || value.is_empty() {
            return Err(GitStatusError::InvalidObjectId);
        }
        return Ok(None);
    }
    parse_required_object_id(value, algorithm).map(Some)
}

fn parse_required_object_id(
    value: &[u8],
    algorithm: GitObjectAlgorithm,
) -> Result<GitObjectId, GitStatusError> {
    let value = std::str::from_utf8(value).map_err(|_| GitStatusError::InvalidObjectId)?;
    GitObjectId::try_new(algorithm, value.to_string()).map_err(|_| GitStatusError::InvalidObjectId)
}

fn parse_score(value: &[u8]) -> Result<(GitStatusChangeKind, u8), GitStatusError> {
    if value.len() != 4 || !matches!(value[0], b'R' | b'C') {
        return Err(GitStatusError::InvalidScore);
    }
    let score = std::str::from_utf8(&value[1..])
        .map_err(|_| GitStatusError::InvalidScore)?
        .parse::<u8>()
        .map_err(|_| GitStatusError::InvalidScore)?;
    if score > 100 {
        return Err(GitStatusError::InvalidScore);
    }
    Ok((
        if value[0] == b'R' {
            GitStatusChangeKind::Renamed
        } else {
            GitStatusChangeKind::Copied
        },
        score,
    ))
}

fn validate_path(path: &[u8]) -> Result<(), GitStatusError> {
    if path.is_empty()
        || path.starts_with(b"/")
        || path
            .split(|byte| *byte == b'/')
            .any(|component| component.is_empty() || matches!(component, b"." | b".."))
    {
        Err(GitStatusError::InvalidPath)
    } else {
        Ok(())
    }
}

fn validate_limit(limit: usize) -> Result<(), GitStatusError> {
    if (1..=MAX_STATUS_ENTRIES).contains(&limit) {
        Ok(())
    } else {
        Err(GitStatusError::InvalidLimit)
    }
}

fn materialize_status(
    session: &GitRepositorySession,
    expected_generation: u64,
    parsed: ParsedStatusSnapshot,
) -> Result<GitStatusSnapshot, GitStatusError> {
    let mut paths = session
        .paths()
        .lock()
        .map_err(|_| GitStatusError::StateUnavailable)?;
    if paths.generation() != expected_generation {
        return Err(GitStatusError::StaleGeneration);
    }
    paths.refresh().map_err(map_path_error)?;
    let generation = paths.generation();
    let mut staged = Vec::new();
    let mut unstaged = Vec::new();
    let mut unmerged = Vec::new();

    for entry in parsed.entries {
        match entry {
            ParsedStatusEntry::Tracked(entry) => {
                let path = paths.register(entry.path.clone()).map_err(map_path_error)?;
                let original_path = entry
                    .original_path
                    .as_ref()
                    .map(|path| paths.register(path.clone()).map_err(map_path_error))
                    .transpose()?;
                if let Some(change) = entry.index_change {
                    staged.push(materialized_tracked_entry(
                        &entry,
                        change,
                        path.clone(),
                        rename_metadata(change, &original_path, entry.similarity_score),
                    ));
                }
                if let Some(change) = entry.worktree_change {
                    unstaged.push(materialized_tracked_entry(
                        &entry,
                        change,
                        path,
                        rename_metadata(change, &original_path, entry.similarity_score),
                    ));
                }
            }
            ParsedStatusEntry::Unmerged(entry) => {
                let path = paths.register(entry.path).map_err(map_path_error)?;
                unmerged.push(GitUnmergedStatusEntry {
                    conflict_code: entry.conflict_code,
                    path,
                    submodule: entry.submodule,
                    stage1_mode: entry.stage1_mode,
                    stage2_mode: entry.stage2_mode,
                    stage3_mode: entry.stage3_mode,
                    worktree_mode: entry.worktree_mode,
                    stage1_object_id: entry.stage1_object,
                    stage2_object_id: entry.stage2_object,
                    stage3_object_id: entry.stage3_object,
                });
            }
        }
    }
    let untracked = parsed
        .untracked
        .into_iter()
        .map(|path| paths.register(path).map_err(map_path_error))
        .collect::<Result<Vec<_>, _>>()?;

    Ok(GitStatusSnapshot {
        branch: parsed.branch,
        staged,
        unstaged,
        untracked,
        unmerged,
        truncated: parsed.truncated,
        total_entries: parsed.total_entries,
        generation,
    })
}

fn rename_metadata(
    change: GitStatusChangeKind,
    original_path: &Option<GitPathIdentity>,
    similarity_score: Option<u8>,
) -> (Option<GitPathIdentity>, Option<u8>) {
    if matches!(
        change,
        GitStatusChangeKind::Renamed | GitStatusChangeKind::Copied
    ) {
        (original_path.clone(), similarity_score)
    } else {
        (None, None)
    }
}

fn materialized_tracked_entry(
    entry: &ParsedTrackedStatusEntry,
    change: GitStatusChangeKind,
    path: GitPathIdentity,
    rename: (Option<GitPathIdentity>, Option<u8>),
) -> GitStatusEntry {
    GitStatusEntry {
        change,
        path,
        original_path: rename.0,
        similarity_score: rename.1,
        submodule: entry.submodule,
        head_mode: entry.head_mode.clone(),
        index_mode: entry.index_mode.clone(),
        worktree_mode: entry.worktree_mode.clone(),
        head_object_id: entry.head_object.clone(),
        index_object_id: entry.index_object.clone(),
    }
}

fn map_path_error(error: GitPathRegistryError) -> GitStatusError {
    match error {
        GitPathRegistryError::StaleGeneration => GitStatusError::StaleGeneration,
        GitPathRegistryError::EmptyPath | GitPathRegistryError::PathContainsNul => {
            GitStatusError::InvalidPath
        }
        GitPathRegistryError::DuplicateOpaqueId
        | GitPathRegistryError::UnknownOpaqueId
        | GitPathRegistryError::PlatformConversionUnsupported
        | GitPathRegistryError::GenerationExhausted
        | GitPathRegistryError::OpaqueIdExhausted => GitStatusError::StateUnavailable,
    }
}

#[cfg(test)]
mod tests {
    use super::{GitStatusError, ParsedStatusEntry, parse_status_records, read_status};
    use crate::domain::git::{GitObjectAlgorithm, GitStatusBranchState, GitStatusChangeKind};
    use crate::git::executable::ValidatedGitExecutable;
    use crate::git::repository::GitRepositorySession;
    use crate::git::runner::CancellationToken;
    use std::ffi::OsStr;
    use std::fs;
    use std::path::PathBuf;
    use std::process::{Command, Output, Stdio};
    use std::sync::MutexGuard;
    use std::time::SystemTime;
    use tempfile::{TempDir, tempdir};

    fn sha(digit: u8) -> Vec<u8> {
        vec![digit; 40]
    }

    fn append_record(output: &mut Vec<u8>, record: &[u8]) {
        output.extend_from_slice(record);
        output.push(0);
    }

    #[test]
    fn parses_branch_tracking_and_keeps_staged_and_unstaged_status_separate() {
        let head = sha(b'a');
        let index = sha(b'b');
        let mut output = Vec::new();
        append_record(&mut output, &[b"# branch.oid ".as_slice(), &head].concat());
        append_record(&mut output, b"# branch.head main");
        append_record(&mut output, b"# branch.upstream origin/main");
        append_record(&mut output, b"# branch.ab +2 -3");
        append_record(
            &mut output,
            &[
                b"1 MM N... 100644 100644 100644 ".as_slice(),
                &head,
                b" ",
                &index,
                b" src/both changed.txt",
            ]
            .concat(),
        );
        append_record(
            &mut output,
            &[
                b"1 .D N... 100644 100644 000000 ".as_slice(),
                &head,
                b" ",
                &index,
                b" src/deleted.txt",
            ]
            .concat(),
        );
        append_record(&mut output, b"? new\tfile\xff.txt");

        let parsed = parse_status_records(&output, GitObjectAlgorithm::Sha1, 16)
            .expect("valid porcelain v2 status");

        assert_eq!(
            parsed.branch.state,
            GitStatusBranchState::Branch {
                display_name: "main".to_string(),
                object_id: crate::GitObjectId::try_new(GitObjectAlgorithm::Sha1, "a".repeat(40),)
                    .expect("branch object ID"),
            }
        );
        assert_eq!(parsed.branch.upstream.as_deref(), Some("origin/main"));
        assert_eq!(parsed.branch.ahead, Some(2));
        assert_eq!(parsed.branch.behind, Some(3));
        assert_eq!(parsed.entries.len(), 2);
        let ParsedStatusEntry::Tracked(both) = &parsed.entries[0] else {
            panic!("expected ordinary tracked entry");
        };
        assert_eq!(both.index_change, Some(GitStatusChangeKind::Modified));
        assert_eq!(both.worktree_change, Some(GitStatusChangeKind::Modified));
        assert_eq!(both.path, b"src/both changed.txt");
        let ParsedStatusEntry::Tracked(deleted) = &parsed.entries[1] else {
            panic!("expected deleted tracked entry");
        };
        assert_eq!(deleted.index_change, None);
        assert_eq!(deleted.worktree_change, Some(GitStatusChangeKind::Deleted));
        assert_eq!(deleted.worktree_mode, None);
        assert_eq!(parsed.untracked, vec![b"new\tfile\xff.txt".to_vec()]);
        assert!(!parsed.truncated);
        assert_eq!(parsed.total_entries, 3);
    }

    #[test]
    fn parses_rename_copy_and_submodule_state_with_nul_separated_original_paths() {
        let object = sha(b'c');
        let mut output = Vec::new();
        append_record(
            &mut output,
            &[b"# branch.oid ".as_slice(), &object].concat(),
        );
        append_record(&mut output, b"# branch.head (detached)");
        append_record(
            &mut output,
            &[
                b"2 R. S.MU 100644 100644 100644 ".as_slice(),
                &object,
                b" ",
                &object,
                b" R087 new name.txt",
            ]
            .concat(),
        );
        append_record(&mut output, b"old\nname.txt");
        append_record(
            &mut output,
            &[
                b"2 .C N... 100644 100644 100644 ".as_slice(),
                &object,
                b" ",
                &object,
                b" C075 copy target.txt",
            ]
            .concat(),
        );
        append_record(&mut output, b"copy source.txt");

        let parsed = parse_status_records(&output, GitObjectAlgorithm::Sha1, 8)
            .expect("valid rename/copy records");
        assert!(matches!(
            parsed.branch.state,
            GitStatusBranchState::Detached { .. }
        ));

        let ParsedStatusEntry::Tracked(rename) = &parsed.entries[0] else {
            panic!("expected rename");
        };
        assert_eq!(rename.index_change, Some(GitStatusChangeKind::Renamed));
        assert_eq!(rename.worktree_change, None);
        assert_eq!(rename.path, b"new name.txt");
        assert_eq!(
            rename.original_path.as_deref(),
            Some(b"old\nname.txt".as_slice())
        );
        assert_eq!(rename.similarity_score, Some(87));
        assert!(rename.submodule.is_submodule);
        assert!(!rename.submodule.commit_changed);
        assert!(rename.submodule.tracked_changes);
        assert!(rename.submodule.untracked_changes);

        let ParsedStatusEntry::Tracked(copy) = &parsed.entries[1] else {
            panic!("expected copy");
        };
        assert_eq!(copy.index_change, None);
        assert_eq!(copy.worktree_change, Some(GitStatusChangeKind::Copied));
        assert_eq!(
            copy.original_path.as_deref(),
            Some(b"copy source.txt".as_slice())
        );
        assert_eq!(copy.similarity_score, Some(75));
    }

    #[test]
    fn parses_unmerged_stage_metadata_without_conflating_it_with_xy_changes() {
        let stage1 = sha(b'1');
        let stage2 = sha(b'2');
        let stage3 = sha(b'3');
        let head = sha(b'a');
        let mut output = Vec::new();
        append_record(&mut output, &[b"# branch.oid ".as_slice(), &head].concat());
        append_record(&mut output, b"# branch.head main");
        append_record(
            &mut output,
            &[
                b"u UU N... 100644 100644 100644 100644 ".as_slice(),
                &stage1,
                b" ",
                &stage2,
                b" ",
                &stage3,
                b" conflict.txt",
            ]
            .concat(),
        );

        let parsed = parse_status_records(&output, GitObjectAlgorithm::Sha1, 4)
            .expect("valid unmerged record");
        let ParsedStatusEntry::Unmerged(conflict) = &parsed.entries[0] else {
            panic!("expected unmerged record");
        };
        assert_eq!(conflict.conflict_code, "UU");
        assert_eq!(conflict.path, b"conflict.txt");
        assert_eq!(
            conflict
                .stage1_object
                .as_ref()
                .map(|object| object.hex.as_str()),
            Some("1111111111111111111111111111111111111111"),
        );
        assert_eq!(
            conflict
                .stage2_object
                .as_ref()
                .map(|object| object.hex.as_str()),
            Some("2222222222222222222222222222222222222222"),
        );
        assert_eq!(
            conflict
                .stage3_object
                .as_ref()
                .map(|object| object.hex.as_str()),
            Some("3333333333333333333333333333333333333333"),
        );
    }

    #[test]
    fn distinguishes_unborn_and_detached_heads() {
        let unborn = parse_status_records(
            b"# branch.oid (initial)\0# branch.head topic/new\0",
            GitObjectAlgorithm::Sha1,
            1,
        )
        .expect("unborn branch");
        assert_eq!(
            unborn.branch.state,
            GitStatusBranchState::Unborn {
                display_name: "topic/new".to_string(),
            }
        );

        let detached_output = [
            b"# branch.oid ".as_slice(),
            &sha(b'd'),
            b"\0# branch.head (detached)\0",
        ]
        .concat();
        let detached = parse_status_records(&detached_output, GitObjectAlgorithm::Sha1, 1)
            .expect("detached head");
        assert!(matches!(
            detached.branch.state,
            GitStatusBranchState::Detached { .. }
        ));
    }

    #[test]
    fn rejects_truncation_invalid_fields_duplicate_headers_and_inconsistent_branch_state() {
        let object = sha(b'a');
        let valid_branch = [
            b"# branch.oid ".as_slice(),
            &object,
            b"\0# branch.head main\0",
        ]
        .concat();
        let cases = [
            (
                b"# branch.oid (initial)\0# branch.head main".to_vec(),
                GitStatusError::TruncatedOutput,
            ),
            (
                [
                    valid_branch.as_slice(),
                    b"1 M. BAD 100644 100644 100644 ",
                    &object,
                    b" ",
                    &object,
                    b" path\0",
                ]
                .concat(),
                GitStatusError::InvalidSubmodule,
            ),
            (
                [
                    valid_branch.as_slice(),
                    b"1 M. N... 10064x 100644 100644 ",
                    &object,
                    b" ",
                    &object,
                    b" path\0",
                ]
                .concat(),
                GitStatusError::InvalidMode,
            ),
            (
                [
                    valid_branch.as_slice(),
                    b"2 R. N... 100644 100644 100644 ",
                    &object,
                    b" ",
                    &object,
                    b" R101 new\0old\0",
                ]
                .concat(),
                GitStatusError::InvalidScore,
            ),
            (
                [
                    valid_branch.as_slice(),
                    b"2 R. N... 100644 100644 100644 ",
                    &object,
                    b" ",
                    &object,
                    b" R100 new\0",
                ]
                .concat(),
                GitStatusError::MissingPath,
            ),
            (
                b"# branch.oid (initial)\0# branch.oid (initial)\0# branch.head main\0".to_vec(),
                GitStatusError::DuplicateHeader,
            ),
            (
                b"# branch.oid (initial)\0# branch.head (detached)\0".to_vec(),
                GitStatusError::InvalidBranch,
            ),
            (b"? path\0".to_vec(), GitStatusError::MissingBranch),
        ];

        for (output, expected) in cases {
            assert_eq!(
                parse_status_records(&output, GitObjectAlgorithm::Sha1, 16),
                Err(expected),
            );
        }
        assert_eq!(
            parse_status_records(&valid_branch, GitObjectAlgorithm::Sha1, 0),
            Err(GitStatusError::InvalidLimit),
        );
    }

    #[test]
    fn validates_all_records_but_caps_materialized_entries() {
        let mut output = b"# branch.oid (initial)\0# branch.head main\0".to_vec();
        append_record(&mut output, b"? one");
        append_record(&mut output, b"? two");
        append_record(&mut output, b"? three");

        let parsed =
            parse_status_records(&output, GitObjectAlgorithm::Sha1, 2).expect("bounded status");
        assert_eq!(parsed.untracked, vec![b"one".to_vec(), b"two".to_vec()]);
        assert!(parsed.truncated);
        assert_eq!(parsed.total_entries, 3);
    }

    #[test]
    fn status_service_reads_dirty_rename_and_untracked_without_mutating_repository() {
        let _fixture_guard = git_fixture_guard();
        let fixture = StatusFixture::dirty();
        let session = fixture.session("dirty-status-session");
        let before = fixture.fingerprint(&["both.txt", "new name.txt", "untracked.txt"]);

        let result =
            read_status(&session, 32, &CancellationToken::new()).expect("dirty status snapshot");

        assert!(result.staged.iter().any(|entry| {
            entry.change == GitStatusChangeKind::Modified
                && entry.path.utf8_path.as_deref() == Some("both.txt")
        }));
        assert!(result.unstaged.iter().any(|entry| {
            entry.change == GitStatusChangeKind::Modified
                && entry.path.utf8_path.as_deref() == Some("both.txt")
        }));
        let renamed = result
            .staged
            .iter()
            .find(|entry| entry.change == GitStatusChangeKind::Renamed)
            .expect("staged rename");
        assert_eq!(renamed.path.utf8_path.as_deref(), Some("new name.txt"));
        assert_eq!(
            renamed
                .original_path
                .as_ref()
                .and_then(|path| path.utf8_path.as_deref()),
            Some("old name.txt")
        );
        assert_eq!(renamed.similarity_score, Some(100));
        assert!(
            result
                .untracked
                .iter()
                .any(|path| path.utf8_path.as_deref() == Some("untracked.txt"))
        );
        assert!(result.unmerged.is_empty());
        assert!(!result.truncated);
        assert_eq!(
            fixture.fingerprint(&["both.txt", "new name.txt", "untracked.txt"]),
            before
        );
    }

    #[test]
    fn status_service_reads_real_conflict_stages_without_mutating_index() {
        let _fixture_guard = git_fixture_guard();
        let fixture = StatusFixture::conflict();
        let session = fixture.session("conflict-status-session");
        let before = fixture.fingerprint(&["conflict.txt"]);

        let result =
            read_status(&session, 32, &CancellationToken::new()).expect("conflict status snapshot");

        let conflict = result
            .unmerged
            .iter()
            .find(|entry| entry.path.utf8_path.as_deref() == Some("conflict.txt"))
            .expect("unmerged path");
        assert_eq!(conflict.conflict_code, "UU");
        assert!(conflict.stage1_object_id.is_some());
        assert!(conflict.stage2_object_id.is_some());
        assert!(conflict.stage3_object_id.is_some());
        assert_eq!(fixture.fingerprint(&["conflict.txt"]), before);
    }

    fn git_fixture_guard() -> MutexGuard<'static, ()> {
        crate::git::GIT_FIXTURE_LOCK
            .lock()
            .expect("Git fixture lock")
    }

    #[derive(Debug, PartialEq, Eq)]
    struct StatusFingerprint {
        head: Vec<u8>,
        branch: Vec<u8>,
        index: Vec<u8>,
        index_modified: SystemTime,
        config: Vec<u8>,
        working_files: Vec<(String, Vec<u8>)>,
    }

    struct StatusFixture {
        _temp: TempDir,
        repository: PathBuf,
        home: PathBuf,
        git: PathBuf,
    }

    impl StatusFixture {
        fn base() -> Self {
            let temp = tempdir().expect("status fixture root");
            let repository = temp.path().join("Status Repository 한글");
            let home = temp.path().join("isolated-home");
            fs::create_dir_all(&repository).expect("repository directory");
            fs::create_dir_all(&home).expect("fixture home");
            fs::write(home.join(".gitconfig"), b"").expect("empty fixture config");
            let executable = ValidatedGitExecutable::discover(None).expect("supported Git");
            let fixture = Self {
                _temp: temp,
                repository,
                home,
                git: executable.path().to_path_buf(),
            };
            fixture.run(["init", "-b", "main", "."]);
            fixture
        }

        fn dirty() -> Self {
            let fixture = Self::base();
            fs::write(fixture.repository.join("both.txt"), b"base\n").expect("base file");
            fs::write(fixture.repository.join("old name.txt"), b"rename me\n")
                .expect("rename source");
            fixture.run(["add", "--", "."]);
            fixture.commit("base");

            fs::write(fixture.repository.join("both.txt"), b"staged\n").expect("staged change");
            fixture.run(["add", "--", "both.txt"]);
            fs::write(fixture.repository.join("both.txt"), b"worktree\n").expect("worktree change");
            fixture.run(["mv", "--", "old name.txt", "new name.txt"]);
            fs::write(fixture.repository.join("untracked.txt"), b"untracked\n")
                .expect("untracked file");
            fixture
        }

        fn conflict() -> Self {
            let fixture = Self::base();
            fs::write(fixture.repository.join("conflict.txt"), b"base\n")
                .expect("base conflict file");
            fixture.run(["add", "--", "conflict.txt"]);
            fixture.commit("base");

            fixture.run(["checkout", "-b", "other"]);
            fs::write(fixture.repository.join("conflict.txt"), b"other\n").expect("other change");
            fixture.run(["add", "--", "conflict.txt"]);
            fixture.commit("other change");

            fixture.run(["checkout", "main"]);
            fs::write(fixture.repository.join("conflict.txt"), b"main\n").expect("main change");
            fixture.run(["add", "--", "conflict.txt"]);
            fixture.commit("main change");
            let merge = fixture.run_allow_failure(["merge", "--no-edit", "other"]);
            assert!(!merge.status.success(), "fixture merge must conflict");
            fixture
        }

        fn session(&self, session_id: &str) -> GitRepositorySession {
            GitRepositorySession::open(
                session_id.to_string(),
                self.repository.clone(),
                ValidatedGitExecutable::discover(Some(self.git.clone()))
                    .expect("fixture Git runtime"),
            )
            .expect("fixture repository opens")
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

        fn fingerprint(&self, working_paths: &[&str]) -> StatusFingerprint {
            let git_dir = self.repository.join(".git");
            let index_path = git_dir.join("index");
            StatusFingerprint {
                head: fs::read(git_dir.join("HEAD")).expect("HEAD fingerprint"),
                branch: fs::read(git_dir.join("refs/heads/main")).expect("branch fingerprint"),
                index: fs::read(&index_path).expect("index fingerprint"),
                index_modified: fs::metadata(index_path)
                    .and_then(|metadata| metadata.modified())
                    .expect("index mtime"),
                config: fs::read(git_dir.join("config")).expect("config fingerprint"),
                working_files: working_paths
                    .iter()
                    .map(|path| {
                        (
                            (*path).to_string(),
                            fs::read(self.repository.join(path)).expect("working file fingerprint"),
                        )
                    })
                    .collect(),
            }
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
            self.command(arguments)
                .output()
                .expect("fixture Git output")
        }

        fn command<I, S>(&self, arguments: I) -> Command
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
            command
        }
    }
}
