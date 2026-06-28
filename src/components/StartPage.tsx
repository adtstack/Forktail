import { useState, type DragEvent } from "react";
import { commandAriaKeyshortcuts } from "../core/commands";
import {
  compareDropRejectionMessage,
  droppedFilePaths,
} from "../core/dropPaths";
import type { RecentSession, ThemeMode } from "../core/settings";

interface StartPageProps {
  busy: boolean;
  themeMode: ThemeMode;
  recentSessions: RecentSession[];
  recentSessionFailure: { session: RecentSession; message: string } | null;
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
  themeMode,
  recentSessions,
  recentSessionFailure,
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
    const rejection = compareDropRejectionMessage(paths.length);
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
            <span className="eyebrow">LOCAL-FIRST COMPARE</span>
            <h1>forktail</h1>
            <p>파일과 폴더 차이를 빠르게 검토하고, 충돌은 명시적으로 해결합니다.</p>
          </div>
          <div className="start-assurance" aria-label="작업 경계">
            <span>오프라인</span>
            <span>텍스트 전용</span>
            <span>백업 저장</span>
          </div>
        </header>

        <section className="action-grid" aria-label="비교 시작">
          <button
            className="action-card primary"
            onClick={onOpenCompare}
            disabled={busy}
            aria-keyshortcuts={commandAriaKeyshortcuts("openCompare")}
          >
            <span className="action-icon">2</span>
            <span className="action-copy">
              <strong>파일 2-way 비교</strong>
              <small>F7로 변경 블록을 순회합니다.</small>
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
              <strong>폴더 비교</strong>
              <small>상태 필터와 해시 모드로 좁힙니다.</small>
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
              <strong>3-way 병합</strong>
              <small>충돌만 선택하고 결과를 저장합니다.</small>
            </span>
          </button>
        </section>

        <div className="start-drop-hint" role="status">
          파일 두 개를 이 화면에 놓으면 바로 2-way 비교로 엽니다.
        </div>

        <section className="start-lower-grid">
          <section className="recent-panel" aria-label="최근 세션">
            <div className="recent-heading">
              <strong>최근 세션</strong>
              {recentSessions.length > 0 && (
                <button className="link-button" onClick={onClearRecentSessions} disabled={busy}>
                  지우기
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
                  이 항목 제거
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
                    <span className="recent-kind">{recentKindLabel(session)}</span>
                    <span className="recent-paths">{recentPathLabel(session)}</span>
                    <time dateTime={new Date(session.updatedAt).toISOString()}>
                      {formatRecentTime(session.updatedAt)}
                    </time>
                  </button>
                ))}
              </div>
            ) : (
              <p className="recent-empty">최근 세션이 없습니다.</p>
            )}
          </section>

          <aside className="start-side-panel">
            <section className="demo-row" aria-label="샘플 세션">
              <span>샘플</span>
              <button className="link-button" onClick={onDemoCompare}>2-way 데모</button>
              <button className="link-button" onClick={onDemoFolders}>폴더 데모</button>
              <button className="link-button" onClick={onDemoMerge}>3-way 데모</button>
            </section>

            <section className="theme-row" aria-label="테마">
              <span>테마</span>
              <div className="segmented-control" role="group" aria-label="테마 선택">
                {THEME_OPTIONS.map((option) => (
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

            <section className="scope-card" aria-label="1차 개발 범위">
              <strong>Phase 1</strong>
              <div className="scope-pills">
                <span>텍스트 Diff</span>
                <span>폴더 스캔</span>
                <span>3-way Merge</span>
                <span>원자적 저장</span>
              </div>
            </section>
          </aside>
        </section>
      </section>
    </main>
  );
}

const THEME_OPTIONS: Array<{ value: ThemeMode; label: string }> = [
  { value: "system", label: "시스템" },
  { value: "dark", label: "다크" },
  { value: "light", label: "라이트" },
];

function recentKindLabel(session: RecentSession): string {
  if (session.kind === "compare") return "2-way";
  if (session.kind === "folders") return "폴더";
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

function formatRecentTime(timestamp: number): string {
  if (timestamp <= 0) return "";
  return new Date(timestamp).toLocaleString();
}
