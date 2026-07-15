import type { FileDocument, GitFileCompareSession } from "./models";
import type {
  GitCompareSession,
  GitSnapshotContentState,
  GitSnapshotDocument,
} from "./gitModels";

export type GitCompareViewState =
  | { kind: "compare"; session: GitFileCompareSession }
  | {
      kind: "notice";
      session: GitCompareSession;
      contentStates: GitSnapshotContentState["kind"][];
    };

export function adaptGitCompareSession(session: GitCompareSession): GitCompareViewState {
  const left = gitSnapshotFileDocument(session.left);
  const right = gitSnapshotFileDocument(session.right);
  const validReadOnlyContract = session.left.readOnly
    && session.right.readOnly
    && !session.capabilities.edit
    && !session.capabilities.save
    && !session.capabilities.hunkCopy
    && session.capabilities.exportPatch;

  if (!left || !right || !validReadOnlyContract) {
    return {
      kind: "notice",
      session,
      contentStates: [session.left.contentState.kind, session.right.contentState.kind],
    };
  }

  return {
    kind: "compare",
    session: {
      origin: "git",
      left,
      right,
      snapshot: session,
    },
  };
}

function gitSnapshotFileDocument(snapshot: GitSnapshotDocument): FileDocument | null {
  if (snapshot.contentState.kind === "missing") {
    if (snapshot.origin !== "missing" || snapshot.objectId !== null) return null;
    return {
      path: snapshot.label,
      name: snapshotName(snapshot),
      text: "",
      encoding: "Missing",
      lineEnding: "none",
      hadFinalNewline: true,
      size: 0,
      modifiedMs: null,
      isBinary: false,
      decodeHadErrors: false,
      virtual: { kind: "gitSnapshot", contentState: "missing" },
    };
  }

  if (
    snapshot.contentState.kind !== "text"
    || snapshot.origin !== "committedBlob"
    || snapshot.objectId === null
    || snapshot.textMetadata === null
  ) {
    return null;
  }

  return {
    path: snapshot.label,
    name: snapshotName(snapshot),
    text: snapshot.contentState.text,
    encoding: snapshot.textMetadata.encoding,
    lineEnding: snapshot.textMetadata.lineEnding,
    hadFinalNewline: snapshot.textMetadata.hadFinalNewline,
    size: snapshot.textMetadata.size,
    modifiedMs: null,
    isBinary: false,
    decodeHadErrors: snapshot.textMetadata.decodeHadErrors,
    virtual: { kind: "gitSnapshot", contentState: "text" },
  };
}

function snapshotName(snapshot: GitSnapshotDocument): string {
  const displayPath = snapshot.path?.displayPath;
  if (!displayPath) return snapshot.contentState.kind === "missing" ? "Missing" : "Snapshot";
  const normalized = displayPath.replace(/\\/g, "/");
  return normalized.split("/").filter(Boolean).pop() ?? displayPath;
}
