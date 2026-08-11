import { describe, expect, it } from "vitest";
import type { FolderEntry, FolderEntryStatus, FolderEntryUpsert } from "./models";
import {
  DEFAULT_FOLDER_STATUS_FILTERS,
  applyCollapsedFolderEntries,
  buildFolderSyncDryRunPlan,
  canCompareFolderEntry,
  countFolderStatuses,
  clampFolderSelectionIndex,
  detectFolderPathConflicts,
  filterFolderEntries,
  folderEntryDepth,
  folderEntryDetailRows,
  folderEntryHasChildren,
  folderEntryName,
  folderEntryParentPath,
  folderEntryPathActions,
  folderEntryPrimaryAction,
  folderPortablePathIdentity,
  folderReviewNavigationTarget,
  folderReviewReadFailureIsStale,
  folderScanOptionsWithMode,
  folderScanOptionsWithToggle,
  canCompareProgressiveFolderRow,
  progressiveFolderViewEntries,
  isFolderDirectoryEntry,
  isSafeFolderRelativePath,
  folderVirtualRange,
  isFolderSearchShortcut,
  nextFolderSort,
  nextFolderSelectionIndex,
  prepareFolderEntries,
  prepareFolderTree,
  resolveFolderReviewNavigationTarget,
  sortFolderEntries,
  summarizeFolderSyncDryRun,
  type FolderStatusFilters,
} from "./folderView";

describe("progressive folder hierarchy", () => {
  it("keeps pending files visible with parent context and blocks opening until final", () => {
    const pending: FolderEntryUpsert = {
      relativePath: "src/nested/App.tsx",
      revision: 1,
      leftPath: "/left/src/nested/App.tsx",
      rightPath: null,
      left: { kind: "file", size: 10, modifiedMs: 1, hash: null },
      right: null,
      resolution: { state: "pending", reason: "awaitingPeer" },
      message: null,
    };
    const view = progressiveFolderViewEntries([pending]);
    const prepared = prepareFolderTree(
      view.entries,
      {
        query: "app",
        statuses: {
          same: false,
          different: false,
          leftOnly: false,
          rightOnly: false,
          typeMismatch: false,
          error: false,
        },
      },
      { key: "path", direction: "asc" },
      view.pendingPaths,
    );

    expect(prepared.entries.map((item) => item.relativePath)).toEqual([
      "src",
      "src/nested",
      "src/nested/App.tsx",
    ]);
    expect(canCompareProgressiveFolderRow(pending)).toBe(false);
    expect(canCompareProgressiveFolderRow({
      ...pending,
      revision: 2,
      resolution: { state: "final", status: "leftOnly" },
    })).toBe(true);
  });
});

function entry(
  relativePath: string,
  status: FolderEntryStatus,
  size: number | null = null,
  modifiedMs: number | null = null,
): FolderEntry {
  const meta = size == null ? null : { kind: "file" as const, size, modifiedMs, hash: null };

  return {
    relativePath,
    status,
    leftPath: meta ? `/left/${relativePath}` : null,
    rightPath: meta ? `/right/${relativePath}` : null,
    left: meta,
    right: meta,
    message: null,
  };
}

function directoryEntry(relativePath: string, status: FolderEntryStatus = "same"): FolderEntry {
  const meta = { kind: "directory" as const, size: 0, modifiedMs: 1000, hash: null };

  return {
    relativePath,
    status,
    leftPath: `/left/${relativePath}`,
    rightPath: `/right/${relativePath}`,
    left: meta,
    right: meta,
    message: null,
  };
}

const entries = [
  entry("src/App.tsx", "different", 100, 3000),
  entry("README.md", "same", 80, 1000),
  entry("docs/guide.md", "leftOnly", 50, 2000),
  entry("config/prod.yml", "rightOnly", 90, 4000),
  entry("assets/logo.svg", "typeMismatch", null, null),
  entry("private/secret.txt", "error", null, null),
];

describe("countFolderStatuses", () => {
  it("counts every folder entry status", () => {
    expect(countFolderStatuses(entries)).toEqual({
      different: 1,
      leftOnly: 1,
      rightOnly: 1,
      typeMismatch: 1,
      error: 1,
      same: 1,
    });
  });
});

