import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import {
  makeCarrierCoreTexture,
  makeCarrierTrailTexture,
} from '../../src/materials/deliveryTextures';

const textureSource = readFileSync(
  resolve(process.cwd(), 'src/materials/deliveryTextures.ts'),
  'utf8',
);

describe('deliveryTextures', () => {
  it('bakes one compact core for both the travelling glyph and the contact', () => {
    const texture = makeCarrierCoreTexture();
    expect(texture).toBeInstanceOf(THREE.Texture);
    expect((texture.image as HTMLCanvasElement).width).toBe(128);
    expect((texture.image as HTMLCanvasElement).height).toBe(128);
    texture.dispose();
  });

  it('bakes a hard tapered travel streak, not a waving tentacle set', () => {
    const texture = makeCarrierTrailTexture();
    expect(texture).toBeInstanceOf(THREE.Texture);
    expect((texture.image as HTMLCanvasElement).width).toBe(64);
    expect((texture.image as HTMLCanvasElement).height).toBe(256);
    // Per-row fills are what keep the streak's long edges hard; a gradient
    // along the bar would smear it back into a plume.
    expect(textureSource).toContain('ctx.fillRect(centre - halfSpan, row');
    texture.dispose();
  });

  it('leaves every silhouette to geometry and the shader', () => {
    // Rings, polygons and crests all moved to protocolCarrier/contactWaveMaterial:
    // a baked ring cannot stay sharp once a front grows past a few world units.
    expect(textureSource).not.toContain('strokeSegmentedRing');
    expect(textureSource).not.toContain('strokeFluidLoop');
    expect(textureSource).not.toContain('strokeRegularPolygon');
    expect(textureSource).not.toMatch(/A\.T\.-Field|octagon/i);
    expect(textureSource).not.toMatch(/jellyfish|tentacle|bell/i);
  });
});
