# 02. Architecture

## 1. 전체 구조

```text
┌─────────────────────────────────────────────────────┐
│ React + TypeScript                                  │
│ screens · keyboard · Monaco models · decorations    │
└───────────────────────┬─────────────────────────────┘
                        │ typed invoke/events
┌───────────────────────▼─────────────────────────────┐
│ Tauri command boundary                              │
│ narrow commands · validation · serializable errors  │
└───────────────────────┬─────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────┐
│ Rust application services                           │
│ file I/O · encoding · scan · hash · merge · save    │
└──────────────┬───────────────────┬──────────────────┘
               │                   │
      ┌────────▼────────┐   ┌──────▼──────────┐
      │ OS filesystem   │   │ Pure algorithms │
      │ metadata/fsync  │   │ diffy/BLAKE3    │
      └─────────────────┘   └─────────────────┘
```

## 2. 기술 선택

- Desktop shell: Tauri 2
- UI: React + TypeScript + Vite
- Editor/diff rendering: Monaco Editor
- 3-way line merge: diffy
- Directory traversal: ignore crate
- Hash: BLAKE3
- Encoding: BOM + encoding_rs + chardetng
- Tests: Vitest + Rust unit/integration tests
- CI: GitHub Actions

선택 근거는 `docs/10_ADR.md`에 기록한다.

## 3. 계층 책임

### UI layer (`src/components`)

- 화면 구성
- 키보드 명령
- Monaco diff/editor lifecycle
- 선택된 conflict/hunk 상태
- 사용자 메시지와 확인

### Frontend core (`src/core`)

- Rust command 타입
- 런타임 bridge
- conflict marker 파서
- 언어/확장자 매핑
- UI에서 재사용되는 순수 함수

### Command boundary (`src-tauri/src/commands`)

- 입력 경로와 옵션 검증
- 작업 서비스 호출
- 오류를 `{ code, message }`로 변환
- 프런트엔드에 필요한 최소 데이터만 반환

### Domain (`src-tauri/src/domain`)

- 직렬화 계약
- 상태 enum
- 저장/스캔/병합 결과 타입

향후 복잡해지면 command 내부 로직을 `services/`와 `core/` crate로 이동한다. 초기에는 과한 추상화를 피한다.

### Application 종료 경계

OS application-level quit는 Tauri `ExitRequested`의 사용자 요청(`code = None`)으로 들어온다. main React
surface가 살아 있으면 Rust가 해당 종료를 먼저 막고 quit command를 전달해, main의 공용
`requestLeaveActiveSession`으로 전달해 dirty 확인을 수행한다. 사용자가 승인한 뒤 호출하는
`AppHandle::exit(0)`은 programmatic 요청(`code = Some(0)`)이므로 재차 막지 않고 한 번만 종료한다. main이
이미 사라진 마지막 창 종료는 guard를 표시할 surface가 없으므로 막지 않는다. 막힌 종료 요청에서는
detached registry를 정리하지 않으며, 승인된 `ExitRequested` 또는 최종 `Exit`에서만 정리한다.

## 4. 주요 데이터 계약

### FileDocument

```ts
interface FileDocument {
  path: string;
  name: string;
  text: string;
  encoding: string;
  lineEnding: "lf" | "crlf" | "cr" | "mixed" | "none";
  hadFinalNewline: boolean;
  size: number;
  modifiedMs: number | null;
  isBinary: boolean;
  decodeHadErrors: boolean;
}
```

Phase 1은 64 MiB 이하 파일을 메모리에 올린다. 대용량 모드는 별도 설계 없이 한도를 올리지 않는다.

### FolderEntry

상대 경로가 양쪽 항목을 결합하는 키다. OS 경로는 표시/열기용 절대 경로로 별도 유지한다.

```ts
status = same | different | leftOnly | rightOnly | typeMismatch | error
```

### MergeResult

```ts
interface MergeResult {
  output: string;
  clean: boolean;
  conflictCount: number;
}
```

