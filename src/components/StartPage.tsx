import { useState, type DragEvent } from "react";
import { commandAriaKeyshortcuts } from "../core/commands";
import {
  droppedFilePaths,
} from "../core/dropPaths";
import {
  LANGUAGE_OPTIONS,
  START_PAGE_TEXT,
  localeForLanguage,
  themeOptionsForLanguage,
} from "../core/i18n";
import type { AppLanguage, RecentSession, ThemeMode } from "../core/settings";

interface StartPageProps {
  busy: boolean;
  languageMode: AppLanguage;
  themeMode: ThemeMode;
  recentSessions: RecentSession[];
  recentSessionFailure: { session: RecentSession; message: string } | null;
  onLanguageModeChange: (languageMode: AppLanguage) => void;
  onThemeModeChange: (themeMode: ThemeMode) => void;
  onOpenCompare: () => void;
  onOpenFolders: () => void;
  onOpenMerge: () => void;
  onDropCompareFiles: (paths: [string, string]) => void;
  onDropRejected: (message: string) => void;
  onDemoCompare: () => void;
  onDemoFolders: () => void;
  onDemoMerge: () => void;
  onOpenRecentSession: (session: RecentSession) => void;
  onClearRecentSessions: () => void;
  onRemoveRecentSession: (id: string) => void;
}

