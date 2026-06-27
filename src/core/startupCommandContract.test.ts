/// <reference types="node" />

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const bridge = readFileSync(new URL("./bridge.ts", import.meta.url), "utf8");
const commandModule = readFileSync(new URL("../../src-tauri/src/commands/mod.rs", import.meta.url), "utf8");
const startupCommand = readFileSync(
  new URL("../../src-tauri/src/commands/startup.rs", import.meta.url),
  "utf8",
);
const tauriLib = readFileSync(new URL("../../src-tauri/src/lib.rs", import.meta.url), "utf8");

describe("startup command contract", () => {
  it("wires the Tauri startup_args command through the frontend bridge", () => {
    expect(bridge).toContain('invoke<string[]>("startup_args")');
    expect(commandModule).toContain("pub mod startup;");
    expect(startupCommand).toContain("pub fn startup_args() -> Vec<String>");
    expect(startupCommand).toContain("std::env::args().skip(1).collect()");
    expect(tauriLib).toContain("startup::startup_args");
  });
});
