# Validation Record

검증일: 2026-06-27

이 파일은 실행한 검증과 실행하지 못한 검증을 명확히 구분한다. AI 에이전트는 이 기록만으로 미실행 검증을 통과했다고 간주하면 안 된다.

## RTM-001 Tauri runtime smoke 준비

이 섹션은 실제 Tauri 창과 packaged app에서 반복 가능한 입력으로 수동/반자동 smoke를 실행하기 위한 기록 템플릿이다. 사용자 실제 파일 내용, private path, crash dump, home directory 전체 경로를 붙여 넣지 않는다.

변경 파일:

- `package.json`
- `scripts/prepare-runtime-smoke.mjs`
- `docs/14_PRODUCT_GAP_ROADMAP.md`
- `VALIDATION.md`

수용 기준:

- 2-way compare, folder compare, 3-way merge에 사용할 fixture workspace를 반복 생성할 수 있다.
- 같은 fixture path를 `npm run tauri dev` 또는 packaged app smoke에서 사용할 수 있다.
- OS, 앱 버전, 실행 명령, 실패 지점을 기록할 위치가 있다.
- 실제 사용자 파일 내용은 기록하지 않는다.

실패/경계 조건:

- 파일 dialog 취소는 실패가 아니다.
- Tauri 시작 실패는 실행 명령과 행동 가능한 첫 오류만 기록하고 전체 로그 덤프를 붙이지 않는다.
- Monaco가 렌더링되지만 console error가 있으면 짧은 오류 이름과 영향을 받은 화면을 기록한다.
- Save/Save As 실패 시 원본 fixture 파일이 유지됐는지 확인한다.
- 자동화하기 어려운 OS gesture는 `manual-not-run`으로 남긴다.

검증 명령:

```bash
npm run smoke:runtime:prepare
npm run doctor
npm run check
npm run tauri dev
```

수동 체크리스트:

1. `npm run smoke:runtime:prepare`로 fixture를 생성한다.
2. `npm run tauri dev` 또는 packaged app을 실행한다.
3. 생성된 `two-way/left.txt`, `two-way/right.txt`를 열고 변경 hunk 탐색, 오른쪽 편집, Save As를 확인한다.
4. 생성된 `folders/left`, `folders/right`를 열고 `same`, `different`, `leftOnly`, `rightOnly`, `typeMismatch` row와 필터 count를 확인한다.
5. 생성된 `merge/base.txt`, `merge/ours.txt`, `merge/theirs.txt`를 열고 conflict 표시, resolution, Save As를 확인한다.
6. 가능한 OS에서는 native menu, native reveal, drag and drop을 확인한다.

결과 템플릿:

```text
Date:
OS:
Architecture:
forktail version:
Command:
Fixture manifest:
Build type: dev | packaged

2-way compare: pass | fail | manual-not-run
Folder compare: pass | fail | manual-not-run
3-way merge: pass | fail | manual-not-run
Save/Save As: pass | fail | manual-not-run
Native menu: pass | fail | manual-not-run
Native reveal: pass | fail | manual-not-run
Drag and drop: pass | fail | manual-not-run

Notes:
-
```

## RTM-001 Results

이 섹션은 실제 OS에서 RTM-001 runtime smoke를 실행한 결과를 기록하는 곳이다. 아래 템플릿을 각 OS별로 복사해서 채운다. 채워지지 않은 항목은 아직 해당 OS에서 smoke를 실행하지 않은 것이다.

검증 순서:

1. `npm run smoke:runtime:prepare` 로 fixture와 체크리스트를 생성한다.
2. 출력된 fixture root의 `RUNTIME_SMOKE_CHECKLIST.md`를 따라 `npm run tauri dev` 또는 packaged app에서 단계를 수행한다.
3. Save/Save As 후 `npm run smoke:runtime:verify -- <savedPath>` (또는 `--expect-changed-from <originalPath>`)로 파일이 디스크에 실제로 쓰였는지 확인한다.
4. 아래 템플릿에 결과를 기록한다.

### macOS

```text
Date:
OS:            macOS
Architecture:
forktail version:
Command:       npm run tauri dev | packaged .app
Fixture manifest:

2-way compare:    pass | fail | manual-not-run
Folder compare:   pass | fail | manual-not-run
3-way merge:      pass | fail | manual-not-run
Save/Save As:     pass | fail | manual-not-run
Backup on save:   pass | fail | manual-not-run
Native menu:      pass | fail | manual-not-run
Native reveal:    pass | fail | manual-not-run
Drag and drop:    pass | fail | manual-not-run

Notes:
-
```

### Windows (CI 검증 또는 별도 환경)

```text
Date:
OS:            Windows
Architecture:
forktail version:
Build:         NSIS .exe
Fixture manifest:

2-way compare:    pass | fail | manual-not-run
Folder compare:   pass | fail | manual-not-run
3-way merge:      pass | fail | manual-not-run
Save/Save As:     pass | fail | manual-not-run
Backup on save:   pass | fail | manual-not-run
Native menu:      pass | fail | manual-not-run
Native reveal:    pass | fail | manual-not-run
Drag and drop:    pass | fail | manual-not-run

Notes:
-
```

### Linux (CI 검증 또는 별도 환경)

```text
Date:
OS:            Linux
Architecture:
forktail version:
Build:         AppImage
Fixture manifest:

2-way compare:    pass | fail | manual-not-run
Folder compare:   pass | fail | manual-not-run
3-way merge:      pass | fail | manual-not-run
Save/Save As:     pass | fail | manual-not-run
Backup on save:   pass | fail | manual-not-run
Native menu:      pass | fail | manual-not-run
Native reveal:    pass | fail | manual-not-run
Drag and drop:    pass | fail | manual-not-run

Notes:
-
```

## 통과

프로젝트 루트에서 다음 명령을 실행했다.

```bash
npm run doctor
npm audit --audit-level=high
npm run typecheck
npm test
npm run build
npm run tauri build

cd src-tauri
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
```

결과:

