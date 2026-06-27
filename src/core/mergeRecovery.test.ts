import { describe, expect, it } from "vitest";
import {
  MAX_MERGE_DRAFT_BYTES,
  MAX_MERGE_DRAFTS,
  clearMergeRecoveryDraft,
  loadMergeRecoveryDraft,
  mergeRecoveryDraftId,
  sanitizeMergeRecoveryDrafts,
  saveMergeRecoveryDraft,
} from "./mergeRecovery";
import type { FileDocument, MergeSession } from "./models";

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe("merge recovery drafts", () => {
  it("stores and loads only the merge result draft for matching input versions", () => {
    const storage = new MemoryStorage();
    const session = mergeSession({ result: "merged draft\n" });

    expect(saveMergeRecoveryDraft(session, storage, 1000)).toBe(true);

    expect(loadMergeRecoveryDraft(mergeSession(), storage)).toMatchObject({
      id: mergeRecoveryDraftId(session),
      basePath: "/repo/base.ts",
      oursPath: "/repo/ours.ts",
      theirsPath: "/repo/theirs.ts",
      outputPath: null,
      result: "merged draft\n",
      updatedAt: 1000,
    });
    const raw = storage.getItem("forktail.merge-drafts.v1") ?? "";
    expect(raw).not.toContain("base file contents");
    expect(raw).not.toContain("ours file contents");
    expect(raw).not.toContain("theirs file contents");
  });

  it("ignores drafts when an input file version changed", () => {
    const storage = new MemoryStorage();
    const session = mergeSession({ result: "merged draft\n" });

    saveMergeRecoveryDraft(session, storage, 1000);

    expect(
      loadMergeRecoveryDraft(
        {
          ...mergeSession(),
          ours: { ...mergeSession().ours, size: 999 },
        },
        storage,
      ),
    ).toBeNull();
  });

  it("clears a draft by merge identity", () => {
    const storage = new MemoryStorage();
    const session = mergeSession({ result: "merged draft\n" });
    saveMergeRecoveryDraft(session, storage, 1000);

    clearMergeRecoveryDraft(session, storage);

    expect(loadMergeRecoveryDraft(mergeSession(), storage)).toBeNull();
  });

  it("rejects oversized drafts and keeps the list bounded newest-first", () => {
    const storage = new MemoryStorage();
    const oversized = mergeSession({ result: "x".repeat(MAX_MERGE_DRAFT_BYTES + 1) });

    expect(saveMergeRecoveryDraft(oversized, storage, 1000)).toBe(false);

    for (let index = 0; index < MAX_MERGE_DRAFTS + 3; index += 1) {
      saveMergeRecoveryDraft(
        mergeSession({
          basePath: `/repo/base-${index}.ts`,
          result: `draft ${index}`,
        }),
        storage,
        index + 1,
      );
    }

    const raw = storage.getItem("forktail.merge-drafts.v1") ?? "[]";
    const drafts = sanitizeMergeRecoveryDrafts(JSON.parse(raw));
    expect(drafts).toHaveLength(MAX_MERGE_DRAFTS);
    expect(drafts[0].basePath).toBe("/repo/base-12.ts");
    expect(drafts.at(-1)?.basePath).toBe("/repo/base-3.ts");
  });
});

function mergeSession({
  basePath = "/repo/base.ts",
  result = "auto merge\n",
}: {
  basePath?: string;
  result?: string;
} = {}): MergeSession {
  return {
    base: document(basePath, "base file contents\n", 1000),
    ours: document("/repo/ours.ts", "ours file contents\n", 1001),
    theirs: document("/repo/theirs.ts", "theirs file contents\n", 1002),
    result,
    outputPath: null,
  };
}

function document(path: string, text: string, modifiedMs: number): FileDocument {
  return {
    path,
    name: path.split("/").pop() ?? path,
    text,
    encoding: "UTF-8",
    lineEnding: "lf",
    hadFinalNewline: text.endsWith("\n"),
    size: new TextEncoder().encode(text).byteLength,
    modifiedMs,
    isBinary: false,
    decodeHadErrors: false,
  };
}
