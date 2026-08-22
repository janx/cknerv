import { createContext, useContext, useSyncExternalStore } from 'react';
import { PROBE_STEP_S, probeScan } from './probeScan';

/**
 * The clock the CELL SCAN reveal walks on.
 *
 * The walk itself is fixed geometry — 0.3s per landmark, every gate in the
 * dossier a threshold on it — but the dossier is a 1500-line card, and holding
 * that tick as state at the top of it re-ran the whole body (the DECODE
 * rebuild, the 32 hex spans of content memory, every plate and every ghost)
 * 12.5 times a second for the ~2.4s a click costs, on the thread that feeds
 * WebGL. So the tick lives out here instead: one interval per open panel,
 * published to whoever asked for the exact slice they read. A leaf that reads
 * `classified` re-renders once, a leaf that rides the sweep percentage
 * re-renders per tick, and the card between them renders when its DATA
 * changes — never because a clock moved.
 *
 * The same pattern as the portrait inset channel (a plain store + a
 * `useSyncExternalStore` subscription), scoped to one panel instead of to the
 * module, because the review labs mount more than one card at a time.
 */

/** The tick the smooth half of the reveal is drawn on. It is also the CSS
 *  transition the beam interpolates between two of these positions with, so
 *  the two numbers are one number. */
export const SCAN_TICK_MS = 80;

export interface CellScanFrame {
  /** Steps the probe has lit, NOT clamped at the last landmark: the single
   *  monotone counter every staged gate in the card is a threshold on. The six
   *  identity facts are steps 1..6; enrichment context is step 7 and enrichment
   *  depth step 8. */
  lit: number;
  /** The lattice has locked. That is the end of the WALK (six landmarks), not
   *  the moment the sixth light came on — the last landmark lights 55% into
   *  its own step and the walk runs to the end of it. */
  classified: boolean;
  /** Sweep position in whole percent. */
  pct: number;
  /** 0..1 completion the memory pieces (content, causal lens, trace) ride. */
  memoryProgress: number;
}

/** No walk in progress: everything is read. This is what reduced motion gets,
 *  what a card rendered outside a panel gets, and where every walk ends. */
export const SETTLED_SCAN_FRAME: CellScanFrame = {
  // Past every gate any card can express, so `lit >= step` is true for all of
  // them without the reader having to know how many steps this card has.
  lit: Number.MAX_SAFE_INTEGER,
  classified: true,
  pct: 100,
  memoryProgress: 1,
};

function nowPerf(): number {
  return typeof performance !== 'undefined' ? performance.now() : 0;
}

/** The frame at one instant — pure, so the walk's arithmetic is testable
 *  without a renderer, and so nothing about WHEN the tick happens can change
 *  WHAT it says. Note what is absent: the number of steps the card will end up
 *  showing. The walk's end moves when late enrichment adds its two steps; its
 *  start, and therefore everything already lit, does not. */
export function cellScanFrameAt(
  epochMs: number,
  nowMs: number,
  landmarks: number,
  reduced: boolean,
): CellScanFrame {
  if (reduced) return SETTLED_SCAN_FRAME;
  const scan = probeScan(epochMs, nowMs, landmarks, false);
  const stepped = Math.max(
    0,
    Math.floor((nowMs - epochMs) / (PROBE_STEP_S * 1000) + 0.45),
  );
  return {
    lit: scan.classified ? Math.max(landmarks, stepped) : scan.reveal,
    classified: scan.classified,
    pct: scan.pct,
    memoryProgress: scan.classified
      ? 1
      : Math.max(0, Math.min(1, scan.pct / 100)),
  };
}

function sameFrame(a: CellScanFrame, b: CellScanFrame): boolean {
  return a.lit === b.lit
    && a.classified === b.classified
    && a.pct === b.pct
    && a.memoryProgress === b.memoryProgress;
}

export interface CellScanClock {
  /** The current frame. Its IDENTITY is the change signal: an unchanged tick
   *  publishes nothing, so a subscriber reading the whole frame still sleeps
   *  through the frames that said the same thing. */
  readonly frame: CellScanFrame;
  subscribe: (listener: () => void) => () => void;
  /** Point the clock at a walk WITHOUT waking anybody. Called while the card
   *  is rendering, where that render is itself what delivers the new frame to
   *  every leaf — so the first paint of a selection is its first step, never
   *  the last frame of the selection before it. */
  prime: (epochMs: number, landmarks: number, reduced: boolean) => void;
  /** Run the primed walk: publish and tick until it ends. */
  run: () => void;
  /** Move where the walk STOPS ticking without touching where it started —
   *  enrichment that lands mid-walk extends the tail, it does not replay the
   *  lattice the reader already watched light. */
  setSteps: (steps: number) => void;
  stop: () => void;
}

