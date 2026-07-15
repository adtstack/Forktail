/// <reference types="node" />

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const projectRoot = new URL("../../", import.meta.url);
const configScript = new URL("../../scripts/write-updater-config.mjs", import.meta.url);
const manifestScript = new URL("../../scripts/generate-updater-manifest.mjs", import.meta.url);
const promotionScript = new URL("../../scripts/validate-updater-promotion.mjs", import.meta.url);
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

describe("updater release scripts", () => {
  it("writes a HTTPS-only updater config overlay without a signing private key", () => {
    const dir = temporaryDirectory();
    const output = join(dir, "tauri.updater.json");

    const result = runNode(configScript, [output], {
      TAURI_UPDATER_PUBLIC_KEY: "untrusted comment: public key\nRWQexample",
      TAURI_UPDATER_ENDPOINT: "https://updates.example.test/stable/latest.json",
    });

    expect(result.status).toBe(0);
    const config = JSON.parse(readFileSync(output, "utf8"));
    expect(config).toEqual({
      bundle: { createUpdaterArtifacts: true },
      plugins: {
        updater: {
          pubkey: "untrusted comment: public key\nRWQexample",
          endpoints: ["https://updates.example.test/stable/latest.json"],
          windows: { installMode: "passive" },
        },
      },
    });
    expect(readFileSync(output, "utf8")).not.toContain("TAURI_SIGNING_PRIVATE_KEY");
  });

  it("rejects a non-HTTPS updater endpoint", () => {
    const result = runNode(configScript, [join(temporaryDirectory(), "config.json")], {
      TAURI_UPDATER_PUBLIC_KEY: "public key",
      TAURI_UPDATER_ENDPOINT: "http://updates.example.test/latest.json",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("must use HTTPS");
  });

  it("rejects query parameters in the embedded updater endpoint", () => {
    const result = runNode(configScript, [join(temporaryDirectory(), "config.json")], {
      TAURI_UPDATER_PUBLIC_KEY: "public key",
      TAURI_UPDATER_ENDPOINT: "https://updates.example.test/latest.json?token=not-allowed",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("must not contain credentials, query parameters or a fragment");
  });

  it("rejects an r2.dev updater endpoint", () => {
    const result = runNode(configScript, [join(temporaryDirectory(), "config.json")], {
      TAURI_UPDATER_PUBLIC_KEY: "public key",
      TAURI_UPDATER_ENDPOINT: "https://forktail-updates.r2.dev/stable/latest.json",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("production custom domain");
  });

  it("adds the Windows PFX signing configuration only when both required values are present", () => {
    const dir = temporaryDirectory();
    const output = join(dir, "tauri.updater.json");

    const result = runNode(configScript, [output], {
      TAURI_UPDATER_PUBLIC_KEY: "public key",
      TAURI_UPDATER_ENDPOINT: "https://updates.example.test/stable/latest.json",
      TAURI_WINDOWS_CERTIFICATE_THUMBPRINT: "0123456789abcdef0123456789abcdef01234567",
      TAURI_WINDOWS_TIMESTAMP_URL: "https://timestamp.example.test/rfc3161",
    });

    expect(result.status).toBe(0);
    const config = JSON.parse(readFileSync(output, "utf8"));
    expect(config.bundle).toEqual({
      createUpdaterArtifacts: true,
      windows: {
        certificateThumbprint: "0123456789ABCDEF0123456789ABCDEF01234567",
        digestAlgorithm: "sha256",
        timestampUrl: "https://timestamp.example.test/rfc3161",
        tsp: true,
      },
    });
  });

  it("rejects incomplete or unsafe Windows PFX signing configuration", () => {
    const partial = runNode(configScript, [join(temporaryDirectory(), "config.json")], {
      TAURI_UPDATER_PUBLIC_KEY: "public key",
      TAURI_UPDATER_ENDPOINT: "https://updates.example.test/stable/latest.json",
      TAURI_WINDOWS_CERTIFICATE_THUMBPRINT: "0123456789abcdef0123456789abcdef01234567",
    });
    expect(partial.status).not.toBe(0);
    expect(partial.stderr).toContain("Set both");

    const invalidThumbprint = runNode(configScript, [join(temporaryDirectory(), "config.json")], {
      TAURI_UPDATER_PUBLIC_KEY: "public key",
      TAURI_UPDATER_ENDPOINT: "https://updates.example.test/stable/latest.json",
      TAURI_WINDOWS_CERTIFICATE_THUMBPRINT: "not-a-thumbprint",
      TAURI_WINDOWS_TIMESTAMP_URL: "http://timestamp.example.test/rfc3161",
    });
    expect(invalidThumbprint.status).not.toBe(0);
    expect(invalidThumbprint.stderr).toContain("40-character SHA-1");

    const unsafeTimestamp = runNode(configScript, [join(temporaryDirectory(), "config.json")], {
      TAURI_UPDATER_PUBLIC_KEY: "public key",
      TAURI_UPDATER_ENDPOINT: "https://updates.example.test/stable/latest.json",
      TAURI_WINDOWS_CERTIFICATE_THUMBPRINT: "0123456789abcdef0123456789abcdef01234567",
      TAURI_WINDOWS_TIMESTAMP_URL: "http://timestamp.example.test/rfc3161",
    });
    expect(unsafeTimestamp.status).not.toBe(0);
    expect(unsafeTimestamp.stderr).toContain("TAURI_WINDOWS_TIMESTAMP_URL must use HTTPS");
  });

  it("generates a complete static manifest with embedded signature text", () => {
    const dir = temporaryDirectory();
    const artifacts = join(dir, "artifacts");
    mkdirSync(artifacts);
    const tag = "v1.2.3";
    const files = [
      `forktail-${tag}-macos-universal.app.tar.gz`,
      `forktail-${tag}-windows-x64-setup.exe`,
      `forktail-${tag}-linux-x86_64.AppImage`,
    ];
    for (const file of files) {
      writeFileSync(join(artifacts, file), "artifact");
      writeFileSync(join(artifacts, `${file}.sig`), `signature:${file}\n`);
    }
    const output = join(dir, "latest.json");

    const result = runNode(manifestScript, [
      "--tag", tag,
      "--base-url", "https://updates.example.test/",
      "--artifacts-dir", artifacts,
      "--out", output,
      "--published-at", "2026-07-12T00:00:00Z",
      "--notes-file", writeNotes(dir),
    ]);

    expect(result.status).toBe(0);
    const manifest = JSON.parse(readFileSync(output, "utf8"));
    expect(manifest.version).toBe("1.2.3");
    expect(manifest.pub_date).toBe("2026-07-12T00:00:00.000Z");
    expect(Object.keys(manifest.platforms).sort()).toEqual([
      "darwin-aarch64",
      "darwin-x86_64",
      "linux-x86_64",
      "windows-x86_64",
    ]);
    expect(manifest.platforms["darwin-aarch64"]).toEqual(
      manifest.platforms["darwin-x86_64"],
    );
    expect(manifest.platforms["windows-x86_64"].signature).toBe(
      `signature:forktail-${tag}-windows-x64-setup.exe`,
    );
    expect(manifest.platforms["linux-x86_64"].url).toContain(
      "/releases/v1.2.3/artifacts/",
    );
  });

  it("fails before publication when a signature is missing", () => {
    const dir = temporaryDirectory();
    const artifacts = join(dir, "artifacts");
    mkdirSync(artifacts);
    const tag = "v1.2.3";
    for (const file of [
      `forktail-${tag}-macos-universal.app.tar.gz`,
      `forktail-${tag}-windows-x64-setup.exe`,
      `forktail-${tag}-linux-x86_64.AppImage`,
    ]) {
      writeFileSync(join(artifacts, file), "artifact");
    }

    const result = runNode(manifestScript, [
      "--tag", tag,
      "--base-url", "https://updates.example.test",
      "--artifacts-dir", artifacts,
      "--out", join(dir, "latest.json"),
    ]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(".sig");
  });

  it("rejects a non-RFC 3339 published timestamp", () => {
    const dir = temporaryDirectory();
    const artifacts = writeUpdaterArtifacts(dir, "v1.2.3");

    const result = runNode(manifestScript, [
      "--tag", "v1.2.3",
      "--base-url", "https://updates.example.test",
      "--artifacts-dir", artifacts,
      "--out", join(dir, "latest.json"),
      "--published-at", "2026-07-12",
    ]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("RFC 3339");
  });

  it("rejects an r2.dev base URL before writing a manifest", () => {
    const dir = temporaryDirectory();
    const artifacts = writeUpdaterArtifacts(dir, "v1.2.3");

    const result = runNode(manifestScript, [
      "--tag", "v1.2.3",
      "--base-url", "https://forktail-updates.r2.dev",
      "--artifacts-dir", artifacts,
      "--out", join(dir, "latest.json"),
    ]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("production custom domain");
  });

  it("allows only a strictly newer stable manifest promotion", () => {
    const dir = temporaryDirectory();
    const current = join(dir, "current.json");
    const candidate = join(dir, "candidate.json");
    writeManifest(current, "1.2.3");
    writeManifest(candidate, "1.2.4");

    const accepted = runNode(promotionScript, [
      "--candidate", candidate,
      "--current", current,
    ]);
    expect(accepted.status).toBe(0);
    expect(accepted.stdout).toContain("1.2.3 -> 1.2.4");

    writeManifest(candidate, "1.2.3");
    const sameVersion = runNode(promotionScript, [
      "--candidate", candidate,
      "--current", current,
    ]);
    expect(sameVersion.status).not.toBe(0);
    expect(sameVersion.stderr).toContain("strictly newer");

    writeManifest(candidate, "1.2.5-beta.1");
    const prerelease = runNode(promotionScript, [
      "--candidate", candidate,
      "--current", current,
    ]);
    expect(prerelease.status).not.toBe(0);
    expect(prerelease.stderr).toContain("prerelease manifest");
  });
});

function runNode(script: URL, args: string[], env: Record<string, string> = {}) {
  const result = spawnSync(process.execPath, [script.pathname, ...args], {
    cwd: projectRoot.pathname,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function temporaryDirectory(): string {
  const path = mkdtempSync(join(tmpdir(), "forktail-updater-test-"));
  temporaryDirectories.push(path);
  return path;
}

function writeNotes(dir: string): string {
  const path = join(dir, "notes.txt");
  writeFileSync(path, "Release notes\n");
  return path;
}

function writeUpdaterArtifacts(dir: string, tag: string): string {
  const artifacts = join(dir, "artifacts");
  mkdirSync(artifacts);
  for (const file of [
    `forktail-${tag}-macos-universal.app.tar.gz`,
    `forktail-${tag}-windows-x64-setup.exe`,
    `forktail-${tag}-linux-x86_64.AppImage`,
  ]) {
    writeFileSync(join(artifacts, file), "artifact");
    writeFileSync(join(artifacts, `${file}.sig`), "signature");
  }
  return artifacts;
}

function writeManifest(path: string, version: string): void {
  writeFileSync(path, JSON.stringify({ version }));
}
