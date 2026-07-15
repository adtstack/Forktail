# 15. 상용 경쟁 로드맵

이 문서는 forktail을 Beyond Compare, Araxis Merge 같은 상용 diff/merge 도구의 일상 대용품으로 만들기 위한 **전략적 로드맵**이다. `docs/14_PRODUCT_GAP_ROADMAP.md`가 개별 이슈 후보를 카탈로그로 정리한다면, 이 문서는 **상용 앱 경쟁 관점에서 핵심 기능을 Tier로 분류하고 우선순위를 매긴다**. 두 문서는 서로를 보완한다.

## 1. 목적과 전제

### 목적

상용 도구 애용자가 forktail로 넘어오려면 다음을 만족해야 한다.

1. 기능이 많기 전에 **저장과 열기가 믿을 수 있어야** 한다.
2. 경쟁사에서 기본인 워크플로우가 forktail에도 **당연히 있어야** 한다.
3. 상용 애용자를 흔들 **차별 핵심**이 최소 하나는 있어야 한다.

이 문서는 이 세 가지를 동시에 추적하는 관점을 제공한다.

### 전제

- `docs/00_START_HERE.md`의 제품 원칙(Local-first, No surprise writes, Review before apply, Fast path first, Text fidelity, Scope discipline)을 유지한다.
- `docs/11_AI_PHASE2.md`의 경계를 존중한다. AI는 결정론적 병합 엔진을 대체하지 않는다.
- 네트워크 업로드, 계정, 원격 저장소 동기화, telemetry는 여전히 기본 범위 밖이다. 사용자 파일 내용을 로그·오류 보고·분석 이벤트로 보내지 않는다.
- 새 기능은 한 PR에서 독립적으로 검증할 수 있어야 한다(AGENTS.md §4).

### docs/14와의 관계

- `docs/14`는 "어떤 후보가 있는가"를 이슈 단위로 묘사한다.
- 이 문서는 "상용 앱과 겨루기 위해 어느 후보를 먼저, 왜 채울 것인가"를 Tier로 묶어서 제시한다.
- 이 문서가 새로 제안하는 이슈 ID는 `FOL-018` 하나뿐이며, 나머지는 `docs/14`의 기존 ID를 재사용한다.

## 2. 분석 방법: 세 그룹 분류

상용 앱을 "따라간다"가 "모든 기능을 다 넣는다"로 가면 forktail의 차별점(무료, 로컬 우선, 안전, 빠른 검토)이 흐려진다. 따라서 경쟁사 기능을 세 그룹으로 나눈다.

| 그룹 | 의미 | forktail 입장 |
|---|---|---|
| **A. 필수 핵심** | diff/merge 도구로서 "당연히 있어야" 느껴지는 기능 | 반드시 채운다 |
| **B. 차별 핵심** | 상용 앱이 유료로 파는 고급 기능 중 forktail이 무료+로컬로 승부할 수 있는 것 | 선택적으로 채운다 |
| **C. 의도적 제외** | local-first/보안 경계를 깨거나 dependency surface가 완전히 달라지는 것 | 장기 별도 PRD |

선택 기준은 다음 질문을 따른다(`docs/14` §1의 질문과 같은 맥락).

- 예측 가능성을 높이는가?
- 사용자 파일을 더 안전하게 지키는가?
- 검토 시간을 줄이는가?
- 로컬 우선 원칙을 깨지 않는가?
- 한 PR에 독립적으로 검증할 수 있는가?

## 3. 경쟁사 핵심 기능 매트릭스

Beyond Compare(Pro) · Araxis Merge(Pro) · WinMerge · Meld · KDiff3의 공통 핵심을 정리하고 forktail 현재 상태를 비교했다. 상용 애용자가 forktail을 처음 켰을 때 가장 먼저 느끼는 갭은 표의 **빈 칸**이다.

### A그룹: 필수 핵심 — "없으면 불편한 것"

