// The fabric half of a landing, drained across frames. Everything here is
// order and budget: the queue exists to spend a 48 ms task a few milliseconds
// at a time, and it is only correct if the fabric sees the same calls in the
// same order it used to see them inside that one task.
import { beforeEach, describe, expect, it } from 'vitest';
import type { Cell } from '@cknerv/types';
import type { NeighborEdge } from '../../src/geometry/neighborGraph';
import { fabricEdgeKey } from '../../src/nerve/fabricOrder';
import {
  FABRIC_LANDING_BUDGET_MS,
  FABRIC_LANDING_RECONCILE_EVERY,
  FABRIC_RECONCILE_SCAN_CHUNK,
  createFabricLandingQueue,
  drainFabricLandingQueue,
  enqueueFabricLanding,
  fabricLandingBudgetMs,
  fabricLandingEstimateMs,
  resetFabricLandingQueue,
  type FabricLandingHandles,
  type FabricWholeReconcile,
} from '../../src/nerve/fabricLandingQueue';
import {
  FRAME_BUDGET_BRIDGE_STEP,
  FRAME_BUDGET_FABRIC_DRAIN,
  FRAME_BUDGET_PLAN_SLICE,
  FRAME_HEAVY_BUDGET_MS,
  beginFrameBudget,
  frameBudgetRemainingMs,
  mayStartFrameWork,
  resetFrameBudget,
  snapshotFrameBudget,
  spendFrameBudget,
} from '../../src/nerve/frameBudget';

/** One handle call, as the fabric saw it. */
type Call =
  | { kind: 'kill'; keys: string[]; dyingAt: number }
  | { kind: 'grow'; edges: NeighborEdge[]; bornAt: number[]; dirs: (1 | -1)[] }
  | { kind: 'setFabric'; edges: number; now: number }
  | { kind: 'begin'; edges: number; now: number }
  | { kind: 'scan'; from: number; to: number }
  | { kind: 'commit'; scanned: number }
  | { kind: 'collect' };

/** A recording fabric with an injectable per-call wall cost, so a budget can
 *  be spent without a real clock. The whole reconcile is recorded in the three
 *  pieces the drain now drives it in — open the scratch, classify a slice of
 *  the new selection, commit — each with its own charge, so a test can price
 *  the real split (see `fabricWholeReconcile.test.tsx`) without a fabric. */
function makeHandles(options: {
  costPerEdgeMs?: number;
  costPerKillMs?: number;
  costPerBeginMs?: number;
  costPerScannedEdgeMs?: number;
  costPerCommitMs?: number;
  liveKeys?: string[];
} = {}) {
  const calls: Call[] = [];
  const stepMs: number[] = [];
  let clockMs = 0;
  const charge = (ms: number): void => {
    clockMs += ms;
    stepMs.push(ms);
  };
  const handles: FabricLandingHandles = {
    growEdges(edges, _cells, bornAtByKey, dirByKey) {
      charge((options.costPerEdgeMs ?? 0) * edges.length);
      calls.push({
        kind: 'grow',
        edges: [...edges],
        bornAt: edges.map((e) => bornAtByKey.get(fabricEdgeKey(e.from, e.to)) ?? -1),
        dirs: edges.map((e) => dirByKey.get(fabricEdgeKey(e.from, e.to)) ?? 1),
      });
    },
    killEdges(keys, dyingAt) {
      charge((options.costPerKillMs ?? 0) * keys.length);
      calls.push({ kind: 'kill', keys: [...keys], dyingAt });
    },
    beginSetFabric(graph, cells, now) {
      charge(options.costPerBeginMs ?? 0);
      calls.push({ kind: 'begin', edges: graph.edges.length, now });
      return {
        graph,
        cells,
        now,
        scanned: 0,
        liveKeys: new Set<string>(),
        addCandidates: new Map<string, NeighborEdge>(),
        addWeights: [],
        stable: 0,
        revived: 0,
        flushAdmitted: 0,
        overflowed: false,
        slotOwnershipChanged: false,
        wasPopulated: true,
      };
    },
    stepSetFabric(reconcile, edges) {
      const from = reconcile.scanned;
      const to = Math.min(reconcile.graph.edges.length, from + Math.max(1, edges));
      charge((options.costPerScannedEdgeMs ?? 0) * (to - from));
      calls.push({ kind: 'scan', from, to });
      reconcile.scanned = to;
      return to >= reconcile.graph.edges.length;
    },
    commitSetFabric(reconcile) {
      charge(options.costPerCommitMs ?? 0);
      calls.push({ kind: 'commit', scanned: reconcile.scanned });
    },
    collectLiveEdgeKeys() {
      calls.push({ kind: 'collect' });
      return options.liveKeys ?? [];
    },
  };
  return { handles, calls, stepMs, nowMs: () => clockMs };
}

