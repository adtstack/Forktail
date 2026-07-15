# Feature Specification: Local Git Snapshot Review

**Feature Branch**: `codex/GIT-000-git-runner-adr`

**Created**: 2026-07-15

**Status**: Implemented in source — packaged OS release evidence pending

**Input**: User description: "Git 관련 문서를 바탕으로 Spec Kit을 활용해 전체 스펙과 이후 개발 범위, 추가하기 좋은 기능을 정의한다."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 두 revision의 변경 검토 (Priority: P1)

개발자는 checkout이나 branch 전환 없이 로컬 repository의 branch, tag, commit, `HEAD~n` 중
두 시점을 고르고 변경된 파일을 순서대로 검토한다. 추가·삭제·이름 변경·형식 변경을 구분하고,
선택한 파일의 양쪽 snapshot을 read-only diff로 연다.

**Why this priority**: 기존 비교 엔진을 Git의 immutable snapshot에 연결하는 최소 제품 가치이며,
working tree와 repository를 건드리지 않는다는 Forktail의 차별점을 가장 작게 증명한다.

**Independent Test**: 두 commit이 있는 임시 repository에서 changed-file 목록과 선택한 파일의
정확한 내용을 연 뒤, HEAD·branch·index·working tree가 전후 동일함을 확인하면 독립적으로 검증된다.

**Acceptance Scenarios**:

1. **Given** 서로 다른 두 local revision이 있고 같은 파일이 수정된 repository, **When** 사용자가 두 revision과 파일을 선택하면, **Then** 양쪽 canonical snapshot label과 read-only diff가 표시된다.
2. **Given** 한쪽 revision에만 파일이 있는 repository, **When** 해당 항목을 열면, **Then** 존재하지 않는 쪽은 빈 파일이 아니라 `missing` snapshot으로 표시된다.
3. **Given** 이름이 바뀐 파일, **When** changed-file 목록을 검토하면, **Then** old path, new path, similarity 참고값이 표시되고 각 revision의 정확한 내용이 열린다.
4. **Given** binary, symlink, submodule 또는 LFS pointer, **When** 항목을 열려고 하면, **Then** 텍스트로 위장하지 않고 metadata와 행동 가능한 제한 안내만 표시된다.

---

### User Story 2 - HEAD, index, working tree 비교 (Priority: P2)

개발자는 현재 작업을 수정하지 않고 `HEAD ↔ index`, `index ↔ working tree`, `HEAD ↔ working tree`
중 원하는 쌍을 비교한다. staged와 unstaged 변경을 분리해서 보고, 앱 안의 저장하지 않은 편집 버퍼와
disk working tree가 다름을 명확히 이해한다.

**Why this priority**: commit 전 검토에서 가장 빈번한 세 상태를 하나의 안전한 비교 경험으로 묶으며,
stage·unstage 기능을 추가하지 않고도 일상적인 Git 검토 시간을 크게 줄인다.

**Independent Test**: 한 파일에 staged 변경과 추가 unstaged 변경을 만든 뒤 세 비교 조합이 서로 다른
snapshot을 정확히 보여주고 index와 disk bytes가 바뀌지 않음을 확인한다.

**Acceptance Scenarios**:

1. **Given** staged와 unstaged 변경이 모두 있는 파일, **When** 사용자가 `HEAD ↔ index`를 고르면, **Then** staged 변경만 표시된다.
2. **Given** 같은 상태, **When** 사용자가 `index ↔ working tree`를 고르면, **Then** unstaged 변경만 표시된다.
3. **Given** untracked 또는 sparse checkout으로 disk에 없는 path, **When** 비교를 요청하면, **Then** 비교 가능한 side와 명시적 missing 상태 또는 행동 가능한 제한 안내가 표시된다.

---

### User Story 3 - Git conflict를 안전하게 해결 (Priority: P3)

개발자는 unmerged path를 열고 index stage의 Base, Stage 2, Stage 3과 현재 working tree Result를
검토한다. 텍스트 conflict를 해결해 Result 파일만 저장하고, staging과 continue는 terminal에서 직접
수행한다.

**Why this priority**: 기존 3-way merge와 safe-save 강점을 Git conflict에 연결하지만, 유일한 쓰기
경로이므로 read-only MVP와 저장 안전성 gate 뒤에 둔다.

