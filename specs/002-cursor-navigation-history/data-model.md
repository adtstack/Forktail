# Data Model: Cursor Navigation History

## Modeling Rules

- 모든 값은 현재 app process 안에서만 유효하고 serialization/persistence API를 갖지 않는다.
- location은 allowlist field만 가진다. file content, diff, merge Result, selection text, 주변 text,
  absolute Git temporary path, whole session DTO는 금지한다.
- display label/path는 identity가 아니다. generation 또는 model revision이 다르면 같은 표시 문자열도
  다른 document다.
- `past`와 `current`를 분리한다. 현재 위치는 100개 previous-location limit에 포함하지 않는다.
- candidate는 restore 성공 후에만 소비한다. stale discard와 blocked/cancelled release는 별도 전이다.
- cursor와 viewport는 1-based Monaco position, non-negative pixel offset으로 정규화한다.

## EditorPaneId

초기 기능에서 cursor/focus를 복원할 수 있는 editor pane이다.

```text
compareLeft | compareRight | mergeResult
```

- `compareLeft`: 2-way diff original editor.
- `compareRight`: 2-way diff modified/editable editor.
- `mergeResult`: 3-way merge의 editable Result editor.
- BASE/OURS/THEIRS source pane과 read-only Git merge preview Result는 초기 history target이 아니다.

## CursorPosition

| Field | Meaning | Validation |
|---|---|---|
| `lineNumber` | 1-based cursor line | capture 때 최소 1; restore 때 current model에 clamp |
| `column` | 1-based cursor column | capture 때 최소 1; restore 때 `validatePosition`으로 clamp |

selection range나 selected text는 저장하지 않는다. restore는 caret position만 설정하며 document
text를 변경하지 않는다.

## ViewportAnchor

| Field | Meaning | Validation |
|---|---|---|
| `topLineNumber` | 첫 visible line | 최소 1, restore 시 current line count에 clamp |
| `topLineOffsetPx` | 해당 line top과 실제 scroll top의 차이 | finite, non-negative로 정규화 |
| `scrollLeftPx` | horizontal scroll | finite, non-negative로 정규화 |

capture는 `scrollTop - getTopForLineNumber(topLineNumber)`로 offset을 계산한다. restore는 clamped
line의 top + offset과 horizontal scroll을 지정한다. viewport API가 값을 더 제한하면 Monaco의
정규화 결과를 수용한다.

## WorkflowScopeIdentity

history entry가 어느 live workflow generation에 속하는지 구분한다.

### DirectCompareScope

| Field | Meaning |
|---|---|
| `kind` | `directCompare` |
| `sessionToken` | App이 발급한 process-only opaque token |
| `modelRevision` | reload, side swap, clean session replacement 때 증가하는 revision |

직접 연 file compare는 현재 mounted session 안에서만 유효하다. 화면을 닫은 뒤 arbitrary file reopen은
하지 않는다.

### DirectMergeScope

| Field | Meaning |
|---|---|
| `kind` | `directMerge` |
| `sessionToken` | App이 발급한 process-only opaque token |
| `resultRevision` | Result model을 교체할 때 증가하는 revision |

Result text나 conflict block은 identity에 포함하지 않는다.

### FolderReviewScope

| Field | Meaning |
|---|---|
| `kind` | `folderReview` |
| `reviewToken` | 현재 left/right root pair에 대한 process-only token |
| `scanGeneration` | active folder scan generation |

root absolute path는 history entry마다 복제하지 않는다. App의 현재 live review scope가 token을
소유하며 scan generation이 달라지면 모든 이전 item target은 stale이다.

### GitReviewScope

| Field | Meaning |
|---|---|
| `kind` | `gitReview` |
| `repositorySessionId` | backend가 발급한 active repository session |
| `generation` | path/request opaque ID가 유효한 Git generation |
| `reviewKind` | revision, working/index, conflict 중 resolver allowlist |

repository close/refresh 또는 generation change는 target을 stale로 만든다.

## DocumentIdentity

workflow scope 안에서 실제 text target과 model을 식별한다.

### MountedDocumentIdentity

| Field | Meaning |
|---|---|
| `kind` | `mountedCompare` 또는 `mountedMergeResult` |
| `modelKey` | component가 발급한 content-free model key |
| `modelRevision` | 현재 mount와 일치해야 하는 revision |

Monaco URI 자체는 folder/Git generation을 완전히 표현하지 않으므로 identity로 사용하지 않는다.

