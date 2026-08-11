# Tasks: Progressive Folder Scan

**Input**: Design documents from `/specs/003-progressive-folder-scan/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/progressive-folder-scan.md`, `quickstart.md`

**Issue**: `FOL-006R`

**Tests**: 폴더 비교 계약 변경이므로 각 user story의 테스트를 구현보다 먼저 작성하고 실패를 확인한다.

**Organization**: 작업은 독립 검증 가능한 user story 단위로 묶고, 기존 one-shot scanner는 최종 parity oracle로 유지한다.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 아직 완료되지 않은 다른 작업과 파일이 겹치지 않아 병렬 실행 가능
- **[Story]**: `spec.md`의 user story 매핑
- 모든 작업은 정확한 대상 파일을 포함한다.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: 기존 dirty worktree와 생성 fixture를 보존하면서 구현 경계를 고정한다.

- [X] T001 기존 build 산출물과 생성 benchmark fixture가 추적되지 않도록 `.gitignore`의 Node/Rust/temp 패턴을 검증하고 누락된 필수 패턴만 추가한다
- [X] T002 기존 one-shot scanner를 parity oracle로 유지할 수 있도록 `src-tauri/src/commands/folders.rs`의 순수 scan 진입점과 테스트 fixture helper 경계를 정리한다

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 모든 story가 공유하는 typed protocol, keyed accumulator, native job 수명 경계를 먼저 만든다.

**⚠️ CRITICAL**: 이 단계가 끝나기 전에는 화면 통합을 시작하지 않는다.

- [X] T003 [P] Rust progressive message의 camelCase/tag/terminal 직렬화 계약 테스트를 `src-tauri/src/domain/models.rs`에 먼저 추가하고 실패를 확인한다
- [X] T004 [P] TypeScript progressive DTO와 bridge command/channel 계약 테스트를 `src/core/folderScanCommandContract.test.ts`와 `src/core/bridge.test.ts`에 먼저 추가하고 실패를 확인한다
- [X] T005 [P] exact-path upsert, revision, 중복/late/gap, final count 불변식 테스트를 `src/core/folderScanState.test.ts`에 먼저 추가하고 실패를 확인한다
- [X] T006 Rust progressive scan DTO를 `src-tauri/src/domain/models.rs`에, 동일한 TypeScript DTO를 `src/core/models.ts`에 구현한다
- [X] T007 keyed accumulator와 immutable publish snapshot을 `src/core/folderScanState.ts`에 구현해 T005를 통과시킨다
- [X] T008 bounded ACK window, cancellation wake, exactly-once terminal을 검증하는 native 단위 테스트와 job registry/coordinator를 `src-tauri/src/folder_scan.rs`에 구현한다
- [X] T009 `start_folder_scan`, `ack_folder_scan`, generation-aware `cancel_folder_scan` bridge와 Tauri command 등록을 `src/core/bridge.ts`, `src-tauri/src/commands/folders.rs`, `src-tauri/src/lib.rs`에 구현해 T003~T004를 통과시킨다

**Checkpoint**: typed stream을 가짜 메시지와 native 단위 테스트로 독립 검증할 수 있다.

---

## Phase 3: User Story 1 - 도착한 결과부터 검토하기 (Priority: P1) 🎯 MVP

**Goal**: 전체 scan 완료 전 pending/final 행이 폴더 우선 계층에 나타나고, 확정된 일반 파일은 기존 안전 reader로 열 수 있다.

**Independent Test**: 지연 inventory fixture에서 terminal 전 첫 batch가 도착하고 pending 행이 같은 exact path의 final 행으로 제자리 갱신되며 확정 파일만 열리는지 확인한다.

### Tests for User Story 1 ⚠️

- [X] T010 [P] [US1] 지연된 좌우 inventory, awaitingPeer→awaitingHash→final, one-sided terminal 판정 테스트를 `src-tauri/src/folder_scan.rs`에 먼저 추가하고 실패를 확인한다
- [X] T011 [P] [US1] pending 행, 폴더 문맥, 확정 행 open guard와 점진 append UI 테스트를 `src/core/folderView.test.ts`와 `src/components/FolderCompareView.test.tsx`에 먼저 추가하고 실패를 확인한다

