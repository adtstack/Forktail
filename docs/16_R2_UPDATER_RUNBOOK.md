# 16. Cloudflare R2 Updater Runbook (REL-008)

> **상태:** `REL-008C` 배포 파이프라인 구현됨; 기본 비활성
> **적용 범위:** GitHub 저장소는 비공개로 유지하면서 배포하는 forktail의 직접 설치본
> **결정:** Cloudflare R2의 전용 공개 버킷과 커스텀 HTTPS 도메인에 Tauri static updater feed를 게시한다.

이 문서는 `REL-008`의 단일 실행 기준이다. 현재 저장소에는 `REL-008C`(서명 artifact·R2 publisher)가 구현되어 있지만, `ENABLE_R2_UPDATER`는 기본적으로 꺼져 있고 앱 내부 updater(`REL-008B`)도 아직 없다. 따라서 이 문서만 따라 R2 artifact를 게시해도 기존 설치 앱이 자동으로 업데이트되지는 않는다. `REL-008B`, 세 OS public signing, 이 문서의 승인 기준을 모두 끝낸 뒤에만 활성화한다.

관련 문서:

- `04_BACKLOG.md`의 `REL-008`
- `09_RELEASE_SECURITY.md`의 updater 보안 정책
- `RELEASE_SIGNING_POLICY.md`의 OS 코드서명·notarization 전제
- `07_TEST_PLAN.md`의 release smoke 기준

## 1. 확정한 구조

### 1.1 배포 흐름

```text
비공개 GitHub 저장소
  └─ stable vX.Y.Z tag + ENABLE_R2_UPDATER=true
       └─ GitHub Actions (protected production-updates environment)
       ├─ 세 OS에서 서명된 installer / updater artifact 생성
       ├─ 버전 고정 파일을 R2에 업로드·검증
       └─ stable/latest.json을 마지막에 게시

공개 R2 custom domain: https://updates.<OWNED_DOMAIN>
  ├─ releases/vX.Y.Z/...       변경하지 않는 installer / updater artifact
  └─ stable/latest.json         현재 stable을 가리키는 유일한 가변 파일

REL-008B가 들어간 설치된 forktail
  └─ 사용자가 opt-in한 경우에만 HTTPS로 latest.json 조회
       └─ 내장 Tauri 공개키로 다운로드 artifact 서명 검증
```

`<OWNED_DOMAIN>`은 실제 보유 도메인으로 치환한다. 권장 이름은 `updates.<OWNED_DOMAIN>`이다. 예를 들어 도메인이 `forktail.app`이면 endpoint는 `https://updates.forktail.app/stable/latest.json`이다.

### 1.2 공개되는 것과 공개하지 않는 것

| 공개 R2 버킷에 두는 것 | 절대로 두지 않는 것 |
|---|---|
| installer, updater artifact, `.sig`, checksum, SBOM, NOTICE, `latest.json` | 소스 코드, 사용자 파일, 로그, signing private key, Cloudflare token, GitHub token, 인증서 원본 |

업데이트 앱은 로그인하지 않은 상태에서 파일을 받아야 하므로 위 릴리스 파일은 공개 HTTPS여야 한다. 이는 GitHub 저장소가 비공개인 것과 충돌하지 않는다. Tauri updater signature는 임의 바이트를 신뢰할 update로 위조하는 것을 막는다. 그러나 R2 write token을 가진 공격자는 이미 서명된 과거 artifact를 manifest에 다시 가리키거나 update check를 막을 수 있으므로, token도 production signing material처럼 보호한다.

Store, Homebrew, winget, Flatpak, Snap 등 다른 설치 경로는 이 updater를 사용하지 않는다. 설치 경로마다 업데이트 주체는 하나만 둔다.

### 1.3 처음에는 하지 않는 것

