import { describe, expect, it } from "vitest";
import type { FileDocument } from "./models";
import {
  buildMergetoolSession,
  isMissingMergetoolBaseError,
  mergetoolSessionCapabilities,
} from "./mergetoolSession";
import type { MergetoolStartupSession } from "./startupSession";

describe("buildMergetoolSession", () => {
  it("uses the existing $MERGED document as Result and keeps its open fingerprint", () => {
    const startup = mergetoolStartup({ basePath: "/tmp/base", outputPath: "/repo/result.txt" });
    const merged = document("/repo/result.txt", "existing Git result\n", 20, 4567);

    const built = buildMergetoolSession(startup, {
      base: document("/tmp/base", "base\n", 5, 1000),
      ours: document("/tmp/local", "ours\n", 5, 1001),
      theirs: document("/tmp/remote", "theirs\n", 7, 1002),
      merged,
    });

    expect(built.session).toMatchObject({
      origin: "mergetool",
      output: merged,
      result: "existing Git result\n",
      outputPath: "/repo/result.txt",
    });
    expect(built.outputVersion).toEqual({
      expectedSize: 20,
      expectedModifiedMs: 4567,
      expectedContentHash: "result.txt-content-hash",
    });
  });

  it("represents a missing $BASE as a virtual document without changing the other sources", () => {
    const startup = mergetoolStartup({ basePath: null });
    const ours = document("/tmp/local", "ours\n", 5, 1001);
    const theirs = document("/tmp/remote", "theirs\n", 7, 1002);
    const merged = document("/repo/result.txt", "<<<<<<< HEAD\n", 13, 1003);

    const built = buildMergetoolSession(startup, { base: null, ours, theirs, merged });

    expect(built.session.base).toMatchObject({
      path: "$BASE",
      text: "",
      encoding: "Missing",
      virtual: { kind: "missing" },
    });
    expect(built.session.ours).toBe(ours);
    expect(built.session.theirs).toBe(theirs);
  });

  it("fails closed when the loaded Result path does not match the fixed $MERGED target", () => {
    const startup = mergetoolStartup({ outputPath: "/repo/MERGED" });

    expect(() => buildMergetoolSession(startup, {
      base: document("/tmp/base", "base\n", 5, 1000),
      ours: document("/tmp/local", "ours\n", 5, 1001),
      theirs: document("/tmp/remote", "theirs\n", 7, 1002),
      merged: document("/repo/other", "result\n", 7, 1003),
    })).toThrow(expect.objectContaining({ code: "PATH_CONFLICT" }));
  });

  it("keeps a nonempty unavailable $BASE path on the virtual document", () => {
    const startup = mergetoolStartup({ basePath: "/tmp/unavailable-base" });

    const built = buildMergetoolSession(startup, {
      base: null,
      ours: document("/tmp/local", "ours\n", 5, 1001),
      theirs: document("/tmp/remote", "theirs\n", 7, 1002),
      merged: document("/repo/result.txt", "result\n", 7, 1003),
    });

    expect(built.session.base).toMatchObject({
      path: "/tmp/unavailable-base",
      virtual: { kind: "missing" },
    });
  });
});

describe("mergetoolSessionCapabilities", () => {
  it("hardens mergetool save and persistence capabilities", () => {
    expect(mergetoolSessionCapabilities({ origin: "mergetool" })).toEqual({
      editable: true,
      save: true,
      saveTarget: "output-only",
      saveAs: false,
      backupRestore: false,
      persistPaths: false,
      recoveryDrafts: false,
      unresolvedPolicy: "block-unresolved",
    });
  });

  it("gives repository conflicts the same fixed-output and no-persistence boundary", () => {
    expect(mergetoolSessionCapabilities({ origin: "gitConflict" })).toEqual({
      editable: true,
      save: true,
      saveTarget: "output-only",
      saveAs: false,
      backupRestore: false,
      persistPaths: false,
      recoveryDrafts: false,
      unresolvedPolicy: "block-unresolved",
    });
  });

  it("makes repository merge previews fully read-only and non-persistent", () => {
    expect(mergetoolSessionCapabilities({ origin: "gitPreview" })).toEqual({
      editable: false,
      save: false,
      saveTarget: "none",
      saveAs: false,
      backupRestore: false,
      persistPaths: false,
      recoveryDrafts: false,
      unresolvedPolicy: "block-unresolved",
    });
  });

  it("keeps ordinary file merge capabilities", () => {
    expect(mergetoolSessionCapabilities({ origin: "files" })).toEqual({
      editable: true,
      save: true,
      saveTarget: "selectable",
      saveAs: true,
      backupRestore: true,
      persistPaths: true,
      recoveryDrafts: true,
      unresolvedPolicy: "confirm-unresolved",
    });
  });
});

describe("isMissingMergetoolBaseError", () => {
  it("accepts only a structured NOT_FOUND app error", () => {
    expect(isMissingMergetoolBaseError({ code: "NOT_FOUND", message: "Base is missing" })).toBe(true);
    expect(isMissingMergetoolBaseError({ code: "PERMISSION_DENIED", message: "No access" })).toBe(false);
    expect(isMissingMergetoolBaseError({ code: "BINARY_FILE", message: "Binary" })).toBe(false);
    expect(isMissingMergetoolBaseError({ code: "NOT_FOUND" })).toBe(false);
    expect(isMissingMergetoolBaseError(new Error("not found"))).toBe(false);
  });
});

function mergetoolStartup(
  overrides: Partial<MergetoolStartupSession> = {},
): MergetoolStartupSession {
  return {
    kind: "mergetool",
    basePath: "/tmp/base",
    oursPath: "/tmp/local",
    theirsPath: "/tmp/remote",
    outputPath: "/repo/result.txt",
    ...overrides,
  };
}

function document(
  path: string,
  text: string,
  size: number,
  modifiedMs: number | null,
): FileDocument {
  return {
    path,
    name: path.split("/").pop() ?? path,
    text,
    encoding: "UTF-8",
    lineEnding: "lf",
    hadFinalNewline: text.endsWith("\n"),
    size,
    modifiedMs,
    contentHash: `${path.split("/").pop()}-content-hash`,
    isBinary: false,
    decodeHadErrors: false,
  };
}
