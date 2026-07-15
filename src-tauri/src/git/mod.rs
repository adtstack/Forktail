pub mod executable;
pub mod parsers;
pub mod repository;
pub mod revision;
pub mod runner;

#[cfg(test)]
pub(crate) static GIT_FIXTURE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
