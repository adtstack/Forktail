export const NAVIGATION_HISTORY_CAPACITY = 100;
export const CARET_LINE_PROXIMITY = 1;
export const CARET_COLUMN_PROXIMITY = 1;
export const VIEWPORT_LINE_PROXIMITY = 1;
export const VIEWPORT_PIXEL_PROXIMITY = 2;

export type EditorPaneId = "compareLeft" | "compareRight" | "mergeResult";
export type NavigationInputSource = "keyboard" | "nativeMenu" | "mouse" | "programmaticTest";
export type SemanticNavigationReason =
  | "nextDiff"
  | "previousDiff"
  | "nextConflict"
  | "previousConflict"
  | "paneFocus"
  | "explicitCursorJump"
  | "openReviewItem"
  | "leaveEditorTarget";

export type WorkflowScopeIdentity =
  | { kind: "directCompare"; sessionToken: string; modelRevision: number }
  | { kind: "directMerge"; sessionToken: string; resultRevision: number }
  | { kind: "folderReview"; reviewToken: string; scanGeneration: number }
  | {
      kind: "gitReview";
      repositorySessionId: string;
      generation: number;
      reviewKind: "revision" | "workingIndex" | "conflict";
    };

export type DocumentIdentity =
  | { kind: "mountedCompare"; modelKey: string; modelRevision: number }
  | { kind: "mountedMergeResult"; modelKey: string; modelRevision: number }
  | {
      kind: "folderText";
      relativeItemKey: string;
      comparisonKind: "both" | "leftOnly" | "rightOnly";
    }
  | {
      kind: "gitText";
      opaquePathIds: readonly string[];
      requestKind: "revisionPair" | "index" | "working" | "conflict";
      resolvedObjectIds: readonly string[];
    };

export interface NavigationTarget {
  scope: WorkflowScopeIdentity;
  document: DocumentIdentity;
}

export interface CursorPosition {
  lineNumber: number;
  column: number;
}

export interface ViewportAnchor {
  topLineNumber: number;
  topLineOffsetPx: number;
  scrollLeftPx: number;
}

export interface NavigationLocationInput {
  target: NavigationTarget;
  pane: EditorPaneId;
  cursor: CursorPosition;
  viewport: ViewportAnchor;
}

export interface NavigationLocation extends NavigationLocationInput {
  sequence: number;
}

export interface RestoreReservation {
  invocationId: number;
  candidateSequence: number;
  source: NavigationInputSource;
}

export type CandidateValidation = "valid" | "stale" | "blocked";

export type ReserveCandidateResult =
  | {
      kind: "reserved";
      reservation: RestoreReservation;
      location: NavigationLocation;
      staleDiscarded: number;
    }
  | { kind: "blocked"; location: NavigationLocation; staleDiscarded: number }
  | { kind: "empty"; staleDiscarded: number }
  | { kind: "inFlight" };

export interface NavigationHistorySnapshot {
  current: NavigationLocation | null;
  past: readonly NavigationLocation[];
  replaying: boolean;
  reservation: RestoreReservation | null;
}

export class EditorNavigationHistory {
  readonly capacity: number;
  private past: NavigationLocation[] = [];
  private current: NavigationLocation | null = null;
  private reservation: RestoreReservation | null = null;
  private nextSequence = 1;
  private nextInvocationId = 1;
  private replayDepth = 0;

  constructor(capacity = NAVIGATION_HISTORY_CAPACITY) {
    this.capacity = Math.max(1, Math.trunc(capacity));
  }

  observe(input: NavigationLocationInput): NavigationLocation {
    if (!isNavigationTargetStructurallyValid(input.target) || !isPaneCompatible(input)) {
      throw new Error("Invalid editor navigation target.");
    }
    const location = normalizeLocation(input, this.nextSequence);
    this.nextSequence += 1;
    if (!this.isReplaying()) this.current = location;
    return location;
  }

  commitCurrent(_reason: SemanticNavigationReason): void {
    if (this.isReplaying() || !this.current) return;
    const newest = this.past.at(-1);
    if (newest && locationsCoalesce(newest, this.current)) {
      this.past[this.past.length - 1] = this.current;
      return;
    }
    this.past.push(this.current);
    if (this.past.length > this.capacity) this.past.shift();
  }

  reserveNewestValid(
    source: NavigationInputSource,
    validate: (location: NavigationLocation) => CandidateValidation,
  ): ReserveCandidateResult {
    if (this.reservation) return { kind: "inFlight" };

    let staleDiscarded = 0;
    while (this.past.length > 0) {
      const location = this.past[this.past.length - 1];
      if (!location) break;
      const validation = validate(location);
      if (validation === "stale") {
        this.past.pop();
        staleDiscarded += 1;
        continue;
      }
      if (validation === "blocked") return { kind: "blocked", location, staleDiscarded };

      const reservation: RestoreReservation = {
        invocationId: this.nextInvocationId,
        candidateSequence: location.sequence,
        source,
      };
      this.nextInvocationId += 1;
      this.reservation = reservation;
      return { kind: "reserved", reservation, location, staleDiscarded };
    }

    return { kind: "empty", staleDiscarded };
  }

  commitReservation(invocationId: number): NavigationLocation | null {
    if (!this.reservation || this.reservation.invocationId !== invocationId) return null;
    const candidate = this.past.at(-1) ?? null;
    if (!candidate || candidate.sequence !== this.reservation.candidateSequence) {
      this.reservation = null;
      return null;
    }
    this.past.pop();
    this.current = candidate;
    this.reservation = null;
    return candidate;
  }

  releaseReservation(invocationId: number): boolean {
    if (!this.reservation || this.reservation.invocationId !== invocationId) return false;
    this.reservation = null;
    return true;
  }

