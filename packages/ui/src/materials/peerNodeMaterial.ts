import * as THREE from 'three';
import {
  makeShockwaveUniforms,
  SHOCKWAVE_SIGNAL_GLSL,
  SHOCKWAVE_UNIFORMS_GLSL,
  type ShockwaveUniforms,
} from './shockwaveMaterial';
import { PEER_NETWORK_PALETTE } from '../visualPalette';
import { BEAM_CHARGE_DUR_S } from '../ui/topologyConstants';
import {
  COMPRESS_DEPTH,
  COMPRESS_GAIN,
  COMPRESS_RELEASE_S,
} from '../derives/peers.derive';
import { CELL_HOVER_FOCUS } from '../derives/cellInteraction.derive';

/**
 * Shared fragment response for the P2P brightness shockwave. Passive context
 * can be subdued during Cell inspection, while a real block event retains its
 * full energy and carrier hue.
 */
const PEER_SHOCKWAVE_RESPONSE_GLSL = /* glsl */ `
  vec4 peerShockwaveResponse(
    vec3 baseColor,
    float shape,
    float halo,
    float passiveEnergy,
    float eventScale,
    float restScale
  ) {
    float shock = vShockwave;
    vec3 waveColor = shock > 0.0001
      ? vShockwaveCarrier / shock
      : vec3(0.72, 0.96, 1.0);
    float colorExtra = uShockwaveColorCeil
      * (1.0 - exp(
        -shock * uShockwaveColorBoost
          / max(uShockwaveColorCeil, 0.001)
      ));
    float alphaExtra = uShockwaveAlphaCeil
      * (1.0 - exp(
        -shock * uShockwaveAlphaBoost
          / max(uShockwaveAlphaCeil, 0.001)
      ));
    vec3 shockTint = mix(
      baseColor,
      waveColor,
      min(1.0, shock * 0.85)
    );
    float wash = halo * shock * uShockwaveTrailBoost * eventScale;
    // restScale is how loudly this draw sits there; eventScale is how loudly
    // it answers a block. They are one number for every caller but the ghost
    // haze, which had to recede at rest without going quiet on a wave.
    float passiveShape = shape * restScale;
    float passive = shape * passiveEnergy;
    float eventAlpha = shape * alphaExtra * eventScale + wash;
    vec3 color = baseColor * passive
      + shockTint * shape * colorExtra * eventScale
      + waveColor * wash;
    // AdditiveBlending applies alpha to RGB again. The passive context weight
    // therefore belongs in color only; retaining the unscaled shape in alpha
    // makes the requested context energy linear and leaves events untouched.
    return vec4(color, passiveShape + eventAlpha);
  }
`;

/**
 * The held breath, in GLSL. A halo about to deliver draws in over the charge
 * window before its hop leaves and lets go over the release after; `dt` is
 * sim seconds past the launch (negative before it), and the sentinel launch
 * resolves to 0 with no branch. Vertex-stage: the caller scales its extent by
 * `1 − uCompressDepth · held` and hands the envelope down as a varying for the
 * `1 + uCompressGain · held` on intensity.
 *
 * Structurally identical, line for line, to `peerCompression` in
 * derives/peers.derive.ts — the tested mirror — and injected from that
 * module's constants, so the two cannot drift.
 */
export const PEER_COMPRESSION_GLSL = /* glsl */ `
  float peerCompressionGl(float dt) {
    float charge = smoothstep(
      0.0, 1.0, (dt + ${BEAM_CHARGE_DUR_S.toFixed(2)}) / ${BEAM_CHARGE_DUR_S.toFixed(2)}
    );
    float release = 1.0 - smoothstep(0.0, 1.0, dt / ${COMPRESS_RELEASE_S.toFixed(2)});
    return dt < 0.0 ? charge : release;
  }
`;

