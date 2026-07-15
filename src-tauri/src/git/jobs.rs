use crate::git::runner::CancellationToken;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GitJobError {
    DuplicateJob,
    StateUnavailable,
}

#[derive(Debug, Clone, Default)]
pub struct GitJobs {
    active: Arc<Mutex<HashMap<(String, u64), CancellationToken>>>,
}

impl GitJobs {
    pub fn start(
        &self,
        repository_session_id: &str,
        job_id: u64,
    ) -> Result<GitJobLease, GitJobError> {
        let key = (repository_session_id.to_string(), job_id);
        let cancellation = CancellationToken::new();
        let mut active = self
            .active
            .lock()
            .map_err(|_| GitJobError::StateUnavailable)?;
        if active.contains_key(&key) {
            return Err(GitJobError::DuplicateJob);
        }
        active.insert(key.clone(), cancellation.clone());
        Ok(GitJobLease {
            jobs: self.clone(),
            key,
            cancellation,
        })
    }

    pub fn cancel(&self, repository_session_id: &str, job_id: u64) -> Result<(), GitJobError> {
        let active = self
            .active
            .lock()
            .map_err(|_| GitJobError::StateUnavailable)?;
        if let Some(cancellation) = active.get(&(repository_session_id.to_string(), job_id)) {
            cancellation.cancel();
        }
        Ok(())
    }

    pub fn cancel_session(&self, repository_session_id: &str) -> Result<(), GitJobError> {
        let active = self
            .active
            .lock()
            .map_err(|_| GitJobError::StateUnavailable)?;
        for ((session_id, _), cancellation) in active.iter() {
            if session_id == repository_session_id {
                cancellation.cancel();
            }
        }
        Ok(())
    }

    pub fn cancel_except(&self, repository_session_id: &str) -> Result<(), GitJobError> {
        let active = self
            .active
            .lock()
            .map_err(|_| GitJobError::StateUnavailable)?;
        for ((session_id, _), cancellation) in active.iter() {
            if session_id != repository_session_id {
                cancellation.cancel();
            }
        }
        Ok(())
    }

    fn finish(&self, key: &(String, u64)) {
        if let Ok(mut active) = self.active.lock() {
            active.remove(key);
        }
    }
}

#[derive(Debug)]
pub struct GitJobLease {
    jobs: GitJobs,
    key: (String, u64),
    cancellation: CancellationToken,
}

impl GitJobLease {
    pub fn cancellation(&self) -> &CancellationToken {
        &self.cancellation
    }
}

impl Drop for GitJobLease {
    fn drop(&mut self) {
        self.jobs.finish(&self.key);
    }
}

#[cfg(test)]
mod tests {
    use super::{GitJobError, GitJobs};

    #[test]
    fn job_ids_are_session_scoped_cancelable_and_reusable_after_completion() {
        let jobs = GitJobs::default();
        let first = jobs.start("session-1", 7).expect("first job");
        let other_session = jobs.start("session-2", 7).expect("other session job");
        assert!(matches!(
            jobs.start("session-1", 7),
            Err(GitJobError::DuplicateJob)
        ));

        jobs.cancel("session-1", 7).expect("cancel first job");
        assert!(first.cancellation().is_cancelled());
        assert!(!other_session.cancellation().is_cancelled());

        drop(first);
        let replacement = jobs.start("session-1", 7).expect("reused completed job ID");
        assert!(!replacement.cancellation().is_cancelled());
    }

    #[test]
    fn repository_replacement_or_close_cancels_only_matching_jobs() {
        let jobs = GitJobs::default();
        let first = jobs.start("session-1", 1).expect("first job");
        let second = jobs.start("session-2", 2).expect("second job");

        jobs.cancel_session("session-1").expect("cancel session");
        assert!(first.cancellation().is_cancelled());
        assert!(!second.cancellation().is_cancelled());

        jobs.cancel_except("session-1")
            .expect("cancel replaced jobs");
        assert!(second.cancellation().is_cancelled());
    }
}
