# 09. Release, Data Safety, and Security

## 1. 위협 모델

이 앱은 인터넷 서비스가 아니지만 신뢰할 수 없는 로컬 파일을 연다. 주요 위험은 다음이다.

- 악성/비정상 파일로 인한 메모리·CPU 고갈
- 파일 내용이 WebView에서 실행되는 문제
- 잘못된 경로 또는 symlink로 의도하지 않은 파일 덮어쓰기
- 외부 수정과 경쟁해 사용자 변경을 잃는 문제
- 부분 쓰기/프로세스 종료로 원본 손상
- 과도한 Tauri capability
- updater 또는 dependency supply-chain
- 로그에 민감한 파일 내용 유출

## 2. 기본 보안 정책

- 네트워크 요청 없음
- 원격 콘텐츠 로드 없음
- telemetry 없음
- API key 없음
- 파일 내용 로그 금지
- symlink follow 기본 off
- text file size cap
- 일반 text read는 no-follow/reparse-point open, 열린 handle 검증, 64 MiB + 1 byte bounded read 사용
- file-version/content-hash precondition과 folder-review pair도 같은 no-follow/bounded snapshot primitive 사용
- custom Rust commands만 사용하고 broad FS plugin 권한 금지
- dialog 권한도 main window로 제한
- OS application-level quit는 main React dirty guard로 전달하고, 취소된 종료에서는 session·detached registry를 정리하지 않음

`src/core/networkPolicy.test.ts`는 런타임 source와 package manifest에 browser/Rust network API, updater/HTTP plugin, telemetry dependency, AI SDK/API key 경로가 들어오지 않는지 검사한다. 문서와 테스트 fixture는 사용자에게 정책을 설명하거나 non-file URI를 거절하는 사례가 있어 감사 대상에서 제외한다.

Tauri capability는 window/webview별 권한 경계다. 릴리스 전에 `csp: null`을 제거하고 Monaco local worker에 필요한 최소 CSP를 작성한다.

### 독립 검토 창 capability 경계

`build.rs`의 전체 `AppManifest::commands` 목록과 `generate_handler!`, main permission은 exact parity를
유지한다. main capability는 reviewed application command와 dialog를 사용할 수 있지만,
`folder-review-*` capability는 event listen/unlisten, 자기 창 close, caller-bound
`load_detached_folder_review`, `check_detached_folder_review_version`,
`reload_detached_folder_review`만 허용한다. child command는 root/path/token/window label/job selector를
인자로 받지 않고 실제 caller label로 descriptor를 찾는다. ACL 목록 누락, 중복 또는 main/detached
permission 교집합은 CI에서 실패한다.

detached route는 고정된 local surface marker만 사용하고 remote navigation과 `window.open`을 거절한다.
window label은 checked counter, title은 정제·길이 제한한 표시 문맥, Monaco URI는 opaque process
identity다. root, absolute path, token과 text는 URL/label/title/model URI/storage/default log에 넣지
않는다. native registry도 descriptor/version/byte budget만 보관하며 content를 보관하지 않는다. 좌우
root와 전체 relative path는 caller 검증을 거친 context DTO로 해당 child의 local header에만 표시한다.

native menu dispatch는 전체 WebView broadcast가 아니라 현재 focused WebView 하나를 대상으로 한다.
detached profile은 previous/next diff와 close 외 mutation command를 비활성화한다. child는 settings,
recent/active session, startup restore를 mount하거나 기록하지 않는다. packaged release에서는 child
destroy, main destroy와 app exit 후 registry·byte accounting이 남지 않는지 각 지원 OS에서 확인한다.

### Phase 1 이후 Git adapter 경계

repository-aware Git 기능을 승격하더라도 core의 네트워크 0과 no-surprise-write 원칙은 유지한다. `docs/17_GIT_INTEGRATION.md`에 따라 Git executable은 Rust의 positive allowlist에서 argv로만 실행하고 shell/Tauri shell plugin을 추가하지 않는다. `--no-lazy-fetch`, `--no-optional-locks`, `GIT_TERMINAL_PROMPT=0`, literal path 정책으로 partial clone fetch, credential prompt, optional index write를 차단한다. `diff`의 external driver/textconv, Git LFS download, submodule update도 실행하지 않는다.

