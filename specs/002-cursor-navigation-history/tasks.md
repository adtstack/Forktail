# Tasks: Cursor Navigation History

**Input**: Design documents from `specs/002-cursor-navigation-history/`

**Issue**: `UX-009`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [editor-navigation-contract.md](./contracts/editor-navigation-contract.md)

**Tests**: 모든 behavior task는 대응하는 실패 테스트를 먼저 추가하고, 가장 작은 구현으로 통과시킨다.

**Hardware ownership**: Windows/macOS/Linux packaged hardware mouse·shortcut·native menu 검증은 사용자가
수행한다. 에이전트는 절차와 evidence 입력란만 준비하고 직접 실행하거나 통과로 표시하지 않는다.

**Organization**: Phase 3은 mounted editor MVP, Phase 4는 live folder/Git review 확장, Phase 5는
실제 keyboard/mouse/native menu 입력을 제공한다. `US2`와 `US3`는 core test를 병렬로 진행할 수 있지만
둘 다 `US1`의 mounted handle/controller를 재사용한다.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 선행 task가 끝난 뒤 다른 파일에서 병렬 실행 가능
- **[US1]~[US3]**: `spec.md`의 user story 매핑
- 모든 task는 명시된 path와 verification command를 사용한다.

---

## Phase 1: Setup and Evidence Baseline

**Purpose**: 구현·자동 검증·사용자 hardware handoff 결과를 섞지 않는 evidence 파일을 먼저 만든다.

- [X] T001 Create `specs/002-cursor-navigation-history/VALIDATION.md` with UX-009 scope, automated frontend/Rust command slots, external T081/T082/T084 prerequisite status, and a Windows/macOS/Linux hardware matrix initialized to `user-owned / manual-not-run`; verify headings and ownership with `rg -n "UX-009|user-owned|manual-not-run|T081|T082|T084" specs/002-cursor-navigation-history/VALIDATION.md`

**Checkpoint**: 실행하지 않은 hardware test를 pass로 오인하지 않는 baseline이 준비됐다.

---

## Phase 2: Foundational History and Monaco Adapter

**Purpose**: 모든 story가 공유하는 content-free bounded history와 explicit Monaco view adapter를 먼저
구현한다.

**⚠️ CRITICAL**: 이 phase가 끝나기 전에는 component/App integration을 시작하지 않는다.

- [X] T002 [P] Add failing UX-009 tests for A→B→C LIFO order, 101 visited locations followed by 100 exact Back restores, separate current plus 100 past entries, 101st oldest-only eviction, exported 1-line/1-column/1-viewport-line/2px coalescing boundaries, pane/target separation, replay suppression, 50 mixed stale/deleted/non-text entries with at most one valid consume and zero wrong opens/edits, reservation duplicate prevention, blocked/cancelled/failed non-consumption, and content/storage/log/write privacy sentinels in `src/core/editorNavigationHistory.test.ts` and `src/core/privacyLoggingPolicy.test.ts`; verify the intended failures with `npm test -- src/core/editorNavigationHistory.test.ts src/core/privacyLoggingPolicy.test.ts`
- [X] T003 [P] Add failing fake-Monaco tests for pane/caret/top-line+pixel-offset/scroll-left capture, line/column/viewport clamp, `setPosition`→`setScrollPosition`→`focus` order, stale/unavailable model failure, forbidden text/edit/undo API calls, replay suppression, and observer disposal in `src/core/monacoNavigation.test.ts`; verify the intended failures with `npm test -- src/core/monacoNavigation.test.ts`
- [X] T004 Implement process-only scope/document/location types, current/past/reservation state, capacity-100 coalescing, pure availability/candidate validation, and two-phase peek/reserve/commit/release/stale-discard behavior in `src/core/editorNavigationHistory.ts` without serialization or content fields; verify with `npm test -- src/core/editorNavigationHistory.test.ts src/core/privacyLoggingPolicy.test.ts`
- [X] T005 Implement the content-free `EditorNavigationHandle`, explicit cursor/top-line/offset/scroll capture, clamped restore, model identity check, focus, replay-safe observer binding, and disposable cleanup in `src/core/monacoNavigation.ts`; verify with `npm test -- src/core/monacoNavigation.test.ts` and `npm run typecheck`

**Checkpoint**: DOM, App, file I/O 없이 history와 mounted view restore를 독립 검증할 수 있다.

---

