/// <reference types="node" />

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import packageJson from "../../package.json";
import defaultCapability from "../../src-tauri/capabilities/default.json";
import detachedCapability from "../../src-tauri/capabilities/detached-folder-review.json";
import tauriConfig from "../../src-tauri/tauri.conf.json";

interface TauriSecurityConfig {
  app?: {
    security?: {
      csp?: unknown;
      devCsp?: unknown;
    };
  };
}

const config = tauriConfig as TauriSecurityConfig;
const rustEntrySource = readFileSync(new URL("../../src-tauri/src/lib.rs", import.meta.url), "utf8");
const completeGitRunnerSource = readFileSync(
  new URL("../../src-tauri/src/git/runner.rs", import.meta.url),
  "utf8",
);
const gitRunnerSource = completeGitRunnerSource.slice(
  0,
  completeGitRunnerSource.lastIndexOf("#[cfg(test)]\nmod tests"),
);

describe("Tauri security config", () => {
  it("pins a release CSP instead of disabling it", () => {
    const csp = config.app?.security?.csp;

    expect(typeof csp).toBe("string");
    expect(csp).not.toBe("");
    expect(csp).not.toBeNull();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("worker-src 'self' blob:");
    expect(csp).toContain("connect-src ipc: http://ipc.localhost");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toContain("https:");
    expect(csp).not.toContain("http://localhost:1420");
  });

  it("keeps development-only server allowances out of release CSP", () => {
    const csp = config.app?.security?.csp as string;
    const devCsp = config.app?.security?.devCsp;

    expect(typeof devCsp).toBe("string");
    expect(devCsp).toContain("http://localhost:1420");
    expect(devCsp).toContain("ws://localhost:1420");
    expect(csp).not.toContain("ws://localhost:1420");
  });

  it("keeps desktop permissions and plugins on the reviewed minimum", () => {
    expect(defaultCapability.windows).toEqual(["main"]);
    expect(defaultCapability.permissions).toEqual([
      "core:default",
      "dialog:allow-open",
      "dialog:allow-save",
      "main-commands",
    ]);
    expect(detachedCapability.windows).toEqual(["folder-review-*"]);
    expect(detachedCapability.permissions).toEqual([
      "core:event:allow-listen",
      "core:event:allow-unlisten",
      "core:window:allow-close",
      "detached-folder-review",
    ]);
    expect(detachedCapability.permissions).not.toContain("core:default");

    const dependencies = Object.keys(packageJson.dependencies);
    for (const plugin of [
      "@tauri-apps/plugin-fs",
      "@tauri-apps/plugin-http",
      "@tauri-apps/plugin-opener",
      "@tauri-apps/plugin-process",
      "@tauri-apps/plugin-shell",
      "@tauri-apps/plugin-updater",
    ]) {
      expect(dependencies).not.toContain(plugin);
    }
  });

  it("exposes typed Git commands without a generic shell or Git escape hatch", () => {
    expect(rustEntrySource).not.toMatch(/run_(?:shell|git)_command|execute_(?:shell|git)/);
    expect(gitRunnerSource).toContain("Command::new(&plan.executable)");
    expect(gitRunnerSource).not.toMatch(/Command::new\(["'](?:sh|bash|zsh|cmd|powershell)/);
    expect(gitRunnerSource).not.toMatch(/\.arg\(["'](?:-c|\/C)["']\)/);
  });
});
