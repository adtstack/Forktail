# Contract: Detached Folder Review

## Main-window commands

Only the exact `main` window has application-command permission for these operations. Rust also verifies the injected caller label.

### `open_detached_folder_review`

```ts
interface OpenDetachedFolderReviewRequest {
  sourceReviewToken: string;
  scanGeneration: number;
  leftRoot: string;
  rightRoot: string;
  relativePath: string;
  leftExpected: "regularFile" | "missing";
  rightExpected: "regularFile" | "missing";
}

type OpenDetachedFolderReviewResult =
  | { outcome: "created"; windowLabel: string }
  | { outcome: "focused"; windowLabel: string };
```

Rules:

- The caller resolves one exact current final row before invoking. Pending/error/type-mismatch/directory rows are rejected in the frontend and rechecked natively where applicable.
- Identity equality includes token, generation, exact relative path, and both expectations.
- Existing live identity is unminimized/shown/focused before count and byte limits are considered.
- New identity reserves a slot before the async OS build. The path-free label is `folder-review-<checked id>`.
- The only route marker is a fixed `surface=folder-review`; root/path/token/generation/content is absent from URL/hash.
- Window title is sanitized basename plus relative parent and app name. It excludes absolute roots/token/generation/hash/content.

### `invalidate_detached_folder_review_source`

```ts
interface InvalidateDetachedFolderReviewSource {
  sourceReviewToken: string;
  scanGeneration: number;
}

invalidateDetachedFolderReviewSource(request: InvalidateDetachedFolderReviewSource): Promise<void>
```

Called when a source rescan replaces the generation. Matching `reserved/creating/loading` operations become stale and are cancelled. Matching `ready` windows keep their immutable snapshot and later external-change controls.

## Detached-window commands

These commands accept no roots, paths, source tokens, generation, session IDs, other labels, or arbitrary job IDs. Tauri injects the invoking WebviewWindow; Rust resolves its exact label in the registry.

### `load_detached_folder_review`

```ts
interface DetachedFolderReviewContext {
  fileName: string;
  parentRelativePath: string;
  relativePath: string;
  leftRoot: string;
  rightRoot: string;
  leftMissing: boolean;
  rightMissing: boolean;
}

interface DetachedFolderReviewLoaded {
  context: DetachedFolderReviewContext;
  left: FileDocument | null;
  right: FileDocument | null;
  modelIdentity: string;
}

loadDetachedFolderReview(): Promise<DetachedFolderReviewLoaded>
```

- Loads both sides through the internal all-or-nothing folder pair service.
- Is accepted only for the initial/error lifecycle. Calls during loading, ready, or closing are rejected without starting another read; ready refreshes must use the reload command.
- Reserves source-byte budget from validated metadata before full read.
- Returns null only for an expected missing side; both null is invalid.
- On failure no partial FileDocument is returned and the session moves to typed error.
- Retry calls the same command from that same error session with a new operation revision.

### `check_detached_folder_review_versions`

```ts
interface DetachedFolderReviewVersionCheck {
  leftChanged: boolean;
  rightChanged: boolean;
  versionKey: string;
}

checkDetachedFolderReviewVersions(): Promise<DetachedFolderReviewVersionCheck>
```

The command resolves paths by caller label and returns only change state needed by the current child. It does not accept arbitrary paths. Expected missing-side appearance/disappearance is a change/error, not a silent new pairing.

### `reload_detached_folder_review`

```ts
reloadDetachedFolderReview(): Promise<DetachedFolderReviewLoaded>
```

Reload uses the same pair service and swaps both child documents only after a complete success. A failure keeps the old child snapshot and old budget charge. A larger successful pair must fit the 256MiB steady-state budget before delivery.

Window close uses the permitted core window close action. `WindowEvent::Destroyed` is the native cleanup source; no child-supplied label/session identifier is accepted.

## Compare-session capability contract

```ts
interface DetachedFolderReviewCompareSession {
  origin: "folderReview";
  left: FileDocument;
  right: FileDocument;
}
```

For `origin: "folderReview"`, every capability below is `false`:

```text
edit, save, saveAs, backupRestore, hunkCopy,
replaceInput, swap, persistPaths, exportReport
```

The view loads existing compare display defaults but uses `persistViewSettings=false`. Monaco receives the returned opaque `modelIdentity`, not a path-derived model URI.

## Tauri ACL contract

`build.rs` registers every app command used by `generate_handler!` in `AppManifest::commands`.

```text
main window capability
  - all reviewed existing app commands
  - open_detached_folder_review
  - invalidate_detached_folder_review_source
  - core defaults + dialog open/save

folder-review-* capability
  - load_detached_folder_review
  - check_detached_folder_review_versions
  - reload_detached_folder_review
  - core:event:allow-listen
  - core:event:allow-unlisten
  - core:window:allow-close
  - no core:default
  - no dialog/fs/shell/http/opener
```

The label patterns must not overlap. Missing command/capability parity is a build/test failure, not a runtime fallback. Detached attempts to invoke generic read/stat/write/reveal/Git/scan/dialog commands are denied by ACL.

## Native menu contract

- Rust finds the single focused WebView and emits the command only to that target.
- Detached allows `previousDiff`, `nextDiff`, and native Close. Mutation/open/merge/search-path/main-navigation commands are disabled and not dispatched.
- Main focus restores its last main command state; detached focus never overwrites the stored main editor-navigation Back availability.
- No focused target means no mutation command dispatch.

## Errors and lifecycle

- All command errors serialize as `{ code, message }` with actionable local text and no raw debug string.
- Important codes include window limit, source-byte limit, stale source, unknown caller window, window create/focus failure, cancelled load, file changed, binary/LFS/too-large/path conflict, and app-command denied.
- `CloseRequested` may be cancelled and is not final cleanup.
- `Destroyed` cancels any read, removes both registry indexes, releases byte budget, and discards late completion by session/revision identity.
- Main destruction/app exit cancels and closes all detached sessions. Ordinary main navigation does not.
