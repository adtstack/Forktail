/// <reference types="node" />

import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  comparisonTextWithColumnMaps,
  DEFAULT_TEXT_DIFF_OPTIONS,
  type ComparisonLineColumnMap,
  type TextDiffOptions,
} from "./diffOptions";

interface MockWorkerInstance {
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: { error: Error }) => void) | null;
  requests: unknown[];
  terminated: boolean;
  complete(
    leftText: string,
    rightText?: string,
    columnMaps?: {
      left: ComparisonLineColumnMap[];
      right: ComparisonLineColumnMap[];
    },
  ): void;
  fail(error: Error): void;
}

const workerHarness = vi.hoisted(() => ({
  instances: [] as MockWorkerInstance[],
}));

vi.mock("./exactTextDiff.worker?worker", () => ({
  default: class MockExactTextDiffWorker implements MockWorkerInstance {
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onerror: ((event: { error: Error }) => void) | null = null;
    requests: unknown[] = [];
    terminated = false;

    constructor() {
      workerHarness.instances.push(this);
    }

    postMessage(request: unknown) {
      this.requests.push(request);
    }

    terminate() {
      this.terminated = true;
    }

    complete(
      leftText: string,
      rightText = leftText,
      columnMaps?: {
        left: ComparisonLineColumnMap[];
        right: ComparisonLineColumnMap[];
      },
    ) {
      if (this.terminated) return;
      const start = this.requests.find((request) =>
        isRecord(request) && request.kind === "start"
      );
      if (!isRecord(start) || typeof start.id !== "number") {
        throw new Error("Worker start request was not received.");
      }
      this.onmessage?.({
        data: { kind: "outputChunk", id: start.id, side: "left", text: leftText },
      });
      this.onmessage?.({
        data: { kind: "outputChunk", id: start.id, side: "right", text: rightText },
      });
      const identityMap = (text: string): ComparisonLineColumnMap => ({
        sourceLength: text.length,
        comparisonContentLength: text.length,
        comparisonLength: text.length,
        exact: true,
        segments: text.length === 0 ? [] : [{
          comparisonStart: 0,
          comparisonEnd: text.length,
          sourceStart: 0,
          sourceEnd: text.length,
        }],
      });
      this.onmessage?.({
        data: {
          kind: "complete",
          id: start.id,
          columnMaps: columnMaps ?? {
            left: [identityMap(leftText)],
            right: [identityMap(rightText)],
          },
        },
      });
    }

    fail(error: Error) {
      if (this.terminated) return;
      this.onerror?.({ error });
    }
  },
}));

import {
  attachExactTextDiff,
  refreshExactTextDiff,
  registerExactTextDiff,
  retainExactTextDiffSourceModels,
  unregisterExactTextDiff,
  updateExactTextDiff,
} from "./exactTextDiffProvider";

const providerSource = readFileSync(
  new URL("./exactTextDiffProvider.ts", import.meta.url),
  "utf8",
);
const workerSource = readFileSync(
  new URL("./exactTextDiff.worker.ts", import.meta.url),
  "utf8",
);
const compareViewSource = readFileSync(
  new URL("../components/FileCompareView.tsx", import.meta.url),
  "utf8",
);

const testOptions = {
  ...DEFAULT_TEXT_DIFF_OPTIONS,
  ignoreCase: true,
};

interface FakeModel {
  uri: { toString(skipEncoding?: boolean): string };
  value: string;
  attached: boolean;
  disposed: boolean;
  disposeCalls: number;
  getLineCount(): number;
  getLineMaxColumn(lineNumber: number): number;
  getValue(): string;
  applyEdits(edits: readonly { text: string }[]): void;
  isAttachedToEditor(): boolean;
  isDisposed(): boolean;
  dispose(): void;
}

