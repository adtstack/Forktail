import { describe, expect, it } from "vitest";
import {
  canRedoTextHistory,
  canUndoTextHistory,
  createTextHistory,
  pushTextHistory,
  redoTextHistory,
  undoTextHistory,
} from "./textHistory";

describe("text history", () => {
  it("starts without undo or redo entries", () => {
    const history = createTextHistory("base");

    expect(history).toEqual({ past: [], present: "base", future: [] });
    expect(canUndoTextHistory(history)).toBe(false);
    expect(canRedoTextHistory(history)).toBe(false);
  });

  it("undoes and redoes manual edits and command edits in order", () => {
    let history = createTextHistory("conflict markers");
    history = pushTextHistory(history, "manual edit");
    history = pushTextHistory(history, "resolved conflict");

    expect(canUndoTextHistory(history)).toBe(true);
    expect(history.present).toBe("resolved conflict");

    history = undoTextHistory(history);
    expect(history.present).toBe("manual edit");

    history = undoTextHistory(history);
    expect(history.present).toBe("conflict markers");

    history = redoTextHistory(history);
    expect(history.present).toBe("manual edit");

    history = redoTextHistory(history);
    expect(history.present).toBe("resolved conflict");
    expect(canRedoTextHistory(history)).toBe(false);
  });

  it("clears redo entries after a new edit", () => {
    let history = createTextHistory("a");
    history = pushTextHistory(history, "b");
    history = pushTextHistory(history, "c");
    history = undoTextHistory(history);
    history = pushTextHistory(history, "d");

    expect(history).toEqual({
      past: ["a", "b"],
      present: "d",
      future: [],
    });
  });

  it("does not add duplicate consecutive entries", () => {
    const history = pushTextHistory(createTextHistory("same"), "same");

    expect(history).toEqual(createTextHistory("same"));
  });

  it("honors the configured past limit", () => {
    let history = createTextHistory("0");
    history = pushTextHistory(history, "1", 2);
    history = pushTextHistory(history, "2", 2);
    history = pushTextHistory(history, "3", 2);

    expect(history.past).toEqual(["1", "2"]);
  });
});
