import type {
  GitCompareSession as GitSnapshotCompareSession,
  GitConflictSession,
  GitMergePreview,
} from "./gitModels";

export type AppMode = "home" | "compare" | "folders" | "merge" | "git";

export const appErrorCodes = [
  "CANCELLED",
  "NOT_FOUND",
  "PERMISSION_DENIED",
  "TOO_LARGE",
  "BINARY_FILE",
  "UNSUPPORTED_ENCODING",
  "PATH_CONFLICT",
  "FILE_CHANGED",
  "WRITE_FAILED",
  "SCAN_FAILED",
  "MERGE_FAILED",
  "DETACHED_WINDOW_LIMIT",
  "DETACHED_SOURCE_BYTE_LIMIT",
  "DETACHED_SOURCE_STALE",
  "DETACHED_UNKNOWN_WINDOW",
  "DETACHED_WINDOW_CREATE_FAILED",
  "DETACHED_INVALID_STATE",
  "GIT_NOT_FOUND",
  "GIT_VERSION_UNSUPPORTED",
  "GIT_COMMAND_TIMEOUT",
  "GIT_COMMAND_CANCELLED",
  "GIT_OUTPUT_TOO_LARGE",
  "GIT_COMMAND_FAILED",
  "GIT_NOT_REPOSITORY",
  "GIT_UNSAFE_REPOSITORY",
  "GIT_BARE_UNSUPPORTED",
  "GIT_INVALID_REVISION",
  "GIT_AMBIGUOUS_REVISION",
  "GIT_PATH_NOT_AT_REVISION",
  "GIT_OBJECT_MISSING_LOCAL",
  "GIT_OBJECT_TYPE_UNSUPPORTED",
  "GIT_BLOB_TOO_LARGE",
  "GIT_BINARY_BLOB",
  "GIT_LFS_POINTER",
  "GIT_PATH_UNSUPPORTED",
  "GIT_PATH_OUTSIDE_ROOT",
  "GIT_SYMLINK_UNSUPPORTED",
  "GIT_CONFLICT_STATE_CHANGED",
  "GIT_MULTIPLE_MERGE_BASES",
  "GIT_UNRELATED_HISTORIES",
] as const;

export type AppErrorCode = (typeof appErrorCodes)[number];

export interface AppError {
  code: AppErrorCode;
  message: string;
}

export type LineEnding = "lf" | "crlf" | "cr" | "mixed" | "none";

export interface FileDocument {
  path: string;
  name: string;
  text: string;
  encoding: string;
  lineEnding: LineEnding;
  hadFinalNewline: boolean;
  size: number;
  modifiedMs: number | null;
  contentHash?: string | null;
  isBinary: boolean;
  decodeHadErrors: boolean;
  virtual?:
    | { kind: "missing" }
    | {
        kind: "gitSnapshot";
        contentState: "text" | "missing";
      };
}

export interface FileVersion {
  path: string;
  size: number;
  modifiedMs: number | null;
  contentHash: string;
}

export interface FileBackup {
  path: string;
  name: string;
  size: number;
  modifiedMs: number | null;
}

export type FolderCompareMode = "metadata" | "quickHash" | "fullHash";
export type FolderEntryStatus =
  | "same"
  | "different"
  | "leftOnly"
  | "rightOnly"
  | "typeMismatch"
  | "error";

export interface FolderScanOptions {
  compareMode: FolderCompareMode;
  includeHidden: boolean;
  respectGitignore: boolean;
  followSymlinks: boolean;
}

export interface FsEntryMeta {
  kind: "file" | "directory" | "symlink" | "other";
  size: number;
  modifiedMs: number | null;
  hash: string | null;
}

export interface FolderEntry {
  relativePath: string;
  leftPath: string | null;
  rightPath: string | null;
  left: FsEntryMeta | null;
  right: FsEntryMeta | null;
  status: FolderEntryStatus;
  message: string | null;
}

export interface FolderScanStats {
  same: number;
  different: number;
  leftOnly: number;
  rightOnly: number;
  typeMismatch: number;
  errors: number;
}

export interface FolderScanResult {
  leftRoot: string;
  rightRoot: string;
  entries: FolderEntry[];
  stats: FolderScanStats;
  durationMs: number;
}

export interface StartFolderScanRequest {
  scanGeneration: number;
  leftRoot: string;
  rightRoot: string;
  options: FolderScanOptions;
}

export interface FolderScanStarted {
  jobId: number;
  scanGeneration: number;
  leftRoot: string;
  rightRoot: string;
  optionsFingerprint: string;
}

export interface FolderScanAck {
  jobId: number;
  scanGeneration: number;
  appliedThroughSequence: number;
}

export type PendingReason = "awaitingPeer" | "awaitingHash";

export type FolderEntryResolution =
  | { state: "pending"; reason: PendingReason }
  | { state: "final"; status: FolderEntryStatus };

export interface FolderEntryUpsert {
  relativePath: string;
  revision: number;
  leftPath: string | null;
  rightPath: string | null;
  left: FsEntryMeta | null;
  right: FsEntryMeta | null;
  resolution: FolderEntryResolution;
  message: string | null;
}

