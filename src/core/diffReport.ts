import { normalizeTextForDiff, type TextDiffOptions } from "./diffOptions";
import { gitSnapshotPatchAvailability } from "./gitSession";
import type {
  CompareSession,
  FileVersion,
  GitFileCompareSession,
  WriteResult,
} from "./models";
import type { GitRevision, GitSnapshotDocument } from "./gitModels";
import type { WritePrecondition } from "./mergeSave";

type LineOperationKind = "equal" | "removed" | "added";

const MAX_LCS_CELLS = 250_000;

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

interface DiffSourcePair {
  left: { text: string; hadFinalNewline: boolean };
  right: { text: string; hadFinalNewline: boolean };
}

interface DiffLineCounts {
  left: number;
  right: number;
}

export interface DiffReportInput {
  session: CompareSession;
  options: TextDiffOptions;
  generatedAt?: Date;
}

export interface GitSnapshotPatchWriteRequest {
  path: string;
  text: string;
  precondition: WritePrecondition | null;
  expectedAbsent: boolean;
}

export interface GitSnapshotPatchSaveDependencies {
  chooseOutputPath: (defaultPath: string) => Promise<string | null>;
  inspectOutput: (path: string) => Promise<FileVersion | null>;
  writeOutput: (request: GitSnapshotPatchWriteRequest) => Promise<WriteResult>;
}

export type GitSnapshotPatchSaveResult =
  | { kind: "cancelled" }
  | { kind: "saved"; writeResult: WriteResult };

export function compareReportDefaultPath(session: CompareSession): string | undefined {
  if (session.origin !== "files") return undefined;
  return `${session.right.path}.diff.txt`;
}

export function buildDiffReport({ session, options, generatedAt }: DiffReportInput): string {
  const operations = diffLines(session.left.text, session.right.text, options);
  const hunks = groupChangedOperations(operations, 3);
  const finalLineCounts = diffLineCounts(session);
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
      if (shouldMarkNoFinalNewline(operation, session, finalLineCounts)) {
        lines.push("\\ No newline at end of file");
      }
    }
  }

  return `${lines.join("\n")}\n`;
}

export function gitSnapshotPatchDefaultPath(session: GitFileCompareSession): string {
  const snapshot = session.snapshot;
  const preferred = snapshot.right.contentState.kind === "missing"
    ? snapshot.left.path?.displayPath
    : snapshot.right.path?.displayPath;
  const basename = (preferred ?? "snapshot")
    .split(/[\\/]/)
    .at(-1)
    ?.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .trim();
  return `forktail-${basename || "snapshot"}.patch`;
}

export async function saveGitSnapshotPatchAs(
  session: GitFileCompareSession,
  dependencies: GitSnapshotPatchSaveDependencies,
): Promise<GitSnapshotPatchSaveResult> {
  const patch = buildGitSnapshotPatch(session);
  const outputPath = await dependencies.chooseOutputPath(gitSnapshotPatchDefaultPath(session));
  if (outputPath === null) return { kind: "cancelled" };

  const version = await dependencies.inspectOutput(outputPath);
  const writeResult = await dependencies.writeOutput({
    path: outputPath,
    text: patch,
    precondition: version === null
      ? null
      : {
          expectedSize: version.size,
          expectedModifiedMs: version.modifiedMs,
          expectedContentHash: version.contentHash,
        },
    expectedAbsent: version === null,
  });
  return { kind: "saved", writeResult };
}

