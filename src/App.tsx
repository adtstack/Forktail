import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { FolderCompareView } from "./components/FolderCompareView";
import { StartPage } from "./components/StartPage";
import {
  cancelFolderScan as cancelFolderScanJob,
  chooseDirectory,
  chooseSavePath,
  chooseTextFile,
  isTauriRuntime,
  listFileBackups,
  mergeTexts,
  readTextFile,
  revealPath,
  restoreTextFileBackup,
  scanDirectories,
  statTextFileVersion,
  startupArgs,
  writeTextFileAtomic,
} from "./core/bridge";
import { buildDiffReport, compareReportDefaultPath } from "./core/diffReport";
import type { CompareDropSide } from "./core/dropPaths";
import {
  APP_COMMAND_EVENT,
  commandIdFromEvent,
  matchesCommandShortcut,
  type AppCommandId,
} from "./core/commands";
import { listenForNativeMenuCommands } from "./core/nativeMenu";
import {
  type CompareSide,
  compareSavePreconditionForPath,
  compareSaveStateAfterSideWrite,
  fileDocumentWithText,
  preservedSaveEncodingForDocument,
  writePreconditionFromDocument,
} from "./core/compareSave";
import { hasUnresolvedConflicts } from "./core/conflicts";
import { errorMessage } from "./core/errors";
import {
  buildCompareFileChangeNotice,
  type CompareFileChangeNotice,
} from "./core/fileVersion";
import {
  mergeSavePreconditionForPath,
  mergeSaveStateAfterWrite,
  unresolvedSaveMessage,
  type WritePrecondition,
} from "./core/mergeSave";
import {
  clearMergeRecoveryDraft,
  loadMergeRecoveryDraft,
  saveMergeRecoveryDraft,
  type MergeRecoveryDraft,
} from "./core/mergeRecovery";
import {
  demoCompareSession,
  demoFolderEntryCompareSession,
  demoFolderScanResult,
  demoMergeSession,
  isDemoComparePaths,
  isDemoFolderRoots,
  isDemoMergePaths,
} from "./core/samples";
import {
  loadAppearanceSettings,
  loadActiveSession,
  loadFolderScanOptions,
  loadMergeSettings,
  loadRecentSessions,
  removeRecentSession,
  saveAppearanceSettings,
  saveActiveSession,
  saveFolderScanOptions,
  saveRecentSessions,
  upsertRecentSession,
  type ActiveSession,
  type ThemeMode,
  type RecentSession,
  type RecentSessionInput,
} from "./core/settings";
import {
  hasUnsavedCompareChanges,
  hasUnsavedMergeChanges,
  markBeforeUnloadIfUnsaved,
  unsavedCompareNavigationMessage,
  unsavedMergeNavigationMessage,
} from "./core/unsaved";
import { parseStartupSessionArgs } from "./core/startupSession";
import type {
  AppMode,
  CompareSession,
  FolderEntry,
  FolderScanOptions,
  FolderScanProgress,
  FolderScanResult,
  FileBackup,
  MergeSession,
} from "./core/models";
import type { TextDiffOptions } from "./core/diffOptions";
import {
  textForSaveLineEnding,
  type SaveLineEndingMode,
} from "./core/lineEndings";

const FileCompareView = lazy(() =>
  import("./components/FileCompareView").then((module) => ({
    default: module.FileCompareView,
  })),
);
const MergeView = lazy(() =>
  import("./components/MergeView").then((module) => ({
    default: module.MergeView,
  })),
);

type BackupDialogState =
  | {
      kind: "compare";
      side: CompareSide;
      targetPath: string;
      title: string;
      backups: FileBackup[];
    }
  | {
      kind: "merge";
      targetPath: string;
      title: string;
      backups: FileBackup[];
    };

