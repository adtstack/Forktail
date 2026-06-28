import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tag = process.argv[2] ?? process.env.RELEASE_TAG ?? process.env.GITHUB_REF_NAME;

if (!tag) {
  fail("Set RELEASE_TAG or run this script from a GitHub tag workflow.");
}

if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(tag)) {
  fail(`Release tag must look like vX.Y.Z or vX.Y.Z-prerelease, got ${tag}.`);
}

const expectedVersion = tag.slice(1);
const packageVersion = readJson("package.json").version;
const tauriVersion = readJson("src-tauri/tauri.conf.json").version;
const cargoVersion = readCargoPackageVersion("src-tauri/Cargo.toml");
const versions = [
  ["package.json", packageVersion],
  ["src-tauri/tauri.conf.json", tauriVersion],
  ["src-tauri/Cargo.toml", cargoVersion],
];
const mismatches = versions.filter(([, version]) => version !== expectedVersion);

if (mismatches.length > 0) {
  const details = mismatches
    .map(([file, version]) => `${file} has ${version}`)
    .join("; ");
  fail(`Release tag ${tag} must match project version ${expectedVersion}; ${details}.`);
}

console.log(`Release ${tag} matches package, Tauri, and Cargo version ${expectedVersion}.`);

function readJson(relativePath) {
  return JSON.parse(readFileSync(resolve(root, relativePath), "utf8"));
}

function readCargoPackageVersion(relativePath) {
  const text = readFileSync(resolve(root, relativePath), "utf8");
  const packageSection = text.match(/^\[package\]\s*\r?\n([\s\S]*?)(?=^\[|(?![\s\S]))/m);
  const version = packageSection?.[1]?.match(/^version\s*=\s*"([^"]+)"\s*$/m)?.[1];
  if (!version) {
    fail(`Could not read package version from ${relativePath}.`);
  }
  return version;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
