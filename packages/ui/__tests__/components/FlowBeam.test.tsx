import { describe, expect, it, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';
import FlowBeam from '../../src/components/FlowBeam';
import { resetSimClock } from '../../src/tweaks/simClock';

const STYLE = { particleSize: 0.7, count: 24, speed: 0.08, jitter: 0.5, intensity: 1.3 };

describe('FlowBeam mount', () => {
  beforeEach(() => {
    resetSimClock();
  });

  it('mounts inside an r3f Canvas without throwing', () => {
    expect(() =>
      render(
        <Canvas>
          <FlowBeam
            from={[0, 22, 0]}
            to={[30, 22, 10]}
            colorSource={new THREE.Color('#7df9ff')}
            colorTarget={new THREE.Color('#f0abfc')}
            style={STYLE}
            seed={12345}
          />
        </Canvas>,
      ),
    ).not.toThrow();
  });

  it('mounts with an intensity ref and phase', () => {
    const intensityRef = { current: 0.5 };
    expect(() =>
      render(
        <Canvas>
          <FlowBeam
            from={[0, 22, 0]}
            to={[-20, 22, -15]}
            colorSource={new THREE.Color('#7df9ff')}
            colorTarget={new THREE.Color('#5fbecb')}
            style={STYLE}
            seed={67890}
            phase={1.2}
            intensityRef={intensityRef}
          />
        </Canvas>,
      ),
    ).not.toThrow();
  });
});

describe('FlowBeam module shape', () => {
  it('exports a default React component', () => {
    expect(typeof FlowBeam).toBe('function');
  });
});
