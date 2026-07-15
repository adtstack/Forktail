# 18. Git Integration Candidate Backlog

> **상태:** 후보 백로그. `docs/04_BACKLOG.md`의 Phase 1 확정 이슈가 아니다.
>
> **승격 조건:** `GIT-000`은 구현 승격 전 수행하는 decision-only 선행 작업이다. 나머지 이슈는 `docs/17_GIT_INTEGRATION.md` §3의 시작 게이트와 `GIT-000` 결정이 모두 끝난 뒤 승격한다.

이 문서는 repository-aware Git 기능을 한 이슈·한 PR 단위로 나눈다. 구현 시 한 번에 한 ID만 선택한다. `MRG-009`, `MRG-014`, `INT-002`는 외부 Git tool adapter이고, 아래 `GIT-*`는 Git repository/object/index를 읽는 후속 기능이다.

아래 Milestone 번호는 capability 묶음이지 강제 직렬 일정이 아니다. 실제 실행은 각 이슈의 `의존`과 §11 권장 순서를 따르며, read-only MVP UI인 `GIT-601`~`603`은 working tree/conflict adapter보다 먼저 진행할 수 있다.

## 1. 공통 작업 계약

모든 `GIT-*` 이슈는 PR 본문에 다음을 적는다.

```text
이슈 ID
변경 파일
수용 기준
실패/경계 조건
추가한 테스트
실행한 검증 명령과 결과
범위 밖
```

공통 금지:

- shell string 또는 broad Tauri shell/FS permission
- 프런트엔드가 arbitrary Git argv를 Rust에 전달하는 API
- checkout, switch, restore, reset, fetch, pull, push, add, commit, merge, rebase, cherry-pick 실행
- partial clone object의 lazy fetch
- credential prompt, LFS download, textconv/filter 실행
- raw stderr, 전체 command, 파일 내용의 사용자 메시지·외부 로그 기록
- SHA-1 40자리와 UTF-8 path만 가정하는 모델
- 기존 binary/encoding/safe-save 로직의 복제

공통 검증:

Rust 또는 Tauri command 변경:

```bash
cd src-tauri
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
```

React/TypeScript 또는 직렬화 계약 변경:

```bash
npm run typecheck
npm test
npm run build
```

Git integration test는 임시 repository만 사용한다. 운영 runner와 test fixture mutation helper를 타입과 모듈 수준에서 분리한다.

## 2. Milestone Git-0 — 결정과 실행 경계

### GIT-000. Git CLI-first ADR와 제품 게이트

목표:

- Git CLI를 Rust child process로만 실행하는 결정과 post-Phase 1 시작 조건을 확정한다.

변경 후보:

- `docs/10_ADR.md`
- `docs/17_GIT_INTEGRATION.md`
- `docs/18_GIT_BACKLOG.md`

수용 기준:

- Git 최소 버전과 Windows/macOS/Linux discovery 정책이 있다.
- `--no-lazy-fetch`, `--no-optional-locks`, literal path, raw blob 정책을 결정한다.
- bare, linked worktree, SHA-256, non-UTF-8 path의 지원/거절 범위를 정한다.
- 초기 MVP에서 bare repository를 명시적으로 거절하고 후속 재검토 조건을 기록한다.
- 운영 allowlist와 fixture helper의 mutation scope를 분리한다.
- Phase 1 backlog에 자동 편입하지 않는다.

실패/경계:

- `safe.directory=*` 같은 전역 우회를 제안하지 않는다.
- CLI가 없을 때 libgit2를 자동 fallback으로 추가하지 않는다.

테스트/검증:

- 관련 공식 문서 링크와 현재 구현 경계를 review한다.
- Markdown link와 이슈 ID 참조를 확인한다.

의존: `MRG-014`, `INT-002`의 결정 또는 명시적 연기

### GIT-001. Allowlisted Git process runner

목표:

- async, cancellable, bounded-output Git runner를 Rust에 추가한다.

변경 후보:

- `src-tauri/src/git/runner.rs`
- `src-tauri/src/git/mod.rs`
- `src-tauri/src/lib.rs`

수용 기준:

