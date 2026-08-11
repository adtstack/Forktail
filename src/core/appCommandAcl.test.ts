/// <reference types="node" />

import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("../../", import.meta.url);
const libSource = read("src-tauri/src/lib.rs");
const buildSource = read("src-tauri/build.rs");

const DETACHED_COMMANDS = [
  "load_detached_folder_review",
  "check_detached_folder_review_versions",
  "reload_detached_folder_review",
] as const;

describe("Tauri application command ACL", () => {
  it("keeps AppManifest commands in exact parity with generate_handler", () => {
    expect(manifestCommands(buildSource)).toEqual(handlerCommands(libSource));
  });

  it("grants every non-detached application command only to the main window", () => {
    const commands = handlerCommands(libSource);
    const mainCommands = permissionCommands("src-tauri/permissions/main-commands.toml");

    expect(mainCommands).toEqual(
      commands.filter((command) => !DETACHED_COMMANDS.includes(
        command as (typeof DETACHED_COMMANDS)[number],
      )),
    );
    expect(capability("src-tauri/capabilities/default.json")).toEqual({
      windows: ["main"],
      permissions: [
        "core:default",
        "dialog:allow-open",
        "dialog:allow-save",
        "main-commands",
      ],
    });
  });

  it("gives detached windows only caller-bound review and minimal event/close access", () => {
    expect(permissionCommands("src-tauri/permissions/detached-folder-review.toml"))
      .toEqual(DETACHED_COMMANDS);
    expect(capability("src-tauri/capabilities/detached-folder-review.json")).toEqual({
      windows: ["folder-review-*"],
      permissions: [
        "core:event:allow-listen",
        "core:event:allow-unlisten",
        "core:window:allow-close",
        "detached-folder-review",
      ],
    });
  });

  it("keeps main and detached label scopes disjoint and excludes broad child grants", () => {
    const main = capability("src-tauri/capabilities/default.json");
    const detached = capability("src-tauri/capabilities/detached-folder-review.json");
    const forbidden = [
      "core:default",
      "dialog:allow-open",
      "dialog:allow-save",
      "fs:default",
      "shell:default",
      "http:default",
      "opener:default",
      "main-commands",
    ];

    expect(main.windows).toEqual(["main"]);
    expect(detached.windows).toEqual(["folder-review-*"]);
    for (const permission of forbidden) {
      expect(detached.permissions).not.toContain(permission);
    }
  });
});

function read(relativePath: string): string {
  const path = new URL(relativePath, root);
  expect(existsSync(path), `missing ACL source: ${relativePath}`).toBe(true);
  return readFileSync(path, "utf8");
}

function quotedValues(source: string): string[] {
  return Array.from(source.matchAll(/"([a-z][a-z0-9_]*)"/g), (match) => match[1] ?? "");
}

function handlerCommands(source: string): string[] {
  const body = source.match(/tauri::generate_handler!\[([\s\S]*?)\]\)/)?.[1] ?? "";
  return Array.from(body.matchAll(/(?:^|,)\s*[a-z_]+::([a-z][a-z0-9_]*)/g), (match) =>
    match[1] ?? "");
}

function manifestCommands(source: string): string[] {
  const body = source.match(/APP_COMMANDS[^=]*=\s*&\[([\s\S]*?)\];/)?.[1] ?? "";
  return quotedValues(body);
}

function permissionCommands(relativePath: string): string[] {
  const body = read(relativePath).match(/commands\.allow\s*=\s*\[([\s\S]*?)\]/)?.[1] ?? "";
  return quotedValues(body);
}

function capability(relativePath: string): { windows: string[]; permissions: string[] } {
  const parsed = JSON.parse(read(relativePath)) as {
    windows?: string[];
    permissions?: string[];
  };
  return {
    windows: parsed.windows ?? [],
    permissions: parsed.permissions ?? [],
  };
}
