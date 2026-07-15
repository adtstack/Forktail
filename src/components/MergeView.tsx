import { loadMonacoLanguage } from "../monaco";
import Editor, { type OnMount } from "@monaco-editor/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { editor } from "monaco-editor";
import {
  APP_COMMAND_EVENT,
  commandAriaKeyshortcuts,
  commandIdFromEvent,
  matchesCommandShortcut,
  type AppCommandId,
} from "../core/commands";
import { languageFromPath } from "../core/language";
import { parseConflictBlocks, resolveConflict, type ConflictResolution } from "../core/conflicts";
import { mergetoolSessionCapabilities } from "../core/mergetoolSession";
import { mergeSaveEncodingWarning } from "../core/mergeSave";
import type { SaveLineEndingMode } from "../core/lineEndings";
import { buildSideDiff, type SideDiffSegment } from "../core/sideDiff";
import { MERGE_VIEW_TEXT } from "../core/i18n";
import { loadMergeSettings, saveMergeSettings, type AppLanguage } from "../core/settings";
import type { MergeRecoveryDraft } from "../core/mergeRecovery";
import {
  pathCopyFailureMessageForLanguage,
  pathCopySuccessMessage,
  writeClipboardText,
} from "../core/pathCopy";
import {
  canRedoTextHistory,
  canUndoTextHistory,
  createTextHistory,
  pushTextHistory,
  redoTextHistory,
  type TextHistory,
  undoTextHistory,
} from "../core/textHistory";
import type { ConflictBlock, MergeSession } from "../core/models";
import { isMissingFileDocument } from "../core/virtualDocument";

interface MergeViewProps {
  session: MergeSession;
  busy: boolean;
  languageMode?: AppLanguage;
  dirty: boolean;
  editorTheme: "vs" | "vs-dark";
  recoveryDraft: MergeRecoveryDraft | null;
  onBack: () => void;
  onResultChange: (text: string) => void;
  onRecoveryDraftsEnabledChange: (enabled: boolean) => void;
  onRestoreRecoveryDraft: () => void;
  onDiscardRecoveryDraft: () => void;
  onSave: (lineEndingMode: SaveLineEndingMode) => void;
  onSaveAs: (lineEndingMode: SaveLineEndingMode) => void;
  onShowBackups: () => void;
}

interface PathCopyState {
  message: string;
  fallbackPath: string | null;
}

export function canRunMergeViewCommand(
  commandId: AppCommandId,
  session: Pick<MergeSession, "origin">,
  conflictCount: number,
): boolean {
  const capabilities = mergetoolSessionCapabilities(session);
  if (commandId === "saveAs") return capabilities.saveAs;
  if (commandId === "save" && capabilities.unresolvedPolicy === "block-unresolved") {
    return conflictCount === 0;
  }
  return true;
}

