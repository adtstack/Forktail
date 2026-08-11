# 15. 상용 경쟁 로드맵

> 마지막 경쟁 제품 확인: 2026-07-17
>
> 문서 성격: 전략과 승격 순서를 정하는 로드맵. 구현 완료 목록이 아니다.

이 문서는 forktail을 Beyond Compare, Araxis Merge 같은 상용 diff/merge 도구의 일상 대용품으로 만들기 위해 무엇을 먼저 보완해야 하는지 정리한다. 개별 후보와 수용 기준은 `docs/14_PRODUCT_GAP_ROADMAP.md`, 확정된 Phase 1 작업은 `docs/04_BACKLOG.md`, 실제 완료 증적은 `VALIDATION.md`가 담당한다.

## 1. 결론

forktail은 diff/merge 알고리즘이 비어 있는 앱은 아니다. 2-way 편집/탐색, 3-way conflict 해결, 폴더 상태 비교, 안전 저장 설계, read-only Git snapshot의 source 기반이 넓게 들어가 있다. 그러나 지금 상태를 "이미 상용급"이라고 부를 수는 없다.

상용 대체재와의 가장 큰 차이는 다음 순서다.

1. **패키지 신뢰**: required CI와 세 OS packaged 증적이 닫히지 않았다.
2. **반복 작업의 연결**: 단일 active session, 흩어진 설정, profile 부재, command no-op가 작업 흐름을 끊는다.
3. **폴더 작업대**: 결과를 보기는 하지만 progressive review, inline preview, report, safe apply/rollback이 한 흐름으로 이어지지 않는다.
4. **검토 속도**: cursor Back은 명세 단계이고 unchanged folding, review queue, moved/manual alignment가 없다.
5. **형식과 통합의 폭**: 표/구조화 데이터, shell integration, 성숙한 report가 경쟁 제품보다 좁다.

따라서 방향은 "경쟁 제품 기능을 모두 복제"가 아니라 다음과 같다.

```text
신뢰 가능한 beta
  → 세션·설정·탐색이 이어지는 일상 workflow
  → report가 먼저인 폴더 review
  → preview/dry-run/backup/rollback을 갖춘 명시적 write
  → 고급 비교·형식·OS 통합
```

## 2. 비교 방법과 공식 근거

마케팅 문구가 아니라 각 제품의 공식 기능/도움말에서 현재 제공되는 흐름을 확인했다.

