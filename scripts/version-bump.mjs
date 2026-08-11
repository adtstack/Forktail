import {
  chmodSync,
  lstatSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { compareSemver, normalizeReleaseVersion, parseSemver } from "./semver.mjs";

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VERSION_FILES = Object.freeze([
  "package.json",
  "package-lock.json",
  "src-tauri/Cargo.toml",
  "src-tauri/Cargo.lock",
  "src-tauri/tauri.conf.json",
]);

/**
 * Update every project version as one best-effort transaction.
 * `replaceFile` is an injectable test seam; production always uses renameSync.
 */
export function applyVersionBump(
  requestedVersion,
  { root = defaultRoot, dryRun = false, replaceFile = defaultReplaceFile } = {},
) {
  const projectRoot = resolve(root);
  const nextVersion = normalizeReleaseVersion(requestedVersion);
  const project = readProject(projectRoot);
  const currentVersion = validateCurrentVersions(project.versions);

  if (compareSemver(nextVersion, currentVersion) <= 0) {
    throw new Error(
      `Target version ${nextVersion} must be strictly newer than current version ${currentVersion}.`,
    );
  }

  const outputs = buildOutputs(project, nextVersion);
  const changedFiles = outputs.map(({ relativePath }) => relativePath);
  if (dryRun) {
    return { currentVersion, nextVersion, changedFiles, dryRun: true };
  }

  const staged = stageOutputs(outputs);
  const attempted = [];
  const preservedRollbackTemps = new Set();

  try {
    try {
      for (let index = 0; index < staged.length; index += 1) {
        const entry = staged[index];
        assertTargetText(entry, entry.originalText, "before replacement");
        attempted.push(entry);
        replaceFile(entry.nextTempPath, entry.targetPath, {
          phase: "apply",
          index,
          relativePath: entry.relativePath,
        });
      }

      const written = readProject(projectRoot);
      const writtenVersion = validateCurrentVersions(written.versions);
      if (writtenVersion !== nextVersion) {
        throw new Error(
          `Post-write verification found ${writtenVersion}; expected ${nextVersion}.`,
        );
      }
    } catch (applyError) {
      const rollbackErrors = [];
      for (let index = attempted.length - 1; index >= 0; index -= 1) {
        const entry = attempted[index];
        try {
          const currentText = readRegularFile(entry.targetPath, entry.relativePath);
          if (currentText === entry.nextText) {
            replaceFile(entry.rollbackTempPath, entry.targetPath, {
              phase: "rollback",
              index,
              relativePath: entry.relativePath,
            });
          } else if (currentText !== entry.originalText) {
            throw new Error(
              "the target changed concurrently after replacement; it was left untouched",
            );
          }
        } catch (rollbackError) {
          preservedRollbackTemps.add(entry.rollbackTempPath);
          rollbackErrors.push(
            `${entry.relativePath}: ${errorMessage(rollbackError)} (original preserved at ${entry.rollbackTempPath})`,
          );
        }
      }

      if (rollbackErrors.length > 0) {
        throw new Error(
          `Version bump failed and rollback was incomplete: ${errorMessage(applyError)}; ${rollbackErrors.join("; ")}`,
          { cause: applyError },
        );
      }
      throw new Error(`Version bump failed; all replaced files were restored: ${errorMessage(applyError)}`, {
        cause: applyError,
      });
    }
  } finally {
    for (const entry of staged) {
      removeTemp(entry.nextTempPath);
      if (!preservedRollbackTemps.has(entry.rollbackTempPath)) {
        removeTemp(entry.rollbackTempPath);
      }
    }
  }

  return { currentVersion, nextVersion, changedFiles, dryRun: false };
}

function readProject(root) {
  const files = new Map();
  for (const relativePath of VERSION_FILES) {
    const path = join(root, relativePath);
    const metadata = lstatSync(path);
    if (!metadata.isFile()) {
      throw new Error(`${relativePath} must be a regular file.`);
    }
    files.set(relativePath, {
      relativePath,
      path,
      mode: metadata.mode,
      text: readFileSync(path, "utf8"),
    });
  }

  const packageJson = parseJsonFile(files.get("package.json"));
  const packageLock = parseJsonFile(files.get("package-lock.json"));
  const tauriConfig = parseJsonFile(files.get("src-tauri/tauri.conf.json"));
  const packageJsonTarget = findJsonStringTarget(
    files.get("package.json").text,
    ["version"],
    "package.json version",
  );
  const packageLockTarget = findJsonStringTarget(
    files.get("package-lock.json").text,
    ["version"],
    "package-lock.json version",
  );
  const packageLockRootTarget = findJsonStringTarget(
    files.get("package-lock.json").text,
    ["packages", "", "version"],
    'package-lock.json packages[""].version',
  );
  const tauriConfigTarget = findJsonStringTarget(
    files.get("src-tauri/tauri.conf.json").text,
    ["version"],
    "src-tauri/tauri.conf.json version",
  );
  const cargoTomlTarget = findCargoTomlVersion(files.get("src-tauri/Cargo.toml").text);
  const cargoLockTarget = findCargoLockVersion(files.get("src-tauri/Cargo.lock").text);

  const packageVersion = requireVersion(packageJson.version, "package.json version");
  const packageLockVersion = requireVersion(packageLock.version, "package-lock.json version");
  const packageLockRootVersion = requireVersion(
    packageLock.packages?.[""]?.version,
    'package-lock.json packages[""].version',
  );
  const tauriVersion = requireVersion(
    tauriConfig.version,
    "src-tauri/tauri.conf.json version",
  );
  verifyJsonTarget(packageJsonTarget, packageVersion, "package.json version");
  verifyJsonTarget(packageLockTarget, packageLockVersion, "package-lock.json version");
  verifyJsonTarget(
    packageLockRootTarget,
    packageLockRootVersion,
    'package-lock.json packages[""].version',
  );
  verifyJsonTarget(tauriConfigTarget, tauriVersion, "src-tauri/tauri.conf.json version");

  return {
    files,
    targets: {
      packageJsonTarget,
      packageLockTarget,
      packageLockRootTarget,
      tauriConfigTarget,
      cargoTomlTarget,
      cargoLockTarget,
    },
    versions: [
      ["package.json", packageVersion],
      ["package-lock.json", packageLockVersion],
      ['package-lock.json packages[""].version', packageLockRootVersion],
      ["src-tauri/Cargo.toml", cargoTomlTarget.version],
      ["src-tauri/Cargo.lock", cargoLockTarget.version],
      ["src-tauri/tauri.conf.json", tauriVersion],
    ],
  };
}

function validateCurrentVersions(versions) {
  const currentVersion = versions[0][1];
  parseSemver(currentVersion, `${versions[0][0]} version`);

  const mismatches = versions.filter(([, version]) => version !== currentVersion);
  if (mismatches.length > 0) {
    const details = versions.map(([label, version]) => `${label}=${version}`).join(", ");
    throw new Error(`Project version fields are inconsistent: ${details}.`);
  }

  for (const [label, version] of versions.slice(1)) {
    parseSemver(version, `${label} version`);
  }
  return currentVersion;
}

function buildOutputs(project, nextVersion) {
  return [
    textOutput(
      project.files.get("package.json"),
      replaceTargets(
        project.files.get("package.json").text,
        [project.targets.packageJsonTarget],
        nextVersion,
      ),
    ),
    textOutput(
      project.files.get("package-lock.json"),
      replaceTargets(
        project.files.get("package-lock.json").text,
        [project.targets.packageLockTarget, project.targets.packageLockRootTarget],
        nextVersion,
      ),
    ),
    textOutput(
      project.files.get("src-tauri/Cargo.toml"),
      replaceTarget(
        project.files.get("src-tauri/Cargo.toml").text,
        project.targets.cargoTomlTarget,
        nextVersion,
      ),
    ),
    textOutput(
      project.files.get("src-tauri/Cargo.lock"),
      replaceTarget(
        project.files.get("src-tauri/Cargo.lock").text,
        project.targets.cargoLockTarget,
        nextVersion,
      ),
    ),
    textOutput(
      project.files.get("src-tauri/tauri.conf.json"),
      replaceTargets(
        project.files.get("src-tauri/tauri.conf.json").text,
        [project.targets.tauriConfigTarget],
        nextVersion,
      ),
    ),
  ];
}

function textOutput(file, nextText) {
  return { ...file, nextText };
}

function stageOutputs(outputs) {
  const staged = [];
  try {
    for (const output of outputs) {
      const nonce = `${process.pid}-${randomUUID()}`;
      const nextTempPath = join(dirname(output.path), `.${fileName(output.path)}.${nonce}.next.tmp`);
      const rollbackTempPath = join(
        dirname(output.path),
        `.${fileName(output.path)}.${nonce}.rollback.tmp`,
      );

      const entry = {
        relativePath: output.relativePath,
        targetPath: output.path,
        nextTempPath,
        rollbackTempPath,
        originalText: output.text,
        nextText: output.nextText,
      };
      staged.push(entry);
      writeTemp(nextTempPath, output.nextText, output.mode);
      writeTemp(rollbackTempPath, output.text, output.mode);
    }
    return staged;
  } catch (error) {
    for (const entry of staged) {
      removeTemp(entry.nextTempPath);
      removeTemp(entry.rollbackTempPath);
    }
    throw error;
  }
}

function assertTargetText(entry, expectedText, phase) {
  const currentText = readRegularFile(entry.targetPath, entry.relativePath);
  if (currentText !== expectedText) {
    throw new Error(
      `${entry.relativePath} changed concurrently ${phase}; no stale version data was written to it.`,
    );
  }
}

function readRegularFile(path, relativePath) {
  const metadata = lstatSync(path);
  if (!metadata.isFile()) {
    throw new Error(`${relativePath} must remain a regular file.`);
  }
  return readFileSync(path, "utf8");
}

function writeTemp(path, text, mode) {
  writeFileSync(path, text, { encoding: "utf8", flag: "wx", mode });
  chmodSync(path, mode);
}

function defaultReplaceFile(sourcePath, targetPath) {
  renameSync(sourcePath, targetPath);
}

function removeTemp(path) {
  rmSync(path, { force: true });
}

function replaceTarget(text, target, version) {
  return `${text.slice(0, target.start)}${version}${text.slice(target.end)}`;
}

function replaceTargets(text, targets, version) {
  return [...targets]
    .sort((left, right) => right.start - left.start)
    .reduce((result, target) => replaceTarget(result, target, version), text);
}

function verifyJsonTarget(target, parsedVersion, label) {
  if (target.version !== parsedVersion) {
    throw new Error(`${label} source token does not match its parsed JSON value.`);
  }
}

function findJsonStringTarget(text, path, label) {
  let objectStart = firstNonWhitespace(text, 0);
  if (text[objectStart] !== "{") {
    throw new Error(`${label} must be inside a JSON object.`);
  }
  let objectEnd = findMatchingJsonDelimiter(text, objectStart);

  for (let index = 0; index < path.length; index += 1) {
    const property = findDirectJsonProperty(
      text,
      objectStart,
      objectEnd,
      path[index],
      label,
    );
    const last = index === path.length - 1;
    if (last) {
      if (text[property.valueStart] !== '"') {
        throw new Error(`${label} must be a JSON string.`);
      }
      const valueEnd = readJsonStringEnd(text, property.valueStart);
      if (valueEnd !== property.valueEnd) {
        throw new Error(`${label} must contain one JSON string value.`);
      }
      return {
        version: JSON.parse(text.slice(property.valueStart, property.valueEnd)),
        start: property.valueStart + 1,
        end: property.valueEnd - 1,
      };
    }

    if (text[property.valueStart] !== "{") {
      throw new Error(`${label} path ${JSON.stringify(path.slice(0, index + 1))} must be an object.`);
    }
    objectStart = property.valueStart;
    objectEnd = property.valueEnd - 1;
  }

  throw new Error(`${label} path must not be empty.`);
}

function findDirectJsonProperty(text, objectStart, objectEnd, propertyName, label) {
  const matches = [];
  let cursor = objectStart + 1;

  while (cursor < objectEnd) {
    cursor = firstNonWhitespace(text, cursor);
    if (cursor >= objectEnd) break;
    if (text[cursor] !== '"') {
      throw new Error(`${label} contains an unsupported JSON object layout.`);
    }

    const keyEnd = readJsonStringEnd(text, cursor);
    const key = JSON.parse(text.slice(cursor, keyEnd));
    cursor = firstNonWhitespace(text, keyEnd);
    if (text[cursor] !== ":") {
      throw new Error(`${label} contains an invalid JSON property.`);
    }

    const valueStart = firstNonWhitespace(text, cursor + 1);
    const valueEnd = skipJsonValue(text, valueStart);
    if (key === propertyName) matches.push({ valueStart, valueEnd });
    cursor = firstNonWhitespace(text, valueEnd);
    if (text[cursor] === ",") {
      cursor += 1;
    } else if (cursor < objectEnd) {
      throw new Error(`${label} contains an invalid JSON object separator.`);
    }
  }

  if (matches.length !== 1) {
    throw new Error(
      `${label} path property ${JSON.stringify(propertyName)} must occur exactly once; found ${matches.length}.`,
    );
  }
  return matches[0];
}

function skipJsonValue(text, start) {
  const character = text[start];
  if (character === '"') return readJsonStringEnd(text, start);
  if (character === "{" || character === "[") {
    return findMatchingJsonDelimiter(text, start) + 1;
  }

  let cursor = start;
  while (cursor < text.length && !/[\s,}\]]/.test(text[cursor])) cursor += 1;
  return cursor;
}

