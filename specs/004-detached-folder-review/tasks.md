# Tasks: Detached Folder Review

**Input**: Design documents from `/specs/004-detached-folder-review/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/detached-folder-review.md`, `quickstart.md`

**Issue**: `FOL-020`

**Tests**: 창·권한·파일 읽기 계약 변경이므로 각 user story의 테스트를 구현보다 먼저 추가하고 기대한 이유로 실패하는지 확인한다.

**Organization**: 작업은 독립 검증 가능한 user story 단위로 묶되 application-command ACL과 descriptor-only registry는 모든 story를 차단하는 foundation으로 둔다.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 아직 완료되지 않은 다른 작업과 파일이 겹치지 않아 병렬 실행 가능
- **[Story]**: `spec.md` user story 매핑
- 모든 작업은 정확한 대상 파일을 포함한다.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: 기존 dirty worktree와 현재 main-window 동작을 보존하면서 FOL-020 구현 기준을 고정한다.

- [X] T001 `.gitignore`, `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`에서 Node/Rust/Tauri 생성물과 현재 의존성을 검증하고 누락된 필수 ignore만 `.gitignore`에 추가한다
- [X] T002 현재 invoke command, frontend bridge invoke, capability 범위를 `src-tauri/src/lib.rs`, `src/core/bridge.ts`, `src-tauri/capabilities/default.json`, `src-tauri/build.rs`에서 inventory해 기존 main command baseline을 고정한다

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 모든 detached story가 공유하는 app-command ACL, typed DTO, descriptor-only registry, safe pair service를 먼저 만든다.

**⚠️ CRITICAL**: 이 단계가 끝나기 전에는 child WebView를 사용자 동작에 연결하지 않는다.

- [X] T003 [P] 전체 `generate_handler!`/AppManifest/main capability parity와 detached 최소 권한을 검증하는 실패 테스트를 `src/core/appCommandAcl.test.ts`와 `src/core/securityConfig.test.ts`에 추가한다
- [X] T004 [P] detached request/result/context camelCase 직렬화와 registry에 content field가 없음을 검증하는 실패 테스트를 `src-tauri/src/domain/models.rs`와 `src/core/detachedFolderReview.test.ts`에 추가한다
- [X] T005 [P] exact identity reservation, concurrent dedupe, checked label allocation, build rollback, 8-window/256MiB 한도를 검증하는 실패 테스트를 `src-tauri/src/detached_review.rs`에 추가한다
- [X] T006 모든 application command를 `src-tauri/build.rs`의 `AppManifest::commands`에 등록하고 reviewed main/detached permission·capability를 `src-tauri/permissions/main-commands.toml`, `src-tauri/permissions/detached-folder-review.toml`, `src-tauri/capabilities/default.json`, `src-tauri/capabilities/detached-folder-review.json`에 구현한다
- [X] T007 detached DTO와 안정된 오류 계약을 `src-tauri/src/domain/models.rs`, `src/core/models.ts`, `src-tauri/src/error.rs`에 구현해 T004를 통과시킨다
- [X] T008 descriptor-only identity/session/registry, cancellation, count/byte accounting 순수 코어를 `src-tauri/src/detached_review.rs`에 구현해 T005를 통과시킨다
- [X] T009 기존 all-or-nothing folder pair reader를 detached가 재사용할 수 있는 internal service로 `src-tauri/src/commands/files.rs`에서 추출하고 기존 fixture 테스트를 유지한다

**Checkpoint**: child window 생성 전에도 ACL fail-closed, registry boundedness, pair-read 안전 계약을 독립 검증할 수 있다.

---

## Phase 3: User Story 1 - 더블클릭으로 독립 비교 창 열기 (Priority: P1) 🎯 MVP

**Goal**: 단일 클릭은 선택만 하고 final regular-file 더블클릭/Enter는 목록을 유지한 채 실제 read-only WebviewWindow를 연다.

