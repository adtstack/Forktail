import { CORE_TEXT } from "./i18n";
import type { AppLanguage } from "./settings";

export type CompareDropSide = "left" | "right";

interface DroppedFileLike {
  name?: unknown;
  path?: unknown;
}

interface DataTransferLike {
  files?: ArrayLike<DroppedFileLike> | null;
  getData?: (format: string) => string;
}

export const dropPathUnavailableMessage =
  CORE_TEXT.en.dropPathUnavailable;

export function droppedFilePaths(dataTransfer: DataTransferLike | null | undefined): string[] {
  if (!dataTransfer) return [];
  const pathsFromFiles = pathsFromFileList(dataTransfer.files);
  if (pathsFromFiles.length > 0) return pathsFromFiles;
  return pathsFromUriList(dataTransfer.getData?.("text/uri-list") ?? "");
}

export function compareDropRejectionMessage(
  pathCount: number,
  language: AppLanguage = "en",
): string | null {
  const text = CORE_TEXT[language];
  if (pathCount === 0) return text.dropPathUnavailable;
  if (pathCount !== 2) {
    return text.compareDropWrongCount(pathCount);
  }
  return null;
}

export function paneDropRejectionMessage(
  side: CompareDropSide,
  pathCount: number,
  language: AppLanguage = "en",
): string | null {
  const text = CORE_TEXT[language];
  if (pathCount === 0) return text.dropPathUnavailable;
  if (pathCount !== 1) {
    return text.paneDropWrongCount(side, pathCount);
  }
  return null;
}

export function sideLabel(side: CompareDropSide, language: AppLanguage = "en"): string {
  return CORE_TEXT[language].compareSideLower(side);
}

function pathsFromFileList(files: ArrayLike<DroppedFileLike> | null | undefined): string[] {
  if (!files) return [];
  return Array.from({ length: files.length }, (_, index) => files[index])
    .map((file) => (typeof file?.path === "string" ? file.path.trim() : ""))
    .filter((path) => path.length > 0);
}

function pathsFromUriList(uriList: string): string[] {
  return uriList
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map(pathFromFileUri)
    .filter((path): path is string => path != null);
}

function pathFromFileUri(uri: string): string | null {
  try {
    const url = new URL(uri);
    if (url.protocol !== "file:") return null;
    const decodedPath = decodeURIComponent(url.pathname);
    if (/^\/[A-Za-z]:\//.test(decodedPath)) return decodedPath.slice(1);
    if (url.hostname) return `//${url.hostname}${decodedPath}`;
    return decodedPath;
  } catch {
    return null;
  }
}
