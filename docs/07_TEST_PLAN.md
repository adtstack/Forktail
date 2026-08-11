# 07. Test Plan

## 1. 목표

비교 도구의 테스트는 화면이 그럴듯한지보다 다음을 보증해야 한다.

- 같은 입력은 같은 결과를 만든다.
- 차이를 놓치거나 없는 차이를 만들지 않는다.
- 병합이 사용자 변경을 조용히 버리지 않는다.
- 실패한 저장이 기존 파일을 손상시키지 않는다.
- OS·인코딩·줄바꿈 차이가 예측 가능한 방식으로 처리된다.

## 2. 테스트 계층

### 순수 단위 테스트

대상:

- conflict parser/resolver
- line ending detector
- path/status 분류
- hash helpers
- option normalization
- serialization contract
- bounded editor location history, dedupe, stale skip

특징:

- 파일 시스템 없이 빠르게 실행
- 모든 PR에서 실행
- 실패 메시지에 입력 사례가 드러남

### 파일 시스템 통합 테스트

대상:

- read/decode
- directory scan
- hash compare
- atomic save/backup
- symlink/permissions

`tempfile` 또는 테스트 전용 임시 디렉터리를 사용한다. 실제 사용자 경로를 사용하지 않는다.

### UI 상호작용 테스트

대상:

- mode 전환
- next/previous diff
- conflict resolution
- dirty/unsaved guard: mode 전환, window close, OS application-level quit를 같은 React 확인 흐름으로 처리하고 승인된 programmatic exit는 재진입하지 않음
- keyboard shortcuts
- folder filters
- folder-first 계층, 필터된 파일의 상위 폴더 문맥, collapse descendant 숨김
- folder row 단일 클릭 선택과 일반 파일 더블 클릭/Enter 열기
- 폴더 목록의 항상 보이는 `단일 클릭=선택 / 더블 클릭·Enter=활성화` 안내와 표 설명 연결
- editor pane/cursor/viewport restore와 mouse Back command
- Monaco 최초 mount callback에서 2-way/3-way navigation binding 등록

Monaco 자체를 다시 테스트하지 말고 앱이 Monaco API를 올바르게 호출하는지 확인한다.

### E2E smoke

Tauri 실제 창에서 다음 핵심 여정만 자동화한다.

1. 두 파일 열기 → 다음 차이
2. 폴더 열기 → changed 파일 열기
3. 세 파일 열기 → 충돌 해결 → Save As
4. 저장 실패 시 원본 보존

### 수동 플랫폼 테스트

OS 통합, installer, file dialog, native menu, hardware mouse Back 전달, code signing, 외부 editor와
file locking은 실제 OS에서 확인한다.

`UX-009`는 순수 history/Monaco adapter/OS shortcut matcher/button-3 routing/native menu boolean
contract를 자동 검증한다. Windows WebView2, macOS WKWebView, Linux WebKitGTK의 실제 X1 전달과
packaged accelerator는 `user-owned / manual-not-run`으로 별도 기록하며, 실행 전에는 pass로 표시하지
않는다. live folder cross-item restore는 exact scan identity, dirty/stale/non-text skip, matching mount,
64 KiB chunk cancellation, all-or-nothing pair response를 자동 검증한다. Git cross-item은 T081/T082가
완료된 뒤 같은 matrix에 추가한다.

## 3. 2-way fixture matrix

| 범주 | 사례 | 기대 |
|---|---|---|
| 기본 | 동일 파일 | diff 0 |
| 기본 | 한 줄 수정 | hunk 1 |
| 기본 | 파일 전체 추가/삭제 | 모든 줄 changed |
| 빈 입력 | empty vs text | 정상 표시 |
| 반복 | 동일한 줄이 여러 번 등장 | 안정적 alignment |
| 공백 | trailing spaces | 옵션에 따라 변경/무시 |
| 공백 | tabs vs spaces | 옵션에 따라 변경/무시 |
| EOL | LF vs CRLF | EOL 옵션에 따라 변경/무시 |
| EOF | final newline 유/무 | 별도 신호 |
| Unicode | 한글/emoji/combining mark | 손실 없이 표시 |
| 길이 | 한 줄 1 MiB | freeze 없이 제한/표시 정책 |
| binary | NUL 포함 | binary 거절 |
| size | 64 MiB 초과 | 안전 한도 오류 |
| symlink | 외부 일반 파일을 가리키는 선택 path | target 내용을 반환하지 않고 path 오류 |
| size race | open 뒤 64 MiB 초과로 성장 | bounded read 후 `TOO_LARGE`, partial text 미반환 |
| read race | 내용 read 전후 length/mtime 또는 path identity 변경 | `FILE_CHANGED`, stale text 미반환 |
| version fingerprint | stat/optional stat의 symlink, 64 MiB 초과·성장, 같은 metadata path swap | target 내용을 읽지 않고 bounded hash 또는 안정된 오류 |