export function MergeView({
  session,
  busy,
  languageMode = "en",
  dirty,
  editorTheme,
  recoveryDraft,
  onBack,
  onResultChange,
  onRecoveryDraftsEnabledChange,
  onRestoreRecoveryDraft,
  onDiscardRecoveryDraft,
  onSave,
  onSaveAs,
  onShowBackups,
}: MergeViewProps) {
  const text = MERGE_VIEW_TEXT[languageMode];
  const [activeIndex, setActiveIndex] = useState(0);
  const [resultHistory, setResultHistory] = useState(() => createTextHistory(session.result));
  const [mergeSettings, setMergeSettings] = useState(() => loadMergeSettings());
  const [pathCopyState, setPathCopyState] = useState<PathCopyState | null>(null);
  const resultText = resultHistory.present;
  const conflicts = useMemo(() => parseConflictBlocks(resultText), [resultText]);
  const capabilities = useMemo(() => mergetoolSessionCapabilities(session), [session.origin]);
  const isMergetool = session.origin === "mergetool";
  const isGitConflict = session.origin === "gitConflict";
  const baseMissing = isMissingFileDocument(session.base);
  const resultEditor = useRef<editor.IStandaloneCodeEditor | null>(null);
  const activeDecorationIds = useRef<string[]>([]);
  const lastSyncedResult = useRef(session.result);
  const language = useMemo(
    () => languageFromPath(session.ours.path || session.theirs.path || session.base.path),
    [session.base.path, session.ours.path, session.theirs.path],
  );
  const [editorLanguage, setEditorLanguage] = useState(language);
  const saveEncodingWarning = useMemo(
    () => mergeSaveEncodingWarning(session, languageMode),
    [languageMode, session],
  );

  useEffect(() => {
    if (session.result === resultHistory.present) return;
    if (session.result === lastSyncedResult.current) return;
    setResultHistory(createTextHistory(session.result));
    lastSyncedResult.current = session.result;
  }, [resultHistory.present, session.result]);

  useEffect(() => {
    if (conflicts.length === 0) {
      setActiveIndex(0);
    } else if (activeIndex >= conflicts.length) {
      setActiveIndex(conflicts.length - 1);
    }
  }, [activeIndex, conflicts.length]);

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

  const activeConflict = conflicts[activeIndex] ?? null;
  const sideDiffs = useMemo(() => {
    if (!activeConflict) return null;
    return {
      ours: buildSideDiff(activeConflict.base, activeConflict.ours),
      theirs: buildSideDiff(activeConflict.base, activeConflict.theirs),
    };
  }, [activeConflict]);

  useEffect(() => {
    const instance = resultEditor.current;
    if (!instance) return;

    activeDecorationIds.current = instance.deltaDecorations(
      activeDecorationIds.current,
      activeConflict
        ? [
            {
              range: {
                startLineNumber: activeConflict.startLine,
                startColumn: 1,
                endLineNumber: activeConflict.endLine,
                endColumn: 1,
              },
              options: {
                isWholeLine: true,
                className: "active-conflict-line",
                linesDecorationsClassName: "active-conflict-glyph",
              },
            },
          ]
        : [],
    );

    if (!activeConflict) return;
    instance.revealLineInCenter(activeConflict.startLine);
    instance.setPosition({ lineNumber: activeConflict.startLine, column: 1 });
  }, [activeConflict]);

  const mountResult: OnMount = (instance) => {
    resultEditor.current = instance;
  };

  const commitResult = useCallback((next: string) => {
    const nextHistory = pushTextHistory(resultHistory, next);
    if (nextHistory === resultHistory) return;
    setResultHistory(nextHistory);
    lastSyncedResult.current = next;
    onResultChange(next);
  }, [onResultChange, resultHistory]);

  const replaceResultFromHistory = useCallback((nextHistory: TextHistory) => {
    if (nextHistory === resultHistory) return;
    setResultHistory(nextHistory);
    lastSyncedResult.current = nextHistory.present;
    onResultChange(nextHistory.present);
  }, [onResultChange, resultHistory]);

  const undoResult = useCallback(() => {
    replaceResultFromHistory(undoTextHistory(resultHistory));
  }, [replaceResultFromHistory, resultHistory]);

  const redoResult = useCallback(() => {
    replaceResultFromHistory(redoTextHistory(resultHistory));
  }, [replaceResultFromHistory, resultHistory]);

  const applyResolution = useCallback((resolution: ConflictResolution) => {
    if (!activeConflict) return;
    const next = resolveConflict(resultText, activeConflict, resolution);
    const remainingConflicts = parseConflictBlocks(next).length;
    commitResult(next);
    if (!mergeSettings.autoAdvanceConflict) {
      setActiveIndex((current) => Math.max(0, Math.min(current - 1, remainingConflicts - 1)));
    }
  }, [activeConflict, commitResult, mergeSettings.autoAdvanceConflict, resultText]);

  const saveResult = useCallback(() => {
    if (!canRunMergeViewCommand("save", session, conflicts.length)) return;
    if (capabilities.saveTarget === "output-only") {
      if (session.outputPath) onSave(mergeSettings.saveLineEnding);
      return;
    }
    if (session.outputPath) {
      onSave(mergeSettings.saveLineEnding);
    } else {
      onSaveAs(mergeSettings.saveLineEnding);
    }
  }, [capabilities.saveTarget, conflicts.length, mergeSettings.saveLineEnding, onSave, onSaveAs, session]);

  const previousConflict = useCallback(() => {
    if (conflicts.length === 0) return;
    setActiveIndex((current) => (current - 1 + conflicts.length) % conflicts.length);
  }, [conflicts.length]);

  const nextConflict = useCallback(() => {
    if (conflicts.length === 0) return;
    setActiveIndex((current) => (current + 1) % conflicts.length);
  }, [conflicts.length]);

  const handleCommand = useCallback((commandId: AppCommandId) => {
    if (!canRunMergeViewCommand(commandId, session, conflicts.length)) return;
    if (commandId === "redo") {
      redoResult();
      return;
    }
    if (commandId === "undo") {
      undoResult();
      return;
    }
    if (commandId === "saveAs") {
      onSaveAs(mergeSettings.saveLineEnding);
      return;
    }
    if (commandId === "save") {
      saveResult();
      return;
    }
    if (commandId === "acceptOurs") {
      applyResolution("ours");
      return;
    }
    if (commandId === "acceptBase") {
      applyResolution("base");
      return;
    }
    if (commandId === "acceptTheirs") {
      applyResolution("theirs");
      return;
    }
    if (commandId === "acceptBoth") {
      applyResolution("both");
      return;
    }
    if (commandId === "previousConflict") {
      previousConflict();
      return;
    }
    if (commandId === "nextConflict") {
      nextConflict();
    }
  }, [
    applyResolution,
    conflicts.length,
    mergeSettings.saveLineEnding,
    nextConflict,
    onSaveAs,
    previousConflict,
    redoResult,
    saveResult,
    session,
    undoResult,
  ]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (matchesCommandShortcut("redo", event)) {
        event.preventDefault();
        handleCommand("redo");
        return;
      }
      if (matchesCommandShortcut("undo", event)) {
        event.preventDefault();
        handleCommand("undo");
        return;
      }
      if (matchesCommandShortcut("saveAs", event)) {
        event.preventDefault();
        handleCommand("saveAs");
        return;
      }
      if (matchesCommandShortcut("save", event)) {
        event.preventDefault();
        handleCommand("save");
        return;
      }
      if (matchesCommandShortcut("acceptOurs", event)) {
        event.preventDefault();
        handleCommand("acceptOurs");
        return;
      }
      if (matchesCommandShortcut("acceptBase", event)) {
        event.preventDefault();
        handleCommand("acceptBase");
        return;
      }
      if (matchesCommandShortcut("acceptTheirs", event)) {
        event.preventDefault();
        handleCommand("acceptTheirs");
        return;
      }
      if (matchesCommandShortcut("acceptBoth", event)) {
        event.preventDefault();
        handleCommand("acceptBoth");
        return;
      }
      if (matchesCommandShortcut("previousConflict", event)) {
        event.preventDefault();
        handleCommand("previousConflict");
        return;
      }
      if (matchesCommandShortcut("nextConflict", event)) {
        event.preventDefault();
        handleCommand("nextConflict");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleCommand]);

  useEffect(() => {
    const handleCommandEvent = (event: Event) => {
      const commandId = commandIdFromEvent(event);
      if (!commandId) return;
      handleCommand(commandId);
    };

    window.addEventListener(APP_COMMAND_EVENT, handleCommandEvent);
    return () => window.removeEventListener(APP_COMMAND_EVENT, handleCommandEvent);
  }, [handleCommand]);

  useEffect(() => {
    saveMergeSettings(mergeSettings);
    onRecoveryDraftsEnabledChange(
      capabilities.recoveryDrafts && mergeSettings.recoveryDraftsEnabled,
    );
  }, [capabilities.recoveryDrafts, mergeSettings, onRecoveryDraftsEnabledChange]);

  useEffect(() => {
    setPathCopyState(null);
  }, [session.base.path, session.ours.path, session.outputPath, session.theirs.path]);

  useEffect(() => () => {
    if (!resultEditor.current) return;
    activeDecorationIds.current = resultEditor.current.deltaDecorations(activeDecorationIds.current, []);
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
    <main className="workspace merge-workspace">
      <header className="toolbar command-toolbar merge-command-toolbar">
        <div className="command-group">
          <button className="command-button" onClick={onBack} disabled={busy}>
            {isMergetool
              ? text.closeMergetool
              : isGitConflict
                ? text.repositoryReview
                : text.home}
          </button>
        </div>
        <div className="command-group command-group-primary" aria-label={text.conflictNavigationAria}>
          <button
            className="command-button"
            onClick={previousConflict}
            disabled={!activeConflict}
            aria-keyshortcuts={commandAriaKeyshortcuts("previousConflict")}
          >
            {text.previousConflict}
          </button>
          <span
            className={conflicts.length ? "conflict-count" : "clean-count"}
            role="status"
            aria-live="polite"
            aria-label={
              conflicts.length
                ? text.currentConflictAria(activeIndex + 1, conflicts.length)
                : text.noConflictsAria
            }
          >
            {conflicts.length ? `${activeIndex + 1} / ${conflicts.length}` : text.clean}
          </span>
          <button
            className="command-button"
            onClick={nextConflict}
            disabled={!activeConflict}
            aria-keyshortcuts={commandAriaKeyshortcuts("nextConflict")}
          >
            {text.nextConflict}
          </button>
        </div>
        <div className="command-group" aria-label={text.resultEditingAria}>
          <span
            className={dirty ? "dirty-count" : "clean-count"}
            role="status"
            aria-live="polite"
            aria-label={dirty ? text.mergeDirtyAria : text.mergeSavedAria}
          >
            {dirty ? text.dirty : text.saved}
          </span>
          <button
            className="command-button"
            onClick={undoResult}
            disabled={!canUndoTextHistory(resultHistory)}
            aria-keyshortcuts={commandAriaKeyshortcuts("undo")}
          >
            {text.undo}
          </button>
          <button
            className="command-button"
            onClick={redoResult}
            disabled={!canRedoTextHistory(resultHistory)}
            aria-keyshortcuts={commandAriaKeyshortcuts("redo")}
          >
            {text.redo}
          </button>
        </div>
        <div className="command-group" aria-label={text.mergeOptionsAria}>
          <label className="toolbar-check">
            <input
              type="checkbox"
              checked={mergeSettings.autoAdvanceConflict}
              onChange={(event) =>
                setMergeSettings((current) => ({
                  ...current,
                  autoAdvanceConflict: event.target.checked,
                }))
              }
            />
            {text.autoNext}
          </label>
          {capabilities.recoveryDrafts && (
            <label className="toolbar-check">
              <input
                type="checkbox"
                checked={mergeSettings.recoveryDraftsEnabled}
                onChange={(event) =>
                  setMergeSettings((current) => ({
                    ...current,
                    recoveryDraftsEnabled: event.target.checked,
                  }))
                }
              />
              {text.drafts}
            </label>
          )}
          <label className="toolbar-field">
            <span>{text.saveEol}</span>
            <select
              className="toolbar-select"
              value={mergeSettings.saveLineEnding}
              onChange={(event) =>
                setMergeSettings((current) => ({
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
        </div>
        <div className="toolbar-spacer" />
        <div className="command-group" aria-label={text.saveAria}>
          <button
            className="command-button primary-button"
            onClick={saveResult}
            disabled={busy || !canRunMergeViewCommand("save", session, conflicts.length)}
            aria-keyshortcuts={commandAriaKeyshortcuts("save")}
          >
            {text.save}
          </button>
          {capabilities.saveAs && (
            <button
              className="command-button"
              onClick={() => onSaveAs(mergeSettings.saveLineEnding)}
              disabled={busy}
              aria-keyshortcuts={commandAriaKeyshortcuts("saveAs")}
            >
              {text.saveAs}
            </button>
          )}
          {capabilities.backupRestore && (
            <button
              className="command-button"
              onClick={onShowBackups}
              disabled={busy || !session.outputPath}
            >
              {text.backups}
            </button>
          )}
        </div>
      </header>

      {isMergetool && (
        <div className="metadata-warning mergetool-output-notice" role="status">
          <strong>{text.mergetoolMode}</strong>
          <span>{text.mergetoolFixedOutput(session.outputPath ?? text.noOutputPath)}</span>
        </div>
      )}

      {isGitConflict && (
        <div className="metadata-warning git-conflict-output-notice" role="status">
          <strong>{text.gitConflictMode}</strong>
          <span>{text.gitConflictScope(
            conflictOperationLabel(session.conflict.operation),
            session.conflict.path.displayPath,
          )}</span>
          <span>{text.gitConflictNextStep(session.conflict.operation)}</span>
        </div>
      )}

      {activeConflict && sideDiffs && (
        <ConflictSideDiff
          conflict={activeConflict}
          ours={sideDiffs.ours}
          theirs={sideDiffs.theirs}
          text={text}
        />
      )}

      <section className="merge-source-headings">
        <PaneHeading
          label="BASE"
          path={session.base.path}
          missing={baseMissing}
          text={text}
          onCopyPath={() => {
            void copyPath("BASE", session.base.path);
          }}
        />
        <PaneHeading
          label="OURS"
          path={session.ours.path}
          text={text}
          onCopyPath={() => {
            void copyPath("OURS", session.ours.path);
          }}
        />
        <PaneHeading
          label="THEIRS"
          path={session.theirs.path}
          text={text}
          onCopyPath={() => {
            void copyPath("THEIRS", session.theirs.path);
          }}
        />
      </section>
      {pathCopyState && (
        <div className="path-copy-status" role="status">
          <span>{pathCopyState.message}</span>
          {pathCopyState.fallbackPath && <code>{pathCopyState.fallbackPath}</code>}
        </div>
      )}
      {capabilities.recoveryDrafts && recoveryDraft && (
        <div className="metadata-warning merge-draft-warning" role="status">
          <span>
            {text.draftWarning}
          </span>
          <div className="warning-actions">
            <button type="button" onClick={onRestoreRecoveryDraft}>
              {text.restoreDraft}
            </button>
            <button type="button" onClick={onDiscardRecoveryDraft}>
              {text.delete}
            </button>
          </div>
        </div>
      )}
      {saveEncodingWarning && (
        <div className="metadata-warning" role="status">
          {saveEncodingWarning}
        </div>
      )}

      <section className="merge-grid">
        <SourceEditor
          label={baseMissing
            ? text.missingSource(text.sourceLabel("BASE"))
            : text.sourceLabel("BASE")}
          path={session.base.path}
          missing={baseMissing}
          value={session.base.text}
          language={editorLanguage}
          editorTheme={editorTheme}
        />
        <SourceEditor
          label={text.sourceLabel("OURS")}
          path={session.ours.path}
          value={session.ours.text}
          language={editorLanguage}
          editorTheme={editorTheme}
        />
        <SourceEditor
          label={text.sourceLabel("THEIRS")}
          path={session.theirs.path}
          value={session.theirs.text}
          language={editorLanguage}
          editorTheme={editorTheme}
        />
        <div
          className={`result-panel${activeConflict ? " has-resolution" : ""}`}
          role="region"
          aria-label={text.resultEditorAria(session.outputPath)}
        >
          {activeConflict && (
            <div className="resolution-rail" aria-label={text.resolveActiveConflictAria}>
              <div>
                <span className="side-label">{text.activeConflict}</span>
                <strong>{activeIndex + 1} / {conflicts.length}</strong>
              </div>
              <div className="resolution-buttons">
                <button
                  onClick={() => applyResolution("ours")}
                  aria-keyshortcuts={commandAriaKeyshortcuts("acceptOurs")}
                >
                  {text.acceptOurs}
                </button>
                <button
                  onClick={() => applyResolution("theirs")}
                  aria-keyshortcuts={commandAriaKeyshortcuts("acceptTheirs")}
                >
                  {text.acceptTheirs}
                </button>
                <button
                  onClick={() => applyResolution("base")}
                  aria-keyshortcuts={commandAriaKeyshortcuts("acceptBase")}
                >
                  {text.restoreBase}
                </button>
                <button
                  onClick={() => applyResolution("both")}
                  aria-keyshortcuts={commandAriaKeyshortcuts("acceptBoth")}
                >
                  {text.keepBoth}
                </button>
              </div>
            </div>
          )}
          <div className="result-heading">
            <div>
              <span className="side-label">{text.result}</span>
              <strong>{session.outputPath ?? text.noOutputPath}</strong>
            </div>
          </div>
          <Editor
            height="100%"
            language={editorLanguage}
            value={resultText}
            theme={editorTheme}
            onMount={mountResult}
            onChange={(value) => commitResult(value ?? "")}
            options={{
              automaticLayout: true,
              minimap: { enabled: false },
              fontSize: 13,
              lineHeight: 20,
              scrollBeyondLastLine: false,
              wordWrap: "off",
              renderWhitespace: "selection",
              glyphMargin: true,
            }}
          />
        </div>
      </section>

      <footer className="status-bar">
        <span>{language} · {text.editable}</span>
        <span>
          {dirty
            ? text.unsavedResultChanges
            : conflicts.length
              ? text.resolveBeforeSaving
              : text.mergeComplete}
        </span>
      </footer>
    </main>
  );
}

function ConflictSideDiff({
  conflict,
  ours,
  theirs,
  text,
}: {
  conflict: ConflictBlock;
  ours: ReturnType<typeof buildSideDiff>;
  theirs: ReturnType<typeof buildSideDiff>;
  text: (typeof MERGE_VIEW_TEXT)[AppLanguage];
}) {
  return (
    <section className="conflict-side-diff" aria-label={text.conflictWordDiffAria(conflict.id)}>
      <SideDiffPair
        title="BASE → OURS"
        base={ours.base}
        changed={ours.changed}
        changedLabel="OURS"
        text={text}
      />
      <SideDiffPair
        title="BASE → THEIRS"
        base={theirs.base}
        changed={theirs.changed}
        changedLabel="THEIRS"
        text={text}
      />
    </section>
  );
}

function SideDiffPair({
  title,
  base,
  changed,
  changedLabel,
  text,
}: {
  title: string;
  base: SideDiffSegment[];
  changed: SideDiffSegment[];
  changedLabel: string;
  text: (typeof MERGE_VIEW_TEXT)[AppLanguage];
}) {
  return (
    <div className="side-diff-pair">
      <strong>{title}</strong>
      <DiffLine label="BASE" segments={base} text={text} />
      <DiffLine label={changedLabel} segments={changed} text={text} />
    </div>
  );
}

function DiffLine({
  label,
  segments,
  text,
}: {
  label: string;
  segments: SideDiffSegment[];
  text: (typeof MERGE_VIEW_TEXT)[AppLanguage];
}) {
  return (
    <div className="side-diff-line">
      <span>{label}</span>
      <code>
        {segments.length === 0 ? (
          <mark className="side-diff-empty">{text.empty}</mark>
        ) : (
          segments.map((segment, index) => (
            <mark key={`${segment.kind}-${index}`} className={`side-diff-${segment.kind}`}>
              {segment.text}
            </mark>
          ))
        )}
      </code>
    </div>
  );
}

function PaneHeading({
  label,
  path,
  missing = false,
  text,
  onCopyPath,
}: {
  label: string;
  path: string;
  missing?: boolean;
  text: (typeof MERGE_VIEW_TEXT)[AppLanguage];
  onCopyPath: () => void;
}) {
  const displayLabel = missing ? text.missingSource(label) : label;
  return (
    <div
      title={missing ? displayLabel : path}
      role="group"
      aria-label={missing ? text.missingSource(text.sourceLabel(label)) : text.filePathAria(label, path)}
    >
      <span className="side-label">{displayLabel}</span>
      <strong>{missing ? displayLabel : path.split(/[\\/]/).pop()}</strong>
      {!missing && (
        <button type="button" className="file-copy-button" onClick={onCopyPath}>
          {text.copyPath}
        </button>
      )}
      <small>{missing ? displayLabel : path}</small>
    </div>
  );
}

function SourceEditor({
  label,
  path,
  missing = false,
  value,
  language,
  editorTheme,
}: {
  label: string;
  path: string;
  missing?: boolean;
  value: string;
  language: string;
  editorTheme: "vs" | "vs-dark";
}) {
  return (
    <div
      className="source-editor"
      role="region"
      aria-label={missing ? label : `${label}: ${path}`}
    >
      <Editor
        height="100%"
        language={language}
        value={value}
        theme={editorTheme}
        options={{
          automaticLayout: true,
          readOnly: true,
          minimap: { enabled: false },
          lineNumbersMinChars: 3,
          fontSize: 12,
          lineHeight: 19,
          scrollBeyondLastLine: false,
          wordWrap: "off",
          renderLineHighlight: "none",
        }}
      />
    </div>
  );
}

function conflictOperationLabel(
  operation: "merge" | "rebase" | "cherryPick" | "revert" | "unknown",
): string {
  if (operation === "cherryPick") return "Cherry-pick";
  if (operation === "unknown") return "Git operation";
  return `${operation.slice(0, 1).toUpperCase()}${operation.slice(1)}`;
}
