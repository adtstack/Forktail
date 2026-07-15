use crate::domain::git::{GitMergeBase, GitObjectAlgorithm, GitObjectId};
use crate::git::repository::GitRepositorySession;
use crate::git::runner::{BlobQuery, CancellationToken, GitOperation, RunnerError, RunnerOutput};
use std::collections::HashSet;
use std::path::Path;

const MAX_MERGE_BASE_CANDIDATES: usize = 64;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GitMergeBaseError {
    Runner(RunnerError),
    ObjectMissingLocal,
    ObjectTypeUnsupported,
    ObjectFormatUnsupported,
    InvalidObjectId,
    CommandFailed,
    InvalidOutput,
    TooManyCandidates,
}

pub fn get_merge_base(
    session: &GitRepositorySession,
    left: &GitObjectId,
    right: &GitObjectId,
    cancellation: &CancellationToken,
) -> Result<GitMergeBase, GitMergeBaseError> {
    get_merge_base_with(
        &session.identity().root,
        session.identity().object_format,
        left,
        right,
        cancellation,
        |operation, cancellation| session.executable().runner().run(operation, cancellation),
    )
}

fn get_merge_base_with<Run>(
    repository: &Path,
    algorithm: GitObjectAlgorithm,
    left: &GitObjectId,
    right: &GitObjectId,
    cancellation: &CancellationToken,
    mut run: Run,
) -> Result<GitMergeBase, GitMergeBaseError>
where
    Run: FnMut(GitOperation, &CancellationToken) -> Result<RunnerOutput, RunnerError>,
{
    if cancellation.is_cancelled() {
        return Err(GitMergeBaseError::Runner(RunnerError::Cancelled));
    }
    if !matches!(
        algorithm,
        GitObjectAlgorithm::Sha1 | GitObjectAlgorithm::Sha256
    ) {
        return Err(GitMergeBaseError::ObjectFormatUnsupported);
    }
    if left.algorithm != algorithm || right.algorithm != algorithm {
        return Err(GitMergeBaseError::InvalidObjectId);
    }

    for object_id in [left, right] {
        let output = run(
            GitOperation::Blob {
                repository: repository.to_path_buf(),
                object_id: object_id.hex.clone(),
                query: BlobQuery::Type,
            },
            cancellation,
        )
        .map_err(GitMergeBaseError::Runner)?;
        if !output.success {
            return Err(GitMergeBaseError::ObjectMissingLocal);
        }
        if output.exit_code != Some(0) || output.stdout != b"commit\n" {
            return if output.stdout.ends_with(b"\n") {
                Err(GitMergeBaseError::ObjectTypeUnsupported)
            } else {
                Err(GitMergeBaseError::InvalidOutput)
            };
        }
    }

    let output = run(
        GitOperation::MergeBase {
            repository: repository.to_path_buf(),
            left_commit_id: left.hex.clone(),
            right_commit_id: right.hex.clone(),
        },
        cancellation,
    )
    .map_err(GitMergeBaseError::Runner)?;
    parse_merge_base_output(algorithm, &output)
}

