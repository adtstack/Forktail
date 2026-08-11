export type WhitespaceCompareMode = "none" | "trim" | "all";

export interface TextDiffOptions {
  whitespace: WhitespaceCompareMode;
  ignoreCase: boolean;
  ignoreLineEndings: boolean;
}

export const DEFAULT_TEXT_DIFF_OPTIONS: TextDiffOptions = {
  whitespace: "none",
  ignoreCase: false,
  ignoreLineEndings: false,
};

export interface PreparedDiffTexts {
  left: string;
  right: string;
}

export interface ComparisonColumnSegment {
  comparisonStart: number;
  comparisonEnd: number;
  sourceStart: number;
  sourceEnd: number;
}

export interface ComparisonLineColumnMap {
  sourceLength: number;
  comparisonContentLength: number;
  comparisonLength: number;
  exact: boolean;
  segments: ComparisonColumnSegment[];
}

export interface ComparisonTextWithColumnMaps {
  lines: string[];
  columnMaps: ComparisonLineColumnMap[];
}

const EOL_COMPARISON_MARKERS: Record<"lf" | "crlf" | "cr", string> = {
  lf: "\u0000LF",
  crlf: "\u0000CRLF",
  cr: "\u0000CR",
};
const MAX_EXACT_COLUMN_SEGMENTS = 4_096;

export function prepareDiffTexts(
  left: string,
  right: string,
  options: TextDiffOptions,
): PreparedDiffTexts {
  return {
    left: normalizeTextForDiff(left, options),
    right: normalizeTextForDiff(right, options),
  };
}

export function normalizeTextForDiff(text: string, options: TextDiffOptions): string {
  let normalized = options.ignoreLineEndings ? text.replace(/\r\n?/g, "\n") : text;

  if (options.whitespace === "trim") {
    normalized = normalized.replace(/[ \t\f\v]+(?=\r?\n|\r|$)/g, "");
  } else if (options.whitespace === "all") {
    normalized = normalized.replace(/[ \t\f\v]+/g, "");
  }

  if (options.ignoreCase) {
    normalized = normalized.toLowerCase();
  }

  return normalized;
}

/**
 * Builds comparison-only line tokens without changing the source text or its line indexes.
 * Monaco must continue to own models created from the exact source strings; these tokens are
 * intended for the worker-backed diff provider only.
 */
export function comparisonLinesForText(
  text: string,
  options: TextDiffOptions,
): string[] {
  return comparisonTextWithColumnMaps(text, options).lines;
}

export function comparisonTextWithColumnMaps(
  text: string,
  options: TextDiffOptions,
): ComparisonTextWithColumnMaps {
  const lines: string[] = [];
  const columnMaps: ComparisonLineColumnMap[] = [];
  const lineBreak = /\r\n|\r|\n/g;
  let lineStart = 0;
  let match: RegExpExecArray | null;

  while ((match = lineBreak.exec(text)) !== null) {
    appendComparisonLine(
      lines,
      columnMaps,
      text.slice(lineStart, match.index),
      options,
      options.ignoreLineEndings ? "" : eolComparisonMarker(match[0]),
    );
    lineStart = match.index + match[0].length;
  }

  appendComparisonLine(
    lines,
    columnMaps,
    text.slice(lineStart),
    options,
    "",
  );
  return { lines, columnMaps };
}

export function hasComparisonIgnores(options: TextDiffOptions): boolean {
  return options.whitespace !== "none" || options.ignoreCase || options.ignoreLineEndings;
}

function appendComparisonLine(
  lines: string[],
  columnMaps: ComparisonLineColumnMap[],
  source: string,
  options: TextDiffOptions,
  syntheticSuffix: string,
): void {
  const mapped = normalizeLineContentWithColumnMap(source, options);
  lines.push(`${mapped.text}${syntheticSuffix}`);
  columnMaps.push({
    sourceLength: source.length,
    comparisonContentLength: mapped.text.length,
    comparisonLength: mapped.text.length + syntheticSuffix.length,
    exact: mapped.exact,
    segments: mapped.segments,
  });
}

function normalizeLineContentWithColumnMap(
  source: string,
  options: TextDiffOptions,
): {
  text: string;
  exact: boolean;
  segments: ComparisonColumnSegment[];
} {
  const trimMatch = options.whitespace === "trim"
    ? /[ \t\f\v]+$/.exec(source)
    : null;
  const retainedEnd = trimMatch?.index ?? source.length;
  const retained = options.whitespace === "all"
    ? source.replace(/[ \t\f\v]+/g, "")
    : source.slice(0, retainedEnd);
  const normalized = options.ignoreCase ? retained.toLowerCase() : retained;
  const segments: ComparisonColumnSegment[] = [];
  const caseMappingPreservesLength = normalized.length === retained.length;
  let comparisonOffset = 0;
  for (let sourceStart = 0; sourceStart < source.length;) {
    const codePoint = source.codePointAt(sourceStart);
    if (codePoint === undefined) break;
    const character = String.fromCodePoint(codePoint);
    const sourceEnd = sourceStart + character.length;
    const removed = sourceStart >= retainedEnd ||
      (options.whitespace === "all" && isHorizontalComparisonWhitespace(character));
    if (removed) {
      sourceStart = sourceEnd;
      continue;
    }

    const transformedLength = options.ignoreCase && !caseMappingPreservesLength
      ? character.toLowerCase().length
      : character.length;
    const comparisonEnd = comparisonOffset + transformedLength;
    const previous = segments.at(-1);
    if (
      previous &&
      previous.comparisonEnd === comparisonOffset &&
      previous.sourceEnd === sourceStart &&
      previous.comparisonEnd - previous.comparisonStart ===
        previous.sourceEnd - previous.sourceStart &&
      transformedLength === sourceEnd - sourceStart
    ) {
      previous.comparisonEnd = comparisonEnd;
      previous.sourceEnd = sourceEnd;
    } else {
      segments.push({
        comparisonStart: comparisonOffset,
        comparisonEnd,
        sourceStart,
        sourceEnd,
      });
      if (segments.length > MAX_EXACT_COLUMN_SEGMENTS) {
        return { text: normalized, exact: false, segments: [] };
      }
    }
    comparisonOffset = comparisonEnd;
    sourceStart = sourceEnd;
  }

  const exact = comparisonOffset === normalized.length;
  return { text: normalized, exact, segments: exact ? segments : [] };
}

function isHorizontalComparisonWhitespace(character: string): boolean {
  return character === " " || character === "\t" || character === "\f" || character === "\v";
}

function eolComparisonMarker(lineEnding: string): string {
  if (lineEnding === "\r\n") return EOL_COMPARISON_MARKERS.crlf;
  if (lineEnding === "\r") return EOL_COMPARISON_MARKERS.cr;
  return EOL_COMPARISON_MARKERS.lf;
}
