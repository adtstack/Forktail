# 06. Copy-paste Prompt Pack

아래 프롬프트의 `<...>`만 바꿔 사용한다.

## A. 저장소 첫 감사

```text
이 저장소의 AGENTS.md, docs/01_PRD.md, docs/02_ARCHITECTURE.md,
docs/03_MILESTONES.md를 읽어라. 코드는 수정하지 마라.

목표:
1. 현재 구현과 문서 요구사항의 차이를 milestone별로 정리한다.
2. 데이터 손실, cross-platform, 성능 위험을 우선순위로 정리한다.
3. docs/04_BACKLOG.md의 첫 10개 이슈가 올바른 순서인지 검토한다.
4. 즉시 고쳐야 하는 build blocker만 별도로 표시한다.

출력:
- Current state
- Highest risks
- Recommended next 5 issues
- Questions/assumptions

근거가 되는 파일과 심볼을 정확히 적어라. 구현하지 마라.
```

## B. 한 이슈 계획

```text
AGENTS.md를 먼저 읽어라.

작업: <ISSUE_ID> <ISSUE_TITLE>
수용 기준:
<ACCEPTANCE_CRITERIA>

코드를 수정하지 말고 구현 계획만 작성하라.
반드시 포함:
- 현재 관련 코드 흐름
- 변경할 파일과 이유
- 데이터 계약 변경 여부
- 테스트 케이스(정상/경계/실패)
- cross-platform 위험
- 가장 작은 구현 순서

이슈 범위 밖 개선은 후속 이슈로만 적어라.
```

## C. 한 이슈 구현

```text
AGENTS.md와 아래 문서를 읽고 이슈 하나만 구현하라.
- docs/01_PRD.md
- docs/02_ARCHITECTURE.md
- docs/07_TEST_PLAN.md

Issue: <ISSUE_ID> <ISSUE_TITLE>
Acceptance criteria:
<ACCEPTANCE_CRITERIA>

Constraints:
- 관련 없는 리팩터링 금지
- 새 dependency는 꼭 필요한 경우만 추가하고 이유/라이선스/대안을 보고
- 저장과 merge 변경은 failure test 필수
- TS/Rust 직렬화 계약을 함께 유지
- Phase 1에 AI/network 기능 추가 금지

작업 후 실행:
<npm or cargo commands>

완료 보고 형식:
구현
- ...
검증
- command: result
주의/후속
- ...

실행하지 않은 검증을 통과했다고 쓰지 마라.
```

## D. PR 리뷰

```text
AGENTS.md, 이슈 <ISSUE_ID>, 현재 PR diff를 검토하라.
직접 수정하지 말고 review comment만 작성하라.

우선순위:
1. 데이터 손실/잘못된 merge
2. race/stale state/cancellation
3. Windows/macOS/Linux 차이
4. encoding/EOL/path edge case
5. 테스트 누락
6. 접근성/UX

각 finding에 다음을 포함:
- severity: blocker/high/medium/low
- file:line 또는 symbol
- 실패 시나리오
- 최소 수정 제안

취향성 comment는 제외하고, finding이 없으면 그 사실과 남은 검증 공백을 적어라.
```

## E. 실패 테스트 수정

```text
다음 실패를 분석하라.
<TEST_OUTPUT>

규칙:
- 테스트 삭제, skip, assertion 완화 금지
- 원인과 증상을 구분
- 가장 작은 재현을 먼저 만든다
- 최근 변경이 계약을 깨뜨렸는지 확인한다
- 수정 후 관련 테스트와 전체 gate를 실행한다

먼저 원인 가설 1~3개와 확인 방법을 적고, 그 다음 수정하라.
```

## F. 저장 안전성 전용

```text
SAV-<ID>를 구현/리뷰한다. docs/09_RELEASE_SECURITY.md를 반드시 읽어라.

다음 failure point를 각각 다뤄라:
- temp create 실패
- partial write
- flush/sync 실패
- target이 외부에서 변경됨
- backup 실패
- replace 실패
- Windows에서 target in use
- process crash 직전/직후

기존 파일이 보존된다는 자동 테스트 없이 완료하지 마라.
```

## G. 3-way merge fixture 생성

```text
MRG-001용 결정론적 fixture를 추가하라.
각 fixture는 base.txt, ours.txt, theirs.txt, expected.txt, metadata.json으로 구성한다.

필수 범주:
- non-overlapping edits
- identical overlapping edit
- conflicting replace
- insert at same location
- delete vs modify
- repeated lines
- empty files
- no final newline
- CRLF
- conflict-marker-like user text

fixture 이름은 실패 의미가 드러나게 하고, 외부 저작물 텍스트를 복사하지 마라.
```

## H. 성능 작업

```text
Issue <PERF_ID>를 다룬다. 최적화 전에 baseline을 측정하라.

보고:
- workload/fixture
- 측정 방법과 환경
- p50/p95 또는 반복 결과
- CPU/메모리/UI blocking 중 병목
- 변경 전후
- correctness regression tests

측정 없는 구조 변경은 하지 마라.
```

## I. 릴리스 후보 감사

```text
이 저장소를 Phase 1 beta 후보로 감사하라.
코드는 수정하지 마라.

기준:
- docs/12_DEFINITION_OF_DONE.md
- docs/07_TEST_PLAN.md
- docs/09_RELEASE_SECURITY.md

출력:
- Pass
- Blockers
- Platform-specific gaps
- Manual tests still required
- Release/no-release recommendation

CI가 실행한 것과 사람이 확인해야 하는 것을 구분하라.
```
