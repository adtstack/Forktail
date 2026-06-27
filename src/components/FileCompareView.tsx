import "../monaco";
import { DiffEditor, type DiffOnMount } from "@monaco-editor/react";
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import type { editor } from "monaco-editor";
import {
  APP_COMMAND_EVENT,
  commandAriaKeyshortcuts,
  commandIdFromEvent,
  matchesCommandShortcut,
  type AppCommandId,
} from "../core/commands";
import {
  diffNavigationState,
  nextDiffIndex,
  type DiffDirection,
} from "../core/diffNavigation";
import {
  prepareDiffTexts,
  type TextDiffOptions,
  type WhitespaceCompareMode,
} from "../core/diffOptions";
import {
  droppedFilePaths,
  paneDropRejectionMessage,
  type CompareDropSide,
} from "../core/dropPaths";
import {
  finalNewlineDifference,
  finalNewlineDifferenceLabel,
  finalNewlineLabel,
} from "../core/finalNewline";
import {
  applyModifiedHunkToOriginal,
  applyOriginalHunkToModified,
} from "../core/hunkCopy";
import { compareSaveEncodingWarnings, type CompareSide } from "../core/compareSave";
import type { CompareFileChangeNotice } from "../core/fileVersion";
import type { CompareSession } from "../core/models";
import { languageFromPath } from "../core/language";
import { pathCopyFailureMessage, pathCopySuccessMessage, writeClipboardText } from "../core/pathCopy";
import { loadCompareViewSettings, saveCompareViewSettings } from "../core/settings";

interface FileCompareViewProps {
  session: CompareSession;
  busy: boolean;
  editorTheme: "vs" | "vs-dark";
  fileChangeNotice: CompareFileChangeNotice | null;
  modelRevision: number;
  dirtySides: Record<CompareSide, boolean>;
  onBack: () => void;
  onCheckFileVersions: () => void;
  onKeepCurrentFiles: () => void;
  onReloadChangedFiles: () => void;
  onTextChange: (side: CompareSide, text: string) => void;
  onDropFileOnSide: (side: CompareDropSide, path: string) => void;
  onDropRejected: (message: string) => void;
  onExportReport: (options: TextDiffOptions) => void;
  onSaveSide: (side: CompareSide) => void;
  onSaveSideAs: (side: CompareSide) => void;
  onSwap: () => void;
}

interface PathCopyState {
  message: string;
  fallbackPath: string | null;
}

interface HunkCopyUndoState {
  side: CompareSide;
  before: string;
  after: string;
}