결과 문자열이 진실의 원천이다. UI conflict 목록은 결과 문자열을 매번 파싱해 계산한다. 충돌을 해결해 문자열 길이가 바뀌어도 stale offset을 유지하지 않는다.

## 5. 파일 열기 흐름

```text
사용자 dialog 선택
  → read_text_file(path)
  → symlink를 따르지 않는 metadata/일반 파일/size 확인
  → no-follow open과 열린 handle의 일반 파일/size 확인
  → 최대 64 MiB + 1 byte bounded read
  → 읽기 전후 length/mtime와 현재 path identity 재확인
  → BOM 확인
  → binary probe
  → decode
  → EOL/final newline 계산
  → FileDocument 반환
  → Monaco model 생성
```

`FileDocument.size`와 `contentHash`는 검증된 열린 handle에서 실제로 읽은 같은 byte snapshot을 기준으로
계산한다. 읽는 동안 크기·mtime·path identity가 달라지면 partial/stale text를 반환하지 않고
`FILE_CHANGED`, 어느 시점이든 64 MiB를 넘으면 `TOO_LARGE`로 거절한다.

`stat_text_file_version`, optional stat과 저장 전 content-hash precondition도 별도 `metadata + File::open`
조합을 쓰지 않고 같은 안전 snapshot 경로를 사용한다. 따라서 symlink/reparse point, 64 MiB 초과·읽기 중
성장, 같은 size/mtime의 path 교체를 hash로 승인하지 않는다. 저장 precondition snapshot을 안정적으로
검증할 수 없는 경우에는 덮어쓰기를 진행하지 않고 `FILE_CHANGED`로 fail closed한다.

### 인코딩 정책

1. UTF BOM이 있으면 최우선한다.
2. BOM이 없고 NUL이 탐지되면 binary로 분류한다.
3. 나머지는 detector 결과로 디코딩한다.
4. replacement가 발생하면 `decodeHadErrors`를 표시한다.
5. 2-way 단일 파일 저장은 원본 메타데이터 기준으로 UTF-8, UTF-8 BOM, UTF-16LE BOM, UTF-16BE BOM을 보존한다. 병합 결과·diff 리포트와 legacy 추정 인코딩은 UTF-8로 기록하며 저장 화면에서 경고한다.

### 저장 줄끝 정책

1. 기본 `original` 저장은 원본이 LF/CRLF/CR 중 하나로 일관되면 해당 줄끝으로 저장 직전에 정규화한다.
2. 원본이 `mixed` 또는 `none`이면 `original` 저장은 현재 편집 텍스트의 줄끝을 그대로 보존한다.
3. 사용자가 `system`, `LF`, `CRLF`를 선택하면 저장 직전에 모든 줄끝을 선택한 정책으로 변환한다.
4. 일반 3-way 병합 결과의 `original` 기준은 OURS 파일의 줄끝 메타데이터다.
5. 외부 `git mergetool`은 Git이 만든 기존 `$MERGED`를 초기 Result로 사용하므로, 이 모드의 `original` 기준은 `$MERGED`를 열 때 읽은 줄끝 메타데이터다.

## 6. 폴더 비교 알고리즘

### 수집

각 root를 순회해 다음 map을 만든다.

```text
relative/path -> { absolute path, kind, size, modified time }
```

### 결합

두 key 집합의 union을 정렬하고 상태를 계산한다.

### 내용 열기 경계

폴더 스캔의 상태 분류와 편집기 내용 비교는 별도 책임이다. 스캐너는 일반 파일을 메타데이터 또는 해시로 비교할 수 있지만, 사용자가 행을 열 때는 존재하는 일반 파일마다 `read_text_file`의 텍스트 판별을 다시 통과해야 한다. 한쪽에만 있는 일반 파일은 반대쪽을 `virtual.kind = "missing"`인 빈 `FileDocument`로 만든다. 이 가상 문서는 DiffEditor 표시용이며 저장, 백업, 외부 변경 감지, 최근 compare session 저장 대상이 아니다. 비텍스트 입력을 WebView로 전달하거나 임의 디코딩하지 않는다.

