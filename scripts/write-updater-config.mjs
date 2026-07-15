#!/usr/bin/env node

/**
 * Creates the ephemeral Tauri config overlay used only by signed updater
 * release builds. The updater public key and endpoint are intentionally not
 * written to the repository: the resulting overlay lives under RUNNER_TEMP.
 *
 * Required environment:
 *   TAURI_UPDATER_PUBLIC_KEY  Tauri updater public-key content (not a path)
 *   TAURI_UPDATER_ENDPOINT    HTTPS static manifest URL
 *
 * Required for the production Windows PFX signing path:
 *   TAURI_WINDOWS_CERTIFICATE_THUMBPRINT  SHA-1 thumbprint in the runner store
 *   TAURI_WINDOWS_TIMESTAMP_URL            HTTPS RFC 3161 timestamp URL
 *
 * Usage:
 *   node scripts/write-updater-config.mjs /absolute/path/to/overlay.json
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const outputPath = process.argv[2];

if (!outputPath) {
  fail("Usage: node scripts/write-updater-config.mjs <output-path>");
}

const pubkey = requiredEnv("TAURI_UPDATER_PUBLIC_KEY");
const endpoint = normalizeHttpsUrl(requiredEnv("TAURI_UPDATER_ENDPOINT"));
rejectR2DevelopmentHost(endpoint, "TAURI_UPDATER_ENDPOINT");
const windows = windowsSigningConfig();
const target = resolve(outputPath);

const overlay = {
  bundle: {
    createUpdaterArtifacts: true,
    ...(windows ? { windows } : {}),
  },
  plugins: {
    updater: {
      pubkey,
      endpoints: [endpoint],
      windows: {
        installMode: "passive",
      },
    },
  },
};

mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, `${JSON.stringify(overlay, null, 2)}\n`, "utf8");

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) fail(`Set ${name} for the signed updater build.`);
  return value;
}

function normalizeHttpsUrl(value, name = "TAURI_UPDATER_ENDPOINT") {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail(`${name} must be a valid HTTPS URL.`);
  }

  if (url.protocol !== "https:") {
    fail(`${name} must use HTTPS.`);
  }
  if (url.username || url.password || url.search || url.hash) {
    fail(`${name} must not contain credentials, query parameters or a fragment.`);
  }

  return url.toString();
}

function windowsSigningConfig() {
  const thumbprint = optionalEnv("TAURI_WINDOWS_CERTIFICATE_THUMBPRINT");
  const timestampUrl = optionalEnv("TAURI_WINDOWS_TIMESTAMP_URL");

  if (Boolean(thumbprint) !== Boolean(timestampUrl)) {
    fail(
      "Set both TAURI_WINDOWS_CERTIFICATE_THUMBPRINT and TAURI_WINDOWS_TIMESTAMP_URL for Windows signing.",
    );
  }
  if (!thumbprint) return null;
  if (!/^[0-9A-Fa-f]{40}$/.test(thumbprint)) {
    fail("TAURI_WINDOWS_CERTIFICATE_THUMBPRINT must be a 40-character SHA-1 thumbprint.");
  }

  return {
    certificateThumbprint: thumbprint.toUpperCase(),
    digestAlgorithm: "sha256",
    timestampUrl: normalizeHttpsUrl(timestampUrl, "TAURI_WINDOWS_TIMESTAMP_URL"),
    tsp: true,
  };
}

function rejectR2DevelopmentHost(value, name) {
  const hostname = new URL(value).hostname.toLowerCase();
  if (hostname === "r2.dev" || hostname.endsWith(".r2.dev")) {
    fail(`${name} must use a production custom domain, not an r2.dev development URL.`);
  }
}

function optionalEnv(name) {
  return process.env[name]?.trim() ?? "";
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
