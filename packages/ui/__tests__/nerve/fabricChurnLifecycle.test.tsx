// Every way an edge can enter or leave the passive fabric, driven through the
// REAL NeuralFabric handles and read back from the lifecycle records the
// component writes to its GPU slots. The component is Canvas-bound only
// through `useFrame`/`useThree`, so a mocked r3f (the ConsensusRouteCamera
// precedent) is enough to hold the handles — nothing here needs a frame.
//
// The claim under test is one sentence: no edge may skip its lifecycle. An
// edge appears only through the growth window, leaves only through a decay or
// a retract, and a surviving edge is not touched at all by a whole-graph
// rebuild.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { Cell } from '@cknerv/types';
import {
  emptyNeighborGraph,
  type NeighborEdge,
  type NeighborGraph,
} from '../../src/geometry/neighborGraph';
import {
  DEATH_RETRACT_MS,
  DECAY_MS,
  GROWTH_MS,
  fabricEdgeRenderState,
  type EdgeLifecycle,
} from '../../src/nerve/fabricEdgeRender';
import { fabricEdgeKey } from '../../src/nerve/fabricOrder';
import {
  planMeshUpdate,
  planSelectionDeltaUpdate,
  selectionStrayEdgeKeys,
} from '../../src/nerve/livingMeshDriver';
import {
  resetFabricStats,
  snapshotFabricStats,
  type FabricDiffSample,
} from '../../src/nerve/fabricStats';
import { LIVE } from '../../src/tweaks/liveTweaks';
import { resetSimClock, simClock } from '../../src/tweaks/simClock';
import NeuralFabric, {
  type NeuralFabricHandles,
} from '../../src/nerve/NeuralFabric';
import type { FabricLifecycleRecord } from '../../src/nerve/fabricLifecycleSlots';

vi.mock('@react-three/fiber', () => ({
  useFrame: () => {},
  useThree: (selector?: (state: unknown) => unknown) => {
    const state = { size: { width: 1280, height: 720 } };
    return selector ? selector(state) : state;
  },
}));

/** Every static lifecycle record the component writes, in order. This is the
 *  exact payload the vertex stage animates from, so it is the honest place to
 *  read "which window is this edge in". */
const slotWrites = vi.hoisted(() => ({
  records: [] as FabricLifecycleRecord[],
}));

vi.mock('../../src/nerve/fabricLifecycleSlots', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('../../src/nerve/fabricLifecycleSlots')
  >();
  return {
    ...actual,
    writeFabricLifecycleSlot: (
      arrays: Parameters<typeof actual.writeFabricLifecycleSlot>[0],
      slotBaseSegment: number,
      record: FabricLifecycleRecord,
    ) => {
      slotWrites.records.push({ ...record });
      actual.writeFabricLifecycleSlot(arrays, slotBaseSegment, record);
    },
  };
});

/** Cells sit at x = id, so a lifecycle record's endpoints name its edge. */
function cell(id: number): Cell {
  return {
    id,
    born_at_ms: 0,
    death_at_ms: null,
    birth_block: 1,
    tag: null,
    pos_seed: [id, 0, 0],
    out_point: { tx_hash: `0x${id}`, index: 0 },
    capacity: 0,
    data_hex: '0x',
    data_bytes: 0,
    content_hash: `0x${String(id).padStart(64, '0')}`,
    lock_shape_seed: [1, 2],
    type_shape_seed: null,
    data_shape_seed: [3, 4],
  };
}

function cellsFor(ids: readonly number[]): Map<number, Cell> {
  return new Map(ids.map((id) => [id, cell(id)]));
}

/** Graph edges are canonical (from < to), as every builder emits them. */
function graphOf(pairs: ReadonlyArray<readonly [number, number]>): NeighborGraph {
  const graph = emptyNeighborGraph();
  for (const [from, to] of pairs) {
    graph.edges.push({ from, to, d: Math.abs(to - from), w: 0.5 });
    if (!graph.adjacency.has(from)) graph.adjacency.set(from, new Set());
    if (!graph.adjacency.has(to)) graph.adjacency.set(to, new Set());
    graph.adjacency.get(from)!.add(to);
    graph.adjacency.get(to)!.add(from);
  }
  return graph;
}

function edge(from: number, to: number): NeighborEdge {
  return { from, to, d: Math.abs(to - from), w: 0.5 };
}

/** The most recent record written for one edge, or undefined if the component
 *  never touched it (which is itself the assertion for a surviving edge). */
