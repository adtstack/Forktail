use crate::domain::git::{GitObjectAlgorithm, GitObjectId, GitRevision, GitRevisionKind};
use crate::git::repository::GitRepositorySession;
use crate::git::runner::{
    CancellationToken, GitOperation, RevisionQuery, RunnerError, RunnerOutput,
};
use std::collections::HashSet;

const MAX_RAW_REVISION_BYTES: usize = 1024;
const MAX_AMBIGUITY_CANDIDATES: usize = 16;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GitRevisionError {
    Runner(RunnerError),
    InvalidRevision,
    Ambiguous { candidates: Vec<String> },
    ObjectMissingLocal,
    InvalidOutput,
}

pub fn resolve_revision(
    session: &GitRepositorySession,
    raw_revision: &str,
) -> Result<GitRevision, GitRevisionError> {
    resolve_revision_with(raw_revision, session.identity().object_format, |query| {
        session.executable().runner().run(
            GitOperation::Revision {
                repository: session.identity().root.clone(),
                query,
            },
            &CancellationToken::new(),
        )
    })
}

fn resolve_revision_with<Query>(
    raw_revision: &str,
    algorithm: GitObjectAlgorithm,
    mut query: Query,
) -> Result<GitRevision, GitRevisionError>
where
    Query: FnMut(RevisionQuery) -> Result<RunnerOutput, RunnerError>,
{
    validate_raw_revision(raw_revision)?;

    let (revision_to_verify, kind, display_name) = if is_hex_object_expression(raw_revision) {
        let output = query(RevisionQuery::Disambiguate {
            prefix: raw_revision.to_string(),
        })
        .map_err(GitRevisionError::Runner)?;
        if !output.success {
            return Err(GitRevisionError::InvalidOutput);
        }
        let candidates = parse_object_candidates(&output.stdout, algorithm)?;
        match candidates.len() {
            0 => return Err(GitRevisionError::ObjectMissingLocal),
            1 => {}
            _ => {
                return Err(GitRevisionError::Ambiguous {
                    candidates: bounded_candidates(candidates),
                });
            }
        }
        (
            raw_revision.to_string(),
            GitRevisionKind::Commit,
            raw_revision.to_string(),
        )
    } else if is_short_ref_candidate(raw_revision) {
        let output = query(RevisionQuery::ShortRefCandidates {
            short_name: raw_revision.to_string(),
        })
        .map_err(GitRevisionError::Runner)?;
        if !output.success {
            return Err(GitRevisionError::InvalidOutput);
        }
        let candidates = parse_short_ref_candidates(&output.stdout, raw_revision)?;
        match candidates.as_slice() {
            [] => (
                raw_revision.to_string(),
                classify_revision_kind(raw_revision),
                raw_revision.to_string(),
            ),
            [candidate] => (
                candidate.clone(),
                classify_revision_kind(candidate),
                raw_revision.to_string(),
            ),
            _ => return Err(GitRevisionError::Ambiguous { candidates }),
        }
    } else {
        (
            raw_revision.to_string(),
            classify_revision_kind(raw_revision),
            display_revision_name(raw_revision),
        )
    };

    let output = query(RevisionQuery::VerifyCommit {
        revision: revision_to_verify,
    })
    .map_err(GitRevisionError::Runner)?;
    if !output.success {
        return Err(GitRevisionError::InvalidRevision);
    }
    let resolved = parse_verified_object_id(&output.stdout, algorithm)?;
    Ok(GitRevision {
        raw_label: raw_revision.to_string(),
        resolved,
        kind,
        display_name,
    })
}

fn validate_raw_revision(raw_revision: &str) -> Result<(), GitRevisionError> {
    if raw_revision.is_empty()
        || raw_revision.len() > MAX_RAW_REVISION_BYTES
        || raw_revision.starts_with('-')
        || raw_revision.trim() != raw_revision
        || raw_revision.chars().any(|character| character.is_control())
    {
        return Err(GitRevisionError::InvalidRevision);
    }
    Ok(())
}

