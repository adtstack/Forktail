import { describe, expect, it, vi } from "vitest";
import {
  canSaveMergeResult,
  gitConflictSaveRequest,
  mergeSaveEncodingWarning,
  mergeSavePreconditionForPath,
  mergeResultOriginalLineEnding,
  mergeSaveStateAfterWrite,
  unresolvedSaveMessage,
} from "./mergeSave";
import type { FileDocument, FileMergeSession, MergeSession } from "./models";
import type { GitConflictStageFingerprint } from "./gitModels";
import { virtualMissingFileDocument } from "./virtualDocument";

const unresolved = `<<<<<<< ours
ours
||||||| original
base
=======
theirs
>>>>>>> theirs
`;

describe("canSaveMergeResult", () => {
  it("does not ask for confirmation when there are no conflict markers", () => {
    const confirm = vi.fn(() => false);

    expect(canSaveMergeResult("clean\nresult\n", confirm)).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("allows forced save when the user confirms unresolved conflicts", () => {
    const confirm = vi.fn(() => true);

    expect(canSaveMergeResult(unresolved, confirm)).toBe(true);
    expect(confirm).toHaveBeenCalledWith(unresolvedSaveMessage);
  });

  it("blocks save when unresolved conflicts are not confirmed", () => {
    const confirm = vi.fn(() => false);

    expect(canSaveMergeResult(unresolved, confirm)).toBe(false);
    expect(confirm).toHaveBeenCalledWith(unresolvedSaveMessage);
  });

  it("hard-blocks unresolved Git markers when confirmation is disabled for mergetool", () => {
    const confirm = vi.fn(() => true);
    const gitUnresolved = "<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> feature/topic\n";

    expect(canSaveMergeResult(gitUnresolved, confirm, "block-unresolved")).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("allows a clean mergetool result when unresolved confirmation is disabled", () => {
    const confirm = vi.fn(() => true);

    expect(canSaveMergeResult("clean\nresult\n", confirm, "block-unresolved")).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });
});

describe("mergeSaveStateAfterWrite", () => {
  it("tracks the saved output path and clean snapshot", () => {
    expect(
      mergeSaveStateAfterWrite("result\n", {
        path: "/out/merged.txt",
        backupPath: null,
        size: 7,
        modifiedMs: 1234,
      }),
    ).toEqual({
      outputPath: "/out/merged.txt",
      savedSnapshot: "result\n",
      outputVersion: {
        expectedSize: 7,
        expectedModifiedMs: 1234,
      },
      message: "Saved",
    });
  });

  it("includes the backup path in the completion message", () => {
    expect(
      mergeSaveStateAfterWrite("result\n", {
        path: "/out/merged.txt",
        backupPath: "/out/merged.txt.bak",
        size: 7,
        modifiedMs: null,
      }).message,
    ).toBe("Saved · backup: /out/merged.txt.bak");
  });
});

describe("mergeSaveEncodingWarning", () => {
  it("does not warn when all merge inputs are plain UTF-8 without decode errors", () => {
    expect(mergeSaveEncodingWarning(mergeSession({ outputPath: null }))).toBeNull();
  });

  it("warns when any input encoding will not be preserved in the UTF-8 result", () => {
    const session = mergeSession({ outputPath: null });

    expect(
      mergeSaveEncodingWarning({
        ...session,
        theirs: {
          ...session.theirs,
          encoding: "UTF-16BE BOM",
        },
      }),
    ).toContain("original encoding");
  });

  it("prioritizes decode-loss wording when any source decoded with replacement", () => {
    const session = mergeSession({ outputPath: null });

    expect(
      mergeSaveEncodingWarning({
        ...session,
        ours: {
          ...session.ours,
          decodeHadErrors: true,
        },
      }),
    ).toContain("decode loss");
  });

  it("uses existing Result metadata for mergetool EOL and UTF-8 conversion warnings", () => {
    const session = mergeSession({ outputPath: "/repo/MERGED" });
    const output = {
      ...document("/repo/MERGED", 20, 2000),
      encoding: "UTF-16LE BOM",
      lineEnding: "crlf" as const,
    };
    const mergetool: MergeSession = {
      ...session,
      origin: "mergetool",
      output,
      outputPath: "/repo/MERGED",
    };

    expect(mergeResultOriginalLineEnding(mergetool)).toBe("crlf");
    expect(mergeSaveEncodingWarning(mergetool)).toContain("original encoding");
  });

  it("does not treat a virtual missing Git Base as an encoding risk", () => {
    const session = mergeSession({ outputPath: "/repo/MERGED" });

    expect(
      mergeSaveEncodingWarning({
        ...session,
        origin: "mergetool",
        base: virtualMissingFileDocument("$BASE"),
        output: document("/repo/MERGED", 20, 2000),
        outputPath: "/repo/MERGED",
      }),
    ).toBeNull();
  });
});

describe("mergeSavePreconditionForPath", () => {
  it("uses the last saved output version when overwriting the current output path", () => {
    const session = mergeSession({ outputPath: "/out/merged.txt" });

    expect(
      mergeSavePreconditionForPath(session, "/out/merged.txt", {
        expectedSize: 22,
        expectedModifiedMs: 2000,
      }),
    ).toEqual({
      expectedSize: 22,
      expectedModifiedMs: 2000,
    });
  });

  it("uses an input document version when saving over that exact input path", () => {
    const session = mergeSession({ outputPath: null });

    expect(mergeSavePreconditionForPath(session, "/repo/ours.txt", null)).toEqual({
      expectedSize: 9,
      expectedModifiedMs: 1001,
    });
  });

  it("does not guard arbitrary Save As paths without a known baseline", () => {
    expect(mergeSavePreconditionForPath(mergeSession({ outputPath: null }), "/other/out.txt", null)).toBeNull();
  });
});

describe("Git conflict Result save request", () => {
  it("uses only the opaque identity and frozen stage/result fingerprints", () => {
    const stageFingerprint: GitConflictStageFingerprint = {
      stage1: null,
      stage2: {
        mode: "100644",
        objectId: { algorithm: "sha1", hex: "2".repeat(40) },
      },
      stage3: {
        mode: "100644",
        objectId: { algorithm: "sha1", hex: "3".repeat(40) },
      },
    };
    const source = {
      conflict: {
        path: { opaqueId: "session:path:7:2" },
        generation: 7,
        stageFingerprint,
        resultFingerprint: {
          kind: "regularFile" as const,
          size: 20,
          modifiedMs: 1234,
          contentHash: "a".repeat(64),
        },
      },
    };

    expect(gitConflictSaveRequest(source, "resolved\n", "original")).toEqual({
      opaquePathId: "session:path:7:2",
      generation: 7,
      expectedStageFingerprint: stageFingerprint,
      expectedResultFingerprint: source.conflict.resultFingerprint,
      text: "resolved\n",
      encodingPolicy: "preserveResult",
      lineEndingPolicy: "preserveResult",
      createBackup: true,
      explicitOverwriteDecision: false,
    });
  });

  it("maps explicit and system line-ending choices without changing Result text client-side", () => {
    const source = {
      conflict: {
        path: { opaqueId: "session:path:1:1" },
        generation: 1,
        stageFingerprint: { stage1: null, stage2: null, stage3: null },
        resultFingerprint: {
          kind: "missing" as const,
          size: null,
          modifiedMs: null,
          contentHash: null,
        },
      },
    };

    expect(gitConflictSaveRequest(source, "a\nb\n", "crlf").lineEndingPolicy).toBe("crlf");
    expect(gitConflictSaveRequest(source, "a\nb\n", "system", "\n").lineEndingPolicy).toBe("lf");
    expect(gitConflictSaveRequest(source, "a\nb\n", "system", "\r\n").lineEndingPolicy).toBe("crlf");
    expect(gitConflictSaveRequest(source, "a\nb\n", "lf", "\r\n").text).toBe("a\nb\n");
  });
});

function mergeSession({ outputPath }: { outputPath: string | null }): FileMergeSession {
  return {
    origin: "files",
    base: document("/repo/base.txt", 8, 1000),
    ours: document("/repo/ours.txt", 9, 1001),
    theirs: document("/repo/theirs.txt", 10, 1002),
    output: null,
    result: "merged\n",
    outputPath,
  };
}

function document(path: string, size: number, modifiedMs: number): FileDocument {
  return {
    path,
    name: path.split("/").pop() ?? path,
    text: "",
    encoding: "UTF-8",
    lineEnding: "lf",
    hadFinalNewline: true,
    size,
    modifiedMs,
    isBinary: false,
    decodeHadErrors: false,
  };
}
