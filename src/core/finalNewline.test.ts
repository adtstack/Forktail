import { describe, expect, it } from "vitest";
import {
  finalNewlineDifference,
  finalNewlineDifferenceLabel,
  finalNewlineLabel,
} from "./finalNewline";

describe("finalNewlineLabel", () => {
  it("describes whether a document has a final newline", () => {
    expect(finalNewlineLabel(true)).toBe("마지막 개행 있음");
    expect(finalNewlineLabel(false)).toBe("마지막 개행 없음");
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
    expect(finalNewlineDifferenceLabel("leftMissing")).toBe("왼쪽 파일에 마지막 개행이 없습니다.");
    expect(finalNewlineDifferenceLabel("rightMissing")).toBe("오른쪽 파일에 마지막 개행이 없습니다.");
  });
});
