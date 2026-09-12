import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Cell } from '@cknerv/types';

import {
  createNeighborGraphBuilder,
  type NeighborGraphBuildResult,
} from '../../src/geometry/neighborGraphBuilder';
import {
  resetNeighborGraphBuilderStats,
  snapshotNeighborGraphBuilderStats,
} from '../../src/geometry/neighborGraphBuilderStats';
import {
  buildNeighborGraph,
  emptyPassiveSelection,
  type LivingNeighborGraph,
  type NeighborEdge,
  type PassiveSelection,
} from '../../src/geometry/neighborGraph';
import { buildPassiveNeighborGraph } from '../../src/geometry/passiveNeighborGraph';
import { beginFrameBudget, resetFrameBudget } from '../../src/nerve/frameBudget';

function cellAt(id: number, index: number): Cell {
  return {
    id,
    born_at_ms: 0,
    death_at_ms: null,
    birth_block: 1,
    tag: null,
    pos_seed: [index * 2, (index % 3) * 1.5, index % 2],
    out_point: { tx_hash: `0x${id}`, index: 0 },
    capacity: 1,
    data_hex: '0x',
    data_bytes: 0,
    content_hash: `0x${id}`,
    lock_shape_seed: [1, 2],
    type_shape_seed: null,
    data_shape_seed: [3, 4],
  };
}

/** A stage of `count` cells; `from` shifts the ids so a generation can churn
 *  its front while the rest of the lattice stands. */
function stage(count: number, from = 1): Map<number, Cell> {
  const entries: Array<[number, Cell]> = [];
  for (let index = 0; index < count; index += 1) {
    const id = from + index;
    entries.push([id, cellAt(id, index)]);
  }
  return new Map(entries);
}

const TOPOLOGY = { topology: { k: 3 }, includePassive: true, passiveEdgeBudget: 40 };

/** What a whole build of the same cells and the same continuity preference
 *  produces — the oracle a patched landing has to equal exactly. */
function wholeSelection(
  cells: Map<number, Cell>,
  preferredEdges: readonly NeighborEdge[],
): PassiveSelection {
  const graph = buildNeighborGraph(cells, TOPOLOGY.topology);
  return buildPassiveNeighborGraph(graph, {
    edgeBudget: TOPOLOGY.passiveEdgeBudget,
    preferredEdges,
  });
}

/** The consumer's half of the contract: it holds the graph and the selection
 *  the last build handed it, and hands both back at completion time. */
function heldBy(state: { graph: LivingNeighborGraph | null; passiveGraph: PassiveSelection | null }) {
  return () => ({ graph: state.graph, passiveGraph: state.passiveGraph });
}

function land(
  state: { graph: LivingNeighborGraph | null; passiveGraph: PassiveSelection | null },
  result: NeighborGraphBuildResult,
): void {
  state.graph = result.graph;
  state.passiveGraph = result.passiveGraph;
}

afterEach(() => {
  vi.useRealTimers();
  resetFrameBudget();
});

describe('a recovery that cannot run waits for a signal', () => {
  it('holds a hidden page for as long as it stays hidden, without a timer', async () => {
    vi.useFakeTimers();
    const before = snapshotNeighborGraphBuilderStats();
    const builder = createNeighborGraphBuilder({
      minWorkerCells: 0,
      workerFactory: () => { throw new Error('constructor failed'); },
      // The owner's own hook while `document.visibilityState === 'hidden'`.
      recoveryBudgetMs: () => 0,
    });
    let settled = false;
    const pending = builder.build(stage(24), TOPOLOGY).then((result) => {
      settled = true;
      return result;
    });
    // The first slice is scheduled as a real task; the budget refuses it.
    await vi.advanceTimersByTimeAsync(1);
    expect(snapshotNeighborGraphBuilderStats().recoveryPendingTasks)
      .toBe(before.recoveryPendingTasks + 1);
    const timers = vi.getTimerCount();

    // 400 ms of a hidden page: the 16 ms poll would have woken 25 times.
    await vi.advanceTimersByTimeAsync(400);
    expect(vi.getTimerCount()).toBe(timers);
    expect(timers).toBe(0);
    expect(settled).toBe(false);
    expect(snapshotNeighborGraphBuilderStats().recoverySlices)
      .toBe(before.recoverySlices);

    // The page comes back and the frame loop opens a ledger: the recovery
    // resumes on that, and on nothing else.
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(1);
    expect(snapshotNeighborGraphBuilderStats().recoveryPendingTasks)
      .toBe(before.recoveryPendingTasks + 1);
    builder.dispose();
    expect(await pending).toBeNull();
    expect(snapshotNeighborGraphBuilderStats().recoveryPendingTasks)
      .toBe(before.recoveryPendingTasks);
  });

  it('resumes on the frame the ledger opens, and finishes', async () => {
    let budget = 0;
    const builder = createNeighborGraphBuilder({
      minWorkerCells: 0,
      workerFactory: () => { throw new Error('constructor failed'); },
      recoveryBudgetMs: () => budget,
    });
    const pending = builder.build(stage(24), TOPOLOGY);
    await Promise.resolve();
    await new Promise((resolve) => { setTimeout(resolve, 0); });

    // Nothing runs while the ledger is closed, however many frames pass.
    const before = snapshotNeighborGraphBuilderStats().recoverySlices;
    for (let frame = 0; frame < 5; frame += 1) beginFrameBudget();
    await new Promise((resolve) => { setTimeout(resolve, 0); });
    expect(snapshotNeighborGraphBuilderStats().recoverySlices).toBe(before);

    // The ledger opens: the recovery takes its slices from there.
    budget = 4;
    beginFrameBudget();
    const result = await pending;
    expect(result?.graph.adjacency.size).toBe(24);
    expect(result?.passiveGraph?.edges.length).toBeGreaterThan(0);
    expect(snapshotNeighborGraphBuilderStats().recoverySlices)
      .toBeGreaterThan(before);
    builder.dispose();
  });
});