Git executable을 absolute path로 확정한 뒤 child 환경은 clear하고 검토된 OS 변수와 안전한 `GIT_*`만 다시 설정한다. 이렇게 repository/object/config/askpass/SSH/trace override를 상속하지 않는다. `safe.directory` 오류를 앱이 전역 우회하지 않으며, conflict Result 저장은 repository root containment, symlink, 외부 변경을 재검증한 뒤 기존 safe writer만 사용한다. 상세 threat/test matrix는 `docs/20_GIT_TEST_PLAN.md`를 따른다.

## 3. 저장 안전성

### 필수 precondition

파일을 열 때 다음 fingerprint를 저장한다.

```text
path + size + modified time + optional quick/full hash
```

저장 직전에 다시 확인한다. 다르면:

- reload and lose local draft
- overwrite anyway
- save a copy

세 선택을 제공한다.

size/mtime/hash 재확인은 symlink를 따라가는 별도 hash read가 아니라 no-follow로 연 일반 파일 handle에서
64 MiB + 1 byte 상한 안에 수행한다. 읽기 전후 metadata와 현재 path handle identity가 일치해야 하며,
검증 중 변경·권한·경로 경쟁으로 안정된 snapshot을 만들 수 없으면 `FILE_CHANGED`로 덮어쓰기를 중단한다.

### atomic replace

플랫폼 추상화가 필요하다.

- Unix: 같은 filesystem의 rename replace + parent directory fsync
- Windows: ReplaceFileW 또는 검증된 equivalent; 사용 중 파일 오류 처리

parent directory fsync가 atomic replace 뒤 실패하면 오류를 숨기지 않는다. 이미 교체된 새 target을
자동 rollback하지 않고 교체 전 backup과 함께 보존하며, 사용자가 파일을 다시 열어 저장 상태를
확인하도록 `WRITE_FAILED`를 반환한다.

단순 `remove(target); rename(temp, target)`는 원본이 사라지는 창이 있으므로 최종 구현으로 인정하지 않는다.

### backup

- 기본 on
- target과 같은 디렉터리 또는 사용자 지정 backup dir
- 충돌하지 않는 timestamp/sequence 이름
- retention count
- restore는 같은 target의 backup만 허용하며 현재 target을 다시 backup
- 목록과 restore source는 symlink/reparse point를 따라가지 않고 일반 파일만 허용
- restore와 save backup source는 no-follow handle에서 64 MiB + 1 byte bounded read를 두 번 수행하고,
  pre/post metadata, current path identity, BLAKE3와 exact raw bytes가 모두 같은 snapshot만 사용
- 최종 precondition/replace 실패는 이번 저장에서 만든 backup만 identity-bound rollback하고 기존 history와
  retention을 변경하지 않으며, 최신 10개 정리는 저장 성공 후에만 수행
- replace 뒤 parent directory sync 실패는 이미 바뀐 target의 pre-save backup을 보존하고 retention은 미적용
- backup 생성 실패 시 기본은 저장 중단

## 4. 경로와 symlink

- display path와 canonical identity를 구분한다.
- 일반 파일 read는 symlink/reparse point를 거절하고 읽기 전후 handle metadata와 현재 path identity가 같은
  경우에만 text·size·hash snapshot을 반환한다.
- 저장 precondition은 열린 뒤 symlink로 바뀐 target을 no-follow 재검증하고 실패를 `FILE_CHANGED`로 처리한다.
- folder-review pair는 양쪽 preflight handle에서 읽은 뒤 양쪽 current path를 다시 bounded read하여 identity,
  exact bytes와 hash가 일치하기 전에는 어느 쪽 내용도 WebView에 반환하지 않는다.
- folder sync가 생기면 root 밖으로 탈출하는 상대 경로를 거절한다.
- Windows UNC, long path, reserved components를 fixture에 포함한다.
- macOS Unicode normalization을 테스트한다.
- 폴더 비교 UI는 `FolderEntry.relativePath`를 `/` 구분, NFC, `en-US` lowercase 기준의 portable identity로 묶어 case-only/Unicode-only 충돌을 경고한다. Linux처럼 case-sensitive인 파일시스템에서도 이 경고는 Windows/macOS 기본 파일시스템으로 옮길 때의 위험을 드러내기 위한 것이다.
- copy/sync dry-run은 `..`, 절대 경로, Windows drive path, 빈 segment가 포함된 상대 경로를 차단하고 target path를 만들지 않는다.

## 5. WebView/CSP

- 파일 내용을 DOM HTML로 삽입하지 않는다.
- Monaco text model에 문자열로 전달한다.
- `dangerouslySetInnerHTML` 금지.
- local worker만 허용한다.
- `connect-src`는 Tauri IPC 외 차단한다.
- dev와 release CSP를 분리할 수 있으나 release는 CI에서 확인한다.