| 기능 | BC | Araxis | WinMerge | Meld | KDiff3 | forktail |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| 2-way 텍스트 diff | O | O | O | O | O | O |
| 3-way merge | O | O | 약함 | O | 강함 | O(diffy) |
| 폴더 재귀 비교 | O | O | O | O | O | O |
| diff 탐색(다음/이전) | O | O | O | O | O | O(F7) |
| 안전한 저장/백업 | O | O | 부분 | X | X | O(강점) |
| 인코딩 자동 감지 | O | O | O | 부분 | 부분 | O |
| 폴더 → 파일 비교 드릴다운 | O | O | O | O | O | O |
| **멀티 세션/탭** | O 핵심 | O 핵심 | O | O | X | **X**(TXT-011) |
| **클립보드/임시 텍스트 비교** | O | O | O | 부분 | X | **X**(TXT-012) |
| **폴더 동기화 실제 적용** | O 핵심 | O 핵심 | O | 부분 | 부분 | **dry-run만**(FOL-015) |
| **리포트/패치 내보내기** | O | O | O | 부분 | 부분 | **plain만**(RPT-001/002) |
| **단축키 전체 커버** | O | O | O | O | O | 대부분 |

→ forktail의 diff/merge **엔진**은 이미 상용 수준이다. 안전 저장(atomic replace + versioned backup)은 오히려 Meld/KDiff3보다 앞선다. 빈 곳은 엔진이 아니라 **워크플로우를 감싸는 껍데기**(탭, 클립보드 비교, 폴더 동기화 적용, 리포트)에 집중되어 있다.

### B그룹: 차별 핵심 — "상용 앱이 유료로 파는 걸 무료로"

| 기능 | BC | Araxis | WinMerge | Meld | KDiff3 | forktail 기회 |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| 3-way **폴더** 비교/병합 | O Pro | O Pro | X | X | O | **현재 없음 — 최대 기회**(FOL-018 신규) |
| CSV/TSV 테이블 비교 | O | O | O | X | X | 로컬로 충분히 가능(FMT-002) |
| JSON/YAML canonical 비교 | 부분 | X | X | X | X | 오히려 forktail이 앞설 수 있음(FMT-001) |
| Manual alignment / sync point | O | O | 부분 | X | X | 반복 줄 많은 파일에서 강력(TXT-014) |
| Moved block 감지 | O | O | 부분 | X | X | 비결정적 힌트로 가능(TXT-015) |
| Regex ignore 규칙 | O | O | O | X | X | timestamp 무시 등(TXT-013) |
| Conflict marker 파일 직접 해결 | O | O | 부분 | X | X | Git 사용자 핵심 워크플로우(MRG-012) |
| Bulk conflict action | O | O | 부분 | X | X | MRG-013 |
| Conflict summary 사이드바 | O | O | 부분 | X | X | MRG-015 |
| Git mergetool/difftool 통합 | O | O | 부분 | 부분 | 부분 | INT-002, MRG-014 |
| Shell context menu | O | O | O | X | X | INT-001 |
| Command palette | O | 부분 | X | X | X | UX-007 |

→ 이 그룹이 "상용 앱을 쓰던 사람이 forktail로 넘어올 이유"가 된다. 특히 **3-way 폴더 비교**는 Beyond Compare Pro와 Araxis Pro만 가능하고 무료 도구 중엔 KDiff3뿐인데 UI가 구식이라, forktail이 깔끔한 UI로 가져가면 가장 큰 차별점이 된다.

### C그룹: 의도적 제외 — local-first/보안 경계를 깨는 것

상용 앱의 화려한 기능이지만 forktail 정체성과 충돌한다. `docs/14` §13이 "별도 PRD 후에만"으로 묶어둔 항목과 같다.

- 이미지 / Hex / 바이너리 비교
- Office / PDF 문서 비교
- ZIP / 7z / archive 내부 비교
- FTP / SFTP / WebDAV / 클라우드 원격 비교
- 데이터베이스 schema / data 비교
- 플러그인 시스템
- 자동 updater