export function createCellScanClock(): CellScanClock {
  const listeners = new Set<() => void>();
  let frame: CellScanFrame = SETTLED_SCAN_FRAME;
  let epochMs = 0;
  let landmarks = 1;
  let steps = 1;
  let reduced = true;
  let timer: ReturnType<typeof setInterval> | null = null;

  const stopTimer = () => {
    if (timer === null) return;
    clearInterval(timer);
    timer = null;
  };

  const publish = (next: CellScanFrame) => {
    if (sameFrame(frame, next)) return;
    frame = next;
    listeners.forEach((listener) => listener());
  };

  const walkEndsAtMs = () => epochMs + steps * PROBE_STEP_S * 1000;

  const sample = () => {
    const atMs = nowPerf();
    publish(cellScanFrameAt(epochMs, atMs, landmarks, reduced));
    // The walk runs once and holds its end state: past the last step there is
    // nothing left to say, so the interval retires itself rather than waiting
    // on a second timer to come and clear it.
    if (atMs >= walkEndsAtMs()) stopTimer();
  };

  const arm = () => {
    stopTimer();
    if (reduced) return;
    if (typeof setInterval !== 'function') return;   // test-safe
    if (nowPerf() >= walkEndsAtMs()) return;
    timer = setInterval(sample, SCAN_TICK_MS);
  };

  return {
    get frame() { return frame; },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    prime: (nextEpochMs: number, nextLandmarks: number, nextReduced: boolean) => {
      epochMs = nextEpochMs;
      landmarks = nextLandmarks;
      reduced = nextReduced;
      // A walk always covers its landmarks; how far PAST them it runs is the
      // card's answer, and it arrives through setSteps in the same commit.
      steps = Math.max(steps, nextLandmarks);
      frame = cellScanFrameAt(epochMs, nowPerf(), landmarks, reduced);
    },
    run: () => {
      // Announced, not published: the start of a walk is news even when its
      // first frame happens to read the same as the last one shown — the
      // sweep writes its DOM straight from these calls, and a reduced-motion
      // card that arrives already settled still has to be told so.
      frame = cellScanFrameAt(epochMs, nowPerf(), landmarks, reduced);
      listeners.forEach((listener) => listener());
      arm();
    },
    setSteps: (nextSteps: number) => {
      if (nextSteps === steps) return;
      steps = nextSteps;
      // A record that arrives after the walk ended has nothing to walk to: the
      // frame it lands in is already past its steps, so its rows light with
      // the ink transition they were mounted with.
      publish(cellScanFrameAt(epochMs, nowPerf(), landmarks, reduced));
      arm();
    },
    stop: stopTimer,
  };
}

/** A card rendered outside a panel reads a settled walk rather than crashing —
 *  the honest answer for "no scan is running". */
const SETTLED_CLOCK: CellScanClock = {
  frame: SETTLED_SCAN_FRAME,
  subscribe: () => () => {},
  prime: () => {},
  run: () => {},
  setSteps: () => {},
  stop: () => {},
};

export const CellScanClockContext = createContext<CellScanClock>(SETTLED_CLOCK);

export function useCellScanClock(): CellScanClock {
  return useContext(CellScanClockContext);
}

/** Subscribe to one SLICE of the walk. The selector's value is what decides a
 *  re-render, so a gate that reads a boolean wakes once and a readout that
 *  rides the sweep wakes per tick — each paying only for what it shows. */
export function useCellScanSelector<T>(select: (frame: CellScanFrame) => T): T {
  const clock = useCellScanClock();
  const read = () => select(clock.frame);
  return useSyncExternalStore(clock.subscribe, read, read);
}

/** The whole frame, for the two readouts that ride the walk rather than wait
 *  on a step of it. The frame's identity only changes when a field does, so
 *  this still sleeps through a tick that said nothing new. */
export function useCellScanFrame(): CellScanFrame {
  return useCellScanSelector((frame) => frame);
}

/** Has the probe lit this step yet? Steps are 1-based (step 1 is the first
 *  landmark), so step 0 is "always". */
export function useCellScanStepLit(step: number): boolean {
  return useCellScanSelector((frame) => frame.lit >= step);
}

export function useCellScanClassified(): boolean {
  return useCellScanSelector((frame) => frame.classified);
}

/** The 0..1 walk completion, for the memory pieces that ramp with it. */
export function useCellScanMemoryProgress(): number {
  return useCellScanSelector((frame) => frame.memoryProgress);
}
