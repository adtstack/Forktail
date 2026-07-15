use crate::domain::git::{
    GitHeadState, GitObjectAlgorithm, GitObjectId, GitPathRegistry, GitRepositoryIdentity,
    GitRepositorySummary,
};
use crate::git::executable::{GitExecutableError, ValidatedGitExecutable};
use crate::git::runner::{
    CancellationToken, GitOperation, RepositoryQuery, RunnerError, RunnerOutput,
};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GitRepositoryError {
    Executable(GitExecutableError),
    Runner(RunnerError),
    PathUnsupported,
    NotRepository,
    UnsafeRepository,
    BareUnsupported,
    InvalidOutput,
    InvalidHead,
    SessionStateUnavailable,
}

#[derive(Debug)]
pub struct GitRepositorySession {
    summary: GitRepositorySummary,
    identity: GitRepositoryIdentity,
    executable: ValidatedGitExecutable,
    paths: Mutex<GitPathRegistry>,
}

impl GitRepositorySession {
    pub fn open(
        session_id: String,
        candidate: PathBuf,
        executable: ValidatedGitExecutable,
    ) -> Result<Self, GitRepositoryError> {
        let candidate = validate_candidate(&candidate)?;
        let bare = required_boolean_query(&executable, &candidate, RepositoryQuery::Bare)?;
        if bare {
            return Err(GitRepositoryError::BareUnsupported);
        }

        let root = required_path_query(&executable, &candidate, RepositoryQuery::Root)?;
        let git_dir = required_path_query(&executable, &candidate, RepositoryQuery::GitDir)?;
        let common_dir = required_path_query(&executable, &candidate, RepositoryQuery::CommonDir)?;
        let metadata = required_query(&executable, &candidate, RepositoryQuery::Metadata)?;
        let (is_shallow, object_format) = parse_repository_metadata(&metadata.stdout)?;
        let head = read_head(&executable, &root, object_format)?;
        let is_linked_worktree = git_dir != common_dir;
        let paths = GitPathRegistry::new(session_id.clone());
        let summary = GitRepositorySummary {
            session_id,
            display_root: safe_display_path(&root),
            is_bare: false,
            is_linked_worktree,
            is_shallow,
            object_format,
            head,
        };
        let identity = GitRepositoryIdentity {
            root,
            git_dir,
            common_dir,
            object_format,
        };

        Ok(Self {
            summary,
            identity,
            executable,
            paths: Mutex::new(paths),
        })
    }

    pub fn summary(&self) -> &GitRepositorySummary {
        &self.summary
    }

    pub fn identity(&self) -> &GitRepositoryIdentity {
        &self.identity
    }

    pub fn executable(&self) -> &ValidatedGitExecutable {
        &self.executable
    }

    pub fn paths(&self) -> &Mutex<GitPathRegistry> {
        &self.paths
    }
}

#[derive(Debug, Default)]
pub struct GitRepositorySessions {
    next_id: AtomicU64,
    active: Mutex<Option<Arc<GitRepositorySession>>>,
}

impl GitRepositorySessions {
    pub fn open(
        &self,
        candidate: PathBuf,
        configured_executable: Option<PathBuf>,
    ) -> Result<GitRepositorySummary, GitRepositoryError> {
        let executable = ValidatedGitExecutable::discover(configured_executable)
            .map_err(GitRepositoryError::Executable)?;
        let sequence = self.next_id.fetch_add(1, Ordering::Relaxed).wrapping_add(1);
        let session = Arc::new(GitRepositorySession::open(
            format!("repository-session-{sequence}"),
            candidate,
            executable,
        )?);
        let summary = session.summary().clone();
        let mut active = self
            .active
            .lock()
            .map_err(|_| GitRepositoryError::SessionStateUnavailable)?;
        *active = Some(session);
        Ok(summary)
    }

    pub fn get(
        &self,
        session_id: &str,
    ) -> Result<Option<Arc<GitRepositorySession>>, GitRepositoryError> {
        let active = self
            .active
            .lock()
            .map_err(|_| GitRepositoryError::SessionStateUnavailable)?;
        Ok(active
            .as_ref()
            .filter(|session| session.summary().session_id == session_id)
            .cloned())
    }

