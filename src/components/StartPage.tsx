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
      <section className="hero-card">
        <div className="eyebrow">LOCAL-FIRST · NO AI · PHASE 1</div>
        <h1>forktail</h1>
        <p>
          텍스트 파일 비교, 폴더 비교, 3-way 병합에만 집중하는 무료 데스크톱 도구의 시작점입니다.
        </p>
      </section>

      <section className="action-grid" aria-label="비교 시작">
        <button
          className="action-card"
          onClick={onOpenCompare}
          disabled={busy}
          aria-keyshortcuts={commandAriaKeyshortcuts("openCompare")}
        >
          <span className="action-icon">2</span>
          <strong>파일 2-way 비교</strong>
          <small>두 파일을 나란히 열고 줄·단어 차이를 확인합니다.</small>
        </button>
        <button
          className="action-card"
          onClick={onOpenFolders}
          disabled={busy}
          aria-keyshortcuts={commandAriaKeyshortcuts("openFolders")}
        >
          <span className="action-icon">⇄</span>
          <strong>폴더 비교</strong>
          <small>재귀 스캔 후 동일·변경·한쪽 전용 파일을 분류합니다.</small>
        </button>
        <button
          className="action-card primary"
          onClick={onOpenMerge}
          disabled={busy}
          aria-keyshortcuts={commandAriaKeyshortcuts("openMerge")}
        >
          <span className="action-icon">3</span>
          <strong>3-way 병합</strong>
          <small>Base / Ours / Theirs를 자동 병합하고 충돌만 수동 해결합니다.</small>
        </button>
      </section>

      <section className="demo-row">
        <span>브라우저 미리보기:</span>
        <button className="link-button" onClick={onDemoCompare}>2-way 데모</button>
        <button className="link-button" onClick={onDemoFolders}>폴더 데모</button>
        <button className="link-button" onClick={onDemoMerge}>3-way 데모</button>
      </section>

      <section className="theme-row" aria-label="테마">
        <span>테마:</span>
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

      {recentSessions.length > 0 && (
        <section className="recent-panel" aria-label="최근 세션">
          <div className="recent-heading">
            <strong>최근 세션</strong>
            <button className="link-button" onClick={onClearRecentSessions} disabled={busy}>
              지우기
            </button>
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
        </section>
      )}

      <section className="scope-card">
        <strong>1차 개발 범위</strong>
        <div className="scope-pills">
          <span>텍스트 Diff</span>
          <span>폴더 스캔</span>
          <span>3-way Merge</span>
          <span>원자적 저장·백업</span>
          <span>Windows / macOS / Linux</span>
        </div>
        <p>압축 파일·원격 파일 시스템·AI 병합은 범위 밖입니다. 먼저 매일 믿고 쓸 수 있는 기본기를 완성합니다.</p>
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
