import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { makeCourierPlumeTexture, makeCourierBloomTexture } from '../../src/materials/courierFlameTexture';

describe('courier flame textures', () => {
  it('makeCourierBloomTexture returns a CanvasTexture', () => {
    const t = makeCourierBloomTexture();
    expect(t).toBeInstanceOf(THREE.CanvasTexture);
    expect(t.minFilter).toBe(THREE.LinearFilter);
    expect(t.colorSpace).toBe(THREE.SRGBColorSpace);
  });
  it('makeCourierPlumeTexture returns a CanvasTexture', () => {
    const t = makeCourierPlumeTexture();
    expect(t).toBeInstanceOf(THREE.CanvasTexture);
    expect(t.magFilter).toBe(THREE.LinearFilter);
    expect(t.colorSpace).toBe(THREE.SRGBColorSpace);
  });
});
