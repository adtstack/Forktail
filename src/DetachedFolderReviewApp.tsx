import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  checkDetachedFolderReviewVersions,
  loadDetachedFolderReview,
  reloadDetachedFolderReview,
} from "./core/bridge";
import { buildDetachedFolderReviewSession } from "./core/detachedFolderReview";
import { errorMessage, isAppError } from "./core/errors";
import type {
  AppError,
  DetachedFolderReviewLoaded,
  DetachedFolderReviewVersionCheck,
  FolderReviewCompareSession,
} from "./core/models";
import { listenForNativeMenuCommands } from "./core/nativeMenu";
import type { AppLanguage } from "./core/settings";
import { FileCompareView } from "./components/FileCompareView";

interface DetachedFolderReviewNotice extends DetachedFolderReviewVersionCheck {
  message: string;
}

export type DetachedFolderReviewViewState =
  | { kind: "loading" }
  | { kind: "error"; error: Pick<AppError, "code" | "message"> }
  | {
      kind: "ready";
      loaded: DetachedFolderReviewLoaded;
      session: FolderReviewCompareSession;
      notice: DetachedFolderReviewNotice | null;
      operationError: string | null;
    };

interface DetachedFolderReviewViewProps {
  state: DetachedFolderReviewViewState;
  busy: boolean;
  languageMode: AppLanguage;
  editorTheme: "vs" | "vs-dark";
  modelRevision?: number;
  onRetry: () => void;
  onClose: () => void;
  onCheckVersions: () => void;
  onKeepCurrent: () => void;
  onReload: () => void;
}

const TEXT = {
  en: {
    loading: "Loading folder comparison…",
    loadFailed: "Could not load this folder comparison",
    retry: "Retry",
    close: "Close",
    relativePath: "Relative path",
    roots: "Compared roots",
    left: "LEFT",
    right: "RIGHT",
    missing: "MISSING",
    check: "Check for changes",
    reload: "Reload",
    keep: "Keep Current",
    checkAgain: "Check Again",
    changed: (left: boolean, right: boolean) => {
      const sides = [left ? "left" : null, right ? "right" : null]
        .filter((side): side is string => side !== null);
      return `The ${sides.join(" and ")} file changed outside Forktail.`;
    },
  },
  ko: {
    loading: "폴더 파일 비교를 불러오는 중…",
    loadFailed: "폴더 파일 비교를 불러오지 못했습니다",
    retry: "다시 시도",
    close: "닫기",
    relativePath: "상대 경로",
    roots: "비교 루트",
    left: "왼쪽",
    right: "오른쪽",
    missing: "없음",
    check: "외부 변경 확인",
    reload: "다시 읽기",
    keep: "현재 내용 유지",
    checkAgain: "다시 확인",
    changed: (left: boolean, right: boolean) => {
      const sides = [left ? "왼쪽" : null, right ? "오른쪽" : null]
        .filter((side): side is string => side !== null);
      return `${sides.join("과 ")} 파일이 Forktail 밖에서 변경됐습니다.`;
    },
  },
} as const;

export default function DetachedFolderReviewApp() {
  const languageMode = detachedLanguageMode();
  const [state, setState] = useState<DetachedFolderReviewViewState>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [modelRevision, setModelRevision] = useState(0);
  const operationRevision = useRef(0);
  const suppressedVersionKey = useRef<string | null>(null);

  const loadInitial = useCallback(async () => {
    const revision = operationRevision.current + 1;
    operationRevision.current = revision;
    setState({ kind: "loading" });
    try {
      const loaded = await loadDetachedFolderReview();
      if (operationRevision.current !== revision) return;
      setState(readyState(loaded));
      setModelRevision(0);
      suppressedVersionKey.current = null;
    } catch (caught) {
      if (operationRevision.current !== revision) return;
      setState({ kind: "error", error: errorForView(caught, languageMode) });
    }
  }, [languageMode]);

  useEffect(() => {
    void loadInitial();
    return () => { operationRevision.current += 1; };
  }, [loadInitial]);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | null = null;
    void listenForNativeMenuCommands().then((next) => {
      if (!active) {
        next?.();
        return;
      }
      unlisten = next;
    });
    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

  const checkVersions = useCallback(async (explicit = false) => {
    if (busy || state.kind !== "ready") return;
    if (explicit) suppressedVersionKey.current = null;
    setBusy(true);
    try {
      const check = await checkDetachedFolderReviewVersions();
      setState((current) => current.kind !== "ready" ? current : {
        ...current,
        notice: (check.leftChanged || check.rightChanged)
          && check.versionKey !== suppressedVersionKey.current
          ? { ...check, message: TEXT[languageMode].changed(check.leftChanged, check.rightChanged) }
          : null,
        operationError: null,
      });
    } catch (caught) {
      setState((current) => current.kind !== "ready" ? current : {
        ...current,
        operationError: errorMessage(caught, languageMode),
      });
    } finally {
      setBusy(false);
    }
  }, [busy, languageMode, state.kind]);

  useEffect(() => {
    if (state.kind !== "ready") return;
    const handleFocus = () => { void checkVersions(false); };
    window.addEventListener("focus", handleFocus);
    return () => { window.removeEventListener("focus", handleFocus); };
  }, [checkVersions, state.kind]);

  const reload = useCallback(async () => {
    if (busy || state.kind !== "ready") return;
    setBusy(true);
    setState((current) => current.kind !== "ready" ? current : {
      ...current,
      operationError: null,
    });
    try {
      const loaded = await reloadDetachedFolderReview();
      setState(readyState(loaded));
      setModelRevision((current) => current + 1);
      suppressedVersionKey.current = null;
    } catch (caught) {
      setState((current) => current.kind !== "ready" ? current : {
        ...current,
        operationError: errorMessage(caught, languageMode),
      });
    } finally {
      setBusy(false);
    }
  }, [busy, languageMode, state.kind]);

  const keepCurrent = useCallback(() => {
    setState((current) => {
      if (current.kind !== "ready") return current;
      suppressedVersionKey.current = current.notice?.versionKey ?? null;
      return { ...current, notice: null, operationError: null };
    });
  }, []);

  const close = useCallback(() => {
    void getCurrentWindow().close();
  }, []);

  return (
    <DetachedFolderReviewView
      state={state}
      busy={busy}
      languageMode={languageMode}
      editorTheme={detachedEditorTheme()}
      modelRevision={modelRevision}
      onRetry={() => { void loadInitial(); }}
      onClose={close}
      onCheckVersions={() => { void checkVersions(true); }}
      onKeepCurrent={keepCurrent}
      onReload={() => { void reload(); }}
    />
  );
}

