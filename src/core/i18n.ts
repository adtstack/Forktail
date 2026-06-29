import type { AppLanguage, ThemeMode } from "./settings";

type CompareSide = "left" | "right";

export const LANGUAGE_OPTIONS: Array<{ value: AppLanguage; label: string }> = [
  { value: "en", label: "English" },
  { value: "ko", label: "한국어" },
];

export function localeForLanguage(language: AppLanguage): string {
  return language === "ko" ? "ko-KR" : "en-US";
}

export function themeOptionsForLanguage(
  language: AppLanguage,
): Array<{ value: ThemeMode; label: string }> {
  return START_PAGE_TEXT[language].themeOptions;
}

export const START_PAGE_TEXT = {
  en: {
    eyebrow: "LOCAL-FIRST COMPARE",
    subtitle: "Review local text diffs, folders, and conflicts with predictable controls.",
    workBoundariesAria: "Work boundaries",
    assurances: ["Offline", "Text only", "Backups"],
    startComparingAria: "Start comparing",
    compareTitle: "Compare Files",
    compareDescription: "Step through changes with F7.",
    folderTitle: "Folder Diff",
    folderDescription: "Filter status and choose hash depth.",
    mergeTitle: "3-way Merge",
    mergeDescription: "Resolve conflicts and save the result.",
    dropHint: "Drop two files here to open a 2-way compare.",
    dropPathUnavailable:
      "Cannot read the dropped file path. Drop local files in the desktop app.",
    dropWrongCount: (count: number) =>
      `Drop exactly 2 files for 2-way compare. Current count: ${count}.`,
    recentAria: "Recent sessions",
    recentTitle: "Recent",
    clear: "Clear",
    remove: "Remove",
    noRecent: "No recent sessions.",
    samplesAria: "Sample sessions",
    samples: "Samples",
    sampleCompare: "2-way",
    sampleFolders: "Folder",
    sampleMerge: "3-way",
    themeAria: "Theme",
    theme: "Theme",
    chooseThemeAria: "Choose theme",
    languageAria: "Language",
    language: "Language",
    chooseLanguageAria: "Choose language",
    phaseScopeAria: "Phase 1 scope",
    phaseScope: "Phase 1",
    scopeTextDiff: "Text diff",
    scopeFolderScan: "Folder scan",
    scopeMerge: "3-way Merge",
    scopeAtomicSave: "Atomic save",
    folderKind: "Folder",
    themeOptions: [
      { value: "system", label: "System" },
      { value: "dark", label: "Dark" },
      { value: "light", label: "Light" },
    ] satisfies Array<{ value: ThemeMode; label: string }>,
  },
  ko: {
    eyebrow: "로컬 우선 비교",
    subtitle: "파일과 폴더 차이를 빠르게 검토하고, 충돌은 명시적으로 해결합니다.",
    workBoundariesAria: "작업 경계",
    assurances: ["오프라인", "텍스트 전용", "백업 저장"],
    startComparingAria: "비교 시작",
    compareTitle: "파일 비교",
    compareDescription: "F7로 변경 사항을 순서대로 확인합니다.",
    folderTitle: "폴더 비교",
    folderDescription: "상태를 필터링하고 해시 깊이를 선택합니다.",
    mergeTitle: "3-way 병합",
    mergeDescription: "충돌을 해결하고 결과를 저장합니다.",
    dropHint: "파일 두 개를 이 화면에 놓으면 바로 2-way 비교로 엽니다.",
    dropPathUnavailable:
      "드롭한 항목의 파일 경로를 읽을 수 없습니다. 데스크톱 앱에서 로컬 파일을 드롭하세요.",
    dropWrongCount: (count: number) =>
      `2-way 비교에는 파일 2개를 드롭하세요. 현재 ${count}개입니다.`,
    recentAria: "최근 세션",
    recentTitle: "최근 세션",
    clear: "지우기",
    remove: "이 항목 제거",
    noRecent: "최근 세션이 없습니다.",
    samplesAria: "샘플 세션",
    samples: "샘플",
    sampleCompare: "2-way 데모",
    sampleFolders: "폴더 데모",
    sampleMerge: "3-way 데모",
    themeAria: "테마",
    theme: "테마",
    chooseThemeAria: "테마 선택",
    languageAria: "언어",
    language: "언어",
    chooseLanguageAria: "언어 선택",
    phaseScopeAria: "1차 개발 범위",
    phaseScope: "Phase 1",
    scopeTextDiff: "텍스트 Diff",
    scopeFolderScan: "폴더 스캔",
    scopeMerge: "3-way Merge",
    scopeAtomicSave: "원자적 저장",
    folderKind: "폴더",
    themeOptions: [
      { value: "system", label: "시스템" },
      { value: "dark", label: "다크" },
      { value: "light", label: "라이트" },
    ] satisfies Array<{ value: ThemeMode; label: string }>,
  },
} as const;

