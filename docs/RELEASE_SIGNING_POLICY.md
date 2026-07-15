# Release Signing Policy (REL-006)

이 문서는 forktail 릴리스 산출물의 **현재 서명 상태**와 **공개 배포 시 필요한 추가 단계**를 사용자와 기여자에게 명확히 전달한다. `docs/12_DEFINITION_OF_DONE.md`의 Beta Release DoD "signing 상태 명확" 항목과 `docs/03_MILESTONES.md`의 M5 종료 조건 "서명 여부와 OS 경고 문서화"를 충족한다.

## 현재 서명 상태 (버전 0.2.x prerelease)

모든 0.2.x 릴리스는 **draft + prerelease** 상태이며, 아래 서명 정책이 적용된다.

| 플랫폼 | 산출물 | 서명 상태 | 사용자가 보는 경고 |
|---|---|---|---|
| macOS | `.dmg` (universal) | **ad-hoc 서명** (`codesign --force --deep --sign -`) | Gatekeeper: "확인할 수 없는 개발자" 경고. 우클릭 → 열기로 실행 가능. |
| Windows | `.exe` (NSIS) | **미서명** | SmartScreen: "Windows가 PC를 보호했습니다" 경고. "추가 정보" → "실행"으로 진행 가능. |
| Linux | `.AppImage` | **미서명** | 파일 권한 `chmod +x` 후 실행. 일부 데스크톱 환경에서 실행 확인 대화상자 표시. |

### 왜 서명하지 않았는가

- **인증서 비용/갱신 부담**: Apple Developer ID와 Windows Authenticode 인증서는 연간 비용이 발생하며, Phase 1은 개인·소규모 사용자를 위한 로컬 도구가 목표다.
- **REL-008 업데이터 전제조건**: `docs/09_RELEASE_SECURITY.md` §8에 따라 자동 updater는 "artifact signing key, rollback 정책, 세 OS smoke, migration 테스트"가 모두 충족되기 전까지 비활성이다. 서명은 updater 도입 시점에 본격적으로 도입한다.
- **소스 빌드 경로 제공**: 공식 릴리스 산출물이 서명되지 않았더라도, 사용자는 `npm ci && npm run tauri build`로 동일한 바이너리를 직접 빌드할 수 있다. 이 경로는 README에 명시한다.

## 공개 배포를 위한 추가 서명 단계

릴리스를 draft에서 공개(non-prerelease)로 전환하려면 아래 단계가 필요하다. 이 단계는 Phase 1 stable 이후 검토 대상이다.

### macOS

1. Apple Developer Program 가입 (연간 비용).
2. Developer ID Application 인증서 발급.
3. protected `production-updates` environment에 `APPLE_CERTIFICATE`(base64 `.p12`), `APPLE_CERTIFICATE_PASSWORD`, `KEYCHAIN_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`(app-specific password), `APPLE_TEAM_ID`를 저장.
4. `ENABLE_R2_UPDATER=true` production workflow는 `.p12`를 ephemeral keychain에 import하고 `APPLE_SIGNING_IDENTITY`로 Tauri build를 수행한다.
5. Tauri가 build 중 notarization/stapling을 수행하도록 Apple ID credentials를 전달하고, workflow가 생성된 `.app.tar.gz`를 다시 풀어 `codesign` Developer ID authority와 `xcrun stapler validate`를 확인하게 한다.
6. 위 검증이 실제 release run에서 통과하기 전에는 `RELEASE_SIGNING_READY=true`로 바꾸지 않는다.

### Windows

1. Authenticode 코드 서명 인증서 구매 (OV 또는 EV).
2. 인증서를 GitHub Actions secret으로 등록 (base64 인코딩).
3. PFX standard path에서는 protected `production-updates` environment에 `WINDOWS_CERTIFICATE`(base64 `.pfx`)와 `WINDOWS_CERTIFICATE_PASSWORD`를 저장하고, repository variable에 해당 40자리 SHA-1 `TAURI_WINDOWS_CERTIFICATE_THUMBPRINT`와 HTTPS `TAURI_WINDOWS_TIMESTAMP_URL`을 넣는다.
4. workflow가 PFX를 Windows certificate store에 import하고 Tauri overlay에 thumbprint/digest/timestamp를 전달한다. `TAURI_SIGNING_PRIVATE_KEY`는 **Windows Authenticode 키가 아니라 Tauri updater signature 키**다.
5. workflow가 final NSIS `.exe`의 `Get-AuthenticodeSignature` status와 signer thumbprint를 확인한다.
6. EV/HSM/Azure signing을 쓸 경우에는 `bundle.windows.signCommand` 기반의 별도 adapter와 같은 post-build 검증을 추가한다.

### Linux

- AppImage 서명은 `zsync` 기반 delta update와 함께 검토 (REL-008 업데이터 범위).
- GPG 서명은 패키지 저장소 배포 시 적용. 현재는 단일 AppImage 직접 배포이므로 체크섬(`checksums.txt`)으로 무결성 검증을 대신한다.

## 사용자 안내 텍스트 (릴리스 노트 표준 문구)

R2 updater를 publish하지 않는 baseline prerelease 릴리스 노트에 포함되는 표준 안내:

```
Security status:
- No updater is included.
- The macOS app is ad-hoc signed inside the DMG, but artifacts are not
  Developer ID signed or notarized.
- Treat this as a prerelease until the three-platform smoke, signing,
  rollback, SBOM, and NOTICE checks are complete.

SBOM and NOTICE (REL-007):
- forktail-npm.cdx.json / forktail-rust.cdx.json: CycloneDX SBOMs covering
  transitive dependencies.
- NOTICE.txt: direct dependency license notices.
```

이 문구는 `.github/workflows/release.yml`의 `release-notes.md` 템플릿에 하드코딩돼 있다. protected R2 updater path가 성공하면 workflow는 같은 signed artifact를 GitHub audit copy로 붙이는 별도 문구를 사용한다. endpoint, signing, R2 credential의 정확한 설정은 `docs/16_R2_UPDATER_RUNBOOK.md`를 따른다.

## 관련 이슈

- `REL-006`: 서명 정책 문서화 (이 문서)
- `REL-007`: SBOM/NOTICE 생성 (별도 파이프라인)
- `REL-008`: 자동 updater (Phase 1 이후, 서명의 전제조건)
- `docs/09_RELEASE_SECURITY.md` §7 배포, §8 Updater
- `docs/12_DEFINITION_OF_DONE.md` §5 Beta Release DoD
