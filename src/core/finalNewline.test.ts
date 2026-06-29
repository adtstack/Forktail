import { describe, expect, it } from "vitest";
import {
  finalNewlineDifference,
  finalNewlineDifferenceLabel,
  finalNewlineLabel,
} from "./finalNewline";

describe("finalNewlineLabel", () => {
  it("describes whether a document has a final newline", () => {
    expect(finalNewlineLabel(true)).toBe("Final newline");
    expect(finalNewlineLabel(false)).toBe("No final newline");
    expect(finalNewlineLabel(false, "ko")).toBe("마지막 개행 없음");
  });
});

describe("finalNewlineDifference", () => {
  it("detects matching final newline states", () => {
    expect(finalNewlineDifference(true, true)).toBe("same");
    expect(finalNewlineDifference(false, false)).toBe("same");
  });

  it("detects the side missing the final newline", () => {
    expect(finalNewlineDifference(false, true)).toBe("leftMissing");
    expect(finalNewlineDifference(true, false)).toBe("rightMissing");
  });
});

describe("finalNewlineDifferenceLabel", () => {
  it("returns a user-facing label only for differences", () => {
    expect(finalNewlineDifferenceLabel("same")).toBeNull();
    expect(finalNewlineDifferenceLabel("leftMissing")).toBe("Left file has no final newline.");
    expect(finalNewlineDifferenceLabel("rightMissing")).toBe("Right file has no final newline.");
    expect(finalNewlineDifferenceLabel("leftMissing", "ko")).toBe(
      "왼쪽 파일에 마지막 개행이 없습니다.",
    );
  });
});
