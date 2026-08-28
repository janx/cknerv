import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  makeCompressionUniforms,
  makeMeasuredPeerHalosMaterial,
  makePeerCloudMaterial,
  makePeerHaloMaterial,
  MEASURED_EVENT_SCALE,
  PEER_COMPRESSION_GLSL,
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
import { makeHaloMaterial } from '../../src/components/GlowNode';
import { BEAM_CHARGE_DUR_S } from '../../src/ui/topologyConstants';
import {
  COMPRESS_DEPTH,
  COMPRESS_GAIN,
  COMPRESS_RELEASE_S,
  PEER_LAUNCH_SENTINEL,
} from '../../src/derives/peers.derive';

/** The six arguments of the ONE call a fragment makes into the shared
 *  response: (baseColor, shape, halo, passiveEnergy, eventScale, restScale). */
function responseCallArgs(fragment: string): string[] {
  const call = fragment.match(/vec4 signal = peerShockwaveResponse\(([^)]*)\)/);
  expect(call).not.toBeNull();
  return call![1].split(',').map((arg) => arg.trim());
}

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

  it('pulls the bright plateau in on every stop that passes the clip', () => {
    // Passing the additive clip is what a sighted stop is FOR; resting on a
    // plateau of it is what made the first sighted cut read as a flat disc.
    // The bright zone ends where the radial profile crosses 1/dim, so once a
    // stop rests above 1.0 the only lever left is the core exponent —
    // brightness cannot shrink a plateau, it clips. Both sighted stops
    // therefore run a TIGHTER core than the haze's soft default.
    const restPeak = (tone: PeerCloudTone): number => (
      1.42 * 1.42 * (tone.dim ?? 0) ** 2
    );
    const ghostCoreExp = makePeerCloudMaterial().uniforms.uCoreExp.value;
    for (const tone of [PEER_CLOUD_SIGHTED_DARK_TONE, PEER_CLOUD_SIGHTED_TONE]) {
      expect(restPeak(tone)).toBeGreaterThan(1);
      expect(tone.coreExp).toBeGreaterThanOrEqual(3);
      expect(tone.coreExp).toBeGreaterThan(ghostCoreExp);
    }
    // The haze rests under the clip, so it has no plateau to pull in and keeps
    // the soft profile — which is also the fallback every tone inherits.
    expect(ghostCoreExp).toBe(2);
  });

  it('falls back to the soft core for any tone that does not ask', () => {
    // `coreExp` is the one tone field with no ghost-stop counterpart to read:
    // omitting it must mean "the soft profile", not "undefined" reaching GLSL.
    const untuned = makePeerCloudMaterial(undefined, { dim: 1.1, size: 1.2 });
    expect(untuned.uniforms.uCoreExp.value).toBe(2);
    expect(PEER_CLOUD_GHOST_TONE).not.toHaveProperty('coreExp');
  });

  it('carries the core exponent on a uniform the shader actually reads', () => {
    // A tone that ever became per-point would spend a vertex-attribute slot the
    // scene cannot pay, so the exponent has to reach the fragment stage as a
    // uniform — and the shader has to consume it, not a baked literal.
    const sighted = makePeerCloudMaterial(undefined, PEER_CLOUD_SIGHTED_TONE);
    expect(sighted.uniforms.uCoreExp.value).toBe(PEER_CLOUD_SIGHTED_TONE.coreExp);
    expect(sighted.fragmentShader).toContain('uniform float uCoreExp;');
    expect(sighted.fragmentShader).toContain('pow(1.0 - r, uCoreExp)');
    expect(sighted.fragmentShader).not.toContain('pow(1.0 - r, 2.0)');
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

describe('the held breath', () => {
  it('runs the GLSL twin of peerCompression, injected from the derive\'s own constants', () => {
    expect(PEER_COMPRESSION_GLSL).toContain('float peerCompressionGl(float dt)');
    // The charge window IS the delivery timeline's, and the release is the
    // derive's: neither number is typed in the shader.
    expect(PEER_COMPRESSION_GLSL).toContain(
      `(dt + ${BEAM_CHARGE_DUR_S.toFixed(2)}) / ${BEAM_CHARGE_DUR_S.toFixed(2)}`,
    );
    expect(PEER_COMPRESSION_GLSL).toContain(`dt / ${COMPRESS_RELEASE_S.toFixed(2)}`);
    // Structurally the mirror, line for line: a clamped smoothstep on each
    // side of the launch, selected by the sign of dt.
    expect(PEER_COMPRESSION_GLSL).toContain('float charge = smoothstep(');
    expect(PEER_COMPRESSION_GLSL).toContain('float release = 1.0 - smoothstep(0.0, 1.0,');
    expect(PEER_COMPRESSION_GLSL).toContain('return dt < 0.0 ? charge : release;');
    // …and its two multipliers seed from the same authority.
    expect(makeCompressionUniforms()).toEqual({
      uCompressDepth: { value: COMPRESS_DEPTH },
      uCompressGain: { value: COMPRESS_GAIN },
    });
  });

  it('gives every measured halo its own launch lane — one instanced float, sentinel at rest', () => {
    const measured = makeMeasuredPeerHalosMaterial();
    expect(measured.vertexShader).toContain('attribute float aPeerLaunchAt;');
    expect(measured.vertexShader).toContain(PEER_COMPRESSION_GLSL);
    expect(measured.vertexShader).toContain('float held = peerCompressionGl(uTime - aPeerLaunchAt);');
    // The extent draws in ON the wave's size boost, never instead of it: a
    // wave may still be crossing the peer as its hop goes.
    expect(measured.vertexShader).toContain(
      'float expand = 1.0 + min(1.0, vShockwave) * uShockwaveSizeBoost;',
    );
    expect(measured.vertexShader).toContain('float extent = expand * (1.0 - uCompressDepth * held);');
    expect(measured.vertexShader).toContain('* extent;');
    expect(measured.vertexShader).not.toContain('* expand;');
    // …and the light concentrates in the fragment by the same envelope.
    expect(measured.fragmentShader).toContain(
      'float intensity = envelope * breathe * (1.0 + uCompressGain * vHeld);',
    );
    expect(measured.uniforms.uCompressDepth.value).toBe(COMPRESS_DEPTH);
    expect(measured.uniforms.uCompressGain.value).toBe(COMPRESS_GAIN);
    expect(PEER_LAUNCH_SENTINEL).toBe(-1e9);
  });

  it('the anchor halo breathes in with the same shape, from a uniform, and only when a launch is scheduled', () => {
    const anchor = makeHaloMaterial({ edge: '#8ff', halo: '#8ff', fill: '#014' });
    expect(anchor.uniforms.uLaunchAt.value).toBe(PEER_LAUNCH_SENTINEL);
    expect(anchor.uniforms.uCompressDepth.value).toBe(COMPRESS_DEPTH);
    expect(anchor.uniforms.uCompressGain.value).toBe(COMPRESS_GAIN);
    // ONE definition of the envelope reaches both materials, verbatim.
    expect(anchor.vertexShader).toContain(PEER_COMPRESSION_GLSL);
    expect(anchor.vertexShader).toContain('float held = peerCompressionGl(uTime - uLaunchAt);');
    expect(anchor.vertexShader).toContain('vec3 drawn = position * (1.0 - uCompressDepth * held);');
    expect(anchor.fragmentShader).toContain('* (1.0 + uCompressGain * vHeld)');
    // The anchor is one quad: its launch rides a uniform, never an attribute.
    expect(anchor.vertexShader.match(/^\s*attribute\s/gm)).toBeNull();
  });

  it('leaves the clouds and the single-peer halo without a breath: only a deliverer compresses', () => {
    const ghost = makePeerCloudMaterial();
    const sighted = makePeerCloudMaterial(undefined, PEER_CLOUD_SIGHTED_TONE);
    const single = makePeerHaloMaterial('#7df9ff');
    for (const material of [ghost, sighted, single]) {
      expect(material.vertexShader).not.toContain('peerCompressionGl');
      expect(material.fragmentShader).not.toContain('uCompressGain');
      expect(material.uniforms).not.toHaveProperty('uCompressDepth');
      expect(material.uniforms).not.toHaveProperty('uLaunchAt');
    }
  });
});

describe('the measured event trim', () => {
  it('scales the measured belt\'s answer to a wave by MEASURED_EVENT_SCALE — the event term, and nothing else', () => {
    expect(MEASURED_EVENT_SCALE).toBe(0.6);
    const scale = MEASURED_EVENT_SCALE.toFixed(2);
    const measured = makeMeasuredPeerHalosMaterial();
    const args = responseCallArgs(measured.fragmentShader);
    expect(args).toHaveLength(6);
    // (baseColor, shape, halo, passiveEnergy, eventScale, restScale): the
    // resting light — colour AND alpha — is exactly what it was.
    expect(args[3]).toBe('intensity * contextEnergy');
    expect(args[4]).toBe(`intensity * ${scale}`);
    expect(args[5]).toBe('intensity');
    expect(measured.fragmentShader.match(/\* 0\.60/g)).toHaveLength(1);
    // The wave's size boost in the vertex stage is not part of the trim.
    expect(measured.vertexShader).toContain('min(1.0, vShockwave) * uShockwaveSizeBoost');
    expect(measured.vertexShader).not.toContain(`* ${scale}`);
  });

  it('is the measured material\'s alone: the clouds keep their tuning', () => {
    const scale = `* ${MEASURED_EVENT_SCALE.toFixed(2)}`;
    const ghost = makePeerCloudMaterial();
    const sighted = makePeerCloudMaterial(undefined, PEER_CLOUD_SIGHTED_TONE);
    const single = makePeerHaloMaterial('#7df9ff');
    expect(ghost.fragmentShader).not.toContain(scale);
    expect(sighted.fragmentShader).not.toContain(scale);
    expect(single.fragmentShader).not.toContain(scale);
    expect(responseCallArgs(ghost.fragmentShader)[4]).toBe('uEvent');
    expect(responseCallArgs(sighted.fragmentShader)[4]).toBe('uEvent');
    expect(responseCallArgs(single.fragmentShader)[4]).toBe('intensity');
  });
});
