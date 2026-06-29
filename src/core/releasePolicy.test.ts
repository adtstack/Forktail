/// <reference types="node" />

import { describe, expect, it } from "vitest";
import releaseWorkflow from "../../.github/workflows/release.yml?raw";
import validateReleaseScript from "../../scripts/validate-release.mjs?raw";

describe("release workflow policy", () => {
  it("builds release artifacts only from tags or explicit workflow dispatch", () => {
    expect(releaseWorkflow).toContain("tags:");
    expect(releaseWorkflow).toContain('"v*.*.*"');
    expect(releaseWorkflow).toContain("workflow_dispatch:");
    expect(releaseWorkflow).toContain("Existing vX.Y.Z tag to package");
    expect(releaseWorkflow).toContain("permissions:\n  contents: write");
  });

  it("keeps release actions pinned to exact versions", () => {
    const actionRefs = Array.from(
      releaseWorkflow.matchAll(/uses:\s+([^\s@]+)@([^\s]+)/g),
      (match) => `${match[1]}@${match[2]}`,
    );

    expect(actionRefs).toEqual([
      "actions/checkout@v4.2.2",
      "actions/setup-node@v4.4.0",
      "actions/checkout@v4.2.2",
      "actions/setup-node@v4.4.0",
      "actions/upload-artifact@v4.6.2",
      "actions/download-artifact@v4.3.0",
    ]);
  });

  it("runs validation gates before the platform package matrix", () => {
    expectInOrder(releaseWorkflow, [
      "npm run release:validate",
      "npm audit --audit-level=high",
      "npm run typecheck",
      "npm test",
      "npm run build",
      "cargo fmt --check",
      "cargo clippy --all-targets -- -D warnings",
      "cargo test",
      "Build Tauri bundle",
    ]);
  });

  it("installs Linux system libraries before Rust/Tauri compilation on Ubuntu runners", () => {
    expect(countOccurrences(releaseWorkflow, "libwebkit2gtk-4.1-dev")).toBeGreaterThanOrEqual(2);
    expect(countOccurrences(releaseWorkflow, "pkg-config")).toBeGreaterThanOrEqual(2);
    expect(countOccurrences(releaseWorkflow, "libgtk-3-dev")).toBeGreaterThanOrEqual(2);
    expectInOrder(releaseWorkflow, [
      "Install Tauri Linux dependencies",
      "cargo clippy --all-targets -- -D warnings",
      "Install Linux bundle dependencies",
      "npm run tauri build --",
    ]);
  });

  it("creates unsigned draft prerelease artifacts with checksums for all three platforms", () => {
    for (const fragment of [
      "os: macos-14",
      "bundle: app",
      "output: macos",
      "forktail-macos-app",
      "target: universal-apple-darwin",
      "os: windows-2022",
      "bundle: nsis",
      "output: nsis",
      "forktail-windows-nsis",
      "os: ubuntu-22.04",
      "bundle: appimage",
      "output: appimage",
      "forktail-linux-appimage",
      "Install macOS universal Rust targets",
      "rustup target add aarch64-apple-darwin x86_64-apple-darwin",
      "npm run tauri build --",
      "Ad-hoc sign macOS app bundle",
      "codesign --force --deep --sign -",
      "codesign --verify --deep --strict",
      ".tar.gz",
      "checksums.txt",
      "gh release create",
      "gh release view",
      "gh release edit",
      "gh release upload",
      "--clobber",
      "--draft",
      "--prerelease",
      "not code signed or notarized",
    ]) {
      expect(releaseWorkflow).toContain(fragment);
    }

    expectInOrder(releaseWorkflow, [
      "Install macOS universal Rust targets",
      "Build Tauri bundle",
      "Ad-hoc sign macOS app bundle",
      "Package bundle artifact",
    ]);
  });

  it("requires the release tag to match package, Tauri, and Cargo versions", () => {
    expect(validateReleaseScript).toContain("process.argv[2]");
    expect(validateReleaseScript).toContain("RELEASE_TAG");
    expect(validateReleaseScript).toContain("package.json");
    expect(validateReleaseScript).toContain("src-tauri/tauri.conf.json");
    expect(validateReleaseScript).toContain("src-tauri/Cargo.toml");
    expect(validateReleaseScript).toContain("must match project version");
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

function countOccurrences(text: string, fragment: string): number {
  return text.split(fragment).length - 1;
}