export function DetachedFolderReviewView({
  state,
  busy,
  languageMode,
  editorTheme,
  modelRevision = 0,
  onRetry,
  onClose,
  onCheckVersions,
  onKeepCurrent,
  onReload,
}: DetachedFolderReviewViewProps) {
  const text = TEXT[languageMode];
  if (state.kind === "loading") {
    return (
      <main
        className="app-shell detached-review-shell"
        data-surface="folder-review"
        data-theme={editorTheme === "vs-dark" ? "dark" : "light"}
      >
        <div className="detached-review-loading" role="status">{text.loading}</div>
      </main>
    );
  }
  if (state.kind === "error") {
    return (
      <main
        className="app-shell detached-review-shell"
        data-surface="folder-review"
        data-theme={editorTheme === "vs-dark" ? "dark" : "light"}
      >
        <section className="detached-review-error" role="alert">
          <h1>{text.loadFailed}</h1>
          <p>{state.error.message}</p>
          <div className="dialog-actions">
            <button type="button" onClick={onRetry}>{text.retry}</button>
            <button type="button" onClick={onClose}>{text.close}</button>
          </div>
        </section>
      </main>
    );
  }

  const { context } = state.loaded;
  return (
    <main
      className="app-shell detached-review-root"
      data-surface="folder-review"
      data-theme={editorTheme === "vs-dark" ? "dark" : "light"}
    >
      <header className="detached-review-context">
        <div className="detached-review-title">
          <span className="side-label">{text.relativePath}</span>
          <h1>{context.fileName}</h1>
          <strong>{context.parentRelativePath || "(root)"}/</strong>
          <code>{context.relativePath}</code>
        </div>
        <dl className="detached-review-roots" aria-label={text.roots}>
          <div>
            <dt>{text.left}</dt>
            <dd>{context.leftRoot}</dd>
            {context.leftMissing && (
              <span className="warning-badge">{text.left} {text.missing}</span>
            )}
          </div>
          <div>
            <dt>{text.right}</dt>
            <dd>{context.rightRoot}</dd>
            {context.rightMissing && (
              <span className="warning-badge">{text.right} {text.missing}</span>
            )}
          </div>
        </dl>
        <div className="detached-review-actions">
          <button type="button" disabled={busy} onClick={onCheckVersions}>{text.check}</button>
          <button type="button" onClick={onClose}>{text.close}</button>
        </div>
      </header>
      {state.notice && (
        <section className="metadata-warning detached-review-notice" role="status">
          <span>{state.notice.message}</span>
          <div className="warning-actions">
            <button type="button" disabled={busy} onClick={onReload}>{text.reload}</button>
            <button type="button" disabled={busy} onClick={onKeepCurrent}>{text.keep}</button>
            <button type="button" disabled={busy} onClick={onCheckVersions}>{text.checkAgain}</button>
          </div>
        </section>
      )}
      {state.operationError && (
        <section className="metadata-warning detached-review-operation-error" role="alert">
          {state.operationError}
        </section>
      )}
      <section className="detached-review-compare">
        <FileCompareView
          session={state.session}
          busy={busy}
          languageMode={languageMode}
          editorTheme={editorTheme}
          fileChangeNotice={null}
          modelRevision={modelRevision}
          modelIdentity={state.loaded.modelIdentity}
          persistViewSettings={false}
          dirtySides={{ left: false, right: false }}
          backLabel={text.close}
          onBack={onClose}
          onCheckFileVersions={onCheckVersions}
          onKeepCurrentFiles={onKeepCurrent}
          onReloadChangedFiles={onReload}
          onTextChange={() => {}}
          onDropFileOnSide={() => {}}
          onDropRejected={() => {}}
          onExportReport={() => {}}
          onOverwriteChangedFile={() => {}}
          onSaveSide={() => {}}
          onSaveSideAs={() => {}}
          onShowBackups={() => {}}
          onSwap={() => {}}
        />
      </section>
    </main>
  );
}

function readyState(loaded: DetachedFolderReviewLoaded): DetachedFolderReviewViewState {
  return {
    kind: "ready",
    loaded,
    session: buildDetachedFolderReviewSession(loaded),
    notice: null,
    operationError: null,
  };
}

function errorForView(caught: unknown, language: AppLanguage): Pick<AppError, "code" | "message"> {
  if (isAppError(caught)) {
    return { code: caught.code, message: errorMessage(caught, language) };
  }
  return {
    code: "DETACHED_INVALID_STATE",
    message: errorMessage(caught, language),
  };
}

function detachedLanguageMode(): AppLanguage {
  return typeof navigator !== "undefined" && navigator.language.toLowerCase().startsWith("ko")
    ? "ko"
    : "en";
}

function detachedEditorTheme(): "vs" | "vs-dark" {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "vs-dark"
    : "vs";
}
