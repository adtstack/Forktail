import { normalizeTextForDiff, type TextDiffOptions } from "./diffOptions";
import type { CompareSession } from "./models";

type LineOperationKind = "equal" | "removed" | "added";

interface ReportLine {
  text: string;
  key: string;
}

interface LineOperation {
  kind: LineOperationKind;
  text: string;
  leftLine: number | null;
  rightLine: number | null;
}

interface HunkRange {
  start: number;
  end: number;
}

export interface DiffReportInput {
  session: CompareSession;
  options: TextDiffOptions;
  generatedAt?: Date;
}

export function compareReportDefaultPath(session: CompareSession): string | undefined {
  if (session.origin !== "files") return undefined;
  return `${session.right.path}.diff.txt`;
}

export function buildDiffReport({ session, options, generatedAt }: DiffReportInput): string {
  const operations = diffLines(session.left.text, session.right.text, options);
  const hunks = groupChangedOperations(operations, 3);
  const lines = [
    "forktail diff report",
    generatedAt ? `Generated: ${generatedAt.toISOString()}` : null,
    `Left: ${session.left.path}`,
    `Right: ${session.right.path}`,
    `Options: whitespace=${options.whitespace}, ignoreCase=${options.ignoreCase}, ignoreEOL=${options.ignoreLineEndings}`,
    `Left metadata: ${session.left.encoding}, ${session.left.lineEnding.toUpperCase()}, final newline ${session.left.hadFinalNewline ? "yes" : "no"}, ${session.left.size} bytes`,
    `Right metadata: ${session.right.encoding}, ${session.right.lineEnding.toUpperCase()}, final newline ${session.right.hadFinalNewline ? "yes" : "no"}, ${session.right.size} bytes`,
    "",
    `--- ${session.left.path}`,
    `+++ ${session.right.path}`,
  ].filter((line): line is string => line != null);

  if (hunks.length === 0) {
    lines.push("(no line changes under current options)");
    return `${lines.join("\n")}\n`;
  }

  for (const hunk of hunks) {
    lines.push(hunkHeader(operations, hunk));
    for (let index = hunk.start; index <= hunk.end; index += 1) {
      const operation = operations[index];
      lines.push(formatOperation(operation));
      if (shouldMarkNoFinalNewline(operation, session)) {
        lines.push("\\ No newline at end of file");
      }
    }
  }

  return `${lines.join("\n")}\n`;
}

function diffLines(leftText: string, rightText: string, options: TextDiffOptions): LineOperation[] {
  const left = reportLines(leftText, options);
  const right = reportLines(rightText, options);
  const table = lcsTable(left, right);
  const operations: LineOperation[] = [];
  let leftIndex = 0;
  let rightIndex = 0;

  while (leftIndex < left.length && rightIndex < right.length) {
    if (left[leftIndex].key === right[rightIndex].key) {
      operations.push({
        kind: "equal",
        text: left[leftIndex].text,
        leftLine: leftIndex + 1,
        rightLine: rightIndex + 1,
      });
      leftIndex += 1;
      rightIndex += 1;
    } else if (table[leftIndex + 1][rightIndex] >= table[leftIndex][rightIndex + 1]) {
      operations.push({
        kind: "removed",
        text: left[leftIndex].text,
        leftLine: leftIndex + 1,
        rightLine: null,
      });
      leftIndex += 1;
    } else {
      operations.push({
        kind: "added",
        text: right[rightIndex].text,
        leftLine: null,
        rightLine: rightIndex + 1,
      });
      rightIndex += 1;
    }
  }

  while (leftIndex < left.length) {
    operations.push({
      kind: "removed",
      text: left[leftIndex].text,
      leftLine: leftIndex + 1,
      rightLine: null,
    });
    leftIndex += 1;
  }

  while (rightIndex < right.length) {
    operations.push({
      kind: "added",
      text: right[rightIndex].text,
      leftLine: null,
      rightLine: rightIndex + 1,
    });
    rightIndex += 1;
  }

  return operations;
}

function reportLines(text: string, options: TextDiffOptions): ReportLine[] {
  if (text.length === 0) return [];
  return text.replace(/\r\n?/g, "\n").split("\n").filter((line, index, lines) => {
    return index < lines.length - 1 || line.length > 0;
  }).map((line) => ({
    text: line,
    key: normalizeTextForDiff(line, options),
  }));
}

function lcsTable(left: ReportLine[], right: ReportLine[]): number[][] {
  const table = Array.from({ length: left.length + 1 }, () => Array(right.length + 1).fill(0));

  for (let leftIndex = left.length - 1; leftIndex >= 0; leftIndex -= 1) {
    for (let rightIndex = right.length - 1; rightIndex >= 0; rightIndex -= 1) {
      table[leftIndex][rightIndex] = left[leftIndex].key === right[rightIndex].key
        ? table[leftIndex + 1][rightIndex + 1] + 1
        : Math.max(table[leftIndex + 1][rightIndex], table[leftIndex][rightIndex + 1]);
    }
  }

  return table;
}

function groupChangedOperations(operations: LineOperation[], context: number): HunkRange[] {
  const hunks: HunkRange[] = [];

  for (let index = 0; index < operations.length; index += 1) {
    if (operations[index].kind === "equal") continue;
    const start = Math.max(0, index - context);
    let end = Math.min(operations.length - 1, index + context);

    while (index + 1 < operations.length && operations[index + 1].kind !== "equal") {
      index += 1;
      end = Math.min(operations.length - 1, index + context);
    }

    const previous = hunks[hunks.length - 1];
    if (previous && start <= previous.end + 1) {
      previous.end = Math.max(previous.end, end);
    } else {
      hunks.push({ start, end });
    }
  }

  return hunks;
}

function hunkHeader(operations: LineOperation[], hunk: HunkRange): string {
  const before = operations.slice(0, hunk.start);
  const inside = operations.slice(hunk.start, hunk.end + 1);
  const leftStart = consumedLeftLines(before) + 1;
  const rightStart = consumedRightLines(before) + 1;
  const leftCount = consumedLeftLines(inside);
  const rightCount = consumedRightLines(inside);
  return `@@ -${leftStart},${leftCount} +${rightStart},${rightCount} @@`;
}

function consumedLeftLines(operations: LineOperation[]): number {
  return operations.filter((operation) => operation.kind !== "added").length;
}

function consumedRightLines(operations: LineOperation[]): number {
  return operations.filter((operation) => operation.kind !== "removed").length;
}

function formatOperation(operation: LineOperation): string {
  if (operation.kind === "added") return `+${operation.text}`;
  if (operation.kind === "removed") return `-${operation.text}`;
  return ` ${operation.text}`;
}

function shouldMarkNoFinalNewline(operation: LineOperation, session: CompareSession): boolean {
  return (
    operation.kind === "removed" &&
    operation.leftLine != null &&
    operation.leftLine === lineCount(session.left.text) &&
    !session.left.hadFinalNewline
  ) || (
    operation.kind === "added" &&
    operation.rightLine != null &&
    operation.rightLine === lineCount(session.right.text) &&
    !session.right.hadFinalNewline
  );
}

function lineCount(text: string): number {
  return reportLines(text, { whitespace: "none", ignoreCase: false, ignoreLineEndings: true }).length;
}