### Implementation for User Story 1

- [X] T012 [US1] 두 bounded inventory producer, exact-path coordinator, 256행/256KiB/50ms batch와 기존 hash/classification 재사용을 `src-tauri/src/folder_scan.rs`와 `src-tauri/src/commands/folders.rs`에 구현한다
- [X] T013 [US1] progressive row를 pending-aware folder-first hierarchy로 변환하고 final regular file만 open/sync 대상으로 허용하도록 `src/core/folderView.ts`를 구현한다
- [X] T014 [US1] scan 시작 즉시 folder 화면으로 전환하고 Channel batch를 animation-frame 단위 snapshot으로 누적하도록 `src/App.tsx`를 통합한다
- [X] T015 [US1] pending/final 표시, folder collapse, exact relative-path selection, 진행 중 open guard를 `src/components/FolderCompareView.tsx`와 `src/styles.css`에 구현한다

**Checkpoint**: 10k metadata scan에서 terminal 전에 결과를 보고 확정 text row를 검토할 수 있다.

---

## Phase 4: User Story 2 - 진행 상태와 최종 결과 신뢰하기 (Priority: P2)

**Goal**: 발견/판정/pending/error/hash 단계를 접근 가능하게 보여주고 완료 결과가 one-shot scanner와 완전히 일치한다.

**Independent Test**: metadata/quick/full fixture를 progressive와 one-shot으로 비교해 경로·상태·오류·통계가 같고 완료 시 pending이 0인지 확인한다.

### Tests for User Story 2 ⚠️

- [X] T016 [P] [US2] progress coalescing, terminal stats, path-local 오류와 metadata/quick/full parity 테스트를 `src-tauri/src/folder_scan.rs`에 먼저 추가하고 실패를 확인한다
- [X] T017 [P] [US2] pending이 final count에 포함되지 않고 unknown total에 백분율이 표시되지 않는 reducer/component 테스트를 `src/core/folderScanState.test.ts`와 `src/components/FolderCompareView.test.tsx`에 먼저 추가하고 실패를 확인한다

### Implementation for User Story 2

- [X] T018 [US2] inventory/classify/hash progress coalescing과 completed/cancelled/failed summary를 `src-tauri/src/folder_scan.rs`에 구현한다
- [X] T019 [US2] incremental final/pending/error count와 terminal 검증을 `src/core/folderScanState.ts`에 구현한다
- [X] T020 [US2] 접근 가능한 단계·발견·판정·확인 중·오류 수와 완료/부분 결과 배너를 `src/components/FolderCompareView.tsx`와 `src/core/i18n.ts`에 구현한다

**Checkpoint**: 점진 UI의 최종 결과와 기존 scanner의 결과가 모든 compare mode에서 동일하다.

---

## Phase 5: User Story 3 - 취소하고 새 비교로 안전하게 전환하기 (Priority: P2)

**Goal**: 취소, roots/options 변경, Back/unmount 뒤 stale batch가 현재 화면에 섞이지 않고 모든 wait가 빠르게 깨어난다.

**Independent Test**: 느린 producer와 ACK-stalled consumer에서 취소/새 generation/unmount를 반복해 1초 이내 종료, stale 반영 0건, terminal exactly once를 확인한다.

### Tests for User Story 3 ⚠️

- [X] T021 [P] [US3] ACK window 4 batch/1MiB, 잘못된 owner/generation ACK, inventory/hash/ACK wait 취소 테스트를 `src-tauri/src/folder_scan.rs`에 먼저 추가하고 실패를 확인한다
- [X] T022 [P] [US3] stale job/generation/options, cancel 후 late batch, component unmount/rapid rescan 회귀 테스트를 `src/core/folderScanState.test.ts`, `src/core/bridge.test.ts`, `src/components/FolderCompareView.test.tsx`에 먼저 추가하고 실패를 확인한다

### Implementation for User Story 3

- [X] T023 [US3] cumulative ACK credit와 owner/generation 검증, registry cleanup, cooperative cancellation wake를 `src-tauri/src/folder_scan.rs`와 `src-tauri/src/commands/folders.rs`에 완성한다
- [X] T024 [US3] generation 즉시 무효화, late message 거절, cancel/rescan/Back/unmount lifecycle을 `src/App.tsx`, `src/core/bridge.ts`, `src/core/folderScanState.ts`에 완성한다