function edge(from: number, to: number): NeighborEdge {
  return { from, to, d: 1 };
}

const NO_CELLS: ReadonlyMap<number, Cell> = new Map();

function item(
  version: number,
  added: NeighborEdge[],
  removed: NeighborEdge[],
  selection: NeighborEdge[] = added,
) {
  return {
    version,
    cells: NO_CELLS,
    passiveGraph: { edges: selection },
    delta: { added, removed },
  };
}

/** A whole reconcile: the item shape a supersession, a worker fallback, a
 *  remount or the boot enqueues — `delta === null`, the selection entire. */
function reconcileItem(version: number, edges: number) {
  return {
    version,
    cells: NO_CELLS,
    passiveGraph: {
      edges: Array.from({ length: edges }, (_, i) => edge(i * 2, i * 2 + 1)),
    },
    delta: null,
  };
}

/** A drain with an effectively unlimited budget. */
function drainAll(
  queue: ReturnType<typeof createFabricLandingQueue>,
  h: ReturnType<typeof makeHandles>,
  growChunk?: number,
) {
  return drainFabricLandingQueue(queue, {
    handles: h.handles,
    budgetMs: Number.POSITIVE_INFINITY,
    nowSec: 100,
    nowMs: h.nowMs,
    growChunk,
  });
}

