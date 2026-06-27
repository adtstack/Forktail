import { describe, expect, it } from "vitest";
import { applyModifiedHunkToOriginal, applyOriginalHunkToModified } from "./hunkCopy";

describe("applyOriginalHunkToModified", () => {
  it("replaces a changed line with the original hunk text", () => {
    const original = "one\ntwo\nthree\n";
    const modified = "one\nTWO\nthree\n";

    expect(
      applyOriginalHunkToModified(original, modified, {
        originalStartLineNumber: 2,
        originalEndLineNumber: 2,
        modifiedStartLineNumber: 2,
        modifiedEndLineNumber: 2,
      }),
    ).toBe(original);
  });

  it("removes a modified-only insertion when the original hunk is empty", () => {
    const original = "one\nthree\n";
    const modified = "one\ntwo\nthree\n";

    expect(
      applyOriginalHunkToModified(original, modified, {
        originalStartLineNumber: 2,
        originalEndLineNumber: 1,
        modifiedStartLineNumber: 2,
        modifiedEndLineNumber: 2,
      }),
    ).toBe(original);
  });

  it("inserts an original-only deletion back into the modified text", () => {
    const original = "one\ntwo\nthree\n";
    const modified = "one\nthree\n";

    expect(
      applyOriginalHunkToModified(original, modified, {
        originalStartLineNumber: 2,
        originalEndLineNumber: 2,
        modifiedStartLineNumber: 2,
        modifiedEndLineNumber: 1,
      }),
    ).toBe(original);
  });

  it("preserves a target final line without a trailing newline", () => {
    const original = "one\ntwo\n";
    const modified = "one\nTWO\nlast";

    expect(
      applyOriginalHunkToModified(original, modified, {
        originalStartLineNumber: 2,
        originalEndLineNumber: 2,
        modifiedStartLineNumber: 2,
        modifiedEndLineNumber: 2,
      }),
    ).toBe("one\ntwo\nlast");
  });
});

describe("applyModifiedHunkToOriginal", () => {
  it("can apply the same line-change in the reverse direction", () => {
    const original = "one\ntwo\nthree\n";
    const modified = "one\nTWO\nthree\n";

    expect(
      applyModifiedHunkToOriginal(original, modified, {
        originalStartLineNumber: 2,
        originalEndLineNumber: 2,
        modifiedStartLineNumber: 2,
        modifiedEndLineNumber: 2,
      }),
    ).toBe(modified);
  });
});
