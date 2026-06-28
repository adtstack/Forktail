import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  APP_COMMAND_EVENT,
  commandAriaKeyshortcuts,
  commandIdFromEvent,
} from "../core/commands";
import {
  FOLDER_STATUSES,
  FOLDER_ROW_HEIGHT,
  applyCollapsedFolderEntries,
  buildFolderSyncDryRunPlan,
  canCompareFolderEntry,
  clampFolderSelectionIndex,
  countFolderStatuses,
  detectFolderPathConflicts,
  folderEntryDepth,
  folderEntryDetailRows,
  folderEntryHasChildren,
  folderEntryModifiedMs,
  folderEntryPathActions,
  folderScanOptionsWithMode,
  folderScanOptionsWithToggle,
  folderVirtualRange,
  isFolderDirectoryEntry,
  isFolderSearchShortcut,
  nextFolderSelectionIndex,
  nextFolderSort,
  prepareFolderEntries,
  summarizeFolderSyncDryRun,
  type FolderSortKey,
  type FolderSyncDirection,
  type FolderSyncDryRunSummary,
} from "../core/folderView";
import type {
  FolderCompareMode,
  FolderEntry,
  FolderEntryStatus,
  FolderScanOptions,
  FolderScanProgress,
  FolderScanResult,
} from "../core/models";
import { pathCopyFailureMessage, pathCopySuccessMessage, writeClipboardText } from "../core/pathCopy";
import { loadFolderViewSettings, saveFolderViewSettings } from "../core/settings";

interface FolderCompareViewProps {
  result: FolderScanResult;
  options: FolderScanOptions;
  busy: boolean;
  scanProgress: FolderScanProgress | null;
  onBack: () => void;
  onNewScan: () => void;
  onRescan: (options: FolderScanOptions) => void;
  onCancelScan: () => void;
  onOpenEntry: (entry: FolderEntry) => void;
  onRevealPath: (path: string) => void;
}

const statusLabels: Record<FolderEntryStatus, string> = {
  same: "동일",
  different: "변경",
  leftOnly: "왼쪽만",
  rightOnly: "오른쪽만",
  typeMismatch: "형식 충돌",
  error: "오류",
};

