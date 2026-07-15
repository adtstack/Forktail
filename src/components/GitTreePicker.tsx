import { useMemo, useState, type KeyboardEvent } from "react";
import {
  fuzzyFilterGitTreeEntries,
  gitTreeEntryKey,
  nextGitTreeEntryKey,
} from "../core/gitSession";
import type { GitSnapshotSelectionState } from "../core/gitSession";
import type { GitTreeEntry, GitTreeList } from "../core/gitModels";
import type { AppLanguage } from "../core/settings";

const ROW_HEIGHT = 38;
const MAX_RENDERED_ROWS = 80;
const OVERSCAN_ROWS = 10;

export type GitTreeSelectionKey = string | "missing" | null;

export type GitTreePickerState =
  | { kind: "idle" }
  | { kind: "loading"; requestGeneration: number }
  | {
      kind: "ready";
      requestGeneration: number;
      left: GitTreeList;
      right: GitTreeList;
    }
  | { kind: "error"; requestGeneration: number; message: string };

export interface VirtualGitTreeWindow {
  entries: GitTreeEntry[];
  startIndex: number;
  totalHeight: number;
}

export function virtualizedGitTreeWindow(
  entries: GitTreeEntry[],
  scrollTop: number,
  selectedKey: GitTreeSelectionKey,
): VirtualGitTreeWindow {
  const maximumStart = Math.max(0, entries.length - MAX_RENDERED_ROWS);
  let startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN_ROWS);
  startIndex = Math.min(startIndex, maximumStart);
  if (selectedKey && selectedKey !== "missing") {
    const selectedIndex = entries.findIndex((entry) => gitTreeEntryKey(entry) === selectedKey);
    if (
      selectedIndex >= 0
      && (selectedIndex < startIndex || selectedIndex >= startIndex + MAX_RENDERED_ROWS)
    ) {
      startIndex = Math.min(
        maximumStart,
        Math.max(0, selectedIndex - Math.floor(MAX_RENDERED_ROWS / 2)),
      );
    }
  }
  return {
    entries: entries.slice(startIndex, startIndex + MAX_RENDERED_ROWS),
    startIndex,
    totalHeight: entries.length * ROW_HEIGHT,
  };
}

interface GitTreePickerProps {
  state: GitTreePickerState;
  query: string;
  leftSelection: GitTreeSelectionKey;
  rightSelection: GitTreeSelectionKey;
  openState?: GitSnapshotSelectionState;
  languageMode?: AppLanguage;
  onLoad: () => void;
  onCancel: () => void;
  onClose: () => void;
  onQueryChange: (query: string) => void;
  onSelect: (side: "left" | "right", selection: GitTreeSelectionKey) => void;
  onCompare: () => void;
}

const TEXT = {
  en: {
    title: "Tracked-file picker",
    load: "Browse all tracked files",
    optIn: "Changed files remain the default review list. Load full revision trees only when needed.",
    loading: "Loading tracked files from both local revisions…",
    cancel: "Cancel tree load",
    close: "Close tracked-file picker",
    filter: "Fuzzy-search tracked paths",
    left: "Left tracked files",
    right: "Right tracked files",
    missing: "Missing at this revision",
    compare: "Compare selected paths",
    selectBoth: "Choose one path or Missing on each side.",
    empty: "No tracked paths match this search.",
    truncated: "This tree reached the 100,000-entry safety limit.",
    opening: "Opening the selected immutable snapshots…",
    nonText: "The selected paths cannot be compared as text. Snapshot metadata remains read-only.",
  },
  ko: {
    title: "tracked 파일 선택기",
    load: "전체 tracked 파일 찾기",
    optIn: "기본 검토 목록은 변경 파일입니다. 필요할 때만 양쪽 revision tree를 불러옵니다.",
    loading: "두 로컬 revision의 tracked 파일을 불러오는 중…",
    cancel: "tree 불러오기 취소",
    close: "tracked 파일 선택기 닫기",
    filter: "tracked 경로 퍼지 검색",
    left: "왼쪽 tracked 파일",
    right: "오른쪽 tracked 파일",
    missing: "이 revision에는 없음",
    compare: "선택 경로 비교",
    selectBoth: "양쪽에서 경로 또는 없음을 하나씩 선택하세요.",
    empty: "검색과 일치하는 tracked 경로가 없습니다.",
    truncated: "tree가 100,000개 안전 한도에 도달했습니다.",
    opening: "선택한 immutable snapshot을 여는 중…",
    nonText: "선택 경로를 텍스트로 비교할 수 없습니다. Snapshot metadata는 읽기 전용입니다.",
  },
} as const;

