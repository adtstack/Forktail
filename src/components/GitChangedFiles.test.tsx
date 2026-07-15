import { performance } from "node:perf_hooks";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  filterGitChangedFiles,
  gitChangedFileKey,
  isCurrentGitRequest,
  selectedGitChangedFileKeyAfterRefresh,
  type GitChangedFileFilter,
  type GitChangedFileLoadState,
  type GitChangedFileOpenMode,
  type GitSnapshotSelectionState,
} from "../core/gitSession";
import type {
  GitChangedFile,
  GitChangedFileCounts,
  GitChangedFileList,
  GitChangedFileStatus,
} from "../core/gitModels";
import {
  GitChangedFiles,
  virtualizedGitChangedFileWindow,
} from "./GitChangedFiles";

function path(name: string, index: number) {
  return {
    opaqueId: `repository-session-1:path:${index}`,
    displayPath: name,
    utf8Path: name,
  };
}

function changedFile(
  status: GitChangedFileStatus,
  name: string,
  index: number,
  oldName = name,
  similarityScore: number | null = null,
): GitChangedFile {
  return {
    status,
    oldPath: status === "added" ? null : path(oldName, index * 2),
    newPath: status === "deleted" ? null : path(name, index * 2 + 1),
    similarityScore,
  };
}

const entries: GitChangedFile[] = [
  changedFile("added", "src/added.ts", 1),
  changedFile("modified", "src/modified.ts", 2),
  changedFile("renamed", "src/new-name.ts", 3, "src/old-name.ts", 87),
  changedFile("typeChanged", "src/type-change", 4),
  changedFile("copied", "src/copy-target.ts", 5, "src/copy-source.ts", 95),
];

const counts: GitChangedFileCounts = {
  added: 1,
  deleted: 0,
  modified: 1,
  typeChanged: 1,
  renamed: 1,
  copied: 1,
  unmerged: 0,
  unknown: 0,
  total: 5,
};

function list(listEntries = entries): GitChangedFileList {
  return { entries: listEntries, counts, truncated: false, generation: 4 };
}

function renderChangedFiles(
  state: GitChangedFileLoadState = { kind: "ready", requestGeneration: 0, list: list() },
  filter: GitChangedFileFilter = { query: "", status: "all" },
  selectedKey: string | null = null,
  viewedKeys: ReadonlySet<string> = new Set(),
  snapshotState: GitSnapshotSelectionState = { kind: "idle" },
  openMode: GitChangedFileOpenMode = "compare",
): string {
  return renderToStaticMarkup(
    <GitChangedFiles
      state={state}
      filter={filter}
      selectedKey={selectedKey}
      reviewState={{ scopeKey: "test-scope", viewedKeys }}
      snapshotState={snapshotState}
      openMode={openMode}
      languageMode="en"
      onFilterChange={() => {}}
      onStatusFilterChange={() => {}}
      onOpenModeChange={() => {}}
      onSelect={() => {}}
    />,
  );
}

