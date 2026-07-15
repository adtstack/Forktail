use crate::domain::git::{GitBlobContent, GitBlobDocument, GitObjectId};
use crate::git::repository::GitRepositorySession;
use crate::git::runner::{BlobQuery, CancellationToken, GitOperation, RunnerError, RunnerOutput};
use crate::text::{DecodedTextContent, MAX_TEXT_BYTES, decode_text_bytes};

pub const MAX_GIT_BLOB_BYTES: u64 = MAX_TEXT_BYTES;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum BlobSizePlan {
    Read,
    TooLarge,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GitBlobError {
    Runner(RunnerError),
    InvalidObjectId,
    ObjectMissingLocal,
    ObjectTypeUnsupported,
    InvalidOutput,
    SizeMismatch { expected: u64, actual: u64 },
}

pub fn read_blob(
    session: &GitRepositorySession,
    object_id: &GitObjectId,
    cancellation: &CancellationToken,
) -> Result<GitBlobDocument, GitBlobError> {
    if object_id.algorithm != session.identity().object_format {
        return Err(GitBlobError::InvalidObjectId);
    }
    read_blob_with(object_id, |query| {
        session.executable().runner().run(
            GitOperation::Blob {
                repository: session.identity().root.clone(),
                object_id: object_id.hex.clone(),
                query,
            },
            cancellation,
        )
    })
}

fn read_blob_with<Query>(
    object_id: &GitObjectId,
    mut query: Query,
) -> Result<GitBlobDocument, GitBlobError>
where
    Query: FnMut(BlobQuery) -> Result<RunnerOutput, RunnerError>,
{
    let object_type = query(BlobQuery::Type).map_err(GitBlobError::Runner)?;
    if !object_type.success {
        return Err(GitBlobError::ObjectMissingLocal);
    }
    if parse_single_line(&object_type.stdout)? != b"blob" {
        return Err(GitBlobError::ObjectTypeUnsupported);
    }

    let size = query(BlobQuery::Size).map_err(GitBlobError::Runner)?;
    if !size.success {
        return Err(GitBlobError::ObjectMissingLocal);
    }
    let size = parse_blob_size(&size.stdout)?;
    if plan_blob_size(size) == BlobSizePlan::TooLarge {
        return Ok(GitBlobDocument {
            object_id: object_id.clone(),
            size,
            content: GitBlobContent::TooLarge,
        });
    }

    let content = query(BlobQuery::Content).map_err(GitBlobError::Runner)?;
    if !content.success {
        return Err(GitBlobError::ObjectMissingLocal);
    }
    let actual = u64::try_from(content.stdout.len()).map_err(|_| GitBlobError::InvalidOutput)?;
    if actual != size {
        return Err(GitBlobError::SizeMismatch {
            expected: size,
            actual,
        });
    }
    let content = match decode_text_bytes(&content.stdout) {
        DecodedTextContent::Binary => GitBlobContent::Binary,
        DecodedTextContent::Text(decoded) => GitBlobContent::Text {
            text: decoded.text,
            encoding: decoded.encoding,
            line_ending: decoded.line_ending,
            had_final_newline: decoded.had_final_newline,
            decode_had_errors: decoded.decode_had_errors,
        },
    };
    Ok(GitBlobDocument {
        object_id: object_id.clone(),
        size,
        content,
    })
}

fn parse_single_line(output: &[u8]) -> Result<&[u8], GitBlobError> {
    if !output.ends_with(b"\n") || output[..output.len() - 1].contains(&b'\n') {
        return Err(GitBlobError::InvalidOutput);
    }
    let line = &output[..output.len() - 1];
    if line.is_empty() || !line.is_ascii() || line.iter().any(|byte| byte.is_ascii_control()) {
        return Err(GitBlobError::InvalidOutput);
    }
    Ok(line)
}

fn parse_blob_size(output: &[u8]) -> Result<u64, GitBlobError> {
    let size = parse_single_line(output)?;
    if !size.iter().all(u8::is_ascii_digit) {
        return Err(GitBlobError::InvalidOutput);
    }
    std::str::from_utf8(size)
        .map_err(|_| GitBlobError::InvalidOutput)?
        .parse::<u64>()
        .map_err(|_| GitBlobError::InvalidOutput)
}

fn plan_blob_size(size: u64) -> BlobSizePlan {
    if size <= MAX_GIT_BLOB_BYTES {
        BlobSizePlan::Read
    } else {
        BlobSizePlan::TooLarge
    }
}

#[cfg(test)]
mod tests {
    use super::{
        BlobSizePlan, GitBlobError, MAX_GIT_BLOB_BYTES, plan_blob_size, read_blob, read_blob_with,
    };
    use crate::domain::git::{GitBlobContent, GitObjectAlgorithm, GitObjectId};
    use crate::domain::models::LineEnding;
    use crate::git::executable::ValidatedGitExecutable;
    use crate::git::repository::GitRepositorySession;
    use crate::git::runner::{BlobQuery, CancellationToken, RunnerError, RunnerOutput};
    use std::collections::VecDeque;
    use std::ffi::OsStr;
    use std::fs;
    use std::io::Write;
    use std::path::PathBuf;
    use std::process::{Command, Output, Stdio};
    use std::sync::MutexGuard;
    use tempfile::{TempDir, tempdir};

    const OBJECT_ID: &str = "1111111111111111111111111111111111111111";

    struct FakeQueries {
        responses: VecDeque<(BlobQuery, Result<RunnerOutput, RunnerError>)>,
    }

    impl FakeQueries {
        fn new(responses: Vec<(BlobQuery, Result<RunnerOutput, RunnerError>)>) -> Self {
            Self {
                responses: responses.into(),
            }
        }

        fn run(&mut self, query: BlobQuery) -> Result<RunnerOutput, RunnerError> {
            let (expected, response) = self.responses.pop_front().expect("unexpected blob query");
            assert_eq!(query, expected);
            response
        }

        fn assert_exhausted(&self) {
            assert!(self.responses.is_empty(), "unconsumed blob queries");
        }
    }

    fn output(success: bool, stdout: impl Into<Vec<u8>>) -> Result<RunnerOutput, RunnerError> {
        Ok(RunnerOutput {
            success,
            exit_code: Some(if success { 0 } else { 128 }),
            stdout: stdout.into(),
            stderr: b"localized backend detail".to_vec(),
        })
    }

    fn object_id() -> GitObjectId {
        GitObjectId::try_new(GitObjectAlgorithm::Sha1, OBJECT_ID).expect("fixture object ID")
    }

    #[test]
    fn reads_type_then_size_then_exact_utf8_content() {
        let mut fake = FakeQueries::new(vec![
            (BlobQuery::Type, output(true, b"blob\n".to_vec())),
            (BlobQuery::Size, output(true, b"6\n".to_vec())),
            (BlobQuery::Content, output(true, b"hello\n".to_vec())),
        ]);

        let document =
            read_blob_with(&object_id(), |query| fake.run(query)).expect("text blob document");
        assert_eq!(document.size, 6);
        let GitBlobContent::Text {
            text,
            encoding,
            line_ending,
            had_final_newline,
            decode_had_errors,
        } = document.content
        else {
            panic!("expected text content");
        };
        assert_eq!(text, "hello\n");
        assert_eq!(encoding, "UTF-8");
        assert_eq!(line_ending, LineEnding::Lf);
        assert!(had_final_newline);
        assert!(!decode_had_errors);
        fake.assert_exhausted();
    }

    #[test]
    fn shares_utf16_and_binary_classification_with_file_loader() {
        let utf16 = [0xFF, 0xFE, b'a', 0, b'\n', 0];
        let mut utf16_fake = FakeQueries::new(vec![
            (BlobQuery::Type, output(true, b"blob\n".to_vec())),
            (BlobQuery::Size, output(true, b"6\n".to_vec())),
            (BlobQuery::Content, output(true, utf16.to_vec())),
        ]);
        let utf16_document =
            read_blob_with(&object_id(), |query| utf16_fake.run(query)).expect("UTF-16 blob");
        assert!(matches!(
            utf16_document.content,
            GitBlobContent::Text {
                ref text,
                ref encoding,
                line_ending: LineEnding::Lf,
                had_final_newline: true,
                decode_had_errors: false,
            } if text == "a\n" && encoding == "UTF-16LE BOM"
        ));

        let mut binary_fake = FakeQueries::new(vec![
            (BlobQuery::Type, output(true, b"blob\n".to_vec())),
            (BlobQuery::Size, output(true, b"11\n".to_vec())),
            (BlobQuery::Content, output(true, b"text\0binary".to_vec())),
        ]);
        let binary =
            read_blob_with(&object_id(), |query| binary_fake.run(query)).expect("binary metadata");
        assert_eq!(binary.content, GitBlobContent::Binary);
    }

    #[test]
    fn enforces_64_mib_boundary_before_content_read() {
        assert_eq!(plan_blob_size(MAX_GIT_BLOB_BYTES), BlobSizePlan::Read);
        assert_eq!(
            plan_blob_size(MAX_GIT_BLOB_BYTES + 1),
            BlobSizePlan::TooLarge
        );

        let oversized = MAX_GIT_BLOB_BYTES + 1;
        let mut fake = FakeQueries::new(vec![
            (BlobQuery::Type, output(true, b"blob\n".to_vec())),
            (
                BlobQuery::Size,
                output(true, format!("{oversized}\n").into_bytes()),
            ),
        ]);
        let document =
            read_blob_with(&object_id(), |query| fake.run(query)).expect("too-large metadata");
        assert_eq!(document.size, oversized);
        assert_eq!(document.content, GitBlobContent::TooLarge);
        fake.assert_exhausted();
    }

    #[test]
    fn rejects_missing_non_blob_truncated_and_size_mismatch_without_stderr_parsing() {
        let cases = [
            (
                vec![(BlobQuery::Type, output(false, Vec::new()))],
                GitBlobError::ObjectMissingLocal,
            ),
            (
                vec![(BlobQuery::Type, output(true, b"tree\n".to_vec()))],
                GitBlobError::ObjectTypeUnsupported,
            ),
            (
                vec![(BlobQuery::Type, output(true, b"blob".to_vec()))],
                GitBlobError::InvalidOutput,
            ),
            (
                vec![
                    (BlobQuery::Type, output(true, b"blob\n".to_vec())),
                    (BlobQuery::Size, output(true, b"4\n".to_vec())),
                    (BlobQuery::Content, output(true, b"abc".to_vec())),
                ],
                GitBlobError::SizeMismatch {
                    expected: 4,
                    actual: 3,
                },
            ),
        ];
        for (responses, expected) in cases {
            let mut fake = FakeQueries::new(responses);
            assert_eq!(
                read_blob_with(&object_id(), |query| fake.run(query)),
                Err(expected)
            );
        }
    }

    #[test]
    fn temp_repository_reads_utf8_utf16_and_binary_objects_without_mutation() {
        let _fixture_guard = git_fixture_guard();
        let fixture = BlobFixture::new();
        let session = fixture.session("blob-session");
        let before = fixture.fingerprint();
        let utf8 = fixture.write_blob(b"hello\n");
        let utf16 = fixture.write_blob(&[0xFF, 0xFE, b'a', 0, b'\n', 0]);
        let binary = fixture.write_blob(b"binary\0bytes");

        let utf8_document =
            read_blob(&session, &utf8, &CancellationToken::new()).expect("UTF-8 object");
        assert!(matches!(
            utf8_document.content,
            GitBlobContent::Text { ref text, .. } if text == "hello\n"
        ));
        let utf16_document =
            read_blob(&session, &utf16, &CancellationToken::new()).expect("UTF-16 object");
        assert!(matches!(
            utf16_document.content,
            GitBlobContent::Text { ref encoding, .. } if encoding == "UTF-16LE BOM"
        ));
        assert_eq!(
            read_blob(&session, &binary, &CancellationToken::new())
                .expect("binary object")
                .content,
            GitBlobContent::Binary
        );
        assert_eq!(fixture.fingerprint(), before);
    }

    fn git_fixture_guard() -> MutexGuard<'static, ()> {
        crate::git::GIT_FIXTURE_LOCK
            .lock()
            .expect("Git fixture lock")
    }

    #[derive(Debug, PartialEq, Eq)]
    struct BlobFingerprint {
        head: Vec<u8>,
        index: Vec<u8>,
        config: Vec<u8>,
    }

    struct BlobFixture {
        _temp: TempDir,
        repository: PathBuf,
        home: PathBuf,
        git: PathBuf,
    }

    impl BlobFixture {
        fn new() -> Self {
            let temp = tempdir().expect("blob fixture root");
            let repository = temp.path().join("Blob Repository 한글");
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
            fs::write(fixture.repository.join("seed.txt"), b"seed\n").expect("seed file");
            fixture.run(["add", "--", "seed.txt"]);
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

        fn write_blob(&self, bytes: &[u8]) -> GitObjectId {
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
            let hex = String::from_utf8(output.stdout)
                .expect("blob object ID")
                .trim()
                .to_string();
            GitObjectId::try_new(GitObjectAlgorithm::Sha1, hex).expect("valid blob ID")
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

        fn fingerprint(&self) -> BlobFingerprint {
            let git_dir = self.repository.join(".git");
            BlobFingerprint {
                head: fs::read(git_dir.join("HEAD")).expect("HEAD fingerprint"),
                index: fs::read(git_dir.join("index")).expect("index fingerprint"),
                config: fs::read(git_dir.join("config")).expect("config fingerprint"),
            }
        }

        fn run<I, S>(&self, arguments: I) -> Output
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