describe("filterFolderEntries", () => {
  it("uses status filters and hides same files by default", () => {
    const filtered = filterFolderEntries(entries, {
      query: "",
      statuses: DEFAULT_FOLDER_STATUS_FILTERS,
    });

    expect(filtered.map((item) => item.status)).toEqual([
      "different",
      "leftOnly",
      "rightOnly",
      "typeMismatch",
      "error",
    ]);
  });

  it("combines status filters with a case-insensitive path query", () => {
    const statuses: FolderStatusFilters = {
      ...DEFAULT_FOLDER_STATUS_FILTERS,
      same: true,
      different: false,
    };

    const filtered = filterFolderEntries(entries, { query: "DOCS", statuses });

    expect(filtered.map((item) => item.relativePath)).toEqual(["docs/guide.md"]);
  });
});

describe("sortFolderEntries", () => {
  it("sorts by path with a stable case-insensitive order", () => {
    const sorted = sortFolderEntries(
      [entry("b.txt", "different"), entry("A.txt", "different"), entry("a.txt", "different")],
      { key: "path", direction: "asc" },
    );

    expect(sorted.map((item) => item.relativePath)).toEqual(["A.txt", "a.txt", "b.txt"]);
  });

  it("sorts by status, size, and modified time", () => {
    expect(sortFolderEntries(entries, { key: "status", direction: "asc" }).map((item) => item.status)).toEqual([
      "different",
      "leftOnly",
      "rightOnly",
      "typeMismatch",
      "error",
      "same",
    ]);
    expect(sortFolderEntries(entries, { key: "size", direction: "desc" })[0].relativePath).toBe(
      "src/App.tsx",
    );
    expect(sortFolderEntries(entries, { key: "modified", direction: "desc" })[0].relativePath).toBe(
      "config/prod.yml",
    );
  });

  it("keeps original order when sort keys are equal", () => {
    const sameSize = [
      entry("first.txt", "different", 10),
      entry("second.txt", "different", 10),
      entry("third.txt", "different", 10),
    ];

    expect(sortFolderEntries(sameSize, { key: "size", direction: "asc" })).toEqual(sameSize);
  });
});

describe("prepareFolderEntries", () => {
  it("filters before sorting", () => {
    const prepared = prepareFolderEntries(
      entries,
      { query: ".md", statuses: { ...DEFAULT_FOLDER_STATUS_FILTERS, same: true } },
      { key: "path", direction: "asc" },
    );

    expect(prepared.map((item) => item.relativePath)).toEqual([
      "docs",
      "docs/guide.md",
      "README.md",
    ]);
  });

  it("keeps filtered ancestors as context and orders folders before files at every level", () => {
    const tree = [
      entry("README.md", "different", 10),
      directoryEntry("zeta"),
      entry("zeta/last.txt", "different", 10),
      directoryEntry("alpha"),
      entry("alpha/root.txt", "different", 10),
      directoryEntry("alpha/nested"),
      entry("alpha/nested/first.txt", "different", 10),
    ];

    const prepared = prepareFolderTree(
      tree,
      { query: "", statuses: DEFAULT_FOLDER_STATUS_FILTERS },
      { key: "path", direction: "asc" },
    );

    expect(prepared.entries.map((item) => item.relativePath)).toEqual([
      "alpha",
      "alpha/nested",
      "alpha/nested/first.txt",
      "alpha/root.txt",
      "zeta",
      "zeta/last.txt",
      "README.md",
    ]);
    expect(prepared.matchedCount).toBe(4);
    expect(prepared.contextFolderPaths).toEqual(new Set(["alpha", "alpha/nested", "zeta"]));
  });

  it("preserves the complete ancestor chain when a search matches only a nested file", () => {
    const prepared = prepareFolderTree(
      [
        entry("src/components/Button.tsx", "different", 10),
        entry("src/App.tsx", "different", 10),
      ],
      { query: "button", statuses: DEFAULT_FOLDER_STATUS_FILTERS },
      { key: "path", direction: "asc" },
    );

    expect(prepared.entries.map((item) => item.relativePath)).toEqual([
      "src",
      "src/components",
      "src/components/Button.tsx",
    ]);
    expect(prepared.matchedCount).toBe(1);
    expect(prepared.contextFolderPaths).toEqual(new Set(["src", "src/components"]));
    expect(prepared.entries.slice(0, 2).every(isFolderDirectoryEntry)).toBe(true);
    expect(prepared.entries[0]).toMatchObject({ leftPath: null, rightPath: null });
  });
});

