# forktail

Beyond Compare에서 자주 쓰는 핵심 흐름을 무료·로컬 우선 데스크톱 앱으로 다시 만드는 **Phase 1 스타터 저장소**입니다.

> 제품명과 번들 식별자는 `forktail` 기준으로 관리합니다.

## 목표

1. 두 텍스트 파일을 빠르게 비교한다.
2. 두 폴더를 재귀적으로 비교하고 변경 파일을 연다.
3. Base / Ours / Theirs를 3-way 병합하고 충돌을 사람이 해결한다.
4. 저장은 백업과 원자적 교체를 기본으로 한다.
5. AI, 계정, 서버, 텔레메트리 없이 로컬에서 동작한다.
6. Phase 1 입력은 텍스트 파일로 제한하고 비텍스트 파일은 안전하게 거절한다.

## 현재 들어 있는 것

- Tauri 2 + React + TypeScript + Monaco 기반 앱 골격
- 브라우저에서도 볼 수 있는 2-way / 3-way 데모
- Monaco 편집기 lazy loading으로 가벼운 시작 화면 유지
- Rust 파일 읽기·인코딩 감지·바이너리 판별
- 텍스트 파일 64 MiB 안전 한도와 대용량 전략 ADR
- Rust 폴더 스캔 및 메타데이터/빠른 해시/전체 해시 비교
- `diffy` 기반 3-way merge와 diff3 충돌 마커
- 결과 편집, OURS/THEIRS/BASE/BOTH 충돌 해결
- 30-conflict 병합 parser benchmark fixture와 반복 파싱 회귀 테스트
- 2-way 좌/우 편집 대상 선택, 저장 상태 표시, plain text diff report, 양방향 hunk 적용/undo
- UTF-8이 아닌 입력이나 디코딩 손실 입력을 현재 UTF-8 저장 경로로 저장할 때의 경고
- 폴더 필터/정렬/옵션, 진행률·취소 UI, expand/collapse, 가상 스크롤 기반 목록, copy/sync dry-run 요약
- 폴더 대소문자/Unicode 정규화 경로 충돌 경고
- CLI 시작 인자 parser와 Tauri startup command scaffold: `forktail left right`, `--folders`, `--merge`, `--difftool`, `--mergetool`
- Git difftool 입력의 read-only 비교와 mergetool `$MERGED`-only safe-save adapter
- 시작 화면의 copy-only Git difftool/mergetool config generator
- 최근 세션, 마지막 화면 자동 복원, 테마 설정, 경로 복사 fallback, native reveal scaffold, 외부 변경 감지 배너
- 3-way 병합 결과 draft opt-in 복구
- 공통 command registry 기반 키보드 단축키, 접근성 shortcut 속성, native menu scaffold
- `forktail` productName/bundle id/window title/icon 회귀 테스트
- Tauri desktop icon source와 PNG/ICO/ICNS generated assets
- 상태 chip/count/warning 색상 토큰 WCAG AA contrast 테스트와 공통 focus-visible 회귀 테스트
- 안정된 `{ code, message }` command 오류 계약과 TS/Rust 계약 테스트
- marker flood, 제어문자 diff report, malformed drop URI 등 악성 입력 회귀 테스트
- release/dev CSP 분리와 local worker/Tauri IPC 중심 보안 설정
- main window 전용 dialog 권한만 허용하는 최소 Tauri capability
- 런타임 네트워크/telemetry/updater/AI dependency와 API 호출 금지 회귀 테스트
- 런타임 임의 logging/crash-reporting dependency와 ad hoc log 호출 금지 회귀 테스트
- 직접 JS dependency license allowlist와 lockfile 재현성 회귀 테스트
- PR 검증 workflow가 artifact/release 없이 frontend/Rust gate만 실행하는지 확인하는 CI 정책 회귀 테스트
- `npm run doctor`로 Node/npm/Rust/rustfmt/clippy/Tauri CLI 실행 준비 상태 점검
- 임시 파일 + 디스크 동기화 + `.bak` 백업 저장
- TypeScript 단위 테스트와 GitHub Actions CI 골격
- AI 코딩용 `AGENTS.md`, PRD, 아키텍처, 백로그, 프롬프트 팩

## 아직 완성되지 않은 것

