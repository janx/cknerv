import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  makeCompressionUniforms,
  makeMeasuredPeerHalosMaterial,
  makePeerCloudMaterial,
  makePeerHaloMaterial,
  MEASURED_EVENT_SCALE,
  MEASURED_HOVER_EXTENT,
  MEASURED_HOVER_FOCUS,
  MEASURED_HOVER_MATCH_WU,
  MEASURED_PEER_BRIGHTNESS,
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
import { CELL_HOVER_FOCUS } from '../../src/derives/cellInteraction.derive';
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
    expect(measured.vertexShader).toContain('* (1.0 - uCompressDepth * held)');
    expect(measured.vertexShader).toContain('* extent;');
    expect(measured.vertexShader).not.toContain('* expand;');
    // …and the light concentrates in the fragment by the same envelope. The
    // hover term rides the same product (see the hover test below), so the
    // compression clause is read on its own line.
    expect(measured.fragmentShader).toContain(
      '* (1.0 + uCompressGain * vHeld)',
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

/**
 * One mark's own emitted light, integrated over its footprint.
 *
 * Additive blending applies alpha to colour a second time, so a pixel of a
 * mark contributes `shape(u)² · dim²` and the whole mark contributes that
 * integrated over the disc it draws — which is what a viewer reads as "how
 * much of the frame this thing lights up". Unlike the PEAK it does not clip,
 * which is the whole reason the ladder is measured on it once a stop rests
 * under 1.0. `diameter` is in world units, so the two ends of the ladder are
 * compared at the size they are actually drawn.
 */
function markLight(coreExp: number, dim: number, diameter: number): number {
  const samples = 20_000;
  let integral = 0;
  for (let i = 0; i < samples; i += 1) {
    const u = (i + 0.5) / samples;
    const shape = (1 - u) ** coreExp + 0.42 * (1 - u) ** 1.6;
    integral += shape * shape * 2 * u / samples;
  }
  return dim * dim * (diameter / 2) ** 2 * integral;
}

/** The peak of one mark at rest: `shape(0)² · dim²`, `shape(0) = 1 + 0.42`. */
const restPeak = (dim: number): number => 1.42 * 1.42 * dim * dim;

describe('the measured belt stands in the tissue without clipping', () => {
  it('rests UNDER the additive clip — no white core ⟨rulings 23, 24⟩', () => {
    // The peers are back inside the canopy (`PEER_INNER_RADIUS`), so what
    // keeps them from interfering with the galaxy is their light. D-1 read the
    // twelve measured halos as the ten brightest regions of the idle frame,
    // white cores with pink skirts, five of them standing on tissue: at 1.6
    // the resting centre landed at 5.16 — FIVE times the clip — and a cyan
    // mark that clips is not a bright cyan mark, it is a white one.
    expect(restPeak(MEASURED_PEER_BRIGHTNESS)).toBeLessThan(1);
    // …and it is the LARGEST hundredth that does: 1 / 1.42 = 0.7042, so one
    // step up fails. The constant cannot drift back toward the clip in silence.
    expect(restPeak(MEASURED_PEER_BRIGHTNESS + 0.01)).toBeGreaterThan(1);
    expect(restPeak(1.6)).toBeGreaterThan(5);
    // The shipped GLSL carries the same number, and only there.
    const measured = makeMeasuredPeerHalosMaterial();
    expect(measured.fragmentShader)
      .toContain(`float envelope = ${MEASURED_PEER_BRIGHTNESS.toFixed(1)}`);
    // Nothing at rest can push it back over: both envelopes peak at exactly 1.
    expect(measured.fragmentShader).toContain('(0.85 + 0.15 * sin(');
    expect(measured.fragmentShader).toContain('0.78 + 0.22 * sin(');
  });

  it('stays the top rung on footprint and on total light', () => {
    // ⚠️ The 2026-08-24 round's own finding, and the reason a capped peak does
    // not demote this tier: the eye sorts on FOOTPRINT before brightness, and
    // brightness clips. The measured billboard is 8.4 world units across
    // against the reached stop's 2.0 sprite.
    const colony = readFileSync(
      resolve(process.cwd(), 'src/components/ColonyNodes.tsx'),
      'utf8',
    );
    expect(colony).toContain('const MEASURED_SIZE = 1.4;');
    expect(colony).toContain('new THREE.PlaneGeometry(MEASURED_SIZE * 6, MEASURED_SIZE * 6)');
    const measuredDiameter = 1.4 * 6;
    expect(measuredDiameter / PEER_CLOUD_SIGHTED_TONE.size).toBeGreaterThan(4);

    // …and it emits several times the light of any cloud stop while resting
    // under the clip: measured 0.62 against reached 0.14, dark 0.047, ghost
    // 0.006 — a 4.4x step to the rung below it, wider than any step inside the
    // cloud's own ladder.
    const measured = markLight(4, MEASURED_PEER_BRIGHTNESS, measuredDiameter);
    const reached = markLight(
      PEER_CLOUD_SIGHTED_TONE.coreExp, PEER_CLOUD_SIGHTED_TONE.dim, PEER_CLOUD_SIGHTED_TONE.size,
    );
    const dark = markLight(
      PEER_CLOUD_SIGHTED_DARK_TONE.coreExp, PEER_CLOUD_SIGHTED_DARK_TONE.dim,
      PEER_CLOUD_SIGHTED_DARK_TONE.size,
    );
    const ghost = markLight(2, PEER_CLOUD_GHOST_TONE.dim ?? 0, PEER_CLOUD_GHOST_TONE.size ?? 0);
    expect(measured / reached).toBeGreaterThan(3);
    expect(reached).toBeGreaterThan(dark);
    expect(dark).toBeGreaterThan(ghost);
  });

  it('…and the peak ladder is INVERTED against the sighted stops, on purpose', () => {
    // ⚠️⚠️ The honest half, pinned so nobody has to rediscover it in a
    // screenshot. The two sighted stops rest ABOVE the clip by design (that is
    // what `coreExp` 3.5 exists to make survivable), so a sighted node's
    // centre PIXEL is now brighter than a measured peer's — while the measured
    // mark is four times wider and carries four times the light. Bringing the
    // cloud stops under the clip too is a decision about the whole ladder and
    // is not taken here.
    expect(restPeak(MEASURED_PEER_BRIGHTNESS))
      .toBeLessThan(restPeak(PEER_CLOUD_SIGHTED_TONE.dim));
    expect(restPeak(MEASURED_PEER_BRIGHTNESS))
      .toBeLessThan(restPeak(PEER_CLOUD_SIGHTED_DARK_TONE.dim));
    // It is still above the haze, which is the one stop it must out-rank on
    // every channel there is.
    expect(restPeak(MEASURED_PEER_BRIGHTNESS))
      .toBeGreaterThan(restPeak(PEER_CLOUD_GHOST_TONE.dim ?? 0));
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

// The class of scene target a viewer most often fails to hit — twelve measured
// peers among ~260 unclickable inferred ghosts — was the one class with no
// hover feedback at all: `onPointerOver` published a word for the cursor
// arbitration and nothing else (report E, E-12). A Cell answers a pointer with
// its focus envelope; the belt answers with the same one.
describe('a hovered peer answers', () => {
  it('carries the Cell\'s own hover envelope on one uniform', () => {
    const measured = makeMeasuredPeerHalosMaterial();

    // A position and a flag, not an index: the belt's lanes are re-cut on
    // every roster round and an index does not survive one.
    expect(measured.uniforms.uHover.value).toBeInstanceOf(THREE.Vector4);
    expect(measured.uniforms.uHover.value.w).toBe(0);
    expect(measured.vertexShader).toContain('uniform vec4 uHover;');
    // ⚠️ In the INSTANCE's frame: the colony rotates under its own group, so
    // a world-space compare drifts out of range within a frame of boot.
    expect(measured.vertexShader).toContain('vec4 local = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);');
    expect(measured.vertexShader).toContain('distance(local.xyz, uHover.xyz)');
    expect(measured.vertexShader).not.toContain('distance(origin.xyz, uHover.xyz)');
    expect(measured.vertexShader)
      .toContain(MEASURED_HOVER_MATCH_WU.toFixed(2));
    // …and it reaches the light at the Cell's own hover strength.
    expect(MEASURED_HOVER_FOCUS).toBe(CELL_HOVER_FOCUS);
    expect(measured.fragmentShader).toContain('varying float vHover;');
    expect(measured.fragmentShader).toContain(
      `* (1.0 + ${MEASURED_HOVER_FOCUS.toFixed(2)} * vHover)`,
    );
    // …and the mark grows with it, because the core clips: measured live, a
    // 1.46× intensity moved the mean over the mark 12–16 % and no further.
    expect(measured.vertexShader).toContain(
      `* (1.0 + ${MEASURED_HOVER_EXTENT.toFixed(2)} * vHover)`,
    );
  });

  it('lights one peer and leaves the belt alone', () => {
    // The arithmetic the shader runs, in TypeScript: a hover names ONE
    // position, and every other instance reads zero.
    const hover = { x: 12, y: 22, z: -8, w: 1 };
    const lit = (x: number, y: number, z: number) => hover.w * (
      Math.hypot(x - hover.x, y - hover.y, z - hover.z) < MEASURED_HOVER_MATCH_WU
        ? 1
        : 0
    );

    expect(lit(12, 22, -8)).toBe(1);
    expect(lit(12.1, 22, -8)).toBe(1);
    expect(lit(13, 22, -8)).toBe(0);
    expect(lit(12, 22, 40)).toBe(0);
    hover.w = 0;
    expect(lit(12, 22, -8)).toBe(0);
  });
});
