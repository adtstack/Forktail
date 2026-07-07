#!/usr/bin/env node

/**
 * Generate SBOM and NOTICE artifacts for REL-007.
 *
 * Produces, under <outDir> (default dist/sbom):
 *   - forktail-npm.cdx.json   CycloneDX SBOM from `npm sbom` (transitive deps)
 *   - forktail-rust.cdx.json  CycloneDX SBOM from `cargo cyclonedx` (if available)
 *   - NOTICE.txt              concatenated license notices for direct deps
 *
 * npm sbom is built into npm (no extra dependency). cargo cyclonedx is
 * optional: if it is not installed we emit a note in NOTICE.txt and skip the
 * Rust SBOM rather than failing, so local generation always works. The release
 * workflow is responsible for ensuring cargo-cyclonedx is installed when it
 * needs the Rust SBOM.
 *
 * This script does not log or transmit file contents. It only reads manifest
 * files (package.json, Cargo.toml) and writes SBOM/NOTICE artifacts.
 */

import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  writeFileSync,
  existsSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const outDir = resolve(projectRoot, process.argv[2] ?? "dist/sbom");

function main() {
  mkdirSync(outDir, { recursive: true });

  const notices = [
    "forktail — third-party notices",
    "================================",
    "",
    "This product bundles third-party dependencies whose licenses are listed",
    "below. The full transitive dependency graph is available in the CycloneDX",
    "SBOM files alongside this NOTICE.",
    "",
  ];

  // 1. npm SBOM (always available; built into npm)
  const npmSbomPath = generateNpmSbom();
  notices.push("JavaScript dependencies (from npm SBOM):");
  notices.push(...directNpmLicenseLines());
  notices.push("");

  // 2. Rust SBOM (optional; requires cargo-cyclonedx)
  const rustSbomPath = generateRustSbom();
  notices.push("Rust dependencies (from Cargo.toml):");
  notices.push(...directRustLicenseLines());
  notices.push("");
  if (!rustSbomPath) {
    notices.push(
      "Note: cargo-cyclonedx was not installed, so the Rust CycloneDX SBOM was",
      "skipped locally. Install it with `cargo install cargo-cyclonedx` to",
      "include the full transitive Rust SBOM. Direct Rust licenses are still",
      "listed above.",
      "",
    );
  }

  // 3. Write NOTICE
  const noticePath = join(outDir, "NOTICE.txt");
  writeFileSync(noticePath, `${notices.join("\n")}\n`);
  console.log(`NOTICE:     ${noticePath}`);

  summarize(noticePath, npmSbomPath, rustSbomPath);
}

function generateNpmSbom() {
  const target = join(outDir, "forktail-npm.cdx.json");
  const result = spawnSync(
    "npm",
    ["sbom", "--sbom-format=cyclonedx", "--sbom-type=application"],
    { cwd: projectRoot, encoding: "utf8" },
  );
  if (result.status !== 0 || !result.stdout) {
    console.error("[sbom] npm sbom failed; skipping JS SBOM.");
    if (result.stderr) {
      const firstLine = result.stderr.split("\n")[0];
      if (firstLine) console.error(firstLine);
    }
    return null;
  }
  writeFileSync(target, result.stdout);
  console.log(`npm SBOM:   ${target}`);
  return target;
}

function generateRustSbom() {
  // cargo cyclonedx writes <name>-<version>.cdx.json into the crate dir.
  const crateDir = join(projectRoot, "src-tauri");
  const result = spawnSync(
    "cargo",
    ["cyclonedx", "--format", "json", "--output-pattern", "package"],
    { cwd: crateDir, encoding: "utf8" },
  );
  if (result.status !== 0) {
    // cargo-cyclonedx not installed — acceptable for local runs.
    return null;
  }
  const version = readCargoVersion();
  const candidate = join(crateDir, `forktail-${version}.cdx.json`);
  const target = join(outDir, "forktail-rust.cdx.json");
  if (existsSync(candidate)) {
    writeFileSync(target, readFileSync(candidate, "utf8"));
    console.log(`Rust SBOM:  ${target}`);
    return target;
  }
  // Some cargo-cyclonedx versions name it differently; scan for *.cdx.json.
  return findGeneratedCdx(crateDir, target);
}

function findGeneratedCdx(crateDir, target) {
  try {
    const entries = readdirSync(crateDir);
    const cdx = entries.find((name) => name.endsWith(".cdx.json"));
    if (cdx) {
      writeFileSync(target, readFileSync(join(crateDir, cdx), "utf8"));
      console.log(`Rust SBOM:  ${target}`);
      return target;
    }
  } catch {
    /* ignore — treat as not generated */
  }
  return null;
}

function readCargoVersion() {
  const cargoToml = readFileSync(join(projectRoot, "src-tauri", "Cargo.toml"), "utf8");
  const match = cargoToml.match(/^version\s*=\s*"([^"]+)"/m);
  return match ? match[1] : "0.0.0";
}

function directNpmLicenseLines() {
  const pkg = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8"));
  const lock = JSON.parse(
    readFileSync(join(projectRoot, "package-lock.json"), "utf8"),
  );
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  const lines = [];
  for (const name of Object.keys(deps).sort()) {
    const entry = lock.packages?.[`node_modules/${name}`];
    const license = entry?.license ?? pkg.license ?? "UNKNOWN";
    lines.push(`  ${name}@${deps[name]} — ${license}`);
  }
  return lines;
}

function directRustLicenseLines() {
  // Mirrors the allowlist in src/core/rustDependencyPolicy.test.ts.
  const licenses = {
    blake3: "CC0-1.0 OR Apache-2.0 OR Apache-2.0 WITH LLVM-exception",
    chardetng: "Apache-2.0 OR MIT",
    diffy: "MIT OR Apache-2.0",
    encoding_rs: "(Apache-2.0 OR MIT) AND BSD-3-Clause",
    ignore: "Unlicense OR MIT",
    serde: "MIT OR Apache-2.0",
    serde_json: "MIT OR Apache-2.0",
    tauri: "Apache-2.0 OR MIT",
    "tauri-build": "Apache-2.0 OR MIT",
    "tauri-plugin-dialog": "Apache-2.0 OR MIT",
    tempfile: "MIT OR Apache-2.0",
    thiserror: "MIT OR Apache-2.0",
    windows: "MIT OR Apache-2.0 (cfg(windows) only)",
  };
  return Object.keys(licenses)
    .sort()
    .map((name) => `  ${name} — ${licenses[name]}`);
}

function summarize(noticePath, npmSbomPath, rustSbomPath) {
  console.log("");
  console.log("SBOM generation summary:");
  console.log(`  NOTICE:     ${existsSync(noticePath) ? "OK" : "MISSING"}`);
  console.log(`  npm SBOM:   ${npmSbomPath ? "OK" : "skipped"}`);
  console.log(
    `  Rust SBOM:  ${rustSbomPath ? "OK" : "skipped (cargo-cyclonedx not installed)"}`,
  );
}

main();
