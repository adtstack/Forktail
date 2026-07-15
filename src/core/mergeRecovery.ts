import type { FileDocument, MergeSession } from "./models";

const MERGE_DRAFTS_KEY = "forktail.merge-drafts.v1";
export const MAX_MERGE_DRAFTS = 10;
export const MAX_MERGE_DRAFT_BYTES = 1024 * 1024;

interface SettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface MergeDraftVersion {
  size: number;
  modifiedMs: number | null;
}

interface MergeDraftIdentity {
  base: { path: string };
  ours: { path: string };
  theirs: { path: string };
  outputPath: string | null;
}

export interface MergeRecoveryDraft {
  id: string;
  basePath: string;
  oursPath: string;
  theirsPath: string;
  outputPath: string | null;
  result: string;
  updatedAt: number;
  versions: {
    base: MergeDraftVersion;
    ours: MergeDraftVersion;
    theirs: MergeDraftVersion;
  };
}

export function saveMergeRecoveryDraft(
  session: MergeSession,
  storage = browserStorage(),
  updatedAt = Date.now(),
): boolean {
  if (session.origin === "mergetool") return false;
  if (!storage) return false;
  if (utf8ByteLength(session.result) > MAX_MERGE_DRAFT_BYTES) {
    clearMergeRecoveryDraft(session, storage);
    return false;
  }

  const draft = mergeRecoveryDraftFromSession(session, updatedAt);
  const drafts = [
    draft,
    ...readMergeRecoveryDrafts(storage).filter((current) => current.id !== draft.id),
  ].slice(0, MAX_MERGE_DRAFTS);
  storage.setItem(MERGE_DRAFTS_KEY, JSON.stringify(drafts));
  return true;
}

export function loadMergeRecoveryDraft(
  session: MergeSession,
  storage = browserStorage(),
): MergeRecoveryDraft | null {
  if (session.origin === "mergetool") return null;
  if (!storage) return null;
  const id = mergeRecoveryDraftId(session);
  const draft = readMergeRecoveryDrafts(storage).find((current) => current.id === id);
  if (!draft) return null;
  if (!versionsMatch(draft.versions.base, session.base)) return null;
  if (!versionsMatch(draft.versions.ours, session.ours)) return null;
  if (!versionsMatch(draft.versions.theirs, session.theirs)) return null;
  if (draft.result === session.result) return null;
  return draft;
}

export function clearMergeRecoveryDraft(
  session: MergeSession,
  storage = browserStorage(),
): void {
  if (!storage) return;
  const id = mergeRecoveryDraftId(session);
  const drafts = readMergeRecoveryDrafts(storage).filter((draft) => draft.id !== id);
  storage.setItem(MERGE_DRAFTS_KEY, JSON.stringify(drafts));
}

export function sanitizeMergeRecoveryDrafts(value: unknown): MergeRecoveryDraft[] {
  if (!Array.isArray(value)) return [];

  const drafts = value
    .map(sanitizeMergeRecoveryDraft)
    .filter((draft): draft is MergeRecoveryDraft => draft != null)
    .sort((left, right) => right.updatedAt - left.updatedAt);

  const seen = new Set<string>();
  const unique: MergeRecoveryDraft[] = [];
  for (const draft of drafts) {
    if (seen.has(draft.id)) continue;
    seen.add(draft.id);
    unique.push(draft);
    if (unique.length >= MAX_MERGE_DRAFTS) break;
  }
  return unique;
}

export function mergeRecoveryDraftId(
  session: MergeDraftIdentity,
): string {
  return [
    "merge-draft",
    session.base.path,
    session.ours.path,
    session.theirs.path,
    session.outputPath ?? "",
  ].join("\n");
}

function mergeRecoveryDraftFromSession(
  session: MergeSession,
  updatedAt: number,
): MergeRecoveryDraft {
  return {
    id: mergeRecoveryDraftId(session),
    basePath: session.base.path,
    oursPath: session.ours.path,
    theirsPath: session.theirs.path,
    outputPath: session.outputPath,
    result: session.result,
    updatedAt,
    versions: {
      base: versionFromDocument(session.base),
      ours: versionFromDocument(session.ours),
      theirs: versionFromDocument(session.theirs),
    },
  };
}

function readMergeRecoveryDrafts(storage: SettingsStorage): MergeRecoveryDraft[] {
  try {
    const raw = storage.getItem(MERGE_DRAFTS_KEY);
    if (!raw) return [];
    return sanitizeMergeRecoveryDrafts(JSON.parse(raw));
  } catch {
    return [];
  }
}

function sanitizeMergeRecoveryDraft(value: unknown): MergeRecoveryDraft | null {
  if (!isRecord(value)) return null;
  const basePath = sanitizeNonEmptyString(value.basePath);
  const oursPath = sanitizeNonEmptyString(value.oursPath);
  const theirsPath = sanitizeNonEmptyString(value.theirsPath);
  const result = typeof value.result === "string" ? value.result : null;
  const updatedAt = sanitizeTimestamp(value.updatedAt);
  const versions = sanitizeVersions(value.versions);
  if (!basePath || !oursPath || !theirsPath || result == null || !versions) return null;
  if (utf8ByteLength(result) > MAX_MERGE_DRAFT_BYTES) return null;

  const outputPath = sanitizeOptionalString(value.outputPath);
  const draft = {
    base: { path: basePath },
    ours: { path: oursPath },
    theirs: { path: theirsPath },
    outputPath,
  };

  return {
    id: mergeRecoveryDraftId(draft),
    basePath,
    oursPath,
    theirsPath,
    outputPath,
    result,
    updatedAt,
    versions,
  };
}

function sanitizeVersions(value: unknown): MergeRecoveryDraft["versions"] | null {
  if (!isRecord(value)) return null;
  const base = sanitizeVersion(value.base);
  const ours = sanitizeVersion(value.ours);
  const theirs = sanitizeVersion(value.theirs);
  if (!base || !ours || !theirs) return null;
  return { base, ours, theirs };
}

function sanitizeVersion(value: unknown): MergeDraftVersion | null {
  if (!isRecord(value)) return null;
  if (typeof value.size !== "number" || !Number.isFinite(value.size) || value.size < 0) return null;
  return {
    size: Math.trunc(value.size),
    modifiedMs: sanitizeOptionalTimestamp(value.modifiedMs),
  };
}

function versionFromDocument(document: Pick<FileDocument, "size" | "modifiedMs">): MergeDraftVersion {
  return {
    size: document.size,
    modifiedMs: document.modifiedMs,
  };
}

function versionsMatch(version: MergeDraftVersion, document: Pick<FileDocument, "size" | "modifiedMs">): boolean {
  return version.size === document.size && version.modifiedMs === document.modifiedMs;
}

function sanitizeTimestamp(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.trunc(value)
    : 0;
}

function sanitizeOptionalTimestamp(value: unknown): number | null {
  if (value == null) return null;
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : null;
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

function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
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
