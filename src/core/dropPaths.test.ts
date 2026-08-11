import { describe, expect, it } from "vitest";
import {
  compareDropRejectionMessage,
  droppedFilePaths,
  dropPathUnavailableMessage,
  paneDropRejectionMessage,
} from "./dropPaths";

describe("droppedFilePaths", () => {
  it("extracts Tauri file paths without reading file contents", () => {
    expect(
      droppedFilePaths({
        files: {
          0: { path: "/left.txt" },
          1: { path: " /right.txt " },
          length: 2,
        },
      }),
    ).toEqual(["/left.txt", " /right.txt "]);
  });

  it("falls back to file URI lists", () => {
    expect(
      droppedFilePaths({
        files: { length: 0 },
        getData: (format) =>
          format === "text/uri-list"
            ? "# local files\nfile:///Users/example/a%20file.txt\nfile:///C:/Temp/right.txt"
            : "",
      }),
    ).toEqual(["/Users/example/a file.txt", "C:/Temp/right.txt"]);
  });

  it("ignores browser files that do not expose a local path", () => {
    expect(
      droppedFilePaths({
        files: {
          0: {},
          length: 1,
        },
      }),
    ).toEqual([]);
  });
});

describe("drop rejection messages", () => {
  it("requires exactly two paths for starting a compare session", () => {
    expect(compareDropRejectionMessage(0)).toBe(dropPathUnavailableMessage);
    expect(compareDropRejectionMessage(1)).toBe(
      "Drop exactly 2 files for 2-way compare. Current count: 1.",
    );
    expect(compareDropRejectionMessage(2)).toBeNull();
    expect(compareDropRejectionMessage(3)).toBe(
      "Drop exactly 2 files for 2-way compare. Current count: 3.",
    );
  });

  it("requires exactly one path for replacing one compare pane", () => {
    expect(paneDropRejectionMessage("left", 0)).toBe(dropPathUnavailableMessage);
    expect(paneDropRejectionMessage("right", 2)).toBe(
      "Drop exactly 1 file on the right side. Current count: 2.",
    );
    expect(paneDropRejectionMessage("left", 1)).toBeNull();
  });
});
