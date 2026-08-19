import { describe, expect, it } from 'vitest';
import {
  FABRIC_LIFE_APERTURE_END_OFFSET,
  FABRIC_LIFE_APERTURE_START_OFFSET,
  FABRIC_LIFE_COLOR_STRIDE,
  FABRIC_LIFE_CURVE_STRIDE,
  FABRIC_LIFE_SCALAR_STRIDE,
  fabricLifecycleEndSec,
  makeFabricLifecycleArrays,
  packFabricLifecycleFlags,
  writeFabricLifecycleSlot,
  type FabricLifecycleRecord,
} from '../../src/nerve/fabricLifecycleSlots';
import { FABRIC_LIFECYCLE_ALIVE_SENTINEL } from '../../src/nerve/fabricLifecycleShader';
import { FABRIC_SAMPLES_PER_EDGE } from '../../src/nerve/fabricCapacity';
import { FABRIC_TRUNK_NO_ARBOR } from '../../src/nerve/fabricTrunkClass';
import {
  fabricEdgeRenderState,
  type EdgeLifecycle,
} from '../../src/nerve/fabricEdgeRender';

function record(overrides: Partial<FabricLifecycleRecord> = {}): FabricLifecycleRecord {
  return {
    fromX: 1, fromY: 2, fromZ: 3,
    ctrlX: 4, ctrlY: 5, ctrlZ: 6,
    toX: 7, toY: 8, toZ: 9,
    fromR: 0.1, fromG: 0.2, fromB: 0.3,
    toR: 0.4, toG: 0.5, toB: 0.6,
    bornAt: 10,
    dyingAt: null,
    deathKind: null,
    deadEnd: null,
    growDir: 1,
    brightnessMul: 0.8,
    trunkness: FABRIC_TRUNK_NO_ARBOR,
    ...overrides,
  };
}

