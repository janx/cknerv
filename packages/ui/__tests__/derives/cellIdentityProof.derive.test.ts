import { describe, expect, it } from 'vitest';
import {
  CELL_BIRTH_ANCHOR_ECHO_SECONDS,
  CELL_BIRTH_ANCHOR_READ_SECONDS,
  CELL_OUTPOINT_LOCATOR_ECHO_SECONDS,
  CELL_OUTPOINT_LOCATOR_LANE_COUNT,
  CELL_OUTPOINT_LOCATOR_READ_SECONDS,
  cellBirthAnchorEchoFrame,
  cellBirthAnchorReadFrame,
  cellBirthAnchorSegmentEnergy,
  cellOutpointLocatorEchoFrame,
  cellOutpointLocatorReadFrame,
  cellOutpointLocatorSegmentEnergy,
  deriveCellBirthAnchorEncoding,
  deriveCellBirthAnchorSegments,
  deriveCellOutpointLocatorEncoding,
  deriveCellOutpointLocatorSegments,
} from '../../src/derives/cellIdentityProof.derive';

const TX_HASH = `0x${'0123456789abcdef'.repeat(4)}`;

describe('Cell WHERE / WHEN visual proofs', () => {
  it('derives stable full-transaction rails and exact output-index bytes', () => {
    const first = deriveCellOutpointLocatorEncoding(TX_HASH, 0x01020304);
    const repeated = deriveCellOutpointLocatorEncoding(TX_HASH, 0x01020304);
    const changedHash = deriveCellOutpointLocatorEncoding(
      `${TX_HASH.slice(0, -1)}e`,
      0x01020304,
    );
    const changedIndex = deriveCellOutpointLocatorEncoding(TX_HASH, 5);

    expect(first).toEqual(repeated);
    expect(first.lanes).toHaveLength(CELL_OUTPOINT_LOCATOR_LANE_COUNT);
    expect(first.indexBytes).toEqual([1, 2, 3, 4]);
    expect(first.fingerprint).toBe('0123456·CDEF#16909060');
    expect(changedHash.lanes).not.toEqual(first.lanes);
    expect(changedHash.phase).not.toBe(first.phase);
    expect(changedIndex.lanes).toEqual(first.lanes);
    expect(changedIndex.indexBytes).toEqual([0, 0, 0, 5]);
  });

  it('builds four open coordinate corners plus four exact index ticks', () => {
    const encoding = deriveCellOutpointLocatorEncoding(TX_HASH, 0x01020304);
    const segments = deriveCellOutpointLocatorSegments(encoding);
    const rails = segments.filter((segment) => segment.role === 'rail');
    const indexTicks = segments.filter((segment) => segment.role === 'index');
    const crosshair = segments.filter(
      (segment) => segment.role === 'crosshair',
    );

    expect(rails).toHaveLength(CELL_OUTPOINT_LOCATOR_LANE_COUNT * 2);
    expect(indexTicks).toHaveLength(4);
    expect(indexTicks.map((segment) => segment.byteIndex))
      .toEqual([0, 1, 2, 3]);
    expect(crosshair).toHaveLength(4);
    expect(new Set(rails.map((segment) => segment.laneIndex)).size)
      .toBe(CELL_OUTPOINT_LOCATOR_LANE_COUNT);
  });

  it('maps the complete birth height onto one chronology notch per hex digit', () => {
    const block = 16_204_800;
    const encoding = deriveCellBirthAnchorEncoding(block);
    const segments = deriveCellBirthAnchorSegments(encoding);
    const digits = segments.filter((segment) => segment.role === 'digit');

    expect(encoding.hexadecimal).toBe(
      BigInt(block).toString(16).toUpperCase().padStart(6, '0'),
    );
    expect(encoding.digits).toEqual(
      [...encoding.hexadecimal].map((digit) => Number.parseInt(digit, 16)),
    );
    expect(segments[0].role).toBe('spine');
    expect(digits).toHaveLength(encoding.digits.length);
    expect(digits.map((segment) => segment.value)).toEqual(encoding.digits);
  });

  it('reads WHERE by contracting rails, then resolves its index qualifier', () => {
    const encoding = deriveCellOutpointLocatorEncoding(TX_HASH, 2);
    const segments = deriveCellOutpointLocatorSegments(encoding);
    const early = cellOutpointLocatorReadFrame(
      CELL_OUTPOINT_LOCATOR_READ_SECONDS * 0.2,
      true,
    );
    const late = cellOutpointLocatorReadFrame(
      CELL_OUTPOINT_LOCATOR_READ_SECONDS * 0.82,
      true,
    );
    const resolved = cellOutpointLocatorReadFrame(
      CELL_OUTPOINT_LOCATOR_READ_SECONDS,
      true,
    );
    const reduced = cellOutpointLocatorReadFrame(0, true, true);

    expect(early.state).toBe('reading');
    expect(early.activeLane).not.toBeNull();
    expect(late.indexProgress).toBeGreaterThan(0);
    expect(late.lockScale).toBeLessThan(early.lockScale);
    expect(cellOutpointLocatorSegmentEnergy(early, segments[0]))
      .toBeGreaterThan(0);
    expect(resolved).toMatchObject({
      state: 'resolved',
      progress: 1,
      indexProgress: 1,
      lockScale: 1,
    });
    expect(reduced.state).toBe('reduced');
  });

  it('reads WHEN as a single descending chronology pass', () => {
    const encoding = deriveCellBirthAnchorEncoding(16_204_800);
    const segments = deriveCellBirthAnchorSegments(encoding);
    const reading = cellBirthAnchorReadFrame(
      CELL_BIRTH_ANCHOR_READ_SECONDS * 0.5,
      true,
      encoding.digits.length,
    );
    const resolved = cellBirthAnchorReadFrame(
      CELL_BIRTH_ANCHOR_READ_SECONDS,
      true,
      encoding.digits.length,
    );
    const reduced = cellBirthAnchorReadFrame(
      0,
      true,
      encoding.digits.length,
      true,
    );

    expect(reading.state).toBe('reading');
    expect(reading.depthProgress).toBeGreaterThan(0);
    expect(reading.depthProgress).toBeLessThan(1);
    expect(reading.activeDigit).not.toBeNull();
    expect(cellBirthAnchorSegmentEnergy(
      reading,
      segments[0],
      encoding.digits.length,
    )).toBeGreaterThan(0.36);
    expect(resolved).toMatchObject({
      state: 'resolved',
      progress: 1,
      depthProgress: 1,
    });
    expect(reduced.state).toBe('reduced');
  });

  it('keeps scene acknowledgement rhythms semantically distinct', () => {
    const locatorEarly = cellOutpointLocatorEchoFrame(
      CELL_OUTPOINT_LOCATOR_ECHO_SECONDS * 0.15,
    );
    const locatorLate = cellOutpointLocatorEchoFrame(
      CELL_OUTPOINT_LOCATOR_ECHO_SECONDS * 0.55,
    );
    const anchorEarly = cellBirthAnchorEchoFrame(
      CELL_BIRTH_ANCHOR_ECHO_SECONDS * 0.15,
    );
    const anchorLate = cellBirthAnchorEchoFrame(
      CELL_BIRTH_ANCHOR_ECHO_SECONDS * 0.55,
    );

    expect(locatorLate.radiusPx).toBeLessThan(locatorEarly.radiusPx);
    expect(anchorLate.depthProgress).toBeGreaterThan(
      anchorEarly.depthProgress,
    );
    expect(cellOutpointLocatorEchoFrame(
      CELL_OUTPOINT_LOCATOR_ECHO_SECONDS,
    ).state).toBe('settled');
    expect(cellBirthAnchorEchoFrame(
      CELL_BIRTH_ANCHOR_ECHO_SECONDS,
    ).state).toBe('settled');
    expect(cellOutpointLocatorEchoFrame(0, true).state).toBe('reduced');
    expect(cellBirthAnchorEchoFrame(0, true).depthProgress).toBe(1);
  });
});
