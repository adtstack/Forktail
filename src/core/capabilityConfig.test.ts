import { describe, expect, it } from "vitest";
import packageJson from "../../package.json";
import defaultCapability from "../../src-tauri/capabilities/default.json";
import detachedCapability from "../../src-tauri/capabilities/detached-folder-review.json";

interface TauriCapability {
  windows?: unknown;
  permissions?: unknown;
}

const capability = defaultCapability as TauriCapability;

describe("Tauri capability minimum", () => {
  it("scopes permissions to the main window only", () => {
    expect(capability.windows).toEqual(["main"]);
  });

  it("allows only core defaults and dialog open/save permissions", () => {
    expect(capability.permissions).toEqual([
      "core:default",
      "dialog:allow-open",
      "dialog:allow-save",
      "main-commands",
    ]);
  });

  it("keeps detached folder review on a non-overlapping read-only capability", () => {
    expect(detachedCapability.windows).toEqual(["folder-review-*"]);
    expect(detachedCapability.permissions).toEqual([
      "core:event:allow-listen",
      "core:event:allow-unlisten",
      "core:window:allow-close",
      "detached-folder-review",
    ]);
    expect(detachedCapability.permissions).not.toContain("core:default");
    expect(detachedCapability.permissions).not.toContain("dialog:allow-open");
    expect(detachedCapability.permissions).not.toContain("dialog:allow-save");
  });

  it("does not grant broad filesystem, shell, http, or opener plugin permissions", () => {
    const permissions = capability.permissions;
    expect(Array.isArray(permissions)).toBe(true);
    expect(permissions).not.toContain("fs:default");
    expect(permissions).not.toContain("shell:default");
    expect(permissions).not.toContain("http:default");
    expect(permissions).not.toContain("opener:default");
  });

  it("does not depend on broad file-system or network Tauri plugins", () => {
    const dependencies = Object.keys(packageJson.dependencies);
    expect(dependencies).toContain("@tauri-apps/plugin-dialog");
    expect(dependencies).not.toContain("@tauri-apps/plugin-fs");
    expect(dependencies).not.toContain("@tauri-apps/plugin-shell");
    expect(dependencies).not.toContain("@tauri-apps/plugin-http");
    expect(dependencies).not.toContain("@tauri-apps/plugin-opener");
  });
});