## 4. 인코딩 round-trip matrix

- UTF-8 no BOM
- UTF-8 BOM
- UTF-16LE BOM
- UTF-16BE BOM
- Windows-1252 추정
- EUC-KR/CP949 추정 사례
- 잘못된 byte sequence
- mixed line endings
- no final newline
- 저장 EOL original/system/LF/CRLF 변환
- mixed 입력의 original 저장 보존 정책

각 fixture는 다음을 기록한다.

```json
{
  "expectedEncoding": "UTF-8",
  "expectedLineEnding": "lf",
  "decodeHadErrors": false,
  "roundTripByteIdentical": true
}
```

탐지 기반 legacy encoding은 byte-identical 보장이 어려울 수 있으므로 명시적 encoding 선택 UI가 생기기 전에는 저장 경고를 테스트한다.

## 5. 폴더 fixture matrix

```text
left/                    right/
  same.txt                 same.txt
  changed.txt              changed.txt
  only-left.txt
                           only-right.txt
  kind-conflict/           kind-conflict (file)
  nested/a.txt             nested/a.txt
```

추가 생성 테스트:

- 10k/100k files
- 깊이 100 이상 path
- Unicode/NFC/NFD names
- Windows reserved-like names where supported
- case-only path difference and portable path identity warning
- symlink loop
- broken symlink
- unreadable file/directory
- file changed during hashing
- timestamp resolution 차이
- sparse file
- copy/sync dry-run: 실제 파일 변경 없이 복사·덮어쓰기·차단 계획만 표시
- copy/sync dry-run root escape: `..`, 절대 경로, drive path, 빈 segment 차단
- scan job id 전달, cancel command, 늦게 도착한 결과 무시
- hash loop 중 cancel 시 `CANCELLED` 오류와 UI 취소 안내
- `awaitingPeer → awaitingHash → final` 제자리 upsert와 terminal 시 pending 0건
- exact path revision, duplicate/late 무시, sequence gap 실패, rapid rescan generation 격리
- 256행/256KiB/50ms batch와 cumulative ACK 4 batch/1MiB 상한
- inventory queue full, hash, ACK wait 각각의 cooperative cancel과 terminal exactly once
- metadata/quick/full progressive 결과의 one-shot reference path/status/error/stats parity
- pending 행의 final count·sync dry-run·open 제외와 final regular-file만 더블 클릭/Enter 허용
- scan 중 folder-first 계층, 상위 폴더 문맥, exact-path 선택 유지, unknown total 백분율 미표시

대용량 benchmark는 임시 10k/100k metadata fixture를 release test에서 생성하고 fixture 생성 시간은
측정에서 제외한다. warm-up 1회 뒤 5회를 측정해 first batch/첫 200행/terminal median·p95, 최대 batch와
미확인 ACK window, 취소 latency, process peak RSS 증가, one-shot parity를 기록한다. correctness, queue
상한, parity, 취소 1초 이내, 100k RSS 증가 250MiB 이하는 hard gate다. WebView main-thread 100ms와
macOS/Windows/Linux packaged 동작은 native benchmark로 대체하지 않고 별도 manual evidence로 남긴다.

### FOL-020 독립 검토 창 matrix

| 계층 | 사례 | 기대 |
|---|---|---|
| UI | 단일 클릭 100회, 파일 더블클릭/Enter, 폴더·pending 행 | 단일 클릭 open/read 0건, final regular file만 detached open, 폴더는 collapse만 수행 |
| Registry | 같은 exact identity 동시 open 100회, stale handle, build 실패 | child 하나로 수렴하고 restore/focus, stale retry, reservation rollback |
| 한도 | 서로 다른 8/9개 identity, duplicate-at-limit, 256 MiB 전후 | 8개까지 허용, 9번째/byte 초과만 행동 가능한 오류, 기존 창 불변 |
| Pair read | one-sided missing, binary/LFS/oversized/symlink/escape/stale, 같은 metadata 교체, mid-read/cross-side 변경 | 양쪽 current bounded re-read의 identity+raw bytes+hash가 모두 같을 때만 all-or-nothing pair, partial/stale text 0건 |
| 수명 | rescan 중 load, ready snapshot, child destroy, main destroy/app exit, late completion | load 취소, ready snapshot 유지와 change notice, registry/byte 누수 0건 |
| 격리 | 두 child navigation/error, native menu, Save shortcut | 창별 상태 독립, focused surface 한 곳에만 전달, mutation 0건 |
| Privacy/ACL | manifest/permission parity, URL/label/title/model/storage/log sentinel | child는 caller-bound load/check/reload만 허용하고 root/token/content 비노출 |

