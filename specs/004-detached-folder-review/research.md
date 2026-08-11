# Research: Detached Folder Review

**Feature**: `FOL-020`

**Date**: 2026-08-07

## Decision 1: Use an independent WebviewWindow created by an async command

**Decision**: Create a path-free `folder-review-<checked id>` Tauri WebviewWindow from an `async` main-only command. Do not set an OS parent.

**Rationale**: The requested “new window” must move, resize, minimize, and outlive navigation in the source folder screen. Tauri documents a Windows deadlock risk when `WebviewWindowBuilder::new` runs in a synchronous command or event handler; an async command is the supported pattern. A parent window would also cause platform-dependent hiding/destruction behavior that conflicts with independent review.

**Alternatives considered**:

- Modal, drawer, or internal tab: rejected because it does not preserve the folder list as a separately manageable OS window.
- JavaScript-created arbitrary window: rejected because filesystem identity, dedupe, limits, and lifecycle must stay in the native boundary.
- Parent-owned child window: rejected because Windows parent minimize/destroy semantics would make navigation/lifecycle less predictable.

**Sources**:

- [Tauri 2.11.3 `WebviewWindowBuilder::new` and Windows warning](https://docs.rs/tauri/2.11.3/tauri/webview/struct.WebviewWindowBuilder.html#method.new)
- [Tauri window labels and duplicate error](https://docs.rs/tauri/2.11.3/tauri/enum.Error.html#variant.WindowLabelAlreadyExists)
- [Tauri parent platform behavior](https://docs.rs/tauri/2.11.3/tauri/webview/struct.WebviewWindowBuilder.html#method.parent)

## Decision 2: Reserve/deduplicate in a descriptor-only Rust registry

**Decision**: Atomically reserve `DetachedReviewIdentity -> window label` before OS creation. Store roots/relative descriptor, expected sides, lifecycle, cancellation, delivered versions, and byte accounting—but never `FileDocument.text`.

**Rationale**: Reservation makes simultaneous double-clicks converge before the OS call. A descriptor-only registry avoids duplicating up to 128MiB per two-sided pair between Rust registry, IPC serialization, JavaScript, and Monaco. Content belongs only to the child snapshot after the all-or-nothing read.

**Alternatives considered**:

- Store loaded FileDocuments in Rust for retry: rejected because eight maximum-size pairs could retain about 1GiB before IPC/editor copies.
- Use a random secret in the URL: rejected because the child can be authoritatively resolved from Tauri's injected window label; no bearer token is needed.
- Use portable-lowercase/NFC path as identity: rejected because it would merge the exact collision rows the folder UI must preserve.
- Retain a native token-to-row map for every 100k scan row: rejected because it duplicates the large result solely for child authorization. The ACL-authorized main window supplies the already-resolved exact descriptor, and the native pair service remains the filesystem authority.

The source review token/generation in an open request is a stale/dedupe identity, not filesystem authority. The caller must be the ACL-authorized main window, and the native pair service still canonicalizes and validates roots/path/side expectations.

## Decision 3: Load from a fixed child surface with argument-free commands

**Decision**: Use a constant local route (`?surface=folder-review`) containing no path/token and mount a dedicated `DetachedFolderReviewApp`. Child commands accept no path, root, token, generation, or job ID; they resolve the injected caller label in the registry.

**Rationale**: The current `main.tsx` always mounts full `App`, which would initialize startup/restoration, recent/active session, main navigation, file dialogs, save controllers, and settings writes in every child. A detached root is smaller, starts faster, and removes those mutation/persistence paths. Caller-bound commands prevent one child from asking for another path/session.

**Alternatives considered**:

- Mount full `App` in each window: rejected because global/session state and persistence would run independently and conflict.
- Put absolute paths or tokens in URL/hash: rejected as a privacy leak and stale replay surface.
- Grant the generic `read_folder_review_text_pair` command to children: rejected because it accepts caller-provided roots/path/job ID instead of resolving a window-owned descriptor.

**Sources**:

- [Access the invoking WebviewWindow in a Tauri command](https://v2.tauri.app/develop/calling-rust/#accessing-the-webviewwindow-in-commands)
- [Tauri `WebviewUrl`](https://docs.rs/tauri/2.11.3/tauri/enum.WebviewUrl.html)
- [Tauri navigation interception](https://docs.rs/tauri/2.11.3/tauri/webview/struct.WebviewWindowBuilder.html#method.on_navigation)

## Decision 4: Enable application-command ACL before shipping the child

**Decision**: Register the entire invoke-handler command list with `tauri_build::AppManifest::commands`, then assign complete main permissions and only caller-bound load/check/reload plus exact event-listen/window-close core permissions to the non-overlapping `folder-review-*` capability. Do not grant the child `core:default`.

**Rationale**: Tauri local application commands are allowed to local windows by default when no application manifest exists. A capability JSON containing only `core` permissions would therefore not stop a detached WebView from invoking existing arbitrary read/write/Git commands. Once an app manifest is enabled, every local app command is checked against the calling window/webview label and capability; a partial command list would cause omitted commands to fail.

**Alternatives considered**:

- Trust hidden buttons/read-only React props: rejected because UI visibility is not an IPC security boundary.
- Add caller-label checks only to write commands: rejected because arbitrary read/stat/reveal commands also violate the detached privacy boundary.
- Give detached the main capability: rejected because it includes dialog and all existing app commands.

**Sources**:

- [Tauri capabilities and application-command security boundaries](https://v2.tauri.app/security/capabilities/)
- [`AppManifest::commands`](https://docs.rs/tauri-build/2.6.3/tauri_build/struct.AppManifest.html#method.commands)
- [`Attributes::app_manifest`](https://docs.rs/tauri-build/2.6.3/tauri_build/struct.Attributes.html#method.app_manifest)
- [Capability window glob reference](https://v2.tauri.app/reference/acl/capability/)
- [Tauri 2.11.3 runtime ACL resolution](https://docs.rs/tauri/2.11.3/src/tauri/webview/mod.rs.html#1794-1808)

## Decision 5: Reuse the pair service, not generic file reads

**Decision**: Extract the current `read_folder_review_text_pair_inner` validation/reading flow into an internal service shared by inline and detached folder review. Detached initial load and reload both use it.

**Rationale**: It already provides safe relative paths, canonical root containment, expected missing/regular side, symlink and regular-file checks, per-file size limit, binary/LFS rejection, chunk cancellation, final side revalidation, and all-or-nothing response. Generic independent reads could display left from one instant and right from another or partially replace a reload.

**Alternatives considered**:

- Read each side in the child with `read_text_file`: rejected because it grants arbitrary paths and loses expectation/containment/all-or-nothing behavior.
- Preload both files before creating the window: rejected because large/slow reads would miss the 300ms shell goal.
- Cache content in the native registry: rejected for memory/privacy reasons.

## Decision 6: Reuse FileCompareView through a new read-only origin

**Decision**: Add `origin: "folderReview"` with every mutation/persistence/export capability disabled. Add optional settings persistence and opaque model identity parameters rather than copying the component.

**Rationale**: `FileCompareView` already owns the high-value diff/hunk/keyboard/Monaco behavior. Its current `origin === "files"` policy is writable, it always persists compare view settings, and it embeds absolute paths in Monaco model URIs. Small explicit parameters preserve reuse without leaking main-window behavior into the child.

**Alternatives considered**:

- Treat the child as `difftool`: rejected because its close semantics, badges, labels, and process contract are Git-specific.
- Fork a second compare component: rejected because navigation, accessibility, diff options, and fixes would diverge.
- Allow report export because it is not an overwrite: rejected because the initial detached scope is strictly mutation-free.

## Decision 7: Target native menu commands to the focused window

**Decision**: Replace the current app-wide menu broadcast with emission to the one focused WebView and maintain a per-surface menu profile. Detached receives Close and previous/next diff only.

**Rationale**: Today `app.emit` broadcasts a native menu command. With multiple listeners, a Save chosen while a child is focused could be handled by the background main window. Component capability checks inside the child cannot protect another window. Focus-targeted native routing plus disabled detached menu items closes this cross-window write path.

**Alternatives considered**:

- Let all windows receive and call `isFocused()` in JavaScript: rejected because every listener races and native focus is already authoritative.
- Do not register a native listener in the child: insufficient because the main listener would still receive the broadcast and could save in the background.

**Source**: [Tauri `Emitter::emit` versus `emit_to`](https://docs.rs/tauri/2.11.3/tauri/trait.Emitter.html)

## Decision 8: Use Destroyed for final cleanup and explicit memory limits

**Decision**: Support at most eight detached windows and 256MiB of retained source snapshots. Clean the registry/budget on `WindowEvent::Destroyed`; close requests only initiate shutdown because they may be prevented.

**Rationale**: Each window owns an independent WebView and Monaco runtime, so count matters even for small files; file bytes matter independently of window count. Tauri distinguishes close request from actual destruction. Cleanup before destruction could lose a live session if close is cancelled; cleanup only in a React unmount could leak after renderer failure.

**Alternatives considered**:

- Unlimited windows: rejected due unbounded renderer/editor/file memory.
- Auto-close least-recently-used windows: rejected because it silently destroys review context.
- Cleanup only on `CloseRequested`: rejected because the close can be prevented.

**Sources**:

- [Tauri `WindowEvent` lifecycle](https://docs.rs/tauri/2.11.3/tauri/enum.WindowEvent.html)
- [Tauri `close` and `destroy`](https://docs.rs/tauri/2.11.3/tauri/webview/struct.WebviewWindow.html#method.close)
- [Tauri manager window lookup](https://docs.rs/tauri/2.11.3/tauri/trait.Manager.html#method.get_webview_window)
