use tauri::{
    AppHandle, Emitter, Runtime,
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
};

const NATIVE_MENU_COMMAND_EVENT: &str = "forktail-menu-command";

const COMMAND_IDS: &[&str] = &[
    "openCompare",
    "openFolders",
    "openMerge",
    "openGitRepository",
    "save",
    "saveAs",
    "undo",
    "redo",
    "nextDiff",
    "previousDiff",
    "nextConflict",
    "previousConflict",
    "acceptOurs",
    "acceptBase",
    "acceptTheirs",
    "acceptBoth",
    "swapSides",
    "searchPath",
    "settings",
];

pub fn build_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let open_compare = MenuItem::with_id(
        app,
        "openCompare",
        "Compare Files",
        true,
        Some("CmdOrCtrl+O"),
    )?;
    let open_folders = MenuItem::with_id(
        app,
        "openFolders",
        "Folder Diff",
        true,
        Some("CmdOrCtrl+Shift+O"),
    )?;
    let open_merge = MenuItem::with_id(
        app,
        "openMerge",
        "3-way Merge",
        true,
        Some("CmdOrCtrl+Alt+O"),
    )?;
    let open_git_repository = MenuItem::with_id(
        app,
        "openGitRepository",
        "Open Git Repository",
        true,
        Some("CmdOrCtrl+Alt+G"),
    )?;
    let save = MenuItem::with_id(app, "save", "Save", true, Some("CmdOrCtrl+S"))?;
    let save_as = MenuItem::with_id(app, "saveAs", "Save As", true, Some("CmdOrCtrl+Shift+S"))?;
    let file_separator_one = PredefinedMenuItem::separator(app)?;
    let file_separator_two = PredefinedMenuItem::separator(app)?;
    let close_window = PredefinedMenuItem::close_window(app, None)?;
    let quit = PredefinedMenuItem::quit(app, None)?;
    let file_menu = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &open_compare,
            &open_folders,
            &open_merge,
            &open_git_repository,
            &file_separator_one,
            &save,
            &save_as,
            &file_separator_two,
            &close_window,
            &quit,
        ],
    )?;

    let undo = MenuItem::with_id(app, "undo", "Undo", true, Some("CmdOrCtrl+Z"))?;
    let redo = MenuItem::with_id(app, "redo", "Redo", true, Some("CmdOrCtrl+Y"))?;
    let search_path =
        MenuItem::with_id(app, "searchPath", "Search Path", true, Some("CmdOrCtrl+F"))?;
    let settings = MenuItem::with_id(app, "settings", "Settings", false, Some("CmdOrCtrl+,"))?;
    let edit_separator = PredefinedMenuItem::separator(app)?;
    let edit_menu = Submenu::with_items(
        app,
        "Edit",
        true,
        &[&undo, &redo, &edit_separator, &search_path, &settings],
    )?;

    let previous_diff = MenuItem::with_id(
        app,
        "previousDiff",
        "Previous Change",
        true,
        Some("Shift+F7"),
    )?;
    let next_diff = MenuItem::with_id(app, "nextDiff", "Next Change", true, Some("F7"))?;
    let previous_conflict = MenuItem::with_id(
        app,
        "previousConflict",
        "Previous Conflict",
        true,
        Some("Shift+F8"),
    )?;
    let next_conflict = MenuItem::with_id(app, "nextConflict", "Next Conflict", true, Some("F8"))?;
    let swap_sides = MenuItem::with_id(
        app,
        "swapSides",
        "Swap Sides",
        true,
        Some("CmdOrCtrl+Shift+X"),
    )?;
    let navigate_separator_one = PredefinedMenuItem::separator(app)?;
    let navigate_separator_two = PredefinedMenuItem::separator(app)?;
    let navigate_menu = Submenu::with_items(
        app,
        "Navigate",
        true,
        &[
            &previous_diff,
            &next_diff,
            &navigate_separator_one,
            &previous_conflict,
            &next_conflict,
            &navigate_separator_two,
            &swap_sides,
        ],
    )?;

    let accept_ours = MenuItem::with_id(app, "acceptOurs", "Accept OURS", true, Some("Alt+1"))?;
    let accept_base = MenuItem::with_id(app, "acceptBase", "Accept BASE", true, Some("Alt+2"))?;
    let accept_theirs =
        MenuItem::with_id(app, "acceptTheirs", "Accept THEIRS", true, Some("Alt+3"))?;
    let accept_both = MenuItem::with_id(app, "acceptBoth", "Keep Both", true, Some("Alt+4"))?;
    let merge_menu = Submenu::with_items(
        app,
        "Merge",
        true,
        &[&accept_ours, &accept_base, &accept_theirs, &accept_both],
    )?;

    Menu::with_items(app, &[&file_menu, &edit_menu, &navigate_menu, &merge_menu])
}

pub fn handle_menu_event<R: Runtime>(app: &AppHandle<R>, event: tauri::menu::MenuEvent) {
    for command_id in COMMAND_IDS {
        if event.id() == *command_id {
            let _ = app.emit(NATIVE_MENU_COMMAND_EVENT, *command_id);
            return;
        }
    }
}
