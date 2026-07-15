# Data Model: Local Git Snapshot Review

## Modeling Rules

- Object IDs are algorithm + full hex, never a fixed 40-character string.
- Git paths are backend byte identities. Display text is not an identity.
- Repository and path handles are scoped to one session and invalid after refresh/close.
- `missing` is a state, not an empty document.
- Snapshot origin and write capability are independent fields.
- Blob text and diff output are memory-bounded and never part of persistent session data.

## GitRepository

Represents a validated local repository/worktree context.

| Field | Meaning | Validation |
|---|---|---|
| `sessionId` | Opaque active repository session | Unique, invalidated on close |
| `displayRoot` | User-facing root path | Escaped for display, not reused as identity |
| `rootIdentity` | Canonical filesystem identity | Must remain inside selected worktree |
| `gitDirIdentity` | Worktree-specific Git directory | Absolute validated identity |
| `commonDirIdentity` | Shared Git storage identity | Distinguishes linked worktrees |
| `isBare` | Repository has no worktree | Initial MVP rejects true |
| `isLinkedWorktree` | Uses shared common directory | Informational and cache key input |
| `isShallow` | History is shallow | Missing history remains local-only error |
| `objectFormat` | `sha1`, `sha256`, or `unknown` | Controls object ID validation |
| `head` | Current HEAD state | `unborn`, `detached`, or branch + object ID |

**Identity**: canonical root + git dir + common dir + object format.

**Lifecycle**:

```text
candidate folder → validating → ready
                           ↘ unsupported / unsafe / not-repository
ready → refreshing → ready
ready → closed (all opaque path IDs invalid)
```

## GitObjectId

| Field | Meaning | Validation |
|---|---|---|
| `algorithm` | `sha1`, `sha256`, `unknown` | Derived from repository format |
| `hex` | Full object identity | Hex only, exact length for known format |

Abbreviated IDs exist only as user input and display. Cache/equality keys use the full value.

## GitRevision

| Field | Meaning | Validation |
|---|---|---|
| `rawLabel` | User-entered or selected label | Display only after sanitization |
| `resolved` | Immutable commit identity | Required for ready state |
| `kind` | head, branch, remote branch, tag, commit, symbolic | Typed selector state |
| `displayName` | Bounded user-facing name | Control characters escaped |

**State transition**:

```text
input → validating → resolved
                  ↘ invalid
                  ↘ ambiguous(candidates)
                  ↘ object-missing-local
```

## GitPathIdentity

| Field | Meaning | Validation |
|---|---|---|
| `opaqueId` | Session-scoped backend key | Unique within repository + refresh generation |
| `displayPath` | Safe escaped text | Never used to reopen/write |
| `utf8Path` | Optional exact UTF-8 representation | Null when exact conversion is impossible |

The backend map owns original bytes. Refresh creates a new generation and invalidates old IDs.

## GitChangedFile

| Field | Meaning |
|---|---|
| `status` | added, deleted, modified, renamed, copied, typeChanged, unmerged, unknown |
| `oldPath` | Source path identity or null |
| `newPath` | Destination path identity or null |
| `similarityScore` | 0–100 reference value or null |
| `oldMode` / `newMode` | Optional Git modes |
| `reviewState` | unviewed, viewed, unavailable |

`copied` is parser-compatible before it is a user-visible supported feature.

## GitSnapshotDocument

Represents one compare/merge pane.

| Field | Meaning | Validation |
|---|---|---|
| `origin` | committedBlob, indexStage, workingTree, missing | Mandatory |
| `label` | Revision/stage/path description | Bounded and escaped |
| `readOnly` | Whether the pane can be edited | True except working Result target |
| `objectId` | Immutable object identity | Required for Git object origins |
| `path` | Git path identity | Null only for synthetic missing/base cases |
| `mode` | Git mode | Symlink/submodule modes never become text docs |
| `textMetadata` | encoding, EOL, final newline, size, decode errors | Shared with existing `FileDocument` semantics |
| `contentState` | text, missing, binary, lfsPointer, symlink, submodule, tooLarge, unavailable | Exactly one |

`text` is returned only for `contentState = text` and stays memory-bounded.

## GitCompareSession

| Field | Meaning |
|---|---|
| `repositoryId` | Active repository session |
| `left` / `right` | Snapshot documents |
| `sourceKind` | revisionPair, headIndex, indexWorkingTree, revisionWorkingTree |
| `revisionPair` | Resolved IDs and raw labels when applicable |
| `capabilities` | read-only, export-patch eligibility |
| `generation` | Stale-response guard |

Snapshot compare sessions never expose save/hunk-copy capabilities to their source panes.

## GitIndexEntry

| Field | Meaning |
|---|---|
| `path` | Lossless path identity |
| `stage` | 0, 1, 2, or 3 |
| `mode` | Git mode |
| `objectId` | Full object ID |

- Stage 0: normal index snapshot used by HEAD/index/working-tree review.
- Stage 1: conflict base.
- Stage 2: conflict slot commonly called ours.
- Stage 3: conflict slot commonly called theirs.

Stage labels in the UI also include operation/commit context because rebase semantics can surprise users.

## GitConflictSession

| Field | Meaning | Validation |
|---|---|---|
| `repositoryId` | Active worktree | Must match Result containment root |
| `path` | Conflict path identity | Lossless, session-scoped |
| `base` / `stage2` / `stage3` | Snapshot or explicit missing | Immutable sources |
| `result` | Working-tree Result document | Only editable target |
| `resultFingerprint` | Kind, size, time, optional hash | Rechecked before save |
| `stageFingerprint` | Stage number + mode + object ID set | Rechecked before save |
| `operation` | merge, rebase, cherryPick, revert, unknown | Display context only |
| `saveState` | clean, dirty, stale, saving, saved, failed | Controls close/save guards |

**Save transition**:

```text
clean → dirty → validating → saving → saved
                    ↘ stale (reload / overwrite-confirm / save-copy)
                    ↘ unresolved (return to edit)
                              saving → failed (original preserved)
```

## GitMergePreview

| Field | Meaning |
|---|---|
| `baseState` | none, single, multiple |
| `baseCandidates` | Full object IDs, bounded |
| `base` / `left` / `right` | Immutable snapshot documents |
| `result` | In-memory deterministic preview |
| `disclaimer` | Preview is not an executed Git merge |
| `readOnly` | Always true in initial scope |

No base is synthesized when candidate count is not exactly one.

## GitReviewSession

| Field | Persistence | Meaning |
|---|---|---|
| `repositoryIdentity` | Optional metadata only | Reopen hint, not content |
| `leftRevision` / `rightRevision` | Optional metadata only | Raw label + resolved ID |
| `filter` / `sort` | Optional | UI preference |
| `selectedPathOpaqueId` | Memory only | Invalid after refresh |
| `viewedPathKeys` | Memory by default | Review progress for current generation |
| `blobText` / `diffText` | Never | Explicitly forbidden |

Refresh rules define whether viewed state is reset or remapped by stable object/path identity. MVP resets on revision
pair change and retains state only for filter/sort changes.

## GitFileHistoryEntry

| Field | Meaning |
|---|---|
| `commitId` | Full immutable commit identity |
| `shortDisplayId` | Bounded display only |
| `subject` | Sanitized, bounded subject |
| `authorTimestamp` | Display/sort metadata |
| `pathAtCommit` | Path identity for the history record |
| `boundary` | normal, shallowBoundary, renameBoundary, objectUnavailable |

History entries contain no commit body and no file content. Selecting an entry requests a normal snapshot open.
