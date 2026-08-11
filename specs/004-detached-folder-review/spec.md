# Feature Specification: Detached Folder Review

**Feature Branch**: Not created — specification added on `main`

**Issue**: `FOL-020`

**Created**: 2026-08-07

**Status**: Source implemented — convergence and packaged verification pending

**Input**: User description: "폴더 비교 목록은 한 번 클릭하면 선택만 하고, 일반 파일을 더블클릭했을 때 실제 새 창에서 비교를 열어 목록과 파일 비교를 함께 볼 수 있게 한다."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 더블클릭으로 독립 비교 창 열기 (Priority: P1)

사용자는 폴더 비교 목록에서 한 번 클릭해 행을 선택하고 세부 정보를 확인한다. 일반 텍스트 파일 행을
더블클릭하거나 키보드로 같은 기본 동작을 실행하면 폴더 목록은 그대로 남고, 해당 파일 쌍의 읽기 전용
비교가 실제 운영체제의 별도 창에 열린다.

**Why this priority**: 단일 클릭만으로 문맥이 바뀌는 불편을 없애고, 많은 파일을 검토할 때 목록과
내용을 동시에 보며 다음 대상을 고르는 핵심 흐름이다.

**Independent Test**: 폴더 결과에서 regular text 행을 한 번 클릭해 새 창이 생기지 않음을 확인한 뒤,
같은 행을 더블클릭하고 원래 목록 창과 독립적으로 이동·크기 조절 가능한 읽기 전용 비교 창이 하나
열리는지 확인한다.

**Acceptance Scenarios**:

1. **Given** 비교 가능한 일반 파일 행, **When** 사용자가 한 번 클릭하면, **Then** 해당 행만 선택되고 새 창이나 파일 내용 읽기가 시작되지 않는다.
2. **Given** 선택 여부와 관계없이 비교 가능한 일반 파일 행, **When** 사용자가 더블클릭하면, **Then** 원래 폴더 목록을 유지한 채 해당 상대 경로의 읽기 전용 비교가 별도 창에 열린다.
3. **Given** 키보드로 행에 초점을 둔 상태, **When** 사용자가 `Enter`를 누르면, **Then** 더블클릭과 동일한 별도 비교 창 동작이 실행된다.
4. **Given** 폴더 행, **When** 사용자가 더블클릭하거나 `Enter`를 누르면, **Then** 새 비교 창을 만들지 않고 해당 폴더만 접거나 펼친다.
5. **Given** 한쪽에만 있는 안전한 일반 텍스트 파일, **When** 사용자가 파일을 열면, **Then** 존재하는 파일과 명시적인 missing 빈 쪽이 읽기 전용 비교 창에 표시된다.
6. **Given** 폴더 결과가 표시된 상태, **When** 사용자가 목록을 보기 시작하면, **Then** 단일 클릭은 선택만 하고 더블클릭/`Enter`는 파일 열기 또는 폴더 접기·펼치기이며 `Space`는 세부 정보라는 규칙이 tooltip 없이 항상 보인다.

---

### User Story 2 - 파일의 경로 문맥을 잃지 않기 (Priority: P1)

사용자는 새 비교 창의 상단에서 파일 이름뿐 아니라 이 파일이 어느 상대 폴더에 있고 양쪽 루트가
무엇인지 즉시 이해한다. 폴더 목록을 접거나 다른 행을 선택해도 이미 열린 창의 경로 문맥은 사라지지
않는다.

**Why this priority**: 대용량 폴더에서는 같은 이름의 파일이 여러 폴더에 반복된다. 독립 창이 basename만
보여주면 사용자가 지적한 경로 가독성 문제가 새 창에서도 반복된다.

**Independent Test**: 서로 다른 하위 폴더에 같은 basename의 파일 두 쌍을 열어 각 창의 제목과 상단
경로 영역만으로 상대 경로와 좌우 루트를 구분할 수 있는지 확인한다.

**Acceptance Scenarios**:

