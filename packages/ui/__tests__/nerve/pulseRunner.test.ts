import { beforeEach, describe, expect, it } from 'vitest';
import type { Cell, CellLink, CellLinkEndpointAnchor } from '@cknerv/types';
import type { NeighborGraph } from '../../src/geometry/neighborGraph';
import {
  MAX_ORIGINS_PER_LINK,
  MAX_PULSES_PER_LINK,
  planPulses,
  pulseTiming,
} from '../../src/nerve/pulseRunner';
import { pulseStats, resetPulseStats } from '../../src/nerve/pulseStats';
import { consensusPacketColor } from '../../src/derives/consensusFlow.derive';

beforeEach(() => resetPulseStats());

/** The id family the server allocates for a consumed input it never
 *  retained (`COMPOSITION_ID_PREFIX | hash`): at or above 2^52, absent from
 *  `from_ids`, and — crucially — a perfectly valid pulse origin. */
const DERIVED_ID = 2 ** 52 + 12345;
const CH = '0x' + '00'.repeat(32);

function mkCell(id: number, pos: [number, number, number] = [0, 0, 0]): Cell {
  return {
    id,
    born_at_ms: 0,
    death_at_ms: null,
    birth_block: 1,
    tag: null,
    pos_seed: pos,
    out_point: { tx_hash: '0xborn', index: 0 },
    capacity: 0,
    data_hex: '0x',
    data_bytes: 0,
    content_hash: CH,
    lock_shape_seed: [1, 2],
    type_shape_seed: null,
    data_shape_seed: [3, 4],
  };
}
function mkAnchor(
  id: number,
  pos: [number, number, number],
  resolved = true,
): CellLinkEndpointAnchor {
  return {
    id,
    pos_seed: pos,
    content_hash: resolved ? CH : '',
    resolved,
  };
}
function mkLink(over: Partial<CellLink> = {}): CellLink {
  return {
    seq: 1,
    tx_hash: '0xtx',
    block: 1,
    from_ids: [],
    to_ids: [2],
    endpoint_anchors: [],
    parents: ['0xparent'],
    tag: null,
    at_ms: 0,
    ...over,
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
  return {
    adjacency,
    edges: edges.map(([a, b]) => ({ from: Math.min(a, b), to: Math.max(a, b), d: 1 })),
  };
}
function mkCells(...cells: Cell[]): Map<number, Cell> {
  return new Map(cells.map((cell) => [cell.id, cell]));
}

describe('planPulses origin selection — the link\'s own consumed inputs', () => {
  it('takes input anchors in wire order and pairs origin-outer × to_ids-inner', () => {
    const cells = mkCells(mkCell(1, [0, 0, 0]), mkCell(2, [100, 0, 0]), mkCell(40, [1, 0, 0]), mkCell(41, [2, 0, 0]));
    const graph = mkGraph([[1, 40], [1, 41], [2, 40], [2, 41]]);
    const pulses = planPulses(
      mkLink({
        to_ids: [40, 41],
        endpoint_anchors: [mkAnchor(77, [0, 0, 0]), mkAnchor(78, [100, 0, 0])],
      }),
      cells,
      graph,
      {},
      0,
    );
    expect(pulses.map((p) => [p.origin!.anchorId, p.path[p.path.length - 1]]))
      .toEqual([[77, 40], [77, 41], [78, 40], [78, 41]]);
  });

  it('caps origins at MAX_ORIGINS_PER_LINK, keeping the earliest anchors', () => {
    expect(MAX_ORIGINS_PER_LINK).toBe(2);
    const cells = mkCells(mkCell(1, [0, 0, 0]), mkCell(40, [1, 0, 0]));
    const graph = mkGraph([[1, 40]]);
    const anchors = [mkAnchor(77, [0, 0, 0]), mkAnchor(78, [0, 0, 0]), mkAnchor(79, [0, 0, 0])];
    const link = mkLink({ to_ids: [40], endpoint_anchors: anchors });
    expect(planPulses(link, cells, graph, {}, 0).map((p) => p.origin!.anchorId))
      .toEqual([77, 78]);
    // The knob narrows it further; nothing else about selection changes.
    expect(
      planPulses(link, cells, graph, { maxOriginsPerLink: 1 }, 0)
        .map((p) => p.origin!.anchorId),
    ).toEqual([77]);
  });

  it('reads input-side membership off to_ids, not from_ids — a derived anchor is a valid origin', () => {
    const cells = mkCells(mkCell(1, [0, 0, 0]), mkCell(40, [1, 0, 0]));
    const graph = mkGraph([[1, 40]]);
    const pulses = planPulses(
      mkLink({
        // `from_ids` deliberately omits the derived input (identity, not
        // content), and the output anchor sits in the same array.
        from_ids: [],
        to_ids: [40],
        endpoint_anchors: [
          mkAnchor(DERIVED_ID, [7, 0, 9], false),
          mkAnchor(40, [1, 0, 0]),
        ],
      }),
      cells,
      graph,
      {},
      0,
    );
    expect(pulses).toHaveLength(1);
    expect(pulses[0].origin).toEqual({
      pos: [7, 0, 9],
      anchorId: DERIVED_ID,
      resolved: false,
    });
  });

  it('never originates from an anchor that is also one of this tx\'s newborns', () => {
    // The membership filter is the outer lock; the (origin, dst) pair guard
    // in the routing loop is the inner one. T2's id families make the pair
    // case unreachable — outputs are sequential ids, origins are not.
    const cells = mkCells(mkCell(1, [0, 0, 0]), mkCell(40, [1, 0, 0]), mkCell(41, [2, 0, 0]));
    const graph = mkGraph([[1, 40], [1, 41], [40, 41]]);
    const pulses = planPulses(
      mkLink({
        to_ids: [40, 41],
        endpoint_anchors: [mkAnchor(40, [1, 0, 0]), mkAnchor(77, [0, 0, 0])],
      }),
      cells,
      graph,
      {},
      0,
    );
    expect(new Set(pulses.map((p) => p.origin!.anchorId))).toEqual(new Set([77]));
    expect(pulses.every((p) => p.origin!.anchorId !== p.path[p.path.length - 1]))
      .toBe(true);
  });

  it('carries the ghost BY VALUE at the anchor\'s exact pos_seed', () => {
    const anchor = mkAnchor(77, [12.5, -3, 40.25]);
    const cells = mkCells(mkCell(1, [0, 0, 0]), mkCell(40, [1, 0, 0]));
    const pulses = planPulses(
      mkLink({ to_ids: [40], endpoint_anchors: [anchor] }),
      cells,
      mkGraph([[1, 40]]),
      {},
      0,
    );
    expect(pulses[0].origin!.pos).toEqual(anchor.pos_seed);
    // A copy, not the wire array: the pulse outlives the link record.
    expect(pulses[0].origin!.pos).not.toBe(anchor.pos_seed);
  });

  it('stops at MAX_PULSES_PER_LINK across the origin × output product', () => {
    const cells = mkCells(
      mkCell(1, [0, 0, 0]), mkCell(2, [100, 0, 0]),
      mkCell(40, [1, 0, 0]), mkCell(41, [2, 0, 0]), mkCell(42, [3, 0, 0]), mkCell(43, [4, 0, 0]),
    );
    const graph = mkGraph([
      [1, 40], [1, 41], [1, 42], [1, 43],
      [2, 40], [2, 41], [2, 42], [2, 43],
    ]);
    const pulses = planPulses(
      mkLink({
        to_ids: [40, 41, 42, 43],
        endpoint_anchors: [mkAnchor(77, [0, 0, 0]), mkAnchor(78, [100, 0, 0])],
      }),
      cells,
      graph,
      {},
      0,
    );
    expect(pulses).toHaveLength(MAX_PULSES_PER_LINK);
    // The first origin's whole fan, then the second's truncated at the cap.
    expect(pulses.map((p) => [p.origin!.anchorId, p.path[p.path.length - 1]]))
      .toEqual([[77, 40], [77, 41], [77, 42], [77, 43], [78, 40], [78, 41]]);
  });
});

describe('planPulses fabric entry — where the ghost joins the graph', () => {
  it('leaves along the dying cell\'s own surviving adjacency when it has one', () => {
    // Node 9 is nearer the anchor than any neighbour of the anchor, so a
    // plain grid query would pick it; the adjacency fast path departs down a
    // real (retracting) edge instead.
    const cells = mkCells(
      mkCell(1, [0, 0, 0]), mkCell(3, [1, 0, 0]), mkCell(2, [10, 0, 0]),
      mkCell(4, [20, 0, 0]), mkCell(9, [0.1, 0, 0]), mkCell(8, [0.2, 0, 0]),
    );
    const graph = mkGraph([[1, 2], [1, 3], [3, 4], [2, 4], [9, 8]]);
    const pulses = planPulses(
      mkLink({ to_ids: [4], endpoint_anchors: [mkAnchor(1, [0, 0, 0])] }),
      cells,
      graph,
      {},
      0,
    );
    expect(pulses[0].path).toEqual([3, 4]);
    expect(pulses[0].origin!.anchorId).toBe(1);
  });

  it('falls back to the nearest live node when the dying cell has no adjacency left', () => {
    const cells = mkCells(mkCell(1, [0, 0, 0]), mkCell(4, [20, 0, 0]));
    const pulses = planPulses(
      mkLink({ to_ids: [4], endpoint_anchors: [mkAnchor(DERIVED_ID, [0, 0, 0], false)] }),
      cells,
      mkGraph([[1, 4]]),
      {},
      0,
    );
    expect(pulses[0].path).toEqual([1, 4]);
  });

  it('accepts a one-node path when the entry node IS the destination', () => {
    // Adjacent (or substituted) destination: origin.pos → dst is the whole
    // route, and the ghost hop makes it renderable.
    const cells = mkCells(mkCell(40, [0, 0, 0]), mkCell(41, [50, 0, 0]));
    const pulses = planPulses(
      mkLink({ to_ids: [40], endpoint_anchors: [mkAnchor(77, [0, 0, 0])] }),
      cells,
      mkGraph([[40, 41]]),
      {},
      0,
      pulseStats,
    );
    expect(pulses).toHaveLength(1);
    expect(pulses[0].path).toEqual([40]);
    expect(pulses[0].origin!.anchorId).toBe(77);
    expect(pulseStats.linkReasons.fired).toBe(1);
  });
});

describe('planPulses timing — keyed to the coin, not to the stage', () => {
  it('gives the same anchor+dst the same animation however the entry node churns', () => {
    const link = mkLink({ to_ids: [4], endpoint_anchors: [mkAnchor(77, [0, 0, 0])] });
    const near = planPulses(
      link,
      mkCells(mkCell(1, [0, 0, 0]), mkCell(4, [20, 0, 0])),
      mkGraph([[1, 4]]),
      {},
      0,
    );
    // Same coin, same newborn — but a different cell is now nearest, so the
    // route enters the fabric one hop earlier.
    const churned = planPulses(
      link,
      mkCells(mkCell(5, [0, 0, 0]), mkCell(1, [3, 0, 0]), mkCell(4, [20, 0, 0])),
      mkGraph([[5, 1], [1, 4]]),
      {},
      0,
    );
    expect(near[0].path).toEqual([1, 4]);
    expect(churned[0].path).toEqual([5, 1, 4]);
    expect(churned[0].startDelayMs).toBe(near[0].startDelayMs);
    expect(churned[0].hopMs).toBe(near[0].hopMs);
    // …and that shared timing is the anchor's, not either entry node's.
    expect(near[0].startDelayMs).toBe(pulseTiming(link, 77, 4).startDelayMs);
    expect(near[0].startDelayMs).not.toBe(pulseTiming(link, 1, 4).startDelayMs);
  });
});

describe('planPulses instrumentation', () => {
  it('bumps no-outputs when the link has no output cells', () => {
    planPulses(mkLink({ to_ids: [] }), new Map(), mkGraph([]), undefined, 0, pulseStats);
    expect(pulseStats.linkReasons['no-outputs']).toBe(1);
  });

  it('bumps no-origin when the link names no consumed input (e.g. cellbase)', () => {
    planPulses(
      mkLink({ parents: [], to_ids: [2], endpoint_anchors: [mkAnchor(2, [0, 0, 0])] }),
      new Map(),
      mkGraph([]),
      undefined,
      0,
      pulseStats,
    );
    expect(pulseStats.linkReasons['no-origin']).toBe(1);
    expect(pulseStats.linkReasons.fired).toBe(0);
  });

  it('bumps no-origin for a record persisted before inputs were anchored', () => {
    planPulses(
      mkLink({ parents: ['0xparent'], from_ids: [77], to_ids: [2], endpoint_anchors: [] }),
      new Map(),
      mkGraph([]),
      undefined,
      0,
      pulseStats,
    );
    expect(pulseStats.linkReasons['no-origin']).toBe(1);
  });

  it('bumps endpoint-missing + all-paths-failed when the output cell is absent from the graph', () => {
    const cells = mkCells(mkCell(1, [0, 0, 0]));
    const graph = mkGraph([[1, 3]]); // 1 present, dst 2 absent
    planPulses(
      mkLink({ to_ids: [2], endpoint_anchors: [mkAnchor(77, [0, 0, 0])] }),
      cells,
      graph,
      undefined,
      0,
      pulseStats,
    );
    expect(pulseStats.pathFails['endpoint-missing']).toBe(1);
    expect(pulseStats.linkReasons['all-paths-failed']).toBe(1);
  });

  it('bumps endpoint-missing when the stage holds no eligible entry at all', () => {
    planPulses(
      mkLink({ to_ids: [2], endpoint_anchors: [mkAnchor(77, [0, 0, 0])] }),
      new Map(),
      mkGraph([]),
      undefined,
      0,
      pulseStats,
    );
    expect(pulseStats.pathFails['endpoint-missing']).toBe(1);
    expect(pulseStats.linkReasons['all-paths-failed']).toBe(1);
  });

  it('bumps no-path + all-paths-failed when both endpoints exist but are disconnected', () => {
    const cells = mkCells(mkCell(1, [0, 0, 0]), mkCell(5, [1, 0, 0]), mkCell(2, [80, 0, 0]), mkCell(6, [81, 0, 0]));
    const graph = mkGraph([[1, 5], [2, 6]]); // separate components
    planPulses(
      mkLink({ to_ids: [2], endpoint_anchors: [mkAnchor(77, [0, 0, 0])] }),
      cells,
      graph,
      undefined,
      0,
      pulseStats,
    );
    expect(pulseStats.pathFails['no-path']).toBe(1);
    expect(pulseStats.linkReasons['all-paths-failed']).toBe(1);
  });

  it('bumps fired and returns a pulse when a real origin→dst route exists', () => {
    const cells = mkCells(mkCell(1, [0, 0, 0]), mkCell(2, [5, 0, 0]));
    const pulses = planPulses(
      mkLink({ to_ids: [2], endpoint_anchors: [mkAnchor(77, [0, 0, 0])] }),
      cells,
      mkGraph([[1, 2]]),
      undefined,
      0,
      pulseStats,
    );
    expect(pulses.map((p) => p.path)).toEqual([[1, 2]]);
    expect(pulseStats.linkReasons.fired).toBe(1);
    expect(pulses[0].color).toEqual(consensusPacketColor('0xtx', null));
  });

  it('splits planned pulses by origin honesty', () => {
    const cells = mkCells(mkCell(1, [0, 0, 0]), mkCell(40, [1, 0, 0]), mkCell(41, [2, 0, 0]));
    const graph = mkGraph([[1, 40], [1, 41]]);
    planPulses(
      mkLink({
        to_ids: [40, 41],
        endpoint_anchors: [
          mkAnchor(77, [0, 0, 0]),                  // retained: content known
          mkAnchor(DERIVED_ID, [0, 0, 0], false),   // identity only
        ],
      }),
      cells,
      graph,
      {},
      0,
      pulseStats,
    );
    expect(pulseStats.origins).toEqual({
      'origin-retained': 2,
      'origin-derived': 2,
    });
  });
});

describe('planPulses purity — the sink must not change the return value', () => {
  it('returns an identical result with and without a stats sink', () => {
    const cells = mkCells(mkCell(1, [0, 0, 0]), mkCell(2, [5, 0, 0]));
    const graph = mkGraph([[1, 2]]);
    const link = mkLink({ to_ids: [2], endpoint_anchors: [mkAnchor(77, [0, 0, 0])] });
    const withSink = planPulses(link, cells, graph, undefined, 0, pulseStats);
    const without = planPulses(link, cells, graph, undefined, 0);
    expect(without).toEqual(withSink);
  });
});
