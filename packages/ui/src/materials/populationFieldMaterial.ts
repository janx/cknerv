// The unresolved population, as a swarm.
//
// Two passes, and the split is forced by what the two halves are made of.
//
//  1. DENSITY — quarter resolution, offscreen. Marches the baked positional
//     law through the tissue slab and writes one number per texel: what
//     FRACTION of this pixel's screen cell the unresolved population lights
//     up. That term is low-frequency by construction — it is a warped
//     multi-octave field over a 60x54 ellipse, with no detail below several
//     world units — so quarter resolution is lossless for it and a quarter of
//     the marching cost.
//
//  2. COMPOSITE — full resolution. Turns that fraction into the thing itself:
//     a stochastic population of screen-space specks, two DEVICE pixels wide,
//     of which exactly that fraction are lit.
//
// The swarm is not a texture applied to a medium. The swarm IS the medium.
// That distinction is the whole feature, and getting it wrong once already
// cost a ship: a continuous term, however exact its density, reads as FOG,
// and fog is one substance whose only variable is how much of it there is. A
// population is not a quantity of stuff — it is a count of things too small
// to separate. So the field sets HOW MANY SPECKS ARE LIT, never how bright a
// wash is.
//
// Three consequences, and they are why this shape is right:
//
//  - It cannot be read as atmosphere. Discrete lit points on black are never
//    fog, at any brightness.
//  - The resolution argument becomes literal. Specks are sized in DEVICE
//    pixels, so flying closer spreads the field without ever making a speck
//    larger or countable. The limit is the instrument, not the distance.
//  - Figure/ground needs no tonal trick. Cells are large, peaked and
//    near-white at the core; specks are two pixels and dim. Same light,
//    different resolution — which is exactly the claim.
//
// Everything here EMITS and nothing covers. Alpha-over was the original bug:
// it lifts true black across the whole envelope, which is the optical
// signature of atmosphere BETWEEN the viewer and the subject, and that single
// choice was enough to drape the galaxy in white fog. Every term below is
// positive, and a pixel with no population under it is discarded before it
// can contribute anything at all.

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
 * How densely the swarm populates the screen, per unit of integrated density,
 * before `gain`.
 *
 * The math is unchanged and still Beer-Lambert: optical depth is
 * `gain * SWARM_DENSITY * ∫ρ dl`, and `1 - exp(-τ)` saturates it into [0, 1).
 * What changed is what that number MEANS. It used to be an alpha — how opaque
 * a wash is — and the name `EXTINCTION` said so, which is why it is gone:
 * nothing here extinguishes anything. It is now the LIT FRACTION: out of every
 * hundred screen cells under this ray, how many the unresolved population
 * lights up. Same curve, and the value below survives the reinterpretation
 * unchanged, because both readings are answering "how much of the swarm is
 * lit".
 *
 * The acceptance test this is calibrated against (§6.1 test 1): **inside the
 * envelope, the space between Cells must not be empty.** Black between Cells
 * reads as "nothing there", and no amount of correctness in the density term
 * can make an invisible layer state anything.
 *
 * The first calibration failed it. At 0.21 and the measured mainnet gain of
 * 0.58, ordinary mid-field tissue (areal density ≈ 0.23) reached a lit
 * fraction of 0.16 and the layer averaged 0.12 — one speck in eight, which
 * beside a bright Cell field in the same envelope is indistinguishable from
 * absence.
 *
 * At 0.84 the same mid-field lights about half its cells and the densest
 * tissue about nine in ten, so the space between Cells is a crowd rather than
 * a void, and the cavities and corridors the field has always contained
 * become legible as gaps in that crowd. Re-derived against the swarm and kept:
 * this is also the value the accepted reference render was made at.
 *
 * This is the live-tuning lever for the population's presence. Nothing else
 * here should be reached for first — `gain` is calibration and the density
 * term is the chain's own law, but this number is taste.
 */
export const POPULATION_FIELD_SWARM_DENSITY = 0.84;

/**
 * Speck size, in DEVICE pixels. Sized on the display and never in the world:
 * that is what makes flying closer spread the population out without ever
 * resolving one of its members.
 *
 * §5 allows 1.5–2.5; two is the only INTEGER in that window and the reason
 * matters. `floor(gl_FragCoord.xy / size)` at a fractional size produces
 * screen cells that alternate between one and two pixels wide on a beat — at
 * 1.7 the pattern repeats every ten cells, and that beat is a low-frequency
 * structure laid over a layer whose entire job is to have none. At two, every
 * cell is exactly 2×2 device pixels and the grid is silent.
 */
