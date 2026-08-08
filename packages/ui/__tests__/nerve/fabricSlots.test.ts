import { describe, expect, it } from 'vitest';
import {
  FABRIC_SLOT_FILLER_Y,
  FABRIC_SLOT_SEGMENTS,
  FABRIC_UPLOAD_GAP_MAX_SLOTS,
  FABRIC_UPLOAD_MAX_RANGES,
  mergeFabricSlotRanges,
  type FabricSlotRange,
} from '../../src/nerve/fabricSlots';
import {
  fillFabricSlotRemainder,
  writeFabricEdgeSegments,
  type EdgeState,
} from '../../src/nerve/NeuralFabric';
import { fabricEdgeRenderState } from '../../src/nerve/fabricEdgeRender';

type WriterLayer = Parameters<typeof writeFabricEdgeSegments>[0];
type Aperture = Parameters<typeof writeFabricEdgeSegments>[7];
type Inspection = Parameters<typeof writeFabricEdgeSegments>[8];

const QUIET_APERTURE: Aperture = {
  active: null,
  activeStrength: 0,
  departing: null,
  departingStrength: 0,
};
const NO_INSPECTION: Inspection = { from: null, to: null, progress: 1 };

function makeLayer(segments: number): WriterLayer {
  return {
    positions: new Float32Array(segments * 6),
    colors: new Float32Array(segments * 6),
    inspectionFrom: new Float32Array(segments * 2).fill(1),
    inspectionTo: new Float32Array(segments * 2).fill(1),
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

describe('mergeFabricSlotRanges', () => {
  it('returns nothing for no dirty slots', () => {
    expect(mergeFabricSlotRanges([])).toEqual([]);
  });

  it('emits a single slot as a single slot-sized range', () => {
    expect(mergeFabricSlotRanges([7])).toEqual([
      { start: 7 * FABRIC_SLOT_SEGMENTS, count: 1 * FABRIC_SLOT_SEGMENTS },
    ]);
  });

  it('merges contiguous and deduped slots into segment runs', () => {
    expect(mergeFabricSlotRanges([3, 2, 4, 3])).toEqual([
      { start: 2 * FABRIC_SLOT_SEGMENTS, count: 3 * FABRIC_SLOT_SEGMENTS },
    ]);
  });

  it('keeps disjoint runs separate when gap bridging is disabled', () => {
    expect(mergeFabricSlotRanges([9, 1, 6, 5], 32, 0)).toEqual([
      { start: 1 * FABRIC_SLOT_SEGMENTS, count: 1 * FABRIC_SLOT_SEGMENTS },
      { start: 5 * FABRIC_SLOT_SEGMENTS, count: 2 * FABRIC_SLOT_SEGMENTS },
      { start: 9 * FABRIC_SLOT_SEGMENTS, count: 1 * FABRIC_SLOT_SEGMENTS },
    ]);
  });

  it('bridges gaps of at most FABRIC_UPLOAD_GAP_MAX_SLOTS parked slots', () => {
    const atLimit = FABRIC_UPLOAD_GAP_MAX_SLOTS + 1; // gap == max → merge
    expect(mergeFabricSlotRanges([0, atLimit])).toEqual([
      { start: 0, count: (atLimit + 1) * FABRIC_SLOT_SEGMENTS },
    ]);
    const pastLimit = FABRIC_UPLOAD_GAP_MAX_SLOTS + 2; // gap == max+1 → keep
    expect(mergeFabricSlotRanges([0, pastLimit])).toEqual([
      { start: 0, count: 1 * FABRIC_SLOT_SEGMENTS },
      { start: pastLimit * FABRIC_SLOT_SEGMENTS, count: 1 * FABRIC_SLOT_SEGMENTS },
    ]);
  });

  it('NEVER collapses a scattered dirty set into one spanning prefix', () => {
    // The historical strategy collapsed >32 fragments into first..last —
    // a near-whole-prefix multi-MB upload. Scattered runs must now stay
    // separate (well under the range cap) with zero overshoot.
    const slots: number[] = [];
    for (let i = 0; i < 40; i += 1) slots.push(i * 1000);
    const ranges = mergeFabricSlotRanges(slots);
    expect(ranges).toHaveLength(40);
    expectCoverage(slots, ranges);
    const totalSegments = ranges.reduce((sum, r) => sum + r.count, 0);
    expect(totalSegments).toBe(40 * FABRIC_SLOT_SEGMENTS);
  });

  it('enforces the range cap by bridging the smallest gaps first', () => {
    // Runs at 0..0, 10..10, 100..100, 1000..1000 — gaps 9, 89, 899.
    const slots = [0, 10, 100, 1000];
    expect(mergeFabricSlotRanges(slots, 3, 0)).toEqual([
      { start: 0, count: 11 * FABRIC_SLOT_SEGMENTS },          // bridged gap 9
      { start: 100 * FABRIC_SLOT_SEGMENTS, count: 1 * FABRIC_SLOT_SEGMENTS },
      { start: 1000 * FABRIC_SLOT_SEGMENTS, count: 1 * FABRIC_SLOT_SEGMENTS },
    ]);
    expect(mergeFabricSlotRanges(slots, 2, 0)).toEqual([
      { start: 0, count: 101 * FABRIC_SLOT_SEGMENTS },         // + gap 89
      { start: 1000 * FABRIC_SLOT_SEGMENTS, count: 1 * FABRIC_SLOT_SEGMENTS },
    ]);
    // The largest gap (899) is only bridged when the cap forces it.
    expect(mergeFabricSlotRanges(slots, 1, 0)).toEqual([
      { start: 0, count: 1001 * FABRIC_SLOT_SEGMENTS },
    ]);
  });

  it('caps heavy fragmentation at FABRIC_UPLOAD_MAX_RANGES with coverage intact', () => {
    const slots: number[] = [];
    for (let i = 0; i < 300; i += 1) slots.push(i * 1000);
    const ranges = mergeFabricSlotRanges(slots);
    expect(ranges).toHaveLength(FABRIC_UPLOAD_MAX_RANGES);
    expectCoverage(slots, ranges);
  });

  it('still merges tightly interleaved fragmentation into one small span', () => {
    // Every gap here is 1 parked slot — bridging them all is the cheap
    // and correct outcome (7 slots total, one bufferSubData call).
    expect(mergeFabricSlotRanges([0, 2, 4, 6], 3)).toEqual([
      { start: 0, count: 7 * FABRIC_SLOT_SEGMENTS },
    ]);
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
        0, 1, QUIET_APERTURE, NO_INSPECTION,
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
        0, 1, QUIET_APERTURE, NO_INSPECTION,
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
        for (let f = 0; f < 2; f += 1) {
          expect(slotted.inspectionFrom![(slotStart + s) * 2 + f])
            .toBe(packed.inspectionFrom![(packedStart + s) * 2 + f]);
          expect(slotted.inspectionTo![(slotStart + s) * 2 + f])
            .toBe(packed.inspectionTo![(packedStart + s) * 2 + f]);
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
      0, 1, QUIET_APERTURE, NO_INSPECTION,
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
