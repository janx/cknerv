// The fabric half of a landing, drained across frames. Everything here is
// order and budget: the queue exists to spend a 48 ms task a few milliseconds
// at a time, and it is only correct if the fabric sees the same calls in the
// same order it used to see them inside that one task.
import { describe, expect, it } from 'vitest';
import type { Cell } from '@cknerv/types';
import type { NeighborEdge } from '../../src/geometry/neighborGraph';
import { fabricEdgeKey } from '../../src/nerve/fabricOrder';
import {
  FABRIC_LANDING_BUDGET_MS,
  FABRIC_LANDING_RECONCILE_EVERY,
  createFabricLandingQueue,
  drainFabricLandingQueue,
  enqueueFabricLanding,
  fabricLandingBudgetMs,
  resetFabricLandingQueue,
  type FabricLandingHandles,
} from '../../src/nerve/fabricLandingQueue';

/** One handle call, as the fabric saw it. */
type Call =
  | { kind: 'kill'; keys: string[]; dyingAt: number }
  | { kind: 'grow'; edges: NeighborEdge[]; bornAt: number[]; dirs: (1 | -1)[] }
  | { kind: 'setFabric'; edges: number; now: number }
  | { kind: 'collect' };

/** A recording fabric with an injectable per-call wall cost, so a budget can
 *  be spent without a real clock. */
function makeHandles(options: {
  costPerEdgeMs?: number;
  costPerKillMs?: number;
  costPerReconcileMs?: number;
  liveKeys?: string[];
} = {}) {
  const calls: Call[] = [];
  let clockMs = 0;
  const handles: FabricLandingHandles = {
    growEdges(edges, _cells, bornAtByKey, dirByKey) {
      clockMs += (options.costPerEdgeMs ?? 0) * edges.length;
      calls.push({
        kind: 'grow',
        edges: [...edges],
        bornAt: edges.map((e) => bornAtByKey.get(fabricEdgeKey(e.from, e.to)) ?? -1),
        dirs: edges.map((e) => dirByKey.get(fabricEdgeKey(e.from, e.to)) ?? 1),
      });
    },
    killEdges(keys, dyingAt) {
      clockMs += (options.costPerKillMs ?? 0) * keys.length;
      calls.push({ kind: 'kill', keys: [...keys], dyingAt });
    },
    setFabric(graph, _cells, now) {
      clockMs += options.costPerReconcileMs ?? 0;
      calls.push({ kind: 'setFabric', edges: graph.edges.length, now });
    },
    collectLiveEdgeKeys() {
      calls.push({ kind: 'collect' });
      return options.liveKeys ?? [];
    },
  };
  return { handles, calls, nowMs: () => clockMs };
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

  it('applies a reconcile item whole, and it clears the delta streak', () => {
    const queue = createFabricLandingQueue();
    const h = makeHandles();
    queue.deltaStreak = 9;
    enqueueFabricLanding(queue, {
      version: 4,
      cells: NO_CELLS,
      passiveGraph: { edges: [edge(1, 2), edge(3, 4)] },
      delta: null,
    });
    const report = drainFabricLandingQueue(queue, {
      handles: h.handles,
      budgetMs: 0,
      nowSec: 12,
      nowMs: h.nowMs,
    });
    expect(report.reconciled).toBe(1);
    expect(h.calls).toEqual([{ kind: 'setFabric', edges: 2, now: 12 }]);
    expect(queue.deltaStreak).toBe(0);
    expect(queue.landedVersion).toBe(4);
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
