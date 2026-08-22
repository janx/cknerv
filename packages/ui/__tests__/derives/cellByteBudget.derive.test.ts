import { describe, expect, it } from 'vitest';
import type { CommonKnowledgeBreakdown } from '@cknerv/types';
import { deriveCellByteBudget } from '../../src/derives/cellByteBudget.derive';

const CKB = 100_000_000;

function knowledge(
  overrides: Partial<CommonKnowledgeBreakdown> = {},
): CommonKnowledgeBreakdown {
  return {
    total_bytes: 102,
    capacity_field_bytes: 8,
    lock_script_bytes: 54,
    type_script_bytes: 33,
    data_bytes: 7,
    ...overrides,
  };
}

describe('deriveCellByteBudget — the occupied/free/capacity triple', () => {
  it('prices the itemized bytes itself when the source stated no exact figure', () => {
    const model = deriveCellByteBudget(knowledge(), 123 * CKB)!;
    expect(model.occupiedExact).toBe(false);
    expect(model.occupiedShannons).toBe(102n * 100_000_000n);
    expect(model.freeShannons).toBe(21n * 100_000_000n);
    expect(model.residualBytes).toBe(0);
    expect(model.utilization).toBeCloseTo(102 / 123, 12);
    expect(model.capacityShannons).toBe(12_300_000_000n);
  });

  it('takes the source figure over the byte sum and keeps the difference as evidence', () => {
    // The exact figure counts script args the breakdown never itemizes, so it
    // outruns the bytes it is shipped beside — 20 bytes' worth here.
    const model = deriveCellByteBudget(
      knowledge({ occupied_shannons: '12200000000' }),
      123 * CKB,
    )!;
    expect(model.occupiedExact).toBe(true);
    expect(model.occupiedShannons).toBe(12_200_000_000n);
    expect(model.residualBytes).toBe(20);
    expect(model.freeShannons).toBe(100_000_000n);
    // The percentage follows the truth, not the sum we could itemize.
    expect(model.utilization).toBeCloseTo(122 / 123, 12);
    // The composition still itemizes only the bytes it can name.
    expect(model.totalBytes).toBe(102);
    expect(model.segments.reduce((sum, s) => sum + s.bytes, 0)).toBe(102);
  });

  it('reports no residual when the exact figure equals the byte sum', () => {
    const model = deriveCellByteBudget(
      knowledge({ occupied_shannons: '10200000000' }),
      123 * CKB,
    )!;
    expect(model.occupiedExact).toBe(true);
    expect(model.residualBytes).toBe(0);
    expect(model.freeShannons).toBe(21n * 100_000_000n);
  });

  it('still trusts the exact figure when it falls BELOW the byte sum, with no residual', () => {
    const model = deriveCellByteBudget(
      knowledge({ occupied_shannons: '10000000000' }),
      123 * CKB,
    )!;
    expect(model.occupiedShannons).toBe(10_000_000_000n);
    expect(model.residualBytes).toBe(0);
    expect(model.utilization).toBeCloseTo(100 / 123, 12);
  });

  it('drops back to the bytes for anything that is not a decimal shannon count', () => {
    const malformed = [
      'abc', '', '   ', '12.5', '-100', '0x64', '1e10', 'NaN', 'Infinity',
      '12,200,000,000', '1 200',
    ];
    for (const occupied_shannons of malformed) {
      const model = deriveCellByteBudget(
        knowledge({ occupied_shannons }),
        123 * CKB,
      )!;
      expect(model.occupiedExact, occupied_shannons).toBe(false);
      expect(model.occupiedShannons, occupied_shannons).toBe(102n * 100_000_000n);
      expect(model.residualBytes, occupied_shannons).toBe(0);
      expect(Number.isFinite(model.utilization), occupied_shannons).toBe(true);
    }
  });

  it('parses a shannon figure far past a double’s safe integers', () => {
    // 2^128 shannons: no Number can hold it, and nothing here may become NaN.
    const model = deriveCellByteBudget(
      knowledge({ occupied_shannons: '340282366920938463463374607431768211456' }),
      123 * CKB,
    )!;
    expect(model.occupiedExact).toBe(true);
    expect(model.occupiedShannons).toBe(340282366920938463463374607431768211456n);
    expect(model.utilization).toBe(1);
    expect(Number.isNaN(model.residualBytes)).toBe(false);
    expect(model.freeShannons < 0n).toBe(true);
  });

  it('accepts capacity as a bigint or a number and reads them the same', () => {
    const asNumber = deriveCellByteBudget(knowledge(), 123 * CKB)!;
    const asBigint = deriveCellByteBudget(knowledge(), 12_300_000_000n)!;
    expect(asBigint.capacityShannons).toBe(asNumber.capacityShannons);
    expect(asBigint.freeShannons).toBe(asNumber.freeShannons);
    expect(asBigint.utilization).toBe(asNumber.utilization);
  });

  it('says nothing at all without a breakdown to say it with', () => {
    expect(deriveCellByteBudget(null, 123 * CKB)).toBeNull();
    expect(deriveCellByteBudget(undefined, 123 * CKB)).toBeNull();
    expect(deriveCellByteBudget(knowledge({ total_bytes: 0 }), 123 * CKB)).toBeNull();
  });

  it('leaves a capacity-less reading at zero instead of dividing by it', () => {
    const model = deriveCellByteBudget(knowledge(), 0)!;
    expect(model.utilization).toBe(0);
    expect(model.freeShannons).toBe(-(102n * 100_000_000n));
  });
});
