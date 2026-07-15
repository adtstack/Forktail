use crate::domain::git::{GitBlobContent, GitBlobDocument, GitObjectId};
use crate::git::repository::GitRepositorySession;
use crate::git::runner::{BlobQuery, CancellationToken, GitOperation, RunnerError, RunnerOutput};
use crate::text::{DecodedTextContent, MAX_TEXT_BYTES, decode_text_bytes};
use std::collections::{HashMap, VecDeque};
use std::mem::size_of;

pub const MAX_GIT_BLOB_BYTES: u64 = MAX_TEXT_BYTES;
const MAX_LFS_POINTER_BYTES: usize = 1024;
const GIT_BLOB_CACHE_ENTRIES: usize = 64;
const GIT_BLOB_CACHE_BYTES: usize = 128 * 1024 * 1024;

#[derive(Debug)]
struct CachedBlob {
    document: GitBlobDocument,
    memory_bytes: usize,
}

#[derive(Debug)]
pub(crate) struct GitBlobCache {
    entries: HashMap<GitObjectId, CachedBlob>,
    lru: VecDeque<GitObjectId>,
    stored_bytes: usize,
    max_entries: usize,
    max_bytes: usize,
}

impl Default for GitBlobCache {
    fn default() -> Self {
        Self::with_limits(GIT_BLOB_CACHE_ENTRIES, GIT_BLOB_CACHE_BYTES)
    }
}

impl GitBlobCache {
    fn with_limits(max_entries: usize, max_bytes: usize) -> Self {
        Self {
            entries: HashMap::new(),
            lru: VecDeque::new(),
            stored_bytes: 0,
            max_entries,
            max_bytes,
        }
    }

    fn get(&mut self, object_id: &GitObjectId) -> Option<GitBlobDocument> {
        let document = self.entries.get(object_id)?.document.clone();
        self.lru.retain(|candidate| candidate != object_id);
        self.lru.push_back(object_id.clone());
        Some(document)
    }

    fn insert(&mut self, document: GitBlobDocument) -> bool {
        let memory_bytes = blob_document_memory_bytes(&document);
        if self.max_entries == 0 || memory_bytes > self.max_bytes {
            return false;
        }

        self.remove(&document.object_id);
        while self.entries.len() >= self.max_entries
            || self.stored_bytes.saturating_add(memory_bytes) > self.max_bytes
        {
            let Some(oldest) = self.lru.pop_front() else {
                return false;
            };
            if let Some(removed) = self.entries.remove(&oldest) {
                self.stored_bytes = self.stored_bytes.saturating_sub(removed.memory_bytes);
            }
        }

        let object_id = document.object_id.clone();
        self.entries.insert(
            object_id.clone(),
            CachedBlob {
                document,
                memory_bytes,
            },
        );
        self.lru.push_back(object_id);
        self.stored_bytes = self.stored_bytes.saturating_add(memory_bytes);
        true
    }

    fn remove(&mut self, object_id: &GitObjectId) {
        if let Some(removed) = self.entries.remove(object_id) {
            self.stored_bytes = self.stored_bytes.saturating_sub(removed.memory_bytes);
        }
        self.lru.retain(|candidate| candidate != object_id);
    }

    #[cfg(test)]
    fn len(&self) -> usize {
        self.entries.len()
    }

    #[cfg(test)]
    fn stored_bytes(&self) -> usize {
        self.stored_bytes
    }
}

fn blob_document_memory_bytes(document: &GitBlobDocument) -> usize {
    let content_bytes = match &document.content {
        GitBlobContent::Text { text, encoding, .. } => {
            text.capacity().saturating_add(encoding.capacity())
        }
        GitBlobContent::LfsPointer { oid_sha256, .. } => oid_sha256.capacity(),
        GitBlobContent::Binary | GitBlobContent::TooLarge => 0,
    };
    size_of::<CachedBlob>()
        .saturating_add(size_of::<GitObjectId>().saturating_mul(2))
        .saturating_add(document.object_id.hex.capacity().saturating_mul(3))
        .saturating_add(content_bytes)
        .saturating_add(128)
}

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
    CacheUnavailable,
}

