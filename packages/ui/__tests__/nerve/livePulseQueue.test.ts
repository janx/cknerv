// The frame-sliced planner driver. What it must keep exactly: the pulses,
// their order, their departure clock and every stats bump the one-task
// planner produced. What it must add: bounded main-thread work per frame,
// guaranteed progress, completion before the first departure, FIFO
// threading of the block-guarantee watermark, and reorg pruning of links
// that were never admitted.

import { beforeEach, describe, expect, it } from 'vitest';
import type { Cell, CellLink } from '@cknerv/types';
import type { NeighborGraph } from '../../src/geometry/neighborGraph';
import type { Pulse, PulsePlanningOptions } from '../../src/nerve/pulseRunner';
import {
  openLinkBatch,
  planLinkBatch,
  type PulseBatchStats,
} from '../../src/nerve/pulseBatch';
import {
  LIVE_PLAN_BUDGET_MS,
  LIVE_PLAN_BUDGET_FRAME_FRACTION,
  LIVE_PLAN_DEADLINE_MARGIN_S,
  createLivePulseQueue,
  enqueueLivePulseBatch,
  livePlanBudgetMs,
  pruneLivePulseQueue,
  stepLivePulseQueue,
  type LivePulseBatch,
  type LivePulseStepContext,
} from '../../src/nerve/livePulseQueue';
import { pulseStats, resetPulseStats, snapshotPulseStats } from '../../src/nerve/pulseStats';

beforeEach(() => resetPulseStats());

describe('livePlanBudgetMs — the wall-relative slice budget', () => {
  it('holds the floor on a fast frame and scales up on a slow one', () => {
    // A 60 Hz frame's 12% is under the floor → the 2 ms floor holds.
    expect(livePlanBudgetMs(1000 / 60)).toBe(LIVE_PLAN_BUDGET_MS);
    expect(livePlanBudgetMs(0)).toBe(LIVE_PLAN_BUDGET_MS);
    // A 30 Hz frame (~33 ms) buys ~4 ms — more than one 60 Hz grain, so the
    // slack is spent before the deadline forces the hand.
    expect(livePlanBudgetMs(1000 / 30)).toBeCloseTo(
      (1000 / 30) * LIVE_PLAN_BUDGET_FRAME_FRACTION, 12,
    );
    expect(livePlanBudgetMs(1000 / 30)).toBeGreaterThan(LIVE_PLAN_BUDGET_MS);
    // Non-finite / negative intervals fall back to the floor, never NaN.
    expect(livePlanBudgetMs(Number.NaN)).toBe(LIVE_PLAN_BUDGET_MS);
    expect(livePlanBudgetMs(-5)).toBe(LIVE_PLAN_BUDGET_MS);
  });
});

const CH = '0x' + '00'.repeat(32);
function mkCell(id: number, pos: [number, number, number]): Cell {
  return {
    id, born_at_ms: 0, death_at_ms: null, birth_block: 1, tag: null, pos_seed: pos,
    out_point: { tx_hash: '0x', index: 0 }, capacity: 0, data_hex: '0x', data_bytes: 0,
    content_hash: CH, lock_shape_seed: [1, 2], type_shape_seed: null, data_shape_seed: [3, 4],
  };
}
function mkLink(over: Partial<CellLink> = {}): CellLink {
  return {
    seq: 1, tx_hash: '0xtx', block: 1, from_ids: [], to_ids: [2], endpoint_anchors: [],
    parents: ['0xparent'], tag: null, at_ms: 0, ...over,
  };
}
function mkGraph(edges: [number, number][]): NeighborGraph {
  const adjacency = new Map<number, Set<number>>();
  const add = (a: number, b: number) => {
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    if (!adjacency.has(b)) adjacency.set(b, new Set());
    adjacency.get(a)!.add(b);
    adjacency.get(b)!.add(a);
  };
  for (const [a, b] of edges) add(a, b);
  return { adjacency, edges: edges.map(([a, b]) => ({ from: Math.min(a, b), to: Math.max(a, b), d: 1 })) };
}
const OPTS: PulsePlanningOptions = {};

function fixture() {
  const cells = new Map<number, Cell>([
    [1, mkCell(1, [0, 0, 0])], [2, mkCell(2, [10, 0, 0])], [3, mkCell(3, [20, 0, 0])],
    [4, mkCell(4, [30, 0, 0])], [5, mkCell(5, [40, 0, 0])],
  ]);
  const graph = mkGraph([[1, 2], [2, 3], [3, 4], [4, 5]]);
  let seq = 0;
  const spend = (block: number, to: number, x: number) => mkLink({
    seq: ++seq, block, tx_hash: `0xtx${seq}`, to_ids: [to],
    endpoint_anchors: [{ id: 70 + seq, pos_seed: [x, 0, 0], content_hash: CH, resolved: true }],
  });
  const cold = (block: number, to: number) => mkLink({
    seq: ++seq, block, tx_hash: `0xcold${seq}`, parents: ['0xcold'], to_ids: [to],
    endpoint_anchors: [{ id: to, pos_seed: [10, 0, 0], content_hash: CH, resolved: true }],
  });
  const links: CellLink[] = [
    spend(7, 4, 0), spend(7, 5, 11), cold(7, 2),
    cold(8, 2),
    spend(9, 2, 0), spend(9, 3, 21), spend(9, 5, 0), spend(9, 2, 31),
    cold(10, 99),
    spend(11, 3, 40),
  ];
  return { cells, graph, links };
}

