// The fabric half of a landed worker build, parked and drained across frames.
//
// A landing used to do everything inside the worker's message task: swap the
// display graph AND grow/kill the fabric that graph selects. At the High tier
// that single task reached 48 ms (topology commit ≤ 21 + fabric commit ≤ 27)
// and the block frame containing it reached 83 ms — one grain no budget could
// touch, because a task cannot yield to itself.
//
// This module is the second half, parked. A landing enqueues ONE item holding
// references to the arrays the worker already produced (no copy, O(1) at
// landing time), and the raw frame drains it under a wall budget. A stroke has
// the whole GROWTH_MS window to reach full length, so spending a few frames
// entering the strokes is invisible; a 48 ms task is not.
//
// ⚠️ Order is the entire contract, in two directions:
//
//  - WITHIN a build, kills run before grows. A kill only marks decay, and
//    `growEdges` REVIVES a dying edge — so a grow that ran first could be
//    undone by the kill behind it.
//  - ACROSS builds the FIFO is strict: build N's grows all land before build
//    N+1's kills. The worker's selection deltas are a CHAIN — N+1's `removed`
//    is stated against the selection N left behind — so applying them out of
//    order kills edges that were never grown and grows edges already gone.
//
// The translation into fabric edge keys runs at DRAIN time, per chunk, for two
// reasons: it is what keeps the landing task O(1) (a delta of a few thousand
// edges is that many string builds and Map inserts), and it is the only way a
// birth can be stamped with the clock of the frame it actually enters on —
// `planSelectionDeltaUpdate` writes `bornAt` from the clock it is handed, and
// a landing-time clock would start every stroke's growth in the past.

import type { Cell } from '@cknerv/types';
import type { NeighborEdge, PassiveSelection } from '../geometry/neighborGraph';
import type { DeathKind } from './fabricEdgeRender';
import { FRAME_HEAVY_BUDGET_MS } from './frameBudget';
import {
  planSelectionDeltaUpdate,
  selectionStrayEdgeKeys,
  type SelectionDelta,
} from './livingMeshDriver';

/** Floor on the wall time one frame may spend applying landed fabric work.
 *  Three milliseconds is under a fifth of a 60 Hz frame, and it only binds on
 *  a frame shorter than 12 ms — above that the fraction below is the larger
 *  number. The drain runs before the live-plan slice in the same frame, so the
 *  two together stay inside the frame they share. */
export const FABRIC_LANDING_BUDGET_MS = 3;

/** Share of the last frame's wall interval the drain may spend. A quarter of a
 *  slow frame is more than the floor, so a 30 Hz machine drains ~8 ms and a
 *  block's fabric enters in fewer frames instead of trickling for a second. */
export const FABRIC_LANDING_BUDGET_FRAME_FRACTION = 0.25;

/** Edges grown per chunk. Small enough that one chunk cannot overrun a 3 ms
 *  budget on its own (a grow is a seed, a bezier control point, a colour pair,
 *  one state object and four index writes — single-digit microseconds), large
 *  enough that the per-chunk slice and its two Maps stay noise. */
export const FABRIC_LANDING_GROW_CHUNK = 256;

/** Delta applications between periodic prunes. Unchanged from the every-16th
 *  reconcile the landing used to run inline: while deltas chain, drift can only
 *  be EXTRA fabric edges (eager living-mesh growth the selection never
 *  confirmed), so the reconcile prunes strays rather than re-admitting. */
export const FABRIC_LANDING_RECONCILE_EVERY = 16;

/** Edges of a whole reconcile's classifying scan per step. A scanned edge is
 *  a key built, a Set insert and one map lookup — a fraction of a grow's
 *  cost — so the quantum is twice {@link FABRIC_LANDING_GROW_CHUNK} and a
 *  12,000-Cell stage's 8,000 edges become sixteen steps the budget is read
 *  between, instead of one 4–5 ms walk no frame could interrupt. */
export const FABRIC_RECONCILE_SCAN_CHUNK = 512;