pub fn read_blob(
    session: &GitRepositorySession,
    object_id: &GitObjectId,
    cancellation: &CancellationToken,
) -> Result<GitBlobDocument, GitBlobError> {
    if object_id.algorithm != session.identity().object_format {
        return Err(GitBlobError::InvalidObjectId);
    }
    if cancellation.is_cancelled() {
        return Err(GitBlobError::Runner(RunnerError::Cancelled));
    }
    if let Some(document) = session
        .blob_cache()
        .lock()
        .map_err(|_| GitBlobError::CacheUnavailable)?
        .get(object_id)
    {
        return Ok(document);
    }

    let document = read_blob_with(object_id, |query| {
        session.executable().runner().run(
            GitOperation::Blob {
                repository: session.identity().root.clone(),
                object_id: object_id.hex.clone(),
                query,
            },
            cancellation,
        )
    })?;
    session
        .blob_cache()
        .lock()
        .map_err(|_| GitBlobError::CacheUnavailable)?
        .insert(document.clone());
    Ok(document)
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
    let content = if let Some(pointer) = parse_lfs_pointer(&content.stdout) {
        GitBlobContent::LfsPointer {
            oid_sha256: pointer.oid_sha256,
            referenced_size: pointer.referenced_size,
        }
    } else {
        match decode_text_bytes(&content.stdout) {
            DecodedTextContent::Binary => GitBlobContent::Binary,
            DecodedTextContent::Text(decoded) => GitBlobContent::Text {
                text: decoded.text,
                encoding: decoded.encoding,
                line_ending: decoded.line_ending,
                had_final_newline: decoded.had_final_newline,
                decode_had_errors: decoded.decode_had_errors,
            },
        }
    };
    Ok(GitBlobDocument {
        object_id: object_id.clone(),
        size,
        content,
    })
}

struct LfsPointer {
    oid_sha256: String,
    referenced_size: u64,
}

