# Feature Specification: Cursor Navigation History

**Feature Branch**: Not created — specification added on `main`

**Created**: 2026-07-17

**Status**: Draft

**Input**: User description: "커서 위치를 기억할 수 있는 만큼 기억하고 뒤로 가는 마우스 버튼 혹은 단축키를 누를 때 이전 위치로 이동할 수 있게 한다."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 이전 편집 위치로 돌아가기 (Priority: P1)

사용자는 2-way 비교나 3-way 병합에서 차이·충돌을 따라 이동하거나 다른 pane을 살펴본 뒤,
한 번의 `뒤로 이동`으로 직전에 검토하던 편집 위치로 돌아간다. 여러 번 실행하면 유효한 위치를
최신순으로 계속 거슬러 올라간다.

**Why this priority**: 긴 파일과 많은 차이·충돌을 검토할 때 이전 문맥을 다시 찾는 시간을 줄이는
핵심 가치이며, 파일 내용이나 비교 결과를 바꾸지 않는 작은 read-only 탐색 기능이다.

**Independent Test**: 한 비교 세션에서 좌우 pane과 여러 line을 차례로 방문한 뒤 `뒤로 이동`을
반복해 pane, cursor line/column, 화면 위치가 역순으로 복원되는지 확인하면 독립적으로 검증된다.

**Acceptance Scenarios**:

1. **Given** 사용자가 왼쪽 pane의 한 위치에서 다음 차이로 이동한 상태, **When** `뒤로 이동`을 한 번 실행하면, **Then** 이전 pane과 cursor 위치 및 주변 화면 문맥이 복원된다.
2. **Given** 서로 다른 유효한 위치를 세 곳 이상 방문한 상태, **When** `뒤로 이동`을 반복하면, **Then** 각 위치가 중복 없이 최신순으로 복원된다.
3. **Given** editable Result에 저장하지 않은 변경이 있는 상태, **When** 이전 위치로 이동하면, **Then** Result 내용과 undo/redo history는 바뀌지 않고 cursor와 화면 위치만 바뀐다.

---

### User Story 2 - 현재 검토 흐름의 이전 위치 복원 (Priority: P2)

사용자는 folder 또는 Git 검토 흐름에서 다른 text 항목을 열어 이동한 뒤에도, 이전 항목이 현재
세션에서 안전하게 다시 식별될 수 있으면 그 항목의 마지막 편집 위치로 돌아간다. 대상이 사라졌거나
세션 generation이 바뀌었다면 앱은 임의의 다른 파일을 열지 않고 그 기록을 건너뛴다.

**Why this priority**: 실제 대규모 검토에서는 한 파일 안보다 파일 사이를 오가는 일이 많지만,
stale path나 외부 변경을 잘못 복원하지 않는 안전 조건이 먼저 필요하다.

**Independent Test**: 같은 live folder/Git review에서 두 text 항목의 위치를 방문한 뒤 이전 항목으로
돌아가고, 그중 한 대상을 삭제·새로고침한 경우에는 stale 항목을 건너뛰는지 확인한다.

**Acceptance Scenarios**:

1. **Given** 같은 live review에서 두 text 항목을 순서대로 연 상태, **When** `뒤로 이동`을 실행하면, **Then** 이전 항목을 현재 세션의 검증된 identity로 열고 마지막 위치를 복원한다.
2. **Given** 이전 기록의 파일이 사라지거나 repository/folder generation이 바뀐 상태, **When** `뒤로 이동`을 실행하면, **Then** stale 기록을 건너뛰고 다음 유효한 기록을 찾거나 이동할 수 없음을 알린다.
3. **Given** binary, symlink, submodule 또는 더 이상 text로 열 수 없는 대상, **When** 이전 기록을 복원하려 하면, **Then** 대상을 text로 강제해서 열지 않고 기록을 무효화한다.
4. **Given** 현재 항목에 저장하지 않은 변경이 있고 이전 위치가 다른 항목에 있는 상태, **When** `뒤로 이동`을 실행하면, **Then** 현재 항목과 history를 그대로 유지하고 저장 또는 변경 취소 뒤 다시 시도하라고 알린다.

