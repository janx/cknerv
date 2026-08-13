import type { ReactNode } from 'react';
import type { Cell, CellLink } from '@cknerv/types';
import { emptyCellsCache } from '@cknerv/cache';
import { act, render } from '@testing-library/react';
import * as THREE from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CONSENSUS_CELL_INSPECTION_CAMERA_DISTANCE,
  CONSENSUS_RECORD_CAMERA_DISTANCE,
  CONSENSUS_RECORD_CAMERA_MAX_DISTANCE,
  consensusRouteHopWorldPosition,
  deriveConsensusRecordSafeAnchor,
} from '../../src/derives/consensusRouteCamera.derive';
import { deriveCellCausalLens } from '../../src/derives/cellCausalLens.derive';
import { CELLS_Y } from '../../src/layout';
import { CellGalaxyProvider } from '../../src/hooks/cellGalaxyContext';
import ConsensusRouteCamera, {
  type ConsensusRouteCameraControls,
} from '../../src/nerve/ConsensusRouteCamera';
import type { ConsensusMemoryTraceReadout } from '../../src/nerve/consensusMemoryTrace';
import { galaxyFrame } from '../../src/tweaks/galaxyFrame';

const frameMock = vi.hoisted(() => ({
  callback: null as null | ((state: unknown, deltaSeconds: number) => void),
}));
const cameraMock = vi.hoisted(() => ({
  current: null as THREE.PerspectiveCamera | null,
}));
const canvasMock = vi.hoisted(() => ({
  current: null as HTMLCanvasElement | null,
}));
const viewportMock = vi.hoisted(() => ({ width: 1440, height: 800 }));

vi.mock('@react-three/fiber', () => ({
  useFrame: (callback: (state: unknown, deltaSeconds: number) => void) => {
    frameMock.callback = callback;
  },
  useThree: (selector: (state: {
    camera: THREE.PerspectiveCamera;
    gl: { domElement: HTMLCanvasElement };
    size: { width: number; height: number };
  }) => unknown) => (
    selector({
      camera: cameraMock.current!,
      gl: { domElement: canvasMock.current! },
      size: viewportMock,
    })
  ),
}));

vi.mock('../../src/components/hud/useReducedMotion', () => ({
  useReducedMotion: () => false,
}));

function cell(id: number, position: [number, number, number]): Cell {
  return {
    id,
    born_at_ms: 0,
    death_at_ms: null,
    birth_block: 1,
    tag: null,
    pos_seed: position,
    out_point: { tx_hash: `0x${id}`, index: 0 },
    capacity: 0,
    data_hex: '0x',
    content_hash: `0x${String(id).padStart(64, '0')}`,
  };
}

function distance(left: THREE.Vector3, right: THREE.Vector3): number {
  return left.distanceTo(right);
}

function rect(
  left: number,
  top: number,
  right: number,
  bottom: number,
): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
    toJSON: () => ({}),
  };
}

function screenPosition(world: THREE.Vector3): [number, number] {
  cameraMock.current!.updateMatrixWorld();
  const projected = world.clone().project(cameraMock.current!);
  return [
    (projected.x + 1) * viewportMock.width / 2,
    (1 - projected.y) * viewportMock.height / 2,
  ];
}

function traceReadout(): ConsensusMemoryTraceReadout {
  return {
    key: '19:2:1',
    targetCellId: 2,
    sourceKind: 'input',
    stage: 'reading',
    sourceCount: 1,
    consumedInputs: [],
    arrivedSourceCount: 0,
    resolvedSourceCount: 0,
    evidence: [{
      sourceId: 3,
      ordinal: 1,
      contentHash: `0x${'3'.padStart(64, '0')}`,
      state: 'routing',
      sourceOutPoint: { tx_hash: '0x3', index: 0 },
      sourceBirthBlock: 1,
      route: [3, 4, 2],
      hopCount: 2,
      routeDurationMs: 400,
    }],
  };
}

