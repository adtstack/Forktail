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

  it("maps Git difftool arguments in $LOCAL $REMOTE order", () => {
    for (const command of ["--difftool", "--diff-tool", "difftool"] as const) {
      expect(parseStartupSessionArgs([command, "/tmp/로컬 file", " /tmp/REMOTE "])).toEqual({
        status: "valid",
        source: "difftool",
        session: {
          kind: "difftool",
          localPath: "/tmp/로컬 file",
          remotePath: " /tmp/REMOTE ",
        },
      });
    }
  });

  it("keeps difftool source and session kinds correlated for narrowing", () => {
    const result = parseStartupSessionArgs(["--difftool", "/local", "/remote"]);

    if (result.status !== "valid" || result.source !== "difftool") {
      throw new Error("Expected a difftool startup session");
    }

    expect(result.session.kind).toBe("difftool");
    expect(result.session.localPath).toBe("/local");
  });

  it("maps an empty slot or literal /dev/null to an explicit missing difftool side", () => {
    expect(parseStartupSessionArgs(["--difftool", "", "/remote"])).toEqual({
      status: "valid",
      source: "difftool",
      session: { kind: "difftool", localPath: null, remotePath: "/remote" },
    });
    expect(parseStartupSessionArgs(["--difftool", "/local", "/dev/null"])).toEqual({
      status: "valid",
      source: "difftool",
      session: { kind: "difftool", localPath: "/local", remotePath: null },
    });
  });

  it("rejects difftool invocations without exactly two slots or with both sides missing", () => {
    for (const args of [
      ["--difftool"],
      ["--difftool", "/local"],
      ["--difftool", "/local", "/remote", "/extra"],
      ["--difftool", "", ""],
      ["--difftool", "/dev/null", ""],
      ["--difftool", "/dev/null", "/dev/null"],
    ]) {
      expect(parseStartupSessionArgs(args).status, JSON.stringify(args)).toBe("invalid");
    }
  });

  it("treats only the exact /dev/null literal as a missing difftool side", () => {
    expect(parseStartupSessionArgs(["--difftool", "/DEV/NULL", "/dev/null "])).toEqual({
      status: "valid",
      source: "difftool",
      session: {
        kind: "difftool",
        localPath: "/DEV/NULL",
        remotePath: "/dev/null ",
      },
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
        kind: "mergetool",
        basePath: "/base",
        oursPath: "/ours",
        theirsPath: "/theirs",
        outputPath: "/path",
      },
    });
  });

  it("preserves an empty Git $BASE argument as a missing base", () => {
    expect(parseStartupSessionArgs(["--mergetool", "", "/ours", "/theirs", "/path"])).toEqual({
      status: "valid",
      source: "mergetool",
      session: {
        kind: "mergetool",
        basePath: null,
        oursPath: "/ours",
        theirsPath: "/theirs",
        outputPath: "/path",
      },
    });
  });

  it("rejects empty Git mergetool arguments other than $BASE", () => {
    for (const args of [
      ["--mergetool", "/base", "", "/theirs", "/out"],
      ["--mergetool", "/base", "/ours", "", "/out"],
      ["--mergetool", "/base", "/ours", "/theirs", ""],
    ]) {
      expect(parseStartupSessionArgs(args).status, JSON.stringify(args)).toBe("invalid");
    }
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
