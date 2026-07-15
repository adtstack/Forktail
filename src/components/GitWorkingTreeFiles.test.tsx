import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  filterGitWorkingTreeRows,
  gitWorkingTreeRowKey,
  gitWorkingTreeRows,
  isCurrentGitRequest,
  nextGitWorkingTreeRowKey,
  selectedGitWorkingTreeRowKeyAfterRefresh,
  type GitSnapshotSelectionState,
  type GitWorkingTreeFilter,
  type GitWorkingTreeLoadState,
} from "../core/gitSession";
import type {
  GitStatusEntry,
  GitStatusSnapshot,
  GitUnmergedStatusEntry,
} from "../core/gitModels";
import { GitWorkingTreeFiles } from "./GitWorkingTreeFiles";

function path(name: string, id: number) {
  return {
    opaqueId: `repository-session-1:path:9:${id}`,
    displayPath: name,
    utf8Path: name,
  };
}

function statusEntry(
  name: string,
  id: number,
  change: GitStatusEntry["change"] = "modified",
): GitStatusEntry {
  return {
    change,
    path: path(name, id),
    originalPath: change === "renamed" ? path(`old-${name}`, id + 100) : null,
    similarityScore: change === "renamed" ? 91 : null,
    submodule: {
      isSubmodule: false,
      commitChanged: false,
      trackedChanges: false,
      untrackedChanges: false,
    },
    headMode: "100644",
    indexMode: "100644",
    worktreeMode: "100644",
    headObjectId: { algorithm: "sha1", hex: "a".repeat(40) },
    indexObjectId: { algorithm: "sha1", hex: "b".repeat(40) },
  };
}

function unmergedEntry(): GitUnmergedStatusEntry {
  return {
    conflictCode: "UU",
    path: path("src/conflict.ts", 4),
    submodule: {
      isSubmodule: false,
      commitChanged: false,
      trackedChanges: false,
      untrackedChanges: false,
    },
    stage1Mode: "100644",
    stage2Mode: "100644",
    stage3Mode: "100644",
    worktreeMode: "100644",
    stage1ObjectId: { algorithm: "sha1", hex: "1".repeat(40) },
    stage2ObjectId: { algorithm: "sha1", hex: "2".repeat(40) },
    stage3ObjectId: { algorithm: "sha1", hex: "3".repeat(40) },
  };
}

function snapshot(): GitStatusSnapshot {
  const sharedPath = path("src/both.ts", 1);
  return {
    branch: {
      state: {
        kind: "branch",
        displayName: "main",
        objectId: { algorithm: "sha1", hex: "a".repeat(40) },
      },
      upstream: "origin/main",
      ahead: 2,
      behind: 1,
    },
    staged: [{ ...statusEntry("src/both.ts", 1), path: sharedPath }],
    unstaged: [
      { ...statusEntry("src/both.ts", 1), path: sharedPath },
      statusEntry("src/renamed.ts", 2, "renamed"),
    ],
    untracked: [path("notes/new file.txt", 3)],
    unmerged: [unmergedEntry()],
    truncated: false,
    totalEntries: 5,
    generation: 9,
  };
}

function renderWorkingTree(
  state: GitWorkingTreeLoadState = {
    kind: "ready",
    requestGeneration: 1,
    snapshot: snapshot(),
  },
  filter: GitWorkingTreeFilter = { query: "", section: "all" },
  selectedKey: string | null = null,
  snapshotState: GitSnapshotSelectionState = { kind: "idle" },
): string {
  return renderToStaticMarkup(
    <GitWorkingTreeFiles
      state={state}
      filter={filter}
      comparison="indexToWorkingTree"
      selectedKey={selectedKey}
      snapshotState={snapshotState}
      languageMode="en"
      onRefresh={() => {}}
      onFilterChange={() => {}}
      onSectionFilterChange={() => {}}
      onComparisonChange={() => {}}
      onSelect={() => {}}
    />,
  );
}

