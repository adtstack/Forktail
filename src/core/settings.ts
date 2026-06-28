import {
  DEFAULT_FOLDER_SORT,
  DEFAULT_FOLDER_STATUS_FILTERS,
  FOLDER_STATUSES,
  type FolderSortKey,
  type FolderSortState,
  type FolderStatusFilters,
} from "./folderView";
import {
  DEFAULT_TEXT_DIFF_OPTIONS,
  type TextDiffOptions,
  type WhitespaceCompareMode,
} from "./diffOptions";
import {
  SAVE_LINE_ENDING_MODES,
  type SaveLineEndingMode,
} from "./lineEndings";
import type { FolderCompareMode, FolderScanOptions } from "./models";

const COMPARE_VIEW_SETTINGS_KEY = "forktail.compare-view.v1";
const FOLDER_SCAN_OPTIONS_KEY = "forktail.folder-scan-options.v1";
const FOLDER_VIEW_SETTINGS_KEY = "forktail.folder-view.v1";
const MERGE_SETTINGS_KEY = "forktail.merge-settings.v1";
const RECENT_SESSIONS_KEY = "forktail.recent-sessions.v1";
const ACTIVE_SESSION_KEY = "forktail.active-session.v1";
const APPEARANCE_SETTINGS_KEY = "forktail.appearance.v1";
const SORT_KEYS: FolderSortKey[] = ["path", "status", "size", "modified"];
const FOLDER_COMPARE_MODES: FolderCompareMode[] = ["metadata", "quickHash", "fullHash"];
const WHITESPACE_MODES: WhitespaceCompareMode[] = ["none", "trim", "all"];
const THEME_MODES: ThemeMode[] = ["system", "dark", "light"];
export const MAX_RECENT_SESSIONS = 20;

export type ThemeMode = "system" | "dark" | "light";

export interface AppearanceSettings {
  theme: ThemeMode;
}

export interface CompareViewSettings {
  diffOptions: TextDiffOptions;
  renderWhitespace: "selection" | "all";
  saveLineEnding: SaveLineEndingMode;
  sideBySide: boolean;
  wordWrap: "off" | "on";
  wrapAround: boolean;
}

export interface FolderViewSettings {
  statusFilters: FolderStatusFilters;
  sort: FolderSortState;
}

export interface MergeSettings {
  autoAdvanceConflict: boolean;
  recoveryDraftsEnabled: boolean;
  saveLineEnding: SaveLineEndingMode;
}

export type RecentSession = RecentCompareSession | RecentFolderSession | RecentMergeSession;
export type RecentSessionInput =
  | Omit<RecentCompareSession, "id" | "updatedAt">
  | Omit<RecentFolderSession, "id" | "updatedAt">
  | Omit<RecentMergeSession, "id" | "updatedAt">;
export type ActiveSession = RecentSessionInput;

interface RecentSessionBase {
  id: string;
  updatedAt: number;
}

export interface RecentCompareSession extends RecentSessionBase {
  kind: "compare";
  leftPath: string;
  rightPath: string;
}

export interface RecentFolderSession extends RecentSessionBase {
  kind: "folders";
  leftRoot: string;
  rightRoot: string;
  options: FolderScanOptions;
}

export interface RecentMergeSession extends RecentSessionBase {
  kind: "merge";
  basePath: string;
  oursPath: string;
  theirsPath: string;
  outputPath: string | null;
}

interface SettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const DEFAULT_FOLDER_VIEW_SETTINGS: FolderViewSettings = {
  statusFilters: DEFAULT_FOLDER_STATUS_FILTERS,
  sort: DEFAULT_FOLDER_SORT,
};

export const DEFAULT_FOLDER_SCAN_OPTIONS: FolderScanOptions = {
  compareMode: "quickHash",
  includeHidden: false,
  respectGitignore: false,
  followSymlinks: false,
};