## Phase 3: User Story 1 — 이전 편집 위치로 돌아가기 (Priority: P1) 🎯 MVP Core

**Goal**: 2-way left/right와 editable merge Result에서 의미 있는 이동 전 위치를 기록하고
pane/cursor/viewport/focus를 역순으로 복원한다.

**Independent Test**: compare left A → right B → F7 C에서 `programmaticTest` Back 두 번이 B → A를
복원하고, dirty merge Result의 F8 이동 후 Back이 text, dirty, undo/redo history를 바꾸지 않는다.

### Tests for User Story 1 ⚠️

- [X] T006 [P] [US1] Add failing lifecycle tests using a captured Monaco `onMount` or exported binding seam for original/modified handle registration, pane focus, Find/Go-to-Line/page/distant-click explicit jump and editor-leave observation, F7/Shift+F7 origin commit ordering, replay suppression, model-change invalidation, restored-cursor hunk decoration derivation, and full subscription cleanup in `src/components/FileCompareView.test.tsx`; verify the intended failures with `npm test -- src/components/FileCompareView.test.tsx`
- [X] T007 [P] [US1] Add failing lifecycle tests for editable Result handle registration, Find/Go-to-Line/page/distant-click explicit jump and editor-leave observation, F8/Shift+F8/conflict-selection origin commit ordering, dirty Result text/dirty/undo-redo invariance, replay suppression, restored-cursor conflict decoration derivation, BASE/OURS/THEIRS and read-only Git preview exclusion, and cleanup in `src/components/MergeView.test.tsx`; verify the intended failures with `npm test -- src/components/MergeView.test.tsx`
- [X] T008 [P] [US1] Add failing mounted-resolver and App-coordinator policy tests for exact direct compare/merge session token and matching scope/document model revision, dirty same-document restore, missing/stale handle failure without consumption, model replacement versus ordinary text edit revision behavior, modal/empty/status outcomes, mounted restore within 100ms using a fake clock, and at most one successful location per invocation in `src/core/editorNavigationHistory.test.ts` and `src/core/editorNavigationCoordinator.test.ts`; verify the intended failures with `npm test -- src/core/editorNavigationHistory.test.ts src/core/editorNavigationCoordinator.test.ts`

### Implementation for User Story 1

- [X] T009 [P] [US1] Register original/modified Monaco handles, observe semantic cursor/focus/scroll state, commit immediately before diff navigation and pane/context jumps, invalidate changed models, derive only a current-range active hunk after restore, and dispose all new subscriptions in `src/components/FileCompareView.tsx`; verify with `npm test -- src/components/FileCompareView.test.tsx src/core/monacoNavigation.test.ts`
- [X] T010 [P] [US1] Register only editable merge Result, commit before explicit conflict navigation, keep Result text/history/dirty unchanged during restore, derive only a current-range active conflict, exclude read-only preview/source panes, and dispose all new subscriptions in `src/components/MergeView.tsx`; verify with `npm test -- src/components/MergeView.test.tsx src/core/monacoNavigation.test.ts`
- [X] T011 [US1] Implement a pure `src/core/editorNavigationCoordinator.ts` seam proven by T008, own one process-memory history and mounted-handle registry, issue direct compare/merge session tokens, add compare/merge model revisions that change only on model replacement, connect both component adapters, execute mounted Back without the existing screen-leave `onBack`, and expose content-free neutral `role="status" aria-live="polite"` results in `src/App.tsx` and `src/core/i18n.ts`; verify with `npm test -- src/core/editorNavigationHistory.test.ts src/core/editorNavigationCoordinator.test.ts src/components/FileCompareView.test.tsx src/components/MergeView.test.tsx`, `npm run typecheck`, and `npm run build`
- [X] T012 [US1] Run the complete US1 focused gate and record only actual results and timing evidence in `specs/002-cursor-navigation-history/VALIDATION.md`: `npm test -- src/core/editorNavigationHistory.test.ts src/core/monacoNavigation.test.ts src/components/FileCompareView.test.tsx src/components/MergeView.test.tsx`, `npm run typecheck`, and `npm run build`; leave every hardware row `user-owned / manual-not-run`

**Checkpoint**: mounted editor history is independently testable. It is a development MVP, but a user-facing
release still needs US3 input bindings.

---

## Phase 4: User Story 2 — 현재 검토 흐름의 이전 위치 복원 (Priority: P2)

