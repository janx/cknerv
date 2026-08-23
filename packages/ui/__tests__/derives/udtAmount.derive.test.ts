import { describe, expect, it } from 'vitest';
import type { Cell, ShapeSeed } from '@cknerv/types';
import {
  UDT_MAX_BEADS,
  cellUdtQuantitySignature,
  decodeUdtAmount,
  isUdtAssetKind,
  udtQuantitySignature,
} from '../../src/derives/udtAmount.derive';

const LOCK_SEED: ShapeSeed = [0x3141_5926, 0x5358_9793];
const TYPE_SEED: ShapeSeed = [0x1234_5678, 0x9abc_def0];
const DATA_SEED: ShapeSeed = [0x2384_6264, 0x3383_2795];

function cell(overrides: Partial<Cell> = {}): Cell {
  return {
    id: 7,
    born_at_ms: 1_000,
    death_at_ms: null,
    birth_block: 100,
    tag: null,
    pos_seed: [0, 0, 0],
    out_point: { tx_hash: `0x${'ab'.repeat(32)}`, index: 0 },
    capacity: 142_00000000,
    data_hex: '0x',
    data_bytes: 0,
    content_hash: `0x${'cd'.repeat(32)}`,
    lock_shape_seed: LOCK_SEED,
    type_shape_seed: TYPE_SEED,
    data_shape_seed: DATA_SEED,
    lock_kind: 'sighash',
    asset_kind: 'xudt',
    ...overrides,
  };
}

/** u128 little-endian: least significant byte first. */
function leHex(amount: bigint, trailing = ''): string {
  let remaining = amount;
  let body = '';
  for (let index = 0; index < 16; index += 1) {
    body += Number(remaining & 0xffn).toString(16).padStart(2, '0');
    remaining >>= 8n;
  }
  return `0x${body}${trailing}`;
}

function tokenCell(amount: bigint, overrides: Partial<Cell> = {}): Cell {
  return cell({ data_hex: leHex(amount), data_bytes: 16, ...overrides });
}

describe('udt amount decode', () => {
  it('reads the u128 balance little-endian', () => {
    expect(decodeUdtAmount(tokenCell(0n))).toBe(0n);
    expect(decodeUdtAmount(tokenCell(1n))).toBe(1n);
    expect(decodeUdtAmount(tokenCell(2n ** 128n - 1n))).toBe(2n ** 128n - 1n);
    expect(decodeUdtAmount(tokenCell(123_456_789_012_345n))).toBe(123_456_789_012_345n);

    // Byte order is load-bearing: 1 is 01 followed by fifteen 00 bytes, and
    // reading it big-endian would land on 2^120.
    expect(leHex(1n)).toBe(`0x01${'00'.repeat(15)}`);
  });

  it('is unmoved by the tail the producer capped away', () => {
    const amount = 42_000_000n;
    const capped = cell({
      data_hex: `${leHex(amount, 'ff'.repeat(500))}~`,
      data_bytes: 100_000,
    });
    expect(decodeUdtAmount(capped)).toBe(amount);
  });

  it('refuses everything it cannot honestly read', () => {
    expect(isUdtAssetKind('sudt')).toBe(true);
    expect(isUdtAssetKind('xudt')).toBe(true);
    for (const kind of ['native', 'dao', 'spore', 'other', 'object', 'identity'] as const) {
      expect(isUdtAssetKind(kind)).toBe(false);
      expect(decodeUdtAmount(tokenCell(9n, { asset_kind: kind }))).toBeNull();
    }
    expect(isUdtAssetKind(undefined)).toBe(false);
    expect(decodeUdtAmount(tokenCell(9n, { asset_kind: undefined }))).toBeNull();

    // Claims fewer than 16 bytes.
    expect(decodeUdtAmount(cell({ data_hex: leHex(9n), data_bytes: 15 }))).toBeNull();
    expect(decodeUdtAmount(cell({ data_hex: '0x', data_bytes: 0 }))).toBeNull();
    // Claims 16 but did not ship them.
    expect(decodeUdtAmount(cell({ data_hex: `0x${'ab'.repeat(15)}`, data_bytes: 16 }))).toBeNull();
    // Not hex, and not 0x-prefixed.
    expect(decodeUdtAmount(cell({ data_hex: `0x${'zz'.repeat(16)}`, data_bytes: 16 }))).toBeNull();
    expect(decodeUdtAmount(cell({ data_hex: 'ab'.repeat(16), data_bytes: 16 }))).toBeNull();
    expect(decodeUdtAmount(cell({ data_bytes: Number.NaN, data_hex: leHex(9n) }))).toBeNull();
  });
});

describe('udt quantity signature', () => {
  it('spends one bead per thousands-group of the written amount', () => {
    const groups = (amount: bigint): number => udtQuantitySignature(amount).beadCount;
    expect(groups(0n)).toBe(1);
    expect(groups(1n)).toBe(1);
    expect(groups(999n)).toBe(1);
    expect(groups(1_000n)).toBe(2);
    expect(groups(999_999n)).toBe(2);
    expect(groups(1_000_000n)).toBe(3);
    expect(groups(10n ** 12n)).toBe(5);
    expect(groups(2n ** 128n - 1n)).toBe(UDT_MAX_BEADS);
  });

  it('never decreases as the amount grows', () => {
    let previous = 0;
    for (let exponent = 0n; exponent <= 39n; exponent += 1n) {
      const count = udtQuantitySignature(10n ** exponent).beadCount;
      expect(count).toBeGreaterThanOrEqual(previous);
      expect(count).toBeGreaterThanOrEqual(1);
      expect(count).toBeLessThanOrEqual(UDT_MAX_BEADS);
      previous = count;
    }
  });

  it('keeps the significand scale inside its band', () => {
    expect(udtQuantitySignature(0n).beadScale).toBeCloseTo(0.8, 12);
    expect(udtQuantitySignature(1n).beadScale).toBeCloseTo(0.8, 12);
    expect(udtQuantitySignature(1_000n).beadScale).toBeCloseTo(0.8, 12);
    expect(udtQuantitySignature(999n).beadScale).toBeGreaterThan(1.19);
    for (const amount of [0n, 1n, 7n, 4_242n, 10n ** 18n, 2n ** 128n - 1n]) {
      const { beadScale } = udtQuantitySignature(amount);
      expect(beadScale).toBeGreaterThanOrEqual(0.8);
      expect(beadScale).toBeLessThanOrEqual(1.2);
    }
    // Same magnitude, different leading digits: the train tightens.
    expect(udtQuantitySignature(9_900_000n).beadScale)
      .toBeGreaterThan(udtQuantitySignature(1_000_000n).beadScale);
  });

  it('reports digits so the magnitude stays inspectable', () => {
    expect(udtQuantitySignature(0n).digits).toBe(1);
    expect(udtQuantitySignature(10n ** 12n).digits).toBe(13);
    expect(udtQuantitySignature(2n ** 128n - 1n).digits).toBe(39);
  });

  it('answers null for a cell that has no quantity', () => {
    expect(cellUdtQuantitySignature(cell({ asset_kind: 'spore' }))).toBeNull();
    expect(cellUdtQuantitySignature(tokenCell(5n))).toEqual(udtQuantitySignature(5n));
  });
});