**Independent Test**: 실제 임시 conflict에서 stage snapshot과 Result를 열고 한 파일을 저장한 뒤,
Result 외 파일·HEAD·refs·index가 Forktail 실행 중 바뀌지 않았음을 확인한다.

**Acceptance Scenarios**:

1. **Given** 일반 merge conflict, **When** 사용자가 path를 열면, **Then** Base/Stage 2/Stage 3/Result와 실제 source를 설명하는 label이 표시된다.
2. **Given** add/add 또는 delete/modify conflict, **When** path를 열면, **Then** 없는 stage는 빈 text가 아니라 missing side로 표시된다.
3. **Given** 사용자가 모든 marker를 해결하고 저장, **When** 저장이 완료되면, **Then** Result 파일만 안전하게 바뀌고 자동 `git add`나 continue가 없었다는 다음 단계 안내가 표시된다.
4. **Given** index stage나 Result가 외부에서 바뀐 상태, **When** 저장하려 하면, **Then** 명시적 재검토 없이 덮어쓰지 않는다.

---

### User Story 4 - merge 결과 사전 검토 (Priority: P4)

개발자는 두 revision과 한 path를 선택해 공통 merge base가 하나인 경우 read-only 3-way preview를
본다. preview가 실제 Git merge 실행 결과가 아니며 repository를 변경하지 않는다는 점을 분명히
이해한다.

**Why this priority**: 병합 전에 충돌 가능성을 검토하는 고가치 기능이지만, 실제 merge와 같다는
오해를 막는 UX와 다중 merge-base 처리가 선행되어야 한다.

**Independent Test**: clean, conflict, unrelated histories, multiple merge-base fixture에서 preview 상태와
설명이 정확하고 저장 동작이 없음을 확인한다.

**Acceptance Scenarios**:

1. **Given** 공통 merge base가 하나인 두 revision, **When** preview를 열면, **Then** Base/Left/Right snapshot과 임시 Result를 read-only로 검토할 수 있다.
2. **Given** 공통 base가 없거나 여러 개인 history, **When** preview를 요청하면, **Then** 임의의 base를 고르지 않고 원인과 가능한 다음 행동을 표시한다.

---

### User Story 5 - 큰 변경 집합을 빠르게 검토 (Priority: P5)

개발자는 changed-file 목록을 keyboard로 순회하고, 현재 session에서 본 파일과 아직 보지 않은 파일을
구분하며, 상태·path로 필터한다. 선택한 immutable snapshot 비교 결과는 명시적인 Save As를 통해
plain unified patch로 내보낼 수 있다.

**Why this priority**: snapshot을 읽는 기능보다 실제 review 완료 시간을 줄이는 기능이며, 파일 내용을
영구 저장하지 않는 session-local 상태로 안전하게 추가할 수 있다.

**Independent Test**: 10,000개 generated entry에서 filter, next-unreviewed, viewed reset, patch Save As를
검증하고 repository fingerprint와 최근 session 저장소에 blob 내용이 남지 않음을 확인한다.

**Acceptance Scenarios**:

1. **Given** 여러 changed file, **When** 사용자가 파일을 열고 다음 미검토 항목으로 이동하면, **Then** session-local viewed 상태와 남은 수가 일관되게 갱신된다.
2. **Given** rename과 binary 항목이 섞인 목록, **When** status/path filter를 적용하면, **Then** 표시 count와 keyboard 순회 대상이 같은 집합을 사용한다.
3. **Given** 텍스트 snapshot diff, **When** 사용자가 patch Save As를 선택하면, **Then** source repository를 바꾸지 않고 선택한 revision identity가 포함된 plain text 결과만 새 대상에 저장된다.

---

### User Story 6 - 선택 파일의 로컬 이력 탐색 (Priority: P6)

개발자는 현재 선택한 path에 대해 로컬에 존재하는 최근 변경 commit을 제한된 목록으로 보고,
두 항목을 골라 User Story 1의 snapshot compare를 연다. 자동 fetch 없이 rename 경계와 history 제한을
명확히 이해한다.

**Why this priority**: 전체 history graph를 만들지 않고도 “이 파일이 언제 어떻게 바뀌었나”라는
자연스러운 후속 질문을 해결하지만, read-only compare MVP의 실사용 검증 뒤에만 승격한다.

