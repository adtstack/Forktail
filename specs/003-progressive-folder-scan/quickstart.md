# Quickstart: Progressive Folder Scan

## Goal

Deliver `FOL-006R` as one read-only feature PR: users see pending/final folder rows before the scan completes, cancellation and stale handling remain exact, and final output matches the existing scanner.

## Prerequisites

- A `FOL-006R` implementation that follows [the progressive scan contract](contracts/progressive-folder-scan.md) and [state invariants](data-model.md).
- Node/npm and the Rust toolchain versions pinned by the repository.
- A release-mode benchmark executable or test target that generates temporary 10k/100k fixtures without committing them.
- A recorded reference host for enforcing user-facing latency/memory targets; shared CI remains the correctness and boundedness gate.

## Required automated verification

```bash
npm run typecheck
npm test
npm run build

cd src-tauri
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
```

Also run the feature benchmark command introduced by the implementation against generated 10k/100k fixtures and retain its host/median/p95/queue/memory report. Fixture generation time must be excluded.

Expected automated outcome: the Rust/TypeScript contract matches, all existing final scanner fixtures remain equivalent, stale/duplicate/gap/cancel cases have explicit results, and no queue/window limit is exceeded.

## Manual and packaged checks

- Start a 100k scan from Home and confirm the folder screen and Cancel appear before completion.
- Scroll, filter, collapse, and select while rows arrive; selection must remain on the same exact path.
- Confirm pending rows never appear in final status totals or sync dry-run.
- Open a final regular text row during scanning; the scan continues and the existing safe pair reader still rejects binary, symlink, oversized, LFS, stale, and escaped targets.
- Cancel during inventory, hash, and a deliberately stalled consumer; acknowledgement is under 1s and no late row is applied.
- Change roots/options rapidly and navigate Back; stale rows and stale completion messages remain zero.
- Package-test macOS, Windows, and Linux because WebView Channel scheduling and memory behavior are platform-specific.

## Performance evidence format

Record for each fixture/run:

- host OS/CPU/memory/storage and build mode;
- entry/file/byte counts and compare option;
- start acknowledgement, first batch, inventory complete, terminal median/p95;
- batch count/max rows/max estimated bytes/max unacknowledged window;
- discovered/finalized/hashed throughput;
- cancel acknowledgement and worker-stop latency;
- scanner estimated heap and process RSS delta where supported;
- final parity, stale, duplicate, and protocol-gap counts.

Correctness, bounded queues, stale=0, and fake-I/O cancellation under 1s are hard gates. Shared CI wall-clock measurements are informational; the recorded reference host enforces the user-facing time and memory targets.

## Reference result — 2026-08-07

Command:

```bash
cd src-tauri
cargo test --release benchmark_progressive_scan_10k_and_100k -- --ignored --nocapture
```

Reference host: macOS 26.4.1 (25E253), arm64, Apple M2 Pro, 16 GiB RAM, Apple NVMe
`APPLE SSD AP0512Z`, Rust release test profile. The generated metadata fixture places one-byte files in
1,000-file groups and alternates them between the two roots. Fixture creation and deletion are outside the
reported scan timings. Each size uses one warm-up followed by five measured iterations.

| Files / union entries | First batch median / p95 | First 200 median / p95 | Terminal median / p95 | Max batches / upserts | Max batch | Max unacknowledged | Cancel median / p95 | Peak RSS delta | Parity |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 10,000 / 10,010 | 1 / 1 ms | 1 / 1 ms | 43 / 46 ms | 79 / 20,017 | 256 rows / 91.3 KiB | 1 batch / 91.3 KiB | <1 / <1 ms | 13.7 MiB | pass |
| 100,000 / 100,100 | 1 / 1 ms | 1 / 1 ms | 390 / 413 ms | 783 / 200,200 | 256 rows / 91.3 KiB | 1 batch / 91.3 KiB | <1 / <1 ms | 96.4 MiB | pass |

The ignored benchmark hard-fails on a non-completed terminal, pending final row, any path/metadata/status/error/stats
divergence from the one-shot reference, a 256-row/256-KiB batch or 4-batch/1-MiB ACK-window breach, cancellation
over one second, or RSS growth over 250 MiB. The immediate in-process benchmark consumer acknowledges each batch,
so its observed ACK high-water is one; separate stalled-consumer tests exercise the four-batch ceiling and cancel wake.

## Verification status — 2026-08-07

| Check | Status | Evidence / limitation |
|---|---|---|
| `npm run typecheck` | Passed | TypeScript project build completed with no diagnostics |
| `npm test` | Passed | 72 files, 542 tests |
| `npm run build` | Passed | Vite production build completed; existing large-chunk advisory remains non-fatal |
| `cargo fmt --check` | Passed | No formatting diff |
| `cargo clippy --all-targets -- -D warnings` | Passed | No warnings |
| `cargo test` | Passed | 250 passed; generated benchmark is the one expected ignored test |
| Native 10k/100k metadata benchmark | Passed | Release result above; final parity and boundedness included |
| 100k native process RSS ceiling | Passed | 96.4 MiB increase, limit 250 MiB |
| Fake inventory/hash/ACK cancellation | Passed | Rust unit tests; worker wake and terminal contract |
| macOS packaged/WebView scan | Not run | Source-test host is macOS, but no packaged-app run was performed |
| Windows packaged/WebView scan | Not run | Windows host unavailable in this run |
| Linux packaged/WebView scan | Not run | Linux host unavailable in this run |
| 100k WebView main-thread long tasks | Not run | Native benchmark does not measure React/WebView input blocking |
| Packaged UI memory on three OSes | Not run | Native process RSS is not a substitute for packaged WebView RSS |
| Manual scroll/filter/collapse/open/rescan matrix | Not run | Requires an interactive packaged or Tauri runtime session |

Start acknowledgement, separate inventory-complete timing, UI long-task p95, and packaged cross-platform memory remain
unmeasured; they must not be inferred from the native terminal timings above.
