import type { FileDocument, GitFileCompareSession } from "./models";
import type {
  GitCompareSession,
  GitChangedFile,
  GitChangedFileList,
  GitChangedFileStatus,
  GitRefList,
  GitRepositorySummary,
  GitRevision,
  GitSnapshotContentState,
  GitSnapshotDocument,
} from "./gitModels";

export type GitRevisionValidationPhase = "idle" | "validating" | "resolved" | "error";
export type GitRevisionSide = "left" | "right";

export interface GitRevisionFieldState {
  input: string;
  phase: GitRevisionValidationPhase;
  revision: GitRevision | null;
  error: string | null;
  requestGeneration: number;
}

export type GitRefLoadState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; list: GitRefList }
  | { kind: "error"; message: string };

export type GitRevisionValidationResult =
  | {
      kind: "resolved";
      requestGeneration: number;
      revision: GitRevision;
    }
  | {
      kind: "error";
      requestGeneration: number;
      error: string;
    };

export type GitChangedFileStatusFilter =
  | "all"
  | "added"
  | "deleted"
  | "modified"
  | "typeChanged"
  | "renamed";

export interface GitChangedFileFilter {
  query: string;
  status: GitChangedFileStatusFilter;
}

export type GitChangedFileLoadState =
  | { kind: "idle" }
  | { kind: "loading"; requestGeneration: number }
  | {
      kind: "ready";
      requestGeneration: number;
      list: GitChangedFileList;
    }
  | {
      kind: "error";
      requestGeneration: number;
      message: string;
    };

export type GitSnapshotNoticeKind = GitSnapshotContentState["kind"];

export type GitSnapshotSelectionState =
  | { kind: "idle" }
  | { kind: "loading"; fileKey: string; requestGeneration: number }
  | {
      kind: "notice";
      fileKey: string;
      requestGeneration: number;
      contentStates: GitSnapshotNoticeKind[];
    }
  | {
      kind: "error";
      fileKey: string;
      requestGeneration: number;
      message: string;
    };

const REVIEWABLE_GIT_STATUSES = new Set<GitChangedFileStatus>([
  "added",
  "deleted",
  "modified",
  "typeChanged",
  "renamed",
]);

export function isReviewableGitChangedFile(entry: GitChangedFile): boolean {
  return REVIEWABLE_GIT_STATUSES.has(entry.status);
}

export function gitChangedFileKey(entry: GitChangedFile): string {
  return [
    entry.status,
    entry.oldPath?.opaqueId ?? "-",
    entry.newPath?.opaqueId ?? "-",
  ].join("\u001f");
}

export function filterGitChangedFiles(
  entries: GitChangedFile[],
  filter: GitChangedFileFilter,
): GitChangedFile[] {
  const query = filter.query.trim().toLocaleLowerCase();
  return entries.filter((entry) => {
    if (!isReviewableGitChangedFile(entry)) return false;
    if (filter.status !== "all" && entry.status !== filter.status) return false;
    if (!query) return true;
    return [entry.oldPath?.displayPath, entry.newPath?.displayPath]
      .some((path) => path?.toLocaleLowerCase().includes(query));
  });
}

export function selectedGitChangedFileKeyAfterRefresh(
  selectedKey: string | null,
  list: GitChangedFileList,
): string | null {
  if (selectedKey === null) return null;
  return list.entries.some((entry) =>
    isReviewableGitChangedFile(entry) && gitChangedFileKey(entry) === selectedKey)
    ? selectedKey
    : null;
}

export function isCurrentGitRequest(
  activeRequestGeneration: number,
  responseRequestGeneration: number,
): boolean {
  return activeRequestGeneration === responseRequestGeneration;
}

export function emptyGitRevisionField(
  requestGeneration = 0,
): GitRevisionFieldState {
  return {
    input: "",
    phase: "idle",
    revision: null,
    error: null,
    requestGeneration,
  };
}

export function gitRevisionFieldWithInput(
  state: GitRevisionFieldState,
  input: string,
  requestGeneration: number,
): GitRevisionFieldState {
  if (state.input === input && state.phase === "resolved") {
    return { ...state, requestGeneration };
  }
  return {
    input,
    phase: "idle",
    revision: null,
    error: null,
    requestGeneration,
  };
}

export function beginGitRevisionValidation(
  state: GitRevisionFieldState,
  rawInput: string,
  requestGeneration: number,
): GitRevisionFieldState {
  return {
    ...state,
    input: rawInput,
    phase: "validating",
    revision: null,
    error: null,
    requestGeneration,
  };
}

