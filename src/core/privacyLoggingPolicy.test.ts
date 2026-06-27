/// <reference types="node" />

import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { describe, expect, it } from "vitest";
import packageJson from "../../package.json";
import cargoManifest from "../../src-tauri/Cargo.toml?raw";

interface PackageManifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

const runtimeSourceRoots = [
  new URL("../", import.meta.url),
  new URL("../../src-tauri/src/", import.meta.url),
];
const runtimeExtensions = new Set([".ts", ".tsx", ".rs"]);
const forbiddenRuntimeLogPatterns = [
  { label: "browser console logging", pattern: /\bconsole\.(debug|info|log|warn|error)\s*\(/ },
  { label: "Rust stdout logging", pattern: /\bprintln!\s*\(/ },
  { label: "Rust stderr logging", pattern: /\beprintln!\s*\(/ },
  { label: "Rust debug macro", pattern: /\bdbg!\s*\(/ },
  { label: "Rust tracing macro", pattern: /\btracing::(debug|info|warn|error|trace)!\s*\(/ },
  { label: "Rust log macro", pattern: /\blog::(debug|info|warn|error|trace)!\s*\(/ },
];
const forbiddenNpmLoggingDependencies = [
  /^@tauri-apps\/plugin-log$/,
  /^@sentry\//,
  /^posthog-js$/,
  /^logrocket$/,
];
const forbiddenCargoLoggingDependencies = [
  /\btauri-plugin-log\s*=/,
  /\bsentry\s*=/,
  /\btracing-subscriber\s*=/,
];

describe("privacy logging policy", () => {
  it("keeps runtime source free of ad hoc logging calls", () => {
    const failures: string[] = [];

    for (const file of runtimeSourceFiles()) {
      const text = readFileSync(file, "utf8");
      for (const rule of forbiddenRuntimeLogPatterns) {
        if (rule.pattern.test(text)) {
          failures.push(`${relativePolicyPath(file)}: ${rule.label}`);
        }
      }
    }

    expect(failures).toEqual([]);
  });

  it("does not add logging, crash reporting, or telemetry dependencies", () => {
    const manifest = packageJson as PackageManifest;
    const npmDependencyNames = [
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.devDependencies ?? {}),
    ];
    const forbiddenNpm = npmDependencyNames.filter((name) =>
      forbiddenNpmLoggingDependencies.some((pattern) => pattern.test(name)),
    );
    const forbiddenCargo = forbiddenCargoLoggingDependencies
      .filter((pattern) => pattern.test(cargoManifest))
      .map((pattern) => pattern.source);

    expect(forbiddenNpm).toEqual([]);
    expect(forbiddenCargo).toEqual([]);
  });
});

function runtimeSourceFiles(): string[] {
  return runtimeSourceRoots.flatMap((root) => collectFiles(root));
}

function collectFiles(root: URL): string[] {
  return collectFilesFromPath(root.pathname);
}

function collectFilesFromPath(rootPath: string): string[] {
  const stats = statSync(rootPath);
  if (stats.isFile()) {
    if (!runtimeExtensions.has(extname(rootPath))) return [];
    if (rootPath.endsWith(".test.ts") || rootPath.endsWith(".test.tsx")) return [];
    return [rootPath];
  }

  return readdirSync(rootPath)
    .flatMap((name) => collectFilesFromPath(join(rootPath, name)))
    .sort((left, right) => left.localeCompare(right));
}

function relativePolicyPath(file: string): string {
  const marker = "/forktail/";
  const index = file.indexOf(marker);
  return index === -1 ? file : file.slice(index + marker.length);
}
