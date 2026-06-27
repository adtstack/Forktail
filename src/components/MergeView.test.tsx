import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { MergeSession } from "../core/models";
import { demoMergeSession } from "../core/samples";
import { MergeView } from "./MergeView";

vi.mock("../monaco", () => ({}));
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
    />,
  );
}

describe("MergeView accessibility", () => {
  it("labels merge state, source regions, result region, and shortcuts", () => {
    const markup = renderMergeView(true);

    expect(markup).toContain("aria-label=\"병합 결과 저장 안 됨\"");
    expect(markup).toContain("role=\"status\"");
    expect(markup).toContain("aria-live=\"polite\"");
    expect(markup).toContain("aria-label=\"BASE 원본: demo/base.ts\"");
    expect(markup).toContain("aria-label=\"OURS 원본: demo/ours.ts\"");
    expect(markup).toContain("aria-label=\"THEIRS 원본: demo/theirs.ts\"");
    expect(markup).toContain("aria-label=\"병합 결과 편집기, 저장 경로 미정\"");
    expect(markup).toContain("aria-keyshortcuts=\"Alt+1\"");
    expect(markup).toContain("aria-keyshortcuts=\"Control+S Meta+S\"");
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

    expect(markup).toContain("병합 결과 저장은 UTF-8로 기록");
    expect(markup).toContain("원본 인코딩");
  });
});
