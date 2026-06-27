import { describe, expect, it, vi } from "vitest";
import {
  canLeaveUnsavedMerge,
  hasUnsavedCompareChanges,
  hasUnsavedMergeChanges,
  markBeforeUnloadIfUnsaved,
  unsavedCompareNavigationMessage,
  unsavedMergeNavigationMessage,
} from "./unsaved";

describe("hasUnsavedCompareChanges", () => {
  it("requires a saved side snapshot before reporting dirty state", () => {
    expect(hasUnsavedCompareChanges("changed", null)).toBe(false);
  });

  it("compares the current side text to the saved side snapshot", () => {
    expect(hasUnsavedCompareChanges("same", "same")).toBe(false);
    expect(hasUnsavedCompareChanges("changed", "same")).toBe(true);
  });

  it("keeps a compare-specific navigation message", () => {
    expect(unsavedCompareNavigationMessage).toContain("비교 파일");
  });
});

describe("hasUnsavedMergeChanges", () => {
  it("requires a saved snapshot before reporting dirty state", () => {
    expect(hasUnsavedMergeChanges("changed", null)).toBe(false);
  });

  it("compares the current result to the saved snapshot", () => {
    expect(hasUnsavedMergeChanges("same", "same")).toBe(false);
    expect(hasUnsavedMergeChanges("changed", "same")).toBe(true);
  });
});

describe("canLeaveUnsavedMerge", () => {
  it("does not confirm when there are no unsaved changes", () => {
    const confirm = vi.fn(() => false);

    expect(canLeaveUnsavedMerge("same", "same", confirm)).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("uses the confirmation result when there are unsaved changes", () => {
    const confirmCancel = vi.fn(() => false);
    const confirmLeave = vi.fn(() => true);

    expect(canLeaveUnsavedMerge("changed", "same", confirmCancel)).toBe(false);
    expect(canLeaveUnsavedMerge("changed", "same", confirmLeave)).toBe(true);
    expect(confirmCancel).toHaveBeenCalledWith(unsavedMergeNavigationMessage);
    expect(confirmLeave).toHaveBeenCalledWith(unsavedMergeNavigationMessage);
  });
});

describe("markBeforeUnloadIfUnsaved", () => {
  it("does not touch clean beforeunload events", () => {
    const event = {
      preventDefault: vi.fn(),
      returnValue: "keep",
    };

    expect(markBeforeUnloadIfUnsaved(event, null)).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.returnValue).toBe("keep");
  });

  it("marks compare and merge dirty states as browser-close blockers", () => {
    for (const message of [unsavedCompareNavigationMessage, unsavedMergeNavigationMessage]) {
      const event = {
        preventDefault: vi.fn(),
        returnValue: "keep",
      };

      expect(markBeforeUnloadIfUnsaved(event, message)).toBe(true);
      expect(event.preventDefault).toHaveBeenCalledTimes(1);
      expect(event.returnValue).toBe("");
    }
  });
});
