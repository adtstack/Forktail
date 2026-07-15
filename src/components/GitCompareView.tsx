import type {
  GitConflictEntry,
  GitIndexComparison,
  GitRepositorySummary,
} from "../core/gitModels";
import type { GitChangedFile } from "../core/gitModels";
import type {
  GitChangedFileFilter,
  GitChangedFileLoadState,
  GitChangedFileOpenMode,
  GitChangedFileStatusFilter,
  GitConflictLoadState,
  GitConflictOpenState,
  GitRefLoadState,
  GitRevisionFieldState,
  GitSnapshotSelectionState,
  GitWorkingTreeFilter,
  GitWorkingTreeLoadState,
  GitWorkingTreeRow,
  GitWorkingTreeSection,
} from "../core/gitSession";
import type { AppLanguage } from "../core/settings";
import { GitChangedFiles } from "./GitChangedFiles";
import { GitConflictView } from "./GitConflictView";
import { GitRevisionSelector } from "./GitRevisionSelector";
import {
  GitTreePicker,
  type GitTreePickerState,
  type GitTreeSelectionKey,
} from "./GitTreePicker";
import { GitWorkingTreeFiles } from "./GitWorkingTreeFiles";

export type GitRepositoryScreenState =
  | { kind: "loading"; requestId: number }
  | { kind: "error"; message: string }
  | { kind: "ready"; repository: GitRepositorySummary };

export interface GitRepositoryExitPlan {
  releaseRequestId: number | null;
  closeSessionId: string | null;
}

export function isCurrentGitRepositoryRequest(
  activeRequestId: number,
  responseRequestId: number,
): boolean {
  return activeRequestId === responseRequestId;
}

export function planGitRepositoryExit(
  state: GitRepositoryScreenState | null,
): GitRepositoryExitPlan {
  if (state?.kind === "loading") {
    return { releaseRequestId: state.requestId, closeSessionId: null };
  }
  if (state?.kind === "ready") {
    return {
      releaseRequestId: null,
      closeSessionId: state.repository.sessionId,
    };
  }
  return { releaseRequestId: null, closeSessionId: null };
}

interface GitCompareViewProps {
  state: GitRepositoryScreenState;
  languageMode?: AppLanguage;
  revisionReview?: GitRevisionReviewState;
  changedFilesReview?: GitChangedFilesReviewState;
  workingTreeReview?: GitWorkingTreeReviewState;
  conflictReview?: GitConflictReviewState;
  treePickerReview?: GitTreePickerReviewState;
  onBack: () => void;
  onOpenRepository: () => void;
  onCancelOpen: () => void;
  onRevisionInputChange?: (side: "left" | "right", input: string) => void;
  onValidateRevision?: (side: "left" | "right", input: string) => void;
  onChangedFileFilterChange?: (query: string) => void;
  onChangedFileStatusFilterChange?: (status: GitChangedFileStatusFilter) => void;
  onChangedFileOpenModeChange?: (mode: GitChangedFileOpenMode) => void;
  onSelectChangedFile?: (entry: GitChangedFile) => void;
  onLoadTrackedTrees?: () => void;
  onCancelTrackedTrees?: () => void;
  onCloseTrackedTrees?: () => void;
  onTrackedTreeQueryChange?: (query: string) => void;
  onSelectTrackedTreePath?: (side: "left" | "right", selection: GitTreeSelectionKey) => void;
  onCompareTrackedTreePaths?: () => void;
  onRefreshWorkingTree?: () => void;
  onWorkingTreeFilterChange?: (query: string) => void;
  onWorkingTreeSectionFilterChange?: (section: GitWorkingTreeSection) => void;
  onWorkingTreeComparisonChange?: (comparison: GitIndexComparison) => void;
  onSelectWorkingTreeFile?: (row: GitWorkingTreeRow) => void;
  onRefreshConflicts?: () => void;
  onSelectConflict?: (entry: GitConflictEntry) => void;
}

