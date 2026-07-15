import type { GitChangedFile, GitObjectId } from "./gitModels";
import { gitChangedFileKey } from "./gitSession";

export interface GitReviewScope {
  repositoryId: string;
  left: GitObjectId;
  right: GitObjectId;
  generation: number;
}

export interface GitReviewState {
  scopeKey: string;
  viewedKeys: ReadonlySet<string>;
}

export interface GitReviewProgress {
  total: number;
  viewed: number;
  remaining: number;
}

export function gitReviewScopeKey(scope: GitReviewScope): string {
  return [
    scope.repositoryId,
    `${scope.left.algorithm}:${scope.left.hex}`,
    `${scope.right.algorithm}:${scope.right.hex}`,
    String(scope.generation),
  ].join("\u001f");
}

export function createGitReviewState(scopeKey: string): GitReviewState {
  return { scopeKey, viewedKeys: new Set() };
}

export function scopeGitReviewState(
  state: GitReviewState,
  scopeKey: string,
): GitReviewState {
  return state.scopeKey === scopeKey ? state : createGitReviewState(scopeKey);
}

export function markGitReviewViewed(
  state: GitReviewState,
  entryKey: string,
): GitReviewState {
  if (state.viewedKeys.has(entryKey)) return state;
  const viewedKeys = new Set(state.viewedKeys);
  viewedKeys.add(entryKey);
  return { ...state, viewedKeys };
}

export function gitReviewProgress(
  entries: GitChangedFile[],
  state: GitReviewState,
): GitReviewProgress {
  let viewed = 0;
  for (const entry of entries) {
    if (state.viewedKeys.has(gitChangedFileKey(entry))) viewed += 1;
  }
  return { total: entries.length, viewed, remaining: entries.length - viewed };
}

export function nextGitReviewEntryKey(
  entries: GitChangedFile[],
  selectedKey: string | null,
  direction: "previous" | "next",
): string | null {
  if (entries.length === 0) return null;
  const current = selectedKey === null
    ? -1
    : entries.findIndex((entry) => gitChangedFileKey(entry) === selectedKey);
  const delta = direction === "next" ? 1 : -1;
  const start = current < 0 ? (direction === "next" ? -1 : 0) : current;
  const index = (start + delta + entries.length) % entries.length;
  return gitChangedFileKey(entries[index]!);
}

export function nextUnviewedGitReviewEntryKey(
  entries: GitChangedFile[],
  state: GitReviewState,
  selectedKey: string | null,
): string | null {
  if (entries.length === 0) return null;
  const current = selectedKey === null
    ? -1
    : entries.findIndex((entry) => gitChangedFileKey(entry) === selectedKey);
  const start = current < 0 ? -1 : current;
  for (let offset = 1; offset <= entries.length; offset += 1) {
    const candidate = entries[(start + offset) % entries.length]!;
    const key = gitChangedFileKey(candidate);
    if (!state.viewedKeys.has(key)) return key;
  }
  return null;
}
