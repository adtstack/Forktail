import { describe, expect, it } from "vitest";
import {
  CARET_COLUMN_PROXIMITY,
  CARET_LINE_PROXIMITY,
  EditorNavigationHistory,
  NAVIGATION_HISTORY_CAPACITY,
  VIEWPORT_LINE_PROXIMITY,
  VIEWPORT_PIXEL_PROXIMITY,
  isNavigationTargetStructurallyValid,
  type NavigationLocationInput,
} from "./editorNavigationHistory";

function location(
  lineNumber: number,
  pane: NavigationLocationInput["pane"] = "compareLeft",
  sessionToken = "compare-session",
  column = 1,
): NavigationLocationInput {
  return {
    target: {
      scope: { kind: "directCompare", sessionToken, modelRevision: 1 },
      document: { kind: "mountedCompare", modelKey: "compare-model", modelRevision: 1 },
    },
    pane,
    cursor: { lineNumber, column },
    viewport: {
      topLineNumber: lineNumber,
      topLineOffsetPx: 0,
      scrollLeftPx: 0,
    },
  };
}

describe("EditorNavigationHistory", () => {
  it("restores A → B → C visits as B → A without duplicate consumption", () => {
    const history = new EditorNavigationHistory();
    history.observe(location(10));
    history.commitCurrent("explicitCursorJump");
    history.observe(location(40));
    history.commitCurrent("nextDiff");
    history.observe(location(90));

    const first = history.reserveNewestValid("programmaticTest", () => "valid");
    expect(first.kind).toBe("reserved");
    expect(first.kind === "reserved" && first.location.cursor.lineNumber).toBe(40);
    expect(first.kind === "reserved" && history.commitReservation(first.reservation.invocationId)?.cursor.lineNumber)
      .toBe(40);

    const second = history.reserveNewestValid("programmaticTest", () => "valid");
    expect(second.kind === "reserved" && second.location.cursor.lineNumber).toBe(10);
    expect(second.kind === "reserved" && history.commitReservation(second.reservation.invocationId)?.cursor.lineNumber)
      .toBe(10);
    expect(history.reserveNewestValid("programmaticTest", () => "valid")).toEqual({
      kind: "empty",
      staleDiscarded: 0,
    });
  });

  it("keeps current separate from 100 previous locations and restores all 100 in order", () => {
    const history = new EditorNavigationHistory();
    history.observe(location(3));
    for (let visit = 2; visit <= 101; visit += 1) {
      history.commitCurrent("explicitCursorJump");
      history.observe(location(visit * 3));
    }

    expect(NAVIGATION_HISTORY_CAPACITY).toBe(100);
    expect(history.snapshot().past).toHaveLength(100);
    expect(history.snapshot().current?.cursor.lineNumber).toBe(303);

    const restored: number[] = [];
    for (let index = 0; index < 100; index += 1) {
      const candidate = history.reserveNewestValid("programmaticTest", () => "valid");
      expect(candidate.kind).toBe("reserved");
      if (candidate.kind !== "reserved") break;
      restored.push(candidate.location.cursor.lineNumber);
      history.commitReservation(candidate.reservation.invocationId);
    }
    expect(restored).toEqual(Array.from({ length: 100 }, (_, index) => (100 - index) * 3));
  });

  it("coalesces only within the published caret and viewport boundaries", () => {
    expect({
      CARET_LINE_PROXIMITY,
      CARET_COLUMN_PROXIMITY,
      VIEWPORT_LINE_PROXIMITY,
      VIEWPORT_PIXEL_PROXIMITY,
    }).toEqual({
      CARET_LINE_PROXIMITY: 1,
      CARET_COLUMN_PROXIMITY: 1,
      VIEWPORT_LINE_PROXIMITY: 1,
      VIEWPORT_PIXEL_PROXIMITY: 2,
    });

    const history = new EditorNavigationHistory();
    history.observe(location(10));
    history.commitCurrent("paneFocus");
    history.observe({
      ...location(11, "compareLeft", "compare-session", 2),
      viewport: { topLineNumber: 11, topLineOffsetPx: 2, scrollLeftPx: 2 },
    });
    history.commitCurrent("explicitCursorJump");
    expect(history.snapshot().past).toHaveLength(1);
    expect(history.snapshot().past[0]?.cursor).toEqual({ lineNumber: 11, column: 2 });

    history.observe(location(13, "compareLeft", "compare-session", 2));
    history.commitCurrent("explicitCursorJump");
    expect(history.snapshot().past).toHaveLength(2);
  });

  it("never coalesces different panes or targets", () => {
    const history = new EditorNavigationHistory();
    history.observe(location(10));
    history.commitCurrent("paneFocus");
    history.observe(location(10, "compareRight"));
    history.commitCurrent("paneFocus");
    history.observe(location(10, "compareRight", "other-session"));
    history.commitCurrent("paneFocus");

    expect(history.snapshot().past).toHaveLength(3);
  });

  it("suppresses replay observations and protects a reserved candidate", () => {
    const history = new EditorNavigationHistory();
    history.observe(location(10));
    history.commitCurrent("nextDiff");
    history.observe(location(50));

    const reserved = history.reserveNewestValid("keyboard", () => "valid");
    expect(reserved.kind).toBe("reserved");
    expect(history.reserveNewestValid("mouse", () => "valid")).toEqual({ kind: "inFlight" });

    history.withReplay(() => {
      history.observe(location(10));
      history.commitCurrent("explicitCursorJump");
    });
    expect(history.snapshot().past).toHaveLength(1);

    if (reserved.kind === "reserved") history.releaseReservation(reserved.reservation.invocationId);
    expect(history.snapshot().past).toHaveLength(1);
  });

  it("discards 50 stale entries and consumes at most one valid location", () => {
    const history = new EditorNavigationHistory();
    history.observe(location(1, "compareLeft", "valid-session"));
    history.commitCurrent("openReviewItem");
    for (let index = 0; index < 50; index += 1) {
      history.observe(location(index + 2, "compareLeft", `stale-${index}`));
      history.commitCurrent("openReviewItem");
    }
    history.observe(location(100, "compareRight", "current-session"));

    const result = history.reserveNewestValid(
      "programmaticTest",
      (candidate) => candidate.target.scope.kind === "directCompare" &&
        candidate.target.scope.sessionToken === "valid-session" ? "valid" : "stale",
    );

    expect(result.kind).toBe("reserved");
    expect(result.kind === "reserved" && result.staleDiscarded).toBe(50);
    expect(result.kind === "reserved" && result.location.cursor.lineNumber).toBe(1);
    if (result.kind === "reserved") history.commitReservation(result.reservation.invocationId);
    expect(history.snapshot().past).toHaveLength(0);
  });

  it("leaves blocked, cancelled, and failed candidates untouched", () => {
    const history = new EditorNavigationHistory();
    history.observe(location(10));
    history.commitCurrent("nextDiff");
    history.observe(location(20));

    const blocked = history.reserveNewestValid("keyboard", () => "blocked");
    expect(blocked.kind).toBe("blocked");
    expect(history.snapshot().past).toHaveLength(1);

    const reserved = history.reserveNewestValid("keyboard", () => "valid");
    expect(reserved.kind).toBe("reserved");
    if (reserved.kind === "reserved") history.releaseReservation(reserved.reservation.invocationId);
    expect(history.snapshot().past).toHaveLength(1);
  });

  it("rejects mismatched scope/document revisions and exposes content-free fields only", () => {
    const input = location(3);
    expect(isNavigationTargetStructurallyValid(input.target)).toBe(true);
    expect(isNavigationTargetStructurallyValid({
      scope: { kind: "directCompare", sessionToken: "compare-session", modelRevision: 2 },
      document: { kind: "mountedCompare", modelKey: "compare-model", modelRevision: 1 },
    })).toBe(false);

    const history = new EditorNavigationHistory();
    const captured = history.observe(input);
    expect(Object.keys(captured).sort()).toEqual([
      "cursor",
      "pane",
      "sequence",
      "target",
      "viewport",
    ]);
    expect(JSON.stringify(captured)).not.toContain("sentinel-file-content");
  });
});
