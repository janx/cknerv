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

const round = (value: number): string => value.toFixed(6);
const pointList = (list: readonly (readonly number[])[]): string =>
  list.map((point) => point.map(round).join(',')).join(';');

/** Every geometric field the braid carried BEFORE class signatures existed,
 *  flattened. Deliberately excludes anything a signature commit adds — so one
 *  set of recorded literals stays valid across all three of them. */
function topologyDigestBody(
  topology: ReturnType<typeof deriveCellMorphologyTopology>,
): string {
  return [
    pointList(topology.carrier),
    topology.strands.map((s) => `${s.index}|${pointList(s.points)}`).join('/'),
    topology.crossings.map((c) => (
      `${round(c.parameter)}|${c.pair}|${c.ordinal}|${c.generator}`
      + `|${pointList([c.pointA, c.pointB, c.midpoint])}`
    )).join('/'),
    topology.dataMarks.map((m) => (
      `${m.slot}|${m.lane}|${m.pairLane}|${m.kind}|${round(m.magnitude)}`
      + `|${round(m.score)}|${round(m.parameter)}|${m.strand}|${m.pair}`
      + `|${pointList([m.point, m.peerPoint, m.midpoint])}`
    )).join('/'),
    topology.agreements.map((a) => (
      `${round(a.parameter)}|${a.pair}|${a.ordinal}|${a.crossingIndex}`
      + `|${a.dataSlot}|${a.kind}|${pointList([a.pointA, a.pointB, a.midpoint])}`
    )).join('/'),
    `${round(topology.presenceScale)}|${round(topology.birthPhase)}`
    + `|${topology.segmentCount}|${topology.nodeCount}`,
  ].join('\n');
}

function topologyDigest(
  topology: ReturnType<typeof deriveCellMorphologyTopology>,
): string {
  const body = topologyDigestBody(topology);
  let left = 0x811c_9dc5;
  let right = 0x1000_0193;
  for (let index = 0; index < body.length; index += 1) {
    const code = body.charCodeAt(index);
    left = Math.imul(left ^ code, 0x0100_0193) >>> 0;
    right = Math.imul(right + code + index, 0x9e37_79b1) >>> 0;
    right = ((right << 13) | (right >>> 19)) >>> 0;
  }
  return `${left.toString(16).padStart(8, '0')}${right.toString(16).padStart(8, '0')}`;
}

/** u128 little-endian, the way a udt cell writes its balance. */
function udtDataHex(amount: bigint, trailingBytes = 0): string {
  let remaining = amount;
  let body = '';
  for (let index = 0; index < 16; index += 1) {
    body += Number(remaining & 0xffn).toString(16).padStart(2, '0');
    remaining >>= 8n;
  }
  return `0x${body}${'5a'.repeat(trailingBytes)}`;
}

