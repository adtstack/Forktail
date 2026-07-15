import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  filterGitWorkingTreeRows,
  gitWorkingTreeRowKey,
  gitWorkingTreeRows,
  nextGitWorkingTreeRowKey,
  type GitSnapshotSelectionState,
  type GitWorkingTreeFilter,
  type GitWorkingTreeLoadState,
  type GitWorkingTreeRow,
  type GitWorkingTreeSection,
} from "../core/gitSession";
import type { GitIndexComparison, GitStatusBranch } from "../core/gitModels";
import type { AppLanguage } from "../core/settings";

const ROW_HEIGHT = 54;
const MAX_RENDERED_ROWS = 80;
const OVERSCAN_ROWS = 10;

interface GitWorkingTreeFilesProps {
  state: GitWorkingTreeLoadState;
  filter: GitWorkingTreeFilter;
  comparison: GitIndexComparison;
  selectedKey: string | null;
  snapshotState: GitSnapshotSelectionState;
  languageMode?: AppLanguage;
  onRefresh: () => void;
  onFilterChange: (query: string) => void;
  onSectionFilterChange: (section: GitWorkingTreeSection) => void;
  onComparisonChange: (comparison: GitIndexComparison) => void;
  onSelect: (row: GitWorkingTreeRow) => void;
}

const TEXT = {
  en: {
    title: "Working tree changes",
    refresh: "Refresh status",
    loading: "Loading working tree status…",
    empty: "The working tree has no matching changes.",
    query: "Filter working tree changes by path",
    section: "Filter working tree changes by section",
    all: "All changes",
    compare: "Compare snapshots",
    readOnly: "Read-only",
    truncated: "The status result reached the 10,000 entry safety limit. Narrow the repository state and refresh.",
    staged: "Staged",
    unstaged: "Unstaged",
    untracked: "Untracked",
    unmerged: "Unmerged",
    conflict: (code: string) => `Conflict ${code}`,
    ahead: (count: number) => `Ahead ${count}`,
    behind: (count: number) => `Behind ${count}`,
    detached: "Detached HEAD",
    unborn: "No commits yet",
    opening: "Opening the selected read-only snapshots…",
    notice: "This comparison cannot be opened as text.",
    sparse: "Sparse checkout path is not present on disk. Refresh status after materializing the path.",
    unavailable: "A snapshot is not available locally. Forktail does not fetch automatically.",
    states: {
      text: "Text",
      missing: "Missing",
      binary: "Binary",
      lfsPointer: "Git LFS pointer",
      symlink: "Symlink",
      submodule: "Submodule",
      tooLarge: "Too large",
      unavailable: "Unavailable",
    },
  },
  ko: {
    title: "Working tree 변경",
    refresh: "상태 새로고침",
    loading: "Working tree 상태를 불러오는 중…",
    empty: "조건에 맞는 working tree 변경이 없습니다.",
    query: "경로로 working tree 변경 필터",
    section: "영역으로 working tree 변경 필터",
    all: "모든 변경",
    compare: "Snapshot 비교",
    readOnly: "읽기 전용",
    truncated: "상태 결과가 10,000개 안전 한도에 도달했습니다. 저장소 상태를 줄인 뒤 새로고침하세요.",
    staged: "Staged",
    unstaged: "Unstaged",
    untracked: "Untracked",
    unmerged: "Unmerged",
    conflict: (code: string) => `충돌 ${code}`,
    ahead: (count: number) => `앞섬 ${count}`,
    behind: (count: number) => `뒤처짐 ${count}`,
    detached: "분리된 HEAD",
    unborn: "아직 commit 없음",
    opening: "선택한 읽기 전용 snapshot을 여는 중…",
    notice: "이 비교는 텍스트로 열 수 없습니다.",
    sparse: "Sparse checkout path가 disk에 없습니다. Path를 materialize한 뒤 상태를 새로고침하세요.",
    unavailable: "Snapshot을 로컬에서 사용할 수 없습니다. Forktail은 자동 fetch하지 않습니다.",
    states: {
      text: "텍스트",
      missing: "없음",
      binary: "바이너리",
      lfsPointer: "Git LFS pointer",
      symlink: "심볼릭 링크",
      submodule: "서브모듈",
      tooLarge: "너무 큼",
      unavailable: "사용 불가",
    },
  },
} as const;