- Desktop readiness doctor: Node.js 24.15.0, npm 11.12.1, rustc 1.96.0, cargo 1.96.0, rustfmt 1.9.0, cargo clippy 0.1.96, Tauri CLI executable 2.11.3, `@tauri-apps/cli` 2.11.3 확인
- npm audit high gate: `npm audit --audit-level=high` 통과
- TypeScript project build/typecheck: 통과
- Vitest: 45 test files, 251 tests 통과
- Vite production build: 통과
- Rust fmt: 통과
- Rust clippy: `cargo clippy --all-targets -- -D warnings` 통과
- Rust test: 42 tests 통과
- Tauri macOS app bundle: `npm run tauri build` 통과. Phase 1 기본 bundle target은 `app`으로 제한한다. `src-tauri/target/release/forktail`와 `src-tauri/target/release/bundle/macos/forktail.app/Contents/MacOS/forktail`는 Mach-O 64-bit arm64 실행 파일이며, `Info.plist`의 display name, executable, bundle id, version, copyright가 `forktail` 설정과 일치함
- Monaco bundle split 확인: `src/main.tsx`의 eager Monaco import를 제거하고 2-way/3-way 화면을 lazy chunk로 분리했다. 빌드 산출물 기준 초기 `index` JS chunk는 266.04 KiB, Monaco editor 본체는 lazy `language` chunk 2,577.13 KiB이며, 언어 tokenizer contribution은 언어별 작은 동적 chunk로 분리됨. JSON/CSS/HTML/TS language service worker는 별도 worker asset으로 남지만 label 요청 시 동적 import됨
- 텍스트 전용 범위 감사: 제품 문서·백로그·화면 문구에 비텍스트 비교/병합 기능 요구사항 없음
- 브라우저 실행 확인: `http://127.0.0.1:1420/`에서 시작 화면, 2-way 데모, 폴더 데모, 3-way 데모, F7 diff 탐색, F8 conflict 탐색, Alt+1 충돌 해결 단축키, 충돌 해결 동작, 충돌 해결 undo/redo, 병합 dirty 상태 표시, 저장 안 된 병합 결과 이동 확인 모달의 취소/버리고 이동 분기, 미해결 충돌 저장 확인 모달의 취소 분기, 마지막 개행 차이 경고, 비교 옵션 바 표시와 조작, 폴더 상태 필터와 수정 시각 정렬, 폴더 행 키보드 이동/Enter 열기, active conflict side diff, 시스템/다크/라이트 테마 전환 확인
- 폴더 키보드 단위 테스트: visible row 선택 index clamp, Arrow/Home/End 이동 규칙 확인
- command registry 단위 테스트: UX 명세 주요 단축키의 aria-keyshortcuts 생성, exact modifier matching, save/save-as 구분, 탐색/충돌 해결 shortcut, 중복 shortcut 없음, native menu command payload guard 확인
- 오류 계약 단위 테스트: TS `AppErrorCode`가 단일 tuple에서 파생되고, serialized command error를 우선 표시하며, 빈 command message는 code별 안내로 대체하고 raw OS/stack-shaped debug 문자열은 사용자용 fallback으로 숨기는지 확인
- 악성 입력 단위 테스트: marker flood가 뒤의 정상 conflict를 숨기지 않는지, 제어문자와 script-like 텍스트가 diff report에서 plain text로 유지되는지, malformed/non-file drop URI가 무시되는지 확인
- product identity 단위 테스트: `package.json`, Tauri productName/identifier/window title/copyright/icon list, Cargo crate/lib/authors, `index.html` title, StartPage H1이 `forktail` 기준으로 유지되고 desktop icon asset이 존재하는지 확인
- 2-way 편집 표시 렌더 테스트: 파일 heading이 편집 모드에서만 `EDITING` 배지를 표시하는지 확인
- 저장 인코딩 경고 단위/렌더 테스트: UTF-8이 아닌 입력, BOM 입력, 디코딩 손실 입력이 현재 UTF-8 저장 경로에서 경고되고 2-way/3-way 화면에 노출되는지 확인
- Tauri security config 단위 테스트: release CSP가 `csp: null`이 아니며 local worker, Tauri IPC, object blocking을 포함하고, dev-only localhost/ws 허용이 release CSP에 섞이지 않는지 확인
- Tauri capability 최소화 단위 테스트: main window만 대상으로 `core:default`, `dialog:allow-open`, `dialog:allow-save`만 허용하고, FS/shell/http/opener plugin 권한과 broad plugin dependency가 없는지 확인
- 네트워크/AI 정책 단위 테스트: 런타임 source와 package manifest에 browser/Rust network API, HTTP/updater plugin, telemetry dependency, AI SDK/API key 경로가 없는지 확인
- privacy/logging policy 단위 테스트: runtime source에 console/println/eprintln/dbg/tracing/log 호출이 없고 logging/crash-reporting dependency가 없는지 확인
- 직접 JS/Rust dependency policy 단위 테스트: `package.json`/`package-lock.json`과 `Cargo.toml`/`Cargo.lock`의 직접 dependency 목록과 lockfile 재현성을 대조하고, 직접 npm/Rust dependency license가 allowlist 안에 있는지 확인
- CI branch gate policy 단위 테스트: PR/main push에서 frontend/Rust gate가 명시적으로 실행되고 job timeout이 있으며, PR 검증 workflow가 artifact/release build를 만들지 않는지 확인
- desktop readiness doctor policy 단위 테스트: `npm run doctor`가 Node/npm/Rust/cargo/rustfmt/cargo clippy/Tauri CLI 실행 가능 여부를 확인하고 README의 실행 순서가 doctor를 먼저 안내하는지 확인
- 폴더 가상 스크롤 단위 테스트: 10,000 row visible window, spacer height, 빈 목록과 비정상 측정값 sanitize 확인
- 폴더 expand/collapse 단위 테스트: directory row 판별, tree depth, descendant collapse, nested directory collapse, directory row 자체 유지 확인
- 폴더 expand/collapse 렌더 테스트: visible child가 있는 directory row에 `aria-expanded` toggle과 접기 label이 렌더링되는지 확인
- 폴더 portable path conflict 단위 테스트: 상대 경로를 slash/NFC/`en-US` lowercase 기준 identity로 정규화하고, case-only 및 Unicode normalization-only 충돌을 감지하는지 확인
- 폴더 portable path conflict 렌더 테스트: 대소문자만 다른 경로가 있을 때 폴더 화면이 Windows/macOS 기본 파일시스템 위험 경고와 대표 경로 쌍을 표시하는지 확인
- 폴더 copy/sync dry-run 단위 테스트: 좌→우/우→좌 방향별 복사, 폴더 생성, 덮어쓰기, 차단 계획을 생성하되 target-only 삭제는 계획하지 않고, `..`/절대 경로/drive path/빈 segment는 target path 생성 전에 차단하는지 확인
- 폴더 copy/sync dry-run 렌더 테스트: 폴더 화면이 실제 파일 변경 없이 양방향 dry-run 요약을 표시하고 적용 버튼을 노출하지 않는지 확인
- 폴더 스캔 진행 상태 렌더 테스트: 스캔 중 안내, `스캔 취소` 버튼, 취소 후 늦게 도착한 결과를 반영하지 않는다는 안내 표시 확인
- 폴더 스캔 옵션 렌더 테스트: 비교 방식 select와 hidden/gitignore/symlink 토글이 현재 옵션 상태를 반영하는지 확인
- 폴더 스캔 옵션 단위 테스트: 비교 모드 변경과 hidden/gitignore/symlink 토글이 다른 옵션을 보존한 새 scan option을 만드는지 확인
- 폴더 상태 필터 접근성 렌더 테스트: 상태별 count와 표시/숨김 상태가 `aria-label`에 포함되는지 확인
- 홈 시작 동작 단축키 접근성 렌더 테스트: 파일/폴더/3-way 시작 버튼의 `aria-keyshortcuts` 확인
- 3-way 병합 접근성 렌더 테스트: merge dirty 상태 chip의 status/live/label, BASE/OURS/THEIRS source region label, result region label, 주요 save/resolution shortcut 속성 확인
- 3-way merge parser benchmark 단위 테스트: 30-conflict benchmark fixture 생성, 반복 parsing metadata 기록, expected conflict count 불일치 시 즉시 실패하는지 확인
- 접근성 색상 대비 단위 테스트: dark/light theme의 warning/status/filter/count/toast 토큰 foreground/background 조합이 WCAG AA normal text 기준 4.5:1 이상인지 확인
- 접근성 포커스 표시 단위 테스트: button/input/select/tabindex 대상 `focus-visible` outline과 shadow, 폴더 row focus ring, dark/light focus token, `outline: none` 금지 확인
- 대용량 텍스트 전략 단위 테스트: Rust `read_text_file`의 64 MiB cap, `TOO_LARGE` 오류, Architecture 문서, ADR-008의 Phase 1 streaming 제외 결정이 서로 일치하는지 확인
- 2-way 파일 version 감지 단위 테스트: 열린 파일의 size/mtime 기준선 비교, 한쪽/양쪽 변경 안내 메시지, suppression key 생성 확인
- 3-way conflict parser hardening 단위 테스트: CRLF, no-final-newline, marker-like content, malformed marker 순서, malformed outer marker가 뒤의 정상 conflict를 삼키지 않는지 확인
- 병합 저장 상태 단위 테스트: 저장 후 outputPath, clean snapshot, 저장 대상 파일 버전, 백업 경로 포함 완료 메시지 확인
- 병합 결과 draft 복구 단위 테스트: opt-in 저장소에 result draft와 경로/버전 metadata만 저장, 원본 파일 내용 별도 저장 없음, 입력 파일 version 불일치 거절, oversized draft 거절, 최대 10개 유지, draft 삭제 확인
- 병합 저장 precondition 단위 테스트: 현재 outputPath 재저장, 입력 파일 덮어쓰기, baseline 없는 Save As 경로 구분 확인
- 2-way 파일 저장 상태 단위 테스트: 현재 편집 대상 저장 precondition, 반대편 입력 경로 덮어쓰기 guard, 임의 Save As 경로, 왼쪽/오른쪽 저장 후 path/name/encoding/line ending/final newline/size/mtime 갱신 확인
- 2-way 미저장 변경 단위 테스트: 저장 스냅샷 기준 dirty 판단과 compare 전용 이탈 경고 메시지 확인
- 미저장 beforeunload guard 단위 테스트: clean 상태에서는 browser close 이벤트를 건드리지 않고, dirty compare/merge 메시지는 `preventDefault`와 빈 `returnValue`로 닫기 방지 처리하는지 확인
- 2-way diff report 단위 테스트: unified-style plain text report, 현재 비교 옵션 반영, CRLF metadata, no-final-newline marker, 기본 `.diff.txt` 저장 경로 생성 확인
- CLI 시작 인자 단위 테스트: `forktail left right`, `--compare`, `--folders`, `--merge base ours theirs [output]`, custom Git difftool의 `$LOCAL $REMOTE` 순서와 missing side slot을 뜻하는 `--difftool` parser, custom Git mergetool의 `$BASE $LOCAL $REMOTE $MERGED` 순서를 뜻하는 `--mergetool` parser, `--` separator, 경로 인자 공백 보존, 잘못된 인자 안내 확인. `%O/%A/%B/%P`는 merge driver용이므로 이 계약에 포함하지 않음
- Tauri startup command 계약 테스트: frontend bridge `startup_args` invoke, Rust command module, invoke handler wiring이 같은 command 이름을 쓰는지 확인
- native reveal command 계약 테스트: frontend bridge `reveal_path` invoke, Rust command module, invoke handler wiring, `symlink_metadata` 기반 존재 확인, shell string 미사용, broad opener/shell plugin 미사용 확인
- 2-way hunk copy 단위 테스트: 변경 line 교체, modified-only insertion 제거, original-only deletion 복원, trailing newline 없는 target 보존, reverse 방향 core 적용 확인
- 2-way Drag & Drop 단위 테스트: Tauri file path 추출, `file://` URI fallback, 경로 없는 브라우저 File 거절, 시작 화면 2파일 개수 검증, 한쪽 pane 1파일 개수 검증 확인
- 최근 세션 저장 단위 테스트: 경로·옵션·timestamp만 저장, 최대 20개, 중복 갱신, 특정 항목 제거, 깨진 storage 값 sanitize 확인
- 마지막 화면 자동 복원 단위 테스트: active session에 경로·옵션만 저장하고 파일 내용/draft text는 저장하지 않으며, clear와 malformed 값 sanitize 확인
- 홈 화면 최근 세션 실패 처리 렌더 테스트: 실패한 최근 항목 안내와 `이 항목 제거` 버튼 표시, 이미 제거된 항목에는 stale 안내를 표시하지 않는지 확인
- 설정 저장 단위 테스트: 2-way 비교 옵션과 공백 표시 옵션, 폴더 스캔 기본 옵션, 병합 auto-advance와 draft 복구 opt-in 설정, appearance theme 설정 sanitize와 persistence 확인
- 브라우저 설정 확인: 2-way 줄바꿈 옵션, 2-way 공백 표시 옵션, 병합 `해결 후 다음`, 라이트 테마 선택이 reload 또는 화면 재진입 뒤 복원되는지 확인
- 브라우저 2-way 좌우 교환 확인: `좌우 교환` 버튼으로 LEFT/RIGHT 파일명이 뒤집히고, `Control+Shift+X` 단축키로 다시 원래 순서로 돌아오는지 확인
- 브라우저 2-way 경로 복사 확인: LEFT/RIGHT heading에 `경로 복사` 버튼 2개 표시, 인앱 브라우저 권한 거절 시 전체 fallback 경로 표시와 콘솔 error 0개 확인
- 브라우저 3-way 경로 복사 확인: BASE/OURS/THEIRS heading에 `경로 복사` 버튼 3개 표시, 인앱 브라우저 권한 거절 시 fallback 경로 `demo/base.ts` 표시와 콘솔 error 0개 확인
- 브라우저 폴더 검색 확인: 폴더 데모에서 `Control+F`가 `경로 필터` 입력에 포커스를 주고, `src` 검색 시 `src/App.tsx` 한 행만 표시되며, Escape로 필터가 초기화되는지 확인
- 브라우저 테마 확인: 라이트 모드 2-way 데모에서 Monaco `vs`, 다크 모드 3-way 데모에서 Monaco `vs-dark` 렌더링 확인
- 브라우저 오류 확인: 2-way 데모와 3-way 데모 콘솔 error 0개
- 브라우저 실행 상태 확인: `http://127.0.0.1:1420/`에서 document title과 H1이 `forktail`, 시작 액션 3개, 2-way 데모 heading 2개와 경로 복사 버튼 2개, 3-way 데모 source heading 3개, 경로 복사 버튼 3개, conflict count `1 / 2 충돌`, resolution 버튼 4개, 콘솔 error 0개 확인
- 브라우저 접근성 속성 확인: 홈 시작 버튼, 2-way diff/swap 버튼, 3-way conflict/save/resolution 버튼의 `aria-keyshortcuts`, 2-way diff count와 3-way conflict count `aria-live=polite`, source/result editor region label, 콘솔 error 0개 확인
- 브라우저 command registry 확인: 홈 open shortcuts, 2-way swap/F7/save shortcuts, 폴더 `Control+F Meta+F` 검색 shortcut, 3-way conflict/undo/redo/save/resolution shortcuts가 registry 값으로 렌더링되고 콘솔 error 0개 확인
- 브라우저 CSP 설정 회귀 확인: CSP config 변경 뒤 브라우저 미리보기 홈 화면이 `forktail` H1과 시작 action 3개를 렌더링하고 콘솔 error 0개 확인
- CSS reduced motion 확인: `prefers-reduced-motion: reduce`에서 busy-bar animation 제거 규칙 확인
- CI gate 정의 확인: `.github/workflows/ci.yml`이 pull_request와 main push에서 frontend `npm ci`/`npm run typecheck`/`npm test`/`npm run build`, Rust `cargo fmt --check`/`cargo clippy --all-targets -- -D warnings`/`cargo test`를 artifact 업로드 없이 실행하도록 구성되어 있음을 확인
- 실행 준비 진단 소스 보강: `npm run doctor`를 추가해 Node.js/npm/Rust/cargo/rustfmt/cargo clippy/Tauri CLI 실행 상태를 설치 없이 점검하고, 누락 시 `npm run check`와 `npm run tauri dev` 전에 필요한 도구를 명확히 안내하도록 함
- CI branch gate 소스 보강: frontend/Rust job timeout을 추가하고, PR 검증 workflow가 artifact/release 없이 `npm ci`/typecheck/test/build와 Rust fmt/clippy/test만 실행하는지 고정하는 회귀 테스트 추가
- Native menu 소스 보강: Tauri `File`/`Edit`/`Navigate`/`Merge` menu scaffold, command id 기반 menu event emit, 프런트엔드 `forktail-command` dispatch bridge, 화면별 command event handler를 추가함. Rust 컴파일은 통과했고 실제 OS menu 클릭 smoke는 아직 수동 확인이 필요함
- Rust 오류 계약 소스 보강: `AppErrorCode` 모든 variant가 안정된 SCREAMING_SNAKE_CASE 문자열로 직렬화되는지 확인하는 Rust 테스트를 추가했고 `cargo test`에서 통과함
- 브라우저 2-way 편집 확인: 편집 대상 `읽기 전용`/`왼쪽`/`오른쪽` 선택, 저장/다른 이름 저장 버튼 상태, 저장 관련 `aria-keyshortcuts`, dirty 상태 표시, dirty 시 좌우 교환 비활성화, 이탈 확인 모달의 계속 편집/버리고 이동 분기, 버린 편집 내용이 같은 model path 재오픈 뒤 남지 않는지 확인, 콘솔 error 0개
- 브라우저 2-way 편집 표시 확인: 읽기 전용 상태에는 `EDITING` 표시가 없고, 오른쪽 편집에서는 RIGHT pane heading과 오른쪽 status bar, 왼쪽 편집에서는 LEFT pane heading과 왼쪽 status bar에 `EDITING`이 표시되며 콘솔 error 0개
- 브라우저 2-way hunk copy 확인: 읽기 전용 상태에서 양방향 hunk 적용 잠김, 오른쪽 편집에서 `왼쪽→오른쪽` 활성화와 적용 후 오른쪽 dirty/save/undo 상태 확인, undo 후 clean 상태 복귀, 왼쪽 편집에서 `오른쪽→왼쪽` 활성화와 적용 후 LEFT `EDITING`/`DIRTY`/save/undo 상태 확인, 콘솔 error 0개
- 브라우저 3-way draft 복구 확인: `draft 복구` opt-in을 켠 뒤 OURS 채택으로 dirty result draft 생성, 새 탭에서 같은 3-way 데모를 열었을 때 복구 banner와 `draft 복구`/`삭제` 버튼 표시, 복구 후 banner 제거·`저장 안 됨`·저장 버튼 활성화·성공 toast·콘솔 error 0개 확인
- 브라우저 마지막 화면 자동 복원 확인: 3-way 데모 진입 후 reload했을 때 홈이 아니라 BASE/RESULT와 `1 / 2 충돌`이 있는 merge 화면으로 복원되고 콘솔 error 0개 확인
- 브라우저 3-way 접근성 회귀 확인: reload 뒤 복원된 merge 화면에서 병합 결과 저장 상태 `aria-label` 유지와 콘솔 error 0개 확인
- 브라우저 Monaco lazy loading 회귀 확인: 홈에서 2-way 데모로 진입한 뒤 diff editor가 `calculateTotal` 내용을 렌더링하고 편집 대상 select와 변경 count가 유지되며 콘솔 error 0개 확인
- 브라우저 focus-visible CSS 회귀 확인: `http://127.0.0.1:1420/` 새로고침 뒤 dark/light focus token, control `:focus-visible` rule, folder row focus rule이 로드되고 콘솔 error 0개 확인
- 브라우저 Drag & Drop 화면 회귀 확인: 홈 화면의 시작 액션 3개와 2-way 데모의 LEFT/RIGHT heading이 정상 렌더링되고, 새 드롭 대상 class 변경 뒤에도 diff count와 버튼 상태가 유지되며 콘솔 error 0개
- 브라우저 2-way diff report 확인: `리포트 저장` 버튼 표시와 활성 상태, 브라우저 환경에서 클릭 시 Tauri 데스크톱 런타임 전용 오류 토스트 표시, 콘솔 error 0개 확인
- 저장 precondition 소스 보강: `write_text_file_atomic`에 expected size/mtime 인자를 추가하고, 불일치 시 `FILE_CHANGED`로 저장과 백업 생성을 중단하도록 Rust 테스트를 추가했고 `cargo test`에서 통과함
- 저장 인코딩 경고 소스 보강: `SAV-004` 전까지 UTF-8이 아닌 입력·BOM·디코딩 손실 입력을 저장할 때 2-way/3-way 화면에서 UTF-8 재저장 경고를 표시하도록 추가함
- 2-way 외부 변경 감지 소스 보강: `stat_text_file_version` Rust command 계약, TS bridge, size/mtime polling, `다시 읽기`/`현재 내용 유지`/`다시 확인` 배너를 추가함. command 컴파일은 통과했고 실제 파일 변경 runtime smoke는 아직 필요함
- 백업 충돌 방지 소스 보강: 기존 `.bak`을 덮어쓰지 않고 `.bak.1`, `.bak.2` 순서로 빈 백업 경로를 선택하도록 Rust 테스트를 추가했고 `cargo test`에서 통과함
- 대용량 텍스트 전략 소스 보강: `PERF-003`을 ADR-008로 확정하고, `read_text_file`이 64 MiB 초과 파일을 읽기 전에 `TOO_LARGE`로 거절하는 Rust 테스트를 추가했고 `cargo test`에서 통과함
- REL-001 아이콘 asset 생성: `src-tauri/app-icon.svg` source에서 Tauri CLI `icon` 명령으로 desktop PNG/ICO/ICNS와 platform icon set을 생성하고, `tauri.conf.json` `bundle.icon`에 desktop icon 목록을 명시함. `sips`로 `icon.png` 512x512, `32x32.png` 32x32, `128x128.png` 128x128, `128x128@2x.png` 256x256 확인, `src-tauri/icons/icon.png` 시각 확인 완료
- CLI open 소스 보강: `startup_args` Rust command와 frontend startup parser를 추가하고, 앱 부팅 시 CLI 인자가 있으면 저장된 active session보다 우선해 2-way/folder/3-way/mergetool 세션을 여는 경로를 연결함. command 컴파일은 통과했고 실제 packaged binary 인자 전달 smoke는 아직 필요함
- native reveal 소스 보강: broad opener/shell plugin 없이 `reveal_path` Rust command, frontend bridge, 폴더 상세 패널 Finder/Explorer 버튼을 추가함. macOS `open -R`, Windows `explorer.exe /select`, Linux `xdg-open` 폴더 fallback command builder 테스트는 `cargo test`에서 통과했고 실제 OS 파일 관리자 smoke는 아직 필요함
- 폴더 expand/collapse 소스 보강: flat scan 결과 위에서 directory row의 relative path prefix를 기준으로 descendants를 숨기는 UI 상태와 demo directory row를 추가함
- SEC-003 dependency policy 소스 보강: CI에 `npm audit --audit-level=high` gate를 추가하고, 직접 npm dependency/devDependency와 직접 Rust dependency/build-dependency의 lockfile 고정 및 license allowlist를 네트워크 없는 Vitest 회귀 테스트로 추가함. 전체 transitive SBOM/NOTICE와 Rust advisory triage는 공개 릴리스 전 별도 도구 검토가 필요함
- SEC-004 악성 입력 소스 보강: marker flood, 제어문자 diff report, malformed/non-file drop URI에 대한 네트워크 없는 순수 core 회귀 테스트를 추가함
- FOL-005 portable path conflict 소스 보강: 폴더 scan 결과에서 case-only/Unicode normalization-only 상대 경로 충돌을 감지하고 폴더 화면에 포터블 경로 경고를 표시하도록 추가함. 실제 OS별 파일시스템 fixture와 Rust scan 동작 검증은 Rust/Tauri 환경에서 추가 확인 필요
- FOL-011 copy/sync dry-run 소스 보강: 폴더 scan 결과에서 좌→우/우→좌 복사·폴더 생성·덮어쓰기·차단 계획을 생성하고, 실제 파일 변경 없이 UI에 요약만 표시하도록 추가함. `..`/절대 경로/drive path/빈 segment는 root escape 위험으로 차단한다. 실제 적용 기능은 별도 확인/저장 안전성 검증 뒤에만 추가한다
- FOL-006 scan cancel 소스 보강: `scan_directories`에 job id를 전달하고 `cancel_folder_scan(jobId)` Rust command를 추가함. scan/hash 루프는 취소 registry를 확인해 `CANCELLED`로 중단하며, UI는 job id를 표시하고 늦게 도착한 이전 결과를 무시한다. progressive batch append는 가상화 작업과 함께 확장한다
- FOL-007 virtual row window 소스 보강: 기존 `folderVirtualRange`/spacer row 기반 가상 스크롤에 100k 결과에서도 렌더 window가 제한되는 회귀 테스트를 추가함
- FOL-008 hash 병렬화 소스 보강: quick/full hash 비교에서 좌/우 파일 hash를 파일 쌍당 2개 worker로 병렬 계산하고, 동일 job id cancellation check를 유지하도록 Rust helper/test를 추가함
- FOL-009 scan cache 소스 보강: `path + size + modified_ms + hash_mode` key의 프로세스 내 hash cache를 추가하고, quick/full 옵션 변경 시 cache가 분리되는 Rust 테스트를 추가함
- SAV-006 backup retention/restore 소스 보강: timestamp 기반 `<파일명>.bak.<epoch_ms>` 백업, 최신 10개 retention, 백업 목록/복원 Rust command, 비교/병합 백업 복원 UI를 추가함. 복원은 같은 target의 backup만 허용하고 현재 target도 다시 backup한다
- PERF-002 Monaco lazy loading 소스 보강: 정적 language contribution import를 제거하고 감지된 언어별 동적 import로 전환했으며, JSON/CSS/HTML/TS language service worker도 label 요청 시 동적으로 로드하도록 변경함. `monacoLoading.test.ts`가 정적 language/worker import 재도입을 차단함
- UX-002 beforeunload guard 소스 보강: App의 browser close 이벤트 처리를 순수 guard 함수로 분리하고 dirty compare/merge 상태의 닫기 방지 회귀 테스트를 추가함
- MRG-011 merge parser benchmark 소스 보강: 30/100/300-conflict benchmark fixture와 반복 conflict parser benchmark helper/test, `docs/benchmarks/merge-parser-baseline.json` 로컬 latency baseline, 재측정용 `scripts/merge-parser-benchmark.mjs`를 추가함
- 네트워크/AI 정책 소스 보강: Phase 1 런타임 source와 dependency manifest에서 network API, telemetry/updater dependency, AI SDK/API key 경로를 차단하는 회귀 테스트를 추가함
- privacy/logging policy 소스 보강: Phase 1 런타임 source와 dependency manifest에서 ad hoc logging/crash-reporting dependency를 차단하는 회귀 테스트 추가
- TXT-001/FND-002 오류 UX 소스 보강: raw OS/stack-shaped debug 문자열이 UI toast에 그대로 노출되지 않도록 `errorMessage` fallback을 추가하고, 안정 error code별 행동 가능한 기본 안내를 추가함
- 브라우저 폴더 확인: 폴더 데모 table 렌더링, `aria-rowcount`, 선택 row, ArrowDown 이동, footer 선택 상태, 평상시 scan progress 미표시, 콘솔 error 0개 확인
- 브라우저 폴더 옵션 확인: 폴더 데모에서 비교 방식을 `전체 해시`로 변경하고 hidden/gitignore/symlink 옵션을 켰을 때 옵션 상태와 목록이 유지되며 콘솔 error 0개 확인
- 브라우저 폴더 상세 패널 확인: Space로 선택 항목 세부 정보 패널 열기, 양쪽 일반 파일의 `2-way 비교` 활성화, 형식 충돌 항목의 비교 버튼 비활성화와 안내 문구 확인
- 브라우저 폴더 경로 복사 확인: 상세 패널의 왼쪽/오른쪽 경로 복사 버튼과 경로 표시 확인. 인앱 브라우저 권한 정책으로 실제 클립보드 쓰기는 거절되어, 실패 시 아래 경로를 선택해 복사하라는 안내가 표시되는지 확인
- 브라우저 스크린샷: `/private/tmp/forktail-unsaved-modal.png`, `/private/tmp/forktail-unresolved-save-modal.png`, `/private/tmp/forktail-running-3way.png`, `/private/tmp/forktail-2way-edit-mode.png`, `/private/tmp/forktail-2way-report-export.png`, `/private/tmp/forktail-folder-options.png`, `/private/tmp/forktail-2way-hunk-copy.png`, `/private/tmp/forktail-2way-bidirectional-hunk-copy.png`, `/private/tmp/forktail-merge-draft-recovery.png`, `/private/tmp/forktail-active-session-restore.png`, `/private/tmp/forktail-lazy-monaco-2way.png`

