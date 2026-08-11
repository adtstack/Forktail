# Contract: Editor Navigation Back

## 1. Public command identity

```ts
type AppCommandId = /* existing ids */ | "navigateEditorBack";
```

`navigateEditorBack`은 cursor/view history 전용이다. 다음 동작과 절대 alias/fallback 관계를 갖지
않는다.

- compare/merge/folder/Git 화면의 toolbar `onBack`
- Home 이동, session close, external difftool/mergetool 종료
- browser URL history Back
- save, discard, undo, redo

입력 source가 달라도 App의 동일 handler와 동일 capability/result contract를 사용한다.

## 2. Platform shortcut contract

| Runtime platform | Shortcut | Menu accelerator | ARIA display |
|---|---|---|---|
| Windows | `Alt+Left` | `Alt+Left` | `Alt+ArrowLeft` |
| Linux | `Alt+Left` | `Alt+Left` | `Alt+ArrowLeft` |
| macOS | `Ctrl+-` | `Ctrl+-` | `Control+-` |

- platform은 Rust compile/runtime fact 또는 test injection으로 정한다.
- OS selector나 사용자 입력으로 platform을 정하지 않는다.
- exact modifier match만 허용한다. 추가 Ctrl/Meta/Shift/Alt가 있으면 이 command가 아니다.
- native menu, TypeScript registry, shortcut collision test의 command ID와 표시가 일치해야 한다.
- editor command가 불가능해도 DOM shortcut은 WebView/browser 화면 이탈 default를 막고 history를
  소비하지 않는다.

## 3. Hardware mouse contract

- X1/Back: window capture 단계의 `pointerdown` 하나만 사용하고 `button === 3`에서 command를 정확히
  한 번 요청한다. `mousedown`에서는 command를 만들지 않는다.
- 같은 gesture의 `auxclick`은 default navigation만 막고 두 번째 command를 만들지 않는다.
- X2/Forward: `button === 4`는 UX-009 command로 변환하지 않는다.
- window 밖의 mouse event를 수집하지 않는다.
- OS global hook, raw input listener, platform-native WebView patch는 초기 contract에 없다.
- native accelerator로 재매핑된 동일 gesture와 DOM mouse event가 함께 오면 source가 다르고 두
  monotonic timestamp 차이가 `80ms` 이하인 duplicate만 한 번으로 합친다. timestamp가 하나라도
  없으면 dedupe하지 않으며, 같은 source의 별도 event는 시간만으로 합치지 않는다.

## 4. Command event envelope

```ts
interface AppCommandEventDetail {
  commandId: "navigateEditorBack";
  source: "keyboard" | "nativeMenu" | "mouse" | "programmaticTest";
  monotonicEventTime?: number;
}
```

- 기존 command payload와 호환되도록 source는 registry 전체에서 optional일 수 있지만,
  `navigateEditorBack` producer는 반드시 지정한다.
- file path, cursor, document identity, content는 global event payload에 넣지 않는다.
- command event는 navigation intent일 뿐 candidate를 직접 지정하지 않는다.

## 5. Editor adapter contract

개념 interface:

```ts
interface EditorNavigationHandle {
  capture(): EditorViewSnapshot | null;
  restore(snapshot: EditorViewSnapshot): MountedRestoreResult;
}

interface EditorViewSnapshot {
  pane: "compareLeft" | "compareRight" | "mergeResult";
  cursor: { lineNumber: number; column: number };
  viewport: {
    topLineNumber: number;
    topLineOffsetPx: number;
    scrollLeftPx: number;
  };
}

type MountedRestoreResult =
  | { kind: "restored" }
  | { kind: "staleModel" }
  | { kind: "unavailable" };
```

규칙:

- handle은 current model/session revision과 함께 App에 등록되고 unmount 때 해제된다.
- capture/restore는 content, selection text, undo stack, dirty flag를 읽거나 쓰지 않는다.
- restore는 position과 viewport를 현재 model에 clamp하고 목적 pane에 focus한다.
- restored cursor가 current hunk/conflict range 안에 있으면 view는 active decoration을 그 range에서
  다시 derive한다. semantic index를 location에 저장하거나 stale index를 강제로 복원하지 않는다.
- replay guard 동안 발생한 cursor/focus/scroll event는 past에 기록하지 않는다.
- FileCompare는 left/right handle, Merge는 editable Result handle만 제공한다. read-only Git preview
  Result와 BASE/OURS/THEIRS는 초기 target에서 제외한다.

## 6. History controller contract

```ts
interface NavigationHistoryController {
  observe(location: NavigationLocation): void;
  commitCurrent(reason: SemanticNavigationReason): void;
  navigateBack(context: RestoreContext): Promise<RestoreOutcome>;
  availability(context: RestoreContext): NavigationAvailability;
}
```

`SemanticNavigationReason` allowlist:

```text
nextDiff | previousDiff | nextConflict | previousConflict |
paneFocus | explicitCursorJump | openReviewItem | leaveEditorTarget
```

- ordinary typing, adjacent cursor, scroll-only는 `commitCurrent` reason이 아니다.
- `navigateBack`은 newest부터 검사하고 한 invocation에서 유효 location을 최대 하나만 소비한다.
- mounted success 또는 matching async mount success 전에 pop하지 않는다.
- stale은 discard할 수 있지만 modal/dirty/in-flight/cancel/failure는 candidate를 유지한다.
- replay 자체는 새로운 past/current branch를 만들지 않는다. Forward는 별도 `UX-011` 범위다.

## 7. Restore resolver contract

```ts
type TargetResolution =
  | { kind: "mounted"; handle: EditorNavigationHandle }
  | { kind: "reopenable"; request: ContentFreeOpenRequest }
  | { kind: "stale"; reason: StaleReason }
  | { kind: "blockedDirty" }
  | { kind: "blockedModal" };
```

- exact session/review token, generation, document/model revision을 검사한다.
- folder는 current scan row의 normalized relative identity, Git은 backend opaque ID/request만 사용한다.
- fuzzy path/name match나 closed direct-file session reopen은 금지한다.
- Git reopen은 기존 typed read API와 T081/T082의 cancellation, request generation,
  response-identity guard를 재사용한다. Folder reopen은 아래 cancellable pair-read contract를 사용하고
  기존 uncancellable `readTextFile` pair를 사용하지 않는다.
- async request가 100ms를 넘으면 accessible `restoring` status를 먼저 표시한다.
- matching target mount가 확인돼야 viewport restore와 history commit을 수행한다.
- current document가 dirty이고 candidate가 다른 document이면 `blockedDirty`다. 같은 document restore는
  dirty 여부와 무관하다.

## 8. Native bridge contract

### Authoritative runtime platform input

```text
T084 RuntimeIntegrationProfile.platform -> "windows" | "macos" | "linux"
```

- `specs/001-git-snapshot-integration/tasks.md` T084가 소유하는 read-only packaged-runtime fact다.
- UX-009는 별도 `runtime_platform` command, 사용자 선택, persisted OS setting을 추가하지 않는다.
- native accelerator는 Rust compile target과 일치해야 하고 DOM matcher는 이 DTO를 dependency로
  주입받는다. unit test는 platform을 직접 주입한다.

### Menu enabled state

```text
set_editor_navigation_back_enabled(enabled: boolean) -> void
```

- stable menu item `navigateEditorBack` 하나에만 적용한다.
- label, accelerator, arbitrary menu ID를 frontend에서 넘길 수 없다.
- path/content/history count를 받거나 기록하지 않는다.
- item은 app startup 때 disabled다.
- App은 derived boolean이 바뀔 때만 호출한다.
- Rust 오류는 기존 `{ code, message }` typed error 규칙을 따른다.

