# 17. Git Integration Roadmap

> **상태:** Proposed — Phase 1 이후 후보
>
> **대상:** Windows, macOS, Linux의 Tauri 2 + React/TypeScript + Rust 앱
>
> **원칙:** 로컬 Git snapshot을 읽되 repository 상태는 움직이지 않는다. 사용자가 명시적으로 Git conflict 결과를 저장할 때만 working tree 파일 하나를 쓴다.

## 1. 문서 역할과 우선순위

이 문서는 branch, tag, commit, working tree, index stage를 기존 2-way/3-way 화면에 연결하는 후속 제품·기술 명세다. 현재 Phase 1 범위를 넓히거나 `docs/04_BACKLOG.md`에 있는 확정 이슈를 자동으로 승격하지 않는다.

문서 간 역할은 다음과 같다.

| 문서 | 역할 |
|---|---|
| `docs/01_PRD.md` | Phase 1 제품 경계 |
| `docs/02_ARCHITECTURE.md` | 현재 앱과 외부 mergetool의 최소 계약 |
| `docs/04_BACKLOG.md` | 확정된 Phase 1 이슈 |
| `docs/14_PRODUCT_GAP_ROADMAP.md` | 후속 기능 후보와 우선순위 |
| `docs/17_GIT_INTEGRATION.md` | repository-aware Git 기능의 제안 명세 |
| `docs/18_GIT_BACKLOG.md` | Git 후보를 구현 가능한 작업으로 나눈 목록 |
| `docs/20_GIT_TEST_PLAN.md` | Git 전용 검증 계약 |
| `specs/001-git-snapshot-integration/` | Spec Kit 기반 사용자 시나리오, 구현 계획, 계약, 작업 추적 |

`MRG-009`, `MRG-014`, `INT-002`는 외부 `git mergetool`/`git difftool` 연결을 다룬다. 이 문서의 `GIT-*`는 앱이 Git object database와 index를 직접 읽는 더 큰 후속 트랙이다. 둘을 같은 완료 상태로 취급하지 않는다.

## 2. 왜 필요한가

개발자는 checkout이나 branch switch 없이 다음을 자주 확인한다.

```text
main의 파일       ↔ feature의 파일
HEAD~10의 파일    ↔ HEAD의 파일
특정 commit 파일  ↔ 현재 working tree 파일
index stage 1/2/3 → conflict result
```

Forktail은 새 Git 클라이언트를 만드는 대신, Git이 이미 보관한 immutable snapshot을 읽어 기존 비교·병합 화면에 연결한다. 핵심 가치는 history 탐색의 폭이 아니라 **working tree를 건드리지 않는 빠른 검토**다.

## 3. 시작 게이트

repository-aware Git 작업은 다음 조건을 만족한 뒤 시작한다.

- `RTM-001`, `RTM-002`: 실제 Tauri runtime과 packaged WebView smoke가 안정됨
- `SAV-007`, `SAV-008`: Windows atomic replace와 외부 변경 precondition이 검증됨
- `MRG-012`: 기본 Git marker와 base 없는 marker를 안전하게 파싱함
- `MRG-014`: 세 OS packaged `git mergetool` lifecycle smoke가 끝남
- `INT-002`: 자동 `.gitconfig` 수정 없이 안전한 설정 안내가 확정됨
- `GIT-000`: Git CLI 2.45.0+와 fail-closed capability gate, positive allowlist,
  no-network/no-mutation runner 결정을 `ADR-010`으로 승인함

현재 코드의 `--mergetool` 인자 parser는 scaffold다. 다음이 확인되기 전에는 완성된 Git integration으로 표시하지 않는다.

- session origin을 일반 merge와 구분한다.
- Git이 만든 `$MERGED`를 초기 Result로 읽고 fingerprint를 보관한다.
- Git 임시 파일을 recent session, active-session restore, recovery draft에 저장하지 않는다.
- 미해결 conflict를 성공 저장으로 오인하지 않도록 mergetool 전용 저장·종료 흐름을 둔다.
- Git의 `.orig`와 Forktail의 `.bak.*`가 함께 생길 수 있음을 UI와 문서에서 설명한다.

## 4. 단계별 범위

### Git-0. 외부 tool adapter 안정화

- `git difftool`이 준 `$LOCAL`, `$REMOTE`를 read-only 2-way로 연다.
- `git mergetool`이 준 `$BASE`, `$LOCAL`, `$REMOTE`, `$MERGED`를 3-way로 연다.
- `$BASE`가 빈 인자이거나 사용할 수 없으면 CLI가 이를 버리지 않고 missing Base로 연다.
- 앱 프로세스가 닫히기 전 Git이 임시 파일을 정리하지 않도록 lifecycle을 검증한다.
- 현재 GUI 계약에서는 `trustExitCode = false`를 유지한다.

