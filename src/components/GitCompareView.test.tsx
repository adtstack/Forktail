import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { GitRepositorySummary } from "../core/gitModels";
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
): string {
  return renderToStaticMarkup(
    <GitCompareView
      state={state}
      languageMode={languageMode}
      onBack={() => {}}
      onOpenRepository={() => {}}
      onCancelOpen={() => {}}
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

  it("uses wrapping and scroll containment needed at 200 percent zoom", () => {
    const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

    expect(styles).toMatch(/\.git-repository-shell\s*\{[^}]*overflow:\s*auto/s);
    expect(styles).toMatch(/\.git-repository-root\s*\{[^}]*overflow-wrap:\s*anywhere/s);
    expect(styles).toMatch(/@media \(max-width: 900px\)[\s\S]*\.git-repository-header/s);
  });
});
