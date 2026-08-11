# 08. UX Specification

## 1. 설계 목표

비교 도구에서 중요한 것은 화려함보다 **현재 어디가 다른지, 어느 쪽이 선택됐는지, 저장하면 무엇이 바뀌는지**가 즉시 보이는 것이다.

## 2. 시작 화면

세 개의 주 행동만 크게 표시한다.

- 파일 비교
- 폴더 비교
- 3-way 병합

최근 세션은 아래에 작게 두며 파일 내용을 저장하지 않는다. 취소한 dialog는 조용히 시작 화면으로 돌아온다.

## 3. 2-way 화면

```text
┌ toolbar: back swap prev next options                         ┐
├ LEFT path/info                 │ RIGHT path/info             ┤
├───────────────────────────────┼──────────────────────────────┤
│ original Monaco               │ modified Monaco              │
│ synchronized scroll           │ current hunk decoration      │
└ status: encoding/EOL/size · hunk x/y                         ┘
```

### 필수 동작

- current hunk는 gutter, overview ruler, 배경으로 표시한다.
- 색상 외에 `+`, `-`, `~`와 status text를 제공한다.
- 경로는 말줄임하지만 tooltip/copy path를 제공한다.
- side-by-side 공간이 좁으면 inline view로 자동 전환하거나 명시적 안내한다.
- 편집 모드는 기본 off다. 활성화 시 pane heading과 status bar에 `EDITING`을 표시한다.

## 4. 폴더 화면

```text
┌ toolbar: roots rescan mode filters search                    ┐
├ LEFT root                    │ RIGHT root                    ┤
├ counts: changed left-only right-only same errors             ┤
├ status │ folder/file tree │ size │ modified │ kind           ┤
└ scan progress / selected action                              ┘
```

### 행 행동

- single click: 행 선택만 변경하고 파일을 열지 않음
- Enter: 선택된 일반 파일이면 compare
- double click: 일반 파일이면 compare, 폴더이면 expand/collapse. 한쪽-only 파일은 반대쪽을 missing 가상 빈 문서로 열기
- Space: preview/action panel
- context menu: compare, reveal, copy path, hash details

목록 위에는 `한 번 클릭=선택만`, `더블 클릭/Enter=파일 새 창 열기 또는 폴더 펼침/접기`,
`Space=세부 정보`를 항상 보이는 조작 안내로 표시한다. 행 전체의 gesture와 별도로 보이는 버튼·폴더
화살표는 일반 버튼 규칙대로 한 번 클릭한다. 조작 규칙을 tooltip이나 화면 하단 상태 문구에만 숨기지 않는다.

목록은 각 계층에서 폴더를 파일보다 먼저 배치한다. 상태 필터에서 `same`이 꺼져 있어도 표시 대상
파일의 상위 폴더는 문맥 행으로 유지하며, 파일 행에는 basename과 축약된 상위 상대 경로를 함께
표시한다. 폴더를 접으면 모든 하위 폴더와 파일이 숨겨져 다른 폴더의 파일과 섞이지 않아야 한다.
동기화 드라이런처럼 1차 검토에 필요하지 않은 전체 결과 계산은 기본으로 접고 사용자가 펼칠 때
계산한다.

폴더 전체 동기화는 Phase 1 핵심이 아니다. copy/sync가 추가되면 먼저 dry-run plan을 보여준다.

## 5. 3-way 화면

권장 기본 레이아웃:

```text
┌ toolbar: prev/next conflict count save                       ┐
├ BASE            │ OURS             │ THEIRS                  ┤
├ read-only       │ read-only        │ read-only               ┤
├──────────────────────────────────────────────────────────────┤
│ RESULT editable · active conflict actions                    │
└ status: unresolved count · output encoding/EOL               ┘
```

화면이 좁으면 source panes를 tab으로 전환하고 Result를 항상 보인다.

### 충돌 행동

- active conflict만 resolution 버튼을 활성화한다.
- 버튼은 OURS/THEIRS 색뿐 아니라 텍스트를 가진다.
- BOTH는 순서를 명시한다: `OURS then THEIRS`가 기본이다.
- 해결 직후 다음 conflict로 자동 이동하는 옵션을 제공한다.
- unresolved marker가 남은 저장은 경고한다.