## INT-002/MRG-014 Git external tool 검증

### 소스·단위 계약 (2026-07-15)

실행 결과:

- `npm run check`: typecheck 통과, frontend Vitest 54 files/351 tests와 T009 Git harness Vitest 1 file/16 tests 통과, production build 통과
- `npm run tauri -- build --bundles app`: release binary와 macOS `.app` bundle 생성 통과
- `cd src-tauri && cargo fmt --all --check`: 통과
- `cd src-tauri && cargo clippy --all-targets -- -D warnings`: 통과
- `cd src-tauri && cargo test`: 47 tests 통과
- production build의 기존 Monaco large-chunk warning은 유지되며 실패가 아니다.

- `--difftool "$LOCAL" "$REMOTE"`은 두 positional slot을 보존하고, 빈 인자와 정확한 `/dev/null`을 missing side로 분류하며 두 쪽이 모두 missing이면 거절한다.
- difftool session은 편집, Save/Save As, backup restore, hunk 적용/undo, 좌우 교환, pane drop, recent/active-session 저장을 차단한다. 별도 경로를 고르는 plain text report export와 diff 탐색은 허용한다.
- `--mergetool "$BASE" "$LOCAL" "$REMOTE" "$MERGED"`은 missing Base를 허용하고 기존 `$MERGED`를 초기 Result이자 유일한 저장 대상으로 사용한다. generated wrapper는 stage 1 없는 add/add의 0-byte Git temp를 `base_present=false`로 구분해 빈 Base slot으로 바꾸며, 실제 empty stage 1과 signal 부재 시에는 path를 보존한다. unresolved Result의 저장은 hard block한다.
- config generator는 다음 absolute executable path 형태를 입력으로 받으며 path의 공백, Unicode, apostrophe와 Git config/shell의 이중 quoting을 Windows/macOS/Linux snapshot으로 검증한다.

