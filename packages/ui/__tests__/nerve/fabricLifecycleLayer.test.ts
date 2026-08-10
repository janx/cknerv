import { describe, expect, it } from 'vitest';
import type { InterleavedBufferAttribute } from 'three';
import { makeFatLineLayer } from '../../src/nerve/NeuralFabric';
import {
  FABRIC_LIFE_COLOR_STRIDE,
  FABRIC_LIFE_CURVE_STRIDE,
  FABRIC_LIFE_SCALAR_STRIDE,
} from '../../src/nerve/fabricLifecycleSlots';

const SEGMENTS = 32;

describe('fabric lifecycle layer construction', () => {
  it('a lifecycle layer binds the static-record attributes and uniforms', () => {
    const layer = makeFatLineLayer(SEGMENTS, 2.5, 'screen', true, true, true);
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
    const layer = makeFatLineLayer(SEGMENTS, 2.5, 'screen', true, true, false);
    expect(layer.lifecycle).toBeUndefined();
    expect(layer.geometry.getAttribute('fabricCurveFrom')).toBeUndefined();
    expect(layer.material.uniforms.fabricSimTimeSec).toBeUndefined();
    expect(layer.material.vertexShader).not.toContain('computeFabricLifecycle');
  });

  it('lifecycle mode requires the screen-capsule pipeline', () => {
    expect(() => makeFatLineLayer(SEGMENTS, 2.5, 'additive', false, false, true))
      .toThrow(/screen-capsule/);
  });
});
