import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AppCommandId } from "../core/commands";
import type { MergeRecoveryDraft } from "../core/mergeRecovery";
import type { GitConflictMergeSession, GitPreviewMergeSession, MergeSession } from "../core/models";
import { demoMergeSession } from "../core/samples";
import { virtualMissingFileDocument } from "../core/virtualDocument";
import { canRunMergeViewCommand, MergeView } from "./MergeView";

vi.mock("../monaco", () => ({
  loadMonacoLanguage: () => Promise.resolve(),
}));
vi.mock("@monaco-editor/react", () => ({
  default: ({ value, options }: { value?: string; options?: { readOnly?: boolean } }) => (
    <div role="textbox" data-readonly={options?.readOnly === true}>{value}</div>
  ),
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

describe("MergeView repository conflict mode", () => {
  it("shows operation-aware sources, Result-only save scope, and the external terminal next step", () => {
    const markup = renderMergeView(true, gitConflictSession());

    expect(markup).toContain("Git conflict Result");
    expect(markup).toContain("Rebase · src/conflict.ts");
    expect(markup).toContain("Save writes only the Result file");
    expect(markup).toContain("Forktail does not run git add or continue");
    expect(markup).toContain("Run git add and continue the rebase outside Forktail");
    expect(markup).toContain("Rebase base (Git ours, index stage 2)");
    expect(markup).toContain("Rebased commit (Git theirs, index stage 3)");
    expect(markup).toContain(">Repository review</button>");
    expect(markup).not.toContain(">Home</button>");
    expect(markup).not.toContain(">Save As</button>");
    expect(markup).not.toContain(">Backups</button>");
    expect(markup).not.toContain(">Drafts</label>");
  });

  it("shares the dirty close guard and blocks unresolved Result saves", () => {
    const session = gitConflictSession();

    expect(commandAvailable("save", session, 1)).toBe(false);
    expect(commandAvailable("save", { ...session, result: "resolved\n" }, 0)).toBe(true);
    expect(commandAvailable("saveAs", session, 0)).toBe(false);
    expect(renderMergeView(true, session)).toContain(
      "aria-label=\"Merge result has unsaved changes\"",
    );
  });
});

describe("MergeView repository merge preview mode", () => {
  it("shows a read-only in-memory disclaimer and removes every mutation path", () => {
    const session = gitPreviewSession();
    const markup = renderMergeView(false, session);

    expect(markup).toContain("Read-only merge preview");
    expect(markup).toContain("This preview does not execute Git merge or change the repository");
    expect(markup).toContain("In-memory Result");
    expect(markup).toContain("LEFT source");
    expect(markup).toContain("RIGHT source");
    expect(markup).toContain("data-readonly=\"true\"");
    expect(markup).toContain(">Repository review</button>");
    for (const label of ["Save", "Save As", "Undo", "Redo", "Accept OURS", "Accept THEIRS", "Drafts", "Backups"]) {
      expect(markup).not.toContain(`>${label}<`);
    }
  });

  it("allows conflict navigation but rejects edit, resolution, and save commands", () => {
    const session = gitPreviewSession();

    expect(commandAvailable("previousConflict", session, 1)).toBe(true);
    expect(commandAvailable("nextConflict", session, 1)).toBe(true);
    for (const command of ["undo", "redo", "acceptOurs", "acceptTheirs", "acceptBase", "acceptBoth", "save", "saveAs"] as AppCommandId[]) {
      expect(commandAvailable(command, session, 0)).toBe(false);
    }
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

function gitConflictSession(): GitConflictMergeSession {
  const demo = demoMergeSession();
  const path = {
    opaqueId: "repository-session-1:path:9:1",
    displayPath: "src/conflict.ts",
    utf8Path: "src/conflict.ts",
  };
  const base = {
    ...demo.base,
    path: "Base (index stage 1) · src/conflict.ts",
    virtual: { kind: "gitSnapshot" as const, contentState: "text" as const },
  };
  const ours = {
    ...demo.ours,
    path: "Rebase base (Git ours, index stage 2) · src/conflict.ts",
    virtual: { kind: "gitSnapshot" as const, contentState: "text" as const },
  };
  const theirs = {
    ...demo.theirs,
    path: "Rebased commit (Git theirs, index stage 3) · src/conflict.ts",
    virtual: { kind: "gitSnapshot" as const, contentState: "text" as const },
  };
  const output = {
    ...demo.ours,
    path: "Result (working tree) · src/conflict.ts",
    text: demo.result,
    virtual: { kind: "gitSnapshot" as const, contentState: "text" as const },
  };
  const objectId = { algorithm: "sha1" as const, hex: "a".repeat(40) };
  const snapshot = (label: string, text: string, origin: "indexStage" | "workingTree") => ({
    origin,
    label,
    readOnly: origin === "indexStage",
    objectId: origin === "indexStage" ? objectId : null,
    path,
    mode: "100644",
    textMetadata: {
      encoding: "UTF-8",
      lineEnding: "lf" as const,
      hadFinalNewline: true,
      decodeHadErrors: false,
      size: text.length,
    },
    workingTreeVersion: origin === "workingTree" ? { size: text.length, modifiedMs: 10 } : null,
    contentState: { kind: "text" as const, text },
  });
  const stage = { mode: "100644", objectId };
  return {
    origin: "gitConflict",
    base,
    ours,
    theirs,
    output,
    outputPath: output.path,
    resultDocument: output,
    result: demo.result,
    conflict: {
      repositoryId: "repository-session-1",
      path,
      base: snapshot(base.path, base.text, "indexStage"),
      stage2: snapshot(ours.path, ours.text, "indexStage"),
      stage3: snapshot(theirs.path, theirs.text, "indexStage"),
      result: snapshot(output.path, output.text, "workingTree"),
      resultFingerprint: {
        kind: "regularFile",
        size: output.size,
        modifiedMs: output.modifiedMs,
        contentHash: "f".repeat(64),
      },
      stageFingerprint: { stage1: stage, stage2: stage, stage3: stage },
      operation: "rebase",
      saveState: "clean",
      generation: 9,
    },
  };
}

function gitPreviewSession(): GitPreviewMergeSession {
  const demo = demoMergeSession();
  const objectId = { algorithm: "sha1" as const, hex: "a".repeat(40) };
  const path = {
    opaqueId: "repository-session-1:path:10:1",
    displayPath: "src/preview.ts",
    utf8Path: "src/preview.ts",
  };
  const snapshot = (label: string, text: string) => ({
    origin: "committedBlob" as const,
    label,
    readOnly: true,
    objectId,
    path,
    mode: "100644",
    textMetadata: {
      encoding: "UTF-8",
      lineEnding: "lf" as const,
      hadFinalNewline: true,
      decodeHadErrors: false,
      size: text.length,
    },
    workingTreeVersion: null,
    contentState: { kind: "text" as const, text },
  });
  return {
    origin: "gitPreview",
    base: { ...demo.base, path: "Merge base · src/preview.ts" },
    ours: { ...demo.ours, path: "main · src/preview.ts" },
    theirs: { ...demo.theirs, path: "feature · src/preview.ts" },
    result: demo.result,
    output: null,
    outputPath: null,
    preview: {
      repositoryId: "repository-session-1",
      mergeBase: { kind: "single", objectId },
      base: snapshot("Merge base · src/preview.ts", demo.base.text),
      left: snapshot("main · src/preview.ts", demo.ours.text),
      right: snapshot("feature · src/preview.ts", demo.theirs.text),
      result: { kind: "ready", text: demo.result, clean: false, conflictCount: 2 },
      disclaimer: "notExecutedMerge",
      readOnly: true,
      capabilities: { edit: false, save: false, hunkCopy: false },
      generation: 10,
    },
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