/** The two uniforms the breath rides. Seeded from the derive's constants —
 *  the one authority — and overwritten from `LIVE.delivery.compressDepth /
 *  compressGain` each frame by the owner, exactly as the shockwave knobs are. */
export function makeCompressionUniforms(): {
  uCompressDepth: { value: number };
  uCompressGain: { value: number };
} {
  return {
    uCompressDepth: { value: COMPRESS_DEPTH },
    uCompressGain: { value: COMPRESS_GAIN },
  };
}

function sharedShockwave(
  uniforms?: ShockwaveUniforms,
): ShockwaveUniforms {
  return uniforms ?? makeShockwaveUniforms();
}

/**
 * Where one cloud draw sits on the confidence axis.
 *
 * A node we can name is worth more light than an anonymous one, a node somebody
 * has answered is worth more than one only the gossip names, and a node the
 * crawler could still reach is worth more than one it only remembers — but that
 * is FIVE stops of one gradient, not five visual languages, so the tone rides
 * creation-time UNIFORMS on the shared factory. Splitting it per point would
 * cost a vertex attribute, and the attribute budget has no room to sell.
 */
export interface PeerCloudTone {
  /** Passive brightness (`uDim`); the ghost haze's 0.62 is the floor. */
  dim?: number;
  /**
   * Sprite DIAMETER in world units — the same units the rest of the scene is
   * measured in, so a stop's mark can be handed straight to its pick target
   * (`peerCloudHitRadius`) and neither display density nor window height can
   * drift the two apart.
   */
  size?: number;
  /** How loudly this stop answers a block wave. Defaults to `dim`: only the
   *  ghost haze, which sits far below its own event, ever separates them. */
  event?: number;
  /**
   * Falloff exponent of the sprite's CORE term. Defaults to 2.0 — the ghost
   * haze's soft profile, which is all a stop resting under the additive clip
   * ever needs. A stop that rests ABOVE the clip wants a higher exponent: the
   * bright plateau is bounded by where the profile crosses 1/`dim`, so a
   * tighter core is the only thing that turns a saturated disc back into a
   * nucleus with a skirt. Brightness alone cannot do it — it clips.
   */
  coreExp?: number;
  /** Tint — same cyan family. Defaults to the ghost scaffold hue. */
  color?: readonly [number, number, number];
}

/**
 * The four stops, faintest first. One hue, one axis: a node the crawler named
 * reads as "the same kind of thing, better known", never as a different
 * species. The measured core sits above all four with its own (brighter,
 * tinted) halo.
 *
 * The axis has to survive ADDITIVE blending, which is where the first cut of it
 * failed: every stop drove its core past 1.0, so all of them clipped to the
 * same white-cyan pixel and the gradient existed only in the source. A ghost
 * now rests well under the clip — it is haze, and only a wave lights it — while
 * the stops above it keep both the light AND the footprint the eye actually
 * sorts on. Ghost → reached is 3.08x the diameter and ~4.4x the resting light
 * (which goes as dim SQUARED — additive blending applies alpha to colour).
 *
 * Passing the clip is the point of a sighted stop; sitting on a PLATEAU of it
 * is not, and that was the second cut's mistake. The bright zone ends where the
 * radial profile crosses 1/dim, so the first sighted tone (dim 1.95, soft 2.0
 * core) held its centre 7.7x past the clip and stayed saturated out to 42% of
 * the sprite radius — a flat ~1-world-unit disc that shouted over the twelve
 * real measured peers it is supposed to sit BELOW. Dropping the light a stop
 * and tightening the core to 3.5 confines that plateau to 19%, so the mark
 * reads as a nucleus with a skirt instead of a disc, and the tier keeps its
 * footprint advantage over the haze.
 */
