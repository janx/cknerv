import { describe, expect, it } from 'vitest';
import type { AssetKind, Cell, LockKind, ShapeSeed } from '@cknerv/types';
import {
  CELL_MORPHOLOGY_DATA_SLOTS,
  CELL_MORPHOLOGY_MAX_NODES,
  CELL_MORPHOLOGY_MAX_SEGMENTS,
  deriveCellMorphologyGenome,
  deriveCellMorphologyTopology,
  morphologyFallbackSeed,
  morphologySignature,
} from '../../src/derives/cellMorphology.derive';

const TYPE_SEED: ShapeSeed = [0x1234_5678, 0x9abc_def0];
const LOCK_SEED: ShapeSeed = [0x3141_5926, 0x5358_9793];
const DATA_SEED: ShapeSeed = [0x2384_6264, 0x3383_2795];

function cell(overrides: Partial<Cell> = {}): Cell {
  return {
    id: 42,
    born_at_ms: 1_000,
    death_at_ms: null,
    birth_block: 12_345,
    tag: null,
    pos_seed: [0, 0, 0],
    out_point: { tx_hash: `0x${'ab'.repeat(32)}`, index: 1 },
    capacity: 61_00000000,
    data_hex: '0x' + '11'.repeat(256),
    data_bytes: 256,
    content_hash: `0x${'cd'.repeat(32)}`,
    lock_shape_seed: LOCK_SEED,
    type_shape_seed: TYPE_SEED,
    data_shape_seed: DATA_SEED,
    lock_kind: 'sighash',
    asset_kind: 'xudt',
    ...overrides,
  };
}

function allPoints(topology: ReturnType<typeof deriveCellMorphologyTopology>) {
  return [
    ...topology.carrier,
    ...topology.strands.flatMap((strand) => strand.points),
    ...topology.crossings.flatMap((crossing) => [
      crossing.pointA,
      crossing.pointB,
      crossing.midpoint,
    ]),
    ...topology.dataMarks.flatMap((mark) => [mark.point, mark.peerPoint, mark.midpoint]),
    ...topology.agreements.map((agreement) => agreement.midpoint),
  ];
}

function bitCount(value: number): number {
  let count = 0;
  let remaining = value >>> 0;
  while (remaining !== 0) {
    remaining &= remaining - 1;
    count += 1;
  }
  return count;
}

