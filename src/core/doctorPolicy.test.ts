/// <reference types="node" />

import { describe, expect, it } from "vitest";
import packageJson from "../../package.json";
import doctorScript from "../../scripts/doctor.mjs?raw";
import readme from "../../README.md?raw";

describe("desktop readiness doctor policy", () => {
  it("checks every local tool needed before running Tauri desktop verification", () => {
    const requiredFragments = [
      'name: "Node.js"',
      'name: "npm"',
      'name: "rustc"',
      'name: "cargo"',
      'name: "rustfmt"',
      'name: "cargo clippy"',
      'name: "Tauri CLI executable"',
      '"exec", "--offline", "tauri", "--", "--version"',
    ];

    for (const fragment of requiredFragments) {
      expect(doctorScript).toContain(fragment);
    }
  });

  it("keeps the Tauri CLI as a lockfile-managed npm devDependency", () => {
    expect(packageJson.devDependencies).toHaveProperty("@tauri-apps/cli");
    expect(doctorScript).toContain('@tauri-apps/cli"');
  });

  it("documents doctor as the first desktop readiness command", () => {
    expectInOrder(readme, ["npm ci", "npm run doctor", "npm run tauri dev"]);
  });
});

function expectInOrder(text: string, fragments: string[]): void {
  let cursor = -1;

  for (const fragment of fragments) {
    const index = text.indexOf(fragment, cursor + 1);
    expect(index).toBeGreaterThan(cursor);
    cursor = index;
  }
}
