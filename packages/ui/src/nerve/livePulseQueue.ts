// Frame-sliced driver for live pulse planning. A block delta's links are
// opened the instant they arrive (cursor advanced, departure clock stamped)
// and PLANNED a bounded slice per frame from this queue: one route search
// per origin over the ~12,000-node stage costs 0.5–3 ms, a busy block asks
// for dozens, and the packets do not leave for `livePulseDepartureDelayS`
// (≥ 2.2 s ≈ 130 frames) — slack the one-task planner never used.
//
// What stays exactly as the one-task planner had it: the departure times
// (`startSec` is stamped at arrival), the per-batch pulse budget, the pulse
// order, and every stats bump in link order. The routes are planned against
// the display pair the batch captured when its delta arrived — the staged map
// and the display graph BY REFERENCE, not a snapshot. A chained worker build
// patches that graph's adjacency in place (and the staged map is patched the
// same way), so a slice that runs after a build lands searches the landed
// graph: a route it finds is made of live edges and never of one the build
// just removed. Only a whole (non-chained) rebuild replaces the object, and a
// batch opened before it keeps planning on the graph it captured — the frame
// loop validates every hop against the live graph either way. What a slice
// must never do is let a packet depart late: a batch whose earliest departure
// is within `LIVE_PLAN_DEADLINE_MARGIN_S` finishes in the current frame
// regardless of the budget — the worst case is the one task the planner
// always was, never a packet appearing mid-flight.
//
// THE BUDGET IS CHECKED BETWEEN STEPS, AND A STEP IS ONE ROUTE SEARCH.
// Nothing here can subdivide a step: a slice must always take at least one,
// and a step that has begun runs to its end. So the frame cost of planning is
// this budget PLUS one grain, and the grain is whatever `LinkBatchPlanner`
// puts in a step — which is why that machine plans one ORIGIN of a link and
// one CANDIDATE of a rescue pass per step, never `MAX_ORIGINS_PER_LINK`
// searches or `MAX_RESCUE_ATTEMPTS` of them at once. A full-stage search over
// ~12,000 nodes is 2–7 ms warm and ~9 ms on the first traversal of a freshly
// published graph (the router's per-node neighbour cache is built as it
// walks), so anything that packs several into one step lands directly on the
// frame, budget or no budget.

import type { Cell, CellLink } from '@cknerv/types';
import type { NeighborAdjacency } from '../geometry/neighborGraph';
import type { Pulse, PulsePlanningOptions } from './pulseRunner';
import {
  createLinkBatchPlanner,
  type LinkBatchPlanner,
  type PulseBatchStats,
} from './pulseBatch';

/** Main-thread time one frame may spend planning while no deadline
 *  presses. Two milliseconds is under a fifth of a 60 Hz frame and worth
 *  ~1–3 route searches; a quiet block's batch closes in two or three
 *  frames, a burst block's in a few dozen — all well inside the departure
 *  slack. A slice never STARTS a step its previous step's cost says would
 *  overrun the budget (and always takes at least one), so the budget bounds
 *  the slice rather than the point at which it stops taking work. */
export const LIVE_PLAN_BUDGET_MS = 2;

/** The share of the last frame's wall interval a slice may spend planning.
 *  Twelve percent of a 60 Hz frame is the 2 ms floor; a slower machine's
 *  longer frame buys proportionally more, so a 30 Hz frame (~33 ms) plans
 *  ~4 ms — two grains, not one — and a batch finishes in fewer frames and
 *  rarely reaches its departure deadline at all. */
export const LIVE_PLAN_BUDGET_FRAME_FRACTION = 0.12;

/** Wall-time-relative planning budget for one slice: the frame-fraction of
 *  the last frame interval, never below the {@link LIVE_PLAN_BUDGET_MS} floor.
 *  A cheap frame keeps the floor; a heavy or low-Hz frame is allowed to plan
 *  more so the departure slack is used before the deadline forces the hand. */
export function livePlanBudgetMs(lastFrameIntervalMs: number): number {
  const frameMs = Number.isFinite(lastFrameIntervalMs)
    ? Math.max(0, lastFrameIntervalMs)
    : 0;
  return Math.max(
    LIVE_PLAN_BUDGET_MS,
    frameMs * LIVE_PLAN_BUDGET_FRAME_FRACTION,
  );
}

/** How far ahead of a batch's earliest departure (`startSec` — a packet's
 *  own jitter only adds to it) the slicing yields to completion. One frame
 *  at 30 Hz plus margin: the planner step runs before the pulse walk in the
 *  same frame, so a batch finished when `now >= startSec − margin` has
 *  every packet in the pool before the first of them can leave. */
export const LIVE_PLAN_DEADLINE_MARGIN_S = 0.05;

/** One opened batch awaiting (or in) planning. The display pair is captured
 *  at arrival by reference: the map and graph the delta was seen with, as
 *  they stand when each slice runs (chained builds and stage churn patch
 *  both in place), so `path[0]` and every `to_id` present at planning time
 *  are the live ones and the ghost leg resolves against the same map. */
export interface LivePulseBatch {
  toFire: CellLink[];
  cells: ReadonlyMap<number, Cell>;
  graph: NeighborAdjacency;
  opts: PulsePlanningOptions;
  /** Departure clock, stamped when the delta arrived. */
  startSec: number;
  /** Evidence-archive epoch the links belong to (the cache's identity
   *  token, compared by reference); a batch from a replaced archive still
   *  plans, but its watermark must not outlive the archive. */
  linksEpoch: object;
  /** Created when the batch reaches the head of the queue, so its entry
   *  watermark is the previous batch's RESULT — FIFO threading, as the
   *  one-task planner had by running batches back to back. */
  planner: LinkBatchPlanner | null;
}