describe("nextFolderSort", () => {
  it("starts ascending on a new key and toggles direction on the same key", () => {
    expect(nextFolderSort({ key: "path", direction: "asc" }, "size")).toEqual({
      key: "size",
      direction: "asc",
    });
    expect(nextFolderSort({ key: "path", direction: "asc" }, "path")).toEqual({
      key: "path",
      direction: "desc",
    });
  });
});

describe("folder keyboard selection", () => {
  it("clamps selection to the visible entry range", () => {
    expect(clampFolderSelectionIndex(2, 0)).toBe(-1);
    expect(clampFolderSelectionIndex(Number.NaN, 3)).toBe(0);
    expect(clampFolderSelectionIndex(-4, 3)).toBe(0);
    expect(clampFolderSelectionIndex(8, 3)).toBe(2);
  });

  it("moves selection without wrapping", () => {
    expect(nextFolderSelectionIndex(0, 3, "previous")).toBe(0);
    expect(nextFolderSelectionIndex(0, 3, "next")).toBe(1);
    expect(nextFolderSelectionIndex(1, 3, "first")).toBe(0);
    expect(nextFolderSelectionIndex(1, 3, "last")).toBe(2);
    expect(nextFolderSelectionIndex(2, 3, "next")).toBe(2);
  });
});

