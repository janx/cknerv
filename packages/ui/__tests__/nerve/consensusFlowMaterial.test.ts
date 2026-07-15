import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SpikePool } from '../../src/nerve/spikePool';

const SEAL_SRC = readFileSync(
  resolve(process.cwd(), 'src/nerve/DendriticBurst.tsx'),
  'utf8',
);

describe('consensus packet glyph', () => {
  it('uses a procedural data lozenge instead of a biological ion bubble', () => {
    const pool = new SpikePool(4);

    expect(pool.material.fragmentShader).toContain('diamondD');
    expect(pool.material.fragmentShader).toContain('contour');
    expect(pool.material.fragmentShader).toContain('vec3(0.86, 0.96, 1.0)');
    pool.dispose();
  });
});

describe('consensus write seal', () => {
  it('renders counter-rotated interrupted rings, agreement nodes, and a central knot', () => {
    expect(SEAL_SRC).toContain('consensusWriteSealState');
    expect(SEAL_SRC).toContain('outerGate');
    expect(SEAL_SRC).toContain('innerGate');
    expect(SEAL_SRC).toContain('agreements');
    expect(SEAL_SRC).toContain('cellPhase');
    expect(SEAL_SRC).toContain('float knot');
    expect(SEAL_SRC).toContain('memoryFloorPx');
    expect(SEAL_SRC).toContain('vMemory * 0.72');
    expect(SEAL_SRC).not.toContain('CanvasTexture');
    expect(SEAL_SRC).not.toContain('calcium');
  });
});
