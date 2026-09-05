import { describe, expect, it } from 'vitest';
import type { Cell } from '@cknerv/types';
import { deriveCellMorphologyTopology } from '../../src/derives/cellMorphology.derive';
import {
  CONSENSUS_BRAID_FIELDS,
  consensusBraidAgreementResolution,
  consensusBraidAgreementTarget,
  consensusBraidBirthPhase,
  consensusBraidContributorColor,
  consensusBraidLayerOpacity,
  consensusBraidPathPoint,
  consensusBraidPresenceScale,
  deriveConsensusBraidTopology,
} from '../../src/derives/consensusBraid.derive';

const CELL: Cell = {
  id: 17,
  born_at_ms: 0,
  death_at_ms: null,
  birth_block: 12_345,
  tag: null,
  pos_seed: [0, 0, 0],
  out_point: { tx_hash: `0x${'cd'.repeat(32)}`, index: 0 },
  capacity: 8_000e8,
  data_hex: `0x${'ab'.repeat(256)}`,
  data_bytes: 256,
  content_hash: `0x${'22'.repeat(32)}`,
  lock_shape_seed: [0x3141_5926, 0x5358_9793],
  type_shape_seed: [0x1234_5678, 0x9abc_def0],
  data_shape_seed: [0x2384_6264, 0x3383_2795],
  lock_kind: 'multisig',
  asset_kind: 'dao',
};