export function applyGitRevisionValidationResult(
  state: GitRevisionFieldState,
  result: GitRevisionValidationResult,
): GitRevisionFieldState {
  if (state.requestGeneration !== result.requestGeneration) return state;
  if (result.kind === "error") {
    return {
      ...state,
      phase: "error",
      revision: null,
      error: result.error,
    };
  }
  return {
    ...state,
    phase: "resolved",
    revision: result.revision,
    error: null,
  };
}

export function sameResolvedGitRevisions(
  left: GitRevision | null,
  right: GitRevision | null,
): boolean {
  return left !== null
    && right !== null
    && left.resolved.algorithm === right.resolved.algorithm
    && left.resolved.hex === right.resolved.hex;
}

export function gitRevisionFromRepositoryHead(
  repository: GitRepositorySummary,
  requestGeneration: number,
): GitRevisionFieldState {
  if (repository.head.kind === "unborn") {
    return emptyGitRevisionField(requestGeneration);
  }
  const revision: GitRevision = {
    rawLabel: "HEAD",
    resolved: repository.head.objectId,
    kind: "head",
    displayName: "HEAD",
  };
  return {
    input: "HEAD",
    phase: "resolved",
    revision,
    error: null,
    requestGeneration,
  };
}

export type GitCompareViewState =
  | { kind: "compare"; session: GitFileCompareSession }
  | {
      kind: "notice";
      session: GitCompareSession;
      contentStates: GitSnapshotContentState["kind"][];
    };

export function adaptGitCompareSession(session: GitCompareSession): GitCompareViewState {
  const left = gitSnapshotFileDocument(session.left);
  const right = gitSnapshotFileDocument(session.right);
  const validReadOnlyContract = session.left.readOnly
    && session.right.readOnly
    && !session.capabilities.edit
    && !session.capabilities.save
    && !session.capabilities.hunkCopy
    && session.capabilities.exportPatch;

  if (!left || !right || !validReadOnlyContract) {
    return {
      kind: "notice",
      session,
      contentStates: [session.left.contentState.kind, session.right.contentState.kind],
    };
  }

  return {
    kind: "compare",
    session: {
      origin: "git",
      left,
      right,
      snapshot: session,
    },
  };
}

function gitSnapshotFileDocument(snapshot: GitSnapshotDocument): FileDocument | null {
  if (snapshot.contentState.kind === "missing") {
    if (
      snapshot.origin !== "missing"
      || snapshot.objectId !== null
      || snapshot.workingTreeVersion !== null
    ) return null;
    return {
      path: snapshot.label,
      name: snapshotName(snapshot),
      text: "",
      encoding: "Missing",
      lineEnding: "none",
      hadFinalNewline: true,
      size: 0,
      modifiedMs: null,
      isBinary: false,
      decodeHadErrors: false,
      virtual: { kind: "gitSnapshot", contentState: "missing" },
    };
  }

  const committedSnapshot = snapshot.origin === "committedBlob"
    && snapshot.objectId !== null
    && snapshot.workingTreeVersion === null;
  const workingTreeSnapshot = snapshot.origin === "workingTree"
    && snapshot.objectId === null
    && snapshot.workingTreeVersion !== null;
  if (
    snapshot.contentState.kind !== "text"
    || snapshot.textMetadata === null
    || (!committedSnapshot && !workingTreeSnapshot)
  ) {
    return null;
  }

  return {
    path: snapshot.label,
    name: snapshotName(snapshot),
    text: snapshot.contentState.text,
    encoding: snapshot.textMetadata.encoding,
    lineEnding: snapshot.textMetadata.lineEnding,
    hadFinalNewline: snapshot.textMetadata.hadFinalNewline,
    size: snapshot.textMetadata.size,
    modifiedMs: snapshot.workingTreeVersion?.modifiedMs ?? null,
    isBinary: false,
    decodeHadErrors: snapshot.textMetadata.decodeHadErrors,
    virtual: { kind: "gitSnapshot", contentState: "text" },
  };
}

function snapshotName(snapshot: GitSnapshotDocument): string {
  const displayPath = snapshot.path?.displayPath;
  if (!displayPath) return snapshot.contentState.kind === "missing" ? "Missing" : "Snapshot";
  const normalized = displayPath.replace(/\\/g, "/");
  return normalized.split("/").filter(Boolean).pop() ?? displayPath;
}
