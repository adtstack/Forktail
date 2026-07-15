# Research: Local Git Snapshot Review

## Decision 1: Git CLI-first, no library fallback

**Decision**: Repository/object/index information is read through a discovered local Git executable behind a
positive allowlist. Git absence or unsupported capabilities produce an actionable error; the app does not silently
fall back to libgit2 or direct `.git` parsing.

**Rationale**: Git itself understands linked worktrees, packed/reftable refs, SHA-256 repositories, partial clones,
and future repository formats. One process boundary also keeps the current dependency and packaging surface small.

**Alternatives considered**:

- libgit2: rejected for the initial release due to native packaging, semantic differences, and a second security surface.
- JGit: rejected because it introduces an unrelated runtime and packaging model.
- Direct `.git` parsing: rejected because it would miss supported storage/worktree variants and duplicate Git rules.

## Decision 2: Capability gate plus recorded minimum version

**Decision**: `GIT-000` records a numeric minimum Git version only after Windows/macOS/Linux option probes. Startup
checks both that version and the required capabilities. Missing safety options fail closed instead of running a weaker
profile. Batch `cat-file -Z` remains an optimization, not an MVP requirement.

**Rationale**: A version string alone does not guarantee vendor builds expose the required behavior, while silently
dropping `--no-lazy-fetch`, `--end-of-options`, or machine-output framing would weaken safety.

**Alternatives considered**:

- Hardcode the developer machine version: rejected as non-portable.
- Support older Git by omitting unavailable safety options: rejected because behavior would vary and might fetch or misparse.
- Require newest Git: rejected until the three-OS distribution baseline is measured.

## Decision 3: Freeze revisions before every downstream read

**Decision**: User revision strings are accepted only at the resolver boundary. A successful result contains a full
commit object identity, and later tree/diff/blob requests use that identity. Short ref and abbreviated object ambiguity
are detected structurally rather than from localized stderr.

**Rationale**: Refs can move between UI actions; immutable identities make the session reproducible and cacheable.

**Alternatives considered**:

- Reuse raw revision strings for every command: rejected due to races and option ambiguity.
- Parse warning text: rejected because stderr is localized and not a stable protocol.

## Decision 4: Preserve byte identity behind session-scoped opaque IDs

**Decision**: Git path bytes stay in Rust. UI receives an escaped display path and session-scoped opaque ID; future
requests return the opaque ID instead of a lossy string. Unsupported filesystem conversion fails explicitly.

**Rationale**: Unix Git paths are byte sequences. JSON strings cannot safely round-trip arbitrary bytes, and a lossy
display value could open or overwrite the wrong path.

**Alternatives considered**:

- Send lossy UTF-8 only: rejected because identity can change.
- Send base64 bytes to the UI: rejected because it exposes unnecessary backend identity and increases misuse risk.

## Decision 5: Raw blobs reuse the existing text pipeline

**Decision**: Blob type and size are checked before reading. Raw bytes then reuse the existing binary probe, BOM,
encoding, EOL, final-newline, and 64 MiB policy. LFS pointers, symlinks, and submodules remain distinct metadata states.

**Rationale**: File and Git snapshot views must classify identical bytes consistently. Reuse prevents silent policy drift.

**Alternatives considered**:

- Use textconv/filter/LFS smudge: rejected because helpers may execute code or network access and alter content.
- Decode every blob as UTF-8: rejected because it violates text fidelity and binary safety.

## Decision 6: Production runner is read-only by construction

**Decision**: Internal enums/services construct a fixed set of query operations. The frontend cannot pass argv.
Executable and argv are passed directly without a shell. The child environment is cleared and rebuilt from a reviewed
OS allowlist plus safe Git values. Output, timeout, cancellation, and process-tree termination are bounded.

**Rationale**: A denylist misses future commands and option combinations. A positive operation model makes tests able
to prove that mutation/network paths cannot be constructed.

**Alternatives considered**:

- Generic `run_git(args)` command: rejected as an injection and scope-expansion boundary.
- Tauri shell plugin: rejected because it grants a broader surface than the feature needs.

## Decision 7: Stage-0 index compare is the first new post-MVP addition

**Decision**: After working-tree compare, add a read-only stage-0 index snapshot so users can compare
`HEAD ↔ index`, `index ↔ working tree`, and `HEAD ↔ working tree`. No stage/unstage action is added.

**Rationale**: It resolves the most common commit-review question while remaining aligned with no-surprise writes.

**Alternatives considered**:

- Add stage/unstage buttons: rejected because mutation, recovery, and intent boundaries would expand sharply.
- Show only combined HEAD-to-working-tree diff: rejected because it hides whether a change is staged.

## Decision 8: Conflict save reuses the safe writer and never stages

**Decision**: Stage 1/2/3 are immutable sources; the working-tree Result is the sole editable target. Save rechecks
stage set, file fingerprint, containment, and symlink state, then calls the existing safe writer. Completion instructs
the user to stage/continue outside Forktail.

**Rationale**: It preserves current backup/atomic-replace guarantees and keeps repository mutation out of the app.

**Alternatives considered**:

- Run `git add` after save: rejected because save success is not the same as repository-level resolution approval.
- Recreate Result from stage sources on open: rejected because it would discard Git/user changes already in Result.

## Decision 9: Review productivity stores metadata only

**Decision**: Viewed/unviewed state is scoped to the active review session. Persistent recent session data may retain
repository path, revision labels/IDs, and options only after privacy review; it never stores blob text, diff output,
opaque temporary IDs, or Git temp paths.

**Rationale**: Review queues add high value without creating a content cache or recovery ambiguity.

**Alternatives considered**:

- Persist complete review content: rejected by privacy and stale-snapshot rules.
- Write reviewed markers into the repository: rejected because review must not mutate user files/config.

## Decision 10: Defer file history, copy detection, and bare repositories behind evidence gates

**Decision**: Bounded file history is `GIT-609`, after review MVP. Opt-in copy detection, bare repository support,
cross-repository compare, and submodule metadata jumps remain future opportunities requiring usage/performance evidence
and their own issue/ADR.

**Rationale**: These features are useful but not needed to prove safe revision review; each adds ambiguity or scale cost.

**Alternatives considered**:

- Build a full history graph first: rejected as Git-client scope drift.
- Enable copy detection by default: rejected until rename-heavy performance and false-positive value are measured.
- Treat bare and working-tree repositories identically: rejected because their user journeys and error states differ.

## Primary References

- `docs/17_GIT_INTEGRATION.md`
- `docs/18_GIT_BACKLOG.md`
- `docs/20_GIT_TEST_PLAN.md`
- `docs/21_GIT_REFERENCES.md`
- Official command references linked from `docs/21_GIT_REFERENCES.md`
