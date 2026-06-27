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
├ status │ relative path │ left size/time │ right size/time    ┤
└ scan progress / selected action                              ┘
```

### 행 행동

- single click: 선택
- Enter/double click: 양쪽 파일이면 compare
- Space: preview/action panel
- context menu: compare, reveal, copy path, hash details

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

Monaco 기본 키와 충돌하는 단축키는 command registry에서 검사한다.

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
