import type {
  AppMode,
  CompareSession,
  FileDocument,
  GitConflictMergeSession,
  GitFileCompareSession,
  GitPreviewMergeSession,
  MergeSession,
} from "./models";
import type { WritePrecondition } from "./mergeSave";
import type {
  GitCompareSession,
  GitConflictEntry,
  GitConflictList,
  GitConflictSession,
  GitFileHistoryEntry,
  GitFileHistoryList,
  GitMergePreview,
  GitChangedFile,
  GitChangedFileList,
  GitChangedFileStatus,
  GitPathIdentity,
  GitRefList,
  GitRepositorySummary,
  GitRevision,
  GitRevisionCompareRequest,
  GitSnapshotContentState,
  GitSnapshotDocument,
  GitSnapshotUnavailableReason,
  GitStatusEntry,
  GitStatusSnapshot,
  GitTreeEntry,
  GitUnmergedStatusEntry,
} from "./gitModels";

export type GitRevisionValidationPhase = "idle" | "validating" | "resolved" | "error";
export type GitRevisionSide = "left" | "right";

export function keepsGitRepositorySession(
  mode: AppMode,
  compareOrigin: CompareSession["origin"] | null,
  mergeOrigin: MergeSession["origin"] | null,
): boolean {
  return mode === "git"
    || (mode === "compare" && compareOrigin === "git")
    || (mode === "merge" && (mergeOrigin === "gitConflict" || mergeOrigin === "gitPreview"));
}

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

export type GitChangedFileOpenMode = "compare" | "mergePreview";

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

export type GitFileHistoryLoadState =
  | { kind: "idle" }
  | { kind: "loading"; pathKey: string; requestGeneration: number }
  | {
      kind: "ready";
      pathKey: string;
      requestGeneration: number;
      list: GitFileHistoryList;
    }
  | {
      kind: "error";
      pathKey: string;
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
      unavailableReasons?: GitSnapshotUnavailableReason[];
    }
  | {
      kind: "error";
      fileKey: string;
      requestGeneration: number;
      message: string;
    }
  | {
      kind: "mergeBaseNotice";
      fileKey: string;
      requestGeneration: number;
      cardinality: "none" | "multiple";
      candidateCount: number;
    };

export type GitWorkingTreeSection = "all" | "staged" | "unstaged" | "untracked" | "unmerged";

export interface GitWorkingTreeFilter {
  query: string;
  section: GitWorkingTreeSection;
}

export type GitWorkingTreeLoadState =
  | { kind: "idle" }
  | { kind: "loading"; requestGeneration: number }
  | { kind: "ready"; requestGeneration: number; snapshot: GitStatusSnapshot }
  | { kind: "error"; requestGeneration: number; message: string };

export type GitConflictLoadState =
  | { kind: "idle" }
  | { kind: "loading"; requestGeneration: number }
  | { kind: "ready"; requestGeneration: number; list: GitConflictList }
  | { kind: "error"; requestGeneration: number; message: string };

export type GitConflictOpenState =
  | { kind: "idle" }
  | { kind: "loading"; entryKey: string }
  | {
      kind: "notice";
      entryKey: string;
      contentStates: GitSnapshotContentState["kind"][];
    }
  | { kind: "error"; entryKey: string; message: string };

export function gitConflictEntryKey(entry: GitConflictEntry): string {
  return entry.path.opaqueId;
}

export function selectedGitConflictEntryKeyAfterRefresh(
  selectedKey: string | null,
  list: GitConflictList,
): string | null {
  if (selectedKey === null) return null;
  return list.entries.some((entry) => gitConflictEntryKey(entry) === selectedKey)
    ? selectedKey
    : null;
}

export function nextGitConflictEntryKey(
  entries: GitConflictEntry[],
  selectedKey: string | null,
  key: "ArrowUp" | "ArrowDown" | "Home" | "End",
): string | null {
  if (entries.length === 0) return null;
  const current = selectedKey === null
    ? -1
    : entries.findIndex((entry) => gitConflictEntryKey(entry) === selectedKey);
  const index = key === "Home"
    ? 0
    : key === "End"
      ? entries.length - 1
      : key === "ArrowUp"
        ? Math.max(0, current < 0 ? 0 : current - 1)
        : Math.min(entries.length - 1, current + 1);
  return gitConflictEntryKey(entries[index]!);
}