interface Admitted { pulse: Pulse; startSec: number; batch: LivePulseBatch }

/** A fake wall clock advanced by the stats sink: every `observeLink` (one
 *  per planned link) costs `stepCostMs`, so a frame's budget is spent in
 *  units the test controls. */
function makeDriver(stepCostMs: number, budgetMs: number) {
  let wallMs = 0;
  let clockReads = 0;
  let linkSteps = 0;
  const stats: PulseBatchStats = {
    bump: (r, n) => pulseStats.bump(r, n),
    bumpPath: (r, n) => pulseStats.bumpPath(r, n),
    bumpOrigin: (k, n) => pulseStats.bumpOrigin(k, n),
    bumpRescue: (k, n) => pulseStats.bumpRescue(k, n),
    bumpRingEvicted: (n) => pulseStats.bumpRingEvicted(n),
    observeLink: (b, lit) => {
      wallMs += stepCostMs;
      linkSteps += 1;
      pulseStats.observeLink(b, lit);
    },
  };
  const admitted: Admitted[] = [];
  const completed: number[] = [];
  let watermark = 0;
  const ctx: LivePulseStepContext = {
    nowSec: 0,
    nowMs: () => { clockReads += 1; return wallMs; },
    budgetMs,
    stats,
    lastGuaranteedBlock: () => watermark,
    admit: (pulse, batch) => admitted.push({ pulse, startSec: batch.startSec, batch }),
    complete: (guaranteed) => { watermark = guaranteed; completed.push(guaranteed); },
  };
  return {
    ctx, stats, admitted, completed,
    get watermark() { return watermark; },
    get clockReads() { return clockReads; },
    get linkSteps() { return linkSteps; },
  };
}