이 영역은 "하고 싶다"가 아니라 **"정체성을 바꿀 것인가"**라는 제품 결정이 먼저 필요하다. 저장 안전성, 보안 경계, 배포 정책, dependency surface가 현재 아키텍처와 완전히 달라진다. 이 문서의 Tier 분류에는 포함하되, 각 항목을 실행에 옮기려면 별도 PRD/ADR이 선행해야 한다.

## 4. Tier 분류 로드맵

`docs/14` §3의 추천 순서와 경쟁사 분석을 합쳐, "상용 도구 대용으로 믿고 쓰려면"의 우선순위를 네 Tier로 나눈다.

```text
Tier 0 신뢰 ────────────────────────────────────────────
  RTM-001 → RTM-002 → SAV-007 → SAV-008 → ENC-001 → SEC-005

Tier 1 워크플로우 껍데기 ──────────────────────────────
  TXT-011 → TXT-012 → FOL-015 → RPT-001 → RPT-002 → MRG-012

Tier 2 차별 핵심 ──────────────────────────────────────
  FOL-018(신규) → FMT-002 → FMT-001
  TXT-013 → TXT-014 → TXT-015
  MRG-013 → MRG-015
  INT-001 → INT-002 → UX-007

Tier 3 장기(별도 PRD) ─────────────────────────────────
  이미지 / Hex / Office / PDF / Archive / Cloud / DB / 플러그인 / 자동 updater
```

### Tier 0 — 신뢰 (기능 전에 반드시 닫을 것)

이 Tier이 끝나기 전에는 큰 기능을 추가하지 않는 편이 좋다(`docs/14` §3와 동일한 태도).

- **RTM-001** 실제 Tauri runtime smoke 자동화
- **RTM-002** packaged WebView smoke
- **SAV-007** Windows atomic replace 검증
- **SAV-008** 저장 precondition 강화
- **ENC-001** CP949/EUC-KR legacy 인코딩 저장 정책(한국 사용자에게 결정적)
- **SEC-005** dependency audit / SBOM / 코드 서명 안내

이유: 상용 애용자는 "저장이 안전한가"를 당연하게 가정한다. forktail은 아직 실제 패키지 바이너리에서의 OS 통합 smoke가 부족하다. 기능을 아무리 더해도 저장을 믿지 못하면 일상 도구가 될 수 없다.

### Tier 1 — 워크플로우 껍데기 (경쟁사는 기본, forktail은 없는 것)

- **TXT-011** 멀티 세션 탭 — 상용 앱 사용자가 가장 먼저 느끼는 부재
- **TXT-012** 클립보드/임시 텍스트 비교 — 서버 설정 조각, 로그 조각 비교에 필수
- **FOL-015** 폴더 동기화 실제 적용(1단계, 복사만) — dry-run으로 끝나면 "반쪽짜리"
- **RPT-001** unified patch 내보내기
- **RPT-002** 폴더 감사 리포트
- **MRG-012** conflict marker 파일 직접 해결 — Git 사용자 핵심 워크플로우

이유: 상용 도구는 이 워크플로우들이 자연스럽게 연결된다. forktail은 엔진은 있지만 사용자가 "다음 단계"로 넘어갈 때마다 끊긴다. 여러 파일 쌍을 비교하려면 탭이 필요하고, 설정 조각을 비교하려면 클립보드가 필요하고, 폴더 비교 후 변경을 적용하려면 동기화 적용이 필요하다.

### Tier 2 — 차별 핵심 (상용 애용자를 흔들 옵션)

- **FOL-018(신규)** 3-way 폴더 비교 — 현재 백로그에 없는 **가장 큰 기회**(§5 참조)
- **FMT-002** CSV/TSV 테이블 비교
- **FMT-001** JSON/YAML canonical 비교
- **TXT-013** regex ignore 규칙(timestamp, generated header 무시)
- **TXT-014** manual alignment / sync point
- **TXT-015** moved block 감지 힌트
- **MRG-013** bulk conflict action
- **MRG-015** conflict summary 사이드바
- **INT-001** shell context menu(Finder/Explorer)
- **INT-002** Git difftool/mergetool 설정 도우미
- **UX-007** command palette

