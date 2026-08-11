# Quickstart: Cursor Navigation History

## Goal

`UX-009`를 test-first로 구현하고, 2-way left/right와 merge Result의 mounted restore부터
folder/Git live-review cross-item restore, native input parity까지 검증한다.

현재 mounted 2-way/3-way + native input slice는 자동 검증을 통과했다. live folder/Git cross-item 단계는
cancellable folder pair-read와 Git T081/T082가 남아 있으며, packaged hardware matrix는 계속
`user-owned / manual-not-run`이다. T084 authoritative runtime DTO는 완료되어 OS 선택 없이 shortcut과
menu accelerator를 결정한다.

## Prerequisites

먼저 다음 문서와 contract를 읽는다.

1. `AGENTS.md`
2. `docs/01_PRD.md`
3. `docs/02_ARCHITECTURE.md`
4. `docs/04_BACKLOG.md`의 `UX-009`, `FND-005`
5. `docs/07_TEST_PLAN.md`
6. `docs/08_UX_SPEC.md`
7. `specs/002-cursor-navigation-history/spec.md`
8. `specs/002-cursor-navigation-history/contracts/editor-navigation-contract.md`

Git cross-item restore 전에 `specs/001-git-snapshot-integration/tasks.md` T081/T082가, platform shortcut
연결 전에 T084의 authoritative runtime DTO가 완료됐는지 확인한다. UX-009에서 이 선행 작업을 다른
방식으로 중복 구현하지 않는다.

이 기능은 저장을 추가하지 않지만 native menu와 release behavior를 바꾸므로 구현 완료 전
`docs/09_RELEASE_SECURITY.md`의 packaged test/privacy gate도 확인한다.

## Test-first Implementation Order

### 1. Pure history state machine

먼저 `src/core/editorNavigationHistory.test.ts`에 다음 실패 사례를 만든다.

- A→B→C 뒤 Back이 B→A 순서
- past 최대 100개, 101번째에서 oldest 하나만 eviction
- 같은/인접 caret + 같은 viewport coalescing
- 다른 pane/target은 coalesce하지 않음
- replay event가 새 past를 만들지 않음
- stale 여러 개를 건너뛰고 valid 하나만 consume
- blocked/cancelled/failed candidate 미소비
- active reservation 중 duplicate consume 없음
- model에 content/persistence field 없음

그 뒤 최소 구현으로 `src/core/editorNavigationHistory.ts`를 통과시킨다.

Focused command:

```bash
npm test -- src/core/editorNavigationHistory.test.ts
```

### 2. Monaco capture/restore adapter

`src/core/monacoNavigation.test.ts`에 fake editor/model을 사용해 다음을 먼저 고정한다.

- pane, cursor, top line + pixel offset, scrollLeft capture
- line/column/viewport clamp
- `setPosition`, `setScrollPosition`, `focus` 순서
- text/edit/undo API 미호출
- unavailable/stale model fail-closed

Focused command:

```bash
npm test -- src/core/monacoNavigation.test.ts
```

### 3. Input and command parity

`commands.test.ts`, `navigationInput.test.ts`에서 다음을 먼저 고정한다.

- Windows/Linux `Alt+Left`, macOS `Ctrl+-`
- extra modifier와 다른 platform shortcut 거절
- existing command collision 0
- mouse button 3만 command, auxclick은 default 차단만, button 4 무동작
- nativeMenu + DOM same gesture 한 번, same-source distinct repeat 유지
- `pointerdown`만 command를 만들고 `mousedown`은 만들지 않음
- 서로 다른 source의 timestamp가 모두 있고 80ms 이하일 때만 duplicate 제거
- modal/native dialog/in-flight/empty/dirty-cross-document history consume 0
- 기존 toolbar `onBack`이 `navigateEditorBack` handler가 아님

Focused command:

```bash
npm test -- src/core/commands.test.ts src/core/navigationInput.test.ts
```

### 4. Mounted editor integration

FileCompare와 Merge component test에서 fake navigation handle로 검증한다.

- FileCompare left/right focus와 F7/Shift+F7 origin capture
- Merge Result와 F8/Shift+F8/conflict selection origin capture
- Back 뒤 pane/cursor/viewport/focus 복원
- dirty Result의 text, dirty flag, undo/redo 불변
- unmount subscription dispose
- restore 중 cursor event 재기록 없음

Focused command:

```bash
npm test -- src/components/FileCompareView.test.tsx src/components/MergeView.test.tsx
```

### 5. Live folder/Git restore

현재 fixture/DTO를 재사용해 App에서 분리한 pure resolver를 검증한다.