interface FakeRange {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

interface FakeInnerChange {
  originalRange: FakeRange;
  modifiedRange: FakeRange;
}

class FakeRangePrototype implements FakeRange {
  constructor(
    public startLineNumber: number,
    public startColumn: number,
    public endLineNumber: number,
    public endColumn: number,
  ) {}
}

class FakeRangeMappingPrototype implements FakeInnerChange {
  constructor(
    public originalRange: FakeRange,
    public modifiedRange: FakeRange,
  ) {}
}

interface FakeDiffChange {
  original: { label: string };
  modified: { label: string };
  innerChanges?: FakeInnerChange[];
}

interface FakeDiffResult {
  changes: FakeDiffChange[];
  identical: boolean;
  quitEarly: boolean;
  moves: unknown[];
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function fakeUri(value: string) {
  return { toString: () => value };
}

function fakeModel(path: string, initialValue = ""): FakeModel {
  return {
    uri: fakeUri(path),
    value: initialValue,
    attached: false,
    disposed: false,
    disposeCalls: 0,
    getLineCount() {
      return this.value.split("\n").length;
    },
    getLineMaxColumn(lineNumber) {
      return (this.value.split("\n")[lineNumber - 1] ?? "").length + 1;
    },
    getValue() {
      return this.value;
    },
    applyEdits(edits) {
      this.value += edits.map((edit) => edit.text).join("");
    },
    isAttachedToEditor() {
      return this.attached;
    },
    isDisposed() {
      return this.disposed;
    },
    dispose() {
      this.disposed = true;
      this.disposeCalls += 1;
    },
  };
}

function fakeMonaco() {
  return {
    Uri: { parse: (value: string) => fakeUri(value) },
    editor: {
      createModel: (_value: string, _language: undefined, uri: ReturnType<typeof fakeUri>) =>
        fakeModel(uri.toString()),
    },
  } as unknown as Parameters<typeof attachExactTextDiff>[1];
}

function activeCancellationToken() {
  const listeners = new Set<() => void>();
  let cancelled = false;
  return {
    token: {
      get isCancellationRequested() {
        return cancelled;
      },
      onCancellationRequested(listener: () => void) {
        listeners.add(listener);
        return { dispose: () => listeners.delete(listener) };
      },
    },
    cancel() {
      cancelled = true;
      for (const listener of listeners) listener();
      listeners.clear();
    },
  };
}

function nativeResult(label: string): FakeDiffResult {
  return {
    changes: [{ original: { label }, modified: { label } }],
    identical: false,
    quitEarly: false,
    moves: [],
  };
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function fakeRange(
  startColumn: number,
  endColumn: number,
  lineNumber = 1,
): FakeRange {
  return {
    startLineNumber: lineNumber,
    startColumn,
    endLineNumber: lineNumber,
    endColumn,
  };
}

function innerChange(
  originalRange: FakeRange,
  modifiedRange: FakeRange,
): FakeInnerChange {
  return { originalRange, modifiedRange };
}

async function mappedProviderResult({
  left,
  right,
  options,
  compareLineEndings = false,
  changes,
}: {
  left: string;
  right: string;
  options: TextDiffOptions;
  compareLineEndings?: boolean;
  changes: FakeDiffChange[];
}): Promise<FakeDiffResult> {
  const sequence = workerHarness.instances.length + 20;
  const originalPath = `forktail://original/${sequence}/view/left.txt`;
  const modifiedPath = `forktail://modified/${sequence}/view/right.txt`;
  const registration = registerExactTextDiff(
    originalPath,
    modifiedPath,
    left,
    right,
    options,
    compareLineEndings,
  );
  const harness = privateEditorHarness(async () => ({
    changes,
    identical: false,
    quitEarly: false,
    moves: [],
  }));
  attachExactTextDiff(harness.instance, fakeMonaco());
  const computation = computeWithProvider(harness.provider, originalPath, modifiedPath);
  await transferAllText();
  const leftComparison = comparisonTextWithColumnMaps(left, options);
  const rightComparison = comparisonTextWithColumnMaps(right, options);
  workerHarness.instances.at(-1)?.complete(
    leftComparison.lines.join("\n"),
    rightComparison.lines.join("\n"),
    {
      left: leftComparison.columnMaps,
      right: rightComparison.columnMaps,
    },
  );
  const result = await computation;
  unregisterExactTextDiff(registration);
  return result;
}

function privateEditorHarness(
  nativeCompute: (
    original: FakeModel,
    modified: FakeModel,
  ) => Promise<FakeDiffResult>,
  onFire?: () => void,
) {
  const provider = {
    computeDiff: nativeCompute,
    onDidChangeEventEmitter: { fire: vi.fn(() => onFire?.()) },
  };
  const instance = {
    _diffModel: {
      get: () => ({
        _diffProvider: { get: () => ({ diffProvider: provider }) },
      }),
    },
  } as unknown as Parameters<typeof attachExactTextDiff>[0];
  return { instance, provider };
}

function computeWithProvider(
  provider: ReturnType<typeof privateEditorHarness>["provider"],
  originalPath: string,
  modifiedPath: string,
) {
  const cancellation = activeCancellationToken();
  const computeDiff = provider.computeDiff as unknown as (
    original: FakeModel,
    modified: FakeModel,
    options: Record<string, never>,
    token: typeof cancellation.token,
  ) => Promise<FakeDiffResult>;
  return computeDiff(
    fakeModel(originalPath),
    fakeModel(modifiedPath),
    {},
    cancellation.token,
  );
}

async function transferAllText() {
  await vi.runAllTimersAsync();
}

let previousWindowDescriptor: PropertyDescriptor | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  workerHarness.instances.length = 0;
  previousWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: globalThis,
  });
});

