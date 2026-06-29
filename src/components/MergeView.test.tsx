import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { MergeSession } from "../core/models";
import { demoMergeSession } from "../core/samples";
import { MergeView } from "./MergeView";

vi.mock("../monaco", () => ({
  loadMonacoLanguage: () => Promise.resolve(),
}));
vi.mock("@monaco-editor/react", () => ({
  default: ({ value }: { value?: string }) => <div role="textbox">{value}</div>,
}));

function renderMergeView(dirty: boolean, session: MergeSession = demoMergeSession()): string {
  return renderToStaticMarkup(
    <MergeView
      session={session}
      busy={false}
      dirty={dirty}
      editorTheme="vs"
      recoveryDraft={null}
      onBack={() => {}}
      onResultChange={() => {}}
      onRecoveryDraftsEnabledChange={() => {}}
      onRestoreRecoveryDraft={() => {}}
      onDiscardRecoveryDraft={() => {}}
      onSave={() => {}}
      onSaveAs={() => {}}
      onShowBackups={() => {}}
    />,
  );
}

describe("MergeView accessibility", () => {
  it("labels merge state, source regions, result region, and shortcuts", () => {
    const markup = renderMergeView(true);

    expect(markup).toContain("aria-label=\"Merge result has unsaved changes\"");
    expect(markup).toContain("role=\"status\"");
    expect(markup).toContain("aria-live=\"polite\"");
    expect(markup).toContain("aria-label=\"BASE source: demo/base.ts\"");
    expect(markup).toContain("aria-label=\"OURS source: demo/ours.ts\"");
    expect(markup).toContain("aria-label=\"THEIRS source: demo/theirs.ts\"");
    expect(markup).toContain("aria-label=\"Merge result editor, output path unset\"");
    expect(markup).toContain("aria-keyshortcuts=\"Alt+1\"");
    expect(markup).toContain("aria-keyshortcuts=\"Control+S Meta+S\"");
  });

  it("renders conflict navigation, resolution, side diff, history, and recovery controls", () => {
    const markup = renderMergeView(true);

    for (const label of [
      "Prev",
      "Next",
      "1 / 2",
      "Undo",
      "Redo",
      "Auto next",
      "Drafts",
      "Save EOL",
      "Original",
      "System",
      "Accept OURS",
      "Accept THEIRS",
      "Restore BASE",
      "Keep both",
      "BASE → OURS",
      "BASE → THEIRS",
      "Save As",
      "Backups",
    ]) {
      expect(markup).toContain(label);
    }
    expect(markup).toContain("aria-keyshortcuts=\"F8\"");
    expect(markup).toContain("aria-keyshortcuts=\"Shift+F8\"");
    expect(markup).toContain("aria-keyshortcuts=\"Alt+1\"");
    expect(markup).toContain("aria-keyshortcuts=\"Alt+2\"");
    expect(markup).toContain("aria-keyshortcuts=\"Alt+3\"");
    expect(markup).toContain("aria-keyshortcuts=\"Alt+4\"");
  });

  it("reports clean merge state without resolution controls when no conflicts remain", () => {
    const session = {
      ...demoMergeSession(),
      result: "clean result\n",
      outputPath: "/repo/result.txt",
    };
    const markup = renderMergeView(false, session);

    expect(markup).toContain("Clean");
    expect(markup).toContain("Auto merge or manual resolution complete.");
    expect(markup).toContain("aria-label=\"Merge result editor, output path /repo/result.txt\"");
    expect(markup).not.toContain("Accept OURS");
  });
});

describe("MergeView save encoding warning", () => {
  it("shows a warning when merge input encodings cannot be preserved by the UTF-8 result save", () => {
    const session = demoMergeSession();
    const markup = renderMergeView(false, {
      ...session,
      ours: {
        ...session.ours,
        encoding: "UTF-16LE BOM",
      },
    });

    expect(markup).toContain("saved as UTF-8");
    expect(markup).toContain("original encoding");
  });
});
