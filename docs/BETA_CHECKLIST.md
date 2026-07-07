# Beta Release Checklist (REL-009)

이 문서는 `docs/03_MILESTONES.md`의 **M5 (Beta 배포) 종료 조건**을 검증하기 위한 체크리스트다. 모든 항목이 체크되기 전까지 릴리스는 prerelease 상태를 유지한다 (`docs/12_DEFINITION_OF_DONE.md` §5 참고).

## M5 종료 조건

> "세 운영체제에서 설치·업데이트 가능한 beta를 배포한다."

종료 조건 4개:

1. clean VM 설치/제거
2. 서명 여부와 OS 경고 문서화
3. release artifact checksum 공개
4. beta 사용자 fixture 기반 오류 0건 또는 알려진 이슈 문서화

---

## 1. Clean VM 설치/제거

각 OS의 깨끗한 환경(개발 도구가 설치되지 않은 상태)에서 릴리스 산출물이 정상 동작하는지 확인한다.

### macOS

- [ ] clean 사용자 계정에서 `.dmg` 마운트 후 `forktail.app`을 Applications로 드래그
- [ ] 첫 실행 시 Gatekeeper "확인할 수 없는 개발자" 경고 표시 확인 (우클릭 → 열기로 실행)
- [ ] 시작 화면, 2-way, 폴더, 3-way 화면 정상 렌더링
- [ ] `npm run smoke:runtime:verify` 통과 (RTM-001 절차)
- [ ] Applications에서 앱 제거 후 잔여 파일 없음 확인 (`~/Library/Application Support/forktail` 등)

### Windows

- [ ] clean VM (Windows 11)에서 NSIS `.exe` 설치
- [ ] 첫 실행 시 SmartScreen "Windows가 PC를 보호했습니다" 경고 표시 확인
- [ ] 시작 화면, 2-way, 폴더, 3-way 화면 정상 렌더링
- [ ] 설정 → 앱에서 제거 후 잔여 파일 없음 확인 (`%APPDATA%\forktail` 등)
- [ ] **SAV-007 검증**: 파일 저장, 덮어쓰기, 백업 생성 정상 동작 (Windows CI 테스트 통과 필수)

### Linux

- [ ] clean VM (oldest supported baseline)에서 `.AppImage` 실행 (`chmod +x` 후)
- [ ] 시작 화면, 2-way, 폴더, 3-way 화면 정상 렌더링
- [ ] WebKitGTK 의존성 누락 시 행동 가능한 오류 메시지 표시 확인
- [ ] AppImage 파일 삭제로 제거 완료

> **주의**: SAV-007은 "macOS/Linux 성공으로 완료 처리하지 않는다" (`docs/14_PRODUCT_GAP_ROADMAP.md`). Windows VM 또는 GitHub Actions Windows runner에서의 검증이 필수다.

---

## 2. 서명 여부와 OS 경고 문서화

서명 상태가 사용자에게 명확히 전달되는지 확인한다. 서명 자체가 아닌 **문서화**가 필수 항목이다.

- [ ] `docs/RELEASE_SIGNING_POLICY.md` 존재 및 현재 서명 상태 명시
- [ ] 릴리스 노트에 "Security status" 섹션 포함 (서명되지 않았음 명시)
- [ ] README에 "소스 빌드 경로" 안내 포함 (서명되지 않은 산출물에 대한 대안)
- [ ] macOS Gatekeeper, Windows SmartScreen 경고 내용이 문서와 일치
- [ ] 서명 상태 변경 시 `docs/RELEASE_SIGNING_POLICY.md`와 릴리스 노트 템플릿 동시 갱신

---

## 3. Release artifact checksum 공개

모든 릴리스 산출물의 무결성을 검증할 수 있어야 한다.

- [ ] `release.yml`의 `draft-release` 잡에서 `checksums.txt` 생성 (SHA-256)
- [ ] `checksums.txt`가 release 에셋에 포함됨
- [ ] checksums에 macOS DMG, Windows NSIS, Linux AppImage, SBOM, NOTICE 모두 포함
- [ ] 사용자가 `shasum -a 256 -c checksums.txt`로 검증 가능 (사용법 문서화)

---

## 4. Beta 사용자 fixture 기반 오류 0건 또는 알려진 이슈 문서화

beta 사용자가 실제 사용하면서 발견한 오류를 추적하고, 해결되지 않은 이슈를 문서화한다.

### 검증 절차

- [ ] beta 테스트용 fixture 세트 준비 (`npm run smoke:runtime:prepare`로 생성된 fixture 사용)
- [ ] beta 사용자에게 fixture 기반 smoke 절차 전달 (RTM-001 체크리스트)
- [ ] 수집된 오류 리포트 분류 (blocker / major / minor)
- [ ] blocker 0건 확인
- [ ] 미해결 이슈를 "Known Issues" 섹션에 문서화 (아래 템플릿)

### Known Issues 템플릿 (릴리스 노트에 포함)

```markdown
## Known Issues

- **[ISSUE-ID 또는 설명]**: 증상, 재현 조건, 회피 방법, 영향 범위.
  예: Windows에서 매우 긴 경로(260자 초과) 저장 시 오류 발생 가능.
  회피: 짧은 경로로 파일 이동 후 저장.
```

---

## REL-007 SBOM/NOTICE 검증 (별도 항목)

SBOM/NOTICE 생성은 M5 종료 조건은 아니지만, `docs/12_DEFINITION_OF_DONE.md`의 Beta Release DoD에 포함된다.

- [ ] `npm run sbom:generate`가 `dist/sbom/`에 파일 생성
- [ ] `forktail-npm.cdx.json` 존재 (CycloneDX, transitive 의존성 포함)
- [ ] `NOTICE.txt` 존재 (직접 의존성 라이선스)
- [ ] release 워크플로우에서 SBOM/NOTICE가 release 에셋으로 업로드됨
- [ ] (공개 릴리스 시) `cargo cyclonedx`로 Rust SBOM도 생성됨

---

## 완료 기준

위 체크리스트의 모든 필수 항목이 체크되면:

1. `docs/12_DEFINITION_OF_DONE.md` §5 Beta Release DoD의 모든 blocker 해결
2. 릴리스를 draft → 공개(non-prerelease)로 전환 검토
3. `VALIDATION.md`에 M5 완료 결과 기록

하나라도 미해결이면 릴리스는 prerelease로 유지한다.
