import { describe, expect, it } from 'vitest';
import type { Cell, CellLink } from '@cknerv/types';
import type { NeighborGraph } from '../../src/geometry/neighborGraph';
import {
  CONSENSUS_PULSE_POLICY,
  MAX_MEMORY_TRACE_PULSES,
  MEMORY_TRACE_ALIGNMENT_CAP_MS,
  MEMORY_TRACE_CELL_CONVERGENCE_MS,
  MEMORY_TRACE_EVIDENCE_CONTEXT_SCALE,
  MEMORY_TRACE_EVIDENCE_PASSIVE_SCALE,
  MEMORY_TRACE_FADE_MS,
  MEMORY_TRACE_FOCUS_FADE_IN_MS,
  MEMORY_TRACE_FOCUS_FADE_OUT_MS,
  MEMORY_TRACE_HOP_MS_MIN,
  MEMORY_TRACE_HOP_MS_SPAN,
  MEMORY_TRACE_LIVE_ACTIVITY_FLOOR,
  MEMORY_TRACE_ROUTE_HANDOFF_FLOOR,
  MEMORY_TRACE_SOURCE_REVEAL_LEAD_MS,
  MEMORY_TRACE_SOURCE_REVEAL_MS,
  MEMORY_TRACE_START_STAGGER_MS,
  MEMORY_TRACE_SETTLE_MS,
  canRecallConsensusMemory,
  consensusMemoryCellResponse,
  consensusMemoryEvidenceFocusScale,
  consensusMemoryLiveActivityScale,
  consensusMemoryPulseActivityScale,
  consensusMemoryRouteHopAdjacentSegments,
  consensusMemoryRouteHopCellFocus,
  consensusMemoryRouteHopFocusEqual,
  classifyConsensusMemoryRouteHopTransition,
  consensusMemoryRouteHandoffScale,
  consensusMemoryTraceRequestKey,
  consensusMemoryTraceReadout,
  consensusMemoryTraceFocusStrength,
  consensusMemoryTraceResonance,
  consensusMemoryTraceSourceStrength,
  deriveConsensusMemoryTraceFocus,
  deriveConsensusMemoryRouteHopFocus,
  deriveConsensusMemoryRouteHopInspection,
  deriveConsensusMemoryRouteHopSpatialFocus,
  deriveConsensusMemoryRouteHopTangent,
  deriveConsensusMemoryRouteHopWindow,
  deriveConsensusMemoryTraceEndpoints,
  isConsensusMemoryRouteHopTargetArrival,
  planConsensusMemoryTrace,
  shouldAnimateConsensusMemoryRouteHopTargetLatch,
  stepConsensusMemoryRouteHopFocus,
  validateConsensusMemoryRouteHopFocus,
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
    expect(plan.sourceEvidence).toEqual([
      {
        id: 1,
        contentHash: cell(1).content_hash,
        outPoint: cell(1).out_point,
        birthBlock: cell(1).birth_block,
      },
      {
        id: 2,
        contentHash: cell(2).content_hash,
        outPoint: cell(2).out_point,
        birthBlock: cell(2).birth_block,
      },
    ]);
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
    expect(focus?.sources.map((source) => source.contentHash)).toEqual([
      cell(focus!.sources[0].id).content_hash,
      cell(focus!.sources[1].id).content_hash,
    ]);
    for (const source of focus!.sources) {
      const plannedPulse = plan.pulses.find((pulse) => (
        pulse.path[0] === source.id && pulse.path.at(-1) === 5
      ))!;
      expect(source.outPoint).toEqual(cell(source.id).out_point);
      expect(source.birthBlock).toBe(cell(source.id).birth_block);
      expect(source.routes).toHaveLength(1);
      expect(source.routes[0]).toMatchObject({
        targetId: 5,
        path: plannedPulse.path,
        color: plannedPulse.color,
        hopCount: plannedPulse.path.length - 1,
        hopMs: plannedPulse.hopMs,
      });
      expect(source.routes[0].startsAtSec).toBeCloseTo(
        startedAtSec + plannedPulse.startDelayMs / 1_000,
      );
      expect(source.routes[0].arrivesAtSec).toBeCloseTo(
        startedAtSec
          + plannedPulse.startDelayMs / 1_000
          + (plannedPulse.path.length - 1) * plannedPulse.hopMs / 1_000,
      );
    }
    expect(focus!.sources[0].startsAtSec).toBeLessThan(focus!.sources[1].startsAtSec);
    expect(focus?.routedSourceCount).toBe(2);
    expect(focus?.targetIds).toEqual([5]);
    expect(focus?.startedAtSec).toBe(startedAtSec);
    expect(focus?.evidenceFocusSourceId).toBeNull();
    expect(focus?.routeHopFocus).toBeNull();

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
    expect(resolvedTarget?.evidence).toHaveLength(2);
    expect(resolvedTarget?.evidence?.every((source) => source.convergence === 1))
      .toBe(true);
    expect(resolvedTarget?.phase).toBeGreaterThanOrEqual(0);
    expect(resolvedTarget?.phase).toBeLessThan(1);
    expect(consensusMemoryCellResponse(focus, 999, sourceMidpoint)).toBeNull();
    expect(consensusMemoryRouteHandoffScale(0)).toBe(1);
    expect(consensusMemoryRouteHandoffScale(1)).toBe(MEMORY_TRACE_ROUTE_HANDOFF_FLOOR);
    expect(consensusMemoryRouteHandoffScale(0.5))
      .toBeCloseTo((1 + MEMORY_TRACE_ROUTE_HANDOFF_FLOOR) / 2);
  });

  it('isolates one routed source consistently without erasing structural context', () => {
    const cells = new Map([1, 2, 3, 4, 5].map((id) => [id, cell(id)]));
    const plan = planConsensusMemoryTrace(
      link(),
      cells,
      graph([[1, 3], [2, 4], [3, 5], [4, 5]]),
    );
    const focus = deriveConsensusMemoryTraceFocus(plan, 10, '7:5:1')!;
    const [selected, passive] = focus.sources;
    focus.evidenceFocusSourceId = selected.id;
    const fullyRevealedAt = Math.max(...focus.sources.map(
      (source) => source.startsAtSec + MEMORY_TRACE_SOURCE_REVEAL_MS / 1000,
    ));

    expect(consensusMemoryEvidenceFocusScale(selected.id, selected.id)).toBe(1);
    expect(consensusMemoryEvidenceFocusScale(passive.id, selected.id))
      .toBe(MEMORY_TRACE_EVIDENCE_PASSIVE_SCALE);
    expect(consensusMemoryEvidenceFocusScale(null, selected.id))
      .toBe(MEMORY_TRACE_EVIDENCE_CONTEXT_SCALE);
    expect(consensusMemoryEvidenceFocusScale(passive.id, null)).toBe(1);
    expect(consensusMemoryCellResponse(focus, selected.id, fullyRevealedAt)?.strength)
      .toBeGreaterThan(
        consensusMemoryCellResponse(focus, passive.id, fullyRevealedAt)!.strength,
      );
    expect(consensusMemoryCellResponse(focus, 5, fullyRevealedAt))
      .toMatchObject({ role: 'target', evidenceFocusSourceId: selected.id });
  });

  it('binds one HUD hop to its exact retained Cell and adjacent route segments', () => {
    const cells = new Map([1, 2, 3, 4, 5].map((id) => [id, cell(id)]));
    const plan = planConsensusMemoryTrace(
      link(),
      cells,
      graph([[1, 3], [2, 4], [3, 5], [4, 5]]),
    );
    const focus = deriveConsensusMemoryTraceFocus(plan, 10, '7:5:1')!;
    const readout = consensusMemoryTraceReadout(focus, 5, 10.001)!;
    const evidence = readout.evidence[0];
    const transit = deriveConsensusMemoryRouteHopFocus(
      readout,
      evidence.sourceId,
      1,
    );

    expect(transit).toEqual({
      traceKey: readout.key,
      sourceId: evidence.sourceId,
      targetCellId: 5,
      cellId: evidence.route[1],
      hopIndex: 1,
    });
    expect(deriveConsensusMemoryRouteHopInspection(readout, transit)).toEqual({
      cellId: evidence.route[1],
      hopIndex: 1,
      role: 'transit',
      previousCellId: evidence.route[0],
      nextCellId: evidence.route[2],
      distanceFromSource: 1,
      distanceToTarget: 1,
      progress: 0.5,
    });
    expect(deriveConsensusMemoryRouteHopInspection(
      readout,
      deriveConsensusMemoryRouteHopFocus(readout, evidence.sourceId, 0),
    )).toMatchObject({
      role: 'source',
      previousCellId: null,
      distanceFromSource: 0,
      distanceToTarget: 2,
      progress: 0,
    });
    expect(deriveConsensusMemoryRouteHopInspection(
      readout,
      deriveConsensusMemoryRouteHopFocus(readout, evidence.sourceId, 2),
    )).toMatchObject({
      role: 'target',
      nextCellId: null,
      distanceFromSource: 2,
      distanceToTarget: 0,
      progress: 1,
    });
    expect(deriveConsensusMemoryRouteHopInspection(readout, {
      ...transit!,
      traceKey: 'stale-trace',
    })).toBeNull();
    const spatial = deriveConsensusMemoryRouteHopSpatialFocus(
      focus,
      transit,
      cells,
    );
    expect(spatial).toMatchObject({
      focus: transit,
      role: 'transit',
      cell: { id: evidence.route[1] },
      previousCell: { id: evidence.route[0] },
      nextCell: { id: evidence.route[2] },
    });
    expect(spatial?.routeColor).toEqual(focus.sources.find(
      ({ id }) => id === evidence.sourceId,
    )?.routes[0].color);
    expect(deriveConsensusMemoryRouteHopTangent(spatial!)).toMatchObject({
      from: { id: evidence.route[0] },
      to: { id: evidence.route[2] },
    });
    const sourceSpatial = deriveConsensusMemoryRouteHopSpatialFocus(
      focus,
      deriveConsensusMemoryRouteHopFocus(readout, evidence.sourceId, 0),
      cells,
    );
    expect(sourceSpatial?.role).toBe('source');
    expect(deriveConsensusMemoryRouteHopTangent(sourceSpatial!)).toMatchObject({
      from: { id: evidence.route[0] },
      to: { id: evidence.route[1] },
    });
    const targetSpatial = deriveConsensusMemoryRouteHopSpatialFocus(
      focus,
      deriveConsensusMemoryRouteHopFocus(readout, evidence.sourceId, 2),
      cells,
    );
    expect(targetSpatial?.role).toBe('target');
    expect(deriveConsensusMemoryRouteHopTangent(targetSpatial!)).toMatchObject({
      from: { id: evidence.route[1] },
      to: { id: evidence.route[2] },
    });
    expect(classifyConsensusMemoryRouteHopTransition(
      sourceSpatial!.focus,
      spatial!.focus,
    )).toBe('adjacent');
    expect(classifyConsensusMemoryRouteHopTransition(
      spatial!.focus,
      { ...spatial!.focus },
    )).toBe('stationary');
    expect(classifyConsensusMemoryRouteHopTransition(
      sourceSpatial!.focus,
      targetSpatial!.focus,
    )).toBe('discontinuous');
    expect(classifyConsensusMemoryRouteHopTransition(
      spatial!.focus,
      { ...targetSpatial!.focus, traceKey: 'other-trace' },
    )).toBe('discontinuous');
    expect(isConsensusMemoryRouteHopTargetArrival(
      spatial!,
      targetSpatial!,
    )).toBe(true);
    expect(isConsensusMemoryRouteHopTargetArrival(
      targetSpatial!,
      spatial!,
    )).toBe(false);
    expect(isConsensusMemoryRouteHopTargetArrival(
      sourceSpatial!,
      targetSpatial!,
    )).toBe(false);
    expect(shouldAnimateConsensusMemoryRouteHopTargetLatch(
      spatial!,
      targetSpatial!,
    )).toBe(true);
    expect(shouldAnimateConsensusMemoryRouteHopTargetLatch(
      null,
      targetSpatial!,
    )).toBe(false);
    expect(shouldAnimateConsensusMemoryRouteHopTargetLatch(
      spatial!,
      targetSpatial!,
      { reducedMotion: true },
    )).toBe(false);
    expect(shouldAnimateConsensusMemoryRouteHopTargetLatch(
      spatial!,
      targetSpatial!,
      { hasQueuedHandoff: true },
    )).toBe(false);
    const missingLockedCell = new Map(cells);
    missingLockedCell.delete(transit!.cellId);
    expect(deriveConsensusMemoryRouteHopSpatialFocus(
      focus,
      transit,
      missingLockedCell,
    )).toBeNull();
    const missingPreviousCell = new Map(cells);
    missingPreviousCell.delete(evidence.route[0]);
    const missingPreviousSpatial = deriveConsensusMemoryRouteHopSpatialFocus(
      focus,
      transit,
      missingPreviousCell,
    );
    expect(missingPreviousSpatial?.previousCell).toBeNull();
    expect(deriveConsensusMemoryRouteHopTangent(missingPreviousSpatial!))
      .toMatchObject({
        from: { id: evidence.route[1] },
        to: { id: evidence.route[2] },
      });
    const isolatedTransit = deriveConsensusMemoryRouteHopSpatialFocus(
      focus,
      transit,
      new Map([[transit!.cellId, cells.get(transit!.cellId)!]]),
    );
    expect(deriveConsensusMemoryRouteHopTangent(isolatedTransit!)).toBeNull();
    expect(deriveConsensusMemoryRouteHopSpatialFocus(focus, {
      ...transit!,
      traceKey: 'stale-trace',
    }, cells)).toBeNull();
    expect(consensusMemoryRouteHopFocusEqual(transit, { ...transit! })).toBe(true);
    expect(consensusMemoryRouteHopFocusEqual(transit, {
      ...transit!,
      cellId: 999,
    })).toBe(false);
    expect(stepConsensusMemoryRouteHopFocus(readout, transit, 1)).toEqual({
      traceKey: readout.key,
      sourceId: evidence.sourceId,
      targetCellId: 5,
      cellId: evidence.route[2],
      hopIndex: 2,
    });
    expect(stepConsensusMemoryRouteHopFocus(readout, transit, -1)?.hopIndex).toBe(0);
    expect(stepConsensusMemoryRouteHopFocus(
      readout,
      deriveConsensusMemoryRouteHopFocus(readout, evidence.sourceId, 2),
      1,
    )?.hopIndex).toBe(2);
    expect(stepConsensusMemoryRouteHopFocus(readout, {
      ...transit!,
      traceKey: 'stale-trace',
    }, 1)).toBeNull();
    expect(validateConsensusMemoryRouteHopFocus(focus, transit)).toEqual(transit);
    expect(consensusMemoryRouteHopAdjacentSegments(transit, evidence.route))
      .toEqual([0, 1]);
    expect(consensusMemoryRouteHopAdjacentSegments(
      deriveConsensusMemoryRouteHopFocus(readout, evidence.sourceId, 0),
      evidence.route,
    )).toEqual([0]);
    expect(consensusMemoryRouteHopAdjacentSegments(
      deriveConsensusMemoryRouteHopFocus(readout, evidence.sourceId, 2),
      evidence.route,
    )).toEqual([1]);

    focus.routeHopFocus = transit;
    expect(consensusMemoryRouteHopCellFocus(focus, transit!.cellId, 10.2))
      .toBeGreaterThan(0);
    expect(consensusMemoryRouteHopCellFocus(focus, 999, 10.2)).toBe(0);
    expect(validateConsensusMemoryRouteHopFocus(focus, {
      ...transit!,
      cellId: 999,
    })).toBeNull();
    expect(validateConsensusMemoryRouteHopFocus(focus, {
      ...transit!,
      traceKey: 'stale-trace',
    })).toBeNull();
    expect(consensusMemoryRouteHopAdjacentSegments(transit, [1, 4, 5]))
      .toEqual([]);
    expect(deriveConsensusMemoryRouteHopFocus(readout, evidence.sourceId, 99))
      .toBeNull();
  });

  it('keeps a stable five-Cell reading window around a locked long-route hop', () => {
    expect(deriveConsensusMemoryRouteHopWindow(41, 20)).toEqual({
      startIndex: 18,
      endIndex: 22,
      indices: [18, 19, 20, 21, 22],
      hiddenBefore: 18,
      hiddenAfter: 18,
    });
    expect(deriveConsensusMemoryRouteHopWindow(41, 0)).toEqual({
      startIndex: 0,
      endIndex: 4,
      indices: [0, 1, 2, 3, 4],
      hiddenBefore: 0,
      hiddenAfter: 36,
    });
    expect(deriveConsensusMemoryRouteHopWindow(41, 40)).toEqual({
      startIndex: 36,
      endIndex: 40,
      indices: [36, 37, 38, 39, 40],
      hiddenBefore: 36,
      hiddenAfter: 0,
    });
    expect(deriveConsensusMemoryRouteHopWindow(3, 1)?.indices).toEqual([0, 1, 2]);
    expect(deriveConsensusMemoryRouteHopWindow(0, 0)).toBeNull();
    expect(deriveConsensusMemoryRouteHopWindow(41, 41)).toBeNull();
  });

  it('projects the target read clock into reading, converging, and locked HUD states', () => {
    const cells = new Map([1, 2, 3, 4, 5].map((id) => [id, cell(id)]));
    const plan = planConsensusMemoryTrace(
      link(),
      cells,
      graph([[1, 3], [2, 4], [3, 5], [4, 5]]),
    );
    const focus = deriveConsensusMemoryTraceFocus(plan, 10, '7:5:1')!;
    const firstArrival = Math.min(...focus.sources.map((source) => source.arrivesAtSec));
    const lastArrival = Math.max(...focus.sources.map((source) => source.arrivesAtSec));

    const reading = consensusMemoryTraceReadout(focus, 5, firstArrival - 0.001);
    expect(reading).toMatchObject({
      key: '7:5:1',
      targetCellId: 5,
      sourceKind: 'input',
      stage: 'reading',
      sourceCount: 2,
      arrivedSourceCount: 0,
      resolvedSourceCount: 0,
      evidence: [
        expect.objectContaining({ ordinal: 1, state: 'routing' }),
        expect.objectContaining({ ordinal: 2, state: 'routing' }),
      ],
    });
    for (const evidence of reading!.evidence) {
      const source = focus.sources.find((candidate) => (
        candidate.id === evidence.sourceId
      ))!;
      const route = source.routes.find((candidate) => candidate.targetId === 5)!;
      expect(evidence.sourceOutPoint).toEqual(cell(source.id).out_point);
      expect(evidence.sourceBirthBlock).toBe(cell(source.id).birth_block);
      expect(evidence.route).toEqual(route.path);
      expect(evidence.hopCount).toBe(route.path.length - 1);
      expect(evidence.routeDurationMs).toBeCloseTo(
        route.hopCount * route.hopMs,
      );
    }
    expect(consensusMemoryTraceReadout(focus, 5, firstArrival)).toMatchObject({
      stage: 'converging',
      arrivedSourceCount: 1,
      resolvedSourceCount: 0,
      evidence: expect.arrayContaining([
        expect.objectContaining({ state: 'arrived' }),
      ]),
    });
    expect(consensusMemoryTraceReadout(
      focus,
      5,
      lastArrival + MEMORY_TRACE_CELL_CONVERGENCE_MS / 1000,
    )).toMatchObject({
      stage: 'locked',
      arrivedSourceCount: 2,
      resolvedSourceCount: 2,
      evidence: [
        expect.objectContaining({ state: 'resolved' }),
        expect.objectContaining({ state: 'resolved' }),
      ],
    });
    expect(consensusMemoryTraceReadout(focus, 999, firstArrival)).toBeNull();
    expect(consensusMemoryTraceReadout(focus, 5, focus.endsAtSec)).toBeNull();
  });

  it('keeps exact per-target route proofs when retained sources fan out', () => {
    const cells = new Map([1, 2, 3, 4, 5, 6].map((id) => [id, cell(id)]));
    const plan = planConsensusMemoryTrace(
      link({ to_ids: [5, 6] }),
      cells,
      graph([[1, 3], [2, 4], [3, 5], [4, 5], [3, 6], [4, 6]]),
    );
    const focus = deriveConsensusMemoryTraceFocus(plan, 10, '7:*:1')!;

    expect(new Set(focus.targetIds)).toEqual(new Set([5, 6]));
    expect(focus.sources.every((source) => (
      source.routes.map((route) => route.targetId).sort((a, b) => a - b)
        .join(',') === '5,6'
    ))).toBe(true);

    const targetSix = consensusMemoryTraceReadout(focus, 6, 10.001)!;
    expect(targetSix.sourceCount).toBe(2);
    expect(targetSix.evidence.every((evidence) => evidence.route.at(-1) === 6))
      .toBe(true);
    expect(targetSix.evidence.every((evidence) => (
      evidence.hopCount === evidence.route.length - 1
    ))).toBe(true);
  });

  it('does not focus an unroutable memory', () => {
    const cells = new Map([1, 5].map((id) => [id, cell(id)]));
    const plan = planConsensusMemoryTrace(link(), cells, graph([]));

    expect(deriveConsensusMemoryTraceFocus(plan, 1, '7:1')).toBeNull();
    expect(consensusMemoryTraceFocusStrength(null, 1)).toBe(0);
    expect(consensusMemoryTraceFocusStrength(null, Number.NaN)).toBe(0);
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
