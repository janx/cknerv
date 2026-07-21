import { describe, expect, it } from 'vitest';
import {
  CONSENSUS_RECORD_CAMERA_DISTANCE,
  CONSENSUS_RECORD_CAMERA_NEUTRAL_MIN_DISTANCE,
  CONSENSUS_ROUTE_CAMERA_DISTANCE,
  consensusRouteHopWorldPosition,
  deriveConsensusRecordCameraIntent,
  deriveConsensusRecordCameraPose,
  deriveConsensusRecordNeutralCameraPose,
  deriveConsensusRouteCameraPose,
} from '../../src/derives/consensusRouteCamera.derive';
import { CELLS_Y } from '../../src/layout';

const distance = (
  left: readonly number[],
  right: readonly number[],
): number => Math.hypot(
  left[0] - right[0],
  left[1] - right[1],
  left[2] - right[2],
);

describe('consensus route camera derive', () => {
  it('projects a Cell seed through the live galaxy rotation', () => {
    const world = consensusRouteHopWorldPosition([1, 2, 0], Math.PI / 2);

    expect(world[0]).toBeCloseTo(0, 8);
    expect(world[1]).toBe(CELLS_Y + 2);
    expect(world[2]).toBeCloseTo(-1, 8);
    expect(consensusRouteHopWorldPosition([1, 2, 3], Number.NaN))
      .toEqual([1, CELLS_Y + 2, 3]);
  });

  it('frames the exact hop while preserving the incoming view direction', () => {
    const currentPosition: [number, number, number] = [12, 10, 14];
    const currentTarget: [number, number, number] = [2, 4, 6];
    const hop: [number, number, number] = [-8, 39, 5];
    const pose = deriveConsensusRouteCameraPose(
      currentPosition,
      currentTarget,
      hop,
    );
    const before = currentPosition.map((value, index) => (
      value - currentTarget[index]
    ));
    const after = pose.position.map((value, index) => value - pose.target[index]);

    expect(pose.target).toEqual(hop);
    expect(distance(pose.position, pose.target))
      .toBeCloseTo(CONSENSUS_ROUTE_CAMERA_DISTANCE, 8);
    expect(after[0] / after[2]).toBeCloseTo(before[0] / before[2], 8);
    expect(after[1] / after[2]).toBeCloseTo(before[1] / before[2], 8);
  });

  it('uses a finite canonical view when position and target coincide', () => {
    const pose = deriveConsensusRouteCameraPose([0, 0, 0], [0, 0, 0], [4, 5, 6]);

    expect(pose.position.every(Number.isFinite)).toBe(true);
    expect(distance(pose.position, pose.target))
      .toBeCloseTo(CONSENSUS_ROUTE_CAMERA_DISTANCE, 8);
  });

  it('enters neutral space once, then recognizes only an exact record change', () => {
    expect(deriveConsensusRecordCameraIntent(
      '18:5',
      '18:5',
      false,
      true,
      true,
    )).toBe('neutral');
    expect(deriveConsensusRecordCameraIntent(
      '18:5',
      '18:5',
      true,
      true,
      true,
    )).toBe('idle');
    expect(deriveConsensusRecordCameraIntent(
      '18:5',
      '19:9',
      true,
      false,
      true,
    )).toBe('record');
    expect(deriveConsensusRecordCameraIntent(
      '18:5',
      '19:9',
      false,
      true,
      true,
    )).toBe('record');
    expect(deriveConsensusRecordCameraIntent(
      null,
      '19:9',
      false,
      false,
      true,
    )).toBe('idle');
    expect(deriveConsensusRecordCameraIntent(
      '18:5',
      '19:9',
      false,
      false,
      false,
    )).toBe('idle');
  });

  it('frames a record more broadly than one locked route hop', () => {
    const record = deriveConsensusRecordCameraPose(
      [12, 10, 14],
      [2, 4, 6],
      [-8, 39, 5],
    );

    expect(record.target).toEqual([-8, 39, 5]);
    expect(distance(record.position, record.target))
      .toBeCloseTo(CONSENSUS_RECORD_CAMERA_DISTANCE, 8);
    expect(CONSENSUS_RECORD_CAMERA_DISTANCE)
      .toBeGreaterThan(CONSENSUS_ROUTE_CAMERA_DISTANCE);
  });

  it('derives neutral space without using either record target', () => {
    const neutral = deriveConsensusRecordNeutralCameraPose(
      [20, 50, 20],
      [4, 38, 6],
      [40, 80, 40],
      [0, 30, 0],
    );

    expect(neutral.target).toEqual([0, 30, 0]);
    expect(distance(neutral.position, neutral.target))
      .toBeGreaterThanOrEqual(CONSENSUS_RECORD_CAMERA_NEUTRAL_MIN_DISTANCE);
    expect(neutral.target).not.toEqual([4, 38, 6]);
  });
});