export function buildGitSnapshotPatch(session: GitFileCompareSession): string {
  const snapshot = session.snapshot;
  const availability = gitSnapshotPatchAvailability(snapshot);
  if (availability.kind === "blocked") {
    throw new Error(`Git snapshot patch export is unavailable: ${availability.reason}`);
  }

  const leftMissing = snapshot.left.contentState.kind === "missing";
  const rightMissing = snapshot.right.contentState.kind === "missing";
  const leftDisplayPath = leftMissing
    ? "/dev/null"
    : snapshot.left.path?.displayPath ?? snapshot.left.label;
  const rightDisplayPath = rightMissing
    ? "/dev/null"
    : snapshot.right.path?.displayPath ?? snapshot.right.label;
  const fallbackPath = snapshot.left.path?.displayPath
    ?? snapshot.right.path?.displayPath
    ?? "snapshot";
  const oldPatchPath = patchPath("a", leftMissing ? fallbackPath : leftDisplayPath);
  const newPatchPath = patchPath("b", rightMissing ? fallbackPath : rightDisplayPath);
  const patchSources: DiffSourcePair = {
    left: {
      text: snapshot.left.contentState.kind === "text"
        ? snapshot.left.contentState.text
        : "",
      hadFinalNewline: snapshot.left.textMetadata?.hadFinalNewline ?? true,
    },
    right: {
      text: snapshot.right.contentState.kind === "text"
        ? snapshot.right.contentState.text
        : "",
      hadFinalNewline: snapshot.right.textMetadata?.hadFinalNewline ?? true,
    },
  };
  const operations = diffLines(patchSources.left.text, patchSources.right.text, {
    whitespace: "none",
    ignoreCase: false,
    ignoreLineEndings: false,
  });
  const finalLineCounts = diffLineCounts(patchSources);
  const hunks = groupChangedOperations(operations, 3);
  const renamed = !leftMissing && !rightMissing && leftDisplayPath !== rightDisplayPath;
  const contentEqual = patchSources.left.text === patchSources.right.text;
  const modeEqual = snapshot.left.mode === snapshot.right.mode;
  const lines = [
    "# Forktail immutable Git snapshot patch",
    `# Left revision: ${revisionIdentity(snapshot, "left")}`,
    `# Right revision: ${revisionIdentity(snapshot, "right")}`,
    `# Left path: ${headerValue(leftDisplayPath)}`,
    `# Right path: ${headerValue(rightDisplayPath)}`,
    "# Output encoding: UTF-8",
  ];
  const encodingWarning = gitPatchEncodingWarning(snapshot.left, snapshot.right);
  if (encodingWarning) lines.push(encodingWarning);
  lines.push(`diff --git ${oldPatchPath} ${newPatchPath}`);

  if (leftMissing && snapshot.right.mode) {
    lines.push(`new file mode ${snapshot.right.mode}`);
  } else if (rightMissing && snapshot.left.mode) {
    lines.push(`deleted file mode ${snapshot.left.mode}`);
  } else if (!modeEqual) {
    if (snapshot.left.mode) lines.push(`old mode ${snapshot.left.mode}`);
    if (snapshot.right.mode) lines.push(`new mode ${snapshot.right.mode}`);
  }

  if (renamed) {
    if (contentEqual && modeEqual) lines.push("similarity index 100%");
    lines.push(`rename from ${patchPath(null, leftDisplayPath)}`);
    lines.push(`rename to ${patchPath(null, rightDisplayPath)}`);
  }

  if (!(renamed && contentEqual && modeEqual)) {
    const indexLine = gitPatchIndexLine(snapshot.left, snapshot.right, leftMissing, rightMissing);
    if (indexLine) lines.push(indexLine);
  }

  if (hunks.length > 0) {
    lines.push(leftMissing ? "--- /dev/null" : `--- ${oldPatchPath}`);
    lines.push(rightMissing ? "+++ /dev/null" : `+++ ${newPatchPath}`);
    for (const hunk of hunks) {
      lines.push(hunkHeader(operations, hunk));
      for (let index = hunk.start; index <= hunk.end; index += 1) {
        const operation = operations[index]!;
        lines.push(formatOperation(operation));
        if (shouldMarkNoFinalNewline(operation, patchSources, finalLineCounts)) {
          lines.push("\\ No newline at end of file");
        }
      }
    }
  }

  return `${lines.join("\n")}\n`;
}