export function FileCompareView({
  session,
  busy,
  editorTheme,
  fileChangeNotice,
  modelRevision,
  dirtySides,
  onBack,
  onCheckFileVersions,
  onKeepCurrentFiles,
  onReloadChangedFiles,
  onTextChange,
  onDropFileOnSide,
  onDropRejected,
  onExportReport,
  onSaveSide,
  onSaveSideAs,
  onSwap,
}: FileCompareViewProps) {
  const [viewSettings, setViewSettings] = useState(() => loadCompareViewSettings());
  const [editableSide, setEditableSide] = useState<CompareSide | "none">("none");
  const [hunkCount, setHunkCount] = useState(0);
  const [activeHunk, setActiveHunk] = useState(0);
  const [pathCopyState, setPathCopyState] = useState<PathCopyState | null>(null);
  const [hunkCopyUndo, setHunkCopyUndo] = useState<HunkCopyUndoState | null>(null);
  const [dropSide, setDropSide] = useState<CompareDropSide | null>(null);
  const diffEditorRef = useRef<editor.IStandaloneDiffEditor | null>(null);
  const lineChangesRef = useRef<editor.ILineChange[]>([]);
  const diffSubscriptionRef = useRef<{ dispose: () => void } | null>(null);
  const originalSubscriptionRef = useRef<{ dispose: () => void } | null>(null);
  const modifiedSubscriptionRef = useRef<{ dispose: () => void } | null>(null);
  const editableSideRef = useRef(editableSide);
  const onTextChangeRef = useRef(onTextChange);
  const language = useMemo(
    () => languageFromPath(session.right.path || session.left.path),
    [session.left.path, session.right.path],
  );
  const preparedDiffTexts = useMemo(
    () => prepareDiffTexts(session.left.text, session.right.text, viewSettings.diffOptions),
    [session.left.text, session.right.text, viewSettings.diffOptions],
  );
  const isEditing = editableSide !== "none";
  const displayedDiffTexts = isEditing
    ? { left: session.left.text, right: session.right.text }
    : preparedDiffTexts;

  const binary = session.left.isBinary || session.right.isBinary;
  const navigation = diffNavigationState(activeHunk, hunkCount);
  const activeDirty = editableSide === "none" ? false : dirtySides[editableSide];
  const anyDirty = dirtySides.left || dirtySides.right;
  const activeSideLabel = editableSide === "left" ? "왼쪽" : editableSide === "right" ? "오른쪽" : "읽기 전용";
  const newlineDifference = finalNewlineDifference(
    session.left.hadFinalNewline,
    session.right.hadFinalNewline,
  );
  const newlineDifferenceLabel = finalNewlineDifferenceLabel(newlineDifference);
  const saveEncodingWarnings = useMemo(() => compareSaveEncodingWarnings(session), [session]);
  const canApplyLeftToRight = !busy && !binary && editableSide === "right" && navigation.canMove;
  const canApplyRightToLeft = !busy && !binary && editableSide === "left" && navigation.canMove;
  const canUndoHunkCopy =
    !busy &&
    !binary &&
    editableSide !== "none" &&
    hunkCopyUndo?.side === editableSide &&
    hunkCopyUndo.after === session[editableSide].text;

  const refreshDiffHunks = useCallback((instance = diffEditorRef.current) => {
    const changes = instance?.getLineChanges() ?? [];
    lineChangesRef.current = changes;
    setHunkCount(changes.length);
    setActiveHunk((current) => (changes.length === 0 ? 0 : Math.min(current, changes.length - 1)));
  }, []);

  const revealHunk = useCallback((index: number) => {
    const instance = diffEditorRef.current;
    const change = lineChangesRef.current[index];
    if (!instance || !change) return;

    const modifiedLine =
      change.modifiedStartLineNumber > 0
        ? change.modifiedStartLineNumber
        : Math.max(1, change.modifiedEndLineNumber);
    const modifiedEditor = instance.getModifiedEditor();
    modifiedEditor.revealLineInCenter(modifiedLine);
    modifiedEditor.setPosition({ lineNumber: modifiedLine, column: 1 });
    modifiedEditor.focus();
    setActiveHunk(index);
  }, []);

  const navigateDiff = useCallback(
    (direction: DiffDirection) => {
      const total = lineChangesRef.current.length;
      if (total === 0) return;
      const nextIndex = nextDiffIndex(activeHunk, total, direction, viewSettings.wrapAround);
      revealHunk(nextIndex);
    },
    [activeHunk, revealHunk, viewSettings.wrapAround],
  );

  const replaceSideEditorText = useCallback(
    (side: CompareSide, text: string) => {
      const targetEditor = side === "left"
        ? diffEditorRef.current?.getOriginalEditor()
        : diffEditorRef.current?.getModifiedEditor();
      const model = targetEditor?.getModel();

      if (targetEditor && model) {
        targetEditor.pushUndoStop();
        targetEditor.executeEdits("forktail-hunk-copy", [
          { range: model.getFullModelRange(), text },
        ]);
        targetEditor.pushUndoStop();
        targetEditor.focus();
      }

      onTextChange(side, text);
    },
    [onTextChange],
  );

  const applyCurrentHunk = useCallback((side: CompareSide) => {
    if (editableSide !== side || binary) return;
    const change = lineChangesRef.current[navigation.currentIndex];
    if (!change) return;

    const nextText = side === "right"
      ? applyOriginalHunkToModified(session.left.text, session.right.text, change)
      : applyModifiedHunkToOriginal(session.left.text, session.right.text, change);
    if (nextText === session[side].text) return;

    setHunkCopyUndo({ side, before: session[side].text, after: nextText });
    replaceSideEditorText(side, nextText);
  }, [
    binary,
    editableSide,
    navigation.currentIndex,
    replaceSideEditorText,
    session.left.text,
    session.right.text,
  ]);

  const undoLastHunkCopy = useCallback(() => {
    if (!hunkCopyUndo || hunkCopyUndo.after !== session[hunkCopyUndo.side].text) return;

    replaceSideEditorText(hunkCopyUndo.side, hunkCopyUndo.before);
    setHunkCopyUndo(null);
  }, [hunkCopyUndo, replaceSideEditorText, session.left.text, session.right.text]);

  const handleCommand = useCallback((commandId: AppCommandId) => {
    if (commandId === "swapSides") {
      if (anyDirty) return;
      onSwap();
      return;
    }
    if (commandId === "saveAs") {
      if (editableSide !== "none") onSaveSideAs(editableSide);
      return;
    }
    if (commandId === "save") {
      if (editableSide !== "none" && dirtySides[editableSide]) onSaveSide(editableSide);
      return;
    }
    if (commandId === "previousDiff") {
      navigateDiff("previous");
      return;
    }
    if (commandId === "nextDiff") {
      navigateDiff("next");
    }
  }, [
    anyDirty,
    dirtySides,
    editableSide,
    navigateDiff,
    onSaveSide,
    onSaveSideAs,
    onSwap,
  ]);

  const handleSideDragOver = (side: CompareDropSide, event: DragEvent<HTMLElement>) => {
    if (busy) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDropSide(side);
  };

  const handleSideDragLeave = (side: CompareDropSide, event: DragEvent<HTMLElement>) => {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
    setDropSide((current) => (current === side ? null : current));
  };

  const handleSideDrop = (side: CompareDropSide, event: DragEvent<HTMLElement>) => {
    if (busy) return;
    event.preventDefault();
    setDropSide(null);
    const paths = droppedFilePaths(event.dataTransfer);
    const rejection = paneDropRejectionMessage(side, paths.length);
    if (rejection) {
      onDropRejected(rejection);
      return;
    }
    onDropFileOnSide(side, paths[0]);
  };

  const mountDiffEditor: DiffOnMount = useCallback(
    (instance) => {
      diffEditorRef.current = instance;
      diffSubscriptionRef.current?.dispose();
      diffSubscriptionRef.current = instance.onDidUpdateDiff(() => refreshDiffHunks(instance));
      originalSubscriptionRef.current?.dispose();
      originalSubscriptionRef.current = instance.getOriginalEditor().onDidChangeModelContent(() => {
        if (editableSideRef.current !== "left") return;
        onTextChangeRef.current("left", instance.getOriginalEditor().getValue());
      });
      modifiedSubscriptionRef.current?.dispose();
      modifiedSubscriptionRef.current = instance.getModifiedEditor().onDidChangeModelContent(() => {
        if (editableSideRef.current !== "right") return;
        onTextChangeRef.current("right", instance.getModifiedEditor().getValue());
      });
      refreshDiffHunks(instance);
    },
    [refreshDiffHunks],
  );

  useEffect(() => {
    editableSideRef.current = editableSide;
  }, [editableSide]);

  useEffect(() => {
    onTextChangeRef.current = onTextChange;
  }, [onTextChange]);

  useEffect(() => {
    setActiveHunk(0);
    refreshDiffHunks();
  }, [displayedDiffTexts.left, displayedDiffTexts.right, refreshDiffHunks]);

  useEffect(() => {
    saveCompareViewSettings(viewSettings);
  }, [viewSettings]);

  useEffect(() => {
    setPathCopyState(null);
  }, [session.left.path, session.right.path]);

  useEffect(() => {
    setHunkCopyUndo(null);
  }, [modelRevision, session.left.path, session.right.path]);

  useEffect(() => {
    setHunkCopyUndo((current) =>
      current &&
      session[current.side].text !== current.after &&
      session[current.side].text !== current.before
        ? null
        : current,
    );
  }, [session.left.text, session.right.text]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (matchesCommandShortcut("swapSides", event)) {
        event.preventDefault();
        handleCommand("swapSides");
        return;
      }
      if (editableSide !== "none" && matchesCommandShortcut("saveAs", event)) {
        event.preventDefault();
        handleCommand("saveAs");
        return;
      }
      if (editableSide !== "none" && matchesCommandShortcut("save", event)) {
        event.preventDefault();
        handleCommand("save");
        return;
      }
      if (matchesCommandShortcut("previousDiff", event)) {
        event.preventDefault();
        handleCommand("previousDiff");
        return;
      }
      if (matchesCommandShortcut("nextDiff", event)) {
        event.preventDefault();
        handleCommand("nextDiff");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [editableSide, handleCommand]);

  useEffect(() => {
    const handleCommandEvent = (event: Event) => {
      const commandId = commandIdFromEvent(event);
      if (!commandId) return;
      handleCommand(commandId);
    };

    window.addEventListener(APP_COMMAND_EVENT, handleCommandEvent);
    return () => window.removeEventListener(APP_COMMAND_EVENT, handleCommandEvent);
  }, [handleCommand]);

  useEffect(() => () => {
    diffSubscriptionRef.current?.dispose();
    originalSubscriptionRef.current?.dispose();
    modifiedSubscriptionRef.current?.dispose();
  }, []);

  const copyPath = async (label: string, path: string) => {
    try {
      await writeClipboardText(path);
      setPathCopyState({ message: pathCopySuccessMessage(label), fallbackPath: null });
    } catch {
      setPathCopyState({ message: pathCopyFailureMessage, fallbackPath: path });
    }
  };

  return (
    <main className="workspace">
      <header className="toolbar">
        <button onClick={onBack}>← 홈</button>
        <div className="toolbar-divider" />
        <button
          onClick={onSwap}
          disabled={anyDirty}
          aria-keyshortcuts={commandAriaKeyshortcuts("swapSides")}
        >
          좌우 교환
        </button>
        <button
          onClick={() => navigateDiff("previous")}
          disabled={!navigation.canMove}
          aria-keyshortcuts={commandAriaKeyshortcuts("previousDiff")}
        >
          이전 변경
        </button>
        <button
          onClick={() => navigateDiff("next")}
          disabled={!navigation.canMove}
          aria-keyshortcuts={commandAriaKeyshortcuts("nextDiff")}
        >
          다음 변경
        </button>
        <button
          onClick={() => applyCurrentHunk("right")}
          disabled={!canApplyLeftToRight}
          title="선택한 변경을 왼쪽 내용으로 오른쪽에 반영합니다."
        >
          왼쪽→오른쪽
        </button>
        <button
          onClick={() => applyCurrentHunk("left")}
          disabled={!canApplyRightToLeft}
          title="선택한 변경을 오른쪽 내용으로 왼쪽에 반영합니다."
        >
          오른쪽→왼쪽
        </button>
        <button
          onClick={undoLastHunkCopy}
          disabled={!canUndoHunkCopy}
          title="마지막 hunk 적용을 되돌립니다."
        >
          hunk 되돌리기
        </button>
        <span
          className={navigation.canMove ? "diff-count" : "clean-count"}
          role="status"
          aria-live="polite"
          aria-label={
            navigation.canMove
              ? `현재 변경 ${navigation.currentIndex + 1}, 전체 변경 ${navigation.total}`
              : "변경 없음"
          }
        >
          {navigation.canMove ? `${navigation.currentIndex + 1} / ${navigation.total} 변경` : "변경 없음"}
        </span>
        <div className="toolbar-divider" />
        <label className="toolbar-field">
          <span>편집</span>
          <select
            className="toolbar-select"
            value={editableSide}
            disabled={busy || binary}
            onChange={(event) => setEditableSide(event.target.value as CompareSide | "none")}
          >
            <option value="none">읽기 전용</option>
            <option value="left">왼쪽</option>
            <option value="right">오른쪽</option>
          </select>
        </label>
        <span
          className={activeDirty ? "dirty-count" : "clean-count"}
          role="status"
          aria-live="polite"
          aria-label={
            editableSide === "none"
              ? "편집 대상 없음"
              : activeDirty
                ? `${activeSideLabel} 파일 저장 안 됨`
                : `${activeSideLabel} 파일 저장됨`
          }
        >
          {editableSide === "none" ? "읽기 전용" : activeDirty ? "저장 안 됨" : "저장됨"}
        </span>
        <button
          onClick={() => {
            if (editableSide !== "none") onSaveSide(editableSide);
          }}
          disabled={busy || binary || editableSide === "none" || !activeDirty}
          aria-keyshortcuts={commandAriaKeyshortcuts("save")}
        >
          저장
        </button>
        <button
          onClick={() => {
            if (editableSide !== "none") onSaveSideAs(editableSide);
          }}
          disabled={busy || binary || editableSide === "none"}
          aria-keyshortcuts={commandAriaKeyshortcuts("saveAs")}
        >
          다른 이름으로 저장
        </button>
        <button
          onClick={() => onExportReport(viewSettings.diffOptions)}
          disabled={busy || binary}
        >
          리포트 저장
        </button>
        <div className="toolbar-spacer" />
        <span className="badge" aria-label={`언어: ${language}`}>{language}</span>
      </header>

      <div className="option-bar" aria-label="비교 옵션">
        <label className="toolbar-check">
          <input
            type="checkbox"
            checked={viewSettings.sideBySide}
            onChange={(event) =>
              setViewSettings((current) => ({ ...current, sideBySide: event.target.checked }))
            }
          />
          나란히
        </label>
        <label className="toolbar-field">
          <span>공백</span>
          <select
            className="toolbar-select"
            value={viewSettings.diffOptions.whitespace}
            disabled={isEditing}
            onChange={(event) =>
              setViewSettings((current) => ({
                ...current,
                diffOptions: {
                  ...current.diffOptions,
                  whitespace: event.target.value as WhitespaceCompareMode,
                },
              }))
            }
          >
            <option value="none">그대로</option>
            <option value="trim">끝 무시</option>
            <option value="all">전체 무시</option>
          </select>
        </label>
        <label className="toolbar-check">
          <input
            type="checkbox"
            checked={viewSettings.diffOptions.ignoreCase}
            disabled={isEditing}
            onChange={(event) =>
              setViewSettings((current) => ({
                ...current,
                diffOptions: { ...current.diffOptions, ignoreCase: event.target.checked },
              }))
            }
          />
          Aa 무시
        </label>
        <label className="toolbar-check">
          <input
            type="checkbox"
            checked={viewSettings.diffOptions.ignoreLineEndings}
            disabled={isEditing}
            onChange={(event) =>
              setViewSettings((current) => ({
                ...current,
                diffOptions: {
                  ...current.diffOptions,
                  ignoreLineEndings: event.target.checked,
                },
              }))
            }
          />
          EOL 무시
        </label>
        <label className="toolbar-check">
          <input
            type="checkbox"
            checked={viewSettings.wordWrap === "on"}
            onChange={(event) =>
              setViewSettings((current) => ({
                ...current,
                wordWrap: event.target.checked ? "on" : "off",
              }))
            }
          />
          줄바꿈
        </label>
        <label className="toolbar-check">
          <input
            type="checkbox"
            checked={viewSettings.renderWhitespace === "all"}
            onChange={(event) =>
              setViewSettings((current) => ({
                ...current,
                renderWhitespace: event.target.checked ? "all" : "selection",
              }))
            }
          />
          공백 표시
        </label>
        <label className="toolbar-check">
          <input
            type="checkbox"
            checked={viewSettings.wrapAround}
            onChange={(event) =>
              setViewSettings((current) => ({ ...current, wrapAround: event.target.checked }))
            }
          />
          순환
        </label>
      </div>

      <div className="file-heading-grid">
        <FileHeading
          side="LEFT"
          dropSide="left"
          dropActive={dropSide === "left"}
          editing={editableSide === "left"}
          path={session.left.path}
          document={session.left}
          onCopyPath={() => {
            void copyPath("왼쪽", session.left.path);
          }}
          onDragOver={handleSideDragOver}
          onDragLeave={handleSideDragLeave}
          onDrop={handleSideDrop}
        />
        <FileHeading
          side="RIGHT"
          dropSide="right"
          dropActive={dropSide === "right"}
          editing={editableSide === "right"}
          path={session.right.path}
          document={session.right}
          onCopyPath={() => {
            void copyPath("오른쪽", session.right.path);
          }}
          onDragOver={handleSideDragOver}
          onDragLeave={handleSideDragLeave}
          onDrop={handleSideDrop}
        />
      </div>
      {pathCopyState && (
        <div className="path-copy-status" role="status">
          <span>{pathCopyState.message}</span>
          {pathCopyState.fallbackPath && <code>{pathCopyState.fallbackPath}</code>}
        </div>
      )}
      {fileChangeNotice && (
        <div className="metadata-warning compare-file-warning" role="status">
          <span>{fileChangeNotice.message}</span>
          <div className="warning-actions">
            <button type="button" onClick={onReloadChangedFiles}>
              다시 읽기
            </button>
            <button type="button" onClick={onKeepCurrentFiles}>
              현재 내용 유지
            </button>
            <button type="button" onClick={onCheckFileVersions}>
              다시 확인
            </button>
          </div>
        </div>
      )}
      {newlineDifferenceLabel && (
        <div className="metadata-warning" role="status">
          {newlineDifferenceLabel}
        </div>
      )}
      {saveEncodingWarnings.length > 0 && (
        <div className="metadata-warning" role="status">
          {saveEncodingWarnings.map((warning) => (
            <span key={warning.side}>
              {warning.label}: {warning.message}
            </span>
          ))}
        </div>
      )}

      {binary ? (
        <section className="empty-state">
          <h2>바이너리 파일 비교는 아직 지원하지 않습니다.</h2>
          <p>1차 릴리스에서는 텍스트 파일만 다룹니다. 텍스트로 안전하게 판별되지 않는 파일은 열지 않습니다.</p>
        </section>
      ) : (
        <section
          className="editor-frame"
          aria-label={`2-way 비교 편집기: 왼쪽 ${session.left.path}, 오른쪽 ${session.right.path}`}
        >
          <DiffEditor
            height="100%"
            language={language}
            original={displayedDiffTexts.left}
            modified={displayedDiffTexts.right}
            originalModelPath={modelPath("original", session.left.path, modelRevision, editableSide)}
            modifiedModelPath={modelPath("modified", session.right.path, modelRevision, editableSide)}
            keepCurrentOriginalModel
            keepCurrentModifiedModel
            theme={editorTheme}
            onMount={mountDiffEditor}
            options={{
              automaticLayout: true,
              renderSideBySide: viewSettings.sideBySide,
              ignoreTrimWhitespace: false,
              wordWrap: viewSettings.wordWrap,
              diffWordWrap: viewSettings.wordWrap,
              renderWhitespace: viewSettings.renderWhitespace,
              minimap: { enabled: false },
              renderOverviewRuler: true,
              originalEditable: editableSide === "left",
              readOnly: editableSide !== "right",
              fontSize: 13,
              lineHeight: 20,
              scrollBeyondLastLine: false,
              enableSplitViewResizing: true,
              renderIndicators: true,
              useInlineViewWhenSpaceIsLimited: true,
            }}
          />
        </section>
      )}

      <footer className="status-bar">
        <span>
          {session.left.encoding} · {session.left.lineEnding.toUpperCase()} ·{" "}
          {finalNewlineLabel(session.left.hadFinalNewline)} · {formatBytes(session.left.size)}
          {editableSide === "left" && <strong className="status-editing">EDITING</strong>}
          {dirtySides.left && <strong className="status-dirty">DIRTY</strong>}
        </span>
        <span>
          {session.right.encoding} · {session.right.lineEnding.toUpperCase()} ·{" "}
          {finalNewlineLabel(session.right.hadFinalNewline)} · {formatBytes(session.right.size)}
          {editableSide === "right" && <strong className="status-editing">EDITING</strong>}
          {dirtySides.right && <strong className="status-dirty">DIRTY</strong>}
        </span>
      </footer>
    </main>
  );
}

export function FileHeading({
  side,
  dropSide,
  dropActive,
  editing,
  path,
  document,
  onCopyPath,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  side: string;
  dropSide: CompareDropSide;
  dropActive: boolean;
  editing: boolean;
  path: string;
  document: CompareSession["left"];
  onCopyPath: () => void;
  onDragOver: (side: CompareDropSide, event: DragEvent<HTMLElement>) => void;
  onDragLeave: (side: CompareDropSide, event: DragEvent<HTMLElement>) => void;
  onDrop: (side: CompareDropSide, event: DragEvent<HTMLElement>) => void;
}) {
  return (
    <div
      className={`file-heading${dropActive ? " drop-active" : ""}`}
      title={path}
      role="group"
      aria-label={`${side} 파일: ${document.name}, 경로 ${path}`}
      onDragOver={(event) => onDragOver(dropSide, event)}
      onDragLeave={(event) => onDragLeave(dropSide, event)}
      onDrop={(event) => onDrop(dropSide, event)}
    >
      <span className="side-label">{side}</span>
      <strong>{document.name}</strong>
      {editing && <span className="editing-badge">EDITING</span>}
      <button type="button" className="file-copy-button" onClick={onCopyPath}>
        경로 복사
      </button>
      <small>{path}</small>
      {document.decodeHadErrors && <span className="warning-badge">디코딩 손실</span>}
      {!document.hadFinalNewline && <span className="warning-badge">마지막 개행 없음</span>}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function modelPath(
  side: "original" | "modified",
  path: string,
  revision: number,
  editableSide: CompareSide | "none",
): string {
  const mode = editableSide === "none" ? "view" : `edit-${editableSide}`;
  return `forktail://${side}/${revision}/${mode}/${encodeURIComponent(path)}`;
}