fn parse_merge_base_output(
    algorithm: GitObjectAlgorithm,
    output: &RunnerOutput,
) -> Result<GitMergeBase, GitMergeBaseError> {
    if !output.success {
        return if output.exit_code == Some(1) && output.stdout.is_empty() {
            Ok(GitMergeBase::None)
        } else {
            Err(GitMergeBaseError::CommandFailed)
        };
    }
    if output.exit_code != Some(0) || output.stdout.is_empty() || !output.stdout.ends_with(b"\n") {
        return Err(GitMergeBaseError::InvalidOutput);
    }

    let mut seen = HashSet::new();
    let mut candidates = Vec::new();
    for raw in output.stdout[..output.stdout.len() - 1].split(|byte| *byte == b'\n') {
        if raw.is_empty() || candidates.len() >= MAX_MERGE_BASE_CANDIDATES {
            return Err(if candidates.len() >= MAX_MERGE_BASE_CANDIDATES {
                GitMergeBaseError::TooManyCandidates
            } else {
                GitMergeBaseError::InvalidOutput
            });
        }
        let hex = std::str::from_utf8(raw).map_err(|_| GitMergeBaseError::InvalidOutput)?;
        let object_id =
            GitObjectId::try_new(algorithm, hex).map_err(|_| GitMergeBaseError::InvalidOutput)?;
        if !seen.insert(object_id.hex.clone()) {
            return Err(GitMergeBaseError::InvalidOutput);
        }
        candidates.push(object_id);
    }

    match candidates.as_slice() {
        [] => Err(GitMergeBaseError::InvalidOutput),
        [object_id] => Ok(GitMergeBase::Single {
            object_id: object_id.clone(),
        }),
        _ => Ok(GitMergeBase::Multiple {
            object_ids: candidates,
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::git::{GitMergeBase, GitObjectAlgorithm, GitObjectId};
    use crate::git::executable::ValidatedGitExecutable;
    use crate::git::repository::GitRepositorySession;
    use crate::git::runner::{CancellationToken, RunnerError, RunnerOutput};
    use std::ffi::OsStr;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::process::{Command, Output, Stdio};
    use std::sync::MutexGuard;
    use tempfile::{TempDir, tempdir};

    #[test]
    fn parses_none_single_and_multiple_without_selecting_a_candidate() {
        let first = "1".repeat(40);
        let second = "2".repeat(40);

        assert_eq!(
            parse_merge_base_output(GitObjectAlgorithm::Sha1, &output(false, Some(1), b""),),
            Ok(GitMergeBase::None),
        );
        assert_eq!(
            parse_merge_base_output(
                GitObjectAlgorithm::Sha1,
                &output(true, Some(0), format!("{first}\n").as_bytes()),
            ),
            Ok(GitMergeBase::Single {
                object_id: object_id(&first),
            }),
        );
        assert_eq!(
            parse_merge_base_output(
                GitObjectAlgorithm::Sha1,
                &output(true, Some(0), format!("{first}\n{second}\n").as_bytes(),),
            ),
            Ok(GitMergeBase::Multiple {
                object_ids: vec![object_id(&first), object_id(&second)],
            }),
        );
    }

    #[test]
    fn rejects_missing_non_commit_and_malformed_or_duplicate_output() {
        let left = object_id(&"1".repeat(40));
        let right = object_id(&"2".repeat(40));
        let cancellation = CancellationToken::new();
        let mut calls = 0;
        let missing = get_merge_base_with(
            Path::new("/repo"),
            GitObjectAlgorithm::Sha1,
            &left,
            &right,
            &cancellation,
            |_, _| {
                calls += 1;
                Ok(if calls == 1 {
                    output(true, Some(0), b"commit\n")
                } else {
                    output(false, Some(128), b"")
                })
            },
        );
        assert_eq!(missing, Err(GitMergeBaseError::ObjectMissingLocal));

        let non_commit = get_merge_base_with(
            Path::new("/repo"),
            GitObjectAlgorithm::Sha1,
            &left,
            &right,
            &cancellation,
            |_, _| Ok(output(true, Some(0), b"tree\n")),
        );
        assert_eq!(non_commit, Err(GitMergeBaseError::ObjectTypeUnsupported));

        let duplicate = format!("{}\n{}\n", left.hex, left.hex);
        assert_eq!(
            parse_merge_base_output(
                GitObjectAlgorithm::Sha1,
                &output(true, Some(0), duplicate.as_bytes()),
            ),
            Err(GitMergeBaseError::InvalidOutput),
        );
        assert_eq!(
            parse_merge_base_output(
                GitObjectAlgorithm::Sha1,
                &output(true, Some(0), left.hex.as_bytes()),
            ),
            Err(GitMergeBaseError::InvalidOutput),
        );
    }

    #[test]
    fn preserves_typed_timeout_and_cancellation() {
        let left = object_id(&"1".repeat(40));
        let right = object_id(&"2".repeat(40));
        let cancellation = CancellationToken::new();
        for expected in [RunnerError::TimedOut, RunnerError::Cancelled] {
            let actual = get_merge_base_with(
                Path::new("/repo"),
                GitObjectAlgorithm::Sha1,
                &left,
                &right,
                &cancellation,
                |_, _| Err(expected),
            );
            assert_eq!(actual, Err(GitMergeBaseError::Runner(expected)));
        }
    }

    #[test]
    fn temp_repository_reports_single_none_and_criss_cross_multiple_without_mutation() {
        let _fixture_guard = git_fixture_guard();
        let fixture = MergeBaseFixture::new();
        let session = GitRepositorySession::open(
            "merge-base-session".to_string(),
            fixture.repository.clone(),
            fixture.runtime(),
        )
        .expect("fixture repository opens");
        let before = fixture.fingerprint();
        let cancellation = CancellationToken::new();

        assert_eq!(
            get_merge_base(
                &session,
                &object_id(&fixture.left_parent),
                &object_id(&fixture.left_head),
                &cancellation,
            ),
            Ok(GitMergeBase::Single {
                object_id: object_id(&fixture.left_parent),
            }),
        );
        assert_eq!(
            get_merge_base(
                &session,
                &object_id(&fixture.left_head),
                &object_id(&fixture.unrelated),
                &cancellation,
            ),
            Ok(GitMergeBase::None),
        );
        let multiple = get_merge_base(
            &session,
            &object_id(&fixture.left_head),
            &object_id(&fixture.right_head),
            &cancellation,
        )
        .expect("criss-cross bases");
        let GitMergeBase::Multiple { object_ids } = multiple else {
            panic!("expected multiple merge bases");
        };
        let mut actual = object_ids
            .into_iter()
            .map(|candidate| candidate.hex)
            .collect::<Vec<_>>();
        actual.sort();
        let mut expected = vec![fixture.left_parent.clone(), fixture.right_parent.clone()];
        expected.sort();
        assert_eq!(actual, expected);
        assert_eq!(fixture.fingerprint(), before);
    }

    fn output(success: bool, exit_code: Option<i32>, stdout: &[u8]) -> RunnerOutput {
        RunnerOutput {
            success,
            exit_code,
            stdout: stdout.to_vec(),
            stderr: Vec::new(),
        }
    }

    fn object_id(hex: &str) -> GitObjectId {
        GitObjectId::try_new(GitObjectAlgorithm::Sha1, hex).expect("valid fixture object ID")
    }

    fn git_fixture_guard() -> MutexGuard<'static, ()> {
        crate::git::GIT_FIXTURE_LOCK
            .lock()
            .expect("Git fixture lock")
    }

    #[derive(Debug, PartialEq, Eq)]
    struct RepositoryFingerprint {
        head: Vec<u8>,
        main: Vec<u8>,
        index: Option<Vec<u8>>,
        config: Vec<u8>,
    }

    struct MergeBaseFixture {
        _temp: TempDir,
        repository: PathBuf,
        home: PathBuf,
        git: PathBuf,
        left_parent: String,
        right_parent: String,
        left_head: String,
        right_head: String,
        unrelated: String,
    }

    impl MergeBaseFixture {
        fn new() -> Self {
            let temp = tempdir().expect("merge-base fixture root");
            let repository = temp.path().join("Merge Base Repository 한글");
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
                left_parent: String::new(),
                right_parent: String::new(),
                left_head: String::new(),
                right_head: String::new(),
                unrelated: String::new(),
            };
            fixture.run(["init", "-b", "main", "."]);
            let tree = fixture.empty_tree();
            let root = fixture.commit_tree(&tree, &[], "root");
            fixture.left_parent = fixture.commit_tree(&tree, &[&root], "left parent");
            fixture.right_parent = fixture.commit_tree(&tree, &[&root], "right parent");
            fixture.left_head = fixture.commit_tree(
                &tree,
                &[&fixture.left_parent, &fixture.right_parent],
                "left merge",
            );
            fixture.right_head = fixture.commit_tree(
                &tree,
                &[&fixture.right_parent, &fixture.left_parent],
                "right merge",
            );
            fixture.unrelated = fixture.commit_tree(&tree, &[], "unrelated");
            fixture.run(["update-ref", "refs/heads/main", &fixture.left_head]);
            fixture
        }

        fn empty_tree(&self) -> String {
            String::from_utf8(self.run_with_input(["mktree"], b"").stdout)
                .expect("tree ID")
                .trim()
                .to_string()
        }

        fn commit_tree(&self, tree: &str, parents: &[&str], message: &str) -> String {
            let mut arguments = vec!["commit-tree", tree];
            for parent in parents {
                arguments.extend(["-p", parent]);
            }
            arguments.extend(["-m", message]);
            String::from_utf8(self.run(arguments).stdout)
                .expect("commit ID")
                .trim()
                .to_string()
        }

        fn runtime(&self) -> ValidatedGitExecutable {
            ValidatedGitExecutable::discover(Some(self.git.clone())).expect("fixture Git runtime")
        }

        fn fingerprint(&self) -> RepositoryFingerprint {
            let git_dir = self.repository.join(".git");
            RepositoryFingerprint {
                head: fs::read(git_dir.join("HEAD")).expect("HEAD fingerprint"),
                main: fs::read(git_dir.join("refs/heads/main")).expect("main fingerprint"),
                index: fs::read(git_dir.join("index")).ok(),
                config: fs::read(git_dir.join("config")).expect("config fingerprint"),
            }
        }

        fn run<I, S>(&self, arguments: I) -> Output
        where
            I: IntoIterator<Item = S>,
            S: AsRef<OsStr>,
        {
            self.run_with_input(arguments, b"")
        }

        fn run_with_input<I, S>(&self, arguments: I, input: &[u8]) -> Output
        where
            I: IntoIterator<Item = S>,
            S: AsRef<OsStr>,
        {
            let mut child = self.command(arguments);
            child.stdin(Stdio::piped());
            let mut child = child.spawn().expect("fixture Git starts");
            use std::io::Write;
            child
                .stdin
                .take()
                .expect("fixture stdin")
                .write_all(input)
                .expect("fixture input");
            let output = child.wait_with_output().expect("fixture Git output");
            assert!(
                output.status.success(),
                "fixture Git command failed: {}",
                String::from_utf8_lossy(&output.stderr),
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
                .env("GIT_AUTHOR_NAME", "Forktail Fixture")
                .env("GIT_AUTHOR_EMAIL", "fixture@example.invalid")
                .env("GIT_COMMITTER_NAME", "Forktail Fixture")
                .env("GIT_COMMITTER_EMAIL", "fixture@example.invalid")
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
