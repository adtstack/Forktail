import type { LineEnding } from "./models";

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

export type GitTreeEntryKind =
  | "regularFile"
  | "executableFile"
  | "symlink"
  | "submodule";

export interface GitTreeEntry {
  path: GitPathIdentity;
  mode: string;
  kind: GitTreeEntryKind;
  objectId: GitObjectId;
  objectType: GitObjectType;
  size: number | null;
}

export interface GitTreeList {
  entries: GitTreeEntry[];
  truncated: boolean;
  generation: number;
}

export type GitBlobContent =
  | {
      kind: "text";
      text: string;
      encoding: string;
      lineEnding: LineEnding;
      hadFinalNewline: boolean;
      decodeHadErrors: boolean;
    }
  | { kind: "binary" }
  | { kind: "tooLarge" };

export interface GitBlobDocument {
  objectId: GitObjectId;
  size: number;
  content: GitBlobContent;
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