- `r2.dev` URL을 production endpoint로 사용하지 않는다. 개발·검증용이며 production rate limit 대상이다.
- Cloudflare Worker, 동적 update API, 단계적 rollout, 자동 beta update를 처음부터 넣지 않는다.
- Cloudflare Access 로그인이나 앱에 API token을 넣지 않는다. 익명 설치 앱은 Access를 통과할 수 없다.
- updater가 임의의 URL을 받게 하거나 일반 HTTP client를 추가하지 않는다.
- 배포 파일을 덮어쓰지 않는다. 버전 고정 artifact는 항상 새 key로 업로드한다.

## 2. 사람이 먼저 준비할 항목

다음 항목은 코드 PR 전에 계정 소유자가 직접 준비한다. 비밀값은 이 저장소, 이슈, PR, 로그, 채팅에 붙여 넣지 않는다.

### 2.1 Cloudflare 및 도메인

- [ ] Cloudflare 계정에서 R2 사용 및 결제를 활성화한다. 초기 사용량은 무료 구간일 수 있지만 R2 API token 생성에는 계정 설정이 필요하다.
- [ ] 실제 보유 도메인을 같은 Cloudflare 계정의 zone으로 추가한다.
- [ ] R2 bucket `forktail-updates`를 만든다. 이 버킷은 **공개 릴리스 전용**이며 다른 자산과 공유하지 않는다.
- [ ] R2 Dashboard → bucket → **Settings** → **Custom Domains**에서 `updates.<OWNED_DOMAIN>`을 연결한다.
- [ ] Public Development URL (`r2.dev`)은 비활성 상태로 둔다. 공개 접근은 custom domain 하나로만 제공한다.
- [ ] Cloudflare의 Always Use HTTPS를 켜고, endpoint가 `https://` 이외의 URL을 제공하지 않는지 확인한다.
- [ ] `stable/latest.json` 경로를 덮는 Cache Everything 규칙이 없도록 한다. 있으면 이 경로만 cache bypass 한다.

R2 custom domain은 R2 bucket과 같은 Cloudflare 계정의 zone에 연결해야 한다. custom domain은 CDN cache와 TLS를 제공하므로 production에 필요한 경로다.

workflow의 config/manifest generator는 `.r2.dev` host를 명시적으로 거절한다. `UPDATER_BASE_URL`과 `TAURI_UPDATER_ENDPOINT`에는 custom domain만 넣는다.

### 2.2 GitHub Actions production environment

- [ ] GitHub repository에 `production-updates` environment를 만든다.
- [ ] environment에 release 관리자 승인을 요구하고, protected stable tag 또는 명시적 `workflow_dispatch`에서만 접근하도록 제한한다.
- [ ] PR, fork, prerelease tag, `ENABLE_R2_UPDATER`가 꺼진 일반 tag push에는 production secrets를 노출하지 않는다.
- [ ] Actions와 third-party action은 기존 정책대로 exact version 또는 commit SHA로 고정한다.

environment에 저장할 secret은 다음과 같다. 이름은 현재 `release.yml`과 일치해야 한다.

| Secret | 용도 | 제한 |
|---|---|---|
| `R2_ACCOUNT_ID` | R2 S3 endpoint account 식별 | 해당 Cloudflare account만 |
| `R2_ACCESS_KEY_ID` | R2 S3 API write credential ID | `forktail-updates` 버킷만 Object Read/Write |
| `R2_SECRET_ACCESS_KEY` | 위 R2 S3 API write credential secret | `forktail-updates` 버킷만 Object Read/Write |
| `TAURI_SIGNING_PRIVATE_KEY` | updater artifact 서명 | production build job에서만 |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 위 private key가 암호화된 경우 | production build job에서만 |
| `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `KEYCHAIN_PASSWORD` | macOS Developer ID `.p12` import | macOS build job |
| `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` | macOS Developer ID + notarization/stapling | macOS build job |
| `WINDOWS_CERTIFICATE`, `WINDOWS_CERTIFICATE_PASSWORD` | Windows Authenticode `.pfx` import | Windows build job |

Repository variables에는 다음 **비밀이 아닌** 값을 넣는다.

| Variable | 값 |
|---|---|
| `R2_BUCKET` | 예: `forktail-updates` |
| `UPDATER_BASE_URL` | 예: `https://updates.<OWNED_DOMAIN>` |
| `TAURI_UPDATER_ENDPOINT` | 정확히 `${UPDATER_BASE_URL}/stable/latest.json` |
| `TAURI_UPDATER_PUBLIC_KEY` | Tauri updater public key의 내용 |
| `TAURI_WINDOWS_CERTIFICATE_THUMBPRINT` | Windows code-signing certificate의 40자리 SHA-1 thumbprint |
| `TAURI_WINDOWS_TIMESTAMP_URL` | HTTPS RFC 3161 timestamp URL (`tsp: true`로 전달) |
| `RELEASE_SIGNING_READY` | 모든 public signing 설정·검증 후에만 정확히 `true` |
| `ENABLE_R2_UPDATER` | `REL-008B`와 rollout 전제까지 끝난 뒤에만 정확히 `true` |

