/// <reference types="node" />

import { describe, expect, it } from "vitest";
import ciWorkflow from "../../.github/workflows/ci.yml?raw";
import firstSprint from "../../docs/13_FIRST_SPRINT.md?raw";

describe("CI branch gate policy", () => {
  it("runs only pull request checks and main branch pushes with read-only repository permissions", () => {
    expect(ciWorkflow).toContain("pull_request:");
    expect(ciWorkflow).toContain("push:");
    expect(ciWorkflow).toContain("branches: [main]");
    expect(ciWorkflow).toContain("permissions:\n  contents: read");
  });

  it("keeps frontend and Rust gates explicit and bounded", () => {
    expectInOrder(ciWorkflow, [
      "npm ci",
      "npm run typecheck",
      "npm test",
      "npm run build",
    ]);
    expectInOrder(ciWorkflow, [
      "cargo fmt --check",
      "cargo clippy --all-targets -- -D warnings",
      "cargo test",
    ]);
    expect(ciWorkflow).toContain("timeout-minutes: 15");
    expect(ciWorkflow).toContain("timeout-minutes: 30");
  });

  it("does not publish artifacts or release builds from the PR validation workflow", () => {
    const forbiddenFragments = [
      "actions/upload-artifact",
      "tauri-apps/tauri-action",
      "npm run tauri build",
      "cargo publish",
      "softprops/action-gh-release",
    ];
    const normalizedWorkflow = ciWorkflow.toLowerCase();

    for (const fragment of forbiddenFragments) {
      expect(normalizedWorkflow).not.toContain(fragment);
    }
    expect(firstSprint).toContain("릴리스 artifact는 아직 만들지 않는다");
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