---

### User Story 3 - 마우스와 키보드의 동일한 뒤로 이동 (Priority: P2)

사용자는 마우스의 hardware Back 버튼 또는 운영체제별 단축키로 같은 탐색 명령을 실행한다.
키보드만 사용하는 경우에도 현재 이동 가능 여부와 이동 결과를 이해할 수 있다.

**Why this priority**: 사용자가 요청한 직접 입력 방식이며, 하나의 명령 계약을 공유해야 입력 장치와
운영체제에 따라 동작이 달라지지 않는다.

**Independent Test**: 동일한 navigation history에 대해 hardware Back과 Windows/Linux의
`Alt+Left`, macOS의 `Ctrl+-`를 각각 실행하고 같은 목적지와 상태를 얻는지 확인한다.

**Acceptance Scenarios**:

1. **Given** 유효한 이전 위치가 있는 상태, **When** hardware Back 버튼을 누르면, **Then** `뒤로 이동` 명령이 한 번만 실행된다.
2. **Given** 유효한 이전 위치가 있는 상태, **When** Windows/Linux에서 `Alt+Left` 또는 macOS에서 `Ctrl+-`를 누르면, **Then** hardware Back과 동일한 위치로 이동한다.
3. **Given** 유효한 이전 위치가 없는 상태, **When** 어느 입력으로든 명령을 실행하면, **Then** 화면 mode, 파일, cursor, 편집 내용은 바뀌지 않고 이동할 위치가 없음을 비침투적으로 알린다.
4. **Given** modal dialog나 dirty-close 확인이 입력을 소유한 상태, **When** Back 입력을 실행하면, **Then** dialog를 우회하거나 확인되지 않은 화면 전환을 하지 않는다.

### Edge Cases

- 같은 pane에서 line/column 차이가 각각 1 이하이고 viewport의 top line 차이가 1 이하,
  수평/수직 pixel offset 차이가 각각 2px 이하인 위치가 연속으로 기록되면 한 항목으로 합친다.
- 일반적인 문자 입력이나 한 칸씩 cursor를 움직인 모든 순간을 별도 history 항목으로 만들지 않는다.
- 기록을 복원하는 동안 발생한 cursor event는 새로운 history 항목으로 다시 기록하지 않는다.
- 문서 편집으로 이전 line/column이 범위를 벗어나면 같은 문서 identity인 경우 가장 가까운 유효 위치로 제한하고, identity가 달라졌으면 기록을 폐기한다.
- 복원 cursor가 현재 diff hunk 또는 conflict range 안에 있으면 active decoration을 그 현재 range에 맞추되, hunk/conflict index 자체는 history에 저장하지 않는다.
- reload, repository refresh, folder rescan, side swap으로 document identity가 바뀌면 이전 identity를 새 문서에 잘못 적용하지 않는다.
- 빠르게 Back 입력을 반복해도 한 기록을 중복 소비하거나 순서를 뒤집지 않는다.
- hardware Back의 한 물리 입력이 서로 다른 입력 source로 중복 전달돼도 한 번만 실행하며,
  timestamp가 없는 입력을 추측으로 합치지 않는다.
