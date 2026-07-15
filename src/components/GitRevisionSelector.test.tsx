import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  applyGitRevisionValidationResult,
  beginGitRevisionValidation,
  gitRevisionFromRepositoryHead,
  sameResolvedGitRevisions,
  type GitRefLoadState,
  type GitRevisionFieldState,
} from "../core/gitSession";
import type { GitRepositorySummary, GitRevision } from "../core/gitModels";
import { GitRevisionSelector } from "./GitRevisionSelector";

const repository: GitRepositorySummary = {
  sessionId: "repository-session-1",
  displayRoot: "/work/repository",
  isBare: false,
  isLinkedWorktree: false,
  isShallow: false,
  objectFormat: "sha1",
  head: {
    kind: "branch",
    fullName: "refs/heads/main",
    displayName: "main",
    objectId: { algorithm: "sha1", hex: "a".repeat(40) },
  },
};

const refs: GitRefLoadState = {
  kind: "ready",
  list: {
    refs: [
      {
        fullName: "refs/heads/main",
        displayName: "main",
        kind: "localBranch",
        objectId: { algorithm: "sha1", hex: "a".repeat(40) },
        objectType: "commit",
        peeledObjectId: null,
        peeledObjectType: null,
      },
      {
        fullName: "refs/heads/topic",
        displayName: "topic",
        kind: "localBranch",
        objectId: { algorithm: "sha1", hex: "b".repeat(40) },
        objectType: "commit",
        peeledObjectId: null,
        peeledObjectType: null,
      },
      {
        fullName: "refs/remotes/origin/main",
        displayName: "origin/main",
        kind: "remoteTrackingBranch",
        objectId: { algorithm: "sha1", hex: "c".repeat(40) },
        objectType: "commit",
        peeledObjectId: null,
        peeledObjectType: null,
      },
      {
        fullName: "refs/tags/v1",
        displayName: "v1",
        kind: "tag",
        objectId: { algorithm: "sha1", hex: "d".repeat(40) },
        objectType: "tag",
        peeledObjectId: { algorithm: "sha1", hex: "e".repeat(40) },
        peeledObjectType: "commit",
      },
    ],
    truncated: false,
  },
};

function revision(rawLabel: string, digit: string): GitRevision {
  return {
    rawLabel,
    resolved: { algorithm: "sha1", hex: digit.repeat(40) },
    kind: "branch",
    displayName: rawLabel,
  };
}

function field(
  overrides: Partial<GitRevisionFieldState> = {},
): GitRevisionFieldState {
  return {
    input: "",
    phase: "idle",
    revision: null,
    error: null,
    requestGeneration: 0,
    ...overrides,
  };
}

function renderSelector(
  state: GitRevisionFieldState,
  references: GitRefLoadState = refs,
): string {
  return renderToStaticMarkup(
    <GitRevisionSelector
      side="left"
      repository={repository}
      references={references}
      state={state}
      languageMode="en"
      onInputChange={() => {}}
      onSubmit={() => {}}
    />,
  );
}

describe("GitRevisionSelector", () => {
  it("exposes a keyboard-native combobox grouped by HEAD, local, remote-tracking, and tag refs", () => {
    const markup = renderSelector(field());

    expect(markup).toContain("role=\"combobox\"");
    expect(markup).toContain("aria-label=\"Left revision choices\"");
    expect(markup).toContain("<optgroup label=\"Current\"");
    expect(markup).toContain("HEAD — current branch main");
    expect(markup).toContain("<optgroup label=\"Local branches\"");
    expect(markup).toContain("topic");
    expect(markup).toContain("<optgroup label=\"Remote-tracking refs\"");
    expect(markup).toContain("origin/main");
    expect(markup).toContain("<optgroup label=\"Tags\"");
    expect(markup).toContain("v1");
    expect(markup).not.toContain("Recent commits");
  });

  it("uses explicit submit for advanced manual input and announces the immutable short ID", () => {
    const markup = renderSelector(field({
      input: "HEAD@{1}",
      phase: "resolved",
      revision: {
        rawLabel: "HEAD@{1}",
        resolved: { algorithm: "sha1", hex: "f".repeat(40) },
        kind: "symbolic",
        displayName: "HEAD@{1}",
      },
      requestGeneration: 3,
    }));

    expect(markup).toContain("<form");
    expect(markup).toContain("aria-label=\"Left revision input\"");
    expect(markup).toContain("value=\"HEAD@{1}\"");
    expect(markup).toContain("type=\"submit\"");
    expect(markup).toContain("Validate revision");
    expect(markup).toContain("Resolved ffffffffffff");
  });

  it("announces validation and inline ambiguity errors without hiding manual input", () => {
    const validating = renderSelector(field({
      input: "release",
      phase: "validating",
      requestGeneration: 7,
    }));
    const ambiguous = renderSelector(field({
      input: "release",
      phase: "error",
      error: "More than one ref or object matches this name.",
      requestGeneration: 7,
    }));

    expect(validating).toContain("role=\"status\"");
    expect(validating).toContain("Validating revision");
    expect(ambiguous).toContain("role=\"alert\"");
    expect(ambiguous).toContain("More than one ref or object matches this name.");
    expect(ambiguous).toContain("aria-label=\"Left revision input\"");
  });

  it("discards stale validation success or error after a newer request", () => {
    const first = beginGitRevisionValidation(field({ input: "main" }), "main", 11);
    const second = beginGitRevisionValidation(first, "topic", 12);
    const staleSuccess = applyGitRevisionValidationResult(second, {
      kind: "resolved",
      requestGeneration: 11,
      revision: revision("main", "a"),
    });
    const staleError = applyGitRevisionValidationResult(second, {
      kind: "error",
      requestGeneration: 11,
      error: "stale error",
    });
    const currentSuccess = applyGitRevisionValidationResult(second, {
      kind: "resolved",
      requestGeneration: 12,
      revision: revision("topic", "b"),
    });

    expect(staleSuccess).toBe(second);
    expect(staleError).toBe(second);
    expect(currentSuccess).toMatchObject({
      phase: "resolved",
      input: "topic",
      requestGeneration: 12,
      revision: { rawLabel: "topic" },
    });
  });

  it("detects identical immutable revisions across differently spelled inputs", () => {
    expect(sameResolvedGitRevisions(
      revision("main", "a"),
      { ...revision("HEAD", "a"), kind: "head" },
    )).toBe(true);
    expect(sameResolvedGitRevisions(revision("main", "a"), revision("topic", "b")))
      .toBe(false);
    expect(sameResolvedGitRevisions(revision("main", "a"), null)).toBe(false);
  });

  it("uses immutable repository HEAD as the initial right side and leaves unborn repositories empty", () => {
    expect(gitRevisionFromRepositoryHead(repository, 9)).toMatchObject({
      input: "HEAD",
      phase: "resolved",
      requestGeneration: 9,
      revision: {
        rawLabel: "HEAD",
        kind: "head",
        resolved: repository.head.kind === "branch" ? repository.head.objectId : null,
      },
    });
    expect(gitRevisionFromRepositoryHead({
      ...repository,
      head: { kind: "unborn" },
    }, 10)).toEqual(field({ requestGeneration: 10 }));
  });

  it("keeps manual validation available when ref loading fails", () => {
    const markup = renderSelector(field({ input: "deadbeef" }), {
      kind: "error",
      message: "Could not list local refs.",
    });

    expect(markup).toContain("Could not list local refs.");
    expect(markup).toContain("aria-label=\"Left revision input\"");
    expect(markup).toContain("Validate revision");
  });
});
