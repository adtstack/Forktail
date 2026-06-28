import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import type {
  FileDocument,
  FileBackup,
  FileVersion,
  FolderScanOptions,
  FolderScanResult,
  MergeResult,
  WriteResult,
} from "./models";
import type { WritePrecondition } from "./mergeSave";

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function requireTauri(): void {
  if (!isTauriRuntime()) {
    throw new Error("이 기능은 Tauri 데스크톱 런타임에서만 사용할 수 있습니다. 브라우저에서는 데모를 사용하세요.");
  }
}

export async function chooseTextFile(title: string): Promise<string | null> {
  requireTauri();
  const selected = await open({
    title,
    multiple: false,
    directory: false,
  });
  return typeof selected === "string" ? selected : null;
}

export async function chooseDirectory(title: string): Promise<string | null> {
  requireTauri();
  const selected = await open({
    title,
    multiple: false,
    directory: true,
  });
  return typeof selected === "string" ? selected : null;
}

export async function chooseSavePath(
  defaultPath?: string,
  title = "파일 저장",
): Promise<string | null> {
  requireTauri();
  return save({
    title,
    defaultPath,
  });
}

export async function readTextFile(path: string): Promise<FileDocument> {
  requireTauri();
  return invoke<FileDocument>("read_text_file", { path });
}

export async function statTextFileVersion(path: string): Promise<FileVersion> {
  requireTauri();
  return invoke<FileVersion>("stat_text_file_version", { path });
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

export async function cancelFolderScan(jobId: number): Promise<void> {
  requireTauri();
  return invoke<void>("cancel_folder_scan", { jobId });
}

export async function mergeTexts(base: string, ours: string, theirs: string): Promise<MergeResult> {
  requireTauri();
  return invoke<MergeResult>("merge_texts", { base, ours, theirs });
}

export async function startupArgs(): Promise<string[]> {
  requireTauri();
  return invoke<string[]>("startup_args");
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
): Promise<WriteResult> {
  requireTauri();
  return invoke<WriteResult>("write_text_file_atomic", {
    path,
    text,
    createBackup,
    expectedSize: precondition?.expectedSize ?? null,
    expectedModifiedMs: precondition?.expectedModifiedMs ?? null,
    encoding,
  });
}