export function FolderCompareView({
  result,
  options,
  busy,
  scanProgress,
  onBack,
  onNewScan,
  onRescan,
  onCancelScan,
  onOpenEntry,
  onRevealPath,
}: FolderCompareViewProps) {
  const [query, setQuery] = useState("");
  const [viewSettings, setViewSettings] = useState(() => loadFolderViewSettings());
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [detailPanelOpen, setDetailPanelOpen] = useState(false);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const [collapsedPaths, setCollapsedPaths] = useState<ReadonlySet<string>>(() => new Set());
  const [viewport, setViewport] = useState({ scrollTop: 0, height: 0 });
  const tableWrapRef = useRef<HTMLElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const rowRefs = useRef<Array<HTMLTableRowElement | null>>([]);

  useEffect(() => {
    saveFolderViewSettings(viewSettings);
  }, [viewSettings]);

  useEffect(() => {
    const focusSearch = () => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (!isFolderSearchShortcut(event)) return;
      event.preventDefault();
      focusSearch();
    };
    const handleCommandEvent = (event: Event) => {
      const commandId = commandIdFromEvent(event);
      if (commandId === "searchPath") focusSearch();
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener(APP_COMMAND_EVENT, handleCommandEvent);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener(APP_COMMAND_EVENT, handleCommandEvent);
    };
  }, []);

  const statusCounts = useMemo(() => countFolderStatuses(result.entries), [result.entries]);
  const pathConflicts = useMemo(() => detectFolderPathConflicts(result.entries), [result.entries]);
  const syncDryRun = useMemo(() => ({
    leftToRight: summarizeFolderSyncDryRun(buildFolderSyncDryRunPlan(result, "leftToRight")),
    rightToLeft: summarizeFolderSyncDryRun(buildFolderSyncDryRunPlan(result, "rightToLeft")),
  }), [result]);
  const preparedEntries = useMemo(() => {
    return prepareFolderEntries(
      result.entries,
      { query, statuses: viewSettings.statusFilters },
      viewSettings.sort,
    );
  }, [query, result.entries, viewSettings]);
  const entries = useMemo(
    () => applyCollapsedFolderEntries(preparedEntries, collapsedPaths),
    [collapsedPaths, preparedEntries],
  );

  const selectedEntry = selectedIndex >= 0 ? entries[selectedIndex] : null;
  const detailEntry = detailPanelOpen ? selectedEntry : null;
  const virtualRange = useMemo(
    () => folderVirtualRange(entries.length, viewport.scrollTop, viewport.height),
    [entries.length, viewport.height, viewport.scrollTop],
  );
  const visibleEntries = useMemo(
    () => entries.slice(virtualRange.start, virtualRange.end),
    [entries, virtualRange.end, virtualRange.start],
  );

  useEffect(() => {
    setSelectedIndex((current) => clampFolderSelectionIndex(current, entries.length));
    rowRefs.current = rowRefs.current.slice(0, entries.length);
    if (entries.length === 0) setDetailPanelOpen(false);
  }, [entries.length]);

  useEffect(() => {
    setCopyMessage(null);
  }, [detailEntry?.relativePath]);

  useEffect(() => {
    setCollapsedPaths(new Set());
  }, [result.leftRoot, result.rightRoot]);

  useEffect(() => {
    const element = tableWrapRef.current;
    if (!element) return;

    const updateViewport = () => {
      setViewport({ scrollTop: element.scrollTop, height: element.clientHeight });
    };
    updateViewport();

    const resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateViewport);
    resizeObserver?.observe(element);
    window.addEventListener("resize", updateViewport);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updateViewport);
    };
  }, []);

  const updateScrollViewport = () => {
    const element = tableWrapRef.current;
    if (!element) return;
    setViewport({ scrollTop: element.scrollTop, height: element.clientHeight });
  };

  const ensureRowVisible = (index: number) => {
    const element = tableWrapRef.current;
    if (!element || index < 0) return;

    const rowTop = index * FOLDER_ROW_HEIGHT;
    const rowBottom = rowTop + FOLDER_ROW_HEIGHT;
    const visibleTop = element.scrollTop;
    const visibleBottom = visibleTop + element.clientHeight;

    if (rowTop < visibleTop) {
      element.scrollTop = rowTop;
      updateScrollViewport();
    } else if (rowBottom > visibleBottom) {
      element.scrollTop = Math.max(0, rowBottom - element.clientHeight);
      updateScrollViewport();
    }
  };

  const focusRow = (index: number) => {
    ensureRowVisible(index);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => rowRefs.current[index]?.focus());
    });
  };

  const selectRow = (index: number, focus = false) => {
    const nextIndex = clampFolderSelectionIndex(index, entries.length);
    setSelectedIndex(nextIndex);
    if (focus && nextIndex >= 0) {
      requestAnimationFrame(() => focusRow(nextIndex));
    }
  };

  const moveSelection = (direction: "previous" | "next" | "first" | "last") => {
    const nextIndex = nextFolderSelectionIndex(selectedIndex, entries.length, direction);
    selectRow(nextIndex, true);
  };

  const handleRowKeyDown = (
    event: KeyboardEvent<HTMLTableRowElement>,
    entry: FolderEntry,
    index: number,
  ) => {
    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveSelection("previous");
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveSelection("next");
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      moveSelection("first");
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      moveSelection("last");
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      onOpenEntry(entry);
      return;
    }
    if (event.key === " ") {
      event.preventDefault();
      setSelectedIndex(index);
      setDetailPanelOpen((current) => !current);
    }
  };

  const updateMode = (compareMode: FolderCompareMode) => {
    onRescan(folderScanOptionsWithMode(options, compareMode));
  };

  const updateScanOption = (key: keyof Omit<FolderScanOptions, "compareMode">, enabled: boolean) => {
    onRescan(folderScanOptionsWithToggle(options, key, enabled));
  };

  const toggleStatus = (status: FolderEntryStatus) => {
    setViewSettings((current) => ({
      ...current,
      statusFilters: {
        ...current.statusFilters,
        [status]: !current.statusFilters[status],
      },
    }));
  };

  const changeSort = (key: FolderSortKey) => {
    setViewSettings((current) => ({
      ...current,
      sort: nextFolderSort(current.sort, key),
    }));
  };

  const toggleFolderCollapse = (path: string) => {
    setCollapsedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const copyPath = async (label: string, path: string) => {
    try {
      await writeClipboardText(path);
      setCopyMessage(pathCopySuccessMessage(label.replace(" 경로 복사", "")));
    } catch {
      setCopyMessage(pathCopyFailureMessage);
    }
  };

  return (
    <main className="workspace">
      <header className="toolbar command-toolbar folder-command-toolbar">
        <div className="command-group">
          <button className="command-button" onClick={onBack}>← 홈</button>
          <button className="command-button" onClick={onNewScan} disabled={busy}>새 폴더</button>
          <button className="command-button primary-button" onClick={() => onRescan(options)} disabled={busy}>
            다시 스캔
          </button>
        </div>
        <div className="command-group" aria-label="스캔 옵션">
          <label className="toolbar-field">
            <span>비교 방식</span>
            <select
              className="toolbar-select wide"
              value={options.compareMode}
              onChange={(event) => updateMode(event.target.value as FolderCompareMode)}
              disabled={busy}
            >
              <option value="metadata">메타데이터</option>
              <option value="quickHash">빠른 해시</option>
              <option value="fullHash">전체 해시</option>
            </select>
          </label>
          <label className="toolbar-check">
            <input
              type="checkbox"
              checked={options.includeHidden}
              onChange={(event) => updateScanOption("includeHidden", event.target.checked)}
              disabled={busy}
            />
            숨김 포함
          </label>
          <label className="toolbar-check">
            <input
              type="checkbox"
              checked={options.respectGitignore}
              onChange={(event) => updateScanOption("respectGitignore", event.target.checked)}
              disabled={busy}
            />
            .gitignore
          </label>
          <label className="toolbar-check">
            <input
              type="checkbox"
              checked={options.followSymlinks}
              onChange={(event) => updateScanOption("followSymlinks", event.target.checked)}
              disabled={busy}
            />
            symlink 추적
          </label>
        </div>
        <div className="toolbar-spacer" />
        <div className="command-group search-group">
          <input
            ref={searchInputRef}
            className="search-input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.preventDefault();
              setQuery("");
            }}
            placeholder="경로 필터"
            aria-label="경로 필터"
            aria-keyshortcuts={commandAriaKeyshortcuts("searchPath")}
          />
        </div>
      </header>

      <section className="folder-roots">
        <div title={result.leftRoot}><span>LEFT</span><strong>{result.leftRoot}</strong></div>
        <div title={result.rightRoot}><span>RIGHT</span><strong>{result.rightRoot}</strong></div>
      </section>

      <section className="folder-filter-row" aria-label="상태 필터">
        {FOLDER_STATUSES.map((status) => (
          <button
            key={status}
            type="button"
            className={`filter-chip ${viewSettings.statusFilters[status] ? "active" : ""} ${status}`}
            aria-pressed={viewSettings.statusFilters[status]}
            aria-label={`${statusLabels[status]} ${statusCounts[status].toLocaleString()}개, ${
              viewSettings.statusFilters[status] ? "표시 중" : "숨김"
            }`}
            onClick={() => toggleStatus(status)}
          >
            <strong>{statusCounts[status].toLocaleString()}</strong>
            {statusLabels[status]}
          </button>
        ))}
        <span className="scan-time">{result.durationMs} ms</span>
      </section>

      {scanProgress && (
        <section
          className={`folder-scan-progress ${scanProgress.active ? "active" : "cancelled"}`}
          role="status"
          aria-live="polite"
        >
          <div>
            <strong>{scanProgress.active ? "스캔 중" : "스캔 취소됨"}</strong>
            <span>{scanProgress.message}</span>
            <small>
              작업 #{scanProgress.jobId} · {scanProgress.leftRoot} ↔ {scanProgress.rightRoot}
            </small>
          </div>
          {scanProgress.active && (
            <button type="button" onClick={onCancelScan}>
              스캔 취소
            </button>
          )}
        </section>
      )}

      {pathConflicts.length > 0 && (
        <section className="folder-path-warning" role="status" aria-live="polite">
          <strong>포터블 경로 충돌 {pathConflicts.length.toLocaleString()}개</strong>
          <span>
            대소문자 또는 Unicode 정규화만 다른 경로가 있습니다. Windows/macOS 기본 파일시스템에서는 같은 항목처럼
            보일 수 있습니다.
          </span>
          <small>{pathConflicts[0].variants.join(" ↔ ")}</small>
        </section>
      )}

      <section className="folder-sync-dry-run" aria-label="동기화 드라이런 요약">
        <strong>동기화 드라이런</strong>
        <span>실제 파일 변경 없음</span>
        <DryRunSummary direction="leftToRight" summary={syncDryRun.leftToRight} />
        <DryRunSummary direction="rightToLeft" summary={syncDryRun.rightToLeft} />
      </section>

      <section
        ref={tableWrapRef}
        className="folder-table-wrap"
        aria-label="폴더 비교 결과"
        aria-describedby="folder-selection-status"
        onScroll={updateScrollViewport}
      >
        <table className="folder-table" aria-rowcount={entries.length}>
          <thead>
            <tr>
              <SortableHeader label="상태" sortKey="status" current={viewSettings.sort} onSort={changeSort} />
              <SortableHeader label="상대 경로" sortKey="path" current={viewSettings.sort} onSort={changeSort} />
              <SortableHeader label="크기" sortKey="size" current={viewSettings.sort} onSort={changeSort} />
              <SortableHeader
                label="수정 시각"
                sortKey="modified"
                current={viewSettings.sort}
                onSort={changeSort}
              />
              <th>종류</th>
            </tr>
          </thead>
          <tbody>
            {virtualRange.beforeHeight > 0 && (
              <VirtualSpacer height={virtualRange.beforeHeight} />
            )}
            {visibleEntries.map((entry, visibleIndex) => {
              const index = virtualRange.start + visibleIndex;
              const collapsible = folderEntryHasChildren(entry, preparedEntries);
              const collapsed = collapsedPaths.has(entry.relativePath);
              return (
                <tr
                  key={entry.relativePath}
                  ref={(element) => {
                    rowRefs.current[index] = element;
                  }}
                  tabIndex={0}
                  aria-rowindex={index + 2}
                  aria-selected={selectedIndex === index}
                  aria-label={`${entry.relativePath}, ${statusLabels[entry.status]}`}
                  className={`status-${entry.status} ${selectedIndex === index ? "selected-row" : ""}`}
                  onFocus={() => selectRow(index)}
                  onClick={() => selectRow(index)}
                  onDoubleClick={() => onOpenEntry(entry)}
                  onKeyDown={(event) => handleRowKeyDown(event, entry, index)}
                  title={entry.message ?? "더블 클릭하여 파일 비교"}
                >
                  <td>
                    <span
                      className={`status-chip ${entry.status}`}
                      aria-label={`상태: ${statusLabels[entry.status]}`}
                    >
                      {statusLabels[entry.status]}
                    </span>
                  </td>
                  <td
                    className={`path-cell ${isFolderDirectoryEntry(entry) ? "directory-path" : ""}`}
                    style={{ paddingLeft: 10 + folderEntryDepth(entry) * 16 }}
                  >
                    <span className="path-cell-content">
                      {collapsible && (
                        <button
                          type="button"
                          className="folder-tree-toggle"
                          aria-expanded={!collapsed}
                          aria-label={`${entry.relativePath} ${collapsed ? "펼치기" : "접기"}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            toggleFolderCollapse(entry.relativePath);
                          }}
                        >
                          {collapsed ? "▸" : "▾"}
                        </button>
                      )}
                      {!collapsible && <span className="folder-tree-spacer" aria-hidden="true" />}
                      <span>{entry.relativePath}</span>
                    </span>
                  </td>
                  <td>{formatEntrySize(entry)}</td>
                  <td>{formatModified(folderEntryModifiedMs(entry))}</td>
                  <td>{formatKind(entry)}</td>
                </tr>
              );
            })}
            {virtualRange.afterHeight > 0 && (
              <VirtualSpacer height={virtualRange.afterHeight} />
            )}
          </tbody>
        </table>
        {entries.length === 0 && (
          <div className="empty-table">현재 필터에 해당하는 항목이 없습니다.</div>
        )}
      </section>

      {detailEntry && (
        <section className="folder-action-panel" aria-label="선택 항목 세부 정보">
          <div className="folder-action-heading">
            <div>
              <span className="side-label">SELECTED</span>
              <strong>{detailEntry.relativePath}</strong>
            </div>
            <button
              type="button"
              onClick={() => onOpenEntry(detailEntry)}
              disabled={busy || !canCompareFolderEntry(detailEntry)}
            >
              2-way 비교
            </button>
          </div>
          {!canCompareFolderEntry(detailEntry) && (
            <p className="folder-action-note">양쪽에 있는 일반 파일만 2-way 비교로 열 수 있습니다.</p>
          )}
          <div className="folder-path-actions">
            {folderEntryPathActions(detailEntry).map((action) => (
              <span className="folder-path-action-group" key={action.side}>
                <button
                  type="button"
                  onClick={() => onRevealPath(action.path)}
                >
                  {action.revealLabel}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void copyPath(action.copyLabel, action.path);
                  }}
                >
                  {action.copyLabel}
                </button>
              </span>
            ))}
          </div>
          {copyMessage && (
            <p className="folder-action-note" role="status">
              {copyMessage}
            </p>
          )}
          <dl className="folder-detail-list">
            {folderEntryDetailRows(detailEntry).map((row) => (
              <div key={row.label}>
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <footer className="status-bar">
        <span>{entries.length.toLocaleString()}개 표시 / {result.entries.length.toLocaleString()}개 전체</span>
        <span id="folder-selection-status" aria-live="polite">
          {selectedEntry
            ? `${selectedEntry.relativePath} 선택됨 · Enter로 2-way 비교 · Space로 세부 정보`
            : "현재 필터에 표시된 항목 없음"}
        </span>
      </footer>
    </main>
  );
}

function VirtualSpacer({ height }: { height: number }) {
  return (
    <tr className="virtual-spacer" aria-hidden="true">
      <td colSpan={5} style={{ height }} />
    </tr>
  );
}

function SortableHeader({
  label,
  sortKey,
  current,
  onSort,
}: {
  label: string;
  sortKey: FolderSortKey;
  current: { key: FolderSortKey; direction: "asc" | "desc" };
  onSort: (sortKey: FolderSortKey) => void;
}) {
  const active = current.key === sortKey;
  const directionLabel = current.direction === "asc" ? "오름차순" : "내림차순";

  return (
    <th aria-sort={active ? (current.direction === "asc" ? "ascending" : "descending") : "none"}>
      <button className="sort-header" type="button" onClick={() => onSort(sortKey)}>
        {label}
        {active && <span>{current.direction === "asc" ? "↑" : "↓"}</span>}
        {active && <small>{directionLabel}</small>}
      </button>
    </th>
  );
}

function DryRunSummary({
  direction,
  summary,
}: {
  direction: FolderSyncDirection;
  summary: FolderSyncDryRunSummary;
}) {
  return (
    <span className="dry-run-summary">
      <b>{direction === "leftToRight" ? "왼쪽→오른쪽" : "오른쪽→왼쪽"}</b>
      {formatDryRunSummary(summary)}
    </span>
  );
}

function formatDryRunSummary(summary: FolderSyncDryRunSummary): string {
  if (summary.total === 0) return "작업 없음";
  const parts = [];
  if (summary.copies > 0) parts.push(`복사 ${summary.copies.toLocaleString()}`);
  if (summary.overwrites > 0) parts.push(`덮어쓰기 ${summary.overwrites.toLocaleString()}`);
  if (summary.blocked > 0) parts.push(`확인 필요 ${summary.blocked.toLocaleString()}`);
  if (summary.destructive > 0) parts.push(`주의 ${summary.destructive.toLocaleString()}`);
  return parts.join(" · ");
}

function formatEntrySize(entry: FolderEntry): string {
  const left = entry.left?.kind === "file" ? formatBytes(entry.left.size) : "—";
  const right = entry.right?.kind === "file" ? formatBytes(entry.right.size) : "—";
  if (left === right) return left;
  return `${left} / ${right}`;
}

function formatModified(modifiedMs: number | null): string {
  if (modifiedMs == null) return "—";
  return new Date(modifiedMs).toLocaleString();
}

function formatKind(entry: FolderEntry): string {
  if (entry.left?.kind && entry.right?.kind && entry.left.kind !== entry.right.kind) {
    return `${entry.left.kind} / ${entry.right.kind}`;
  }
  return entry.left?.kind ?? entry.right?.kind ?? "—";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