**Independent Test**: 한 번 클릭 시 open/read 0건, 파일 더블클릭/Enter 시 child shell 하나, 폴더 동작 시 collapse만 발생하며 one-sided missing pair가 안전하게 표시되는지 확인한다.

### Tests for User Story 1 ⚠️

- [X] T010 [P] [US1] single-click/double-click/Enter/directory/pending action 계약 테스트를 `src/components/FolderCompareView.test.tsx`와 `src/core/folderView.test.ts`에 먼저 추가한다
- [X] T011 [P] [US1] async window create, main caller 검증, path-free label/route, initial load all-or-nothing 테스트를 `src-tauri/src/detached_review.rs`와 `src-tauri/src/commands/detached_review.rs`에 먼저 추가한다
- [X] T012 [P] [US1] child route가 full `App`와 startup/recent/settings/save controller를 mount하지 않는 테스트를 `src/main.test.tsx`, `src/DetachedFolderReviewApp.test.tsx`, `src/core/bridge.test.ts`에 먼저 추가한다

### Implementation for User Story 1

- [X] T013 [US1] main-only async open과 caller-bound initial load command를 `src-tauri/src/commands/detached_review.rs`, `src-tauri/src/detached_review.rs`, `src-tauri/src/commands/mod.rs`, `src-tauri/src/lib.rs`에 구현한다
- [X] T014 [US1] detached command DTO bridge와 exact final-row open request 변환을 `src/core/bridge.ts`, `src/core/models.ts`, `src/core/detachedFolderReview.ts`에 구현한다
- [X] T015 [US1] fixed `surface=folder-review` 진입 분기와 loading/error/retry/ready child root를 `src/main.tsx`, `src/DetachedFolderReviewApp.tsx`, `src/styles.css`에 구현한다
- [X] T016 [US1] `folderReview` origin을 strict read-only로 만들고 settings persistence·path-derived Monaco URI를 차단하도록 `src/components/FileCompareView.tsx`, `src/components/FileCompareView.test.tsx`, `src/core/difftoolSession.ts`를 확장한다
- [X] T017 [US1] folder action을 inline mode 전환 대신 detached open으로 연결하고 source list/scan 상태를 유지하도록 `src/App.tsx`, `src/components/FolderCompareView.tsx`를 통합한다

**Checkpoint**: 일반 파일 한 쌍을 별도 read-only shell에서 열 수 있고 원래 폴더 화면은 그대로 유지된다.

---

## Phase 4: User Story 2 - 파일의 경로 문맥을 잃지 않기 (Priority: P1)

**Goal**: child 제목과 header만으로 basename, 상대 부모, 전체 상대 경로, 좌우 root, missing side를 구분한다.

**Independent Test**: 같은 basename의 서로 다른 nested path와 one-sided missing을 열어 URL/label/title/model identity에 민감 정보 없이 각 문맥이 구별되는지 확인한다.

### Tests for User Story 2 ⚠️

- [X] T018 [P] [US2] title sanitization/truncation, same-basename parent context, missing-side header, opaque model identity 테스트를 `src/core/detachedFolderReview.test.ts`와 `src/DetachedFolderReviewApp.test.tsx`에 먼저 추가한다
- [X] T019 [P] [US2] URL/label/title/model URI/storage/log에 root/token/content가 없는 privacy sentinel을 `src/core/privacyLoggingPolicy.test.ts`, `src/core/securityConfig.test.ts`, `src/components/FileCompareView.test.tsx`에 먼저 추가한다

### Implementation for User Story 2

- [X] T020 [US2] path-free window label/route와 sanitized relative title/context DTO 생성을 `src-tauri/src/detached_review.rs`, `src-tauri/src/commands/detached_review.rs`에 구현한다
- [X] T021 [US2] context-first child header와 missing-side 표시, opaque model identity를 `src/DetachedFolderReviewApp.tsx`, `src/core/detachedFolderReview.ts`, `src/components/FileCompareView.tsx`, `src/styles.css`에 구현한다

**Checkpoint**: 같은 이름의 여러 파일 창이 경로 문맥으로 명확히 구분되고 민감 경로가 capability 밖 surface에 노출되지 않는다.