### Cancellable folder review pair read

```text
read_folder_review_text_pair(request, jobId: number) -> FolderReviewTextPair
cancel_folder_review_text_read(jobId: number) -> void
```

```ts
interface FolderReviewTextPairRequest {
  leftRoot: string;
  rightRoot: string;
  relativePath: string;
  leftExpected: "regularFile" | "missing";
  rightExpected: "regularFile" | "missing";
}

interface FolderReviewTextPair {
  left: FileDocument | null;
  right: FileDocument | null;
}
```

- pair read는 기존 `read_text_file`과 같은 size limit, binary probe, encoding, line-ending,
  final-newline, decode-loss contract를 사용한다.
- Git LFS pointer signature로 시작하는 regular side는 일반 text로 열지 않고 typed non-text 오류로
  끝낸다. LFS download/filter는 실행하지 않는다.
- absolute/parent-traversal/empty relative segment, root escape, symlink, non-regular target을 거절한다.
- expected `missing` side가 생기거나 `regularFile` side가 사라지거나 kind가 바뀌면 partial success 없이
  typed external-change error로 끝난다. 최소 한 side는 `regularFile`이어야 한다.
- command는 chunk 사이에 cancellation을 확인하고 완료/실패 뒤 job ID를 정리한다. unknown/already
  completed job cancel은 idempotent no-op다.
- history/event payload에는 roots, path, request, `FileDocument`를 넣지 않는다. App은 current scan의
  exact generation/row를 resolve한 직후에만 request를 만든다.
- response는 review token, scan generation, request generation이 여전히 current일 때만 mount한다.

## 9. Input ownership and consumption

명령 실행 전 App은 다음 순서로 검사한다.

1. React modal/dirty confirmation 활성 여부
2. native dialog depth
3. restore transaction in flight 여부
4. active editor target과 valid candidate 여부
5. same-document 또는 clean cross-document 여부

| Condition | Prevent WebView default | History consumed | Screen/editor change |
|---|---:|---:|---|
| valid mounted | yes | success 후 1 | cursor/viewport/focus only |
| valid clean cross-item | yes | mount success 후 1 | verified text item + view |
| empty/all stale | yes | valid 0; stale만 discard | none |
| React/native modal | yes | 0 | none |
| dirty cross-item | yes | 0 | none |
| restore in flight | yes | 0 | none |

## 10. Accessible status contract

App에 neutral navigation status region 하나를 둔다.

```html
<div role="status" aria-live="polite">…</div>
```

필수 상태:

- 이전 위치로 이동함
- 이전 위치가 없음
- 유효하지 않은 기록을 건너뛰었으나 이동할 위치가 없음
- 이전 항목을 복원하는 중
- 저장하지 않은 변경 때문에 다른 항목으로 이동할 수 없음
- 현재 dialog/작업이 완료된 뒤 다시 시도해야 함

메시지에는 file content, raw path, Git temp path, internal error/debug string을 넣지 않는다. 성공한
restore 뒤 focus는 status가 아니라 목적 editor에 남는다.

## 11. Menu availability contract

native menu는 다음 derived capability가 true일 때만 enabled다.

```text
valid previous candidate exists
AND active editor adapter exists
AND no React/native modal
AND no restore in flight
AND candidate is not a dirty cross-document transition
```

enable 계산과 command 실행은 같은 pure candidate validator를 사용한다. 실행 사이 외부 변경이 생기면
command가 다시 검증하고 stale로 처리한다.

## 12. Forbidden side effects

`navigateEditorBack`은 다음을 호출하거나 변경해서는 안 된다.

- file write/save/save-as/backup/atomic replace
- Git add/checkout/index/HEAD/ref/working-tree mutation
- settings/recent/localStorage/IndexedDB/cache serialization
- network, telemetry, content logging
- automatic fetch/LFS/filter/textconv
- browser history, app screen close, external Git tool exit
