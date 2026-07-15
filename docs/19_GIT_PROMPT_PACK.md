# 19. Git Prompt Pack

> 상태: Post-Phase 1 후보 작업용 프롬프트 모음
> 기준 문서: `docs/17_GIT_INTEGRATION.md`, `docs/18_GIT_BACKLOG.md`, `docs/20_GIT_TEST_PLAN.md`, `docs/21_GIT_REFERENCES.md`

이 문서는 Git 기능을 AI 에이전트에게 한 이슈씩 맡길 때 사용하는 짧은 프롬프트 모음이다. Git 기능은 현재 Phase 1 완료 조건이 아니며, `docs/18_GIT_BACKLOG.md`에서 명시적으로 승격한 이슈만 구현한다.

## 1. 사용법

1. 아래 **공통 기본 프롬프트**를 먼저 붙인다.
2. 이어서 이슈별 프롬프트 하나만 붙인다.
3. 한 작업에서 다른 `GIT-*` 이슈를 함께 구현하지 않는다.
4. 수용 기준 밖 개선은 코드가 아니라 후속 이슈 후보로 보고한다.

권장 구현 순서:

```text
GIT-000
  → GIT-001 → GIT-002 → GIT-003 → GIT-004 → GIT-005
  → GIT-101 → GIT-102 → GIT-103 (선택)
  → GIT-201 → GIT-202 → GIT-203
  → GIT-301 → GIT-302
  → GIT-601 → GIT-602 → GIT-603
  → GIT-401 → GIT-402 → GIT-605
  → GIT-501 → GIT-502 → GIT-503 → GIT-604
  → GIT-606 (선택)
  → GIT-701 → GIT-702
  → GIT-801
```

## 2. 공통 기본 프롬프트

```text
forktail 저장소에서 <ISSUE_ID> 하나만 구현한다.

시작 전에 다음을 읽는다.
- AGENTS.md
- docs/01_PRD.md
- docs/02_ARCHITECTURE.md
- docs/04_BACKLOG.md
- docs/07_TEST_PLAN.md
- docs/09_RELEASE_SECURITY.md
- docs/17_GIT_INTEGRATION.md
- docs/18_GIT_BACKLOG.md의 <ISSUE_ID>
- docs/20_GIT_TEST_PLAN.md
- 필요하면 docs/21_GIT_REFERENCES.md의 공식 Git 문서

이 작업은 post-Phase 1 후보이며 기존 파일 비교·병합·안전 저장 경계를 약화하면 안 된다.

절대 규칙:
- 한 이슈, 한 PR 범위를 지킨다. 다른 GIT 이슈를 선행 구현하지 않는다.
- Git 프로세스 실행은 좁은 Rust command/service 안에서만 한다.
- shell 문자열, shell=true, frontend child process, Tauri shell plugin, broad FS/shell capability를 추가하지 않는다.
- 명령과 전역 옵션은 positive allowlist로 검증하고 argv 배열로 실행한다.
- checkout, switch, restore, reset, clean, add, commit, merge, rebase, cherry-pick,
  stash, fetch, pull, push, clone, submodule update를 실행하지 않는다.
- credential helper나 네트워크 prompt를 열지 않는다. GIT_TERMINAL_PROMPT=0을 유지한다.
- 사용자 revision/path는 하나의 argv 원소로 전달한다. revision 검증은 --end-of-options를,
  path output은 해당 command가 제공하는 NUL 구분 형식을 사용한다. --end-of-options를 모든
  subcommand의 범용 separator로 가정하지 않는다.
- stdout/stderr와 Git path는 파싱 전 임의의 UTF-8 String으로 가정하지 않는다.
- timeout, cancellation, stdout/stderr 크기 제한을 적용한다.
- 사용자 파일/blob 내용, diff, 전체 stderr를 로그나 사용자 오류에 넣지 않는다.
- 오류는 기존 { code, message } 계약과 TS/Rust 계약 테스트를 유지한다.
- blob과 working-tree 파일은 기존 크기 제한, binary 감지, 인코딩/EOL 판별을 재사용한다.
- conflict result 저장은 기존 safe writer의 precondition, backup, atomic replace 경로만 사용한다.
- 기존 사용자 변경을 보존하고 unrelated refactor/dependency 추가를 하지 않는다.

진행:
1. 현재 동작과 관련 테스트를 확인한다.
2. 정상·경계·실패 수용 기준을 focused test로 먼저 또는 동시에 표현한다.
3. 가장 작은 변경으로 통과시킨다.
4. fake runner로 정확한 argv와 금지 명령 미실행을 검증한다.
5. 필요한 실제 Git 테스트는 tempfile 저장소와 repository-local config만 사용한다.
6. Git이 없어 실행하지 못한 테스트를 삭제하거나 완화하지 말고 미실행으로 보고한다.

전체 검증:
npm run typecheck
npm test
npm run build
cd src-tauri
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test

완료 응답은 AGENTS.md 형식으로 구현, 실제 검증 결과, 주의/후속만 보고한다.
실행하지 않은 검증을 통과했다고 쓰지 않는다.
```