### 비교 모드

- Metadata: size + modified time
- Quick hash: size가 같을 때 length + 앞 64 KiB + 뒤 64 KiB BLAKE3
- Full hash: 전체 파일 BLAKE3

Quick hash는 속도를 위한 확률적 비교다. 최종 확정이 필요한 사용자는 Full hash를 선택한다. UI에서 이 차이를 설명한다.

### 점진 스캔과 성능 경계

`FOL-006R`의 기본 UI 경로는 전체 결과 DTO를 기다리지 않는다.

```text
start_folder_scan(request, Channel) -> { jobId, scanGeneration, optionsFingerprint }
  left/right inventory producer -> bounded queue (512 records)
  exact-relative-path coordinator
    -> pending/final upsert batch
    -> coalesced progress
frontend keyed accumulator -> cumulative ACK
completed | cancelled | failed terminal summary
```

행 batch는 256 upsert, 직렬화 추정 256 KiB, 50ms 중 먼저 도달한 조건에서 전송한다. progress는
최대 100ms마다 합쳐 보내며 아직 전체 항목 수를 모르는 inventory 단계에서는 백분율을 만들지 않는다.
WebView가 적용했다고 확인하지 않은 batch는 최대 4개 및 추정 1 MiB로 제한한다. Rust worker는 이
ACK credit, inventory queue, hash loop에서 같은 취소 token을 확인하며 창 종료도 해당 owner의 job을
취소한다. terminal은 정확히 한 번 전송하고 전체 row 배열을 다시 싣지 않는다.

프런트엔드는 `jobId + scanGeneration + optionsFingerprint`가 현재 scan과 모두 일치하는 메시지만 exact
relative path map에 revision 순서로 적용한다. duplicate/late message는 버리고 sequence gap은 현재 결과를
신뢰하지 않은 채 오류로 종료한다. React snapshot은 animation frame 단위로 합쳐 게시한다. 폴더 화면은
pending 행도 상위 폴더 문맥 아래 folder-first로 보여주며 선택 identity는 배열 index가 아닌 exact path다.
단일 클릭은 선택만 하고, 확정된 일반 파일의 더블 클릭 또는 Enter만 비교 화면을 연다.

기존 `scan_directories` one-shot 구현은 최종 상태·오류·통계 parity를 검증하는 reference oracle로
유지한다. App의 새 폴더 비교 시작 경로는 `start_folder_scan` typed Channel을 사용한다. persistent hash
worker pool과 cache 교체는 측정 근거를 바탕으로 `FOL-008`, `FOL-009`에서 별도로 다룬다.

폴더 결과에서 text 항목을 다시 여는 경로는 일반 파일 command 두 개를 병렬 호출하지 않는다.
`read_folder_review_text_pair(request, jobId)`가 양쪽 expectation, canonical root containment,
non-symlink regular-file, size/binary/LFS 정책을 먼저 검증한 뒤 all-or-nothing DTO를 반환한다. 각 side는
검증 단계에서 no-follow로 연 handle과 preflight를 결속하고 그 handle에서 최대 64 MiB + 1 byte만 읽는다.
양쪽 raw snapshot을 모두 얻은 뒤 현재 root-relative path를 다시 no-follow open/bounded read해 handle
identity, size/mtime, exact bytes와 BLAKE3가 모두 같은 경우에만 decode한다. 따라서 한쪽 read 뒤 반대쪽을
읽는 동안 발생한 변경과 같은 size/mtime의 torn read도 partial DTO 없이 `FILE_CHANGED`로 거절한다. 읽기는
blocking worker에서 64 KiB chunk마다 취소를 확인하고 terminal path에서 job registry를 정리한다.
editor history에는 root/path/content 대신 process-only review token, scan generation, normalized item key와
side kind만 저장하며 matching Monaco mount가 cursor/viewport를 복원한 뒤에만 candidate를 소비한다.

### 폴더 비교 독립 검토 창

