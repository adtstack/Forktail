import { loadMonacoLanguage } from "../monaco";
import { DiffEditor, type DiffOnMount } from "@monaco-editor/react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type DragEvent,
} from "react";
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
  type TextDiffOptions,
  type WhitespaceCompareMode,
} from "../core/diffOptions";
import {
  attachExactTextDiff,
  refreshExactTextDiff,
  registerExactTextDiff,
  retainExactTextDiffSourceModels,
  unregisterExactTextDiff,
  updateExactTextDiff,
  type ExactTextDiffRegistration,
  type ExactTextDiffSourceModelOwnership,
} from "../core/exactTextDiffProvider";
import { compareSessionCapabilities } from "../core/difftoolSession";
import { detachedFolderReviewModelPath } from "../core/detachedFolderReview";
import { gitSnapshotPatchAvailability } from "../core/gitSession";
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
import { isMissingFileDocument, isVirtualFileDocument } from "../core/virtualDocument";
import {
  createEditorNavigationHandle,
  isExplicitCursorJump,
  type EditorNavigationBinding,
  type EditorNavigationHandle,
  type EditorViewSnapshot,
  type MonacoNavigationEditor,
  type MonacoNavigationObservationKind,
} from "../core/monacoNavigation";

type OwnedDiffEditorProps = ComponentProps<typeof DiffEditor> & { onMount: DiffOnMount };

function OwnedDiffEditor({ onMount, ...props }: OwnedDiffEditorProps) {
  const sourceModelOwnershipRef = useRef<ExactTextDiffSourceModelOwnership | null>(null);
  const handleMount = useCallback<DiffOnMount>((instance, monaco) => {
    const nextOwnership = retainExactTextDiffSourceModels(instance);
    sourceModelOwnershipRef.current?.dispose();
    sourceModelOwnershipRef.current = nextOwnership;
    onMount(instance, monaco);
  }, [onMount]);

  useEffect(() => () => {
    sourceModelOwnershipRef.current?.dispose();
    sourceModelOwnershipRef.current = null;
  }, []);

  return (
    <DiffEditor
      {...props}
      keepCurrentOriginalModel
      keepCurrentModifiedModel
      onMount={handleMount}
    />
  );
}

export interface BindFileCompareNavigationOptions {
  originalEditor: MonacoNavigationEditor;
  modifiedEditor: MonacoNavigationEditor;
  modelRevision: number;
  navigation: EditorNavigationBinding;
  onRestored: (pane: "compareLeft" | "compareRight", snapshot: EditorViewSnapshot) => void;
}

export interface FileCompareNavigationBinding {
  original: EditorNavigationHandle | null;
  modified: EditorNavigationHandle | null;
  commitBeforeDiff(direction: DiffDirection): void;
  commitBeforeLeave(): void;
  dispose(): void;
}

interface CompareHunkRange {
  originalStartLineNumber: number;
  originalEndLineNumber: number;
  modifiedStartLineNumber: number;
  modifiedEndLineNumber: number;
}

export function activeCompareHunkIndexAtLine(
  changes: readonly CompareHunkRange[],
  pane: "compareLeft" | "compareRight",
  lineNumber: number,
): number {
  return changes.findIndex((change) => {
    const start = pane === "compareLeft"
      ? change.originalStartLineNumber
      : change.modifiedStartLineNumber;
    const end = pane === "compareLeft"
      ? change.originalEndLineNumber
      : change.modifiedEndLineNumber;
    return lineNumber >= Math.max(1, start) && lineNumber <= Math.max(1, start, end);
  });
}

