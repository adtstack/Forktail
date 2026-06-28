/// <reference types="node" />

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const bridge = readFileSync(new URL("./bridge.ts", import.meta.url), "utf8");
const tauriLib = readFileSync(new URL("../../src-tauri/src/lib.rs", import.meta.url), "utf8");
const folderCommands = readFileSync(
  new URL("../../src-tauri/src/commands/folders.rs", import.meta.url),
  "utf8",
);

describe("folder scan command contract", () => {
  it("passes scan job ids and exposes a cancel command", () => {
    expect(bridge).toContain("jobId");
    expect(bridge).toContain('invoke<void>("cancel_folder_scan"');
    expect(folderCommands).toContain("pub fn cancel_folder_scan");
    expect(folderCommands).toContain("job_id: Option<u64>");
    expect(tauriLib).toContain("folders::cancel_folder_scan");
  });
});
