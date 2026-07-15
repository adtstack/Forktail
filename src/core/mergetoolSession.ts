import { isAppError } from "./errors";
import type { UnresolvedSavePolicy, WritePrecondition } from "./mergeSave";
import type { FileDocument, MergeSession } from "./models";
import type { MergetoolStartupSession } from "./startupSession";
import { virtualMissingFileDocument } from "./virtualDocument";

export const MISSING_MERGETOOL_BASE_PATH = "$BASE";

export interface MergetoolSessionDocuments {
  base: FileDocument | null;
  ours: FileDocument;
  theirs: FileDocument;
  merged: FileDocument;
}

export interface BuiltMergetoolSession {
  session: MergeSession;
  outputVersion: WritePrecondition;
}

export interface MergeSessionCapabilities {
  editable: boolean;
  save: boolean;
  saveTarget: "selectable" | "output-only" | "none";
  saveAs: boolean;
  backupRestore: boolean;
  persistPaths: boolean;
  recoveryDrafts: boolean;
  unresolvedPolicy: UnresolvedSavePolicy;
}

export function buildMergetoolSession(
  startup: MergetoolStartupSession,
  documents: MergetoolSessionDocuments,
): BuiltMergetoolSession {
  if (documents.merged.path !== startup.outputPath) {
    throw {
      code: "PATH_CONFLICT",
      message: "",
    };
  }

  const base = documents.base ?? virtualMissingFileDocument(
    startup.basePath ?? MISSING_MERGETOOL_BASE_PATH,
  );

  return {
    session: {
      origin: "mergetool",
      base,
      ours: documents.ours,
      theirs: documents.theirs,
      output: documents.merged,
      result: documents.merged.text,
      outputPath: documents.merged.path,
    },
    outputVersion: {
      expectedSize: documents.merged.size,
      expectedModifiedMs: documents.merged.modifiedMs,
    },
  };
}

export function mergetoolSessionCapabilities(
  session: Pick<MergeSession, "origin">,
): MergeSessionCapabilities {
  if (session.origin === "gitPreview") {
    return {
      editable: false,
      save: false,
      saveTarget: "none",
      saveAs: false,
      backupRestore: false,
      persistPaths: false,
      recoveryDrafts: false,
      unresolvedPolicy: "block-unresolved",
    };
  }
  if (session.origin === "mergetool" || session.origin === "gitConflict") {
    return {
      editable: true,
      save: true,
      saveTarget: "output-only",
      saveAs: false,
      backupRestore: false,
      persistPaths: false,
      recoveryDrafts: false,
      unresolvedPolicy: "block-unresolved",
    };
  }

  return {
    editable: true,
    save: true,
    saveTarget: "selectable",
    saveAs: true,
    backupRestore: true,
    persistPaths: true,
    recoveryDrafts: true,
    unresolvedPolicy: "confirm-unresolved",
  };
}

export function isMissingMergetoolBaseError(value: unknown): boolean {
  return isAppError(value) && value.code === "NOT_FOUND";
}
