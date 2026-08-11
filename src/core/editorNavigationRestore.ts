import {
  navigationTargetsEqual,
  type EditorPaneId,
  type EditorNavigationHistory,
  type NavigationInputSource,
  type NavigationLocation,
  type NavigationTarget,
} from "./editorNavigationHistory";

export interface NavigationRestoreContext {
  blockingModal: boolean;
  nativeDialogOpen: boolean;
}

export type NavigationRestoreResolution = "mounted" | "reopen" | "stale" | "blockedDirty";
export type NavigationRestoreOpenResult = "opened" | "stale" | "cancelled" | "failed";
export type NavigationRestoreMountedResult = "restored" | "stale" | "failed";

export type NavigationRestoreOutcome =
  | {
      kind: "restored";
      status: "restored";
      staleDiscarded: number;
      durationMs: number;
    }
  | { kind: "empty"; status: "empty" }
  | { kind: "allStale"; status: "allStale"; staleDiscarded: number }
  | { kind: "blockedModal"; status: "blockedModal" }
  | { kind: "blockedDirty"; status: "blockedDirty" }
  | { kind: "inFlight"; status: "inFlight" }
  | { kind: "cancelled"; status: "cancelled" }
  | { kind: "failed"; status: "failed" };

export interface EditorNavigationRestoreCoordinatorOptions {
  history: EditorNavigationHistory;
  resolve: (location: NavigationLocation) => NavigationRestoreResolution;
  restoreMounted: (location: NavigationLocation) => NavigationRestoreMountedResult;
  open: (
    location: NavigationLocation,
    requestId: number,
  ) => Promise<NavigationRestoreOpenResult>;
  cancelOpen: (requestId: number) => void;
  onProgress?: (active: boolean) => void;
  now?: () => number;
  setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
}

type PendingMountResult = NavigationRestoreMountedResult | "cancelled";

interface PendingRestore {
  requestId: number;
  location: NavigationLocation;
  invocationId: number;
  progressShown: boolean;
  progressTimer: ReturnType<typeof setTimeout>;
  cancelPromise: Promise<"cancelled">;
  resolveCancel: (result: "cancelled") => void;
  mountPromise: Promise<PendingMountResult>;
  resolveMount: (result: PendingMountResult) => void;
  settledMount: boolean;
  cancelled: boolean;
}

export class EditorNavigationRestoreCoordinator {
  readonly history: EditorNavigationHistory;
  private readonly resolveCandidate: EditorNavigationRestoreCoordinatorOptions["resolve"];
  private readonly restoreMountedCandidate: EditorNavigationRestoreCoordinatorOptions["restoreMounted"];
  private readonly openCandidate: EditorNavigationRestoreCoordinatorOptions["open"];
  private readonly cancelOpenCandidate: EditorNavigationRestoreCoordinatorOptions["cancelOpen"];
  private readonly onProgress: (active: boolean) => void;
  private readonly now: () => number;
  private readonly setTimer: EditorNavigationRestoreCoordinatorOptions["setTimer"];
  private readonly clearTimer: EditorNavigationRestoreCoordinatorOptions["clearTimer"];
  private pending: PendingRestore | null = null;

