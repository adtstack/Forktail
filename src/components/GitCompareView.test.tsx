import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { GitRepositorySummary } from "../core/gitModels";
import type {
  GitChangedFilesReviewState,
  GitConflictReviewState,
  GitRevisionReviewState,
  GitTreePickerReviewState,
  GitWorkingTreeReviewState,
} from "./GitCompareView";
import {
  GitCompareView,
  isCurrentGitRepositoryRequest,
  planGitRepositoryExit,
  type GitRepositoryScreenState,
} from "./GitCompareView";

const branchRepository: GitRepositorySummary = {
  sessionId: "repository-session-1",
  displayRoot: "/work/forktail",
  isBare: false,
  isLinkedWorktree: true,
  isShallow: true,
  objectFormat: "sha1",
  head: {
    kind: "branch",
    fullName: "refs/heads/main",
    displayName: "main",
    objectId: { algorithm: "sha1", hex: "a".repeat(40) },
  },
};

function renderGitCompareView(
  state: GitRepositoryScreenState,
  languageMode: "en" | "ko" = "en",
  revisionReview?: GitRevisionReviewState,
  changedFilesReview?: GitChangedFilesReviewState,
  workingTreeReview?: GitWorkingTreeReviewState,
  conflictReview?: GitConflictReviewState,
  treePickerReview?: GitTreePickerReviewState,
): string {
  return renderToStaticMarkup(
    <GitCompareView
      state={state}
      languageMode={languageMode}
      revisionReview={revisionReview}
      changedFilesReview={changedFilesReview}
      workingTreeReview={workingTreeReview}
      conflictReview={conflictReview}
      treePickerReview={treePickerReview}
      onBack={() => {}}
      onOpenRepository={() => {}}
      onCancelOpen={() => {}}
      onRevisionInputChange={() => {}}
      onValidateRevision={() => {}}
      onChangedFileFilterChange={() => {}}
      onChangedFileStatusFilterChange={() => {}}
      onSelectChangedFile={() => {}}
      onLoadTrackedTrees={() => {}}
      onCancelTrackedTrees={() => {}}
      onCloseTrackedTrees={() => {}}
      onTrackedTreeQueryChange={() => {}}
      onSelectTrackedTreePath={() => {}}
      onCompareTrackedTreePaths={() => {}}
      onRefreshWorkingTree={() => {}}
      onWorkingTreeFilterChange={() => {}}
      onWorkingTreeSectionFilterChange={() => {}}
      onWorkingTreeComparisonChange={() => {}}
      onSelectWorkingTreeFile={() => {}}
      onRefreshConflicts={() => {}}
      onSelectConflict={() => {}}
    />,
  );
}