| OS | 대표 packaged executable path |
|---|---|
| Windows | `C:\Users\<사용자>\AppData\Local\forktail\forktail.exe` 형태; packaged runtime에서 actual `current_exe` 사용 |
| macOS | `/Applications/forktail.app/Contents/MacOS/forktail` |
| Linux | `/home/<사용자>/Applications/forktail.AppImage` 같은 사용자 지정 stable path; runtime에서 `APPIMAGE` 사용 |

- 생성 결과는 tool-specific `[difftool "forktail"]`, `[mergetool "forktail"]` section만 제공한다. `.gitconfig`를 자동 수정하거나 `diff.tool`/`merge.tool` 기본값을 바꾸지 않는다.
- mergetool snippet은 `trustExitCode = false`, `hideResolved = false`를 고정한다. GUI 종료 code가 저장 성공을 신뢰성 있게 전달하지 않으므로 사용자는 `git mergetool --tool=forktail`의 후속 확인 흐름을 사용한다.
- `%O/%A/%B/%P` custom merge driver와 자동 `git add`/continue는 생성하거나 실행하지 않는다.
- packaged external-tool argv의 상대 경로는 Rust startup command 경계에서 Git이 Forktail을 실행한 working directory 기준 absolute path로 변환한다. command flag, 빈 missing-Base slot, `/dev/null`, 기존 absolute path는 보존한다. 따라서 Git이 전달한 상대 `$MERGED`를 read한 뒤에도 safe-save path 검증을 통과한다.
- **Close Forktail**은 window 객체만 닫지 않고 전용 Rust command로 app process를 exit한다. macOS에서 마지막 window close 뒤 event loop가 남아 Git이 무기한 기다리는 경로를 막는다.

