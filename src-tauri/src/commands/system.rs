use crate::error::{AppErrorCode, CommandError, CommandResult};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

#[derive(Debug, PartialEq, Eq)]
struct RevealCommand {
    program: &'static str,
    args: Vec<String>,
}

#[tauri::command]
pub fn reveal_path(path: String) -> CommandResult<()> {
    let target = PathBuf::from(path);
    if target.as_os_str().is_empty() {
        return Err(CommandError::new(
            AppErrorCode::PathConflict,
            "열 경로가 비어 있습니다. 항목을 다시 선택하세요.",
        ));
    }

    let metadata = fs::symlink_metadata(&target).map_err(|error| {
        CommandError::io(
            AppErrorCode::PathConflict,
            "파일 관리자에서 열 항목을 확인하지 못했습니다",
            error,
        )
    })?;
    let reveal = reveal_command_for_path(&target, metadata.file_type().is_dir());
    Command::new(reveal.program)
        .args(&reveal.args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| {
            CommandError::io(
                AppErrorCode::PathConflict,
                "파일 관리자를 열지 못했습니다",
                error,
            )
        })?;

    Ok(())
}

#[cfg(target_os = "macos")]
fn reveal_command_for_path(path: &Path, _is_directory: bool) -> RevealCommand {
    RevealCommand {
        program: "open",
        args: vec!["-R".to_string(), path.to_string_lossy().into_owned()],
    }
}

#[cfg(target_os = "windows")]
fn reveal_command_for_path(path: &Path, _is_directory: bool) -> RevealCommand {
    RevealCommand {
        program: "explorer.exe",
        args: vec![format!("/select,{}", path.to_string_lossy())],
    }
}

#[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
fn reveal_command_for_path(path: &Path, is_directory: bool) -> RevealCommand {
    let target = if is_directory {
        path.to_path_buf()
    } else {
        path.parent()
            .unwrap_or_else(|| Path::new("."))
            .to_path_buf()
    };
    RevealCommand {
        program: "xdg-open",
        args: vec![target.to_string_lossy().into_owned()],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_platform_reveal_command_without_shell() {
        let path = Path::new("/tmp/forktail/example.txt");
        let command = reveal_command_for_path(path, false);

        #[cfg(target_os = "macos")]
        assert_eq!(
            command,
            RevealCommand {
                program: "open",
                args: vec!["-R".to_string(), "/tmp/forktail/example.txt".to_string()],
            },
        );

        #[cfg(target_os = "windows")]
        assert_eq!(
            command,
            RevealCommand {
                program: "explorer.exe",
                args: vec!["/select,/tmp/forktail/example.txt".to_string()],
            },
        );

        #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
        assert_eq!(
            command,
            RevealCommand {
                program: "xdg-open",
                args: vec!["/tmp/forktail".to_string()],
            },
        );
    }
}
