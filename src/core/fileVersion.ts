import type { CompareSession, FileDocument, FileVersion } from "./models";

export interface CompareFileChangeNotice {
  leftChanged: boolean;
  rightChanged: boolean;
  message: string;
  versionKey: string;
}

export function fileDocumentVersionChanged(
  document: FileDocument,
  version: FileVersion | null,
): boolean {
  if (!version) return true;
  return document.size !== version.size || document.modifiedMs !== version.modifiedMs;
}

export function buildCompareFileChangeNotice(
  session: CompareSession,
  leftVersion: FileVersion | null,
  rightVersion: FileVersion | null,
): CompareFileChangeNotice | null {
  const leftChanged = fileDocumentVersionChanged(session.left, leftVersion);
  const rightChanged = fileDocumentVersionChanged(session.right, rightVersion);
  if (!leftChanged && !rightChanged) return null;

  const changedSides = [
    leftChanged ? "왼쪽" : null,
    rightChanged ? "오른쪽" : null,
  ].filter((side): side is string => side != null);

  return {
    leftChanged,
    rightChanged,
    versionKey: compareFileChangeVersionKey(leftVersion, rightVersion),
    message: `${changedSides.join("과 ")} 파일이 열린 뒤 변경됐습니다. 다시 읽거나 현재 비교 내용을 유지하세요.`,
  };
}

export function compareFileChangeVersionKey(
  leftVersion: FileVersion | null,
  rightVersion: FileVersion | null,
): string {
  return [versionKeyPart("left", leftVersion), versionKeyPart("right", rightVersion)].join("|");
}

function versionKeyPart(side: "left" | "right", version: FileVersion | null): string {
  if (!version) return `${side}:unavailable`;
  return `${side}:${version.path}:${version.size}:${version.modifiedMs ?? "unknown"}`;
}
