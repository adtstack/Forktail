import { describe, expect, it } from "vitest";
import type { FolderEntryUpsert, FolderScanMessage } from "./models";
import { createFolderScanAccumulator } from "./folderScanState";

function upsert(
  revision: number,
  resolution: FolderEntryUpsert["resolution"],
): FolderEntryUpsert {
  return {
    relativePath: "src/App.tsx",
    revision,
    leftPath: "/left/src/App.tsx",
    rightPath: resolution.state === "final" ? null : null,
    left: { kind: "file", size: 10, modifiedMs: 1, hash: null },
    right: null,
    resolution,
    message: null,
  };
}

function batch(sequence: number, row: FolderEntryUpsert): FolderScanMessage {
  return {
    event: "batch",
    jobId: 9,
    scanGeneration: 3,
    sequence,
    data: { upserts: [row], estimatedBytes: 128 },
  };
}

describe("progressive folder scan accumulator", () => {
  it("replaces one exact-path pending row with a higher final revision", () => {
    const accumulator = createFolderScanAccumulator({
      jobId: 9,
      scanGeneration: 3,
      optionsFingerprint: "metadata:0:0:0",
    });

    expect(accumulator.apply(batch(1, upsert(1, {
      state: "pending",
      reason: "awaitingPeer",
    })))).toMatchObject({ outcome: "applied", ackSequence: 1 });
    expect(accumulator.snapshot()).toMatchObject({
      pendingCount: 1,
      errorCount: 0,
      entries: [],
    });

    accumulator.apply(batch(2, upsert(2, { state: "final", status: "leftOnly" })));
    const snapshot = accumulator.snapshot();
    expect(snapshot.rows).toHaveLength(1);
    expect(snapshot.entries).toHaveLength(1);
    expect(snapshot.entries[0]?.status).toBe("leftOnly");
    expect(snapshot.pendingCount).toBe(0);
    expect(snapshot.finalCounts.leftOnly).toBe(1);
  });

  it("ignores stale identities and lower row revisions without duplicating counts", () => {
    const accumulator = createFolderScanAccumulator({
      jobId: 9,
      scanGeneration: 3,
      optionsFingerprint: "metadata:0:0:0",
    });
    accumulator.apply(batch(1, upsert(2, { state: "final", status: "different" })));
    accumulator.apply(batch(2, upsert(1, { state: "final", status: "same" })));

    const stale = { ...batch(3, upsert(3, { state: "final", status: "same" })), jobId: 10 };
    expect(accumulator.apply(stale)).toMatchObject({ outcome: "stale", ackSequence: null });
    expect(accumulator.snapshot().finalCounts).toMatchObject({ different: 1, same: 0 });
  });

  it("treats a forward sequence gap as a controlled protocol failure", () => {
    const accumulator = createFolderScanAccumulator({
      jobId: 9,
      scanGeneration: 3,
      optionsFingerprint: "metadata:0:0:0",
    });
    accumulator.apply(batch(1, upsert(1, { state: "pending", reason: "awaitingHash" })));

    expect(accumulator.apply(batch(3, upsert(2, {
      state: "final",
      status: "same",
    }))).outcome).toBe("protocolError");
    expect(accumulator.snapshot().protocolError).toContain("sequence");
    expect(accumulator.snapshot().pendingCount).toBe(1);
  });

  it("idempotently re-acknowledges an already applied batch", () => {
    const accumulator = createFolderScanAccumulator({
      jobId: 9,
      scanGeneration: 3,
      optionsFingerprint: "metadata:0:0:0",
    });
    const message = batch(1, upsert(1, { state: "final", status: "same" }));
    accumulator.apply(message);

    expect(accumulator.apply(message)).toEqual({ outcome: "duplicate", ackSequence: 1 });
    expect(accumulator.snapshot().entries).toHaveLength(1);
  });

  it("rejects a completed summary while pending rows remain", () => {
    const accumulator = createFolderScanAccumulator({
      jobId: 9,
      scanGeneration: 3,
      optionsFingerprint: "metadata:0:0:0",
    });
    accumulator.apply(batch(1, upsert(1, { state: "pending", reason: "awaitingHash" })));

    const applied = accumulator.apply({
      event: "terminal",
      jobId: 9,
      scanGeneration: 3,
      sequence: 2,
      data: {
        outcome: "completed",
        stats: {
          same: 1,
          different: 0,
          leftOnly: 0,
          rightOnly: 0,
          typeMismatch: 0,
          errors: 0,
        },
        entryCount: 1,
        durationMs: 10,
      },
    });

    expect(applied.outcome).toBe("protocolError");
    expect(accumulator.snapshot().pendingCount).toBe(1);
  });

  it("rejects every late message after local cancellation invalidates the accumulator", () => {
    const accumulator = createFolderScanAccumulator({
      jobId: 9,
      scanGeneration: 3,
      optionsFingerprint: "metadata:0:0:0",
    });
    accumulator.apply(batch(1, upsert(1, { state: "pending", reason: "awaitingPeer" })));
    accumulator.invalidate();

    expect(accumulator.apply(batch(2, upsert(2, {
      state: "final",
      status: "leftOnly",
    }))).outcome).toBe("stale");
    expect(accumulator.snapshot().pendingCount).toBe(1);
    expect(accumulator.snapshot().entries).toHaveLength(0);
  });

  it("keeps rapid generations isolated even when old batches arrive last", () => {
    const oldScan = createFolderScanAccumulator({
      jobId: 9,
      scanGeneration: 3,
      optionsFingerprint: "metadata:0:0:0",
    });
    const newScan = createFolderScanAccumulator({
      jobId: 10,
      scanGeneration: 4,
      optionsFingerprint: "fullHash:0:0:0",
    });
    oldScan.invalidate();

    expect(newScan.apply({
      ...batch(1, upsert(1, { state: "final", status: "same" })),
      jobId: 10,
      scanGeneration: 4,
    }).outcome).toBe("applied");
    expect(newScan.apply(batch(2, upsert(2, {
      state: "final",
      status: "different",
    }))).outcome).toBe("stale");
    expect(newScan.snapshot().finalCounts.same).toBe(1);
    expect(newScan.snapshot().finalCounts.different).toBe(0);
  });
});
