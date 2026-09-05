import * as THREE from 'three';
import {
  HASH11_GLSL,
  BIRTH_DEATH_GLSL,
  STAGE_ENVELOPE_GLSL,
} from './cellEnvelope.glsl';
import {
  BIRTH_DURATION_MS,
  DEATH_DURATION_MS,
  ENTER_FADE_MS,
  EXIT_FADE_MS,
} from '../geometry/cellPositions';
import { CONSENSUS_BRAID_PALETTE } from '../derives/consensusBraid.derive';
import {
  CONSENSUS_MEMORY_CORE_READ_FLOOR,
  CONSENSUS_MEMORY_CORE_RELEASE_EXPONENT,
} from '../derives/consensusMemoryCore.derive';
import {
  CONSENSUS_MEMORY_HANDOFF_END,
  CONSENSUS_MEMORY_HANDOFF_START,
} from '../derives/consensusMemoryLod.derive';
import { CELL_GALAXY_PALETTE, SCENE_ACCENT_PALETTE, type SceneColor } from '../visualPalette';

/**
 * Single-peak Gaussian cloud baseline for each Cell.
 *
 * - Resting state: one central Gaussian peak anchored at sprite center + a
 *   faint outer halo wash. The cell's brightest pixel always sits at sprite
 *   center (= fabric endpoint at cell.pos_seed), so fiber glow and cell glow
 *   share the same Gaussian language and meet at luminous junctions.
 * - Resting bodies use bounded screen accumulation. Thousands of overlapping
 *   Cells can therefore approach consensus-white without numerically blasting
 *   through it. The nerve-pulse discharge flare still renders in a separate
 *   additive layer (materials/cellFlareMaterial.ts), preserving event urgency.
 *
 * New-block delivery can still flash exact Cells through `aFlashAt`; the broad
 * brightness shockwave belongs to the peer network and is intentionally absent
 * from this material.
 */

// Tunable feel constants — collected here so reviewers find them in one place.
/** Sprite world→screen multiplier. Exported because the population halo is
 *  the same material family and has to shrink with distance at exactly the
 *  same rate — a second copy of this number is a seam waiting to open. */
export const HYBRID_BASE_PX_PER_WU = 2.0; // sprite world→screen multiplier — ~2× halo outer-glow size; cell body (gl_PointCoord ≤ 0.5) renders at roughly halo-equivalent screen weight
/** How far a newborn's body is pulled toward the white core it already mixes
 *  toward at its peak. Spends itself over the birth ramp, so a settled cell
 *  is byte-identical to one that was never born on this screen. */
export const BIRTH_BLOOM = 0.55;
/** Ramp fraction the withering has finished cooling by, and how much of the
 *  cooled target stays ember rather than ash. Chroma leaves first: an
 *  identity colour on a corpse is a lie the body no longer supports. */
export const WITHER_COOL_END = 0.62;
export const WITHER_EMBER_TINT = 0.6;
/**
 * How much of the retirement signal a corpse ever wears. ⟨D-9 = ember⟩
 *
 * ⚠️ THE COOLING USED TO BE WRITTEN OVER BY THE MAGENTA IT WAS WRITTEN BEFORE.
 * The retire mix ran `smoothstep(0, 0.48, ramp)` and was unconditional, so at
 * 30 % of the ramp the pixel was already two-thirds magenta and from 48 % it
 * was magenta outright — the documented ember cooling reached the screen for
 * about a third of a second and then stopped existing. Two intents were pinned
 * by two tests and only one of them was ever true.
 *
 * D-9 picks ember, and the shape follows: the retire is the LAST WORD, not the
 * sentence. It opens where the cooling closes (`WITHER_COOL_END`) and reaches
 * this cap at the very end, so a corpse cools through the galaxy's own ember
 * for two-thirds of its life and only turns toward the signal as it goes. The
 * cap is what keeps the end from being pure magenta: the fabric's own 220 ms
 * retire flash still speaks that colour outright (`fabricEdgeRender`), and one
 * surface saying it plainly is the reason this one may say it quietly.
 *
 * Measured on the tissue's own rose, hue in degrees: ramp 0.3 → 6°, 0.5 → 17°,
 * 0.62 → 20° (the ember's own), 0.85 → 356°, 1.0 → 347°. Before: 341° at 0.3
 * and 335° — the retire, exactly — from 0.48 on.
 */
