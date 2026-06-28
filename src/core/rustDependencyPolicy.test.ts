/// <reference types="node" />

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const cargoToml = readFileSync(new URL("../../src-tauri/Cargo.toml", import.meta.url), "utf8");
const cargoLock = readFileSync(new URL("../../src-tauri/Cargo.lock", import.meta.url), "utf8");

const rustDependencyPolicy = {
  "blake3": "CC0-1.0 OR Apache-2.0 OR Apache-2.0 WITH LLVM-exception",
  "chardetng": "Apache-2.0 OR MIT",
  "diffy": "MIT OR Apache-2.0",
  "encoding_rs": "(Apache-2.0 OR MIT) AND BSD-3-Clause",
  "ignore": "Unlicense OR MIT",
  "serde": "MIT OR Apache-2.0",
  "serde_json": "MIT OR Apache-2.0",
  "tauri": "Apache-2.0 OR MIT",
  "tauri-build": "Apache-2.0 OR MIT",
  "tauri-plugin-dialog": "Apache-2.0 OR MIT",
  "tempfile": "MIT OR Apache-2.0",
  "thiserror": "MIT OR Apache-2.0",
} as const;

const allowedLicenseExpressions = new Set<string>([
  "Apache-2.0 OR MIT",
  "MIT OR Apache-2.0",
  "(Apache-2.0 OR MIT) AND BSD-3-Clause",
  "CC0-1.0 OR Apache-2.0 OR Apache-2.0 WITH LLVM-exception",
  "Unlicense OR MIT",
]);

describe("Rust dependency policy", () => {
  it("requires every direct Rust dependency to be explicitly license-reviewed", () => {
    const directDependencyNames = directRustDependencyNames(cargoToml);
    expect(directDependencyNames).toEqual(Object.keys(rustDependencyPolicy).sort());

    const rejected = Object.entries(rustDependencyPolicy)
      .filter(([, license]) => !allowedLicenseExpressions.has(license))
      .map(([name, license]) => `${name}: ${license}`);
    expect(rejected).toEqual([]);
  });

  it("keeps direct Rust dependencies reproducible through Cargo.lock", () => {
    const lockedPackages = cargoLockPackages(cargoLock);
    const failures: string[] = [];

    for (const name of Object.keys(rustDependencyPolicy)) {
      const locked = lockedPackages.get(name);
      if (!locked) {
        failures.push(`${name}: missing from Cargo.lock`);
        continue;
      }
      if (!locked.source.startsWith("registry+https://github.com/rust-lang/crates.io-index")) {
        failures.push(`${name}: unexpected source ${locked.source}`);
      }
      if (!locked.version.match(/^\d+\.\d+\.\d+/)) {
        failures.push(`${name}: invalid version ${locked.version}`);
      }
    }

    expect(failures).toEqual([]);
  });
});

function directRustDependencyNames(text: string): string[] {
  return [
    ...sectionDependencyNames(text, "dependencies"),
    ...sectionDependencyNames(text, "build-dependencies"),
  ].sort();
}

function sectionDependencyNames(text: string, section: string): string[] {
  const start = text.indexOf(`[${section}]`);
  if (start === -1) return [];
  const rest = text.slice(start + section.length + 2);
  const end = rest.search(/^\[/m);
  const body = end === -1 ? rest : rest.slice(0, end);

  return body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => line.match(/^([A-Za-z0-9_-]+)\s*=/)?.[1])
    .filter((name): name is string => Boolean(name))
    .sort();
}

function cargoLockPackages(text: string): Map<string, { version: string; source: string }> {
  const packages = new Map<string, { version: string; source: string }>();
  for (const block of text.split("[[package]]").slice(1)) {
    const name = fieldValue(block, "name");
    const version = fieldValue(block, "version");
    const source = fieldValue(block, "source");
    if (name && version && source && !packages.has(name)) {
      packages.set(name, { version, source });
    }
  }
  return packages;
}

function fieldValue(block: string, field: string): string | null {
  return block.match(new RegExp(`^${field} = "([^"]+)"`, "m"))?.[1] ?? null;
}
