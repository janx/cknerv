import { describe, expect, it, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { Canvas } from '@react-three/fiber';
import BlockCourierLayer from '../../src/components/BlockCourierLayer';
import { resetSimClock } from '../../src/tweaks/simClock';
import type { Vec3 } from '../../src/types';

function fixture() {
  const posById = new Map<string, Vec3>([
    ['A', [10, 22, 0]],
    ['B', [20, 22, 5]],
    ['C', [30, 22, -5]],
  ]);
  const senders: Record<string, string | null> = { A: null, B: 'A', C: 'B' };
  const arrivals: Record<string, number> = { A: 0.12, B: 1.4, C: 1.9 };
  return { posById, senders, arrivals };
}

describe('BlockCourierLayer mount', () => {
  beforeEach(() => resetSimClock());

  it('mounts a fired wave inside a Canvas without throwing', () => {
    const { posById, senders, arrivals } = fixture();
    const pulseRef = { current: { at: 0, entryId: 'A' } };
    expect(() =>
      render(
        <Canvas>
          <BlockCourierLayer
            posById={posById}
            senders={senders}
            arrivals={arrivals}
            entryId="A"
            pulseRef={pulseRef}
            hubPos={[0, 22, 0]}
          />
        </Canvas>,
      ),
    ).not.toThrow();
  });

  it('survives a null pulse (no active block)', () => {
    const { posById, senders, arrivals } = fixture();
    const pulseRef = { current: null as { at: number; entryId: string | null } | null };
    expect(() =>
      render(
        <Canvas>
          <BlockCourierLayer
            posById={posById}
            senders={senders}
            arrivals={arrivals}
            entryId={null}
            pulseRef={pulseRef}
            hubPos={[0, 22, 0]}
          />
        </Canvas>,
      ),
    ).not.toThrow();
  });
});
