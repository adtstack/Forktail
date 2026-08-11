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
  folderEntryName,
  folderEntryParentPath,
  folderEntryModifiedMs,
  folderEntryPathActions,
  folderEntryPrimaryAction,
  folderRowGesturePlan,
  folderScanOptionsWithMode,
  folderScanOptionsWithToggle,
  folderVirtualRange,
  isFolderDirectoryEntry,
  isFolderSearchShortcut,
  nextFolderSelectionIndex,
  nextFolderSort,
  prepareFolderTree,
  progressiveFolderViewEntries,
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
  FolderEntryUpsert,
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
  progressiveRows?: FolderEntryUpsert[] | null;
  onBack: () => void;
  onNewScan: () => void;
  onRescan: (options: FolderScanOptions) => void;
  onCancelScan: () => void;
  onOpenEntry: (entry: FolderEntry) => void;
  onRevealPath: (path: string) => void;
}

const EMPTY_FOLDER_PATHS: ReadonlySet<string> = new Set();

export function FolderCompareView({
  result,
  options,
  busy,
  languageMode = "en",
  scanProgress,
  progressiveRows = null,
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
  const [selectedRelativePath, setSelectedRelativePath] = useState<string | null>(null);
  const [detailPanelOpen, setDetailPanelOpen] = useState(false);
  const [syncDryRunOpen, setSyncDryRunOpen] = useState(false);
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

  const progressiveView = useMemo(
    () => progressiveRows == null ? null : progressiveFolderViewEntries(progressiveRows),
    [progressiveRows],
  );
  const sourceEntries = progressiveView?.entries ?? result.entries;
  const pendingPaths = progressiveView?.pendingPaths ?? EMPTY_FOLDER_PATHS;
  const statusCounts = useMemo(() => countFolderStatuses(result.entries), [result.entries]);
  const pathConflicts = useMemo(() => detectFolderPathConflicts(sourceEntries), [sourceEntries]);
  const scanIncomplete = scanProgress?.active === true || pendingPaths.size > 0;
  const syncDryRun = useMemo(() => {
    if (!syncDryRunOpen || scanIncomplete) return null;
    return {
      leftToRight: summarizeFolderSyncDryRun(
        buildFolderSyncDryRunPlan(result, "leftToRight", languageMode),
      ),
      rightToLeft: summarizeFolderSyncDryRun(
        buildFolderSyncDryRunPlan(result, "rightToLeft", languageMode),
      ),
    };
  }, [languageMode, result, scanIncomplete, syncDryRunOpen]);
  const preparedTree = useMemo(() => {
    return prepareFolderTree(
      sourceEntries,
      { query, statuses: viewSettings.statusFilters },
      viewSettings.sort,
      pendingPaths,
    );
  }, [pendingPaths, query, sourceEntries, viewSettings]);
  const preparedEntries = preparedTree.entries;
  const entries = useMemo(
    () => applyCollapsedFolderEntries(preparedEntries, collapsedPaths),
    [collapsedPaths, preparedEntries],
  );
  const visibleMatchedCount = useMemo(
    () => entries.reduce(
      (count, entry) => count + (preparedTree.contextFolderPaths.has(entry.relativePath) ? 0 : 1),
      0,
    ),
    [entries, preparedTree.contextFolderPaths],
  );

  const selectedIndexFromPath = selectedRelativePath == null
    ? -1
    : entries.findIndex((entry) => entry.relativePath === selectedRelativePath);
  const selectedIndex = selectedIndexFromPath >= 0
    ? selectedIndexFromPath
    : clampFolderSelectionIndex(0, entries.length);
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
    setSelectedRelativePath((current) => {
      if (current && entries.some((entry) => entry.relativePath === current)) return current;
      return entries[0]?.relativePath ?? null;
    });
    rowRefs.current = rowRefs.current.slice(0, entries.length);
    if (entries.length === 0) setDetailPanelOpen(false);
  }, [entries.length]);

  useEffect(() => {
    setCopyMessage(null);
  }, [detailEntry?.relativePath]);

  useEffect(() => {
    setCollapsedPaths(new Set());
    setSelectedRelativePath(null);
  }, [result.leftRoot, result.rightRoot]);

  useEffect(() => {
    if (scanIncomplete) setSyncDryRunOpen(false);
  }, [scanIncomplete]);

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
    setSelectedRelativePath(nextIndex >= 0 ? entries[nextIndex]?.relativePath ?? null : null);
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
      if (folderRowGesturePlan("enter").activatePrimaryAction) {
        runPrimaryAction(entry);
      }
      return;
    }
    if (event.key === " ") {
      event.preventDefault();
      if (folderRowGesturePlan("space").toggleDetails) {
        setSelectedRelativePath(entry.relativePath);
        setDetailPanelOpen((current) => !current);
      }
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
    const action = primaryActionForEntry(entry);
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

  const primaryActionForEntry = (entry: FolderEntry): FolderEntryPrimaryAction => {
    if (!pendingPaths.has(entry.relativePath)) {
      return folderEntryPrimaryAction(entry, preparedEntries);
    }
    return folderEntryHasChildren(entry, preparedEntries)
      ? { kind: "toggle", path: entry.relativePath }
      : { kind: "none" };
  };

  const handleRowClick = (index: number) => {
    if (folderRowGesturePlan("singleClick").selectOnly) {
      selectRow(index);
    }
  };

  const handleRowDoubleClick = (entry: FolderEntry) => {
    if (folderRowGesturePlan("doubleClick").activatePrimaryAction) {
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
            <strong>{folderScanStatusTitle(scanProgress, text)}</strong>
            <span>{folderScanStatusMessage(scanProgress, text)}</span>
            {scanProgress.progress && (
              <span className="folder-scan-metrics">
                <b>{folderScanPhaseLabel(scanProgress.progress.phase, text)}</b>
                <span>{text.progressDiscovered(scanProgress.progress.discovered)}</span>
                <span>{text.progressFinalized(scanProgress.progress.finalized)}</span>
                <span>{text.progressPending(scanProgress.progress.pending)}</span>
                <span>{text.progressErrors(scanProgress.progress.errors)}</span>
                {scanProgress.progress.hashedFiles > 0 && (
                  <span>{text.progressHashed(scanProgress.progress.hashedFiles)}</span>
                )}
              </span>
            )}
            <small>
              {scanProgress.jobId == null ? "" : `${text.job} #${scanProgress.jobId} · `}
              {scanProgress.leftRoot} ↔ {scanProgress.rightRoot}
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

      <section className="folder-sync-disclosure" aria-label={text.syncDryRunAria}>
        <button
          type="button"
          className="folder-sync-toggle"
          aria-expanded={syncDryRunOpen}
          aria-controls="folder-sync-dry-run-content"
          aria-disabled={scanIncomplete}
          disabled={scanIncomplete}
          onClick={() => {
            if (!scanIncomplete) setSyncDryRunOpen((current) => !current);
          }}
        >
          <span className="folder-sync-chevron" aria-hidden="true">
            {syncDryRunOpen ? "▾" : "▸"}
          </span>
          <strong>{text.syncDryRun}</strong>
          <span>{text.noFileChanges}</span>
        </button>
        {syncDryRun && (
          <div id="folder-sync-dry-run-content" className="folder-sync-dry-run">
            <DryRunSummary direction="leftToRight" summary={syncDryRun.leftToRight} text={text} />
            <DryRunSummary direction="rightToLeft" summary={syncDryRun.rightToLeft} text={text} />
          </div>
        )}
      </section>

      <section
        id="folder-interaction-guide"
        className="folder-interaction-guide"
        aria-label={text.interactionGuideAria}
      >
        <strong>{text.interactionGuideTitle}</strong>
        <span>
          <kbd>{text.singleClick}</kbd>
          {text.selectOnly}
        </span>
        <span>
          <kbd>{text.doubleClick}</kbd>
          <span aria-hidden="true"> / </span>
          <kbd>Enter</kbd>
          {text.activateRow}
        </span>
        <span>
          <kbd>{text.detailsKey}</kbd>
          {text.showDetails}
        </span>
      </section>

      <section
        ref={tableWrapRef}
        className="folder-table-wrap"
        aria-label={text.resultsAria}
        aria-describedby="folder-interaction-guide folder-selection-status"
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
              const pending = pendingPaths.has(entry.relativePath);
              const primaryAction = primaryActionForEntry(entry);
              const rowTitle = folderPrimaryActionTitle(primaryAction, text);
              const directory = isFolderDirectoryEntry(entry);
              const contextFolder = preparedTree.contextFolderPaths.has(entry.relativePath);
              const parentPath = folderEntryParentPath(entry);
              const rowStatusLabel = contextFolder
                ? text.folderContext
                : pending ? text.checking : statusLabels[entry.status];
              return (
                <tr
                  key={entry.relativePath}
                  ref={(element) => {
                    rowRefs.current[index] = element;
                  }}
                  tabIndex={selectedIndex === index ? 0 : -1}
                  aria-rowindex={index + 2}
                  aria-selected={selectedIndex === index}
                  aria-label={`${entry.relativePath}, ${rowStatusLabel}, ${rowTitle}`}
                  className={`${pending ? "status-pending" : `status-${entry.status}`} ${directory ? "directory-row" : "file-row"} ${contextFolder ? "folder-context-row" : ""} ${selectedIndex === index ? "selected-row" : ""}`}
                  onFocus={() => selectRow(index)}
                  onClick={() => handleRowClick(index)}
                  onDoubleClick={() => handleRowDoubleClick(entry)}
                  onKeyDown={(event) => handleRowKeyDown(event, entry, index)}
                  title={entry.message ?? `${entry.relativePath} · ${rowTitle}`}
                >
                  <td>
                    {contextFolder ? (
                      <span className="folder-context-chip">{text.folderContext}</span>
                    ) : pending ? (
                      <span className="status-chip pending" aria-label={text.statusAria(text.checking)}>
                        {text.checking}
                      </span>
                    ) : (
                      <span
                        className={`status-chip ${entry.status}`}
                        aria-label={text.statusAria(statusLabels[entry.status])}
                      >
                        {statusLabels[entry.status]}
                      </span>
                    )}
                  </td>
                  <td
                    className={`path-cell ${directory ? "directory-path" : ""}`}
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
                      <span className="folder-entry-label">
                        <span className="folder-entry-name">{folderEntryName(entry)}</span>
                        {parentPath && (
                          <small className="folder-entry-parent">{parentPath}/</small>
                        )}
                      </span>
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
              disabled={
                busy
                || pendingPaths.has(detailEntry.relativePath)
                || !canCompareFolderEntry(detailEntry)
              }
            >
              {text.compare}
            </button>
          </div>
          {(pendingPaths.has(detailEntry.relativePath) || !canCompareFolderEntry(detailEntry)) && (
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
        <span>{text.shownTotal(visibleMatchedCount, sourceEntries.length)}</span>
        <span id="folder-selection-status" aria-live="polite">
          {selectedEntry
            ? text.selectedStatus(
                selectedEntry.relativePath,
                folderPrimaryActionTitle(
                  primaryActionForEntry(selectedEntry),
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

function folderScanStatusTitle(
  progress: FolderScanProgress,
  text: (typeof FOLDER_COMPARE_TEXT)[AppLanguage],
): string {
  if (progress.active) return text.scanning;
  if (progress.terminal?.outcome === "completed") return text.completed;
  if (progress.terminal?.outcome === "failed") return text.failed;
  return text.cancelled;
}

function folderScanStatusMessage(
  progress: FolderScanProgress,
  text: (typeof FOLDER_COMPARE_TEXT)[AppLanguage],
): string {
  const terminal = progress.terminal;
  if (!terminal) return progress.message;
  if (terminal.outcome === "completed") {
    return text.completedSummary(terminal.entryCount, terminal.durationMs);
  }
  if (terminal.outcome === "cancelled") {
    return text.cancelledSummary(terminal.finalized, terminal.pending);
  }
  return terminal.message;
}

function folderScanPhaseLabel(
  phase: NonNullable<FolderScanProgress["progress"]>["phase"],
  text: (typeof FOLDER_COMPARE_TEXT)[AppLanguage],
): string {
  switch (phase) {
    case "inventory": return text.phaseInventory;
    case "classify": return text.phaseClassify;
    case "hash": return text.phaseHash;
  }
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