**Independent Test**: rename을 포함한 file history fixture에서 제한된 commit 목록, local-object-only
오류, 선택한 두 snapshot 비교를 검증한다.

**Acceptance Scenarios**:

1. **Given** 여러 commit에서 바뀐 tracked file, **When** 이력을 열면, **Then** bounded recent commit metadata만 표시되고 file content는 선택 전까지 읽지 않는다.
2. **Given** history 경계 밖 object가 로컬에 없음, **When** 사용자가 해당 시점을 요청하면, **Then** 자동 fetch 없이 local object가 없다는 안내를 표시한다.

### Edge Cases

- Git executable이 없거나 최소 지원 version보다 낮다.
- 선택한 폴더가 repository가 아니거나 `safe.directory` 정책으로 신뢰되지 않는다.
- bare, linked worktree, detached HEAD, unborn branch, empty repository, shallow/partial clone, sparse checkout이다.
- branch와 tag의 short name이 겹치거나 abbreviated object ID가 여러 object와 일치한다.
- revision이 선택 뒤 이동하고, index 또는 working tree가 여러 요청 사이에 바뀐다.
- path에 space, tab, newline, control character, Unicode normalization 차이 또는 UTF-8이 아닌 byte가 있다.
- object ID가 SHA-1이 아닌 형식이고 길이가 다르다.
- changed-file 목록, refs, history, stderr 또는 blob이 허용 한도를 넘는다.
- 사용자가 취소하는 순간 child 작업이 완료되거나 늦은 결과가 도착한다.
- Result path가 삭제되거나 symlink로 바뀌거나 repository 밖으로 향한다.
- multiple merge base, unrelated history, rename/rename, type change, binary conflict가 발생한다.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: 사용자는 하위 폴더를 포함한 local working-tree repository를 열고 repository root, worktree 여부, 현재 branch 또는 detached 상태를 확인할 수 있어야 한다.
- **FR-002**: 시스템은 사용자가 입력한 revision을 invalid, ambiguous, resolved로 구분하고, resolved revision을 immutable full object identity로 고정해야 한다.
- **FR-003**: 시스템은 두 resolved revision 사이의 added, deleted, modified, renamed, type-changed, unknown 항목을 lossless path identity와 함께 제공해야 한다.
- **FR-004**: 사용자는 선택한 changed file을 checkout 없이 read-only snapshot compare로 열 수 있어야 하며, missing과 empty content를 구분해야 한다.
- **FR-005**: 시스템은 snapshot 내용을 열기 전에 object type과 size를 확인하고 기존 64 MiB, binary, encoding, EOL, final-newline 정책을 동일하게 적용해야 한다.
- **FR-006**: 시스템은 committed blob, index stage, working tree, missing을 서로 다른 origin으로 표시하고 각 side의 쓰기 가능 여부를 명시해야 한다.
- **FR-007**: 사용자는 `HEAD ↔ index`, `index ↔ working tree`, `resolved revision ↔ working tree` 비교를 선택할 수 있어야 하며 staged와 unstaged 상태를 혼동하지 않아야 한다.
- **FR-008**: 시스템은 unmerged path의 stage 1/2/3 availability, mode, object identity와 현재 Result fingerprint를 snapshot으로 구성해야 한다.
- **FR-009**: Git conflict 저장은 저장 직전 stage set, Result fingerprint, regular-file 상태, root containment를 재검증하고 Result 파일 하나에만 기존 safe-save 정책을 적용해야 한다.
- **FR-010**: 시스템은 두 revision의 merge base가 정확히 하나일 때만 read-only 3-way preview를 제공하고, 0개 또는 여러 개인 경우 자동 선택하지 않아야 한다.
- **FR-011**: 시스템은 symlink, submodule, binary, LFS pointer, unavailable local object를 일반 텍스트로 열지 않고 서로 다른 상태와 행동 가능한 안내를 제공해야 한다.
- **FR-012**: 시스템은 Git path의 backend identity와 display path를 분리하고, lossy display string을 후속 open/save 요청의 identity로 재사용하지 않아야 한다.
- **FR-013**: refs, changed files, tree, history, status 작업은 bounded output, timeout, 사용자 취소, stale-result 무시를 지원해야 한다.
- **FR-014**: Git 화면은 repository, raw revision label, resolved short identity, snapshot origin, read-only 상태, rename, missing, binary/type 상태를 색상 외 text로 표시해야 한다.
- **FR-015**: 사용자는 changed-file 목록을 path와 status로 필터하고 keyboard로 다음/이전 및 다음 미검토 항목을 이동할 수 있어야 한다.
- **FR-016**: viewed/unviewed 상태는 현재 review session에만 유지되고 blob content, diff result, Git 임시 path를 recent session이나 영구 저장소에 남기지 않아야 한다.
- **FR-017**: 사용자는 선택한 두 immutable text snapshot의 plain unified patch를 명시적인 Save As 대상으로 내보낼 수 있어야 하며, source repository를 바꾸지 않아야 한다.
- **FR-018**: 사용자는 선택 path의 bounded local commit history를 조회하고 두 항목을 기존 snapshot compare로 열 수 있어야 하며, history 조회가 자동 fetch를 만들지 않아야 한다.
- **FR-019**: 모든 Git 실패는 안정된 code와 행동 가능한 message로 표현되고 raw command, raw stderr, file content를 사용자 메시지에 포함하지 않아야 한다.
- **FR-020**: bare repository, copy detection, cross-repository compare처럼 승격되지 않은 후보는 지원되는 것처럼 노출하지 않아야 한다.

