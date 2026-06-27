/// <reference types="node" />

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import packageJson from "../../package.json";

const bridge = readFileSync(new URL("./bridge.ts", import.meta.url), "utf8");
const commandModule = readFileSync(new URL("../../src-tauri/src/commands/mod.rs", import.meta.url), "utf8");
const systemCommand = readFileSync(new URL("../../src-tauri/src/commands/system.rs", import.meta.url), "utf8");
const tauriLib = readFileSync(new URL("../../src-tauri/src/lib.rs", import.meta.url), "utf8");

describe("native reveal command contract", () => {
  it("uses a narrow custom command instead of broad opener or shell plugins", () => {
    expect(bridge).toContain('invoke<void>("reveal_path"');
    expect(commandModule).toContain("pub mod system;");
    expect(systemCommand).toContain("pub fn reveal_path(path: String) -> CommandResult<()>");
    expect(systemCommand).toContain("fs::symlink_metadata(&target)");
    expect(systemCommand).toContain("Command::new(reveal.program)");
    expect(systemCommand).toContain(".args(&reveal.args)");
    expect(systemCommand).not.toContain("sh -c");
    expect(systemCommand).not.toContain("cmd /C");
    expect(tauriLib).toContain("system::reveal_path");

    expect(Object.keys(packageJson.dependencies)).not.toContain("@tauri-apps/plugin-opener");
    expect(Object.keys(packageJson.dependencies)).not.toContain("@tauri-apps/plugin-shell");
  });
});
