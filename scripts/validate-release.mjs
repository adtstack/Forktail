import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSemver } from "./semver.mjs";

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliTag = process.argv[2]?.startsWith("--") ? undefined : process.argv[2];
const tag = cliTag ?? process.env.RELEASE_TAG ?? process.env.GITHUB_REF_NAME;

try {
  const root = parseRoot(cliTag ? process.argv.slice(3) : process.argv.slice(2));
  validateRelease(tag, root);
} catch (error) {
  fail(errorMessage(error));
}

function validateRelease(releaseTag, root) {
  if (!releaseTag) {
    throw new Error("Set RELEASE_TAG or run this script from a GitHub tag workflow.");
  }
  if (!releaseTag.startsWith("v")) {
    throw new Error(
      `Release tag must look like vX.Y.Z or vX.Y.Z-prerelease and must start with v, got ${releaseTag}.`,
    );
  }

  const expectedVersion = releaseTag.slice(1);
  try {
    parseSemver(expectedVersion, "Release tag version");
  } catch (error) {
    throw new Error(
      `Release tag must look like vX.Y.Z or vX.Y.Z-prerelease, got ${releaseTag}: ${errorMessage(error)}`,
    );
  }

  const packageJson = readJson(root, "package.json");
  const packageLock = readJson(root, "package-lock.json");
  const tauriConfig = readJson(root, "src-tauri/tauri.conf.json");
  const versions = [
    ["package.json version", packageJson.version],
    ["package-lock.json version", packageLock.version],
    ['package-lock.json packages[""].version', packageLock.packages?.[""]?.version],
    ["src-tauri/tauri.conf.json version", tauriConfig.version],
    [
      "src-tauri/Cargo.toml version",
      readCargoPackageVersion(root, "src-tauri/Cargo.toml"),
    ],
    [
      "src-tauri/Cargo.lock forktail package version",
      readCargoLockVersion(root, "src-tauri/Cargo.lock"),
    ],
  ];

  for (const [label, version] of versions) {
    parseSemver(version, label);
  }

  const mismatches = versions.filter(([, version]) => version !== expectedVersion);
  if (mismatches.length > 0) {
    const details = mismatches
      .map(([label, version]) => `${label} has ${String(version)}`)
      .join("; ");
    throw new Error(
      `Release tag ${releaseTag} must match project version ${expectedVersion}; ${details}.`,
    );
  }

  console.log(
    `Release ${releaseTag} matches all 6 project version fields at ${expectedVersion}.`,
  );
}

function parseRoot(args) {
  if (args.length === 0) return defaultRoot;
  if (args.length === 2 && args[0] === "--root" && args[1].trim().length > 0) {
    return resolve(args[1]);
  }
  throw new Error("Usage: node scripts/validate-release.mjs [vX.Y.Z] [--root PATH]");
}

function readJson(root, relativePath) {
  try {
    const value = JSON.parse(readFileSync(resolve(root, relativePath), "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("root must be an object");
    }
    return value;
  } catch (error) {
    throw new Error(`${relativePath} must contain valid JSON: ${errorMessage(error)}`);
  }
}

function readCargoPackageVersion(root, relativePath) {
  const text = readFileSync(resolve(root, relativePath), "utf8");
  const packageSections = findTomlSections(text).filter(({ name }) => name === "package");
  if (packageSections.length !== 1) {
    throw new Error(
      `${relativePath} must contain exactly one [package] section; found ${packageSections.length}.`,
    );
  }
  return readVersionInRange(text, packageSections[0], `${relativePath} [package]`);
}

function readCargoLockVersion(root, relativePath) {
  const text = readFileSync(resolve(root, relativePath), "utf8");
  const workspacePackages = findTomlSections(text)
    .filter(({ name }) => name === "[package]")
    .filter((section) => {
      const block = text.slice(section.contentStart, section.end);
      const names = Array.from(block.matchAll(/^name\s*=\s*"([^"]+)"\s*$/gm));
      return names.length === 1 && names[0][1] === "forktail";
    });

  if (workspacePackages.length !== 1) {
    throw new Error(
      `${relativePath} must contain exactly one [[package]] named forktail; found ${workspacePackages.length}.`,
    );
  }
  return readVersionInRange(
    text,
    workspacePackages[0],
    `${relativePath} forktail package`,
  );
}

function findTomlSections(text) {
  const matches = Array.from(text.matchAll(/^\s*\[(\[?[^\]\r\n]+\]?)\]\s*$/gm));
  return matches.map((match, index) => ({
    name: match[1],
    contentStart: match.index + match[0].length,
    end: index + 1 < matches.length ? matches[index + 1].index : text.length,
  }));
}

function readVersionInRange(text, range, label) {
  const block = text.slice(range.contentStart, range.end);
  const versions = Array.from(
    block.matchAll(/^\s*version\s*=\s*"([^"]+)"\s*(?:#.*)?$/gm),
  );
  if (versions.length !== 1) {
    throw new Error(`${label} must contain exactly one version field; found ${versions.length}.`);
  }
  return versions[0][1];
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
