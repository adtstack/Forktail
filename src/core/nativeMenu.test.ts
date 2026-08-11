/// <reference types="node" />

import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  isNativeMenuCommandAllowedForSurface,
  preventNativeWindowCloseWhenGuarded,
} from "./nativeMenu";

const menuSource = readFileSync(
  new URL("../../src-tauri/src/menu.rs", import.meta.url),
  "utf8",
);
const runtimeMenuSource = menuSource.split("#[cfg(test)]")[0] ?? menuSource;
const appSource = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const tauriLibSource = readFileSync(
  new URL("../../src-tauri/src/lib.rs", import.meta.url),
  "utf8",
);
const startupCommandSource = readFileSync(
  new URL("../../src-tauri/src/commands/startup.rs", import.meta.url),
  "utf8",
);

describe("multi-window native menu routing", () => {
  it("emits only to the single focused WebView instead of broadcasting", () => {
    expect(runtimeMenuSource).toContain("emit_to(");
    expect(runtimeMenuSource).toContain("is_focused()");
    expect(runtimeMenuSource).not.toMatch(/\bapp\.emit\s*\(/);
  });

  it("allows only read-only diff navigation in detached review", () => {
    expect(isNativeMenuCommandAllowedForSurface("folderReview", "previousDiff")).toBe(true);
    expect(isNativeMenuCommandAllowedForSurface("folderReview", "nextDiff")).toBe(true);
    for (const command of [
      "openCompare",
      "openFolders",
      "save",
      "saveAs",
      "undo",
      "redo",
      "swapSides",
      "searchPath",
      "navigateEditorBack",
      "settings",
      "quit",
    ] as const) {
      expect(isNativeMenuCommandAllowedForSurface("folderReview", command)).toBe(false);
    }
  });

  it("keeps the main command profile independent", () => {
    expect(isNativeMenuCommandAllowedForSurface("main", "save")).toBe(true);
    expect(isNativeMenuCommandAllowedForSurface("main", "openFolders")).toBe(true);
    expect(isNativeMenuCommandAllowedForSurface("main", "quit")).toBe(true);
    expect(runtimeMenuSource).toContain("MAIN_EDITOR_NAVIGATION_BACK_ENABLED");
  });

  it("routes native Settings with the registry id and keeps detached review disabled", () => {
    expect(isNativeMenuCommandAllowedForSurface("main", "settings")).toBe(true);
    expect(isNativeMenuCommandAllowedForSurface("folderReview", "settings")).toBe(false);
    expect(runtimeMenuSource).toMatch(
      /MenuItem::with_id\(\s*app,\s*SETTINGS_COMMAND_ID,\s*"Settings",\s*false,\s*Some\("CmdOrCtrl\+,"\),?\s*\)/,
    );
    expect(runtimeMenuSource).toContain("MAIN_SETTINGS_ENABLED");
  });

  it("sends keyboard and native Settings through one guarded App handler", () => {
    expect(appSource).toMatch(
      /matchesCommandShortcut\("settings", event\)[\s\S]{0,120}handleSettingsCommand\(\)/,
    );
    expect(appSource).toMatch(
      /detail\.commandId === "settings"[\s\S]{0,120}handleSettingsCommand\(\)/,
    );
    expect(appSource).toMatch(
      /const handleSettingsCommand[\s\S]{0,900}requestLeaveActiveSession\(/,
    );
    expect(appSource).toContain("settingsFocusRequest={settingsFocusRequest}");
  });

  it("closes repository state before Settings leaves any Git-backed editor", () => {
    const handlerStart = appSource.indexOf("const handleSettingsCommand = useCallback");
    const handlerEnd = appSource.indexOf("const closeExternalGitToolWindow", handlerStart);
    expect(handlerStart).toBeGreaterThanOrEqual(0);
    expect(handlerEnd).toBeGreaterThan(handlerStart);
    const handler = appSource.slice(handlerStart, handlerEnd);

    expect(handler).toContain("keepsGitRepositorySession(");
    expect(handler).toContain("completeGitRepositoryLeave(focusHomeSettings)");
    expect(handler).toContain("completeBackHome(focusHomeSettings)");
    expect(handler).not.toContain('mode === "git"');
  });

  it("routes Quit through the main React surface instead of a predefined immediate exit", () => {
    expect(runtimeMenuSource).toMatch(
      /let quit = MenuItem::with_id\(\s*app,\s*QUIT_COMMAND_ID/,
    );
    expect(runtimeMenuSource).not.toContain("PredefinedMenuItem::quit");
    expect(runtimeMenuSource).toContain("QUIT_COMMAND_ID");
    expect(runtimeMenuSource).toContain('get_webview_window("main")');
  });
});

describe("native window close guard", () => {
  it("wires packaged close requests into the shared React leave confirmation", () => {
    expect(appSource).toContain("listenForNativeWindowCloseRequests");
    expect(appSource).toContain("preventNativeWindowCloseWhenGuarded");
    expect(appSource).toContain("requestLeaveActiveSession(");
    expect(appSource).toContain('window.addEventListener("beforeunload"');
  });

  it("prevents an unapproved dirty close and delegates to the React confirmation flow", () => {
    const event = { preventDefault: vi.fn() };
    const requestGuardedClose = vi.fn();

    expect(preventNativeWindowCloseWhenGuarded(event, {
      approved: false,
      hasUnsavedChanges: true,
      requiresApplicationExit: false,
    }, requestGuardedClose)).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(requestGuardedClose).toHaveBeenCalledTimes(1);
  });

  it("permits a clean close and a previously approved one without reopening the dialog", () => {
    for (const context of [
      { approved: false, hasUnsavedChanges: false, requiresApplicationExit: false },
      { approved: true, hasUnsavedChanges: true, requiresApplicationExit: false },
    ]) {
      const event = { preventDefault: vi.fn() };
      const requestGuardedClose = vi.fn();

      expect(preventNativeWindowCloseWhenGuarded(
        event,
        context,
        requestGuardedClose,
      )).toBe(false);
      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(requestGuardedClose).not.toHaveBeenCalled();
    }
  });

  it("routes an external Git tool window through application exit even when clean", () => {
    const event = { preventDefault: vi.fn() };
    const requestGuardedClose = vi.fn();

    expect(preventNativeWindowCloseWhenGuarded(event, {
      approved: false,
      hasUnsavedChanges: false,
      requiresApplicationExit: true,
    }, requestGuardedClose)).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(requestGuardedClose).toHaveBeenCalledTimes(1);
  });

  it("routes OS application quit through React but lets the approved exit pass once", () => {
    expect(tauriLibSource).toMatch(
      /RunEvent::ExitRequested \{ code, api, \.\. \}[\s\S]{0,180}should_guard_user_exit_request\(app, code\)[\s\S]{0,80}api\.prevent_exit\(\)[\s\S]{0,100}emit_quit_to_main\(app\)/,
    );
    expect(runtimeMenuSource).toContain("code.is_none() && main_window_available");
    expect(runtimeMenuSource).toContain(
      'app.emit_to("main", NATIVE_MENU_COMMAND_EVENT, QUIT_COMMAND_ID)',
    );
    expect(startupCommandSource).toContain("app.exit(0)");

    const exitRequestStart = tauriLibSource.indexOf(
      "tauri::RunEvent::ExitRequested { code, api, .. }",
    );
    const finalExitStart = tauriLibSource.indexOf(
      "tauri::RunEvent::Exit =>",
      exitRequestStart,
    );
    const exitRequestArm = tauriLibSource.slice(exitRequestStart, finalExitStart);
    const allowedExitBranch = exitRequestArm.indexOf("} else {");
    expect(exitRequestStart).toBeGreaterThanOrEqual(0);
    expect(finalExitStart).toBeGreaterThan(exitRequestStart);
    expect(allowedExitBranch).toBeGreaterThanOrEqual(0);
    expect(exitRequestArm.slice(0, allowedExitBranch)).not.toContain("close_all_labels");
    expect(exitRequestArm.slice(allowedExitBranch)).toContain("close_all_labels");
  });
});