### T009 INT-002/MRG-014 Git external tool 검증

아래 표의 `pending`은 미실행이며 통과를 뜻하지 않는다. 각 행은 release artifact와 격리된 repository-local Git config로 difftool wait/temp/added/deleted/read-only/launch-failure/crash, mergetool missing-Base/real-empty-Base/save/no-save/unresolved/external-change-race/temp/wait, 해당 OS 전용 path/lock/runtime gate를 모두 확인해야 `pass`로 바꾼다.

| OS | Artifact | Git version | Difftool | Mergetool | Evidence |
|---|---|---|---|---|---|
| Windows | installed `.exe` | pending | pending | pending | 사용자 실행 예정 |
| macOS | release `.app` 0.2.2 arm64, executable SHA-256 `e9a317a84c3a31e3cec1c1c3b197c9072425b8d500442f77592942b8b2019ddd` | 2.50.1 (Apple Git-155) | pending | pass | 2026-07-15 schema 2 packaged UI/harness 실행; difftool report export만 manual-not-run |
| Linux | AppImage/지원 binary | pending | pending | pending | 사용자 실행 예정 |

#### T009 격리 fixture/verifier 하네스 — 2026-07-15

- `scripts/git-tool-smoke.mjs`는 fixture root를 만들기 전에 Git 2.45.0 이상을 확인하고 공백, apostrophe, Unicode가 포함된 임시 root에 파일명 자체도 세 문자를 포함하는 A/D/M difftool repository, modify/modify conflict, stage 1 없는 add/add, 실제 empty stage-1 blob conflict를 생성한다. HOME/XDG/global config는 비어 있는 임시 경로로 격리하고 system config, system attributes, optional lock refresh, credential prompt는 비활성화하며 실제 remote는 사용하지 않는다. inherited `GIT_*` 변수는 Windows 대소문자 차이까지 제거한다. setup 도중 실패하면 하네스가 새로 만든 root를 제거한다.
- config install은 Git tool setup에서 복사한 정확한 `difftool.forktail.*`/`mergetool.forktail.*` 네 key만 허용한다. 네 repository의 금지 default, non-tool config, tool key cardinality를 모두 먼저 검사한 뒤 repo-local key를 설치한다. macOS filesystem/Git의 NFC·NFD 정규화 차이를 고려해 Git이 실제 설치·재조회한 네 value가 모든 repository에서 같은지 확인하고, 그 installed value hash와 각 `.git/config` 전체 bytes hash를 root 안의 일회성 receipt에 고정한다.
- manifest 전체 hash는 생성 직후 root 안의 provenance marker에 봉인된다. verifier는 이 sealed baseline을 기준으로 HEAD object와 symbolic/detached/merge operation state, refs, tracked file hash/size/mtime/permission, index bytes/mtime/stages/mode/object/flags와 `.lock`, exact tool config/receipt, Result fingerprint, 모든 regular non-symlink Forktail backup의 원본 일치, external-writer fingerprint receipt, unexpected sidecar와 mergetool repo-local temp residue를 checkpoint별로 검사한다. no-save/unresolved Result는 실제 Git wrapper가 바꿀 수 있는 mtime을 제외하고 hash/size/permission을 비교하며 external capture 이후에는 mtime까지 고정한다. `.orig`는 post-confirm에서만 허용하고 존재하면 원본 Result hash와 일치해야 한다.
- install/run/capture/verify는 현재 Git version이 manifest에 기록된 지원 version과 같은지 다시 확인하고, run 직전 exact receipt와 네 tool config single-value/false 계약 및 금지 default를 검증한다. manifest는 정확한 네 repository key와 full object ID revision만 허용하고 filesystem identity를 사용해 NFC/NFD manifest alias를 받아들이되 fixture root 밖 HOME/XDG/config/receipt/repository, 중복 repository, remapped Result, revision option injection, symlink/non-empty global config를 거절한다. cleanup은 별도 sealed provenance/root 검증만 사용하므로 index 같은 mutable fixture state가 손상돼도 disposable root를 제거한다.
- 외부 MERGED 변경과 Save race는 second writer 변경 직후 `smoke:git-tools:capture-external`로 Result hash/size/mtime/permission을 일회성 receipt에 기록한다. 그 뒤 verifier가 receipt와 다른 Result, backup/index/config/Git-state 변경을 거절한다.
- `npm run test:git-tools`: Vitest 1 file/16 tests 통과. 추가된 macOS test는 NFD executable 입력과 Git이 재조회한 NFC-equivalent installed value가 달라도 receipt가 실제 installed bytes를 봉인하고 pristine verifier가 통과하는지 확인한다. `npm run check`와 `.github/workflows/ci.yml`은 일반 frontend test와 process 경합하지 않도록 이 suite를 별도 직렬 gate로 실행하고, watch suite에서는 제외한다. CI source는 Ubuntu frontend job과 별도 Windows 2022 job에서 실행하며 macOS NFC/NFD 분기는 이 로컬 macOS 실행으로 확인했다. GitHub Actions hosted runner에서의 실제 workflow 실행은 아직 확인하지 않았다.
- 이 하네스는 repository/process 불변식과 실행 순서용 checklist를 제공하지만 packaged UI를 실행하지 않는다. 자동 test의 save lifecycle은 Result/backup/index 전환을 모사해 verifier를 검증하는 것이며 실제 Forktail Save 증거가 아니다.
- HOME/XDG 격리는 native platform known-folder API가 만드는 모든 app/WebView state를 fixture 안에 가둔다는 보장이 아니다. 실제 packaged UI evidence는 disposable OS account/VM/profile에서 다시 실행한다.
- cleanup 전에 sanitized summary와 artifact identity를 이 문서에 전사한다. manifest/provenance 자체가 손상돼 CLI cleanup이 거절되면 준비 시 기록한 exact disposable root를 독립 확인해 수동 폐기하고 그 근거를 남긴다.
- 현재 하네스 manifest schema는 2다. 아래 macOS 결과는 schema 2 primary fixture와 사례별 disposable failure/race fixture로 다시 수집했다. Linux minimum glibc 결정은 `REL-004` 범위이며 T009는 실제 실행 환경만 기록한다.

