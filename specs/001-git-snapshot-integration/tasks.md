# Tasks: Local Git Snapshot Review

**Input**: Design documents from `specs/001-git-snapshot-integration/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`

**Tests**: 모든 동작 변경은 관련 테스트를 먼저 추가하고 실패를 확인한 뒤 구현한다. 각 `GIT-*`는
하나의 이슈·하나의 PR 범위를 유지하며, 이 문서 전체를 한 PR로 구현하지 않는다.

**Organization**: Tasks are grouped by user story so the read-only revision MVP can ship before later capabilities.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 다른 파일을 변경하고 미완료 task에 의존하지 않아 병렬 수행 가능
- **[Story]**: `spec.md`의 User Story
- 모든 task는 정확한 이슈 ID와 파일 경로를 포함한다.

## Phase 1: Setup and Product Gates

**Purpose**: repository-aware Git을 시작하기 전에 외부 tool lifecycle과 CLI-first 결정을 고정한다.

- [X] T001 GIT-000 최소 Git version/capability, CLI-first, allowlist, no-network/no-mutation 결정을 `docs/10_ADR.md`, `docs/17_GIT_INTEGRATION.md`, `docs/21_GIT_REFERENCES.md`, `research.md`에 기록한다
- [X] T002 MRG-012 기본 Git label·diff3·base-less marker와 unresolved mergetool save 차단 테스트를 `src/core/conflicts.test.ts`, `src/core/mergeSave.test.ts`, `src/core/startupSession.test.ts`에 먼저 추가한다
- [X] T003 MRG-012 Git marker parser와 mergetool unresolved hard-block policy를 `src/core/conflicts.ts`, `src/core/mergeSave.ts`에 구현한다
- [X] T004 MRG-014 missing Base, 기존 `$MERGED` Result/fingerprint, mergetool origin, dirty close, Git temp path 비영속화 테스트를 `src/core/mergetoolSession.test.ts`, `src/core/startupSession.test.ts`, `src/core/settings.test.ts`, `src/components/MergeView.test.tsx`에 먼저 추가한다
- [X] T005 MRG-014 mergetool 전용 session adapter와 `$MERGED`-only save/close lifecycle을 `src/core/mergetoolSession.ts`, `src/core/startupSession.ts`, `src/core/settings.ts`, `src/App.tsx`, `src/components/MergeView.tsx`에 구현한다
- [X] T006 INT-002 `$LOCAL`/`$REMOTE` read-only difftool parser와 Windows/macOS/Linux config quote snapshot 테스트를 `src/core/startupSession.test.ts`, `src/core/gitToolConfig.test.ts`, `src/components/FileCompareView.test.tsx`에 먼저 추가한다
- [X] T007 INT-002 `--difftool` read-only session, packaged executable path command, OS별 copy-only config UI를 `src/core/startupSession.ts`, `src/core/gitToolConfig.ts`, `src/core/models.ts`, `src/core/bridge.ts`, `src-tauri/src/commands/system.rs`, `src/App.tsx`, `src/components/FileCompareView.tsx`, `src/components/GitToolSetup.tsx`에 구현한다
- [X] T008 INT-002 difftool/mergetool config 출력, `trustExitCode=false`, `hideResolved=false`, 자동 config/default tool 수정 금지 안내를 `docs/14_PRODUCT_GAP_ROADMAP.md`, `README.md`, `VALIDATION.md`에 확정한다
- [ ] T009 INT-002/MRG-014 `scripts/git-tool-smoke.mjs`, `scripts/git-tool-smoke.integration.test.mjs`, `package.json`, `.github/workflows/ci.yml`의 격리 fixture/verifier/checklist를 사용해 Windows/macOS/Linux packaged difftool wait/temp/modified/added/deleted/read-only/launch-failure/crash와 mergetool save/no-save/unresolved/external-change-race/missing-Base/empty-Base/temp/wait, Windows UNC/file-lock, macOS NFC/NFD, Linux executable/runtime 증거를 `VALIDATION.md`와 `docs/20_GIT_TEST_PLAN.md`에 기록한다

**Checkpoint**: 시작 gate가 통과되지 않으면 Phase 2 이후 이슈를 승격하지 않는다.

---

## Phase 2: Foundational Git Boundary

**Purpose**: 모든 user story가 공유하는 process, error, repository, byte-path 경계

**⚠️ CRITICAL**: 이 phase가 완료되기 전에는 Git user story UI를 구현하지 않는다.

