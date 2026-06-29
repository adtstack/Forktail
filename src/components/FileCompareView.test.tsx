import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { CompareFileChangeNotice } from "../core/fileVersion";
import { FILE_COMPARE_TEXT } from "../core/i18n";
import type { CompareSession, FileDocument } from "../core/models";
import { activeChangedCompareSide, FileCompareView, FileHeading } from "./FileCompareView";

vi.mock("../monaco", () => ({
  loadMonacoLanguage: () => Promise.resolve(),
}));
vi.mock("@monaco-editor/react", () => ({
  DiffEditor: () => <div role="textbox" />,
}));

const document: FileDocument = {
  path: "demo/right.ts",
  name: "right.ts",
  text: "right\n",
  encoding: "UTF-8",
  lineEnding: "lf",
  hadFinalNewline: true,
  size: 6,
  modifiedMs: null,
  isBinary: false,
  decodeHadErrors: false,
};

function renderHeading(editing: boolean): string {
  return renderToStaticMarkup(
    <FileHeading
      sideLabel="RIGHT"
      sideName="Right"
      dropSide="right"
      dropActive={false}
      editing={editing}
      path={document.path}
      document={document}
      text={FILE_COMPARE_TEXT.en}
      onCopyPath={() => {}}
      onDragOver={() => {}}
      onDragLeave={() => {}}
      onDrop={() => {}}
    />,
  );
}

function renderCompareView(
  session: CompareSession,
  fileChangeNotice: CompareFileChangeNotice | null = null,
): string {
  return renderToStaticMarkup(
    <FileCompareView
      session={session}
      busy={false}
      editorTheme="vs"
      fileChangeNotice={fileChangeNotice}
      modelRevision={0}
      dirtySides={{ left: false, right: false }}
      onBack={() => {}}
      onCheckFileVersions={() => {}}
      onKeepCurrentFiles={() => {}}
      onReloadChangedFiles={() => {}}
      onTextChange={() => {}}
      onDropFileOnSide={() => {}}
      onDropRejected={() => {}}
      onExportReport={() => {}}
      onOverwriteChangedFile={() => {}}
      onSaveSide={() => {}}
      onSaveSideAs={() => {}}
      onShowBackups={() => {}}
      onSwap={() => {}}
    />,
  );
}

describe("FileHeading", () => {
  it("marks the editable pane with an EDITING badge", () => {
    expect(renderHeading(true)).toContain("EDITING");
    expect(renderHeading(false)).not.toContain("EDITING");
  });
});

describe("FileCompareView save encoding warning", () => {
  it("warns that unsupported legacy encodings are rewritten through the UTF-8 fallback save path", () => {
    const markup = renderCompareView({
      left: {
        ...document,
        path: "demo/legacy-left.txt",
        name: "legacy-left.txt",
        encoding: "windows-1252",
      },
      right: document,
    });

    expect(markup).toContain("Left:");
    expect(markup).toContain("writes UTF-8");
    expect(markup).toContain("windows-1252");
  });
});

describe("FileCompareView TXT controls", () => {
  it("renders diff navigation, compare options, save, hunk copy, and report controls", () => {
    const markup = renderCompareView({
      left: { ...document, path: "demo/left.ts", name: "left.ts", text: "left\n" },
      right: document,
    });

    for (const label of [
      "Prev",
      "Next",
      "L -&gt; R",
      "R -&gt; L",
      "Undo hunk",
      "Save",
      "Save As",
      "Backups",
      "Export",
      "Save EOL",
      "Original",
      "System",
      "Whitespace",
      "Trim end",
      "Ignore all",
      "Ignore case",
      "Ignore EOL",
      "Wrap",
      "Spaces",
      "Loop",
    ]) {
      expect(markup).toContain(label);
    }
    expect(markup).toContain("aria-keyshortcuts=\"Shift+F7\"");
    expect(markup).toContain("aria-keyshortcuts=\"F7\"");
    expect(markup).toContain("aria-live=\"polite\"");
  });

  it("shows final-newline and external-change recovery actions", () => {
    const markup = renderCompareView(
      {
        left: {
          ...document,
          path: "demo/left.ts",
          name: "left.ts",
          hadFinalNewline: false,
        },
        right: document,
      },
      {
        leftChanged: true,
        rightChanged: false,
        message: "Left file changed after it was opened. Reload or keep the current compare content.",
        versionKey: "left:changed|right:same",
      },
    );

    expect(markup).toContain("Left file has no final newline.");
    expect(markup).toContain("Reload");
    expect(markup).toContain("Keep Current");
    expect(markup).toContain("Check Again");
  });
});

describe("activeChangedCompareSide", () => {
  it("enables overwrite and copy actions only for the changed editable side", () => {
    const notice: CompareFileChangeNotice = {
      leftChanged: true,
      rightChanged: false,
      message: "Left file changed after it was opened.",
      versionKey: "left-changed",
    };

    expect(activeChangedCompareSide(notice, "left")).toBe("left");
    expect(activeChangedCompareSide(notice, "right")).toBeNull();
    expect(activeChangedCompareSide(notice, "none")).toBeNull();
    expect(activeChangedCompareSide(null, "left")).toBeNull();
  });
});