describe('ConsensusRouteCamera record composition', () => {
  beforeEach(() => {
    frameMock.callback = null;
    document.body.innerHTML = '';
    viewportMock.width = 1440;
    viewportMock.height = 800;
    canvasMock.current = document.createElement('canvas');
    vi.spyOn(canvasMock.current, 'getBoundingClientRect').mockImplementation(() => (
      rect(0, 0, viewportMock.width, viewportMock.height)
    ));
    cameraMock.current = new THREE.PerspectiveCamera(
      50,
      viewportMock.width / viewportMock.height,
      0.1,
      1000,
    );
    cameraMock.current.position.set(30, 50, 20);
    galaxyFrame.rotationY = 0;
  });

  it('frames an explicitly started first recall in measured scene-safe space', () => {
    const cache = emptyCellsCache();
    cache.cells.set(2, cell(2, [20, 1, -8]));
    const rightRail = document.createElement('div');
    rightRail.dataset.hudOcclusion = 'true';
    vi.spyOn(rightRail, 'getBoundingClientRect').mockReturnValue(
      rect(760, 40, 1440, 790),
    );
    document.body.append(rightRail);
    const controls = {
      target: new THREE.Vector3(0, 30, 0),
      update: vi.fn(() => {
        cameraMock.current!.lookAt(controls.target);
        cameraMock.current!.updateMatrixWorld();
      }),
    } satisfies ConsensusRouteCameraControls;
    controls.update();
    const controlsRef: { current: ConsensusRouteCameraControls | null } = {
      current: controls,
    };
    const view = (children: ReactNode) => (
      <CellGalaxyProvider value={cache}>{children}</CellGalaxyProvider>
    );
    const rendered = render(view(
      <ConsensusRouteCamera controlsRef={controlsRef} />,
    ));

    rendered.rerender(view(
      <ConsensusRouteCamera
        controlsRef={controlsRef}
        recordIdentity="19:2"
        recordTargetCellId={2}
      />,
    ));
    act(() => {
      for (let frame = 0; frame < 36; frame += 1) {
        frameMock.callback?.({}, 0.1);
      }
    });

    const recordWorld = new THREE.Vector3(20, CELLS_Y + 1, -8);
    const anchor = deriveConsensusRecordSafeAnchor(
      viewportMock.width,
      viewportMock.height,
      [{ left: 760, top: 40, right: 1440, bottom: 790 }],
    );
    const screen = screenPosition(recordWorld);
    expect(screen[0]).toBeCloseTo(anchor[0], 0);
    expect(screen[1]).toBeCloseTo(anchor[1], 0);
    expect(distance(cameraMock.current!.position, recordWorld))
      .toBeCloseTo(64, 1);
  });

  it('moves through neutral space before broadly framing the new record', () => {
    const cache = emptyCellsCache();
    cache.cells.set(1, cell(1, [-12, 0, 4]));
    cache.cells.set(2, cell(2, [20, 1, -8]));
    cache.cells.set(3, cell(3, [20, 61, -8]));
    cache.cells.set(4, cell(4, [40, 20, -20]));
    const readout = traceReadout();
    const initialReadout: ConsensusMemoryTraceReadout = {
      ...readout,
      key: '18:1:1',
      targetCellId: 1,
      evidence: [{
        ...readout.evidence[0],
        route: [3, 1],
        hopCount: 1,
      }],
    };
    const rightRail = document.createElement('div');
    rightRail.dataset.hudOcclusion = 'true';
    vi.spyOn(rightRail, 'getBoundingClientRect').mockReturnValue(
      rect(760, 40, 1440, 790),
    );
    document.body.append(rightRail);
    const controls = {
      target: new THREE.Vector3(0, 30, 0),
      update: vi.fn(() => {
        cameraMock.current!.lookAt(controls.target);
        cameraMock.current!.updateMatrixWorld();
      }),
    } satisfies ConsensusRouteCameraControls;
    controls.update();
    const controlsRef: { current: ConsensusRouteCameraControls | null } = {
      current: controls,
    };
    const view = (children: ReactNode) => (
      <CellGalaxyProvider value={cache}>{children}</CellGalaxyProvider>
    );
    const rendered = render(view(
      <ConsensusRouteCamera
        controlsRef={controlsRef}
        recordIdentity="18:1"
        recordTargetCellId={1}
      />,
    ));
    const initialPosition = cameraMock.current!.position.clone();
    const initialTarget = controls.target.clone();

    act(() => {
      for (let frame = 0; frame < 12; frame += 1) {
        frameMock.callback?.({}, 0.1);
      }
    });
    expect(cameraMock.current!.position).toEqual(initialPosition);
    expect(controls.target).toEqual(initialTarget);

    rendered.rerender(view(
      <ConsensusRouteCamera
        controlsRef={controlsRef}
        recordIdentity="18:1"
        recordTargetCellId={1}
        recordTraceReadout={initialReadout}
      />,
    ));
    act(() => {
      for (let frame = 0; frame < 12; frame += 1) {
        frameMock.callback?.({}, 0.1);
      }
    });
    expect(cameraMock.current!.position).toEqual(initialPosition);
    expect(controls.target).toEqual(initialTarget);

    rendered.rerender(view(
      <ConsensusRouteCamera
        controlsRef={controlsRef}
        recordIdentity="18:1"
        recordTargetCellId={1}
        recordSwitchPending
      />,
    ));
    act(() => {
      for (let frame = 0; frame < 24; frame += 1) {
        frameMock.callback?.({}, 0.1);
      }
    });
    expect(controls.target.distanceTo(initialTarget)).toBeLessThan(0.05);
    expect(distance(cameraMock.current!.position, controls.target))
      .toBeGreaterThan(95);

    rendered.rerender(view(
      <ConsensusRouteCamera
        controlsRef={controlsRef}
        recordIdentity="19:2"
        recordTargetCellId={2}
      />,
    ));
    act(() => {
      for (let frame = 0; frame < 5; frame += 1) {
        frameMock.callback?.({}, 0.1);
      }
    });
    expect(controls.target.distanceTo(initialTarget)).toBeLessThan(0.05);

    rendered.rerender(view(
      <ConsensusRouteCamera
        controlsRef={controlsRef}
        recordIdentity="19:2"
        recordTargetCellId={2}
        recordTraceReadout={readout}
      />,
    ));
    act(() => {
      for (let frame = 0; frame < 36; frame += 1) {
        frameMock.callback?.({}, 0.1);
      }
    });
    const recordWorld = new THREE.Vector3(20, CELLS_Y + 1, -8);
    const wideAnchor = deriveConsensusRecordSafeAnchor(
      viewportMock.width,
      viewportMock.height,
      [{ left: 760, top: 40, right: 1440, bottom: 790 }],
    );
    const wideScreen = screenPosition(recordWorld);
    expect(wideScreen[0]).toBeCloseTo(wideAnchor[0], 0);
    expect(wideScreen[1]).toBeCloseTo(wideAnchor[1], 0);
    const wideRecordDistance = distance(cameraMock.current!.position, recordWorld);
    expect(wideRecordDistance).toBeGreaterThan(64);
    expect(wideRecordDistance)
      .toBeLessThanOrEqual(CONSENSUS_RECORD_CAMERA_MAX_DISTANCE);

    viewportMock.width = 1000;
    cameraMock.current!.aspect = viewportMock.width / viewportMock.height;
    cameraMock.current!.updateProjectionMatrix();
    rendered.rerender(view(
      <ConsensusRouteCamera
        controlsRef={controlsRef}
        recordIdentity="19:2"
        recordTargetCellId={2}
        recordTraceReadout={readout}
      />,
    ));
    act(() => {
      for (let frame = 0; frame < 36; frame += 1) {
        frameMock.callback?.({}, 0.1);
      }
    });
    const narrowAnchor = deriveConsensusRecordSafeAnchor(
      viewportMock.width,
      viewportMock.height,
      [{ left: 760, top: 40, right: 1000, bottom: 790 }],
    );
    const narrowScreen = screenPosition(recordWorld);
    expect(narrowScreen[0]).toBeCloseTo(narrowAnchor[0], 0);
    expect(narrowScreen[1]).toBeCloseTo(narrowAnchor[1], 0);
    expect(narrowScreen[0]).not.toBeCloseTo(wideScreen[0], 0);
    const narrowRecordDistance = distance(cameraMock.current!.position, recordWorld);
    expect(narrowRecordDistance).toBeGreaterThan(64);
    expect(narrowRecordDistance)
      .toBeLessThanOrEqual(CONSENSUS_RECORD_CAMERA_MAX_DISTANCE);

    rendered.rerender(view(
      <ConsensusRouteCamera
        controlsRef={controlsRef}
        recordIdentity="19:2"
        recordTargetCellId={2}
        recordTraceReadout={readout}
        focus={{
          traceKey: '19:2:1',
          sourceId: 3,
          targetCellId: 2,
          cellId: 2,
          hopIndex: 2,
        }}
      />,
    ));
    act(() => {
      for (let frame = 0; frame < 36; frame += 1) {
        frameMock.callback?.({}, 0.1);
      }
    });
    expect(distance(cameraMock.current!.position, recordWorld))
      .toBeCloseTo(36, 1);
    const lockedScreen = screenPosition(recordWorld);
    expect(lockedScreen[0]).toBeCloseTo(narrowAnchor[0], 0);
    expect(lockedScreen[1]).toBeCloseTo(narrowAnchor[1], 0);

    rendered.rerender(view(
      <ConsensusRouteCamera
        controlsRef={controlsRef}
        recordIdentity="19:2"
        recordTargetCellId={2}
        recordTraceReadout={readout}
      />,
    ));
    act(() => {
      for (let frame = 0; frame < 40; frame += 1) {
        frameMock.callback?.({}, 0.1);
      }
    });
    expect(distance(cameraMock.current!.position, recordWorld))
      .toBeCloseTo(narrowRecordDistance, 1);
    const restoredScreen = screenPosition(recordWorld);
    expect(restoredScreen[0]).toBeCloseTo(narrowAnchor[0], 0);
    expect(restoredScreen[1]).toBeCloseTo(narrowAnchor[1], 0);

    rendered.rerender(view(
      <ConsensusRouteCamera controlsRef={controlsRef} />,
    ));
    act(() => {
      for (let frame = 0; frame < 40; frame += 1) {
        frameMock.callback?.({}, 0.1);
      }
    });
    expect(cameraMock.current!.position.distanceTo(initialPosition))
      .toBeLessThan(0.05);
    expect(controls.target.distanceTo(initialTarget)).toBeLessThan(0.05);
  });

  it('frames selection, opens for recall, then returns to the inspected Cell', () => {
    const cache = emptyCellsCache();
    cache.cells.set(2, cell(2, [20, 1, -8]));
    const rightRail = document.createElement('div');
    rightRail.dataset.hudOcclusion = 'true';
    vi.spyOn(rightRail, 'getBoundingClientRect').mockReturnValue(
      rect(760, 40, 1440, 790),
    );
    document.body.append(rightRail);
    const controls = {
      target: new THREE.Vector3(0, 30, 0),
      update: vi.fn(() => {
        cameraMock.current!.lookAt(controls.target);
        cameraMock.current!.updateMatrixWorld();
      }),
    } satisfies ConsensusRouteCameraControls;
    controls.update();
    const controlsRef: { current: ConsensusRouteCameraControls | null } = {
      current: controls,
    };
    const view = (children: ReactNode) => (
      <CellGalaxyProvider value={cache}>{children}</CellGalaxyProvider>
    );
    const rendered = render(view(
      <ConsensusRouteCamera controlsRef={controlsRef} />,
    ));
    const initialPosition = cameraMock.current!.position.clone();
    const initialTarget = controls.target.clone();
    const cellWorld = new THREE.Vector3(20, CELLS_Y + 1, -8);
    const anchor = deriveConsensusRecordSafeAnchor(
      viewportMock.width,
      viewportMock.height,
      [{ left: 760, top: 40, right: 1440, bottom: 790 }],
    );

    rendered.rerender(view(
      <ConsensusRouteCamera
        controlsRef={controlsRef}
        inspectionCellId={2}
      />,
    ));
    act(() => {
      for (let frame = 0; frame < 36; frame += 1) {
        frameMock.callback?.({}, 0.1);
      }
    });
    expect(distance(cameraMock.current!.position, cellWorld))
      .toBeCloseTo(CONSENSUS_CELL_INSPECTION_CAMERA_DISTANCE, 1);
    expect(screenPosition(cellWorld)[0]).toBeCloseTo(anchor[0], 0);
    expect(screenPosition(cellWorld)[1]).toBeCloseTo(anchor[1], 0);

    rendered.rerender(view(
      <ConsensusRouteCamera
        controlsRef={controlsRef}
        inspectionCellId={2}
        recordIdentity="19:2"
        recordTargetCellId={2}
      />,
    ));
    act(() => {
      for (let frame = 0; frame < 40; frame += 1) {
        frameMock.callback?.({}, 0.1);
      }
    });
    expect(distance(cameraMock.current!.position, cellWorld))
      .toBeCloseTo(CONSENSUS_RECORD_CAMERA_DISTANCE, 1);

    rendered.rerender(view(
      <ConsensusRouteCamera
        controlsRef={controlsRef}
        inspectionCellId={2}
      />,
    ));
    act(() => {
      for (let frame = 0; frame < 40; frame += 1) {
        frameMock.callback?.({}, 0.1);
      }
    });
    expect(distance(cameraMock.current!.position, cellWorld))
      .toBeCloseTo(CONSENSUS_CELL_INSPECTION_CAMERA_DISTANCE, 1);
    expect(screenPosition(cellWorld)[0]).toBeCloseTo(anchor[0], 0);
    expect(screenPosition(cellWorld)[1]).toBeCloseTo(anchor[1], 0);

    rendered.rerender(view(
      <ConsensusRouteCamera controlsRef={controlsRef} />,
    ));
    act(() => {
      for (let frame = 0; frame < 40; frame += 1) {
        frameMock.callback?.({}, 0.1);
      }
    });
    expect(cameraMock.current!.position.distanceTo(initialPosition))
      .toBeLessThan(0.05);
    expect(controls.target.distanceTo(initialTarget)).toBeLessThan(0.05);
  });

  it('widens selected-Cell framing to include its retained causal endpoints', () => {
    viewportMock.width = 1000;
    viewportMock.height = 800;
    cameraMock.current!.aspect = viewportMock.width / viewportMock.height;
    cameraMock.current!.position.set(0, CELLS_Y, 64);
    cameraMock.current!.updateProjectionMatrix();
    const cache = emptyCellsCache();
    const selected = cell(2, [0, 0, 0]);
    const input = cell(3, [60, 0, 0]);
    cache.cells.set(selected.id, selected);
    cache.cells.set(input.id, input);
    const origin: CellLink = {
      seq: 19,
      tx_hash: selected.out_point.tx_hash,
      block: selected.birth_block,
      from_ids: [input.id],
      to_ids: [selected.id],
      endpoint_anchors: [],
      parents: [],
      tag: null,
      at_ms: 100,
    };
    const lens = deriveCellCausalLens(selected, [origin], cache.cells);
    const rightRail = document.createElement('div');
    rightRail.dataset.hudOcclusion = 'true';
    vi.spyOn(rightRail, 'getBoundingClientRect').mockReturnValue(
      rect(720, 0, 1000, 800),
    );
    document.body.append(rightRail);
    const controls = {
      target: new THREE.Vector3(0, CELLS_Y, 0),
      update: vi.fn(() => {
        cameraMock.current!.lookAt(controls.target);
        cameraMock.current!.updateMatrixWorld();
      }),
    } satisfies ConsensusRouteCameraControls;
    controls.update();
    const controlsRef: { current: ConsensusRouteCameraControls | null } = {
      current: controls,
    };

    render(
      <CellGalaxyProvider value={cache}>
        <ConsensusRouteCamera
          controlsRef={controlsRef}
          inspectionCellId={selected.id}
          causalLens={lens}
        />
      </CellGalaxyProvider>,
    );
    act(() => {
      for (let frame = 0; frame < 50; frame += 1) {
        frameMock.callback?.({}, 0.1);
      }
    });

    const selectedWorld = new THREE.Vector3(0, CELLS_Y, 0);
    const inputWorld = new THREE.Vector3(60, CELLS_Y, 0);
    const anchor = deriveConsensusRecordSafeAnchor(
      viewportMock.width,
      viewportMock.height,
      [{ left: 720, top: 0, right: 1000, bottom: 800 }],
    );
    expect(distance(cameraMock.current!.position, selectedWorld))
      .toBeGreaterThan(CONSENSUS_CELL_INSPECTION_CAMERA_DISTANCE);
    expect(screenPosition(selectedWorld)[0]).toBeCloseTo(anchor[0], 0);
    expect(screenPosition(selectedWorld)[1]).toBeCloseTo(anchor[1], 0);
    expect(screenPosition(inputWorld)[0]).toBeLessThan(720);
    const driftingInputWorld = new THREE.Vector3(
      ...consensusRouteHopWorldPosition(input.pos_seed, -0.1),
    );
    expect(screenPosition(driftingInputWorld)[0]).toBeLessThan(720);
  });

  it('does not reclaim a manually adjusted camera for passive causal updates', () => {
    const cache = emptyCellsCache();
    const selected = cell(2, [0, 0, 0]);
    const input = cell(3, [40, 0, 0]);
    cache.cells.set(selected.id, selected);
    cache.cells.set(input.id, input);
    const unavailable = deriveCellCausalLens(selected, [], cache.cells);
    const origin = (seq: number): CellLink => ({
      seq,
      tx_hash: selected.out_point.tx_hash,
      block: selected.birth_block,
      from_ids: [input.id],
      to_ids: [selected.id],
      endpoint_anchors: [],
      parents: [],
      tag: null,
      at_ms: 100,
    });
    const controls = {
      target: new THREE.Vector3(0, 30, 0),
      update: vi.fn(() => {
        cameraMock.current!.lookAt(controls.target);
        cameraMock.current!.updateMatrixWorld();
      }),
    } satisfies ConsensusRouteCameraControls;
    controls.update();
    const controlsRef: { current: ConsensusRouteCameraControls | null } = {
      current: controls,
    };
    const view = (
      causalLens: ReturnType<typeof deriveCellCausalLens>,
      manualRevision: number,
    ) => (
      <CellGalaxyProvider value={cache}>
        <ConsensusRouteCamera
          controlsRef={controlsRef}
          inspectionCellId={selected.id}
          causalLens={causalLens}
          manualRevision={manualRevision}
        />
      </CellGalaxyProvider>
    );
    const rendered = render(view(unavailable, 0));
    act(() => {
      for (let frame = 0; frame < 40; frame += 1) {
        frameMock.callback?.({}, 0.1);
      }
    });
    const manuallyOwnedPosition = cameraMock.current!.position.clone();
    const manuallyOwnedTarget = controls.target.clone();

    rendered.rerender(view(unavailable, 1));
    rendered.rerender(view(
      deriveCellCausalLens(selected, [origin(19)], cache.cells),
      1,
    ));
    rendered.rerender(view(
      deriveCellCausalLens(selected, [origin(20)], cache.cells),
      1,
    ));
    act(() => {
      for (let frame = 0; frame < 40; frame += 1) {
        frameMock.callback?.({}, 0.1);
      }
    });

    expect(cameraMock.current!.position).toEqual(manuallyOwnedPosition);
    expect(controls.target).toEqual(manuallyOwnedTarget);
  });
});
