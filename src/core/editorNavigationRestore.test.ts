import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EditorNavigationHistory,
  type NavigationLocation,
  type NavigationTarget,
} from "./editorNavigationHistory";
import {
  EditorNavigationRestoreCoordinator,
  type NavigationRestoreOpenResult,
} from "./editorNavigationRestore";

function folderTarget(item: string): NavigationTarget {
  return {
    scope: { kind: "folderReview", reviewToken: "review-1", scanGeneration: 4 },
    document: { kind: "folderText", relativeItemKey: item, comparisonKind: "both" },
  };
}

function location(target: NavigationTarget, lineNumber: number) {
  return {
    target,
    pane: "compareLeft" as const,
    cursor: { lineNumber, column: 2 },
    viewport: { topLineNumber: lineNumber, topLineOffsetPx: 3, scrollLeftPx: 4 },
  };
}

function historyWith(candidate: NavigationTarget, current: NavigationTarget) {
  const history = new EditorNavigationHistory();
  history.observe(location(candidate, 10));
  history.commitCurrent("openReviewItem");
  history.observe(location(current, 20));
  return history;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

describe("EditorNavigationRestoreCoordinator", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens, acknowledges the exact matching mount, restores, then consumes once", async () => {
    const first = folderTarget("first.txt");
    const second = folderTarget("second.txt");
    const history = historyWith(first, second);
    const restored: NavigationLocation[] = [];
    let coordinator!: EditorNavigationRestoreCoordinator;
    coordinator = new EditorNavigationRestoreCoordinator({
      history,
      resolve: (candidate) => candidate.target === first ? "reopen" : "stale",
      restoreMounted: () => "failed",
      open: async () => {
        queueMicrotask(() => {
          coordinator.acknowledgeMounted(first, "compareLeft", (candidate) => {
            restored.push(candidate);
            return "restored";
          });
        });
        return "opened";
      },
      cancelOpen: vi.fn(),
    });

    await expect(coordinator.navigateBack("keyboard", { blockingModal: false, nativeDialogOpen: false }))
      .resolves.toMatchObject({ kind: "restored", staleDiscarded: 0 });
    expect(restored).toHaveLength(1);
    expect(restored[0]?.cursor.lineNumber).toBe(10);
    expect(history.snapshot().past).toHaveLength(0);
    expect(history.snapshot().current?.target).toEqual(first);

    await expect(coordinator.navigateBack("keyboard", { blockingModal: false, nativeDialogOpen: false }))
      .resolves.toEqual({ kind: "empty", status: "empty" });
  });

  it("blocks dirty cross-document restore without changing current or candidate", async () => {
    const first = folderTarget("first.txt");
    const second = folderTarget("second.txt");
    const history = historyWith(first, second);
    const coordinator = new EditorNavigationRestoreCoordinator({
      history,
      resolve: () => "blockedDirty",
      restoreMounted: vi.fn(() => "failed" as const),
      open: vi.fn(async () => "opened" as const),
      cancelOpen: vi.fn(),
    });

    await expect(coordinator.navigateBack("mouse", { blockingModal: false, nativeDialogOpen: false }))
      .resolves.toEqual({ kind: "blockedDirty", status: "blockedDirty" });
    expect(history.snapshot().past).toHaveLength(1);
    expect(history.snapshot().current?.target).toEqual(second);
  });

  it("discards consecutive stale candidates and restores only the first valid one", async () => {
    const valid = folderTarget("valid.txt");
    const staleOne = folderTarget("deleted.txt");
    const staleTwo = folderTarget("collision.txt");
    const current = folderTarget("current.txt");
    const history = new EditorNavigationHistory();
    history.observe(location(valid, 5));
    history.commitCurrent("openReviewItem");
    history.observe(location(staleOne, 10));
    history.commitCurrent("openReviewItem");
    history.observe(location(staleTwo, 15));
    history.commitCurrent("openReviewItem");
    history.observe(location(current, 20));
    const restoreMounted = vi.fn(() => "restored" as const);
    const coordinator = new EditorNavigationRestoreCoordinator({
      history,
      resolve: (candidate) => candidate.target === valid ? "mounted" : "stale",
      restoreMounted,
      open: vi.fn(async () => "failed" as const),
      cancelOpen: vi.fn(),
    });

    await expect(coordinator.navigateBack("nativeMenu", {
      blockingModal: false,
      nativeDialogOpen: false,
    })).resolves.toMatchObject({ kind: "restored", staleDiscarded: 2 });
    expect(restoreMounted).toHaveBeenCalledTimes(1);
    expect(history.snapshot().past).toHaveLength(0);
  });

  it("releases without consumption on cancellation, newer request, and I/O failure", async () => {
    const first = folderTarget("first.txt");
    const second = folderTarget("second.txt");
    const pendingOpen = deferred<NavigationRestoreOpenResult>();
    const cancelOpen = vi.fn();
    const history = historyWith(first, second);
    const coordinator = new EditorNavigationRestoreCoordinator({
      history,
      resolve: () => "reopen",
      restoreMounted: () => "failed",
      open: () => pendingOpen.promise,
      cancelOpen,
    });

    const pending = coordinator.navigateBack("keyboard", {
      blockingModal: false,
      nativeDialogOpen: false,
    });
    await expect(coordinator.navigateBack("mouse", {
      blockingModal: false,
      nativeDialogOpen: false,
    })).resolves.toEqual({ kind: "inFlight", status: "inFlight" });
    expect(coordinator.cancel()).toBe(true);
    await expect(pending).resolves.toEqual({ kind: "cancelled", status: "cancelled" });
    expect(cancelOpen).toHaveBeenCalledTimes(1);
    expect(history.snapshot().past).toHaveLength(1);

    const failed = new EditorNavigationRestoreCoordinator({
      history,
      resolve: () => "reopen",
      restoreMounted: () => "failed",
      open: async () => "failed",
      cancelOpen: vi.fn(),
    });
    await expect(failed.navigateBack("keyboard", {
      blockingModal: false,
      nativeDialogOpen: false,
    })).resolves.toEqual({ kind: "failed", status: "failed" });
    expect(history.snapshot().past).toHaveLength(1);
  });

  it("shows restoring status only after 100ms and ignores a mismatched mount", async () => {
    vi.useFakeTimers();
    const first = folderTarget("first.txt");
    const second = folderTarget("second.txt");
    const history = historyWith(first, second);
    const progress: boolean[] = [];
    const opened = deferred<NavigationRestoreOpenResult>();
    const coordinator = new EditorNavigationRestoreCoordinator({
      history,
      resolve: () => "reopen",
      restoreMounted: () => "failed",
      open: () => opened.promise,
      cancelOpen: vi.fn(),
      onProgress: (active) => { progress.push(active); },
    });
    const pending = coordinator.navigateBack("keyboard", {
      blockingModal: false,
      nativeDialogOpen: false,
    });

    await vi.advanceTimersByTimeAsync(99);
    expect(progress).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(progress).toEqual([true]);
    expect(coordinator.acknowledgeMounted(second, "compareLeft", () => "restored")).toBe(false);

    opened.resolve("opened");
    await Promise.resolve();
    expect(coordinator.acknowledgeMounted(first, "compareLeft", () => "restored")).toBe(true);
    await expect(pending).resolves.toMatchObject({ kind: "restored" });
    expect(progress).toEqual([true, false]);
  });
});
