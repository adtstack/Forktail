use crate::domain::git::{
    GitIndexEntry, GitObjectAlgorithm, GitObjectId, GitPathIdentity, GitPathPlatform,
    GitPathRegistryError,
};
use crate::git::repository::GitRepositorySession;
use crate::git::runner::{CancellationToken, GitOperation, OutputStream, RunnerError};
use blake3::Hash;
use std::ffi::OsString;
use std::fs::{self, File};
use std::io::Read;
use std::path::{Component, Path};
use std::time::SystemTime;

const MAX_INDEX_RECORDS: usize = 4;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GitIndexError {
    Runner(RunnerError),
    CommandFailed,
    OutputTooLarge,
    TruncatedOutput,
    InvalidTag,
    InvalidMode,
    InvalidObjectId,
    InvalidStage,
    InvalidRecord,
    InvalidPath,
    TooManyRecords,
    UnexpectedPath,
    DuplicateStage,
    UnmergedPath,
    IndexUnavailable,
    IndexChanged,
    StateUnavailable,
    UnknownPath,
    StaleGeneration,
    PathUnsupported,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ParsedIndexEntry {
    mode: String,
    object_id: GitObjectId,
    stage: u8,
    path: Vec<u8>,
    skip_worktree: bool,
    assume_unchanged: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct IndexFingerprint {
    size: u64,
    modified: Option<SystemTime>,
    hash: Hash,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct IndexRead {
    pub entry: Option<GitIndexEntry>,
    pub fingerprint: IndexFingerprint,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum IndexReadStep {
    AfterCommand,
}

pub(crate) fn read_stage_zero_index_entry(
    session: &GitRepositorySession,
    path: &GitPathIdentity,
    generation: u64,
    cancellation: &CancellationToken,
) -> Result<IndexRead, GitIndexError> {
    read_stage_zero_index_entry_inner(session, path, generation, cancellation, |_| {})
}

fn read_stage_zero_index_entry_inner<Hook>(
    session: &GitRepositorySession,
    path: &GitPathIdentity,
    generation: u64,
    cancellation: &CancellationToken,
    mut hook: Hook,
) -> Result<IndexRead, GitIndexError>
where
    Hook: FnMut(IndexReadStep),
{
    if cancellation.is_cancelled() {
        return Err(GitIndexError::Runner(RunnerError::Cancelled));
    }
    let (identity, raw_path, path_argument) = resolve_path(session, path, generation)?;
    let fingerprint = capture_index_fingerprint(session)?;
    let output = session
        .executable()
        .runner()
        .run(
            GitOperation::IndexEntries {
                repository: session.identity().root.clone(),
                path: path_argument,
            },
            cancellation,
        )
        .map_err(map_runner_error)?;
    if !output.success {
        return Err(GitIndexError::CommandFailed);
    }
    let entries = parse_index_records(&output.stdout, session.identity().object_format)?;
    hook(IndexReadStep::AfterCommand);
    if capture_index_fingerprint(session)? != fingerprint {
        return Err(GitIndexError::IndexChanged);
    }

    if entries.iter().any(|entry| entry.path != raw_path) {
        return Err(GitIndexError::UnexpectedPath);
    }
    if entries.iter().any(|entry| entry.stage != 0) {
        return Err(GitIndexError::UnmergedPath);
    }
    if entries.len() > 1 {
        return Err(GitIndexError::DuplicateStage);
    }
    let entry = entries.into_iter().next().map(|entry| GitIndexEntry {
        path: identity,
        mode: entry.mode,
        object_id: entry.object_id,
        skip_worktree: entry.skip_worktree,
        assume_unchanged: entry.assume_unchanged,
    });
    Ok(IndexRead { entry, fingerprint })
}

pub(crate) fn index_entry_visible_against_head(
    session: &GitRepositorySession,
    path: &GitPathIdentity,
    head_commit_id: &GitObjectId,
    generation: u64,
    expected_fingerprint: &IndexFingerprint,
    cancellation: &CancellationToken,
) -> Result<bool, GitIndexError> {
    if &capture_index_fingerprint(session)? != expected_fingerprint {
        return Err(GitIndexError::IndexChanged);
    }
    let (_, _, path_argument) = resolve_path(session, path, generation)?;
    let output = session
        .executable()
        .runner()
        .run(
            GitOperation::IndexVisibility {
                repository: session.identity().root.clone(),
                head_commit_id: head_commit_id.hex.clone(),
                path: path_argument,
            },
            cancellation,
        )
        .map_err(map_runner_error)?;
    if !output.success {
        return Err(GitIndexError::CommandFailed);
    }
    if !output.stdout.is_empty() && !output.stdout.ends_with(&[0]) {
        return Err(GitIndexError::TruncatedOutput);
    }
    if &capture_index_fingerprint(session)? != expected_fingerprint {
        return Err(GitIndexError::IndexChanged);
    }
    Ok(!output.stdout.is_empty())
}

pub(crate) fn index_fingerprint_matches(
    session: &GitRepositorySession,
    expected: &IndexFingerprint,
) -> Result<bool, GitIndexError> {
    capture_index_fingerprint(session).map(|actual| actual == *expected)
}

pub(crate) fn capture_index_fingerprint(
    session: &GitRepositorySession,
) -> Result<IndexFingerprint, GitIndexError> {
    let path = session.identity().git_dir.join("index");
    let before = fs::symlink_metadata(&path).map_err(|_| GitIndexError::IndexUnavailable)?;
    if before.file_type().is_symlink() || !before.is_file() {
        return Err(GitIndexError::IndexUnavailable);
    }
    let mut file = File::open(&path).map_err(|_| GitIndexError::IndexUnavailable)?;
    let opened = file
        .metadata()
        .map_err(|_| GitIndexError::IndexUnavailable)?;
    if opened.len() != before.len() || opened.modified().ok() != before.modified().ok() {
        return Err(GitIndexError::IndexChanged);
    }
    let mut hasher = blake3::Hasher::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|_| GitIndexError::IndexUnavailable)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    let after = file
        .metadata()
        .map_err(|_| GitIndexError::IndexUnavailable)?;
    if after.len() != opened.len() || after.modified().ok() != opened.modified().ok() {
        return Err(GitIndexError::IndexChanged);
    }
    Ok(IndexFingerprint {
        size: after.len(),
        modified: after.modified().ok(),
        hash: hasher.finalize(),
    })
}

fn parse_index_records(
    output: &[u8],
    algorithm: GitObjectAlgorithm,
) -> Result<Vec<ParsedIndexEntry>, GitIndexError> {
    if output.is_empty() {
        return Ok(Vec::new());
    }
    if !output.ends_with(&[0]) {
        return Err(GitIndexError::TruncatedOutput);
    }
    let mut entries = Vec::new();
    for record in output[..output.len() - 1].split(|byte| *byte == 0) {
        if entries.len() == MAX_INDEX_RECORDS {
            return Err(GitIndexError::TooManyRecords);
        }
        entries.push(parse_index_record(record, algorithm)?);
    }
    Ok(entries)
}

fn parse_index_record(
    record: &[u8],
    algorithm: GitObjectAlgorithm,
) -> Result<ParsedIndexEntry, GitIndexError> {
    let (&tag, remainder) = record.split_first().ok_or(GitIndexError::InvalidRecord)?;
    let (skip_worktree, assume_unchanged) = match tag {
        b'H' | b'M' => (false, false),
        b'S' => (true, false),
        b'h' | b'm' => (false, true),
        b's' => (true, true),
        _ => return Err(GitIndexError::InvalidTag),
    };
    let remainder = remainder
        .strip_prefix(b" ")
        .ok_or(GitIndexError::InvalidRecord)?;
    let tab = remainder
        .iter()
        .position(|byte| *byte == b'\t')
        .ok_or(GitIndexError::InvalidRecord)?;
    let header = &remainder[..tab];
    let path = &remainder[tab + 1..];
    validate_raw_path(path)?;
    let fields = header.split(|byte| *byte == b' ').collect::<Vec<_>>();
    if fields.len() != 3 || fields.iter().any(|field| field.is_empty()) {
        return Err(GitIndexError::InvalidRecord);
    }
    let mode = std::str::from_utf8(fields[0]).map_err(|_| GitIndexError::InvalidMode)?;
    if !matches!(mode, "100644" | "100755" | "120000" | "160000") {
        return Err(GitIndexError::InvalidMode);
    }
    let object = std::str::from_utf8(fields[1]).map_err(|_| GitIndexError::InvalidObjectId)?;
    let object_id = GitObjectId::try_new(algorithm, object.to_string())
        .map_err(|_| GitIndexError::InvalidObjectId)?;
    let stage = match fields[2] {
        [b'0'] => 0,
        [b'1'] => 1,
        [b'2'] => 2,
        [b'3'] => 3,
        _ => return Err(GitIndexError::InvalidStage),
    };
    Ok(ParsedIndexEntry {
        mode: mode.to_string(),
        object_id,
        stage,
        path: path.to_vec(),
        skip_worktree,
        assume_unchanged,
    })
}

fn validate_raw_path(path: &[u8]) -> Result<(), GitIndexError> {
    if path.is_empty()
        || path.contains(&0)
        || path.starts_with(b"/")
        || path
            .split(|byte| *byte == b'/')
            .any(|component| component.is_empty() || component == b"." || component == b"..")
    {
        Err(GitIndexError::InvalidPath)
    } else {
        Ok(())
    }
}

fn resolve_path(
    session: &GitRepositorySession,
    path: &GitPathIdentity,
    generation: u64,
) -> Result<(GitPathIdentity, Vec<u8>, OsString), GitIndexError> {
    let paths = session
        .paths()
        .lock()
        .map_err(|_| GitIndexError::StateUnavailable)?;
    let platform = if cfg!(windows) {
        GitPathPlatform::Windows
    } else {
        GitPathPlatform::Unix
    };
    let raw_path = paths
        .resolve(&path.opaque_id, generation, platform)
        .map_err(map_path_error)?
        .to_vec();
    let identity = paths
        .resolve_identity(&path.opaque_id, generation, platform)
        .map_err(map_path_error)?;
    drop(paths);
    validate_raw_path(&raw_path)?;
    let path_argument = raw_path_to_os_string(raw_path.clone())?;
    let native_path = Path::new(&path_argument);
    if native_path.is_absolute()
        || native_path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(GitIndexError::InvalidPath);
    }
    Ok((identity, raw_path, path_argument))
}

#[cfg(all(unix, not(target_os = "macos")))]
fn raw_path_to_os_string(raw_path: Vec<u8>) -> Result<OsString, GitIndexError> {
    use std::os::unix::ffi::OsStringExt;
    Ok(OsString::from_vec(raw_path))
}

#[cfg(any(target_os = "macos", windows))]
fn raw_path_to_os_string(raw_path: Vec<u8>) -> Result<OsString, GitIndexError> {
    String::from_utf8(raw_path)
        .map(OsString::from)
        .map_err(|_| GitIndexError::PathUnsupported)
}

#[cfg(not(any(unix, windows)))]
fn raw_path_to_os_string(raw_path: Vec<u8>) -> Result<OsString, GitIndexError> {
    String::from_utf8(raw_path)
        .map(OsString::from)
        .map_err(|_| GitIndexError::PathUnsupported)
}

fn map_path_error(error: GitPathRegistryError) -> GitIndexError {
    match error {
        GitPathRegistryError::UnknownOpaqueId => GitIndexError::UnknownPath,
        GitPathRegistryError::StaleGeneration => GitIndexError::StaleGeneration,
        GitPathRegistryError::PlatformConversionUnsupported => GitIndexError::PathUnsupported,
        GitPathRegistryError::EmptyPath
        | GitPathRegistryError::PathContainsNul
        | GitPathRegistryError::DuplicateOpaqueId
        | GitPathRegistryError::GenerationExhausted
        | GitPathRegistryError::OpaqueIdExhausted => GitIndexError::StateUnavailable,
    }
}

fn map_runner_error(error: RunnerError) -> GitIndexError {
    match error {
        RunnerError::OutputTooLarge(OutputStream::Stdout) => GitIndexError::OutputTooLarge,
        other => GitIndexError::Runner(other),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        GitIndexError, IndexReadStep, parse_index_records, read_stage_zero_index_entry_inner,
    };
    use crate::domain::git::{
        GitCompareSourceKind, GitIndexComparison, GitObjectAlgorithm, GitSnapshotContentState,
        GitSnapshotOrigin, GitSnapshotUnavailableReason,
    };
    use crate::git::executable::ValidatedGitExecutable;
    use crate::git::repository::GitRepositorySession;
    use crate::git::runner::CancellationToken;
    use crate::git::session::{GitSessionError, open_index_compare};
    use std::ffi::OsStr;
    use std::fs;
    use std::path::PathBuf;
    use std::process::{Command, Output, Stdio};
    use std::sync::MutexGuard;
    use std::time::SystemTime;
    use tempfile::{TempDir, tempdir};

    fn record(tag: u8, mode: &[u8], object: &[u8], stage: u8, path: &[u8]) -> Vec<u8> {
        let mut output = vec![tag, b' '];
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
    fn parses_stage_zero_flags_modes_sha256_and_lossless_paths() {
        let sha1 = b"a".repeat(40);
        let sha256 = b"b".repeat(64);
        let normal = parse_index_records(
            &record(b'H', b"100644", &sha1, b'0', b"space tab\tline\n\xff.txt"),
            GitObjectAlgorithm::Sha1,
        )
        .expect("normal stage-zero entry");
        assert_eq!(normal.len(), 1);
        assert_eq!(normal[0].path, b"space tab\tline\n\xff.txt");
        assert!(!normal[0].skip_worktree);
        assert!(!normal[0].assume_unchanged);
        assert_eq!(normal[0].stage, 0);

        let skip = parse_index_records(
            &record(b'S', b"100755", &sha1, b'0', b"sparse/file.sh"),
            GitObjectAlgorithm::Sha1,
        )
        .expect("skip-worktree entry");
        assert!(skip[0].skip_worktree);
        assert!(!skip[0].assume_unchanged);

        let assumed = parse_index_records(
            &record(b'h', b"120000", &sha1, b'0', b"link"),
            GitObjectAlgorithm::Sha1,
        )
        .expect("assume-unchanged entry");
        assert!(assumed[0].assume_unchanged);
        assert!(!assumed[0].skip_worktree);

        let modern = parse_index_records(
            &record(b'H', b"160000", &sha256, b'0', b"submodule"),
            GitObjectAlgorithm::Sha256,
        )
        .expect("SHA-256 entry");
        assert_eq!(modern[0].object_id.hex, "b".repeat(64));
    }

    #[test]
    fn preserves_unmerged_stages_and_rejects_malformed_or_truncated_records() {
        let object = b"c".repeat(40);
        let mut unmerged = Vec::new();
        for stage in *b"123" {
            unmerged.extend(record(b'M', b"100644", &object, stage, b"conflict.txt"));
        }
        let parsed = parse_index_records(&unmerged, GitObjectAlgorithm::Sha1)
            .expect("unmerged stage records");
        assert_eq!(
            parsed.iter().map(|entry| entry.stage).collect::<Vec<_>>(),
            vec![1, 2, 3]
        );

        let cases = [
            (
                record(b'X', b"100644", &object, b'0', b"bad-tag"),
                GitIndexError::InvalidTag,
            ),
            (
                record(b'H', b"10064x", &object, b'0', b"bad-mode"),
                GitIndexError::InvalidMode,
            ),
            (
                record(b'H', b"100644", b"abcd", b'0', b"bad-object"),
                GitIndexError::InvalidObjectId,
            ),
            (
                record(b'H', b"100644", &object, b'4', b"bad-stage"),
                GitIndexError::InvalidStage,
            ),
            (
                record(b'H', b"100644", &object, b'0', b"../escape"),
                GitIndexError::InvalidPath,
            ),
            (
                {
                    let mut truncated = record(b'H', b"100644", &object, b'0', b"file");
                    truncated.pop();
                    truncated
                },
                GitIndexError::TruncatedOutput,
            ),
        ];
        for (output, expected) in cases {
            assert_eq!(
                parse_index_records(&output, GitObjectAlgorithm::Sha1),
                Err(expected)
            );
        }
    }

    #[test]
    fn opens_three_distinct_states_and_explicit_missing_without_mutation() {
        let _guard = git_fixture_guard();
        let fixture = IndexFixture::new();
        let session = fixture.session("index-three-state");
        let (paths, generation) = register_paths(
            &session,
            &[
                b"state.txt",
                b"untracked.txt",
                b"staged-delete.txt",
                b"unstaged-delete.txt",
                b"sparse.txt",
                b"intent.txt",
            ],
        );
        let before = fixture.fingerprint();
        let cancellation = CancellationToken::new();

        let head_index = open_index_compare(
            &session,
            &paths[0],
            GitIndexComparison::HeadToIndex,
            generation,
            &cancellation,
        )
        .expect("HEAD to index");
        assert_eq!(head_index.source_kind, GitCompareSourceKind::HeadIndex);
        assert_eq!(snapshot_text(&head_index.left), Some("head\n"));
        assert_eq!(snapshot_text(&head_index.right), Some("index\n"));
        assert_eq!(head_index.right.origin, GitSnapshotOrigin::IndexStage);

        let index_working = open_index_compare(
            &session,
            &paths[0],
            GitIndexComparison::IndexToWorkingTree,
            generation,
            &cancellation,
        )
        .expect("index to working tree");
        assert_eq!(
            index_working.source_kind,
            GitCompareSourceKind::IndexWorkingTree
        );
        assert_eq!(snapshot_text(&index_working.left), Some("index\n"));
        assert_eq!(snapshot_text(&index_working.right), Some("working\n"));

        let head_working = open_index_compare(
            &session,
            &paths[0],
            GitIndexComparison::HeadToWorkingTree,
            generation,
            &cancellation,
        )
        .expect("HEAD to working tree");
        assert_eq!(
            head_working.source_kind,
            GitCompareSourceKind::RevisionWorkingTree
        );
        assert_eq!(snapshot_text(&head_working.left), Some("head\n"));
        assert_eq!(snapshot_text(&head_working.right), Some("working\n"));

        let untracked = open_index_compare(
            &session,
            &paths[1],
            GitIndexComparison::IndexToWorkingTree,
            generation,
            &cancellation,
        )
        .expect("untracked compare");
        assert_eq!(
            untracked.left.content_state,
            GitSnapshotContentState::Missing
        );
        assert_eq!(snapshot_text(&untracked.right), Some("untracked\n"));

        let staged_delete = open_index_compare(
            &session,
            &paths[2],
            GitIndexComparison::HeadToIndex,
            generation,
            &cancellation,
        )
        .expect("staged deletion");
        assert!(matches!(
            staged_delete.left.content_state,
            GitSnapshotContentState::Text { .. }
        ));
        assert_eq!(
            staged_delete.right.content_state,
            GitSnapshotContentState::Missing
        );

        let unstaged_delete = open_index_compare(
            &session,
            &paths[3],
            GitIndexComparison::IndexToWorkingTree,
            generation,
            &cancellation,
        )
        .expect("unstaged deletion");
        assert!(matches!(
            unstaged_delete.left.content_state,
            GitSnapshotContentState::Text { .. }
        ));
        assert_eq!(
            unstaged_delete.right.content_state,
            GitSnapshotContentState::Missing
        );

        let sparse = open_index_compare(
            &session,
            &paths[4],
            GitIndexComparison::IndexToWorkingTree,
            generation,
            &cancellation,
        )
        .expect("sparse missing compare");
        assert!(matches!(
            sparse.left.content_state,
            GitSnapshotContentState::Text { .. }
        ));
        assert_eq!(
            sparse.right.content_state,
            GitSnapshotContentState::Unavailable {
                reason: GitSnapshotUnavailableReason::SparseWorkingTreeMissing,
            }
        );

        assert_eq!(
            open_index_compare(
                &session,
                &paths[5],
                GitIndexComparison::IndexToWorkingTree,
                generation,
                &cancellation,
            ),
            Err(GitSessionError::IntentToAddUnsupported),
        );
        assert_eq!(fixture.fingerprint(), before);
    }

    #[test]
    fn rejects_unmerged_and_index_race_without_returning_a_mixed_snapshot() {
        let _guard = git_fixture_guard();
        let fixture = IndexFixture::conflict();
        let session = fixture.session("index-conflict");
        let (paths, generation) = register_paths(&session, &[b"conflict.txt"]);
        let before = fixture.fingerprint();
        assert_eq!(
            open_index_compare(
                &session,
                &paths[0],
                GitIndexComparison::HeadToIndex,
                generation,
                &CancellationToken::new(),
            ),
            Err(GitSessionError::UnmergedIndexPath),
        );
        assert_eq!(fixture.fingerprint(), before);

        let clean_fixture = IndexFixture::new();
        let clean_session = clean_fixture.session("index-race");
        let (clean_paths, clean_generation) = register_paths(&clean_session, &[b"state.txt"]);
        let index_path = clean_fixture.repository.join(".git/index");
        let original_index = fs::read(&index_path).expect("index before race");
        let result = read_stage_zero_index_entry_inner(
            &clean_session,
            &clean_paths[0],
            clean_generation,
            &CancellationToken::new(),
            |step| {
                if step == IndexReadStep::AfterCommand {
                    fs::write(&index_path, b"changed during read").expect("inject index race");
                }
            },
        );
        fs::write(&index_path, original_index).expect("restore index fixture");
        assert_eq!(result, Err(GitIndexError::IndexChanged));
    }

    #[cfg(unix)]
    #[test]
    fn represents_a_regular_file_to_symlink_index_type_change_without_following_it() {
        let _guard = git_fixture_guard();
        let fixture = IndexFixture::type_change();
        let session = fixture.session("index-type-change");
        let (paths, generation) = register_paths(&session, &[b"type-change.txt"]);
        let before = fixture.fingerprint();

        let compare = open_index_compare(
            &session,
            &paths[0],
            GitIndexComparison::HeadToIndex,
            generation,
            &CancellationToken::new(),
        )
        .expect("HEAD regular file to index symlink");

        assert!(matches!(
            compare.left.content_state,
            GitSnapshotContentState::Text { .. }
        ));
        assert_eq!(
            compare.right.content_state,
            GitSnapshotContentState::Symlink
        );
        assert_eq!(compare.right.mode.as_deref(), Some("120000"));
        assert_eq!(fixture.fingerprint(), before);
    }

    fn snapshot_text(document: &crate::GitSnapshotDocument) -> Option<&str> {
        match &document.content_state {
            GitSnapshotContentState::Text { text } => Some(text),
            _ => None,
        }
    }

    fn register_paths(
        session: &GitRepositorySession,
        raw_paths: &[&[u8]],
    ) -> (Vec<crate::GitPathIdentity>, u64) {
        let mut paths = session.paths().lock().expect("path registry");
        paths.refresh().expect("refresh paths");
        let generation = paths.generation();
        let identities = raw_paths
            .iter()
            .map(|path| paths.register((*path).to_vec()).expect("register path"))
            .collect();
        (identities, generation)
    }

    fn git_fixture_guard() -> MutexGuard<'static, ()> {
        crate::git::GIT_FIXTURE_LOCK
            .lock()
            .expect("Git fixture lock")
    }

    #[derive(Debug, PartialEq, Eq)]
    struct IndexFingerprint {
        head: Vec<u8>,
        index: Vec<u8>,
        index_modified: SystemTime,
        worktree: Vec<(String, Option<Vec<u8>>)>,
    }

    struct IndexFixture {
        _temp: TempDir,
        repository: PathBuf,
        home: PathBuf,
        git: PathBuf,
    }

    impl IndexFixture {
        fn base() -> Self {
            let temp = tempdir().expect("index fixture root");
            let repository = temp.path().join("Index Repository 한글");
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
            fixture
        }

        fn new() -> Self {
            let fixture = Self::base();
            for (path, content) in [
                ("state.txt", b"head\n".as_slice()),
                ("staged-delete.txt", b"staged delete\n".as_slice()),
                ("unstaged-delete.txt", b"unstaged delete\n".as_slice()),
                ("sparse.txt", b"sparse\n".as_slice()),
            ] {
                fs::write(fixture.repository.join(path), content).expect("base file");
            }
            fixture.run(["add", "--", "."]);
            fixture.commit("base");

            fs::write(fixture.repository.join("state.txt"), b"index\n").expect("index state");
            fixture.run(["add", "--", "state.txt"]);
            fs::write(fixture.repository.join("state.txt"), b"working\n").expect("working state");
            fs::remove_file(fixture.repository.join("staged-delete.txt")).expect("staged deletion");
            fixture.run(["add", "--", "staged-delete.txt"]);
            fs::remove_file(fixture.repository.join("unstaged-delete.txt"))
                .expect("unstaged deletion");
            fs::write(fixture.repository.join("untracked.txt"), b"untracked\n")
                .expect("untracked file");
            fs::write(fixture.repository.join("intent.txt"), b"intent content\n")
                .expect("intent file");
            fixture.run(["add", "-N", "--", "intent.txt"]);
            fixture.run(["update-index", "--skip-worktree", "--", "sparse.txt"]);
            fs::remove_file(fixture.repository.join("sparse.txt")).expect("sparse missing file");
            fixture
        }

        fn conflict() -> Self {
            let fixture = Self::base();
            fs::write(fixture.repository.join("conflict.txt"), b"base\n").expect("base file");
            fixture.run(["add", "--", "conflict.txt"]);
            fixture.commit("base");
            fixture.run(["checkout", "-b", "other"]);
            fs::write(fixture.repository.join("conflict.txt"), b"other\n").expect("other file");
            fixture.run(["add", "--", "conflict.txt"]);
            fixture.commit("other");
            fixture.run(["checkout", "main"]);
            fs::write(fixture.repository.join("conflict.txt"), b"main\n").expect("main file");
            fixture.run(["add", "--", "conflict.txt"]);
            fixture.commit("main");
            let merge = fixture.run_allow_failure([
                "-c",
                "user.useConfigOnly=true",
                "-c",
                "user.name=Forktail Fixture",
                "-c",
                "user.email=fixture@example.invalid",
                "merge",
                "--no-edit",
                "other",
            ]);
            assert_eq!(
                merge.status.code(),
                Some(1),
                "fixture merge must produce a conflict: {}",
                String::from_utf8_lossy(&merge.stderr)
            );
            fixture
        }

        #[cfg(unix)]
        fn type_change() -> Self {
            use std::os::unix::fs::symlink;

            let fixture = Self::base();
            let path = fixture.repository.join("type-change.txt");
            fs::write(&path, b"regular\n").expect("regular file");
            fixture.run(["add", "--", "type-change.txt"]);
            fixture.commit("regular base");
            fs::remove_file(&path).expect("replace regular file");
            symlink("unfollowed-target", &path).expect("index symlink");
            fixture.run(["add", "--", "type-change.txt"]);
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

        fn fingerprint(&self) -> IndexFingerprint {
            let index_path = self.repository.join(".git/index");
            let worktree = [
                "state.txt",
                "untracked.txt",
                "staged-delete.txt",
                "unstaged-delete.txt",
                "sparse.txt",
                "intent.txt",
                "conflict.txt",
            ]
            .into_iter()
            .map(|path| {
                let bytes = match fs::read(self.repository.join(path)) {
                    Ok(bytes) => Some(bytes),
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
                    Err(error) => panic!("working file fingerprint {path}: {error}"),
                };
                (path.to_string(), bytes)
            })
            .collect();
            IndexFingerprint {
                head: fs::read(self.repository.join(".git/HEAD")).expect("HEAD fingerprint"),
                index: fs::read(&index_path).expect("index fingerprint"),
                index_modified: fs::metadata(index_path)
                    .and_then(|metadata| metadata.modified())
                    .expect("index mtime"),
                worktree,
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
