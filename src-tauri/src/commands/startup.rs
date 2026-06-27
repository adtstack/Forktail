#[tauri::command]
pub fn startup_args() -> Vec<String> {
    std::env::args().skip(1).collect()
}

#[cfg(test)]
mod tests {
    #[test]
    fn command_returns_arguments_without_panicking() {
        let _ = super::startup_args();
    }
}