export const PEER_CLOUD_GHOST_TONE = {
  dim: 0.62, size: 0.65, event: 0.9,
} satisfies PeerCloudTone;
/*
 * ⭐⭐ THERE IS NO ATTESTED STOP ON THIS AXIS, AND ITS ABSENCE IS A DECISION.
 * A node the chain proves and nobody can name once drew here, wedged between
 * the invented haze and the faintest named stop. It wears an APERTURE now
 * (`materials/colonyCohort`), and the two could not co-exist: an additive point
 * sprite is brightest at its own centre, which is exactly the pixel the pupil
 * refuses to fill, so keeping the stop would have been arithmetically identical
 * to filling the hole with light.
 *
 * The rung it left behind is on a DIFFERENT AXIS, which is why the ladder below
 * is unchanged rather than re-spaced. These five stops answer "how well do we
 * know this node"; an aperture answers "what does it do", and a mark on the second
 * axis was never a step on the first.
 */
/**
 * Named by the network, answered by nobody — hearsay carrying a real identity.
 *
 * It is the first stop that is REAL and the last that has never been spoken to,
 * so it sits directly above the invented haze and clearly below the pair that
 * mean somebody got a packet back.
 *
 * ⚠️ `size` IS NOT THE MARK, AND THAT IS WHY THIS NUMBER IS NOT THE OBVIOUS ONE.
 * Keeping the ladder of world diameters even (0.65 · 1.05 · 1.5 · 2.0) was the
 * first cut of this stop, and rendered at the default camera it drew a mark a
 * single pixel off the one above it — the two overlapped completely once the
 * colony's depth spread was taken in. What a viewer sees is not the sprite: it
 * is the disc inside it where the radial profile is still above visibility, and
 * the stop above pulls its own core in hard (3.5), throwing away far more of
 * its sprite than the soft default does. So an even ladder of SPRITES is a
 * lopsided ladder of MARKS. 0.85 is what an even ladder of marks costs, and it
 * measured a clean step from the haze and a clean step to the stop above at
 * every viewport it was checked at.
 *
 * ⭐ NO `coreExp`, ON PURPOSE — 2.0 is the default and 2.0 is what this stop
 * wants. The tight 3.5 core exists only to pull IN the saturated plateau of a
 * stop resting well above the additive clip; at dim 0.80 the profile crosses
 * 1/dim at 6.5% of the radius, which at the default camera is narrower than one
 * pixel — the only saturated pixels this stop produced in a rendered count came
 * from two of its marks overlapping, never from one of them alone. Tightening
 * the core here would only shrink the visible mark away from the pick target
 * its sprite defines.
 *
 * `event` is the one field it names rather than inherits. Every other stop is
 * content to answer a block wave as loudly as it rests, but the haze is not —
 * it recedes at rest and keeps 0.9 for the wave — so a stop inheriting 0.80
 * from its own rest would be OUT-SHOUTED by the haze underneath it for the
 * length of every block, on the one axis whose whole job is ordering.
 */
export const PEER_CLOUD_ADVERTISED_TONE = {
  dim: 0.8, size: 0.85, event: 0.95,
} satisfies PeerCloudTone;
/** Named by the crawler, but it could not reach the node this round. */
export const PEER_CLOUD_SIGHTED_DARK_TONE = {
  dim: 1.0, size: 1.5, coreExp: 3.5,
} satisfies PeerCloudTone;
/** Named by the crawler and answering it. */
export const PEER_CLOUD_SIGHTED_TONE = {
  dim: 1.3, size: 2.0, coreExp: 3.5,
} satisfies PeerCloudTone;

/**
 * The pick target for one cloud stop: its own mark, and no more.
 *
 * `size` is a world diameter, so this is the whole conversion — no viewport
 * height, no device pixel ratio, nothing that can drift between what is drawn
 * and what can be clicked. Generosity here is not free: the Cell canopy yields
 * this pixel through NETWORK_PEER_PICK_FLAG, so every pixel a peer target takes
 * beyond its own glow is one stolen from the layer above.
 */
export function peerCloudHitRadius(tone: PeerCloudTone): number {
  return (tone.size ?? PEER_CLOUD_GHOST_TONE.size) / 2;
}

