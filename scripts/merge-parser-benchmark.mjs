import { performance } from "node:perf_hooks";

const cases = [
  { id: "parser-30x3", conflicts: 30, linesPerSide: 3, iterations: 100 },
  { id: "parser-100x5", conflicts: 100, linesPerSide: 5, iterations: 50 },
  { id: "parser-300x5", conflicts: 300, linesPerSide: 5, iterations: 20 },
];

const results = cases.map((benchmarkCase) => {
  const text = buildMergeBenchmarkText(benchmarkCase);
  return runBenchmark(text, benchmarkCase);
});

console.log(JSON.stringify({
  issue: "MRG-011",
  benchmark: "merge parser",
  command: "node scripts/merge-parser-benchmark.mjs",
  node: process.version,
  cases: results,
}, null, 2));

function buildMergeBenchmarkText({ conflicts, linesPerSide }) {
  const parts = ["// forktail merge benchmark fixture\n"];

  for (let index = 1; index <= conflicts; index += 1) {
    parts.push(`stable prefix ${index}\n`);
    parts.push("<<<<<<< ours\n");
    parts.push(sideLines("ours", index, linesPerSide));
    parts.push("||||||| original\n");
    parts.push(sideLines("base", index, linesPerSide));
    parts.push("=======\n");
    parts.push(sideLines("theirs", index, linesPerSide));
    parts.push(">>>>>>> theirs\n");
    parts.push(`stable suffix ${index}\n`);
  }

  return parts.join("");
}

function runBenchmark(text, benchmarkCase) {
  const expectedConflictCount = benchmarkCase.conflicts;
  const started = performance.now();
  let conflictCount = 0;

  for (let iteration = 0; iteration < benchmarkCase.iterations; iteration += 1) {
    conflictCount = parseConflictBlocks(text).length;
    if (conflictCount !== expectedConflictCount) {
      throw new Error(
        `${benchmarkCase.id}: expected ${expectedConflictCount} conflicts, got ${conflictCount}`,
      );
    }
  }

  const totalMs = performance.now() - started;
  return {
    id: benchmarkCase.id,
    conflicts: conflictCount,
    linesPerSide: benchmarkCase.linesPerSide,
    bytes: Buffer.byteLength(text, "utf8"),
    iterations: benchmarkCase.iterations,
    totalMs: Number(totalMs.toFixed(3)),
    averageMs: Number((totalMs / benchmarkCase.iterations).toFixed(3)),
  };
}

function parseConflictBlocks(text) {
  const lines = tokenizeLines(text);
  const conflicts = [];
  let index = 0;

  while (index < lines.length) {
    if (markerValue(lines[index].content) !== "<<<<<<< ours") {
      index += 1;
      continue;
    }

    let baseIndex = -1;
    let separatorIndex = -1;
    let endIndex = -1;
    let restartIndex = -1;

    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const marker = markerValue(lines[cursor].content);
      if (marker === "<<<<<<< ours") {
        restartIndex = cursor;
        break;
      }
      if (baseIndex === -1 && marker === "||||||| original") {
        baseIndex = cursor;
      } else if (baseIndex !== -1 && separatorIndex === -1 && marker === "=======") {
        separatorIndex = cursor;
      } else if (separatorIndex !== -1 && marker === ">>>>>>> theirs") {
        endIndex = cursor;
        break;
      }
    }

    if (restartIndex !== -1) {
      index = restartIndex;
      continue;
    }
    if (baseIndex === -1 || separatorIndex === -1 || endIndex === -1) {
      index += 1;
      continue;
    }

    conflicts.push({ id: conflicts.length + 1 });
    index = endIndex + 1;
  }

  return conflicts;
}

function tokenizeLines(text) {
  const tokens = [];
  let offset = 0;

  while (offset < text.length) {
    let cursor = offset;
    while (cursor < text.length && text[cursor] !== "\n" && text[cursor] !== "\r") {
      cursor += 1;
    }

    const endOffset = cursor >= text.length
      ? text.length
      : text[cursor] === "\r" && text[cursor + 1] === "\n"
        ? cursor + 2
        : cursor + 1;
    tokens.push({ content: text.slice(offset, endOffset) });
    offset = endOffset;
  }

  return tokens;
}

function markerValue(line) {
  return line.replace(/\r\n$|\r$|\n$/, "");
}

function sideLines(label, conflictIndex, lines) {
  return Array.from({ length: lines }, (_, lineIndex) =>
    `${label} conflict ${conflictIndex} line ${lineIndex + 1}\n`,
  ).join("");
}