### FolderTextIdentity

| Field | Meaning | Validation |
|---|---|---|
| `kind` | `folderText` | fixed discriminator |
| `relativeItemKey` | scan result 안의 normalized relative identity | current generation row와 exact match |
| `comparisonKind` | both/left-only/right-only 등 open request 구분 | current row가 text-openable이어야 함 |

display path의 fuzzy/name match는 금지한다. deleted, binary, symlink, containment failure는 stale이다.

### GitTextIdentity

| Field | Meaning | Validation |
|---|---|---|
| `kind` | `gitText` | fixed discriminator |
| `opaquePathIds` | 현재 generation의 backend path handles | exact session/generation match |
| `requestKind` | revision pair/index/working/conflict allowlist | generic argv 없음 |
| `resolvedObjectIds` | request가 요구하는 immutable revision identity | current review context와 exact match |

`displayPath`, blob text, diff, conflict Result, Git temp path는 포함하지 않는다. resolver는 현재 App이
보유한 typed open request만 재구성한다.

## NavigationTarget

| Field | Meaning |
|---|---|
| `scope` | `WorkflowScopeIdentity` discriminated union |
| `document` | scope에 맞는 `DocumentIdentity` |

유효성 규칙:

1. scope kind와 document kind 조합이 허용돼야 한다.
2. 현재 live scope token/session/generation이 exact match여야 한다.
3. current result row가 여전히 text-openable이어야 한다.
4. mounted target이면 component model revision이 exact match여야 한다.
5. 다른 document를 열어야 할 때 current dirty 상태가 false여야 한다.

direct compare의 scope `modelRevision`과 mounted document `modelRevision`은 같은 값이어야 한다.
direct merge의 scope `resultRevision`은 mounted Result document의 `modelRevision`과 같은 값이어야 하며,
일반 text edit은 이 revision을 바꾸지 않는다.

## NavigationLocation

| Field | Meaning | Validation |
|---|---|---|
| `sequence` | process-only monotonic order | 정수, persistence/logging 금지 |
| `target` | live target identity | exact validation only |
| `pane` | editor pane | target과 호환되는 enum |
| `cursor` | caret position | restore 시 clamp 가능 |
| `viewport` | visible context anchor | finite normalized pixels |

`capturedAt` timestamp는 ordering에 필요하지 않아 저장하지 않는다. 중복 판단은 같은 target/pane과
cursor/viewport proximity로 수행한다.

## NavigationHistory

| Field | Meaning | Invariant |
|---|---|---|
| `capacity` | previous location limit | 항상 100 |
| `past` | oldest → newest previous locations | length `0..100` |
| `current` | 현재 mounted editor의 최신 snapshot | capacity에 포함하지 않음 |
| `replaying` | restore event suppression | restore adapter 실행 동안만 true |
| `reservation` | active Back transaction | null 또는 정확히 하나 |

### Coalescing

새 semantic navigation 직전에 `current`를 past에 commit한다.

- past newest와 target/pane이 다르면 push한다.
- target/pane이 같고 cursor와 viewport가 같은 경우 newest를 교체하거나 no-op한다.
- line/column 차이가 각각 1 이하인 caret과 top line 차이 1 이하, top-line/scroll-left offset 차이
  각각 2px 이하인 viewport는 current만 갱신한다.
- capacity 초과 시 oldest 하나만 제거한다.
- restore 중 관찰된 event는 past에 commit하지 않는다.

proximity threshold는 `CARET_LINE_PROXIMITY = 1`, `CARET_COLUMN_PROXIMITY = 1`,
`VIEWPORT_LINE_PROXIMITY = 1`, `VIEWPORT_PIXEL_PROXIMITY = 2` 순수 policy constant로 고정하고
test에서 공개한다. threshold를 locale, file size, timer에 따라 바꾸지 않는다.

## RestoreReservation

| Field | Meaning |
|---|---|
| `invocationId` | 한 command invocation의 monotonic token |
| `candidateSequence` | 예약한 past newest entry |
| `source` | `keyboard`, `nativeMenu`, `mouse`, `programmaticTest` |
| `phase` | validating, opening, awaitingMount, restoring |
| `requestGeneration` | async open/newer-request guard 또는 null |

한 번에 하나만 존재한다. active reservation 동안 추가 async Back은 history를 소비하지 않는다.
mounted restore가 동기 완료된 뒤에는 바로 다음 distinct input을 받을 수 있다.

