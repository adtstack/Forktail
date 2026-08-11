# 14. Product Gap Roadmap

이 문서는 `forktail`을 실제 일상 도구로 만들기 위해 Phase 1 이후 또는 Phase 1 말미에 검토할 기능 후보를 정리한다. 기존 `docs/04_BACKLOG.md`는 현재 확정된 issue-sized backlog이고, 이 문서는 그 다음에 무엇을 추가할지 고르는 후보 목록이다.

이 문서에 후보를 등록한 것만으로 구현되거나 출시가 약속되는 것은 아니다. 후보는 `docs/04_BACKLOG.md` 승격, 개별 spec/plan/tasks 작성, 구현, 세 OS 검증을 거쳐야 제품 기능이 된다. 상용 경쟁 관점의 순서는 `docs/15_COMMERCIAL_COMPETITIVE_ROADMAP.md`에서 관리한다.

AI 기능은 이 문서의 범위에서 제외한다. 네트워크 업로드, 계정, 원격 저장소 동기화, telemetry도 기본 범위에 넣지 않는다.

## 1. 목적

현재 구현은 로컬 텍스트 파일 비교, 폴더 상태 비교, 3-way 병합, 안전 저장의 골격을 갖추고 있다. 하지만 사용자가 Beyond Compare, Araxis Merge, WinMerge, Meld, KDiff3 같은 도구 대신 매일 쓰려면 다음 세 가지가 더 필요하다.

1. 실제 OS와 packaged app에서 저장과 열기가 믿을 수 있어야 한다.
2. 반복 작업이 빠르고 덜 위험해야 한다.
3. 결과를 보고, 공유하고, 되돌릴 수 있어야 한다.

따라서 새 기능을 고를 때는 다음 질문을 먼저 통과해야 한다.

- 예측 가능성을 높이는가?
- 사용자 파일을 더 안전하게 지키는가?
- 검토 시간을 줄이는가?
- 로컬 우선 원칙을 깨지 않는가?
- 한 PR에 독립적으로 검증할 수 있는가?

## 2. 현재 제품 갭 요약

### 가장 큰 위험

- 실제 Tauri runtime smoke가 부족하다. Drag & Drop, native menu, reveal, CLI open, Save/Save As, packaged WebView CSP는 source/test 계약보다 실제 OS 검증이 중요하다.
- Windows 저장 교체 동작은 반드시 별도 검증해야 한다. Windows file lock, antivirus, read-only attribute, ReplaceFile 계열 동작은 macOS/Linux 테스트로 대체할 수 없다.
- 인코딩 round-trip은 한국 사용자에게 중요하다. UTF-8/UTF-16 BOM만으로는 CP949/EUC-KR 파일을 다루는 운영 환경에서 신뢰가 부족할 수 있다.
- 폴더 비교는 상태 파악까지는 좋지만, 실제 사용자는 검토 후 안전한 복사/동기화/보고서를 원한다.
- CLI open은 parser와 wiring만으로는 부족하다. 실제 OS에서 파일 인자, 저장 결과, 종료 흐름을 검증해야 한다.
- Git difftool/mergetool 통합은 개발자에게 유용할 수 있지만 제품 핵심은 아니다. 사용자가 Git workflow를 명시적으로 원하기 전까지 최우선 안정성 항목으로 보지 않는다.
- release artifact, installer, checksum, signing/notarization 안내, SBOM/NOTICE가 부족하면 일반 사용자가 설치하기 어렵다.

### 기능 체감 갭

- 여러 비교를 동시에 열 수 없다.
- clipboard text compare, paste compare, 임시 텍스트 비교가 없다.
- 비교 규칙을 이름 붙여 재사용하는 profile과 활성 규칙을 한눈에 확인하는 흐름이 없다.
- 긴 unchanged 구간을 접어 변경 문맥만 빠르게 읽는 흐름이 없다.
- regex ignore, generated header ignore, timestamp ignore 같은 규칙 기반 비교가 없다.
- moved block 감지, manual alignment, sync point가 없다.
- 폴더 include/exclude profile과 report export가 없다.
- 폴더 비교의 source 경로는 progressive scan으로 전환됐지만 세 OS packaged/WebView 장기 실행 증적은 아직 부족하다.
- conflict marker가 이미 들어간 단일 파일을 바로 해결하는 흐름이 없다.
- 일부 메뉴·Search·Settings는 현재 mode의 실제 handler/capability와 완전히 일치하지 않는다.
- packaged runtime이 OS와 실행 경로를 아는 경우에도 integration 화면이 OS/path 입력을 먼저 노출한다.
- 검토한 항목과 아직 보지 않은 항목을 이어서 처리하는 review queue가 없다.
- 대용량 로그/덤프는 64 MiB 제한으로 명확히 거절하지만, partial preview나 streaming diff 설계는 아직 없다.

## 3. 추천 개발 순서

아래 순서는 "좋아 보이는 기능"보다 "실사용자가 파일을 잃지 않고 매일 쓸 수 있는 순서"를 우선한다.

```text
T076/FND-006 CI 복구 → FOL-006R → RTM-001 → RTM-002
→ SAV-007 → SAV-008 → ENC-001 → SEC-005 → REL-010
→ FND-005R → UX-010/T084 → UX-009
→ TXT-011 → TXT-012 → PRF-001 → TXT-016
→ FOL-012 → FOL-014 → RPT-002 → FOL-015 → FOL-016
→ MRG-012 → MRG-013 → MRG-015
→ FOL-018 → FOL-019 → REV-001 → RPT-003
```

`REL-010`까지는 기능 추가보다 신뢰와 노출 범위 확정에 가깝다. 이 단계가 끝나기 전에는 큰 기능을 추가하지 않는 편이 좋다. Git 관련 통합은 세 OS packaged 증적이 끝날 때까지 개발자 편의/Experimental 기능으로 분리하고, 로컬 파일 비교 도구의 기본 신뢰성과 혼동하지 않는다.

## 4. Beta 신뢰도 이슈

### RTM-001. 실제 Tauri runtime smoke 자동화

사용자 가치:

- 브라우저 데모가 아니라 실제 데스크톱 앱에서 핵심 흐름이 동작한다는 확신을 준다.

범위:

- `npm run tauri dev` 또는 release app을 대상으로 smoke script를 만든다.
- 파일 2개 열기, 폴더 2개 열기, 3-way 열기, Save As, backup 생성, native reveal, menu command, drag/drop 중 자동화 가능한 항목을 검증한다.
- 자동화가 어려운 OS gesture는 수동 checklist와 screenshot 증거로 남긴다.

수용 기준:

- macOS에서 최소 2-way 열기와 Save As가 실제 파일로 성공한다.
- 3-way merge 결과를 임시 폴더에 저장하고 backup path가 표시된다.
- 실패 시 `VALIDATION.md`에 정확한 command, OS, 앱 빌드, 실패 지점을 기록한다.

필요 테스트:

- Tauri runtime smoke script.
- 임시 디렉터리 fixture 기반 저장 검증.

검증 명령:

```bash
npm run smoke:runtime:prepare
npm run check
npm run tauri dev
```

주의:

- sandbox나 브라우저 자동화 한계 때문에 모든 항목을 한 번에 자동화하려 하지 않는다.

### RTM-002. packaged WebView smoke

사용자 가치:

- 개발 서버가 아닌 설치/번들 앱에서 Monaco worker, CSP, IPC가 깨지지 않는지 확인한다.

범위:

- macOS `.app`, Windows NSIS/MSI, Linux AppImage/deb 중 지원 artifact에서 실행 smoke를 분리한다.
- release CSP 아래에서 2-way/3-way Monaco editor가 로드되는지 확인한다.

수용 기준:

- release build 앱에서 시작 화면, 2-way, 폴더, 3-way 화면이 열린다.
- Monaco language worker 오류가 console에 남지 않는다.
- custom Rust command invoke가 정상 동작한다.

필요 테스트:

- packaged app manual smoke checklist.
- 가능하면 Playwright 또는 OS별 UI automation.

### SAV-007. Windows atomic replace 검증

사용자 가치:

- Windows 사용자가 저장 중 원본을 잃지 않는다는 보장을 강화한다.

범위:

- Windows에서 기존 `NamedTempFile.persist` 동작이 target replace와 file lock 상황에서 안전한지 검증한다.
- 필요하면 Rust 저장 계층에 Windows 전용 replace 구현을 추가한다.
- read-only target, locked target, antivirus-like open handle, permission denied를 fixture로 만든다.

수용 기준:

- replace 실패 후 기존 target byte가 그대로 남는다.
- locked file은 사용자 행동 가능한 `WRITE_FAILED` 또는 `FILE_CHANGED` 메시지를 낸다.
- backup 생성 뒤 replace 실패 시 backup과 target 상태가 문서화된 정책과 일치한다.

필요 테스트:

- Windows 파일 시스템 통합 테스트.
- fault injection test.

검증 명령:

```bash
cd src-tauri
cargo test
```

주의:

- macOS/Linux 성공으로 완료 처리하지 않는다.

### SAV-008. 저장 precondition 강화

사용자 가치:

- timestamp resolution이 낮거나 파일이 같은 크기로 바뀐 경우에도 외부 변경을 더 잘 감지한다.

범위:

- 현재 size + modified time baseline에 optional quick hash baseline을 추가하는 방안을 검토한다.
- 모든 저장에 full hash를 강제하지 않고, risk가 큰 경우에만 quick/full precondition을 선택한다.

수용 기준:

- 같은 size와 같은 timestamp처럼 보이는 외부 변경을 fixture로 재현하고 감지한다.
- 대용량 파일에서 precondition hash가 UI를 멈추지 않는다.
- precondition mismatch는 백업과 replace 전에 중단된다.

필요 테스트:

- temp dir 기반 same-size rewrite fixture.
- 저장 전 hash mismatch fixture.

### SEC-005. 전체 dependency audit, SBOM, NOTICE

사용자 가치:

- 공개 배포 시 사용자가 dependency와 license 상태를 확인할 수 있다.

범위:

- 직접 dependency만이 아니라 transitive dependency NOTICE를 생성한다.
- Rust advisory, npm advisory, license allowlist를 release checklist에 연결한다.
- SBOM 형식은 CycloneDX 또는 SPDX 중 하나로 결정한다.

수용 기준:

- release artifact에 `NOTICE`, SBOM, checksum이 포함된다.
- high/critical advisory는 triage 없이 release 불가다.
- license exception은 문서화한다.

### FOL-006R. 실제 progressive folder scan

사용자 가치:

- 큰 폴더에서 전체 스캔이 끝날 때까지 빈 화면을 기다리지 않고 도착한 결과부터 검토한다.
- 취소하거나 새 비교를 시작했을 때 이전 작업 결과가 현재 화면에 섞이지 않는다.

범위:

- scan 시작 command는 job identity를 먼저 반환하고 Rust가 bounded batch와 progress를 순서대로 보낸다.
- 마지막 응답은 전체 row 배열이 아니라 완료/취소/error summary만 전달한다.
- UI는 현재 root/options/generation/job identity가 모두 일치하는 batch만 반영한다.
- producer와 UI 사이에 bounded queue/backpressure를 두고 느린 consumer가 무제한 memory 증가를 만들지 않게 한다.

수용 기준:

- generated 10k/100k fixture에서 전체 완료 전 첫 batch가 보이고 row가 점진적으로 증가한다.
- cancel 요청은 1초 안에 확인되며 그 뒤 취소된 job의 row가 현재 결과에 추가되지 않는다.
- 새 scan을 연속 시작해도 stale batch가 0건이고 최종 count가 fixture와 일치한다.
- permission error 하나와 hash error 하나가 정상 row와 함께 격리되어 표시된다.

필요 테스트:

- delayed fake scanner의 batch ordering, duplicate/late event, cancel race.
- generated 10k/100k directory benchmark와 memory ceiling.
- component unmount와 option/root 변경 중 stale result 회귀.

구현 증적 (2026-08-07):

- App 기본 폴더 비교 경로를 typed Channel, keyed accumulator, cumulative ACK, generation-aware cancel로 전환했다.
- metadata/quick/full parity, pending/final lifecycle, sequence/owner/generation, inventory/hash/ACK 취소를 자동 테스트한다.
- Apple M2 Pro 16GiB release metadata fixture 5회에서 10k terminal p95 46ms, 100k terminal p95
  413ms, 첫 200행 p95 1ms, 100k peak RSS 증가 96.4MiB, 취소 p95 1ms 미만을 기록했다.
- macOS/Windows/Linux packaged Channel scheduling과 100k WebView main-thread long-task 검증은 아직 실행하지
  않았으므로 제품 완료 또는 세 OS 통과로 표시하지 않는다.

### REL-010. Beta capability exposure gate

사용자 가치:

- 메뉴에 보이는 기능이 실제 지원 OS와 설치 패키지에서 검증된 기능인지 명확히 알 수 있다.

범위:

- 사용자에게 노출되는 capability를 `stable`, `beta`, `experimental`, `hidden` 중 하나로 분류하는 단일 manifest를 둔다.
- source test 통과와 packaged evidence 완료를 서로 다른 상태로 추적한다.
- Git repository 기능은 `T009`, `T077`~`T085`가 끝나기 전까지 stable로 표시하지 않는다.
- UI, README, release note, command registry가 같은 상태를 사용한다.

수용 기준:

- stable capability는 지원한다고 표시한 모든 OS의 packaged evidence link를 가진다.
- 미검증 capability는 숨기거나 명확한 Experimental label과 제한을 표시한다.
- 비활성/숨김 command는 native menu, shortcut, command palette에서 우회 실행할 수 없다.
- CI required job이 실패한 build는 beta artifact로 승격되지 않는다.

필요 테스트:

- capability manifest schema와 mode/OS matrix contract.
- UI/menu/shortcut exposure parity.
- release checklist가 evidence 없는 stable 항목을 거절하는 test 또는 verifier.

## 5. 2-way 비교 기능 후보

### TXT-011. 멀티 세션 탭

사용자 가치:

- 여러 파일 쌍을 열어두고 왔다 갔다 비교할 수 있다.

범위:

- 2-way, 폴더, 3-way 세션을 탭으로 관리한다.
- 탭에는 path basename, dirty 상태, mode icon/text를 표시한다.
- 파일 내용은 recent session에 저장하지 않는다.

수용 기준:

- dirty 탭을 닫을 때 저장 확인이 뜬다.
- 탭 전환으로 Monaco model과 navigation state가 섞이지 않는다.
- 최근 세션은 path/options만 저장한다.

필요 테스트:

- dirty tab close guard.
- 탭별 hunk index와 compare options 격리.

주의:

- dedicated store 도입 조건을 다시 검토한다. 탭이 들어오면 local state만으로 복잡도가 급격히 올라갈 수 있다.

### TXT-012. Clipboard와 임시 텍스트 비교

사용자 가치:

- 서버 설정 조각, 로그 조각, 터미널 출력 등을 파일로 저장하지 않고 비교할 수 있다.

범위:

- "Paste Left", "Paste Right", "Compare Clipboard with File" 흐름을 추가한다.
- 임시 텍스트 세션은 path 대신 synthetic label을 사용한다.
- 저장은 Save As만 허용한다.

수용 기준:

- clipboard 접근 실패 시 직접 붙여넣기 textarea fallback이 있다.
- 임시 텍스트는 recent session에 내용 저장 금지다.
- path 없는 side는 native reveal/copy path를 비활성화한다.

필요 테스트:

- path 없는 `FileDocument` 또는 별도 `TextDocument` contract.
- Save As guard.

### TXT-013. Regex ignore rules

사용자 가치:

- timestamp, build number, generated header처럼 의미 없는 변경을 숨겨 검토 속도를 높인다.

범위:

- line ignore regex, inline normalization regex를 구분한다.
- 예: `^Generated at: .*`, `"timestamp": ".*"`, trailing generated comment.
- rule profile은 local settings에 저장하되 파일 내용은 저장하지 않는다.

수용 기준:

- ignore된 변경은 diff count에서 제외되지만, UI에는 "ignored changes exist" 표시가 있다.
- invalid regex는 저장되지 않고 사용자 메시지를 낸다.
- report export에 적용된 rule 이름이 남는다.

필요 테스트:

- regex compile failure.
- ignore 때문에 모든 변경이 사라지는 경우.
- malicious catastrophic regex 방지 또는 time budget.

주의:

- regex는 성능과 freeze 위험이 있으므로 길이/시간 제한이 필요하다.

### TXT-014. Manual alignment와 sync point

사용자 가치:

- 반복 줄이 많거나 블록 이동이 있는 파일에서 diff alignment를 사람이 조정할 수 있다.

범위:

- 좌우 특정 line을 alignment anchor로 지정한다.
- anchor는 현재 세션에만 유지하고 저장하지 않는다.
- anchor 전/후 구간을 따로 diff한다.

수용 기준:

- anchor 추가/삭제 후 hunk navigation이 재계산된다.
- 잘못된 anchor가 있으면 clear할 수 있다.
- report에는 manual anchor 사용 여부를 표시한다.

필요 테스트:

- repeated lines fixture.
- anchor 전후 hunk count.

### TXT-015. Moved block hint

사용자 가치:

- 삭제와 추가로 보이는 변경이 실제로는 이동인지 빠르게 파악한다.

범위:

- 정확한 semantic move가 아니라 동일/유사 line block의 hint만 제공한다.
- 자동 merge 결과에는 영향을 주지 않는다.

수용 기준:

- 같은 block이 왼쪽에서 삭제되고 오른쪽에서 추가된 경우 "possible move"로 표시한다.
- hint가 틀려도 diff 원문과 저장 결과를 바꾸지 않는다.

필요 테스트:

- exact moved block.
- similar but not identical block.
- 큰 파일에서 hint 계산 timeout.

### TXT-016. Unchanged 구간 접기

사용자 가치:

- 긴 파일에서 변경이 없는 수백 줄을 건너뛰고 실제 변경과 주변 문맥에 집중한다.

범위:

- 일정 길이 이상의 unchanged region을 양쪽에서 같은 범위로 접고 앞뒤 context line을 남긴다.
- 접기는 Monaco view state에만 영향을 주며 model text, diff 결과, 저장 byte를 바꾸지 않는다.
- 다음/이전 diff, Find, Go to line, cursor history 복원 대상이 접힌 구간이면 필요한 범위만 자동으로 펼친다.
- 현재 세션에서 전체 펼치기/다시 접기를 제공한다.

수용 기준:

- 접기 전후 hunk count, dirty state, undo/redo, save 결과가 동일하다.
- F7/Shift+F7과 검색 결과 이동이 숨은 target을 정확히 reveal한다.
- 좌우 fold range가 어긋나도 잘못된 line을 같은 문맥으로 표시하지 않는다.
- keyboard-only와 200% 확대에서 접힘 표시를 열고 닫을 수 있다.

필요 테스트:

- 긴 unchanged prefix/middle/suffix와 no-final-newline fixture.
- find/navigation/cursor-history reveal 회귀.
- edit로 fold boundary가 바뀌는 경우의 recompute와 stale range 폐기.

## 6. 폴더 비교와 동기화 후보

### FOL-012. Include/exclude glob profile

사용자 가치:

- `node_modules`, build output, `.DS_Store`, log archive 등 비교에서 제외할 대상을 안정적으로 관리한다.

범위:

- include glob, exclude glob, preset profile을 추가한다.
- `.gitignore` 존중과 사용자 glob의 우선순위를 명확히 한다.

수용 기준:

- excluded row count가 UI에 표시된다.
- profile 변경 시 rescan이 발생한다.
- root escape나 absolute pattern 오용을 막는다.

필요 테스트:

- glob precedence.
- hidden/gitignore 옵션과 조합.

### FOL-013. 파일 metadata detail 확장

사용자 가치:

- 운영자는 내용뿐 아니라 권한, symlink target, executable bit 차이를 봐야 한다.

범위:

- 권한 mode, readonly, executable bit, symlink target, file type detail을 표시한다.
- owner/group은 OS별 portability를 고려해 후순위로 둔다.

수용 기준:

- metadata-only 차이를 별도 label로 표시한다.
- symlink follow off 상태에서 symlink target을 볼 수 있다.
- Windows와 Unix metadata 차이는 UI에서 혼동되지 않는다.

필요 테스트:

- symlink fixture.
- executable bit fixture.
- readonly fixture.

### FOL-014. 폴더 report export

사용자 가치:

- 배포 전후, 서버 설정 전후, 백업 검증 결과를 파일로 남길 수 있다.

범위:

- plain text, CSV, JSON 중 최소 하나를 먼저 구현한다.
- path, status, size, modified time, hash, message를 포함한다.
- 현재 filter/sort 적용 여부를 선택하게 한다.

수용 기준:

- report는 파일 내용을 포함하지 않는다.
- status count와 exported row count가 일치한다.
- portable path conflict warning도 report에 포함한다.

필요 테스트:

- CSV escaping.
- JSON schema contract.
- filtered vs all export.

### FOL-015. Folder sync apply 1단계

사용자 가치:

- dry-run에서 끝나지 않고, 검토한 복사 계획을 안전하게 적용할 수 있다.

범위:

- 처음에는 missing file copy와 changed file overwrite만 지원한다.
- 삭제 동기화는 제외한다.
- 모든 overwrite는 backup 또는 versioned backup을 만든다.
- 적용 전 final plan modal에서 count와 target path를 보여준다.

수용 기준:

- apply 전 dry-run plan과 실제 수행 plan이 같은 fingerprint를 가진다.
- target root 밖으로 나가는 path는 수행하지 않는다.
- 실패한 파일 하나가 전체 결과를 숨기지 않고 per-row 결과로 남는다.
- 취소 가능하거나 최소한 다음 파일부터 중단된다.