`FOL-020`은 main 폴더 결과와 파일 내용을 한 React tree에 함께 올리지 않는다. final regular-file 행을
더블클릭하거나 `Enter`로 실행하면 main 전용 async command가 고정된
`index.html?surface=folder-review` route의 `WebviewWindow`를 만들고, child가 표시된 뒤 자신의 label로
caller-bound initial load를 요청한다. 단일 클릭은 선택만 바꾸며 폴더 행은 접기·펼치기만 한다.

native registry는 owner, process-only token, scan generation, exact row identity, 양쪽 metadata
expectation, load revision, retained source byte 수만 보관한다. `FileDocument`와 text는 보관하지 않는다.
같은 live review의 같은 exact identity는 하나의 reservation으로 수렴하고 기존 창을 restore/focus한다.
서로 다른 창은 최대 8개, 성공적으로 전달된 source snapshot 합계는 256 MiB로 제한한다. build/load 실패,
`WindowEvent::Destroyed`, main destroy와 app exit는 reservation, cancellation, byte accounting을 정리한다.
ready snapshot은 main navigation 뒤 유지하고, source generation invalidation은 아직 load 중인 작업만
취소한다.

child는 argument 없는 `load/check/reload` 세 command만 호출할 수 있다. root/path/token은 URL, window
label, OS title, Monaco URI에 넣지 않으며, title은 정제된 basename과 상대 부모 문맥만 사용한다. 실제
relative path와 좌우 root는 caller 검증 뒤 반환되는 context DTO로 child 내부 header에만 표시한다.
Monaco model은 opaque process identity를 사용하고 settings/recent/active session을 저장하지 않는다.
`folderReview` origin은 Save, Save As, hunk copy, swap, drop, export를 모두 금지한다.

application command 전체 목록은 `build.rs`의 `AppManifest::commands`가 단일 기준이다. main capability는
모든 reviewed app command와 dialog를, `folder-review-*` capability는 위 세 read-only command와 최소
window/event 권한만 가진다. native menu event는 broadcast하지 않고 현재 focused WebView 하나에만
보낸다.

해시 비교는 같은 상대 경로의 좌/우 파일을 파일 쌍 단위로 병렬 계산한다. 동시 worker는 파일 쌍당 2개로 제한하며, 각 worker도 같은 job id cancellation check를 공유한다.

해시 결과는 `path + size + modified_ms + hash_mode` 키로 프로세스 내 cache에 저장한다. `QuickHash`와 `FullHash`는 서로 다른 cache key를 사용하므로 비교 옵션 변경 시 잘못 재사용하지 않는다. cache가 4096개를 넘으면 전체를 비워 unbounded memory 증가를 피한다.

## 7. 3-way merge 흐름

```text
base/ours/theirs read
  → diffy::merge(base, ours, theirs)
  → clean output OR diff3 conflict output
  → result editor
  → parseConflictBlocks(result)
  → user resolution replaces one block
  → reparse whole result
  → conflict count reaches zero
  → safe save
```

전체 결과 재파싱은 일반 파일 크기에서 단순하고 정확하다. 성능 문제가 측정되기 전 incremental parser를 만들지 않는다.

### Git difftool 계약

custom `git difftool`은 `$LOCAL`, `$REMOTE`를 command에 넘긴다. 목표 호출은 다음 두 경로의 **위치를 보존한 채** 전달한다.

```text
forktail --difftool "$LOCAL" "$REMOTE"
```

added/deleted file에서 Git은 한쪽을 빈 인자 또는 `/dev/null`로 전달할 수 있다. config generator가 `/dev/null`을 빈 인자로 정규화하고 CLI parser는 이를 missing document로 보존한다. 두 쪽이 모두 missing이면 잘못된 호출로 거절한다.

difftool session은 두 입력을 read-only로 연다. 편집, Save/Save As, hunk 적용, 좌우 교환, Drag & Drop 교체, backup restore를 허용하지 않고 Git 임시 path를 recent/active session에 저장하지 않는다. plain text diff report는 사용자가 별도 경로를 명시적으로 고르는 export이므로 허용한다. `Close Forktail`은 dirty 확인 없이 실제 Tauri 창과 process를 닫아 Git의 wait를 끝낸다.

