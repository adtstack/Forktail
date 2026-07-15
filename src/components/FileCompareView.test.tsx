import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { CompareFileChangeNotice } from "../core/fileVersion";
import { FILE_COMPARE_TEXT } from "../core/i18n";
import type { CompareSession, FileDocument } from "../core/models";
import { virtualMissingFileDocument } from "../core/virtualDocument";
import {
  activeChangedCompareSide,
  FileCompareView,
  FileHeading,
  isFileCompareCommandAllowed,
} from "./FileCompareView";

vi.mock("../monaco", () => ({
  loadMonacoLanguage: () => Promise.resolve(),
}));
vi.mock("@monaco-editor/react", () => ({
  DiffEditor: ({
    options,
  }: {
    options: { originalEditable?: boolean; readOnly?: boolean };
  }) => (
    <div
      role="textbox"
      data-original-editable={String(options.originalEditable)}
      data-modified-read-only={String(options.readOnly)}
    />
  ),
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
  backLabel?: string,
): string {
  return renderToStaticMarkup(
    <FileCompareView
      session={session}
      busy={false}
      editorTheme="vs"
      fileChangeNotice={fileChangeNotice}
      modelRevision={0}
      dirtySides={{ left: false, right: false }}
      backLabel={backLabel}
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

function buttonMarkup(markup: string, label: string): string {
  const match = markup.match(new RegExp(`<button[^>]*>\\s*${label}\\s*</button>`));
  if (!match) throw new Error(`Button not found: ${label}`);
  return match[0];
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
      origin: "files",
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
      origin: "files",
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
    expect(buttonMarkup(markup, "Swap")).not.toContain("disabled");
    expect(buttonMarkup(markup, "Export")).not.toContain("disabled");
    expect(markup).toContain('<select class="toolbar-select"><option value="none"');
  });

  it("uses a custom back label for folder-originated compare sessions", () => {
    const markup = renderCompareView({
      origin: "files",
      left: { ...document, path: "demo/left.ts", name: "left.ts", text: "left\n" },
      right: document,
    }, null, "Folder Results");

    expect(markup).toContain(">Folder Results</button>");
  });

  it("shows a virtual missing side without making it editable", () => {
    const markup = renderCompareView({
      origin: "files",
      left: { ...document, path: "demo/left.ts", name: "left.ts", text: "left\n" },
      right: virtualMissingFileDocument("/demo/right/left.ts"),
    });

    expect(markup).toContain("Missing");
    expect(markup).toContain("empty virtual file");
    expect(markup).toContain("<option value=\"right\" disabled=\"\">Right (Missing)</option>");
    expect(markup).toContain("Missing · 0 B");
  });

  it("shows final-newline and external-change recovery actions", () => {
    const markup = renderCompareView(
      {
        origin: "files",
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

  it("keeps Git difftool inputs read-only while retaining report export and close", () => {
    const markup = renderCompareView({
      origin: "difftool",
      left: { ...document, path: "/tmp/git-local", name: "feature.ts", text: "left\n" },
      right: { ...document, path: "/tmp/git-remote", name: "feature.ts", text: "right\n" },
    });

    expect(markup).toContain("GIT DIFFTOOL");
    expect(markup).toContain("temporary read-only snapshots");
    expect(buttonMarkup(markup, "Close Forktail")).not.toContain("disabled");
    expect(markup).not.toContain(">Home</button>");
    expect(markup).toContain('data-original-editable="false"');
    expect(markup).toContain('data-modified-read-only="true"');

    for (const label of [
      "Swap",
      "L -&gt; R",
      "R -&gt; L",
      "Undo hunk",
      "Save",
      "Save As",
      "Backups",
    ]) {
      expect(buttonMarkup(markup, label)).toContain("disabled");
    }
    expect(buttonMarkup(markup, "Export")).not.toContain("disabled");
    expect(markup).toContain('<select class="toolbar-select" disabled=""><option value="none"');
    expect(markup.match(/aria-disabled="true"/g)).toHaveLength(2);
  });

  it("preserves the missing-side presentation for read-only difftool input", () => {
    const markup = renderCompareView({
      origin: "difftool",
      left: virtualMissingFileDocument("/tmp/git-local"),
      right: { ...document, path: "/tmp/git-remote", name: "feature.ts", text: "right\n" },
    });

    expect(markup).toContain("Missing");
    expect(markup).toContain("empty virtual file");
    expect(markup).toContain("Missing · 0 B");
    expect(buttonMarkup(markup, "Export")).not.toContain("disabled");
  });

  it("blocks save and swap commands for difftool sessions before callbacks run", () => {
    const session = {
      origin: "difftool",
      left: document,
      right: document,
    } satisfies CompareSession;

    expect(isFileCompareCommandAllowed(session, "save")).toBe(false);
    expect(isFileCompareCommandAllowed(session, "saveAs")).toBe(false);
    expect(isFileCompareCommandAllowed(session, "swapSides")).toBe(false);
    expect(isFileCompareCommandAllowed(session, "nextDiff")).toBe(true);
  });

  it("labels committed Git snapshots and keeps every mutation control disabled", () => {
    const left = {
      ...document,
      path: "main~1 (aaaaaaaaaaaa) · src/feature.ts",
      name: "feature.ts",
      text: "left\n",
      virtual: { kind: "gitSnapshot" as const, contentState: "text" as const },
    };
    const right = {
      ...document,
      path: "main (bbbbbbbbbbbb) · src/feature.ts",
      name: "feature.ts",
      text: "right\n",
      virtual: { kind: "gitSnapshot" as const, contentState: "text" as const },
    };
    const session = {
      origin: "git" as const,
      left,
      right,
      snapshot: {
        repositoryId: "repository-session-1",
        left: {
          origin: "committedBlob" as const,
          label: left.path,
          readOnly: true,
          objectId: { algorithm: "sha1" as const, hex: "c".repeat(40) },
          path: { opaqueId: "path:left", displayPath: "src/feature.ts", utf8Path: "src/feature.ts" },
          mode: "100644",
          textMetadata: {
            encoding: "UTF-8",
            lineEnding: "lf" as const,
            hadFinalNewline: true,
            decodeHadErrors: false,
            size: 5,
          },
          contentState: { kind: "text" as const, text: "left\n" },
        },
        right: {
          origin: "committedBlob" as const,
          label: right.path,
          readOnly: true,
          objectId: { algorithm: "sha1" as const, hex: "d".repeat(40) },
          path: { opaqueId: "path:right", displayPath: "src/feature.ts", utf8Path: "src/feature.ts" },
          mode: "100644",
          textMetadata: {
            encoding: "UTF-8",
            lineEnding: "lf" as const,
            hadFinalNewline: true,
            decodeHadErrors: false,
            size: 6,
          },
          contentState: { kind: "text" as const, text: "right\n" },
        },
        sourceKind: "revisionPair" as const,
        revisionPair: {
          left: {
            rawLabel: "main~1",
            resolved: { algorithm: "sha1" as const, hex: "a".repeat(40) },
            kind: "symbolic" as const,
            displayName: "main~1",
          },
          right: {
            rawLabel: "main",
            resolved: { algorithm: "sha1" as const, hex: "b".repeat(40) },
            kind: "branch" as const,
            displayName: "main",
          },
        },
        capabilities: {
          edit: false,
          save: false,
          hunkCopy: false,
          exportPatch: true,
        },
        generation: 4,
      },
    } satisfies CompareSession;
    const markup = renderCompareView(session, null, "Repository review");

    expect(markup).toContain("GIT SNAPSHOT");
    expect(markup).toContain("Committed snapshots are read-only");
    expect(markup).toContain("main~1 (aaaaaaaaaaaa) · src/feature.ts");
    expect(markup).toContain(">Repository review</button>");
    expect(markup).toContain('data-original-editable="false"');
    expect(markup).toContain('data-modified-read-only="true"');
    for (const label of ["Swap", "L -&gt; R", "R -&gt; L", "Undo hunk", "Save", "Save As", "Backups"]) {
      expect(buttonMarkup(markup, label)).toContain("disabled");
    }
    expect(buttonMarkup(markup, "Export")).not.toContain("disabled");
    expect(isFileCompareCommandAllowed(session, "save")).toBe(false);
    expect(isFileCompareCommandAllowed(session, "swapSides")).toBe(false);
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