describe('stepLivePulseQueue — sliced over frames, the one-task plan', () => {
  it('yields the same pulses, in order, with the arrival-stamped departure, and the same stats', () => {
    const { cells, graph, links } = fixture();
    const oneShot = planLinkBatch(links, 0, false, cells, graph, OPTS, pulseStats, 0);
    const oneShotStats = snapshotPulseStats();
    resetPulseStats();

    const driver = makeDriver(0.5, LIVE_PLAN_BUDGET_MS);
    const queue = createLivePulseQueue();
    const { toFire, nextSeq } = openLinkBatch(links, 0, false, driver.stats);
    expect(nextSeq).toBe(oneShot.nextSeq);
    const startSec = 12.75;
    enqueueLivePulseBatch(queue, toFire, cells, graph, OPTS, startSec, {});
    const frames: number[] = [];
    let prevLinkSteps = 0;
    for (let frame = 0; frame < 100 && queue.batches.length > 0; frame++) {
      driver.ctx.nowSec = frame / 60; // far from the deadline
      const report = stepLivePulseQueue(queue, driver.ctx);
      frames.push(report.steps);
      expect(report.forcedByDeadline).toBe(false);
      // The budget bounds the COST-BEARING grains: at 0.5 ms per link step and
      // a 2 ms budget at most four land per frame (the fifth is predicted at
      // 2.5 ms). The free grid step and lit-block flush steps (each its own
      // step now) ride along without spending the budget.
      const costly = driver.linkSteps - prevLinkSteps;
      prevLinkSteps = driver.linkSteps;
      expect(costly).toBeLessThanOrEqual(4);
      expect(report.pending).toBe(queue.batches.length > 0);
    }
    expect(frames.length).toBeGreaterThan(2);
    expect(Math.max(...frames)).toBeGreaterThanOrEqual(4);
    expect(driver.admitted.map((a) => a.pulse)).toEqual(oneShot.planned);
    expect(driver.admitted.every((a) => a.startSec === startSec)).toBe(true);
    expect(driver.completed).toEqual([oneShot.lastGuaranteedBlock]);
    expect(snapshotPulseStats()).toEqual(oneShotStats);
  });

  it('always makes progress: a zero budget still plans exactly one link per frame', () => {
    const { cells, graph, links } = fixture();
    const driver = makeDriver(1, 0);
    const queue = createLivePulseQueue();
    const { toFire } = openLinkBatch(links, 0, false, driver.stats);
    enqueueLivePulseBatch(queue, toFire, cells, graph, OPTS, 100, {});
    let frames = 0;
    let planned = 0;
    while (queue.batches.length > 0) {
      const before = queue.batches[0].planner?.pending ?? toFire.length;
      const report = stepLivePulseQueue(queue, driver.ctx);
      const after = queue.batches[0]?.planner?.pending ?? 0;
      expect(report.steps).toBeGreaterThanOrEqual(1);
      // A link step costs 1 ms against a 0 ms budget, so no frame plans a
      // second link; the free grid and flush steps may ride along.
      expect(before - after).toBeLessThanOrEqual(1);
      planned += before - after;
      frames += 1;
    }
    expect(planned).toBe(toFire.length);
    expect(frames).toBeGreaterThanOrEqual(toFire.length);
  });

  it('does not drain at the deadline: the remainder defers under budget, no pulse lost', () => {
    const { cells, graph, links } = fixture();
    const oneShot = planLinkBatch(links, 0, false, cells, graph, OPTS, pulseStats, 0);
    resetPulseStats();
    const driver = makeDriver(5, 0); // every cost-bearing step blows the budget
    const queue = createLivePulseQueue();
    const { toFire } = openLinkBatch(links, 0, false, driver.stats);
    const startSec = 30;
    enqueueLivePulseBatch(queue, toFire, cells, graph, OPTS, startSec, {});
    // Outside the margin: budget-bound, one cost-bearing step per frame, and
    // NOT flagged forced.
    driver.ctx.nowSec = startSec - LIVE_PLAN_DEADLINE_MARGIN_S - 0.001;
    const before = stepLivePulseQueue(queue, driver.ctx);
    expect(before).toMatchObject({ pending: true, forcedByDeadline: false });

    // Now inside the margin (well past it, even): the batch is FLAGGED forced,
    // but it still respects the budget — the remainder defers to later frames
    // rather than draining in one long grain, and no pulse is lost.
    driver.ctx.nowSec = startSec;
    let frames = 1;
    let anyForced = false;
    let maxCostlyPerFrame = 0;
    let prevLinkSteps = driver.linkSteps;
    while (queue.batches.length > 0) {
      const report = stepLivePulseQueue(queue, driver.ctx);
      anyForced = anyForced || report.forcedByDeadline;
      const costly = driver.linkSteps - prevLinkSteps;
      prevLinkSteps = driver.linkSteps;
      if (costly > maxCostlyPerFrame) maxCostlyPerFrame = costly;
      // The whole batch never drains in one frame: a 5 ms step over a 0 ms
      // budget always defers, deadline pressure or not.
      if (queue.batches.length > 0) expect(report.pending).toBe(true);
      frames += 1;
    }
    expect(anyForced).toBe(true); // deadline pressure was seen and counted
    expect(maxCostlyPerFrame).toBeLessThanOrEqual(1); // budget held under the deadline
    expect(frames).toBeGreaterThan(2); // spread over frames, not one drain
    // No pulse dropped and every departure clock unchanged: the same plan the
    // one-shot planner produced, just spread across more frames.
    expect(driver.admitted.map((a) => a.pulse)).toEqual(oneShot.planned);
    expect(driver.admitted.every((a) => a.startSec === startSec)).toBe(true);
  });

  it('threads the block-guarantee watermark FIFO: a later batch is opened with the earlier one\'s result', () => {
    const { cells, graph } = fixture();
    const lit = mkLink({
      seq: 1, block: 7, to_ids: [4],
      endpoint_anchors: [{ id: 71, pos_seed: [0, 0, 0], content_hash: CH, resolved: true }],
    });
    const coldSlice = mkLink({
      seq: 2, block: 7, tx_hash: '0xcold2', parents: ['0xcold'], to_ids: [2],
      endpoint_anchors: [{ id: 2, pos_seed: [10, 0, 0], content_hash: CH, resolved: true }],
    });
    // Reference: two one-shot batches threaded by hand never rescue block 7.
    const a = planLinkBatch([lit], 0, false, cells, graph, OPTS, pulseStats, 0);
    const b = planLinkBatch([lit, coldSlice], a.nextSeq, false, cells, graph, OPTS, pulseStats, a.lastGuaranteedBlock);
    const reference = [...a.planned, ...b.planned];
    const referenceStats = snapshotPulseStats();
    expect(referenceStats.rescues.rim).toBe(0);
    resetPulseStats();

    const driver = makeDriver(1, 0);
    const queue = createLivePulseQueue();
    const first = openLinkBatch([lit], 0, false, driver.stats);
    enqueueLivePulseBatch(queue, first.toFire, cells, graph, OPTS, 10, {});
    // The second delta arrives before the first batch planned anything.
    const second = openLinkBatch([lit, coldSlice], first.nextSeq, false, driver.stats);
    enqueueLivePulseBatch(queue, second.toFire, cells, graph, OPTS, 11, {});
    expect(queue.batches[1].planner).toBeNull();
    while (queue.batches.length > 0) stepLivePulseQueue(queue, driver.ctx);
    expect(driver.completed).toEqual([7, 7]);
    expect(driver.admitted.map((x) => x.pulse)).toEqual(reference);
    expect(snapshotPulseStats()).toEqual(referenceStats);
  });

  it('plans against the display pair captured at arrival, not whatever the caller holds later', () => {
    const { cells, graph, links } = fixture();
    const driver = makeDriver(1, 0);
    const queue = createLivePulseQueue();
    const { toFire } = openLinkBatch(links, 0, false, driver.stats);
    const batch = enqueueLivePulseBatch(queue, toFire, cells, graph, OPTS, 10, {});
    // The caller's live refs move on (a later build swapped its graph).
    const swappedCells = new Map<number, Cell>();
    const swappedGraph = mkGraph([]);
    void swappedCells;
    void swappedGraph;
    while (queue.batches.length > 0) stepLivePulseQueue(queue, driver.ctx);
    expect(driver.admitted.length).toBeGreaterThan(0);
    for (const a of driver.admitted) {
      expect(a.batch).toBe(batch);
      expect(a.batch.cells).toBe(cells);
      expect(a.batch.graph).toBe(graph);
    }
  });

  it('an empty queue costs one length check: no clock read, nothing reported', () => {
    const driver = makeDriver(1, LIVE_PLAN_BUDGET_MS);
    const queue = createLivePulseQueue();
    expect(stepLivePulseQueue(queue, driver.ctx)).toEqual({
      steps: 0, admitted: 0, pending: false, forcedByDeadline: false, maxStepMs: 0,
    });
    expect(driver.clockReads).toBe(0);
  });

  it('reports the frame\'s longest planner step as maxStepMs', () => {
    const { cells, graph, links } = fixture();
    const driver = makeDriver(0.5, LIVE_PLAN_BUDGET_MS);
    const queue = createLivePulseQueue();
    const { toFire } = openLinkBatch(links, 0, false, driver.stats);
    // startSec far ahead so the slice is budget-bound, not deadline-forced.
    enqueueLivePulseBatch(queue, toFire, cells, graph, OPTS, 100, {});
    driver.ctx.nowSec = 0;
    const report = stepLivePulseQueue(queue, driver.ctx);
    // Several link steps at 0.5 ms each plus free grid/flush steps at 0 ms:
    // the frame's worst grain is exactly one link step. This is the reading
    // the driver folds into pulseStats.maxStepMs.
    expect(report.steps).toBeGreaterThan(1);
    expect(report.maxStepMs).toBeCloseTo(0.5, 12);
  });
});

