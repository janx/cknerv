import { beforeEach, describe, expect, it } from 'vitest';
import type { Cell, CellLink } from '@cknerv/types';
import type { NeighborGraph } from '../../src/geometry/neighborGraph';
import { planPulses } from '../../src/nerve/pulseRunner';
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
    content_hash: '0x' + '00'.repeat(32),
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
