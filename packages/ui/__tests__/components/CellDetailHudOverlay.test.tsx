import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import type { MutableRefObject } from 'react';

// R3F's <Canvas> does not commit its child fiber tree in jsdom; mock
// the surface this overlay touches so its body actually runs. Mirrors
// the mock setup used in CellLifeDetail3D's own test.
vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children }: { children: React.ReactNode }) => (
    <div><canvas /><div>{children}</div></div>
  ),
  useFrame: () => {},
  useThree: () => ({ gl: {}, scene: { environment: null } }),
}));

vi.mock('@react-three/drei', () => ({
  Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
}));

import { Canvas } from '@react-three/fiber';
import CellDetailHudOverlay from '../../src/components/CellDetailHudOverlay';
import type { ScanStateRef } from '../../src/ui/scanState';
import { seedGrid, hashToBytes } from '../../src/cellLife/gameOfLife';

const HASH = '0x' + 'ab'.repeat(32);

function makeRef(): MutableRefObject<ScanStateRef | null> {
  return {
    current: {
      grid: seedGrid(hashToBytes(HASH), false),
      generation: 7,
    },
  };
}

describe('CellDetailHudOverlay', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it('mounts without throwing', () => {
    const ref = makeRef();
    expect(() =>
      render(
        <Canvas>
          <CellDetailHudOverlay scanStateRef={ref} x={0} y={0} width={340} height={200} />
        </Canvas>,
      ),
    ).not.toThrow();
  });

  it('renders the LCL amber readouts driven by the ref snapshot', () => {
    const ref = makeRef();
    const { container } = render(
      <Canvas>
        <CellDetailHudOverlay scanStateRef={ref} x={0} y={0} width={340} height={200} />
      </Canvas>,
    );
    vi.advanceTimersByTime(150);
    const textContent = container.textContent ?? '';
    // 4 readouts in the spaced "dim label + amber value" format:
    //   Y +0.42 / ROW 3/8 / POP 14 / GEN 004
    // Label and value render as separate <Text> elements; assert each
    // label glyph is present and the value tokens match shape.
    expect(textContent).toContain('Y');
    expect(textContent).toContain('ROW');
    expect(textContent).toContain('POP');
    expect(textContent).toContain('GEN');
    expect(textContent).toMatch(/[+−]\d+\.\d{2}/);
    expect(textContent).toMatch(/\d\/8/);
    // Seeded ref's generation=7 should show as "007".
    expect(textContent).toContain('007');
  });
});