- 실제 Tauri WebView 파일 Drag & Drop smoke: 경로 추출/개수 검증 코드는 있음
- 실제 OS native menu smoke: Rust menu scaffold와 프런트엔드 event bridge는 있음
- 실제 OS 파일 관리자 reveal smoke: Rust command와 UI 버튼은 있음
- 실제 packaged binary CLI open smoke: startup command와 parser 테스트는 있음
- 실제 bundle icon/metadata smoke
- OS별 설치 프로그램 검증·코드 서명
- 접근성·키보드 단축키 최종 수동 smoke

정확한 순서는 `docs/03_MILESTONES.md`와 `docs/04_BACKLOG.md`에 있습니다. 현재 검증 범위는 `VALIDATION.md`에 기록했습니다.

## 개발 시작

### 공통

- Node.js 22 이상
- Rust stable (`rustup` 권장)
- Git

### Linux 추가 패키지

Tauri 2 개발에 WebKitGTK 4.1과 시스템 라이브러리가 필요합니다. Debian/Ubuntu 예시는 다음과 같습니다.

```bash
sudo apt update
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

### 실행

```bash
npm ci
npm run doctor
npm run tauri dev
```

브라우저 UI만 확인하려면:

```bash
npm run dev
```

브라우저에서는 로컬 파일 접근 대신 시작 화면의 데모 버튼을 사용합니다.

### Git external tool 수동 설정

시작 화면의 **Git tool setup**은 packaged runtime에서 현재 executable의 absolute path를 감지하고 difftool/mergetool snippet을 각각 복사할 수 있게 합니다. 감지에 실패하거나 다른 artifact를 설정할 때는 실제 설치 위치를 직접 입력합니다. 형태 예시는 다음과 같습니다.

```text
Windows  C:\Users\<사용자>\AppData\Local\forktail\forktail.exe
macOS    /Applications/forktail.app/Contents/MacOS/forktail
Linux    /home/<사용자>/Applications/forktail.AppImage
```

생성기는 `.gitconfig`를 수정하지 않고 `diff.tool`/`merge.tool` 기본값도 바꾸지 않습니다. 필요한 snippet만 사용자가 직접 Git config에 붙여 넣고 다음처럼 명시적으로 실행합니다.

```bash
git difftool --tool=forktail --no-prompt
git mergetool --tool=forktail
```

difftool은 `$LOCAL`/`$REMOTE`를 read-only로 열며 added/deleted file의 `/dev/null` side를 missing으로 표시합니다. mergetool은 `$BASE`/`$LOCAL`/`$REMOTE`/`$MERGED`를 받고 `$MERGED`만 저장합니다. 생성된 mergetool 설정은 `trustExitCode = false`, `hideResolved = false`를 유지합니다. 현재 GUI 종료 code는 저장 성공 여부를 신뢰성 있게 전달하지 않으므로 Git의 후속 확인 흐름을 사용해야 합니다. Git backup 설정에 따라 Git의 `.orig`와 Forktail safe-save의 `.bak.<timestamp>`가 함께 남을 수 있습니다. `%O/%A/%B/%P` custom merge driver 설정은 지원하지 않습니다.

macOS 앱 번들을 만들려면:

```bash
npm run tauri build
open src-tauri/target/release/bundle/macos/forktail.app
```

### GitHub 릴리스 빌드

릴리스 workflow는 `vX.Y.Z` 태그 또는 수동 실행으로만 동작한다. 실행 전에 `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`의 버전이 태그와 일치해야 한다.

```bash
npm run release:validate -- v0.1.0
git tag v0.1.0
git push origin v0.1.0
```

GitHub Actions는 frontend/Rust 검증과 SBOM/NOTICE 생성을 먼저 실행한 뒤 macOS `.dmg`, Windows NSIS `.exe`, Linux `.AppImage` 산출물을 각 OS별로 빌드해 `checksums.txt`와 함께 unsigned draft prerelease에 첨부한다. 산출물은 Developer ID 서명이나 notarization을 거치지 않았으므로, macOS는 Gatekeeper, Windows는 SmartScreen 경고가 표시된다. 코드 서명, notarization, 세 OS clean smoke가 끝나기 전에는 stable release로 승격하지 않는다. 서명 상태와 공개 배포 시 필요한 추가 단계는 `docs/RELEASE_SIGNING_POLICY.md`를, M5 beta 배포 종료 조건은 `docs/BETA_CHECKLIST.md`를 참고한다.

## 검증 명령

```bash
npm run typecheck
npm test
npm run build

