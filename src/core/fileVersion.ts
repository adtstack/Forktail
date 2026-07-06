import { CORE_TEXT } from "./i18n";
import type { CompareSession, FileDocument, FileVersion } from "./models";
import type { AppLanguage } from "./settings";
import { isVirtualFileDocument } from "./virtualDocument";

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
  if (isVirtualFileDocument(document)) return false;
  if (!version) return true;
  return document.size !== version.size || document.modifiedMs !== version.modifiedMs;
}

export function buildCompareFileChangeNotice(
  session: CompareSession,
  leftVersion: FileVersion | null,
  rightVersion: FileVersion | null,
  language: AppLanguage = "en",
): CompareFileChangeNotice | null {
  const leftChanged = fileDocumentVersionChanged(session.left, leftVersion);
  const rightChanged = fileDocumentVersionChanged(session.right, rightVersion);
  if (!leftChanged && !rightChanged) return null;

  return {
    leftChanged,
    rightChanged,
    versionKey: compareFileChangeVersionKey(leftVersion, rightVersion),
    message: CORE_TEXT[language].fileChangeNotice(leftChanged, rightChanged),
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