function recordFor(from: number, to: number): FabricLifecycleRecord | undefined {
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  for (let i = slotWrites.records.length - 1; i >= 0; i -= 1) {
    const record = slotWrites.records[i];
    if (Math.min(record.fromX, record.toX) !== lo) continue;
    if (Math.max(record.fromX, record.toX) !== hi) continue;
    return record;
  }
  return undefined;
}

function recordEdgeKeys(): string[] {
  return slotWrites.records.map((record) => (
    fabricEdgeKey(record.fromX, record.toX)
  ));
}

/** The lifecycle the shader evaluates, taken from a written record. */
function lifecycleOf(record: FabricLifecycleRecord): EdgeLifecycle {
  return {
    bornAt: record.bornAt,
    dyingAt: record.dyingAt,
    deathKind: record.deathKind,
    deadEnd: record.deadEnd,
    growDir: record.growDir,
  };
}

function lastDiff(): FabricDiffSample {
  const { recentDiffs } = snapshotFabricStats();
  return recentDiffs[recentDiffs.length - 1];
}

function mountFabric(allocationEdges?: number): NeuralFabricHandles {
  let handles: NeuralFabricHandles | null = null;
  render(
    <NeuralFabric
      allocationEdges={allocationEdges}
      onReady={(ready) => { handles = ready; }}
    />,
  );
  if (handles === null) throw new Error('NeuralFabric never handed over handles');
  return handles;
}

beforeEach(() => {
  slotWrites.records.length = 0;
  resetFabricStats();
  resetSimClock();
});

describe('fabric path 1 — an edge appears only through the growth window', () => {
  it('an admitted edge starts at its birth second, not at full strength', () => {
    const handles = mountFabric();
    handles.setFabric(graphOf([[1, 2]]), cellsFor([1, 2]), 40);

    const record = recordFor(1, 2)!;
    expect(record).toBeDefined();
    expect(record.bornAt).toBeCloseTo(40, 6);
    expect(record.dyingAt).toBeNull();

    const first = fabricEdgeRenderState(lifecycleOf(record), 40.1);
    expect(first.visible).toBe(true);
    expect(first.animating).toBe(true);
    expect(first.alphaMul).toBeLessThan(1);
    expect(first.tEnd).toBeLessThan(1);

    const settled = fabricEdgeRenderState(
      lifecycleOf(record),
      40 + GROWTH_MS / 1000,
    );
    expect(settled.alphaMul).toBe(1);
    expect(settled.tEnd).toBe(1);
    expect(settled.animating).toBe(false);
  });

  it('a live grow-in honours the driver ripple stagger and grow direction', () => {
    const handles = mountFabric();
    handles.setFabric(graphOf([[1, 2]]), cellsFor([1, 2]), 40);
    simClock.elapsedSec = 41;

    handles.growEdges(
      [edge(2, 5)],
      cellsFor([1, 2, 5]),
      new Map([[fabricEdgeKey(2, 5), 41.24]]),
      new Map([[fabricEdgeKey(2, 5), -1]]),
    );

    const record = recordFor(2, 5)!;
    expect(record.bornAt).toBeCloseTo(41.24, 6);
    expect(record.growDir).toBe(-1);
    // Its turn has not come: staggered starts stay hidden, never pop in.
    const waiting = fabricEdgeRenderState(lifecycleOf(record), 41.1);
    expect(waiting.visible).toBe(false);
    expect(waiting.animating).toBe(true);
    // ...and when it does, the tip extends from `to` back toward `from`.
    const growing = fabricEdgeRenderState(lifecycleOf(record), 41.34);
    expect(growing.visible).toBe(true);
    expect(growing.tEnd).toBe(1);
    expect(growing.tStart).toBeGreaterThan(0);
  });
});

