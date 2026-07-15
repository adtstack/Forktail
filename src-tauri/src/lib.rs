mod commands;
mod domain;
mod error;
pub mod git;
mod menu;
mod text;

pub use domain::git::{
    GitBlobContent, GitBlobDocument, GitChangedFile, GitChangedFileCounts, GitChangedFileList,
    GitChangedFileStatus, GitCompareCapabilities, GitCompareSession, GitCompareSourceKind,
    GitConflictEncodingPolicy, GitConflictEntry, GitConflictLineEndingPolicy, GitConflictList,
    GitConflictOperation, GitConflictResultFingerprint, GitConflictResultKind,
    GitConflictSaveAction, GitConflictSaveResult, GitConflictSaveState, GitConflictSession,
    GitConflictStage, GitConflictStageFingerprint, GitFileHistoryBoundary, GitFileHistoryEntry,
    GitFileHistoryList, GitHeadState, GitIndexComparison, GitIndexEntry, GitMergeBase,
    GitMergePreview, GitMergePreviewCapabilities, GitMergePreviewDisclaimer, GitMergePreviewResult,
    GitObjectAlgorithm, GitObjectId, GitObjectIdError, GitObjectType, GitPathIdentity,
    GitRecentCommitEntry, GitRecentCommitList, GitRefKind, GitRefList, GitRepositoryIdentity,
    GitRepositoryRef, GitRepositorySummary, GitRevision, GitRevisionKind, GitRevisionPair,
    GitSnapshotContentState, GitSnapshotDocument, GitSnapshotOrigin, GitSnapshotUnavailableReason,
    GitStatusBranch, GitStatusBranchState, GitStatusChangeKind, GitStatusEntry, GitStatusSnapshot,
    GitSubmoduleStatus, GitTextMetadata, GitTreeEntry, GitTreeEntryKind, GitTreeList,
    GitUnmergedStatusEntry, GitWorkingTreeVersion,
};
pub use domain::models::LineEnding;

use commands::{files, folders, git as git_commands, merge, startup, system};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(git::repository::GitRepositorySessions::default())
        .manage(git::jobs::GitJobs::default())
        .menu(menu::build_menu)
        .on_menu_event(menu::handle_menu_event)
        .invoke_handler(tauri::generate_handler![
            files::read_text_file,
            files::list_file_backups,
            files::restore_text_file_backup,
            files::stat_text_file_version,
            files::stat_optional_text_file_version,
            files::write_text_file_atomic,
            files::write_text_file_atomic_guarded,
            folders::cancel_folder_scan,
            folders::scan_directories,
            git_commands::check_git_availability,
            git_commands::detect_git_repository,
            git_commands::close_git_repository,
            git_commands::list_git_refs,
            git_commands::list_git_recent_commits,
            git_commands::list_git_file_history,
            git_commands::list_git_tree,
            git_commands::list_git_changed_files,
            git_commands::read_git_status,
            git_commands::list_git_conflicts,
            git_commands::get_git_merge_base,
            git_commands::open_git_merge_preview,
            git_commands::read_git_blob,
            git_commands::open_git_revision_compare,
            git_commands::open_git_working_tree_compare,
            git_commands::open_git_index_compare,
            git_commands::open_git_conflict,
            git_commands::save_git_conflict_result,
            git_commands::cancel_git_job,
            git_commands::resolve_git_revision,
            merge::merge_texts,
            startup::exit_external_git_tool,
            startup::startup_args,
            system::git_tool_executable_path,
            system::reveal_path,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run forktail");
}