  discardReservedAsStale(invocationId: number): boolean {
    if (!this.reservation || this.reservation.invocationId !== invocationId) return false;
    const candidate = this.past.at(-1);
    if (candidate?.sequence === this.reservation.candidateSequence) this.past.pop();
    this.reservation = null;
    return true;
  }

  hasValidCandidate(validate: (location: NavigationLocation) => CandidateValidation): boolean {
    if (this.reservation) return false;
    for (let index = this.past.length - 1; index >= 0; index -= 1) {
      const location = this.past[index];
      if (!location) continue;
      const validation = validate(location);
      if (validation === "valid") return true;
      if (validation === "blocked") return false;
    }
    return false;
  }

  isReplaying(): boolean {
    return this.replayDepth > 0;
  }

  withReplay<T>(callback: () => T): T {
    this.replayDepth += 1;
    try {
      return callback();
    } finally {
      this.replayDepth -= 1;
    }
  }

  snapshot(): NavigationHistorySnapshot {
    return {
      current: this.current,
      past: [...this.past],
      replaying: this.isReplaying(),
      reservation: this.reservation,
    };
  }
}

export function isNavigationTargetStructurallyValid(target: NavigationTarget): boolean {
  const { scope, document } = target;
  if (scope.kind === "directCompare") {
    return document.kind === "mountedCompare" && scope.modelRevision === document.modelRevision;
  }
  if (scope.kind === "directMerge") {
    return document.kind === "mountedMergeResult" &&
      scope.resultRevision === document.modelRevision;
  }
  if (scope.kind === "folderReview") return document.kind === "folderText";
  if (document.kind !== "gitText") return false;
  if (scope.reviewKind === "conflict") return document.requestKind === "conflict";
  if (scope.reviewKind === "revision") return document.requestKind === "revisionPair";
  return document.requestKind === "index" || document.requestKind === "working";
}

function isPaneCompatible(location: NavigationLocationInput): boolean {
  const { document } = location.target;
  if (document.kind === "mountedMergeResult") return location.pane === "mergeResult";
  if (document.kind === "gitText" && document.requestKind === "conflict") {
    return location.pane === "mergeResult";
  }
  return location.pane === "compareLeft" || location.pane === "compareRight";
}

function normalizeLocation(input: NavigationLocationInput, sequence: number): NavigationLocation {
  return {
    sequence,
    target: input.target,
    pane: input.pane,
    cursor: {
      lineNumber: positiveInteger(input.cursor.lineNumber),
      column: positiveInteger(input.cursor.column),
    },
    viewport: {
      topLineNumber: positiveInteger(input.viewport.topLineNumber),
      topLineOffsetPx: nonNegativeFinite(input.viewport.topLineOffsetPx),
      scrollLeftPx: nonNegativeFinite(input.viewport.scrollLeftPx),
    },
  };
}

function locationsCoalesce(left: NavigationLocation, right: NavigationLocation): boolean {
  return left.pane === right.pane &&
    navigationTargetsEqual(left.target, right.target) &&
    Math.abs(left.cursor.lineNumber - right.cursor.lineNumber) <= CARET_LINE_PROXIMITY &&
    Math.abs(left.cursor.column - right.cursor.column) <= CARET_COLUMN_PROXIMITY &&
    Math.abs(left.viewport.topLineNumber - right.viewport.topLineNumber) <=
      VIEWPORT_LINE_PROXIMITY &&
    Math.abs(left.viewport.topLineOffsetPx - right.viewport.topLineOffsetPx) <=
      VIEWPORT_PIXEL_PROXIMITY &&
    Math.abs(left.viewport.scrollLeftPx - right.viewport.scrollLeftPx) <=
      VIEWPORT_PIXEL_PROXIMITY;
}

export function navigationTargetsEqual(left: NavigationTarget, right: NavigationTarget): boolean {
  return sameScope(left.scope, right.scope) && sameDocument(left.document, right.document);
}

function sameScope(left: WorkflowScopeIdentity, right: WorkflowScopeIdentity): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "directCompare" && right.kind === "directCompare") {
    return left.sessionToken === right.sessionToken && left.modelRevision === right.modelRevision;
  }
  if (left.kind === "directMerge" && right.kind === "directMerge") {
    return left.sessionToken === right.sessionToken && left.resultRevision === right.resultRevision;
  }
  if (left.kind === "folderReview" && right.kind === "folderReview") {
    return left.reviewToken === right.reviewToken && left.scanGeneration === right.scanGeneration;
  }
  return left.kind === "gitReview" && right.kind === "gitReview" &&
    left.repositorySessionId === right.repositorySessionId &&
    left.generation === right.generation && left.reviewKind === right.reviewKind;
}

function sameDocument(left: DocumentIdentity, right: DocumentIdentity): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "mountedCompare" && right.kind === "mountedCompare") {
    return left.modelKey === right.modelKey && left.modelRevision === right.modelRevision;
  }
  if (left.kind === "mountedMergeResult" && right.kind === "mountedMergeResult") {
    return left.modelKey === right.modelKey && left.modelRevision === right.modelRevision;
  }
  if (left.kind === "folderText" && right.kind === "folderText") {
    return left.relativeItemKey === right.relativeItemKey &&
      left.comparisonKind === right.comparisonKind;
  }
  return left.kind === "gitText" && right.kind === "gitText" &&
    left.requestKind === right.requestKind &&
    sameStringArray(left.opaquePathIds, right.opaquePathIds) &&
    sameStringArray(left.resolvedObjectIds, right.resolvedObjectIds);
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function positiveInteger(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.trunc(value));
}

function nonNegativeFinite(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}
