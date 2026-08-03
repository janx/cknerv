import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  writeSparseScalarAttribute,
} from '../../src/geometry/sparseScalarAttribute';
import {
  markPopulatedBufferUpdate,
} from '../../src/geometry/populatedBufferAttribute';

const SOURCE = readFileSync(
  resolve(process.cwd(), 'src/components/CellNucleus.tsx'),
  'utf8',
);

describe('CellNucleus dynamic attributes', () => {
  it('uploads only a populated prefix and leaves empty batches silent', () => {
    const attribute = new THREE.BufferAttribute(new Float32Array(24), 3)
      .setUsage(THREE.DynamicDrawUsage);

    expect(markPopulatedBufferUpdate(attribute, 9)).toBe(true);
    expect(attribute.updateRanges).toEqual([{ start: 0, count: 9 }]);
    const populatedVersion = attribute.version;

    expect(markPopulatedBufferUpdate(attribute, 0)).toBe(false);
    expect(attribute.updateRanges).toEqual([]);
    expect(attribute.version).toBe(populatedVersion);

    expect(markPopulatedBufferUpdate(attribute, 999)).toBe(true);
    expect(attribute.updateRanges).toEqual([{ start: 0, count: 24 }]);

    const interleaved = new THREE.InstancedInterleavedBuffer(
      new Float32Array(30),
      6,
      1,
    ).setUsage(THREE.DynamicDrawUsage);
    expect(markPopulatedBufferUpdate(interleaved, 12)).toBe(true);
    expect(interleaved.updateRanges).toEqual([{ start: 0, count: 12 }]);
  });

  it('clears, writes, and uploads only changed scalar slots', () => {
    const values = new Float32Array(8);
    values[1] = 0.5;
    values[4] = 0.8;
    const attribute = new THREE.BufferAttribute(values, 1);
    const previousSlots = [1, 4];

    expect(writeSparseScalarAttribute(attribute, previousSlots, [
      { index: 4, value: 0.9 },
      { index: 6, value: 0.7 },
    ])).toBe(true);
    expect(values[1]).toBe(0);
    expect(values[4]).toBeCloseTo(0.9);
    expect(values[6]).toBeCloseTo(0.7);
    expect(previousSlots).toEqual([4, 6]);
    expect(attribute.updateRanges).toEqual([
      { start: 1, count: 1 },
      { start: 4, count: 1 },
      { start: 6, count: 1 },
    ]);
    const version = attribute.version;

    expect(writeSparseScalarAttribute(attribute, previousSlots, [
      { index: 4, value: 0.9 },
      { index: 6, value: 0.7 },
    ])).toBe(false);
    expect(attribute.version).toBe(version);

    expect(writeSparseScalarAttribute(attribute, previousSlots, [])).toBe(true);
    expect(previousSlots).toEqual([]);
    expect(Array.from(values)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('stops full-buffer writes after the focus envelope settles', () => {
    expect(SOURCE).toContain('let focusEnvelopeChanged = false');
    expect(SOURCE).toContain('if (next !== current) focusEnvelopeChanged = true');
    expect(SOURCE).toContain('const focusNeedsWrite = focusEnvelopeChanged');
    expect(SOURCE).toContain('writeSparseScalarAttribute');
    expect(SOURCE).not.toContain('focusPreviouslyActive ||');
    expect(SOURCE).not.toContain('detailArray.fill');
    expect(SOURCE).not.toContain('focusArray.fill');
    expect(SOURCE).not.toContain('recallArray.fill');
  });

  it('streams only populated line and node geometry ranges', () => {
    expect(SOURCE).toContain('setUsage(THREE.DynamicDrawUsage)');
    expect(SOURCE).toContain(
      'const lineFloatCount = writeCursor.lineVertices * 3',
    );
    expect(SOURCE).toContain(
      'markPopulatedBufferUpdate(positionAttribute.data, lineFloatCount)',
    );
    expect(SOURCE).toContain(
      'markPopulatedBufferUpdate(colorAttribute.data, lineFloatCount)',
    );
    expect(SOURCE).toContain(
      'writeCursor.nodes * nodePositionAttribute.itemSize',
    );
    expect(SOURCE).toContain('const committed = committedDrawCounts.current');
    expect(SOURCE).not.toContain(
      'positionAttribute.data.needsUpdate = true',
    );
    expect(SOURCE).not.toContain(
      'colorAttribute.data.needsUpdate = true',
    );
  });
});