`RELEASE_SIGNING_READY`와 `ENABLE_R2_UPDATER`는 보안 제어의 대체물이 아니다. workflow는 실제 macOS notarization/Windows Authenticode 검증도 수행하며, 하나라도 실패하면 `stable/latest.json`을 쓰지 않는다. R2 credential과 updater private key는 서로 다른 비밀이다. R2 credential이 유출되면 availability를 훼손하거나, 아직 더 낮은 version을 쓰는 사용자에게 과거의 유효한 서명 artifact를 replay할 수 있다. 그러나 updater private key 없이는 설치 앱이 신뢰할 임의의 새 artifact를 만들 수 없다. 둘 다 즉시 revoke/rotate할 수 있게 소유자와 만료·복구 절차를 기록한다.

### 2.3 Tauri updater signing key

- [ ] 인터넷에 노출되지 않은 관리자 환경에서 Tauri signer key pair를 한 번 생성한다.
- [ ] public key를 repository variable `TAURI_UPDATER_PUBLIC_KEY`에 넣는다. `REL-008C` workflow는 이를 `$RUNNER_TEMP/tauri.updater.json` overlay에만 쓴다.
- [ ] private key는 암호화한 오프라인 복구본 두 개 이상과 production environment secret에 보관한다.
- [ ] key fingerprint, 생성일, 복구본 보관 책임자를 비밀 관리 시스템에 기록한다. 문서나 Git에는 private key를 기록하지 않는다.

예시 생성 명령은 다음과 같다. 실제 경로는 개인 키 저장 정책에 맞게 바꾼다.

```bash
npm run tauri signer generate -- -w ~/.tauri/forktail-updater.key
```

이 key를 잃으면 이미 설치된 앱이 신뢰하는 공개키에 대응하는 새 업데이트를 만들 수 없다. key rotation은 별도 설계·테스트 없이는 수행하지 않는다.

`REL-008B`가 완료되면 같은 public key와 endpoint가 ship되는 앱 configuration에도 들어가야 한다. public key와 endpoint는 설치된 바이너리에서 읽을 수 있는 값이므로 secret으로 다루지 않는다. private key는 overlay, source tree, release note 어느 곳에도 넣지 않는다.

### 2.4 공개 updater 전제인 OS 서명

다음이 모두 준비되기 전에는 public updater를 켜지 않는다.

- [ ] macOS: Developer ID Application 서명과 notarization/stapling
- [ ] Windows: Authenticode 서명
- [ ] Linux: AppImage 호환성 및 updater signature smoke
- [ ] 실제 reverse-domain bundle identifier 확정 (`dev.local.forktail`을 공개 배포 identifier로 사용하지 않음)

Tauri updater signature는 OS 코드서명과 다르다. 둘 다 필요하다. OS 코드서명은 플랫폼 신뢰 경고와 실행 신뢰를, Tauri signature는 updater가 다운로드한 payload의 무결성을 담당한다.

현재 `src-tauri/tauri.conf.json`의 identifier는 `dev.local.forktail`이다. production workflow는 이 development identifier를 감지하면 실패한다. 실제 identifier를 정하고 migration 영향(기존 macOS bundle/Windows install identity)을 검토하는 별도 PR이 선행되어야 한다.

