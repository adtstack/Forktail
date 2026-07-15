# 20. Git Test Plan

Status: **Post-Phase 1 candidate**
Scope: Git snapshot compare, working tree compare, conflict opening, difftool/mergetool integration

이 문서는 Git 기능을 구현하기로 결정한 뒤 적용할 전용 테스트 계획이다. 현재 Phase 1의 출시 범위를 넓히거나 `docs/07_TEST_PLAN.md`의 공통 품질 gate를 대체하지 않는다. Git 기능이 시작되더라도 로컬 텍스트 비교, 결정론적 병합, 안전 저장이 먼저 안정되어 있어야 한다.

관련 문서:

- `docs/01_PRD.md` — Phase 1 범위와 로컬 우선 원칙
- `docs/02_ARCHITECTURE.md` — React/TypeScript, Tauri command, Rust 서비스 경계
- `docs/07_TEST_PLAN.md` — 공통 fixture와 CI gate
- `docs/09_RELEASE_SECURITY.md` — 네트워크 0, 경로, symlink, 저장 안전성
- `docs/17_GIT_INTEGRATION.md` — Git 기능 제품·기술 명세
- `docs/18_GIT_BACKLOG.md` — Git 이슈와 의존 관계
- `docs/21_GIT_REFERENCES.md` — Git command와 환경 변수 공식 근거

## 1. 테스트 목표

Git 통합 테스트는 화면이 Git처럼 보이는지보다 다음을 보증해야 한다.

- revision snapshot 비교가 checkout 없이 동일한 object를 재현한다.
- 앱이 branch, HEAD, index, working tree를 몰래 바꾸지 않는다.
- 허용되지 않은 Git command와 네트워크 접근이 구조적으로 차단된다.
- Git 출력은 raw bytes와 NUL delimiter를 기준으로 손실 없이 파싱한다.
- binary, symlink, submodule, LFS pointer를 일반 텍스트처럼 열지 않는다.
- conflict stage 1/2/3과 실제 작업 상태의 의미를 정확히 표시한다.
- Git conflict Result 또는 mergetool의 `$MERGED` 저장은 기존 safe-save 경로만 사용한다.
- 취소, timeout, 과대 출력, 외부 변경이 기존 파일이나 repository를 손상시키지 않는다.
- Windows, macOS, Linux의 packaged app에서 difftool/mergetool lifecycle이 예측 가능하다.

## 2. 이슈와 테스트의 단위

Git 기능도 **한 이슈, 한 PR** 원칙을 따른다. 하나의 PR에 runner, parser, UI, packaged smoke를 한꺼번에 넣지 않는다.

각 이슈는 최소한 다음을 적는다.

```text
이슈 ID
변경할 파일
수용 기준
실패/경계 조건
추가할 테스트
검증 명령
```

권장 분리는 다음과 같다.

```text
command runner
→ repository detection
→ revision resolver
→ 각 NUL parser
→ tree/blob service
→ compare session adapter
→ working tree adapter
→ conflict stage adapter
→ safe-save 연결
→ UI
→ packaged lifecycle smoke
```

parser 이슈는 실제 Git 실행이나 UI를 포함하지 않는다. 서비스 이슈는 관련 parser와 fake runner를 사용하며, UI 이슈는 안정된 Rust command 계약 위에서만 작업한다. 여러 GIT 이슈를 한 프롬프트나 한 PR로 묶지 않는다.

## 3. 테스트 계층

Git 기능은 다섯 층으로 검증한다.

```text
Pure byte/parser tests
  ↓
Allowlisted runner tests with fakes
  ↓
Rust service integration with temporary repositories
  ↓
React/Tauri command contract tests
  ↓
Packaged difftool/mergetool lifecycle smoke on three OSes
```

### 3.1 Pure byte/parser tests

대상:

- `diff --name-status -z`
- `ls-tree -r -z --long --full-tree`
- `ls-files -u -z --stage`
- `status --porcelain=v2 -z --branch --untracked-files=all`
- ref/recent-commit machine output
- object id, mode, size, missing side 변환
- UI 표시용 path sanitization과 lossless backend identity 분리

특징:

- 파일 시스템과 Git executable 없이 실행한다.
- 입력은 `String`이 아니라 `Vec<u8>` fixture를 우선한다.
- truncated record, invalid integer, unknown status, duplicate stage가 panic을 만들지 않는다.
- parser 오류에는 offset과 record 종류를 담을 수 있지만 파일 내용은 담지 않는다.