### Git-1. Read-only revision compare

- 사용자가 고른 로컬 repository 감지
- local branch, remote-tracking branch, tag, commit, `HEAD~n` 해석
- 두 revision 사이 changed-file 목록
- revision의 raw blob을 checkout 없이 읽어 기존 diff viewer에 연결
- working tree 파일과 revision blob 비교
- rename의 old path와 new path 비교. copy detection은 MVP 이후 후보
- binary, symlink, submodule, LFS pointer를 텍스트로 위장하지 않음

여기서 remote-tracking branch는 **로컬에 이미 있는 ref**다. 자동 `fetch`를 의미하지 않는다.

### Git-2. Index-stage conflict adapter

- unmerged path 목록
- index stage 1/2/3을 Base/Ours/Theirs snapshot으로 읽기
- working tree path를 Result로 열기
- Result 파일만 기존 safe writer로 저장
- `git add`, `git * --continue`, commit을 실행하지 않음

### Git-3. Merge-base preview

- 두 revision의 merge base가 하나일 때 read-only 3-way preview
- merge base가 0개 또는 여러 개면 자동 선택하지 않음
- preview result는 임시 메모리 버퍼이며 기본 저장 금지
- 실제 Git merge 결과와 동일하다고 표현하지 않음

### Git-4. Review productivity

- `HEAD ↔ index`, `index ↔ working tree`, `HEAD ↔ working tree`의 read-only 비교
- 현재 session의 viewed/unviewed 상태와 다음 미검토 파일 탐색
- immutable text snapshot의 명시적 plain unified patch Save As
- 선택 path의 bounded local file history에서 두 snapshot 비교
- blob/diff/Git 임시 path는 review state나 recent session에 저장하지 않음

이 단계는 read-only MVP가 실제 review 시간을 줄인다는 증거 뒤에 승격한다. stage/unstage, full history
graph, 자동 fetch는 포함하지 않는다.

### 명시적 범위 밖

- checkout, switch, restore, reset
- pull, fetch, push, clone
- add, stage, unstage, commit
- merge, rebase, cherry-pick, revert 실행 또는 continue
- branch/tag 생성·삭제
- stash apply/pop
- submodule 재귀 탐색
- Git LFS 다운로드
- credential 입력과 remote 인증
- `.gitconfig`, `.gitattributes`, repository config 자동 수정
- custom merge driver
- history graph와 Git 클라이언트 전체 기능
- `forktail git cat`처럼 blob 내용을 stdout에 내보내는 headless 진단 CLI. metadata-only CLI도 별도 보안·제품 이슈로 다룬다.

## 5. 핵심 사용자 여정

### GUC-001. Branch 사이의 같은 파일 비교

사용자는 Left에 `main`, Right에 `feature/login`을 선택하고 changed-file 목록에서 파일을 연다.

수용 기준:

- 현재 branch, HEAD, index, working tree byte가 바뀌지 않는다.
- 화면에 양쪽 canonical commit과 사용자가 입력한 revision label을 표시한다.
- 한쪽에 파일이 없으면 `missing` snapshot으로 명시하고 빈 파일로 위장하지 않는다.

### GUC-002. 같은 branch의 서로 다른 시점 비교

사용자는 `main~10`과 `main`을 입력한다.

수용 기준:

- revision을 먼저 immutable object ID로 확정한 뒤 후속 명령에 사용한다.
- short ref가 branch/tag 등 여러 full ref와 일치하는지 ref 목록으로 먼저 확인한다.
- abbreviated hex object는 disambiguation 결과를 확인해 0/1/여러 후보를 invalid/resolved/ambiguous로 구분한다.
- localized stderr warning을 ambiguity 판정 근거로 사용하지 않는다.
- reflog/date 표현식은 재현성이 낮은 advanced input으로 표시한다.

### GUC-003. Working tree와 revision 비교

사용자는 현재 disk 파일과 `HEAD` 또는 다른 local revision의 blob을 비교한다.

수용 기준:

- disk 파일은 기존 `read_text_file`의 크기, binary, encoding 정책을 통과한다.
- snapshot side는 항상 read-only다.
- 앱 내부의 아직 저장하지 않은 편집 버퍼와 disk working tree를 같은 것으로 표시하지 않는다.

### GUC-004. Rename 비교

`OldName`에서 `NewName`으로 바뀐 entry를 old snapshot과 new snapshot으로 연다.

수용 기준:

- rename similarity score를 참고 정보로 표시한다.
- score를 동일성 보장으로 사용하지 않는다.
- old/new path가 달라도 각 revision의 정확한 object ID를 읽는다.

### GUC-005. Unmerged conflict 열기

사용자는 unmerged path를 선택하고 stage 1/2/3과 working tree result를 연다.

수용 기준:

- 없는 stage는 명시적인 missing side다.
- merge/rebase/cherry-pick 중 무엇인지 가능한 범위에서 표시한다.
- rebase에서 Ours/Theirs의 의미가 직관과 다를 수 있음을 commit/ref label로 보완한다.
- 저장 직전 index stage와 Result fingerprint가 바뀌었는지 다시 확인한다.
- 저장 후에도 index는 unmerged 상태이며 사용자가 terminal에서 후속 작업을 한다.

### GUC-006. Staged와 unstaged 변경 분리 검토

사용자는 같은 path에서 `HEAD ↔ index` 또는 `index ↔ working tree`를 선택한다.

수용 기준:

- stage 0 index snapshot과 disk working tree를 구분한다.
- staged와 unstaged 변경이 동시에 있어도 선택한 구간만 표시한다.
- index와 working tree를 바꾸는 stage/unstage action을 제공하지 않는다.

### GUC-007. 큰 변경 집합 검토 완료

사용자는 changed-file 목록에서 다음 미검토 항목으로 이동하고 필요하면 snapshot diff를 patch로 내보낸다.

수용 기준:

- viewed 상태는 현재 revision pair와 session에 scoped한다.
- revision pair가 바뀌면 stale viewed 상태를 재사용하지 않는다.
- patch export는 사용자 지정 새 대상만 쓰고 source repository를 바꾸지 않는다.
- persistent settings/recent session에 blob, diff, opaque path id, Git 임시 path를 남기지 않는다.

## 6. UX 구조

시작 화면의 Git entry는 Git-1 UI가 실제로 준비된 뒤 추가한다.

```text
Open Files
Open Folders
New 3-Way Merge
Open Git Repository       # Git-1 이후
Open Git Conflict         # Git-2 이후
```

Git compare 화면:

```text
┌──────────────────────────────────────────────────────────┐
│ Repository  ~/dev/project     branch: feature     Local  │
├──────────────────────────────────────────────────────────┤
│ Left: main ▼                 Right: feature ▼             │
│ Filter: src/config                                      │
├──────────────────┬───────────────────────────────────────┤
│ Changed files    │ Read-only Diff Viewer                 │
│ M src/app.ts     │ main@abc123 : src/app.ts              │
│ R old → new      │ feature@def456 : src/app.ts           │
│ A src/new.ts     │                                       │
└──────────────────┴───────────────────────────────────────┘
```

필수 표시:

- repository root와 worktree 여부
- 사용자 입력 revision과 resolved commit의 짧은 표시
- working tree / committed blob / index stage / missing 구분
- read-only snapshot badge
- raw blob이라 line-ending filter나 textconv가 적용되지 않았다는 설명
- binary, LFS pointer, submodule, symlink 상태

Git 화면에는 checkout, pull, push, stage, commit button을 두지 않는다.

기본 sidebar는 changed-file 목록이다. 전체 tracked-file tree와 fuzzy path picker는 read-only MVP의 사용성이 확인된 뒤 `GIT-606`으로 추가한다. working tree modified-file 목록에서 revision compare를 여는 흐름은 `GIT-605`로 분리한다.

### 핵심 오류와 완료 copy

지역화 문구는 바뀔 수 있지만 사용자가 취할 행동은 안정된 계약으로 유지한다.

```text
GIT_NOT_REPOSITORY
이 폴더는 Git 저장소가 아닙니다. 다른 폴더를 선택하거나 일반 파일 비교를 사용하세요.

GIT_INVALID_REVISION
Git revision을 찾을 수 없습니다. branch, tag, commit hash 또는 HEAD~3 형식을 확인하세요.

GIT_AMBIGUOUS_REVISION
여러 ref 또는 object가 같은 이름과 일치합니다. full ref 이름이나 더 긴 commit hash를 사용하세요.

GIT_OBJECT_MISSING_LOCAL
이 snapshot은 로컬에 없습니다. Forktail은 자동 fetch하지 않습니다.

GIT_PATH_NOT_AT_REVISION
이 파일은 선택한 revision에 없습니다. 다른 path 또는 revision을 선택하세요.

GIT_BINARY_BLOB
이 Git object는 텍스트로 안전하게 열 수 없습니다. metadata만 표시합니다.

CONFLICT_SAVED
결과 파일만 저장했습니다. Forktail은 git add나 continue를 실행하지 않았습니다.
```

