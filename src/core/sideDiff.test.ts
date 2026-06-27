import { describe, expect, it } from "vitest";
import { buildSideDiff } from "./sideDiff";

describe("buildSideDiff", () => {
  it("marks unchanged text as equal on both sides", () => {
    expect(buildSideDiff("return value;\n", "return value;\n")).toEqual({
      base: [{ kind: "equal", text: "return value;\n" }],
      changed: [{ kind: "equal", text: "return value;\n" }],
    });
  });

  it("marks replaced words on the matching side only", () => {
    expect(buildSideDiff("return name;\n", "return safeName;\n")).toEqual({
      base: [
        { kind: "equal", text: "return " },
        { kind: "removed", text: "name;" },
        { kind: "equal", text: "\n" },
      ],
      changed: [
        { kind: "equal", text: "return " },
        { kind: "added", text: "safeName;" },
        { kind: "equal", text: "\n" },
      ],
    });
  });

  it("marks inserted text as added while preserving equal base text", () => {
    expect(buildSideDiff("Hello name\n", "Hello brave name\n")).toEqual({
      base: [{ kind: "equal", text: "Hello name\n" }],
      changed: [
        { kind: "equal", text: "Hello " },
        { kind: "added", text: "brave " },
        { kind: "equal", text: "name\n" },
      ],
    });
  });

  it("handles Korean text and whitespace tokens", () => {
    const diff = buildSideDiff("안녕 이름\n", "안녕 새 이름\n");

    expect(diff.base).toEqual([{ kind: "equal", text: "안녕 이름\n" }]);
    expect(diff.changed).toEqual([
      { kind: "equal", text: "안녕 " },
      { kind: "added", text: "새 " },
      { kind: "equal", text: "이름\n" },
    ]);
  });
});