---

## Phase 5: User Story 3 - 여러 파일을 독립적으로 검토하기 (Priority: P2)

**Goal**: 서로 다른 파일은 독립 창에 열리고 같은 exact identity는 기존 창을 restore/focus하며 제한 초과는 기존 창을 건드리지 않는다.

**Independent Test**: concurrent same-identity open 100회가 한 창으로 수렴하고, 서로 다른 8개 창은 독립 상태를 유지하며 9번째와 256MiB 초과만 행동 가능한 오류가 되는지 확인한다.

### Tests for User Story 3 ⚠️

- [X] T022 [P] [US3] concurrent dedupe/focus/restore, stale handle retry, duplicate-at-limit, count/byte release race 테스트를 `src-tauri/src/detached_review.rs`에 먼저 추가한다
- [X] T023 [P] [US3] child별 compare/navigation/error state가 공유되지 않고 local persistence가 0건인 component 테스트를 `src/DetachedFolderReviewApp.test.tsx`, `src/components/FileCompareView.test.tsx`에 먼저 추가한다

### Implementation for User Story 3

- [X] T024 [US3] existing window restore/show/focus와 reservation waiter/build rollback adapter를 `src-tauri/src/detached_review.rs`, `src-tauri/src/commands/detached_review.rs`에 구현한다
- [X] T025 [US3] 8-window/256MiB source budget을 validated metadata와 successful delivery에 연결하고 실패 시 기존 session을 보존하도록 `src-tauri/src/detached_review.rs`, `src-tauri/src/commands/detached_review.rs`에 구현한다
- [X] T026 [US3] child마다 독립 compare model/navigation/error 상태를 갖고 persistence를 비활성화하도록 `src/DetachedFolderReviewApp.tsx`, `src/components/FileCompareView.tsx`를 완성한다

**Checkpoint**: 여러 창이 독립적으로 동작하고 duplicate/limit/memory 규칙이 결정론적이다.

---

## Phase 6: User Story 4 - 창 수명과 파일 오류를 예측하기 (Priority: P2)

**Goal**: rescan/open/close/app-exit race와 외부 변경이 stale/partial snapshot이나 registry 누수 없이 처리된다.

**Independent Test**: loading 중 source invalidation과 close를 반복하고 ready 창은 main navigation 뒤 유지하며, version check/reload가 양쪽 snapshot을 함께 교체하거나 기존 것을 유지하는지 확인한다.

### Tests for User Story 4 ⚠️

- [X] T027 [P] [US4] source invalidation, close/destroy, late completion, main destroy/app exit cleanup, all-or-nothing reload 테스트를 `src-tauri/src/detached_review.rs`, `src-tauri/src/commands/detached_review.rs`에 먼저 추가한다
- [X] T028 [P] [US4] focused target 한 곳에만 native menu event가 전달되고 detached mutation command가 비활성인 테스트를 `src-tauri/src/menu.rs`, `src/core/nativeMenu.test.ts`, `src/core/commands.test.ts`에 먼저 추가한다
- [X] T029 [P] [US4] external-change notice, keep/reload/retry, old snapshot preservation component 테스트를 `src/DetachedFolderReviewApp.test.tsx`에 먼저 추가한다

### Implementation for User Story 4

- [X] T030 [US4] caller-bound version check/reload와 source generation invalidation을 `src-tauri/src/commands/detached_review.rs`, `src-tauri/src/detached_review.rs`, `src/core/bridge.ts`에 구현한다
- [X] T031 [US4] `WindowEvent::Destroyed` cleanup, main destroy/app-exit child close, cancellation wake를 `src-tauri/src/lib.rs`, `src-tauri/src/detached_review.rs`에 구현한다
- [X] T032 [US4] focused WebView 전용 menu emission과 main/detached command profile을 `src-tauri/src/menu.rs`, `src/core/nativeMenu.ts`, `src/core/commands.ts`에 구현한다
- [X] T033 [US4] child external-change 확인과 explicit reload/keep/error UX를 `src/DetachedFolderReviewApp.tsx`, `src/core/i18n.ts`, `src/styles.css`에 구현한다

