# Data Model: Detached Folder Review

## Overview

One exact final folder row can own one detached review window per source folder-review generation. Native state stores only descriptors, lifecycle, cancellation, versions, and byte accounting. The child WebView owns the loaded text snapshot and editor state. All entities are process-memory only.

## Entities

### Detached Review Open Request

Accepted only from the `main` WebView.

| Field | Meaning | Validation |
|---|---|---|
| `sourceReviewToken` | Current frontend folder-review scope identity | Non-empty, bounded, process-only; identity rather than filesystem authority |
| `scanGeneration` | Folder result generation that resolved the exact row | Positive safe integer; must match the caller's current result before invoke |
| `leftRoot`, `rightRoot` | Source result roots | Stored only in native descriptor; pair service canonicalizes on load |
| `relativePath` | Exact row path, separator-normalized | Existing safe-relative validation; not portable-lowercase row identity |
| `leftExpected`, `rightExpected` | `regularFile` or `missing` | Both cannot be missing; derived from a final row only |

### Detached Review Identity

```text
(main owner label,
 sourceReviewToken,
 scanGeneration,
 exact relativePath,
 leftExpected,
 rightExpected)
```

It drives duplicate focus and stale invalidation. It does not authorize filesystem access: every load still validates roots, containment, file kind, symlink, size, binary/LFS, and external state.

### Detached Review Session

| Field | Meaning |
|---|---|
| `sessionId` | Checked monotonic process-local ID |
| `windowLabel` | `folder-review-<sessionId>`; no path/token |
| `identity` | Exact dedupe/stale identity |
| `descriptor` | Roots, relative path, expected sides; no content |
| `phase` | `reserved`, `creating`, `loading`, `ready`, `error`, `closing` |
| `operationRevision` | Guards late create/load/reload completion |
| `cancelled` | Cooperative token for active pair read |
| `deliveredVersions` | Last successfully delivered side size/mtime values |
| `retainedSourceBytes` | Steady-state byte budget charged to this window |
| `error` | Stable actionable code/message, never raw debug/path content |

### Detached Review Registry

| Field | Meaning |
|---|---|
| `byIdentity` | Exact identity to active session ID/window label |
| `byLabel` | Injected caller label to session |
| `nextSessionId` | Checked monotonic allocator; overflow fails without reuse |
| `activeCount` | Maximum eight; duplicate focus checked first |
| `retainedSourceBytes` | Sum of ready/loading reservations, maximum 256MiB |

The registry never contains `FileDocument.text`, decoded bytes, diff output, Monaco state, cursor, or clipboard data.

### Detached Bootstrap Result

Returned only to the calling child whose label owns the session.

| Field | Meaning |
|---|---|
| `context` | Filename, parent/full relative path, roots, missing side |
| `left`, `right` | Safe FileDocuments or null before virtual-missing adaptation |
| `modelIdentity` | Opaque session-local model key with no path/token |
| `versions` | Baseline size/mtime for explicit external-change detection |

### Child Review State

```text
loading
ready(snapshot, local diff/navigation state)
error(code, message, retryable)
externalChange(snapshot retained, notice)
closing
```

Child state is isolated per WebView. It is not written to localStorage/recent/active session or shared with the main `App`.

## State Transitions

### Registry/window lifecycle

```text
absent
  -> reserved -> creating -> loading -> ready
                         \-> error -> loading (explicit retry)
  -> focused (duplicate identity at any live phase)

reserved/creating/loading/error/ready
  -> closing -> destroyed -> absent
```

- Reserve occurs before OS creation and before count/budget is exposed to another opener.
- Duplicate identity is resolved before count/budget checks.
- Registry locks are not held during OS window calls or filesystem I/O.
- Build failure rolls back only the same session ID/revision reservation.
- `Destroyed` is the authoritative final removal; repeated/late destroy is idempotent.
- A source-generation invalidation cancels pre-ready operations but does not close or mutate a ready snapshot.

### Initial load/retry

```text
creating -> loading
loading -> ready         (full safe pair delivered)
loading -> error         (typed failure; partial pair never delivered)
loading -> closing       (window destroyed; cancellation wakes read)
error -> loading         (explicit retry, new operationRevision)
```

### External change

```text
ready -> ready(no change)
ready -> externalChange(old snapshot remains)
externalChange -> loadingReload -> ready(new full pair)
externalChange -> externalChange(reload failure; old pair remains)
externalChange -> ready(user keeps current until next explicit check)
```

## Invariants

1. `byIdentity` and `byLabel` are one-to-one for every live session.
2. The same live identity can never own two labels, including concurrent open calls.
3. A `folder-review-*` child can resolve only its injected label and supplies no path/token/session selector.
4. `activeCount <= 8` and steady-state `retainedSourceBytes <= 256MiB`; no limit action auto-closes another window.
5. The registry contains descriptors and versions, never file content or diff/editor state.
6. Loaded/reloaded left and right documents become visible together or neither becomes visible.
7. A missing virtual document is never persisted, saved, backed up, or version-statted as a real file.
8. Ready snapshots survive main Home/mode navigation; app exit/main destruction closes all.
9. Source generation change cannot complete an old pre-ready load, but does not silently replace a ready snapshot.
10. URL, label, OS title, Monaco model URI, persistent storage, and default logs exclude absolute roots, file content, hashes, and source review token.
11. Only the focused WebView receives native menu commands; detached mutation commands are disabled and ACL-denied.
12. Initial load, version check, and reload each enforce their allowed lifecycle states; repeated commands cannot create parallel reads or replace a ready snapshot through the wrong path.