#### macOS packaged UI/harness 실행 — 2026-07-15

- 환경: macOS 26.4.1 arm64, Git 2.50.1 (Apple Git-155), Forktail 0.2.2 release `.app`, executable SHA-256 `e9a317a84c3a31e3cec1c1c3b197c9072425b8d500442f77592942b8b2019ddd`. 임시 HOME, global/system config 비활성화, repository-local tool config를 사용했다. 전체 `.app`을 공백, apostrophe, Unicode가 포함된 staging 경로에 복사하고 그 내부 actual executable을 사용했다. 내부 executable만 bundle 밖으로 복사하는 형태는 macOS bundle/WebView context를 잃으므로 evidence로 사용하지 않았다.
- Artifact/config/NFC-NFD: packaged **Git tool setup**이 생성한 두 section만 설치했고 default tool은 만들지 않았다. UI가 반환한 NFD path와 Git config 재조회 값의 NFC-equivalent 차이는 installed-value receipt로 봉인됐다. 이 설정이 실제 staged `.app` executable을 launch하고 wait했으며 artifact hash가 source bundle과 일치했다.
- Difftool process/temp/UI: 한 `git difftool` 호출이 added → deleted → modified 순서로 서로 겹치지 않게 실행됐다. added는 missing LOCAL, deleted는 missing REMOTE, modified는 두 문서를 표시했다. 각 Git temp는 해당 창이 열린 동안 존재했고 Close Forktail 뒤 제거됐으며 다음 process가 그 뒤에만 시작됐다. 두 pane drop과 edit/Save/Save As/hunk/swap/backup은 disabled/read-only였고 Export와 diff navigation은 enabled였다. F7/Shift+F7 trusted key input 뒤 1/1 hunk UI가 정상 유지됐다. 마지막 종료 뒤 Git exit 0과 `difftool-pristine` verifier가 통과했다.
- Difftool failure: 별도 fixture에서 executable mode를 `0755 → 0644`로 바꾸면 launch가 Git exit 128로 실패했다. 즉시 mode와 같은 artifact SHA-256을 복원한 뒤 `difftool-pristine`이 통과했다. 다른 별도 fixture에서는 실행 중 확인한 Forktail PID 하나만 SIGKILL했고 Git exit 128, 관찰 temp 제거, `difftool-pristine` 통과를 확인했다. content-bearing crash dump는 수집하지 않았다.
- Mergetool unresolved/no-save: modify/modify Result에 marker가 남은 동안 Save가 disabled였고 `mergetool-unresolved-blocked`가 통과했다. 저장 없이 Close한 뒤 Git unchanged 질문에 `n`을 답해 exit 1이었으며 `mergetool-no-save`가 Result/index/backup/temp 불변을 확인했다.
- Mergetool safe-save: 모든 conflict를 OURS로 해결한 뒤 Save했다. 앱이 열린 동안 `mergetool-save-during-app`이 MERGED-only 변경, 원본과 일치하는 Forktail backup, unmerged index 유지, Git wait/temp 유지를 확인했다. Close Forktail 뒤 Git은 질문 없이 exit 0으로 stage했고 `mergetool-save-post-confirm`이 stage-0 object/mode와 Result 일치, 다른 index/refs 불변, backup 및 temp/sidecar 계약을 확인했다. 이 과정에서 Git이 전달한 상대 `$MERGED`가 저장 경계에서 거절되던 결함을 재현해 startup path absolute 변환을 추가한 뒤 같은 packaged 시나리오로 재검증했다.
- Mergetool Base 경계: add/add는 UI에 `BASE (missing)`으로, 실제 empty stage-1 blob은 존재하는 0-byte BASE path와 `Empty` 문서로 표시됐다. 두 실행 모두 Save 없이 exit 1 후 각각 `mergetool-missing-base-no-save`, `mergetool-empty-base-no-save`가 통과했다.
- Mergetool external race: 새 disposable fixture에서 second writer가 MERGED를 변경한 뒤 일회성 capture가 통과했다. Forktail Save는 “The file changed after it was opened. Reload or save as a copy.”로 실패했고 `mergetool-external-change-blocked`가 writer bytes/metadata 유지, Forktail backup 없음, index/stage/continue 없음과 Git wait를 확인했다. Forktail 종료 뒤 Git이 더 새로운 external-writer 파일을 stage한 동작은 Forktail 저장과 분리 기록하고 fixture를 폐기했다.
- Manual-not-run: native save dialog에서 difftool report의 명시적 output path를 최종 확정하는 조작은 이 자동화 환경에서 완료하지 못했다. Export button 활성화와 Git temp path 재사용 금지 source/unit 계약으로 이를 대체하지 않으므로 macOS Difftool cell은 `pending`이다.
- 판정: macOS Mergetool은 `pass`, Difftool은 report export 한 사례 때문에 `pending`이다. Windows/Linux는 사용자가 직접 실행하기로 한 항목이며 표에서 `pending`을 유지한다. 따라서 T009 task checkbox는 아직 완료로 바꾸지 않는다.

## Repository-aware Git snapshot integration

### GIT-001 production runner — 2026-07-15

- production Rust API는 현재 typed `Version` operation만 노출하고, exact safe global argv prefix 외의 subcommand/option 조합은 spawn 전에 거절한다. frontend/Tauri command에는 executable, argv, environment를 받는 generic IPC를 추가하지 않았다.
- child는 shell 없이 absolute regular executable과 argv 배열로 실행한다. inherited environment를 clear한 뒤 OS home/boot/temp/locale allowlist와 `GIT_TERMINAL_PROMPT=0`, `GIT_OPTIONAL_LOCKS=0`, `GIT_NO_LAZY_FETCH=1`, `GIT_LITERAL_PATHSPECS=1`, `GIT_PAGER=cat`만 구성한다. PATH, repository/index/object/config, SSH/askpass, trace, external-diff override는 상속하지 않는다.
- stdout/stderr는 별도 thread로 동시에 drain하고 각각 독립 byte cap을 적용한다. timeout/cancel/cap은 child와 process tree를 종료하고 wait한다. Unix는 spawn 전 전용 process group, Windows source는 kill-on-job-close Job Object를 사용하며 다른 platform은 child kill로 fail closed한다. arbitrary fixture process helper는 `cfg(test)` module에만 존재한다.
- fake-process test는 양 stream 각 128 KiB 동시 출력, stdout/stderr 개별 cap, 100 ms timeout, 1초 이내 cancel acknowledgement, forbidden/unknown operation 사전 거절, unsafe environment 제거, Unix descendant process-group 종료를 확인했다. helper test도 skip 없이 실행된다.
- 검증: `cd src-tauri && cargo test` 60 tests 통과, `cargo clippy --all-targets -- -D warnings` 통과, `cargo fmt --check` 통과. Windows Job Object runtime은 사용자 Windows 실행에서 확인할 항목이다.

### GIT-002 stable error and DTO contract — 2026-07-15

- 변경 파일: `src-tauri/src/error.rs`, `src-tauri/src/domain/git.rs`, `src-tauri/src/domain/mod.rs`, `src-tauri/src/lib.rs`, `src/core/models.ts`, `src/core/errors.ts`, `src/core/i18n.ts`, `src/core/gitModels.ts`와 양쪽 계약 테스트, Git 계약 문서, task 상태를 갱신했다.
- 수용 기준: Git runner 실패를 안정된 `{ code, message }`로 변환하고 `GIT_COMMAND_FAILED`를 unknown process/parse 실패의 명시적 fallback으로 확정했다. 프런트엔드는 알려진 Git code의 backend message를 표시하지 않으며 미래의 알 수 없는 `GIT_*` code도 일반 행동 안내로 축약한다. SHA-1/SHA-256/unknown object algorithm, full hex object ID, session-scoped opaque/display/exact UTF-8 path, unborn/detached/branch HEAD와 repository summary가 Rust/TypeScript camelCase DTO로 일치한다. canonical root/git-dir/common-dir identity와 원본 path byte는 frontend DTO에 노출하지 않는다.
- 실패/경계: known object format의 잘못된 길이, non-hex ID, unknown format의 빈 문자열·홀수 길이를 `Result`/serde 오류로 반환하고 panic하지 않는다. non-UTF-8 path는 안전한 display path와 `utf8Path: null`을 유지한다. raw stderr/stdout/argv와 runner stream 정보는 user message에 포함하지 않는다. conflict 저장 완료 copy는 Result 파일만 저장하고 `git add`/continue를 실행하지 않았음을 한·영 계약으로 고정했다.
- 테스트 선행 증거: 구현 전 `npm test -- src/core/errors.test.ts src/core/gitModels.test.ts`는 error code/message/DTO serializer 4건이 실패했고, `cargo test git`은 미정의 Git error/DTO 26건의 compile error로 실패했다. 추가 경계 테스트도 구현 전 unknown Git code raw message 노출과 invalid object ID deserialize 허용을 각각 재현했다.
- 검증: `npm run check` 통과 — typecheck, frontend Vitest 55 files/358 tests, Git-tool harness 1 file/16 tests, production build. `cd src-tauri && cargo fmt --all --check` 통과, `cargo clippy --all-targets -- -D warnings` 통과, `cargo test` 67 tests 통과/0 ignored.

