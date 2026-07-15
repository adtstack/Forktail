export type GitObjectAlgorithm = "sha1" | "sha256" | "unknown";

export interface GitObjectId {
  algorithm: GitObjectAlgorithm;
  hex: string;
}

export interface GitPathIdentity {
  opaqueId: string;
  displayPath: string;
  utf8Path: string | null;
}

export type GitHeadState =
  | { kind: "unborn" }
  | { kind: "detached"; objectId: GitObjectId }
  | {
      kind: "branch";
      fullName: string;
      displayName: string;
      objectId: GitObjectId;
    };

export interface GitRepositorySummary {
  sessionId: string;
  displayRoot: string;
  isBare: boolean;
  isLinkedWorktree: boolean;
  isShallow: boolean;
  objectFormat: GitObjectAlgorithm;
  head: GitHeadState;
}
