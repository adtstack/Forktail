#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ISSUE = "T009";
const SCHEMA_VERSION = 2;
const MINIMUM_GIT_VERSION = Object.freeze([2, 45, 0]);
const RESULT_NAME = "conflict.txt";
const DIFFTOOL_FILES = Object.freeze({
  added: "added path O'Brien 한글.txt",
  deleted: "deleted path O'Brien 한글.txt",
  modified: "modified path O'Brien 한글.txt",
});
const CONFIG_KEYS = Object.freeze([
  "difftool.forktail.cmd",
  "mergetool.forktail.cmd",
  "mergetool.forktail.trustExitCode",
  "mergetool.forktail.hideResolved",
]);
const CONFIG_KEY_SET = new Set(CONFIG_KEYS.map((key) => key.toLowerCase()));
const REPOSITORY_KEYS = Object.freeze([
  "difftool",
  "mergetoolSave",
  "mergetoolMissingBase",
  "mergetoolEmptyBase",
]);
const VERIFY_SCENARIOS = new Set([
  "difftool-pristine",
  "mergetool-no-save",
  "mergetool-missing-base-no-save",
  "mergetool-empty-base-no-save",
  "mergetool-external-change-blocked",
  "mergetool-unresolved-blocked",
  "mergetool-save-during-app",
  "mergetool-save-post-confirm",
]);

