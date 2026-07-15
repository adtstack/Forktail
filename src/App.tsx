import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { FolderCompareView } from "./components/FolderCompareView";
import {
  GitCompareView,
  isCurrentGitRepositoryRequest,
  planGitRepositoryExit,
  type GitRepositoryScreenState,
} from "./components/GitCompareView";
import { StartPage } from "./components/StartPage";
import {
  cancelFolderScan as cancelFolderScanJob,
  cancelGitJob,
  chooseDirectory,
  chooseSavePath,
  chooseTextFile,
  closeGitRepository,
  detectGitRepository,
  exitExternalGitTool,
  isTauriRuntime,
  listFileBackups,
  listGitChangedFiles,
  listGitConflicts,
  listGitRefs,
  mergeTexts,
  openGitConflict,
  openGitRevisionCompare,
  openGitIndexCompare,
  readTextFile,
  readGitStatus,
  revealPath,
  restoreTextFileBackup,
  resolveGitRevision,
  saveGitConflictResult,
  scanDirectories,
  statTextFileVersion,
  startupArgs,
  writeTextFileAtomic,
} from "./core/bridge";
import {
  adaptGitCompareSession,
  adaptGitConflictSession,
  applyGitRevisionValidationResult,
  beginGitRevisionValidation,
  emptyGitRevisionField,
  gitRevisionFieldWithInput,
  gitRevisionFromRepositoryHead,
  gitChangedFileKey,
  gitConflictEntryKey,
  gitWorkingTreeRowKey,
  gitWorkingTreeRows,
  isCurrentGitRequest,
  keepsGitRepositorySession,
  sameResolvedGitRevisions,
  selectedGitChangedFileKeyAfterRefresh,
  selectedGitConflictEntryKeyAfterRefresh,
  selectedGitWorkingTreeRowKeyAfterRefresh,
  type GitChangedFileFilter,
  type GitChangedFileLoadState,
  type GitChangedFileStatusFilter,
  type GitConflictLoadState,
  type GitConflictOpenState,
  type GitRefLoadState,
  type GitRevisionFieldState,
  type GitRevisionSide,
  type GitSnapshotSelectionState,
  type GitWorkingTreeFilter,
  type GitWorkingTreeLoadState,
  type GitWorkingTreeRow,
  type GitWorkingTreeSection,
} from "./core/gitSession";
import type {
  GitChangedFile,
  GitConflictEntry,
  GitIndexComparison,
  GitRepositorySummary,
} from "./core/gitModels";
import { buildDiffReport, compareReportDefaultPath } from "./core/diffReport";
import type { CompareDropSide } from "./core/dropPaths";
import {
  APP_COMMAND_EVENT,
  commandIdFromEvent,
  isShellOpenCommandAllowed,
  matchesCommandShortcut,
  type AppCommandId,
} from "./core/commands";
import { listenForNativeMenuCommands } from "./core/nativeMenu";
import { modeAfterCompareBack, type CompareBackTarget } from "./core/navigation";
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
  gitConflictSaveRequest,
  mergeSavePreconditionForPath,
  mergeResultOriginalLineEnding,
  mergeSaveStateAfterWrite,
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
  compareSessionHasVirtualDocument,
  folderExpectedPath,
  isVirtualFileDocument,
  virtualMissingFileDocument,
} from "./core/virtualDocument";
import {
  loadAppearanceSettings,
  loadActiveSession,
  loadFolderScanOptions,
  loadMergeSettings,
  loadRecentSessions,
  removeRecentSession,
  removeLegacyMergetoolRecentSession,
  saveAppearanceSettings,
  saveActiveSession,
  saveFolderScanOptions,
  saveRecentSessions,
  upsertRecentSession,
  persistentCompareSessionInput,
  persistentMergeSessionInput,
  type ActiveSession,
  type AppLanguage,
  type ThemeMode,
  type RecentSession,
  type RecentSessionInput,
} from "./core/settings";
import {
  hasUnsavedCompareChanges,
  hasUnsavedMergeChanges,
  markBeforeUnloadIfUnsaved,
} from "./core/unsaved";
import { APP_TEXT, CORE_TEXT, MERGE_VIEW_TEXT, localeForLanguage } from "./core/i18n";
import {
  parseStartupSessionArgs,
  type DifftoolStartupSession,
  type MergetoolStartupSession,
} from "./core/startupSession";
import {
  buildDifftoolSession,
  compareSessionCapabilities,
} from "./core/difftoolSession";
import {
  buildMergetoolSession,
  isMissingMergetoolBaseError,
  mergetoolSessionCapabilities,
} from "./core/mergetoolSession";
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
  const [compareBackTarget, setCompareBackTarget] = useState<CompareBackTarget>("home");
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
  const [gitRepositoryState, setGitRepositoryState] =
    useState<GitRepositoryScreenState | null>(null);
  const [gitRevisionFields, setGitRevisionFields] =
    useState<Record<GitRevisionSide, GitRevisionFieldState>>(() => ({
      left: emptyGitRevisionField(),
      right: emptyGitRevisionField(),
    }));
  const [gitRefState, setGitRefState] = useState<GitRefLoadState>({ kind: "idle" });
  const [gitChangedFileState, setGitChangedFileState] =
    useState<GitChangedFileLoadState>({ kind: "idle" });
  const [gitChangedFileFilter, setGitChangedFileFilter] = useState<GitChangedFileFilter>({
    query: "",
    status: "all",
  });
  const [selectedGitChangedFileKey, setSelectedGitChangedFileKey] = useState<string | null>(null);
  const [viewedGitChangedFileKeys, setViewedGitChangedFileKeys] =
    useState<Set<string>>(() => new Set());
  const [gitSnapshotSelectionState, setGitSnapshotSelectionState] =
    useState<GitSnapshotSelectionState>({ kind: "idle" });
  const [gitWorkingTreeState, setGitWorkingTreeState] =
    useState<GitWorkingTreeLoadState>({ kind: "idle" });
  const [gitWorkingTreeFilter, setGitWorkingTreeFilter] = useState<GitWorkingTreeFilter>({
    query: "",
    section: "all",
  });
  const [gitWorkingTreeComparison, setGitWorkingTreeComparison] =
    useState<GitIndexComparison>("headToWorkingTree");
  const [selectedGitWorkingTreeKey, setSelectedGitWorkingTreeKey] =
    useState<string | null>(null);
  const [gitWorkingTreeSnapshotState, setGitWorkingTreeSnapshotState] =
    useState<GitSnapshotSelectionState>({ kind: "idle" });
  const [gitConflictState, setGitConflictState] =
    useState<GitConflictLoadState>({ kind: "idle" });
  const [selectedGitConflictKey, setSelectedGitConflictKey] = useState<string | null>(null);
  const [gitConflictOpenState, setGitConflictOpenState] =
    useState<GitConflictOpenState>({ kind: "idle" });
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
  const [languageMode, setLanguageMode] = useState<AppLanguage>(
    () => loadAppearanceSettings().language,
  );
  const [systemTheme, setSystemTheme] = useState<"dark" | "light">(() => preferredSystemTheme());
  const pendingLeaveAction = useRef<(() => void) | null>(null);
  const pendingSaveAction = useRef<(() => void) | null>(null);
  const allowWindowClose = useRef(false);
  const activeFolderScanId = useRef(0);
  const releasedFolderScanIds = useRef(new Set<number>());
  const activeGitRepositoryRequestId = useRef(0);
  const releasedGitRepositoryRequestIds = useRef(new Set<number>());
  const gitRepositoryPickerActive = useRef(false);
  const gitRepositoryProbeTail = useRef<Promise<void>>(Promise.resolve());
  const gitRepositoryStateRef = useRef<GitRepositoryScreenState | null>(null);
  const activeGitRefRequestId = useRef(0);
  const nextGitJobId = useRef(0);
  const nextGitRevisionValidationId = useRef(0);
  const activeGitChangedFilesRequestId = useRef(0);
  const activeGitWorkingTreeRequestId = useRef(0);
  const activeGitWorkingTreeJob = useRef<{ repositorySessionId: string; jobId: number } | null>(null);
  const activeGitConflictListRequestId = useRef(0);
  const activeGitConflictListJob =
    useRef<{ repositorySessionId: string; jobId: number } | null>(null);
  const activeGitConflictOpenRequestId = useRef(0);
  const activeGitConflictOpenJob =
    useRef<{ repositorySessionId: string; jobId: number } | null>(null);
  const activeGitConflictSaveRequestId = useRef(0);
  const activeGitConflictSaveJob =
    useRef<{ repositorySessionId: string; jobId: number } | null>(null);
  const activeGitSnapshotRequestId = useRef(0);
  const activeGitSnapshotJob = useRef<{ repositorySessionId: string; jobId: number } | null>(null);
  const attemptedActiveSessionRestore = useRef(false);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const [showUnresolvedSaveDialog, setShowUnresolvedSaveDialog] = useState(false);
  const [activeSessionStorageReady, setActiveSessionStorageReady] = useState(false);

  const busy = busyCount > 0;
  const appText = APP_TEXT[languageMode];
  gitRepositoryStateRef.current = gitRepositoryState;

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
      const message = errorMessage(caught, languageMode);
      setError(message);
      onError?.(message);
    } finally {
      endBusy();
    }
  }, [beginBusy, endBusy, languageMode]);

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
      left: isVirtualFileDocument(session.left) ? null : writePreconditionFromDocument(session.left),
      right: isVirtualFileDocument(session.right) ? null : writePreconditionFromDocument(session.right),
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
    setMergeRecoveryDraft(
      session.origin === "files" && mergeRecoveryEnabled
        ? loadMergeRecoveryDraft(session)
        : null,
    );
  }, [mergeRecoveryEnabled]);

  const updateCompareSideText = useCallback((side: CompareSide, text: string) => {
    setCompareSession((current) => {
      if (!current || current[side].text === text) return current;
      if (!compareSessionCapabilities(current).edit) return current;
      if (isVirtualFileDocument(current[side])) return current;
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
    setMessage(appText.recentSessionRemoved);
  }, [appText]);

  const compareHasUnsavedChanges =
    mode === "compare" &&
    compareSession != null &&
    (hasUnsavedCompareChanges(compareSession.left.text, savedCompareText.left) ||
      hasUnsavedCompareChanges(compareSession.right.text, savedCompareText.right));
  const compareDirtySides = {
    left: mode === "compare" && compareSession != null
      ? !isVirtualFileDocument(compareSession.left) &&
        hasUnsavedCompareChanges(compareSession.left.text, savedCompareText.left)
      : false,
    right: mode === "compare" && compareSession != null
      ? !isVirtualFileDocument(compareSession.right) &&
        hasUnsavedCompareChanges(compareSession.right.text, savedCompareText.right)
      : false,
  };
  const mergeHasUnsavedChanges =
    mode === "merge" &&
    mergeSession != null &&
    hasUnsavedMergeChanges(mergeSession.result, savedMergeResult);
  const activeUnsavedMessage = compareHasUnsavedChanges
    ? appText.unsavedCompareMessage
    : mergeHasUnsavedChanges
      ? appText.unsavedMergeMessage
      : null;
  const activeUnsavedTitle = compareHasUnsavedChanges
    ? appText.unsavedCompareTitle
    : appText.unsavedMergeTitle;
  const resolvedTheme = themeMode === "system" ? systemTheme : themeMode;
  const editorTheme = resolvedTheme === "dark" ? "vs-dark" : "vs";

  const checkCompareFileVersions = useCallback(async (session = compareSession) => {
    if (!session || !isTauriRuntime()) return;
    const [leftResult, rightResult] = await Promise.allSettled([
      isVirtualFileDocument(session.left)
        ? Promise.resolve(null)
        : statTextFileVersion(session.left.path),
      isVirtualFileDocument(session.right)
        ? Promise.resolve(null)
        : statTextFileVersion(session.right.path),
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
    const localizedNotice = {
      ...notice,
      message: appText.fileChangeNotice(notice.leftChanged, notice.rightChanged),
    };
    if (notice.versionKey === suppressedCompareFileChangeKey) return;
    setCompareFileChangeNotice((current) =>
      current?.versionKey === notice.versionKey ? current : localizedNotice,
    );
  }, [appText, compareOutputVersion, compareSession, suppressedCompareFileChangeKey]);

  const reloadChangedCompareFiles = useCallback(() => run(async () => {
    if (!compareSession || !compareFileChangeNotice) return;
    const [left, right] = await Promise.all([
      compareFileChangeNotice.leftChanged && !isVirtualFileDocument(compareSession.left)
        ? readTextFile(compareSession.left.path)
        : Promise.resolve(compareSession.left),
      compareFileChangeNotice.rightChanged && !isVirtualFileDocument(compareSession.right)
        ? readTextFile(compareSession.right.path)
        : Promise.resolve(compareSession.right),
    ]);
    setCleanCompareSession({ ...compareSession, left, right });
    setCompareFileChangeNotice(null);
    setSuppressedCompareFileChangeKey(null);
    setMessage(appText.changedFilesReloaded);
  }), [appText, compareFileChangeNotice, compareSession, run, setCleanCompareSession]);

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
      message: appText.folderScanActive,
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
        const message = errorMessage(caught, languageMode);
        setError(message);
        onError?.(message);
        setFolderScanProgress(null);
      } finally {
        if (releasedFolderScanIds.current.delete(scanId)) return;
        endBusy();
      }
    })();
  }, [appText, beginBusy, endBusy, languageMode, rememberRecentSession]);

  const cancelFolderScan = useCallback(() => {
    if (!folderScanProgress?.active) return;
    const scanId = activeFolderScanId.current;
    activeFolderScanId.current = scanId + 1;
    releasedFolderScanIds.current.add(scanId);
    void cancelFolderScanJob(scanId).catch(() => {});
    endBusy();
    setError(null);
    setMessage(appText.folderScanCancelled);
    setFolderScanProgress({
      ...folderScanProgress,
      active: false,
      message: appText.folderScanCancelledLate,
    });
  }, [appText, endBusy, folderScanProgress]);

  const restoreStoredSession = useCallback((
    session: ActiveSession,
    options: { remember: boolean } = { remember: true },
  ) => run(async () => {
    if (session.kind === "compare") {
      if (isDemoComparePaths(session.leftPath, session.rightPath)) {
        setCleanCompareSession(demoCompareSession());
      } else {
        if (!isTauriRuntime()) {
          throw new Error(appText.demoRestoreOnly);
        }
        const [left, right] = await Promise.all([
          readTextFile(session.leftPath),
          readTextFile(session.rightPath),
        ]);
        setCleanCompareSession({ origin: "files", left, right });
      }
      setCompareBackTarget("home");
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
        throw new Error(appText.demoRestoreOnly);
      }
      startFolderScan(session.leftRoot, session.rightRoot, session.options);
      return;
    }

    if (isDemoMergePaths(session.basePath, session.oursPath, session.theirsPath)) {
      setCleanMergeSession({ ...demoMergeSession(), outputPath: session.outputPath });
    } else {
      if (!isTauriRuntime()) {
        throw new Error(appText.demoRestoreOnly);
      }
      const [base, ours, theirs] = await Promise.all([
        readTextFile(session.basePath),
        readTextFile(session.oursPath),
        readTextFile(session.theirsPath),
      ]);
      if (base.isBinary || ours.isBinary || theirs.isBinary) {
        throw new Error(appText.mergeTextOnly);
      }
      const merged = await mergeTexts(base.text, ours.text, theirs.text);
      setCleanMergeSession({
        origin: "files",
        base,
        ours,
        theirs,
        output: null,
        result: merged.output,
        outputPath: session.outputPath,
      });
    }
    if (options.remember) rememberRecentSession(session);
    setMode("merge");
  }), [
    rememberRecentSession,
    run,
    appText,
    setCleanCompareSession,
    setCleanMergeSession,
    startFolderScan,
  ]);

  const restoreMergetoolSession = useCallback((
    startup: MergetoolStartupSession,
  ) => run(async () => {
    if (!isTauriRuntime()) {
      throw new Error(appText.demoRestoreOnly);
    }

    const readBase = async () => {
      if (startup.basePath == null) return null;
      try {
        return await readTextFile(startup.basePath);
      } catch (caught) {
        if (isMissingMergetoolBaseError(caught)) return null;
        throw caught;
      }
    };
    const [base, ours, theirs, merged] = await Promise.all([
      readBase(),
      readTextFile(startup.oursPath),
      readTextFile(startup.theirsPath),
      readTextFile(startup.outputPath),
    ]);
    if (base?.isBinary || ours.isBinary || theirs.isBinary || merged.isBinary) {
      throw new Error(appText.mergeTextOnly);
    }

    const prepared = buildMergetoolSession(startup, { base, ours, theirs, merged });
    saveActiveSession(null);
    clearMergeRecoveryDraft(prepared.session);
    setRecentSessions((current) => {
      const next = removeLegacyMergetoolRecentSession(current, startup);
      saveRecentSessions(next);
      return next;
    });
    setCleanMergeSession(prepared.session, prepared.outputVersion);
    setMode("merge");
  }), [appText, run, setCleanMergeSession]);

  const restoreDifftoolSession = useCallback((
    startup: DifftoolStartupSession,
  ) => run(async () => {
    if (!isTauriRuntime()) {
      throw new Error(appText.demoRestoreOnly);
    }

    const [local, remote] = await Promise.all([
      startup.localPath == null
        ? Promise.resolve(null)
        : readTextFile(startup.localPath),
      startup.remotePath == null
        ? Promise.resolve(null)
        : readTextFile(startup.remotePath),
    ]);
    const session = buildDifftoolSession(startup, { local, remote });
    saveActiveSession(null);
    setCleanCompareSession(session);
    setCompareBackTarget("home");
    setMode("compare");
  }), [appText, run, setCleanCompareSession]);

  useEffect(() => {
    saveAppearanceSettings({ language: languageMode, theme: themeMode });
  }, [languageMode, themeMode]);

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
      if (allowWindowClose.current) return;
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
          const startupSession = parseStartupSessionArgs(await startupArgs(), languageMode);
          if (startupSession.status === "valid") {
            if (startupSession.source === "difftool") {
              saveActiveSession(null);
              await restoreDifftoolSession(startupSession.session);
            } else if (startupSession.source === "mergetool") {
              saveActiveSession(null);
              await restoreMergetoolSession(startupSession.session);
            } else {
              await restoreStoredSession(startupSession.session, { remember: true });
            }
            return;
          }
          if (startupSession.status === "invalid") {
            saveActiveSession(null);
            setError(startupSession.message);
            return;
          }
        } catch (caught) {
          setError(errorMessage(caught, languageMode));
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
  }, [languageMode, restoreDifftoolSession, restoreMergetoolSession, restoreStoredSession]);

  useEffect(() => {
    if (!activeSessionStorageReady) return;

    if (mode === "compare" && compareSession) {
      if (compareSessionHasVirtualDocument(compareSession)) {
        saveActiveSession(null);
        return;
      }

      saveActiveSession(persistentCompareSessionInput(compareSession));
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
      saveActiveSession(persistentMergeSessionInput(mergeSession));
      return;
    }

    if (mode === "home") {
      saveActiveSession(null);
      return;
    }

    if (mode === "git") {
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
    if (mergeSession.origin !== "files") {
      setMergeRecoveryDraft(null);
      return;
    }
    if (!mergeRecoveryEnabled) {
      clearMergeRecoveryDraft(mergeSession);
      setMergeRecoveryDraft(null);
      return;
    }
    if (!hasUnsavedMergeChanges(mergeSession.result, savedMergeResult)) return;
    saveMergeRecoveryDraft(mergeSession);
  }, [mergeRecoveryEnabled, mergeSession, mode, savedMergeResult]);

  const cancelActiveGitSnapshot = useCallback(() => {
    activeGitSnapshotRequestId.current += 1;
    const activeJob = activeGitSnapshotJob.current;
    activeGitSnapshotJob.current = null;
    if (activeJob) {
      void cancelGitJob(activeJob.repositorySessionId, activeJob.jobId).catch(() => {});
    }
  }, []);

  const cancelActiveGitWorkingTreeStatus = useCallback(() => {
    activeGitWorkingTreeRequestId.current += 1;
    const activeJob = activeGitWorkingTreeJob.current;
    activeGitWorkingTreeJob.current = null;
    if (activeJob) {
      void cancelGitJob(activeJob.repositorySessionId, activeJob.jobId).catch(() => {});
    }
  }, []);

  const cancelActiveGitConflictList = useCallback(() => {
    activeGitConflictListRequestId.current += 1;
    const activeJob = activeGitConflictListJob.current;
    activeGitConflictListJob.current = null;
    if (activeJob) {
      void cancelGitJob(activeJob.repositorySessionId, activeJob.jobId).catch(() => {});
    }
  }, []);

  const cancelActiveGitConflictOpen = useCallback(() => {
    activeGitConflictOpenRequestId.current += 1;
    const activeJob = activeGitConflictOpenJob.current;
    activeGitConflictOpenJob.current = null;
    if (activeJob) {
      void cancelGitJob(activeJob.repositorySessionId, activeJob.jobId).catch(() => {});
    }
  }, []);

  const cancelActiveGitConflictSave = useCallback(() => {
    activeGitConflictSaveRequestId.current += 1;
    const activeJob = activeGitConflictSaveJob.current;
    activeGitConflictSaveJob.current = null;
    if (activeJob) {
      void cancelGitJob(activeJob.repositorySessionId, activeJob.jobId).catch(() => {});
    }
  }, []);

  const resetGitRevisionReview = useCallback((
    repository: GitRepositorySummary | null,
  ) => {
    cancelActiveGitSnapshot();
    cancelActiveGitWorkingTreeStatus();
    cancelActiveGitConflictList();
    cancelActiveGitConflictOpen();
    cancelActiveGitConflictSave();
    activeGitRefRequestId.current += 1;
    activeGitChangedFilesRequestId.current += 1;
    const requestGeneration = nextGitRevisionValidationId.current + 1;
    nextGitRevisionValidationId.current = requestGeneration;
    setGitRefState({ kind: "idle" });
    setGitChangedFileState({ kind: "idle" });
    setGitChangedFileFilter({ query: "", status: "all" });
    setSelectedGitChangedFileKey(null);
    setViewedGitChangedFileKeys(new Set());
    setGitSnapshotSelectionState({ kind: "idle" });
    setGitWorkingTreeState({ kind: "idle" });
    setGitWorkingTreeFilter({ query: "", section: "all" });
    setGitWorkingTreeComparison("headToWorkingTree");
    setSelectedGitWorkingTreeKey(null);
    setGitWorkingTreeSnapshotState({ kind: "idle" });
    setGitConflictState({ kind: "idle" });
    setSelectedGitConflictKey(null);
    setGitConflictOpenState({ kind: "idle" });
    setGitRevisionFields({
      left: emptyGitRevisionField(requestGeneration),
      right: repository
        ? gitRevisionFromRepositoryHead(repository, requestGeneration)
        : emptyGitRevisionField(requestGeneration),
    });
  }, [
    cancelActiveGitConflictList,
    cancelActiveGitConflictOpen,
    cancelActiveGitConflictSave,
    cancelActiveGitSnapshot,
    cancelActiveGitWorkingTreeStatus,
  ]);

  useEffect(() => {
    if (keepsGitRepositorySession(
      mode,
      compareSession?.origin ?? null,
      mergeSession?.origin ?? null,
    )) return;
    const state = gitRepositoryStateRef.current;
    if (!state) return;

    activeGitRepositoryRequestId.current += 1;
    const exitPlan = planGitRepositoryExit(state);
    if (exitPlan.releaseRequestId != null) {
      if (!releasedGitRepositoryRequestIds.current.has(exitPlan.releaseRequestId)) {
        releasedGitRepositoryRequestIds.current.add(exitPlan.releaseRequestId);
        endBusy();
      }
    } else if (exitPlan.closeSessionId != null) {
      void closeGitRepository(exitPlan.closeSessionId).catch(() => {});
    }
    resetGitRevisionReview(null);
    setGitRepositoryState(null);
  }, [compareSession?.origin, endBusy, mergeSession?.origin, mode, resetGitRevisionReview]);

  useEffect(() => {
    if (mode !== "git" || gitRepositoryState?.kind !== "ready") return;
    const repository = gitRepositoryState.repository;
    if (repository.head.kind === "unborn") {
      setGitRefState({ kind: "ready", list: { refs: [], truncated: false } });
      return;
    }

    const requestId = activeGitRefRequestId.current + 1;
    activeGitRefRequestId.current = requestId;
    const jobId = nextGitJobId.current + 1;
    nextGitJobId.current = jobId;
    setGitRefState({ kind: "loading" });

    void listGitRefs(
      repository.sessionId,
      ["localBranch", "remoteTrackingBranch", "tag"],
      10_000,
      jobId,
    ).then((list) => {
      const currentRepository = gitRepositoryStateRef.current;
      if (
        activeGitRefRequestId.current === requestId
        && currentRepository?.kind === "ready"
        && currentRepository.repository.sessionId === repository.sessionId
      ) {
        setGitRefState({ kind: "ready", list });
      }
    }).catch((caught) => {
      const currentRepository = gitRepositoryStateRef.current;
      if (
        activeGitRefRequestId.current === requestId
        && currentRepository?.kind === "ready"
        && currentRepository.repository.sessionId === repository.sessionId
      ) {
        setGitRefState({ kind: "error", message: errorMessage(caught, languageMode) });
      }
    });

    return () => {
      if (activeGitRefRequestId.current === requestId) {
        activeGitRefRequestId.current += 1;
      }
      void cancelGitJob(repository.sessionId, jobId).catch(() => {});
    };
  }, [gitRepositoryState, languageMode, mode]);

  const refreshGitConflicts = useCallback(() => {
    const currentRepository = gitRepositoryStateRef.current;
    if (
      currentRepository?.kind !== "ready"
      || currentRepository.repository.head.kind === "unborn"
    ) return;
    const repositorySessionId = currentRepository.repository.sessionId;
    cancelActiveGitConflictList();
    cancelActiveGitConflictOpen();
    const requestGeneration = activeGitConflictListRequestId.current + 1;
    activeGitConflictListRequestId.current = requestGeneration;
    const jobId = nextGitJobId.current + 1;
    nextGitJobId.current = jobId;
    activeGitConflictListJob.current = { repositorySessionId, jobId };
    setGitConflictState({ kind: "loading", requestGeneration });
    setGitConflictOpenState({ kind: "idle" });

    void listGitConflicts(repositorySessionId, {
      hardLimit: 10_000,
      requestGeneration,
    }, jobId).then((list) => {
      const repository = gitRepositoryStateRef.current;
      if (
        !isCurrentGitRequest(activeGitConflictListRequestId.current, requestGeneration)
        || repository?.kind !== "ready"
        || repository.repository.sessionId !== repositorySessionId
      ) return;
      setGitConflictState({ kind: "ready", requestGeneration, list });
      setSelectedGitConflictKey((current) =>
        selectedGitConflictEntryKeyAfterRefresh(current, list));
    }).catch((caught) => {
      const repository = gitRepositoryStateRef.current;
      if (
        !isCurrentGitRequest(activeGitConflictListRequestId.current, requestGeneration)
        || repository?.kind !== "ready"
        || repository.repository.sessionId !== repositorySessionId
      ) return;
      setGitConflictState({
        kind: "error",
        requestGeneration,
        message: errorMessage(caught, languageMode),
      });
    }).finally(() => {
      if (
        activeGitConflictListJob.current?.repositorySessionId === repositorySessionId
        && activeGitConflictListJob.current.jobId === jobId
      ) {
        activeGitConflictListJob.current = null;
      }
    });
  }, [cancelActiveGitConflictList, cancelActiveGitConflictOpen, languageMode]);

  const refreshGitWorkingTree = useCallback(() => {
    const currentRepository = gitRepositoryStateRef.current;
    if (
      currentRepository?.kind !== "ready"
      || currentRepository.repository.head.kind === "unborn"
    ) return;
    const repositorySessionId = currentRepository.repository.sessionId;
    cancelActiveGitWorkingTreeStatus();
    cancelActiveGitSnapshot();
    activeGitChangedFilesRequestId.current += 1;
    const requestGeneration = activeGitWorkingTreeRequestId.current + 1;
    activeGitWorkingTreeRequestId.current = requestGeneration;
    const jobId = nextGitJobId.current + 1;
    nextGitJobId.current = jobId;
    activeGitWorkingTreeJob.current = { repositorySessionId, jobId };
    setGitWorkingTreeState({ kind: "loading", requestGeneration });
    setGitWorkingTreeSnapshotState({ kind: "idle" });
    setGitChangedFileState({ kind: "idle" });
    setSelectedGitChangedFileKey(null);
    setGitSnapshotSelectionState({ kind: "idle" });

    void readGitStatus(repositorySessionId, {
      hardLimit: 10_000,
      requestGeneration,
    }, jobId).then((snapshot) => {
      const repository = gitRepositoryStateRef.current;
      if (
        !isCurrentGitRequest(activeGitWorkingTreeRequestId.current, requestGeneration)
        || repository?.kind !== "ready"
        || repository.repository.sessionId !== repositorySessionId
      ) return;
      const rows = gitWorkingTreeRows(snapshot);
      setGitWorkingTreeState({ kind: "ready", requestGeneration, snapshot });
      setSelectedGitWorkingTreeKey((current) =>
        selectedGitWorkingTreeRowKeyAfterRefresh(current, rows));
    }).catch((caught) => {
      const repository = gitRepositoryStateRef.current;
      if (
        !isCurrentGitRequest(activeGitWorkingTreeRequestId.current, requestGeneration)
        || repository?.kind !== "ready"
        || repository.repository.sessionId !== repositorySessionId
      ) return;
      setGitWorkingTreeState({
        kind: "error",
        requestGeneration,
        message: errorMessage(caught, languageMode),
      });
    }).finally(() => {
      if (
        activeGitWorkingTreeJob.current?.repositorySessionId === repositorySessionId
        && activeGitWorkingTreeJob.current.jobId === jobId
      ) {
        activeGitWorkingTreeJob.current = null;
      }
    });
  }, [
    cancelActiveGitSnapshot,
    cancelActiveGitWorkingTreeStatus,
    languageMode,
  ]);

  const refreshGitRepositoryStatus = useCallback(() => {
    refreshGitWorkingTree();
    refreshGitConflicts();
  }, [refreshGitConflicts, refreshGitWorkingTree]);

  useEffect(() => {
    if (
      mode !== "git"
      || gitRepositoryState?.kind !== "ready"
      || gitRepositoryState.repository.head.kind === "unborn"
    ) return;
    refreshGitRepositoryStatus();
    return () => {
      cancelActiveGitWorkingTreeStatus();
      cancelActiveGitConflictList();
      cancelActiveGitConflictOpen();
    };
  }, [
    cancelActiveGitConflictList,
    cancelActiveGitConflictOpen,
    cancelActiveGitWorkingTreeStatus,
    gitRepositoryState,
    mode,
    refreshGitRepositoryStatus,
  ]);

  useEffect(() => {
    const repository = gitRepositoryState?.kind === "ready"
      ? gitRepositoryState.repository
      : null;
    const leftRevision = gitRevisionFields.left.revision;
    const rightRevision = gitRevisionFields.right.revision;
    const workingTreeStatusSettled =
      gitWorkingTreeState.kind === "ready" || gitWorkingTreeState.kind === "error";
    if (
      !repository
      || !leftRevision
      || !rightRevision
      || sameResolvedGitRevisions(leftRevision, rightRevision)
      || !workingTreeStatusSettled
    ) {
      activeGitChangedFilesRequestId.current += 1;
      cancelActiveGitSnapshot();
      setGitChangedFileState({ kind: "idle" });
      setSelectedGitChangedFileKey(null);
      setViewedGitChangedFileKeys(new Set());
      setGitSnapshotSelectionState({ kind: "idle" });
      return;
    }

    const requestGeneration = activeGitChangedFilesRequestId.current + 1;
    activeGitChangedFilesRequestId.current = requestGeneration;
    const jobId = nextGitJobId.current + 1;
    nextGitJobId.current = jobId;
    cancelActiveGitSnapshot();
    setGitChangedFileState({ kind: "loading", requestGeneration });
    setGitChangedFileFilter({ query: "", status: "all" });
    setSelectedGitChangedFileKey(null);
    setViewedGitChangedFileKeys(new Set());
    setGitSnapshotSelectionState({ kind: "idle" });

    void listGitChangedFiles(repository.sessionId, {
      leftCommit: leftRevision.resolved,
      rightCommit: rightRevision.resolved,
      hardLimit: 10_000,
      requestGeneration,
    }, jobId).then((list) => {
      const currentRepository = gitRepositoryStateRef.current;
      if (
        isCurrentGitRequest(activeGitChangedFilesRequestId.current, requestGeneration)
        && currentRepository?.kind === "ready"
        && currentRepository.repository.sessionId === repository.sessionId
      ) {
        setGitChangedFileState({ kind: "ready", requestGeneration, list });
        setSelectedGitChangedFileKey((current) =>
          selectedGitChangedFileKeyAfterRefresh(current, list));
      }
    }).catch((caught) => {
      const currentRepository = gitRepositoryStateRef.current;
      if (
        isCurrentGitRequest(activeGitChangedFilesRequestId.current, requestGeneration)
        && currentRepository?.kind === "ready"
        && currentRepository.repository.sessionId === repository.sessionId
      ) {
        setGitChangedFileState({
          kind: "error",
          requestGeneration,
          message: errorMessage(caught, languageMode),
        });
      }
    });

    return () => {
      if (isCurrentGitRequest(activeGitChangedFilesRequestId.current, requestGeneration)) {
        activeGitChangedFilesRequestId.current += 1;
      }
      void cancelGitJob(repository.sessionId, jobId).catch(() => {});
    };
  }, [
    cancelActiveGitSnapshot,
    gitRepositoryState,
    gitRevisionFields.left.revision,
    gitRevisionFields.right.revision,
    gitWorkingTreeState.kind,
    gitWorkingTreeState.kind === "ready" ? gitWorkingTreeState.snapshot.generation : null,
    gitWorkingTreeState.kind === "error" ? gitWorkingTreeState.requestGeneration : null,
    languageMode,
  ]);

  const updateGitRevisionInput = useCallback((side: GitRevisionSide, input: string) => {
    const requestGeneration = nextGitRevisionValidationId.current + 1;
    nextGitRevisionValidationId.current = requestGeneration;
    setGitRevisionFields((current) => ({
      ...current,
      [side]: gitRevisionFieldWithInput(current[side], input, requestGeneration),
    }));
  }, []);

  const validateGitRevision = useCallback((side: GitRevisionSide, rawInput: string) => {
    const currentRepository = gitRepositoryStateRef.current;
    if (currentRepository?.kind !== "ready") return;
    const repositorySessionId = currentRepository.repository.sessionId;
    const requestGeneration = nextGitRevisionValidationId.current + 1;
    nextGitRevisionValidationId.current = requestGeneration;
    const emptyInput = rawInput.trim().length === 0;

    setGitRevisionFields((current) => {
      const validating = beginGitRevisionValidation(
        current[side],
        rawInput,
        requestGeneration,
      );
      return {
        ...current,
        [side]: emptyInput
          ? applyGitRevisionValidationResult(validating, {
              kind: "error",
              requestGeneration,
              error: languageMode === "ko" ? "Revision을 입력하세요." : "Enter a revision.",
            })
          : validating,
      };
    });
    if (emptyInput) return;

    void resolveGitRevision(repositorySessionId, rawInput, requestGeneration).then((revision) => {
      const repository = gitRepositoryStateRef.current;
      if (
        repository?.kind !== "ready"
        || repository.repository.sessionId !== repositorySessionId
      ) return;
      setGitRevisionFields((current) => ({
        ...current,
        [side]: applyGitRevisionValidationResult(current[side], {
          kind: "resolved",
          requestGeneration,
          revision,
        }),
      }));
    }).catch((caught) => {
      const repository = gitRepositoryStateRef.current;
      if (
        repository?.kind !== "ready"
        || repository.repository.sessionId !== repositorySessionId
      ) return;
      setGitRevisionFields((current) => ({
        ...current,
        [side]: applyGitRevisionValidationResult(current[side], {
          kind: "error",
          requestGeneration,
          error: errorMessage(caught, languageMode),
        }),
      }));
    });
  }, [languageMode]);

  const selectGitChangedFile = useCallback((changedFile: GitChangedFile) => {
    const repository = gitRepositoryStateRef.current;
    const leftRevision = gitRevisionFields.left.revision;
    const rightRevision = gitRevisionFields.right.revision;
    if (
      repository?.kind !== "ready"
      || gitChangedFileState.kind !== "ready"
      || !leftRevision
      || !rightRevision
      || sameResolvedGitRevisions(leftRevision, rightRevision)
    ) return;

    cancelActiveGitSnapshot();
    const requestGeneration = activeGitSnapshotRequestId.current + 1;
    activeGitSnapshotRequestId.current = requestGeneration;
    const jobId = nextGitJobId.current + 1;
    nextGitJobId.current = jobId;
    const repositorySessionId = repository.repository.sessionId;
    const fileKey = gitChangedFileKey(changedFile);
    activeGitSnapshotJob.current = { repositorySessionId, jobId };
    setSelectedGitChangedFileKey(fileKey);
    setGitWorkingTreeSnapshotState({ kind: "idle" });
    setGitSnapshotSelectionState({ kind: "loading", fileKey, requestGeneration });

    void openGitRevisionCompare(repositorySessionId, {
      leftRevision,
      rightRevision,
      changedFile,
      generation: gitChangedFileState.list.generation,
    }, jobId).then((snapshotSession) => {
      const currentRepository = gitRepositoryStateRef.current;
      if (
        !isCurrentGitRequest(activeGitSnapshotRequestId.current, requestGeneration)
        || currentRepository?.kind !== "ready"
        || currentRepository.repository.sessionId !== repositorySessionId
      ) return;

      const view = adaptGitCompareSession(snapshotSession);
      setViewedGitChangedFileKeys((current) => {
        const next = new Set(current);
        next.add(fileKey);
        return next;
      });
      if (view.kind === "notice") {
        setGitSnapshotSelectionState({
          kind: "notice",
          fileKey,
          requestGeneration,
          contentStates: view.contentStates,
          unavailableReasons: view.unavailableReasons,
        });
        return;
      }

      setGitSnapshotSelectionState({ kind: "idle" });
      setCleanCompareSession(view.session);
      setCompareBackTarget("git");
      setMode("compare");
    }).catch((caught) => {
      const currentRepository = gitRepositoryStateRef.current;
      if (
        !isCurrentGitRequest(activeGitSnapshotRequestId.current, requestGeneration)
        || currentRepository?.kind !== "ready"
        || currentRepository.repository.sessionId !== repositorySessionId
      ) return;
      setGitSnapshotSelectionState({
        kind: "error",
        fileKey,
        requestGeneration,
        message: errorMessage(caught, languageMode),
      });
    }).finally(() => {
      if (
        activeGitSnapshotJob.current?.repositorySessionId === repositorySessionId
        && activeGitSnapshotJob.current.jobId === jobId
      ) {
        activeGitSnapshotJob.current = null;
      }
    });
  }, [
    cancelActiveGitSnapshot,
    gitChangedFileState,
    gitRevisionFields.left.revision,
    gitRevisionFields.right.revision,
    languageMode,
    setCleanCompareSession,
  ]);

  const selectGitWorkingTreeFile = useCallback((row: GitWorkingTreeRow) => {
    const repository = gitRepositoryStateRef.current;
    if (
      repository?.kind !== "ready"
      || gitWorkingTreeState.kind !== "ready"
      || row.section === "unmerged"
    ) return;

    cancelActiveGitSnapshot();
    const requestGeneration = activeGitSnapshotRequestId.current + 1;
    activeGitSnapshotRequestId.current = requestGeneration;
    const jobId = nextGitJobId.current + 1;
    nextGitJobId.current = jobId;
    const repositorySessionId = repository.repository.sessionId;
    const fileKey = gitWorkingTreeRowKey(row);
    activeGitSnapshotJob.current = { repositorySessionId, jobId };
    setSelectedGitWorkingTreeKey(fileKey);
    setGitSnapshotSelectionState({ kind: "idle" });
    setGitWorkingTreeSnapshotState({ kind: "loading", fileKey, requestGeneration });

    void openGitIndexCompare(repositorySessionId, {
      opaquePathId: row.path.opaqueId,
      comparison: gitWorkingTreeComparison,
      generation: gitWorkingTreeState.snapshot.generation,
    }, jobId).then((snapshotSession) => {
      const currentRepository = gitRepositoryStateRef.current;
      if (
        !isCurrentGitRequest(activeGitSnapshotRequestId.current, requestGeneration)
        || currentRepository?.kind !== "ready"
        || currentRepository.repository.sessionId !== repositorySessionId
      ) return;

      const view = adaptGitCompareSession(snapshotSession);
      if (view.kind === "notice") {
        setGitWorkingTreeSnapshotState({
          kind: "notice",
          fileKey,
          requestGeneration,
          contentStates: view.contentStates,
          unavailableReasons: view.unavailableReasons,
        });
        return;
      }

      setGitWorkingTreeSnapshotState({ kind: "idle" });
      setCleanCompareSession(view.session);
      setCompareBackTarget("git");
      setMode("compare");
    }).catch((caught) => {
      const currentRepository = gitRepositoryStateRef.current;
      if (
        !isCurrentGitRequest(activeGitSnapshotRequestId.current, requestGeneration)
        || currentRepository?.kind !== "ready"
        || currentRepository.repository.sessionId !== repositorySessionId
      ) return;
      setGitWorkingTreeSnapshotState({
        kind: "error",
        fileKey,
        requestGeneration,
        message: errorMessage(caught, languageMode),
      });
    }).finally(() => {
      if (
        activeGitSnapshotJob.current?.repositorySessionId === repositorySessionId
        && activeGitSnapshotJob.current.jobId === jobId
      ) {
        activeGitSnapshotJob.current = null;
      }
    });
  }, [
    cancelActiveGitSnapshot,
    gitWorkingTreeComparison,
    gitWorkingTreeState,
    languageMode,
    setCleanCompareSession,
  ]);

  const selectGitConflict = useCallback((entry: GitConflictEntry) => {
    const repository = gitRepositoryStateRef.current;
    if (repository?.kind !== "ready" || gitConflictState.kind !== "ready") return;

    cancelActiveGitConflictOpen();
    const requestGeneration = activeGitConflictOpenRequestId.current + 1;
    activeGitConflictOpenRequestId.current = requestGeneration;
    const jobId = nextGitJobId.current + 1;
    nextGitJobId.current = jobId;
    const repositorySessionId = repository.repository.sessionId;
    const entryKey = gitConflictEntryKey(entry);
    activeGitConflictOpenJob.current = { repositorySessionId, jobId };
    setSelectedGitConflictKey(entryKey);
    setGitConflictOpenState({ kind: "loading", entryKey });

    void openGitConflict(repositorySessionId, {
      opaquePathId: entry.path.opaqueId,
      generation: gitConflictState.list.generation,
    }, jobId).then((conflictSession) => {
      const currentRepository = gitRepositoryStateRef.current;
      if (
        !isCurrentGitRequest(activeGitConflictOpenRequestId.current, requestGeneration)
        || currentRepository?.kind !== "ready"
        || currentRepository.repository.sessionId !== repositorySessionId
      ) return;

      const view = adaptGitConflictSession(conflictSession);
      if (view.kind === "notice") {
        setGitConflictOpenState({
          kind: "notice",
          entryKey,
          contentStates: view.contentStates,
        });
        return;
      }

      setGitConflictOpenState({ kind: "idle" });
      setCleanMergeSession(view.session, view.outputVersion);
      setMode("merge");
    }).catch((caught) => {
      const currentRepository = gitRepositoryStateRef.current;
      if (
        !isCurrentGitRequest(activeGitConflictOpenRequestId.current, requestGeneration)
        || currentRepository?.kind !== "ready"
        || currentRepository.repository.sessionId !== repositorySessionId
      ) return;
      setGitConflictOpenState({
        kind: "error",
        entryKey,
        message: errorMessage(caught, languageMode),
      });
    }).finally(() => {
      if (
        activeGitConflictOpenJob.current?.repositorySessionId === repositorySessionId
        && activeGitConflictOpenJob.current.jobId === jobId
      ) {
        activeGitConflictOpenJob.current = null;
      }
    });
  }, [
    cancelActiveGitConflictOpen,
    gitConflictState,
    languageMode,
    setCleanMergeSession,
  ]);

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

  const openGitRepository = useCallback(() => {
    if (
      gitRepositoryPickerActive.current
      || gitRepositoryStateRef.current?.kind === "loading"
    ) return;
    requestLeaveActiveSession(() => {
      void (async () => {
        gitRepositoryPickerActive.current = true;
        let candidatePath: string | null;
        try {
          candidatePath = await chooseDirectory(appText.chooseGitRepository);
        } catch (caught) {
          setError(errorMessage(caught, languageMode));
          return;
        } finally {
          gitRepositoryPickerActive.current = false;
        }
        if (!candidatePath) return;

        const requestId = activeGitRepositoryRequestId.current + 1;
        activeGitRepositoryRequestId.current = requestId;
        const previousState = gitRepositoryStateRef.current;
        beginBusy();
        setError(null);
        setMessage(null);
        setRecentSessionFailure(null);
        resetGitRevisionReview(null);
        setGitRepositoryState({ kind: "loading", requestId });
        setMode("git");

        const precedingProbe = gitRepositoryProbeTail.current;
        let releaseProbeSlot = () => {};
        const probeSlot = new Promise<void>((resolve) => {
          releaseProbeSlot = resolve;
        });
        gitRepositoryProbeTail.current = precedingProbe.then(() => probeSlot);
        await precedingProbe;

        try {
          if (previousState?.kind === "ready") {
            await closeGitRepository(previousState.repository.sessionId);
          }
          if (!isCurrentGitRepositoryRequest(activeGitRepositoryRequestId.current, requestId)) {
            return;
          }

          const repository = await detectGitRepository(candidatePath);
          if (!isCurrentGitRepositoryRequest(activeGitRepositoryRequestId.current, requestId)) {
            await closeGitRepository(repository.sessionId).catch(() => {});
            return;
          }
          resetGitRevisionReview(repository);
          setGitRepositoryState({ kind: "ready", repository });
        } catch (caught) {
          if (!isCurrentGitRepositoryRequest(activeGitRepositoryRequestId.current, requestId)) {
            return;
          }
          const message = errorMessage(caught, languageMode);
          setError(message);
          setGitRepositoryState({ kind: "error", message });
        } finally {
          releaseProbeSlot();
          if (!releasedGitRepositoryRequestIds.current.delete(requestId)) {
            endBusy();
          }
        }
      })();
    });
  }, [
    appText.chooseGitRepository,
    beginBusy,
    endBusy,
    languageMode,
    requestLeaveActiveSession,
    resetGitRevisionReview,
  ]);

  const leaveGitRepository = useCallback(() => {
    requestLeaveActiveSession(() => {
      const state = gitRepositoryStateRef.current;
      activeGitRepositoryRequestId.current += 1;
      const exitPlan = planGitRepositoryExit(state);
      if (exitPlan.releaseRequestId != null) {
        if (!releasedGitRepositoryRequestIds.current.has(exitPlan.releaseRequestId)) {
          releasedGitRepositoryRequestIds.current.add(exitPlan.releaseRequestId);
          endBusy();
        }
      } else if (exitPlan.closeSessionId != null) {
        void closeGitRepository(exitPlan.closeSessionId).catch(() => {});
      }
      resetGitRevisionReview(null);
      setGitRepositoryState(null);
      setMode("home");
      setMessage(null);
      setError(null);
    });
  }, [endBusy, requestLeaveActiveSession, resetGitRevisionReview]);

  const backHome = () => {
    requestLeaveActiveSession(() => {
      setMode("home");
      setCompareBackTarget("home");
      setMessage(null);
      setError(null);
    });
  };

  const closeExternalGitToolWindow = () => {
    requestLeaveActiveSession(() => {
      allowWindowClose.current = true;
      void exitExternalGitTool().catch((caught) => {
        allowWindowClose.current = false;
        setError(errorMessage(caught, languageMode));
      });
    });
  };

  const backFromCompare = () => {
    requestLeaveActiveSession(() => {
      const nextMode = modeAfterCompareBack(compareBackTarget, folderResult != null);
      if (compareBackTarget === "git") {
        setCompareSession(null);
        setSavedCompareText({ left: null, right: null });
        setCompareOutputVersion({ left: null, right: null });
      }
      setMode(nextMode);
      setCompareBackTarget("home");
      setMessage(null);
      setError(null);
    });
  };

  const backFromGitConflict = () => {
    requestLeaveActiveSession(() => {
      cancelActiveGitConflictSave();
      setMergeSession(null);
      setSavedMergeResult(null);
      setMergeOutputVersion(null);
      setMode("git");
      setMessage(null);
      setError(null);
    });
  };

  const openCompare = () => requestLeaveActiveSession(() => run(async () => {
    const leftPath = await chooseTextFile(appText.chooseLeftFile);
    if (!leftPath) return;
    const rightPath = await chooseTextFile(appText.chooseRightFile);
    if (!rightPath) return;
    const [left, right] = await Promise.all([readTextFile(leftPath), readTextFile(rightPath)]);
    setCleanCompareSession({ origin: "files", left, right });
    setCompareBackTarget("home");
    rememberRecentSession({ kind: "compare", leftPath, rightPath });
    setMode("compare");
  }));

  const openDroppedCompareFiles = (paths: [string, string]) =>
    requestLeaveActiveSession(() => run(async () => {
      const [leftPath, rightPath] = paths;
      const [left, right] = await Promise.all([readTextFile(leftPath), readTextFile(rightPath)]);
      setCleanCompareSession({ origin: "files", left, right });
      setCompareBackTarget("home");
      rememberRecentSession({ kind: "compare", leftPath, rightPath });
      setMode("compare");
    }));

  const replaceDroppedCompareSide = (side: CompareDropSide, path: string) => {
    if (compareSession && !compareSessionCapabilities(compareSession).replaceInput) return;
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
          setMessage(appText.leftFileReplacedFromDrop);
          return;
        }

        setCompareSession({ ...compareSession, right: document });
        setSavedCompareText((current) => ({ ...current, right: document.text }));
        setCompareOutputVersion((current) => ({
          ...current,
          right: writePreconditionFromDocument(document),
        }));
        setCompareModelRevision((current) => current + 1);
        setMessage(appText.rightFileReplacedFromDrop);
      });
    };

    if (compareHasUnsavedChanges) {
      requestLeaveActiveSession(replaceSide);
      return;
    }

    replaceSide();
  };

  const openFolders = () => requestLeaveActiveSession(() => run(async () => {
    const leftRoot = await chooseDirectory(appText.chooseLeftFolder);
    if (!leftRoot) return;
    const rightRoot = await chooseDirectory(appText.chooseRightFolder);
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
    if (entry.status === "error" || entry.status === "typeMismatch") {
      throw new Error(appText.folderEntryNeedsRegularFile);
    }

    const hasLeftFile = entry.leftPath != null && entry.left?.kind === "file";
    const hasRightFile = entry.rightPath != null && entry.right?.kind === "file";
    const hasNonFileEntry =
      (entry.left != null && entry.left.kind !== "file") ||
      (entry.right != null && entry.right.kind !== "file");

    if (hasNonFileEntry || (!hasLeftFile && !hasRightFile)) {
      throw new Error(appText.regularFilesOnly);
    }

    if (folderResult && isDemoFolderRoots(folderResult.leftRoot, folderResult.rightRoot)) {
      const demoSession = demoFolderEntryCompareSession(entry);
      if (!demoSession) {
        throw new Error(appText.folderEntryNeedsRegularFile);
      }
      setCleanCompareSession(demoSession);
      setCompareBackTarget("folders");
      setMode("compare");
      return;
    }

    if (!folderResult) {
      throw new Error(appText.folderEntryNeedsRegularFile);
    }

    const leftPath = hasLeftFile ? entry.leftPath : null;
    const rightPath = hasRightFile ? entry.rightPath : null;

    const [left, right] = await Promise.all([
      leftPath
        ? readTextFile(leftPath)
        : Promise.resolve(
            virtualMissingFileDocument(
              folderExpectedPath(folderResult.leftRoot, entry.relativePath),
            ),
          ),
      rightPath
        ? readTextFile(rightPath)
        : Promise.resolve(
            virtualMissingFileDocument(
              folderExpectedPath(folderResult.rightRoot, entry.relativePath),
            ),
          ),
    ]);
    const session: CompareSession = { origin: "files", left, right };
    setCleanCompareSession(session);
    setCompareBackTarget("folders");
    if (!compareSessionHasVirtualDocument(session)) {
      rememberRecentSession({ kind: "compare", leftPath: left.path, rightPath: right.path });
    }
    setMode("compare");
  });

  const revealFolderPath = useCallback((path: string) => {
    void run(async () => {
      await revealPath(path);
      setMessage(appText.openedInFileManager);
    });
  }, [appText, run]);

  const openMerge = useCallback(() => requestLeaveActiveSession(() => run(async () => {
    const basePath = await chooseTextFile(appText.chooseBaseFile);
    if (!basePath) return;
    const oursPath = await chooseTextFile(appText.chooseOursFile);
    if (!oursPath) return;
    const theirsPath = await chooseTextFile(appText.chooseTheirsFile);
    if (!theirsPath) return;

    const [base, ours, theirs] = await Promise.all([
      readTextFile(basePath),
      readTextFile(oursPath),
      readTextFile(theirsPath),
    ]);
    if (base.isBinary || ours.isBinary || theirs.isBinary) {
      throw new Error(appText.mergeTextOnly);
    }

    const merged = await mergeTexts(base.text, ours.text, theirs.text);
    setCleanMergeSession({
      origin: "files",
      base,
      ours,
      theirs,
      output: null,
      result: merged.output,
      outputPath: null,
    });
    rememberRecentSession({
      kind: "merge",
      basePath,
      oursPath,
      theirsPath,
      outputPath: null,
    });
    setMode("merge");
  })), [appText, rememberRecentSession, requestLeaveActiveSession, run, setCleanMergeSession]);

  const openRecentSession = (session: RecentSession) => requestLeaveActiveSession(() => run(async () => {
    if (session.kind === "compare") {
      const [left, right] = await Promise.all([
        readTextFile(session.leftPath),
        readTextFile(session.rightPath),
      ]);
      setCleanCompareSession({ origin: "files", left, right });
      setCompareBackTarget("home");
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
          message: appText.recentSessionFailure(failureMessage),
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
      throw new Error(appText.mergeTextOnly);
    }

    const merged = await mergeTexts(base.text, ours.text, theirs.text);
    setCleanMergeSession({
      origin: "files",
      base,
      ours,
      theirs,
      output: null,
      result: merged.output,
      outputPath: session.outputPath,
    });
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
      message: appText.recentSessionFailure(failureMessage),
    });
  }));

  const saveCompareNow = useCallback((
    side: CompareSide,
    forceSaveAs: boolean,
    forceOverwrite = false,
    lineEndingMode: SaveLineEndingMode = "original",
  ) => run(async () => {
    if (!compareSession) return;
    if (!compareSessionCapabilities(compareSession).save) return;
    const target = compareSession[side];
    if (isVirtualFileDocument(target)) {
      throw new Error(appText.virtualCompareSaveDisabled);
    }

    let outputPath = forceSaveAs ? null : target.path;
    if (!outputPath) {
      outputPath = await chooseSavePath(target.path, appText.saveSideFile(side));
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
    const persistentSession = compareSessionHasVirtualDocument(saved.session)
      ? null
      : persistentCompareSessionInput(saved.session);
    if (persistentSession) rememberRecentSession(persistentSession);
    setMessage(appText.sideSaved(side, written.backupPath));
  }), [appText, compareOutputVersion, compareSession, rememberRecentSession, run]);

  const exportCompareReport = useCallback((options: TextDiffOptions) => run(async () => {
    if (!compareSession) return;
    const outputPath = await chooseSavePath(
      compareReportDefaultPath(compareSession),
      appText.saveDiffReport,
    );
    if (!outputPath) return;
    const report = buildDiffReport({ session: compareSession, options, generatedAt: new Date() });
    const written = await writeTextFileAtomic(outputPath, report, true, null, "UTF-8");
    setMessage(appText.reportSaved(written.path));
  }), [appText, compareSession, run]);

  const showCompareBackups = useCallback((side: CompareSide) => run(async () => {
    if (!compareSession) return;
    if (!compareSessionCapabilities(compareSession).backupRestore) return;
    const target = compareSession[side];
    if (isVirtualFileDocument(target)) {
      throw new Error(appText.virtualCompareSaveDisabled);
    }

    const backups = await listFileBackups(target.path);
    setBackupDialog({
      kind: "compare",
      side,
      targetPath: target.path,
      title: appText.sideFileBackups(side),
      backups,
    });
  }), [appText, compareSession, run]);

  const saveMergeNow = useCallback((
    forceSaveAs: boolean,
    lineEndingMode: SaveLineEndingMode = "original",
  ) => run(async () => {
    if (!mergeSession) return;
    if (mergeSession.origin === "gitConflict") {
      const repositorySessionId = mergeSession.conflict.repositoryId;
      const repository = gitRepositoryStateRef.current;
      if (
        repository?.kind !== "ready"
        || repository.repository.sessionId !== repositorySessionId
      ) return;

      cancelActiveGitConflictSave();
      const requestGeneration = activeGitConflictSaveRequestId.current + 1;
      activeGitConflictSaveRequestId.current = requestGeneration;
      const saveJobId = nextGitJobId.current + 1;
      nextGitJobId.current = saveJobId;
      let currentJobId = saveJobId;
      activeGitConflictSaveJob.current = { repositorySessionId, jobId: saveJobId };

      try {
        const written = await saveGitConflictResult(
          repositorySessionId,
          gitConflictSaveRequest(mergeSession, mergeSession.result, lineEndingMode),
          saveJobId,
        );
        if (
          !isCurrentGitRequest(activeGitConflictSaveRequestId.current, requestGeneration)
          || written.action !== "CONFLICT_SAVED"
        ) return;

        setSavedMergeResult(mergeSession.result);
        setMessage(CORE_TEXT[languageMode].gitConflictSaved);

        const reopenJobId = nextGitJobId.current + 1;
        nextGitJobId.current = reopenJobId;
        currentJobId = reopenJobId;
        activeGitConflictSaveJob.current = { repositorySessionId, jobId: reopenJobId };
        try {
          const reopened = await openGitConflict(repositorySessionId, {
            opaquePathId: mergeSession.conflict.path.opaqueId,
            generation: mergeSession.conflict.generation,
          }, reopenJobId);
          if (!isCurrentGitRequest(
            activeGitConflictSaveRequestId.current,
            requestGeneration,
          )) return;
          const view = adaptGitConflictSession(reopened);
          if (view.kind === "merge") {
            setCleanMergeSession(view.session, view.outputVersion);
          }
        } catch {
          // The Result save already succeeded. A status refresh below exposes any
          // external stage transition without reporting the completed write as failed.
        }
        refreshGitRepositoryStatus();
        return;
      } finally {
        const activeJob = activeGitConflictSaveJob.current;
        if (
          activeJob?.repositorySessionId === repositorySessionId
          && activeJob.jobId === currentJobId
        ) {
          activeGitConflictSaveJob.current = null;
        }
      }
    }
    const capabilities = mergetoolSessionCapabilities(mergeSession);
    if (forceSaveAs && !capabilities.saveAs) return;

    let outputPath = capabilities.saveTarget === "output-only"
      ? mergeSession.outputPath
      : forceSaveAs
        ? null
        : mergeSession.outputPath;
    if (!outputPath) {
      outputPath = await chooseSavePath(
        mergeSession.outputPath ?? mergeSession.ours.path,
        appText.saveMergeResult,
      );
    }
    if (!outputPath) return;
    const precondition = mergeSavePreconditionForPath(mergeSession, outputPath, mergeOutputVersion);
    const saveText = textForSaveLineEnding(
      mergeSession.result,
      mergeResultOriginalLineEnding(mergeSession),
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
      current?.origin === "mergetool"
        ? {
            ...current,
            output: {
              ...fileDocumentWithText(current.output, saved.savedSnapshot),
              path: saved.outputPath,
              encoding: "UTF-8",
              size: written.size,
              modifiedMs: written.modifiedMs,
              decodeHadErrors: false,
            },
            result: saved.savedSnapshot,
            outputPath: saved.outputPath,
          }
        : current?.origin === "gitConflict"
          ? {
              ...current,
              output: {
                ...fileDocumentWithText(current.output, saved.savedSnapshot),
                path: saved.outputPath,
                encoding: "UTF-8",
                size: written.size,
                modifiedMs: written.modifiedMs,
                decodeHadErrors: false,
              },
              resultDocument: {
                ...fileDocumentWithText(current.resultDocument, saved.savedSnapshot),
                path: saved.outputPath,
                encoding: "UTF-8",
                size: written.size,
                modifiedMs: written.modifiedMs,
                decodeHadErrors: false,
              },
              result: saved.savedSnapshot,
              outputPath: saved.outputPath,
            }
        : current
          ? {
              ...current,
              output: current.output
                ? {
                    ...fileDocumentWithText(current.output, saved.savedSnapshot),
                    path: saved.outputPath,
                    encoding: "UTF-8",
                    size: written.size,
                    modifiedMs: written.modifiedMs,
                    decodeHadErrors: false,
                  }
                : null,
              result: saved.savedSnapshot,
              outputPath: saved.outputPath,
            }
          : current,
    );
    setSavedMergeResult(saved.savedSnapshot);
    setMergeOutputVersion(saved.outputVersion);
    const persistentSession = persistentMergeSessionInput({
      ...mergeSession,
      outputPath: saved.outputPath,
    });
    if (persistentSession) rememberRecentSession(persistentSession);
    setMessage(appText.saved(written.backupPath));
  }), [
    appText,
    cancelActiveGitConflictSave,
    mergeOutputVersion,
    mergeSession,
    languageMode,
    refreshGitRepositoryStatus,
    rememberRecentSession,
    run,
    setCleanMergeSession,
  ]);

  const showMergeBackups = useCallback(() => run(async () => {
    if (!mergeSession?.outputPath || mergeSession.origin === "gitConflict") return;
    const backups = await listFileBackups(mergeSession.outputPath);
    setBackupDialog({
      kind: "merge",
      targetPath: mergeSession.outputPath,
      title: appText.mergeResultBackups,
      backups,
    });
  }), [appText, mergeSession, run]);

  const restoreBackup = useCallback((backup: FileBackup) => run(async () => {
    if (!backupDialog) return;
    if (
      backupDialog.kind === "compare" &&
      compareSession &&
      !compareSessionCapabilities(compareSession).backupRestore
    ) return;
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
        output: restored,
        result: restored.text,
        outputPath: restored.path,
      } : current);
      setSavedMergeResult(restored.text);
      setMergeOutputVersion(writePreconditionFromDocument(restored));
      if (mergeSession) clearMergeRecoveryDraft(mergeSession);
      setMergeRecoveryDraft(null);
    }

    setBackupDialog(null);
    setMessage(appText.backupRestored(restored.path));
  }), [
    appText,
    backupDialog,
    compareOutputVersion,
    compareSession,
    mergeOutputVersion,
    mergeSession,
    run,
  ]);

  const saveMerge = useCallback((
    forceSaveAs: boolean,
    lineEndingMode: SaveLineEndingMode = "original",
  ) => {
    if (!mergeSession) return;
    const capabilities = mergetoolSessionCapabilities(mergeSession);
    if (forceSaveAs && !capabilities.saveAs) return;
    if (!hasUnresolvedConflicts(mergeSession.result)) {
      saveMergeNow(forceSaveAs, lineEndingMode);
      return;
    }

    if (capabilities.unresolvedPolicy === "block-unresolved") {
      pendingSaveAction.current = null;
      setShowUnresolvedSaveDialog(false);
      setError(MERGE_VIEW_TEXT[languageMode].resolveBeforeSaving);
      return;
    }

    pendingSaveAction.current = () => saveMergeNow(forceSaveAs, lineEndingMode);
    setShowUnresolvedSaveDialog(true);
  }, [languageMode, mergeSession, saveMergeNow]);

  const handleShellCommand = useCallback((commandId: AppCommandId) => {
    if (!isShellOpenCommandAllowed(commandId, {
      mode,
      compareOrigin: compareSession?.origin ?? null,
      mergeOrigin: mergeSession?.origin ?? null,
    })) return;

    if (commandId === "openGitRepository") {
      openGitRepository();
      return;
    }
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
  }, [
    compareSession?.origin,
    mergeSession?.origin,
    mode,
    openCompare,
    openFolders,
    openGitRepository,
    openMerge,
  ]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (matchesCommandShortcut("openGitRepository", event)) {
        event.preventDefault();
        handleShellCommand("openGitRepository");
        return;
      }
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

  const gitRevisionPairError = sameResolvedGitRevisions(
    gitRevisionFields.left.revision,
    gitRevisionFields.right.revision,
  )
    ? languageMode === "ko"
      ? "서로 다른 두 revision을 선택하세요."
      : "Choose two different revisions."
    : null;

  return (
    <div className="app-shell" data-theme={resolvedTheme} lang={languageMode}>
      {busy && (
        <div className="busy-bar" role="status" aria-live="polite" aria-label={appText.busyAria} />
      )}
      {error && (
        <div className="toast error-toast">
          <strong>{appText.errorTitle}</strong>
          <span>{error}</span>
          <button aria-label={appText.closeError} onClick={() => setError(null)}>×</button>
        </div>
      )}
      {message && (
        <div className="toast success-toast">
          <strong>{appText.doneTitle}</strong>
          <span>{message}</span>
          <button aria-label={appText.closeSuccess} onClick={() => setMessage(null)}>×</button>
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
              <button type="button" onClick={cancelPendingLeave}>{appText.keepEditing}</button>
              <button type="button" className="danger-button" onClick={confirmPendingLeave}>
                {appText.discardAndLeave}
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
            <h2 id="unresolved-save-dialog-title">{appText.conflictMarkersRemain}</h2>
            <p>{appText.unresolvedSaveMessage}</p>
            <div className="dialog-actions">
              <button type="button" onClick={cancelPendingSave}>{appText.keepEditing}</button>
              <button type="button" className="danger-button" onClick={confirmPendingSave}>
                {appText.saveAnyway}
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
              <p>{appText.noBackups}</p>
            ) : (
              <ul className="backup-list">
                {backupDialog.backups.map((backup) => (
                  <li key={backup.path}>
                    <div>
                      <strong>{backup.name}</strong>
                      <span>
                        {formatBytes(backup.size)} · {formatBackupTime(backup.modifiedMs, languageMode)}
                      </span>
                    </div>
                    <button type="button" onClick={() => restoreBackup(backup)}>
                      {appText.restore}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="dialog-actions">
              <button type="button" onClick={() => setBackupDialog(null)}>{appText.close}</button>
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
            aria-label={appText.loadingEditor}
          />
        }
      >
        {mode === "home" && (
          <StartPage
            busy={busy}
            languageMode={languageMode}
            themeMode={themeMode}
            recentSessions={recentSessions}
            recentSessionFailure={recentSessionFailure}
            onLanguageModeChange={setLanguageMode}
            onThemeModeChange={setThemeMode}
            onOpenCompare={openCompare}
            onOpenFolders={openFolders}
            onOpenMerge={openMerge}
            onOpenGitRepository={openGitRepository}
            onDropCompareFiles={openDroppedCompareFiles}
            onDropRejected={rejectDroppedFiles}
            onOpenRecentSession={openRecentSession}
            onClearRecentSessions={clearRecentSessions}
            onRemoveRecentSession={removeRecentSessionById}
            onDemoCompare={() => {
              requestLeaveActiveSession(() => {
                setCleanCompareSession(demoCompareSession());
                setCompareBackTarget("home");
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

        {mode === "git" && gitRepositoryState && (
          <GitCompareView
            state={gitRepositoryState}
            languageMode={languageMode}
            revisionReview={{
              left: gitRevisionFields.left,
              right: gitRevisionFields.right,
              references: gitRefState,
              pairError: gitRevisionPairError,
            }}
            changedFilesReview={{
              state: gitChangedFileState,
              filter: gitChangedFileFilter,
              selectedKey: selectedGitChangedFileKey,
              viewedKeys: viewedGitChangedFileKeys,
              snapshotState: gitSnapshotSelectionState,
            }}
            workingTreeReview={{
              state: gitWorkingTreeState,
              filter: gitWorkingTreeFilter,
              comparison: gitWorkingTreeComparison,
              selectedKey: selectedGitWorkingTreeKey,
              snapshotState: gitWorkingTreeSnapshotState,
            }}
            conflictReview={{
              state: gitConflictState,
              selectedKey: selectedGitConflictKey,
              openState: gitConflictOpenState,
            }}
            onBack={leaveGitRepository}
            onOpenRepository={openGitRepository}
            onCancelOpen={leaveGitRepository}
            onRevisionInputChange={updateGitRevisionInput}
            onValidateRevision={validateGitRevision}
            onChangedFileFilterChange={(query) =>
              setGitChangedFileFilter((current) => ({ ...current, query }))
            }
            onChangedFileStatusFilterChange={(status: GitChangedFileStatusFilter) =>
              setGitChangedFileFilter((current) => ({ ...current, status }))
            }
            onSelectChangedFile={selectGitChangedFile}
            onRefreshWorkingTree={refreshGitRepositoryStatus}
            onWorkingTreeFilterChange={(query) =>
              setGitWorkingTreeFilter((current) => ({ ...current, query }))
            }
            onWorkingTreeSectionFilterChange={(section: GitWorkingTreeSection) =>
              setGitWorkingTreeFilter((current) => ({ ...current, section }))
            }
            onWorkingTreeComparisonChange={setGitWorkingTreeComparison}
            onSelectWorkingTreeFile={selectGitWorkingTreeFile}
            onRefreshConflicts={refreshGitRepositoryStatus}
            onSelectConflict={selectGitConflict}
          />
        )}

        {mode === "compare" && compareSession && (
          <FileCompareView
            session={compareSession}
            busy={busy}
            languageMode={languageMode}
            editorTheme={editorTheme}
            fileChangeNotice={compareFileChangeNotice}
            modelRevision={compareModelRevision}
            dirtySides={compareDirtySides}
            backLabel={
              compareBackTarget === "folders"
                ? appText.folderResults
                : compareBackTarget === "git"
                  ? languageMode === "ko" ? "저장소 검토" : "Repository review"
                  : undefined
            }
            onBack={
              compareSession.origin === "difftool"
                ? closeExternalGitToolWindow
                : backFromCompare
            }
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
            onSwap={() => {
              if (!compareSessionCapabilities(compareSession).swap) return;
              setCleanCompareSession({
                ...compareSession,
                left: compareSession.right,
                right: compareSession.left,
              });
            }}
          />
        )}

        {mode === "folders" && folderResult && (
          <FolderCompareView
            result={folderResult}
            options={folderOptions}
            busy={busy}
            languageMode={languageMode}
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
            languageMode={languageMode}
            dirty={mergeHasUnsavedChanges}
            editorTheme={editorTheme}
            recoveryDraft={mergeRecoveryDraft}
            onBack={
              mergeSession.origin === "mergetool"
                ? closeExternalGitToolWindow
                : mergeSession.origin === "gitConflict"
                  ? backFromGitConflict
                  : backHome
            }
            onResultChange={updateMergeResult}
            onRecoveryDraftsEnabledChange={setMergeRecoveryEnabled}
            onRestoreRecoveryDraft={() => {
              if (!mergeRecoveryDraft) return;
              updateMergeResult(mergeRecoveryDraft.result);
              setMessage(appText.mergeDraftRestored);
            }}
            onDiscardRecoveryDraft={() => {
              clearMergeRecoveryDraft(mergeSession);
              setMergeRecoveryDraft(null);
              setMessage(appText.mergeDraftDeleted);
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

function formatBackupTime(modifiedMs: number | null, languageMode: AppLanguage): string {
  if (modifiedMs == null) return APP_TEXT[languageMode].modifiedTimeUnknown;
  return new Date(modifiedMs).toLocaleString(localeForLanguage(languageMode));
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
