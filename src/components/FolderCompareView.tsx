import { type KeyboardEvent, type MouseEvent, useEffect, useMemo, useRef, useState } from "react";
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
  folderEntryPrimaryAction,
  folderScanOptionsWithMode,
  folderScanOptionsWithToggle,
  folderVirtualRange,
  isFolderDirectoryEntry,
  isFolderSearchShortcut,
  nextFolderSelectionIndex,
  nextFolderSort,
  prepareFolderEntries,
  summarizeFolderSyncDryRun,
  type FolderEntryPrimaryAction,
  type FolderEntryPathAction,
  type FolderSortKey,
  type FolderSyncDirection,
  type FolderSyncDryRunSummary,
} from "../core/folderView";
import { FOLDER_COMPARE_TEXT, localeForLanguage } from "../core/i18n";
import type {
  FolderCompareMode,
  FolderEntry,
  FolderEntryStatus,
  FolderScanOptions,
  FolderScanProgress,
  FolderScanResult,
} from "../core/models";
import {
  pathCopyFailureMessageForLanguage,
  pathCopySuccessMessage,
  writeClipboardText,
} from "../core/pathCopy";
import { loadFolderViewSettings, saveFolderViewSettings, type AppLanguage } from "../core/settings";

interface FolderCompareViewProps {
  result: FolderScanResult;
  options: FolderScanOptions;
  busy: boolean;
  languageMode?: AppLanguage;
  scanProgress: FolderScanProgress | null;
  onBack: () => void;
  onNewScan: () => void;
  onRescan: (options: FolderScanOptions) => void;
  onCancelScan: () => void;
  onOpenEntry: (entry: FolderEntry) => void;
  onRevealPath: (path: string) => void;
}

