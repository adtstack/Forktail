import { describe, expect, it } from "vitest";
import {
  saveLineEndingSequence,
  textForSaveLineEnding,
} from "./lineEndings";

describe("textForSaveLineEnding", () => {
  it("uses the original homogeneous line ending when requested", () => {
    expect(textForSaveLineEnding("a\nb\n", "crlf", "original")).toBe("a\r\nb\r\n");
    expect(textForSaveLineEnding("a\r\nb\r\n", "lf", "original")).toBe("a\nb\n");
    expect(textForSaveLineEnding("a\nb\n", "cr", "original")).toBe("a\rb\r");
  });

  it("converts all line endings to LF or CRLF when explicitly requested", () => {
    expect(textForSaveLineEnding("a\r\nb\rc\n", "mixed", "lf")).toBe("a\nb\nc\n");
    expect(textForSaveLineEnding("a\r\nb\rc\n", "mixed", "crlf")).toBe("a\r\nb\r\nc\r\n");
  });

  it("uses the injected system line ending for system mode", () => {
    expect(textForSaveLineEnding("a\nb\n", "lf", "system", "\r\n")).toBe("a\r\nb\r\n");
    expect(textForSaveLineEnding("a\r\nb\r\n", "crlf", "system", "\n")).toBe("a\nb\n");
  });

  it("preserves exact text for original mode when the source is mixed or has no line endings", () => {
    expect(textForSaveLineEnding("a\r\nb\n", "mixed", "original")).toBe("a\r\nb\n");
    expect(textForSaveLineEnding("single line", "none", "original")).toBe("single line");
  });
});

describe("saveLineEndingSequence", () => {
  it("returns no target for original mixed and none policies", () => {
    expect(saveLineEndingSequence("mixed", "original")).toBeNull();
    expect(saveLineEndingSequence("none", "original")).toBeNull();
  });
});
