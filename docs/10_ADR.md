# 10. Architecture Decision Records

## ADR-001: Tauri 2를 데스크톱 셸로 사용

**상태:** Accepted

### Context

앱은 로컬 파일 시스템 접근, 큰 폴더 순회, 안전한 저장, 세 운영체제 배포가 필요하다. UI는 고급 코드 editor/diff 경험을 빠르게 구현해야 한다.

### Decision

Tauri 2 + Rust backend + WebView frontend를 사용한다.

### Consequences

장점:

- Electron보다 일반적으로 작은 런타임 footprint를 기대할 수 있다.
- 파일/해시/저장을 Rust에 둘 수 있다.
- React/Monaco 생태계를 사용할 수 있다.
- capability로 frontend 권한을 좁힐 수 있다.

비용:

- Rust와 OS별 native build toolchain 필요
- Linux WebKitGTK dependency
- WebView 차이와 installer/signing 검증 필요

Electron fallback은 실제 WebView 호환성 문제가 제품을 막는다는 측정이 있을 때만 재검토한다.

## ADR-002: Monaco Editor를 diff/rendering UI로 사용

**상태:** Accepted

### Context

동기 스크롤, line/word diff, syntax highlighting, keyboard, large text rendering을 직접 만들면 프로젝트 핵심보다 editor infrastructure에 많은 시간이 든다.

### Decision

2-way DiffEditor와 일반 Result Editor에 Monaco를 사용한다. worker는 CDN이 아니라 앱 bundle에 포함한다.

### Consequences

- 초기 기능 구현이 빠르다.
- bundle과 TypeScript worker가 크다.
- 세 pane 3-way UI는 직접 조합해야 한다.
- bundle split/lazy language load가 필요하다.

## ADR-003: Phase 1 3-way merge는 diffy

**상태:** Accepted

### Context

저장소 없이 base/ours/theirs 문자열을 병합하고 diff3 conflict marker를 얻어야 한다. 외부 Git executable 의존성은 피한다.

### Decision

순수 Rust `diffy`의 three-way merge를 사용한다.

### Consequences

- 결정론적이고 로컬이며 테스트하기 쉽다.
- line-based merge의 한계가 있다.
- structured/semantic merge는 Phase 2 후보다.
- 장기적으로 benchmark를 통해 libgit2/xdiff와 비교할 수 있다.

## ADR-004: 폴더 비교 hash는 BLAKE3

**상태:** Accepted

### Decision

빠른 해시와 전체 해시에 BLAKE3를 사용한다. cryptographic authenticity가 아니라 빠른 content identity가 목적이다.

### Consequences

- 빠른 streaming hash
- metadata 모드보다 I/O 비용이 큼
- quick hash는 sampling이므로 충돌/미탐 가능성을 UI에 설명해야 함

## ADR-005: 광범위한 frontend FS 권한을 주지 않음

**상태:** Accepted

### Decision

dialog는 frontend plugin을 사용하되 실제 read/write/scan은 custom Rust command로만 수행한다.

### Consequences

- 권한과 검증 지점이 좁다.
- command/DTO 작성이 늘어난다.
- 장시간 작업에는 event/job API가 필요하다.

## ADR-006: Phase 1은 파일 내용을 DB에 저장하지 않음

**상태:** Accepted

### Decision

설정과 recent session에는 경로·옵션만 저장한다. crash recovery draft는 MRG-010에서 별도 opt-in 정책을 설계한다.

### Consequences

- 개인정보와 disk footprint가 작다.
- 앱 crash 시 미저장 merge result를 잃을 수 있다.
- recovery를 추가할 때 암호화/retention 정책이 필요하다.

## ADR-007: AI는 suggestion provider로만 추가

**상태:** Accepted for Phase 2

AI 결과는 deterministic merge result를 덮어쓰지 않는다. 사용자가 conflict 하나를 선택해 요청하고 diff preview를 검토한 뒤 적용한다. 자세한 계약은 `docs/11_AI_PHASE2.md`를 따른다.

## ADR-008: Phase 1 대용량 텍스트 전략은 64 MiB 안전 한도

**상태:** Accepted

### Context

Monaco는 큰 텍스트 렌더링을 직접 만드는 것보다 안전한 선택이지만, Phase 1의 핵심 목표는 대용량 파일을 무리하게 여는 것이 아니라 예측 가능한 비교·병합과 데이터 안전성이다. Streaming diff는 파일 I/O, diff engine, Monaco model, 탐색 상태를 모두 별도 설계해야 하며 저장·병합 안전성 작업과 섞이면 검증 범위가 커진다.

### Decision

Phase 1은 텍스트 파일을 최대 64 MiB까지만 메모리에 올린다. `read_text_file`은 metadata size를 먼저 확인하고, 한도를 넘으면 내용을 읽거나 디코딩하지 않고 `TOO_LARGE` 오류로 거절한다. Streaming diff는 Phase 1 범위에 넣지 않고, 실제 사용 사례와 성능 측정이 생긴 뒤 별도 ADR/이슈로 다시 설계한다.

### Consequences

- 대용량 입력이 WebView와 Rust heap을 예측 불가능하게 압박하지 않는다.
- 64 MiB 초과 파일은 diff가 아니라 명확한 오류 UX로 처리한다.
- 한도를 높이거나 streaming diff를 추가하려면 fixture, benchmark, cancellation, partial rendering, 저장/병합 경계를 함께 설계해야 한다.
