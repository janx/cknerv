// The unresolved population, as a medium.
//
// Two passes, and the split is forced by what the two halves are made of.
//
//  1. DENSITY — quarter resolution, offscreen. Marches the baked positional
//     law through the tissue slab and writes one number per texel: how much
//     unresolved matter the ray passed through. That term is low-frequency by
//     construction — it is a warped multi-octave field over a 60×54 ellipse,
//     with no detail below several world units — so quarter resolution is
//     lossless for it and a quarter of the marching cost.
//
//  2. COMPOSITE — full resolution. Upsamples that coverage and applies the
//     one thing that CANNOT be upsampled: grain at the size of a device
//     pixel, in screen space. Applied at quarter resolution it would be four
//     pixels wide and would resolve into countable specks the moment anyone
//     flew closer, which is the exact reading this whole layer exists to
//     avoid.
//
// The grain is the argument, not decoration. Density alone reads as fog, and
// fog means emptiness; population means granularity below the resolution
// limit. Locking that granularity to the SCREEN rather than to the world is
// what makes flying closer fail to resolve it — and that is the honest
// statement, because the limit really is the instrument (this renderer's
// budget), not the distance.

import * as THREE from 'three';

import { CELL_GALAXY_PALETTE } from '../visualPalette';
import {
  TISSUE_BAKE_FOLD_Y_RANGE,
  TISSUE_BAKE_THICKNESS_MAX,
  TISSUE_BAKE_THICKNESS_MIN,
} from '../geometry/tissueFieldBake';

/**
 * Half-height of the marched slab.
 *
 * The volume is `density(x, z) * exp(-½((y - foldY) / thickness)²)`, so it has
 * no hard top: it is bounded by where the Gaussian stops mattering. `foldY`
 * cannot leave ±6.3 and `thickness` cannot exceed 7.3, so three sigma above
 * the highest fold is 6.3 + 3 × 7.3 ≈ 28. Past that the medium is contributing
 * less than a thousandth of its peak and the march is spending steps on
 * nothing.
 */
export const POPULATION_FIELD_SLAB_HALF_Y = 28;

/**
 * Extinction per unit of integrated density, before `gain`.
 *
 * Optical depth is `gain * EXTINCTION * ∫ρ dl`, and alpha is `1 - exp(-τ)`.
 * With the Gaussian normalized, a VERTICAL column integrates back to the areal
 * density times √(2π) ≈ 2.51, and the production camera sits about 24° above
 * the Cell plane, so a real ray travels roughly 2.44 times that — call it 6.1
 * per unit of areal density.
 *
 * The acceptance test this is calibrated against: **inside the envelope, the
 * space between Cells must stop being black.** That is the whole perceptual
 * claim. Black between Cells reads as "nothing there"; luminous matter reads
 * as a population, and no amount of correctness in the density term can make
 * an invisible layer state anything.
 *
 * The first calibration failed it. At 0.21 and the measured mainnet gain of
 * 0.58, ordinary mid-field tissue (areal density ≈ 0.23) landed at alpha 0.16
 * and the whole layer averaged 0.12 — about rgb(13,10,10) over the scene's
 * near-black, which is below the perceptual floor beside a bright additive
 * Cell field occupying the same envelope. Rendering the medium in isolation
 * showed a smudge, and in situ it was indistinguishable from absence.
 *
 * At 0.84 the same mid-field lands near alpha 0.49 and the densest tissue near
 * 0.92, so the background between Cells is warm matter rather than void, and
 * the cavities and corridors the field has always contained become legible.
 * The Cells stay in front: the medium renders beneath them and never brightens
 * a Cell body.
 *
 * This is the live-tuning lever for the medium's presence. Nothing else here
 * should be reached for first — `gain` is calibration and the density term is
 * the chain's own law, but this number is taste.
 */
export const POPULATION_FIELD_EXTINCTION = 0.84;

/** Screen-space grain period, in DEVICE pixels. Below 1 the grain aliases
 *  into the pixel grid; above ~2.5 it starts reading as texture rather than
 *  as a resolution limit. */
export const POPULATION_FIELD_GRAIN_PX = 1.7;

