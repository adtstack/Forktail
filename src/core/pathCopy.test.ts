import { describe, expect, it } from "vitest";
import { pathCopyFailureMessage, pathCopySuccessMessage } from "./pathCopy";

describe("path copy messages", () => {
  it("builds side-specific success messages", () => {
    expect(pathCopySuccessMessage("Left")).toBe("Left path copied.");
    expect(pathCopySuccessMessage("RIGHT")).toBe("RIGHT path copied.");
  });

  it("keeps a user-actionable failure message", () => {
    expect(pathCopyFailureMessage).toContain("Select the path below");
  });
});
