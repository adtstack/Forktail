/// <reference types="node" />

import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { describe, expect, it } from "vitest";
import packageJson from "../../package.json";

interface PackageManifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

const runtimeSourceRoots = [
  new URL("../", import.meta.url),
  new URL("../../src-tauri/src/", import.meta.url),
];
const runtimeExtensions = new Set([".ts", ".tsx", ".rs"]);
const forbiddenRuntimePatterns = [
  { label: "browser fetch", pattern: /\bfetch\s*\(/ },
  { label: "XMLHttpRequest", pattern: /\bXMLHttpRequest\b/ },
  { label: "WebSocket", pattern: /\bWebSocket\b/ },
  { label: "EventSource", pattern: /\bEventSource\b/ },
  { label: "sendBeacon", pattern: /\bsendBeacon\b/ },
  { label: "Tauri HTTP plugin", pattern: /\btauri_plugin_http\b|@tauri-apps\/plugin-http/ },
  { label: "Rust HTTP client", pattern: /\b(reqwest|ureq|hyper)\b/ },
  { label: "API key environment", pattern: /\b[A-Z0-9_]*API_KEY\b/ },
  { label: "OpenAI runtime", pattern: /\b(openai|OpenAI|OPENAI)\b/ },
  { label: "Anthropic runtime", pattern: /\b(anthropic|Anthropic|ANTHROPIC)\b/ },
];
const forbiddenDependencyNames = [
  /^@tauri-apps\/plugin-http$/,
  /^@tauri-apps\/plugin-updater$/,
  /^openai$/,
  /^@anthropic-ai\//,
  /^langchain$/,
  /^@langchain\//,
  /^ai$/,
  /^posthog-js$/,
  /^@sentry\//,
];

describe("network and AI policy", () => {
  it("does not include runtime network, telemetry, updater, or AI dependencies", () => {
    const manifest = packageJson as PackageManifest;
    const dependencyNames = [
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.devDependencies ?? {}),
    ];

    const forbidden = dependencyNames.filter((name) =>
      forbiddenDependencyNames.some((pattern) => pattern.test(name)),
    );

    expect(forbidden).toEqual([]);
  });

  it("does not call browser or Rust network APIs from runtime source", () => {
    const failures: string[] = [];

    for (const file of runtimeSourceFiles()) {
      const text = readFileSync(file, "utf8");
      for (const rule of forbiddenRuntimePatterns) {
        if (rule.pattern.test(text)) {
          failures.push(`${relativePolicyPath(file)}: ${rule.label}`);
        }
      }
    }

    expect(failures).toEqual([]);
  });

  it("keeps Phase 1 AI and telemetry language out of runtime UI strings", () => {
    const runtimeText = runtimeSourceFiles()
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");

    expect(runtimeText).not.toMatch(/\b(telemetry|analytics|Sentry|PostHog)\b/i);
    expect(runtimeText).not.toMatch(/\b(AI merge|LLM|prompt injection)\b/i);
  });
});

function runtimeSourceFiles(): string[] {
  return runtimeSourceRoots.flatMap((root) => collectFiles(root));
}

function collectFiles(root: URL): string[] {
  const rootPath = root.pathname;
  return collectFilesFromPath(rootPath);
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
