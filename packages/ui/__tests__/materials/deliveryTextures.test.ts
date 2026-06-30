import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  makeBolusBloomTexture,
  makeIngestFlashTexture,
  makeBolusTrailTexture,
  makeRingTexture,
} from '../../src/materials/deliveryTextures';

describe('deliveryTextures', () => {
  it('bakes a bolus bloom texture', () => {
    expect(makeBolusBloomTexture()).toBeInstanceOf(THREE.Texture);
  });
  it('bakes an ingest flash texture', () => {
    expect(makeIngestFlashTexture()).toBeInstanceOf(THREE.Texture);
  });
  it('bakes a bolus trail texture', () => {
    expect(makeBolusTrailTexture()).toBeInstanceOf(THREE.Texture);
  });
  it('bakes a shockwave ring texture', () => {
    expect(makeRingTexture()).toBeInstanceOf(THREE.Texture);
  });
});