describe("GitWorkingTreeFiles", () => {
  it("keeps staged, unstaged, untracked, and unmerged rows textually distinct", () => {
    const markup = renderWorkingTree();

    expect(markup).toContain("Working tree changes");
    expect(markup).toContain("Staged 1");
    expect(markup).toContain("Unstaged 2");
    expect(markup).toContain("Untracked 1");
    expect(markup).toContain("Unmerged 1");
    expect(markup.match(/src\/both.ts/g)?.length).toBe(2);
    expect(markup).toContain("old-src/renamed.ts → src/renamed.ts");
    expect(markup).toContain("Conflict UU");
    expect(markup).toContain("aria-disabled=\"true\"");
  });

  it("shows only status metadata Git actually supplied and all three read-only comparisons", () => {
    const markup = renderWorkingTree();

    expect(markup).toContain("main");
    expect(markup).toContain("origin/main");
    expect(markup).toContain("Ahead 2");
    expect(markup).toContain("Behind 1");
    expect(markup).toContain("HEAD ↔ index");
    expect(markup).toContain("index ↔ working tree");
    expect(markup).toContain("HEAD ↔ working tree");
    expect(markup).toContain("Read-only");
    expect(markup).not.toMatch(/>Stage<|>Unstage<|>Add<|>Commit</);
  });

  it("filters without conflating a path that has both staged and unstaged changes", () => {
    const rows = gitWorkingTreeRows(snapshot());
    const staged = filterGitWorkingTreeRows(rows, { query: "both", section: "staged" });
    const unstaged = filterGitWorkingTreeRows(rows, { query: "both", section: "unstaged" });

    expect(rows).toHaveLength(5);
    expect(staged).toHaveLength(1);
    expect(unstaged).toHaveLength(1);
    expect(staged[0]?.path.opaqueId).toBe(unstaged[0]?.path.opaqueId);
    expect(gitWorkingTreeRowKey(staged[0]!)).not.toBe(gitWorkingTreeRowKey(unstaged[0]!));
  });

  it("renders a sanitized non-UTF-8 display path but selects only by opaque identity", () => {
    const nonUtfPath = {
      opaqueId: "repository-session-1:path:9:raw",
      displayPath: "src/bad\\xFF-name.txt",
      utf8Path: null,
    };
    const nonUtfSnapshot = { ...snapshot(), untracked: [nonUtfPath] };
    const rows = gitWorkingTreeRows(nonUtfSnapshot);
    const row = rows.find((candidate) => candidate.path.opaqueId === nonUtfPath.opaqueId)!;
    const markup = renderWorkingTree({
      kind: "ready",
      requestGeneration: 9,
      snapshot: nonUtfSnapshot,
    });

    expect(markup).toContain("src/bad\\xFF-name.txt");
    expect(gitWorkingTreeRowKey(row)).toContain(nonUtfPath.opaqueId);
    expect(gitWorkingTreeRowKey(row)).not.toContain(nonUtfPath.displayPath);
  });

  it("drops vanished selection after refresh and ignores stale status or compare results", () => {
    const before = gitWorkingTreeRows(snapshot());
    const selected = gitWorkingTreeRowKey(before[3]!);
    const refreshedSnapshot = { ...snapshot(), untracked: [] };
    const refreshed = gitWorkingTreeRows(refreshedSnapshot);

    expect(selectedGitWorkingTreeRowKeyAfterRefresh(selected, refreshed)).toBeNull();
    expect(selectedGitWorkingTreeRowKeyAfterRefresh(
      gitWorkingTreeRowKey(before[0]!),
      refreshed,
    )).toBe(gitWorkingTreeRowKey(before[0]!));
    expect(isCurrentGitRequest(12, 11)).toBe(false);
    expect(isCurrentGitRequest(12, 12)).toBe(true);
  });

  it("supports bounded keyboard movement across filtered rows", () => {
    const rows = gitWorkingTreeRows(snapshot());
    const first = gitWorkingTreeRowKey(rows[0]!);
    const last = gitWorkingTreeRowKey(rows.at(-1)!);

    expect(nextGitWorkingTreeRowKey(rows, null, "ArrowDown")).toBe(first);
    expect(nextGitWorkingTreeRowKey(rows, first, "ArrowUp")).toBe(first);
    expect(nextGitWorkingTreeRowKey(rows, first, "End")).toBe(last);
    expect(nextGitWorkingTreeRowKey(rows, last, "ArrowDown")).toBe(last);
    expect(renderWorkingTree()).toContain(
      "aria-keyshortcuts=\"ArrowUp ArrowDown Home End Enter\"",
    );
  });

  it("announces loading, refresh errors, and sparse or non-text compare limitations", () => {
    expect(renderWorkingTree({ kind: "loading", requestGeneration: 4 }))
      .toContain("Loading working tree status");
    expect(renderWorkingTree({
      kind: "error",
      requestGeneration: 4,
      message: "The repository changed. Refresh status.",
    })).toContain("The repository changed. Refresh status.");

    const rows = gitWorkingTreeRows(snapshot());
    const key = gitWorkingTreeRowKey(rows[0]!);
    const notice = renderWorkingTree(
      { kind: "ready", requestGeneration: 4, snapshot: snapshot() },
      { query: "", section: "all" },
      key,
      {
        kind: "notice",
        fileKey: key,
        requestGeneration: 5,
        contentStates: ["text", "unavailable"],
        unavailableReasons: ["sparseWorkingTreeMissing"],
      },
    );
    expect(notice).toContain("Sparse checkout path is not present on disk");
    expect(notice).toContain("Refresh status");
    expect(notice).toContain("Read-only");
  });
});
