import { describe, expect, it } from "vitest";
import { DEFAULT_FOLDER_SCAN_OPTIONS } from "./settings";
import { parseStartupSessionArgs } from "./startupSession";

describe("startup CLI session parser", () => {
  it("does nothing when no app arguments are present", () => {
    expect(parseStartupSessionArgs([])).toEqual({ status: "none" });
    expect(parseStartupSessionArgs([""])).toEqual({ status: "none" });
  });

  it("preserves whitespace that is part of a path argument", () => {
    expect(parseStartupSessionArgs([" /left.txt", "/right.txt "])).toEqual({
      status: "valid",
      source: "compare",
      session: { kind: "compare", leftPath: " /left.txt", rightPath: "/right.txt " },
    });
  });

  it("opens two positional paths as a 2-way compare session", () => {
    expect(parseStartupSessionArgs(["/left.txt", "/right.txt"])).toEqual({
      status: "valid",
      source: "compare",
      session: { kind: "compare", leftPath: "/left.txt", rightPath: "/right.txt" },
    });
  });

  it("supports explicit compare and double-dash separated app arguments", () => {
    expect(parseStartupSessionArgs(["--", "--compare", "/left.txt", "/right.txt"])).toEqual({
      status: "valid",
      source: "compare",
      session: { kind: "compare", leftPath: "/left.txt", rightPath: "/right.txt" },
    });
  });

  it("opens folder sessions with default scan options", () => {
    expect(parseStartupSessionArgs(["--folders", "/left", "/right"])).toEqual({
      status: "valid",
      source: "folders",
      session: {
        kind: "folders",
        leftRoot: "/left",
        rightRoot: "/right",
        options: DEFAULT_FOLDER_SCAN_OPTIONS,
      },
    });
  });

  it("opens 3-way merge sessions with optional output path", () => {
    expect(parseStartupSessionArgs(["--merge", "/base", "/ours", "/theirs"])).toEqual({
      status: "valid",
      source: "merge",
      session: {
        kind: "merge",
        basePath: "/base",
        oursPath: "/ours",
        theirsPath: "/theirs",
        outputPath: null,
      },
    });
    expect(parseStartupSessionArgs(["--merge", "/base", "/ours", "/theirs", "/result"])).toEqual({
      status: "valid",
      source: "merge",
      session: {
        kind: "merge",
        basePath: "/base",
        oursPath: "/ours",
        theirsPath: "/theirs",
        outputPath: "/result",
      },
    });
  });

  it("maps Git mergetool arguments in $BASE $LOCAL $REMOTE $MERGED order", () => {
    expect(parseStartupSessionArgs(["--mergetool", "/base", "/ours", "/theirs", "/path"])).toEqual({
      status: "valid",
      source: "mergetool",
      session: {
        kind: "merge",
        basePath: "/base",
        oursPath: "/ours",
        theirsPath: "/theirs",
        outputPath: "/path",
      },
    });
  });

  it("rejects unknown flags and wrong argument counts", () => {
    for (const args of [
      ["--unknown"],
      ["/only-one-file"],
      ["--compare", "/left"],
      ["--folders", "/left"],
      ["--merge", "/base", "/ours"],
      ["--mergetool", "/base", "/ours", "/theirs"],
      ["--mergetool", "/base", "/ours", "/theirs", "/out", "/extra"],
    ]) {
      const result = parseStartupSessionArgs(args);
      expect(result.status, args.join(" ")).toBe("invalid");
      if (result.status === "invalid") {
        expect(result.message).toContain("forktail left right");
      }
    }
  });
});