필요 테스트:

- temp dir copy fixture.
- overwrite backup fixture.
- permission denied per-row failure.
- root escape 차단.

주의:

- 삭제 동기화는 별도 이슈로 미룬다. 첫 apply에서 삭제까지 넣으면 데이터 손실 blast radius가 너무 크다.

### FOL-016. Folder sync rollback

사용자 가치:

- 동기화 적용 후 문제가 있으면 이전 상태로 되돌릴 수 있다.

범위:

- FOL-015 apply가 만든 backup manifest를 기반으로 rollback한다.
- manifest에는 파일 내용이 아니라 path, backup path, operation, timestamp, checksum만 저장한다.

수용 기준:

- rollback은 root 밖 backup path를 거절한다.
- rollback 전 현재 파일도 backup한다.
- partial rollback 실패가 명확히 표시된다.

필요 테스트:

- rollback success.
- backup missing.
- target modified after sync.

### FOL-017. Text-normalized folder compare

사용자 가치:

- 줄끝, 공백, 대소문자 무시 같은 2-way 옵션을 폴더 상태 비교에도 적용할 수 있다.

범위:

- 일반 hash와 별도로 "text normalized hash" mode를 추가한다.
- 텍스트로 안전하게 판별된 파일만 normalized compare를 수행하고 binary는 metadata/hash 상태로 유지한다.

수용 기준:

- LF/CRLF만 다른 텍스트 파일은 옵션에 따라 same이 된다.
- binary 파일은 텍스트 디코딩하지 않는다.
- normalized compare는 느릴 수 있음을 UI에 표시한다.

필요 테스트:

- CRLF/LF fixture.
- trailing whitespace fixture.
- binary rejection fixture.

### FOL-018. Deterministic 3-way folder compare

사용자 가치:

- 공통 기준 폴더와 두 변경본을 함께 비교해 한쪽만 바뀐 파일과 양쪽이 다르게 바뀐 충돌 후보를 구분한다.

범위:

- BASE/OURS/THEIRS 세 root를 같은 path, normalization, metadata/hash 정책으로 재귀 비교한다.
- `Same`, `OursChanged`, `TheirsChanged`, `BothChangedSameWay`, `BothChangedDifferently`,
  one-side/base-only, type mismatch, error 상태를 결정론적으로 분류한다.
- `OursChanged`는 `OURS != BASE && THEIRS == BASE`, `TheirsChanged`는 그 반대,
  `BothChangedSameWay`는 `OURS == THEIRS && OURS != BASE`로 계약한다.
- 충돌 후보 text row는 기존 3-way merge 화면으로 명시적으로 열 수 있게 한다.
- 이 이슈는 비교와 검토만 다루며 폴더 자동 병합/일괄 쓰기는 하지 않는다.

수용 기준:

- 상태 filter와 count가 three-root fixture의 expected classification과 일치한다.
- 세 root에 동일한 compare mode/profile이 적용되고 다른 mode를 섞을 수 없다.
- scan cancel/progress/stale-generation 처리가 `FOL-006R`과 동일하다.
- 한쪽 누락 text와 binary/symlink/type mismatch가 잘못된 빈 텍스트로 디코딩되지 않는다.
- 세 root의 중첩, case/Unicode normalization collision, root escape를 차단하거나 명시적으로 표시한다.

필요 테스트:

- non-overlapping change, same-way change, different change, add/delete/type-change fixture.
- quick/full/normalized hash mode 일관성.
- Unicode/case collision과 nested-root fixture.
- 3-way text drilldown, cancel latency, stale batch 회귀.

의존:

- `FOL-006R`, `FOL-012`, 기존 3-way merge 안전 저장 계약.

### FOL-019. 선택 파일 inline preview

사용자 가치:

- 폴더 목록을 떠나지 않고 선택한 행의 실제 text 차이를 빠르게 훑고 다음 파일로 이동한다.

범위:

- 선택한 regular text row를 read-only compact diff preview로 연다.
- preview는 기존 좁은 Rust file/blob reader와 binary/size/encoding 판정을 재사용한다.
- keyboard로 이전/다음 visible row를 이동하고 필요할 때 전체 2-way/3-way 화면을 연다.
- selection이 바뀌면 이전 load를 취소하거나 generation identity로 stale 결과를 버린다.

수용 기준:

- 빠르게 selection을 바꿔도 마지막 선택 row 외의 preview가 표시되지 않는다.
- missing side, binary, symlink, permission error는 행동 가능한 placeholder를 보이고 text로 강제 디코딩하지 않는다.
- preview에서는 편집, hunk apply, 저장이 불가능하다.
- 100k row virtual list의 scroll/focus와 preview open이 서로 selection을 잃게 하지 않는다.

필요 테스트:

- delayed response/stale selection component test.
- missing/binary/symlink/error fixture.
- keyboard-only와 200% 확대 smoke.

### FOL-020. 폴더 비교 독립 검토 창

상태: `docs/04_BACKLOG.md`에 승격됨. Source 구현은 진행됐으며 convergence와 세 OS packaged 증적이
끝나기 전에는 stable/beta 완료로 표시하지 않는다.

사용자 가치:

- 폴더 결과를 한 번 클릭하면 선택만 하고, 일반 파일을 더블클릭하거나 `Enter`로 열면 실제 별도 창에서
  비교해 목록과 파일 내용을 동시에 검토한다.
- 같은 이름의 파일이 여러 폴더에 있어도 창 상단의 폴더·상대 경로·좌우 루트 문맥으로 대상을 구분한다.

범위:

- 폴더 행은 접기·펼치기만 하고, final regular text 행은 기존 안전한 pair reader를 거쳐 read-only 독립
  창으로 연다. 한쪽-only는 missing 가상 문서를 사용한다.
- 목록 위에 단일 클릭 선택, 더블클릭/`Enter` 활성화, `Space` 세부 정보 규칙을 항상 보이는 안내로
  표시하고 결과 table의 설명과 연결한다.
- 같은 live review의 같은 exact row identity는 중복 창 대신 기존 창을 복원·focus한다.
- 창별 document/navigation/error/external-change 상태를 격리하고 최대 8개·source snapshot 합계 256MiB까지만
  동시에 유지한다.
- 원래 폴더 화면 navigation 뒤에도 열린 snapshot은 유지하되 창 닫기와 app 종료 때 process-only session을
  정리한다.

수용 기준:

- 단일 클릭 100회에서 창 생성과 파일 read는 0건이고, double-click/Enter는 별도 OS 창 하나만 연다.
- 영어·한국어 화면 모두 단일/더블 클릭 규칙이 tooltip이나 하단 상태에 의존하지 않고 목록 위에 보인다.
- 같은 행 100회 재실행에서 중복 창은 0개이며 기존 창이 복원·활성화된다.
- 새 창은 300ms 안에 shell을 표시하고 1MiB 이하 text pair는 1초 안에 compare 또는 행동 가능한 오류를
  표시한다.
- binary/LFS/oversized/symlink/containment/expected-side/stale fixture를 text로 강제해서 연 사례가 0건이다.
- macOS/Windows/Linux packaged build에서 create/focus/minimize/resize/close/app-exit lifecycle을 검증한다.

필요 테스트:

- exact row/generation dedupe registry와 8-window/256MiB cap pure test.
- all-or-nothing token resolution, open/rescan/close/app-exit race, orphan cleanup test.
- main/detached window capability 분리와 URL/title/storage privacy sentinel.
- same-basename nested paths, one-sided missing, external change component test.

구현 증적 (2026-08-09):

- 단일 클릭은 선택만 유지하고 final regular-file 더블클릭/`Enter`는 고정된 child surface의 read-only
  OS 창을 열도록 main folder flow를 연결했다.
- 단일 클릭, 더블클릭/`Enter`, `Space`의 역할을 영어·한국어 상시 안내로 표시하고 결과 table의
  `aria-describedby`에 연결했다.
- AppManifest 기준 main/detached ACL, caller-bound child command, descriptor-only registry, concurrent
  dedupe, 8-window/256 MiB 제한, all-or-nothing initial load/reload와 destroy/exit 정리를 구현했다.
- child는 상대 경로·좌우 root·missing 문맥을 header에 표시하되 URL/label/model/storage에는 경로·token·
  content를 남기지 않고, focused native menu와 외부 변경 reload/keep 상태를 창별로 격리한다.
- contract/component/Rust 테스트 증적과 세 OS packaged lifecycle·300ms/1초 성능 증적은 구분한다.
  packaged macOS/Windows/Linux와 성능 측정은 아직 실행하지 않았으므로 stable 완료로 표시하지 않는다.

## 7. 3-way merge와 Git 후보

branch/commit/index snapshot을 앱에서 직접 읽는 더 큰 Git 후보는 `docs/17_GIT_INTEGRATION.md`와 `docs/18_GIT_BACKLOG.md`를 따른다. 아래 `MRG-014`와 `INT-002`는 그보다 앞선 외부 tool adapter 안정화 작업이며, repository-aware Git 기능이 완료됐다는 뜻이 아니다.

### MRG-012. Conflict marker file resolver

사용자 가치:

- Git이 만든 conflict marker가 들어간 파일 하나만 열어 해결할 수 있다.

범위:

- `<<<<<<<`, `|||||||`, `=======`, `>>>>>>>` marker가 있는 파일을 result editor로 연다.
- base section이 없는 conflict marker도 처리한다.
- 원본 파일은 저장 전 backup한다.

수용 기준:

- marker file을 열면 conflict count와 navigation이 동작한다.
- OURS/THEIRS/BOTH resolution이 해당 block만 바꾼다.
- malformed marker는 전체 파일을 망가뜨리지 않고 오류 위치를 표시한다.

필요 테스트:

- Git-style marker with base.
- Git-style marker without base.
- marker-like user text.

### MRG-013. Bulk conflict actions

사용자 가치:

- 많은 충돌에서 명시적으로 전체 OURS/THEIRS/BASE/BOTH를 적용할 수 있다.

범위:

- "Apply OURS to all remaining", "Apply THEIRS to all remaining" 등 bulk action을 추가한다.
- action 전 확인 modal과 예상 conflict count를 표시한다.
- undo 한 번으로 bulk action 전체를 되돌린다.

수용 기준:

- bulk action 후 marker count가 정확하다.
- undo/redo가 bulk action을 하나의 history step으로 처리한다.
- 직접 편집된 conflict에도 사용자가 확인한 resolution만 적용한다.

필요 테스트:

- multiple conflict fixture.
- bulk then undo.
- malformed marker guard.

### MRG-014. Git mergetool packaged smoke

사용자 가치:

- Git 충돌 해결 도구로 forktail을 쓰고 싶은 개발자가 있을 때 등록 흐름을 검증할 수 있다.

우선순위:

- 선택 기능이다. forktail의 핵심은 Git 클라이언트가 아니라 로컬 텍스트/폴더 비교와 안전 저장이므로, 일반 사용자 베타의 최우선 조건으로 보지 않는다.

범위:

- `MRG-012`의 기본·base 없는 Git conflict marker parser를 먼저 완료하거나 같은 수용 기준을 선행 이슈로 승격한다.
- Git test repository를 만들고 conflict를 발생시킨다.
- custom `git mergetool`의 `$BASE`, `$LOCAL`, `$REMOTE`, `$MERGED`를 `forktail --mergetool`에 전달한다.
- `$BASE`가 빈 인자이거나 사용할 수 없을 때 missing Base snapshot으로 보존한다.
- `$MERGED`의 기존 내용을 초기 Result로 읽고 open fingerprint를 저장한다.
- Git 임시 source가 recent session, active-session restore, recovery draft에 남지 않게 한다.
- `trustExitCode = false`, tool-specific `hideResolved = false`, Save & Close/Abort, Git `.orig`와 Forktail `.bak.*` 정책을 문서화한다.
- `%O/%A/%B/%P` custom merge driver는 범위에서 제외한다.

수용 기준:

- conflict repo에서 앱이 base/ours/theirs/output path를 올바르게 연다.
- 앱 프로세스가 닫힐 때까지 Git이 임시 source를 보존한다.
- 미해결 marker는 mergetool 성공 저장으로 처리하지 않는다.
- 저장 후 Git working tree 파일이 기대 결과와 같다.
- 저장하거나 저장하지 않고 닫은 경우 모두 Git의 timestamp/사용자 확인 흐름과 문서가 일치한다.
- Forktail 프로세스가 실행되는 동안 HEAD, refs, index가 바뀌지 않는다. 프로세스 종료 뒤 사용자가 성공을 확인해 `git mergetool` wrapper가 해당 path를 stage하는 단계는 별도 checkpoint로 기록한다.

필요 테스트:

- packaged binary 또는 release app path 기반 smoke.
- macOS/Windows/Linux 각각 최소 1회.
- path 공백/Unicode, add/add, delete/modify, 여러 파일 순차 실행, 외부 `$MERGED` 변경 fixture.

### MRG-015. Conflict summary sidebar

사용자 가치:

- 충돌이 많은 파일에서 전체 위치와 해결 상태를 빠르게 훑는다.

범위:

- conflict list, line range, short preview, active marker를 표시한다.
- 클릭 시 해당 conflict로 이동한다.

수용 기준:

- result edit로 conflict count가 바뀌면 sidebar가 재계산된다.
- active conflict와 sidebar selection이 동기화된다.
- screen reader label이 있다.

필요 테스트:

- direct marker edit 후 list update.
- keyboard navigation.

## 8. 리포트와 감사 후보

### RPT-001. Unified patch export

사용자 가치:

- 변경 내용을 patch로 저장해 code review나 수동 적용에 사용할 수 있다.

범위:

- 2-way diff에서 unified diff format을 생성한다.
- path label, no-final-newline marker, EOL metadata를 포함한다.

수용 기준:

- plain text report와 unified patch를 구분한다.
- whitespace ignore 옵션이 적용된 report인지 명확히 표시한다.
- patch 적용 가능성을 보장하지 않는 경우 UI에 "review report"로 표시한다.

필요 테스트:

- add/delete/modify/no-final-newline fixture.
- path escaping.

### RPT-002. Folder audit report

사용자 가치:

- 운영자가 배포 전후 차이와 적용 계획을 감사용 기록으로 남길 수 있다.

범위:

- FOL-014를 확장해 sync dry-run 또는 apply 결과까지 포함한다.
- operation summary, failed rows, skipped rows, backups를 포함한다.

수용 기준:

- report에 파일 내용은 절대 포함하지 않는다.
- backup path와 operation id가 들어간다.
- CSV/JSON schema가 문서화된다.

