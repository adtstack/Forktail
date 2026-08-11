/// <reference types="node" />

import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
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
const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const settingsSource = readFileSync(new URL("./settings.ts", import.meta.url), "utf8");
const mergeRecoverySource = readFileSync(
  new URL("./mergeRecovery.ts", import.meta.url),
  "utf8",
);
const gitModelsSource = readFileSync(new URL("./gitModels.ts", import.meta.url), "utf8");
const editorNavigationHistorySource = readFileSync(
  new URL("./editorNavigationHistory.ts", import.meta.url),
  "utf8",
);
const navigationInputSource = readFileSync(new URL("./navigationInput.ts", import.meta.url), "utf8");
const commandSource = readFileSync(new URL("./commands.ts", import.meta.url), "utf8");
const detachedReviewSource = readFileSync(
  new URL("../DetachedFolderReviewApp.tsx", import.meta.url),
  "utf8",
);
const detachedReviewNativeSource = readFileSync(
  new URL("../../src-tauri/src/detached_review.rs", import.meta.url),
  "utf8",
);
const detachedReviewCommandSource = readFileSync(
  new URL("../../src-tauri/src/commands/detached_review.rs", import.meta.url),
  "utf8",
);
const fileCompareSource = readFileSync(
  new URL("../components/FileCompareView.tsx", import.meta.url),
  "utf8",
);
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

  it("keeps persistent content writes inside the reviewed settings and recovery modules", () => {
    const storageWriters = runtimeSourceFiles()
      .filter((file) => readFileSync(file, "utf8").includes(".setItem("))
      .map(relativePolicyPath);

    expect(storageWriters).toEqual([
      "src/core/mergeRecovery.ts",
      "src/core/settings.ts",
    ]);
    expect(settingsSource).toContain('if (session.origin !== "files") return null;');
    expect(mergeRecoverySource).toContain('if (session.origin !== "files") return false;');
    expect(mergeRecoverySource).toContain('if (session.origin !== "files") return null;');
  });

  it("keeps bounded Git history metadata free of file content and commit bodies", () => {
    const historyModels = gitModelsSource.slice(
      gitModelsSource.indexOf("export interface GitRecentCommitEntry"),
      gitModelsSource.indexOf("export type GitTreeEntryKind"),
    );

    expect(historyModels).not.toMatch(/\b(text|content|body|diff|patch)\s*:/);
    expect(historyModels).toContain("subject: string;");
    expect(historyModels).toContain("opaquePathId: string;");
  });

  it("keeps editor navigation history process-only and content-free", () => {
    expect(editorNavigationHistorySource).not.toMatch(
      /\b(localStorage|indexedDB|serialize|deserialize|FileDocument|selectedText|surroundingText)\b/,
    );
    expect(editorNavigationHistorySource).not.toMatch(/\b(content|text|diff|mergeResult)\s*:/);
    expect(navigationInputSource).not.toMatch(/\b(localStorage|indexedDB|FileDocument)\b/);
    const commandEnvelope = commandSource.slice(
      commandSource.indexOf("export interface AppCommandEventDetail"),
      commandSource.indexOf("export type RuntimePlatform"),
    );
    expect(commandEnvelope).toContain("commandId: AppCommandId");
    expect(commandEnvelope).toContain("source?: AppCommandSource");
    expect(commandEnvelope).toContain("monotonicEventTime?: number");
    expect(commandEnvelope).not.toMatch(/\b(path|content|cursor|document|text)\b/i);
  });

  it("keeps detached review identity, routing, models, and persistence path-free", () => {
    expect(detachedReviewCommandSource).toContain(
      'DETACHED_FOLDER_REVIEW_ROUTE: &str = "index.html?surface=folder-review"',
    );
    expect(detachedReviewNativeSource).toContain('format!("folder-review-{session_id}")');
    expect(detachedReviewNativeSource).not.toContain("FileDocument");
    expect(detachedReviewSource).not.toMatch(/\.(?:setItem|removeItem)\s*\(/);
    expect(detachedReviewSource).toContain("persistViewSettings={false}");
    expect(fileCompareSource).toContain("detachedFolderReviewModelPath");
    expect(fileCompareSource).toContain("if (shouldPersistViewSettings)");
  });
});

function runtimeSourceFiles(): string[] {
  return runtimeSourceRoots.flatMap((root) => collectFiles(root));
}

function collectFiles(root: URL): string[] {
  return collectFilesFromPath(fileURLToPath(root));
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
  return relative(projectRoot, file).split(sep).join("/");
}