cd src-tauri
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
```

한 번에 실행할 프런트엔드 검증:

```bash
npm run check
```

데스크톱 실행 준비 상태만 확인하려면:

```bash
npm run doctor
```

## 문서 읽는 순서

1. `AGENTS.md` — AI 에이전트가 반드시 지킬 규칙
2. `docs/00_START_HERE.md` — 제품과 개발 전략 요약
3. `docs/01_PRD.md` — 1차 제품 요구사항
4. `docs/02_ARCHITECTURE.md` — 레이어와 데이터 계약
5. `docs/03_MILESTONES.md` — 구현 순서
6. `docs/04_BACKLOG.md` — 바로 이슈로 만들 수 있는 작업
7. `docs/05_AI_CODING_PLAYBOOK.md` — AI와 개발하는 운영 방식
8. `docs/06_PROMPT_PACK.md` — 복사해서 쓸 프롬프트
9. `docs/07_TEST_PLAN.md` — 테스트 매트릭스
10. `docs/08_UX_SPEC.md` — UI·단축키 명세
11. `docs/09_RELEASE_SECURITY.md` — 저장 안전성·배포·서명
12. `docs/10_ADR.md` — 기술 결정 기록
13. `docs/11_AI_PHASE2.md` — 2차 AI 기능의 경계
14. `docs/12_DEFINITION_OF_DONE.md` — 완료 기준
15. `docs/13_FIRST_SPRINT.md` — 첫 sprint 실행 순서
16. `docs/14_PRODUCT_GAP_ROADMAP.md` — 실사용 제품 갭과 추가 기능 후보
17. `docs/15_COMMERCIAL_COMPETITIVE_ROADMAP.md` — 상용 도구 대비 우선순위와 장기 제품 전략
18. `docs/16_R2_UPDATER_RUNBOOK.md` — Phase 1 이후 opt-in updater 실행 계약
19. `docs/17_GIT_INTEGRATION.md` — Phase 1 이후 read-only Git integration 제안
20. `docs/18_GIT_BACKLOG.md` — Git 후보 이슈와 의존 순서
21. `docs/19_GIT_PROMPT_PACK.md` — Git 이슈별 AI 구현 프롬프트
22. `docs/20_GIT_TEST_PLAN.md` — Git parser·service·실제 repository 검증 계획
23. `docs/21_GIT_REFERENCES.md` — Git 공식 문서와 안전 계약 근거

기능을 새로 설계할 때는 `.specify/memory/constitution.md`의 품질 gate를 적용하고,
`specs/<NNN-feature>/`에 `spec.md` → `plan.md` → `tasks.md` 순서로 Spec Kit 산출물을 만든다.
기존 `docs/`는 제품과 아키텍처의 정본이며, `specs/`는 선택한 기능의 실행 가능한 범위와
추적성을 제공한다.

현재 첫 Spec Kit 산출물은 `specs/001-git-snapshot-integration/`이며, repository-aware Git의
전체 사용자 시나리오, 단계별 delivery, 데이터/command 계약, 후속 후보를 연결한다.

## 디렉터리 구조

```text
src/                       React UI
  components/              화면 컴포넌트
  core/                    런타임 브리지, 모델, 충돌 파서
src-tauri/                 Rust 네이티브 백엔드
  src/commands/            파일·폴더·병합 명령
  src/domain/              직렬화 데이터 모델
fixtures/                  회귀 테스트용 샘플
docs/                      제품·개발·테스트 문서
.github/                   CI와 이슈/PR 템플릿
.specify/                  Spec Kit 원칙, 템플릿, 워크플로
specs/                     기능별 spec, plan, contract, task 산출물
```

## 핵심 원칙

- Phase 1에서는 AI 기능을 넣지 않는다.
- 프런트엔드는 임의 파일 시스템 API를 직접 사용하지 않는다.
- 모든 파괴적 쓰기 전에 백업 또는 명시적 사용자 확인이 있어야 한다.
- 텍스트 내용은 HTML로 렌더링하지 않고 Monaco 모델 안에서만 표시한다.
- 한 이슈는 한 기능 또는 한 결함만 다룬다.
- 테스트가 없는 병합·저장 변경은 완료가 아니다.

## 라이선스

프로젝트 코드는 MIT입니다. 주요 의존성도 MIT 또는 Apache-2.0 계열이지만 공개 배포 전 전체 의존성 고지 파일을 생성해야 합니다.