현재 workflow의 표준 production path는 다음과 같다.

- macOS: `APPLE_CERTIFICATE` base64 `.p12`를 ephemeral keychain으로 import하고, `APPLE_SIGNING_IDENTITY`로 Developer ID Application signing을 수행한다. `APPLE_ID`/`APPLE_PASSWORD`/`APPLE_TEAM_ID`로 Tauri build 중 notarization·stapling을 수행한다. 생성된 `.app.tar.gz`를 다시 풀어 Developer ID authority와 staple을 검증한다.
- Windows: `WINDOWS_CERTIFICATE` base64 `.pfx`를 `Cert:\CurrentUser\My`로 import한다. workflow가 생성하는 overlay의 thumbprint, SHA-256 digest, HTTPS timestamp URL을 Tauri에 전달하고, 최종 NSIS `.exe`의 Authenticode status와 signer thumbprint를 검증한다.

EV/HSM 또는 Azure signing을 쓸 경우에는 PFX import path를 임의로 우회하지 않는다. Tauri `bundle.windows.signCommand` 기반의 별도 signing adapter와 동일한 post-build Authenticode 검증을 먼저 추가·검토한 뒤 `RELEASE_SIGNING_READY=true`로 바꾼다.

## 3. R2 object 및 cache 계약

### 3.1 고정 key 규칙

각 release는 다음처럼 새 prefix를 사용한다. 아래 파일명은 논리적 계약이며 CI는 이 이름을 일관되게 생성해야 한다.

```text
releases/vX.Y.Z/
  artifacts/
    forktail-vX.Y.Z-macos-universal.dmg
    forktail-vX.Y.Z-macos-universal.app.tar.gz
    forktail-vX.Y.Z-macos-universal.app.tar.gz.sig
    forktail-vX.Y.Z-windows-x64-setup.exe
    forktail-vX.Y.Z-windows-x64-setup.exe.sig
    forktail-vX.Y.Z-linux-x86_64.AppImage
    forktail-vX.Y.Z-linux-x86_64.AppImage.sig
  checksums.txt
  sbom/
    forktail-npm.cdx.json
    forktail-rust.cdx.json
    NOTICE.txt

stable/latest.json
```

- macOS `.dmg`는 첫 설치와 수동 복구용이고, `.app.tar.gz`는 updater payload다.
- Windows NSIS `.exe`와 Linux `.AppImage`는 첫 설치와 updater가 같은 바이트를 사용한다. DMG처럼 별도 updater archive를 만들지 않는다.
- `.sig`는 감사·수동 검증을 위해 함께 게시한다. `latest.json`에는 `.sig` **파일 내용 자체**를 넣으며 `.sig` URL을 넣지 않는다.
- 버전 고정 object는 업로드 후 수정·삭제하지 않는다. 같은 버전의 재빌드가 필요하면 새 버전을 발행한다.

### 3.2 HTTP cache 규칙

| Path | Cache-Control | 이유 |
|---|---|---|
| `releases/vX.Y.Z/**` | `public, max-age=31536000, immutable` | URL과 내용이 불변이므로 CDN 재사용 허용 |
| `stable/latest.json` | `no-store, max-age=0, must-revalidate` | 새 release 즉시 확인, stale manifest 방지 |

`latest.json`을 업로드한 뒤 이전 응답이 보이면 **그 파일만** cache purge 한다. release 전체 cache purge나 versioned artifact overwrite는 금지한다.

### 3.3 static manifest 계약

`stable/latest.json`은 모든 지원 플랫폼의 올바른 항목을 포함해야 한다. Tauri는 version을 비교하기 전에 JSON 전체를 검증하므로 하나의 플랫폼 항목만 깨져도 정상 사용자의 update check가 실패할 수 있다.

