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
- custom Rust commands만 사용하고 broad FS plugin 권한 금지
- dialog 권한도 main window로 제한

`src/core/networkPolicy.test.ts`는 런타임 source와 package manifest에 browser/Rust network API, updater/HTTP plugin, telemetry dependency, AI SDK/API key 경로가 들어오지 않는지 검사한다. 문서와 테스트 fixture는 사용자에게 정책을 설명하거나 non-file URI를 거절하는 사례가 있어 감사 대상에서 제외한다.

Tauri capability는 window/webview별 권한 경계다. 릴리스 전에 `csp: null`을 제거하고 Monaco local worker에 필요한 최소 CSP를 작성한다.

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

### atomic replace

플랫폼 추상화가 필요하다.

- Unix: 같은 filesystem의 rename replace + parent directory fsync
- Windows: ReplaceFileW 또는 검증된 equivalent; 사용 중 파일 오류 처리

단순 `remove(target); rename(temp, target)`는 원본이 사라지는 창이 있으므로 최종 구현으로 인정하지 않는다.

### backup

- 기본 on
- target과 같은 디렉터리 또는 사용자 지정 backup dir
- 충돌하지 않는 timestamp/sequence 이름
- retention count
- restore는 같은 target의 backup만 허용하며 현재 target을 다시 backup
- backup 생성 실패 시 기본은 저장 중단

## 4. 경로와 symlink

- display path와 canonical identity를 구분한다.
- 저장 대상이 열린 뒤 symlink로 바뀌는 TOCTOU 가능성을 검토한다.
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
