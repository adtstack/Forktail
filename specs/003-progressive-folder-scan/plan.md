# Implementation Plan: Progressive Folder Scan

**Branch**: `003-progressive-folder-scan` (not created) | **Date**: 2026-08-07 | **Spec**: [spec.md](spec.md)

**Issue**: `FOL-006R`

**Input**: Feature specification from `/specs/003-progressive-folder-scan/spec.md`

## Summary

Replace the one-shot folder scan response with a cancellable, identity-checked progressive pipeline. The native side validates roots, returns a job identity immediately, discovers both roots through bounded producers, combines discoveries by exact relative path, and streams pending/final upserts plus coalesced progress through a typed Tauri channel. The frontend owns a keyed accumulator, sends cumulative acknowledgements to enforce end-to-end backpressure, publishes React snapshots at a bounded cadence, and continues to virtualize rows. Final status semantics remain identical to the current scanner; persistent hash pooling and cache replacement stay in `FOL-008` and `FOL-009`.

## Technical Context

**Language/Version**: Rust 1.85 (edition 2024); TypeScript 6.0; React 19.2

**Primary Dependencies**: Tauri 2.11.x and `@tauri-apps/api` 2.11.x; `ignore` 0.4; `blake3` 1; existing React/Vite frontend

**Storage**: No new persistent storage. Job, partial entry, acknowledgement, and progress state are process memory only.

**Testing**: Rust unit/integration tests with temporary directories; Vitest pure reducer/contract/component tests; generated 10k/100k benchmark fixtures

**Target Platform**: Tauri desktop application on macOS, Windows, and Linux

**Project Type**: Cross-platform desktop application with React WebView and Rust native core

**Performance Goals**: First 200 rows or completed result within 500ms on the recorded 10k metadata fixture; no user-input block over 100ms; cancel acknowledgement within 1s; exact final parity with the one-shot reference scanner

**Constraints**: Offline-only; read-only; no broad filesystem permission; no file content/path in telemetry or default logs; at most 4 unacknowledged row batches and 1MiB outbound row payload; scanner RSS increase at 100k at or below 250MiB

**Scale/Scope**: 10k and 100k local-folder entries; metadata, quick-hash, and full-hash modes; one active folder scan per owning WebView in this issue

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

- **Predictability — PASS**: Pending rows never masquerade as final statuses; exact-path revisions, monotonic sequence numbers, explicit terminal outcomes, and a one-shot parity oracle preserve deterministic final results.
- **No-surprise writes — PASS**: The complete flow is read-only. It changes only process-memory scan state and the rendered result list.
- **Local privacy — PASS**: All traversal, metadata, and hashing remain local. File contents, paths, hashes, and row payloads are excluded from network, telemetry, persistent cache, and default logs.
- **Architecture boundary — PASS**: Rust retains traversal, metadata, hashing, path validation, cancellation, and flow control. TypeScript retains screen state, filtering, hierarchy, selection, and rendering through a narrow typed command/channel contract.
- **Test-first delivery — PASS**: Contract/reducer/fake-scanner tests precede integration changes; 10k/100k correctness, memory, stale, cancellation, and packaged smoke gates are explicit.

No ADR exception is required.

## Project Structure

### Documentation (this feature)

```text
specs/003-progressive-folder-scan/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── progressive-folder-scan.md
└── checklists/
    └── requirements.md
```

### Source Code (repository root)

```text
src-tauri/
├── Cargo.toml                         # unchanged unless measurement justifies a direct queue dependency
└── src/
    ├── commands/folders.rs            # start/ack/cancel commands and reference scanner reuse
    ├── domain/models.rs               # typed progressive scan DTOs
    ├── folder_scan.rs                 # bounded jobs, coordinator, batching, lifecycle
    └── lib.rs                         # managed state, commands, WebView-destroy cleanup

src/
├── App.tsx                            # active generation/job lifecycle and immediate folder mode
├── components/
│   ├── FolderCompareView.tsx          # pending/progress/terminal UX
│   └── FolderCompareView.test.tsx
└── core/
    ├── bridge.ts                      # Channel start/ack/cancel bridge
    ├── bridge.test.ts
    ├── models.ts                      # TS mirror of native DTOs
    ├── folderScanState.ts             # pure keyed accumulator and protocol guards
    ├── folderScanState.test.ts
    ├── folderView.ts                  # pending-aware hierarchy/filter/selection helpers
    ├── folderView.test.ts
    └── i18n.ts                        # checking/progress/partial-result strings

docs/
├── 02_ARCHITECTURE.md                 # final stream and flow-control contract
├── 07_TEST_PLAN.md                    # progressive, race, memory, performance cases
└── 14_PRODUCT_GAP_ROADMAP.md          # FOL-006R evidence/status only if implementation completes
```

**Structure Decision**: Keep filesystem work and job ownership in a new focused Rust module while retaining command adapters in `commands/folders.rs`. Keep protocol reduction and stale/duplicate handling in a new pure TypeScript module so the already-modified `App.tsx` and `FolderCompareView.tsx` receive only narrow integration changes. No new service, persistence layer, or frontend filesystem access is introduced.

