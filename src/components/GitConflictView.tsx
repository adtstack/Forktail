import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { GitConflictEntry } from "../core/gitModels";
import {
  gitConflictEntryKey,
  nextGitConflictEntryKey,
  type GitConflictLoadState,
  type GitConflictOpenState,
} from "../core/gitSession";
import type { AppLanguage } from "../core/settings";

const ROW_HEIGHT = 76;
const MAX_RENDERED_ROWS = 80;
const OVERSCAN_ROWS = 10;

interface GitConflictViewProps {
  state: GitConflictLoadState;
  selectedKey: string | null;
  openState: GitConflictOpenState;
  languageMode?: AppLanguage;
  onRefresh: () => void;
  onSelect: (entry: GitConflictEntry) => void;
}

const TEXT = {
  en: {
    title: (count: number) => `Conflicts ${count}`,
    refresh: "Refresh conflicts",
    loading: "Loading conflicts…",
    empty: "No unmerged paths remain. Refresh status if Git changed outside Forktail.",
    truncated: "The conflict list reached the 10,000 path safety limit.",
    open: "Open Result editor",
    opening: "Opening conflict stages and Result…",
    base: "Base",
    ours: "Ours",
    theirs: "Theirs",
    present: "present",
    missing: "missing",
    kinds: {
      bothModified: "Both modified",
      bothAdded: "Both added",
      deletedByOurs: "Deleted by ours",
      deletedByTheirs: "Deleted by theirs",
      bothDeleted: "Both deleted",
      typeChange: "Type change",
      unknown: "Unmerged",
    },
    operations: {
      merge: "Merge",
      rebase: "Rebase",
      cherryPick: "Cherry-pick",
      revert: "Revert",
      unknown: "Git operation",
    },
    binary: "Binary conflicts cannot be edited as text.",
    nonText: "This conflict contains a non-text, symlink, submodule, unavailable, or oversized state.",
    nextStep: "Forktail never runs git add or continue. Complete those steps in a terminal.",
  },
  ko: {
    title: (count: number) => `충돌 ${count}개`,
    refresh: "충돌 새로고침",
    loading: "충돌을 불러오는 중…",
    empty: "남은 unmerged path가 없습니다. 외부에서 Git 상태가 바뀌었다면 새로고침하세요.",
    truncated: "충돌 목록이 10,000개 안전 한도에 도달했습니다.",
    open: "Result 편집기 열기",
    opening: "충돌 stage와 Result를 여는 중…",
    base: "Base",
    ours: "Ours",
    theirs: "Theirs",
    present: "있음",
    missing: "없음",
    kinds: {
      bothModified: "양쪽 수정",
      bothAdded: "양쪽 추가",
      deletedByOurs: "ours에서 삭제",
      deletedByTheirs: "theirs에서 삭제",
      bothDeleted: "양쪽 삭제",
      typeChange: "타입 변경",
      unknown: "Unmerged",
    },
    operations: {
      merge: "Merge",
      rebase: "Rebase",
      cherryPick: "Cherry-pick",
      revert: "Revert",
      unknown: "Git 작업",
    },
    binary: "바이너리 충돌은 텍스트로 편집할 수 없습니다.",
    nonText: "텍스트가 아닌 상태, symlink, submodule, unavailable 또는 대용량 상태가 포함된 충돌입니다.",
    nextStep: "Forktail은 git add나 continue를 실행하지 않습니다. terminal에서 다음 단계를 완료하세요.",
  },
} as const;