export interface LivePulseQueue {
  batches: LivePulseBatch[];
}

export function createLivePulseQueue(): LivePulseQueue {
  return { batches: [] };
}

export interface LivePulseStepContext {
  /** Sim clock now, the clock `startSec` lives on. */
  nowSec: number;
  /** Wall clock for the budget (ms). */
  nowMs: () => number;
  budgetMs: number;
  stats: PulseBatchStats;
  /** Entry watermark for a batch opened this step. */
  lastGuaranteedBlock: () => number;
  /** Admit one planned pulse; called in plan order. */
  admit: (pulse: Pulse, batch: LivePulseBatch) => void;
  /** A batch finished: its final watermark. */
  complete: (lastGuaranteedBlock: number, batch: LivePulseBatch) => void;
}

export interface LivePulseStepReport {
  /** Planner steps taken this frame. */
  steps: number;
  /** Pulses admitted this frame. */
  admitted: number;
  /** Work remains for a later frame. */
  pending: boolean;
  /** A batch completed under the deadline rule rather than the budget. */
  forcedByDeadline: boolean;
  /** Longest single planner step this frame, in ms (`ctx.nowMs()` around one
   *  `planner.step()`). The frame's worst grain; the driver folds it into the
   *  window's running max. Zero when the frame only took free grid/flush
   *  steps or ran no step at all. */
  maxStepMs: number;
}

export function enqueueLivePulseBatch(
  queue: LivePulseQueue,
  toFire: CellLink[],
  cells: ReadonlyMap<number, Cell>,
  graph: NeighborAdjacency,
  opts: PulsePlanningOptions,
  startSec: number,
  linksEpoch: object,
): LivePulseBatch {
  const batch: LivePulseBatch = {
    toFire,
    cells,
    graph,
    opts,
    startSec,
    linksEpoch,
    planner: null,
  };
  queue.batches.push(batch);
  return batch;
}

/**
 * Run one frame's slice. Always makes progress (at least one planner step
 * when anything is queued) and keeps going while the budget predicts room for
 * another step of the last step's cost, then DEFERS the rest to the next
 * frame — a batch past its departure deadline included. The remainder is
 * spread over the following slices, never dropped and never with its departure
 * clock (`startSec`) moved, so a stall that makes a whole batch urgent at once
 * costs a few budgeted frames instead of one long synchronous drain.
 * `forcedByDeadline` flags that a slice planned a batch under deadline
 * pressure — a signal for the probe, no longer a licence to overrun the frame.
 * Batches are FIFO: a later block's links never overtake an earlier one's.
 */
export function stepLivePulseQueue(
  queue: LivePulseQueue,
  ctx: LivePulseStepContext,
): LivePulseStepReport {
  const report: LivePulseStepReport = {
    steps: 0,
    admitted: 0,
    pending: false,
    forcedByDeadline: false,
    maxStepMs: 0,
  };
  const batches = queue.batches;
  if (batches.length === 0) return report;
  const sliceStartMs = ctx.nowMs();
  while (batches.length > 0) {
    const batch = batches[0];
    const planner = batch.planner ??= createLinkBatchPlanner(
      batch.toFire,
      batch.cells,
      batch.graph,
      batch.opts,
      ctx.stats,
      ctx.lastGuaranteedBlock(),
    );
    // Within the deadline margin the batch is being planned under departure
    // pressure — counted for the probe. It does NOT bypass the budget: the
    // remainder defers to the next slice like any other, so the deadline path
    // is a few budgeted frames, not one 20 ms drain.
    if (
      !planner.done
      && ctx.nowSec >= batch.startSec - LIVE_PLAN_DEADLINE_MARGIN_S
    ) {
      report.forcedByDeadline = true;
    }
    let lastStepMs = 0;
    while (!planner.done) {
      if (
        report.steps > 0
        && ctx.nowMs() - sliceStartMs + lastStepMs > ctx.budgetMs
      ) {
        report.pending = true;
        return report;
      }
      const stepStartMs = ctx.nowMs();
      const pulses = planner.step();
      lastStepMs = ctx.nowMs() - stepStartMs;
      if (lastStepMs > report.maxStepMs) report.maxStepMs = lastStepMs;
      report.steps += 1;
      for (const pulse of pulses) {
        ctx.admit(pulse, batch);
        report.admitted += 1;
      }
    }
    batches.shift();
    ctx.complete(planner.lastGuaranteedBlock, batch);
  }
  return report;
}

/**
 * Reorg: every queued batch drops its links at or above `fromBlock` and
 * rewinds its watermarks; a batch left with nothing to plan is discarded
 * before it is ever opened. Already-admitted pulses are the caller's to
 * prune (`prunePulsesFromBlock`), as before.
 */
export function pruneLivePulseQueue(
  queue: LivePulseQueue,
  fromBlock: number,
): void {
  const kept: LivePulseBatch[] = [];
  for (const batch of queue.batches) {
    if (batch.planner !== null) {
      batch.planner.prune(fromBlock);
      kept.push(batch);
      continue;
    }
    let keep = batch.toFire.length;
    while (keep > 0 && batch.toFire[keep - 1].block >= fromBlock) keep -= 1;
    if (keep === 0) continue;
    batch.toFire = batch.toFire.slice(0, keep);
    kept.push(batch);
  }
  queue.batches = kept;
}