## 7. 아키텍처

```text
React Git screen
  └─ typed request only; arbitrary argv 전달 금지
       ↓
Tauri commands (`commands/git.rs`)
  └─ path/revision/limit 검증, AppError 변환
       ↓
Rust Git services
  ├─ repository/revision/tree/blob/status/conflict
  ├─ allowlisted Git runner
  └─ bytes → 기존 text/binary/encoding pipeline
       ↓
local Git executable + local object database
```

제안 파일 구조:

```text
src-tauri/src/
  commands/git.rs
  domain/git.rs
  git/
    runner.rs
    repository.rs
    revision.rs
    refs.rs
    tree.rs
    blob.rs
    changed_files.rs
    status.rs
    conflicts.rs
    parsers.rs

src/
  components/GitCompareView.tsx
  components/GitConflictView.tsx
  core/gitModels.ts
  core/gitSession.ts
```

실제 도입 시 모듈 수는 이슈 크기에 맞춰 늘린다. 처음부터 빈 추상화 파일을 모두 만들지 않는다.

### 계층 책임

React/TypeScript:

- revision selector와 changed-file list 상태
- read-only label과 사용자 메시지
- 기존 diff/merge component에 typed session 전달
- cancel/refresh와 stale result 무시

Rust/Tauri:

- Git executable 실행과 allowlist
- repository/path/revision 검증
- raw byte/NUL parser
- object size와 output limit
- working tree containment와 symlink 확인
- `{ code, message }` 오류 반환

순수 코어:

- name-status, ls-tree, porcelain v2, unmerged stage parser
- status 분류와 rename mapping
- LFS pointer 판별
- object ID와 path identity 검증

프런트엔드에 executable path, raw argv, shell string을 넘겨 실행하게 하지 않는다.

## 8. 데이터 계약

object ID를 SHA-1 40자로 가정하지 않는다. SHA-256 repository도 표현할 수 있어야 한다.

```ts
interface GitObjectId {
  algorithm: "sha1" | "sha256" | "unknown";
  hex: string;
}

interface GitRevision {
  raw: string;
  resolved: GitObjectId;
  kind: "head" | "branch" | "remoteBranch" | "tag" | "commit" | "symbolic";
}

interface GitPathIdentity {
  opaqueId: string;
  displayPath: string;
  utf8Path: string | null;
}

interface GitChangedFile {
  status: "added" | "deleted" | "modified" | "renamed" | "copied" | "typeChanged" | "unmerged" | "unknown";
  oldPath: GitPathIdentity | null;
  newPath: GitPathIdentity | null;
  similarityScore: number | null;
}
```

Git path는 byte sequence다. Unix에서 UTF-8이 아닌 path를 lossy string으로 바꾼 뒤 다시 Git이나 filesystem에 전달하지 않는다.

- UI에는 `displayPath`를 안전하게 표시한다.
- 후속 요청은 `opaqueId`로 원래 byte identity를 찾는다.
- `opaqueId`는 repository + session에 scoped하고 refresh/close 때 폐기한다. 다른 repository나 session에서 재사용하지 않는다.
- OS path로 lossless 변환할 수 없으면 명시적인 `GIT_PATH_UNSUPPORTED` 오류를 낸다.
- control character는 escape해서 표시하되 실제 identity는 유지한다.

snapshot은 기존 `FileDocument`와 같은 텍스트 메타데이터를 사용하되 origin과 쓰기 가능성을 분리한다.

```ts
interface GitSnapshotDocument {
  origin: "committedBlob" | "indexStage" | "workingTree" | "missing";
  label: string;
  text: string;
  readOnly: boolean;
  objectId: GitObjectId | null;
  path: GitPathIdentity | null;
  mode: string | null;
}
```

mode `120000` symlink와 `160000` submodule는 blob/commit type만 보고 일반 텍스트 파일로 열지 않는다.

## 9. Git runner 보안 계약

### 9.1 Positive allowlist

운영 runner는 자유 형식 command나 subcommand name을 받지 않는다. 내부 enum 또는 전용 service의 typed
product operation만 아래 Git builtin과 고정 option 조합을 만들 수 있다. 각 operation은 exact argv
constructor를 소유하고, 같은 builtin이라도 allowlist에 없는 option 조합은 시작 전에 거절한다.

```text
version
rev-parse
symbolic-ref
for-each-ref
log
ls-tree
cat-file
diff (name-status only)
status (porcelain only)
ls-files (unmerged/stage only)
merge-base
```

