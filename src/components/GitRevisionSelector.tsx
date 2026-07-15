import type { FormEvent } from "react";
import type { GitRefLoadState, GitRevisionFieldState } from "../core/gitSession";
import type { GitRefKind, GitRepositoryRef, GitRepositorySummary } from "../core/gitModels";
import type { AppLanguage } from "../core/settings";

interface GitRevisionSelectorProps {
  side: "left" | "right";
  repository: GitRepositorySummary;
  references: GitRefLoadState;
  state: GitRevisionFieldState;
  languageMode?: AppLanguage;
  onInputChange: (input: string) => void;
  onSubmit: (input: string) => void;
}

const TEXT = {
  en: {
    left: "Left",
    right: "Right",
    choices: "revision choices",
    input: "revision input",
    choose: "Choose a local revision",
    current: "Current",
    localBranches: "Local branches",
    remoteRefs: "Remote-tracking refs",
    tags: "Tags",
    headDetached: "HEAD — detached",
    headBranch: (name: string) => `HEAD — current branch ${name}`,
    loadingRefs: "Loading local revisions…",
    refsTruncated: "Only the first local revisions are shown. Manual input remains available.",
    manualHint: "Enter a branch, tag, commit ID, or advanced revision such as HEAD@{1}.",
    validate: "Validate revision",
    validating: "Validating revision…",
    resolved: (shortId: string) => `Resolved ${shortId}`,
  },
  ko: {
    left: "왼쪽",
    right: "오른쪽",
    choices: "revision 선택",
    input: "revision 입력",
    choose: "로컬 revision 선택",
    current: "현재",
    localBranches: "로컬 branch",
    remoteRefs: "원격 추적 ref",
    tags: "Tag",
    headDetached: "HEAD — 분리됨",
    headBranch: (name: string) => `HEAD — 현재 branch ${name}`,
    loadingRefs: "로컬 revision을 불러오는 중…",
    refsTruncated: "일부 로컬 revision만 표시합니다. 직접 입력은 계속 사용할 수 있습니다.",
    manualHint: "branch, tag, commit ID 또는 HEAD@{1} 같은 고급 revision을 입력하세요.",
    validate: "Revision 검증",
    validating: "Revision을 검증하는 중…",
    resolved: (shortId: string) => `확정 ${shortId}`,
  },
} as const;

const GROUPS: { kind: GitRefKind; textKey: "localBranches" | "remoteRefs" | "tags" }[] = [
  { kind: "localBranch", textKey: "localBranches" },
  { kind: "remoteTrackingBranch", textKey: "remoteRefs" },
  { kind: "tag", textKey: "tags" },
];

export function GitRevisionSelector({
  side,
  repository,
  references,
  state,
  languageMode = "en",
  onInputChange,
  onSubmit,
}: GitRevisionSelectorProps) {
  const text = TEXT[languageMode];
  const sideLabel = text[side];
  const refs = references.kind === "ready" ? references.list.refs : [];
  const optionValues = new Set(["HEAD", ...refs.map((reference) => reference.fullName)]);
  const selectValue = optionValues.has(state.input) ? state.input : "";

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit(state.input);
  };

  return (
    <section className="git-revision-selector" aria-label={`${sideLabel} revision`}>
      <h2>{sideLabel}</h2>
      <label className="git-revision-field">
        <span>{text.choose}</span>
        <select
          role="combobox"
          aria-label={`${sideLabel} ${text.choices}`}
          value={selectValue}
          disabled={state.phase === "validating"}
          onChange={(event) => {
            const input = event.currentTarget.value;
            if (!input) return;
            onInputChange(input);
            onSubmit(input);
          }}
        >
          <option value="">{text.choose}</option>
          {repository.head.kind !== "unborn" && (
            <optgroup label={text.current}>
              <option value="HEAD">
                {repository.head.kind === "branch"
                  ? text.headBranch(repository.head.displayName)
                  : text.headDetached}
              </option>
            </optgroup>
          )}
          {GROUPS.map((group) => {
            const options = refs.filter((reference) => reference.kind === group.kind);
            return options.length > 0 ? (
              <optgroup key={group.kind} label={text[group.textKey]}>
                {options.map((reference) => (
                  <GitRefOption key={reference.fullName} reference={reference} />
                ))}
              </optgroup>
            ) : null;
          })}
        </select>
      </label>

      {references.kind === "loading" && <p role="status">{text.loadingRefs}</p>}
      {references.kind === "error" && <p className="git-revision-error">{references.message}</p>}
      {references.kind === "ready" && references.list.truncated && (
        <p className="git-revision-note">{text.refsTruncated}</p>
      )}

      <form className="git-revision-form" onSubmit={submit}>
        <label className="git-revision-field">
          <span>{text.manualHint}</span>
          <input
            aria-label={`${sideLabel} ${text.input}`}
            value={state.input}
            spellCheck={false}
            autoCapitalize="none"
            autoCorrect="off"
            disabled={state.phase === "validating"}
            onChange={(event) => onInputChange(event.currentTarget.value)}
          />
        </label>
        <button
          type="submit"
          disabled={state.input.length === 0 || state.phase === "validating"}
        >
          {text.validate}
        </button>
      </form>

      {state.phase === "validating" && <p role="status">{text.validating}</p>}
      {state.phase === "resolved" && state.revision && (
        <p className="git-revision-resolved" role="status">
          {text.resolved(state.revision.resolved.hex.slice(0, 12))}
        </p>
      )}
      {state.phase === "error" && state.error && (
        <p className="git-revision-error" role="alert">{state.error}</p>
      )}
    </section>
  );
}

function GitRefOption({ reference }: { reference: GitRepositoryRef }) {
  return <option value={reference.fullName}>{reference.displayName}</option>;
}
