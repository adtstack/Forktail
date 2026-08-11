import { DefaultLinesDiffComputer } from
  "monaco-editor/esm/vs/editor/common/diff/defaultLinesDiffComputer/defaultLinesDiffComputer.js";
import { comparisonLinesForText, type TextDiffOptions } from "./diffOptions";

interface ExactTextDiffLineChange {
  originalStartLineNumber: number;
  originalEndLineNumberExclusive: number;
  modifiedStartLineNumber: number;
  modifiedEndLineNumberExclusive: number;
}

const diffComputer = new DefaultLinesDiffComputer();

export interface ExactTextLineDiff {
  changes: ExactTextDiffLineChange[];
  quitEarly: boolean;
}

export function computeExactTextLineDiff(
  left: string,
  right: string,
  options: TextDiffOptions,
  maxComputationTimeMs: number,
): ExactTextLineDiff {
  const result = diffComputer.computeDiff(
    comparisonLinesForText(left, options),
    comparisonLinesForText(right, options),
    {
      computeMoves: false,
      extendToSubwords: false,
      ignoreTrimWhitespace: false,
      maxComputationTimeMs,
    },
  );

  return {
    changes: result.changes.map((change) => ({
      originalStartLineNumber: change.original.startLineNumber,
      originalEndLineNumberExclusive: change.original.endLineNumberExclusive,
      modifiedStartLineNumber: change.modified.startLineNumber,
      modifiedEndLineNumberExclusive: change.modified.endLineNumberExclusive,
    })),
    quitEarly: result.hitTimeout,
  };
}