/**
 * One draw for every peer node in a linkless cloud — the inferred ghosts, and
 * (at a brighter `tone`) the sighted nodes the crawler named. The point itself
 * is the topology record; the wave only changes its size/brightness and never
 * emits decorative particles beside it.
 */
export function makePeerCloudMaterial(
  uniforms?: ShockwaveUniforms,
  tone?: PeerCloudTone,
): THREE.ShaderMaterial {
  // No tone IS the ghost stop, whole: reading each field's own fallback
  // instead would have handed the ghost cloud everything but its `event`, and
  // the haze would have gone quiet on exactly the block wave it exists to show.
  const stop: PeerCloudTone = tone ?? PEER_CLOUD_GHOST_TONE;
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uColor: {
        value: new THREE.Color().setRGB(
          ...(stop.color ?? PEER_NETWORK_PALETTE.scaffold),
        ),
      },
      uDim: { value: stop.dim ?? PEER_CLOUD_GHOST_TONE.dim },
      uEvent: { value: stop.event ?? stop.dim ?? PEER_CLOUD_GHOST_TONE.dim },
      uSize: { value: stop.size ?? PEER_CLOUD_GHOST_TONE.size },
      // Not read off the ghost stop like its neighbours: the ghost has no
      // `coreExp` of its own, and 2.0 IS the soft profile it wants. A stop that
      // omits the field is asking for that same profile, whatever it is.
      uCoreExp: { value: stop.coreExp ?? 2.0 },
      // Drawing-buffer height in device pixels; the owner refreshes it, because
      // a resize or a quality-tier DPR change moves it under a live material.
      uViewportHeight: { value: 1080 },
      uContextEnergy: { value: 1 },
      ...sharedShockwave(uniforms),
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uSize;
      uniform float uViewportHeight;
      ${SHOCKWAVE_UNIFORMS_GLSL}

      varying float vShockwave;
      varying vec3 vShockwaveCarrier;

      ${SHOCKWAVE_SIGNAL_GLSL}

      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vec4 wave = shockwaveSignalAt(world.xz);
        vShockwave = wave.a;
        vShockwaveCarrier = wave.rgb;
        vec4 view = viewMatrix * world;
        // uSize is a WORLD diameter, projected the way every other object in
        // the scene is: half the drawing buffer times the projection's own
        // 1/tan(fov/2), over view depth. A hard-coded pixel scale (the shape
        // this had) drifts with display density and window height, so the mark
        // and the pick sphere derived from it could never stay the same size.
        gl_PointSize = uSize
          * (1.0 + min(1.0, vShockwave) * uShockwaveSizeBoost)
          * 0.5 * uViewportHeight * projectionMatrix[1][1]
          / max(-view.z, 0.001);
        gl_Position = projectionMatrix * view;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;

      uniform vec3 uColor;
      uniform float uDim;
      uniform float uEvent;
      uniform float uCoreExp;
      uniform float uContextEnergy;
      ${SHOCKWAVE_UNIFORMS_GLSL}

      varying float vShockwave;
      varying vec3 vShockwaveCarrier;

      ${PEER_SHOCKWAVE_RESPONSE_GLSL}

      void main() {
        float r = length(gl_PointCoord - 0.5) * 2.0;
        if (r > 1.0) discard;
        // The core carries the tone's own exponent while the skirt stays fixed:
        // a stop resting above the additive clip has to pull its bright plateau
        // in, and it is the CORE crossing 1/uDim that sets where that plateau
        // ends. One shader source still serves every stop — the exponent rides
        // a uniform, so no tone can cost a vertex attribute.
        float core = pow(1.0 - r, uCoreExp);
        float halo = pow(1.0 - r, 1.6) * 0.42;
        vec4 signal = peerShockwaveResponse(
          uColor,
          core + halo,
          halo,
          uDim * uContextEnergy,
          uEvent,
          uDim
        );
        gl_FragColor = signal;
      }
    `,
  });
}

/**
 * Camera-facing halo for one measured peer. It uses the same radial primitive
 * as the shared halo material at rest, but samples the shared block wave in
 * world XZ so the measured core and inferred scaffold form one continuous front.
 */
export function makePeerHaloMaterial(
  color: THREE.ColorRepresentation,
  uniforms?: ShockwaveUniforms,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uPhase: { value: 0 },
      uIntensity: { value: 1 },
      uColor: { value: new THREE.Color(color) },
      uContextEnergy: { value: 1 },
      ...sharedShockwave(uniforms),
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying float vShockwave;
      varying vec3 vShockwaveCarrier;

      uniform float uTime;
      ${SHOCKWAVE_UNIFORMS_GLSL}

      ${SHOCKWAVE_SIGNAL_GLSL}

      void main() {
        vUv = uv;
        vec4 center = modelMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        vec4 wave = shockwaveSignalAt(center.xz);
        vShockwave = wave.a;
        vShockwaveCarrier = wave.rgb;
        vec3 expanded = position
          * (1.0 + min(1.0, vShockwave) * uShockwaveSizeBoost);
        gl_Position = projectionMatrix
          * modelViewMatrix
          * vec4(expanded, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;

      varying vec2 vUv;
      varying float vShockwave;
      varying vec3 vShockwaveCarrier;

      uniform float uTime;
      uniform float uPhase;
      uniform float uIntensity;
      uniform float uContextEnergy;
      uniform vec3 uColor;
      ${SHOCKWAVE_UNIFORMS_GLSL}

      ${PEER_SHOCKWAVE_RESPONSE_GLSL}

      void main() {
        float r = length(vUv - 0.5) * 2.0;
        if (r > 1.0) discard;
        float core = pow(1.0 - r, 4.0);
        float halo = pow(1.0 - r, 1.6) * 0.42;
        float breathe = 0.78 + 0.22 * sin(uTime * 1.2 + uPhase);
        float intensity = uIntensity * breathe;
        vec4 signal = peerShockwaveResponse(
          uColor,
          core + halo,
          halo,
          intensity * uContextEnergy,
          intensity,
          intensity
        );
        gl_FragColor = signal;
      }
    `,
  });
}

