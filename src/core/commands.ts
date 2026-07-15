export type AppCommandId =
  | "openCompare"
  | "openFolders"
  | "openMerge"
  | "save"
  | "saveAs"
  | "undo"
  | "redo"
  | "nextDiff"
  | "previousDiff"
  | "nextConflict"
  | "previousConflict"
  | "acceptOurs"
  | "acceptBase"
  | "acceptTheirs"
  | "acceptBoth"
  | "swapSides"
  | "searchPath"
  | "settings";

export const APP_COMMAND_EVENT = "forktail-command";

export interface ShellOpenCommandContext {
  mode: "home" | "compare" | "folders" | "merge";
  compareOrigin: "files" | "difftool" | null;
  mergeOrigin: "files" | "mergetool" | null;
}

export interface KeyboardShortcutLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

interface ShortcutSpec {
  key: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  alt?: boolean;
  aria: string;
}

interface AppCommand {
  id: AppCommandId;
  label: string;
  shortcuts: readonly ShortcutSpec[];
}

export const appCommands = {
  openCompare: command("openCompare", "Open File Compare", [
    { key: "o", ctrl: true, aria: "Control+O" },
    { key: "o", meta: true, aria: "Meta+O" },
  ]),
  openFolders: command("openFolders", "Open Folder Diff", [
    { key: "o", ctrl: true, shift: true, aria: "Control+Shift+O" },
    { key: "o", meta: true, shift: true, aria: "Meta+Shift+O" },
  ]),
  openMerge: command("openMerge", "Open 3-way Merge", [
    { key: "o", ctrl: true, alt: true, aria: "Control+Alt+O" },
    { key: "o", meta: true, alt: true, aria: "Meta+Alt+O" },
  ]),
  save: command("save", "Save", [
    { key: "s", ctrl: true, aria: "Control+S" },
    { key: "s", meta: true, aria: "Meta+S" },
  ]),
  saveAs: command("saveAs", "Save As", [
    { key: "s", ctrl: true, shift: true, aria: "Control+Shift+S" },
    { key: "s", meta: true, shift: true, aria: "Meta+Shift+S" },
  ]),
  undo: command("undo", "Undo", [
    { key: "z", ctrl: true, aria: "Control+Z" },
    { key: "z", meta: true, aria: "Meta+Z" },
  ]),
  redo: command("redo", "Redo", [
    { key: "y", ctrl: true, aria: "Control+Y" },
    { key: "y", meta: true, aria: "Meta+Y" },
    { key: "z", ctrl: true, shift: true, aria: "Control+Shift+Z" },
    { key: "z", meta: true, shift: true, aria: "Meta+Shift+Z" },
  ]),
  nextDiff: command("nextDiff", "Next Change", [{ key: "F7", aria: "F7" }]),
  previousDiff: command("previousDiff", "Previous Change", [
    { key: "F7", shift: true, aria: "Shift+F7" },
  ]),
  nextConflict: command("nextConflict", "Next Conflict", [{ key: "F8", aria: "F8" }]),
  previousConflict: command("previousConflict", "Previous Conflict", [
    { key: "F8", shift: true, aria: "Shift+F8" },
  ]),
  acceptOurs: command("acceptOurs", "Accept OURS", [{ key: "1", alt: true, aria: "Alt+1" }]),
  acceptBase: command("acceptBase", "Accept BASE", [{ key: "2", alt: true, aria: "Alt+2" }]),
  acceptTheirs: command("acceptTheirs", "Accept THEIRS", [
    { key: "3", alt: true, aria: "Alt+3" },
  ]),
  acceptBoth: command("acceptBoth", "Keep Both", [{ key: "4", alt: true, aria: "Alt+4" }]),
  swapSides: command("swapSides", "Swap Sides", [
    { key: "x", ctrl: true, shift: true, aria: "Control+Shift+X" },
    { key: "x", meta: true, shift: true, aria: "Meta+Shift+X" },
  ]),
  searchPath: command("searchPath", "Search Path", [
    { key: "f", ctrl: true, aria: "Control+F" },
    { key: "f", meta: true, aria: "Meta+F" },
  ]),
  settings: command("settings", "Settings", [
    { key: ",", ctrl: true, aria: "Control+," },
    { key: ",", meta: true, aria: "Meta+," },
  ]),
} as const satisfies Record<AppCommandId, AppCommand>;

const appCommandIdSet = new Set<string>(Object.keys(appCommands));

export function commandAriaKeyshortcuts(commandId: AppCommandId): string {
  return appCommands[commandId].shortcuts.map((shortcut) => shortcut.aria).join(" ");
}

export function isAppCommandId(value: unknown): value is AppCommandId {
  return typeof value === "string" && appCommandIdSet.has(value);
}

export function dispatchAppCommand(commandId: AppCommandId): void {
  window.dispatchEvent(new CustomEvent(APP_COMMAND_EVENT, { detail: { commandId } }));
}

export function commandIdFromEvent(event: Event): AppCommandId | null {
  if (!(event instanceof CustomEvent)) return null;
  const detail = event.detail as { commandId?: unknown } | null;
  return isAppCommandId(detail?.commandId) ? detail.commandId : null;
}

export function matchesCommandShortcut(
  commandId: AppCommandId,
  event: KeyboardShortcutLike,
): boolean {
  return appCommands[commandId].shortcuts.some((shortcut) => shortcutMatches(shortcut, event));
}

export function commandShortcutCollisions(): string[] {
  const seen = new Map<string, AppCommandId>();
  const collisions: string[] = [];

  for (const command of Object.values(appCommands)) {
    for (const shortcut of command.shortcuts) {
      const key = shortcutSignature(shortcut);
      const existing = seen.get(key);
      if (existing) {
        collisions.push(`${existing} / ${command.id}: ${shortcut.aria}`);
      } else {
        seen.set(key, command.id);
      }
    }
  }

  return collisions;
}

export function isShellOpenCommandAllowed(
  commandId: AppCommandId,
  context: ShellOpenCommandContext,
): boolean {
  if (
    commandId !== "openCompare" &&
    commandId !== "openFolders" &&
    commandId !== "openMerge"
  ) {
    return false;
  }

  const externalGitToolActive =
    (context.mode === "compare" && context.compareOrigin === "difftool") ||
    (context.mode === "merge" && context.mergeOrigin === "mergetool");
  return !externalGitToolActive;
}

function command(id: AppCommandId, label: string, shortcuts: readonly ShortcutSpec[]): AppCommand {
  return { id, label, shortcuts };
}

function shortcutMatches(shortcut: ShortcutSpec, event: KeyboardShortcutLike): boolean {
  return (
    normalizedKey(event.key) === normalizedKey(shortcut.key) &&
    event.ctrlKey === Boolean(shortcut.ctrl) &&
    event.metaKey === Boolean(shortcut.meta) &&
    event.shiftKey === Boolean(shortcut.shift) &&
    event.altKey === Boolean(shortcut.alt)
  );
}

function shortcutSignature(shortcut: ShortcutSpec): string {
  return [
    normalizedKey(shortcut.key),
    Boolean(shortcut.ctrl),
    Boolean(shortcut.meta),
    Boolean(shortcut.shift),
    Boolean(shortcut.alt),
  ].join(":");
}

function normalizedKey(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key;
}
