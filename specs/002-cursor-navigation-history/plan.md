# Implementation Plan: Cursor Navigation History

**Branch**: `002-cursor-navigation-history` (planned; working tree is currently `main`) | **Date**: 2026-07-17 | **Spec**: [spec.md](./spec.md) | **Backlog**: `UX-009`

**Input**: Feature specification from `specs/002-cursor-navigation-history/spec.md`

## Summary

2-way compare의 left/right와 3-way merge의 editable Result에서 최근 100개의 의미 있는 편집
위치를 process memory에만 보관하고, native menu·OS별 단축키·hardware mouse Back이 하나의
`navigateEditorBack` command로 같은 위치를 복원하게 한다. 위치는 content-free session/document
identity, pane, cursor, 명시적 viewport 좌표만 가진다. App이 history와 restore transaction을
소유하고 Monaco component는 capture/restore adapter만 제공한다.

같은 mount 안의 복원은 동기적으로 수행한다. folder/Git live review의 다른 text 항목은 현재
generation과 opaque/relative identity를 먼저 검증한다. Git은 선행 T081/T082의 취소 경로를,
folder는 새 narrow cancellable pair-read를 사용하며 mount가 확인된 후에만 history를 소비한다.
현재 문서가 dirty라서 다른 문서를 열어야 하면 data
loss를 막기 위해 history를 소비하지 않고 차단한다. 기존 화면 이탈용 `onBack`과 browser history,
global mouse hook, persistence는 사용하지 않는다.

## Technical Context

**Language/Version**: TypeScript 6.0.3 strict, React 19.2.7; Rust edition 2024, rust-version 1.85

**Primary Dependencies**: Tauri 2.11, Monaco Editor 0.55.1, `@monaco-editor/react` 4.7.0; 기존 typed command/event, folder scan, Git session, safe text decode 경로 재사용; external prerequisites는 Git task T081/T082의 cancel/identity guard와 T084의 authoritative runtime platform DTO; folder cross-item reopen에는 좁은 cancellable folder-review pair command 추가; 신규 runtime dependency 없음

**Storage**: 영속 저장 없음. 현재 process의 React/ref 및 순수 bounded history에 content-free metadata 최대 100개만 유지

**Testing**: Vitest pure/contract/component tests with fake Monaco editor; Rust menu/file-read command unit tests; Windows WebView2, macOS WKWebView, Linux WebKitGTK packaged hardware smoke는 사용자 소유 검증으로 handoff하고 에이전트는 실행하지 않음

**Target Platform**: 현재 Forktail release matrix의 Windows, macOS, Linux desktop package

**Project Type**: React/TypeScript UI와 Rust/Tauri shell로 구성된 cross-platform desktop app

**Performance Goals**: 이미 mount된 위치는 입력 후 100ms 안에 pane/cursor/viewport 복원; cross-item read는 100ms 안에 accessible progress 표시; history push/peek/stale scan은 최대 100개를 대상으로 결정적으로 완료

**Constraints**: history 100개, 한 번에 restore transaction 하나, file content/diff/result/주변 text 저장 금지, file/Git mutation·network·telemetry 금지, stale identity 대체 금지, dirty cross-document 이동 금지, OS 선택 UI 금지

**Scale/Scope**: 한 app process, 한 active compare/merge 화면, 2-way left/right와 merge Result, 현재 live folder/Git review 안의 재식별 가능한 text 항목

## Constitution Check

*GATE: Phase 0 research 전에 확인했으며 Phase 1 설계 뒤 다시 확인한다.*

- **Predictability — PASS**: LIFO, 100-entry eviction, coalescing, stale discard, replay suppression,
  dirty/modal blocking을 명시적 상태 전이로 고정한다. 비슷한 path로 대체하지 않는다.
- **No-surprise writes — PASS**: 기능은 editor view state만 바꾸며 file, Git, settings, recent session을
  쓰지 않는다. cross-document dirty 상태는 저장/폐기 확인을 우회하지 않고 차단한다.
- **Local privacy — PASS**: history는 memory-only이며 content, diff, merge Result, cursor 주변 text,
  Git temporary path를 DTO, log, telemetry, persistent storage에 넣지 않는다.
- **Architecture boundary — PASS**: 순수 history/input policy는 TypeScript core에, Monaco 연결은 UI에,
  native menu accelerator/enabled state와 folder reopen용 cancellable text read만 좁은 Rust/Tauri
  경계에 둔다. broad FS permission이나 generic path API는 추가하지 않는다.
- **Test-first delivery — PASS**: `UX-009` 하나의 feature 범위에서 core contract test를 먼저 만들고,
  mounted restore, input parity, live-review restore, packaged smoke 순으로 검증한다.

