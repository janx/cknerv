// Reaping the fabric while nobody is watching.
//
// Ingest is effect-fed (WS → setState → syncDisplayFabric per cache
// generation), so a hidden tab keeps admitting births and stamping deaths —
// while EVERY reap lives in the frame loop, and a hidden tab has no frames:
// rAF is suspended, and the sim clock, which only advances from useFrame,
// freezes with it. Edge states, reap queues and renderOrder therefore grew
// without any bound for as long as the tab stayed in the background, and the
// whole compaction came due in the first frame after it returned.
//
// This module is the pure half: the wall-clock bridge that lets reap
// eligibility advance without a frame, the two bounded reap passes the
// frameless path and the foreground catch-up share, and the document wiring
// that decides when each runs. The containers (and the GPU slots they index)
// stay in NeuralFabric — this module only ever removes bookkeeping.

import { MAX_PASSIVE_EDGE_GENERATIONS } from './fabricCapacity';
import { DEATH_RETRACT_MS, DECAY_MS, type DeathKind } from './fabricEdgeRender';
import { fabricLifecycleEndSec } from './fabricLifecycleSlots';

/** Longest window a dying edge can still be drawn for — the quiet gc fade
 *  outlasts the death retract. A frozen-clock kill is certainly finished
 *  once this many WALL seconds have passed since it was stamped. */
export const FABRIC_MAX_DEATH_WINDOW_S = Math.max(DECAY_MS, DEATH_RETRACT_MS) / 1000;

/** Fallback drain cadence while hidden. Browsers throttle background timers
 *  to roughly once a minute (harder still under intensive throttling), so
 *  this is a "drain whatever is due whenever it fires" cadence and never a
 *  schedule to rely on: every pass derives its eligibility from the wall
 *  clock it reads, not from how many ticks arrived. */
export const HIDDEN_REAP_INTERVAL_MS = 30_000;

/** Reap-queue entries retired per queue per frame while the foreground
 *  catch-up works through a hidden stretch's backlog. 512 clears a minute of
 *  mainnet churn in a couple of frames yet keeps the worst case — a tab
 *  hidden for a day — spread over frames instead of one stall. */
export const FOREGROUND_CATCH_UP_BATCH = 512;

/**
 * Retained-state ceiling for one mount, derived from the SAME allocation the
 * GPU buffers were sized from: the layer holds `slotCapacity` slots (the
 * resolved edge class × MAX_PASSIVE_EDGE_GENERATIONS coexisting generations),
 * so states past that count have no slot to draw from — they are pure
 * bookkeeping. One further generation of margin means the ceiling cannot bite
 * while frames are draining normally (a whole-graph setFabric replacement
 * queues one full generation of gc-fades while the next one grows); only an
 * unattended frameless stretch reaches it.
 */
export function fabricEdgeStateCeiling(slotCapacity: number): number {
  const capacity = Number.isFinite(slotCapacity) ? Math.floor(slotCapacity) : 0;
  return Math.max(
    1,
    Math.round(
      (capacity * (MAX_PASSIVE_EDGE_GENERATIONS + 1)) / MAX_PASSIVE_EDGE_GENERATIONS,
    ),
  );
}

/** Wall-clock anchor for a frameless stretch. */
export interface HiddenFabricClock {
  /** Monotonic wall ms at which the document went hidden; null while the
   *  frame loop owns time. */
  hiddenSinceMs: number | null;
  /** Sim second the clock froze at (the last frame's `now`). */
  frozenSimSec: number;
}

export function createHiddenFabricClock(): HiddenFabricClock {
  return { hiddenSinceMs: null, frozenSimSec: 0 };
}