const NO_EDGES: readonly NeighborEdge[] = [];

/** Wall-time budget for one drain: the frame-fraction of the last frame
 *  interval, never below {@link FABRIC_LANDING_BUDGET_MS}. Same shape as
 *  `livePlanBudgetMs`, and for the same reason — a heavy or low-Hz frame is
 *  allowed to do proportionally more, so the work is not stretched across a
 *  second by a machine that is already slow. */
export function fabricLandingBudgetMs(lastFrameIntervalMs: number): number {
  const frameMs = Number.isFinite(lastFrameIntervalMs)
    ? Math.max(0, lastFrameIntervalMs)
    : 0;
  return Math.max(
    FABRIC_LANDING_BUDGET_MS,
    frameMs * FABRIC_LANDING_BUDGET_FRAME_FRACTION,
  );
}

/**
 * One whole reconcile in progress, declared here because the DRAIN owns its
 * lifetime: the drain opens it, carries it across frames and drops it when the
 * landing under it is superseded. Only the fabric reads the fields — the queue
 * reads `scanned` and the selection's length, and nothing else.
 *
 * Everything in it is scratch over an immutable input. The scan classifies
 * `graph.edges` against the persistent slots and writes its findings HERE; the
 * commit is the only pass that decides a death or admits a birth. So an
 * abandoned scratch costs the fabric nothing but the repairs the scan made in
 * passing (a revival, a slot recovered after a capacity clip), which are
 * repairs either way and which the reconcile replacing it would make again.
 */
export interface FabricWholeReconcile {
  /** The authoritative selection being applied — immutable, so the scan may
   *  be cut anywhere in it. */
  readonly graph: PassiveSelection;
  /** The staged map of the build that published the selection. */
  readonly cells: ReadonlyMap<number, Cell>;
  /** Sim seconds the reconcile OPENED at. Every state it writes carries this
   *  clock, so a reconcile spread over frames still lands one moment. */
  readonly now: number;
  /** Edges of `graph.edges` classified so far. */
  scanned: number;
  /** Keys the new selection holds — the commit's membership test. */
  readonly liveKeys: Set<string>;
  /** Fresh edges in first-seen order: the commit's admission list. */
  readonly addCandidates: Map<string, NeighborEdge>;
  /** Existing edges the scan left untouched, and dying ones it brought back. */
  stable: number;
  revived: number;
  /** Edges admitted by the flush of a previous reconcile's staggered
   *  remainder, which the opening does before anything is classified. */
  flushAdmitted: number;
  /** The slot space could not absorb an admission or a recovery: the commit
   *  ends in a compacting full walk. */
  overflowed: boolean;
  /** An existing edge was found without a slot, so the drawn order moved. */
  slotOwnershipChanged: boolean;
  /** Whether the fabric held any state when the reconcile opened: a first
   *  population is THE boot cohort and is never staggered. */
  readonly wasPopulated: boolean;
}

/**
 * What to promise the frame's heavy-work ledger before draining.
 *
 * Every item in this queue but one is a chunked walk whose last cost predicts
 * its next, and that is what the drain has always asked with. A WHOLE
 * reconcile is a different animal: its atomic pass walks every state the
 * fabric holds and admits everything the selection added, and the last grow
 * chunk's three milliseconds predict nothing about it — which is how a 25 ms
 * frame came to be admitted on a 3 ms promise. Asking for a whole frame's
 * heavy budget instead is the honest estimate: the reconcile lands on a frame
 * nothing else has claimed, or, after three frames held, on one it shares —
 * which is what the starvation escape is for.
 */
export function fabricLandingEstimateMs(
  queue: FabricLandingQueue,
  lastDrainMs: number,
): number {
  const last = Number.isFinite(lastDrainMs) && lastDrainMs > 0 ? lastDrainMs : 0;
  return queue.items[0]?.delta === null
    ? Math.max(last, FRAME_HEAVY_BUDGET_MS)
    : last;
}