describe("folder entry actions", () => {
  it("allows 2-way compare for regular files even when one side is missing", () => {
    expect(canCompareFolderEntry(entry("src/App.tsx", "different", 100))).toBe(true);
    expect(canCompareFolderEntry({
      ...entry("left-only.txt", "leftOnly", 100),
      rightPath: null,
      right: null,
    })).toBe(true);
    expect(canCompareFolderEntry({
      ...entry("right-only.txt", "rightOnly", 100),
      leftPath: null,
      left: null,
    })).toBe(true);
    expect(
      canCompareFolderEntry({
        ...entry("kind-conflict", "typeMismatch", 100),
        left: { kind: "directory", size: 0, modifiedMs: null, hash: null },
      }),
    ).toBe(false);
  });

  it("chooses folder row primary actions for compare, one-sided reveal, and tree toggle", () => {
    const twoSidedFile = entry("src/App.tsx", "different", 100);
    const leftOnlyFile: FolderEntry = {
      ...entry("docs/guide.md", "leftOnly", 50),
      rightPath: null,
      right: null,
    };
    const rightOnlyFile: FolderEntry = {
      ...entry("config/prod.yml", "rightOnly", 90),
      leftPath: null,
      left: null,
    };
    const directory = directoryEntry("src", "same");
    const typeMismatch: FolderEntry = {
      ...entry("assets/logo", "typeMismatch", 10),
      left: { kind: "directory", size: 0, modifiedMs: null, hash: null },
      right: { kind: "file", size: 10, modifiedMs: null, hash: null },
    };
    const tree = [directory, twoSidedFile, leftOnlyFile, rightOnlyFile, typeMismatch];

    expect(folderEntryPrimaryAction(twoSidedFile, tree)).toEqual({ kind: "compare" });
    expect(folderEntryPrimaryAction(leftOnlyFile, tree)).toEqual({ kind: "compare" });
    expect(folderEntryPrimaryAction(rightOnlyFile, tree)).toEqual({ kind: "compare" });
    expect(folderEntryPrimaryAction(directory, tree)).toEqual({ kind: "toggle", path: "src" });
    expect(folderEntryPrimaryAction(typeMismatch, tree)).toEqual({ kind: "none" });
  });

  it("builds metadata rows for the folder detail panel without file contents", () => {
    const details = folderEntryDetailRows({
      ...entry("src/App.tsx", "different", 100, 3000),
      left: { kind: "file", size: 100, modifiedMs: 3000, hash: "left-hash" },
      right: { kind: "file", size: 120, modifiedMs: 4000, hash: "right-hash" },
      message: "Sizes differ.",
    });

    expect(details).toContainEqual({ label: "Relative path", value: "src/App.tsx" });
    expect(details).toContainEqual({ label: "Left path", value: "/left/src/App.tsx" });
    expect(details).toContainEqual({ label: "Right path", value: "/right/src/App.tsx" });
    expect(details).toContainEqual({
      label: "Left item",
      value: "file · 100 B · mtime 3000 · hash left-hash",
    });
    expect(details).toContainEqual({ label: "Message", value: "Sizes differ." });
  });

  it("detects directory rows and their tree depth", () => {
    expect(isFolderDirectoryEntry(directoryEntry("src"))).toBe(true);
    expect(isFolderDirectoryEntry(entry("src/App.tsx", "different", 100))).toBe(false);
    expect(folderEntryDepth(directoryEntry("src"))).toBe(0);
    expect(folderEntryDepth(entry("src/components/App.tsx", "different", 100))).toBe(2);
    expect(folderEntryName(entry("src/components/App.tsx", "different", 100))).toBe("App.tsx");
    expect(folderEntryParentPath(entry("src/components/App.tsx", "different", 100))).toBe(
      "src/components",
    );
  });

  it("collapses descendants below directory rows without hiding the directory itself", () => {
    const tree = [
      directoryEntry("src"),
      entry("src/App.tsx", "different", 100),
      directoryEntry("src/components"),
      entry("src/components/Button.tsx", "different", 80),
      entry("README.md", "same", 40),
    ];

    expect(folderEntryHasChildren(tree[0], tree)).toBe(true);
    expect(folderEntryHasChildren(tree[4], tree)).toBe(false);
    expect(applyCollapsedFolderEntries(tree, new Set(["src"])).map((item) => item.relativePath))
      .toEqual(["src", "README.md"]);
    expect(
      applyCollapsedFolderEntries(tree, new Set(["src/components"])).map((item) => item.relativePath),
    ).toEqual(["src", "src/App.tsx", "src/components", "README.md"]);
  });

  it("offers copy actions only for paths present on the entry", () => {
    expect(folderEntryPathActions(entry("src/App.tsx", "different", 100))).toEqual([
      {
        side: "left",
        copyLabel: "Copy left path",
        revealLabel: "Reveal left",
        path: "/left/src/App.tsx",
      },
      {
        side: "right",
        copyLabel: "Copy right path",
        revealLabel: "Reveal right",
        path: "/right/src/App.tsx",
      },
    ]);
    expect(
      folderEntryPathActions({
        ...entry("only-left.txt", "leftOnly", 100),
        rightPath: null,
        right: null,
      }),
    ).toEqual([
      {
        side: "left",
        copyLabel: "Copy left path",
        revealLabel: "Reveal left",
        path: "/left/only-left.txt",
      },
    ]);
  });
});

describe("folder path conflict policy", () => {
  it("normalizes relative paths for portable case-insensitive comparison", () => {
    expect(folderPortablePathIdentity("Config\\Prod.yml")).toBe("config/prod.yml");
    expect(folderPortablePathIdentity("docs//Cafe\u0301.md")).toBe("docs/café.md");
  });

  it("detects case-only and Unicode-normalization path conflicts", () => {
    const conflicts = detectFolderPathConflicts([
      entry("Config/Prod.yml", "leftOnly", 10),
      entry("config/prod.yml", "rightOnly", 10),
      entry("docs/Cafe\u0301.md", "leftOnly", 10),
      entry("docs/Café.md", "rightOnly", 10),
      entry("README.md", "same", 10),
    ]);

    expect(conflicts).toEqual([
      {
        identityKey: "config/prod.yml",
        variants: ["Config/Prod.yml", "config/prod.yml"],
      },
      {
        identityKey: "docs/café.md",
        variants: ["docs/Cafe\u0301.md", "docs/Café.md"],
      },
    ]);
  });
});