헌법 위반이나 ADR 예외는 필요하지 않다.

## Project Structure

### Documentation (this feature)

```text
specs/002-cursor-navigation-history/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── VALIDATION.md
├── contracts/
│   └── editor-navigation-contract.md
└── tasks.md
```

### Source Code (repository root)

```text
src/
├── App.tsx
├── components/
│   ├── FileCompareView.tsx
│   ├── FileCompareView.test.tsx
│   ├── MergeView.tsx
│   └── MergeView.test.tsx
└── core/
    ├── commands.ts
    ├── commands.test.ts
    ├── nativeMenu.ts
    ├── bridge.ts
    ├── bridge.test.ts
    ├── models.ts
    ├── i18n.ts
    ├── editorNavigationHistory.ts
    ├── editorNavigationHistory.test.ts
    ├── editorNavigationCoordinator.ts
    ├── editorNavigationCoordinator.test.ts
    ├── editorNavigationRestore.ts
    ├── editorNavigationRestore.test.ts
    ├── editorNavigationNativeContract.test.ts
    ├── folderView.ts
    ├── folderView.test.ts
    ├── gitSession.ts
    ├── gitSession.test.ts
    ├── monacoNavigation.ts
    ├── monacoNavigation.test.ts
    ├── navigationInput.ts
    ├── navigationInput.test.ts
    ├── navigation.test.ts
    ├── privacyLoggingPolicy.test.ts
    └── accessibilityFocus.test.ts

src-tauri/src/
├── lib.rs
├── menu.rs
├── domain/
│   └── models.rs
└── commands/
    ├── files.rs
    └── system.rs
```

**Structure Decision**: 기존 단일 Tauri app 구조를 유지한다. history/coalescing/restore transaction과
input policy는 DOM 또는 Monaco가 없어도 검증 가능한 순수 `src/core` 모듈로 둔다. `App.tsx`는
active workflow identity, dirty/modal/native-dialog gate, cross-document resolver를 조율한다.
`FileCompareView`와 `MergeView`는 text나 whole Monaco view state를 외부로 내보내지 않고 최소
capture/restore handle만 등록한다. Rust 변경은 stable menu item과 compile-target platform 정보,
enabled boolean, 그리고 기존 text decoder를 재사용하는 cancellable read command로 제한한다.

## Design and Delivery Phases

### Phase 0 — Contract and failing tests

- `editor-navigation-contract.md`의 command, identity, consumption, modal/dirty, input source 계약을
  먼저 고정한다.
- 100-entry eviction, coalescing, stale skip, peek/commit, replay suppression, clamp, privacy field
  sentinel을 실패하는 pure test로 표현한다.
- Windows/Linux/macOS shortcut map과 기존 command collision, mouse button 3/X2 무동작,
  cross-source duplicate delivery를 input test로 표현한다.

### Phase 1 — Pure history and mounted editor adapter

- `editorNavigationHistory.ts`에 bounded LIFO와 2-phase restore reservation을 구현한다.
- `monacoNavigation.ts`는 `saveViewState` 대신 cursor, top line + pixel offset, horizontal scroll을
  명시적으로 capture하고 현재 model 범위에 clamp해 복원한다.
- File compare mount에서 left/right editor의 focus/cursor/scroll을 관찰하고 F7/Shift+F7 이동 전에
  origin을 commit한다. Merge Result는 F8/Shift+F8 및 conflict selection 이동 전에 commit한다.
- restore guard 안에서 발생한 cursor/focus/scroll event는 current snapshot만 갱신하거나 무시하고
  past에 다시 push하지 않는다.

### Phase 2 — One command and safe input ownership

- 기존 화면 종료용 `onBack`과 구분되는 `navigateEditorBack`을 typed registry에 추가한다.
- App의 한 handler가 capability 확인, stale scan, restore reservation, status announcement를 담당한다.
- 중앙 native-dialog depth gate를 기존 open/save chooser 호출에 적용한다. React modal, dirty-close,
  native dialog, restore-in-flight 동안 명령은 history를 소비하지 않는다.
- Rust native Navigate menu item은 처음 disabled이고 Windows/Linux `Alt+Left`, macOS `Ctrl+-`를
  compile target으로 설정한다. DOM matcher는 선행 T084의 authoritative runtime platform DTO를
  재사용하며 UI는 OS를 다시 묻지 않고 별도 platform source도 만들지 않는다.
- DOM keyboard와 pointer input은 같은 App command로 들어간다. mouse `button === 3`만 실행하고
  후속 `auxclick` default를 막는다. native/DOM이 같은 물리 입력을 중복 전달하면 source가 다른
  짧은 동일 gesture만 dedupe하며 같은 source의 별도 반복 입력은 합치지 않는다.

