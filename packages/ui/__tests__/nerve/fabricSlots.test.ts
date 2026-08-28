import { describe, expect, it } from 'vitest';
import {
  FABRIC_SLOT_FILLER_Y,
  FABRIC_SLOT_SEGMENTS,
  UPLOAD_CALL_COST_BYTES,
  UPLOAD_MAX_CALLS_PER_COMMIT,
  mergeFabricSlotRanges,
  mergeSlotRuns,
  slotRangesUploadCost,
  slotUploadPolicy,
  type FabricSlotRange,
  type SlotUploadPolicy,
} from '../../src/nerve/fabricSlots';
import {
  FABRIC_APERTURE_UPLOAD_POLICY,
  FABRIC_LIFE_COLOR_STRIDE,
  FABRIC_LIFE_CURVE_STRIDE,
  FABRIC_LIFE_SCALAR_STRIDE,
  FABRIC_LIFECYCLE_CURVE_SCALAR_UPLOAD_POLICY,
  FABRIC_LIFECYCLE_UPLOAD_POLICY,
} from '../../src/nerve/fabricLifecycleSlots';
import { BRIDGE_SLOT_UPLOAD_BYTES } from '../../src/nerve/bridgeStats';
import { BRIDGE_UPLOAD_POLICY } from '../../src/nerve/CellBridgeNerves';
import {
  fillFabricSlotRemainder,
  writeFabricEdgeSegments,
  type EdgeState,
} from '../../src/nerve/NeuralFabric';
import { fabricEdgeRenderState } from '../../src/nerve/fabricEdgeRender';
import { FABRIC_TRUNK_NO_ARBOR } from '../../src/nerve/fabricTrunkClass';

type WriterLayer = Parameters<typeof writeFabricEdgeSegments>[0];
type Aperture = Parameters<typeof writeFabricEdgeSegments>[7];

const QUIET_APERTURE: Aperture = {
  active: null,
  activeStrength: 0,
  departing: null,
  departingStrength: 0,
};

function makeLayer(segments: number): WriterLayer {
  return {
    positions: new Float32Array(segments * 6),
    colors: new Float32Array(segments * 6),
    count: 0,
  } as unknown as WriterLayer;
}

function edge(overrides: Partial<EdgeState>): EdgeState {
  return {
    fromCellId: 1,
    toCellId: 2,
    fromX: 0, fromY: 25, fromZ: 0,
    toX: 8, toY: 25, toZ: 4,
    ctrlX: 4, ctrlY: 26, ctrlZ: 1,
    bornAt: 0,
    dyingAt: null,
    deathKind: null,
    deadEnd: null,
    growDir: 1,
    trunkness: FABRIC_TRUNK_NO_ARBOR,
    brightnessMul: 0.8,
    fromR: 0.8, fromG: 0.2, fromB: 0.3,
    toR: 0.7, toG: 0.3, toB: 0.2,
    usage: 0,
    ...overrides,
  };
}

/** Every dirty slot's segments must fall inside exactly one range, and the
 * ranges must come back sorted and non-overlapping — upload correctness. */
function expectCoverage(slots: number[], ranges: FabricSlotRange[]): void {
  for (let i = 1; i < ranges.length; i += 1) {
    expect(ranges[i].start).toBeGreaterThan(
      ranges[i - 1].start + ranges[i - 1].count - 1,
    );
  }
  for (const slot of slots) {
    const segStart = slot * FABRIC_SLOT_SEGMENTS;
    const covering = ranges.filter(
      (r) => segStart >= r.start && segStart + FABRIC_SLOT_SEGMENTS <= r.start + r.count,
    );
    expect(covering, `slot ${slot}`).toHaveLength(1);
  }
}

/** A policy with no gap bridging and a given cap, for the pins below that
 *  are about the cap alone. */
function capOnly(maxRanges: number): SlotUploadPolicy {
  return { bytesPerSlot: 1, callsPerRange: 1, gapMaxSlots: 0, maxRanges };
}

/** Deterministic uniform-random dirty sets — the slot layout is spatially
 *  random, so a clustered dirty set IS a uniform-random one in slot space. */
function seededSlots(seed: number, count: number, span: number): number[] {
  let state = seed >>> 0;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  const picked = new Set<number>();
  while (picked.size < count) picked.add(Math.floor(next() * span));
  return [...picked];
}

