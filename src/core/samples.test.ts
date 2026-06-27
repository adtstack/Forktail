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

  it("does not create a compare session for one-sided entries", () => {
    const folder = demoFolderScanResult();
    const entry = folder.entries.find((item) => item.relativePath === "docs/guide.md");

    expect(entry).toBeDefined();
    expect(demoFolderEntryCompareSession(entry!)).toBeNull();
  });
});

describe("isDemoFolderRoots", () => {
  it("matches only the built-in demo folder roots", () => {
    expect(isDemoFolderRoots(DEMO_FOLDER_LEFT_ROOT, DEMO_FOLDER_RIGHT_ROOT)).toBe(true);
    expect(isDemoFolderRoots("/real/left", DEMO_FOLDER_RIGHT_ROOT)).toBe(false);
  });
});