### GIT-003 executable discovery and capability gate — 2026-07-15

- 변경 파일: `src-tauri/src/git/executable.rs`, `src-tauri/src/git/mod.rs`, `src-tauri/src/commands/git.rs`, `src-tauri/src/commands/mod.rs`, `src-tauri/src/lib.rs`, Git command contract와 task/검증 기록을 갱신했다.
- 수용 기준: configured executable은 absolute path만 받고 실패 시 PATH로 fallback하지 않는다. 기본 discovery는 앱 PATH의 absolute directory만 순서대로 검사하며 Windows는 `git.exe`, macOS/Linux는 `git` 후보만 만든다. 후보는 canonical regular executable로 확인하고 Unix execute bit를 검사한다. canonical path, parsed version, production runner는 `ValidatedGitExecutable` 한 객체에 고정된다. frontend command는 경로/argv를 받거나 canonical executable path를 반환하지 않는다.
- capability gate: production runner의 safe-global `version` operation이 성공하고 parse한 semantic version이 2.45.0 이상일 때만 runtime을 반환한다. Apple/Windows/release-candidate vendor suffix는 숫자 3개 뒤에서만 허용하며 malformed/multi-line/non-UTF-8 output, 구버전, non-zero capability probe는 `GIT_VERSION_UNSUPPORTED`로 fail closed한다. stderr는 parse하거나 사용자 메시지에 포함하지 않는다.
- 실패/경계: missing/relative configured path, directory, non-executable file, relative PATH entry, 공백·Unicode directory, PATH 후보 우선순위, 이후 search input과 무관한 owned selection, old/malformed/failed version probe를 테스트했다. discovery/version/runner 오류는 `GIT_NOT_FOUND`, `GIT_VERSION_UNSUPPORTED`, timeout/cancel/output-cap/generic Git code로 안정적으로 변환한다.
- 테스트 선행 증거: 구현 전 `cargo test executable`은 executable/version/discovery API 미정의 compile error로 실패했다. 구현 후 Windows/macOS/Linux candidate와 fake version/capability fixture가 통과했다.
- 검증: `npm run check` 통과 — typecheck, frontend Vitest 55 files/358 tests, Git-tool harness 1 file/16 tests, production build. `cd src-tauri && cargo fmt --all --check` 통과, `cargo clippy --all-targets -- -D warnings` 통과, `cargo test` 75 tests 통과/0 ignored. macOS 실제 probe는 `/usr/bin/git`의 safe-global invocation에서 `git version 2.50.1 (Apple Git-155)`로 통과했다. Windows/Linux packaged Git probe는 사용자가 실행할 항목으로 남긴다.

### GIT-004 repository identity and session lifecycle — 2026-07-15

- 변경 파일: `src-tauri/src/git/repository.rs`, `src-tauri/src/git/runner.rs`, `src-tauri/src/git/mod.rs`, `src-tauri/src/commands/git.rs`, `src-tauri/src/domain/git.rs`, `src-tauri/src/lib.rs`, Git command contract와 task/검증 기록을 갱신했다.
- 수용 기준: absolute directory candidate에서 typed allowlist로 bare 여부, canonical worktree root, absolute worktree Git dir, common Git dir, shallow state, storage object format, immutable HEAD commit, symbolic HEAD를 조회한다. linked worktree는 Git dir/common dir identity 차이로 분류하고 branch/detached/unborn과 SHA-1/SHA-256 full object ID를 반환한다. canonical root/git-dir/common-dir, executable과 runner는 backend session에만 남고 frontend에는 display-safe root와 typed summary만 직렬화한다.
- session lifecycle: 앱은 한 active repository session을 관리한다. 새 open은 이전 opaque session ID를 무효화하고, stale close는 새 session을 닫지 않으며 close는 idempotent하다. session은 검증된 executable path와 production runner를 함께 소유해 PATH 변경과 다른 repository handle 재사용을 막는다.
- 실패/경계: relative/missing/deleted/non-directory/final-symlink candidate는 `GIT_PATH_UNSUPPORTED`, non-repository는 `GIT_NOT_REPOSITORY`, `safe.directory` token이 있는 dubious ownership 실패는 raw stderr를 노출하지 않고 `GIT_UNSAFE_REPOSITORY`, bare는 `GIT_BARE_UNSUPPORTED`로 변환한다. unknown object format은 typed `unknown`으로 보존하고 malformed/truncated metadata와 HEAD는 generic stable Git failure로 축약한다. `safe.directory=*` 우회나 config mutation은 추가하지 않았다.
- 테스트: 격리 HOME/config를 쓰는 `cfg(test)` mutation helper로 space/Unicode temp repository를 생성했다. root와 nested open, normal branch, linked worktree+detached HEAD, unborn, SHA-256 64자리 ID, non-repo, bare, deleted candidate, Unix picker symlink, unsafe classifier, shallow/unknown-format parser, active-session replacement/close를 검증했다. normal open 전후 `.git/HEAD`, config, index, branch ref bytes와 mtime이 모두 동일했다. fixture Git mutation은 production operation/type과 분리했고 통합 fixture는 직렬화해 process-tree timeout 테스트의 startup budget과 경합하지 않게 했다.
- 테스트 선행 증거: 구현 전 `cargo test repository`는 repository error/session/classifier API 미정의 compile error로 실패했다. 구현 후 focused repository 테스트와 전체 suite가 통과했다.
- 검증: `npm run check` 통과 — typecheck, frontend Vitest 55 files/358 tests, Git-tool harness 1 file/16 tests, production build. `cd src-tauri && cargo fmt --all --check` 통과, `cargo clippy --all-targets -- -D warnings` 통과, `cargo test` 84 tests 통과/0 ignored. 실제 temp repository 통합 테스트는 macOS Git 2.50.1에서 수행했으며 Windows/Linux repository fixture 실행은 사용자가 확인할 항목으로 남긴다.

### GIT-005 byte/NUL parser and path identity — 2026-07-15

- 변경 파일: `src-tauri/src/git/parsers.rs`, `src-tauri/src/git/mod.rs`, `src-tauri/src/domain/git.rs`, `src-tauri/src/git/repository.rs`, `specs/001-git-snapshot-integration/tasks.md`, `VALIDATION.md`.
- 수용 기준: NUL-delimited byte output을 UTF-8 변환 없이 field slice로 보존하고 empty input은 빈 record set으로 처리한다. missing final NUL, empty field, invalid field count, input/field/record/record-count cap 초과를 서로 다른 typed error로 거절한다. repository session은 원본 path byte를 Rust-only registry에 소유하고 session scope와 refresh generation이 포함된 opaque ID만 frontend DTO에 제공한다. display path는 tab/newline/backslash/control/non-UTF-8 byte를 안전하게 escape하며 lookup key로 사용할 수 없다.
- 실패/경계 조건: duplicate opaque ID, stale generation, unknown/display ID lookup, empty/NUL path를 거절한다. Unix lookup은 원본 byte를 그대로 반환하고 Windows에서는 exact UTF-8 변환이 불가능한 path를 명시적 unsupported error로 반환한다. generation과 ID counter overflow는 typed error로 종료한다.
- 테스트 선행 증거: 구현 전 `cargo test parsers`는 `GitParseError`, `NulParseLimits`, `parse_nul_records`, `GitPathRegistry` API가 정의되지 않아 compile error로 실패했다. 구현 후 공백/tab/newline/control/non-UTF-8 byte 보존, truncated/extra/huge record, duplicate ID, session scope, refresh invalidation, Unix/Windows 변환 정책 6 tests가 통과했다.
- 검증: `npm run check` 통과 — typecheck, frontend Vitest 55 files/358 tests, Git-tool harness 1 file/16 tests, production build. `cd src-tauri && cargo fmt --all --check` 통과, `cargo clippy --all-targets -- -D warnings` 통과, `cargo test` 90 tests 통과/0 ignored. Windows/Linux runtime path 변환 smoke는 사용자 확인 항목으로 남긴다.

### GIT-101 immutable revision resolver — 2026-07-15