필요 테스트:

- apply partial failure report.
- dry-run report.

### RPT-003. 비교 근거(provenance) report

사용자 가치:

- 왜 항목이 `same`, `different`, `ignored`, `conflict candidate`로 분류됐는지 나중에 재현하고 설명할 수 있다.

범위:

- compare mode, profile id/version, ignore/filter rule id, encoding/EOL policy, hash algorithm과 입력 identity를 schema로 남긴다.
- 파일 내용, diff snippet, clipboard text, Git blob content는 포함하지 않는다.
- path 포함 여부와 상대/절대 표시는 export 시 사용자가 선택하며 기본은 root-relative다.
- volatile timestamp를 제외한 canonical payload digest를 제공한다.

수용 기준:

- 같은 입력 identity와 같은 profile로 만든 canonical payload/digest가 동일하다.
- profile 또는 compare mode가 바뀌면 그 차이가 report에 명시된다.
- ignored result도 어떤 규칙이 적용됐는지 확인할 수 있다.
- preview에서 export될 필드를 검토하고 취소할 수 있다.

필요 테스트:

- canonical JSON/schema snapshot과 deterministic digest.
- no content/snippet/absolute-home-path privacy sentinel.
- profile/version/mode 변경 fixture.

## 9. 인코딩과 형식 인식 후보

### ENC-001. Legacy encoding save policy

사용자 가치:

- CP949/EUC-KR/Windows-1252 파일을 열고 저장할 때 불필요한 손실과 혼란을 줄인다.

범위:

- 읽기에서 탐지된 legacy encoding을 저장 옵션에 표시한다.
- 보존 저장이 가능한 encoding과 UTF-8 변환만 가능한 encoding을 구분한다.
- 변환 저장 시 명확한 경고와 preview를 제공한다.

수용 기준:

- CP949 fixture가 round-trip 가능한지 정책적으로 결정된다.
- 저장 불가능한 문자가 있으면 저장 전 경고한다.
- UTF-8 변환 저장은 사용자가 명시적으로 선택한다.

필요 테스트:

- CP949/EUC-KR fixture.
- Windows-1252 fixture.
- unmappable character fixture.

주의:

- 인코딩 라이브러리 추가 시 dependency policy를 먼저 통과해야 한다.

### FMT-001. JSON/YAML canonical compare

사용자 가치:

- 설정 파일에서 key order, formatting 차이를 줄이고 의미 있는 변경을 빠르게 본다.

범위:

- 원본 편집기는 그대로 두고, canonicalized virtual text를 compare input으로 사용하는 옵션을 제공한다.
- 저장은 원본 파일 직접 포맷 변경이 아니라 사용자가 별도 명령으로 선택해야 한다.

수용 기준:

- invalid JSON/YAML은 원본 text compare로 fallback한다.
- canonical compare 사용 여부가 status/report에 표시된다.
- comments가 있는 JSONC/YAML 정책을 문서화한다.

필요 테스트:

- key order difference.
- whitespace formatting difference.
- invalid syntax fallback.

주의:

- 이것은 deterministic rule이다. semantic merge나 AI 제안이 아니다.

### FMT-002. CSV/TSV table compare

사용자 가치:

- 문서/데이터 작업자가 줄 단위 diff보다 row/column 단위 차이를 빠르게 본다.

범위:

- Phase 1 텍스트 범위 안에서 CSV/TSV parser 기반 table diff view를 추가한다.
- delimiter, header row, key column을 설정한다.
- 저장/병합은 첫 버전에서 제외하고 view/report만 제공한다.

수용 기준:

- row added/removed/changed count가 표시된다.
- quoted newline과 escaped quote를 올바르게 파싱한다.
- 큰 CSV는 size cap과 별도 row cap을 가진다.

필요 테스트:

- quoted CSV fixture.
- reordered rows with key column.
- malformed CSV fallback.

## 10. 성능과 대용량 후보

### PERF-004. Large folder benchmark suite

사용자 가치:

- 10k/100k 파일에서 실제로 멈추지 않는지 계속 확인한다.

범위:

- generated fixture로 metadata, quick hash, full hash baseline을 기록한다.
- cancellation latency와 memory ceiling을 측정한다.

수용 기준:

- benchmark 결과가 `docs/benchmarks/`에 기록된다.
- baseline 대비 큰 regression은 PR에서 설명한다.
- cancellation은 긴 hash 중에도 일정 시간 안에 반응한다.

필요 테스트:

- nightly 또는 수동 benchmark script.

### PERF-005. Streaming text diff ADR와 prototype

사용자 가치:

- 64 MiB 초과 로그나 dump를 아예 못 여는 한계를 장기적으로 줄인다.

범위:

- 바로 제품 기능으로 넣지 않고 ADR와 prototype으로 시작한다.
- partial load, chunked diff, navigation, cancellation, save disabled policy를 설계한다.

수용 기준:

- streaming mode가 기존 safe save와 섞이지 않는다.
- 큰 파일은 view-only부터 시작한다.
- memory budget과 UX 제한이 문서화된다.

필요 테스트:

- generated large text fixture.
- cancellation and memory smoke.

주의:

- Monaco와 diff engine 제약 때문에 이 기능은 큰 설계 작업이다. 저장/병합 기능과 같은 PR에 넣지 않는다.

### PERF-006. Memory budget guard

사용자 가치:

- 비정상 입력이나 너무 많은 탭이 앱을 죽이는 일을 줄인다.

범위:

- 열린 문서 수, 총 text size, Monaco model count를 추적한다.
- 위험 threshold에서 새 파일 열기를 막거나 사용자 확인을 요구한다.

수용 기준:

- threshold 초과 시 사용자 파일을 읽기 전에 거절한다.
- 닫은 탭의 Monaco model이 dispose된다.
- memory warning은 파일 내용을 기록하지 않는다.

필요 테스트:

- model lifecycle unit test.
- many session stress smoke.

## 11. OS 통합 후보

### INT-001. Shell context menu entry

사용자 가치:

- Finder/Explorer/file manager에서 파일 2개 또는 폴더 2개를 바로 forktail로 열 수 있다.

범위:

- Windows Explorer, macOS Finder Services, Linux desktop entry 지원 가능성을 조사한다.
- 처음에는 문서화된 manual setup으로 시작한다.

수용 기준:

- 설치/제거 시 OS context menu가 남지 않는다.
- 선택 개수가 잘못되면 앱이 행동 가능한 메시지를 보여준다.

필요 테스트:

- OS별 manual smoke.

### INT-002. Git difftool/mergetool 설정 도우미

사용자 가치:

- 사용자가 Git 설정을 직접 외우지 않아도 된다.

범위:

- packaged runtime이 반환한 OS와 actual executable path를 authoritative DTO로 사용해 difftool/mergetool snippet을 바로 확인하고 복사하게 한다.
- 감지 성공 시 OS 선택과 path 입력을 숨기고 읽기 전용 요약만 보인다. 감지 실패/dev 환경에서는 manual fallback을, 사용자가 명시적으로 연 경우에만 advanced override를 제공한다.
- Linux AppImage는 임시 mount 내부 binary가 아니라 `APPIMAGE`의 stable artifact path를 사용한다.
- 실제 `.gitconfig` 자동 수정은 첫 버전에서 제외한다.
- difftool은 `$LOCAL`/`$REMOTE`, mergetool은 `$BASE`/`$LOCAL`/`$REMOTE`/`$MERGED`를 사용한다.
- added/deleted difftool side의 `/dev/null`은 빈 positional argument로 정규화한다. mergetool은 stage 1이 없어도 Git이 0-byte BASE 임시파일을 만들 수 있으므로 `base_present=false`일 때만 빈 Base slot으로 바꾸고, 실제 empty stage 1은 path를 보존한다.
- generated mergetool config에는 tool-specific `mergetool.forktail.hideResolved=false`를 포함한다.
- `%O/%A/%B/%P` custom merge driver 설정은 생성하지 않는다.

