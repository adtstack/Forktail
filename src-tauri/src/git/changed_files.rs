use crate::domain::git::{
    GitChangedFile, GitChangedFileCounts, GitChangedFileList, GitChangedFileStatus, GitObjectId,
    GitPathIdentity, GitPathRegistryError,
};
use crate::git::repository::GitRepositorySession;
use crate::git::runner::{CHANGED_FILES_STDOUT_CAP, CancellationToken, GitOperation, RunnerError};
use std::collections::HashSet;

pub const MAX_CHANGED_FILES_LIMIT: usize = 10_000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GitChangedFilesError {
    Runner(RunnerError),
    InvalidObjectId,
    InvalidLimit,
    ObjectMissingLocal,
    OutputTooLarge,
    TruncatedOutput,
    InvalidStatus,
    InvalidScore,
    MissingPath,
    InvalidPath,
    DuplicatePath,
    StaleGeneration,
    StateUnavailable,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ParsedChangedFile {
    status: GitChangedFileStatus,
    old_path: Vec<u8>,
    new_path: Vec<u8>,
    similarity_score: Option<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ParsedChangedFileList {
    entries: Vec<ParsedChangedFile>,
    counts: GitChangedFileCounts,
    truncated: bool,
}

pub fn list_changed_files(
    session: &GitRepositorySession,
    left_commit: &GitObjectId,
    right_commit: &GitObjectId,
    limit: usize,
    cancellation: &CancellationToken,
) -> Result<GitChangedFileList, GitChangedFilesError> {
    if left_commit.algorithm != session.identity().object_format
        || right_commit.algorithm != session.identity().object_format
    {
        return Err(GitChangedFilesError::InvalidObjectId);
    }
    validate_limit(limit)?;
    let expected_generation = session
        .paths()
        .lock()
        .map_err(|_| GitChangedFilesError::StateUnavailable)?
        .generation();
    let output = session
        .executable()
        .runner()
        .run(
            GitOperation::ChangedFiles {
                repository: session.identity().root.clone(),
                left_commit_id: left_commit.hex.clone(),
                right_commit_id: right_commit.hex.clone(),
            },
            cancellation,
        )
        .map_err(GitChangedFilesError::Runner)?;
    if !output.success {
        return Err(GitChangedFilesError::ObjectMissingLocal);
    }
    let parsed = parse_changed_file_records(&output.stdout, limit)?;
    materialize_changed_files(session, expected_generation, parsed)
}

fn materialize_changed_files(
    session: &GitRepositorySession,
    expected_generation: u64,
    parsed: ParsedChangedFileList,
) -> Result<GitChangedFileList, GitChangedFilesError> {
    let mut paths = session
        .paths()
        .lock()
        .map_err(|_| GitChangedFilesError::StateUnavailable)?;
    if paths.generation() != expected_generation {
        return Err(GitChangedFilesError::StaleGeneration);
    }

    let mut entries = Vec::with_capacity(parsed.entries.len());
    for entry in parsed.entries {
        let old_path = register_path(&mut paths, &entry.old_path)?;
        let new_path = if !entry.old_path.is_empty() && entry.old_path == entry.new_path {
            old_path.clone()
        } else {
            register_path(&mut paths, &entry.new_path)?
        };
        entries.push(GitChangedFile {
            status: entry.status,
            old_path,
            new_path,
            similarity_score: entry.similarity_score,
        });
    }

    Ok(GitChangedFileList {
        entries,
        counts: parsed.counts,
        truncated: parsed.truncated,
        generation: expected_generation,
    })
}

fn register_path(
    paths: &mut crate::domain::git::GitPathRegistry,
    path: &[u8],
) -> Result<Option<GitPathIdentity>, GitChangedFilesError> {
    if path.is_empty() {
        return Ok(None);
    }
    paths
        .register(path.to_vec())
        .map(Some)
        .map_err(map_path_error)
}

fn map_path_error(error: GitPathRegistryError) -> GitChangedFilesError {
    match error {
        GitPathRegistryError::StaleGeneration => GitChangedFilesError::StaleGeneration,
        GitPathRegistryError::EmptyPath | GitPathRegistryError::PathContainsNul => {
            GitChangedFilesError::InvalidPath
        }
        GitPathRegistryError::DuplicateOpaqueId
        | GitPathRegistryError::UnknownOpaqueId
        | GitPathRegistryError::PlatformConversionUnsupported
        | GitPathRegistryError::GenerationExhausted
        | GitPathRegistryError::OpaqueIdExhausted => GitChangedFilesError::StateUnavailable,
    }
}

fn parse_changed_file_records(
    output: &[u8],
    limit: usize,
) -> Result<ParsedChangedFileList, GitChangedFilesError> {
    validate_limit(limit)?;
    if output.len() > CHANGED_FILES_STDOUT_CAP {
        return Err(GitChangedFilesError::OutputTooLarge);
    }
    if output.is_empty() {
        return Ok(ParsedChangedFileList {
            entries: Vec::new(),
            counts: GitChangedFileCounts::default(),
            truncated: false,
        });
    }
    if !output.ends_with(b"\0") {
        return Err(GitChangedFilesError::TruncatedOutput);
    }

    let fields = output[..output.len() - 1]
        .split(|byte| *byte == 0)
        .collect::<Vec<_>>();
    let mut field_index = 0usize;
    let mut entries = Vec::with_capacity(limit.min(fields.len() / 2));
    let mut counts = GitChangedFileCounts::default();
    let mut old_paths = HashSet::new();
    let mut new_paths = HashSet::new();

    while field_index < fields.len() {
        let status_field = fields[field_index];
        field_index += 1;
        let (status, path_count, similarity_score) = parse_status(status_field)?;
        if fields.len().saturating_sub(field_index) < path_count {
            return Err(GitChangedFilesError::MissingPath);
        }
        let first_path = fields[field_index];
        validate_path(first_path)?;
        field_index += 1;
        let second_path = if path_count == 2 {
            let path = fields[field_index];
            validate_path(path)?;
            field_index += 1;
            Some(path)
        } else {
            None
        };

        let (old_path, new_path) = changed_paths(status, first_path, second_path)?;
        validate_unique_paths(status, &old_path, &new_path, &mut old_paths, &mut new_paths)?;
        increment_count(&mut counts, status);
        if counts.total <= limit as u64 {
            entries.push(ParsedChangedFile {
                status,
                old_path,
                new_path,
                similarity_score,
            });
        }
    }

    Ok(ParsedChangedFileList {
        entries,
        truncated: counts.total > limit as u64,
        counts,
    })
}

fn validate_limit(limit: usize) -> Result<(), GitChangedFilesError> {
    if (1..=MAX_CHANGED_FILES_LIMIT).contains(&limit) {
        Ok(())
    } else {
        Err(GitChangedFilesError::InvalidLimit)
    }
}

fn parse_status(
    value: &[u8],
) -> Result<(GitChangedFileStatus, usize, Option<u8>), GitChangedFilesError> {
    if value.is_empty()
        || value.len() > 16
        || !value[0].is_ascii_uppercase()
        || value.iter().any(|byte| !byte.is_ascii_graphic())
    {
        return Err(GitChangedFilesError::InvalidStatus);
    }
    match value {
        b"A" => Ok((GitChangedFileStatus::Added, 1, None)),
        b"D" => Ok((GitChangedFileStatus::Deleted, 1, None)),
        b"M" => Ok((GitChangedFileStatus::Modified, 1, None)),
        b"T" => Ok((GitChangedFileStatus::TypeChanged, 1, None)),
        b"U" => Ok((GitChangedFileStatus::Unmerged, 1, None)),
        b"X" => Ok((GitChangedFileStatus::Unknown, 1, None)),
        _ if value[0] == b'M' => {
            parse_score(&value[1..])?;
            Ok((GitChangedFileStatus::Modified, 1, None))
        }
        _ if value[0] == b'R' => Ok((
            GitChangedFileStatus::Renamed,
            2,
            Some(parse_score(&value[1..])?),
        )),
        _ if value[0] == b'C' => Ok((
            GitChangedFileStatus::Copied,
            2,
            Some(parse_score(&value[1..])?),
        )),
        _ if matches!(value[0], b'A' | b'D' | b'T' | b'U' | b'X') => {
            Err(GitChangedFilesError::InvalidStatus)
        }
        _ if value
            .iter()
            .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit()) =>
        {
            Ok((GitChangedFileStatus::Unknown, 1, None))
        }
        _ => Err(GitChangedFilesError::InvalidStatus),
    }
}

fn parse_score(value: &[u8]) -> Result<u8, GitChangedFilesError> {
    if value.len() != 3 || !value.iter().all(u8::is_ascii_digit) {
        return Err(GitChangedFilesError::InvalidScore);
    }
    let score = u16::from(value[0] - b'0') * 100
        + u16::from(value[1] - b'0') * 10
        + u16::from(value[2] - b'0');
    if score <= 100 {
        Ok(score as u8)
    } else {
        Err(GitChangedFilesError::InvalidScore)
    }
}

fn validate_path(path: &[u8]) -> Result<(), GitChangedFilesError> {
    if path.is_empty()
        || path.starts_with(b"/")
        || path
            .split(|byte| *byte == b'/')
            .any(|component| component.is_empty() || matches!(component, b"." | b".."))
    {
        Err(GitChangedFilesError::InvalidPath)
    } else {
        Ok(())
    }
}

fn changed_paths(
    status: GitChangedFileStatus,
    first_path: &[u8],
    second_path: Option<&[u8]>,
) -> Result<(Vec<u8>, Vec<u8>), GitChangedFilesError> {
    match status {
        GitChangedFileStatus::Added => Ok((Vec::new(), first_path.to_vec())),
        GitChangedFileStatus::Deleted => Ok((first_path.to_vec(), Vec::new())),
        GitChangedFileStatus::Renamed | GitChangedFileStatus::Copied => {
            let second_path = second_path.ok_or(GitChangedFilesError::MissingPath)?;
            Ok((first_path.to_vec(), second_path.to_vec()))
        }
        GitChangedFileStatus::Modified
        | GitChangedFileStatus::TypeChanged
        | GitChangedFileStatus::Unmerged
        | GitChangedFileStatus::Unknown => Ok((first_path.to_vec(), first_path.to_vec())),
    }
}

fn validate_unique_paths(
    status: GitChangedFileStatus,
    old_path: &[u8],
    new_path: &[u8],
    old_paths: &mut HashSet<Vec<u8>>,
    new_paths: &mut HashSet<Vec<u8>>,
) -> Result<(), GitChangedFilesError> {
    if !old_path.is_empty()
        && status != GitChangedFileStatus::Copied
        && !old_paths.insert(old_path.to_vec())
    {
        return Err(GitChangedFilesError::DuplicatePath);
    }
    if !new_path.is_empty() && !new_paths.insert(new_path.to_vec()) {
        return Err(GitChangedFilesError::DuplicatePath);
    }
    Ok(())
}

fn increment_count(counts: &mut GitChangedFileCounts, status: GitChangedFileStatus) {
    match status {
        GitChangedFileStatus::Added => counts.added += 1,
        GitChangedFileStatus::Deleted => counts.deleted += 1,
        GitChangedFileStatus::Modified => counts.modified += 1,
        GitChangedFileStatus::TypeChanged => counts.type_changed += 1,
        GitChangedFileStatus::Renamed => counts.renamed += 1,
        GitChangedFileStatus::Copied => counts.copied += 1,
        GitChangedFileStatus::Unmerged => counts.unmerged += 1,
        GitChangedFileStatus::Unknown => counts.unknown += 1,
    }
    counts.total += 1;
}

#[cfg(test)]
mod tests {
    use super::{GitChangedFilesError, list_changed_files, parse_changed_file_records};
    use crate::domain::git::{
        GitChangedFileStatus, GitObjectAlgorithm, GitObjectId, GitPathPlatform,
    };
    use crate::git::executable::ValidatedGitExecutable;
    use crate::git::repository::GitRepositorySession;
    use crate::git::runner::{CancellationToken, RunnerError};
    use std::ffi::OsStr;
    use std::fs;
    use std::io::Write;
    use std::path::PathBuf;
    use std::process::{Command, Output, Stdio};
    use std::sync::MutexGuard;
    use tempfile::{TempDir, tempdir};

    #[test]
    fn parses_all_supported_and_forward_compatible_status_records_losslessly() {
        let output = b"M\0same path.txt\0A\0new\tpath.txt\0D\0old\npath.txt\0T\0kind.bin\0X\0unknown.txt\0U\0conflict.txt\0R087\0old name.txt\0new name.txt\0C050\0source.txt\0copy.txt\0M100\0rewrite.txt\0Z\0bad\xffname\0";
        let parsed = parse_changed_file_records(output, 32).expect("valid name-status records");

        assert!(!parsed.truncated);
        assert_eq!(parsed.entries.len(), 10);
        assert_eq!(parsed.counts.total, 10);
        assert_eq!(parsed.entries[0].status, GitChangedFileStatus::Modified);
        assert_eq!(parsed.entries[0].old_path, b"same path.txt");
        assert_eq!(parsed.entries[0].new_path, b"same path.txt");
        assert_eq!(parsed.entries[1].status, GitChangedFileStatus::Added);
        assert!(parsed.entries[1].old_path.is_empty());
        assert_eq!(parsed.entries[1].new_path, b"new\tpath.txt");
        assert_eq!(parsed.entries[2].status, GitChangedFileStatus::Deleted);
        assert_eq!(parsed.entries[2].old_path, b"old\npath.txt");
        assert!(parsed.entries[2].new_path.is_empty());
        assert_eq!(parsed.entries[3].status, GitChangedFileStatus::TypeChanged);
        assert_eq!(parsed.entries[4].status, GitChangedFileStatus::Unknown);
        assert_eq!(parsed.entries[5].status, GitChangedFileStatus::Unmerged);
        assert_eq!(parsed.entries[6].status, GitChangedFileStatus::Renamed);
        assert_eq!(parsed.entries[6].old_path, b"old name.txt");
        assert_eq!(parsed.entries[6].new_path, b"new name.txt");
        assert_eq!(parsed.entries[6].similarity_score, Some(87));
        assert_eq!(parsed.entries[7].status, GitChangedFileStatus::Copied);
        assert_eq!(parsed.entries[7].similarity_score, Some(50));
        assert_eq!(parsed.entries[8].status, GitChangedFileStatus::Modified);
        assert_eq!(parsed.entries[8].similarity_score, None);
        assert_eq!(parsed.entries[9].status, GitChangedFileStatus::Unknown);
        assert_eq!(parsed.entries[9].new_path, b"bad\xffname");
    }

    #[test]
    fn accepts_score_boundaries_and_rejects_malformed_scores() {
        for (record, expected) in [
            (b"R000\0old\0new\0".as_slice(), Some(0)),
            (b"R100\0old\0new\0".as_slice(), Some(100)),
            (b"C001\0old\0new\0".as_slice(), Some(1)),
        ] {
            let parsed = parse_changed_file_records(record, 1).expect("valid score boundary");
            assert_eq!(parsed.entries[0].similarity_score, expected);
        }

        for record in [
            b"R10\0old\0new\0".as_slice(),
            b"R101\0old\0new\0".as_slice(),
            b"Rabc\0old\0new\0".as_slice(),
            b"C-01\0old\0new\0".as_slice(),
            b"Mxyz\0path\0".as_slice(),
        ] {
            assert_eq!(
                parse_changed_file_records(record, 1),
                Err(GitChangedFilesError::InvalidScore)
            );
        }
    }

    #[test]
    fn rejects_truncation_missing_paths_invalid_status_and_duplicate_side_paths() {
        let cases = [
            (b"M\0path".as_slice(), GitChangedFilesError::TruncatedOutput),
            (b"R100\0old\0".as_slice(), GitChangedFilesError::MissingPath),
            (b"A\0\0".as_slice(), GitChangedFilesError::InvalidPath),
            (
                b"M\n\0path\0".as_slice(),
                GitChangedFilesError::InvalidStatus,
            ),
            (
                b"M\0same\0A\0same\0".as_slice(),
                GitChangedFilesError::DuplicatePath,
            ),
            (
                b"M\0../escape\0".as_slice(),
                GitChangedFilesError::InvalidPath,
            ),
        ];
        for (output, expected) in cases {
            assert_eq!(parse_changed_file_records(output, 16), Err(expected));
        }
    }

    #[test]
    fn bounds_stored_entries_but_validates_and_counts_the_complete_output() {
        let parsed =
            parse_changed_file_records(b"A\0a\0M\0b\0D\0c\0", 2).expect("bounded changed files");

        assert_eq!(parsed.entries.len(), 2);
        assert!(parsed.truncated);
        assert_eq!(parsed.counts.total, 3);
        assert_eq!(parsed.counts.added, 1);
        assert_eq!(parsed.counts.modified, 1);
        assert_eq!(parsed.counts.deleted, 1);
        assert_eq!(
            parse_changed_file_records(b"", 0),
            Err(GitChangedFilesError::InvalidLimit)
        );
    }

    #[test]
    fn temp_repository_lists_added_deleted_modified_renamed_and_type_changed_without_mutation() {
        let _fixture_guard = git_fixture_guard();
        let fixture = ChangedFilesFixture::new();
        let session = fixture.session();
        let before = fixture.fingerprint();

        let result = list_changed_files(
            &session,
            &fixture.left,
            &fixture.right,
            100,
            &CancellationToken::new(),
        )
        .expect("changed-file list");

        assert!(!result.truncated);
        assert_eq!(result.counts.total, 5);
        assert_eq!(result.counts.added, 1);
        assert_eq!(result.counts.deleted, 1);
        assert_eq!(result.counts.modified, 1);
        assert_eq!(result.counts.renamed, 1);
        assert_eq!(result.counts.type_changed, 1);
        let rename = result
            .entries
            .iter()
            .find(|entry| entry.status == GitChangedFileStatus::Renamed)
            .expect("rename entry");
        assert_eq!(rename.similarity_score, Some(100));
        assert_eq!(
            rename
                .old_path
                .as_ref()
                .and_then(|path| path.utf8_path.as_deref()),
            Some("old name.txt")
        );
        assert_eq!(
            rename
                .new_path
                .as_ref()
                .and_then(|path| path.utf8_path.as_deref()),
            Some("new name.txt")
        );
        let paths = session.paths().lock().expect("path registry");
        assert_eq!(
            paths
                .resolve(
                    &rename.old_path.as_ref().expect("old path").opaque_id,
                    result.generation,
                    GitPathPlatform::Unix,
                )
                .expect("old raw path"),
            b"old name.txt"
        );
        assert_eq!(fixture.fingerprint(), before);
    }

    #[test]
    fn changed_file_service_handles_empty_missing_and_cancelled_reads() {
        let _fixture_guard = git_fixture_guard();
        let fixture = ChangedFilesFixture::new();
        let session = fixture.session();
        let empty = list_changed_files(
            &session,
            &fixture.right,
            &fixture.right,
            10,
            &CancellationToken::new(),
        )
        .expect("same commit has no changes");
        assert!(empty.entries.is_empty());
        assert_eq!(empty.counts.total, 0);

        let missing = GitObjectId::try_new(GitObjectAlgorithm::Sha1, "f".repeat(40))
            .expect("missing fixture object ID");
        assert_eq!(
            list_changed_files(
                &session,
                &missing,
                &fixture.right,
                10,
                &CancellationToken::new(),
            ),
            Err(GitChangedFilesError::ObjectMissingLocal)
        );

        let cancelled = CancellationToken::new();
        cancelled.cancel();
        assert_eq!(
            list_changed_files(&session, &fixture.left, &fixture.right, 10, &cancelled),
            Err(GitChangedFilesError::Runner(RunnerError::Cancelled))
        );
    }

    fn git_fixture_guard() -> MutexGuard<'static, ()> {
        crate::git::GIT_FIXTURE_LOCK
            .lock()
            .expect("Git fixture lock")
    }

    #[derive(Debug, PartialEq, Eq)]
    struct ChangedFilesFingerprint {
        head: Vec<u8>,
        branch: Vec<u8>,
        index: Vec<u8>,
        config: Vec<u8>,
        working_files: Vec<(String, Vec<u8>)>,
    }

    struct ChangedFilesFixture {
        _temp: TempDir,
        repository: PathBuf,
        home: PathBuf,
        git: PathBuf,
        left: GitObjectId,
        right: GitObjectId,
    }

    impl ChangedFilesFixture {
        fn new() -> Self {
            let temp = tempdir().expect("changed-files fixture root");
            let repository = temp.path().join("Changed Repository 한글");
            let home = temp.path().join("isolated-home");
            fs::create_dir_all(&repository).expect("repository directory");
            fs::create_dir_all(&home).expect("fixture home");
            fs::write(home.join(".gitconfig"), b"").expect("empty fixture config");
            let executable = ValidatedGitExecutable::discover(None).expect("supported Git");
            let git = executable.path().to_path_buf();
            let mut fixture = Self {
                _temp: temp,
                repository,
                home,
                git,
                left: object_id("0"),
                right: object_id("0"),
            };
            fixture.run(["init", "-b", "main", "."]);
            for (path, bytes) in [
                ("modified.txt", b"before\n".as_slice()),
                ("deleted.txt", b"deleted\n".as_slice()),
                ("old name.txt", b"rename content\n".as_slice()),
                ("type-change", b"ordinary file\n".as_slice()),
            ] {
                fs::write(fixture.repository.join(path), bytes).expect("first revision file");
            }
            fixture.run(["add", "--", "."]);
            fixture.commit("first revision");
            fixture.left = fixture.head_object_id();

            fs::write(fixture.repository.join("modified.txt"), b"after\n").expect("modified file");
            fs::write(fixture.repository.join("new.txt"), b"added\n").expect("added file");
            fs::remove_file(fixture.repository.join("deleted.txt")).expect("deleted file");
            fixture.run(["mv", "--", "old name.txt", "new name.txt"]);
            fixture.run(["add", "-A", "--", "."]);
            let symlink_blob = fixture.write_blob(b"synthetic-target");
            let cache_info = format!("120000,{symlink_blob},type-change");
            fixture.run(["update-index", "--add", "--cacheinfo", &cache_info]);
            fixture.commit("second revision");
            fixture.right = fixture.head_object_id();
            fixture
        }

        fn session(&self) -> GitRepositorySession {
            GitRepositorySession::open(
                "changed-files-session".to_string(),
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

        fn head_object_id(&self) -> GitObjectId {
            let output = self.run(["rev-parse", "HEAD"]);
            let hex = String::from_utf8(output.stdout)
                .expect("HEAD object ID")
                .trim()
                .to_string();
            GitObjectId::try_new(GitObjectAlgorithm::Sha1, hex).expect("valid HEAD object ID")
        }

        fn write_blob(&self, bytes: &[u8]) -> String {
            let mut command = self.command(["hash-object", "-w", "--stdin"]);
            command.stdin(Stdio::piped());
            let mut child = command.spawn().expect("hash-object starts");
            child
                .stdin
                .take()
                .expect("hash-object stdin")
                .write_all(bytes)
                .expect("blob bytes");
            let output = child.wait_with_output().expect("hash-object output");
            assert!(output.status.success(), "hash-object failed");
            String::from_utf8(output.stdout)
                .expect("blob object ID")
                .trim()
                .to_string()
        }

        fn fingerprint(&self) -> ChangedFilesFingerprint {
            let git_dir = self.repository.join(".git");
            let working_files = ["modified.txt", "new name.txt", "new.txt", "type-change"]
                .into_iter()
                .map(|path| {
                    (
                        path.to_string(),
                        fs::read(self.repository.join(path)).expect("working file fingerprint"),
                    )
                })
                .collect();
            ChangedFilesFingerprint {
                head: fs::read(git_dir.join("HEAD")).expect("HEAD fingerprint"),
                branch: fs::read(git_dir.join("refs/heads/main")).expect("branch fingerprint"),
                index: fs::read(git_dir.join("index")).expect("index fingerprint"),
                config: fs::read(git_dir.join("config")).expect("config fingerprint"),
                working_files,
            }
        }

        fn run<I, S>(&self, arguments: I) -> Output
        where
            I: IntoIterator<Item = S>,
            S: AsRef<OsStr>,
        {
            let output = self
                .command(arguments)
                .output()
                .expect("fixture Git output");
            assert!(
                output.status.success(),
                "fixture Git failed: {}",
                String::from_utf8_lossy(&output.stderr)
            );
            output
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

    fn object_id(hex_digit: &str) -> GitObjectId {
        GitObjectId::try_new(GitObjectAlgorithm::Sha1, hex_digit.repeat(40))
            .expect("fixture object ID")
    }
}