component와 Rust pure/integration test가 위 계약을 자동 검증한다. 실제 OS window의 create, move, resize,
minimize/restore, focus, close, quit과 shell 300ms/1 MiB pair 1초 목표는 packaged macOS/Windows/Linux에서
별도 측정한다. 실행하지 않은 platform/performance 항목은 자동 테스트 통과와 합쳐서 pass로 기록하지
않는다.

비교 모드별 expected:

- Metadata: size+mtime
- Quick hash: size+sample hash
- Full hash: full content hash

## 6. 3-way merge fixture matrix

각 fixture 디렉터리:

```text
fixtures/three-way/<case>/
  base.txt
  ours.txt
  theirs.txt
  expected.txt
  metadata.json
```

필수 사례:

1. non-overlapping modify
2. same overlapping modify
3. different overlapping modify
4. insert same position same text
5. insert same position different text
6. delete vs untouched
7. delete vs modify
8. move-like delete/add
9. repeated lines ambiguity
10. empty base
11. empty ours/theirs
12. CRLF
13. no final newline
14. marker-like user text
15. multiple conflicts
16. conflict at first/last line
17. Unicode normalization difference
18. 30-conflict parser benchmark fixture

검증:

- `clean`
- `conflictCount`
- exact output bytes after newline policy
- resolve each strategy
- first conflict resolution followed by reparse
- arbitrary conflict resolution order
- undo/redo
- 반복 parser benchmark가 expected conflict count를 잃으면 실패

## 7. 저장 fault injection

저장 서비스에 test seam을 두어 다음 단계에서 강제로 실패시킨다.

1. temp create
2. backup copy
3. write after N bytes
4. flush
5. fsync
6. permission copy
7. replace
8. parent directory sync

1~7단계의 교체 전 실패 테스트는 다음을 확인한다.

- 기존 target 내용이 원래와 같다.
- 성공하지 않은 결과를 완료로 보고하지 않는다.
- temp/backup 잔여 파일 정책이 문서와 일치한다.
- 재시도 가능하다.

8단계 parent directory sync 실패는 atomic replace 뒤의 오류다. 이 경우 새 target을 원본으로 자동
rollback해 새 데이터를 버리지 않고, 새 bytes가 target에 남으며 교체 전 bytes가 backup에 보존되고,
`WRITE_FAILED`와 저장 상태 재확인 안내가 반환되는지 fault seam으로 검증한다.

추가 백업 정책 테스트:

- timestamp 백업 이름이 기존 백업을 덮어쓰지 않는다.
- 같은 대상의 백업 목록은 최신순이며 관련 없는 파일을 포함하지 않는다.
- 저장 후 retention count를 초과한 오래된 백업이 제거된다.
- 백업 복원은 현재 target을 다시 백업하고 unrelated backup path를 거절한다.
- backup symlink는 목록에서 제외하고 복원 source로 거절한다.
- 64 MiB 초과 backup은 target이나 backup을 추가로 변경하지 않고 allocation 전에 거절한다.
- restore source의 mid-read 축소·성장, 같은 size/mtime 재작성과 path swap은 stable raw snapshot 없이
  target을 교체하지 않고 `FILE_CHANGED`/`TOO_LARGE`로 거절한다.
- save backup source가 읽는 중 성장하거나 torn snapshot이면 bounded read가 중단되고 새 backup을 확정하지
  않는다.
- 최종 precondition의 `FILE_CHANGED`와 replace 실패는 이번 저장의 새 backup만 rollback하며 기존 backup
  name/bytes와 retention을 그대로 유지한다. 성공한 저장만 최신 10개를 유지한다.
- replace 뒤 parent directory sync 실패는 target을 rollback하지 않고 pre-save backup을 보존하되 retention은
  삭제하지 않는다.