1. **Given** `packages/api/config.json`을 연 상태, **When** 새 창이 표시되면, **Then** 상단에는 `config.json`, 상위 상대 폴더 `packages/api`, 전체 상대 경로와 좌우 루트가 폴더 문맥 우선 순서로 표시된다.
2. **Given** 서로 다른 폴더의 같은 basename 파일 두 개, **When** 각각 별도 창으로 열면, **Then** 운영체제 창 제목과 앱 상단 경로만으로 두 대상을 구별할 수 있다.
3. **Given** 원래 목록에서 부모 폴더를 접거나 다른 행을 선택한 상태, **When** 열린 비교 창을 다시 보면, **Then** 처음 검증된 상대 경로와 좌우 루트 문맥이 그대로 남아 있다.
4. **Given** 한쪽 파일이 missing인 상태, **When** 비교 창을 열면, **Then** 어느 쪽이 없는지와 존재하는 쪽의 루트·상대 경로가 명확히 표시된다.

---

### User Story 3 - 여러 파일을 독립적으로 검토하기 (Priority: P2)

사용자는 서로 다른 파일 여러 개를 각각 별도 창에 열고 창 전환 기능으로 비교한다. 이미 열려 있는 같은
대상을 다시 더블클릭하면 중복 창을 만들지 않고 기존 창을 앞으로 가져온다.

**Why this priority**: 새 창의 실질적 가치는 목록을 유지하면서 여러 검토 문맥을 동시에 보존하는 데 있다.
무제한 중복 창은 메모리 사용과 대상 혼동을 키우므로 결정적인 재사용 규칙이 필요하다.

**Independent Test**: 서로 다른 파일 세 개를 열어 세 창이 독립적으로 유지되는지 확인하고, 그중 하나를
다시 더블클릭해 창 수가 늘지 않고 기존 창만 활성화되는지 확인한다.

**Acceptance Scenarios**:

1. **Given** 비교 가능한 서로 다른 세 파일 행, **When** 사용자가 각각 더블클릭하면, **Then** 원래 폴더 목록 외에 각 파일을 위한 별도 비교 창 세 개가 열린다.
2. **Given** 현재 폴더 비교 실행에서 한 파일의 창이 이미 열린 상태, **When** 같은 행을 다시 더블클릭하면, **Then** 새 창을 추가하지 않고 기존 창을 복원·활성화한다.
3. **Given** 한 비교 창에서 스크롤과 diff 위치를 이동한 상태, **When** 다른 비교 창을 조작하면, **Then** 첫 창의 스크롤, 선택, 현재 diff 위치는 바뀌지 않는다.
4. **Given** 동시 비교 창이 안전 한도에 도달한 상태, **When** 새로운 파일을 열려 하면, **Then** 기존 창을 임의로 닫지 않고 일부 창을 닫은 뒤 다시 시도하라는 행동 가능한 메시지를 표시한다.

---

### User Story 4 - 창 수명과 파일 오류를 예측하기 (Priority: P2)

사용자는 폴더 화면에서 다른 모드로 이동해도 이미 열린 비교 창을 계속 검토할 수 있다. 창을 닫으면 그
창의 session-only 자료가 제거된다. 파일이 열 수 없는 형식이거나 외부에서 바뀌면 앱은 잘못된 내용을
보여주지 않고 해당 창에서 행동 가능한 상태를 표시한다.

**Why this priority**: 여러 운영체제 창은 parent 화면과 다른 수명을 가지므로 닫기, 재열기, 외부 변경,
오류의 일관된 규칙 없이는 stale 내용과 메모리 누수가 생긴다.

**Independent Test**: 비교 창을 연 뒤 원래 창에서 Home으로 이동하고, 파일을 외부 수정하거나 삭제하고,
창을 닫고 같은 파일을 다시 열어 각 단계의 수명·오류·재검증 규칙을 확인한다.

**Acceptance Scenarios**:

1. **Given** 별도 비교 창이 열린 상태, **When** 원래 창에서 Home 또는 다른 앱 모드로 이동하면, **Then** 별도 비교 창은 사용자가 닫을 때까지 현재 읽기 전용 snapshot과 경로 문맥을 유지한다.
2. **Given** 비교 창을 사용자가 닫은 상태, **When** 같은 항목을 다시 더블클릭하면, **Then** 이전 창 상태를 잘못 재사용하지 않고 현재 파일을 다시 검증해 새 창을 연다.
3. **Given** 비교 창을 여는 동안 파일이 삭제·교체·종류 변경된 상태, **When** 안전 검증이 완료되면, **Then** stale 내용을 열지 않고 재스캔 또는 대상 확인을 안내하는 오류를 해당 창에 표시한다.
4. **Given** 이미 열린 파일이 외부에서 변경된 상태, **When** 사용자가 창을 다시 활성화하거나 명시적으로 새로고침하면, **Then** 현재 snapshot을 조용히 바꾸지 않고 변경 사실과 다시 읽기 선택을 표시한다.
5. **Given** 사용자가 주 앱 창을 닫아 앱 종료를 확정한 상태, **When** 종료가 완료되면, **Then** 모든 별도 비교 창과 session-only 내용이 함께 닫히고 남지 않는다.

### Edge Cases

- 빠른 더블클릭이 두 번 전달되거나 mouse와 keyboard 명령이 겹쳐도 같은 대상의 창은 하나만 생긴다.
- 새 창 생성에는 성공했지만 파일 읽기가 실패하면 빈 편집기나 이전 파일 내용을 보여주지 않고 그 창에
  재시도·닫기 가능한 오류 상태를 표시한다.
- 사용자가 파일을 여는 직후 폴더 재스캔을 시작해 generation이 바뀌면 아직 검증되지 않은 open 요청은
  stale로 거절하고, 이미 안전한 snapshot을 받은 독립 창은 그대로 유지한다.
- binary, LFS pointer, 너무 큰 파일, symlink, 특수 파일, 루트 밖으로 벗어난 경로는 텍스트 창으로
  강제해서 열지 않는다.
- case/Unicode 정규화 충돌이 있는 두 행은 같은 창으로 합치지 않고 정확한 현재 행 identity로 구분한다.
- 한쪽 missing인 행이 open 시점에 새로 생겼거나 존재하던 쪽이 사라지면 기대 상태 불일치로 거절한다.
- 모니터가 분리되어 이전 위치를 사용할 수 없으면 새 창이 보이는 현재 작업 영역 안에 나타난다.
- 운영체제 창 열기 실패, 창 focus 실패, owner 창 종료 race는 raw 시스템 오류 대신 재시도 가능한 메시지를
  보여주고 session registry를 누수 없이 정리한다.