export function StartPage({
  busy,
  languageMode,
  themeMode,
  recentSessions,
  recentSessionFailure,
  onLanguageModeChange,
  onThemeModeChange,
  onOpenCompare,
  onOpenFolders,
  onOpenMerge,
  onDropCompareFiles,
  onDropRejected,
  onDemoCompare,
  onDemoFolders,
  onDemoMerge,
  onOpenRecentSession,
  onClearRecentSessions,
  onRemoveRecentSession,
}: StartPageProps) {
  const [dropActive, setDropActive] = useState(false);
  const text = START_PAGE_TEXT[languageMode];
  const themeOptions = themeOptionsForLanguage(languageMode);
  const failedRecentSessionStillVisible = recentSessionFailure
    ? recentSessions.some((session) => session.id === recentSessionFailure.session.id)
    : false;

  const handleDragOver = (event: DragEvent<HTMLElement>) => {
    if (busy) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDropActive(true);
  };

  const handleDragLeave = (event: DragEvent<HTMLElement>) => {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
    setDropActive(false);
  };

  const handleDrop = (event: DragEvent<HTMLElement>) => {
    if (busy) return;
    event.preventDefault();
    setDropActive(false);
    const paths = droppedFilePaths(event.dataTransfer);
    const rejection = startPageDropRejectionMessage(paths.length, languageMode);
    if (rejection) {
      onDropRejected(rejection);
      return;
    }
    onDropCompareFiles([paths[0], paths[1]]);
  };

  return (
    <main
      className={`start-page${dropActive ? " is-drop-active" : ""}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <section className="start-workbench">
        <header className="start-header">
          <div>
            <span className="eyebrow">{text.eyebrow}</span>
            <h1>forktail</h1>
            <p>{text.subtitle}</p>
          </div>
          <div className="start-assurance" aria-label={text.workBoundariesAria}>
            {text.assurances.map((assurance) => (
              <span key={assurance}>{assurance}</span>
            ))}
          </div>
        </header>

        <section className="action-grid" aria-label={text.startComparingAria}>
          <button
            className="action-card primary"
            onClick={onOpenCompare}
            disabled={busy}
            aria-keyshortcuts={commandAriaKeyshortcuts("openCompare")}
          >
            <span className="action-icon">2</span>
            <span className="action-copy">
              <strong>{text.compareTitle}</strong>
              <small>{text.compareDescription}</small>
            </span>
          </button>
          <button
            className="action-card"
            onClick={onOpenFolders}
            disabled={busy}
            aria-keyshortcuts={commandAriaKeyshortcuts("openFolders")}
          >
            <span className="action-icon">⇄</span>
            <span className="action-copy">
              <strong>{text.folderTitle}</strong>
              <small>{text.folderDescription}</small>
            </span>
          </button>
          <button
            className="action-card"
            onClick={onOpenMerge}
            disabled={busy}
            aria-keyshortcuts={commandAriaKeyshortcuts("openMerge")}
          >
            <span className="action-icon">3</span>
            <span className="action-copy">
              <strong>{text.mergeTitle}</strong>
              <small>{text.mergeDescription}</small>
            </span>
          </button>
        </section>

        <div className="start-drop-hint" role="status">
          {text.dropHint}
        </div>

        <section className="start-lower-grid">
          <section className="recent-panel" aria-label={text.recentAria}>
            <div className="recent-heading">
              <strong>{text.recentTitle}</strong>
              {recentSessions.length > 0 && (
                <button className="link-button" onClick={onClearRecentSessions} disabled={busy}>
                  {text.clear}
                </button>
              )}
            </div>
            {recentSessionFailure && failedRecentSessionStillVisible && (
              <div className="recent-warning" role="status">
                <span>{recentSessionFailure.message}</span>
                <button
                  type="button"
                  className="link-button"
                  onClick={() => onRemoveRecentSession(recentSessionFailure.session.id)}
                  disabled={busy}
                >
                  {text.remove}
                </button>
              </div>
            )}
            {recentSessions.length > 0 ? (
              <div className="recent-list">
                {recentSessions.map((session) => (
                  <button
                    key={session.id}
                    className="recent-row"
                    onClick={() => onOpenRecentSession(session)}
                    disabled={busy}
                  >
                    <span className="recent-kind">{recentKindLabel(session, languageMode)}</span>
                    <span className="recent-paths">{recentPathLabel(session)}</span>
                    <time dateTime={new Date(session.updatedAt).toISOString()}>
                      {formatRecentTime(session.updatedAt, languageMode)}
                    </time>
                  </button>
                ))}
              </div>
            ) : (
              <p className="recent-empty">{text.noRecent}</p>
            )}
          </section>

          <aside className="start-side-panel">
            <section className="demo-row" aria-label={text.samplesAria}>
              <span>{text.samples}</span>
              <button className="link-button" onClick={onDemoCompare}>{text.sampleCompare}</button>
              <button className="link-button" onClick={onDemoFolders}>{text.sampleFolders}</button>
              <button className="link-button" onClick={onDemoMerge}>{text.sampleMerge}</button>
            </section>

            <section className="settings-row" aria-label={text.themeAria}>
              <span>{text.theme}</span>
              <div className="segmented-control" role="group" aria-label={text.chooseThemeAria}>
                {themeOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={themeMode === option.value}
                    onClick={() => onThemeModeChange(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </section>

            <section className="settings-row" aria-label={text.languageAria}>
              <span>{text.language}</span>
              <div className="segmented-control" role="group" aria-label={text.chooseLanguageAria}>
                {LANGUAGE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={languageMode === option.value}
                    onClick={() => onLanguageModeChange(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </section>

            <section className="scope-card" aria-label={text.phaseScopeAria}>
              <strong>{text.phaseScope}</strong>
              <div className="scope-pills">
                <span>{text.scopeTextDiff}</span>
                <span>{text.scopeFolderScan}</span>
                <span>{text.scopeMerge}</span>
                <span>{text.scopeAtomicSave}</span>
              </div>
            </section>
          </aside>
        </section>
      </section>
    </main>
  );
}

function startPageDropRejectionMessage(pathCount: number, languageMode: AppLanguage): string | null {
  const text = START_PAGE_TEXT[languageMode];
  if (pathCount === 0) return text.dropPathUnavailable;
  if (pathCount !== 2) return text.dropWrongCount(pathCount);
  return null;
}

function recentKindLabel(session: RecentSession, languageMode: AppLanguage): string {
  if (session.kind === "compare") return "2-way";
  if (session.kind === "folders") return START_PAGE_TEXT[languageMode].folderKind;
  return "3-way";
}

function recentPathLabel(session: RecentSession): string {
  if (session.kind === "compare") {
    return `${basename(session.leftPath)} ↔ ${basename(session.rightPath)}`;
  }
  if (session.kind === "folders") {
    return `${basename(session.leftRoot)} ↔ ${basename(session.rightRoot)} · ${session.options.compareMode}`;
  }
  return `${basename(session.basePath)} / ${basename(session.oursPath)} / ${basename(session.theirsPath)}`;
}

function basename(path: string): string {
  const name = path.split(/[\\/]/).filter(Boolean).pop();
  return name ?? path;
}

function formatRecentTime(timestamp: number, languageMode: AppLanguage): string {
  if (timestamp <= 0) return "";
  return new Date(timestamp).toLocaleString(localeForLanguage(languageMode));
}