- [X] T010 GIT-001 fake runner의 argv/env/stdout-stderr drain/timeout/cancel/cap/forbidden-operation 실패 테스트를 `src-tauri/src/git/runner.rs`에 먼저 추가한다
- [X] T011 GIT-001 positive-allowlisted production runner와 fixture-only mutation helper 분리를 `src-tauri/src/git/runner.rs`, `src-tauri/src/git/mod.rs`, `src-tauri/src/lib.rs`에 구현한다
- [X] T012 [P] GIT-002 Git error/DTO camelCase 직렬화와 friendly message 계약 테스트를 `src-tauri/src/error.rs`, `src-tauri/src/domain/git.rs`, `src/core/errors.test.ts`, `src/core/gitModels.test.ts`에 먼저 추가한다
- [X] T013 GIT-002 stable Git error와 object/path/repository DTO를 `src-tauri/src/error.rs`, `src-tauri/src/domain/git.rs`, `src/core/errors.ts`, `src/core/gitModels.ts`에 구현한다
- [X] T014 [P] GIT-003 Git discovery/version/capability와 공백·Unicode executable path 테스트를 `src-tauri/src/git/executable.rs`에 먼저 추가한다
- [X] T015 GIT-003 absolute Git executable discovery와 fail-closed capability gate를 `src-tauri/src/git/executable.rs`, `src-tauri/src/commands/git.rs`에 구현한다
- [X] T016 GIT-004 root/nested/non-repo/bare/linked-worktree/detached/unsafe repository integration 테스트를 `src-tauri/src/git/repository.rs`에 먼저 추가한다
- [X] T017 GIT-004 repository identity와 session lifecycle을 `src-tauri/src/git/repository.rs`, `src-tauri/src/commands/git.rs`, `src-tauri/src/domain/git.rs`에 구현한다
- [X] T018 [P] GIT-005 NUL/truncated/non-UTF-8/control-byte/duplicate opaque ID parser 테스트를 `src-tauri/src/git/parsers.rs`에 먼저 추가한다
- [X] T019 GIT-005 byte-preserving parser primitive와 session-scoped opaque path map을 `src-tauri/src/git/parsers.rs`, `src-tauri/src/domain/git.rs`에 구현한다

**Checkpoint**: frontend가 arbitrary Git argv/path bytes를 전달할 수 없고 production runner가 mutation/network operation을 구성할 수 없다.

---

## Phase 3: User Story 1 - 두 revision의 변경 검토 (Priority: P1) 🎯 MVP

**Goal**: checkout 없이 두 local revision의 changed-file 목록과 선택 snapshot diff를 read-only로 연다.

**Independent Test**: modified/added/deleted/rename/type/binary fixture를 열고 전후 HEAD·refs·index·working tree fingerprint가 동일하며 helper/network invocation이 0임을 검증한다.

### Tests for User Story 1

- [X] T020 [US1] GIT-101 HEAD/branch/tag/full·abbrev ID/short-name collision/detached/invalid revision 테스트를 `src-tauri/src/git/revision.rs`에 먼저 추가한다
- [X] T021 [P] [US1] GIT-102 local/remote-tracking/tag ref framing, cap, control-character 테스트를 `src-tauri/src/git/refs.rs`에 먼저 추가한다
- [X] T022 [P] [US1] GIT-201 regular/executable/symlink/submodule/SHA-256/non-UTF-8 tree parser 테스트를 `src-tauri/src/git/tree.rs`에 먼저 추가한다
- [X] T023 [US1] GIT-202 UTF-8/UTF-16/binary/64 MiB boundary/type-size mismatch blob 테스트를 `src-tauri/src/git/blob.rs`와 `src-tauri/src/commands/files.rs`에 먼저 추가한다
- [X] T024 [P] [US1] GIT-203 lazy-fetch/filter/textconv/LFS helper가 0회인 fake/partial-clone 테스트를 `src-tauri/src/git/blob.rs`와 `src/core/networkPolicy.test.ts`에 먼저 추가한다
- [X] T025 [P] [US1] GIT-301 A/D/M/T/R/C/U/unknown/truncated byte record와 rename score 테스트를 `src-tauri/src/git/changed_files.rs`에 먼저 추가한다
- [X] T026 [US1] GIT-302 status-to-session, missing-vs-empty, origin/read-only capability 계약 테스트를 `src-tauri/src/git/session.rs`와 `src/core/gitSession.test.ts`에 먼저 추가한다
- [X] T027 [P] [US1] GIT-601 repository open cancel/loading/error/keyboard/200%와 repository→revision pair→changed file diff가 5회 이하 major interaction인 component 테스트를 `src/components/GitCompareView.test.tsx`와 `src/components/StartPage.test.tsx`에 먼저 추가한다
- [X] T028 [P] [US1] GIT-602 revision selector race/ambiguity/keyboard/combobox 테스트를 `src/components/GitRevisionSelector.test.tsx`에 먼저 추가한다
- [X] T029 [P] [US1] GIT-603 changed-file filter/count/rename/selection/10k virtualization/read-only와 bare/copy/cross-repository 후보 비노출 테스트를 `src/components/GitChangedFiles.test.tsx`와 `src/components/FileCompareView.test.tsx`에 먼저 추가한다

