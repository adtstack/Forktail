# Data Model: Progressive Folder Scan

## Overview

The feature separates transient discovery from final comparison. Native job state and frontend accumulated rows are process-memory only. No entity is written to user files, app settings, recent-content storage, logs, or network services.

## Entities

### Scan Request

| Field | Meaning | Validation |
|---|---|---|
| `scanGeneration` | Frontend-created monotonic identity for the requested roots/options | Positive safe integer; must equal the currently active generation |
| `leftRoot`, `rightRoot` | User-selected folder roots | Existing root validation; directory; no implicit symlink following |
| `options` | Metadata/quick/full and hidden/ignore/link choices | Existing enum/boolean contract |
| `optionsFingerprint` | Stable identity of the exact option snapshot | Derived, never trusted in place of the actual options |
| `ownerWindowLabel` | WebView that receives and acknowledges messages | Captured by the native command, not accepted from user input |

### Scan Job

| Field | Meaning |
|---|---|
| `jobId` | Rust-created process-local unique identity |
| `request` | Immutable validated Scan Request snapshot |
| `phase` | `inventory`, `classify`, `hash`, or terminal |
| `cancelled` | Cooperative atomic cancellation token |
| `nextSequence` | Next native message sequence |
| `acknowledgedThrough` | Highest cumulative row-batch sequence owned by the frontend |
| `inFlightBatches`, `inFlightBytes` | End-to-end flow-control window |
| `progress` | Discovered/final/pending/error/hash counters |
| `terminalSent` | Idempotence guard for exactly one terminal message |

### Side Observation

| Field | Meaning |
|---|---|
| `side` | Left or right root |
| `relativePath` | Exact normalized separator form used within this scan |
| `kind`, `size`, `modifiedMs` | Observed filesystem metadata |
| `path` | Native-only path needed for later validation/hash; not logged |
| `error` | Stable actionable path-local error code/message, if observation failed |

### Partial Pair

Coordinator-owned record keyed by exact `relativePath`.

| Field | Meaning |
|---|---|
| `left`, `right` | Optional Side Observation for each root |
| `revision` | Monotonic version for this row |
| `resolution` | Pending reason or final status |
| `lastEmittedRevision` | Prevents duplicate unchanged upserts |

### Entry Resolution

```text
pending(awaitingPeer)
pending(awaitingHash)
final(same | different | leftOnly | rightOnly | typeMismatch | error)
```

Pending is an envelope around a row and is not added to the existing final `FolderEntryStatus` enum. Final rows retain the existing status semantics and metadata/hash representation.

### Entry Upsert

| Field | Meaning |
|---|---|
| `relativePath` | Exact row key within the scan |
| `revision` | Replace only a smaller revision for the same scan/job |
| `left`, `right` | Currently known side metadata/path presence |
| `resolution` | Pending or final discriminated state |
| `message` | Optional actionable row message; no raw debug string |

### Scan Message

Every message has `jobId`, `scanGeneration`, and strictly increasing `sequence`.

- `batch`: bounded list of Entry Upserts plus payload byte estimate.
- `progress`: coalesced phase and current counters; never invents an unknown percentage.
- `terminal`: exactly one `completed`, `cancelled`, or `failed` outcome with summary/stats/duration and no full row array.

### Frontend Accumulator

| Field | Meaning |
|---|---|
| `identity` | Current generation, job, roots, and options fingerprint |
| `lastSequence` | Duplicate/late/gap protocol guard |
| `entriesByExactPath` | Required final/partial row ownership |
| `finalCounts`, `pendingCount`, `errorCount` | Incremental counters |
| `portableIdentityIndex` | Collision warning groups only; never row identity |
| `selectedRelativePath` | Stable selection across insert/reorder |
| `terminal` | Null while active, otherwise explicit outcome |

## State Transitions

### Job lifecycle

```text
requested
  -> validated -> inventory -> classify -> hash? -> completed
  -> cancelled (from any active/waiting phase)
  -> failed (validation rejects before job creation, or one explicit terminal failure after creation)
```

- A terminal state cannot return to active.
- Cleanup is idempotent and removes the registry entry once.
- Cancellation wakes a producer queue wait and an ACK-credit wait, not only hash reads.

### Row lifecycle

```text
absent
  -> pending(awaitingPeer)
  -> final(leftOnly/rightOnly) after opposite inventory terminal

absent/pending(awaitingPeer)
  -> paired
     -> final(typeMismatch/different/metadata result/directory same/error)
     -> pending(awaitingHash) -> final(same/different/error)
```

- A higher revision replaces a lower revision for the same exact path.
- The same/lower revision is idempotently ignored.
- A final row may receive a higher final revision only for an explicitly detected same-scan error/external-change correction; it cannot return to pending.
- Final counts subtract the replaced final status before adding its replacement.

## Invariants

1. `sum(finalCounts) + pendingCount == entriesByExactPath.size` for every published accumulator snapshot.
2. Only final rows contribute to status filter counts and terminal stats.
3. A completed terminal requires `pendingCount == 0` and terminal stats equal frontend final counts.
4. Cancelled/failed partial results never present their counts as a complete comparison.
5. One-sided status is impossible before the opposite inventory producer has completed.
6. Every row batch is bounded and requires cumulative ACK; progress may be replaced by a newer progress message, rows may not.
7. A sequence gap is a protocol failure, not an invitation to guess missing rows.
8. Generation/job/root/options mismatch is stale and cannot mutate the current accumulator.
9. Relative paths may appear in the local UI but are excluded from default logs and all external transmission.
10. The existing safe pair reader revalidates root containment, expected side kind, symlink, binary, LFS, size, and external version before text reaches a compare editor.
