import { CORE_TEXT } from "./i18n";
import type { CompareSession, FileDocument, LineEnding, WriteResult } from "./models";
import type { AppLanguage } from "./settings";
import type { WritePrecondition } from "./mergeSave";

export type CompareSide = "left" | "right";

export interface SavedCompareState {
  session: CompareSession;
  savedRightSnapshot: string;
  rightVersion: WritePrecondition;
  message: string;
}

export interface SavedCompareSideState {
  session: CompareSession;
  savedSnapshot: string;
  outputVersion: WritePrecondition;
  message: string;
}

export interface CompareSaveEncodingWarning {
  side: CompareSide;
  label: string;
  message: string;
}

export type SaveEncodingMode = "preserve" | "utf8";

export function compareSavePreconditionForPath(
  session: CompareSession,
  outputPath: string,
  savedOutputVersion: WritePrecondition | null,
  side: CompareSide = "right",
): WritePrecondition | null {
  const target = session[side];
  if (target.path === outputPath) {
    return savedOutputVersion ?? writePreconditionFromDocument(target);
  }

  const otherSide = side === "left" ? "right" : "left";
  const otherDocument = session[otherSide];
  if (otherDocument.path === outputPath) {
    return writePreconditionFromDocument(otherDocument);
  }

  return null;
}

export function compareSaveStateAfterSideWrite(
  session: CompareSession,
  side: CompareSide,
  text: string,
  written: Pick<WriteResult, "path" | "backupPath" | "size" | "modifiedMs">,
  language: AppLanguage = "en",
): SavedCompareSideState {
  const document = fileDocumentAfterTextWrite(session[side], text, written);
  return {
    session: {
      ...session,
      [side]: document,
    },
    savedSnapshot: text,
    outputVersion: writePreconditionFromWriteResult(written),
    message: CORE_TEXT[language].saved(written.backupPath),
  };
}

export function compareSaveStateAfterWrite(
  session: CompareSession,
  rightText: string,
  written: Pick<WriteResult, "path" | "backupPath" | "size" | "modifiedMs">,
  language: AppLanguage = "en",
): SavedCompareState {
  const saved = compareSaveStateAfterSideWrite(session, "right", rightText, written, language);
  return {
    session: saved.session,
    savedRightSnapshot: saved.savedSnapshot,
    rightVersion: saved.outputVersion,
    message: saved.message,
  };
}

export function fileDocumentWithText(document: FileDocument, text: string): FileDocument {
  return {
    ...document,
    text,
    lineEnding: detectLineEnding(text),
    hadFinalNewline: hasFinalNewline(text),
    size: utf8ByteLength(text),
  };
}

export function saveEncodingWarningForDocument(
  document: Pick<FileDocument, "encoding" | "decodeHadErrors">,
  mode: SaveEncodingMode = "preserve",
  language: AppLanguage = "en",
): string | null {
  const text = CORE_TEXT[language];
  const preservedEncoding = preservedSaveEncodingForDocument(document);
  const isPlainUtf8 = document.encoding.trim().toUpperCase() === "UTF-8";
  const willWriteUtf8 = mode === "utf8" || preservedEncoding === "UTF-8";

  if (document.decodeHadErrors && willWriteUtf8 && !isPlainUtf8) {
    return text.decodeLossUtf8(document.encoding);
  }
  if (document.decodeHadErrors) {
    return text.decodeLoss;
  }
  if (willWriteUtf8 && !isPlainUtf8) {
    return text.utf8EncodingRisk(document.encoding);
  }

  return null;
}

export function preservedSaveEncodingForDocument(
  document: Pick<FileDocument, "encoding">,
): string {
  return canonicalPreservableEncoding(document.encoding) ?? "UTF-8";
}

export function compareSaveEncodingWarnings(
  session: CompareSession,
  language: AppLanguage = "en",
): CompareSaveEncodingWarning[] {
  const text = CORE_TEXT[language];
  return (["left", "right"] as const).flatMap((side) => {
    const message = saveEncodingWarningForDocument(session[side], "preserve", language);
    if (!message) return [];
    return [{
      side,
      label: text.compareSide(side),
      message,
    }];
  });
}

export function writePreconditionFromDocument(
  document: Pick<FileDocument, "size" | "modifiedMs">,
): WritePrecondition {
  return {
    expectedSize: document.size,
    expectedModifiedMs: document.modifiedMs,
  };
}

function fileDocumentAfterTextWrite(
  document: FileDocument,
  text: string,
  written: Pick<WriteResult, "path" | "size" | "modifiedMs">,
): FileDocument {
  return {
    ...fileDocumentWithText(document, text),
    path: written.path,
    name: fileNameFromPath(written.path),
    encoding: preservedSaveEncodingForDocument(document),
    size: written.size,
    modifiedMs: written.modifiedMs,
    decodeHadErrors: false,
  };
}

function writePreconditionFromWriteResult(
  result: Pick<WriteResult, "size" | "modifiedMs">,
): WritePrecondition {
  return {
    expectedSize: result.size,
    expectedModifiedMs: result.modifiedMs,
  };
}

function fileNameFromPath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  return normalized.split("/").filter(Boolean).pop() ?? path;
}

function hasFinalNewline(text: string): boolean {
  return text.endsWith("\n") || text.endsWith("\r");
}

function detectLineEnding(text: string): LineEnding {
  if (text.length === 0) return "none";

  let crlf = 0;
  let lf = 0;
  let cr = 0;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "\r" && text[index + 1] === "\n") {
      crlf += 1;
      index += 1;
    } else if (char === "\r") {
      cr += 1;
    } else if (char === "\n") {
      lf += 1;
    }
  }

  const kinds = [crlf, lf, cr].filter((count) => count > 0).length;
  if (kinds === 0) return "none";
  if (kinds > 1) return "mixed";
  if (crlf > 0) return "crlf";
  if (lf > 0) return "lf";
  return "cr";
}

function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

function canonicalPreservableEncoding(encoding: string): string | null {
  switch (encoding.trim().toUpperCase()) {
    case "UTF-8":
      return "UTF-8";
    case "UTF-8 BOM":
      return "UTF-8 BOM";
    case "UTF-16LE BOM":
      return "UTF-16LE BOM";
    case "UTF-16BE BOM":
      return "UTF-16BE BOM";
    default:
      return null;
  }
}