## 3. Foundation

### GIT-000 — Git CLI 사용 결정 ADR

```text
공통 기본 프롬프트의 <ISSUE_ID>를 GIT-000으로 바꾼다.

코드는 수정하지 말고 Git CLI-first 결정을 ADR로 기록한다. Rust-only 실행 경계,
Git 미설치 동작, 지원 최소 버전, read-only positive allowlist, no-network/no-mutation,
raw byte path, timeout/cancel/output limit, 향후 libgit2 교체 경계를 명확히 한다.
기존 ADR 번호와 docs/17 계약의 모순 여부를 검토하고 문서 링크 검증만 수행한다.
```

### GIT-001 — Allowlisted Git runner

```text
공통 기본 프롬프트의 <ISSUE_ID>를 GIT-001로 바꾼다.

Rust에 async/cancellable Git runner와 fake runner seam을 추가한다. executable과 argv를
직접 전달하고 허용된 read-only subcommand만 실행한다. prompt 차단, timeout, process 종료,
stdout/stderr 상한을 테스트한다. executable은 absolute path로 고정한 뒤 child env를 clear하고
검토된 OS 변수와 안전한 GIT_*만 복원한다. config/askpass/SSH/trace override 상속을 테스트한다.
repository/revision 기능이나 UI는 구현하지 않는다.
```

### GIT-002 — 오류와 DTO 계약

```text
공통 기본 프롬프트의 <ISSUE_ID>를 GIT-002로 바꾼다.

Git missing, unsupported version, timeout, cancelled, invalid repository/revision/path,
oversize, binary, unsupported object, command failure를 안정된 AppError code와 DTO로 정의한다.
TS/Rust 직렬화 계약과 행동 가능한 사용자 메시지를 테스트하고 raw stderr 노출을 막는다.
```

### GIT-003 — Git executable과 버전

```text
공통 기본 프롬프트의 <ISSUE_ID>를 GIT-003으로 바꾼다.

Windows/macOS/Linux에서 설정된 절대 경로와 제한된 PATH 탐색으로 Git executable을 찾고
버전을 검증한다. 임의 디렉터리 재귀 탐색이나 shell lookup을 하지 않는다. Git 없음,
실행 불가, 너무 낮은 버전, 경로 공백을 fake runner/플랫폼 독립 테스트로 다룬다.
```

### GIT-004 — Repository detection

```text
공통 기본 프롬프트의 <ISSUE_ID>를 GIT-004로 바꾼다.

사용자가 선택한 폴더에서 repository root, git dir, common git dir, worktree 상태와 current
branch/detached HEAD, head commit을 read-only 명령으로 감지한다. nested folder, non-repo,
linked worktree를 테스트하고 초기 bare repo는 friendly unsupported로 거절한다.
checkout이나 repository 초기화는 제품 코드에서 하지 않는다.
```

