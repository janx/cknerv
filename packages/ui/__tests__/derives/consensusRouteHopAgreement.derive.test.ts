import { describe, expect, it } from 'vitest';
import type { Cell } from '@cknerv/types';
import {
  CONSENSUS_ROUTE_HOP_AGREEMENT_CAP,
  deriveConsensusRouteHopAgreementCallout,
  deriveConsensusRouteHopAgreementEmphasis,
  deriveConsensusRouteHopAgreementPlan,
} from '../../src/derives/consensusRouteHopAgreement.derive';
import type {
  ConsensusMemoryTraceFocus,
  ConsensusMemoryTraceFocusSource,
} from '../../src/nerve/consensusMemoryTrace';

function target(id = 9): Cell {
  return {
    id,
    born_at_ms: 0,
    death_at_ms: null,
    birth_block: 99,
    tag: null,
    pos_seed: [1, 2, 3],
    out_point: { tx_hash: '0xtarget', index: 0 },
    capacity: 0,
    data_hex: '0x',
    content_hash: '0xshared-record',
  };
}

function source(id: number, arrivesAtSec: number): ConsensusMemoryTraceFocusSource {
  return {
    id,
    contentHash: `0xevidence-${id}`,
    outPoint: { tx_hash: `0x${id}`, index: 0 },
    birthBlock: id,
    startsAtSec: 10,
    arrivesAtSec,
    routes: [{
      targetId: 9,
      path: [id, id + 100, 9],
      color: [0.2, 0.6, 1],
      hopCount: 2,
      hopMs: 250,
      startsAtSec: 10,
      arrivesAtSec,
    }],
  };
}

function focus(
  sources: ConsensusMemoryTraceFocusSource[],
  routedSourceCount = sources.length,
): ConsensusMemoryTraceFocus {
  return {
    key: 'trace',
    sourceKind: 'input',
    sources,
    routedSourceCount,
    targetIds: [9],
    startedAtSec: 10,
    endsAtSec: 20,
    evidenceFocusSourceId: null,
    routeHopFocus: null,
  };
}

describe('deriveConsensusRouteHopAgreementPlan', () => {
  it('binds real source identities and preserves their arrival gaps', () => {
    const model = deriveConsensusRouteHopAgreementPlan(focus([
      source(1, 12.2),
      source(2, 11),
      source(3, 11.6),
    ]), target());

    expect(model.visibleSourceCount).toBe(3);
    expect(model.hiddenSourceCount).toBe(0);
    expect(model.ticks.map(({ sourceId }) => sourceId)).toEqual([1, 2, 3]);
    expect(model.ticks[1].arrivalProgress).toBeCloseTo(0.18);
    expect(model.ticks[2].arrivalProgress).toBeCloseTo(0.4);
    expect(model.ticks[0].arrivalProgress).toBeCloseTo(0.62);
    expect(new Set(model.ticks.map(({ angle }) => angle)).size).toBe(3);
    expect(model.ticks.every(({ color }) => color.length === 3)).toBe(true);
    expect(model.ticks[0].targetFocus).toEqual({
      traceKey: 'trace',
      sourceId: 1,
      targetCellId: 9,
      cellId: 9,
      hopIndex: 2,
    });
  });

  it('resolves simultaneous evidence together and reports a visible cap', () => {
    const sources = [source(1, 11), source(2, 11), source(3, 11)];
    const simultaneous = deriveConsensusRouteHopAgreementPlan(
      focus(sources),
      target(),
    );
    expect(simultaneous.ticks.map(({ arrivalProgress }) => arrivalProgress))
      .toEqual([0.36, 0.36, 0.36]);

    const capped = deriveConsensusRouteHopAgreementPlan(
      focus(sources),
      target(),
      2,
    );
    expect(CONSENSUS_ROUTE_HOP_AGREEMENT_CAP).toBe(3);
    expect(capped).toMatchObject({
      routedSourceCount: 3,
      visibleSourceCount: 2,
      hiddenSourceCount: 1,
    });

    const upstreamCapped = deriveConsensusRouteHopAgreementPlan(
      focus(sources, 5),
      target(),
    );
    expect(upstreamCapped).toMatchObject({
      routedSourceCount: 5,
      visibleSourceCount: 3,
      hiddenSourceCount: 2,
    });
  });

  it('does not invent ticks for an unrelated target or invalid capacity', () => {
    expect(deriveConsensusRouteHopAgreementPlan(
      focus([source(1, 11)]),
      target(99),
    ).ticks).toEqual([]);
    expect(deriveConsensusRouteHopAgreementPlan(
      focus([source(1, 11)]),
      target(),
      Number.NaN,
    )).toMatchObject({
      routedSourceCount: 1,
      visibleSourceCount: 0,
      hiddenSourceCount: 1,
    });
  });

  it('isolates only a retained visible source and ignores stale focus', () => {
    const model = deriveConsensusRouteHopAgreementPlan(
      focus([source(1, 11), source(2, 12), source(3, 13)]),
      target(),
    );

    expect(deriveConsensusRouteHopAgreementEmphasis(model, null)).toEqual({
      sourceId: null,
      scales: [1, 1, 1],
    });
    expect(deriveConsensusRouteHopAgreementEmphasis(model, 2)).toEqual({
      sourceId: 2,
      scales: [0.16, 1, 0.16],
    });
    expect(deriveConsensusRouteHopAgreementEmphasis(model, 999)).toEqual({
      sourceId: null,
      scales: [1, 1, 1],
    });
  });

  it('places a chain-derived evidence label on the matching signature', () => {
    const model = deriveConsensusRouteHopAgreementPlan(
      focus([source(17, 11), source(24, 12)]),
      target(),
    );
    const tick = model.ticks[1];
    const callout = deriveConsensusRouteHopAgreementCallout(tick);

    expect(callout).toMatchObject({
      evidenceCode: 'E02',
      sourceLabel: 'CELL #24',
      fingerprint: 'EVIDENCE-24',
      side: Math.cos(tick.angle) >= 0 ? 'right' : 'left',
    });
    expect(Math.hypot(callout.anchorXPx, callout.anchorYPx)).toBeCloseTo(32);
    expect(Math.abs(callout.offsetYPx)).toBeLessThanOrEqual(6);
    expect(Math.hypot(
      deriveConsensusRouteHopAgreementCallout(tick, 200).anchorXPx,
      deriveConsensusRouteHopAgreementCallout(tick, 200).anchorYPx,
    )).toBeCloseTo(64);
    expect(Math.hypot(
      deriveConsensusRouteHopAgreementCallout(tick, Number.NaN).anchorXPx,
      deriveConsensusRouteHopAgreementCallout(tick, Number.NaN).anchorYPx,
    )).toBeCloseTo(32);
  });
});
