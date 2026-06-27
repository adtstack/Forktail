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
  "드롭한 항목의 파일 경로를 읽을 수 없습니다. 데스크톱 앱에서 로컬 파일을 드롭하세요.";

export function droppedFilePaths(dataTransfer: DataTransferLike | null | undefined): string[] {
  if (!dataTransfer) return [];
  const pathsFromFiles = pathsFromFileList(dataTransfer.files);
  if (pathsFromFiles.length > 0) return pathsFromFiles;
  return pathsFromUriList(dataTransfer.getData?.("text/uri-list") ?? "");
}

export function compareDropRejectionMessage(pathCount: number): string | null {
  if (pathCount === 0) return dropPathUnavailableMessage;
  if (pathCount !== 2) {
    return `2-way 비교에는 파일 2개를 드롭하세요. 현재 ${pathCount}개입니다.`;
  }
  return null;
}

export function paneDropRejectionMessage(side: CompareDropSide, pathCount: number): string | null {
  if (pathCount === 0) return dropPathUnavailableMessage;
  if (pathCount !== 1) {
    return `${sideLabel(side)}에는 파일 1개만 드롭할 수 있습니다. 현재 ${pathCount}개입니다.`;
  }
  return null;
}

export function sideLabel(side: CompareDropSide): string {
  return side === "left" ? "왼쪽" : "오른쪽";
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
