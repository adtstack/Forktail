use crate::domain::git::{
    GitFileHistoryBoundary, GitFileHistoryEntry, GitFileHistoryList, GitObjectAlgorithm,
    GitObjectId, GitPathPlatform, GitPathRegistryError, GitRecentCommitEntry, GitRecentCommitList,
};
use crate::git::repository::GitRepositorySession;
use crate::git::runner::{CancellationToken, GitOperation, RunnerError};
use std::collections::HashSet;
use std::ffi::OsString;

pub const MAX_HISTORY_LIMIT: usize = 500;
pub const MAX_HISTORY_SUBJECT_CHARS: usize = 200;
const MAX_JAVASCRIPT_DATE_TIMESTAMP: i64 = 8_640_000_000_000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GitHistoryError {
    Runner(RunnerError),
    InvalidLimit,
    CommandFailed,
    TruncatedOutput,
    InvalidFieldCount,
    InvalidObjectId,
    InvalidTimestamp,
    InvalidSubject,
    DuplicateCommit,
    TooManyRecords,
    InvalidStatus,
    InvalidPath,
    UnknownPath,
    StalePath,
    PathUnsupported,
    StateUnavailable,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ParsedFileHistoryEntry {
    commit_id: GitObjectId,
    short_display_id: String,
    subject: String,
    author_timestamp: i64,
    path_at_commit: Vec<u8>,
    boundary: GitFileHistoryBoundary,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ParsedFileHistoryList {
    entries: Vec<ParsedFileHistoryEntry>,
    truncated: bool,
    shallow: bool,
}

pub fn list_recent_commits(
    session: &GitRepositorySession,
    start_commit: &GitObjectId,
    limit: usize,
    cancellation: &CancellationToken,
) -> Result<GitRecentCommitList, GitHistoryError> {
    validate_limit(limit)?;
    if start_commit.algorithm != session.identity().object_format {
        return Err(GitHistoryError::InvalidObjectId);
    }
    let max_records = limit.checked_add(1).ok_or(GitHistoryError::InvalidLimit)?;
    let output = session
        .executable()
        .runner()
        .run(
            GitOperation::RecentCommits {
                repository: session.identity().root.clone(),
                start_commit_id: start_commit.hex.clone(),
                max_records,
            },
            cancellation,
        )
        .map_err(GitHistoryError::Runner)?;
    if !output.success {
        return Err(GitHistoryError::CommandFailed);
    }
    parse_recent_commit_records(
        &output.stdout,
        session.identity().object_format,
        limit,
        session.summary().is_shallow,
    )
}

pub fn list_file_history(
    session: &GitRepositorySession,
    start_commit: &GitObjectId,
    opaque_path_id: &str,
    generation: u64,
    limit: usize,
    cancellation: &CancellationToken,
) -> Result<GitFileHistoryList, GitHistoryError> {
    validate_limit(limit)?;
    if start_commit.algorithm != session.identity().object_format {
        return Err(GitHistoryError::InvalidObjectId);
    }
    let raw_path = {
        let paths = session
            .paths()
            .lock()
            .map_err(|_| GitHistoryError::StateUnavailable)?;
        paths
            .resolve(opaque_path_id, generation, current_path_platform())
            .map_err(map_path_error)?
            .to_vec()
    };
    let path = raw_path_to_os_string(raw_path.clone())?;
    let max_records = limit.checked_add(1).ok_or(GitHistoryError::InvalidLimit)?;
    let output = session
        .executable()
        .runner()
        .run(
            GitOperation::FileHistory {
                repository: session.identity().root.clone(),
                start_commit_id: start_commit.hex.clone(),
                path,
                max_records,
            },
            cancellation,
        )
        .map_err(GitHistoryError::Runner)?;
    if !output.success {
        return Err(GitHistoryError::CommandFailed);
    }
    let parsed = parse_file_history_records(
        &output.stdout,
        session.identity().object_format,
        &raw_path,
        limit,
        session.summary().is_shallow,
    )?;
    materialize_file_history(session, generation, parsed)
}

fn materialize_file_history(
    session: &GitRepositorySession,
    generation: u64,
    parsed: ParsedFileHistoryList,
) -> Result<GitFileHistoryList, GitHistoryError> {
    let mut paths = session
        .paths()
        .lock()
        .map_err(|_| GitHistoryError::StateUnavailable)?;
    if paths.generation() != generation {
        return Err(GitHistoryError::StalePath);
    }
    let entries = parsed
        .entries
        .into_iter()
        .map(|entry| {
            Ok(GitFileHistoryEntry {
                commit_id: entry.commit_id,
                short_display_id: entry.short_display_id,
                subject: entry.subject,
                author_timestamp: entry.author_timestamp,
                path_at_commit: paths
                    .register(entry.path_at_commit)
                    .map_err(map_path_error)?,
                boundary: entry.boundary,
            })
        })
        .collect::<Result<Vec<_>, GitHistoryError>>()?;
    Ok(GitFileHistoryList {
        entries,
        truncated: parsed.truncated,
        shallow: parsed.shallow,
        generation,
    })
}

fn parse_recent_commit_records(
    output: &[u8],
    algorithm: GitObjectAlgorithm,
    limit: usize,
    shallow: bool,
) -> Result<GitRecentCommitList, GitHistoryError> {
    validate_limit(limit)?;
    if output.is_empty() {
        return Ok(GitRecentCommitList {
            entries: Vec::new(),
            truncated: false,
            shallow,
        });
    }
    if !output.ends_with(b"\0") {
        return Err(GitHistoryError::TruncatedOutput);
    }

    let fields = output[..output.len() - 1]
        .split(|byte| *byte == 0)
        .collect::<Vec<_>>();
    if fields.len() % 3 != 0 {
        return Err(GitHistoryError::InvalidFieldCount);
    }
    let record_count = fields.len() / 3;
    if record_count > limit + 1 {
        return Err(GitHistoryError::TooManyRecords);
    }

    let mut entries = Vec::with_capacity(record_count.min(limit));
    let mut seen = HashSet::with_capacity(record_count);
    for fields in fields.chunks_exact(3) {
        let entry = parse_recent_commit_record(fields, algorithm)?;
        if !seen.insert(entry.commit_id.hex.clone()) {
            return Err(GitHistoryError::DuplicateCommit);
        }
        if entries.len() < limit {
            entries.push(entry);
        }
    }

    Ok(GitRecentCommitList {
        entries,
        truncated: record_count > limit,
        shallow,
    })
}

fn parse_file_history_records(
    output: &[u8],
    algorithm: GitObjectAlgorithm,
    initial_path: &[u8],
    limit: usize,
    shallow: bool,
) -> Result<ParsedFileHistoryList, GitHistoryError> {
    validate_limit(limit)?;
    validate_history_path(initial_path)?;
    if output.is_empty() {
        return Ok(ParsedFileHistoryList {
            entries: Vec::new(),
            truncated: false,
            shallow,
        });
    }
    if output.first() != Some(&0) || !output.ends_with(b"\0") {
        return Err(GitHistoryError::TruncatedOutput);
    }

    let mut cursor = 0;
    let mut current_path = initial_path.to_vec();
    let mut entries = Vec::new();
    let mut record_count = 0usize;
    let mut seen = HashSet::new();
    while cursor < output.len() {
        if output[cursor] != 0 {
            return Err(GitHistoryError::InvalidFieldCount);
        }
        cursor += 1;
        let object_id = take_nul_field(output, &mut cursor)?;
        let timestamp = take_nul_field(output, &mut cursor)?;
        let subject = take_nul_field(output, &mut cursor)?;
        let metadata = parse_recent_commit_record(&[object_id, timestamp, subject], algorithm)?;
        if !seen.insert(metadata.commit_id.hex.clone()) {
            return Err(GitHistoryError::DuplicateCommit);
        }
        record_count = record_count
            .checked_add(1)
            .ok_or(GitHistoryError::TooManyRecords)?;
        if record_count > limit + 1 {
            return Err(GitHistoryError::TooManyRecords);
        }

        let mut path_at_commit = current_path.clone();
        let mut boundary = GitFileHistoryBoundary::Normal;
        if cursor < output.len() && output[cursor] != 0 {
            if output[cursor] != b'\n' {
                return Err(GitHistoryError::InvalidStatus);
            }
            cursor += 1;
            let status = take_nul_field(output, &mut cursor)?;
            match status.first().copied() {
                Some(b'M' | b'A' | b'T') if status.len() == 1 => {
                    let path = take_nul_field(output, &mut cursor)?;
                    validate_history_path(path)?;
                    if path != current_path {
                        return Err(GitHistoryError::InvalidPath);
                    }
                    path_at_commit = path.to_vec();
                }
                Some(b'D') if status.len() == 1 => {
                    let path = take_nul_field(output, &mut cursor)?;
                    validate_history_path(path)?;
                    if path != current_path {
                        return Err(GitHistoryError::InvalidPath);
                    }
                    path_at_commit = path.to_vec();
                    boundary = GitFileHistoryBoundary::ObjectUnavailable;
                }
                Some(b'R') if valid_rename_status(status) => {
                    let old_path = take_nul_field(output, &mut cursor)?;
                    let new_path = take_nul_field(output, &mut cursor)?;
                    validate_history_path(old_path)?;
                    validate_history_path(new_path)?;
                    if new_path != current_path {
                        return Err(GitHistoryError::InvalidPath);
                    }
                    path_at_commit = new_path.to_vec();
                    current_path = old_path.to_vec();
                    boundary = GitFileHistoryBoundary::RenameBoundary;
                }
                _ => return Err(GitHistoryError::InvalidStatus),
            }
        }

        if entries.len() < limit {
            entries.push(ParsedFileHistoryEntry {
                commit_id: metadata.commit_id,
                short_display_id: metadata.short_display_id,
                subject: metadata.subject,
                author_timestamp: metadata.author_timestamp,
                path_at_commit,
                boundary,
            });
        }
    }

    let truncated = record_count > limit;
    if shallow
        && !truncated
        && let Some(last) = entries.last_mut()
        && last.boundary == GitFileHistoryBoundary::Normal
    {
        last.boundary = GitFileHistoryBoundary::ShallowBoundary;
    }
    Ok(ParsedFileHistoryList {
        entries,
        truncated,
        shallow,
    })
}

fn take_nul_field<'a>(output: &'a [u8], cursor: &mut usize) -> Result<&'a [u8], GitHistoryError> {
    let remaining = output
        .get(*cursor..)
        .ok_or(GitHistoryError::TruncatedOutput)?;
    let length = remaining
        .iter()
        .position(|byte| *byte == 0)
        .ok_or(GitHistoryError::TruncatedOutput)?;
    let field = &remaining[..length];
    *cursor = cursor
        .checked_add(length + 1)
        .ok_or(GitHistoryError::TruncatedOutput)?;
    Ok(field)
}