### Phase 3 — Live folder/Git cross-item restore

- 다른 folder/Git text 항목을 열기 직전에 mounted location을 commit한다.
- folder는 현재 review token + scan generation + normalized relative item identity, Git은 repository
  session + generation + opaque path/request identity로만 resolve한다. display path나 whole session
  DTO를 identity로 저장하지 않는다.
- candidate를 먼저 validate하고, current document가 clean일 때만 async open/cancel/stale-result
  경로를 호출한다. Git은 기존 caller-owned job 경로를 재사용하되 `specs/001-git-snapshot-integration/tasks.md`의
  T081/T082 cancel/identity guard 완료를 선행 조건으로 확인한다. folder는 현재 `readTextFile`의
  uncancellable `Promise.all`을 재사용하지 않고, 동일 decode/binary/size 정책과 containment/side
  expectation을 가진 좁은 cancellable pair-read command 및 request-generation guard를 추가한다.
  matching editor mount와 viewport restore가 성공한 후 pop을 commit한다.
- 삭제, rescan/refresh, binary, symlink, submodule, LFS pointer, containment 실패는 candidate를
  stale로 폐기하고 같은 command에서 다음 유효 candidate를 찾는다. 사용자 취소나 newer request는
  reservation을 해제하되 candidate를 소비하지 않는다.

### Phase 4 — Accessibility, parity, and release evidence

- empty/all-stale/blocked/restoring/restored 결과를 `role=status`, `aria-live=polite`의 중립적인
  navigation status로 알리고 focus를 목적 editor로 되돌린다.
- history/candidate/block/in-flight 변화에만 native enabled boolean을 동기화하고 Rust/TS command
  ID와 accelerator parity를 contract test로 고정한다.
- 세 OS packaged app의 실제 X1 mouse, keyboard, native menu 검증 절차와 evidence 표를 준비한다.
  사용자가 직접 한 입력당 한 칸, X2 무동작, browser/screen 이탈 0, modal/dirty 우회 0을 검증하며,
  에이전트는 hardware/package manual 검증을 실행하거나 통과로 표시하지 않는다.

## Failure and Cancellation Strategy

- **Empty/all stale**: 화면과 current snapshot을 유지하고 상태 메시지만 갱신한다.
- **Modal/native dialog**: 입력 default가 WebView navigation을 만들지 않도록 차단하되 history는
  peek/pop하지 않는다.
- **Dirty cross-document**: save/discard dialog를 자동으로 열거나 우회하지 않는다. 현재 editor와
  candidate를 그대로 두고 행동 가능한 메시지를 표시한다.
- **Async target failure**: stale identity면 candidate만 폐기하고 다음 후보를 검사한다. I/O 오류나
  사용자 취소면 현재 화면을 유지하고 reservation을 해제한다.
- **Newer workflow generation**: 기존 request 결과와 pending mount token을 무시한다.
- **Restore adapter failure**: candidate를 소비하지 않고 current editor를 유지한다. model identity가
  이미 달라졌다면 candidate를 stale로 전환한다.
- **Native enabled sync failure**: menu는 fail-closed disabled 상태를 유지하고 UI status에 content-free
  오류를 알린다. file content/path를 오류나 log에 넣지 않는다.

## Complexity Tracking

헌법 위반 없음. OS별 accelerator와 hardware Back의 차이는 하나의 command 앞단 adapter로만
격리하며, global hook이나 platform-specific WebView patch는 초기 구현에 포함하지 않는다.

## Post-Design Constitution Check

- **Predictability — PASS**: [data-model.md](./data-model.md)가 current/past/reservation과 stale/blocked
  소비 규칙을 분리하고, [editor-navigation-contract.md](./contracts/editor-navigation-contract.md)가
  입력 하나당 최대 한 위치라는 계약을 고정한다.
- **No-surprise writes — PASS**: contract에 file/Git/settings write operation이 없고 dirty cross-document
  이동은 fail-closed다.
- **Local privacy — PASS**: location allowlist와 금지 필드를 명시했으며 memory 밖 serialization API를
  만들지 않는다.
- **Architecture boundary — PASS**: content-free view adapter와 boolean menu bridge를 유지하고,
  folder reopen에 필요한 native surface는 caller-owned job ID, side expectation, 기존 decode policy를
  가진 좁은 pair-read/cancel command 두 개로 제한한다.
- **Test-first delivery — PASS**: [quickstart.md](./quickstart.md)에 focused test, full frontend/Rust gate,
  packaged OS evidence 순서를 명시했다.

설계 이후에도 승인된 ADR 예외는 필요하지 않다.