/** Injected so the instanced port and the historical per-node CPU loop share
 * one definition of the measured core's brightness envelope. */
export const MEASURED_PEER_BRIGHTNESS = 1.6;

/**
 * How loudly the measured belt answers a block wave. ⭐ ON THIS MATERIAL ONLY:
 * the ghost and sighted clouds keep their 2026-08-24 tuning, and the shared
 * `SHOCKWAVE_*` ceilings are pinned for them. Under the wave a measured halo
 * flared to ≈3× its rest — the brightest thing on screen — in a block whose
 * one real event, the block reaching the tissue, is meant to be the loudest
 * beat; the trim holds the peak under ≈2× so the tissue's exhale wins. It
 * multiplies `eventScale` alone: the resting light (`passiveEnergy`,
 * `restScale`) and the vertex-stage size boost are untouched.
 */
export const MEASURED_EVENT_SCALE = 0.6;

/**
 * How far apart a hovered peer's published position and an instance's own may
 * be and still be the same peer, in world units.
 *
 * The uniform carries a POSITION rather than an index, because the belt's
 * lanes are re-cut on every roster round and an index does not survive one —
 * the same hazard `stampPeerLaunches` exists for. The position is copied from
 * the very array the instance matrices are written from, so the two are bit
 * identical and this is a guard against nothing but future arithmetic; the
 * belt's own peers stand tens of world units apart.
 */
export const MEASURED_HOVER_MATCH_WU = 0.25;