export const WITHER_RETIRE_MAX = 0.55;
/** Guttering: two incommensurate rates so the flutter never reads as a
 *  metronome, and a depth shallow enough that the corpse never blinks out
 *  before `deathEase` takes its size. */
export const WITHER_GUTTER_RATE = 11.0;
export const WITHER_GUTTER_DEPTH = 0.55;

/**
 * The corpse's colour at a point on the death ramp, in TypeScript.
 *
 * The fragment's own arithmetic, from the same constants, so "a withering cell
 * is ember and not magenta" is a claim a test can take rather than one a
 * screenshot has to catch — a wither is 1.8 s long, a few pixels wide, and
 * follows a block by about two seconds, which is why the defect lived through
 * two rounds of live captures with both intents test-pinned.
 *
 * `body` is the resting colour the fragment carries into the branch. Every
 * other term there (focus, birth, recall) resolves to identity on a cell that
 * is simply dying, so this is the whole of it. `cellHybridMaterial.test.ts`
 * reads the shipped GLSL beside this rather than trusting the resemblance.
 */
export function witherCorpseColor(body: SceneColor, ramp: number): SceneColor {
  const smoothstep = (a: number, b: number, x: number): number => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  const mix = (a: SceneColor, b: SceneColor, t: number): SceneColor => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
  // Rec.601 luma, the shader's own `ash`.
  const luma = body[0] * 0.299 + body[1] * 0.587 + body[2] * 0.114;
  const cooled = mix(
    [luma, luma, luma],
    CELL_GALAXY_PALETTE.ember,
    WITHER_EMBER_TINT,
  );
  const cool = mix(body, cooled, smoothstep(0, WITHER_COOL_END, ramp));
  return mix(
    cool,
    CONSENSUS_BRAID_PALETTE.retire,
    WITHER_RETIRE_MAX * smoothstep(WITHER_COOL_END, 1, ramp),
  );
}

/** A colour's hue in degrees, for reading a corpse against the ember. */
export function sceneColorHue(color: SceneColor): number {
  const [r, g, b] = color;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  const h = max === r
    ? ((g - b) / d) % 6
    : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return ((h * 60) % 360 + 360) % 360;
}

/**
 * ⟨ruling 22⟩ THE GALAXY'S RADIANCE — one gain on the light the tissue and its
 * halo emit, and on nothing else.
 *
 * The cells galaxy is the FIRST focus of this canvas and the user's word for
 * what it should read as is 光辉灿烂 — radiant. The camera gives it the stage
 * back (`ui-app/src/camera-hole-fit.ts`); how much light it spends on that
 * stage is a separate decision and a matter for the eye, not for a
 * measurement. So it is a knob, parked at 1, where 1 is byte-for-byte the
 * picture that shipped — and the eye turns it from the Tweaks panel against
 * the live scene rather than through a capture-edit-capture loop.
 *
 * ## What it is a gain ON, and what it must never touch
 *
 * The two body materials' RESTING alpha: a Cell's own cloud and the halo's
 * beads and strokes. Not events — a focus ring, a write flare, a landing, a
 * recall scan all reclaim headroom above the resting field on purpose, and a
 * gain that carried them would move the very contrast this scene is built to
 * hold. Not the peer plane, not the colony: the mesh is the canvas's SECOND
 * focus and its light answers to its own tier ladder (see
 * `peerNodeMaterial.ts`).
 *
 * ⚠️ Above 1 it is a CEILING and not a blow-out. Both materials write
 * premultiplied alpha into a bounded screen accumulation, so a fragment
 * already at full emission cannot go past it and only the pixels with headroom
 * move. Turning the knob up brightens the tissue's mid-tones toward the peaks
 * it already has; it cannot invent a new peak, and black stays black because
 * a gain on zero is zero.
 */
export const GALAXY_RADIANCE_IDENTITY = 1;

/**
 * The gain in arithmetic, so the knob is decidable without a GPU and both
 * materials read ONE law. A non-finite or negative setting is the identity:
 * a tuning panel is not an input validator, and a scene that goes black
 * because a text field was mid-edit is a worse answer than a scene that
 * ignores it.
 */
export function galaxyRadianceGain(radiance: number): number {
  if (!Number.isFinite(radiance) || radiance < 0) return GALAXY_RADIANCE_IDENTITY;
  return radiance;
}

