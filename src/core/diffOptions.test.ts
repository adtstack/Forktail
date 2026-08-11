import { describe, expect, it } from "vitest";
import {
  comparisonLinesForText,
  comparisonTextWithColumnMaps,
  DEFAULT_TEXT_DIFF_OPTIONS,
  normalizeTextForDiff,
  prepareDiffTexts,
  type TextDiffOptions,
} from "./diffOptions";
import { computeExactTextLineDiff } from "./exactTextDiff";

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

  it("uses locale-independent Unicode lowercasing", () => {
    const source = "I\u0130";

    expect(source.toLocaleLowerCase("en-US")).not.toBe(
      source.toLocaleLowerCase("tr-TR"),
    );
    expect(normalizeTextForDiff(source, withOptions({ ignoreCase: true }))).toBe(
      source.toLowerCase(),
    );
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

describe("comparisonLinesForText", () => {
  it("keeps one comparison entry per Monaco line while normalizing ignored content", () => {
    const source = " Total\tVALUE  \r\nNext\rLast";

    expect(comparisonLinesForText(source, withOptions({
      whitespace: "all",
      ignoreCase: true,
      ignoreLineEndings: true,
    }))).toEqual(["totalvalue", "next", "last"]);
    expect(source).toBe(" Total\tVALUE  \r\nNext\rLast");
  });

  it("classifies EOL kinds only when line endings are not ignored", () => {
    const lf = comparisonLinesForText("same\nnext\n", defaultOptions);
    const crlf = comparisonLinesForText("same\r\nnext\r\n", defaultOptions);

    expect(lf).not.toEqual(crlf);
    expect(comparisonLinesForText(
      "same\nnext\n",
      withOptions({ ignoreLineEndings: true }),
    )).toEqual(comparisonLinesForText(
      "same\r\nnext\r\n",
      withOptions({ ignoreLineEndings: true }),
    ));
    expect(lf).toHaveLength(3);
    expect(crlf).toHaveLength(3);
  });
});

describe("comparisonTextWithColumnMaps", () => {
  it("keeps a compact identity mapping for simple case-only comparison", () => {
    const result = comparisonTextWithColumnMaps(
      "Alpha",
      withOptions({ ignoreCase: true }),
    );

    expect(result.lines).toEqual(["alpha"]);
    expect(result.columnMaps[0]).toEqual({
      sourceLength: 5,
      comparisonContentLength: 5,
      comparisonLength: 5,
      exact: true,
      segments: [{
        comparisonStart: 0,
        comparisonEnd: 5,
        sourceStart: 0,
        sourceEnd: 5,
      }],
    });
  });

  it("records source gaps when ignored whitespace shifts comparison columns", () => {
    const result = comparisonTextWithColumnMaps(
      "  A \tVALUE  ",
      withOptions({ whitespace: "all", ignoreCase: true }),
    );

    expect(result.lines).toEqual(["avalue"]);
    expect(result.columnMaps[0]?.segments).toEqual([
      {
        comparisonStart: 0,
        comparisonEnd: 1,
        sourceStart: 2,
        sourceEnd: 3,
      },
      {
        comparisonStart: 1,
        comparisonEnd: 6,
        sourceStart: 5,
        sourceEnd: 10,
      },
    ]);
  });

  it("marks Unicode lowercase expansion as a non-linear but bounded segment", () => {
    const result = comparisonTextWithColumnMaps(
      "\u0130X",
      withOptions({ ignoreCase: true }),
    );

    expect(result.lines).toEqual(["i\u0307x"]);
    expect(result.columnMaps[0]?.segments).toEqual([
      {
        comparisonStart: 0,
        comparisonEnd: 2,
        sourceStart: 0,
        sourceEnd: 1,
      },
      {
        comparisonStart: 2,
        comparisonEnd: 3,
        sourceStart: 1,
        sourceEnd: 2,
      },
    ]);
  });

  it("combines trim, case, and EOL normalization without losing line indexes", () => {
    const result = comparisonTextWithColumnMaps(
      " \u0130X  \r\nNext\t\rLast",
      withOptions({ whitespace: "trim", ignoreCase: true, ignoreLineEndings: true }),
    );

    expect(result.lines).toEqual([" i\u0307x", "next", "last"]);
    expect(result.columnMaps).toHaveLength(3);
    expect(result.columnMaps[0]).toMatchObject({
      sourceLength: 5,
      comparisonContentLength: 4,
      comparisonLength: 4,
      exact: true,
    });
    expect(result.columnMaps[1]).toMatchObject({
      sourceLength: 5,
      comparisonContentLength: 4,
      comparisonLength: 4,
      exact: true,
    });
  });

  it("bounds pathological whitespace maps and degrades that line safely", () => {
    const result = comparisonTextWithColumnMaps(
      "a ".repeat(5_000),
      withOptions({ whitespace: "all" }),
    );

    expect(result.lines[0]).toBe("a".repeat(5_000));
    expect(result.columnMaps[0]).toMatchObject({ exact: false, segments: [] });
  });
});

describe("computeExactTextLineDiff", () => {
  it("classifies ignored differences as equal without replacing source-model text", () => {
    const left = "Total = A + B  \r\nnext\r\n";
    const right = "total=a+b\nnext\n";

    expect(computeExactTextLineDiff(left, right, withOptions({
      whitespace: "all",
      ignoreCase: true,
      ignoreLineEndings: true,
    }), 5_000)).toEqual({ changes: [], quitEarly: false });
    expect(computeExactTextLineDiff(left, right, defaultOptions, 5_000).changes.length)
      .toBeGreaterThan(0);
  });

  it("returns exact original line coordinates for a non-ignored change", () => {
    const result = computeExactTextLineDiff(
      "same\r\n Real VALUE \r\ntail\r\n",
      "same\n different value\nTAIL\n",
      withOptions({ whitespace: "all", ignoreCase: true, ignoreLineEndings: true }),
      5_000,
    );

    expect(result.quitEarly).toBe(false);
    expect(result.changes).toEqual([{
      originalStartLineNumber: 2,
      originalEndLineNumberExclusive: 3,
      modifiedStartLineNumber: 2,
      modifiedEndLineNumberExclusive: 3,
    }]);
  });
});