### GIT-005 — Byte/NUL path primitives

```text
공통 기본 프롬프트의 <ISSUE_ID>를 GIT-005로 바꾼다.

NUL-delimited Git output과 repository-relative path를 raw bytes 기준으로 파싱하는 순수 코어를
추가한다. 공백, tab, newline, control byte, 유효하지 않은 UTF-8, 빈/truncated record를 다룬다.
표시용 lossy text를 command identity로 재사용하지 못하게 타입과 테스트로 차단한다.
```

## 4. Revisions

### GIT-101 — Revision resolve

```text
공통 기본 프롬프트의 <ISSUE_ID>를 GIT-101로 바꾼다.

HEAD, branch, tag, full/unique abbreviated commit, reflog 표현을 canonical commit OID로
resolve한다. --verify와 --end-of-options를 사용한다. short ref collision은 ref 후보 수로,
abbreviated hex는 object disambiguation으로 확인하며 localized stderr warning을 파싱하지 않는다.
leading dash, invalid/ambiguous revision, detached HEAD를 테스트한다. 자동 fetch나 remote 조회는 금지한다.
```

### GIT-102 — Ref listing

```text
공통 기본 프롬프트의 <ISSUE_ID>를 GIT-102로 바꾼다.

local branch, 이미 로컬에 있는 remote-tracking branch, tag를 기계 파싱 가능한 형식으로
조회한다. raw/full/display name을 분리하고 control character와 malformed record를 테스트한다.
ref를 생성·삭제·checkout하거나 remote에 접속하지 않는다.
```

### GIT-103 — Recent commits

```text
공통 기본 프롬프트의 <ISSUE_ID>를 GIT-103으로 바꾼다.

revision selector용 최근 commit의 full/short OID, subject, author date를 제한된 개수만 읽는다.
commit subject는 신뢰하지 않는 표시 문자열로 처리한다. empty repo, detached HEAD, unusual subject,
limit/cancel을 테스트하고 history UI는 구현하지 않는다.
```

## 5. Tree와 blob

### GIT-201 — Tree listing

```text
공통 기본 프롬프트의 <ISSUE_ID>를 GIT-201로 바꾼다.

resolve된 commit의 tree를 -z 출력으로 읽어 mode, object type/OID, size, byte path를 반환한다.
regular file, executable, symlink(120000), submodule(160000), empty tree, malformed record와
path prefix를 테스트한다. symlink/submodule을 일반 텍스트 파일로 열지 않는다.
```

### GIT-202 — Blob metadata/read/decode

```text
공통 기본 프롬프트의 <ISSUE_ID>를 GIT-202로 바꾼다.

GIT-201 tree 결과의 exact object OID를 사용하고 untrusted `commit:path` 문자열을 조합하지 않는다.
type/size를 먼저 검사한 뒤 bytes를 읽는다.
64 MiB cap을 넘으면 content를 읽지 않는다. 기존 text decoder, binary probe, EOL/final-newline
계약으로 read-only snapshot DTO를 만든다. missing path, tree, symlink mode, binary, encoding을 테스트한다.
```

### GIT-203 — Raw/LFS/no-lazy-fetch 정책

```text
공통 기본 프롬프트의 <ISSUE_ID>를 GIT-203으로 바꾼다.

Git snapshot은 raw repository blob이라는 정책을 구현하고 표준 LFS pointer를 별도 상태로
감지한다. filter, textconv, smudge, lazy fetch를 호출하지 않는다. 실제 LFS 설치나 네트워크 없이
pointer/near-miss/binary fixture와 no-network argv를 테스트한다.
```

## 6. Revision compare

### GIT-301 — Name-status parser와 service

```text
공통 기본 프롬프트의 <ISSUE_ID>를 GIT-301로 바꾼다.

두 canonical commit 사이의 --name-status -z 결과를 A/D/M/T/R과 similarity score로
파싱한다. C/U는 parser forward compatibility로만 보존하고 MVP UI 범위에 넣지 않는다.
old/new byte path, truncated record, unknown status, cancel을 테스트한다.
external diff/textconv를 허용하지 않고 blob/session 열기는 구현하지 않는다.
```

