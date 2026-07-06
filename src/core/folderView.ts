import { matchesCommandShortcut, type KeyboardShortcutLike } from "./commands";
import { CORE_TEXT } from "./i18n";
import type {
  FolderCompareMode,
  FolderEntry,
  FolderEntryStatus,
  FolderScanOptions,
  FolderScanResult,
  FsEntryMeta,
} from "./models";
import type { AppLanguage } from "./settings";

export const FOLDER_STATUSES: FolderEntryStatus[] = [
  "different",
  "leftOnly",
  "rightOnly",
  "typeMismatch",
  "error",
  "same",
];

export type FolderStatusFilters = Record<FolderEntryStatus, boolean>;
export type FolderSortKey = "path" | "status" | "size" | "modified";
export type FolderSortDirection = "asc" | "desc";

export interface FolderSortState {
  key: FolderSortKey;
  direction: FolderSortDirection;
}

export interface FolderFilterState {
  query: string;
  statuses: FolderStatusFilters;
}

export interface FolderVirtualRange {
  start: number;
  end: number;
  beforeHeight: number;
  afterHeight: number;
  totalHeight: number;
}

export interface FolderEntryDetailRow {
  label: string;
  value: string;
}

export interface FolderEntryPathAction {
  side: "left" | "right";
  copyLabel: string;
  revealLabel: string;
  path: string;
}

export type FolderEntryPrimaryAction =
  | { kind: "compare" }
  | { kind: "reveal"; side: "left" | "right"; path: string }
  | { kind: "toggle"; path: string }
  | { kind: "none" };

export interface FolderPathConflict {
  identityKey: string;
  variants: string[];
}

export type FolderSyncDirection = "leftToRight" | "rightToLeft";
export type FolderSyncDryRunAction = "copyFile" | "createDirectory" | "overwriteFile" | "blocked";

export interface FolderSyncDryRunItem {
  relativePath: string;
  direction: FolderSyncDirection;
  action: FolderSyncDryRunAction;
  sourcePath: string | null;
  targetPath: string | null;
  destructive: boolean;
  message: string;
}

export interface FolderSyncDryRunSummary {
  total: number;
  copies: number;
  overwrites: number;
  blocked: number;
  destructive: number;
}

export const DEFAULT_FOLDER_STATUS_FILTERS: FolderStatusFilters = {
  same: false,
  different: true,
  leftOnly: true,
  rightOnly: true,
  typeMismatch: true,
  error: true,
};

export const DEFAULT_FOLDER_SORT: FolderSortState = {
  key: "path",
  direction: "asc",
};

export const FOLDER_ROW_HEIGHT = 34;
export const FOLDER_VIRTUAL_OVERSCAN = 8;

export function folderScanOptionsWithMode(
  options: FolderScanOptions,
  compareMode: FolderCompareMode,
): FolderScanOptions {
  return { ...options, compareMode };
}

export function folderScanOptionsWithToggle(
  options: FolderScanOptions,
  key: keyof Omit<FolderScanOptions, "compareMode">,
  enabled: boolean,
): FolderScanOptions {
  return { ...options, [key]: enabled };
}

export function countFolderStatuses(entries: FolderEntry[]): Record<FolderEntryStatus, number> {
  const counts = Object.fromEntries(FOLDER_STATUSES.map((status) => [status, 0])) as Record<
    FolderEntryStatus,
    number
  >;

  for (const entry of entries) {
    counts[entry.status] += 1;
  }

  return counts;
}

export function filterFolderEntries(
  entries: FolderEntry[],
  filters: FolderFilterState,
): FolderEntry[] {
  const normalizedQuery = filters.query.trim().toLocaleLowerCase();

  return entries.filter((entry) => {
    if (!filters.statuses[entry.status]) return false;
    if (!normalizedQuery) return true;
    return entry.relativePath.toLocaleLowerCase().includes(normalizedQuery);
  });
}

export function sortFolderEntries(
  entries: FolderEntry[],
  sort: FolderSortState,
): FolderEntry[] {
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => {
      const compared = compareFolderEntries(left.entry, right.entry, sort);
      return compared === 0 ? left.index - right.index : compared;
    })
    .map(({ entry }) => entry);
}

export function prepareFolderEntries(
  entries: FolderEntry[],
  filters: FolderFilterState,
  sort: FolderSortState,
): FolderEntry[] {
  return sortFolderEntries(filterFolderEntries(entries, filters), sort);
}

export function nextFolderSort(current: FolderSortState, key: FolderSortKey): FolderSortState {
  if (current.key !== key) {
    return { key, direction: "asc" };
  }

  return { key, direction: current.direction === "asc" ? "desc" : "asc" };
}