/**
 * ⟨D-10 · knob c⟩ HALF-SPREAD OF THE DISC IN VIEW DEPTH, as a fraction of the
 * camera's own distance to the galaxy's centre.
 *
 * Measured at the reviewed pose (report D, D-4): near rim 119 world units of
 * view depth, centre 171, far rim 223 — so the rim sweeps ±0.30 of the centre
 * distance. It is a fraction and not a distance precisely so it holds as the
 * camera dollies: the disc's angular extent is what the term is normalising
 * against, and that is very nearly constant under a dolly.
 */
export const BODY_DEPTH_HALF_SPREAD = 0.3;

/**
 * ⟨D-10 · knob c⟩ The depth-keyed energy term, shared by the two body
 * materials so the Cells and the halo's beads answer to ONE law.
 *
 * ## The finding
 *
 * The far half of the galaxy is BRIGHTER than the near half. Measured on the
 * rose mask of the idle frame, split at its own centroid row: far mean luma
 * 0.224 (p90 0.413), near 0.189 (p90 0.365). Nothing in this scene is fogged,
 * every material is `depthWrite:false`, and both blends sum light per pixel —
 * so perspective compressing the far half into fewer pixels deposits more
 * population per pixel there, while size attenuation makes near sprites larger
 * but not brighter per unit area. A form has a front when the front is
 * brighter, sharper or larger than the back; here the back is brighter and the
 * front is only larger.
 *
 * ## Why it is a scale on emission and NOT a fog
 *
 * ⚠️⚠️ An alpha-over wash is the one thing this must never become. Every
 * material in this layer emits and never covers, so a pixel with no
 * unresolved population receives exactly zero and empty space stays true
 * black; a tint at any opacity lifts that black across the envelope, which is
 * the optical signature of atmosphere between the viewer and the subject. That
 * choice is enough to destroy the scene and it has been made once already.
 *
 * So this returns a MULTIPLIER on emitted alpha, bounded above by 1: the near
 * half is untouched at any setting and the far half is spent down. Nothing
 * brightens, nothing is added, and black stays black.
 *
 * `amount` 0 returns exactly 1 everywhere — **today's picture, and the
 * default.**
 */
export const BODY_DEPTH_ENERGY_GLSL = /* glsl */ `
float bodyDepthEnergy(float viewZ, float centerZ, float amount) {
  // How far behind (or in front of) the galaxy's own centre this body sits, in
  // units of the camera's distance to that centre. The centre is the world
  // origin, so its view depth is free — no uniform, and no way for a uniform
  // to disagree with where the group actually is.
  float ratio = viewZ / max(centerZ, 0.001);
  float t = clamp(
    (ratio - (1.0 - ${BODY_DEPTH_HALF_SPREAD.toFixed(2)}))
      / ${(2 * BODY_DEPTH_HALF_SPREAD).toFixed(2)},
    0.0,
    1.0
  );
  // Linear in the depth, not smoothstepped: the reading being corrected is an
  // accumulation gradient across the whole disc, and an S-curve would leave the
  // two rims — where the near/far split is actually read — barely separated.
  return 1.0 - clamp(amount, 0.0, 1.0) * t;
}
`;

/**
 * The same law in arithmetic, so the treatment is DECIDABLE without a GPU.
 *
 * `depthRatio` is a body's view depth over the camera's own distance to the
 * galaxy's centre — 1 at the centre, `1 ∓ BODY_DEPTH_HALF_SPREAD` at the two
 * rims. A source test pins the shipped GLSL to this twin, which is the
 * precedent the cohort's own flare set: a term nobody can evaluate on the CPU
 * is a term nobody can argue about.
 */
export function bodyDepthEnergyValue(
  depthRatio: number,
  amount: number,
): number {
  const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
  const t = clamp01(
    (depthRatio - (1 - BODY_DEPTH_HALF_SPREAD)) / (2 * BODY_DEPTH_HALF_SPREAD),
  );
  return 1 - clamp01(amount) * t;
}