export const POPULATION_FIELD_SPECK_PX = 2;

/**
 * The swarm reseeds this many times per second, per speck.
 *
 * A screen-locked mask that never moves is a screen door: the galaxy rotates
 * behind a fixed pattern and the pattern wins. Reseeding turns it into
 * scintillation, which is also the honest reading — a photon-limited
 * instrument cannot hold any individual still.
 *
 * The failure mode on the other side is TV static, and static has a specific
 * cause: the WHOLE FIELD re-rolling in lockstep, so the eye sees a frame
 * boundary instead of a population. That is why each screen cell carries its
 * own phase offset (see `uSwarmPhase` in the composite) — every speck reseeds
 * at this rate, but no two reseed at the same instant, so there is no global
 * event to perceive. Rate, speck size, and the continuum fraction are the
 * three live-tuning levers.
 */
export const POPULATION_FIELD_SPECK_RESEED_HZ = 11;

/**
 * The faint continuum under the swarm, as a fraction of full emission.
 *
 * Without it the densest tissue reads as dots rather than as solid matter: at
 * a lit fraction of 0.9 the eye still finds the one unlit cell in ten and
 * counts holes. A fifth of the emission spread evenly closes those holes
 * while leaving the speck population carrying the signal.
 *
 * It is a floor, never a wash — it is scaled by the same lit fraction, so
 * where there is no population there is no continuum either.
 */
export const POPULATION_FIELD_CONTINUUM_FRACTION = 0.22;

/** Emission of one lit speck, before its brightness spread. */
export const POPULATION_FIELD_SPECK_GAIN = 0.9;

/**
 * Dimmest a lit speck may be, as a fraction of the brightest.
 *
 * The spread exists so the swarm does not read as a halftone screen of
 * identical dots. It is one-sided on purpose: unresolved light never
 * subtracts, and a speck that dipped below the continuum would paint a dark
 * point — dirt, not scintillation.
 */
export const POPULATION_FIELD_SPECK_FLOOR = 0.55;

/**
 * Overall emission scale, applied to the body tint.
 *
 * This is the bound in §11: peak speck brightness must stay below a single
 * resolved Cell's core, so no patch of swarm can be mistaken for a Cell and
 * the discrete bodies sit in front tonally without any veil pushing them
 * there. A far Cell's core is `warmWhite` mixed 0.72 into its body colour at
 * unit peak — near-white, luminance ≈ 0.95. The brightest possible speck here
 * is a fully lit cell at a lit fraction of 0.92, which is body rose at
 * luminance ≈ 0.43. Less than half, and a saturated hue against a near-white
 * one: the two cannot be confused even where they touch.
 */
export const POPULATION_FIELD_EMISSION_PEAK = 0.85;

/** Concurrent membership blooms. Ring-allocated by the caller; the shader
 *  loop breaks at the live count, so the ceiling costs nothing until it is
 *  actually reached. */
export const POPULATION_FIELD_MAX_BLOOMS = 64;

/**
 * A dissolve is not a death.
 *
 * Death owns its event signature — its own colour and `DEATH_DURATION_MS` of
 * 600. A Cell leaving the stage is ALIVE on chain, so its mark has to be
 * slower and quieter, or the eye's death count stops matching the HUD's and
 * this layer has to be cut.
 */
export const POPULATION_FIELD_BLOOM_MS = 1400;

/**
 * Emission of one screen cell of the swarm — the composite's whole colour
 * math, as a scalar.
 *
 * The GLSL below is driven by the same constants through uniforms, so this is
 * the shape the shader evaluates rather than a paraphrase of it. Two
 * properties are worth stating as code because they are the two that were got
 * wrong before:
 *
 *  - **Zero in, zero out.** No population under a pixel means no light from
 *    it, at any speck brightness, so empty space keeps its true black.
 *  - **Positive only.** Nothing here can subtract. A grain that dipped below
 *    its base level painted dark speckles, and dirt is not a population.
 *
 * @param litFraction share of screen cells the population lights, in [0, 1]
 * @param pick        the cell's mask draw, in [0, 1)
 * @param spread      the cell's brightness draw, in [0, 1)
 */