### Implementation for User Story 1

- [X] T030 [US1] GIT-101 raw revision 검증·ambiguity 판정·immutable object ID 고정을 `src-tauri/src/git/revision.rs`, `src-tauri/src/commands/git.rs`에 구현한다
- [X] T031 [US1] GIT-102 bounded local ref selector service를 `src-tauri/src/git/refs.rs`, `src-tauri/src/commands/git.rs`에 구현한다
- [X] T032 [US1] GIT-201 revision tree/path lookup과 mode/type 분류를 `src-tauri/src/git/tree.rs`, `src-tauri/src/commands/git.rs`에 구현한다
- [X] T033 [US1] GIT-202 blob type/size/read와 공유 text decode pipeline을 `src-tauri/src/git/blob.rs`, `src-tauri/src/commands/files.rs`, `src-tauri/src/domain/git.rs`에 구현한다
- [X] T034 [US1] GIT-203 raw blob/LFS/no-lazy-fetch 상태와 bounded memory cache를 `src-tauri/src/git/blob.rs`, `src-tauri/src/git/runner.rs`에 구현한다
- [X] T035 [US1] GIT-301 name-status changed-file service와 lossless old/new path mapping을 `src-tauri/src/git/changed_files.rs`, `src-tauri/src/commands/git.rs`에 구현한다
- [X] T036 [US1] GIT-302 read-only compare session builder와 TypeScript adapter를 `src-tauri/src/git/session.rs`, `src/core/gitSession.ts`, `src/core/gitModels.ts`, `src/core/bridge.ts`에 구현한다
- [X] T037 [US1] GIT-601 `Open Git Repository` shell과 repository header를 `src/components/StartPage.tsx`, `src/components/GitCompareView.tsx`, `src/App.tsx`에 구현한다
- [X] T038 [US1] GIT-602 left/right revision selector와 stale validation handling을 `src/components/GitRevisionSelector.tsx`, `src/components/GitCompareView.tsx`, `src/core/gitSession.ts`에 구현한다
- [X] T039 [US1] GIT-603 changed-file sidebar와 기존 read-only diff viewer 연결을 `src/components/GitChangedFiles.tsx`, `src/components/GitCompareView.tsx`, `src/components/FileCompareView.tsx`에 구현한다

**Checkpoint**: User Story 1만으로 local branch/commit review MVP를 독립 배포·검증할 수 있다.

---

## Phase 4: User Story 2 - HEAD, index, working tree 비교 (Priority: P2)

**Goal**: staged와 unstaged 변경을 mutation 없이 분리해 검토한다.

**Independent Test**: 같은 path에 staged edit와 추가 unstaged edit를 만든 뒤 세 pair compare가 정확히 다른 결과를 보이고 index/disk fingerprint가 동일함을 검증한다.

### Tests for User Story 2

- [X] T040 [US2] GIT-401 porcelain v2 clean/dirty/rename/untracked/unmerged/unborn/detached byte parser와 index-mutation guard 테스트를 `src-tauri/src/git/status.rs`에 먼저 추가한다
- [X] T041 [US2] GIT-402 revision↔working-tree root escape/symlink/TOCTOU/missing/binary/external-change 테스트를 `src-tauri/src/git/session.rs`에 먼저 추가한다
- [X] T042 [US2] GIT-403 stage-0/staged+unstaged/intent-to-add/sparse/index-race three-state 테스트를 `src-tauri/src/git/index.rs`에 먼저 추가한다
- [ ] T043 [P] [US2] GIT-605 staged/unstaged/untracked/unmerged filter/refresh/keyboard UI 테스트를 `src/components/GitWorkingTreeFiles.test.tsx`에 먼저 추가한다

### Implementation for User Story 2