## 6. Dependency 정책

새 의존성 PR은 다음을 적는다.

- 목적
- 대안
- license
- maintenance/release activity
- native build impact
- bundle size/security impact

CI 후보:

- `cargo audit` 또는 `cargo deny`
- npm audit는 advisory triage와 함께 사용
- license allowlist
- 직접 JavaScript dependency/devDependency license allowlist는 `src/core/dependencyPolicy.test.ts`에서 로컬 `package-lock.json`의 버전 고정과 설치된 package metadata의 license를 대조한다.
- 직접 Rust dependency/build-dependency license allowlist는 `src/core/rustDependencyPolicy.test.ts`에서 `Cargo.toml`과 `Cargo.lock`의 직접 dependency 목록, crates.io source, 잠긴 semver version을 대조한다.
- CI는 `npm audit --audit-level=high`를 실행해 high/critical JavaScript advisory를 gate한다. low/moderate advisory는 영향 범위와 업그레이드 비용을 별도 triage한다.
- SBOM (CycloneDX/SPDX)
- lockfile commit

Tauri core/build/CLI는 같은 major/minor 계열을 유지하고 lockfile로 재현성을 확보한다.

현재 테스트 범위는 직접 npm/Rust 의존성의 라이선스와 lockfile 재현성 확인이다. transitive 전체 의존성 고지, Rust advisory audit, SBOM, low/moderate advisory triage는 공개 릴리스 전에 별도 도구로 생성·검토해야 하며 이 테스트가 이를 대체하지 않는다.

## 7. 배포

### Windows

- 개발/개인용 unsigned 실행은 가능하지만 SmartScreen 경고가 있을 수 있다.
- 공개 배포는 code signing을 권장한다.
- MSI는 Windows에서 빌드·검증한다.
- NSIS와 MSI 중 하나를 기본으로 선택하고 둘 다 유지보수하지 않는다.

### macOS

- 개인 개발은 unsigned/ad-hoc으로 가능하다.
- 웹에서 내려받는 일반 사용자 배포는 서명·notarization 없으면 강한 경고가 발생할 수 있다.
- 공개 배포 비용을 피하려면 사용자가 소스에서 빌드하는 경로를 명확히 제공하되 UX 제약을 숨기지 않는다.

### Linux

- target glibc compatibility를 위해 지원할 가장 오래된 적절한 배포판에서 빌드한다.
- deb와 AppImage 중 실제 사용자층 기준으로 우선순위를 정한다.

## 8. Updater

Phase 1 beta 초기에는 updater를 넣지 않는다. 다음을 모두 만족한 후 추가한다.

- artifact signing key 관리
- rollback 정책
- release JSON/endpoint 안정성
- 세 OS update smoke
- old version migration 테스트

updater가 core 기능의 네트워크 0 원칙을 깨므로 opt-in 또는 명확한 설정을 제공한다.

직접 설치본의 구현 결정과 실행 체크리스트는 `docs/16_R2_UPDATER_RUNBOOK.md`를 따른다. updater가 활성화된 뒤에도 고정된 HTTPS endpoint에 대한 opt-in update check만 허용하며, 일반 네트워크 API, telemetry, 사용자 파일·경로 전송은 계속 금지한다.

## 9. 릴리스 파이프라인

```text
tag vX.Y.Z
  → frontend checks
  → rust checks
  → three-platform builds
  → platform smoke/signing
  → checksum + SBOM + NOTICE
  → draft release
  → manual approval
```

GitHub Action은 floating major tag보다 검증된 exact version 또는 commit SHA를 고정한다.

## 10. 개인정보와 로그

기본 로그 허용:

- app version/OS
- operation type
- duration/count/size bucket
- error code

기본 로그 금지:

- 파일 내용
- diff/merge result
- 전체 경로를 외부로 전송
- 사용자 이름/home path

로컬 debug 로그에 path가 필요하면 사용자가 명시적으로 켜고 쉽게 삭제할 수 있어야 한다.

`src/core/privacyLoggingPolicy.test.ts`는 Phase 1 런타임 source에 `console.*`, `println!`, `eprintln!`, `dbg!`, `tracing::*!`, `log::*!` 같은 ad hoc logging call이 들어오지 않는지 검사한다. logging/crash reporting dependency는 별도 opt-in 정책과 파일 내용 비기록 검토 없이 추가하지 않는다.
