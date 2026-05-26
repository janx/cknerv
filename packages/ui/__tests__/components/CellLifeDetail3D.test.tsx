import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

// R3F's <Canvas> does not commit its child fiber tree in jsdom (it
// gates mounting on a non-zero ResizeObserver measurement). To make
// the SubScene actually render so we can verify its mount-effect
// contract, we mock the r3f / drei surface that this component uses.
// The mocked Canvas still emits a <canvas> HTML element so the
// "mounts inside a Canvas" assertion remains meaningful.
vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children }: { children: React.ReactNode }) => (
    <div><canvas /><div>{children}</div></div>
  ),
  useFrame: () => {},
  useThree: () => ({ gl: {}, scene: { environment: null } }),
}));

vi.mock('@react-three/drei', () => ({
  RenderTexture: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PerspectiveCamera: () => null,
}));

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  return {
    ...actual,
    // PMREMGenerator needs a real WebGLRenderer; stub it for jsdom.
    PMREMGenerator: class {
      constructor() {}
      fromScene() { return { texture: { dispose: () => {} } }; }
      dispose() {}
    },
  };
});

import { Canvas } from '@react-three/fiber';
import CellLifeDetail3D from '../../src/components/CellLifeDetail3D';
import type { Cell } from '@cknerv/types';

const FIXTURE_CELL: Cell = {
  id: 1,
  born_at_ms: 0,
  death_at_ms: null,
  birth_block: 1,
  tag: null,
  pos_seed: [0, 0, 0],
  out_point: { tx_hash: '0x' + '0'.repeat(64), index: 0 },
  capacity: 100,
  data_hex: '0x',
  content_hash: '0x' + 'ab'.repeat(32),
};

function matchMedia(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches, media: query,
      addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
    })),
  });
}

describe('CellLifeDetail3D', () => {
  beforeEach(() => { vi.useFakeTimers(); matchMedia(false); });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it('mounts inside a Canvas without throwing', () => {
    const { container } = render(
      <Canvas>
        <CellLifeDetail3D cell={FIXTURE_CELL} x={0} y={0} width={340} height={200} />
      </Canvas>,
    );
    expect(container.querySelector('canvas')).toBeTruthy();
  });

  it('respects prefers-reduced-motion (no interval scheduled)', () => {
    matchMedia(true);
    const setIntervalSpy = vi.spyOn(window, 'setInterval');
    render(
      <Canvas>
        <CellLifeDetail3D cell={FIXTURE_CELL} x={0} y={0} width={340} height={200} />
      </Canvas>,
    );
    expect(setIntervalSpy).not.toHaveBeenCalled();
    setIntervalSpy.mockRestore();
  });
});