**Goal**: 같은 live folder/Git review의 clean cross-item Back만 exact identity로 다시 열고, stale,
non-text, dirty, cancel, newer request에서는 current item과 history를 안전하게 보존한다.

**Independent Test**: folder/Git A→B 뒤 clean B에서 Back하면 exact generation/opaque identity의 A가
복원되고, dirty B·rescan/refresh·삭제/non-text·취소/newer request에서는 잘못된 target, file/Git write,
persistent content가 0건이다.

### Tests for User Story 2 ⚠️

- [x] T013 [P] [US2] Add failing tests for exact folder review token, scan generation, collision-aware normalized relative-item identity, rescan/deleted/binary/symlink/type-mismatch/containment stale outcomes, and no arbitrary row substitution under case/NFC collision in `src/core/folderView.test.ts`; verify the intended failures with `npm test -- src/core/folderView.test.ts`
- [ ] T014 [P] [US2] Add failing tests for exact Git repository session, generation, review kind, resolved object IDs, opaque path IDs, refresh/submodule/LFS/non-text stale outcomes, and prohibition of display-path/blob/session fallback in `src/core/gitSession.test.ts`; verify the intended failures with `npm test -- src/core/gitSession.test.ts`
- [x] T015 [P] [US2] Add failing tests for clean cross-item reserve→open→matching mount→restore→consume, dirty cross-document block with candidate/current preservation, consecutive stale skip, cancel/newer-request/I/O-failure non-consumption, 100ms restoring status, and one valid consume per invocation in `src/core/editorNavigationRestore.test.ts` and `src/core/editorNavigationHistory.test.ts`; verify the intended failures with `npm test -- src/core/editorNavigationRestore.test.ts src/core/editorNavigationHistory.test.ts`
- [x] T016 [P] [US2] Add failing tempfile/fixture Rust and TypeScript contract tests for folder pair side expectations, absolute/parent/empty path rejection, canonical-root containment, symlink/non-regular/binary/LFS-pointer/too-large rejection, missing-side appearance, cancellation during either side, duplicate/unknown job IDs, terminal registry cleanup, stable `{ code, message }` errors without raw path/content, and zero partial responses in `src-tauri/src/commands/files.rs` and `src/core/bridge.test.ts`; verify the intended failures with `npm test -- src/core/bridge.test.ts` and `cd src-tauri && cargo test folder_review_text_pair`

### External dependency gate for User Story 2

- [ ] T017 [US2] Confirm Git integration tasks T081 then T082 are completed in `specs/001-git-snapshot-integration/tasks.md` and their caller-owned cancellation/late-response identity tests pass in `src/core/gitSession.test.ts`, `src/App.tsx`, `src-tauri/src/commands/git.rs`, and `src-tauri/src/git/runner.rs`; verify with `npm test -- src/core/gitSession.test.ts` and `cd src-tauri && cargo test git`, record evidence in `specs/002-cursor-navigation-history/VALIDATION.md`, continue folder work if incomplete, but do not implement or mark Git cross-item restore complete inside UX-009 until both prerequisites pass

### Implementation for User Story 2

