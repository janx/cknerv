import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  CONSENSUS_CAUSAL_CAMERA_DISTANCE,
  CONSENSUS_CAUSAL_CAMERA_ENDPOINT_HUD_GAP_PX,
  CONSENSUS_CAUSAL_CAMERA_MAX_DISTANCE,
  CONSENSUS_CELL_INSPECTION_CAMERA_DISTANCE,
  CONSENSUS_RECORD_CAMERA_DISTANCE,
  CONSENSUS_RECORD_CAMERA_HUD_GAP_PX,
  CONSENSUS_RECORD_CAMERA_MAX_DISTANCE,
  CONSENSUS_RECORD_CAMERA_NEUTRAL_MIN_DISTANCE,
  CONSENSUS_RECORD_CAMERA_PREFERRED_Y_RATIO,
  CONSENSUS_RECORD_CAMERA_SAFE_WIDTH_PX,
  CONSENSUS_ROUTE_CAMERA_DISTANCE,
  consensusRouteHopWorldPosition,
  deriveConsensusCausalCameraDistance,
  deriveConsensusCausalCameraPose,
  deriveConsensusCellInspectionCameraPose,
  deriveConsensusRecordCameraIntent,
  deriveConsensusRecordCameraDistance,
  deriveConsensusRecordCameraPose,
  deriveConsensusRecordNeutralCameraPose,
  deriveConsensusRecordSafeAnchor,
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

  it('places an exact route Cell on the measured HUD-safe anchor', () => {
    const viewportWidth = 720;
    const viewportHeight = 900;
    const obstacle = { left: 396, top: 42, right: 696, bottom: 850 };
    const anchor = deriveConsensusRecordSafeAnchor(
      viewportWidth,
      viewportHeight,
      [obstacle],
    );
    const hopWorld: [number, number, number] = [20, 39, -8];
    const pose = deriveConsensusRouteCameraPose(
      [30, 50, 20],
      [0, 30, 0],
      hopWorld,
      CONSENSUS_ROUTE_CAMERA_DISTANCE,
      {
        viewportWidth,
        viewportHeight,
        verticalFovDegrees: 50,
        anchor,
        cameraUp: [0, 1, 0],
      },
    );
    const camera = new THREE.PerspectiveCamera(
      50,
      viewportWidth / viewportHeight,
      0.1,
      1000,
    );
    camera.position.set(...pose.position);
    camera.lookAt(...pose.target);
    camera.updateMatrixWorld();
    const projected = new THREE.Vector3(...hopWorld).project(camera);
    const screen = [
      (projected.x + 1) * viewportWidth / 2,
      (1 - projected.y) * viewportHeight / 2,
    ];

    expect(screen[0]).toBeCloseTo(anchor[0], 6);
    expect(screen[1]).toBeCloseTo(anchor[1], 6);
    expect(distance(pose.position, hopWorld))
      .toBeCloseTo(CONSENSUS_ROUTE_CAMERA_DISTANCE, 8);
    expect(screen[0]).toBeLessThan(obstacle.left);
  });

  it('frames first recall and exact replacement, entering neutral space once', () => {
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
    )).toBe('record');
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

  it('keeps selected-Cell inspection broader than explicit detail views', () => {
    const inspection = deriveConsensusCellInspectionCameraPose(
      [12, 10, 14],
      [2, 4, 6],
      [-8, 39, 5],
    );

    expect(inspection.target).toEqual([-8, 39, 5]);
    expect(distance(inspection.position, inspection.target))
      .toBeCloseTo(CONSENSUS_CELL_INSPECTION_CAMERA_DISTANCE, 8);
    expect(CONSENSUS_CELL_INSPECTION_CAMERA_DISTANCE)
      .toBeGreaterThan(CONSENSUS_ROUTE_CAMERA_DISTANCE);
    expect(CONSENSUS_CELL_INSPECTION_CAMERA_DISTANCE)
      .toBeGreaterThan(CONSENSUS_RECORD_CAMERA_DISTANCE);
    expect(CONSENSUS_CELL_INSPECTION_CAMERA_DISTANCE).toBe(104);
  });

  it('widens causal inspection around the selected Cell and real endpoints', () => {
    const viewportWidth = 1000;
    const viewportHeight = 800;
    const composition = {
      viewportWidth,
      viewportHeight,
      verticalFovDegrees: 50,
      anchor: [500, 400] as const,
      cameraUp: [0, 1, 0] as [number, number, number],
    };
    const obstacle = { left: 720, top: 0, right: 1000, bottom: 800 };
    const selectedWorld: [number, number, number] = [0, 0, 0];
    const points = [
      { position: selectedWorld, role: 'endpoint' as const },
      { position: [0, 5, 0] as [number, number, number], role: 'carrier' as const },
      { position: [26, 7, 0] as [number, number, number], role: 'carrier' as const },
      { position: [50, 0, 0] as [number, number, number], role: 'endpoint' as const },
    ];
    const distanceToFit = deriveConsensusCausalCameraDistance(
      [0, 0, 64],
      [0, 0, 0],
      selectedWorld,
      points,
      composition,
      [obstacle],
    );
    const pose = deriveConsensusCausalCameraPose(
      [0, 0, 64],
      [0, 0, 0],
      selectedWorld,
      distanceToFit,
      composition,
    );
    const camera = new THREE.PerspectiveCamera(
      50,
      viewportWidth / viewportHeight,
      0.1,
      1000,
    );
    camera.position.set(...pose.position);
    camera.lookAt(...pose.target);
    camera.updateMatrixWorld();
    const selectedScreen = new THREE.Vector3(...selectedWorld).project(camera);
    const endpointScreen = new THREE.Vector3(50, 0, 0).project(camera);
    const endpointX = (endpointScreen.x + 1) * viewportWidth / 2;

    expect(distanceToFit).toBeGreaterThan(CONSENSUS_CAUSAL_CAMERA_DISTANCE);
    expect(distanceToFit).toBeLessThan(CONSENSUS_CAUSAL_CAMERA_MAX_DISTANCE);
    expect((selectedScreen.x + 1) * viewportWidth / 2).toBeCloseTo(500, 6);
    expect((1 - selectedScreen.y) * viewportHeight / 2).toBeCloseTo(400, 6);
    expect(endpointX).toBeLessThanOrEqual(
      obstacle.left - CONSENSUS_CAUSAL_CAMERA_ENDPOINT_HUD_GAP_PX,
    );
  });

  it('keeps a compact causal lens at the ordinary inspection distance', () => {
    const selectedWorld: [number, number, number] = [0, 0, 0];
    const distanceToFit = deriveConsensusCausalCameraDistance(
      [0, 0, 64],
      [0, 0, 0],
      selectedWorld,
      [
        { position: selectedWorld, role: 'endpoint' },
        { position: [4, 5, 0], role: 'carrier' },
        { position: [8, 0, 0], role: 'endpoint' },
      ],
      {
        viewportWidth: 1000,
        viewportHeight: 800,
        verticalFovDegrees: 50,
        anchor: [500, 400],
      },
    );

    expect(distanceToFit).toBe(CONSENSUS_CAUSAL_CAMERA_DISTANCE);
  });

  it('moves the record anchor only far enough to clear measured HUD rails', () => {
    const viewportWidth = 1440;
    const viewportHeight = 800;
    const unobstructed = deriveConsensusRecordSafeAnchor(
      viewportWidth,
      viewportHeight,
    );
    const rightRail = { left: 760, top: 40, right: 1440, bottom: 790 };
    const guarded = deriveConsensusRecordSafeAnchor(
      viewportWidth,
      viewportHeight,
      [rightRail],
    );

    expect(unobstructed[0]).toBe(viewportWidth / 2);
    expect(unobstructed[1]).toBe(
      viewportHeight * CONSENSUS_RECORD_CAMERA_PREFERRED_Y_RATIO,
    );
    expect(guarded[0]).toBeCloseTo(
      rightRail.left
        - CONSENSUS_RECORD_CAMERA_HUD_GAP_PX
        - CONSENSUS_RECORD_CAMERA_SAFE_WIDTH_PX / 2,
      8,
    );
    expect(guarded[1]).toBe(unobstructed[1]);

    const narrow = deriveConsensusRecordSafeAnchor(1000, 800, [
      { left: 720, top: 40, right: 1000, bottom: 790 },
    ]);
    expect(narrow).toEqual([500, unobstructed[1]]);
  });

  it('projects the exact record Cell onto the derived safe anchor', () => {
    const viewportWidth = 1440;
    const viewportHeight = 800;
    const anchor = deriveConsensusRecordSafeAnchor(
      viewportWidth,
      viewportHeight,
      [{ left: 760, top: 40, right: 1440, bottom: 790 }],
    );
    const recordWorld: [number, number, number] = [-8, 39, 5];
    const pose = deriveConsensusRecordCameraPose(
      [12, 10, 14],
      [2, 4, 6],
      recordWorld,
      CONSENSUS_RECORD_CAMERA_DISTANCE,
      {
        viewportWidth,
        viewportHeight,
        verticalFovDegrees: 50,
        anchor,
        cameraUp: [0, 1, 0],
      },
    );
    const camera = new THREE.PerspectiveCamera(
      50,
      viewportWidth / viewportHeight,
      0.1,
      1000,
    );
    camera.position.set(...pose.position);
    camera.lookAt(...pose.target);
    camera.updateMatrixWorld();
    const projected = new THREE.Vector3(...recordWorld).project(camera);
    const screen = [
      (projected.x + 1) * viewportWidth / 2,
      (1 - projected.y) * viewportHeight / 2,
    ];

    expect(screen[0]).toBeCloseTo(anchor[0], 6);
    expect(screen[1]).toBeCloseTo(anchor[1], 6);
    expect(distance(pose.position, recordWorld))
      .toBeCloseTo(CONSENSUS_RECORD_CAMERA_DISTANCE, 8);
    expect(pose.target).not.toEqual(recordWorld);
  });

  it('widens only when verified route carriers need more viewport space', () => {
    const composition = {
      viewportWidth: 1000,
      viewportHeight: 800,
      verticalFovDegrees: 50,
      anchor: [500, 400] as const,
      cameraUp: [0, 1, 0] as [number, number, number],
    };
    const currentPosition: [number, number, number] = [0, 0, 64];
    const currentTarget: [number, number, number] = [0, 0, 0];
    const recordWorld: [number, number, number] = [0, 0, 0];
    const compact = deriveConsensusRecordCameraDistance(
      currentPosition,
      currentTarget,
      recordWorld,
      [
        { position: recordWorld, role: 'endpoint' },
        { position: [10, 0, 0], role: 'carrier' },
      ],
      composition,
    );
    const extended = deriveConsensusRecordCameraDistance(
      currentPosition,
      currentTarget,
      recordWorld,
      [
        { position: recordWorld, role: 'endpoint' },
        { position: [70, 0, 0], role: 'carrier' },
      ],
      composition,
    );
    const capped = deriveConsensusRecordCameraDistance(
      currentPosition,
      currentTarget,
      recordWorld,
      [
        { position: recordWorld, role: 'endpoint' },
        { position: [300, 0, 0], role: 'carrier' },
      ],
      composition,
    );

    expect(compact).toBe(CONSENSUS_RECORD_CAMERA_DISTANCE);
    expect(extended).toBeGreaterThan(CONSENSUS_RECORD_CAMERA_DISTANCE);
    expect(extended).toBeLessThan(CONSENSUS_RECORD_CAMERA_MAX_DISTANCE);
    expect(capped).toBe(CONSENSUS_RECORD_CAMERA_MAX_DISTANCE);
  });

  it('keeps carrier semantics separate from endpoint HUD clearance', () => {
    const composition = {
      viewportWidth: 1000,
      viewportHeight: 800,
      verticalFovDegrees: 50,
      anchor: [500, 400] as const,
      cameraUp: [0, 1, 0] as [number, number, number],
    };
    const common = [
      { position: [0, 0, 0] as [number, number, number], role: 'endpoint' as const },
    ];
    const obstacle = [{ left: 850, top: 0, right: 950, bottom: 800 }];
    const carrierDistance = deriveConsensusRecordCameraDistance(
      [0, 0, 64],
      [0, 0, 0],
      [0, 0, 0],
      [...common, { position: [30, 0, 0], role: 'carrier' }],
      composition,
      obstacle,
    );
    const endpointDistance = deriveConsensusRecordCameraDistance(
      [0, 0, 64],
      [0, 0, 0],
      [0, 0, 0],
      [...common, { position: [30, 0, 0], role: 'endpoint' }],
      composition,
      obstacle,
    );

    expect(carrierDistance).toBe(CONSENSUS_RECORD_CAMERA_DISTANCE);
    expect(endpointDistance).toBeGreaterThan(carrierDistance);
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
