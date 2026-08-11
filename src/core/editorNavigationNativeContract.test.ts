import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const menu = readFileSync(new URL("../../src-tauri/src/menu.rs", import.meta.url), "utf8");
const system = readFileSync(new URL("../../src-tauri/src/commands/system.rs", import.meta.url), "utf8");
const tauriLib = readFileSync(new URL("../../src-tauri/src/lib.rs", import.meta.url), "utf8");

describe("native editor navigation Back contract", () => {
  it("allowlists one stable command with an initial-disabled platform accelerator", () => {
    expect(menu).toContain('"navigateEditorBack"');
    expect(menu).toMatch(/MenuItem::with_id\([\s\S]*?"navigateEditorBack"[\s\S]*?false/);
    expect(menu).toContain('Some("Ctrl+-")');
    expect(menu).toContain('Some("Alt+Left")');
    expect(menu).toContain("cfg!(target_os = \"macos\")");
    expect(menu).toContain('"Previous Editor Location"');
  });

  it("toggles only the stable item through a boolean command", () => {
    expect(system).toContain("set_editor_navigation_back_enabled");
    expect(system).toMatch(/set_editor_navigation_back_enabled\([\s\S]*?enabled: bool/);
    expect(system).not.toMatch(/set_editor_navigation_back_enabled\([\s\S]{0,160}(label|accelerator|path):/);
    expect(menu).toContain("set_editor_navigation_back_enabled");
  });

  it("registers the setter invoke", () => {
    expect(tauriLib).toContain("system::set_editor_navigation_back_enabled");
  });
});
