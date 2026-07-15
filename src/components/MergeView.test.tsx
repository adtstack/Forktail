import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AppCommandId } from "../core/commands";
import type { MergeRecoveryDraft } from "../core/mergeRecovery";
import type { MergeSession } from "../core/models";
import { demoMergeSession } from "../core/samples";
import { virtualMissingFileDocument } from "../core/virtualDocument";
import { canRunMergeViewCommand, MergeView } from "./MergeView";

vi.mock("../monaco", () => ({
  loadMonacoLanguage: () => Promise.resolve(),
}));
vi.mock("@monaco-editor/react", () => ({
  default: ({ value }: { value?: string }) => <div role="textbox">{value}</div>,
}));

function renderMergeView(
  dirty: boolean,
  session: MergeSession = demoMergeSession(),
  recoveryDraft: MergeRecoveryDraft | null = null,
): string {
  return renderToStaticMarkup(
    <MergeView
      session={session}
      busy={false}
      dirty={dirty}
      editorTheme="vs"
      recoveryDraft={recoveryDraft}
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

describe("MergeView Git mergetool mode", () => {
  it("identifies the fixed $MERGED output and marks a virtual Base as missing", () => {
    const markup = renderMergeView(true, mergetoolSession());

    expect(markup).toContain("Git mergetool");
    expect(markup).toContain("Fixed $MERGED output: /repo/MERGED");
    expect(markup).toContain("Save writes only to this file.");
    expect(markup).toContain("Git .orig and Forktail .bak.&lt;timestamp&gt; files can both remain.");
    expect(markup).toContain("BASE (missing)");
    expect(markup).toContain("aria-label=\"BASE source (missing)\"");
    expect(markup).toContain("aria-label=\"Merge result has unsaved changes\"");
    expect(markup).toContain(">Close Forktail</button>");
    expect(markup).not.toContain(">Home</button>");
  });

  it("hides recovery and Save As controls even when a recovery draft is supplied", () => {
    const session = mergetoolSession();
    const markup = renderMergeView(true, session, recoveryDraftFor(session));

    expect(markup).not.toContain(">Drafts</label>");
    expect(markup).not.toContain("Restore draft");
    expect(markup).not.toContain(">Save As</button>");
    expect(markup).not.toContain(">Backups</button>");
    expect(markup).not.toContain("aria-keyshortcuts=\"Control+Shift+S Meta+Shift+S\"");
  });

  it("disables fixed-output Save until every conflict is resolved", () => {
    const unresolvedMarkup = renderMergeView(true, mergetoolSession());
    const cleanMarkup = renderMergeView(true, mergetoolSession("clean result\n"));

    expect(primarySaveButton(unresolvedMarkup)).toContain("disabled=\"\"");
    expect(primarySaveButton(cleanMarkup)).not.toContain("disabled=\"\"");
  });

  it("ignores Save As commands and unresolved Save commands only in mergetool mode", () => {
    const mergetool = mergetoolSession();
    const files = demoMergeSession();

    expect(commandAvailable("saveAs", mergetool, 0)).toBe(false);
    expect(commandAvailable("save", mergetool, 1)).toBe(false);
    expect(commandAvailable("save", mergetool, 0)).toBe(true);
    expect(commandAvailable("saveAs", files, 1)).toBe(true);
    expect(commandAvailable("save", files, 1)).toBe(true);
  });
});

function mergetoolSession(result = demoMergeSession().result): MergeSession {
  const demo = demoMergeSession();
  return {
    ...demo,
    origin: "mergetool",
    base: virtualMissingFileDocument(""),
    output: {
      ...demo.ours,
      path: "/repo/MERGED",
      name: "MERGED",
      text: result,
    },
    result,
    outputPath: "/repo/MERGED",
  };
}

function recoveryDraftFor(session: MergeSession): MergeRecoveryDraft {
  return {
    id: "draft",
    basePath: session.base.path,
    oursPath: session.ours.path,
    theirsPath: session.theirs.path,
    outputPath: session.outputPath,
    result: "draft result\n",
    updatedAt: 1,
    versions: {
      base: { size: session.base.size, modifiedMs: session.base.modifiedMs },
      ours: { size: session.ours.size, modifiedMs: session.ours.modifiedMs },
      theirs: { size: session.theirs.size, modifiedMs: session.theirs.modifiedMs },
    },
  };
}

function primarySaveButton(markup: string): string {
  return markup.match(/<button class="command-button primary-button"[^>]*>Save<\/button>/)?.[0] ?? "";
}

function commandAvailable(
  commandId: AppCommandId,
  session: MergeSession,
  conflictCount: number,
): boolean {
  return canRunMergeViewCommand(commandId, session, conflictCount);
}