### Git mergetool 계약

custom `git mergetool`은 `$BASE`, `$LOCAL`, `$REMOTE`, `$MERGED` 환경 변수를 command에 넘긴다. 목표 호출은 다음 네 경로를 순서대로 전달한다.

```text
forktail --mergetool "$BASE" "$LOCAL" "$REMOTE" "$MERGED"
```

- `$BASE` → Base source. Git은 공통 조상 stage가 없는 add/add에서도 0-byte 임시 path를 만들 수 있다. generated wrapper는 Git mergetool shell의 `base_present=false`를 빈 positional argument로 바꾸고 `/dev/null`도 정규화하며, CLI parser는 그 빈 slot을 missing Base로 보존한다. 실제 empty base도 0 bytes일 수 있으므로 파일 크기로 missing을 추정하지 않는다. `base_present`가 없으면 path를 그대로 보존하는 fail-safe이며 최소 Git/세 OS 호환성은 T009에서 검증한다.
- `$LOCAL` → Ours/current source
- `$REMOTE` → Theirs/other source
- `$MERGED` → Git이 이미 만든 working tree result이자 유일한 저장 대상

`%O`, `%A`, `%B`, `%P`는 custom merge driver placeholder이며 mergetool 변수가 아니다. merge driver는 `%A`를 비대화식으로 직접 덮어써야 하므로 Phase 1에서 지원하지 않는다. 특히 `%P`는 pathname label이지 output path가 아니다.

mergetool session은 `$MERGED`의 기존 내용을 초기 Result로 읽고 open fingerprint를 보관한다. Base/Ours/Theirs에서 새 결과를 재생성해 `$MERGED`를 덮어쓰지 않는다. Git 임시 source path는 recent session, active-session restore, recovery draft에 저장하지 않는다. 기본 Git marker label과 base 없는 marker를 parser가 인식해야 하며, 미해결 conflict를 강제 저장하는 동작은 mergetool mode에서 허용하지 않는다.

Phase 1 GUI는 Save & Close/Abort를 안정적인 exit code로 전달하지 않는다. mergetool 화면의 `Close Forktail`은 dirty Result의 discard 확인 뒤 실제 Tauri 창과 프로세스를 닫아 Git의 wait를 끝내지만, 저장 성공을 exit code로 주장하지 않는다. Git 설정은 `trustExitCode = false`와 tool-specific `hideResolved = false`를 사용한다. Git은 target timestamp와 사용자 확인 흐름으로 성공 여부를 판단하므로 packaged app이 닫힐 때까지 Git 호출이 기다리는지 세 OS에서 검증해야 한다. Forktail 프로세스가 실행 중일 때는 index를 바꾸지 않지만, 프로세스 종료 뒤 사용자가 성공을 확인하면 `git mergetool` wrapper가 해당 path를 stage할 수 있다. 저장은 일반 safe save의 precondition/backup/atomic replace를 재사용하며, Git이 만드는 `.orig`와 Forktail의 `.bak.*`가 함께 남을 수 있음을 안내한다.

repository-aware branch/commit/index 비교는 이 adapter와 별개인 Phase 1 이후 후보이며 `docs/17_GIT_INTEGRATION.md`를 따른다.

Git config setup UI는 narrow Rust command의 authoritative runtime DTO에서 compile-target OS와 packaged
process의 absolute executable path를 함께 받는다. macOS/Windows는 `current_exe`, Linux AppImage는 임시
mount 내부 executable 대신 `APPIMAGE` artifact path를 우선한다. 감지 성공 시 OS 선택과 path 입력을
숨기고 읽기 전용 요약과 복사 동작만 제공한다. dev build나 감지 실패에서는 hard-coded active path를
만들지 않고 path 입력 fallback을 제공하며, OS 선택은 사용자가 명시적으로 연 advanced override에만
둔다. 생성기는 snippet을 표시·복사할 뿐 `.gitconfig`를 쓰거나 default Git tool을 바꾸지 않는다.