export function bindFileCompareNavigation({
  originalEditor,
  modifiedEditor,
  modelRevision,
  navigation,
  onRestored,
}: BindFileCompareNavigationOptions): FileCompareNavigationBinding {
  let activePane: "compareLeft" | "compareRight" | null = null;
  const previousCursor = new Map<"compareLeft" | "compareRight", { lineNumber: number; column: number }>();

  const bind = (
    editorInstance: MonacoNavigationEditor,
    pane: "compareLeft" | "compareRight",
    modelKey: string,
  ): { handle: EditorNavigationHandle; unregister: () => void } | null => {
    const model = editorInstance.getModel();
    if (!model) return null;
    let handle: EditorNavigationHandle;
    const observe = (snapshot: EditorViewSnapshot, kind: MonacoNavigationObservationKind) => {
      const previous = previousCursor.get(pane);
      if (kind === "focus" && activePane && activePane !== pane) {
        navigation.commitCurrent("paneFocus");
      }
      if (kind === "cursor" && previous && isExplicitCursorJump(previous, snapshot.cursor)) {
        navigation.commitCurrent("explicitCursorJump");
      }
      if (kind !== "scroll") activePane = pane;
      previousCursor.set(pane, snapshot.cursor);
      navigation.observe(handle, snapshot, kind);
    };
    handle = createEditorNavigationHandle({
      editor: editorInstance,
      model,
      pane,
      modelKey,
      modelRevision,
      isReplaying: navigation.isReplaying,
      onObserved: observe,
      onRestored: (snapshot) => { onRestored(pane, snapshot); },
    });
    return { handle, unregister: navigation.register(handle) };
  };

  const original = bind(originalEditor, "compareLeft", `compare-left:${modelRevision}`);
  const modified = bind(modifiedEditor, "compareRight", `compare-right:${modelRevision}`);
  const originalSnapshot = original?.handle.capture() ?? null;
  const modifiedSnapshot = modified?.handle.capture() ?? null;
  if (originalSnapshot) previousCursor.set("compareLeft", originalSnapshot.cursor);
  if (modifiedSnapshot) previousCursor.set("compareRight", modifiedSnapshot.cursor);
  const initial = modified && modifiedSnapshot
    ? { handle: modified.handle, snapshot: modifiedSnapshot }
    : original && originalSnapshot
      ? { handle: original.handle, snapshot: originalSnapshot }
      : null;
  if (initial) {
    activePane = initial.handle.pane as "compareLeft" | "compareRight";
    navigation.observe(initial.handle, initial.snapshot, "focus");
  }
  return {
    original: original?.handle ?? null,
    modified: modified?.handle ?? null,
    commitBeforeDiff(direction) {
      navigation.commitCurrent(direction === "next" ? "nextDiff" : "previousDiff");
    },
    commitBeforeLeave() {
      if (activePane) navigation.commitCurrent("leaveEditorTarget");
    },
    dispose() {
      original?.unregister();
      modified?.unregister();
      original?.handle.dispose();
      modified?.handle.dispose();
    },
  };
}