/**
 * Sim-second to reap against while hidden.
 *
 * INVARIANT: sim time is wall time × timeScale for as long as frames run, so
 * advancing the frozen clock by the wall seconds actually spent hidden
 * reconstructs the timeline the fabric WOULD have seen at the production
 * scale of 1 — an edge is never retired earlier than its own lifecycle
 * window measured from the moment it was stamped, and a hidden tab renders
 * nothing, so every lifecycle this retires completed with no observer. Under
 * a deliberately slowed or paused clock (the dev-panel Time knobs) the bridge
 * still runs at wall rate and retires fades the resumed clock would have held
 * — the deliberate trade for bounding a background tab.
 */
export function hiddenFabricSimNow(
  clock: HiddenFabricClock,
  wallNowMs: number,
): number {
  if (clock.hiddenSinceMs === null) return clock.frozenSimSec;
  return clock.frozenSimSec + Math.max(0, wallNowMs - clock.hiddenSinceMs) / 1000;
}

/** One kind's FIFO expiry queue: fixed windows per kind ⇒ entries stay
 *  time-ordered as kills arrive, so the head is always the next to expire. */
export interface FabricReapQueue {
  entries: { key: string; endSec: number }[];
  head: number;
}

/** The lifecycle half of an edge state — all a reap pass needs to know is
 *  when the edge stopped being drawable. */
export interface ReapableEdge {
  dyingAt: number | null;
  deathKind: DeathKind | null;
}

/** Bookkeeping one reaped edge is removed from. `onReap` reports each key
 *  and the state it held so the caller keeps its own counters and indexes
 *  (renderOrder tombstones, stats, the numeric edge index the frame loop
 *  reads) without this module knowing about them. */
export interface FabricReapTargets<T extends ReapableEdge> {
  states: Map<string, T>;
  slots: Map<string, number>;
  freeSlots: number[];
  warmKeys: Set<string>;
  onReap: (key: string, state: T) => void;
}

/** Retire one edge in place: its slot returns to the recycle list (the
 *  record left in it is expired, so it draws nothing until reused). */
function reapFabricEdge<T extends ReapableEdge>(
  targets: FabricReapTargets<T>,
  key: string,
  state: T,
): void {
  const slot = targets.slots.get(key);
  if (slot !== undefined) {
    targets.slots.delete(key);
    targets.freeSlots.push(slot);
  }
  targets.states.delete(key);
  targets.warmKeys.delete(key);
  targets.onReap(key, state);
}

/**
 * Drain expired entries off the head of one queue, at most `budget` of them.
 * Entries are re-validated against the CURRENT state, so a revival between
 * queueing and expiry is never reaped — the stale entry just drops. Returns
 * the number of entries CONSUMED (reaped plus dropped), which is the work
 * done: a caller pacing itself compares it against the budget it gave.
 */
export function drainFabricReapQueue<T extends ReapableEdge>(
  queue: FabricReapQueue,
  targets: FabricReapTargets<T>,
  now: number,
  budget = Number.POSITIVE_INFINITY,
): number {
  const states = targets.states;
  let consumed = 0;
  while (
    consumed < budget
    && queue.head < queue.entries.length
    && queue.entries[queue.head].endSec <= now
  ) {
    const { key } = queue.entries[queue.head];
    queue.head += 1;
    consumed += 1;
    const st = states.get(key);
    if (
      !st
      || st.dyingAt === null
      || fabricLifecycleEndSec(st.dyingAt, st.deathKind) > now
    ) continue; // revived or already gone — the stale entry just drops
    reapFabricEdge(targets, key, st);
  }
  if (queue.head > 256 && queue.head * 2 > queue.entries.length) {
    queue.entries = queue.entries.slice(queue.head);
    queue.head = 0;
  }
  return consumed;
}

/**
 * Ceiling backstop: drop the OLDEST fully-dead states until the map is back
 * under `ceiling`. Map iteration is insertion order, so this walks birth
 * order and the longest-standing corpses go first.
 *
 * A LIVING edge is never evicted — not one that is still alive, and not one
 * mid-death: at the ceiling with nothing finished to drop, the map is simply
 * left oversized, because clipping form somebody may be looking at is worse
 * than holding the memory. In practice the queue drain has already taken
 * everything this would find; it exists for the state a lost queue entry
 * would otherwise strand.
 */
