pub mod blob;
pub mod changed_files;
pub mod executable;
pub mod index;
pub mod jobs;
pub mod parsers;
pub mod refs;
pub mod repository;
pub mod revision;
pub mod runner;
pub mod session;
pub mod status;
pub mod tree;

#[cfg(test)]
pub(crate) static GIT_FIXTURE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