```json
{
  "version": "0.3.0",
  "notes": "사용자에게 보여 줄 간단한 변경 사항",
  "pub_date": "2026-07-10T12:00:00Z",
  "platforms": {
    "darwin-aarch64": {
      "url": "https://updates.<OWNED_DOMAIN>/releases/v0.3.0/artifacts/forktail-v0.3.0-macos-universal.app.tar.gz",
      "signature": "macOS .sig 파일의 전체 내용"
    },
    "darwin-x86_64": {
      "url": "https://updates.<OWNED_DOMAIN>/releases/v0.3.0/artifacts/forktail-v0.3.0-macos-universal.app.tar.gz",
      "signature": "동일한 macOS .sig 파일의 전체 내용"
    },
    "windows-x86_64": {
      "url": "https://updates.<OWNED_DOMAIN>/releases/v0.3.0/artifacts/forktail-v0.3.0-windows-x64-setup.exe",
      "signature": "Windows .sig 파일의 전체 내용"
    },
    "linux-x86_64": {
      "url": "https://updates.<OWNED_DOMAIN>/releases/v0.3.0/artifacts/forktail-v0.3.0-linux-x86_64.AppImage",
      "signature": "Linux .sig 파일의 전체 내용"
    }
  }
}
```

macOS universal artifact는 `darwin-aarch64`와 `darwin-x86_64` 양쪽 key에 같은 URL과 signature를 매핑한다. 새 architecture를 지원하면 manifest, artifact, OS smoke를 같은 release에서 함께 추가한다.

`version`은 tag와 `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`의 version과 일치해야 한다. `pub_date`는 RFC 3339 UTC로 생성한다. manifest에는 IP, 경로, 사용자 ID, 파일 내용 등 개인 데이터를 넣지 않는다.

## 4. 애플리케이션 구현 계약 (`REL-008B`, 아직 미구현)

이 절은 `REL-008B`의 다음 PR 범위다. 현재 `REL-008C`는 artifact와 R2 feed만 만든다. `src-tauri/Cargo.toml`에는 아직 updater runtime plugin이 없으므로, 현재 설치 앱은 endpoint를 조회하거나 다운로드·설치하지 않는다. 이 상태에서 `ENABLE_R2_UPDATER=true`를 켜지 않는다.

### 4.1 최소한의 Tauri 변경

`REL-008B` 구현 PR은 다음을 함께 포함해야 한다.

1. Rust에 `tauri-plugin-updater`를 현재 Tauri minor 계열로 추가한다. frontend에는 `@tauri-apps/plugin-updater`를 추가하지 않는다.
2. `src-tauri/src/lib.rs`에서 desktop updater plugin을 초기화한다.
3. `src-tauri/tauri.conf.json`에 다음을 추가한다.
   - `bundle.createUpdaterArtifacts: true`
   - embedded updater `pubkey`
   - endpoint `https://updates.<OWNED_DOMAIN>/stable/latest.json`
4. UI에 Settings 기반의 updater opt-in과 수동 `업데이트 확인`을 추가한다.
5. update check/download/install에는 좁은 Rust command와 progress event를 사용한다. frontend에 `updater:default` capability나 일반 updater API를 통째로 주지 않는다.
6. `networkPolicy.test.ts`를 변경해 updater plugin의 **고정된 opt-in 사용만** 허용하고, browser `fetch`, 일반 Rust HTTP client, telemetry, API key는 계속 금지한다.

직접 Tauri updater capability를 쓸 경우에도 check/install 범위를 필요한 permission만 허용한다. 더 안전한 기본안은 Rust가 check/download/install을 감싸고, frontend에는 상태·진행률·사용자 결정을 위한 좁은 command만 제공하는 것이다.

### 4.2 사용자 경험과 개인정보

