import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { CompareFileChangeNotice } from "../core/fileVersion";
import { FILE_COMPARE_TEXT } from "../core/i18n";
import type { CompareSession, FileDocument } from "../core/models";
import { compareSessionCapabilities } from "../core/difftoolSession";
import { virtualMissingFileDocument } from "../core/virtualDocument";
import {
  activeChangedCompareSide,
  activeCompareHunkIndexAtLine,
  bindFileCompareNavigation,
  FileCompareView,
  FileHeading,
  isFileCompareCommandAllowed,
} from "./FileCompareView";
import type { EditorNavigationHandle, MonacoNavigationEditor } from "../core/monacoNavigation";

const fileCompareViewSource = readFileSync(new URL("./FileCompareView.tsx", import.meta.url), "utf8");

vi.mock("../monaco", () => ({
  loadMonacoLanguage: () => Promise.resolve(),
}));
vi.mock("@monaco-editor/react", () => ({
  DiffEditor: ({
    options,
    original,
    modified,
    originalModelPath,
    modifiedModelPath,
    keepCurrentOriginalModel = false,
    keepCurrentModifiedModel = false,
  }: {
    options: { originalEditable?: boolean; readOnly?: boolean };
    original?: string;
    modified?: string;
    originalModelPath?: string;
    modifiedModelPath?: string;
    keepCurrentOriginalModel?: boolean;
    keepCurrentModifiedModel?: boolean;
  }) => (
    <div
      role="textbox"
      data-original-editable={String(options.originalEditable)}
      data-modified-read-only={String(options.readOnly)}
      data-original-text={original}
      data-modified-text={modified}
      data-original-model-path={originalModelPath}
      data-modified-model-path={modifiedModelPath}
      data-original-model-lifecycle={
        keepCurrentOriginalModel ? "retain-after-unmount" : "dispose-on-unmount"
      }
      data-modified-model-lifecycle={
        keepCurrentModifiedModel ? "retain-after-unmount" : "dispose-on-unmount"
      }
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
  modelIdentity?: string,
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
      modelIdentity={modelIdentity}
      persistViewSettings={modelIdentity == null}
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

function withStoredDiffOptions<T>(callback: () => T): T {
  const previousDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const settings = JSON.stringify({
    diffOptions: {
      whitespace: "all",
      ignoreCase: true,
      ignoreLineEndings: true,
    },
    renderWhitespace: "selection",
    saveLineEnding: "original",
    sideBySide: true,
    wordWrap: "off",
    wrapAround: true,
  });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => key === "forktail.compare-view.v1" ? settings : null,
      setItem: () => {},
    },
  });

  try {
    return callback();
  } finally {
    if (previousDescriptor) {
      Object.defineProperty(globalThis, "localStorage", previousDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, "localStorage");
    }
  }
}

describe("FileHeading", () => {
  it("marks the editable pane with an EDITING badge", () => {
    expect(renderHeading(true)).toContain("EDITING");
    expect(renderHeading(false)).not.toContain("EDITING");
  });

  it("exposes its exact side as the native desktop drop target", () => {
    expect(renderHeading(false)).toContain('data-compare-drop-side="right"');
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
  it("keeps the wrapper from disposing source models before the keyed editor widget", () => {
    const markup = renderCompareView({
      origin: "files",
      left: { ...document, path: "demo/left.ts", name: "left.ts", text: "left\n" },
      right: document,
    });

    expect(markup).toContain('data-original-model-lifecycle="retain-after-unmount"');
    expect(markup).toContain('data-modified-model-lifecycle="retain-after-unmount"');
    expect(markup).toContain(
      'data-original-model-path="forktail://original/0/view/demo%2Fleft.ts"',
    );
    expect(markup).toContain(
      'data-modified-model-path="forktail://modified/0/view/demo%2Fright.ts"',
    );
    expect(fileCompareViewSource).toContain("key={diffEditorModelKey}");
    expect(fileCompareViewSource).toContain("retainExactTextDiffSourceModels(instance)");
    expect(fileCompareViewSource).toContain("sourceModelOwnershipRef.current?.dispose()");
  });

  it("keeps exact source text in Monaco while ignore options classify the diff", () => {
    const left = "Total = A + B  \r\n";
    const right = "total=a+b\n";
    const markup = withStoredDiffOptions(() => renderCompareView({
      origin: "files",
      left: { ...document, path: "demo/left.ts", name: "left.ts", text: left },
      right: { ...document, text: right },
    }));

    expect(markup).toContain(`data-original-text="${left}"`);
    expect(markup).toContain(`data-modified-text="${right}"`);
    expect(markup).not.toContain('data-original-text="total=a+b\n"');
  });

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

  it("keeps detached folder review mutation-free with opaque Monaco model paths", () => {
    const session = {
      origin: "folderReview",
      left: { ...document, path: "/private/left/src/main.rs", name: "main.rs" },
      right: { ...document, path: "/private/right/src/main.rs", name: "main.rs" },
    } satisfies CompareSession;
    const markup = renderCompareView(session, null, "Close", "detached-model-42");

    expect(markup).toContain("FOLDER REVIEW");
    expect(markup).toContain('data-original-model-path="forktail://detached/detached-model-42/left/0"');
    expect(markup).toContain('data-modified-model-path="forktail://detached/detached-model-42/right/0"');
    expect(markup).not.toContain("forktail%3A%2F%2F");
    for (const label of [
      "Swap",
      "L -&gt; R",
      "R -&gt; L",
      "Undo hunk",
      "Save",
      "Save As",
      "Backups",
      "Export",
    ]) {
      expect(buttonMarkup(markup, label)).toContain("disabled");
    }
    expect(compareSessionCapabilities(session)).toEqual({
      edit: false,
      save: false,
      saveAs: false,
      backupRestore: false,
      hunkCopy: false,
      replaceInput: false,
      swap: false,
      persistPaths: false,
      exportReport: false,
    });
  });

  it("keeps detached folder review Monaco text exact when ignore options are enabled", () => {
    const left = "Folder VALUE\t \r\n";
    const right = "foldervalue\n";
    const session = {
      origin: "folderReview",
      left: { ...document, path: "/private/left/value.txt", name: "value.txt", text: left },
      right: { ...document, path: "/private/right/value.txt", name: "value.txt", text: right },
    } satisfies CompareSession;
    const markup = withStoredDiffOptions(() =>
      renderCompareView(session, null, "Close", "detached-model-43"),
    );

    expect(markup).toContain(`data-original-text="${left}"`);
    expect(markup).toContain(`data-modified-text="${right}"`);
    expect(markup).toContain(
      'data-original-model-path="forktail://detached/detached-model-43/left/0"',
    );
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
          workingTreeVersion: null,
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
          workingTreeVersion: null,
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
        revision: null,
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
    expect(markup).toContain("Git snapshot inputs are read-only");
    expect(markup).toContain("main~1 (aaaaaaaaaaaa) · src/feature.ts");
    expect(markup).toContain(">Repository review</button>");
    expect(markup).toContain('data-original-editable="false"');
    expect(markup).toContain('data-modified-read-only="true"');
    for (const label of ["Swap", "L -&gt; R", "R -&gt; L", "Undo hunk", "Save", "Save As", "Backups"]) {
      expect(buttonMarkup(markup, label)).toContain("disabled");
    }
    expect(buttonMarkup(markup, "Save patch as")).not.toContain("disabled");
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

describe("FileCompareView navigation lifecycle", () => {
  it("registers both panes, records explicit jumps, and disposes all bindings", () => {
    const original = navigationEditor();
    const modified = navigationEditor();
    const registered: EditorNavigationHandle[] = [];
    const unregistered: string[] = [];
    const events: string[] = [];
    let replaying = false;
    const binding = bindFileCompareNavigation({
      originalEditor: original.editor,
      modifiedEditor: modified.editor,
      modelRevision: 4,
      navigation: {
        isReplaying: () => replaying,
        register: (handle) => {
          registered.push(handle);
          return () => { unregistered.push(handle.pane); };
        },
        observe: (handle) => { events.push(`observe:${handle.pane}`); },
        commitCurrent: (reason) => { events.push(`commit:${reason}`); },
      },
      onRestored: () => {},
    });

    expect(registered.map((handle) => handle.pane)).toEqual(["compareLeft", "compareRight"]);
    expect(events).toEqual(["observe:compareRight"]);
    original.emitCursor({ lineNumber: 2, column: 1 });
    original.emitCursor({ lineNumber: 20, column: 1 });
    original.emitFocus();
    modified.emitFocus();
    binding.commitBeforeDiff("next");
    binding.commitBeforeDiff("previous");
    binding.commitBeforeLeave();
    expect(events).toContain("commit:explicitCursorJump");
    expect(events).toContain("commit:paneFocus");
    expect(events).toContain("commit:nextDiff");
    expect(events).toContain("commit:previousDiff");
    expect(events).toContain("commit:leaveEditorTarget");
    const beforeReplay = events.length;
    replaying = true;
    original.emitCursor({ lineNumber: 25, column: 1 });
    replaying = false;
    expect(events).toHaveLength(beforeReplay);
    original.replaceModel();
    expect(binding.original?.restore({
      pane: "compareLeft",
      cursor: { lineNumber: 3, column: 1 },
      viewport: { topLineNumber: 3, topLineOffsetPx: 0, scrollLeftPx: 0 },
    })).toEqual({ kind: "staleModel" });
    binding.dispose();
    expect(unregistered).toEqual(["compareLeft", "compareRight"]);
    const eventCount = events.length;
    original.emitCursor({ lineNumber: 30, column: 1 });
    expect(events).toHaveLength(eventCount);
  });

  it("derives a current hunk only when the restored cursor is inside its pane range", () => {
    const changes = [{
      originalStartLineNumber: 3,
      originalEndLineNumber: 5,
      modifiedStartLineNumber: 8,
      modifiedEndLineNumber: 10,
    }];

    expect(activeCompareHunkIndexAtLine(changes, "compareLeft", 4)).toBe(0);
    expect(activeCompareHunkIndexAtLine(changes, "compareRight", 9)).toBe(0);
    expect(activeCompareHunkIndexAtLine(changes, "compareLeft", 9)).toBe(-1);
  });
});

function navigationEditor() {
  let position = { lineNumber: 1, column: 1 };
  const cursorListeners = new Set<() => void>();
  const scrollListeners = new Set<() => void>();
  const focusListeners = new Set<() => void>();
  let model = {
    getLineCount: () => 100,
    validatePosition: (candidate: { lineNumber: number; column: number }) => candidate,
  };
  const editor: MonacoNavigationEditor = {
    getModel: () => model,
    getPosition: () => position,
    getVisibleRanges: () => [{ startLineNumber: position.lineNumber }],
    getScrollTop: () => position.lineNumber * 20,
    getScrollLeft: () => 0,
    getTopForLineNumber: (lineNumber) => lineNumber * 20,
    setPosition: (candidate) => { position = candidate; },
    setScrollPosition: () => {},
    focus: () => {},
    onDidChangeCursorPosition: (listener) => testSubscription(cursorListeners, listener),
    onDidScrollChange: (listener) => testSubscription(scrollListeners, listener),
    onDidFocusEditorText: (listener) => testSubscription(focusListeners, listener),
  };
  return {
    editor,
    emitCursor: (candidate: { lineNumber: number; column: number }) => {
      position = candidate;
      cursorListeners.forEach((listener) => { listener(); });
    },
    emitFocus: () => { focusListeners.forEach((listener) => { listener(); }); },
    replaceModel: () => {
      model = {
        getLineCount: () => 50,
        validatePosition: (candidate: { lineNumber: number; column: number }) => candidate,
      };
    },
  };
}

function testSubscription(listeners: Set<() => void>, listener: () => void) {
  listeners.add(listener);
  return { dispose: () => { listeners.delete(listener); } };
}