export function GitTreePicker({
  state,
  query,
  leftSelection,
  rightSelection,
  openState = { kind: "idle" },
  languageMode = "en",
  onLoad,
  onCancel,
  onClose,
  onQueryChange,
  onSelect,
  onCompare,
}: GitTreePickerProps) {
  const text = TEXT[languageMode];
  const [leftScrollTop, setLeftScrollTop] = useState(0);
  const [rightScrollTop, setRightScrollTop] = useState(0);

  const leftEntries = useMemo(
    () => state.kind === "ready" ? fuzzyFilterGitTreeEntries(state.left.entries, query) : [],
    [query, state],
  );
  const rightEntries = useMemo(
    () => state.kind === "ready" ? fuzzyFilterGitTreeEntries(state.right.entries, query) : [],
    [query, state],
  );
  const incompleteSelection = leftSelection === null
    || rightSelection === null
    || (leftSelection === "missing" && rightSelection === "missing");

  if (state.kind === "idle") {
    return (
      <section className="git-tree-picker git-tree-picker-idle" aria-label={text.title}>
        <p>{text.optIn}</p>
        <button type="button" onClick={onLoad}>{text.load}</button>
      </section>
    );
  }
  if (state.kind === "loading") {
    return (
      <section className="git-tree-picker" aria-label={text.title}>
        <p role="status">{text.loading}</p>
        <button type="button" onClick={onCancel}>{text.cancel}</button>
      </section>
    );
  }
  if (state.kind === "error") {
    return (
      <section className="git-tree-picker" aria-label={text.title}>
        <p role="alert">{state.message}</p>
        <button type="button" onClick={onLoad}>{text.load}</button>
        <button type="button" onClick={onClose}>{text.close}</button>
      </section>
    );
  }

  return (
    <section className="git-tree-picker" aria-labelledby="git-tree-picker-title">
      <div className="git-tree-picker-heading">
        <h2 id="git-tree-picker-title">{text.title}</h2>
        <button type="button" onClick={onClose}>{text.close}</button>
      </div>
      <label className="git-tree-picker-filter">
        <span>{text.filter}</span>
        <input
          type="search"
          value={query}
          aria-label={text.filter}
          onChange={(event) => {
            setLeftScrollTop(0);
            setRightScrollTop(0);
            onQueryChange(event.currentTarget.value);
          }}
        />
      </label>
      {(state.left.truncated || state.right.truncated) && (
        <p className="git-revision-note" role="status">{text.truncated}</p>
      )}
      <div className="git-tree-picker-grid">
        <TreeSide
          side="left"
          label={text.left}
          entries={leftEntries}
          selection={leftSelection}
          scrollTop={leftScrollTop}
          missingLabel={text.missing}
          emptyLabel={text.empty}
          onScroll={setLeftScrollTop}
          onSelect={onSelect}
        />
        <TreeSide
          side="right"
          label={text.right}
          entries={rightEntries}
          selection={rightSelection}
          scrollTop={rightScrollTop}
          missingLabel={text.missing}
          emptyLabel={text.empty}
          onScroll={setRightScrollTop}
          onSelect={onSelect}
        />
      </div>
      <div className="git-tree-picker-actions">
        <span>{incompleteSelection ? text.selectBoth : ""}</span>
        <button
          type="button"
          disabled={incompleteSelection}
          onClick={onCompare}
        >
          {text.compare}
        </button>
      </div>
      {openState.kind === "loading" && <p role="status">{text.opening}</p>}
      {openState.kind === "error" && <p role="alert">{openState.message}</p>}
      {openState.kind === "notice" && (
        <p className="git-snapshot-notice" role="status">
          {text.nonText} {openState.contentStates.join(" · ")}
        </p>
      )}
    </section>
  );
}

function TreeSide({
  side,
  label,
  entries,
  selection,
  scrollTop,
  missingLabel,
  emptyLabel,
  onScroll,
  onSelect,
}: {
  side: "left" | "right";
  label: string;
  entries: GitTreeEntry[];
  selection: GitTreeSelectionKey;
  scrollTop: number;
  missingLabel: string;
  emptyLabel: string;
  onScroll: (scrollTop: number) => void;
  onSelect: (side: "left" | "right", selection: GitTreeSelectionKey) => void;
}) {
  const window = virtualizedGitTreeWindow(entries, scrollTop, selection);
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const key = nextGitTreeEntryKey(
      entries,
      selection === "missing" ? null : selection,
      event.key as "ArrowUp" | "ArrowDown" | "Home" | "End",
    );
    if (key) onSelect(side, key);
  };
  return (
    <section className="git-tree-side">
      <div className="git-tree-side-heading">
        <strong>{label}</strong>
        <button
          type="button"
          aria-pressed={selection === "missing"}
          onClick={() => onSelect(side, "missing")}
        >
          {missingLabel}
        </button>
      </div>
      {entries.length === 0 ? (
        <p role="status">{emptyLabel}</p>
      ) : (
        <div
          className="git-tree-list"
          role="listbox"
          tabIndex={0}
          aria-label={label}
          aria-keyshortcuts="ArrowUp ArrowDown Home End"
          onKeyDown={handleKeyDown}
          onScroll={(event) => onScroll(event.currentTarget.scrollTop)}
        >
          <div className="git-tree-window" style={{ height: window.totalHeight }}>
            {window.entries.map((entry, offset) => {
              const key = gitTreeEntryKey(entry);
              return (
                <button
                  key={key}
                  type="button"
                  role="option"
                  aria-selected={selection === key}
                  aria-posinset={window.startIndex + offset + 1}
                  aria-setsize={entries.length}
                  className="git-tree-row"
                  style={{ top: (window.startIndex + offset) * ROW_HEIGHT, height: ROW_HEIGHT }}
                  onClick={() => onSelect(side, key)}
                >
                  <span>{entry.path.displayPath}</span>
                  <small>{entry.kind}</small>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