export type GitWorkingTreeRow =
  | {
      section: "staged" | "unstaged";
      path: GitPathIdentity;
      originalPath: GitPathIdentity | null;
      change: GitStatusEntry["change"];
      similarityScore: number | null;
      conflictCode: null;
    }
  | {
      section: "untracked";
      path: GitPathIdentity;
      originalPath: null;
      change: null;
      similarityScore: null;
      conflictCode: null;
    }
  | {
      section: "unmerged";
      path: GitPathIdentity;
      originalPath: null;
      change: null;
      similarityScore: null;
      conflictCode: GitUnmergedStatusEntry["conflictCode"];
    };

export function gitWorkingTreeRows(snapshot: GitStatusSnapshot): GitWorkingTreeRow[] {
  const tracked = (section: "staged" | "unstaged", entries: GitStatusEntry[]) =>
    entries.map((entry): GitWorkingTreeRow => ({
      section,
      path: entry.path,
      originalPath: entry.originalPath,
      change: entry.change,
      similarityScore: entry.similarityScore,
      conflictCode: null,
    }));
  return [
    ...tracked("staged", snapshot.staged),
    ...tracked("unstaged", snapshot.unstaged),
    ...snapshot.untracked.map((path): GitWorkingTreeRow => ({
      section: "untracked",
      path,
      originalPath: null,
      change: null,
      similarityScore: null,
      conflictCode: null,
    })),
    ...snapshot.unmerged.map((entry): GitWorkingTreeRow => ({
      section: "unmerged",
      path: entry.path,
      originalPath: null,
      change: null,
      similarityScore: null,
      conflictCode: entry.conflictCode,
    })),
  ];
}

export function gitWorkingTreeRowKey(row: GitWorkingTreeRow): string {
  return `${row.section}\u001f${row.path.opaqueId}`;
}

export function filterGitWorkingTreeRows(
  rows: GitWorkingTreeRow[],
  filter: GitWorkingTreeFilter,
): GitWorkingTreeRow[] {
  const query = filter.query.trim().toLocaleLowerCase();
  return rows.filter((row) => {
    if (filter.section !== "all" && row.section !== filter.section) return false;
    if (!query) return true;
    return [row.path.displayPath, row.originalPath?.displayPath]
      .some((path) => path?.toLocaleLowerCase().includes(query));
  });
}

export function selectedGitWorkingTreeRowKeyAfterRefresh(
  selectedKey: string | null,
  rows: GitWorkingTreeRow[],
): string | null {
  if (selectedKey === null) return null;
  return rows.some((row) => gitWorkingTreeRowKey(row) === selectedKey) ? selectedKey : null;
}

export function nextGitWorkingTreeRowKey(
  rows: GitWorkingTreeRow[],
  selectedKey: string | null,
  key: "ArrowUp" | "ArrowDown" | "Home" | "End",
): string | null {
  if (rows.length === 0) return null;
  const current = selectedKey == null
    ? -1
    : rows.findIndex((row) => gitWorkingTreeRowKey(row) === selectedKey);
  const index = key === "Home"
    ? 0
    : key === "End"
      ? rows.length - 1
      : key === "ArrowUp"
        ? Math.max(0, current < 0 ? 0 : current - 1)
        : Math.min(rows.length - 1, current + 1);
  return gitWorkingTreeRowKey(rows[index]!);
}

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

export function gitTreeEntryKey(entry: GitTreeEntry): string {
  return entry.path.opaqueId;
}

export function fuzzyFilterGitTreeEntries(
  entries: GitTreeEntry[],
  rawQuery: string,
): GitTreeEntry[] {
  const query = rawQuery.trim().toLocaleLowerCase();
  if (!query) return entries;
  return entries.filter((entry) => fuzzyPathMatches(entry.path.displayPath, query));
}

function fuzzyPathMatches(path: string, query: string): boolean {
  const candidate = path.toLocaleLowerCase();
  if (candidate.includes(query)) return true;
  let queryIndex = 0;
  for (const character of candidate) {
    if (character === query[queryIndex]) queryIndex += 1;
    if (queryIndex === query.length) return true;
  }
  return false;
}