describe('canonical consensus braid mapping', () => {
  it('defines the six readable on-chain fields in scan order', () => {
    expect(CONSENSUS_BRAID_FIELDS).toEqual([
      'capacity',
      'asset',
      'lock',
      'data',
      'state',
      'born',
    ]);
  });

  it('makes Morphology V2 the single portrait and galaxy topology authority', () => {
    const shared = deriveConsensusBraidTopology(CELL);
    expect(shared).toEqual(deriveCellMorphologyTopology(CELL));
    expect(shared.agreements).toHaveLength(consensusBraidAgreementTarget(CELL));
    expect(shared.strands).toHaveLength(shared.genome.lock.strandCount);
    expect(shared.carrier.at(-1)).toEqual(shared.carrier[0]);
  });

  it('samples canonical closed paths deterministically without changing topology', () => {
    const topology = deriveConsensusBraidTopology(CELL);
    const path = topology.strands[0].points;
    expect(consensusBraidPathPoint(path, 0)).toEqual(path[0]);
    expect(consensusBraidPathPoint(path, 1)).toEqual(path[0]);
    expect(consensusBraidPathPoint(path, -0.25)).toEqual(
      consensusBraidPathPoint(path, 0.75),
    );
    expect(consensusBraidPathPoint(path, 0.123)).toEqual(
      consensusBraidPathPoint(path, 0.123),
    );
  });

  it('resolves canonical agreement knots sequentially from shared convergence', () => {
    expect(Array.from({ length: 4 }, (_, index) => (
      consensusBraidAgreementResolution(index, 4, 0)
    ))).toEqual([0, 0, 0, 0]);
    expect(consensusBraidAgreementResolution(0, 4, 0.25)).toBe(1);
    expect(consensusBraidAgreementResolution(1, 4, 0.25)).toBe(0);
    expect(Array.from({ length: 4 }, (_, index) => (
      consensusBraidAgreementResolution(index, 4, 1)
    ))).toEqual([1, 1, 1, 1]);
    expect(consensusBraidAgreementResolution(0, 0, 1)).toBe(0);
  });

  it('derives one stable full-density agreement order from lock crossings', () => {
    const dense: Cell = {
      ...CELL,
      lock_kind: 'omnilock',
      data_bytes: 0xffff_ffff,
      data_shape_seed: [0x93, 0x17],
    };
    const left = deriveConsensusBraidTopology(dense);
    const right = deriveConsensusBraidTopology(dense);

    expect(left).toEqual(right);
    expect(left.agreements).toHaveLength(12);
    expect(left.agreements).toHaveLength(consensusBraidAgreementTarget(dense));
    expect(left.agreements.map((agreement) => agreement.parameter)).toEqual(
      [...left.agreements]
        .sort((a, b) => a.parameter - b.parameter || a.pair - b.pair || a.ordinal - b.ordinal)
        .map((agreement) => agreement.parameter),
    );
    expect(left.birthPhase).toBe(consensusBraidBirthPhase(dense.birth_block));
  });

  it('maps capacity mass to one monotonic bounded presence scale', () => {
    const low = consensusBraidPresenceScale(0.84);
    const middle = consensusBraidPresenceScale(1);
    const high = consensusBraidPresenceScale(1.2);

    expect(low).toBeCloseTo(1.02);
    expect(low).toBeLessThan(middle);
    expect(middle).toBeLessThan(high);
    expect(consensusBraidPresenceScale(-10)).toBe(low);
    expect(consensusBraidPresenceScale(10)).toBe(high);
  });

  it('maps readable fields to distinct A layers', () => {
    // STATE is the balance itself — the whole structure, at full weight — so
    // it is the set every other field is a rebalancing OF, and the set the
    // resting portrait is a quiet copy of.
    const balanced = consensusBraidLayerOpacity('state', 3);
    const capacity = consensusBraidLayerOpacity('capacity', 3);
    const asset = consensusBraidLayerOpacity('asset', 3);
    const lock = consensusBraidLayerOpacity('lock', 3);
    const data = consensusBraidLayerOpacity('data', 3);
    const born = consensusBraidLayerOpacity('born', 3);

    expect(capacity.ribbon).toBeGreaterThan(capacity.streamCore);
    expect(balanced.streamFlow).toBeGreaterThanOrEqual(0.24);
    expect(asset.streamCore).toBeGreaterThan(asset.ribbon);
    expect(asset.streamFlow).toBeGreaterThan(balanced.streamFlow);
    expect(lock.streamCore).toBeGreaterThan(lock.agreementCore);
    expect(lock.streamFlow).toBeGreaterThan(data.streamFlow);
    expect(data.stitchCore).toBeGreaterThan(data.ribbon);
    expect(data.knotCore).toBeGreaterThan(data.streamCore);
    expect(born.packet).toBeGreaterThan(born.streamCore);
  });

  it('leads at open: nothing selected is the full balance, and a fact lifts its own layer', () => {
    // Ruling 2026-09-05: the CELL SCAN is the first visual focus of the cell
    // detail panel. The braid rests at its full balanced weight — no damping
    // constant, no quieter register — and a selected fact still lifts the
    // layer it owns ABOVE that balance, which is what makes the selection
    // legible as an act. Both halves are the design; this pins them so the
    // specimen is never dimmed at open again.
    const balanced = consensusBraidLayerOpacity('state', 3);
    const resting = consensusBraidLayerOpacity(null, 3);
    expect(resting).toEqual(balanced);
    expect(consensusBraidLayerOpacity('lock', 3).streamCore)
      .toBeGreaterThan(resting.streamCore);
    expect(consensusBraidLayerOpacity('data', 3).knotCore)
      .toBeGreaterThan(resting.knotCore);
    expect(consensusBraidLayerOpacity('capacity', 3).ribbon)
      .toBeGreaterThan(resting.ribbon);
    expect(consensusBraidLayerOpacity('asset', 3).streamCore)
      .toBeGreaterThan(resting.streamCore);
  });

  it('turns birth block into a stable wrapped packet phase', () => {
    expect(consensusBraidBirthPhase(0)).toBe(0);
    expect(consensusBraidBirthPhase(1024)).toBeCloseTo(Math.PI / 2);
    expect(consensusBraidBirthPhase(4096)).toBe(0);
    expect(consensusBraidBirthPhase(-1)).toBeGreaterThan(6);
  });

  it('keeps the production Cell braid in the warm biological family', () => {
    const tissue = consensusBraidContributorColor(0, 0.5);
    const synapse = consensusBraidContributorColor(1, 0.5);
    const memory = consensusBraidContributorColor(2, 0.5);

    expect(tissue[0]).toBeGreaterThan(tissue[2]);
    expect(synapse[0]).toBeGreaterThan(synapse[2]);
    expect(memory[0]).toBeGreaterThan(memory[1]);
  });
});