- 내부 enum/service만 허용 command와 argv를 만든다.
- executable과 argv를 `Command`에 직접 전달하고 shell을 쓰지 않는다.
- stdout/stderr를 동시에 drain한다.
- timeout, cancellation, child/process-tree 종료, output cap을 지원한다.
- `GIT_TERMINAL_PROMPT=0`, `GIT_OPTIONAL_LOCKS=0`, `GIT_NO_LAZY_FETCH=1`, `GIT_LITERAL_PATHSPECS=1`을 강제한다.
- executable을 absolute path로 확정한 뒤 child 환경을 clear하고 OS 구동에 필요한 allowlist만 복원한다. 임의 `GIT_*`, config override, askpass/SSH, trace 환경을 상속하지 않는다.

실패/경계:

- stderr/stdout flood, child hang, cancellation race, executable path 공백을 처리한다.
- unsupported option을 조용히 빼고 실행하지 않는다.

테스트:

- fake child로 stdout/stderr 동시 출력, timeout, cancel, cap 초과를 검증한다.
- forbidden command를 구성하려 하면 테스트가 실패한다.

의존: `GIT-000`

### GIT-002. Git error와 TS/Rust DTO

목표:

- Git 전용 안정 error code와 직렬화 계약을 추가한다.

변경 후보:

- `src-tauri/src/error.rs`
- `src-tauri/src/domain/git.rs`
- `src/core/gitModels.ts`
- `src/core/errors.ts`

수용 기준:

- `docs/17_GIT_INTEGRATION.md` §13의 필요한 code를 `{ code, message }`로 매핑한다.
- raw stderr와 command argv를 UI message에 노출하지 않는다.
- object ID algorithm과 opaque path ID를 표현한다.
- Rust/TS field name 계약 테스트가 있다.
- not-repository, invalid/ambiguous revision, local object missing, binary blob, conflict saved의 행동 가능한 copy를 snapshot으로 고정한다.

실패/경계:

- unknown Git exit를 내부 debug string으로 그대로 보여주지 않는다.
- object ID 길이와 path UTF-8 변환 실패가 panic하지 않는다.

테스트:

- serialization snapshot, friendly message, unknown code fallback.

의존: `GIT-000`

### GIT-003. Git executable과 version policy

목표:

- 세 OS에서 사용할 Git executable을 예측 가능하게 찾고 검증한다.

변경 후보:

- `src-tauri/src/git/executable.rs`
- `src-tauri/src/commands/git.rs`

수용 기준:

- 기본은 앱 환경의 `git`을 argv 실행하며 macOS `/usr/bin/git`만 가정하지 않는다.
- 사용자 지정 경로가 필요하면 absolute regular executable만 허용한다.
- `git --version`을 parse하고 ADR의 최소 버전보다 낮으면 차단한다.
- 선택한 executable identity를 session 동안 고정한다.

실패/경계:

- PATH 변경, 실행 권한 없음, fake `git`, Windows `.exe` path 공백을 구분한다.
- version output이 예상 형식이 아니어도 panic하지 않는다.

테스트:

- fake version output과 세 OS path unit test.
- 실제 Git smoke는 설치된 CI lane에서만 수행한다.

의존: `GIT-001`, `GIT-002`

### GIT-004. Repository 감지와 identity

목표:

- 사용자가 고른 하위 폴더에서 root, git dir, common git dir, worktree 상태를 찾는다.

변경 후보:

- `src-tauri/src/git/repository.rs`
- `src-tauri/src/commands/git.rs`

수용 기준:

- `rev-parse --show-toplevel`, `--absolute-git-dir`, `--git-common-dir`를 사용한다.
- bare, linked worktree, shallow, object format을 typed state로 반환한다.
- current branch 또는 detached HEAD와 head commit을 반환한다.
- `safe.directory` 실패를 우회하지 않고 행동 가능한 오류를 낸다.
- repository identity에 canonical root와 common git dir을 포함한다.
- bare repository는 초기 MVP에서 `GIT_BARE_UNSUPPORTED`로 거절한다.

실패/경계:

- non-repo, bare, deleted root, symlink picker path, dubious ownership을 처리한다.

테스트:

- temp root/nested folder/non-repo/linked worktree fixture.
- 지원 CI에서는 SHA-256 repo fixture를 포함한다.

의존: `GIT-003`

### GIT-005. Byte/NUL parser와 path identity

목표:

- Git의 NUL-delimited byte output을 lossless하게 파싱하는 공통 primitive를 만든다.

