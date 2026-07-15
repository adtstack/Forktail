use crate::error::{AppErrorCode, CommandError, CommandResult};
use std::ffi::OsString;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

#[derive(Debug, PartialEq, Eq)]
struct RevealCommand {
    program: &'static str,
    args: Vec<String>,
}

#[tauri::command]
pub fn git_tool_executable_path() -> CommandResult<String> {
    git_tool_executable_path_from(
        cfg!(debug_assertions),
        cfg!(target_os = "linux"),
        std::env::var_os("APPIMAGE"),
        std::env::current_exe(),
    )
}

fn git_tool_executable_path_from(
    debug_build: bool,
    prefer_appimage: bool,
    appimage: Option<OsString>,
    current_exe: io::Result<PathBuf>,
) -> CommandResult<String> {
    if debug_build {
        return Err(CommandError::new(
            AppErrorCode::PathConflict,
            "패키징된 앱에서 실제 실행 파일 경로를 확인하세요.",
        ));
    }

    let appimage = appimage
        .map(PathBuf::from)
        .filter(|path| path.is_absolute());
    let executable = match (prefer_appimage, appimage) {
        (true, Some(path)) => path,
        _ => current_exe.map_err(|error| {
            CommandError::io(
                AppErrorCode::PathConflict,
                "실행 파일 경로를 확인하지 못했습니다",
                error,
            )
        })?,
    };

    if !executable.is_absolute() {
        return Err(CommandError::new(
            AppErrorCode::PathConflict,
            "실행 파일의 절대 경로를 확인하지 못했습니다.",
        ));
    }

    executable.into_os_string().into_string().map_err(|_| {
        CommandError::new(
            AppErrorCode::PathConflict,
            "실행 파일 경로를 현재 UI에서 안전하게 표시할 수 없습니다.",
        )
    })
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
    fn returns_the_packaged_executable_path() {
        #[cfg(target_os = "windows")]
        let expected = r"C:\Program Files\forktail\forktail.exe";
        #[cfg(not(target_os = "windows"))]
        let expected = "/Applications/forktail.app/Contents/MacOS/forktail";

        let path = git_tool_executable_path_from(false, false, None, Ok(PathBuf::from(expected)))
            .expect("packaged executable path");

        assert_eq!(path, expected);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn prefers_the_stable_appimage_path_over_the_temporary_mount_executable() {
        let path = git_tool_executable_path_from(
            false,
            true,
            Some(OsString::from("/home/user/Applications/forktail.AppImage")),
            Ok(PathBuf::from("/tmp/.mount_forktail/usr/bin/forktail")),
        )
        .expect("AppImage path");

        assert_eq!(path, "/home/user/Applications/forktail.AppImage");
    }

    #[test]
    fn rejects_dev_builds_and_relative_runtime_paths() {
        let debug_error =
            git_tool_executable_path_from(true, false, None, Ok(PathBuf::from("/tmp/forktail")))
                .expect_err("dev build must not produce Git config");
        assert_eq!(debug_error.code, AppErrorCode::PathConflict);

        let relative_error = git_tool_executable_path_from(
            false,
            false,
            None,
            Ok(PathBuf::from("target/release/forktail")),
        )
        .expect_err("relative executable path must fail closed");
        assert_eq!(relative_error.code, AppErrorCode::PathConflict);
    }

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
