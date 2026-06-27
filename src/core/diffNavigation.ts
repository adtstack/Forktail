import { matchesCommandShortcut, type KeyboardShortcutLike } from "./commands";

export type DiffDirection = "next" | "previous";

export interface DiffNavigationState {
  currentIndex: number;
  total: number;
  canMove: boolean;
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

export function isSwapSidesShortcut(event: KeyboardShortcutLike): boolean {
  return matchesCommandShortcut("swapSides", event);
}