### Safety, Privacy, and Scope Requirements *(mandatory)*

- **SR-001**: 모든 read-only journey 전후에 HEAD, refs, index, tracked working files, repository-local config가 동일해야 한다.
- **SR-002**: production 기능은 checkout, switch, restore, reset, fetch, pull, push, add, commit, merge, rebase, cherry-pick, continue 또는 config mutation을 실행해서는 안 된다.
- **SR-003**: Git 조회는 network, credential prompt, optional index write, external diff, text conversion, content filter, LFS download, submodule update를 유발해서는 안 된다.
- **SR-004**: 사용자 file/blob/diff/merge content는 network, telemetry, 기본 log, recent session, disk cache에 저장되어서는 안 된다.
- **SR-005**: conflict Result와 patch Save As를 제외한 Git snapshot surface는 read-only여야 하며, 모든 쓰기는 명시적인 사용자 action과 기존 safe-save guard를 요구한다.
- **SR-006**: path containment, symlink, external modification, cancellation, timeout, output cap 실패는 partial success로 보고되지 않아야 한다.

### Key Entities *(include if feature involves data)*

- **Git Repository**: 사용자가 선택한 local repository의 root, worktree/common identity, object format, current state를 나타낸다.
- **Git Revision**: 사용자가 입력한 label과 검증된 immutable commit identity의 관계를 나타낸다.
- **Git Path Identity**: lossless backend identity와 안전한 display path를 분리한 session-scoped path 참조다.
- **Git Changed File**: status, old/new path, similarity 참고값으로 두 revision 사이 한 항목을 나타낸다.
- **Git Snapshot Document**: committed blob, index stage, working tree 또는 missing origin의 read-only/write capability와 text metadata를 나타낸다.
- **Git Conflict Session**: stage snapshot set, Result path/fingerprint, operation label, save eligibility를 나타낸다.
- **Review Session**: revision pair, filter, selection, viewed set을 보관하되 file content를 포함하지 않는 일시적 검토 상태다.
- **File History Entry**: local commit identity, bounded display metadata, 선택 path와의 관계를 나타낸다.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 지원되는 두 local revision의 changed-file 목록에서 사용자는 5번 이하의 주요 interaction으로 선택 파일 diff를 열 수 있다.
- **SC-002**: 10,000개 changed entry에서도 사용자는 목록을 keyboard로 탐색·필터·취소할 수 있고, 입력이 100ms 이상 연속으로 응답하지 않는 구간이 없어야 한다.
- **SC-003**: read-only Git 시나리오의 100%에서 전후 repository fingerprint가 동일하고 network/helper/credential invocation count가 0이어야 한다.
- **SC-004**: added, deleted, modified, renamed, type-changed, binary, symlink, submodule, LFS, missing-object fixture가 모두 올바른 text state 또는 차단 상태로 분류되어야 한다.
- **SC-005**: SHA-1과 SHA-256 object, Unicode와 지원 가능한 non-UTF-8 path fixture에서 잘못된 object/path를 여는 사례가 0건이어야 한다.
- **SC-006**: conflict save의 모든 성공 사례에서 Result 한 파일만 바뀌고, 모든 fault-injection 실패 사례에서 기존 Result가 보존되어야 한다.
- **SC-007**: Windows, macOS, Linux packaged smoke에서 snapshot compare와 external difftool/mergetool lifecycle의 save/no-save 결과가 문서 계약과 일치해야 한다.
- **SC-008**: keyboard-only와 200% 확대에서 revision 선택, changed-file 탐색, snapshot diff, conflict save의 핵심 흐름을 완료할 수 있어야 한다.
- **SC-009**: review session 종료 후 persistent storage를 검사했을 때 blob content, diff result, Git temp source path가 남은 사례가 0건이어야 한다.
- **SC-010**: file history와 patch export가 승격될 경우, local-only/no-mutation gate와 별도 성능 baseline을 모두 통과해야 한다.

