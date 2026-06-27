# 05. AI Coding Playbook

## 1. 핵심 운영 원칙

AI에게 "Beyond Compare 같은 앱 전부 만들어"라고 맡기지 않는다. AI는 큰 목표보다 **작은 계약, 명확한 fixture, 즉시 실행 가능한 검증 명령**이 있을 때 잘한다.

좋은 작업 크기:

- conflict parser가 CRLF를 처리하게 만들기
- 다음 diff 버튼과 단축키 추가하기
- save 전에 mtime precondition 확인하기

나쁜 작업 크기:

- 폴더 비교 완성하기
- UX 개선하기
- 안정화하기

## 2. 권장 역할 분리

같은 에이전트를 쓰더라도 한 세션에 한 역할만 준다.

### Planner

- 코드 수정 금지
- 관련 파일과 위험을 찾음
- 수용 기준을 테스트 케이스로 변환
- 최소 변경 계획 작성

### Implementer

- 승인된 계획과 이슈 하나만 구현
- 테스트를 먼저 또는 동시에 추가
- 전체 리팩터링 금지

### Reviewer

- diff만 보고 correctness, data loss, race, cross-platform을 검토
- 스타일 취향보다 수용 기준을 우선
- 직접 고치기 전 actionable comment 작성

### Verifier

- 명령 실행
- 실패 원인 최소화
- 실행하지 못한 항목 명시

## 3. 한 이슈 처리 루프

```text
1. Issue 생성
2. Planner prompt
3. 계획 검토
4. Implementer prompt
5. 자동 테스트
6. Reviewer prompt
7. 수정
8. 전체 gate
9. PR merge
```

AI가 계획 중 범위를 넓히면 작업을 나눈다. "함께 하면 쉽다"는 이유로 이슈를 합치지 않는다.

## 4. 컨텍스트 제공 방식

항상 전달:

- 이슈 ID와 본문
- `AGENTS.md`
- 관련 PRD/architecture section
- 실패 중인 테스트나 재현 명령

필요할 때만 전달:

- 전체 로그
- 스크린샷
- 큰 파일
- 다른 milestone 문서

코드베이스 전체를 프롬프트에 붙이지 않는다. 에이전트가 저장소에서 읽게 한다.

## 5. 작업 계약

에이전트에게 다음을 명시한다.

```text
허용:
- 지정 파일과 직접 관련 테스트 수정
- 작은 helper 추가

금지:
- 새 상태관리/디자인 시스템 도입
- package major upgrade
- public API rename
- unrelated formatting
- AI/network 기능 추가
```

## 6. 테스트 우선순위

1. 데이터 손실 가능성이 있는 save/merge
2. 직렬화 계약
3. path/encoding/EOL 경계
4. UI interaction
5. visual polish

UI 테스트가 어려우면 먼저 순수 함수로 로직을 뺀다. DOM snapshot으로 알고리즘을 검증하지 않는다.

## 7. AI가 자주 만드는 실수와 방어

### stale offsets

충돌 하나를 교체한 뒤 이전 offset 목록을 계속 사용한다.

방어: 결과 문자열 변경 후 conflict 전체를 다시 파싱하는 테스트를 둔다.

### destructive save

`fs::write(target)`로 기존 파일을 먼저 잘라낸다.

방어: fault injection 테스트와 atomic save service 단일 경로를 강제한다.

### platform path assumption

`/` split, case-sensitive key, Windows rename semantics를 가정한다.

방어: Path/PathBuf와 플랫폼 fixture를 사용하고 path display와 identity를 분리한다.

### UI-only correctness

Monaco 색상만 보고 diff 로직이 맞다고 가정한다.

방어: core fixture에서 expected hunks/merge output을 검증한다.

### dependency shopping

작은 기능마다 라이브러리를 추가한다.

방어: 새 dependency는 ADR 또는 PR 설명에 라이선스, 유지보수, 대안, bundle impact를 적는다.

### fake verification

실행하지 않은 cargo test를 통과했다고 쓴다.

방어: 완료 응답 형식을 강제하고 CI가 최종 진실이 되게 한다.

## 8. 커밋과 PR 규칙

권장 커밋:

```text
feat(merge): add conflict navigation
fix(save): preserve target on failed replace
perf(folder): batch scan progress events
```

PR 본문:

```text
Issue: MRG-003

What
- ...

Why
- ...

Tests
- [x] npm test
- [x] cargo test
- [ ] Windows manual smoke (not available)

Risks
- ...
```

## 9. 모델 선택

- 작은 UI/테스트: 빠른 코딩 모델
- 저장·동시성·cross-platform: 가장 강한 reasoning 모델 + 별도 reviewer
- 문서/이슈 분해: 일반 모델
- 대규모 변경: 한 모델이 구현하고 다른 모델이 리뷰

모델 이름보다 역할 분리와 테스트가 중요하다.

## 10. 범위 제어 문장

프롬프트 끝에 항상 추가한다.

```text
이슈 수용 기준 밖의 개선은 구현하지 말고 후속 이슈 후보로만 적어라.
모든 기존 테스트를 유지하고, 실행하지 못한 검증은 사실대로 보고하라.
```
