use crate::domain::git::{
    GitObjectAlgorithm, GitObjectId, GitObjectType, GitRefKind, GitRefList, GitRepositoryRef,
};
use crate::git::repository::GitRepositorySession;
use crate::git::runner::{CancellationToken, GitOperation, RefNamespace, RunnerError};
use std::collections::HashSet;

pub const MAX_REF_LIST_LIMIT: usize = 10_000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GitRefError {
    Runner(RunnerError),
    InvalidKinds,
    InvalidLimit,
    CommandFailed,
    TruncatedOutput,
    InvalidFieldCount,
    InvalidRefName,
    InvalidObjectId,
    InvalidObjectType,
    InvalidPeel,
    DuplicateRef,
    TooManyRecords,
}

pub fn list_refs(
    session: &GitRepositorySession,
    kinds: &[GitRefKind],
    limit: usize,
    cancellation: &CancellationToken,
) -> Result<GitRefList, GitRefError> {
    let namespaces = ref_namespaces(kinds)?;
    if !(1..=MAX_REF_LIST_LIMIT).contains(&limit) {
        return Err(GitRefError::InvalidLimit);
    }
    let max_records = limit.checked_add(1).ok_or(GitRefError::InvalidLimit)?;
    let output = session
        .executable()
        .runner()
        .run(
            GitOperation::References {
                repository: session.identity().root.clone(),
                namespaces,
                max_records,
            },
            cancellation,
        )
        .map_err(GitRefError::Runner)?;
    if !output.success {
        return Err(GitRefError::CommandFailed);
    }
    parse_ref_records(&output.stdout, session.identity().object_format, limit)
}

fn ref_namespaces(kinds: &[GitRefKind]) -> Result<Vec<RefNamespace>, GitRefError> {
    if kinds.is_empty() {
        return Err(GitRefError::InvalidKinds);
    }
    let unique = kinds.iter().copied().collect::<HashSet<_>>();
    if unique.len() != kinds.len() {
        return Err(GitRefError::InvalidKinds);
    }
    let mut namespaces = Vec::with_capacity(kinds.len());
    for (kind, namespace) in [
        (GitRefKind::LocalBranch, RefNamespace::LocalBranches),
        (
            GitRefKind::RemoteTrackingBranch,
            RefNamespace::RemoteTrackingBranches,
        ),
        (GitRefKind::Tag, RefNamespace::Tags),
    ] {
        if unique.contains(&kind) {
            namespaces.push(namespace);
        }
    }
    Ok(namespaces)
}

fn parse_ref_records(
    output: &[u8],
    algorithm: GitObjectAlgorithm,
    limit: usize,
) -> Result<GitRefList, GitRefError> {
    if !(1..=MAX_REF_LIST_LIMIT).contains(&limit) {
        return Err(GitRefError::InvalidLimit);
    }
    if output.is_empty() {
        return Ok(GitRefList {
            refs: Vec::new(),
            truncated: false,
        });
    }
    if !output.ends_with(b"\n") {
        return Err(GitRefError::TruncatedOutput);
    }

    let records = output[..output.len() - 1]
        .split(|byte| *byte == b'\n')
        .collect::<Vec<_>>();
    if records.len() > limit + 1 {
        return Err(GitRefError::TooManyRecords);
    }

    let mut refs = Vec::with_capacity(records.len().min(limit));
    let mut seen = HashSet::with_capacity(records.len());
    for record in records.iter().take(limit) {
        let entry = parse_ref_record(record, algorithm)?;
        if !seen.insert(entry.full_name.clone()) {
            return Err(GitRefError::DuplicateRef);
        }
        refs.push(entry);
    }
    if records.len() > limit {
        parse_ref_record(records[limit], algorithm)?;
    }

    Ok(GitRefList {
        refs,
        truncated: records.len() > limit,
    })
}

fn parse_ref_record(
    record: &[u8],
    algorithm: GitObjectAlgorithm,
) -> Result<GitRepositoryRef, GitRefError> {
    if !record.ends_with(b"\0") {
        return Err(GitRefError::TruncatedOutput);
    }
    let fields = record[..record.len() - 1]
        .split(|byte| *byte == 0)
        .collect::<Vec<_>>();
    let [
        full_name,
        object_id,
        object_type,
        peeled_object_id,
        peeled_object_type,
    ] = fields.as_slice()
    else {
        return Err(GitRefError::InvalidFieldCount);
    };

    let full_name = parse_ref_name(full_name)?;
    let (kind, display_name) = classify_ref(&full_name)?;
    let object_id = parse_ref_object_id(object_id, algorithm)?;
    let object_type = parse_object_type(object_type)?;
    let (peeled_object_id, peeled_object_type) =
        parse_peel(peeled_object_id, peeled_object_type, algorithm, object_type)?;

    if matches!(
        kind,
        GitRefKind::LocalBranch | GitRefKind::RemoteTrackingBranch
    ) && (object_type != GitObjectType::Commit || peeled_object_id.is_some())
    {
        return Err(GitRefError::InvalidObjectType);
    }

    Ok(GitRepositoryRef {
        full_name,
        display_name,
        kind,
        object_id,
        object_type,
        peeled_object_id,
        peeled_object_type,
    })
}

