import { describe, expect, it } from "vitest";
import {
  compareSaveEncodingWarnings,
  compareSavePreconditionForPath,
  compareSaveStateAfterSideWrite,
  compareSaveStateAfterWrite,
  fileDocumentWithText,
  saveEncodingWarningForDocument,
  writePreconditionFromDocument,
} from "./compareSave";
import type { CompareSession, FileDocument } from "./models";

describe("compareSavePreconditionForPath", () => {
  it("uses the saved right version when saving over the current right file", () => {
    const session = compareSession();

    expect(
      compareSavePreconditionForPath(session, "/repo/right.txt", {
        expectedSize: 42,
        expectedModifiedMs: 3000,
      }),
    ).toEqual({
      expectedSize: 42,
      expectedModifiedMs: 3000,
    });
  });

  it("guards known input paths and leaves arbitrary Save As paths unguarded", () => {
    const session = compareSession();

    expect(compareSavePreconditionForPath(session, "/repo/left.txt", null)).toEqual({
      expectedSize: 9,
      expectedModifiedMs: 1000,
    });
    expect(compareSavePreconditionForPath(session, "/tmp/copy.txt", null)).toBeNull();
  });

  it("uses the selected side version and guards the opposite path", () => {
    const session = compareSession();

    expect(
      compareSavePreconditionForPath(
        session,
        "/repo/left.txt",
        {
          expectedSize: 99,
          expectedModifiedMs: 9000,
        },
        "left",
      ),
    ).toEqual({
      expectedSize: 99,
      expectedModifiedMs: 9000,
    });
    expect(compareSavePreconditionForPath(session, "/repo/right.txt", null, "left")).toEqual({
      expectedSize: 6,
      expectedModifiedMs: 1001,
    });
  });
});

describe("compareSaveStateAfterWrite", () => {
  it("updates the right document and clean snapshot after Save As", () => {
    const session = compareSession();

    expect(
      compareSaveStateAfterWrite(session, "안녕\r\nworld", {
        path: "C:\\out\\copy.txt",
        backupPath: "C:\\out\\copy.txt.bak",
        size: 13,
        modifiedMs: 4000,
      }),
    ).toEqual({
      session: {
        left: session.left,
        right: {
          ...session.right,
          path: "C:\\out\\copy.txt",
          name: "copy.txt",
          text: "안녕\r\nworld",
          encoding: "UTF-8",
          lineEnding: "crlf",
          hadFinalNewline: false,
          size: 13,
          modifiedMs: 4000,
          decodeHadErrors: false,
        },
      },
      savedRightSnapshot: "안녕\r\nworld",
      rightVersion: {
        expectedSize: 13,
        expectedModifiedMs: 4000,
      },
      message: "저장 완료 · 백업: C:\\out\\copy.txt.bak",
    });
  });

  it("updates the selected left document after Save As", () => {
    const session = compareSession();

    expect(
      compareSaveStateAfterSideWrite(session, "left", "new left\n", {
        path: "/out/left-copy.txt",
        backupPath: null,
        size: 9,
        modifiedMs: 5000,
      }),
    ).toEqual({
      session: {
        left: {
          ...session.left,
          path: "/out/left-copy.txt",
          name: "left-copy.txt",
          text: "new left\n",
          encoding: "UTF-8",
          lineEnding: "lf",
          hadFinalNewline: true,
          size: 9,
          modifiedMs: 5000,
          decodeHadErrors: false,
        },
        right: session.right,
      },
      savedSnapshot: "new left\n",
      outputVersion: {
        expectedSize: 9,
        expectedModifiedMs: 5000,
      },
      message: "저장 완료",
    });
  });
});

describe("fileDocumentWithText", () => {
  it("updates draft metadata from the current text", () => {
    expect(fileDocumentWithText(document("/repo/right.txt", "old\n"), "a\rb\nc\r\n")).toMatchObject({
      text: "a\rb\nc\r\n",
      lineEnding: "mixed",
      hadFinalNewline: true,
      size: 7,
    });
  });
});

describe("saveEncodingWarningForDocument", () => {
  it("does not warn for plain UTF-8 documents without decode errors", () => {
    expect(saveEncodingWarningForDocument(document("/repo/right.txt", "right\n"))).toBeNull();
  });

  it("warns when the current save path would rewrite a non-UTF-8 document as UTF-8", () => {
    expect(
      saveEncodingWarningForDocument({
        ...document("/repo/legacy.txt", "hello\n"),
        encoding: "UTF-16LE BOM",
      }),
    ).toContain("UTF-8로 기록");
  });

  it("warns when decode errors may already have lost characters", () => {
    expect(
      saveEncodingWarningForDocument({
        ...document("/repo/bad.txt", "hello\n"),
        decodeHadErrors: true,
      }),
    ).toContain("디코딩 손실");
  });
});

describe("compareSaveEncodingWarnings", () => {
  it("labels each side that may not be byte-identical after save", () => {
    const session = compareSession();
    const warnings = compareSaveEncodingWarnings({
      ...session,
      left: {
        ...session.left,
        encoding: "UTF-8 BOM",
      },
      right: {
        ...session.right,
        decodeHadErrors: true,
      },
    });

    expect(warnings).toMatchObject([
      { side: "left", label: "왼쪽" },
      { side: "right", label: "오른쪽" },
    ]);
  });
});

describe("writePreconditionFromDocument", () => {
  it("copies size and modified time into a write precondition", () => {
    expect(writePreconditionFromDocument(document("/repo/right.txt", "right\n"))).toEqual({
      expectedSize: 6,
      expectedModifiedMs: 1001,
    });
  });
});

function compareSession(): CompareSession {
  return {
    left: document("/repo/left.txt", "left\ntext"),
    right: document("/repo/right.txt", "right\n"),
  };
}

function document(path: string, text: string): FileDocument {
  return {
    path,
    name: path.split("/").pop() ?? path,
    text,
    encoding: "UTF-8",
    lineEnding: "lf",
    hadFinalNewline: text.endsWith("\n"),
    size: new TextEncoder().encode(text).byteLength,
    modifiedMs: path.includes("left") ? 1000 : 1001,
    isBinary: false,
    decodeHadErrors: false,
  };
}