- [X] T044 [US2] GIT-401 bounded porcelain-v2 status service와 branch state를 `src-tauri/src/git/status.rs`, `src-tauri/src/commands/git.rs`에 구현한다
- [X] T045 [US2] GIT-402 revision↔working-tree session과 containment/fingerprint guard를 `src-tauri/src/git/session.rs`, `src-tauri/src/commands/git.rs`, `src/core/gitSession.ts`에 구현한다
- [X] T046 [US2] GIT-403 stage-0 index reader와 HEAD/index/working-tree pair session을 `src-tauri/src/git/index.rs`, `src-tauri/src/git/session.rs`, `src-tauri/src/commands/git.rs`, `src/core/gitSession.ts`에 구현한다
- [ ] T047 [US2] GIT-605 working-tree changed-file UI와 three-state selector를 `src/components/GitWorkingTreeFiles.tsx`, `src/components/GitCompareView.tsx`에 구현한다

**Checkpoint**: stage/unstage button 없이 commit 전 staged/unstaged review가 완결된다.

---

## Phase 5: User Story 3 - Git conflict를 안전하게 해결 (Priority: P3)

**Goal**: stage 1/2/3과 Result를 정확히 열고 Result 한 파일만 safe-save한다.

**Independent Test**: both-modified/add-add/delete-modify/rebase fixture에서 stage mapping과 label을 확인하고 fault injection마다 기존 Result 및 index를 보존한다.

### Tests for User Story 3

- [ ] T048 [US3] GIT-501 stage 1/2/3 grouping, missing/duplicate stage, add-add/delete-modify/rename/type conflict 테스트를 `src-tauri/src/git/conflicts.rs`에 먼저 추가한다
- [ ] T049 [US3] GIT-502 conflict operation label, missing Result, marker/binary/symlink/submodule session 테스트를 `src-tauri/src/git/session.rs`와 `src/core/gitSession.test.ts`에 먼저 추가한다
- [ ] T050 [US3] GIT-503 stage/result fingerprint race, containment/symlink, unresolved marker, write fault, index mutation guard 테스트를 `src-tauri/src/git/conflicts.rs`와 `src-tauri/src/commands/files.rs`에 먼저 추가한다
- [ ] T051 [P] [US3] GIT-604 conflict selection/save-refresh/dirty-switch/keyboard UI 테스트를 `src/components/GitConflictView.test.tsx`와 `src/components/MergeView.test.tsx`에 먼저 추가한다

### Implementation for User Story 3

- [ ] T052 [US3] GIT-501 unmerged path/stage discovery와 operation context를 `src-tauri/src/git/conflicts.rs`, `src-tauri/src/commands/git.rs`에 구현한다
- [ ] T053 [US3] GIT-502 stage snapshot + working Result merge session adapter를 `src-tauri/src/git/session.rs`, `src/core/gitSession.ts`, `src/core/gitModels.ts`에 구현한다
- [ ] T054 [US3] GIT-503 Result-only safe-save와 `CONFLICT_SAVED` next-step contract를 `src-tauri/src/git/conflicts.rs`, `src-tauri/src/commands/git.rs`, `src/core/mergeSave.ts`에 구현한다
- [ ] T055 [US3] GIT-604 conflict list와 기존 MergeView 연결을 `src/components/GitConflictView.tsx`, `src/components/MergeView.tsx`, `src/App.tsx`에 구현한다

**Checkpoint**: Forktail은 Result를 저장하지만 index를 unresolved 상태로 두고 terminal 후속 작업을 안내한다.

---

## Phase 6: User Story 4 - merge 결과 사전 검토 (Priority: P4)

**Goal**: 공통 base가 하나일 때만 read-only 3-way preview를 제공한다.

**Independent Test**: one/zero/multiple-base fixture와 clean/conflict preview를 열고 save capability와 repository mutation이 없음을 검증한다.

### Tests for User Story 4

- [ ] T056 [US4] GIT-701 single/none/multiple merge-base, missing object, timeout/cancel 테스트를 `src-tauri/src/git/merge_base.rs`에 먼저 추가한다
- [ ] T057 [US4] GIT-702 clean/conflict/missing/binary/type-change/read-only capability 테스트를 `src-tauri/src/git/session.rs`, `src/core/gitSession.test.ts`, `src/components/MergeView.test.tsx`에 먼저 추가한다

### Implementation for User Story 4