export function nextGitTreeEntryKey(
  entries: GitTreeEntry[],
  selectedKey: string | null,
  key: "ArrowUp" | "ArrowDown" | "Home" | "End",
): string | null {
  if (entries.length === 0) return null;
  const current = selectedKey === null
    ? -1
    : entries.findIndex((entry) => gitTreeEntryKey(entry) === selectedKey);
  const index = key === "Home"
    ? 0
    : key === "End"
      ? entries.length - 1
      : key === "ArrowUp"
        ? Math.max(0, current < 0 ? 0 : current - 1)
        : Math.min(entries.length - 1, current + 1);
  return gitTreeEntryKey(entries[index]!);
}

export function gitChangedFileFromTreeSelection(
  left: GitTreeEntry | null,
  right: GitTreeEntry | null,
): GitChangedFile | null {
  if (!left && !right) return null;
  if (!left && right) {
    return { status: "added", oldPath: null, newPath: right.path, similarityScore: null };
  }
  if (left && !right) {
    return { status: "deleted", oldPath: left.path, newPath: null, similarityScore: null };
  }
  if (!left || !right) return null;
  return {
    status: left.path.opaqueId === right.path.opaqueId ? "modified" : "renamed",
    oldPath: left.path,
    newPath: right.path,
    similarityScore: null,
  };
}

export function toggleGitFileHistorySelection(
  selectedCommitIds: string[],
  entry: GitFileHistoryEntry,
): string[] {
  if (entry.boundary === "objectUnavailable") return selectedCommitIds;
  const commitId = entry.commitId.hex;
  if (selectedCommitIds.includes(commitId)) {
    return selectedCommitIds.filter((selected) => selected !== commitId);
  }
  if (selectedCommitIds.length < 2) return [...selectedCommitIds, commitId];
  return [selectedCommitIds[1]!, commitId];
}

export function gitFileHistoryCompareRequest(
  entries: GitFileHistoryEntry[],
  selectedCommitIds: string[],
  generation: number,
): GitRevisionCompareRequest | null {
  if (selectedCommitIds.length !== 2 || selectedCommitIds[0] === selectedCommitIds[1]) {
    return null;
  }
  const selected = selectedCommitIds
    .map((commitId) => entries.findIndex((entry) => entry.commitId.hex === commitId));
  if (selected.some((index) => index < 0)) return null;
  const selectedEntries = selected.map((index) => entries[index]!);
  if (selectedEntries.some((entry) => entry.boundary === "objectUnavailable")) return null;

  const newerIndex = Math.min(...selected);
  const olderIndex = Math.max(...selected);
  const newer = entries[newerIndex]!;
  const older = entries[olderIndex]!;
  const revision = (entry: GitFileHistoryEntry): GitRevision => ({
    rawLabel: entry.commitId.hex,
    resolved: entry.commitId,
    kind: "commit",
    displayName: entry.shortDisplayId,
  });
  return {
    leftRevision: revision(older),
    rightRevision: revision(newer),
    changedFile: {
      status: older.pathAtCommit.opaqueId === newer.pathAtCommit.opaqueId
        ? "modified"
        : "renamed",
      oldPath: older.pathAtCommit,
      newPath: newer.pathAtCommit,
      similarityScore: null,
    },
    generation,
  };
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
      unavailableReasons: GitSnapshotUnavailableReason[];
    };

export type GitSnapshotPatchAvailability =
  | { kind: "ready" }
  | {
      kind: "blocked";
      reason: "mutableContract" | "backendDisabled" | "unsupportedContent";
    };

export function gitSnapshotPatchAvailability(
  session: GitCompareSession,
): GitSnapshotPatchAvailability {
  if (
    !session.left.readOnly
    || !session.right.readOnly
    || session.capabilities.edit
    || session.capabilities.save
    || session.capabilities.hunkCopy
  ) {
    return { kind: "blocked", reason: "mutableContract" };
  }
  if (!session.capabilities.exportPatch) {
    return { kind: "blocked", reason: "backendDisabled" };
  }
  const supported = [session.left, session.right].every((document) =>
    document.contentState.kind === "missing"
      ? document.origin === "missing"
      : document.contentState.kind === "text" && document.textMetadata !== null);
  return supported
    ? { kind: "ready" }
    : { kind: "blocked", reason: "unsupportedContent" };
}

