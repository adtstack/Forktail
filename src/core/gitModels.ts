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
  | { kind: "tooLarge" }
  | {
      kind: "lfsPointer";
      oidSha256: string;
      referencedSize: number;
    };

export interface GitBlobDocument {
  objectId: GitObjectId;
  size: number;
  content: GitBlobContent;
}

export type GitChangedFileStatus =
  | "added"
  | "deleted"
  | "modified"
  | "typeChanged"
  | "renamed"
  | "copied"
  | "unmerged"
  | "unknown";

export interface GitChangedFile {
  status: GitChangedFileStatus;
  oldPath: GitPathIdentity | null;
  newPath: GitPathIdentity | null;
  similarityScore: number | null;
}

export interface GitChangedFileCounts {
  added: number;
  deleted: number;
  modified: number;
  typeChanged: number;
  renamed: number;
  copied: number;
  unmerged: number;
  unknown: number;
  total: number;
}

export interface GitChangedFileList {
  entries: GitChangedFile[];
  counts: GitChangedFileCounts;
  truncated: boolean;
  generation: number;
}

export interface GitChangedFilesRequest {
  leftCommit: GitObjectId;
  rightCommit: GitObjectId;
  hardLimit: number;
  requestGeneration: number;
}

export type GitStatusBranchState =
  | { kind: "unborn"; displayName: string }
  | { kind: "detached"; objectId: GitObjectId }
  | { kind: "branch"; displayName: string; objectId: GitObjectId };

export interface GitStatusBranch {
  state: GitStatusBranchState;
  upstream: string | null;
  ahead: number | null;
  behind: number | null;
}

export type GitStatusChangeKind =
  | "modified"
  | "typeChanged"
  | "added"
  | "deleted"
  | "renamed"
  | "copied";

export interface GitSubmoduleStatus {
  isSubmodule: boolean;
  commitChanged: boolean;
  trackedChanges: boolean;
  untrackedChanges: boolean;
}

export interface GitStatusEntry {
  change: GitStatusChangeKind;
  path: GitPathIdentity;
  originalPath: GitPathIdentity | null;
  similarityScore: number | null;
  submodule: GitSubmoduleStatus;
  headMode: string | null;
  indexMode: string | null;
  worktreeMode: string | null;
  headObjectId: GitObjectId | null;
  indexObjectId: GitObjectId | null;
}

export interface GitUnmergedStatusEntry {
  conflictCode: string;
  path: GitPathIdentity;
  submodule: GitSubmoduleStatus;
  stage1Mode: string | null;
  stage2Mode: string | null;
  stage3Mode: string | null;
  worktreeMode: string | null;
  stage1ObjectId: GitObjectId | null;
  stage2ObjectId: GitObjectId | null;
  stage3ObjectId: GitObjectId | null;
}

export interface GitStatusSnapshot {
  branch: GitStatusBranch;
  staged: GitStatusEntry[];
  unstaged: GitStatusEntry[];
  untracked: GitPathIdentity[];
  unmerged: GitUnmergedStatusEntry[];
  truncated: boolean;
  totalEntries: number;
  generation: number;
}

export interface GitStatusRequest {
  hardLimit: number;
  requestGeneration: number;
}

export type GitSnapshotOrigin = "committedBlob" | "workingTree" | "missing";
export type GitSnapshotUnavailableReason = "objectMissingLocal";

export interface GitTextMetadata {
  encoding: string;
  lineEnding: LineEnding;
  hadFinalNewline: boolean;
  decodeHadErrors: boolean;
  size: number;
}

export interface GitWorkingTreeVersion {
  size: number;
  modifiedMs: number | null;
}

export type GitSnapshotContentState =
  | { kind: "text"; text: string }
  | { kind: "missing" }
  | { kind: "binary" }
  | {
      kind: "lfsPointer";
      oidSha256: string;
      referencedSize: number;
    }
  | { kind: "symlink" }
  | { kind: "submodule" }
  | { kind: "tooLarge" }
  | {
      kind: "unavailable";
      reason: GitSnapshotUnavailableReason;
    };

export interface GitSnapshotDocument {
  origin: GitSnapshotOrigin;
  label: string;
  readOnly: boolean;
  objectId: GitObjectId | null;
  path: GitPathIdentity | null;
  mode: string | null;
  textMetadata: GitTextMetadata | null;
  workingTreeVersion: GitWorkingTreeVersion | null;
  contentState: GitSnapshotContentState;
}

export interface GitRevisionPair {
  left: GitRevision;
  right: GitRevision;
}

export interface GitCompareCapabilities {
  edit: boolean;
  save: boolean;
  hunkCopy: boolean;
  exportPatch: boolean;
}

export interface GitCompareSession {
  repositoryId: string;
  left: GitSnapshotDocument;
  right: GitSnapshotDocument;
  sourceKind: "revisionPair" | "revisionWorkingTree";
  revisionPair: GitRevisionPair | null;
  revision: GitRevision | null;
  capabilities: GitCompareCapabilities;
  generation: number;
}

export interface GitWorkingTreeCompareRequest {
  revision: GitRevision;
  path: GitPathIdentity;
  generation: number;
}

export interface GitRevisionCompareRequest {
  leftRevision: GitRevision;
  rightRevision: GitRevision;
  changedFile: GitChangedFile;
  generation: number;
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