- same folder scan generation의 이전 text row reopen
- rescan/deleted/binary/symlink/containment failure stale skip
- repository session + generation + opaque request exact match
- refresh/submodule/LFS/non-text stale skip
- dirty current cross-item block과 candidate 보존
- cancellation/newer request result 무시와 candidate 보존
- matching mount success 뒤에만 consume
- async open이 100ms를 넘으면 status 먼저 표시
- folder pair read의 side expectation, containment, chunk cancellation, terminal job cleanup
- Git T081/T082 cancel/response-identity prerequisite 확인

새 broad file/Git command나 fixture write helper를 만들지 않고 기존 read/cancel path를 사용한다.

### 6. Native menu contract

Rust test는 최소 다음을 확인한다.

- command allowlist에 `navigateEditorBack` 존재
- item initial disabled
- macOS/Windows/Linux cfg별 accelerator constant
- boolean system command가 stable item 하나만 enable/disable
- `lib.rs` handler 등록
- runtime platform은 compile target과 일치

Focused command:

```bash
cd src-tauri
cargo test menu
cargo test system
```

## Full Automated Validation

Frontend:

```bash
npm run typecheck
npm test
npm run build
```

Rust/Tauri:

```bash
cd src-tauri
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
```

실행하지 않은 검증은 통과로 기록하지 않는다.

## Packaged Manual Matrix

실제 package와 hardware X1 button이 있는 mouse로 각 지원 OS를 검증한다. 이 matrix의 실행자는
사용자이며 에이전트는 절차와 기록 칸만 준비하고 직접 실행하거나 통과로 표시하지 않는다.

| Scenario | Windows WebView2 | macOS WKWebView | Linux WebKitGTK |
|---|---|---|---|
| native Navigate menu item enabled/disabled parity | required | required | required |
| 2-way platform shortcut 한 번에 한 위치 | `Alt+Left` | `Ctrl+-` | `Alt+Left` |
| 3-way platform shortcut 한 번에 한 위치 | `Alt+Left` | `Ctrl+-` | `Alt+Left` |
| 2-way X1 Back 한 번에 한 위치 | required | required | required |
| 3-way X1 Back 한 번에 한 위치 | required | required | required |
| X2 Forward 무동작 | required | required | required |
| native + DOM duplicate delivery 없음 | required | required | required |
| empty history에서 screen/browser 이탈 없음 | required | required | required |
| React modal 3종 우회 없음 | required | required | required |
| native open/save chooser 우회 없음 | required | required | required |
| dirty same-document 허용 / dirty cross-item 차단 | required | required | required |
| difftool/mergetool process 종료 없음 | required | required | required |
| 빠른 반복 입력 순서/중복 소비 없음 | required | required | required |
| status live region과 목적 editor focus | required | required | required |
| 종료 후 storage/cache/log/Git temp path 잔존 없음 | required | required | required |

Linux는 release matrix가 X11과 Wayland를 모두 지원한다면 각각 증거를 남긴다. 특정 WebView가 button 3을
DOM으로 전달하지 않으면 platform-native hook을 즉시 추가하지 말고, 재현 package/version/device와
event 관찰 결과를 별도 issue/ADR에 기록한다.

## Manual Functional Script

1. 2-way compare를 열고 left A, right B, next diff C를 차례로 방문한다.
2. Back을 두 번 실행해 B, A의 pane/cursor/viewport/focus가 역순으로 복원되는지 확인한다.
3. right를 편집해 dirty로 만든 뒤 같은 document의 두 위치를 Back하고 text/undo/dirty가 그대로인지
   확인한다.
4. folder review의 item A와 B를 연 뒤 clean B에서 Back해 A가 exact generation으로 열리는지 확인한다.
5. B를 dirty로 만든 뒤 cross-item Back이 차단되고 B와 history가 그대로인지 확인한다.
6. folder rescan 또는 Git refresh 후 old candidate가 비슷한 이름의 새 target으로 열리지 않는지
   확인한다.
7. empty history에서 keyboard, native menu, X1을 각각 실행해 Home/previous mode로 가지 않는지
   확인한다.
8. modal과 native chooser를 열어 Back 입력이 dialog를 우회하지 않는지 확인한다.

## Privacy Review

- location type과 event payload가 allowlist field만 갖는지 검사한다.
- `localStorage`, `IndexedDB`, settings/recent schema, log/error payload에 navigation location을 연결한
  코드가 없는지 검사한다.
- sentinel file content와 Git display/temp path가 history/event/native bridge mock에 나타나지 않는
  test를 유지한다.
- app 종료 뒤 navigation history 복원 동작과 cursor cache file이 없음을 packaged smoke에 기록한다.

## Completion Evidence

완료 보고에는 다음만 포함한다.

- `UX-009` 구현 파일과 user story별 결과
- 실제 실행한 frontend/Rust 검증 명령과 결과
- 세 OS packaged mouse/shortcut/menu evidence 상태
- WebView hardware 전달이나 후속 `UX-011` Forward처럼 남은 범위
