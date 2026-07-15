# Quickstart Validation: Local Git Snapshot Review

This guide defines runnable evidence for each delivery slice. It does not authorize implementing multiple `GIT-*`
issues in one PR.

## Prerequisites

- Phase 1 runtime/save gates listed in `spec.md` are complete or explicitly recorded as pending.
- Local Git availability and required capability probes are recorded by `GIT-000`/`GIT-003`.
- Node.js 22+, Rust 1.85+, project dependencies installed.
- Tests use temporary repositories and isolated repository-local identity/config only.

## 1. Common gates

Run for every frontend or contract change:

```bash
npm run typecheck
npm test
npm run build
```

Run for every Rust, Tauri command, parser, or repository service change:

```bash
cd src-tauri
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
```

Expected: all commands succeed. A missing optional Git capability may skip only the named real-repository fixture with
the probe reason; parser/fake-runner tests still run.

## 2. Revision compare MVP

Fixture setup creates an isolated repository with:

1. an initial text commit;
2. one modified file;
3. one added/deleted pair;
4. one rename;
5. binary, symlink, LFS pointer, Unicode path, and supported non-UTF-8 path cases;
6. a second commit and refs pointing at both snapshots.

Validation journey:

```text
open repository
→ resolve left/right refs
→ list changed files
→ open modified/added/deleted/renamed entries
→ close without write
```

Expected:

- Exact snapshot content matches objects in the fixture.
- Missing differs from empty; unsupported content has explicit metadata state.
- Repository fingerprint before/after is byte-identical.
- Fake runner records zero forbidden/network/helper operations.

## 3. HEAD/index/working-tree compare

Fixture setup stages one edit and then adds a second unstaged edit to the same path.

Validation journey:

```text
HEAD ↔ index          → staged edit only
index ↔ working tree → unstaged edit only
HEAD ↔ working tree  → both edits
```

Expected: the three diffs are distinct and correct; index bytes/mtime and disk content do not change.

## 4. Conflict Result save

Fixture setup creates both-modified, add/add, modify/delete, binary, and rebase conflict cases through the fixture-only
mutation helper.

Validation journey:

```text
list conflicts
→ inspect stage availability and operation labels
→ open text Result
→ resolve markers
→ save Result
→ inspect repository state
```

Expected:

- Stage sources match index objects and Result initially matches disk.
- Save uses external-change, backup, fsync/atomic replace, and unresolved-marker guards.
- Only Result changes while Forktail runs; index remains unmerged and no add/continue occurs.
- Every injected write failure preserves the original Result.

## 5. Merge-base preview

Use clean, conflict, unrelated-history, and criss-cross/multiple-base fixtures.

Expected:

- One base opens read-only Base/Left/Right/Result preview.
- Zero or multiple bases do not auto-select a base.
- No save capability or repository mutation is exposed.

## 6. Review productivity

Generate a 10,000-entry changed-file response without storing file content.

Validate:

- status/path filters and counts;
- next/previous and next-unviewed keyboard navigation;
- viewed reset when revision pair changes;
- stale/cancel behavior;
- no UI input stall over 100ms in the measured target environment;
- patch Save As writes only the chosen output and identifies the resolved snapshots;
- persistent storage contains no blob text, diff output, or Git temp paths.

## 7. File history candidate

Create a bounded history with a rename and a shallow boundary.

Expected:

- Only the configured maximum metadata entries are returned.
- Commit body and file content are not preloaded.
- Selecting two entries opens the normal revision compare.
- Missing local history does not fetch.

## 8. Release evidence

For each supported OS, record Git version/capabilities and packaged results for:

- repository open and revision compare;
- Unicode/space executable and repository paths;
- cancellation/process cleanup;
- difftool wait and temp lifecycle;
- mergetool missing Base, save, no-save, unresolved, and wrapper post-exit behavior;
- conflict Result safe save and file-lock/permission behavior.

Unexecuted platform checks remain explicitly pending in `VALIDATION.md`; they are never reported as passed.
