# Research: Cursor Navigation History

## Decision 1: 순수 bounded history와 App 소유권

**Decision**: navigation history는 `past` 최대 100개, 별도의 `current`, 선택적인 restore
reservation을 가진 순수 TypeScript state machine으로 만든다. `App.tsx`가 한 instance를 소유하고
compare/merge component는 capture/restore adapter만 제공한다.

**Rationale**: history가 component별로 흩어지면 pane 전환과 folder/Git 항목 전환의 순서를 하나로
유지할 수 없다. 순수 state machine은 eviction, stale skip, 중복 방지, 성공 후 소비를 DOM 없이
결정적으로 검증할 수 있다.

**Alternatives considered**:

- Monaco undo stack 사용: text edit history이며 view navigation identity와 수명이 달라 기각.
- React state에 whole compare/merge session 저장: session DTO가 file content를 포함하고 stale/data-loss
  위험이 있어 기각.
- browser history 사용: 화면 이탈과 dirty guard를 우회할 수 있어 기각.

## Decision 2: Monaco whole view state 대신 최소 좌표를 명시적으로 저장

**Decision**: cursor line/column, top visible line, 그 line 위의 pixel offset, horizontal scroll만
capture한다. restore 시 model의 `validatePosition`과 line count로 clamp하고 scroll 위치를 설정한 뒤
focus한다. Monaco `saveViewState`는 사용하지 않는다.

**Rationale**: whole view state에는 selection, folding, contribution state 등 UX-009 범위를 넘어서는
값이 포함될 수 있다. 명시적 좌표는 privacy allowlist와 `text/undo/dirty 불변` 계약을 검토하기 쉽다.

**Alternatives considered**:

- line number만 저장: 긴 line과 viewport 문맥을 복원하지 못해 기각.
- 전체 `ICodeEditorViewState` 저장: 범위와 직렬화 가능 field가 과도해 기각.
- 주변 text anchor 저장: content를 history에 넣으므로 기각.