### GIT-302 — Compare session bridge

```text
공통 기본 프롬프트의 <ISSUE_ID>를 GIT-302로 바꾼다.

GIT-301 항목을 기존 2-way compare session으로 연결한다. modified와 rename은 두 snapshot,
added/deleted는 명시적 missing virtual side, binary/type-change는 안내 상태로 연다.
revision snapshot은 read-only이고 filesystem save/precondition 대상으로 위장하지 않게 테스트한다.
```

## 7. Working tree

### GIT-401 — Porcelain v2 status

```text
공통 기본 프롬프트의 <ISSUE_ID>를 GIT-401로 바꾼다.

status --porcelain=v2 -z --branch --untracked-files=all을 raw bytes로 파싱해 branch와 ordinary/rename/unmerged/
untracked 상태를 반환한다. optional repository write를 막는 실행 계약을 유지한다.
clean, unborn, detached, rename, conflict, unusual path, malformed record를 테스트한다.
```

### GIT-402 — Working-tree compare

```text
공통 기본 프롬프트의 <ISSUE_ID>를 GIT-402로 바꾼다.

working-tree regular file과 revision blob을 기존 2-way 화면에 연결한다. disk 쪽은 기존 loader와
external-change fingerprint를, snapshot 쪽은 read-only DTO를 사용한다. missing/symlink escape,
binary, encoding, dirty editor state를 테스트하고 Git index는 수정하지 않는다.
```

## 8. Conflict adapter

### GIT-501 — Conflict discovery

```text
공통 기본 프롬프트의 <ISSUE_ID>를 GIT-501로 바꾼다.

ls-files -u -z --stage를 파싱해 byte path별 stage 1/2/3 OID와 mode를 묶는다.
both-modified, add/add, modify/delete, rename/type conflict, missing stage, malformed record를 테스트한다.
status 변경, git add, continue 명령은 실행하지 않는다.
```

### GIT-502 — Conflict session

```text
공통 기본 프롬프트의 <ISSUE_ID>를 GIT-502로 바꾼다.

stage blob을 기존 3-way merge 입력으로, working-tree 파일을 Result로 연결한다. missing stage를
명시적으로 표현하고 binary/symlink/submodule conflict를 text merge에서 차단한다. merge/rebase/
cherry-pick에서 OURS/THEIRS 오해를 줄일 source label과 result-missing 상태를 테스트한다.
```

### GIT-503 — Safe result save

```text
공통 기본 프롬프트의 <ISSUE_ID>를 GIT-503으로 바꾼다.

사용자가 명시적으로 저장할 때 conflict Result 파일 하나만 기존 safe writer로 기록한다.
repo-root containment, regular-file/symlink TOCTOU, external modification, unresolved marker 경고,
backup/atomic replace/failure preservation을 테스트한다. git add/continue/commit은 실행하지 않고
저장 뒤 사용자가 terminal에서 검토할 다음 행동만 안내한다.
```

## 9. UI

### GIT-601 — Repository screen

```text
공통 기본 프롬프트의 <ISSUE_ID>를 GIT-601로 바꾼다.

사용자가 폴더를 선택해 Git repository를 여는 최소 화면과 header를 추가한다. root, 현재 branch
또는 detached HEAD, read-only 상태를 표시한다. loading/empty/error/cancel, keyboard/focus,
200% 확대를 테스트하고 repository를 자동 탐색하거나 변경하지 않는다.
```

### GIT-602 — Revision selectors

```text
공통 기본 프롬프트의 <ISSUE_ID>를 GIT-602로 바꾼다.

좌우 revision selector에 HEAD/local refs/tags와 수동 입력을 연결한다. GIT-103이 승격된 경우에만
recent commits를 추가한다.
debounce/cancel/stale response, invalid revision, 동일 revision, keyboard/focus를 테스트한다.
branch switch나 remote refresh 버튼은 추가하지 않는다.
```