**Checkpoint**: 모든 open/rescan/close/reload race가 명시적 terminal 상태로 끝나고 다른 창이나 main 상태를 바꾸지 않는다.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: 전체 권한 감사, 문서, 자동/packaged 검증 증거를 닫는다.

- [X] T034 app-command manifest/main/detached permission의 exact parity와 runtime privacy 정책을 `src/core/appCommandAcl.test.ts`, `src/core/securityConfig.test.ts`, `src/core/privacyLoggingPolicy.test.ts`에서 최종 감사한다
- [X] T035 [P] multiwindow ACL/lifecycle/test matrix를 `docs/02_ARCHITECTURE.md`, `docs/07_TEST_PLAN.md`, `docs/09_RELEASE_SECURITY.md`, `docs/14_PRODUCT_GAP_ROADMAP.md`에 반영한다
- [X] T036 `npm run typecheck`, `npm test`, `npm run build`, `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test`를 실행하고 실패를 코드에서 해결한다
- [X] T037 macOS/Windows/Linux packaged create/focus/minimize/resize/close/app-exit와 300ms/1s 성능 항목을 `specs/004-detached-folder-review/quickstart.md`에 실행 여부대로 기록하고 미실행 항목을 pass로 표시하지 않는다
- [X] T038 [US1] 단일 클릭 선택, 더블클릭/`Enter` 활성화, `Space` 세부 정보 규칙을 영어·한국어 상시 안내로 표시하고 table 설명과 연결하며 `src/components/FolderCompareView.test.tsx`, `src/components/FolderCompareView.tsx`, `src/core/i18n.ts`, `src/styles.css`에서 검증한다

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: 즉시 시작 가능
- **Foundational (Phase 2)**: Setup 완료 후 진행하며 모든 user story를 차단한다
- **US1 (Phase 3)**: Foundation 위에서 실제 child shell과 안전한 초기 load를 제공한다
- **US2 (Phase 4)**: US1 child shell의 context/title/model identity를 완성한다
- **US3 (Phase 5)**: Foundation registry와 US1 window adapter를 이용해 multiwindow 한도를 완성한다
- **US4 (Phase 6)**: US1~US3의 실제 window/session lifecycle 위에서 close/reload/menu race를 닫는다
- **Polish (Phase 7)**: 모든 선택 story 완료 뒤 진행한다

### User Story Dependencies

- **US1 (P1)**: Foundational 이후 시작하는 최소 기능
- **US2 (P1)**: US1의 child shell에 표시 문맥과 privacy 계약을 추가한다
- **US3 (P2)**: US1 open adapter와 foundational registry가 필요하다
- **US4 (P2)**: US1 initial load와 US3 session accounting이 필요하다

### Within Each User Story

- 테스트를 먼저 작성하고 해당 테스트가 기대한 이유로 실패하는지 확인한다.
- DTO/registry/순수 policy를 OS window와 WebView 통합보다 먼저 구현한다.
- registry lock을 OS window call과 파일 I/O 동안 유지하지 않는다.
- story checkpoint를 통과한 뒤 다음 phase로 이동한다.

### Parallel Opportunities

- T003, T004, T005는 서로 다른 ACL/DTO/registry 테스트 파일이라 병렬 가능하다.
- T010~T012, T018~T019, T022~T023, T027~T029는 native/frontend 파일 경계에서 병렬 가능하다.
- T035 문서 작업은 기능 구현 완료 뒤 T034 권한 감사와 파일이 겹치지 않는다.

## Parallel Example: User Story 1

```text
Task T010: folder single/double-click action tests in src/components/FolderCompareView.test.tsx
Task T011: native async open/load tests in src-tauri/src/detached_review.rs
Task T012: child surface isolation tests in src/DetachedFolderReviewApp.test.tsx
```

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 Setup을 완료한다.
2. Phase 2 ACL/registry/pair-service foundation을 완료한다.
3. Phase 3 US1을 구현한다.
4. 실제 detached shell과 all-or-nothing read-only pair load를 독립 검증한다.

