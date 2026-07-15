import { performance } from "node:perf_hooks";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  fuzzyFilterGitTreeEntries,
  gitChangedFileFromTreeSelection,
  gitTreeEntryKey,
  nextGitTreeEntryKey,
} from "../core/gitSession";
import type { GitTreeEntry, GitTreeList } from "../core/gitModels";
import {
  GitTreePicker,
  virtualizedGitTreeWindow,
  type GitTreePickerState,
} from "./GitTreePicker";

function entry(path: string, index: number, displayPath = path): GitTreeEntry {
  return {
    path: {
      opaqueId: `repository-session-1:path:4:${index}`,
      displayPath,
      utf8Path: path,
    },
    mode: "100644",
    kind: "regularFile",
    objectId: { algorithm: "sha1", hex: (index % 10).toString().repeat(40) },
    objectType: "blob",
    size: index,
  };
}

function list(entries: GitTreeEntry[]): GitTreeList {
  return { entries, truncated: false, generation: 4 };
}

function readyState(entries: GitTreeEntry[]): GitTreePickerState {
  return {
    kind: "ready",
    requestGeneration: 2,
    left: list(entries),
    right: list(entries),
  };
}

function renderPicker(
  state: GitTreePickerState,
  query = "",
  leftSelection: string | null = null,
  rightSelection: string | null = null,
): string {
  return renderToStaticMarkup(
    <GitTreePicker
      state={state}
      query={query}
      leftSelection={leftSelection}
      rightSelection={rightSelection}
      languageMode="en"
      onLoad={() => {}}
      onCancel={() => {}}
      onClose={() => {}}
      onQueryChange={() => {}}
      onSelect={() => {}}
      onCompare={() => {}}
    />,
  );
}

describe("GitTreePicker", () => {
  it("stays opt-in and exposes a cancellable bounded load state", () => {
    const idle = renderPicker({ kind: "idle" });
    const loading = renderPicker({ kind: "loading", requestGeneration: 7 });

    expect(idle).toContain("Browse all tracked files");
    expect(idle).toContain("Changed files remain the default review list");
    expect(loading).toContain("Loading tracked files");
    expect(loading).toContain("Cancel tree load");
  });

  it("fuzzy-filters safe display paths while preserving colliding opaque identities", () => {
    const first = entry("src/config.ts", 1, "src/\\x80-config.ts");
    const second = entry("src/other-config.ts", 2, "src/\\x80-config.ts");
    const third = entry("docs/readme.md", 3);
    const matches = fuzzyFilterGitTreeEntries([first, second, third], "s80cfg");

    expect(matches.map(gitTreeEntryKey)).toEqual([
      first.path.opaqueId,
      second.path.opaqueId,
    ]);
    expect(new Set(matches.map(gitTreeEntryKey)).size).toBe(2);
  });

  it("maps same, different, and missing side selections without display-path lookup", () => {
    const left = entry("src/left.ts", 1);
    const same = { ...entry("src/left.ts", 1), objectId: { algorithm: "sha1" as const, hex: "b".repeat(40) } };
    const right = entry("src/right.ts", 2);

    expect(gitChangedFileFromTreeSelection(left, same)).toMatchObject({
      status: "modified",
      oldPath: left.path,
      newPath: same.path,
    });
    expect(gitChangedFileFromTreeSelection(left, right)).toMatchObject({
      status: "renamed",
      oldPath: left.path,
      newPath: right.path,
    });
    expect(gitChangedFileFromTreeSelection(left, null)).toMatchObject({
      status: "deleted",
      oldPath: left.path,
      newPath: null,
    });
    expect(gitChangedFileFromTreeSelection(null, right)).toMatchObject({
      status: "added",
      oldPath: null,
      newPath: right.path,
    });
    expect(gitChangedFileFromTreeSelection(null, null)).toBeNull();
  });

  it("uses opaque keyboard selection and keeps at most one small window per 100k side", () => {
    const generated = Array.from({ length: 100_000 }, (_, index) =>
      entry(`src/generated/file-${String(index).padStart(6, "0")}.ts`, index + 1));
    const selected = generated[90_000]!.path.opaqueId;
    const window = virtualizedGitTreeWindow(generated, 0, selected);

    expect(window.entries.length).toBeLessThanOrEqual(80);
    expect(window.entries.some((candidate) => candidate.path.opaqueId === selected)).toBe(true);
    expect(nextGitTreeEntryKey(generated.slice(0, 3), null, "End"))
      .toBe(generated[2]!.path.opaqueId);
    expect(nextGitTreeEntryKey(generated.slice(0, 3), generated[1]!.path.opaqueId, "ArrowUp"))
      .toBe(generated[0]!.path.opaqueId);
  });

  it("renders and filters 10k entries inside the 100ms UI stall budget", () => {
    const generated = Array.from({ length: 10_000 }, (_, index) =>
      entry(`src/generated/file-${String(index).padStart(5, "0")}.ts`, index + 1));
    const started = performance.now();
    const markup = renderPicker(
      readyState(generated),
      "file-09",
      generated[9_000]!.path.opaqueId,
      generated[9_001]!.path.opaqueId,
    );
    const elapsedMs = performance.now() - started;

    expect(markup.match(/role="option"/g)?.length).toBeLessThanOrEqual(160);
    expect(markup).toContain("Compare selected paths");
    expect(markup).toContain("aria-label=\"Left tracked files\"");
    expect(markup).toContain("aria-label=\"Right tracked files\"");
    expect(elapsedMs).toBeLessThan(100);
  });
});