describe('fabric path 2 — an edge leaves only through decay or retract', () => {
  it('a stage eviction fades full-length over DECAY_MS', () => {
    const handles = mountFabric();
    const cells = cellsFor([1, 5]);
    const graph = graphOf([[1, 5]]);
    handles.setFabric(graph, cells, 40);

    const removal = planMeshUpdate(
      { born: [], died: [], evicted: [1] },
      graph,
      cells,
      41,
      { k: 4 },
      60,
    );
    expect(removal.evictKeys).toEqual([fabricEdgeKey(1, 5)]);
    handles.killEdges(removal.evictKeys, 41, 'gc');

    const record = recordFor(1, 5)!;
    expect(record.dyingAt).toBeCloseTo(41, 6);
    expect(record.deathKind).toBe('gc');
    expect(record.deadEnd).toBeNull();

    const half = fabricEdgeRenderState(
      lifecycleOf(record),
      41 + DECAY_MS / 2000,
    );
    expect(half.alphaMul).toBeCloseTo(0.5, 6);
    expect(half.tStart).toBe(0);
    expect(half.tEnd).toBe(1);
    expect(half.flash).toBe(0);

    const done = fabricEdgeRenderState(
      lifecycleOf(record),
      41 + (DECAY_MS + 1) / 1000,
    );
    expect(done.reap).toBe(true);
    expect(done.visible).toBe(false);
  });

  it('a member death retracts from the dead end over DEATH_RETRACT_MS', () => {
    const handles = mountFabric();
    const cells = cellsFor([1, 5]);
    const graph = graphOf([[1, 5]]);
    handles.setFabric(graph, cells, 40);

    const removal = planMeshUpdate(
      { born: [], died: [1], evicted: [] },
      graph,
      cells,
      41,
      { k: 4 },
      60,
    );
    handles.killEdges(removal.deathKeys, 41, 'death', removal.deathEndByKey);

    const record = recordFor(1, 5)!;
    expect(record.deathKind).toBe('death');
    // Cell 1 is the lower id, so it is the `from` end of the canonical key.
    expect(record.deadEnd).toBe('from');

    const mid = fabricEdgeRenderState(
      lifecycleOf(record),
      41 + DEATH_RETRACT_MS / 2000,
    );
    expect(mid.tStart).toBeCloseTo(0.5, 6);
    expect(mid.tEnd).toBe(1);
    expect(mid.flash).toBeGreaterThan(0);

    const done = fabricEdgeRenderState(
      lifecycleOf(record),
      41 + (DEATH_RETRACT_MS + 1) / 1000,
    );
    expect(done.reap).toBe(true);
    expect(done.visible).toBe(false);
  });

  it('a second kill never restarts a death clock already running', () => {
    const handles = mountFabric();
    handles.setFabric(graphOf([[1, 5]]), cellsFor([1, 5]), 40);
    handles.killEdges([fabricEdgeKey(1, 5)], 41, 'gc');
    handles.killEdges([fabricEdgeKey(1, 5)], 41.5, 'gc');

    expect(recordFor(1, 5)!.dyingAt).toBeCloseTo(41, 6);
    expect(lastDiff().dying).toBe(0);
  });
});

describe('fabric path 3 — a whole-graph rebuild diffs, it never swaps', () => {
  it('drops N edges as N decaying lifecycles, not N absent keys', () => {
    const handles = mountFabric();
    const cells = cellsFor([1, 2, 3, 4, 5, 6]);
    handles.setFabric(graphOf([[1, 2], [2, 3], [3, 4], [4, 5]]), cells, 40);
    slotWrites.records.length = 0;

    handles.setFabric(graphOf([[1, 2], [4, 5], [5, 6]]), cells, 41);

    const diff = lastDiff();
    expect(diff.kind).toBe('setFabric');
    expect(diff.stable).toBe(2);   // 1|2 and 4|5 survive untouched
    expect(diff.added).toBe(1);    // 5|6 enters
    expect(diff.dying).toBe(2);    // 2|3 and 3|4 leave through a fade
    // The dropped pair is still HELD as state — a decaying lifecycle, not a
    // deleted key. 4 states + 1 admission, with nothing dropped on the floor.
    expect(diff.totalStates).toBe(5);
    expect(new Set(handles.collectLiveEdgeKeys())).toEqual(new Set([
      fabricEdgeKey(1, 2),
      fabricEdgeKey(4, 5),
      fabricEdgeKey(5, 6),
    ]));

    for (const [from, to] of [[2, 3], [3, 4]] as const) {
      const record = recordFor(from, to)!;
      expect(record.dyingAt).toBeCloseTo(41, 6);
      expect(record.deathKind).toBe('gc');
      const mid = fabricEdgeRenderState(
        lifecycleOf(record),
        41 + DECAY_MS / 2000,
      );
      expect(mid.visible).toBe(true);
      expect(mid.alphaMul).toBeCloseTo(0.5, 6);
    }
  });

  it('leaves a surviving edge untouched — no ramp restart on rebuild', () => {
    const handles = mountFabric();
    const cells = cellsFor([1, 2, 3, 4, 5, 6]);
    handles.setFabric(graphOf([[1, 2], [2, 3], [3, 4], [4, 5]]), cells, 40);
    slotWrites.records.length = 0;

    handles.setFabric(graphOf([[1, 2], [4, 5], [5, 6]]), cells, 41);

    // A rebuild rewrites the record of an edge whose lifecycle CHANGED and of
    // nothing else: the two kills and the one admission, never a survivor.
    expect(slotWrites.records).toHaveLength(3);
    expect(recordFor(1, 2)).toBeUndefined();
    expect(recordFor(4, 5)).toBeUndefined();
    expect(recordFor(5, 6)!.bornAt).toBeCloseTo(41, 6);
  });

  it('revives a returning edge at full length instead of regrowing it', () => {
    const handles = mountFabric();
    const cells = cellsFor([1, 2, 3]);
    handles.setFabric(graphOf([[1, 2], [2, 3]]), cells, 40);
    handles.setFabric(graphOf([[1, 2]]), cells, 41);
    expect(recordFor(2, 3)!.deathKind).toBe('gc');

    handles.setFabric(graphOf([[1, 2], [2, 3]]), cells, 41.5);

    const revived = recordFor(2, 3)!;
    expect(revived.dyingAt).toBeNull();
    expect(revived.deathKind).toBeNull();
    const now = fabricEdgeRenderState(lifecycleOf(revived), 41.5);
    expect(now.alphaMul).toBe(1);
    expect(now.tEnd).toBe(1);
    expect(lastDiff().revived).toBe(1);
  });
});

