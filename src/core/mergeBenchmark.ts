import { parseConflictBlocks } from "./conflicts";

export interface MergeBenchmarkTextOptions {
  conflicts: number;
  linesPerSide: number;
}

export interface MergeParserBenchmarkOptions {
  iterations?: number;
  expectedConflictCount?: number;
  now?: () => number;
}

export interface MergeParserBenchmarkResult {
  bytes: number;
  conflicts: number;
  iterations: number;
  totalMs: number;
  averageMs: number;
}

export function buildMergeBenchmarkText({
  conflicts,
  linesPerSide,
}: MergeBenchmarkTextOptions): string {
  const normalizedConflicts = Math.max(0, Math.trunc(conflicts));
  const normalizedLines = Math.max(1, Math.trunc(linesPerSide));
  const parts = ["// forktail merge benchmark fixture\n"];

  for (let index = 1; index <= normalizedConflicts; index += 1) {
    parts.push(`stable prefix ${index}\n`);
    parts.push("<<<<<<< ours\n");
    parts.push(sideLines("ours", index, normalizedLines));
    parts.push("||||||| original\n");
    parts.push(sideLines("base", index, normalizedLines));
    parts.push("=======\n");
    parts.push(sideLines("theirs", index, normalizedLines));
    parts.push(">>>>>>> theirs\n");
    parts.push(`stable suffix ${index}\n`);
  }

  return parts.join("");
}

export function runMergeParserBenchmark(
  text: string,
  options: MergeParserBenchmarkOptions = {},
): MergeParserBenchmarkResult {
  const iterations = Math.max(1, Math.trunc(options.iterations ?? 1));
  const expectedConflictCount = options.expectedConflictCount ?? parseConflictBlocks(text).length;
  const now = options.now ?? (() => performance.now());
  const started = now();
  let conflictCount = 0;

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    conflictCount = parseConflictBlocks(text).length;
    if (conflictCount !== expectedConflictCount) {
      throw new Error(
        `Expected ${expectedConflictCount} conflicts, got ${conflictCount} on iteration ${iteration + 1}`,
      );
    }
  }

  const totalMs = Math.max(0, now() - started);

  return {
    bytes: new TextEncoder().encode(text).byteLength,
    conflicts: conflictCount,
    iterations,
    totalMs,
    averageMs: totalMs / iterations,
  };
}

function sideLines(label: string, conflictIndex: number, lines: number): string {
  return Array.from({ length: lines }, (_, lineIndex) =>
    `${label} conflict ${conflictIndex} line ${lineIndex + 1}\n`,
  ).join("");
}
