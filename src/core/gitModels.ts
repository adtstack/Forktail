export type GitObjectAlgorithm = "sha1" | "sha256" | "unknown";

export interface GitObjectId {
  algorithm: GitObjectAlgorithm;
  hex: string;
}

export type GitRevisionKind =
  | "head"
  | "branch"
  | "remoteBranch"
  | "tag"
  | "commit"
  | "symbolic";

export interface GitRevision {
  rawLabel: string;
  resolved: GitObjectId;
  kind: GitRevisionKind;
  displayName: string;
}

export type GitObjectType = "commit" | "tag" | "tree" | "blob";
export type GitRefKind = "localBranch" | "remoteTrackingBranch" | "tag";

export interface GitRepositoryRef {
  fullName: string;
  displayName: string;
  kind: GitRefKind;
  objectId: GitObjectId;
  objectType: GitObjectType;
  peeledObjectId: GitObjectId | null;
  peeledObjectType: GitObjectType | null;
}

export interface GitRefList {
  refs: GitRepositoryRef[];
  truncated: boolean;
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