export const DEFAULT_COMPARE_VIEW_SETTINGS: CompareViewSettings = {
  diffOptions: DEFAULT_TEXT_DIFF_OPTIONS,
  renderWhitespace: "selection",
  saveLineEnding: "original",
  sideBySide: true,
  wordWrap: "off",
  wrapAround: true,
};

export const DEFAULT_MERGE_SETTINGS: MergeSettings = {
  autoAdvanceConflict: true,
  recoveryDraftsEnabled: false,
  saveLineEnding: "original",
};

export const DEFAULT_APPEARANCE_SETTINGS: AppearanceSettings = {
  theme: "system",
};

export function loadAppearanceSettings(storage = browserStorage()): AppearanceSettings {
  if (!storage) return DEFAULT_APPEARANCE_SETTINGS;

  try {
    const raw = storage.getItem(APPEARANCE_SETTINGS_KEY);
    if (!raw) return DEFAULT_APPEARANCE_SETTINGS;
    return sanitizeAppearanceSettings(JSON.parse(raw));
  } catch {
    return DEFAULT_APPEARANCE_SETTINGS;
  }
}

export function saveAppearanceSettings(
  settings: AppearanceSettings,
  storage = browserStorage(),
): void {
  if (!storage) return;

  storage.setItem(APPEARANCE_SETTINGS_KEY, JSON.stringify(sanitizeAppearanceSettings(settings)));
}

export function loadCompareViewSettings(storage = browserStorage()): CompareViewSettings {
  if (!storage) return DEFAULT_COMPARE_VIEW_SETTINGS;

  try {
    const raw = storage.getItem(COMPARE_VIEW_SETTINGS_KEY);
    if (!raw) return DEFAULT_COMPARE_VIEW_SETTINGS;
    return sanitizeCompareViewSettings(JSON.parse(raw));
  } catch {
    return DEFAULT_COMPARE_VIEW_SETTINGS;
  }
}

export function saveCompareViewSettings(
  settings: CompareViewSettings,
  storage = browserStorage(),
): void {
  if (!storage) return;

  storage.setItem(COMPARE_VIEW_SETTINGS_KEY, JSON.stringify(sanitizeCompareViewSettings(settings)));
}

export function loadFolderScanOptions(storage = browserStorage()): FolderScanOptions {
  if (!storage) return DEFAULT_FOLDER_SCAN_OPTIONS;

  try {
    const raw = storage.getItem(FOLDER_SCAN_OPTIONS_KEY);
    if (!raw) return DEFAULT_FOLDER_SCAN_OPTIONS;
    return sanitizeFolderOptions(JSON.parse(raw));
  } catch {
    return DEFAULT_FOLDER_SCAN_OPTIONS;
  }
}

export function saveFolderScanOptions(
  options: FolderScanOptions,
  storage = browserStorage(),
): void {
  if (!storage) return;

  storage.setItem(FOLDER_SCAN_OPTIONS_KEY, JSON.stringify(sanitizeFolderOptions(options)));
}

export function loadFolderViewSettings(storage = browserStorage()): FolderViewSettings {
  if (!storage) return DEFAULT_FOLDER_VIEW_SETTINGS;

  try {
    const raw = storage.getItem(FOLDER_VIEW_SETTINGS_KEY);
    if (!raw) return DEFAULT_FOLDER_VIEW_SETTINGS;
    return sanitizeFolderViewSettings(JSON.parse(raw));
  } catch {
    return DEFAULT_FOLDER_VIEW_SETTINGS;
  }
}

export function saveFolderViewSettings(
  settings: FolderViewSettings,
  storage = browserStorage(),
): void {
  if (!storage) return;

  storage.setItem(FOLDER_VIEW_SETTINGS_KEY, JSON.stringify(sanitizeFolderViewSettings(settings)));
}

export function loadMergeSettings(storage = browserStorage()): MergeSettings {
  if (!storage) return DEFAULT_MERGE_SETTINGS;

  try {
    const raw = storage.getItem(MERGE_SETTINGS_KEY);
    if (!raw) return DEFAULT_MERGE_SETTINGS;
    return sanitizeMergeSettings(JSON.parse(raw));
  } catch {
    return DEFAULT_MERGE_SETTINGS;
  }
}

