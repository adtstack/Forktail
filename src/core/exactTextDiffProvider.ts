import type { Monaco } from "@monaco-editor/react";
import type { editor, Uri } from "monaco-editor";
import ExactTextDiffWorker from "./exactTextDiff.worker?worker";
import {
  hasComparisonIgnores,
  type ComparisonLineColumnMap,
  type TextDiffOptions,
} from "./diffOptions";
import type {
  ExactTextDiffWorkerChunk,
  ExactTextDiffWorkerResponse,
  ExactTextDiffWorkerRun,
  ExactTextDiffWorkerStart,
} from "./exactTextDiff.worker";

interface MonacoDiffOptions {
  maxComputationTimeMs?: number;
}

interface MonacoCancellationToken {
  isCancellationRequested: boolean;
  onCancellationRequested(listener: () => void): { dispose(): void };
}

interface MonacoDiffChange {
  original: object;
  modified: object;
  innerChanges?: readonly MonacoRangeMapping[];
}

interface MonacoRange {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

interface MonacoRangeMapping {
  originalRange: MonacoRange;
  modifiedRange: MonacoRange;
}

interface MonacoDocumentDiffResult {
  changes: MonacoDiffChange[];
  identical: boolean;
  quitEarly: boolean;
  moves: unknown[];
}

interface RegisteredExactTextDiff {
  token: symbol;
  originalModelPath: string;
  modifiedModelPath: string;
  left: string;
  right: string;
  options: TextDiffOptions;
  compareLineEndings: boolean;
}

interface InternalDiffProvider {
  computeDiff: NativeComputeDiff;
  onDidChangeEventEmitter?: { fire(): void };
}

interface InternalDiffProviderState {
  diffProvider: InternalDiffProvider;
}

interface InternalObservable<T> {
  get(): T;
}

interface InternalDiffViewModel {
  _diffProvider?: InternalObservable<InternalDiffProviderState | undefined>;
}

interface InternalDiffEditor {
  _diffModel?: InternalObservable<InternalDiffViewModel | undefined>;
}

interface ComparisonModels {
  original: editor.ITextModel;
  modified: editor.ITextModel;
  columnMaps: {
    original: ComparisonLineColumnMap[];
    modified: ComparisonLineColumnMap[];
  };
  dispose(): void;
}

interface LinkedCancellation {
  token: MonacoCancellationToken;
  cancel(): void;
  dispose(): void;
}

interface PatchedProviderState {
  activeCancellation: LinkedCancellation | null;
}

type NativeDiffOutcome =
  | { kind: "completed"; result: MonacoDocumentDiffResult }
  | { kind: "failed"; error: unknown }
  | { kind: "cancelled" };

export interface ExactTextDiffRegistration {
  readonly key: string;
  readonly token: symbol;
}

export interface ExactTextDiffSourceModelOwnership {
  dispose(): void;
}

type NativeComputeDiff = (
  original: editor.ITextModel,
  modified: editor.ITextModel,
  options: MonacoDiffOptions,
  cancellationToken: MonacoCancellationToken,
) => Promise<MonacoDocumentDiffResult>;

const registrations = new Map<string, RegisteredExactTextDiff>();
const monacoByEditor = new WeakMap<editor.IStandaloneDiffEditor, Monaco>();
const patchedProviders = new WeakMap<InternalDiffProvider, PatchedProviderState>();
const sourceModelOwnerCounts = new WeakMap<editor.ITextModel, number>();
const comparisonModelNamespace = Date.now().toString(36);
let nextRequestId = 1;
const TEXT_TRANSFER_CHUNK_SIZE = 256 * 1024;
const SOURCE_MODEL_DISPOSAL_RETRY_MS = 16;
const SOURCE_MODEL_DISPOSAL_RETRIES = 10;

/**
 * Patches only the provider already created by the mounted public Monaco instance. Loading the
 * provider's deep ESM module here would create a second service registry beside Vite's prebundle.
 */
export function attachExactTextDiff(
  instance: editor.IStandaloneDiffEditor,
  monaco: Monaco,
): void {
  monacoByEditor.set(instance, monaco);
  const provider = attachExactTextDiffProvider(instance, monaco);
  provider?.onDidChangeEventEmitter?.fire();
}

export function registerExactTextDiff(
  originalModelPath: string,
  modifiedModelPath: string,
  left: string,
  right: string,
  options: TextDiffOptions,
  compareLineEndings: boolean,
): ExactTextDiffRegistration {
  const key = modelPairKey(originalModelPath, modifiedModelPath);
  const token = Symbol("exact-text-diff");
  registrations.set(key, {
    token,
    originalModelPath,
    modifiedModelPath,
    left,
    right,
    options: { ...options },
    compareLineEndings,
  });
  return { key, token };
}

export function updateExactTextDiff(
  registration: ExactTextDiffRegistration,
  left: string,
  right: string,
  options: TextDiffOptions,
): void {
  const current = registrations.get(registration.key);
  if (current?.token !== registration.token) return;
  registrations.set(registration.key, {
    token: registration.token,
    originalModelPath: current.originalModelPath,
    modifiedModelPath: current.modifiedModelPath,
    left,
    right,
    options: { ...options },
    compareLineEndings: current.compareLineEndings,
  });
}

export function unregisterExactTextDiff(registration: ExactTextDiffRegistration): void {
  if (registrations.get(registration.key)?.token === registration.token) {
    registrations.delete(registration.key);
  }
}

export function refreshExactTextDiff(instance: editor.IStandaloneDiffEditor): void {
  const monaco = monacoByEditor.get(instance);
  if (!monaco) return;
  const provider = attachExactTextDiffProvider(instance, monaco);
  provider?.onDidChangeEventEmitter?.fire();
}

/**
 * Keeps source models alive while @monaco-editor/react tears down the owning diff widget first.
 * The wrapper's built-in cleanup disposes models before the widget on Monaco 0.55.1, which throws.
 */
export function retainExactTextDiffSourceModels(
  instance: editor.IStandaloneDiffEditor,
): ExactTextDiffSourceModelOwnership | null {
  const model = instance.getModel();
  if (!model) return null;
  const sourceModels = Array.from(new Set([model.original, model.modified]));
  for (const sourceModel of sourceModels) retainSourceModel(sourceModel);
  let disposed = false;

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const sourceModel of sourceModels) releaseSourceModel(sourceModel);
    },
  };
}