fn valid_rename_status(status: &[u8]) -> bool {
    status.len() == 4
        && status[0] == b'R'
        && status[1..].iter().all(u8::is_ascii_digit)
        && std::str::from_utf8(&status[1..])
            .ok()
            .and_then(|score| score.parse::<u8>().ok())
            .is_some_and(|score| score <= 100)
}

fn validate_history_path(path: &[u8]) -> Result<(), GitHistoryError> {
    if path.is_empty() || path.contains(&0) {
        Err(GitHistoryError::InvalidPath)
    } else {
        Ok(())
    }
}

fn current_path_platform() -> GitPathPlatform {
    if cfg!(windows) {
        GitPathPlatform::Windows
    } else {
        GitPathPlatform::Unix
    }
}

#[cfg(unix)]
fn raw_path_to_os_string(path: Vec<u8>) -> Result<OsString, GitHistoryError> {
    use std::os::unix::ffi::OsStringExt;
    Ok(OsString::from_vec(path))
}

#[cfg(windows)]
fn raw_path_to_os_string(path: Vec<u8>) -> Result<OsString, GitHistoryError> {
    String::from_utf8(path)
        .map(OsString::from)
        .map_err(|_| GitHistoryError::PathUnsupported)
}

#[cfg(not(any(unix, windows)))]
fn raw_path_to_os_string(path: Vec<u8>) -> Result<OsString, GitHistoryError> {
    String::from_utf8(path)
        .map(OsString::from)
        .map_err(|_| GitHistoryError::PathUnsupported)
}