    pub fn close(&self, session_id: &str) -> Result<(), GitRepositoryError> {
        let mut active = self
            .active
            .lock()
            .map_err(|_| GitRepositoryError::SessionStateUnavailable)?;
        if active
            .as_ref()
            .is_some_and(|session| session.summary().session_id == session_id)
        {
            *active = None;
        }
        Ok(())
    }
}

fn validate_candidate(candidate: &Path) -> Result<PathBuf, GitRepositoryError> {
    if !candidate.is_absolute() {
        return Err(GitRepositoryError::PathUnsupported);
    }
    let metadata =
        fs::symlink_metadata(candidate).map_err(|_| GitRepositoryError::PathUnsupported)?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(GitRepositoryError::PathUnsupported);
    }
    fs::canonicalize(candidate).map_err(|_| GitRepositoryError::PathUnsupported)
}

fn required_boolean_query(
    executable: &ValidatedGitExecutable,
    candidate: &Path,
    query: RepositoryQuery,
) -> Result<bool, GitRepositoryError> {
    let output = required_query(executable, candidate, query)?;
    parse_boolean_output(&output.stdout)
}

fn required_path_query(
    executable: &ValidatedGitExecutable,
    candidate: &Path,
    query: RepositoryQuery,
) -> Result<PathBuf, GitRepositoryError> {
    let output = required_query(executable, candidate, query)?;
    let path = path_from_single_output(&output.stdout)?;
    let canonical = fs::canonicalize(path).map_err(|_| GitRepositoryError::InvalidOutput)?;
    if !fs::metadata(&canonical)
        .map_err(|_| GitRepositoryError::InvalidOutput)?
        .is_dir()
    {
        return Err(GitRepositoryError::InvalidOutput);
    }
    Ok(canonical)
}

fn required_query(
    executable: &ValidatedGitExecutable,
    candidate: &Path,
    query: RepositoryQuery,
) -> Result<RunnerOutput, GitRepositoryError> {
    let output = executable
        .runner()
        .run(
            GitOperation::Repository {
                candidate: candidate.to_path_buf(),
                query,
            },
            &CancellationToken::new(),
        )
        .map_err(GitRepositoryError::Runner)?;
    if output.success {
        Ok(output)
    } else {
        Err(classify_repository_probe_failure(&output.stderr))
    }
}

fn raw_query(
    executable: &ValidatedGitExecutable,
    candidate: &Path,
    query: RepositoryQuery,
) -> Result<RunnerOutput, GitRepositoryError> {
    executable
        .runner()
        .run(
            GitOperation::Repository {
                candidate: candidate.to_path_buf(),
                query,
            },
            &CancellationToken::new(),
        )
        .map_err(GitRepositoryError::Runner)
}

fn read_head(
    executable: &ValidatedGitExecutable,
    root: &Path,
    algorithm: GitObjectAlgorithm,
) -> Result<GitHeadState, GitRepositoryError> {
    let commit_output = raw_query(executable, root, RepositoryQuery::HeadCommit)?;
    let symbolic_output = raw_query(executable, root, RepositoryQuery::SymbolicHead)?;
    if contains_safe_directory_token(&commit_output.stderr)
        || contains_safe_directory_token(&symbolic_output.stderr)
    {
        return Err(GitRepositoryError::UnsafeRepository);
    }

    let commit = if commit_output.success {
        let hex = parse_ascii_single_output(&commit_output.stdout)?;
        Some(GitObjectId::try_new(algorithm, hex).map_err(|_| GitRepositoryError::InvalidOutput)?)
    } else {
        None
    };
    let symbolic = if symbolic_output.success {
        Some(parse_ref_name(&symbolic_output.stdout)?)
    } else {
        None
    };

    match (commit, symbolic) {
        (None, Some(_)) => Ok(GitHeadState::Unborn),
        (Some(object_id), None) => Ok(GitHeadState::Detached { object_id }),
        (Some(object_id), Some((full_name, display_name))) => Ok(GitHeadState::Branch {
            full_name,
            display_name,
            object_id,
        }),
        (None, None) => Err(GitRepositoryError::InvalidHead),
    }
}

fn parse_boolean_output(output: &[u8]) -> Result<bool, GitRepositoryError> {
    match parse_ascii_single_output(output)?.as_str() {
        "true" => Ok(true),
        "false" => Ok(false),
        _ => Err(GitRepositoryError::InvalidOutput),
    }
}

