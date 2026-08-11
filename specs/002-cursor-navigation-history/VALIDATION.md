# UX-009 Validation

## Status

`mounted editor + folder cross-item implementation complete / Git cross-item and release verification pending`

실제 packaged hardware 검증은 사용자 소유다. 에이전트는 아래 행을 실행하거나 통과로 표시하지 않는다.

## External prerequisites

| Task | Status | Evidence |
|---|---|---|
| T081 | pending | caller-owned Git cancellation |
| T082 | pending | Git late-response identity guard |
| T084 | complete | authoritative DTO; focused frontend 35/35, Rust system 5/5, typecheck/build pass on 2026-07-17 |

## Automated frontend

| Command | Date | Result | Notes |
|---|---|---|---|
| `npm run typecheck` | 2026-08-11 | pass | TypeScript project references completed with no diagnostics |
| `npm test` | 2026-08-11 | pass | 79 files, 573 tests; configured Git-tool smoke integration excluded |
| `npm run build` | 2026-08-11 | pass | 1,176 modules transformed; existing >500 kB chunk warning remains |

## Automated Rust

| Command | Date | Result | Notes |
|---|---|---|---|
| `cargo fmt --check` | 2026-08-11 | pass | no formatting diff |
| `cargo clippy --all-targets -- -D warnings` | 2026-08-11 | pass | no warnings |
| `cargo test` | 2026-08-11 | pass | 265 passed; 1 generated folder benchmark ignored; 0 main/doc tests |

## Focused UX-009 evidence

| Gate | Date | Result |
|---|---|---|
| mounted component lifecycle | 2026-07-17 | 2 files, 27 tests passed |
| history/input/accessibility/privacy integration | 2026-07-17 | 13 files, 104 tests passed |
| command/input/bridge/native contract | 2026-07-17 | 4 files, 44 tests passed |
| Rust `cargo test navigation_back` | 2026-07-17 | 2 tests passed |
| folder identity + async restore + bridge | 2026-07-17 | 5 files, 80 tests passed |
| Rust `cargo test folder_review_text_pair` | 2026-07-17 | 7 tests passed |
| initial Monaco mount + Back naming regression | 2026-08-11 | 6 files, 55 tests passed |

## User Story 2 status

- Folder half T013/T015/T016/T018/T019/T021/T022: complete. History stores only the process-local
  review token, scan generation, normalized item identity, and side kind; roots and contents remain
  outside history.
- Pair read is all-or-nothing, runs off the Tauri command thread, checks cancellation between 64 KiB
  chunks, rejects unsafe/non-text/stale sides, and cleans job IDs on every terminal path.
- Git half T014/T020/T023 and the complete US2 gate T024 remain pending because prerequisite T081 and
  T082 are still unchecked. Folder completion does not imply Git cross-item completion.

## User-owned packaged hardware matrix

공통 입력란: artifact SHA, OS/WebView, device, date, evidence, pass/fail.

| Scenario | Windows WebView2 | macOS WKWebView | Linux WebKitGTK |
|---|---|---|---|
| 2-way keyboard Back | user-owned / manual-not-run | user-owned / manual-not-run | user-owned / manual-not-run |
| 3-way keyboard Back | user-owned / manual-not-run | user-owned / manual-not-run | user-owned / manual-not-run |
| 2-way X1 Back | user-owned / manual-not-run | user-owned / manual-not-run | user-owned / manual-not-run |
| 3-way X1 Back | user-owned / manual-not-run | user-owned / manual-not-run | user-owned / manual-not-run |
| native menu enabled/disabled and one-step Back | user-owned / manual-not-run | user-owned / manual-not-run | user-owned / manual-not-run |
| X2 Forward has no effect | user-owned / manual-not-run | user-owned / manual-not-run | user-owned / manual-not-run |
| React modal/native dialog ownership | user-owned / manual-not-run | user-owned / manual-not-run | user-owned / manual-not-run |
| dirty same-document/cross-item behavior | user-owned / manual-not-run | user-owned / manual-not-run | user-owned / manual-not-run |
| external Git tool stays open | user-owned / manual-not-run | user-owned / manual-not-run | user-owned / manual-not-run |
| rapid repeat and duplicate delivery | user-owned / manual-not-run | user-owned / manual-not-run | user-owned / manual-not-run |
| live-region announcement and editor focus | user-owned / manual-not-run | user-owned / manual-not-run | user-owned / manual-not-run |
| shutdown storage/cache/log/Git temp path inspection | user-owned / manual-not-run | user-owned / manual-not-run | user-owned / manual-not-run |
