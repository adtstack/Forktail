import { describe, expect, it } from "vitest";
import {
  activeDiffHunkDecorationRanges,
  diffNavigationState,
  isSwapSidesShortcut,
  nextDiffIndex,
} from "./diffNavigation";

describe("nextDiffIndex", () => {
  it("moves to the next or previous hunk", () => {
    expect(nextDiffIndex(0, 3, "next", true)).toBe(1);
    expect(nextDiffIndex(2, 3, "previous", true)).toBe(1);
  });

  it("wraps when enabled", () => {
    expect(nextDiffIndex(2, 3, "next", true)).toBe(0);
    expect(nextDiffIndex(0, 3, "previous", true)).toBe(2);
  });

  it("stays at boundaries when wrapping is disabled", () => {
    expect(nextDiffIndex(2, 3, "next", false)).toBe(2);
    expect(nextDiffIndex(0, 3, "previous", false)).toBe(0);
  });

  it("handles empty diff lists", () => {
    expect(nextDiffIndex(0, 0, "next", true)).toBe(0);
  });
});

describe("diffNavigationState", () => {
  it("clamps the current hunk to the available range", () => {
    expect(diffNavigationState(10, 3)).toEqual({
      currentIndex: 2,
      total: 3,
      canMove: true,
    });
  });

  it("reports no movement when there are no hunks", () => {
    expect(diffNavigationState(2, 0)).toEqual({
      currentIndex: 0,
      total: 0,
      canMove: false,
    });
  });
});

describe("activeDiffHunkDecorationRanges", () => {
  it("maps a changed hunk to original and modified whole-line ranges", () => {
    expect(
      activeDiffHunkDecorationRanges({
        originalStartLineNumber: 10,
        originalEndLineNumber: 12,
        modifiedStartLineNumber: 10,
        modifiedEndLineNumber: 13,
      }),
    ).toEqual({
      original: { startLineNumber: 10, endLineNumber: 12 },
      modified: { startLineNumber: 10, endLineNumber: 13 },
    });
  });

  it("anchors insertion and deletion sides that Monaco reports as empty ranges", () => {
    expect(
      activeDiffHunkDecorationRanges({
        originalStartLineNumber: 4,
        originalEndLineNumber: 3,
        modifiedStartLineNumber: 4,
        modifiedEndLineNumber: 5,
      }),
    ).toMatchObject({
      original: { startLineNumber: 4, endLineNumber: 4 },
      modified: { startLineNumber: 4, endLineNumber: 5 },
    });

    expect(
      activeDiffHunkDecorationRanges({
        originalStartLineNumber: 8,
        originalEndLineNumber: 9,
        modifiedStartLineNumber: 8,
        modifiedEndLineNumber: 7,
      }),
    ).toMatchObject({
      original: { startLineNumber: 8, endLineNumber: 9 },
      modified: { startLineNumber: 8, endLineNumber: 8 },
    });
  });

  it("returns empty decoration targets when no hunk is active", () => {
    expect(activeDiffHunkDecorationRanges(null)).toEqual({
      original: null,
      modified: null,
    });
  });
});

describe("isSwapSidesShortcut", () => {
  it("accepts the cross-platform command-shift-x shortcut", () => {
    expect(
      isSwapSidesShortcut({
        key: "x",
        ctrlKey: true,
        metaKey: false,
        shiftKey: true,
        altKey: false,
      }),
    ).toBe(true);
    expect(
      isSwapSidesShortcut({
        key: "X",
        ctrlKey: false,
        metaKey: true,
        shiftKey: true,
        altKey: false,
      }),
    ).toBe(true);
  });

  it("rejects navigation and option variants", () => {
    expect(
      isSwapSidesShortcut({
        key: "x",
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        altKey: false,
      }),
    ).toBe(false);
    expect(
      isSwapSidesShortcut({
        key: "x",
        ctrlKey: true,
        metaKey: false,
        shiftKey: true,
        altKey: true,
      }),
    ).toBe(false);
  });
});