추가 외부 변경 precondition 테스트:

- content hash 확인은 symlink/reparse point를 따라가지 않고 64 MiB + 1 byte bounded read를 사용한다.
- preflight 뒤 transient symlink 또는 같은 metadata path 교체가 발생하면 backup/temp/target 변경 전에
  `FILE_CHANGED`로 fail closed한다.

## 8. 속성/퍼즈 테스트 후보

- `resolveConflict`는 선택 block 바깥 문자열을 바꾸지 않는다.
- parser가 반환하는 block은 겹치지 않고 offset 오름차순이다.
- 모든 conflict를 ours로 해결한 결과에는 표준 marker가 없다.
- identical files full hash는 항상 same이다.
- save success 후 read 결과가 입력 text와 같다.
- arbitrary bytes read command는 panic하지 않는다.

## 9. CI gate

PR 필수:

```bash
npm ci
npm run typecheck
npm test
npm run build
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
```

로컬 데스크톱 실행 전:

```bash
npm run doctor
npm run tauri dev
```

Nightly/weekly:

- large generated folder benchmark
- fuzz corpus and SEC-004 marker flood/control character/path edge fixtures
- direct JS dependency license allowlist unit test, npm/Rust advisory triage

릴리즈 준비(`REL-005`):

- `npm run version:bump -- X.Y.Z`는 package/npm lock/Tauri/Cargo/Cargo lock의 6개 project version
  필드만 같은 값으로 갱신한다.
- invalid, 동일, 하향, build-metadata-only 버전과 기존 version 불일치는 zero-mutation으로 실패한다.
- 중간 file replace 실패를 주입해 이미 갱신한 파일까지 원문으로 rollback되는지 확인한다.
- 교체 직전 대상 파일이 바뀌면 stale snapshot을 덮지 않고, 이미 교체한 파일만 안전하게 rollback한다.
- Windows CI에서도 version bump의 실제 rename/rollback fault-injection 테스트를 실행한다.
- `npm run release:validate -- vX.Y.Z`는 위 6개 필드와 tag가 모두 일치할 때만 통과한다.
- Tauri E2E
- three-platform build

Release:

- three-platform installer build
- clean VM smoke
- checksum/SBOM
- manual save failure test
- `REL-008` updater: R2 static manifest의 전체 platform 계약, 유효하지 않은 signature 거절, vN→vN+1 세 OS update, dirty session install guard, endpoint 장애, old-version migration (`docs/16_R2_UPDATER_RUNBOOK.md`)

## 10. 수동 smoke checklist

각 OS에서:

- [ ] 파일 dialog에서 Unicode 경로 열기
- [ ] network drive/removable drive 취소·분리 처리
- [ ] readonly file 저장 오류
- [ ] 다른 앱이 잠근 파일 저장
- [ ] 화면 확대 200%
- [ ] keyboard-only 2-way/3-way
- [ ] 2-way/3-way에서 hardware mouse Back과 OS별 shortcut의 이전 편집 위치 복원
- [ ] dark/light/system theme
- [ ] titlebar close와 macOS Dock Quit 등 application-level quit 중 dirty prompt, 취소 후 세션 유지, 승인 후 1회 종료
- [ ] installer upgrade/uninstall

## 11. 후속 Git integration 검증

repository-aware branch/commit/index 비교는 현재 Phase 1 release gate가 아니다. `docs/17_GIT_INTEGRATION.md`의 시작 게이트를 통과해 기능을 승격하면 이 문서의 공통 gate와 `docs/20_GIT_TEST_PLAN.md`를 모두 적용한다.

외부 Git tool packaged smoke(`INT-002`/`MRG-014`)는 `git difftool --tool=forktail --no-prompt`의 `$LOCAL`/`$REMOTE`, modified/added/deleted read-only 표시, wait/temp lifecycle과 `git mergetool --tool=forktail`의 `$BASE`/`$LOCAL`/`$REMOTE`/`$MERGED`, missing Base, 기존 `$MERGED` result/fingerprint, 기본·base 없는 Git marker, save/no-save/unresolved, `trustExitCode=false`/`hideResolved=false` 흐름을 세 OS에서 검증한다. Forktail 실행 중 index 불변과 wrapper 종료 후 Git의 예상 staging은 서로 다른 checkpoint에서 확인한다. `%O/%A/%B/%P` custom merge driver는 별도 계약이며 현재 범위에 포함하지 않는다.