describe("folder sync dry-run planning", () => {
  it("accepts only relative paths that cannot escape the scan root", () => {
    expect(isSafeFolderRelativePath("config/prod.yml")).toBe(true);
    expect(isSafeFolderRelativePath("config\\prod.yml")).toBe(true);
    expect(isSafeFolderRelativePath("../outside.txt")).toBe(false);
    expect(isSafeFolderRelativePath("safe/../outside.txt")).toBe(false);
    expect(isSafeFolderRelativePath("/absolute.txt")).toBe(false);
    expect(isSafeFolderRelativePath("C:/absolute.txt")).toBe(false);
    expect(isSafeFolderRelativePath("safe//file.txt")).toBe(false);
  });

  it("plans left-to-right copies and overwrites without deleting target-only entries", () => {
    const plan = buildFolderSyncDryRunPlan(
      {
        leftRoot: "/left",
        rightRoot: "/right",
        durationMs: 1,
        stats: {
          same: 1,
          different: 1,
          leftOnly: 2,
          rightOnly: 1,
          typeMismatch: 1,
          errors: 1,
        },
        entries: [
          entry("same.txt", "same", 10),
          entry("changed.txt", "different", 10),
          entry("left-only.txt", "leftOnly", 10),
          directoryEntry("left-dir", "leftOnly"),
          entry("right-only.txt", "rightOnly", 10),
          {
            ...entry("kind-conflict", "typeMismatch", 10),
            left: { kind: "directory", size: 0, modifiedMs: null, hash: null },
            right: { kind: "file", size: 10, modifiedMs: null, hash: null },
            message: "Kinds differ.",
          },
          {
            ...entry("unreadable.txt", "error", null),
            message: "Permission denied.",
          },
        ],
      },
      "leftToRight",
    );

    expect(plan.map((item) => [item.relativePath, item.action, item.targetPath])).toEqual([
      ["changed.txt", "overwriteFile", "/right/changed.txt"],
      ["left-only.txt", "copyFile", "/right/left-only.txt"],
      ["left-dir", "createDirectory", "/right/left-dir"],
      ["kind-conflict", "blocked", "/right/kind-conflict"],
      ["unreadable.txt", "blocked", "/right/unreadable.txt"],
    ]);
    expect(plan.some((item) => item.relativePath === "right-only.txt")).toBe(false);
    expect(summarizeFolderSyncDryRun(plan)).toEqual({
      total: 5,
      copies: 2,
      overwrites: 1,
      blocked: 2,
      destructive: 1,
    });
  });

  it("plans right-to-left copies with display paths under the left root", () => {
    const plan = buildFolderSyncDryRunPlan(
      {
        leftRoot: "C:\\left",
        rightRoot: "C:\\right",
        durationMs: 1,
        stats: {
          same: 0,
          different: 0,
          leftOnly: 0,
          rightOnly: 1,
          typeMismatch: 0,
          errors: 0,
        },
        entries: [
          {
            ...entry("config/prod.yml", "rightOnly", 10),
            leftPath: null,
            left: null,
            rightPath: "C:\\right\\config\\prod.yml",
          },
        ],
      },
      "rightToLeft",
    );

    expect(plan).toMatchObject([
      {
        relativePath: "config/prod.yml",
        action: "copyFile",
        sourcePath: "C:\\right\\config\\prod.yml",
        targetPath: "C:\\left\\config\\prod.yml",
        destructive: false,
      },
    ]);
  });

  it("blocks unsafe relative paths before generating target paths", () => {
    const plan = buildFolderSyncDryRunPlan(
      {
        leftRoot: "/left",
        rightRoot: "/right",
        durationMs: 1,
        stats: {
          same: 0,
          different: 0,
          leftOnly: 1,
          rightOnly: 0,
          typeMismatch: 0,
          errors: 0,
        },
        entries: [entry("../outside.txt", "leftOnly", 10)],
      },
      "leftToRight",
    );

    expect(plan).toEqual([
      {
        relativePath: "../outside.txt",
        direction: "leftToRight",
        action: "blocked",
        sourcePath: "/left/../outside.txt",
        targetPath: null,
        destructive: false,
        message: "Relative path can escape the root, so it is excluded from the copy/sync plan.",
      },
    ]);
    expect(summarizeFolderSyncDryRun(plan)).toMatchObject({ blocked: 1, destructive: 0 });
  });
});