fn parse_ref_name(value: &[u8]) -> Result<String, GitRefError> {
    let value = std::str::from_utf8(value).map_err(|_| GitRefError::InvalidRefName)?;
    if value.is_empty()
        || value
            .chars()
            .any(|character| character.is_control() || character == '\u{7f}')
    {
        return Err(GitRefError::InvalidRefName);
    }
    Ok(value.to_string())
}

fn classify_ref(full_name: &str) -> Result<(GitRefKind, String), GitRefError> {
    for (prefix, kind) in [
        ("refs/heads/", GitRefKind::LocalBranch),
        ("refs/remotes/", GitRefKind::RemoteTrackingBranch),
        ("refs/tags/", GitRefKind::Tag),
    ] {
        if let Some(display_name) = full_name.strip_prefix(prefix)
            && !display_name.is_empty()
        {
            return Ok((kind, display_name.to_string()));
        }
    }
    Err(GitRefError::InvalidRefName)
}

fn parse_ref_object_id(
    value: &[u8],
    algorithm: GitObjectAlgorithm,
) -> Result<GitObjectId, GitRefError> {
    let value = std::str::from_utf8(value).map_err(|_| GitRefError::InvalidObjectId)?;
    let object_id =
        GitObjectId::try_new(algorithm, value).map_err(|_| GitRefError::InvalidObjectId)?;
    if object_id.hex.bytes().all(|byte| byte == b'0') {
        return Err(GitRefError::InvalidObjectId);
    }
    Ok(object_id)
}

fn parse_object_type(value: &[u8]) -> Result<GitObjectType, GitRefError> {
    match value {
        b"commit" => Ok(GitObjectType::Commit),
        b"tag" => Ok(GitObjectType::Tag),
        b"tree" => Ok(GitObjectType::Tree),
        b"blob" => Ok(GitObjectType::Blob),
        _ => Err(GitRefError::InvalidObjectType),
    }
}

fn parse_peel(
    object_id: &[u8],
    object_type: &[u8],
    algorithm: GitObjectAlgorithm,
    direct_type: GitObjectType,
) -> Result<(Option<GitObjectId>, Option<GitObjectType>), GitRefError> {
    match (object_id.is_empty(), object_type.is_empty(), direct_type) {
        (true, true, GitObjectType::Tag) => Err(GitRefError::InvalidPeel),
        (true, true, _) => Ok((None, None)),
        (false, false, GitObjectType::Tag) => Ok((
            Some(parse_ref_object_id(object_id, algorithm)?),
            Some(parse_object_type(object_type)?),
        )),
        _ => Err(GitRefError::InvalidPeel),
    }
}

#[cfg(test)]
mod tests {
    use super::{GitRefError, list_refs, parse_ref_records};
    use crate::domain::git::{GitObjectAlgorithm, GitObjectType, GitRefKind, GitRepositoryRef};
    use crate::git::executable::ValidatedGitExecutable;
    use crate::git::repository::GitRepositorySession;
    use crate::git::runner::{CancellationToken, RunnerError};
    use std::ffi::OsStr;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::process::{Command, Output, Stdio};
    use std::sync::MutexGuard;
    use tempfile::{TempDir, tempdir};

    const COMMIT_ID: &str = "1111111111111111111111111111111111111111";
    const TAG_ID: &str = "2222222222222222222222222222222222222222";

    fn record(fields: &[&[u8]]) -> Vec<u8> {
        let mut output = Vec::new();
        for field in fields {
            output.extend_from_slice(field);
            output.push(0);
        }
        output.push(b'\n');
        output
    }

    fn direct_ref(full_name: &[u8], object_type: &[u8]) -> Vec<u8> {
        record(&[full_name, COMMIT_ID.as_bytes(), object_type, b"", b""])
    }