export function GitConflictView({
  state,
  selectedKey,
  openState,
  languageMode = "en",
  onRefresh,
  onSelect,
}: GitConflictViewProps) {
  const text = TEXT[languageMode];
  const [scrollTop, setScrollTop] = useState(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const entries = useMemo(() => state.kind === "ready" ? state.list.entries : [], [state]);
  const window = virtualWindow(entries, scrollTop, selectedKey);

  const selectKey = (key: string | null) => {
    if (key === null) return;
    const entry = entries.find((candidate) => gitConflictEntryKey(candidate) === key);
    if (!entry) return;
    const index = entries.indexOf(entry);
    const nextScrollTop = Math.max(0, index * ROW_HEIGHT - ROW_HEIGHT * 2);
    if (scrollRef.current) scrollRef.current.scrollTop = nextScrollTop;
    setScrollTop(nextScrollTop);
    onSelect(entry);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      selectKey(selectedKey);
      return;
    }
    if (!isMovementKey(event.key)) return;
    event.preventDefault();
    selectKey(nextGitConflictEntryKey(entries, selectedKey, event.key));
  };

  const count = state.kind === "ready" ? state.list.totalEntries : 0;
  return (
    <section className="git-conflict-view" aria-labelledby="git-conflict-title">
      <div className="git-conflict-heading">
        <div>
          <h2 id="git-conflict-title">{text.title(count)}</h2>
          {state.kind === "ready" && <span>{text.operations[state.list.operation]}</span>}
        </div>
        <button type="button" onClick={onRefresh}>{text.refresh}</button>
      </div>

      {state.kind === "loading" && <p role="status">{text.loading}</p>}
      {state.kind === "error" && <p className="git-revision-error" role="alert">{state.message}</p>}
      {state.kind === "ready" && (
        <>
          {state.list.truncated && <p className="git-revision-note">{text.truncated}</p>}
          {entries.length === 0 ? (
            <p className="git-review-empty" role="status">{text.empty}</p>
          ) : (
            <div
              ref={scrollRef}
              className="git-conflict-list"
              role="listbox"
              tabIndex={0}
              aria-label={text.title(count)}
              aria-keyshortcuts="ArrowUp ArrowDown Home End Enter"
              onKeyDown={handleKeyDown}
              onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
            >
              <div className="git-conflict-window" style={{ height: window.totalHeight }}>
                {window.rows.map((entry, offset) => {
                  const key = gitConflictEntryKey(entry);
                  return (
                    <button
                      key={key}
                      type="button"
                      role="option"
                      aria-selected={selectedKey === key}
                      aria-posinset={window.startIndex + offset + 1}
                      aria-setsize={entries.length}
                      className="git-conflict-row"
                      style={{ top: (window.startIndex + offset) * ROW_HEIGHT, height: ROW_HEIGHT }}
                      onClick={() => onSelect(entry)}
                    >
                      <span className="git-conflict-kind">{text.kinds[conflictKind(entry)]}</span>
                      <strong>{entry.path.displayPath}</strong>
                      <span className="git-conflict-stages">
                        {stageLabel(text.base, entry.stage1 != null, text)} · {" "}
                        {stageLabel(text.ours, entry.stage2 != null, text)} · {" "}
                        {stageLabel(text.theirs, entry.stage3 != null, text)}
                      </span>
                      <span className="git-conflict-open">{text.open}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {openState.kind === "loading" && <p role="status">{text.opening}</p>}
      {openState.kind === "error" && (
        <p className="git-revision-error" role="alert">{openState.message}</p>
      )}
      {openState.kind === "notice" && (
        <div className="git-snapshot-notice" role="status">
          <strong>{openState.contentStates.includes("binary") ? text.binary : text.nonText}</strong>
          <span>{text.nextStep}</span>
        </div>
      )}
    </section>
  );
}

function stageLabel(
  label: string,
  present: boolean,
  text: (typeof TEXT)[AppLanguage],
): string {
  return `${label} ${present ? text.present : text.missing}`;
}

function conflictKind(entry: GitConflictEntry): keyof (typeof TEXT)["en"]["kinds"] {
  const stages = [entry.stage1, entry.stage2, entry.stage3].filter(
    (stage): stage is NonNullable<typeof stage> => stage != null,
  );
  if (new Set(stages.map((stage) => stage.mode)).size > 1) return "typeChange";
  if (!entry.stage1 && entry.stage2 && entry.stage3) return "bothAdded";
  if (entry.stage1 && !entry.stage2 && entry.stage3) return "deletedByOurs";
  if (entry.stage1 && entry.stage2 && !entry.stage3) return "deletedByTheirs";
  if (entry.stage1 && !entry.stage2 && !entry.stage3) return "bothDeleted";
  if (entry.stage1 && entry.stage2 && entry.stage3) return "bothModified";
  return "unknown";
}

function virtualWindow(
  entries: GitConflictEntry[],
  scrollTop: number,
  selectedKey: string | null,
): { rows: GitConflictEntry[]; startIndex: number; totalHeight: number } {
  if (entries.length <= MAX_RENDERED_ROWS) {
    return { rows: entries, startIndex: 0, totalHeight: entries.length * ROW_HEIGHT };
  }
  const naturalStart = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN_ROWS);
  const selectedIndex = selectedKey === null
    ? -1
    : entries.findIndex((entry) => gitConflictEntryKey(entry) === selectedKey);
  const startIndex = selectedIndex < 0
    ? naturalStart
    : selectedIndex < naturalStart
      ? selectedIndex
      : selectedIndex >= naturalStart + MAX_RENDERED_ROWS
        ? selectedIndex - MAX_RENDERED_ROWS + 1
        : naturalStart;
  const endIndex = Math.min(entries.length, startIndex + MAX_RENDERED_ROWS);
  return {
    rows: entries.slice(startIndex, endIndex),
    startIndex,
    totalHeight: entries.length * ROW_HEIGHT,
  };
}

function isMovementKey(key: string): key is "ArrowUp" | "ArrowDown" | "Home" | "End" {
  return key === "ArrowUp" || key === "ArrowDown" || key === "Home" || key === "End";
}