describe("folder scan option updates", () => {
  it("changes compare mode without dropping traversal options", () => {
    expect(
      folderScanOptionsWithMode(
        {
          compareMode: "metadata",
          includeHidden: true,
          respectGitignore: false,
          followSymlinks: true,
        },
        "fullHash",
      ),
    ).toEqual({
      compareMode: "fullHash",
      includeHidden: true,
      respectGitignore: false,
      followSymlinks: true,
    });
  });

  it("toggles hidden/gitignore/symlink options without changing compare mode", () => {
    const options = {
      compareMode: "quickHash" as const,
      includeHidden: false,
      respectGitignore: true,
      followSymlinks: false,
    };

    expect(folderScanOptionsWithToggle(options, "includeHidden", true)).toEqual({
      ...options,
      includeHidden: true,
    });
    expect(folderScanOptionsWithToggle(options, "respectGitignore", false)).toEqual({
      ...options,
      respectGitignore: false,
    });
    expect(folderScanOptionsWithToggle(options, "followSymlinks", true)).toEqual({
      ...options,
      followSymlinks: true,
    });
  });
});

describe("isFolderSearchShortcut", () => {
  it("accepts command or control F without extra modifiers", () => {
    expect(
      isFolderSearchShortcut({
        key: "f",
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        altKey: false,
      }),
    ).toBe(true);
    expect(
      isFolderSearchShortcut({
        key: "F",
        ctrlKey: false,
        metaKey: true,
        shiftKey: false,
        altKey: false,
      }),
    ).toBe(true);
  });

  it("rejects shifted or alternate search variants", () => {
    expect(
      isFolderSearchShortcut({
        key: "f",
        ctrlKey: true,
        metaKey: false,
        shiftKey: true,
        altKey: false,
      }),
    ).toBe(false);
    expect(
      isFolderSearchShortcut({
        key: "f",
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        altKey: true,
      }),
    ).toBe(false);
  });
});

describe("folderVirtualRange", () => {
  it("renders only the visible window with overscan for large lists", () => {
    const range = folderVirtualRange(10_000, 3_400, 340, 34, 2);

    expect(range).toEqual({
      start: 98,
      end: 112,
      beforeHeight: 3332,
      afterHeight: 336192,
      totalHeight: 340000,
    });
  });

  it("limits the rendered row window for 100k results", () => {
    const range = folderVirtualRange(100_000, 850_000, 680, 34, 8);

    expect(range.end - range.start).toBeLessThanOrEqual(36);
    expect(range.totalHeight).toBe(3_400_000);
    expect(range.beforeHeight).toBeGreaterThan(0);
    expect(range.afterHeight).toBeGreaterThan(0);
  });

  it("keeps small lists fully rendered", () => {
    expect(folderVirtualRange(5, 0, 340, 34, 8)).toEqual({
      start: 0,
      end: 5,
      beforeHeight: 0,
      afterHeight: 0,
      totalHeight: 170,
    });
  });

  it("sanitizes empty and malformed measurements", () => {
    expect(folderVirtualRange(0, 100, 200)).toEqual({
      start: 0,
      end: 0,
      beforeHeight: 0,
      afterHeight: 0,
      totalHeight: 0,
    });
    expect(folderVirtualRange(Number.NaN, Number.NaN, Number.NaN)).toEqual({
      start: 0,
      end: 0,
      beforeHeight: 0,
      afterHeight: 0,
      totalHeight: 0,
    });
  });
});

