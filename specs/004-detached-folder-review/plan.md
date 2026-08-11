# Implementation Plan: Detached Folder Review

**Branch**: `004-detached-folder-review` (not created) | **Date**: 2026-08-07 | **Spec**: [spec.md](spec.md)

**Issue**: `FOL-020`

**Input**: Feature specification from `/specs/004-detached-folder-review/spec.md`

## Summary

Open a final regular-file row from folder comparison in a real, independent Tauri WebviewWindow while leaving the source list and scan untouched. A main-window-only async command reserves/deduplicates a descriptor-only native session, creates a shell with a constant path-free route, and returns immediately. The detached surface resolves its session solely from the invoking window label and reuses the existing all-or-nothing folder pair reader; file content lives only in that child WebView/Monaco snapshot. A full Tauri application-command ACL migration, focused-window menu routing, path-free window/model identities, an 8-window/256MiB budget, and destroy-time cleanup are release gates—not optional hardening.

## Technical Context

**Language/Version**: Rust 1.85 (edition 2024); TypeScript 6.0; React 19.2

**Primary Dependencies**: Tauri 2.11.x / tauri-build 2.6.x / `@tauri-apps/api` 2.11.x; React; Monaco via `@monaco-editor/react`; existing safe folder review pair reader

**Storage**: Descriptor/session state and loaded documents are process-memory only. No detached session, path, content, token, error, cursor, or window layout persistence.

**Testing**: Rust registry/reader/ACL/lifecycle tests; Vitest contract/capability/surface/component/privacy tests; packaged macOS/Windows/Linux multiwindow smoke

**Target Platform**: Tauri desktop application on macOS, Windows, and Linux

**Project Type**: Multiwindow cross-platform desktop application with one main React WebView and isolated detached review WebViews

**Performance Goals**: Native shell visible within 300ms on the reference host; text pair at or below 1MiB rendered or rejected within 1s; duplicate open focuses the existing window without a second read/window

**Constraints**: Read-only; no parent-child OS ownership; no path/token/content in URL or internal model URI; 8 detached windows and 256MiB retained source snapshot budget; no broad dialog/fs/shell/http/opener permissions; Windows window creation must not occur in a synchronous command/event callback

**Scale/Scope**: Up to eight simultaneous independent read-only folder review windows, one file pair per window, with one-sided missing documents and external-change reload

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

- **Predictability — PASS**: One exact source identity maps to one window; duplicate open focuses it; the safe pair is all-or-nothing; stale/loading/ready/close states and external reload are explicit.
- **No-surprise writes — PASS**: The detached origin disables edit, hunk copy, swap, save, Save As, export, drag/drop replacement, backup, and settings/session persistence. ACL and focused menu routing prevent a detached shortcut from mutating the main surface.
- **Local privacy — PASS**: Files stay local. The URL and window label are path-free; the OS title contains only sanitized basename/relative parent; the model URI is opaque; descriptors and contents are never logged or persisted.
- **Architecture boundary — PASS**: Rust owns exact path validation, pair reading, session/window lifecycle, memory budget, app-command ACL, and cancellation. The detached React root owns only isolated display/navigation and invokes caller-bound commands with no path arguments.
- **Test-first delivery — PASS**: Registry races, ACL deny cases, pair-read failure, child isolation, menu focus routing, privacy sentinels, and three-OS packaged lifecycle evidence precede stable exposure.

No ADR exception is required. Enabling app-command ACL for the whole invoke handler is mandatory; shipping a child WebView while all local custom commands remain callable would fail the architecture and no-surprise-write gates.

## Project Structure

### Documentation (this feature)

```text
specs/004-detached-folder-review/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── detached-folder-review.md
└── checklists/
    └── requirements.md
```

### Source Code (repository root)

