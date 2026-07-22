import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  disposeConsensusMemoryKnotMaterial,
  makeConsensusMemoryKnotMaterial,
  makeConsensusMemoryKnotTexture,
} from '../../src/materials/consensusMemoryKnotMaterial';

function alphaAt(texture: THREE.DataTexture, x: number, y: number): number {
  const image = texture.image as { data: Uint8Array; width: number };
  return image.data[(y * image.width + x) * 4 + 3];
}

describe('consensus memory knot material', () => {
  it('cuts away square corners and retains rim plus nucleus energy', () => {
    const texture = makeConsensusMemoryKnotTexture('core');

    expect(alphaAt(texture, 0, 0)).toBe(0);
    expect(alphaAt(texture, 16, 16)).toBeGreaterThan(180);
    expect(alphaAt(texture, 16, 4)).toBeGreaterThan(0);
    texture.dispose();
  });

  it('builds additive vertex-colored point materials with owned textures', () => {
    const material = makeConsensusMemoryKnotMaterial('glow', 0.058, 0.18);
    const texture = material.map;

    expect(material).toBeInstanceOf(THREE.PointsMaterial);
    expect(texture).toBeInstanceOf(THREE.DataTexture);
    expect(material.vertexColors).toBe(true);
    expect(material.blending).toBe(THREE.AdditiveBlending);
    expect(material.depthWrite).toBe(false);
    disposeConsensusMemoryKnotMaterial(material);
  });
});
