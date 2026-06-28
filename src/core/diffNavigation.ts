import { matchesCommandShortcut, type KeyboardShortcutLike } from "./commands";

export type DiffDirection = "next" | "previous";

export interface DiffNavigationState {
  currentIndex: number;
  total: number;
  canMove: boolean;
}

export interface DiffLineChangeLike {
  originalStartLineNumber: number;
  originalEndLineNumber: number;
  modifiedStartLineNumber: number;
  modifiedEndLineNumber: number;
}

export interface DiffHunkLineRange {
  startLineNumber: number;
  endLineNumber: number;
}

export interface ActiveDiffHunkRanges {
  original: DiffHunkLineRange | null;
  modified: DiffHunkLineRange | null;
}

export function nextDiffIndex(
  currentIndex: number,
  total: number,
  direction: DiffDirection,
  wrapAround: boolean,
): number {
  if (total <= 0) return 0;

  const delta = direction === "next" ? 1 : -1;
  const candidate = currentIndex + delta;

  if (candidate >= 0 && candidate < total) return candidate;
  if (!wrapAround) return currentIndex;
  return direction === "next" ? 0 : total - 1;
}

export function diffNavigationState(currentIndex: number, total: number): DiffNavigationState {
  return {
    currentIndex: total > 0 ? Math.min(currentIndex, total - 1) : 0,
    total,
    canMove: total > 0,
  };
}

export function activeDiffHunkDecorationRanges(
  change: DiffLineChangeLike | null | undefined,
): ActiveDiffHunkRanges {
  if (!change) return { original: null, modified: null };

  return {
    original: lineRange(change.originalStartLineNumber, change.originalEndLineNumber),
    modified: lineRange(change.modifiedStartLineNumber, change.modifiedEndLineNumber),
  };
}

export function isSwapSidesShortcut(event: KeyboardShortcutLike): boolean {
  return matchesCommandShortcut("swapSides", event);
}

function lineRange(startLineNumber: number, endLineNumber: number): DiffHunkLineRange | null {
  if (startLineNumber <= 0 && endLineNumber <= 0) return null;

  const anchor = Math.max(1, startLineNumber, endLineNumber);
  if (endLineNumber < startLineNumber) {
    return {
      startLineNumber: Math.max(1, startLineNumber),
      endLineNumber: Math.max(1, startLineNumber),
    };
  }

  return {
    startLineNumber: Math.max(1, startLineNumber || anchor),
    endLineNumber: Math.max(1, endLineNumber || anchor),
  };
}