- [ ] T058 [US4] GIT-701 merge-base typed service를 `src-tauri/src/git/merge_base.rs`, `src-tauri/src/commands/git.rs`에 구현한다
- [ ] T059 [US4] GIT-702 immutable Base/Left/Right preview adapter와 disclaimer UI를 `src-tauri/src/git/session.rs`, `src/core/gitSession.ts`, `src/components/MergeView.tsx`에 구현한다

**Checkpoint**: preview가 실제 Git merge로 오인되지 않고 항상 read-only다.

---

## Phase 7: User Story 5 - 큰 변경 집합을 빠르게 검토 (Priority: P5)

**Goal**: large tree 탐색, viewed queue, keyboard review, plain patch export로 검토 완료 시간을 줄인다.

**Independent Test**: 10,000개 목록에서 filter/next-unviewed/viewed reset/patch export를 검증하고 persistent content leakage와 repository mutation이 0임을 확인한다.

### Tests for User Story 5

- [ ] T060 [US5] GIT-606 10k/100k tree virtualization, fuzzy search, different-path, opaque identity, cancel/stale와 10k 입력의 100ms UI stall budget benchmark를 `src/components/GitTreePicker.test.tsx`와 `src-tauri/src/git/tree.rs`에 먼저 추가한다
- [ ] T061 [P] [US5] GIT-607 viewed reducer/filter-count/revision-reset/next-unviewed/privacy retention 테스트를 `src/core/gitReview.test.ts`와 `src/core/settings.test.ts`에 먼저 추가한다
- [ ] T062 [US5] GIT-608 modified/added/deleted/rename/no-final-newline exact patch와 Save As fault/cancel/mutation 테스트를 `src/core/diffReport.test.ts`, `src/core/gitSession.test.ts`, `src-tauri/src/commands/files.rs`에 먼저 추가한다

### Implementation for User Story 5

- [ ] T063 [US5] GIT-606 lazy/batched tracked-tree picker와 different-path session mapping을 `src/components/GitTreePicker.tsx`, `src/components/GitCompareView.tsx`, `src-tauri/src/git/tree.rs`에 구현한다
- [ ] T064 [US5] GIT-607 session-local viewed queue와 keyboard next-unviewed를 `src/core/gitReview.ts`, `src/components/GitChangedFiles.tsx`, `src/components/GitCompareView.tsx`에 구현한다
- [ ] T065 [US5] GIT-608 immutable snapshot unified patch Save As를 `src/core/diffReport.ts`, `src/core/gitSession.ts`, `src/components/GitCompareView.tsx`, `src/core/bridge.ts`에 구현한다

**Checkpoint**: review state는 metadata-only이며 patch output 외 source state는 바뀌지 않는다.

---

## Phase 8: User Story 6 - 선택 파일의 로컬 이력 탐색 (Priority: P6)

**Goal**: bounded local file history에서 두 snapshot compare를 연다.

**Independent Test**: rename/shallow/non-UTF-8 history fixture가 limit/cancel/no-fetch를 지키며 선택한 두 object를 기존 compare로 여는지 검증한다.

### Tests for User Story 6

- [ ] T066 [US6] GIT-103 bounded recent commit framing/order/limit/control-character/shallow 테스트를 `src-tauri/src/git/history.rs`에 먼저 추가한다
- [ ] T067 [US6] GIT-609 rename boundary/deleted path/non-UTF-8/shallow/limit/cancel/no-network file-history 테스트를 `src-tauri/src/git/history.rs`와 `src/components/GitFileHistory.test.tsx`에 먼저 추가한다

### Implementation for User Story 6

- [ ] T068 [US6] GIT-103 selector용 recent commit metadata service를 `src-tauri/src/git/history.rs`, `src-tauri/src/commands/git.rs`에 구현한다
- [ ] T069 [US6] GIT-609 bounded file-history service와 snapshot compare handoff UI를 `src-tauri/src/git/history.rs`, `src-tauri/src/commands/git.rs`, `src/components/GitFileHistory.tsx`, `src/core/gitSession.ts`에 구현한다

**Checkpoint**: full history graph 없이 선택 path의 local context만 제공한다.

---

## Phase 9: Polish and Release Evidence

**Purpose**: cross-cutting privacy, packaged lifecycle, documentation, final gates