| 항목 | 확정 정책 |
|---|---|
| 기본값 | 자동 update check off (명시적 opt-in) |
| 자동 check | opt-in 후 앱 시작 15~60초 뒤, 최대 24시간에 한 번 |
| 수동 check | Settings에서 항상 가능 |
| 다운로드 | 사용자가 버전·release note를 확인하고 승인한 뒤 시작 |
| 설치/재시작 | 사용자가 명시적으로 승인할 때만; 자동 강제 종료 금지 |
| dirty 세션 | 저장·취소·나중에 중 하나를 선택할 때까지 install 금지 |
| 전송 정보 | 고정 static URL 요청의 표준 HTTPS 메타데이터만; 파일 내용·경로·사용자 ID·telemetry 금지 |

Windows updater install은 앱을 종료할 수 있으므로 dirty guard는 `install` 호출 **전**에 실행한다. 다운로드 완료가 설치 승인을 의미하지 않도록 상태를 분리한다.

사용자용 오류는 기존 command 계약처럼 `{ code, message }`로 표현한다. 최소 오류 코드는 `UPDATE_CHECK_FAILED`, `UPDATE_SIGNATURE_INVALID`, `UPDATE_DOWNLOAD_FAILED`, `UPDATE_INSTALL_DEFERRED_DIRTY`로 고정하고, OS/HTTP 내부 오류 문자열을 그대로 UI에 노출하지 않는다.

### 4.3 첫 updater 버전의 배포

현재 0.2.x 설치본에는 updater가 없다. 따라서 updater가 들어간 첫 공개 버전은 사용자가 R2의 installer를 받아 **수동으로 설치**해야 한다. 그 버전 이후부터만 in-app update가 가능하다.

## 5. production release 절차

### 5.1 절대 순서

1. `REL-008B`가 ship되어 있고, 버전·tag·release note·frontend/Rust gate가 준비되었는지 확인한다.
2. stable `vX.Y.Z` tag를 push한다. `ENABLE_R2_UPDATER=true`일 때만 tag trigger가 production updater path를 시작한다. 또는 `workflow_dispatch`에서 `publish_updater=true`를 고른다. prerelease tag(`-beta` 등)는 입력 `prerelease=false`와 무관하게 stable feed에 게시할 수 없다.
3. validate job이 tag를 commit SHA로 고정한다. 이후 build/publish job은 mutable tag name이 아니라 이 SHA를 checkout하고, publish 직전에 tag가 같은 SHA인지 다시 확인한다.
4. protected `production-updates` environment의 명시적 승인 후 production build를 시작한다. 일반 tag push에서 `ENABLE_R2_UPDATER`가 없거나 prerelease인 경우에는 signing key·R2 write path가 실행되지 않는다.
5. 각 OS에서 OS 코드서명을 적용하고, Tauri updater signature가 만들어지는 시점의 artifact bytes가 최종 배포 bytes인지 보장한다.
   - macOS updater `.app.tar.gz`에는 최종 Developer ID signed/notarized/stapled app이 들어 있어야 한다. workflow는 archive를 다시 풀어 이를 검증한다.
   - Windows NSIS installer도 Authenticode sign 뒤의 바이트에 대해 updater signature를 만들며, workflow는 final `.exe`의 signer를 검증한다.
6. `TAURI_SIGNING_PRIVATE_KEY`로 updater artifact와 `.sig`를 생성한다.
7. 생성물의 version, checksum, OS signature, updater signature input을 검증한다.
8. GitHub draft release를 먼저 만든다. updater path에서는 같은 signed artifact, SBOM, NOTICE, checksum을 audit copy로 첨부하며, 이 단계가 실패하면 R2 publisher는 시작하지 않는다.
9. 모든 versioned object를 R2 `releases/vX.Y.Z/`에 `If-None-Match: *`로 업로드하고, 재실행 때는 기존 object의 SHA-256가 같은 경우에만 재사용한다. 공개 custom-domain URL에서 다시 다운로드해 checksum을 검증한다.
10. 현재 `stable/latest.json`을 R2 S3 API에서 읽어 candidate가 **더 높은 stable SemVer**인지 검사한다. global publisher lock과 ETag `If-Match`/`If-None-Match` 조건으로 구버전 job의 rollback을 막는다.
11. `stable/latest.json`을 생성·검증한 뒤 **마지막 한 번의 가변 쓰기**로 업로드하고, public URL에서 byte-for-byte 검증한다. updater client는 GitHub asset을 조회하지 않는다.

