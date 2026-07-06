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
  → metadata/size 확인
  → BOM 확인
  → binary probe
  → decode
  → EOL/final newline 계산
  → FileDocument 반환
  → Monaco model 생성
```

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
4. 3-way 병합 결과의 `original` 기준은 OURS 파일의 줄끝 메타데이터다.

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

### 성능 확장 경로

현재 스타터는 단일 command 응답이다. `FOL-006`에서 다음 구조로 바꾼다.

```text
start_scan() -> job_id
  Rust worker pool
  emits scan-progress(job_id, visited, total?, entry batch)
cancel_scan(job_id)
finish event -> stats
```

UI는 batch를 누적하고 가상화한다.

현재 구현은 `scan_directories(..., jobId)`와 `cancel_folder_scan(jobId)`로 job id 기반 취소와 stale result 무시를 제공한다. Rust 스캐너와 hash 루프는 취소 registry를 주기적으로 확인하고 `CANCELLED` 오류로 중단한다. 대량 batch event와 progressive row append는 `FOL-007` 가상화와 함께 확장한다.

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

### Git mergetool 계약

`forktail --mergetool %O %A %B %P`는 Git의 base/current/other/merged 순서를 앱의 Base/Ours/Theirs/Output으로 매핑한다.

- `%O` → BASE
- `%A` → OURS
- `%B` → THEIRS
- `%P` → output path

Phase 1 GUI는 프로세스 종료 시점과 사용자의 저장 여부를 안정적인 exit code로 전달하지 않는다. Git 설정은 `trustExitCode = false`를 사용하며, Git이 output path의 내용 변경 여부를 기준으로 후속 확인을 수행하게 한다. 저장 자체는 일반 safe save 경로와 같은 precondition/backup/atomic replace 정책을 따른다.

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

### 백업 retention과 복원

저장 대상이 이미 존재하고 `createBackup`이 켜져 있으면 같은 폴더에 `<파일명>.bak.<epoch_ms>` 형식의 백업을 만든다. 같은 millisecond 충돌은 뒤에 숫자 suffix를 붙이며, 기존 legacy `.bak`/`.bak.N` 파일도 목록에는 포함한다. 저장이 성공하면 같은 대상의 백업은 최신 10개만 유지한다.

복원은 `restore_text_file_backup(path, backupPath, precondition)` command를 사용한다. `backupPath`는 같은 폴더의 해당 대상 백업 이름이어야 하며, 복원도 임시 파일 쓰기/flush/fsync/atomic replace 경로를 사용한다. 복원 전 현재 대상 파일도 새 백업으로 남겨서 복원을 되돌릴 수 있게 한다.

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