- 같은 파일의 창을 최소화한 상태에서 다시 열면 새 창을 만들지 않고 복원한 뒤 앞으로 가져온다.
- 창 제목은 파일 내용, 사용자 텍스트, 해시, 임시 token을 포함하지 않는다.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: 폴더 결과 행의 단일 클릭은 선택과 세부 정보 갱신만 수행하고 파일 읽기, 화면 전환 또는 창 생성을 시작해서는 안 된다.
- **FR-002**: 비교 가능한 regular text 파일 행의 더블클릭과 keyboard `Enter`는 동일한 별도 읽기 전용 비교 창 동작을 실행해야 한다.
- **FR-003**: 폴더 행의 더블클릭과 `Enter`는 접기·펼치기만 수행하고 비교 창을 만들지 않아야 한다.
- **FR-004**: 별도 비교 창이 열려도 원래 폴더 결과, 스캔 진행, 필터, 선택, 접힘 상태는 유지되어야 한다.
- **FR-005**: 비교 창은 파일 이름, 상위 상대 폴더, 전체 상대 경로, 왼쪽 루트, 오른쪽 루트와 한쪽 missing 여부를 상단에서 구분 가능하게 표시해야 한다.
- **FR-006**: 창 제목은 같은 basename의 서로 다른 상대 경로를 구분할 수 있는 최소 폴더 문맥과 앱 이름을 포함해야 한다.
- **FR-007**: 초기 범위의 별도 비교 창은 text 편집, hunk 적용, 좌우 교환, 저장, Save As, sync 적용을 허용하지 않아야 한다.
- **FR-008**: 한쪽에만 있는 regular text 행은 반대쪽을 명시적인 missing 가상 문서로 표시하되 해당 가상 문서를 저장·백업·최근 파일 대상으로 다루지 않아야 한다.
- **FR-009**: 시스템은 현재 폴더 비교 실행과 정확한 행 identity가 일치하는 경우에만 open 요청을 처리하고 portable-normalized 경로가 같은 다른 행으로 대체해서는 안 된다.
- **FR-010**: 같은 live folder review의 같은 행이 이미 열려 있으면 시스템은 중복 창을 만들지 않고 기존 창을 복원하고 활성화해야 한다.
- **FR-011**: 서로 다른 행의 비교 창은 document, diff navigation, scroll, focus, 외부 변경 알림, 오류 상태를 서로 격리해야 한다.
- **FR-012**: 동시에 열린 별도 비교 창은 최대 8개, 열린 창이 보유한 양쪽 source snapshot의 합계는 최대 256MiB로 제한해야 한다. 어느 한도든 초과하면 기존 창을 자동으로 닫거나 내용을 바꾸지 않은 채 사용자가 창을 닫고 다시 시도하도록 안내해야 한다.
- **FR-013**: 비교 창 shell은 open 요청 후 즉시 표시되고 파일 쌍 검증·읽기가 100ms를 넘으면 접근 가능한 loading 상태를 표시해야 한다.
- **FR-014**: 파일 내용은 기존과 같은 all-or-nothing 안전 검증을 통과한 뒤에만 비교 창에 표시되어야 하며 한쪽만 성공한 stale 조합을 렌더링해서는 안 된다.
- **FR-015**: binary, LFS pointer, 크기 한도 초과, symlink, 비정규 파일, root containment 실패, 기대한 side 종류 불일치, 취소, 외부 변경은 행동 가능한 오류 상태로 표시하고 text로 강제 열지 않아야 한다.
- **FR-016**: 원래 폴더 화면의 generation이 open 검증 전에 바뀌면 해당 요청을 stale로 거절해야 하며, 안전한 snapshot을 이미 받은 창은 원래 화면의 이후 navigation과 독립적으로 유지해야 한다.
- **FR-017**: 사용자가 별도 창을 닫으면 해당 창의 session-only 문서, token, navigation, error 상태를 제거하고 같은 항목을 다시 열 때 현재 파일을 재검증해야 한다.
- **FR-018**: 이미 열린 source 파일의 version이 바뀌면 창은 snapshot을 자동 교체하지 않고 외부 변경 알림과 명시적 다시 읽기 선택을 제공해야 한다.
- **FR-019**: 주 앱 창 종료를 사용자가 확정하면 모든 별도 비교 창을 닫고 앱 process의 관련 session-only registry를 정리해야 한다.
- **FR-020**: 창 생성, 파일 읽기, focus, close 각 실패는 다른 열린 창과 원래 폴더 목록을 손상시키지 않고 `{ code, message }` 형태의 행동 가능한 오류로 격리되어야 한다.
- **FR-021**: 폴더 결과는 단일 클릭 선택, 더블클릭/`Enter` 활성화, `Space` 세부 정보 규칙을 영어·한국어에서 항상 보이게 표시하고 결과 table의 접근 가능한 설명과 연결해야 한다.

### Safety, Privacy, and Scope Requirements *(mandatory)*

- **SR-001**: 이 기능은 운영체제 창과 process-memory review session만 만들거나 제거하며 사용자 파일, 폴더, Git 상태, 앱 설정, recent session을 쓰거나 변경해서는 안 된다.
- **SR-002**: 파일 내용, diff 결과, 절대 경로, review token을 URL, 운영체제 창 제목, persistent storage, telemetry, 오류 보고, 기본 로그 또는 network에 넣어서는 안 된다. 경로는 검증된 local UI 본문에서만 표시할 수 있다.
- **SR-003**: 모든 파일 읽기는 좁은 native 경계 안에서 binary, LFS, size, symlink, regular-file, root containment, expected-side, cancellation, external-change 검사를 유지해야 한다. 창별 권한은 읽기 전용 검토에 필요한 최소 범위여야 한다.
- **SR-004**: 별도 창 편집·저장, drag-and-drop으로 대상 교체, 창 간 문서 이동, persistent window/session 복원, 멀티 세션 탭, arbitrary path를 URL로 여는 기능, 폴더 sync 적용은 초기 범위 밖이다.

### Key Entities *(include if feature involves data)*