describe("folder review navigation identity", () => {
  const scope = { reviewToken: "folder-review-17", scanGeneration: 9 };

  function resultWith(reviewEntries: FolderEntry[]) {
    return {
      leftRoot: "/private/left",
      rightRoot: "/private/right",
      entries: reviewEntries,
      durationMs: 1,
      stats: {
        same: 0,
        different: reviewEntries.length,
        leftOnly: 0,
        rightOnly: 0,
        typeMismatch: 0,
        errors: 0,
      },
    };
  }

  it("creates a content-free target and resolves only the exact current scan row", () => {
    const row = entry("Source/Cafe\u0301.txt", "different", 10);
    const result = resultWith([row]);
    const target = folderReviewNavigationTarget(scope, result, row);

    expect(target).toEqual({
      scope: { kind: "folderReview", reviewToken: "folder-review-17", scanGeneration: 9 },
      document: {
        kind: "folderText",
        relativeItemKey: "source/caf\u00e9.txt",
        comparisonKind: "both",
      },
    });
    expect(JSON.stringify(target)).not.toContain("/private/");
    expect(JSON.stringify(target)).not.toContain("leftPath");

    expect(resolveFolderReviewNavigationTarget(target, scope, result)).toEqual({
      kind: "valid",
      entry: row,
      request: {
        leftRoot: "/private/left",
        rightRoot: "/private/right",
        relativePath: "Source/Cafe\u0301.txt",
        leftExpected: "regularFile",
        rightExpected: "regularFile",
      },
    });
  });

  it("fails closed after rescan, deletion, kind change, or unsafe containment input", () => {
    const row = entry("src/App.tsx", "different", 10);
    const target = folderReviewNavigationTarget(scope, resultWith([row]), row);

    expect(resolveFolderReviewNavigationTarget(
      target,
      { ...scope, scanGeneration: 10 },
      resultWith([row]),
    )).toMatchObject({ kind: "stale", reason: "scope" });
    expect(resolveFolderReviewNavigationTarget(target, scope, resultWith([])))
      .toMatchObject({ kind: "stale", reason: "missing" });
    expect(resolveFolderReviewNavigationTarget(target, scope, resultWith([{
      ...row,
      left: { kind: "symlink", size: 0, modifiedMs: null, hash: null },
    }]))) .toMatchObject({ kind: "stale", reason: "notText" });

    const unsafe = { ...row, relativePath: "../src/App.tsx" };
    expect(() => folderReviewNavigationTarget(scope, resultWith([unsafe]), unsafe))
      .toThrow("safe relative path");
  });

  it("never substitutes an arbitrary row when case or NFC identities collide", () => {
    const first = entry("Docs/Caf\u00e9.txt", "different", 10);
    const second = entry("docs/Cafe\u0301.txt", "different", 11);
    const result = resultWith([first, second]);

    expect(() => folderReviewNavigationTarget(scope, result, first)).toThrow("unique");
    const target = {
      scope: { kind: "folderReview" as const, ...scope },
      document: {
        kind: "folderText" as const,
        relativeItemKey: folderPortablePathIdentity(first.relativePath),
        comparisonKind: "both" as const,
      },
    };
    expect(resolveFolderReviewNavigationTarget(target, scope, result))
      .toMatchObject({ kind: "stale", reason: "collision" });
  });

  it("preserves one-sided expectations and treats non-text/external changes as stale", () => {
    const leftOnly: FolderEntry = {
      ...entry("left.txt", "leftOnly", 10),
      rightPath: null,
      right: null,
    };
    const target = folderReviewNavigationTarget(scope, resultWith([leftOnly]), leftOnly);
    expect(target.document).toMatchObject({ comparisonKind: "leftOnly" });
    expect(resolveFolderReviewNavigationTarget(target, scope, resultWith([leftOnly])))
      .toMatchObject({
        kind: "valid",
        request: { leftExpected: "regularFile", rightExpected: "missing" },
      });

    for (const code of [
      "NOT_FOUND",
      "TOO_LARGE",
      "BINARY_FILE",
      "UNSUPPORTED_ENCODING",
      "PATH_CONFLICT",
      "FILE_CHANGED",
    ] as const) {
      expect(folderReviewReadFailureIsStale({ code, message: "content-free" })).toBe(true);
    }
    expect(folderReviewReadFailureIsStale({ code: "PERMISSION_DENIED", message: "retry" }))
      .toBe(false);
  });
});
