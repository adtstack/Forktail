mod commands;
mod domain;
mod error;
pub mod git;
mod menu;

use commands::{files, folders, merge, startup, system};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .menu(menu::build_menu)
        .on_menu_event(menu::handle_menu_event)
        .invoke_handler(tauri::generate_handler![
            files::read_text_file,
            files::list_file_backups,
            files::restore_text_file_backup,
            files::stat_text_file_version,
            files::write_text_file_atomic,
            folders::cancel_folder_scan,
            folders::scan_directories,
            merge::merge_texts,
            startup::exit_external_git_tool,
            startup::startup_args,
            system::git_tool_executable_path,
            system::reveal_path,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run forktail");
}