### 3.2 Fake allowlisted runner tests

대상:

- 정확한 executable/argv/environment 계약
- command allowlist와 mutation/network deny
- timeout, cancellation, stdout/stderr cap
- non-zero exit와 friendly `{ code, message }` 변환
- concurrent stdout/stderr drain
- stale async result 무시

fake runner는 실행 요청을 기록하고, 허용되지 않은 command가 들어오면 즉시 테스트를 실패시킨다. shell 문자열을 비교하는 테스트가 아니라 executable과 argv 배열을 비교한다.

### 3.3 Temporary real-repository tests

대상:

- repository/worktree 감지
- revision/ref/tree/blob 조회
- changed-file 목록
- working tree 비교
- conflict stage 읽기
- merge-base
- partial/shallow/sparse/worktree 동작

`tempfile` 기반 디렉터리만 사용한다. 전역 Git config, 실제 사용자 repository, 실제 home directory에 의존하지 않는다.

### 3.4 React/Tauri contract tests

대상:

- Rust 응답과 TypeScript 타입의 직렬화 계약
- read-only snapshot 표시
- revision/path label과 binary/missing 상태
- invalid revision, timeout, cancellation, untrusted repository 오류 UX
- 이전 요청의 늦은 응답이 현재 session을 덮지 않는지
- 저장 가능한 Result와 저장 불가능한 snapshot의 구분

Monaco나 Git 자체를 다시 테스트하지 않고 앱의 state와 command wiring을 검증한다.

### 3.5 Packaged lifecycle smoke

대상:

- 설치 또는 release artifact의 실제 executable 경로
- Git이 tool process 종료를 기다리는지
- 임시 LOCAL/REMOTE/BASE 파일이 window가 닫히기 전에 사라지지 않는지
- 저장, 취소, 닫기, process exit의 관계
- OS별 quoting과 공백·Unicode 경로

dev server나 `cargo test` 성공은 packaged lifecycle 검증을 대체하지 않는다.

## 4. 공통 테스트 도구

### 4.1 Git availability와 version

통합 테스트 시작 시 `git --version`을 확인한다.

- Git이 없으면 real-repository integration만 명시적 사유와 함께 skip한다.
- pure parser와 fake runner 테스트는 항상 실행한다.
- 최소 지원 Git version은 구현 ADR에서 고정한다.
- version별 기능은 문자열 비교보다 capability probe로 확인한다.
- SHA-256 repository나 partial clone을 지원하지 않는 Git에서는 해당 integration만 skip하고 unit fixture는 계속 실행한다.

### 4.2 Fixture Git과 production runner 분리

테스트 repository를 만들기 위한 helper는 다음과 같은 mutation을 사용할 수 있다.

```text
init
config --local
add
commit
branch/switch
merge/rebase/cherry-pick
worktree add
sparse-checkout
clone
```

이 helper는 **fixture setup 전용**이며 production `GitRunner`를 사용하지 않는다. production runner에 mutation command를 허용해 테스트를 편하게 만들지 않는다. 테스트가 끝나면 임시 repository와 격리된 HOME/config를 제거한다.

### 4.3 Isolated identity와 config

fixture repository에는 local identity를 설정한다.

```text
user.name = Forktail Test
user.email = forktail@example.test
commit.gpgSign = false
tag.gpgSign = false
```

전역 credential helper, signing key, hooks, pager, editor를 상속하지 않는다. test helper가 global config를 수정하는 테스트는 금지한다.

### 4.4 Repository fingerprint helper

read-only integration 전후에 최소한 다음을 기록한다.

```text
HEAD object id
current branch 또는 detached 상태
index bytes/hash와 modified time
tracked working tree file fingerprints
repository-local config bytes/hash
```

비교 후 값이 바뀌지 않아야 하며 `.lock` 잔여 파일도 없어야 한다. access time처럼 플랫폼이 읽기만 해도 바꿀 수 있는 metadata는 mutation 판정에 사용하지 않는다.

## 5. Production Git runner 보안 계약

### 5.1 Allowlist

production runner는 자유로운 `git <args...>` 실행기가 아니다. 초기 후보 allowlist는 다음 조회 command로 제한한다.

```text
--version
rev-parse
symbolic-ref
for-each-ref
log
ls-tree
cat-file
diff
status
merge-base
ls-files
```

각 command도 허용되는 option 형태를 검증한다. 알 수 없는 command나 option은 Git에 전달하기 전에 거절한다.

fixture setup을 제외한 앱 경로에서 다음이 한 번이라도 기록되면 실패다.