interface FileCompareViewProps {
  session: CompareSession;
  busy: boolean;
  languageMode?: AppLanguage;
  editorTheme: "vs" | "vs-dark";
  fileChangeNotice: CompareFileChangeNotice | null;
  modelRevision: number;
  dirtySides: Record<CompareSide, boolean>;
  backLabel?: string;
  modelIdentity?: string;
  persistViewSettings?: boolean;
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
  navigation?: EditorNavigationBinding;
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
  modelIdentity,
  persistViewSettings,
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
  navigation: editorNavigation,
}: FileCompareViewProps) {
  const text = FILE_COMPARE_TEXT[languageMode];
  const capabilities = compareSessionCapabilities(session);
  const difftoolSession = session.origin === "difftool";
  const gitSnapshotSession = session.origin === "git";
  const folderReviewSession = session.origin === "folderReview";
  const shouldPersistViewSettings = persistViewSettings ?? !folderReviewSession;
  const exportAvailable = gitSnapshotSession
    ? gitSnapshotPatchAvailability(session.snapshot).kind === "ready"
    : capabilities.exportReport;
  const [viewSettings, setViewSettings] = useState(() => loadCompareViewSettings());
  const [editableSide, setEditableSide] = useState<CompareSide | "none">("none");
  const activeEditableSide = capabilities.edit ? editableSide : "none";
  const [hunkCount, setHunkCount] = useState(0);
  const [activeHunk, setActiveHunk] = useState(0);
  const [pathCopyState, setPathCopyState] = useState<PathCopyState | null>(null);
  const [hunkCopyUndo, setHunkCopyUndo] = useState<HunkCopyUndoState | null>(null);
  const [dropSide, setDropSide] = useState<CompareDropSide | null>(null);
  const diffEditorRef = useRef<editor.IStandaloneDiffEditor | null>(null);
  const exactTextDiffRegistrationRef = useRef<ExactTextDiffRegistration | null>(null);
  const lineChangesRef = useRef<editor.ILineChange[]>([]);
  const originalActiveDecorationIds = useRef<string[]>([]);
  const modifiedActiveDecorationIds = useRef<string[]>([]);
  const diffSubscriptionRef = useRef<{ dispose: () => void } | null>(null);
  const originalSubscriptionRef = useRef<{ dispose: () => void } | null>(null);
  const modifiedSubscriptionRef = useRef<{ dispose: () => void } | null>(null);
  const editorNavigationBindingRef = useRef<FileCompareNavigationBinding | null>(null);
  const editableSideRef = useRef(editableSide);
  const onTextChangeRef = useRef(onTextChange);
  const language = useMemo(
    () => languageFromPath(session.right.path || session.left.path),
    [session.left.path, session.right.path],
  );
  const [editorLanguage, setEditorLanguage] = useState(language);
  const isEditing = activeEditableSide !== "none";
  const originalModelPath = modelPath(
    "original",
    session.left.path,
    modelRevision,
    activeEditableSide,
    folderReviewSession ? modelIdentity : undefined,
  );
  const modifiedModelPath = modelPath(
    "modified",
    session.right.path,
    modelRevision,
    activeEditableSide,
    folderReviewSession ? modelIdentity : undefined,
  );
  const diffEditorModelKey = `${originalModelPath.length}:${originalModelPath}${modifiedModelPath}`;

  const binary = session.left.isBinary || session.right.isBinary;
  const navigation = diffNavigationState(activeHunk, hunkCount);
  const virtualSides = useMemo(() => ({
    left: isVirtualFileDocument(session.left),
    right: isVirtualFileDocument(session.right),
  }), [session.left, session.right]);
  const missingSides = useMemo(() => ({
    left: isMissingFileDocument(session.left),
    right: isMissingFileDocument(session.right),
  }), [session.left, session.right]);
  const hasVirtualSide = virtualSides.left || virtualSides.right;
  const hasMissingSide = missingSides.left || missingSides.right;
  const activeVirtual = activeEditableSide !== "none" && virtualSides[activeEditableSide];
  const activeDirty = activeEditableSide === "none" || activeVirtual
    ? false
    : dirtySides[activeEditableSide];
  const anyDirty = capabilities.edit && (
    (!virtualSides.left && dirtySides.left) || (!virtualSides.right && dirtySides.right)
  );
  const activeSideLabel = activeEditableSide === "left"
    ? missingSides.left ? `${text.left} (${text.missingFile})` : text.left
    : activeEditableSide === "right"
      ? missingSides.right ? `${text.right} (${text.missingFile})` : text.right
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
  const activeChangedSide = capabilities.save
    ? activeChangedCompareSide(fileChangeNotice, activeEditableSide)
    : null;
  const canApplyLeftToRight =
    capabilities.hunkCopy &&
    !busy &&
    !binary &&
    !hasVirtualSide &&
    activeEditableSide === "right" &&
    navigation.canMove;
  const canApplyRightToLeft =
    capabilities.hunkCopy &&
    !busy &&
    !binary &&
    !hasVirtualSide &&
    activeEditableSide === "left" &&
    navigation.canMove;
  const canUndoHunkCopy =
    capabilities.hunkCopy &&
    !busy &&
    !binary &&
    !hasVirtualSide &&
    activeEditableSide !== "none" &&
    hunkCopyUndo?.side === activeEditableSide &&
    hunkCopyUndo.after === session[activeEditableSide].text;

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
      editorNavigationBindingRef.current?.commitBeforeDiff(direction);
      const nextIndex = nextDiffIndex(activeHunk, total, direction, viewSettings.wrapAround);
      revealHunk(nextIndex);
    },
    [activeHunk, revealHunk, viewSettings.wrapAround],
  );

  const replaceSideEditorText = useCallback(
    (side: CompareSide, text: string) => {
      if (!capabilities.edit) return;
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
    [capabilities.edit, onTextChange],
  );

  const applyCurrentHunk = useCallback((side: CompareSide) => {
    if (!capabilities.hunkCopy || activeEditableSide !== side || binary || hasVirtualSide) return;
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
    capabilities.hunkCopy,
    activeEditableSide,
    hasVirtualSide,
    navigation.currentIndex,
    replaceSideEditorText,
    session.left.text,
    session.right.text,
  ]);

  const undoLastHunkCopy = useCallback(() => {
    if (
      !capabilities.hunkCopy ||
      !hunkCopyUndo ||
      hunkCopyUndo.after !== session[hunkCopyUndo.side].text
    ) return;

    replaceSideEditorText(hunkCopyUndo.side, hunkCopyUndo.before);
    setHunkCopyUndo(null);
  }, [
    capabilities.hunkCopy,
    hunkCopyUndo,
    replaceSideEditorText,
    session.left.text,
    session.right.text,
  ]);

  const handleCommand = useCallback((commandId: AppCommandId) => {
    if (!isFileCompareCommandAllowed(session, commandId)) return;
    if (commandId === "swapSides") {
      if (anyDirty) return;
      onSwap();
      return;
    }
    if (commandId === "saveAs") {
      if (activeEditableSide !== "none" && !virtualSides[activeEditableSide]) {
        onSaveSideAs(activeEditableSide, viewSettings.saveLineEnding);
      }
      return;
    }
    if (commandId === "save") {
      if (
        activeEditableSide !== "none" &&
        !virtualSides[activeEditableSide] &&
        dirtySides[activeEditableSide]
      ) {
        onSaveSide(activeEditableSide, viewSettings.saveLineEnding);
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
    activeEditableSide,
    dirtySides,
    navigateDiff,
    onSaveSide,
    onSaveSideAs,
    onSwap,
    session,
    virtualSides,
    viewSettings.saveLineEnding,
  ]);

  const handleSideDragOver = (side: CompareDropSide, event: DragEvent<HTMLElement>) => {
    if (busy || !capabilities.replaceInput) return;
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
    if (busy || !capabilities.replaceInput) return;
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

  const configureEditorNavigation = useCallback((instance: editor.IStandaloneDiffEditor) => {
    editorNavigationBindingRef.current?.dispose();
    editorNavigationBindingRef.current = editorNavigation
      ? bindFileCompareNavigation({
          originalEditor: navigationEditor(instance.getOriginalEditor()),
          modifiedEditor: navigationEditor(instance.getModifiedEditor()),
          modelRevision,
          navigation: editorNavigation,
          onRestored: (pane, snapshot) => {
            const index = activeCompareHunkIndexAtLine(
              lineChangesRef.current,
              pane,
              snapshot.cursor.lineNumber,
            );
            if (index < 0) return;
            updateActiveHunkDecorations(index, instance);
            setActiveHunk(index);
          },
        })
      : null;
  }, [editorNavigation, modelRevision, updateActiveHunkDecorations]);

  const mountDiffEditor: DiffOnMount = useCallback(
    (instance, monaco) => {
      diffEditorRef.current = instance;
      attachExactTextDiff(instance, monaco);
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
      configureEditorNavigation(instance);
    },
    [configureEditorNavigation, refreshDiffHunks],
  );

  useEffect(() => {
    if (diffEditorRef.current) configureEditorNavigation(diffEditorRef.current);
  }, [configureEditorNavigation]);

  useEffect(() => {
    const registration = registerExactTextDiff(
      originalModelPath,
      modifiedModelPath,
      session.left.text,
      session.right.text,
      viewSettings.diffOptions,
      session.left.lineEnding !== session.right.lineEnding ||
        session.left.lineEnding === "mixed" ||
        session.right.lineEnding === "mixed",
    );
    exactTextDiffRegistrationRef.current = registration;
    if (diffEditorRef.current) refreshExactTextDiff(diffEditorRef.current);

    return () => {
      unregisterExactTextDiff(registration);
      if (exactTextDiffRegistrationRef.current === registration) {
        exactTextDiffRegistrationRef.current = null;
      }
    };
  }, [
    modifiedModelPath,
    originalModelPath,
    session.left.lineEnding,
    session.right.lineEnding,
  ]);

  useEffect(() => {
    const registration = exactTextDiffRegistrationRef.current;
    if (!registration) return;
    updateExactTextDiff(
      registration,
      session.left.text,
      session.right.text,
      viewSettings.diffOptions,
    );
    if (diffEditorRef.current) refreshExactTextDiff(diffEditorRef.current);
  }, [session.left.text, session.right.text, viewSettings.diffOptions]);

  useEffect(() => {
    editableSideRef.current = activeEditableSide;
  }, [activeEditableSide]);

  useEffect(() => {
    if (
      !capabilities.edit ||
      (editableSide !== "none" && virtualSides[editableSide])
    ) {
      setEditableSide("none");
    }
  }, [capabilities.edit, editableSide, virtualSides]);

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
  }, [session.left.text, session.right.text, viewSettings.diffOptions, refreshDiffHunks]);

  useEffect(() => {
    if (shouldPersistViewSettings) saveCompareViewSettings(viewSettings);
  }, [shouldPersistViewSettings, viewSettings]);

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
      if (activeEditableSide !== "none" && matchesCommandShortcut("saveAs", event)) {
        event.preventDefault();
        handleCommand("saveAs");
        return;
      }
      if (activeEditableSide !== "none" && matchesCommandShortcut("save", event)) {
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
  }, [activeEditableSide, handleCommand]);

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
    editorNavigationBindingRef.current?.commitBeforeLeave();
    editorNavigationBindingRef.current?.dispose();
    editorNavigationBindingRef.current = null;
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
          <button className="command-button" onClick={onBack}>
            {difftoolSession ? text.closeForktail : backLabel ?? text.home}
          </button>
          <button
            className="command-button"
            onClick={() => {
              if (capabilities.swap) onSwap();
            }}
            disabled={!capabilities.swap || anyDirty}
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
              value={activeEditableSide}
              disabled={busy || binary || !capabilities.edit}
              onChange={(event) => setEditableSide(event.target.value as CompareSide | "none")}
            >
              <option value="none">{text.readOnly}</option>
              <option value="left" disabled={virtualSides.left}>
                {missingSides.left ? `${text.left} (${text.missingFile})` : text.left}
              </option>
              <option value="right" disabled={virtualSides.right}>
                {missingSides.right ? `${text.right} (${text.missingFile})` : text.right}
              </option>
            </select>
          </label>
          <span
            className={activeDirty ? "dirty-count" : "clean-count"}
            role="status"
            aria-live="polite"
            aria-label={
              activeEditableSide === "none"
                ? text.noEditableSide
                : activeDirty
                  ? text.sideDirtyAria(activeSideLabel)
                  : text.sideSavedAria(activeSideLabel)
            }
          >
            {activeEditableSide === "none" ? text.readOnly : activeDirty ? text.dirty : text.saved}
          </span>
        </div>
        <div className="toolbar-spacer" />
        <div className="command-group" aria-label={text.saveExportAria}>
          <button
            className="command-button primary-button"
            onClick={() => {
              if (capabilities.save && activeEditableSide !== "none") {
                onSaveSide(activeEditableSide, viewSettings.saveLineEnding);
              }
            }}
            disabled={
              !capabilities.save ||
              busy ||
              binary ||
              activeEditableSide === "none" ||
              activeVirtual ||
              !activeDirty
            }
            aria-keyshortcuts={commandAriaKeyshortcuts("save")}
          >
            {text.save}
          </button>
          <button
            className="command-button"
            onClick={() => {
              if (capabilities.saveAs && activeEditableSide !== "none") {
                onSaveSideAs(activeEditableSide, viewSettings.saveLineEnding);
              }
            }}
            disabled={
              !capabilities.saveAs ||
              busy ||
              binary ||
              activeEditableSide === "none" ||
              activeVirtual
            }
            aria-keyshortcuts={commandAriaKeyshortcuts("saveAs")}
          >
            {text.saveAs}
          </button>
          <button
            className="command-button"
            onClick={() => {
              if (capabilities.backupRestore && activeEditableSide !== "none") {
                onShowBackups(activeEditableSide);
              }
            }}
            disabled={
              !capabilities.backupRestore ||
              busy ||
              binary ||
              activeEditableSide === "none" ||
              activeVirtual
            }
          >
            {text.backups}
          </button>
          <button
            className="command-button"
            onClick={() => {
              if (exportAvailable) onExportReport(viewSettings.diffOptions);
            }}
            disabled={!exportAvailable || busy || binary}
          >
            {gitSnapshotSession ? text.exportPatch : text.export}
          </button>
        </div>
        {difftoolSession && (
          <span className="badge" aria-label={text.difftoolSessionAria}>{text.difftool}</span>
        )}
        {gitSnapshotSession && (
          <span className="badge" aria-label={text.gitSnapshotSessionAria}>{text.gitSnapshot}</span>
        )}
        {folderReviewSession && (
          <span className="badge" aria-label={text.folderReviewSessionAria}>
            {text.folderReview}
          </span>
        )}
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
            disabled={!capabilities.save && !capabilities.saveAs}
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
          editing={activeEditableSide === "left"}
          dropEnabled={capabilities.replaceInput}
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
          editing={activeEditableSide === "right"}
          dropEnabled={capabilities.replaceInput}
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
      {difftoolSession && (
        <div className="metadata-warning" role="status">
          {text.difftoolReadOnlyNote}
        </div>
      )}
      {gitSnapshotSession && (
        <div className="metadata-warning" role="status">
          {text.gitSnapshotReadOnlyNote}
        </div>
      )}
      {folderReviewSession && (
        <div className="metadata-warning" role="status">
          {text.folderReviewReadOnlyNote}
        </div>
      )}
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
      {hasMissingSide && (
        <div className="metadata-warning" role="status">
          {text.missingSideNote}
        </div>
      )}
      {capabilities.save && saveEncodingWarnings.length > 0 && (
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
          <OwnedDiffEditor
            key={diffEditorModelKey}
            height="100%"
            language={editorLanguage}
            original={session.left.text}
            modified={session.right.text}
            originalModelPath={originalModelPath}
            modifiedModelPath={modifiedModelPath}
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
              originalEditable: capabilities.edit && activeEditableSide === "left",
              readOnly: !capabilities.edit || activeEditableSide !== "right",
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
          {activeEditableSide === "left" && (
            <strong className="status-editing">{text.editing}</strong>
          )}
          {capabilities.edit && !virtualSides.left && dirtySides.left && (
            <strong className="status-dirty">{text.dirtyStatus}</strong>
          )}
        </span>
        <span>
          {formatFileStatus(session.right, text, languageMode)}
          {activeEditableSide === "right" && (
            <strong className="status-editing">{text.editing}</strong>
          )}
          {capabilities.edit && !virtualSides.right && dirtySides.right && (
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
  dropEnabled = true,
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
  dropEnabled?: boolean;
  editing: boolean;
  path: string;
  document: CompareSession["left"];
  text: (typeof FILE_COMPARE_TEXT)[AppLanguage];
  onCopyPath: () => void;
  onDragOver: (side: CompareDropSide, event: DragEvent<HTMLElement>) => void;
  onDragLeave: (side: CompareDropSide, event: DragEvent<HTMLElement>) => void;
  onDrop: (side: CompareDropSide, event: DragEvent<HTMLElement>) => void;
}) {
  const missing = isMissingFileDocument(document);

  return (
    <div
      className={`file-heading${dropActive ? " drop-active" : ""}`}
      data-compare-drop-side={dropSide}
      title={path}
      role="group"
      aria-disabled={!dropEnabled}
      aria-label={text.fileHeadingAria(sideName, document.name, path)}
      onDragOver={dropEnabled ? (event) => onDragOver(dropSide, event) : undefined}
      onDragLeave={dropEnabled ? (event) => onDragLeave(dropSide, event) : undefined}
      onDrop={dropEnabled ? (event) => onDrop(dropSide, event) : undefined}
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

export function isFileCompareCommandAllowed(
  session: Pick<CompareSession, "origin">,
  commandId: AppCommandId,
): boolean {
  const capabilities = compareSessionCapabilities(session);

  if (session.origin === "folderReview") {
    return commandId === "previousDiff" || commandId === "nextDiff";
  }

  if (commandId === "swapSides") return capabilities.swap;
  if (commandId === "save") return capabilities.save;
  if (commandId === "saveAs") return capabilities.saveAs;
  return true;
}

function navigationEditor(instance: editor.IStandaloneCodeEditor): MonacoNavigationEditor {
  return {
    getModel: () => instance.getModel(),
    getPosition: () => instance.getPosition(),
    getVisibleRanges: () => instance.getVisibleRanges(),
    getScrollTop: () => instance.getScrollTop(),
    getScrollLeft: () => instance.getScrollLeft(),
    getTopForLineNumber: (lineNumber) => instance.getTopForLineNumber(lineNumber),
    setPosition: (position) => { instance.setPosition(position); },
    setScrollPosition: (position) => { instance.setScrollPosition(position); },
    focus: () => { instance.focus(); },
    onDidChangeCursorPosition: (listener) =>
      instance.onDidChangeCursorPosition(() => { listener(); }),
    onDidScrollChange: (listener) => instance.onDidScrollChange(() => { listener(); }),
    onDidFocusEditorText: (listener) => instance.onDidFocusEditorText(() => { listener(); }),
  };
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
  if (isMissingFileDocument(document)) {
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
  modelIdentity?: string,
): string {
  if (modelIdentity) {
    return detachedFolderReviewModelPath(
      modelIdentity,
      side === "original" ? "left" : "right",
      revision,
    );
  }
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