describe('the fabric landing queue', () => {
  it('kills before it grows, because a grow revives a dying edge', () => {
    const queue = createFabricLandingQueue();
    const h = makeHandles();
    enqueueFabricLanding(queue, item(1, [edge(3, 4)], [edge(1, 2)]));
    drainAll(queue, h);
    expect(h.calls.map((c) => c.kind)).toEqual(['kill', 'grow']);
    expect(h.calls[0]).toMatchObject({ keys: [fabricEdgeKey(1, 2)] });
    expect(h.calls[1]).toMatchObject({ edges: [edge(3, 4)] });
  });

  it('drains builds strictly FIFO: build N grows before build N+1 kills', () => {
    const queue = createFabricLandingQueue();
    // Chained deltas: build 2 removes exactly what build 1 added, which is
    // only coherent if build 1 has fully landed first.
    const h = makeHandles();
    enqueueFabricLanding(queue, item(1, [edge(1, 2), edge(3, 4)], []));
    enqueueFabricLanding(queue, item(2, [edge(5, 6)], [edge(1, 2)]));
    // One edge per chunk, so build 1's grows are interleavable if the order
    // were not enforced.
    drainAll(queue, h, 1);
    expect(h.calls.map((c) => c.kind)).toEqual(['grow', 'grow', 'kill', 'grow']);
    expect(h.calls[0]).toMatchObject({ edges: [edge(1, 2)] });
    expect(h.calls[1]).toMatchObject({ edges: [edge(3, 4)] });
    expect(h.calls[2]).toMatchObject({ keys: [fabricEdgeKey(1, 2)] });
    expect(h.calls[3]).toMatchObject({ edges: [edge(5, 6)] });
  });

  it('chunks the grows and stops on the budget, resuming where it left off', () => {
    const queue = createFabricLandingQueue();
    // 1 ms per edge, chunks of 2 ⇒ 2 ms a chunk; a 5 ms budget takes three
    // chunks (the third starts at 4 ms, still inside the budget) and stops.
    const h = makeHandles({ costPerEdgeMs: 1 });
    const added = Array.from({ length: 10 }, (_, i) => edge(i * 2, i * 2 + 1));
    enqueueFabricLanding(queue, item(1, added, []));
    const first = drainFabricLandingQueue(queue, {
      handles: h.handles,
      budgetMs: 5,
      nowSec: 100,
      nowMs: h.nowMs,
      growChunk: 2,
    });
    expect(first.grown).toBe(6);
    expect(first.pending).toBe(1);
    expect(queue.growCursor).toBe(6);
    expect(h.calls).toHaveLength(3);
    const second = drainAll(queue, h, 2);
    expect(second.grown).toBe(4);
    expect(second.pending).toBe(0);
    // Every edge landed exactly once, in order.
    const grownEdges = h.calls.flatMap((c) => (c.kind === 'grow' ? c.edges : []));
    expect(grownEdges).toEqual(added);
  });

  it('always makes progress: a zero budget still issues one step per drain', () => {
    const queue = createFabricLandingQueue();
    const h = makeHandles({ costPerEdgeMs: 1000, costPerKillMs: 1000 });
    enqueueFabricLanding(queue, item(1, [edge(3, 4), edge(5, 6)], [edge(1, 2)]));
    for (const expected of ['kill', 'grow', 'grow'] as const) {
      const report = drainFabricLandingQueue(queue, {
        handles: h.handles,
        budgetMs: 0,
        nowSec: 100,
        nowMs: h.nowMs,
        growChunk: 1,
      });
      expect(report.steps).toBe(1);
      expect(h.calls[h.calls.length - 1]?.kind).toBe(expected);
    }
    expect(queue.items).toHaveLength(0);
  });

  it('stamps every birth with the clock of the frame it enters on', () => {
    const queue = createFabricLandingQueue();
    const h = makeHandles();
    enqueueFabricLanding(queue, item(1, [edge(1, 2), edge(3, 4)], []));
    drainFabricLandingQueue(queue, {
      handles: h.handles,
      budgetMs: 0,
      nowSec: 7,
      nowMs: h.nowMs,
      growChunk: 1,
    });
    drainFabricLandingQueue(queue, {
      handles: h.handles,
      budgetMs: 0,
      nowSec: 9,
      nowMs: h.nowMs,
      growChunk: 1,
    });
    expect(h.calls).toHaveLength(2);
    expect(h.calls[0]).toMatchObject({ bornAt: [7], dirs: [1] });
    expect(h.calls[1]).toMatchObject({ bornAt: [9], dirs: [1] });
  });

  it('applies a reconcile in three pieces, and it clears the delta streak', () => {
    const queue = createFabricLandingQueue();
    const h = makeHandles();
    queue.deltaStreak = 9;
    enqueueFabricLanding(queue, reconcileItem(4, 2));
    const report = drainAll(queue, h);
    expect(report.reconciled).toBe(1);
    // Open the scratch, classify the selection against the persistent slots,
    // then the one pass that decides deaths and admits births.
    expect(h.calls).toEqual([
      { kind: 'begin', edges: 2, now: 100 },
      { kind: 'scan', from: 0, to: 2 },
      { kind: 'commit', scanned: 2 },
    ]);
    expect(queue.deltaStreak).toBe(0);
    expect(queue.landedVersion).toBe(4);
    expect(queue.reconcile).toBeNull();
  });

  it('prunes the strays after the grows, on the sixteenth delta applied', () => {
    const queue = createFabricLandingQueue();
    // A live key the selection does not contain — the eager living mesh's
    // drift, which is the only direction drift can go while deltas chain.
    const stray = fabricEdgeKey(90, 91);
    const h = makeHandles({ liveKeys: [stray, fabricEdgeKey(1, 2)] });
    for (let i = 1; i <= FABRIC_LANDING_RECONCILE_EVERY; i += 1) {
      enqueueFabricLanding(queue, item(i, [edge(1, 2)], [], [edge(1, 2)]));
    }
    const report = drainAll(queue, h);
    expect(report.pruned).toBe(1);
    // The prune is the LAST thing the sixteenth item does: its own grow first.
    const tail = h.calls.slice(-3).map((c) => c.kind);
    expect(tail).toEqual(['grow', 'collect', 'kill']);
    expect(h.calls[h.calls.length - 1]).toMatchObject({ keys: [stray] });
    expect(queue.deltaStreak).toBe(0);
  });

  it('advances the landed version only when an item completes', () => {
    const queue = createFabricLandingQueue();
    const h = makeHandles();
    expect(queue.landedVersion).toBe(-1);
    enqueueFabricLanding(queue, item(1, [edge(1, 2), edge(3, 4)], [edge(5, 6)]));
    enqueueFabricLanding(queue, item(2, [edge(7, 8)], []));
    // Kills only: the item has not finished.
    drainFabricLandingQueue(queue, {
      handles: h.handles,
      budgetMs: 0,
      nowSec: 1,
      nowMs: h.nowMs,
      growChunk: 1,
    });
    expect(queue.landedVersion).toBe(-1);
    drainFabricLandingQueue(queue, {
      handles: h.handles,
      budgetMs: 0,
      nowSec: 1,
      nowMs: h.nowMs,
      growChunk: 1,
    });
    expect(queue.landedVersion).toBe(-1);
    // The second chunk finishes build 1 — and nothing of build 2 has run.
    const report = drainFabricLandingQueue(queue, {
      handles: h.handles,
      budgetMs: 0,
      nowSec: 1,
      nowMs: h.nowMs,
      growChunk: 1,
    });
    expect(report.landedVersion).toBe(1);
    expect(queue.landedVersion).toBe(1);
    expect(queue.items).toHaveLength(1);
    drainAll(queue, h);
    expect(queue.landedVersion).toBe(2);
  });

  it('drops queued deltas on a remount and carries the landed version to them', () => {
    const queue = createFabricLandingQueue();
    const h = makeHandles();
    enqueueFabricLanding(queue, item(1, [edge(1, 2)], []));
    enqueueFabricLanding(queue, item(2, [edge(3, 4)], []));
    queue.deltaStreak = 5;
    // The remount rehydrates the fabric from the newest published selection,
    // which is item 2's — so the queue is spent, not pending.
    resetFabricLandingQueue(queue);
    expect(queue.items).toHaveLength(0);
    expect(queue.deltaStreak).toBe(0);
    expect(queue.landedVersion).toBe(2);
    drainAll(queue, h);
    expect(h.calls).toHaveLength(0);
  });

  it('sizes the drain budget off the last frame, never under the floor', () => {
    // A quarter of the interval the frame actually followed…
    expect(fabricLandingBudgetMs(16.7)).toBeCloseTo(4.175, 6);
    expect(fabricLandingBudgetMs(32)).toBeCloseTo(8, 6);
    // …and the floor, which binds only under 12 ms.
    expect(fabricLandingBudgetMs(12)).toBe(FABRIC_LANDING_BUDGET_MS);
    expect(fabricLandingBudgetMs(8)).toBe(FABRIC_LANDING_BUDGET_MS);
    expect(fabricLandingBudgetMs(0)).toBe(FABRIC_LANDING_BUDGET_MS);
    expect(fabricLandingBudgetMs(-5)).toBe(FABRIC_LANDING_BUDGET_MS);
    expect(fabricLandingBudgetMs(Number.NaN)).toBe(FABRIC_LANDING_BUDGET_MS);
  });

  it('costs one length check on the frames with nothing to land', () => {
    const queue = createFabricLandingQueue();
    const h = makeHandles();
    const report = drainAll(queue, h);
    expect(report).toMatchObject({ steps: 0, pending: 0, landedVersion: -1 });
    expect(h.calls).toHaveLength(0);
  });
});