```text
checkout switch restore reset clean
add rm mv commit merge rebase cherry-pick revert
stash branch tag config worktree
clone fetch pull push ls-remote submodule
```

denylist만으로 안전을 보증하지 않는다. allowlist에 없는 미래 command도 기본 거절한다.

### 5.2 argv와 revision/path

- shell을 실행하지 않는다.
- 사용자 revision과 path는 단일 argv element로 전달한다.
- revision 검증에는 `--end-of-options`를 사용한다.
- pathspec이 필요한 command는 `--`와 literal path 정책을 사용한다.
- resolved revision은 가능한 한 immutable object id로 바꾼 뒤 후속 command에 전달한다.
- leading dash, colon, `:(magic)`, glob, newline이 포함된 입력을 fixture에 포함한다.

### 5.3 Environment

모든 production Git 실행은 최소한 다음 환경을 보장한다.

```text
GIT_TERMINAL_PROMPT=0
GIT_NO_LAZY_FETCH=1
GIT_OPTIONAL_LOCKS=0
GIT_LITERAL_PATHSPECS=1
```

의미:

- credential prompt로 앱이 멈추지 않는다.
- partial clone의 누락 object를 `cat-file` 등이 암묵적으로 다운로드하지 않는다.
- `status` 같은 조회가 index refresh를 위해 optional lock/write를 하지 않는다.
- repository path를 glob이나 pathspec magic으로 재해석하지 않는다.

또한 `--no-pager`를 사용하고, diff에는 `--no-ext-diff`, `--no-textconv`를 강제한다. `-c core.fsmonitor=false` 등 검증된 방식으로 fsmonitor hook도 비활성화한다.

Git executable을 absolute path로 확정한 뒤 child 환경은 clear하고 검토된 allowlist만 다시 넣는다. OS 구동에 필요한 `HOME`/`USERPROFILE`, `XDG_CONFIG_HOME`, `SYSTEMROOT`/`WINDIR`, temp, locale 값은 플랫폼 테스트로 고정하고, `GIT_*`는 위의 안전 값만 새로 설정한다. 다음 계열 값이 부모 process에서 상속되지 않는지 검사한다.

```text
GIT_DIR
GIT_WORK_TREE
GIT_COMMON_DIR
GIT_INDEX_FILE
GIT_OBJECT_DIRECTORY
GIT_ALTERNATE_OBJECT_DIRECTORIES
GIT_SHALLOW_FILE / GIT_NAMESPACE
GIT_CONFIG_PARAMETERS / GIT_CONFIG_COUNT
GIT_CONFIG_KEY_* / GIT_CONFIG_VALUE_*
GIT_CONFIG_GLOBAL / GIT_CONFIG_SYSTEM
GIT_ASKPASS / SSH_ASKPASS / GIT_SSH / GIT_SSH_COMMAND
GIT_EXTERNAL_DIFF
GIT_TRACE* / GIT_TRACE2*
```

테스트는 악성 상속 값을 각각 넣고도 선택한 repository 밖을 읽거나 helper process를 실행하지 않는지 확인한다. `safe.directory` 오류는 자동 우회하지 않고 행동 가능한 오류로 반환한다.

### 5.4 No-network guard

단순히 `fetch`를 호출하지 않는 것만으로 충분하지 않다. partial clone의 lazy fetch와 filter/helper 실행도 검사한다.

필수 테스트:

- promisor remote와 누락 blob이 있는 local fixture를 만든다.
- remote를 loopback sentinel 또는 호출 기록 helper로 바꾼다.
- blob read를 실행한다.
- `GIT_NO_LAZY_FETCH=1`이 전달됐는지 확인한다.
- network/helper 호출 횟수가 0인지 확인한다.
- 결과가 자동 다운로드가 아닌 typed `OBJECT_UNAVAILABLE` 계열 오류인지 확인한다.

테스트 자체도 인터넷에 접속하지 않는다. local file/loopback fixture만 사용한다.

### 5.5 Output cap, timeout, cancellation

runner는 stdout/stderr를 무제한 메모리에 모으지 않는다.

- stderr cap은 중앙 상수로 제한한다.
- refs/tree/status/changed 목록은 cap 또는 streaming parser를 사용한다.
- blob은 먼저 `cat-file -s`로 크기를 확인하고 현재 64 MiB text safety limit를 넘으면 읽지 않는다.
- stdout과 stderr를 동시에 drain해 pipe deadlock을 막는다.
- timeout과 사용자 cancellation은 동일한 typed cancellation 경로로 정리하되 UI 메시지는 구분할 수 있다.
- cancel 후 child와 Git이 만든 하위 process가 남지 않아야 한다.
- 늦게 도착한 stdout/event가 새 session에 반영되지 않아야 한다.

