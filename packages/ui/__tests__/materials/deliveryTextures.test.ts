import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import {
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
  it('bakes a soft organic jellyfish membrane with no polygon-field helper', () => {
    const texture = makeJellyfishBellTexture();
    expect(texture).toBeInstanceOf(THREE.Texture);
    expect((texture.image as HTMLCanvasElement).width).toBe(192);
    expect(textureSource).toContain('strokeFluidLoop');
    expect(textureSource).not.toContain('strokeRegularPolygon');
    expect(textureSource).not.toMatch(/A\.T\.-Field|octagon/i);
    texture.dispose();
  });

  it('keeps both legacy bell exports mapped to the organic membrane', () => {
    const textures = [makeProtocolCarrierTexture(), makeBolusBloomTexture()];
    for (const texture of textures) {
      expect(texture).toBeInstanceOf(THREE.Texture);
      expect((texture.image as HTMLCanvasElement).height).toBe(192);
      texture.dispose();
    }
  });

  it('bakes a circular shockwave for propulsion and Cell-field contact', () => {
    const textures = [makeIngestShockwaveTexture(), makeIngestFlashTexture()];
    for (const texture of textures) {
      expect(texture).toBeInstanceOf(THREE.Texture);
      expect((texture.image as HTMLCanvasElement).width).toBe(128);
      texture.dispose();
    }
  });

  it('bakes a five-tentacle jellyfish wake', () => {
    const texture = makeJellyfishWakeTexture();
    expect(texture).toBeInstanceOf(THREE.Texture);
    expect((texture.image as HTMLCanvasElement).width).toBe(128);
    expect((texture.image as HTMLCanvasElement).height).toBe(256);
    expect(JELLYFISH_TENTACLE_COUNT).toBe(5);
    expect(JELLYFISH_TENTACLE_SEGMENTS).toBe(14);
    texture.dispose();
  });

  it('keeps the legacy trail export mapped to the jellyfish wake', () => {
    const texture = makeBolusTrailTexture();
    expect(texture).toBeInstanceOf(THREE.Texture);
    expect((texture.image as HTMLCanvasElement).width).toBe(128);
    texture.dispose();
  });
});
