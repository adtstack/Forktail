import { describe, expect, it } from "vitest";
import {
  commandAriaKeyshortcuts,
  commandShortcutCollisions,
  isAppCommandId,
  matchesCommandShortcut,
  type KeyboardShortcutLike,
} from "./commands";

function key(
  value: string,
  modifiers: Partial<Omit<KeyboardShortcutLike, "key">> = {},
): KeyboardShortcutLike {
  return {
    key: value,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...modifiers,
  };
}

describe("command registry", () => {
  it("exposes aria-keyshortcuts from the same shortcut definitions", () => {
    expect(commandAriaKeyshortcuts("openCompare")).toBe("Control+O Meta+O");
    expect(commandAriaKeyshortcuts("saveAs")).toBe("Control+Shift+S Meta+Shift+S");
    expect(commandAriaKeyshortcuts("redo")).toBe(
      "Control+Y Meta+Y Control+Shift+Z Meta+Shift+Z",
    );
  });

  it("matches open commands with exact modifier combinations", () => {
    expect(matchesCommandShortcut("openCompare", key("o", { ctrlKey: true }))).toBe(true);
    expect(matchesCommandShortcut("openCompare", key("o", { metaKey: true }))).toBe(true);
    expect(matchesCommandShortcut("openCompare", key("o", { ctrlKey: true, shiftKey: true }))).toBe(
      false,
    );
    expect(matchesCommandShortcut("openFolders", key("o", { ctrlKey: true, shiftKey: true }))).toBe(
      true,
    );
    expect(matchesCommandShortcut("openMerge", key("o", { metaKey: true, altKey: true }))).toBe(
      true,
    );
  });

  it("keeps save and save-as distinct", () => {
    expect(matchesCommandShortcut("save", key("s", { ctrlKey: true }))).toBe(true);
    expect(matchesCommandShortcut("save", key("s", { ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(matchesCommandShortcut("saveAs", key("s", { ctrlKey: true, shiftKey: true }))).toBe(
      true,
    );
  });

  it("matches navigation and resolution shortcuts", () => {
    expect(matchesCommandShortcut("nextDiff", key("F7"))).toBe(true);
    expect(matchesCommandShortcut("previousDiff", key("F7", { shiftKey: true }))).toBe(true);
    expect(matchesCommandShortcut("nextConflict", key("F8"))).toBe(true);
    expect(matchesCommandShortcut("previousConflict", key("F8", { shiftKey: true }))).toBe(true);
    expect(matchesCommandShortcut("acceptOurs", key("1", { altKey: true }))).toBe(true);
    expect(matchesCommandShortcut("acceptBase", key("2", { altKey: true }))).toBe(true);
    expect(matchesCommandShortcut("acceptTheirs", key("3", { altKey: true }))).toBe(true);
    expect(matchesCommandShortcut("acceptBoth", key("4", { altKey: true }))).toBe(true);
  });

  it("rejects shortcut variants with extra modifiers", () => {
    expect(matchesCommandShortcut("swapSides", key("x", { ctrlKey: true, shiftKey: true }))).toBe(
      true,
    );
    expect(
      matchesCommandShortcut("swapSides", key("x", { ctrlKey: true, shiftKey: true, altKey: true })),
    ).toBe(false);
    expect(matchesCommandShortcut("searchPath", key("f", { ctrlKey: true, altKey: true }))).toBe(
      false,
    );
  });

  it("has no colliding shortcut definitions", () => {
    expect(commandShortcutCollisions()).toEqual([]);
  });

  it("guards native menu command payloads", () => {
    expect(isAppCommandId("openCompare")).toBe(true);
    expect(isAppCommandId("acceptBoth")).toBe(true);
    expect(isAppCommandId("unknown")).toBe(false);
    expect(isAppCommandId(null)).toBe(false);
  });
});