수용 기준:

- 감지 성공한 packaged app은 초기 오류 flash 없이 OS/path 입력을 요구하지 않는다.
- manual fallback의 OS별 executable path 예시가 정확하고 잘못된 absolute executable은 거절한다.
- difftool과 mergetool 설정을 구분한다.
- 현재 GUI lifecycle에서는 `trustExitCode = false`가 필요한 이유를 짧게 설명한다.
- generated config text가 shell로 평가된다는 점을 반영해 OS별 path 공백/quote snapshot을 검증한다.
- add/add의 missing stage 1과 실제 empty stage 1을 파일 크기가 아니라 Git의 stage-presence 신호로 구분하고, 신호가 없으면 path를 보존한다.
- `diff.tool`, `merge.tool` 같은 default 변경은 생성하지 않고 사용자가 `--tool=forktail`을 명시한다.

필요 테스트:

- generated config text snapshot.
- runtime detection success/failure/dev/advanced override component contract.
- Windows/macOS/Linux DTO와 UI field visibility matrix.

### INT-003. File association policy

사용자 가치:

- `.diff`, `.patch`, conflict marker file을 더 쉽게 열 수 있다.

범위:

- association을 실제 등록하기 전에 release/security 정책을 세운다.
- patch file은 view-only로 먼저 연다.

수용 기준:

- 임의 확장자 hijack을 하지 않는다.
- association 제거 방법을 문서화한다.

## 12. 제품 품질 후보

### FND-005R. 상황별 native command parity

사용자 가치:

- 보이는 메뉴와 단축키를 눌렀을 때 현재 화면에 맞는 동작이 실행되고, 동작할 수 없는 명령은 미리 비활성화된다.

범위:

- 하나의 typed command registry와 capability selector가 native menu, shortcut, toolbar, command palette를 구동한다.
- 2-way/folder/merge/Git/Home/Settings mode별 command target과 disabled reason을 정의한다.
- Search와 Settings처럼 표시돼 있으나 handler가 없거나 일부 mode에서 no-op인 명령은 실제 handler를 연결하거나 노출하지 않는다.
- Save/Undo/Redo/Back은 active target과 dirty/history state가 있을 때만 실행한다.

수용 기준:

- enabled로 보이는 모든 command는 현재 mode에 정확히 하나의 handler와 target을 가진다.
- keyboard, native menu, toolbar, palette가 같은 handler id와 enable state를 사용한다.
- focus가 editor/input/list일 때 shortcut collision과 기본 text editing 우선순위가 문서화되고 테스트된다.
- no-op command와 dirty guard 우회가 0건이다.

필요 테스트:

- mode × focus × capability command matrix.
- menu/shortcut/button/palette registry parity verifier.
- Search focus, Settings open, Save/Undo/Back target 회귀.

### PRF-001. 이름 있는 비교 profile

사용자 가치:

- 매번 whitespace, EOL, case, ignore rule, folder filter를 다시 맞추지 않고 목적별 규칙을 재사용한다.

범위:

- built-in profile과 사용자 profile을 제공하고 duplicate/rename/delete/import/export를 지원한다.
- 2-way 옵션, `TXT-013` 규칙, `FOL-012` filter, hash/normalization mode를 versioned schema로 묶는다.
- profile에는 file content, clipboard text, diff result, absolute recent path를 저장하지 않는다.
- 현재 적용 profile과 session에서 임시로 달라진 옵션을 항상 표시한다.

수용 기준:

- profile 전환 시 affected view가 예측 가능한 한 번의 recompute/rescan을 수행한다.
- malformed/unknown-version profile은 기본값으로 조용히 덮지 않고 import 실패와 원인을 보여준다.
- report에는 profile id/version과 session override가 기록된다.
- profile 삭제가 열린 session의 effective option을 바꾸지 않는다.

필요 테스트:

- schema migration/import/export round-trip.
- content/path privacy sentinel.
- profile switch와 session override/recompute 회귀.

### UX-007. Command palette

사용자 가치:

- 메뉴와 단축키를 외우지 않아도 현재 화면에서 가능한 명령을 찾을 수 있다.

범위:

- 현재 mode에서 가능한 command만 보여준다.
- command registry와 같은 handler를 사용한다.

수용 기준:

- disabled command는 이유를 표시한다.
- keyboard-only로 열고 실행할 수 있다.
- native menu shortcut과 충돌하지 않는다.

필요 테스트:

- command registry parity.
- keyboard navigation.

### UX-008. First-run sample workspace

사용자 가치:

- 설치 직후 파일을 고르지 않아도 앱의 핵심 흐름을 이해할 수 있다.

범위:

- 현재 demo를 productized sample로 정리한다.
- 실제 사용자 파일과 sample을 명확히 구분한다.

수용 기준:

- sample content는 app bundle에 포함되고 네트워크가 필요 없다.
- sample session은 recent user session과 구분된다.
- sample에서 Save는 Save As만 허용한다.

### UX-009. 편집 위치 탐색 기록

사용자 가치:

- 긴 diff와 merge conflict를 검토하다가 직전에 보던 pane과 line을 다시 찾는 시간을 줄인다.
- mouse side button과 keyboard에서 동일한 `이전 편집 위치` 경험을 제공한다.

범위:

- 현재 앱 실행 동안 text editor의 session identity, pane, cursor line/column, viewport anchor만 최근
  100개까지 memory에 보관한다.
- 다음/이전 diff·conflict, pane 전환, 검색 결과, 다른 live review 항목을 열기 직전 위치를 기록한다.
- hardware mouse Back, Windows/Linux `Alt+Left`, macOS `Ctrl+-`를 같은 command handler에 연결한다.
- 기존 Home/folder/Git 화면 복귀용 Back과 편집 위치 Back을 분리한다.
- 파일 내용, 주변 text, diff/merge result, Git 임시 path는 기록하거나 영속화하지 않는다.

수용 기준:

- A→B→C 위치를 방문한 뒤 Back을 반복하면 C→B→A 순서로 pane, cursor, viewport, focus가 복원된다.
- 복원은 text, dirty 상태, undo/redo history를 바꾸지 않는다.
- 동일·근접 cursor 이동은 합치고, 101번째 고유 위치에서 가장 오래된 위치만 제거한다.
- reload/generation 변경, 삭제, binary/symlink/submodule 등 stale/non-text target은 잘못된 파일로
  대체하지 않고 안전하게 건너뛴다.
- history가 비었을 때 mouse Back은 화면을 닫거나 dirty guard를 우회하지 않는다.
- 앱 종료 후 persistent storage, cache, log에 cursor history나 사용자 content가 남지 않는다.

필요 테스트:

- bounded pure history의 dedupe/coalesce, stale skip, replay suppression, 100개 eviction.
- 2-way left/right와 merge Result의 cursor/viewport 복원, F7/F8 이동 origin 기록.
- command registry/native menu shortcut parity와 collision 검사.
- Windows/macOS/Linux packaged app에서 실제 hardware mouse Back 전달 smoke.

후속 범위:

- history forward, app 재시작 간 위치 복원, arbitrary closed-file reopen은 별도 opt-in 이슈로 둔다.

### UX-010. Settings & Integrations 화면

사용자 가치:

- 시작 화면의 작업 선택과 앱 설정을 분리하고, 현재 적용 중인 비교/폴더/병합/통합 설정을 한곳에서 확인한다.

범위:

- General, Compare, Folder, Merge, Integrations, Privacy/About section을 가진 실제 Settings route를 제공한다.
- OS/runtime처럼 앱이 신뢰할 수 있게 아는 값은 읽기 전용으로 표시하고 중복 선택을 요구하지 않는다.
- Git tool의 OS/path manual input은 `INT-002`/`T084`의 감지 실패 fallback 또는 명시적 advanced override에만 둔다.
- 저장되는 setting schema와 reset/default, session-only override를 구분한다.

수용 기준:

- native Settings command와 shortcut이 같은 route를 열고 두 번째 실행은 중복 화면을 만들지 않는다.
- 감지 성공 시 OS 선택/path 입력이 없고 실패 시에만 행동 가능한 fallback이 보인다.
- setting 변경이 즉시 적용되는지 다음 session부터 적용되는지 각 control에서 알 수 있다.
- settings storage에 file content, clipboard text, diff/merge result, Git temporary path가 남지 않는다.

필요 테스트:

- settings route와 native command parity.
- runtime detection success/failure/dev/advanced override visibility.
- schema migration/reset와 privacy sentinel.

### UX-011. 편집 위치 앞으로 이동

사용자 가치:

- 이전 위치로 돌아간 뒤 다시 원래 검토 위치로 되돌아가며 탐색 흐름을 잃지 않는다.

범위:

- `UX-009`의 동일 memory-only history에서 forward stack과 mouse Forward command를 제공한다.
- 새 사용자 이동이 발생하면 일반적인 navigation history처럼 현재 forward branch를 폐기한다.
- keyboard binding은 OS별 기존 명령과 충돌하지 않는지 `FND-005R` keyboard map에서 확정한다.
- 앱 재시작 복원과 닫힌 파일 자동 reopen은 포함하지 않는다.

수용 기준:

- A→B→C에서 Back 두 번, Forward 두 번을 실행하면 A→B→C가 cursor/viewport/focus와 함께 복원된다.
- Back 후 새 D로 이동하면 이전 B/C forward branch를 실행할 수 없다.
- stale/non-text target은 Back과 같은 정책으로 건너뛰고 dirty/undo state를 바꾸지 않는다.
- history가 비면 mouse Forward가 화면 navigation이나 dirty guard를 우회하지 않는다.

필요 테스트:

- branch invalidation, stale skip, replay suppression pure history test.
- mouse Forward와 keyboard command packaged smoke.

### REV-001. 검토 queue와 viewed 상태

사용자 가치:

- 폴더/Git 변경 목록에서 아직 검토하지 않은 항목을 알고 다음 미검토 항목으로 빠르게 이동한다.

범위:

- folder row와 Git changed-file identity에 `unreviewed`, `in_review`, `reviewed` session state를 둔다.
- 사용자가 명시적으로 Mark reviewed/unreviewed하고 Next unreviewed command로 이동한다.
- filter/sort가 바뀌어도 identity 기준 상태를 유지하되 rescan/repository generation이 바뀌면 stale 상태를 분리한다.
- 첫 버전은 memory-only이며 파일 내용, snippet, blob id를 persistent storage에 남기지 않는다.

수용 기준:

- visible/total reviewed count와 next-unreviewed 대상이 filter 정책과 일치한다.
- 단순히 파일을 열었다는 이유만으로 자동 reviewed 처리하지 않는다.
- rename/delete/rescan/revision change에서 다른 항목에 reviewed 상태를 잘못 이식하지 않는다.
- keyboard-only로 mark와 next command를 실행할 수 있다.

필요 테스트:

- stable identity/revision generation reducer test.
- filter/sort/rescan/rename/delete stale-state fixture.
- folder/Git command parity와 200% 확대 smoke.

### OBS-001. Local diagnostic bundle

사용자 가치:

- 버그 제보 시 파일 내용 없이 필요한 환경 정보만 전달할 수 있다.

범위:

- app version, OS, command name, error code, duration bucket, file size bucket, settings summary를 export한다.
- 파일 내용, diff 결과, 전체 home path는 포함하지 않는다.

수용 기준:

- 사용자가 직접 export를 눌러야 생성된다.
- bundle preview에서 포함 정보를 볼 수 있다.
- path는 basename 또는 redacted path만 남긴다.

필요 테스트:

- no file contents.
- no home path.
- JSON schema.

## 13. 장기 별도 PRD 후보

다음 기능은 가치가 있지만 현재 Phase 1/1.x 범위와 위험이 다르므로 별도 PRD 또는 ADR 후에만 진행한다.

- 이미지 비교.
- 바이너리/hex 비교.
- ZIP/7z/archive 내부 비교.
- Office/PDF 전용 비교.
- SFTP/FTP/WebDAV/cloud remote compare.
- 데이터베이스 schema/data compare.
- 플러그인 시스템.
- 서명·checksum·rollback 검증 없이 artifact를 자동 적용하는 updater.

이 기능들은 제품 매력은 크지만, 저장 안전성, 보안 경계, 배포 정책, dependency surface가 크게 달라진다. 현재 목표인 로컬 텍스트 비교와 3-way 병합이 안정화된 뒤 결정한다.

## 14. 선택 기준

새 후보를 `docs/04_BACKLOG.md`로 승격할 때는 다음을 채운다.

```text
이슈 ID:
변경할 파일 목록:
사용자 가치:
수용 기준:
실패/경계 조건:
필요 테스트:
검증 명령:
범위 밖:
```

승격 우선순위는 다음 순서로 판단한다.

1. 데이터 손실 위험을 줄이는가?
2. 실제 OS 배포와 검증을 앞당기는가?
3. 매일 반복하는 비교/병합 시간을 줄이는가?
4. 현재 아키텍처 경계를 유지하는가?
5. 한 PR로 작게 끝낼 수 있는가?

## 15. 다음 액션

바로 개발할 후보:

1. `T076/FND-006` 현재 required CI를 복구한다.
2. `FOL-006R` 실제 progressive scan과 cancel/stale-result 계약을 닫는다.
3. `RTM-001`, `RTM-002`, `SAV-007`, `SAV-008`, `ENC-001`, `SEC-005`의 OS/저장/release 증적을 끝낸다.
4. `REL-010`에서 Git을 포함한 미검증 capability의 beta 노출 범위를 확정한다.
5. `FND-005R`, `UX-010/T084`, `UX-009`로 command/settings/navigation의 끊김을 먼저 없앤다.

그다음 `TXT-011`, `TXT-012`, `PRF-001`, `TXT-016`, `FOL-014`, `RPT-002`를 상용 일상 workflow 묶음으로 승격한다. `FOL-015/016`처럼 파일을 쓰는 기능은 report/dry-run과 rollback 계약이 준비된 뒤에만 진행한다.
