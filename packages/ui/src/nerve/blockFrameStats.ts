// Dev instrumentation: measures WHAT ONE LANDED BLOCK COSTS THE MAIN THREAD.
// A block lands as a short sequence of main-thread tasks, and the frame it
// falls into is only as long as the longest of them:
//   1. the WORKER LANDING TASK — the topology worker's `built` message
//      handler, plus the promise chain it resolves (a microtask, so still the
//      same task): the graph swap, the topology apply and the fabric commit;
//   2. the BRIDGE FRAMES the arming commit defers to — host sync, selection
//      and the stroke reconcile, one step per frame from the first frame
//      where the fabric of the version that landing published has itself
//      landed. `bridgeMs` is the SUM of the three, which is what the class
//      costs a block; `bridgeStepMaxMs` is the longest single step, which is
//      what any one frame actually carries;
//   3. the rAF INTERVAL that contained the landing — the frame before it to
//      the frame after, which is what a viewer actually sees.
// Each is a wall-clock reading of a task, not a CPU probe: `beginCpuProbe`
// spans are opt-in and disabled on the ordinary dashboard, and the whole
// point here is a gauge a live pass can read off a release build. Cost is one
// `performance.now()` per landing, one per bridge frame, and one per frame.
//
// Pure module singleton — same idiom as `pulseStats` / `fabricStats`: read and
// mutated directly, reset by tests. The WINDOW hook that surfaces it lives in
// ui-app, so the library stays free of `window` coupling.

/** Wall-clock reading for one landed topology build. `bridgeMs` is stamped by
 *  the bridge sequence that follows the landing (0 until it finishes),
 *  `frameGapMs` starts as the gap since the frame BEFORE the landing and is
 *  finalised by the frame after it. */
export interface BlockFrameSample {
  /** `performance.now()` at the end of the landing task. */
  atMs: number;
  landingMs: number;
  /** Every bridge step of this build, added up. */
  bridgeMs: number;
  /** The longest single bridge step of this build — the reading that says
   *  what ONE frame carried, and the one the sustain wave is graded on. */
  bridgeStepMaxMs: number;
  frameGapMs: number;
}

export interface BlockFrameStatsSnapshot {
  /** Landings recorded since reset (one ring entry each). */
  count: number;
  /** Bridge frame bodies timed since reset — normally one per landing, but
   *  an anchor change arms one without a build behind it. */
  bridgeCount: number;
  /** Last N landings, oldest first. */
  recent: BlockFrameSample[];
  /** All-time maxima since reset — the numbers the wave is graded on. */
  max: {
    landingMs: number;
    bridgeMs: number;
    bridgeStepMaxMs: number;
    frameGapMs: number;
  };
}

/** Ring capacity: 32 landings ≈ four minutes of mainnet, which is the window
 *  a live pass reads after a reset. */
export const BLOCK_FRAME_RING_CAPACITY = 32;

/** The clock every reading here shares. Exported so the callers that time a
 *  span themselves (the bridge frame) cannot drift into another domain. */
export function blockFrameNowMs(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}

/** Open mark taken at the worker message handler's entry. Null between
 *  landings: a handler that returns early clears it, so a later
 *  `observeLanding` can never be measured from a task it did not belong to. */
let landingStartedAtMs: number | null = null;
/** The most recent frame callback's timestamp. */
let lastFrameAtMs: number | null = null;
/** The entry whose `frameGapMs` the NEXT frame finalises, and the frame it is
 *  measured from (the last frame BEFORE the landing). */
let pendingGapEntry: BlockFrameSample | null = null;
let pendingGapFromMs = 0;

interface BlockFrameStatsState {
  count: number;
  bridgeCount: number;
  recent: BlockFrameSample[];
  max: BlockFrameStatsSnapshot['max'];
  /** Worker message handler entry. */
  markLandingStart(atMs?: number): void;
  /** A handler path that applied nothing — stale, failed, a superseded
   *  request, a response the caller's guards rejected. */
  discardLanding(): void;
  /** End of the fabric commit: the landing task is over. Ignored when no
   *  start mark is open (cooperative main-thread recovery has no Worker
   *  message-handler landing task). */
  observeLanding(atMs?: number): void;
  /** One finished bridge sequence: the sum of its steps, and its longest
   *  single step (defaulting to the sum, which is what a one-step build
   *  costs). */
  observeBridge(elapsedMs: number, stepMaxMs?: number): void;
  /** One rAF callback. Finalises a pending entry's frame gap, then becomes
   *  the reference for the next landing. Allocation-free. */
  markFrame(atMs?: number): void;
  snapshot(): BlockFrameStatsSnapshot;
  reset(): void;
}