이유: 이 Tier이 "무료인데도 상용급" 포지셔닝의 뼈대가 된다. 특히 FOL-018은 무료+로컬+깔끔한 UI 조합으로 접근 가능한 영역이 Beyond Compare Pro / Araxis Pro / KDiff3뿐이라 틈새가 크다.

### Tier 3 — 장기 (정체성 결정 필요)

C그룹 전체. 실행하려면 별도 PRD와 ADR이 먼저다. 현재 forktail의 핵심 경험(로컬 텍스트 비교·3-way 병합·안전 저장)이 안정화된 뒤에만 논의한다.

## 5. 신규 후보: FOL-018 3-way 폴더 비교

이 이슈는 현재 백로그에 없지만, 경쟁 분석 관점에서 **가장 큰 차별 기회**로 판단해 `docs/14` §14의 이슈 포맷으로 제안한다. 실제 `docs/04_BACKLOG.md` 승격은 별도 결정이다.

```text
이슈 ID: FOL-018
제안 명칭: 3-way 폴더 비교(deterministic, 비교 중심)

사용자 가치:
- 두 브랜치/배포본/백업본을 공통 조상 폴더와 함께 비교해,
  어느 쪽이 변경되었고 어느 파일이 양쪽 모두에서 변경되었는지 한 화면에 본다.
- Beyond Compare Pro / Araxis Pro만의 영역을 무료+로컬로 가져온다.
- KDiff3는 가능하지만 UI가 구식이라, forktail의 깔끔한 UI가 차별점이 된다.

범위:
- BASE / OURS / THEIRS 세 폴더를 재귀 스캔해 행별 상태를 분류한다.
- 상태 분류:
    Same(셋 모두 동일)
    OursChanged(BASE≠OURS, OURS==THEIRS)
    TheirsChanged(BASE≠THEIRS, OURS==THEIRS)
    BothChangedSameWay(BASE≠OURS, BASE≠THEIRS, OURS==THEIRS)
    BothChangedDifferently(BASE≠OURS, BASE≠THEIRS, OURS≠THEIRS) — 충돌 후보
    OursOnly / TheirsOnly / BaseOnly
    TypeMismatch / Error
- 비교는 메타데이터 / quick hash / full hash 세 모드(BASE·OURS·THEIRS 동일 기준).
- 행 클릭 시 3-way 파일 비교 화면으로 드릴다운(기존 MergeView 재사용).
- 자동 폴더 병합은 이 이슈에서 제외한다. 충돌 후보 행은 표시만 하고,
  개별 파일 3-way merge는 사용자가 명시적으로 연다.
- deterministic only. AI 제안·자동 해결·네트워크 업로드 없음.

수용 기준:
- 세 폴더를 선택하면 행별 상태가 3-way 분류로 표시된다.
- 상태 필터 chip(BothChangedDifferently 등)이 동작한다.
- BothChangedDifferently 행에서 3-way 파일 merge를 열 수 있다.
- 폴더 스캔 취소(job_id)와 진행률이 기존 2-way 폴더 비교와 일관된다.
- 스캔 캐시 키가 3-way 경로 조합에 대해 충돌하지 않는다.
- 단측/양측 누락 파일은 기존 FOL-010 가상 문서 흐름과 일관되게 열린다.

실패/경계 조건:
- 세 폴더 중 하나가 다른 하나의 하위 디렉터리인 경우 순환/중복 스캔 경고.
- 대소문자/Unicode 정규화 경로 충돌이 기존 2-way 폴더 비교와 동일하게 표시된다.
- hash 모드가 다르면 상태 비교가 무의미함을 UI에 명시한다.
- 매우 큰 폴더(수만 파일)에서 cancellation latency가 예산 안에 든다.

필요 테스트:
- 세 폴더 상태 fixture(non-overlapping changes, both-changed-same, both-changed-diff, one-sided).
- hash 모드 일관성 회귀.
- 경로 충돌/Unicode 정규화 회귀.
- 취소 latency smoke.
- 가상 문서 드릴다운 회귀(FOL-010 호환).

검증 명령:
  cd src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test
  npm run typecheck && npm test && npm run build

범위 밖:
- 3-way 폴더 자동 병합(별도 이슈).
- AI 충돌 설명/제안(docs/11 Phase 2).
- 원격 폴더(C그룹).
- 병합 결과의 일괄 적용·롤백(FOL-015/FOL-016이 먼저 안정화된 뒤 별도).
```