fn map_path_error(error: GitPathRegistryError) -> GitHistoryError {
    match error {
        GitPathRegistryError::UnknownOpaqueId => GitHistoryError::UnknownPath,
        GitPathRegistryError::StaleGeneration => GitHistoryError::StalePath,
        GitPathRegistryError::PlatformConversionUnsupported => GitHistoryError::PathUnsupported,
        GitPathRegistryError::EmptyPath | GitPathRegistryError::PathContainsNul => {
            GitHistoryError::InvalidPath
        }
        GitPathRegistryError::DuplicateOpaqueId
        | GitPathRegistryError::GenerationExhausted
        | GitPathRegistryError::OpaqueIdExhausted => GitHistoryError::StateUnavailable,
    }
}

fn validate_limit(limit: usize) -> Result<(), GitHistoryError> {
    if (1..=MAX_HISTORY_LIMIT).contains(&limit) {
        Ok(())
    } else {
        Err(GitHistoryError::InvalidLimit)
    }
}

fn parse_recent_commit_record(
    fields: &[&[u8]],
    algorithm: GitObjectAlgorithm,
) -> Result<GitRecentCommitEntry, GitHistoryError> {
    let [object_id, timestamp, subject] = fields else {
        return Err(GitHistoryError::InvalidFieldCount);
    };
    let object_id = std::str::from_utf8(object_id)
        .map_err(|_| GitHistoryError::InvalidObjectId)
        .and_then(|value| {
            GitObjectId::try_new(algorithm, value).map_err(|_| GitHistoryError::InvalidObjectId)
        })?;
    let timestamp = std::str::from_utf8(timestamp)
        .map_err(|_| GitHistoryError::InvalidTimestamp)?
        .parse::<i64>()
        .map_err(|_| GitHistoryError::InvalidTimestamp)?;
    if !(0..=MAX_JAVASCRIPT_DATE_TIMESTAMP).contains(&timestamp) {
        return Err(GitHistoryError::InvalidTimestamp);
    }
    let subject = std::str::from_utf8(subject).map_err(|_| GitHistoryError::InvalidSubject)?;

    Ok(GitRecentCommitEntry {
        short_display_id: object_id.hex.chars().take(12).collect(),
        commit_id: object_id,
        subject: sanitize_subject(subject),
        author_timestamp: timestamp,
    })
}