변경 후보:

- `src-tauri/src/git/parsers.rs`
- `src-tauri/src/domain/git.rs`

수용 기준:

- empty/truncated/extra field를 typed parse error로 반환한다.
- space, tab, newline, control byte, non-UTF-8 path를 보존한다.
- UI display string과 opaque request identity를 분리한다.
- lossy display string을 command path로 재사용하지 않는다.

실패/경계:

- missing final NUL, huge record, duplicate opaque ID, invalid field count를 거절한다.

테스트:

- pure byte fixture와 property/fuzz 후보.
- Unix non-UTF-8와 Windows 변환 불가 path 정책 테스트.

의존: `GIT-002`

## 3. Milestone Git-1 — Revision과 ref

### GIT-101. Revision resolver

목표:

- branch, tag, commit, `HEAD~n`을 immutable full commit ID로 확정한다.

변경 후보:

- `src-tauri/src/git/revision.rs`

수용 기준:

- `rev-parse --verify --end-of-options <raw>^{commit}`을 사용한다.
- short ref는 `for-each-ref`의 동일 short-name 후보 수를 확인하고, abbreviated hex는 object disambiguation 결과를 확인한다.
- 후속 service에는 raw revision 대신 resolved ID를 전달한다.
- invalid와 ambiguous input을 구분한다.
- localized stderr warning을 ambiguity 판정에 사용하지 않는다.
- detached HEAD를 지원한다.

실패/경계:

- `-`로 시작하는 input, empty repo, unborn HEAD, tag-to-blob을 처리한다.

테스트:

- fake runner parser와 temp repo의 HEAD/branch/tag/full·abbrev hash/invalid/detached fixture.

의존: `GIT-004`

### GIT-102. Local ref 목록

목표:

- local branch, remote-tracking branch, tag를 selector model로 제공한다.

변경 후보:

- `src-tauri/src/git/refs.rs`

수용 기준:

- `for-each-ref`의 bounded structured output을 byte parser로 읽는다.
- full name, display name, object ID, object type을 구분한다.
- annotated tag와 peeled commit 관계를 명시한다.
- remote-tracking ref를 remote fetch 결과처럼 표현하지 않는다.

실패/경계:

- unusual ref display, stale/broken ref, 매우 많은 ref에서 cap/cancel을 처리한다.

테스트:

- parser unit과 temp repo branch/tag fixture.

의존: `GIT-005`, `GIT-101`

### GIT-103. Recent commit 후보

목표:

- selector 편의를 위한 제한된 recent commit 목록을 제공한다.

변경 후보:

- `src-tauri/src/git/history.rs`

수용 기준:

- 기본 limit 50, hard max와 cancel을 둔다.
- full ID, short display ID, subject, author timestamp만 반환한다.
- commit message body와 file content를 저장하지 않는다.

실패/경계:

- newline/control character subject, shallow boundary, output cap을 처리한다.

테스트:

- pure parser와 temp repo ordering/limit fixture.

의존: `GIT-101`

## 4. Milestone Git-2 — Tree와 raw blob

### GIT-201. Revision tree 목록

목표:

- resolved commit의 tracked entry를 mode/type/object ID/path로 읽는다.

변경 후보:

- `src-tauri/src/git/tree.rs`

수용 기준:

- `ls-tree -r -z --long --full-tree`를 사용한다.
- object format에 맞는 full ID를 보존한다.
- regular blob, executable blob, symlink, submodule을 구분한다. `-t`를 쓰지 않는 MVP file listing은 tree node를 반환한다고 약속하지 않는다.
- literal path prefix 요청을 지원한다.

실패/경계:

- non-UTF-8 path, mode `120000`, mode `160000`, huge tree, cancel을 처리한다.

테스트:

- parser fixture와 temp repo file/symlink/submodule-like entry fixture.

의존: `GIT-005`, `GIT-101`

### GIT-202. Blob metadata/read와 기존 decoder 연결

목표:

- object ID의 type/size를 확인한 뒤 raw blob bytes를 기존 text pipeline으로 보낸다.

변경 후보:

- `src-tauri/src/git/blob.rs`
- 기존 file decode helper의 최소 추출 위치

수용 기준:

