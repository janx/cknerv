import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import {
  GEOMETRIC_SHOCKWAVE_GAPS,
  GEOMETRIC_SHOCKWAVE_SIDES,
  makeBolusBloomTexture,
  makeJellyfishBellTexture,
  makeProtocolCarrierTexture,
  makeIngestFlashTexture,
  makeIngestShockwaveTexture,
  makeBolusTrailTexture,
  makeJellyfishWakeTexture,
  JELLYFISH_TENTACLE_COUNT,
  JELLYFISH_TENTACLE_SEGMENTS,
} from '../../src/materials/deliveryTextures';

const textureSource = readFileSync(
  resolve(process.cwd(), 'src/materials/deliveryTextures.ts'),
  'utf8',
);

describe('deliveryTextures', () => {
  it('keeps the low-poly silhouette in geometry and the membrane unmarked', () => {
    const texture = makeJellyfishBellTexture();
    expect(texture).toBeInstanceOf(THREE.Texture);
    expect((texture.image as HTMLCanvasElement).width).toBe(128);
    expect(textureSource).not.toContain('strokeFluidLoop');
    expect(textureSource).not.toContain('strokeFluidArc');
    expect(textureSource).not.toContain('strokeRegularPolygon');
    expect(textureSource).not.toMatch(/A\.T\.-Field|octagon/i);
    texture.dispose();
  });

  it('keeps both legacy bell exports mapped to the unmarked membrane', () => {
    const textures = [makeProtocolCarrierTexture(), makeBolusBloomTexture()];
    for (const texture of textures) {
      expect(texture).toBeInstanceOf(THREE.Texture);
      expect((texture.image as HTMLCanvasElement).height).toBe(128);
      texture.dispose();
    }
  });

  it('bakes one segmented shockwave for propulsion and Cell-field contact', () => {
    const textures = [makeIngestShockwaveTexture(), makeIngestFlashTexture()];
    for (const texture of textures) {
      expect(texture).toBeInstanceOf(THREE.Texture);
      expect((texture.image as HTMLCanvasElement).width).toBe(128);
      texture.dispose();
    }
    expect(GEOMETRIC_SHOCKWAVE_SIDES).toBe(12);
    expect(GEOMETRIC_SHOCKWAVE_GAPS).toBe(3);
  });

  it('bakes a three-tentacle geometric jellyfish wake', () => {
    const texture = makeJellyfishWakeTexture();
    expect(texture).toBeInstanceOf(THREE.Texture);
    expect((texture.image as HTMLCanvasElement).width).toBe(128);
    expect((texture.image as HTMLCanvasElement).height).toBe(256);
    expect(JELLYFISH_TENTACLE_COUNT).toBe(3);
    expect(JELLYFISH_TENTACLE_SEGMENTS).toBe(6);
    texture.dispose();
  });

  it('keeps the legacy trail export mapped to the jellyfish wake', () => {
    const texture = makeBolusTrailTexture();
    expect(texture).toBeInstanceOf(THREE.Texture);
    expect((texture.image as HTMLCanvasElement).width).toBe(128);
    texture.dispose();
  });
});
