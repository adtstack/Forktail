import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { CompareFileChangeNotice } from "../core/fileVersion";
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

    expect(markup).toContain("왼쪽:");
    expect(markup).toContain("UTF-8로 기록");
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
      "이전 변경",
      "다음 변경",
      "왼쪽→오른쪽",
      "오른쪽→왼쪽",
      "hunk 되돌리기",
      "저장",
      "다른 이름으로 저장",
      "백업 복원",
      "리포트 저장",
      "저장 EOL",
      "원본",
      "시스템",
      "공백",
      "끝 무시",
      "전체 무시",
      "Aa 무시",
      "EOL 무시",
      "줄바꿈",
      "공백 표시",
      "순환",
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
        message: "왼쪽 파일이 열린 뒤 변경됐습니다. 다시 읽거나 현재 비교 내용을 유지하세요.",
        versionKey: "left:changed|right:same",
      },
    );

    expect(markup).toContain("왼쪽 파일에 마지막 개행이 없습니다.");
    expect(markup).toContain("다시 읽기");
    expect(markup).toContain("현재 내용 유지");
    expect(markup).toContain("다시 확인");
  });
});

describe("activeChangedCompareSide", () => {
  it("enables overwrite and copy actions only for the changed editable side", () => {
    const notice: CompareFileChangeNotice = {
      leftChanged: true,
      rightChanged: false,
      message: "왼쪽 파일이 열린 뒤 변경됐습니다.",
      versionKey: "left-changed",
    };

    expect(activeChangedCompareSide(notice, "left")).toBe("left");
    expect(activeChangedCompareSide(notice, "right")).toBeNull();
    expect(activeChangedCompareSide(notice, "none")).toBeNull();
    expect(activeChangedCompareSide(null, "left")).toBeNull();
  });
});
