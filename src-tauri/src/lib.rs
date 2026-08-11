mod commands;
mod detached_review;
mod domain;
mod error;
mod folder_scan;
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

use commands::{
    detached_review as detached_review_commands, files, folders, git as git_commands, merge,
    startup, system,
};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(detached_review::DetachedReviewRegistry::default())
        .manage(git::repository::GitRepositorySessions::default())
        .manage(git::jobs::GitJobs::default())
        .menu(menu::build_menu)
        .on_menu_event(menu::handle_menu_event)
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Focused(true) = event {
                let _ = menu::apply_window_menu_profile(window.app_handle(), window.label());
            }
            if let tauri::WindowEvent::Destroyed = event {
                folder_scan::cancel_owner(window.label());
                let registry = window.state::<detached_review::DetachedReviewRegistry>();
                if window.label() == "main" {
                    let labels = registry.close_all_labels();
                    let app = window.app_handle().clone();
                    tauri::async_runtime::spawn(async move {
                        for label in labels {
                            if let Some(child) = app.get_webview_window(&label) {
                                let _ = child.close();
                            }
                        }
                    });
                } else {
                    registry.destroy(window.label());
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            files::read_text_file,
            files::read_folder_review_text_pair,
            files::cancel_folder_review_text_read,
            detached_review_commands::load_detached_folder_review,
            detached_review_commands::check_detached_folder_review_versions,
            detached_review_commands::reload_detached_folder_review,
            detached_review_commands::open_detached_folder_review,
            detached_review_commands::invalidate_detached_folder_review_source,
            files::list_file_backups,
            files::restore_text_file_backup,
            files::stat_text_file_version,
            files::stat_optional_text_file_version,
            files::write_text_file_atomic,
            files::write_text_file_atomic_guarded,
            folders::start_folder_scan,
            folders::ack_folder_scan,
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
            system::runtime_integration_profile,
            system::set_editor_navigation_back_enabled,
            system::set_settings_command_enabled,
            system::reveal_path,
        ])
        .build(tauri::generate_context!())
        .expect("failed to build forktail");
    app.run(|app, event| match event {
        tauri::RunEvent::ExitRequested { code, api, .. } => {
            if menu::should_guard_user_exit_request(app, code) {
                api.prevent_exit();
                let _ = menu::emit_quit_to_main(app);
            } else {
                let registry = app.state::<detached_review::DetachedReviewRegistry>();
                let _ = registry.close_all_labels();
            }
        }
        tauri::RunEvent::Exit => {
            let registry = app.state::<detached_review::DetachedReviewRegistry>();
            let _ = registry.close_all_labels();
        }
        _ => {}
    });
}