## Assumptions

- 초기 사용자는 local working-tree repository와 설치된 지원 Git executable을 가진 개발자다.
- remote-tracking branch는 로컬에 이미 존재하는 ref이며 최신 remote 상태를 의미하지 않는다.
- raw repository object가 사용자 기대의 filtered/LFS materialized content와 다를 수 있음을 UI가 설명한다.
- Git-1 MVP는 bare repository를 거절하고, linked worktree는 identity를 분리해 지원한다.
- review progress는 session-local이 기본이며 repository나 user file을 수정하지 않는다.
- file history는 전체 graph가 아닌 선택 path의 bounded local metadata 목록이다.

## Dependencies and Out of Scope *(mandatory)*

- **Source dependencies**: `SAV-007`, `SAV-008`, `MRG-012`, `INT-002`, `GIT-000`의 safe-save, external-tool, CLI-first, allowlist ADR 결정.
- **Release evidence dependencies**: `RTM-001`, `RTM-002`, `MRG-014`, `INT-002`의 지원 OS packaged lifecycle. 이 증적은 source 구현 완료와 분리하며 미실행 항목을 pass로 간주하지 않는다.
- **Out of scope**: checkout/switch/restore/reset, clone/fetch/pull/push, stage/unstage/add, commit, merge/rebase/cherry-pick 실행 또는 continue, branch/tag mutation, stash apply/pop, automatic `.gitconfig`/`.gitattributes` changes, LFS download, submodule recursion/update, remote authentication, full history graph, custom merge driver, AI review/merge, headless blob-content export.

## Delivery Scope and Future Opportunities

| 단계 | 사용자 가치 | 포함 범위 | 승격 조건 |
|---|---|---|---|
| Gate A | 기존 외부 Git tool 신뢰성 | packaged difftool/mergetool lifecycle, safe config guidance | Phase 1 runtime/save gates 완료 |
| Release B (MVP) | branch/commit review | US1, repository/revision/tree/blob/changed-file read-only compare | no-network/no-mutation 증거 |
| Release C | commit 전 검토 | US2, working tree와 stage-0 index snapshot compare | index byte 불변·path 안전성 |
| Release D | conflict 해결 | US3, stage 1/2/3 + Result safe save | save fault/lifecycle 세 OS 검증 |
| Release E | 병합 사전 검토 | US4, single merge-base read-only preview | 오해 방지 UX와 multiple-base fixture |
| Release F | 검토 생산성 | US5, viewed queue, keyboard review, patch Save As | 10k 목록·privacy retention gate |
| Candidate G | 선택 파일 맥락 | US6, bounded local file history | MVP 사용성 증거와 rename 성능 baseline |

추가 후보는 다음 순서로 검토한다.

1. **Opt-in copy detection**: rename MVP의 실제 오분류가 측정된 뒤, 시간·결과 수 cap과 함께 추가한다.
2. **Read-only bare repository**: CI artifact/object 검토 수요가 확인되고 working-tree 없는 UX가 별도 설계된 뒤 추가한다.
3. **Cross-repository snapshot compare**: 두 repository identity와 path mapping을 명시적으로 선택하는 UX/보안 ADR 뒤 검토한다.
4. **Submodule metadata jump**: 자동 재귀나 update 없이 사용자가 이미 로컬에 가진 submodule root를 새 session으로 여는 방식만 검토한다.
5. **Review summary export**: file content 없이 status/count/viewed metadata만 내보내는 감사용 report를 별도 privacy review 뒤 검토한다.
