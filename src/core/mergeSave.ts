import { hasUnresolvedConflicts } from "./conflicts";
import { saveEncodingWarningForDocument } from "./compareSave";
import type { FileDocument, MergeSession, WriteResult } from "./models";

export type ConfirmSave = (message: string) => boolean;

export const unresolvedSaveMessage = "병합 결과에 충돌 마커가 남아 있습니다. 그래도 저장하시겠습니까?";

export interface WritePrecondition {
  expectedSize: number;
  expectedModifiedMs: number | null;
}

export interface SavedMergeState {
  outputPath: string;
  savedSnapshot: string;
  outputVersion: WritePrecondition;
  message: string;
}

export function canSaveMergeResult(text: string, confirmSave: ConfirmSave): boolean {
  if (!hasUnresolvedConflicts(text)) return true;
  return confirmSave(unresolvedSaveMessage);
}

export function mergeSaveStateAfterWrite(
  resultText: string,
  written: Pick<WriteResult, "path" | "backupPath" | "size" | "modifiedMs">,
): SavedMergeState {
  return {
    outputPath: written.path,
    savedSnapshot: resultText,
    outputVersion: versionFromWriteResult(written),
    message: written.backupPath ? `저장 완료 · 백업: ${written.backupPath}` : "저장 완료",
  };
}

export function mergeSaveEncodingWarning(session: MergeSession): string | null {
  const documents = [session.base, session.ours, session.theirs];
  const hasDecodeLoss = documents.some((document) => document.decodeHadErrors);
  const hasEncodingRisk = documents.some((document) => saveEncodingWarningForDocument(document, "utf8") != null);

  if (hasDecodeLoss) {
    return "원본 중 디코딩 손실이 있는 파일이 있습니다. 병합 결과 저장은 UTF-8로 기록되며 손실된 문자가 그대로 저장될 수 있습니다.";
  }
  if (hasEncodingRisk) {
    return "원본 중 UTF-8이 아닌 파일이 있습니다. 병합 결과 저장은 UTF-8로 기록되며 원본 인코딩과 BOM은 보존되지 않을 수 있습니다.";
  }

  return null;
}

export function mergeSavePreconditionForPath(
  session: MergeSession,
  outputPath: string,
  savedOutputVersion: WritePrecondition | null,
): WritePrecondition | null {
  if (session.outputPath === outputPath && savedOutputVersion) return savedOutputVersion;

  const matchingDocument = [session.base, session.ours, session.theirs].find(
    (document) => document.path === outputPath,
  );
  return matchingDocument ? versionFromDocument(matchingDocument) : null;
}

function versionFromDocument(document: Pick<FileDocument, "size" | "modifiedMs">): WritePrecondition {
  return {
    expectedSize: document.size,
    expectedModifiedMs: document.modifiedMs,
  };
}

function versionFromWriteResult(result: Pick<WriteResult, "size" | "modifiedMs">): WritePrecondition {
  return {
    expectedSize: result.size,
    expectedModifiedMs: result.modifiedMs,
  };
}
