// `markPopulatedBufferItemSpans` — the update ranges for a buffer where only
// some of the populated prefix moved. The counts it is handed are ITEMS (a
// vertex, a node); three's ranges are scalar components, and getting that
// conversion wrong uploads a third of a braid.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  markPopulatedBufferItemSpans,
  type BufferItemSpan,
} from '../../src/geometry/populatedBufferAttribute';

const spans = (...pairs: readonly [number, number][]): BufferItemSpan[] => (
  pairs.map(([start, count]) => ({ start, count }))
);

describe('a buffer whose populated prefix only partly moved', () => {
  it('uploads one range per run of items, in components', () => {
    const attribute = new THREE.BufferAttribute(new Float32Array(120), 3)
      .setUsage(THREE.DynamicDrawUsage);

    expect(markPopulatedBufferItemSpans(attribute, spans([2, 3], [10, 1]), 2, 3)).toBe(true);
    expect(attribute.updateRanges).toEqual([
      { start: 6, count: 9 },
      { start: 30, count: 3 },
    ]);
  });

  it('merges runs that touch or overlap, because one range is one transfer', () => {
    const attribute = new THREE.BufferAttribute(new Float32Array(120), 1);

    expect(markPopulatedBufferItemSpans(
      attribute,
      spans([4, 2], [6, 2], [8, 1], [20, 2]),
      4,
      1,
    )).toBe(true);
    expect(attribute.updateRanges).toEqual([
      { start: 4, count: 5 },
      { start: 20, count: 2 },
    ]);
  });

  it('reads only the spans in use, because the array is a pool', () => {
    const attribute = new THREE.BufferAttribute(new Float32Array(120), 1);
    const pool = spans([1, 1], [50, 1], [90, 1]);

    expect(markPopulatedBufferItemSpans(attribute, pool, 1, 1)).toBe(true);
    expect(attribute.updateRanges).toEqual([{ start: 1, count: 1 }]);
  });

  it('stays silent when nothing moved, so the version does not bump', () => {
    const attribute = new THREE.BufferAttribute(new Float32Array(12), 1);
    expect(markPopulatedBufferItemSpans(attribute, [], 0, 1)).toBe(false);
    const version = attribute.version;
    expect(attribute.updateRanges).toEqual([]);

    expect(markPopulatedBufferItemSpans(attribute, spans([3, 0]), 1, 1)).toBe(false);
    expect(attribute.version).toBe(version);
    expect(attribute.updateRanges).toEqual([]);
  });

  it('clamps a run to the array it is uploading from', () => {
    const attribute = new THREE.BufferAttribute(new Float32Array(12), 3);

    expect(markPopulatedBufferItemSpans(attribute, spans([3, 9]), 1, 3)).toBe(true);
    expect(attribute.updateRanges).toEqual([{ start: 9, count: 3 }]);

    expect(markPopulatedBufferItemSpans(attribute, spans([40, 2]), 1, 3)).toBe(false);
    expect(attribute.updateRanges).toEqual([]);
  });

  it('speaks the interleaved buffer\u2019s language too, which is where the braid lives', () => {
    const interleaved = new THREE.InstancedInterleavedBuffer(
      new Float32Array(60),
      6,
      1,
    ).setUsage(THREE.DynamicDrawUsage);

    // Two braid vertices from the fourth: LineSegmentsGeometry hands its
    // positions array straight through, so the vertex stride here is 3.
    expect(markPopulatedBufferItemSpans(interleaved, spans([4, 2]), 1, 3)).toBe(true);
    expect(interleaved.updateRanges).toEqual([{ start: 12, count: 6 }]);
  });
});
