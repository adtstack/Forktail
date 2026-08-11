import { describe, expect, it, vi } from "vitest";
import { EditorNavigationHistory, type NavigationTarget } from "./editorNavigationHistory";
import {
  EditorNavigationCoordinator,
  type EditorNavigationCoordinatorContext,
} from "./editorNavigationCoordinator";
import type { EditorNavigationHandle, EditorViewSnapshot } from "./monacoNavigation";

const context: EditorNavigationCoordinatorContext = {
  blockingModal: false,
  nativeDialogOpen: false,
};

function target(revision = 1): NavigationTarget {
  return {
    scope: { kind: "directCompare", sessionToken: "compare-session", modelRevision: revision },
    document: { kind: "mountedCompare", modelKey: `model-${revision}`, modelRevision: revision },
  };
}

function snapshot(lineNumber: number): EditorViewSnapshot {
  return {
    pane: "compareLeft",
    cursor: { lineNumber, column: 1 },
    viewport: { topLineNumber: lineNumber, topLineOffsetPx: 0, scrollLeftPx: 0 },
  };
}

function handle(restoreResult: ReturnType<EditorNavigationHandle["restore"]> = { kind: "restored" }) {
  return {
    pane: "compareLeft" as const,
    modelKey: "model-1",
    modelRevision: 1,
    capture: vi.fn(() => snapshot(1)),
    restore: vi.fn(() => restoreResult),
    dispose: vi.fn(),
  } satisfies EditorNavigationHandle;
}

describe("EditorNavigationCoordinator", () => {
  it("restores one exact mounted target and reports timing within 100ms", () => {
    const times = [10, 45];
    const coordinator = new EditorNavigationCoordinator({
      history: new EditorNavigationHistory(),
      now: () => times.shift() ?? 45,
    });
    const mounted = handle();
    coordinator.register(mounted, target());
    coordinator.observe(mounted, target(), snapshot(10));
    coordinator.commitCurrent("nextDiff");
    coordinator.observe(mounted, target(), snapshot(50));

    expect(coordinator.navigateMountedBack("programmaticTest", context)).toEqual({
      kind: "restored",
      status: "restored",
      staleDiscarded: 0,
      durationMs: 35,
    });
    expect(mounted.restore).toHaveBeenCalledWith(snapshot(10));
    expect(coordinator.history.snapshot().current?.cursor.lineNumber).toBe(10);
  });

  it("blocks modal ownership without consuming history", () => {
    const coordinator = new EditorNavigationCoordinator();
    const mounted = handle();
    coordinator.register(mounted, target());
    coordinator.observe(mounted, target(), snapshot(10));
    coordinator.commitCurrent("nextDiff");
    coordinator.observe(mounted, target(), snapshot(50));

    expect(coordinator.navigateMountedBack("keyboard", {
      ...context,
      blockingModal: true,
    })).toEqual({ kind: "blockedModal", status: "blockedModal" });
    expect(coordinator.history.snapshot().past).toHaveLength(1);
  });

  it("discards stale revisions but preserves failed restore candidates", () => {
    const staleCoordinator = new EditorNavigationCoordinator();
    const oldHandle = handle();
    const unregister = staleCoordinator.register(oldHandle, target(1));
    staleCoordinator.observe(oldHandle, target(1), snapshot(10));
    staleCoordinator.commitCurrent("nextDiff");
    staleCoordinator.observe(oldHandle, target(1), snapshot(50));
    unregister();
    staleCoordinator.register({ ...handle(), modelKey: "model-2", modelRevision: 2 }, target(2));

    expect(staleCoordinator.navigateMountedBack("keyboard", context)).toEqual({
      kind: "allStale",
      status: "allStale",
      staleDiscarded: 1,
    });

    const failedCoordinator = new EditorNavigationCoordinator();
    const failedHandle = handle({ kind: "unavailable" });
    failedCoordinator.register(failedHandle, target());
    failedCoordinator.observe(failedHandle, target(), snapshot(10));
    failedCoordinator.commitCurrent("nextDiff");
    failedCoordinator.observe(failedHandle, target(), snapshot(50));
    expect(failedCoordinator.navigateMountedBack("keyboard", context).kind).toBe("failed");
    expect(failedCoordinator.history.snapshot().past).toHaveLength(1);
  });

  it("derives availability without pruning stale history", () => {
    const coordinator = new EditorNavigationCoordinator();
    const mounted = handle();
    const unregister = coordinator.register(mounted, target());
    coordinator.observe(mounted, target(), snapshot(10));
    coordinator.commitCurrent("nextDiff");
    coordinator.observe(mounted, target(), snapshot(50));
    unregister();

    expect(coordinator.availability(context)).toBe(false);
    expect(coordinator.history.snapshot().past).toHaveLength(1);
  });

  it("exposes non-consuming exact mounted lookup and restore for async orchestration", () => {
    const coordinator = new EditorNavigationCoordinator();
    const mounted = handle();
    coordinator.register(mounted, target());
    const candidate = { ...snapshot(12), target: target() };

    expect(coordinator.hasMountedLocation(candidate)).toBe(true);
    expect(coordinator.restoreLocation(candidate)).toBe("restored");
    expect(mounted.restore).toHaveBeenCalledWith(snapshot(12));
    expect(coordinator.history.snapshot().past).toHaveLength(0);
  });
});
