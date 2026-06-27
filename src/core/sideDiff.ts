export type SideDiffKind = "equal" | "removed" | "added";

export interface SideDiffSegment {
  kind: SideDiffKind;
  text: string;
}

interface Token {
  text: string;
  key: string;
}

interface DiffPair {
  base: SideDiffSegment[];
  changed: SideDiffSegment[];
}

export function buildSideDiff(base: string, changed: string): DiffPair {
  const baseTokens = tokenizeForSideDiff(base);
  const changedTokens = tokenizeForSideDiff(changed);
  const lcs = longestCommonSubsequence(baseTokens, changedTokens);

  const baseSegments: SideDiffSegment[] = [];
  const changedSegments: SideDiffSegment[] = [];
  let baseIndex = 0;
  let changedIndex = 0;

  for (const match of lcs) {
    appendTokenRange(baseSegments, baseTokens, baseIndex, match.baseIndex, "removed");
    appendTokenRange(changedSegments, changedTokens, changedIndex, match.changedIndex, "added");
    appendToken(baseSegments, baseTokens[match.baseIndex].text, "equal");
    appendToken(changedSegments, changedTokens[match.changedIndex].text, "equal");
    baseIndex = match.baseIndex + 1;
    changedIndex = match.changedIndex + 1;
  }

  appendTokenRange(baseSegments, baseTokens, baseIndex, baseTokens.length, "removed");
  appendTokenRange(changedSegments, changedTokens, changedIndex, changedTokens.length, "added");

  return {
    base: compactSegments(baseSegments),
    changed: compactSegments(changedSegments),
  };
}

function tokenizeForSideDiff(text: string): Token[] {
  return (text.match(/\s+|[^\s]+/gu) ?? []).map((token) => ({
    text: token,
    key: token,
  }));
}

function longestCommonSubsequence(baseTokens: Token[], changedTokens: Token[]) {
  const table: number[][] = Array.from({ length: baseTokens.length + 1 }, () =>
    Array(changedTokens.length + 1).fill(0),
  );

  for (let baseIndex = baseTokens.length - 1; baseIndex >= 0; baseIndex -= 1) {
    for (let changedIndex = changedTokens.length - 1; changedIndex >= 0; changedIndex -= 1) {
      table[baseIndex][changedIndex] =
        baseTokens[baseIndex].key === changedTokens[changedIndex].key
          ? table[baseIndex + 1][changedIndex + 1] + 1
          : Math.max(table[baseIndex + 1][changedIndex], table[baseIndex][changedIndex + 1]);
    }
  }

  const matches: Array<{ baseIndex: number; changedIndex: number }> = [];
  let baseIndex = 0;
  let changedIndex = 0;

  while (baseIndex < baseTokens.length && changedIndex < changedTokens.length) {
    if (baseTokens[baseIndex].key === changedTokens[changedIndex].key) {
      matches.push({ baseIndex, changedIndex });
      baseIndex += 1;
      changedIndex += 1;
    } else if (table[baseIndex + 1][changedIndex] >= table[baseIndex][changedIndex + 1]) {
      baseIndex += 1;
    } else {
      changedIndex += 1;
    }
  }

  return matches;
}

function appendTokenRange(
  segments: SideDiffSegment[],
  tokens: Token[],
  start: number,
  end: number,
  kind: SideDiffKind,
) {
  for (let index = start; index < end; index += 1) {
    appendToken(segments, tokens[index].text, kind);
  }
}

function appendToken(segments: SideDiffSegment[], text: string, kind: SideDiffKind) {
  if (!text) return;
  const previous = segments.at(-1);
  if (previous?.kind === kind) {
    previous.text += text;
    return;
  }
  segments.push({ kind, text });
}

function compactSegments(segments: SideDiffSegment[]): SideDiffSegment[] {
  return segments.filter((segment) => segment.text.length > 0);
}