function tokenCell(amount: bigint, overrides: Partial<Cell> = {}): Cell {
  return cell({
    asset_kind: 'xudt',
    data_hex: udtDataHex(amount),
    data_bytes: 16,
    ...overrides,
  });
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

function turningAngles(points: readonly (readonly number[])[]): number[] {
  const unique = points.slice(0, -1);
  return unique.map((point, index) => {
    const previous = unique[(index - 1 + unique.length) % unique.length];
    const next = unique[(index + 1) % unique.length];
    const incoming = [
      point[0] - previous[0],
      point[1] - previous[1],
      point[2] - previous[2],
    ];
    const outgoing = [
      next[0] - point[0],
      next[1] - point[1],
      next[2] - point[2],
    ];
    const denominator = Math.hypot(...incoming) * Math.hypot(...outgoing);
    if (denominator <= 1e-9) return 0;
    const cosine = incoming.reduce(
      (sum, component, axis) => sum + component * outgoing[axis],
      0,
    ) / denominator;
    return Math.acos(Math.max(-1, Math.min(1, cosine)));
  });
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
    // Stated on a family that still reads its bytes generically. A SIGNED
    // class — a token counting out its balance — deliberately lets the asset
    // kind reshape the mark channel, which is the one coupling this matrix
    // does not hold and which the class-signature tests below pin instead.
    const generic = (overrides: Partial<Cell> = {}): Cell => cell({
      asset_kind: 'other',
      ...overrides,
    });
    const base = deriveCellMorphologyTopology(generic());
    const typeChanged = deriveCellMorphologyTopology(generic({
      asset_kind: 'spore',
      type_shape_seed: [0x7777_1111, 0x9999_3333],
    }));
    expect(typeChanged.genome.lock).toEqual(base.genome.lock);
    expect(typeChanged.genome.data).toEqual(base.genome.data);
    expect(typeChanged.carrier).not.toEqual(base.carrier);

    const lockChanged = deriveCellMorphologyTopology(generic({
      lock_kind: 'acp',
      lock_shape_seed: [0xaaaa_1111, 0xbbbb_2222],
    }));
    expect(lockChanged.genome.type).toEqual(base.genome.type);
    expect(lockChanged.genome.data).toEqual(base.genome.data);
    expect(lockChanged.carrier).toEqual(base.carrier);
    expect(lockChanged.genome.lock.braidWord).not.toEqual(base.genome.lock.braidWord);

    const dataChanged = deriveCellMorphologyTopology(generic({
      data_shape_seed: [0x0102_0304, 0x0506_0708],
    }));
    expect(dataChanged.genome.type).toEqual(base.genome.type);
    expect(dataChanged.genome.lock).toEqual(base.genome.lock);
    expect(dataChanged.carrier).toEqual(base.carrier);
    expect(dataChanged.genome.lock.braidWord).toEqual(base.genome.lock.braidWord);
    expect(dataChanged.genome.data.slotMask).not.toBe(base.genome.data.slotMask);

    const capacityChanged = deriveCellMorphologyTopology(generic({ capacity: 1_000_000e8 }));
    expect(capacityChanged.presenceScale).toBeGreaterThan(base.presenceScale);
    expect({ ...capacityChanged, genome: { ...capacityChanged.genome, presenceScale: 0 }, presenceScale: 0 })
      .toEqual({ ...base, genome: { ...base.genome, presenceScale: 0 }, presenceScale: 0 });
  });

  it('keeps all eight type families macro-distinct', () => {
    const families: AssetKind[] = [
      'native', 'sudt', 'xudt', 'dao', 'spore', 'other', 'object', 'identity',
    ];
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

  it('keeps lock crossings flowing without local tangent reversals', () => {
    const families: LockKind[] = ['sighash', 'multisig', 'acp', 'omnilock', 'other'];
    const angles = families.flatMap((family) => {
      const topology = deriveCellMorphologyTopology(cell({
        asset_kind: 'native',
        type_shape_seed: null,
        lock_kind: family,
      }));
      return topology.strands.flatMap((strand) => turningAngles(strand.points));
    }).sort((left, right) => left - right);
    const percentile95 = angles[Math.floor((angles.length - 1) * 0.95)];
    expect(percentile95).toBeLessThan(0.62);
    expect(angles.at(-1)).toBeLessThan(1.25);

    const closures = [
      [1, 2] as ShapeSeed,
      [3, 4] as ShapeSeed,
      [5, 6] as ShapeSeed,
    ].map((seed) => deriveCellMorphologyGenome(cell({
      lock_kind: 'omnilock',
      lock_shape_seed: seed,
    })).lock.closure);
    expect(new Set(closures).size).toBe(1);
  });

  it('separates curated same-length data and leaves empty data clean', () => {
    // The generic channel's job: same byte count, different fingerprint,
    // visibly different marks. A token cell answers to its amount instead, so
    // this claim is stated on a family that still reads its bytes generically.
    const left = deriveCellMorphologyGenome(cell({
      asset_kind: 'other',
      data_shape_seed: [0x1111_2222, 0x3333_4444],
    })).data;
    const right = deriveCellMorphologyGenome(cell({
      asset_kind: 'other',
      data_shape_seed: [0xaaaa_bbbb, 0xcccc_dddd],
    })).data;
    expect(left.bytes).toBe(right.bytes);
    expect(bitCount(left.slotMask ^ right.slotMask)).toBeGreaterThanOrEqual(4);

    // Still an xudt: an empty token cell has no 16-byte balance to read, so it
    // falls back to the generic channel and empties out cleanly.
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

/** Recorded from master@e894418 — the commit before any class signature — by
 *  hashing `topologyDigestBody` over the unmodified derive. A cell OUTSIDE a
 *  signature's gate must keep hashing to its recorded value; that is what
 *  makes "signed classes only" a checkable claim rather than an intention. */
const MASTER_TOPOLOGY_DIGESTS: readonly (readonly [string, Partial<Cell>, string])[] = [
  ['native/plain', { asset_kind: 'native', type_shape_seed: null }, '01952fa41105bf50'],
  ['dao/256b', { asset_kind: 'dao' }, '1d35fab6a9ab3dc2'],
  ['spore/256b', { asset_kind: 'spore' }, 'daa8e37b3d15d955'],
  ['other/256b', { asset_kind: 'other' }, 'c49907791b850018'],
  ['object/256b', { asset_kind: 'object' }, '662c4fade8c1422c'],
  ['xudt/short-8b', { asset_kind: 'xudt', data_bytes: 8, data_hex: `0x${'ff'.repeat(8)}` }, '7b8af9e5a1c32d14'],
  ['xudt/empty', { asset_kind: 'xudt', data_bytes: 0, data_hex: '0x' }, '283fe8277d898d36'],
  ['object/empty', { asset_kind: 'object', data_bytes: 0, data_hex: '0x' }, '36f6e9aec2f07d03'],
  ['native/multisig', { asset_kind: 'native', type_shape_seed: null, lock_kind: 'multisig' }, '4467e6f2d8391e3c'],
];

describe('Braid class signatures', () => {
  it('leaves every cell outside a gate byte-identical to master', () => {
    for (const [label, overrides, expected] of MASTER_TOPOLOGY_DIGESTS) {
      const digest = topologyDigest(deriveCellMorphologyTopology(cell(overrides)));
      expect(`${label}:${digest}`).toBe(`${label}:${expected}`);
    }
  });

  it('keeps every scheme inside the agreement-count invariant', () => {
    // `consensusBraidAgreementTarget` predicts the knot count as
    // min(slots.length, braidWord.length) — it omits deriveAgreements' own
    // MAX_NODES clamp, so it is only correct while no scheme can emit more
    // than MAX_NODES slots. The DOM evidence ledger indexes by that
    // prediction while the 3D knots come from agreements.length.
    const cases: Partial<Cell>[] = [
      { asset_kind: 'other', data_bytes: 0xffff_ffff },
      { asset_kind: 'xudt', data_hex: udtDataHex(2n ** 128n - 1n), data_bytes: 16 },
      { asset_kind: 'sudt', data_hex: udtDataHex(2n ** 128n - 1n), data_bytes: 0xffff_ffff },
    ];
    for (const overrides of cases) {
      const topology = deriveCellMorphologyTopology(cell(overrides));
      const { slots } = topology.genome.data;
      expect(slots.length).toBeLessThanOrEqual(CELL_MORPHOLOGY_MAX_NODES);
      expect(topology.agreements.length).toBe(
        Math.min(slots.length, topology.genome.lock.braidWord.length),
      );
      expect(topology.segmentCount).toBeLessThanOrEqual(CELL_MORPHOLOGY_MAX_SEGMENTS);
    }
  });
});

describe('Token quantity bead train', () => {
  it('counts beads up with the magnitude of the amount', () => {
    const magnitudes = [1n, 10n ** 3n, 10n ** 8n, 10n ** 12n, 2n ** 128n - 1n];
    const counts = magnitudes.map((amount) => (
      deriveCellMorphologyGenome(tokenCell(amount)).data.slots.length
    ));
    expect(counts).toEqual([1, 2, 3, 5, 12]);
    for (let index = 1; index < counts.length; index += 1) {
      expect(counts[index]).toBeGreaterThan(counts[index - 1]);
    }
    expect(counts.at(-1)).toBeLessThanOrEqual(CELL_MORPHOLOGY_MAX_NODES);
  });

  it('tells dust from a whale in the mark channel alone', () => {
    const dust = deriveCellMorphologyTopology(tokenCell(1n));
    const whale = deriveCellMorphologyTopology(tokenCell(10n ** 24n));
    expect(dust.genome.data.bytes).toBe(whale.genome.data.bytes);
    expect(dust.carrier).toEqual(whale.carrier);
    expect(dust.genome.lock).toEqual(whale.genome.lock);
    expect(dust.dataMarks.length).not.toBe(whale.dataMarks.length);
    expect(dust.genome.data.slotMask).not.toBe(whale.genome.data.slotMask);
  });

  it('spaces the train evenly on one strand at one size', () => {
    const topology = deriveCellMorphologyTopology(tokenCell(123_456_789n));
    const { slots, scheme, quantity } = topology.genome.data;
    expect(scheme).toBe('bead_train');
    expect(quantity).not.toBeNull();
    expect(slots.length).toBe(3);
    expect(new Set(slots.map((mark) => mark.kind)).size).toBe(1);
    expect(new Set(slots.map((mark) => mark.magnitude)).size).toBe(1);
    expect(new Set(topology.dataMarks.map((mark) => mark.strand)).size).toBe(1);
    const phases = topology.dataMarks.map((mark) => mark.parameter);
    const gaps = phases.slice(1).map((phase, index) => phase - phases[index]);
    for (const gap of gaps) expect(gap).toBeCloseTo(1 / slots.length, 12);
    expect(phases[0]).toBeCloseTo(0.5 / slots.length, 12);
  });

  it('scales the beads with the leading significand', () => {
    const low = deriveCellMorphologyGenome(tokenCell(10n ** 20n)).data;
    const high = deriveCellMorphologyGenome(tokenCell(99n * 10n ** 19n)).data;
    expect(low.slots.length).toBe(high.slots.length);
    expect(high.slots[0].magnitude).toBeGreaterThan(low.slots[0].magnitude);
    for (const genome of [low, high]) {
      expect(genome.quantity?.beadScale).toBeGreaterThanOrEqual(0.8);
      expect(genome.quantity?.beadScale).toBeLessThanOrEqual(1.2);
    }
  });

  it('gates on the token families and on a readable 16-byte prefix', () => {
    const readable = udtDataHex(4_200n);
    const signed = (['sudt', 'xudt'] as const).map((asset_kind) => (
      deriveCellMorphologyGenome(cell({ asset_kind, data_hex: readable, data_bytes: 16 })).data
    ));
    for (const data of signed) expect(data.scheme).toBe('bead_train');

    const unsigned: Partial<Cell>[] = [
      // Right bytes, wrong family: a spore that opens with 16 bytes is not
      // holding a balance.
      { asset_kind: 'spore', data_hex: readable, data_bytes: 16 },
      { asset_kind: 'object', data_hex: readable, data_bytes: 16 },
      { asset_kind: 'identity', data_hex: readable, data_bytes: 16 },
      { asset_kind: 'other', data_hex: readable, data_bytes: 16 },
      // Right family, unreadable prefix.
      { asset_kind: 'xudt', data_hex: '0x', data_bytes: 0 },
      { asset_kind: 'xudt', data_hex: `0x${'ab'.repeat(8)}`, data_bytes: 8 },
      { asset_kind: 'xudt', data_hex: `0x${'ab'.repeat(4)}~`, data_bytes: 4_096 },
      { asset_kind: 'xudt', data_hex: `0xzz${'ab'.repeat(15)}`, data_bytes: 64 },
      { asset_kind: 'xudt', data_hex: 'deadbeef'.repeat(8), data_bytes: 32 },
    ];
    for (const overrides of unsigned) {
      const data = deriveCellMorphologyGenome(cell(overrides)).data;
      expect(`${overrides.asset_kind}/${overrides.data_bytes}:${data.scheme}`)
        .toBe(`${overrides.asset_kind}/${overrides.data_bytes}:generic`);
      expect(data.quantity).toBeNull();
    }
  });

  it('still reads the balance out of a truncated data_hex', () => {
    const amount = 987_654_321n;
    const whole = deriveCellMorphologyGenome(
      cell({ asset_kind: 'xudt', data_hex: udtDataHex(amount, 32), data_bytes: 48 }),
    ).data;
    // The producer's cap eats the TAIL; the balance lives in the prefix.
    const capped = deriveCellMorphologyGenome(
      cell({ asset_kind: 'xudt', data_hex: `${udtDataHex(amount, 32)}~`, data_bytes: 4_096 }),
    ).data;
    expect(capped.scheme).toBe('bead_train');
    expect(capped.slots).toEqual(whole.slots);
  });

  it('reports the scheme in the relic signature without respelling the rest', () => {
    const token = morphologySignature(deriveCellMorphologyTopology(tokenCell(10n ** 9n)));
    const generic = morphologySignature(deriveCellMorphologyTopology(cell({
      asset_kind: 'other',
    })));
    expect(token.markScheme).toBe('bead_train');
    expect(generic.markScheme).toBe('generic');
    // The scheme is a NEW field, never spliced into the recorded strings.
    expect(generic.data).toMatch(/^256b\/\d+(\.\d+)*$/);
    expect(token.data).toMatch(/^16b\/\d+(\.\d+)*$/);
  });
});