fn sanitize_subject(subject: &str) -> String {
    let normalized = subject
        .chars()
        .map(|character| {
            if character.is_control() || character.is_whitespace() {
                ' '
            } else {
                character
            }
        })
        .collect::<String>();
    let normalized = normalized.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.chars().count() <= MAX_HISTORY_SUBJECT_CHARS {
        normalized
    } else {
        normalized
            .chars()
            .take(MAX_HISTORY_SUBJECT_CHARS - 1)
            .chain(std::iter::once('…'))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::{
        GitHistoryError, MAX_HISTORY_LIMIT, MAX_HISTORY_SUBJECT_CHARS, list_file_history,
        list_recent_commits, parse_file_history_records, parse_recent_commit_records,
    };
    use crate::domain::git::{
        GitFileHistoryBoundary, GitObjectAlgorithm, GitObjectId, GitPathPlatform,
    };
    use crate::git::executable::ValidatedGitExecutable;
    use crate::git::repository::GitRepositorySession;
    use crate::git::runner::{CancellationToken, RunnerError};
    use std::ffi::OsStr;
    use std::fs;
    use std::path::PathBuf;
    use std::process::{Command, Output, Stdio};
    use std::sync::MutexGuard;
    use tempfile::{TempDir, tempdir};

    const FIRST_ID: &str = "1111111111111111111111111111111111111111";
    const SECOND_ID: &str = "2222222222222222222222222222222222222222";
    const THIRD_ID: &str = "3333333333333333333333333333333333333333";

    fn record(object_id: &str, timestamp: &str, subject: &[u8]) -> Vec<u8> {
        let mut output = Vec::new();
        output.extend_from_slice(object_id.as_bytes());
        output.push(0);
        output.extend_from_slice(timestamp.as_bytes());
        output.push(0);
        output.extend_from_slice(subject);
        output.push(0);
        output
    }

    fn file_history_record(
        object_id: &str,
        timestamp: &str,
        subject: &[u8],
        status: Option<&[u8]>,
        paths: &[&[u8]],
    ) -> Vec<u8> {
        let mut output = vec![0];
        output.extend(record(object_id, timestamp, subject));
        if let Some(status) = status {
            output.push(b'\n');
            output.extend_from_slice(status);
            output.push(0);
            for path in paths {
                output.extend_from_slice(path);
                output.push(0);
            }
        }
        output
    }

    #[test]
    fn parses_exact_nul_framing_in_newest_first_order() {
        let mut output = record(FIRST_ID, "1700000002", "최신 커밋".as_bytes());
        output.extend(record(SECOND_ID, "1700000001", b"older commit"));

        let parsed = parse_recent_commit_records(&output, GitObjectAlgorithm::Sha1, 50, false)
            .expect("bounded recent commit records");

        assert!(!parsed.truncated);
        assert!(!parsed.shallow);
        assert_eq!(parsed.entries.len(), 2);
        assert_eq!(parsed.entries[0].commit_id.hex, FIRST_ID);
        assert_eq!(parsed.entries[0].short_display_id, &FIRST_ID[..12]);
        assert_eq!(parsed.entries[0].subject, "최신 커밋");
        assert_eq!(parsed.entries[0].author_timestamp, 1_700_000_002);
        assert_eq!(parsed.entries[1].commit_id.hex, SECOND_ID);
    }

    #[test]
    fn reports_limit_plus_one_as_truncated_and_rejects_unbounded_output() {
        let mut output = record(FIRST_ID, "3", b"first");
        output.extend(record(SECOND_ID, "2", b"second"));
        output.extend(record(THIRD_ID, "1", b"third"));

        let parsed = parse_recent_commit_records(&output, GitObjectAlgorithm::Sha1, 2, false)
            .expect("limit plus one is a bounded response");
        assert!(parsed.truncated);
        assert_eq!(parsed.entries.len(), 2);

        output.extend(record(
            "4444444444444444444444444444444444444444",
            "0",
            b"fourth",
        ));
        assert_eq!(
            parse_recent_commit_records(&output, GitObjectAlgorithm::Sha1, 2, false),
            Err(GitHistoryError::TooManyRecords)
        );
    }

    #[test]
    fn sanitizes_control_characters_and_bounds_subject_without_reading_a_body() {
        let long_subject = "가".repeat(MAX_HISTORY_SUBJECT_CHARS + 20);
        let mut output = record(FIRST_ID, "1", b" first\tline\x01  second\r\nline ");
        output.extend(record(SECOND_ID, "0", long_subject.as_bytes()));

        let parsed = parse_recent_commit_records(&output, GitObjectAlgorithm::Sha1, 2, true)
            .expect("sanitized subjects");

        assert!(parsed.shallow);
        assert_eq!(parsed.entries[0].subject, "first line second line");
        assert_eq!(
            parsed.entries[1].subject.chars().count(),
            MAX_HISTORY_SUBJECT_CHARS
        );
        assert!(parsed.entries[1].subject.ends_with('…'));
    }

    #[test]
    fn rejects_invalid_limits_framing_ids_timestamps_and_utf8() {
        let valid = record(FIRST_ID, "1", b"subject");
        let cases = [
            (
                valid[..valid.len() - 1].to_vec(),
                GitHistoryError::TruncatedOutput,
            ),
            (
                record("abc", "1", b"subject"),
                GitHistoryError::InvalidObjectId,
            ),
            (
                record(FIRST_ID, "not-a-time", b"subject"),
                GitHistoryError::InvalidTimestamp,
            ),
            (
                record(FIRST_ID, "9223372036854775807", b"subject"),
                GitHistoryError::InvalidTimestamp,
            ),
            (
                record(FIRST_ID, "1", b"subject\xff"),
                GitHistoryError::InvalidSubject,
            ),
        ];

        for (output, expected) in cases {
            assert_eq!(
                parse_recent_commit_records(&output, GitObjectAlgorithm::Sha1, 50, false),
                Err(expected)
            );
        }
        assert_eq!(
            parse_recent_commit_records(&[], GitObjectAlgorithm::Sha1, 0, false),
            Err(GitHistoryError::InvalidLimit)
        );
        assert_eq!(
            parse_recent_commit_records(
                &[],
                GitObjectAlgorithm::Sha1,
                MAX_HISTORY_LIMIT + 1,
                false,
            ),
            Err(GitHistoryError::InvalidLimit)
        );
    }

    #[test]
    fn follows_rename_boundaries_and_marks_the_local_shallow_boundary() {
        let mut output = file_history_record(
            FIRST_ID,
            "3",
            b"modify new path",
            Some(b"M"),
            &[b"new name.txt"],
        );
        output.extend(file_history_record(
            SECOND_ID,
            "2",
            b"rename",
            Some(b"R100"),
            &[b"old name.txt", b"new name.txt"],
        ));
        output.extend(file_history_record(
            THIRD_ID,
            "1",
            b"create old path",
            Some(b"A"),
            &[b"old name.txt"],
        ));

        let parsed = parse_file_history_records(
            &output,
            GitObjectAlgorithm::Sha1,
            b"new name.txt",
            50,
            true,
        )
        .expect("rename-aware history");

        assert!(!parsed.truncated);
        assert_eq!(parsed.entries.len(), 3);
        assert_eq!(parsed.entries[0].path_at_commit, b"new name.txt");
        assert_eq!(parsed.entries[0].boundary, GitFileHistoryBoundary::Normal);
        assert_eq!(parsed.entries[1].path_at_commit, b"new name.txt");
        assert_eq!(
            parsed.entries[1].boundary,
            GitFileHistoryBoundary::RenameBoundary
        );
        assert_eq!(parsed.entries[2].path_at_commit, b"old name.txt");
        assert_eq!(
            parsed.entries[2].boundary,
            GitFileHistoryBoundary::ShallowBoundary
        );
    }

    #[test]
    fn preserves_non_utf8_paths_and_marks_deleted_commit_snapshots_unavailable() {
        let path = b"src/non-utf8-\xff.txt";
        let mut output = file_history_record(FIRST_ID, "2", b"delete", Some(b"D"), &[path]);
        output.extend(file_history_record(
            SECOND_ID,
            "1",
            b"previous",
            Some(b"M"),
            &[path],
        ));

        let parsed = parse_file_history_records(&output, GitObjectAlgorithm::Sha1, path, 50, false)
            .expect("byte-preserving deleted history");

        assert_eq!(parsed.entries[0].path_at_commit, path);
        assert_eq!(
            parsed.entries[0].boundary,
            GitFileHistoryBoundary::ObjectUnavailable
        );
        assert_eq!(parsed.entries[1].path_at_commit, path);
        assert_eq!(parsed.entries[1].boundary, GitFileHistoryBoundary::Normal);
    }

    #[test]
    fn file_history_bounds_records_and_rejects_malformed_status_or_path_transitions() {
        let mut output = file_history_record(FIRST_ID, "3", b"first", Some(b"M"), &[b"file.txt"]);
        output.extend(file_history_record(SECOND_ID, "2", b"second", None, &[]));
        output.extend(file_history_record(
            THIRD_ID,
            "1",
            b"third",
            Some(b"A"),
            &[b"file.txt"],
        ));
        let parsed =
            parse_file_history_records(&output, GitObjectAlgorithm::Sha1, b"file.txt", 2, false)
                .expect("limit plus one history");
        assert!(parsed.truncated);
        assert_eq!(parsed.entries.len(), 2);

        output.extend(file_history_record(
            "4444444444444444444444444444444444444444",
            "0",
            b"fourth",
            Some(b"M"),
            &[b"file.txt"],
        ));
        assert_eq!(
            parse_file_history_records(&output, GitObjectAlgorithm::Sha1, b"file.txt", 2, false,),
            Err(GitHistoryError::TooManyRecords)
        );

        for malformed in [
            file_history_record(FIRST_ID, "1", b"wrong path", Some(b"M"), &[b"other.txt"]),
            file_history_record(
                FIRST_ID,
                "1",
                b"copy",
                Some(b"C100"),
                &[b"old.txt", b"file.txt"],
            ),
            file_history_record(FIRST_ID, "1", b"bad rename", Some(b"R100"), &[b"old.txt"]),
        ] {
            assert!(matches!(
                parse_file_history_records(
                    &malformed,
                    GitObjectAlgorithm::Sha1,
                    b"file.txt",
                    50,
                    false,
                ),
                Err(GitHistoryError::InvalidStatus
                    | GitHistoryError::InvalidPath
                    | GitHistoryError::TruncatedOutput)
            ));
        }
    }

    #[test]
    fn file_history_cancellation_is_typed_before_materializing_paths() {
        let _fixture_guard = git_fixture_guard();
        let fixture = HistoryFixture::new();
        let session = fixture.session("file-history-cancel-session");
        let path = session
            .paths()
            .lock()
            .expect("path registry")
            .register(b"tracked.txt".to_vec())
            .expect("tracked path");
        let cancellation = CancellationToken::new();
        cancellation.cancel();

        assert_eq!(
            list_file_history(
                &session,
                &fixture.head_object_id(),
                &path.opaque_id,
                0,
                50,
                &cancellation,
            ),
            Err(GitHistoryError::Runner(RunnerError::Cancelled))
        );
    }

    #[test]
    fn file_history_rejects_a_stale_path_generation_before_running_git() {
        let _fixture_guard = git_fixture_guard();
        let fixture = HistoryFixture::new();
        let session = fixture.session("file-history-stale-session");
        let path = session
            .paths()
            .lock()
            .expect("path registry")
            .register(b"tracked.txt".to_vec())
            .expect("tracked path");

        assert_eq!(
            list_file_history(
                &session,
                &fixture.head_object_id(),
                &path.opaque_id,
                1,
                50,
                &CancellationToken::new(),
            ),
            Err(GitHistoryError::StalePath)
        );
    }

    #[test]
    fn shallow_temp_repository_marks_the_oldest_locally_visible_file_snapshot() {
        let _fixture_guard = git_fixture_guard();
        let fixture = HistoryFixture::new();
        fixture.commit("second", "1700000001 +0000");
        fixture.commit("third", "1700000002 +0000");
        let boundary = fixture.object_id("HEAD~1");
        fs::write(
            fixture.repository.join(".git/shallow"),
            format!("{}\n", boundary.hex),
        )
        .expect("shallow boundary");
        let session = fixture.session("file-history-shallow-session");
        let path = session
            .paths()
            .lock()
            .expect("path registry")
            .register(b"tracked.txt".to_vec())
            .expect("tracked path");

        let parsed = list_file_history(
            &session,
            &fixture.head_object_id(),
            &path.opaque_id,
            0,
            50,
            &CancellationToken::new(),
        )
        .expect("shallow local history");

        assert!(parsed.shallow);
        assert!(!parsed.truncated);
        assert_eq!(parsed.entries.len(), 2);
        assert_eq!(
            parsed.entries.last().map(|entry| entry.boundary),
            Some(GitFileHistoryBoundary::ShallowBoundary)
        );
    }

    #[cfg(unix)]
    #[test]
    fn temp_repository_follows_rename_without_network_content_helpers_or_mutation() {
        let _fixture_guard = git_fixture_guard();
        let fixture = HistoryFixture::new();
        fixture.run(["mv", "tracked.txt", "renamed.txt"]);
        fixture.commit_staged("rename tracked file", "1700000001 +0000");
        fs::write(fixture.repository.join("renamed.txt"), b"modified\n")
            .expect("modified renamed file");
        fixture.run(["add", "--", "renamed.txt"]);
        fixture.commit_staged("modify renamed file", "1700000002 +0000");
        let helper_marker = fixture.configure_content_helper();
        let before = fixture.fingerprint();
        let session = fixture.session("file-history-session");
        let path = session
            .paths()
            .lock()
            .expect("path registry")
            .register(b"renamed.txt".to_vec())
            .expect("renamed path");

        let parsed = list_file_history(
            &session,
            &fixture.head_object_id(),
            &path.opaque_id,
            0,
            50,
            &CancellationToken::new(),
        )
        .expect("local file history");

        assert_eq!(parsed.generation, 0);
        assert_eq!(parsed.entries.len(), 3);
        assert_eq!(parsed.entries[0].subject, "modify renamed file");
        assert_eq!(
            parsed.entries[1].boundary,
            GitFileHistoryBoundary::RenameBoundary
        );
        assert_eq!(parsed.entries[2].path_at_commit.display_path, "tracked.txt");
        assert!(
            !helper_marker.exists(),
            "history metadata must not invoke textconv, filters, LFS, or remotes"
        );
        assert_eq!(fixture.fingerprint(), before);
        assert_eq!(
            session
                .paths()
                .lock()
                .expect("path registry")
                .resolve(
                    &parsed.entries[2].path_at_commit.opaque_id,
                    parsed.generation,
                    GitPathPlatform::Unix,
                )
                .expect("lossless old path"),
            b"tracked.txt"
        );
    }

    #[test]
    fn cancellation_is_reported_before_a_recent_commit_result() {
        let _fixture_guard = git_fixture_guard();
        let fixture = HistoryFixture::new();
        let session = fixture.session("history-cancel-session");
        let cancellation = CancellationToken::new();
        cancellation.cancel();

        assert_eq!(
            list_recent_commits(&session, &fixture.head_object_id(), 50, &cancellation,),
            Err(GitHistoryError::Runner(RunnerError::Cancelled))
        );
    }

    #[test]
    fn temp_repository_returns_newest_first_with_a_hard_limit_and_no_mutation() {
        let _fixture_guard = git_fixture_guard();
        let fixture = HistoryFixture::new();
        fixture.commit("second", "1700000001 +0000");
        fixture.commit("third", "1700000002 +0000");
        let before = fixture.fingerprint();
        let session = fixture.session("history-session");

        let parsed = list_recent_commits(
            &session,
            &fixture.head_object_id(),
            2,
            &CancellationToken::new(),
        )
        .expect("local recent commits");

        assert!(parsed.truncated);
        assert_eq!(
            parsed
                .entries
                .iter()
                .map(|entry| entry.subject.as_str())
                .collect::<Vec<_>>(),
            vec!["third", "second"]
        );
        assert_eq!(fixture.fingerprint(), before);
    }

    fn git_fixture_guard() -> MutexGuard<'static, ()> {
        crate::git::GIT_FIXTURE_LOCK
            .lock()
            .expect("Git fixture lock")
    }

    #[derive(Debug, PartialEq, Eq)]
    struct HistoryFingerprint {
        head: Vec<u8>,
        main: Vec<u8>,
        index: Vec<u8>,
        config: Vec<u8>,
    }

    struct HistoryFixture {
        _temp: TempDir,
        repository: PathBuf,
        home: PathBuf,
        git: PathBuf,
    }

    impl HistoryFixture {
        fn new() -> Self {
            let temp = tempdir().expect("history fixture root");
            let repository = temp.path().join("History Repository 한글");
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
            fixture.commit("first", "1700000000 +0000");
            fixture
        }

        fn commit(&self, subject: &str, author_date: &str) {
            fs::write(self.repository.join("tracked.txt"), format!("{subject}\n"))
                .expect("tracked fixture");
            self.run(["add", "--", "tracked.txt"]);
            self.commit_staged(subject, author_date);
        }

        fn commit_staged(&self, subject: &str, author_date: &str) {
            self.run_with_dates(
                [
                    "-c",
                    "user.name=Forktail Fixture",
                    "-c",
                    "user.email=fixture@example.invalid",
                    "commit",
                    "--no-gpg-sign",
                    "-m",
                    subject,
                ],
                author_date,
            );
        }

        #[cfg(unix)]
        fn configure_content_helper(&self) -> PathBuf {
            use std::os::unix::fs::PermissionsExt;

            let helper = self._temp.path().join("history-helper-sentinel.sh");
            let marker = self._temp.path().join("history-helper-invoked");
            fs::write(
                &helper,
                format!("#!/bin/sh\n: > '{}'\nexit 1\n", marker.display()),
            )
            .expect("history helper");
            let mut permissions = fs::metadata(&helper)
                .expect("history helper metadata")
                .permissions();
            permissions.set_mode(0o700);
            fs::set_permissions(&helper, permissions).expect("history helper executable");
            fs::write(
                self.repository.join(".gitattributes"),
                b"*.txt filter=sentinel diff=sentinel\n",
            )
            .expect("history attributes");
            let command = helper.to_string_lossy();
            for key in [
                "filter.sentinel.smudge",
                "filter.sentinel.process",
                "diff.sentinel.textconv",
            ] {
                self.run(["config", key, command.as_ref()]);
            }
            marker
        }

        fn head_object_id(&self) -> GitObjectId {
            self.object_id("HEAD")
        }

        fn object_id(&self, revision: &str) -> GitObjectId {
            let output = self.run(["rev-parse", revision]);
            let hex = String::from_utf8(output.stdout)
                .expect("UTF-8 object ID")
                .trim()
                .to_string();
            GitObjectId::try_new(GitObjectAlgorithm::Sha1, hex).expect("full fixture object ID")
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

        fn fingerprint(&self) -> HistoryFingerprint {
            let git_dir = self.repository.join(".git");
            HistoryFingerprint {
                head: fs::read(git_dir.join("HEAD")).expect("HEAD fingerprint"),
                main: fs::read(git_dir.join("refs/heads/main")).expect("main fingerprint"),
                index: fs::read(git_dir.join("index")).expect("index fingerprint"),
                config: fs::read(git_dir.join("config")).expect("config fingerprint"),
            }
        }

        fn run<I, S>(&self, arguments: I) -> Output
        where
            I: IntoIterator<Item = S>,
            S: AsRef<OsStr>,
        {
            self.run_command(arguments, None)
        }

        fn run_with_dates<I, S>(&self, arguments: I, author_date: &str) -> Output
        where
            I: IntoIterator<Item = S>,
            S: AsRef<OsStr>,
        {
            self.run_command(arguments, Some(author_date))
        }

        fn run_command<I, S>(&self, arguments: I, author_date: Option<&str>) -> Output
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
            if let Some(author_date) = author_date {
                command
                    .env("GIT_AUTHOR_DATE", author_date)
                    .env("GIT_COMMITTER_DATE", author_date);
            }
            for key in ["SYSTEMROOT", "WINDIR", "TEMP", "TMP", "TMPDIR", "LANG"] {
                if let Some(value) = std::env::var_os(key) {
                    command.env(key, value);
                }
            }
            let output = command.output().expect("fixture Git command");
            assert!(
                output.status.success(),
                "fixture Git command failed: {}",
                String::from_utf8_lossy(&output.stderr)
            );
            output
        }
    }
}
