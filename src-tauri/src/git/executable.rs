use crate::git::runner::{
    CancellationToken, GitOperation, ProductionGitRunner, RunnerError, RunnerOutput,
};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitVersion {
    pub major: u32,
    pub minor: u32,
    pub patch: u32,
}

impl GitVersion {
    pub const fn new(major: u32, minor: u32, patch: u32) -> Self {
        Self {
            major,
            minor,
            patch,
        }
    }
}

pub const MINIMUM_GIT_VERSION: GitVersion = GitVersion::new(2, 45, 0);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DiscoveryPlatform {
    Windows,
    MacOs,
    Linux,
}

impl DiscoveryPlatform {
    fn executable_name(self) -> &'static str {
        match self {
            Self::Windows => "git.exe",
            Self::MacOs | Self::Linux => "git",
        }
    }

    fn current() -> Self {
        if cfg!(target_os = "windows") {
            Self::Windows
        } else if cfg!(target_os = "macos") {
            Self::MacOs
        } else {
            Self::Linux
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GitExecutableError {
    NotFound,
    ConfiguredPathNotAbsolute,
    NotRegularFile,
    NotExecutable,
    InvalidVersionOutput,
    VersionTooOld {
        found: GitVersion,
        minimum: GitVersion,
    },
    CapabilityUnsupported,
    Probe(RunnerError),
}

#[derive(Debug)]
pub struct ValidatedGitExecutable {
    path: PathBuf,
    version: GitVersion,
    runner: ProductionGitRunner,
}

impl ValidatedGitExecutable {
    pub fn discover(configured_path: Option<PathBuf>) -> Result<Self, GitExecutableError> {
        let path_directories = std::env::var_os("PATH")
            .map(|value| std::env::split_paths(&value).collect::<Vec<_>>())
            .unwrap_or_default();
        let path = resolve_executable_with(
            configured_path,
            path_directories,
            DiscoveryPlatform::current(),
            inspect_executable_path,
        )?;
        let runner = ProductionGitRunner::new(path.clone()).map_err(GitExecutableError::Probe)?;
        let output = runner
            .run(GitOperation::Version, &CancellationToken::new())
            .map_err(GitExecutableError::Probe)?;
        let version = validate_version_probe(&output)?;

        Ok(Self {
            path,
            version,
            runner,
        })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn version(&self) -> GitVersion {
        self.version
    }

    pub fn runner(&self) -> &ProductionGitRunner {
        &self.runner
    }
}

fn resolve_executable_with<Directories, Inspect>(
    configured_path: Option<PathBuf>,
    path_directories: Directories,
    platform: DiscoveryPlatform,
    mut inspect: Inspect,
) -> Result<PathBuf, GitExecutableError>
where
    Directories: IntoIterator<Item = PathBuf>,
    Inspect: FnMut(&Path) -> Result<PathBuf, GitExecutableError>,
{
    if let Some(configured_path) = configured_path {
        if !configured_path.is_absolute() {
            return Err(GitExecutableError::ConfiguredPathNotAbsolute);
        }
        return inspect(&configured_path);
    }

    let mut first_invalid_candidate = None;
    for directory in path_directories {
        if !directory.is_absolute() {
            continue;
        }
        let candidate = directory.join(platform.executable_name());
        match inspect(&candidate) {
            Ok(path) => return Ok(path),
            Err(GitExecutableError::NotFound) => {}
            Err(error) => {
                if first_invalid_candidate.is_none() {
                    first_invalid_candidate = Some(error);
                }
            }
        }
    }

    Err(first_invalid_candidate.unwrap_or(GitExecutableError::NotFound))
}

fn inspect_executable_path(path: &Path) -> Result<PathBuf, GitExecutableError> {
    let canonical = fs::canonicalize(path).map_err(|error| match error.kind() {
        std::io::ErrorKind::NotFound => GitExecutableError::NotFound,
        _ => GitExecutableError::NotExecutable,
    })?;
    let metadata = fs::metadata(&canonical).map_err(|_| GitExecutableError::NotExecutable)?;
    if !metadata.is_file() {
        return Err(GitExecutableError::NotRegularFile);
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if metadata.permissions().mode() & 0o111 == 0 {
            return Err(GitExecutableError::NotExecutable);
        }
    }

    Ok(canonical)
}

fn validate_version_probe(output: &RunnerOutput) -> Result<GitVersion, GitExecutableError> {
    if !output.success {
        return Err(GitExecutableError::CapabilityUnsupported);
    }
    let version = parse_git_version(&output.stdout)?;
    if version < MINIMUM_GIT_VERSION {
        return Err(GitExecutableError::VersionTooOld {
            found: version,
            minimum: MINIMUM_GIT_VERSION,
        });
    }
    Ok(version)
}

fn parse_git_version(output: &[u8]) -> Result<GitVersion, GitExecutableError> {
    let output = std::str::from_utf8(output)
        .map_err(|_| GitExecutableError::InvalidVersionOutput)?
        .trim_end_matches(['\r', '\n']);
    if output.contains(['\r', '\n']) {
        return Err(GitExecutableError::InvalidVersionOutput);
    }
    let version_and_vendor = output
        .strip_prefix("git version ")
        .ok_or(GitExecutableError::InvalidVersionOutput)?;
    let token = version_and_vendor
        .split_whitespace()
        .next()
        .ok_or(GitExecutableError::InvalidVersionOutput)?;
    let mut components = token.splitn(3, '.');
    let major = parse_numeric_component(components.next())?;
    let minor = parse_numeric_component(components.next())?;
    let patch_and_suffix = components
        .next()
        .ok_or(GitExecutableError::InvalidVersionOutput)?;
    let patch_length = patch_and_suffix
        .bytes()
        .take_while(u8::is_ascii_digit)
        .count();
    if patch_length == 0 {
        return Err(GitExecutableError::InvalidVersionOutput);
    }
    let patch = patch_and_suffix[..patch_length]
        .parse::<u32>()
        .map_err(|_| GitExecutableError::InvalidVersionOutput)?;
    let suffix = &patch_and_suffix[patch_length..];
    if !suffix.is_empty()
        && (suffix.len() == 1 || !matches!(suffix.as_bytes()[0], b'.' | b'-' | b'+'))
    {
        return Err(GitExecutableError::InvalidVersionOutput);
    }

    Ok(GitVersion::new(major, minor, patch))
}

fn parse_numeric_component(component: Option<&str>) -> Result<u32, GitExecutableError> {
    let component = component.ok_or(GitExecutableError::InvalidVersionOutput)?;
    if component.is_empty() || !component.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(GitExecutableError::InvalidVersionOutput);
    }
    component
        .parse::<u32>()
        .map_err(|_| GitExecutableError::InvalidVersionOutput)
}

#[cfg(test)]
mod tests {
    use super::{
        DiscoveryPlatform, GitExecutableError, GitVersion, MINIMUM_GIT_VERSION,
        inspect_executable_path, parse_git_version, resolve_executable_with,
        validate_version_probe,
    };
    use crate::git::runner::RunnerOutput;
    use std::fs;
    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;
    use std::path::{Path, PathBuf};
    use tempfile::{NamedTempFile, tempdir};

    fn successful_probe(stdout: impl Into<Vec<u8>>) -> RunnerOutput {
        RunnerOutput {
            success: true,
            exit_code: Some(0),
            stdout: stdout.into(),
            stderr: Vec::new(),
        }
    }

    #[test]
    fn parses_release_and_vendor_git_versions_without_locale_or_suffix_assumptions() {
        let cases = [
            (
                b"git version 2.45.0\n".as_slice(),
                GitVersion::new(2, 45, 0),
            ),
            (
                b"git version 2.46.2.windows.1\r\n".as_slice(),
                GitVersion::new(2, 46, 2),
            ),
            (
                b"git version 2.50.1 (Apple Git-155)\n".as_slice(),
                GitVersion::new(2, 50, 1),
            ),
            (
                b"git version 2.45.0.rc1\n".as_slice(),
                GitVersion::new(2, 45, 0),
            ),
        ];

        for (output, expected) in cases {
            assert_eq!(parse_git_version(output), Ok(expected));
        }
        assert_eq!(MINIMUM_GIT_VERSION, GitVersion::new(2, 45, 0));
    }

    #[test]
    fn rejects_old_malformed_or_failed_capability_probes_without_parsing_stderr() {
        assert_eq!(
            validate_version_probe(&successful_probe(b"git version 2.44.99\n".to_vec())),
            Err(GitExecutableError::VersionTooOld {
                found: GitVersion::new(2, 44, 99),
                minimum: MINIMUM_GIT_VERSION,
            })
        );
        assert_eq!(
            validate_version_probe(&successful_probe(b"git version two.forty.five\n".to_vec())),
            Err(GitExecutableError::InvalidVersionOutput)
        );
        assert_eq!(
            validate_version_probe(&successful_probe(
                b"git version 2.45.0\nunexpected second line\n".to_vec()
            )),
            Err(GitExecutableError::InvalidVersionOutput)
        );
        assert_eq!(
            validate_version_probe(&successful_probe(vec![0xff, 0xfe])),
            Err(GitExecutableError::InvalidVersionOutput)
        );
        assert_eq!(
            validate_version_probe(&RunnerOutput {
                success: false,
                exit_code: Some(129),
                stdout: Vec::new(),
                stderr: b"secret localized unsupported-option details".to_vec(),
            }),
            Err(GitExecutableError::CapabilityUnsupported)
        );
    }

    #[test]
    fn builds_predictable_windows_macos_and_linux_path_candidates() {
        let root = tempdir().expect("native absolute temp root");
        let cases = [
            (
                DiscoveryPlatform::Windows,
                root.path().join("Program Files Git cmd Unicode-한글"),
                "git.exe",
            ),
            (
                DiscoveryPlatform::MacOs,
                root.path()
                    .join("Applications Developer Tools Unicode-한글"),
                "git",
            ),
            (
                DiscoveryPlatform::Linux,
                root.path().join("home user Tools With Spaces Unicode-한글"),
                "git",
            ),
        ];

        for (platform, directory, executable_name) in cases {
            let expected = directory.join(executable_name);
            let resolved = resolve_executable_with(
                None,
                [PathBuf::from("relative-path-entry"), directory],
                platform,
                |candidate| {
                    if candidate == expected {
                        Ok(candidate.to_path_buf())
                    } else {
                        Err(GitExecutableError::NotFound)
                    }
                },
            )
            .expect("platform candidate");

            assert_eq!(resolved, expected);
        }
    }

    #[test]
    fn configured_path_is_absolute_and_never_falls_back_to_path() {
        let root = tempdir().expect("native absolute temp root");
        let configured = PathBuf::from("relative/git");
        let error = resolve_executable_with(
            Some(configured),
            [root.path().join("valid path bin")],
            DiscoveryPlatform::Linux,
            |_candidate| panic!("relative configured path must fail before inspection"),
        )
        .expect_err("relative configured path");
        assert_eq!(error, GitExecutableError::ConfiguredPathNotAbsolute);

        let missing_absolute = root.path().join("configured missing git");
        let mut inspected = Vec::new();
        let error = resolve_executable_with(
            Some(missing_absolute.clone()),
            [root.path().join("valid path bin")],
            DiscoveryPlatform::Linux,
            |candidate| {
                inspected.push(candidate.to_path_buf());
                Err(GitExecutableError::NotFound)
            },
        )
        .expect_err("missing configured path");

        assert_eq!(error, GitExecutableError::NotFound);
        assert_eq!(inspected, vec![missing_absolute]);
    }

    #[test]
    fn path_search_distinguishes_missing_regular_and_non_executable_candidates() {
        let directory = tempdir().expect("temp directory");
        assert_eq!(
            inspect_executable_path(directory.path()),
            Err(GitExecutableError::NotRegularFile)
        );

        let file = NamedTempFile::new().expect("temp file");
        #[cfg(unix)]
        {
            fs::set_permissions(file.path(), fs::Permissions::from_mode(0o644))
                .expect("remove executable permission");
            assert_eq!(
                inspect_executable_path(file.path()),
                Err(GitExecutableError::NotExecutable)
            );

            fs::set_permissions(file.path(), fs::Permissions::from_mode(0o755))
                .expect("add executable permission");
            assert_eq!(
                inspect_executable_path(file.path()),
                Ok(fs::canonicalize(file.path()).expect("canonical path"))
            );
        }
        #[cfg(windows)]
        assert_eq!(
            inspect_executable_path(file.path()),
            Ok(fs::canonicalize(file.path()).expect("canonical path"))
        );
    }

    #[test]
    fn selected_canonical_path_is_owned_and_unchanged_by_later_search_inputs() {
        let root = tempdir().expect("native absolute temp root");
        let first_directory = root.path().join("first bin");
        let selected = first_directory.join("git");
        let resolved = resolve_executable_with(
            None,
            [first_directory],
            DiscoveryPlatform::Linux,
            |candidate| Ok(candidate.to_path_buf()),
        )
        .expect("selected executable");

        let later_path = [root.path().join("different bin")];
        assert_eq!(resolved, selected);
        assert_ne!(resolved.parent(), Some(later_path[0].as_path()));
        assert!(Path::new(&resolved).is_absolute());
    }
}
