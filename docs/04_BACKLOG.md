# 04. Issue-sized Backlog

이 문서의 각 행은 원칙적으로 하나의 PR이다. AI 에이전트에게 여러 행을 한 번에 주지 않는다. Phase 1 backlog는 텍스트 2-way, 폴더 상태 비교, 3-way merge, 안전 저장과 배포 기반으로만 구성한다. 콘텐츠 유형별 전용 비교기는 이 표에 추가하지 않는다. `MRG-009`는 외부 Git이 넘긴 네 파일을 여는 adapter까지이며, repository-aware Git 후보는 `docs/18_GIT_BACKLOG.md`에서 분리한다.

## Foundation

| ID | 작업 | 수용 기준 | 의존 |
|---|---|---|---|
| FND-001 | 세 OS 개발 빌드 검증 | Windows/macOS/Linux에서 `tauri dev` 실행 로그와 수정 사항 기록 | 없음 |
| FND-002 | Rust 오류 코드 정리 | 모든 command가 안정된 code와 사용자용 message 반환, TS type 추가 | FND-001 |
| FND-003 | 구조화 로깅 | 경로는 허용하되 파일 내용은 기록하지 않는 tracing 설정, log level 옵션 | FND-002 |
| FND-004 | 설정 저장소 | 비교 옵션·창 상태·최근 경로만 로컬 저장, 내용 저장 금지 | FND-001 |
| FND-005 | Native menu/command registry | 메뉴와 키보드 단축키가 같은 command handler 사용 | FND-001 |
| FND-006 | CI branch gate | frontend/rust checks 필수, artifact 없이 PR 검증 | FND-001 |

## Two-way text compare

| ID | 작업 | 수용 기준 | 의존 |
|---|---|---|---|
| TXT-001 | 파일 열기 오류 UX | 취소/권한/없음/대용량/binary가 서로 다른 메시지이며 text/version read가 symlink와 읽기 중 64 MiB 초과·path 교체를 내용/hash 반환 없이 거절 | FND-002 |
| TXT-002 | 다음/이전 diff 탐색 | F7/Shift+F7과 버튼, 현재/전체 hunk 표시, wrap-around 옵션 | M0 |
| TXT-003 | 공백 비교 옵션 | trim/all whitespace/case/EOL 옵션이 실제 diff에 반영 | TXT-002 |
| TXT-004 | 마지막 개행 표현 | EOF newline 차이를 UI와 테스트에서 구분 | TXT-001 |
| TXT-005 | 파일 변경 감지 | 열고 난 뒤 외부 수정 시 banner와 reload/keep 선택 | FND-004 |
| TXT-006 | 오른쪽 편집 모드 | 명시적으로 편집 활성화, dirty 표시, save/save as | SAV-001 |
| TXT-007 | hunk copy | 선택 hunk를 left→right/right→left 복사, undo 가능 | TXT-006 |
| TXT-008 | Drag & Drop | 두 파일 drop 또는 한쪽 pane drop, 잘못된 개수 안내 | TXT-001 |
| TXT-009 | CLI open | `forktail left right`로 2-way 세션 시작 | FND-005 |
| TXT-010 | Diff export | unified patch와 HTML이 아닌 plain text report 저장 | TXT-002, SAV-001 |

## Folder compare