afterEach(() => {
  vi.useRealTimers();
  if (previousWindowDescriptor) {
    Object.defineProperty(globalThis, "window", previousWindowDescriptor);
  } else {
    Reflect.deleteProperty(globalThis, "window");
  }
});

describe("exact-text Monaco provider integration", () => {
  it("defers source-model disposal until the widget detaches the last owner", async () => {
    const original = fakeModel("forktail://original/ownership");
    const modified = fakeModel("forktail://modified/ownership");
    original.attached = true;
    modified.attached = true;
    const instance = {
      getModel: () => ({ original, modified }),
    } as unknown as Parameters<typeof retainExactTextDiffSourceModels>[0];
    const ownership = retainExactTextDiffSourceModels(instance);

    ownership?.dispose();
    await vi.advanceTimersByTimeAsync(0);
    expect(original.disposeCalls).toBe(0);
    expect(modified.disposeCalls).toBe(0);

    original.attached = false;
    modified.attached = false;
    await vi.runAllTimersAsync();
    expect(original.disposeCalls).toBe(1);
    expect(modified.disposeCalls).toBe(1);
  });

  it("does not dispose a source model reused before deferred cleanup", async () => {
    const original = fakeModel("forktail://original/reused");
    const modified = fakeModel("forktail://modified/reused");
    const instance = {
      getModel: () => ({ original, modified }),
    } as unknown as Parameters<typeof retainExactTextDiffSourceModels>[0];
    const first = retainExactTextDiffSourceModels(instance);
    first?.dispose();
    const reused = retainExactTextDiffSourceModels(instance);

    await vi.runAllTimersAsync();
    expect(original.disposeCalls).toBe(0);
    expect(modified.disposeCalls).toBe(0);

    reused?.dispose();
    await vi.runAllTimersAsync();
    expect(original.disposeCalls).toBe(1);
    expect(modified.disposeCalls).toBe(1);
  });

  it("reuses the mounted public Monaco graph instead of loading deep runtime modules", () => {
    expect(providerSource).not.toMatch(
      /from\s+["']monaco-editor\/esm\/vs\//,
    );
    expect(providerSource).toContain("export function attachExactTextDiff(");
    expect(compareViewSource).toContain("attachExactTextDiff(instance, monaco)");
  });

  it("builds comparison-only text off the main thread and leaves source models untouched", () => {
    expect(workerSource).toContain("comparisonTextWithColumnMaps");
    expect(providerSource).toMatch(/monaco\.editor\.createModel\(\s*""/);
    expect(providerSource).not.toMatch(/\.(?:setValue|executeEdits)\(registration\.(?:left|right)/);
    expect(compareViewSource).toContain("original={session.left.text}");
    expect(compareViewSource).toContain("modified={session.right.text}");
  });

  it("invalidates the initial native diff after mount attachment", async () => {
    const originalPath = "forktail://original/1/view/left.txt";
    const modifiedPath = "forktail://modified/1/view/right.txt";
    const registration = registerExactTextDiff(
      originalPath,
      modifiedPath,
      "VALUE\n",
      "value\n",
      testOptions,
      false,
    );
    const nativeCompute = vi.fn(async (original: FakeModel) =>
      nativeResult(original.getValue() || "native")
    );
    let lifecycleComputation: Promise<FakeDiffResult> | undefined;
    let provider!: ReturnType<typeof privateEditorHarness>["provider"];
    const harness = privateEditorHarness(nativeCompute, () => {
      lifecycleComputation = computeWithProvider(provider, originalPath, modifiedPath);
    });
    provider = harness.provider;

    attachExactTextDiff(harness.instance, fakeMonaco());
    await transferAllText();

    expect(provider.onDidChangeEventEmitter.fire).toHaveBeenCalledOnce();
    expect(lifecycleComputation).toBeDefined();
    expect(workerHarness.instances).toHaveLength(1);
    workerHarness.instances[0].complete("initial-custom");
    await expect(lifecycleComputation).resolves.toMatchObject({
      changes: [{ original: { label: "initial-custom" } }],
    });
    expect(nativeCompute.mock.calls[0]?.[0].uri.toString()).toContain(
      "inmemory://forktail/exact-diff/",
    );
    unregisterExactTextDiff(registration);
  });

  it("remounts and attaches the provider to a changed model URI pair", async () => {
    expect(compareViewSource).toContain("key={diffEditorModelKey}");

    const mountPair = async (
      originalPath: string,
      modifiedPath: string,
      label: string,
    ) => {
      const registration = registerExactTextDiff(
        originalPath,
        modifiedPath,
        `${label.toUpperCase()}\n`,
        `${label.toLowerCase()}\n`,
        testOptions,
        false,
      );
      const nativeCompute = vi.fn(async (original: FakeModel) =>
        nativeResult(original.getValue() || "native")
      );
      let lifecycleComputation: Promise<FakeDiffResult> | undefined;
      let provider!: ReturnType<typeof privateEditorHarness>["provider"];
      const harness = privateEditorHarness(nativeCompute, () => {
        lifecycleComputation = computeWithProvider(provider, originalPath, modifiedPath);
      });
      provider = harness.provider;

      attachExactTextDiff(harness.instance, fakeMonaco());
      await transferAllText();
      workerHarness.instances.at(-1)?.complete(label);

      await expect(lifecycleComputation).resolves.toMatchObject({
        changes: [{ original: { label } }],
      });
      expect(nativeCompute.mock.calls[0]?.[0].uri.toString()).toContain(
        "inmemory://forktail/exact-diff/",
      );
      unregisterExactTextDiff(registration);
    };

    await mountPair(
      "forktail://original/1/view/left.txt",
      "forktail://modified/1/view/right.txt",
      "old-pair",
    );
    await mountPair(
      "forktail://original/2/edit-left/left.txt",
      "forktail://modified/2/edit-left/right.txt",
      "new-pair",
    );
    expect(workerHarness.instances).toHaveLength(2);
  });

  it("supersedes an older comparison before it can overwrite the newest result", async () => {
    const originalPath = "forktail://original/3/view/left.txt";
    const modifiedPath = "forktail://modified/3/view/right.txt";
    const registration = registerExactTextDiff(
      originalPath,
      modifiedPath,
      "old\n",
      "OLD\n",
      testOptions,
      false,
    );
    const nativeCompute = vi.fn(async (original: FakeModel) =>
      nativeResult(original.getValue() || "native")
    );
    const harness = privateEditorHarness(nativeCompute);
    attachExactTextDiff(harness.instance, fakeMonaco());

    const commits: string[] = [];
    const oldComputation = computeWithProvider(harness.provider, originalPath, modifiedPath);
    void oldComputation.then((result) => {
      commits.push(result.quitEarly ? "superseded" : result.changes[0]?.original.label ?? "empty");
    });
    await transferAllText();

    updateExactTextDiff(registration, "new\n", "NEW\n", testOptions);
    const newComputation = computeWithProvider(harness.provider, originalPath, modifiedPath);
    void newComputation.then((result) => {
      commits.push(result.quitEarly ? "superseded" : result.changes[0]?.original.label ?? "empty");
    });
    await transferAllText();

    expect(workerHarness.instances).toHaveLength(2);
    workerHarness.instances[1].complete("newest");
    await newComputation;
    workerHarness.instances[0].complete("stale");
    await oldComputation;
    await Promise.resolve();

    expect(commits).toEqual(["superseded", "newest"]);
    expect(nativeCompute).toHaveBeenCalledOnce();
    unregisterExactTextDiff(registration);
  });

  it("settles a superseded hidden-native request before the newer result can commit", async () => {
    const originalPath = "forktail://original/31/view/left.txt";
    const modifiedPath = "forktail://modified/31/view/right.txt";
    const registration = registerExactTextDiff(
      originalPath,
      modifiedPath,
      "old\n",
      "OLD\n",
      testOptions,
      false,
    );
    const nativeComputations: Deferred<FakeDiffResult>[] = [];
    const nativeCompute = vi.fn(() => {
      const computation = deferred<FakeDiffResult>();
      nativeComputations.push(computation);
      return computation.promise;
    });
    const harness = privateEditorHarness(nativeCompute);
    attachExactTextDiff(harness.instance, fakeMonaco());

    const commits: string[] = [];
    const oldComputation = computeWithProvider(harness.provider, originalPath, modifiedPath);
    void oldComputation.then((result) => {
      commits.push(result.quitEarly ? "superseded" : result.changes[0]?.original.label ?? "empty");
    });
    await transferAllText();
    workerHarness.instances[0].complete("old-hidden");
    await Promise.resolve();
    expect(nativeComputations).toHaveLength(1);

    updateExactTextDiff(registration, "new\n", "NEW\n", testOptions);
    const newComputation = computeWithProvider(harness.provider, originalPath, modifiedPath);
    void newComputation.then((result) => {
      commits.push(result.quitEarly ? "superseded" : result.changes[0]?.original.label ?? "empty");
    });
    await transferAllText();
    workerHarness.instances[1].complete("new-hidden");
    await Promise.resolve();

    expect(commits).toEqual(["superseded"]);
    expect(nativeComputations).toHaveLength(2);
    nativeComputations[1].resolve(nativeResult("newest"));
    await newComputation;
    nativeComputations[0].resolve(nativeResult("stale"));
    await oldComputation;
    await Promise.resolve();

    expect(commits).toEqual(["superseded", "newest"]);
    unregisterExactTextDiff(registration);
  });

  it("returns an explicit incomplete result when comparison preparation fails", async () => {
    const originalPath = "forktail://original/4/view/left.txt";
    const modifiedPath = "forktail://modified/4/view/right.txt";
    const registration = registerExactTextDiff(
      originalPath,
      modifiedPath,
      "A\n",
      "a\n",
      testOptions,
      false,
    );
    const nativeCompute = vi.fn(async () => nativeResult("silent-native-fallback"));
    const harness = privateEditorHarness(nativeCompute);
    attachExactTextDiff(harness.instance, fakeMonaco());

    const computation = computeWithProvider(harness.provider, originalPath, modifiedPath);
    await transferAllText();
    workerHarness.instances[0].fail(new Error("worker unavailable"));

    await expect(computation).resolves.toEqual({
      changes: [],
      identical: false,
      quitEarly: true,
      moves: [],
    });
    expect(nativeCompute).not.toHaveBeenCalled();
    unregisterExactTextDiff(registration);
  });

  it("preserves word-level ranges for a simple case-only comparison", async () => {
    const nativeMapping = new FakeRangeMappingPrototype(
      new FakeRangePrototype(1, 5, 1, 6),
      new FakeRangePrototype(1, 5, 1, 6),
    );
    const result = await mappedProviderResult({
      left: "Alpha",
      right: "Alphi",
      options: { ...DEFAULT_TEXT_DIFF_OPTIONS, ignoreCase: true },
      changes: [{
        original: { label: "case-original" },
        modified: { label: "case-modified" },
        innerChanges: [nativeMapping],
      }],
    });

    expect(result.changes[0]?.innerChanges).toEqual([
      innerChange(fakeRange(5, 6), fakeRange(5, 6)),
    ]);
    expect(result.changes[0]?.innerChanges?.[0]).toBeInstanceOf(
      FakeRangeMappingPrototype,
    );
    expect(result.changes[0]?.innerChanges?.[0]?.originalRange).toBeInstanceOf(
      FakeRangePrototype,
    );
  });

  it("maps shifted word ranges around ignored whitespace back to source columns", async () => {
    const result = await mappedProviderResult({
      left: "a  VALUE",
      right: "a other",
      options: {
        ...DEFAULT_TEXT_DIFF_OPTIONS,
        whitespace: "all",
        ignoreCase: true,
      },
      changes: [{
        original: { label: "space-original" },
        modified: { label: "space-modified" },
        innerChanges: [innerChange(fakeRange(2, 7), fakeRange(2, 7))],
      }],
    });

    expect(result.changes[0]?.innerChanges).toEqual([
      innerChange(fakeRange(4, 9), fakeRange(3, 8)),
    ]);
  });

  it("degrades a word range that would include an ignored source gap", async () => {
    const result = await mappedProviderResult({
      left: "ab cd",
      right: "ax yd",
      options: { ...DEFAULT_TEXT_DIFF_OPTIONS, whitespace: "all" },
      changes: [{
        original: { label: "gap-original" },
        modified: { label: "gap-modified" },
        innerChanges: [innerChange(fakeRange(2, 5), fakeRange(2, 5))],
      }],
    });

    expect(result.changes[0]?.innerChanges).toBeUndefined();
  });

  it("degrades only the hunk that cuts through a Unicode lowercase expansion", async () => {
    const result = await mappedProviderResult({
      left: "A\n\u0130X",
      right: "B\nix",
      options: {
        ...DEFAULT_TEXT_DIFF_OPTIONS,
        ignoreCase: true,
        ignoreLineEndings: true,
      },
      changes: [
        {
          original: { label: "safe-original" },
          modified: { label: "safe-modified" },
          innerChanges: [innerChange(fakeRange(1, 2), fakeRange(1, 2))],
        },
        {
          original: { label: "expanded-original" },
          modified: { label: "expanded-modified" },
          innerChanges: [innerChange(
            fakeRange(2, 3, 2),
            fakeRange(2, 2, 2),
          )],
        },
      ],
    });

    expect(result.changes[0]?.innerChanges).toEqual([
      innerChange(fakeRange(1, 2), fakeRange(1, 2)),
    ]);
    expect(result.changes[1]?.innerChanges).toBeUndefined();
  });

  it("maps insertion and deletion anchors across removed whitespace", async () => {
    const result = await mappedProviderResult({
      left: "a  b\nx  OLDy",
      right: "a  NEWb\nx  y",
      options: {
        ...DEFAULT_TEXT_DIFF_OPTIONS,
        whitespace: "all",
        ignoreCase: true,
        ignoreLineEndings: true,
      },
      changes: [
        {
          original: { label: "insert-original" },
          modified: { label: "insert-modified" },
          innerChanges: [innerChange(
            fakeRange(2, 2),
            fakeRange(2, 5),
          )],
        },
        {
          original: { label: "delete-original" },
          modified: { label: "delete-modified" },
          innerChanges: [innerChange(
            fakeRange(2, 5, 2),
            fakeRange(2, 2, 2),
          )],
        },
      ],
    });

    expect(result.changes[0]?.innerChanges).toEqual([
      innerChange(fakeRange(4, 4), fakeRange(4, 7)),
    ]);
    expect(result.changes[1]?.innerChanges).toEqual([
      innerChange(fakeRange(4, 7, 2), fakeRange(4, 4, 2)),
    ]);
  });

  it("degrades synthetic EOL marker ranges to line-level safely", async () => {
    const result = await mappedProviderResult({
      left: "same\r\n",
      right: "same\n",
      options: DEFAULT_TEXT_DIFF_OPTIONS,
      compareLineEndings: true,
      changes: [{
        original: { label: "crlf" },
        modified: { label: "lf" },
        innerChanges: [innerChange(fakeRange(5, 10), fakeRange(5, 8))],
      }],
    });

    expect(result.changes[0]?.innerChanges).toBeUndefined();
  });

  it("patches a replacement private provider before refreshing it", () => {
    const first = privateEditorHarness(async () => nativeResult("first"));
    const second = privateEditorHarness(async () => nativeResult("second"));
    let currentProvider = first.provider;
    const instance = {
      _diffModel: {
        get: () => ({
          _diffProvider: { get: () => ({ diffProvider: currentProvider }) },
        }),
      },
    } as unknown as Parameters<typeof attachExactTextDiff>[0];
    const monaco = fakeMonaco();

    attachExactTextDiff(instance, monaco);
    currentProvider = second.provider;
    refreshExactTextDiff(instance);

    expect(first.provider.onDidChangeEventEmitter.fire).toHaveBeenCalledOnce();
    expect(second.provider.onDidChangeEventEmitter.fire).toHaveBeenCalledOnce();
  });
});