describe("GitCompareView repository shell", () => {
  it("renders a cancellable, announced loading state without stale repository metadata", () => {
    const markup = renderGitCompareView({ kind: "loading", requestId: 7 });

    expect(markup).toContain("role=\"status\"");
    expect(markup).toContain("aria-live=\"polite\"");
    expect(markup).toContain("Opening Git repository");
    expect(markup).toContain("Cancel opening");
    expect(markup).not.toContain("/work/forktail");
    expect(planGitRepositoryExit({ kind: "loading", requestId: 7 })).toEqual({
      releaseRequestId: 7,
      closeSessionId: null,
    });
    expect(isCurrentGitRepositoryRequest(8, 7)).toBe(false);
    expect(isCurrentGitRepositoryRequest(8, 8)).toBe(true);
  });

  it("renders a recoverable error state without inventing repository details", () => {
    const markup = renderGitCompareView({
      kind: "error",
      message: "This folder is not a Git repository.",
    });

    expect(markup).toContain("role=\"alert\"");
    expect(markup).toContain("This folder is not a Git repository.");
    expect(markup).toContain("Choose another folder");
    expect(markup).toContain("Back to start");
    expect(markup).not.toContain("Current branch");
  });

  it("labels branch, root, linked worktree, shallow history, local-only, and read-only state", () => {
    const markup = renderGitCompareView({ kind: "ready", repository: branchRepository });

    expect(markup).toContain("aria-label=\"Repository review\"");
    expect(markup).toContain("/work/forktail");
    expect(markup).toContain("Current branch");
    expect(markup).toContain("main · aaaaaaaaaaaa");
    expect(markup).toContain("aaaaaaaaaaaa");
    expect(markup).toContain("Linked worktree");
    expect(markup).toContain("Shallow history");
    expect(markup).toContain("Local snapshots only");
    expect(markup).toContain("Read-only review");
    expect(markup).toContain("Open another repository");
    expect(planGitRepositoryExit({ kind: "ready", repository: branchRepository })).toEqual({
      releaseRequestId: null,
      closeSessionId: "repository-session-1",
    });
  });

  it("distinguishes detached HEAD and an unborn empty repository", () => {
    const detached = renderGitCompareView({
      kind: "ready",
      repository: {
        ...branchRepository,
        isLinkedWorktree: false,
        isShallow: false,
        head: {
          kind: "detached",
          objectId: { algorithm: "sha1", hex: "b".repeat(40) },
        },
      },
    });
    const unborn = renderGitCompareView({
      kind: "ready",
      repository: {
        ...branchRepository,
        head: { kind: "unborn" },
      },
    });

    expect(detached).toContain("Detached HEAD");
    expect(detached).toContain("bbbbbbbbbbbb");
    expect(unborn).toContain("No commits yet");
    expect(unborn).toContain("Create the first commit outside Forktail");
  });

  it("keeps the repository shell mutation-free and localized", () => {
    const markup = renderGitCompareView(
      { kind: "ready", repository: branchRepository },
      "ko",
    );
    const lowerMarkup = markup.toLowerCase();

    expect(markup).toContain("저장소 검토");
    expect(markup).toContain("읽기 전용 검토");
    for (const mutation of ["checkout", "fetch", "pull", "push", "commit", "stage", "switch branch"]) {
      expect(lowerMarkup).not.toContain(`>${mutation}<`);
    }
  });

  it("renders both revision selectors and announces an identical-revision error", () => {
    const resolvedHead = {
      input: "HEAD",
      phase: "resolved" as const,
      revision: {
        rawLabel: "HEAD",
        resolved: { algorithm: "sha1" as const, hex: "a".repeat(40) },
        kind: "head" as const,
        displayName: "HEAD",
      },
      error: null,
      requestGeneration: 3,
    };
    const markup = renderGitCompareView(
      { kind: "ready", repository: branchRepository },
      "en",
      {
        left: resolvedHead,
        right: resolvedHead,
        references: { kind: "ready", list: { refs: [], truncated: false } },
        pairError: "Choose two different revisions.",
      },
    );

    expect(markup).toContain("aria-label=\"Left revision choices\"");
    expect(markup).toContain("aria-label=\"Right revision choices\"");
    expect(markup).toContain("role=\"alert\"");
    expect(markup).toContain("Choose two different revisions.");
  });

  it("keeps the default HEAD side and automatically exposes changed files within the short review journey", () => {
    const left = {
      input: "main~1",
      phase: "resolved" as const,
      revision: {
        rawLabel: "main~1",
        resolved: { algorithm: "sha1" as const, hex: "b".repeat(40) },
        kind: "symbolic" as const,
        displayName: "main~1",
      },
      error: null,
      requestGeneration: 4,
    };
    const right = {
      input: "HEAD",
      phase: "resolved" as const,
      revision: {
        rawLabel: "HEAD",
        resolved: { algorithm: "sha1" as const, hex: "a".repeat(40) },
        kind: "head" as const,
        displayName: "HEAD",
      },
      error: null,
      requestGeneration: 4,
    };
    const changedFile = {
      status: "modified" as const,
      oldPath: {
        opaqueId: "repository-session-1:path:1",
        displayPath: "src/feature.ts",
        utf8Path: "src/feature.ts",
      },
      newPath: {
        opaqueId: "repository-session-1:path:1",
        displayPath: "src/feature.ts",
        utf8Path: "src/feature.ts",
      },
      similarityScore: null,
    };
    const markup = renderGitCompareView(
      { kind: "ready", repository: branchRepository },
      "en",
      {
        left,
        right,
        references: { kind: "ready", list: { refs: [], truncated: false } },
        pairError: null,
      },
      {
        state: {
          kind: "ready",
          requestGeneration: 7,
          list: {
            entries: [changedFile],
            counts: {
              added: 0,
              deleted: 0,
              modified: 1,
              typeChanged: 0,
              renamed: 0,
              copied: 0,
              unmerged: 0,
              unknown: 0,
              total: 1,
            },
            truncated: false,
            generation: 4,
          },
        },
        filter: { query: "", status: "all" },
        selectedKey: null,
        reviewState: { scopeKey: "test-scope", viewedKeys: new Set() },
        snapshotState: { kind: "idle" },
      },
    );

    expect(markup).toContain("value=\"HEAD\"");
    expect(markup).toContain("main~1");
    expect(markup).toContain("Changed files");
    expect(markup).toContain("src/feature.ts");
    expect(markup).toContain("role=\"option\"");
  });

  it("exposes working-tree status and the three-state selector independently of revision-pair input", () => {
    const markup = renderGitCompareView(
      { kind: "ready", repository: branchRepository },
      "en",
      undefined,
      undefined,
      {
        state: {
          kind: "ready",
          requestGeneration: 8,
          snapshot: {
            branch: {
              state: {
                kind: "branch",
                displayName: "main",
                objectId: { algorithm: "sha1", hex: "a".repeat(40) },
              },
              upstream: null,
              ahead: null,
              behind: null,
            },
            staged: [],
            unstaged: [],
            untracked: [{
              opaqueId: "repository-session-1:path:8:1",
              displayPath: "new.txt",
              utf8Path: "new.txt",
            }],
            unmerged: [],
            truncated: false,
            totalEntries: 1,
            generation: 8,
          },
        },
        filter: { query: "", section: "all" },
        comparison: "headToWorkingTree",
        selectedKey: null,
        snapshotState: { kind: "idle" },
      },
    );

    expect(markup).toContain("Working tree changes");
    expect(markup).toContain("new.txt");
    expect(markup).toContain("HEAD ↔ working tree");
    expect(markup).toContain("Refresh status");
  });

  it("uses wrapping and scroll containment needed at 200 percent zoom", () => {
    const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

    expect(styles).toMatch(/\.git-repository-shell\s*\{[^}]*overflow:\s*auto/s);
    expect(styles).toMatch(/\.git-repository-root\s*\{[^}]*overflow-wrap:\s*anywhere/s);
    expect(styles).toMatch(/@media \(max-width: 900px\)[\s\S]*\.git-repository-header/s);
    expect(styles).toMatch(/\.git-revision-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2/s);
    expect(styles).toMatch(/@media \(max-width: 900px\)[\s\S]*\.git-revision-grid/s);
    expect(styles).toMatch(/@media \(max-width: 900px\)[\s\S]*\.git-conflict-row/s);
  });

  it("keeps changed files primary and makes the full tracked tree explicitly opt-in", () => {
    const markup = renderGitCompareView(
      { kind: "ready", repository: branchRepository },
      "en",
      undefined,
      undefined,
      undefined,
      undefined,
      {
        state: { kind: "idle" },
        query: "",
        leftSelection: null,
        rightSelection: null,
        openState: { kind: "idle" },
      },
    );

    expect(markup).toContain("Browse all tracked files");
    expect(markup).toContain("Changed files remain the default review list");
  });
});

describe("GitCompareView conflict review", () => {
  it("places unmerged paths in the repository review without exposing Git mutation actions", () => {
    const path = {
      opaqueId: "repository-session-1:path:4:1",
      displayPath: "src/conflict.ts",
      utf8Path: "src/conflict.ts",
    };
    const stage = {
      mode: "100644",
      objectId: { algorithm: "sha1" as const, hex: "a".repeat(40) },
    };
    const conflictReview: GitConflictReviewState = {
      state: {
        kind: "ready",
        requestGeneration: 4,
        list: {
          entries: [{ path, stage1: stage, stage2: stage, stage3: stage }],
          operation: "merge",
          truncated: false,
          totalEntries: 1,
          generation: 4,
        },
      },
      selectedKey: path.opaqueId,
      openState: { kind: "idle" },
    };

    const markup = renderGitCompareView(
      { kind: "ready", repository: branchRepository },
      "en",
      undefined,
      undefined,
      undefined,
      conflictReview,
    );

    expect(markup).toContain("Conflicts 1");
    expect(markup).toContain("src/conflict.ts");
    expect(markup).toContain("Open Result editor");
    expect(markup).not.toMatch(/>Stage<|>Add<|>Continue<|>Commit</);
  });
});
