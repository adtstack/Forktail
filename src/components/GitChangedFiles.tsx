import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  filterGitChangedFiles,
  gitChangedFileKey,
  isReviewableGitChangedFile,
  type GitChangedFileFilter,
  type GitChangedFileLoadState,
  type GitChangedFileStatusFilter,
  type GitSnapshotSelectionState,
} from "../core/gitSession";
import type { GitChangedFile, GitChangedFileStatus } from "../core/gitModels";
import type { AppLanguage } from "../core/settings";

const ROW_HEIGHT = 54;
const MAX_RENDERED_ROWS = 80;
const OVERSCAN_ROWS = 10;
const EMPTY_COUNTS = {
  added: 0,
  deleted: 0,
  modified: 0,
  typeChanged: 0,
  renamed: 0,
  copied: 0,
  unmerged: 0,
  unknown: 0,
  total: 0,
};

export interface VirtualGitChangedFileWindow {
  entries: GitChangedFile[];
  startIndex: number;
  totalHeight: number;
}

export function virtualizedGitChangedFileWindow(
  entries: GitChangedFile[],
  scrollTop: number,
  selectedKey: string | null,
): VirtualGitChangedFileWindow {
  const maximumStart = Math.max(0, entries.length - MAX_RENDERED_ROWS);
  let startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN_ROWS);
  startIndex = Math.min(startIndex, maximumStart);
  if (selectedKey) {
    const selectedIndex = entries.findIndex((entry) => gitChangedFileKey(entry) === selectedKey);
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

interface GitChangedFilesProps {
  state: GitChangedFileLoadState;
  filter: GitChangedFileFilter;
  selectedKey: string | null;
  viewedKeys: ReadonlySet<string>;
  snapshotState: GitSnapshotSelectionState;
  languageMode?: AppLanguage;
  onFilterChange: (query: string) => void;
  onStatusFilterChange: (status: GitChangedFileStatusFilter) => void;
  onSelect: (entry: GitChangedFile) => void;
}

const TEXT = {
  en: {
    title: "Changed files",
    query: "Filter changed files by path",
    status: "Filter changed files by status",
    all: "All statuses",
    loading: "Loading changed files…",
    empty: "No reviewable committed changes match this revision pair.",
    shown: (shown: number, total: number) => `${shown} shown · ${total} reviewable files`,
    total: (total: number) => `${total} reviewable files`,
    truncated: "The changed-file result reached the 10,000 entry safety limit.",
    similarity: (score: number) => `${score}% similarity`,
    viewed: "Viewed",
    unviewed: "Not viewed",
    loadingSnapshot: "Opening the selected read-only snapshots…",
    notice: "This selection cannot be opened as text. Snapshot metadata remains read-only.",
    readOnly: "read-only",
    states: {
      text: "Text",
      missing: "Missing",
      binary: "Binary",
      lfsPointer: "Git LFS pointer",
      symlink: "Symlink",
      submodule: "Submodule",
      tooLarge: "Too large",
      unavailable: "Not available locally",
    },
  },
  ko: {
    title: "변경 파일",
    query: "경로로 변경 파일 필터",
    status: "상태로 변경 파일 필터",
    all: "모든 상태",
    loading: "변경 파일을 불러오는 중…",
    empty: "이 revision 조합에서 검토할 commit 변경이 없습니다.",
    shown: (shown: number, total: number) => `${shown}개 표시 · 검토 가능 ${total}개`,
    total: (total: number) => `검토 가능 ${total}개`,
    truncated: "변경 파일 결과가 10,000개 안전 한도에 도달했습니다.",
    similarity: (score: number) => `유사도 ${score}%`,
    viewed: "검토함",
    unviewed: "미검토",
    loadingSnapshot: "선택한 읽기 전용 snapshot을 여는 중…",
    notice: "이 항목은 텍스트로 열 수 없습니다. Snapshot metadata만 읽기 전용으로 표시합니다.",
    readOnly: "읽기 전용",
    states: {
      text: "텍스트",
      missing: "없음",
      binary: "바이너리",
      lfsPointer: "Git LFS pointer",
      symlink: "심볼릭 링크",
      submodule: "서브모듈",
      tooLarge: "너무 큼",
      unavailable: "로컬에 없음",
    },
  },
} as const;

const STATUS_ORDER: Exclude<GitChangedFileStatusFilter, "all">[] = [
  "added",
  "deleted",
  "modified",
  "renamed",
  "typeChanged",
];

const STATUS_TEXT = {
  en: {
    added: "Added",
    deleted: "Deleted",
    modified: "Modified",
    renamed: "Renamed",
    typeChanged: "Type changed",
  },
  ko: {
    added: "추가",
    deleted: "삭제",
    modified: "수정",
    renamed: "이름 변경",
    typeChanged: "종류 변경",
  },
} as const;

export function GitChangedFiles({
  state,
  filter,
  selectedKey,
  viewedKeys,
  snapshotState,
  languageMode = "en",
  onFilterChange,
  onStatusFilterChange,
  onSelect,
}: GitChangedFilesProps) {
  const text = TEXT[languageMode];
  const statusText = STATUS_TEXT[languageMode];
  const [scrollTop, setScrollTop] = useState(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const reviewableEntries = useMemo(
    () => state.kind === "ready"
      ? state.list.entries.filter(isReviewableGitChangedFile)
      : [],
    [state],
  );
  const filteredEntries = useMemo(
    () => filterGitChangedFiles(reviewableEntries, filter),
    [filter, reviewableEntries],
  );
  const window = virtualizedGitChangedFileWindow(filteredEntries, scrollTop, selectedKey);
  const counts = state.kind === "ready"
    ? state.list.counts
    : EMPTY_COUNTS;
  const reviewableTotal =
    counts.added + counts.deleted + counts.modified + counts.renamed + counts.typeChanged;

  const selectIndex = (index: number) => {
    const entry = filteredEntries[index];
    if (!entry) return;
    const targetScrollTop = Math.max(0, index * ROW_HEIGHT - ROW_HEIGHT * 2);
    if (scrollRef.current) scrollRef.current.scrollTop = targetScrollTop;
    setScrollTop(targetScrollTop);
    onSelect(entry);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = selectedKey
      ? filteredEntries.findIndex((entry) => gitChangedFileKey(entry) === selectedKey)
      : -1;
    if (event.key === "Home") return selectIndex(0);
    if (event.key === "End") return selectIndex(filteredEntries.length - 1);
    if (event.key === "ArrowUp") return selectIndex(Math.max(0, currentIndex - 1));
    selectIndex(Math.min(filteredEntries.length - 1, currentIndex + 1));
  };

  return (
    <section className="git-changed-files" aria-labelledby="git-changed-files-title">
      <div className="git-changed-files-heading">
        <h2 id="git-changed-files-title">{text.title}</h2>
        {state.kind === "ready" && <span>{text.total(reviewableTotal)}</span>}
      </div>

      {state.kind === "loading" && <p role="status">{text.loading}</p>}
      {state.kind === "error" && <p className="git-revision-error" role="alert">{state.message}</p>}
      {state.kind === "ready" && (
        <>
          <div className="git-changed-file-filters">
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
              <span>{text.status}</span>
              <select
                aria-label={text.status}
                value={filter.status}
                onChange={(event) =>
                  onStatusFilterChange(event.currentTarget.value as GitChangedFileStatusFilter)
                }
              >
                <option value="all">{text.all}</option>
                {STATUS_ORDER.map((status) => (
                  <option key={status} value={status}>{statusText[status]}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="git-changed-file-counts" aria-label={text.total(reviewableTotal)}>
            {STATUS_ORDER.filter((status) => counts[status] > 0).map((status) => (
              <span key={status}>{statusText[status]} {counts[status]}</span>
            ))}
          </div>
          <p className="git-changed-file-shown">
            {text.shown(filteredEntries.length, reviewableTotal)}
          </p>
          {state.list.truncated && <p className="git-revision-note">{text.truncated}</p>}
          {filteredEntries.length === 0 ? (
            <p className="git-review-empty" role="status">{text.empty}</p>
          ) : (
            <div
              ref={scrollRef}
              className="git-changed-file-list"
              role="listbox"
              tabIndex={0}
              aria-keyshortcuts="ArrowUp ArrowDown Home End"
              aria-label={text.title}
              onKeyDown={handleKeyDown}
              onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
            >
              <div className="git-changed-file-window" style={{ height: window.totalHeight }}>
                {window.entries.map((entry, offset) => {
                  const key = gitChangedFileKey(entry);
                  const viewed = viewedKeys.has(key);
                  return (
                    <button
                      key={key}
                      type="button"
                      role="option"
                      aria-selected={selectedKey === key}
                      aria-posinset={window.startIndex + offset + 1}
                      aria-setsize={filteredEntries.length}
                      className="git-changed-file-row"
                      style={{ top: (window.startIndex + offset) * ROW_HEIGHT, height: ROW_HEIGHT }}
                      onClick={() => onSelect(entry)}
                    >
                      <span className="git-changed-file-status">{statusText[entry.status as ReviewableStatus]}</span>
                      <span className="git-changed-file-path">{changedFilePath(entry)}</span>
                      {entry.similarityScore != null && (
                        <span className="git-changed-file-score">
                          {text.similarity(entry.similarityScore)}
                        </span>
                      )}
                      <span className="git-changed-file-viewed">{viewed ? text.viewed : text.unviewed}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {snapshotState.kind === "loading" && <p role="status">{text.loadingSnapshot}</p>}
      {snapshotState.kind === "error" && (
        <p className="git-revision-error" role="alert">{snapshotState.message}</p>
      )}
      {snapshotState.kind === "notice" && (
        <div className="git-snapshot-notice" role="status">
          <strong>{text.notice}</strong>
          <span>{snapshotState.contentStates.map((state) => text.states[state]).join(" · ")}</span>
          <span>{text.readOnly}</span>
        </div>
      )}
    </section>
  );
}

type ReviewableStatus = Exclude<GitChangedFileStatus, "copied" | "unmerged" | "unknown">;

function changedFilePath(entry: GitChangedFile): string {
  const oldPath = entry.oldPath?.displayPath;
  const newPath = entry.newPath?.displayPath;
  if (entry.status === "renamed" && oldPath && newPath) return `${oldPath} → ${newPath}`;
  return newPath ?? oldPath ?? "";
}