- history limit에 도달하면 가장 오래된 위치부터 제거하며 현재 위치는 항상 복원 가능 상태로 유지한다.
- 외부 Git tool 세션에서도 Back은 cursor navigation만 수행하며 app 종료, Git index 변경, save를 실행하지 않는다.
- 같은 dirty document 안의 위치 복원은 허용하지만, 현재 구조에서 dirty document를 닫아야 하는 cross-document 복원은 확인되지 않은 변경을 버리지 않도록 차단하고 history를 소비하지 않는다.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: 시스템은 앱 process가 실행되는 동안 최근의 의미 있는 text 편집 위치를 시간순의 bounded navigation history로 유지해야 한다.
- **FR-002**: 한 navigation location은 현재 workflow/session identity, document identity, editor pane, cursor line/column, viewport anchor를 구분할 수 있어야 하며 파일 내용을 포함해서는 안 된다.
- **FR-003**: 시스템은 다음/이전 차이, 다음/이전 충돌, 검색 결과, 다른 text 항목 열기, editor 이탈처럼 문맥을 크게 바꾸는 이동 직전 위치를 기록해야 한다.
- **FR-004**: 시스템은 일반 문자 입력과 인접 cursor 이동을 매번 별도 기록하지 않고 동일·인접 위치를 합쳐 Back history가 미세한 cursor step으로 오염되지 않게 해야 한다.
- **FR-005**: navigation history는 현재 위치와 별도로 최근 100개의 이전 위치를 보존하고 한도를 넘으면 가장 오래된 위치부터 제거해야 한다.
- **FR-006**: 사용자는 hardware Back 버튼, Windows/Linux `Alt+Left`, macOS `Ctrl+-`로 동일한 `뒤로 이동` 명령을 실행할 수 있어야 한다.
- **FR-007**: `뒤로 이동`은 목적지의 document/pane/cursor/viewport/focus를 복원하되 text, selection content, undo/redo history, dirty 상태를 바꾸지 않아야 한다.
- **FR-008**: 시스템은 history 복원 중 발생하는 focus/cursor event를 새 navigation으로 기록하지 않아야 한다.
- **FR-009**: 대상 document가 현재 세션에서 유효하지 않으면 해당 기록을 건너뛰고 다음 유효한 이전 기록을 찾으며, 다른 path나 비슷한 이름의 파일로 대체해서는 안 된다.
- **FR-010**: 같은 live folder/Git review에서 이전 text 대상을 다시 열어야 할 때는 현재 generation과 검증된 identity가 모두 일치하는 경우에만 복원해야 한다.
- **FR-011**: 이전 위치가 없거나 모두 stale이면 화면을 바꾸지 않고 이동할 위치가 없음을 접근 가능한 상태 메시지로 알려야 한다.
- **FR-012**: modal dialog, native file dialog, dirty-close confirmation이 활성화된 동안 navigation Back은 이를 우회해서는 안 된다.
- **FR-013**: 현재 mode에서 navigation Back을 사용할 수 있을 때만 menu/command 상태가 활성화되고, 표시되는 shortcut과 실제 handler가 일치해야 한다.
- **FR-014**: history 대상 line/column이 같은 document의 현재 범위를 벗어나면 가장 가까운 유효 위치로 제한하되, document identity가 달라진 경우에는 복원하지 않아야 한다.
- **FR-015**: 연속된 Back 입력은 하나의 명령당 history 항목을 최대 하나만 소비하고 항상 결정적인 역순을 유지해야 한다.
- **FR-016**: 같은 document 안의 Back은 dirty 상태와 관계없이 cursor/viewport만 복원할 수 있어야 하며, 다른 document를 열기 위해 현재 dirty document를 닫아야 하는 Back은 현재 문서와 history를 변경하지 않은 채 차단해야 한다.
- **FR-017**: 다른 document를 다시 여는 복원이 100ms 안에 끝나지 않으면 시스템은 100ms 안에 접근 가능한 복원 중 상태를 표시하고 기존의 취소·generation·stale-result 무시 경로로 작업을 완료해야 한다.

### Safety, Privacy, and Scope Requirements *(mandatory)*

- **SR-001**: 이 기능은 cursor/navigation memory만 변경하며 사용자 파일, Git index/HEAD/refs/working tree, 앱 설정, recent session을 쓰거나 변경해서는 안 된다.
- **SR-002**: navigation history와 document identity는 memory에만 유지하고 앱 종료 후 남기지 않아야 한다. 파일 내용, diff, merge Result, cursor 주변 text를 persistent storage, log, telemetry, error report 또는 network로 보내서는 안 된다.
- **SR-003**: binary, symlink, submodule, LFS pointer, path containment 실패, stale generation, 외부 변경은 text 위치로 복원하지 않는다. 재열기가 필요한 local 작업은 취소와 stale-result 무시를 지원해야 한다.
- **SR-004**: app 재시작 후 history 복원, browser page history, OS 전역 mouse hook, closed session의 무조건 재열기, cursor 위치 동기화, 자동 save, history forward는 이 기능의 초기 범위 밖이다.

