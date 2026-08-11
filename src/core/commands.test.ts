import { describe, expect, it } from "vitest";
import {
  appCommands,
  commandDetailFromEvent,
  commandAriaKeyshortcuts,
  commandShortcutCollisions,
  dispatchAppCommand,
  isAppCommandId,
  settingsCommandPlan,
  isShellOpenCommandAllowed,
  matchesCommandShortcut,
  navigationBackShortcut,
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
    expect(commandAriaKeyshortcuts("openGitRepository")).toBe(
      "Control+Alt+G Meta+Alt+G",
    );
    expect(commandAriaKeyshortcuts("redo")).toBe(
      "Control+Y Meta+Y Control+Shift+Z Meta+Shift+Z",
    );
    expect(commandAriaKeyshortcuts("quit")).toBe("Control+Q Meta+Q");
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
    expect(matchesCommandShortcut(
      "openGitRepository",
      key("g", { ctrlKey: true, altKey: true }),
    )).toBe(true);
  });

  it("keeps save and save-as distinct", () => {
    expect(matchesCommandShortcut("save", key("s", { ctrlKey: true }))).toBe(true);
    expect(matchesCommandShortcut("save", key("s", { ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(matchesCommandShortcut("saveAs", key("s", { ctrlKey: true, shiftKey: true }))).toBe(
      true,
    );
  });

  it("matches Quit without accepting extra modifiers", () => {
    expect(matchesCommandShortcut("quit", key("q", { ctrlKey: true }))).toBe(true);
    expect(matchesCommandShortcut("quit", key("q", { metaKey: true }))).toBe(true);
    expect(matchesCommandShortcut("quit", key("q", { ctrlKey: true, shiftKey: true }))).toBe(
      false,
    );
  });

  it("routes Ctrl/Cmd+, through the same Settings command id as native menu", () => {
    expect(appCommands.settings.id).toBe("settings");
    expect(commandAriaKeyshortcuts("settings")).toBe("Control+, Meta+,");
    expect(matchesCommandShortcut("settings", key(",", { ctrlKey: true }))).toBe(true);
    expect(matchesCommandShortcut("settings", key(",", { metaKey: true }))).toBe(true);
    expect(matchesCommandShortcut(
      "settings",
      key(",", { ctrlKey: true, shiftKey: true }),
    )).toBe(false);
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
    expect(commandShortcutCollisions("windows")).toEqual([]);
    expect(commandShortcutCollisions("linux")).toEqual([]);
    expect(commandShortcutCollisions("macos")).toEqual([]);
  });

  it("uses the authoritative runtime platform for editor Back", () => {
    expect(appCommands.navigateEditorBack.label).toBe("Previous Editor Location");
    expect(navigationBackShortcut("windows")).toEqual({
      key: "ArrowLeft",
      alt: true,
      aria: "Alt+ArrowLeft",
      accelerator: "Alt+Left",
    });
    expect(navigationBackShortcut("linux")).toEqual(navigationBackShortcut("windows"));
    expect(navigationBackShortcut("macos")).toEqual({
      key: "-",
      ctrl: true,
      aria: "Control+-",
      accelerator: "Ctrl+-",
    });
    expect(commandAriaKeyshortcuts("navigateEditorBack", "windows")).toBe("Alt+ArrowLeft");
    expect(commandAriaKeyshortcuts("navigateEditorBack", "macos")).toBe("Control+-");
    expect(matchesCommandShortcut(
      "navigateEditorBack",
      key("ArrowLeft", { altKey: true }),
      "windows",
    )).toBe(true);
    expect(matchesCommandShortcut(
      "navigateEditorBack",
      key("-", { ctrlKey: true }),
      "macos",
    )).toBe(true);
    expect(matchesCommandShortcut(
      "navigateEditorBack",
      key("ArrowLeft", { altKey: true, shiftKey: true }),
      "windows",
    )).toBe(false);
  });

  it("carries a typed source and monotonic time while accepting legacy payloads", () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: new EventTarget(),
    });
    const received: Event[] = [];
    const listener = (event: Event) => { received.push(event); };
    window.addEventListener("forktail-command", listener);
    dispatchAppCommand("navigateEditorBack", "mouse", 42.5);
    window.removeEventListener("forktail-command", listener);

    expect(commandDetailFromEvent(received[0] as Event)).toEqual({
      commandId: "navigateEditorBack",
      source: "mouse",
      monotonicEventTime: 42.5,
    });
    expect(commandDetailFromEvent(new CustomEvent("forktail-command", {
      detail: { commandId: "save" },
    }))).toEqual({ commandId: "save" });
    expect(commandDetailFromEvent(new CustomEvent("forktail-command", {
      detail: { commandId: "navigateEditorBack", source: "unknown" },
    }))).toBeNull();
    expect(commandDetailFromEvent(new CustomEvent("forktail-command", {
      detail: {
        commandId: "navigateEditorBack",
        source: "keyboard",
        monotonicEventTime: -1,
      },
    }))).toBeNull();
    Reflect.deleteProperty(globalThis, "window");
  });

  it("guards native menu command payloads", () => {
    expect(isAppCommandId("openCompare")).toBe(true);
    expect(isAppCommandId("acceptBoth")).toBe(true);
    expect(isAppCommandId("navigateEditorBack")).toBe(true);
    expect(isAppCommandId("quit")).toBe(true);
    expect(isAppCommandId("unknown")).toBe(false);
    expect(isAppCommandId(null)).toBe(false);
  });

  it("blocks keyboard and native open commands while an external Git tool owns the window", () => {
    for (const commandId of [
      "openCompare",
      "openFolders",
      "openMerge",
      "openGitRepository",
    ] as const) {
      expect(isShellOpenCommandAllowed(commandId, {
        mode: "compare",
        compareOrigin: "difftool",
        mergeOrigin: null,
      })).toBe(false);
      expect(isShellOpenCommandAllowed(commandId, {
        mode: "merge",
        compareOrigin: null,
        mergeOrigin: "mergetool",
      })).toBe(false);
      expect(isShellOpenCommandAllowed(commandId, {
        mode: "compare",
        compareOrigin: "files",
        mergeOrigin: null,
      })).toBe(true);
    }

    expect(isShellOpenCommandAllowed("save", {
      mode: "home",
      compareOrigin: null,
      mergeOrigin: null,
    })).toBe(false);
  });

  it("gives every allowed Settings invocation one Home destination and no no-op", () => {
    for (const mode of ["home", "compare", "folders", "merge", "git"] as const) {
      expect(settingsCommandPlan({
        mode,
        compareOrigin: mode === "compare" ? "files" : null,
        mergeOrigin: mode === "merge" ? "files" : null,
      })).toEqual({
        destination: "homeSettings",
        requiresLeaveGuard: mode !== "home",
      });
    }
  });

  it("disables Settings while difftool or mergetool owns the main window", () => {
    expect(settingsCommandPlan({
      mode: "compare",
      compareOrigin: "difftool",
      mergeOrigin: null,
    })).toBeNull();
    expect(settingsCommandPlan({
      mode: "merge",
      compareOrigin: null,
      mergeOrigin: "mergetool",
    })).toBeNull();
  });
});