function findMatchingJsonDelimiter(text, start) {
  const opening = text[start];
  const closing = opening === "{" ? "}" : opening === "[" ? "]" : null;
  if (!closing) throw new Error("Expected a JSON object or array delimiter.");

  const stack = [closing];
  let cursor = start + 1;
  while (cursor < text.length) {
    const character = text[cursor];
    if (character === '"') {
      cursor = readJsonStringEnd(text, cursor);
      continue;
    }
    if (character === "{") stack.push("}");
    else if (character === "[") stack.push("]");
    else if (character === stack.at(-1)) {
      stack.pop();
      if (stack.length === 0) return cursor;
    }
    cursor += 1;
  }
  throw new Error("JSON object or array delimiter is not closed.");
}

function readJsonStringEnd(text, start) {
  let escaped = false;
  for (let cursor = start + 1; cursor < text.length; cursor += 1) {
    const character = text[cursor];
    if (!escaped && character === '"') return cursor + 1;
    if (!escaped && character === "\\") escaped = true;
    else escaped = false;
  }
  throw new Error("JSON string is not closed.");
}

function firstNonWhitespace(text, start) {
  let cursor = start;
  while (cursor < text.length && /\s/.test(text[cursor])) cursor += 1;
  return cursor;
}

function findCargoTomlVersion(text) {
  const sections = findTomlSections(text);
  const packageSections = sections.filter(({ name }) => name === "package");
  if (packageSections.length !== 1) {
    throw new Error(
      `src-tauri/Cargo.toml must contain exactly one [package] section; found ${packageSections.length}.`,
    );
  }
  return findVersionInRange(text, packageSections[0], "src-tauri/Cargo.toml [package]");
}

