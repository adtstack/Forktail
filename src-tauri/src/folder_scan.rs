use crate::commands::folders::{
    EntryRecord, compare_entry, mark_scan_cancelled, release_scan_cancel, update_stats,
    validate_root, visit_entries,
};
use crate::domain::models::{
    FolderCompareMode, FolderEntry, FolderEntryResolution, FolderEntryStatus, FolderEntryUpsert,
    FolderScanAck, FolderScanBatch, FolderScanMessage, FolderScanMessagePayload, FolderScanOptions,
    FolderScanPhase, FolderScanProgressSnapshot, FolderScanStarted, FolderScanStats,
    FolderScanTerminal, FsEntryKind, PendingReason, StartFolderScanRequest,
};
use crate::error::{AppErrorCode, CommandError, CommandResult};
use std::collections::{BTreeMap, HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{Receiver, SyncSender, TrySendError, sync_channel};
use std::sync::{Arc, Condvar, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};
use tauri::ipc::Channel;

const INVENTORY_QUEUE_CAPACITY: usize = 512;
const MAX_BATCH_ROWS: usize = 256;
const MAX_BATCH_BYTES: usize = 256 * 1024;
const MAX_UNACKNOWLEDGED_BATCHES: usize = 4;
const MAX_UNACKNOWLEDGED_BYTES: usize = 1024 * 1024;
const BATCH_FLUSH_INTERVAL: Duration = Duration::from_millis(50);
const PROGRESS_INTERVAL: Duration = Duration::from_millis(100);
const WAIT_POLL_INTERVAL: Duration = Duration::from_millis(10);

static NEXT_FOLDER_SCAN_JOB_ID: AtomicU64 = AtomicU64::new(1);
static FOLDER_SCAN_JOBS: OnceLock<FolderScanJobs> = OnceLock::new();

pub(crate) fn start(
    owner_label: String,
    request: StartFolderScanRequest,
    on_event: Channel<FolderScanMessage>,
) -> CommandResult<FolderScanStarted> {
    if request.scan_generation == 0 {
        return Err(CommandError::new(
            AppErrorCode::ScanFailed,
            "폴더 비교 실행 정보가 올바르지 않습니다. 다시 시작하세요.",
        ));
    }

    let left_path = validate_root(&request.left_root, "왼쪽")?;
    let right_path = validate_root(&request.right_root, "오른쪽")?;
    let job_id = NEXT_FOLDER_SCAN_JOB_ID.fetch_add(1, Ordering::Relaxed);
    let job = jobs().register(job_id, request.scan_generation, owner_label);
    let started = FolderScanStarted {
        job_id,
        scan_generation: request.scan_generation,
        left_root: left_path.to_string_lossy().into_owned(),
        right_root: right_path.to_string_lossy().into_owned(),
        options_fingerprint: options_fingerprint(&request.options),
    };
    let options = request.options;
    let sink: Arc<dyn MessageSink> = Arc::new(ChannelMessageSink::new(on_event));

    tauri::async_runtime::spawn_blocking(move || {
        run_registered_job(job, left_path, right_path, options, sink);
    });

    Ok(started)
}

pub(crate) fn acknowledge(owner_label: &str, ack: FolderScanAck) -> CommandResult<()> {
    let job = jobs().owned_job(owner_label, ack.job_id, ack.scan_generation)?;
    job.acknowledge(ack.applied_through_sequence)
}

pub(crate) fn cancel(owner_label: &str, job_id: u64, scan_generation: u64) -> CommandResult<()> {
    let job = jobs().owned_job(owner_label, job_id, scan_generation)?;
    job.cancel();
    Ok(())
}

pub(crate) fn cancel_owner(owner_label: &str) {
    jobs().cancel_owner(owner_label);
}

fn run_registered_job(
    job: Arc<JobControl>,
    left_root: PathBuf,
    right_root: PathBuf,
    options: FolderScanOptions,
    sink: Arc<dyn MessageSink>,
) {
    let started_at = Instant::now();
    let mut emitter = ScanEmitter::new(job.clone(), sink);
    let result = run_progressive_scan(&job, left_root, right_root, options, &mut emitter);

    let duration_ms = started_at.elapsed().as_millis();
    let progress = emitter.progress.clone();
    let terminal = match result {
        Ok(summary) => FolderScanTerminal::Completed {
            stats: summary.stats,
            entry_count: summary.entry_count,
            duration_ms,
        },
        Err(error) if error.code == AppErrorCode::Cancelled => FolderScanTerminal::Cancelled {
            finalized: progress.finalized,
            pending: progress.pending,
            duration_ms,
        },
        Err(error) => FolderScanTerminal::Failed {
            code: serialized_error_code(error.code),
            message: error.message,
            finalized: progress.finalized,
            pending: progress.pending,
            duration_ms,
        },
    };

    let _ = emitter.flush_batch();
    let _ = emitter.send_terminal(terminal);
    jobs().remove(job.job_id);
    release_scan_cancel(job.job_id);
}

#[derive(Debug)]
struct ScanSummary {
    stats: FolderScanStats,
    entry_count: usize,
}

fn run_progressive_scan(
    job: &Arc<JobControl>,
    left_root: PathBuf,
    right_root: PathBuf,
    options: FolderScanOptions,
    emitter: &mut ScanEmitter,
) -> CommandResult<ScanSummary> {
    let (sender, receiver) = sync_channel(INVENTORY_QUEUE_CAPACITY);
    let left_job = job.clone();
    let right_job = job.clone();
    let left_options = options.clone();
    let right_options = options.clone();
    let left_sender = sender.clone();
    let right_sender = sender.clone();

    thread::scope(|scope| {
        scope.spawn(move || {
            run_inventory_producer(
                InventorySide::Left,
                left_root,
                left_options,
                left_job,
                left_sender,
            );
        });
        scope.spawn(move || {
            run_inventory_producer(
                InventorySide::Right,
                right_root,
                right_options,
                right_job,
                right_sender,
            );
        });
        drop(sender);
        coordinate_inventory(job, receiver, options.compare_mode, emitter)
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum InventorySide {
    Left,
    Right,
}

enum InventoryEvent {
    Entry {
        side: InventorySide,
        relative_path: String,
        record: EntryRecord,
    },
    Finished {
        side: InventorySide,
        result: CommandResult<()>,
    },
}

fn run_inventory_producer(
    side: InventorySide,
    root: PathBuf,
    options: FolderScanOptions,
    job: Arc<JobControl>,
    sender: SyncSender<InventoryEvent>,
) {
    let result = visit_entries(
        &root,
        &options,
        || job.check_cancelled(),
        |relative_path, record| {
            send_inventory_event(
                &job,
                &sender,
                InventoryEvent::Entry {
                    side,
                    relative_path,
                    record,
                },
            )
        },
    );
    let _ = send_inventory_event(&job, &sender, InventoryEvent::Finished { side, result });
}

fn send_inventory_event(
    job: &JobControl,
    sender: &SyncSender<InventoryEvent>,
    mut event: InventoryEvent,
) -> CommandResult<()> {
    loop {
        job.check_cancelled()?;
        match sender.try_send(event) {
            Ok(()) => return Ok(()),
            Err(TrySendError::Full(returned)) => {
                event = returned;
                thread::sleep(Duration::from_millis(1));
            }
            Err(TrySendError::Disconnected(_)) => {
                return Err(CommandError::new(
                    AppErrorCode::ScanFailed,
                    "폴더 비교 작업 연결이 종료됐습니다. 다시 스캔하세요.",
                ));
            }
        }
    }
}

#[derive(Default)]
struct PartialPair {
    left: Option<EntryRecord>,
    right: Option<EntryRecord>,
    revision: u64,
    resolution: Option<FolderEntryResolution>,
    final_status: Option<FolderEntryStatus>,
}

fn coordinate_inventory(
    job: &Arc<JobControl>,
    receiver: Receiver<InventoryEvent>,
    compare_mode: FolderCompareMode,
    emitter: &mut ScanEmitter,
) -> CommandResult<ScanSummary> {
    let mut pairs = BTreeMap::<String, PartialPair>::new();
    let mut stats = FolderScanStats::default();
    let mut left_done = false;
    let mut right_done = false;

    while !left_done || !right_done {
        job.check_cancelled()?;
        match receiver.recv_timeout(WAIT_POLL_INTERVAL) {
            Ok(InventoryEvent::Entry {
                side,
                relative_path,
                record,
            }) => {
                let pair = pairs.entry(relative_path.clone()).or_default();
                match side {
                    InventorySide::Left => pair.left = Some(record),
                    InventorySide::Right => pair.right = Some(record),
                }
                let upsert = transition_pair(
                    &relative_path,
                    pair,
                    &mut stats,
                    PairResolutionContext {
                        left_done,
                        right_done,
                        compare_mode,
                        job_id: job.job_id,
                        resolve_hash: false,
                    },
                )?;
                emitter.progress.discovered = pairs.len();
                emitter.progress.pending = pairs.len().saturating_sub(emitter.progress.finalized);
                if let FolderEntryResolution::Final { status } = upsert.resolution {
                    emitter.progress.finalized += 1;
                    if status == FolderEntryStatus::Error {
                        emitter.progress.errors += 1;
                    }
                    emitter.progress.pending =
                        pairs.len().saturating_sub(emitter.progress.finalized);
                }
                emitter.push_upsert(upsert)?;
            }
            Ok(InventoryEvent::Finished { side, result }) => {
                result?;
                match side {
                    InventorySide::Left => left_done = true,
                    InventorySide::Right => right_done = true,
                }
                finalize_known_one_sided(
                    &mut pairs,
                    &mut stats,
                    emitter,
                    PairResolutionContext {
                        left_done,
                        right_done,
                        compare_mode,
                        job_id: job.job_id,
                        resolve_hash: false,
                    },
                )?;
            }
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                emitter.flush_if_due()?;
            }
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                if !left_done || !right_done {
                    return Err(CommandError::new(
                        AppErrorCode::ScanFailed,
                        "폴더 순회 작업이 예기치 않게 종료됐습니다. 다시 스캔하세요.",
                    ));
                }
            }
        }
        emitter.maybe_send_progress(false)?;
    }

    emitter.progress.phase = FolderScanPhase::Classify;
    finalize_known_one_sided(
        &mut pairs,
        &mut stats,
        emitter,
        PairResolutionContext {
            left_done: true,
            right_done: true,
            compare_mode,
            job_id: job.job_id,
            resolve_hash: false,
        },
    )?;

    let hash_candidates = pairs
        .values()
        .filter(|pair| {
            matches!(
                pair.resolution,
                Some(FolderEntryResolution::Pending {
                    reason: PendingReason::AwaitingHash
                })
            )
        })
        .count();
    emitter.progress.hash_candidates = Some(hash_candidates);
    emitter.maybe_send_progress(true)?;

    if hash_candidates > 0 {
        emitter.progress.phase = FolderScanPhase::Hash;
        emitter.maybe_send_progress(true)?;
        let paths = pairs
            .iter()
            .filter_map(|(path, pair)| {
                matches!(
                    pair.resolution,
                    Some(FolderEntryResolution::Pending {
                        reason: PendingReason::AwaitingHash
                    })
                )
                .then_some(path.clone())
            })
            .collect::<Vec<_>>();
        for relative_path in paths {
            job.check_cancelled()?;
            let pair = pairs
                .get_mut(&relative_path)
                .ok_or_else(|| internal_scan_error("해시 대상을 찾지 못했습니다."))?;
            let upsert = transition_pair(
                &relative_path,
                pair,
                &mut stats,
                PairResolutionContext {
                    left_done: true,
                    right_done: true,
                    compare_mode,
                    job_id: job.job_id,
                    resolve_hash: true,
                },
            )?;
            job.check_cancelled()?;
            emitter.progress.hashed_files += 2;
            emitter.progress.finalized += 1;
            if matches!(
                upsert.resolution,
                FolderEntryResolution::Final {
                    status: FolderEntryStatus::Error
                }
            ) {
                emitter.progress.errors += 1;
            }
            emitter.progress.pending = pairs.len().saturating_sub(emitter.progress.finalized);
            emitter.push_upsert(upsert)?;
            emitter.maybe_send_progress(false)?;
        }
    }

    emitter.progress.pending = 0;
    emitter.progress.finalized = pairs.len();
    emitter.flush_batch()?;
    emitter.maybe_send_progress(true)?;

    Ok(ScanSummary {
        stats,
        entry_count: pairs.len(),
    })
}

fn finalize_known_one_sided(
    pairs: &mut BTreeMap<String, PartialPair>,
    stats: &mut FolderScanStats,
    emitter: &mut ScanEmitter,
    context: PairResolutionContext,
) -> CommandResult<()> {
    let paths = pairs
        .iter()
        .filter_map(|(path, pair)| {
            let can_finalize = (pair.left.is_some() && pair.right.is_none() && context.right_done)
                || (pair.right.is_some() && pair.left.is_none() && context.left_done);
            (can_finalize && pair.final_status.is_none()).then_some(path.clone())
        })
        .collect::<Vec<_>>();

    for relative_path in paths {
        let pair = pairs
            .get_mut(&relative_path)
            .ok_or_else(|| internal_scan_error("단독 항목을 찾지 못했습니다."))?;
        let upsert = transition_pair(&relative_path, pair, stats, context)?;
        emitter.progress.finalized += 1;
        if matches!(
            upsert.resolution,
            FolderEntryResolution::Final {
                status: FolderEntryStatus::Error
            }
        ) {
            emitter.progress.errors += 1;
        }
        emitter.progress.pending = pairs.len().saturating_sub(emitter.progress.finalized);
        emitter.push_upsert(upsert)?;
    }
    Ok(())
}

#[derive(Clone, Copy)]
struct PairResolutionContext {
    left_done: bool,
    right_done: bool,
    compare_mode: FolderCompareMode,
    job_id: u64,
    resolve_hash: bool,
}

fn transition_pair(
    relative_path: &str,
    pair: &mut PartialPair,
    stats: &mut FolderScanStats,
    context: PairResolutionContext,
) -> CommandResult<FolderEntryUpsert> {
    if let Some(status) = pair.final_status.take() {
        decrement_stats(stats, status);
    }

    let final_entry = if let (Some(left), Some(right)) = (&pair.left, &pair.right) {
        let requires_hash = left.error_message.is_none()
            && right.error_message.is_none()
            && left.meta.kind == FsEntryKind::File
            && right.meta.kind == FsEntryKind::File
            && left.meta.size == right.meta.size
            && matches!(
                context.compare_mode,
                FolderCompareMode::QuickHash | FolderCompareMode::FullHash
            );
        if requires_hash && !context.resolve_hash {
            None
        } else {
            Some(compare_entry(
                relative_path.to_string(),
                pair.left.as_ref(),
                pair.right.as_ref(),
                context.compare_mode,
                Some(context.job_id),
            ))
        }
    } else if (pair.left.is_some() && context.right_done)
        || (pair.right.is_some() && context.left_done)
    {
        Some(compare_entry(
            relative_path.to_string(),
            pair.left.as_ref(),
            pair.right.as_ref(),
            context.compare_mode,
            Some(context.job_id),
        ))
    } else {
        None
    };

    pair.revision += 1;
    let upsert = match final_entry {
        Some(entry) => {
            update_stats(stats, &entry.status);
            pair.final_status = Some(entry.status);
            pair.resolution = Some(FolderEntryResolution::Final {
                status: entry.status,
            });
            final_entry_upsert(pair.revision, entry)
        }
        None => {
            let reason = if pair.left.is_some() && pair.right.is_some() {
                PendingReason::AwaitingHash
            } else {
                PendingReason::AwaitingPeer
            };
            pair.resolution = Some(FolderEntryResolution::Pending { reason });
            pending_upsert(relative_path, pair, reason)
        }
    };
    Ok(upsert)
}

fn pending_upsert(
    relative_path: &str,
    pair: &PartialPair,
    reason: PendingReason,
) -> FolderEntryUpsert {
    FolderEntryUpsert {
        relative_path: relative_path.to_string(),
        revision: pair.revision,
        left_path: pair
            .left
            .as_ref()
            .map(|entry| entry.path.to_string_lossy().into_owned()),
        right_path: pair
            .right
            .as_ref()
            .map(|entry| entry.path.to_string_lossy().into_owned()),
        left: pair.left.as_ref().map(|entry| entry.meta.clone()),
        right: pair.right.as_ref().map(|entry| entry.meta.clone()),
        resolution: FolderEntryResolution::Pending { reason },
        message: None,
    }
}

fn final_entry_upsert(revision: u64, entry: FolderEntry) -> FolderEntryUpsert {
    FolderEntryUpsert {
        relative_path: entry.relative_path,
        revision,
        left_path: entry.left_path,
        right_path: entry.right_path,
        left: entry.left,
        right: entry.right,
        resolution: FolderEntryResolution::Final {
            status: entry.status,
        },
        message: entry.message,
    }
}

fn decrement_stats(stats: &mut FolderScanStats, status: FolderEntryStatus) {
    match status {
        FolderEntryStatus::Same => stats.same = stats.same.saturating_sub(1),
        FolderEntryStatus::Different => stats.different = stats.different.saturating_sub(1),
        FolderEntryStatus::LeftOnly => stats.left_only = stats.left_only.saturating_sub(1),
        FolderEntryStatus::RightOnly => stats.right_only = stats.right_only.saturating_sub(1),
        FolderEntryStatus::TypeMismatch => {
            stats.type_mismatch = stats.type_mismatch.saturating_sub(1);
        }
        FolderEntryStatus::Error => stats.errors = stats.errors.saturating_sub(1),
    }
}

trait MessageSink: Send + Sync {
    fn send(&self, message: FolderScanMessage) -> CommandResult<()>;
}

struct ChannelMessageSink {
    channel: Mutex<Channel<FolderScanMessage>>,
}

impl ChannelMessageSink {
    fn new(channel: Channel<FolderScanMessage>) -> Self {
        Self {
            channel: Mutex::new(channel),
        }
    }
}

impl MessageSink for ChannelMessageSink {
    fn send(&self, message: FolderScanMessage) -> CommandResult<()> {
        self.channel
            .lock()
            .expect("folder scan channel lock")
            .send(message)
            .map_err(|_| {
                CommandError::new(
                    AppErrorCode::ScanFailed,
                    "폴더 비교 결과를 화면에 전달하지 못했습니다. 다시 스캔하세요.",
                )
            })
    }
}

struct ScanEmitter {
    job: Arc<JobControl>,
    sink: Arc<dyn MessageSink>,
    next_sequence: u64,
    batch: Vec<FolderEntryUpsert>,
    batch_bytes: usize,
    last_batch_flush: Instant,
    last_progress_sent: Instant,
    progress: FolderScanProgressSnapshot,
}

impl ScanEmitter {
    fn new(job: Arc<JobControl>, sink: Arc<dyn MessageSink>) -> Self {
        let now = Instant::now();
        Self {
            job,
            sink,
            next_sequence: 1,
            batch: Vec::with_capacity(MAX_BATCH_ROWS),
            batch_bytes: 0,
            last_batch_flush: now,
            last_progress_sent: now,
            progress: FolderScanProgressSnapshot::default(),
        }
    }

    fn push_upsert(&mut self, upsert: FolderEntryUpsert) -> CommandResult<()> {
        let estimated = estimate_upsert_bytes(&upsert);
        if !self.batch.is_empty()
            && (self.batch.len() >= MAX_BATCH_ROWS
                || self.batch_bytes.saturating_add(estimated) > MAX_BATCH_BYTES)
        {
            self.flush_batch()?;
        }
        self.batch_bytes = self.batch_bytes.saturating_add(estimated);
        self.batch.push(upsert);
        if self.batch.len() >= MAX_BATCH_ROWS
            || self.batch_bytes >= MAX_BATCH_BYTES
            || self.last_batch_flush.elapsed() >= BATCH_FLUSH_INTERVAL
        {
            self.flush_batch()?;
        }
        Ok(())
    }

    fn flush_if_due(&mut self) -> CommandResult<()> {
        if !self.batch.is_empty() && self.last_batch_flush.elapsed() >= BATCH_FLUSH_INTERVAL {
            self.flush_batch()?;
        }
        Ok(())
    }

    fn flush_batch(&mut self) -> CommandResult<()> {
        if self.batch.is_empty() {
            return Ok(());
        }
        self.job.check_cancelled()?;
        let sequence = self.next_sequence;
        let estimated_bytes = self.batch_bytes;
        self.job.reserve_batch(sequence, estimated_bytes)?;
        self.next_sequence += 1;
        let message = FolderScanMessage {
            job_id: self.job.job_id,
            scan_generation: self.job.scan_generation,
            sequence,
            payload: FolderScanMessagePayload::Batch(FolderScanBatch {
                upserts: std::mem::take(&mut self.batch),
                estimated_bytes,
            }),
        };
        self.batch = Vec::with_capacity(MAX_BATCH_ROWS);
        self.batch_bytes = 0;
        self.last_batch_flush = Instant::now();
        self.sink.send(message)
    }

    fn maybe_send_progress(&mut self, force: bool) -> CommandResult<()> {
        if !force && self.last_progress_sent.elapsed() < PROGRESS_INTERVAL {
            return Ok(());
        }
        self.flush_if_due()?;
        self.job.check_cancelled()?;
        let message = FolderScanMessage {
            job_id: self.job.job_id,
            scan_generation: self.job.scan_generation,
            sequence: self.take_sequence(),
            payload: FolderScanMessagePayload::Progress(self.progress.clone()),
        };
        self.last_progress_sent = Instant::now();
        self.sink.send(message)
    }

    fn send_terminal(&mut self, terminal: FolderScanTerminal) -> CommandResult<()> {
        if !self.job.claim_terminal() {
            return Ok(());
        }
        let message = FolderScanMessage {
            job_id: self.job.job_id,
            scan_generation: self.job.scan_generation,
            sequence: self.take_sequence(),
            payload: FolderScanMessagePayload::Terminal(terminal),
        };
        self.sink.send(message)
    }

    fn take_sequence(&mut self) -> u64 {
        let sequence = self.next_sequence;
        self.next_sequence += 1;
        sequence
    }
}

fn estimate_upsert_bytes(upsert: &FolderEntryUpsert) -> usize {
    serde_json::to_vec(upsert)
        .map(|value| value.len().saturating_add(32))
        .unwrap_or(MAX_BATCH_BYTES)
        .min(MAX_BATCH_BYTES)
}

#[derive(Default)]
struct AckState {
    acknowledged_through: u64,
    last_batch_sequence: u64,
    in_flight: VecDeque<(u64, usize)>,
    in_flight_bytes: usize,
    max_in_flight_batches: usize,
    max_in_flight_bytes: usize,
}

struct JobControl {
    job_id: u64,
    scan_generation: u64,
    owner_label: String,
    cancelled: AtomicBool,
    terminal_sent: AtomicBool,
    ack: Mutex<AckState>,
    ack_changed: Condvar,
}

impl JobControl {
    fn new(job_id: u64, scan_generation: u64, owner_label: String) -> Self {
        Self {
            job_id,
            scan_generation,
            owner_label,
            cancelled: AtomicBool::new(false),
            terminal_sent: AtomicBool::new(false),
            ack: Mutex::new(AckState::default()),
            ack_changed: Condvar::new(),
        }
    }

    fn check_cancelled(&self) -> CommandResult<()> {
        if self.cancelled.load(Ordering::Acquire) {
            return Err(CommandError::new(
                AppErrorCode::Cancelled,
                "폴더 스캔을 취소했습니다.",
            ));
        }
        Ok(())
    }

    fn cancel(&self) {
        self.cancelled.store(true, Ordering::Release);
        mark_scan_cancelled(self.job_id);
        self.ack_changed.notify_all();
    }

    fn reserve_batch(&self, sequence: u64, estimated_bytes: usize) -> CommandResult<()> {
        let mut state = self.ack.lock().expect("folder scan ack lock");
        loop {
            self.check_cancelled()?;
            let has_batch_credit = state.in_flight.len() < MAX_UNACKNOWLEDGED_BATCHES;
            let has_byte_credit =
                state.in_flight_bytes.saturating_add(estimated_bytes) <= MAX_UNACKNOWLEDGED_BYTES;
            if has_batch_credit && has_byte_credit {
                state.last_batch_sequence = sequence;
                state.in_flight.push_back((sequence, estimated_bytes));
                state.in_flight_bytes = state.in_flight_bytes.saturating_add(estimated_bytes);
                state.max_in_flight_batches =
                    state.max_in_flight_batches.max(state.in_flight.len());
                state.max_in_flight_bytes = state.max_in_flight_bytes.max(state.in_flight_bytes);
                return Ok(());
            }
            let (next, _) = self
                .ack_changed
                .wait_timeout(state, WAIT_POLL_INTERVAL)
                .expect("folder scan ack wait");
            state = next;
        }
    }

    fn acknowledge(&self, sequence: u64) -> CommandResult<()> {
        let mut state = self.ack.lock().expect("folder scan ack lock");
        if sequence <= state.acknowledged_through {
            return Ok(());
        }
        if sequence > state.last_batch_sequence {
            return Err(CommandError::new(
                AppErrorCode::ScanFailed,
                "폴더 비교 확인 순서가 올바르지 않습니다. 다시 스캔하세요.",
            ));
        }
        state.acknowledged_through = sequence;
        while let Some((batch_sequence, bytes)) = state.in_flight.front().copied() {
            if batch_sequence > sequence {
                break;
            }
            state.in_flight.pop_front();
            state.in_flight_bytes = state.in_flight_bytes.saturating_sub(bytes);
        }
        self.ack_changed.notify_all();
        Ok(())
    }

    fn claim_terminal(&self) -> bool {
        self.terminal_sent
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
    }
}

struct FolderScanJobs {
    jobs: Mutex<HashMap<u64, Arc<JobControl>>>,
}

impl FolderScanJobs {
    fn register(&self, job_id: u64, scan_generation: u64, owner_label: String) -> Arc<JobControl> {
        let job = Arc::new(JobControl::new(
            job_id,
            scan_generation,
            owner_label.clone(),
        ));
        let mut jobs = self.jobs.lock().expect("folder scan jobs lock");
        for existing in jobs.values().filter(|item| item.owner_label == owner_label) {
            existing.cancel();
        }
        jobs.insert(job_id, job.clone());
        job
    }

    fn owned_job(
        &self,
        owner_label: &str,
        job_id: u64,
        scan_generation: u64,
    ) -> CommandResult<Arc<JobControl>> {
        let jobs = self.jobs.lock().expect("folder scan jobs lock");
        let job = jobs.get(&job_id).ok_or_else(|| {
            CommandError::new(
                AppErrorCode::Cancelled,
                "이 폴더 비교 작업은 이미 종료됐습니다.",
            )
        })?;
        if job.owner_label != owner_label || job.scan_generation != scan_generation {
            return Err(CommandError::new(
                AppErrorCode::ScanFailed,
                "현재 화면과 일치하지 않는 폴더 비교 작업입니다.",
            ));
        }
        Ok(job.clone())
    }

    fn cancel_owner(&self, owner_label: &str) {
        let jobs = self.jobs.lock().expect("folder scan jobs lock");
        for job in jobs.values().filter(|item| item.owner_label == owner_label) {
            job.cancel();
        }
    }

    fn remove(&self, job_id: u64) {
        self.jobs
            .lock()
            .expect("folder scan jobs lock")
            .remove(&job_id);
    }
}

fn jobs() -> &'static FolderScanJobs {
    FOLDER_SCAN_JOBS.get_or_init(|| FolderScanJobs {
        jobs: Mutex::new(HashMap::new()),
    })
}

fn options_fingerprint(options: &FolderScanOptions) -> String {
    let mode = match options.compare_mode {
        FolderCompareMode::Metadata => "metadata",
        FolderCompareMode::QuickHash => "quickHash",
        FolderCompareMode::FullHash => "fullHash",
    };
    format!(
        "{mode}:{}:{}:{}",
        u8::from(options.include_hidden),
        u8::from(options.respect_gitignore),
        u8::from(options.follow_symlinks)
    )
}

fn serialized_error_code(code: AppErrorCode) -> String {
    serde_json::to_value(code)
        .ok()
        .and_then(|value| value.as_str().map(str::to_string))
        .unwrap_or_else(|| "SCAN_FAILED".to_string())
}

fn internal_scan_error(message: &str) -> CommandError {
    CommandError::new(AppErrorCode::ScanFailed, message)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::folders::scan_directories_reference;
    use std::fs;
    use std::io::Write;

    struct RecordingSink {
        job: Arc<JobControl>,
        messages: Mutex<Vec<FolderScanMessage>>,
    }

    struct MutatingSink {
        inner: RecordingSink,
        remove_on_classify: PathBuf,
        removed: AtomicBool,
    }

    struct CancellingHashSink {
        inner: RecordingSink,
        cancelled: AtomicBool,
    }

    #[derive(Default)]
    struct BenchmarkStats {
        first_batch: Option<Duration>,
        first_200_rows: Option<Duration>,
        terminal: Option<Duration>,
        received_upserts: usize,
        batch_count: usize,
        max_batch_rows: usize,
        max_batch_bytes: usize,
        latest_rows: BTreeMap<String, FolderEntryUpsert>,
        terminal_value: Option<FolderScanTerminal>,
    }

    struct BenchmarkSink {
        job: Arc<JobControl>,
        started: Instant,
        stats: Mutex<BenchmarkStats>,
    }

    impl MessageSink for BenchmarkSink {
        fn send(&self, message: FolderScanMessage) -> CommandResult<()> {
            let elapsed = self.started.elapsed();
            let mut stats = self.stats.lock().expect("benchmark stats");
            match message.payload {
                FolderScanMessagePayload::Batch(batch) => {
                    stats.first_batch.get_or_insert(elapsed);
                    stats.received_upserts =
                        stats.received_upserts.saturating_add(batch.upserts.len());
                    stats.batch_count += 1;
                    stats.max_batch_rows = stats.max_batch_rows.max(batch.upserts.len());
                    stats.max_batch_bytes = stats.max_batch_bytes.max(batch.estimated_bytes);
                    for upsert in batch.upserts {
                        let should_replace = stats
                            .latest_rows
                            .get(&upsert.relative_path)
                            .is_none_or(|current| current.revision < upsert.revision);
                        if should_replace {
                            stats
                                .latest_rows
                                .insert(upsert.relative_path.clone(), upsert);
                        }
                    }
                    if stats.latest_rows.len() >= 200 {
                        stats.first_200_rows.get_or_insert(elapsed);
                    }
                    drop(stats);
                    self.job.acknowledge(message.sequence)
                }
                FolderScanMessagePayload::Terminal(terminal) => {
                    stats.terminal = Some(elapsed);
                    stats.terminal_value = Some(terminal);
                    Ok(())
                }
                FolderScanMessagePayload::Progress(_) => Ok(()),
            }
        }
    }

    #[derive(Default)]
    struct CancellationBenchmarkStats {
        requested_at: Option<Duration>,
        terminal_at: Option<Duration>,
        terminal_value: Option<FolderScanTerminal>,
    }

    struct CancellationBenchmarkSink {
        job: Arc<JobControl>,
        started: Instant,
        stats: Mutex<CancellationBenchmarkStats>,
    }

    impl MessageSink for CancellationBenchmarkSink {
        fn send(&self, message: FolderScanMessage) -> CommandResult<()> {
            match message.payload {
                FolderScanMessagePayload::Batch(_) => {
                    self.job.acknowledge(message.sequence)?;
                    let mut stats = self.stats.lock().expect("cancellation benchmark stats");
                    if stats.requested_at.is_none() {
                        stats.requested_at = Some(self.started.elapsed());
                        drop(stats);
                        self.job.cancel();
                    }
                    Ok(())
                }
                FolderScanMessagePayload::Terminal(terminal) => {
                    let mut stats = self.stats.lock().expect("cancellation benchmark stats");
                    stats.terminal_at = Some(self.started.elapsed());
                    stats.terminal_value = Some(terminal);
                    Ok(())
                }
                FolderScanMessagePayload::Progress(_) => Ok(()),
            }
        }
    }

    impl MessageSink for CancellingHashSink {
        fn send(&self, message: FolderScanMessage) -> CommandResult<()> {
            if matches!(
                &message.payload,
                FolderScanMessagePayload::Progress(FolderScanProgressSnapshot {
                    phase: FolderScanPhase::Hash,
                    ..
                })
            ) && !self.cancelled.swap(true, Ordering::AcqRel)
            {
                self.inner.job.cancel();
            }
            self.inner.send(message)
        }
    }

    impl MessageSink for MutatingSink {
        fn send(&self, message: FolderScanMessage) -> CommandResult<()> {
            if matches!(
                &message.payload,
                FolderScanMessagePayload::Progress(FolderScanProgressSnapshot {
                    phase: FolderScanPhase::Classify,
                    ..
                })
            ) && !self.removed.swap(true, Ordering::AcqRel)
            {
                fs::remove_file(&self.remove_on_classify).expect("remove hash input");
            }
            self.inner.send(message)
        }
    }

    impl RecordingSink {
        fn new(job: Arc<JobControl>) -> Self {
            Self {
                job,
                messages: Mutex::new(Vec::new()),
            }
        }

        fn messages(&self) -> Vec<FolderScanMessage> {
            self.messages.lock().expect("recorded messages").clone()
        }
    }

    impl MessageSink for RecordingSink {
        fn send(&self, message: FolderScanMessage) -> CommandResult<()> {
            if matches!(message.payload, FolderScanMessagePayload::Batch(_)) {
                self.job.acknowledge(message.sequence)?;
            }
            self.messages
                .lock()
                .expect("recorded messages")
                .push(message);
            Ok(())
        }
    }

    #[test]
    fn acknowledgement_releases_bounded_batch_credit() {
        let job = JobControl::new(1, 1, "main".to_string());
        for sequence in 1..=MAX_UNACKNOWLEDGED_BATCHES as u64 {
            job.reserve_batch(sequence, MAX_BATCH_BYTES)
                .expect("reserve bounded batch");
        }
        {
            let state = job.ack.lock().expect("ack state");
            assert_eq!(state.in_flight.len(), MAX_UNACKNOWLEDGED_BATCHES);
            assert_eq!(state.in_flight_bytes, MAX_UNACKNOWLEDGED_BYTES);
        }

        job.acknowledge(2).expect("cumulative acknowledgement");
        let state = job.ack.lock().expect("ack state");
        assert_eq!(state.in_flight.len(), 2);
        assert_eq!(state.in_flight_bytes, MAX_BATCH_BYTES * 2);
    }

    #[test]
    fn cancellation_wakes_a_waiting_batch_reservation() {
        let job = Arc::new(JobControl::new(2, 1, "main".to_string()));
        for sequence in 1..=MAX_UNACKNOWLEDGED_BATCHES as u64 {
            job.reserve_batch(sequence, MAX_BATCH_BYTES)
                .expect("reserve bounded batch");
        }

        let waiting = job.clone();
        let handle = thread::spawn(move || waiting.reserve_batch(5, 1));
        thread::sleep(Duration::from_millis(20));
        job.cancel();

        let error = handle
            .join()
            .expect("waiting thread")
            .expect_err("cancelled reservation");
        assert_eq!(error.code, AppErrorCode::Cancelled);
        release_scan_cancel(job.job_id);
    }

    #[test]
    fn terminal_claim_is_exactly_once() {
        let job = JobControl::new(3, 1, "main".to_string());
        assert!(job.claim_terminal());
        assert!(!job.claim_terminal());
    }

    #[test]
    fn options_fingerprint_changes_for_every_scan_option() {
        let base = FolderScanOptions {
            compare_mode: FolderCompareMode::Metadata,
            include_hidden: false,
            respect_gitignore: false,
            follow_symlinks: false,
        };
        assert_ne!(
            options_fingerprint(&base),
            options_fingerprint(&FolderScanOptions {
                compare_mode: FolderCompareMode::QuickHash,
                ..base.clone()
            })
        );
        assert_ne!(
            options_fingerprint(&base),
            options_fingerprint(&FolderScanOptions {
                include_hidden: true,
                ..base
            })
        );
    }

    #[test]
    fn inventory_emits_pending_then_final_rows_before_one_terminal() {
        let left = tempfile::tempdir().expect("left root");
        let right = tempfile::tempdir().expect("right root");
        fs::create_dir_all(left.path().join("src")).expect("left src");
        fs::create_dir_all(right.path().join("src")).expect("right src");
        fs::write(left.path().join("src/shared.txt"), b"same").expect("left shared");
        fs::write(right.path().join("src/shared.txt"), b"same").expect("right shared");
        fs::write(left.path().join("only-left.txt"), b"left").expect("left only");
        let job = Arc::new(JobControl::new(91, 7, "main".to_string()));
        let sink = Arc::new(RecordingSink::new(job.clone()));

        run_registered_job(
            job,
            left.path().to_path_buf(),
            right.path().to_path_buf(),
            FolderScanOptions {
                compare_mode: FolderCompareMode::QuickHash,
                include_hidden: false,
                respect_gitignore: false,
                follow_symlinks: false,
            },
            sink.clone(),
        );

        let messages = sink.messages();
        let terminal_indexes = messages
            .iter()
            .enumerate()
            .filter_map(|(index, message)| {
                matches!(message.payload, FolderScanMessagePayload::Terminal(_)).then_some(index)
            })
            .collect::<Vec<_>>();
        assert_eq!(terminal_indexes, vec![messages.len() - 1]);
        assert!(
            messages[..terminal_indexes[0]]
                .iter()
                .any(|message| { matches!(message.payload, FolderScanMessagePayload::Batch(_)) })
        );

        let rows = messages
            .iter()
            .flat_map(|message| match &message.payload {
                FolderScanMessagePayload::Batch(batch) => batch.upserts.clone(),
                _ => Vec::new(),
            })
            .collect::<Vec<_>>();
        assert!(rows.iter().any(|row| {
            row.relative_path == "src/shared.txt"
                && matches!(
                    row.resolution,
                    FolderEntryResolution::Pending {
                        reason: PendingReason::AwaitingHash
                    }
                )
        }));
        assert!(rows.iter().any(|row| {
            row.relative_path == "src/shared.txt"
                && matches!(
                    row.resolution,
                    FolderEntryResolution::Final {
                        status: FolderEntryStatus::Same
                    }
                )
        }));
        assert!(rows.iter().any(|row| {
            row.relative_path == "only-left.txt"
                && matches!(
                    row.resolution,
                    FolderEntryResolution::Final {
                        status: FolderEntryStatus::LeftOnly
                    }
                )
        }));
    }

    #[test]
    fn progressive_results_match_one_shot_for_every_compare_mode() {
        for (index, compare_mode) in [
            FolderCompareMode::Metadata,
            FolderCompareMode::QuickHash,
            FolderCompareMode::FullHash,
        ]
        .into_iter()
        .enumerate()
        {
            let left = tempfile::tempdir().expect("left root");
            let right = tempfile::tempdir().expect("right root");
            fs::create_dir_all(left.path().join("nested")).expect("left nested");
            fs::create_dir_all(right.path().join("nested")).expect("right nested");
            fs::write(left.path().join("same.txt"), b"same").expect("left same");
            fs::write(right.path().join("same.txt"), b"same").expect("right same");
            fs::write(left.path().join("changed.txt"), b"alpha").expect("left changed");
            fs::write(right.path().join("changed.txt"), b"bravo").expect("right changed");
            fs::write(left.path().join("size.txt"), b"short").expect("left size");
            fs::write(right.path().join("size.txt"), b"much longer").expect("right size");
            fs::write(left.path().join("only-left.txt"), b"left").expect("left only");
            fs::write(right.path().join("only-right.txt"), b"right").expect("right only");
            fs::create_dir_all(left.path().join("kind-conflict")).expect("left kind dir");
            fs::write(right.path().join("kind-conflict"), b"file").expect("right kind file");
            let options = FolderScanOptions {
                compare_mode,
                include_hidden: false,
                respect_gitignore: false,
                follow_symlinks: false,
            };
            let reference = scan_directories_reference(
                left.path().to_string_lossy().into_owned(),
                right.path().to_string_lossy().into_owned(),
                options.clone(),
                None,
            )
            .expect("one-shot reference");
            let job = Arc::new(JobControl::new(200 + index as u64, 1, "main".to_string()));
            let sink = Arc::new(RecordingSink::new(job.clone()));

            run_registered_job(
                job,
                left.path().to_path_buf(),
                right.path().to_path_buf(),
                options,
                sink.clone(),
            );

            let messages = sink.messages();
            let mut latest_rows = BTreeMap::<String, FolderEntryUpsert>::new();
            for message in &messages {
                if let FolderScanMessagePayload::Batch(batch) = &message.payload {
                    for row in &batch.upserts {
                        let replace = latest_rows
                            .get(&row.relative_path)
                            .is_none_or(|current| current.revision < row.revision);
                        if replace {
                            latest_rows.insert(row.relative_path.clone(), row.clone());
                        }
                    }
                }
            }
            let progressive = latest_rows
                .into_values()
                .map(|row| match row.resolution {
                    FolderEntryResolution::Final { status } => FolderEntry {
                        relative_path: row.relative_path,
                        left_path: row.left_path,
                        right_path: row.right_path,
                        left: row.left,
                        right: row.right,
                        status,
                        message: row.message,
                    },
                    FolderEntryResolution::Pending { .. } => {
                        panic!("completed progressive scan retained a pending row")
                    }
                })
                .collect::<Vec<_>>();
            assert_eq!(
                serde_json::to_value(&progressive).expect("progressive rows"),
                serde_json::to_value(&reference.entries).expect("reference rows")
            );
            let terminal = messages.iter().find_map(|message| match &message.payload {
                FolderScanMessagePayload::Terminal(terminal) => Some(terminal),
                _ => None,
            });
            assert_eq!(
                terminal,
                Some(&FolderScanTerminal::Completed {
                    stats: reference.stats,
                    entry_count: reference.entries.len(),
                    duration_ms: match terminal {
                        Some(FolderScanTerminal::Completed { duration_ms, .. }) => *duration_ms,
                        _ => 0,
                    },
                })
            );
        }
    }

    #[test]
    fn progress_reports_known_counts_without_fabricating_inventory_total() {
        let left = tempfile::tempdir().expect("left root");
        let right = tempfile::tempdir().expect("right root");
        fs::write(left.path().join("same.txt"), b"same").expect("left same");
        fs::write(right.path().join("same.txt"), b"same").expect("right same");
        let job = Arc::new(JobControl::new(250, 1, "main".to_string()));
        let sink = Arc::new(RecordingSink::new(job.clone()));

        run_registered_job(
            job,
            left.path().to_path_buf(),
            right.path().to_path_buf(),
            FolderScanOptions {
                compare_mode: FolderCompareMode::QuickHash,
                include_hidden: false,
                respect_gitignore: false,
                follow_symlinks: false,
            },
            sink.clone(),
        );

        let progress = sink
            .messages()
            .into_iter()
            .filter_map(|message| match message.payload {
                FolderScanMessagePayload::Progress(progress) => Some(progress),
                _ => None,
            })
            .collect::<Vec<_>>();
        assert!(!progress.is_empty());
        assert!(progress.iter().any(|item| item.hash_candidates == Some(1)));
        assert_eq!(progress.last().map(|item| item.pending), Some(0));
        assert_eq!(progress.last().map(|item| item.finalized), Some(1));
    }

    #[test]
    fn hash_failure_is_path_local_and_other_rows_complete() {
        let left = tempfile::tempdir().expect("left root");
        let right = tempfile::tempdir().expect("right root");
        let removed_path = left.path().join("removed.txt");
        fs::write(&removed_path, b"same").expect("left removed");
        fs::write(right.path().join("removed.txt"), b"same").expect("right removed");
        fs::write(left.path().join("kept.txt"), b"kept").expect("left kept");
        fs::write(right.path().join("kept.txt"), b"kept").expect("right kept");
        let job = Arc::new(JobControl::new(260, 1, "main".to_string()));
        let sink = Arc::new(MutatingSink {
            inner: RecordingSink::new(job.clone()),
            remove_on_classify: removed_path,
            removed: AtomicBool::new(false),
        });

        run_registered_job(
            job,
            left.path().to_path_buf(),
            right.path().to_path_buf(),
            FolderScanOptions {
                compare_mode: FolderCompareMode::QuickHash,
                include_hidden: false,
                respect_gitignore: false,
                follow_symlinks: false,
            },
            sink.clone(),
        );

        let rows = sink
            .inner
            .messages()
            .into_iter()
            .flat_map(|message| match message.payload {
                FolderScanMessagePayload::Batch(batch) => batch.upserts,
                _ => Vec::new(),
            })
            .collect::<Vec<_>>();
        assert!(rows.iter().any(|row| {
            row.relative_path == "removed.txt"
                && matches!(
                    row.resolution,
                    FolderEntryResolution::Final {
                        status: FolderEntryStatus::Error
                    }
                )
        }));
        assert!(rows.iter().any(|row| {
            row.relative_path == "kept.txt"
                && matches!(
                    row.resolution,
                    FolderEntryResolution::Final {
                        status: FolderEntryStatus::Same
                    }
                )
        }));
    }

    #[test]
    fn wrong_owner_and_generation_cannot_release_ack_credit() {
        let registry = FolderScanJobs {
            jobs: Mutex::new(HashMap::new()),
        };
        let job = registry.register(300, 5, "main".to_string());
        job.reserve_batch(1, 128).expect("reserve batch");

        let wrong_owner = match registry.owned_job("detached", 300, 5) {
            Ok(_) => panic!("wrong owner must fail"),
            Err(error) => error,
        };
        let wrong_generation = match registry.owned_job("main", 300, 6) {
            Ok(_) => panic!("wrong generation must fail"),
            Err(error) => error,
        };
        assert_eq!(wrong_owner.code, AppErrorCode::ScanFailed);
        assert_eq!(wrong_generation.code, AppErrorCode::ScanFailed);
        assert_eq!(job.ack.lock().expect("ack state").in_flight.len(), 1);
        job.cancel();
        release_scan_cancel(job.job_id);
    }

    #[test]
    fn cancellation_releases_an_inventory_producer_waiting_on_a_full_queue() {
        let (sender, _receiver) = sync_channel(0);
        let job = Arc::new(JobControl::new(301, 1, "main".to_string()));
        let waiting = job.clone();
        let handle = thread::spawn(move || {
            send_inventory_event(
                &waiting,
                &sender,
                InventoryEvent::Entry {
                    side: InventorySide::Left,
                    relative_path: "blocked.txt".to_string(),
                    record: EntryRecord {
                        path: PathBuf::from("blocked.txt"),
                        meta: crate::domain::models::FsEntryMeta {
                            kind: FsEntryKind::File,
                            size: 1,
                            modified_ms: None,
                            hash: None,
                        },
                        error_message: None,
                    },
                },
            )
        });
        thread::sleep(Duration::from_millis(20));
        job.cancel();

        let error = handle
            .join()
            .expect("inventory thread")
            .expect_err("inventory wait should cancel");
        assert_eq!(error.code, AppErrorCode::Cancelled);
        release_scan_cancel(job.job_id);
    }

    #[test]
    fn cancellation_at_hash_phase_emits_cancelled_terminal_without_final_row() {
        let left = tempfile::tempdir().expect("left root");
        let right = tempfile::tempdir().expect("right root");
        fs::write(left.path().join("large.txt"), vec![b'a'; 2 * 1024 * 1024]).expect("left large");
        fs::write(right.path().join("large.txt"), vec![b'a'; 2 * 1024 * 1024])
            .expect("right large");
        let job = Arc::new(JobControl::new(302, 1, "main".to_string()));
        let sink = Arc::new(CancellingHashSink {
            inner: RecordingSink::new(job.clone()),
            cancelled: AtomicBool::new(false),
        });

        run_registered_job(
            job,
            left.path().to_path_buf(),
            right.path().to_path_buf(),
            FolderScanOptions {
                compare_mode: FolderCompareMode::FullHash,
                include_hidden: false,
                respect_gitignore: false,
                follow_symlinks: false,
            },
            sink.clone(),
        );

        let messages = sink.inner.messages();
        assert!(messages.iter().any(|message| {
            matches!(
                message.payload,
                FolderScanMessagePayload::Terminal(FolderScanTerminal::Cancelled { .. })
            )
        }));
        assert!(!messages.iter().any(|message| match &message.payload {
            FolderScanMessagePayload::Batch(batch) => batch.upserts.iter().any(|row| {
                row.relative_path == "large.txt"
                    && matches!(row.resolution, FolderEntryResolution::Final { .. })
            }),
            _ => false,
        }));
    }

    #[test]
    #[ignore = "generated 10k/100k performance fixture; run explicitly with --ignored --nocapture"]
    fn benchmark_progressive_scan_10k_and_100k() {
        const MEASURED_RUNS: usize = 5;

        for (fixture_index, file_count) in [10_000usize, 100_000].into_iter().enumerate() {
            let left = tempfile::tempdir().expect("left benchmark root");
            let right = tempfile::tempdir().expect("right benchmark root");
            let directory_count = file_count.div_ceil(1_000);
            for directory_index in 0..directory_count {
                let directory = format!("group-{directory_index:04}");
                fs::create_dir_all(left.path().join(&directory)).expect("left benchmark group");
                fs::create_dir_all(right.path().join(&directory)).expect("right benchmark group");
            }
            for file_index in 0..file_count {
                let directory = format!("group-{:04}", file_index / 1_000);
                let name = format!("entry-{file_index:06}.txt");
                let root = if file_index % 2 == 0 {
                    left.path()
                } else {
                    right.path()
                };
                fs::write(root.join(directory).join(name), b"x").expect("benchmark file");
            }

            let baseline_rss = peak_rss_bytes();
            let expected_entries = file_count + directory_count;
            let job_base = 100_000 + fixture_index as u64 * 1_000;
            let warmup =
                run_benchmark_iteration(left.path(), right.path(), expected_entries, job_base);
            let rss_delta_mib = warmup
                .rss_after_progressive
                .zip(baseline_rss)
                .map(|(end, start)| end.saturating_sub(start) as f64 / 1024.0 / 1024.0);
            assert!(rss_delta_mib.is_none_or(|value| value <= 250.0));

            let reports = (0..MEASURED_RUNS)
                .map(|iteration| {
                    run_benchmark_iteration(
                        left.path(),
                        right.path(),
                        expected_entries,
                        job_base + 10 + iteration as u64,
                    )
                })
                .collect::<Vec<_>>();
            let first_batch_median = duration_percentile(&reports, |row| row.first_batch, 50);
            let first_batch_p95 = duration_percentile(&reports, |row| row.first_batch, 95);
            let first_200_median = duration_percentile(&reports, |row| row.first_200, 50);
            let first_200_p95 = duration_percentile(&reports, |row| row.first_200, 95);
            let terminal_median = duration_percentile(&reports, |row| row.terminal, 50);
            let terminal_p95 = duration_percentile(&reports, |row| row.terminal, 95);
            let cancellation_median =
                duration_percentile(&reports, |row| row.cancellation_latency, 50);
            let cancellation_p95 =
                duration_percentile(&reports, |row| row.cancellation_latency, 95);
            let max_batch_count = reports.iter().map(|row| row.batch_count).max().unwrap_or(0);
            let max_received_upserts = reports
                .iter()
                .map(|row| row.received_upserts)
                .max()
                .unwrap_or(0);
            let max_batch_rows = reports
                .iter()
                .map(|row| row.max_batch_rows)
                .max()
                .unwrap_or(0);
            let max_batch_bytes = reports
                .iter()
                .map(|row| row.max_batch_bytes)
                .max()
                .unwrap_or(0);
            let max_unacknowledged_batches = reports
                .iter()
                .map(|row| row.max_unacknowledged_batches)
                .max()
                .unwrap_or(0);
            let max_unacknowledged_bytes = reports
                .iter()
                .map(|row| row.max_unacknowledged_bytes)
                .max()
                .unwrap_or(0);

            let mut output = std::io::stdout().lock();
            writeln!(
                output,
                "progressive-folder-scan files={file_count} entries={expected_entries} measured_runs={MEASURED_RUNS} first_batch_median_ms={} first_batch_p95_ms={} first_200_median_ms={} first_200_p95_ms={} terminal_median_ms={} terminal_p95_ms={} max_batches={} max_upserts={} max_batch_rows={} max_batch_kib={:.1} max_unacked_batches={} max_unacked_kib={:.1} cancel_median_ms={} cancel_p95_ms={} parity=ok peak_rss_delta_mib={}",
                first_batch_median.as_millis(),
                first_batch_p95.as_millis(),
                first_200_median.as_millis(),
                first_200_p95.as_millis(),
                terminal_median.as_millis(),
                terminal_p95.as_millis(),
                max_batch_count,
                max_received_upserts,
                max_batch_rows,
                max_batch_bytes as f64 / 1024.0,
                max_unacknowledged_batches,
                max_unacknowledged_bytes as f64 / 1024.0,
                cancellation_median.as_millis(),
                cancellation_p95.as_millis(),
                rss_delta_mib.map_or_else(|| "n/a".to_string(), |value| format!("{value:.1}")),
            )
            .expect("write benchmark result");
        }
    }

    struct BenchmarkReport {
        first_batch: Duration,
        first_200: Duration,
        terminal: Duration,
        batch_count: usize,
        received_upserts: usize,
        max_batch_rows: usize,
        max_batch_bytes: usize,
        max_unacknowledged_batches: usize,
        max_unacknowledged_bytes: usize,
        cancellation_latency: Duration,
        rss_after_progressive: Option<u64>,
    }

    fn run_benchmark_iteration(
        left_root: &std::path::Path,
        right_root: &std::path::Path,
        expected_entries: usize,
        job_id: u64,
    ) -> BenchmarkReport {
        let options = FolderScanOptions {
            compare_mode: FolderCompareMode::Metadata,
            include_hidden: false,
            respect_gitignore: false,
            follow_symlinks: false,
        };
        let job = Arc::new(JobControl::new(job_id, 1, "benchmark".to_string()));
        let sink = Arc::new(BenchmarkSink {
            job: job.clone(),
            started: Instant::now(),
            stats: Mutex::new(BenchmarkStats::default()),
        });
        run_registered_job(
            job.clone(),
            left_root.to_path_buf(),
            right_root.to_path_buf(),
            options.clone(),
            sink.clone(),
        );
        let rss_after_progressive = peak_rss_bytes();
        let stats = sink.stats.lock().expect("benchmark result");
        let ack = job.ack.lock().expect("benchmark ack state");
        let terminal_count = match &stats.terminal_value {
            Some(FolderScanTerminal::Completed { entry_count, .. }) => *entry_count,
            terminal => panic!("unexpected benchmark terminal: {terminal:?}"),
        };
        let first_batch = stats.first_batch.expect("benchmark first batch");
        let first_200 = stats.first_200_rows.expect("benchmark first 200 rows");
        let terminal = stats.terminal.expect("benchmark terminal time");
        let terminal_stats = match &stats.terminal_value {
            Some(FolderScanTerminal::Completed { stats, .. }) => stats.clone(),
            terminal => panic!("unexpected benchmark terminal: {terminal:?}"),
        };
        let progressive_entries = final_benchmark_entries(&stats.latest_rows);
        let batch_count = stats.batch_count;
        let received_upserts = stats.received_upserts;
        let max_batch_rows = stats.max_batch_rows;
        let max_batch_bytes = stats.max_batch_bytes;
        let max_unacknowledged_batches = ack.max_in_flight_batches;
        let max_unacknowledged_bytes = ack.max_in_flight_bytes;
        drop(ack);
        drop(stats);

        assert_eq!(terminal_count, expected_entries);
        assert!(first_batch < terminal);
        assert!(first_200 < terminal);
        assert!(max_batch_rows <= MAX_BATCH_ROWS);
        assert!(max_batch_bytes <= MAX_BATCH_BYTES);
        assert!(max_unacknowledged_batches <= MAX_UNACKNOWLEDGED_BATCHES);
        assert!(max_unacknowledged_bytes <= MAX_UNACKNOWLEDGED_BYTES);

        let reference = scan_directories_reference(
            left_root.to_string_lossy().into_owned(),
            right_root.to_string_lossy().into_owned(),
            options.clone(),
            None,
        )
        .expect("benchmark one-shot reference");
        assert_eq!(terminal_stats, reference.stats);
        assert_benchmark_entries_equal(&progressive_entries, &reference.entries);

        let cancellation_job = Arc::new(JobControl::new(
            job_id + 500,
            1,
            "benchmark-cancel".to_string(),
        ));
        let cancellation_sink = Arc::new(CancellationBenchmarkSink {
            job: cancellation_job.clone(),
            started: Instant::now(),
            stats: Mutex::new(CancellationBenchmarkStats::default()),
        });
        run_registered_job(
            cancellation_job,
            left_root.to_path_buf(),
            right_root.to_path_buf(),
            options,
            cancellation_sink.clone(),
        );
        let cancellation = cancellation_sink
            .stats
            .lock()
            .expect("cancellation benchmark result");
        let cancellation_requested = cancellation
            .requested_at
            .expect("cancellation benchmark request");
        let cancellation_terminal = cancellation
            .terminal_at
            .expect("cancellation benchmark terminal");
        let cancellation_latency = cancellation_terminal.saturating_sub(cancellation_requested);
        assert!(matches!(
            cancellation.terminal_value,
            Some(FolderScanTerminal::Cancelled { .. })
        ));
        assert!(cancellation_latency <= Duration::from_secs(1));

        BenchmarkReport {
            first_batch,
            first_200,
            terminal,
            batch_count,
            received_upserts,
            max_batch_rows,
            max_batch_bytes,
            max_unacknowledged_batches,
            max_unacknowledged_bytes,
            cancellation_latency,
            rss_after_progressive,
        }
    }

    fn duration_percentile(
        reports: &[BenchmarkReport],
        select: impl Fn(&BenchmarkReport) -> Duration,
        percentile: usize,
    ) -> Duration {
        let mut values = reports.iter().map(select).collect::<Vec<_>>();
        values.sort_unstable();
        let index = values
            .len()
            .saturating_mul(percentile)
            .div_ceil(100)
            .saturating_sub(1)
            .min(values.len().saturating_sub(1));
        values[index]
    }

    fn final_benchmark_entries(
        latest_rows: &BTreeMap<String, FolderEntryUpsert>,
    ) -> Vec<FolderEntry> {
        latest_rows
            .values()
            .map(|row| match row.resolution {
                FolderEntryResolution::Final { status } => FolderEntry {
                    relative_path: row.relative_path.clone(),
                    left_path: row.left_path.clone(),
                    right_path: row.right_path.clone(),
                    left: row.left.clone(),
                    right: row.right.clone(),
                    status,
                    message: row.message.clone(),
                },
                FolderEntryResolution::Pending { .. } => {
                    panic!("completed benchmark retained a pending row")
                }
            })
            .collect()
    }

    fn assert_benchmark_entries_equal(actual: &[FolderEntry], expected: &[FolderEntry]) {
        assert_eq!(actual.len(), expected.len());
        for (actual, expected) in actual.iter().zip(expected) {
            assert_eq!(actual.relative_path, expected.relative_path);
            assert_eq!(actual.left_path, expected.left_path);
            assert_eq!(actual.right_path, expected.right_path);
            assert_eq!(actual.left, expected.left);
            assert_eq!(actual.right, expected.right);
            assert_eq!(actual.status, expected.status);
            assert_eq!(actual.message, expected.message);
        }
    }

    #[cfg(unix)]
    fn peak_rss_bytes() -> Option<u64> {
        let mut usage = std::mem::MaybeUninit::<libc::rusage>::zeroed();
        // SAFETY: getrusage initializes the provided rusage buffer on a zero return value.
        let result = unsafe { libc::getrusage(libc::RUSAGE_SELF, usage.as_mut_ptr()) };
        if result != 0 {
            return None;
        }
        // SAFETY: the successful getrusage call above initialized the full rusage value.
        let usage = unsafe { usage.assume_init() };
        #[cfg(target_os = "macos")]
        {
            u64::try_from(usage.ru_maxrss).ok()
        }
        #[cfg(not(target_os = "macos"))]
        {
            u64::try_from(usage.ru_maxrss)
                .ok()
                .map(|value| value.saturating_mul(1024))
        }
    }

    #[cfg(not(unix))]
    fn peak_rss_bytes() -> Option<u64> {
        None
    }
}