denylist는 추가 방어일 뿐 주 경계가 아니다. 테스트 fixture helper에서 쓰는 `init`, `add`, `commit`, `switch`, `merge`는 운영 runner와 다른 타입/모듈에 둔다.

### 9.2 Process 실행

- Rust `std::process::Command` 또는 검증된 async wrapper에 executable과 argv 배열을 직접 전달한다.
- shell, Tauri shell plugin, 문자열 command 조합을 사용하지 않는다.
- stdout/stderr를 동시에 drain해 pipe deadlock을 막는다.
- timeout, cancellation, child/process-tree 종료를 지원한다.
- metadata stdout과 stderr에 별도 크기 한도를 두고 초과 시 종료한다.
- blob은 먼저 type과 size를 확인하고 Phase 1의 64 MiB 한도를 넘으면 내용을 읽지 않는다.
- raw stderr, 전체 path, revision input을 사용자 메시지나 외부 로그에 그대로 싣지 않는다.

### 9.3 공통 옵션과 환경

지원되는 모든 Git 실행에는 다음 global option을 필수로 사용한다.

```text
--no-pager
--no-optional-locks
--no-lazy-fetch
--no-replace-objects
--literal-pathspecs
```

의도:

- optional index refresh write를 막는다.
- partial clone의 missing object를 remote에서 lazy fetch하지 않는다.
- replacement ref 때문에 같은 object ID가 다른 내용으로 보이지 않게 한다.
- Git이 반환한 path를 pathspec magic으로 다시 해석하지 않는다.

환경은 최소한 다음을 강제한다.

```text
GIT_TERMINAL_PROMPT=0
GIT_OPTIONAL_LOCKS=0
GIT_NO_LAZY_FETCH=1
GIT_LITERAL_PATHSPECS=1
GIT_PAGER=cat
```

Git executable을 absolute path로 먼저 확정한 뒤 child 환경은 `env_clear`에 준하는 allowlist로 다시 구성한다. OS 구동에 필요한 `HOME`/`USERPROFILE`, `XDG_CONFIG_HOME`, `SYSTEMROOT`/`WINDIR`, temp와 locale처럼 검토된 값만 복원한다. 모든 `GIT_*`는 위에서 명시한 안전 값만 새로 설정한다. 이 방식으로 `GIT_DIR`, `GIT_WORK_TREE`, `GIT_COMMON_DIR`, `GIT_INDEX_FILE`, object/alternate/shallow/namespace override, `GIT_CONFIG_*`, askpass/SSH, `GIT_TRACE*`/`GIT_TRACE2*`, `GIT_EXTERNAL_DIFF`를 상속하지 않는다. 검증한 `-C <repo>`만 repository context로 사용한다.

`status`처럼 working tree를 보는 명령은 `-c core.fsmonitor=false`로 외부 fsmonitor hook 실행을 막는다. `diff`에는 `--no-ext-diff`, `--no-textconv`를 명시한다. filter/textconv를 적용한 보기 모드는 외부 프로세스나 네트워크를 부를 수 있으므로 초기 범위에 없다.

Git의 `safe.directory` 오류를 `safe.directory=*`로 우회하지 않는다. 소유권이 의심되는 repository는 사용자가 terminal에서 신뢰 여부를 결정하게 한다.

### 9.4 최소 버전과 capability gate (`GIT-000`)

최소 지원 버전은 **Git 2.45.0**이다. 이 버전은 필수 safety option인 `--no-lazy-fetch`를 제공하는
첫 문서화 버전이며, 더 낮은 버전에서 option을 빼고 실행하는 fallback은 없다. 숫자 비교만으로 vendor
build를 신뢰하지 않고 다음 capability를 fail-closed로 확인한다.

| 시점 | 필수 probe | 실패 처리 |
|---|---|---|
| executable discovery | absolute regular executable, parseable `git version >= 2.45.0` | `GIT_NOT_FOUND` 또는 `GIT_VERSION_UNSUPPORTED` |
| runner bootstrap | `--no-pager --no-lazy-fetch --no-optional-locks --no-replace-objects --literal-pathspecs`를 적용한 `version` | runner를 생성하지 않음 |
| repository/revision service | `rev-parse --verify --end-of-options`, object format, porcelain v2와 필요한 NUL output | 해당 service를 활성화하지 않음 |
| batch blob optimization | `cat-file --batch-check -Z`의 input/output NUL framing | 단건 reader 유지; ambiguous `-z` fallback 금지 |