- [x] T018 [US2] Implement `FolderReviewTextPairRequest`/response DTOs, `read_folder_review_text_pair`, idempotent `cancel_folder_review_text_read`, all-or-nothing side validation, canonical containment, non-symlink regular-file checks, chunk cancellation, job cleanup, and typed bridge functions in `src-tauri/src/domain/models.rs`, `src-tauri/src/commands/files.rs`, `src-tauri/src/lib.rs`, `src/core/models.ts`, and `src/core/bridge.ts`; verify with `npm test -- src/core/bridge.test.ts` and `cd src-tauri && cargo test folder_review_text_pair`
- [x] T019 [P] [US2] Implement content-free folder review target creation and exact current-row validation using review token, scan generation, normalized relative-item key, and side expectations in `src/core/folderView.ts`, without absolute roots/paths or whole `FolderEntry` in history; verify with `npm test -- src/core/folderView.test.ts src/core/editorNavigationHistory.test.ts`
- [ ] T020 [P] [US2] Implement content-free revision/working-index/conflict Git target descriptors and exact repository-session/generation/opaque/request validators in `src/core/gitSession.ts`, without read-only merge preview targets, display-path, blob text, whole snapshot/session DTO, or raw argv fallback; verify with `npm test -- src/core/gitSession.test.ts src/core/editorNavigationHistory.test.ts`
- [x] T021 [US2] Implement the injected async restore coordinator with peek/reserve, pure stale/dirty/modal decisions, a 100ms accessible progress timer, open/cancel hooks, matching-mount acknowledgement, success-only consume, and release-on-cancel/newer-request/failure in `src/core/editorNavigationRestore.ts`; verify with `npm test -- src/core/editorNavigationRestore.test.ts src/core/editorNavigationHistory.test.ts`
- [x] T022 [US2] Issue a process-only folder review token/generation on successful scan, commit the mounted location before another row opens, fail closed on dirty cross-row Back, re-resolve the exact current row, use only the cancellable pair bridge, cancel the active pair job on newer row open/rescan/mode leave/Back cancellation, ignore newer/stale responses, restore after matching compare mount, and suppress recent-session updates during navigation restore in `src/App.tsx` and `src/core/i18n.ts`; verify with `npm test -- src/core/folderView.test.ts src/core/editorNavigationRestore.test.ts`, `npm run typecheck`, and `npm run build`
- [ ] T023 [US2] After T081/T082 evidence exists, connect Git changed-file, tracked-tree, file-history, working/index, and conflict descriptors to the existing caller-owned Git opener while excluding read-only merge preview Result; block dirty merge/compare cross-item transitions, cancel on repository close/refresh/new request, ignore mismatched late responses, suppress recent-session updates during navigation restore, and consume only after matching mount in `src/App.tsx` and `src/core/gitSession.ts`; verify with `npm test -- src/core/gitSession.test.ts src/core/editorNavigationRestore.test.ts`, `npm run typecheck`, and `npm run build`
- [ ] T024 [US2] Run the complete automated US2 gate and record only actual results in `specs/002-cursor-navigation-history/VALIDATION.md`: `npm test -- src/core/editorNavigationHistory.test.ts src/core/editorNavigationRestore.test.ts src/core/folderView.test.ts src/core/gitSession.test.ts src/core/bridge.test.ts`, `npm run typecheck`, `npm run build`, and `cd src-tauri && cargo test folder_review_text_pair`; do not alter hardware rows

**Checkpoint**: folder half may finish before T081/T082, but US2 is complete only after both folder and Git
restore satisfy the independent test.

---

## Phase 5: User Story 3 — 마우스와 키보드의 동일한 뒤로 이동 (Priority: P2)

**Goal**: native menu, OS shortcut, hardware Back intent가 하나의 `navigateEditorBack` handler로 들어가고
empty/modal/native-dialog/dirty/in-flight 상태를 우회하지 않는다.

**Independent Test**: injected Windows/Linux/macOS shortcut과 synthetic button 3 event가 같은 history에서
정확히 한 위치만 복원하며 button 4, empty history, modal/native chooser, dirty cross-document에서는
history와 화면을 바꾸지 않는다. 실제 hardware 전달은 사용자가 별도 검증한다.

### Tests for User Story 3 ⚠️

- [X] T025 [P] [US3] Add failing tests for `navigateEditorBack`, source+monotonic-time event detail, Windows/Linux `Alt+Left`, macOS `Ctrl+-`, exact modifiers, ARIA strings, per-platform collision zero, and legacy command payload compatibility in `src/core/commands.test.ts`; verify the intended failures with `npm test -- src/core/commands.test.ts`
- [X] T026 [P] [US3] Add failing tests for exact keyboard matching, capture-stage `pointerdown` button 3 single dispatch with no `mousedown` command, auxclick default-only blocking, button 4 no command, cross-source duplicate suppression only within 80ms when both monotonic timestamps exist, same-source repeat and timestamp-missing preservation, unavailable default prevention, modal/dialog/in-flight/empty/dirty non-consumption, and no alias to toolbar `onBack` in `src/core/navigationInput.test.ts`; verify the intended failures with `npm test -- src/core/navigationInput.test.ts`
- [X] T027 [P] [US3] Add failing tests for boolean-only native menu enabled calls, setter rejection fail-closed behavior with a content-free status, and exception-safe nested native open/save dialog depth subscription with cancel/reject `finally` recovery in `src/core/bridge.test.ts`; verify the intended failures with `npm test -- src/core/bridge.test.ts`
- [X] T028 [P] [US3] Add failing Rust/static contract tests for stable `navigateEditorBack` allowlisting, initial-disabled menu item, cfg-specific accelerator, stable-item-only boolean toggle, and invoke registration in `src-tauri/src/menu.rs`, `src-tauri/src/commands/system.rs`, `src-tauri/src/lib.rs`, and `src/core/editorNavigationNativeContract.test.ts`; verify the intended failures with `npm test -- src/core/editorNavigationNativeContract.test.ts` and `cd src-tauri && cargo test navigation_back`

