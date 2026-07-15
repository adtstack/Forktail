import { hasUnresolvedConflicts } from "./conflicts";
import { saveEncodingWarningForDocument } from "./compareSave";
import { CORE_TEXT } from "./i18n";
import { defaultSystemLineEnding, type SaveLineEndingMode } from "./lineEndings";
import type { FileDocument, MergeSession, WriteResult } from "./models";
import type {
  GitConflictResultFingerprint,
  GitConflictSaveRequest,
  GitConflictStageFingerprint,
} from "./gitModels";
import type { AppLanguage } from "./settings";
import { isVirtualFileDocument } from "./virtualDocument";

export type ConfirmSave = (message: string) => boolean;
export type UnresolvedSavePolicy = "confirm-unresolved" | "block-unresolved";

export const unresolvedSaveMessage = CORE_TEXT.en.unresolvedSaveMessage;

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

interface GitConflictSaveSource {
  conflict: {
    path: { opaqueId: string };
    generation: number;
    stageFingerprint: GitConflictStageFingerprint;
    resultFingerprint: GitConflictResultFingerprint;
  };
}

export function gitConflictSaveRequest(
  source: GitConflictSaveSource,
  text: string,
  lineEndingMode: SaveLineEndingMode,
  systemLineEnding: "\n" | "\r\n" = defaultSystemLineEnding(),
  explicitOverwriteDecision = false,
): GitConflictSaveRequest {
  const lineEndingPolicy = lineEndingMode === "original"
    ? "preserveResult"
    : lineEndingMode === "system"
      ? systemLineEnding === "\r\n" ? "crlf" : "lf"
      : lineEndingMode;
  return {
    opaquePathId: source.conflict.path.opaqueId,
    generation: source.conflict.generation,
    expectedStageFingerprint: source.conflict.stageFingerprint,
    expectedResultFingerprint: source.conflict.resultFingerprint,
    text,
    encodingPolicy: "preserveResult",
    lineEndingPolicy,
    createBackup: true,
    explicitOverwriteDecision,
  };
}

export function canSaveMergeResult(
  text: string,
  confirmSave: ConfirmSave,
  unresolvedPolicy: UnresolvedSavePolicy = "confirm-unresolved",
): boolean {
  if (!hasUnresolvedConflicts(text)) return true;
  if (unresolvedPolicy === "block-unresolved") return false;
  return confirmSave(unresolvedSaveMessage);
}

export function mergeSaveStateAfterWrite(
  resultText: string,
  written: Pick<WriteResult, "path" | "backupPath" | "size" | "modifiedMs">,
  language: AppLanguage = "en",
): SavedMergeState {
  return {
    outputPath: written.path,
    savedSnapshot: resultText,
    outputVersion: versionFromWriteResult(written),
    message: CORE_TEXT[language].saved(written.backupPath),
  };
}

export function mergeSaveEncodingWarning(
  session: MergeSession,
  language: AppLanguage = "en",
): string | null {
  const text = CORE_TEXT[language];
  const documents = [session.base, session.ours, session.theirs, session.output]
    .filter(
      (document): document is FileDocument =>
        document != null && !isVirtualFileDocument(document),
    );
  const hasDecodeLoss = documents.some((document) => document.decodeHadErrors);
  const hasEncodingRisk = documents.some((document) =>
    saveEncodingWarningForDocument(document, "utf8", language) != null
  );

  if (hasDecodeLoss) {
    return text.mergeDecodeLoss;
  }
  if (hasEncodingRisk) {
    return text.mergeEncodingRisk;
  }

  return null;
}

export function mergeResultOriginalLineEnding(
  session: MergeSession,
): FileDocument["lineEnding"] {
  return session.output?.lineEnding ?? session.ours.lineEnding;
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
