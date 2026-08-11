import type { MountedNavigationOutcome } from "./editorNavigationCoordinator";
import type { NavigationTarget } from "./editorNavigationHistory";
import type { EditorNavigationHandle } from "./monacoNavigation";

type HandleIdentity = Pick<
  EditorNavigationHandle,
  "pane" | "modelKey" | "modelRevision"
>;

export type MountedNavigationStatusKey = MountedNavigationOutcome["kind"];

export function directCompareNavigationTarget(
  sessionToken: string,
  modelRevision: number,
  handle: HandleIdentity,
): NavigationTarget {
  if (handle.pane === "mergeResult" || handle.modelRevision !== modelRevision) {
    throw new Error("Compare navigation handle revision or pane does not match its scope.");
  }
  return {
    scope: { kind: "directCompare", sessionToken, modelRevision },
    document: {
      kind: "mountedCompare",
      modelKey: handle.modelKey,
      modelRevision: handle.modelRevision,
    },
  };
}

export function directMergeNavigationTarget(
  sessionToken: string,
  resultRevision: number,
  handle: HandleIdentity,
): NavigationTarget {
  if (handle.pane !== "mergeResult" || handle.modelRevision !== resultRevision) {
    throw new Error("Merge navigation handle revision or pane does not match its scope.");
  }
  return {
    scope: { kind: "directMerge", sessionToken, resultRevision },
    document: {
      kind: "mountedMergeResult",
      modelKey: handle.modelKey,
      modelRevision: handle.modelRevision,
    },
  };
}

export function mountedNavigationStatusKey(
  outcome: MountedNavigationOutcome,
): MountedNavigationStatusKey {
  return outcome.kind;
}
