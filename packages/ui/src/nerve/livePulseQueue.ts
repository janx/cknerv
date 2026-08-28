// Frame-sliced driver for live pulse planning. A block delta's links are
// opened the instant they arrive (cursor advanced, departure clock stamped)
// and PLANNED a bounded slice per frame from this queue: one route search
// per origin over the ~12,000-node stage costs 0.5–3 ms, a busy block asks
// for dozens, and the packets do not leave for `livePulseDepartureDelayS`
// (≥ 2.2 s ≈ 130 frames) — slack the one-task planner never used.
//
// What stays exactly as the one-task planner had it: the routes (each batch
// plans against the display pair captured when its delta arrived — the
// request-time contract — and the frame loop validates every hop against the
// live graph anyway), the departure times (`startSec` is stamped at arrival),
// the per-batch pulse budget, the pulse order, and every stats bump in link
// order. What a slice must never do is let a packet depart late: a batch
// whose earliest departure is within `LIVE_PLAN_DEADLINE_MARGIN_S` finishes
// in the current frame regardless of the budget — the worst case is the one
// task the planner always was, never a packet appearing mid-flight.

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

/** How far ahead of a batch's earliest departure (`startSec` — a packet's
 *  own jitter only adds to it) the slicing yields to completion. One frame
 *  at 30 Hz plus margin: the planner step runs before the pulse walk in the
 *  same frame, so a batch finished when `now >= startSec − margin` has
 *  every packet in the pool before the first of them can leave. */
export const LIVE_PLAN_DEADLINE_MARGIN_S = 0.05;

/** One opened batch awaiting (or in) planning. The display pair is captured
 *  at arrival: routes are planned against the map and graph the delta was
 *  seen with, so `path[0]` and every `to_id` are present by construction
 *  and the ghost leg resolves against the same map. */
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
 * when anything is queued), keeps going while the budget predicts room for
 * another step of the last step's cost, and drains any batch whose
 * departure deadline has arrived whatever the budget says. Batches are
 * FIFO: a later block's links never overtake an earlier one's.
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
    const urgent = ctx.nowSec >= batch.startSec - LIVE_PLAN_DEADLINE_MARGIN_S;
    let lastStepMs = 0;
    while (!planner.done) {
      if (
        !urgent
        && report.steps > 0
        && ctx.nowMs() - sliceStartMs + lastStepMs > ctx.budgetMs
      ) {
        report.pending = true;
        return report;
      }
      const stepStartMs = ctx.nowMs();
      const pulses = planner.step();
      lastStepMs = ctx.nowMs() - stepStartMs;
      report.steps += 1;
      for (const pulse of pulses) {
        ctx.admit(pulse, batch);
        report.admitted += 1;
      }
    }
    if (urgent && report.steps > 0) report.forcedByDeadline = true;
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