export function saveMergeSettings(settings: MergeSettings, storage = browserStorage()): void {
  if (!storage) return;

  storage.setItem(MERGE_SETTINGS_KEY, JSON.stringify(sanitizeMergeSettings(settings)));
}

export function loadRecentSessions(storage = browserStorage()): RecentSession[] {
  if (!storage) return [];

  try {
    const raw = storage.getItem(RECENT_SESSIONS_KEY);
    if (!raw) return [];
    return sanitizeRecentSessions(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function saveRecentSessions(
  sessions: RecentSession[],
  storage = browserStorage(),
): void {
  if (!storage) return;

  storage.setItem(RECENT_SESSIONS_KEY, JSON.stringify(sanitizeRecentSessions(sessions)));
}

export function upsertRecentSession(
  sessions: RecentSession[],
  input: RecentSessionInput,
  updatedAt = Date.now(),
): RecentSession[] {
  const next = createRecentSession(input, updatedAt);
  if (!next) return sanitizeRecentSessions(sessions);

  return sanitizeRecentSessions([
    next,
    ...sessions.filter((session) => session.id !== next.id),
  ]);
}

export function removeRecentSession(sessions: RecentSession[], id: string): RecentSession[] {
  return sanitizeRecentSessions(sessions).filter((session) => session.id !== id);
}

export function loadActiveSession(storage = browserStorage()): ActiveSession | null {
  if (!storage) return null;

  try {
    const raw = storage.getItem(ACTIVE_SESSION_KEY);
    if (!raw) return null;
    return sanitizeActiveSession(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function saveActiveSession(
  session: ActiveSession | null,
  storage = browserStorage(),
): void {
  if (!storage) return;

  storage.setItem(ACTIVE_SESSION_KEY, JSON.stringify(sanitizeActiveSession(session)));
}

export function sanitizeFolderViewSettings(value: unknown): FolderViewSettings {
  if (!isRecord(value)) return DEFAULT_FOLDER_VIEW_SETTINGS;

  return {
    statusFilters: sanitizeStatusFilters(value.statusFilters),
    sort: sanitizeSort(value.sort),
  };
}

export function sanitizeAppearanceSettings(value: unknown): AppearanceSettings {
  if (!isRecord(value)) return DEFAULT_APPEARANCE_SETTINGS;

  return {
    theme: THEME_MODES.includes(value.theme as ThemeMode)
      ? (value.theme as ThemeMode)
      : DEFAULT_APPEARANCE_SETTINGS.theme,
  };
}

export function sanitizeFolderScanOptions(value: unknown): FolderScanOptions {
  return sanitizeFolderOptions(value);
}

export function sanitizeCompareViewSettings(value: unknown): CompareViewSettings {
  if (!isRecord(value)) return DEFAULT_COMPARE_VIEW_SETTINGS;

  return {
    diffOptions: sanitizeTextDiffOptions(value.diffOptions),
    renderWhitespace: value.renderWhitespace === "all" ? "all" : "selection",
    saveLineEnding: SAVE_LINE_ENDING_MODES.includes(value.saveLineEnding as SaveLineEndingMode)
      ? (value.saveLineEnding as SaveLineEndingMode)
      : DEFAULT_COMPARE_VIEW_SETTINGS.saveLineEnding,
    sideBySide: typeof value.sideBySide === "boolean"
      ? value.sideBySide
      : DEFAULT_COMPARE_VIEW_SETTINGS.sideBySide,
    wordWrap: value.wordWrap === "on" ? "on" : "off",
    wrapAround: typeof value.wrapAround === "boolean"
      ? value.wrapAround
      : DEFAULT_COMPARE_VIEW_SETTINGS.wrapAround,
  };
}

export function sanitizeMergeSettings(value: unknown): MergeSettings {
  if (!isRecord(value)) return DEFAULT_MERGE_SETTINGS;

  return {
    autoAdvanceConflict: typeof value.autoAdvanceConflict === "boolean"
      ? value.autoAdvanceConflict
      : DEFAULT_MERGE_SETTINGS.autoAdvanceConflict,
    recoveryDraftsEnabled: typeof value.recoveryDraftsEnabled === "boolean"
      ? value.recoveryDraftsEnabled
      : DEFAULT_MERGE_SETTINGS.recoveryDraftsEnabled,
    saveLineEnding: SAVE_LINE_ENDING_MODES.includes(value.saveLineEnding as SaveLineEndingMode)
      ? (value.saveLineEnding as SaveLineEndingMode)
      : DEFAULT_MERGE_SETTINGS.saveLineEnding,
  };
}

export function sanitizeRecentSessions(value: unknown): RecentSession[] {
  if (!Array.isArray(value)) return [];

  const sessions = value
    .map(sanitizeRecentSession)
    .filter((session): session is RecentSession => session != null)
    .sort((left, right) => right.updatedAt - left.updatedAt);

  const seen = new Set<string>();
  const unique: RecentSession[] = [];
  for (const session of sessions) {
    if (seen.has(session.id)) continue;
    seen.add(session.id);
    unique.push(session);
    if (unique.length >= MAX_RECENT_SESSIONS) break;
  }
  return unique;
}

export function sanitizeActiveSession(value: unknown): ActiveSession | null {
  if (!isRecord(value)) return null;

  if (value.kind === "compare") {
    const leftPath = sanitizeNonEmptyString(value.leftPath);
    const rightPath = sanitizeNonEmptyString(value.rightPath);
    if (!leftPath || !rightPath) return null;
    return { kind: "compare", leftPath, rightPath };
  }

  if (value.kind === "folders") {
    const leftRoot = sanitizeNonEmptyString(value.leftRoot);
    const rightRoot = sanitizeNonEmptyString(value.rightRoot);
    if (!leftRoot || !rightRoot) return null;
    return {
      kind: "folders",
      leftRoot,
      rightRoot,
      options: sanitizeFolderOptions(value.options),
    };
  }

  if (value.kind === "merge") {
    const basePath = sanitizeNonEmptyString(value.basePath);
    const oursPath = sanitizeNonEmptyString(value.oursPath);
    const theirsPath = sanitizeNonEmptyString(value.theirsPath);
    if (!basePath || !oursPath || !theirsPath) return null;
    return {
      kind: "merge",
      basePath,
      oursPath,
      theirsPath,
      outputPath: sanitizeOptionalString(value.outputPath),
    };
  }

  return null;
}

function sanitizeStatusFilters(value: unknown): FolderStatusFilters {
  const source = isRecord(value) ? value : {};

  return Object.fromEntries(
    FOLDER_STATUSES.map((status) => [
      status,
      typeof source[status] === "boolean" ? source[status] : DEFAULT_FOLDER_STATUS_FILTERS[status],
    ]),
  ) as FolderStatusFilters;
}

function sanitizeSort(value: unknown): FolderSortState {
  if (!isRecord(value)) return DEFAULT_FOLDER_SORT;

  const key = SORT_KEYS.includes(value.key as FolderSortKey)
    ? (value.key as FolderSortKey)
    : DEFAULT_FOLDER_SORT.key;
  const direction = value.direction === "desc" ? "desc" : "asc";

  return { key, direction };
}

function sanitizeTextDiffOptions(value: unknown): TextDiffOptions {
  const source = isRecord(value) ? value : {};
  const whitespace = WHITESPACE_MODES.includes(source.whitespace as WhitespaceCompareMode)
    ? (source.whitespace as WhitespaceCompareMode)
    : DEFAULT_TEXT_DIFF_OPTIONS.whitespace;

  return {
    whitespace,
    ignoreCase: typeof source.ignoreCase === "boolean"
      ? source.ignoreCase
      : DEFAULT_TEXT_DIFF_OPTIONS.ignoreCase,
    ignoreLineEndings: typeof source.ignoreLineEndings === "boolean"
      ? source.ignoreLineEndings
      : DEFAULT_TEXT_DIFF_OPTIONS.ignoreLineEndings,
  };
}

function sanitizeRecentSession(value: unknown): RecentSession | null {
  if (!isRecord(value)) return null;

  const updatedAt = sanitizeTimestamp(value.updatedAt);
  if (value.kind === "compare") {
    const leftPath = sanitizeNonEmptyString(value.leftPath);
    const rightPath = sanitizeNonEmptyString(value.rightPath);
    if (!leftPath || !rightPath) return null;
    const input: RecentSessionInput = { kind: "compare", leftPath, rightPath };
    return { ...input, id: recentSessionId(input), updatedAt };
  }

  if (value.kind === "folders") {
    const leftRoot = sanitizeNonEmptyString(value.leftRoot);
    const rightRoot = sanitizeNonEmptyString(value.rightRoot);
    if (!leftRoot || !rightRoot) return null;
    const input: RecentSessionInput = {
      kind: "folders",
      leftRoot,
      rightRoot,
      options: sanitizeFolderOptions(value.options),
    };
    return { ...input, id: recentSessionId(input), updatedAt };
  }

  if (value.kind === "merge") {
    const basePath = sanitizeNonEmptyString(value.basePath);
    const oursPath = sanitizeNonEmptyString(value.oursPath);
    const theirsPath = sanitizeNonEmptyString(value.theirsPath);
    if (!basePath || !oursPath || !theirsPath) return null;
    const input: RecentSessionInput = {
      kind: "merge",
      basePath,
      oursPath,
      theirsPath,
      outputPath: sanitizeOptionalString(value.outputPath),
    };
    return { ...input, id: recentSessionId(input), updatedAt };
  }

  return null;
}

function createRecentSession(input: RecentSessionInput, updatedAt: number): RecentSession | null {
  return sanitizeRecentSession({
    ...input,
    id: recentSessionId(input),
    updatedAt,
  });
}

function recentSessionId(input: RecentSessionInput): string {
  if (input.kind === "compare") {
    return `compare:${input.leftPath}\n${input.rightPath}`;
  }
  if (input.kind === "folders") {
    const { compareMode, includeHidden, respectGitignore, followSymlinks } = input.options;
    return [
      "folders",
      input.leftRoot,
      input.rightRoot,
      compareMode,
      includeHidden ? "hidden" : "visible",
      respectGitignore ? "gitignore" : "all",
      followSymlinks ? "follow" : "nofollow",
    ].join("\n");
  }
  return `merge:${input.basePath}\n${input.oursPath}\n${input.theirsPath}\n${input.outputPath ?? ""}`;
}

function sanitizeFolderOptions(value: unknown): FolderScanOptions {
  const source = isRecord(value) ? value : {};
  const compareMode = FOLDER_COMPARE_MODES.includes(source.compareMode as FolderCompareMode)
    ? (source.compareMode as FolderCompareMode)
    : DEFAULT_FOLDER_SCAN_OPTIONS.compareMode;

  return {
    compareMode,
    includeHidden: typeof source.includeHidden === "boolean"
      ? source.includeHidden
      : DEFAULT_FOLDER_SCAN_OPTIONS.includeHidden,
    respectGitignore: typeof source.respectGitignore === "boolean"
      ? source.respectGitignore
      : DEFAULT_FOLDER_SCAN_OPTIONS.respectGitignore,
    followSymlinks: typeof source.followSymlinks === "boolean"
      ? source.followSymlinks
      : DEFAULT_FOLDER_SCAN_OPTIONS.followSymlinks,
  };
}

function sanitizeTimestamp(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.trunc(value)
    : 0;
}

function sanitizeNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function sanitizeOptionalString(value: unknown): string | null {
  if (value == null) return null;
  return sanitizeNonEmptyString(value);
}

function browserStorage(): SettingsStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value);
}
