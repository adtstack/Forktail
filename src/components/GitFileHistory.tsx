import type { GitFileHistoryEntry, GitPathIdentity } from "../core/gitModels";
import {
  gitFileHistoryCompareRequest,
  toggleGitFileHistorySelection,
  type GitFileHistoryLoadState,
  type GitSnapshotSelectionState,
} from "../core/gitSession";
import type { AppLanguage } from "../core/settings";

interface GitFileHistoryProps {
  path: GitPathIdentity;
  state: GitFileHistoryLoadState;
  selectedCommitIds: string[];
  openState: GitSnapshotSelectionState;
  languageMode?: AppLanguage;
  onLoad: () => void;
  onCancel: () => void;
  onSelectionChange: (selectedCommitIds: string[]) => void;
  onCompare: () => void;
}

const TEXT = {
  en: {
    title: "File history",
    load: "Load local history",
    loading: "Loading local file history…",
    cancel: "Cancel history load",
    retry: "Retry local history",
    localOnly: "Only local history is shown. Forktail never fetches missing history.",
    truncated: "The result reached the 500 commit safety limit.",
    empty: "No local commits were found for this path.",
    compare: "Compare selected snapshots",
    selectHint: "Select two available commits to open the existing read-only snapshot diff.",
    renameBoundary: "Rename boundary",
    shallowBoundary: "Shallow boundary",
    objectUnavailable: "Snapshot unavailable at this commit",
    loadingSnapshot: "Opening selected immutable snapshots…",
    snapshotNotice: "One or both selected snapshots cannot be opened as text.",
  },
  ko: {
    title: "파일 이력",
    load: "로컬 이력 불러오기",
    loading: "로컬 파일 이력을 불러오는 중…",
    cancel: "이력 불러오기 취소",
    retry: "로컬 이력 다시 시도",
    localOnly: "로컬 이력만 표시합니다. Forktail은 누락된 이력을 fetch하지 않습니다.",
    truncated: "결과가 commit 500개 안전 한도에 도달했습니다.",
    empty: "이 경로의 로컬 commit을 찾지 못했습니다.",
    compare: "선택한 snapshot 비교",
    selectHint: "사용 가능한 commit 두 개를 선택해 기존 읽기 전용 snapshot diff로 여세요.",
    renameBoundary: "이름 변경 경계",
    shallowBoundary: "Shallow 경계",
    objectUnavailable: "이 commit의 snapshot을 사용할 수 없음",
    loadingSnapshot: "선택한 immutable snapshot을 여는 중…",
    snapshotNotice: "선택한 snapshot 중 하나 이상을 텍스트로 열 수 없습니다.",
  },
} as const;

const BOUNDARY_CLASS: Record<GitFileHistoryEntry["boundary"], string> = {
  normal: "",
  renameBoundary: "is-rename-boundary",
  shallowBoundary: "is-shallow-boundary",
  objectUnavailable: "is-unavailable",
};

export function GitFileHistory({
  path,
  state,
  selectedCommitIds,
  openState,
  languageMode = "en",
  onLoad,
  onCancel,
  onSelectionChange,
  onCompare,
}: GitFileHistoryProps) {
  const text = TEXT[languageMode];
  const entries = state.kind === "ready" ? state.list.entries : [];
  const canCompare = state.kind === "ready"
    && gitFileHistoryCompareRequest(entries, selectedCommitIds, state.list.generation) !== null;

  return (
    <section className="git-file-history" aria-label={text.title}>
      <header className="git-file-history-header">
        <div>
          <h2>{text.title}</h2>
          <code title={path.displayPath}>{path.displayPath}</code>
        </div>
        {state.kind === "idle" && (
          <button type="button" onClick={onLoad}>{text.load}</button>
        )}
        {state.kind === "loading" && (
          <button type="button" onClick={onCancel}>{text.cancel}</button>
        )}
        {state.kind === "error" && (
          <button type="button" onClick={onLoad}>{text.retry}</button>
        )}
      </header>

      {state.kind === "loading" && <p role="status">{text.loading}</p>}
      {state.kind === "error" && <p role="alert">{state.message}</p>}
      {state.kind === "ready" && (
        <>
          {(state.list.shallow || state.list.entries.some((entry) =>
            entry.boundary === "shallowBoundary")) && (
            <p className="git-file-history-notice">{text.localOnly}</p>
          )}
          {state.list.truncated && (
            <p className="git-file-history-notice">{text.truncated}</p>
          )}
          {entries.length === 0 ? (
            <p role="status">{text.empty}</p>
          ) : (
            <ol className="git-file-history-list">
              {entries.map((entry) => {
                const selected = selectedCommitIds.includes(entry.commitId.hex);
                const disabled = entry.boundary === "objectUnavailable";
                return (
                  <li key={entry.commitId.hex} className={BOUNDARY_CLASS[entry.boundary]}>
                    <button
                      type="button"
                      aria-pressed={selected}
                      disabled={disabled}
                      onClick={() => onSelectionChange(
                        toggleGitFileHistorySelection(selectedCommitIds, entry),
                      )}
                    >
                      <span className="git-file-history-subject">{entry.subject}</span>
                      <code>{entry.shortDisplayId}</code>
                      <time dateTime={timestampDateTime(entry.authorTimestamp)}>
                        {formatTimestamp(entry.authorTimestamp, languageMode)}
                      </time>
                      <span>{entry.pathAtCommit.displayPath}</span>
                      {entry.boundary !== "normal" && (
                        <strong>{boundaryLabel(entry.boundary, text)}</strong>
                      )}
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
          <footer className="git-file-history-actions">
            <p>{text.selectHint}</p>
            <button type="button" disabled={!canCompare} onClick={onCompare}>
              {text.compare}
            </button>
          </footer>
        </>
      )}

      {openState.kind === "loading" && <p role="status">{text.loadingSnapshot}</p>}
      {openState.kind === "notice" && <p role="status">{text.snapshotNotice}</p>}
      {openState.kind === "error" && <p role="alert">{openState.message}</p>}
    </section>
  );
}

function boundaryLabel(
  boundary: GitFileHistoryEntry["boundary"],
  text: (typeof TEXT)[AppLanguage],
): string {
  if (boundary === "renameBoundary") return text.renameBoundary;
  if (boundary === "shallowBoundary") return text.shallowBoundary;
  if (boundary === "objectUnavailable") return text.objectUnavailable;
  return "";
}

function timestampDateTime(timestamp: number): string {
  return new Date(timestamp * 1000).toISOString();
}

function formatTimestamp(timestamp: number, languageMode: AppLanguage): string {
  return new Intl.DateTimeFormat(languageMode === "ko" ? "ko-KR" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(timestamp * 1000));
}