  constructor(options: EditorNavigationRestoreCoordinatorOptions) {
    this.history = options.history;
    this.resolveCandidate = options.resolve;
    this.restoreMountedCandidate = options.restoreMounted;
    this.openCandidate = options.open;
    this.cancelOpenCandidate = options.cancelOpen;
    this.onProgress = options.onProgress ?? (() => {});
    this.now = options.now ?? defaultNow;
    this.setTimer = options.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer));
  }

  availability(context: NavigationRestoreContext): boolean {
    if (context.blockingModal || context.nativeDialogOpen || this.pending) return false;
    return this.history.hasValidCandidate((location) => {
      const resolution = this.resolveCandidate(location);
      if (resolution === "stale") return "stale";
      if (resolution === "blockedDirty") return "blocked";
      return "valid";
    });
  }

  async navigateBack(
    source: NavigationInputSource,
    context: NavigationRestoreContext,
  ): Promise<NavigationRestoreOutcome> {
    if (context.blockingModal || context.nativeDialogOpen) {
      return { kind: "blockedModal", status: "blockedModal" };
    }
    if (this.pending) return { kind: "inFlight", status: "inFlight" };

    const startedAt = this.now();
    let staleDiscarded = 0;
    while (true) {
      const candidate = this.history.reserveNewestValid(source, (location) => {
        const resolution = this.resolveCandidate(location);
        if (resolution === "stale") return "stale";
        if (resolution === "blockedDirty") return "blocked";
        return "valid";
      });
      if (candidate.kind === "inFlight") return { kind: "inFlight", status: "inFlight" };
      staleDiscarded += candidate.staleDiscarded;
      if (candidate.kind === "empty") {
        return staleDiscarded > 0
          ? { kind: "allStale", status: "allStale", staleDiscarded }
          : { kind: "empty", status: "empty" };
      }
      if (candidate.kind === "blocked") {
        return { kind: "blockedDirty", status: "blockedDirty" };
      }

      const resolution = this.resolveCandidate(candidate.location);
      if (resolution === "stale") {
        this.history.discardReservedAsStale(candidate.reservation.invocationId);
        staleDiscarded += 1;
        continue;
      }
      if (resolution === "blockedDirty") {
        this.history.releaseReservation(candidate.reservation.invocationId);
        return { kind: "blockedDirty", status: "blockedDirty" };
      }
      if (resolution === "mounted") {
        const restored = this.history.withReplay(() =>
          this.restoreMountedCandidate(candidate.location)
        );
        if (restored === "stale") {
          this.history.discardReservedAsStale(candidate.reservation.invocationId);
          staleDiscarded += 1;
          continue;
        }
        if (restored === "failed") {
          this.history.releaseReservation(candidate.reservation.invocationId);
          return { kind: "failed", status: "failed" };
        }
        this.history.commitReservation(candidate.reservation.invocationId);
        return {
          kind: "restored",
          status: "restored",
          staleDiscarded,
          durationMs: Math.max(0, this.now() - startedAt),
        };
      }

      const pending = this.createPending(candidate.location, candidate.reservation.invocationId);
      this.pending = pending;
      let opened: NavigationRestoreOpenResult | "cancelled";
      try {
        opened = await Promise.race([
          this.openCandidate(candidate.location, pending.requestId),
          pending.cancelPromise,
        ]);
      } catch {
        opened = "failed";
      }

      if (opened === "cancelled" || pending.cancelled) {
        this.finishPending(pending);
        return { kind: "cancelled", status: "cancelled" };
      }
      if (opened === "stale") {
        this.history.discardReservedAsStale(candidate.reservation.invocationId);
        this.finishPending(pending);
        staleDiscarded += 1;
        continue;
      }
      if (opened === "failed") {
        this.history.releaseReservation(candidate.reservation.invocationId);
        this.finishPending(pending);
        return { kind: "failed", status: "failed" };
      }

      const mounted = await Promise.race([pending.mountPromise, pending.cancelPromise]);
      if (mounted === "cancelled" || pending.cancelled) {
        this.finishPending(pending);
        return { kind: "cancelled", status: "cancelled" };
      }
      if (mounted === "stale") {
        this.history.discardReservedAsStale(candidate.reservation.invocationId);
        this.finishPending(pending);
        staleDiscarded += 1;
        continue;
      }
      if (mounted === "failed") {
        this.history.releaseReservation(candidate.reservation.invocationId);
        this.finishPending(pending);
        return { kind: "failed", status: "failed" };
      }

      this.history.commitReservation(candidate.reservation.invocationId);
      this.finishPending(pending);
      return {
        kind: "restored",
        status: "restored",
        staleDiscarded,
        durationMs: Math.max(0, this.now() - startedAt),
      };
    }
  }

  acknowledgeMounted(
    target: NavigationTarget,
    pane: EditorPaneId,
    restore: (location: NavigationLocation) => NavigationRestoreMountedResult,
  ): boolean {
    const pending = this.pending;
    if (
      !pending
      || pending.cancelled
      || pending.settledMount
      || pending.location.pane !== pane
      || !navigationTargetsEqual(pending.location.target, target)
    ) {
      return false;
    }
    pending.settledMount = true;
    const result = this.history.withReplay(() => restore(pending.location));
    pending.resolveMount(result);
    return true;
  }

  cancel(): boolean {
    const pending = this.pending;
    if (!pending || pending.cancelled) return false;
    pending.cancelled = true;
    this.history.releaseReservation(pending.invocationId);
    this.cancelOpenCandidate(pending.requestId);
    pending.resolveCancel("cancelled");
    if (!pending.settledMount) {
      pending.settledMount = true;
      pending.resolveMount("cancelled");
    }
    return true;
  }

  isInFlight(): boolean {
    return this.pending != null;
  }

  private createPending(location: NavigationLocation, invocationId: number): PendingRestore {
    let resolveCancel!: PendingRestore["resolveCancel"];
    let resolveMount!: PendingRestore["resolveMount"];
    const cancelPromise = new Promise<"cancelled">((resolve) => { resolveCancel = resolve; });
    const mountPromise = new Promise<PendingMountResult>((resolve) => { resolveMount = resolve; });
    const pending: PendingRestore = {
      requestId: invocationId,
      location,
      invocationId,
      progressShown: false,
      progressTimer: undefined as unknown as ReturnType<typeof setTimeout>,
      cancelPromise,
      resolveCancel,
      mountPromise,
      resolveMount,
      settledMount: false,
      cancelled: false,
    };
    pending.progressTimer = this.setTimer?.(() => {
      if (this.pending !== pending || pending.cancelled) return;
      pending.progressShown = true;
      this.onProgress(true);
    }, 100) as ReturnType<typeof setTimeout>;
    return pending;
  }

  private finishPending(pending: PendingRestore): void {
    this.clearTimer?.(pending.progressTimer);
    if (pending.progressShown) this.onProgress(false);
    if (this.pending === pending) this.pending = null;
  }
}

function defaultNow(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}