- `cat-file -t`, `cat-file -s`, `cat-file blob` 순서를 사용한다.
- 64 MiB 초과 blob은 내용을 읽지 않는다.
- binary probe, BOM, encoding, EOL, final newline 로직을 file loader와 공유한다.
- cache key는 object algorithm + full ID이고 memory bound가 있다.

실패/경계:

- non-blob, missing local object, truncated stdout, binary, decode error를 처리한다.

테스트:

- UTF-8/UTF-16/binary/64 MiB 경계/size mismatch fixture.
- partial clone network guard는 `GIT-203`에서 검증한다.

의존: `GIT-201`

### GIT-203. Raw/LFS/no-lazy-fetch 정책

목표:

- filter나 network 없이 repository에 저장된 raw content만 읽는 정책을 고정한다.

변경 후보:

- `src-tauri/src/git/blob.rs`
- `src/core/networkPolicy.test.ts`

수용 기준:

- `--no-lazy-fetch`/`GIT_NO_LAZY_FETCH=1`이 모든 object read에 적용된다.
- `--filters`, `--textconv`, smudge, LFS command를 호출하지 않는다.
- 표준 LFS pointer를 metadata notice로 분류한다.
- missing promisor object는 `GIT_OBJECT_MISSING_LOCAL`을 반환한다.

실패/경계:

- LFS pointer처럼 시작하지만 형식이 잘못된 text, shallow/partial object 누락을 처리한다.

테스트:

- fake runner에서 network-capable command가 0개임을 확인한다.
- 가능하면 local fake promisor remote로 lazy-fetch 차단 integration test를 둔다.

의존: `GIT-001`, `GIT-202`

## 5. Milestone Git-3 — Changed-file compare MVP

### GIT-301. Name-status parser와 changed-file service

목표:

- 두 resolved commit 사이의 changed-file 목록을 만든다.

변경 후보:

- `src-tauri/src/git/changed_files.rs`
- `src-tauri/src/git/parsers.rs`

수용 기준:

- `diff --no-ext-diff --no-textconv --name-status -z --find-renames`를 사용한다.
- commit↔commit service는 A/D/M/T/X와 R score를 파싱한다. C/U record parser는 forward compatibility로 보존하되 MVP command는 copy detection이나 unmerged 상태를 활성화하지 않는다.
- old/new path를 lossless identity로 유지한다.
- stable sort/filter용 status를 반환한다.

실패/경계:

- malformed score, rewrite `M<score>`, unknown/C/U status, rename path 누락을 처리한다.

테스트:

- space/tab/newline/Unicode/non-UTF-8/rename/copy-record/type-change pure fixture. copy record는 parser 호환성 검증이며 MVP UI 수용 기준은 아니다.
- temp repo changed-list integration test.

의존: `GIT-101`, `GIT-201`

### GIT-302. Read-only Git compare session

목표:

- 선택한 `GitChangedFile`을 기존 2-way viewer용 read-only session으로 변환한다.

변경 후보:

- `src-tauri/src/git/session.rs`
- `src/core/gitSession.ts`
- 필요한 기존 compare model의 좁은 확장

수용 기준:

- M은 same path, R은 old↔new path를 연다.
- A/D는 missing과 empty blob을 구분한다.
- snapshot side의 edit, hunk copy, save를 비활성화한다.
- revision + short ID + path label을 표시할 data를 제공한다.

실패/경계:

- binary, symlink, submodule, object missing, revision race를 처리한다.

테스트:

- 모든 status의 session mapping unit test.
- branch/HEAD/index/working tree가 전후 동일한 integration guard.

의존: `GIT-202`, `GIT-203`, `GIT-301`

## 6. Milestone Git-4 — Working tree compare

### GIT-401. Porcelain v2 status parser

목표:

- working tree의 branch/dirty/unmerged/untracked 상태를 읽는다.

변경 후보:

- `src-tauri/src/git/status.rs`
- `src-tauri/src/git/parsers.rs`

수용 기준:

- `status --porcelain=v2 -z --branch --untracked-files=all`을 사용한다.
- `--no-optional-locks`와 `core.fsmonitor=false`를 강제한다.
- ordinary, rename/copy, unmerged, untracked record를 파싱한다.
- index와 worktree status를 섞지 않는다.

실패/경계:

- unborn/detached branch, submodule status, path record truncation을 처리한다.

테스트:

- porcelain byte fixture와 temp repo dirty/rename/untracked/conflict fixture.
- index mtime/content가 status read로 바뀌지 않는 guard.

의존: `GIT-004`, `GIT-005`

### GIT-402. Working tree vs revision session

목표:

- disk 파일을 resolved revision blob과 비교한다.

변경 후보:

- `src-tauri/src/git/session.rs`
- `src-tauri/src/commands/git.rs`

수용 기준:

- path를 repo root 안에 lossless하게 resolve한다.
- regular file만 기존 `read_text_file` 정책으로 읽는다.
- symlink 기본 거절, root escape 거절, missing side 명시를 지킨다.
- disk와 앱 내부 unsaved buffer를 구분한다.

실패/경계:

- file이 검사 중 symlink로 바뀜, case/normalization collision, permission error, non-UTF-8 OS mapping 실패를 처리한다.

테스트:

- tempfile root escape/symlink/TOCTOU 가능한 seam/modified/deleted fixture.

의존: `GIT-302`, `GIT-401`

## 7. Milestone Git-5 — Index-stage conflict adapter

### GIT-501. Unmerged file과 stage discovery

목표:

- index의 unmerged path와 stage 1/2/3 object ID를 읽는다.

변경 후보:

- `src-tauri/src/git/conflicts.rs`
- `src-tauri/src/git/parsers.rs`

수용 기준:

- `ls-files --unmerged --stage -z --`를 사용한다.
- path별로 stage를 group하고 없는 stage를 명시한다.
- merge/rebase/cherry-pick state를 가능한 범위에서 label한다.
- stage mode를 함께 보존한다.

실패/경계:

- add/add, delete/modify, both deleted, rename conflict, 중복/잘못된 stage를 처리한다.

테스트:

- pure parser와 실제 conflict temp repo fixture.

의존: `GIT-005`, `GIT-202`, `GIT-401`

### GIT-502. Git conflict merge session

목표:

- stage snapshot과 working tree Result로 기존 merge UI session을 만든다.

변경 후보:

- `src-tauri/src/git/session.rs`
- `src/core/gitSession.ts`
- merge model의 origin metadata

수용 기준:

- stage 1/2/3을 Base/Ours/Theirs로 읽고 commit/ref label을 표시한다.
- 초기 Result는 working tree 파일의 현재 내용이다.
- 없는 stage/result를 explicit missing으로 표현한다.
- binary/symlink/submodule conflict는 text merge를 막는다.

실패/경계:

- rebase에서 Ours/Theirs 의미, marker 없는 Result, external modification을 처리한다.

테스트:

- both-modified, add/add, delete/modify, binary, rebase/cherry-pick fixture.

의존: `GIT-501`

### GIT-503. Conflict Result safe save

목표:

- index를 건드리지 않고 Result path 하나만 기존 safe writer로 저장한다.

변경 후보:

- `src-tauri/src/git/conflicts.rs`
- 기존 `commands/files.rs` safe-write 호출 경계
- `src/core/mergeSave.ts`

수용 기준:

- 저장 직전 stage set과 Result fingerprint를 다시 확인한다.
- root containment, regular-file/missing-target, symlink 정책을 적용한다.
- temp/flush/fsync/backup/atomic replace를 재사용한다.
- `git add`나 continue를 실행하지 않는다.
- 성공 메시지가 다음 terminal 작업을 명시한다.

실패/경계:

- conflict state 변경, Result 삭제/교체, backup 실패, locked file, unresolved marker를 처리한다.
- Git `.orig`와 `.bak.*` 중복을 숨기지 않는다.

테스트:

- fake runner command record에 mutation 0개.
- 저장 fault injection과 Forktail 프로세스가 실행 중인 checkpoint의 temp repo HEAD/refs/index byte 비교. 외부 `git mergetool` wrapper가 프로세스 종료 후 수행하는 staging은 이 테스트와 분리한다.

의존: `GIT-502`, `SAV-003`, `SAV-008`

## 8. Milestone Git-6 — UI

### GIT-601. Repository screen과 picker

목표:

- `Open Git Repository`와 repository header shell을 추가한다.

변경 후보:

- `src/core/models.ts`
- `src/components/StartPage.tsx`
- `src/components/GitCompareView.tsx`
- `src/App.tsx`

수용 기준:

