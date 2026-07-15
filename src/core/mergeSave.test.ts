import { describe, expect, it, vi } from "vitest";
import {
  canSaveMergeResult,
  mergeSaveEncodingWarning,
  mergeSavePreconditionForPath,
  mergeSaveStateAfterWrite,
  unresolvedSaveMessage,
} from "./mergeSave";
import type { FileDocument, MergeSession } from "./models";

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

function mergeSession({ outputPath }: { outputPath: string | null }): MergeSession {
  return {
    base: document("/repo/base.txt", 8, 1000),
    ours: document("/repo/ours.txt", 9, 1001),
    theirs: document("/repo/theirs.txt", 10, 1002),
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
