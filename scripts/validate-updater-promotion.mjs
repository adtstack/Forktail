#!/usr/bin/env node

/**
 * Refuses an unsafe stable/latest.json promotion. The publisher calls this
 * after reading the existing manifest directly from R2 and before its
 * conditional PutObject request. A new manifest must be a strictly higher
 * stable SemVer version; rerunning or backfilling an existing tag is not
 * allowed because versioned artifacts are immutable.
 *
 * Usage:
 *   node scripts/validate-updater-promotion.mjs \
 *     --candidate /path/to/new-latest.json \
 *     [--current /path/to/existing-latest.json]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const args = parseArgs(process.argv.slice(2));
const candidate = readManifest(requiredArg(args, "candidate"), "candidate");
const candidateVersion = parseSemver(candidate.version, "candidate");

if (candidateVersion.prerelease.length > 0) {
  fail("A prerelease manifest must not be promoted to stable/latest.json.");
}

const currentPath = args.get("current");
if (!currentPath) {
  console.log(`Initial stable promotion accepted: ${candidate.version}.`);
  process.exit(0);
}

const current = readManifest(currentPath, "current");
const currentVersion = parseSemver(current.version, "current");
const comparison = compareSemver(candidateVersion, currentVersion);

if (comparison <= 0) {
  fail(
    `Refusing stable manifest promotion from ${current.version} to ${candidate.version}; the candidate must be strictly newer.`,
  );
}

console.log(`Stable promotion accepted: ${current.version} -> ${candidate.version}.`);

function readManifest(path, label) {
  const target = resolve(path);
  if (!existsSync(target)) fail(`Missing ${label} manifest: ${target}`);

  let value;
  try {
    value = JSON.parse(readFileSync(target, "utf8"));
  } catch {
    fail(`${label} manifest must be valid JSON.`);
  }
  if (!value || typeof value !== "object" || typeof value.version !== "string") {
    fail(`${label} manifest must contain a string version.`);
  }
  return value;
}

function parseArgs(values) {
  const parsed = new Map();
  for (let index = 0; index < values.length; index += 2) {
    const flag = values[index];
    const value = values[index + 1];
    if (!flag?.startsWith("--") || value == null || value.startsWith("--")) {
      fail("Use --candidate and optional --current with values.");
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

function parseSemver(value, label) {
  const match = value.match(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/,
  );
  if (!match) fail(`${label} manifest version must be valid SemVer, got ${value}.`);

  const prerelease = match[4] ? match[4].split(".") : [];
  if (prerelease.some((identifier) => /^\d+$/.test(identifier) && !/^(0|[1-9]\d*)$/.test(identifier))) {
    fail(`${label} manifest version has a prerelease identifier with a leading zero.`);
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease,
  };
}

function compareSemver(left, right) {
  for (const field of ["major", "minor", "patch"]) {
    if (left[field] !== right[field]) return left[field] > right[field] ? 1 : -1;
  }

  if (left.prerelease.length === 0 && right.prerelease.length > 0) return 1;
  if (left.prerelease.length > 0 && right.prerelease.length === 0) return -1;

  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftIdentifier = left.prerelease[index];
    const rightIdentifier = right.prerelease[index];
    if (leftIdentifier === undefined) return -1;
    if (rightIdentifier === undefined) return 1;
    if (leftIdentifier === rightIdentifier) continue;

    const leftNumeric = /^\d+$/.test(leftIdentifier);
    const rightNumeric = /^\d+$/.test(rightIdentifier);
    if (leftNumeric && rightNumeric) {
      return Number(leftIdentifier) > Number(rightIdentifier) ? 1 : -1;
    }
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftIdentifier > rightIdentifier ? 1 : -1;
  }

  return 0;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
