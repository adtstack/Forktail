import { describe, expect, it } from "vitest";
import {
  directCompareNavigationTarget,
  directMergeNavigationTarget,
  mountedNavigationStatusKey,
} from "./appEditorNavigation";
import type { EditorNavigationHandle } from "./monacoNavigation";

function handle(
  pane: EditorNavigationHandle["pane"],
  revision: number,
): Pick<EditorNavigationHandle, "pane" | "modelKey" | "modelRevision"> {
  return { pane, modelKey: `${pane}:${revision}`, modelRevision: revision };
}

describe("App editor navigation policy", () => {
  it("uses exact direct compare and merge tokens plus model revisions", () => {
    expect(directCompareNavigationTarget("compare:7", 7, handle("compareLeft", 7))).toEqual({
      scope: { kind: "directCompare", sessionToken: "compare:7", modelRevision: 7 },
      document: { kind: "mountedCompare", modelKey: "compareLeft:7", modelRevision: 7 },
    });
    expect(directMergeNavigationTarget("merge:9", 9, handle("mergeResult", 9))).toEqual({
      scope: { kind: "directMerge", sessionToken: "merge:9", resultRevision: 9 },
      document: { kind: "mountedMergeResult", modelKey: "mergeResult:9", modelRevision: 9 },
    });
    expect(() => directCompareNavigationTarget(
      "compare:7",
      7,
      handle("compareRight", 8),
    )).toThrow("revision");
  });

  it("maps content-free mounted outcomes to accessible status keys", () => {
    expect(mountedNavigationStatusKey({
      kind: "restored",
      status: "restored",
      staleDiscarded: 0,
      durationMs: 12,
    })).toBe("restored");
    expect(mountedNavigationStatusKey({ kind: "empty", status: "empty" })).toBe("empty");
    expect(mountedNavigationStatusKey({
      kind: "allStale",
      status: "allStale",
      staleDiscarded: 4,
    })).toBe("allStale");
    expect(mountedNavigationStatusKey({
      kind: "blockedModal",
      status: "blockedModal",
    })).toBe("blockedModal");
    expect(mountedNavigationStatusKey({ kind: "inFlight", status: "inFlight" })).toBe("inFlight");
    expect(mountedNavigationStatusKey({ kind: "failed", status: "failed" })).toBe("failed");
  });
});