| ID | 작업 | 수용 기준 | 의존 |
|---|---|---|---|
| FOL-001 | scan 오류 격리 | 한 파일 권한 오류가 전체 scan을 실패시키지 않고 error row 생성 | FND-002 |
| FOL-002 | 상태 필터 chips | 상태별 on/off, count와 결과 일치, 설정 유지 | FND-004 |
| FOL-003 | 정렬 | path/status/size/time 정렬, stable sort | FOL-002 |
| FOL-004 | 옵션 완성 | hidden/gitignore/symlink toggle이 재스캔에 반영 | FOL-001 |
| FOL-005 | case sensitivity 정책 | Windows/macOS/Linux 경로 충돌 fixture와 플랫폼 정책 문서화 | FOL-001 |
| FOL-006 | 비동기 job/progress | job id, batch event, progress, cancel, stale event 무시 | FOL-001 |
| FOL-007 | 가상 스크롤 | 100k row에서 DOM row 수 제한, 키보드 이동 | FOL-006 |
| FOL-008 | hash 병렬화 | bounded worker pool, UI responsive, cancellation 반영 | FOL-006 |
| FOL-009 | scan cache | size+mtime key cache, 옵션 변경 시 올바른 invalidation | FOL-008 |
| FOL-010 | 폴더 행 행동 | 폴더 우선 계층과 필터 문맥 유지, 항상 보이는 클릭 규칙 안내, 단일 클릭 선택, 일반 파일 더블 클릭/Enter compare(한쪽-only는 missing 가상 빈 문서), reveal/copy path, 폴더 expand/collapse | TXT-001 |
| FOL-011 | copy/sync dry-run | 복사 계획만 생성·표시, 실제 적용은 별도 confirmation | SAV-003, FOL-010 |
| FOL-020 | 폴더 비교 독립 검토 창 | 단일 클릭은 선택만 수행하고 regular text 더블클릭/Enter는 고정된 read-only OS 창을 열며, pair의 양쪽 no-follow/current raw snapshot all-or-nothing 검증, exact identity dedupe·8창/256MiB 한도·caller-bound ACL·종료 정리와 세 OS packaged 증적을 충족 | FOL-006, FOL-010, SEC-002 |

## Three-way merge

| ID | 작업 | 수용 기준 | 의존 |
|---|---|---|---|
| MRG-001 | merge fixture 확장 | clean/conflict/insert/delete/repeated-lines 30개 이상 | M0 |
| MRG-002 | conflict parser hardening | CRLF, no-final-newline, marker-like content, malformed marker 테스트 | MRG-001 |
| MRG-003 | conflict navigator | F8/Shift+F8, count, 현재 conflict 강조 | MRG-002 |
| MRG-004 | resolution command | ours/theirs/base/both가 정확한 block만 교체 | MRG-002 |
| MRG-005 | conflict side diff | active conflict의 base↔ours, base↔theirs 단어 diff 표시 | MRG-003 |
| MRG-006 | undo/redo | resolution·수동 편집을 하나의 history에서 Ctrl/Cmd+Z | MRG-004 |
| MRG-007 | unresolved save guard | 마커가 남으면 경고, 강제 저장은 별도 확인 | MRG-003 |
| MRG-008 | labels/options | marker labels와 favor 옵션은 UI가 아니라 명시적 advanced 설정 | MRG-001 |
| MRG-009 | Git mergetool CLI | `$BASE $LOCAL $REMOTE $MERGED` 순서와 missing Base, 기존 `$MERGED` result/fingerprint, Git marker parser, 임시 source 비영속화, `trustExitCode=false`/`hideResolved=false` 계약 | MRG-007 |
| MRG-010 | session recovery | crash 후 result draft 복구, 원본 내용은 opt-in cache | FND-004, MRG-006 |
| MRG-011 | merge benchmark | fixture 정확도와 파일 크기별 latency baseline 저장 | MRG-001 |

## Safe save and encoding

| ID | 작업 | 수용 기준 | 의존 |
|---|---|---|---|
| SAV-001 | Save/Save As service | overwrite와 new file, dirty state, 사용자 취소 처리 | FND-002 |
| SAV-002 | 외부 변경 precondition | open mtime/hash와 저장 직전 no-follow·64 MiB bounded snapshot을 비교하고 검증 경쟁은 `FILE_CHANGED`로 fail closed, overwrite/reload/save copy | SAV-001 |
| SAV-003 | 플랫폼별 atomic replace | Windows ReplaceFile/Unix rename 검증, parent fsync, fault test | SAV-001 |
| SAV-004 | encoding 보존 | UTF-8 BOM/UTF-16LE/BE round-trip, 선택적 UTF-8 변환 | SAV-003 |
| SAV-005 | EOL 보존/변환 | original/OS/LF/CRLF 선택, mixed 입력 정책 | SAV-004 |
| SAV-006 | backup retention | `.bak` 충돌 방지, timestamp/개수 정책, 복원 UI, backup source no-follow·64 MiB+1 bounded stable snapshot, 실패 시 기존 history/retention 불변, 성공 후 최신 10개 | SAV-003 |

