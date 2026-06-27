import { describe, expect, it } from "vitest";
import {
  buildDiffReport,
  compareReportDefaultPath,
} from "./diffReport";
import type { CompareSession, FileDocument } from "./models";

describe("buildDiffReport", () => {
  it("builds a plain text unified-style report", () => {
    const session = compareSession("one\ntwo\nthree\n", "one\nTWO\nthree\nfour");

    expect(
      buildDiffReport({
        session,
        options: { whitespace: "none", ignoreCase: false, ignoreLineEndings: true },
        generatedAt: new Date("2026-06-26T00:00:00.000Z"),
      }),
    ).toBe(`forktail diff report
Generated: 2026-06-26T00:00:00.000Z
Left: /repo/left.txt
Right: /repo/right.txt
Options: whitespace=none, ignoreCase=false, ignoreEOL=true
Left metadata: UTF-8, LF, final newline yes, 14 bytes
Right metadata: UTF-8, LF, final newline no, 18 bytes

--- /repo/left.txt
+++ /repo/right.txt
@@ -1,3 +1,4 @@
 one
-two
+TWO
 three
+four
\\ No newline at end of file
`);
  });

  it("reports no line changes when current options ignore the differences", () => {
    const session = compareSession("Alpha  \n", "alpha\n");

    expect(
      buildDiffReport({
        session,
        options: { whitespace: "trim", ignoreCase: true, ignoreLineEndings: true },
      }),
    ).toContain("(no line changes under current options)");
  });

  it("normalizes line endings for report hunks while preserving metadata", () => {
    const session = compareSession("a\r\nb\r\n", "a\nc\n");

    const report = buildDiffReport({
      session: {
        ...session,
        left: { ...session.left, lineEnding: "crlf" },
      },
      options: { whitespace: "none", ignoreCase: false, ignoreLineEndings: true },
    });

    expect(report).toContain("Left metadata: UTF-8, CRLF");
    expect(report).toContain("-b\n+c");
  });
});

describe("compareReportDefaultPath", () => {
  it("uses the right file path with a text diff suffix", () => {
    expect(compareReportDefaultPath(compareSession("left\n", "right\n"))).toBe("/repo/right.txt.diff.txt");
  });
});

function compareSession(leftText: string, rightText: string): CompareSession {
  return {
    left: document("/repo/left.txt", leftText),
    right: document("/repo/right.txt", rightText),
  };
}

function document(path: string, text: string): FileDocument {
  return {
    path,
    name: path.split("/").pop() ?? path,
    text,
    encoding: "UTF-8",
    lineEnding: "lf",
    hadFinalNewline: text.endsWith("\n") || text.endsWith("\r"),
    size: new TextEncoder().encode(text).byteLength,
    modifiedMs: 1000,
    isBinary: false,
    decodeHadErrors: false,
  };
}
