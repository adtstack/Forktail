use std::collections::BTreeMap;
use std::ffi::{OsStr, OsString};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

pub const SAFE_GLOBAL_ARGUMENTS: [&str; 5] = [
    "--no-pager",
    "--no-optional-locks",
    "--no-lazy-fetch",
    "--no-replace-objects",
    "--literal-pathspecs",
];

pub const REF_LIST_STDOUT_CAP: usize = 16 * 1024 * 1024;
pub const TREE_LIST_STDOUT_CAP: usize = 32 * 1024 * 1024;
pub const BLOB_CONTENT_STDOUT_CAP: usize = 64 * 1024 * 1024;
pub const CHANGED_FILES_STDOUT_CAP: usize = 32 * 1024 * 1024;
pub const STATUS_STDOUT_CAP: usize = 32 * 1024 * 1024;
pub const INDEX_ENTRY_STDOUT_CAP: usize = 64 * 1024;
pub const INDEX_VISIBILITY_STDOUT_CAP: usize = 64 * 1024;
pub const CONFLICTS_STDOUT_CAP: usize = 32 * 1024 * 1024;
pub const MERGE_BASE_STDOUT_CAP: usize = 8 * 1024;
pub const HISTORY_STDOUT_CAP: usize = 8 * 1024 * 1024;
const REF_LIST_FORMAT: &str =
    "%(refname)%00%(objectname)%00%(objecttype)%00%(*objectname)%00%(*objecttype)%00";
const RECENT_COMMIT_FORMAT: &str = "%H%x00%at%x00%s";
const FILE_HISTORY_FORMAT: &str = "%x00%H%x00%at%x00%s";

const SAFE_INHERITED_ENVIRONMENT: &[&str] = &[
    "HOME",
    "USERPROFILE",
    "HOMEDRIVE",
    "HOMEPATH",
    "XDG_CONFIG_HOME",
    "SYSTEMROOT",
    "WINDIR",
    "TEMP",
    "TMP",
    "TMPDIR",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "USER",
    "LOGNAME",
];