function diffLines(leftText: string, rightText: string, options: TextDiffOptions): LineOperation[] {
  const left = reportLines(leftText, options);
  const right = reportLines(rightText, options);
  return diffLineRange(left, right, 0, left.length, 0, right.length);
}

function diffLineRange(
  left: ReportLine[],
  right: ReportLine[],
  leftStart: number,
  leftEnd: number,
  rightStart: number,
  rightEnd: number,
): LineOperation[] {
  const operations: LineOperation[] = [];
  let leftPrefix = leftStart;
  let rightPrefix = rightStart;
  while (
    leftPrefix < leftEnd
    && rightPrefix < rightEnd
    && left[leftPrefix]!.key === right[rightPrefix]!.key
  ) {
    operations.push(equalOperation(left[leftPrefix]!, leftPrefix, rightPrefix));
    leftPrefix += 1;
    rightPrefix += 1;
  }

  let suffixLength = 0;
  while (
    leftEnd - suffixLength > leftPrefix
    && rightEnd - suffixLength > rightPrefix
    && left[leftEnd - suffixLength - 1]!.key === right[rightEnd - suffixLength - 1]!.key
  ) {
    suffixLength += 1;
  }
  const leftCoreEnd = leftEnd - suffixLength;
  const rightCoreEnd = rightEnd - suffixLength;
  const leftLength = leftCoreEnd - leftPrefix;
  const rightLength = rightCoreEnd - rightPrefix;

  if (leftLength === 0) {
    for (let index = rightPrefix; index < rightCoreEnd; index += 1) {
      operations.push(addedOperation(right[index]!, index));
    }
  } else if (rightLength === 0) {
    for (let index = leftPrefix; index < leftCoreEnd; index += 1) {
      operations.push(removedOperation(left[index]!, index));
    }
  } else if (leftLength * rightLength <= MAX_LCS_CELLS) {
    operations.push(...lcsRange(left, right, leftPrefix, leftCoreEnd, rightPrefix, rightCoreEnd));
  } else {
    const anchors = patienceAnchors(
      left,
      right,
      leftPrefix,
      leftCoreEnd,
      rightPrefix,
      rightCoreEnd,
    );
    if (anchors.length === 0) {
      for (let index = leftPrefix; index < leftCoreEnd; index += 1) {
        operations.push(removedOperation(left[index]!, index));
      }
      for (let index = rightPrefix; index < rightCoreEnd; index += 1) {
        operations.push(addedOperation(right[index]!, index));
      }
    } else {
      let nextLeft = leftPrefix;
      let nextRight = rightPrefix;
      for (const anchor of anchors) {
        operations.push(...diffLineRange(
          left,
          right,
          nextLeft,
          anchor.left,
          nextRight,
          anchor.right,
        ));
        operations.push(equalOperation(left[anchor.left]!, anchor.left, anchor.right));
        nextLeft = anchor.left + 1;
        nextRight = anchor.right + 1;
      }
      operations.push(...diffLineRange(
        left,
        right,
        nextLeft,
        leftCoreEnd,
        nextRight,
        rightCoreEnd,
      ));
    }
  }

  for (let offset = suffixLength; offset > 0; offset -= 1) {
    const leftIndex = leftEnd - offset;
    const rightIndex = rightEnd - offset;
    operations.push(equalOperation(left[leftIndex]!, leftIndex, rightIndex));
  }
  return operations;
}

