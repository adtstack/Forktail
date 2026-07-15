# Contract: Git Tauri Commands and DTO Boundaries

## Contract Rules

- Frontend requests express product operations, never executable paths, subcommands, options, environment, or argv.
- Every request includes a repository session and generation where stale results could apply.
- Every failure serializes as `{ code, message }`; raw stderr, argv, path bytes, and content are backend-only.
- Commands returning large lists accept a limit/job ID or use bounded batches and support cancellation.
- Opaque path IDs are valid only in the repository session and generation that issued them.

## Command Inventory

### `detect_git_repository`

**Request**

```text
candidatePath: user-selected folder path
```

**Response**: `GitRepositorySummary`

**Errors**: `GIT_NOT_FOUND`, `GIT_VERSION_UNSUPPORTED`, `GIT_NOT_REPOSITORY`,
`GIT_UNSAFE_REPOSITORY`, `GIT_BARE_UNSUPPORTED`, `GIT_PATH_UNSUPPORTED`.

**Mutation contract**: none.

### `resolve_git_revision`

**Request**

```text
repositorySessionId
rawRevision
requestGeneration
```

**Response**: resolved `GitRevision` with full commit object ID or typed ambiguity candidates.

**Errors**: `GIT_INVALID_REVISION`, `GIT_AMBIGUOUS_REVISION`, `GIT_OBJECT_MISSING_LOCAL`,
`GIT_COMMAND_TIMEOUT`, `GIT_COMMAND_CANCELLED`.

### `list_git_refs`

**Request**: repository session, kinds, hard limit, job ID.

**Response**: bounded local branch, remote-tracking branch, and tag metadata. Remote-tracking entries are labeled
as local refs, never as live remote state.

### `list_git_changed_files`

**Request**: repository session, resolved left/right commit IDs, rename detection policy, job ID, generation.

**Response**: bounded/batched `GitChangedFile` entries plus summary counts and completion state.

**Errors**: output cap, timeout/cancel, stale repository, missing object, parse error mapped to stable codes.

### `open_git_revision_compare`

**Request**: repository session, resolved revision pair, changed-file opaque ID, generation.

**Response**: `GitCompareSession` containing two snapshot documents or explicit non-text states.

**Mutation contract**: no save capability and no filesystem target is inferred from snapshot labels.

### `read_git_status`

**Request**: repository session, job ID, generation.

**Response**: branch/detached/unborn metadata and separate staged, unstaged, untracked, unmerged entries.

**Mutation contract**: index bytes/mtime and working-tree fingerprints remain unchanged.

### `open_git_working_tree_compare`

**Request**: repository session, resolved revision, opaque path ID, generation.

**Response**: committed snapshot vs disk working-tree snapshot. Disk reading reuses the existing text loader policy.

### `open_git_index_compare`

**Request**

```text
repositorySessionId
opaquePathId
comparison: headToIndex | indexToWorkingTree | headToWorkingTree
generation
```

**Response**: `GitCompareSession` whose index side uses stage 0 and whose missing/untracked states are explicit.

**Mutation contract**: no stage/unstage/add operation exists in this command family.

### `list_git_conflicts`

**Request**: repository session, job ID, generation.

**Response**: paths grouped by stage availability/mode/object ID plus operation context when known.

### `open_git_conflict`

**Request**: repository session, conflict opaque path ID, generation.

**Response**: `GitConflictSession` with stage snapshots and current Result fingerprint/content state.

### `save_git_conflict_result`

**Request**

```text
repositorySessionId
opaquePathId
expectedStageFingerprint
expectedResultFingerprint
text
encodingPolicy
lineEndingPolicy
createBackup
explicitOverwriteDecision (only after stale response)
```

**Response**: existing `WriteResult` shape plus `CONFLICT_SAVED` user action message.

**Preconditions**: unchanged stage set, path contained in worktree root, regular or valid missing target, no symlink,
external-change policy satisfied, unresolved marker policy satisfied.

**Mutation contract**: Result path only. No index, HEAD, ref, config, or other working-tree file mutation.

### `get_git_merge_base`

**Request**: repository session, resolved left/right commit IDs, job ID.

**Response**: `none`, `single(objectId)`, or `multiple(objectIds)`.

### `open_git_merge_preview`

**Request**: repository session, single base ID, resolved left/right IDs, path selection, generation.

**Response**: `GitMergePreview`; save capabilities disabled.

### `list_git_file_history` *(candidate)*

**Request**: repository session, resolved start ID, opaque path ID, limit (default 50, hard max), job ID.

**Response**: bounded `GitFileHistoryEntry` metadata only.

### `cancel_git_job`

**Request**: repository session and job ID.

**Response**: acknowledgement. Completion/cancel races emit one terminal state and no stale list/session update.

## Stable Error Codes

```text
GIT_NOT_FOUND
GIT_VERSION_UNSUPPORTED
GIT_COMMAND_TIMEOUT
GIT_COMMAND_CANCELLED
GIT_OUTPUT_TOO_LARGE
GIT_NOT_REPOSITORY
GIT_UNSAFE_REPOSITORY
GIT_BARE_UNSUPPORTED
GIT_INVALID_REVISION
GIT_AMBIGUOUS_REVISION
GIT_PATH_NOT_AT_REVISION
GIT_OBJECT_MISSING_LOCAL
GIT_OBJECT_TYPE_UNSUPPORTED
GIT_BLOB_TOO_LARGE
GIT_BINARY_BLOB
GIT_LFS_POINTER
GIT_PATH_UNSUPPORTED
GIT_PATH_OUTSIDE_ROOT
GIT_SYMLINK_UNSUPPORTED
GIT_CONFLICT_STATE_CHANGED
GIT_MULTIPLE_MERGE_BASES
GIT_UNRELATED_HISTORIES
```

Unknown process/parse failures map to a stable generic Git code and friendly message. They do not expose raw stderr.

## Serialization Compatibility

- Rust uses the repository's established camelCase serialization conventions.
- TypeScript and Rust contract tests snapshot enum variants and field names together.
- Adding an enum variant requires an explicit unknown/fallback UI state before release.
- Renaming a field requires both sides and the associated contract tests in one issue.
