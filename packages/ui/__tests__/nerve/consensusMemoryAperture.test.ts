import { describe, expect, it } from 'vitest';
import type { Cell } from '@cknerv/types';
import {
  CONSENSUS_MEMORY_APERTURE_CORE_SCALE,
  CONSENSUS_MEMORY_APERTURE_INNER_RADIUS,
  CONSENSUS_MEMORY_APERTURE_OUTER_RADIUS,
  consensusMemoryApertureAnimating,
  consensusMemoryApertureScale,
  deriveConsensusMemoryAperture,
  type ConsensusMemoryAperture,
} from '../../src/nerve/consensusMemoryAperture';
import {
  MEMORY_TRACE_FADE_MS,
  MEMORY_TRACE_SETTLE_MS,
  MEMORY_TRACE_SOURCE_REVEAL_MS,
  type ConsensusMemoryTraceFocus,
  type ConsensusMemoryTraceFocusSource,
  type ConsensusMemoryTraceRoute,
} from '../../src/nerve/consensusMemoryTrace';

function cell(id: number, x: number, z: number): Cell {
  return {
    id,
    born_at_ms: 0,
    death_at_ms: null,
    birth_block: 1,
    tag: null,
    pos_seed: [x, 0, z],
    out_point: { tx_hash: `0x${id}`, index: 0 },
    capacity: 0,
    data_hex: '0x',
    content_hash: `0x${String(id).padStart(64, '0')}`,
  };
}

function route(
  targetId: number,
  path: number[],
  startsAtSec = 1,
  hopMs = 240,
): ConsensusMemoryTraceRoute {
  return {
    targetId,
    path,
    color: [1, 0.7, 0.3],
    hopCount: path.length - 1,
    hopMs,
    startsAtSec,
    arrivesAtSec: startsAtSec + (path.length - 1) * hopMs / 1_000,
  };
}

function source(
  id: number,
  routes: ConsensusMemoryTraceRoute[],
): ConsensusMemoryTraceFocusSource {
  const startsAtSec = Math.min(...routes.map((candidate) => candidate.startsAtSec));
  const arrivesAtSec = Math.min(...routes.map((candidate) => candidate.arrivesAtSec));
  return {
    id,
    contentHash: `0x${String(id).padStart(64, '0')}`,
    outPoint: { tx_hash: `0x${id}`, index: 0 },
    birthBlock: 1,
    startsAtSec,
    arrivesAtSec,
    routes,
  };
}

function focus(
  sources: ConsensusMemoryTraceFocusSource[],
  targetIds: number[],
): ConsensusMemoryTraceFocus {
  return {
    key: 'trace:1',
    linkSeq: 1,
    linkBlock: 1,
    sourceKind: 'input',
    sources,
    routedSourceCount: sources.length,
    targetIds,
    startedAtSec: 1,
    endsAtSec: 5,
    evidenceFocusSourceId: null,
    routeHopFocus: null,
  };
}

function straightField(): ConsensusMemoryAperture {
  const candidates = [0];
  const zBuckets = new Map<number, readonly number[]>();
  for (let gridZ = -2; gridZ <= 2; gridZ++) {
    zBuckets.set(gridZ, candidates);
  }
  return {
    segments: [{
      ax: 0,
      az: 0,
      bx: 20,
      bz: 0,
      traversals: [{
        opensAtStartSec: 1,
        opensAtEndSec: 2,
        routeProgressStart: 0,
        routeProgressEnd: 1,
        routeProgressFeather: 1,
        collapseStartsAtSec: 3,
        collapseEndsAtSec: 4,
      }],
    }],
    buckets: new Map([[0, zBuckets]]),
    edgeCount: 1,
    gridSize: CONSENSUS_MEMORY_APERTURE_OUTER_RADIUS,
    innerRadius: CONSENSUS_MEMORY_APERTURE_INNER_RADIUS,
    outerRadius: CONSENSUS_MEMORY_APERTURE_OUTER_RADIUS,
    temporalStartsAtSec: 1,
    temporalEndsAtSec: 4,
  };
}

