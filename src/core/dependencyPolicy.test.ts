/// <reference types="node" />

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import packageLock from "../../package-lock.json";
import packageJson from "../../package.json";

interface PackageManifest {
  name?: unknown;
  private?: unknown;
  version?: unknown;
  license?: unknown;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface LockPackage {
  version?: unknown;
  license?: unknown;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface PackageLock {
  name?: unknown;
  version?: unknown;
  lockfileVersion?: unknown;
  packages?: Record<string, LockPackage>;
}

interface InstalledPackage {
  version?: unknown;
  license?: unknown;
}

const npmPackage = packageJson as PackageManifest;
const npmLock = packageLock as PackageLock;
const directDependencyLicenses = new Set([
  "MIT",
  "Apache-2.0",
  "MIT OR Apache-2.0",
  "Apache-2.0 OR MIT",
  "(MIT OR Apache-2.0)",
  "(Apache-2.0 OR MIT)",
]);

const dependencies = npmPackage.dependencies ?? {};
const devDependencies = npmPackage.devDependencies ?? {};

function directDependencyNames(): string[] {
  return Object.keys({ ...dependencies, ...devDependencies }).sort();
}

function readInstalledPackage(name: string): InstalledPackage {
  const packageUrl = new URL(`../../node_modules/${name}/package.json`, import.meta.url);
  return JSON.parse(readFileSync(packageUrl, "utf8")) as InstalledPackage;
}

function licenseText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

describe("JavaScript dependency policy", () => {
  it("keeps npm dependencies reproducible through the committed lockfile", () => {
    const rootPackage = npmLock.packages?.[""];

    expect(npmPackage.private).toBe(true);
    expect(npmPackage.license).toBe("MIT");
    expect(npmLock.name).toBe(npmPackage.name);
    expect(npmLock.version).toBe(npmPackage.version);
    expect(npmLock.lockfileVersion).toBe(3);
    expect(rootPackage?.license).toBe("MIT");
    expect(rootPackage?.dependencies ?? {}).toEqual(dependencies);
    expect(rootPackage?.devDependencies ?? {}).toEqual(devDependencies);
  });

  it("keeps direct npm dependency licenses inside the Phase 1 allowlist", () => {
    const failures: string[] = [];

    for (const name of directDependencyNames()) {
      const lockEntry = npmLock.packages?.[`node_modules/${name}`];
      const installed = readInstalledPackage(name);
      const lockLicense = licenseText(lockEntry?.license);
      const installedLicense = licenseText(installed.license);

      if (!lockEntry) {
        failures.push(`${name}: missing from package-lock.json`);
        continue;
      }

      if (lockEntry.version !== installed.version) {
        failures.push(`${name}: package-lock version ${lockEntry.version} != installed ${installed.version}`);
      }

      if (lockLicense && lockLicense !== installedLicense) {
        failures.push(`${name}: package-lock license ${lockLicense} != installed ${installedLicense}`);
      }

      if (!directDependencyLicenses.has(installedLicense)) {
        failures.push(`${name}: license ${installedLicense || "<missing>"} is not allowlisted`);
      }
    }

    expect(failures).toEqual([]);
  });

  it("wires SBOM/NOTICE generation into the release pipeline (REL-007)", () => {
    // The release workflow must generate and publish SBOM + NOTICE so that
    // every published release carries a reproducible dependency inventory.
    expect(npmPackage.scripts?.["sbom:generate"]).toBe(
      "node scripts/generate-sbom.mjs",
    );

    // The release workflow references the SBOM step and uploads the artifacts.
    const releaseWorkflow = readFileSync(
      new URL("../../.github/workflows/release.yml", import.meta.url),
      "utf8",
    );
    expect(releaseWorkflow).toContain("Generate SBOM and NOTICE artifacts (REL-007)");
    expect(releaseWorkflow).toContain("npm run sbom:generate");
    expect(releaseWorkflow).toContain("Upload SBOM artifacts");
    // The draft release notes must disclose the SBOM/NOTICE files.
    expect(releaseWorkflow).toContain("SBOM and NOTICE (REL-007)");
  });
});
