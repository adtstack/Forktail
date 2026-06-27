import { describe, expect, it } from "vitest";
import { hasUnresolvedConflicts, parseConflictBlocks, resolveConflict } from "./conflicts";

const conflictText = `before\n<<<<<<< ours\nours\n||||||| original\nbase\n=======\ntheirs\n>>>>>>> theirs\nafter\n`;

describe("parseConflictBlocks", () => {
  it("parses diff3 conflict sections", () => {
    const conflicts = parseConflictBlocks(conflictText);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].ours).toBe("ours\n");
    expect(conflicts[0].base).toBe("base\n");
    expect(conflicts[0].theirs).toBe("theirs\n");
    expect(conflicts[0].startLine).toBe(2);
  });

  it("ignores incomplete markers", () => {
    expect(parseConflictBlocks("<<<<<<< ours\nunfinished")).toEqual([]);
  });

  it("parses CRLF conflict sections", () => {
    const text = "before\r\n<<<<<<< ours\r\nours\r\n||||||| original\r\nbase\r\n=======\r\ntheirs\r\n>>>>>>> theirs\r\nafter\r\n";
    const conflicts = parseConflictBlocks(text);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].ours).toBe("ours\r\n");
    expect(conflicts[0].base).toBe("base\r\n");
    expect(conflicts[0].theirs).toBe("theirs\r\n");
    expect(conflicts[0].endLine).toBe(8);
  });

  it("parses a conflict without a final newline", () => {
    const text = "<<<<<<< ours\nours\n||||||| original\nbase\n=======\ntheirs\n>>>>>>> theirs";
    const conflicts = parseConflictBlocks(text);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].raw.endsWith(">>>>>>> theirs")).toBe(true);
  });

  it("does not treat marker-like user text as delimiters", () => {
    const text = [
      "<<<<<<< ours",
      "literal <<<<<<< ours in content",
      "||||||| original",
      "literal ======= in content",
      "=======",
      "literal >>>>>>> theirs in content",
      ">>>>>>> theirs",
      "",
    ].join("\n");
    const conflicts = parseConflictBlocks(text);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].ours).toBe("literal <<<<<<< ours in content\n");
    expect(conflicts[0].base).toBe("literal ======= in content\n");
    expect(conflicts[0].theirs).toBe("literal >>>>>>> theirs in content\n");
  });

  it("ignores malformed markers that appear out of order", () => {
    const text = "<<<<<<< ours\nours\n=======\ntheirs\n||||||| original\nbase\n>>>>>>> theirs\n";
    expect(parseConflictBlocks(text)).toEqual([]);
  });

  it("does not let a malformed outer marker swallow a later valid conflict", () => {
    const text = [
      "prefix",
      "<<<<<<< ours",
      "outer conflict never reaches a base marker",
      "<<<<<<< ours",
      "inner ours",
      "||||||| original",
      "inner base",
      "=======",
      "inner theirs",
      ">>>>>>> theirs",
      "suffix",
      "",
    ].join("\n");

    const conflicts = parseConflictBlocks(text);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      startLine: 4,
      endLine: 10,
      ours: "inner ours\n",
      base: "inner base\n",
      theirs: "inner theirs\n",
    });
  });

  it("parses multiple non-overlapping conflict sections", () => {
    const text = `${conflictText}middle\n${conflictText}`;
    const conflicts = parseConflictBlocks(text);
    expect(conflicts).toHaveLength(2);
    expect(conflicts[0].endOffset).toBeLessThan(conflicts[1].startOffset);
    expect(conflicts[1].id).toBe(2);
  });
});

describe("resolveConflict", () => {
  it("replaces the selected block without touching surrounding text", () => {
    const conflict = parseConflictBlocks(conflictText)[0];
    expect(resolveConflict(conflictText, conflict, "theirs")).toBe("before\ntheirs\nafter\n");
  });

  it("can keep both sides", () => {
    const conflict = parseConflictBlocks(conflictText)[0];
    expect(resolveConflict(conflictText, conflict, "both")).toBe("before\nours\ntheirs\nafter\n");
  });

  it("can resolve conflicts in arbitrary order and reparse remaining offsets", () => {
    const text = `${conflictText}middle\n${conflictText}`;
    const conflicts = parseConflictBlocks(text);

    const secondResolved = resolveConflict(text, conflicts[1], "base");
    const remaining = parseConflictBlocks(secondResolved);

    expect(remaining).toHaveLength(1);
    expect(remaining[0].startOffset).toBe(conflicts[0].startOffset);
    expect(secondResolved).toContain("before\nbase\nafter\n");
    expect(secondResolved).toContain("middle\nbefore\n");
  });

  it("only replaces the selected conflict block", () => {
    const text = `prefix\n${conflictText}between\n${conflictText}suffix\n`;
    const [first] = parseConflictBlocks(text);
    const resolved = resolveConflict(text, first, "ours");

    expect(resolved).toContain("prefix\nbefore\nours\nafter\nbetween\n");
    expect(parseConflictBlocks(resolved)).toHaveLength(1);
    expect(resolved.endsWith("suffix\n")).toBe(true);
  });
});

describe("hasUnresolvedConflicts", () => {
  it("detects standard unresolved conflict markers", () => {
    expect(hasUnresolvedConflicts(conflictText)).toBe(true);
    expect(hasUnresolvedConflicts("clean\ntext\n")).toBe(false);
  });

  it("does not warn for incomplete marker-like text", () => {
    expect(hasUnresolvedConflicts("notes\n<<<<<<< ours\nnot a full block\n")).toBe(false);
  });
});
