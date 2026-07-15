import type {
  CompareSession,
  DifftoolCompareSession,
  FileDocument,
} from "./models";
import type { DifftoolStartupSession } from "./startupSession";
import { virtualMissingFileDocument } from "./virtualDocument";

export const MISSING_DIFFTOOL_LOCAL_PATH = "$LOCAL";
export const MISSING_DIFFTOOL_REMOTE_PATH = "$REMOTE";

export interface DifftoolSessionDocuments {
  local: FileDocument | null;
  remote: FileDocument | null;
}

export interface CompareSessionCapabilities {
  edit: boolean;
  save: boolean;
  saveAs: boolean;
  backupRestore: boolean;
  hunkCopy: boolean;
  replaceInput: boolean;
  swap: boolean;
  persistPaths: boolean;
  exportReport: boolean;
}

export function buildDifftoolSession(
  startup: DifftoolStartupSession,
  documents: DifftoolSessionDocuments,
): DifftoolCompareSession {
  const left = sourceDocument(
    startup.localPath,
    documents.local,
    MISSING_DIFFTOOL_LOCAL_PATH,
  );
  const right = sourceDocument(
    startup.remotePath,
    documents.remote,
    MISSING_DIFFTOOL_REMOTE_PATH,
  );

  return { origin: "difftool", left, right };
}

export function compareSessionCapabilities(
  session: Pick<CompareSession, "origin">,
): CompareSessionCapabilities {
  const writable = session.origin === "files";

  return {
    edit: writable,
    save: writable,
    saveAs: writable,
    backupRestore: writable,
    hunkCopy: writable,
    replaceInput: writable,
    swap: writable,
    persistPaths: writable,
    exportReport: true,
  };
}

function sourceDocument(
  path: string | null,
  document: FileDocument | null,
  missingPath: string,
): FileDocument {
  if (path === null && document === null) {
    return virtualMissingFileDocument(missingPath);
  }
  if (path === null || document === null || path !== document.path) {
    throw {
      code: "PATH_CONFLICT",
      message: "",
    };
  }
  return document;
}
