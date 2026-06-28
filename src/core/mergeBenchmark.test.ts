import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseConflictBlocks } from "./conflicts";
import {
  buildMergeBenchmarkText,
  runMergeParserBenchmark,
} from "./mergeBenchmark";

describe("merge parser benchmark fixture", () => {
  it("generates a deterministic 30-conflict benchmark result", () => {
    const text = buildMergeBenchmarkText({ conflicts: 30, linesPerSide: 3 });
    const conflicts = parseConflictBlocks(text);

    expect(conflicts).toHaveLength(30);
    expect(conflicts[0]).toMatchObject({
      id: 1,
      ours: "ours conflict 1 line 1\nours conflict 1 line 2\nours conflict 1 line 3\n",
      base: "base conflict 1 line 1\nbase conflict 1 line 2\nbase conflict 1 line 3\n",
      theirs: "theirs conflict 1 line 1\ntheirs conflict 1 line 2\ntheirs conflict 1 line 3\n",
    });
    expect(conflicts[29].id).toBe(30);
  });

  it("records parser benchmark metadata without depending on wall-clock speed", () => {
    const text = buildMergeBenchmarkText({ conflicts: 30, linesPerSide: 2 });
    const timestamps = [100, 124];

    const result = runMergeParserBenchmark(text, {
      iterations: 6,
      expectedConflictCount: 30,
      now: () => timestamps.shift() ?? 124,
    });

    expect(result).toEqual({
      bytes: new TextEncoder().encode(text).byteLength,
      conflicts: 30,
      iterations: 6,
      totalMs: 24,
      averageMs: 4,
    });
  });

  it("fails fast if parsing loses conflicts during benchmark iterations", () => {
    const text = buildMergeBenchmarkText({ conflicts: 2, linesPerSide: 1 });

    expect(() =>
      runMergeParserBenchmark(text, {
        iterations: 1,
        expectedConflictCount: 3,
        now: () => 0,
      }),
    ).toThrow("Expected 3 conflicts, got 2");
  });

  it("keeps a stored latency baseline aligned with generated fixture sizes", () => {
    const baseline = JSON.parse(
      readFileSync(
        new URL("../../docs/benchmarks/merge-parser-baseline.json", import.meta.url),
        "utf8",
      ),
    ) as {
      issue: string;
      cases: Array<{
        id: string;
        conflicts: number;
        linesPerSide: number;
        bytes: number;
        iterations: number;
        averageMs: number;
      }>;
    };

    expect(baseline.issue).toBe("MRG-011");
    expect(baseline.cases.map((entry) => entry.id)).toEqual([
      "parser-30x3",
      "parser-100x5",
      "parser-300x5",
    ]);

    for (const entry of baseline.cases) {
      const text = buildMergeBenchmarkText({
        conflicts: entry.conflicts,
        linesPerSide: entry.linesPerSide,
      });
      expect(new TextEncoder().encode(text).byteLength).toBe(entry.bytes);
      expect(parseConflictBlocks(text)).toHaveLength(entry.conflicts);
      expect(entry.iterations).toBeGreaterThan(0);
      expect(entry.averageMs).toBeGreaterThan(0);
    }
  });
});
