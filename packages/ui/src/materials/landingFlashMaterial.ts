import * as THREE from 'three';
import { HYBRID_BASE_PX_PER_WU } from './cellHybridMaterial';
import { CELL_GALAXY_PALETTE } from '../visualPalette';

/** How long a landing flash lasts (s): warm white resolving into tissue
 *  rose. The material owns the number and seeds its uniform with it; the
 *  `landingDur` knob takes its default from here and `LandingFlashLayer`
 *  overwrites the uniform from LIVE each frame — one authority. */
export const LANDING_FLASH_DURATION_S = 0.45;
/** A landing flash's sprite, as a multiple of its Cell's presentation size —
 *  on the SAME px-per-world-unit basis the body and the write flare use, so
 *  the bloom registers over its Cell at every camera distance. Same rule:
 *  the `landingSize` knob defaults to this and drives the uniform live. */
export const LANDING_FLASH_SIZE_SCALE = 2.2;

/**
 * Plain landing flash — a `Points` material for `LandingFlashLayer`.
 *
 * A block landing flashes the Cells its front passes, and this is that flash:
 * a soft point bloom, warm white resolving into tissue rose over the window,
 * on the layer's OWN geometry. It is deliberately not the write seal: no
 * contributor rails, no agreement loops, no knot — those belong to
 * `cellFlareMaterial`, which only a real write (`aFlashAt`) may fire. Nothing
 * here touches the shared Cell attributes, so the body material keeps its
 * budget and its resting draw.
 *
 * Attributes (all the layer's own): `position` (galaxy-local, the frame
 * `pos_seed` lives in), `aLandingAt` (sim seconds, sentinel −1e9),
 * `aLandingSize` (the Cell's presentation size), `aLandingColor` (rgb = the
 * onset colour, a = amplitude — the front's own strength where it passed).
 * Age-gated in the vertex stage exactly as the flare is: a slot outside its
 * window is clipped off-screen before projection and costs no fragment.
 */
export function makeLandingFlashMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime:           { value: 0 },
      uDuration:       { value: LANDING_FLASH_DURATION_S },
      uSizeScale:      { value: LANDING_FLASH_SIZE_SCALE },
      uViewportHeight: { value: 800 },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    vertexShader: /* glsl */ `
      attribute float aLandingAt;
      attribute float aLandingSize;
      attribute vec4  aLandingColor; // rgb = onset colour, a = amplitude

      uniform float uTime;
      uniform float uDuration;
      uniform float uSizeScale;
      uniform float uViewportHeight; // drawing-buffer height (CSS height × DPR)

      varying float vLife;
      varying vec3  vColor;
      varying float vAmp;

      void main() {
        float age = uTime - aLandingAt;
        // Only slots inside their window may produce fragments. Clip the rest
        // off-screen before projection, exactly as the write flare does, so
        // an ended (or still-to-come) slot costs one vertex and nothing more.
        if (age < 0.0 || age >= uDuration) {
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          gl_PointSize = 1.0;
          return;
        }
        vLife  = age / uDuration;
        vColor = aLandingColor.rgb;
        vAmp   = aLandingColor.a;

        vec4 viewPos = viewMatrix * modelMatrix * vec4(position, 1.0);
        gl_Position  = projectionMatrix * viewPos;
        // The Cell's own presentation size, scaled, on the body's
        // px-per-world-unit basis (HYBRID_BASE_PX_PER_WU, the number the
        // write flare mirrors too) — so the bloom sits over its Cell.
        gl_PointSize = aLandingSize * uSizeScale * ${HYBRID_BASE_PX_PER_WU.toFixed(1)} * (uViewportHeight * 0.5 / max(-viewPos.z, 0.001));
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;

      varying float vLife;
      varying vec3  vColor;
      varying float vAmp;

      void main() {
        vec2 uv = gl_PointCoord - 0.5;
        float d = length(uv) * 2.0; // 0 at the centre, 1 at the sprite rim
        if (d > 1.0) discard;

        // Attack over the first eighth of the window, then a long release:
        // a flash in the tissue's own tempo, not a strobe.
        float env = smoothstep(0.0, 0.12, vLife) * (1.0 - smoothstep(0.12, 1.0, vLife));
        // The bloom opens as it fades — a soft Gaussian whose spread grows
        // over the window — and dies before the sprite rim so it never
        // shows an edge.
        float spread = mix(0.26, 0.5, vLife);
        float bloom = exp(-(d * d) / (2.0 * spread * spread))
          * (1.0 - smoothstep(0.7, 1.0, d));
        // A small hot core at onset, gone by mid-window.
        float core = exp(-(d * d) / (2.0 * 0.09 * 0.09))
          * (1.0 - smoothstep(0.0, 0.5, vLife));

        // Warm white at onset resolving into the tissue's own rose: the
        // landing is hers, and rose is what she settles back into.
        vec3 rose = vec3(${CELL_GALAXY_PALETTE.tissueRose.join(', ')});
        vec3 col = mix(vColor, rose, smoothstep(0.0, 1.0, vLife));

        float a = (bloom + core * 0.6) * env * vAmp;
        if (a < 0.004) discard;
        gl_FragColor = vec4(col * a, a);
      }
    `,
  });
}