/** How hard the grain modulates the medium's luminance, at full optical
 *  depth. Amplitude scales with optical depth from there, so grain lives
 *  where matter is instead of speckling empty space. */
export const POPULATION_FIELD_GRAIN_AMOUNT = 0.55;

/** Grain reseeds this many times per second. Fast enough to read as a limit
 *  of the instrument rather than as moving objects; a frozen phase (reduced
 *  motion) changes nothing but the animation. */
export const POPULATION_FIELD_GRAIN_RATE = 11;

/** Concurrent membership blooms. Ring-allocated by the caller; the shader
 *  loop breaks at the live count, so the ceiling costs nothing until it is
 *  actually reached. */
export const POPULATION_FIELD_MAX_BLOOMS = 64;

/**
 * A dissolve is not a death.
 *
 * Death owns its event signature — its own colour and `DEATH_DURATION_MS` of
 * 600. A Cell leaving the stage is ALIVE on chain, so its mark has to be
 * slower, dimmer, and achromatic, or the eye's death count stops matching the
 * HUD's and this layer has to be cut.
 */
export const POPULATION_FIELD_BLOOM_MS = 1400;

/**
 * The medium's tint: the organism's own body colour, desaturated most of the
 * way to grey and dimmed.
 *
 * Rule — the field carries NO identity hue. Asset, lock and tag palettes are
 * forbidden here, because a hue that means something elsewhere would make an
 * aggregate look like a claim about which Cells it contains. What is left is
 * a warm neutral that belongs to the same organism.
 */
function mediumTint(): THREE.Color {
  const [r, g, b] = CELL_GALAXY_PALETTE.tissueRose;
  const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const saturation = 0.25;
  // Level, not saturation, is what nearly lost this layer: 0.65 of a
  // desaturated rose is a dark grey, and a dark grey at alpha 0.12 is
  // rgb(13,10,10). The tint has to be able to CARRY the alpha it is given.
  // Saturation stays where it was — the medium borrows the organism's body
  // colour and must never wear an identity hue.
  const level = 1.0;
  return new THREE.Color(
    (luma + (r - luma) * saturation) * level,
    (luma + (g - luma) * saturation) * level,
    (luma + (b - luma) * saturation) * level,
  );
}

/** Helpers both fragment programs are compiled with. The composite needs only
 *  the hash; the density pass needs both. They share one text so the hash the
 *  march dithers with and the hash the grain is built from cannot drift into
 *  two different noises. */
const SLAB_GLSL = /* glsl */ `
  // Analytic slab entry/exit. The direction is guarded away from exact zero
  // because GLSL does not promise IEEE infinities through min/max.
  bool slabRange(vec3 ro, vec3 rd, vec3 half3, out float tEnter, out float tExit) {
    // GLSL sign() returns 0 for an exactly axis-aligned component, which
    // would put a zero straight back into the divisor this guard exists to
    // remove — and an edge-on camera really can produce one. step() maps to
    // +1/-1 and never to zero.
    vec3 unit = step(vec3(0.0), rd) * 2.0 - 1.0;
    vec3 safeRd = unit * max(abs(rd), vec3(1e-6));
    vec3 inv = 1.0 / safeRd;
    vec3 a = (-half3 - ro) * inv;
    vec3 b = ( half3 - ro) * inv;
    vec3 lo = min(a, b);
    vec3 hi = max(a, b);
    tEnter = max(max(lo.x, lo.y), lo.z);
    tExit  = min(min(hi.x, hi.y), hi.z);
    // A camera inside the slab starts at the camera, not behind it.
    tEnter = max(tEnter, 0.0);
    return tExit > tEnter;
  }

  // Deterministic per-pixel hash. Used to dither the march's starting offset:
  // eight steps through a smooth field band visibly, and dithering trades
  // those bands for noise — which is the language this layer speaks anyway.
  float hash21(vec2 p) {
    vec3 q = fract(vec3(p.xyx) * 0.1031);
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
  }
`;

export interface PopulationDensityUniforms {
  uField: { value: THREE.Texture | null };
  uHalf: { value: THREE.Vector3 };
  uLocalCamera: { value: THREE.Vector3 };
  uSteps: { value: number };
  uOpticalDepth: { value: number };
  uFoldRange: { value: number };
  uThicknessMin: { value: number };
  uThicknessSpan: { value: number };
}

