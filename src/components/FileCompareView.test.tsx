import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { CompareSession, FileDocument } from "../core/models";
import { FileCompareView, FileHeading } from "./FileCompareView";

vi.mock("../monaco", () => ({}));
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
      side="RIGHT"
      dropSide="right"
      dropActive={false}
      editing={editing}
      path={document.path}
      document={document}
      onCopyPath={() => {}}
      onDragOver={() => {}}
      onDragLeave={() => {}}
      onDrop={() => {}}
    />,
  );
}

function renderCompareView(session: CompareSession): string {
  return renderToStaticMarkup(
    <FileCompareView
      session={session}
      busy={false}
      editorTheme="vs"
      fileChangeNotice={null}
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
      onSaveSide={() => {}}
      onSaveSideAs={() => {}}
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
  it("warns that non-UTF-8 files are rewritten through the current UTF-8 save path", () => {
    const markup = renderCompareView({
      left: {
        ...document,
        path: "demo/legacy-left.txt",
        name: "legacy-left.txt",
        encoding: "UTF-16LE BOM",
      },
      right: document,
    });

    expect(markup).toContain("왼쪽:");
    expect(markup).toContain("UTF-8로 기록");
    expect(markup).toContain("UTF-16LE BOM");
  });
});