describe('Cell Morphology V2 grammar', () => {
  it('is deterministic, finite, closed, and inside production caps', () => {
    const left = deriveCellMorphologyTopology(cell());
    const right = deriveCellMorphologyTopology(cell());
    expect(left).toEqual(right);
    expect(allPoints(left).every((point) => point.every(Number.isFinite))).toBe(true);
    expect(left.carrier.at(-1)).toEqual(left.carrier[0]);
    for (const strand of left.strands) expect(strand.points.at(-1)).toEqual(strand.points[0]);
    expect(left.segmentCount).toBeLessThanOrEqual(CELL_MORPHOLOGY_MAX_SEGMENTS);
    expect(left.nodeCount).toBeLessThanOrEqual(CELL_MORPHOLOGY_MAX_NODES);
    expect(left.genome.data.slots.every((mark) => (
      mark.slot >= 0 && mark.slot < CELL_MORPHOLOGY_DATA_SLOTS
    ))).toBe(true);
  });

  it('isolates type, lock, data, and capacity responsibilities', () => {
    const base = deriveCellMorphologyTopology(cell());
    const typeChanged = deriveCellMorphologyTopology(cell({
      asset_kind: 'spore',
      type_shape_seed: [0x7777_1111, 0x9999_3333],
    }));
    expect(typeChanged.genome.lock).toEqual(base.genome.lock);
    expect(typeChanged.genome.data).toEqual(base.genome.data);
    expect(typeChanged.carrier).not.toEqual(base.carrier);

    const lockChanged = deriveCellMorphologyTopology(cell({
      lock_kind: 'acp',
      lock_shape_seed: [0xaaaa_1111, 0xbbbb_2222],
    }));
    expect(lockChanged.genome.type).toEqual(base.genome.type);
    expect(lockChanged.genome.data).toEqual(base.genome.data);
    expect(lockChanged.carrier).toEqual(base.carrier);
    expect(lockChanged.genome.lock.braidWord).not.toEqual(base.genome.lock.braidWord);

    const dataChanged = deriveCellMorphologyTopology(cell({
      data_shape_seed: [0x0102_0304, 0x0506_0708],
    }));
    expect(dataChanged.genome.type).toEqual(base.genome.type);
    expect(dataChanged.genome.lock).toEqual(base.genome.lock);
    expect(dataChanged.carrier).toEqual(base.carrier);
    expect(dataChanged.genome.lock.braidWord).toEqual(base.genome.lock.braidWord);
    expect(dataChanged.genome.data.slotMask).not.toBe(base.genome.data.slotMask);

    const capacityChanged = deriveCellMorphologyTopology(cell({ capacity: 1_000_000e8 }));
    expect(capacityChanged.presenceScale).toBeGreaterThan(base.presenceScale);
    expect({ ...capacityChanged, genome: { ...capacityChanged.genome, presenceScale: 0 }, presenceScale: 0 })
      .toEqual({ ...base, genome: { ...base.genome, presenceScale: 0 }, presenceScale: 0 });
  });

  it('keeps all six type families macro-distinct', () => {
    const families: AssetKind[] = ['native', 'sudt', 'xudt', 'dao', 'spore', 'other'];
    const signatures = families.map((family) => {
      const topology = deriveCellMorphologyTopology(cell({
        asset_kind: family,
        type_shape_seed: family === 'native' ? null : TYPE_SEED,
      }));
      return morphologySignature(topology).type;
    });
    expect(new Set(signatures).size).toBe(families.length);

    const exactA = deriveCellMorphologyTopology(cell({ type_shape_seed: [1, 2] }));
    const exactB = deriveCellMorphologyTopology(cell({ type_shape_seed: [3, 4] }));
    expect(exactA.genome.type.family).toBe(exactB.genome.type.family);
    expect(exactA.carrier).not.toEqual(exactB.carrier);
  });

  it('gives all five lock families distinct pure crossing signatures', () => {
    const families: LockKind[] = ['sighash', 'multisig', 'acp', 'omnilock', 'other'];
    const topologies = families.map((family) => deriveCellMorphologyTopology(cell({
      lock_kind: family,
      lock_shape_seed: LOCK_SEED,
    })));
    const signatures = topologies.map((topology) => morphologySignature(topology).lock);
    expect(new Set(signatures).size).toBe(families.length);
    expect(topologies[1].genome.lock.strandCount).toBe(topologies[2].genome.lock.strandCount);
    expect(topologies[1].genome.lock.braidWord).not.toEqual(topologies[2].genome.lock.braidWord);
    expect(topologies[3].genome.lock.strandCount).toBe(topologies[4].genome.lock.strandCount);
    expect(topologies[3].genome.lock.braidWord).not.toEqual(topologies[4].genome.lock.braidWord);
    for (const topology of topologies) {
      const word = topology.genome.lock.braidWord;
      expect(word.length % 2).toBe(0);
      for (let index = 0; index < word.length; index += 2) {
        expect(word[index + 1]).toBe(word[index]);
      }
    }
  });

  it('separates curated same-length data and leaves empty data clean', () => {
    const left = deriveCellMorphologyGenome(cell({
      data_shape_seed: [0x1111_2222, 0x3333_4444],
    })).data;
    const right = deriveCellMorphologyGenome(cell({
      data_shape_seed: [0xaaaa_bbbb, 0xcccc_dddd],
    })).data;
    expect(left.bytes).toBe(right.bytes);
    expect(bitCount(left.slotMask ^ right.slotMask)).toBeGreaterThanOrEqual(4);

    const empty = deriveCellMorphologyTopology(cell({
      data_hex: '0x',
      data_bytes: 0,
    }));
    expect(empty.genome.data.slots).toEqual([]);
    expect(empty.dataMarks).toEqual([]);
    expect(empty.agreements).toEqual([]);
    expect(empty.nodeCount).toBe(0);
  });

  it('binds agreement order and positions to selected lock crossings', () => {
    const topology = deriveCellMorphologyTopology(cell());
    expect(topology.agreements.length).toBeGreaterThan(0);
    expect(topology.agreements.map((agreement) => agreement.parameter)).toEqual(
      [...topology.agreements]
        .sort((left, right) => (
          left.parameter - right.parameter
          || left.pair - right.pair
          || left.ordinal - right.ordinal
        ))
        .map((agreement) => agreement.parameter),
    );
    for (const agreement of topology.agreements) {
      const crossing = topology.crossings[agreement.crossingIndex];
      expect(agreement.midpoint).toEqual(crossing.midpoint);
      expect(agreement.pointA).toEqual(crossing.pointA);
      expect(agreement.pointB).toEqual(crossing.pointB);
    }
  });

  it('uses deterministic namespaced fallback seeds without mislabeling plain native type', () => {
    const hash = `0x${'12'.repeat(32)}`;
    expect(morphologyFallbackSeed(hash, 'lock')).toEqual(morphologyFallbackSeed(hash, 'lock'));
    expect(morphologyFallbackSeed(hash, 'lock')).not.toEqual(morphologyFallbackSeed(hash, 'data'));

    const fallback = deriveCellMorphologyGenome(cell({
      content_hash: hash,
      lock_shape_seed: [0, 0],
      type_shape_seed: [0, 0],
      data_shape_seed: [0, 0],
    }));
    expect(fallback.fallback).toBe(true);
    expect(fallback.lock.seed).not.toEqual([0, 0]);
    expect(fallback.type.seed).not.toEqual([0, 0]);
    expect(fallback.data.seed).not.toEqual([0, 0]);

    const plain = deriveCellMorphologyGenome(cell({
      asset_kind: 'native',
      type_shape_seed: null,
    }));
    expect(plain.type.seed).toEqual([0, 0]);
    expect(plain.fallback).toBe(false);
  });
});
