import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { modeAfterCompareBack } from "./navigation";

const appSource = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");

describe("modeAfterCompareBack", () => {
  it("returns to folder results only when a folder result is still available", () => {
    expect(modeAfterCompareBack("folders", true)).toBe("folders");
    expect(modeAfterCompareBack("folders", false)).toBe("home");
    expect(modeAfterCompareBack("home", true)).toBe("home");
  });

  it("returns read-only Git snapshots to the active repository review", () => {
    expect(modeAfterCompareBack("git", false)).toBe("git");
  });
});

describe("editor position Back integration", () => {
  it("routes editor Back only through the navigation coordinator", () => {
    const handler = sourceBlock(
      "const handleEditorNavigationBack = useCallback",
      "const handleEditorNavigationBackRef",
    );
    expect(handler).toContain("editorNavigationRestoreCoordinator.navigateBack");
    expect(handler).not.toContain("backHome");
    expect(handler).not.toContain("backFromCompare");
    expect(handler).not.toContain("exitExternalGitTool");
    expect(handler).not.toContain("setMode(");
  });

  it("registers capture keyboard/X1/default-only auxclick without mousedown", () => {
    expect(appSource).toContain('window.addEventListener("keydown", handleKeyDown, true)');
    expect(appSource).toContain('window.addEventListener("pointerdown", handlePointerDown, true)');
    expect(appSource).toContain('window.addEventListener("auxclick", handleAuxClick, true)');
    expect(appSource).not.toContain('addEventListener("mousedown"');
  });

  it("connects exact model revisions and one polite content-free status region", () => {
    expect(appSource).toContain("navigation={compareEditorNavigation}");
    expect(appSource).toContain("navigation={mergeEditorNavigation}");
    expect(appSource).toContain("modelRevision={mergeModelRevision}");
    expect(appSource.match(/className="editor-navigation-status"/g)).toHaveLength(1);
    expect(appSource).toContain('className="editor-navigation-status" role="status" aria-live="polite"');
  });
});

function sourceBlock(startMarker: string, endMarker: string): string {
  const start = appSource.indexOf(startMarker);
  const end = appSource.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error(`Missing source block: ${startMarker}`);
  return appSource.slice(start, end);
}
