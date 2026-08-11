import { Channel, invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import type {
  FileDocument,
  FileBackup,
  FileVersion,
  FolderScanAck,
  FolderScanMessage,
  FolderScanOptions,
  FolderScanResult,
  FolderScanStarted,
  FolderReviewTextPair,
  FolderReviewTextPairRequest,
  DetachedFolderReviewLoaded,
  DetachedFolderReviewOpenResult,
  DetachedFolderReviewVersionCheck,
  InvalidateDetachedFolderReviewSource,
  OpenDetachedFolderReviewRequest,
  MergeResult,
  StartFolderScanRequest,
  WriteResult,
} from "./models";
import type { WritePrecondition } from "./mergeSave";
import type { GitToolPlatform } from "./gitToolConfig";
import type {
  GitCompareSession,
  GitConflictList,
  GitConflictSession,
  GitConflictSessionRequest,
  GitConflictSaveRequest,
  GitConflictSaveResult,
  GitFileHistoryList,
  GitFileHistoryRequest,
  GitConflictsRequest,
  GitIndexCompareRequest,
  GitMergeBase,
  GitMergeBaseRequest,
  GitMergePreview,
  GitMergePreviewRequest,
  GitChangedFileList,
  GitChangedFilesRequest,
  GitRefKind,
  GitRefList,
  GitRecentCommitList,
  GitRepositorySummary,
  GitRevision,
  GitRevisionCompareRequest,
  GitStatusRequest,
  GitStatusSnapshot,
  GitTreeList,
  GitTreePathRequest,
  GitWorkingTreeCompareRequest,
} from "./gitModels";

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

let nativeDialogDepth = 0;
const nativeDialogDepthListeners = new Set<(depth: number) => void>();

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function requireTauri(): void {
  if (!isTauriRuntime()) {
    throw new Error("This feature is only available in the Tauri desktop runtime. Use demos in the browser.");
  }
}

export async function chooseTextFile(title: string): Promise<string | null> {
  requireTauri();
  const selected = await withNativeDialog(() => open({
      title,
      multiple: false,
      directory: false,
    }));
  return typeof selected === "string" ? selected : null;
}

export async function exitExternalGitTool(): Promise<void> {
  requireTauri();
  await invoke<void>("exit_external_git_tool");
}

export async function chooseDirectory(title: string): Promise<string | null> {
  requireTauri();
  const selected = await withNativeDialog(() => open({
      title,
      multiple: false,
      directory: true,
    }));
  return typeof selected === "string" ? selected : null;
}

export async function chooseSavePath(
  defaultPath?: string,
  title = "Save File",
): Promise<string | null> {
  requireTauri();
  return withNativeDialog(() => save({
      title,
      defaultPath,
    }));
}

export function nativeDialogDepthSnapshot(): number {
  return nativeDialogDepth;
}

export function subscribeNativeDialogDepth(listener: (depth: number) => void): () => void {
  nativeDialogDepthListeners.add(listener);
  return () => { nativeDialogDepthListeners.delete(listener); };
}

async function withNativeDialog<T>(operation: () => Promise<T>): Promise<T> {
  nativeDialogDepth += 1;
  notifyNativeDialogDepth();
  try {
    return await operation();
  } finally {
    nativeDialogDepth = Math.max(0, nativeDialogDepth - 1);
    notifyNativeDialogDepth();
  }
}

function notifyNativeDialogDepth(): void {
  for (const listener of nativeDialogDepthListeners) listener(nativeDialogDepth);
}

export async function readTextFile(path: string): Promise<FileDocument> {
  requireTauri();
  return invoke<FileDocument>("read_text_file", { path });
}

export async function readFolderReviewTextPair(
  request: FolderReviewTextPairRequest,
  jobId: number,
): Promise<FolderReviewTextPair> {
  requireTauri();
  return invoke<FolderReviewTextPair>("read_folder_review_text_pair", { request, jobId });
}

export async function cancelFolderReviewTextRead(jobId: number): Promise<void> {
  requireTauri();
  return invoke<void>("cancel_folder_review_text_read", { jobId });
}

export async function openDetachedFolderReview(
  request: OpenDetachedFolderReviewRequest,
): Promise<DetachedFolderReviewOpenResult> {
  requireTauri();
  return invoke<DetachedFolderReviewOpenResult>("open_detached_folder_review", { request });
}

export async function invalidateDetachedFolderReviewSource(
  request: InvalidateDetachedFolderReviewSource,
): Promise<void> {
  requireTauri();
  await invoke<void>("invalidate_detached_folder_review_source", { request });
}

export async function loadDetachedFolderReview(): Promise<DetachedFolderReviewLoaded> {
  requireTauri();
  return invoke<DetachedFolderReviewLoaded>("load_detached_folder_review");
}

export async function checkDetachedFolderReviewVersions(): Promise<DetachedFolderReviewVersionCheck> {
  requireTauri();
  return invoke<DetachedFolderReviewVersionCheck>("check_detached_folder_review_versions");
}

export async function reloadDetachedFolderReview(): Promise<DetachedFolderReviewLoaded> {
  requireTauri();
  return invoke<DetachedFolderReviewLoaded>("reload_detached_folder_review");
}

export async function openGitRevisionCompare(
  repositorySessionId: string,
  request: GitRevisionCompareRequest,
  jobId: number,
): Promise<GitCompareSession> {
  requireTauri();
  return invoke<GitCompareSession>("open_git_revision_compare", {
    repositorySessionId,
    request,
    jobId,
  });
}

export async function openGitWorkingTreeCompare(
  repositorySessionId: string,
  request: GitWorkingTreeCompareRequest,
  jobId: number,
): Promise<GitCompareSession> {
  requireTauri();
  return invoke<GitCompareSession>("open_git_working_tree_compare", {
    repositorySessionId,
    request,
    jobId,
  });
}

export async function openGitIndexCompare(
  repositorySessionId: string,
  request: GitIndexCompareRequest,
  jobId: number,
): Promise<GitCompareSession> {
  requireTauri();
  return invoke<GitCompareSession>("open_git_index_compare", {
    repositorySessionId,
    request,
    jobId,
  });
}

export async function detectGitRepository(candidatePath: string): Promise<GitRepositorySummary> {
  requireTauri();
  return invoke<GitRepositorySummary>("detect_git_repository", { candidatePath });
}

export async function closeGitRepository(repositorySessionId: string): Promise<void> {
  requireTauri();
  return invoke<void>("close_git_repository", { repositorySessionId });
}

export async function listGitRefs(
  repositorySessionId: string,
  kinds: GitRefKind[],
  hardLimit: number,
  jobId: number,
): Promise<GitRefList> {
  requireTauri();
  return invoke<GitRefList>("list_git_refs", {
    repositorySessionId,
    kinds,
    hardLimit,
    jobId,
  });
}

export async function listGitRecentCommits(
  repositorySessionId: string,
  startCommit: GitRevision["resolved"],
  hardLimit: number,
  jobId: number,
): Promise<GitRecentCommitList> {
  requireTauri();
  return invoke<GitRecentCommitList>("list_git_recent_commits", {
    repositorySessionId,
    startCommit,
    hardLimit,
    jobId,
  });
}

export async function listGitFileHistory(
  repositorySessionId: string,
  request: GitFileHistoryRequest,
  jobId: number,
): Promise<GitFileHistoryList> {
  requireTauri();
  return invoke<GitFileHistoryList>("list_git_file_history", {
    repositorySessionId,
    request,
    jobId,
  });
}

export async function listGitTree(
  repositorySessionId: string,
  commit: GitRevision["resolved"],
  pathPrefix: GitTreePathRequest | null,
  hardLimit: number,
  jobId: number,
): Promise<GitTreeList> {
  requireTauri();
  return invoke<GitTreeList>("list_git_tree", {
    repositorySessionId,
    commit,
    pathPrefix,
    hardLimit,
    jobId,
  });
}

export async function resolveGitRevision(
  repositorySessionId: string,
  rawRevision: string,
  requestGeneration: number,
): Promise<GitRevision> {
  requireTauri();
  return invoke<GitRevision>("resolve_git_revision", {
    repositorySessionId,
    rawRevision,
    requestGeneration,
  });
}

export async function cancelGitJob(
  repositorySessionId: string,
  jobId: number,
): Promise<void> {
  requireTauri();
  return invoke<void>("cancel_git_job", { repositorySessionId, jobId });
}

export async function listGitChangedFiles(
  repositorySessionId: string,
  request: GitChangedFilesRequest,
  jobId: number,
): Promise<GitChangedFileList> {
  requireTauri();
  return invoke<GitChangedFileList>("list_git_changed_files", {
    repositorySessionId,
    request,
    jobId,
  });
}

export async function readGitStatus(
  repositorySessionId: string,
  request: GitStatusRequest,
  jobId: number,
): Promise<GitStatusSnapshot> {
  requireTauri();
  return invoke<GitStatusSnapshot>("read_git_status", {
    repositorySessionId,
    request,
    jobId,
  });
}

export async function listGitConflicts(
  repositorySessionId: string,
  request: GitConflictsRequest,
  jobId: number,
): Promise<GitConflictList> {
  requireTauri();
  return invoke<GitConflictList>("list_git_conflicts", {
    repositorySessionId,
    request,
    jobId,
  });
}

export async function getGitMergeBase(
  repositorySessionId: string,
  request: GitMergeBaseRequest,
  jobId: number,
): Promise<GitMergeBase> {
  requireTauri();
  return invoke<GitMergeBase>("get_git_merge_base", {
    repositorySessionId,
    request,
    jobId,
  });
}

export async function openGitMergePreview(
  repositorySessionId: string,
  request: GitMergePreviewRequest,
  jobId: number,
): Promise<GitMergePreview> {
  requireTauri();
  return invoke<GitMergePreview>("open_git_merge_preview", {
    repositorySessionId,
    request,
    jobId,
  });
}

export async function openGitConflict(
  repositorySessionId: string,
  request: GitConflictSessionRequest,
  jobId: number,
): Promise<GitConflictSession> {
  requireTauri();
  return invoke<GitConflictSession>("open_git_conflict", {
    repositorySessionId,
    request,
    jobId,
  });
}

export async function saveGitConflictResult(
  repositorySessionId: string,
  request: GitConflictSaveRequest,
  jobId: number,
): Promise<GitConflictSaveResult> {
  requireTauri();
  return invoke<GitConflictSaveResult>("save_git_conflict_result", {
    repositorySessionId,
    request,
    jobId,
  });
}

export async function statTextFileVersion(path: string): Promise<FileVersion> {
  requireTauri();
  return invoke<FileVersion>("stat_text_file_version", { path });
}

export async function statOptionalTextFileVersion(path: string): Promise<FileVersion | null> {
  requireTauri();
  return invoke<FileVersion | null>("stat_optional_text_file_version", { path });
}

export async function listFileBackups(path: string): Promise<FileBackup[]> {
  requireTauri();
  return invoke<FileBackup[]>("list_file_backups", { path });
}

export async function restoreTextFileBackup(
  path: string,
  backupPath: string,
  precondition: WritePrecondition | null = null,
): Promise<WriteResult> {
  requireTauri();
  return invoke<WriteResult>("restore_text_file_backup", {
    path,
    backupPath,
    expectedSize: precondition?.expectedSize ?? null,
    expectedModifiedMs: precondition?.expectedModifiedMs ?? null,
    expectedContentHash: precondition?.expectedContentHash ?? null,
  });
}

export async function scanDirectories(
  leftRoot: string,
  rightRoot: string,
  options: FolderScanOptions,
  jobId: number | null = null,
): Promise<FolderScanResult> {
  requireTauri();
  return invoke<FolderScanResult>("scan_directories", {
    leftRoot,
    rightRoot,
    options,
    jobId,
  });
}

export async function startFolderScan(
  request: StartFolderScanRequest,
  onMessage: (message: FolderScanMessage) => void,
  onStarted?: (started: FolderScanStarted) => void,
): Promise<FolderScanStarted> {
  requireTauri();
  const onEvent = new Channel<FolderScanMessage>();
  const pending: FolderScanMessage[] = [];
  let ready = false;
  onEvent.onmessage = (message) => {
    if (ready) {
      onMessage(message);
    } else {
      pending.push(message);
    }
  };

  const started = await invoke<FolderScanStarted>("start_folder_scan", { request, onEvent });
  onStarted?.(started);
  ready = true;
  for (const message of pending) onMessage(message);
  return started;
}

export async function ackFolderScan(ack: FolderScanAck): Promise<void> {
  requireTauri();
  return invoke<void>("ack_folder_scan", { ack });
}

export async function cancelFolderScan(jobId: number, scanGeneration: number): Promise<void> {
  requireTauri();
  return invoke<void>("cancel_folder_scan", { jobId, scanGeneration });
}

export async function mergeTexts(base: string, ours: string, theirs: string): Promise<MergeResult> {
  requireTauri();
  return invoke<MergeResult>("merge_texts", { base, ours, theirs });
}

export async function startupArgs(): Promise<string[]> {
  requireTauri();
  return invoke<string[]>("startup_args");
}

export async function gitToolExecutablePath(): Promise<string> {
  requireTauri();
  return invoke<string>("git_tool_executable_path");
}

export interface RuntimeIntegrationProfile {
  platform: GitToolPlatform;
  executablePath: string | null;
  detection: "detected" | "manualRequired";
}

export async function runtimeIntegrationProfile(): Promise<RuntimeIntegrationProfile> {
  requireTauri();
  return invoke<RuntimeIntegrationProfile>("runtime_integration_profile");
}

export async function setEditorNavigationBackEnabled(enabled: boolean): Promise<void> {
  requireTauri();
  return invoke<void>("set_editor_navigation_back_enabled", { enabled });
}

export async function setSettingsCommandEnabled(enabled: boolean): Promise<void> {
  requireTauri();
  return invoke<void>("set_settings_command_enabled", { enabled });
}

export async function revealPath(path: string): Promise<void> {
  requireTauri();
  return invoke<void>("reveal_path", { path });
}

export async function writeTextFileAtomic(
  path: string,
  text: string,
  createBackup = true,
  precondition: WritePrecondition | null = null,
  encoding: string | null = null,
  expectedAbsent = false,
): Promise<WriteResult> {
  requireTauri();
  return invoke<WriteResult>(
    expectedAbsent ? "write_text_file_atomic_guarded" : "write_text_file_atomic",
    {
      path,
      text,
      createBackup,
      expectedSize: precondition?.expectedSize ?? null,
      expectedModifiedMs: precondition?.expectedModifiedMs ?? null,
      expectedContentHash: precondition?.expectedContentHash ?? null,
      encoding,
    },
  );
}