**Checkpoint**: 취소·새 scan·화면 종료 race에서 현재 결과 오염이 없다.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: 대용량 증적, 문서, 전체 회귀 검증을 닫는다.

- [X] T025 10k/100k 임시 fixture의 first-batch/terminal/parity/queue high-water/cancel 측정 harness를 `src-tauri/src/folder_scan.rs`의 ignored benchmark test로 추가하고 기준 host 결과를 `specs/003-progressive-folder-scan/quickstart.md`에 기록한다
- [X] T026 [P] 최종 stream/flow-control/selection 계약과 테스트 matrix를 `docs/02_ARCHITECTURE.md`, `docs/07_TEST_PLAN.md`, `docs/14_PRODUCT_GAP_ROADMAP.md`에 반영한다
- [X] T027 `npm run typecheck`, `npm test`, `npm run build`, `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test`를 실행하고 실패를 코드에서 해결한다
- [X] T028 macOS/Windows/Linux packaged manual 항목과 100k memory/UI long-task 항목을 `specs/003-progressive-folder-scan/quickstart.md`에 실행 여부대로 기록하고 미실행 검증을 pass로 표시하지 않는다

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: 즉시 시작 가능
- **Foundational (Phase 2)**: Setup 완료 후 진행하며 모든 user story를 차단한다
- **US1 (Phase 3)**: Foundational 완료 후 진행하는 MVP
- **US2 (Phase 4)**: US1의 native row lifecycle과 frontend accumulator를 사용한다
- **US3 (Phase 5)**: Foundational protocol 위에서 독립 테스트 가능하지만 최종 App lifecycle 통합은 US1 이후 진행한다
- **Polish (Phase 6)**: 선택한 모든 story 완료 후 진행한다

### User Story Dependencies

- **US1 (P1)**: Foundation 이후 바로 시작, 사용자 체감 속도의 최소 가치
- **US2 (P2)**: US1의 row stream에 progress/terminal 신뢰 계약을 추가
- **US3 (P2)**: Foundation의 identity/ACK/cancel을 사용하며 UI lifecycle 통합은 US1과 연결

### Within Each User Story

- 테스트를 먼저 작성하고 해당 테스트가 기대한 이유로 실패하는지 확인한다.
- DTO/순수 reducer를 native/WebView 통합보다 먼저 구현한다.
- native stream을 App/컴포넌트에 연결하기 전에 단위 parity와 boundedness를 확인한다.
- story checkpoint를 통과한 뒤 다음 priority로 이동한다.

### Parallel Opportunities

- T003, T004, T005는 서로 다른 파일의 계약 테스트라 병렬 가능하다.
- T010과 T011, T016과 T017, T021과 T022는 native/frontend 파일이 분리되어 병렬 가능하다.
- T026은 구현 완료 뒤 benchmark T025와 파일이 겹치지 않아 병렬 가능하다.

---

## Parallel Example: User Story 1

```text
Task T010: native delayed inventory lifecycle tests in src-tauri/src/folder_scan.rs
Task T011: pending hierarchy/component tests in src/core/folderView.test.ts and src/components/FolderCompareView.test.tsx
```

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 Setup을 완료한다.
2. Phase 2 typed protocol/accumulator/job foundation을 완료한다.
3. Phase 3 US1을 구현한다.
4. terminal 전 첫 row와 확정 row open을 독립 검증한다.

### Incremental Delivery

1. Setup + Foundation → bounded typed stream 기반
2. US1 → blank-screen 대기 제거
3. US2 → 진행/최종 신뢰와 parity
4. US3 → cancel/stale race 안전성
5. Polish → 10k/100k 증적과 전체 gate

## Notes

- `FOL-008` persistent hash pool과 `FOL-009` cache redesign은 이 목록에 포함하지 않는다.
- 사용자 파일과 경로는 로그/telemetry/benchmark 결과에 기록하지 않는다.
- 기존 dirty worktree 변경을 보존하고 관련 파일의 현재 동작에 좁게 통합한다.
- 완료한 작업만 `[X]`로 표시한다.