export type FolderScanPhase = "inventory" | "classify" | "hash";

export interface FolderScanProgressSnapshot {
  phase: FolderScanPhase;
  discovered: number;
  finalized: number;
  pending: number;
  errors: number;
  hashedFiles: number;
  hashCandidates: number | null;
}

export type FolderScanTerminal =
  | {
      outcome: "completed";
      stats: FolderScanStats;
      entryCount: number;
      durationMs: number;
    }
  | {
      outcome: "cancelled";
      finalized: number;
      pending: number;
      durationMs: number;
    }
  | {
      outcome: "failed";
      code: string;
      message: string;
      finalized: number;
      pending: number;
      durationMs: number;
    };

interface FolderScanMessageIdentity {
  jobId: number;
  scanGeneration: number;
  sequence: number;
}

export type FolderScanMessage =
  | (FolderScanMessageIdentity & {
      event: "batch";
      data: { upserts: FolderEntryUpsert[]; estimatedBytes: number };
    })
  | (FolderScanMessageIdentity & {
      event: "progress";
      data: FolderScanProgressSnapshot;
    })
  | (FolderScanMessageIdentity & {
      event: "terminal";
      data: FolderScanTerminal;
    });

export interface FolderScanProgress {
  jobId: number | null;
  scanGeneration?: number;
  active: boolean;
  leftRoot: string;
  rightRoot: string;
  message: string;
  progress?: FolderScanProgressSnapshot | null;
  terminal?: FolderScanTerminal | null;
}

export type FolderReviewSideExpectation = "regularFile" | "missing";

export interface FolderReviewTextPairRequest {
  leftRoot: string;
  rightRoot: string;
  relativePath: string;
  leftExpected: FolderReviewSideExpectation;
  rightExpected: FolderReviewSideExpectation;
}

export interface FolderReviewTextPair {
  left: FileDocument | null;
  right: FileDocument | null;
}

export interface OpenDetachedFolderReviewRequest extends FolderReviewTextPairRequest {
  sourceReviewToken: string;
  scanGeneration: number;
}

export type DetachedFolderReviewOpenResult =
  | { outcome: "created"; windowLabel: string }
  | { outcome: "focused"; windowLabel: string };

export interface InvalidateDetachedFolderReviewSource {
  sourceReviewToken: string;
  scanGeneration: number;
}

export interface DetachedFolderReviewContext {
  fileName: string;
  parentRelativePath: string;
  relativePath: string;
  leftRoot: string;
  rightRoot: string;
  leftMissing: boolean;
  rightMissing: boolean;
}

export interface DetachedFolderReviewLoaded {
  context: DetachedFolderReviewContext;
  left: FileDocument | null;
  right: FileDocument | null;
  modelIdentity: string;
}

export interface DetachedFolderReviewVersionCheck {
  leftChanged: boolean;
  rightChanged: boolean;
  versionKey: string;
}

export interface MergeResult {
  output: string;
  clean: boolean;
  conflictCount: number;
}

export interface WriteResult {
  path: string;
  backupPath: string | null;
  bytesWritten: number;
  size: number;
  modifiedMs: number | null;
  contentHash: string;
}

export interface ConflictBlock {
  id: number;
  startOffset: number;
  endOffset: number;
  startLine: number;
  endLine: number;
  ours: string;
  base: string;
  theirs: string;
  raw: string;
}

interface CompareSessionBase {
  left: FileDocument;
  right: FileDocument;
}

export interface FileCompareSession extends CompareSessionBase {
  origin: "files";
}

export interface DifftoolCompareSession extends CompareSessionBase {
  origin: "difftool";
}

export interface GitFileCompareSession extends CompareSessionBase {
  origin: "git";
  snapshot: GitSnapshotCompareSession;
}

export interface FolderReviewCompareSession extends CompareSessionBase {
  origin: "folderReview";
}

export type CompareSession =
  | FileCompareSession
  | DifftoolCompareSession
  | GitFileCompareSession
  | FolderReviewCompareSession;

interface MergeSessionBase {
  base: FileDocument;
  ours: FileDocument;
  theirs: FileDocument;
  result: string;
}

export interface FileMergeSession extends MergeSessionBase {
  origin: "files";
  output: FileDocument | null;
  outputPath: string | null;
}

export interface MergetoolMergeSession extends MergeSessionBase {
  origin: "mergetool";
  output: FileDocument;
  outputPath: string;
}

export interface GitConflictMergeSession extends MergeSessionBase {
  origin: "gitConflict";
  output: FileDocument;
  outputPath: string;
  resultDocument: FileDocument;
  conflict: GitConflictSession;
}

export interface GitPreviewMergeSession extends MergeSessionBase {
  origin: "gitPreview";
  output: null;
  outputPath: null;
  preview: GitMergePreview;
}

export type MergeSession =
  | FileMergeSession
  | MergetoolMergeSession
  | GitConflictMergeSession
  | GitPreviewMergeSession;