참조: [Monaco `ICodeEditor` API](https://microsoft.github.io/monaco-editor/typedoc/interfaces/editor_editor_api.editor.ICodeEditor.html)

## Decision 3: 모든 cursor event가 아니라 의미 있는 origin을 기록

**Decision**: app-owned F7/F8 이동, conflict 선택, pane focus 전환, 다른 review 항목 열기 직전에는
현재 snapshot을 commit한다. Monaco Find/Go to line, page jump, distant click처럼 app 밖에서 생기는
비인접 explicit cursor jump는 cursor event의 reason/source와 이전 좌표를 이용해 이전 snapshot을
commit한다. typing, content change 뒤 cursor 이동, 같은/인접 caret 이동, scroll-only는 current만
갱신하고 past를 늘리지 않는다.

**Rationale**: 모든 cursor 위치를 넣으면 Back이 문자 단위 이동으로 오염된다. 반대로 app command만
보면 Monaco 자체 Find/Go to line을 놓친다. 명시 command + 보수적인 non-adjacent classifier가 두
경로를 함께 다룬다.

**Alternatives considered**:

- debounce timer만 사용: 빠른 의미 이동과 느린 typing을 안정적으로 구분하지 못해 기각.
- cursor line이 바뀔 때마다 기록: 인접 arrow/page review가 과도하게 쌓여 기각.
- F7/F8만 기록: Find, pane focus, review item 전환을 놓쳐 기각.

## Decision 4: restore는 peek/reserve/commit의 2-phase transaction

**Decision**: Back은 candidate를 pop하기 전에 peek하고 reservation을 만든다. mounted restore 또는
async reopen + matching mount restore가 성공해야 pop을 commit한다. stale candidate만 명시적으로
discard하며 blocked, user-cancelled, I/O failure, newer request는 candidate를 소비하지 않는다.

**Rationale**: async open 전에 pop하면 취소나 실패 때 사용자가 돌아갈 위치를 잃는다. reservation은
빠른 반복 입력과 mount race에서도 같은 항목이 두 번 소비되는 일을 막는다.

**Alternatives considered**:

- 먼저 pop한 뒤 실패 시 push-back: concurrent cursor event와 순서를 뒤집을 수 있어 기각.
- async 중 모든 history 복사: content-free metadata라도 상태 분기가 늘고 필요하지 않아 기각.

## Decision 5: content-free generation identity만 cross-document restore에 사용

**Decision**: direct file compare/merge는 runtime session token + model revision으로 mounted target만
복원한다. folder review는 current review token + scan generation + normalized relative item key를,
Git review는 repository session ID + generation + opaque path/request key를 사용한다. display path,
비슷한 이름, Monaco URI, whole session DTO는 identity가 아니다.

**Rationale**: path 문자열이 같아도 rescan, revision pair, side swap, Git generation이 다르면 다른
document다. 현재 backend가 검증한 opaque/generation 계약을 재사용해야 stale target을 다른 파일로
대체하지 않는다.

**Alternatives considered**:

- absolute/display path만 비교: stale generation과 non-UTF-8 Git identity를 구분하지 못해 기각.
- Monaco model URI 사용: 현재 URI에는 folder/Git session generation이 완전히 포함되지 않아 기각.
- content hash 저장/재계산: file I/O와 content-derived metadata를 불필요하게 추가해 기각.

## Decision 6: dirty same-document는 허용하고 dirty cross-document는 차단

**Decision**: 같은 mounted document에서는 Monaco view만 바꾸므로 dirty 여부와 무관하게 restore한다.
현재 dirty document를 닫아야 하는 cross-document candidate는 history를 소비하지 않고 차단한다.
자동 save, discard prompt 자동 승인, hidden live-session cache는 추가하지 않는다.

**Rationale**: 현재 App은 active compare/merge session 하나만 보관한다. 다른 항목을 열면 dirty model을
안전하게 계속 보존할 독립 workspace가 없으므로 무조건 복원은 FR-007과 no-surprise-write 원칙을
위반한다.

**Alternatives considered**:

- 기존 화면 이탈 `onBack`/dirty-close dialog 재사용: cursor Back이 화면 종료 command가 되고 자동
  discard 흐름을 만들 수 있어 기각.
- 100개 live Monaco model/content cache 추가: content persistence 범위와 multi-session 설계를 크게
  확장하므로 `TXT-011` 이전에는 기각.
- 자동 save: 명시적 사용자 write 원칙을 위반해 기각.

## Decision 7: 입력은 `navigateEditorBack` 한 command로 수렴

**Decision**: 기존 화면 이탈 callback과 이름부터 다른 `navigateEditorBack` AppCommandId를 만든다.
native menu, platform shortcut, DOM pointer가 source metadata와 함께 같은 App handler를 호출한다.
App이 modal/native-dialog/dirty/in-flight gate와 status를 한 번만 적용한다.

**Rationale**: 현재 command handling이 App와 view에 분산돼 있다. 이 기능만큼은 한 handler로 수렴해야
empty history가 Home/previous mode fallback을 실행하거나 dialog를 우회하지 않는다.

**Alternatives considered**:

- 기존 toolbar `onBack` 재사용: session close 의미여서 기각.
- view별 Back handler: history 순서와 modal gate가 달라질 수 있어 기각.
- OS global shortcut/hook: app 밖 입력을 수집하고 platform security surface를 넓혀 기각.

## Decision 8: OS는 compile target이 결정하고 선택 UI를 만들지 않음

**Decision**: native menu accelerator는 Rust compile target으로 macOS `Ctrl+-`, Windows/Linux
`Alt+Left`를 선택한다. DOM shortcut matcher는 `specs/001-git-snapshot-integration/tasks.md` T084가
제공하는 authoritative packaged-runtime platform DTO 또는 test-injected 값만 사용한다. UX-009는
두 번째 `runtime_platform` command나 OS selector를 만들지 않는다.

**Rationale**: OS는 app이 이미 알고 있는 runtime fact다. 수동 선택은 표시와 실제 accelerator가
엇갈릴 수 있고 사용자가 교정할 이유가 없다.

**Alternatives considered**:

- Settings의 OS selector 재사용/추가: 신뢰 가능한 runtime 값을 사용자에게 중복 입력시켜 기각.
- UX-009 전용 platform command 추가: T084의 authoritative runtime source와 충돌하므로 기각.
- 모든 OS shortcut을 동시에 등록: Monaco/browser/text input collision을 만들 수 있어 기각.
- `Cmd+-`로 변경: 명세와 UX keyboard map의 macOS `Ctrl+-` 계약과 달라 기각.

## Decision 9: hardware Back은 WebView DOM button 3 경로와 packaged evidence 사용

**Decision**: window capture 단계의 pointer/mouse event에서 X1 Back인 `button === 3`을 한 번만 command로
변환하고 관련 `auxclick` default navigation을 막는다. X2/Forward인 button 4는 command로 변환하지
않는다. native accelerator와 mouse driver mapping이 같은 gesture를 이중 전달하면 서로 다른 source의
짧은 중복만 제거한다.

**Rationale**: Tauri public window event는 portable mouse-button event를 제공하지 않는다. DOM
Pointer Events의 표준 button mapping이 가장 좁은 cross-platform 경로지만 WebView별 전달 여부는
실제 package에서 검증해야 한다.

**Alternatives considered**:

- Tauri `on_window_event`: 현재 public event에 XButton 입력이 없어 기각.
- platform별 WebView/native message hook: dependency와 unsafe/platform surface가 커져 초기 범위에서
  기각. packaged smoke 실패가 확인될 때 별도 issue/ADR로 재검토한다.
- pointerdown과 mousedown 모두에서 command 실행: 한 물리 입력을 두 번 소비할 수 있어 기각.

참조: [W3C Pointer Events 3 button mapping](https://www.w3.org/TR/pointerevents3/),
[Tauri window menu guide](https://v2.tauri.app/learn/window-menu/)

## Decision 10: native menu enabled state는 좁은 boolean command로 동기화

**Decision**: Navigate menu에 stable ID의 Back item을 initial disabled로 만들고,
`set_editor_navigation_back_enabled(enabled: bool)`만 Rust로 보낸다. App은 유효 candidate,
current mode, dirty cross-document, modal/native-dialog, in-flight 상태가 바뀌어 boolean이 달라질 때만
호출한다.

**Rationale**: history와 dirty state는 UI가 소유하지만 native menu item은 Rust가 생성한다. boolean
allowlist command면 path/content를 native 경계로 보내지 않고 visible capability와 handler를 맞출 수
있다.

**Alternatives considered**:

- menu를 항상 enabled: no-op command와 FR-013 불일치를 만들어 기각.
- history 전체를 Rust에 복제: Monaco/session state를 중복 소유하고 privacy surface를 늘려 기각.
- broad menu mutation command: 임의 menu ID/label/accelerator 변경이 가능해 기각.

## Decision 11: 새 UI test runtime 없이 pure adapter와 packaged smoke를 병행

**Decision**: history, input gate/dedupe, identity validator, Monaco capture/restore를 순수 함수와 작은
interface로 추출해 Vitest fake editor로 검증한다. component SSR/static contract test를 유지하고,
실제 X1 전달과 native accelerator는 세 OS packaged manual smoke로 증명한다.

**Rationale**: 현재 repo는 jsdom/testing-library에 의존하지 않는다. 이 기능 때문에 큰 test stack을
추가하지 않아도 핵심 상태 전이는 자동화할 수 있지만 WebView hardware 전달은 unit test로 대체할 수
없다.

**Alternatives considered**:

- jsdom 의존성 추가: native menu/WebView 입력 증거를 주지 못하면서 dependency만 늘려 기각.
- manual test만 수행: eviction, race, privacy regression을 반복 검증할 수 없어 기각.
- unit test만 수행: 실제 mouse X1 및 packaged accelerator 전달을 증명하지 못해 기각.

## Decision 12: folder cross-item reopen에는 cancellable text read를 보강

**Decision**: 현재 `openFolderEntry`의 `readTextFile` `Promise.all`은 navigation restore에 그대로
재사용하지 않는다. `files.rs`의 기존 size/binary/encoding/EOL/final-newline decode policy를 공유하는
folder-review 전용 pair command `read_folder_review_text_pair(request, job_id)`와 idempotent cancel
command를 추가한다. request는 current roots, normalized relative path, 각 side의 `regularFile|missing`
expectation을 받고 Rust가 containment, symlink/non-regular, 양쪽 상태를 다시 검증한 뒤 all-or-nothing으로
반환한다. history에는 path/root/request가 아니라 review token, generation, relative item key만 유지한다.

**Rationale**: 현재 folder scan만 `cancel_folder_scan`을 지원하고 개별 text read에는 cancel token이
없다. 100ms를 넘길 수 있는 cross-item reopen이 user cancellation/newer request를 무시하면 SR-003과
constitution의 async stale-result 규칙을 충족할 수 없다.

**Alternatives considered**:

- 기존 `readTextFile` Promise가 끝날 때까지 기다린 뒤 결과만 무시: stale 화면 전환은 막아도 실제
  작업 취소와 빠른 복구를 제공하지 못해 기각.
- history에 absolute left/right path를 저장: rescan identity와 privacy allowlist를 약화해 기각.
- 일반 `read_text_file`에 optional job ID 두 개를 추가: left/right 사이 상태 변화와 partial success를
  하나의 transaction으로 검증하기 어렵고 기존 모든 file-open 계약을 넓혀 기각.
- folder 전용 broad filesystem permission: 기존 Rust command boundary를 우회하므로 기각.
- UX-009 전체를 Git만 지원: spec의 folder live review acceptance를 충족하지 못해 기각.

Git cross-item reopen은 기존 caller-owned job ID를 재사용하지만, `specs/001-git-snapshot-integration/tasks.md`
T081/T082의 cancel 및 response-identity guard가 완료됐는지 구현 전에 확인한다. 미완료면 UX-009에서
Git runner를 중복 수정하지 않고 해당 dependency를 먼저 완료한다.

## Primary Repository References

- `docs/01_PRD.md`
- `docs/02_ARCHITECTURE.md`
- `docs/04_BACKLOG.md` — `UX-009`, `FND-005`
- `docs/07_TEST_PLAN.md`
- `docs/08_UX_SPEC.md`
- `docs/14_PRODUCT_GAP_ROADMAP.md` — `FND-005R`, `UX-009`