- 선택 folder를 `GIT-004` command로 검증한다.
- root/worktree/current branch 또는 detached HEAD/local-only 상태를 표시한다. `GIT-401`이 먼저 승격된 경우에만 dirty/upstream/ahead-behind 상태도 표시한다.
- pending/error/cancel/stale response를 기존 UX와 일관되게 처리한다.
- Git 화면에서 mutation action을 노출하지 않는다.

실패/경계:

- dialog cancel, non-repo, Git missing, unsafe repo를 구분한다.

테스트:

- component state/keyboard/accessibility와 bridge contract.

의존: `GIT-004`; dirty/upstream/ahead-behind 표시는 선택 의존 `GIT-401`

### GIT-602. Revision selector

목표:

- 좌우 revision 선택과 manual input validation을 추가한다.

변경 후보:

- `src/components/GitRevisionSelector.tsx`
- `src/core/gitSession.ts`

수용 기준:

- HEAD/current/local branches/remotes/tags를 구분한다.
- manual input은 submit/debounce 정책으로 `GIT-101`을 호출한다.
- resolved short ID와 invalid/ambiguous 오류를 inline 표시한다.
- stale validation 결과를 버린다.

실패/경계:

- 동일 revision, empty/unborn repo, reflog advanced input을 처리한다.

테스트:

- keyboard/combobox accessibility, race, error mapping.

의존: `GIT-101`, `GIT-102`; `GIT-103`은 선택

### GIT-603. Changed-files sidebar와 read-only viewer

목표:

- changed-file list, filter, rename display, snapshot diff를 연결한다.

변경 후보:

- `src/components/GitChangedFiles.tsx`
- `src/components/GitCompareView.tsx`
- `src/components/FileCompareView.tsx`의 최소 read-only capability

수용 기준:

- status text와 count를 색상 외 방식으로 표시한다.
- rename은 old → new와 score를 표시한다.
- 선택 file만 blob을 읽고 cancel/stale result를 처리한다.
- edit/hunk copy/save UI가 snapshot에서 비활성이다.

실패/경계:

- huge list virtualize gate, binary/missing/type-changed notice, selection loss를 처리한다.

테스트:

- component interaction, accessibility, read-only regression, 10k generated rows.

의존: `GIT-302`, `GIT-601`, `GIT-602`

### GIT-604. Conflict list UI

목표:

- unmerged file list에서 Git conflict merge session을 연다.

변경 후보:

- `src/components/GitConflictView.tsx`
- `src/App.tsx`

수용 기준:

- conflict type/path/stage availability를 표시한다.
- save 후 status를 refresh하지만 자동 resolved/staged로 표시하지 않는다.
- operation/ref label과 terminal next step을 보여준다.
- dirty close guard를 기존 merge와 공유한다.

실패/경계:

- conflict가 외부에서 해결/삭제됨, file 전환 중 dirty result를 처리한다.

테스트:

- component state, save/refresh, external-state race, keyboard navigation.

의존: `GIT-503`, `GIT-601`

### GIT-605. Working-tree changed-files UI

목표:

- 현재 worktree의 modified/deleted/renamed/untracked 목록에서 revision compare를 연다.

변경 후보:

- `src/components/GitWorkingTreeFiles.tsx`
- `src/components/GitCompareView.tsx`
- `src/core/gitSession.ts`

수용 기준:

- staged와 unstaged 상태, untracked, unmerged를 서로 다른 text label로 표시한다.
- 선택 path를 `GIT-402`의 working tree ↔ resolved revision session으로 연다.
- current branch, upstream, ahead/behind는 `GIT-401`이 제공하는 범위에서만 표시한다.
- refresh와 compare가 index/worktree를 바꾸지 않는다.

실패/경계:

- 외부 변경으로 entry가 사라짐, sparse missing, non-UTF-8 path, untracked의 비교 상대 없음 상태를 처리한다.

테스트:

- component filter/selection/stale refresh/read-only snapshot과 mutation guard.

의존: `GIT-401`, `GIT-402`, `GIT-601`, `GIT-602`

### GIT-606. 전체 tracked-file tree와 path picker

목표:

- changed-file 목록에 없는 tracked path도 양쪽 revision에서 직접 찾아 비교한다.

변경 후보:

- `src/components/GitTreePicker.tsx`
- `src/components/GitCompareView.tsx`
- `src/core/gitSession.ts`