export function adaptGitCompareSession(session: GitCompareSession): GitCompareViewState {
  const left = gitSnapshotFileDocument(session.left);
  const right = gitSnapshotFileDocument(session.right);
  const validReadOnlyContract = gitSnapshotPatchAvailability(session).kind === "ready";

  if (!left || !right || !validReadOnlyContract) {
    return {
      kind: "notice",
      session,
      contentStates: [session.left.contentState.kind, session.right.contentState.kind],
      unavailableReasons: [session.left.contentState, session.right.contentState]
        .filter((state): state is Extract<GitSnapshotContentState, { kind: "unavailable" }> =>
          state.kind === "unavailable")
        .map((state) => state.reason),
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

export type GitConflictMergeViewState =
  | {
      kind: "merge";
      session: GitConflictMergeSession;
      outputVersion: WritePrecondition | null;
    }
  | {
      kind: "notice";
      session: GitConflictSession;
      contentStates: GitSnapshotContentState["kind"][];
      unavailableReasons: GitSnapshotUnavailableReason[];
    };

export function adaptGitConflictSession(session: GitConflictSession): GitConflictMergeViewState {
  const snapshots = [session.base, session.stage2, session.stage3, session.result];
  const documents = snapshots.map(gitSnapshotFileDocument);
  const [base, ours, theirs, resultDocument] = documents;
  const validMutabilityContract = session.base.readOnly
    && session.stage2.readOnly
    && session.stage3.readOnly
    && !session.result.readOnly;

  if (!base || !ours || !theirs || !resultDocument || !validMutabilityContract) {
    return {
      kind: "notice",
      session,
      contentStates: snapshots.map((snapshot) => snapshot.contentState.kind),
      unavailableReasons: snapshots
        .map((snapshot) => snapshot.contentState)
        .filter((state): state is Extract<GitSnapshotContentState, { kind: "unavailable" }> =>
          state.kind === "unavailable")
        .map((state) => state.reason),
    };
  }

  return {
    kind: "merge",
    session: {
      origin: "gitConflict",
      base,
      ours,
      theirs,
      output: resultDocument,
      outputPath: resultDocument.path,
      resultDocument,
      result: resultDocument.text,
      conflict: session,
    },
    outputVersion: session.result.workingTreeVersion === null
      ? null
      : {
          expectedSize: session.result.workingTreeVersion.size,
          expectedModifiedMs: session.result.workingTreeVersion.modifiedMs,
          expectedContentHash: session.resultFingerprint.contentHash,
        },
  };
}

export type GitMergePreviewViewState =
  | { kind: "merge"; session: GitPreviewMergeSession }
  | {
      kind: "notice";
      session: GitMergePreview;
      contentStates: GitSnapshotContentState["kind"][];
      unavailableReasons: GitSnapshotUnavailableReason[];
      resultState: GitMergePreview["result"]["kind"];
    };

export function adaptGitMergePreview(session: GitMergePreview): GitMergePreviewViewState {
  const snapshots = [session.base, session.left, session.right];
  const [base, ours, theirs] = snapshots.map(gitSnapshotFileDocument);
  const validReadOnlyContract = session.mergeBase.kind === "single"
    && session.disclaimer === "notExecutedMerge"
    && session.readOnly
    && snapshots.every((snapshot) => snapshot.readOnly)
    && !session.capabilities.edit
    && !session.capabilities.save
    && !session.capabilities.hunkCopy;

  if (!base || !ours || !theirs || session.result.kind !== "ready" || !validReadOnlyContract) {
    return {
      kind: "notice",
      session,
      contentStates: snapshots.map((snapshot) => snapshot.contentState.kind),
      unavailableReasons: snapshots
        .map((snapshot) => snapshot.contentState)
        .filter((state): state is Extract<GitSnapshotContentState, { kind: "unavailable" }> =>
          state.kind === "unavailable")
        .map((state) => state.reason),
      resultState: session.result.kind,
    };
  }

  return {
    kind: "merge",
    session: {
      origin: "gitPreview",
      base,
      ours,
      theirs,
      result: session.result.text,
      output: null,
      outputPath: null,
      preview: session,
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

  const committedSnapshot = (snapshot.origin === "committedBlob" || snapshot.origin === "indexStage")
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
