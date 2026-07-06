import { describe, expect, it } from "vitest";
import {
  folderExpectedPath,
  isVirtualFileDocument,
  virtualMissingFileDocument,
} from "./virtualDocument";

describe("virtual missing file documents", () => {
  it("creates an empty compare-only document for a missing file side", () => {
    const document = virtualMissingFileDocument("/right/docs/guide.md");

    expect(document).toMatchObject({
      path: "/right/docs/guide.md",
      name: "guide.md",
      text: "",
      encoding: "Missing",
      lineEnding: "none",
      size: 0,
      modifiedMs: null,
      isBinary: false,
      decodeHadErrors: false,
      virtual: { kind: "missing" },
    });
    expect(isVirtualFileDocument(document)).toBe(true);
  });

  it("builds display paths for missing sides under the scan root", () => {
    expect(folderExpectedPath("/right", "docs/guide.md")).toBe("/right/docs/guide.md");
    expect(folderExpectedPath("/", "docs/guide.md")).toBe("/docs/guide.md");
    expect(folderExpectedPath("C:\\right", "config/prod.yml")).toBe(
      "C:\\right\\config\\prod.yml",
    );
  });
});
