import { execFileSync, spawnSync } from "node:child_process";
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, parse } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertSupportedGitVersion,
  buildRunScenario,
  captureExternalChangeFingerprint,
  installToolConfig,
  isolatedGitEnvironment,
  prepareGitToolSmoke,
  runGitToolScenario,
  verifyGitToolSmoke,
} from "./git-tool-smoke.mjs";

let parent;
let root;
let manifest;
let manifestPath;

beforeAll(() => {
  parent = mkdtempSync(join(tmpdir(), "forktail-t009-test-"));
  root = join(parent, "Forktail O'Brien 한글 fixture");
  manifest = prepareGitToolSmoke({ root });
  manifestPath = manifest.paths.manifest;
}, 60_000);

afterAll(() => {
  rmSync(parent, { recursive: true, force: true });
});

describe.sequential("T009 Git tool smoke harness", () => {
  it("enforces the recorded Git 2.45.0 minimum without rejecting vendor suffixes", () => {
    expect(assertSupportedGitVersion("git version 2.45.0.windows.1")).toEqual({
      major: 2,
      minor: 45,
      patch: 0,
    });
    expect(assertSupportedGitVersion("git version 2.50.1 (Apple Git-155)")).toEqual({
      major: 2,
      minor: 50,
      patch: 1,
    });
    expect(() => assertSupportedGitVersion("git version 2.44.9")).toThrow(
      "T009 requires Git 2.45.0 or newer",
    );
  });

  it("rejects an option-looking --root value without creating a fixture", () => {
    const invalidRoot = join(parent, "--typo");
    const result = spawnSync(
      process.execPath,
      [join(process.cwd(), "scripts", "git-tool-smoke.mjs"), "--root", "--typo"],
      { cwd: parent, encoding: "utf8", shell: false },
    );

    expect(result.status).toBe(2);
    expect(existsSync(invalidRoot)).toBe(false);
  });

  it.skipIf(process.platform === "win32")(
    "checks the Git minimum before creating a requested fixture root",
    () => {
      const fakeBin = join(parent, "fake-git-bin");
      const requestedRoot = join(parent, "unsupported-git-root");
      mkdirSync(fakeBin);
      writeFakeOldGit(fakeBin);

      const result = spawnSync(
        process.execPath,
        [join(process.cwd(), "scripts", "git-tool-smoke.mjs"), "--root", requestedRoot],
        {
          cwd: parent,
          encoding: "utf8",
          env: { ...process.env, PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ""}` },
          shell: false,
        },
      );

      expect(result.status).toBe(2);
      expect(result.stderr).toContain("T009 requires Git 2.45.0 or newer");
      expect(existsSync(requestedRoot)).toBe(false);
    },
  );

  it.skipIf(process.platform === "win32")(
    "removes a newly created root when fixture setup fails after the version probe",
    () => {
      const fakeBin = join(parent, "fake-setup-failure-git-bin");
      const requestedRoot = join(parent, "failed-setup-root");
      mkdirSync(fakeBin);
      writeFakeSetupFailureGit(fakeBin);

      const result = spawnSync(
        process.execPath,
        [join(process.cwd(), "scripts", "git-tool-smoke.mjs"), "--root", requestedRoot],
        {
          cwd: parent,
          encoding: "utf8",
          env: { ...process.env, PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ""}` },
          shell: false,
        },
      );

      expect(result.status).toBe(2);
      expect(result.stderr).toContain("Git fixture operation failed: init");
      expect(existsSync(requestedRoot)).toBe(false);
    },
  );

  it("creates isolated A/D/M and conflict fixtures with distinct missing and empty bases", { timeout: 60_000 }, () => {
    expect(manifest).toMatchObject({ issue: "T009", schemaVersion: 2, root });
    expect(manifest.paths.provenance).toMatch(/fixture-provenance\.json$/);
    expect(manifest.paths.configTemplate).toMatch(/GIT_TOOL_CONFIG\.gitconfig$/);
    expect(manifest.paths.checklist).toMatch(/GIT_TOOL_SMOKE_CHECKLIST\.md$/);
    const checklist = readFileSync(manifest.paths.checklist, "utf8");
    for (const requiredCase of [
      "App crash / forced termination",
      "External MERGED change and save race",
      "UNC-path",
      "NFC and NFD",
      "minimum supported baseline is owned by",
      "if Git does ask whether the merge succeeded",
      "Mergetool process/temp/wait",
      "Git remains blocked while Forktail is open",
      "Disposable OS account/VM/profile identity",
      "smoke:git-tools:capture-external",
      "transcribed into VALIDATION.md",
      "smoke:git-tools:cleanup",
    ]) {
      expect(checklist).toContain(requiredCase);
    }

    expect(
      git(manifest.repositories.difftool.path, [
        "diff",
        "--name-status",
        "-z",
        manifest.repositories.difftool.baseRevision,
        manifest.repositories.difftool.changedRevision,
      ]).split("\0").filter(Boolean),
    ).toEqual([
      "A",
      "added path O'Brien 한글.txt",
      "D",
      "deleted path O'Brien 한글.txt",
      "M",
      "modified path O'Brien 한글.txt",
    ]);

    expect(unmergedStages(manifest.repositories.mergetoolSave.path)).toEqual([1, 2, 3]);
    expect(unmergedStages(manifest.repositories.mergetoolMissingBase.path)).toEqual([2, 3]);
    expect(unmergedStages(manifest.repositories.mergetoolEmptyBase.path)).toEqual([1, 2, 3]);
    expect(stageObject(manifest.repositories.mergetoolEmptyBase.path, 1)).toBe(
      manifest.repositories.mergetoolEmptyBase.emptyBaseObject,
    );

    const sanitized = isolatedGitEnvironment(manifest.paths, {
      PATH: process.env.PATH,
      GIT_DIR: "/outside/repository",
      git_work_tree: "/outside/worktree",
      Git_Config_Global: "/outside/global-config",
    });
    expect(sanitized.GIT_DIR).toBeUndefined();
    expect(sanitized.git_work_tree).toBeUndefined();
    expect(sanitized.Git_Config_Global).toBeUndefined();
    expect(sanitized.GIT_CONFIG_GLOBAL).toBe(manifest.paths.emptyGlobalConfig);
    expect(sanitized.GIT_ATTR_NOSYSTEM).toBe("1");
    expect(sanitized.GIT_OPTIONAL_LOCKS).toBe("0");
  });

  it.skipIf(process.platform === "win32")(
    "rejects a later harness process that resolves to a different Git version",
    () => {
      const fakeBin = join(parent, "fake-git-bin");
      const result = spawnSync(
        process.execPath,
        [
          join(process.cwd(), "scripts", "git-tool-smoke.mjs"),
          "--verify",
          manifestPath,
          "difftool-pristine",
        ],
        {
          cwd: parent,
          encoding: "utf8",
          env: { ...process.env, PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ""}` },
          shell: false,
        },
      );

      expect(result.status).toBe(2);
      expect(result.stderr).toContain("T009 requires Git 2.45.0 or newer");
    },
  );

  it("rejects manifest path escape, identity changes, duplicate repositories, and Result remapping", () => {
    expectTamperedManifestRejected((candidate) => {
      candidate.gitVersion = "git version 2.44.9";
    }, /T009 requires Git 2\.45\.0 or newer/);
    expectTamperedManifestRejected((candidate) => {
      candidate.gitVersion = manifest.gitVersion.startsWith("git version 2.45.0")
        ? "git version 2.45.1"
        : "git version 2.45.0";
    }, /manifest provenance digest mismatch/);
    expectTamperedManifestRejected((candidate) => {
      candidate.root = parse(root).root;
    }, /manifest root must contain the manifest/);
    expectTamperedManifestRejected((candidate) => {
      candidate.paths.isolatedHome = parent;
    }, /manifest provenance digest mismatch/);
    expectTamperedManifestRejected((candidate) => {
      candidate.paths.emptyGlobalConfig = candidate.paths.configTemplate;
    }, /manifest provenance digest mismatch/);
    expectTamperedManifestRejected((candidate) => {
      candidate.paths.toolConfigReceipt = join(parent, "escaped-tool-receipt.json");
    }, /manifest provenance digest mismatch/);
    expectTamperedManifestRejected((candidate) => {
      candidate.paths.externalChangeReceipt = join(parent, "escaped-external-receipt.json");
    }, /manifest provenance digest mismatch/);
    expectTamperedManifestRejected((candidate) => {
      candidate.repositories.mergetoolSave.path = candidate.repositories.difftool.path;
    }, /manifest provenance digest mismatch/);
    expectTamperedManifestRejected((candidate) => {
      candidate.repositories.extra = { ...candidate.repositories.difftool };
    }, /unexpected fixture repository keys/);
    expectTamperedManifestRejected((candidate) => {
      candidate.repositories.mergetoolSave.resultPath = join(
        candidate.repositories.mergetoolSave.path,
        "seed.txt",
      );
    }, /manifest provenance digest mismatch/);
    expectTamperedManifestRejected((candidate) => {
      candidate.repositories.mergetoolSave.baseline.immutableFiles = [];
    }, /manifest provenance digest mismatch/);
    expectTamperedManifestRejected((candidate) => {
      candidate.repositories.difftool.baseRevision = "--dir-diff";
    }, /invalid difftool base revision/);
    expectTamperedManifestRejected((candidate) => {
      candidate.repositories.difftool.changedRevision =
        `${candidate.repositories.difftool.baseRevision}..${candidate.repositories.difftool.changedRevision}`;
    }, /invalid difftool changed revision/);
  });

  it.runIf(process.platform === "darwin")(
    "accepts a filesystem-identical NFD manifest path on macOS",
    () => {
      const report = verifyGitToolSmoke({
        manifestPath: manifestPath.normalize("NFD"),
        scenario: "difftool-pristine",
      });
      expect(report.failures.map(({ code }) => code)).toContain("TOOL_CONFIG_RECEIPT_MISSING");
    },
  );

  it.runIf(process.platform === "darwin")(
    "seals the Git-normalized installed tool values instead of the NFD config input",
    { timeout: 60_000 },
    () => {
      const normalizationRoot = join(parent, "receipt normalization fixture");
      const normalization = prepareGitToolSmoke({ root: normalizationRoot });
      const configPath = join(normalizationRoot, "nfd-generated.gitconfig");
      const nfdExecutablePath = "/opt/Forktail 한글/forktail".normalize("NFD");
      writeFileSync(
        configPath,
        validToolConfig().replaceAll("/opt/forktail", nfdExecutablePath),
      );

      try {
        installToolConfig({ manifestPath: normalization.paths.manifest, configPath });
        const configured = gitFor(normalization, normalizationRoot, [
          "config",
          "--file",
          configPath,
          "--get",
          "difftool.forktail.cmd",
        ]).trimEnd();
        const installed = gitFor(normalization, normalization.repositories.difftool.path, [
          "config",
          "--local",
          "--get",
          "difftool.forktail.cmd",
        ]).trimEnd();

        expect(configured).not.toBe(installed);
        expect(configured.normalize("NFC")).toBe(installed);
        expect(
          verifyGitToolSmoke({
            manifestPath: normalization.paths.manifest,
            scenario: "difftool-pristine",
          }).ok,
        ).toBe(true);
      } finally {
        rmSync(normalizationRoot, { recursive: true, force: true });
      }
    },
  );

  it("removes only a validated disposable fixture through the cleanup command", { timeout: 60_000 }, () => {
    const cleanupRoot = join(parent, "cleanup O'Brien 한글 fixture");
    const cleanupManifest = prepareGitToolSmoke({ root: cleanupRoot });
    rmSync(join(cleanupManifest.repositories.difftool.path, ".git", "index"));
    const result = spawnSync(
      process.execPath,
      [
        join(process.cwd(), "scripts", "git-tool-smoke.mjs"),
        "--cleanup",
        cleanupManifest.paths.manifest,
      ],
      { cwd: parent, encoding: "utf8", shell: false },
    );

    expect(result.status).toBe(0);
    expect(existsSync(cleanupRoot)).toBe(false);
  });

  it("installs only generated tool-specific config into fixture repositories", { timeout: 60_000 }, () => {
    const configPath = join(root, "generated.gitconfig");
    writeFileSync(configPath, validToolConfig());

    const repositories = Object.values(manifest.repositories);
    git(repositories[1].path, ["config", "--local", "diff.tool", "unexpected"]);
    expect(() => installToolConfig({ manifestPath, configPath })).toThrow(
      "fixture repository already defines forbidden default key: diff.tool",
    );
    expect(gitExit(repositories[0].path, ["config", "--local", "--get", "difftool.forktail.cmd"]))
      .toBe(1);
    git(repositories[1].path, ["config", "--local", "--unset-all", "diff.tool"]);

    git(repositories[1].path, [
      "config",
      "--local",
      "--add",
      "difftool.forktail.cmd",
      "first",
    ]);
    git(repositories[1].path, [
      "config",
      "--local",
      "--add",
      "difftool.forktail.cmd",
      "second",
    ]);
    expect(() => installToolConfig({ manifestPath, configPath })).toThrow(
      /local config key must appear at most once/,
    );
    expect(gitExit(repositories[0].path, ["config", "--local", "--get", "difftool.forktail.cmd"]))
      .toBe(1);
    git(repositories[1].path, [
      "config",
      "--local",
      "--unset-all",
      "difftool.forktail.cmd",
    ]);

    const installed = installToolConfig({ manifestPath, configPath });

    expect(installed.repositories).toHaveLength(4);
    expect(existsSync(manifest.paths.toolConfigReceipt)).toBe(true);
    for (const repository of Object.values(manifest.repositories)) {
      expect(git(repository.path, ["config", "--local", "--get", "difftool.forktail.cmd"]))
        .toContain("--difftool");
      expect(git(repository.path, ["config", "--local", "--get", "mergetool.forktail.cmd"]))
        .toContain("$base_present");
      expect(gitExit(repository.path, ["config", "--local", "--get", "diff.tool"])).toBe(1);
      expect(gitExit(repository.path, ["config", "--local", "--get", "merge.tool"])).toBe(1);
    }

    writeFileSync(configPath, `${validToolConfig()}\n[diff]\n\ttool = forktail\n`);
    expect(() => installToolConfig({ manifestPath, configPath })).toThrow(
      /unsupported config key: diff\.tool/,
    );
  });

  it("revalidates all tool config and forbidden defaults immediately before running Git", { timeout: 60_000 }, () => {
    const repository = manifest.repositories.difftool.path;
    const repositoryConfigPath = join(repository, ".git", "config");
    const originalConfig = readFileSync(repositoryConfigPath);
    const trueDifftool = 'true --difftool "$LOCAL" "$REMOTE"';

    for (const key of [
      "mergetool.forktail.cmd",
      "mergetool.forktail.trustExitCode",
      "mergetool.forktail.hideResolved",
    ]) {
      git(repository, ["config", "--local", "--unset-all", key]);
    }
    git(repository, ["config", "--local", "difftool.forktail.cmd", trueDifftool]);
    expect(() => runGitToolScenario({ manifestPath, scenario: "difftool" })).toThrow(
      /missing required local config key/,
    );

    replaceFixtureFile(repositoryConfigPath, originalConfig);
    git(repository, ["config", "--local", "difftool.forktail.cmd", trueDifftool]);
    git(repository, ["config", "--local", "mergetool.forktail.trustExitCode", "true"]);
    expect(() => runGitToolScenario({ manifestPath, scenario: "difftool" })).toThrow(
      /trustExitCode must be false/,
    );

    replaceFixtureFile(repositoryConfigPath, originalConfig);
    git(repository, ["config", "--local", "difftool.forktail.cmd", trueDifftool]);
    git(repository, ["config", "--local", "mergetool.keepBackup", "false"]);
    expect(() => runGitToolScenario({ manifestPath, scenario: "difftool" })).toThrow(
      /repository-local config changed outside Forktail tool keys/,
    );
    replaceFixtureFile(repositoryConfigPath, originalConfig);
    git(repository, ["config", "--local", "difftool.forktail.cmd", trueDifftool]);
    git(repository, ["config", "--local", "diff.tool", "forktail"]);
    expect(() => runGitToolScenario({ manifestPath, scenario: "difftool" })).toThrow(
      /forbidden default key: diff\.tool/,
    );
    replaceFixtureFile(repositoryConfigPath, originalConfig);
  });

  it("verifies pristine, no-save, unresolved-blocked, and save lifecycle checkpoints", { timeout: 60_000 }, () => {
    expect(verifyGitToolSmoke({ manifestPath, scenario: "difftool-pristine" }).ok).toBe(true);
    expect(verifyGitToolSmoke({ manifestPath, scenario: "mergetool-no-save" }).ok).toBe(true);
    expect(
      verifyGitToolSmoke({ manifestPath, scenario: "mergetool-missing-base-no-save" }).ok,
    ).toBe(true);
    expect(
      verifyGitToolSmoke({ manifestPath, scenario: "mergetool-empty-base-no-save" }).ok,
    ).toBe(true);
    expect(
      verifyGitToolSmoke({ manifestPath, scenario: "mergetool-unresolved-blocked" }).ok,
    ).toBe(true);

    const save = manifest.repositories.mergetoolSave;
    const originalResult = readFileSync(save.resultPath);
    writeFileSync(save.resultPath, "external writer value\n");
    captureExternalChangeFingerprint({ manifestPath });
    expect(
      verifyGitToolSmoke({
        manifestPath,
        scenario: "mergetool-external-change-blocked",
      }).ok,
    ).toBe(true);
    writeFileSync(save.resultPath, "overwritten after external capture\n");
    const overwrittenExternal = verifyGitToolSmoke({
      manifestPath,
      scenario: "mergetool-external-change-blocked",
    });
    expect(overwrittenExternal.failures.map(({ code }) => code)).toContain(
      "EXTERNAL_CHANGE_OVERWRITTEN",
    );
    writeFileSync(save.resultPath, originalResult);
    rmSync(manifest.paths.externalChangeReceipt);

    writeFileSync(save.resultPath, "resolved value\n");
    const backupPath = `${save.resultPath}.bak.123`;
    writeFileSync(backupPath, originalResult);

    expect(
      verifyGitToolSmoke({ manifestPath, scenario: "mergetool-save-during-app" }).ok,
    ).toBe(true);

    git(save.path, ["add", "--", "conflict.txt"]);
    const gitOrigPath = `${save.resultPath}.orig`;
    writeFileSync(gitOrigPath, originalResult);
    expect(
      verifyGitToolSmoke({ manifestPath, scenario: "mergetool-save-post-confirm" }).ok,
    ).toBe(true);

    git(save.path, ["update-index", "--chmod=+x", "--", "seed.txt"]);
    git(save.path, ["update-index", "--chmod=+x", "--", "conflict.txt"]);
    writeFileSync(backupPath, "not the original Result bytes\n");
    writeFileSync(gitOrigPath, "not the original Result bytes\n");
    writeFileSync(join(save.path, "unexpected-sidecar.tmp"), "residue\n");
    const tampered = verifyGitToolSmoke({
      manifestPath,
      scenario: "mergetool-save-post-confirm",
    });
    expect(tampered.ok).toBe(false);
    expect(tampered.failures.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "OTHER_INDEX_ENTRY_CHANGED",
        "STAGED_RESULT_MODE_CHANGED",
        "BACKUP_CONTENT_MISMATCH",
        "GIT_ORIG_CONTENT_MISMATCH",
        "UNEXPECTED_SIDECAR",
      ]),
    );
  });

  it("fails closed on repository operation-state, metadata, config, lock, backup, and index-flag drift", { timeout: 60_000 }, () => {
    const auditRoot = join(parent, "verifier drift audit fixture");
    const audit = prepareGitToolSmoke({ root: auditRoot });
    const configPath = join(auditRoot, "generated.gitconfig");
    writeFileSync(configPath, validToolConfig());
    installToolConfig({ manifestPath: audit.paths.manifest, configPath });

    try {
      const difftool = audit.repositories.difftool;
      if (process.platform !== "win32") chmodSync(join(difftool.path, "unchanged.txt"), 0o755);
      gitFor(audit, difftool.path, [
        "update-ref",
        "--no-deref",
        "HEAD",
        difftool.baseline.head,
      ]);
      bumpMtime(join(difftool.path, ".git", "index"));
      writeFileSync(join(difftool.path, ".git", "index.lock"), "lock residue\n");
      appendFileSync(join(difftool.path, ".git", "config"), "# byte-only config mutation\n");
      const difftoolDrift = verifyGitToolSmoke({
        manifestPath: audit.paths.manifest,
        scenario: "difftool-pristine",
      });
      expect(difftoolDrift.failures.map(({ code }) => code)).toEqual(
        expect.arrayContaining([
          "GIT_STATE_CHANGED",
          "INDEX_CHANGED",
          "GIT_LOCK_RESIDUE",
          "TOOL_CONFIG_CHANGED",
          ...(process.platform === "win32" ? [] : ["WORKTREE_CHANGED"]),
        ]),
      );

      const noSave = audit.repositories.mergetoolMissingBase;
      bumpMtime(noSave.resultPath);
      expect(
        verifyGitToolSmoke({
          manifestPath: audit.paths.manifest,
          scenario: "mergetool-missing-base-no-save",
        }).ok,
      ).toBe(true);
      writeFileSync(`${noSave.resultPath}.orig`, "unexpected Git orig bytes\n");
      gitFor(audit, noSave.path, ["merge", "--quit"]);
      gitFor(audit, noSave.path, [
        "config",
        "--local",
        "mergetool.forktail.trustExitCode",
        "true",
      ]);
      const noSaveDrift = verifyGitToolSmoke({
        manifestPath: audit.paths.manifest,
        scenario: "mergetool-missing-base-no-save",
      });
      expect(noSaveDrift.failures.map(({ code }) => code)).toEqual(
        expect.arrayContaining(["GIT_STATE_CHANGED", "TOOL_CONFIG_CHANGED", "UNEXPECTED_SIDECAR"]),
      );

      const save = audit.repositories.mergetoolSave;
      const originalResult = readFileSync(save.resultPath);
      writeFileSync(save.resultPath, "external writer bytes\n");
      captureExternalChangeFingerprint({ manifestPath: audit.paths.manifest });
      writeFileSync(save.resultPath, "later overwrite bytes\n");
      const externalDrift = verifyGitToolSmoke({
        manifestPath: audit.paths.manifest,
        scenario: "mergetool-external-change-blocked",
      });
      expect(externalDrift.failures.map(({ code }) => code)).toContain(
        "EXTERNAL_CHANGE_OVERWRITTEN",
      );

      writeFileSync(`${save.resultPath}.bak.100`, originalResult);
      writeFileSync(`${save.resultPath}.bak.101`, "corrupt additional backup\n");
      gitFor(audit, save.path, ["add", "--", "conflict.txt"]);
      gitFor(audit, save.path, ["update-index", "--skip-worktree", "seed.txt"]);
      gitFor(audit, save.path, ["update-index", "--skip-worktree", "conflict.txt"]);
      rmSync(join(save.path, ".git", "MERGE_HEAD"));
      if (process.platform !== "win32") chmodSync(save.resultPath, 0o600);
      const savedDrift = verifyGitToolSmoke({
        manifestPath: audit.paths.manifest,
        scenario: "mergetool-save-post-confirm",
      });
      expect(savedDrift.failures.map(({ code }) => code)).toEqual(
        expect.arrayContaining([
          "GIT_STATE_CHANGED",
          "OTHER_INDEX_FLAGS_CHANGED",
          "STAGED_RESULT_FLAGS_CHANGED",
          "BACKUP_CONTENT_MISMATCH",
          ...(process.platform === "win32" ? [] : ["RESULT_PERMISSIONS_CHANGED"]),
        ]),
      );
    } finally {
      rmSync(auditRoot, { recursive: true, force: true });
    }
  });

  it("fails closed when required files changed or disappeared and temp files remain", { timeout: 60_000 }, () => {
    const missing = manifest.repositories.mergetoolMissingBase;

    writeFileSync(missing.resultPath, "unexpected mutation\n");
    writeFileSync(join(missing.path, "conflict_BASE_123.txt"), "");

    const report = verifyGitToolSmoke({
      manifestPath,
      scenario: "mergetool-missing-base-no-save",
    });
    expect(report.ok).toBe(false);
    expect(report.failures.map(({ code }) => code)).toEqual(
      expect.arrayContaining(["RESULT_CHANGED", "TEMP_RESIDUE"]),
    );

    const emptyBase = manifest.repositories.mergetoolEmptyBase;
    rmSync(emptyBase.resultPath);
    rmSync(join(emptyBase.path, "seed.txt"));
    git(emptyBase.path, ["config", "--local", "core.ignorestat", "true"]);
    const missingResult = verifyGitToolSmoke({
      manifestPath,
      scenario: "mergetool-empty-base-no-save",
    });
    expect(missingResult.ok).toBe(false);
    expect(missingResult.failures.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "RESULT_MISSING",
        "OTHER_FILE_MISSING",
        "LOCAL_CONFIG_CHANGED",
      ]),
    );
  });

  it("builds immutable explicit Git argv for each interactive scenario", { timeout: 60_000 }, () => {
    expect(buildRunScenario(manifest, "difftool")).toMatchObject({
      cwd: manifest.repositories.difftool.path,
      args: [
        "difftool",
        "--tool=forktail",
        "--no-prompt",
        manifest.repositories.difftool.baseRevision,
        manifest.repositories.difftool.changedRevision,
        "--",
        "added path O'Brien 한글.txt",
        "deleted path O'Brien 한글.txt",
        "modified path O'Brien 한글.txt",
      ],
    });
    expect(buildRunScenario(manifest, "mergetool-save")).toMatchObject({
      cwd: manifest.repositories.mergetoolSave.path,
      args: ["mergetool", "--tool=forktail", "--no-prompt", "conflict.txt"],
    });
    expect(buildRunScenario(manifest, "mergetool-missing-base").cwd).toBe(
      manifest.repositories.mergetoolMissingBase.path,
    );
    expect(buildRunScenario(manifest, "mergetool-empty-base").cwd).toBe(
      manifest.repositories.mergetoolEmptyBase.path,
    );
  });
});

function git(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: isolatedGitEnvironment(manifest.paths),
  });
}

function gitFor(fixture, cwd, args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: isolatedGitEnvironment(fixture.paths),
  });
}

function bumpMtime(path) {
  const metadata = statSync(path);
  utimesSync(path, metadata.atime, new Date(metadata.mtimeMs + 2_000));
}

function replaceFixtureFile(path, bytes) {
  const replacement = `${path}.test-replacement`;
  const previous = `${path}.test-previous`;
  writeFileSync(replacement, bytes, { mode: statSync(path).mode & 0o777 });
  renameSync(path, previous);
  try {
    renameSync(replacement, path);
  } catch (error) {
    renameSync(previous, path);
    throw error;
  }
  rmSync(previous);
}

function gitExit(cwd, args) {
  try {
    git(cwd, args);
    return 0;
  } catch (error) {
    return error.status;
  }
}

function unmergedStages(cwd) {
  return git(cwd, ["ls-files", "-u", "--", "conflict.txt"])
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => Number.parseInt(line.match(/^[0-9]+ [0-9a-f]+ ([123])\t/)?.[1] ?? "-1", 10));
}

function stageObject(cwd, stage) {
  const line = git(cwd, ["ls-files", "-u", "--", "conflict.txt"])
    .trim()
    .split("\n")
    .find((candidate) => candidate.includes(` ${stage}\t`));
  return line?.match(/^[0-9]+ ([0-9a-f]+) [123]\t/)?.[1] ?? null;
}

function validToolConfig() {
  return `[difftool "forktail"]
\tcmd = "exec '/opt/forktail' --difftool \\"$LOCAL\\" \\"$REMOTE\\""
[mergetool "forktail"]
\tcmd = "forktail_base=\\"$BASE\\"; if test \\"$base_present\\" = false; then forktail_base=; fi; exec '/opt/forktail' --mergetool \\"$forktail_base\\" \\"$LOCAL\\" \\"$REMOTE\\" \\"$MERGED\\""
\ttrustExitCode = false
\thideResolved = false
`;
}

function expectTamperedManifestRejected(mutate, expectedMessage) {
  const original = readFileSync(manifestPath, "utf8");
  const candidate = JSON.parse(original);
  mutate(candidate);
  writeFileSync(manifestPath, `${JSON.stringify(candidate, null, 2)}\n`);
  try {
    expect(() =>
      verifyGitToolSmoke({ manifestPath, scenario: "difftool-pristine" })
    ).toThrow(expectedMessage);
  } finally {
    writeFileSync(manifestPath, original);
  }
}

function writeFakeOldGit(directory) {
  const path = join(directory, "git");
  writeFileSync(path, "#!/bin/sh\nprintf '%s\\n' 'git version 2.44.9'\n");
  chmodSync(path, 0o755);
}

function writeFakeSetupFailureGit(directory) {
  const path = join(directory, "git");
  writeFileSync(
    path,
    "#!/bin/sh\nif test \"$1\" = --version; then printf '%s\\n' 'git version 2.50.0'; exit 0; fi\nexit 1\n",
  );
  chmodSync(path, 0o755);
}
