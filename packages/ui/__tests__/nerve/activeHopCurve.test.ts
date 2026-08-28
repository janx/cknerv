import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Cell } from '@cknerv/types';
import { describe, expect, it } from 'vitest';
import { bezierAtInto } from '../../src/geometry/edgeBezier';
import {
  resolveActiveHopCurveInto,
  type ActiveHopCurveRequest,
  type PassiveHopCurveState,
  type ResolvedActiveHopCurve,
} from '../../src/nerve/activeHopCurve';
import {
  fabricEdgeIndexDelete,
  fabricEdgeIndexGet,
  fabricEdgeIndexSet,
  fabricEdgeIndexSize,
  type FabricEdgeIndex,
} from '../../src/nerve/fabricOrder';
import type { CellById, Vec3 } from '../../src/types';

const HOP_CURVE_SOURCE = readFileSync(
  resolve(process.cwd(), 'src/nerve/activeHopCurve.ts'),
  'utf8',
);

/** The passive index the fabric maintains, from (a, b, state) triples. */
function indexOf(
  entries: ReadonlyArray<readonly [number, number, PassiveHopCurveState]>,
): FabricEdgeIndex<PassiveHopCurveState> {
  const index: FabricEdgeIndex<PassiveHopCurveState> = new Map();
  for (const [a, b, state] of entries) fabricEdgeIndexSet(index, a, b, state);
  return index;
}

function cellLookup(entries: ReadonlyArray<readonly [number, Vec3]>): CellById {
  const positions = new Map(entries);
  return {
    get(id) {
      const pos = positions.get(id);
      return pos ? ({ pos_seed: pos } as Cell) : undefined;
    },
  };
}

function curveScratch(): ResolvedActiveHopCurve {
  return {
    fromX: 0, fromY: 0, fromZ: 0,
    ctrlX: 0, ctrlY: 0, ctrlZ: 0,
    toX: 0, toY: 0, toZ: 0,
  };
}

function resolveHop(
  hop: ActiveHopCurveRequest,
  cells: CellById,
  states: FabricEdgeIndex<PassiveHopCurveState>,
): { source: ReturnType<typeof resolveActiveHopCurveInto>; curve: ResolvedActiveHopCurve } {
  const curve = curveScratch();
  const source = resolveActiveHopCurveInto(
    curve,
    new Float32Array(3),
    hop,
    cells,
    states,
  );
  return { source, curve };
}

/** Points pushActiveHop would feed into its segment writer, including the
 * direction transform but excluding brightness (which this optimization does
 * not touch). */
function samples(
  curve: ResolvedActiveHopCurve,
  direction: 1 | -1,
  count = 12,
): number[] {
  const point = new Float32Array(3);
  const values = direction === 1
    ? [curve.fromX, curve.fromY, curve.fromZ]
    : [curve.toX, curve.toY, curve.toZ];
  for (let index = 1; index <= count; index += 1) {
    const travelT = index / count;
    const curveT = direction === 1 ? travelT : 1 - travelT;
    bezierAtInto(
      point,
      curve.fromX, curve.fromY, curve.fromZ,
      curve.ctrlX, curve.ctrlY, curve.ctrlZ,
      curve.toX, curve.toY, curve.toZ,
      curveT,
    );
    values.push(point[0], point[1], point[2]);
  }
  return values;
}

const FROM_ID = 10;
const TO_ID = 20;
const FROM: Vec3 = [3.25, 4.5, -7.75];
const TO: Vec3 = [28.125, -2.25, 11.625];
const CELLS = cellLookup([[FROM_ID, FROM], [TO_ID, TO]]);
const HOP: ActiveHopCurveRequest = {
  fromCellId: FROM_ID,
  toCellId: TO_ID,
};

function passiveStateFrom(
  curve: ResolvedActiveHopCurve,
  reversed: boolean,
): PassiveHopCurveState {
  return {
    fromCellId: reversed ? TO_ID : FROM_ID,
    toCellId: reversed ? FROM_ID : TO_ID,
    fromX: reversed ? curve.toX : curve.fromX,
    fromY: reversed ? curve.toY : curve.fromY,
    fromZ: reversed ? curve.toZ : curve.fromZ,
    ctrlX: curve.ctrlX,
    ctrlY: curve.ctrlY,
    ctrlZ: curve.ctrlZ,
    toX: reversed ? curve.fromX : curve.toX,
    toY: reversed ? curve.fromY : curve.toY,
    toZ: reversed ? curve.fromZ : curve.toZ,
  };
}

