use std::path::{Path, PathBuf};

use tauri::AppHandle;

#[tauri::command]
pub fn startup_args() -> Vec<String> {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    match std::env::current_dir() {
        Ok(directory) => normalize_startup_args(args, &directory),
        Err(_) => args,
    }
}

#[tauri::command]
pub fn exit_external_git_tool(app: AppHandle) {
    app.exit(0);
}

fn normalize_startup_args(mut args: Vec<String>, invocation_directory: &Path) -> Vec<String> {
    let app_args_start = args
        .iter()
        .position(|argument| argument == "--")
        .map_or(0, |index| index + 1);
    let Some(command_index) = args[app_args_start..]
        .iter()
        .position(|argument| !argument.is_empty())
        .map(|index| app_args_start + index)
    else {
        return args;
    };

    let command = &args[command_index];
    let path_start = if is_startup_command(command) {
        command_index + 1
    } else if command.starts_with('-') {
        return args;
    } else {
        command_index
    };

    for argument in &mut args[path_start..] {
        if argument.is_empty() || argument == "/dev/null" {
            continue;
        }
        let path = PathBuf::from(&*argument);
        if path.is_relative() {
            *argument = invocation_directory
                .join(path)
                .to_string_lossy()
                .into_owned();
        }
    }
    args
}

fn is_startup_command(argument: &str) -> bool {
    matches!(
        argument,
        "--compare"
            | "compare"
            | "--difftool"
            | "--diff-tool"
            | "difftool"
            | "--folders"
            | "--folder"
            | "folders"
            | "folder"
            | "--merge"
            | "merge"
            | "--mergetool"
            | "--merge-tool"
            | "mergetool"
            | "merge-tool"
    )
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    #[test]
    fn command_returns_arguments_without_panicking() {
        let _ = super::startup_args();
    }

    #[test]
    fn resolves_mergetool_relative_paths_against_the_invocation_directory() {
        let invocation_directory = test_invocation_directory();

        let normalized = super::normalize_startup_args(
            vec![
                "--mergetool".into(),
                "./conflict_BASE.txt".into(),
                "./conflict_LOCAL O'Brien 한글.txt".into(),
                "./conflict_REMOTE.txt".into(),
                "conflict.txt".into(),
            ],
            &invocation_directory,
        );

        assert_eq!(normalized[0], "--mergetool");
        assert_eq!(
            PathBuf::from(&normalized[1]),
            invocation_directory.join("./conflict_BASE.txt")
        );
        assert_eq!(
            PathBuf::from(&normalized[2]),
            invocation_directory.join("./conflict_LOCAL O'Brien 한글.txt")
        );
        assert_eq!(
            PathBuf::from(&normalized[4]),
            invocation_directory.join("conflict.txt")
        );
    }

    #[test]
    fn preserves_difftool_missing_sentinels_and_absolute_paths() {
        let invocation_directory = test_invocation_directory();
        let absolute_remote = invocation_directory.join("remote.txt");

        let normalized = super::normalize_startup_args(
            vec![
                "--".into(),
                "--difftool".into(),
                "".into(),
                absolute_remote.to_string_lossy().into_owned(),
            ],
            &invocation_directory,
        );

        assert_eq!(normalized[0], "--");
        assert_eq!(normalized[1], "--difftool");
        assert_eq!(normalized[2], "");
        assert_eq!(PathBuf::from(&normalized[3]), absolute_remote);
    }

    #[test]
    fn resolves_commandless_compare_paths_without_changing_invalid_options() {
        let invocation_directory = test_invocation_directory();

        let compare = super::normalize_startup_args(
            vec!["left.txt".into(), "nested/right.txt".into()],
            &invocation_directory,
        );
        let invalid = super::normalize_startup_args(
            vec!["--unknown".into(), "left.txt".into()],
            &invocation_directory,
        );

        assert_eq!(
            PathBuf::from(&compare[0]),
            invocation_directory.join("left.txt")
        );
        assert_eq!(
            PathBuf::from(&compare[1]),
            invocation_directory.join("nested/right.txt")
        );
        assert_eq!(invalid, vec!["--unknown", "left.txt"]);
    }

    fn test_invocation_directory() -> PathBuf {
        std::env::temp_dir().join("forktail startup O'Brien 한글")
    }
}
