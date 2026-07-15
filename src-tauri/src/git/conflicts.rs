use crate::domain::git::{
    GitConflictEntry, GitConflictList, GitConflictOperation, GitConflictStage, GitObjectAlgorithm,
    GitObjectId, GitPathRegistryError,
};
use crate::git::index::{GitIndexError, capture_index_fingerprint};
use crate::git::repository::GitRepositorySession;
use crate::git::runner::{CancellationToken, GitOperation, OutputStream, RunnerError};
use std::collections::HashMap;
use std::fs;
use std::path::Path;

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
        ConflictReadStep, GitConflictError, detect_conflict_operation, list_conflicts_inner,
        parse_conflict_records,
    };
    use crate::domain::git::{GitConflictOperation, GitObjectAlgorithm};
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
