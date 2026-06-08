import { describe, expect, it, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';
import CrystalGlow from '../../src/components/CrystalGlow';
import { resetSimClock } from '../../src/tweaks/simClock';

describe('CrystalGlow mount', () => {
  beforeEach(() => {
    resetSimClock();
  });

  it('mounts inside an r3f Canvas without throwing', () => {
    const geom = new THREE.OctahedronGeometry(1, 0);
    expect(() =>
      render(
        <Canvas>
          <CrystalGlow geom={geom} size={1} color="#7df9ff" seed="QmX" />
        </Canvas>,
      ),
    ).not.toThrow();
  });

  it('mounts when selected with an intensity ref', () => {
    const geom = new THREE.OctahedronGeometry(1, 0);
    const intensityRef = { current: 0.5 };
    expect(() =>
      render(
        <Canvas>
          <CrystalGlow
            geom={geom}
            size={1.2}
            color="#f0abfc"
            intensityRef={intensityRef}
            selected
            seed="QmY"
          />
        </Canvas>,
      ),
    ).not.toThrow();
  });
});

describe('CrystalGlow module shape', () => {
  it('exports a default React component', () => {
    expect(typeof CrystalGlow).toBe('function');
  });
});