describe('resolveActiveHopCurveInto', () => {
  it('reuses passive geometry with exact forward and reverse travel parity', () => {
    const fallback = resolveHop(HOP, CELLS, new Map());
    expect(fallback.source).toBe('fallback');

    for (const stateReversed of [false, true]) {
      const state = passiveStateFrom(fallback.curve, stateReversed);
      const reused = resolveHop(
        HOP,
        CELLS,
        indexOf([[FROM_ID, TO_ID, state]]),
      );
      expect(reused.source).toBe('passive');
      expect(reused.curve).toEqual(fallback.curve);
      expect(samples(reused.curve, 1)).toEqual(samples(fallback.curve, 1));
      expect(samples(reused.curve, -1)).toEqual(samples(fallback.curve, -1));
    }
  });

  it('keeps an explicit ghost endpoint on the historical fallback curve', () => {
    const fallback = resolveHop(HOP, CELLS, new Map());
    const passive = passiveStateFrom(fallback.curve, false);
    const ghost: Vec3 = [-90.5, 12.25, 44.75];
    const ghostHop: ActiveHopCurveRequest = { ...HOP, fromPos: ghost };

    const withPassivePresent = resolveHop(
      ghostHop,
      // The consumed source is deliberately absent: the by-value ghost is the
      // only legal way this hop remains resolvable.
      cellLookup([[TO_ID, TO]]),
      indexOf([[FROM_ID, TO_ID, passive]]),
    );
    const historicalFallback = resolveHop(
      ghostHop,
      cellLookup([[TO_ID, TO]]),
      new Map(),
    );
    expect(withPassivePresent.source).toBe('fallback');
    expect(withPassivePresent.curve).toEqual(historicalFallback.curve);
    expect(withPassivePresent.curve.fromX).toBe(ghost[0]);
    expect(withPassivePresent.curve.fromY).toBe(ghost[1]);
    expect(withPassivePresent.curve.fromZ).toBe(ghost[2]);
    expect(samples(withPassivePresent.curve, 1))
      .toEqual(samples(historicalFallback.curve, 1));
  });

  it('retains Cell lookup fallback for edges outside the passive selection', () => {
    const fallback = resolveHop(HOP, CELLS, new Map());
    expect(fallback.source).toBe('fallback');
    expect(fallback.curve.fromX).toBe(FROM[0]);
    expect(fallback.curve.toZ).toBe(TO[2]);
    expect(resolveHop(
      HOP,
      cellLookup([[FROM_ID, FROM]]),
      new Map(),
    ).source).toBeNull();
  });

  it('asks the numeric index in either orientation and builds no key string', () => {
    const fallback = resolveHop(HOP, CELLS, new Map());
    const state = passiveStateFrom(fallback.curve, false);
    // Stored (lo, hi); asked both ways round.
    const index = indexOf([[TO_ID, FROM_ID, state]]);
    expect(resolveHop({ fromCellId: FROM_ID, toCellId: TO_ID }, CELLS, index).source)
      .toBe('passive');
    expect(resolveHop({ fromCellId: TO_ID, toCellId: FROM_ID }, CELLS, index).source)
      .toBe('passive');
    // This runs once per hop per frame: the string edge key — two
    // number→string conversions, a cons string and its flatten — is the one
    // thing it must never build.
    expect(HOP_CURVE_SOURCE).not.toContain('fabricEdgeKey');
    expect(HOP_CURVE_SOURCE).not.toMatch(/\$\{/);
    expect(HOP_CURVE_SOURCE).toContain('fabricEdgeIndexGet(');
  });
});

describe('fabricEdgeIndex — lo → hi → value, with no key built', () => {
  it('stores and finds an edge under its canonical pair from either order', () => {
    const index: FabricEdgeIndex<string> = new Map();
    fabricEdgeIndexSet(index, 20, 10, 'a');
    expect(fabricEdgeIndexGet(index, 10, 20)).toBe('a');
    expect(fabricEdgeIndexGet(index, 20, 10)).toBe('a');
    expect(fabricEdgeIndexGet(index, 10, 21)).toBeUndefined();
    expect([...index.keys()]).toEqual([10]);
    expect(fabricEdgeIndexSize(index)).toBe(1);
    // Overwrite in place: one entry per pair.
    fabricEdgeIndexSet(index, 10, 20, 'b');
    expect(fabricEdgeIndexGet(index, 20, 10)).toBe('b');
    expect(fabricEdgeIndexSize(index)).toBe(1);
  });

  it('holds a first-level entry only while an edge is under it', () => {
    const index: FabricEdgeIndex<number> = new Map();
    fabricEdgeIndexSet(index, 1, 2, 12);
    fabricEdgeIndexSet(index, 1, 3, 13);
    fabricEdgeIndexSet(index, 5, 4, 45);
    expect(fabricEdgeIndexSize(index)).toBe(3);
    expect(fabricEdgeIndexDelete(index, 2, 1)).toBe(true);
    expect(index.has(1)).toBe(true); // (1,3) still there
    expect(fabricEdgeIndexDelete(index, 3, 1)).toBe(true);
    expect(index.has(1)).toBe(false); // emptied → pruned
    expect(fabricEdgeIndexDelete(index, 1, 3)).toBe(false);
    expect(fabricEdgeIndexDelete(index, 4, 5)).toBe(true);
    expect(index.size).toBe(0);
  });

  it('keeps the two id families apart — nothing is packed into one number', () => {
    // Sequential-small ids and ~2^52 ids coexist; a 32-bit pack would alias.
    const index: FabricEdgeIndex<string> = new Map();
    const big = 2 ** 52 + 7;
    fabricEdgeIndexSet(index, 7, big, 'big');
    fabricEdgeIndexSet(index, 7, 0x1_0000_0007, 'mid');
    fabricEdgeIndexSet(index, 7, 7 + 1, 'small');
    expect(fabricEdgeIndexGet(index, big, 7)).toBe('big');
    expect(fabricEdgeIndexGet(index, 0x1_0000_0007, 7)).toBe('mid');
    expect(fabricEdgeIndexGet(index, 8, 7)).toBe('small');
    expect(fabricEdgeIndexSize(index)).toBe(3);
  });
});