### External dependency gate for User Story 3

- [X] T029 [US3] Confirm T084 provides one authoritative packaged-runtime platform DTO and hides OS/path inputs on successful detection in `specs/001-git-snapshot-integration/tasks.md`, `src-tauri/src/commands/system.rs`, `src/core/bridge.ts`, and `src/components/GitToolSetup.tsx`; verify with `npm test -- src/core/bridge.test.ts src/components/GitToolSetup.test.tsx` and `cd src-tauri && cargo test system`, record evidence in `specs/002-cursor-navigation-history/VALIDATION.md`, and do not add a second platform command, navigator fallback, OS selector, or persisted OS setting in UX-009

### Implementation for User Story 3

- [X] T030 [P] [US3] Implement platform-aware `navigateEditorBack` command metadata plus typed source/event parsing and make the native relay emit `source: "nativeMenu"` in `src/core/commands.ts` and `src/core/nativeMenu.ts`; verify with `npm test -- src/core/commands.test.ts`
- [X] T031 [US3] Implement keyboard, pointer/button-3, auxclick-default, and cross-source dedupe adapters with exact modifiers and outcome mapping in `src/core/navigationInput.ts`, consuming the authoritative T084 platform value by injection; verify with `npm test -- src/core/navigationInput.test.ts src/core/commands.test.ts`
- [X] T032 [P] [US3] Implement a boolean-only `setEditorNavigationBackEnabled` bridge and exception-safe nested native-dialog depth store/subscription around `chooseTextFile`, `chooseDirectory`, and `chooseSavePath` in `src/core/bridge.ts`, without adding a platform source or persisting dialog state; verify with `npm test -- src/core/bridge.test.ts`
- [X] T033 [P] [US3] After T084, add the stable initial-disabled Navigate/Back menu item with Windows/Linux `Alt+Left` and macOS `Ctrl+-`, the stable-ID-only boolean setter, command allowlist entry, and invoke registration in `src-tauri/src/menu.rs`, `src-tauri/src/commands/system.rs`, and `src-tauri/src/lib.rs`, reusing T084 runtime facts rather than redefining them; verify with `npm test -- src/core/editorNavigationNativeContract.test.ts` and `cd src-tauri && cargo test navigation_back`
- [X] T034 [US3] Register capture-stage keyboard/pointer/auxclick listeners and route typed native events into one App handler; apply React modal (`showUnsavedDialog`, `showUnresolvedSaveDialog`, `backupDialog`) → native-dialog depth → in-flight → active target/candidate → dirty-cross-document guards, perform at most one restore, announce content-free results, and leave every existing screen-leave `onBack` unchanged in `src/App.tsx` and `src/core/i18n.ts`; verify with `npm test -- src/core/navigationInput.test.ts src/core/editorNavigationHistory.test.ts`, `npm run typecheck`, and `npm run build`
- [X] T035 [US3] Derive native menu availability with the same pure candidate validator and synchronize only when the boolean changes across history, adapter, modal, dialog, in-flight, and dirty states; revalidate on command execution and fail closed on races in `src/App.tsx`; verify with `npm test -- src/core/navigationInput.test.ts src/core/bridge.test.ts`, `npm run typecheck`, and `npm run build`
- [X] T036 [US3] Run the complete automated US3 gate and record only actual results in `specs/002-cursor-navigation-history/VALIDATION.md`: `npm test -- src/core/editorNavigationHistory.test.ts src/core/monacoNavigation.test.ts src/core/commands.test.ts src/core/navigationInput.test.ts src/core/bridge.test.ts src/core/editorNavigationNativeContract.test.ts`, `npm run typecheck`, `npm run build`, `cd src-tauri && cargo test navigation_back`; leave packaged hardware rows unchanged

**Checkpoint**: Foundation + US1 + US3 is the first user-operable slice. US2 is not required for same-document
Back input.

---

## Phase 6: Polish and Cross-Cutting Verification

**Purpose**: privacy, accessibility, documentation, full automated gates, and user-owned hardware handoff를
완료한다.