## FolderTextReadJob

folder cross-item reopen에서만 사용하는 caller-owned transient job이다.

| Field | Meaning | Validation |
|---|---|---|
| `requestGeneration` | App의 newest open/restore request token | newer request가 생기면 이전 result 무시 |
| `scanGeneration` | target을 resolve한 folder scan generation | mount 전 current generation과 재확인 |
| `jobId` | pair 전체의 Rust text read job | process-only, active job과 unique |
| `relativeItemKey` | current scan row lookup key | history target과 exact match |
| `state` | reading, cancelled, completed, stale, failed | 한 terminal state만 허용 |

## FolderReviewTextPairRequest

| Field | Meaning | Validation |
|---|---|---|
| `leftRoot` / `rightRoot` | current folder result roots | history에는 저장하지 않음 |
| `relativePath` | exact current scan row path | absolute, `..`, empty segment 거절 |
| `leftExpected` / `rightExpected` | `regularFile` 또는 `missing` | 최소 한 side는 regularFile |

Rust는 expected regular side가 canonical root 안의 non-symlink regular file인지, expected missing side가
여전히 없는지 모두 확인한 뒤 pair를 all-or-nothing으로 읽는다. 상태가 달라졌거나 한 side가
binary/too-large/unsafe면 partial `FileDocument`를 반환하지 않는다.

absolute roots/path와 pair request는 job 실행 순간 current scan row에서 얻고 history location에는 넣지
않는다. newer folder item open, rescan, mode leave, Back transaction cancel 시 active pair job을
cancel한다. Rust는 기존 text size/binary/decode policy를 유지하면서 chunk 사이 cancellation을
확인하고 terminal return 뒤 job ID를 정리한다.

## RestoreOutcome

| Outcome | Screen change | Candidate consumption | Status |
|---|---:|---:|---|
| `restored` | 목적 editor view만 변경 | pop commit 1개 | 이전 위치로 이동 |
| `empty` | 없음 | 0 | 이전 위치 없음 |
| `allStale` | 없음 | stale entries만 discard | 유효한 이전 위치 없음 |
| `blockedModal` | 없음 | 0 | dialog가 입력 소유 |
| `blockedDirty` | 없음 | 0 | 저장/취소 후 재시도 안내 |
| `inFlight` | 없음 | 0 | 현재 복원 완료 대기 |
| `cancelled` | 없음 | 0 | reservation release |
| `failed` | 없음 | 0, 또는 exact stale만 discard | 행동 가능한 content-free 오류 |

한 invocation은 stale entry 여러 개를 discard할 수 있지만 유효 location은 최대 하나만 pop한다.

## NavigationAvailability

native menu enabled state는 저장된 별도 truth가 아니라 다음 값에서 파생한다.

```text
hasValidCandidate
AND activeEditorTarget
AND NOT blockingReactModal
AND nativeDialogDepth == 0
AND NOT restoreInFlight
AND NOT dirtyCrossDocumentCandidate
```

availability 계산은 current in-memory review index를 읽기만 하며 history를 변경하지 않는다.
stale discard는 명시적인 Back transaction reducer에서만 수행한다. 외부 변경이 enable 계산 뒤
발생하면 command 실행 시 다시 검증하고 fail closed한다.

## State Transitions

```text
editor mounted/focused
  → observe current snapshot
  → semantic move requested
  → commit current to past
  → observe destination as current

Back requested
  → guard
  → peek newest
      → stale: discard → peek next
      → blocked: keep candidate → announce
      → valid mounted: reserve → replay → commit pop
      → valid cross-item: reserve → async open → matching mount → replay → commit pop
                                      ↘ cancel/newer request: release, keep candidate
                                      ↘ exact stale: discard, try next
```

## Privacy and Persistence Exclusions

다음 field/API는 model과 test fixture에 존재해서는 안 된다.

- `content`, `text`, `diff`, `mergeResult`, `selectedText`, `surroundingText`
- `localStorageKey`, `settingsKey`, `serialize`, `deserialize`, disk/cache writer
- raw Git argv, temporary worktree path, credential, network identifier
- whole `FileDocument`, `CompareSession`, `MergeSession`, `GitSnapshotDocument`

테스트는 sentinel content를 location에 넣을 수 없고 storage/log bridge가 호출되지 않는다는 계약을
검증한다.