경계 테스트:

```text
cap - 1 byte → 성공
cap byte     → 성공
cap + 1 byte → OUTPUT_TOO_LARGE
record 중간에서 cap 도달 → partial result를 성공으로 반환하지 않음
stderr flood → bounded friendly error
timeout/cancel 경쟁 → 완료 event 1회
```

정확한 metadata/stderr cap 값은 runner 이슈에서 상수와 함께 확정한다. 테스트는 숫자를 중복 하드코딩하지 않고 production 상수를 사용한다.

## 6. Parser test matrix

### 6.1 `diff --name-status -z`

필수 사례:

```text
M\0path\0
A\0new path\0
D\0old path\0
T\0kind-change\0
U\0conflict\0
R100\0old\0new\0
R087\0old name\0new name\0
C050\0source\0copy\0
```

`C`와 `U` record는 pure parser의 공식 형식 호환성을 검증한다. MVP commit↔commit command는 `--find-renames`만 활성화하므로 copy detection과 unmerged/copy UI를 완료 기준으로 보지 않는다.

추가 검증:

- unknown status를 버리지 않고 명시적 상태/오류로 보존
- R/C score의 0, 100, malformed 값. C와 U는 parser compatibility 범위다.
- missing terminator와 missing rename target
- duplicate path
- tab, newline, Unicode, invalid UTF-8 path bytes
- added/deleted를 가짜 빈 파일과 혼동하지 않음

### 6.2 `ls-tree -r -z --long --full-tree`

필수 mode:

| Mode | 의미 | 기대 |
|---|---|---|
| `100644` | 일반 파일 | blob snapshot 후보 |
| `100755` | executable 파일 | blob + executable metadata |
| `120000` | symlink | target blob을 일반 파일로 열지 않음 |
| `160000` | submodule/gitlink | 자동 진입하지 않음 |

검증:

- SHA-1과 SHA-256 길이 object id
- size 숫자와 `-` 같은 missing size
- path 앞뒤 공백, tab, newline
- truncated header와 unknown object type
- symlink target text가 repository 밖 파일 내용으로 해석되지 않음

### 6.3 `ls-files -u -z --stage`

필수 사례:

```text
stage 1 + 2 + 3  both-modified
stage 2 + 3      add/add
stage 1 + 2      deleted by theirs
stage 1 + 3      deleted by ours
duplicate stage  malformed/explicit error
```

path별 grouping과 stage 정렬을 검증한다. stage가 없다는 사실을 empty text로 위장하지 않고 `missing`으로 보존한다.

### 6.4 `status --porcelain=v2 -z --branch --untracked-files=all`

필수 사례:

- clean/dirty
- detached HEAD
- upstream 없음
- ahead/behind
- ordinary modified/deleted
- rename의 두 path
- untracked
- unmerged
- control character와 non-UTF-8 path bytes

human-readable `git status` 문구나 locale별 stderr를 파싱하지 않는다.

### 6.5 Refs와 recent commits

- local branch, remote-tracking branch, tag를 구분한다.
- ref full name과 display short name을 별도로 보존한다.
- detached HEAD가 가짜 branch가 되지 않는다.
- commit subject의 tab/newline/control character를 UI 표시 전에 sanitize한다.
- object id 길이를 40자로 고정하지 않는다.
- record separator와 field separator를 명시적으로 검증한다.

## 7. Path와 object identity

### 7.1 Lossless backend identity

Git path는 Unix에서 유효한 UTF-8이 아닐 수 있다. UI display string을 다시 Git/path 입력으로 사용하면 안 된다.

권장 계약:

```text
backend identity: lossless bytes 또는 opaque entry id
display path: 사용자 표시용으로 안전하게 변환한 문자열
command input: opaque id를 통해 backend에서 원래 path 복원
```

현재 Tauri JSON 계약으로 lossless path를 보낼 수 없다면 지원되지 않는 path를 명시적 오류로 거절한다. replacement character를 넣은 문자열로 다른 파일을 열거나 저장하지 않는다.

필수 fixture:

- 한글, emoji
- NFC/NFD 이름
- case-only 쌍
- space, tab, newline
- leading dash
- colon과 pathspec magic 형태
- Unix invalid UTF-8 bytes
- Windows reserved-like name, long path, UNC 가능 경로

