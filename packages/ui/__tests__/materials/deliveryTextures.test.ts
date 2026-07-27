import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  makeBolusBloomTexture,
  makeProtocolCarrierTexture,
  makeIngestFlashTexture,
  makeBolusTrailTexture,
} from '../../src/materials/deliveryTextures';

describe('deliveryTextures', () => {
  it('bakes the screen-space woven carrier texture', () => {
    expect(makeProtocolCarrierTexture()).toBeInstanceOf(THREE.Texture);
  });
  it('keeps the legacy bloom export mapped to the woven carrier', () => {
    expect(makeBolusBloomTexture()).toBeInstanceOf(THREE.Texture);
  });
  it('bakes an ingest flash texture', () => {
    expect(makeIngestFlashTexture()).toBeInstanceOf(THREE.Texture);
  });
  it('bakes the segmented three-rail carrier trace', () => {
    expect(makeBolusTrailTexture()).toBeInstanceOf(THREE.Texture);
  });
});