fn parse_lfs_pointer(bytes: &[u8]) -> Option<LfsPointer> {
    if bytes.len() > MAX_LFS_POINTER_BYTES {
        return None;
    }
    let text = std::str::from_utf8(bytes).ok()?;
    if text.contains('\r') {
        return None;
    }
    let text = text.strip_suffix('\n').unwrap_or(text);
    let mut lines = text.split('\n');
    if lines.next()? != "version https://git-lfs.github.com/spec/v1" {
        return None;
    }
    let oid_sha256 = lines.next()?.strip_prefix("oid sha256:")?;
    if oid_sha256.len() != 64
        || !oid_sha256
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return None;
    }
    let size = lines.next()?.strip_prefix("size ")?;
    if lines.next().is_some()
        || size.is_empty()
        || !size.bytes().all(|byte| byte.is_ascii_digit())
        || (size.len() > 1 && size.starts_with('0'))
    {
        return None;
    }
    Some(LfsPointer {
        oid_sha256: oid_sha256.to_string(),
        referenced_size: size.parse().ok()?,
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
        BlobSizePlan, GitBlobCache, GitBlobError, MAX_GIT_BLOB_BYTES, plan_blob_size, read_blob,
        read_blob_with,
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

    fn object_id_filled(algorithm: GitObjectAlgorithm, byte: char) -> GitObjectId {
        let length = match algorithm {
            GitObjectAlgorithm::Sha256 => 64,
            GitObjectAlgorithm::Sha1 | GitObjectAlgorithm::Unknown => 40,
        };
        GitObjectId::try_new(algorithm, byte.to_string().repeat(length)).expect("fixture object ID")
    }

    fn fake_blob_document(bytes: &[u8]) -> crate::GitBlobDocument {
        let mut fake = FakeQueries::new(vec![
            (BlobQuery::Type, output(true, b"blob\n".to_vec())),
            (
                BlobQuery::Size,
                output(true, format!("{}\n", bytes.len()).into_bytes()),
            ),
            (BlobQuery::Content, output(true, bytes.to_vec())),
        ]);
        let document =
            read_blob_with(&object_id(), |query| fake.run(query)).expect("blob document");
        fake.assert_exhausted();
        document
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
    fn classifies_only_canonical_lfs_pointers_as_metadata() {
        let oid = "a".repeat(64);
        let pointer =
            format!("version https://git-lfs.github.com/spec/v1\noid sha256:{oid}\nsize 123456\n");
        assert!(matches!(
            fake_blob_document(pointer.as_bytes()).content,
            GitBlobContent::LfsPointer {
                ref oid_sha256,
                referenced_size: 123456,
            } if oid_sha256 == &oid
        ));

        for near_miss in [
            pointer.replace("spec/v1", "spec/v2"),
            pointer.replace("oid sha256:a", "oid sha256:z"),
            pointer.replace("size 123456", "size -1"),
            format!("{pointer}unexpected metadata\n"),
        ] {
            assert!(matches!(
                fake_blob_document(near_miss.as_bytes()).content,
                GitBlobContent::Text { .. }
            ));
        }
    }

    #[test]
    fn blob_cache_is_algorithm_aware_lru_and_memory_bounded() {
        let sha1 = object_id_filled(GitObjectAlgorithm::Sha1, 'a');
        let unknown_same_hex = object_id_filled(GitObjectAlgorithm::Unknown, 'a');
        let third = object_id_filled(GitObjectAlgorithm::Sha1, 'b');
        let mut cache = GitBlobCache::with_limits(2, 16 * 1024);

        assert!(cache.insert(text_document(sha1.clone(), "first")));
        assert!(cache.insert(text_document(unknown_same_hex.clone(), "second")));
        assert_eq!(
            cache.get(&sha1).map(|document| document.object_id),
            Some(sha1.clone())
        );
        assert!(cache.insert(text_document(third.clone(), "third")));

        assert!(
            cache.get(&unknown_same_hex).is_none(),
            "least-recent entry is evicted"
        );
        assert!(cache.get(&sha1).is_some(), "recent entry is retained");
        assert!(cache.get(&third).is_some());
        assert_eq!(cache.len(), 2);
        assert!(cache.stored_bytes() <= 16 * 1024);

        let mut byte_bounded = GitBlobCache::with_limits(8, 128);
        assert!(!byte_bounded.insert(text_document(
            object_id_filled(GitObjectAlgorithm::Sha256, 'c'),
            &"content".repeat(128),
        )));
        assert_eq!(byte_bounded.len(), 0);
        assert_eq!(byte_bounded.stored_bytes(), 0);
    }

    fn text_document(object_id: GitObjectId, text: &str) -> crate::GitBlobDocument {
        crate::GitBlobDocument {
            object_id,
            size: text.len() as u64,
            content: GitBlobContent::Text {
                text: text.to_string(),
                encoding: "UTF-8".to_string(),
                line_ending: LineEnding::None,
                had_final_newline: false,
                decode_had_errors: false,
            },
        }
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

    #[test]
    fn immutable_blob_cache_is_scoped_to_one_repository_session() {
        let _fixture_guard = git_fixture_guard();
        let fixture = BlobFixture::new();
        let session = fixture.session("cached-session");
        let object_id = fixture.write_blob(b"cached content\n");
        let expected = read_blob(&session, &object_id, &CancellationToken::new())
            .expect("first read populates cache");
        fixture.remove_loose_object(&object_id);

        assert_eq!(
            read_blob(&session, &object_id, &CancellationToken::new()),
            Ok(expected),
            "same session reuses immutable content"
        );
        let fresh_session = fixture.session("fresh-session");
        assert_eq!(
            read_blob(&fresh_session, &object_id, &CancellationToken::new()),
            Err(GitBlobError::ObjectMissingLocal),
            "a new session cannot see the old in-memory cache"
        );
    }

    #[cfg(unix)]
    #[test]
    fn missing_promisor_blob_does_not_invoke_remote_helper() {
        let _fixture_guard = git_fixture_guard();
        let fixture = BlobFixture::new();
        let object_id = fixture.write_blob(b"promised but absent\n");
        let helper_marker = fixture.configure_promisor_remote(&object_id);
        let session = fixture.session("partial-clone-session");
        let before = fixture.fingerprint();

        assert_eq!(
            read_blob(&session, &object_id, &CancellationToken::new()),
            Err(GitBlobError::ObjectMissingLocal)
        );
        assert!(
            !helper_marker.exists(),
            "--no-lazy-fetch must prevent any remote/helper invocation"
        );
        assert_eq!(fixture.fingerprint(), before);
    }

    #[cfg(unix)]
    #[test]
    fn raw_blob_read_does_not_invoke_filter_textconv_or_lfs_helpers() {
        let _fixture_guard = git_fixture_guard();
        let fixture = BlobFixture::new();
        let helper_marker = fixture.configure_content_helpers();
        let object_id = fixture.write_blob(b"raw repository content\n");
        let session = fixture.session("raw-content-session");
        let before = fixture.fingerprint();

        assert!(matches!(
            read_blob(&session, &object_id, &CancellationToken::new())
                .expect("raw blob remains locally readable")
                .content,
            GitBlobContent::Text { ref text, .. } if text == "raw repository content\n"
        ));
        assert!(
            !helper_marker.exists(),
            "raw cat-file must not execute filter, textconv, smudge, or LFS helpers"
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

        fn remove_loose_object(&self, object_id: &GitObjectId) {
            let (directory, file) = object_id.hex.split_at(2);
            fs::remove_file(
                self.repository
                    .join(".git/objects")
                    .join(directory)
                    .join(file),
            )
            .expect("remove loose object");
        }

        #[cfg(unix)]
        fn configure_promisor_remote(&self, object_id: &GitObjectId) -> PathBuf {
            use std::os::unix::fs::PermissionsExt;

            let helper = self._temp.path().join("remote-helper-sentinel.sh");
            let marker = self._temp.path().join("remote-helper-invoked");
            fs::write(
                &helper,
                format!("#!/bin/sh\n: > '{}'\nexit 1\n", marker.display()),
            )
            .expect("write sentinel helper");
            let mut permissions = fs::metadata(&helper)
                .expect("helper metadata")
                .permissions();
            permissions.set_mode(0o700);
            fs::set_permissions(&helper, permissions).expect("helper executable mode");

            self.run(["config", "core.repositoryformatversion", "1"]);
            self.run(["config", "extensions.partialClone", "origin"]);
            self.run(["config", "remote.origin.promisor", "true"]);
            self.run(["config", "remote.origin.partialclonefilter", "blob:none"]);
            self.run(["config", "protocol.ext.allow", "always"]);
            let url = format!("ext::{}", helper.display());
            self.run(["config", "remote.origin.url", &url]);
            self.remove_loose_object(object_id);
            marker
        }

        #[cfg(unix)]
        fn configure_content_helpers(&self) -> PathBuf {
            use std::os::unix::fs::PermissionsExt;

            let helper = self._temp.path().join("content-helper-sentinel.sh");
            let marker = self._temp.path().join("content-helper-invoked");
            fs::write(
                &helper,
                format!("#!/bin/sh\n: > '{}'\nexit 1\n", marker.display()),
            )
            .expect("write content helper");
            let mut permissions = fs::metadata(&helper)
                .expect("helper metadata")
                .permissions();
            permissions.set_mode(0o700);
            fs::set_permissions(&helper, permissions).expect("helper executable mode");
            fs::write(
                self.repository.join(".gitattributes"),
                b"*.txt filter=sentinel diff=sentinel\n*.lfs filter=lfs diff=lfs\n",
            )
            .expect("attribute fixture");

            let command = helper.to_string_lossy();
            for key in [
                "filter.sentinel.smudge",
                "filter.sentinel.process",
                "diff.sentinel.textconv",
                "filter.lfs.smudge",
                "filter.lfs.process",
                "diff.lfs.textconv",
            ] {
                self.run(["config", key, command.as_ref()]);
            }
            marker
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
