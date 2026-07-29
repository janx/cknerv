import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  makePeerCloudMaterial,
  makePeerHaloMaterial,
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
