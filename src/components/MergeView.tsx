import "../monaco";
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
import { mergeSaveEncodingWarning } from "../core/mergeSave";
import { buildSideDiff, type SideDiffSegment } from "../core/sideDiff";
import { loadMergeSettings, saveMergeSettings } from "../core/settings";
import type { MergeRecoveryDraft } from "../core/mergeRecovery";
import { pathCopyFailureMessage, pathCopySuccessMessage, writeClipboardText } from "../core/pathCopy";
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

interface MergeViewProps {
  session: MergeSession;
  busy: boolean;
  dirty: boolean;
  editorTheme: "vs" | "vs-dark";
  recoveryDraft: MergeRecoveryDraft | null;
  onBack: () => void;
  onResultChange: (text: string) => void;
  onRecoveryDraftsEnabledChange: (enabled: boolean) => void;
  onRestoreRecoveryDraft: () => void;
  onDiscardRecoveryDraft: () => void;
  onSave: () => void;
  onSaveAs: () => void;
}

interface PathCopyState {
  message: string;
  fallbackPath: string | null;
}

export function MergeView({
  session,
  busy,
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
}: MergeViewProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [resultHistory, setResultHistory] = useState(() => createTextHistory(session.result));
  const [mergeSettings, setMergeSettings] = useState(() => loadMergeSettings());
  const [pathCopyState, setPathCopyState] = useState<PathCopyState | null>(null);
  const resultText = resultHistory.present;
  const conflicts = useMemo(() => parseConflictBlocks(resultText), [resultText]);
  const resultEditor = useRef<editor.IStandaloneCodeEditor | null>(null);
  const activeDecorationIds = useRef<string[]>([]);
  const lastSyncedResult = useRef(session.result);
  const language = languageFromPath(session.ours.path || session.theirs.path || session.base.path);
  const saveEncodingWarning = useMemo(() => mergeSaveEncodingWarning(session), [session]);

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
    if (session.outputPath) {
      onSave();
    } else {
      onSaveAs();
    }
  }, [onSave, onSaveAs, session.outputPath]);

  const previousConflict = useCallback(() => {
    if (conflicts.length === 0) return;
    setActiveIndex((current) => (current - 1 + conflicts.length) % conflicts.length);
  }, [conflicts.length]);

  const nextConflict = useCallback(() => {
    if (conflicts.length === 0) return;
    setActiveIndex((current) => (current + 1) % conflicts.length);
  }, [conflicts.length]);

  const handleCommand = useCallback((commandId: AppCommandId) => {
    if (commandId === "redo") {
      redoResult();
      return;
    }
    if (commandId === "undo") {
      undoResult();
      return;
    }
    if (commandId === "saveAs") {
      onSaveAs();
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
    nextConflict,
    onSaveAs,
    previousConflict,
    redoResult,
    saveResult,
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
    onRecoveryDraftsEnabledChange(mergeSettings.recoveryDraftsEnabled);
  }, [mergeSettings, onRecoveryDraftsEnabledChange]);

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
      setPathCopyState({ message: pathCopySuccessMessage(label), fallbackPath: null });
    } catch {
      setPathCopyState({ message: pathCopyFailureMessage, fallbackPath: path });
    }
  };

  return (
    <main className="workspace merge-workspace">
      <header className="toolbar">
        <button onClick={onBack}>← 홈</button>
        <div className="toolbar-divider" />
        <button
          onClick={previousConflict}
          disabled={!activeConflict}
          aria-keyshortcuts={commandAriaKeyshortcuts("previousConflict")}
        >
          ↑ 이전 충돌
        </button>
        <button
          onClick={nextConflict}
          disabled={!activeConflict}
          aria-keyshortcuts={commandAriaKeyshortcuts("nextConflict")}
        >
          ↓ 다음 충돌
        </button>
        <span
          className={conflicts.length ? "conflict-count" : "clean-count"}
          role="status"
          aria-live="polite"
          aria-label={
            conflicts.length
              ? `현재 충돌 ${activeIndex + 1}, 전체 충돌 ${conflicts.length}`
              : "충돌 없음"
          }
        >
          {conflicts.length ? `${activeIndex + 1} / ${conflicts.length} 충돌` : "✓ 충돌 없음"}
        </span>
        <span
          className={dirty ? "dirty-count" : "clean-count"}
          role="status"
          aria-live="polite"
          aria-label={dirty ? "병합 결과 저장 안 됨" : "병합 결과 저장됨"}
        >
          {dirty ? "저장 안 됨" : "저장됨"}
        </span>
        <div className="toolbar-divider" />
        <button
          onClick={undoResult}
          disabled={!canUndoTextHistory(resultHistory)}
          aria-keyshortcuts={commandAriaKeyshortcuts("undo")}
        >
          실행 취소
        </button>
        <button
          onClick={redoResult}
          disabled={!canRedoTextHistory(resultHistory)}
          aria-keyshortcuts={commandAriaKeyshortcuts("redo")}
        >
          다시 실행
        </button>
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
          해결 후 다음
        </label>
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
          draft 복구
        </label>
        <div className="toolbar-spacer" />
        <button
          onClick={saveResult}
          disabled={busy}
          aria-keyshortcuts={commandAriaKeyshortcuts("save")}
        >
          저장
        </button>
        <button
          className="primary-button"
          onClick={onSaveAs}
          disabled={busy}
          aria-keyshortcuts={commandAriaKeyshortcuts("saveAs")}
        >
          다른 이름으로 저장
        </button>
      </header>

      {activeConflict && sideDiffs && (
        <ConflictSideDiff conflict={activeConflict} ours={sideDiffs.ours} theirs={sideDiffs.theirs} />
      )}

      <section className="merge-source-headings">
        <PaneHeading
          label="BASE"
          path={session.base.path}
          onCopyPath={() => {
            void copyPath("BASE", session.base.path);
          }}
        />
        <PaneHeading
          label="OURS"
          path={session.ours.path}
          onCopyPath={() => {
            void copyPath("OURS", session.ours.path);
          }}
        />
        <PaneHeading
          label="THEIRS"
          path={session.theirs.path}
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
      {recoveryDraft && (
        <div className="metadata-warning merge-draft-warning" role="status">
          <span>
            이전에 저장하지 못한 병합 결과 draft가 있습니다. 원본 파일 내용은 별도 캐시하지 않았습니다.
          </span>
          <div className="warning-actions">
            <button type="button" onClick={onRestoreRecoveryDraft}>
              draft 복구
            </button>
            <button type="button" onClick={onDiscardRecoveryDraft}>
              삭제
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
          label="BASE 원본"
          path={session.base.path}
          value={session.base.text}
          language={language}
          editorTheme={editorTheme}
        />
        <SourceEditor
          label="OURS 원본"
          path={session.ours.path}
          value={session.ours.text}
          language={language}
          editorTheme={editorTheme}
        />
        <SourceEditor
          label="THEIRS 원본"
          path={session.theirs.path}
          value={session.theirs.text}
          language={language}
          editorTheme={editorTheme}
        />
        <div
          className="result-panel"
          role="region"
          aria-label={`병합 결과 편집기, 저장 경로 ${session.outputPath ?? "미정"}`}
        >
          <div className="result-heading">
            <div>
              <span className="side-label">RESULT</span>
              <strong>{session.outputPath ?? "저장 경로 미정"}</strong>
            </div>
            {activeConflict && (
              <div className="resolution-buttons">
                <button
                  onClick={() => applyResolution("ours")}
                  aria-keyshortcuts={commandAriaKeyshortcuts("acceptOurs")}
                >
                  OURS 채택
                </button>
                <button
                  onClick={() => applyResolution("theirs")}
                  aria-keyshortcuts={commandAriaKeyshortcuts("acceptTheirs")}
                >
                  THEIRS 채택
                </button>
                <button
                  onClick={() => applyResolution("base")}
                  aria-keyshortcuts={commandAriaKeyshortcuts("acceptBase")}
                >
                  BASE 복원
                </button>
                <button
                  onClick={() => applyResolution("both")}
                  aria-keyshortcuts={commandAriaKeyshortcuts("acceptBoth")}
                >
                  둘 다 유지
                </button>
              </div>
            )}
          </div>
          <Editor
            height="100%"
            language={language}
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
        <span>{language} · 편집 가능</span>
        <span>
          {dirty
            ? "저장하지 않은 결과가 있습니다."
            : conflicts.length
              ? "모든 충돌을 해결한 뒤 저장하세요."
              : "자동 병합 또는 수동 해결 완료"}
        </span>
      </footer>
    </main>
  );
}

function ConflictSideDiff({
  conflict,
  ours,
  theirs,
}: {
  conflict: ConflictBlock;
  ours: ReturnType<typeof buildSideDiff>;
  theirs: ReturnType<typeof buildSideDiff>;
}) {
  return (
    <section className="conflict-side-diff" aria-label={`충돌 ${conflict.id} 단어 차이`}>
      <SideDiffPair title="BASE → OURS" base={ours.base} changed={ours.changed} changedLabel="OURS" />
      <SideDiffPair
        title="BASE → THEIRS"
        base={theirs.base}
        changed={theirs.changed}
        changedLabel="THEIRS"
      />
    </section>
  );
}

function SideDiffPair({
  title,
  base,
  changed,
  changedLabel,
}: {
  title: string;
  base: SideDiffSegment[];
  changed: SideDiffSegment[];
  changedLabel: string;
}) {
  return (
    <div className="side-diff-pair">
      <strong>{title}</strong>
      <DiffLine label="BASE" segments={base} />
      <DiffLine label={changedLabel} segments={changed} />
    </div>
  );
}

function DiffLine({ label, segments }: { label: string; segments: SideDiffSegment[] }) {
  return (
    <div className="side-diff-line">
      <span>{label}</span>
      <code>
        {segments.length === 0 ? (
          <mark className="side-diff-empty">비어 있음</mark>
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
  onCopyPath,
}: {
  label: string;
  path: string;
  onCopyPath: () => void;
}) {
  return (
    <div title={path} role="group" aria-label={`${label} 파일 경로 ${path}`}>
      <span className="side-label">{label}</span>
      <strong>{path.split(/[\\/]/).pop()}</strong>
      <button type="button" className="file-copy-button" onClick={onCopyPath}>
        경로 복사
      </button>
      <small>{path}</small>
    </div>
  );
}

function SourceEditor({
  label,
  path,
  value,
  language,
  editorTheme,
}: {
  label: string;
  path: string;
  value: string;
  language: string;
  editorTheme: "vs" | "vs-dark";
}) {
  return (
    <div className="source-editor" role="region" aria-label={`${label}: ${path}`}>
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