describe('consensus memory aperture', () => {
  it('builds only from complete retained routes whose Cells still exist', () => {
    const cells = new Map<number, Cell>([
      [1, cell(1, -30, 0)],
      [3, cell(3, -10, 0)],
      [4, cell(4, 20, 0)],
      [5, cell(5, 30, 0)],
    ]);
    const trace = focus([
      source(1, [route(3, [1, 2, 3])]),
      source(4, [route(5, [4, 5])]),
    ], [3, 5]);

    const aperture = deriveConsensusMemoryAperture(trace, cells);

    expect(aperture).not.toBeNull();
    expect(aperture?.edgeCount).toBe(1);
    expect(consensusMemoryApertureScale(aperture, -20, 0, 1)).toBe(1);
    expect(consensusMemoryApertureScale(aperture, 25, 0, 1))
      .toBeCloseTo(CONSENSUS_MEMORY_APERTURE_CORE_SCALE);
  });

  it('returns no field for absent, malformed, or entirely unavailable proof', () => {
    const cells = new Map<number, Cell>([
      [1, cell(1, 0, 0)],
      [3, cell(3, 12, 0)],
    ]);
    const malformed = route(3, [1, 3]);
    malformed.hopCount = 9;
    const looping = route(3, [1, 3, 1, 3]);

    expect(deriveConsensusMemoryAperture(null, cells)).toBeNull();
    expect(deriveConsensusMemoryAperture(
      focus([source(1, [route(3, [1, 2, 3])])], [3]),
      cells,
    )).toBeNull();
    expect(deriveConsensusMemoryAperture(
      focus([source(1, [malformed])], [3]),
      cells,
    )).toBeNull();
    expect(deriveConsensusMemoryAperture(
      focus([source(1, [looping])], [3]),
      cells,
    )).toBeNull();
  });

  it('deduplicates shared proof edges without inventing source bridges', () => {
    const cells = new Map<number, Cell>([
      [1, cell(1, -10, -10)],
      [2, cell(2, 0, 0)],
      [3, cell(3, 10, 0)],
      [4, cell(4, -10, 10)],
      [5, cell(5, 20, 0)],
    ]);
    const aperture = deriveConsensusMemoryAperture(focus([
      source(1, [route(5, [1, 2, 3, 5])]),
      source(4, [route(5, [4, 2, 3, 5], 2)]),
    ], [5]), cells);

    expect(aperture?.edgeCount).toBe(4);
    expect(aperture?.segments.length).toBeGreaterThan(aperture?.edgeCount ?? 0);
    expect(aperture?.segments.some((segment) => (
      segment.traversals.length === 2
    ))).toBe(true);
    expect(consensusMemoryApertureScale(aperture, 0, -30, 1)).toBe(1);
    // The first traversal has fully closed, but the later real source still
    // owns the shared target edge; it closes only on its own route clock.
    expect(consensusMemoryApertureScale(aperture, 20, 0, 1, 3.9))
      .toBeLessThan(1);
    expect(consensusMemoryApertureScale(aperture, 20, 0, 1, 4.8)).toBe(1);
  });

  it('opens progressively behind the exact evidence wavefront', () => {
    const cells = new Map<number, Cell>([
      [1, cell(1, 0, 0)],
      [2, cell(2, 20, 0)],
      [3, cell(3, 40, 0)],
      [4, cell(4, 60, 0)],
    ]);
    const timedRoute = route(4, [1, 2, 3, 4], 10, 1_000);
    const aperture = deriveConsensusMemoryAperture(
      focus([source(1, [timedRoute])], [4]),
      cells,
    );
    const openedAtSource = 10 + MEMORY_TRACE_SOURCE_REVEAL_MS / 1_000;
    const openedAtTarget = timedRoute.arrivesAtSec
      + MEMORY_TRACE_SOURCE_REVEAL_MS / 1_000;

    expect(consensusMemoryApertureScale(aperture, 0, 0, 1, 9.99)).toBe(1);
    expect(consensusMemoryApertureScale(aperture, 0, 0, 1, openedAtSource))
      .toBeCloseTo(CONSENSUS_MEMORY_APERTURE_CORE_SCALE);
    expect(consensusMemoryApertureScale(aperture, 60, 0, 1, 11)).toBe(1);
    expect(consensusMemoryApertureScale(aperture, 60, 0, 1, openedAtTarget))
      .toBeCloseTo(CONSENSUS_MEMORY_APERTURE_CORE_SCALE);
  });

  it('closes from source toward the retained target on the resonance clock', () => {
    const cells = new Map<number, Cell>([
      [1, cell(1, 0, 0)],
      [2, cell(2, 20, 0)],
      [3, cell(3, 40, 0)],
      [4, cell(4, 60, 0)],
      [5, cell(5, 80, 0)],
    ]);
    const timedRoute = route(5, [1, 2, 3, 4, 5], 0, 500);
    const aperture = deriveConsensusMemoryAperture(
      focus([source(1, [timedRoute])], [5]),
      cells,
    );
    const collapseStartsAtSec = timedRoute.arrivesAtSec
      + MEMORY_TRACE_SETTLE_MS / 1_000;
    const collapseEndsAtSec = collapseStartsAtSec
      + MEMORY_TRACE_FADE_MS / 1_000;
    const halfway = (collapseStartsAtSec + collapseEndsAtSec) * 0.5;

    expect(aperture?.temporalStartsAtSec).toBe(timedRoute.startsAtSec);
    expect(aperture?.temporalEndsAtSec).toBeCloseTo(collapseEndsAtSec);
    expect(consensusMemoryApertureAnimating(aperture, -0.01)).toBe(false);
    expect(consensusMemoryApertureAnimating(aperture, 0)).toBe(true);
    expect(consensusMemoryApertureAnimating(aperture, collapseEndsAtSec))
      .toBe(true);
    expect(consensusMemoryApertureAnimating(aperture, collapseEndsAtSec + 0.01))
      .toBe(false);

    expect(consensusMemoryApertureScale(
      aperture,
      0,
      0,
      1,
      collapseStartsAtSec,
    )).toBeCloseTo(CONSENSUS_MEMORY_APERTURE_CORE_SCALE);
    expect(consensusMemoryApertureScale(aperture, 0, 0, 1, halfway)).toBe(1);
    expect(consensusMemoryApertureScale(aperture, 80, 0, 1, halfway))
      .toBeCloseTo(CONSENSUS_MEMORY_APERTURE_CORE_SCALE);
    expect(consensusMemoryApertureScale(
      aperture,
      80,
      0,
      1,
      collapseEndsAtSec,
    )).toBe(1);
  });

  it('attenuates smoothly near the route and is exactly neutral outside', () => {
    const aperture = straightField();
    const transitionRadius = (
      CONSENSUS_MEMORY_APERTURE_INNER_RADIUS
      + CONSENSUS_MEMORY_APERTURE_OUTER_RADIUS
    ) * 0.5;

    expect(consensusMemoryApertureScale(aperture, 5, 0, 1))
      .toBeCloseTo(CONSENSUS_MEMORY_APERTURE_CORE_SCALE);
    expect(consensusMemoryApertureScale(
      aperture,
      5,
      CONSENSUS_MEMORY_APERTURE_INNER_RADIUS,
      1,
    )).toBeCloseTo(CONSENSUS_MEMORY_APERTURE_CORE_SCALE);
    expect(consensusMemoryApertureScale(aperture, 5, transitionRadius, 1))
      .toBeCloseTo((1 + CONSENSUS_MEMORY_APERTURE_CORE_SCALE) * 0.5);
    expect(consensusMemoryApertureScale(
      aperture,
      5,
      CONSENSUS_MEMORY_APERTURE_OUTER_RADIUS,
      1,
    )).toBe(1);
    expect(consensusMemoryApertureScale(aperture, 5, 100, 1)).toBe(1);
  });

  it('follows focus strength while real lifecycle flashes reclaim priority', () => {
    const aperture = straightField();
    const halfFocus = 1 - 0.5 * (1 - CONSENSUS_MEMORY_APERTURE_CORE_SCALE);

    expect(consensusMemoryApertureScale(aperture, 5, 0, 0)).toBe(1);
    expect(consensusMemoryApertureScale(aperture, 5, 0, 0.5))
      .toBeCloseTo(halfFocus);
    expect(consensusMemoryApertureScale(aperture, 5, 0, 1, undefined, 0.5))
      .toBeCloseTo((1 + CONSENSUS_MEMORY_APERTURE_CORE_SCALE) * 0.5);
    expect(consensusMemoryApertureScale(aperture, 5, 0, 1, undefined, 1))
      .toBe(1);
    expect(consensusMemoryApertureScale(aperture, 5, 0, Number.NaN)).toBe(1);
  });
});