- [X] T037 [P] Add cross-cutting regression tests that navigation history never reaches settings/recent/localStorage/IndexedDB/log/native payloads, empty Back never changes screen mode or exits external Git tools, status remains polite, and restored editor focus remains visible in `src/core/privacyLoggingPolicy.test.ts`, `src/core/navigation.test.ts`, and `src/core/accessibilityFocus.test.ts`; verify with `npm test -- src/core/privacyLoggingPolicy.test.ts src/core/navigation.test.ts src/core/accessibilityFocus.test.ts`
- [X] T038 [P] Align implemented UX-009 behavior, cancellable folder pair-read coverage, external T081/T082/T084 dependencies, and user-owned hardware evidence wording in `docs/04_BACKLOG.md`, `docs/07_TEST_PLAN.md`, `docs/08_UX_SPEC.md`, `specs/002-cursor-navigation-history/spec.md`, and `specs/002-cursor-navigation-history/quickstart.md`; verify consistency with `rg -n "UX-009|T081|T082|T084|manual-not-run|hardware" docs/04_BACKLOG.md docs/07_TEST_PLAN.md docs/08_UX_SPEC.md specs/002-cursor-navigation-history`
- [X] T039 Run `npm run typecheck`, `npm test`, and `npm run build`, then record exact command, result, date, and failure details without content/path leakage in `specs/002-cursor-navigation-history/VALIDATION.md`; do not weaken, skip, or delete failing tests
- [X] T040 Run `cd src-tauri && cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, and `cargo test`, then record exact results without claiming unexecuted platform coverage in `specs/002-cursor-navigation-history/VALIDATION.md`
- [ ] T041 Prepare the user hardware handoff only: keep every Windows WebView2/macOS WKWebView/Linux WebKitGTK compare/merge × keyboard/X1/native-menu, X2, modal/native-dialog, dirty, external-tool, rapid-repeat, live-region/focus row plus packaged shutdown storage/cache/log/Git-temp-path inspection as `user-owned / manual-not-run`; add artifact SHA, OS/WebView/device, date, evidence, and pass/fail input fields in `specs/002-cursor-navigation-history/VALIDATION.md`, label feature status `implementation complete / release verification pending` until user evidence exists, verify no row is marked pass with `rg -n "user-owned|manual-not-run|artifact SHA|WebView|device|release verification pending" specs/002-cursor-navigation-history/VALIDATION.md`, and do not execute packaged hardware validation
- [X] T042 Ensure the 2-way diff editor and editable 3-way Result register navigation bindings directly from their Monaco mount callbacks, retain prop-change reconfiguration, distinguish the command/native menu as `Previous Editor Location`, and lock the wiring with `src/core/editorNavigationMountContract.test.ts`, `src/core/commands.test.ts`, `src/core/editorNavigationNativeContract.test.ts`, `src/components/FileCompareView.tsx`, and `src/components/MergeView.tsx`; verify with `npm test -- src/core/editorNavigationMountContract.test.ts src/core/commands.test.ts src/core/editorNavigationNativeContract.test.ts src/components/FileCompareView.test.tsx src/components/MergeView.test.tsx`

---

## Dependencies and Execution Order

### Phase Dependencies

- **Phase 1 Setup**: 즉시 시작 가능.
- **Phase 2 Foundation**: Setup 뒤 시작하며 모든 story를 차단한다.
- **Phase 3 US1**: Foundation 뒤 시작한다.
- **Phase 4 US2**: Foundation + US1 mounted handle 뒤 시작한다. Folder는 독립 진행 가능하고 Git 완료는
  external `T081 → T082`가 필요하다.
- **Phase 5 US3**: Foundation + US1 handler 뒤 시작한다. US2와 병렬 가능하고 platform/native bridge는
  external `T084`가 필요하다.
- **Phase 6 Polish**: release하려는 story가 모두 끝난 뒤 수행한다.

### User Story Dependency Graph

```text
T001 Setup
  → T002/T003 → T004 → T005 Foundation
                         → US1 T006–T012
                              ├─→ US2 core/folder T013–T022
                              │      T081 → T082 ─→ US2 Git T023–T024
                              └─→ US3 tests/core T025–T032
                                     T084 ─→ US3 native T033–T036
