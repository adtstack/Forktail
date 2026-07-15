# 14. Product Gap Roadmap

이 문서는 `forktail`을 실제 일상 도구로 만들기 위해 Phase 1 이후 또는 Phase 1 말미에 검토할 기능 후보를 정리한다. 기존 `docs/04_BACKLOG.md`는 현재 확정된 issue-sized backlog이고, 이 문서는 그 다음에 무엇을 추가할지 고르는 후보 목록이다.

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
- regex ignore, generated header ignore, timestamp ignore 같은 규칙 기반 비교가 없다.
- moved block 감지, manual alignment, sync point가 없다.
- 폴더 include/exclude profile과 report export가 없다.
- conflict marker가 이미 들어간 단일 파일을 바로 해결하는 흐름이 없다.
- 대용량 로그/덤프는 64 MiB 제한으로 명확히 거절하지만, partial preview나 streaming diff 설계는 아직 없다.

## 3. 추천 개발 순서

아래 순서는 "좋아 보이는 기능"보다 "실사용자가 파일을 잃지 않고 매일 쓸 수 있는 순서"를 우선한다.

```text
RTM-001 → RTM-002 → SAV-007 → SAV-008 → ENC-001
→ SEC-005 → TXT-011 → TXT-012
→ TXT-013 → FOL-012 → FOL-013 → FOL-015 → RPT-002
→ MRG-012 → MRG-013 → INT-001 → PERF-004 → PERF-005
```

첫 5개는 기능 추가보다 신뢰 확보에 가깝다. 이 단계가 끝나기 전에는 큰 기능을 추가하지 않는 편이 좋다. Git 관련 통합은 개발자 편의 기능으로 분리하고, 로컬 파일 비교 도구의 기본 신뢰성과 혼동하지 않는다.

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

- 앱 안에서 Windows/macOS/Linux의 absolute executable path를 입력받아 difftool/mergetool snippet을 확인하고 복사할 수 있게 한다.
- packaged runtime은 실제 current executable을 제안한다. Linux AppImage는 임시 mount 내부 binary가 아니라 `APPIMAGE`의 stable artifact path를 사용하며, 감지 실패 시 빈 입력과 OS별 형태 예시만 보여준다.
- 실제 `.gitconfig` 자동 수정은 첫 버전에서 제외한다.
- difftool은 `$LOCAL`/`$REMOTE`, mergetool은 `$BASE`/`$LOCAL`/`$REMOTE`/`$MERGED`를 사용한다.
- added/deleted difftool side의 `/dev/null`은 빈 positional argument로 정규화한다. mergetool은 stage 1이 없어도 Git이 0-byte BASE 임시파일을 만들 수 있으므로 `base_present=false`일 때만 빈 Base slot으로 바꾸고, 실제 empty stage 1은 path를 보존한다.
- generated mergetool config에는 tool-specific `mergetool.forktail.hideResolved=false`를 포함한다.
- `%O/%A/%B/%P` custom merge driver 설정은 생성하지 않는다.

수용 기준:

- OS별 executable path 예시가 정확하다.
- difftool과 mergetool 설정을 구분한다.
- 현재 GUI lifecycle에서는 `trustExitCode = false`가 필요한 이유를 짧게 설명한다.
- generated config text가 shell로 평가된다는 점을 반영해 OS별 path 공백/quote snapshot을 검증한다.
- add/add의 missing stage 1과 실제 empty stage 1을 파일 크기가 아니라 Git의 stage-presence 신호로 구분하고, 신호가 없으면 path를 보존한다.
- `diff.tool`, `merge.tool` 같은 default 변경은 생성하지 않고 사용자가 `--tool=forktail`을 명시한다.

필요 테스트:

- generated config text snapshot.

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
- 자동 updater.

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

1. `RTM-001` 실제 Tauri runtime smoke 자동화.
2. `RTM-002` packaged WebView smoke.
3. `SAV-007` Windows atomic replace 검증.
4. `SAV-008` 저장 precondition 강화.
5. `ENC-001` legacy encoding save policy 조사와 fixture.

이 5개가 끝나면 기능 개발 속도를 올려도 된다. 그 전에는 새 기능보다 "실제로 저장해도 안전한가"를 먼저 닫는다.