// The 12K stage's own numbers, measured through the REAL fabric over the
// bench's 12,000-Cell stage (`__tests__/helpers/fabricStageChain`, five
// chained whole reconciles): the tier and the cohort flush that open the
// scratch 0.7–2.9 ms, the classifying scan 4.3–7.7 ms over 8,000 edges, and
// the atomic pass that marks deaths and admits births 2.3–3.7 ms. The three
// medians are below. They are the shape of the grain, not a promise about any
// particular machine — what the cases assert is that the shape fits in a
// frame. (The BOOT reconcile is the exception by design: a first population
// from an empty set admits every edge in one cohort, 51 ms of the 64 there.)
const STAGE_EDGES = 8_000;
const STAGE_BEGIN_MS = 2.2;
const STAGE_SCAN_MS_PER_EDGE = 6.4 / STAGE_EDGES;
const STAGE_COMMIT_MS = 3.7;

function stageHandles() {
  return makeHandles({
    costPerBeginMs: STAGE_BEGIN_MS,
    costPerScannedEdgeMs: STAGE_SCAN_MS_PER_EDGE,
    costPerCommitMs: STAGE_COMMIT_MS,
  });
}

describe('the whole reconcile, sliced', () => {
  it('classifies the selection a bounded slice at a time', () => {
    const queue = createFabricLandingQueue();
    const h = stageHandles();
    enqueueFabricLanding(queue, reconcileItem(1, STAGE_EDGES));
    let steps = 0;
    let scanningFrames = 0;
    // Frames, as the owner drives them: each drain gets a quarter of a 60 Hz
    // interval and resumes exactly where the last one stopped.
    for (let frame = 0; frame < 40 && queue.items.length > 0; frame += 1) {
      const before = h.calls.filter((c) => c.kind === 'scan').length;
      steps += drainFabricLandingQueue(queue, {
        handles: h.handles,
        budgetMs: fabricLandingBudgetMs(16.7),
        nowSec: 100,
        nowMs: h.nowMs,
      }).steps;
      if (h.calls.filter((c) => c.kind === 'scan').length > before) {
        scanningFrames += 1;
      }
    }
    expect(queue.items).toHaveLength(0);
    expect(steps).toBeGreaterThanOrEqual(3);
    // The budget is read BETWEEN slices, so the scan spans frames: a drain
    // that slices internally and returns only when the whole selection is
    // classified has sliced nothing a frame can feel.
    expect(scanningFrames).toBeGreaterThanOrEqual(2);
    // No slice of the scan is a grain a frame has to swallow: the budget is
    // read between slices, so the largest one is a chunk's worth of work.
    const scans = h.calls.filter((c) => c.kind === 'scan');
    expect(scans.length).toBeGreaterThanOrEqual(3);
    for (const scan of scans) {
      expect(scan.to - scan.from).toBeLessThanOrEqual(FABRIC_RECONCILE_SCAN_CHUNK);
    }
    // Every edge classified exactly once, in order, and one atomic commit at
    // the end of them.
    expect(scans[0].from).toBe(0);
    expect(scans[scans.length - 1].to).toBe(STAGE_EDGES);
    for (let i = 1; i < scans.length; i += 1) {
      expect(scans[i].from).toBe(scans[i - 1].to);
    }
    expect(h.calls.filter((c) => c.kind === 'commit')).toHaveLength(1);
    expect(h.calls[h.calls.length - 1]).toMatchObject({ kind: 'commit' });
    // …and no step on the stage's own costs is a frame of its own.
    expect(Math.max(...h.stepMs)).toBeLessThanOrEqual(4);
  });

  it('spends one frame at a time on it, and resumes on the next', () => {
    const queue = createFabricLandingQueue();
    const h = stageHandles();
    enqueueFabricLanding(queue, reconcileItem(1, STAGE_EDGES));
    const budgetMs = fabricLandingBudgetMs(16.7);
    const perFrame: number[] = [];
    for (let frame = 0; frame < 40 && queue.items.length > 0; frame += 1) {
      const before = h.nowMs();
      drainFabricLandingQueue(queue, {
        handles: h.handles,
        budgetMs,
        nowSec: 100,
        nowMs: h.nowMs,
      });
      perFrame.push(h.nowMs() - before);
    }
    expect(perFrame.length).toBeGreaterThanOrEqual(2);
    // A frame overruns its budget by at most the one step it was inside.
    for (const spent of perFrame) {
      expect(spent).toBeLessThanOrEqual(budgetMs + STAGE_COMMIT_MS);
    }
    expect(queue.landedVersion).toBe(1);
  });

  it('discards the scratch when the landing under it is superseded', () => {
    const queue = createFabricLandingQueue();
    const h = stageHandles();
    enqueueFabricLanding(queue, reconcileItem(7, STAGE_EDGES));
    drainFabricLandingQueue(queue, {
      handles: h.handles,
      budgetMs: fabricLandingBudgetMs(16.7),
      nowSec: 100,
      nowMs: h.nowMs,
    });
    expect(queue.reconcile).not.toBeNull();
    expect(h.calls.some((c) => c.kind === 'commit')).toBe(false);
    // The remount rehydrated the fabric from the newest published selection,
    // so the half-classified scratch describes a fabric that no longer exists.
    resetFabricLandingQueue(queue);
    expect(queue.reconcile).toBeNull();
    expect(queue.phase).toBe('open');
    expect(queue.landedVersion).toBe(7);
    const after = h.calls.length;
    drainAll(queue, h);
    expect(h.calls).toHaveLength(after);
  });

  it('asks the frame for a whole heavy budget while a reconcile is at the head', () => {
    const queue = createFabricLandingQueue();
    // Nothing pending: there is nothing to ask for.
    expect(fabricLandingEstimateMs(queue, 2.5)).toBe(2.5);
    enqueueFabricLanding(queue, item(1, [edge(1, 2)], []));
    // A delta item is a chunked walk whose last cost predicts its next.
    expect(fabricLandingEstimateMs(queue, 2.5)).toBe(2.5);
    const whole = createFabricLandingQueue();
    enqueueFabricLanding(whole, reconcileItem(1, STAGE_EDGES));
    expect(fabricLandingEstimateMs(whole, 2.5)).toBe(FRAME_HEAVY_BUDGET_MS);
    // A drain that measured more than a frame keeps its own measurement.
    expect(fabricLandingEstimateMs(whole, 40)).toBe(40);
    expect(fabricLandingEstimateMs(whole, Number.NaN)).toBe(FRAME_HEAVY_BUDGET_MS);
  });
});

