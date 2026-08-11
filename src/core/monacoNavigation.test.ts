import { describe, expect, it, vi } from "vitest";
import {
  createEditorNavigationHandle,
  isExplicitCursorJump,
  type MonacoNavigationEditor,
  type MonacoNavigationModel,
} from "./monacoNavigation";

function fakeEditor() {
  const calls: string[] = [];
  const listeners = {
    cursor: new Set<() => void>(),
    scroll: new Set<() => void>(),
    focus: new Set<() => void>(),
  };
  const model: MonacoNavigationModel = {
    getLineCount: () => 20,
    validatePosition: ({ lineNumber, column }) => ({
      lineNumber: Math.min(20, Math.max(1, lineNumber)),
      column: Math.min(80, Math.max(1, column)),
    }),
  };
  let currentModel: MonacoNavigationModel | null = model;
  const editor: MonacoNavigationEditor = {
    getModel: () => currentModel,
    getPosition: () => ({ lineNumber: 8, column: 5 }),
    getVisibleRanges: () => [{ startLineNumber: 6 }],
    getScrollTop: () => 132,
    getScrollLeft: () => 17,
    getTopForLineNumber: (lineNumber) => lineNumber * 20,
    setPosition: vi.fn(() => { calls.push("position"); }),
    setScrollPosition: vi.fn(() => { calls.push("scroll"); }),
    focus: vi.fn(() => { calls.push("focus"); }),
    onDidChangeCursorPosition: (listener) => subscription(listeners.cursor, listener),
    onDidScrollChange: (listener) => subscription(listeners.scroll, listener),
    onDidFocusEditorText: (listener) => subscription(listeners.focus, listener),
  };
  return {
    editor,
    model,
    calls,
    listeners,
    replaceModel: (next: MonacoNavigationModel | null) => { currentModel = next; },
  };
}

function subscription(listeners: Set<() => void>, listener: () => void) {
  listeners.add(listener);
  return { dispose: () => { listeners.delete(listener); } };
}

describe("Monaco navigation adapter", () => {
  it("captures pane, caret, top-line pixel offset, and horizontal scroll", () => {
    const fake = fakeEditor();
    const handle = createEditorNavigationHandle({
      editor: fake.editor,
      model: fake.model,
      pane: "compareLeft",
      modelKey: "left-model",
      modelRevision: 3,
    });

    expect(handle.capture()).toEqual({
      pane: "compareLeft",
      cursor: { lineNumber: 8, column: 5 },
      viewport: { topLineNumber: 6, topLineOffsetPx: 12, scrollLeftPx: 17 },
    });
  });

  it("clamps position and viewport then restores position → scroll → focus", () => {
    const fake = fakeEditor();
    const handle = createEditorNavigationHandle({
      editor: fake.editor,
      model: fake.model,
      pane: "compareRight",
      modelKey: "right-model",
      modelRevision: 1,
    });

    expect(handle.restore({
      pane: "compareRight",
      cursor: { lineNumber: 999, column: 999 },
      viewport: { topLineNumber: 999, topLineOffsetPx: -4, scrollLeftPx: Number.NaN },
    })).toEqual({ kind: "restored" });
    expect(fake.editor.setPosition).toHaveBeenCalledWith({ lineNumber: 20, column: 80 });
    expect(fake.editor.setScrollPosition).toHaveBeenCalledWith({ scrollTop: 400, scrollLeft: 0 });
    expect(fake.calls).toEqual(["position", "scroll", "focus"]);
  });

  it("fails closed for unavailable and replaced models", () => {
    const fake = fakeEditor();
    const handle = createEditorNavigationHandle({
      editor: fake.editor,
      model: fake.model,
      pane: "compareLeft",
      modelKey: "left-model",
      modelRevision: 1,
    });
    const snapshot = handle.capture();
    expect(snapshot).not.toBeNull();

    fake.replaceModel(null);
    expect(handle.capture()).toBeNull();
    expect(snapshot && handle.restore(snapshot)).toEqual({ kind: "unavailable" });
    fake.replaceModel({ ...fake.model });
    expect(snapshot && handle.restore(snapshot)).toEqual({ kind: "staleModel" });
  });

  it("suppresses replay observations and disposes every listener", () => {
    const fake = fakeEditor();
    let replaying = false;
    const observed = vi.fn();
    const handle = createEditorNavigationHandle({
      editor: fake.editor,
      model: fake.model,
      pane: "mergeResult",
      modelKey: "result-model",
      modelRevision: 2,
      isReplaying: () => replaying,
      onObserved: observed,
    });

    fake.listeners.cursor.forEach((listener) => { listener(); });
    expect(observed).toHaveBeenCalledTimes(1);
    replaying = true;
    fake.listeners.scroll.forEach((listener) => { listener(); });
    expect(observed).toHaveBeenCalledTimes(1);

    handle.dispose();
    expect([...fake.listeners.cursor, ...fake.listeners.scroll, ...fake.listeners.focus]).toEqual([]);
  });

  it("classifies Find/Go-to/page/distant clicks but not adjacent caret motion", () => {
    expect(isExplicitCursorJump(
      { lineNumber: 10, column: 4 },
      { lineNumber: 11, column: 5 },
    )).toBe(false);
    expect(isExplicitCursorJump(
      { lineNumber: 10, column: 4 },
      { lineNumber: 30, column: 4 },
    )).toBe(true);
    expect(isExplicitCursorJump(
      { lineNumber: 10, column: 4 },
      { lineNumber: 10, column: 20 },
    )).toBe(true);
  });
});