function lcsRange(
  left: ReportLine[],
  right: ReportLine[],
  leftStart: number,
  leftEnd: number,
  rightStart: number,
  rightEnd: number,
): LineOperation[] {
  const leftSlice = left.slice(leftStart, leftEnd);
  const rightSlice = right.slice(rightStart, rightEnd);
  const table = lcsTable(leftSlice, rightSlice);
  const operations: LineOperation[] = [];
  let leftIndex = 0;
  let rightIndex = 0;

  while (leftIndex < leftSlice.length && rightIndex < rightSlice.length) {
    if (leftSlice[leftIndex]!.key === rightSlice[rightIndex]!.key) {
      operations.push(equalOperation(
        leftSlice[leftIndex]!,
        leftStart + leftIndex,
        rightStart + rightIndex,
      ));
      leftIndex += 1;
      rightIndex += 1;
    } else if (table[leftIndex + 1][rightIndex] >= table[leftIndex][rightIndex + 1]) {
      operations.push(removedOperation(leftSlice[leftIndex]!, leftStart + leftIndex));
      leftIndex += 1;
    } else {
      operations.push(addedOperation(rightSlice[rightIndex]!, rightStart + rightIndex));
      rightIndex += 1;
    }
  }

  while (leftIndex < leftSlice.length) {
    operations.push(removedOperation(leftSlice[leftIndex]!, leftStart + leftIndex));
    leftIndex += 1;
  }

  while (rightIndex < rightSlice.length) {
    operations.push(addedOperation(rightSlice[rightIndex]!, rightStart + rightIndex));
    rightIndex += 1;
  }

  return operations;
}

interface PatienceAnchor {
  left: number;
  right: number;
}

function patienceAnchors(
  left: ReportLine[],
  right: ReportLine[],
  leftStart: number,
  leftEnd: number,
  rightStart: number,
  rightEnd: number,
): PatienceAnchor[] {
  const leftOccurrences = uniqueLineOccurrences(left, leftStart, leftEnd);
  const rightOccurrences = uniqueLineOccurrences(right, rightStart, rightEnd);
  const candidates: PatienceAnchor[] = [];
  for (const occurrence of leftOccurrences.values()) {
    if (occurrence.count !== 1) continue;
    const rightOccurrence = rightOccurrences.get(occurrence.key);
    if (rightOccurrence?.count === 1) {
      candidates.push({ left: occurrence.index, right: rightOccurrence.index });
    }
  }
  if (candidates.length <= 1) return candidates;

  const tails: number[] = [];
  const previous = new Array<number>(candidates.length).fill(-1);
  for (let index = 0; index < candidates.length; index += 1) {
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (candidates[tails[middle]!]!.right < candidates[index]!.right) low = middle + 1;
      else high = middle;
    }
    if (low > 0) previous[index] = tails[low - 1]!;
    tails[low] = index;
  }

  const anchors: PatienceAnchor[] = [];
  let cursor = tails.at(-1) ?? -1;
  while (cursor >= 0) {
    anchors.push(candidates[cursor]!);
    cursor = previous[cursor]!;
  }
  return anchors.reverse();
}

interface LineOccurrence {
  key: string;
  count: number;
  index: number;
}

function uniqueLineOccurrences(
  lines: ReportLine[],
  start: number,
  end: number,
): Map<string, LineOccurrence> {
  const occurrences = new Map<string, LineOccurrence>();
  for (let index = start; index < end; index += 1) {
    const line = lines[index]!;
    const current = occurrences.get(line.key);
    if (current) current.count += 1;
    else occurrences.set(line.key, { key: line.key, count: 1, index });
  }
  return occurrences;
}

function equalOperation(line: ReportLine, leftIndex: number, rightIndex: number): LineOperation {
  return {
    kind: "equal",
    text: line.text,
    leftLine: leftIndex + 1,
    rightLine: rightIndex + 1,
  };
}

function removedOperation(line: ReportLine, leftIndex: number): LineOperation {
  return { kind: "removed", text: line.text, leftLine: leftIndex + 1, rightLine: null };
}