invalid UTF-8 fixture는 지원 OS에서만 실제 파일을 만들되 parser unit test는 모든 OS에서 실행한다.

### 7.2 SHA-256 repository

지원 Git에서는 다음 fixture를 만든다.

```text
git init --object-format=sha256
```

검증:

- revision resolve가 64자리 object id를 반환한다.
- ref/tree/diff/conflict model이 길이를 가정하지 않는다.
- cache key와 equality가 전체 object id를 사용한다.
- abbreviated id는 Git이 검증한 결과만 수용한다.

지원하지 않는 Git에서도 64자리 parser fixture는 skip하지 않는다.

### 7.3 Symlink와 containment

- committed mode `120000`은 symlink metadata로 표시한다.
- symlink target blob을 target 파일 내용처럼 열지 않는다.
- working-tree symlink는 기본적으로 follow하지 않는다.
- Result path가 open 뒤 symlink로 바뀌는 TOCTOU를 저장 직전에 탐지한다.
- repository root 밖으로 향하는 symlink에는 쓰지 않는다.
- Windows에서 symlink 권한이 없으면 integration만 사유와 함께 skip하고 parser/safe-save guard는 실행한다.

## 8. Real repository integration matrix

### 8.1 Repository detection

필수 사례:

- repository root
- nested directory
- non-repository
- bare repository
- detached HEAD
- `.git` directory
- `.git` file을 사용하는 linked worktree
- relative/absolute git-common-dir
- `safe.directory` 거절

초기 MVP에서 bare repository는 friendly `GIT_BARE_UNSUPPORTED` 오류를 반환한다. `--show-toplevel` 실패만으로 모든 bare/worktree 상태를 같은 오류로 뭉개지 않는다.

### 8.2 Revision resolution

- `HEAD`
- local branch
- remote-tracking branch
- annotated/lightweight tag
- full/abbreviated commit id
- `HEAD~n`
- reflog expression을 허용하는 경우
- leading dash와 invalid/ambiguous revision
- branch/tag가 같은 short name인 ref collision
- 여러 object와 일치하는 abbreviated hex
- branch가 조회와 open 사이 이동하는 경쟁

사용자가 선택한 ref는 session 시작 시 immutable commit id로 확정한다. short ref collision은 ref 후보로, abbreviated hex는 object disambiguation으로 판정하며 localized warning text를 파싱하지 않는다. ref가 나중에 이동해도 이미 열린 snapshot 내용이 조용히 바뀌지 않아야 한다.

### 8.3 Snapshot compare

필수 fixture:

- same path modified
- added/deleted one-sided view
- rename과 similarity score. copy record는 parser compatibility 범위다.
- type change
- binary NUL bytes
- UTF-8이 아닌 text candidate
- standard LFS pointer
- executable bit change
- symlink와 submodule entry
- file/directory path conflict
- blob이 현재 text limit 바로 아래/위

각 테스트는 전후 repository fingerprint가 같고 checkout이 발생하지 않았음을 확인한다.

### 8.4 Shallow clone

- local source로 shallow clone fixture를 만든다.
- 존재하는 local commit/blob은 읽힌다.
- depth 밖 revision은 자동 fetch 없이 typed missing-object/invalid-revision 오류가 된다.
- credential prompt나 network helper가 실행되지 않는다.

### 8.5 Partial clone

- local promisor fixture에서 존재하는 blob과 누락 blob을 나눈다.
- 존재하는 object는 정상 조회한다.
- 누락 object는 `GIT_NO_LAZY_FETCH=1`로 다운로드하지 않는다.
- remote/helper invocation이 0인지 확인한다.
- LFS pointer도 자동 smudge/fetch하지 않는다.

### 8.6 Linked worktree

- main worktree와 linked worktree를 함께 만든다.
- 각 root, git-dir, common-dir, HEAD/branch를 구분한다.
- 한 worktree의 compare가 다른 worktree의 index나 working files를 바꾸지 않는다.
- linked worktree conflict Result는 선택한 worktree 안의 path만 가리킨다.

### 8.7 Sparse checkout

- committed tree에는 있지만 working tree에는 materialize되지 않은 파일을 만든다.
- revision snapshot compare는 정상 동작한다.
- working-tree compare는 missing side를 명시한다.
- 앱이 sparse checkout 설정을 바꾸거나 파일을 materialize하지 않는다.

## 9. Conflict integration