export const APP_TEXT = {
  en: {
    recentSessionRemoved: "Recent session removed.",
    unsavedCompareTitle: "Unsaved Compare File",
    unsavedMergeTitle: "Unsaved Merge Result",
    unsavedCompareMessage: "The compare file has unsaved changes. Discard them and leave?",
    unsavedMergeMessage: "The merge result has unsaved changes. Discard them and leave?",
    changedFilesReloaded: "Changed files reloaded.",
    folderScanActive: "Scanning folders. If it takes too long, cancel and adjust options.",
    folderScanCancelled: "Folder scan cancelled.",
    folderScanCancelledLate: "Scan cancelled. Late results will not update the screen.",
    demoRestoreOnly: "Only demo sessions can be restored automatically in the browser.",
    mergeTextOnly: "3-way merge only supports text files.",
    chooseLeftFile: "Choose Left File",
    chooseRightFile: "Choose Right File",
    chooseLeftFolder: "Choose Left Folder",
    chooseRightFolder: "Choose Right Folder",
    chooseBaseFile: "Choose BASE File",
    chooseOursFile: "Choose OURS File",
    chooseTheirsFile: "Choose THEIRS File",
    leftFileReplacedFromDrop: "Left file replaced from drop.",
    rightFileReplacedFromDrop: "Right file replaced from drop.",
    folderEntryNeedsBoth: "Only files present on both sides can open in 2-way compare.",
    regularFilesOnly: "Only regular files can be opened right now.",
    regularFilesBoth: "Only regular files on both sides can open in 2-way compare.",
    openedInFileManager: "Opened item in the file manager.",
    recentSessionFailure: (message: string) =>
      `Cannot open the recent session. ${message} Remove it if paths moved or permissions changed.`,
    sideName: (side: CompareSide) => side === "left" ? "Left" : "Right",
    saveSideFile: (side: CompareSide) =>
      `Save ${side === "left" ? "Left" : "Right"} File`,
    saved: (backupPath: string | null) =>
      backupPath ? `Saved · backup: ${backupPath}` : "Saved",
    sideSaved: (side: CompareSide, backupPath: string | null) =>
      `${side === "left" ? "Left" : "Right"} ${backupPath ? `Saved · backup: ${backupPath}` : "Saved"}`,
    saveDiffReport: "Save Diff Report",
    reportSaved: (path: string) => `Report saved: ${path}`,
    sideFileBackups: (side: CompareSide) =>
      `${side === "left" ? "Left" : "Right"} File Backups`,
    saveMergeResult: "Save Merge Result",
    mergeResultBackups: "Merge Result Backups",
    backupRestored: (path: string) => `Backup restored: ${path}`,
    busyAria: "Working",
    errorTitle: "Error",
    doneTitle: "Done",
    closeError: "Close error message",
    closeSuccess: "Close success message",
    keepEditing: "Keep Editing",
    discardAndLeave: "Discard and Leave",
    conflictMarkersRemain: "Conflict Markers Remain",
    unresolvedSaveMessage: "Conflict markers remain in the merge result. Save anyway?",
    saveAnyway: "Save Anyway",
    noBackups: "No backups available.",
    restore: "Restore",
    close: "Close",
    loadingEditor: "Loading editor",
    mergeDraftRestored: "Merge draft restored.",
    mergeDraftDeleted: "Merge draft deleted.",
    modifiedTimeUnknown: "Modified time unknown",
    fileChangeNotice: (leftChanged: boolean, rightChanged: boolean) => {
      const sides = [
        leftChanged ? "Left" : null,
        rightChanged ? "Right" : null,
      ].filter((side): side is string => side != null);
      return `${sides.join(" and ")} file changed after it was opened. Reload or keep the current compare content.`;
    },
  },
  ko: {
    recentSessionRemoved: "최근 세션 항목을 제거했습니다.",
    unsavedCompareTitle: "저장하지 않은 비교 파일",
    unsavedMergeTitle: "저장하지 않은 병합 결과",
    unsavedCompareMessage: "비교 파일에 저장하지 않은 변경이 있습니다. 변경을 버리고 이동할까요?",
    unsavedMergeMessage: "병합 결과에 저장하지 않은 변경이 있습니다. 변경을 버리고 이동할까요?",
    changedFilesReloaded: "변경된 파일을 다시 읽었습니다.",
    folderScanActive: "폴더 스캔 중입니다. 오래 걸리면 취소하고 옵션을 조정할 수 있습니다.",
    folderScanCancelled: "폴더 스캔을 취소했습니다.",
    folderScanCancelledLate: "스캔을 취소했습니다. 늦게 도착한 결과는 화면에 반영하지 않습니다.",
    demoRestoreOnly: "브라우저에서는 데모 세션만 자동 복원할 수 있습니다.",
    mergeTextOnly: "3-way 병합은 텍스트 파일만 지원합니다.",
    chooseLeftFile: "왼쪽 파일 선택",
    chooseRightFile: "오른쪽 파일 선택",
    chooseLeftFolder: "왼쪽 폴더 선택",
    chooseRightFolder: "오른쪽 폴더 선택",
    chooseBaseFile: "BASE 파일 선택",
    chooseOursFile: "OURS 파일 선택",
    chooseTheirsFile: "THEIRS 파일 선택",
    leftFileReplacedFromDrop: "왼쪽 파일을 드롭한 파일로 바꿨습니다.",
    rightFileReplacedFromDrop: "오른쪽 파일을 드롭한 파일로 바꿨습니다.",
    folderEntryNeedsBoth: "양쪽에 모두 존재하는 파일만 2-way 비교할 수 있습니다.",
    regularFilesOnly: "현재는 일반 파일만 열 수 있습니다.",
    regularFilesBoth: "양쪽 일반 파일만 2-way 비교할 수 있습니다.",
    openedInFileManager: "파일 관리자에서 항목을 열었습니다.",
    recentSessionFailure: (message: string) =>
      `최근 세션을 열 수 없습니다. ${message} 경로가 이동되었거나 권한이 바뀌었다면 이 항목을 제거하세요.`,
    sideName: (side: CompareSide) => side === "left" ? "왼쪽" : "오른쪽",
    saveSideFile: (side: CompareSide) =>
      `${side === "left" ? "왼쪽" : "오른쪽"} 파일 저장`,
    saved: (backupPath: string | null) =>
      backupPath ? `저장 완료 · 백업: ${backupPath}` : "저장 완료",
    sideSaved: (side: CompareSide, backupPath: string | null) =>
      `${side === "left" ? "왼쪽" : "오른쪽"} ${backupPath ? `저장 완료 · 백업: ${backupPath}` : "저장 완료"}`,
    saveDiffReport: "Diff 리포트 저장",
    reportSaved: (path: string) => `리포트 저장 완료: ${path}`,
    sideFileBackups: (side: CompareSide) =>
      `${side === "left" ? "왼쪽" : "오른쪽"} 파일 백업`,
    saveMergeResult: "병합 결과 저장",
    mergeResultBackups: "병합 결과 백업",
    backupRestored: (path: string) => `백업 복원 완료: ${path}`,
    busyAria: "작업 중",
    errorTitle: "오류",
    doneTitle: "완료",
    closeError: "오류 메시지 닫기",
    closeSuccess: "완료 메시지 닫기",
    keepEditing: "계속 편집",
    discardAndLeave: "변경 버리고 이동",
    conflictMarkersRemain: "충돌 마커가 남아 있습니다",
    unresolvedSaveMessage: "병합 결과에 충돌 마커가 남아 있습니다. 그래도 저장하시겠습니까?",
    saveAnyway: "그래도 저장",
    noBackups: "복원할 백업이 없습니다.",
    restore: "복원",
    close: "닫기",
    loadingEditor: "편집기 로딩 중",
    mergeDraftRestored: "병합 결과 draft를 복구했습니다.",
    mergeDraftDeleted: "병합 결과 draft를 삭제했습니다.",
    modifiedTimeUnknown: "수정 시간 알 수 없음",
    fileChangeNotice: (leftChanged: boolean, rightChanged: boolean) => {
      const sides = [
        leftChanged ? "왼쪽" : null,
        rightChanged ? "오른쪽" : null,
      ].filter((side): side is string => side != null);
      return `${sides.join("과 ")} 파일이 열린 뒤 변경됐습니다. 다시 읽거나 현재 비교 내용을 유지하세요.`;
    },
  },
} as const;
