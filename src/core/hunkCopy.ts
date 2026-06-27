export interface HunkLineChange {
  originalStartLineNumber: number;
  originalEndLineNumber: number;
  modifiedStartLineNumber: number;
  modifiedEndLineNumber: number;
}

interface NormalizedRange {
  start: number;
  end: number;
}

export function applyOriginalHunkToModified(
  originalText: string,
  modifiedText: string,
  change: HunkLineChange,
): string {
  return applyHunkText(
    originalText,
    modifiedText,
    {
      startLineNumber: change.originalStartLineNumber,
      endLineNumber: change.originalEndLineNumber,
    },
    {
      startLineNumber: change.modifiedStartLineNumber,
      endLineNumber: change.modifiedEndLineNumber,
    },
  );
}

export function applyModifiedHunkToOriginal(
  originalText: string,
  modifiedText: string,
  change: HunkLineChange,
): string {
  return applyHunkText(
    modifiedText,
    originalText,
    {
      startLineNumber: change.modifiedStartLineNumber,
      endLineNumber: change.modifiedEndLineNumber,
    },
    {
      startLineNumber: change.originalStartLineNumber,
      endLineNumber: change.originalEndLineNumber,
    },
  );
}

function applyHunkText(
  sourceText: string,
  targetText: string,
  sourceLineRange: { startLineNumber: number; endLineNumber: number },
  targetLineRange: { startLineNumber: number; endLineNumber: number },
): string {
  const sourceLines = splitLinesWithEndings(sourceText);
  const targetLines = splitLinesWithEndings(targetText);
  const sourceRange = normalizeLineRange(
    sourceLineRange.startLineNumber,
    sourceLineRange.endLineNumber,
    sourceLines.length,
  );
  const targetRange = normalizeLineRange(
    targetLineRange.startLineNumber,
    targetLineRange.endLineNumber,
    targetLines.length,
  );
  const replacementLines = sourceLines.slice(sourceRange.start, sourceRange.end);
  const nextLines = [
    ...targetLines.slice(0, targetRange.start),
    ...replacementLines,
    ...targetLines.slice(targetRange.end),
  ];

  return nextLines.join("");
}

function splitLinesWithEndings(text: string): string[] {
  if (text.length === 0) return [];
  const lines = text.match(/[^\r\n]*(?:\r\n|\n|\r|$)/g) ?? [];
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

function normalizeLineRange(startLineNumber: number, endLineNumber: number, totalLines: number): NormalizedRange {
  if (startLineNumber <= 0 && endLineNumber <= 0) {
    return { start: 0, end: 0 };
  }

  if (startLineNumber <= 0) {
    const insertionIndex = clamp(endLineNumber, 0, totalLines);
    return { start: insertionIndex, end: insertionIndex };
  }

  const start = clamp(startLineNumber - 1, 0, totalLines);
  if (endLineNumber < startLineNumber) {
    return { start, end: start };
  }

  const end = clamp(endLineNumber, start, totalLines);
  return { start, end };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
