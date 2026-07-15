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
- editor 본체와 기본 worker는 lazy chunk로 유지하고, 언어 tokenizer와 language service worker는 감지된 언어가 필요할 때 동적으로 로드해야 한다.
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

## ADR-009: 직접 설치본의 updater feed는 Cloudflare R2 static manifest를 사용

**상태:** Accepted, implementation pending (`REL-008`)

### Context

forktail 저장소는 비공개다. 설치 앱은 사용자 GitHub token 없이 업데이트 artifact를 받아야 하므로 private GitHub Release asset을 updater endpoint로 사용할 수 없다. 동시에 Phase 1의 local-first/privacy 원칙 때문에 동적 update server, 계정, telemetry를 추가하지 않는 것이 바람직하다.

### Decision

직접 설치한 Windows/macOS/Linux 앱의 updater artifact와 static manifest는 Cloudflare R2의 전용 공개 버킷 및 `updates.<OWNED_DOMAIN>` custom HTTPS domain으로 게시한다. GitHub Actions는 protected production environment에서만 버전 고정 artifact를 먼저 업로드하고, 모든 검증 뒤 `stable/latest.json`을 마지막에 게시한다.

Tauri updater signature와 OS 코드서명은 별개로 모두 사용한다. 앱은 명시적 opt-in에서만 고정 static manifest를 조회하며, GitHub repository나 R2에 사용자 파일을 보내지 않는다.

### Consequences

- GitHub source와 write credential은 비공개로 유지하면서 installer/updater download만 공개할 수 있다.
- 별도 server/Worker 없이 시작할 수 있지만, R2 버킷·custom domain·cache policy·token rotation을 운영해야 한다.
- static manifest는 단계적 rollout과 안전한 automatic downgrade를 제공하지 않는다. 초기 beta는 수동 배포하고, rollback은 higher-version corrective release 또는 수동 installer를 사용한다.
- versioned artifact는 immutable이며, `stable/latest.json`만 가변 pointer다.
- 구체적 준비물, artifact layout, CI 순서, incident 대응, 검증은 `docs/16_R2_UPDATER_RUNBOOK.md`가 진실의 원천이다.

## ADR-010: Repository-aware Git은 Git CLI 2.45.0+의 fail-closed read-only runner를 사용

**상태:** Accepted (`GIT-000`)

### Context

Repository-aware 비교는 linked worktree, packed/reftable refs, partial clone, SHA-256 object처럼 Git이
소유한 저장 형식을 직접 다시 구현하지 않고 읽어야 한다. 동시에 조회가 lazy fetch, credential prompt,
optional index write, external diff/textconv/filter 실행 또는 repository mutation을 만들지 않아야 한다.
libgit2/JGit fallback이나 `.git` 직접 파싱은 별도 동작·패키징·보안 경계를 만들며, 자유 형식 argv를
frontend에 노출하면 allowlist를 우회할 수 있다.

Git 2.45.0은 필수 전역 안전 옵션인 `--no-lazy-fetch`를 문서화한 첫 릴리스다. Git 2.44 문서에는 이
옵션이 없으므로 forktail의 최소 지원 버전은 **2.45.0**으로 고정한다. `cat-file -Z`는 이 최소 버전에
포함되지만 초기 단건 blob reader의 필수 최적화는 아니며, batch reader를 활성화하기 전에 별도
capability probe를 통과해야 한다.

### Decision

- PATH에서 discovery했거나 사용자가 선택한 local Git executable을 absolute regular-file path로 확정하고
  Git CLI만 사용한다.
  libgit2/JGit/direct-`.git` fallback은 두지 않는다.
- 실행 시 semantic version이 2.45.0 이상인지 확인한 뒤, 필요한 전역 옵션을 실제 `git ... version`
  invocation으로 probe한다. version 또는 capability 중 하나라도 부족하면 `GIT_VERSION_UNSUPPORTED`로
  fail closed하며 약한 profile로 재시도하지 않는다.
- revision 검증, NUL framing, porcelain v2, object format, `cat-file -Z`처럼 subcommand별 기능은 해당
  service가 처음 필요로 할 때 성공/실패 exit status와 exact machine output으로 probe한다. help/stderr
  문구나 locale 문자열을 capability 판정에 사용하지 않는다.
- production runner는 typed read operation의 positive allowlist만 받는다. executable, subcommand,
  option, environment, raw path bytes 또는 argv를 frontend request로 받지 않는다. fixture mutation helper는
  production module/type에서 분리한다.
- child는 shell이나 Tauri shell plugin 없이 executable과 argv 배열로 실행한다. 환경을 clear한 뒤 검토된
  OS boot/temp/locale 값과 `GIT_TERMINAL_PROMPT=0`, `GIT_OPTIONAL_LOCKS=0`,
  `GIT_NO_LAZY_FETCH=1`, `GIT_LITERAL_PATHSPECS=1`, `GIT_PAGER=cat`만 재구성한다.
- 모든 조회에 `--no-pager --no-lazy-fetch --no-optional-locks --no-replace-objects
  --literal-pathspecs`를 적용한다. status는 fsmonitor를 끄고, diff는 external diff와 textconv를 끈다.
  blob은 raw object만 읽으며 filter/LFS/submodule helper를 실행하지 않는다.
- production allowlist에는 checkout/switch/restore/reset/clean/add/rm/mv/commit/merge/rebase/
  cherry-pick/revert/continue/stash/config/worktree/clone/fetch/pull/push/remote/submodule update 또는
  maintenance operation이 존재하지 않는다. conflict Result와 patch Save As는 Git runner 밖의 기존
  safe writer를 통한 명시적 사용자 쓰기만 허용한다.

### Consequences

- OS에 설치된 Git이 2.45.0보다 낮거나 vendor build가 required capability를 제공하지 않으면 기능을
  숨기지 않고 설치/업데이트가 필요한 행동 가능한 오류를 표시한다.
- Git 자체가 repository format 차이를 처리하고, 앱은 process/DTO/path identity 경계에 집중할 수 있다.
- 최소 버전을 올리거나 allowlist operation을 추가하려면 공식 문서 근거, 세 OS capability matrix,
  fake-runner no-network/no-mutation 회귀 테스트와 이 ADR 갱신이 필요하다.