## UX, security, performance, release

| ID | 작업 | 수용 기준 | 의존 |
|---|---|---|---|
| UX-001 | keyboard map | `docs/08_UX_SPEC.md` 단축키 구현·충돌 검사 | FND-005 |
| UX-002 | unsaved close guard | window close/mode switch/reopen과 OS application-level quit가 같은 dirty 확인을 거치고 승인된 programmatic exit는 guard loop 없이 한 번만 종료 | SAV-001 |
| UX-003 | accessibility audit | axe + keyboard + screen reader labels + color-independent status | M3 |
| UX-004 | theme | dark/light/system, semantic token 사용 | FND-004 |
| UX-005 | recent sessions | path/options만 보관, missing path 처리, clear | FND-004 |
| UX-006 | native reveal/copy path | Explorer/Finder/file manager 열기와 path copy | FND-005 |
| UX-009 | 편집 위치 탐색 기록 | 최근 100개 text 위치를 memory-only로 보관하고 mouse Back/OS별 단축키로 pane·cursor·viewport 복원, stale target skip | FND-005, TXT-002, MRG-003 |
| SEC-001 | CSP 고정 | Monaco local workers 유지하며 `csp: null` 제거 | M3 |
| SEC-002 | capability 최소화 | window별 permissions 검토, unused permission 0 | SEC-001 |
| SEC-003 | dependency audit | cargo-deny/npm audit/license allowlist CI | FND-006 |
| SEC-004 | malicious file tests | huge lines, control chars, marker bombs, path edge cases | M3 |
| PERF-001 | startup profile | cold/warm startup baseline, 큰 dependency lazy load | M1 |
| PERF-002 | Monaco bundle split | 언어·worker lazy loading, 기능 회귀 없이 bundle 축소 | PERF-001 |
| PERF-003 | large text strategy | 64 MiB 제한 유지 또는 streaming design ADR | M3 |
| REL-001 | product naming | 앱명, bundle id, icon, copyright 확정 | M4 |
| REL-002 | Windows packages | NSIS/MSI 빌드·설치·제거 smoke | REL-001 |
| REL-003 | macOS package | app/dmg, notarization 여부와 경고 문서 | REL-001 |
| REL-004 | Linux packages | deb/AppImage, oldest supported glibc baseline | REL-001 |

`UX-009`의 mounted 2-way/3-way 편집기 복원, OS별 단축키, X1 입력, native menu 상태 동기화와
live folder cross-item 복원은 자동 계약 검증까지 구현됐다. folder reopen은 content-free scan identity와
cancellable all-or-nothing pair-read만 사용한다. Git cross-item은 T081/T082가 남아 있으므로 별도 완료
조건으로 유지한다. packaged hardware 검증은 사용자 소유이며 자동 검증 결과로 대체하지 않는다.
| REL-005 | release workflow | tag 기반 3 OS artifact, checksum, draft release | REL-002~004 |
| REL-006 | signing policy | 개인용 unsigned와 public signed 경로 분리 | REL-005 |
| REL-007 | SBOM/NOTICE | JS/Rust 전체 dependency license와 SBOM 첨부 | SEC-003 |
| REL-008 | updater | 서명된 artifact가 안정된 뒤 R2 static feed 기반 opt-in updater; 실행 기준은 `docs/16_R2_UPDATER_RUNBOOK.md` | REL-006 |
| REL-009 | beta checklist | clean VM, sample files, rollback, known issues | REL-005 |

## 추천 첫 10개 이슈 순서

```text
FND-001 → FND-002 → FND-006 → TXT-001 → TXT-002
→ MRG-001 → MRG-002 → MRG-003 → SAV-001 → SAV-003
```
