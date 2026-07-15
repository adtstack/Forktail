import { describe, expect, it } from "vitest";
import { compareSessionCapabilities } from "./difftoolSession";
import { compareReportDefaultPath } from "./diffReport";
import { compareSavePreconditionForPath } from "./compareSave";
import { fileDocumentVersionChanged } from "./fileVersion";
import type { GitCompareSession, GitSnapshotDocument } from "./gitModels";
import { adaptGitCompareSession } from "./gitSession";
import { persistentCompareSessionInput } from "./settings";
import { isMissingFileDocument, isVirtualFileDocument } from "./virtualDocument";

function snapshot(
  contentState: GitSnapshotDocument["contentState"],
  label: string,
): GitSnapshotDocument {
  return {
    origin: contentState.kind === "missing" ? "missing" : "committedBlob",
    label,
    readOnly: true,
    objectId: contentState.kind === "missing"
      ? null
      : { algorithm: "sha1", hex: "b".repeat(40) },
    path: {
      opaqueId: `path:${label}`,
      displayPath: "src/file.txt",
      utf8Path: "src/file.txt",
    },
    mode: contentState.kind === "missing" ? null : "100644",
    textMetadata: contentState.kind === "text"
      ? {
          encoding: "UTF-8",
          lineEnding: "none",
          hadFinalNewline: true,
          decodeHadErrors: false,
          size: 0,
        }
      : null,
    workingTreeVersion: null,
    contentState,
  };
}

function gitSession(
  left: GitSnapshotDocument,
  right: GitSnapshotDocument,
): GitCompareSession {
  return {
    repositoryId: "repository-session-1",
    left,
    right,
    sourceKind: "revisionPair",
    revisionPair: {
      left: {
        rawLabel: "main~1",
        resolved: { algorithm: "sha1", hex: "a".repeat(40) },
        kind: "symbolic",
        displayName: "main~1",
      },
      right: {
        rawLabel: "main",
        resolved: { algorithm: "sha1", hex: "c".repeat(40) },
        kind: "branch",
        displayName: "main",
      },
    },
    revision: null,
    capabilities: {
      edit: false,
      save: false,
      hunkCopy: false,
      exportPatch: true,
    },
    generation: 4,
  };
}

function workingTreeSession(right: GitSnapshotDocument): GitCompareSession {
  const revision = {
    rawLabel: "HEAD",
    resolved: { algorithm: "sha1" as const, hex: "a".repeat(40) },
    kind: "head" as const,
    displayName: "HEAD",
  };
  return {
    ...gitSession(snapshot({ kind: "text", text: "committed\n" }, "HEAD · src/file.txt"), right),
    sourceKind: "revisionWorkingTree",
    revisionPair: null,
    revision,
  };
}

describe("Git compare session adapter", () => {
  it("adapts a stage-zero index text snapshot as a read-only virtual document", () => {
    const index = {
      ...snapshot({ kind: "text" as const, text: "index\n" }, "Index (stage 0) · src/file.txt"),
      origin: "indexStage" as const,
    };
    const session = {
      ...gitSession(snapshot({ kind: "text", text: "head\n" }, "HEAD · src/file.txt"), index),
      sourceKind: "headIndex" as const,
      revisionPair: null,
      revision: {
        rawLabel: "HEAD",
        resolved: { algorithm: "sha1" as const, hex: "a".repeat(40) },
        kind: "head" as const,
        displayName: "HEAD",
      },
    };

    const adapted = adaptGitCompareSession(session);

    expect(adapted.kind).toBe("compare");
    if (adapted.kind !== "compare") throw new Error("expected compare state");
    expect(adapted.session.right.text).toBe("index\n");
    expect(adapted.session.right.path).toContain("Index (stage 0)");
  });

  it("keeps working-tree disk content virtual and preserves its external-change version", () => {
    const right: GitSnapshotDocument = {
      ...snapshot({ kind: "text", text: "disk\n" }, "Working tree (disk) · src/file.txt"),
      origin: "workingTree",
      objectId: null,
      workingTreeVersion: { size: 5, modifiedMs: 1_700_000_000_000 },
    };

    const adapted = adaptGitCompareSession(workingTreeSession(right));

    expect(adapted.kind).toBe("compare");
    if (adapted.kind !== "compare") throw new Error("expected compare state");
    expect(adapted.session.right.text).toBe("disk\n");
    expect(adapted.session.right.modifiedMs).toBe(1_700_000_000_000);
    expect(adapted.session.right.path).toContain("Working tree (disk)");
    expect(adapted.session.right.virtual).toEqual({
      kind: "gitSnapshot",
      contentState: "text",
    });
  });

  it("adapts text and explicit missing states without conflating an empty blob", () => {
    const empty = snapshot({ kind: "text", text: "" }, "main~1 (aaaaaaaaaaaa) · src/file.txt");
    const missing = snapshot({ kind: "missing" }, "main (cccccccccccc) · src/file.txt");
    const adapted = adaptGitCompareSession(gitSession(empty, missing));

    expect(adapted.kind).toBe("compare");
    if (adapted.kind !== "compare") throw new Error("expected compare state");
    expect(adapted.session.origin).toBe("git");
    expect(adapted.session.left.virtual).toEqual({
      kind: "gitSnapshot",
      contentState: "text",
    });
    expect(adapted.session.right.virtual).toEqual({
      kind: "gitSnapshot",
      contentState: "missing",
    });
    expect(adapted.session.left.text).toBe("");
    expect(adapted.session.right.text).toBe("");
    expect(adapted.session.left.encoding).toBe("UTF-8");
    expect(adapted.session.right.encoding).toBe("Missing");
    expect(adapted.session.left.path).toContain("main~1 (aaaaaaaaaaaa)");
    expect(isVirtualFileDocument(adapted.session.left)).toBe(true);
    expect(isMissingFileDocument(adapted.session.left)).toBe(false);
    expect(isMissingFileDocument(adapted.session.right)).toBe(true);
  });

  it("keeps non-text Git states as notices instead of fake text documents", () => {
    for (const contentState of [
      { kind: "binary" } as const,
      { kind: "symlink" } as const,
      { kind: "submodule" } as const,
      { kind: "tooLarge" } as const,
      { kind: "lfsPointer", oidSha256: "d".repeat(64), referencedSize: 7 } as const,
      { kind: "unavailable", reason: "objectMissingLocal" } as const,
    ]) {
      const result = adaptGitCompareSession(gitSession(
        snapshot(contentState, "left"),
        snapshot({ kind: "text", text: "right" }, "right"),
      ));
      expect(result).toMatchObject({ kind: "notice" });
    }
  });

  it("disables mutation and persistence capabilities for committed snapshots", () => {
    const adapted = adaptGitCompareSession(gitSession(
      snapshot({ kind: "text", text: "left" }, "left"),
      snapshot({ kind: "text", text: "right" }, "right"),
    ));
    if (adapted.kind !== "compare") throw new Error("expected compare state");

    expect(compareSessionCapabilities(adapted.session)).toEqual({
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
    expect(persistentCompareSessionInput(adapted.session)).toBeNull();
    expect(compareReportDefaultPath(adapted.session)).toBeUndefined();
    expect(compareSavePreconditionForPath(
      adapted.session,
      adapted.session.left.path,
      null,
      "left",
    )).toBeNull();
    expect(fileDocumentVersionChanged(adapted.session.left, null)).toBe(false);
  });
});