function attachExactTextDiffProvider(
  instance: editor.IStandaloneDiffEditor,
  monaco: Monaco,
): InternalDiffProvider | null {
  const internalEditor = instance as unknown as InternalDiffEditor;
  const provider = internalEditor._diffModel
    ?.get()
    ?._diffProvider
    ?.get()
    ?.diffProvider;
  if (!provider) return null;

  if (!patchedProviders.has(provider)) {
    const providerState: PatchedProviderState = { activeCancellation: null };
    const nativeComputeDiff = provider.computeDiff.bind(provider);
    provider.computeDiff = async (
      original,
      modified,
      options,
      cancellationToken,
    ): Promise<MonacoDocumentDiffResult> => {
      providerState.activeCancellation?.cancel();
      providerState.activeCancellation = null;
      const registration = registrationForModels(monaco, original.uri, modified.uri);
      if (
        !registration ||
        (!registration.compareLineEndings && !hasComparisonIgnores(registration.options))
      ) {
        return nativeComputeDiff(original, modified, options, cancellationToken);
      }
      if (cancellationToken.isCancellationRequested) return cancelledDiffResult();

      const requestCancellation = linkCancellationToken(cancellationToken);
      providerState.activeCancellation = requestCancellation;
      try {
        const comparisonModels = await createComparisonModelsInWorker(
          monaco,
          registration.left,
          registration.right,
          registration.options,
          requestCancellation.token,
        );
        if (!comparisonModels) return cancelledDiffResult();

        try {
          const nativeComputation = nativeComputeDiff(
            comparisonModels.original,
            comparisonModels.modified,
            options,
            requestCancellation.token,
          );
          // Monaco 0.55.1 commits every resolved async autorun, even after a newer provider run
          // starts. Settle the superseded wrapper at cancellation time instead of waiting for its
          // uncancellable editor-worker request to finish after the newest result.
          const outcome = await nativeDiffOutcomeOrCancellation(
            nativeComputation,
            requestCancellation.token,
          );
          if (outcome.kind === "cancelled") {
            return cancelledDiffResult();
          }
          if (outcome.kind === "failed") throw outcome.error;
          if (requestCancellation.token.isCancellationRequested) return cancelledDiffResult();
          return remapDiffResult(outcome.result, comparisonModels.columnMaps);
        } finally {
          comparisonModels.dispose();
        }
      } catch {
        return incompleteDiffResult();
      } finally {
        if (providerState.activeCancellation === requestCancellation) {
          providerState.activeCancellation = null;
        }
        requestCancellation.dispose();
      }
    };
    patchedProviders.set(provider, providerState);
  }

  return provider;
}