/** Independent reference for pass 1: sort, then bridge every gap of at most
 *  `gapMaxSlots`. Exact whenever the cap does not bind. */
function referenceBridgedSlots(slots: number[], gapMaxSlots: number): number {
  const sorted = [...new Set(slots)].sort((a, b) => a - b);
  let uploaded = 0;
  let runStart = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i] - prev - 1 <= gapMaxSlots) {
      prev = sorted[i];
      continue;
    }
    uploaded += prev - runStart + 1;
    runStart = sorted[i];
    prev = sorted[i];
  }
  return uploaded + prev - runStart + 1;
}

const LANE_POLICIES: ReadonlyArray<[string, SlotUploadPolicy]> = [
  ['aperture', FABRIC_APERTURE_UPLOAD_POLICY],
  ['lifecycle', FABRIC_LIFECYCLE_UPLOAD_POLICY],
  ['lifecycle curve+scalar', FABRIC_LIFECYCLE_CURVE_SCALAR_UPLOAD_POLICY],
  ['bridge', BRIDGE_UPLOAD_POLICY],
];

describe('slotUploadPolicy — the upload cost model', () => {
  it('derives the gap a lane may bridge from what a call is worth in its bytes', () => {
    // 4 KB a call: a 128 B lane bridges 32 parked slots, a 384 B lane that
    // marks three buffers (three calls a range) bridges the same 32, and a
    // 224 B lane marking three bridges 54.
    expect(slotUploadPolicy(128)).toEqual({
      bytesPerSlot: 128,
      callsPerRange: 1,
      gapMaxSlots: UPLOAD_CALL_COST_BYTES / 128,
      maxRanges: UPLOAD_MAX_CALLS_PER_COMMIT,
    });
    expect(slotUploadPolicy(384, 3)).toEqual({
      bytesPerSlot: 384,
      callsPerRange: 3,
      gapMaxSlots: Math.floor((UPLOAD_CALL_COST_BYTES * 3) / 384),
      maxRanges: Math.floor(UPLOAD_MAX_CALLS_PER_COMMIT / 3),
    });
    expect(slotUploadPolicy(224, 3).gapMaxSlots).toBe(54);
    // The cap is a CALL budget: a family that marks six attributes a range
    // gets a sixth of the ranges.
    expect(slotUploadPolicy(56, 6).maxRanges).toBe(85);
    expect(() => slotUploadPolicy(0)).toThrow();
    expect(() => slotUploadPolicy(128, 0)).toThrow();
  });

  it('the lifecycle lanes cost exactly their stride sums, one call per marked buffer', () => {
    const slotRecords = FABRIC_SLOT_SEGMENTS * 4;
    expect(FABRIC_LIFECYCLE_UPLOAD_POLICY).toEqual(slotUploadPolicy(
      slotRecords * (FABRIC_LIFE_CURVE_STRIDE + FABRIC_LIFE_COLOR_STRIDE + FABRIC_LIFE_SCALAR_STRIDE),
      3,
    ));
    expect(FABRIC_LIFECYCLE_UPLOAD_POLICY.bytesPerSlot).toBe(384);
    expect(FABRIC_LIFECYCLE_CURVE_SCALAR_UPLOAD_POLICY).toEqual(slotUploadPolicy(
      slotRecords * (FABRIC_LIFE_CURVE_STRIDE + FABRIC_LIFE_SCALAR_STRIDE),
      2,
    ));
    expect(FABRIC_APERTURE_UPLOAD_POLICY).toEqual(slotUploadPolicy(
      slotRecords * FABRIC_LIFE_COLOR_STRIDE,
      1,
    ));
    expect(FABRIC_APERTURE_UPLOAD_POLICY.bytesPerSlot).toBe(128);
    expect(BRIDGE_UPLOAD_POLICY).toEqual(slotUploadPolicy(BRIDGE_SLOT_UPLOAD_BYTES, 3));
  });

  it('prices a range set in the two currencies the model trades', () => {
    const policy = slotUploadPolicy(384, 3);
    expect(slotRangesUploadCost(
      [{ start: 0, count: 2 }, { start: 10, count: 1 }],
      policy,
    )).toEqual({ slots: 3, bytes: 3 * 384, calls: 6 });
  });
});