```text
src-tauri/
├── build.rs                              # complete AppManifest command list
├── capabilities/
│   ├── default.json                      # main-only core/dialog/app command set
│   └── detached-folder-review.json       # folder-review-* minimal command set
├── permissions/
│   ├── main-commands.toml                # reviewed main app-command set
│   └── detached-folder-review.toml        # caller-bound detached commands only
└── src/
    ├── commands/
    │   ├── detached_review.rs             # main open/invalidate + child load/check/reload
    │   ├── files.rs                       # extracted reusable validated pair service
    │   └── mod.rs
    ├── detached_review.rs                 # registry, identity, budget, lifecycle/window adapter
    ├── domain/models.rs                   # detached DTOs and folder-review origin contract
    ├── lib.rs                             # state, commands, window-event cleanup
    └── menu.rs                            # focused-window emission and surface profiles

src/
├── main.tsx                               # constant-surface dynamic entry selection
├── App.tsx                                # folder row open/invalidation integration only
├── DetachedFolderReviewApp.tsx            # isolated loading/error/ready/external-change root
├── DetachedFolderReviewApp.test.tsx
├── components/
│   ├── FileCompareView.tsx                 # read-only origin, optional settings/model identity
│   └── FileCompareView.test.tsx
└── core/
    ├── bridge.ts                           # main and caller-bound child commands
    ├── bridge.test.ts
    ├── detachedFolderReview.ts             # pure lifecycle/context/title/policy helpers
    ├── detachedFolderReview.test.ts
    ├── models.ts                           # detached compare session/DTO mirrors
    ├── difftoolSession.ts                  # folderReview capability profile
    ├── difftoolSession.test.ts
    ├── nativeMenu.ts                       # per-surface command allowlist
    ├── commands.ts                         # folder-review command context
    ├── i18n.ts
    ├── capabilityConfig.test.ts
    ├── securityConfig.test.ts
    └── privacyLoggingPolicy.test.ts

docs/
├── 02_ARCHITECTURE.md                      # multiwindow session/ACL/menu boundary
├── 07_TEST_PLAN.md                         # race, privacy, packaged window matrix
├── 09_RELEASE_SECURITY.md                  # app-command ACL and dynamic-window capability
└── 14_PRODUCT_GAP_ROADMAP.md               # FOL-020 status/evidence
```

**Structure Decision**: Create a small detached-only entry root and new native registry modules. Reuse `FileCompareView` and the validated pair reader through narrow parameters/services; do not mount or copy the full `App`, and do not duplicate the compare component. This limits overlap with the dirty navigation/folder worktree and prevents startup/recent/settings/write controllers from running in every child WebView.

## Delivery Design

### 1. Establish the application-command security boundary

1. Change `build.rs` to register the complete `invoke_handler` command list through `tauri_build::AppManifest::commands`. Autogenerated `allow-<command>` permissions become authoritative for local custom commands.
2. Keep main behavior by assigning every reviewed existing command plus `open_detached_folder_review` and source invalidation to the `main` capability/permission set.
3. Add a non-overlapping `folder-review-*` capability with only `core:event:allow-listen`, `core:event:allow-unlisten`, `core:window:allow-close`, and caller-bound detached load/check/reload commands. It receives no `core:default`, dialog, arbitrary read/stat, write/save, reveal, Git, scan, shell, HTTP, opener, or window-creation permission.
4. Add a source/manifest parity test: every `generate_handler!` command appears in `AppManifest`, every main bridge invoke has an allow permission, and the detached set equals the explicit narrow list. Missing entries fail closed.
5. Commands also validate the injected invoking WebviewWindow label (`main` for open/invalidate; `folder-review-*` plus a registry hit for child commands) as defense in depth.

### 2. Reserve, deduplicate, and create the shell

1. Main resolves the current exact final row with the existing folder review scope/generation guard. The open request includes source review identity, roots, exact relative path, and expected side kinds; it never includes file contents.
2. The registry creates a `DetachedReviewIdentity` from source token/generation, exact relative path, and expectations. This identity is for stale/dedupe behavior, not filesystem authority; the safe native reader revalidates every path and side.
3. Under a short mutex, duplicate identities are resolved before capacity. A new identity reserves one slot with a checked monotonic, path-free `folder-review-<id>` label. The lock is released before any OS call or file I/O.
4. An existing window is unminimized, shown, and focused. A stale handle is removed only if the registry generation still matches. Concurrent opens encountering `reserved/creating` wait for that reservation outcome rather than creating another label.
5. A new shell is built from an **async** Tauri command with a constant local route such as `index.html?surface=folder-review`, no OS parent, a sanitized/truncated relative title, production/dev-origin navigation allowlist, and new-window requests denied. Build failure rolls back only its own reservation.
6. `App` remains on the folder screen; single click still selects only, directory double-click/Enter toggles, and only a final regular-file action invokes the native open command.

### 3. Load content through the invoking window