describe('pruneLivePulseQueue — a reorg reaches links that were never admitted', () => {
  it('drops stale links from unopened batches and discards a batch left empty', () => {
    const { cells, graph, links } = fixture();
    const driver = makeDriver(1, 0);
    const queue = createLivePulseQueue();
    const { toFire } = openLinkBatch(links, 0, false, driver.stats);
    enqueueLivePulseBatch(queue, toFire, cells, graph, OPTS, 10, {});
    enqueueLivePulseBatch(queue, toFire.filter((l) => l.block >= 9), cells, graph, OPTS, 11, {});
    pruneLivePulseQueue(queue, 9);
    expect(queue.batches.length).toBe(1);
    expect(queue.batches[0].toFire.map((l) => l.block)).toEqual([7, 7, 7, 8]);
    while (queue.batches.length > 0) stepLivePulseQueue(queue, driver.ctx);
    expect(driver.admitted.every((a) => a.pulse.linkBlock < 9)).toBe(true);
    expect(driver.watermark).toBe(8);
  });

  it('prunes an opened batch in place: no admission and no rescue for a rolled-back block, watermark rewound', () => {
    const { cells, graph, links } = fixture();
    const driver = makeDriver(1, 0);
    const queue = createLivePulseQueue();
    const { toFire } = openLinkBatch(links, 0, false, driver.stats);
    enqueueLivePulseBatch(queue, toFire, cells, graph, OPTS, 10, {});
    // Block 7 planned (3 links), block 8's cold link open and dark.
    while (driver.linkSteps < 4) stepLivePulseQueue(queue, driver.ctx);
    const admittedBefore = driver.admitted.length;
    pruneLivePulseQueue(queue, 8);
    while (queue.batches.length > 0) stepLivePulseQueue(queue, driver.ctx);
    expect(driver.admitted.length).toBe(admittedBefore);
    expect(snapshotPulseStats().rescues.rim).toBe(0); // block 8 forfeited
    expect(driver.completed).toEqual([7]);
  });
});