/** The fabric handles a drain addresses — a structural subset of
 *  `NeuralFabricHandles`, so the real handles satisfy it and a test can hand a
 *  recorder instead. */
export interface FabricLandingHandles {
  growEdges(
    edges: NeighborEdge[],
    cells: ReadonlyMap<number, Cell>,
    bornAtByKey: Map<string, number>,
    dirByKey: Map<string, 1 | -1>,
  ): void;
  killEdges(
    keys: string[],
    dyingAt: number,
    kind: DeathKind,
    deadEndByKey?: Map<string, 'from' | 'to'>,
  ): void;
  /** Open a whole reconcile: flush any staggered remainder, publish the
   *  selection's width tier, and hand back the scratch the scan fills. */
  beginSetFabric(
    graph: PassiveSelection,
    cells: ReadonlyMap<number, Cell>,
    now: number,
  ): FabricWholeReconcile;
  /** Classify at most `edges` more of the new selection against the persistent
   *  slots. True once the scan has reached the end of the selection. */
  stepSetFabric(reconcile: FabricWholeReconcile, edges: number): boolean;
  /** Mark what the selection dropped and admit what it added — one pass, and
   *  the only one that changes what the fabric draws. */
  commitSetFabric(reconcile: FabricWholeReconcile): void;
  collectLiveEdgeKeys(): string[];
}

/** One landed build's fabric work, captured at landing time by reference. */
export interface FabricLandingItem {
  /** The display graph version this build published — the same number the
   *  owner hands `CellBridgeNerves` as `version`, so a consumer can ask
   *  whether the fabric has caught up with the graph it is reading. */
  readonly version: number;
  /** The staged map of THIS build. Grows resolve endpoint geometry from it,
   *  never from the owner's live ref: a later build's map may not hold a cell
   *  this build's delta still names. */
  readonly cells: ReadonlyMap<number, Cell>;
  /** This build's authoritative passive selection — the reconcile's input and
   *  the periodic prune's reference set. */
  readonly passiveGraph: PassiveSelection;
  /** The worker's selection delta, or `null` when this item is a FULL
   *  reconcile (bootstrap, a fabric remount, or a worker session break). A
   *  reconcile is applied whole: it is the compaction, and half of it is not a
   *  smaller compaction but a wrong fabric. */
  readonly delta: SelectionDelta | null;
}

/** Where the head item stands.
 *  - `open` — nothing applied yet (kills, or the whole reconcile, come next)
 *  - `scan` — a whole reconcile's classifying walk, at `reconcile.scanned`
 *  - `commit` — that walk is done and its one atomic pass is next
 *  - `grow` — kills done, grows in progress at `growCursor`
 *  - `prune` — grows done, only the periodic reconcile is left */
export type FabricLandingPhase = 'open' | 'scan' | 'commit' | 'grow' | 'prune';

export interface FabricLandingQueue {
  /** FIFO. The head is the item being drained. */
  readonly items: FabricLandingItem[];
  phase: FabricLandingPhase;
  /** Index into the head item's `delta.added` reached so far. */
  growCursor: number;
  /** The whole reconcile in flight, or null. Scratch over an immutable
   *  selection, so it survives frames and is dropped, not repaired, when the
   *  landing under it is superseded. */
  reconcile: FabricWholeReconcile | null;
  /** Consecutive delta items APPLIED since the last full reconcile or prune.
   *  It counts applications, not landings, so a queue emptied by a remount
   *  cannot leave the count ahead of the work. */
  deltaStreak: number;
  /** Highest version whose kills, grows and reconcile have ALL been applied.
   *  `-1` until the first item completes. */
  landedVersion: number;
  /** Highest version ever enqueued, applied or not. */
  enqueuedVersion: number;
}

export function createFabricLandingQueue(): FabricLandingQueue {
  return {
    items: [],
    phase: 'open',
    growCursor: 0,
    reconcile: null,
    deltaStreak: 0,
    landedVersion: -1,
    enqueuedVersion: -1,
  };
}

