import { describe, expect, it, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { Canvas } from '@react-three/fiber';
import BlockBeam from '../../src/components/BlockBeam';
import { resetSimClock } from '../../src/tweaks/simClock';
import { CELLS_Y } from '../../src/layout';

describe('BlockBeam mount', () => {
  beforeEach(() => {
    resetSimClock();
  });

  it('mounts inside an r3f Canvas without throwing', () => {
    const fireRef = { current: null };
    expect(() =>
      render(
        <Canvas>
          <BlockBeam
            originWorld={[0, 22, 0]}
            targetY={CELLS_Y}
            fireRef={fireRef}
          />
        </Canvas>,
      ),
    ).not.toThrow();
  });
});

describe('BlockBeam module shape', () => {
  it('exports a default React component', () => {
    expect(typeof BlockBeam).toBe('function');
  });
});
