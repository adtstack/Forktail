# AGENTS.md

이 파일은 Codex, Claude Code, Cursor, Copilot Agent 등 저장소를 수정하는 모든 AI 에이전트의 최상위 작업 규칙이다.

## 1. 프로젝트 임무

forktail은 로컬 텍스트 파일·폴더의 2-way 비교와 3-way 병합을 제공하는 크로스플랫폼 데스크톱 앱이다. Phase 1의 성공 기준은 "똑똑함"이 아니라 **예측 가능성, 데이터 안전성, 빠른 검토 경험**이다.

## 2. 작업 시작 전에 반드시 읽을 문서

작업 범위에 따라 최소한 다음을 읽는다.

1. `docs/01_PRD.md`
2. `docs/02_ARCHITECTURE.md`
3. `docs/04_BACKLOG.md`에서 해당 이슈
4. `docs/07_TEST_PLAN.md`
5. 저장·권한·배포 관련 작업이면 `docs/09_RELEASE_SECURITY.md`

읽지 않은 요구사항을 추측해서 구현하지 않는다.

## 3. 절대 규칙

- Phase 1에 LLM 호출, API 키, 프롬프트, 네트워크 업로드를 추가하지 않는다.
- 사용자 파일 내용을 로그, 오류 보고, 분석 이벤트로 보내지 않는다.
- 프런트엔드에서 Node.js `fs` 또는 광범위한 Tauri FS 권한을 사용하지 않는다. 파일 I/O는 좁은 Rust command로 수행한다.
- 기존 파일을 직접 truncate한 뒤 쓰지 않는다. 임시 파일, flush/sync, 교체, 백업 흐름을 유지한다.
- 심볼릭 링크를 기본으로 따라가지 않는다.
- 바이너리 파일을 텍스트로 억지 디코딩하지 않는다.
- UI 문자열과 직렬화 필드 이름을 임의로 바꾸지 않는다. 변경 시 TS/Rust 양쪽 계약 테스트를 함께 수정한다.
- 큰 리팩터링과 기능 추가를 한 PR에 섞지 않는다.
- 테스트 실패를 삭제·skip·완화해서 통과시키지 않는다.
- 경고를 무시하기 위해 `any`, `unwrap`, 광범위한 allow lint를 추가하지 않는다.

## 4. 작업 단위

한 작업은 다음을 모두 포함해야 한다.

- 명확한 이슈 ID
- 변경할 파일 목록
- 수용 기준
- 실패/경계 조건
- 필요한 테스트
- 검증 명령

권장 브랜치 이름:

```text
feat/TXT-002-diff-navigation
fix/SAV-003-windows-atomic-replace
chore/FND-005-native-menu
```

## 5. 구현 순서

1. 현재 동작과 관련 테스트를 확인한다.
2. 수용 기준을 테스트로 표현한다.
3. 가장 작은 변경으로 테스트를 통과시킨다.
4. 오류 경로, 취소, 대용량 입력을 확인한다.
5. 문서 또는 ADR이 달라졌다면 같은 PR에서 갱신한다.
6. 전체 검증을 실행한다.
7. 변경 요약, 위험, 검증 결과를 남긴다.

## 6. 아키텍처 경계

### React/TypeScript

담당:

- 화면 상태와 사용자 상호작용
- Monaco 모델·decorations·탐색
- 충돌 블록 선택과 사용자 결정
- Rust command 호출 및 오류 표현

금지:

- 임의 경로 파일 읽기/쓰기
- 해시 계산과 대규모 디렉터리 순회
- 운영체제별 파일 교체 로직

### Rust/Tauri

담당:

- 파일 읽기, 인코딩 판별, 바이너리 감지
- 폴더 순회, 해시, 파일 메타데이터
- 3-way merge 엔진
- 안전한 저장, 백업, 경로 검증
- 장시간 작업의 진행률·취소

### 순수 코어

가능한 로직은 Tauri와 분리된 순수 함수로 둔다.

- 충돌 마커 파싱
- 상태 분류
- 필터링
- 경로 정규화
- diff/merge 결과 변환

## 7. 오류 처리

Rust command 오류는 `{ code, message }` 형태로 직렬화한다. UI는 내부 디버그 문자열 대신 사용자 행동이 가능한 메시지를 보여준다.

좋은 예:

```text
파일이 다른 프로그램에서 사용 중입니다. 닫은 뒤 다시 저장하세요.
```

나쁜 예:

```text
Os { code: 32, kind: Uncategorized, message: ... }
```

원인은 개발 로그에 구조화해서 남길 수 있으나 파일 내용은 기록하지 않는다.

## 8. 테스트 규칙

프런트엔드 변경:

```bash
npm run typecheck
npm test
npm run build
```

Rust 변경:

```bash
cd src-tauri
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
```

파일 저장, 폴더 비교, 3-way merge 변경은 fixture 또는 임시 디렉터리 기반 테스트가 필수다.

## 9. 완료 응답 형식

에이전트는 작업 완료 시 다음만 보고한다.

```text
구현
- ...

검증
- npm test: 통과
- cargo test: 통과

주의/후속
- ...
```

실행하지 않은 검증을 통과했다고 쓰지 않는다.

## 10. 범위 밖 요청 처리

사용자가 Phase 1 중 AI 병합을 요청하면 코드를 추가하지 말고 `docs/11_AI_PHASE2.md`의 extension point에 이슈만 기록한다. FTP/SFTP, 클라우드 동기화, 아카이브 내부 비교도 같은 원칙을 적용한다.
