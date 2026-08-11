import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { DetachedFolderReviewLoaded } from "./core/models";
import {
  DetachedFolderReviewView,
  type DetachedFolderReviewViewState,
} from "./DetachedFolderReviewApp";

vi.mock("./components/FileCompareView", () => ({
  FileCompareView: ({
    session,
    modelIdentity,
    persistViewSettings,
  }: {
    session: { origin: string };
    modelIdentity?: string;
    persistViewSettings?: boolean;
  }) => (
    <div
      data-testid="compare"
      data-origin={session.origin}
      data-model-identity={modelIdentity}
      data-persist-view-settings={String(persistViewSettings)}
    />
  ),
}));

describe("DetachedFolderReviewView", () => {
  it("renders an immediate shell while the argument-free native load runs", () => {
    const markup = render({ kind: "loading" });

    expect(markup).toContain("Loading folder comparison");
    expect(markup).toContain('role="status"');
    expect(markup).not.toContain("/private/left");
  });

  it("offers retry and close after initial load failure", () => {
    const markup = render({
      kind: "error",
      error: { code: "FILE_CHANGED", message: "The file changed. Open it again." },
    });

    expect(markup).toContain("The file changed. Open it again.");
    expect(markup).toContain(">Retry</button>");
    expect(markup).toContain(">Close</button>");
  });

  it("shows filename, relative folder, full relative path, roots, and missing side first", () => {
    const markup = render(ready());

    expect(markup).toContain("main.rs");
    expect(markup).toContain("src/");
    expect(markup).toContain("src/main.rs");
    expect(markup).toContain("/private/left");
    expect(markup).toContain("/private/right");
    expect(markup).toContain("RIGHT MISSING");
    expect(markup).toContain('data-origin="folderReview"');
    expect(markup).toContain('data-model-identity="detached-model-42"');
    expect(markup).toContain('data-persist-view-settings="false"');
  });

  it("keeps the old snapshot visible with explicit reload/keep/check actions", () => {
    const markup = render({
      ...ready(),
      notice: {
        leftChanged: true,
        rightChanged: false,
        versionKey: "left:changed|right:same",
        message: "The left file changed outside Forktail.",
      },
      operationError: "Reload failed; current snapshot was kept.",
    });

    expect(markup).toContain("The left file changed outside Forktail.");
    expect(markup).toContain("Reload failed; current snapshot was kept.");
    expect(markup).toContain(">Reload</button>");
    expect(markup).toContain(">Keep Current</button>");
    expect(markup).toContain(">Check Again</button>");
    expect(markup).toContain('data-testid="compare"');
  });
});

function render(state: DetachedFolderReviewViewState): string {
  return renderToStaticMarkup(
    <DetachedFolderReviewView
      state={state}
      busy={false}
      languageMode="en"
      editorTheme="vs"
      onRetry={() => {}}
      onClose={() => {}}
      onCheckVersions={() => {}}
      onKeepCurrent={() => {}}
      onReload={() => {}}
    />,
  );
}

function ready(): Extract<DetachedFolderReviewViewState, { kind: "ready" }> {
  const loaded: DetachedFolderReviewLoaded = {
    context: {
      fileName: "main.rs",
      parentRelativePath: "src",
      relativePath: "src/main.rs",
      leftRoot: "/private/left",
      rightRoot: "/private/right",
      leftMissing: false,
      rightMissing: true,
    },
    left: {
      path: "/private/left/src/main.rs",
      name: "main.rs",
      text: "left\n",
      encoding: "UTF-8",
      lineEnding: "lf",
      hadFinalNewline: true,
      size: 5,
      modifiedMs: 1,
      isBinary: false,
      decodeHadErrors: false,
    },
    right: null,
    modelIdentity: "detached-model-42",
  };
  if (loaded.left === null) throw new Error("left fixture must exist");
  return {
    kind: "ready",
    loaded,
    session: {
      origin: "folderReview",
      left: loaded.left,
      right: {
        path: "src/main.rs",
        name: "main.rs",
        text: "",
        encoding: "Missing",
        lineEnding: "none",
        hadFinalNewline: false,
        size: 0,
        modifiedMs: null,
        isBinary: false,
        decodeHadErrors: false,
        virtual: { kind: "missing" },
      },
    },
    notice: null,
    operationError: null,
  };
}
