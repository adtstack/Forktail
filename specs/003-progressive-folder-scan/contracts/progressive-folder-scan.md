# Contract: Progressive Folder Scan

## Commands

### `start_folder_scan`

Starts one process-local read-only scan and returns after validation/registration, not after traversal.

```ts
interface StartFolderScanRequest {
  scanGeneration: number;
  leftRoot: string;
  rightRoot: string;
  options: FolderScanOptions;
}

interface FolderScanStarted {
  jobId: number;
  scanGeneration: number;
  leftRoot: string;
  rightRoot: string;
  optionsFingerprint: string;
}

startFolderScan(
  request: StartFolderScanRequest,
  onEvent: Channel<FolderScanMessage>,
): Promise<FolderScanStarted>
```

The native command captures the invoking WebView as owner. The owner label is never accepted as a request field. Validation failure rejects with the existing `{ code, message }` error and creates no job.

### `ack_folder_scan`

```ts
interface FolderScanAck {
  jobId: number;
  scanGeneration: number;
  appliedThroughSequence: number;
}

ackFolderScan(ack: FolderScanAck): Promise<void>
```

- ACK is cumulative and monotonic.
- It is sent only after every row upsert through that sequence is synchronously owned by the keyed frontend accumulator.
- A repeated lower ACK is idempotent. An ACK for another owner/job/generation is rejected without releasing credit.
- ACK is flow control, not proof that React has painted every row.

### `cancel_folder_scan`

```ts
cancelFolderScan(jobId: number, scanGeneration: number): Promise<void>
```

Cancellation sets the job token and wakes inventory, hash, queue, and ACK waits. The frontend invalidates its generation immediately; the native side still emits at most one explicit `cancelled` terminal message for cleanup/diagnostics.

## Message envelope

Rust uses an internally tagged serialized enum and TypeScript uses the exact discriminated union. Contract tests assert tags and camelCase fields on both sides.

```ts
interface FolderScanMessageIdentity {
  jobId: number;
  scanGeneration: number;
  sequence: number;
}

type FolderScanMessage =
  | (FolderScanMessageIdentity & {
      event: "batch";
      data: {
        upserts: FolderEntryUpsert[];
        estimatedBytes: number;
      };
    })
  | (FolderScanMessageIdentity & {
      event: "progress";
      data: FolderScanProgressSnapshot;
    })
  | (FolderScanMessageIdentity & {
      event: "terminal";
      data: FolderScanTerminal;
    });
```

The matching Rust shape uses `#[serde(tag = "event", content = "data", rename_all = "camelCase")]` plus flattened identity fields or an equivalent byte-for-byte JSON shape.

## Entry upsert

```ts
type PendingReason = "awaitingPeer" | "awaitingHash";

type FolderEntryResolution =
  | { state: "pending"; reason: PendingReason }
  | { state: "final"; status: FolderEntryStatus };

interface FolderEntryUpsert {
  relativePath: string;
  revision: number;
  leftPath: string | null;
  rightPath: string | null;
  left: FsEntryMeta | null;
  right: FsEntryMeta | null;
  resolution: FolderEntryResolution;
  message: string | null;
}
```

- `FolderEntryStatus` remains the existing final union: `same | different | leftOnly | rightOnly | typeMismatch | error`.
- `relativePath` is the exact scan-local row key. Portable case/NFC normalization is not a replacement key.
- A higher `revision` replaces the row; equal/lower revisions are ignored.
- Pending rows cannot be converted to `FolderEntry` for sync planning.

## Progress and terminal

```ts
type FolderScanPhase = "inventory" | "classify" | "hash";

interface FolderScanProgressSnapshot {
  phase: FolderScanPhase;
  discovered: number;
  finalized: number;
  pending: number;
  errors: number;
  hashedFiles: number;
  hashCandidates: number | null;
}

type FolderScanTerminal =
  | {
      outcome: "completed";
      stats: FolderScanStats;
      entryCount: number;
      durationMs: number;
    }
  | {
      outcome: "cancelled";
      finalized: number;
      pending: number;
      durationMs: number;
    }
  | {
      outcome: "failed";
      code: string;
      message: string;
      finalized: number;
      pending: number;
      durationMs: number;
    };
```

Unknown total work is represented by `null`, not a fabricated percentage. `completed` is valid only when no pending rows remain and `entryCount == sum(stats)`.

## Ordering, flow control, and limits

- `sequence` is strictly increasing across messages for one job. Delivery is expected in sequence; duplicate/lower messages are ignored. A forward gap fails the local accumulator and asks the user to rescan.
- Per-row `revision` is strictly increasing only when that row changes.
- A row batch flushes at the first of 256 upserts, 256KiB estimated serialized payload, or 50ms.
- At most four row batches and 1MiB estimated row payload may be unacknowledged. These are initial benchmarked constants, not public API guarantees.
- Progress is emitted at most every 100ms and may replace an unsent older progress snapshot.
- Terminal is explicit and exactly once. Channel close without terminal is treated as failure.
- No row batch is emitted after terminal. Cancel/stale events already in transit are rejected by generation/job identity.

## Failure contract

- Root validation errors reject start before a job exists.
- Permission, metadata, hash, and detected external-change errors with a known relative path become final `error` rows while other paths continue.
- Protocol sequence gaps, sender/channel failures, or an owner WebView disappearing terminate the job and clean registry state.
- UI messages remain actionable and exclude raw Rust debug formatting. Default logs may contain job ID, phase, counts, duration, stable error code, and queue high-water marks, but no path, file content, hash, or row payload.