export function evictDeadFabricEdges<T extends ReapableEdge>(
  targets: FabricReapTargets<T>,
  now: number,
  ceiling: number,
): number {
  const states = targets.states;
  if (states.size <= ceiling) return 0;
  let evicted = 0;
  // Deleting the current entry mid-iteration is well defined for Map.
  for (const [key, st] of states) {
    if (st.dyingAt === null) continue;
    if (fabricLifecycleEndSec(st.dyingAt, st.deathKind) > now) continue;
    reapFabricEdge(targets, key, st);
    evicted += 1;
    if (states.size <= ceiling) break;
  }
  return evicted;
}

export interface HiddenFabricReaperOptions {
  /** Monotonic wall clock (performance.now); injectable for tests. */
  wallNowMs: () => number;
  /** The sim second the frame loop last ran at, read as the tab goes hidden. */
  simNowSec: () => number;
  /** One frameless reap pass at the bridged sim-second. */
  reap: (bridgedSimSec: number) => void;
  /** Backlog handoff on return: the frame loop drains toward this second. */
  resume: (bridgedSimSec: number) => void;
  intervalMs?: number;
}

export interface HiddenFabricReaper {
  /** The bridged sim-second while the tab is hidden, else null — callers use
   *  it to decide whether the frame loop or the wall clock owns eligibility. */
  framelessSimNow(): number | null;
  stop(): void;
}

/**
 * Wire the frameless reap path to the document: hidden ⇒ the interval drains
 * on wall time, visible ⇒ the frame loop takes over with whatever backlog is
 * left. No-ops without a document (SSR); the returned teardown is safe to
 * call in either case.
 */
export function startHiddenFabricReaper({
  wallNowMs,
  simNowSec,
  reap,
  resume,
  intervalMs = HIDDEN_REAP_INTERVAL_MS,
}: HiddenFabricReaperOptions): HiddenFabricReaper {
  const clock = createHiddenFabricClock();
  if (typeof document === 'undefined') {
    return { framelessSimNow: () => null, stop: () => {} };
  }
  const enterHidden = (): void => {
    if (clock.hiddenSinceMs !== null) return;
    clock.hiddenSinceMs = wallNowMs();
    clock.frozenSimSec = simNowSec();
  };
  const leaveHidden = (): void => {
    if (clock.hiddenSinceMs === null) return;
    // The handoff target is clamped to one death window past the freeze.
    // Every entry the hidden stretch left behind was stamped at or before
    // the frozen second, so that horizon retires all of them — while a kill
    // stamped once frames resume (its clock has moved on) stays out of the
    // catch-up's reach and keeps its fade.
    const bridged = Math.min(
      hiddenFabricSimNow(clock, wallNowMs()),
      clock.frozenSimSec + FABRIC_MAX_DEATH_WINDOW_S,
    );
    clock.hiddenSinceMs = null;
    resume(bridged);
  };
  const onVisibilityChange = (): void => {
    if (document.visibilityState === 'hidden') enterHidden();
    else leaveHidden();
  };
  // A tab restored straight into the background never fires the event.
  if (document.visibilityState === 'hidden') enterHidden();
  document.addEventListener('visibilitychange', onVisibilityChange);
  const timer = setInterval(() => {
    // Visible: the frame loop owns reaping, and this is one compare.
    if (clock.hiddenSinceMs === null) return;
    reap(hiddenFabricSimNow(clock, wallNowMs()));
  }, intervalMs);
  return {
    framelessSimNow: () => (
      clock.hiddenSinceMs === null
        ? null
        : hiddenFabricSimNow(clock, wallNowMs())
    ),
    stop: () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      clearInterval(timer);
    },
  };
}
