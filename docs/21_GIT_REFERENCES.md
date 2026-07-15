# 21. Git 공식 문서와 구현 참고

이 문서는 forktail의 Git 연동을 설계·구현·검토할 때 기준으로 삼을 공식 문서와 안전한 호출 계약을 정리한다. Git 저장소 전체 기능을 앱에 넣기 위한 문서가 아니라, 로컬 비교와 병합에 필요한 정보를 Git executable에서 예측 가능하게 읽기 위한 참고 자료다.

링크는 Git 공식 최신 문서를 가리킨다. `ADR-010`/`GIT-000`에서 최소 지원 버전을 **Git 2.45.0**으로
고정했다. Git 2.45 문서는 `--no-lazy-fetch`를 제공하지만 2.44 문서는 제공하지 않으므로 이 safety
option을 빼는 하위 버전 fallback은 허용하지 않는다. version 문자열과 실제 capability를 모두 확인한다.

- [Git 2.45.0 `git` manual](https://git-scm.com/docs/git/2.45.0)
- [Git 2.44.0 `git` manual](https://git-scm.com/docs/git/2.44.0)
- [Git 2.42.0 `cat-file -Z` manual](https://git-scm.com/docs/git-cat-file/2.42.0)

## 1. 기본 원칙

1. `.git` 내부 파일을 직접 해석하지 않는다. packed refs, linked worktree, reftable, partial clone 같은 저장소 형식 차이는 Git command가 처리하게 한다.
2. Rust에서 `std::process::Command`와 argv 배열로 실행한다. 경로, ref, object name을 하나의 shell 문자열로 조립하지 않는다.
3. 사용자 또는 저장소에서 온 revision은 먼저 검증해 object ID로 고정한다. 검증하지 않은 값을 후속 command의 option 위치에 전달하지 않는다.
4. 파일명 출력은 지원되는 경우 `-z`를 사용하고 NUL byte로 파싱한다. 줄바꿈, tab, 따옴표가 파일명에 없다고 가정하지 않는다.
5. 앱이 내용을 읽기만 하는 경로에서는 lazy fetch, external diff, textconv, optional lock을 명시적으로 차단한다.
6. command의 exit code, stdout, stderr를 별도 byte stream으로 처리한다. stderr나 전체 경로를 사용자 파일 내용과 함께 로그로 남기지 않는다.

## 2. 공통 실행 프로필

공식 진입점: [`git`](https://git-scm.com/docs/git)

읽기 전용 조회의 기본 형태는 다음과 같다.

```text
git --no-pager \
    --no-lazy-fetch \
    --no-optional-locks \
    --no-replace-objects \
    --literal-pathspecs \
    -C <repository-root> \
    <command> <args...>
```

각 옵션의 의미와 한계:

- `--no-pager`: 기계가 읽을 stdout 앞에 pager를 두지 않는다.
- `--no-lazy-fetch`: partial clone에서 로컬에 없는 promisor object를 자동 다운로드하지 않는다. object가 없으면 조회가 실패할 수 있다. 이 옵션은 `fetch`, `pull` 같은 명시적 네트워크 command까지 일반적으로 차단하는 sandbox가 아니다.
- `--no-optional-locks`: status refresh처럼 생략 가능한 lock 작업을 하지 않는다. 임의의 쓰기 command를 읽기 전용으로 바꾸는 옵션은 아니다.
- `--literal-pathspecs`: glob과 pathspec magic을 전역으로 끈다. revision 해석을 제한하는 옵션은 아니다.
- `-C <path>`: shell의 현재 디렉터리를 바꾸지 않고 지정한 저장소에서 실행한다.

`--no-replace-objects`로 replacement ref 적용도 끈다. immutable object identity가 같은 session에서 다른
내용을 가리키지 않게 하는 `ADR-010`의 필수 profile이며 선택 option으로 생략하지 않는다.

### 2.1 최소 버전과 required capability

| Capability | Gate | 비고 |
|---|---|---|
| Git version | `>= 2.45.0` | semantic version과 vendor suffix를 분리해 판정 |
| global safety profile | `--no-pager`, `--no-lazy-fetch`, `--no-optional-locks`, `--no-replace-objects`, `--literal-pathspecs` | 한 option이라도 거절되면 fail closed |
| revision boundary | `rev-parse --verify --end-of-options` | raw input을 후속 command에 재사용하지 않음 |
| machine path output | command별 `-z`/exact `%00` framing | partial/truncated record는 실패 |
| object format | SHA-1/SHA-256 full identity | 40자 고정 금지 |
| batch object framing | `cat-file -Z` | batch 최적화 활성화 전 probe; legacy `-z` output 파싱 금지 |

probe는 shell이나 사용자 repository mutation 없이 typed runner가 실행한다. version gate가 통과해도
vendor build가 capability를 거절하면 `GIT_VERSION_UNSUPPORTED`로 처리하고 약한 호출을 재시도하지 않는다.

## 3. 입력 경계와 기계 파싱

### 3.1 `--end-of-options`

공식 문서: [`git rev-parse`](https://git-scm.com/docs/git-rev-parse)

외부에서 받은 revision을 검증할 때는 option으로 오인되지 않도록 다음 형태를 사용한다.

```text
git rev-parse --verify --end-of-options '<candidate>^{commit}'
```

- 성공하면 후속 command에는 원래 문자열보다 검증된 full object ID를 전달한다.
- `--verify` 성공만으로 short ref가 유일하다고 가정하지 않는다. branch/tag short-name 충돌은 ref 후보 목록으로, abbreviated hex 충돌은 object disambiguation으로 별도 확인한다.
- commit이 아닌 tree나 blob을 요구한다면 `^{tree}`, `^{blob}`처럼 기대 type을 명시한다.
- `--end-of-options`는 이를 문서화한 command 위치에서 사용한다. 모든 Git subcommand에 무조건 붙일 수 있는 공통 separator라고 가정하지 않는다.
- shell 예시의 따옴표는 설명용이다. 실제 구현은 candidate를 argv 한 항목으로 전달한다.

### 3.2 `-z`와 NUL framing

다음 command는 path 출력에 `-z`를 제공한다.

- [`git diff`](https://git-scm.com/docs/git-diff)
- [`git ls-tree`](https://git-scm.com/docs/git-ls-tree)
- [`git ls-files`](https://git-scm.com/docs/git-ls-files)
- [`git status`](https://git-scm.com/docs/git-status)

`-z`를 사용하면 path를 quote하지 않고 record 또는 path를 NUL로 끝낸다. 구현은 다음 규칙을 지킨다.

- stdout을 먼저 byte 기준으로 NUL 분할한다.
- LF, tab, 공백으로 record를 나누지 않는다.
- rename/copy처럼 한 record에 두 path가 있는 형식은 해당 command의 `-z` schema를 그대로 따른다.
- path를 손실 있는 UTF-8 문자열로 바꾸기 전에 OS path 표현 정책을 적용한다.

[`git cat-file`](https://git-scm.com/docs/git-cat-file)의 batch mode에서는 `-Z`가 입력과 출력을 모두
NUL-delimited로 만든다. 기존 `-z`는 입력만 NUL-delimited라 output이 모호할 수 있어 사용하지 않는다.
batch `-Z` probe가 실패하면 legacy framing을 추측하지 않고 단건 `cat-file -t`, `-s`, `blob` reader를
유지한다.

[`git for-each-ref`](https://git-scm.com/docs/git-for-each-ref)는 command-wide `-z`가 없다. `--format`의 `%00`으로 NUL을 넣을 수 있으므로 exact format과 record framing을 별도 계약으로 고정한다.

## 4. 명령별 공식 참고

### 4.1 `git`

공식 문서: [`git`](https://git-scm.com/docs/git)

용도:

- `-C`, `--git-dir`, `--work-tree` 등 repository 실행 context 설정
- `--no-lazy-fetch`, `--no-optional-locks`, `--literal-pathspecs` 같은 전역 안전 옵션
- `--version`을 통한 지원 버전 확인

주의:

- 전역 옵션은 subcommand 앞에 둔다.
- Git alias가 아닌 명시적 builtin subcommand를 실행한다.
- Git의 환경변수와 사용자 config가 결과를 바꿀 수 있는 항목은 command option으로 다시 고정한다.

### 4.2 `git rev-parse`

공식 문서: [`git rev-parse`](https://git-scm.com/docs/git-rev-parse)

용도:

- `--show-toplevel`, `--absolute-git-dir`로 repository 경계 확인
- `--is-inside-work-tree`, `--is-bare-repository`로 context 분류
- `--verify --end-of-options`와 type peel로 revision 검증

권장 계약:

```text
git rev-parse --verify --end-of-options '<revision>^{commit}'
```

출력 object ID의 길이를 40자로 고정하지 않는다. repository object format이 SHA-1인지 SHA-256인지 Git의 반환값을 기준으로 처리한다.

### 4.3 `git diff`

공식 문서: [`git diff`](https://git-scm.com/docs/git-diff)

용도:

- worktree ↔ index, index ↔ tree, tree ↔ tree의 변경 목록과 patch 생성
- `--raw`, `--name-status`, `--numstat` 등 기계용 형식 제공

읽기 전용 metadata 예시:

```text
git diff --raw -z --no-color --no-ext-diff --no-textconv --no-renames <left> <right>
```

주의:

- `--no-ext-diff`는 external diff helper 실행을 금지한다.
- `--no-textconv`는 `.gitattributes`의 textconv filter 실행을 금지한다. textconv 결과는 사람이 읽기 위한 단방향 변환일 수 있으며 원본 byte와 같지 않다.
- rename 감지를 쓸지 `--no-renames`로 끌지 명시한다. 사용자 config에 맡기면 같은 입력의 status schema가 달라질 수 있다.
- `-z` raw 형식의 rename/copy는 source와 destination path를 각각 NUL-safe하게 읽는다.
- 실제 blob 내용은 patch text를 재해석하기보다 `ls-tree`/`cat-file`로 object를 식별해 읽는 편이 경계가 명확하다.

### 4.4 `git ls-tree`

공식 문서: [`git ls-tree`](https://git-scm.com/docs/git-ls-tree)

용도:

- commit/tree snapshot의 mode, type, object ID, path 열거
- worktree를 건드리지 않고 과거 tree의 폴더 상태 구성

예시:

```text
git ls-tree -r -z --full-tree <verified-tree-oid>
```

주의:

- tree-ish는 먼저 `rev-parse --verify --end-of-options ...^{tree}`로 검증한다.
- submodule entry는 일반 blob이 아니라 commit mode/type으로 나타날 수 있다.
- symlink entry의 blob은 링크 대상 문자열이며 대상 파일 내용이 아니다.
- `-z` 없이 quote된 path를 다시 추측해 복원하지 않는다.

### 4.5 `git cat-file`

공식 문서: [`git cat-file`](https://git-scm.com/docs/git-cat-file)

용도:

- object type/size 확인
- blob의 raw content 읽기
- `--batch`, `--batch-check`, `--batch-command`로 여러 object를 한 프로세스에서 조회

예시:

```text
git --no-lazy-fetch cat-file -t <verified-oid>
git --no-lazy-fetch cat-file blob <verified-blob-oid>
git --no-lazy-fetch cat-file --batch-command -Z
```

주의:

- partial clone에서 object가 로컬에 없으면 `--no-lazy-fetch` 상태로 실패시킨다. UI는 “오프라인으로 사용할 object가 없음”을 행동 가능한 오류로 변환한다.
- batch input에는 가능하면 Git이 반환한 full object ID만 넣는다. 사용자 문자열을 extended SHA syntax로 그대로 전달하지 않는다.
- `--batch` content record는 header의 object size만큼 정확히 읽고 delimiter를 소비한다. blob 안의 NUL이나 newline으로 content를 자르지 않는다.
- 최신 Git에서는 batch mode의 `-Z`를 우선한다. `-z`와 `-Z`를 같은 계약으로 취급하지 않는다.

### 4.6 `git merge-base`

공식 문서: [`git merge-base`](https://git-scm.com/docs/git-merge-base)

용도:

- 두 commit의 best common ancestor 계산
- `--is-ancestor`로 조상 관계 확인
- `--fork-point`로 reflog를 고려한 분기점 후보 계산

주의:

- criss-cross history에서는 best merge base가 여러 개일 수 있다. `--all`을 쓸지, Git이 만드는 virtual merge base에 해당하는 별도 정책을 둘지 명시한다.
- `--is-ancestor A B`는 true면 0, false면 1이다. 1이 아닌 non-zero는 오류로 구분한다.
- 3-way UI의 Base를 자동 선택하더라도 어떤 알고리즘과 후보를 썼는지 사용자에게 표시한다.

### 4.7 `git ls-files`

공식 문서: [`git ls-files`](https://git-scm.com/docs/git-ls-files)

용도:

- index와 worktree path 열거
- `--stage`로 mode, object ID, stage number 확인
- `--unmerged`로 conflict stage 1/2/3 확인
- `--eol`로 index/worktree EOL 정보 확인

예시:

```text
git ls-files --stage -z
git ls-files --unmerged -z
```

주의:

- unmerged entry는 같은 path가 stage별로 여러 번 나온다. path만 key로 삼아 앞 entry를 덮어쓰지 않는다.
- stage 1/2/3은 각각 merge base/ours/theirs 자료를 구성하는 데 사용할 수 있지만, Git mergetool의 `$BASE`/`$LOCAL`/`$REMOTE` 계약과 동일한 프로세스 lifecycle은 아니다.
- untracked 파일은 기본 index 열거에 포함되지 않는다. 필요하면 `status`의 porcelain 계약을 사용한다.

### 4.8 `git status`

공식 문서: [`git status`](https://git-scm.com/docs/git-status)

용도:

- index와 worktree의 staged, unstaged, untracked, unmerged 상태 요약

권장 형식:

```text
git status --porcelain=v2 -z --untracked-files=all
```

주의:

- 사람이 읽는 기본/short 출력 대신 backwards-incompatible 변경을 피하도록 정의된 porcelain 형식을 사용한다.
- porcelain v2의 모르는 optional header는 무시할 수 있어야 한다.
- `-z`에서는 path를 quote하지 않고 NUL로 끝낸다. rename/copy record의 field 순서는 non-`-z` 출력과 같다고 추측하지 말고 공식 schema를 따른다.
- `--no-optional-locks`는 background index refresh 같은 optional write를 줄이기 위한 방어선이며 status 전체를 보안 sandbox로 만들지는 않는다.

### 4.9 `git for-each-ref`

공식 문서: [`git for-each-ref`](https://git-scm.com/docs/git-for-each-ref)

용도:

- branch, tag, remote-tracking ref 열거
- `--sort`, `--format`, `--merged`, `--contains`, `--points-at` 조건 적용

예시:

```text
git for-each-ref \
  --sort=refname \
  --format='%(refname)%00%(objectname)%00%(objecttype)' \
  refs/heads refs/tags
```

주의:

- `.git/refs`를 직접 걷지 않는다. packed refs나 다른 ref backend를 놓칠 수 있다.
- command-wide `-z`가 없으므로 `%00`을 포함한 exact format을 고정한다. Git이 record 뒤에 쓰는 newline과 format 내부 NUL field를 구분해 테스트한다.
- subject/body처럼 newline이 들어갈 수 있는 atom을 line parser와 함께 사용하지 않는다.
- symbolic ref나 annotated tag의 peeled object가 필요하면 format atom과 peel 정책을 명시한다.

### 4.10 `git mergetool`

공식 문서: [`git mergetool`](https://git-scm.com/docs/git-mergetool)

custom `mergetool.<tool>.cmd`는 shell에서 평가되며 다음 환경변수를 제공한다.

| 변수 | 의미 |
|---|---|
| `$BASE` | 공통 base의 임시 파일(사용 가능한 경우) |
| `$LOCAL` | 현재 branch 쪽 내용의 임시 파일 |
| `$REMOTE` | 병합해 들어오는 쪽 내용의 임시 파일 |
| `$MERGED` | 병합 결과를 써야 하는 실제 대상 파일 |

forktail의 개념적 argv 계약은 다음과 같다.

```text
forktail --mergetool "$BASE" "$LOCAL" "$REMOTE" "$MERGED"
```

주의:

- 위 문자열을 모든 OS에 그대로 복사할 config로 간주하지 않는다. `mergetool.<tool>.cmd`는 shell 평가 대상이므로 executable path와 변수 quoting을 macOS, Windows Git, Linux별 snapshot/smoke로 검증한다.
- `mergetool.<tool>.trustExitCode=false`이면 Git은 merge target의 timestamp를 확인한다. target이 갱신되면 성공으로 가정하고, 갱신되지 않으면 사용자에게 성공 여부를 묻는다. “파일 내용을 비교해 성공을 판정한다”는 계약이 아니다.
- generated config는 `mergetool.forktail.hideResolved=false`를 명시한다. 이 값이 true면 Git이 `$LOCAL`/`$REMOTE`를 unresolved 부분 중심으로 바꿀 수 있어 full branch snapshot이라는 UI 설명과 달라질 수 있다.
- unresolved marker를 저장해 `$MERGED` timestamp를 바꾸면 Git이 성공으로 볼 수 있다. mergetool 모드에서는 unresolved save와 완료 동작을 일반 merge보다 엄격하게 정의한다.
- `mergetool.keepBackup`, `mergetool.keepTemporaries`, `mergetool.writeToTemp`가 forktail의 `.bak.*` 정책 및 임시 경로 lifecycle과 어떻게 상호작용하는지 문서화한다.
- Git은 tool process가 끝나기를 기다린다. packaged app은 Save & Close, 취소, 비저장 종료, 여러 conflict 파일의 순차 실행을 실제 프로세스 수준에서 검증해야 한다.

### 4.11 `git difftool`

공식 문서: [`git difftool`](https://git-scm.com/docs/git-difftool)

custom `difftool.<tool>.cmd`에는 주로 다음 변수가 제공된다.

| 변수 | 의미 |
|---|---|
| `$LOCAL` | diff pre-image의 임시 파일 |
| `$REMOTE` | diff post-image의 임시 파일 |
| `$MERGED` | 비교 중인 원래 path 이름 |
| `$BASE` | custom merge tool 호환용이며 `$MERGED`와 같은 값 |

개념적 argv 계약:

```text
forktail --difftool "$LOCAL" "$REMOTE"
```

주의:

- difftool의 기본 목적은 보기다. 임시 `$LOCAL`/`$REMOTE`를 일반 편집 가능한 2-way session으로 열어 변경이 Git에 반영된다는 인상을 주지 않는다.
- `--dir-diff`는 symlink/copy와 별도 directory lifecycle이 있으므로 첫 통합 범위에서 제외하거나 전용 설계를 한다.
- custom command도 shell에서 평가되므로 path quoting과 packaged executable의 blocking 동작을 OS별로 검증한다.
- `--trust-exit-code` 사용 여부와 non-zero exit 전달 정책을 mergetool과 별도로 정의한다.

### 4.12 `gitattributes`

공식 문서: [`gitattributes`](https://git-scm.com/docs/gitattributes)

용도:

- path별 diff, merge, text, EOL 동작 정의
- diff driver와 textconv 설정
- custom merge driver 연결

`git mergetool`과 custom merge driver는 서로 다른 인터페이스다. merge driver의 placeholder는 다음과 같다.

| placeholder | 의미 |
|---|---|
| `%O` | 공통 ancestor version의 임시 파일 |
| `%A` | current version의 임시 파일이며 결과를 덮어써야 하는 출력 파일 |
| `%B` | other version의 임시 파일 |
| `%L` | conflict marker 길이 |
| `%P` | 병합 대상의 pathname label; 출력 파일이 아님 |
| `%S`, `%X`, `%Y` | ancestor/current/other conflict label |

핵심 구분:

```text
git mergetool custom cmd : $BASE $LOCAL $REMOTE $MERGED
custom merge driver      : %O    %A     %B      (%A에 결과 기록, %P는 path label)
```

- `%O %A %B %P`를 `git mergetool` 인자라고 문서화하지 않는다.
- custom merge driver는 자동 merge 단계에서 실행되고 `%A`를 갱신한 뒤 clean이면 0, conflict이면 non-zero를 반환해야 한다. interactive GUI의 저장/닫기 lifecycle과 별개다.
- 현재 Phase 1 예외는 `MRG-009`의 interactive mergetool adapter뿐이다. difftool과 repository-aware Git은 후속 후보이며, custom merge driver는 별도 PRD/ADR 없이는 활성화하지 않는다.
- 저장소가 지정한 diff driver/textconv를 실행하지 않는 조회에는 `git diff --no-ext-diff --no-textconv`를 사용한다.

## 5. forktail 구현 체크리스트

- [x] 최소 지원 Git 2.45.0과 필요한 option/capability(`cat-file -Z` 포함)를 `ADR-010`에 명시한다.
- [ ] Git executable 경로를 argv 기반으로 실행하고 shell command 문자열을 만들지 않는다.
- [ ] 사용자 revision은 `rev-parse --verify --end-of-options`와 expected type으로 검증한다.
- [ ] path 출력은 지원되는 모든 command에서 `-z`로 받고 byte/NUL parser를 테스트한다.
- [ ] filename fixture에 공백, tab, newline, leading dash, 따옴표, Unicode를 포함한다.
- [ ] `--no-lazy-fetch` 상태의 partial clone missing-object 실패가 네트워크 요청 없이 행동 가능한 오류가 된다.
- [ ] `--no-optional-locks`를 사용하되 이를 전체 read-only 보장으로 과장하지 않는다.
- [ ] diff 조회에 `--no-ext-diff --no-textconv`를 명시하고 악성/실패 external helper가 실행되지 않는지 테스트한다.
- [ ] SHA-1 object ID 길이를 하드코딩하지 않고 SHA-256 repository fixture를 검토한다.
- [ ] normal, bare, linked worktree, submodule repository 경계를 테스트한다.
- [ ] mergetool은 `$BASE/$LOCAL/$REMOTE/$MERGED`, merge driver는 `%O/%A/%B`와 `%A` output이라는 계약을 각각 snapshot test로 고정한다.
- [ ] mergetool의 save/abort/unresolved/backup/exit lifecycle을 packaged binary로 세 OS에서 smoke test한다.
- [ ] difftool 임시 입력은 기본 read-only이며 `--dir-diff` 지원 여부를 명시한다.
- [ ] stage 0 index snapshot과 stage 1/2/3 conflict snapshot을 다른 계약으로 파싱하고 three-state compare가 index를 바꾸지 않는지 검증한다.
- [ ] bounded file history를 추가하면 자동 fetch 없이 metadata만 읽고 full graph로 범위를 넓히지 않는다.

## 6. 공식 링크 모음

- [`git`](https://git-scm.com/docs/git)
- [`git rev-parse`](https://git-scm.com/docs/git-rev-parse)
- [`git diff`](https://git-scm.com/docs/git-diff)
- [`git ls-tree`](https://git-scm.com/docs/git-ls-tree)
- [`git cat-file`](https://git-scm.com/docs/git-cat-file)
- [`git merge-base`](https://git-scm.com/docs/git-merge-base)
- [`git ls-files`](https://git-scm.com/docs/git-ls-files)
- [`git status`](https://git-scm.com/docs/git-status)
- [`git for-each-ref`](https://git-scm.com/docs/git-for-each-ref)
- [`git mergetool`](https://git-scm.com/docs/git-mergetool)
- [`git difftool`](https://git-scm.com/docs/git-difftool)
- [`gitattributes`](https://git-scm.com/docs/gitattributes)
