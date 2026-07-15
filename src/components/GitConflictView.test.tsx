import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { GitConflictEntry, GitConflictList } from "../core/gitModels";
import {
  gitConflictEntryKey,
  nextGitConflictEntryKey,
  selectedGitConflictEntryKeyAfterRefresh,
  type GitConflictLoadState,
  type GitConflictOpenState,
} from "../core/gitSession";
import { GitConflictView } from "./GitConflictView";

function entry(
  name: string,
  id: number,
  stages: { stage1?: string; stage2?: string; stage3?: string } = {
    stage1: "100644",
    stage2: "100644",
    stage3: "100644",
  },
): GitConflictEntry {
  const stage = (mode: string | undefined, digit: string) => mode
    ? { mode, objectId: { algorithm: "sha1" as const, hex: digit.repeat(40) } }
    : null;
  return {
    path: {
      opaqueId: `repository-session-1:path:9:${id}`,
      displayPath: name,
      utf8Path: name,
    },
    stage1: stage(stages.stage1, "1"),
    stage2: stage(stages.stage2, "2"),
    stage3: stage(stages.stage3, "3"),
  };
}

function list(entries: GitConflictEntry[] = [
  entry("src/both.ts", 1),
  entry("src/add-add.ts", 2, { stage2: "100644", stage3: "100644" }),
  entry("src/deleted-by-ours.ts", 3, { stage1: "100644", stage3: "100644" }),
  entry("link", 4, { stage1: "100644", stage2: "120000", stage3: "100644" }),
]): GitConflictList {
  return {
    entries,
    operation: "rebase",
    truncated: false,
    totalEntries: entries.length,
    generation: 9,
  };
}

function renderConflictView(
  state: GitConflictLoadState = { kind: "ready", requestGeneration: 3, list: list() },
  selectedKey: string | null = null,
  openState: GitConflictOpenState = { kind: "idle" },
): string {
  return renderToStaticMarkup(
    <GitConflictView
      state={state}
      selectedKey={selectedKey}
      openState={openState}
      languageMode="en"
      onRefresh={() => {}}
      onSelect={() => {}}
    />,
  );
}

describe("GitConflictView", () => {
  it("shows operation, conflict kind, and explicit stage availability without mutation actions", () => {
    const markup = renderConflictView();

    expect(markup).toContain("Conflicts 4");
    expect(markup).toContain("Rebase");
    expect(markup).toContain("Both modified");
    expect(markup).toContain("Both added");
    expect(markup).toContain("Deleted by ours");
    expect(markup).toContain("Type change");
    expect(markup).toContain("Base present");
    expect(markup).toContain("Ours present");
    expect(markup).toContain("Theirs present");
    expect(markup).toContain("Base missing");
    expect(markup).toContain("Open Result editor");
    expect(markup).not.toMatch(/>Stage<|>Add<|>Continue<|>Commit</);
  });

  it("uses opaque identity for selection and bounded keyboard navigation", () => {
    const entries = list().entries;
    const first = gitConflictEntryKey(entries[0]!);
    const last = gitConflictEntryKey(entries.at(-1)!);

    expect(first).toBe(entries[0]!.path.opaqueId);
    expect(first).not.toContain(entries[0]!.path.displayPath);
    expect(nextGitConflictEntryKey(entries, null, "ArrowDown")).toBe(first);
    expect(nextGitConflictEntryKey(entries, first, "ArrowUp")).toBe(first);
    expect(nextGitConflictEntryKey(entries, first, "End")).toBe(last);
    expect(nextGitConflictEntryKey(entries, last, "ArrowDown")).toBe(last);
    expect(renderConflictView()).toContain(
      "aria-keyshortcuts=\"ArrowUp ArrowDown Home End Enter\"",
    );
  });

  it("keeps a keyboard-selected conflict inside the bounded virtual window", () => {
    const entries = Array.from({ length: 100 }, (_, index) =>
      entry(`src/conflict-${index}.ts`, index + 1));
    const selected = gitConflictEntryKey(entries.at(-1)!);
    const markup = renderConflictView(
      { kind: "ready", requestGeneration: 7, list: list(entries) },
      selected,
    );

    expect(markup).toContain("src/conflict-99.ts");
    expect(markup).not.toContain("src/conflict-0.ts");
  });

  it("drops a conflict resolved externally and announces refresh/open errors", () => {
    const before = list().entries;
    const selected = gitConflictEntryKey(before[1]!);
    const refreshed = list([before[0]!]);

    expect(selectedGitConflictEntryKeyAfterRefresh(selected, refreshed)).toBeNull();
    expect(selectedGitConflictEntryKeyAfterRefresh(
      gitConflictEntryKey(before[0]!),
      refreshed,
    )).toBe(gitConflictEntryKey(before[0]!));
    expect(renderConflictView({
      kind: "error",
      requestGeneration: 4,
      message: "Conflict state changed outside Forktail. Refresh status.",
    })).toContain("Conflict state changed outside Forktail. Refresh status.");
    expect(renderConflictView(
      { kind: "ready", requestGeneration: 4, list: refreshed },
      null,
      { kind: "error", entryKey: selected, message: "Conflict no longer exists." },
    )).toContain("Conflict no longer exists.");
  });

  it("announces loading/non-text states and the Result-only terminal next step", () => {
    expect(renderConflictView({ kind: "loading", requestGeneration: 5 }))
      .toContain("Loading conflicts");
    const selected = gitConflictEntryKey(list().entries[0]!);
    const notice = renderConflictView(
      { kind: "ready", requestGeneration: 5, list: list() },
      selected,
      {
        kind: "notice",
        entryKey: selected,
        contentStates: ["text", "binary", "text", "text"],
      },
    );
    expect(notice).toContain("Binary conflicts cannot be edited as text");
    expect(notice).toContain("Forktail never runs git add or continue");
  });
});
