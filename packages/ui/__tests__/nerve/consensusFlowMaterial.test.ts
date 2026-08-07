import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { BufferAttribute } from 'three';
import { describe, expect, it } from 'vitest';
import { SpikePool } from '../../src/nerve/spikePool';

const SEAL_SRC = readFileSync(
  resolve(process.cwd(), 'src/nerve/DendriticBurst.tsx'),
  'utf8',
);

describe('consensus packet glyph', () => {
  it('separates the live data lozenge from the round historical phase knot', () => {
    const pool = new SpikePool(4);

    expect(pool.material.fragmentShader).toContain('diamondD');
    expect(pool.material.fragmentShader).toContain('phaseRingA');
    expect(pool.material.fragmentShader).toContain('phaseRingB');
    expect(pool.material.vertexShader).toContain('aGlyphMode');
    expect(pool.material.fragmentShader).toContain('vec3(0.86, 0.96, 1.0)');

    const slot = {
      position: [0, 0, 0] as [number, number, number],
      color: [0.4, 0.2, 1] as [number, number, number],
      size: 1,
      alpha: 1,
      whiteBias: 0.5,
    };
    pool.beginFrame();
    pool.push({ ...slot, glyph: 'packet' });
    pool.pushValues(0, 0, 0, slot.color, 1, 1, 0.5, 'memory');
    pool.endFrame(900, 1);
    const glyphs = pool.mesh.geometry.getAttribute('aGlyphMode').array;
    expect(Array.from(glyphs.slice(0, 2))).toEqual([0, 1]);
    pool.dispose();
  });

  it('skips idle uploads and limits active uploads to written slots', () => {
    const pool = new SpikePool(8);
    const geometry = pool.mesh.geometry;
    const attributes: BufferAttribute[] = [
      geometry.getAttribute('position'),
      geometry.getAttribute('aColor'),
      geometry.getAttribute('aSize'),
      geometry.getAttribute('aAlpha'),
      geometry.getAttribute('aWhiteBias'),
      geometry.getAttribute('aGlyphMode'),
    ] as BufferAttribute[];

    pool.beginFrame();
    pool.endFrame(900, 1);
    expect(attributes.map(({ version }) => version)).toEqual([0, 0, 0, 0, 0, 0]);

    const slot = {
      position: [0, 0, 0] as [number, number, number],
      color: [0.4, 0.2, 1] as [number, number, number],
      size: 1,
      alpha: 1,
      whiteBias: 0.5,
      glyph: 'packet' as const,
    };
    pool.beginFrame();
    pool.push(slot);
    pool.push(slot);
    pool.endFrame(900, 1);
    expect(geometry.drawRange.count).toBe(2);
    expect(attributes.map(({ version }) => version)).toEqual([1, 1, 1, 1, 1, 1]);
    expect(attributes[0].updateRanges).toEqual([{ start: 0, count: 6 }]);
    expect(attributes[2].updateRanges).toEqual([{ start: 0, count: 2 }]);

    pool.beginFrame();
    pool.endFrame(900, 1);
    expect(geometry.drawRange.count).toBe(0);
    expect(attributes.map(({ version }) => version)).toEqual([1, 1, 1, 1, 1, 1]);
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
    expect(SEAL_SRC).toContain('drainConsensusWriteSealArrivals');
    expect(SEAL_SRC).toContain('if (slots.length === 0)');
    expect(SEAL_SRC).not.toContain('lastSeenRef');
    expect(SEAL_SRC).not.toContain('slotsRef.current = slotsRef.current.filter');
    expect(SEAL_SRC).not.toContain('CanvasTexture');
    expect(SEAL_SRC).not.toContain('calcium');
  });
});