function createComparisonModelsInWorker(
  monaco: Monaco,
  left: string,
  right: string,
  options: TextDiffOptions,
  cancellationToken: MonacoCancellationToken,
): Promise<ComparisonModels | null> {
  const id = nextRequestId++;
  const modelPrefix = `inmemory://forktail/exact-diff/${comparisonModelNamespace}/${id}`;
  const original = monaco.editor.createModel(
    "",
    undefined,
    monaco.Uri.parse(`${modelPrefix}/original`),
  );
  const modified = monaco.editor.createModel(
    "",
    undefined,
    monaco.Uri.parse(`${modelPrefix}/modified`),
  );
  const comparisonModels: ComparisonModels = {
    original,
    modified,
    columnMaps: { original: [], modified: [] },
    dispose() {
      original.dispose();
      modified.dispose();
    },
  };
  const worker = new ExactTextDiffWorker();

  return new Promise((resolve, reject) => {
    let settled = false;
    let cancellation = { dispose: () => {} };
    let transferTimer: number | null = null;
    const finish = (result: ComparisonModels | null, error?: unknown) => {
      if (settled) return;
      settled = true;
      if (transferTimer !== null) window.clearTimeout(transferTimer);
      cancellation.dispose();
      worker.terminate();
      if (!result) comparisonModels.dispose();
      if (error) reject(error);
      else resolve(result);
    };
    cancellation = cancellationToken.onCancellationRequested(() => finish(null));
    if (settled) {
      cancellation.dispose();
      return;
    }

    worker.onmessage = (event: MessageEvent<ExactTextDiffWorkerResponse>) => {
      const response = event.data;
      if (response.id !== id) return;
      if (response.kind === "outputChunk") {
        try {
          appendModelText(
            response.side === "left" ? original : modified,
            response.text,
          );
        } catch (error) {
          finish(null, error);
        }
        return;
      }
      comparisonModels.columnMaps = {
        original: response.columnMaps.left,
        modified: response.columnMaps.right,
      };
      finish(comparisonModels);
    };
    worker.onerror = (event) => finish(
      null,
      event.error ?? new Error("Comparison worker failed."),
    );
    worker.postMessage({
      kind: "start",
      id,
      options,
    } satisfies ExactTextDiffWorkerStart);

    let side: "left" | "right" = "left";
    let offset = 0;
    const sendNextChunk = () => {
      if (settled) return;
      const source = side === "left" ? left : right;
      if (offset < source.length) {
        worker.postMessage({
          kind: "chunk",
          id,
          side,
          text: source.slice(offset, offset + TEXT_TRANSFER_CHUNK_SIZE),
        } satisfies ExactTextDiffWorkerChunk);
        offset += TEXT_TRANSFER_CHUNK_SIZE;
        transferTimer = window.setTimeout(sendNextChunk, 0);
        return;
      }
      if (side === "left") {
        side = "right";
        offset = 0;
        transferTimer = window.setTimeout(sendNextChunk, 0);
        return;
      }
      transferTimer = null;
      worker.postMessage({ kind: "run", id } satisfies ExactTextDiffWorkerRun);
    };
    sendNextChunk();
  });
}

function appendModelText(model: editor.ITextModel, text: string): void {
  const lineNumber = model.getLineCount();
  const column = model.getLineMaxColumn(lineNumber);
  model.applyEdits([{
    range: {
      startLineNumber: lineNumber,
      startColumn: column,
      endLineNumber: lineNumber,
      endColumn: column,
    },
    text,
  }]);
}

function remapDiffResult(
  result: MonacoDocumentDiffResult,
  columnMaps: ComparisonModels["columnMaps"],
): MonacoDocumentDiffResult {
  return {
    changes: result.changes.map((change) => remapDiffChange(change, columnMaps)),
    identical: result.identical,
    quitEarly: result.quitEarly,
    moves: [],
  };
}

function remapDiffChange(
  change: MonacoDiffChange,
  columnMaps: ComparisonModels["columnMaps"],
): MonacoDiffChange {
  if (!change.innerChanges) {
    return { original: change.original, modified: change.modified, innerChanges: undefined };
  }

  const innerChanges: MonacoRangeMapping[] = [];
  for (const innerChange of change.innerChanges) {
    const mapped = remapRangeMapping(innerChange, columnMaps);
    if (!mapped) {
      return { original: change.original, modified: change.modified, innerChanges: undefined };
    }
    innerChanges.push(mapped);
  }
  return { original: change.original, modified: change.modified, innerChanges };
}

function remapRangeMapping(
  mapping: MonacoRangeMapping,
  columnMaps: ComparisonModels["columnMaps"],
): MonacoRangeMapping | null {
  const originalRange = remapRange(mapping.originalRange, columnMaps.original);
  const modifiedRange = remapRange(mapping.modifiedRange, columnMaps.modified);
  if (!originalRange || !modifiedRange) return null;
  return cloneWithPrototype(mapping, { originalRange, modifiedRange });
}

