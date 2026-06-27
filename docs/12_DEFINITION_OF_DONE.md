# 12. Definition of Done

## 1. Issue DoD

모든 이슈는 다음을 만족해야 완료다.

- [ ] 이슈 ID와 수용 기준이 있다.
- [ ] 범위 밖 변경이 섞이지 않았다.
- [ ] 정상·경계·실패 테스트가 추가/갱신되었다.
- [ ] TypeScript strict와 Rust clippy 경고가 없다.
- [ ] 사용자 파일 내용을 로그하지 않는다.
- [ ] 데이터 계약 변경 시 TS/Rust 양쪽이 갱신되었다.
- [ ] 관련 문서가 현재 동작과 일치한다.
- [ ] 실행한 검증 결과가 PR에 기록되어 있다.
- [ ] 실행하지 못한 OS/manual 검증이 표시되어 있다.
- [ ] reviewer의 blocker/high finding이 해결되었다.

## 2. Merge/Save 변경 추가 DoD

- [ ] fixture exact output 테스트
- [ ] 실패 주입 또는 최소한 실패 경로 테스트
- [ ] 기존 target 보존 검증
- [ ] no-final-newline/EOL 고려
- [ ] Unicode text 고려
- [ ] undo/dirty state 고려
- [ ] 외부 변경 race 고려

## 3. UI 기능 추가 DoD

- [ ] mouse와 keyboard 동작
- [ ] focus indicator
- [ ] 색상 외 상태 표현
- [ ] empty/loading/error/disabled 상태
- [ ] 좁은 창/200% 확대 확인
- [ ] Monaco command 충돌 확인

## 4. Milestone DoD

- [ ] milestone 관련 이슈 완료
- [ ] fixture suite 통과
- [ ] 성능 baseline 기록
- [ ] 알려진 제한 문서화
- [ ] 다음 milestone 시작을 막는 blocker 없음
- [ ] 한 명/한 모델이 아닌 독립 review 수행

## 5. Beta Release DoD

### 기능

- [ ] 2-way diff navigation/option 완성
- [ ] folder compare progress/cancel/filter 완성
- [ ] 3-way conflict resolution/save 완성
- [ ] recent/settings/unsaved guard 완성

### 데이터 안전

- [ ] 플랫폼별 atomic replace 검증
- [ ] backup/restore 검증
- [ ] external modification guard
- [ ] encoding/EOL round-trip matrix
- [ ] crash/fault cases

### 플랫폼

- [ ] Windows clean VM
- [ ] macOS clean user account
- [ ] Linux oldest supported baseline
- [ ] Unicode/long path/file lock smoke

### 보안/개인정보

- [ ] release CSP
- [ ] capability 최소화
- [ ] network request 0 또는 updater opt-in 명시
- [ ] dependency audit triage
- [ ] NOTICE/SBOM

### 배포

- [ ] version/tag 일치
- [ ] installer install/upgrade/uninstall
- [ ] checksum
- [ ] signing 상태 명확
- [ ] rollback/known issues

하나라도 blocker가 남으면 stable이 아니라 prerelease로 배포한다.
