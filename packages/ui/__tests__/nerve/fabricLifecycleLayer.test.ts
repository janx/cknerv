import { describe, expect, it } from 'vitest';
import type { InterleavedBufferAttribute } from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { neverRaycast } from '../../src/components/CellPopulationField';
import {
  fatLineLayerCapacity,
  makeFatLineLayer,
} from '../../src/nerve/NeuralFabric';
import {
  FABRIC_ALLOCATION_EDGE_CLASSES,
  fabricSegmentAllocation,
} from '../../src/nerve/fabricCapacity';
import {
  FABRIC_LIFE_COLOR_STRIDE,
  FABRIC_LIFE_CURVE_STRIDE,
  FABRIC_LIFE_SCALAR_STRIDE,
} from '../../src/nerve/fabricLifecycleSlots';
import { FABRIC_SLOT_FILLER_Y } from '../../src/nerve/fabricSlots';

const STOCK_LANES = [
  'instanceStart',
  'instanceEnd',
  'instanceColorStart',
  'instanceColorEnd',
] as const;

const SEGMENTS = 32;

describe('fabric lifecycle layer construction', () => {
  it('a lifecycle layer binds the static-record attributes and uniforms', () => {
    const layer = makeFatLineLayer(SEGMENTS, 2.5, 'screen', true, true);
    expect(layer.lifecycle).toBeDefined();
    const expectations: Array<[string, number, number]> = [
      ['fabricCurveFrom', 4, 0],
      ['fabricCurveCtrl', 4, 4],
      ['fabricCurveTo', 4, 8],
      ['fabricColorFrom', 4, 0],
      ['fabricColorTo', 4, 4],
      ['fabricLifecycle', 4, 0],
    ];
    for (const [name, itemSize, offset] of expectations) {
      const attribute = layer.geometry.getAttribute(
        name,
      ) as InterleavedBufferAttribute;
      expect(attribute, name).toBeDefined();
      expect(attribute.itemSize, name).toBe(itemSize);
      expect(attribute.offset, name).toBe(offset);
    }
    expect(layer.lifecycle!.arrays.curve).toHaveLength(
      SEGMENTS * FABRIC_LIFE_CURVE_STRIDE,
    );
    expect(layer.lifecycle!.arrays.color).toHaveLength(
      SEGMENTS * FABRIC_LIFE_COLOR_STRIDE,
    );
    expect(layer.lifecycle!.arrays.scalar).toHaveLength(
      SEGMENTS * FABRIC_LIFE_SCALAR_STRIDE,
    );
    expect(layer.material.uniforms.fabricSimTimeSec).toBeDefined();
    expect(layer.material.vertexShader).toContain('computeFabricLifecycle();');
  });

  it('non-lifecycle layers stay byte-identical to before', () => {
    const layer = makeFatLineLayer(SEGMENTS, 2.5, 'screen', true, false);
    expect(layer.lifecycle).toBeUndefined();
    expect(layer.geometry.getAttribute('fabricCurveFrom')).toBeUndefined();
    expect(layer.material.uniforms.fabricSimTimeSec).toBeUndefined();
    expect(layer.material.vertexShader).not.toContain('computeFabricLifecycle');
  });

  it('lifecycle mode requires the screen-capsule pipeline', () => {
    expect(() => makeFatLineLayer(SEGMENTS, 2.5, 'additive', false, true))
      .toThrow(/screen-capsule/);
  });

  it('binds a one-instance dummy to the stock lanes the patched program strips', () => {
    const layer = makeFatLineLayer(SEGMENTS, 2.5, 'screen', true, true);
    // One parked instance: filler height, zero colour.
    expect(layer.positions).toHaveLength(6);
    expect(layer.colors).toHaveLength(6);
    expect(layer.positions[1]).toBe(FABRIC_SLOT_FILLER_Y);
    expect(layer.positions[4]).toBe(FABRIC_SLOT_FILLER_Y);
    expect(Array.from(layer.colors)).toEqual([0, 0, 0, 0, 0, 0]);
    for (const name of STOCK_LANES) {
      const attribute = layer.geometry.getAttribute(name) as InterleavedBufferAttribute;
      expect(attribute, name).toBeDefined();
      expect(attribute.count, name).toBe(1);
    }
    // The program declares none of them and reads none of them: the stock
    // declarations are stripped and every read replaced, so the linked
    // program has no such active attribute and the dummy is never fetched.
    for (const name of STOCK_LANES) {
      expect(layer.material.vertexShader).not.toMatch(
        new RegExp(`\\b${name}\\b`),
      );
    }
    // Capacity comes from the static records, not the dummy.
    expect(fatLineLayerCapacity(layer)).toBe(SEGMENTS);
    // Render-only, structurally: the stock lanes are a dummy, and nothing in
    // the scene raycasts the fabric.
    expect(layer.mesh.raycast).toBe(neverRaycast);
  });

  it('non-lifecycle layers keep full stock lanes, their capacity and their raycast', () => {
    const layer = makeFatLineLayer(SEGMENTS, 2.5, 'screen', true, false);
    expect(layer.positions).toHaveLength(SEGMENTS * 6);
    expect(layer.colors).toHaveLength(SEGMENTS * 6);
    expect(fatLineLayerCapacity(layer)).toBe(SEGMENTS);
    expect(layer.mesh.raycast).toBe(LineSegments2.prototype.raycast);
    const additive = makeFatLineLayer(SEGMENTS, 1, 'additive');
    expect(fatLineLayerCapacity(additive)).toBe(SEGMENTS);
    expect(additive.positions).toHaveLength(SEGMENTS * 6);
  });

  it('at the default allocation class the dead lanes were 4.6 MB of RAM and as much VRAM', () => {
    const segments = fabricSegmentAllocation(FABRIC_ALLOCATION_EDGE_CLASSES[0]);
    const layer = makeFatLineLayer(segments, 2.5, 'screen', true, true);
    expect(fatLineLayerCapacity(layer)).toBe(segments);
    const stockBytes = layer.positions.byteLength + layer.colors.byteLength;
    expect(stockBytes).toBe(48);
    // What a full-capacity pair cost, and what three uploaded at the first
    // draw for lanes no program read.
    const formerBytes = segments * 6 * Float32Array.BYTES_PER_ELEMENT * 2;
    expect(formerBytes).toBeGreaterThanOrEqual(4_600_000);
  });
});