### 9.1 Fixture matrix

- merge both-modified
- add/add
- modify/delete와 delete/modify
- rename/rename 또는 rename/delete
- binary conflict
- symlink/type conflict
- conflict path의 tab/newline/Unicode
- rebase conflict
- cherry-pick conflict
- stage 1이 없는 conflict
- working tree Result가 외부에서 다시 수정된 경우

merge/rebase/cherry-pick는 fixture helper만 실행한다. 앱 production runner는 이 command를 호출하지 않는다.

### 9.2 Stage와 label

object mapping은 항상 다음 사실을 기준으로 한다.

```text
stage 1 = base
stage 2 = ours slot
stage 3 = theirs slot
```

그러나 사용자에게 보이는 `ours/theirs` 의미는 작업에 따라 달라질 수 있다.

- 일반 merge: stage 2는 현재 HEAD 쪽, stage 3은 병합 대상 쪽이다.
- cherry-pick: stage 2는 현재 HEAD 쪽, stage 3은 적용 중 commit 쪽이다.
- rebase: stage 2는 upstream 위에 재작성 중인 쪽이고 stage 3은 재적용 중 commit 쪽이므로 사용자가 기대하는 branch 이름과 반대로 느낄 수 있다.

테스트는 repository state를 감지해 panel label이 실제 source를 설명하는지 확인한다. 상태를 확정할 수 없으면 단순히 `Ours/Theirs`라고 단정하지 않고 `Stage 2/Stage 3`과 commit 정보를 표시한다. stage가 없는 side는 deleted/missing으로 표시한다.

### 9.3 Result load

- Base/Ours/Theirs는 index object에서 raw bytes로 읽는다.
- Result는 해당 worktree의 working file에서 읽는다.
- binary stage가 하나라도 있으면 text merge를 차단한다.
- conflict marker가 있는 Result는 `MRG-012` 수준의 parser를 재사용한다. 기본 `<<<<<<< HEAD` label과 base 없는 marker를 인식하지 못하면 mergetool smoke를 시작하지 않는다.
- stage content와 Result content를 로그나 오류에 포함하지 않는다.

## 10. `$MERGED` fingerprint와 safe save

Git conflict session과 `--mergetool "$BASE" "$LOCAL" "$REMOTE" "$MERGED"` session은 Result 또는 `$MERGED`를 열 때 다음 fingerprint를 보관한다. `%O/%A/%B/%P`는 custom merge driver용이므로 이 test plan의 mergetool 입력으로 사용하지 않는다.

```text
canonical/display path
file kind
size
modified time
가능하면 quick/full hash
symlink 여부
```

저장 직전에 fingerprint와 path containment를 다시 검사한다. 다르면 기존 `FILE_CHANGED` 흐름처럼 reload, overwrite confirmation, save copy를 제공한다. Git이 파일을 다시 썼거나 path가 symlink로 바뀌었는데 조용히 덮어쓰지 않는다.

저장은 반드시 기존 safe-save 서비스를 사용한다.

```text
external modification check
→ backup
→ target과 같은 directory의 temp file
→ write all
→ flush/fsync
→ permission 보존
→ atomic replace
→ 가능한 OS에서 parent fsync
```

필수 테스트:

- 저장은 `$MERGED`/Result 한 파일만 바꾼다.
- BASE/LOCAL/REMOTE snapshot과 Git index는 Forktail 프로세스가 실행되는 동안 바뀌지 않는다.
- `git add`, continue, commit을 실행하지 않는다.
- backup 실패 시 기존 target을 보존한다.
- write/flush/fsync/replace fault마다 기존 target을 보존한다.
- unresolved marker 저장 guard가 기존 MRG-007 정책과 일치한다.
- 저장하지 않고 닫으면 MERGED fingerprint와 bytes가 그대로다.
- 외부 수정 뒤 저장은 명시적 사용자 선택 없이는 실패한다.
- Windows file lock/read-only attribute, Unix permission, symlink swap을 포함한다.

repository-aware conflict 화면의 성공 메시지는 파일 저장만 완료됐고 사용자가 terminal에서 `git add`와 후속 작업을 해야 함을 안내한다. 외부 `git mergetool` mode에서는 Forktail이 index를 바꾸지 않았으며, 앱 종료 뒤 Git의 확인 결과에 따라 wrapper가 stage할 수 있음을 구분해 안내한다.

## 11. UI와 command contract tests

### 11.1 Revision compare UI

