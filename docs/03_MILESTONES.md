# 03. Milestones

각 milestone은 앞 단계의 종료 조건을 만족한 뒤 시작한다. 일정이 아니라 **의존 관계와 품질 게이트**다.

## M0. 저장소와 빌드 기반

목표: 모든 기여자가 같은 명령으로 앱을 실행하고 검증한다.

포함:

- Tauri/React/Monaco 골격
- Rust command 계약
- 프런트 단위 테스트
- CI
- fixture 디렉터리
- AGENTS/PRD/architecture

종료 조건:

- `npm run check` 통과
- Windows/macOS/Linux에서 `npm run tauri dev` 실행 확인
- Rust fmt/clippy/test 통과
- GitHub branch protection 설정

관련 이슈: `FND-001`~`FND-006`

## M1. 신뢰할 수 있는 2-way 텍스트 비교

목표: 사용자가 기존 비교 도구 대신 매일 파일 두 개를 열 수 있다.

포함:

- 파일 열기·메타데이터
- side-by-side/inline
- 변경 탐색
- 공백/대소문자/EOL 옵션
- 마지막 개행 표시
- binary/large file 오류
- drag & drop 및 CLI open

종료 조건:

- TXT fixture 전체 통과
- 변경 100개 파일을 키보드로 순회
- 파일 재선택 없이 좌우 교환
- 64 MiB 초과 파일의 안전한 거절

관련 이슈: `TXT-001`~`TXT-010`

## M2. 폴더 비교

목표: 두 폴더의 차이를 한 화면에서 분류하고 변경 파일을 연다.

포함:

- metadata/quick/full 비교
- 상태 필터
- 경로 필터
- 숨김/gitignore/symlink 옵션
- progress/cancel
- 가상 스크롤
- scan cache

종료 조건:

- 10,000 파일 fixture/생성 데이터에서 UI 멈춤 없음
- 권한 오류가 전체 스캔을 중단하지 않음
- Full hash 결과가 기준 스크립트와 일치
- 폴더 행에서 2-way로 왕복

관련 이슈: `FOL-001`~`FOL-011`

## M3. 3-way merge

목표: line-based 자동 병합과 수동 충돌 해결을 안전하게 끝낸다.

포함:

- diffy merge
- conflict 파서/탐색
- OURS/THEIRS/BASE/BOTH
- 직접 편집
- undo/redo
- save/save as
- 외부 변경 경고

종료 조건:

- clean/conflict fixture 전체 통과
- 충돌을 앞/중간/뒤 순서와 무관하게 해결 가능
- 마커를 직접 편집해도 count 정확
- 실패한 저장이 원본을 손상시키지 않음

관련 이슈: `MRG-001`~`MRG-011`, `SAV-001`~`SAV-006`

## M4. 데스크톱 완성도

목표: 개인용 도구가 아니라 배포 가능한 앱이 된다.

포함:

- native menu/shortcuts
- recent sessions/settings
- file watcher
- 접근성
- crash-safe session recovery
- logging/privacy
- 성능 프로파일링
- 아이콘/브랜딩

종료 조건:

- UX smoke checklist 완료
- 키보드-only 사용 가능
- 200% 확대 검증
- 네트워크 요청 0 확인
- 라이선스 고지/SBOM 생성

관련 이슈: `UX-001`~`UX-008`, `SEC-001`~`SEC-006`, `PERF-001`~`PERF-005`

## M5. Beta 배포

목표: 세 운영체제에서 설치·업데이트 가능한 beta를 배포한다.

포함:

- Windows MSI/NSIS
- macOS dmg/app bundle
- Linux deb/AppImage
- 릴리스 CI
- checksum
- 선택적 코드 서명
- rollback 문서

종료 조건:

- clean VM 설치/제거
- 서명 여부와 OS 경고 문서화
- release artifact checksum 공개
- beta 사용자 fixture 기반 오류 0건 또는 알려진 이슈 문서화

관련 이슈: `REL-001`~`REL-009`

## M6. AI Phase 2 — 별도 의사결정

시작 조건:

- M5 완료
- line-based merge benchmark 고정
- 사용자가 해결한 충돌 fixture가 충분히 축적
- AI가 틀려도 파일을 손상시키지 않는 review/apply 경계 완성

AI 코드는 기존 merge engine을 대체하지 않고 suggestion provider로만 추가한다. 자세한 내용은 `docs/11_AI_PHASE2.md`를 따른다.
