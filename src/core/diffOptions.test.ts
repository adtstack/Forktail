import { describe, expect, it } from "vitest";
import {
  DEFAULT_TEXT_DIFF_OPTIONS,
  normalizeTextForDiff,
  prepareDiffTexts,
  type TextDiffOptions,
} from "./diffOptions";

const defaultOptions = DEFAULT_TEXT_DIFF_OPTIONS;

function withOptions(options: Partial<TextDiffOptions>): TextDiffOptions {
  return { ...defaultOptions, ...options };
}

describe("normalizeTextForDiff", () => {
  it("keeps text unchanged with default options", () => {
    expect(normalizeTextForDiff("A b \r\n", defaultOptions)).toBe("A b \r\n");
  });

  it("trims only trailing horizontal whitespace", () => {
    const text = "  keep leading  \ninner  gap\t\r\nlast   ";

    expect(normalizeTextForDiff(text, withOptions({ whitespace: "trim" }))).toBe(
      "  keep leading\ninner  gap\r\nlast",
    );
  });

  it("removes all horizontal whitespace without merging lines", () => {
    const text = "a b\tc\n  d e  \n";

    expect(normalizeTextForDiff(text, withOptions({ whitespace: "all" }))).toBe("abc\nde\n");
  });

  it("normalizes CRLF and CR when line endings are ignored", () => {
    expect(normalizeTextForDiff("a\r\nb\rc\n", withOptions({ ignoreLineEndings: true }))).toBe(
      "a\nb\nc\n",
    );
  });

  it("applies case folding after whitespace and line ending normalization", () => {
    const options = withOptions({
      whitespace: "all",
      ignoreCase: true,
      ignoreLineEndings: true,
    });

    expect(normalizeTextForDiff(" A\tB\r\n", options)).toBe("ab\n");
  });
});

describe("prepareDiffTexts", () => {
  it("makes ignored differences compare as equal", () => {
    const prepared = prepareDiffTexts(
      "Total = A + B\r\n",
      "total=a+b\n",
      withOptions({ whitespace: "all", ignoreCase: true, ignoreLineEndings: true }),
    );

    expect(prepared.left).toBe(prepared.right);
  });

  it("preserves differences when no matching option is enabled", () => {
    const prepared = prepareDiffTexts("Total = A + B\r\n", "total=a+b\n", defaultOptions);

    expect(prepared.left).not.toBe(prepared.right);
  });
});