    #[test]
    fn parses_local_remote_and_lightweight_or_annotated_tag_metadata() {
        let mut output = direct_ref("refs/heads/기능".as_bytes(), b"commit");
        output.extend(direct_ref(b"refs/remotes/origin/main", b"commit"));
        output.extend(direct_ref(b"refs/tags/v1", b"commit"));
        output.extend(record(&[
            b"refs/tags/v2",
            TAG_ID.as_bytes(),
            b"tag",
            COMMIT_ID.as_bytes(),
            b"commit",
        ]));

        let parsed = parse_ref_records(&output, GitObjectAlgorithm::Sha1, 10)
            .expect("structured ref records");

        assert!(!parsed.truncated);
        assert_eq!(parsed.refs.len(), 4);
        assert_eq!(parsed.refs[0].full_name, "refs/heads/기능");
        assert_eq!(parsed.refs[0].display_name, "기능");
        assert_eq!(parsed.refs[0].kind, GitRefKind::LocalBranch);
        assert_eq!(parsed.refs[1].kind, GitRefKind::RemoteTrackingBranch);
        assert_eq!(parsed.refs[1].display_name, "origin/main");
        assert_eq!(parsed.refs[2].kind, GitRefKind::Tag);
        assert_eq!(parsed.refs[2].object_type, GitObjectType::Commit);
        assert_eq!(parsed.refs[2].peeled_object_id, None);
        assert_eq!(parsed.refs[3].object_type, GitObjectType::Tag);
        assert_eq!(
            parsed.refs[3]
                .peeled_object_id
                .as_ref()
                .map(|object_id| object_id.hex.as_str()),
            Some(COMMIT_ID)
        );
        assert_eq!(
            parsed.refs[3].peeled_object_type,
            Some(GitObjectType::Commit)
        );
    }

    #[test]
    fn reports_limit_plus_one_as_truncated_without_accepting_more_records() {
        let mut output = direct_ref(b"refs/heads/a", b"commit");
        output.extend(direct_ref(b"refs/heads/b", b"commit"));
        output.extend(direct_ref(b"refs/heads/c", b"commit"));

        let parsed = parse_ref_records(&output, GitObjectAlgorithm::Sha1, 2)
            .expect("limit plus one is a bounded response");
        assert!(parsed.truncated);
        assert_eq!(
            parsed
                .refs
                .iter()
                .map(|entry| entry.display_name.as_str())
                .collect::<Vec<_>>(),
            vec!["a", "b"]
        );

        output.extend(direct_ref(b"refs/heads/d", b"commit"));
        assert_eq!(
            parse_ref_records(&output, GitObjectAlgorithm::Sha1, 2),
            Err(GitRefError::TooManyRecords)
        );
    }

    #[test]
    fn rejects_truncated_control_duplicate_broken_and_inconsistent_records() {
        let valid = direct_ref(b"refs/heads/main", b"commit");
        let mut duplicate = valid.clone();
        duplicate.extend(valid.clone());
        let cases = [
            (
                valid[..valid.len() - 1].to_vec(),
                GitRefError::TruncatedOutput,
            ),
            (
                direct_ref(b"refs/heads/bad\x01name", b"commit"),
                GitRefError::InvalidRefName,
            ),
            (duplicate, GitRefError::DuplicateRef),
            (
                record(&[
                    b"refs/heads/broken",
                    b"0000000000000000000000000000000000000000",
                    b"commit",
                    b"",
                    b"",
                ]),
                GitRefError::InvalidObjectId,
            ),
            (
                record(&[b"refs/heads/blob", COMMIT_ID.as_bytes(), b"blob", b"", b""]),
                GitRefError::InvalidObjectType,
            ),
            (
                record(&[
                    b"refs/tags/half-peeled",
                    TAG_ID.as_bytes(),
                    b"tag",
                    COMMIT_ID.as_bytes(),
                    b"",
                ]),
                GitRefError::InvalidPeel,
            ),
            (
                record(&[
                    b"refs/other/name",
                    COMMIT_ID.as_bytes(),
                    b"commit",
                    b"",
                    b"",
                ]),
                GitRefError::InvalidRefName,
            ),
        ];

        for (output, expected) in cases {
            assert_eq!(
                parse_ref_records(&output, GitObjectAlgorithm::Sha1, 10),
                Err(expected)
            );
        }

        assert_eq!(
            parse_ref_records(
                &record(&[b"refs/heads/main", COMMIT_ID.as_bytes(), b"commit", b"",]),
                GitObjectAlgorithm::Sha1,
                10,
            ),
            Err(GitRefError::InvalidFieldCount)
        );
    }

    #[test]
    fn validates_kind_and_limit_before_starting_git() {
        let _fixture_guard = git_fixture_guard();
        let fixture = RefFixture::new();
        let session = fixture.session("validation-session");
        assert_eq!(
            list_refs(&session, &[], 10, &CancellationToken::new()),
            Err(GitRefError::InvalidKinds)
        );
        assert_eq!(
            list_refs(
                &session,
                &[GitRefKind::LocalBranch],
                0,
                &CancellationToken::new(),
            ),
            Err(GitRefError::InvalidLimit)
        );
        assert_eq!(
            list_refs(
                &session,
                &[GitRefKind::LocalBranch],
                10_001,
                &CancellationToken::new(),
            ),
            Err(GitRefError::InvalidLimit)
        );
    }