이 이슈는 forktail이 이미 3-way merge 엔진(diffy)과 폴더 비교(BLAKE3 + ignore 크레이트)를 둘 다 가지고 있어 자연스럽게 확장 가능하다. Phase 1 핵심 범위를 벗어나지 않으면서도 상용 Pro 기능에 대응하는 드문 기회다.

## 6. 핵심 인사이트

1. **forktail의 엔진은 이미 상용 수준이다.** diff(Monaco)·3-way merge(diffy)·안전 저장(atomic + versioned backup)·해싱(BLAKE3)·인코딩(chardetng)이 모두 갖춰져 있고, 안전 저장은 오히려 Meld/KDiff3보다 앞선다. 빈 곳은 엔진이 아니라 **워크플로우 껍데기**(탭·클립보드·동기화 적용·리포트)다.

2. **가장 큰 기회는 3-way 폴더 비교다.** 현재 백로그에 없지만, 무료+로컬+깔끔한 UI 조합으로 가능한 영역이 Beyond Compare Pro / Araxis Pro / KDiff3뿐이라 틈새가 크다. forktail은 이미 3-way merge와 폴더 비교를 둘 다 가지고 있어 자연스럽게 확장할 수 있다(FOL-018).

3. **"상용 앱 따라가기" ≠ "모든 기능 다 넣기"다.** 이미지/Hex/Office/클라우드/DB/플러그인은 local-first 정체성과 충돌하며, 이걸 넣으려면 dependency·보안·배포 정책을 다시 설계해야 한다. 차라리 **"무료인데도 상용급"** 포지셔닝이 forktail에 유리하다(C그룹은 별도 PRD).

4. **docs/14가 이미 정답의 대부분을 가지고 있다.** 추천 순서(Tier 0 신뢰 → Tier 1 워크플로우 → Tier 2 차별)가 상용 앱 사용자의 니즈와 거의 일치한다. 이 문서가 더하는 것은 **경쟁 관점의 우선순위 해석**과 **FOL-018 3-way 폴더 비교** 하나다.

## 7. docs/14와의 관계 및 다음 액션

### 관계

- `docs/14`는 **이슈 카탈로그**(무엇이 있는가).
- 이 문서는 **전략 로드맵**(상용 앱과 겨루기 위해 무엇을 먼저 할 것인가).
- 두 문서의 이슈 ID는 일치한다. 단, **FOL-018**은 이 문서에서 신규 제안한다.

### 다음 액션

1. Tier 0(RTM-001 → SEC-005)을 먼저 닫는다. 기능이 아니라 신뢰다.
2. Tier 0이 끝나면 Tier 1의 TXT-011(탭)부터 시작한다. 상용 애용자가 가장 먼저 느끼는 부재다.
3. FOL-018(3-way 폴더 비교)을 Tier 1이 끝난 뒤 `docs/04_BACKLOG.md` 승격 여부를 결정한다.
4. C그룹(이미지/Hex/Office/클라우드/DB/플러그인)은 별도 PRD 없이 실행하지 않는다.

### 원칙 재확인

이 로드맵은 AGENTS.md §3의 절대 규칙을 위반하지 않는다.

- Phase 1에 LLM 호출, API 키, 프롬프트, 네트워크 업로드를 추가하지 않는다.
- 사용자 파일 내용을 로그·오류 보고·분석 이벤트로 보내지 않는다.
- 프런트엔드에서 Node.js `fs` 또는 광범위한 Tauri FS 권한을 사용하지 않는다.
- FOL-018을 포함한 모든 후보는 deterministic 알고리즘만 사용하고 AI에 의존하지 않는다.