export function clampFolderSelectionIndex(current: number, total: number): number {
  if (total <= 0) return -1;
  if (!Number.isFinite(current)) return 0;
  return Math.max(0, Math.min(Math.trunc(current), total - 1));
}

export function nextFolderSelectionIndex(
  current: number,
  total: number,
  direction: "previous" | "next" | "first" | "last",
): number {
  if (total <= 0) return -1;
  const clamped = clampFolderSelectionIndex(current, total);

  if (direction === "first") return 0;
  if (direction === "last") return total - 1;
  if (direction === "previous") return Math.max(0, clamped - 1);
  return Math.min(total - 1, clamped + 1);
}

export function canCompareFolderEntry(entry: FolderEntry): boolean {
  if (entry.status === "error" || entry.status === "typeMismatch") return false;

  const hasLeftFile = entry.leftPath != null && entry.left?.kind === "file";
  const hasRightFile = entry.rightPath != null && entry.right?.kind === "file";
  const hasNonFileEntry =
    (entry.left != null && entry.left.kind !== "file") ||
    (entry.right != null && entry.right.kind !== "file");

  return !hasNonFileEntry && (hasLeftFile || hasRightFile);
}

export function folderEntryPrimaryAction(
  entry: FolderEntry,
  entries: FolderEntry[],
): FolderEntryPrimaryAction {
  if (canCompareFolderEntry(entry)) {
    return { kind: "compare" };
  }

  if (folderEntryHasChildren(entry, entries)) {
    return { kind: "toggle", path: entry.relativePath };
  }

  if (entry.status === "leftOnly" && entry.leftPath && entry.left?.kind === "file") {
    return { kind: "reveal", side: "left", path: entry.leftPath };
  }

  if (entry.status === "rightOnly" && entry.rightPath && entry.right?.kind === "file") {
    return { kind: "reveal", side: "right", path: entry.rightPath };
  }

  return { kind: "none" };
}

export function isFolderDirectoryEntry(entry: FolderEntry): boolean {
  return entry.left?.kind === "directory" || entry.right?.kind === "directory";
}

export function folderEntryDepth(entry: Pick<FolderEntry, "relativePath">): number {
  return Math.max(0, entry.relativePath.split("/").filter(Boolean).length - 1);
}

export function folderEntryHasChildren(entry: FolderEntry, entries: FolderEntry[]): boolean {
  if (!isFolderDirectoryEntry(entry)) return false;
  const prefix = `${entry.relativePath.replace(/\/+$/, "")}/`;
  return entries.some((candidate) => candidate.relativePath.startsWith(prefix));
}

export function applyCollapsedFolderEntries(
  entries: FolderEntry[],
  collapsedPaths: ReadonlySet<string>,
): FolderEntry[] {
  if (collapsedPaths.size === 0) return entries;

  return entries.filter((entry) => {
    for (const collapsedPath of collapsedPaths) {
      const prefix = `${collapsedPath.replace(/\/+$/, "")}/`;
      if (entry.relativePath.startsWith(prefix)) return false;
    }
    return true;
  });
}

export function folderPortablePathIdentity(relativePath: string): string {
  return relativePath
    .replace(/\\/g, "/")
    .split("/")
    .filter((segment) => segment.length > 0)
    .join("/")
    .normalize("NFC")
    .toLocaleLowerCase("en-US");
}

export function detectFolderPathConflicts(entries: FolderEntry[]): FolderPathConflict[] {
  const groups = new Map<string, Set<string>>();

  for (const entry of entries) {
    const identityKey = folderPortablePathIdentity(entry.relativePath);
    if (!identityKey) continue;
    const variants = groups.get(identityKey) ?? new Set<string>();
    variants.add(entry.relativePath);
    groups.set(identityKey, variants);
  }

  return Array.from(groups.entries())
    .map(([identityKey, variants]) => ({
      identityKey,
      variants: Array.from(variants),
    }))
    .filter((conflict) => conflict.variants.length > 1)
    .sort((left, right) => left.identityKey.localeCompare(right.identityKey));
}

export function isSafeFolderRelativePath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, "/");
  if (!normalized) return false;
  if (normalized.startsWith("/") || normalized.startsWith("//")) return false;
  if (/^[A-Za-z]:($|\/)/.test(normalized)) return false;

  return normalized.split("/").every((segment) => {
    return segment.length > 0 && segment !== "." && segment !== "..";
  });
}

export function buildFolderSyncDryRunPlan(
  result: FolderScanResult,
  direction: FolderSyncDirection,
  language: AppLanguage = "en",
): FolderSyncDryRunItem[] {
  return result.entries
    .map((entry) =>
      folderSyncDryRunItem(entry, result.leftRoot, result.rightRoot, direction, language)
    )
    .filter((item): item is FolderSyncDryRunItem => item != null);
}

