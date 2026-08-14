import * as THREE from 'three';
import {
  CONTACT_RING_GAPS,
  CONTACT_RING_SIDES,
} from '../geometry/protocolCarrier';
import { FIELD_HALF_X, FIELD_HALF_Z } from '../helix';

/**
 * The contact front every worker releases into the Cell field.
 *
 * A block lands on a disc, so the front lives IN that disc: a thin, hard-edged
 * crest racing outward across the tissue with a faint bleached wake behind it.
 * Its punch comes from edge sharpness against a dark field, never from area or
 * raw brightness — the same discipline that de-glared the peer-plane wave.
 *
 * WHY A SHADER AND NOT A SPRITE: the crest is resolved analytically from the
 * fragment's radius, so it stays razor-thin at ANY world radius. The texture it
 * replaces was 128px, which smeared into a soft doughnut the moment a front
 * grew past a few world units — the exact failure that made the old ring read
 * as decoration rather than pressure.
 *
 * WHY EVERY FRONT IS THE SAME SPEED (the renderer drives radius from
 * `SHOCKWAVE_SPEED / CONTACT_WAVE_SCALE`): ~81 workers commit the same block
 * at latency-staggered times. Identical speed and shape make their fronts ONE
 * interference field instead of 81 independent fireworks — and because speed
 * and reach carry the SAME quarter scale, a front's lifetime still matches
 * the peer-plane wave's structure, so the two planes read as two sections of
 * one event at two sizes.
 *
 * Overlap safety (this is what keeps 81 additive fronts off the white rail):
 *  • the crest is thin, so crossings are line crossings, not area sums;
 *  • the renderer folds a 1/r falloff into each instance colour, so a front is
 *    already dim by the time it can meet a neighbour;
 *  • `uSegmentDepth` carves the rim's three gaps into the crest, breaking the
 *    circle into the same interrupted polygon the carrier glyph uses;
 *  • the rim fade extinguishes a front where the tissue ends — workers ring
 *    the galaxy wider than the tissue, so their landings are pulled onto the
 *    rim (peers.derive `clampLandingToField`) and each front's outbound half
 *    dies across the halo band instead of glowing over empty space.
 */

/** Fixed UV radius the crest always sits at. The renderer scales each instance
 *  so its world crest lands exactly here, which is what keeps the front sharp
 *  at every radius: the shader's job never changes, only the scale does. */
export const CONTACT_WAVE_CREST_UV = 0.74;
/** Annulus bounds in the same UV space. The band is deliberately narrow — a
 *  full quad per front would cost ~81 large overlapping fills per block. Inner
 *  0.30 still leaves ~0.44 UV of room behind the crest for the wake. */
export const CONTACT_WAVE_INNER_UV = 0.30;
export const CONTACT_WAVE_OUTER_UV = 1.0;
const CONTACT_WAVE_SEGMENTS = 96;

/** Wake side markers written into the `aWave` instance attribute. */
export const CONTACT_WAVE_WAKE_BEHIND = 1;
export const CONTACT_WAVE_WAKE_AHEAD = -1;

// The front's quarter-scale relationship to the peer-plane wave
// (CONTACT_WAVE_SCALE) lives in ui/topologyConstants.ts beside
// SHOCKWAVE_SPEED — the two numbers together are the two-plane contract.

/** A front is extinguished across a band of the tissue ellipse's normalized
 *  radius rather than at a hard edge. The footprint itself comes from helix.ts
 *  (60×54, rotating with the galaxy); these two numbers only place the band on
 *  it: extinction begins just inside the nominal rim and completes a little
 *  past it, where the ~4.5% halo outliers thin into nothing. They describe the
 *  field, not taste, so they are module constants instead of tuning knobs.
 *  (The old circular 44→62 band was calibrated for the pre-quarter reach-34
 *  fronts, which needed dimming from mid-tissue outward; a quarter-scale ring
 *  released ON the tissue must stay readable out to the rim.) */
const CONTACT_WAVE_RIM_FADE_START_NORM = 0.94;
const CONTACT_WAVE_RIM_FADE_END_NORM = 1.12;

/** Wake length as a multiple of the crest half-width. */
const CONTACT_WAVE_WAKE_LENGTH = 3.4;

/**
 * The annulus every front instance is drawn on. Local XY is the Cell plane once
 * the renderer aims local +Z along the (vertical) travel axis, so a front lies
 * flat in the tissue without any extra basis maths.
 */
export function makeContactWaveGeometry(): THREE.BufferGeometry {
  return new THREE.RingGeometry(
    CONTACT_WAVE_INNER_UV,
    CONTACT_WAVE_OUTER_UV,
    CONTACT_WAVE_SEGMENTS,
    1,
  );
}

/** Per-instance front shape: `(crestHalfWidthUV, wakeSide)`. Width has to be
 *  per-instance because each front carries its own world scale; the wake side
 *  flips for the contracting pre-release ring, whose wake trails outward. */