/**
 * Pass 1. Renders the slab's bounding box (never a fullscreen quad — the
 * medium occupies a bounded volume and paying for the rest of the screen
 * would be paying for nothing) and writes accumulated coverage to R.
 */
export function makePopulationDensityMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uField: { value: null },
      uHalf: { value: new THREE.Vector3(1, 1, 1) },
      uLocalCamera: { value: new THREE.Vector3() },
      uSteps: { value: 8 },
      uOpticalDepth: { value: 0 },
      uFoldRange: { value: TISSUE_BAKE_FOLD_Y_RANGE },
      uThicknessMin: { value: TISSUE_BAKE_THICKNESS_MIN },
      uThicknessSpan: {
        value: TISSUE_BAKE_THICKNESS_MAX - TISSUE_BAKE_THICKNESS_MIN,
      },
    } satisfies PopulationDensityUniforms,
    // Back faces: the exit surface is visible whether the camera is outside
    // the slab or inside it, so one draw covers the close fly-in too.
    side: THREE.BackSide,
    depthTest: false,
    depthWrite: false,
    transparent: false,
    toneMapped: false,
    vertexShader: /* glsl */ `
      varying vec3 vLocal;
      void main() {
        vLocal = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform sampler2D uField;
      uniform vec3  uHalf;
      uniform vec3  uLocalCamera;
      uniform float uSteps;
      uniform float uOpticalDepth;
      uniform float uFoldRange;
      uniform float uThicknessMin;
      uniform float uThicknessSpan;

      varying vec3 vLocal;

      ${SLAB_GLSL}

      void main() {
        vec3 ro = uLocalCamera;
        vec3 rd = normalize(vLocal - ro);
        float tEnter, tExit;
        if (!slabRange(ro, rd, uHalf, tEnter, tExit)) discard;

        float steps = max(uSteps, 1.0);
        float span = tExit - tEnter;
        float stepLen = span / steps;
        // Dithered start: the band pattern of a fixed offset would be a
        // structure, and this layer must never show one.
        float offset = hash21(gl_FragCoord.xy) * stepLen;

        float tau = 0.0;
        for (int i = 0; i < 16; i++) {
          if (float(i) >= steps) break;
          float t = tEnter + offset + float(i) * stepLen;
          vec3 p = ro + rd * t;
          // One fetch carries the whole law: density, fold centre, thickness.
          vec2 uv = p.xz / (2.0 * uHalf.xz) + 0.5;
          vec3 law = texture2D(uField, uv).rgb;
          float density = law.r;
          float foldY = law.g * (2.0 * uFoldRange) - uFoldRange;
          float thickness = law.b * uThicknessSpan + uThicknessMin;
          float safeThickness = max(thickness, 1e-3);
          float dy = (p.y - foldY) / safeThickness;
          // The 1 / thickness is the Gaussian's NORMALIZATION, and dropping it
          // is not a scale error that a constant absorbs: it makes a column's
          // integrated density proportional to how thick the tissue is there.
          // helixSeedF64 draws y ~ N(foldY, thickness), so a column has to
          // integrate back to the areal density it was sampled from, whatever
          // the local thickness. Thickness spans 2.1 to 7.3 and is driven by
          // the same ridge term as the density, so without this the medium
          // overstates its densest regions by up to 3.5x — and the shape it
          // showed would no longer be the law the Cells are placed by.
          tau += (density / safeThickness) * exp(-0.5 * dy * dy) * stepLen;
        }

        // Alpha reaches the screen through the same law it accumulates by.
        float coverage = 1.0 - exp(-tau * uOpticalDepth);
        gl_FragColor = vec4(coverage, 0.0, 0.0, 1.0);
      }
    `,
  });
}

export interface PopulationCompositeUniforms {
  uDensity: { value: THREE.Texture | null };
  uResolution: { value: THREE.Vector2 };
  uTint: { value: THREE.Color };
  uGrainPx: { value: number };
  uGrainAmount: { value: number };
  uGrainPhase: { value: number };
  uBloomCount: { value: number };
  /** xy = NDC centre, z = life in [0, 1], w = radius in device pixels. */
  uBlooms: { value: THREE.Vector4[] };
}