- [Beyond Compare 기능 비교](https://www.scootersoftware.com/kb/feature_compare), [에디션 비교](https://www.scootersoftware.com/kb/editions): 저장 session/rule, 폴더 sync/report, 전용 text/table/image/hex view, Pro의 3-way text/folder 기능.
- [Araxis Merge 기능](https://www.araxis.com/merge/features.en), [3-way 폴더 비교](https://www.araxis.com/merge/windows/three-way-folder-comparison.en), [폴더 report](https://www.araxis.com/merge/windows/creating-a-folder-comparison-report.en): 폴더 검토/동기화/report, bookmark/comment, 비교 archive, Professional의 3-way 기능.
- [Kaleidoscope](https://kaleidoscope.app/), [비교 시작과 최근 항목](https://kaleidoscope.app/help/docs/starting-a-comparison), [Repository view](https://kaleidoscope.app/help/docs/repository-view): macOS 중심의 text/image/folder review, recent comparison, Git history/changeset workflow.
- [WinMerge](https://winmerge.org/), [파일 비교 도움말](https://manual.winmerge.org/en/Compare_files.html), [filter 도움말](https://manual.winmerge.org/en/Filters.html): 2/3-way file/folder, moved line/manual alignment/bookmark/filter, patch와 전용 view.
- [Meld](https://gnome.pages.gitlab.gnome.org/meld/), [folder mode](https://gnome.pages.gitlab.gnome.org/meld/help/folder-mode.html), [version-control mode](https://gnome.pages.gitlab.gnome.org/meld/help/vc-mode.html): 2/3-way file/directory와 VCS review.
- [KDiff3 directory merge](https://docs.kde.org/stable_kf6/en/kdiff3/kdiff3/dirmerge.html): directory compare/merge.
- [P4Merge](https://www.perforce.com/products/helix-core-apps/merge-diff-tool-p4merge), [3-way merge 도움말](https://help.perforce.com/helix-core/server-apps/p4merge/current/Content/P4Merge/diff-merge.p4merge.html): text/image와 Base/Theirs/Yours/Result merge workflow.

이 비교에서 중요한 정정은 두 가지다.

- 3-way 폴더 비교는 Beyond Compare/Araxis/KDiff3만의 기능이 아니다. 현재 WinMerge와 Meld도 3-way directory 비교를 제공한다. `FOL-018`은 독점 차별 기능이 아니라 **상용/성숙 도구 parity를 안전한 UX로 구현하는 후보**다.
- atomic save와 versioned backup은 forktail이 강조할 설계 방향이지만, Windows file lock과 세 OS package 증적이 끝나기 전에는 경쟁 제품보다 안전하다고 단정하지 않는다.

## 3. 기능 격차 매트릭스

| 영역 | 경쟁 제품에서 기대되는 경험 | forktail 현재 판정 | 보완 이슈 |
|---|---|---|---|
| 2-way/3-way text | 편집, 탐색, hunk/conflict 처리, 저장 | source 구현은 넓음. packaged 신뢰는 미완료 | `RTM-001/002`, `SAV-007/008` |
| 작업 workspace | 탭/session/recent와 독립된 view state | mode별 단일 active state, multi-session 없음 | `TXT-011`, `UX-009/011` |
| 빠른 검토 | unchanged folding, moved hint, bookmark, Back/Forward | F7/F8와 overview 표시는 있음. 나머지는 없거나 명세 단계 | `TXT-015/016`, `UX-009/011`, `REV-001` |
| 비교 규칙 | 이름 있는 rule/profile과 적용 상태 | 개별 option은 있으나 재사용 profile 없음 | `PRF-001`, `TXT-013`, `FOL-012/017` |
| command/settings | 메뉴·shortcut·settings가 같은 capability를 반영 | 일부 command가 mode와 불일치하고 Settings 흐름이 미완료 | `FND-005R`, `UX-010`, `T084` |
| OS 자동 인식 | 감지된 platform/path를 기본으로 쓰고 예외만 입력 | runtime이 아는 OS/path를 UI가 다시 묻는 흐름 존재 | `INT-002`, `T084`, `UX-010` |
| 폴더 review | progressive tree, filter, 선택 파일 preview | tree/filter/drilldown 기반은 있으나 full-result 경로와 inline preview gap | `FOL-006R`, `FOL-012/019` |
| 폴더 작업 | report → dry-run → apply → rollback | dry-run plan까지만 있고 실제 apply/report/rollback 미완료 | `FOL-014/015/016`, `RPT-002/003` |
| 3-way 폴더 | base와 두 변경본의 상태 분류/드릴다운 | 없음 | `FOL-018` |
| 결과 공유 | patch, folder report, comparison archive/provenance | plain compare report와 Git patch 일부. 일반 patch/folder audit 없음 | `RPT-001/002/003` |
| 형식별 view | table/image/binary/Office 등 목적별 review | text syntax 표시 중심 | `FMT-001/002`; 나머지는 별도 PRD |
| Git/VCS | 외부 tool 또는 repository review의 명확한 lifecycle | source 구현은 넓지만 `T009`, `T077`~`T085`와 packaged 증적이 남음 | `REL-010`, 기존 Git tasks |
| 대용량 | progressive result, cancel, bounded memory | 안전한 size 제한은 있으나 folder/text의 실제 규모 증적 부족 | `FOL-006R`, `PERF-004/005/006` |

## 4. 출시 게이트와 개발 순서

### Gate 0. 상용 기능을 더 노출하기 전의 신뢰

```text
T076/FND-006 current CI
  → FOL-006R progressive scan
  → RTM-001/002 packaged runtime
  → SAV-007/008 + ENC-001
  → SEC-005 + release evidence
  → REL-010 capability exposure decision
```

필수 판정:

- required CI job이 실패한 build를 beta 후보로 승격하지 않는다.
- Windows atomic replace/lock/read-only failure에서 기존 target byte 보존을 증명한다.
- Windows/macOS/Linux 동일 release artifact 계열에서 open/edit/save/merge/close 핵심 흐름을 검증한다.
- Git은 `T009`, `T077`~`T085`가 끝나기 전에는 stable로 마케팅하지 않는다. beta에서 숨기거나 Experimental로 제한하는 선택지가 있다.
- source test 통과와 실제 package 지원을 같은 완료 상태로 쓰지 않는다.

2026-07-17 감사 시점의 최신 main CI는 [실패 상태](https://github.com/adtstack/Forktail/actions/runs/29476734765)였다. 이 링크는 당시 snapshot이며 최신 사실은 CI와 `VALIDATION.md`에서 다시 확인한다.

### Wave 1. 매일 쓰는 workspace

```text
FND-005R command parity
  → UX-010/T084 Settings & Integrations
  → UX-009 cursor Back
  → TXT-011 multi-session tabs
  → TXT-012 clipboard/temporary text
  → PRF-001 named profiles
  → TXT-016 unchanged folding
```

이 묶음의 완료 조건:

- 탭별 Monaco model, dirty, undo, compare option, navigation history가 섞이지 않는다.
- 감지된 OS/path는 다시 입력받지 않고 감지 실패/advanced에서만 입력을 보인다.
- menu/shortcut/button/palette는 같은 command registry와 capability를 사용한다.
- profile에는 규칙만 저장하고 file/clipboard/diff content와 Git temporary path는 저장하지 않는다.
- cursor history는 memory-only 100개이고 stale target을 안전하게 건너뛴다.

### Wave 2. 폴더 review에서 안전한 실행까지

```text
FOL-012 filters/profile
  → FOL-014 + RPT-002 report
  → FOL-019 inline preview
  → REV-001 review queue
  → FOL-015 safe apply
  → FOL-016 rollback
  → RPT-003 provenance
```

write보다 review/report를 먼저 둔다.

- apply 전에 final operation list와 dry-run fingerprint를 확인한다.
- 첫 apply는 copy/overwrite만 허용하고 delete/mirror는 제외한다.
- overwrite는 backup을 만들며 한 파일 실패가 다른 결과를 숨기지 않는다.
- rollback manifest는 path/operation/checksum만 저장하고 content를 log로 복제하지 않는다.
- inline preview는 read-only이고 binary/symlink를 text로 강제 디코딩하지 않는다.

### Wave 3. 고급 비교와 merge 깊이

- `MRG-012/013/015`: marker file, bulk action, conflict summary.
- `RPT-001`: 일반 2-way unified patch.
- `TXT-013/014/015`: ignore rule, manual alignment, moved hint.
- `FOL-017/018`: normalized folder compare와 deterministic 3-way folder compare.
- `FMT-001/002`: 원문과 명확히 구분된 JSON/YAML canonical view, CSV/TSV table view.
- `UX-011`: cursor/navigation Forward.
- `INT-001/002`: shell 및 Git external-tool integration.
- `PERF-004/005/006`: 10k/100k folder와 large text의 latency/memory budget.

`FOL-018`은 폴더 자동 병합 이슈가 아니다. 세 root 상태를 분류하고 충돌 후보 text file을 기존 MergeView로 여는 비교 중심 기능이다. 일괄 쓰기는 `FOL-015/016`의 safety model이 검증된 뒤 별도 결정한다.

## 5. Forktail이 따라가기보다 선명하게 만들 부분

상용 제품의 폭을 그대로 복제하는 것보다 다음 조합이 Forktail의 현실적인 차별점이다.

1. **Local and deterministic**: 비교/병합에 account, upload, remote fetch가 필요 없다.
2. **Review before write**: report와 dry-run이 apply보다 앞선다.
3. **Failure is visible**: partial failure, stale result, unsupported binary/encoding을 성공처럼 숨기지 않는다.
4. **Korean legacy encoding safety**: CP949/EUC-KR 보존/변환 가능 여부를 저장 전에 명시한다.
5. **Content-free traceability**: `RPT-003`은 규칙과 input identity로 판정 근거를 설명하되 사용자 content를 포함하지 않는다.
6. **Read-only Git review**: checkout/fetch/add/commit 없이 local object를 검토하고 명시적인 conflict Result만 안전 저장한다.

이 강점도 테스트와 package evidence가 있어야 제품 주장으로 사용할 수 있다.

## 6. 의도적으로 지금 넣지 않는 범위

경쟁 제품에 존재해도 아래 항목은 현재 Phase 1/1.x의 자동 승격 대상이 아니다.

- AI/LLM merge, API key, prompt, 사용자 content 업로드: `docs/11_AI_PHASE2.md`의 별도 결정.
- FTP/SFTP/WebDAV/cloud, account, 협업 server, telemetry.
- checkout/reset/add/commit/push를 포함하는 full Git client.
- archive 내부 compare, binary/hex, image, Office/PDF 전용 renderer.
- 초기 folder sync의 delete/mirror.
- plugin marketplace, AST/semantic merge.
- 서명/checksum/rollback 증적 없이 update를 자동 적용하는 흐름.

`REL-008`의 opt-in updater tooling 자체를 폐기한다는 뜻은 아니다. signed artifact와 rollback 정책이 검증되기 전에는 stable 자동 업데이트로 노출하지 않는다는 뜻이다. 이미지/table 같은 format view도 영구 금지가 아니라 별도 PRD, dependency/license, memory/security 검토가 필요한 범위다.

## 7. 이번 보완에서 추가·수정한 후보

`docs/14_PRODUCT_GAP_ROADMAP.md`에 다음 issue-sized 후보를 추가했다.

| ID | 핵심 목적 |
|---|---|
| `FOL-006R` | 전체 DTO 대기 경로를 실제 progressive batch/cancel 구조로 수렴 |
| `REL-010` | stable/beta/experimental/hidden capability와 package evidence 연결 |
| `TXT-016` | 저장 결과를 바꾸지 않는 unchanged-region folding |
| `FOL-018` | deterministic 3-way folder classification과 file drilldown |
| `FOL-019` | folder selection의 read-only inline diff preview |
| `RPT-003` | content 없는 비교 규칙/판정 provenance |
| `FND-005R` | menu/shortcut/button/palette의 mode별 command parity |
| `PRF-001` | 이름 있는 versioned compare/filter profile |
| `UX-010` | Settings & Integrations 정보 구조와 OS/path 자동 감지 UX |
| `UX-011` | `UX-009` 이후 memory-only navigation Forward |
| `REV-001` | folder/Git의 명시적 reviewed 상태와 next-unreviewed queue |

기존 `INT-002`도 packaged runtime이 OS/path를 감지한 경우 선택/입력을 숨기도록 `T084`와 맞춰 수정했다.

## 8. 후보가 실제 기능이 되는 조건

로드맵에 이름이 생긴 것과 앱에 기능이 생긴 것은 다르다. 승격은 다음 순서를 따른다.

```text
docs/14 후보
  → 제품 우선순위 결정
  → docs/04 또는 별도 feature backlog 승격
  → spec.md
  → plan.md
  → tasks.md
  → test-first 구현
  → frontend/Rust 검증
  → Windows/macOS/Linux packaged evidence
  → stable 노출
```

한 번에 모두 구현하지 않는다. Gate 0을 닫고 Wave 1에서 실제 사용자 흐름 하나를 끝낸 뒤 다음 묶음을 승격한다. 이 순서를 지키면 기능 수는 늘면서도 Forktail의 핵심 가치인 예측 가능성, 데이터 안전성, 빠른 검토 경험을 잃지 않는다.
