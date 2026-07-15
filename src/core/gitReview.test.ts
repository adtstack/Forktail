import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import type { GitChangedFile } from "./gitModels";
import { gitChangedFileKey } from "./gitSession";
import {
  createGitReviewState,
  gitReviewProgress,
  gitReviewScopeKey,
  markGitReviewViewed,
  nextGitReviewEntryKey,
  nextUnviewedGitReviewEntryKey,
  scopeGitReviewState,
} from "./gitReview";

function changed(index: number, status: GitChangedFile["status"] = "modified"): GitChangedFile {
  const oldPath = {
    opaqueId: `repository-session-1:path:4:${index * 2}`,
    displayPath: `src/file-${index}.ts`,
    utf8Path: `src/file-${index}.ts`,
  };
  const newPath = {
    opaqueId: status === "renamed"
      ? `repository-session-1:path:4:${index * 2 + 1}`
      : oldPath.opaqueId,
    displayPath: status === "renamed" ? `src/renamed-${index}.ts` : oldPath.displayPath,
    utf8Path: status === "renamed" ? `src/renamed-${index}.ts` : oldPath.utf8Path,
  };
  return { status, oldPath, newPath, similarityScore: status === "renamed" ? 88 : null };
}

const scope = gitReviewScopeKey({
  repositoryId: "repository-session-1",
  left: { algorithm: "sha1", hex: "a".repeat(40) },
  right: { algorithm: "sha1", hex: "b".repeat(40) },
  generation: 4,
});

describe("Git review state", () => {
  it("counts viewed state against the exact filtered entry set", () => {
    const all = [changed(1), changed(2), changed(3, "renamed")];
    let state = createGitReviewState(scope);
    state = markGitReviewViewed(state, gitChangedFileKey(all[0]!));
    state = markGitReviewViewed(state, gitChangedFileKey(all[1]!));

    expect(gitReviewProgress([all[0]!, all[2]!], state)).toEqual({
      total: 2,
      viewed: 1,
      remaining: 1,
    });
  });

  it("navigates previous/next and wraps to the next unviewed opaque identity", () => {
    const entries = [changed(1), changed(2), changed(3, "renamed")];
    let state = createGitReviewState(scope);
    state = markGitReviewViewed(state, gitChangedFileKey(entries[1]!));

    expect(nextGitReviewEntryKey(entries, gitChangedFileKey(entries[1]!), "next"))
      .toBe(gitChangedFileKey(entries[2]!));
    expect(nextGitReviewEntryKey(entries, gitChangedFileKey(entries[0]!), "previous"))
      .toBe(gitChangedFileKey(entries[2]!));
    expect(nextUnviewedGitReviewEntryKey(entries, state, gitChangedFileKey(entries[0]!)))
      .toBe(gitChangedFileKey(entries[2]!));
    state = markGitReviewViewed(state, gitChangedFileKey(entries[0]!));
    state = markGitReviewViewed(state, gitChangedFileKey(entries[2]!));
    expect(nextUnviewedGitReviewEntryKey(entries, state, null)).toBeNull();
  });

  it("resets on repository, revision pair, or refresh generation changes", () => {
    const viewed = markGitReviewViewed(createGitReviewState(scope), "opaque-key");
    expect(scopeGitReviewState(viewed, scope)).toBe(viewed);

    const baseScope = {
      repositoryId: "repository-session-1",
      left: { algorithm: "sha1" as const, hex: "a".repeat(40) },
      right: { algorithm: "sha1" as const, hex: "b".repeat(40) },
      generation: 4,
    };
    for (const nextScope of [
      gitReviewScopeKey({ ...baseScope, repositoryId: "repository-session-2" }),
      gitReviewScopeKey({
        ...baseScope,
        right: { algorithm: "sha1", hex: "c".repeat(40) },
      }),
      gitReviewScopeKey({ ...baseScope, generation: 5 }),
    ]) {
      const reset = scopeGitReviewState(viewed, nextScope);
      expect(reset.scopeKey).toBe(nextScope);
      expect(reset.viewedKeys.size).toBe(0);
    }
  });

  it("stores metadata keys only and handles 10k rows inside the UI budget", () => {
    const entries = Array.from({ length: 10_000 }, (_, index) => changed(index));
    let state = createGitReviewState(scope);
    for (let index = 0; index < entries.length; index += 2) {
      state = markGitReviewViewed(state, gitChangedFileKey(entries[index]!));
    }
    const started = performance.now();
    const progress = gitReviewProgress(entries, state);
    const next = nextUnviewedGitReviewEntryKey(entries, state, gitChangedFileKey(entries[9_998]!));
    const elapsedMs = performance.now() - started;

    expect(progress).toEqual({ total: 10_000, viewed: 5_000, remaining: 5_000 });
    expect(next).toBe(gitChangedFileKey(entries[9_999]!));
    expect(JSON.stringify({ scopeKey: state.scopeKey, viewedKeys: [...state.viewedKeys] }))
      .not.toContain("file contents");
    expect(elapsedMs).toBeLessThan(100);
  });
});