function findCargoLockVersion(text) {
  const sections = findTomlSections(text).filter(({ name }) => name === "[package]");
  const workspacePackages = sections.filter((section) => {
    const block = text.slice(section.contentStart, section.end);
    const names = Array.from(block.matchAll(/^name\s*=\s*"([^"]+)"\s*$/gm));
    return names.length === 1 && names[0][1] === "forktail";
  });

  if (workspacePackages.length !== 1) {
    throw new Error(
      `src-tauri/Cargo.lock must contain exactly one [[package]] named forktail; found ${workspacePackages.length}.`,
    );
  }
  return findVersionInRange(
    text,
    workspacePackages[0],
    "src-tauri/Cargo.lock forktail package",
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

function findVersionInRange(text, range, label) {
  const block = text.slice(range.contentStart, range.end);
  const versions = Array.from(block.matchAll(/^\s*version\s*=\s*"([^"]+)"\s*(?:#.*)?$/gm));
  if (versions.length !== 1) {
    throw new Error(`${label} must contain exactly one version field; found ${versions.length}.`);
  }
  const match = versions[0];
  const valueOffset = match[0].indexOf(`"${match[1]}"`) + 1;
  const start = range.contentStart + match.index + valueOffset;
  return { version: match[1], start, end: start + match[1].length };
}

function parseJsonFile(file) {
  try {
    const value = JSON.parse(file.text);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("root must be an object");
    }
    return value;
  } catch (error) {
    throw new Error(`${file.relativePath} must contain valid JSON: ${errorMessage(error)}`);
  }
}

function requireVersion(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function fileName(path) {
  return path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function parseCliArgs(args) {
  if (args.length === 0) {
    throw new Error(
      "Usage: node scripts/version-bump.mjs <vX.Y.Z|X.Y.Z> [--dry-run] [--root PATH]",
    );
  }

  const requestedVersion = args[0];
  let root = defaultRoot;
  let dryRun = false;
  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--dry-run" && !dryRun) {
      dryRun = true;
      continue;
    }
    if (argument === "--root" && index + 1 < args.length) {
      root = args[index + 1];
      index += 1;
      continue;
    }
    throw new Error(`Unknown or duplicate argument: ${argument}`);
  }
  return { requestedVersion, root, dryRun };
}

function isDirectInvocation() {
  return process.argv[1] != null && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
}

if (isDirectInvocation()) {
  try {
    const options = parseCliArgs(process.argv.slice(2));
    const result = applyVersionBump(options.requestedVersion, options);
    const prefix = result.dryRun ? "Dry run: would bump" : "Bumped";
    console.log(
      `${prefix} forktail ${result.currentVersion} -> ${result.nextVersion} in ${result.changedFiles.length} files.`,
    );
  } catch (error) {
    console.error(errorMessage(error));
    process.exitCode = 1;
  }
}