const SECTIONS: Exclude<GitWorkingTreeSection, "all">[] = [
  "staged",
  "unstaged",
  "untracked",
  "unmerged",
];

const COMPARISONS: GitIndexComparison[] = [
  "headToIndex",
  "indexToWorkingTree",
  "headToWorkingTree",
];

const COMPARISON_TEXT: Record<GitIndexComparison, string> = {
  headToIndex: "HEAD ↔ index",
  indexToWorkingTree: "index ↔ working tree",
  headToWorkingTree: "HEAD ↔ working tree",
};

export function GitWorkingTreeFiles({
  state,
  filter,
  comparison,
  selectedKey,
  snapshotState,
  languageMode = "en",
  onRefresh,
  onFilterChange,
  onSectionFilterChange,
  onComparisonChange,
  onSelect,
}: GitWorkingTreeFilesProps) {
  const text = TEXT[languageMode];
  const [scrollTop, setScrollTop] = useState(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const rows = useMemo(
    () => state.kind === "ready" ? gitWorkingTreeRows(state.snapshot) : [],
    [state],
  );
  const filteredRows = useMemo(
    () => filterGitWorkingTreeRows(rows, filter),
    [filter, rows],
  );
  const counts = countSections(rows);
  const window = virtualWindow(filteredRows, scrollTop, selectedKey);

  const selectKey = (key: string | null) => {
    if (key === null) return;
    const row = filteredRows.find((candidate) => gitWorkingTreeRowKey(candidate) === key);
    if (!row || row.section === "unmerged") return;
    const index = filteredRows.indexOf(row);
    const nextScrollTop = Math.max(0, index * ROW_HEIGHT - ROW_HEIGHT * 2);
    if (scrollRef.current) scrollRef.current.scrollTop = nextScrollTop;
    setScrollTop(nextScrollTop);
    onSelect(row);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      selectKey(selectedKey);
      return;
    }
    if (!isMovementKey(event.key)) return;
    event.preventDefault();
    selectKey(nextGitWorkingTreeRowKey(filteredRows, selectedKey, event.key));
  };

  return (
    <section className="git-working-tree-files" aria-labelledby="git-working-tree-title">
      <div className="git-working-tree-heading">
        <div>
          <h2 id="git-working-tree-title">{text.title}</h2>
          <span className="git-read-only-label">{text.readOnly}</span>
        </div>
        <button type="button" onClick={onRefresh}>{text.refresh}</button>
      </div>

      {state.kind === "loading" && <p role="status">{text.loading}</p>}
      {state.kind === "error" && <p className="git-revision-error" role="alert">{state.message}</p>}
      {state.kind === "ready" && (
        <>
          <BranchSummary branch={state.snapshot.branch} languageMode={languageMode} />
          <div className="git-working-tree-counts" aria-label={text.title}>
            {SECTIONS.map((section) => (
              <span key={section}>{text[section]} {counts[section]}</span>
            ))}
          </div>
          <div className="git-working-tree-controls">
            <label>
              <span>{text.query}</span>
              <input
                type="search"
                aria-label={text.query}
                value={filter.query}
                onChange={(event) => onFilterChange(event.currentTarget.value)}
              />
            </label>
            <label>
              <span>{text.section}</span>
              <select
                aria-label={text.section}
                value={filter.section}
                onChange={(event) =>
                  onSectionFilterChange(event.currentTarget.value as GitWorkingTreeSection)}
              >
                <option value="all">{text.all}</option>
                {SECTIONS.map((section) => (
                  <option key={section} value={section}>{text[section]}</option>
                ))}
              </select>
            </label>
            <label>
              <span>{text.compare}</span>
              <select
                aria-label={text.compare}
                value={comparison}
                onChange={(event) =>
                  onComparisonChange(event.currentTarget.value as GitIndexComparison)}
              >
                {COMPARISONS.map((item) => (
                  <option key={item} value={item}>{COMPARISON_TEXT[item]}</option>
                ))}
              </select>
            </label>
          </div>
          {state.snapshot.truncated && <p className="git-revision-note">{text.truncated}</p>}
          {filteredRows.length === 0 ? (
            <p className="git-review-empty" role="status">{text.empty}</p>
          ) : (
            <div
              ref={scrollRef}
              className="git-working-tree-list"
              role="listbox"
              tabIndex={0}
              aria-label={text.title}
              aria-keyshortcuts="ArrowUp ArrowDown Home End Enter"
              onKeyDown={handleKeyDown}
              onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
            >
              <div className="git-working-tree-window" style={{ height: window.totalHeight }}>
                {window.rows.map((row, offset) => {
                  const key = gitWorkingTreeRowKey(row);
                  const disabled = row.section === "unmerged";
                  return (
                    <button
                      key={key}
                      type="button"
                      role="option"
                      aria-selected={selectedKey === key}
                      aria-disabled={disabled}
                      disabled={disabled}
                      aria-posinset={window.startIndex + offset + 1}
                      aria-setsize={filteredRows.length}
                      className="git-working-tree-row"
                      style={{ top: (window.startIndex + offset) * ROW_HEIGHT, height: ROW_HEIGHT }}
                      onClick={() => onSelect(row)}
                    >
                      <span className="git-working-tree-section">{text[row.section]}</span>
                      <span className="git-working-tree-path">{rowPath(row)}</span>
                      <span className="git-working-tree-change">
                        {row.conflictCode ? text.conflict(row.conflictCode) : changeLabel(row)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {snapshotState.kind === "loading" && <p role="status">{text.opening}</p>}
      {snapshotState.kind === "error" && (
        <p className="git-revision-error" role="alert">{snapshotState.message}</p>
      )}
      {snapshotState.kind === "notice" && (
        <div className="git-snapshot-notice" role="status">
          <strong>{text.notice}</strong>
          <span>{snapshotState.contentStates.map((state) => text.states[state]).join(" · ")}</span>
          {snapshotState.unavailableReasons?.includes("sparseWorkingTreeMissing")
            ? <span>{text.sparse}</span>
            : snapshotState.unavailableReasons?.includes("objectMissingLocal")
              ? <span>{text.unavailable}</span>
              : null}
          <span>{text.readOnly} · {text.refresh}</span>
        </div>
      )}
    </section>
  );
}

function BranchSummary({
  branch,
  languageMode,
}: {
  branch: GitStatusBranch;
  languageMode: AppLanguage;
}) {
  const text = TEXT[languageMode];
  const branchLabel = branch.state.kind === "branch"
    ? branch.state.displayName
    : branch.state.kind === "detached"
      ? text.detached
      : `${text.unborn} · ${branch.state.displayName}`;
  return (
    <div className="git-working-tree-branch">
      <strong>{branchLabel}</strong>
      {branch.upstream && <span>{branch.upstream}</span>}
      {branch.ahead != null && <span>{text.ahead(branch.ahead)}</span>}
      {branch.behind != null && <span>{text.behind(branch.behind)}</span>}
    </div>
  );
}

function countSections(rows: GitWorkingTreeRow[]) {
  return rows.reduce((counts, row) => {
    counts[row.section] += 1;
    return counts;
  }, { staged: 0, unstaged: 0, untracked: 0, unmerged: 0 });
}

function rowPath(row: GitWorkingTreeRow): string {
  return row.originalPath
    ? `${row.originalPath.displayPath} → ${row.path.displayPath}`
    : row.path.displayPath;
}

function changeLabel(row: GitWorkingTreeRow): string {
  if (row.change == null) return row.section;
  return row.similarityScore == null ? row.change : `${row.change} · ${row.similarityScore}%`;
}

function isMovementKey(key: string): key is "ArrowUp" | "ArrowDown" | "Home" | "End" {
  return ["ArrowUp", "ArrowDown", "Home", "End"].includes(key);
}

function virtualWindow(
  rows: GitWorkingTreeRow[],
  scrollTop: number,
  selectedKey: string | null,
) {
  const maximumStart = Math.max(0, rows.length - MAX_RENDERED_ROWS);
  let startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN_ROWS);
  startIndex = Math.min(startIndex, maximumStart);
  if (selectedKey) {
    const selectedIndex = rows.findIndex((row) => gitWorkingTreeRowKey(row) === selectedKey);
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
    rows: rows.slice(startIndex, startIndex + MAX_RENDERED_ROWS),
    startIndex,
    totalHeight: rows.length * ROW_HEIGHT,
  };
}