export interface GitRevisionReviewState {
  left: GitRevisionFieldState;
  right: GitRevisionFieldState;
  references: GitRefLoadState;
  pairError: string | null;
}

export interface GitChangedFilesReviewState {
  state: GitChangedFileLoadState;
  filter: GitChangedFileFilter;
  selectedKey: string | null;
  viewedKeys: ReadonlySet<string>;
  snapshotState: GitSnapshotSelectionState;
  openMode?: GitChangedFileOpenMode;
}

export interface GitWorkingTreeReviewState {
  state: GitWorkingTreeLoadState;
  filter: GitWorkingTreeFilter;
  comparison: GitIndexComparison;
  selectedKey: string | null;
  snapshotState: GitSnapshotSelectionState;
}

export interface GitConflictReviewState {
  state: GitConflictLoadState;
  selectedKey: string | null;
  openState: GitConflictOpenState;
}

export interface GitTreePickerReviewState {
  state: GitTreePickerState;
  query: string;
  leftSelection: GitTreeSelectionKey;
  rightSelection: GitTreeSelectionKey;
  openState: GitSnapshotSelectionState;
}

const GIT_COMPARE_TEXT = {
  en: {
    aria: "Repository review",
    eyebrow: "LOCAL GIT SNAPSHOTS",
    title: "Repository review",
    loading: "Opening Git repository…",
    loadingDetail: "Validating the selected folder and local Git metadata.",
    cancelOpening: "Cancel opening",
    errorTitle: "Repository unavailable",
    chooseAnother: "Choose another folder",
    back: "Back to start",
    openAnother: "Open another repository",
    root: "Repository root",
    currentBranch: "Current branch",
    detached: "Detached HEAD",
    noCommits: "No commits yet",
    noCommitsDetail: "Create the first commit outside Forktail, then open the repository again.",
    linkedWorktree: "Linked worktree",
    shallow: "Shallow history",
    localOnly: "Local snapshots only",
    readOnly: "Read-only review",
    readyPrompt: "Choose two local revisions to start reviewing committed changes.",
    revisions: "Compare revisions",
  },
  ko: {
    aria: "저장소 검토",
    eyebrow: "로컬 GIT SNAPSHOT",
    title: "저장소 검토",
    loading: "Git 저장소를 여는 중…",
    loadingDetail: "선택한 폴더와 로컬 Git metadata를 검증하고 있습니다.",
    cancelOpening: "열기 취소",
    errorTitle: "저장소를 열 수 없음",
    chooseAnother: "다른 폴더 선택",
    back: "시작 화면으로",
    openAnother: "다른 저장소 열기",
    root: "저장소 root",
    currentBranch: "현재 branch",
    detached: "분리된 HEAD",
    noCommits: "아직 commit 없음",
    noCommitsDetail: "Forktail 밖에서 첫 commit을 만든 뒤 저장소를 다시 여세요.",
    linkedWorktree: "연결된 worktree",
    shallow: "Shallow history",
    localOnly: "로컬 snapshot 전용",
    readOnly: "읽기 전용 검토",
    readyPrompt: "검토할 로컬 revision 두 개를 선택하세요.",
    revisions: "Revision 비교",
  },
} as const;