## Delivery Design

### Native pipeline

1. `start_folder_scan` validates both roots and options, allocates a Rust-owned job ID, registers an owner WebView plus cancellation/ACK state, starts the blocking worker, and returns immediately.
2. At most two inventory producers traverse the left and right roots. Their records enter a bounded coordinator queue; a full queue checks cancellation before retrying.
3. The single coordinator owns `Map<exact relative path, partial pair>`, assigns per-row revisions, and emits:
   - pending upserts while the opposite side is not yet known,
   - immediate final upserts for paired directories, type mismatch, size mismatch, metadata-mode results, and path-local errors,
   - pending-hash upserts for same-size quick/full hash candidates.
4. A one-sided row becomes final only after the opposite inventory producer has reached terminal state. Quick/full candidates use the existing pair hash semantics in deterministic path order after inventory; persistent pair-level worker pooling is deferred to `FOL-008`.
5. The batcher flushes at 256 row upserts, 256KiB estimated serialized payload, or 50ms, whichever occurs first. Progress is coalesced to at most once per 100ms.
6. The IPC sender allows at most four unacknowledged row batches and at most 1MiB of unacknowledged row payload. It waits on cumulative frontend ACK credit, and cancellation wakes inventory, hash, ACK, and send waits.
7. Exactly one explicit terminal message is emitted. It carries status/stats/duration only; the full row set remains in the frontend accumulator. Terminal cleanup removes the job and drops the last Channel clone.

### Frontend accumulation and rendering

1. `App` creates a monotonically increasing `scanGeneration`, moves to the folder screen immediately with an empty progressive result, and calls `startFolderScan` with a typed `Channel`.
2. `folderScanState` accepts a message only when generation, Rust job ID, current roots/options fingerprint, and sequence are valid. Duplicate/late messages are ignored; a sequence gap becomes a controlled protocol failure requiring rescan.
3. Batch upserts mutate a private exact-path keyed accumulator synchronously, update incremental pending/final/error counts, then send a cumulative ACK. A portable normalized path is used only for collision warnings and never as the row key.
4. React notification is coalesced to a single animation frame. The current virtual row range remains bounded. The scan performance fixture must verify the existing hierarchy/filter preparation does not exceed the 100ms UI limit; the accumulator maintains incremental counts and path identities so whole-list counting/conflict scans are not repeated per event.
5. Selection is migrated from array index to exact relative-path identity so earlier inserts cannot silently change the selected file. Collapse state remains path-keyed.
6. Pending rows participate in path search and folder context but not final status totals. They cannot start sync dry-run. A file comparison can open only when both required regular-file expectations for that row are final and the existing pair reader revalidates them.
7. Cancel, root/options change, Back, and component unmount advance the frontend generation immediately and request native cancellation. Partial rows may remain visible with a clear cancelled/incomplete banner, but their counts are never presented as final.

### Issue boundary

- `FOL-006R` owns progressive visibility, end-to-end bounded transport, identity/cancel rules, pending/final UX, and final parity.
- `FOL-008` replaces per-pair thread creation with a persistent bounded hash worker pool after this stream is measurable.
- `FOL-009` replaces the current 4,096-entry clear-all process cache and resolves stale version-key policy. This plan does not silently widen into cache redesign.

## Test Strategy

1. Add a delayed fake inventory source and pure native coordinator tests before changing production traversal.
2. Keep the existing one-shot implementation available as a test-only reference until metadata/quick/full fixtures prove final entry/status/stat parity.
3. Add contract tests for Rust/TypeScript tag and field naming, including pending resolution, sequence, terminal variants, and error serialization.
4. Add frontend reducer tests for out-of-order discovery, pending-to-final replacement, duplicate/late/gap handling, cumulative ACK, stale generation/job/options, selection identity, and terminal rules.
5. Add temporary-directory integration fixtures for one-sided, type mismatch, permission/hash errors, cancellation during inventory/hash/ACK wait, and external modification while hashing.
6. Generate wide, deep, many-small, mixed, and large-file 10k/100k fixtures outside committed source. Record first-batch, inventory, terminal, rows/sec, queue high-water, batch bytes, cancellation, estimated heap/RSS, and main-thread long tasks.
7. Run warm-up once and five measured iterations; record median/p95 and host details. Shared CI records performance; correctness, queue bounds, stale=0, and fake-I/O cancel under 1s are hard gates.

## Complexity Tracking

No constitution violations require justification. The explicit ACK command is additional protocol surface, but it is required because Tauri Channel ordering does not provide bounded end-to-end backpressure.

## Post-Design Constitution Check

**PASS (2026-08-07)**. Research, the data model, IPC contract, and quickstart preserve all five gates. The design adds no writes, persistent content, network path, broad capability, or unbounded result queue. Pending state and terminal summary keep speed optimization from weakening result correctness. `FOL-008` and `FOL-009` remain separate issue-sized follow-ups.
