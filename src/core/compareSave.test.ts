import { describe, expect, it } from "vitest";
import {
  compareSaveEncodingWarnings,
  compareSavePreconditionForPath,
  compareSaveStateAfterSideWrite,
  compareSaveStateAfterWrite,
  fileDocumentWithText,
  preservedSaveEncodingForDocument,
  saveEncodingWarningForDocument,
  writePreconditionFromDocument,
} from "./compareSave";
import type { CompareSession, FileDocument } from "./models";
import { virtualMissingFileDocument } from "./virtualDocument";

describe("compareSavePreconditionForPath", () => {
  it("uses the saved right version when saving over the current right file", () => {
    const session = compareSession();

    expect(
      compareSavePreconditionForPath(session, "/repo/right.txt", {
        expectedSize: 42,
        expectedModifiedMs: 3000,
        expectedContentHash: "saved-right-hash",
      }),
    ).toEqual({
      expectedSize: 42,
      expectedModifiedMs: 3000,
      expectedContentHash: "saved-right-hash",
    });
  });

  it("guards known input paths and leaves arbitrary Save As paths unguarded", () => {
    const session = compareSession();

    expect(compareSavePreconditionForPath(session, "/repo/left.txt", null)).toEqual({
      expectedSize: 9,
      expectedModifiedMs: 1000,
      expectedContentHash: "left-open-hash",
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
          expectedContentHash: "saved-left-hash",
        },
        "left",
      ),
    ).toEqual({
      expectedSize: 99,
      expectedModifiedMs: 9000,
      expectedContentHash: "saved-left-hash",
    });
    expect(compareSavePreconditionForPath(session, "/repo/right.txt", null, "left")).toEqual({
      expectedSize: 6,
      expectedModifiedMs: 1001,
      expectedContentHash: "right-open-hash",
    });
  });

  it("does not create save preconditions for virtual missing documents", () => {
    const session = {
      ...compareSession(),
      right: virtualMissingFileDocument("/repo/right.txt"),
    };

    expect(compareSavePreconditionForPath(session, "/repo/right.txt", null)).toBeNull();
    expect(compareSavePreconditionForPath(session, "/repo/right.txt", null, "left")).toBeNull();
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
        contentHash: "written-right-hash",
      }),
    ).toEqual({
      session: {
        origin: "files",
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
          contentHash: "written-right-hash",
          decodeHadErrors: false,
        },
      },
      savedRightSnapshot: "안녕\r\nworld",
      rightVersion: {
        expectedSize: 13,
        expectedModifiedMs: 4000,
        expectedContentHash: "written-right-hash",
      },
      message: "Saved · backup: C:\\out\\copy.txt.bak",
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
        contentHash: "written-left-hash",
      }),
    ).toEqual({
      session: {
        origin: "files",
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
          contentHash: "written-left-hash",
          decodeHadErrors: false,
        },
        right: session.right,
      },
      savedSnapshot: "new left\n",
      outputVersion: {
        expectedSize: 9,
        expectedModifiedMs: 5000,
        expectedContentHash: "written-left-hash",
      },
      message: "Saved",
    });
  });

  it("keeps a supported original save encoding after write", () => {
    const session = {
      ...compareSession(),
      right: {
        ...compareSession().right,
        encoding: "UTF-16LE BOM",
      },
    };

    expect(
      compareSaveStateAfterWrite(session, "new right\n", {
        path: "/repo/right.txt",
        backupPath: null,
        size: 22,
        modifiedMs: 6000,
        contentHash: "written-utf16-hash",
      }).session.right,
    ).toMatchObject({
      text: "new right\n",
      encoding: "UTF-16LE BOM",
      size: 22,
      modifiedMs: 6000,
      contentHash: "written-utf16-hash",
      decodeHadErrors: false,
    });
  });

  it("records UTF-8 metadata when an unsupported source encoding is converted", () => {
    const session = {
      ...compareSession(),
      right: {
        ...compareSession().right,
        encoding: "windows-1252",
      },
    };

    expect(
      compareSaveStateAfterWrite(session, "café\n", {
        path: "/repo/right.txt",
        backupPath: null,
        size: 6,
        modifiedMs: 7000,
        contentHash: "written-utf8-hash",
      }).session.right.encoding,
    ).toBe("UTF-8");
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

  it("does not warn when the current save path can preserve a supported BOM encoding", () => {
    expect(
      saveEncodingWarningForDocument({
        ...document("/repo/legacy.txt", "hello\n"),
        encoding: "UTF-16LE BOM",
      }),
    ).toBeNull();
  });

  it("warns when the current save path would rewrite an unsupported encoding as UTF-8", () => {
    expect(
      saveEncodingWarningForDocument({
        ...document("/repo/legacy.txt", "hello\n"),
        encoding: "windows-1252",
      }),
    ).toContain("writes UTF-8");
  });

  it("warns when a UTF-8 output save cannot preserve a source BOM encoding", () => {
    expect(
      saveEncodingWarningForDocument(
        {
          ...document("/repo/bom.txt", "hello\n"),
          encoding: "UTF-8 BOM",
        },
        "utf8",
      ),
    ).toContain("writes UTF-8");
  });

  it("warns when decode errors may already have lost characters", () => {
    expect(
      saveEncodingWarningForDocument({
        ...document("/repo/bad.txt", "hello\n"),
        decodeHadErrors: true,
      }),
    ).toContain("decode loss");
  });
});

describe("compareSaveEncodingWarnings", () => {
  it("labels each side that may not be byte-identical after save", () => {
    const session = compareSession();
    const warnings = compareSaveEncodingWarnings({
      ...session,
      left: {
        ...session.left,
        encoding: "windows-1252",
      },
      right: {
        ...session.right,
        decodeHadErrors: true,
      },
    });

    expect(warnings).toMatchObject([
      { side: "left", label: "Left" },
      { side: "right", label: "Right" },
    ]);
  });

  it("skips virtual missing documents", () => {
    const session = {
      ...compareSession(),
      left: virtualMissingFileDocument("/repo/left.txt"),
      right: {
        ...compareSession().right,
        encoding: "windows-1252",
      },
    };

    expect(compareSaveEncodingWarnings(session)).toMatchObject([
      { side: "right", label: "Right" },
    ]);
  });
});

describe("preservedSaveEncodingForDocument", () => {
  it("normalizes supported save encodings and falls back to UTF-8 for unsupported encodings", () => {
    expect(preservedSaveEncodingForDocument({ encoding: "utf-8 bom" })).toBe("UTF-8 BOM");
    expect(preservedSaveEncodingForDocument({ encoding: "UTF-16BE BOM" })).toBe("UTF-16BE BOM");
    expect(preservedSaveEncodingForDocument({ encoding: "windows-1252" })).toBe("UTF-8");
  });
});

describe("writePreconditionFromDocument", () => {
  it("copies size, modified time, and the opened byte hash into a write precondition", () => {
    expect(writePreconditionFromDocument(document("/repo/right.txt", "right\n"))).toEqual({
      expectedSize: 6,
      expectedModifiedMs: 1001,
      expectedContentHash: "right-open-hash",
    });
  });
});

function compareSession(): CompareSession {
  return {
    origin: "files",
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
    contentHash: path.includes("left") ? "left-open-hash" : "right-open-hash",
    isBinary: false,
    decodeHadErrors: false,
  };
}
