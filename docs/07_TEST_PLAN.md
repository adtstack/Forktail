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
- dirty/unsaved guard
- keyboard shortcuts
- folder filters

Monaco 자체를 다시 테스트하지 말고 앱이 Monaco API를 올바르게 호출하는지 확인한다.

### E2E smoke

Tauri 실제 창에서 다음 핵심 여정만 자동화한다.

1. 두 파일 열기 → 다음 차이
2. 폴더 열기 → changed 파일 열기
3. 세 파일 열기 → 충돌 해결 → Save As
4. 저장 실패 시 원본 보존

### 수동 플랫폼 테스트

OS 통합, installer, file dialog, native menu, code signing, 외부 editor와 file locking은 실제 OS에서 확인한다.

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

모든 경우 테스트는 다음을 확인한다.

- 기존 target 내용이 원래와 같다.
- 성공하지 않은 결과를 완료로 보고하지 않는다.
- temp/backup 잔여 파일 정책이 문서와 일치한다.
- 재시도 가능하다.

추가 백업 정책 테스트:

- timestamp 백업 이름이 기존 백업을 덮어쓰지 않는다.
- 같은 대상의 백업 목록은 최신순이며 관련 없는 파일을 포함하지 않는다.
- 저장 후 retention count를 초과한 오래된 백업이 제거된다.
- 백업 복원은 현재 target을 다시 백업하고 unrelated backup path를 거절한다.

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
- Tauri E2E
- three-platform build

Release:

- three-platform installer build
- clean VM smoke
- checksum/SBOM
- manual save failure test

## 10. 수동 smoke checklist

각 OS에서:

- [ ] 파일 dialog에서 Unicode 경로 열기
- [ ] network drive/removable drive 취소·분리 처리
- [ ] readonly file 저장 오류
- [ ] 다른 앱이 잠근 파일 저장
- [ ] 화면 확대 200%
- [ ] keyboard-only 2-way/3-way
- [ ] dark/light/system theme
- [ ] app close 중 dirty prompt
- [ ] installer upgrade/uninstall
