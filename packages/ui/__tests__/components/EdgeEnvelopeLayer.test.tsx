import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { Canvas } from '@react-three/fiber';
import EdgeEnvelopeLayer, {
  buildTrajectories,
  colorForOriginIdx,
} from '../../src/components/EdgeEnvelopeLayer';
import type { EdgeEnvelope } from '../../src/components/EdgeEnvelopeLayer';

const mkEnv = (
  id: string,
  from: string,
  to: string,
  start = 0,
  dur = 500,
): EdgeEnvelope => ({
  id,
  fromNodeId: from,
  toNodeId: to,
  startMs: start,
  durationMs: dur,
  originNodeIdx: 0,
});

const positions = new Map<string, [number, number, number]>([
  ['chain:0', [0, 22, 0]],
  ['chain:1', [10, 22, 0]],
  ['chain:2', [20, 22, 0]],
]);

describe('buildTrajectories', () => {
  it('returns one entry per envelope with valid endpoints', () => {
    const envs = [
      mkEnv('a', 'chain:0', 'chain:1'),
      mkEnv('b', 'chain:1', 'chain:2'),
      mkEnv('c', 'chain:0', 'chain:2'),
    ];
    const out = buildTrajectories(envs, positions);
    expect(out.size).toBe(3);
    const a = out.get('a')!;
    expect(a.p0).toEqual([0, 22, 0]);
    expect(a.p2).toEqual([10, 22, 0]);
    // p1 (bezier control) is derived; just assert it's defined
    expect(a.p1).toHaveLength(3);
  });

  it('drops envelopes whose endpoints are missing and calls onMiss', () => {
    const onMiss = vi.fn();
    const envs = [
      mkEnv('valid', 'chain:0', 'chain:1'),
      mkEnv('orphan-from', 'chain:99', 'chain:1'),
      mkEnv('orphan-to', 'chain:0', 'chain:99'),
    ];
    const out = buildTrajectories(envs, positions, onMiss);
    expect(out.size).toBe(1);
    expect(out.has('valid')).toBe(true);
    expect(onMiss).toHaveBeenCalledTimes(2);
    expect(onMiss).toHaveBeenCalledWith('orphan-from', 'chain:99', 'chain:1');
    expect(onMiss).toHaveBeenCalledWith('orphan-to', 'chain:0', 'chain:99');
  });

  it('handles empty input', () => {
    expect(buildTrajectories([], positions).size).toBe(0);
  });
});

describe('EdgeEnvelopeLayer mount', () => {
  it('mounts inside an r3f Canvas without throwing', () => {
    const envs = [mkEnv('a', 'chain:0', 'chain:1')];
    expect(() =>
      render(
        <Canvas>
          <EdgeEnvelopeLayer envelopes={envs} nodePositions={positions} />
        </Canvas>,
      ),
    ).not.toThrow();
  });

  it('mounts with empty envelope list', () => {
    expect(() =>
      render(
        <Canvas>
          <EdgeEnvelopeLayer envelopes={[]} nodePositions={positions} />
        </Canvas>,
      ),
    ).not.toThrow();
  });
});

describe('colorForOriginIdx', () => {
  it('returns the fallback when count <= 1', () => {
    const c0 = colorForOriginIdx(0, 0);
    const c1 = colorForOriginIdx(0, 1);
    // both fall back to the same anchor color
    expect(c0.getHexString()).toBe(c1.getHexString());
  });

  it('produces N distinct colors for N origins', () => {
    const hexes = new Set<string>();
    for (let i = 0; i < 7; i += 1) {
      hexes.add(colorForOriginIdx(i, 7).getHexString());
    }
    expect(hexes.size).toBe(7);
  });

  it('is deterministic for the same (idx, count) pair', () => {
    const a = colorForOriginIdx(3, 7).getHexString();
    const b = colorForOriginIdx(3, 7).getHexString();
    expect(a).toBe(b);
  });
});

describe('EdgeEnvelopeLayer module shape', () => {
  it('exports a default React component and buildTrajectories', () => {
    expect(typeof EdgeEnvelopeLayer).toBe('function');
    expect(typeof buildTrajectories).toBe('function');
    expect(typeof colorForOriginIdx).toBe('function');
  });
});