function addedOperation(line: ReportLine, rightIndex: number): LineOperation {
  return { kind: "added", text: line.text, leftLine: null, rightLine: rightIndex + 1 };
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
  const leftBefore = consumedLeftLines(before);
  const rightBefore = consumedRightLines(before);
  const leftCount = consumedLeftLines(inside);
  const rightCount = consumedRightLines(inside);
  const leftStart = leftCount === 0 ? leftBefore : leftBefore + 1;
  const rightStart = rightCount === 0 ? rightBefore : rightBefore + 1;
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

function shouldMarkNoFinalNewline(
  operation: LineOperation,
  session: DiffSourcePair,
  counts: DiffLineCounts,
): boolean {
  return (
    operation.kind === "removed" &&
    operation.leftLine != null &&
    operation.leftLine === counts.left &&
    !session.left.hadFinalNewline
  ) || (
    operation.kind === "added" &&
    operation.rightLine != null &&
    operation.rightLine === counts.right &&
    !session.right.hadFinalNewline
  );
}

function diffLineCounts(session: DiffSourcePair): DiffLineCounts {
  return {
    left: lineCount(session.left.text),
    right: lineCount(session.right.text),
  };
}

function lineCount(text: string): number {
  return reportLines(text, { whitespace: "none", ignoreCase: false, ignoreLineEndings: true }).length;
}

function revisionIdentity(
  session: GitFileCompareSession["snapshot"],
  side: "left" | "right",
): string {
  const pairRevision = session.revisionPair?.[side];
  if (pairRevision) return formattedRevision(pairRevision);
  const document = session[side];
  const baseRevision = session.revision
    ? `; base revision ${formattedRevision(session.revision)}`
    : "";
  if (document.objectId) {
    return `${headerValue(document.label)} (object ${document.objectId.algorithm}:${document.objectId.hex}${baseRevision})`;
  }
  if (document.workingTreeVersion) {
    return `${headerValue(document.label)} (working-tree size=${document.workingTreeVersion.size}, modifiedMs=${document.workingTreeVersion.modifiedMs ?? "unknown"}${baseRevision})`;
  }
  return `${headerValue(document.label)} (missing${baseRevision})`;
}

function formattedRevision(revision: GitRevision): string {
  return `${headerValue(revision.displayName)} (${revision.resolved.algorithm}:${revision.resolved.hex})`;
}

function gitPatchEncodingWarning(
  left: GitSnapshotDocument,
  right: GitSnapshotDocument,
): string | null {
  const descriptors = [left, right].map((document) => {
    if (document.contentState.kind === "missing") return "missing";
    const metadata = document.textMetadata!;
    return `${metadata.encoding}${metadata.decodeHadErrors ? " (decode errors)" : ""}`;
  });
  const needsWarning = [left, right].some((document) =>
    document.contentState.kind === "text"
    && (document.textMetadata!.encoding.trim().toUpperCase() !== "UTF-8"
      || document.textMetadata!.decodeHadErrors));
  return needsWarning
    ? `# Warning: source encoding left=${descriptors[0]}, right=${descriptors[1]}; review replacement characters before applying.`
    : null;
}

function gitPatchIndexLine(
  left: GitSnapshotDocument,
  right: GitSnapshotDocument,
  leftMissing: boolean,
  rightMissing: boolean,
): string | null {
  const objectLength = left.objectId?.hex.length
    ?? right.objectId?.hex.length
    ?? 40;
  const leftHex = leftMissing ? "0".repeat(objectLength) : left.objectId?.hex;
  const rightHex = rightMissing ? "0".repeat(objectLength) : right.objectId?.hex;
  if (!leftHex || !rightHex) return null;
  const mode = !leftMissing && !rightMissing && left.mode === right.mode && left.mode
    ? ` ${left.mode}`
    : "";
  return `index ${leftHex}..${rightHex}${mode}`;
}

function patchPath(prefix: "a" | "b" | null, path: string): string {
  const value = prefix ? `${prefix}/${path}` : path;
  if (!/[\t\r\n"\\]/.test(value)) return value;
  return `"${value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, "\\\"")
    .replace(/\t/g, "\\t")
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")}"`;
}

function headerValue(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\t/g, "\\t")
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n");
}
