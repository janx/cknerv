import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  makePeerCloudMaterial,
  makePeerHaloMaterial,
  peerCloudHitRadius,
  PEER_CLOUD_GHOST_TONE,
  PEER_CLOUD_SIGHTED_DARK_TONE,
  PEER_CLOUD_SIGHTED_TONE,
  type PeerCloudTone,
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

  it('reads the ghost cloud off its own tone', () => {
    const ghost = makePeerCloudMaterial();
    expect(ghost.uniforms.uDim.value).toBe(PEER_CLOUD_GHOST_TONE.dim);
    expect(ghost.uniforms.uSize.value).toBe(PEER_CLOUD_GHOST_TONE.size);
    expect(ghost.uniforms.uEvent.value).toBe(PEER_CLOUD_GHOST_TONE.event);
  });

  it('keeps the ghost stop UNDER the additive clip the sighted stops pass', () => {
    // What the first cut of this axis got wrong: additive blending applies
    // alpha to colour a second time, so one point's resting centre lands at
    // shape^2 * dim^2 (shape at r=0 is core+halo = 1.42). Every stop drove that
    // past 1.0, so all three clipped to the same white-cyan pixel and the
    // gradient existed only in the source — a ghost was indistinguishable from
    // a node you could open. The ghost must rest BELOW the clip.
    const restPeak = (tone: PeerCloudTone): number => (
      1.42 * 1.42 * (tone.dim ?? 0) ** 2
    );
    expect(restPeak(PEER_CLOUD_GHOST_TONE)).toBeLessThan(1);
    expect(restPeak(PEER_CLOUD_SIGHTED_DARK_TONE)).toBeGreaterThan(1);
    expect(restPeak(PEER_CLOUD_SIGHTED_TONE)).toBeGreaterThan(1);
  });

  it('lets the ghost recede at rest without going quiet on a block wave', () => {
    // The haze is faint BECAUSE it is haze, but a block still crosses it at
    // full strength: uDim carries the resting level, uEvent the wave answer.
    expect(PEER_CLOUD_GHOST_TONE.event)
      .toBeGreaterThan(PEER_CLOUD_GHOST_TONE.dim);
    const ghost = makePeerCloudMaterial();
    expect(ghost.fragmentShader).toContain('uDim * uContextEnergy');
    expect(ghost.fragmentShader).toContain('uEvent,');
    expect(ghost.fragmentShader).toContain('float passiveShape = shape * restScale');

    // A stop that never separates them behaves exactly as it always did.
    const sighted = makePeerCloudMaterial(undefined, PEER_CLOUD_SIGHTED_TONE);
    expect(sighted.uniforms.uEvent.value).toBe(PEER_CLOUD_SIGHTED_TONE.dim);
  });

  it('sizes a sprite in world units, projected like everything else', () => {
    // A hard-coded pixel scale drifts with display density and window height,
    // so the mark and any pick target derived from it could never hold the
    // same size. uSize is a world DIAMETER; hit radius is simply half of it.
    const ghost = makePeerCloudMaterial();
    expect(ghost.vertexShader).toContain('uViewportHeight');
    expect(ghost.vertexShader).toContain('projectionMatrix[1][1]');
    expect(ghost.vertexShader).not.toContain('300.0');

    expect(peerCloudHitRadius(PEER_CLOUD_SIGHTED_TONE))
      .toBe(PEER_CLOUD_SIGHTED_TONE.size / 2);
    expect(peerCloudHitRadius(PEER_CLOUD_SIGHTED_DARK_TONE))
      .toBeLessThan(peerCloudHitRadius(PEER_CLOUD_SIGHTED_TONE));
    // The eye sorts on footprint before brightness, and brightness clips —
    // so the axis has to be legible in size alone: 3x, ghost to reached.
    expect(PEER_CLOUD_SIGHTED_TONE.size)
      .toBeGreaterThanOrEqual(PEER_CLOUD_GHOST_TONE.size * 3);
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
