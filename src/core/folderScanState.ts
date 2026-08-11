import type {
  FolderEntry,
  FolderEntryStatus,
  FolderEntryUpsert,
  FolderScanMessage,
  FolderScanProgressSnapshot,
  FolderScanStats,
  FolderScanTerminal,
} from "./models";

export interface FolderScanAccumulatorIdentity {
  jobId: number;
  scanGeneration: number;
  optionsFingerprint: string;
}

export interface FolderScanAccumulatorSnapshot {
  identity: FolderScanAccumulatorIdentity;
  rows: FolderEntryUpsert[];
  entries: FolderEntry[];
  finalCounts: FolderScanStats;
  pendingCount: number;
  errorCount: number;
  progress: FolderScanProgressSnapshot | null;
  terminal: FolderScanTerminal | null;
  protocolError: string | null;
  lastSequence: number;
}

export type FolderScanApplyResult =
  | { outcome: "applied"; ackSequence: number | null }
  | { outcome: "duplicate"; ackSequence: number | null }
  | { outcome: "stale"; ackSequence: null }
  | { outcome: "protocolError"; ackSequence: null };

const FINAL_STATUSES: FolderEntryStatus[] = [
  "same",
  "different",
  "leftOnly",
  "rightOnly",
  "typeMismatch",
  "error",
];

export function emptyFolderScanStats(): FolderScanStats {
  return {
    same: 0,
    different: 0,
    leftOnly: 0,
    rightOnly: 0,
    typeMismatch: 0,
    errors: 0,
  };
}

export function createFolderScanAccumulator(identity: FolderScanAccumulatorIdentity) {
  const entriesByExactPath = new Map<string, FolderEntryUpsert>();
  const finalCounts = emptyFolderScanStats();
  let pendingCount = 0;
  let lastSequence = 0;
  let progress: FolderScanProgressSnapshot | null = null;
  let terminal: FolderScanTerminal | null = null;
  let protocolError: string | null = null;
  let invalidated = false;

  const subtractResolution = (row: FolderEntryUpsert) => {
    if (row.resolution.state === "pending") {
      pendingCount -= 1;
      return;
    }
    incrementStatus(finalCounts, row.resolution.status, -1);
  };

  const addResolution = (row: FolderEntryUpsert) => {
    if (row.resolution.state === "pending") {
      pendingCount += 1;
      return;
    }
    incrementStatus(finalCounts, row.resolution.status, 1);
  };

  const applyUpsert = (row: FolderEntryUpsert) => {
    const current = entriesByExactPath.get(row.relativePath);
    if (current && current.revision >= row.revision) return;
    if (current) subtractResolution(current);
    entriesByExactPath.set(row.relativePath, row);
    addResolution(row);
  };

  const failProtocol = (message: string): FolderScanApplyResult => {
    protocolError = message;
    return { outcome: "protocolError", ackSequence: null };
  };

  return {
    identity,
    apply(message: FolderScanMessage): FolderScanApplyResult {
      if (invalidated) return { outcome: "stale", ackSequence: null };
      if (
        message.jobId !== identity.jobId
        || message.scanGeneration !== identity.scanGeneration
      ) {
        return { outcome: "stale", ackSequence: null };
      }
      if (protocolError) return { outcome: "protocolError", ackSequence: null };
      if (message.sequence <= lastSequence) {
        return {
          outcome: "duplicate",
          ackSequence: message.event === "batch" ? message.sequence : null,
        };
      }
      if (message.sequence !== lastSequence + 1) {
        return failProtocol(
          `Folder scan sequence gap: expected ${lastSequence + 1}, received ${message.sequence}.`,
        );
      }
      lastSequence = message.sequence;

      if (message.event === "batch") {
        for (const row of message.data.upserts) applyUpsert(row);
        return { outcome: "applied", ackSequence: message.sequence };
      }
      if (message.event === "progress") {
        progress = message.data;
        return { outcome: "applied", ackSequence: null };
      }

      terminal = message.data;
      if (terminal.outcome === "completed") {
        const finalTotal = totalStats(finalCounts);
        if (
          pendingCount !== 0
          || terminal.entryCount !== entriesByExactPath.size
          || terminal.entryCount !== finalTotal
          || !sameStats(terminal.stats, finalCounts)
        ) {
          return failProtocol("Folder scan terminal summary does not match accumulated rows.");
        }
      }
      return { outcome: "applied", ackSequence: null };
    },
    snapshot(): FolderScanAccumulatorSnapshot {
      const rows = Array.from(entriesByExactPath.values());
      return {
        identity,
        rows,
        entries: rows.flatMap(finalFolderEntry),
        finalCounts: { ...finalCounts },
        pendingCount,
        errorCount: finalCounts.errors,
        progress,
        terminal,
        protocolError,
        lastSequence,
      };
    },
    invalidate(): void {
      invalidated = true;
    },
  };
}

function finalFolderEntry(row: FolderEntryUpsert): FolderEntry[] {
  if (row.resolution.state !== "final") return [];
  return [{
    relativePath: row.relativePath,
    leftPath: row.leftPath,
    rightPath: row.rightPath,
    left: row.left,
    right: row.right,
    status: row.resolution.status,
    message: row.message,
  }];
}

function incrementStatus(
  stats: FolderScanStats,
  status: FolderEntryStatus,
  delta: 1 | -1,
): void {
  switch (status) {
    case "same":
      stats.same += delta;
      break;
    case "different":
      stats.different += delta;
      break;
    case "leftOnly":
      stats.leftOnly += delta;
      break;
    case "rightOnly":
      stats.rightOnly += delta;
      break;
    case "typeMismatch":
      stats.typeMismatch += delta;
      break;
    case "error":
      stats.errors += delta;
      break;
  }
}

function totalStats(stats: FolderScanStats): number {
  return FINAL_STATUSES.reduce((total, status) => {
    switch (status) {
      case "same": return total + stats.same;
      case "different": return total + stats.different;
      case "leftOnly": return total + stats.leftOnly;
      case "rightOnly": return total + stats.rightOnly;
      case "typeMismatch": return total + stats.typeMismatch;
      case "error": return total + stats.errors;
    }
  }, 0);
}

function sameStats(left: FolderScanStats, right: FolderScanStats): boolean {
  return left.same === right.same
    && left.different === right.different
    && left.leftOnly === right.leftOnly
    && left.rightOnly === right.rightOnly
    && left.typeMismatch === right.typeMismatch
    && left.errors === right.errors;
}
