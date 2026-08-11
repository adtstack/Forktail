import type { CompareSide } from "./compareSave";
import type { AppMode, CompareSession, FileDocument } from "./models";

export type CompareDropReplacementStaleReason =
  | "superseded"
  | "sessionChanged"
  | "sideChanged";

export interface CompareDropReplacementRequest {
  id: number;
  side: CompareSide;
  sessionRevision: number;
  expectedDocument: FileDocument;
}

export type CompareDropReplacementOutcome =
  | {
      kind: "applied";
      session: CompareSession;
    }
  | {
      kind: "stale";
      reason: CompareDropReplacementStaleReason;
      session: CompareSession | null;
    };

/**
 * Coordinates asynchronous pane replacements without making the editor read-only.
 * Requests are independent per pane, while each pane follows latest-request-wins.
 */
export class CompareDropReplacementCoordinator {
  private nextRequestId = 0;
  private readonly activeRequestIds: Record<CompareSide, number | null> = {
    left: null,
    right: null,
  };

  begin(
    side: CompareSide,
    sessionRevision: number,
    expectedDocument: FileDocument,
  ): CompareDropReplacementRequest {
    const request = {
      id: this.nextRequestId + 1,
      side,
      sessionRevision,
      expectedDocument,
    };
    this.nextRequestId = request.id;
    this.activeRequestIds[side] = request.id;
    return request;
  }

  complete(
    request: CompareDropReplacementRequest,
    currentSessionRevision: number,
    currentMode: AppMode,
    currentSession: CompareSession | null,
    replacement: FileDocument,
  ): CompareDropReplacementOutcome {
    if (this.activeRequestIds[request.side] !== request.id) {
      return {
        kind: "stale",
        reason: "superseded",
        session: currentSession,
      };
    }
    this.activeRequestIds[request.side] = null;

    if (
      currentSessionRevision !== request.sessionRevision
      || currentMode !== "compare"
      || currentSession == null
    ) {
      return {
        kind: "stale",
        reason: "sessionChanged",
        session: currentSession,
      };
    }
    if (currentSession[request.side] !== request.expectedDocument) {
      return {
        kind: "stale",
        reason: "sideChanged",
        session: currentSession,
      };
    }

    return {
      kind: "applied",
      session: {
        ...currentSession,
        [request.side]: replacement,
      },
    };
  }

  finish(request: CompareDropReplacementRequest): void {
    if (this.activeRequestIds[request.side] === request.id) {
      this.activeRequestIds[request.side] = null;
    }
  }
}