describe('the whole reconcile against the frame ledger', () => {
  beforeEach(() => resetFrameBudget());

  /** The owner's frame, in the order its consumers ask in: the drain on the
   *  raw priority −1 callback, then the bridge step from the child layer, then
   *  the live-plan slice last. Lane L2's simulation, driven by the REAL queue
   *  instead of a list of step costs. */
  function runFrames(queue: ReturnType<typeof createFabricLandingQueue>, h: ReturnType<typeof makeHandles>) {
    const heavyMs: number[] = [];
    let drainLast = 3;
    for (let frame = 1; frame <= 600; frame += 1) {
      beginFrameBudget(frame);
      if (
        queue.items.length > 0
        && mayStartFrameWork(
          FRAME_BUDGET_FABRIC_DRAIN,
          fabricLandingEstimateMs(queue, drainLast),
        )
      ) {
        const startedAt = h.nowMs();
        drainFabricLandingQueue(queue, {
          handles: h.handles,
          budgetMs: Math.min(
            fabricLandingBudgetMs(16.7),
            frameBudgetRemainingMs(FRAME_BUDGET_FABRIC_DRAIN),
          ),
          nowSec: 100,
          nowMs: h.nowMs,
        });
        drainLast = h.nowMs() - startedAt;
        spendFrameBudget(FRAME_BUDGET_FABRIC_DRAIN, drainLast);
      }
      if (mayStartFrameWork(FRAME_BUDGET_BRIDGE_STEP, 2.1)) {
        spendFrameBudget(FRAME_BUDGET_BRIDGE_STEP, 2.1);
      }
      if (mayStartFrameWork(FRAME_BUDGET_PLAN_SLICE, 2)) {
        spendFrameBudget(FRAME_BUDGET_PLAN_SLICE, 2);
      }
      heavyMs.push(snapshotFrameBudget().totalSpentMs);
      if (queue.items.length === 0) break;
    }
    return { heavyMs, window: snapshotFrameBudget().window };
  }

  it('never carries a frame past the heavy budget, and never lies about its cost', () => {
    const queue = createFabricLandingQueue();
    const h = stageHandles();
    enqueueFabricLanding(queue, reconcileItem(1, STAGE_EDGES));
    const { heavyMs, window } = runFrames(queue, h);
    expect(queue.items).toHaveLength(0);
    expect(heavyMs.filter((ms) => ms > FRAME_HEAVY_BUDGET_MS)).toEqual([]);
    // The drain asked for a whole frame and spent less: the ledger records no
    // overshoot, which is the difference between a bounded grain and a
    // 25 ms one admitted on a 3 ms promise.
    expect(window.estimateOvershootMs).toBe(0);
    expect(window.forcedByStarvation).toBe(0);
  });
});
