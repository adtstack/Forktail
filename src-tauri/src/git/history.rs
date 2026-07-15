use crate::domain::git::{
    GitObjectAlgorithm, GitObjectId, GitRecentCommitEntry, GitRecentCommitList,
};
use crate::git::repository::GitRepositorySession;
use crate::git::runner::{CancellationToken, GitOperation, RunnerError};
use std::collections::HashSet;

pub const MAX_HISTORY_LIMIT: usize = 500;
pub const MAX_HISTORY_SUBJECT_CHARS: usize = 200;

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
    if timestamp < 0 {
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
        GitHistoryError, MAX_HISTORY_LIMIT, MAX_HISTORY_SUBJECT_CHARS, list_recent_commits,
        parse_recent_commit_records,
    };
    use crate::domain::git::{GitObjectAlgorithm, GitObjectId};
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

        fn head_object_id(&self) -> GitObjectId {
            let output = self.run(["rev-parse", "HEAD"]);
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