export function makeCellHybridMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime:            { value: 0 },
      // The AMBIENT clock. Same seconds as `uTime` normally; held at a fixed
      // phase for a visitor who asked for stillness, so the canopy's breath
      // and the memory read's scan stop while every birth, wither and stage
      // fade above keeps the real clock and finishes (D-11, `MOTION_POLICY`).
      uAmbientTime:     { value: 0 },
      uBirthDurS:       { value: BIRTH_DURATION_MS / 1000 },
      uDeathDurS:       { value: DEATH_DURATION_MS / 1000 },
      // Stage windows read their constant directly: the dot and the flare
      // must resolve over the identical span, and a second literal here is a
      // seam waiting to open.
      uEnterDurS:       { value: ENTER_FADE_MS / 1000 },
      uExitDurS:        { value: EXIT_FADE_MS / 1000 },
      uViewportHeight:  { value: 800 },
      uPixelRatio:      { value: 1 },
      uMemoryMinPointPx: { value: 24 },
      uMemoryLinePx:    { value: 0.55 },
      uMemorySignalEnergy: { value: 1 },
      uWarmth:          { value: 0.12 }, // living rose body → ember bias; set live from LIVE.cell.warmth
      uCenterDim:       { value: 0.3 }, // shared centre-energy floor; passive fabric applies its stronger squared form
      // ⟨D-10 · knob c⟩ 0 is today's picture: no depth term at all. See
      // `BODY_DEPTH_ENERGY_GLSL`; set live from LIVE.cell.bodyDepthEnergy.
      uDepthEnergy:     { value: 0 },
      // ⟨ruling 22⟩ The galaxy's radiance, on the resting body alone. 1 is
      // today's picture exactly. See `galaxyRadianceGain`; set live from
      // LIVE.cell.galaxyRadiance by `CellGalaxy`.
      uRadiance:        { value: GALAXY_RADIANCE_IDENTITY },
    },
    transparent: true,
    depthWrite: false,
    // Screen-like accumulation bounds the resting information field. The
    // protocol flare layer remains additive, so real writes still break above
    // the shared structure instead of flattening into it.
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.SrcAlphaFactor,
    blendDst: THREE.OneMinusSrcColorFactor,
    blendEquationAlpha: THREE.AddEquation,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    toneMapped: false,
    vertexShader: /* glsl */ `
      attribute vec3  aColor;
      // Paired clocks ride one vec2 each. ESSL 3.00 spends a vertex slot on
      // every DECLARED attribute — unused ones are not eliminated — and
      // three.js injects position/normal/uv into every ShaderMaterial, so a
      // 16-slot driver leaves this material 13 of its own. Both halves of a
      // pair are written by one path, so packing costs nothing but the
      // swizzle. See __tests__/materials/vertexAttributeBudget.test.ts.
      attribute vec2  aRecordAt; // record clock: x = birth, y = death (+1e9 = alive)
      attribute vec2  aStageAt;  // stage clock: x = resolution in (-1e9 = always on), y = release out (+1e9 = not exiting)
      attribute float aSize;
      attribute vec4  aMemoryIdentity; // normalized asset / lock / payload / mass
      attribute float aMemorySeed; // stable content-hash word; never draw-order based
      attribute float aDetail;  // LOD: 0 for all far cells (glow unchanged); ramps →1 as the camera nears, softening the white-hot peak so the nucleus shows
      attribute float aFocus;   // eased interaction: 0 resting, ~0.46 hover, 1 selected
      attribute float aRecall;  // signed historical read: source < 0, retained target > 0
      attribute float aRecallState; // source travel / target witness resolution

      uniform float uTime;
      uniform float uAmbientTime;
      uniform float uBirthDurS;
      uniform float uDeathDurS;
      uniform float uEnterDurS;
      uniform float uExitDurS;
      uniform float uViewportHeight;
      uniform float uPixelRatio;
      uniform float uMemoryMinPointPx;
      uniform float uWarmth;
      uniform float uCenterDim;
      uniform float uDepthEnergy;

      varying float vBirthRamp;
      varying float vDeathRamp;
      varying float vStageAlpha;
      varying float vSeed;
      varying vec4  vMemoryIdentity;
      varying float vDetail;
      varying float vFocus;
      varying float vRecall;
      varying float vRecallState;
      varying float vCenterDim;
      varying float vDepthDim;
      varying float vPointCssPx;
      varying vec3  vBodyColor;
      varying vec3  vHotColor;
      // x = inverse breathing sigma squared; y = peak LOD gain;
      // z = outer-wash LOD gain. All three are constant across one point.
      varying vec3  vCloudParams;

      ${BIRTH_DEATH_GLSL}
      ${STAGE_ENVELOPE_GLSL}
      ${HASH11_GLSL}
      ${BODY_DEPTH_ENERGY_GLSL}

      void main() {
        vMemoryIdentity = aMemoryIdentity;
        vDetail = aDetail;
        vFocus = aFocus;
        vRecall = aRecall;
        vRecallState = aRecallState;
        float birthRamp = clamp((uTime - aRecordAt.x) / uBirthDurS, 0.0, 1.0);
        float deathRamp = clamp((uTime - aRecordAt.y) / uDeathDurS, 0.0, 1.0);
        float bEase = birthEase(birthRamp);
        float dEase = deathEase(deathRamp);
        vec2 stage = stageEnvelope(
          stageEase(stageRamp(uTime, aStageAt.x, uEnterDurS)),
          stageEase(stageRamp(uTime, aStageAt.y, uExitDurS))
        );
        float scale = bEase * (1.0 - dEase) * stage.x;

        vBirthRamp = birthRamp;
        vDeathRamp = deathRamp;
        vStageAlpha = stage.y;
        vSeed      = aMemorySeed * 91.73
          + dot(position, vec3(0.071, 0.113, 0.173));

        // These values depend on the Cell and frame, never on gl_PointCoord.
        // Evaluate them once per Cell instead of once per covered fragment.
        float breathRate = 0.7 + 0.6 * hash11(vSeed + 7.7);
        float breath = 1.0 + 0.08 * sin(uAmbientTime * breathRate + vSeed);
        float sigma = 0.10 * breath;
        vec3 ember = mix(
          aColor,
          vec3(${CELL_GALAXY_PALETTE.ember.join(', ')}),
          0.55
        );
        vBodyColor = mix(aColor, ember, uWarmth);
        vHotColor = mix(
          vBodyColor,
          vec3(${CELL_GALAXY_PALETTE.warmWhite.join(', ')}),
          0.72
        );
        vCloudParams = vec3(
          1.0 / (sigma * sigma),
          1.0 - aDetail * 0.92,
          0.18 * (1.0 - aDetail * 0.45)
        );

        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        // Fade resting brightness down toward the galaxy centre so the
        // dense core stops piling up additively into a white-hot blob. Center is
        // world XZ origin (group sits at x=z=0, rotates about y). 1.0 past r≈16.
        vCenterDim = mix(uCenterDim, 1.0, smoothstep(2.0, 16.0, length(worldPos.xz)));
        vec4 viewPos  = viewMatrix * worldPos;
        // The galaxy's centre in the same space, which is the world origin and
        // therefore the view matrix's own translation. Free, and it cannot
        // disagree with where the group is.
        vDepthDim = bodyDepthEnergy(
          -viewPos.z,
          -(viewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).z,
          uDepthEnergy
        );
        gl_Position   = projectionMatrix * viewPos;
        float retainedCore = pow(
          clamp(max(aRecall, 0.0), 0.0, 1.0),
          ${CONSENSUS_MEMORY_CORE_RELEASE_EXPONENT.toFixed(1)}
        )
          * smoothstep(0.0, 1.0, clamp(aRecallState, 0.0, 1.0));
        float retainedSizeBoost = mix(0.08, 0.16, aMemoryIdentity.w);
        gl_PointSize  = aSize * ${HYBRID_BASE_PX_PER_WU.toFixed(1)} * (1.0 + vFocus * 0.32) * (1.0 + abs(vRecall) * 0.06 + retainedCore * retainedSizeBoost) * scale * (uViewportHeight * 0.5 / max(-viewPos.z, 0.001));
        // Retained records have a semantic CSS-pixel floor so 1/3/5 checksum
        // lanes survive every quality DPR. The floor recedes by the exact
        // complement used when the expanded braid takes over.
        float compactVisibility = 1.0 - smoothstep(
          ${CONSENSUS_MEMORY_HANDOFF_START.toFixed(2)},
          ${CONSENSUS_MEMORY_HANDOFF_END.toFixed(2)},
          clamp(aDetail, 0.0, 1.0)
        );
        float retainedFloor = uMemoryMinPointPx
          * max(uPixelRatio, 0.001)
          * retainedCore
          * compactVisibility
          * scale;
        gl_PointSize = max(gl_PointSize, retainedFloor);
        vPointCssPx = gl_PointSize / max(uPixelRatio, 0.001);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;

      uniform float uTime;
      uniform float uAmbientTime;
      uniform float uMemoryLinePx;
      uniform float uMemorySignalEnergy;
      uniform float uRadiance;

      varying float vBirthRamp;
      varying float vDeathRamp;
      varying float vStageAlpha;
      varying float vSeed;
      varying vec4  vMemoryIdentity;
      varying float vDetail;
      varying float vFocus;
      varying float vRecall;
      varying float vRecallState;
      varying float vCenterDim;
      varying float vDepthDim;
      varying float vPointCssPx;
      varying vec3  vBodyColor;
      varying vec3  vHotColor;
      varying vec3  vCloudParams;

      // hash11 — small deterministic scrambler. Used for per-cell decorrelation.
      ${HASH11_GLSL}

      // Single central Gaussian peak + faint outer halo wash. The cell's
      // brightest point is anchored at sprite center (= fabric endpoint at
      // cell.pos_seed), which makes the fiber-to-cell connection visually
      // continuous: cell glow and fiber glow are both Gaussian, so they
      // meet at the same point and form one bright knot.
      //
      // Per-cell variation comes from the vertex-derived tag colors and
      // sprite size (aSize).
      vec4 cloud(float radiusSquared) {
        // LOD peak suppression: near cells (vDetail→1) lose the white-hot core so
        // the nucleus reads; far cells (vDetail=0) are byte-identical to before.
        float peak = exp(-radiusSquared * vCloudParams.x) * vCloudParams.y;
        vec3 col = mix(vBodyColor, vHotColor, peak);

        // Outer halo wash for boundary continuity — very faint full-sprite
        // glow that anchors the cell's footprint when peak alone is too
        // tight at distance.
        float wash = exp(-radiusSquared / (0.32 * 0.32)) * vCloudParams.z;
        col += vBodyColor * wash;

        return vec4(col, peak + wash);
      }

      void main() {
        vec2 uv = gl_PointCoord - 0.5;
        float radiusSquared = dot(uv, uv);
        if (radiusSquared > 0.25) discard;

        if (vDeathRamp >= 1.0) discard;

        vec4 base = cloud(radiusSquared);
        // Density compression applies only to the resting body. Focus, write,
        // and recall signals below can still reclaim headroom because they
        // describe real events.
        base.a *= vCenterDim;
        // …and the depth term rides beside it, on the same quantity and for
        // the same kind of reason: both are corrections to an ACCUMULATION
        // that perspective and density hand this layer for free. At the knob's
        // default this is exactly 1 (⟨D-10 · knob c⟩).
        base.a *= vDepthDim;
        // ⟨ruling 22⟩ …and the radiance rides the same quantity, for the
        // opposite kind of reason: it is not a correction, it is how much
        // light the first focus of this canvas is given to spend. It sits HERE
        // and not at the end of the shader precisely so the flare, the focus
        // ring and the recall below can still reclaim headroom — an event is
        // not part of the tissue's own radiance. 1 is today's picture.
        base.a *= uRadiance;

        vec3  col = base.rgb;
        float a   = base.a * (1.0 - vDeathRamp);

        // A newborn is still hot. Reuse the exact white core the cloud peak
        // already mixes toward — one mix, gated by what is LEFT of the birth
        // ramp — so the body cools as it grows and a settled cell pays
        // nothing. Stage entrants arrive with the ramp spent: only a real
        // chain birth blooms.
        col = mix(col, vHotColor, ${BIRTH_BLOOM.toFixed(2)} * (1.0 - vBirthRamp));

        // Interaction feedback uses an interrupted two-fold interference ring,
        // echoing the contributor crossings of A instead of adding a generic
        // solid selection circle. Hover reveals it partially; selection closes
        // the signal and hands visual emphasis to the expanded braid.
        if (vFocus > 0.0001) {
          float focusAngle = atan(uv.y, uv.x);
          float focusRing = exp(-pow((length(uv) - 0.34) / 0.045, 2.0));
          float focusArc = 0.35 + 0.65
            * smoothstep(-0.35, 0.72, sin(focusAngle * 2.0 + vSeed * 0.21));
          float focusSignal = focusRing * focusArc * vFocus * (1.0 - vDeathRamp);
          // ONE tint, and it is the galaxy's own gold. The ring used to be
          // gold or cyan by hash11(vSeed) — a coin flip on the cell's id, so
          // the same gesture answered in two different colours depending on
          // which cell the reader had picked, and one of the two was the peer
          // plane's cyan on a surface that is not the peer plane. Interaction
          // feedback is the instrument speaking, and an instrument says the
          // same thing the same way every time.
          vec3 focusTint = vec3(${CONSENSUS_BRAID_PALETTE.gold.join(', ')});
          col += focusTint * focusSignal * 1.35;
          a += focusSignal * 0.62;
        }

        // Historical recall reads the Cell's record; it does not replay a
        // write flash. Sources emit two bounded address rails. The retained
        // target receives a segmented scan aperture, then resolves three
        // checksum lanes and one central agreement knot only as its real
        // witness arrivals converge. The knot outlasts the route aperture but
        // clears exactly when the explicit historical read ends.
        if (abs(vRecall) > 0.0001) {
          float recallAmount = clamp(abs(vRecall), 0.0, 1.0);
          float recallTarget = step(0.0, vRecall);
          float recallSource = 1.0 - recallTarget;
          float recallResolved = smoothstep(
            0.0,
            1.0,
            clamp(vRecallState, 0.0, 1.0)
          );
          float readEnergy = recallAmount * (
            1.0 - recallResolved
              * (1.0 - ${CONSENSUS_MEMORY_CORE_READ_FLOOR.toFixed(1)})
          );
          float compactVisibility = 1.0 - smoothstep(
            ${CONSENSUS_MEMORY_HANDOFF_START.toFixed(2)},
            ${CONSENSUS_MEMORY_HANDOFF_END.toFixed(2)},
            clamp(vDetail, 0.0, 1.0)
          );
          float retainedEnergy = pow(
            recallAmount,
            ${CONSENSUS_MEMORY_CORE_RELEASE_EXPONENT.toFixed(1)}
          )
            * recallResolved
            * recallTarget
            * compactVisibility;
          float readPhase = fract(uAmbientTime * 0.38 + hash11(vSeed + 9.7) * 0.15);
          float scanY = mix(-0.28, 0.28, readPhase);
          float scanAperture = exp(-pow((uv.y - scanY) / 0.018, 2.0));
          float scanWindow = 1.0 - smoothstep(0.18, 0.32, abs(uv.x));
          float addressCell = floor((uv.x + 0.36) * 18.0);
          float addressGate = 0.28 + 0.72 * step(
            0.42,
            hash11(addressCell + floor(readPhase * 16.0) + vSeed)
          );
          float targetRead = scanAperture * scanWindow * addressGate
            * readEnergy * recallTarget
            * compactVisibility
            * uMemorySignalEnergy;

        // Far retained-core identity is the compact LOD of canonical A:
        // asset rotates the record axis, lock changes its gate cadence, data
        // opens 1/3/5 checksum lanes, capacity sizes the central knot, and the
        // content hash chooses stable gaps. Gold remains the shared agreement
        // state instead of turning taxonomy into an activity colour code.
          float recordAngle = (vMemoryIdentity.x - 0.5) * 0.9;
          float recordCos = cos(recordAngle);
          float recordSin = sin(recordAngle);
          vec2 recordUv = mat2(
            recordCos, -recordSin,
            recordSin, recordCos
          ) * uv;
          float memoryUvPerPx = 1.0 / max(vPointCssPx, 1.0);
          float checksumWidth = max(
            0.0125,
            uMemoryLinePx * memoryUvPerPx
          );
          float checksumLaneStep = max(0.056, 1.34 * memoryUvPerPx);
          float recordPayload = clamp(vMemoryIdentity.z, 0.0, 1.0);
          float recordSpan = max(
            mix(0.11, 0.2, recordPayload),
            checksumLaneStep * 2.34
          );
          float recordWindow = 1.0 - smoothstep(
            recordSpan * 0.72,
            recordSpan,
            abs(recordUv.x)
          );
          float checksumCenter = exp(-pow(recordUv.y / checksumWidth, 2.0));
          float checksumInner = (
            exp(-pow((recordUv.y + checksumLaneStep) / checksumWidth, 2.0))
            + exp(-pow((recordUv.y - checksumLaneStep) / checksumWidth, 2.0))
          ) * smoothstep(0.04, 0.22, recordPayload);
          float checksumOuter = (
            exp(-pow((recordUv.y + checksumLaneStep * 2.0) / checksumWidth, 2.0))
            + exp(-pow((recordUv.y - checksumLaneStep * 2.0) / checksumWidth, 2.0))
          ) * smoothstep(0.42, 0.78, recordPayload);
          float checksumLanes = (
            checksumCenter + checksumInner + checksumOuter
          ) * recordWindow;
          float lockCadence = mix(15.0, 29.0, vMemoryIdentity.y);
          float checksumCell = floor(
            (recordUv.x + recordSpan) * lockCadence
          );
          float checksumGate = 0.4 + 0.6 * step(
            0.32,
            hash11(
              checksumCell
                + floor(vMemoryIdentity.y * 4.01) * 17.0
                + vSeed
            )
          );
          float recordLatch = checksumLanes * checksumGate * retainedEnergy
            * uMemorySignalEnergy;
          float recordKnotRadius = max(
            mix(0.03, 0.044, vMemoryIdentity.w),
            uMemoryLinePx * 1.45 * memoryUvPerPx
          );
          float recordKnot = exp(-pow(length(uv) / recordKnotRadius, 2.0))
            * retainedEnergy
            * uMemorySignalEnergy;

          float departureX = mix(
            0.06,
            0.34,
            clamp(vRecallState, 0.0, 1.0)
          );
          float departureRail = exp(-pow((abs(uv.x) - departureX) / 0.02, 2.0))
            * (1.0 - smoothstep(0.1, 0.29, abs(uv.y)))
            * recallAmount * recallSource;
          // The recall channel's four colours are the scene's own accents,
          // read by name. They used to be four bare vec3s a shade off the
          // braid's, the nucleus's and the echo's — the same four meanings in
          // eight values (D-6).
          vec3 recallCyan = vec3(${SCENE_ACCENT_PALETTE.cyan.join(', ')});
          vec3 recallPale = vec3(${SCENE_ACCENT_PALETTE.pale.join(', ')});
          vec3 recallViolet = vec3(${SCENE_ACCENT_PALETTE.violet.join(', ')});
          vec3 recallGold = vec3(${SCENE_ACCENT_PALETTE.paleGold.join(', ')});
          col += recallCyan * targetRead * 1.35;
          col += mix(recallPale, recallGold, 0.48) * recordLatch * 1.62;
          col += recallGold * recordKnot * 1.18;
          col += recallViolet * departureRail * 0.72;
          a += targetRead * 0.54
            + recordLatch * 0.72
            + recordKnot * 0.48
            + departureRail * 0.28;
        }

        // A real on-chain Cell consumption is not agreement: the fading body
        // cools, gutters, and goes. GC never reaches this shader path, so quiet
        // renderer eviction stays mute. Withering is a COOLING before it is a
        // collapse: chroma drains toward the galaxy's own ember, the body
        // gutters on a per-cell phase, and only then does deathEase take the
        // size. A living cell resolves every term here to identity, so the
        // branch costs the resting field nothing and skips it for the whole
        // field.
        //
        // ⭐ THE CORPSE IS ONE COLOUR, AND IT IS EMBER (D-9). The retirement
        // signal is the last word of the sentence rather than the whole of it;
        // WITHER_RETIRE_MAX carries the argument.
        if (vDeathRamp > 0.0) {
          vec3 emberColor = vec3(${CELL_GALAXY_PALETTE.ember.join(', ')});
          vec3 ash = vec3(dot(col, vec3(0.299, 0.587, 0.114))); // Rec.601 luma
          float cooling = smoothstep(0.0, ${WITHER_COOL_END.toFixed(2)}, vDeathRamp);
          col = mix(
            col,
            mix(ash, emberColor, ${WITHER_EMBER_TINT.toFixed(2)}),
            cooling
          );

          // Each corpse gutters on its own phase; a block's worth of deaths
          // flickering in unison would read as one strobe, not many embers.
          float gutterPhase = hash11(vSeed + 5.3) * 6.2831853;
          float gutter = 0.5 - 0.5
            * sin(uTime * ${WITHER_GUTTER_RATE.toFixed(1)} + gutterPhase)
            * sin(uTime * ${(WITHER_GUTTER_RATE * 1.7).toFixed(2)} + gutterPhase * 2.1);
          a *= 1.0 - ${WITHER_GUTTER_DEPTH.toFixed(2)} * vDeathRamp * gutter;

          // …and only then the retirement signal, gated behind the cooling it
          // used to erase: it opens where the cooling closes and never takes
          // the whole pixel. See WITHER_RETIRE_MAX.
          vec3 retireColor = vec3(${CONSENSUS_BRAID_PALETTE.retire.join(', ')});
          float retireMix = ${WITHER_RETIRE_MAX.toFixed(2)}
            * smoothstep(${WITHER_COOL_END.toFixed(2)}, 1.0, vDeathRamp);
          col = mix(col, retireColor, retireMix);
        }
        // Stage resolution is a property of the view, so it dims the WHOLE
        // cell — event signals included. A cell being let go never keeps a
        // bright selection ring on its way out.
        a *= vStageAlpha;
        if (a < 0.005) discard;
        gl_FragColor = vec4(col * a, a);
      }
    `,
  });
}