## 8. 저장 내구성

목표 흐름:

```text
external modification check
  → optional backup
  → temp file in target directory
  → write all bytes
  → flush
  → fsync file
  → preserve permissions where possible
  → atomic replace target
  → fsync parent directory where supported
```

원자적 교체 뒤 parent directory fsync가 실패하면 성공으로 숨기지 않고 `WRITE_FAILED`로 보고한다.
이 시점에는 새 bytes가 이미 target에 있으므로 자동 rollback으로 새 데이터를 버리지 않는다. 기존 target은
교체 전에 만든 backup으로 보존하고, UI는 파일을 다시 열어 저장 상태를 확인한 뒤 재시도하도록 안내한다.

### 백업 retention과 복원

저장 대상이 이미 존재하고 `createBackup`이 켜져 있으면 같은 폴더에 `<파일명>.bak.<epoch_ms>` 형식의 백업을 만든다. 같은 millisecond 충돌은 뒤에 숫자 suffix를 붙이며, 기존 legacy `.bak`/`.bak.N` 파일도 목록에는 포함한다. 저장이 성공하면 같은 대상의 백업은 최신 10개만 유지한다.

`SAV-002`/`SAV-006`의 backup source도 일반 파일 read와 같은 no-follow handle에 결속한다. 64 MiB + 1 byte
bounded read를 두 번 수행해 pre/post metadata, handle/path identity, BLAKE3와 exact raw bytes가 모두 같은
stable snapshot만 백업으로 확정한다. 따라서 source가 읽는 중 성장·축소되거나 같은 size/mtime으로
재작성·교체되면 `FILE_CHANGED` 또는 `TOO_LARGE`로 저장을 중단하며 unbounded copy를 수행하지 않는다.

새 backup은 atomic replace 전 확정하되 이번 저장에만 결속된 rollback guard가 identity를 보관한다.
최종 precondition 또는 replace가 실패하면 동일 identity인 새 backup만 제거하고 기존 backup history와
retention은 변경하지 않는다. replace가 성공한 뒤에만 새 backup을 보존하며 전체 저장 성공 경로에서만
최신 10개 retention을 적용한다. 단, replace 뒤 parent directory fsync 실패는 이미 target bytes가 바뀐
상태이므로 위 내구성 계약대로 pre-save backup을 보존하고 retention 삭제는 수행하지 않는다.

복원은 `restore_text_file_backup(path, backupPath, precondition)` command를 사용한다. `backupPath`는 같은 폴더의 해당 대상 백업 이름이어야 하며, 복원도 임시 파일 쓰기/flush/fsync/atomic replace 경로를 사용한다. 복원 전 현재 대상 파일도 새 백업으로 남겨서 복원을 되돌릴 수 있게 한다.
목록과 복원은 symlink를 따라가지 않고 일반 파일만 허용한다. 복원 source는 metadata와 열린 handle에서
64 MiB 상한을 먼저 확인하고, 상한보다 1 byte까지만 읽은 뒤 current path를 다시 no-follow open해
identity/hash/raw bytes를 재검증한다. 안정된 snapshot을 만들 수 없으면 target이나 backup history를
변경하지 않는다.

## 9. 보안 경계

- WebView는 원격 URL을 로드하지 않는다.
- Rust command는 사용자가 dialog/CLI로 선택한 경로만 받는다.
- 광범위한 FS plugin 권한을 주지 않는다.
- 파일 텍스트는 `innerHTML`로 표시하지 않는다.
- symlink follow는 opt-in이다.
- updater와 네트워크는 Phase 1 core에서 비활성이다.

## 10. 상태 관리

초기에는 React local state로 충분하다. 다음 중 둘 이상이 발생할 때만 dedicated store를 도입한다.

- 여러 창이 같은 세션을 공유
- undo history가 화면 간 공유
- 비동기 scan job이 다수 동시 실행
- 설정/최근 세션이 5개 이상 화면에서 갱신

라이브러리를 먼저 추가하고 문제를 나중에 찾지 않는다.
