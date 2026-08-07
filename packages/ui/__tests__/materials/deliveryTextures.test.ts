import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  makeBolusBloomTexture,
  makeProtocolCarrierTexture,
  makeIngestFlashTexture,
  makeBolusTrailTexture,
  makeJellyfishWakeTexture,
  JELLYFISH_TENTACLE_COUNT,
  JELLYFISH_TENTACLE_SEGMENTS,
} from '../../src/materials/deliveryTextures';

describe('deliveryTextures', () => {
  it('bakes the screen-space octagonal energy-field membrane', () => {
    const texture = makeProtocolCarrierTexture();
    expect(texture).toBeInstanceOf(THREE.Texture);
    expect((texture.image as HTMLCanvasElement).width).toBe(192);
    texture.dispose();
  });
  it('keeps the legacy bloom export mapped to the octagonal carrier', () => {
    const texture = makeBolusBloomTexture();
    expect(texture).toBeInstanceOf(THREE.Texture);
    expect((texture.image as HTMLCanvasElement).height).toBe(192);
    texture.dispose();
  });
  it('bakes an ingest flash texture', () => {
    const texture = makeIngestFlashTexture();
    expect(texture).toBeInstanceOf(THREE.Texture);
    expect((texture.image as HTMLCanvasElement).width).toBe(128);
    texture.dispose();
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
