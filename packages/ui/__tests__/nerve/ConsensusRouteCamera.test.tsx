import type { ReactNode } from 'react';
import type { Cell } from '@cknerv/types';
import { emptyCellsCache } from '@cknerv/cache';
import { act, render } from '@testing-library/react';
import * as THREE from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CELLS_Y } from '../../src/layout';
import { CellGalaxyProvider } from '../../src/hooks/cellGalaxyContext';
import ConsensusRouteCamera, {
  type ConsensusRouteCameraControls,
} from '../../src/nerve/ConsensusRouteCamera';
import { galaxyFrame } from '../../src/tweaks/galaxyFrame';

const frameMock = vi.hoisted(() => ({
  callback: null as null | ((state: unknown, deltaSeconds: number) => void),
}));
const cameraMock = vi.hoisted(() => ({
  current: null as THREE.PerspectiveCamera | null,
}));

vi.mock('@react-three/fiber', () => ({
  useFrame: (callback: (state: unknown, deltaSeconds: number) => void) => {
    frameMock.callback = callback;
  },
  useThree: (selector: (state: { camera: THREE.PerspectiveCamera }) => unknown) => (
    selector({ camera: cameraMock.current! })
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

describe('ConsensusRouteCamera record composition', () => {
  beforeEach(() => {
    frameMock.callback = null;
    cameraMock.current = new THREE.PerspectiveCamera();
    cameraMock.current.position.set(30, 50, 20);
    galaxyFrame.rotationY = 0;
  });

  it('moves through neutral space before broadly framing the new record', () => {
    const cache = emptyCellsCache();
    cache.cells.set(1, cell(1, [-12, 0, 4]));
    cache.cells.set(2, cell(2, [20, 1, -8]));
    const controls = {
      target: new THREE.Vector3(0, 30, 0),
      update: vi.fn(),
    } satisfies ConsensusRouteCameraControls;
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

    act(() => {
      for (let frame = 0; frame < 36; frame += 1) {
        frameMock.callback?.({}, 0.1);
      }
    });
    const recordWorld = new THREE.Vector3(20, CELLS_Y + 1, -8);
    expect(controls.target.distanceTo(recordWorld)).toBeLessThan(0.05);
    expect(distance(cameraMock.current!.position, controls.target))
      .toBeCloseTo(64, 1);

    rendered.rerender(view(
      <ConsensusRouteCamera
        controlsRef={controlsRef}
        recordIdentity="19:2"
        recordTargetCellId={2}
        focus={{
          traceKey: '19:2:1',
          sourceId: 2,
          targetCellId: 2,
          cellId: 2,
          hopIndex: 0,
        }}
      />,
    ));
    act(() => {
      for (let frame = 0; frame < 36; frame += 1) {
        frameMock.callback?.({}, 0.1);
      }
    });
    expect(distance(cameraMock.current!.position, controls.target))
      .toBeCloseTo(36, 1);

    rendered.rerender(view(
      <ConsensusRouteCamera
        controlsRef={controlsRef}
        recordIdentity="19:2"
        recordTargetCellId={2}
      />,
    ));
    act(() => {
      for (let frame = 0; frame < 40; frame += 1) {
        frameMock.callback?.({}, 0.1);
      }
    });
    expect(distance(cameraMock.current!.position, controls.target))
      .toBeCloseTo(64, 1);

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
});