fn parse_repository_metadata(
    output: &[u8],
) -> Result<(bool, GitObjectAlgorithm), GitRepositoryError> {
    let lines = ascii_lines(output)?;
    if lines.len() != 2 {
        return Err(GitRepositoryError::InvalidOutput);
    }
    let shallow = match lines[0] {
        b"true" => true,
        b"false" => false,
        _ => return Err(GitRepositoryError::InvalidOutput),
    };
    let algorithm = match lines[1] {
        b"sha1" => GitObjectAlgorithm::Sha1,
        b"sha256" => GitObjectAlgorithm::Sha256,
        value if !value.is_empty() && value.iter().all(u8::is_ascii_graphic) => {
            GitObjectAlgorithm::Unknown
        }
        _ => return Err(GitRepositoryError::InvalidOutput),
    };
    Ok((shallow, algorithm))
}

fn parse_ascii_single_output(output: &[u8]) -> Result<String, GitRepositoryError> {
    let lines = ascii_lines(output)?;
    if lines.len() != 1 || lines[0].is_empty() || !lines[0].is_ascii() {
        return Err(GitRepositoryError::InvalidOutput);
    }
    String::from_utf8(lines[0].to_vec()).map_err(|_| GitRepositoryError::InvalidOutput)
}

fn ascii_lines(output: &[u8]) -> Result<Vec<&[u8]>, GitRepositoryError> {
    if !output.ends_with(b"\n") {
        return Err(GitRepositoryError::InvalidOutput);
    }
    let mut lines = output[..output.len() - 1]
        .split(|byte| *byte == b'\n')
        .collect::<Vec<_>>();
    for line in &mut lines {
        if let Some(without_cr) = line.strip_suffix(b"\r") {
            *line = without_cr;
        }
        if line.contains(&b'\r') {
            return Err(GitRepositoryError::InvalidOutput);
        }
    }
    Ok(lines)
}

fn parse_ref_name(output: &[u8]) -> Result<(String, String), GitRepositoryError> {
    let bytes = strip_single_path_terminator(output)?;
    if bytes.is_empty() {
        return Err(GitRepositoryError::InvalidOutput);
    }
    let display_bytes = bytes.strip_prefix(b"refs/heads/").unwrap_or(bytes);
    Ok((safe_display_bytes(bytes), safe_display_bytes(display_bytes)))
}

fn path_from_single_output(output: &[u8]) -> Result<PathBuf, GitRepositoryError> {
    let bytes = strip_single_path_terminator(output)?;
    if bytes.is_empty() {
        return Err(GitRepositoryError::InvalidOutput);
    }

    #[cfg(unix)]
    {
        use std::ffi::OsString;
        use std::os::unix::ffi::OsStringExt;
        Ok(PathBuf::from(OsString::from_vec(bytes.to_vec())))
    }
    #[cfg(not(unix))]
    {
        String::from_utf8(bytes.to_vec())
            .map(PathBuf::from)
            .map_err(|_| GitRepositoryError::PathUnsupported)
    }
}

fn strip_single_path_terminator(output: &[u8]) -> Result<&[u8], GitRepositoryError> {
    let value = output
        .strip_suffix(b"\n")
        .ok_or(GitRepositoryError::InvalidOutput)?;
    #[cfg(windows)]
    let value = value.strip_suffix(b"\r").unwrap_or(value);
    Ok(value)
}

fn safe_display_path(path: &Path) -> String {
    safe_display_text(path.to_string_lossy().as_ref())
}

fn safe_display_bytes(bytes: &[u8]) -> String {
    safe_display_text(String::from_utf8_lossy(bytes).as_ref())
}

fn safe_display_text(value: &str) -> String {
    let mut display = String::with_capacity(value.len());
    for character in value.chars() {
        if character.is_control() {
            display.push_str(&format!("\\u{{{:x}}}", character as u32));
        } else {
            display.push(character);
        }
    }
    display
}

fn classify_repository_probe_failure(stderr: &[u8]) -> GitRepositoryError {
    if contains_safe_directory_token(stderr) {
        GitRepositoryError::UnsafeRepository
    } else {
        GitRepositoryError::NotRepository
    }
}

fn contains_safe_directory_token(value: &[u8]) -> bool {
    const TOKEN: &[u8] = b"safe.directory";
    value.windows(TOKEN.len()).any(|window| window == TOKEN)
}