export function enqueueFabricLanding(
  queue: FabricLandingQueue,
  item: FabricLandingItem,
): void {
  queue.items.push(item);
  queue.enqueuedVersion = Math.max(queue.enqueuedVersion, item.version);
}

/**
 * Drop every pending item, because the fabric underneath them is gone.
 *
 * The one caller is the remount handler, which rehydrates the fresh fabric
 * from the owner's latest published selection — that is exactly the state the
 * newest enqueued item would have produced, so `landedVersion` jumps to the
 * enqueued version rather than stalling a consumer forever on work that can
 * never be applied. The streak resets with it: the next landing after a
 * remount is a full reconcile anyway (its epoch is dirty).
 */
export function resetFabricLandingQueue(queue: FabricLandingQueue): void {
  queue.items.length = 0;
  queue.phase = 'open';
  queue.growCursor = 0;
  queue.reconcile = null;
  queue.deltaStreak = 0;
  queue.landedVersion = Math.max(queue.landedVersion, queue.enqueuedVersion);
}

export interface FabricLandingDrainOptions {
  readonly handles: FabricLandingHandles;
  /** Wall milliseconds this drain may spend. Zero still does one step. */
  readonly budgetMs: number;
  /** Sim seconds at drain time: a birth's `bornAt` and a death's `dyingAt`. */
  readonly nowSec: number;
  /** Injected wall clock, so a test spends a budget without a real one. */
  readonly nowMs: () => number;
  /** Edges per grow chunk. Defaults to {@link FABRIC_LANDING_GROW_CHUNK}. */
  readonly growChunk?: number;
  /** Edges per reconcile scan step. Defaults to
   *  {@link FABRIC_RECONCILE_SCAN_CHUNK}. */
  readonly scanChunk?: number;
}

export interface FabricLandingDrainReport {
  /** Edges handed to `growEdges` in this drain. */
  readonly grown: number;
  /** Keys handed to `killEdges` in this drain (delta kills + prune strays). */
  readonly killed: number;
  /** Full `setFabric` reconciles applied in this drain. */
  readonly reconciled: number;
  /** Periodic prunes run in this drain. */
  readonly pruned: number;
  /** Handle calls issued — the drain's unit of progress. */
  readonly steps: number;
  /** Items still waiting (head included) when the drain returned. */
  readonly pending: number;
  /** `queue.landedVersion` after the drain, for the caller's ref. */
  readonly landedVersion: number;
}

/**
 * Apply as much landed fabric work as the budget allows, in strict FIFO order.
 *
 * Always makes progress: the budget is checked only once a step has been
 * issued, so a zero budget still lands one step per call and a queue can never
 * stall behind a frame that was already over its time.
 */
