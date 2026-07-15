import { describe, expect, it } from "vitest";
import type { FileDocument } from "./models";
import {
  buildDifftoolSession,
  compareSessionCapabilities,
} from "./difftoolSession";
import type { DifftoolStartupSession } from "./startupSession";

describe("buildDifftoolSession", () => {
  it("builds a read-only difftool session from two loaded documents", () => {
    const local = document("/tmp/로컬 file", "local\n");
    const remote = document("/tmp/REMOTE", "remote\n");

    const session = buildDifftoolSession(
      difftoolStartup({ localPath: local.path, remotePath: remote.path }),
      { local, remote },
    );

    expect(session).toEqual({ origin: "difftool", left: local, right: remote });
  });

  it("represents a missing $LOCAL as a virtual document", () => {
    const remote = document("/tmp/REMOTE", "remote\n");

    const session = buildDifftoolSession(
      difftoolStartup({ localPath: null, remotePath: remote.path }),
      { local: null, remote },
    );

    expect(session.left).toMatchObject({
      path: "$LOCAL",
      text: "",
      encoding: "Missing",
      virtual: { kind: "missing" },
    });
    expect(session.right).toBe(remote);
  });

  it("represents a missing $REMOTE as a virtual document", () => {
    const local = document("/tmp/LOCAL", "local\n");

    const session = buildDifftoolSession(
      difftoolStartup({ localPath: local.path, remotePath: null }),
      { local, remote: null },
    );

    expect(session.left).toBe(local);
    expect(session.right).toMatchObject({
      path: "$REMOTE",
      text: "",
      encoding: "Missing",
      virtual: { kind: "missing" },
    });
  });

  it("fails closed when loaded documents do not match the parsed paths", () => {
    const startup = difftoolStartup();

    expect(() => buildDifftoolSession(startup, {
      local: document("/tmp/other", "local\n"),
      remote: document("/tmp/REMOTE", "remote\n"),
    })).toThrow(expect.objectContaining({ code: "PATH_CONFLICT" }));
    expect(() => buildDifftoolSession(startup, {
      local: null,
      remote: document("/tmp/REMOTE", "remote\n"),
    })).toThrow(expect.objectContaining({ code: "PATH_CONFLICT" }));
  });
});

describe("compareSessionCapabilities", () => {
  it("keeps ordinary file compare capabilities", () => {
    expect(compareSessionCapabilities({ origin: "files" })).toEqual({
      edit: true,
      save: true,
      saveAs: true,
      backupRestore: true,
      hunkCopy: true,
      replaceInput: true,
      swap: true,
      persistPaths: true,
      exportReport: true,
    });
  });

  it("makes difftool sessions read-only without disabling report export", () => {
    expect(compareSessionCapabilities({ origin: "difftool" })).toEqual({
      edit: false,
      save: false,
      saveAs: false,
      backupRestore: false,
      hunkCopy: false,
      replaceInput: false,
      swap: false,
      persistPaths: false,
      exportReport: true,
    });
  });
});

function difftoolStartup(
  overrides: Partial<DifftoolStartupSession> = {},
): DifftoolStartupSession {
  return {
    kind: "difftool",
    localPath: "/tmp/LOCAL",
    remotePath: "/tmp/REMOTE",
    ...overrides,
  };
}

function document(path: string, text: string): FileDocument {
  return {
    path,
    name: path.split("/").pop() ?? path,
    text,
    encoding: "UTF-8",
    lineEnding: "lf",
    hadFinalNewline: text.endsWith("\n"),
    size: new TextEncoder().encode(text).byteLength,
    modifiedMs: 1000,
    isBinary: false,
    decodeHadErrors: false,
  };
}