export function GitCompareView({
  state,
  languageMode = "en",
  revisionReview,
  changedFilesReview,
  workingTreeReview,
  conflictReview,
  treePickerReview,
  onBack,
  onOpenRepository,
  onCancelOpen,
  onRevisionInputChange,
  onValidateRevision,
  onChangedFileFilterChange,
  onChangedFileStatusFilterChange,
  onChangedFileOpenModeChange,
  onSelectChangedFile,
  onLoadTrackedTrees,
  onCancelTrackedTrees,
  onCloseTrackedTrees,
  onTrackedTreeQueryChange,
  onSelectTrackedTreePath,
  onCompareTrackedTreePaths,
  onRefreshWorkingTree,
  onWorkingTreeFilterChange,
  onWorkingTreeSectionFilterChange,
  onWorkingTreeComparisonChange,
  onSelectWorkingTreeFile,
  onRefreshConflicts,
  onSelectConflict,
}: GitCompareViewProps) {
  const text = GIT_COMPARE_TEXT[languageMode];

  if (state.kind === "loading") {
    return (
      <main className="git-repository-shell" aria-label={text.aria} aria-busy="true">
        <section className="git-repository-state" role="status" aria-live="polite">
          <span className="eyebrow">{text.eyebrow}</span>
          <h1>{text.loading}</h1>
          <p>{text.loadingDetail}</p>
          <button type="button" onClick={onCancelOpen}>{text.cancelOpening}</button>
        </section>
      </main>
    );
  }

  if (state.kind === "error") {
    return (
      <main className="git-repository-shell" aria-label={text.aria}>
        <section className="git-repository-state" role="alert">
          <span className="eyebrow">{text.eyebrow}</span>
          <h1>{text.errorTitle}</h1>
          <p>{state.message}</p>
          <div className="git-repository-actions">
            <button type="button" onClick={onOpenRepository}>{text.chooseAnother}</button>
            <button type="button" onClick={onBack}>{text.back}</button>
          </div>
        </section>
      </main>
    );
  }

  const repository = state.repository;
  const head = repositoryHeadPresentation(repository, text);
  return (
    <main className="git-repository-shell" aria-label={text.aria}>
      <header className="git-repository-header">
        <div>
          <span className="eyebrow">{text.eyebrow}</span>
          <h1>{text.title}</h1>
          <code className="git-repository-root" title={repository.displayRoot}>
            {repository.displayRoot}
          </code>
        </div>
        <div className="git-repository-actions">
          <button type="button" onClick={onOpenRepository}>{text.openAnother}</button>
          <button type="button" onClick={onBack}>{text.back}</button>
        </div>
      </header>

      <section className="git-repository-summary" aria-label={text.aria}>
        <dl>
          <div>
            <dt>{text.root}</dt>
            <dd className="git-repository-root">{repository.displayRoot}</dd>
          </div>
          <div>
            <dt>{head.label}</dt>
            <dd>{head.value}</dd>
          </div>
        </dl>
        <div className="git-repository-badges">
          <span>{text.localOnly}</span>
          <span>{text.readOnly}</span>
          {repository.isLinkedWorktree && <span>{text.linkedWorktree}</span>}
          {repository.isShallow && <span>{text.shallow}</span>}
        </div>
      </section>

      {repository.head.kind !== "unborn"
        && conflictReview
        && conflictReview.state.kind !== "idle"
        && onRefreshConflicts
        && onSelectConflict && (
        <GitConflictView
          state={conflictReview.state}
          selectedKey={conflictReview.selectedKey}
          openState={conflictReview.openState}
          languageMode={languageMode}
          onRefresh={onRefreshConflicts}
          onSelect={onSelectConflict}
        />
      )}

      {repository.head.kind !== "unborn"
        && treePickerReview
        && onLoadTrackedTrees
        && onCancelTrackedTrees
        && onCloseTrackedTrees
        && onTrackedTreeQueryChange
        && onSelectTrackedTreePath
        && onCompareTrackedTreePaths && (
        <GitTreePicker
          state={treePickerReview.state}
          query={treePickerReview.query}
          leftSelection={treePickerReview.leftSelection}
          rightSelection={treePickerReview.rightSelection}
          openState={treePickerReview.openState}
          languageMode={languageMode}
          onLoad={onLoadTrackedTrees}
          onCancel={onCancelTrackedTrees}
          onClose={onCloseTrackedTrees}
          onQueryChange={onTrackedTreeQueryChange}
          onSelect={onSelectTrackedTreePath}
          onCompare={onCompareTrackedTreePaths}
        />
      )}

      {repository.head.kind !== "unborn"
        && workingTreeReview
        && workingTreeReview.state.kind !== "idle"
        && onRefreshWorkingTree
        && onWorkingTreeFilterChange
        && onWorkingTreeSectionFilterChange
        && onWorkingTreeComparisonChange
        && onSelectWorkingTreeFile && (
        <GitWorkingTreeFiles
          state={workingTreeReview.state}
          filter={workingTreeReview.filter}
          comparison={workingTreeReview.comparison}
          selectedKey={workingTreeReview.selectedKey}
          snapshotState={workingTreeReview.snapshotState}
          languageMode={languageMode}
          onRefresh={onRefreshWorkingTree}
          onFilterChange={onWorkingTreeFilterChange}
          onSectionFilterChange={onWorkingTreeSectionFilterChange}
          onComparisonChange={onWorkingTreeComparisonChange}
          onSelect={onSelectWorkingTreeFile}
        />
      )}

      {repository.head.kind === "unborn" ? (
        <section className="git-review-empty" role="status">
          <strong>{text.noCommits}</strong>
          <p>{text.noCommitsDetail}</p>
        </section>
      ) : revisionReview && onRevisionInputChange && onValidateRevision ? (
        <section className="git-revision-review" aria-label={text.revisions}>
          <h2>{text.revisions}</h2>
          <p>{text.readyPrompt}</p>
          <div className="git-revision-grid">
            <GitRevisionSelector
              side="left"
              repository={repository}
              references={revisionReview.references}
              state={revisionReview.left}
              languageMode={languageMode}
              onInputChange={(input) => onRevisionInputChange("left", input)}
              onSubmit={(input) => onValidateRevision("left", input)}
            />
            <GitRevisionSelector
              side="right"
              repository={repository}
              references={revisionReview.references}
              state={revisionReview.right}
              languageMode={languageMode}
              onInputChange={(input) => onRevisionInputChange("right", input)}
              onSubmit={(input) => onValidateRevision("right", input)}
            />
          </div>
          {revisionReview.pairError && (
            <p className="git-revision-pair-error" role="alert">
              {revisionReview.pairError}
            </p>
          )}
        </section>
      ) : (
        <section className="git-review-empty" role="status">
          <p>{text.readyPrompt}</p>
        </section>
      )}

      {repository.head.kind !== "unborn"
        && changedFilesReview
        && changedFilesReview.state.kind !== "idle"
        && onChangedFileFilterChange
        && onChangedFileStatusFilterChange
        && onSelectChangedFile && (
        <GitChangedFiles
          state={changedFilesReview.state}
          filter={changedFilesReview.filter}
          selectedKey={changedFilesReview.selectedKey}
          viewedKeys={changedFilesReview.viewedKeys}
          snapshotState={changedFilesReview.snapshotState}
          openMode={changedFilesReview.openMode}
          languageMode={languageMode}
          onFilterChange={onChangedFileFilterChange}
          onStatusFilterChange={onChangedFileStatusFilterChange}
          onOpenModeChange={onChangedFileOpenModeChange}
          onSelect={onSelectChangedFile}
        />
      )}
    </main>
  );
}

function repositoryHeadPresentation(
  repository: GitRepositorySummary,
  text: (typeof GIT_COMPARE_TEXT)[AppLanguage],
): { label: string; value: string } {
  if (repository.head.kind === "unborn") {
    return { label: text.currentBranch, value: text.noCommits };
  }
  if (repository.head.kind === "detached") {
    return {
      label: text.detached,
      value: shortObjectId(repository.head.objectId.hex),
    };
  }
  return {
    label: text.currentBranch,
    value: `${repository.head.displayName} · ${shortObjectId(repository.head.objectId.hex)}`,
  };
}

function shortObjectId(hex: string): string {
  return hex.slice(0, 12);
}