export function populationSwarmEmission(
  litFraction: number,
  pick: number,
  spread: number,
): number {
  const lit = Math.min(Math.max(litFraction, 0), 1);
  const continuum = lit * POPULATION_FIELD_CONTINUUM_FRACTION;
  // The mask threshold IS the population statement: a cell is lit exactly when
  // its uniform draw falls under the local fraction, so the COUNT of lit
  // specks per unit screen area carries the number. Speck brightness carries
  // nothing, which is why the spread below is narrow and centred.
  if (pick >= lit) return continuum;
  const brightness = POPULATION_FIELD_SPECK_FLOOR
    + (1 - POPULATION_FIELD_SPECK_FLOOR) * spread;
  // The second `lit` is not a second population claim, it is the rim: at the
  // envelope's edge the fraction is a few percent, and specks that stayed at
  // full brightness there would be a scatter of isolated bright points — the
  // one thing a user could actually count, which rule 10 forbids. Fading them
  // as they thin out lets the population end instead of fraying into stars.
  return continuum + brightness * lit * POPULATION_FIELD_SPECK_GAIN;
}

/**
 * The swarm's colour: the organism's own body light, at full saturation.
 *
 * Two rules meet here and they point opposite ways. The field carries NO
 * IDENTITY hue — asset, lock and tag palettes are forbidden, because a hue
 * that means something elsewhere would make an aggregate look like a claim
 * about which Cells it contains. But it MUST carry the BODY hue, because the
 * resolved and the unresolved are the same kind of thing separated by
 * resolution alone, and unresolved starlight is the same light as its stars.
 *
 * The previous version resolved that tension by desaturating a quarter of the
 * way toward grey, and grey over a coloured scene is atmospheric perspective —
 * the eye has exactly one word for it, and the word is fog. Full saturation,
 * no level trim, straight from the Cells' own palette.
 */
function swarmTint(): THREE.Color {
  return new THREE.Color().setRGB(...CELL_GALAXY_PALETTE.tissueRose);
}

/** Helpers both fragment programs are compiled with. The composite needs only
 *  the hash; the density pass needs both. They share one text so the hash the
 *  march dithers with and the hash the swarm is drawn from cannot drift into
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

  // Deterministic per-pixel hash. Two jobs. In the march it dithers the
  // starting offset, because eight steps through a smooth field band visibly
  // and dithering trades those bands for noise. In the composite it IS the
  // population: the swarm's mask is a threshold on this, so its uniformity is
  // load-bearing — a biased hash would make the lit fraction disagree with the
  // count the field is stating. Measured against the real bake it tracks the
  // field to within 0.2% at every level.
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
 * would be paying for nothing) and writes the lit fraction to R.
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

        // The population reaches the screen through the same law it
        // accumulates by. This number is not an opacity — the composite reads
        // it as the FRACTION of screen cells the unresolved population lights
        // up, and nothing downstream ever treats it as an alpha.
        float litFraction = 1.0 - exp(-tau * uOpticalDepth);
        gl_FragColor = vec4(litFraction, 0.0, 0.0, 1.0);
      }
    `,
  });
}

export interface PopulationCompositeUniforms {
  uDensity: { value: THREE.Texture | null };
  uResolution: { value: THREE.Vector2 };
  uTint: { value: THREE.Color };
  uSpeckPx: { value: number };
  uContinuum: { value: number };
  uSpeckGain: { value: number };
  uSpeckFloor: { value: number };
  uPeak: { value: number };
  uSwarmPhase: { value: number };
  uBloomCount: { value: number };
  /** xy = NDC centre, z = life in [0, 1], w = radius in device pixels. */
  uBlooms: { value: THREE.Vector4[] };
}

