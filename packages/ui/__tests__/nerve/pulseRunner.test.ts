import { beforeEach, describe, expect, it } from 'vitest';
import type { Cell, CellLink } from '@cknerv/types';
import type { NeighborGraph } from '../../src/geometry/neighborGraph';
import { collectLinkSourceIndex, planPulses } from '../../src/nerve/pulseRunner';
import { pulseStats, resetPulseStats } from '../../src/nerve/pulseStats';
import { consensusPacketColor } from '../../src/derives/consensusFlow.derive';

beforeEach(() => resetPulseStats());

function mkCell(id: number, txHash: string): Cell {
  return {
    id,
    born_at_ms: 0,
    death_at_ms: null,
    birth_block: 1,
    tag: null,
    pos_seed: [0, 0, 0],
    out_point: { tx_hash: txHash, index: 0 },
    capacity: 0,
    data_hex: '0x',
    data_bytes: 0,
    content_hash: '0x' + '00'.repeat(32),
    lock_shape_seed: [1, 2],
    type_shape_seed: null,
    data_shape_seed: [3, 4],
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

describe('planPulses instrumentation', () => {
  it('bumps no-outputs when the link has no output cells', () => {
    planPulses(mkLink({ to_ids: [] }), new Map(), mkGraph([]), undefined, 0, pulseStats);
    expect(pulseStats.linkReasons['no-outputs']).toBe(1);
  });

  it('bumps no-parents when the tx has no parent tx (e.g. cellbase)', () => {
    planPulses(mkLink({ parents: [], to_ids: [2] }), new Map(), mkGraph([]), undefined, 0, pulseStats);
    expect(pulseStats.linkReasons['no-parents']).toBe(1);
  });

  it('bumps no-source when parents exist but no alive parent cell is present', () => {
    const cells = new Map<number, Cell>([[9, mkCell(9, '0xother')]]);
    planPulses(mkLink({ parents: ['0xparent'], to_ids: [2] }), cells, mkGraph([]), undefined, 0, pulseStats);
    expect(pulseStats.linkReasons['no-source']).toBe(1);
  });

  it('bumps endpoint-missing + all-paths-failed when the output cell is absent from the graph', () => {
    const cells = new Map<number, Cell>([[1, mkCell(1, '0xparent')]]); // source id 1 alive
    const graph = mkGraph([[1, 3]]); // 1 present, dst 2 absent
    planPulses(mkLink({ parents: ['0xparent'], to_ids: [2] }), cells, graph, undefined, 0, pulseStats);
    expect(pulseStats.pathFails['endpoint-missing']).toBe(1);
    expect(pulseStats.linkReasons['all-paths-failed']).toBe(1);
  });

  it('bumps no-path + all-paths-failed when both endpoints exist but are disconnected', () => {
    const cells = new Map<number, Cell>([[1, mkCell(1, '0xparent')]]);
    const graph = mkGraph([[1, 5], [2, 6]]); // 1 and 2 present, separate components
    planPulses(mkLink({ parents: ['0xparent'], to_ids: [2] }), cells, graph, undefined, 0, pulseStats);
    expect(pulseStats.pathFails['no-path']).toBe(1);
    expect(pulseStats.linkReasons['all-paths-failed']).toBe(1);
  });

  it('bumps fired and returns a pulse when a real source→dst path exists', () => {
    const cells = new Map<number, Cell>([[1, mkCell(1, '0xparent')]]);
    const graph = mkGraph([[1, 2]]); // direct neighbour 1→2
    const pulses = planPulses(mkLink({ parents: ['0xparent'], to_ids: [2] }), cells, graph, undefined, 0, pulseStats);
    expect(pulses.length).toBe(1);
    expect(pulseStats.linkReasons.fired).toBe(1);
    expect(pulses[0].color).toEqual(consensusPacketColor('0xtx', null));
  });
});

describe('planPulses purity — the sink must not change the return value', () => {
  it('returns an identical result with and without a stats sink', () => {
    const cells = new Map<number, Cell>([[1, mkCell(1, '0xparent')]]);
    const graph = mkGraph([[1, 2]]);
    const link = mkLink({ parents: ['0xparent'], to_ids: [2] });
    const withSink = planPulses(link, cells, graph, undefined, 0, pulseStats);
    const without = planPulses(link, cells, graph, undefined, 0);
    expect(without).toEqual(withSink);
  });
});

describe('batch source index — byte-identical to the full-map scan', () => {
  // Interleaved insertion order across parent txs, more candidates than the
  // per-parent cap, plus unrelated noise cells the scan must skip.
  function fixtureCells(): Map<number, Cell> {
    const cells = new Map<number, Cell>();
    cells.set(11, mkCell(11, '0xA'));
    cells.set(21, mkCell(21, '0xB'));
    cells.set(12, mkCell(12, '0xA'));
    cells.set(90, mkCell(90, '0xnoise'));
    cells.set(13, mkCell(13, '0xA'));
    cells.set(22, mkCell(22, '0xB'));
    cells.set(31, mkCell(31, '0xC'));
    cells.set(40, mkCell(40, '0xtx')); // an output cell of the link's own tx
    cells.set(41, mkCell(41, '0xtx'));
    return cells;
  }
  // Fully-connected chain so every source routes to every output.
  function fixtureGraph(): NeighborGraph {
    const ids = [11, 21, 12, 90, 13, 22, 31, 40, 41];
    const edges: [number, number][] = [];
    for (let i = 1; i < ids.length; i++) edges.push([ids[i - 1], ids[i]]);
    return mkGraph(edges);
  }

  function expectIndexedEqualsScan(link: CellLink, opts?: {
    maxPulsesPerLink?: number;
    maxSourcesPerParent?: number;
  }) {
    const cells = fixtureCells();
    const graph = fixtureGraph();
    const sourceIndex = collectLinkSourceIndex([link], cells);
    const scanned = planPulses(link, cells, graph, { ...opts }, 0);
    const indexed = planPulses(link, cells, graph, { ...opts, sourceIndex }, 0);
    expect(indexed).toEqual(scanned);
    return indexed;
  }

  it('multi-parent links keep the cross-parent scan-order interleaving', () => {
    const link = mkLink({
      parents: ['0xA', '0xB'],
      to_ids: [40, 41],
      tx_hash: '0xtx',
    });
    const pulses = expectIndexedEqualsScan(link, { maxPulsesPerLink: 100 });
    // Per-parent cap 2 keeps A→{11,12} and B→{21,22}; the emitted source
    // order is their interleaved scan order 11, 21, 12, 22, each routing to
    // both outputs.
    expect(pulses.map((p) => p.path[0])).toEqual([11, 11, 21, 21, 12, 12, 22, 22]);
  });

  it('self-loop exclusion consumes no per-parent cap slot', () => {
    const link = mkLink({
      parents: ['0xA'],
      // 11 is both an A-candidate and one of this link's outputs — the scan
      // skips it WITHOUT counting it toward the cap, so 12 and 13 fire.
      to_ids: [11, 40],
      tx_hash: '0xtx',
    });
    const pulses = expectIndexedEqualsScan(link, { maxPulsesPerLink: 100 });
    expect([...new Set(pulses.map((p) => p.path[0]))]).toEqual([12, 13]);
  });

  it('the pulse cap truncates the same pairs on both paths', () => {
    const link = mkLink({
      parents: ['0xA', '0xB', '0xC'],
      to_ids: [40, 41],
      tx_hash: '0xtx',
    });
    const pulses = expectIndexedEqualsScan(link); // default cap 6
    expect(pulses).toHaveLength(6);
  });

  it('an absent bucket behaves exactly like a scan with no matches', () => {
    const link = mkLink({ parents: ['0xmissing'], to_ids: [40] });
    const cells = fixtureCells();
    const graph = fixtureGraph();
    const sourceIndex = collectLinkSourceIndex([link], cells);
    resetPulseStats();
    planPulses(link, cells, graph, { sourceIndex }, 0, pulseStats);
    expect(pulseStats.linkReasons['no-source']).toBe(1);
  });

  it('the index only buckets txs the batch actually references', () => {
    const cells = fixtureCells();
    const index = collectLinkSourceIndex(
      [mkLink({ parents: ['0xA'], to_ids: [40] })],
      cells,
    );
    expect([...index.byTx.keys()]).toEqual(['0xA']);
    expect(index.byTx.get('0xA')).toEqual([11, 12, 13]);
  });
});
