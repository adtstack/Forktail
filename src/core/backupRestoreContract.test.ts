/// <reference types="node" />

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const bridge = readFileSync(new URL("./bridge.ts", import.meta.url), "utf8");
const tauriLib = readFileSync(new URL("../../src-tauri/src/lib.rs", import.meta.url), "utf8");
const fileCommands = readFileSync(
  new URL("../../src-tauri/src/commands/files.rs", import.meta.url),
  "utf8",
);

describe("backup restore command contract", () => {
  it("wires backup list and restore commands through the frontend bridge", () => {
    expect(bridge).toContain('invoke<FileBackup[]>("list_file_backups"');
    expect(bridge).toContain('invoke<WriteResult>("restore_text_file_backup"');
    expect(fileCommands).toContain("pub fn list_file_backups");
    expect(fileCommands).toContain("pub fn restore_text_file_backup");
    expect(tauriLib).toContain("files::list_file_backups");
    expect(tauriLib).toContain("files::restore_text_file_backup");
  });
});