R2 upload는 별도 `publish_updater` job으로 둔다. 단, updater key가 artifact 생성 단계에서 필요하므로 production build job도 protected environment에서 실행되어야 한다. final publisher job에만 key를 주는 것으로는 충분하지 않다.

### 5.2 구현할 CI guard

- `ENABLE_R2_UPDATER=true`인 stable tag push 또는 stable `workflow_dispatch`만 protected environment 승인과 R2 write 권한을 요구한다.
- prerelease tag는 `publish_updater=true` 입력을 조작해도 stable feed에 게시할 수 없다. tag trigger의 GitHub draft prerelease 표기는 기존 정책대로 유지된다.
- validate 이후 모든 build/publish job은 고정 commit SHA를 checkout하며, publisher는 tag가 이동했으면 실패한다.
- 모든 artifact가 준비되지 않았거나, verification/smoke가 하나라도 실패하면 `stable/latest.json`을 쓰지 않는다.
- versioned R2 key는 overwrite하지 않는다. 재시도는 기존 object의 SHA-256가 같을 때만 허용한다.
- publish job은 object 목록, SHA-256, manifest version·ETag을 검증하되 private key나 token은 출력하지 않는다.
- third-party GitHub Action은 exact version/commit으로 고정한다. GitHub hosted runner의 preinstalled AWS CLI는 `aws --version`을 log에 남기고 `PutObject`의 `--if-none-match`/`--if-match` 지원을 실행 전에 검사한다.

## 6. 롤백과 사고 대응

### 6.1 정적 manifest의 한계

`stable/latest.json`을 이전 version으로 되돌려도 이미 더 높은 version으로 업데이트한 앱은 일반 SemVer 비교상 downgrade하지 않는다. 이 조작은 아직 업데이트하지 않은 사용자에게만 도움이 된다.

실제 사용자 복구 정책은 다음과 같다.

1. 잘못된 release의 신규 promotion을 즉시 중단한다.
2. 이미 업데이트한 사용자는 **더 높은 version의 corrective release**로 고친다.
3. 긴급한 경우에는 R2의 이전 installer URL을 안내해 수동 재설치를 제공한다.
4. versioned object와 checksum은 forensic/manual recovery를 위해 보존한다.

진짜 자동 downgrade가 필요해질 때만 별도의 dynamic update server와 version-comparator override를 ADR·위협 모델·테스트와 함께 검토한다. static feed의 범위에는 넣지 않는다.

### 6.2 비밀 또는 endpoint 사고

| 사고 | 즉시 조치 |
|---|---|
| R2 token 유출 | stable manifest promotion 중단 → token revoke → bucket scope 새 token 발급 → GitHub environment 교체 → replay/변경 이력 점검 → 필요하면 higher-version corrective release 발행 |
| updater private key 유출 | 새 release를 멈추고 보안 incident로 처리; 기존 설치본의 key migration은 별도 복구 계획 없이는 불가능하므로 임의 교체 금지 |
| private key 손실 | 새 update 발행 중단; 오프라인 복구본으로 복원 가능한지 확인 |
| manifest가 stale | `stable/latest.json`만 purge 후 custom-domain URL 재검증 |
| artifact checksum 불일치 | manifest 게시 중단, 해당 version prefix 사용 금지, 새 version으로 재빌드 |
| update endpoint 장애 | 앱 핵심 기능은 계속 offline으로 동작; UI는 재시도 가능한 안내만 표시 |

## 7. 수용 기준과 검증

### 7.1 자동화 테스트

