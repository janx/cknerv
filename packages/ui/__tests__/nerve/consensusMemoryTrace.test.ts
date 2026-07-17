import { describe, expect, it } from 'vitest';
import type { Cell, CellLink } from '@cknerv/types';
import type { NeighborGraph } from '../../src/geometry/neighborGraph';
import {
  CONSENSUS_PULSE_POLICY,
  MAX_MEMORY_TRACE_PULSES,
  MEMORY_TRACE_ALIGNMENT_CAP_MS,
  MEMORY_TRACE_CELL_CONVERGENCE_MS,
  MEMORY_TRACE_FADE_MS,
  MEMORY_TRACE_FOCUS_FADE_IN_MS,
  MEMORY_TRACE_FOCUS_FADE_OUT_MS,
  MEMORY_TRACE_HOP_MS_MIN,
  MEMORY_TRACE_HOP_MS_SPAN,
  MEMORY_TRACE_LIVE_ACTIVITY_FLOOR,
  MEMORY_TRACE_PASSIVE_OPACITY_FLOOR,
  MEMORY_TRACE_ROUTE_HANDOFF_FLOOR,
  MEMORY_TRACE_SOURCE_REVEAL_LEAD_MS,
  MEMORY_TRACE_SOURCE_REVEAL_MS,
  MEMORY_TRACE_START_STAGGER_MS,
  MEMORY_TRACE_SETTLE_MS,
  canRecallConsensusMemory,
  consensusMemoryCellResponse,
  consensusMemoryLiveActivityScale,
  consensusMemoryPulseActivityScale,
  consensusMemoryRouteHandoffScale,
  consensusMemoryPassiveOpacity,
  consensusMemoryTraceRequestKey,
  consensusMemoryTraceFocusStrength,
  consensusMemoryTraceResonance,
  consensusMemoryTraceSourceStrength,
  deriveConsensusMemoryTraceFocus,
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
    expect(canRecallConsensusMemory(link(), cells, 5)).toBe(true);
    expect(canRecallConsensusMemory(link(), cells, 9)).toBe(false);
    expect(canRecallConsensusMemory(link({ from_ids: [2] }), cells)).toBe(false);
    expect(canRecallConsensusMemory(link({ from_ids: [] }), cells)).toBe(false);
    expect(canRecallConsensusMemory(link({ to_ids: [9] }), cells)).toBe(false);
  });

  it('routes a selected Cell without recalling sibling outputs from the same write', () => {
    const cells = new Map([1, 2, 3, 4, 5, 6].map((id) => [id, cell(id)]));
    const plan = planConsensusMemoryTrace(
      link({ to_ids: [5, 6] }),
      cells,
      graph([[1, 3], [2, 4], [3, 5], [4, 5], [3, 6], [4, 6]]),
      { targetCellId: 6, maxPulses: 2 },
    );

    expect(plan.retainedOutputIds).toEqual([6]);
    expect(plan.pulses).toHaveLength(2);
    expect(plan.pulses.every((pulse) => pulse.path.at(-1) === 6)).toBe(true);
  });

  it('keys the selected output into replay identity', () => {
    expect(consensusMemoryTraceRequestKey({ linkSeq: 7, nonce: 2 }))
      .toBe('7:*:2');
    expect(consensusMemoryTraceRequestKey({ linkSeq: 7, targetCellId: 5, nonce: 2 }))
      .toBe('7:5:2');
    expect(consensusMemoryTraceRequestKey({ linkSeq: 7, targetCellId: 6, nonce: 2 }))
      .not.toBe(consensusMemoryTraceRequestKey({
        linkSeq: 7,
        targetCellId: 5,
        nonce: 2,
      }));
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
    const arrivals = plan.pulses.map((pulse) => (
      pulse.startDelayMs + (pulse.path.length - 1) * pulse.hopMs
    )).sort((a, b) => a - b);
    expect(arrivals[1] - arrivals[0]).toBeCloseTo(MEMORY_TRACE_START_STAGGER_MS);
    expect(plan.pulses.every((pulse) => (
      pulse.startDelayMs
        <= MEMORY_TRACE_ALIGNMENT_CAP_MS + MEMORY_TRACE_START_STAGGER_MS
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

  it('focuses only the real routed endpoints for exactly the recall lifetime', () => {
    const cells = new Map([1, 2, 3, 4, 5].map((id) => [id, cell(id)]));
    const plan = planConsensusMemoryTrace(
      link(),
      cells,
      graph([[1, 3], [2, 4], [3, 5], [4, 5]]),
    );
    const startedAtSec = 10;
    const focus = deriveConsensusMemoryTraceFocus(plan, startedAtSec, '7:1');

    expect(focus).not.toBeNull();
    expect(focus?.sourceKind).toBe('input');
    expect(new Set(focus?.sources.map((source) => source.id))).toEqual(new Set([1, 2]));
    expect(focus!.sources[0].startsAtSec).toBeLessThan(focus!.sources[1].startsAtSec);
    expect(focus?.routedSourceCount).toBe(2);
    expect(focus?.targetIds).toEqual([5]);
    expect(focus?.startedAtSec).toBe(startedAtSec);

    const slowestLifetimeMs = Math.max(...plan.pulses.map((pulse) => (
      pulse.startDelayMs
        + (pulse.path.length - 1) * pulse.hopMs
        + MEMORY_TRACE_SETTLE_MS
        + MEMORY_TRACE_FADE_MS
    )));
    expect(focus?.endsAtSec).toBeCloseTo(startedAtSec + slowestLifetimeMs / 1000);
    expect(consensusMemoryTraceFocusStrength(focus, startedAtSec - 0.01)).toBe(0);
    expect(consensusMemoryTraceFocusStrength(focus, startedAtSec)).toBe(0);
    expect(consensusMemoryTraceFocusStrength(
      focus,
      startedAtSec + MEMORY_TRACE_FOCUS_FADE_IN_MS / 1000,
    )).toBeCloseTo(1);
    expect(consensusMemoryTraceFocusStrength(
      focus,
      focus!.endsAtSec - MEMORY_TRACE_FOCUS_FADE_OUT_MS / 2000,
    )).toBeCloseTo(0.5);
    expect(consensusMemoryTraceFocusStrength(focus, focus!.endsAtSec)).toBe(0);

    const firstSource = focus!.sources[0];
    expect(consensusMemoryTraceSourceStrength(
      firstSource,
      firstSource.startsAtSec - MEMORY_TRACE_SOURCE_REVEAL_LEAD_MS / 1000,
    )).toBe(0);
    expect(consensusMemoryTraceSourceStrength(
      firstSource,
      firstSource.startsAtSec
        + (MEMORY_TRACE_SOURCE_REVEAL_MS - MEMORY_TRACE_SOURCE_REVEAL_LEAD_MS) / 1000,
    )).toBe(1);

    const sourceMidpoint = (firstSource.startsAtSec + firstSource.arrivesAtSec) / 2;
    const sourceResponse = consensusMemoryCellResponse(
      focus,
      firstSource.id,
      sourceMidpoint,
    );
    expect(sourceResponse?.role).toBe('source');
    expect(sourceResponse?.phase).toBeCloseTo(0.5);
    expect(sourceResponse?.strength).toBeGreaterThan(0);

    const firstArrival = Math.min(...focus!.sources.map((source) => source.arrivesAtSec));
    const lastArrival = Math.max(...focus!.sources.map((source) => source.arrivesAtSec));
    expect(consensusMemoryCellResponse(focus, 5, firstArrival - 0.001)?.convergence)
      .toBe(0);
    const resolvedTarget = consensusMemoryCellResponse(
      focus,
      5,
      lastArrival + MEMORY_TRACE_CELL_CONVERGENCE_MS / 1000,
    );
    expect(resolvedTarget?.role).toBe('target');
    expect(resolvedTarget?.convergence).toBeCloseTo(1);
    expect(resolvedTarget?.phase).toBeGreaterThanOrEqual(0);
    expect(resolvedTarget?.phase).toBeLessThan(1);
    expect(consensusMemoryCellResponse(focus, 999, sourceMidpoint)).toBeNull();
    expect(consensusMemoryRouteHandoffScale(0)).toBe(1);
    expect(consensusMemoryRouteHandoffScale(1)).toBe(MEMORY_TRACE_ROUTE_HANDOFF_FLOOR);
    expect(consensusMemoryRouteHandoffScale(0.5))
      .toBeCloseTo((1 + MEMORY_TRACE_ROUTE_HANDOFF_FLOOR) / 2);
  });

  it('does not focus an unroutable memory or over-dim passive structure', () => {
    const cells = new Map([1, 5].map((id) => [id, cell(id)]));
    const plan = planConsensusMemoryTrace(link(), cells, graph([]));

    expect(deriveConsensusMemoryTraceFocus(plan, 1, '7:1')).toBeNull();
    expect(consensusMemoryTraceFocusStrength(null, 1)).toBe(0);
    expect(consensusMemoryTraceFocusStrength(null, Number.NaN)).toBe(0);
    expect(consensusMemoryPassiveOpacity(0)).toBe(1);
    expect(consensusMemoryPassiveOpacity(1)).toBe(MEMORY_TRACE_PASSIVE_OPACITY_FLOOR);
    expect(consensusMemoryPassiveOpacity(2)).toBe(MEMORY_TRACE_PASSIVE_OPACITY_FLOOR);
    expect(consensusMemoryPassiveOpacity(Number.NaN)).toBe(1);
  });

  it('lets live writes yield priority without hiding their route', () => {
    expect(consensusMemoryLiveActivityScale(0)).toBe(1);
    expect(consensusMemoryLiveActivityScale(1))
      .toBe(MEMORY_TRACE_LIVE_ACTIVITY_FLOOR);
    expect(consensusMemoryLiveActivityScale(0.5))
      .toBeCloseTo((1 + MEMORY_TRACE_LIVE_ACTIVITY_FLOOR) / 2);
    expect(consensusMemoryLiveActivityScale(Number.NaN)).toBe(1);
    expect(MEMORY_TRACE_LIVE_ACTIVITY_FLOOR).toBeGreaterThan(0);
    expect(consensusMemoryPulseActivityScale('live', 1))
      .toBe(MEMORY_TRACE_LIVE_ACTIVITY_FLOOR);
    expect(consensusMemoryPulseActivityScale('memory', 1)).toBe(1);
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