US2 + US3 → Polish T037–T041
```

### Within Each Story

- 실패 테스트를 먼저 작성하고 의도한 이유로 실패함을 확인한다.
- content-free model/validator가 App integration보다 먼저다.
- async opener는 request identity/cancel test 뒤에 연결한다.
- history candidate는 matching restore 성공 뒤에만 소비한다.
- focused gate를 통과한 뒤에만 full frontend/Rust gate를 실행한다.
- 실제로 실행하지 않은 hardware/package 검증은 pass로 기록하지 않는다.

### Requirement Coverage

| Requirement group | Covered by |
|---|---|
| Bounded memory, coalescing, replay, one-consume (`FR-001`, `FR-004`, `FR-005`, `FR-008`, `FR-015`) | T002–T005, T008 |
| Pane/cursor/viewport/focus and dirty invariance (`FR-002`, `FR-003`, `FR-007`, `FR-014`) | T006–T012 |
| Exact folder/Git identity, stale/non-text skip (`FR-009`, `FR-010`, `SR-003`) | T013–T024 |
| Dirty cross-document and async 100ms status (`FR-016`, `FR-017`) | T015, T021–T024 |
| Mouse/keyboard/menu parity and modal ownership (`FR-006`, `FR-011`–`FR-013`) | T025–T036 |
| No file/Git/settings/content persistence (`SR-001`, `SR-002`) | T002, T016–T018, T037–T040 |
| Explicit out-of-scope and user hardware handoff (`SR-004`, `SC-005`, `SC-006`) | T001, T038, T041 |
| Mounted/cross-item 100ms behavior (`SC-001`) | T008, T012, T015, T021, T024 |
| 101-location order and eviction (`SC-002`, `SC-003`) | T002, T004, T008 |
| 50 mixed stale/non-text safety (`SC-004`) | T002, T013–T024, T037 |

### Parallel Opportunities

- Foundation의 T002와 T003은 병렬 가능하다.
- US1의 T006/T007/T008, 이후 T009/T010은 서로 다른 파일에서 병렬 가능하다.
- US2의 T013/T014/T015/T016과 이후 T019/T020은 병렬 가능하다.
- US3의 T025/T026/T027/T028과 이후 T030/T032/T033은 선행 dependency가 충족되면 병렬 가능하다.
- US2와 US3 core 작업은 US1 뒤 서로 병렬 가능하다.
- T037과 T038은 구현 완료 뒤 병렬 가능하다.

---

## Parallel Examples

### User Story 1

```text
T006 FileCompare lifecycle tests  ||  T007 Merge lifecycle tests  ||  T008 mounted resolver tests
T009 FileCompare integration      ||  T010 Merge integration
```

### User Story 2

```text
T013 folder identity tests  ||  T014 Git identity tests  ||  T015 async restore tests  ||  T016 pair-read tests
T019 folder validator       ||  T020 Git validator
```

### User Story 3

```text
T025 command tests  ||  T026 input tests  ||  T027 bridge tests  ||  T028 native contract tests
T030 command relay  ||  T032 dialog bridge  ||  T033 native menu (after T084)
```

---

## Implementation Strategy

### Development MVP: User Story 1

1. Complete T001–T005.
2. Complete T006–T012.
3. Validate mounted compare/merge restore through `programmaticTest`.
4. Do not call this user-operable until US3 is complete.

### User-Operable MVP

1. Complete Foundation + US1.
2. Complete T084 externally.
3. Complete US3 T025–T036.
4. Validate synthetic keyboard/mouse/native contracts automatically.
5. Hand packaged hardware rows to the user as `manual-not-run`.

### Full UX-009

1. Complete the user-operable MVP.
2. Complete folder US2, including cancellable pair read.
3. Complete external T081→T082, then Git US2.
4. Run full automated frontend/Rust gates.
5. Update documentation and hand off, without executing user-owned hardware validation.

## Notes

- `GitToolSetup.tsx` OS/path selector removal belongs to external T084, not UX-009.
- Git runner cancellation/late-response hardening belongs to external T081/T082, not a duplicate UX-009 path.
- `FileCompareView`/`MergeView` tests must invoke captured lifecycle seams; SSR markup alone is not restore proof.
- Merge model revision changes on model replacement, not ordinary Result edits.
- Active hunk/conflict decoration is derived from a restored cursor only when it falls in a current range; the index
  is never persisted in history.
- Read-only Git preview Result and BASE/OURS/THEIRS are not initial navigation targets.
- History forward, restart persistence, arbitrary closed-file reopen, global mouse hook, auto-save, and platform
  native WebView patch remain out of scope.