describe('fabric lifecycle slots', () => {
  it('writes one duplicated static record across the slot, spans excepted', () => {
    const arrays = makeFabricLifecycleArrays(FABRIC_SAMPLES_PER_EDGE * 3);
    const slotBase = FABRIC_SAMPLES_PER_EDGE; // second slot
    writeFabricLifecycleSlot(arrays, slotBase, record());

    for (let segment = 0; segment < FABRIC_SAMPLES_PER_EDGE; segment += 1) {
      const instance = slotBase + segment;
      const curve = arrays.curve.subarray(
        instance * FABRIC_LIFE_CURVE_STRIDE,
        instance * FABRIC_LIFE_CURVE_STRIDE + FABRIC_LIFE_CURVE_STRIDE,
      );
      // xyz + spanStart | xyz + spanEnd | xyz + reserved
      expect([...curve.subarray(0, 3)]).toEqual([1, 2, 3]);
      expect(curve[3]).toBeCloseTo(segment / FABRIC_SAMPLES_PER_EDGE, 6);
      expect([...curve.subarray(4, 7)]).toEqual([4, 5, 6]);
      expect(curve[7]).toBeCloseTo((segment + 1) / FABRIC_SAMPLES_PER_EDGE, 6);
      expect([...curve.subarray(8, 11)]).toEqual([7, 8, 9]);
      const color = arrays.color.subarray(
        instance * FABRIC_LIFE_COLOR_STRIDE,
        instance * FABRIC_LIFE_COLOR_STRIDE + FABRIC_LIFE_COLOR_STRIDE,
      );
      // rgb + apertureStart | rgb + apertureEnd — aperture rests at 1.
      expect([...color].map((v) => +v.toFixed(6)))
        .toEqual([0.1, 0.2, 0.3, 1, 0.4, 0.5, 0.6, 1]);
      const scalar = arrays.scalar.subarray(
        instance * FABRIC_LIFE_SCALAR_STRIDE,
        instance * FABRIC_LIFE_SCALAR_STRIDE + FABRIC_LIFE_SCALAR_STRIDE,
      );
      expect(scalar[0]).toBe(10);
      expect(scalar[1]).toBe(Math.fround(FABRIC_LIFECYCLE_ALIVE_SENTINEL));
      expect(scalar[2]).toBeCloseTo(0.8, 6);
      expect(scalar[3]).toBe(0);
    }
    // Neighbouring slots stay untouched (aperture lanes still at baseline 1).
    expect(arrays.scalar[0]).toBe(0);
    expect(arrays.color[FABRIC_LIFE_APERTURE_START_OFFSET]).toBe(1);
    expect(arrays.color[FABRIC_LIFE_APERTURE_END_OFFSET]).toBe(1);
  });

  it('rewriting a recycled slot resets its aperture lanes to baseline', () => {
    const arrays = makeFabricLifecycleArrays(FABRIC_SAMPLES_PER_EDGE);
    writeFabricLifecycleSlot(arrays, 0, record());
    // Simulate a recall window dimming the slot…
    arrays.color[FABRIC_LIFE_APERTURE_START_OFFSET] = 0.25;
    arrays.color[FABRIC_LIFE_APERTURE_END_OFFSET] = 0.4;
    // …then the slot is recycled for a different edge.
    writeFabricLifecycleSlot(arrays, 0, record({ fromR: 0.9 }));
    expect(arrays.color[FABRIC_LIFE_APERTURE_START_OFFSET]).toBe(1);
    expect(arrays.color[FABRIC_LIFE_APERTURE_END_OFFSET]).toBe(1);
    expect(arrays.color[0]).toBeCloseTo(0.9, 6);
  });

  it('packs lifecycle flags as exact small float integers', () => {
    expect(packFabricLifecycleFlags(null, null, 1)).toBe(0);
    expect(packFabricLifecycleFlags(null, null, -1)).toBe(1);
    expect(packFabricLifecycleFlags('death', 'from', 1)).toBe(4);
    expect(packFabricLifecycleFlags('death', 'to', 1)).toBe(6);
    expect(packFabricLifecycleFlags('gc', null, 1)).toBe(8);
    expect(packFabricLifecycleFlags('gc', null, -1)).toBe(9);
  });

  it('dying records store their real timestamp', () => {
    const arrays = makeFabricLifecycleArrays(FABRIC_SAMPLES_PER_EDGE);
    writeFabricLifecycleSlot(arrays, 0, record({
      dyingAt: 42.5,
      deathKind: 'death',
      deadEnd: 'to',
    }));
    expect(arrays.scalar[1]).toBe(42.5);
    expect(arrays.scalar[3]).toBe(6);
  });

  it('lazy-reap horizon matches fabricEdgeRenderState.reap exactly', () => {
    const lifecycles: EdgeLifecycle[] = [
      { bornAt: 0, dyingAt: null, deathKind: null, deadEnd: null, growDir: 1 },
      { bornAt: 0, dyingAt: 10, deathKind: 'death', deadEnd: 'from', growDir: 1 },
      { bornAt: 0, dyingAt: 10, deathKind: 'gc', deadEnd: null, growDir: -1 },
    ];
    for (const lifecycle of lifecycles) {
      const end = fabricLifecycleEndSec(lifecycle.dyingAt, lifecycle.deathKind);
      if (lifecycle.dyingAt === null) {
        expect(end).toBe(Number.POSITIVE_INFINITY);
        continue;
      }
      // Sweep across the window boundary at millisecond resolution: the CPU
      // reference reaps exactly when nowSec crosses the analytic horizon.
      for (const nowSec of [
        lifecycle.dyingAt,
        end - 0.002,
        end - 1e-6,
        end,
        end + 0.002,
        end + 5,
      ]) {
        const reference = fabricEdgeRenderState(lifecycle, nowSec).reap;
        expect(reference).toBe(nowSec >= end);
      }
    }
  });
});
