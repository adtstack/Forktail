# Implementation Plan: Local Git Snapshot Review

**Branch**: `codex/GIT-000-git-runner-adr` | **Date**: 2026-07-15 | **Spec**: [spec.md](./spec.md) | **Status**: source implemented, packaged OS evidence pending

**Input**: Feature specification from `specs/001-git-snapshot-integration/spec.md`

## Summary

기존 file/folder/merge 화면을 바꾸는 대신, local Git executable이 제공하는 immutable snapshot과
index metadata를 좁은 Rust service로 읽어 typed session으로 변환했다. revision compare,
working tree/index 비교, conflict Result 저장, merge-base preview, review productivity, bounded file
history를 각각 독립 `GIT-*` 이슈로 구현했다. Windows/Linux와 남은 macOS packaged 수동 증적은
source 완료와 분리해 `VALIDATION.md`에서 추적한다.

이 plan은 umbrella delivery plan이다. 한 PR로 구현하지 않으며 `tasks.md`의 각 `GIT-*` 단위를
하나의 이슈·하나의 PR로 실행한다.

## Technical Context

**Language/Version**: TypeScript 6.0.3 strict, React 19.2.7; Rust edition 2024, rust-version 1.85

**Primary Dependencies**: Tauri 2.11, Monaco 0.55, existing `diffy`, `encoding_rs`, `chardetng`, `blake3`; local Git CLI selected by `GIT-000`/`GIT-003`; no new broad shell or filesystem plugin

**Storage**: Existing local settings for metadata-only recent/review state; memory-bounded immutable blob cache; user-selected patch output and conflict Result only through existing safe writer; no blob/diff disk cache

**Testing**: Vitest contract/component tests; Rust unit tests, fake-runner tests, `tempfile` real-repository integration; three-OS packaged difftool/mergetool smoke

**Target Platform**: Windows, macOS, Linux desktop packages supported by the current Tauri release matrix

**Project Type**: Cross-platform desktop application with React/TypeScript UI and Rust/Tauri backend

**Performance Goals**: 10,000 changed entries remain navigable without a UI stall over 100ms; cancellation acknowledgement target under 1s; blob read stays within the existing 64 MiB text limit; large metadata output is bounded or batched

**Constraints**: Offline and local-object-only; no repository mutation except explicit conflict Result save; no credential prompt, lazy fetch, textconv/filter, LFS smudge, external diff, optional index write; byte-safe path identity; deterministic output; no new file-content logging

**Scale/Scope**: Initial MVP supports one working-tree repository and one active Git review session, 10,000 changed paths, 10,000 refs, SHA-1/SHA-256 object identities, linked worktrees, shallow/partial/sparse states with explicit limitations

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Predictability — PASS**: raw revisions are frozen to immutable object identities; missing, binary,
  unsupported type, multiple merge-base, and stale state are explicit.
- **No-surprise writes — PASS**: revision/index/status paths are read-only; conflict Result and patch Save As
  are the only writes and reuse existing external-change, backup, and atomic replace guards.
- **Local privacy — PASS**: no fetch, credential prompt, helper/filter execution, telemetry, content logging, or
  persistent blob cache is allowed.
- **Architecture boundary — PASS**: React receives typed requests and DTOs only; Git executable, argv, bytes,
  path identity, containment, cancellation, and safe save remain in Rust.
- **Test-first delivery — PASS**: the umbrella plan is decomposed into existing/new `GIT-*` issue-sized units;
  parser, fake runner, temp repository, UI contract, and packaged smoke tests precede completion.

No constitution violation or exception is required.

## Project Structure

### Documentation (this feature)

```text
specs/001-git-snapshot-integration/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── git-command-contract.md
│   └── git-runner-profile.md
├── checklists/
│   └── requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
src/
├── App.tsx
├── components/
│   ├── GitCompareView.tsx
│   ├── GitConflictView.tsx
│   ├── GitRevisionSelector.tsx
│   ├── GitChangedFiles.tsx
│   ├── GitWorkingTreeFiles.tsx
│   └── GitTreePicker.tsx
└── core/
    ├── bridge.ts
    ├── models.ts
    ├── gitModels.ts
    ├── gitSession.ts
    └── gitReview.ts

src-tauri/src/
├── lib.rs
├── error.rs
├── commands/
│   ├── mod.rs
│   └── git.rs
├── domain/
│   ├── mod.rs
│   └── git.rs
└── git/
    ├── mod.rs
    ├── runner.rs
    ├── executable.rs
    ├── repository.rs
    ├── revision.rs
    ├── refs.rs
    ├── tree.rs
    ├── blob.rs
    ├── changed_files.rs
    ├── status.rs
    ├── index.rs
    ├── conflicts.rs
    ├── merge_base.rs
    ├── history.rs
    ├── session.rs
    └── parsers.rs
```

**Structure Decision**: 현재 단일 Tauri app 구조를 유지한다. 모듈은 해당 `GIT-*` 이슈가 실제로
도입될 때만 추가하며, 처음부터 빈 파일을 만들지 않는다. Rust `git/`은 production read-only
runner와 fixture mutation helper를 타입·모듈 수준에서 분리한다. UI는 기존 `FileCompareView`와
`MergeView`에 origin/capability metadata를 전달하고 Git-specific I/O를 복제하지 않는다.

## Delivery Phases

| Phase | Backlog scope | Exit evidence |
|---|---|---|
| 0. Gate | `MRG-014`, `INT-002`, `GIT-000` | source safety/CLI-first ADR 완료; packaged lifecycle은 release evidence로 계속 추적 |
| 1. Foundation | `GIT-001`~`005` | allowlist/env/cap/cancel, stable DTO/error, byte/NUL parser |
| 2. Revision MVP | `GIT-101`~`103`, `201`~`203`, `301`~`302`, `601`~`603` | branch/commit read-only compare and mutation fingerprint |
| 3. Working/index | `GIT-401`~`403`, `GIT-605` | HEAD/index/working-tree pair compare without index change |
| 4. Conflict | `GIT-501`~`503`, `GIT-604` | stage mapping and Result-only safe save |
| 5. Preview | `GIT-701`~`702` | single-base read-only 3-way preview |
| 6. Review productivity | `GIT-606`, `GIT-607`~`609` | large-list review state, patch export, bounded file history |
| 7. Release evidence | `GIT-801` | docs, privacy/no-network proof, three-OS smoke record |

`GIT-403`, `GIT-607`, `GIT-608`, `GIT-609`는 이 specification에서 추가돼 source 구현과 자동
검증을 완료했다. 승격 뒤에도 T009/SC-007 packaged release evidence는 별도 미완료 상태를 유지하며,
Windows/Linux `manual-not-run`은 사용자가 직접 확인할 항목이다.

## Complexity Tracking

No constitution violations require justification. The Git CLI process boundary is an approved candidate decision
to be finalized by `GIT-000`; libgit2/JGit and a full Git client UI are explicitly rejected for the initial scope.

## Post-Design Constitution Check

- **Predictability — PASS**: `data-model.md` separates raw input, resolved identity, snapshot origin, and stale state.
- **No-surprise writes — PASS**: contracts expose no arbitrary command or repository mutation operation.
- **Local privacy — PASS**: runner profile clears unsafe environment and contracts forbid content persistence.
- **Architecture boundary — PASS**: command contracts are narrow and all path/object identity round-trips remain in Rust.
- **Test-first delivery — PASS**: `quickstart.md` and future `tasks.md` require focused tests before implementation and full repository gates.

No approved ADR exception is needed after design.