/**
 * Pass 2. Upsamples the density term and applies the resolution limit.
 *
 * The blooms live here rather than in the density march for the same reason
 * the grain does: they are a screen-scale mark, and a quarter-resolution one
 * would be a visible square.
 */
export function makePopulationCompositeMaterial(): THREE.ShaderMaterial {
  const blooms: THREE.Vector4[] = [];
  for (let i = 0; i < POPULATION_FIELD_MAX_BLOOMS; i += 1) {
    blooms.push(new THREE.Vector4(0, 0, 0, 0));
  }
  return new THREE.ShaderMaterial({
    uniforms: {
      uDensity: { value: null },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uTint: { value: mediumTint() },
      uGrainPx: { value: POPULATION_FIELD_GRAIN_PX },
      uGrainAmount: { value: POPULATION_FIELD_GRAIN_AMOUNT },
      uGrainPhase: { value: 0 },
      uBloomCount: { value: 0 },
      uBlooms: { value: blooms },
    } satisfies PopulationCompositeUniforms,
    side: THREE.BackSide,
    // The chain mesh sits under the Cell plane and has to stay visible
    // THROUGH the medium; that is what transparency is for. Depth-testing a
    // back face against it would instead erase the medium wherever something
    // opaque happened to be behind it.
    depthTest: false,
    depthWrite: false,
    transparent: true,
    blending: THREE.NormalBlending,
    // No tone mapping (the chunk is simply never included), but the output IS
    // colour-space encoded — see the colorspace_fragment include below.
    toneMapped: false,
    vertexShader: /* glsl */ `
      void main() {
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform sampler2D uDensity;
      uniform vec2  uResolution;
      uniform vec3  uTint;
      uniform float uGrainPx;
      uniform float uGrainAmount;
      uniform float uGrainPhase;
      uniform int   uBloomCount;
      uniform vec4  uBlooms[${POPULATION_FIELD_MAX_BLOOMS}];

      ${SLAB_GLSL}

      void main() {
        vec2 screenUv = gl_FragCoord.xy / uResolution;
        float coverage = texture2D(uDensity, screenUv).r;

        // The blooms mark where a Cell condensed out of, or dissolved into,
        // the medium. They are additive INTO the medium, so they can only be
        // seen where the medium is — a bloom in vacuum would be an object.
        float bloom = 0.0;
        for (int i = 0; i < ${POPULATION_FIELD_MAX_BLOOMS}; i++) {
          if (i >= uBloomCount) break;
          vec4 b = uBlooms[i];
          vec2 centre = (b.xy * 0.5 + 0.5) * uResolution;
          float radius = max(b.w, 1.0);
          float d = length(gl_FragCoord.xy - centre) / radius;
          // Rise fast, leave slowly: an entry has to be READ as an arrival
          // without ever gaining the snap of a death.
          float life = clamp(b.z, 0.0, 1.0);
          float envelope = sin(life * 3.14159265) * (1.0 - life * 0.35);
          bloom += exp(-d * d * 3.0) * envelope;
        }
        bloom = min(bloom, 1.5);

        float total = clamp(coverage + bloom * 0.35 * max(coverage, 0.12), 0.0, 1.0);
        if (total <= 0.0015) discard;

        // Screen-locked grain. The cell index comes from gl_FragCoord, so its
        // frequency is fixed to the display and cannot be resolved by moving
        // the camera. Amplitude follows optical depth, so grain lives where
        // matter is.
        vec2 grainCell = floor(gl_FragCoord.xy / max(uGrainPx, 0.5));
        float g1 = hash21(grainCell + uGrainPhase);
        float g2 = hash21(floor(gl_FragCoord.xy) * 0.7 - uGrainPhase * 1.3);
        float grain = (g1 - 0.5) * 1.4 + (g2 - 0.5) * 0.6;
        float luminance = 1.0 + grain * uGrainAmount * total;

        vec3 col = uTint * max(luminance, 0.0) + vec3(bloom * 0.22);
        gl_FragColor = vec4(col, total);
        #include <colorspace_fragment>
      }
    `,
  });
}
