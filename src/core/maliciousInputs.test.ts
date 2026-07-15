import { describe, expect, it } from "vitest";
import { parseConflictBlocks } from "./conflicts";
import { buildDiffReport } from "./diffReport";
import { droppedFilePaths } from "./dropPaths";
import type { CompareSession, FileDocument } from "./models";

describe("SEC-004 malicious input coverage", () => {
  it("does not let marker floods hide a later valid conflict", () => {
    const markerFlood = Array.from({ length: 300 }, (_, index) => [
      "<<<<<<< ours",
      `unclosed conflict ${index}`,
      index % 2 === 0 ? "||||||| original" : "=======",
    ].join("\n")).join("\n");
    const validConflict = [
      "<<<<<<< ours",
      "safe ours",
      "||||||| original",
      "safe base",
      "=======",
      "safe theirs",
      ">>>>>>> theirs",
      "",
    ].join("\n");

    const conflicts = parseConflictBlocks(`${markerFlood}\n${validConflict}`);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].ours).toBe("safe ours\n");
    expect(conflicts[0].base).toBe("safe base\n");
    expect(conflicts[0].theirs).toBe("safe theirs\n");
  });

  it("keeps control characters as plain text in diff reports", () => {
    const report = buildDiffReport({
      session: compareSession(
        "plain\u001B[31mred\u0000\n<script>alert('left')</script>\n",
        "plain\u001B[32mgreen\u0000\n<script>alert('right')</script>\n",
      ),
      options: { whitespace: "none", ignoreCase: false, ignoreLineEndings: true },
      generatedAt: new Date("2026-06-26T00:00:00.000Z"),
    });

    expect(report).toContain("-plain\u001B[31mred\u0000");
    expect(report).toContain("+plain\u001B[32mgreen\u0000");
    expect(report).toContain("-<script>alert('left')</script>");
    expect(report).toContain("+<script>alert('right')</script>");
    expect(report).not.toContain("<html");
    expect(report).not.toContain("dangerouslySetInnerHTML");
  });

  it("ignores malformed and non-file drop URI entries", () => {
    const paths = droppedFilePaths({
      files: { length: 0 },
      getData: (format) => format === "text/uri-list"
        ? [
          "# ignored comment",
          "https://example.com/not-local.txt",
          "file:///tmp/%E0%A4%A",
          "file://server/share/folder%20name.txt",
          "file:///Users/example/%23literal-hash.txt",
        ].join("\n")
        : "",
    });

    expect(paths).toEqual([
      "//server/share/folder name.txt",
      "/Users/example/#literal-hash.txt",
    ]);
  });
});

function compareSession(leftText: string, rightText: string): CompareSession {
  return {
    origin: "files",
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
