import { loadMonacoLanguage } from "../monaco";
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
  activeDiffHunkDecorationRanges,
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
import type { SaveLineEndingMode } from "../core/lineEndings";
import type { CompareSession } from "../core/models";
import { languageFromPath } from "../core/language";
import { FILE_COMPARE_TEXT } from "../core/i18n";
import {
  pathCopyFailureMessageForLanguage,
  pathCopySuccessMessage,
  writeClipboardText,
} from "../core/pathCopy";
import { loadCompareViewSettings, saveCompareViewSettings, type AppLanguage } from "../core/settings";
import { isVirtualFileDocument } from "../core/virtualDocument";

interface FileCompareViewProps {
  session: CompareSession;
  busy: boolean;
  languageMode?: AppLanguage;
  editorTheme: "vs" | "vs-dark";
  fileChangeNotice: CompareFileChangeNotice | null;
  modelRevision: number;
  dirtySides: Record<CompareSide, boolean>;
  backLabel?: string;
  onBack: () => void;
  onCheckFileVersions: () => void;
  onKeepCurrentFiles: () => void;
  onReloadChangedFiles: () => void;
  onTextChange: (side: CompareSide, text: string) => void;
  onDropFileOnSide: (side: CompareDropSide, path: string) => void;
  onDropRejected: (message: string) => void;
  onExportReport: (options: TextDiffOptions) => void;
  onOverwriteChangedFile: (side: CompareSide, lineEndingMode: SaveLineEndingMode) => void;
  onSaveSide: (side: CompareSide, lineEndingMode: SaveLineEndingMode) => void;
  onSaveSideAs: (side: CompareSide, lineEndingMode: SaveLineEndingMode) => void;
  onShowBackups: (side: CompareSide) => void;
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
  languageMode = "en",
  editorTheme,
  fileChangeNotice,
  modelRevision,
  dirtySides,
  backLabel,
  onBack,
  onCheckFileVersions,
  onKeepCurrentFiles,
  onReloadChangedFiles,
  onTextChange,
  onDropFileOnSide,
  onDropRejected,
  onExportReport,
  onOverwriteChangedFile,
  onSaveSide,
  onSaveSideAs,
  onShowBackups,
  onSwap,
}: FileCompareViewProps) {
  const text = FILE_COMPARE_TEXT[languageMode];
  const [viewSettings, setViewSettings] = useState(() => loadCompareViewSettings());
  const [editableSide, setEditableSide] = useState<CompareSide | "none">("none");
  const [hunkCount, setHunkCount] = useState(0);
  const [activeHunk, setActiveHunk] = useState(0);
  const [pathCopyState, setPathCopyState] = useState<PathCopyState | null>(null);
  const [hunkCopyUndo, setHunkCopyUndo] = useState<HunkCopyUndoState | null>(null);
  const [dropSide, setDropSide] = useState<CompareDropSide | null>(null);
  const diffEditorRef = useRef<editor.IStandaloneDiffEditor | null>(null);
  const lineChangesRef = useRef<editor.ILineChange[]>([]);
  const originalActiveDecorationIds = useRef<string[]>([]);
  const modifiedActiveDecorationIds = useRef<string[]>([]);
  const diffSubscriptionRef = useRef<{ dispose: () => void } | null>(null);
  const originalSubscriptionRef = useRef<{ dispose: () => void } | null>(null);
  const modifiedSubscriptionRef = useRef<{ dispose: () => void } | null>(null);
  const editableSideRef = useRef(editableSide);
  const onTextChangeRef = useRef(onTextChange);
  const language = useMemo(
    () => languageFromPath(session.right.path || session.left.path),
    [session.left.path, session.right.path],
  );
  const [editorLanguage, setEditorLanguage] = useState(language);
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
  const virtualSides = useMemo(() => ({
    left: isVirtualFileDocument(session.left),
    right: isVirtualFileDocument(session.right),
  }), [session.left, session.right]);
  const hasVirtualSide = virtualSides.left || virtualSides.right;
  const activeVirtual = editableSide !== "none" && virtualSides[editableSide];
  const activeDirty = editableSide === "none" || activeVirtual ? false : dirtySides[editableSide];
  const anyDirty = (!virtualSides.left && dirtySides.left) || (!virtualSides.right && dirtySides.right);
  const activeSideLabel = editableSide === "left"
    ? virtualSides.left ? `${text.left} (${text.missingFile})` : text.left
    : editableSide === "right"
      ? virtualSides.right ? `${text.right} (${text.missingFile})` : text.right
      : text.readOnly;
  const newlineDifference = finalNewlineDifference(
    session.left.hadFinalNewline,
    session.right.hadFinalNewline,
  );
  const newlineDifferenceLabel = finalNewlineDifferenceLabel(newlineDifference, languageMode);
  const saveEncodingWarnings = useMemo(
    () => compareSaveEncodingWarnings(session, languageMode),
    [languageMode, session],
  );
  const activeChangedSide = activeChangedCompareSide(fileChangeNotice, editableSide);
  const canApplyLeftToRight =
    !busy && !binary && !hasVirtualSide && editableSide === "right" && navigation.canMove;
  const canApplyRightToLeft =
    !busy && !binary && !hasVirtualSide && editableSide === "left" && navigation.canMove;
  const canUndoHunkCopy =
    !busy &&
    !binary &&
    !hasVirtualSide &&
    editableSide !== "none" &&
    hunkCopyUndo?.side === editableSide &&
    hunkCopyUndo.after === session[editableSide].text;

  const updateActiveHunkDecorations = useCallback((
    index: number,
    instance = diffEditorRef.current,
  ) => {
    if (!instance) return;

    const ranges = activeDiffHunkDecorationRanges(lineChangesRef.current[index]);
    const originalEditor = instance.getOriginalEditor();
    const modifiedEditor = instance.getModifiedEditor();

    originalActiveDecorationIds.current = originalEditor.deltaDecorations(
      originalActiveDecorationIds.current,
      ranges.original
        ? [activeDiffDecoration(ranges.original.startLineNumber, ranges.original.endLineNumber)]
        : [],
    );
    modifiedActiveDecorationIds.current = modifiedEditor.deltaDecorations(
      modifiedActiveDecorationIds.current,
      ranges.modified
        ? [activeDiffDecoration(ranges.modified.startLineNumber, ranges.modified.endLineNumber)]
        : [],
    );
  }, []);

  const refreshDiffHunks = useCallback((instance = diffEditorRef.current) => {
    const changes = instance?.getLineChanges() ?? [];
    lineChangesRef.current = changes;
    setHunkCount(changes.length);
    setActiveHunk((current) => {
      const next = changes.length === 0 ? 0 : Math.min(current, changes.length - 1);
      updateActiveHunkDecorations(next, instance);
      return next;
    });
  }, [updateActiveHunkDecorations]);

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
    updateActiveHunkDecorations(index, instance);
    setActiveHunk(index);
  }, [updateActiveHunkDecorations]);

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
      if (editableSide !== "none" && !virtualSides[editableSide]) {
        onSaveSideAs(editableSide, viewSettings.saveLineEnding);
      }
      return;
    }
    if (commandId === "save") {
      if (editableSide !== "none" && !virtualSides[editableSide] && dirtySides[editableSide]) {
        onSaveSide(editableSide, viewSettings.saveLineEnding);
      }
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
    virtualSides,
    viewSettings.saveLineEnding,
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
    const rejection = paneDropRejectionMessage(side, paths.length, languageMode);
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
    if (editableSide !== "none" && virtualSides[editableSide]) {
      setEditableSide("none");
    }
  }, [editableSide, virtualSides]);

  useEffect(() => {
    onTextChangeRef.current = onTextChange;
  }, [onTextChange]);

  useEffect(() => {
    let active = true;
    setEditorLanguage(language === "plaintext" ? language : "plaintext");

    void loadMonacoLanguage(language).then(() => {
      if (active) setEditorLanguage(language);
    });

    return () => {
      active = false;
    };
  }, [language]);

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
    const instance = diffEditorRef.current;
    if (instance) {
      originalActiveDecorationIds.current = instance
        .getOriginalEditor()
        .deltaDecorations(originalActiveDecorationIds.current, []);
      modifiedActiveDecorationIds.current = instance
        .getModifiedEditor()
        .deltaDecorations(modifiedActiveDecorationIds.current, []);
    }
    diffSubscriptionRef.current?.dispose();
    originalSubscriptionRef.current?.dispose();
    modifiedSubscriptionRef.current?.dispose();
  }, []);

  const copyPath = async (label: string, path: string) => {
    try {
      await writeClipboardText(path);
      setPathCopyState({ message: pathCopySuccessMessage(label, languageMode), fallbackPath: null });
    } catch {
      setPathCopyState({ message: pathCopyFailureMessageForLanguage(languageMode), fallbackPath: path });
    }
  };

  return (
    <main className="workspace">
      <header className="toolbar command-toolbar">
        <div className="command-group">
          <button className="command-button" onClick={onBack}>{backLabel ?? text.home}</button>
          <button
            className="command-button"
            onClick={onSwap}
            disabled={anyDirty}
            aria-keyshortcuts={commandAriaKeyshortcuts("swapSides")}
          >
            {text.swap}
          </button>
        </div>
        <div className="command-group command-group-primary" aria-label={text.changeNavigationAria}>
          <button
            className="command-button"
            onClick={() => navigateDiff("previous")}
            disabled={!navigation.canMove}
            aria-keyshortcuts={commandAriaKeyshortcuts("previousDiff")}
          >
            {text.previousChange}
          </button>
          <span
            className={navigation.canMove ? "diff-count" : "clean-count"}
            role="status"
            aria-live="polite"
            aria-label={
              navigation.canMove
                ? text.currentChangeAria(navigation.currentIndex + 1, navigation.total)
                : text.noChangesAria
            }
          >
            {navigation.canMove ? `${navigation.currentIndex + 1} / ${navigation.total}` : text.clean}
          </span>
          <button
            className="command-button"
            onClick={() => navigateDiff("next")}
            disabled={!navigation.canMove}
            aria-keyshortcuts={commandAriaKeyshortcuts("nextDiff")}
          >
            {text.nextChange}
          </button>
        </div>
        <div className="command-group" aria-label={text.hunkCopyAria}>
          <button
            className="command-button"
            onClick={() => applyCurrentHunk("right")}
            disabled={!canApplyLeftToRight}
            title={text.applyLeftToRightTitle}
          >
            {text.leftToRight}
          </button>
          <button
            className="command-button"
            onClick={() => applyCurrentHunk("left")}
            disabled={!canApplyRightToLeft}
            title={text.applyRightToLeftTitle}
          >
            {text.rightToLeft}
          </button>
          <button
            className="command-button"
            onClick={undoLastHunkCopy}
            disabled={!canUndoHunkCopy}
            title={text.undoHunkTitle}
          >
            {text.undoHunk}
          </button>
        </div>
        <div className="command-group" aria-label={text.editStateAria}>
          <label className="toolbar-field">
            <span>{text.edit}</span>
            <select
              className="toolbar-select"
              value={editableSide}
              disabled={busy || binary}
              onChange={(event) => setEditableSide(event.target.value as CompareSide | "none")}
            >
              <option value="none">{text.readOnly}</option>
              <option value="left" disabled={virtualSides.left}>
                {virtualSides.left ? `${text.left} (${text.missingFile})` : text.left}
              </option>
              <option value="right" disabled={virtualSides.right}>
                {virtualSides.right ? `${text.right} (${text.missingFile})` : text.right}
              </option>
            </select>
          </label>
          <span
            className={activeDirty ? "dirty-count" : "clean-count"}
            role="status"
            aria-live="polite"
            aria-label={
              editableSide === "none"
                ? text.noEditableSide
                : activeDirty
                  ? text.sideDirtyAria(activeSideLabel)
                  : text.sideSavedAria(activeSideLabel)
            }
          >
            {editableSide === "none" ? text.readOnly : activeDirty ? text.dirty : text.saved}
          </span>
        </div>
        <div className="toolbar-spacer" />
        <div className="command-group" aria-label={text.saveExportAria}>
          <button
            className="command-button primary-button"
            onClick={() => {
              if (editableSide !== "none") onSaveSide(editableSide, viewSettings.saveLineEnding);
            }}
            disabled={busy || binary || editableSide === "none" || activeVirtual || !activeDirty}
            aria-keyshortcuts={commandAriaKeyshortcuts("save")}
          >
            {text.save}
          </button>
          <button
            className="command-button"
            onClick={() => {
              if (editableSide !== "none") onSaveSideAs(editableSide, viewSettings.saveLineEnding);
            }}
            disabled={busy || binary || editableSide === "none" || activeVirtual}
            aria-keyshortcuts={commandAriaKeyshortcuts("saveAs")}
          >
            {text.saveAs}
          </button>
          <button
            className="command-button"
            onClick={() => {
              if (editableSide !== "none") onShowBackups(editableSide);
            }}
            disabled={busy || binary || editableSide === "none" || activeVirtual}
          >
            {text.backups}
          </button>
          <button
            className="command-button"
            onClick={() => onExportReport(viewSettings.diffOptions)}
            disabled={busy || binary}
          >
            {text.export}
          </button>
        </div>
        <span className="badge" aria-label={text.languageAria(language)}>{language}</span>
      </header>

      <div className="option-bar" aria-label={text.compareOptionsAria}>
        <label className="toolbar-check">
          <input
            type="checkbox"
            checked={viewSettings.sideBySide}
            onChange={(event) =>
              setViewSettings((current) => ({ ...current, sideBySide: event.target.checked }))
            }
          />
          {text.sideBySide}
        </label>
        <label className="toolbar-field">
          <span>{text.saveEol}</span>
          <select
            className="toolbar-select"
            value={viewSettings.saveLineEnding}
            onChange={(event) =>
              setViewSettings((current) => ({
                ...current,
                saveLineEnding: event.target.value as SaveLineEndingMode,
              }))
            }
          >
            <option value="original">{text.original}</option>
            <option value="system">{text.system}</option>
            <option value="lf">LF</option>
            <option value="crlf">CRLF</option>
          </select>
        </label>
        <label className="toolbar-field">
          <span>{text.whitespace}</span>
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
            <option value="none">{text.whitespaceAsIs}</option>
            <option value="trim">{text.whitespaceTrimEnd}</option>
            <option value="all">{text.whitespaceIgnoreAll}</option>
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
          {text.ignoreCase}
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
          {text.ignoreEol}
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
          {text.wrap}
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
          {text.spaces}
        </label>
        <label className="toolbar-check">
          <input
            type="checkbox"
            checked={viewSettings.wrapAround}
            onChange={(event) =>
              setViewSettings((current) => ({ ...current, wrapAround: event.target.checked }))
            }
          />
          {text.loop}
        </label>
      </div>

      <div className="file-heading-grid">
        <FileHeading
          sideLabel="LEFT"
          sideName={text.left}
          dropSide="left"
          dropActive={dropSide === "left"}
          editing={editableSide === "left"}
          path={session.left.path}
          document={session.left}
          text={text}
          onCopyPath={() => {
            void copyPath(text.left, session.left.path);
          }}
          onDragOver={handleSideDragOver}
          onDragLeave={handleSideDragLeave}
          onDrop={handleSideDrop}
        />
        <FileHeading
          sideLabel="RIGHT"
          sideName={text.right}
          dropSide="right"
          dropActive={dropSide === "right"}
          editing={editableSide === "right"}
          path={session.right.path}
          document={session.right}
          text={text}
          onCopyPath={() => {
            void copyPath(text.right, session.right.path);
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
              {text.reload}
            </button>
            {activeChangedSide && (
              <>
                <button
                  type="button"
                  onClick={() =>
                    onOverwriteChangedFile(activeChangedSide, viewSettings.saveLineEnding)
                  }
                >
                  {text.saveAnyway}
                </button>
                <button
                  type="button"
                  onClick={() => onSaveSideAs(activeChangedSide, viewSettings.saveLineEnding)}
                >
                  {text.saveCopy}
                </button>
              </>
            )}
            <button type="button" onClick={onKeepCurrentFiles}>
              {text.keepCurrent}
            </button>
            <button type="button" onClick={onCheckFileVersions}>
              {text.checkAgain}
            </button>
          </div>
        </div>
      )}
      {newlineDifferenceLabel && (
        <div className="metadata-warning" role="status">
          {newlineDifferenceLabel}
        </div>
      )}
      {hasVirtualSide && (
        <div className="metadata-warning" role="status">
          {text.missingSideNote}
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
          <h2>{text.binaryTitle}</h2>
          <p>{text.binaryBody}</p>
        </section>
      ) : (
        <section
          className="editor-frame"
          aria-label={text.editorAria(session.left.path, session.right.path)}
        >
          <DiffEditor
            height="100%"
            language={editorLanguage}
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
          {formatFileStatus(session.left, text, languageMode)}
          {editableSide === "left" && <strong className="status-editing">{text.editing}</strong>}
          {!virtualSides.left && dirtySides.left && (
            <strong className="status-dirty">{text.dirtyStatus}</strong>
          )}
        </span>
        <span>
          {formatFileStatus(session.right, text, languageMode)}
          {editableSide === "right" && <strong className="status-editing">{text.editing}</strong>}
          {!virtualSides.right && dirtySides.right && (
            <strong className="status-dirty">{text.dirtyStatus}</strong>
          )}
        </span>
      </footer>
    </main>
  );
}

export function FileHeading({
  sideLabel,
  sideName,
  dropSide,
  dropActive,
  editing,
  path,
  document,
  text,
  onCopyPath,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  sideLabel: string;
  sideName: string;
  dropSide: CompareDropSide;
  dropActive: boolean;
  editing: boolean;
  path: string;
  document: CompareSession["left"];
  text: (typeof FILE_COMPARE_TEXT)[AppLanguage];
  onCopyPath: () => void;
  onDragOver: (side: CompareDropSide, event: DragEvent<HTMLElement>) => void;
  onDragLeave: (side: CompareDropSide, event: DragEvent<HTMLElement>) => void;
  onDrop: (side: CompareDropSide, event: DragEvent<HTMLElement>) => void;
}) {
  const missing = isVirtualFileDocument(document);

  return (
    <div
      className={`file-heading${dropActive ? " drop-active" : ""}`}
      title={path}
      role="group"
      aria-label={text.fileHeadingAria(sideName, document.name, path)}
      onDragOver={(event) => onDragOver(dropSide, event)}
      onDragLeave={(event) => onDragLeave(dropSide, event)}
      onDrop={(event) => onDrop(dropSide, event)}
    >
      <span className="side-label">{sideLabel}</span>
      <strong>{document.name}</strong>
      {editing && <span className="editing-badge">{text.editing}</span>}
      <button type="button" className="file-copy-button" onClick={onCopyPath}>
        {text.copyPath}
      </button>
      <small>{path}</small>
      {missing && <span className="warning-badge">{text.missingFile}</span>}
      {!missing && document.decodeHadErrors && <span className="warning-badge">{text.decodeLoss}</span>}
      {!missing && !document.hadFinalNewline && <span className="warning-badge">{text.noFinalNewline}</span>}
    </div>
  );
}

export function activeChangedCompareSide(
  fileChangeNotice: CompareFileChangeNotice | null,
  editableSide: CompareSide | "none",
): CompareSide | null {
  if (!fileChangeNotice || editableSide === "none") return null;
  const activeSideChanged = editableSide === "left"
    ? fileChangeNotice.leftChanged
    : fileChangeNotice.rightChanged;
  return activeSideChanged ? editableSide : null;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatFileStatus(
  document: CompareSession["left"],
  text: (typeof FILE_COMPARE_TEXT)[AppLanguage],
  languageMode: AppLanguage,
): string {
  if (isVirtualFileDocument(document)) {
    return `${text.missingFile} · ${formatBytes(document.size)}`;
  }

  return `${document.encoding} · ${document.lineEnding.toUpperCase()} · ${finalNewlineLabel(
    document.hadFinalNewline,
    languageMode,
  )} · ${formatBytes(document.size)}`;
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

function activeDiffDecoration(
  startLineNumber: number,
  endLineNumber: number,
): editor.IModelDeltaDecoration {
  return {
    range: {
      startLineNumber,
      startColumn: 1,
      endLineNumber,
      endColumn: 1,
    },
    options: {
      isWholeLine: true,
      className: "active-diff-line",
      linesDecorationsClassName: "active-diff-glyph",
    },
  };
}