    #[test]
    fn cancelled_list_returns_typed_runner_cancellation() {
        let _fixture_guard = git_fixture_guard();
        let fixture = RefFixture::new();
        let session = fixture.session("cancel-session");
        let cancellation = CancellationToken::new();
        cancellation.cancel();

        assert_eq!(
            list_refs(&session, &[GitRefKind::LocalBranch], 10, &cancellation,),
            Err(GitRefError::Runner(RunnerError::Cancelled))
        );
    }

    #[test]
    fn temp_repository_lists_exact_local_metadata_without_mutation_or_network() {
        let _fixture_guard = git_fixture_guard();
        let fixture = RefFixture::new();
        fixture.populate();
        let before = fixture.fingerprint();
        let session = fixture.session("ref-session");

        let result = list_refs(
            &session,
            &[
                GitRefKind::LocalBranch,
                GitRefKind::RemoteTrackingBranch,
                GitRefKind::Tag,
            ],
            20,
            &CancellationToken::new(),
        )
        .expect("local refs");

        assert!(!result.truncated);
        assert!(contains_ref(&result.refs, GitRefKind::LocalBranch, "main"));
        assert!(contains_ref(
            &result.refs,
            GitRefKind::LocalBranch,
            "feature/한글"
        ));
        assert!(contains_ref(
            &result.refs,
            GitRefKind::RemoteTrackingBranch,
            "origin/main"
        ));
        assert!(contains_ref(&result.refs, GitRefKind::Tag, "v1"));
        let annotated = result
            .refs
            .iter()
            .find(|entry| entry.display_name == "annotated")
            .expect("annotated tag");
        assert_eq!(annotated.object_type, GitObjectType::Tag);
        assert_eq!(annotated.peeled_object_type, Some(GitObjectType::Commit));
        assert_eq!(fixture.fingerprint(), before);

        let limited = list_refs(
            &session,
            &[GitRefKind::LocalBranch, GitRefKind::Tag],
            2,
            &CancellationToken::new(),
        )
        .expect("bounded local refs");
        assert!(limited.truncated);
        assert_eq!(limited.refs.len(), 2);
    }

    fn contains_ref(refs: &[GitRepositoryRef], kind: GitRefKind, display_name: &str) -> bool {
        refs.iter()
            .any(|entry| entry.kind == kind && entry.display_name == display_name)
    }

    fn git_fixture_guard() -> MutexGuard<'static, ()> {
        crate::git::GIT_FIXTURE_LOCK
            .lock()
            .expect("Git fixture lock")
    }

    #[derive(Debug, PartialEq, Eq)]
    struct RefFingerprint {
        head: Vec<u8>,
        main: Vec<u8>,
        index: Vec<u8>,
        config: Vec<u8>,
    }

    struct RefFixture {
        _temp: TempDir,
        repository: PathBuf,
        home: PathBuf,
        git: PathBuf,
    }

    impl RefFixture {
        fn new() -> Self {
            let temp = tempdir().expect("ref fixture root");
            let repository = temp.path().join("Ref Repository 한글");
            let home = temp.path().join("isolated-home");
            fs::create_dir_all(&repository).expect("repository directory");
            fs::create_dir_all(&home).expect("fixture home");
            fs::write(home.join(".gitconfig"), b"").expect("empty fixture config");
            let executable = ValidatedGitExecutable::discover(None).expect("supported Git");
            let git = executable.path().to_path_buf();
            let fixture = Self {
                _temp: temp,
                repository,
                home,
                git,
            };
            fixture.run(["init", "-b", "main", "."]);
            fs::write(fixture.repository.join("tracked.txt"), b"tracked\n")
                .expect("tracked fixture");
            fixture.run(["add", "--", "tracked.txt"]);
            fixture.run([
                "-c",
                "user.name=Forktail Fixture",
                "-c",
                "user.email=fixture@example.invalid",
                "commit",
                "--no-gpg-sign",
                "-m",
                "fixture commit",
            ]);
            fixture
        }

        fn populate(&self) {
            self.run(["branch", "feature/한글", "HEAD"]);
            self.run(["update-ref", "refs/remotes/origin/main", "HEAD"]);
            self.run(["tag", "v1", "HEAD"]);
            self.run([
                "-c",
                "user.name=Forktail Fixture",
                "-c",
                "user.email=fixture@example.invalid",
                "tag",
                "-a",
                "annotated",
                "-m",
                "annotated fixture",
                "HEAD",
            ]);
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

        fn fingerprint(&self) -> RefFingerprint {
            let git_dir = self.repository.join(".git");
            RefFingerprint {
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
            self.run_in(&self.repository, arguments)
        }

        fn run_in<I, S>(&self, directory: &Path, arguments: I) -> Output
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
