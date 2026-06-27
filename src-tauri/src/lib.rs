mod commands;
mod domain;
mod error;
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
            files::stat_text_file_version,
            files::write_text_file_atomic,
            folders::scan_directories,
            merge::merge_texts,
            startup::startup_args,
            system::reveal_path,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run forktail");
}
