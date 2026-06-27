/// <reference types="node" />

import { readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import packageJson from "../../package.json";
import tauriConfig from "../../src-tauri/tauri.conf.json";

interface PackageManifest {
  name?: unknown;
}

interface TauriIdentityConfig {
  productName?: unknown;
  identifier?: unknown;
  app?: {
    windows?: Array<{
      title?: unknown;
    }>;
  };
  bundle?: {
    copyright?: unknown;
    icon?: unknown;
    targets?: unknown;
  };
}

const cargoManifest = readFileSync(new URL("../../src-tauri/Cargo.toml", import.meta.url), "utf8");
const indexHtml = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
const startPage = readFileSync(new URL("../components/StartPage.tsx", import.meta.url), "utf8");
const expectedDesktopIcons = [
  "icons/32x32.png",
  "icons/128x128.png",
  "icons/128x128@2x.png",
  "icons/icon.icns",
  "icons/icon.ico",
] as const;

describe("product identity", () => {
  it("keeps the desktop app named forktail across package metadata and UI shell", () => {
    const npmPackage = packageJson as PackageManifest;
    const tauri = tauriConfig as TauriIdentityConfig;

    expect(npmPackage.name).toBe("forktail");
    expect(tauri.productName).toBe("forktail");
    expect(tauri.identifier).toBe("dev.local.forktail");
    expect(tauri.app?.windows?.[0]?.title).toBe("forktail");
    expect(tauri.bundle?.copyright).toBe("Copyright (c) 2026 forktail contributors");
    expect(tauri.bundle?.targets).toEqual(["app"]);
    expect(tauri.bundle?.icon).toEqual([...expectedDesktopIcons]);

    expect(cargoManifest).toContain('name = "forktail"');
    expect(cargoManifest).toContain('name = "forktail_lib"');
    expect(cargoManifest).toContain('authors = ["forktail contributors"]');

    expect(indexHtml).toContain("<title>forktail</title>");
    expect(startPage).toContain("<h1>forktail</h1>");
  });

  it("keeps generated desktop icon assets available for bundling", () => {
    const sourceIcon = statSync(new URL("../../src-tauri/app-icon.svg", import.meta.url));
    expect(sourceIcon.size).toBeGreaterThan(0);

    for (const iconPath of expectedDesktopIcons) {
      const icon = statSync(new URL(`../../src-tauri/${iconPath}`, import.meta.url));
      expect(icon.size, iconPath).toBeGreaterThan(0);
    }
  });
});