## 6. 기본 단축키

macOS에서는 Ctrl을 Cmd로 매핑한다.

| 동작 | Windows/Linux | macOS |
|---|---|---|
| 파일 비교 열기 | Ctrl+O | Cmd+O |
| 폴더 비교 열기 | Ctrl+Shift+O | Cmd+Shift+O |
| 3-way 열기 | Ctrl+Alt+O | Cmd+Option+O |
| 저장 | Ctrl+S | Cmd+S |
| 다른 이름 저장 | Ctrl+Shift+S | Cmd+Shift+S |
| 다음 차이 | F7 | F7 |
| 이전 차이 | Shift+F7 | Shift+F7 |
| 다음 충돌 | F8 | F8 |
| 이전 충돌 | Shift+F8 | Shift+F8 |
| OURS 채택 | Alt+1 | Option+1 |
| BASE 채택 | Alt+2 | Option+2 |
| THEIRS 채택 | Alt+3 | Option+3 |
| BOTH 채택 | Alt+4 | Option+4 |
| 좌우 교환 | Ctrl+Shift+X | Cmd+Shift+X |
| 경로 검색/필터 | Ctrl+F | Cmd+F |
| 설정 | Ctrl+, | Cmd+, |
| 이전 편집 위치 | Alt+Left | Ctrl+- |

Monaco 기본 키와 충돌하는 단축키는 command registry에서 검사한다.
마우스의 hardware Back 버튼은 `이전 편집 위치`와 같은 command를 실행한다. 유효한 위치 기록이
없을 때 화면을 Home이나 이전 mode로 닫는 fallback은 제공하지 않는다. 위치 history forward와
앱 재시작 후 복원은 `UX-009` 초기 범위에 포함하지 않는다.
native Navigate 메뉴는 화면 복귀용 Back과 혼동되지 않도록 `Previous Editor Location`으로 표시한다.

2-way와 편집 가능한 3-way Result는 Monaco 최초 mount callback에서 navigation binding을 즉시 등록한다.
effect 실행 순서에 따라 최초 편집기의 cursor history가 누락되어서는 안 된다.

이 명령은 최근 100개 위치를 process memory에만 유지한다. 2-way의 left/right와 편집 가능한 3-way
Result에서 pane, caret, top-line pixel offset, horizontal scroll, focus를 복원하며 text, dirty,
undo/redo 상태는 바꾸지 않는다. React modal이나 native open/save chooser가 열려 있으면 입력 default만
차단하고 기록을 소비하지 않는다. read-only Git merge preview와 BASE/OURS/THEIRS는 초기 대상에서
제외한다. live folder의 다른 항목 재열기는 exact review token/scan generation/normalized item identity와
clean 상태를 검증하고, 100ms를 넘으면 접근 가능한 복원 상태를 표시한다. 삭제·collision·symlink·binary·
LFS pointer·크기 제한·경로 이탈은 stale/non-text로 건너뛰며 현재 화면과 history를 임의 소비하지 않는다.
Git의 다른 항목 재열기는 T081/T082 완료 전에는 활성화하지 않는다.

## 7. 메시지 원칙

좋은 오류는 다음 질문에 답한다.

1. 무엇이 실패했는가?
2. 기존 파일은 안전한가?
3. 사용자가 무엇을 할 수 있는가?

예:

```text
저장하지 못했습니다. 기존 파일은 변경되지 않았습니다.
파일이 다른 프로그램에서 사용 중인지 확인한 뒤 다시 시도하세요.
```

## 8. 접근성

- status chip에 aria-label
- table은 keyboard row navigation
- conflict count는 live region이되 편집마다 과도하게 읽지 않음
- focus ring 제거 금지
- diff 색상은 WCAG contrast 검토
- reduce motion에서는 progress animation 단순화
- screen reader에는 pane 역할과 file path를 명시

## 9. 설정 최소값

Phase 1 설정:

- theme
- font family/size
- word wrap
- whitespace/EOL defaults
- folder compare default mode
- hidden/gitignore/symlink defaults
- backup policy
- auto-advance conflict

설정을 늘리기 전에 sensible default를 개선한다.