- **Detached Review Identity**: source folder review token, scan generation, exact row identity, side 기대 상태를 결합해 같은 창의 중복 생성과 stale 대체를 막는 process-only identity다.
- **Detached Review Session**: 검증된 roots/relative path 문맥, 읽기 전용 양쪽 document snapshot, 창 label, lifecycle, 외부 version 기준을 가진 session-only 상태다.
- **Detached Review Window**: 하나의 session만 표시하며 다른 창과 editor/navigation/error 상태를 공유하지 않는 운영체제 창이다.
- **Window Registry**: 최대 8개의 active identity-to-window 관계와 최대 256MiB의 source snapshot budget을 추적하고 focus 재사용, close cleanup, app-exit cleanup을 결정한다.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 비교 가능한 행을 한 번 클릭하는 100회 시험에서 새 창 생성과 파일 내용 읽기 시작은 모두 0건이다.
- **SC-002**: 기준 개발 장비에서 각각 1MiB 이하인 일반 텍스트 파일 쌍을 더블클릭하면 별도 창 shell이 300ms 안에 보이고, 1초 안에 읽기 전용 비교 또는 행동 가능한 오류가 표시된다.
- **SC-003**: 같은 live 행을 100회 연속 더블클릭해도 해당 identity의 창은 정확히 1개이고 마지막 동작 뒤 기존 창이 활성 상태다.
- **SC-004**: 서로 다른 8개 파일을 열고 각 창에서 독립적으로 diff 위치를 이동한 시험에서 다른 창의 scroll, active diff, focus, error 상태가 바뀐 사례는 0건이다.
- **SC-005**: 같은 basename을 가진 서로 다른 하위 경로 8개를 열었을 때 모든 창을 창 제목과 상단 폴더 문맥만으로 올바르게 구분할 수 있다.
- **SC-006**: open 중 rescan, source window navigation, window close, app exit를 각각 100회 반복한 race 시험에서 stale 문서 표시, 중복 창, orphan registry, 종료 후 남은 review content가 모두 0건이다.
- **SC-007**: macOS, Windows, Linux packaged build에서 mouse double-click, keyboard Enter, 창 이동·크기 조절·최소화 복원·focus 재사용·닫기 시나리오를 모두 완료한다.
- **SC-008**: binary, LFS, oversized, symlink, containment failure, expected-side mismatch, 삭제, 외부 변경 fixture에서 잘못된 text 표시와 사용자 파일 변경이 모두 0건이다.
- **SC-009**: 영어·한국어 렌더링 모두에서 단일/더블 클릭 규칙이 목록 위에 보이며 tooltip이나 화면 하단 상태 문구만으로 전달되는 경우가 0건이다.

## Assumptions

- “새창”은 앱 내부 modal이나 탭이 아니라 운영체제에서 독립적으로 이동·크기 조절·최소화할 수 있는 창을 뜻한다.
- 초기 독립 창은 폴더 목록에서 빠르게 검토하기 위한 read-only surface이며 편집·저장은 후속 명시적 기능으로 분리한다.
- 같은 창 재사용 범위는 현재 live folder review의 정확한 row identity이며 다른 scan generation은 같은 경로라도 새 검증 대상으로 본다.
- 한 번 안전하게 읽은 document snapshot은 원래 폴더 화면을 떠나도 열린 창에 남지만, 앱 process를 종료하거나 창을 닫으면 영구 복원 없이 폐기된다.
- 동시 창 8개와 source snapshot 합계 256MiB는 각 창이 독립 editor runtime을 갖는 상황에서 예측 가능한 memory를 위한 초기 hard limit이며 성능 증거가 있으면 별도 결정으로 조정한다.

## Dependencies and Out of Scope *(mandatory)*

- **Dependencies**: `FOL-010` folder-first hierarchy와 click/double-click/Enter contract, existing cancellable `read_folder_review_text_pair` safety contract, `FOL-006R` generation/final-row identity when opening during progressive scan, narrow per-window capability policy, current read-only 2-way compare and external-change notice behavior.
- **Out of scope**: detached editing/save/apply, multi-session tabs (`TXT-011`), persistent window layout/session restore, cross-window drag/drop, arbitrary file picker inside detached windows, 8개 또는 256MiB 한도를 넘는 simultaneous review, automatic reload on source changes, folder sync application.
