# Research: Progressive Folder Scan

**Feature**: `FOL-006R`

**Date**: 2026-08-07

## Decision 1: Stream through a typed Tauri Channel

**Decision**: Pass a `tauri::ipc::Channel<FolderScanMessage>` to `start_folder_scan`. Use it for one owning WebView rather than broadcasting global events.

**Rationale**: Tauri documents events as suited to smaller, multi-consumer messages and Channels as the ordered, high-throughput streaming mechanism. A folder scan has one consumer and many ordered row updates. The project already uses typed invoke commands, so a Channel preserves the narrow command boundary without adding a broad event listener.

**Alternatives considered**:

- Global/window events: rejected because they add listener registration races, weaker typing, and still need a separate ordering/flow-control protocol.
- One large invoke response: current behavior; rejected because it guarantees blank-screen waiting and duplicates large maps/sets/JSON at terminal.
- Frontend polling for pages: viable but adds latency and pull-state complexity; retained only as a fallback if Channel lifecycle cannot be made reliable in packaged tests.

**Sources**:

- [Tauri Channels and typed examples](https://v2.tauri.app/develop/calling-frontend/#channels)
- [Tauri event system and ordering warning](https://v2.tauri.app/develop/calling-frontend/#event-system)

## Decision 2: Add application-level cumulative ACK backpressure

**Decision**: Permit at most four unacknowledged row batches and 1MiB of unacknowledged row payload. The frontend ACKs the highest sequence synchronously after the keyed store owns the batch. Progress is coalesced; row upserts and terminal messages are never dropped.

**Rationale**: Tauri 2.11.3 `Channel::send` schedules an eval or stores a large payload for frontend fetch and returns without consumer acknowledgement. Its channel API has no capacity or wait contract. A bounded native producer queue alone would not bound the native-to-WebView boundary. Cumulative ACK provides a measurable end-to-end window and makes a stopped consumer cancellable without memory growth.

**Alternatives considered**:

- Assume `Channel::send` blocks: rejected by source inspection.
- Bound only the scanner-to-sender queue: rejected because the IPC/WebView backlog could still grow.
- ACK every row: rejected due excessive invoke traffic; ACK each bounded row batch instead.

**Sources**:

- [Tauri 2.11.3 Channel implementation](https://github.com/tauri-apps/tauri/blob/tauri-v2.11.3/crates/tauri/src/ipc/channel.rs#L132-L194)
- [Tauri 2.11.3 `Channel::send`](https://github.com/tauri-apps/tauri/blob/tauri-v2.11.3/crates/tauri/src/ipc/channel.rs#L286-L296)
- [Tauri JavaScript Channel ordering implementation](https://github.com/tauri-apps/tauri/blob/tauri-v2.11.3/packages/api/src/core.ts#L73-L145)

The internal 8KiB JSON/1KiB raw direct-send thresholds in this Tauri release are implementation details, not product batch-size targets.

## Decision 3: Separate inventory visibility from final classification

**Decision**: Emit pending path/side metadata while inventory is still running. Pair exact relative paths in one coordinator. Finalize a row only when its opposite-side existence and selected compare-mode evidence are known.

**Rationale**: The current scanner performs left collection, right collection, union sorting, every comparison/hash, and whole-result serialization before returning. Virtual scrolling cannot improve this first-row latency. A pending envelope lets the user see path hierarchy early without claiming that a temporarily one-sided or un-hashed row is final.

**Alternatives considered**:

- Mark early rows `leftOnly`/`rightOnly`: rejected because the other walker may find the counterpart later.
- Add `checking` to `FolderEntryStatus`: rejected because it mixes transient and final domain states and would silently alter stored filter and Rust/TS enum contracts.
- Wait for both inventories, then stream sorted final rows: rejected because large inventories would still show a blank list.

## Decision 4: Use bounded producers and a single deterministic coordinator

**Decision**: Use at most one producer per root feeding a bounded queue to a single coordinator. The coordinator owns exact-path pairing, row revisions, statistics, message sequence, and terminal emission.

**Rationale**: Two bounded producers expose both roots without unbounded concurrency. A single coordinator prevents races in status counts and makes duplicate/upsert rules testable. Arrival order may differ by platform, so final order is derived from paths and never from worker timing.

**Alternatives considered**:

- `ignore::WalkBuilder::build_parallel()` immediately: deferred because parallel traversal disables its sorting behavior and increases scheduling/test complexity before first-row evidence exists.
- New crossbeam worker queues: unnecessary for `FOL-006R`'s two producers/one consumer; reconsider in `FOL-008` where multiple persistent hash consumers make MPMC useful.

**Sources**:

- [`ignore::WalkBuilder` 0.4.26](https://docs.rs/ignore/0.4.26/ignore/struct.WalkBuilder.html)
- [Rust bounded `sync_channel`](https://doc.rust-lang.org/stable/std/sync/mpsc/fn.sync_channel.html)

## Decision 5: Defer persistent hash pooling and cache redesign

**Decision**: `FOL-006R` queues same-size quick/full candidates until inventory visibility is established, then reuses the existing compare-mode/hash semantics in deterministic path order. Persistent file-pair worker pooling is `FOL-008`; cache eviction/version policy is `FOL-009`.

**Rationale**: Profiling shows the current per-pair two-thread spawn/join and 4,096-entry clear-all cache are likely total-time bottlenecks. Combining them with transport, lifecycle, and UI accumulation would violate the one-issue rule and make final-parity failures hard to isolate. Progressive delivery creates the benchmark points needed to tune those follow-ups safely.

**Alternatives considered**:

- Add BLAKE3 Rayon parallelism: rejected for this phase; BLAKE3 warns parallel updates can be slower below its size threshold, and many-file parallelism is the relevant future optimization.
- Unbounded workers based on CPU count: rejected because disk contention and cancellation latency would be unpredictable.

**Sources**:

- [BLAKE3 Hasher parallelization notes](https://docs.rs/blake3/1.8.5/blake3/struct.Hasher.html)
- [Rust `available_parallelism` caveats](https://doc.rust-lang.org/stable/std/thread/fn.available_parallelism.html)

## Decision 6: Replace tombstone cancellation with owned jobs

**Decision**: Manage jobs in Rust state by job ID and owner WebView. Each job has an atomic cancel flag plus acknowledgement condition state. Terminal cleanup is idempotent and emits exactly one terminal outcome. WebView destruction cancels its jobs.

**Rationale**: The current global cancelled-ID set is polled under a mutex and relies on command-finally cleanup. Progressive workers, ACK waits, and future multiple windows need explicit ownership and idempotent cleanup. Aborting a blocking task handle is insufficient; traversal and hash loops must cooperatively inspect the token.

**Sources**:

- [Tauri `spawn_blocking`](https://docs.rs/tauri/latest/tauri/async_runtime/fn.spawn_blocking.html)
- [Tauri runtime JoinHandle abort behavior](https://docs.rs/tauri/latest/tauri/async_runtime/struct.TokioJoinHandle.html#method.abort)
- [Tauri `WindowEvent::Destroyed`](https://docs.rs/tauri/latest/tauri/enum.WindowEvent.html#variant.Destroyed)

## Decision 7: Use a keyed frontend accumulator, not repeated whole arrays

**Decision**: Apply batches to a private `Map<exact relative path, progressive row>`, keep incremental counts and protocol state, publish React notifications at most once per animation frame, preserve selection by exact path, and keep the existing virtual row window.

**Rationale**: The current virtual list limits DOM nodes but every new full `entries` array would re-count statuses, scan portable conflicts, filter all rows, rebuild the tree, and sort siblings. At 100k this can move the bottleneck from Rust to the main thread. Exact paths preserve case/Unicode collisions; portable-normalized identities remain warnings only.

**Alternatives considered**:

- Copy a 100k `Map` for every batch: rejected due O(n × batches) allocation.
- Keep selection by index: rejected because inserts before the selected row silently select a different file.
- Compute sync dry-run from partial rows: rejected because it would present an incomplete plan as authoritative.

## Benchmark Baseline

Generated fixtures are temporary and generation time is excluded. Record warm-up once, then five measured runs with median/p95 and host details:

- many-small and wide 10k/100k inventories;
- deep hierarchy and mixed status/error fixtures;
- quick-hash same-size small files;
- full-hash many-small files plus a separate large-file cancellation case.

Hard gates are final parity, stale=0, sequence/queue bounds, first batch before terminal, and fake-I/O cancellation within 1s. Shared CI records wall time rather than failing on machine speed; a stable reference host enforces the 500ms first-result and memory targets.