#[cfg(test)]
mod tests {
    use super::{
        GitRepositoryError, GitRepositorySession, GitRepositorySessions,
        classify_repository_probe_failure, parse_repository_metadata,
    };
    use crate::domain::git::{GitHeadState, GitObjectAlgorithm};
    use crate::git::executable::ValidatedGitExecutable;
    use std::ffi::{OsStr, OsString};
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::process::{Command, Output, Stdio};
    use std::sync::{Mutex, MutexGuard};
    use std::time::SystemTime;
    use tempfile::{TempDir, tempdir};

    static REPOSITORY_FIXTURE_LOCK: Mutex<()> = Mutex::new(());

    fn repository_fixture_guard() -> MutexGuard<'static, ()> {
        REPOSITORY_FIXTURE_LOCK
            .lock()
            .expect("repository fixture lock")
    }

    struct RepositoryFixture {
        _temp: TempDir,
        root: PathBuf,
        home: PathBuf,
        git: PathBuf,
    }

    impl RepositoryFixture {
        fn new() -> Self {
            let temp = tempdir().expect("repository fixture root");
            let root = temp.path().join("Repository With Spaces 한글");
            let home = temp.path().join("isolated-home");
            fs::create_dir_all(&root).expect("fixture repository parent");
            fs::create_dir_all(&home).expect("fixture home");
            fs::write(home.join(".gitconfig"), b"").expect("empty fixture Git config");
            let executable = ValidatedGitExecutable::discover(None).expect("supported test Git");
            let git = executable.path().to_path_buf();
            Self {
                _temp: temp,
                root,
                home,
                git,
            }
        }

        fn init_worktree(&self, name: &str, object_format: Option<&str>) -> PathBuf {
            let repository = self.root.join(name);
            fs::create_dir_all(&repository).expect("worktree directory");
            let mut arguments = vec![OsString::from("init")];
            if let Some(object_format) = object_format {
                arguments.push(OsString::from(format!("--object-format={object_format}")));
            }
            arguments.extend([
                OsString::from("-b"),
                OsString::from("main"),
                OsString::from("."),
            ]);
            self.run(&repository, arguments);
            repository
        }

        fn init_bare(&self, name: &str) -> PathBuf {
            let repository = self.root.join(name);
            fs::create_dir_all(&repository).expect("bare directory");
            self.run(&repository, ["init", "--bare", "."]);
            repository
        }

        fn commit_file(&self, repository: &Path, relative_path: &str, content: &[u8]) -> String {
            let path = repository.join(relative_path);
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).expect("fixture file parent");
            }
            fs::write(&path, content).expect("fixture file");
            self.run(repository, ["add", "--", relative_path]);
            self.run(
                repository,
                [
                    "-c",
                    "user.name=Forktail Fixture",
                    "-c",
                    "user.email=fixture@example.invalid",
                    "commit",
                    "--no-gpg-sign",
                    "-m",
                    "fixture commit",
                ],
            );
            String::from_utf8(self.run(repository, ["rev-parse", "HEAD"]).stdout)
                .expect("ASCII object ID")
                .trim()
                .to_string()
        }

        fn add_detached_worktree(&self, repository: &Path, name: &str) -> PathBuf {
            let linked = self.root.join(name);
            let arguments = vec![
                OsString::from("worktree"),
                OsString::from("add"),
                OsString::from("--detach"),
                linked.as_os_str().to_owned(),
                OsString::from("HEAD"),
            ];
            self.run(repository, arguments);
            linked
        }

        fn runtime(&self) -> ValidatedGitExecutable {
            ValidatedGitExecutable::discover(Some(self.git.clone())).expect("fixture Git runtime")
        }

        fn run<I, S>(&self, current_dir: &Path, arguments: I) -> Output
        where
            I: IntoIterator<Item = S>,
            S: AsRef<OsStr>,
        {
            let mut command = Command::new(&self.git);
            command
                .current_dir(current_dir)
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
            let output = command.output().expect("fixture Git command starts");
            assert!(
                output.status.success(),
                "fixture Git command failed: {}",
                String::from_utf8_lossy(&output.stderr)
            );
            output
        }
    }

    #[derive(Debug, PartialEq, Eq)]
    struct RepositoryFingerprint {
        head: Vec<u8>,
        head_modified: SystemTime,
        config: Vec<u8>,
        config_modified: SystemTime,
        index: Vec<u8>,
        index_modified: SystemTime,
        branch_ref: Vec<u8>,
        branch_ref_modified: SystemTime,
    }

    fn fingerprint(repository: &Path) -> RepositoryFingerprint {
        let git_dir = repository.join(".git");
        let read = |relative: &str| fs::read(git_dir.join(relative)).expect("fingerprint bytes");
        let modified = |relative: &str| {
            fs::metadata(git_dir.join(relative))
                .expect("fingerprint metadata")
                .modified()
                .expect("fingerprint mtime")
        };
        RepositoryFingerprint {
            head: read("HEAD"),
            head_modified: modified("HEAD"),
            config: read("config"),
            config_modified: modified("config"),
            index: read("index"),
            index_modified: modified("index"),
            branch_ref: read("refs/heads/main"),
            branch_ref_modified: modified("refs/heads/main"),
        }
    }

    #[test]
    fn opens_root_and_nested_folder_without_mutating_repository_state() {
        let _fixture_guard = repository_fixture_guard();
        let fixture = RepositoryFixture::new();
        let repository = fixture.init_worktree("main-repository", None);
        let head = fixture.commit_file(&repository, "src/nested/file.txt", b"fixture text\n");
        let nested = repository.join("src/nested");
        let before = fingerprint(&repository);

        let session = GitRepositorySession::open(
            "repository-session-test".to_string(),
            nested,
            fixture.runtime(),
        )
        .expect("nested repository opens");

        assert_eq!(
            session.identity().root,
            fs::canonicalize(&repository).expect("canonical repository")
        );
        assert_eq!(
            session.identity().git_dir,
            fs::canonicalize(repository.join(".git")).expect("canonical Git directory")
        );
        assert_eq!(session.identity().git_dir, session.identity().common_dir);
        assert_eq!(session.summary().session_id, "repository-session-test");
        assert!(!session.summary().is_bare);
        assert!(!session.summary().is_linked_worktree);
        assert!(!session.summary().is_shallow);
        assert_eq!(session.summary().object_format, GitObjectAlgorithm::Sha1);
        match &session.summary().head {
            GitHeadState::Branch {
                full_name,
                display_name,
                object_id,
            } => {
                assert_eq!(full_name, "refs/heads/main");
                assert_eq!(display_name, "main");
                assert_eq!(object_id.hex, head);
            }
            other => panic!("expected branch HEAD, got {other:?}"),
        }
        assert_eq!(fingerprint(&repository), before);
    }

    #[test]
    fn opens_linked_worktree_with_distinct_git_dir_and_detached_head() {
        let _fixture_guard = repository_fixture_guard();
        let fixture = RepositoryFixture::new();
        let repository = fixture.init_worktree("linked-source", None);
        let head = fixture.commit_file(&repository, "tracked.txt", b"one\n");
        let linked = fixture.add_detached_worktree(&repository, "linked checkout");

        let session = GitRepositorySession::open(
            "linked-session".to_string(),
            linked.clone(),
            fixture.runtime(),
        )
        .expect("linked worktree opens");

        assert_eq!(
            session.identity().root,
            fs::canonicalize(linked).expect("canonical linked worktree")
        );
        assert_ne!(session.identity().git_dir, session.identity().common_dir);
        assert!(session.summary().is_linked_worktree);
        match &session.summary().head {
            GitHeadState::Detached { object_id } => assert_eq!(object_id.hex, head),
            other => panic!("expected detached HEAD, got {other:?}"),
        }
    }

    #[test]
    fn returns_unborn_and_sha256_head_states_without_fixed_sha1_assumptions() {
        let _fixture_guard = repository_fixture_guard();
        let fixture = RepositoryFixture::new();
        let unborn = fixture.init_worktree("unborn", None);
        let unborn_session =
            GitRepositorySession::open("unborn-session".to_string(), unborn, fixture.runtime())
                .expect("unborn repository opens");
        assert_eq!(unborn_session.summary().head, GitHeadState::Unborn);

        let sha256 = fixture.init_worktree("sha256", Some("sha256"));
        let head = fixture.commit_file(&sha256, "tracked.txt", b"sha256 fixture\n");
        let sha256_session =
            GitRepositorySession::open("sha256-session".to_string(), sha256, fixture.runtime())
                .expect("SHA-256 repository opens");
        assert_eq!(
            sha256_session.summary().object_format,
            GitObjectAlgorithm::Sha256
        );
        match &sha256_session.summary().head {
            GitHeadState::Branch { object_id, .. } => {
                assert_eq!(object_id.algorithm, GitObjectAlgorithm::Sha256);
                assert_eq!(object_id.hex, head);
                assert_eq!(object_id.hex.len(), 64);
            }
            other => panic!("expected SHA-256 branch HEAD, got {other:?}"),
        }
    }

    #[test]
    fn rejects_non_repository_bare_deleted_and_symlink_candidates() {
        let _fixture_guard = repository_fixture_guard();
        let fixture = RepositoryFixture::new();
        let non_repository = fixture.root.join("not-a-repository");
        fs::create_dir_all(&non_repository).expect("non-repository directory");
        assert!(matches!(
            GitRepositorySession::open("non-repo".to_string(), non_repository, fixture.runtime(),),
            Err(GitRepositoryError::NotRepository)
        ));

        let bare = fixture.init_bare("bare.git");
        assert!(matches!(
            GitRepositorySession::open("bare".to_string(), bare, fixture.runtime()),
            Err(GitRepositoryError::BareUnsupported)
        ));

        let deleted = fixture.root.join("deleted-candidate");
        fs::create_dir_all(&deleted).expect("deleted candidate directory");
        fs::remove_dir(&deleted).expect("delete candidate before open");
        assert!(matches!(
            GitRepositorySession::open("deleted".to_string(), deleted, fixture.runtime()),
            Err(GitRepositoryError::PathUnsupported)
        ));

        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;
            let repository = fixture.init_worktree("symlink-target", None);
            let picker_link = fixture.root.join("picker-link");
            symlink(repository, &picker_link).expect("symlink picker fixture");
            assert!(matches!(
                GitRepositorySession::open("symlink".to_string(), picker_link, fixture.runtime(),),
                Err(GitRepositoryError::PathUnsupported)
            ));
        }
    }

    #[test]
    fn classifies_dubious_ownership_without_exposing_or_using_stderr_as_copy() {
        assert_eq!(
            classify_repository_probe_failure(
                b"fatal: detected dubious ownership; git config --global --add safe.directory /private/path"
            ),
            GitRepositoryError::UnsafeRepository
        );
        assert_eq!(
            classify_repository_probe_failure(b"fatal: not a git repository"),
            GitRepositoryError::NotRepository
        );
    }

    #[test]
    fn parses_shallow_and_object_format_metadata_as_typed_state() {
        assert_eq!(
            parse_repository_metadata(b"true\nsha256\n"),
            Ok((true, GitObjectAlgorithm::Sha256))
        );
        assert_eq!(
            parse_repository_metadata(b"false\nfutureHash\n"),
            Ok((false, GitObjectAlgorithm::Unknown))
        );
        assert_eq!(
            parse_repository_metadata(b"true\nsha1\nextra\n"),
            Err(GitRepositoryError::InvalidOutput)
        );
    }

    #[test]
    fn replacing_or_closing_the_active_session_invalidates_old_handles() {
        let _fixture_guard = repository_fixture_guard();
        let fixture = RepositoryFixture::new();
        let repository = fixture.init_worktree("session-lifecycle", None);
        fixture.commit_file(&repository, "tracked.txt", b"session\n");
        let sessions = GitRepositorySessions::default();

        let first = sessions
            .open(repository.clone(), Some(fixture.git.clone()))
            .expect("first session");
        assert!(
            sessions
                .get(&first.session_id)
                .expect("first session lookup")
                .is_some()
        );

        let second = sessions
            .open(repository, Some(fixture.git.clone()))
            .expect("replacement session");
        assert_ne!(first.session_id, second.session_id);
        assert!(
            sessions
                .get(&first.session_id)
                .expect("replaced session lookup")
                .is_none()
        );
        assert!(
            sessions
                .get(&second.session_id)
                .expect("active session lookup")
                .is_some()
        );

        sessions.close(&second.session_id).expect("close session");
        assert!(
            sessions
                .get(&second.session_id)
                .expect("closed session lookup")
                .is_none()
        );
    }
}