export const blockFrameStats: BlockFrameStatsState = {
  count: 0,
  bridgeCount: 0,
  recent: [],
  max: { landingMs: 0, bridgeMs: 0, bridgeStepMaxMs: 0, frameGapMs: 0 },

  markLandingStart(atMs = blockFrameNowMs()) {
    landingStartedAtMs = atMs;
  },

  discardLanding() {
    landingStartedAtMs = null;
  },

  observeLanding(atMs = blockFrameNowMs()) {
    const startedAtMs = landingStartedAtMs;
    landingStartedAtMs = null;
    if (startedAtMs === null) return;
    const landingMs = Math.max(0, atMs - startedAtMs);
    // The gap SO FAR, so a landing whose next frame never comes (a tab going
    // hidden, an unmount) still leaves an honest lower bound in the ring.
    const gapSoFar = lastFrameAtMs === null
      ? 0
      : Math.max(0, atMs - lastFrameAtMs);
    const entry: BlockFrameSample = {
      atMs,
      landingMs,
      bridgeMs: 0,
      bridgeStepMaxMs: 0,
      frameGapMs: gapSoFar,
    };
    this.recent.push(entry);
    if (this.recent.length > BLOCK_FRAME_RING_CAPACITY) this.recent.shift();
    this.count += 1;
    if (landingMs > this.max.landingMs) this.max.landingMs = landingMs;
    if (gapSoFar > this.max.frameGapMs) this.max.frameGapMs = gapSoFar;
    pendingGapEntry = entry;
    pendingGapFromMs = lastFrameAtMs ?? atMs;
  },

  observeBridge(elapsedMs, stepMaxMs = elapsedMs) {
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return;
    const stepMax = Number.isFinite(stepMaxMs) && stepMaxMs >= 0
      ? stepMaxMs
      : elapsedMs;
    this.bridgeCount += 1;
    if (elapsedMs > this.max.bridgeMs) this.max.bridgeMs = elapsedMs;
    if (stepMax > this.max.bridgeStepMaxMs) {
      this.max.bridgeStepMaxMs = stepMax;
    }
    // Stamped onto the landing it followed. A bridge run with no landing
    // behind it (an anchor change) still moves the maxima, which is the
    // reading T5 and T5b are graded on.
    const entry = this.recent[this.recent.length - 1];
    if (entry !== undefined) {
      entry.bridgeMs = elapsedMs;
      entry.bridgeStepMaxMs = stepMax;
    }
  },

  markFrame(atMs = blockFrameNowMs()) {
    const entry = pendingGapEntry;
    if (entry !== null) {
      pendingGapEntry = null;
      const gapMs = Math.max(0, atMs - pendingGapFromMs);
      entry.frameGapMs = gapMs;
      if (gapMs > this.max.frameGapMs) this.max.frameGapMs = gapMs;
    }
    lastFrameAtMs = atMs;
  },

  snapshot() {
    return {
      count: this.count,
      bridgeCount: this.bridgeCount,
      recent: this.recent.map((sample) => ({ ...sample })),
      max: { ...this.max },
    };
  },

  reset() {
    this.count = 0;
    this.bridgeCount = 0;
    this.recent = [];
    this.max = { landingMs: 0, bridgeMs: 0, bridgeStepMaxMs: 0, frameGapMs: 0 };
    landingStartedAtMs = null;
    lastFrameAtMs = null;
    pendingGapEntry = null;
    pendingGapFromMs = 0;
  },
};

export function snapshotBlockFrameStats(): BlockFrameStatsSnapshot {
  return blockFrameStats.snapshot();
}
export function resetBlockFrameStats(): void {
  blockFrameStats.reset();
}