export function summarizeFolderSyncDryRun(items: FolderSyncDryRunItem[]): FolderSyncDryRunSummary {
  const summary: FolderSyncDryRunSummary = {
    total: items.length,
    copies: 0,
    overwrites: 0,
    blocked: 0,
    destructive: 0,
  };

  for (const item of items) {
    if (item.action === "copyFile" || item.action === "createDirectory") summary.copies += 1;
    if (item.action === "overwriteFile") summary.overwrites += 1;
    if (item.action === "blocked") summary.blocked += 1;
    if (item.destructive) summary.destructive += 1;
  }

  return summary;
}

function folderSyncDryRunItem(
  entry: FolderEntry,
  leftRoot: string,
  rightRoot: string,
  direction: FolderSyncDirection,
  language: AppLanguage,
): FolderSyncDryRunItem | null {
  const text = CORE_TEXT[language].folderSync;
  if (entry.status === "same") return null;

  const source = direction === "leftToRight" ? entry.left : entry.right;
  const target = direction === "leftToRight" ? entry.right : entry.left;
  const sourcePath = direction === "leftToRight" ? entry.leftPath : entry.rightPath;
  const targetPath = direction === "leftToRight"
    ? entry.rightPath ?? folderDisplayPath(rightRoot, entry.relativePath)
    : entry.leftPath ?? folderDisplayPath(leftRoot, entry.relativePath);

  if (!isSafeFolderRelativePath(entry.relativePath)) {
    return blockedFolderSyncItem(
      entry,
      direction,
      sourcePath,
      null,
      text.rootEscape,
    );
  }

  if (entry.status === "error") {
    return blockedFolderSyncItem(entry, direction, sourcePath, targetPath, entry.message ?? text.scanError);
  }

  if (entry.status === "typeMismatch") {
    return blockedFolderSyncItem(
      entry,
      direction,
      sourcePath,
      targetPath,
      text.typeMismatch,
    );
  }

  if (!source || !sourcePath) return null;
  if (entry.status === "different") {
    if (source.kind === "file" && target?.kind === "file") {
      return {
        relativePath: entry.relativePath,
        direction,
        action: "overwriteFile",
        sourcePath,
        targetPath,
        destructive: true,
        message: text.overwriteFile,
      };
    }
    return blockedFolderSyncItem(
      entry,
      direction,
      sourcePath,
      targetPath,
      text.fileChangeBlocked,
    );
  }

  if (entry.status === sourceOnlyStatus(direction)) {
    if (source.kind === "file") {
      return {
        relativePath: entry.relativePath,
        direction,
        action: "copyFile",
        sourcePath,
        targetPath,
        destructive: false,
        message: text.copyFile,
      };
    }
    if (source.kind === "directory") {
      return {
        relativePath: entry.relativePath,
        direction,
        action: "createDirectory",
        sourcePath,
        targetPath,
        destructive: false,
        message: text.createDirectory,
      };
    }
    return blockedFolderSyncItem(
      entry,
      direction,
      sourcePath,
      targetPath,
      text.unsupportedKind,
    );
  }

  return null;
}

function sourceOnlyStatus(direction: FolderSyncDirection): FolderEntryStatus {
  return direction === "leftToRight" ? "leftOnly" : "rightOnly";
}

function blockedFolderSyncItem(
  entry: FolderEntry,
  direction: FolderSyncDirection,
  sourcePath: string | null,
  targetPath: string | null,
  message: string,
): FolderSyncDryRunItem {
  return {
    relativePath: entry.relativePath,
    direction,
    action: "blocked",
    sourcePath,
    targetPath,
    destructive: false,
    message,
  };
}

