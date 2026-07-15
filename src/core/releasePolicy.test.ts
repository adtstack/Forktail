/// <reference types="node" />

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
      // SBOM/NOTICE upload in the validate job (REL-007).
      "actions/upload-artifact@v4.6.2",
      "actions/checkout@v4.2.2",
      "actions/setup-node@v4.4.0",
      "actions/upload-artifact@v4.6.2",
      "actions/checkout@v4.2.2",
      "actions/setup-node@v4.4.0",
      "actions/upload-artifact@v4.6.2",
      "actions/checkout@v4.2.2",
      "actions/download-artifact@v4.3.0",
      "actions/checkout@v4.2.2",
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

  it("keeps the baseline draft prerelease artifacts with checksums for all three platforms", () => {
    for (const fragment of [
      "os: macos-14",
      "bundle: app",
      "output: macos",
      "forktail-macos-dmg",
      "forktail-macos-universal",
      "target: universal-apple-darwin",
      "os: windows-2022",
      "bundle: nsis",
      "output: nsis",
      "forktail-windows-nsis",
      "forktail-windows-x64",
      "os: ubuntu-22.04",
      "bundle: appimage",
      "output: appimage",
      "forktail-linux-appimage",
      "forktail-linux-x86_64",
      "Install macOS universal Rust targets",
      "rustup target add aarch64-apple-darwin x86_64-apple-darwin",
      "npm run tauri build --",
      "Ad-hoc sign macOS app bundle",
      'bundle_root="src-tauri/target/${BUILD_TARGET}/release/bundle/${BUNDLE_OUTPUT}"',
      "codesign --force --deep --sign -",
      "codesign --verify --deep --strict",
      "Stage release asset",
      ".dmg",
      ".exe",
      ".AppImage",
      "hdiutil create",
      "hdiutil verify",
      "checksums.txt",
      "gh release create",
      "gh release view",
      "gh release edit",
      "gh release upload",
      "--clobber",
      "--draft",
      "--prerelease",
      "not Developer ID signed or notarized",
    ]) {
      expect(releaseWorkflow).toContain(fragment);
    }

    expectInOrder(releaseWorkflow, [
      "Install macOS universal Rust targets",
      "Build Tauri bundle",
      "Ad-hoc sign macOS app bundle",
      "Stage release asset",
    ]);
  });

  it("publishes only protected, signed stable updater artifacts to R2", () => {
    for (const fragment of [
      "publish_updater:",
      "ENABLE_R2_UPDATER",
      "R2 updater publishing is only allowed for stable vX.Y.Z tags.",
      "Pin the validated tag to its commit",
      "commit: ${{ steps.source.outputs.commit }}",
      "ref: ${{ needs.validate.outputs.commit }}",
      "build_updater:",
      "publish_updater:",
      "environment: production-updates",
      "TAURI_SIGNING_PRIVATE_KEY",
      "APPLE_CERTIFICATE",
      "APPLE_SIGNING_IDENTITY",
      "WINDOWS_CERTIFICATE",
      "TAURI_WINDOWS_CERTIFICATE_THUMBPRINT",
      "non-development reverse-domain bundle identifier",
      "Build signed and notarized macOS updater bundle",
      "Verify macOS updater payload signing and notarization",
      "Verify Windows updater payload Authenticode signature",
      ".app.tar.gz",
      ".sig",
      "r2-updater-stable-manifest",
      "Verify release tag remains pinned to the validated commit",
      "Release tag moved before stable manifest promotion; refuse publication.",
      "Release tag moved before draft release creation; refuse publication.",
      "--if-none-match \"*\"",
      "aws s3api put-object help",
      "verify_existing_object",
      "public, max-age=31536000, immutable",
      "npm run updater:promotion",
      "--if-match \"$manifest_etag\"",
      "Publish stable manifest last",
      "--key \"stable/latest.json\"",
      "no-store, max-age=0, must-revalidate",
      "needs.draft_release.result == 'success'",
    ]) {
      expect(releaseWorkflow).toContain(fragment);
    }

    expectInOrder(releaseWorkflow, [
      "Verify protected updater release configuration",
      "Import macOS Developer ID certificate",
      "Build signed Tauri updater bundle",
      "Build signed and notarized macOS updater bundle",
      "Verify macOS updater payload signing and notarization",
      "Stage updater artifacts",
      "Upload immutable artifacts and verify public copies",
      "Publish stable manifest last",
    ]);

    const updaterBuild = workflowJob("build_updater");
    expect(updaterBuild).toContain("if: needs.validate.outputs.publish_updater == 'true'");
    expect(updaterBuild).toContain("environment: production-updates");
    expect(updaterBuild).toContain("if: matrix.platform == 'macOS'");

    const publisher = workflowJob("publish_updater");
    expect(publisher).toContain("needs.draft_release.result == 'success'");
    expect(publisher).toContain("environment: production-updates");
    expect(publisher).toContain("Publish stable manifest last");

    const auditRelease = workflowJob("draft_release");
    expect(auditRelease).toContain("needs.build_updater.result == 'success'");
    expect(auditRelease).toContain("Create draft GitHub release");
  });

  it("derives R2 eligibility from the tag instead of a workflow-dispatch prerelease toggle", () => {
    const stableTag = resolveReleaseInputs({
      eventName: "push",
      refName: "v1.2.3",
      enableR2Updater: "true",
    });
    expect(stableTag.status).toBe(0);
    expect(stableTag.outputs).toMatchObject({ prerelease: "true", publish_updater: "true" });

    const prereleaseTag = resolveReleaseInputs({
      eventName: "push",
      refName: "v1.2.3-beta.1",
      enableR2Updater: "true",
    });
    expect(prereleaseTag.status).toBe(0);
    expect(prereleaseTag.outputs).toMatchObject({ prerelease: "true", publish_updater: "false" });

    const rejectedDispatch = resolveReleaseInputs({
      eventName: "workflow_dispatch",
      inputTag: "v1.2.3-beta.1",
      inputPrerelease: "false",
      inputPublishUpdater: "true",
    });
    expect(rejectedDispatch.status).not.toBe(0);
    expect(rejectedDispatch.stderr).toContain("only allowed for stable");

    const acceptedDispatch = resolveReleaseInputs({
      eventName: "workflow_dispatch",
      inputTag: "v1.2.3",
      inputPrerelease: "false",
      inputPublishUpdater: "true",
    });
    expect(acceptedDispatch.status).toBe(0);
    expect(acceptedDispatch.outputs).toMatchObject({ prerelease: "false", publish_updater: "true" });
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

function resolveReleaseInputs(options: {
  eventName: "push" | "workflow_dispatch";
  refName?: string;
  inputTag?: string;
  inputPrerelease?: string;
  inputPublishUpdater?: string;
  enableR2Updater?: string;
}) {
  const script = resolveInputsScript();
  const directory = mkdtempSync(join(tmpdir(), "forktail-release-inputs-"));
  const outputPath = join(directory, "github-output");

  try {
    const result = spawnSync("bash", ["-c", script], {
      encoding: "utf8",
      env: {
        ...process.env,
        EVENT_NAME: options.eventName,
        INPUT_TAG: options.inputTag ?? "",
        INPUT_PRERELEASE: options.inputPrerelease ?? "",
        INPUT_PUBLISH_UPDATER: options.inputPublishUpdater ?? "",
        REF_NAME: options.refName ?? "",
        ENABLE_R2_UPDATER: options.enableR2Updater ?? "",
        GITHUB_OUTPUT: outputPath,
      },
    });
    const outputs = existsSync(outputPath)
      ? Object.fromEntries(
        readFileSync(outputPath, "utf8")
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => {
            const separator = line.indexOf("=");
            return [line.slice(0, separator), line.slice(separator + 1)];
          }),
      )
      : {};
    return { status: result.status, stderr: result.stderr, outputs };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function resolveInputsScript(): string {
  const stepStart = releaseWorkflow.indexOf("      - name: Resolve release inputs");
  const runStart = releaseWorkflow.indexOf("        run: |\n", stepStart);
  const stepEnd = releaseWorkflow.indexOf("\n      - uses: actions/checkout", runStart);

  expect(stepStart).toBeGreaterThanOrEqual(0);
  expect(runStart).toBeGreaterThanOrEqual(0);
  expect(stepEnd).toBeGreaterThan(runStart);

  return releaseWorkflow.slice(runStart + "        run: |\n".length, stepEnd).replace(/^ {10}/gm, "");
}

function workflowJob(id: string): string {
  const markerIndex = releaseWorkflow.lastIndexOf(`\n  ${id}:\n`);
  expect(markerIndex).toBeGreaterThanOrEqual(0);
  const start = markerIndex + 1;
  const remaining = releaseWorkflow.slice(start + 1);
  const nextJob = remaining.search(/\n  [A-Za-z_][A-Za-z0-9_-]*:\n/);
  return nextJob === -1 ? releaseWorkflow.slice(start) : remaining.slice(0, nextJob);
}
