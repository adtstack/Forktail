<!--
Sync Impact Report
- Version change: template → 1.0.0
- Added principles:
  - I. 예측 가능성이 영리함보다 우선한다
  - II. 예고 없는 쓰기를 금지하고 원본을 보존한다
  - III. 로컬 우선과 개인정보 경계를 유지한다
  - IV. 좁은 네이티브 경계와 순수 코어를 지킨다
  - V. 테스트 우선의 이슈 단위로 전달한다
- Added sections:
  - 제품 및 기술 경계
  - Spec-Driven 개발 흐름과 품질 게이트
- Removed sections: 없음(초기 제정)
- Templates:
  - ✅ .specify/templates/plan-template.md
  - ✅ .specify/templates/spec-template.md
  - ✅ .specify/templates/tasks-template.md
  - ✅ .specify/templates/checklist-template.md (변경 불필요)
- Runtime guidance:
  - ✅ AGENTS.md (기존 규칙과 일치, 변경 불필요)
  - ✅ README.md
  - ✅ docs/00_START_HERE.md (기존 원칙과 일치, 변경 불필요)
- Follow-up TODOs: 없음
-->
# Forktail Constitution

## Core Principles

### I. 예측 가능성이 영리함보다 우선한다

모든 비교와 병합 결과는 같은 입력과 옵션에서 재현 가능해야 한다. 자동화는 사용자의
변경을 임의로 선택하거나 숨겨서는 안 되며, 불확실한 상태는 명시적인 충돌·missing·error로
표시해야 한다. 성능 최적화나 편의 기능은 결과의 정확성, 텍스트 충실도, 사용자 검토 가능성을
낮춰서는 안 된다.

### II. 예고 없는 쓰기를 금지하고 원본을 보존한다

조회와 비교는 파일, Git index, HEAD, refs, working tree를 변경해서는 안 된다. 쓰기는 사용자가
대상과 결과를 확인한 뒤 명시적으로 실행할 때만 허용한다. 기존 파일 저장은 외부 변경
precondition, 백업, 같은 디렉터리의 임시 파일, flush/sync, 원자적 교체 흐름을 반드시 재사용한다.
실패한 저장은 기존 대상을 보존해야 하며, symlink 추적과 repository 밖 경로 쓰기는 기본적으로
거절한다.

### III. 로컬 우선과 개인정보 경계를 유지한다

핵심 기능은 오프라인에서 동작해야 한다. 사용자 파일 내용, diff, merge result를 네트워크,
telemetry, 오류 보고, 기본 로그로 보내거나 영구 캐시에 저장해서는 안 된다. Phase 1에는 LLM,
API key, 사용자 콘텐츠 업로드를 추가하지 않는다. 후속 Git 조회도 자동 fetch, credential prompt,
LFS 다운로드, textconv/filter 실행 없이 로컬에 이미 있는 객체만 사용해야 한다.

### IV. 좁은 네이티브 경계와 순수 코어를 지킨다

React/TypeScript는 화면 상태, 접근 가능한 상호작용, Monaco 연결과 typed command 호출을 담당한다.
파일 I/O, 경로 검증, Git process, 해시, 병합, 안전 저장은 좁은 Rust command 뒤에 둔다.
프런트엔드는 Node.js `fs`, broad Tauri FS/shell permission, arbitrary Git argv를 사용할 수 없다.
파서, 상태 분류, 경로 정규화처럼 외부 I/O가 필요 없는 로직은 순수 함수로 두고 독립적으로
검증한다. 직렬화 필드나 UI 계약 변경은 TypeScript와 Rust 양쪽 계약을 함께 갱신한다.

### V. 테스트 우선의 이슈 단위로 전달한다

모든 작업은 단일 이슈 ID, 변경 파일, 수용 기준, 실패·경계 조건, 필요한 테스트, 검증 명령을
가져야 한다. 구현 전에 현재 동작을 확인하고 수용 기준을 실패하는 테스트로 표현한 뒤 가장 작은
변경으로 통과시킨다. 테스트를 삭제·skip·완화하거나 `any`, `unwrap`, broad allow lint로 경고를
숨겨서는 안 된다. 큰 리팩터링과 기능 추가를 같은 작업에 섞지 않으며, 문서·ADR·계약이 달라지면
같은 작업에서 갱신한다.

