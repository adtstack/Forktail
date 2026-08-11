/// <reference types="node" />

import { describe, expect, it } from "vitest";
import gitAttributes from "../../.gitattributes?raw";
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
      "npm audit --audit-level=high",
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

  it("exercises the version bump transaction on a real Windows filesystem", () => {
    const windowsJob = ciWorkflow.slice(
      ciWorkflow.indexOf("git-tool-harness-windows:"),
      ciWorkflow.indexOf("\n  rust:"),
    );

    expect(windowsJob).toContain("runs-on: windows-2022");
    expect(windowsJob).toContain("npx vitest run scripts/version-bump.test.mjs");
    expect(gitAttributes).toMatch(
      /^fixtures\/three-way\/cases\/\*\/\*\.txt text eol=lf$/m,
    );
    expect(gitAttributes).toMatch(
      /^fixtures\/three-way\/cases\/crlf-non-overlap\/\*\.txt -text$/m,
    );
    expect(gitAttributes).toMatch(/^\*\.mjs text eol=lf$/m);
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
