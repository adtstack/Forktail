# Contract: Production Git Runner Profile

## Positive Operation Allowlist

Only typed services may request these read operations:

```text
version
repository identity
symbolic HEAD
ref listing
bounded commit metadata
revision verification/disambiguation
tree listing/path lookup
blob type/size/content
revision changed-file metadata
working-tree status metadata
index stage 0 metadata
unmerged stage 1/2/3 metadata
merge-base candidates
bounded file history metadata (candidate)
```

The production type system exposes no generic arbitrary command operation.

## Forbidden Operations

The runner must be structurally unable to construct checkout, switch, restore, reset, clean, add, rm, mv, commit,
merge, rebase, cherry-pick, revert, continue, stash, branch/tag mutation, config mutation, worktree mutation, clone,
fetch, pull, push, remote access, submodule update, or maintenance operations.

Fixture setup uses a separate helper/module and cannot be passed to production services.

## Process Boundary

- Resolve an absolute regular executable and freeze it for the session.
- Pass executable and argv elements directly; never invoke a shell or concatenate a command string.
- Drain stdout/stderr concurrently.
- Apply separate stdout/stderr caps, timeout, cancellation, and process-tree termination.
- Reject unknown operations/options before starting a child.
- Do not include raw stderr, complete argv, path bytes, or content in default logs/user errors.

## Safe Global Profile

The approved ADR/version matrix must confirm support for the following semantics before implementation is enabled:

```text
no pager
no optional locks
no lazy fetch
no replacement objects
literal pathspecs
repository context from validated -C root
```

Status additionally disables filesystem monitor integration. Diff metadata disables external diff and text conversion.
All path-bearing output uses NUL framing where the command provides it. Revision validation uses an end-of-options
boundary and expected object type.

## Environment Profile

After executable resolution, clear the child environment and restore only reviewed OS boot variables, temp directory,
locale, and the following safe Git behavior:

```text
terminal prompt disabled
optional locks disabled
lazy fetch disabled
literal pathspecs enabled
pager fixed to non-interactive output
```

Do not inherit repository/worktree/index/object/config/namespace overrides, alternate object directories, askpass/SSH,
external diff, or Git trace variables. `safe.directory` errors are surfaced; no global wildcard bypass is added.

## Output Profiles

| Output | Framing | Cap strategy |
|---|---|---|
| revision/object ID | bounded line/field | small fixed cap |
| refs/history | exact machine format with bounded fields | hard count + byte cap |
| tree/status/index/changed files | raw bytes with NUL records | byte cap or batches + cancel |
| blob | exact size from metadata | reject before read above 64 MiB |
| stderr | opaque bytes | small cap, never user-visible verbatim |

Partial/truncated records never become successful partial results.

## Cache Profile

- Immutable revision/tree/blob keys include repository identity and full object ID.
- Blob content uses a memory-bounded LRU only.
- Index and working-tree results are not stored in immutable caches.
- Refresh invalidates session-scoped opaque path IDs.
- No cache entry stores credential material, raw stderr, Git temp source path, or persistent blob/diff content.
