import {
  CARET_COLUMN_PROXIMITY,
  CARET_LINE_PROXIMITY,
  type CursorPosition,
  type EditorPaneId,
  type ViewportAnchor,
} from "./editorNavigationHistory";

export interface EditorViewSnapshot {
  pane: EditorPaneId;
  cursor: CursorPosition;
  viewport: ViewportAnchor;
}

export type MountedRestoreResult =
  | { kind: "restored" }
  | { kind: "staleModel" }
  | { kind: "unavailable" };

export type MonacoNavigationObservationKind = "cursor" | "scroll" | "focus";

export interface MonacoNavigationModel {
  getLineCount(): number;
  validatePosition(position: CursorPosition): CursorPosition;
}

export interface MonacoNavigationEditor {
  getModel(): MonacoNavigationModel | null;
  getPosition(): CursorPosition | null;
  getVisibleRanges(): readonly { startLineNumber: number }[];
  getScrollTop(): number;
  getScrollLeft(): number;
  getTopForLineNumber(lineNumber: number): number;
  setPosition(position: CursorPosition): void;
  setScrollPosition(position: { scrollTop: number; scrollLeft: number }): void;
  focus(): void;
  onDidChangeCursorPosition(listener: () => void): { dispose(): void };
  onDidScrollChange(listener: () => void): { dispose(): void };
  onDidFocusEditorText(listener: () => void): { dispose(): void };
}

export interface EditorNavigationHandle {
  pane: EditorPaneId;
  modelKey: string;
  modelRevision: number;
  capture(): EditorViewSnapshot | null;
  restore(snapshot: EditorViewSnapshot): MountedRestoreResult;
  dispose(): void;
}

export interface EditorNavigationBinding {
  isReplaying(): boolean;
  register(handle: EditorNavigationHandle): () => void;
  observe(
    handle: EditorNavigationHandle,
    snapshot: EditorViewSnapshot,
    kind: MonacoNavigationObservationKind,
  ): void;
  commitCurrent(reason: import("./editorNavigationHistory").SemanticNavigationReason): void;
}

export interface CreateEditorNavigationHandleOptions {
  editor: MonacoNavigationEditor;
  model: MonacoNavigationModel;
  pane: EditorPaneId;
  modelKey: string;
  modelRevision: number;
  isReplaying?: () => boolean;
  onObserved?: (
    snapshot: EditorViewSnapshot,
    kind: MonacoNavigationObservationKind,
  ) => void;
  onRestored?: (snapshot: EditorViewSnapshot) => void;
}

export function createEditorNavigationHandle({
  editor,
  model,
  pane,
  modelKey,
  modelRevision,
  isReplaying = () => false,
  onObserved,
  onRestored,
}: CreateEditorNavigationHandleOptions): EditorNavigationHandle {
  let disposed = false;
  const capture = (): EditorViewSnapshot | null => {
    if (disposed || !editor.getModel()) return null;
    if (editor.getModel() !== model) return null;
    const cursor = editor.getPosition();
    if (!cursor) return null;
    const lineCount = Math.max(1, model.getLineCount());
    const firstVisibleLine = editor.getVisibleRanges()[0]?.startLineNumber ?? cursor.lineNumber;
    const topLineNumber = clampInteger(firstVisibleLine, 1, lineCount);
    const scrollTop = nonNegativeFinite(editor.getScrollTop());
    const lineTop = nonNegativeFinite(editor.getTopForLineNumber(topLineNumber));
    return {
      pane,
      cursor: model.validatePosition(cursor),
      viewport: {
        topLineNumber,
        topLineOffsetPx: Math.max(0, scrollTop - lineTop),
        scrollLeftPx: nonNegativeFinite(editor.getScrollLeft()),
      },
    };
  };

  const notify = (kind: MonacoNavigationObservationKind) => {
    if (disposed || isReplaying() || !onObserved) return;
    const snapshot = capture();
    if (snapshot) onObserved(snapshot, kind);
  };
  const subscriptions = [
    editor.onDidChangeCursorPosition(() => { notify("cursor"); }),
    editor.onDidScrollChange(() => { notify("scroll"); }),
    editor.onDidFocusEditorText(() => { notify("focus"); }),
  ];

  return {
    pane,
    modelKey,
    modelRevision,
    capture,
    restore(snapshot) {
      if (disposed || !editor.getModel()) return { kind: "unavailable" };
      if (editor.getModel() !== model) return { kind: "staleModel" };
      if (snapshot.pane !== pane) return { kind: "unavailable" };

      const cursor = model.validatePosition(snapshot.cursor);
      const topLineNumber = clampInteger(snapshot.viewport.topLineNumber, 1, model.getLineCount());
      const topLineOffsetPx = nonNegativeFinite(snapshot.viewport.topLineOffsetPx);
      const scrollLeft = nonNegativeFinite(snapshot.viewport.scrollLeftPx);
      const scrollTop = nonNegativeFinite(editor.getTopForLineNumber(topLineNumber)) +
        topLineOffsetPx;
      editor.setPosition(cursor);
      editor.setScrollPosition({ scrollTop, scrollLeft });
      editor.focus();
      onRestored?.(snapshot);
      return { kind: "restored" };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const subscription of subscriptions) subscription.dispose();
    },
  };
}

export function isExplicitCursorJump(previous: CursorPosition, next: CursorPosition): boolean {
  return Math.abs(previous.lineNumber - next.lineNumber) > CARET_LINE_PROXIMITY ||
    Math.abs(previous.column - next.column) > CARET_COLUMN_PROXIMITY;
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  const normalized = Number.isFinite(value) ? Math.trunc(value) : minimum;
  return Math.min(Math.max(minimum, normalized), Math.max(minimum, maximum));
}

function nonNegativeFinite(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}