/**
 * Pass 2. Turns the lit fraction into the swarm.
 *
 * This is where the layer either states a population or drapes a veil, and
 * the difference is entirely in the blend. It accumulates — `src` at full
 * weight, `dst` scaled by what is left of the channel — so it can only ever
 * ADD light to what is behind it, and a zero contribution leaves the
 * destination byte-identical. Alpha-over could not make that promise: it
 * multiplies the destination by `1 - a`, which means the layer DARKENS
 * whatever it covers and lifts true black toward its own tint everywhere its
 * envelope reaches. That reads as atmosphere between the viewer and the
 * subject, and it is what destroyed the scene the first time.
 *
 * Bounded screen rather than plain additive, matching `cellHybridMaterial`:
 * nine cells in ten are lit at the galaxy's core, and piling that additively
 * onto the chain mesh underneath would blow both out. Over the scene's
 * near-black the two are within 2/255 of each other; over anything bright the
 * bounded form is the one that survives.
 *
 * The blooms live here rather than in the density march for the same reason
 * the swarm does: they are a screen-scale mark, and a quarter-resolution one
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
      uTint: { value: swarmTint() },
      uSpeckPx: { value: POPULATION_FIELD_SPECK_PX },
      uContinuum: { value: POPULATION_FIELD_CONTINUUM_FRACTION },
      uSpeckGain: { value: POPULATION_FIELD_SPECK_GAIN },
      uSpeckFloor: { value: POPULATION_FIELD_SPECK_FLOOR },
      uPeak: { value: POPULATION_FIELD_EMISSION_PEAK },
      uSwarmPhase: { value: 0 },
      uBloomCount: { value: 0 },
      uBlooms: { value: blooms },
    } satisfies PopulationCompositeUniforms,
    side: THREE.BackSide,
    // The chain mesh sits under the Cell plane and has to stay visible
    // THROUGH the swarm. Emission is what keeps it there: the layer adds its
    // own light and removes none of the mesh's, so depth-testing a back face
    // against it would only erase the swarm wherever something opaque
    // happened to be behind it.
    depthTest: false,
    depthWrite: false,
    transparent: true,
    // Bounded screen accumulation: `src * 1 + dst * (1 - src)`, per channel.
    // Zero src leaves dst exactly as it was — that is rule 12 made structural
    // rather than a matter of restraint — and no src can ever reduce a
    // channel, so this layer cannot darken anything.
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcColorFactor,
    blendEquationAlpha: THREE.AddEquation,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    // No tone mapping and NO colour-space encode, exactly like
    // `cellHybridMaterial` — the Cell bodies write their palette values
    // straight to the framebuffer, so encoding here would put the swarm on a
    // second gamma curve and lift the body rose from rgb(255,102,112) to
    // rgb(255,170,177): a pale pink instead of the Cells' own colour. "The
    // same light" is a pixel-level claim, and this is where it is kept.
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
      uniform float uSpeckPx;
      uniform float uContinuum;
      uniform float uSpeckGain;
      uniform float uSpeckFloor;
      uniform float uPeak;
      uniform float uSwarmPhase;
      uniform int   uBloomCount;
      uniform vec4  uBlooms[${POPULATION_FIELD_MAX_BLOOMS}];

      ${SLAB_GLSL}

      void main() {
        vec2 screenUv = gl_FragCoord.xy / uResolution;
        float field = texture2D(uDensity, screenUv).r;

        // Nothing unresolved under this pixel, so nothing to say about it.
        // This sits BEFORE the blooms deliberately: the bloom term has a
        // floor that keeps it legible in faint tissue, and without this gate
        // that floor would let a transition mark paint light where the
        // population is zero — a bloom in vacuum, which is an object, not a
        // dissolve. Empty space keeps its true black on this line.
        if (field <= 0.0015) discard;

        // The blooms mark where a Cell condensed out of, or dissolved into,
        // the population. They raise the LOCAL LIT FRACTION rather than
        // adding a glow of their own: a transition is a crowd thickening
        // where a Cell arrived or left, which keeps it inside the swarm's
        // language instead of laying a second substance over it.
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

        float amount = clamp(field + bloom * 0.35 * max(field, 0.12), 0.0, 1.0);

        // The swarm. Screen cells of uSpeckPx DEVICE pixels, of which exactly
        // "amount" of them are lit — the field sets HOW MANY specks are lit,
        // never how bright a wash is. The cell index comes from gl_FragCoord,
        // so the scale is fixed to the display and no camera move resolves it.
        vec2 cell = floor(gl_FragCoord.xy / max(uSpeckPx, 1.0));

        // Per-cell phase. Every speck reseeds at the same RATE, but this
        // offset spreads the instants uniformly across the period, so the
        // field never re-rolls as a whole. That lockstep re-roll is what makes
        // noise read as TV static; without it the same rate reads as
        // scintillation, which is the honest signature of a photon-limited
        // instrument. Reduced motion pins uSwarmPhase to zero and the whole
        // pattern freezes, deterministically, with the lit fraction — and so
        // every count — exactly where it was.
        float jitter = hash21(cell * 1.37 + 11.7);
        float epoch = floor(uSwarmPhase + jitter);
        float pick = hash21(cell + epoch * 17.13);
        float spread = hash21(cell * 0.7 + epoch * 5.71 + 3.3);

        // step(pick, amount) is 1 exactly when the cell's draw falls under the
        // local fraction. Every term from here is positive: unresolved light
        // never subtracts, and a speck dipping below the continuum would paint
        // a dark point — dirt, not scintillation.
        float lit = step(pick, amount)
          * (uSpeckFloor + (1.0 - uSpeckFloor) * spread);
        float emission = amount * uContinuum + lit * amount * uSpeckGain;

        gl_FragColor = vec4(uTint * emission * uPeak, emission * uPeak);
      }
    `,
  });
}