describe('mergeFabricSlotRanges', () => {
  it('returns nothing for no dirty slots', () => {
    expect(mergeFabricSlotRanges([], FABRIC_APERTURE_UPLOAD_POLICY)).toEqual([]);
  });

  it('emits a single slot as a single slot-sized range', () => {
    expect(mergeFabricSlotRanges([7], FABRIC_APERTURE_UPLOAD_POLICY)).toEqual([
      { start: 7 * FABRIC_SLOT_SEGMENTS, count: 1 * FABRIC_SLOT_SEGMENTS },
    ]);
  });

  it('merges contiguous and deduped slots into segment runs', () => {
    expect(mergeFabricSlotRanges([3, 2, 4, 3], FABRIC_APERTURE_UPLOAD_POLICY)).toEqual([
      { start: 2 * FABRIC_SLOT_SEGMENTS, count: 3 * FABRIC_SLOT_SEGMENTS },
    ]);
  });

  it('keeps disjoint runs separate when gap bridging is disabled', () => {
    expect(mergeFabricSlotRanges([9, 1, 6, 5], capOnly(32))).toEqual([
      { start: 1 * FABRIC_SLOT_SEGMENTS, count: 1 * FABRIC_SLOT_SEGMENTS },
      { start: 5 * FABRIC_SLOT_SEGMENTS, count: 2 * FABRIC_SLOT_SEGMENTS },
      { start: 9 * FABRIC_SLOT_SEGMENTS, count: 1 * FABRIC_SLOT_SEGMENTS },
    ]);
  });

  it('bridges gaps of at most the policy gap, and not one slot more', () => {
    for (const [, policy] of LANE_POLICIES) {
      const atLimit = policy.gapMaxSlots + 1; // gap == max → merge
      expect(mergeFabricSlotRanges([0, atLimit], policy)).toEqual([
        { start: 0, count: (atLimit + 1) * FABRIC_SLOT_SEGMENTS },
      ]);
      const pastLimit = policy.gapMaxSlots + 2; // gap == max+1 → keep
      expect(mergeFabricSlotRanges([0, pastLimit], policy)).toEqual([
        { start: 0, count: 1 * FABRIC_SLOT_SEGMENTS },
        { start: pastLimit * FABRIC_SLOT_SEGMENTS, count: 1 * FABRIC_SLOT_SEGMENTS },
      ]);
    }
  });

  it('NEVER collapses a scattered dirty set into one spanning prefix', () => {
    // The historical strategy collapsed >32 fragments into first..last —
    // a near-whole-prefix multi-MB upload. Scattered runs must now stay
    // separate (well under the range cap) with zero overshoot.
    const slots: number[] = [];
    for (let i = 0; i < 40; i += 1) slots.push(i * 1000);
    for (const [, policy] of LANE_POLICIES) {
      const ranges = mergeFabricSlotRanges(slots, policy);
      expect(ranges).toHaveLength(40);
      expectCoverage(slots, ranges);
      const totalSegments = ranges.reduce((sum, r) => sum + r.count, 0);
      expect(totalSegments).toBe(40 * FABRIC_SLOT_SEGMENTS);
    }
  });

  it('enforces the range cap by bridging the smallest gaps first', () => {
    // Runs at 0..0, 10..10, 100..100, 1000..1000 — gaps 9, 89, 899.
    const slots = [0, 10, 100, 1000];
    expect(mergeFabricSlotRanges(slots, capOnly(3))).toEqual([
      { start: 0, count: 11 * FABRIC_SLOT_SEGMENTS },          // bridged gap 9
      { start: 100 * FABRIC_SLOT_SEGMENTS, count: 1 * FABRIC_SLOT_SEGMENTS },
      { start: 1000 * FABRIC_SLOT_SEGMENTS, count: 1 * FABRIC_SLOT_SEGMENTS },
    ]);
    expect(mergeFabricSlotRanges(slots, capOnly(2))).toEqual([
      { start: 0, count: 101 * FABRIC_SLOT_SEGMENTS },         // + gap 89
      { start: 1000 * FABRIC_SLOT_SEGMENTS, count: 1 * FABRIC_SLOT_SEGMENTS },
    ]);
    // The largest gap (899) is only bridged when the cap forces it.
    expect(mergeFabricSlotRanges(slots, capOnly(1))).toEqual([
      { start: 0, count: 1001 * FABRIC_SLOT_SEGMENTS },
    ]);
  });

  it('caps heavy fragmentation at the policy range cap with coverage intact', () => {
    for (const [, policy] of LANE_POLICIES) {
      const slots: number[] = [];
      for (let i = 0; i < policy.maxRanges + 100; i += 1) slots.push(i * 1000);
      const ranges = mergeFabricSlotRanges(slots, policy);
      expect(ranges).toHaveLength(policy.maxRanges);
      expectCoverage(slots, ranges);
    }
  });

  it('still merges tightly interleaved fragmentation into one small span', () => {
    // Every gap here is 1 parked slot — bridging them all is the cheap
    // and correct outcome under any lane policy (7 slots total, one
    // bufferSubData call per marked buffer).
    for (const [, policy] of LANE_POLICIES) {
      expect(mergeFabricSlotRanges([0, 2, 4, 6], policy)).toEqual([
        { start: 0, count: 7 * FABRIC_SLOT_SEGMENTS },
      ]);
    }
  });

  it('covers every slot, ascending and disjoint, inside the hull, under every lane policy', () => {
    for (const [lane, policy] of LANE_POLICIES) {
      for (const [count, span] of [[50, 9_000], [300, 9_000], [800, 12_500]] as const) {
        for (let seed = 1; seed <= 5; seed += 1) {
          const slots = seededSlots(seed * 7919 + count, count, span);
          const ranges = mergeFabricSlotRanges(slots, policy);
          expectCoverage(slots, ranges);
          const hullStart = Math.min(...slots) * FABRIC_SLOT_SEGMENTS;
          const hullEnd = (Math.max(...slots) + 1) * FABRIC_SLOT_SEGMENTS;
          expect(ranges[0].start, lane).toBeGreaterThanOrEqual(hullStart);
          const last = ranges[ranges.length - 1];
          expect(last.start + last.count, lane).toBeLessThanOrEqual(hullEnd);
          expect(ranges.length, lane).toBeLessThanOrEqual(policy.maxRanges);
          // Under the cap the result is exactly pass 1, which the reference
          // computes independently: no range bridges more than the policy
          // gap, so the overshoot is bounded by gap × runs.
          if (ranges.length < policy.maxRanges) {
            const uploadedSlots = ranges.reduce((sum, r) => sum + r.count, 0)
              / FABRIC_SLOT_SEGMENTS;
            expect(uploadedSlots, lane).toBe(
              referenceBridgedSlots(slots, policy.gapMaxSlots),
            );
            expect(uploadedSlots, lane).toBeLessThanOrEqual(
              count + (ranges.length) * policy.gapMaxSlots + count * policy.gapMaxSlots,
            );
          }
        }
      }
    }
  });

  it('a uniform-random set no longer balloons toward the whole prefix', () => {
    // The 64-slot bridge with a 128-range cap took N=300 in 9,000 to ~65 %
    // of the prefix. The aperture lane's 32-slot bridge leaves most gaps
    // unbridged at this density; what it uploads is bounded well under half.
    const slots = seededSlots(42, 300, 9_000);
    const ranges = mergeFabricSlotRanges(slots, FABRIC_APERTURE_UPLOAD_POLICY);
    const uploadedSlots = ranges.reduce((sum, r) => sum + r.count, 0)
      / FABRIC_SLOT_SEGMENTS;
    expect(uploadedSlots).toBeLessThan(9_000 * 0.4);
    expect(ranges.length).toBeLessThanOrEqual(FABRIC_APERTURE_UPLOAD_POLICY.maxRanges);
  });
});

