export type AppMode = "home" | "compare" | "folders" | "merge";

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
  isBinary: boolean;
  decodeHadErrors: boolean;
  virtual?: {
    kind: "missing";
  };
}

export interface FileVersion {
  path: string;
  size: number;
  modifiedMs: number | null;
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

export interface FolderScanProgress {
  jobId: number;
  active: boolean;
  leftRoot: string;
  rightRoot: string;
  message: string;
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

export type CompareSession = FileCompareSession | DifftoolCompareSession;

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

export type MergeSession = FileMergeSession | MergetoolMergeSession;
