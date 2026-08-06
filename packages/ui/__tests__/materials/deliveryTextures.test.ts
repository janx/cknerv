import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  makeBolusBloomTexture,
  makeProtocolCarrierTexture,
  makeIngestFlashTexture,
  makeBolusTrailTexture,
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
  it('bakes the segmented ember wake with field fragments', () => {
    const texture = makeBolusTrailTexture();
    expect(texture).toBeInstanceOf(THREE.Texture);
    expect((texture.image as HTMLCanvasElement).height).toBe(256);
    texture.dispose();
  });
});