export function drainFabricLandingQueue(
  queue: FabricLandingQueue,
  options: FabricLandingDrainOptions,
): FabricLandingDrainReport {
  const { handles, budgetMs, nowSec, nowMs } = options;
  const growChunk = Math.max(1, options.growChunk ?? FABRIC_LANDING_GROW_CHUNK);
  const scanChunk = Math.max(1, options.scanChunk ?? FABRIC_RECONCILE_SCAN_CHUNK);
  const startedAtMs = nowMs();
  let grown = 0;
  let killed = 0;
  let reconciled = 0;
  let pruned = 0;
  let steps = 0;
  // Only a step that issued work spends the budget, and the budget is read
  // only where work is about to be issued — a phase with nothing to do (an
  // empty kill set, a delta with no additions, an item whose streak is not up)
  // must not cost a frame, or an item would take one extra frame to retire and
  // `landedVersion` would trail the fabric it describes.
  const spent = (): boolean => steps > 0 && nowMs() - startedAtMs >= budgetMs;

  while (queue.items.length > 0) {
    const item = queue.items[0];

    if (queue.phase === 'open') {
      if (item.delta === null) {
        if (spent()) break;
        // The compaction opens: the staggered remainder of whatever came
        // before is flushed and the selection's width tier published, both
        // facts about the WHOLE selection and neither of them a diff.
        queue.reconcile = handles.beginSetFabric(
          item.passiveGraph,
          item.cells,
          nowSec,
        );
        queue.phase = 'scan';
        steps += 1;
        continue;
      }
      if (item.delta.removed.length > 0) {
        if (spent()) break;
        const { killKeys } = planSelectionDeltaUpdate(
          { added: NO_EDGES, removed: item.delta.removed },
          nowSec,
        );
        // All at once: a kill only marks decay, so it is O(keys) map writes
        // and never the grain a budget has to break up.
        if (killKeys.length > 0) {
          handles.killEdges(killKeys, nowSec, 'gc');
          killed += killKeys.length;
        }
        steps += 1;
      }
      queue.phase = 'grow';
      queue.growCursor = 0;
      queue.deltaStreak += 1;
      continue;
    }

    if (queue.phase === 'scan') {
      if (spent()) break;
      const reconcile = queue.reconcile;
      // Only a landing that superseded this one nulls the scratch, and that
      // empties the queue with it; this is the defensive half of the pair.
      if (reconcile === null) {
        queue.phase = 'open';
        continue;
      }
      // A scan over an immutable edge list, cut wherever the budget falls: it
      // writes its findings into the scratch and never into the fabric, so the
      // cut costs nothing but the scratch if the landing is superseded.
      if (handles.stepSetFabric(reconcile, scanChunk)) queue.phase = 'commit';
      steps += 1;
      continue;
    }

    if (queue.phase === 'commit') {
      if (spent()) break;
      const reconcile = queue.reconcile;
      if (reconcile === null) {
        queue.phase = 'open';
        continue;
      }
      // One pass, uninterrupted: half of a compaction is not a smaller
      // compaction, it is a wrong fabric.
      handles.commitSetFabric(reconcile);
      queue.reconcile = null;
      queue.deltaStreak = 0;
      reconciled += 1;
      steps += 1;
      completeHead(queue, item);
      continue;
    }

    if (queue.phase === 'grow') {
      const added = item.delta?.added ?? NO_EDGES;
      if (queue.growCursor < added.length) {
        if (spent()) break;
        const end = Math.min(added.length, queue.growCursor + growChunk);
        const chunk = added.slice(queue.growCursor, end);
        // The translation lives here so the chunk's births carry THIS frame's
        // clock; the maps are chunk-sized, not delta-sized.
        const { bornAtByKey, dirByKey } = planSelectionDeltaUpdate(
          { added: chunk, removed: NO_EDGES },
          nowSec,
        );
        handles.growEdges(chunk, item.cells, bornAtByKey, dirByKey);
        grown += chunk.length;
        queue.growCursor = end;
        steps += 1;
        continue;
      }
      queue.phase = 'prune';
    }

    // `prune`: the periodic reconcile, after this item's grows so a stroke
    // this build asked for is never read as a stray of the build before it.
    if (queue.deltaStreak >= FABRIC_LANDING_RECONCILE_EVERY) {
      if (spent()) break;
      queue.deltaStreak = 0;
      const extras = selectionStrayEdgeKeys(
        item.passiveGraph.edges,
        handles.collectLiveEdgeKeys(),
      );
      if (extras.length > 0) {
        handles.killEdges(extras, nowSec, 'gc');
        killed += extras.length;
      }
      pruned += 1;
      steps += 1;
    }
    completeHead(queue, item);
  }

  return {
    grown,
    killed,
    reconciled,
    pruned,
    steps,
    pending: queue.items.length,
    landedVersion: queue.landedVersion,
  };
}

/** Retire the head item: its version has now fully landed. */
function completeHead(
  queue: FabricLandingQueue,
  item: FabricLandingItem,
): void {
  queue.items.shift();
  queue.phase = 'open';
  queue.growCursor = 0;
  queue.landedVersion = Math.max(queue.landedVersion, item.version);
}
