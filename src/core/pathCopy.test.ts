import { describe, expect, it } from "vitest";
import { pathCopyFailureMessage, pathCopySuccessMessage } from "./pathCopy";

describe("path copy messages", () => {
  it("builds side-specific success messages", () => {
    expect(pathCopySuccessMessage("왼쪽")).toBe("왼쪽 경로를 복사했습니다.");
    expect(pathCopySuccessMessage("RIGHT")).toBe("RIGHT 경로를 복사했습니다.");
  });

  it("keeps a user-actionable failure message", () => {
    expect(pathCopyFailureMessage).toContain("아래 경로를 선택해 복사");
  });
});
