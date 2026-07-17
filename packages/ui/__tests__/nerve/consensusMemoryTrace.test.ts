import { describe, expect, it } from 'vitest';
import type { Cell, CellLink } from '@cknerv/types';
import type { NeighborGraph } from '../../src/geometry/neighborGraph';
import {
  CONSENSUS_PULSE_POLICY,
  MAX_MEMORY_TRACE_PULSES,
  MEMORY_TRACE_FADE_MS,
  MEMORY_TRACE_HOP_MS_MIN,
  MEMORY_TRACE_HOP_MS_SPAN,
  MEMORY_TRACE_SETTLE_MS,
  canRecallConsensusMemory,
  consensusMemoryTraceResonance,
  deriveConsensusMemoryTraceEndpoints,
  planConsensusMemoryTrace,
} from '../../src/nerve/consensusMemoryTrace';
import { consensusMemoryTraceColor } from '../../src/derives/consensusFlow.derive';

function cell(id: number): Cell {
  return {
    id,
    born_at_ms: 0,
    death_at_ms: id < 3 ? 100 : null,
    birth_block: 1,
    tag: null,
    pos_seed: [id, 0, 0],
    out_point: { tx_hash: `0x${id}`, index: 0 },
    capacity: 0,
    data_hex: '0x',
    content_hash: `0x${String(id).padStart(64, '0')}`,
  };
}

function link(over: Partial<CellLink> = {}): CellLink {
  return {
    seq: 7,
    tx_hash: '0xtrace',
    block: 99,
    from_ids: [1, 2],
    to_ids: [5],
    parents: [],
    tag: null,
    at_ms: 1234,
    ...over,
  };
}

function graph(edges: Array<[number, number]>): NeighborGraph {
  const adjacency = new Map<number, Set<number>>();
  const add = (from: number, to: number) => {
    if (!adjacency.has(from)) adjacency.set(from, new Set());
    if (!adjacency.has(to)) adjacency.set(to, new Set());
    adjacency.get(from)!.add(to);
    adjacency.get(to)!.add(from);
  };
  for (const [from, to] of edges) add(from, to);
  return {
    adjacency,
    edges: edges.map(([from, to]) => ({
      from: Math.min(from, to),
      to: Math.max(from, to),
      d: 1,
    })),
  };
}

describe('planConsensusMemoryTrace', () => {
  it('offers exact recall only while an input and created output remain retained', () => {
    const cells = new Map([1, 5].map((id) => [id, cell(id)]));
    expect(canRecallConsensusMemory(link(), cells)).toBe(true);
    expect(canRecallConsensusMemory(link({ from_ids: [2] }), cells)).toBe(false);
    expect(canRecallConsensusMemory(link({ from_ids: [] }), cells)).toBe(false);
    expect(canRecallConsensusMemory(link({ to_ids: [9] }), cells)).toBe(false);
  });

  it('routes exact retained inputs to exact retained outputs, including spent inputs', () => {
    const cells = new Map([1, 2, 3, 4, 5].map((id) => [id, cell(id)]));
    const plan = planConsensusMemoryTrace(
      link(),
      cells,
      graph([[1, 3], [2, 4], [3, 5], [4, 5]]),
    );

    expect(plan.retainedInputIds).toEqual([1, 2]);
    expect(plan.retainedOutputIds).toEqual([5]);
    expect(plan.sourceKind).toBe('input');
    expect(plan.witnessIds).toEqual([]);
    expect(plan.pulses.map((pulse) => pulse.path)).toEqual([
      [1, 3, 5],
      [2, 4, 5],
    ]);
    expect(plan.pulses.every((pulse) => (
      pulse.color === plan.pulses[0].color
      && pulse.bornAtMs === 1234
      && pulse.hopMs >= MEMORY_TRACE_HOP_MS_MIN
      && pulse.hopMs <= MEMORY_TRACE_HOP_MS_MIN + MEMORY_TRACE_HOP_MS_SPAN
    ))).toBe(true);
  });

  it('uses a surviving parent sibling as an explicitly labeled lineage witness', () => {
    const cells = new Map([3, 5, 8].map((id) => [id, cell(id)]));
    const plan = planConsensusMemoryTrace(
      link({ parents: [cell(8).out_point.tx_hash] }),
      cells,
      graph([[8, 3], [3, 5]]),
    );

    expect(plan.sourceKind).toBe('witness');
    expect(plan.sourceIds).toEqual([8]);
    expect(plan.witnessIds).toEqual([8]);
    expect(plan.retainedOutputIds).toEqual([5]);
    expect(plan.pulses.map((pulse) => pulse.path)).toEqual([[8, 3, 5]]);
  });

  it('never invents a source when neither an input nor a parent witness survives', () => {
    const cells = new Map([3, 5, 8].map((id) => [id, cell(id)]));
    const endpoints = deriveConsensusMemoryTraceEndpoints(
      link({ parents: ['0xmissing'] }),
      cells,
    );
    expect(endpoints.sourceKind).toBe('none');
    expect(endpoints.sourceIds).toEqual([]);
  });

  it('is deterministic, respects hop limits, and caps dense transactions', () => {
    const ids = Array.from({ length: 12 }, (_, index) => index + 1);
    const cells = new Map(ids.map((id) => [id, cell(id)]));
    const dense = link({ from_ids: [1, 2, 3, 4], to_ids: [9, 10, 11, 12] });
    const connected = graph(ids.slice(0, -1).map((id) => [id, id + 1]));
    const first = planConsensusMemoryTrace(dense, cells, connected, { maxHops: 20 });
    const second = planConsensusMemoryTrace(dense, cells, connected, { maxHops: 20 });

    expect(first).toEqual(second);
    expect(first.pulses).toHaveLength(MAX_MEMORY_TRACE_PULSES);
    expect(planConsensusMemoryTrace(dense, cells, connected, { maxHops: 1 }).pulses)
      .toEqual([]);
  });

  it('keeps historical recall in a cool bounded color lane', () => {
    const color = consensusMemoryTraceColor('0xtrace');
    expect(consensusMemoryTraceColor('0xtrace')).toEqual(color);
    expect(color.every((channel) => channel >= 0 && channel <= 1)).toBe(true);
    expect(color[2]).toBeGreaterThan(color[0]);
    expect(color[2] - color[1]).toBeGreaterThan(0.4);
  });

  it('holds the completed route, then smoothly removes the afterimage', () => {
    expect(consensusMemoryTraceResonance(-1)).toBe(0);
    expect(consensusMemoryTraceResonance(0)).toBe(1);
    expect(consensusMemoryTraceResonance(MEMORY_TRACE_SETTLE_MS)).toBe(1);
    expect(consensusMemoryTraceResonance(
      MEMORY_TRACE_SETTLE_MS + MEMORY_TRACE_FADE_MS / 2,
    )).toBeCloseTo(0.5);
    expect(consensusMemoryTraceResonance(
      MEMORY_TRACE_SETTLE_MS + MEMORY_TRACE_FADE_MS,
    )).toBe(0);
  });

  it('keeps memory recall display-only while live pulses retain event effects', () => {
    expect(CONSENSUS_PULSE_POLICY.memory).toEqual({
      reinforce: false,
      flashCells: false,
      stampWrite: false,
    });
    expect(CONSENSUS_PULSE_POLICY.live).toEqual({
      reinforce: true,
      flashCells: true,
      stampWrite: true,
    });
  });
});