function folderDisplayPath(root: string, relativePath: string): string {
  const trimmedRoot = root.replace(/[\\/]+$/, "");
  const separator = root.includes("\\") ? "\\" : "/";
  const relative = separator === "\\" ? relativePath.replace(/\//g, "\\") : relativePath;
  return trimmedRoot ? `${trimmedRoot}${separator}${relative}` : relative;
}

export function folderEntryDetailRows(
  entry: FolderEntry,
  language: AppLanguage = "en",
): FolderEntryDetailRow[] {
  const text = CORE_TEXT[language].folderDetails;
  const rows: FolderEntryDetailRow[] = [
    { label: text.relativePath, value: entry.relativePath },
    { label: text.status, value: entry.status },
    { label: text.leftPath, value: entry.leftPath ?? "—" },
    { label: text.rightPath, value: entry.rightPath ?? "—" },
  ];

  if (entry.left) {
    rows.push({ label: text.leftItem, value: entryMetaSummary(entry.left) });
  }
  if (entry.right) {
    rows.push({ label: text.rightItem, value: entryMetaSummary(entry.right) });
  }
  if (entry.message) {
    rows.push({ label: text.message, value: entry.message });
  }

  return rows;
}

export function folderEntryPathActions(
  entry: FolderEntry,
  language: AppLanguage = "en",
): FolderEntryPathAction[] {
  const text = CORE_TEXT[language].folderDetails;
  const actions: FolderEntryPathAction[] = [];
  if (entry.leftPath) {
    actions.push({
      side: "left",
      copyLabel: text.copyLeftPath,
      revealLabel: text.revealLeft,
      path: entry.leftPath,
    });
  }
  if (entry.rightPath) {
    actions.push({
      side: "right",
      copyLabel: text.copyRightPath,
      revealLabel: text.revealRight,
      path: entry.rightPath,
    });
  }
  return actions;
}

export function isFolderSearchShortcut(event: KeyboardShortcutLike): boolean {
  return matchesCommandShortcut("searchPath", event);
}

function entryMetaSummary(meta: FsEntryMeta): string {
  const parts = [meta.kind, `${meta.size} B`];
  if (meta.modifiedMs != null) parts.push(`mtime ${meta.modifiedMs}`);
  if (meta.hash) parts.push(`hash ${meta.hash}`);
  return parts.join(" · ");
}

export function folderVirtualRange(
  total: number,
  scrollTop: number,
  viewportHeight: number,
  rowHeight = FOLDER_ROW_HEIGHT,
  overscan = FOLDER_VIRTUAL_OVERSCAN,
): FolderVirtualRange {
  const normalizedTotal = Math.max(0, Math.trunc(Number.isFinite(total) ? total : 0));
  const normalizedRowHeight = Math.max(1, Math.trunc(Number.isFinite(rowHeight) ? rowHeight : 1));
  const normalizedOverscan = Math.max(0, Math.trunc(Number.isFinite(overscan) ? overscan : 0));

  if (normalizedTotal === 0) {
    return { start: 0, end: 0, beforeHeight: 0, afterHeight: 0, totalHeight: 0 };
  }

  const normalizedScrollTop = Math.max(0, Number.isFinite(scrollTop) ? scrollTop : 0);
  const normalizedViewportHeight = Math.max(0, Number.isFinite(viewportHeight) ? viewportHeight : 0);
  const firstVisible = Math.floor(normalizedScrollTop / normalizedRowHeight);
  const visibleCount = Math.max(1, Math.ceil(normalizedViewportHeight / normalizedRowHeight));
  const start = Math.max(0, firstVisible - normalizedOverscan);
  const end = Math.min(normalizedTotal, firstVisible + visibleCount + normalizedOverscan);

  return {
    start,
    end,
    beforeHeight: start * normalizedRowHeight,
    afterHeight: (normalizedTotal - end) * normalizedRowHeight,
    totalHeight: normalizedTotal * normalizedRowHeight,
  };
}

export function folderEntrySize(entry: FolderEntry): number | null {
  const sizes = [entry.left?.size, entry.right?.size].filter((size): size is number => size != null);
  return sizes.length === 0 ? null : Math.max(...sizes);
}

export function folderEntryModifiedMs(entry: FolderEntry): number | null {
  const times = [entry.left?.modifiedMs, entry.right?.modifiedMs].filter(
    (time): time is number => time != null,
  );
  return times.length === 0 ? null : Math.max(...times);
}

function compareFolderEntries(left: FolderEntry, right: FolderEntry, sort: FolderSortState): number {
  switch (sort.key) {
    case "path":
      return applyDirection(comparePath(left.relativePath, right.relativePath), sort.direction);
    case "status":
      return applyDirection(compareStatus(left.status, right.status), sort.direction);
    case "size":
      return compareNullable(folderEntrySize(left), folderEntrySize(right), sort.direction);
    case "modified":
      return compareNullable(
        folderEntryModifiedMs(left),
        folderEntryModifiedMs(right),
        sort.direction,
      );
  }
}

function comparePath(left: string, right: string): number {
  const normalizedLeft = left.toLocaleLowerCase();
  const normalizedRight = right.toLocaleLowerCase();
  if (normalizedLeft < normalizedRight) return -1;
  if (normalizedLeft > normalizedRight) return 1;
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareStatus(left: FolderEntryStatus, right: FolderEntryStatus): number {
  return FOLDER_STATUSES.indexOf(left) - FOLDER_STATUSES.indexOf(right);
}

function compareNullable(
  left: number | null,
  right: number | null,
  direction: FolderSortDirection,
): number {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  return applyDirection(left - right, direction);
}

function applyDirection(value: number, direction: FolderSortDirection): number {
  if (value === 0) return 0;
  return direction === "asc" ? value : -value;
}
