// Mutable live values for the backtick tuning panel. `TweakSync` writes here
// from leva; frame-loop consumers read `LIVE.<folder>.<key>` each frame. The
// singleton and its folder objects are allocated once and mutated in place —
// never reallocated — so reads in hot loops never chase a moving reference and
// no per-frame garbage is produced.
import { simClock } from './simClock';
import {
  galaxySchema, deliverySchema, peerSchema, cellSchema, nerveSchema,
  type FolderSchema,
} from './tweakSchema';

export function defaultsFrom(schema: FolderSchema): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of Object.keys(schema)) out[key] = schema[key].value;
  return out;
}

export type GalaxyLive = { [K in keyof typeof galaxySchema]: number };
export type DeliveryLive = { [K in keyof typeof deliverySchema]: number };
export type PeerLive = { [K in keyof typeof peerSchema]: number };
export type CellLive = { [K in keyof typeof cellSchema]: number };
export type NerveLive = { [K in keyof typeof nerveSchema]: number };

/** ⚠️ NOT A TUNING FOLDER, and the only one here that is not. `time` carries
 *  the visitor's own MOTION POLICY, which nobody tunes and leva never writes:
 *  `applyTweaks` below leaves it alone on purpose.
 *
 *  It lives in this object because of what this object IS — the one place a
 *  `useFrame` callback may read state from without being a component. Reduced
 *  motion arrives through `matchMedia`, which is a hook's business, and the
 *  loops that have to answer it (the two rotations, the ambience) are not
 *  components and cannot hold one. Threading a boolean through the scene graph
 *  to reach a `rotation.y +=` would be the same noise the boot record refused
 *  to thread a callback through. So the hook publishes and the loops read. */
export interface MotionLive {
  /** The visitor asked for motion to stop. Published by `useReducedMotion`. */
  reduced: boolean;
}

export interface LiveTweaks {
  galaxy: GalaxyLive;
  delivery: DeliveryLive;
  peer: PeerLive;
  cell: CellLive;
  nerve: NerveLive;
  time: MotionLive;
}
export type PartialLive = { [F in keyof LiveTweaks]?: Partial<LiveTweaks[F]> };

export const LIVE: LiveTweaks = {
  galaxy: defaultsFrom(galaxySchema) as GalaxyLive,
  delivery: defaultsFrom(deliverySchema) as DeliveryLive,
  peer: defaultsFrom(peerSchema) as PeerLive,
  cell: defaultsFrom(cellSchema) as CellLive,
  nerve: defaultsFrom(nerveSchema) as NerveLive,
  time: { reduced: false },
};

/** What `useReducedMotion` publishes. One writer, and it is a hook, so the
 *  flag is as live as the media query is. */
export function publishReducedMotion(reduced: boolean): void {
  LIVE.time.reduced = reduced;
}

/** The phase an ambient loop is HELD at under reduced motion.
 *
 *  A constant, and deliberately not zero: zero is a meaningful value in
 *  several of these shaders (a stamp that has not happened, a ramp that has
 *  not started), and a sine held at its own origin is the one phase that reads
 *  as "the effect is off" rather than as "the effect is still". This is an
 *  arbitrary point on every one of those cycles, and being arbitrary is the
 *  whole requirement — nothing may look SET UP, it must look stopped. */
export const REDUCED_AMBIENT_PHASE_SEC = 137;

/** The clock an AMBIENT term reads, as opposed to the one a lifecycle reads.
 *
 *  ⚠️ THE TWO CANNOT BE ONE CLOCK, and that is the whole reason this function
 *  exists. Stopping `simClock` would stop the ambience — and it would also
 *  freeze every birth, wither and stage fade at whatever fraction it had
 *  reached, because those are ramps of `(clock − stamp) / duration`. A wave
 *  frozen halfway is a defect; the policy says an event plays at its END
 *  state. So the ramps keep the real clock and the shimmer takes this one.
 *
 *  ⚠️ AND IT IS ONLY FOR A TERM WITH NO CAUSE. A `uTime` that drives both a
 *  breath and a shockwave must keep the real clock; the breath's own
 *  amplitude is what stops. */
export function ambientElapsedSec(clock: { elapsedSec: number } = simClock): number {
  return LIVE.time.reduced ? REDUCED_AMBIENT_PHASE_SEC : clock.elapsedSec;
}

/** The factor an AMBIENT loop multiplies its rate by — the one function every
 *  such loop reads, so "does the stage honour reduced motion" is a question
 *  with one answer and a grep that finds every site.
 *
 *  Ambient means: motion with no cause, running because the scene is on
 *  screen. The two plane rotations, the star drift. It is NOT for an event —
 *  a block landing, a cell being born — which under this policy plays at its
 *  END STATE rather than at zero speed, because a wave frozen halfway is a
 *  defect and a wave that never arrives is a lie. */
export function motionScale(): number {
  return LIVE.time.reduced ? 0 : 1;
}

// The nerve folder feeds GRAPH SELECTION, not per-frame uniform reads, so it
// needs a push channel: consumers (NeuralNetwork) subscribe and schedule one
// incremental display rebuild per change instead of polling LIVE each frame.
let nerveTuningVersion = 0;
const nerveTuningListeners = new Set<() => void>();

export function getNerveTuningVersion(): number {
  return nerveTuningVersion;
}

export function subscribeNerveTuning(listener: () => void): () => void {
  nerveTuningListeners.add(listener);
  return () => { nerveTuningListeners.delete(listener); };
}

export function applyTweaks(live: LiveTweaks, values: PartialLive): void {
  // `time` is deliberately absent: it is the visitor's policy, not a knob, and
  // a leva drag that could turn reduced motion off would be the panel
  // overriding an accessibility setting.
  if (values.galaxy) Object.assign(live.galaxy, values.galaxy);
  if (values.delivery) Object.assign(live.delivery, values.delivery);
  if (values.peer) Object.assign(live.peer, values.peer);
  if (values.cell) Object.assign(live.cell, values.cell);
  if (values.nerve) {
    let changed = false;
    for (const key of Object.keys(values.nerve) as (keyof NerveLive)[]) {
      const next = values.nerve[key];
      if (next !== undefined && live.nerve[key] !== next) {
        live.nerve[key] = next;
        changed = true;
      }
    }
    if (changed && live === LIVE) {
      nerveTuningVersion += 1;
      for (const listener of nerveTuningListeners) listener();
    }
  }
}
