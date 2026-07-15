#!/usr/bin/env node

/**
 * Generates the static JSON consumed by tauri-plugin-updater.
 *
 * The signatures embedded in this file are the contents of the generated
 * .sig files, never URLs. All supported platform entries are validated before
 * the manifest is written because Tauri validates the entire document.
 *
 * Usage:
 *   node scripts/generate-updater-manifest.mjs \
 *     --tag vX.Y.Z \
 *     --base-url https://updates.example.com \
 *     --artifacts-dir /path/to/artifacts \
 *     --out /path/to/latest.json \
 *     [--notes-file /path/to/notes.txt] \
 *     [--published-at 2026-01-01T00:00:00Z]
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const args = parseArgs(process.argv.slice(2));
const tag = requiredArg(args, "tag");
const version = releaseVersion(tag);
const baseUrl = normalizeBaseUrl(requiredArg(args, "base-url"));
const artifactsDir = resolve(requiredArg(args, "artifacts-dir"));
const outputPath = resolve(requiredArg(args, "out"));
const publishedAt = parsePublishedAt(args.get("published-at") ?? new Date().toISOString());
const notes = args.has("notes-file")
  ? readRequiredText(resolve(requiredArg(args, "notes-file")), "release notes")
  : "";

const artifactNames = {
  macos: `forktail-${tag}-macos-universal.app.tar.gz`,
  windows: `forktail-${tag}-windows-x64-setup.exe`,
  linux: `forktail-${tag}-linux-x86_64.AppImage`,
};

const macosSignature = signatureFor(artifactNames.macos);
const windowsSignature = signatureFor(artifactNames.windows);
const linuxSignature = signatureFor(artifactNames.linux);

const manifest = {
  version,
  notes,
  pub_date: publishedAt,
  platforms: {
    "darwin-aarch64": platformEntry(artifactNames.macos, macosSignature),
    "darwin-x86_64": platformEntry(artifactNames.macos, macosSignature),
    "windows-x86_64": platformEntry(artifactNames.windows, windowsSignature),
    "linux-x86_64": platformEntry(artifactNames.linux, linuxSignature),
  },
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

function platformEntry(name, signature) {
  return {
    url: `${baseUrl}/releases/${tag}/artifacts/${encodeURIComponent(name)}`,
    signature,
  };
}

function signatureFor(artifactName) {
  const artifactPath = resolve(artifactsDir, artifactName);
  const signaturePath = `${artifactPath}.sig`;
  if (!existsSync(artifactPath)) {
    fail(`Missing updater artifact: ${artifactName}`);
  }
  return readRequiredText(signaturePath, `${artifactName}.sig`);
}

function parseArgs(values) {
  const parsed = new Map();
  for (let index = 0; index < values.length; index += 2) {
    const flag = values[index];
    const value = values[index + 1];
    if (!flag?.startsWith("--") || value == null || value.startsWith("--")) {
      fail("Use --tag, --base-url, --artifacts-dir and --out with values.");
    }
    const key = flag.slice(2);
    if (parsed.has(key)) fail(`Duplicate argument: ${flag}`);
    parsed.set(key, value);
  }
  return parsed;
}

function requiredArg(args, key) {
  const value = args.get(key)?.trim();
  if (!value) fail(`Missing required --${key} argument.`);
  return value;
}

function releaseVersion(tag) {
  if (!/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(tag)) {
    fail(`Release tag must look like vX.Y.Z, got ${tag}.`);
  }
  return tag.slice(1);
}

function normalizeBaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail("--base-url must be a valid HTTPS URL.");
  }
  if (url.protocol !== "https:") fail("--base-url must use HTTPS.");
  if (url.username || url.password || url.search || url.hash) {
    fail("--base-url must not contain credentials, query parameters or fragments.");
  }
  if (url.hostname === "r2.dev" || url.hostname.endsWith(".r2.dev")) {
    fail("--base-url must use a production custom domain, not an r2.dev development URL.");
  }
  return url.toString().replace(/\/$/, "");
}

function parsePublishedAt(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    fail("--published-at must be an RFC 3339 timestamp with a timezone.");
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    fail("--published-at must be an RFC 3339 timestamp.");
  }
  return date.toISOString();
}

function readRequiredText(path, label) {
  if (!existsSync(path)) fail(`Missing ${label}: ${path}`);
  const value = readFileSync(path, "utf8").trim();
  if (!value) fail(`${label} must not be empty.`);
  return value;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