probe는 exit status와 bounded machine output만 사용하고 localized help/stderr 문구를 파싱하지 않는다.
필수 service capability가 없으면 `GIT_VERSION_UNSUPPORTED`의 행동 가능한 message를 반환하며, feature를
부분 성공으로 표시하지 않는다. 세 OS packaged matrix는 `GIT-003`에서 이 결정을 실제 배포 Git으로
재검증한다.

## 10. 기준 command recipes

아래는 shell script가 아니라 runner가 만드는 argv의 의미를 보여준다. `<repo>`, `<rev>`, `<path>`, `<oid>`는 각각 단일 인자다.

### Repository 감지

```text
git <safe-global-options> -C <candidate> rev-parse --show-toplevel
git <safe-global-options> -C <repo> rev-parse --absolute-git-dir
git <safe-global-options> -C <repo> rev-parse --git-common-dir
git <safe-global-options> -C <repo> rev-parse --is-bare-repository
git <safe-global-options> -C <repo> rev-parse --is-inside-work-tree
git <safe-global-options> -C <repo> rev-parse --show-object-format=storage
```

초기 Git-1은 bare repository를 `GIT_BARE_UNSUPPORTED`로 거절한다. read-only bare compare는 실제 수요와 별도 UX가 확인된 뒤 ADR로 다시 검토한다.

### Revision 검증

```text
git ... rev-parse --verify --end-of-options <raw-revision>^{commit}
```

raw input을 사용하는 유일한 단계다. 성공 후 full object ID만 후속 명령에 전달한다.

manual short ref는 먼저 `for-each-ref` 결과에서 같은 short name의 full ref가 여러 개인지 확인한다. hex abbreviation은 disambiguation 결과를 검사한다. `rev-parse --verify`의 성공만으로 branch/tag short-name ambiguity가 없다고 가정하거나 localized warning text를 파싱하지 않는다.

### Ref와 recent commit

```text
git ... for-each-ref --format=<NUL-field-format> refs/heads refs/remotes refs/tags
git ... log -z --format=<bounded-fields> -n 50 <resolved-oid> --
```

ref 목록은 local object database에 있는 항목만 보여준다. recent commit subject도 UI 길이와 output 크기를 제한한다.

### Revision tree

```text
git ... ls-tree -r -z --long --full-tree <resolved-oid>
git ... ls-tree -z --long --full-tree <resolved-oid> -- <literal-path>
```

선택한 path의 object ID는 `ls-tree`의 구조화된 결과에서 얻는다. untrusted path를 `commit:path` revision expression에 이어 붙이는 방식을 기본으로 쓰지 않는다.

### Changed-file 목록

```text
git ... diff --no-ext-diff --no-textconv --name-status -z --find-renames <left-oid> <right-oid> --
```

MVP command는 rename detection만 활성화하므로 `R100`처럼 status 뒤에 붙는 score를 파싱한다. pure parser는 공식 형식의 `C087` record도 forward compatibility로 보존하지만, copy detection과 UI는 성능·가치 검토 전까지 수용 기준이 아니다. `-z` 출력의 path는 UTF-8이라고 가정하지 않는다.

### Raw blob

```text
git ... cat-file -t <oid>
git ... cat-file -s <oid>
git ... cat-file blob <oid>
```

`blob`이 아니면 text pipeline으로 넘기지 않는다. `cat-file --filters`, `--textconv`, LFS smudge를 사용하지 않는다. blob bytes는 기존 binary probe, BOM, `chardetng`, `encoding_rs`, EOL/final-newline 계산을 재사용한다.

### Working tree 상태

```text
git ... -c core.fsmonitor=false status --porcelain=v2 -z --branch --untracked-files=all
```

`--no-optional-locks`/`GIT_OPTIONAL_LOCKS=0` 없이 background status를 호출하지 않는다.

### Unmerged index stage

```text
git ... ls-files --unmerged --stage -z --
```

stage mapping:

```text
1 = base
2 = ours/current side
3 = theirs/other side
```

이 이름만 표시하지 말고 operation과 commit/ref label을 함께 보여준다.

### Merge base

```text
git ... merge-base --all <left-oid> <right-oid>
```

0개는 unrelated histories, 여러 개는 multiple-base 상태다. 어느 하나를 임의로 고르지 않는다.

## 11. Session builder 계약

### Revision compare

```text
1. repository identity 검증
2. 양쪽 raw revision을 full commit ID로 확정
3. name-status 목록 생성
4. 선택 entry의 양쪽 tree object ID 확인
5. type/size 검사 후 blob read
6. 기존 text detector로 decode
7. read-only compare session 생성
```

한쪽에 없는 file은 `missing` virtual document다. 빈 blob과 missing을 구분한다.

### Working tree compare