describe("GitChangedFiles", () => {
  it("shows text status counts and rename identity without exposing copy candidates", () => {
    const markup = renderChangedFiles();

    expect(markup).toContain("4 reviewable files");
    expect(markup).toContain("Added 1");
    expect(markup).toContain("Modified 1");
    expect(markup).toContain("Renamed 1");
    expect(markup).toContain("Type changed 1");
    expect(markup).toContain("src/old-name.ts → src/new-name.ts");
    expect(markup).toContain("87% similarity");
    expect(markup).not.toContain("copy-source");
    expect(markup).not.toContain("copy-target");
    expect(markup).not.toContain("Bare repository");
    expect(markup).not.toContain("Cross-repository");
  });

  it("filters by path or status while retaining lossless opaque selection identity", () => {
    const renameFilter = filterGitChangedFiles(entries, {
      query: "old-name",
      status: "all",
    });
    const addedFilter = filterGitChangedFiles(entries, {
      query: "",
      status: "added",
    });

    expect(renameFilter).toEqual([entries[2]]);
    expect(addedFilter).toEqual([entries[0]]);
    expect(gitChangedFileKey(entries[2])).toContain("repository-session-1:path:");
    expect(gitChangedFileKey(entries[2])).not.toContain("old-name.ts");
  });

  it("announces selection, viewed state, and keyboard navigation without color alone", () => {
    const key = gitChangedFileKey(entries[1]);
    const markup = renderChangedFiles(
      { kind: "ready", requestGeneration: 0, list: list() },
      { query: "", status: "all" },
      key,
      new Set([key]),
    );

    expect(markup).toContain("role=\"listbox\"");
    expect(markup).toContain(
      "aria-keyshortcuts=\"ArrowUp ArrowDown Home End Alt+ArrowUp Alt+ArrowDown Alt+N\"",
    );
    expect(markup).toContain("aria-selected=\"true\"");
    expect(markup).toContain("aria-posinset=\"2\"");
    expect(markup).toContain("aria-setsize=\"4\"");
    expect(markup).toContain("Viewed");
    expect(markup).toContain("Modified");
    expect(markup).toContain("1 of 4 viewed");
    expect(markup).toContain("Previous file");
    expect(markup).toContain("Next file");
    expect(markup).toContain("Next unviewed");
    expect(markup).toContain("aria-keyshortcuts=\"Alt+N\"");
  });

  it("computes review progress from the current filtered set only", () => {
    const modifiedKey = gitChangedFileKey(entries[1]);
    const addedMarkup = renderChangedFiles(
      undefined,
      { query: "", status: "added" },
      null,
      new Set([modifiedKey]),
    );
    const modifiedMarkup = renderChangedFiles(
      undefined,
      { query: "", status: "modified" },
      null,
      new Set([modifiedKey]),
    );

    expect(addedMarkup).toContain("0 of 1 viewed");
    expect(modifiedMarkup).toContain("1 of 1 viewed");
    expect(modifiedMarkup).toMatch(/disabled=""[^>]*aria-keyshortcuts="Alt\+N"/);
  });

  it("keeps at most one small virtual window for 10,000 generated rows within the UI budget", () => {
    const generated = Array.from({ length: 10_000 }, (_, index) =>
      changedFile("modified", `src/generated/file-${String(index).padStart(5, "0")}.ts`, index + 20));
    const started = performance.now();
    const window = virtualizedGitChangedFileWindow(generated, 0, null);
    const markup = renderChangedFiles({
      kind: "ready",
      requestGeneration: 6,
      list: {
        entries: generated,
        counts: { ...counts, added: 0, modified: 10_000, typeChanged: 0, renamed: 0, copied: 0, total: 10_000 },
        truncated: false,
        generation: 6,
      },
    });
    const elapsedMs = performance.now() - started;

    expect(window.entries.length).toBeLessThanOrEqual(80);
    expect(markup.match(/role=\"option\"/g)?.length).toBeLessThanOrEqual(80);
    expect(markup).toContain("10000 reviewable files");
    expect(elapsedMs).toBeLessThan(100);
  });

  it("clears a lost selection after refresh and preserves an entry that still exists", () => {
    const retained = gitChangedFileKey(entries[1]);
    const missing = gitChangedFileKey(entries[0]);
    const refreshed = list([entries[1], entries[2]]);

    expect(selectedGitChangedFileKeyAfterRefresh(retained, refreshed)).toBe(retained);
    expect(selectedGitChangedFileKeyAfterRefresh(missing, refreshed)).toBeNull();
    expect(isCurrentGitRequest(14, 13)).toBe(false);
    expect(isCurrentGitRequest(14, 14)).toBe(true);
  });

  it("announces bounded loading/errors and non-text snapshot states inline", () => {
    expect(renderChangedFiles({ kind: "loading", requestGeneration: 8 }))
      .toContain("Loading changed files");
    expect(renderChangedFiles({
      kind: "error",
      requestGeneration: 8,
      message: "Could not list committed changes.",
    })).toContain("Could not list committed changes.");

    const key = gitChangedFileKey(entries[3]);
    const notice = renderChangedFiles(
      { kind: "ready", requestGeneration: 0, list: list() },
      { query: "", status: "all" },
      key,
      new Set(),
      {
        kind: "notice",
        fileKey: key,
        requestGeneration: 12,
        contentStates: ["binary", "symlink"],
      },
    );
    expect(notice).toContain("Binary");
    expect(notice).toContain("Symlink");
    expect(notice).toContain("read-only");
    expect(notice).not.toContain("Fetch");
  });

  it("offers an explicit 2-way or 3-way path and never auto-selects an ambiguous base", () => {
    const key = gitChangedFileKey(entries[1]);
    const previewMode = renderChangedFiles(
      undefined,
      undefined,
      key,
      new Set(),
      { kind: "idle" },
      "mergePreview",
    );
    expect(previewMode).toContain("Open selected file as");
    expect(previewMode).toContain("2-way diff");
    expect(previewMode).toContain("3-way preview");
    expect(previewMode).toMatch(/checked="" value="mergePreview"/);

    const noBase = renderChangedFiles(undefined, undefined, key, new Set(), {
      kind: "mergeBaseNotice",
      fileKey: key,
      requestGeneration: 13,
      cardinality: "none",
      candidateCount: 0,
    });
    expect(noBase).toContain("no merge base");

    const multiple = renderChangedFiles(undefined, undefined, key, new Set(), {
      kind: "mergeBaseNotice",
      fileKey: key,
      requestGeneration: 14,
      cardinality: "multiple",
      candidateCount: 2,
    });
    expect(multiple).toContain("2 merge-base candidates");
    expect(multiple).toContain("will not choose one automatically");
  });
});