- repository 선택 취소는 오류가 아니다.
- left/right revision validation은 stale request를 구분한다.
- snapshot pane은 read-only임을 표시한다.
- label에는 raw ref와 resolved commit/path를 혼동 없이 표시한다.
- added/deleted/missing/binary/symlink/submodule 상태는 색상 외 text label이 있다.
- refresh가 working tree나 branch를 바꾸지 않는다.
- cancel 후 spinner와 keyboard focus가 복구된다.
- `GIT-605` working-tree 목록은 staged/unstaged/untracked/unmerged를 구분하고 mutation action을 노출하지 않는다.
- `GIT-606` 전체 tracked-file picker는 changed-file 기본 흐름과 분리하고 large tree를 virtualize한다.

### 11.2 Conflict UI

- conflict 목록과 stage availability가 일치한다.
- rebase/cherry-pick label이 작업 상태를 설명한다.
- Result만 편집 가능하다.
- 저장 전 external-change/unresolved guard가 작동한다.
- 저장 후에도 자동 stage/continue를 하지 않았다는 안내가 보인다.
- 200% 확대와 keyboard-only 흐름을 확인한다.

### 11.3 Stable error contract

최소 오류 분류:

- Git executable 없음
- repository 아님/신뢰되지 않음
- invalid/ambiguous revision
- local object 없음
- binary/non-blob/unsupported symlink 또는 submodule
- output cap 초과
- timeout/cancel
- external modification/path conflict
- Git command 실패

모든 오류는 안정된 `{ code, message }`로 직렬화한다. raw stderr, argv 전체, 파일 내용은 사용자 메시지나 기본 로그에 노출하지 않는다.

## 12. Difftool/mergetool packaged lifecycle

### 12.1 공통 격리

- 임시 repository와 격리된 HOME/XDG/config를 사용한다.
- global `.gitconfig`를 수정하지 않는다.
- test 종료 시 repo-local tool config를 제거한다.
- 실제 인터넷 remote와 credential helper를 사용하지 않는다.
- 개발용 Vite URL이 아니라 packaged/release executable을 실행한다.

### 12.2 Difftool

검증 흐름:

```text
temp repo에 두 commit 생성
→ repo-local difftool config
→ git difftool --no-prompt 실행
→ LOCAL/REMOTE가 올바른 pane에 열림
→ snapshot은 read-only
→ window를 닫을 때까지 Git tool process가 기다림
→ 종료 뒤 temp path lifecycle과 exit 상태 확인
```

필수 사례:

- 파일명과 executable path에 공백/Unicode
- added/deleted file
- 여러 파일 호출의 순차 lifecycle
- 사용자가 창을 닫음/앱 crash/launch 실패
- LOCAL/REMOTE temp file이 앱이 읽기 전에 정리되지 않음

### 12.3 Mergetool

검증 흐름:

```text
temp repo에 실제 conflict 생성
→ repo-local mergetool config (`trustExitCode=false`, `hideResolved=false`)
→ BASE/LOCAL/REMOTE/MERGED 전달; 빈 BASE 인자도 보존
→ MERGED fingerprint 저장
→ 사용자 resolve/save
→ packaged process 종료
→ working file bytes와 Git 후속 상태 확인
```

초기 계약은 `trustExitCode = false`와 tool-specific `hideResolved = false`를 유지한다. 앱 lifecycle과 저장 여부를 신뢰 가능한 exit code로 전달하는 별도 이슈와 세 OS smoke가 완료되기 전에는 `true`로 바꾸지 않는다.

필수 사례:

- save 후 MERGED만 변경
- no-save close 후 원본 유지
- unresolved save 취소
- 외부 MERGED 변경과 저장 경쟁
- BASE가 없는 add/add conflict에서 empty argument가 parser에서 사라지지 않고 missing Base가 됨
- Forktail 저장 직후·프로세스 종료 전에는 index가 그대로임
- process 종료 뒤 사용자가 성공을 확인하면 Git wrapper가 stage할 수 있으며 그 후속 상태가 문서와 일치함
- 앱은 자동 `git add`나 continue를 하지 않음

### 12.4 OS별 executable와 wait

| OS | 검증 포인트 |
|---|---|
| Windows | 설치된 `.exe`, backslash/drive/UNC, file lock, quoting, process wait |
| macOS | `.app` 내부 실제 executable 또는 검증된 `--wait` launcher, notarized/ad-hoc artifact, NFC/NFD path |
| Linux | AppImage/지원 binary, executable bit, desktop 환경과 무관한 process wait, oldest supported glibc |