### Incremental Delivery

1. Setup + Foundation → fail-closed multiwindow 보안 기반
2. US1 → 단일 파일 detached review
3. US2 → 경로 문맥과 privacy 완성
4. US3 → dedupe, 독립 상태, count/byte 한도
5. US4 → external change, menu, destroy/exit race
6. Polish → 세 OS packaged 증거와 전체 gate

## Notes

- detached child에 `core:default`, dialog, generic read/write/stat/reveal/Git/scan command를 허용하지 않는다.
- root/path/token/content는 URL, label, title, Monaco URI, storage, 기본 로그에 넣지 않는다.
- registry는 descriptor/version/budget만 보관하고 `FileDocument.text`를 보관하지 않는다.
- 기존 dirty worktree 변경을 보존하고 FOL-020 관련 파일에 좁게 통합한다.
- 완료한 작업만 `[X]`로 표시한다.

## Phase 8: Convergence

**Purpose**: 구현 감사에서 확인된 constitution 위반, 부분 구현, 실제 packaged 증적 공백을 닫아 source 완료와 release 완료를 분리한다.

- [X] T039 CRITICAL `FOL-020`을 `docs/04_BACKLOG.md`의 확정 issue-sized backlog에 수용 기준·의존성과 함께 승격하고 후보 로드맵/feature spec의 상태를 같은 결정으로 정렬한다 per Constitution V (missing)
- [X] T040 `src/core/diffOptions.test.ts`, `src/components/FileCompareView.test.tsx`, `src/core/diffOptions.ts`, `src/components/FileCompareView.tsx`에서 ignore whitespace/case/EOL이 diff 판정만 바꾸고 detached를 포함한 Monaco 원문 model/text는 변형하지 않도록 CRITICAL 회귀 테스트와 구현을 추가한다 per Constitution I, FR-014 (contradicts)
- [X] T041 `src/core/nativeMenu.ts`, `src/App.tsx`, `src-tauri/src/lib.rs`, `src-tauri/src/menu.rs`에서 main native Close/Quit 요청을 dirty 확인 뒤 일회성 승인으로만 종료하고 확정 종료 시 detached registry/window를 정리하는 테스트와 구현을 추가한다 per FR-019, plan: lifecycle decision (partial)
- [X] T042 `src-tauri/src/commands/detached_review.rs`에서 production/dev navigation을 정확한 고정 `surface=folder-review` path/query만 허용하고 marker 없는 same-origin main route와 extra path/query/hash를 거절하는 테스트와 구현을 추가한다 per SR-002, SR-004, plan: fixed-route decision (contradicts)
- [X] T043 `src-tauri/src/text.rs`, `src-tauri/src/commands/files.rs`에서 BOM 없는 payload의 전체 범위 NUL을 binary로 판별하고 첫 16KiB 뒤 NUL fixture도 all-or-nothing으로 거절하는 테스트와 구현을 추가한다 per FR-015, SR-003 (partial)
- [X] T044 `src/components/FolderCompareView.test.tsx`, `src-tauri/src/detached_review.rs`, `src-tauri/src/commands/detached_review.rs`에서 단일 클릭 100회 open/read 0건과 rescan/close/app-exit race 각 100회 orphan/stale 0건을 반복 검증한다 per SC-001, SC-006 (partial)
- [ ] T045 `scripts/prepare-runtime-smoke.mjs`, `specs/004-detached-folder-review/quickstart.md`에 detached shell 300ms 및 1MiB pair 1초 측정 절차와 reference-host 결과를 기록한다 per SC-002 (missing)
- [ ] T046 macOS, Windows, Linux packaged build에서 double-click/Enter, move/resize/minimize/restore/focus/close/app-exit lifecycle을 실행하고 OS별 증적을 `specs/004-detached-folder-review/quickstart.md`에 기록한다 per SC-007 (missing)