/**
 * What a hovered measured peer's halo adds to its own light.
 *
 * The class of scene target a viewer most often fails to hit — twelve measured
 * peers among ~260 unclickable inferred ghosts — was the one class with no
 * hover feedback at all: `onPointerOver` published a word for the cursor
 * arbitration and nothing else. A Cell answers a pointer with its focus
 * envelope; this is that envelope, on the belt, at the same strength the Cell
 * reaches on hover (`CELL_HOVER_FOCUS`), so the two organisms answer a pointer
 * in one language.
 */
export const MEASURED_HOVER_FOCUS = CELL_HOVER_FOCUS;

/**
 * …and how much wider the hovered mark stands.
 *
 * Brightness ALONE does not answer here, and the first live capture is what
 * says so: over the mark itself the halo's core already sits at mean L 174 of
 * 255 under additive blending, so a 1.46× intensity raised the mean 12–16 %
 * and could not reach the 20 % the gate asks for — the light it added had
 * nowhere to go. What a viewer reads on a plane of ~285 similar marks is
 * WHICH ONE, and size answers that where a clipped core cannot.
 *
 * It is the Cell's envelope in this too: a hovered Cell's focus drives
 * `focusedBraidScale` as well as its light. Eighteen percent is a mark that
 * has plainly answered and has not moved — the hit sphere is untouched, so
 * nothing the pointer is already on can escape from under it.
 */
export const MEASURED_HOVER_EXTENT = 0.18;

/**
 * Every measured peer halo in ONE instanced draw. Replaces one drei Billboard
 * plus one single-quad mesh (and two frame subscribers) per peer: the
 * billboard is rebuilt from the view matrix's camera axes — exactly the
 * orientation the follow-Billboard's camera quaternion produced — and the
 * per-node breathe (rate/phase) plus intensity envelope move from per-material
 * uniforms into instanced attributes evaluated against one shared uTime.
 * Selection keeps its context-energy exemption through aPeerSelected.
 *
 * The held breath rides a fifth lane, `aPeerLaunchAt`: the sim instant this
 * peer's delivery hop leaves (stamped per block by the owner; sentinel at
 * rest). Over the charge window before it the halo's extent draws in and its
 * light concentrates, and both let go over the release after — the
 * compression that used to be a 3 px glyph, in the light that is already
 * there.
 */
