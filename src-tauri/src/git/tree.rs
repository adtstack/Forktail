use crate::domain::git::{
    GitObjectAlgorithm, GitObjectId, GitObjectType, GitPathPlatform, GitPathRegistryError,
    GitTreeEntry, GitTreeEntryKind, GitTreeList,
};
use crate::git::repository::GitRepositorySession;
use crate::git::runner::{CancellationToken, GitOperation, RunnerError};
use std::collections::HashSet;
use std::ffi::OsString;

pub const MAX_TREE_LIST_LIMIT: usize = 100_000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GitTreeError {
    Runner(RunnerError),
    InvalidObjectId,
    InvalidLimit,
    ObjectMissingLocal,
    TruncatedOutput,
    InvalidHeader,
    InvalidMode,
    InvalidObjectType,
    InvalidSize,
    InvalidPath,
    DuplicatePath,
    UnknownPath,
    StalePath,
    PathUnsupported,
    StateUnavailable,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ParsedTreeEntry {
    path: Vec<u8>,
    mode: String,
    kind: GitTreeEntryKind,
    object_id: GitObjectId,
    object_type: GitObjectType,
    size: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ParsedTreeList {
    entries: Vec<ParsedTreeEntry>,
    truncated: bool,
}

pub fn list_tree(
    session: &GitRepositorySession,
    commit: &GitObjectId,
    path_prefix: Option<(&str, u64)>,
    limit: usize,
    cancellation: &CancellationToken,
) -> Result<GitTreeList, GitTreeError> {
    if commit.algorithm != session.identity().object_format {
        return Err(GitTreeError::InvalidObjectId);
    }
    if !(1..=MAX_TREE_LIST_LIMIT).contains(&limit) {
        return Err(GitTreeError::InvalidLimit);
    }

    let (path_prefix, expected_generation) = resolve_path_prefix(session, path_prefix)?;
    let output = session
        .executable()
        .runner()
        .run(
            GitOperation::Tree {
                repository: session.identity().root.clone(),
                commit_id: commit.hex.clone(),
                path_prefix,
            },
            cancellation,
        )
        .map_err(GitTreeError::Runner)?;
    if !output.success {
        return Err(GitTreeError::ObjectMissingLocal);
    }
    let parsed = parse_tree_records(&output.stdout, session.identity().object_format, limit)?;

    let mut paths = session
        .paths()
        .lock()
        .map_err(|_| GitTreeError::StateUnavailable)?;
    if paths.generation() != expected_generation {
        return Err(GitTreeError::StalePath);
    }
    let mut entries = Vec::with_capacity(parsed.entries.len());
    for entry in parsed.entries {
        let path = paths.register(entry.path).map_err(map_path_error)?;
        entries.push(GitTreeEntry {
            path,
            mode: entry.mode,
            kind: entry.kind,
            object_id: entry.object_id,
            object_type: entry.object_type,
            size: entry.size,
        });
    }
    Ok(GitTreeList {
        entries,
        truncated: parsed.truncated,
        generation: expected_generation,
    })
}

fn resolve_path_prefix(
    session: &GitRepositorySession,
    path_prefix: Option<(&str, u64)>,
) -> Result<(Option<OsString>, u64), GitTreeError> {
    let paths = session
        .paths()
        .lock()
        .map_err(|_| GitTreeError::StateUnavailable)?;
    let current_generation = paths.generation();
    let Some((opaque_id, generation)) = path_prefix else {
        return Ok((None, current_generation));
    };
    let raw_path = paths
        .resolve(opaque_id, generation, current_path_platform())
        .map_err(map_path_error)?
        .to_vec();
    Ok((Some(raw_path_to_os_string(raw_path)?), current_generation))
}

fn current_path_platform() -> GitPathPlatform {
    if cfg!(windows) {
        GitPathPlatform::Windows
    } else {
        GitPathPlatform::Unix
    }
}

#[cfg(unix)]
fn raw_path_to_os_string(path: Vec<u8>) -> Result<OsString, GitTreeError> {
    use std::os::unix::ffi::OsStringExt;
    Ok(OsString::from_vec(path))
}

#[cfg(windows)]
fn raw_path_to_os_string(path: Vec<u8>) -> Result<OsString, GitTreeError> {
    String::from_utf8(path)
        .map(OsString::from)
        .map_err(|_| GitTreeError::PathUnsupported)
}

#[cfg(not(any(unix, windows)))]
fn raw_path_to_os_string(path: Vec<u8>) -> Result<OsString, GitTreeError> {
    String::from_utf8(path)
        .map(OsString::from)
        .map_err(|_| GitTreeError::PathUnsupported)
}

fn map_path_error(error: GitPathRegistryError) -> GitTreeError {
    match error {
        GitPathRegistryError::UnknownOpaqueId => GitTreeError::UnknownPath,
        GitPathRegistryError::StaleGeneration => GitTreeError::StalePath,
        GitPathRegistryError::PlatformConversionUnsupported => GitTreeError::PathUnsupported,
        GitPathRegistryError::EmptyPath
        | GitPathRegistryError::PathContainsNul
        | GitPathRegistryError::DuplicateOpaqueId
        | GitPathRegistryError::GenerationExhausted
        | GitPathRegistryError::OpaqueIdExhausted => GitTreeError::StateUnavailable,
    }
}

fn parse_tree_records(
    output: &[u8],
    algorithm: GitObjectAlgorithm,
    limit: usize,
) -> Result<ParsedTreeList, GitTreeError> {
    if !(1..=MAX_TREE_LIST_LIMIT).contains(&limit) {
        return Err(GitTreeError::InvalidLimit);
    }
    if output.is_empty() {
        return Ok(ParsedTreeList {
            entries: Vec::new(),
            truncated: false,
        });
    }
    if !output.ends_with(b"\0") {
        return Err(GitTreeError::TruncatedOutput);
    }

    let mut entries = Vec::new();
    let mut seen_paths = HashSet::new();
    let mut record_count = 0usize;
    for record in output[..output.len() - 1].split(|byte| *byte == 0) {
        let entry = parse_tree_record(record, algorithm)?;
        if !seen_paths.insert(entry.path.clone()) {
            return Err(GitTreeError::DuplicatePath);
        }
        if record_count < limit {
            entries.push(entry);
        }
        record_count = record_count
            .checked_add(1)
            .ok_or(GitTreeError::InvalidLimit)?;
    }

    Ok(ParsedTreeList {
        entries,
        truncated: record_count > limit,
    })
}

fn parse_tree_record(
    record: &[u8],
    algorithm: GitObjectAlgorithm,
) -> Result<ParsedTreeEntry, GitTreeError> {
    let tab = record
        .iter()
        .position(|byte| *byte == b'\t')
        .ok_or(GitTreeError::InvalidHeader)?;
    let header = &record[..tab];
    let path = &record[tab + 1..];
    validate_tree_path(path)?;
    let fields = header
        .split(|byte| byte.is_ascii_whitespace())
        .filter(|field| !field.is_empty())
        .collect::<Vec<_>>();
    let [mode, object_type, object_id, size] = fields.as_slice() else {
        return Err(GitTreeError::InvalidHeader);
    };

    let mode = std::str::from_utf8(mode).map_err(|_| GitTreeError::InvalidMode)?;
    let object_type = parse_tree_object_type(object_type)?;
    let kind = classify_tree_kind(mode, object_type)?;
    let object_id = std::str::from_utf8(object_id).map_err(|_| GitTreeError::InvalidObjectId)?;
    let object_id =
        GitObjectId::try_new(algorithm, object_id).map_err(|_| GitTreeError::InvalidObjectId)?;
    if object_id.hex.bytes().all(|byte| byte == b'0') {
        return Err(GitTreeError::InvalidObjectId);
    }
    let size = parse_tree_size(size, kind)?;

    Ok(ParsedTreeEntry {
        path: path.to_vec(),
        mode: mode.to_string(),
        kind,
        object_id,
        object_type,
        size,
    })
}

fn validate_tree_path(path: &[u8]) -> Result<(), GitTreeError> {
    if path.is_empty()
        || path.starts_with(b"/")
        || path
            .split(|byte| *byte == b'/')
            .any(|component| component.is_empty() || matches!(component, b"." | b".."))
    {
        return Err(GitTreeError::InvalidPath);
    }
    Ok(())
}

fn parse_tree_object_type(value: &[u8]) -> Result<GitObjectType, GitTreeError> {
    match value {
        b"blob" => Ok(GitObjectType::Blob),
        b"commit" => Ok(GitObjectType::Commit),
        b"tree" => Ok(GitObjectType::Tree),
        _ => Err(GitTreeError::InvalidObjectType),
    }
}

fn classify_tree_kind(
    mode: &str,
    object_type: GitObjectType,
) -> Result<GitTreeEntryKind, GitTreeError> {
    match (mode, object_type) {
        ("100644", GitObjectType::Blob) => Ok(GitTreeEntryKind::RegularFile),
        ("100755", GitObjectType::Blob) => Ok(GitTreeEntryKind::ExecutableFile),
        ("120000", GitObjectType::Blob) => Ok(GitTreeEntryKind::Symlink),
        ("160000", GitObjectType::Commit) => Ok(GitTreeEntryKind::Submodule),
        ("100644" | "100755" | "120000" | "160000", _) => Err(GitTreeError::InvalidObjectType),
        _ => Err(GitTreeError::InvalidMode),
    }
}

fn parse_tree_size(value: &[u8], kind: GitTreeEntryKind) -> Result<Option<u64>, GitTreeError> {
    if kind == GitTreeEntryKind::Submodule {
        return if value == b"-" {
            Ok(None)
        } else {
            Err(GitTreeError::InvalidSize)
        };
    }
    if value.is_empty() || !value.iter().all(u8::is_ascii_digit) {
        return Err(GitTreeError::InvalidSize);
    }
    std::str::from_utf8(value)
        .map_err(|_| GitTreeError::InvalidSize)?
        .parse::<u64>()
        .map(Some)
        .map_err(|_| GitTreeError::InvalidSize)
}

#[cfg(test)]
mod tests {
    use super::{GitTreeError, list_tree, parse_tree_records};
    use crate::domain::git::{GitObjectAlgorithm, GitObjectId, GitPathPlatform, GitTreeEntryKind};
    use crate::git::executable::ValidatedGitExecutable;
    use crate::git::repository::GitRepositorySession;
    use crate::git::runner::{CancellationToken, RunnerError};
    use std::ffi::{OsStr, OsString};
    use std::fs;
    use std::path::PathBuf;
    use std::process::{Command, Output, Stdio};
    use std::sync::MutexGuard;
    use tempfile::{TempDir, tempdir};

    const SHA1: &str = "1111111111111111111111111111111111111111";
    const SHA256: &str = "2222222222222222222222222222222222222222222222222222222222222222";

    fn tree_record(
        mode: &str,
        object_type: &str,
        object_id: &str,
        size: &str,
        path: &[u8],
    ) -> Vec<u8> {
        let mut record = format!("{mode} {object_type} {object_id} {size}\t").into_bytes();
        record.extend_from_slice(path);
        record.push(0);
        record
    }

    #[test]
    fn parses_regular_executable_symlink_and_submodule_without_decoding_paths() {
        let mut output = tree_record("100644", "blob", SHA1, "12", b"regular file.txt");
        output.extend(tree_record("100755", "blob", SHA1, "7", b"bin/run\ttool"));
        output.extend(tree_record("120000", "blob", SHA1, "9", b"link\nname"));
        output.extend(tree_record(
            "160000",
            "commit",
            SHA1,
            "-",
            b"vendor/submodule",
        ));
        output.extend(tree_record("100644", "blob", SHA1, "4", b"bad\xffname"));

        let parsed = parse_tree_records(&output, GitObjectAlgorithm::Sha1, 10)
            .expect("lossless tree records");

        assert!(!parsed.truncated);
        assert_eq!(parsed.entries.len(), 5);
        assert_eq!(parsed.entries[0].kind, GitTreeEntryKind::RegularFile);
        assert_eq!(parsed.entries[0].size, Some(12));
        assert_eq!(parsed.entries[1].kind, GitTreeEntryKind::ExecutableFile);
        assert_eq!(parsed.entries[1].path, b"bin/run\ttool");
        assert_eq!(parsed.entries[2].kind, GitTreeEntryKind::Symlink);
        assert_eq!(parsed.entries[2].path, b"link\nname");
        assert_eq!(parsed.entries[3].kind, GitTreeEntryKind::Submodule);
        assert_eq!(parsed.entries[3].size, None);
        assert_eq!(parsed.entries[4].path, b"bad\xffname");
    }

    #[test]
    fn validates_sha256_ids_sizes_modes_types_and_record_termination() {
        let sha256 = tree_record("100644", "blob", SHA256, "1", b"sha256.txt");
        let parsed = parse_tree_records(&sha256, GitObjectAlgorithm::Sha256, 10)
            .expect("SHA-256 tree record");
        assert_eq!(parsed.entries[0].object_id.hex, SHA256);

        let cases = [
            (
                tree_record("100644", "blob", SHA1, "-", b"missing-size"),
                GitTreeError::InvalidSize,
            ),
            (
                tree_record("160000", "commit", SHA1, "12", b"submodule-size"),
                GitTreeError::InvalidSize,
            ),
            (
                tree_record("100755", "commit", SHA1, "1", b"type-mismatch"),
                GitTreeError::InvalidObjectType,
            ),
            (
                tree_record("040000", "tree", SHA1, "-", b"directory"),
                GitTreeError::InvalidMode,
            ),
            (
                tree_record("100664", "blob", SHA1, "1", b"unknown-mode"),
                GitTreeError::InvalidMode,
            ),
            (
                tree_record("100644", "blob", "abcd", "1", b"short-id"),
                GitTreeError::InvalidObjectId,
            ),
        ];
        for (output, expected) in cases {
            assert_eq!(
                parse_tree_records(&output, GitObjectAlgorithm::Sha1, 10),
                Err(expected)
            );
        }

        let mut truncated = tree_record("100644", "blob", SHA1, "1", b"path");
        truncated.pop();
        assert_eq!(
            parse_tree_records(&truncated, GitObjectAlgorithm::Sha1, 10),
            Err(GitTreeError::TruncatedOutput)
        );
        assert_eq!(
            parse_tree_records(
                format!("100644 blob {SHA1} 1 path\0").as_bytes(),
                GitObjectAlgorithm::Sha1,
                10,
            ),
            Err(GitTreeError::InvalidHeader)
        );
    }

    #[test]
    fn rejects_duplicate_empty_and_over_limit_paths() {
        let record = tree_record("100644", "blob", SHA1, "1", b"same.txt");
        let mut duplicate = record.clone();
        duplicate.extend(record);
        assert_eq!(
            parse_tree_records(&duplicate, GitObjectAlgorithm::Sha1, 10),
            Err(GitTreeError::DuplicatePath)
        );
        assert_eq!(
            parse_tree_records(
                &tree_record("100644", "blob", SHA1, "1", b""),
                GitObjectAlgorithm::Sha1,
                10,
            ),
            Err(GitTreeError::InvalidPath)
        );

        let mut many = tree_record("100644", "blob", SHA1, "1", b"a");
        many.extend(tree_record("100644", "blob", SHA1, "1", b"b"));
        let parsed = parse_tree_records(&many, GitObjectAlgorithm::Sha1, 1)
            .expect("limit plus one becomes truncated");
        assert!(parsed.truncated);
        assert_eq!(parsed.entries.len(), 1);
    }

    #[test]
    fn validates_commit_limit_and_stale_prefix_before_running_git() {
        let _fixture_guard = git_fixture_guard();
        let fixture = TreeFixture::new();
        let session = fixture.session("tree-validation");
        let invalid_commit = GitObjectId::try_new(GitObjectAlgorithm::Sha256, "f".repeat(64))
            .expect("valid foreign-format ID");
        assert_eq!(
            list_tree(
                &session,
                &invalid_commit,
                None,
                10,
                &CancellationToken::new(),
            ),
            Err(GitTreeError::InvalidObjectId)
        );
        assert_eq!(
            list_tree(
                &session,
                &fixture.commit_id(),
                None,
                0,
                &CancellationToken::new(),
            ),
            Err(GitTreeError::InvalidLimit)
        );

        let identity = session
            .paths()
            .lock()
            .expect("path registry")
            .register(b"dir".to_vec())
            .expect("prefix identity");
        assert_eq!(
            list_tree(
                &session,
                &fixture.commit_id(),
                Some((&identity.opaque_id, 1)),
                10,
                &CancellationToken::new(),
            ),
            Err(GitTreeError::StalePath)
        );
    }

    #[test]
    fn cancelled_tree_query_returns_typed_runner_cancellation() {
        let _fixture_guard = git_fixture_guard();
        let fixture = TreeFixture::new();
        let session = fixture.session("tree-cancel");
        let cancellation = CancellationToken::new();
        cancellation.cancel();
        assert_eq!(
            list_tree(&session, &fixture.commit_id(), None, 10, &cancellation,),
            Err(GitTreeError::Runner(RunnerError::Cancelled))
        );
    }

    #[test]
    fn temp_repository_lists_modes_and_literal_prefix_without_mutation() {
        let _fixture_guard = git_fixture_guard();
        let fixture = TreeFixture::new();
        fixture.populate();
        let session = fixture.session("tree-session");
        let before = fixture.fingerprint();

        let result = list_tree(
            &session,
            &fixture.commit_id(),
            None,
            100,
            &CancellationToken::new(),
        )
        .expect("revision tree");
        assert!(result.entries.iter().any(|entry| {
            entry.path.display_path == "regular.txt" && entry.kind == GitTreeEntryKind::RegularFile
        }));
        assert!(result.entries.iter().any(|entry| {
            entry.path.display_path == "bin/run.sh"
                && entry.kind == GitTreeEntryKind::ExecutableFile
        }));
        assert!(result.entries.iter().any(|entry| {
            entry.path.display_path == "outside-link" && entry.kind == GitTreeEntryKind::Symlink
        }));
        assert!(result.entries.iter().any(|entry| {
            entry.path.display_path == "vendor/submodule"
                && entry.kind == GitTreeEntryKind::Submodule
        }));
        assert_eq!(fixture.fingerprint(), before);

        let prefix = session
            .paths()
            .lock()
            .expect("path registry")
            .register(b"dir".to_vec())
            .expect("literal prefix");
        let prefixed = list_tree(
            &session,
            &fixture.commit_id(),
            Some((&prefix.opaque_id, result.generation)),
            100,
            &CancellationToken::new(),
        )
        .expect("prefixed revision tree");
        assert_eq!(prefixed.entries.len(), 1);
        assert_eq!(prefixed.entries[0].path.display_path, "dir/nested.txt");
        let raw_path = session
            .paths()
            .lock()
            .expect("path registry")
            .resolve(
                &prefixed.entries[0].path.opaque_id,
                prefixed.generation,
                GitPathPlatform::Unix,
            )
            .expect("raw path")
            .to_vec();
        assert_eq!(raw_path, b"dir/nested.txt");
    }

    fn git_fixture_guard() -> MutexGuard<'static, ()> {
        crate::git::GIT_FIXTURE_LOCK
            .lock()
            .expect("Git fixture lock")
    }

    #[derive(Debug, PartialEq, Eq)]
    struct TreeFingerprint {
        head: Vec<u8>,
        main: Vec<u8>,
        index: Vec<u8>,
        config: Vec<u8>,
    }

    struct TreeFixture {
        _temp: TempDir,
        repository: PathBuf,
        outside: PathBuf,
        home: PathBuf,
        git: PathBuf,
    }

    impl TreeFixture {
        fn new() -> Self {
            let temp = tempdir().expect("tree fixture root");
            let repository = temp.path().join("Tree Repository 한글");
            let outside = temp.path().join("outside.txt");
            let home = temp.path().join("isolated-home");
            fs::create_dir_all(&repository).expect("repository directory");
            fs::create_dir_all(&home).expect("fixture home");
            fs::write(&outside, b"must not be followed\n").expect("outside target");
            fs::write(home.join(".gitconfig"), b"").expect("empty fixture config");
            let executable = ValidatedGitExecutable::discover(None).expect("supported Git");
            let git = executable.path().to_path_buf();
            let fixture = Self {
                _temp: temp,
                repository,
                outside,
                home,
                git,
            };
            fixture.run(["init", "-b", "main", "."]);
            fs::write(fixture.repository.join("seed.txt"), b"seed\n").expect("seed file");
            fixture.run(["add", "--", "seed.txt"]);
            fixture.commit();
            fixture
        }

        fn populate(&self) {
            fs::write(self.repository.join("regular.txt"), b"regular\n").expect("regular file");
            fs::create_dir_all(self.repository.join("bin")).expect("bin directory");
            fs::write(self.repository.join("bin/run.sh"), b"#!/bin/sh\n").expect("script");
            fs::create_dir_all(self.repository.join("dir")).expect("dir directory");
            fs::write(self.repository.join("dir/nested.txt"), b"nested\n").expect("nested file");
            self.run(["add", "--", "."]);
            self.run(["update-index", "--chmod=+x", "bin/run.sh"]);
            let link_blob = String::from_utf8(
                self.run(vec![
                    OsString::from("hash-object"),
                    OsString::from("-w"),
                    self.outside.as_os_str().to_owned(),
                ])
                .stdout,
            )
            .expect("symlink target blob ID")
            .trim()
            .to_string();
            self.run([
                "update-index",
                "--add",
                "--cacheinfo",
                &format!("120000,{link_blob},outside-link"),
            ]);
            let head = self.commit_id().hex;
            self.run([
                "update-index",
                "--add",
                "--cacheinfo",
                &format!("160000,{head},vendor/submodule"),
            ]);
            self.commit();
        }

        fn commit(&self) {
            self.run([
                "-c",
                "user.name=Forktail Fixture",
                "-c",
                "user.email=fixture@example.invalid",
                "commit",
                "--no-gpg-sign",
                "-m",
                "fixture commit",
            ]);
        }

        fn commit_id(&self) -> GitObjectId {
            let hex = String::from_utf8(self.run(["rev-parse", "HEAD"]).stdout)
                .expect("commit ID")
                .trim()
                .to_string();
            GitObjectId::try_new(GitObjectAlgorithm::Sha1, hex).expect("valid fixture ID")
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

        fn fingerprint(&self) -> TreeFingerprint {
            let git_dir = self.repository.join(".git");
            TreeFingerprint {
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
            let output = command.output().expect("fixture Git starts");
            assert!(
                output.status.success(),
                "fixture Git failed: {}",
                String::from_utf8_lossy(&output.stderr)
            );
            output
        }
    }
}