- [ ] T070 [P] GIT-801 user-facing Git scope/no-network/no-mutation/LFS/submodule/conflict-next-step 문서를 `README.md`, `docs/17_GIT_INTEGRATION.md`, `docs/20_GIT_TEST_PLAN.md`에 동기화한다
- [ ] T071 GIT-801 Windows/macOS/Linux packaged repository-aware revision compare/conflict-save smoke와 T009 external-tool evidence 참조를 `VALIDATION.md`에 기록한다
- [ ] T072 [P] GIT-801 forbidden command/environment/content persistence 회귀 gate를 `src/core/networkPolicy.test.ts`, `src/core/privacyLoggingPolicy.test.ts`, `src/core/securityConfig.test.ts`에 추가한다
- [ ] T073 GIT-801 전체 frontend/Rust 검증과 미실행 OS 항목을 `VALIDATION.md`에 실제 결과로 기록한다

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 Gate**: 시작점. `T001`~`T009`가 승인/검증되기 전 candidate implementation을 승격하지 않는다. T002→T003, T004→T005, T006→T007→T008 순서를 지키고 T009는 T005와 T008 뒤에 실행한다.
- **Phase 2 Foundation**: Phase 1에 의존하며 모든 user story를 block한다.
- **US1 / Phase 3**: Foundation 뒤 시작하며 제품 MVP다.
- **US2 / Phase 4**: US1 snapshot/session primitives에 의존한다.
- **US3 / Phase 5**: Foundation, GIT-202 blob, GIT-401 status와 기존 safe writer에 의존한다; US2 UI 완료는 필수가 아니다.
- **US4 / Phase 6**: US1 blob/session과 기존 merge engine에 의존한다.
- **US5 / Phase 7**: US1 UI가 실제 사용성 검증을 통과한 뒤 승격한다.
- **US6 / Phase 8**: US1, GIT-103, GIT-607 review handoff에 의존하며 선택 후보다.
- **Phase 9**: 출시하려는 story subset이 완료된 뒤 실행한다.

### User Story Dependency Graph

```text
Gate → Foundation → US1 (MVP)
                       ├─→ US2
                       ├─→ US3 (plus status + safe writer)
                       ├─→ US4
                       └─→ US5 → US6
```

### Parallel Opportunities

- Foundation에서는 GIT-002 DTO test, GIT-003 executable test, GIT-005 pure parser test를 서로 다른 파일에서 준비할 수 있다.
- US1에서 ref/tree/changed-file pure parser tests와 React shell tests는 foundation contract가 고정된 뒤 병렬 준비할 수 있다.
- US2/US3/US4는 US1 MVP 뒤 서로 다른 backend/UI 파일에서 진행할 수 있지만 같은 `session.rs`, `commands/git.rs`, `gitSession.ts` 수정은 순차 조정한다.
- US5의 pure review reducer test는 tracked-tree backend와 병렬 준비할 수 있다.

## Parallel Example: User Story 1

```text
T021 GIT-102 ref parser tests
T022 GIT-201 tree parser tests
T025 GIT-301 changed-file parser tests
T027 GIT-601 repository shell component tests
T028 GIT-602 revision selector tests
T029 GIT-603 changed-files UI tests
```

위 test task들은 Phase 2 contract 완료 뒤 병렬 준비할 수 있다. 각 이슈의 implementation task는 해당
test가 실패하는 것을 확인한 뒤에만 시작한다.

## Implementation Strategy

### MVP First

1. Phase 1의 external tool/ADR gate를 닫는다.
2. Phase 2의 runner, DTO/error, repository, byte identity를 완성한다.
3. Phase 3 User Story 1만 구현한다.
4. `quickstart.md` §2와 전체 frontend/Rust gate를 실행한다.
5. read-only/no-network/no-mutation 증거와 실제 review 시간 개선을 확인한 뒤 다음 story를 승격한다.

### Incremental Delivery

1. US1: branch/commit snapshot review
2. US2: staged/unstaged three-state review
3. US3: conflict Result-only safe save
4. US4: merge-base preview
5. US5: review productivity and patch export
6. US6: bounded file history

각 story는 독립 demo와 rollback 가능한 release unit이며, 후속 story를 위해 앞 story의 안전 gate를
완화하지 않는다.

## Notes

- `[P]`는 같은 파일 충돌과 미완료 dependency가 없는 task에만 사용한다.
- 모든 test task는 대응 implementation task보다 먼저 실패를 확인한다.
- 실제 user repository나 global Git config를 test fixture로 사용하지 않는다.
- Git이 없거나 capability가 부족한 환경에서도 parser/fake runner tests는 skip하지 않는다.
- 실행하지 않은 packaged/manual 검증은 통과로 기록하지 않는다.
