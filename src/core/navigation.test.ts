import { describe, expect, it } from "vitest";
import { modeAfterCompareBack } from "./navigation";

describe("modeAfterCompareBack", () => {
  it("returns to folder results only when a folder result is still available", () => {
    expect(modeAfterCompareBack("folders", true)).toBe("folders");
    expect(modeAfterCompareBack("folders", false)).toBe("home");
    expect(modeAfterCompareBack("home", true)).toBe("home");
  });

  it("returns read-only Git snapshots to the active repository review", () => {
    expect(modeAfterCompareBack("git", false)).toBe("git");
  });
});