export function prepareGitToolSmoke(options = {}) {
  const gitVersion = gitText(
    process.cwd(),
    ["--version"],
    sanitizedGitEnvironment(),
  ).trim();
  assertSupportedGitVersion(gitVersion);
  const root = createFixtureRoot(options.root);
  try {
    return createGitToolSmokeFixture(root, gitVersion);
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

function createGitToolSmokeFixture(root, gitVersion) {
  const paths = {
    manifest: join(root, "manifest.json"),
    provenance: join(root, "fixture-provenance.json"),
    checklist: join(root, "GIT_TOOL_SMOKE_CHECKLIST.md"),
    configTemplate: join(root, "GIT_TOOL_CONFIG.gitconfig"),
    toolConfigReceipt: join(root, "tool-config-receipt.json"),
    externalChangeReceipt: join(root, "external-change-receipt.json"),
    isolatedHome: join(root, "isolated-home"),
    isolatedXdg: join(root, "isolated-xdg"),
    emptyGlobalConfig: join(root, "isolated-home", "empty-global.gitconfig"),
    artifactDir: join(root, "artifact path O'Brien 한글"),
    reportOutputDir: join(root, "report-output"),
  };

  for (const directory of [
    paths.isolatedHome,
    paths.isolatedXdg,
    paths.artifactDir,
    paths.reportOutputDir,
  ]) {
    mkdirSync(directory, { recursive: true });
  }
  writeFileSync(paths.emptyGlobalConfig, "");
  writeFileSync(
    paths.configTemplate,
    [
      "# Paste both snippets copied from Forktail's Git tool setup below.",
      "# Only [difftool \"forktail\"] and [mergetool \"forktail\"] are accepted.",
      "",
    ].join("\n"),
  );

  const environment = isolatedGitEnvironment(paths);
  const repositories = {
    difftool: createDifftoolRepository(join(root, "difftool repo"), environment),
    mergetoolSave: createConflictRepository(
      join(root, "mergetool save repo"),
      "modified",
      environment,
    ),
    mergetoolMissingBase: createConflictRepository(
      join(root, "mergetool missing base repo"),
      "add-add",
      environment,
    ),
    mergetoolEmptyBase: createConflictRepository(
      join(root, "mergetool empty base repo"),
      "empty-base",
      environment,
    ),
  };

  const manifest = {
    issue: ISSUE,
    schemaVersion: SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    gitVersion,
    root,
    paths,
    isolation: {
      home: paths.isolatedHome,
      xdgConfigHome: paths.isolatedXdg,
      globalConfig: paths.emptyGlobalConfig,
      systemConfigDisabled: true,
    },
    repositories,
    expected: {
      difftoolStatuses: [
        `A ${DIFFTOOL_FILES.added}`,
        `D ${DIFFTOOL_FILES.deleted}`,
        `M ${DIFFTOOL_FILES.modified}`,
      ],
      mergetoolSaveStages: [1, 2, 3],
      mergetoolMissingBaseStages: [2, 3],
      mergetoolEmptyBaseStages: [1, 2, 3],
      verdictRule:
        "Process and verifier evidence does not replace pane, read-only, save, unresolved, or native-dialog UI evidence.",
    },
  };

  writeFileSync(paths.manifest, `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(paths.checklist, buildChecklist(manifest));
  writeNewReceipt(paths.provenance, {
    issue: ISSUE,
    schemaVersion: SCHEMA_VERSION,
    kind: "manifest-provenance",
    fixtureCreatedAt: manifest.createdAt,
    manifestSha256: fileSha256(paths.manifest),
  });
  return manifest;
}

export function installToolConfig({ manifestPath, configPath }) {
  const manifest = loadManifest(manifestPath);
  const environment = isolatedGitEnvironment(manifest.paths);
  assertCurrentGitMatchesManifest(manifest, environment);
  const resolvedConfig = resolveRegularFile(configPath, "Git tool config");
  const names = gitText(
    manifest.root,
    ["config", "--file", resolvedConfig, "--name-only", "--list"],
    environment,
  )
    .trim()
    .split("\n")
    .filter(Boolean);

  for (const name of names) {
    if (!CONFIG_KEY_SET.has(name.toLowerCase())) {
      throw new Error(`unsupported config key: ${name}`);
    }
  }

  const values = Object.fromEntries(
    CONFIG_KEYS.map((key) => [
      key,
      readSingleConfigValue(manifest.root, resolvedConfig, key, environment),
    ]),
  );
  validateToolConfig(values);

  const repositories = REPOSITORY_KEYS.map((key) => manifest.repositories[key]);
  for (const repository of repositories) {
    for (const defaultKey of ["diff.tool", "merge.tool"]) {
      if (gitExit(repository.path, ["config", "--local", "--get", defaultKey], environment) === 0) {
        throw new Error(`fixture repository already defines forbidden default key: ${defaultKey}`);
      }
    }
    assertFixtureLocalConfigUnchanged(repository, environment);
    for (const key of CONFIG_KEYS) {
      if (readOptionalLocalConfigValues(repository.path, key, environment).length > 1) {
        throw new Error(`local config key must appear at most once: ${key}`);
      }
    }
  }
  const existingReceipt = existingToolConfigReceiptForInstall(manifest, values);
  for (const repository of repositories) {
    for (const key of CONFIG_KEYS) {
      git(repository.path, ["config", "--local", key, values[key]], environment);
    }
  }
  finalizeToolConfigReceipt(manifest, values, existingReceipt);

  return { repositories: repositories.map(({ path }) => path), installedKeys: [...CONFIG_KEYS] };
}

export function assertSupportedGitVersion(versionText) {
  const match = /^git version ([0-9]+)\.([0-9]+)\.([0-9]+)/.exec(versionText);
  if (!match) throw new Error("could not parse Git version");
  const version = match.slice(1, 4).map((value) => Number.parseInt(value, 10));
  for (let index = 0; index < MINIMUM_GIT_VERSION.length; index += 1) {
    if (version[index] > MINIMUM_GIT_VERSION[index]) break;
    if (version[index] < MINIMUM_GIT_VERSION[index]) {
      throw new Error("T009 requires Git 2.45.0 or newer");
    }
  }
  return { major: version[0], minor: version[1], patch: version[2] };
}

function assertCurrentGitMatchesManifest(manifest, environment) {
  const current = gitText(manifest.root, ["--version"], environment).trim();
  assertSupportedGitVersion(current);
  if (current !== manifest.gitVersion) {
    throw new Error("Git version changed since fixture preparation; prepare a new T009 fixture");
  }
}

export function buildRunScenario(manifestInput, scenario) {
  const manifest = validateManifestObject(manifestInput);
  if (scenario === "difftool") {
    const repository = manifest.repositories.difftool;
    return {
      cwd: repository.path,
      args: [
        "difftool",
        "--tool=forktail",
        "--no-prompt",
        repository.baseRevision,
        repository.changedRevision,
        "--",
        DIFFTOOL_FILES.added,
        DIFFTOOL_FILES.deleted,
        DIFFTOOL_FILES.modified,
      ],
    };
  }

  const key = {
    "mergetool-save": "mergetoolSave",
    "mergetool-missing-base": "mergetoolMissingBase",
    "mergetool-empty-base": "mergetoolEmptyBase",
  }[scenario];
  if (!key) throw new Error(`unsupported run scenario: ${scenario}`);
  return {
    cwd: manifest.repositories[key].path,
    args: ["mergetool", "--tool=forktail", "--no-prompt", RESULT_NAME],
  };
}

export function runGitToolScenario({ manifestPath, scenario }) {
  const manifest = loadManifest(manifestPath);
  const environment = isolatedGitEnvironment(manifest.paths);
  assertCurrentGitMatchesManifest(manifest, environment);
  const command = buildRunScenario(manifest, scenario);
  const repository = REPOSITORY_KEYS
    .map((key) => manifest.repositories[key])
    .find(({ path }) => path === command.cwd);
  if (!repository) throw new Error("run scenario repository is missing from the manifest");
  assertToolConfigInstalled(repository, environment);
  assertToolConfigMatchesReceipt(repository, manifest, environment);
  const result = spawnSync("git", command.args, {
    cwd: command.cwd,
    env: environment,
    stdio: "inherit",
    shell: false,
  });
  if (result.error) {
    throw new Error(`could not start Git for ${scenario}`);
  }
  return result.status ?? 1;
}

export function captureExternalChangeFingerprint({ manifestPath }) {
  const manifest = loadManifest(manifestPath);
  const environment = isolatedGitEnvironment(manifest.paths);
  assertCurrentGitMatchesManifest(manifest, environment);
  const repository = manifest.repositories.mergetoolSave;
  const failures = [];
  verifyConflictIdentity(repository, manifest, environment, failures);
  const fingerprint = resultFingerprintForVerify(repository.resultPath, failures);
  if (fingerprint?.sha256 === repository.baseline.resultSha256) {
    addFailure(failures, "EXTERNAL_CHANGE_MISSING", "MERGED result did not change externally");
  }
  verifyNoBackups(repository, failures);
  verifyRepositorySidecars(
    repository,
    { allowBackups: false, allowGitTemps: true },
    failures,
  );
  if (failures.length > 0 || fingerprint == null) {
    throw new Error(
      `external change checkpoint is invalid: ${failures.map(({ code }) => code).join(", ")}`,
    );
  }
  const receipt = {
    issue: ISSUE,
    schemaVersion: SCHEMA_VERSION,
    kind: "external-change",
    fixtureCreatedAt: manifest.createdAt,
    repositoryHead: repository.baseline.head,
    baselineResultSha256: repository.baseline.resultSha256,
    resultFingerprint: fingerprint,
  };
  writeNewReceipt(manifest.paths.externalChangeReceipt, receipt);
  return receipt;
}

export function cleanupGitToolSmoke({ manifestPath }) {
  const manifest = loadManifestForCleanup(manifestPath);
  rmSync(manifest.root, { recursive: true, force: false });
  return { root: manifest.root };
}

export function verifyGitToolSmoke({ manifestPath, scenario }) {
  if (!VERIFY_SCENARIOS.has(scenario)) {
    throw new Error(`unsupported verify scenario: ${scenario}`);
  }
  const manifest = loadManifest(manifestPath);
  const environment = isolatedGitEnvironment(manifest.paths);
  assertCurrentGitMatchesManifest(manifest, environment);
  const failures = [];

  if (scenario === "difftool-pristine") {
    verifyDifftoolPristine(manifest.repositories.difftool, manifest, environment, failures);
  } else {
    const repository = repositoryForVerifyScenario(manifest, scenario);
    if (scenario === "mergetool-save-during-app") {
      verifySavedDuringApp(repository, manifest, environment, failures);
    } else if (scenario === "mergetool-save-post-confirm") {
      verifySavedPostConfirm(repository, manifest, environment, failures);
    } else if (scenario === "mergetool-external-change-blocked") {
      verifyConflictIdentity(repository, manifest, environment, failures);
      verifyExternalChangePreserved(manifest, repository, failures);
      verifyNoBackups(repository, failures);
      verifyRepositorySidecars(
        repository,
        { allowBackups: false, allowGitTemps: true },
        failures,
      );
    } else if (scenario === "mergetool-unresolved-blocked") {
      verifyConflictIdentity(repository, manifest, environment, failures);
      const resultAvailable = verifyResultUnchanged(repository, failures);
      if (resultAvailable && !hasConflictMarkers(repository.resultPath)) {
        addFailure(failures, "UNRESOLVED_MARKERS_MISSING", "fixture Result no longer has markers");
      }
      verifyRepositorySidecars(
        repository,
        { allowBackups: false, allowGitTemps: true },
        failures,
      );
    } else {
      verifyConflictIdentity(repository, manifest, environment, failures);
      verifyResultUnchanged(repository, failures);
      verifyNoBackups(repository, failures);
      verifyNoGitTempResidue(repository, failures);
      verifyRepositorySidecars(
        repository,
        { allowBackups: false, allowGitTemps: false },
        failures,
      );
    }
  }

  return { issue: ISSUE, scenario, ok: failures.length === 0, failures };
}

function createFixtureRoot(requestedRoot) {
  if (requestedRoot == null) {
    return mkdtempSync(join(tmpdir(), "forktail-git-tool O'Brien 한글-"));
  }
  const root = resolve(requestedRoot);
  if (existsSync(root)) throw new Error(`fixture root already exists: ${root}`);
  mkdirSync(root, { recursive: false });
  return root;
}

function createDifftoolRepository(path, environment) {
  initializeRepository(path, environment);
  writeFileSync(join(path, DIFFTOOL_FILES.deleted), "deleted base\n");
  writeFileSync(join(path, DIFFTOOL_FILES.modified), "modified base\n");
  writeFileSync(join(path, "unchanged.txt"), "unchanged\n");
  commitAll(path, "base", environment);
  const baseRevision = gitText(path, ["rev-parse", "HEAD"], environment).trim();

  writeFileSync(join(path, DIFFTOOL_FILES.modified), "modified changed\n");
  writeFileSync(join(path, DIFFTOOL_FILES.added), "added changed\n");
  git(path, ["rm", "--quiet", "--", DIFFTOOL_FILES.deleted], environment);
  commitAll(path, "changed", environment);
  const changedRevision = gitText(path, ["rev-parse", "HEAD"], environment).trim();

  return {
    path,
    baseRevision,
    changedRevision,
    baseline: captureDifftoolBaseline(path, environment),
  };
}

function createConflictRepository(path, kind, environment) {
  initializeRepository(path, environment);
  writeFileSync(join(path, "seed.txt"), "fixture seed\n");
  if (kind === "modified") writeFileSync(join(path, RESULT_NAME), "shared base\n");
  if (kind === "empty-base") writeFileSync(join(path, RESULT_NAME), "");
  commitAll(path, "base", environment);
  const baseRevision = gitText(path, ["rev-parse", "HEAD"], environment).trim();

  git(path, ["switch", "--quiet", "-c", "ours"], environment);
  writeFileSync(join(path, RESULT_NAME), "ours value\n");
  commitAll(path, "ours", environment);

  git(path, ["switch", "--quiet", "-c", "theirs", baseRevision], environment);
  writeFileSync(join(path, RESULT_NAME), "theirs value\n");
  commitAll(path, "theirs", environment);

  git(path, ["switch", "--quiet", "ours"], environment);
  const mergeStatus = gitExit(
    path,
    ["merge", "--no-commit", "--no-ff", "theirs"],
    environment,
  );
  if (mergeStatus !== 1) {
    throw new Error(`expected fixture merge conflict for ${kind}, got exit ${mergeStatus}`);
  }

  const unmerged = readUnmergedEntries(path, environment);
  const stages = unmerged.map(({ stage }) => stage);
  const expectedStages = kind === "add-add" ? [2, 3] : [1, 2, 3];
  if (JSON.stringify(stages) !== JSON.stringify(expectedStages)) {
    throw new Error(`unexpected conflict stages for ${kind}: ${stages.join(",")}`);
  }

  const resultPath = join(path, RESULT_NAME);
  const repository = {
    path,
    kind,
    baseRevision,
    resultPath,
    baseline: captureConflictBaseline(path, resultPath, environment),
  };
  if (kind === "empty-base") {
    repository.emptyBaseObject = unmerged.find(({ stage }) => stage === 1)?.objectId ?? null;
  }
  return repository;
}

function initializeRepository(path, environment) {
  mkdirSync(path, { recursive: true });
  git(path, ["init", "--quiet", "-b", "main"], environment);
  git(path, ["config", "--local", "core.autocrlf", "false"], environment);
  git(path, ["config", "--local", "core.safecrlf", "false"], environment);
  git(path, ["config", "--local", "core.filemode", "false"], environment);
}

function commitAll(path, message, environment) {
  git(path, ["add", "--all"], environment);
  git(
    path,
    [
      "-c",
      "user.name=Forktail Smoke",
      "-c",
      "user.email=forktail-smoke@invalid.example",
      "commit",
      "--quiet",
      "-m",
      message,
    ],
    environment,
  );
}

function captureDifftoolBaseline(path, environment) {
  return {
    ...captureRepositoryIdentity(path, environment),
    localConfigEntries: captureNonToolLocalConfig(path, environment),
    statusSha256: sha256(gitBuffer(path, ["status", "--porcelain=v1", "-z"], environment)),
    trackedFiles: captureTrackedFiles(path, environment),
  };
}

function captureConflictBaseline(path, resultPath, environment) {
  const unmerged = readUnmergedEntries(path, environment);
  const resultMode = unmerged.find(({ stage }) => stage === 2)?.mode;
  if (!resultMode) throw new Error("fixture conflict is missing the stage-2 Result mode");
  const resultFingerprint = captureFileFingerprint(resultPath);
  return {
    ...captureRepositoryIdentity(path, environment),
    localConfigEntries: captureNonToolLocalConfig(path, environment),
    resultFingerprint,
    resultSha256: resultFingerprint.sha256,
    resultMode,
    unmerged,
    immutableIndexEntries: captureIndexEntries(path, environment).filter(
      ({ path: filePath }) => filePath !== RESULT_NAME,
    ),
    immutableIndexFlags: captureIndexFlags(path, environment).filter(
      ({ path: filePath }) => filePath !== RESULT_NAME,
    ),
    immutableFiles: captureTrackedFiles(path, environment).filter(({ path: filePath }) =>
      filePath !== RESULT_NAME
    ),
    topLevelEntries: readdirSync(path).sort(),
  };
}

function captureRepositoryIdentity(path, environment) {
  const gitDirectory = gitDirectoryForRepository(path, environment);
  const indexPath = join(gitDirectory, "index");
  const refs = gitText(
    path,
    ["for-each-ref", "--format=%(refname) %(objectname)"],
    environment,
  )
    .trim()
    .split("\n")
    .filter(Boolean)
    .sort()
    .join("\n");
  return {
    head: gitText(path, ["rev-parse", "HEAD"], environment).trim(),
    refsSha256: sha256(Buffer.from(`${refs}\n`)),
    indexFingerprint: captureFileFingerprint(indexPath),
    gitStateFiles: captureGitStateFiles(gitDirectory),
  };
}

function gitDirectoryForRepository(path, environment) {
  const raw = gitText(path, ["rev-parse", "--absolute-git-dir"], environment).trim();
  return isAbsolute(raw) ? raw : resolve(path, raw);
}

function captureGitStateFiles(gitDirectory) {
  return readdirSync(gitDirectory)
    .sort()
    .flatMap((name) => {
      if (name === "config" || name === "index") return [];
      const path = join(gitDirectory, name);
      const metadata = lstatSync(path);
      if (metadata.isDirectory() && !metadata.isSymbolicLink()) return [];
      if (!metadata.isFile() || metadata.isSymbolicLink()) {
        return [{ name, kind: metadata.isSymbolicLink() ? "symlink" : "non-regular" }];
      }
      return [{ name, ...captureFileFingerprint(path) }];
    });
}

function captureNonToolLocalConfig(path, environment) {
  const bytes = gitBuffer(path, ["config", "--local", "--null", "--list"], environment);
  const entries = [];
  let offset = 0;
  while (offset < bytes.length) {
    const end = bytes.indexOf(0, offset);
    if (end === -1) throw new Error("could not parse fixture local config record");
    const record = bytes.subarray(offset, end);
    offset = end + 1;
    if (record.length === 0) continue;
    const separator = record.indexOf(10);
    if (separator <= 0) throw new Error("could not parse fixture local config entry");
    const key = record.subarray(0, separator).toString("utf8").toLowerCase();
    if (CONFIG_KEY_SET.has(key)) continue;
    entries.push({
      key,
      valueSha256: sha256(record.subarray(separator + 1)),
    });
  }
  return entries.sort((left, right) =>
    left.key.localeCompare(right.key) || left.valueSha256.localeCompare(right.valueSha256),
  );
}

function assertFixtureLocalConfigUnchanged(repository, environment) {
  const current = captureNonToolLocalConfig(repository.path, environment);
  if (JSON.stringify(current) !== JSON.stringify(repository.baseline.localConfigEntries)) {
    throw new Error("repository-local config changed outside Forktail tool keys");
  }
}

function captureTrackedFiles(path, environment) {
  const files = gitText(path, ["ls-files", "-z"], environment)
    .split("\0")
    .filter(Boolean)
    .sort();
  return files
    .filter((filePath) => {
      const candidate = join(path, filePath);
      return existsSync(candidate) && lstatSync(candidate).isFile();
    })
    .map((filePath) => ({ path: filePath, ...captureFileFingerprint(join(path, filePath)) }));
}

function readUnmergedEntries(path, environment) {
  return gitText(path, ["ls-files", "-u", "-z", "--", RESULT_NAME], environment)
    .split("\0")
    .filter(Boolean)
    .map((record) => {
      const match = record.match(/^([0-9]+) ([0-9a-f]+) ([123])\t(.+)$/s);
      if (!match) throw new Error("could not parse fixture unmerged index record");
      return {
        mode: match[1],
        objectId: match[2],
        stage: Number.parseInt(match[3], 10),
        path: match[4],
      };
    })
    .sort((left, right) => left.stage - right.stage);
}

function captureIndexEntries(path, environment) {
  return gitText(path, ["ls-files", "--stage", "-z"], environment)
    .split("\0")
    .filter(Boolean)
    .map((record) => {
      const match = record.match(/^([0-9]+) ([0-9a-f]+) ([0-3])\t(.+)$/s);
      if (!match) throw new Error("could not parse fixture index record");
      return {
        mode: match[1],
        objectId: match[2],
        stage: Number.parseInt(match[3], 10),
        path: match[4],
      };
    })
    .sort((left, right) => left.path.localeCompare(right.path) || left.stage - right.stage);
}

function captureIndexFlags(path, environment) {
  return gitText(path, ["ls-files", "-v", "-z"], environment)
    .split("\0")
    .filter(Boolean)
    .map((record) => {
      const match = record.match(/^(.) (.+)$/s);
      if (!match) throw new Error("could not parse fixture index flag record");
      return { flag: match[1], path: match[2] };
    })
    .sort((left, right) => left.path.localeCompare(right.path));
}

function verifyDifftoolPristine(repository, manifest, environment, failures) {
  const current = captureDifftoolBaseline(repository.path, environment);
  verifyRepositoryIdentity(repository, current, true, failures);
  compareField(
    failures,
    "STATUS_CHANGED",
    "working-tree status changed",
    current.statusSha256,
    repository.baseline.statusSha256,
  );
  compareField(
    failures,
    "WORKTREE_CHANGED",
    "tracked file bytes changed",
    JSON.stringify(current.trackedFiles),
    JSON.stringify(repository.baseline.trackedFiles),
  );
  verifyLocalConfigUnchanged(repository, current.localConfigEntries, failures);
  verifyToolConfigUnchanged(repository, manifest, environment, failures);
  verifyNoGitLockResidue(repository, environment, failures);
}

function verifyConflictIdentity(repository, manifest, environment, failures) {
  const identity = captureRepositoryIdentity(repository.path, environment);
  verifyRepositoryIdentity(repository, identity, true, failures);
  compareField(
    failures,
    "UNMERGED_CHANGED",
    "unmerged stage set changed",
    JSON.stringify(readUnmergedEntries(repository.path, environment)),
    JSON.stringify(repository.baseline.unmerged),
  );
  verifyLocalConfigUnchanged(
    repository,
    captureNonToolLocalConfig(repository.path, environment),
    failures,
  );
  verifyToolConfigUnchanged(repository, manifest, environment, failures);
  verifyImmutableFiles(repository, failures);
  verifyNoGitLockResidue(repository, environment, failures);
}

function verifyRepositoryIdentity(repository, current, compareIndex, failures) {
  compareField(failures, "HEAD_CHANGED", "HEAD changed", current.head, repository.baseline.head);
  compareField(
    failures,
    "REFS_CHANGED",
    "refs changed",
    current.refsSha256,
    repository.baseline.refsSha256,
  );
  compareField(
    failures,
    "GIT_STATE_CHANGED",
    "Git operation state changed",
    JSON.stringify(current.gitStateFiles),
    JSON.stringify(repository.baseline.gitStateFiles),
  );
  if (compareIndex) {
    compareField(
      failures,
      "INDEX_CHANGED",
      "index bytes or metadata changed",
      JSON.stringify(current.indexFingerprint),
      JSON.stringify(repository.baseline.indexFingerprint),
    );
  }
}

function verifyResultUnchanged(repository, failures) {
  const current = resultFingerprintForVerify(repository.resultPath, failures);
  if (current == null) return false;
  compareField(
    failures,
    "RESULT_CHANGED",
    "MERGED result bytes, size, or permissions changed",
    JSON.stringify(resultStableFingerprint(current)),
    JSON.stringify(resultStableFingerprint(repository.baseline.resultFingerprint)),
  );
  return true;
}

function resultStableFingerprint(fingerprint) {
  return {
    sha256: fingerprint.sha256,
    size: fingerprint.size,
    permissions: fingerprint.permissions,
  };
}

function verifySavedDuringApp(repository, manifest, environment, failures) {
  verifyConflictIdentity(repository, manifest, environment, failures);
  verifyResultChangedAndResolved(repository, failures);
  verifyBackupPresent(repository, failures);
  verifyRepositorySidecars(
    repository,
    { allowBackups: true, allowGitTemps: true },
    failures,
  );
}

function verifySavedPostConfirm(repository, manifest, environment, failures) {
  const identity = captureRepositoryIdentity(repository.path, environment);
  verifyRepositoryIdentity(repository, identity, false, failures);
  verifyImmutableFiles(repository, failures);
  verifyImmutableIndexEntries(repository, environment, failures);
  verifyLocalConfigUnchanged(
    repository,
    captureNonToolLocalConfig(repository.path, environment),
    failures,
  );
  verifyToolConfigUnchanged(repository, manifest, environment, failures);
  const resultAvailable = verifyResultChangedAndResolved(repository, failures);
  verifyBackupPresent(repository, failures);
  verifyNoGitTempResidue(repository, failures);
  verifyRepositorySidecars(
    repository,
    { allowBackups: true, allowGitTemps: false, allowOrig: true },
    failures,
  );
  verifyNoGitLockResidue(repository, environment, failures);

  const unmerged = readUnmergedEntries(repository.path, environment);
  if (unmerged.length !== 0) {
    addFailure(failures, "INDEX_STILL_UNMERGED", "Git wrapper did not clear unmerged stages");
  }
  const stageZero = gitText(
    repository.path,
    ["ls-files", "--stage", "--", RESULT_NAME],
    environment,
  ).trim();
  const resultFlags = captureIndexFlags(repository.path, environment).filter(
    ({ path: filePath }) => filePath === RESULT_NAME,
  );
  compareField(
    failures,
    "STAGED_RESULT_FLAGS_CHANGED",
    "resolved Result has unexpected index flags",
    JSON.stringify(resultFlags),
    JSON.stringify([{ flag: "H", path: RESULT_NAME }]),
  );
  const match = stageZero.match(/^([0-9]+) ([0-9a-f]+) 0\t(.+)$/s);
  if (!match || match[3] !== RESULT_NAME) {
    addFailure(failures, "STAGE_ZERO_MISSING", "resolved Result is not staged at stage 0");
  } else if (resultAvailable) {
    if (match[1] !== repository.baseline.resultMode) {
      addFailure(
        failures,
        "STAGED_RESULT_MODE_CHANGED",
        "stage 0 mode does not match the original Result mode",
      );
    }
    const resultObject = gitText(
      repository.path,
      ["hash-object", "--", RESULT_NAME],
      environment,
    ).trim();
    if (match[2] !== resultObject) {
      addFailure(failures, "STAGED_RESULT_MISMATCH", "stage 0 object does not match Result bytes");
    }
  }
}

function verifyResultChangedAndResolved(repository, failures) {
  const current = resultFingerprintForVerify(repository.resultPath, failures);
  if (current == null) return false;
  if (current.sha256 === repository.baseline.resultSha256) {
    addFailure(failures, "RESULT_UNCHANGED", "MERGED result did not change");
  }
  if (current.permissions !== repository.baseline.resultFingerprint.permissions) {
    addFailure(
      failures,
      "RESULT_PERMISSIONS_CHANGED",
      "MERGED result permissions do not match the original file",
    );
  }
  if (hasConflictMarkers(repository.resultPath)) {
    addFailure(failures, "RESULT_UNRESOLVED", "MERGED result still contains conflict markers");
  }
  return true;
}

function resultFingerprintForVerify(path, failures) {
  return regularFileFingerprintForVerify(path, failures, {
    missingCode: "RESULT_MISSING",
    missingMessage: "MERGED result file is missing",
    invalidCode: "RESULT_NOT_REGULAR",
    invalidMessage: "MERGED result must be a regular non-symlink file",
    unreadableCode: "RESULT_UNREADABLE",
    unreadableMessage: "MERGED result bytes could not be read",
  });
}

function regularFileFingerprintForVerify(path, failures, messages) {
  let metadata;
  try {
    metadata = lstatSync(path);
  } catch (error) {
    if (error?.code === "ENOENT") {
      addFailure(failures, messages.missingCode, messages.missingMessage);
      return null;
    }
    addFailure(failures, messages.unreadableCode, messages.unreadableMessage);
    return null;
  }
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    addFailure(failures, messages.invalidCode, messages.invalidMessage);
    return null;
  }
  try {
    return captureFileFingerprint(path);
  } catch {
    addFailure(failures, messages.unreadableCode, messages.unreadableMessage);
    return null;
  }
}

function verifyImmutableFiles(repository, failures) {
  let complete = true;
  const current = repository.baseline.immutableFiles.flatMap(({ path: filePath }) => {
    const fingerprint = regularFileFingerprintForVerify(join(repository.path, filePath), failures, {
      missingCode: "OTHER_FILE_MISSING",
      missingMessage: "a non-Result fixture file is missing",
      invalidCode: "OTHER_FILE_NOT_REGULAR",
      invalidMessage: "a non-Result fixture file is not a regular non-symlink file",
      unreadableCode: "OTHER_FILE_UNREADABLE",
      unreadableMessage: "a non-Result fixture file could not be read",
    });
    if (fingerprint == null) {
      complete = false;
      return [];
    }
    return [{ path: filePath, ...fingerprint }];
  });
  if (!complete) return;
  compareField(
    failures,
    "OTHER_FILE_CHANGED",
    "a non-Result fixture file changed",
    JSON.stringify(current),
    JSON.stringify(repository.baseline.immutableFiles),
  );
}

function verifyImmutableIndexEntries(repository, environment, failures) {
  const current = captureIndexEntries(repository.path, environment).filter(
    ({ path: filePath }) => filePath !== RESULT_NAME,
  );
  compareField(
    failures,
    "OTHER_INDEX_ENTRY_CHANGED",
    "a non-Result index entry changed",
    JSON.stringify(current),
    JSON.stringify(repository.baseline.immutableIndexEntries),
  );
  const currentFlags = captureIndexFlags(repository.path, environment).filter(
    ({ path: filePath }) => filePath !== RESULT_NAME,
  );
  compareField(
    failures,
    "OTHER_INDEX_FLAGS_CHANGED",
    "a non-Result index flag changed",
    JSON.stringify(currentFlags),
    JSON.stringify(repository.baseline.immutableIndexFlags),
  );
}

function verifyLocalConfigUnchanged(repository, current, failures) {
  compareField(
    failures,
    "LOCAL_CONFIG_CHANGED",
    "repository-local config changed outside Forktail tool keys",
    JSON.stringify(current),
    JSON.stringify(repository.baseline.localConfigEntries),
  );
}

function verifyToolConfigUnchanged(repository, manifest, environment, failures) {
  let receipt;
  try {
    receipt = readToolConfigReceipt(manifest);
  } catch {
    addFailure(
      failures,
      existsSync(manifest.paths.toolConfigReceipt)
        ? "TOOL_CONFIG_RECEIPT_INVALID"
        : "TOOL_CONFIG_RECEIPT_MISSING",
      "installed Git tool config receipt is missing or invalid",
    );
    return;
  }
  const expected = receipt.entries;

  const current = [];
  for (const key of CONFIG_KEYS) {
    let values;
    try {
      values = readOptionalLocalConfigValues(repository.path, key, environment);
    } catch {
      addFailure(failures, "TOOL_CONFIG_CHANGED", "installed Git tool config could not be read");
      return;
    }
    if (values.length !== 1 || values[0].length === 0) {
      addFailure(
        failures,
        "TOOL_CONFIG_CHANGED",
        "installed Git tool config key is missing or duplicated",
      );
      return;
    }
    current.push({ key, valueSha256: sha256(Buffer.from(values[0])) });
  }
  compareField(
    failures,
    "TOOL_CONFIG_CHANGED",
    "installed Git tool config differs from its receipt",
    JSON.stringify(current),
    JSON.stringify(expected),
  );
  const repositoryKey = repositoryKeyForManifest(manifest, repository);
  compareField(
    failures,
    "TOOL_CONFIG_CHANGED",
    "repository-local config bytes differ from the installed receipt",
    fileSha256(join(repository.path, ".git", "config")),
    receipt.repositoryConfigSha256[repositoryKey],
  );
}

function verifyExternalChangePreserved(manifest, repository, failures) {
  const current = resultFingerprintForVerify(repository.resultPath, failures);
  if (current == null) return;
  if (current.sha256 === repository.baseline.resultSha256) {
    addFailure(failures, "EXTERNAL_CHANGE_MISSING", "MERGED result did not change externally");
  }

  let receipt;
  try {
    receipt = readExternalChangeReceipt(manifest);
  } catch {
    addFailure(
      failures,
      existsSync(manifest.paths.externalChangeReceipt)
        ? "EXTERNAL_CHANGE_RECEIPT_INVALID"
        : "EXTERNAL_CHANGE_RECEIPT_MISSING",
      "external writer fingerprint receipt is missing or invalid",
    );
    return;
  }
  compareField(
    failures,
    "EXTERNAL_CHANGE_OVERWRITTEN",
    "MERGED no longer matches the captured external writer fingerprint",
    JSON.stringify(current),
    JSON.stringify(receipt.resultFingerprint),
  );
}

function verifyNoGitLockResidue(repository, environment, failures) {
  const gitDirectory = gitDirectoryForRepository(repository.path, environment);
  const pending = [gitDirectory];
  while (pending.length > 0) {
    const directory = pending.pop();
    for (const name of readdirSync(directory)) {
      const candidate = join(directory, name);
      const metadata = lstatSync(candidate);
      if (name.endsWith(".lock")) {
        addFailure(failures, "GIT_LOCK_RESIDUE", "Git metadata contains a leftover lock");
        return;
      }
      if (metadata.isDirectory() && !metadata.isSymbolicLink()) pending.push(candidate);
    }
  }
}

function verifyNoBackups(repository, failures) {
  if (findForktailBackups(repository).length > 0) {
    addFailure(failures, "UNEXPECTED_BACKUP", "no-save produced a Forktail backup");
  }
}

function verifyBackupPresent(repository, failures) {
  const backups = findForktailBackups(repository);
  if (backups.length === 0) {
    addFailure(failures, "BACKUP_MISSING", "safe save did not leave a Forktail backup");
  } else if (backups.some((path) => fileSha256(path) !== repository.baseline.resultSha256)) {
    addFailure(
      failures,
      "BACKUP_CONTENT_MISMATCH",
      "every Forktail backup must match the original Result bytes",
    );
  }
}

function findForktailBackups(repository) {
  return readdirSync(dirname(repository.resultPath)).flatMap((name) => {
    const candidate = join(dirname(repository.resultPath), name);
    if (!isForktailBackupName(repository, name)) return [];
    const metadata = lstatSync(candidate);
    return metadata.isFile() && !metadata.isSymbolicLink() ? [candidate] : [];
  });
}

function verifyRepositorySidecars(repository, options, failures) {
  const baseline = new Set(repository.baseline.topLevelEntries);
  for (const name of readdirSync(repository.path)) {
    if (baseline.has(name)) continue;
    const isOrig = name === `${RESULT_NAME}.orig`;
    const allowed = (options.allowOrig && isOrig)
      || (options.allowBackups && isForktailBackupName(repository, name))
      || (options.allowGitTemps && isGitMergetoolTemp(name));
    if (!allowed) {
      addFailure(failures, "UNEXPECTED_SIDECAR", "an unexpected repository sidecar remains");
      continue;
    }
    const metadata = lstatSync(join(repository.path, name));
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      addFailure(
        failures,
        "UNSAFE_SIDECAR",
        "an allowed sidecar name is not a regular non-symlink file",
      );
    } else if (isOrig && fileSha256(join(repository.path, name)) !== repository.baseline.resultSha256) {
      addFailure(
        failures,
        "GIT_ORIG_CONTENT_MISMATCH",
        "Git .orig backup does not match the original Result bytes",
      );
    }
  }
}

function isForktailBackupName(repository, name) {
  const escapedName = basename(repository.resultPath).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escapedName}\\.bak\\.[0-9]+(?:\\.[0-9]+)?$`).test(name);
}

function verifyNoGitTempResidue(repository, failures) {
  const residue = readdirSync(repository.path).filter(isGitMergetoolTemp);
  if (residue.length > 0) {
    addFailure(failures, "TEMP_RESIDUE", "Git mergetool temp files remain after process exit");
  }
}

function isGitMergetoolTemp(name) {
  const extension = extname(RESULT_NAME).replace(".", "\\.");
  const stem = basename(RESULT_NAME, extname(RESULT_NAME));
  return new RegExp(`^${stem}_(?:BASE|LOCAL|REMOTE|BACKUP)_[0-9]+${extension}$`).test(name);
}

function hasConflictMarkers(path) {
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  return lines.some((line) => /^<{7}(?: |$)/.test(line))
    && lines.some((line) => /^={7}$/.test(line))
    && lines.some((line) => /^>{7}(?: |$)/.test(line));
}

function repositoryForVerifyScenario(manifest, scenario) {
  if (scenario === "mergetool-missing-base-no-save") {
    return manifest.repositories.mergetoolMissingBase;
  }
  if (scenario === "mergetool-empty-base-no-save") {
    return manifest.repositories.mergetoolEmptyBase;
  }
  return manifest.repositories.mergetoolSave;
}

function compareField(failures, code, message, current, expected) {
  if (current !== expected) addFailure(failures, code, message);
}

function addFailure(failures, code, message) {
  failures.push({ code, message });
}

function readSingleConfigValue(cwd, configPath, key, environment) {
  const result = runGit(
    cwd,
    ["config", "--file", configPath, "--get-all", key],
    environment,
    true,
  );
  if (result.status !== 0) throw new Error(`missing required config key: ${key}`);
  const values = result.stdout.toString("utf8").trimEnd().split("\n");
  if (values.length !== 1 || values[0].length === 0) {
    throw new Error(`config key must appear exactly once: ${key}`);
  }
  return values[0];
}

function toolConfigEntries(values) {
  return CONFIG_KEYS.map((key) => ({
    key,
    valueSha256: sha256(Buffer.from(values[key])),
  }));
}

function existingToolConfigReceiptForInstall(manifest, values) {
  if (!existsSync(manifest.paths.toolConfigReceipt)) return null;
  const existing = readToolConfigReceipt(manifest);
  if (JSON.stringify(existing.entries) !== JSON.stringify(toolConfigEntries(values))) {
    throw new Error("Git tool config differs from the existing fixture receipt");
  }
  for (const key of REPOSITORY_KEYS) {
    const current = fileSha256(join(manifest.repositories[key].path, ".git", "config"));
    if (current !== existing.repositoryConfigSha256[key]) {
      throw new Error("repository-local config bytes differ from the existing fixture receipt");
    }
  }
  return existing;
}

function finalizeToolConfigReceipt(manifest, values, existing) {
  const receipt = {
    issue: ISSUE,
    schemaVersion: SCHEMA_VERSION,
    kind: "tool-config",
    fixtureCreatedAt: manifest.createdAt,
    entries: toolConfigEntries(values),
    repositoryConfigSha256: Object.fromEntries(
      REPOSITORY_KEYS.map((key) => [
        key,
        fileSha256(join(manifest.repositories[key].path, ".git", "config")),
      ]),
    ),
  };
  if (existing != null) {
    if (JSON.stringify(existing) !== JSON.stringify(receipt)) {
      throw new Error("repository-local config bytes differ from the existing fixture receipt");
    }
    return;
  }
  writeNewReceipt(manifest.paths.toolConfigReceipt, receipt);
}

function readToolConfigReceipt(manifest) {
  const receipt = readJsonReceipt(manifest.paths.toolConfigReceipt, "Git tool config receipt");
  if (
    receipt?.issue !== ISSUE
    || receipt?.schemaVersion !== SCHEMA_VERSION
    || receipt?.kind !== "tool-config"
    || receipt?.fixtureCreatedAt !== manifest.createdAt
    || !Array.isArray(receipt.entries)
    || receipt.entries.length !== CONFIG_KEYS.length
    || JSON.stringify(Object.keys(receipt.repositoryConfigSha256 ?? {}).sort())
      !== JSON.stringify([...REPOSITORY_KEYS].sort())
  ) {
    throw new Error("invalid Git tool config receipt");
  }
  for (let index = 0; index < CONFIG_KEYS.length; index += 1) {
    const entry = receipt.entries[index];
    if (entry?.key !== CONFIG_KEYS[index] || !/^[0-9a-f]{64}$/.test(entry?.valueSha256 ?? "")) {
      throw new Error("invalid Git tool config receipt entry");
    }
  }
  for (const key of REPOSITORY_KEYS) {
    if (!/^[0-9a-f]{64}$/.test(receipt.repositoryConfigSha256[key] ?? "")) {
      throw new Error("invalid repository-local config receipt entry");
    }
  }
  return receipt;
}

function readExternalChangeReceipt(manifest) {
  const receipt = readJsonReceipt(
    manifest.paths.externalChangeReceipt,
    "external change receipt",
  );
  if (
    receipt?.issue !== ISSUE
    || receipt?.schemaVersion !== SCHEMA_VERSION
    || receipt?.kind !== "external-change"
    || receipt?.fixtureCreatedAt !== manifest.createdAt
    || receipt?.repositoryHead !== manifest.repositories.mergetoolSave.baseline.head
    || receipt?.baselineResultSha256
      !== manifest.repositories.mergetoolSave.baseline.resultSha256
    || !isValidFileFingerprint(receipt.resultFingerprint)
  ) {
    throw new Error("invalid external change receipt");
  }
  return receipt;
}

function readJsonReceipt(path, label) {
  const resolved = resolveRegularFile(path, label);
  return JSON.parse(readFileSync(resolved, "utf8"));
}

function writeNewReceipt(path, receipt) {
  if (existsSync(path)) {
    throw new Error("fixture receipt already exists; prepare a fresh disposable fixture");
  }
  writeFileSync(path, `${JSON.stringify(receipt, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
    flush: true,
  });
}

function validateToolConfig(values) {
  for (const token of ["--difftool", "$LOCAL", "$REMOTE"]) {
    if (!values["difftool.forktail.cmd"].includes(token)) {
      throw new Error(`difftool command is missing required token: ${token}`);
    }
  }
  for (const token of ["--mergetool", "$base_present", "$BASE", "$LOCAL", "$REMOTE", "$MERGED"]) {
    if (!values["mergetool.forktail.cmd"].includes(token)) {
      throw new Error(`mergetool command is missing required token: ${token}`);
    }
  }
  if (values["mergetool.forktail.trustExitCode"].toLowerCase() !== "false") {
    throw new Error("mergetool.forktail.trustExitCode must be false");
  }
  if (values["mergetool.forktail.hideResolved"].toLowerCase() !== "false") {
    throw new Error("mergetool.forktail.hideResolved must be false");
  }
}

function assertToolConfigInstalled(repository, environment) {
  for (const defaultKey of ["diff.tool", "merge.tool"]) {
    if (gitExit(repository.path, ["config", "--local", "--get", defaultKey], environment) === 0) {
      throw new Error(`fixture repository defines forbidden default key: ${defaultKey}`);
    }
  }
  assertFixtureLocalConfigUnchanged(repository, environment);
  const values = Object.fromEntries(
    CONFIG_KEYS.map((key) => [
      key,
      readSingleLocalConfigValue(repository.path, key, environment),
    ]),
  );
  validateToolConfig(values);
}

function assertToolConfigMatchesReceipt(repository, manifest, environment) {
  const receipt = readToolConfigReceipt(manifest);
  const expected = receipt.entries;
  const values = Object.fromEntries(
    CONFIG_KEYS.map((key) => [
      key,
      readSingleLocalConfigValue(repository.path, key, environment),
    ]),
  );
  if (JSON.stringify(toolConfigEntries(values)) !== JSON.stringify(expected)) {
    throw new Error("installed Git tool config differs from its fixture receipt");
  }
  const repositoryKey = repositoryKeyForManifest(manifest, repository);
  if (
    fileSha256(join(repository.path, ".git", "config"))
    !== receipt.repositoryConfigSha256[repositoryKey]
  ) {
    throw new Error("repository-local config bytes differ from the fixture receipt");
  }
}

function repositoryKeyForManifest(manifest, repository) {
  const key = REPOSITORY_KEYS.find(
    (candidate) => manifest.repositories[candidate].path === repository.path,
  );
  if (!key) throw new Error("repository is not part of the Git tool smoke manifest");
  return key;
}

function readSingleLocalConfigValue(repository, key, environment) {
  const values = readOptionalLocalConfigValues(repository, key, environment);
  if (values.length === 0) throw new Error(`missing required local config key: ${key}`);
  if (values.length !== 1 || values[0].length === 0) {
    throw new Error(`local config key must appear exactly once: ${key}`);
  }
  return values[0];
}

function readOptionalLocalConfigValues(repository, key, environment) {
  const result = runGit(
    repository,
    ["config", "--local", "--null", "--get-all", key],
    environment,
    true,
  );
  if (result.status === 1) return [];
  if (result.status !== 0) throw new Error(`could not read local config key: ${key}`);
  const values = result.stdout.toString("utf8").split("\0");
  if (values.at(-1) === "") values.pop();
  return values;
}

function loadManifestEnvelope(manifestPath) {
  const resolvedManifest = resolveRegularFile(manifestPath, "manifest");
  const manifest = validateManifestObject(JSON.parse(readFileSync(resolvedManifest, "utf8")));
  const root = resolveRealDirectory(manifest.root, "fixture root");
  const manifestDirectory = resolveRealDirectory(dirname(resolvedManifest), "manifest directory");
  if (!sameFilesystemEntry(root, manifestDirectory)) {
    throw new Error("manifest root must contain the manifest");
  }

  const expectedManifestPath = resolve(manifest.root, "manifest.json");
  if (resolve(manifest.paths.manifest) !== expectedManifestPath) {
    throw new Error("manifest does not match fixture layout");
  }
  const recordedManifest = resolveRegularFile(expectedManifestPath, "recorded manifest");
  if (!sameFilesystemEntry(recordedManifest, resolvedManifest)) {
    throw new Error("manifest path does not match its recorded identity");
  }
  assertExpectedFile(recordedManifest, join(manifest.root, "manifest.json"), root, "manifest");
  const expectedProvenancePath = resolve(manifest.root, "fixture-provenance.json");
  if (resolve(manifest.paths.provenance) !== expectedProvenancePath) {
    throw new Error("fixture provenance does not match fixture layout");
  }
  const provenance = resolveRegularFile(expectedProvenancePath, "fixture provenance");
  assertExpectedFile(
    provenance,
    join(manifest.root, "fixture-provenance.json"),
    root,
    "fixture provenance",
  );
  validateManifestProvenance(manifest, resolvedManifest, provenance);
  return { manifest, root };
}

function loadManifestForCleanup(manifestPath) {
  const { manifest } = loadManifestEnvelope(manifestPath);
  assertCleanupLayout(manifest);
  return manifest;
}

function loadManifest(manifestPath) {
  const { manifest, root } = loadManifestEnvelope(manifestPath);

  for (const [key, expectedName, label] of [
    ["isolatedHome", "isolated-home", "isolated HOME"],
    ["isolatedXdg", "isolated-xdg", "isolated XDG directory"],
    ["artifactDir", "artifact path O'Brien 한글", "artifact staging directory"],
    ["reportOutputDir", "report-output", "report output directory"],
  ]) {
    const actual = resolveRealDirectory(manifest.paths[key], label);
    assertContained(root, actual, label);
    const expected = resolveRealDirectory(join(manifest.root, expectedName), `${label} layout`);
    if (!sameFilesystemEntry(actual, expected)) {
      throw new Error(`${label} does not match fixture layout`);
    }
  }

  for (const [key, expectedName, label] of [
    ["checklist", "GIT_TOOL_SMOKE_CHECKLIST.md", "checklist"],
    ["configTemplate", "GIT_TOOL_CONFIG.gitconfig", "config template"],
    ["emptyGlobalConfig", join("isolated-home", "empty-global.gitconfig"), "empty global config"],
  ]) {
    const actual = resolveRegularFile(manifest.paths[key], label);
    assertExpectedFile(actual, join(manifest.root, expectedName), root, label);
  }
  if (statSync(manifest.paths.emptyGlobalConfig).size !== 0) {
    throw new Error("empty global config must remain a zero-byte file");
  }
  for (const [key, expectedName, label] of [
    ["toolConfigReceipt", "tool-config-receipt.json", "Git tool config receipt"],
    ["externalChangeReceipt", "external-change-receipt.json", "external change receipt"],
  ]) {
    assertOptionalFixtureFile(manifest.paths[key], join(manifest.root, expectedName), root, label);
  }

  const repositoryLayouts = [
    ["difftool", "difftool repo", "difftool repository"],
    ["mergetoolSave", "mergetool save repo", "mergetool save repository"],
    ["mergetoolMissingBase", "mergetool missing base repo", "missing-Base repository"],
    ["mergetoolEmptyBase", "mergetool empty base repo", "empty-Base repository"],
  ];
  const resolvedRepositories = repositoryLayouts.map(([key, expectedName, label]) => {
    const path = resolveRealDirectory(manifest.repositories[key].path, label);
    assertContained(root, path, label);
    return { key, expectedName, label, path };
  });
  const hasDuplicateRepository = resolvedRepositories.some(({ path }, index) =>
    resolvedRepositories.slice(0, index).some(({ path: earlierPath }) =>
      sameFilesystemEntry(path, earlierPath),
    ),
  );
  if (hasDuplicateRepository) {
    throw new Error("fixture repository paths must be unique");
  }
  for (const { key, expectedName, label, path } of resolvedRepositories) {
    const expected = resolveRealDirectory(join(manifest.root, expectedName), `${label} layout`);
    if (!sameFilesystemEntry(path, expected)) {
      throw new Error(`${label} does not match fixture layout`);
    }
    const gitDirectory = resolveRealDirectory(
      join(manifest.repositories[key].path, ".git"),
      `${label} metadata`,
    );
    assertContained(path, gitDirectory, `${label} metadata`);
    for (const metadataName of ["config", "index"]) {
      const metadataPath = resolveRegularFile(
        join(manifest.repositories[key].path, ".git", metadataName),
        `${label} ${metadataName}`,
      );
      assertContained(gitDirectory, realpathSync(metadataPath), `${label} ${metadataName}`);
    }
    if (key !== "difftool") {
      const expectedResult = resolve(manifest.repositories[key].path, RESULT_NAME);
      if (resolve(manifest.repositories[key].resultPath) !== expectedResult) {
        throw new Error(`invalid Result path for ${key}`);
      }
    }
  }
  const environment = isolatedGitEnvironment(manifest.paths);
  assertCurrentGitMatchesManifest(manifest, environment);
  verifyRecordedRevisions(manifest, environment);
  return manifest;
}

function validateManifestProvenance(manifest, manifestPath, provenancePath) {
  const provenance = JSON.parse(readFileSync(provenancePath, "utf8"));
  if (
    provenance?.issue !== ISSUE
    || provenance?.schemaVersion !== SCHEMA_VERSION
    || provenance?.kind !== "manifest-provenance"
    || provenance?.fixtureCreatedAt !== manifest.createdAt
    || !/^[0-9a-f]{64}$/.test(provenance?.manifestSha256 ?? "")
  ) {
    throw new Error("invalid fixture provenance");
  }
  if (provenance.manifestSha256 !== fileSha256(manifestPath)) {
    throw new Error("manifest provenance digest mismatch");
  }
}

function assertCleanupLayout(manifest) {
  const expectedPaths = {
    manifest: "manifest.json",
    provenance: "fixture-provenance.json",
    checklist: "GIT_TOOL_SMOKE_CHECKLIST.md",
    configTemplate: "GIT_TOOL_CONFIG.gitconfig",
    toolConfigReceipt: "tool-config-receipt.json",
    externalChangeReceipt: "external-change-receipt.json",
    isolatedHome: "isolated-home",
    isolatedXdg: "isolated-xdg",
    emptyGlobalConfig: join("isolated-home", "empty-global.gitconfig"),
    artifactDir: "artifact path O'Brien 한글",
    reportOutputDir: "report-output",
  };
  for (const [key, expected] of Object.entries(expectedPaths)) {
    if (resolve(manifest.paths[key]) !== resolve(manifest.root, expected)) {
      throw new Error(`invalid cleanup fixture path: ${key}`);
    }
  }
  const repositoryLayouts = {
    difftool: "difftool repo",
    mergetoolSave: "mergetool save repo",
    mergetoolMissingBase: "mergetool missing base repo",
    mergetoolEmptyBase: "mergetool empty base repo",
  };
  for (const [key, expected] of Object.entries(repositoryLayouts)) {
    const repository = manifest.repositories[key];
    if (resolve(repository.path) !== resolve(manifest.root, expected)) {
      throw new Error(`invalid cleanup repository path: ${key}`);
    }
    if (key !== "difftool" && resolve(repository.resultPath) !== resolve(repository.path, RESULT_NAME)) {
      throw new Error(`invalid cleanup Result path: ${key}`);
    }
  }
}

function validateManifestObject(manifest) {
  if (manifest?.issue !== ISSUE || manifest?.schemaVersion !== SCHEMA_VERSION) {
    throw new Error("unsupported Git tool smoke manifest");
  }
  if (!isAbsolute(manifest.root) || manifest.repositories == null || manifest.paths == null) {
    throw new Error("invalid Git tool smoke manifest");
  }
  if (
    typeof manifest.createdAt !== "string"
    || Number.isNaN(Date.parse(manifest.createdAt))
    || new Date(manifest.createdAt).toISOString() !== manifest.createdAt
  ) {
    throw new Error("invalid Git tool smoke creation time");
  }
  assertSupportedGitVersion(manifest.gitVersion);
  for (const key of [
    "manifest",
    "provenance",
    "checklist",
    "configTemplate",
    "toolConfigReceipt",
    "externalChangeReceipt",
    "isolatedHome",
    "isolatedXdg",
    "emptyGlobalConfig",
    "artifactDir",
    "reportOutputDir",
  ]) {
    if (!isAbsolute(manifest.paths[key] ?? "")) {
      throw new Error(`invalid fixture path: ${key}`);
    }
  }
  const repositoryKeys = Object.keys(manifest.repositories).sort();
  if (JSON.stringify(repositoryKeys) !== JSON.stringify([...REPOSITORY_KEYS].sort())) {
    throw new Error("unexpected fixture repository keys");
  }
  for (const key of REPOSITORY_KEYS) {
    if (!isAbsolute(manifest.repositories[key]?.path ?? "")) {
      throw new Error(`invalid fixture repository: ${key}`);
    }
    if (key !== "difftool" && !isAbsolute(manifest.repositories[key]?.resultPath ?? "")) {
      throw new Error(`invalid fixture Result path: ${key}`);
    }
    assertObjectId(manifest.repositories[key]?.baseRevision, `${key} base revision`);
    assertObjectId(manifest.repositories[key]?.baseline?.head, `${key} baseline HEAD`);
  }
  assertObjectId(manifest.repositories.difftool?.changedRevision, "difftool changed revision");
  if (manifest.repositories.difftool.changedRevision !== manifest.repositories.difftool.baseline.head) {
    throw new Error("difftool changed revision does not match its baseline HEAD");
  }
  return manifest;
}

function verifyRecordedRevisions(manifest, environment) {
  for (const key of REPOSITORY_KEYS) {
    const repository = manifest.repositories[key];
    for (const field of key === "difftool"
      ? ["baseRevision", "changedRevision"]
      : ["baseRevision"]) {
      const revision = repository[field];
      const resolved = gitText(
        repository.path,
        ["rev-parse", "--verify", `${revision}^{commit}`],
        environment,
      ).trim();
      if (resolved !== revision) throw new Error(`recorded ${key} ${field} is not the fixture commit`);
    }
  }
  const difftool = manifest.repositories.difftool;
  const parent = gitText(
    difftool.path,
    ["rev-parse", "--verify", `${difftool.changedRevision}^`],
    environment,
  ).trim();
  if (parent !== difftool.baseRevision) {
    throw new Error("recorded difftool revisions are not the fixture commit pair");
  }
}

function assertObjectId(value, label) {
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value ?? "")) {
    throw new Error(`invalid ${label}`);
  }
}

function resolveRegularFile(path, label) {
  if (!path) throw new Error(`missing ${label} path`);
  const resolvedPath = resolve(path);
  if (!existsSync(resolvedPath)) throw new Error(`${label} does not exist`);
  const metadata = lstatSync(resolvedPath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`${label} must be a regular file`);
  }
  return resolvedPath;
}

function resolveRealDirectory(path, label) {
  if (!path) throw new Error(`missing ${label} path`);
  const resolvedPath = resolve(path);
  if (!existsSync(resolvedPath)) throw new Error(`${label} does not exist`);
  const metadata = lstatSync(resolvedPath);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`${label} must be a real directory`);
  }
  return realpathSync(resolvedPath);
}

function assertExpectedFile(actual, expectedPath, root, label) {
  const expected = resolveRegularFile(expectedPath, `${label} layout`);
  const realActual = realpathSync(actual);
  assertContained(root, realActual, label);
  if (!sameFilesystemEntry(actual, expected)) {
    throw new Error(`${label} does not match fixture layout`);
  }
}

function assertOptionalFixtureFile(actualPath, expectedPath, root, label) {
  const actual = resolve(actualPath);
  const expected = resolve(expectedPath);
  const actualParent = resolveRealDirectory(dirname(actual), `${label} directory`);
  if (!sameFilesystemEntry(root, actualParent)) {
    throw new Error(`${label} is outside fixture root`);
  }
  if (actual !== expected) throw new Error(`${label} does not match fixture layout`);
  if (existsSync(actual)) resolveRegularFile(actual, label);
}

function sameFilesystemEntry(left, right) {
  const leftMetadata = statSync(left);
  const rightMetadata = statSync(right);
  const hasStableIdentity = leftMetadata.dev !== 0
    || leftMetadata.ino !== 0
    || rightMetadata.dev !== 0
    || rightMetadata.ino !== 0;
  if (hasStableIdentity) {
    return leftMetadata.dev === rightMetadata.dev && leftMetadata.ino === rightMetadata.ino;
  }
  const normalizeRealPath = (path) => {
    const normalized = realpathSync(path).normalize("NFC");
    return process.platform === "win32" ? normalized.toLowerCase() : normalized;
  };
  return normalizeRealPath(left) === normalizeRealPath(right);
}

function assertContained(root, candidate, label) {
  const pathFromRoot = relative(root, candidate);
  if (pathFromRoot !== "" && !pathFromRoot.startsWith("..") && !isAbsolute(pathFromRoot)) return;
  throw new Error(`${label} is outside fixture root`);
}

export function isolatedGitEnvironment(paths, inheritedEnvironment = process.env) {
  return {
    ...sanitizedGitEnvironment(inheritedEnvironment),
    HOME: paths.isolatedHome,
    USERPROFILE: paths.isolatedHome,
    XDG_CONFIG_HOME: paths.isolatedXdg,
    GIT_CONFIG_GLOBAL: paths.emptyGlobalConfig,
  };
}

function sanitizedGitEnvironment(inheritedEnvironment = process.env) {
  const environment = {};
  for (const [key, value] of Object.entries(inheritedEnvironment)) {
    if (!/^GIT_/i.test(key)) environment[key] = value;
  }
  return {
    ...environment,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_ATTR_NOSYSTEM: "1",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_TERMINAL_PROMPT: "0",
  };
}

function git(cwd, args, environment) {
  const result = runGit(cwd, args, environment, false);
  return result.stdout;
}

function gitBuffer(cwd, args, environment) {
  return git(cwd, args, environment);
}

function gitText(cwd, args, environment) {
  return git(cwd, args, environment).toString("utf8");
}

function gitExit(cwd, args, environment) {
  return runGit(cwd, args, environment, true).status;
}

function runGit(cwd, args, environment, allowFailure) {
  const result = spawnSync("git", args, {
    cwd,
    env: environment,
    encoding: null,
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  });
  if (result.error) throw new Error(`could not start Git operation: ${args[0] ?? "unknown"}`);
  if (!allowFailure && result.status !== 0) {
    throw new Error(`Git fixture operation failed: ${args[0] ?? "unknown"} (exit ${result.status})`);
  }
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? Buffer.alloc(0),
  };
}

function fileSha256(path) {
  return sha256(readFileSync(path));
}

function captureFileFingerprint(path) {
  const metadata = lstatSync(path, { bigint: true });
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error("fixture fingerprint target must be a regular non-symlink file");
  }
  return {
    sha256: fileSha256(path),
    size: metadata.size.toString(),
    mtimeNs: metadata.mtimeNs.toString(),
    permissions: (metadata.mode & 0o777n).toString(8).padStart(3, "0"),
  };
}

function isValidFileFingerprint(value) {
  return value != null
    && /^[0-9a-f]{64}$/.test(value.sha256 ?? "")
    && /^[0-9]+$/.test(value.size ?? "")
    && /^-?[0-9]+$/.test(value.mtimeNs ?? "")
    && /^[0-7]{3}$/.test(value.permissions ?? "");
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function buildChecklist(manifest) {
  const { paths, repositories } = manifest;
  return `# T009 Git Difftool/Mergetool Packaged Smoke Checklist

Generated: ${manifest.createdAt}
Fixture manifest: \`${paths.manifest}\`

This checklist collects real packaged-app evidence. The verifier checks fixture bytes and metadata, Git
operation state, refs, index bytes/mtime/stages/flags, exact installed tool config, backups, unexpected
sidecars, locks, and repository-local mergetool temp cleanup. Difftool temp lifetime is direct process
observation. The verifier does **not** replace actual UI observation. Keep every OS/tool cell in
\`VALIDATION.md\` pending when any required UI or lifecycle step is manual-not-run.

Do not paste file contents, raw stderr, full HOME paths, or crash dumps into release evidence.

## 1. Environment

- Date:
- OS / architecture:
- Git version:
- Forktail version and artifact identity:
- Packaged artifact path form:
- Disposable OS account/VM/profile identity:

The fixture redirects Git HOME/XDG/global config, but native platform known-folder APIs may ignore those
environment variables. Run packaged UI evidence in a disposable OS account, VM, or equivalent clean profile;
do not claim that the fixture root contains every WebView or application-state write.

Place or install the artifact under a path containing spaces, an apostrophe, and Unicode. The prepared
artifact staging directory is:

\`${paths.artifactDir}\`

Open Forktail → Git tool setup, enter the actual packaged executable path, and paste both generated snippets
into:

\`${paths.configTemplate}\`

Install only those tool-specific keys into all fixture repositories:

\`\`\`text
npm run smoke:git-tools:install -- "${paths.manifest}" "${paths.configTemplate}"
\`\`\`

- [ ] Install reports OK.
- [ ] No \`diff.tool\` or \`merge.tool\` default was created.
- [ ] Config uses \`trustExitCode=false\` and \`hideResolved=false\`.

## 2. Difftool — modified / added / deleted / sequential wait

Run:

\`\`\`text
npm run smoke:git-tools:run -- "${paths.manifest}" difftool
\`\`\`

- [ ] Git waits while each Forktail window is open and starts the next file only after Close Forktail.
- [ ] The filenames \`${DIFFTOOL_FILES.added}\`, \`${DIFFTOOL_FILES.deleted}\`, and
      \`${DIFFTOOL_FILES.modified}\` preserve spaces, apostrophes, and Unicode end to end.
- [ ] Added shows missing LOCAL; deleted shows missing REMOTE; modified shows both documents.
- [ ] Both panes and edit/save/save-as/hunk/swap/drop controls are read-only or disabled.
- [ ] F7 / Shift+F7 navigation works.
- [ ] Report export requires an explicit path under \`${paths.reportOutputDir}\` and does not reuse a Git temp path.
- [ ] LOCAL/REMOTE temp files exist while their window is open and are removed after it closes.

After the final window closes:

\`\`\`text
npm run smoke:git-tools:verify -- "${paths.manifest}" difftool-pristine
\`\`\`

- [ ] Verifier reports OK and the Git command exits 0.

## 3. Mergetool — unresolved hard block and no-save

Run the modify/modify fixture:

\`\`\`text
npm run smoke:git-tools:run -- "${paths.manifest}" mergetool-save
\`\`\`

- [ ] BASE/LOCAL/REMOTE and the existing MERGED Result are mapped correctly.
- [ ] Git remains blocked while Forktail is open; every non-missing Git-owned BASE/LOCAL/REMOTE temp path
      exists until that window closes.
- [ ] Save is blocked while conflict markers remain.
- [ ] In another terminal, this checkpoint reports OK while the app is still open:

\`\`\`text
npm run smoke:git-tools:verify -- "${paths.manifest}" mergetool-unresolved-blocked
\`\`\`

Close without saving, discard in-memory edits if prompted, and answer \`n\` if Git asks whether the
merge succeeded. Record whether the unchanged-file prompt appeared.

\`\`\`text
npm run smoke:git-tools:verify -- "${paths.manifest}" mergetool-no-save
\`\`\`

- [ ] Git exits non-zero as expected; Result bytes and unmerged index stages are unchanged; direct observation
      and the verifier show that Git-owned mergetool temps are cleaned.

## 4. Mergetool — safe save and wrapper post-exit stage

Run \`mergetool-save\` again. Resolve every marker and click Save, but keep Forktail open.

- [ ] Git is still waiting and Git-owned BASE/LOCAL/REMOTE temp files still exist before Forktail closes.

\`\`\`text
npm run smoke:git-tools:verify -- "${paths.manifest}" mergetool-save-during-app
\`\`\`

- [ ] Verifier reports Result changed, Forktail backup present, and index stages still unchanged.
- [ ] Among existing tracked files only MERGED changed; the expected new Forktail backup is allowed. Forktail
      did not run \`git add\` or continue.

Close Forktail. With \`trustExitCode=false\`, Git normally detects a newer saved MERGED file and stages it
without asking; if Git does ask whether the merge succeeded, answer \`y\`. Record which path occurred,
then run:

\`\`\`text
npm run smoke:git-tools:verify -- "${paths.manifest}" mergetool-save-post-confirm
\`\`\`

- [ ] Verifier reports no unmerged stages, stage-0 mode and object match Result, other index entries and
      refs/HEAD are unchanged, expected backup bytes match the original Result, and no unexpected sidecar or
      Git-owned mergetool temp remains.
- [ ] If Git leaves \`${RESULT_NAME}.orig\`, it appears only after post-confirm and matches the original Result bytes.

## 5. Mergetool — missing Base

Run the add/add fixture:

\`\`\`text
npm run smoke:git-tools:run -- "${paths.manifest}" mergetool-missing-base
\`\`\`

- [ ] Base is visibly missing, not an ordinary empty document.
- [ ] Git waits for Forktail; LOCAL/REMOTE temp paths exist until close and are cleaned after exit.
- [ ] LOCAL/REMOTE/Result remain available and unresolved Save is blocked.
- [ ] Close without save, answer \`n\` if Git asks whether the merge succeeded, and verify:

\`\`\`text
npm run smoke:git-tools:verify -- "${paths.manifest}" mergetool-missing-base-no-save
\`\`\`

## 6. Mergetool — real empty Base is not missing

Run the fixture whose real stage-1 object is an empty blob:

\`\`\`text
npm run smoke:git-tools:run -- "${paths.manifest}" mergetool-empty-base
\`\`\`

- [ ] Base is a present empty document, not a missing badge.
- [ ] Git waits for Forktail; the real empty BASE temp path remains present until close and is cleaned after exit.
- [ ] Close without save, answer \`n\` if Git asks whether the merge succeeded, and verify:

\`\`\`text
npm run smoke:git-tools:verify -- "${paths.manifest}" mergetool-empty-base-no-save
\`\`\`

## 7. Disposable failure and race fixtures

Prepare a new disposable harness root for **each** case below and install the same packaged-artifact config.
Do not reuse the primary evidence fixture. This keeps a crash, external writer, or failed launch from making a
later success checkpoint ambiguous.

\`\`\`text
npm run smoke:git-tools:prepare -- --root "<new-disposable-root>"
\`\`\`

### Launch failure

- [ ] Use only the artifact copy under its disposable staging directory. Temporarily make the configured
      executable unavailable, run \`difftool\`, and record the non-zero launch result.
- [ ] Restore the same executable immediately. \`difftool-pristine\` reports OK; no repository mutation is
      attributed to the failed launch, and temp cleanup is observed directly.

### App crash / forced termination

- [ ] Run disposable \`difftool\`, note the exact packaged process PID, and force-terminate only that PID
      while Git is waiting. Record Git's exit/continuation behavior and direct temp cleanup observation.
- [ ] \`difftool-pristine\` reports OK after Git exits. Do not collect or attach a content-bearing crash dump.

### External MERGED change and save race

- [ ] Run disposable \`mergetool-save\`. After Forktail opens, change MERGED from a second process, then pin
      that writer's bytes and metadata before attempting Save in Forktail:

\`\`\`text
npm run smoke:git-tools:capture-external -- "<disposable-manifest.json>"
\`\`\`

- [ ] The capture command reports OK exactly once. If it fails or must be repeated, dispose of the fixture.
- [ ] Attempt Save in Forktail.
- [ ] Forktail shows an actionable external-change failure and does not overwrite the external bytes, create a
      Forktail backup, stage, or continue. While Forktail remains open, this checkpoint reports OK:

\`\`\`text
npm run smoke:git-tools:verify -- "<disposable-manifest.json>" mergetool-external-change-blocked
\`\`\`

- [ ] Record Git's post-close behavior separately: Git may stage the **external writer's** newer MERGED file.
      Do not attribute that stage to Forktail. Dispose of this root instead of reusing it.

## 8. OS-specific gates

### Windows

- [ ] Installed \`.exe\` works from drive/backslash and space/apostrophe/Unicode paths; a separate UNC-path
      copy covers quoting and process wait.
- [ ] In a disposable fixture, an external deny-write file lock makes MERGED Save fail actionably without
      truncation or false success; release the lock before cleanup.
- [ ] After releasing the lock, close without saving, answer \`n\` if prompted, and run
      \`mergetool-no-save\`; Result/index/backup/temp invariants report OK.

### macOS

- [ ] Use the actual executable inside the packaged \`.app\` and record the signed/ad-hoc artifact identity;
      a launcher that returns immediately is not accepted.
- [ ] Equivalent NFC and NFD path spellings both launch/wait correctly and preserve fixture identity.

### Linux

- [ ] The supported AppImage/binary has the executable bit, waits independently of the desktop launcher, and a
      disposable no-execute copy fails without repository mutation.
- [ ] Record the tested distribution and glibc version. The minimum supported baseline is owned by \`REL-004\`
      and is not inferred or claimed from this T009 run.

## 9. Result summary

\`\`\`text
Difftool process/temp:       pass | fail | manual-not-run
Difftool UI/read-only:       pass | fail | manual-not-run
Difftool report export:      pass | fail | manual-not-run
Difftool launch/crash:       pass | fail | manual-not-run
Mergetool no-save:           pass | fail | manual-not-run
Mergetool process/temp/wait: pass | fail | manual-not-run
Mergetool save/index:        pass | fail | manual-not-run
Mergetool unresolved block:  pass | fail | manual-not-run
Mergetool external race:     pass | fail | manual-not-run
Mergetool missing Base:      pass | fail | manual-not-run
Mergetool real empty Base:   pass | fail | manual-not-run
OS-specific gates:           pass | fail | manual-not-run
\`\`\`

Every line must be \`pass\` before changing that OS/tool cell in \`VALIDATION.md\`. Otherwise use
\`fail\` or \`manual-not-run\` and keep the cell pending.

- [ ] The sanitized result summary, artifact identity, and pass/fail/manual-not-run evidence were transcribed into VALIDATION.md before fixture deletion.

## 10. Cleanup

Close Forktail and Git processes for each fixture, then remove only the root identified by its sealed
manifest and provenance marker. Cleanup intentionally tolerates damaged mutable repository state such as a
missing index, but it does not bypass manifest/root provenance validation:

\`\`\`text
npm run smoke:git-tools:cleanup -- "${paths.manifest}"
\`\`\`

- [ ] Cleanup reports OK and the fixture root no longer exists.
- [ ] Every disposable failure/race fixture was cleaned with its own manifest.
- [ ] No user repository, global config, credential helper, or remote was changed.

If the manifest or provenance marker itself is missing or corrupt, do not pass another path to the cleanup
command. Independently confirm the exact disposable root printed at preparation, remove only that root
manually after all processes close, and record the manual cleanup in VALIDATION.md.

Fixture repositories:

- Difftool: \`${repositories.difftool.path}\`
- Mergetool save: \`${repositories.mergetoolSave.path}\`
- Mergetool missing Base: \`${repositories.mergetoolMissingBase.path}\`
- Mergetool empty Base: \`${repositories.mergetoolEmptyBase.path}\`
`;
}

function printVerifyReport(report) {
  if (report.ok) {
    console.log(`[git-tool-smoke:verify] OK (${report.scenario})`);
    return 0;
  }
  console.error(`[git-tool-smoke:verify] FAILED (${report.scenario})`);
  for (const failure of report.failures) {
    console.error(`  - ${failure.code}: ${failure.message}`);
  }
  return 1;
}

function usage() {
  return `Usage:
  node scripts/git-tool-smoke.mjs [--json] [--root <new-directory>]
  node scripts/git-tool-smoke.mjs --install-config <manifest.json> <generated.gitconfig>
  node scripts/git-tool-smoke.mjs --run <manifest.json> <scenario>
  node scripts/git-tool-smoke.mjs --capture-external-change <manifest.json>
  node scripts/git-tool-smoke.mjs --verify <manifest.json> <scenario>
  node scripts/git-tool-smoke.mjs --cleanup <manifest.json>`;
}

export function main(args = process.argv.slice(2)) {
  try {
    if (args[0] === "--install-config") {
      if (args.length !== 3) throw new Error(usage());
      const result = installToolConfig({ manifestPath: args[1], configPath: args[2] });
      console.log(`[git-tool-smoke:install] OK (${result.repositories.length} repositories)`);
      return 0;
    }
    if (args[0] === "--run") {
      if (args.length !== 3) throw new Error(usage());
      const status = runGitToolScenario({ manifestPath: args[1], scenario: args[2] });
      console.log(`[git-tool-smoke:run] Git exit ${status} (${args[2]})`);
      return status;
    }
    if (args[0] === "--capture-external-change") {
      if (args.length !== 2) throw new Error(usage());
      captureExternalChangeFingerprint({ manifestPath: args[1] });
      console.log("[git-tool-smoke:capture-external-change] OK");
      return 0;
    }
    if (args[0] === "--verify") {
      if (args.length !== 3) throw new Error(usage());
      return printVerifyReport(verifyGitToolSmoke({ manifestPath: args[1], scenario: args[2] }));
    }
    if (args[0] === "--cleanup") {
      if (args.length !== 2) throw new Error(usage());
      const result = cleanupGitToolSmoke({ manifestPath: args[1] });
      console.log(`[git-tool-smoke:cleanup] OK (${result.root})`);
      return 0;
    }

    const jsonOnly = args.includes("--json");
    const rootIndex = args.indexOf("--root");
    const rootValue = rootIndex === -1 ? undefined : args[rootIndex + 1];
    const knownLength = (jsonOnly ? 1 : 0) + (rootIndex === -1 ? 0 : 2);
    if (
      args.length !== knownLength
      || (rootIndex !== -1 && (!rootValue || rootValue.startsWith("-")))
    ) {
      throw new Error(usage());
    }
    const manifest = prepareGitToolSmoke({ root: rootValue });
    if (jsonOnly) {
      console.log(JSON.stringify(manifest, null, 2));
    } else {
      console.log(`T009 Git tool smoke fixtures: ${manifest.root}`);
      console.log(`Manifest:  ${manifest.paths.manifest}`);
      console.log(`Config:    ${manifest.paths.configTemplate}`);
      console.log(`Checklist: ${manifest.paths.checklist}`);
    }
    return 0;
  } catch (error) {
    console.error(`[git-tool-smoke] ${error instanceof Error ? error.message : "unknown error"}`);
    return 2;
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) process.exitCode = main();
