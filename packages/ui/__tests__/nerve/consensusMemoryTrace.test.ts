import { describe, expect, it } from 'vitest';
import type { Cell, CellLink, CellLinkEndpointAnchor } from '@cknerv/types';
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
  cloneConsensusMemoryTraceReadout,
  consensusMemoryCellResponseForFrame,
  consensusMemoryCellResponseInto,
  consensusMemoryTraceRequestKey,
  consensusMemoryTraceReadout,
  consensusMemoryTraceReadoutChanged,
  consensusMemoryTraceReadoutInto,
  makeConsensusMemoryCellResponseScratch,
  makeConsensusMemoryTraceReadoutScratch,
  makeConsensusMemoryTraceReadoutSignature,
  resetConsensusMemoryCellResponseFrameCache,
  consensusMemoryTraceFocusStrength,
  consensusMemoryTraceResonance,
  consensusMemoryTraceSourceStrength,
  deriveConsensusMemoryTraceFocus,
  deriveConsensusMemoryRouteHopFocus,
  deriveConsensusMemoryRouteHopInspection,
  deriveConsensusMemoryRouteHopSpatialFocus,
  deriveConsensusMemoryRouteHopTangent,
  deriveConsensusMemoryRouteHopWindow,
  deriveConsensusMemoryConsumedInputs,
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
    data_bytes: 0,
    content_hash: `0x${String(id).padStart(64, '0')}`,
    lock_shape_seed: [1, 2],
    type_shape_seed: null,
    data_shape_seed: [3, 4],
  };
}

