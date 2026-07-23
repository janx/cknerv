import { describe, expect, it } from 'vitest';
import {
  CELL_CONTENT_ADDRESS_LANE_COUNT,
  CELL_CONTENT_ADDRESS_ECHO_DURATION_SECONDS,
  CELL_CONTENT_ADDRESS_FACET_SEGMENTS,
  CELL_CONTENT_ADDRESS_RADIUS_MAX,
  CELL_CONTENT_ADDRESS_RADIUS_MIN,
  CELL_CONTENT_ADDRESS_READ_LANE_SECONDS,
  CELL_CONTENT_ADDRESS_TAU,
  cellContentAddressEchoFrame,
  cellContentAddressLaneEnergy,
  cellContentAddressReadFrame,
  deriveCellContentAddressEncoding,
  deriveCellContentAddressFacets,
  deriveCellContentAddressSegments,
} from '../../src/derives/cellContentAddress.derive';

const HASH = `0x${'0123456789abcdef'.repeat(4)}`;

describe('Cell content-address visual identity', () => {
  it('derives one stable eight-lane encoding from the complete content hash', () => {
    const first = deriveCellContentAddressEncoding(HASH);
    const repeated = deriveCellContentAddressEncoding(HASH);

    expect(first).toEqual(repeated);
    expect(first.fingerprint).toBe('0123456·CDEF');
    expect(first.lanes).toHaveLength(CELL_CONTENT_ADDRESS_LANE_COUNT);
    expect(first.lanes.every((lane) => lane >= 0 && lane <= 1)).toBe(true);
    expect(first.phase).toBeGreaterThanOrEqual(0);
    expect(first.phase).toBeLessThan(CELL_CONTENT_ADDRESS_TAU);
  });

  it('changes every optical identity input when the final nibble changes', () => {
    const original = deriveCellContentAddressEncoding(HASH);
    const changed = deriveCellContentAddressEncoding(`${HASH.slice(0, -1)}e`);

    expect(changed.fingerprint).not.toBe(original.fingerprint);
    expect(changed.phase).not.toBe(original.phase);
    expect(changed.lanes).not.toEqual(original.lanes);
  });

  it('maps every lane onto one bounded inner-horizon facet', () => {
    const encoding = deriveCellContentAddressEncoding(HASH);
    const facets = deriveCellContentAddressFacets(encoding);

    expect(facets).toHaveLength(CELL_CONTENT_ADDRESS_LANE_COUNT);
    expect(facets.map((facet) => facet.value)).toEqual(encoding.lanes);
    expect(facets.every(
      (facet) => facet.radius >= CELL_CONTENT_ADDRESS_RADIUS_MIN
        && facet.radius <= CELL_CONTENT_ADDRESS_RADIUS_MAX,
    )).toBe(true);
    expect(facets.every(
      (facet) => facet.halfSpan > 0
        && facet.halfSpan < CELL_CONTENT_ADDRESS_TAU / 16,
    )).toBe(true);
    expect(facets.some((facet) => facet.hasSpine)).toBe(true);
  });

  it('shares one lane-addressable segment grammar across portrait and scene', () => {
    const encoding = deriveCellContentAddressEncoding(HASH);
    const facets = deriveCellContentAddressFacets(encoding);
    const segments = deriveCellContentAddressSegments(encoding);

    expect(segments.length).toBeGreaterThanOrEqual(
      CELL_CONTENT_ADDRESS_LANE_COUNT * CELL_CONTENT_ADDRESS_FACET_SEGMENTS,
    );
    expect(new Set(segments.map((segment) => segment.laneIndex)).size)
      .toBe(CELL_CONTENT_ADDRESS_LANE_COUNT);
    expect(segments.filter((segment) => segment.energy < 1)).toHaveLength(
      facets.filter((facet) => facet.hasSpine).length,
    );
  });

  it('reads all eight lanes once, then holds the resolved identity', () => {
    const idle = cellContentAddressReadFrame(0, false);
    const reading = cellContentAddressReadFrame(
      CELL_CONTENT_ADDRESS_READ_LANE_SECONDS * 3.5,
      true,
    );
    const resolved = cellContentAddressReadFrame(
      CELL_CONTENT_ADDRESS_READ_LANE_SECONDS
        * CELL_CONTENT_ADDRESS_LANE_COUNT,
      true,
    );

    expect(idle.state).toBe('idle');
    expect(reading).toMatchObject({
      state: 'reading',
      activeLane: 3,
      readCount: 3,
    });
    expect(reading.laneProgress).toBeCloseTo(0.5);
    expect(resolved).toMatchObject({
      state: 'resolved',
      activeLane: null,
      readCount: CELL_CONTENT_ADDRESS_LANE_COUNT,
      progress: 1,
    });
  });

  it('dims unread lanes, flashes the read head, and resolves reduced motion', () => {
    const reading = cellContentAddressReadFrame(
      CELL_CONTENT_ADDRESS_READ_LANE_SECONDS * 2.5,
      true,
    );
    const reduced = cellContentAddressReadFrame(0, true, true);

    expect(cellContentAddressLaneEnergy(reading, 1)).toBe(0.78);
    expect(cellContentAddressLaneEnergy(reading, 2)).toBeGreaterThan(1.8);
    expect(cellContentAddressLaneEnergy(reading, 3)).toBe(0.16);
    expect(reduced.state).toBe('reduced');
    expect(reduced.readCount).toBe(CELL_CONTENT_ADDRESS_LANE_COUNT);
    expect(cellContentAddressLaneEnergy(reduced, 4)).toBe(1.16);
  });

  it('emits one expanding confirmation and a static reduced-motion signature', () => {
    const early = cellContentAddressEchoFrame(
      CELL_CONTENT_ADDRESS_ECHO_DURATION_SECONDS * 0.12,
    );
    const middle = cellContentAddressEchoFrame(
      CELL_CONTENT_ADDRESS_ECHO_DURATION_SECONDS * 0.5,
    );
    const settled = cellContentAddressEchoFrame(
      CELL_CONTENT_ADDRESS_ECHO_DURATION_SECONDS,
    );
    const reduced = cellContentAddressEchoFrame(0, true);

    expect(early.state).toBe('confirming');
    expect(early.strength).toBeGreaterThan(0.8);
    expect(middle.radiusPx).toBeGreaterThan(early.radiusPx);
    expect(middle.strength).toBeGreaterThan(0);
    expect(settled).toMatchObject({
      state: 'settled',
      progress: 1,
      strength: 0,
    });
    expect(reduced).toMatchObject({
      state: 'reduced',
      progress: 1,
    });
    expect(reduced.radiusPx).toBeGreaterThan(early.radiusPx);
  });
});