1. `main.tsx` selects one root from the constant surface: normal `App` for `main`, `DetachedFolderReviewApp` for a matching detached label. The child bundle does not initialize startup args, recent/active sessions, Git/folder state, file dialogs, saves, or main menu state.
2. The detached root invokes `load_detached_folder_review()` with no path, root, token, generation, or job ID. Rust obtains the injected caller label, resolves the descriptor, allows the transition only from initial/error state, changes it to `loading`, clones a cancellation token, then releases the registry lock.
3. Extract the current folder pair validator/reader into a reusable internal service. It continues to enforce safe relative path, canonical containment, expected missing/regular side, non-symlink regular file, 64MiB per-file limit, binary/LFS rejection, chunk cancellation, final revalidation, and all-or-nothing DTO return.
4. Before allocating full text, reserve the observed source-byte budget for this label. Eight windows or 256MiB retained source snapshots is the hard steady-state limit; duplicate focus is checked before both limits. Failure leaves existing windows/content untouched.
5. The registry stores descriptor, cancel token, phase, delivered versions, and byte accounting only. `FileDocument.text` is returned once to the child and never retained in the Rust registry.
6. A close/destroy during load flips the token. A late worker result is discarded unless label, session generation, and lifecycle still match.

### 4. Reuse compare rendering as a strict read-only surface

1. Add `origin: "folderReview"` to `CompareSession` and make all mutation/persistence/export capabilities false.
2. Parameterize `FileCompareView` with `persistViewSettings` (default true, detached false) and an opaque `modelIdentity`. Detached Monaco URIs contain no absolute path, source token, or file content.
3. The detached root renders a context-first header: filename, parent relative folder, full relative path, LEFT/RIGHT roots, and missing side. The OS title is `basename — relative parent — forktail`, sanitized and length-bounded; it excludes absolute roots/token/generation/hash/content.
4. Each child WebView owns its document, model revision, diff/hunk/scroll/focus, load/error/retry, external-change notice, and navigation adapter. It shares none of those states with `App` or another child.
5. On DOM focus or explicit check, `check_detached_folder_review_versions()` resolves paths by caller label. Reload uses the same all-or-nothing pair service and swaps both child documents only after success. Failure preserves the old snapshot.

### 5. Route menu commands and lifecycle to one window

1. Replace `app.emit` native-menu broadcast with target emission to the single focused WebView. If focus cannot be resolved, mutation commands are not sent.
2. Track a window command profile. Detached focus enables only Close and previous/next diff; Save/Save As, swap, open, merge, undo/redo mutation, search-path, and main navigation commands are disabled. Refocusing main restores its last authoritative menu state, including editor-navigation Back.
3. Source rescan/generation change invalidates only old `reserved/creating/loading` opens and wakes their reader; already `ready` snapshots remain until their own window closes.
4. Actual `WindowEvent::Destroyed` performs idempotent registry removal, cancellation, identity-map cleanup, and byte-budget release. `CloseRequested` alone is not final cleanup because it can be prevented.
5. Main-window destruction or app exit cancels all loads, requests all detached windows to close, and clears the registry. Ordinary Home/mode navigation does not close ready detached windows.

## Test Strategy

1. Start with pure Rust registry tests using fake window/reader adapters: 100 concurrent same-identity opens create one/focus 99, build/focus rollback, stale handles, 8-window/256MiB limits, duplicate-at-cap, checked label IDs, and every close/open race.
2. Add pair-service tests before integration: existing binary/LFS/oversized/symlink/containment/expected-side cases, close cancellation during each side, read-time version change, all-or-nothing reload, and no registry content retention.
3. Add ACL source tests before creating a child window: invoke-handler/AppManifest parity, exact main and detached permissions, glob non-overlap, and deny evidence for arbitrary read/write/dialog/reveal/Git/scan commands.
4. Add frontend capability/surface tests: single click invokes zero opens; double-click/Enter converge through native dedupe; full `App` never mounts on the child route; folderReview origin hides every mutation/export; no settings/session storage writes; opaque Monaco URI; same-basename context; one-sided missing.
5. Add lifecycle/menu tests: only the focused WebView receives a native command; detached Save cannot reach main; source rescan cancels loading but preserves ready; close/destroy/exit remove all descriptor/byte/token state; external reload replaces both or neither.
6. Package-test macOS, Windows, and Linux for create, move, resize, minimize/restore/focus reuse, menu focus, close, main navigation independence, app exit, 300ms shell, 1MiB pair 1s, eight-window steady memory, and ninth-window error.

## Complexity Tracking

No constitution violation is accepted. The full app-command ACL migration and focused-menu routing increase the issue's configuration surface, but both are required safety boundaries for introducing a second local WebView. A UI-only window with globally callable custom commands or broadcast Save events is not a viable simpler alternative.

## Post-Design Constitution Check

**PASS (2026-08-07)**. The final design is read-only and local, creates no persistent content, routes every filesystem operation through the existing safe native pair service, limits content memory, gives the child only caller-bound commands, and cleans up on actual window destruction. The command ACL, focus-targeted menu, descriptor-only registry, fixed route, and opaque editor model identity close the multiwindow privilege/privacy gaps identified in research.
