import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  compareSemver,
  normalizeReleaseTag,
  normalizeReleaseVersion,
  parseSemver,
} from "./semver.mjs";
import { applyVersionBump } from "./version-bump.mjs";

const roots = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("strict SemVer", () => {
  it("normalizes release versions and compares prereleases", () => {
    expect(normalizeReleaseVersion("v1.2.3-beta.2")).toBe("1.2.3-beta.2");
    expect(normalizeReleaseTag("1.2.3+build.7")).toBe("v1.2.3+build.7");
    expect(compareSemver("1.2.3-beta.2", "1.2.3-beta.11")).toBeLessThan(0);
    expect(compareSemver("1.2.3-beta.11", "1.2.3")).toBeLessThan(0);
    expect(
      compareSemver("18446744073709551615.0.0", "9007199254740993.0.0"),
    ).toBeGreaterThan(0);
  });

  it.each([
    "01.2.3",
    "1.2",
    "1.2.3-01",
    "1.2.3-a..b",
    "1.2.3-한글",
    "v1.2.3",
    "18446744073709551616.0.0",
  ])(
    "rejects invalid project SemVer %s",
    (version) => {
      expect(() => parseSemver(version)).toThrow();
    },
  );
});

describe("version bump transaction", () => {
  it.each(["0.2.3", "v0.3.0-beta.1"])("updates all six version fields for %s", (version) => {
    const root = fixture();
    const result = applyVersionBump(version, { root });
    const expected = normalizeReleaseVersion(version);

    expect(result).toMatchObject({ currentVersion: "0.2.2", nextVersion: expected, dryRun: false });
    expect(result.changedFiles).toHaveLength(5);
    expect(readVersions(root)).toEqual(Array(6).fill(expected));
    expect(
      JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8")).packages[
        "node_modules/dependency"
      ].version,
    ).toBe("9.8.7");
    expect(readFileSync(join(root, "src-tauri/Cargo.lock"), "utf8")).toContain(
      'name = "dependency"\nversion = "7.6.5"',
    );
  });

  it.each([
    ["not-semver", /valid SemVer/],
    ["0.2.2", /strictly newer/],
    ["0.2.1", /strictly newer/],
    ["0.2.2+rebuilt", /strictly newer/],
  ])("rejects %s without changing any file", (version, message) => {
    const root = fixture();
    const before = snapshot(root);
    expect(() => applyVersionBump(version, { root })).toThrow(message);
    expect(snapshot(root)).toEqual(before);
  });

  it("validates a dry run without creating changes", () => {
    const root = fixture();
    const before = snapshot(root);
    const result = applyVersionBump("v0.2.3", { root, dryRun: true });
    expect(result).toMatchObject({
      currentVersion: "0.2.2",
      nextVersion: "0.2.3",
      dryRun: true,
    });
    expect(snapshot(root)).toEqual(before);
  });

  it("rejects inconsistent current fields before mutation", () => {
    const root = fixture();
    const lockPath = join(root, "package-lock.json");
    const lock = JSON.parse(readFileSync(lockPath, "utf8"));
    lock.packages[""].version = "0.2.1";
    writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
    const before = snapshot(root);

    expect(() => applyVersionBump("0.2.3", { root })).toThrow(/inconsistent/);
    expect(snapshot(root)).toEqual(before);
  });

  it("rejects missing and duplicate targets before mutation", () => {
    const missingRoot = fixture();
    const missingPath = join(missingRoot, "src-tauri/Cargo.toml");
    writeFileSync(
      missingPath,
      readFileSync(missingPath, "utf8").replace('version = "0.2.2"\n', ""),
    );
    const missingBefore = snapshot(missingRoot);
    expect(() => applyVersionBump("0.2.3", { root: missingRoot })).toThrow(/exactly one version/);
    expect(snapshot(missingRoot)).toEqual(missingBefore);

    const duplicateRoot = fixture();
    const duplicatePath = join(duplicateRoot, "src-tauri/Cargo.lock");
    const duplicateBlock = '\n[[package]]\nname = "forktail"\nversion = "0.2.2"\n';
    writeFileSync(duplicatePath, readFileSync(duplicatePath, "utf8") + duplicateBlock);
    const duplicateBefore = snapshot(duplicateRoot);
    expect(() => applyVersionBump("0.2.3", { root: duplicateRoot })).toThrow(
      /exactly one \[\[package\]\] named forktail/,
    );
    expect(snapshot(duplicateRoot)).toEqual(duplicateBefore);
  });

  it("rolls back every replaced file when an injected replacement fails", () => {
    const root = fixture();
    const before = snapshot(root);
    let applyCount = 0;

    expect(() =>
      applyVersionBump("0.2.3", {
        root,
        replaceFile(sourcePath, targetPath, context) {
          if (context.phase === "apply" && ++applyCount === 3) {
            throw new Error("injected third replacement failure");
          }
          // The production primitive remains in charge of both apply and rollback.
          renameForTest(sourcePath, targetPath);
        },
      }),
    ).toThrow(/all replaced files were restored/);

    expect(snapshot(root)).toEqual(before);
  });

  it("preserves a concurrent edit and rolls back earlier replacements", () => {
    const root = fixture();
    const before = snapshot(root);
    const cargoPath = join(root, "src-tauri/Cargo.toml");
    const concurrentText = `${readFileSync(cargoPath, "utf8")}# concurrent edit\n`;
    let applyCount = 0;

    expect(() =>
      applyVersionBump("0.2.3", {
        root,
        replaceFile(sourcePath, targetPath, context) {
          if (context.phase === "apply" && ++applyCount === 1) {
            renameForTest(sourcePath, targetPath);
            writeFileSync(cargoPath, concurrentText);
            return;
          }
          renameForTest(sourcePath, targetPath);
        },
      }),
    ).toThrow(/changed concurrently/);

    const after = snapshot(root);
    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBe(before[1]);
    expect(after[2]).toBe(concurrentText);
    expect(after.slice(3)).toEqual(before.slice(3));
  });

  it("does not overwrite a concurrent edit while handling a later failure", () => {
    const root = fixture();
    const packagePath = join(root, "package.json");
    const concurrentText = `${readFileSync(packagePath, "utf8").trimEnd()}\n `;
    let applyCount = 0;

    expect(() =>
      applyVersionBump("0.2.3", {
        root,
        replaceFile(sourcePath, targetPath, context) {
          if (context.phase === "apply") {
            applyCount += 1;
            if (applyCount === 1) {
              renameForTest(sourcePath, targetPath);
              return;
            }
            writeFileSync(packagePath, concurrentText);
            throw new Error("injected failure after concurrent edit");
          }
          renameForTest(sourcePath, targetPath);
        },
      }),
    ).toThrow(/rollback was incomplete/);

    expect(readFileSync(packagePath, "utf8")).toBe(concurrentText);
  });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "forktail-version-bump-"));
  roots.push(root);
  mkdirSync(join(root, "src-tauri"), { recursive: true });
  writeFileSync(
    join(root, "package.json"),
    `${JSON.stringify({ name: "forktail", version: "0.2.2", private: true }, null, 2)}\n`,
  );
  writeFileSync(
    join(root, "package-lock.json"),
    `${JSON.stringify(
      {
        name: "forktail",
        version: "0.2.2",
        lockfileVersion: 3,
        packages: {
          "": { name: "forktail", version: "0.2.2" },
          "node_modules/dependency": { version: "9.8.7" },
        },
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(root, "src-tauri/Cargo.toml"),
    '[package]\nname = "forktail"\nversion = "0.2.2"\nedition = "2024"\n\n[dependencies]\ndependency = "7"\n',
  );
  writeFileSync(
    join(root, "src-tauri/Cargo.lock"),
    'version = 4\n\n[[package]]\nname = "dependency"\nversion = "7.6.5"\n\n[[package]]\nname = "forktail"\nversion = "0.2.2"\ndependencies = [\n "dependency",\n]\n',
  );
  writeFileSync(
    join(root, "src-tauri/tauri.conf.json"),
    `${JSON.stringify({ productName: "forktail", version: "0.2.2", bundle: {} }, null, 2)}\n`,
  );
  return root;
}

function readVersions(root) {
  const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const packageLock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
  const tauri = JSON.parse(readFileSync(join(root, "src-tauri/tauri.conf.json"), "utf8"));
  const cargoToml = readFileSync(join(root, "src-tauri/Cargo.toml"), "utf8");
  const cargoLock = readFileSync(join(root, "src-tauri/Cargo.lock"), "utf8");
  return [
    packageJson.version,
    packageLock.version,
    packageLock.packages[""].version,
    cargoToml.match(/^version = "([^"]+)"$/m)?.[1],
    cargoLock.match(/name = "forktail"\nversion = "([^"]+)"/)?.[1],
    tauri.version,
  ];
}

function snapshot(root) {
  return [
    "package.json",
    "package-lock.json",
    "src-tauri/Cargo.toml",
    "src-tauri/Cargo.lock",
    "src-tauri/tauri.conf.json",
  ].map((path) => readFileSync(join(root, path), "utf8"));
}

function renameForTest(sourcePath, targetPath) {
  // Avoid exporting production internals solely for fault-injection tests.
  renameSync(sourcePath, targetPath);
}