export function makeContactWaveAttribute(
  capacity: number,
): THREE.InstancedBufferAttribute {
  const attribute = new THREE.InstancedBufferAttribute(
    new Float32Array(Math.max(1, capacity) * 2),
    2,
  );
  attribute.setUsage(THREE.DynamicDrawUsage);
  return attribute;
}

export function makeContactWaveMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uCrest: { value: CONTACT_WAVE_CREST_UV },
      uWake: { value: 0.22 },
      uWakeLength: { value: CONTACT_WAVE_WAKE_LENGTH },
      uSegmentDepth: { value: 0.55 },
      uSides: { value: CONTACT_RING_SIDES },
      uGapEvery: { value: CONTACT_RING_SIDES / CONTACT_RING_GAPS },
      // The tissue ellipse turns with the galaxy while fronts hold world
      // positions; the renderer mirrors the group's live rotation in here.
      uGalaxyRotY: { value: 0 },
    },
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      attribute vec2 aWave;

      varying vec2 vPlane;
      varying vec2 vWorldXZ;
      varying vec2 vWave;
      varying vec3 vCarrier;

      void main() {
        // The annulus already spans radius 0..1 in local XY, so plane
        // coordinates need no rescaling — only the instance scale changes.
        vPlane = position.xy;
        vWave = aWave;
        #ifdef USE_INSTANCING_COLOR
          vCarrier = instanceColor;
        #else
          vCarrier = vec3(1.0);
        #endif
        #ifdef USE_INSTANCING
          vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
        #else
          vec4 world = modelMatrix * vec4(position, 1.0);
        #endif
        vWorldXZ = world.xz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;

      #define TAU 6.283185307179586

      uniform float uCrest;
      uniform float uWake;
      uniform float uWakeLength;
      uniform float uSegmentDepth;
      uniform float uSides;
      uniform float uGapEvery;
      uniform float uGalaxyRotY;

      varying vec2 vPlane;
      varying vec2 vWorldXZ;
      varying vec2 vWave;
      varying vec3 vCarrier;

      void main() {
        float radius = length(vPlane);
        float halfWidth = max(vWave.x, 1e-4);

        // Crest: one gaussian band pinned at the fixed UV radius.
        float offset = (radius - uCrest) / halfWidth;
        float crest = exp(-offset * offset);

        // Wake: a faint bleached tail on the side the front came from. Positive
        // wake side trails inward (expanding), negative trails outward (the
        // contracting pre-release ring).
        float behind = vWave.y * (uCrest - radius);
        float wake = uWake
          * exp(-max(behind, 0.0) / max(halfWidth * uWakeLength, 1e-4))
          * step(0.0, behind);

        float signal = crest + wake;

        // The annulus is a drawing surface, not part of the form. Fade the
        // signal out at both of its edges so a wide crest or a long wake can
        // never expose the geometry boundary as a hard line.
        signal *= smoothstep(${CONTACT_WAVE_INNER_UV.toFixed(2)}, ${(CONTACT_WAVE_INNER_UV + 0.07).toFixed(2)}, radius)
          * (1.0 - smoothstep(0.93, 1.0, radius));

        // Three open sides, the same break the carrier rim carries — and at the
        // same side indices, so the glyph and the front it becomes agree. Phase
        // runs 0..uGapEvery inside each period; the last unit of the period is
        // the gap, softened so its edges never alias into hard spokes.
        float turn = fract(atan(vPlane.y, vPlane.x) / TAU + 1.0);
        float phase = mod(turn * uSides, uGapEvery);
        float intoGap = min(phase - (uGapEvery - 1.0), uGapEvery - phase);
        float gap = smoothstep(0.0, 0.35, intoGap);
        signal *= 1.0 - uSegmentDepth * gap;

        // The wave only propagates through tissue. The footprint is an
        // ellipse in the galaxy's rotating local frame, so project the world
        // fragment back through the live rotation before normalizing.
        float rotC = cos(uGalaxyRotY);
        float rotS = sin(uGalaxyRotY);
        vec2 tissueXZ = vec2(
          vWorldXZ.x * rotC + vWorldXZ.y * rotS,
          -vWorldXZ.x * rotS + vWorldXZ.y * rotC
        );
        float fieldNorm = length(tissueXZ / vec2(
          ${FIELD_HALF_X.toFixed(1)},
          ${FIELD_HALF_Z.toFixed(1)}
        ));
        signal *= 1.0 - smoothstep(
          ${CONTACT_WAVE_RIM_FADE_START_NORM.toFixed(2)},
          ${CONTACT_WAVE_RIM_FADE_END_NORM.toFixed(2)},
          fieldNorm
        );

        if (signal <= 0.0015) discard;
        // Additive blending with alpha 1: the instance colour already carries
        // this front's intensity, so RGB is the final premultiplied light.
        gl_FragColor = vec4(vCarrier * signal, 1.0);
      }
    `,
  });
}