function remapRange(
  range: MonacoRange,
  columnMaps: readonly ComparisonLineColumnMap[],
): MonacoRange | null {
  if (
    rangeTouchesSyntheticColumns(range, columnMaps) ||
    rangeCrossesRemovedSourceGap(range, columnMaps)
  ) return null;
  const empty = range.startLineNumber === range.endLineNumber &&
    range.startColumn === range.endColumn;
  const start = mapComparisonPosition(
    range.startLineNumber,
    range.startColumn,
    columnMaps,
    "start",
  );
  if (!start) return null;
  const end = empty
    ? start
    : mapComparisonPosition(
        range.endLineNumber,
        range.endColumn,
        columnMaps,
        "end",
      );
  if (!end || start.lineNumber > end.lineNumber) return null;
  if (start.lineNumber === end.lineNumber && start.column > end.column) return null;

  return cloneWithPrototype(range, {
    startLineNumber: start.lineNumber,
    startColumn: start.column,
    endLineNumber: end.lineNumber,
    endColumn: end.column,
  });
}

function rangeCrossesRemovedSourceGap(
  range: MonacoRange,
  columnMaps: readonly ComparisonLineColumnMap[],
): boolean {
  for (let lineNumber = range.startLineNumber; lineNumber <= range.endLineNumber; lineNumber += 1) {
    const lineMap = columnMaps[lineNumber - 1];
    if (!lineMap) return true;
    const start = lineNumber === range.startLineNumber ? range.startColumn - 1 : 0;
    const end = lineNumber === range.endLineNumber
      ? range.endColumn - 1
      : lineMap.comparisonContentLength;
    for (let index = 1; index < lineMap.segments.length; index += 1) {
      const previous = lineMap.segments[index - 1];
      const next = lineMap.segments[index];
      if (
        previous &&
        next &&
        previous.comparisonEnd === next.comparisonStart &&
        previous.sourceEnd < next.sourceStart &&
        start < next.comparisonStart &&
        next.comparisonStart < end
      ) return true;
    }
  }
  return false;
}

function rangeTouchesSyntheticColumns(
  range: MonacoRange,
  columnMaps: readonly ComparisonLineColumnMap[],
): boolean {
  if (
    range.startLineNumber < 1 ||
    range.endLineNumber < range.startLineNumber ||
    range.endLineNumber > columnMaps.length
  ) return true;

  for (let lineNumber = range.startLineNumber; lineNumber <= range.endLineNumber; lineNumber += 1) {
    const lineMap = columnMaps[lineNumber - 1];
    if (!lineMap) return true;
    const start = lineNumber === range.startLineNumber ? range.startColumn - 1 : 0;
    const end = lineNumber === range.endLineNumber
      ? range.endColumn - 1
      : lineMap.comparisonLength;
    if (start < 0 || end < start || end > lineMap.comparisonLength) return true;
    if (
      Math.max(start, lineMap.comparisonContentLength) <
      Math.min(end, lineMap.comparisonLength)
    ) return true;
  }
  return false;
}

function mapComparisonPosition(
  lineNumber: number,
  column: number,
  columnMaps: readonly ComparisonLineColumnMap[],
  bias: "start" | "end",
): { lineNumber: number; column: number } | null {
  const lineMap = columnMaps[lineNumber - 1];
  const comparisonOffset = column - 1;
  if (
    !lineMap?.exact ||
    comparisonOffset < 0 ||
    comparisonOffset > lineMap.comparisonContentLength
  ) return null;

  for (const segment of lineMap.segments) {
    if (
      segment.comparisonStart < comparisonOffset &&
      comparisonOffset < segment.comparisonEnd
    ) {
      const comparisonLength = segment.comparisonEnd - segment.comparisonStart;
      const sourceLength = segment.sourceEnd - segment.sourceStart;
      if (comparisonLength !== sourceLength) return null;
      return {
        lineNumber,
        column: segment.sourceStart + comparisonOffset - segment.comparisonStart + 1,
      };
    }
  }

  if (bias === "start") {
    const next = lineMap.segments.find((segment) =>
      segment.comparisonStart === comparisonOffset
    );
    if (next) return { lineNumber, column: next.sourceStart + 1 };
    if (comparisonOffset === lineMap.comparisonContentLength) {
      return { lineNumber, column: lineMap.sourceLength + 1 };
    }
    const previous = lastSegmentEndingAt(lineMap.segments, comparisonOffset);
    return previous ? { lineNumber, column: previous.sourceEnd + 1 } : null;
  }

  const previous = lastSegmentEndingAt(lineMap.segments, comparisonOffset);
  if (previous) return { lineNumber, column: previous.sourceEnd + 1 };
  if (comparisonOffset === 0) return { lineNumber, column: 1 };
  const next = lineMap.segments.find((segment) =>
    segment.comparisonStart === comparisonOffset
  );
  return next ? { lineNumber, column: next.sourceStart + 1 } : null;
}