describe('a worker that stays down chains its recoveries', () => {
  it('rebuilds once and patches the held selection after that', async () => {
    resetNeighborGraphBuilderStats();
    const builder = createNeighborGraphBuilder({
      minWorkerCells: 0,
      workerFactory: () => { throw new Error('constructor failed'); },
    });
    const held: {
      graph: LivingNeighborGraph | null;
      passiveGraph: PassiveSelection | null;
    } = { graph: null, passiveGraph: emptyPassiveSelection() };

    // Three topology generations in a row, every one of them falling to the
    // main thread: a block's worth of churn at the front of the lattice each
    // time, as the display journal would deliver it.
    const generations = [stage(24, 1), stage(24, 3), stage(24, 5)];
    const deltas: Array<NeighborGraphBuildResult['passiveDelta']> = [];
    // Snapshots, not references: a patched landing merges into the held
    // selection IN PLACE, so the object every generation returns is the same
    // one and only a copy remembers what it held at the time.
    const landed: NeighborEdge[][] = [];
    const preferred: NeighborEdge[][] = [];
    for (const cells of generations) {
      preferred.push((held.passiveGraph?.edges ?? []).slice());
      const result = await builder.build(cells, {
        ...TOPOLOGY,
        preferredEdges: held.passiveGraph?.edges,
        reuseFrom: heldBy(held),
      });
      expect(result).not.toBeNull();
      deltas.push(result!.passiveDelta);
      const before = held.passiveGraph;
      land(held, result!);
      if (result!.passiveDelta !== null) {
        // A patched recovery merges into the very object the caller handed
        // back, so the fabric's records survive the landing.
        expect(result!.passiveGraph).toBe(before);
      }
      landed.push(result!.passiveGraph!.edges.slice());
    }

    // One whole rebuild — there was nothing to chain from — then two patches.
    expect(deltas[0]).toBeNull();
    expect(deltas[1]).not.toBeNull();
    expect(deltas[2]).not.toBeNull();
    const stats = snapshotNeighborGraphBuilderStats();
    expect(stats.recoveryCompleted).toBe(3);
    expect(stats.recoveryPatchedApplies).toBe(2);
    expect(stats.recoveryFullApplies).toBe(1);

    // THE ORACLE: the patched selection is the whole build's, edge for edge,
    // for every generation — which is the only thing that makes a delta
    // landing safe.
    generations.forEach((cells, index) => {
      const whole = wholeSelection(cells, preferred[index]);
      expect(landed[index], `generation ${index}`).toEqual(whole.edges);
    });
    // …and the delta is the churn, not the selection: a patch that replaced
    // everything would cost the fabric more than the whole reconcile it is
    // avoiding.
    const churn = deltas[1]!.added.length + deltas[1]!.removed.length;
    expect(churn).toBeGreaterThan(0);
    expect(churn).toBeLessThan(landed[1].length);
    builder.dispose();
  });

  it('rebuilds whole when the caller cannot prove what it holds', async () => {
    resetNeighborGraphBuilderStats();
    const builder = createNeighborGraphBuilder({
      minWorkerCells: 0,
      workerFactory: () => { throw new Error('constructor failed'); },
    });
    // No `reuseFrom` at all: a Lab, or a caller that keeps no selection.
    const first = await builder.build(stage(24), TOPOLOGY);
    expect(first?.passiveDelta).toBeNull();
    // A caller whose selection is empty has nothing the fabric has drawn, so
    // a patch against it would be one addition per edge.
    const second = await builder.build(stage(24, 3), {
      ...TOPOLOGY,
      reuseFrom: () => ({ graph: null, passiveGraph: emptyPassiveSelection() }),
    });
    expect(second?.passiveDelta).toBeNull();
    expect(snapshotNeighborGraphBuilderStats().recoveryPatchedApplies).toBe(0);
    builder.dispose();
  });

  it('carries the recovery apply counters on the fabric snapshot', async () => {
    resetNeighborGraphBuilderStats();
    const stats = snapshotNeighborGraphBuilderStats();
    expect(stats.recoveryPatchedApplies).toBe(0);
    expect(stats.recoveryFullApplies).toBe(0);
  });
});
