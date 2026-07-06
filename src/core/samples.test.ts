import { describe, expect, it } from "vitest";
import {
  DEMO_FOLDER_LEFT_ROOT,
  DEMO_FOLDER_RIGHT_ROOT,
  demoFolderEntryCompareSession,
  demoFolderScanResult,
  isDemoFolderRoots,
} from "./samples";

describe("demoFolderEntryCompareSession", () => {
  it("creates a text compare session for two-sided demo files", () => {
    const folder = demoFolderScanResult();
    const entry = folder.entries.find((item) => item.relativePath === "src/App.tsx");

    expect(entry).toBeDefined();
    const session = demoFolderEntryCompareSession(entry!);

    expect(session?.left.path).toBe("demo/original.ts");
    expect(session?.right.path).toBe("demo/modified.ts");
    expect(session?.left.text).toContain("calculateTotal");
  });

  it("creates a compare session with a virtual missing side for one-sided entries", () => {
    const folder = demoFolderScanResult();
    const entry = folder.entries.find((item) => item.relativePath === "docs/guide.md");

    expect(entry).toBeDefined();
    const session = demoFolderEntryCompareSession(entry!);

    expect(session?.left.text).toBe("left/docs/guide.md\n");
    expect(session?.right.text).toBe("");
    expect(session?.right.virtual).toEqual({ kind: "missing" });
    expect(session?.right.path).toBe("/demo/right/docs/guide.md");
  });
});

describe("isDemoFolderRoots", () => {
  it("matches only the built-in demo folder roots", () => {
    expect(isDemoFolderRoots(DEMO_FOLDER_LEFT_ROOT, DEMO_FOLDER_RIGHT_ROOT)).toBe(true);
    expect(isDemoFolderRoots("/real/left", DEMO_FOLDER_RIGHT_ROOT)).toBe(false);
  });
});