- [x] `latest.json` generator가 네 platform key, URL, embedded signature text, RFC 3339 date, tag/version 일치를 검증한다.
- [x] macOS universal artifact가 `darwin-aarch64`와 `darwin-x86_64`에 모두 매핑되는 테스트가 있다.
- [x] 잘못된/missing signature, 누락 platform, HTTP endpoint, endpoint query, stale/prerelease manifest가 publish 전에 실패한다.
- [x] release workflow test는 stable-tag gate, fixed commit checkout, OS-signature checks, immutable artifact upload, manifest ETag promotion order를 검증한다.
- [ ] network policy test는 opt-in updater만 허용하고 generic HTTP/telemetry/API key를 계속 거절한다.
- [x] versioned object와 manifest가 서로 다른 cache policy를 workflow contract로 검증한다.

### 7.2 세 OS 수동 smoke

각 플랫폼에서 updater 없는 vN을 installer로 설치한 뒤, R2에 vN+1을 게시해 다음을 확인한다.

- [ ] opt-in 이전에는 네트워크 update check가 일어나지 않는다.
- [ ] opt-in 뒤 새 버전과 release note가 표시된다.
- [ ] signature가 정상인 다운로드만 설치된다.
- [ ] 손상된 artifact 또는 바꾼 signature는 설치되지 않는다.
- [ ] dirty 2-way/3-way 세션에서는 설치 전 저장/취소/나중에 선택을 요구한다.
- [ ] 설치 후 앱이 올바른 version으로 재시작되고 설정·최근 세션이 보존된다.
- [ ] endpoint offline, timeout, no update에서 앱 핵심 기능이 깨지지 않는다.
- [ ] macOS Intel/Apple Silicon, Windows x64, Linux x86_64의 실제 지원 대상에서 확인한다.

### 7.3 release 승인 기준

다음 모두가 충족될 때만 `stable/latest.json`을 게시한다.

- [ ] `REL-006`의 공개 OS signing/notarization 상태가 문서와 실제 artifact에 일치한다.
- [ ] `REL-008B` updater runtime과 opt-in UI가 ship되어 있다. 이 항목 전에는 `ENABLE_R2_UPDATER`를 `true`로 바꾸지 않는다.
- [ ] updater private key의 복구 절차와 R2 token의 revoke 절차가 확인되었다.
- [ ] versioned artifact, SBOM, NOTICE, checksum이 R2와 GitHub audit release에 모두 있다.
- [ ] 세 OS update smoke 및 old-version migration smoke가 통과했다.
- [ ] rollback/hotfix 담당자와 사용자 공지 경로가 정해졌다.

## 8. 구현 PR 순서

각 단계는 별도 PR로 진행하며, 전 단계를 건너뛰지 않는다.

1. **REL-008A — Signing/endpoint 기반**: updater key 생성 절차, OS public signing, R2 custom domain과 protected environment를 준비한다. 이 단계에서는 앱 updater를 켜지 않는다.
2. **REL-008B — Tauri updater 계약**: plugin, 좁은 Rust command, opt-in settings, capability/network policy, unit/UI test를 추가한다.
3. **REL-008C — Release artifact와 R2 publisher**: updater artifact 생성, manifest generator, immutable upload/retry, cache policy, protected publish job, tag SHA/ETag promotion guard, workflow test를 추가한다. **구현됨; environment 설정 전까지 비활성.**
4. **REL-008D — 3 OS rollout**: vN→vN+1 clean-machine smoke, hotfix/manual recovery rehearsal, release 문서 갱신 후 stable manifest를 최초 게시한다.

## 9. 공식 참고 자료

- [Tauri Updater](https://v2.tauri.app/plugin/updater/)
- [Tauri macOS code signing and notarization](https://v2.tauri.app/distribute/sign/macos/)
- [Tauri Windows code signing](https://v2.tauri.app/distribute/sign/windows/)
- [Cloudflare R2 public buckets and custom domains](https://developers.cloudflare.com/r2/buckets/public-buckets/)
- [Cloudflare R2 S3/API token setup](https://developers.cloudflare.com/r2/get-started/s3/)
- [Cloudflare R2 object consistency](https://developers.cloudflare.com/r2/reference/consistency/)
- [Cloudflare R2 pricing](https://developers.cloudflare.com/r2/pricing/)
- [GitHub Actions environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)