export function FolderCompareView({
  result,
  options,
  busy,
  languageMode = "en",
  scanProgress,
  onBack,
  onNewScan,
  onRescan,
  onCancelScan,
  onOpenEntry,
  onRevealPath,
}: FolderCompareViewProps) {
  const text = FOLDER_COMPARE_TEXT[languageMode];
  const statusLabels = text.statusLabels;
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
    leftToRight: summarizeFolderSyncDryRun(
      buildFolderSyncDryRunPlan(result, "leftToRight", languageMode),
    ),
    rightToLeft: summarizeFolderSyncDryRun(
      buildFolderSyncDryRunPlan(result, "rightToLeft", languageMode),
    ),
  }), [languageMode, result]);
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
      runPrimaryAction(entry);
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

  const runPrimaryAction = (entry: FolderEntry) => {
    const action = folderEntryPrimaryAction(entry, preparedEntries);
    if (action.kind === "compare") {
      onOpenEntry(entry);
      return;
    }
    if (action.kind === "reveal") {
      onRevealPath(action.path);
      return;
    }
    if (action.kind === "toggle") {
      toggleFolderCollapse(action.path);
    }
  };

  const handleRowClick = (
    event: MouseEvent<HTMLTableRowElement>,
    entry: FolderEntry,
    index: number,
  ) => {
    selectRow(index);
    if (event.detail !== 1) return;

    const action = folderEntryPrimaryAction(entry, preparedEntries);
    if (action.kind === "compare") {
      onOpenEntry(entry);
    }
  };

  const handleRowDoubleClick = (entry: FolderEntry) => {
    const action = folderEntryPrimaryAction(entry, preparedEntries);
    if (action.kind !== "compare") {
      runPrimaryAction(entry);
    }
  };

  const copyPath = async (side: FolderEntryPathAction["side"], path: string) => {
    try {
      await writeClipboardText(path);
      setCopyMessage(pathCopySuccessMessage(copyPathSideLabel(side, languageMode), languageMode));
    } catch {
      setCopyMessage(pathCopyFailureMessageForLanguage(languageMode));
    }
  };

  return (
    <main className="workspace">
      <header className="toolbar command-toolbar folder-command-toolbar">
        <div className="command-group">
          <button className="command-button" onClick={onBack}>{text.home}</button>
          <button className="command-button" onClick={onNewScan} disabled={busy}>{text.newScan}</button>
          <button className="command-button primary-button" onClick={() => onRescan(options)} disabled={busy}>
            {text.rescan}
          </button>
        </div>
        <div className="command-group" aria-label={text.scanOptionsAria}>
          <label className="toolbar-field">
            <span>{text.mode}</span>
            <select
              className="toolbar-select wide"
              value={options.compareMode}
              onChange={(event) => updateMode(event.target.value as FolderCompareMode)}
              disabled={busy}
            >
              <option value="metadata">{text.metadata}</option>
              <option value="quickHash">{text.quickHash}</option>
              <option value="fullHash">{text.fullHash}</option>
            </select>
          </label>
          <label className="toolbar-check">
            <input
              type="checkbox"
              checked={options.includeHidden}
              onChange={(event) => updateScanOption("includeHidden", event.target.checked)}
              disabled={busy}
            />
            {text.hidden}
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
            {text.symlinks}
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
            placeholder={text.pathFilter}
            aria-label={text.pathFilter}
            aria-keyshortcuts={commandAriaKeyshortcuts("searchPath")}
          />
        </div>
      </header>

      <section className="folder-roots">
        <div title={result.leftRoot}><span>LEFT</span><strong>{result.leftRoot}</strong></div>
        <div title={result.rightRoot}><span>RIGHT</span><strong>{result.rightRoot}</strong></div>
      </section>

      <section className="folder-filter-row" aria-label={text.statusFiltersAria}>
        {FOLDER_STATUSES.map((status) => (
          <button
            key={status}
            type="button"
            className={`filter-chip ${viewSettings.statusFilters[status] ? "active" : ""} ${status}`}
            aria-pressed={viewSettings.statusFilters[status]}
            aria-label={text.statusFilterAria(
              statusLabels[status],
              statusCounts[status],
              viewSettings.statusFilters[status],
            )}
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
            <strong>{scanProgress.active ? text.scanning : text.cancelled}</strong>
            <span>{scanProgress.message}</span>
            <small>
              {text.job} #{scanProgress.jobId} · {scanProgress.leftRoot} ↔ {scanProgress.rightRoot}
            </small>
          </div>
          {scanProgress.active && (
            <button type="button" onClick={onCancelScan}>
              {text.cancel}
            </button>
          )}
        </section>
      )}

      {pathConflicts.length > 0 && (
        <section className="folder-path-warning" role="status" aria-live="polite">
          <strong>{text.portableConflicts(pathConflicts.length)}</strong>
          <span>{text.portableConflictDescription}</span>
          <small>{pathConflicts[0].variants.join(" ↔ ")}</small>
        </section>
      )}

      <section className="folder-sync-dry-run" aria-label={text.syncDryRunAria}>
        <strong>{text.syncDryRun}</strong>
        <span>{text.noFileChanges}</span>
        <DryRunSummary direction="leftToRight" summary={syncDryRun.leftToRight} text={text} />
        <DryRunSummary direction="rightToLeft" summary={syncDryRun.rightToLeft} text={text} />
      </section>

      <section
        ref={tableWrapRef}
        className="folder-table-wrap"
        aria-label={text.resultsAria}
        aria-describedby="folder-selection-status"
        onScroll={updateScrollViewport}
      >
        <table className="folder-table" aria-rowcount={entries.length}>
          <thead>
            <tr>
              <SortableHeader label={text.status} sortKey="status" current={viewSettings.sort} onSort={changeSort} />
              <SortableHeader label={text.relativePath} sortKey="path" current={viewSettings.sort} onSort={changeSort} />
              <SortableHeader label={text.size} sortKey="size" current={viewSettings.sort} onSort={changeSort} />
              <SortableHeader
                label={text.modified}
                sortKey="modified"
                current={viewSettings.sort}
                onSort={changeSort}
              />
              <th>{text.kind}</th>
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
              const primaryAction = folderEntryPrimaryAction(entry, preparedEntries);
              const rowTitle = folderPrimaryActionTitle(primaryAction, text);
              return (
                <tr
                  key={entry.relativePath}
                  ref={(element) => {
                    rowRefs.current[index] = element;
                  }}
                  tabIndex={0}
                  aria-rowindex={index + 2}
                  aria-selected={selectedIndex === index}
                  aria-label={`${entry.relativePath}, ${statusLabels[entry.status]}, ${rowTitle}`}
                  className={`status-${entry.status} ${selectedIndex === index ? "selected-row" : ""}`}
                  onFocus={() => selectRow(index)}
                  onClick={(event) => handleRowClick(event, entry, index)}
                  onDoubleClick={() => handleRowDoubleClick(entry)}
                  onKeyDown={(event) => handleRowKeyDown(event, entry, index)}
                  title={entry.message ?? rowTitle}
                >
                  <td>
                    <span
                      className={`status-chip ${entry.status}`}
                      aria-label={text.statusAria(statusLabels[entry.status])}
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
                          aria-label={`${entry.relativePath} ${collapsed ? text.expand : text.collapse}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            toggleFolderCollapse(entry.relativePath);
                          }}
                          onDoubleClick={(event) => {
                            event.stopPropagation();
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
                  <td>{formatModified(folderEntryModifiedMs(entry), languageMode)}</td>
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
          <div className="empty-table">{text.noRows}</div>
        )}
      </section>

      {detailEntry && (
        <section className="folder-action-panel" aria-label={text.detailsAria}>
          <div className="folder-action-heading">
            <div>
              <span className="side-label">{text.selected}</span>
              <strong>{detailEntry.relativePath}</strong>
            </div>
            <button
              type="button"
              onClick={() => onOpenEntry(detailEntry)}
              disabled={busy || !canCompareFolderEntry(detailEntry)}
            >
              {text.compare}
            </button>
          </div>
          {!canCompareFolderEntry(detailEntry) && (
            <p className="folder-action-note">{text.compareUnavailable}</p>
          )}
          <div className="folder-path-actions">
            {folderEntryPathActions(detailEntry, languageMode).map((action) => (
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
                    void copyPath(action.side, action.path);
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
            {folderEntryDetailRows(detailEntry, languageMode).map((row) => (
              <div key={row.label}>
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <footer className="status-bar">
        <span>{text.shownTotal(entries.length, result.entries.length)}</span>
        <span id="folder-selection-status" aria-live="polite">
          {selectedEntry
            ? text.selectedStatus(
                selectedEntry.relativePath,
                folderPrimaryActionTitle(
                  folderEntryPrimaryAction(selectedEntry, preparedEntries),
                  text,
                ),
              )
            : text.noRowsStatus}
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

  return (
    <th aria-sort={active ? (current.direction === "asc" ? "ascending" : "descending") : "none"}>
      <button className="sort-header" type="button" onClick={() => onSort(sortKey)}>
        {label}
        {active && <span>{current.direction === "asc" ? "↑" : "↓"}</span>}
      </button>
    </th>
  );
}

function DryRunSummary({
  direction,
  summary,
  text,
}: {
  direction: FolderSyncDirection;
  summary: FolderSyncDryRunSummary;
  text: (typeof FOLDER_COMPARE_TEXT)[AppLanguage];
}) {
  return (
    <span className="dry-run-summary">
      <b>{direction === "leftToRight" ? text.leftToRight : text.rightToLeft}</b>
      {formatDryRunSummary(summary, text)}
    </span>
  );
}

function formatDryRunSummary(
  summary: FolderSyncDryRunSummary,
  text: (typeof FOLDER_COMPARE_TEXT)[AppLanguage],
): string {
  if (summary.total === 0) return text.noActions;
  const parts = [];
  if (summary.copies > 0) parts.push(text.copyCount(summary.copies));
  if (summary.overwrites > 0) parts.push(text.overwriteCount(summary.overwrites));
  if (summary.blocked > 0) parts.push(text.reviewCount(summary.blocked));
  if (summary.destructive > 0) parts.push(text.cautionCount(summary.destructive));
  return parts.join(" · ");
}

function formatEntrySize(entry: FolderEntry): string {
  const sizes = [
    entry.left?.kind === "file" ? formatBytes(entry.left.size) : null,
    entry.right?.kind === "file" ? formatBytes(entry.right.size) : null,
  ].filter((size): size is string => size != null);

  if (sizes.length === 0) return "—";
  if (sizes.length === 1 || sizes[0] === sizes[1]) return sizes[0];
  return `${sizes[0]} / ${sizes[1]}`;
}

function formatModified(modifiedMs: number | null, languageMode: AppLanguage): string {
  if (modifiedMs == null) return "—";
  return new Date(modifiedMs).toLocaleString(localeForLanguage(languageMode));
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

function copyPathSideLabel(side: FolderEntryPathAction["side"], languageMode: AppLanguage): string {
  return FOLDER_COMPARE_TEXT[languageMode].pathSideLabel(side);
}

function folderPrimaryActionTitle(
  action: FolderEntryPrimaryAction,
  text: (typeof FOLDER_COMPARE_TEXT)[AppLanguage],
): string {
  switch (action.kind) {
    case "compare":
      return text.rowActionCompare;
    case "reveal":
      return action.side === "left" ? text.rowActionRevealLeft : text.rowActionRevealRight;
    case "toggle":
      return text.rowActionToggle;
    case "none":
      return text.rowActionUnavailable;
  }
}
