# Quickstart: Detached Folder Review

## Goal

Deliver `FOL-020` as one read-only multiwindow feature: single click only selects, double-click/Enter opens or focuses one real detached compare window, the source folder list remains usable, and the child cannot invoke any main read/write capability outside its own session.

## Prerequisites

- A `FOL-020` implementation that follows [the detached command/window contract](contracts/detached-folder-review.md) and [registry invariants](data-model.md).
- Node/npm and the Rust/Tauri toolchain versions pinned by the repository.
- Main and detached capabilities generated from the complete application command manifest.
- Packaged macOS, Windows, and Linux builds; browser-only development mode cannot prove native window lifecycle.

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

The feature test suite must additionally assert:

- every registered app command has generated ACL permission and main coverage;
- detached allowed commands equal the three caller-bound read-only commands;
- single click invokes no open/read; 100 concurrent duplicate opens create one window;
- English and Korean renders keep the single-click, double-click/Enter, and Space rules visibly above the result table;
- eighth new identity succeeds, ninth fails, duplicate-at-limit focuses;
- 256MiB budget never auto-closes another window and releases on Destroyed;
- registry source contains no FileDocument/content field and runtime registry retains no text;
- child route mounts no full `App`, file dialog, startup restore, active/recent session, settings writer, or save controller;
- native menu events reach one focused surface only;
- initial load/reload is all-or-nothing and close cancellation discards late results;
- URL, label, OS title, Monaco URI, storage, and default logs pass privacy sentinels.

Expected automated outcome: existing main-window commands still work through the new ACL, detached callers can invoke only their three path-free read-only commands, every registry/pair-read race is deterministic, and no test observes a partial pair or cross-window menu mutation.

## Verification record (2026-08-11)

| Check | Result |
|---|---|
| `npm run typecheck` | Passed |
| `npm test` | Passed: 87 files, 651 tests |
| `npm run build` | Passed |
| `cargo fmt --check` | Passed |
| `cargo clippy --all-targets -- -D warnings` | Passed |
| `cargo test` | Passed: 298 tests, 1 generated folder benchmark ignored |

Packaged and performance evidence is intentionally separate from the automated result:

| Evidence | Status |
|---|---|
| macOS packaged create/move/resize/minimize/restore/focus/close/app-exit | Not run |
| Windows packaged create/move/resize/minimize/restore/focus/close/app-exit | Not run |
| Linux packaged create/move/resize/minimize/restore/focus/close/app-exit | Not run |
| detached shell visible within 300ms | Not measured |
| 1MiB text pair ready or actionable error within 1s | Not measured |

## Manual and packaged checks

- One click changes selection/detail only. Double-click and Enter open a movable native window; directory actions only toggle.
- The interaction guide stays visible above the list and remains readable when it wraps at narrow widths.
- The folder list, scan, filter, selection, and collapse state remain usable while child windows are open.
- Same-basename files show distinguishable relative parent context in title/header; roots appear only in local child UI.
- Reopening a minimized same identity restores/focuses it without adding a window or losing diff position.
- Eight typical files open independently; a ninth reports the limit. Large pairs also enforce the 256MiB source budget.
- Binary, LFS, oversized, symlink, containment, expected-side, deletion, and read-time-change cases never show partial/stale text.
- Source rescan cancels a not-yet-ready old open; a ready snapshot remains and shows external-change choices rather than silently reloading.
- Save/Save As/hunk copy/swap/drop/export are absent; native or keyboard Save while child is focused does not affect main.
- Closing each child releases it. Home navigation keeps ready children. Closing/confirming exit from main closes all.
- Repeat create, move, resize, minimize/restore, focus, close, and quit in packaged macOS, Windows, and Linux builds.
- Record shell-open and 1MiB-pair times on the reference host; shell is at most 300ms and ready/error is at most 1s.

## Security review checkpoint

Do not proceed to stable/beta exposure if any of these remain true:

- a detached label can invoke a generic application command;
- any app command is omitted from AppManifest/main parity after ACL activation;
- native menu dispatch still broadcasts across WebViews;
- a child command accepts a root/path/token/other label/job selector;
- FileDocument text is retained in native registry or any detached state is persisted;
- Windows window creation still occurs in a synchronous command or event handler;
- packaged close/destroy/app-exit cleanup evidence is missing on a supported OS.
