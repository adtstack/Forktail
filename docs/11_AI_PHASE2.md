# 11. AI Phase 2 Boundary

이 문서는 지금 AI를 구현하라는 계획이 아니라, Phase 1 아키텍처가 AI 때문에 오염되지 않도록 경계를 정한다.

## 1. 시작 조건

다음이 모두 충족되기 전 AI 코드를 merge하지 않는다.

- 기본 3-way merge와 save가 stable
- conflict fixture와 benchmark 고정
- 사용자가 선택한 conflict만 안전하게 교체하는 API 완성
- suggestion 적용 전 diff preview 완성
- network/privacy 설정 화면과 동의 설계
- 실패/timeout/cancel 시 deterministic result 유지

## 2. 역할

AI는 다음만 할 수 있다.

- 선택한 conflict에 대한 후보 텍스트 제안
- 제안 이유 요약
- 위험 신호 표시

AI는 다음을 하지 않는다.

- 자동 저장
- 전체 파일 무검토 교체
- 숨은 background 업로드
- deterministic merge engine 대체
- 테스트 실행 결과 위조

## 3. Extension contract

개념적 인터페이스:

```ts
interface MergeSuggestionRequest {
  language: string;
  base: string;
  ours: string;
  theirs: string;
  surroundingContext: string;
  userInstruction?: string;
}

interface MergeSuggestion {
  proposedText: string;
  explanation: string;
  warnings: string[];
  provider: string;
}

interface MergeSuggestionProvider {
  suggest(request: MergeSuggestionRequest, signal: AbortSignal): Promise<MergeSuggestion>;
}
```

provider는 다음이 될 수 있다.

- local model
- user-configured cloud API
- CLI adapter

core merge UI는 provider 종류를 모른다.

## 4. 데이터 최소화

기본 요청 범위는 active conflict + 제한된 주변 문맥이다. 전체 저장소 전송은 별도 opt-in이다.

UI는 요청 전에 보여준다.

- 어떤 텍스트가 전송되는지
- 어느 provider인지
- 보존 정책 링크
- 취소 버튼

secret/file pattern redaction은 보조 장치일 뿐 완전한 보호로 표현하지 않는다.

## 5. 적용 흐름

```text
active conflict 선택
  → AI 요청 (명시적)
  → suggestion 도착
  → current result vs suggestion diff
  → Apply / Edit / Reject
  → 적용 시 undo history에 한 transaction
  → 저장은 별도 사용자 행동
```

## 6. 평가

AI 성공은 "그럴듯함"이 아니라 benchmark로 평가한다.

- exact or semantic correctness
- tests passing where fixture includes tests
- hallucinated symbol rate
- user edit distance after suggestion
- reject rate
- latency/cost
- secret exposure incidents

AI가 baseline line merge보다 나쁜 경우를 포함해 결과를 공개적으로 기록한다.

## 7. Phase 2 후보 기능 순서

1. conflict explain
2. one-conflict suggestion
3. structured JSON/YAML merge
4. AST-aware code merge
5. repository context opt-in

전체 파일 자동 병합은 마지막에도 기본 off다.