const SAFE_GIT_ENVIRONMENT: [(&str, &str); 5] = [
    ("GIT_TERMINAL_PROMPT", "0"),
    ("GIT_OPTIONAL_LOCKS", "0"),
    ("GIT_NO_LAZY_FETCH", "1"),
    ("GIT_LITERAL_PATHSPECS", "1"),
    ("GIT_PAGER", "cat"),
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GitOperation {
    Version,
    Repository {
        candidate: PathBuf,
        query: RepositoryQuery,
    },
    Revision {
        repository: PathBuf,
        query: RevisionQuery,
    },
    References {
        repository: PathBuf,
        namespaces: Vec<RefNamespace>,
        max_records: usize,
    },
    RecentCommits {
        repository: PathBuf,
        start_commit_id: String,
        max_records: usize,
    },
    FileHistory {
        repository: PathBuf,
        start_commit_id: String,
        path: OsString,
        max_records: usize,
    },
    Tree {
        repository: PathBuf,
        commit_id: String,
        path_prefix: Option<OsString>,
    },
    Blob {
        repository: PathBuf,
        object_id: String,
        query: BlobQuery,
    },
    ChangedFiles {
        repository: PathBuf,
        left_commit_id: String,
        right_commit_id: String,
    },
    Status {
        repository: PathBuf,
    },
    IndexEntries {
        repository: PathBuf,
        path: OsString,
    },
    IndexVisibility {
        repository: PathBuf,
        head_commit_id: String,
        path: OsString,
    },
    Conflicts {
        repository: PathBuf,
    },
    MergeBase {
        repository: PathBuf,
        left_commit_id: String,
        right_commit_id: String,
    },
}

impl GitOperation {
    fn arguments(&self) -> Vec<OsString> {
        let mut arguments = SAFE_GLOBAL_ARGUMENTS
            .iter()
            .copied()
            .map(OsString::from)
            .collect::<Vec<_>>();
        match self {
            Self::Version => arguments.push(OsString::from("version")),
            Self::Repository { candidate, query } => {
                arguments.push(OsString::from("-C"));
                arguments.push(candidate.as_os_str().to_owned());
                arguments.extend(query.arguments().iter().map(OsString::from));
            }
            Self::Revision { repository, query } => {
                arguments.push(OsString::from("-C"));
                arguments.push(repository.as_os_str().to_owned());
                arguments.extend(query.arguments());
            }
            Self::References {
                repository,
                namespaces,
                max_records,
            } => {
                arguments.push(OsString::from("-C"));
                arguments.push(repository.as_os_str().to_owned());
                arguments.extend([
                    OsString::from("for-each-ref"),
                    OsString::from(format!("--format={REF_LIST_FORMAT}")),
                    OsString::from("--sort=refname"),
                    OsString::from(format!("--count={max_records}")),
                    OsString::from("--"),
                ]);
                arguments.extend(
                    namespaces
                        .iter()
                        .map(|namespace| OsString::from(namespace.pattern())),
                );
            }
            Self::RecentCommits {
                repository,
                start_commit_id,
                max_records,
            } => {
                arguments.push(OsString::from("-C"));
                arguments.push(repository.as_os_str().to_owned());
                arguments.extend([
                    OsString::from("log"),
                    OsString::from("--no-decorate"),
                    OsString::from("--no-color"),
                    OsString::from("--no-show-signature"),
                    OsString::from("-z"),
                    OsString::from(format!("--format={RECENT_COMMIT_FORMAT}")),
                    OsString::from(format!("--max-count={max_records}")),
                    OsString::from(start_commit_id),
                    OsString::from("--"),
                ]);
            }
            Self::FileHistory {
                repository,
                start_commit_id,
                path,
                max_records,
            } => {
                arguments.push(OsString::from("-C"));
                arguments.push(repository.as_os_str().to_owned());
                arguments.extend([
                    OsString::from("log"),
                    OsString::from("--no-decorate"),
                    OsString::from("--no-color"),
                    OsString::from("--no-show-signature"),
                    OsString::from("--no-ext-diff"),
                    OsString::from("--no-textconv"),
                    OsString::from("--follow"),
                    OsString::from("--find-renames"),
                    OsString::from("--name-status"),
                    OsString::from("-z"),
                    OsString::from(format!("--format={FILE_HISTORY_FORMAT}")),
                    OsString::from(format!("--max-count={max_records}")),
                    OsString::from(start_commit_id),
                    OsString::from("--"),
                    path.clone(),
                ]);
            }
            Self::Tree {
                repository,
                commit_id,
                path_prefix,
            } => {
                arguments.push(OsString::from("-C"));
                arguments.push(repository.as_os_str().to_owned());
                arguments.extend([
                    OsString::from("ls-tree"),
                    OsString::from("-r"),
                    OsString::from("-z"),
                    OsString::from("--long"),
                    OsString::from("--full-tree"),
                    OsString::from(commit_id),
                    OsString::from("--"),
                ]);
                if let Some(path_prefix) = path_prefix {
                    arguments.push(path_prefix.clone());
                }
            }
            Self::Blob {
                repository,
                object_id,
                query,
            } => {
                arguments.push(OsString::from("-C"));
                arguments.push(repository.as_os_str().to_owned());
                arguments.extend(query.arguments(object_id));
            }
            Self::ChangedFiles {
                repository,
                left_commit_id,
                right_commit_id,
            } => {
                arguments.push(OsString::from("-C"));
                arguments.push(repository.as_os_str().to_owned());
                arguments.extend([
                    OsString::from("diff"),
                    OsString::from("--no-ext-diff"),
                    OsString::from("--no-textconv"),
                    OsString::from("--name-status"),
                    OsString::from("-z"),
                    OsString::from("--find-renames"),
                    OsString::from(left_commit_id),
                    OsString::from(right_commit_id),
                    OsString::from("--"),
                ]);
            }
            Self::Status { repository } => {
                arguments.push(OsString::from("-C"));
                arguments.push(repository.as_os_str().to_owned());
                arguments.extend([
                    OsString::from("-c"),
                    OsString::from("core.fsmonitor=false"),
                    OsString::from("status"),
                    OsString::from("--porcelain=v2"),
                    OsString::from("-z"),
                    OsString::from("--branch"),
                    OsString::from("--untracked-files=all"),
                ]);
            }
            Self::IndexEntries { repository, path } => {
                arguments.push(OsString::from("-C"));
                arguments.push(repository.as_os_str().to_owned());
                arguments.extend([
                    OsString::from("ls-files"),
                    OsString::from("-v"),
                    OsString::from("--stage"),
                    OsString::from("-z"),
                    OsString::from("--"),
                    path.clone(),
                ]);
            }
            Self::IndexVisibility {
                repository,
                head_commit_id,
                path,
            } => {
                arguments.push(OsString::from("-C"));
                arguments.push(repository.as_os_str().to_owned());
                arguments.extend([
                    OsString::from("-c"),
                    OsString::from("diff.autoRefreshIndex=false"),
                    OsString::from("diff"),
                    OsString::from("--cached"),
                    OsString::from("--raw"),
                    OsString::from("-z"),
                    OsString::from("--no-ext-diff"),
                    OsString::from("--no-textconv"),
                    OsString::from("--no-renames"),
                    OsString::from("--ita-invisible-in-index"),
                    OsString::from(head_commit_id),
                    OsString::from("--"),
                    path.clone(),
                ]);
            }
            Self::Conflicts { repository } => {
                arguments.push(OsString::from("-C"));
                arguments.push(repository.as_os_str().to_owned());
                arguments.extend([
                    OsString::from("ls-files"),
                    OsString::from("--unmerged"),
                    OsString::from("--stage"),
                    OsString::from("-z"),
                    OsString::from("--"),
                ]);
            }
            Self::MergeBase {
                repository,
                left_commit_id,
                right_commit_id,
            } => {
                arguments.push(OsString::from("-C"));
                arguments.push(repository.as_os_str().to_owned());
                arguments.extend([
                    OsString::from("merge-base"),
                    OsString::from("--all"),
                    OsString::from(left_commit_id),
                    OsString::from(right_commit_id),
                ]);
            }
        }
        arguments
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BlobQuery {
    Type,
    Size,
    Content,
}

impl BlobQuery {
    fn arguments(self, object_id: &str) -> [OsString; 3] {
        let mode = match self {
            Self::Type => "-t",
            Self::Size => "-s",
            Self::Content => "blob",
        };
        [
            OsString::from("cat-file"),
            OsString::from(mode),
            OsString::from(object_id),
        ]
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum RefNamespace {
    LocalBranches,
    RemoteTrackingBranches,
    Tags,
}

impl RefNamespace {
    fn pattern(self) -> &'static str {
        match self {
            Self::LocalBranches => "refs/heads",
            Self::RemoteTrackingBranches => "refs/remotes",
            Self::Tags => "refs/tags",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RepositoryQuery {
    Bare,
    Root,
    GitDir,
    CommonDir,
    Metadata,
    HeadCommit,
    SymbolicHead,
}

impl RepositoryQuery {
    fn arguments(self) -> &'static [&'static str] {
        match self {
            Self::Bare => &["rev-parse", "--is-bare-repository"],
            Self::Root => &["rev-parse", "--path-format=absolute", "--show-toplevel"],
            Self::GitDir => &["rev-parse", "--path-format=absolute", "--absolute-git-dir"],
            Self::CommonDir => &["rev-parse", "--path-format=absolute", "--git-common-dir"],
            Self::Metadata => &[
                "rev-parse",
                "--is-shallow-repository",
                "--show-object-format=storage",
            ],
            Self::HeadCommit => &["rev-parse", "--verify", "--end-of-options", "HEAD^{commit}"],
            Self::SymbolicHead => &["symbolic-ref", "--quiet", "HEAD"],
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RevisionQuery {
    ShortRefCandidates { short_name: String },
    Disambiguate { prefix: String },
    VerifyCommit { revision: String },
}

impl RevisionQuery {
    fn arguments(&self) -> Vec<OsString> {
        match self {
            Self::ShortRefCandidates { short_name } => vec![
                OsString::from("for-each-ref"),
                OsString::from("--format=%(refname)"),
                OsString::from("--"),
                OsString::from(format!("refs/heads/{short_name}")),
                OsString::from(format!("refs/tags/{short_name}")),
                OsString::from(format!("refs/remotes/{short_name}")),
            ],
            Self::Disambiguate { prefix } => vec![
                OsString::from("rev-parse"),
                OsString::from(format!("--disambiguate={prefix}")),
            ],
            Self::VerifyCommit { revision } => vec![
                OsString::from("rev-parse"),
                OsString::from("--verify"),
                OsString::from("--end-of-options"),
                OsString::from(format!("{revision}^{{commit}}")),
            ],
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OutputStream {
    Stdout,
    Stderr,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RunnerError {
    InvalidExecutable,
    ForbiddenOperation,
    SpawnFailed,
    ProcessControlFailed,
    WaitFailed,
    StreamReadFailed(OutputStream),
    TimedOut,
    Cancelled,
    OutputTooLarge(OutputStream),
}

#[derive(Debug, Clone, Copy)]
pub struct RunnerLimits {
    timeout: Duration,
    stdout_bytes: usize,
    stderr_bytes: usize,
    poll_interval: Duration,
}

impl RunnerLimits {
    fn production(operation: &GitOperation) -> Self {
        Self {
            timeout: Duration::from_secs(30),
            stdout_bytes: match operation {
                GitOperation::Revision { .. } => 64 * 1024,
                GitOperation::References { .. } => REF_LIST_STDOUT_CAP,
                GitOperation::RecentCommits { .. } => HISTORY_STDOUT_CAP,
                GitOperation::FileHistory { .. } => HISTORY_STDOUT_CAP,
                GitOperation::Tree { .. } => TREE_LIST_STDOUT_CAP,
                GitOperation::Blob {
                    query: BlobQuery::Content,
                    ..
                } => BLOB_CONTENT_STDOUT_CAP,
                GitOperation::Blob { .. } => 4096,
                GitOperation::ChangedFiles { .. } => CHANGED_FILES_STDOUT_CAP,
                GitOperation::Status { .. } => STATUS_STDOUT_CAP,
                GitOperation::IndexEntries { .. } => INDEX_ENTRY_STDOUT_CAP,
                GitOperation::IndexVisibility { .. } => INDEX_VISIBILITY_STDOUT_CAP,
                GitOperation::Conflicts { .. } => CONFLICTS_STDOUT_CAP,
                GitOperation::MergeBase { .. } => MERGE_BASE_STDOUT_CAP,
                GitOperation::Version | GitOperation::Repository { .. } => 8 * 1024 * 1024,
            },
            stderr_bytes: 256 * 1024,
            poll_interval: Duration::from_millis(10),
        }
    }

    #[cfg(test)]
    pub(crate) fn for_tests(timeout: Duration, stdout_bytes: usize, stderr_bytes: usize) -> Self {
        Self {
            timeout,
            stdout_bytes,
            stderr_bytes,
            poll_interval: Duration::from_millis(5),
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct CancellationToken {
    cancelled: Arc<AtomicBool>,
}

impl CancellationToken {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::Release);
    }

    pub(crate) fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Acquire)
    }
}

#[derive(Debug, PartialEq, Eq)]
pub struct RunnerOutput {
    pub success: bool,
    pub exit_code: Option<i32>,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
}

#[derive(Debug)]
pub struct ProductionGitRunner {
    executable: PathBuf,
}

impl ProductionGitRunner {
    pub fn new(executable: PathBuf) -> Result<Self, RunnerError> {
        validate_executable(&executable)?;
        Ok(Self { executable })
    }

    fn plan(&self, operation: GitOperation) -> Result<ProcessPlan, RunnerError> {
        let limits = RunnerLimits::production(&operation);
        let arguments = operation.arguments();
        validate_approved_arguments(&arguments)?;
        Ok(ProcessPlan {
            executable: self.executable.clone(),
            arguments,
            environment: safe_environment_from(std::env::vars_os()),
            limits,
        })
    }

    pub fn run(
        &self,
        operation: GitOperation,
        cancellation: &CancellationToken,
    ) -> Result<RunnerOutput, RunnerError> {
        run_process(self.plan(operation)?, cancellation)
    }
}

#[derive(Debug)]
struct ProcessPlan {
    executable: PathBuf,
    arguments: Vec<OsString>,
    environment: BTreeMap<OsString, OsString>,
    limits: RunnerLimits,
}

fn validate_executable(executable: &Path) -> Result<(), RunnerError> {
    if !executable.is_absolute() {
        return Err(RunnerError::InvalidExecutable);
    }
    let metadata = fs::metadata(executable).map_err(|_| RunnerError::InvalidExecutable)?;
    if !metadata.is_file() {
        return Err(RunnerError::InvalidExecutable);
    }
    Ok(())
}

fn validate_approved_arguments(arguments: &[OsString]) -> Result<(), RunnerError> {
    let safe_prefix = arguments
        .iter()
        .zip(SAFE_GLOBAL_ARGUMENTS)
        .all(|(actual, expected)| actual == OsStr::new(expected));
    if !safe_prefix || arguments.len() <= SAFE_GLOBAL_ARGUMENTS.len() {
        return Err(RunnerError::ForbiddenOperation);
    }
    let operation = &arguments[SAFE_GLOBAL_ARGUMENTS.len()..];
    if operation == [OsString::from("version")] {
        return Ok(());
    }
    if operation.len() < 4 || operation[0] != "-C" || !Path::new(&operation[1]).is_absolute() {
        return Err(RunnerError::ForbiddenOperation);
    }
    let query_arguments = &operation[2..];
    let fixed_repository_query = [
        RepositoryQuery::Bare,
        RepositoryQuery::Root,
        RepositoryQuery::GitDir,
        RepositoryQuery::CommonDir,
        RepositoryQuery::Metadata,
        RepositoryQuery::HeadCommit,
        RepositoryQuery::SymbolicHead,
    ]
    .iter()
    .any(|query| os_arguments_equal(query_arguments, query.arguments()));
    if fixed_repository_query
        || validate_revision_query_arguments(query_arguments)
        || validate_ref_query_arguments(query_arguments)
        || validate_recent_commit_query_arguments(query_arguments)
        || validate_file_history_query_arguments(query_arguments)
        || validate_tree_query_arguments(query_arguments)
        || validate_blob_query_arguments(query_arguments)
        || validate_changed_files_query_arguments(query_arguments)
        || validate_status_query_arguments(query_arguments)
        || validate_index_entries_query_arguments(query_arguments)
        || validate_index_visibility_query_arguments(query_arguments)
        || validate_conflicts_query_arguments(query_arguments)
        || validate_merge_base_query_arguments(query_arguments)
    {
        Ok(())
    } else {
        Err(RunnerError::ForbiddenOperation)
    }
}

fn validate_file_history_query_arguments(arguments: &[OsString]) -> bool {
    let expected_format = format!("--format={FILE_HISTORY_FORMAT}");
    if arguments.len() != 15
        || arguments[0] != "log"
        || arguments[1] != "--no-decorate"
        || arguments[2] != "--no-color"
        || arguments[3] != "--no-show-signature"
        || arguments[4] != "--no-ext-diff"
        || arguments[5] != "--no-textconv"
        || arguments[6] != "--follow"
        || arguments[7] != "--find-renames"
        || arguments[8] != "--name-status"
        || arguments[9] != "-z"
        || arguments[10] != OsStr::new(&expected_format)
        || !is_full_object_id(&arguments[12])
        || arguments[13] != "--"
        || !validate_literal_path_argument(&arguments[14])
    {
        return false;
    }
    arguments[11]
        .to_str()
        .and_then(|argument| argument.strip_prefix("--max-count="))
        .and_then(|count| count.parse::<usize>().ok())
        .is_some_and(|count| (1..=501).contains(&count))
}

fn validate_recent_commit_query_arguments(arguments: &[OsString]) -> bool {
    let expected_format = format!("--format={RECENT_COMMIT_FORMAT}");
    if arguments.len() != 9
        || arguments[0] != "log"
        || arguments[1] != "--no-decorate"
        || arguments[2] != "--no-color"
        || arguments[3] != "--no-show-signature"
        || arguments[4] != "-z"
        || arguments[5] != OsStr::new(&expected_format)
        || !is_full_object_id(&arguments[7])
        || arguments[8] != "--"
    {
        return false;
    }
    arguments[6]
        .to_str()
        .and_then(|argument| argument.strip_prefix("--max-count="))
        .and_then(|count| count.parse::<usize>().ok())
        .is_some_and(|count| (1..=501).contains(&count))
}

fn validate_merge_base_query_arguments(arguments: &[OsString]) -> bool {
    arguments.len() == 4
        && arguments[0] == "merge-base"
        && arguments[1] == "--all"
        && is_full_object_id(&arguments[2])
        && is_full_object_id(&arguments[3])
}

fn validate_conflicts_query_arguments(arguments: &[OsString]) -> bool {
    os_arguments_equal(
        arguments,
        &["ls-files", "--unmerged", "--stage", "-z", "--"],
    )
}

fn validate_index_entries_query_arguments(arguments: &[OsString]) -> bool {
    arguments.len() == 6
        && arguments[0] == "ls-files"
        && arguments[1] == "-v"
        && arguments[2] == "--stage"
        && arguments[3] == "-z"
        && arguments[4] == "--"
        && validate_literal_path_argument(&arguments[5])
}

fn validate_index_visibility_query_arguments(arguments: &[OsString]) -> bool {
    arguments.len() == 13
        && arguments[0] == "-c"
        && arguments[1] == "diff.autoRefreshIndex=false"
        && arguments[2] == "diff"
        && arguments[3] == "--cached"
        && arguments[4] == "--raw"
        && arguments[5] == "-z"
        && arguments[6] == "--no-ext-diff"
        && arguments[7] == "--no-textconv"
        && arguments[8] == "--no-renames"
        && arguments[9] == "--ita-invisible-in-index"
        && is_full_object_id(&arguments[10])
        && arguments[11] == "--"
        && validate_literal_path_argument(&arguments[12])
}

fn is_full_object_id(argument: &OsStr) -> bool {
    argument.to_str().is_some_and(|object_id| {
        matches!(object_id.len(), 40 | 64) && object_id.bytes().all(|byte| byte.is_ascii_hexdigit())
    })
}

fn validate_literal_path_argument(path: &OsStr) -> bool {
    let path = Path::new(path);
    !path.as_os_str().is_empty()
        && path.as_os_str().len() <= 4096
        && !path.is_absolute()
        && path
            .components()
            .all(|component| matches!(component, std::path::Component::Normal(_)))
}

fn validate_status_query_arguments(arguments: &[OsString]) -> bool {
    os_arguments_equal(
        arguments,
        &[
            "-c",
            "core.fsmonitor=false",
            "status",
            "--porcelain=v2",
            "-z",
            "--branch",
            "--untracked-files=all",
        ],
    )
}

fn validate_changed_files_query_arguments(arguments: &[OsString]) -> bool {
    if arguments.len() != 9
        || arguments[0] != "diff"
        || arguments[1] != "--no-ext-diff"
        || arguments[2] != "--no-textconv"
        || arguments[3] != "--name-status"
        || arguments[4] != "-z"
        || arguments[5] != "--find-renames"
        || arguments[8] != "--"
    {
        return false;
    }
    arguments[6..=7].iter().all(|object_id| {
        object_id.to_str().is_some_and(|object_id| {
            matches!(object_id.len(), 40 | 64)
                && object_id.bytes().all(|byte| byte.is_ascii_hexdigit())
        })
    })
}

fn validate_blob_query_arguments(arguments: &[OsString]) -> bool {
    if arguments.len() != 3 || arguments[0] != "cat-file" {
        return false;
    }
    if !matches!(arguments[1].to_str(), Some("-t" | "-s" | "blob")) {
        return false;
    }
    arguments[2].to_str().is_some_and(|object_id| {
        matches!(object_id.len(), 40 | 64) && object_id.bytes().all(|byte| byte.is_ascii_hexdigit())
    })
}

fn validate_tree_query_arguments(arguments: &[OsString]) -> bool {
    if !(7..=8).contains(&arguments.len())
        || arguments[0] != "ls-tree"
        || arguments[1] != "-r"
        || arguments[2] != "-z"
        || arguments[3] != "--long"
        || arguments[4] != "--full-tree"
        || arguments[6] != "--"
    {
        return false;
    }
    let Some(commit_id) = arguments[5].to_str() else {
        return false;
    };
    if !matches!(commit_id.len(), 40 | 64)
        || !commit_id.bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        return false;
    }
    if let Some(path_prefix) = arguments.get(7) {
        let path = Path::new(path_prefix);
        !path_prefix.is_empty()
            && path_prefix.len() <= 4096
            && !path.is_absolute()
            && !path.components().any(|component| {
                matches!(
                    component,
                    std::path::Component::ParentDir
                        | std::path::Component::RootDir
                        | std::path::Component::Prefix(_)
                )
            })
    } else {
        true
    }
}

fn validate_ref_query_arguments(arguments: &[OsString]) -> bool {
    let Some(arguments) = arguments
        .iter()
        .map(|argument| argument.to_str())
        .collect::<Option<Vec<_>>>()
    else {
        return false;
    };
    if arguments.len() < 6
        || arguments[0] != "for-each-ref"
        || arguments[1] != format!("--format={REF_LIST_FORMAT}")
        || arguments[2] != "--sort=refname"
        || arguments[4] != "--"
    {
        return false;
    }
    let Some(count) = arguments[3].strip_prefix("--count=") else {
        return false;
    };
    if !count
        .parse::<usize>()
        .is_ok_and(|count| (1..=10_001).contains(&count))
    {
        return false;
    }

    let expected_order = ["refs/heads", "refs/remotes", "refs/tags"];
    let patterns = &arguments[5..];
    patterns.len() <= expected_order.len()
        && patterns
            .windows(2)
            .all(|pair| expected_order_index(pair[0]) < expected_order_index(pair[1]))
        && patterns
            .iter()
            .all(|pattern| expected_order.contains(pattern))
}

fn expected_order_index(pattern: &str) -> usize {
    match pattern {
        "refs/heads" => 0,
        "refs/remotes" => 1,
        "refs/tags" => 2,
        _ => usize::MAX,
    }
}

fn validate_revision_query_arguments(arguments: &[OsString]) -> bool {
    let Some(arguments) = arguments
        .iter()
        .map(|argument| argument.to_str())
        .collect::<Option<Vec<_>>>()
    else {
        return false;
    };

    match arguments.as_slice() {
        ["rev-parse", "--verify", "--end-of-options", expression] => expression
            .strip_suffix("^{commit}")
            .is_some_and(is_bounded_revision_argument),
        ["rev-parse", disambiguation] => disambiguation
            .strip_prefix("--disambiguate=")
            .is_some_and(|prefix| {
                (4..=64).contains(&prefix.len())
                    && prefix.bytes().all(|byte| byte.is_ascii_hexdigit())
            }),
        [
            "for-each-ref",
            "--format=%(refname)",
            "--",
            head,
            tag,
            remote,
        ] => {
            let head = head.strip_prefix("refs/heads/");
            let tag = tag.strip_prefix("refs/tags/");
            let remote = remote.strip_prefix("refs/remotes/");
            matches!((head, tag, remote), (Some(head), Some(tag), Some(remote)) if head == tag
                && tag == remote
                && is_bounded_short_ref_argument(head))
        }
        _ => false,
    }
}

fn is_bounded_revision_argument(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 1024
        && !value.chars().any(|character| character.is_control())
}

fn is_bounded_short_ref_argument(value: &str) -> bool {
    is_bounded_revision_argument(value)
        && !value.starts_with('-')
        && !value.contains(['~', '^', ':', '?', '*', '[', '\\'])
}

fn os_arguments_equal(actual: &[OsString], expected: &[&str]) -> bool {
    actual.len() == expected.len()
        && actual
            .iter()
            .zip(expected)
            .all(|(actual, expected)| actual == OsStr::new(expected))
}

fn safe_environment_from<I>(inherited: I) -> BTreeMap<OsString, OsString>
where
    I: IntoIterator<Item = (OsString, OsString)>,
{
    let inherited = inherited.into_iter().collect::<Vec<_>>();
    let mut environment = BTreeMap::new();
    for approved in SAFE_INHERITED_ENVIRONMENT {
        if let Some((_, value)) = inherited
            .iter()
            .find(|(key, _)| environment_key_matches(key, approved))
        {
            environment.insert(OsString::from(approved), value.clone());
        }
    }
    for (key, value) in SAFE_GIT_ENVIRONMENT {
        environment.insert(OsString::from(key), OsString::from(value));
    }
    environment
}

fn environment_key_matches(key: &OsStr, approved: &str) -> bool {
    if cfg!(windows) {
        key.to_string_lossy().eq_ignore_ascii_case(approved)
    } else {
        key == OsStr::new(approved)
    }
}

fn run_process(
    plan: ProcessPlan,
    cancellation: &CancellationToken,
) -> Result<RunnerOutput, RunnerError> {
    let mut command = Command::new(&plan.executable);
    command
        .args(&plan.arguments)
        .env_clear()
        .envs(&plan.environment)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    ProcessTree::configure(&mut command);

    let mut child = command.spawn().map_err(|_| RunnerError::SpawnFailed)?;
    let process_tree = match ProcessTree::attach(&mut child) {
        Ok(process_tree) => process_tree,
        Err(error) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(error);
        }
    };
    let Some(stdout) = child.stdout.take() else {
        terminate_and_wait(&process_tree, &mut child)?;
        return Err(RunnerError::SpawnFailed);
    };
    let Some(stderr) = child.stderr.take() else {
        terminate_and_wait(&process_tree, &mut child)?;
        return Err(RunnerError::SpawnFailed);
    };
    let cap_signal = Arc::new(AtomicU8::new(0));
    let stdout_drain = spawn_drain(
        stdout,
        plan.limits.stdout_bytes,
        OutputStream::Stdout,
        Arc::clone(&cap_signal),
    );
    let stderr_drain = spawn_drain(
        stderr,
        plan.limits.stderr_bytes,
        OutputStream::Stderr,
        Arc::clone(&cap_signal),
    );

    let started = Instant::now();
    let status = loop {
        if let Some(error) = cap_error(cap_signal.load(Ordering::Acquire)) {
            terminate_and_wait(&process_tree, &mut child)?;
            break Err(error);
        }
        if cancellation.is_cancelled() {
            terminate_and_wait(&process_tree, &mut child)?;
            break Err(RunnerError::Cancelled);
        }
        if started.elapsed() >= plan.limits.timeout {
            terminate_and_wait(&process_tree, &mut child)?;
            break Err(RunnerError::TimedOut);
        }
        match child.try_wait().map_err(|_| RunnerError::WaitFailed)? {
            Some(status) => break Ok(status),
            None => thread::sleep(plan.limits.poll_interval),
        }
    };

    let stdout = join_drain(stdout_drain, OutputStream::Stdout);
    let stderr = join_drain(stderr_drain, OutputStream::Stderr);
    let status = status?;

    Ok(RunnerOutput {
        success: status.success(),
        exit_code: status.code(),
        stdout: stdout?,
        stderr: stderr?,
    })
}

fn spawn_drain<R>(
    mut reader: R,
    cap: usize,
    stream: OutputStream,
    cap_signal: Arc<AtomicU8>,
) -> JoinHandle<Result<Vec<u8>, RunnerError>>
where
    R: Read + Send + 'static,
{
    thread::spawn(move || {
        let mut output = Vec::with_capacity(cap.min(64 * 1024));
        let mut buffer = [0_u8; 8192];
        loop {
            let read = reader
                .read(&mut buffer)
                .map_err(|_| RunnerError::StreamReadFailed(stream))?;
            if read == 0 {
                return Ok(output);
            }
            let Some(next_size) = output.len().checked_add(read) else {
                signal_cap(&cap_signal, stream);
                return Err(RunnerError::OutputTooLarge(stream));
            };
            if next_size > cap {
                signal_cap(&cap_signal, stream);
                return Err(RunnerError::OutputTooLarge(stream));
            }
            output.extend_from_slice(&buffer[..read]);
        }
    })
}

fn signal_cap(signal: &AtomicU8, stream: OutputStream) {
    let value = match stream {
        OutputStream::Stdout => 1,
        OutputStream::Stderr => 2,
    };
    let _ = signal.compare_exchange(0, value, Ordering::AcqRel, Ordering::Acquire);
}

fn cap_error(value: u8) -> Option<RunnerError> {
    match value {
        1 => Some(RunnerError::OutputTooLarge(OutputStream::Stdout)),
        2 => Some(RunnerError::OutputTooLarge(OutputStream::Stderr)),
        _ => None,
    }
}

fn join_drain(
    handle: JoinHandle<Result<Vec<u8>, RunnerError>>,
    stream: OutputStream,
) -> Result<Vec<u8>, RunnerError> {
    handle
        .join()
        .map_err(|_| RunnerError::StreamReadFailed(stream))?
}

fn terminate_and_wait(process_tree: &ProcessTree, child: &mut Child) -> Result<(), RunnerError> {
    process_tree.terminate(child)?;
    child.wait().map_err(|_| RunnerError::WaitFailed)?;
    Ok(())
}

struct ProcessTree {
    #[cfg(windows)]
    job: windows_process_tree::Job,
}

impl ProcessTree {
    fn configure(command: &mut Command) {
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            command.process_group(0);
        }
        #[cfg(not(unix))]
        let _ = command;
    }

    fn attach(child: &mut Child) -> Result<Self, RunnerError> {
        #[cfg(windows)]
        {
            windows_process_tree::Job::attach(child).map(|job| Self { job })
        }
        #[cfg(not(windows))]
        {
            let _ = child;
            Ok(Self {})
        }
    }

    fn terminate(&self, child: &mut Child) -> Result<(), RunnerError> {
        #[cfg(unix)]
        {
            let process_group = -(child.id() as i32);
            // SAFETY: the child was placed in its own process group before spawn. The call does
            // not dereference pointers and targets only that negative process-group identifier.
            let group_killed = unsafe { unix_kill(process_group, UNIX_SIGKILL) } == 0;
            if group_killed || child.kill().is_ok() {
                return Ok(());
            }
            if child.try_wait().ok().flatten().is_some() {
                return Ok(());
            }
            Err(RunnerError::ProcessControlFailed)
        }
        #[cfg(windows)]
        {
            if self.job.terminate() || child.kill().is_ok() {
                return Ok(());
            }
            if child.try_wait().ok().flatten().is_some() {
                return Ok(());
            }
            Err(RunnerError::ProcessControlFailed)
        }
        #[cfg(not(any(unix, windows)))]
        {
            if child.kill().is_ok() || child.try_wait().ok().flatten().is_some() {
                Ok(())
            } else {
                Err(RunnerError::ProcessControlFailed)
            }
        }
    }
}

#[cfg(unix)]
const UNIX_SIGKILL: i32 = 9;

#[cfg(unix)]
unsafe extern "C" {
    fn kill(pid: i32, signal: i32) -> i32;
}

#[cfg(unix)]
unsafe fn unix_kill(pid: i32, signal: i32) -> i32 {
    // SAFETY: the caller supplies a process identifier and integer signal to the libc ABI.
    unsafe { kill(pid, signal) }
}

#[cfg(windows)]
mod windows_process_tree {
    use std::ffi::c_void;
    use std::mem::size_of;
    use std::os::windows::io::AsRawHandle;
    use std::process::Child;

    use super::RunnerError;

    type Handle = *mut c_void;

    const JOB_OBJECT_EXTENDED_LIMIT_INFORMATION_CLASS: i32 = 9;
    const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE: u32 = 0x0000_2000;

    #[repr(C)]
    #[derive(Default)]
    struct BasicLimitInformation {
        per_process_user_time_limit: i64,
        per_job_user_time_limit: i64,
        limit_flags: u32,
        minimum_working_set_size: usize,
        maximum_working_set_size: usize,
        active_process_limit: u32,
        affinity: usize,
        priority_class: u32,
        scheduling_class: u32,
    }

    #[repr(C)]
    #[derive(Default)]
    struct IoCounters {
        read_operation_count: u64,
        write_operation_count: u64,
        other_operation_count: u64,
        read_transfer_count: u64,
        write_transfer_count: u64,
        other_transfer_count: u64,
    }

    #[repr(C)]
    #[derive(Default)]
    struct ExtendedLimitInformation {
        basic_limit_information: BasicLimitInformation,
        io_info: IoCounters,
        process_memory_limit: usize,
        job_memory_limit: usize,
        peak_process_memory_used: usize,
        peak_job_memory_used: usize,
    }

    pub(super) struct Job(Handle);

    impl Job {
        pub(super) fn attach(child: &mut Child) -> Result<Self, RunnerError> {
            // SAFETY: null security attributes/name request an unnamed job owned by this process.
            let handle = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
            if handle.is_null() {
                let _ = child.kill();
                return Err(RunnerError::ProcessControlFailed);
            }

            let mut information = ExtendedLimitInformation::default();
            information.basic_limit_information.limit_flags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            // SAFETY: `information` has the exact Windows extended-limit layout and remains alive
            // for the duration of the call.
            let configured = unsafe {
                SetInformationJobObject(
                    handle,
                    JOB_OBJECT_EXTENDED_LIMIT_INFORMATION_CLASS,
                    (&information as *const ExtendedLimitInformation).cast(),
                    size_of::<ExtendedLimitInformation>() as u32,
                )
            } != 0;
            // SAFETY: std::process::Child owns a valid process handle until it is dropped.
            let assigned = configured
                && unsafe { AssignProcessToJobObject(handle, child.as_raw_handle().cast()) } != 0;
            if !assigned {
                // SAFETY: `handle` was returned by CreateJobObjectW and is closed exactly once.
                unsafe { CloseHandle(handle) };
                let _ = child.kill();
                return Err(RunnerError::ProcessControlFailed);
            }
            Ok(Self(handle))
        }

        pub(super) fn terminate(&self) -> bool {
            // SAFETY: the handle remains owned by `self` and the exit code is an internal marker.
            unsafe { TerminateJobObject(self.0, 1) != 0 }
        }
    }

    impl Drop for Job {
        fn drop(&mut self) {
            // SAFETY: the handle is valid and is closed exactly once here.
            unsafe { CloseHandle(self.0) };
        }
    }

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn CreateJobObjectW(attributes: *const c_void, name: *const u16) -> Handle;
        fn SetInformationJobObject(
            job: Handle,
            information_class: i32,
            information: *const c_void,
            information_length: u32,
        ) -> i32;
        fn AssignProcessToJobObject(job: Handle, process: Handle) -> i32;
        fn TerminateJobObject(job: Handle, exit_code: u32) -> i32;
        fn CloseHandle(handle: Handle) -> i32;
    }
}

#[cfg(test)]
pub(crate) mod fixture {
    use std::ffi::OsString;
    use std::path::PathBuf;

    use super::{
        CancellationToken, ProcessPlan, RunnerError, RunnerLimits, RunnerOutput, run_process,
        safe_environment_from,
    };

    pub(crate) struct FixtureProcess {
        plan: ProcessPlan,
    }

    impl FixtureProcess {
        pub(crate) fn new<I, S>(executable: PathBuf, arguments: I, limits: RunnerLimits) -> Self
        where
            I: IntoIterator<Item = S>,
            S: Into<OsString>,
        {
            Self {
                plan: ProcessPlan {
                    executable,
                    arguments: arguments.into_iter().map(Into::into).collect(),
                    environment: safe_environment_from(std::env::vars_os())
                        .into_iter()
                        .chain([(
                            OsString::from("FORKTAIL_RUNNER_TEST_HELPER"),
                            OsString::from("1"),
                        )])
                        .collect(),
                    limits,
                },
            }
        }

        #[cfg(unix)]
        pub(crate) fn with_environment(
            mut self,
            key: impl Into<OsString>,
            value: impl Into<OsString>,
        ) -> Self {
            self.plan.environment.insert(key.into(), value.into());
            self
        }
    }

    pub(crate) struct FixtureGitRunner;

    impl FixtureGitRunner {
        pub(crate) fn run(process: FixtureProcess) -> Result<RunnerOutput, RunnerError> {
            Self::run_with_cancellation(process, &CancellationToken::new())
        }

        pub(crate) fn run_with_cancellation(
            process: FixtureProcess,
            cancellation: &CancellationToken,
        ) -> Result<RunnerOutput, RunnerError> {
            run_process(process.plan, cancellation)
        }
    }
}

#[cfg(test)]
mod tests {
    use std::ffi::{OsStr, OsString};
    #[cfg(unix)]
    use std::fs;
    use std::io::{self, Write};
    use std::path::PathBuf;
    #[cfg(unix)]
    use std::process::{Command, Stdio};
    use std::thread;
    use std::time::{Duration, Instant};

    use super::{
        BLOB_CONTENT_STDOUT_CAP, BlobQuery, CHANGED_FILES_STDOUT_CAP, CONFLICTS_STDOUT_CAP,
        CancellationToken, GitOperation, HISTORY_STDOUT_CAP, INDEX_ENTRY_STDOUT_CAP,
        INDEX_VISIBILITY_STDOUT_CAP, MERGE_BASE_STDOUT_CAP, OutputStream, ProductionGitRunner,
        REF_LIST_STDOUT_CAP, RefNamespace, RepositoryQuery, RevisionQuery, RunnerError,
        RunnerLimits, SAFE_GLOBAL_ARGUMENTS, STATUS_STDOUT_CAP, TREE_LIST_STDOUT_CAP,
        fixture::{FixtureGitRunner, FixtureProcess},
        safe_environment_from, validate_approved_arguments,
    };

    #[test]
    fn version_operation_builds_only_the_approved_argv_and_environment() {
        let runner = ProductionGitRunner::new(current_test_executable())
            .expect("test executable should be accepted");
        let plan = runner
            .plan(GitOperation::Version)
            .expect("version operation should be approved");
        let expected = SAFE_GLOBAL_ARGUMENTS
            .iter()
            .copied()
            .chain(["version"])
            .map(OsString::from)
            .collect::<Vec<_>>();

        assert_eq!(plan.arguments, expected);
        assert_eq!(
            plan.environment.get(OsStr::new("GIT_TERMINAL_PROMPT")),
            Some(&OsString::from("0"))
        );
        assert_eq!(
            plan.environment.get(OsStr::new("GIT_OPTIONAL_LOCKS")),
            Some(&OsString::from("0"))
        );
        assert_eq!(
            plan.environment.get(OsStr::new("GIT_NO_LAZY_FETCH")),
            Some(&OsString::from("1"))
        );
        assert_eq!(
            plan.environment.get(OsStr::new("GIT_LITERAL_PATHSPECS")),
            Some(&OsString::from("1"))
        );
        assert_eq!(
            plan.environment.get(OsStr::new("GIT_PAGER")),
            Some(&OsString::from("cat"))
        );
    }

    #[test]
    fn repository_operations_allow_only_absolute_context_and_exact_read_queries() {
        let runner = ProductionGitRunner::new(current_test_executable())
            .expect("test executable should be accepted");
        let candidate = std::env::temp_dir().join("repository with spaces 한글");

        for query in [
            RepositoryQuery::Bare,
            RepositoryQuery::Root,
            RepositoryQuery::GitDir,
            RepositoryQuery::CommonDir,
            RepositoryQuery::Metadata,
            RepositoryQuery::HeadCommit,
            RepositoryQuery::SymbolicHead,
        ] {
            let plan = runner
                .plan(GitOperation::Repository {
                    candidate: candidate.clone(),
                    query,
                })
                .expect("typed repository query should be approved");
            assert_eq!(plan.arguments[SAFE_GLOBAL_ARGUMENTS.len()], "-C");
            assert_eq!(plan.arguments[SAFE_GLOBAL_ARGUMENTS.len() + 1], candidate);
            assert!(validate_approved_arguments(&plan.arguments).is_ok());
        }

        let error = runner
            .plan(GitOperation::Repository {
                candidate: PathBuf::from("relative-repository"),
                query: RepositoryQuery::Root,
            })
            .expect_err("relative repository context must fail closed");
        assert_eq!(error, RunnerError::ForbiddenOperation);
    }

    #[test]
    fn revision_operations_allow_only_typed_bounded_read_queries() {
        let runner = ProductionGitRunner::new(current_test_executable())
            .expect("test executable should be accepted");
        let repository = std::env::temp_dir().join("revision repository 한글");
        let queries = [
            RevisionQuery::ShortRefCandidates {
                short_name: "feature/review".to_string(),
            },
            RevisionQuery::Disambiguate {
                prefix: "abcd1234".to_string(),
            },
            RevisionQuery::VerifyCommit {
                revision: "HEAD~2".to_string(),
            },
        ];

        for query in queries {
            let plan = runner
                .plan(GitOperation::Revision {
                    repository: repository.clone(),
                    query,
                })
                .expect("typed revision query should be approved");
            assert!(validate_approved_arguments(&plan.arguments).is_ok());
            assert_eq!(plan.limits.stdout_bytes, 64 * 1024);
        }

        for malformed in [
            vec!["rev-parse", "--verify", "HEAD"],
            vec!["rev-parse", "--disambiguate=abc"],
            vec![
                "for-each-ref",
                "--format=%(objectname)",
                "--",
                "refs/heads/main",
            ],
        ] {
            let arguments = SAFE_GLOBAL_ARGUMENTS
                .iter()
                .copied()
                .chain(["-C", repository.to_str().expect("UTF-8 fixture path")])
                .chain(malformed)
                .map(OsString::from)
                .collect::<Vec<_>>();
            assert_eq!(
                validate_approved_arguments(&arguments),
                Err(RunnerError::ForbiddenOperation)
            );
        }
    }

    #[test]
    fn ref_list_operation_allows_only_exact_namespaces_format_and_count() {
        let runner = ProductionGitRunner::new(current_test_executable())
            .expect("test executable should be accepted");
        let repository = std::env::temp_dir().join("ref repository 한글");
        let plan = runner
            .plan(GitOperation::References {
                repository: repository.clone(),
                namespaces: vec![RefNamespace::LocalBranches, RefNamespace::Tags],
                max_records: 501,
            })
            .expect("typed ref query should be approved");

        assert!(validate_approved_arguments(&plan.arguments).is_ok());
        assert_eq!(plan.limits.stdout_bytes, REF_LIST_STDOUT_CAP);
        assert!(
            plan.arguments
                .iter()
                .any(|argument| argument == "--count=501")
        );
        assert!(
            !plan
                .arguments
                .iter()
                .any(|argument| argument == "refs/remotes")
        );

        for malformed in [
            vec![
                "for-each-ref",
                "--format=%(refname)",
                "--sort=refname",
                "--count=10",
                "--",
                "refs/heads",
            ],
            vec![
                "for-each-ref",
                "--format=%(refname)%00%(objectname)%00%(objecttype)%00%(*objectname)%00%(*objecttype)%00",
                "--sort=refname",
                "--count=0",
                "--",
                "refs/heads",
            ],
            vec![
                "for-each-ref",
                "--format=%(refname)%00%(objectname)%00%(objecttype)%00%(*objectname)%00%(*objecttype)%00",
                "--sort=refname",
                "--count=10",
                "--",
                "refs/tags",
                "refs/heads",
            ],
        ] {
            let arguments = SAFE_GLOBAL_ARGUMENTS
                .iter()
                .copied()
                .chain(["-C", repository.to_str().expect("UTF-8 fixture path")])
                .chain(malformed)
                .map(OsString::from)
                .collect::<Vec<_>>();
            assert_eq!(
                validate_approved_arguments(&arguments),
                Err(RunnerError::ForbiddenOperation)
            );
        }
    }

    #[test]
    fn recent_commit_operation_allows_only_metadata_format_full_id_and_bounded_count() {
        let runner = ProductionGitRunner::new(current_test_executable())
            .expect("test executable should be accepted");
        let repository = std::env::temp_dir().join("history repository 한글");
        let commit_id = "1".repeat(40);
        let plan = runner
            .plan(GitOperation::RecentCommits {
                repository: repository.clone(),
                start_commit_id: commit_id.clone(),
                max_records: 51,
            })
            .expect("typed recent commit query should be approved");

        assert!(validate_approved_arguments(&plan.arguments).is_ok());
        assert_eq!(plan.limits.stdout_bytes, HISTORY_STDOUT_CAP);
        assert_eq!(
            plan.arguments,
            SAFE_GLOBAL_ARGUMENTS
                .iter()
                .copied()
                .map(OsString::from)
                .chain([
                    OsString::from("-C"),
                    repository.into_os_string(),
                    OsString::from("log"),
                    OsString::from("--no-decorate"),
                    OsString::from("--no-color"),
                    OsString::from("--no-show-signature"),
                    OsString::from("-z"),
                    OsString::from("--format=%H%x00%at%x00%s"),
                    OsString::from("--max-count=51"),
                    OsString::from(commit_id),
                    OsString::from("--"),
                ])
                .collect::<Vec<_>>()
        );

        for malformed in [
            vec![
                "log",
                "--no-decorate",
                "--no-color",
                "--no-show-signature",
                "-z",
                "--format=%H%x00%at%x00%B",
                "--max-count=51",
                "1111111111111111111111111111111111111111",
                "--",
            ],
            vec![
                "log",
                "--no-decorate",
                "--no-color",
                "--no-show-signature",
                "-z",
                "--format=%H%x00%at%x00%s",
                "--max-count=502",
                "1111111111111111111111111111111111111111",
                "--",
            ],
        ] {
            let arguments = SAFE_GLOBAL_ARGUMENTS
                .iter()
                .copied()
                .chain(["-C", "/tmp/repository"])
                .chain(malformed)
                .map(OsString::from)
                .collect::<Vec<_>>();
            assert_eq!(
                validate_approved_arguments(&arguments),
                Err(RunnerError::ForbiddenOperation)
            );
        }
    }

    #[test]
    fn file_history_operation_allows_only_local_follow_metadata_and_one_literal_path() {
        let runner = ProductionGitRunner::new(current_test_executable())
            .expect("test executable should be accepted");
        let repository = std::env::temp_dir().join("file history repository 한글");
        let commit_id = "2".repeat(40);
        let plan = runner
            .plan(GitOperation::FileHistory {
                repository: repository.clone(),
                start_commit_id: commit_id.clone(),
                path: OsString::from("src/이력 file.txt"),
                max_records: 51,
            })
            .expect("typed file history query should be approved");

        assert!(validate_approved_arguments(&plan.arguments).is_ok());
        assert_eq!(plan.limits.stdout_bytes, HISTORY_STDOUT_CAP);
        assert!(plan.arguments.iter().any(|argument| argument == "--follow"));
        assert!(
            plan.arguments
                .iter()
                .any(|argument| argument == "--no-ext-diff")
        );
        assert!(
            plan.arguments
                .iter()
                .any(|argument| argument == "--no-textconv")
        );
        assert!(!plan.arguments.iter().any(|argument| argument == "--all"));
        assert_eq!(
            plan.arguments.last(),
            Some(&OsString::from("src/이력 file.txt"))
        );

        for malformed in [
            vec![
                "log",
                "--no-decorate",
                "--no-color",
                "--no-show-signature",
                "--no-ext-diff",
                "--no-textconv",
                "--follow",
                "--find-renames",
                "--name-status",
                "-z",
                "--format=%x00%H%x00%at%x00%B",
                "--max-count=51",
                "2222222222222222222222222222222222222222",
                "--",
                "src/file.txt",
            ],
            vec![
                "log",
                "--no-decorate",
                "--no-color",
                "--no-show-signature",
                "--no-ext-diff",
                "--no-textconv",
                "--follow",
                "--find-renames",
                "--name-status",
                "-z",
                "--format=%x00%H%x00%at%x00%s",
                "--max-count=502",
                "2222222222222222222222222222222222222222",
                "--",
                "src/file.txt",
            ],
        ] {
            let arguments = SAFE_GLOBAL_ARGUMENTS
                .iter()
                .copied()
                .chain(["-C", "/tmp/repository"])
                .chain(malformed)
                .map(OsString::from)
                .collect::<Vec<_>>();
            assert_eq!(
                validate_approved_arguments(&arguments),
                Err(RunnerError::ForbiddenOperation)
            );
        }
    }

    #[test]
    fn tree_operation_allows_only_recursive_nul_long_full_tree_query() {
        let runner = ProductionGitRunner::new(current_test_executable())
            .expect("test executable should be accepted");
        let repository = std::env::temp_dir().join("tree repository 한글");
        let commit_id = "a".repeat(40);
        let plan = runner
            .plan(GitOperation::Tree {
                repository: repository.clone(),
                commit_id: commit_id.clone(),
                path_prefix: Some(OsString::from("dir/literal [name]")),
            })
            .expect("typed tree query should be approved");

        assert!(validate_approved_arguments(&plan.arguments).is_ok());
        assert_eq!(plan.limits.stdout_bytes, TREE_LIST_STDOUT_CAP);
        assert_eq!(
            &plan.arguments[SAFE_GLOBAL_ARGUMENTS.len() + 2..],
            &[
                "ls-tree",
                "-r",
                "-z",
                "--long",
                "--full-tree",
                commit_id.as_str(),
                "--",
                "dir/literal [name]",
            ]
            .map(OsString::from)
        );

        for malformed in [
            vec!["ls-tree", "-r", "-z", "--long", "--full-tree", "abcd", "--"],
            vec![
                "ls-tree",
                "-r",
                "-z",
                "--long",
                "--full-tree",
                commit_id.as_str(),
                "--",
                "../escape",
            ],
            vec![
                "ls-tree",
                "-r",
                "-t",
                "-z",
                "--long",
                "--full-tree",
                commit_id.as_str(),
                "--",
            ],
        ] {
            let arguments = SAFE_GLOBAL_ARGUMENTS
                .iter()
                .copied()
                .chain(["-C", repository.to_str().expect("UTF-8 fixture path")])
                .chain(malformed)
                .map(OsString::from)
                .collect::<Vec<_>>();
            assert_eq!(
                validate_approved_arguments(&arguments),
                Err(RunnerError::ForbiddenOperation)
            );
        }
    }

    #[test]
    fn blob_operations_allow_only_type_size_and_raw_blob_queries() {
        let runner = ProductionGitRunner::new(current_test_executable())
            .expect("test executable should be accepted");
        let repository = std::env::temp_dir().join("blob repository 한글");
        let object_id = "b".repeat(40);

        for (query, mode, expected_cap) in [
            (BlobQuery::Type, "-t", 4096),
            (BlobQuery::Size, "-s", 4096),
            (BlobQuery::Content, "blob", BLOB_CONTENT_STDOUT_CAP),
        ] {
            let plan = runner
                .plan(GitOperation::Blob {
                    repository: repository.clone(),
                    object_id: object_id.clone(),
                    query,
                })
                .expect("typed blob query should be approved");
            assert!(validate_approved_arguments(&plan.arguments).is_ok());
            assert_eq!(plan.limits.stdout_bytes, expected_cap);
            assert_eq!(
                &plan.arguments[SAFE_GLOBAL_ARGUMENTS.len() + 2..],
                &["cat-file", mode, object_id.as_str()].map(OsString::from)
            );
        }

        for malformed in [
            vec!["cat-file", "-p", object_id.as_str()],
            vec!["cat-file", "--batch", object_id.as_str()],
            vec!["cat-file", "blob", "abcd"],
        ] {
            let arguments = SAFE_GLOBAL_ARGUMENTS
                .iter()
                .copied()
                .chain(["-C", repository.to_str().expect("UTF-8 fixture path")])
                .chain(malformed)
                .map(OsString::from)
                .collect::<Vec<_>>();
            assert_eq!(
                validate_approved_arguments(&arguments),
                Err(RunnerError::ForbiddenOperation)
            );
        }
    }

    #[test]
    fn changed_file_operation_allows_only_raw_name_status_with_rename_detection() {
        let runner = ProductionGitRunner::new(current_test_executable())
            .expect("test executable should be accepted");
        let repository = std::env::temp_dir().join("changed repository 한글");
        let left = "a".repeat(40);
        let right = "b".repeat(40);
        let plan = runner
            .plan(GitOperation::ChangedFiles {
                repository: repository.clone(),
                left_commit_id: left.clone(),
                right_commit_id: right.clone(),
            })
            .expect("typed changed-file query should be approved");

        assert!(validate_approved_arguments(&plan.arguments).is_ok());
        assert_eq!(plan.limits.stdout_bytes, CHANGED_FILES_STDOUT_CAP);
        assert_eq!(
            &plan.arguments[SAFE_GLOBAL_ARGUMENTS.len() + 2..],
            [
                "diff",
                "--no-ext-diff",
                "--no-textconv",
                "--name-status",
                "-z",
                "--find-renames",
                left.as_str(),
                right.as_str(),
                "--",
            ]
            .map(OsString::from)
        );

        for forbidden in [
            "--ext-diff",
            "--textconv",
            "--find-copies",
            "--submodule=log",
        ] {
            let arguments = SAFE_GLOBAL_ARGUMENTS
                .iter()
                .copied()
                .chain(["-C", repository.to_str().expect("UTF-8 fixture path")])
                .chain([
                    "diff",
                    forbidden,
                    "--name-status",
                    "-z",
                    left.as_str(),
                    right.as_str(),
                    "--",
                ])
                .map(OsString::from)
                .collect::<Vec<_>>();
            assert_eq!(
                validate_approved_arguments(&arguments),
                Err(RunnerError::ForbiddenOperation)
            );
        }
    }

    #[test]
    fn status_operation_allows_only_porcelain_v2_without_optional_locks_or_fsmonitor() {
        let runner = ProductionGitRunner::new(current_test_executable())
            .expect("test executable should be accepted");
        let repository = std::env::temp_dir().join("status repository 한글");
        let plan = runner
            .plan(GitOperation::Status {
                repository: repository.clone(),
            })
            .expect("typed status query should be approved");

        assert!(validate_approved_arguments(&plan.arguments).is_ok());
        assert_eq!(plan.limits.stdout_bytes, STATUS_STDOUT_CAP);
        assert_eq!(
            &plan.arguments[SAFE_GLOBAL_ARGUMENTS.len() + 2..],
            [
                "-c",
                "core.fsmonitor=false",
                "status",
                "--porcelain=v2",
                "-z",
                "--branch",
                "--untracked-files=all",
            ]
            .map(OsString::from)
        );
        assert!(
            plan.arguments
                .contains(&OsString::from("--no-optional-locks"))
        );
        assert_eq!(
            plan.environment.get(OsStr::new("GIT_OPTIONAL_LOCKS")),
            Some(&OsString::from("0"))
        );

        for malformed in [
            vec![
                "-c",
                "core.fsmonitor=true",
                "status",
                "--porcelain=v2",
                "-z",
                "--branch",
                "--untracked-files=all",
            ],
            vec![
                "-c",
                "core.fsmonitor=false",
                "status",
                "--porcelain=v1",
                "-z",
                "--branch",
                "--untracked-files=all",
            ],
            vec![
                "-c",
                "core.fsmonitor=false",
                "status",
                "--porcelain=v2",
                "--branch",
                "--untracked-files=all",
            ],
        ] {
            let arguments = SAFE_GLOBAL_ARGUMENTS
                .iter()
                .copied()
                .chain(["-C", repository.to_str().expect("UTF-8 fixture path")])
                .chain(malformed)
                .map(OsString::from)
                .collect::<Vec<_>>();
            assert_eq!(
                validate_approved_arguments(&arguments),
                Err(RunnerError::ForbiddenOperation)
            );
        }
    }

    #[test]
    fn index_operations_allow_only_stage_zero_metadata_and_ita_visibility_queries() {
        let runner = ProductionGitRunner::new(current_test_executable())
            .expect("test executable should be accepted");
        let repository = std::env::temp_dir().join("index repository 한글");
        let path = OsString::from("dir/literal [name].txt");
        let head = "a".repeat(40);

        let entries = runner
            .plan(GitOperation::IndexEntries {
                repository: repository.clone(),
                path: path.clone(),
            })
            .expect("typed index entry query should be approved");
        assert_eq!(entries.limits.stdout_bytes, INDEX_ENTRY_STDOUT_CAP);
        assert_eq!(
            &entries.arguments[SAFE_GLOBAL_ARGUMENTS.len() + 2..],
            [
                OsString::from("ls-files"),
                OsString::from("-v"),
                OsString::from("--stage"),
                OsString::from("-z"),
                OsString::from("--"),
                path.clone(),
            ]
        );

        let visibility = runner
            .plan(GitOperation::IndexVisibility {
                repository: repository.clone(),
                head_commit_id: head.clone(),
                path: path.clone(),
            })
            .expect("typed intent-to-add visibility query should be approved");
        assert_eq!(visibility.limits.stdout_bytes, INDEX_VISIBILITY_STDOUT_CAP);
        assert_eq!(
            &visibility.arguments[SAFE_GLOBAL_ARGUMENTS.len() + 2..],
            [
                OsString::from("-c"),
                OsString::from("diff.autoRefreshIndex=false"),
                OsString::from("diff"),
                OsString::from("--cached"),
                OsString::from("--raw"),
                OsString::from("-z"),
                OsString::from("--no-ext-diff"),
                OsString::from("--no-textconv"),
                OsString::from("--no-renames"),
                OsString::from("--ita-invisible-in-index"),
                OsString::from(&head),
                OsString::from("--"),
                path,
            ]
        );

        for operation in [
            GitOperation::IndexEntries {
                repository: repository.clone(),
                path: OsString::from("../escape"),
            },
            GitOperation::IndexVisibility {
                repository,
                head_commit_id: "abcd".to_string(),
                path: OsString::from("file.txt"),
            },
        ] {
            assert_eq!(
                runner
                    .plan(operation)
                    .expect_err("malformed query must fail closed"),
                RunnerError::ForbiddenOperation
            );
        }
    }

    #[test]
    fn conflict_operation_allows_only_unmerged_stage_metadata_query() {
        let runner = ProductionGitRunner::new(current_test_executable())
            .expect("test executable should be accepted");
        let repository = std::env::temp_dir().join("conflict repository 한글");
        let plan = runner
            .plan(GitOperation::Conflicts {
                repository: repository.clone(),
            })
            .expect("typed conflict query should be approved");

        assert_eq!(plan.limits.stdout_bytes, CONFLICTS_STDOUT_CAP);
        assert_eq!(
            &plan.arguments[SAFE_GLOBAL_ARGUMENTS.len() + 2..],
            ["ls-files", "--unmerged", "--stage", "-z", "--"].map(OsString::from)
        );

        for malformed in [
            ["ls-files", "-u", "--stage", "-z", "--"],
            ["ls-files", "--unmerged", "--stage", "--debug", "--"],
            ["ls-files", "--unmerged", "--stage", "-z", "path"],
        ] {
            let arguments = SAFE_GLOBAL_ARGUMENTS
                .iter()
                .copied()
                .chain(["-C", repository.to_str().expect("UTF-8 fixture path")])
                .chain(malformed)
                .map(OsString::from)
                .collect::<Vec<_>>();
            assert_eq!(
                validate_approved_arguments(&arguments),
                Err(RunnerError::ForbiddenOperation)
            );
        }
    }

    #[test]
    fn merge_base_operation_allows_only_two_full_local_commit_ids() {
        let runner = ProductionGitRunner::new(current_test_executable())
            .expect("test executable should be accepted");
        let repository = std::env::temp_dir().join("merge base repository 한글");
        let left = "a".repeat(40);
        let right = "b".repeat(40);
        let plan = runner
            .plan(GitOperation::MergeBase {
                repository: repository.clone(),
                left_commit_id: left.clone(),
                right_commit_id: right.clone(),
            })
            .expect("typed merge-base query should be approved");

        assert_eq!(plan.limits.stdout_bytes, MERGE_BASE_STDOUT_CAP);
        assert_eq!(
            &plan.arguments[SAFE_GLOBAL_ARGUMENTS.len() + 2..],
            ["merge-base", "--all", left.as_str(), right.as_str()].map(OsString::from),
        );

        for malformed in [
            vec!["merge-base", left.as_str(), right.as_str()],
            vec!["merge-base", "--octopus", left.as_str(), right.as_str()],
            vec!["merge-base", "--all", "HEAD", right.as_str()],
            vec!["merge-base", "--all", left.as_str(), "--fork-point"],
        ] {
            let arguments = SAFE_GLOBAL_ARGUMENTS
                .iter()
                .copied()
                .chain(["-C", repository.to_str().expect("UTF-8 fixture path")])
                .chain(malformed)
                .map(OsString::from)
                .collect::<Vec<_>>();
            assert_eq!(
                validate_approved_arguments(&arguments),
                Err(RunnerError::ForbiddenOperation),
            );
        }
    }

    #[test]
    fn safe_environment_drops_repository_network_helper_trace_and_path_overrides() {
        let environment = safe_environment_from([
            (OsString::from("HOME"), OsString::from("/safe/home")),
            (OsString::from("PATH"), OsString::from("/poison/bin")),
            (OsString::from("GIT_DIR"), OsString::from("/poison/git-dir")),
            (OsString::from("GIT_CONFIG_COUNT"), OsString::from("1")),
            (
                OsString::from("GIT_SSH_COMMAND"),
                OsString::from("exfiltrate"),
            ),
            (OsString::from("SSH_ASKPASS"), OsString::from("prompt")),
            (
                OsString::from("GIT_TRACE2_EVENT"),
                OsString::from("/tmp/trace"),
            ),
            (
                OsString::from("GIT_EXTERNAL_DIFF"),
                OsString::from("helper"),
            ),
        ]);

        assert_eq!(
            environment.get(OsStr::new("HOME")),
            Some(&OsString::from("/safe/home"))
        );
        for forbidden in [
            "PATH",
            "GIT_DIR",
            "GIT_CONFIG_COUNT",
            "GIT_SSH_COMMAND",
            "SSH_ASKPASS",
            "GIT_TRACE2_EVENT",
            "GIT_EXTERNAL_DIFF",
        ] {
            assert!(
                !environment.contains_key(OsStr::new(forbidden)),
                "inherited {forbidden}"
            );
        }
    }

    #[test]
    fn forbidden_or_unknown_operations_fail_before_process_start() {
        for operation in [
            "checkout",
            "add",
            "commit",
            "config",
            "fetch",
            "push",
            "submodule",
            "maintenance",
            "future-unknown-operation",
        ] {
            let arguments = SAFE_GLOBAL_ARGUMENTS
                .iter()
                .copied()
                .chain([operation])
                .map(OsString::from)
                .collect::<Vec<_>>();

            assert_eq!(
                validate_approved_arguments(&arguments),
                Err(RunnerError::ForbiddenOperation)
            );
        }
    }

    #[test]
    fn drains_stdout_and_stderr_concurrently_without_pipe_deadlock() {
        let output = FixtureGitRunner::run(helper_process(
            "git::runner::tests::fake_concurrent_output_helper",
            generous_limits(),
        ))
        .expect("both streams should drain");

        assert!(output.success);
        assert!(output.stdout.iter().filter(|byte| **byte == b'o').count() >= 128 * 1024);
        assert!(output.stderr.iter().filter(|byte| **byte == b'e').count() >= 128 * 1024);
    }

    #[test]
    fn enforces_separate_stdout_and_stderr_caps() {
        let stdout = FixtureGitRunner::run(helper_process(
            "git::runner::tests::fake_stdout_flood_helper",
            RunnerLimits::for_tests(Duration::from_secs(5), 1024, 512 * 1024),
        ));
        let stderr = FixtureGitRunner::run(helper_process(
            "git::runner::tests::fake_stderr_flood_helper",
            RunnerLimits::for_tests(Duration::from_secs(5), 512 * 1024, 1024),
        ));

        assert_eq!(
            stdout,
            Err(RunnerError::OutputTooLarge(OutputStream::Stdout))
        );
        assert_eq!(
            stderr,
            Err(RunnerError::OutputTooLarge(OutputStream::Stderr))
        );
    }

    #[test]
    fn times_out_and_terminates_the_fake_process() {
        let started = Instant::now();
        let result = FixtureGitRunner::run(helper_process(
            "git::runner::tests::fake_sleep_helper",
            RunnerLimits::for_tests(Duration::from_millis(100), 1024, 1024),
        ));

        assert_eq!(result, Err(RunnerError::TimedOut));
        assert!(started.elapsed() < Duration::from_secs(2));
    }

    #[test]
    fn cancellation_terminates_the_fake_process_and_acknowledges_quickly() {
        let cancellation = CancellationToken::new();
        let child_token = cancellation.clone();
        let handle = thread::spawn(move || {
            FixtureGitRunner::run_with_cancellation(
                helper_process(
                    "git::runner::tests::fake_sleep_helper",
                    RunnerLimits::for_tests(Duration::from_secs(10), 1024, 1024),
                ),
                &child_token,
            )
        });

        thread::sleep(Duration::from_millis(50));
        let started = Instant::now();
        cancellation.cancel();

        assert_eq!(
            handle.join().expect("runner thread should finish"),
            Err(RunnerError::Cancelled)
        );
        assert!(started.elapsed() < Duration::from_secs(1));
    }

    #[cfg(unix)]
    #[test]
    fn timeout_terminates_descendants_in_the_dedicated_process_group() {
        let pid_file = tempfile::NamedTempFile::new().expect("descendant pid file");
        let process = helper_process(
            "git::runner::tests::fake_process_tree_helper",
            RunnerLimits::for_tests(Duration::from_millis(500), 1024, 1024),
        )
        .with_environment(
            "FORKTAIL_RUNNER_DESCENDANT_PID_FILE",
            pid_file.path().as_os_str(),
        );

        assert_eq!(FixtureGitRunner::run(process), Err(RunnerError::TimedOut));
        let pid = fs::read_to_string(pid_file.path())
            .expect("read descendant pid")
            .parse::<i32>()
            .expect("parse descendant pid");
        let deadline = Instant::now() + Duration::from_secs(2);
        while process_exists(pid) && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(10));
        }
        assert!(
            !process_exists(pid),
            "descendant process {pid} survived timeout"
        );
    }

    fn helper_process(test_name: &str, limits: RunnerLimits) -> FixtureProcess {
        FixtureProcess::new(
            current_test_executable(),
            ["--exact", test_name, "--nocapture", "--test-threads=1"],
            limits,
        )
    }

    fn current_test_executable() -> PathBuf {
        std::env::current_exe().expect("test executable path")
    }

    fn generous_limits() -> RunnerLimits {
        RunnerLimits::for_tests(Duration::from_secs(5), 512 * 1024, 512 * 1024)
    }

    #[test]
    fn fake_concurrent_output_helper() {
        if !fake_helper_enabled() {
            return;
        }
        let stdout = thread::spawn(|| write_repeated(io::stdout(), b'o', 128 * 1024));
        let stderr = thread::spawn(|| write_repeated(io::stderr(), b'e', 128 * 1024));
        stdout.join().expect("stdout writer");
        stderr.join().expect("stderr writer");
    }

    #[test]
    fn fake_stdout_flood_helper() {
        if !fake_helper_enabled() {
            return;
        }
        write_repeated(io::stdout(), b'o', 128 * 1024);
    }

    #[test]
    fn fake_stderr_flood_helper() {
        if !fake_helper_enabled() {
            return;
        }
        write_repeated(io::stderr(), b'e', 128 * 1024);
    }

    #[test]
    fn fake_sleep_helper() {
        if !fake_helper_enabled() {
            return;
        }
        thread::sleep(Duration::from_secs(10));
    }

    #[cfg(unix)]
    #[test]
    fn fake_process_tree_helper() {
        if !fake_helper_enabled() {
            return;
        }
        let pid_file = std::env::var_os("FORKTAIL_RUNNER_DESCENDANT_PID_FILE")
            .expect("descendant pid file environment");
        let mut descendant = Command::new(current_test_executable())
            .args([
                "--exact",
                "git::runner::tests::fake_sleep_helper",
                "--nocapture",
                "--test-threads=1",
            ])
            .env("FORKTAIL_RUNNER_TEST_HELPER", "1")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn descendant helper");
        let descendant_pid = descendant.id();
        thread::spawn(move || {
            let _ = descendant.wait();
        });
        fs::write(pid_file, descendant_pid.to_string()).expect("write descendant pid");
        thread::sleep(Duration::from_secs(10));
    }

    fn fake_helper_enabled() -> bool {
        std::env::var_os("FORKTAIL_RUNNER_TEST_HELPER").as_deref() == Some(OsStr::new("1"))
    }

    #[cfg(unix)]
    fn process_exists(pid: i32) -> bool {
        // SAFETY: signal 0 probes existence and does not modify the target process.
        (unsafe { super::unix_kill(pid, 0) }) == 0
    }

    fn write_repeated(mut output: impl Write, byte: u8, count: usize) {
        let bytes = vec![byte; count];
        output.write_all(&bytes).expect("write fake output");
        output.flush().expect("flush fake output");
    }
}
