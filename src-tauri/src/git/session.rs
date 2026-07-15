use crate::domain::git::{
    GitBlobContent, GitBlobDocument, GitChangedFile, GitChangedFileStatus, GitCompareCapabilities,
    GitCompareSession, GitCompareSourceKind, GitPathIdentity, GitPathPlatform,
    GitPathRegistryError, GitRevision, GitRevisionPair, GitSnapshotContentState,
    GitSnapshotDocument, GitSnapshotOrigin, GitSnapshotUnavailableReason, GitTextMetadata,
    GitTreeEntry, GitTreeEntryKind,
};
use crate::git::blob::{GitBlobError, read_blob};
use crate::git::repository::GitRepositorySession;
use crate::git::runner::CancellationToken;
use crate::git::tree::{GitTreeError, list_tree};

const MAX_REVISION_LABEL_BYTES: usize = 1024;
const SNAPSHOT_PATH_LOOKUP_LIMIT: usize = 2;
const SHORT_OBJECT_ID_LENGTH: usize = 12;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GitSessionError {
    InvalidRevision,
    InvalidChangedFile,
    UnsupportedStatus,
    UnknownPath,
    StaleGeneration,
    PathUnsupported,
    PathNotAtRevision,
    StateUnavailable,
    Cancelled,
    Tree(GitTreeError),
    Blob(GitBlobError),
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum SnapshotSidePlan {
    Missing(GitPathIdentity),
    Committed(GitPathIdentity),
}

pub fn open_revision_compare(
    session: &GitRepositorySession,
    left_revision: &GitRevision,
    right_revision: &GitRevision,
    changed_file: &GitChangedFile,
    generation: u64,
    cancellation: &CancellationToken,
) -> Result<GitCompareSession, GitSessionError> {
    if cancellation.is_cancelled() {
        return Err(GitSessionError::Cancelled);
    }
    validate_revision(session, left_revision)?;
    validate_revision(session, right_revision)?;
    validate_generation(session, generation)?;

    let (left_plan, right_plan) = plan_changed_file(changed_file)?;
    let left_plan = canonicalize_plan(session, left_plan, generation)?;
    let right_plan = canonicalize_plan(session, right_plan, generation)?;
    let left = materialize_side(session, left_revision, left_plan, generation, cancellation)?;
    let right = materialize_side(
        session,
        right_revision,
        right_plan,
        generation,
        cancellation,
    )?;
    validate_generation(session, generation)?;

    let export_patch = is_patch_source(&left) && is_patch_source(&right);
    Ok(GitCompareSession {
        repository_id: session.summary().session_id.clone(),
        left,
        right,
        source_kind: GitCompareSourceKind::RevisionPair,
        revision_pair: GitRevisionPair {
            left: left_revision.clone(),
            right: right_revision.clone(),
        },
        capabilities: GitCompareCapabilities {
            edit: false,
            save: false,
            hunk_copy: false,
            export_patch,
        },
        generation,
    })
}

fn plan_changed_file(
    changed_file: &GitChangedFile,
) -> Result<(SnapshotSidePlan, SnapshotSidePlan), GitSessionError> {
    let old = changed_file.old_path.clone();
    let new = changed_file.new_path.clone();
    match changed_file.status {
        GitChangedFileStatus::Added => match (old, new) {
            (None, Some(path)) => Ok((
                SnapshotSidePlan::Missing(path.clone()),
                SnapshotSidePlan::Committed(path),
            )),
            _ => Err(GitSessionError::InvalidChangedFile),
        },
        GitChangedFileStatus::Deleted => match (old, new) {
            (Some(path), None) => Ok((
                SnapshotSidePlan::Committed(path.clone()),
                SnapshotSidePlan::Missing(path),
            )),
            _ => Err(GitSessionError::InvalidChangedFile),
        },
        GitChangedFileStatus::Modified | GitChangedFileStatus::TypeChanged => match (old, new) {
            (Some(old), Some(new)) if old.opaque_id == new.opaque_id => Ok((
                SnapshotSidePlan::Committed(old),
                SnapshotSidePlan::Committed(new),
            )),
            _ => Err(GitSessionError::InvalidChangedFile),
        },
        GitChangedFileStatus::Renamed => match (old, new) {
            (Some(old), Some(new)) if old.opaque_id != new.opaque_id => Ok((
                SnapshotSidePlan::Committed(old),
                SnapshotSidePlan::Committed(new),
            )),
            _ => Err(GitSessionError::InvalidChangedFile),
        },
        GitChangedFileStatus::Copied
        | GitChangedFileStatus::Unmerged
        | GitChangedFileStatus::Unknown => Err(GitSessionError::UnsupportedStatus),
    }
}

fn canonicalize_plan(
    session: &GitRepositorySession,
    plan: SnapshotSidePlan,
    generation: u64,
) -> Result<SnapshotSidePlan, GitSessionError> {
    let path = match &plan {
        SnapshotSidePlan::Missing(path) | SnapshotSidePlan::Committed(path) => path,
    };
    let canonical = session
        .paths()
        .lock()
        .map_err(|_| GitSessionError::StateUnavailable)?
        .resolve_identity(&path.opaque_id, generation, current_path_platform())
        .map_err(map_path_error)?;
    Ok(match plan {
        SnapshotSidePlan::Missing(_) => SnapshotSidePlan::Missing(canonical),
        SnapshotSidePlan::Committed(_) => SnapshotSidePlan::Committed(canonical),
    })
}

fn materialize_side(
    session: &GitRepositorySession,
    revision: &GitRevision,
    plan: SnapshotSidePlan,
    generation: u64,
    cancellation: &CancellationToken,
) -> Result<GitSnapshotDocument, GitSessionError> {
    match plan {
        SnapshotSidePlan::Missing(path) => Ok(missing_snapshot_document(revision, path)),
        SnapshotSidePlan::Committed(path) => {
            read_committed_snapshot(session, revision, path, generation, cancellation)
        }
    }
}

fn read_committed_snapshot(
    session: &GitRepositorySession,
    revision: &GitRevision,
    path: GitPathIdentity,
    generation: u64,
    cancellation: &CancellationToken,
) -> Result<GitSnapshotDocument, GitSessionError> {
    let tree = list_tree(
        session,
        &revision.resolved,
        Some((&path.opaque_id, generation)),
        SNAPSHOT_PATH_LOOKUP_LIMIT,
        cancellation,
    )
    .map_err(map_tree_error)?;
    let entry = tree
        .entries
        .into_iter()
        .find(|entry| entry.path.opaque_id == path.opaque_id)
        .ok_or(GitSessionError::PathNotAtRevision)?;
    snapshot_document_from_entry(session, revision, entry, cancellation)
}

fn snapshot_document_from_entry(
    session: &GitRepositorySession,
    revision: &GitRevision,
    entry: GitTreeEntry,
    cancellation: &CancellationToken,
) -> Result<GitSnapshotDocument, GitSessionError> {
    match entry.kind {
        GitTreeEntryKind::RegularFile | GitTreeEntryKind::ExecutableFile => {
            match read_blob(session, &entry.object_id, cancellation) {
                Ok(blob) => Ok(snapshot_document_from_blob(
                    revision, entry.path, entry.mode, blob,
                )),
                Err(GitBlobError::ObjectMissingLocal) => Ok(unavailable_snapshot_document(
                    revision,
                    entry.path,
                    entry.mode,
                    entry.object_id,
                )),
                Err(error) => Err(GitSessionError::Blob(error)),
            }
        }
        GitTreeEntryKind::Symlink => Ok(non_text_snapshot_document(
            revision,
            entry,
            GitSnapshotContentState::Symlink,
        )),
        GitTreeEntryKind::Submodule => Ok(non_text_snapshot_document(
            revision,
            entry,
            GitSnapshotContentState::Submodule,
        )),
    }
}

fn missing_snapshot_document(revision: &GitRevision, path: GitPathIdentity) -> GitSnapshotDocument {
    GitSnapshotDocument {
        origin: GitSnapshotOrigin::Missing,
        label: snapshot_label(revision, &path),
        read_only: true,
        object_id: None,
        path: Some(path),
        mode: None,
        text_metadata: None,
        content_state: GitSnapshotContentState::Missing,
    }
}

fn snapshot_document_from_blob(
    revision: &GitRevision,
    path: GitPathIdentity,
    mode: String,
    blob: GitBlobDocument,
) -> GitSnapshotDocument {
    let label = snapshot_label(revision, &path);
    let object_id = Some(blob.object_id);
    let (text_metadata, content_state) = match blob.content {
        GitBlobContent::Text {
            text,
            encoding,
            line_ending,
            had_final_newline,
            decode_had_errors,
        } => (
            Some(GitTextMetadata {
                encoding,
                line_ending,
                had_final_newline,
                decode_had_errors,
                size: blob.size,
            }),
            GitSnapshotContentState::Text { text },
        ),
        GitBlobContent::Binary => (None, GitSnapshotContentState::Binary),
        GitBlobContent::TooLarge => (None, GitSnapshotContentState::TooLarge),
        GitBlobContent::LfsPointer {
            oid_sha256,
            referenced_size,
        } => (
            None,
            GitSnapshotContentState::LfsPointer {
                oid_sha256,
                referenced_size,
            },
        ),
    };
    GitSnapshotDocument {
        origin: GitSnapshotOrigin::CommittedBlob,
        label,
        read_only: true,
        object_id,
        path: Some(path),
        mode: Some(mode),
        text_metadata,
        content_state,
    }
}

fn non_text_snapshot_document(
    revision: &GitRevision,
    entry: GitTreeEntry,
    content_state: GitSnapshotContentState,
) -> GitSnapshotDocument {
    GitSnapshotDocument {
        origin: GitSnapshotOrigin::CommittedBlob,
        label: snapshot_label(revision, &entry.path),
        read_only: true,
        object_id: Some(entry.object_id),
        path: Some(entry.path),
        mode: Some(entry.mode),
        text_metadata: None,
        content_state,
    }
}

fn unavailable_snapshot_document(
    revision: &GitRevision,
    path: GitPathIdentity,
    mode: String,
    object_id: crate::GitObjectId,
) -> GitSnapshotDocument {
    GitSnapshotDocument {
        origin: GitSnapshotOrigin::CommittedBlob,
        label: snapshot_label(revision, &path),
        read_only: true,
        object_id: Some(object_id),
        path: Some(path),
        mode: Some(mode),
        text_metadata: None,
        content_state: GitSnapshotContentState::Unavailable {
            reason: GitSnapshotUnavailableReason::ObjectMissingLocal,
        },
    }
}

fn snapshot_label(revision: &GitRevision, path: &GitPathIdentity) -> String {
    let short_length = revision.resolved.hex.len().min(SHORT_OBJECT_ID_LENGTH);
    format!(
        "{} ({}) · {}",
        revision.display_name,
        &revision.resolved.hex[..short_length],
        path.display_path,
    )
}

fn is_patch_source(document: &GitSnapshotDocument) -> bool {
    matches!(
        document.content_state,
        GitSnapshotContentState::Text { .. } | GitSnapshotContentState::Missing
    )
}

fn validate_revision(
    session: &GitRepositorySession,
    revision: &GitRevision,
) -> Result<(), GitSessionError> {
    if revision.resolved.algorithm != session.identity().object_format
        || !valid_revision_label(&revision.raw_label)
        || !valid_revision_label(&revision.display_name)
    {
        return Err(GitSessionError::InvalidRevision);
    }
    Ok(())
}

fn valid_revision_label(label: &str) -> bool {
    !label.is_empty()
        && label.len() <= MAX_REVISION_LABEL_BYTES
        && label.trim() == label
        && !label.chars().any(char::is_control)
}

fn validate_generation(
    session: &GitRepositorySession,
    generation: u64,
) -> Result<(), GitSessionError> {
    let current = session
        .paths()
        .lock()
        .map_err(|_| GitSessionError::StateUnavailable)?
        .generation();
    if current == generation {
        Ok(())
    } else {
        Err(GitSessionError::StaleGeneration)
    }
}

fn current_path_platform() -> GitPathPlatform {
    if cfg!(windows) {
        GitPathPlatform::Windows
    } else {
        GitPathPlatform::Unix
    }
}

fn map_path_error(error: GitPathRegistryError) -> GitSessionError {
    match error {
        GitPathRegistryError::UnknownOpaqueId => GitSessionError::UnknownPath,
        GitPathRegistryError::StaleGeneration => GitSessionError::StaleGeneration,
        GitPathRegistryError::PlatformConversionUnsupported => GitSessionError::PathUnsupported,
        GitPathRegistryError::EmptyPath
        | GitPathRegistryError::PathContainsNul
        | GitPathRegistryError::DuplicateOpaqueId
        | GitPathRegistryError::GenerationExhausted
        | GitPathRegistryError::OpaqueIdExhausted => GitSessionError::StateUnavailable,
    }
}

fn map_tree_error(error: GitTreeError) -> GitSessionError {
    match error {
        GitTreeError::UnknownPath => GitSessionError::UnknownPath,
        GitTreeError::StalePath => GitSessionError::StaleGeneration,
        GitTreeError::PathUnsupported => GitSessionError::PathUnsupported,
        other => GitSessionError::Tree(other),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        GitSessionError, SnapshotSidePlan, missing_snapshot_document, plan_changed_file,
        snapshot_document_from_blob,
    };
    use crate::domain::git::{
        GitBlobContent, GitBlobDocument, GitChangedFile, GitChangedFileStatus, GitObjectAlgorithm,
        GitObjectId, GitPathIdentity, GitRevision, GitRevisionKind, GitSnapshotContentState,
        GitSnapshotOrigin,
    };
    use crate::git::GIT_FIXTURE_LOCK;
    use crate::git::changed_files::list_changed_files;
    use crate::git::executable::ValidatedGitExecutable;
    use crate::git::repository::GitRepositorySession;
    use crate::git::runner::CancellationToken;
    use std::fs;
    use std::io::Write;
    use std::path::{Path, PathBuf};
    use std::process::{Command, Stdio};
    use tempfile::{TempDir, tempdir};

    fn sha1(hex_digit: char) -> GitObjectId {
        GitObjectId::try_new(GitObjectAlgorithm::Sha1, hex_digit.to_string().repeat(40))
            .expect("valid object ID")
    }

    fn path(id: &str, display: &str) -> GitPathIdentity {
        GitPathIdentity::new(id, display, Some(display))
    }

    fn changed(
        status: GitChangedFileStatus,
        old_path: Option<GitPathIdentity>,
        new_path: Option<GitPathIdentity>,
    ) -> GitChangedFile {
        GitChangedFile {
            status,
            old_path,
            new_path,
            similarity_score: None,
        }
    }

    fn revision() -> GitRevision {
        GitRevision {
            raw_label: "main".to_string(),
            resolved: sha1('a'),
            kind: GitRevisionKind::Branch,
            display_name: "main".to_string(),
        }
    }

    #[test]
    fn maps_supported_changed_statuses_to_explicit_snapshot_sides() {
        let old = path("old", "src/old.txt");
        let new = path("new", "src/new.txt");

        assert_eq!(
            plan_changed_file(&changed(
                GitChangedFileStatus::Added,
                None,
                Some(new.clone()),
            )),
            Ok((
                SnapshotSidePlan::Missing(new.clone()),
                SnapshotSidePlan::Committed(new.clone()),
            )),
        );
        assert_eq!(
            plan_changed_file(&changed(
                GitChangedFileStatus::Deleted,
                Some(old.clone()),
                None,
            )),
            Ok((
                SnapshotSidePlan::Committed(old.clone()),
                SnapshotSidePlan::Missing(old.clone()),
            )),
        );
        for status in [
            GitChangedFileStatus::Modified,
            GitChangedFileStatus::TypeChanged,
        ] {
            assert_eq!(
                plan_changed_file(&changed(status, Some(old.clone()), Some(old.clone()),)),
                Ok((
                    SnapshotSidePlan::Committed(old.clone()),
                    SnapshotSidePlan::Committed(old.clone()),
                )),
            );
        }
        assert_eq!(
            plan_changed_file(&changed(
                GitChangedFileStatus::Renamed,
                Some(old.clone()),
                Some(new.clone()),
            )),
            Ok((
                SnapshotSidePlan::Committed(old),
                SnapshotSidePlan::Committed(new),
            )),
        );
    }

    #[test]
    fn rejects_forward_compatible_statuses_and_malformed_path_shapes() {
        let same = path("same", "src/file.txt");
        for status in [
            GitChangedFileStatus::Copied,
            GitChangedFileStatus::Unmerged,
            GitChangedFileStatus::Unknown,
        ] {
            assert_eq!(
                plan_changed_file(&changed(status, Some(same.clone()), Some(same.clone()),)),
                Err(GitSessionError::UnsupportedStatus),
            );
        }

        assert_eq!(
            plan_changed_file(&changed(
                GitChangedFileStatus::Added,
                Some(same.clone()),
                Some(same.clone()),
            )),
            Err(GitSessionError::InvalidChangedFile),
        );
        assert_eq!(
            plan_changed_file(&changed(
                GitChangedFileStatus::Modified,
                Some(same.clone()),
                Some(path("other", "src/file.txt")),
            )),
            Err(GitSessionError::InvalidChangedFile),
        );
    }

    #[test]
    fn keeps_missing_distinct_from_a_real_empty_blob_and_labels_both() {
        let path = path("empty", "empty.txt");
        let revision = revision();
        let missing = missing_snapshot_document(&revision, path.clone());
        let empty = snapshot_document_from_blob(
            &revision,
            path,
            "100644".to_string(),
            GitBlobDocument {
                object_id: sha1('b'),
                size: 0,
                content: GitBlobContent::Text {
                    text: String::new(),
                    encoding: "UTF-8".to_string(),
                    line_ending: crate::LineEnding::None,
                    had_final_newline: true,
                    decode_had_errors: false,
                },
            },
        );

        assert_eq!(missing.origin, GitSnapshotOrigin::Missing);
        assert_eq!(missing.content_state, GitSnapshotContentState::Missing);
        assert_eq!(missing.object_id, None);
        assert!(missing.read_only);
        assert_eq!(empty.origin, GitSnapshotOrigin::CommittedBlob);
        assert!(matches!(
            empty.content_state,
            GitSnapshotContentState::Text { ref text } if text.is_empty()
        ));
        assert_eq!(
            empty.text_metadata.as_ref().map(|metadata| metadata.size),
            Some(0)
        );
        assert!(empty.object_id.is_some());
        assert!(empty.read_only);
        assert!(empty.label.contains("main"));
        assert!(empty.label.contains(&"a".repeat(12)));
        assert!(empty.label.contains("empty.txt"));
    }

    #[test]
    fn opens_revision_snapshots_without_mutating_repository_or_worktree_state() {
        let _fixture_guard = GIT_FIXTURE_LOCK.lock().expect("Git fixture lock");
        let fixture = revision_compare_fixture();
        let executable = ValidatedGitExecutable::discover(None).expect("validated Git");
        let session = GitRepositorySession::open(
            "repository-session-git-302".to_string(),
            fixture.root.clone(),
            executable,
        )
        .expect("open repository session");
        let cancellation = CancellationToken::new();
        let changes = list_changed_files(
            &session,
            &fixture.left.resolved,
            &fixture.right.resolved,
            100,
            &cancellation,
        )
        .expect("list changed files");
        let before = repository_fingerprint(&fixture.root);

        let empty = find_change(&changes.entries, GitChangedFileStatus::Added, "empty.txt");
        let empty_session = super::open_revision_compare(
            &session,
            &fixture.left,
            &fixture.right,
            empty,
            changes.generation,
            &cancellation,
        )
        .expect("open empty added file");
        assert_eq!(
            empty_session.left.content_state,
            GitSnapshotContentState::Missing
        );
        assert!(matches!(
            empty_session.right.content_state,
            GitSnapshotContentState::Text { ref text } if text.is_empty()
        ));
        assert!(empty_session.capabilities.export_patch);

        let modified = find_change(
            &changes.entries,
            GitChangedFileStatus::Modified,
            "modified.txt",
        );
        let modified_session = super::open_revision_compare(
            &session,
            &fixture.left,
            &fixture.right,
            modified,
            changes.generation,
            &cancellation,
        )
        .expect("open modified file");
        assert!(matches!(
            modified_session.left.content_state,
            GitSnapshotContentState::Text { ref text } if text == "before\n"
        ));
        assert!(matches!(
            modified_session.right.content_state,
            GitSnapshotContentState::Text { ref text } if text == "after\n"
        ));

        let deleted = find_change(
            &changes.entries,
            GitChangedFileStatus::Deleted,
            "deleted.txt",
        );
        let deleted_session = super::open_revision_compare(
            &session,
            &fixture.left,
            &fixture.right,
            deleted,
            changes.generation,
            &cancellation,
        )
        .expect("open deleted file");
        assert!(matches!(
            deleted_session.left.content_state,
            GitSnapshotContentState::Text { .. }
        ));
        assert_eq!(
            deleted_session.right.content_state,
            GitSnapshotContentState::Missing
        );

        let renamed = find_change(
            &changes.entries,
            GitChangedFileStatus::Renamed,
            "renamed.txt",
        );
        let renamed_session = super::open_revision_compare(
            &session,
            &fixture.left,
            &fixture.right,
            renamed,
            changes.generation,
            &cancellation,
        )
        .expect("open renamed file");
        assert!(renamed_session.left.label.contains("old-name.txt"));
        assert!(renamed_session.right.label.contains("renamed.txt"));

        let binary = find_change(&changes.entries, GitChangedFileStatus::Added, "binary.bin");
        let binary_session = super::open_revision_compare(
            &session,
            &fixture.left,
            &fixture.right,
            binary,
            changes.generation,
            &cancellation,
        )
        .expect("open binary file");
        assert_eq!(
            binary_session.right.content_state,
            GitSnapshotContentState::Binary
        );
        assert!(!binary_session.capabilities.export_patch);

        let type_change = find_change(
            &changes.entries,
            GitChangedFileStatus::TypeChanged,
            "type.txt",
        );
        let type_session = super::open_revision_compare(
            &session,
            &fixture.left,
            &fixture.right,
            type_change,
            changes.generation,
            &cancellation,
        )
        .expect("open type-changed file");
        assert!(matches!(
            type_session.left.content_state,
            GitSnapshotContentState::Text { .. }
        ));
        assert_eq!(
            type_session.right.content_state,
            GitSnapshotContentState::Symlink
        );
        assert!(!type_session.capabilities.export_patch);

        assert_eq!(repository_fingerprint(&fixture.root), before);
        session
            .paths()
            .lock()
            .expect("path registry")
            .refresh()
            .expect("refresh path generation");
        assert_eq!(
            super::open_revision_compare(
                &session,
                &fixture.left,
                &fixture.right,
                modified,
                changes.generation,
                &cancellation,
            ),
            Err(GitSessionError::StaleGeneration),
        );
        assert_eq!(repository_fingerprint(&fixture.root), before);
    }

    struct RevisionCompareFixture {
        _temp: TempDir,
        root: PathBuf,
        left: GitRevision,
        right: GitRevision,
    }

    #[derive(Debug, PartialEq, Eq)]
    struct RepositoryFingerprint {
        head: Vec<u8>,
        refs: Vec<u8>,
        index: Vec<u8>,
        status: Vec<u8>,
        worktree: Vec<(String, Option<Vec<u8>>)>,
    }

    fn revision_compare_fixture() -> RevisionCompareFixture {
        let temp = tempdir().expect("temporary repository");
        let root = temp.path().to_path_buf();
        git(&root, &["init"]);
        git(&root, &["config", "user.name", "Forktail Test"]);
        git(&root, &["config", "user.email", "forktail@example.invalid"]);
        fs::write(root.join("modified.txt"), b"before\n").expect("write modified fixture");
        fs::write(root.join("deleted.txt"), b"deleted\n").expect("write deleted fixture");
        fs::write(root.join("old-name.txt"), b"rename me\n").expect("write rename fixture");
        fs::write(root.join("type.txt"), b"target\n").expect("write type fixture");
        git(&root, &["add", "--all"]);
        git(&root, &["commit", "-m", "left"]);
        let left = revision_from_head(&root, "left");

        fs::write(root.join("modified.txt"), b"after\n").expect("modify fixture");
        fs::remove_file(root.join("deleted.txt")).expect("delete fixture");
        fs::rename(root.join("old-name.txt"), root.join("renamed.txt")).expect("rename fixture");
        fs::write(root.join("empty.txt"), b"").expect("write empty fixture");
        fs::write(root.join("binary.bin"), [0, 1, 2, 3]).expect("write binary fixture");
        git(&root, &["add", "--all"]);
        let symlink_blob = String::from_utf8(git_output(&root, &["hash-object", "-w", "type.txt"]))
            .expect("ASCII blob ID")
            .trim()
            .to_string();
        git(
            &root,
            &[
                "update-index",
                "--add",
                "--cacheinfo",
                &format!("120000,{symlink_blob},type.txt"),
            ],
        );
        git(&root, &["commit", "-m", "right"]);
        let right = revision_from_head(&root, "right");

        RevisionCompareFixture {
            _temp: temp,
            root,
            left,
            right,
        }
    }

    fn revision_from_head(root: &Path, label: &str) -> GitRevision {
        let hex = String::from_utf8(git_output(root, &["rev-parse", "HEAD"]))
            .expect("ASCII commit ID")
            .trim()
            .to_string();
        GitRevision {
            raw_label: label.to_string(),
            resolved: GitObjectId::try_new(GitObjectAlgorithm::Sha1, hex).expect("full commit ID"),
            kind: GitRevisionKind::Commit,
            display_name: label.to_string(),
        }
    }

    fn find_change<'a>(
        entries: &'a [GitChangedFile],
        status: GitChangedFileStatus,
        display_path: &str,
    ) -> &'a GitChangedFile {
        entries
            .iter()
            .find(|entry| {
                entry.status == status
                    && entry
                        .new_path
                        .as_ref()
                        .or(entry.old_path.as_ref())
                        .is_some_and(|path| path.display_path == display_path)
            })
            .expect("expected changed file")
    }

    fn repository_fingerprint(root: &Path) -> RepositoryFingerprint {
        let status = git_output(
            root,
            &[
                "status",
                "--porcelain=v2",
                "-z",
                "--branch",
                "--untracked-files=all",
            ],
        );
        let index_path = root.join(".git/index");
        let worktree = [
            "modified.txt",
            "deleted.txt",
            "old-name.txt",
            "renamed.txt",
            "type.txt",
            "empty.txt",
            "binary.bin",
        ]
        .into_iter()
        .map(|path| {
            let bytes = match fs::read(root.join(path)) {
                Ok(bytes) => Some(bytes),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
                Err(error) => panic!("read worktree fixture {path}: {error}"),
            };
            (path.to_string(), bytes)
        })
        .collect();
        RepositoryFingerprint {
            head: fs::read(root.join(".git/HEAD")).expect("HEAD file"),
            refs: git_output(root, &["show-ref", "--head"]),
            index: fs::read(&index_path).expect("index bytes"),
            status,
            worktree,
        }
    }

    fn git(root: &Path, arguments: &[&str]) {
        let output = Command::new("git")
            .current_dir(root)
            .args(arguments)
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_TERMINAL_PROMPT", "0")
            .output()
            .expect("run Git fixture command");
        assert!(
            output.status.success(),
            "git {arguments:?} failed: {}",
            String::from_utf8_lossy(&output.stderr),
        );
    }

    fn git_output(root: &Path, arguments: &[&str]) -> Vec<u8> {
        let mut child = Command::new("git")
            .current_dir(root)
            .args(arguments)
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_TERMINAL_PROMPT", "0")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("spawn Git fixture command");
        if let Some(mut stdin) = child.stdin.take() {
            stdin.write_all(&[]).expect("close fixture stdin");
        }
        let output = child
            .wait_with_output()
            .expect("wait for Git fixture command");
        assert!(
            output.status.success(),
            "git {arguments:?} failed: {}",
            String::from_utf8_lossy(&output.stderr),
        );
        output.stdout
    }
}
