import { describe, expect, it } from "vitest";
import {
  buildCompareFileChangeNotice,
  compareFileChangeVersionKey,
  fileDocumentVersionChanged,
} from "./fileVersion";
import type { FileDocument, FileVersion } from "./models";
import { virtualMissingFileDocument } from "./virtualDocument";

function document(path: string, size: number, modifiedMs: number | null): FileDocument {
  return {
    path,
    name: path.split("/").pop() ?? path,
    text: "",
    encoding: "UTF-8",
    lineEnding: "lf",
    hadFinalNewline: true,
    size,
    modifiedMs,
    isBinary: false,
    decodeHadErrors: false,
  };
}

function version(path: string, size: number, modifiedMs: number | null): FileVersion {
  return { path, size, modifiedMs };
}

describe("fileDocumentVersionChanged", () => {
  it("compares opened document version by size and modified time only", () => {
    const opened = document("/work/left.txt", 10, 1000);

    expect(fileDocumentVersionChanged(opened, version("/work/left.txt", 10, 1000))).toBe(false);
    expect(fileDocumentVersionChanged(opened, version("/work/left.txt", 11, 1000))).toBe(true);
    expect(fileDocumentVersionChanged(opened, version("/work/left.txt", 10, 2000))).toBe(true);
    expect(fileDocumentVersionChanged(opened, null)).toBe(true);
  });

  it("does not report virtual missing documents as externally changed", () => {
    expect(fileDocumentVersionChanged(virtualMissingFileDocument("/work/missing.txt"), null))
      .toBe(false);
  });
});

describe("buildCompareFileChangeNotice", () => {
  it("returns null when both files still match the opened versions", () => {
    const session = {
      left: document("/work/left.txt", 10, 1000),
      right: document("/work/right.txt", 20, 2000),
    };

    expect(
      buildCompareFileChangeNotice(
        session,
        version("/work/left.txt", 10, 1000),
        version("/work/right.txt", 20, 2000),
      ),
    ).toBeNull();
  });

  it("describes which compare side changed", () => {
    const session = {
      left: document("/work/left.txt", 10, 1000),
      right: document("/work/right.txt", 20, 2000),
    };

    expect(
      buildCompareFileChangeNotice(
        session,
        version("/work/left.txt", 10, 1000),
        version("/work/right.txt", 25, 2000),
      ),
    ).toMatchObject({
      leftChanged: false,
      rightChanged: true,
      message: "Right file changed after it was opened. Reload or keep the current compare content.",
    });
    expect(
      buildCompareFileChangeNotice(session, null, version("/work/right.txt", 25, 2000)),
    ).toMatchObject({
      leftChanged: true,
      rightChanged: true,
      message: "Left and Right file changed after it was opened. Reload or keep the current compare content.",
    });
  });

  it("ignores virtual missing sides when building change notices", () => {
    const session = {
      left: virtualMissingFileDocument("/work/left.txt"),
      right: document("/work/right.txt", 20, 2000),
    };

    expect(
      buildCompareFileChangeNotice(session, null, version("/work/right.txt", 20, 2000)),
    ).toBeNull();
  });
});

describe("compareFileChangeVersionKey", () => {
  it("builds a stable suppression key for observed file versions", () => {
    expect(
      compareFileChangeVersionKey(
        version("/work/left.txt", 10, null),
        version("/work/right.txt", 20, 2000),
      ),
    ).toBe("left:/work/left.txt:10:unknown|right:/work/right.txt:20:2000");
    expect(compareFileChangeVersionKey(null, null)).toBe("left:unavailable|right:unavailable");
  });
});