수용 기준:

- 기본 화면은 changed files를 유지하고 사용자가 명시적으로 전체 tree를 연다.
- revision별 tree를 lazy/batch로 읽고 fuzzy path search를 제공한다.
- 동일 path뿐 아니라 사용자가 고른 left/right의 서로 다른 path도 비교한다.
- 10k/100k entry에서 DOM과 memory가 제한되고 cancel/stale result를 처리한다.

실패/경계:

- tree에는 있지만 한쪽에 없는 path, symlink/submodule, byte-path display collision을 처리한다.

테스트:

- tree virtualization/search/keyboard, opaque path identity, different-path session mapping.

의존: `GIT-201`, `GIT-202`, `GIT-302`, `GIT-601`, `GIT-602`; read-only MVP 뒤 선택

## 9. Milestone Git-7 — Merge-base preview

### GIT-701. Merge-base service

목표:

- 두 resolved commit의 merge base 목록을 계산한다.

변경 후보:

- `src-tauri/src/git/merge_base.rs`

수용 기준:

- `merge-base --all`을 사용한다.
- 0, 1, multiple base를 서로 다른 typed state로 반환한다.
- 여러 base에서 임의 선택하지 않는다.

실패/경계:

- unrelated histories, criss-cross, object missing을 처리한다.

테스트:

- fake parser와 temp repo unrelated/multiple-base 가능한 fixture.

의존: `GIT-101`

### GIT-702. Read-only 3-way preview

목표:

- merge base와 left/right blob을 기존 merge engine의 preview session으로 연다.

변경 후보:

- `src-tauri/src/git/session.rs`
- `src/core/gitSession.ts`
- merge UI의 preview capability

수용 기준:

- Base/Left/Right label과 object ID를 표시한다.
- Result는 임시 memory buffer이고 Save/Save As를 비활성화한다.
- 실제 Git merge 결과가 아니라는 설명이 있다.
- missing/binary/type-change side를 안전하게 처리한다.

실패/경계:

- multiple base, path rename across branches, one-sided path를 처리한다.

테스트:

- clean/conflict preview mapping과 read-only UI regression.

의존: `GIT-202`, `GIT-701`, `MRG-001`

## 10. Milestone Git-8 — 문서와 출시 증거

### GIT-801. 사용자 문서와 release evidence

목표:

- 지원 범위, 한계, no-network/no-mutation 증거를 사용자 문서와 검증 기록에 남긴다.

변경 후보:

- `README.md`
- `docs/17_GIT_INTEGRATION.md`
- `docs/20_GIT_TEST_PLAN.md`
- `VALIDATION.md`

수용 기준:

- branch/commit compare, working tree compare, conflict save 흐름을 설명한다.
- raw blob/LFS/submodule/non-UTF-8/partial clone 제한을 문서화한다.
- `INT-002`의 difftool/mergetool 설정과 repository-aware Git 화면을 구분한다.
- Windows/macOS/Linux packaged smoke 결과와 Git version을 기록한다.
- 미검증 항목을 통과로 쓰지 않는다.

실패/경계:

- custom merge driver를 지원 대상으로 오인하게 하지 않는다.
- `trustExitCode=true`를 lifecycle 증거 없이 권장하지 않는다.

테스트/검증:

- `docs/20_GIT_TEST_PLAN.md`의 release checklist.
- 문서 link/command example review.

의존: 출시할 `GIT-*`, `MRG-014`, `INT-002`

## 11. 권장 실행 순서

Read-only MVP:

```text
GIT-000 → GIT-001 → GIT-002 → GIT-003 → GIT-004 → GIT-005
→ GIT-101 → GIT-102 → GIT-201 → GIT-202 → GIT-203
→ GIT-301 → GIT-302 → GIT-601 → GIT-602 → GIT-603
```

그다음:

```text
GIT-401 → GIT-402
→ GIT-605
→ GIT-501 → GIT-502 → GIT-503 → GIT-604
→ GIT-701 → GIT-702
→ GIT-801
```

`GIT-103` recent commit과 `GIT-606` 전체 tracked-file picker는 convenience 기능이므로 read-only MVP의 필수 경로가 아니다. Git-1 MVP가 실제 사용자 검토 시간을 줄이는지 확인한 뒤 추가한다.