## 제품 및 기술 경계

- 편집기에서 여는 내용은 안전하게 판별된 텍스트로 제한한다. binary, symlink, submodule,
  LFS pointer를 일반 텍스트로 위장하지 않는다.
- 인코딩, BOM, 줄바꿈, 마지막 개행, decode 손실 상태를 보존하거나 사용자에게 명확히 알린다.
- Rust command 오류는 안정된 `{ code, message }` 형태로 직렬화하고, 사용자가 취할 수 있는 행동을
  안내한다. raw stderr와 파일 내용은 사용자 메시지에 포함하지 않는다.
- 100ms 이상 UI를 막을 수 있는 작업은 취소 가능하고 stale result를 무시하는 비동기 경로를
  사용한다. 대규모 입력 때문에 안전 한도나 정확성 검사를 완화하지 않는다.
- AI 병합, 원격 파일 시스템, 클라우드 동기화, archive 내부 비교, 전체 Git 클라이언트 기능은
  승인된 후속 PRD/ADR 없이 현재 스펙에 편입하지 않는다.
- repository-aware Git 기능은 기본적으로 read-only다. conflict Result 한 파일의 명시적 저장 외에
  checkout, switch, fetch, pull, push, add, commit, merge, rebase, continue를 실행하지 않는다.

## Spec-Driven 개발 흐름과 품질 게이트

1. 작업 전에 `AGENTS.md`, `docs/01_PRD.md`, `docs/02_ARCHITECTURE.md`, 관련 backlog,
   `docs/07_TEST_PLAN.md`를 읽고, 저장·권한·배포 작업이면 `docs/09_RELEASE_SECURITY.md`도 읽는다.
2. `spec.md`는 사용자 가치, 독립적으로 검증 가능한 시나리오, 명시적 범위 밖, 안전·개인정보
   요구사항, 측정 가능한 성공 기준을 담는다.
3. `plan.md`는 아키텍처 경계, 기존 로직 재사용, 데이터 계약, 실패 경로, 성능·취소 전략과
   constitution gate 통과 여부를 기록한다. 위반은 구현 전에 해소하거나 승인된 ADR로 설명한다.
4. `tasks.md`는 한 PR로 수행 가능한 기존 backlog ID에 매핑하고, 각 user story에서 테스트를
   구현보다 먼저 배치한다. 작업마다 정확한 파일 경로와 검증 명령을 명시한다.
5. 프런트엔드 변경은 `npm run typecheck`, `npm test`, `npm run build`를 실행한다. Rust 변경은
   `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test`를 실행한다.
6. 파일 저장, 폴더 비교, 3-way merge, Git repository 상태를 다루는 변경은 fixture 또는 임시
   디렉터리 기반 integration test와 정상·경계·실패 경로를 포함한다.
7. 실행하지 않은 검증은 통과로 기록하지 않는다. 지원 OS의 수동·packaged 검증이 남으면
   릴리스 증거에 명시한다.

## Governance

이 constitution은 Spec Kit으로 생성되는 `spec.md`, `plan.md`, `tasks.md`의 필수 gate다.
`AGENTS.md`와 `docs/00_START_HERE.md`~`docs/21_GIT_REFERENCES.md`는 상세 제품·운영 계약의
근거이며, 상충이 발견되면 구현을 중단하고 관련 문서와 constitution을 같은 결정으로 정렬한다.

개정은 변경 이유, 영향받는 원칙·템플릿·스펙, 필요한 migration을 기록해야 한다. 버전은
원칙 제거·재정의처럼 호환되지 않는 변경은 MAJOR, 새 원칙이나 필수 gate 추가는 MINOR,
의미를 바꾸지 않는 명확화는 PATCH로 올린다. 모든 plan과 PR review는 constitution 준수 여부를
확인하며, 예외는 관련 ADR과 명시적인 제품 승인 없이는 허용하지 않는다.

**Version**: 1.0.0 | **Ratified**: 2026-07-15 | **Last Amended**: 2026-07-15