export default function App() {
  const [mode, setMode] = useState<AppMode>("home");
  const [compareSession, setCompareSession] = useState<CompareSession | null>(null);
  const [savedCompareText, setSavedCompareText] = useState<Record<CompareSide, string | null>>({
    left: null,
    right: null,
  });
  const [compareOutputVersion, setCompareOutputVersion] =
    useState<Record<CompareSide, WritePrecondition | null>>({ left: null, right: null });
  const [compareModelRevision, setCompareModelRevision] = useState(0);
  const [folderResult, setFolderResult] = useState<FolderScanResult | null>(null);
  const [folderOptions, setFolderOptions] = useState(() => loadFolderScanOptions());
  const [mergeSession, setMergeSession] = useState<MergeSession | null>(null);
  const [savedMergeResult, setSavedMergeResult] = useState<string | null>(null);
  const [mergeOutputVersion, setMergeOutputVersion] = useState<WritePrecondition | null>(null);
  const [mergeRecoveryDraft, setMergeRecoveryDraft] = useState<MergeRecoveryDraft | null>(null);
  const [mergeRecoveryEnabled, setMergeRecoveryEnabled] = useState(
    () => loadMergeSettings().recoveryDraftsEnabled,
  );
  const [busyCount, setBusyCount] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [compareFileChangeNotice, setCompareFileChangeNotice] =
    useState<CompareFileChangeNotice | null>(null);
  const [suppressedCompareFileChangeKey, setSuppressedCompareFileChangeKey] =
    useState<string | null>(null);
  const [folderScanProgress, setFolderScanProgress] = useState<FolderScanProgress | null>(null);
  const [recentSessions, setRecentSessions] = useState<RecentSession[]>(() => loadRecentSessions());
  const [recentSessionFailure, setRecentSessionFailure] = useState<{
    session: RecentSession;
    message: string;
  } | null>(null);
  const [backupDialog, setBackupDialog] = useState<BackupDialogState | null>(null);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => loadAppearanceSettings().theme);
  const [systemTheme, setSystemTheme] = useState<"dark" | "light">(() => preferredSystemTheme());
  const pendingLeaveAction = useRef<(() => void) | null>(null);
  const pendingSaveAction = useRef<(() => void) | null>(null);
  const activeFolderScanId = useRef(0);
  const releasedFolderScanIds = useRef(new Set<number>());
  const attemptedActiveSessionRestore = useRef(false);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const [showUnresolvedSaveDialog, setShowUnresolvedSaveDialog] = useState(false);
  const [activeSessionStorageReady, setActiveSessionStorageReady] = useState(false);

  const busy = busyCount > 0;

  const beginBusy = useCallback(() => {
    setBusyCount((current) => current + 1);
  }, []);

  const endBusy = useCallback(() => {
    setBusyCount((current) => Math.max(0, current - 1));
  }, []);

  const run = useCallback(async (
    operation: () => Promise<void>,
    onError?: (message: string) => void,
  ) => {
    beginBusy();
    setError(null);
    setMessage(null);
    setRecentSessionFailure(null);
    try {
      await operation();
    } catch (caught) {
      const message = errorMessage(caught);
      setError(message);
      onError?.(message);
    } finally {
      endBusy();
    }
  }, [beginBusy, endBusy]);

  const rememberRecentSession = useCallback((input: RecentSessionInput) => {
    setRecentSessions((current) => {
      const next = upsertRecentSession(current, input);
      saveRecentSessions(next);
      return next;
    });
  }, []);

  const setCleanCompareSession = useCallback((session: CompareSession) => {
    setCompareSession(session);
    setSavedCompareText({ left: session.left.text, right: session.right.text });
    setCompareOutputVersion({
      left: writePreconditionFromDocument(session.left),
      right: writePreconditionFromDocument(session.right),
    });
    setCompareModelRevision((current) => current + 1);
  }, []);

  const setCleanMergeSession = useCallback((
    session: MergeSession,
    outputVersion: WritePrecondition | null = null,
  ) => {
    setMergeSession(session);
    setSavedMergeResult(session.result);
    setMergeOutputVersion(outputVersion);
    setMergeRecoveryDraft(mergeRecoveryEnabled ? loadMergeRecoveryDraft(session) : null);
  }, [mergeRecoveryEnabled]);

  const updateCompareSideText = useCallback((side: CompareSide, text: string) => {
    setCompareSession((current) => {
      if (!current || current[side].text === text) return current;
      return {
        ...current,
        [side]: fileDocumentWithText(current[side], text),
      };
    });
  }, []);

  const updateMergeResult = useCallback((result: string) => {
    setMergeSession((current) => current ? { ...current, result } : current);
    setMergeRecoveryDraft(null);
  }, []);

  const clearRecentSessions = useCallback(() => {
    saveRecentSessions([]);
    setRecentSessions([]);
    setRecentSessionFailure(null);
  }, []);

  const rejectDroppedFiles = useCallback((message: string) => {
    setMessage(null);
    setError(message);
  }, []);

  const removeRecentSessionById = useCallback((id: string) => {
    setRecentSessions((current) => {
      const next = removeRecentSession(current, id);
      saveRecentSessions(next);
      return next;
    });
    setRecentSessionFailure((current) => current?.session.id === id ? null : current);
    setMessage("최근 세션 항목을 제거했습니다.");
  }, []);

  const compareHasUnsavedChanges =
    mode === "compare" &&
    compareSession != null &&
    (hasUnsavedCompareChanges(compareSession.left.text, savedCompareText.left) ||
      hasUnsavedCompareChanges(compareSession.right.text, savedCompareText.right));
  const compareDirtySides = {
    left: mode === "compare" && compareSession != null
      ? hasUnsavedCompareChanges(compareSession.left.text, savedCompareText.left)
      : false,
    right: mode === "compare" && compareSession != null
      ? hasUnsavedCompareChanges(compareSession.right.text, savedCompareText.right)
      : false,
  };
  const mergeHasUnsavedChanges =
    mode === "merge" &&
    mergeSession != null &&
    hasUnsavedMergeChanges(mergeSession.result, savedMergeResult);
  const activeUnsavedMessage = compareHasUnsavedChanges
    ? unsavedCompareNavigationMessage
    : mergeHasUnsavedChanges
      ? unsavedMergeNavigationMessage
      : null;
  const activeUnsavedTitle = compareHasUnsavedChanges
    ? "저장하지 않은 비교 파일"
    : "저장하지 않은 병합 결과";
  const resolvedTheme = themeMode === "system" ? systemTheme : themeMode;
  const editorTheme = resolvedTheme === "dark" ? "vs-dark" : "vs";

  const checkCompareFileVersions = useCallback(async (session = compareSession) => {
    if (!session || !isTauriRuntime()) return;
    const [leftResult, rightResult] = await Promise.allSettled([
      statTextFileVersion(session.left.path),
      statTextFileVersion(session.right.path),
    ]);
    const baselineSession = {
      ...session,
      left: compareOutputVersion.left
        ? {
            ...session.left,
            size: compareOutputVersion.left.expectedSize,
            modifiedMs: compareOutputVersion.left.expectedModifiedMs,
          }
        : session.left,
      right: compareOutputVersion.right
        ? {
            ...session.right,
            size: compareOutputVersion.right.expectedSize,
            modifiedMs: compareOutputVersion.right.expectedModifiedMs,
          }
        : session.right,
    };
    const notice = buildCompareFileChangeNotice(
      baselineSession,
      leftResult.status === "fulfilled" ? leftResult.value : null,
      rightResult.status === "fulfilled" ? rightResult.value : null,
    );

    if (!notice) {
      setCompareFileChangeNotice(null);
      return;
    }
    if (notice.versionKey === suppressedCompareFileChangeKey) return;
    setCompareFileChangeNotice((current) =>
      current?.versionKey === notice.versionKey ? current : notice,
    );
  }, [compareOutputVersion, compareSession, suppressedCompareFileChangeKey]);

  const reloadChangedCompareFiles = useCallback(() => run(async () => {
    if (!compareSession || !compareFileChangeNotice) return;
    const [left, right] = await Promise.all([
      compareFileChangeNotice.leftChanged
        ? readTextFile(compareSession.left.path)
        : Promise.resolve(compareSession.left),
      compareFileChangeNotice.rightChanged
        ? readTextFile(compareSession.right.path)
        : Promise.resolve(compareSession.right),
    ]);
    setCleanCompareSession({ left, right });
    setCompareFileChangeNotice(null);
    setSuppressedCompareFileChangeKey(null);
    setMessage("변경된 파일을 다시 읽었습니다.");
  }), [compareFileChangeNotice, compareSession, run, setCleanCompareSession]);

  const keepCurrentCompareFiles = useCallback(() => {
    if (compareFileChangeNotice) {
      setSuppressedCompareFileChangeKey(compareFileChangeNotice.versionKey);
    }
    setCompareFileChangeNotice(null);
  }, [compareFileChangeNotice]);

  const startFolderScan = useCallback((
    leftRoot: string,
    rightRoot: string,
    options: FolderScanOptions,
    onError?: (message: string) => void,
  ) => {
    const scanId = activeFolderScanId.current + 1;
    activeFolderScanId.current = scanId;
    beginBusy();
    setError(null);
    setMessage(null);
    setRecentSessionFailure(null);
    setFolderScanProgress({
      jobId: scanId,
      active: true,
      leftRoot,
      rightRoot,
      message: "폴더 스캔 중입니다. 오래 걸리면 취소하고 옵션을 조정할 수 있습니다.",
    });

    void (async () => {
      try {
        const result = await scanDirectories(leftRoot, rightRoot, options, scanId);
        if (activeFolderScanId.current !== scanId) return;
        setFolderOptions(options);
        saveFolderScanOptions(options);
        setFolderResult(result);
        rememberRecentSession({ kind: "folders", leftRoot, rightRoot, options });
        setMode("folders");
        setFolderScanProgress(null);
      } catch (caught) {
        if (activeFolderScanId.current !== scanId) return;
        const message = errorMessage(caught);
        setError(message);
        onError?.(message);
        setFolderScanProgress(null);
      } finally {
        if (releasedFolderScanIds.current.delete(scanId)) return;
        endBusy();
      }
    })();
  }, [beginBusy, endBusy, rememberRecentSession]);

  const cancelFolderScan = useCallback(() => {
    if (!folderScanProgress?.active) return;
    const scanId = activeFolderScanId.current;
    activeFolderScanId.current = scanId + 1;
    releasedFolderScanIds.current.add(scanId);
    void cancelFolderScanJob(scanId).catch(() => {});
    endBusy();
    setError(null);
    setMessage("폴더 스캔을 취소했습니다.");
    setFolderScanProgress({
      ...folderScanProgress,
      active: false,
      message: "스캔을 취소했습니다. 늦게 도착한 결과는 화면에 반영하지 않습니다.",
    });
  }, [endBusy, folderScanProgress]);

  const restoreStoredSession = useCallback((
    session: ActiveSession,
    options: { remember: boolean } = { remember: true },
  ) => run(async () => {
    if (session.kind === "compare") {
      if (isDemoComparePaths(session.leftPath, session.rightPath)) {
        setCleanCompareSession(demoCompareSession());
      } else {
        if (!isTauriRuntime()) {
          throw new Error("브라우저에서는 데모 세션만 자동 복원할 수 있습니다.");
        }
        const [left, right] = await Promise.all([
          readTextFile(session.leftPath),
          readTextFile(session.rightPath),
        ]);
        setCleanCompareSession({ left, right });
      }
      if (options.remember) rememberRecentSession(session);
      setMode("compare");
      return;
    }

    if (session.kind === "folders") {
      setFolderOptions(session.options);
      saveFolderScanOptions(session.options);
      if (isDemoFolderRoots(session.leftRoot, session.rightRoot)) {
        setFolderResult(demoFolderScanResult());
        if (options.remember) rememberRecentSession(session);
        setMode("folders");
        return;
      }
      if (!isTauriRuntime()) {
        throw new Error("브라우저에서는 데모 세션만 자동 복원할 수 있습니다.");
      }
      startFolderScan(session.leftRoot, session.rightRoot, session.options);
      return;
    }

    if (isDemoMergePaths(session.basePath, session.oursPath, session.theirsPath)) {
      setCleanMergeSession({ ...demoMergeSession(), outputPath: session.outputPath });
    } else {
      if (!isTauriRuntime()) {
        throw new Error("브라우저에서는 데모 세션만 자동 복원할 수 있습니다.");
      }
      const [base, ours, theirs] = await Promise.all([
        readTextFile(session.basePath),
        readTextFile(session.oursPath),
        readTextFile(session.theirsPath),
      ]);
      if (base.isBinary || ours.isBinary || theirs.isBinary) {
        throw new Error("3-way 병합은 텍스트 파일만 지원합니다.");
      }
      const merged = await mergeTexts(base.text, ours.text, theirs.text);
      setCleanMergeSession({
        base,
        ours,
        theirs,
        result: merged.output,
        outputPath: session.outputPath,
      });
    }
    if (options.remember) rememberRecentSession(session);
    setMode("merge");
  }), [
    rememberRecentSession,
    run,
    setCleanCompareSession,
    setCleanMergeSession,
    startFolderScan,
  ]);

  useEffect(() => {
    saveAppearanceSettings({ theme: themeMode });
  }, [themeMode]);

  useEffect(() => {
    setCompareFileChangeNotice(null);
    setSuppressedCompareFileChangeKey(null);
  }, [
    compareSession?.left.modifiedMs,
    compareSession?.left.path,
    compareSession?.left.size,
    compareSession?.right.modifiedMs,
    compareSession?.right.path,
    compareSession?.right.size,
  ]);

  useEffect(() => {
    if (mode !== "compare" || !compareSession || !isTauriRuntime()) return;
    let cancelled = false;
    const check = () => {
      void checkCompareFileVersions(compareSession).then(() => {
        if (cancelled) return;
      });
    };

    check();
    const intervalId = window.setInterval(check, 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [checkCompareFileVersions, compareSession, mode]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const updateSystemTheme = () => setSystemTheme(media.matches ? "dark" : "light");

    updateSystemTheme();
    media.addEventListener("change", updateSystemTheme);
    return () => media.removeEventListener("change", updateSystemTheme);
  }, []);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      markBeforeUnloadIfUnsaved(event, activeUnsavedMessage);
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [activeUnsavedMessage]);

  useEffect(() => {
    if (attemptedActiveSessionRestore.current) return;
    attemptedActiveSessionRestore.current = true;

    void (async () => {
      if (isTauriRuntime()) {
        try {
          const startupSession = parseStartupSessionArgs(await startupArgs());
          if (startupSession.status === "valid") {
            await restoreStoredSession(startupSession.session, { remember: true });
            return;
          }
          if (startupSession.status === "invalid") {
            saveActiveSession(null);
            setError(startupSession.message);
            return;
          }
        } catch (caught) {
          setError(errorMessage(caught));
        }
      }

      const activeSession = loadActiveSession();
      if (!activeSession) return;
      await restoreStoredSession(activeSession, { remember: false });
    })()
      .catch(() => {
        saveActiveSession(null);
      })
      .finally(() => {
        setActiveSessionStorageReady(true);
      });
  }, [restoreStoredSession]);

  useEffect(() => {
    if (!activeSessionStorageReady) return;

    if (mode === "compare" && compareSession) {
      saveActiveSession({
        kind: "compare",
        leftPath: compareSession.left.path,
        rightPath: compareSession.right.path,
      });
      return;
    }

    if (mode === "folders" && folderResult) {
      saveActiveSession({
        kind: "folders",
        leftRoot: folderResult.leftRoot,
        rightRoot: folderResult.rightRoot,
        options: folderOptions,
      });
      return;
    }

    if (mode === "merge" && mergeSession) {
      saveActiveSession({
        kind: "merge",
        basePath: mergeSession.base.path,
        oursPath: mergeSession.ours.path,
        theirsPath: mergeSession.theirs.path,
        outputPath: mergeSession.outputPath,
      });
      return;
    }

    if (mode === "home") {
      saveActiveSession(null);
    }
  }, [
    activeSessionStorageReady,
    compareSession,
    folderOptions,
    folderResult,
    mergeSession,
    mode,
  ]);

  useEffect(() => {
    if (mode !== "merge" || !mergeSession) return;
    if (!mergeRecoveryEnabled) {
      clearMergeRecoveryDraft(mergeSession);
      setMergeRecoveryDraft(null);
      return;
    }
    if (!hasUnsavedMergeChanges(mergeSession.result, savedMergeResult)) return;
    saveMergeRecoveryDraft(mergeSession);
  }, [mergeRecoveryEnabled, mergeSession, mode, savedMergeResult]);

  const requestLeaveActiveSession = useCallback((leave: () => void) => {
    if (!activeUnsavedMessage) {
      leave();
      return;
    }

    pendingLeaveAction.current = leave;
    setShowUnsavedDialog(true);
  }, [activeUnsavedMessage]);

  const cancelPendingLeave = useCallback(() => {
    pendingLeaveAction.current = null;
    setShowUnsavedDialog(false);
  }, []);

  const confirmPendingLeave = useCallback(() => {
    const leave = pendingLeaveAction.current;
    pendingLeaveAction.current = null;
    setShowUnsavedDialog(false);
    if (compareHasUnsavedChanges && compareSession) {
      setSavedCompareText({ left: compareSession.left.text, right: compareSession.right.text });
    }
    if (mergeHasUnsavedChanges && mergeSession) {
      clearMergeRecoveryDraft(mergeSession);
      setMergeRecoveryDraft(null);
      setSavedMergeResult(mergeSession.result);
    }
    leave?.();
  }, [compareHasUnsavedChanges, compareSession, mergeHasUnsavedChanges, mergeSession]);

  const cancelPendingSave = useCallback(() => {
    pendingSaveAction.current = null;
    setShowUnresolvedSaveDialog(false);
  }, []);

  const confirmPendingSave = useCallback(() => {
    const save = pendingSaveAction.current;
    pendingSaveAction.current = null;
    setShowUnresolvedSaveDialog(false);
    save?.();
  }, []);

  const backHome = () => {
    requestLeaveActiveSession(() => {
      setMode("home");
      setMessage(null);
      setError(null);
    });
  };

  const openCompare = () => requestLeaveActiveSession(() => run(async () => {
    const leftPath = await chooseTextFile("왼쪽 파일 선택");
    if (!leftPath) return;
    const rightPath = await chooseTextFile("오른쪽 파일 선택");
    if (!rightPath) return;
    const [left, right] = await Promise.all([readTextFile(leftPath), readTextFile(rightPath)]);
    setCleanCompareSession({ left, right });
    rememberRecentSession({ kind: "compare", leftPath, rightPath });
    setMode("compare");
  }));

  const openDroppedCompareFiles = (paths: [string, string]) =>
    requestLeaveActiveSession(() => run(async () => {
      const [leftPath, rightPath] = paths;
      const [left, right] = await Promise.all([readTextFile(leftPath), readTextFile(rightPath)]);
      setCleanCompareSession({ left, right });
      rememberRecentSession({ kind: "compare", leftPath, rightPath });
      setMode("compare");
    }));

  const replaceDroppedCompareSide = (side: CompareDropSide, path: string) => {
    const replaceSide = () => {
      void run(async () => {
        if (!compareSession) return;
        const document = await readTextFile(path);
        if (side === "left") {
          setCompareSession({ ...compareSession, left: document });
          setSavedCompareText((current) => ({ ...current, left: document.text }));
          setCompareOutputVersion((current) => ({
            ...current,
            left: writePreconditionFromDocument(document),
          }));
          setCompareModelRevision((current) => current + 1);
          setMessage("왼쪽 파일을 드롭한 파일로 바꿨습니다.");
          return;
        }

        setCompareSession({ ...compareSession, right: document });
        setSavedCompareText((current) => ({ ...current, right: document.text }));
        setCompareOutputVersion((current) => ({
          ...current,
          right: writePreconditionFromDocument(document),
        }));
        setCompareModelRevision((current) => current + 1);
        setMessage("오른쪽 파일을 드롭한 파일로 바꿨습니다.");
      });
    };

    if (compareHasUnsavedChanges) {
      requestLeaveActiveSession(replaceSide);
      return;
    }

    replaceSide();
  };

  const openFolders = () => requestLeaveActiveSession(() => run(async () => {
    const leftRoot = await chooseDirectory("왼쪽 폴더 선택");
    if (!leftRoot) return;
    const rightRoot = await chooseDirectory("오른쪽 폴더 선택");
    if (!rightRoot) return;
    startFolderScan(leftRoot, rightRoot, folderOptions);
  }));

  const rescanFolders = (options: FolderScanOptions) => {
    if (!folderResult) return;
    setFolderOptions(options);
    saveFolderScanOptions(options);
    if (isDemoFolderRoots(folderResult.leftRoot, folderResult.rightRoot)) {
      setFolderResult(demoFolderScanResult());
      return;
    }
    startFolderScan(folderResult.leftRoot, folderResult.rightRoot, options);
  };

  const openFolderEntry = (entry: FolderEntry) => run(async () => {
    if (!entry.leftPath || !entry.rightPath) {
      throw new Error("양쪽에 모두 존재하는 파일만 2-way 비교할 수 있습니다.");
    }
    if (entry.left?.kind !== "file" || entry.right?.kind !== "file") {
      throw new Error("현재는 일반 파일만 열 수 있습니다.");
    }
    if (folderResult && isDemoFolderRoots(folderResult.leftRoot, folderResult.rightRoot)) {
      const demoSession = demoFolderEntryCompareSession(entry);
      if (!demoSession) {
        throw new Error("양쪽 일반 파일만 2-way 비교할 수 있습니다.");
      }
      setCleanCompareSession(demoSession);
      setMode("compare");
      return;
    }
    const [left, right] = await Promise.all([
      readTextFile(entry.leftPath),
      readTextFile(entry.rightPath),
    ]);
    setCleanCompareSession({ left, right });
    rememberRecentSession({ kind: "compare", leftPath: entry.leftPath, rightPath: entry.rightPath });
    setMode("compare");
  });

  const revealFolderPath = useCallback((path: string) => {
    void run(async () => {
      await revealPath(path);
      setMessage("파일 관리자에서 항목을 열었습니다.");
    });
  }, [run]);

  const openMerge = useCallback(() => requestLeaveActiveSession(() => run(async () => {
    const basePath = await chooseTextFile("BASE 파일 선택");
    if (!basePath) return;
    const oursPath = await chooseTextFile("OURS 파일 선택");
    if (!oursPath) return;
    const theirsPath = await chooseTextFile("THEIRS 파일 선택");
    if (!theirsPath) return;

    const [base, ours, theirs] = await Promise.all([
      readTextFile(basePath),
      readTextFile(oursPath),
      readTextFile(theirsPath),
    ]);
    if (base.isBinary || ours.isBinary || theirs.isBinary) {
      throw new Error("3-way 병합은 텍스트 파일만 지원합니다.");
    }

    const merged = await mergeTexts(base.text, ours.text, theirs.text);
    setCleanMergeSession({ base, ours, theirs, result: merged.output, outputPath: null });
    rememberRecentSession({
      kind: "merge",
      basePath,
      oursPath,
      theirsPath,
      outputPath: null,
    });
    setMode("merge");
  })), [rememberRecentSession, requestLeaveActiveSession, run, setCleanMergeSession]);

  const openRecentSession = (session: RecentSession) => requestLeaveActiveSession(() => run(async () => {
    if (session.kind === "compare") {
      const [left, right] = await Promise.all([
        readTextFile(session.leftPath),
        readTextFile(session.rightPath),
      ]);
      setCleanCompareSession({ left, right });
      rememberRecentSession({
        kind: "compare",
        leftPath: session.leftPath,
        rightPath: session.rightPath,
      });
      setMode("compare");
      return;
    }

    if (session.kind === "folders") {
      setFolderOptions(session.options);
      saveFolderScanOptions(session.options);
      startFolderScan(session.leftRoot, session.rightRoot, session.options, (failureMessage) => {
        setRecentSessionFailure({
          session,
          message: `최근 세션을 열 수 없습니다. ${failureMessage} 경로가 이동되었거나 권한이 바뀌었다면 이 항목을 제거하세요.`,
        });
      });
      return;
    }

    const [base, ours, theirs] = await Promise.all([
      readTextFile(session.basePath),
      readTextFile(session.oursPath),
      readTextFile(session.theirsPath),
    ]);
    if (base.isBinary || ours.isBinary || theirs.isBinary) {
      throw new Error("3-way 병합은 텍스트 파일만 지원합니다.");
    }

    const merged = await mergeTexts(base.text, ours.text, theirs.text);
    setCleanMergeSession({ base, ours, theirs, result: merged.output, outputPath: session.outputPath });
    rememberRecentSession({
      kind: "merge",
      basePath: session.basePath,
      oursPath: session.oursPath,
      theirsPath: session.theirsPath,
      outputPath: session.outputPath,
    });
    setMode("merge");
  }, (failureMessage) => {
    setRecentSessionFailure({
      session,
      message: `최근 세션을 열 수 없습니다. ${failureMessage} 경로가 이동되었거나 권한이 바뀌었다면 이 항목을 제거하세요.`,
    });
  }));

  const saveCompareNow = useCallback((
    side: CompareSide,
    forceSaveAs: boolean,
    forceOverwrite = false,
    lineEndingMode: SaveLineEndingMode = "original",
  ) => run(async () => {
    if (!compareSession) return;
    const target = compareSession[side];
    const sideLabel = side === "left" ? "왼쪽" : "오른쪽";
    let outputPath = forceSaveAs ? null : target.path;
    if (!outputPath) {
      outputPath = await chooseSavePath(target.path, `${sideLabel} 파일 저장`);
    }
    if (!outputPath) return;

    const precondition = compareSavePreconditionForPath(
      compareSession,
      outputPath,
      compareOutputVersion[side],
      side,
    );
    const saveText = textForSaveLineEnding(target.text, target.lineEnding, lineEndingMode);
    const written = await writeTextFileAtomic(
      outputPath,
      saveText,
      true,
      forceOverwrite ? null : precondition,
      preservedSaveEncodingForDocument(target),
    );
    const saved = compareSaveStateAfterSideWrite(compareSession, side, saveText, written);
    setCompareSession(saved.session);
    setSavedCompareText((current) => ({ ...current, [side]: saved.savedSnapshot }));
    setCompareOutputVersion((current) => ({ ...current, [side]: saved.outputVersion }));
    setCompareFileChangeNotice(null);
    setSuppressedCompareFileChangeKey(null);
    rememberRecentSession({
      kind: "compare",
      leftPath: saved.session.left.path,
      rightPath: saved.session.right.path,
    });
    setMessage(`${sideLabel} ${saved.message}`);
  }), [compareOutputVersion, compareSession, rememberRecentSession, run]);

  const exportCompareReport = useCallback((options: TextDiffOptions) => run(async () => {
    if (!compareSession) return;
    const outputPath = await chooseSavePath(
      compareReportDefaultPath(compareSession),
      "Diff 리포트 저장",
    );
    if (!outputPath) return;
    const report = buildDiffReport({ session: compareSession, options, generatedAt: new Date() });
    const written = await writeTextFileAtomic(outputPath, report, true, null, "UTF-8");
    setMessage(`리포트 저장 완료: ${written.path}`);
  }), [compareSession, run]);

  const showCompareBackups = useCallback((side: CompareSide) => run(async () => {
    if (!compareSession) return;
    const target = compareSession[side];
    const sideLabel = side === "left" ? "왼쪽" : "오른쪽";
    const backups = await listFileBackups(target.path);
    setBackupDialog({
      kind: "compare",
      side,
      targetPath: target.path,
      title: `${sideLabel} 파일 백업`,
      backups,
    });
  }), [compareSession, run]);

  const saveMergeNow = useCallback((
    forceSaveAs: boolean,
    lineEndingMode: SaveLineEndingMode = "original",
  ) => run(async () => {
    if (!mergeSession) return;
    let outputPath = forceSaveAs ? null : mergeSession.outputPath;
    if (!outputPath) {
      outputPath = await chooseSavePath(
        mergeSession.outputPath ?? mergeSession.ours.path,
        "병합 결과 저장",
      );
    }
    if (!outputPath) return;
    const precondition = mergeSavePreconditionForPath(mergeSession, outputPath, mergeOutputVersion);
    const saveText = textForSaveLineEnding(
      mergeSession.result,
      mergeSession.ours.lineEnding,
      lineEndingMode,
    );
    const written = await writeTextFileAtomic(
      outputPath,
      saveText,
      true,
      precondition,
      "UTF-8",
    );
    const saved = mergeSaveStateAfterWrite(saveText, written);
    clearMergeRecoveryDraft(mergeSession);
    setMergeRecoveryDraft(null);
    setMergeSession((current) =>
      current ? { ...current, result: saved.savedSnapshot, outputPath: saved.outputPath } : current,
    );
    setSavedMergeResult(saved.savedSnapshot);
    setMergeOutputVersion(saved.outputVersion);
    rememberRecentSession({
      kind: "merge",
      basePath: mergeSession.base.path,
      oursPath: mergeSession.ours.path,
      theirsPath: mergeSession.theirs.path,
      outputPath: saved.outputPath,
    });
    setMessage(saved.message);
  }), [mergeOutputVersion, mergeSession, rememberRecentSession, run]);

  const showMergeBackups = useCallback(() => run(async () => {
    if (!mergeSession?.outputPath) return;
    const backups = await listFileBackups(mergeSession.outputPath);
    setBackupDialog({
      kind: "merge",
      targetPath: mergeSession.outputPath,
      title: "병합 결과 백업",
      backups,
    });
  }), [mergeSession, run]);

  const restoreBackup = useCallback((backup: FileBackup) => run(async () => {
    if (!backupDialog) return;
    const precondition = backupDialog.kind === "compare" && compareSession
      ? compareSavePreconditionForPath(
          compareSession,
          backupDialog.targetPath,
          compareOutputVersion[backupDialog.side],
          backupDialog.side,
        )
      : backupDialog.kind === "merge" && mergeSession
        ? mergeSavePreconditionForPath(mergeSession, backupDialog.targetPath, mergeOutputVersion)
        : null;

    const written = await restoreTextFileBackup(backupDialog.targetPath, backup.path, precondition);
    const restored = await readTextFile(written.path);

    if (backupDialog.kind === "compare") {
      setCompareSession((current) => current ? {
        ...current,
        [backupDialog.side]: restored,
      } : current);
      setSavedCompareText((current) => ({
        ...current,
        [backupDialog.side]: restored.text,
      }));
      setCompareOutputVersion((current) => ({
        ...current,
        [backupDialog.side]: writePreconditionFromDocument(restored),
      }));
      setCompareModelRevision((current) => current + 1);
    } else {
      setMergeSession((current) => current ? {
        ...current,
        result: restored.text,
        outputPath: restored.path,
      } : current);
      setSavedMergeResult(restored.text);
      setMergeOutputVersion(writePreconditionFromDocument(restored));
      if (mergeSession) clearMergeRecoveryDraft(mergeSession);
      setMergeRecoveryDraft(null);
    }

    setBackupDialog(null);
    setMessage(`백업 복원 완료: ${restored.path}`);
  }), [backupDialog, compareOutputVersion, compareSession, mergeOutputVersion, mergeSession, run]);

  const saveMerge = useCallback((
    forceSaveAs: boolean,
    lineEndingMode: SaveLineEndingMode = "original",
  ) => {
    if (!mergeSession) return;
    if (!hasUnresolvedConflicts(mergeSession.result)) {
      saveMergeNow(forceSaveAs, lineEndingMode);
      return;
    }

    pendingSaveAction.current = () => saveMergeNow(forceSaveAs, lineEndingMode);
    setShowUnresolvedSaveDialog(true);
  }, [mergeSession, saveMergeNow]);

  const handleShellCommand = useCallback((commandId: AppCommandId) => {
    if (commandId === "openMerge") {
      openMerge();
      return;
    }
    if (commandId === "openFolders") {
      openFolders();
      return;
    }
    if (commandId === "openCompare") {
      openCompare();
    }
  }, [openCompare, openFolders, openMerge]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (matchesCommandShortcut("openMerge", event)) {
        event.preventDefault();
        handleShellCommand("openMerge");
        return;
      }
      if (matchesCommandShortcut("openFolders", event)) {
        event.preventDefault();
        handleShellCommand("openFolders");
        return;
      }
      if (matchesCommandShortcut("openCompare", event)) {
        event.preventDefault();
        handleShellCommand("openCompare");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleShellCommand]);

  useEffect(() => {
    const handleCommandEvent = (event: Event) => {
      const commandId = commandIdFromEvent(event);
      if (!commandId) return;
      handleShellCommand(commandId);
    };

    window.addEventListener(APP_COMMAND_EVENT, handleCommandEvent);
    return () => window.removeEventListener(APP_COMMAND_EVENT, handleCommandEvent);
  }, [handleShellCommand]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    void listenForNativeMenuCommands().then((dispose) => {
      unlisten = dispose;
    });
    return () => unlisten?.();
  }, []);

  return (
    <div className="app-shell" data-theme={resolvedTheme}>
      {busy && <div className="busy-bar" role="status" aria-live="polite" aria-label="작업 중" />}
      {error && (
        <div className="toast error-toast">
          <strong>오류</strong>
          <span>{error}</span>
          <button aria-label="오류 메시지 닫기" onClick={() => setError(null)}>×</button>
        </div>
      )}
      {message && (
        <div className="toast success-toast">
          <strong>완료</strong>
          <span>{message}</span>
          <button aria-label="완료 메시지 닫기" onClick={() => setMessage(null)}>×</button>
        </div>
      )}
      {showUnsavedDialog && (
        <div className="modal-backdrop">
          <section
            className="confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="unsaved-dialog-title"
          >
            <h2 id="unsaved-dialog-title">{activeUnsavedTitle}</h2>
            <p>{activeUnsavedMessage}</p>
            <div className="dialog-actions">
              <button type="button" onClick={cancelPendingLeave}>계속 편집</button>
              <button type="button" className="danger-button" onClick={confirmPendingLeave}>
                변경 버리고 이동
              </button>
            </div>
          </section>
        </div>
      )}
      {showUnresolvedSaveDialog && (
        <div className="modal-backdrop">
          <section
            className="confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="unresolved-save-dialog-title"
          >
            <h2 id="unresolved-save-dialog-title">충돌 마커가 남아 있습니다</h2>
            <p>{unresolvedSaveMessage}</p>
            <div className="dialog-actions">
              <button type="button" onClick={cancelPendingSave}>계속 편집</button>
              <button type="button" className="danger-button" onClick={confirmPendingSave}>
                그래도 저장
              </button>
            </div>
          </section>
        </div>
      )}
      {backupDialog && (
        <div className="modal-backdrop">
          <section
            className="confirm-dialog backup-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="backup-dialog-title"
          >
            <h2 id="backup-dialog-title">{backupDialog.title}</h2>
            <p>{backupDialog.targetPath}</p>
            {backupDialog.backups.length === 0 ? (
              <p>복원할 백업이 없습니다.</p>
            ) : (
              <ul className="backup-list">
                {backupDialog.backups.map((backup) => (
                  <li key={backup.path}>
                    <div>
                      <strong>{backup.name}</strong>
                      <span>
                        {formatBytes(backup.size)} · {formatBackupTime(backup.modifiedMs)}
                      </span>
                    </div>
                    <button type="button" onClick={() => restoreBackup(backup)}>
                      복원
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="dialog-actions">
              <button type="button" onClick={() => setBackupDialog(null)}>닫기</button>
            </div>
          </section>
        </div>
      )}

      <Suspense
        fallback={
          <div
            className="busy-bar"
            role="status"
            aria-live="polite"
            aria-label="편집기 로딩 중"
          />
        }
      >
        {mode === "home" && (
          <StartPage
            busy={busy}
            themeMode={themeMode}
            recentSessions={recentSessions}
            recentSessionFailure={recentSessionFailure}
            onThemeModeChange={setThemeMode}
            onOpenCompare={openCompare}
            onOpenFolders={openFolders}
            onOpenMerge={openMerge}
            onDropCompareFiles={openDroppedCompareFiles}
            onDropRejected={rejectDroppedFiles}
            onOpenRecentSession={openRecentSession}
            onClearRecentSessions={clearRecentSessions}
            onRemoveRecentSession={removeRecentSessionById}
            onDemoCompare={() => {
              requestLeaveActiveSession(() => {
                setCleanCompareSession(demoCompareSession());
                setMode("compare");
              });
            }}
            onDemoFolders={() => {
              requestLeaveActiveSession(() => {
                setFolderResult(demoFolderScanResult());
                setMode("folders");
              });
            }}
            onDemoMerge={() => {
              requestLeaveActiveSession(() => {
                const demo = demoMergeSession();
                setCleanMergeSession(demo);
                setMode("merge");
              });
            }}
          />
        )}

        {mode === "compare" && compareSession && (
          <FileCompareView
            session={compareSession}
            busy={busy}
            editorTheme={editorTheme}
            fileChangeNotice={compareFileChangeNotice}
            modelRevision={compareModelRevision}
            dirtySides={compareDirtySides}
            onBack={backHome}
            onCheckFileVersions={() => {
              void checkCompareFileVersions();
            }}
            onKeepCurrentFiles={keepCurrentCompareFiles}
            onReloadChangedFiles={() => {
              void reloadChangedCompareFiles();
            }}
            onTextChange={updateCompareSideText}
            onDropFileOnSide={replaceDroppedCompareSide}
            onDropRejected={rejectDroppedFiles}
            onSaveSide={(side, lineEndingMode) =>
              saveCompareNow(side, false, false, lineEndingMode)
            }
            onSaveSideAs={(side, lineEndingMode) =>
              saveCompareNow(side, true, false, lineEndingMode)
            }
            onOverwriteChangedFile={(side, lineEndingMode) =>
              saveCompareNow(side, false, true, lineEndingMode)
            }
            onExportReport={exportCompareReport}
            onShowBackups={showCompareBackups}
            onSwap={() =>
              setCleanCompareSession({ left: compareSession.right, right: compareSession.left })
            }
          />
        )}

        {mode === "folders" && folderResult && (
          <FolderCompareView
            result={folderResult}
            options={folderOptions}
            busy={busy}
            scanProgress={folderScanProgress}
            onBack={backHome}
            onNewScan={openFolders}
            onRescan={rescanFolders}
            onCancelScan={cancelFolderScan}
            onOpenEntry={openFolderEntry}
            onRevealPath={revealFolderPath}
          />
        )}

        {mode === "merge" && mergeSession && (
          <MergeView
            session={mergeSession}
            busy={busy}
            dirty={mergeHasUnsavedChanges}
            editorTheme={editorTheme}
            recoveryDraft={mergeRecoveryDraft}
            onBack={backHome}
            onResultChange={updateMergeResult}
            onRecoveryDraftsEnabledChange={setMergeRecoveryEnabled}
            onRestoreRecoveryDraft={() => {
              if (!mergeRecoveryDraft) return;
              updateMergeResult(mergeRecoveryDraft.result);
              setMessage("병합 결과 draft를 복구했습니다.");
            }}
            onDiscardRecoveryDraft={() => {
              clearMergeRecoveryDraft(mergeSession);
              setMergeRecoveryDraft(null);
              setMessage("병합 결과 draft를 삭제했습니다.");
            }}
            onSave={(lineEndingMode) => saveMerge(false, lineEndingMode)}
            onSaveAs={(lineEndingMode) => saveMerge(true, lineEndingMode)}
            onShowBackups={showMergeBackups}
          />
        )}
      </Suspense>
    </div>
  );
}

function preferredSystemTheme(): "dark" | "light" {
  if (typeof window === "undefined" || !window.matchMedia) return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function formatBackupTime(modifiedMs: number | null): string {
  if (modifiedMs == null) return "수정 시간 알 수 없음";
  return new Date(modifiedMs).toLocaleString();
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
