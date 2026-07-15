pub mod blob;
pub mod executable;
pub mod jobs;
pub mod parsers;
pub mod refs;
pub mod repository;
pub mod revision;
pub mod runner;
pub mod tree;

#[cfg(test)]
pub(crate) static GIT_FIXTURE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
