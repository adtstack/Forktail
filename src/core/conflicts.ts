import type { ConflictBlock } from "./models";

const START = "<<<<<<< ours";
const BASE = "||||||| original";
const SEPARATOR = "=======";
const END = ">>>>>>> theirs";

interface LineToken {
  content: string;
  startOffset: number;
  endOffset: number;
  lineNumber: number;
}

function tokenizeLines(text: string): LineToken[] {
  const tokens: LineToken[] = [];
  let offset = 0;
  let lineNumber = 1;

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
    tokens.push({
      content: text.slice(offset, endOffset),
      startOffset: offset,
      endOffset,
      lineNumber,
    });
    offset = endOffset;
    lineNumber += 1;
  }

  if (text.length === 0) return [];
  return tokens;
}

function markerValue(line: string): string {
  return line.replace(/\r\n$|\r$|\n$/, "");
}

export function parseConflictBlocks(text: string): ConflictBlock[] {
  const lines = tokenizeLines(text);
  const conflicts: ConflictBlock[] = [];

  let index = 0;
  while (index < lines.length) {
    if (markerValue(lines[index].content) !== START) {
      index += 1;
      continue;
    }

    const startIndex = index;
    let baseIndex = -1;
    let separatorIndex = -1;
    let endIndex = -1;
    let restartIndex = -1;

    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const marker = markerValue(lines[cursor].content);
      if (marker === START) {
        restartIndex = cursor;
        break;
      }
      if (baseIndex === -1 && marker === BASE) {
        baseIndex = cursor;
      } else if (baseIndex !== -1 && separatorIndex === -1 && marker === SEPARATOR) {
        separatorIndex = cursor;
      } else if (separatorIndex !== -1 && marker === END) {
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

    const startOffset = lines[startIndex].startOffset;
    const endOffset = lines[endIndex].endOffset;
    conflicts.push({
      id: conflicts.length + 1,
      startOffset,
      endOffset,
      startLine: lines[startIndex].lineNumber,
      endLine: lines[endIndex].lineNumber,
      ours: lines.slice(startIndex + 1, baseIndex).map((line) => line.content).join(""),
      base: lines.slice(baseIndex + 1, separatorIndex).map((line) => line.content).join(""),
      theirs: lines.slice(separatorIndex + 1, endIndex).map((line) => line.content).join(""),
      raw: text.slice(startOffset, endOffset),
    });

    index = endIndex + 1;
  }

  return conflicts;
}

export function hasUnresolvedConflicts(text: string): boolean {
  return parseConflictBlocks(text).length > 0;
}

export type ConflictResolution = "ours" | "base" | "theirs" | "both";

export function resolveConflict(
  text: string,
  conflict: ConflictBlock,
  resolution: ConflictResolution,
): string {
  let replacement: string;
  switch (resolution) {
    case "ours":
      replacement = conflict.ours;
      break;
    case "base":
      replacement = conflict.base;
      break;
    case "theirs":
      replacement = conflict.theirs;
      break;
    case "both":
      replacement = joinBoth(conflict.ours, conflict.theirs);
      break;
  }

  return `${text.slice(0, conflict.startOffset)}${replacement}${text.slice(conflict.endOffset)}`;
}

function joinBoth(ours: string, theirs: string): string {
  if (!ours) return theirs;
  if (!theirs) return ours;
  if (ours.endsWith("\n") || theirs.startsWith("\n")) return `${ours}${theirs}`;
  return `${ours}\n${theirs}`;
}
