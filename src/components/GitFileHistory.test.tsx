import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type {
  GitFileHistoryEntry,
  GitFileHistoryList,
  GitPathIdentity,
} from "../core/gitModels";
import { isCurrentGitRequest, type GitFileHistoryLoadState } from "../core/gitSession";
import { GitFileHistory } from "./GitFileHistory";

const path: GitPathIdentity = {
  opaqueId: "repository-session-1:path:4:1",
  displayPath: "src/current name.txt",
  utf8Path: "src/current name.txt",
};

function entry(
  digit: string,
  subject: string,
  boundary: GitFileHistoryEntry["boundary"] = "normal",
  pathAtCommit: GitPathIdentity = path,
): GitFileHistoryEntry {
  return {
    commitId: { algorithm: "sha1", hex: digit.repeat(40) },
    shortDisplayId: digit.repeat(12),
    subject,
    authorTimestamp: 1_700_000_000 + Number(digit),
    pathAtCommit,
    boundary,
  };
}

function list(entries: GitFileHistoryEntry[]): GitFileHistoryList {
  return {
    entries,
    truncated: true,
    shallow: true,
    generation: 4,
  };
}

function renderHistory(
  state: GitFileHistoryLoadState,
  selectedCommitIds: string[] = [],
): string {
  return renderToStaticMarkup(
    <GitFileHistory
      path={path}
      state={state}
      selectedCommitIds={selectedCommitIds}
      openState={{ kind: "idle" }}
      languageMode="en"
      onLoad={() => {}}
      onCancel={() => {}}
      onSelectionChange={() => {}}
      onCompare={() => {}}
    />,
  );
}

describe("GitFileHistory", () => {
  it("is opt-in and keeps a bounded load cancellable", () => {
    const idle = renderHistory({ kind: "idle" });
    const loading = renderHistory({
      kind: "loading",
      pathKey: path.opaqueId,
      requestGeneration: 7,
    });

    expect(idle).toContain("File history");
    expect(idle).toContain("Load local history");
    expect(idle).toContain("src/current name.txt");
    expect(loading).toContain("Loading local file history");
    expect(loading).toContain("Cancel history load");
  });

  it("shows only bounded metadata and explicit rename, shallow, deleted, and limit states", () => {
    const oldPath = {
      opaqueId: "repository-session-1:path:4:2",
      displayPath: "src/old name.txt",
      utf8Path: "src/old name.txt",
    };
    const entries = [
      entry("3", "newest subject"),
      entry("2", "renamed here", "renameBoundary"),
      entry("1", "deleted here", "objectUnavailable", oldPath),
      entry("4", "local boundary", "shallowBoundary", oldPath),
    ];
    const markup = renderHistory({
      kind: "ready",
      pathKey: path.opaqueId,
      requestGeneration: 7,
      list: list(entries),
    });

    expect(markup).toContain("newest subject");
    expect(markup).toContain("333333333333");
    expect(markup).toContain("Rename boundary");
    expect(markup).toContain("Snapshot unavailable at this commit");
    expect(markup).toContain("Shallow boundary");
    expect(markup).toContain("Only local history is shown");
    expect(markup).toContain("500 commit safety limit");
    expect(markup).not.toContain("commitBody");
    expect(markup).not.toContain("fileContent");
  });

  it("enables compare for exactly two usable immutable snapshots", () => {
    const entries = [entry("3", "newest"), entry("2", "older", "renameBoundary")];
    const state: GitFileHistoryLoadState = {
      kind: "ready",
      pathKey: path.opaqueId,
      requestGeneration: 7,
      list: list(entries),
    };
    const disabled = renderHistory(state, [entries[0]!.commitId.hex]);
    const enabled = renderHistory(state, entries.map((item) => item.commitId.hex));

    expect(disabled).toContain("disabled=\"\"");
    expect(enabled).toContain("Compare selected snapshots");
    expect(enabled).toContain("aria-pressed=\"true\"");
    expect(isCurrentGitRequest(8, 7)).toBe(false);
    expect(isCurrentGitRequest(8, 8)).toBe(true);
  });
});