- 변경 파일: `src-tauri/src/git/revision.rs`, `src-tauri/src/git/runner.rs`, `src-tauri/src/git/repository.rs`, `src-tauri/src/git/mod.rs`, `src-tauri/src/commands/git.rs`, `src-tauri/src/domain/git.rs`, `src-tauri/src/lib.rs`, `src/core/gitModels.ts`, `src/core/gitModels.test.ts`, `specs/001-git-snapshot-integration/tasks.md`, `VALIDATION.md`.
- 수용 기준: `HEAD`, branch, tag, full/unique abbreviated object ID와 revision expression을 `rev-parse --verify --end-of-options <revision>^{commit}`로 full commit ID에 고정한다. short ref는 heads/tags/remote-tracking의 exact full-name 후보를 먼저 비교하고 hexadecimal input은 `--disambiguate` 결과를 먼저 비교해 localized stderr 없이 ambiguity를 판정한다. production runner는 세 typed read query만 추가하고 revision stdout을 64 KiB로 제한한다.
- 실패/경계 조건: empty/leading-dash/whitespace/control/1 KiB 초과 input, malformed/truncated output, tag-to-blob, unborn/invalid revision을 invalid로 거절한다. local object 후보가 없는 hex input은 자동 fetch 없이 `GIT_OBJECT_MISSING_LOCAL`, 여러 short ref/object 후보는 `GIT_AMBIGUOUS_REVISION`, parser/runner 실패는 raw stderr·argv·후보를 노출하지 않는 stable error로 변환한다.
- 테스트 선행 증거: 구현 전 `cargo test revision`은 `GitRevisionError`, `GitRevisionKind`, resolver와 `RevisionQuery`가 정의되지 않아 compile error로 실패했다. 구현 후 fake query의 structural ambiguity/output parser와 실제 temp repository의 detached HEAD, branch/tag, full/abbrev ID, `HEAD~1`, short-name collision, blob tag, invalid/unborn, repository fingerprint 불변 테스트가 통과했다.
- 검증: `npm run check` 통과 — typecheck, frontend Vitest 55 files/359 tests, Git-tool harness 1 file/16 tests, production build. `cd src-tauri && cargo fmt --all --check` 통과, `cargo clippy --all-targets -- -D warnings` 통과, `cargo test` 99 tests 통과/0 ignored. 실제 temp repository 통합 테스트는 macOS Git 2.50.1에서 수행했으며 Windows/Linux 실행은 사용자 확인 항목으로 남긴다.

## 관찰된 경고

- Monaco editor 본체와 language service worker asset은 여전히 크지만 lazy chunk와 on-demand worker asset으로 분리되어 초기 앱 shell JS chunk에서는 빠졌다.
- `npm audit --audit-level=high`는 통과했다. 현재 Monaco 전이 DOMPurify advisory로 low 1건, moderate 1건이 보고되지만 high gate 대상은 아니며, `npm audit fix --force`는 Monaco downgrade/breaking change를 제안해 적용하지 않았다.
- 로컬 npm 캐시 권한 문제를 피하기 위해 작업공간 내부 `.npm-cache`를 사용했다. 이 디렉터리는 `.gitignore`에 포함한다.
- 브라우저 자동화에서 Meta/Ctrl+S는 브라우저 자체 저장 단축키와 충돌할 수 있어 직접 검증하지 않았다. 앱 코드의 저장 단축키 경로는 TypeScript build 범위에서 검증했다.
- `npm run tauri dev -- --no-watch --no-dev-server-wait`는 sandbox 안에서 처음 실행했을 때 Vite dev server의 `::1:1420` listen이 `EPERM`으로 막혔다. 로컬 포트 바인딩과 데스크톱 앱 실행을 위해 권한 상승으로 재실행했고, Vite dev server와 `target/debug/forktail` 실행까지 확인했다.
- DMG bundling은 `REL-003` 후속으로 남겼다. 이전 `targets: all` 설정에서는 release binary와 macOS `.app` 생성 뒤 DMG 단계에서 `bundle_dmg.sh` 실패가 관찰되어, Phase 1 기본 bundle target을 `app`으로 제한했다.

## 이 실행 환경에서 미검증

다음 검증은 아직 남아 있다.

- DMG 생성은 `REL-003` 후속이다. 현재 기본 `npm run tauri build`는 macOS `.app` bundle까지만 만든다.
- `FOL-004` hidden/gitignore/symlink/compare mode 옵션의 실제 Rust traversal 반영은 command 컴파일과 TS 옵션 계약까지 확인했다. 실제 폴더 fixture를 Tauri runtime에서 열어보는 OS smoke는 아직 필요하다.
- GitHub Actions hosted runner에서 `.github/workflows/ci.yml`을 실제로 실행하지는 않았다. Rust/Linux dependency 설치와 CI cache 동작은 첫 PR에서 확인해야 한다.
- FND-005 Native menu는 Rust source와 프런트엔드 event bridge, 컴파일까지 확인했다. 실제 OS menu 항목 클릭이 `forktail-menu-command` 이벤트를 보내고 현재 화면 command로 동작하는지는 수동 smoke가 필요하다.
- `SEC-001` release CSP와 dev CSP를 설정하고 TS config 테스트 및 `npm run tauri build`는 통과했지만, 실제 packaged release WebView에서 Monaco local worker와 IPC가 release CSP 아래 정상 동작하는지는 앱 실행 smoke로 확인해야 한다.
- `SEC-002` capability 최소화는 config/dependency 단위 테스트와 `npm run tauri build`로 확인했지만, 실제 generated permission schema와 OS별 권한 적용은 릴리스 환경에서 확인해야 한다.
- `TXT-005` 2-way 외부 변경 감지용 `stat_text_file_version` command는 컴파일됐다. 실제 외부 editor로 파일을 변경한 뒤 banner 동작을 보는 smoke는 아직 필요하다.
- `REL-001` 이름·bundle id·copyright·icon asset은 source/test와 macOS `.app` `Info.plist`로 확인했다. DMG metadata는 `REL-003`에서 확인한다.
- `TXT-010` diff report 실제 파일 저장은 Tauri file dialog와 `write_text_file_atomic` runtime이 필요해 브라우저에서 버튼/오류 경로와 순수 report 생성까지만 확인했다.
- `TXT-007` 양방향 hunk copy는 브라우저에서 좌/우 편집 대상 전환, `왼쪽→오른쪽`/`오른쪽→왼쪽` 적용, 마지막 적용 undo, dirty/save 상태까지 확인했다. 실제 Tauri file dialog를 통한 좌/우 Save/Save As 파일 쓰기는 Rust/Tauri runtime에서 추가 smoke가 필요하다.
- `TXT-008` Drag & Drop은 브라우저 자동화가 OS 파일 경로를 담은 실제 file-drop 이벤트를 만들 수 없어 순수 경로 추출/개수 검증과 화면 회귀까지만 확인했다. 실제 Tauri WebView에서 파일 2개 drop 및 한쪽 pane 1파일 drop으로 `read_text_file` command가 호출되는지는 `npm run tauri dev`에서 수동/자동 smoke가 필요하다.
- `TXT-009`/`MRG-009`/`MRG-014`/`INT-002` CLI open은 parser, session capability, Tauri command wiring, config quote snapshot을 확인했다. macOS packaged Git tool은 위 T009 절의 실제 pane/read-only/missing, wait/temp, mergetool save/no-save/unresolved/external race/Base 경계, launch/forced-exit까지 확인했다. 남은 항목은 native dialog를 통한 difftool report export, Windows/Linux 전체 lifecycle, 일반 `forktail left right`/`forktail --merge ...` OS smoke다. `%O/%A/%B/%P` custom merge driver는 현재 범위가 아니다.
- `UX-006` native reveal은 source/contract test로만 확인했다. 실제 Finder/Explorer/file manager가 선택 항목 또는 폴더를 여는지는 `npm run tauri dev` 가능한 OS별 환경에서 smoke가 필요하다.
- `MRG-010` opt-in draft recovery는 브라우저 localStorage와 새 탭 재진입으로 확인했다. 실제 데스크톱 앱 crash 후 WebView storage 유지, 큰 draft 한도 안내, OS별 storage persistence는 `npm run tauri dev` 환경에서 추가 smoke가 필요하다.
- 마지막 화면 자동 복원은 브라우저 데모 세션 reload와 active session 저장소 단위 테스트로 확인했다. 실제 사용자 파일 경로의 자동 재열기와 폴더 rescan은 Tauri runtime에서 `read_text_file`/`scan_directories`를 통한 추가 smoke가 필요하다.
- Linux Tauri용 WebKitGTK 4.1 개발 패키지는 macOS 로컬 실행에서는 해당 없음. Linux CI/스모크에서 별도 확인한다.

따라서 현재 macOS 개발 환경에서는 frontend/Rust 검증, Tauri `.app` bundle build, Git external-tool의 packaged UI/process 및 mergetool 저장 lifecycle까지 확인됐다. 남은 T009 항목은 macOS difftool report native-dialog 확정과 사용자가 실행할 Windows/Linux 전체 사례다. 그 밖에 세 OS 패키징, 실제 file dialog/native menu/reveal/일반 CLI smoke와 일부 packaged WebView runtime smoke가 남아 있다.

## 첫 로컬 검증 순서

```bash
npm ci
npm run doctor
npm run check
npm run tauri dev

cd src-tauri
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
```

세 운영체제 결과는 `FND-001` 이슈 또는 PR 본문에 각각 기록한다.
