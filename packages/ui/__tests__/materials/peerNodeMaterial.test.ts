import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  makePeerCloudMaterial,
  makePeerHaloMaterial,
  PEER_CLOUD_GHOST_TONE,
  PEER_CLOUD_SIGHTED_DARK_TONE,
  PEER_CLOUD_SIGHTED_TONE,
} from '../../src/materials/peerNodeMaterial';
import {
  makeShockwaveUniforms,
  SHOCKWAVE_SLOTS,
} from '../../src/materials/shockwaveMaterial';

describe('peer node shockwave materials', () => {
  it('shares one in-flight wave ring across inferred and measured nodes', () => {
    const wave = makeShockwaveUniforms();
    const cloud = makePeerCloudMaterial(wave);
    const halo = makePeerHaloMaterial('#7df9ff', wave);

    expect(cloud).toBeInstanceOf(THREE.ShaderMaterial);
    expect(halo).toBeInstanceOf(THREE.ShaderMaterial);
    expect(cloud.uniforms.uShockwaveAt).toBe(wave.uShockwaveAt);
    expect(halo.uniforms.uShockwaveAt).toBe(wave.uShockwaveAt);
    expect(cloud.uniforms.uShockwaveAt.value).toHaveLength(SHOCKWAVE_SLOTS);
    expect(halo.uniforms.uShockwaveColor.value)
      .toBe(cloud.uniforms.uShockwaveColor.value);
  });

  it('samples the wave at existing peer-node world positions', () => {
    const cloud = makePeerCloudMaterial();
    const halo = makePeerHaloMaterial('#7df9ff');

    expect(cloud.vertexShader).toContain(
      'vec4 world = modelMatrix * vec4(position, 1.0)',
    );
    expect(cloud.vertexShader).toContain('shockwaveSignalAt(world.xz)');
    expect(halo.vertexShader).toContain(
      'vec4 center = modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)',
    );
    expect(halo.vertexShader).toContain('shockwaveSignalAt(center.xz)');
    expect(cloud.vertexShader).toContain('uShockwaveSizeBoost');
    expect(halo.vertexShader).toContain('uShockwaveSizeBoost');
  });

  it('subdues passive context without weakening a real block wave', () => {
    const cloud = makePeerCloudMaterial();

    expect(cloud.fragmentShader).toContain('uDim * uContextEnergy');
    expect(cloud.fragmentShader).toContain(
      'shape * alphaExtra * eventScale',
    );
    expect(cloud.fragmentShader).not.toContain(
      'alphaExtra * eventScale * uContextEnergy',
    );
    expect(cloud.fragmentShader).toContain('vShockwaveCarrier / shock');
  });
});

describe('peer cloud tones (the confidence axis)', () => {
  it('carries the sighted tier on uniforms — never a vertex attribute', () => {
    const ghost = makePeerCloudMaterial();
    const sighted = makePeerCloudMaterial(undefined, PEER_CLOUD_SIGHTED_TONE);
    const remembered = makePeerCloudMaterial(undefined, PEER_CLOUD_SIGHTED_DARK_TONE);

    // ⚠️ The vertex-attribute budget sits at a known cliff: one shader source
    // for all three tones, and it declares NO attributes of its own. A tone
    // that ever becomes per-point would spend a slot the scene cannot pay.
    expect(sighted.vertexShader).toBe(ghost.vertexShader);
    expect(remembered.vertexShader).toBe(ghost.vertexShader);
    expect(sighted.fragmentShader).toBe(ghost.fragmentShader);
    expect(ghost.vertexShader.match(/^\s*attribute\s/gm)).toBeNull();

    // Three stops on ONE axis, faintest first — a sighted node reads as the
    // same kind of thing, better known.
    expect(ghost.uniforms.uDim.value).toBeLessThan(remembered.uniforms.uDim.value);
    expect(remembered.uniforms.uDim.value).toBeLessThan(sighted.uniforms.uDim.value);
    expect(ghost.uniforms.uSize.value).toBeLessThan(remembered.uniforms.uSize.value);
    expect(remembered.uniforms.uSize.value).toBeLessThan(sighted.uniforms.uSize.value);
    // …same cyan family: brightness is the whole distinction.
    expect(sighted.uniforms.uColor.value.getHex())
      .toBe(ghost.uniforms.uColor.value.getHex());
    expect(remembered.uniforms.uColor.value.getHex())
      .toBe(ghost.uniforms.uColor.value.getHex());
  });

  it('leaves the ghost cloud exactly where it was', () => {
    const ghost = makePeerCloudMaterial();
    expect(ghost.uniforms.uDim.value).toBe(PEER_CLOUD_GHOST_TONE.dim);
    expect(ghost.uniforms.uSize.value).toBe(PEER_CLOUD_GHOST_TONE.size);
    expect(PEER_CLOUD_GHOST_TONE).toEqual({ dim: 0.9, size: 5.5 });
  });

  it('shares one in-flight wave and the same context damping as the ghosts', () => {
    const wave = makeShockwaveUniforms();
    const sighted = makePeerCloudMaterial(wave, PEER_CLOUD_SIGHTED_TONE);
    expect(sighted.uniforms.uShockwaveAt).toBe(wave.uShockwaveAt);
    expect(sighted.uniforms.uShockwaveColor.value).toBe(wave.uShockwaveColor.value);
    expect(sighted.uniforms.uContextEnergy.value).toBe(1);
    expect(sighted.blending).toBe(THREE.AdditiveBlending);
    expect(sighted.depthWrite).toBe(false);
  });
});