function link(over: Partial<CellLink> = {}): CellLink {
  return {
    seq: 7,
    tx_hash: '0xtrace',
    block: 99,
    from_ids: [1, 2],
    to_ids: [5],
    endpoint_anchors: [],
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
      && pulse.linkSeq === 7
      && pulse.linkBlock === 99
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
    expect(focus).toMatchObject({ linkSeq: 7, linkBlock: 99 });
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

describe('deriveConsensusMemoryConsumedInputs', () => {
  const anchor = (
    id: number,
    hash = `0xaa${String(id).padStart(62, '0')}`,
    resolved = true,
  ): CellLinkEndpointAnchor => ({
    id,
    pos_seed: [id, id * 2, id * 3] as [number, number, number],
    content_hash: hash,
    resolved,
  });

  /** The server's identity-only anchor: derived from the outpoint alone, so
   *  the place is exact and the content is unknown. */
  const derived = (id: number): CellLinkEndpointAnchor => anchor(id, '', false);

  it('names what the transaction spent with nothing left in the cell map', () => {
    const consumed = deriveConsensusMemoryConsumedInputs(
      link({ endpoint_anchors: [anchor(1), anchor(2), anchor(5)] }),
      new Map(),
    );
    expect(consumed.map((input) => input.id)).toEqual([1, 2]);
    expect(consumed[0].contentHash).toBe(anchor(1).content_hash);
    expect(consumed[0].posSeed).toEqual([1, 2, 3]);
    expect(consumed.every((input) => input.retained)).toBe(false);
  });

  // The identity has to come from the record, not from a cell that happens to
  // linger — otherwise it is the same substitution this fixes.
  it('reads identity from the anchor even when the cell is still around', () => {
    const consumed = deriveConsensusMemoryConsumedInputs(
      link({ from_ids: [1], endpoint_anchors: [anchor(1)] }),
      new Map([[1, cell(1)]]),
    );
    expect(consumed).toHaveLength(1);
    expect(consumed[0].contentHash).toBe(anchor(1).content_hash);
    expect(consumed[0].contentHash).not.toBe(cell(1).content_hash);
    expect(consumed[0].retained).toBe(true);
  });

  it('keeps the transaction input order and drops repeats', () => {
    const consumed = deriveConsensusMemoryConsumedInputs(
      link({ from_ids: [2, 1, 2], endpoint_anchors: [anchor(1), anchor(2)] }),
      new Map(),
    );
    expect(consumed.map((input) => input.id)).toEqual([2, 1]);
  });

  it('stays silent about inputs the record cannot identify', () => {
    expect(deriveConsensusMemoryConsumedInputs(link(), new Map())).toEqual([]);
    const partial = deriveConsensusMemoryConsumedInputs(
      link({ endpoint_anchors: [anchor(2)] }),
      new Map(),
    );
    expect(partial.map((input) => input.id)).toEqual([2]);
  });

  it('reads the same evidence whether or not identity-only anchors ride along', () => {
    const withDerived = deriveConsensusMemoryConsumedInputs(
      link({
        endpoint_anchors: [
          anchor(1), derived(9), anchor(2), derived(2), anchor(5),
        ],
      }),
      new Map(),
    );
    const without = deriveConsensusMemoryConsumedInputs(
      link({ endpoint_anchors: [anchor(1), anchor(2), anchor(5)] }),
      new Map(),
    );
    expect(withDerived).toEqual(without);
    expect(withDerived.map((input) => input.id)).toEqual([1, 2]);
    expect(withDerived.map((input) => input.contentHash))
      .toEqual([anchor(1).content_hash, anchor(2).content_hash]);
  });

  // The exclusion is the reader's, not the writer's to grant: today no derived
  // id reaches `from_ids`, and this surface must not start trusting that.
  it('refuses an identity-only anchor even when the record lists it as an input', () => {
    const consumed = deriveConsensusMemoryConsumedInputs(
      link({ from_ids: [1, 9], endpoint_anchors: [anchor(1), derived(9)] }),
      new Map(),
    );
    expect(consumed.map((input) => input.id)).toEqual([1]);
  });

  it('keeps anchors from records written before the resolved field existed', () => {
    const legacy = { ...anchor(1) } as Partial<CellLinkEndpointAnchor>;
    delete legacy.resolved;
    const consumed = deriveConsensusMemoryConsumedInputs(
      link({
        from_ids: [1],
        endpoint_anchors: [legacy as CellLinkEndpointAnchor],
      }),
      new Map(),
    );
    expect(consumed.map((input) => input.id)).toEqual([1]);
    expect(consumed[0].contentHash).toBe(anchor(1).content_hash);
  });
});

describe('consumed inputs survive a witness-carried recall', () => {
  const anchor = (id: number, resolved = true): CellLinkEndpointAnchor => ({
    id,
    pos_seed: [id, 0, 0] as [number, number, number],
    content_hash: resolved ? `0xaa${String(id).padStart(62, '0')}` : '',
    resolved,
  });

  // The defect this fixes: for all but the freshest records the spent inputs
  // are gone, the route is carried by surviving siblings, and the ledger used
  // to name the carriers and nothing else.
  it('reports the real inputs while routing through lineage witnesses', () => {
    const spent = link({
      from_ids: [1, 2],
      to_ids: [5],
      parents: ['0xparent'],
      endpoint_anchors: [anchor(1), anchor(2), anchor(5)],
    });
    // Neither input is in view; a sibling of the parent tx is.
    const witness = { ...cell(4), out_point: { tx_hash: '0xparent', index: 0 } };
    const cells = new Map([[4, witness], [5, cell(5)]]);

    const plan = planConsensusMemoryTrace(spent, cells, graph([[4, 5]]));

    expect(plan.sourceKind).toBe('witness');
    expect(plan.sourceIds).toEqual([4]);
    expect(plan.retainedInputIds).toEqual([]);
    expect(plan.pulses.length).toBeGreaterThan(0);
    // ...and the record still says exactly what was spent.
    expect(plan.consumedInputs.map((input) => input.id)).toEqual([1, 2]);
    expect(plan.consumedInputs.every((input) => input.retained)).toBe(false);
  });

  // The identity-only rung of the origin ladder rides the same record as the
  // resolved anchors; the recalled trace must not notice it at all.
  it('plans the identical trace when identity-only anchors ride the record', () => {
    const base = {
      from_ids: [1, 2],
      to_ids: [5],
      parents: ['0xparent'],
    };
    const witness = { ...cell(4), out_point: { tx_hash: '0xparent', index: 0 } };
    const cells = new Map([[4, witness], [5, cell(5)]]);
    const edges = graph([[4, 5]]);

    const plain = planConsensusMemoryTrace(
      link({ ...base, endpoint_anchors: [anchor(1), anchor(2), anchor(5)] }),
      cells,
      edges,
    );
    const mixed = planConsensusMemoryTrace(
      link({
        ...base,
        endpoint_anchors: [
          anchor(1), anchor(7, false), anchor(2), anchor(9, false), anchor(5),
        ],
      }),
      cells,
      edges,
    );

    expect(mixed).toEqual(plain);
    expect(mixed.consumedInputs.map((input) => input.id)).toEqual([1, 2]);
  });

  it('carries them through the focus and the readout the HUD reads', () => {
    const spent = link({
      from_ids: [1, 2],
      to_ids: [5],
      parents: ['0xparent'],
      endpoint_anchors: [anchor(1), anchor(2), anchor(5)],
    });
    const witness = { ...cell(4), out_point: { tx_hash: '0xparent', index: 0 } };
    const cells = new Map([[4, witness], [5, cell(5)]]);
    const plan = planConsensusMemoryTrace(spent, cells, graph([[4, 5]]));
    const focus = deriveConsensusMemoryTraceFocus(plan, 10, 'trace');
    expect(focus).not.toBeNull();
    expect(focus!.consumedInputs.map((input) => input.id)).toEqual([1, 2]);

    const readout = consensusMemoryTraceReadout(focus, 5, 10.1);
    expect(readout).not.toBeNull();
    expect(readout!.sourceKind).toBe('witness');
    expect(readout!.consumedInputs.map((input) => input.id)).toEqual([1, 2]);
    // The carrier and the input are different cells; that is the whole point.
    expect(readout!.evidence.map((e) => e.sourceId)).toEqual([4]);
  });
});

describe('lineage witness fallback', () => {
  const sibling = (id: number, parent: string, dead = false): Cell => ({
    ...cell(id),
    death_at_ms: dead ? 100 : null,
    out_point: { tx_hash: parent, index: id },
  });

  /** Counts how many retained cells the fallback loop actually inspects. */
  const counted = (record: Cell, onRead: () => void): Cell => {
    const probed: Cell = { ...record };
    Object.defineProperty(probed, 'death_at_ms', {
      get: () => {
        onRead();
        return record.death_at_ms;
      },
    });
    return probed;
  };

  /** Counts per-cell `Array#includes` scans of the output list. */
  const scannedIds = (ids: number[]) => {
    let scans = 0;
    const toIds = [...ids];
    Object.defineProperty(toIds, 'includes', {
      value: (value: number) => {
        scans += 1;
        return ids.includes(value);
      },
    });
    return { toIds, scans: () => scans };
  };

  it('charges a witness slot only to the cells it accepts, in reading order', () => {
    const parent = '0xparent';
    // Insertion order is the reading order, and deliberately not id order.
    const cells = new Map<number, Cell>([
      [7, sibling(7, parent)],
      [8, sibling(8, parent, true)],
      [11, sibling(11, parent)],
      [9, sibling(9, parent)],
      [10, sibling(10, parent)],
    ]);
    const endpoints = deriveConsensusMemoryTraceEndpoints(
      link({ from_ids: [1, 2], to_ids: [7, 20], parents: [parent] }),
      cells,
    );

    expect(endpoints.sourceKind).toBe('witness');
    // 7 is an output of this very link and 8 is in its death tail: both are
    // skipped WITHOUT consuming one of the parent's two slots.
    expect(endpoints.witnessIds).toEqual([11, 9]);
    expect(endpoints.sourceIds).toEqual([11, 9]);
  });

  it('resolves witnesses without a per-cell output scan, and stops at the cap', () => {
    const parents = ['0xpa', '0xpb'];
    const filler = Array.from(
      { length: 200 },
      (_, index) => sibling(500 + index, `0xother${index}`),
    );
    const outputs = scannedIds(Array.from({ length: 24 }, (_, i) => 900 + i));
    const mapOf = (eligible: Cell[], onRead: () => void) => new Map<number, Cell>(
      [...eligible, ...filler].map((record) => [
        record.id,
        counted(record, onRead),
      ]),
    );

    let reads = 0;
    const capped = mapOf([
      sibling(101, parents[0]),
      sibling(102, parents[0]),
      sibling(103, parents[1]),
      sibling(104, parents[1]),
    ], () => { reads += 1; });
    const endpoints = deriveConsensusMemoryTraceEndpoints(
      link({ from_ids: [1, 2], to_ids: outputs.toIds, parents }),
      capped,
    );

    expect(endpoints.witnessIds).toEqual([101, 102, 103, 104]);
    expect(outputs.scans()).toBe(0);
    expect(reads).toBe(4);

    // A parent that cannot fill its slots still costs exactly one pass.
    let sparseReads = 0;
    const sparse = mapOf([sibling(101, parents[0])], () => { sparseReads += 1; });
    expect(deriveConsensusMemoryTraceEndpoints(
      link({ from_ids: [1, 2], to_ids: outputs.toIds, parents }),
      sparse,
    ).witnessIds).toEqual([101]);
    expect(sparseReads).toBe(sparse.size);
  });
});

describe('frame-rate recall derives', () => {
  const recallFocus = () => {
    const cells = new Map([1, 2, 3, 4, 5].map((id) => [id, cell(id)]));
    const plan = planConsensusMemoryTrace(
      link(),
      cells,
      graph([[1, 3], [2, 4], [3, 5], [4, 5]]),
    );
    return deriveConsensusMemoryTraceFocus(plan, 10, '7:5:1')!;
  };

  it('into-form cell responses match the allocating form on a reused scratch', () => {
    const focus = recallFocus();
    const scratch = makeConsensusMemoryCellResponseScratch();
    const arrival = Math.max(...focus.sources.map((source) => source.arrivesAtSec));
    const stamps = [10.001, 10.4, arrival, arrival + 0.3];
    // Same scratch across every case: a leftover evidence row or a stale
    // role would show up as a mismatch against the fresh-object form.
    for (const nowSec of stamps) {
      for (const cellId of [focus.sources[0].id, focus.sources[1].id, 5, 999]) {
        const into = consensusMemoryCellResponseInto(scratch, focus, cellId, nowSec);
        expect(into).toEqual(consensusMemoryCellResponse(focus, cellId, nowSec));
        if (into) expect(into).toBe(scratch);
      }
    }
    const target = consensusMemoryCellResponseInto(scratch, focus, 5, arrival);
    expect(target?.role).toBe('target');
    expect(target?.evidence).toHaveLength(2);
    // A focus with fewer routed sources must not inherit the wider ledger.
    const narrowPlan = planConsensusMemoryTrace(
      link({ from_ids: [1] }),
      new Map([1, 3, 5].map((id) => [id, cell(id)])),
      graph([[1, 3], [3, 5]]),
    );
    const narrow = deriveConsensusMemoryTraceFocus(narrowPlan, 10, '7:5:2')!;
    expect(consensusMemoryCellResponseInto(scratch, narrow, 5, 10.4))
      .toEqual(consensusMemoryCellResponse(narrow, 5, 10.4));
    expect(scratch.evidence).toHaveLength(1);
    // A source read after a target read must not inherit the target's shape.
    const source = consensusMemoryCellResponseInto(
      scratch,
      focus,
      focus.sources[0].id,
      arrival,
    );
    expect(source?.role).toBe('source');
    expect(source?.evidence).toBeUndefined();
  });

  it('into-form readouts match the allocating form on a reused scratch', () => {
    const focus = recallFocus();
    const scratch = makeConsensusMemoryTraceReadoutScratch();
    const arrival = Math.min(...focus.sources.map((source) => source.arrivesAtSec));
    for (const nowSec of [10.001, arrival, arrival + 0.4, focus.endsAtSec - 0.01]) {
      const into = consensusMemoryTraceReadoutInto(scratch, focus, 5, nowSec);
      expect(into).toEqual(consensusMemoryTraceReadout(focus, 5, nowSec));
      if (into) expect(into).toBe(scratch);
    }
    // Rejections leave the scratch alone rather than publishing a half state.
    expect(consensusMemoryTraceReadoutInto(scratch, focus, 999, arrival)).toBeNull();
    expect(consensusMemoryTraceReadoutInto(scratch, focus, 5, focus.endsAtSec))
      .toBeNull();
    // Evidence rows are reused, not rebuilt.
    const first = consensusMemoryTraceReadoutInto(scratch, focus, 5, arrival)!;
    const firstRow = first.evidence[0];
    const again = consensusMemoryTraceReadoutInto(scratch, focus, 5, arrival + 0.2)!;
    expect(again.evidence[0]).toBe(firstRow);

    // What leaves for React state owns everything the next frame rewrites.
    const owned = cloneConsensusMemoryTraceReadout(again);
    expect(owned).toEqual(again);
    expect(owned.evidence).not.toBe(again.evidence);
    expect(owned.evidence[0]).not.toBe(again.evidence[0]);
    expect(owned.evidence[0].sourceOutPoint).not.toBe(
      again.evidence[0].sourceOutPoint,
    );
    consensusMemoryTraceReadoutInto(scratch, focus, 5, focus.endsAtSec - 0.01);
    expect(owned).toEqual(consensusMemoryTraceReadout(focus, 5, arrival + 0.2));
  });

  it('publishes a readout only when its stage or ledger actually moves', () => {
    const focus = recallFocus();
    const scratch = makeConsensusMemoryTraceReadoutScratch();
    const signature = makeConsensusMemoryTraceReadoutSignature();
    const at = (nowSec: number) =>
      consensusMemoryTraceReadoutInto(scratch, focus, 5, nowSec);

    expect(consensusMemoryTraceReadoutChanged(signature, null)).toBe(false);
    expect(consensusMemoryTraceReadoutChanged(signature, at(10.001))).toBe(true);
    expect(consensusMemoryTraceReadoutChanged(signature, at(10.002))).toBe(false);
    const arrival = Math.min(...focus.sources.map((source) => source.arrivesAtSec));
    expect(consensusMemoryTraceReadoutChanged(signature, at(arrival))).toBe(true);
    expect(consensusMemoryTraceReadoutChanged(signature, at(arrival + 0.001)))
      .toBe(false);
    expect(consensusMemoryTraceReadoutChanged(signature, null)).toBe(true);
    expect(consensusMemoryTraceReadoutChanged(signature, null)).toBe(false);
  });

  it('shares one response per Cell per clock stamp, and re-derives when inputs move', () => {
    resetConsensusMemoryCellResponseFrameCache();
    const focus = recallFocus();
    const first = consensusMemoryCellResponseForFrame(focus, 5, 10.4)!;
    expect(consensusMemoryCellResponseForFrame(focus, 5, 10.4)).toBe(first);
    expect(first).toEqual(consensusMemoryCellResponse(focus, 5, 10.4));
    // Different Cells never share storage, so a borrowed view stays valid for
    // the whole frame no matter who else asked.
    const source = consensusMemoryCellResponseForFrame(
      focus,
      focus.sources[0].id,
      10.4,
    )!;
    expect(source).not.toBe(first);
    expect(consensusMemoryCellResponseForFrame(focus, 5, 10.4)).toBe(first);
    // The clock and the (mutable) evidence isolation are both derive inputs.
    expect(consensusMemoryCellResponseForFrame(focus, 5, 10.5))
      .toEqual(consensusMemoryCellResponse(focus, 5, 10.5));
    focus.evidenceFocusSourceId = focus.sources[0].id;
    expect(consensusMemoryCellResponseForFrame(focus, focus.sources[1].id, 10.4))
      .toEqual(consensusMemoryCellResponse(focus, focus.sources[1].id, 10.4));
    expect(consensusMemoryCellResponseForFrame(null, 5, 10.4)).toBeNull();

    // A departing record and its replacement overlap for about a second and
    // light the same endpoints: alternating between them must reuse storage
    // rather than reallocate it, and must never answer for the wrong one.
    const departing = recallFocus();
    const alternate = consensusMemoryCellResponseForFrame(departing, 5, 10.4)!;
    expect(alternate).toBe(first);
    expect(alternate).toEqual(consensusMemoryCellResponse(departing, 5, 10.4));
    expect(consensusMemoryCellResponseForFrame(focus, 5, 10.4))
      .toEqual(consensusMemoryCellResponse(focus, 5, 10.4));
  });
});