repository-relative path를 lexical normalize하고 root escape, absolute path, drive prefix, NUL, 빈 component를 거절한다. filesystem 접근 전후에 containment와 file type을 확인하고 symlink는 기본 거절한다. disk side는 기존 file loader를 사용한다.

### Git conflict session

```text
1. unmerged stage 목록 snapshot
2. 선택 path의 stage object ID 기록
3. 있는 stage blob만 read
4. working tree Result path lstat + read + fingerprint
5. merge UI 구성
6. 저장 직전 stage 목록과 Result fingerprint 재검사
7. 기존 safe writer로 Result만 저장
8. index/refs/HEAD가 그대로인지 확인
```

add/add는 Base가 없을 수 있다. delete/modify는 Ours, Theirs 또는 Result가 없을 수 있다. 없는 Result를 새로 만들 때도 root containment와 외부 변경 precondition을 적용한다.

binary stage, symlink, submodule conflict는 text merge를 막고 metadata만 보여준다.

### Merge-base preview

Base/Left/Right는 모두 immutable blob이다. 결과는 기존 `diffy` engine이 만든 임시 버퍼지만 실제 `git merge`와 같은 결과라고 보장하지 않는다. Save/Save As는 별도 제품 결정 전까지 비활성화한다.

## 12. `difftool`, `mergetool`, merge driver 구분

세 기능은 서로 다른 계약이다.

| Git 기능 | 입력 | 쓰기 대상 | 초기 지원 |
|---|---|---|---|
| custom difftool | `$LOCAL`, `$REMOTE`; `$MERGED`는 비교 path label | 없음 | read-only 후보 |
| custom mergetool | `$BASE`, `$LOCAL`, `$REMOTE`, `$MERGED` | `$MERGED` | `MRG-009`/`MRG-014` |
| custom merge driver | `%O`, `%A`, `%B`, `%L`, `%P` | `%A`를 직접 덮어씀 | 제외 |

`%P`는 pathname label이지 result 파일이 아니다. 따라서 `%O %A %B %P`를 `--mergetool`에 넘기는 설정을 문서화하지 않는다.

mergetool 목표 command 형태:

```text
<forktail-executable> --mergetool "$BASE" "$LOCAL" "$REMOTE" "$MERGED"
```

실제 `.gitconfig` 문자열은 Git이 shell로 평가하므로 OS별 executable path quoting을 `INT-002`에서 별도 생성·검증한다. 사용자가 검증되지 않은 예시를 그대로 붙여 넣게 하지 않는다.

현재 GUI는 저장/취소를 신뢰 가능한 exit code로 전달하지 않으므로 generated config는 다음을 유지한다.

```text
mergetool.forktail.trustExitCode = false
mergetool.forktail.hideResolved = false
```

를 유지한다. 이 경우 Git은 target timestamp와 사용자 확인 흐름을 사용한다. `true`는 blocking helper와 Save & Close/Abort exit contract를 세 OS에서 검증한 뒤 별도 결정한다.

mergetool session은 다음을 지킨다.

- source는 `$BASE`/`$LOCAL`/`$REMOTE`, 초기 Result는 Git이 이미 만든 `$MERGED`다.
- `$BASE` empty argument를 startup parser가 제거하지 않고 missing source로 매핑한다.
- `$MERGED`를 무시하고 세 source를 새로 자동 병합하지 않는다.
- 기본 `<<<<<<< HEAD` label과 base 없는 marker를 포함해 unresolved marker가 남은 상태의 강제 저장을 허용하지 않는다.
- Git 임시 source path를 recent/recovery에 남기지 않는다.
- 저장 후 `git add`를 실행하지 않는다.
- Git `.orig`와 Forktail `.bak.*`의 보존·정리 안내를 표시한다.

Forktail 프로세스가 실행되는 동안 HEAD, refs, index는 불변이어야 한다. 프로세스 종료 뒤 `trustExitCode=false` 확인 과정에서 사용자가 성공을 승인하면 `git mergetool` wrapper가 해당 path를 stage할 수 있으며, 이 단계는 앱의 자동 `git add`와 구분해 검증한다.

## 13. 오류 계약

Rust command는 기존과 같은 `{ code, message }` 형태만 UI에 보낸다.

제안 code:

```text
GIT_NOT_FOUND
GIT_VERSION_UNSUPPORTED
GIT_COMMAND_TIMEOUT
GIT_COMMAND_CANCELLED
GIT_OUTPUT_TOO_LARGE
GIT_NOT_REPOSITORY
GIT_UNSAFE_REPOSITORY
GIT_BARE_UNSUPPORTED
GIT_INVALID_REVISION
GIT_AMBIGUOUS_REVISION
GIT_PATH_NOT_AT_REVISION
GIT_OBJECT_MISSING_LOCAL
GIT_OBJECT_TYPE_UNSUPPORTED
GIT_BLOB_TOO_LARGE
GIT_BINARY_BLOB
GIT_LFS_POINTER
GIT_PATH_UNSUPPORTED
GIT_PATH_OUTSIDE_ROOT
GIT_SYMLINK_UNSUPPORTED
GIT_CONFLICT_STATE_CHANGED
GIT_MULTIPLE_MERGE_BASES
GIT_UNRELATED_HISTORIES
```

raw command, raw stderr, 파일 내용은 사용자 메시지나 분석 이벤트에 포함하지 않는다. 개발용 local log도 기존 privacy 정책을 따른다.

## 14. 주요 edge case

- Git executable 없음 또는 지원하지 않는 버전
- detached HEAD, unborn branch, empty repository
- shallow clone과 partial clone의 local object 누락
- promisor remote lazy fetch 시도 차단
- linked worktree, common git dir, bare repository
- sparse checkout
- SHA-256 object ID
- space, tab, newline, Unicode, non-UTF-8 path
- case-only path와 macOS normalization 차이
- mode `120000` symlink, `160000` submodule, type change
- LFS pointer와 실제 binary blob
- rename score, parser 호환성용 copy record, rewrite `M<score>`
- ref/repository/index가 여러 command 사이에서 바뀌는 경쟁
- add/add, delete/modify, rename/rename conflict
- merge/rebase/cherry-pick에서 stage label 의미 차이
- result file 없음, symlink로 교체됨, repo 밖으로 escape
- 여러 merge base와 unrelated histories
- command timeout, cancellation, stdout/stderr flood

## 15. Cache와 성능

- revision은 session 시작 시 full object ID로 고정한다.
- ref/tree cache key는 repository identity + resolved object ID다.
- blob cache key는 object algorithm + full ID다.
- blob text와 사용자 파일 내용은 memory-bounded LRU만 허용하며 disk/recent session에 저장하지 않는다.
- working tree와 index 결과는 refresh마다 재검증하고 immutable blob cache와 섞지 않는다.
- changed-file 목록은 큰 repository에서 batch/streaming과 cancel을 지원한다.
- 많은 blob을 읽을 필요가 측정된 뒤에만 `cat-file --batch-command -Z`를 검토한다.

## 16. 권장 구현 순서

```text
Phase 1 안정화
  → MRG-009 계약 수정
  → MRG-014 세 OS packaged mergetool smoke
  → INT-002 안전한 설정 출력
  → GIT-000 ADR/제품 게이트
  → runner + 오류 + byte parser
  → repository + revision
  → tree/blob + changed-file list
  → read-only revision compare MVP
  → working tree compare
  → stage-0 index compare
  → index-stage conflict adapter
  → merge-base preview
  → review queue + patch export
  → bounded file history
```

첫 MVP는 branch/commit 사이의 **read-only 파일 비교**다. history graph, conflict save, 많은 UI를 동시에 넣지 않는다.

## 17. 최소 완료 기준

- [ ] Git이 없거나 버전이 낮을 때 행동 가능한 오류를 낸다.
- [ ] 어떤 Git compare도 network 요청, optional index write, credential prompt를 만들지 않는다.
- [ ] raw revision은 검증 후 full object ID로 고정한다.
- [ ] checkout 없이 두 revision의 changed-file 목록과 selected blob을 연다.
- [ ] raw blob에 기존 64 MiB, binary, encoding 정책을 적용한다.
- [ ] rename, added, deleted, type-changed entry를 구분한다.
- [ ] path byte identity를 lossy string으로 왕복하지 않는다.
- [ ] working tree 비교가 root escape와 symlink를 거절한다.
- [ ] HEAD/index/working-tree pair 비교가 staged/unstaged 상태를 정확히 분리하고 index를 바꾸지 않는다.
- [ ] conflict stage 1/2/3과 Result를 정확히 구성한다.
- [ ] conflict save는 Result 파일만 안전 저장하고 index/HEAD/refs를 바꾸지 않는다.
- [ ] LFS object, submodule, missing partial-clone object를 자동 다운로드하지 않는다.
- [ ] parser, fake runner, temp repository, 세 OS packaged smoke가 `docs/20_GIT_TEST_PLAN.md`를 통과한다.
- [ ] checkout/switch/fetch/push/add/commit 계열 command가 운영 runner allowlist에 존재하지 않는다.
- [ ] review state와 recent session에 blob/diff/Git 임시 path가 남지 않는다.