function lastSegmentEndingAt(
  segments: readonly ComparisonLineColumnMap["segments"][number][],
  comparisonOffset: number,
): ComparisonLineColumnMap["segments"][number] | undefined {
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index];
    if (segment?.comparisonEnd === comparisonOffset) return segment;
  }
  return undefined;
}

function cloneWithPrototype<T extends object>(template: T, values: Partial<T>): T {
  return Object.assign(
    Object.create(Object.getPrototypeOf(template)) as object,
    values,
  ) as T;
}

function registrationForModels(
  monaco: Monaco,
  original: Uri,
  modified: Uri,
): RegisteredExactTextDiff | undefined {
  const originalValue = original.toString(true);
  const modifiedValue = modified.toString(true);
  return Array.from(registrations.values()).find((registration) =>
    monaco.Uri.parse(registration.originalModelPath).toString(true) === originalValue &&
    monaco.Uri.parse(registration.modifiedModelPath).toString(true) === modifiedValue
  );
}

function modelPairKey(original: string, modified: string): string {
  return `${original.length}:${original}${modified}`;
}

function cancelledDiffResult(): MonacoDocumentDiffResult {
  return { changes: [], identical: false, quitEarly: true, moves: [] };
}

function incompleteDiffResult(): MonacoDocumentDiffResult {
  return { changes: [], identical: false, quitEarly: true, moves: [] };
}

function retainSourceModel(model: editor.ITextModel): void {
  sourceModelOwnerCounts.set(model, (sourceModelOwnerCounts.get(model) ?? 0) + 1);
}

function releaseSourceModel(model: editor.ITextModel): void {
  const owners = sourceModelOwnerCounts.get(model) ?? 0;
  if (owners > 1) {
    sourceModelOwnerCounts.set(model, owners - 1);
    return;
  }
  sourceModelOwnerCounts.delete(model);
  scheduleReleasedSourceModelDisposal(model, 0);
}

function scheduleReleasedSourceModelDisposal(
  model: editor.ITextModel,
  retry: number,
): void {
  globalThis.setTimeout(() => {
    if ((sourceModelOwnerCounts.get(model) ?? 0) > 0 || model.isDisposed()) return;
    if (model.isAttachedToEditor()) {
      if (retry < SOURCE_MODEL_DISPOSAL_RETRIES) {
        scheduleReleasedSourceModelDisposal(model, retry + 1);
      }
      return;
    }
    model.dispose();
  }, retry === 0 ? 0 : SOURCE_MODEL_DISPOSAL_RETRY_MS);
}

function nativeDiffOutcomeOrCancellation(
  computation: Promise<MonacoDocumentDiffResult>,
  cancellationToken: MonacoCancellationToken,
): Promise<NativeDiffOutcome> {
  return new Promise((resolve) => {
    let settled = false;
    let cancellation = { dispose() {} };
    const finish = (outcome: NativeDiffOutcome) => {
      if (settled) return;
      settled = true;
      cancellation.dispose();
      resolve(outcome);
    };

    computation.then(
      (result) => finish({ kind: "completed", result }),
      (error: unknown) => finish({ kind: "failed", error }),
    );
    cancellation = cancellationToken.onCancellationRequested(
      () => finish({ kind: "cancelled" }),
    );
    if (settled) cancellation.dispose();
    else if (cancellationToken.isCancellationRequested) finish({ kind: "cancelled" });
  });
}

function linkCancellationToken(parent: MonacoCancellationToken): LinkedCancellation {
  const listeners = new Set<() => void>();
  let cancelled = parent.isCancellationRequested;

  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    for (const listener of listeners) listener();
    listeners.clear();
  };
  const parentSubscription = parent.onCancellationRequested(cancel);
  if (parent.isCancellationRequested) cancel();

  return {
    token: {
      get isCancellationRequested() {
        return cancelled || parent.isCancellationRequested;
      },
      onCancellationRequested(listener) {
        if (cancelled || parent.isCancellationRequested) {
          listener();
          return { dispose() {} };
        }
        listeners.add(listener);
        return { dispose: () => listeners.delete(listener) };
      },
    },
    cancel,
    dispose() {
      parentSubscription.dispose();
      listeners.clear();
    },
  };
}