describe('fabric slot ownership survives lazy order and capacity clipping', () => {
  it('deduplicates a reaped same-key re-entry before the next full walk', () => {
    const handles = mountFabric(1); // three lifecycle slots
    const cells = cellsFor([1, 2, 3, 4, 5, 6, 7, 8]);
    const returningKey = fabricEdgeKey(1, 2);
    handles.setFabric(graphOf([[1, 2]]), cells, 40);
    handles.emitFabric(40);

    handles.killEdges([returningKey], 41, 'gc');
    handles.emitFabric(41);
    const reapedAt = 41 + DECAY_MS / 1000 + 0.01;
    handles.emitFabric(reapedAt);

    // The lazy order still contains the old key. Re-admission appends the same
    // key, then the fourth live edge forces a compacting walk at capacity 3.
    simClock.elapsedSec = reapedAt;
    handles.growEdges(
      [edge(1, 2), edge(3, 4), edge(5, 6), edge(7, 8)],
      cells,
      new Map(),
      new Map(),
    );
    slotWrites.records.length = 0;
    handles.emitFabric(reapedAt);

    const compactedKeys = recordEdgeKeys();
    expect(compactedKeys).toEqual([
      returningKey,
      fabricEdgeKey(3, 4),
      fabricEdgeKey(5, 6),
    ]);
    expect(new Set(compactedKeys).size).toBe(compactedKeys.length);
  });

  it('promotes a grow overflow ahead of fading afterimages', () => {
    const handles = mountFabric(1); // three lifecycle slots
    const cells = cellsFor([1, 2, 3, 4, 5, 6, 7, 8]);
    const afterimages = [
      fabricEdgeKey(1, 2),
      fabricEdgeKey(3, 4),
      fabricEdgeKey(5, 6),
    ];
    handles.setFabric(graphOf([[1, 2], [3, 4], [5, 6]]), cells, 40);
    handles.emitFabric(40);
    handles.killEdges(afterimages, 41, 'gc');
    simClock.elapsedSec = 41;
    handles.growEdges([edge(7, 8)], cells, new Map(), new Map());

    slotWrites.records.length = 0;
    handles.emitFabric(41);

    expect(recordEdgeKeys()).toEqual([
      fabricEdgeKey(7, 8),
      afterimages[0],
      afterimages[1],
    ]);
  });

  it('re-slots a trailing clipped afterimage when it becomes live again', () => {
    const handles = mountFabric(1); // three lifecycle slots
    const cells = cellsFor([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const initial = graphOf([[1, 2], [3, 4], [5, 6]]);
    const replacement = graphOf([[7, 8], [9, 10]]);
    handles.setFabric(initial, cells, 40);
    handles.emitFabric(40);

    // The replacement is live-first after compaction. It consumes two slots;
    // 1|2 keeps the third and trailing 3|4 + 5|6 survive only as state.
    handles.setFabric(replacement, cells, 41);
    handles.emitFabric(41);

    slotWrites.records.length = 0;
    handles.setFabric(graphOf([[7, 8], [9, 10], [3, 4]]), cells, 41.1);
    handles.emitFabric(41.1);

    expect(recordEdgeKeys()).toEqual([
      fabricEdgeKey(7, 8),
      fabricEdgeKey(9, 10),
      fabricEdgeKey(3, 4),
    ]);
  });

  it('promotes a deferred-cohort overflow ahead of pending afterimages', () => {
    const previous = {
      threshold: LIVE.cell.fabricStaggerThreshold,
      size: LIVE.cell.fabricCohortSize,
      interval: LIVE.cell.fabricCohortInterval,
    };
    try {
      LIVE.cell.fabricStaggerThreshold = 1;
      LIVE.cell.fabricCohortSize = 1;
      LIVE.cell.fabricCohortInterval = 0.25;

      const handles = mountFabric(1); // three lifecycle slots
      const cells = cellsFor([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      handles.setFabric(graphOf([[1, 2], [3, 4], [5, 6]]), cells, 40);
      handles.emitFabric(40);

      // With threshold 1 this applies one kill immediately. At 41.25 the
      // first deferred add (7|8) and kill land together while every slot is
      // still occupied, forcing the cohort-overflow full walk.
      handles.setFabric(graphOf([[7, 8], [9, 10]]), cells, 41);
      slotWrites.records.length = 0;
      handles.emitFabric(41.25);

      // The pump first writes the cohort kill in place; the final three writes
      // are the compacted prefix emitted by the structural walk it then arms.
      const compactedKeys = recordEdgeKeys().slice(-3);
      expect(compactedKeys).toContain(fabricEdgeKey(7, 8));
      expect(compactedKeys).toHaveLength(3);
    } finally {
      LIVE.cell.fabricStaggerThreshold = previous.threshold;
      LIVE.cell.fabricCohortSize = previous.size;
      LIVE.cell.fabricCohortInterval = previous.interval;
    }
  });
});

describe('worker selection delta reaches the fabric it is addressed to', () => {
  // The regression this pins: the delta path used to name edges in the
  // GEOMETRY layer's vocabulary (`${from}:${to}`), which the fabric map — keyed
  // `lo|hi` — matches never. Nothing errors; the removal simply never happens.
  it('a key in the graph vocabulary is silently skipped by every handle', () => {
    const handles = mountFabric();
    handles.setFabric(graphOf([[1, 5]]), cellsFor([1, 5]), 40);
    slotWrites.records.length = 0;

    handles.killEdges(['1:5'], 41, 'gc');

    expect(lastDiff().dying).toBe(0);
    expect(slotWrites.records).toHaveLength(0);
    expect(handles.collectLiveEdgeKeys()).toEqual([fabricEdgeKey(1, 5)]);
  });

  it('a translated delta decays what it removed and grows what it added', () => {
    const handles = mountFabric();
    const cells = cellsFor([1, 2, 3, 7]);
    handles.setFabric(graphOf([[1, 2], [2, 3]]), cells, 40);
    simClock.elapsedSec = 41;

    const update = planSelectionDeltaUpdate(
      { added: [edge(3, 7)], removed: [edge(2, 3)] },
      41,
    );
    handles.killEdges(update.killKeys, 41, 'gc');
    handles.growEdges([edge(3, 7)], cells, update.bornAtByKey, update.dirByKey);

    const removed = recordFor(2, 3)!;
    expect(removed.dyingAt).toBeCloseTo(41, 6);
    expect(removed.deathKind).toBe('gc');
    const added = recordFor(3, 7)!;
    expect(added.dyingAt).toBeNull();
    expect(added.bornAt).toBeCloseTo(41, 6);
    expect(fabricEdgeRenderState(lifecycleOf(added), 41.1).tEnd).toBeLessThan(1);
    expect(new Set(handles.collectLiveEdgeKeys())).toEqual(new Set([
      fabricEdgeKey(1, 2),
      fabricEdgeKey(3, 7),
    ]));
  });

  it('the periodic prune takes the strays and leaves the selection standing', () => {
    const handles = mountFabric();
    const cells = cellsFor([1, 2, 3, 4]);
    handles.setFabric(graphOf([[1, 2], [2, 3], [3, 4]]), cells, 40);

    const selection = graphOf([[1, 2], [2, 3]]);
    const strays = selectionStrayEdgeKeys(
      selection.edges,
      handles.collectLiveEdgeKeys(),
    );
    expect(strays).toEqual([fabricEdgeKey(3, 4)]);

    handles.killEdges(strays, 41, 'gc');
    expect(new Set(handles.collectLiveEdgeKeys())).toEqual(new Set([
      fabricEdgeKey(1, 2),
      fabricEdgeKey(2, 3),
    ]));
  });
});