### Key Entities *(include if feature involves data)*

- **Navigation Location**: live workflow와 document를 식별하는 값, editor pane, cursor line/column, viewport anchor, 기록 순서를 가진 session-only 위치다. 파일 내용이나 cursor 주변 text는 포함하지 않는다.
- **Navigation History**: 유효한 Navigation Location을 최대 100개 보관하고 중복 병합, stale 폐기, 역순 소비를 담당하는 현재 process의 기록이다.
- **Document Identity**: 같은 path처럼 보여도 reload/generation/side가 다른 대상을 구분하며, 이전 위치를 잘못된 문서에 적용하지 않기 위한 identity다.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 이미 mount된 editor의 유효한 이전 위치는 mouse 또는 keyboard 한 번으로 100ms 안에 pane, cursor line/column, viewport 문맥이 복원된다. 다른 text 항목을 다시 읽어야 하면 100ms 안에 복원 중 상태가 표시되고 기존 비동기 읽기 경로가 완료된 뒤 같은 문맥이 복원된다.
- **SC-002**: 서로 다른 위치 101곳을 순서대로 방문한 뒤 100회 Back을 실행해도 이전 100곳이 중복·역전 없이 최신순으로 복원된다.
- **SC-003**: 101번째 이전 위치를 기록하면 가장 오래된 history 위치만 제거되고 현재 위치와 최근 이전 위치 100개가 유지된다.
- **SC-004**: stale/삭제/비-text 위치가 섞인 50개 기록에서 Back을 반복해도 잘못된 파일이 열린 사례, crash, 편집 내용 변경이 0건이다.
- **SC-005**: keyboard-only와 hardware Back 각각으로 2-way compare와 3-way merge의 이전 위치 복원 시나리오를 100% 완료할 수 있다.
- **SC-006**: 앱 종료 후 persistent storage, cache, log를 검사했을 때 navigation history, cursor 위치, Git 임시 path, 파일 내용이 남은 사례가 0건이다.

## Assumptions

- “기억할 수 있는 만큼”은 예측 가능한 memory 사용을 위해 최근 100개 위치로 제한한다.
- 기록 단위는 모든 cursor movement가 아니라 사용자가 문맥을 잃을 수 있는 의미 있는 이동이다.
- 초기 릴리스의 keyboard shortcut은 Windows/Linux `Alt+Left`, macOS `Ctrl+-`이며 shortcut registry에서 충돌 여부를 검증한다.
- 다른 파일의 위치 복원은 현재 live review session에서 안전하게 재식별 가능한 대상에 한정한다.
- 같은 document의 편집으로 line 수가 바뀐 경우에는 가장 가까운 유효 위치로 이동하는 것이 stale 위치를 완전히 버리는 것보다 예측 가능하다.
- 초기 editor pane 범위는 2-way compare의 left/right와 3-way merge의 editable Result다. read-only BASE/OURS/THEIRS pane과 read-only Git merge preview Result의 독립 cursor history는 후속 확장으로 둔다.

## Dependencies and Out of Scope *(mandatory)*

- **Dependencies**: `UX-009` issue 정의, `FND-005` command registry/native menu parity, 기존 `TXT-002` diff navigation, `MRG-003` conflict navigation, folder review 전용 cancellable pair-read 계약, Git T081/T082 caller-owned cancel/response-identity guard, T084 authoritative runtime platform DTO.
- **Out of scope**: app 재시작 간 위치 복원, persistent cursor bookmarks, history forward, arbitrary closed-file reopen, browser URL history, OS 전역 mouse event 수집, navigation history 편집 UI, 파일 내용 기반 위치 추론.