macOS의 단순 `open App.app`처럼 즉시 반환하는 launcher는 Git tool 계약으로 인정하지 않는다. Git이 session window 종료까지 기다릴 수 있는 실행 경로를 검증해야 한다.

## 13. 성능과 대규모 repository

후보 fixture:

- changed path 10,000/100,000개
- ref/tag 10,000개
- 매우 긴 path와 깊은 tree
- 64 MiB 직전/초과 blob
- stderr flood
- rename 후보가 많은 diff
- conflict file 1,000개

검증:

- UI thread를 100ms 이상 막는 parsing/service 작업이 Rust async/worker 경로에 있다.
- list는 batch/stream 또는 명시된 cap을 지킨다.
- cancellation latency를 기록한다.
- cache는 repository identity + immutable object id를 key로 사용한다.
- cache에 파일 내용이나 path가 영구 저장되지 않는다.
- memory peak와 duration baseline을 기록하되 성능 실패를 이유로 안전 cap을 완화하지 않는다.

대규모 fixture는 nightly/benchmark lane으로 분리할 수 있지만 cap, cancellation, parser truncation unit test는 모든 PR에서 실행한다.

## 14. CI와 검증 명령

Git 기능 PR도 기존 전체 gate를 통과해야 한다.

프런트엔드:

```bash
npm run typecheck
npm test
npm run build
```

Rust:

```bash
cd src-tauri
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
```

로컬 desktop 준비 확인:

```bash
npm run doctor
npm run tauri dev
```

CI 구성:

- 모든 PR: parser, fake runner, TS/Rust contract, 일반 temp repo integration
- Windows/macOS/Linux matrix: OS path, cancellation, symlink 가능 범위, safe-save integration
- nightly/weekly: large repo, SHA-256, partial/shallow clone, linked worktree, sparse checkout
- release candidate: 세 OS packaged difftool/mergetool lifecycle

Git 미설치나 선택 기능 미지원 skip은 테스트 결과에 이유와 probe 결과를 남긴다. 테스트 실패를 skip으로 바꾸거나 fixture를 약화해 통과시키지 않는다.

## 15. 수동 QA checklist

각 지원 OS에서:

- [ ] 실제 repository를 열고 두 branch를 비교한다.
- [ ] `HEAD~n`과 `HEAD`를 비교한다.
- [ ] added/deleted/renamed/type-changed 항목을 연다.
- [ ] binary, symlink, submodule, LFS pointer가 안전하게 차단/표시된다.
- [ ] working tree 파일과 revision blob을 비교한다.
- [ ] compare 전후 branch, HEAD, index, working files가 그대로다.
- [ ] timeout과 사용자 cancel 후 Git/child process가 남지 않는다.
- [ ] 실제 merge conflict를 열고 stage source label을 확인한다.
- [ ] 실제 rebase conflict에서 stage 2/3 label이 오해를 만들지 않는다.
- [ ] Result를 해결하고 저장해 backup과 working file을 확인한다.
- [ ] 저장 후에도 Git index가 unmerged 상태이며 자동 `git add`가 없음을 확인한다.
- [ ] MERGED를 외부에서 수정한 뒤 overwrite guard를 확인한다.
- [ ] packaged binary를 difftool로 실행하고 window 종료까지 wait하는지 확인한다.
- [ ] packaged binary를 mergetool로 실행해 save/no-save lifecycle을 확인한다.
- [ ] network/credential prompt가 한 번도 나타나지 않는다.

## 16. Git 기능 완료 기준

Git 기능의 한 milestone은 관련 이슈들의 테스트만 통과했다고 완료가 아니다. 다음 조건을 모두 만족해야 한다.

- production runner allowlist와 no-network/mutation guard가 있다.
- parser가 raw bytes, NUL, truncated/unknown input을 처리한다.
- SHA-1 길이 가정이 없고 SHA-256 fixture가 있다.
- non-UTF-8 path의 lossless 처리 또는 명시적 거절 정책이 검증된다.
- shallow/partial/worktree/sparse 상태가 repository를 움직이지 않는다.
- conflict stage와 rebase label이 실제 Git 의미와 일치한다.
- MERGED fingerprint와 기존 safe-save fault test를 통과한다.
- Windows/macOS/Linux packaged lifecycle 결과가 기록된다.
- `docs/07_TEST_PLAN.md`의 공통 gate와 이 문서의 관련 gate가 모두 통과한다.
- 구현 문서와 실제 command/환경/오류 계약이 일치한다.