fn is_hex_object_expression(raw_revision: &str) -> bool {
    (4..=64).contains(&raw_revision.len())
        && raw_revision.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn is_short_ref_candidate(raw_revision: &str) -> bool {
    raw_revision != "HEAD"
        && !raw_revision.starts_with("refs/")
        && !is_hex_object_expression(raw_revision)
        && !raw_revision.contains(['~', '^', ':', '?', '*', '[', '\\'])
        && !raw_revision.contains("@{")
        && !raw_revision.contains("..")
        && !raw_revision.contains("//")
        && !raw_revision.ends_with(['.', '/'])
        && !raw_revision.ends_with(".lock")
        && !raw_revision.chars().any(char::is_whitespace)
}

fn classify_revision_kind(value: &str) -> GitRevisionKind {
    if value == "HEAD" || value.starts_with("HEAD~") || value.starts_with("HEAD^") {
        GitRevisionKind::Head
    } else if value.starts_with("refs/heads/") {
        GitRevisionKind::Branch
    } else if value.starts_with("refs/remotes/") {
        GitRevisionKind::RemoteBranch
    } else if value.starts_with("refs/tags/") {
        GitRevisionKind::Tag
    } else if is_hex_object_expression(value) {
        GitRevisionKind::Commit
    } else {
        GitRevisionKind::Symbolic
    }
}

fn display_revision_name(value: &str) -> String {
    ["refs/heads/", "refs/remotes/", "refs/tags/"]
        .iter()
        .find_map(|prefix| value.strip_prefix(prefix))
        .unwrap_or(value)
        .to_string()
}

fn parse_short_ref_candidates(
    output: &[u8],
    short_name: &str,
) -> Result<Vec<String>, GitRevisionError> {
    let expected = [
        format!("refs/heads/{short_name}"),
        format!("refs/tags/{short_name}"),
        format!("refs/remotes/{short_name}"),
    ];
    let lines = parse_machine_lines(output)?;
    if lines.len() > expected.len() {
        return Err(GitRevisionError::InvalidOutput);
    }

    let mut seen = HashSet::new();
    let mut candidates = Vec::with_capacity(lines.len());
    for line in lines {
        let line = std::str::from_utf8(line).map_err(|_| GitRevisionError::InvalidOutput)?;
        if !expected.iter().any(|expected| line == expected) || !seen.insert(line) {
            return Err(GitRevisionError::InvalidOutput);
        }
        candidates.push(line.to_string());
    }
    Ok(candidates)
}

fn parse_object_candidates(
    output: &[u8],
    algorithm: GitObjectAlgorithm,
) -> Result<Vec<String>, GitRevisionError> {
    let lines = parse_machine_lines(output)?;
    let mut seen = HashSet::new();
    let mut candidates = Vec::with_capacity(lines.len().min(MAX_AMBIGUITY_CANDIDATES));
    for line in lines {
        let line = std::str::from_utf8(line).map_err(|_| GitRevisionError::InvalidOutput)?;
        let object_id =
            GitObjectId::try_new(algorithm, line).map_err(|_| GitRevisionError::InvalidOutput)?;
        if !seen.insert(object_id.hex.clone()) {
            return Err(GitRevisionError::InvalidOutput);
        }
        candidates.push(object_id.hex);
    }
    Ok(candidates)
}

fn bounded_candidates(mut candidates: Vec<String>) -> Vec<String> {
    candidates.truncate(MAX_AMBIGUITY_CANDIDATES);
    candidates
}

fn parse_verified_object_id(
    output: &[u8],
    algorithm: GitObjectAlgorithm,
) -> Result<GitObjectId, GitRevisionError> {
    let lines = parse_machine_lines(output)?;
    if lines.len() != 1 {
        return Err(GitRevisionError::InvalidOutput);
    }
    let line = std::str::from_utf8(lines[0]).map_err(|_| GitRevisionError::InvalidOutput)?;
    GitObjectId::try_new(algorithm, line).map_err(|_| GitRevisionError::InvalidOutput)
}

fn parse_machine_lines(output: &[u8]) -> Result<Vec<&[u8]>, GitRevisionError> {
    if output.is_empty() {
        return Ok(Vec::new());
    }
    if !output.ends_with(b"\n") {
        return Err(GitRevisionError::InvalidOutput);
    }
    let lines = output[..output.len() - 1].split(|byte| *byte == b'\n');
    let mut parsed = Vec::new();
    for line in lines {
        if line.is_empty()
            || line
                .iter()
                .any(|byte| byte.is_ascii_control() || *byte == 0x7f)
        {
            return Err(GitRevisionError::InvalidOutput);
        }
        parsed.push(line);
    }
    Ok(parsed)
}

#[cfg(test)]
mod tests {
    use super::{GitRevisionError, GitRevisionKind, resolve_revision, resolve_revision_with};
    use crate::domain::git::GitObjectAlgorithm;
    use crate::git::executable::ValidatedGitExecutable;
    use crate::git::repository::GitRepositorySession;
    use crate::git::runner::{RevisionQuery, RunnerError, RunnerOutput};
    use std::collections::VecDeque;
    use std::ffi::OsStr;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::process::{Command, Output, Stdio};
    use std::sync::MutexGuard;
    use tempfile::{TempDir, tempdir};

    const FIRST_ID: &str = "1111111111111111111111111111111111111111";
    const SECOND_ID: &str = "2222222222222222222222222222222222222222";

    struct FakeQueries {
        responses: VecDeque<(RevisionQuery, Result<RunnerOutput, RunnerError>)>,
    }

    impl FakeQueries {
        fn new(responses: Vec<(RevisionQuery, Result<RunnerOutput, RunnerError>)>) -> Self {
            Self {
                responses: responses.into(),
            }
        }

        fn run(&mut self, actual: RevisionQuery) -> Result<RunnerOutput, RunnerError> {
            let (expected, response) = self.responses.pop_front().expect("unexpected query");
            assert_eq!(actual, expected);
            response
        }

        fn assert_exhausted(&self) {
            assert!(self.responses.is_empty(), "unconsumed fake queries");
        }
    }

    fn success(stdout: impl Into<Vec<u8>>) -> Result<RunnerOutput, RunnerError> {
        Ok(RunnerOutput {
            success: true,
            exit_code: Some(0),
            stdout: stdout.into(),
            stderr: Vec::new(),
        })
    }

    fn rejected(stderr: impl Into<Vec<u8>>) -> Result<RunnerOutput, RunnerError> {
        Ok(RunnerOutput {
            success: false,
            exit_code: Some(128),
            stdout: Vec::new(),
            stderr: stderr.into(),
        })
    }

    #[test]
    fn resolves_unique_short_ref_and_freezes_the_full_commit_id() {
        let mut fake = FakeQueries::new(vec![
            (
                RevisionQuery::ShortRefCandidates {
                    short_name: "main".to_string(),
                },
                success(b"refs/heads/main\n".to_vec()),
            ),
            (
                RevisionQuery::VerifyCommit {
                    revision: "refs/heads/main".to_string(),
                },
                success(format!("{FIRST_ID}\n").into_bytes()),
            ),
        ]);

        let revision =
            resolve_revision_with("main", GitObjectAlgorithm::Sha1, |query| fake.run(query))
                .expect("unique branch resolves");

        assert_eq!(revision.raw_label, "main");
        assert_eq!(revision.display_name, "main");
        assert_eq!(revision.kind, GitRevisionKind::Branch);
        assert_eq!(revision.resolved.hex, FIRST_ID);
        fake.assert_exhausted();
    }

    #[test]
    fn rejects_short_ref_and_abbreviated_object_ambiguity_structurally() {
        let mut short_ref = FakeQueries::new(vec![(
            RevisionQuery::ShortRefCandidates {
                short_name: "release".to_string(),
            },
            success(b"refs/heads/release\nrefs/tags/release\n".to_vec()),
        )]);
        assert_eq!(
            resolve_revision_with("release", GitObjectAlgorithm::Sha1, |query| {
                short_ref.run(query)
            }),
            Err(GitRevisionError::Ambiguous {
                candidates: vec![
                    "refs/heads/release".to_string(),
                    "refs/tags/release".to_string(),
                ],
            })
        );
        short_ref.assert_exhausted();

        let mut object = FakeQueries::new(vec![(
            RevisionQuery::Disambiguate {
                prefix: "abcd".to_string(),
            },
            success(format!("{FIRST_ID}\n{SECOND_ID}\n").into_bytes()),
        )]);
        assert_eq!(
            resolve_revision_with("abcd", GitObjectAlgorithm::Sha1, |query| {
                object.run(query)
            }),
            Err(GitRevisionError::Ambiguous {
                candidates: vec![FIRST_ID.to_string(), SECOND_ID.to_string()],
            })
        );
        object.assert_exhausted();
    }

    #[test]
    fn resolves_unique_abbreviation_only_after_object_disambiguation() {
        let mut fake = FakeQueries::new(vec![
            (
                RevisionQuery::Disambiguate {
                    prefix: "1111111".to_string(),
                },
                success(format!("{FIRST_ID}\n").into_bytes()),
            ),
            (
                RevisionQuery::VerifyCommit {
                    revision: "1111111".to_string(),
                },
                success(format!("{FIRST_ID}\n").into_bytes()),
            ),
        ]);

        let revision =
            resolve_revision_with("1111111", GitObjectAlgorithm::Sha1, |query| fake.run(query))
                .expect("unique abbreviation resolves");

        assert_eq!(revision.kind, GitRevisionKind::Commit);
        assert_eq!(revision.resolved.hex, FIRST_ID);
        fake.assert_exhausted();
    }

    #[test]
    fn distinguishes_invalid_revision_from_missing_local_object_without_stderr_parsing() {
        let mut invalid = FakeQueries::new(vec![
            (
                RevisionQuery::ShortRefCandidates {
                    short_name: "blob-tag".to_string(),
                },
                success(b"refs/tags/blob-tag\n".to_vec()),
            ),
            (
                RevisionQuery::VerifyCommit {
                    revision: "refs/tags/blob-tag".to_string(),
                },
                rejected(b"localized backend detail A".to_vec()),
            ),
        ]);
        assert_eq!(
            resolve_revision_with("blob-tag", GitObjectAlgorithm::Sha1, |query| {
                invalid.run(query)
            }),
            Err(GitRevisionError::InvalidRevision)
        );
        invalid.assert_exhausted();

        let missing_id = "f".repeat(40);
        let mut missing = FakeQueries::new(vec![(
            RevisionQuery::Disambiguate {
                prefix: missing_id.clone(),
            },
            success(Vec::new()),
        )]);
        assert_eq!(
            resolve_revision_with(&missing_id, GitObjectAlgorithm::Sha1, |query| {
                missing.run(query)
            }),
            Err(GitRevisionError::ObjectMissingLocal)
        );
        missing.assert_exhausted();

        let oversized = "a".repeat(1025);
        for raw in ["", "-main", " main", "main\nnext", oversized.as_str()] {
            assert_eq!(
                resolve_revision_with(raw, GitObjectAlgorithm::Sha1, |_| {
                    panic!("invalid input must fail before Git")
                }),
                Err(GitRevisionError::InvalidRevision)
            );
        }
    }

    #[test]
    fn rejects_malformed_or_truncated_machine_output() {
        for output in [
            b"refs/heads/main".to_vec(),
            b"refs/heads/main\nextra\x01ref\n".to_vec(),
        ] {
            let mut fake = FakeQueries::new(vec![(
                RevisionQuery::ShortRefCandidates {
                    short_name: "main".to_string(),
                },
                success(output),
            )]);
            assert_eq!(
                resolve_revision_with("main", GitObjectAlgorithm::Sha1, |query| {
                    fake.run(query)
                }),
                Err(GitRevisionError::InvalidOutput)
            );
        }

        let mut bad_oid = FakeQueries::new(vec![(
            RevisionQuery::VerifyCommit {
                revision: "HEAD".to_string(),
            },
            success(b"short\n".to_vec()),
        )]);
        assert_eq!(
            resolve_revision_with("HEAD", GitObjectAlgorithm::Sha1, |query| {
                bad_oid.run(query)
            }),
            Err(GitRevisionError::InvalidOutput)
        );
    }

    #[test]
    fn temp_repository_resolves_supported_inputs_and_rejects_edge_cases_without_mutation() {
        let _fixture_guard = git_fixture_guard();
        let fixture = RevisionFixture::new();
        let before = fixture.fingerprint();
        let session = GitRepositorySession::open(
            "revision-session".to_string(),
            fixture.repository.clone(),
            fixture.runtime(),
        )
        .expect("fixture repository opens");

        let cases = [
            ("HEAD", fixture.second_id.as_str(), GitRevisionKind::Head),
            ("main", fixture.second_id.as_str(), GitRevisionKind::Branch),
            ("v1", fixture.first_id.as_str(), GitRevisionKind::Tag),
            (
                fixture.second_id.as_str(),
                fixture.second_id.as_str(),
                GitRevisionKind::Commit,
            ),
            (
                &fixture.second_id[..12],
                fixture.second_id.as_str(),
                GitRevisionKind::Commit,
            ),
            ("HEAD~1", fixture.first_id.as_str(), GitRevisionKind::Head),
        ];

        for (raw, expected_id, expected_kind) in cases {
            let revision = resolve_revision(&session, raw).expect("revision resolves");
            assert_eq!(revision.resolved.hex, expected_id);
            assert_eq!(revision.kind, expected_kind);
        }

        assert!(matches!(
            resolve_revision(&session, "collision"),
            Err(GitRevisionError::Ambiguous { candidates }) if candidates.len() == 2
        ));
        assert_eq!(
            resolve_revision(&session, "blob-tag"),
            Err(GitRevisionError::InvalidRevision)
        );
        assert_eq!(
            resolve_revision(&session, "does-not-exist"),
            Err(GitRevisionError::InvalidRevision)
        );
        assert_eq!(fixture.fingerprint(), before);

        let unborn = fixture.init_unborn("unborn");
        let unborn_session = GitRepositorySession::open(
            "unborn-revision-session".to_string(),
            unborn,
            fixture.runtime(),
        )
        .expect("unborn repository opens");
        assert_eq!(
            resolve_revision(&unborn_session, "HEAD"),
            Err(GitRevisionError::InvalidRevision)
        );
    }

    fn git_fixture_guard() -> MutexGuard<'static, ()> {
        crate::git::GIT_FIXTURE_LOCK
            .lock()
            .expect("Git fixture lock")
    }

    #[derive(Debug, PartialEq, Eq)]
    struct RevisionFingerprint {
        head: Vec<u8>,
        main: Vec<u8>,
        tag: Vec<u8>,
        index: Vec<u8>,
    }

    struct RevisionFixture {
        _temp: TempDir,
        repository: PathBuf,
        home: PathBuf,
        git: PathBuf,
        first_id: String,
        second_id: String,
    }

    impl RevisionFixture {
        fn new() -> Self {
            let temp = tempdir().expect("revision fixture root");
            let repository = temp.path().join("Revision Repository 한글");
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
                first_id: String::new(),
                second_id: String::new(),
            };
            fixture.run(["init", "-b", "main", "."]);
            fixture.first_id = fixture.commit("first\n");
            fixture.run(["tag", "v1", &fixture.first_id]);
            fixture.second_id = fixture.commit("second\n");
            fixture.run(["branch", "collision", &fixture.second_id]);
            fixture.run(["tag", "collision", &fixture.first_id]);
            let blob = String::from_utf8(
                fixture
                    .run_with_input(["hash-object", "-w", "--stdin"], b"blob\n")
                    .stdout,
            )
            .expect("blob ID")
            .trim()
            .to_string();
            fixture.run(["tag", "blob-tag", &blob]);
            fixture.run(["checkout", "--detach", &fixture.second_id]);
            fixture
        }

        fn commit(&self, content: &str) -> String {
            fs::write(self.repository.join("tracked.txt"), content).expect("tracked file");
            self.run(["add", "--", "tracked.txt"]);
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
            String::from_utf8(self.run(["rev-parse", "HEAD"]).stdout)
                .expect("commit ID")
                .trim()
                .to_string()
        }

        fn init_unborn(&self, name: &str) -> PathBuf {
            let repository = self.repository.parent().expect("fixture parent").join(name);
            fs::create_dir_all(&repository).expect("unborn directory");
            self.run_in(&repository, ["init", "-b", "main", "."]);
            repository
        }

        fn runtime(&self) -> ValidatedGitExecutable {
            ValidatedGitExecutable::discover(Some(self.git.clone())).expect("fixture Git runtime")
        }

        fn fingerprint(&self) -> RevisionFingerprint {
            let git_dir = self.repository.join(".git");
            RevisionFingerprint {
                head: fs::read(git_dir.join("HEAD")).expect("HEAD fingerprint"),
                main: fs::read(git_dir.join("refs/heads/main")).expect("main fingerprint"),
                tag: fs::read(git_dir.join("refs/tags/v1")).expect("tag fingerprint"),
                index: fs::read(git_dir.join("index")).expect("index fingerprint"),
            }
        }

        fn run<I, S>(&self, arguments: I) -> Output
        where
            I: IntoIterator<Item = S>,
            S: AsRef<OsStr>,
        {
            self.run_in(&self.repository, arguments)
        }

        fn run_with_input<I, S>(&self, arguments: I, input: &[u8]) -> Output
        where
            I: IntoIterator<Item = S>,
            S: AsRef<OsStr>,
        {
            let mut child = self.command(&self.repository, arguments);
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
            assert!(output.status.success(), "fixture Git input command failed");
            output
        }

        fn run_in<I, S>(&self, directory: &Path, arguments: I) -> Output
        where
            I: IntoIterator<Item = S>,
            S: AsRef<OsStr>,
        {
            let output = self
                .command(directory, arguments)
                .output()
                .expect("fixture Git command starts");
            assert!(
                output.status.success(),
                "fixture Git command failed: {}",
                String::from_utf8_lossy(&output.stderr)
            );
            output
        }

        fn command<I, S>(&self, directory: &Path, arguments: I) -> Command
        where
            I: IntoIterator<Item = S>,
            S: AsRef<OsStr>,
        {
            let mut command = Command::new(&self.git);
            command
                .current_dir(directory)
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
