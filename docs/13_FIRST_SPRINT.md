# 13. First Sprint Runbook

목표는 기능을 늘리는 것이 아니라 **세 운영체제에서 같은 기준선이 실행되는 상태**를 만드는 것이다.

## 0. 저장소 생성

```bash
git init
git add .
git commit -m "chore: bootstrap forktail phase 1"
```

GitHub/Gitea에서 비어 있는 저장소를 만든 뒤 기본 브랜치를 push한다. `main`은 직접 수정하지 않고 이슈별 브랜치를 사용한다.

## 1. FND-001 — 개발 빌드 검증

브랜치:

```bash
git switch -c chore/FND-001-cross-platform-dev-build
```

AI에는 `docs/06_PROMPT_PACK.md`의 **B. 한 이슈 계획**을 먼저 주고, 승인 가능한 계획이 나온 뒤 **C. 한 이슈 구현**을 준다.

각 OS에서 기록할 것:

- Node, npm, rustc, cargo 버전
- `npm run doctor`
- `npm ci`
- `npm run check`
- `npm run tauri dev`
- `cargo fmt --check`
- `cargo clippy --all-targets -- -D warnings`
- `cargo test`
- 필요한 시스템 패키지와 실제 오류 로그

완료 기준은 Windows/macOS/Linux에서 창이 열리고 demo session을 전환할 수 있는 것이다.

## 2. FND-002 — 오류 계약 고정

Rust의 모든 command가 다음 형태의 안정된 오류를 반환하도록 한다.

```ts
type AppError = {
  code: string;
  message: string;
};
```

최소 오류 코드:

```text
CANCELLED
NOT_FOUND
PERMISSION_DENIED
TOO_LARGE
BINARY_FILE
UNSUPPORTED_ENCODING
PATH_CONFLICT
FILE_CHANGED
WRITE_FAILED
SCAN_FAILED
MERGE_FAILED
```

TS와 Rust 양쪽에 직렬화 계약 테스트를 둔다.

## 3. FND-006 — PR gate

필수 check:

- frontend typecheck
- frontend unit tests
- frontend production build
- Rust format
- Rust clippy with warnings denied
- Rust tests

릴리스 artifact는 아직 만들지 않는다. PR 검증과 배포 workflow를 분리한다.

## 4. TXT-001 — 파일 열기 오류 UX

정상 파일보다 실패 케이스를 먼저 fixture로 만든다.

- 존재하지 않는 파일
- 읽기 권한 없음
- 64 MiB 초과
- NUL이 포함된 binary
- UTF-8 BOM
- UTF-16LE/BE
- 빈 파일
- 마지막 개행 없음

UI는 내부 OS 오류가 아니라 다음 행동을 제시한다.

## 5. TXT-002 — 변경 탐색

Monaco의 diff 결과가 갱신된 후 hunk 목록을 계산하고, F7/Shift+F7로 이동한다. 현재 hunk와 전체 hunk 수를 표시하고, diff 옵션 변경 시 stale index를 버린다.

## PR 운영 규칙

한 PR에는 backlog 한 행만 넣는다. AI에게는 항상 이슈 ID, 수용 기준, 검증 명령을 함께 준다. 리뷰는 작성 에이전트와 다른 모델 또는 새 세션에서 수행한다.

PR 본문 최소 형식:

```text
Issue
- FND-001

구현
- ...

검증
- command: result

수동 확인
- OS / scenario / result

위험 및 후속
- ...
```

## 첫 sprint 종료 판단

다음이 모두 참이면 다음 sprint로 넘어간다.

- 세 OS에서 개발 실행 기준선 확보
- 모든 command 오류 계약 고정
- PR gate가 main 병합을 차단
- 파일 열기 실패가 데이터 손상 없이 처리
- 변경 탐색이 키보드로 동작

기능 수가 아니라 이 다섯 조건을 기준으로 종료한다.
