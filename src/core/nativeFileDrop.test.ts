import { describe, expect, it, vi } from "vitest";
import tauriConfig from "../../src-tauri/tauri.conf.json";
import {
  mountNativeFileDropListener,
  nativeFileDropFromPayload,
  routeNativeFileDrop,
  type NativeFileDrop,
  type NativeFileDropListener,
} from "./nativeFileDrop";

const drop: NativeFileDrop = {
  paths: ["/workspace/left.txt", "/workspace/right.txt"],
  position: { x: 300, y: 120 },
};

describe("native file-drop payload adaptation", () => {
  it("keeps Tauri native file-drop enabled for Windows and the packaged app", () => {
    expect(tauriConfig.app.windows[0]?.dragDropEnabled).toBe(true);
  });

  it("accepts only Tauri drop payloads and preserves cross-platform paths", () => {
    expect(nativeFileDropFromPayload({
      type: "drop",
      paths: [
        " /tmp/left.txt ",
        "C:\\Temp\\right.txt",
        "\\\\server\\share\\third.txt",
        "   ",
        "",
      ],
      position: { x: 40, y: 80 },
    })).toEqual({
      paths: [
        " /tmp/left.txt ",
        "C:\\Temp\\right.txt",
        "\\\\server\\share\\third.txt",
        "   ",
      ],
      position: { x: 40, y: 80 },
    });

    expect(nativeFileDropFromPayload({
      type: "enter",
      paths: ["/tmp/left.txt"],
      position: { x: 40, y: 80 },
    })).toBeNull();
    expect(nativeFileDropFromPayload({
      type: "leave",
    })).toBeNull();
  });
});

describe("native file-drop routing", () => {
  it("routes a home drop to the two-file compare entry point", () => {
    expect(routeNativeFileDrop({
      mode: "home",
      busy: false,
      drop,
      devicePixelRatio: 2,
      compareTargets: [],
    })).toEqual({
      kind: "startCompare",
      paths: drop.paths,
    });
  });

  it("maps physical Tauri coordinates to the matching compare side", () => {
    const compareTargets = [
      { side: "left" as const, left: 100, top: 40, right: 300, bottom: 100 },
      { side: "right" as const, left: 300, top: 40, right: 500, bottom: 100 },
    ];

    expect(routeNativeFileDrop({
      mode: "compare",
      busy: false,
      drop: { ...drop, paths: ["C:\\Temp\\replacement.txt"] },
      devicePixelRatio: 2,
      compareTargets,
    })).toEqual({
      kind: "replaceCompareSide",
      side: "left",
      paths: ["C:\\Temp\\replacement.txt"],
    });

    expect(routeNativeFileDrop({
      mode: "compare",
      busy: false,
      drop: { ...drop, position: { x: 700, y: 120 } },
      devicePixelRatio: 2,
      compareTargets,
    })).toEqual({
      kind: "replaceCompareSide",
      side: "right",
      paths: drop.paths,
    });
  });

  it("ignores busy, unsupported-screen, and out-of-target drops", () => {
    const compareTargets = [
      { side: "left" as const, left: 100, top: 40, right: 300, bottom: 100 },
    ];
    const request = {
      mode: "compare" as const,
      busy: false,
      drop,
      devicePixelRatio: 2,
      compareTargets,
    };

    expect(routeNativeFileDrop({ ...request, busy: true })).toBeNull();
    expect(routeNativeFileDrop({ ...request, mode: "folders" })).toBeNull();
    expect(routeNativeFileDrop({
      ...request,
      drop: { ...drop, position: { x: 20, y: 20 } },
    })).toBeNull();
  });
});

describe("native file-drop listener lifecycle", () => {
  it("unlistens exactly once after a mounted subscription is disposed", async () => {
    const unlisten = vi.fn();
    const subscribe: NativeFileDropListener = vi.fn(async () => unlisten);
    const dispose = mountNativeFileDropListener(subscribe, vi.fn());

    await Promise.resolve();
    dispose();
    dispose();

    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it("cleans up a late subscription and suppresses callbacks after disposal", async () => {
    const subscription: {
      resolve?: (unlisten: () => void) => void;
      handler?: (event: NativeFileDrop) => void;
    } = {};
    const unlisten = vi.fn();
    const handler = vi.fn();
    const subscribe: NativeFileDropListener = (nextHandler) => {
      subscription.handler = nextHandler;
      return new Promise((resolve) => {
        subscription.resolve = resolve;
      });
    };

    const dispose = mountNativeFileDropListener(subscribe, handler);
    dispose();
    subscription.handler?.(drop);
    subscription.resolve?.(unlisten);
    await Promise.resolve();

    expect(handler).not.toHaveBeenCalled();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });
});