### GIT-603 — Changed-files sidebar와 snapshot labels

```text
공통 기본 프롬프트의 <ISSUE_ID>를 GIT-603으로 바꾼다.

변경 파일을 상태별로 검색/필터하고 클릭하면 GIT-302 compare를 연다. rename old→new,
added/deleted/type/binary 상태와 revision/path read-only label을 색상 외 텍스트로 표시한다.
large list, stale selection, byte-path display escaping, keyboard navigation을 테스트한다.
```

### GIT-604 — Conflict list UI

```text
공통 기본 프롬프트의 <ISSUE_ID>를 GIT-604로 바꾼다.

현재 repository의 unresolved file 목록을 표시하고 한 항목을 GIT-502 session으로 연다.
missing stage/type 상태, save 뒤 refresh, stale result, empty/error, keyboard/focus를 테스트한다.
resolved 표시를 git add 완료로 오해하지 않게 하고 자동 stage/continue를 제공하지 않는다.
```

### GIT-605 — Working-tree changed-files UI

```text
공통 기본 프롬프트의 <ISSUE_ID>를 GIT-605로 바꾼다.

porcelain v2의 staged/unstaged/untracked/unmerged 목록을 상태별로 표시하고 선택 path를
GIT-402 working tree ↔ revision session으로 연다. refresh race, sparse missing, byte path,
untracked의 비교 상대 없음, keyboard/focus를 테스트한다. stage/unstage action은 추가하지 않는다.
```

### GIT-606 — 전체 tracked-file picker

```text
공통 기본 프롬프트의 <ISSUE_ID>를 GIT-606으로 바꾼다.

changed-file sidebar와 별도의 선택 기능으로 revision tree와 fuzzy path picker를 추가한다.
left/right에서 서로 다른 path도 고를 수 있게 하되 object ID와 opaque path identity를 유지한다.
10k/100k virtualization, batch/cancel/stale result, symlink/submodule/missing을 테스트한다.
changed-file 기본 흐름이나 working tree를 변경하지 않는다.
```

## 10. 3-way preview

### GIT-701 — Merge-base

```text
공통 기본 프롬프트의 <ISSUE_ID>를 GIT-701로 바꾼다.

두 canonical commit의 merge-base --all 결과를 파싱한다. base 0개, 1개, 여러 개와 cancel/
timeout을 명시적 상태로 반환한다. 여러 base를 임의 선택하거나 fetch/merge하지 않는다.
```

### GIT-702 — Revision 3-way preview

```text
공통 기본 프롬프트의 <ISSUE_ID>를 GIT-702로 바꾼다.

선택된 base/left/right blob으로 기존 3-way 화면의 read-only preview session을 만든다.
실제 Git merge 결과가 아님을 표시하고 Result 저장을 기본 비활성화한다. missing/binary/type-change,
multiple-base handoff, dirty 이탈 guard를 테스트하고 working tree/index를 수정하지 않는다.
```

## 11. 사용자 문서와 packaged smoke

### GIT-801 — User/tool docs와 packaged smoke

```text
공통 기본 프롬프트의 <ISSUE_ID>를 GIT-801로 바꾼다.

Git Compare 사용법, Git 미설치/버전/로컬 blob/LFS 제한, no-network/no-mutation, conflict 저장 뒤
수동 git add 절차를 문서화한다. difftool은 $LOCAL/$REMOTE, mergetool은
$BASE/$LOCAL/$REMOTE/$MERGED를 사용하며 merge-driver %O/%A/%B/%P와 구분한다.
현재 GUI lifecycle에서는 trustExitCode=false를 유지하고 .gitconfig를 자동 수정하지 않는다.
Windows/macOS/Linux packaged binary가 Git 임시 파일이 살아 있는 동안 block하는지와
save/cancel 후속 흐름을 smoke하고, 실제 실행 결과와 미실행 OS를 VALIDATION.md에 구분해 기록한다.
```
