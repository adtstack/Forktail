import { getCurrentWindow, type DragDropEvent } from "@tauri-apps/api/window";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { isTauriRuntime } from "./bridge";
import type { CompareDropSide } from "./dropPaths";
import type { AppMode } from "./models";

export interface NativeFileDrop {
  paths: string[];
  position: {
    x: number;
    y: number;
  };
}

export interface CompareDropTargetRect {
  side: CompareDropSide;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export type NativeFileDropRoute =
  | {
      kind: "startCompare";
      paths: string[];
    }
  | {
      kind: "replaceCompareSide";
      side: CompareDropSide;
      paths: string[];
    };

export interface NativeFileDropRouteRequest {
  mode: AppMode;
  busy: boolean;
  drop: NativeFileDrop;
  devicePixelRatio: number;
  compareTargets: readonly CompareDropTargetRect[];
}

type NativeDragDropPayload =
  | DragDropEvent
  | {
      type: string;
      paths?: readonly unknown[];
      position?: { x?: unknown; y?: unknown };
    };

export type NativeFileDropListener = (
  handler: (drop: NativeFileDrop) => void,
) => Promise<UnlistenFn | null>;

export function nativeFileDropFromPayload(
  payload: NativeDragDropPayload,
): NativeFileDrop | null {
  if (payload.type !== "drop") return null;
  const x = payload.position?.x;
  const y = payload.position?.y;
  if (
    typeof x !== "number"
    || !Number.isFinite(x)
    || typeof y !== "number"
    || !Number.isFinite(y)
  ) return null;

  return {
    paths: Array.isArray(payload.paths)
      ? payload.paths
          .filter((path): path is string => typeof path === "string")
          .filter((path) => path.length > 0)
      : [],
    position: { x, y },
  };
}

export function routeNativeFileDrop(
  request: NativeFileDropRouteRequest,
): NativeFileDropRoute | null {
  if (request.busy) return null;
  if (request.mode === "home") {
    return { kind: "startCompare", paths: request.drop.paths };
  }
  if (request.mode !== "compare") return null;

  const ratio = Number.isFinite(request.devicePixelRatio) && request.devicePixelRatio > 0
    ? request.devicePixelRatio
    : 1;
  const x = request.drop.position.x / ratio;
  const y = request.drop.position.y / ratio;
  const target = request.compareTargets.find((candidate) =>
    x >= candidate.left
    && x < candidate.right
    && y >= candidate.top
    && y < candidate.bottom);
  if (!target) return null;

  return {
    kind: "replaceCompareSide",
    side: target.side,
    paths: request.drop.paths,
  };
}

export const listenForNativeFileDrops: NativeFileDropListener = async (handler) => {
  if (!isTauriRuntime()) return null;
  return getCurrentWindow().onDragDropEvent((event) => {
    const drop = nativeFileDropFromPayload(event.payload);
    if (drop) handler(drop);
  });
};

export function mountNativeFileDropListener(
  subscribe: NativeFileDropListener,
  handler: (drop: NativeFileDrop) => void,
): () => void {
  let active = true;
  let unlisten: UnlistenFn | null = null;

  void subscribe((drop) => {
    if (active) handler(drop);
  }).then((nextUnlisten) => {
    if (!nextUnlisten) return;
    if (!active) {
      nextUnlisten();
      return;
    }
    unlisten = nextUnlisten;
  }).catch(() => {});

  return () => {
    if (!active) return;
    active = false;
    const currentUnlisten = unlisten;
    unlisten = null;
    currentUnlisten?.();
  };
}