describe('mergeSlotRuns — the slot-unit core the Cell attributes share', () => {
  it('bridges ascending disjoint runs exactly like the fabric merge', () => {
    const policy = slotUploadPolicy(56, 6); // gap 438
    expect(mergeSlotRuns(
      [{ start: 0, count: 3 }, { start: 100, count: 1 }, { start: 2_000, count: 5 }],
      policy,
    )).toEqual([
      { start: 0, count: 101 },
      { start: 2_000, count: 5 },
    ]);
  });

  it('tolerates overlapping input without losing a slot', () => {
    expect(mergeSlotRuns(
      [{ start: 0, count: 10 }, { start: 5, count: 10 }, { start: 30, count: 1 }],
      capOnly(8),
    )).toEqual([
      { start: 0, count: 15 },
      { start: 30, count: 1 },
    ]);
  });

  it('never returns more than the hull even when the cap forces one range', () => {
    expect(mergeSlotRuns(
      [{ start: 40, count: 1 }, { start: 900, count: 2 }, { start: 5_000, count: 1 }],
      capOnly(1),
    )).toEqual([{ start: 40, count: 4_961 }]);
  });
});

describe('fixed-slot fabric layout', () => {
  const sample = new Float32Array(3);
  const now = 0.6; // growing edges born at 0 sit mid-growth here
  const edges = [
    edge({ fromCellId: 1, toCellId: 2, bornAt: -10 }),            // stable
    edge({ fromCellId: 3, toCellId: 4, bornAt: 0 }),              // growing
    edge({ fromCellId: 5, toCellId: 6, bornAt: 5 }),              // future stagger → hidden
    edge({ fromCellId: 7, toCellId: 8, bornAt: -10, dyingAt: 0.4, deathKind: 'death', deadEnd: 'from' }), // retracting
  ];

  function writePacked(): WriterLayer {
    const layer = makeLayer(64);
    for (const st of edges) {
      writeFabricEdgeSegments(
        layer, st, fabricEdgeRenderState(st, now), sample, now,
        0, 1, QUIET_APERTURE,
      );
    }
    return layer;
  }

  function writeSlotted(): WriterLayer {
    const layer = makeLayer(64);
    edges.forEach((st, slot) => {
      layer.count = slot * FABRIC_SLOT_SEGMENTS;
      writeFabricEdgeSegments(
        layer, st, fabricEdgeRenderState(st, now), sample, now,
        0, 1, QUIET_APERTURE,
      );
      fillFabricSlotRemainder(layer, (slot + 1) * FABRIC_SLOT_SEGMENTS);
    });
    return layer;
  }

  it('slot-addressed real segments are byte-identical to the packed writer', () => {
    const packed = writePacked();
    const slotted = writeSlotted();
    // Packed emit order: stable(4) growing(4) hidden(0) retracting(4).
    const packedRuns = [0, 4, 8, 8]; // packed segment start per edge
    const realCounts = [4, 4, 0, 4];
    edges.forEach((_, slot) => {
      const real = realCounts[slot];
      const packedStart = packedRuns[slot];
      const slotStart = slot * FABRIC_SLOT_SEGMENTS;
      for (let s = 0; s < real; s += 1) {
        for (let f = 0; f < 6; f += 1) {
          expect(slotted.positions[(slotStart + s) * 6 + f])
            .toBe(packed.positions[(packedStart + s) * 6 + f]);
          expect(slotted.colors[(slotStart + s) * 6 + f])
            .toBe(packed.colors[(packedStart + s) * 6 + f]);
        }
      }
      // Remainder segments are parked off-frustum with zero colour.
      for (let s = real; s < FABRIC_SLOT_SEGMENTS; s += 1) {
        const off = (slotStart + s) * 6;
        expect(slotted.positions[off + 1]).toBe(FABRIC_SLOT_FILLER_Y);
        expect(slotted.positions[off + 4]).toBe(FABRIC_SLOT_FILLER_Y);
        for (let f = 0; f < 6; f += 1) expect(slotted.colors[off + f]).toBe(0);
      }
    });
  });

  it('rewriting one animating slot leaves every other slot untouched', () => {
    const layer = writeSlotted();
    const before = {
      positions: layer.positions.slice(),
      colors: layer.colors.slice(),
    };
    // Advance only the growing edge (slot 1) to a later time and rewrite it.
    const later = 0.9;
    const growing = edges[1];
    layer.count = 1 * FABRIC_SLOT_SEGMENTS;
    writeFabricEdgeSegments(
      layer, growing, fabricEdgeRenderState(growing, later), sample, later,
      0, 1, QUIET_APERTURE,
    );
    fillFabricSlotRemainder(layer, 2 * FABRIC_SLOT_SEGMENTS);

    const slot1Start = 1 * FABRIC_SLOT_SEGMENTS * 6;
    const slot1End = 2 * FABRIC_SLOT_SEGMENTS * 6;
    let slot1Changed = false;
    for (let f = 0; f < layer.positions.length; f += 1) {
      const inSlot1 = f >= slot1Start && f < slot1End;
      if (!inSlot1) {
        expect(layer.positions[f]).toBe(before.positions[f]);
        expect(layer.colors[f]).toBe(before.colors[f]);
      } else if (
        layer.positions[f] !== before.positions[f]
        || layer.colors[f] !== before.colors[f]
      ) {
        slot1Changed = true;
      }
    }
    expect(slot1Changed).toBe(true); // the animation genuinely advanced
  });
});