export function makeMeasuredPeerHalosMaterial(
  uniforms?: ShockwaveUniforms,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uContextEnergy: { value: 1 },
      // xyz: the hovered peer's world position. w: whether one is hovered at
      // all. One uniform for a belt of twelve, written from the frame loop
      // off the canvas's own hover word — no re-render, no attribute upload.
      uHover: { value: new THREE.Vector4(0, 0, 0, 0) },
      ...makeCompressionUniforms(),
      ...sharedShockwave(uniforms),
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    vertexShader: /* glsl */ `
      attribute vec3 aPeerColor;
      attribute float aPeerPhase;
      attribute float aPeerRate;
      attribute float aPeerSelected;
      // The held breath: this peer's launch instant (sim s), sentinel at rest.
      attribute float aPeerLaunchAt;

      varying vec2 vUv;
      varying float vShockwave;
      varying vec3 vShockwaveCarrier;
      varying vec3 vPeerColor;
      varying float vPeerPhase;
      varying float vPeerRate;
      varying float vPeerSelected;
      varying float vHeld;
      varying float vHover;

      uniform float uTime;
      uniform float uCompressDepth;
      uniform vec4 uHover;
      ${SHOCKWAVE_UNIFORMS_GLSL}

      ${SHOCKWAVE_SIGNAL_GLSL}
      ${PEER_COMPRESSION_GLSL}

      void main() {
        vUv = uv;
        vPeerColor = aPeerColor;
        vPeerPhase = aPeerPhase;
        vPeerRate = aPeerRate;
        vPeerSelected = aPeerSelected;
        vec4 origin = modelMatrix
          * instanceMatrix
          * vec4(0.0, 0.0, 0.0, 1.0);
        vec4 wave = shockwaveSignalAt(origin.xz);
        vShockwave = wave.a;
        vShockwaveCarrier = wave.rgb;
        // Is the pointer on THIS peer? The uniform names one position; every
        // other instance reads 0 and is untouched.
        //
        // WARNING: IN THE INSTANCE'S OWN FRAME, not the world's. The colony
        // rotates under its own group (the counter-rotation), so the world
        // origin -- which has been through modelMatrix -- moves every frame
        // while the position the layer publishes is the peer's own node.pos.
        // Comparing those two matched for about one frame after boot and
        // never again, which is exactly what the first live capture measured:
        // hover and rest inside the belt's own rotation noise.
        vec4 local = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        vHover = uHover.w * (1.0 - step(
          ${MEASURED_HOVER_MATCH_WU.toFixed(2)},
          distance(local.xyz, uHover.xyz)
        ));
        float expand = 1.0 + min(1.0, vShockwave) * uShockwaveSizeBoost;
        // The held breath: the extent draws in over the charge window before
        // this peer's hop leaves and lets go after. It rides ON the wave's
        // size boost rather than replacing it — a wave may still be crossing
        // the peer as its hop goes.
        float held = peerCompressionGl(uTime - aPeerLaunchAt);
        vHeld = held;
        float extent = expand
          * (1.0 - uCompressDepth * held)
          * (1.0 + ${MEASURED_HOVER_EXTENT.toFixed(2)} * vHover);
        // The follow-Billboard applied the camera's world quaternion; the
        // view matrix's row axes are that same frame, so the silhouette is
        // identical with zero per-frame CPU.
        vec3 cameraRight = vec3(
          viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]
        );
        vec3 cameraUp = vec3(
          viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]
        );
        vec3 world = origin.xyz
          + (cameraRight * position.x + cameraUp * position.y) * extent;
        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;

      varying vec2 vUv;
      varying float vShockwave;
      varying vec3 vShockwaveCarrier;
      varying vec3 vPeerColor;
      varying float vPeerPhase;
      varying float vPeerRate;
      varying float vPeerSelected;
      varying float vHeld;
      varying float vHover;

      uniform float uTime;
      uniform float uContextEnergy;
      uniform float uCompressGain;
      ${SHOCKWAVE_UNIFORMS_GLSL}

      ${PEER_SHOCKWAVE_RESPONSE_GLSL}

      void main() {
        float r = length(vUv - 0.5) * 2.0;
        if (r > 1.0) discard;
        float core = pow(1.0 - r, 4.0);
        float halo = pow(1.0 - r, 1.6) * 0.42;
        // The historical CPU envelope, verbatim: intensity uniform carried
        // MEASURED_PEER_BRIGHTNESS * (0.85 + 0.15 * sin(t * rate + phase)).
        float envelope = ${MEASURED_PEER_BRIGHTNESS.toFixed(1)}
          * (0.85 + 0.15 * sin(uTime * vPeerRate + vPeerPhase));
        float breathe = 0.78 + 0.22 * sin(uTime * 1.2 + vPeerPhase);
        // The held breath concentrates the halo's light as its extent draws
        // in — the gain is short of conservation, so it never pops white.
        // …and the hovered peer answers, at the envelope a Cell answers with.
        float intensity = envelope * breathe
          * (1.0 + uCompressGain * vHeld)
          * (1.0 + ${MEASURED_HOVER_FOCUS.toFixed(2)} * vHover);
        float contextEnergy = mix(uContextEnergy, 1.0, vPeerSelected);
        // Only the event term is trimmed (MEASURED_EVENT_SCALE); rest stays.
        vec4 signal = peerShockwaveResponse(
          vPeerColor,
          core + halo,
          halo,
          intensity * contextEnergy,
          intensity * ${MEASURED_EVENT_SCALE.toFixed(2)},
          intensity
        );
        gl_FragColor = signal;
      }
    `,
  });
}
