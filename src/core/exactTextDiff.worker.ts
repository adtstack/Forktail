import {
  comparisonTextWithColumnMaps,
  type ComparisonLineColumnMap,
  type TextDiffOptions,
} from "./diffOptions";

export interface ExactTextDiffWorkerStart {
  kind: "start";
  id: number;
  options: TextDiffOptions;
}

export interface ExactTextDiffWorkerChunk {
  kind: "chunk";
  id: number;
  side: "left" | "right";
  text: string;
}

export interface ExactTextDiffWorkerRun {
  kind: "run";
  id: number;
}

export type ExactTextDiffWorkerRequest =
  | ExactTextDiffWorkerStart
  | ExactTextDiffWorkerChunk
  | ExactTextDiffWorkerRun;

export interface ExactTextDiffWorkerOutputChunk {
  kind: "outputChunk";
  id: number;
  side: "left" | "right";
  text: string;
}

export interface ExactTextDiffWorkerComplete {
  kind: "complete";
  id: number;
  columnMaps: {
    left: ComparisonLineColumnMap[];
    right: ComparisonLineColumnMap[];
  };
}

export type ExactTextDiffWorkerResponse =
  | ExactTextDiffWorkerOutputChunk
  | ExactTextDiffWorkerComplete;

interface WorkerScope {
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<ExactTextDiffWorkerRequest>) => void,
  ): void;
  postMessage(message: ExactTextDiffWorkerResponse): void;
}

const workerScope = self as unknown as WorkerScope;
let activeRequest: {
  id: number;
  left: string[];
  right: string[];
  options: TextDiffOptions;
} | null = null;
const OUTPUT_CHUNK_SIZE = 256 * 1024;

workerScope.addEventListener("message", (event) => {
  const request = event.data;
  if (request.kind === "start") {
    activeRequest = {
      id: request.id,
      left: [],
      right: [],
      options: request.options,
    };
    return;
  }
  if (!activeRequest || activeRequest.id !== request.id) return;
  if (request.kind === "chunk") {
    activeRequest[request.side].push(request.text);
    return;
  }

  const left = comparisonTextWithColumnMaps(
    activeRequest.left.join(""),
    activeRequest.options,
  );
  const right = comparisonTextWithColumnMaps(
    activeRequest.right.join(""),
    activeRequest.options,
  );
  postComparisonText(request.id, "left", left.lines.join("\n"));
  postComparisonText(request.id, "right", right.lines.join("\n"));
  workerScope.postMessage({
    kind: "complete",
    id: request.id,
    columnMaps: { left: left.columnMaps, right: right.columnMaps },
  });
  activeRequest = null;
});

function postComparisonText(
  id: number,
  side: "left" | "right",
  comparisonText: string,
): void {
  for (let offset = 0; offset < comparisonText.length; offset += OUTPUT_CHUNK_SIZE) {
    workerScope.postMessage({
      kind: "outputChunk",
      id,
      side,
      text: comparisonText.slice(offset, offset + OUTPUT_CHUNK_SIZE),
    });
  }
}
