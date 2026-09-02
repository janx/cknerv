import * as THREE from 'three';
import {
  COHORT_CONTEXT_ENERGY_GLSL,
  COHORT_GULP_FALL,
  COHORT_GULP_GLSL,
  COHORT_GULP_INTERIOR,
  COHORT_GULP_RISE,
  COHORT_INTAKE_LEVEL,
  COHORT_INTERIOR_COLD,
  COHORT_RIM_R,
} from './colonyCohort';
import {
  COLONY_ELLIPSE_X,
  COLONY_ELLIPSE_Z,
  COLONY_RADIUS,
} from '../derives/networkTopology.derive';
import { mulberry32 } from '../layout';

/**
 * The mist under the colony plane, and the one place it becomes visible.
 *
 * ⭐⭐⭐ THE PEER MESH IS THE BOUNDARY BETWEEN TWO UNIVERSES. Above it the cell
 * canopy — CKB's spacetime; below it the other one. A POW cohort is a HOLE in
 * that membrane, drawn by `colonyCohort.ts`, and this file draws what is on the
 * other side of the hole: a faint substance that permeates the space under the
 * plane (「无处不在到处弥漫的物质」). It has NO SHAPE OF ITS OWN — not a sea, not a
 * coast, not curtains, not a plume — and it is SECONDARY: it must never take
 * focus from the peer mesh or the cell galaxy.
 *
 * ⭐⭐⭐ AND THE INTAKE IS THE POINT. What the user asked for is 「pow cohort
 * 汲取能量的视觉效果」, so the mist is drawn where it is BEING TAKEN and is almost
 * nothing everywhere else. Two materials say that:
 *
 * 1. `makeMistHazeMaterial` — the ground. One fetch of the noise tile on a
 *    large plain sheet, a few percent of the mesh's brightness, no structure at
 *    all. It exists so the space under the plane is not empty, and it is the
 *    thing the patch below is measured as brighter THAN.
 * 2. `makeCohortIntakePatchMaterial` — one instance per cohort, its sink at its
 *    own origin. A patch of that same substance lying `MIST_FLOOR_DEPTH` under
 *    the plane, lifted into a gentle mound whose top is exactly
 *    `COHORT_INTAKE_LEVEL` — the level the window in the mouth already shows —
 *    carrying the medium's own texture advected along the streamlines of a SINK
 *    WITH A VORTEX (log spirals winding into the mouth), brightening as it
 *    gathers, dark inside the rim, thinner in the wake downstream, and flaring
 *    on the block that cohort wins.
 *
 * ⛔⛔⛔ NOTHING IS EVER DRAWN ABOVE THE PLANE, and there is NO COLUMN, PLUME,
 * FUNNEL OR PILLAR under the mouth AT ANY BRIGHTNESS PROFILE. Twenty-five
 * rounds measured that: a shaft gated through the hole is invisible except from
 * directly overhead, and an ungated one is a searchlight in miniature — up
 * close, a saucer with a tractor beam. ⭐ ONLY SURFACES BEING DRAWN EVER READ AS
 * INTAKE. That is what the window is, and it is what this patch is: a surface,
 * seen from outside, moving. The vertex stage below can only ever put a vertex
 * BELOW its instance's origin, and `MIST_PATCH_NEVER_ABOVE_GLSL` is the one
 * statement that says so.
 *
 * ⭐⭐ THE MOUND'S TOP AND THE WINDOW'S SURFACE ARE ONE SURFACE, which is why
 * `COHORT_INTAKE_LEVEL` is imported rather than restated. A viewer looking INTO
 * the mouth and a viewer looking at the mist beside it must see the medium at
 * the same height, or the two draws stop being one substance. The same goes for
 * `COHORT_RIM_R`: the patch's gate, its dark eye, the medium piling at the lip
 * and the start of the wake are all fractions of the SAME hole the face draws.
 *
 * ⭐ ONE SINK PER PATCH, SO THERE IS NO CAP AND NO ARRAY. The preview's floor
 * was a single full-plane draw looping over `uSinks[8]` behind a `uSinkCount`,
 * which is a fixed ceiling on the number of cohorts and a per-fragment loop for
 * every one of them. Here each cohort gets its own instance and its own sink at
 * its own origin, so the arithmetic below mentions exactly one mouth and the
 * `COHORT_MARK_CAP` of 64 costs this layer nothing at all. ⭐ WHERE TWO PATCHES
 * OVERLAP THEY SIMPLY ADD, which is the right answer for additive light and for
 * the physics: two mouths drinking from the same parcel of mist take more of it
 * than one does. There is no cross-talk term and none is wanted.
 *
 * ⚠️⚠️ THE GEOMETRY CONTRACT, WHICH `ColonyMist` MUST FOLLOW EXACTLY (this file
 * cannot enforce it, so it states it):
 *
 * - The patch's geometry is a UNIT `PlaneGeometry(1, 1, MIST_PATCH_SEGMENTS,
 *   MIST_PATCH_SEGMENTS)` copied into an `InstancedBufferGeometry`. The extent
 *   rides the `uReach` UNIFORM and NOT the geometry, exactly as
 *   `COHORT_FACE_HALF` rides `uHalf`: bake `2 * MIST_REACH` into the plane and
 *   the live `cohortReach` knob becomes a rebuild instead of a slider. The
 *   subdivision is what the MOUND needs — a mound on two triangles is a tent —
 *   and 24 is a starting value from the preview's own floor density, not a
 *   measurement.
 * - It is driven by `instanceMatrix`, built with `makeTranslation` and NOTHING
 *   ELSE, exactly as `ColonyCohorts` builds the face's and the aura's. The
 *   vertex stage takes the instance's origin from `instanceMatrix * vec4(0, 0,
 *   0, 1)` and lays the plane into the instance's own local XZ, which the
 *   colony's rotation about world Y maps rigidly onto the colony plane. ⚠️ A
 *   SCALED instance matrix would move this patch's radii without moving the
 *   mouth's, and one hole would become two.
 * - It carries the SAME two instanced attributes the face carries, with the
 *   same names and the same meaning: `aSeed` (the per-instance decorrelation
 *   lane) and `aGulp` (the SIM SECOND of the block this cohort won, or
 *   `COHORT_NEVER_WON`). ⭐ `aGulp` must be re-laid off the SAME `wonAtRef` map
 *   in the SAME effect `cohortWinLane` already runs in — a second map would let
 *   the mouth and the mist under it swallow different blocks.
 * - It is mounted INSIDE the colony's rotation group, before `ColonyEdges`,
 *   with a `renderOrder` below everything. That is what makes every coordinate
 *   below a colony-frame constant: the sink never moves in this frame, so the
 *   spiral needs no per-frame rotation uniform and the medium cannot shimmer as
 *   the plate turns.
 * - The haze is NOT instanced: one plain `PlaneGeometry` per sheet, laid flat,
 *   at the depths `MIST_HAZE_SHEETS` names.
 *
 * ⚠️⚠️ AND THE ONE THING THIS LAYER CANNOT PROVE ABOUT ITSELF: IT SHARES AN
 * ADDITIVE CEILING WITH THE MARK ABOVE IT, AND THE COLLISION IS STRUCTURAL.
 * `cohortAperture.test.ts` measures the face and the aura summing to 0.925777 in
 * blue over a 700-camera sweep (re-measured this leg, identical to T2b's), so
 * there are 0.0742 of headroom; every colour this
 * feature emits — `scaffold`, `coldWhite`, `COHORT_INTERIOR_COLD` — is EXACTLY
 * 1.0 in blue, so blue is the binding channel for this draw too. The patch's
 * brightest ring is where its gate finishes opening, `0.98 * COHORT_RIM_R`,
 * which is the SAME RADIUS the face's lip peaks at; the mound puts it 0.88 wu
 * under the plane there, so from anything but a grazing camera the two project
 * on top of each other. `mistPatchSupremum` below states the patch's own
 * arithmetic ceiling (1.95 at rest, 3.05 through a gulp, at the shipped
 * uniforms), and it is far above the headroom. ⭐ THAT IS NOT SOMETHING TO
 * INVENT A KNEE FOR HERE: the preview the user approved had exactly this
 * brightness beside exactly this mouth, and every invented threshold across 25
 * rounds was wrong. `uAmp` (knob `cohortMist`) is the single scale, and T6's
 * live leg measures the saturated pixels the R19 way — mark-on minus mark-off,
 * never a raw count — and turns it down by eye. This paragraph is the handover,
 * not a shrug.
 */

/* -------------------------------------------------------------------------- *
 * The medium's own texture: one 256² tile, mipmapped.
 * -------------------------------------------------------------------------- */

/**
 * ⭐⭐⭐ THIS LAYER OWNS A SAMPLER, AND IT IS THE ONE PLACE THAT IS RIGHT.
 * `colonyCohort.ts` writes its medium out as an arithmetic lattice instead,
 * because the window evaluates it inside the pupil (3 % of a 6 wu disc) and the
 * mark would otherwise be the only textured object in the peer plane — one of
 * the five register violations the form it replaced was retired for. The mist
 * is the opposite case in every respect: it covers a 28 wu disc per cohort plus
 * two sheets 230 wu across, it is sampled twice per fragment for the two
 * cross-faded phases, and — the decisive one — ⭐ IT MUST PREFILTER WITH
 * DISTANCE. R19 measured that unfiltered grain at this scale either aliases or
 * prefilters to nothing past about 25 wu; a mipmapped tile is what let the
 * preview's mist hold together at the app camera, where a cohort is 100+ wu
 * away. A lattice evaluated in the fragment shader has no mips and cannot get
 * any without a screen-footprint estimate per octave.
 *
 * ⭐ The two layers need not be the same FIELD, only the same LEVEL — see
 * `COHORT_INTAKE_LEVEL`. They are two different noises of the same character,
 * and nothing ties a pixel of one to a pixel of the other.
 */
export const MIST_NOISE_SIZE = 256;

/**
 * Lattice cells across the tile, per RGBA channel: four octaves in one fetch.
 *
 * ⭐ THE COUNTS ARE WHAT MAKES THE TILE SEAMLESS. The lattice wraps modulo the
 * cell count, so a channel whose count divides the tile exactly repeats with no
 * seam under `RepeatWrapping` — which is why these are integers and why the
 * generator takes `% n` on both lattice corners. The patch reads R and G (the
 * medium's two octaves) and the haze reads B (the ground's slow patchiness);
 * A is generated for free and is unread today.
 */
export const MIST_NOISE_CELLS: readonly number[] = [8, 16, 32, 64];

/**
 * The tile's seed. ⭐ A CONSTANT, because the mist has to be the same substance
 * from session to session: a re-seeded tile would move every filament under
 * every cohort on a reload, and the layer would stop being a place.
 */
export const MIST_NOISE_SEED = 0x9e3779b9;

/**
 * The tile's bytes, as a pure function — no THREE, no GL, no document.
 *
 * ⭐ SEPARATE FROM THE TEXTURE SO A TEST CAN CALL IT. The wrapper below builds
 * a `DataTexture`, which is what a scene needs and what a jsdom test has no use
 * for; the properties worth pinning (determinism, the wrap, the mean and the
 * range) are all properties of these bytes.
 *
 * Bilinear value noise with the smoothstep fade `t²(3 - 2t)`, one independent
 * lattice per channel, keyed off `seed` so two channels never correlate.
 */
export function mistNoiseTile(
  size: number = MIST_NOISE_SIZE,
  seed: number = MIST_NOISE_SEED,
) {
  const data = new Uint8Array(size * size * 4);
  const fade = (t: number): number => t * t * (3 - 2 * t);
  for (let channel = 0; channel < 4; channel += 1) {
    const cells = MIST_NOISE_CELLS[channel];
    // ⚠️ The channel's own stream. `Math.imul` rather than a plain multiply so
    // the wrap is defined at every channel index rather than at the four that
    // happen to fit in a double.
    const random = mulberry32(seed ^ Math.imul(channel, 0x9e3779b1));
    const lattice = new Float32Array(cells * cells);
    for (let i = 0; i < lattice.length; i += 1) lattice[i] = random();
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const fx = (x / size) * cells;
        const fy = (y / size) * cells;
        // ⭐ THE `% cells` IS THE SEAM. Without it the last cell interpolates
        // toward a corner that does not exist and the tile shows a line down
        // two of its edges the moment it repeats.
        const x0 = Math.floor(fx) % cells;
        const y0 = Math.floor(fy) % cells;
        const x1 = (x0 + 1) % cells;
        const y1 = (y0 + 1) % cells;
        const tx = fade(fx - Math.floor(fx));
        const ty = fade(fy - Math.floor(fy));
        const value =
          (1 - ty) * ((1 - tx) * lattice[y0 * cells + x0] + tx * lattice[y0 * cells + x1]) +
          ty * ((1 - tx) * lattice[y1 * cells + x0] + tx * lattice[y1 * cells + x1]);
        data[(y * size + x) * 4 + channel] = Math.round(value * 255);
      }
    }
  }
  return data;
}

let mistNoiseTexture: THREE.DataTexture | null = null;

/**
 * The tile as a texture, built once for the module's life.
 *
 * ⭐ MODULE-LAZY AND SHARED, because both materials sample the SAME substance
 * and two tiles would be two substances, 256 kB each, with a filament under one
 * cohort matching nothing under the next. It is never disposed on purpose: it
 * outlives every mount of the layer, and a colony that unmounts and remounts
 * (a profile switch, a re-plan) must not pay 256 k of value noise again.
 *
 * ⚠️ `LinearMipmapLinearFilter` + `generateMipmaps` IS THE WHOLE REASON THIS IS
 * A TEXTURE — see `MIST_NOISE_SIZE`. Drop either and the medium aliases at the
 * app camera, which is the only camera anybody ever screenshots.
 *
 * ⚠️ IT COSTS 15–50 ms TO BUILD, MEASURED (four runs on the reference machine
 * at a load average of 6; 262,144 faded bilinear samples across four channels).
 * That is a MOUNT-TIME cost paid once for the module's life, not a per-frame
 * one — but it is one to two frames of hitch on the first colony mount, so if
 * T6 sees it, the fix is to build it off the critical path or at 128², NEVER to
 * drop the mips.
 */
export function makeMistNoiseTexture(): THREE.DataTexture {
  if (mistNoiseTexture !== null) return mistNoiseTexture;
  const texture = new THREE.DataTexture(
    mistNoiseTile(),
    MIST_NOISE_SIZE,
    MIST_NOISE_SIZE,
    THREE.RGBAFormat,
  );
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  mistNoiseTexture = texture;
  return texture;
}

/* -------------------------------------------------------------------------- *
 * The patch's geometry, and the shape of its mound.
 * -------------------------------------------------------------------------- */

/**
 * Subdivisions per side of the patch's unit plane.
 *
 * ⭐ THE MOUND IS A VERTEX EFFECT, so this is the only thing that decides
 * whether it is a mound or a tent. At 24 the patch carries 625 vertices and
 * 1,152 triangles, and one mound radius (`MIST_MOUND_R` = 7 wu of a 28 wu quad)
 * spans 6 of the 24 spans. A STARTING VALUE from the preview's floor density
 * (220 × 150 over 460 × 312 wu, which is 2.1 wu per span against this 1.17), not
 * a measurement: T6 has the GPU cost and the silhouette in front of it.
 */
export const MIST_PATCH_SEGMENTS = 24;

/**
 * A cohort's catchment, in world units: the patch's half-extent AND the compact
 * support of the weight `w = (1 - r²/R²)²` that scales every term below.
 *
 * ⭐ COMPACT SUPPORT RATHER THAN A FALLOFF, because a patch that merely got
 * faint would still be drawn — and discarded — over the whole colony, once per
 * cohort. This one is exactly zero at 14 wu with zero slope, so the fragment
 * that leaves at the disc's edge leaves nothing behind it.
 *
 * 14 wu, the approved preview's `uReach` for its mist floor.
 */
export const MIST_REACH = 14;

/**
 * The mound's radius, in world units.
 *
 * `lift = (1 - r²/R²)²` — 1 at the sink, 0 with ZERO SLOPE at `R`, so the mound
 * meets the flat floor tangentially and there is no crease anywhere on the
 * silhouette. Half the catchment: the mist is lifted well inside the disc it is
 * drawn over, so the lift never reaches the quad's own edge where the
 * subdivision is coarsest.
 */
export const MIST_MOUND_R = 7;

/**
 * How far under the colony plane the mist lies away from a mouth, in world
 * units.
 *
 * ⭐ IT IS THE DEPTH THE PREVIEW APPROVED AND IT IS NOT A FREE PARAMETER: the
 * mound rises from here to `COHORT_INTAKE_LEVEL`, so this number is what gives
 * the rise 1.8 wu of travel to be a rise IN. Flatten it toward the level and
 * the intake stops being visible as a lift; deepen it and the mound becomes the
 * cone this whole feature spent 25 rounds refusing.
 */
export const MIST_FLOOR_DEPTH = 2.5;

/* -------------------------------------------------------------------------- *
 * The medium: what the substance looks like where it is drawn.
 * -------------------------------------------------------------------------- */

/**
 * The medium's sampling frequency, in tile-widths per world unit.
 *
 * At 0.085 the tile repeats every 11.8 wu and its coarsest channel's cell — 8
 * across the tile — is 1.47 wu, which is the size of one filament's
 * cross-section. That is deliberately COMPARABLE TO THE HOLE (1.6 wu): the
 * medium has to resolve as structure at the lip or the gather reads as a smooth
 * glow, which is a lamp and not an intake.
 */
export const MIST_GRAIN = 0.085;

/** How much of the medium is the RIDGE rather than the raw noise. Lab: 0.85. */
export const MIST_RIDGE = 0.85;

/**
 * How sharply the ridge is drawn out into filaments.
 *
 * ⚠️ Its base is `1 - abs(2n - 1)`, which is in [0, 1] BY CONSTRUCTION and NOT
 * provably so from the source, because `n` comes out of a texture. The GLSL
 * carries an explicit `max(..., 0.0)` for exactly that reason — a negative base
 * is undefined for GLSL's power function, and undefined quietly.
 */
export const MIST_RIDGE_POW = 1.7;

/**
 * The filaments' amplitude — the whole visible weight of the patch.
 *
 * ⚠️ THE PATCH HAS NO GROUND TERM AT ALL, which is the preview's own `uBase: 0`
 * and is what makes the mist "visible only where it is being taken": every term
 * below is multiplied by the catchment weight or by the gather, so a patch with
 * no mouth in it draws nothing. The ground under the whole plane is the HAZE's
 * job, and it is 0.03.
 */
export const MIST_FIL = 0.24;

/**
 * Seconds per flow-map cycle.
 *
 * ⭐⭐ TWO PHASES HALF A CYCLE APART, CROSS-FADED, IS WHY THE SPIRAL NEVER
 * RESETS IN VIEW. A back-trace of age `tau` stretches the medium more the older
 * it is, so a single phase would visibly snap when `tau` wrapped. The preview
 * measured 14 s and 8 s of churn outward at the lip at this period; a longer one
 * stretches the medium into smears and a shorter one makes the cross-fade
 * itself the motion.
 */
export const MIST_PERIOD = 6;

/**
 * The ambient drift's speed, in world units per second.
 *
 * ⚠️⚠️ IT IS NOT THE COLONY'S ROTATION RATE, AND THE GAP IS MEASURED. The
 * colony turns at `LIVE.galaxy.rotationRate` = 0.00125 rad/s and `attestedPos`
 * puts a cohort at a mean radius of E[sqrt(u)] * 92 = 61 wu, so a cohort's own
 * tangential speed is about 0.077 wu/s — which would advect the medium 0.46 wu
 * per flow-map period, 3.9 % of one grain cell, i.e. NOTHING. The preview's
 * ambient swirl runs at about 0.52 wu/s typical (peak 1.5): ten times faster,
 * and visible as a slow slide of half a grain cell per second. ⭐ SO THIS IS A
 * STYLISTIC AMBIENT, NOT THE ROTATION, and it is honest about that: the medium
 * is sampled in COLONY-FRAME coordinates (constant per mark, no shimmer as the
 * plate turns), and this term is the relative streaming laid on top of it, in
 * the direction the world-static mist would move. T6 has both numbers.
 */
export const MIST_DRIFT = 0.8;

/**
 * Which way that drift runs, as a sign on the colony's own tangential
 * direction.
 *
 * ⚠️ DERIVED, AND STILL A KNOB, BECAUSE A SIGN IS WHAT A SCREENSHOT SETTLES.
 * `NetworkColony` turns the group by `rotation.y -= rate * dt`, so a cohort's
 * WORLD velocity is along `(-z, x)` and the mist therefore streams past it
 * along `(z, -x)` — the negative of the tangential vector the vertex stage
 * builds. Downstream is where the wake goes, so the sign has to be right or the
 * depleted band sits in FRONT of the mouth, which reads as a shadow rather than
 * as a wake. T6 looks at it.
 */
export const MIST_DRIFT_SIGN = -1;

/* -------------------------------------------------------------------------- *
 * The sink: how the mouth takes it.
 * -------------------------------------------------------------------------- */

/**
 * Sink strength, in square world units per second: `r0 = sqrt(r² + k * tau)`.
 *
 * ⭐ THAT IS THE EXACT BACK-TRACE OF A 2-D POINT SINK, not an approximation of
 * one. A sink of strength `k` has radial velocity `-k / (2r)`, so `d(r²)/dt =
 * -k` and the radius a parcel had `tau` ago is exactly `sqrt(r² + k*tau)`. The
 * medium is therefore advected by the flow rather than warped toward it, which
 * is why the filaments bend into the mouth instead of pointing at it.
 */
export const MIST_SINK_K = 12;

/**
 * The vortex-to-sink ratio: `theta0 = theta + s * ln(r0 / r)`.
 *
 * ⭐ THE LOG SPIRAL IS WHAT MAKES IT AN INTAKE RATHER THAN A DRAIN. A pure sink
 * pulls the medium straight in and reads as radial streaks — which is a star,
 * the exact failure `COHORT_FACE_STRIAE` documents at low count. Adding a
 * circulation makes every streamline a logarithmic spiral, and a spiral is a
 * shape a viewer reads as SWALLOWING. 1.4 turns per e-fold of radius, from the
 * approved preview.
 *
 * ⭐ It is the same for every cohort on purpose. Six same-handed spirals may
 * read as stamped; deriving the handedness from the producer key is a
 * deliberate follow-up (§6 of the plan), not an omission.
 */
export const MIST_SWIRL = 1.4;

/**
 * Where the mist goes dark, as a fraction of `COHORT_RIM_R`.
 *
 * ⭐⭐ THE EYE IS AN ABSENCE, LIKE THE PUPIL ABOVE IT. Inside 0.45 of the rim
 * the gate is EXACTLY zero and the patch draws nothing at all; it climbs to
 * exactly 1 at 0.98 of the rim. So what a viewer sees under the mouth is a dark
 * disc with the medium piling up around it — the same additive idiom for a hole
 * the face uses, one plane down. ⚠️ The upper edge is 0.98 rather than 1.0 so
 * the gate is fully open BEFORE the lip, where the pile peaks: a gate still
 * climbing there would eat the gather it exists to frame.
 */
export const MIST_GATE_IN = 0.45;

/**
 * How much the medium piles up at the lip: `gain = 1 + conc * c³` with
 * `c = clamp(rim / r, 0, 1)`.
 *
 * ⭐ THE LIP IS NOT A DRAWN RING ON THIS LAYER EITHER. It is the arriving medium
 * at its densest, which is what a sink does to a substance it is pulling: the
 * cube is the compression a 2-D sink applies to a parcel's area, and it stops
 * at the rim because inside it there is nothing left to draw.
 */
export const MIST_CONC = 1.6;

/**
 * How far the gulp reaches, in rim radii.
 *
 * The block flare is `clamp(rim * 2.2 / r, 0, 1)` — full out to 2.2 rim radii
 * and falling as `1/r` past that, so the swallow is seen as the whole gathering
 * annulus surging rather than as a point flashing.
 */
export const MIST_GULP_R = 2.2;

/* -------------------------------------------------------------------------- *
 * The gather: how much structure is paid for, and where.
 * -------------------------------------------------------------------------- */

/** Filament gain right at the mouth. */
export const MIST_CONTRAST_NEAR = 1.8;

/** Filament gain at the edge of the catchment: nearly flat, nearly nothing. */
export const MIST_CONTRAST_FAR = 0.2;

/**
 * Where the medium's second octave — and with it the whole two-phase back-trace
 * — starts being paid for, on the catchment weight.
 *
 * ⭐⭐ THE STRUCTURE IS ONLY EVALUATED WHERE IT IS VISIBLE. Below `MIST_FINE_LO`
 * the fragment skips both `texture2D` pairs and both back-traces entirely, so
 * the outer 40 % of the patch's area costs a discard and a multiply. The band
 * is 0.02 → 0.3 of `w = (1 - r²/R²)²`, which is r = 12.97 wu → 9.42 wu: the
 * structure fades in over 3.6 wu and is never seen switching on.
 */
export const MIST_FINE_LO = 0.02;

/** The other end of that band. */
export const MIST_FINE_HI = 0.3;

/* -------------------------------------------------------------------------- *
 * The wake: what is gone because it was taken.
 * -------------------------------------------------------------------------- */

/**
 * How much of the medium is missing downstream of a mouth.
 *
 * ⭐⭐ THE WAKE IS THE ONLY TERM THAT SAYS THE MIST IS BEING CONSUMED RATHER
 * THAN MERELY STIRRED. Without it the sink is a whirlpool that returns
 * everything it takes; with it there is a band behind the mouth where what was
 * flowing is simply gone. It is also what stops the dividing streamline's
 * stagnation point from drawing a second, false convergence downstream.
 */
export const MIST_WAKE = 0.35;

/** The wake's half-width across the drift, in world units. */
export const MIST_WAKE_W = 2.2;

/** How far it reaches downstream, in world units. */
export const MIST_WAKE_LEN = 17;

/* -------------------------------------------------------------------------- *
 * What every draw in the layer shares.
 * -------------------------------------------------------------------------- */

/**
 * How far a grazing ray may thicken the sheet it crosses.
 *
 * ⭐ A SLAB, NOT A PLATE. A flat additive surface seen edge-on contributes the
 * same light as one seen face-on, which is exactly how a painted floor reads.
 * Multiplying by `1 / |dir.y|` — capped here — is the thin-slab approximation of
 * the path length through a layer of substance, and it is what makes the mist
 * read as something the view goes THROUGH.
 */
export const MIST_PATH_MAX = 1.6;

/**
 * The layer's master scale, and the ONLY knob that changes its weight.
 *
 * ⚠️ IT IS THE HANDLE ON THE COLLISION IN THIS FILE'S HEADER: the patch's ring
 * lands where the mark's lip lands, and the mark has 0.0744 of additive
 * headroom in blue. `mistPatchSupremum` states what this layer can reach; T6
 * measures the saturated pixels the R19 way and turns this down.
 */
export const MIST_AMP = 1;

/**
 * The mist's colour, and it is the WINDOW'S colour rather than the preview's.
 *
 * ⭐⭐⭐ ONE SUBSTANCE, ONE REGISTER. The mound's top IS the surface the hole
 * shows — that is what `COHORT_INTAKE_LEVEL` means — so a viewer looking into
 * the mouth and a viewer looking at the mist beside it must not see two
 * different colours of the same medium. This is the same argument the level
 * itself rests on, one register up.
 *
 * ⚠️ THE PREVIEW USED TWO COLOURS AND NEITHER IS KEPT. Its mist was a deeper
 * blue (0.10, 0.58, 1.0) tinting toward (0.102, 0.819, 1.0) as the medium
 * gathered — and that bright end is EXACTLY `PEER_NETWORK_PALETTE.scaffold`, a
 * token whose whole job is to name a role INSIDE the peer plane. Borrowing it
 * for the universe on the other side is the semantic error
 * `COHORT_INTERIOR_COLD` exists to refuse, and the refusal has to hold for the
 * substance as well as for the hole. `COHORT_INTERIOR_COLD` sits between the
 * preview's two ends, and its blue is exactly 1.0, so the additive ceiling's
 * binding channel is unchanged.
 */
export const MIST_COLOR = COHORT_INTERIOR_COLD;

/* -------------------------------------------------------------------------- *
 * The arithmetic, as pure functions — the mirror the tests read.
 * -------------------------------------------------------------------------- */

/**
 * The mound's profile: 1 at the sink, 0 with ZERO SLOPE at `moundR`.
 *
 * The zero slope is the whole point of the square: `(1 - x)²` has derivative
 * `-2(1 - x)`, which vanishes at `x = 1`, so the mound meets the flat floor
 * tangentially and no camera can find a crease on it.
 */
export function mistMoundLift(r: number, moundR: number = MIST_MOUND_R): number {
  const x = (r * r) / Math.max(moundR * moundR, 1e-6);
  if (x >= 1) return 0;
  const b = 1 - x;
  return b * b;
}

/**
 * How far below the colony plane the patch's surface stands at radius `r`.
 *
 * ⭐⭐⭐ IT IS STRICTLY POSITIVE FOR EVERY `r`, WHICH IS THE STANDING LAW OF THIS
 * WHOLE FEATURE STATED AS ARITHMETIC: the mist is never drawn above the
 * membrane. The value is `mix(floorDepth, level, lift)`, so it lies between the
 * two, and both are positive depths.
 */
export function mistSurfaceDrop(
  r: number,
  floorDepth: number = MIST_FLOOR_DEPTH,
  level: number = COHORT_INTAKE_LEVEL,
  moundR: number = MIST_MOUND_R,
): number {
  const lift = mistMoundLift(r, moundR);
  return floorDepth + (level - floorDepth) * lift;
}

/**
 * The catchment weight: compact support, zero with zero slope at `reach`.
 * The same `(1 - x)²` the mound uses, on the other radius.
 */
export function mistCatchment(r: number, reach: number = MIST_REACH): number {
  const x = (r * r) / Math.max(reach * reach, 1e-6);
  if (x >= 1) return 0;
  const b = 1 - x;
  return b * b;
}

/**
 * Where a parcel of the medium now at radius `r` was `tau` seconds ago, in
 * radius: the exact back-trace of a 2-D point sink of strength `k`.
 *
 * `d(r²)/dt = -k` for a sink, so `r0² = r² + k * tau` — an identity at
 * `tau = 0`, and monotonically outward from there.
 */
export function mistSinkRadius(r: number, k: number, tau: number): number {
  return Math.sqrt(r * r + k * tau);
}

/**
 * How far around it wound getting here: `theta0 - theta = swirl * ln(r0 / r)`.
 *
 * A vortex whose circulation is `swirl` times the sink's radial flow turns a
 * parcel by exactly this much per e-fold of radius, which is the definition of
 * a logarithmic spiral. Zero at `tau = 0`, because `r0 = r` there.
 */
export function mistSpiralTurn(r: number, r0: number, swirl: number): number {
  return swirl * Math.log(r0 / r);
}

/**
 * The shipped back-trace, in the patch's own plane coordinates: the point of
 * the medium that is now at `(x, z)` was here `tau` seconds ago.
 *
 * ⚠️ IT BLENDS BACK TO THE IDENTITY AT THE CATCHMENT'S EDGE, and that is not a
 * fudge — it is what keeps the patch seamless where it stops. `rr = mix(r, r0,
 * w)` with `w` the catchment weight, so the sink's pull is full at the mouth and
 * exactly nothing at `reach`, where the patch is discarded anyway. The pure sink
 * form is `mistSinkRadius`, and this reduces to it as `r` approaches the sink,
 * where the catchment weight is 1.
 *
 * ⚠️ THE DRIFT IS SUBTRACTED, not added: `tau` is an age, so a parcel now here
 * was one drift-step BACK along the flow. (The preview added it; its ambient
 * swirl is a divergence-free wiggle where the sign is invisible, and this one's
 * is not — it decides which side of the mouth the wake trails on.)
 */
export function mistBacktrace(
  x: number,
  z: number,
  k: number,
  swirl: number,
  tau: number,
  reach: number = MIST_REACH,
  drift: readonly [number, number] = [0, 0],
  driftSpeed: number = 0,
): readonly [number, number] {
  const dx = x - drift[0] * driftSpeed * tau;
  const dz = z - drift[1] * driftSpeed * tau;
  const r2 = dx * dx + dz * dz;
  const w0 = 1 - r2 / Math.max(reach * reach, 1e-6);
  if (w0 <= 0) return [dx, dz];
  const w = w0 * w0;
  const r = Math.max(Math.sqrt(r2), 0.002);
  const r0 = mistSinkRadius(r, k, tau);
  const rr = r + (r0 - r) * w;
  const angle = mistSpiralTurn(r, rr, swirl);
  const cs = Math.cos(angle);
  const sn = Math.sin(angle);
  return [((cs * dx - sn * dz) / r) * rr, ((sn * dx + cs * dz) / r) * rr];
}

/**
 * The largest value the patch's shape can take, at the uniforms it ships with.
 *
 * ⭐ ARITHMETIC RATHER THAN SWEPT, because every factor has a known bound: the
 * medium is in [0, 1] by construction, the catchment weight and the fade are in
 * [0, 1], the gate and the wake only ever remove light, and the gather and the
 * pile are the two that multiply up. It exists so the collision in this file's
 * header is a NUMBER in the repo rather than a worry in a report.
 *
 * `gulp` is the peak of `COHORT_GULP_GLSL`'s envelope (about 0.663), so passing
 * `true` gives what a swallow can reach.
 */
export function mistPatchSupremum(throughGulp = false): number {
  // The binding radius is where the gate finishes opening: everything inside it
  // is gated to zero, and everything outside it has a smaller pile.
  const r = COHORT_RIM_R * 0.98;
  const near = mistCatchment(r, MIST_REACH);
  const gather = MIST_CONTRAST_FAR + MIST_CONTRAST_NEAR * near;
  const pile = MIST_CONC * Math.min(COHORT_RIM_R / r, 1) ** 3;
  // ⭐ The envelope's peak, SOLVED off the shipped constants rather than
  // guessed. `exp(-t/fall) * (1 - exp(-t/rise))` has a stationary point where
  // `u = exp(-t/rise)` equals `rise / (rise + fall)`, and the value there is
  // `u^(rise/fall) * (1 - u)` — 0.6633 at 0.06 s and 0.45 s.
  const u = COHORT_GULP_RISE / (COHORT_GULP_RISE + COHORT_GULP_FALL);
  const gulpPeak = u ** (COHORT_GULP_RISE / COHORT_GULP_FALL) * (1 - u);
  const flare = throughGulp
    ? COHORT_GULP_INTERIOR * gulpPeak * Math.min((COHORT_RIM_R * MIST_GULP_R) / r, 1)
    : 0;
  // fine = 1 at this radius, the medium's own ceiling is 1, the gate is 1, the
  // wake only subtracts, and the grazing path is the last multiply.
  return MIST_FIL * gather * (1 + pile + flare) * MIST_PATH_MAX * MIST_AMP;
}

/* -------------------------------------------------------------------------- *
 * The patch.
 * -------------------------------------------------------------------------- */

/**
 * ⛔ THE ONE STATEMENT THAT KEEPS THE MIST UNDER THE MEMBRANE, written once so a
 * test can pin the text and a reader can find it.
 *
 * The unit plane is laid into the instance's own local XZ and its Y is
 * `-mix(uFloorDepth, uLevel, lift)`. A mix of two positive depths is positive,
 * and the colony's transform is a rotation about world Y plus a translation, so
 * world Y comes out as `originY - drop` with `drop > 0` at every vertex, every
 * knob setting and every camera. There is no branch and no clamp involved: the
 * form itself cannot produce a vertex above the plane.
 */
export const MIST_PATCH_NEVER_ABOVE_GLSL: string = /* glsl */ `float drop = mix(uFloorDepth, uLevel, lift);
        vec3 local = vec3(offset.x, -drop, offset.y);`;

/**
 * One cohort's intake patch, as an instanced surface under the colony plane.
 *
 * ⭐⭐⭐ A SURFACE, AND THAT IS THE WHOLE FORM. Twenty-five rounds established
 * that only surfaces being drawn read as intake: a column, plume, funnel or
 * pillar under the mouth reads as a searchlight at every brightness profile
 * that was tried, and each one was built and rejected by eye. So this is a
 * patch of the mist lying under the plane, lifted toward the mouth, with the
 * medium's own texture advected along the streamlines of a sink with a vortex.
 * Nothing hangs, nothing rises past the level, nothing points anywhere.
 *
 * ⚠️ THE GEOMETRY IS A UNIT `PlaneGeometry(1, 1, N, N)` AND THE EXTENT RIDES
 * `uReach` — see the geometry contract in the file header.
 *
 * `aSeed` decorrelates the two-phase flow map so six cohorts do not cross-fade
 * on the same beat; `aGulp` is the sim second of the block this cohort won, the
 * SAME lane the face reads, on the SAME clock (`simClock.elapsedSec`), because
 * the envelope is `uTime - aGulp` and two clocks would make that difference
 * meaningless.
 */
export function makeCohortIntakePatchMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    // ⭐ THE SAME FLAGS THE MOUTH ABOVE IT WEARS, exactly: additive, unlit,
    // depth-read-only, double-sided. The patch is a surface under a membrane a
    // camera goes below, so it is seen from both sides as often as the face is.
    transparent: true,
    depthTest: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    side: THREE.DoubleSide,
    uniforms: {
      uNoise: { value: makeMistNoiseTexture() },
      uColor: { value: new THREE.Color().setRGB(...MIST_COLOR) },
      uTime: { value: 0 },
      uContextEnergy: { value: 1 },
      uReach: { value: MIST_REACH },
      uMoundR: { value: MIST_MOUND_R },
      uFloorDepth: { value: MIST_FLOOR_DEPTH },
      uLevel: { value: COHORT_INTAKE_LEVEL },
      uRimR: { value: COHORT_RIM_R },
      uK: { value: MIST_SINK_K },
      uSwirl: { value: MIST_SWIRL },
      uPeriod: { value: MIST_PERIOD },
      uDrift: { value: MIST_DRIFT },
      uDriftSign: { value: MIST_DRIFT_SIGN },
      uGrain: { value: MIST_GRAIN },
      uRidge: { value: MIST_RIDGE },
      uRidgePow: { value: MIST_RIDGE_POW },
      uFil: { value: MIST_FIL },
      uContrastNear: { value: MIST_CONTRAST_NEAR },
      uContrastFar: { value: MIST_CONTRAST_FAR },
      uFineLo: { value: MIST_FINE_LO },
      uFineHi: { value: MIST_FINE_HI },
      uConc: { value: MIST_CONC },
      uGulpR: { value: MIST_GULP_R },
      uWake: { value: MIST_WAKE },
      uWakeW: { value: MIST_WAKE_W },
      uWakeLen: { value: MIST_WAKE_LEN },
      uGateIn: { value: MIST_GATE_IN },
      uPathMax: { value: MIST_PATH_MAX },
      uAmp: { value: MIST_AMP },
    },
    vertexShader: /* glsl */ `
      attribute float aSeed;
      attribute float aGulp;

      uniform float uReach;
      uniform float uMoundR;
      uniform float uFloorDepth;
      uniform float uLevel;
      uniform float uDriftSign;

      varying vec2 vP;
      varying vec3 vWorld;
      varying vec3 vOrigin;
      varying vec2 vDrift;
      varying float vSeed;
      varying float vGulp;

      void main() {
        vSeed = aSeed;
        vGulp = aGulp;
        // The instance's own world point, for the proximity exemption. The SAME
        // quantity both aperture faces carry, read the same way.
        vec4 origin = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        vOrigin = origin.xyz;
        // ⚠️ uReach IS A UNIFORM AND HAS TO BE. The unit plane is laid into the
        // instance's local XZ, which the colony's rotation about world Y keeps
        // parallel to the colony plane; baking the extent into the geometry
        // would turn the reach knob into a rebuild.
        vec2 offset = position.xy * (uReach * 2.0);
        vP = offset;
        // The mound: 1 at the sink, 0 with ZERO SLOPE at uMoundR, so the lift
        // meets the flat floor tangentially and no camera finds a crease.
        float x = dot(offset, offset) / max(uMoundR * uMoundR, 1e-4);
        float lift = 0.0;
        if (x < 1.0) {
          float b = 1.0 - x;
          lift = b * b;
        }
        // ⛔ THE MIST IS NEVER ABOVE THE MEMBRANE. A mix of two positive depths
        // is positive, and the transform on the path is a rotation about world
        // Y plus a translation, so world Y is originY - drop with drop > 0 at
        // every vertex. The mound's top is EXACTLY uLevel under the plane,
        // which is exactly what the window in the mouth shows.
        ${MIST_PATCH_NEVER_ABOVE_GLSL}
        vec4 world = modelMatrix * instanceMatrix * vec4(local, 1.0);
        vWorld = world.xyz;
        // ⭐ THE DRIFT IS THE COLONY'S OWN TANGENT AT THIS SINK, in the frame
        // the patch is drawn in. The instance's translation is its colony-frame
        // position, so the tangential direction there is (-z, x); the sign says
        // which way the mist streams past a cohort that is itself being carried
        // around. It decides which side of the mouth the wake trails on.
        vec3 seat = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        vec2 tangent = vec2(-seat.z, seat.x);
        float tangentLen = length(tangent);
        vDrift = tangentLen > 1e-4
          ? (tangent / tangentLen) * uDriftSign
          : vec2(1.0, 0.0);
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;

      uniform sampler2D uNoise;
      uniform vec3 uColor;
      uniform float uTime;
      uniform float uContextEnergy;
      uniform float uReach;
      uniform float uRimR;
      uniform float uK;
      uniform float uSwirl;
      uniform float uPeriod;
      uniform float uDrift;
      uniform float uGrain;
      uniform float uRidge;
      uniform float uRidgePow;
      uniform float uFil;
      uniform float uContrastNear;
      uniform float uContrastFar;
      uniform float uFineLo;
      uniform float uFineHi;
      uniform float uConc;
      uniform float uGulpR;
      uniform float uWake;
      uniform float uWakeW;
      uniform float uWakeLen;
      uniform float uGateIn;
      uniform float uPathMax;
      uniform float uAmp;

      varying vec2 vP;
      varying vec3 vWorld;
      varying vec3 vOrigin;
      varying vec2 vDrift;
      varying float vSeed;
      varying float vGulp;

      // ---- the substance ---------------------------------------------------
      //
      // Isotropic ridged noise in the colony's own XZ, two octaves, the second
      // only where the field is being taken. It has NO DIRECTION OF ITS OWN —
      // that is the point, and it is what makes the mist a substance rather
      // than a sea or a set of curtains. The sink and the drift give it one.
      //
      // ⚠️ The max() is not decoration: a negative base is UNDEFINED for GLSL's
      // power function, and the ridge's base cannot be proven non-negative from
      // the source because it comes out of a texture.
      float mistMedium(vec2 q, float fine) {
        vec2 p = q * uGrain;
        float n = texture2D(uNoise, p).r * 0.63
          + texture2D(uNoise, p * 2.07 + vec2(0.31, 0.17)).g * 0.34 * fine;
        float ridged = 1.0 - abs(2.0 * n - 1.0);
        return mix(n, pow(max(ridged, 0.0), uRidgePow), uRidge);
      }

      // ---- where a parcel of it was, tau seconds ago ------------------------
      //
      // ⭐ THE EXACT BACK-TRACE OF A 2-D POINT SINK WITH A VORTEX, and not a
      // warp toward the mouth. A sink of strength k has d(r*r)/dt = -k, so a
      // parcel now at r was at sqrt(r*r + k*tau); a circulation swirl times the
      // radial flow turns it by swirl * ln(r0 / r) on the way in, which is the
      // definition of a logarithmic spiral. The medium is CARRIED along those
      // streamlines, which is why the filaments bend into the mouth instead of
      // pointing at it.
      //
      // ⚠️ The pull blends back to the identity at the catchment's edge, so the
      // patch has no seam where it stops.
      vec2 mistBacktrace(vec2 q, float tau) {
        vec2 d = q - vDrift * (uDrift * tau);
        float r2 = dot(d, d);
        float w = 1.0 - r2 / (uReach * uReach);
        if (w <= 0.0) return d;
        w *= w;
        float r = max(sqrt(r2), 0.002);
        float r0 = sqrt(r2 + uK * tau);
        float rr = mix(r, r0, w);
        float ang = uSwirl * log(rr / r);
        float cs = cos(ang);
        float sn = sin(ang);
        return vec2(cs * d.x - sn * d.y, sn * d.x + cs * d.y) / r * rr;
      }

      void main() {
        vec2 d = vP;
        float r2 = dot(d, d);
        float reach2 = uReach * uReach;
        // The quad is a SQUARE and the catchment is a DISC: 21.5 % of the
        // fragments are corner and leave here.
        if (r2 > reach2) discard;
        float r = max(sqrt(r2), 0.002);

        // The catchment: compact support, zero with zero slope at uReach.
        float w = 1.0 - r2 / reach2;
        float near = clamp(w * w, 0.0, 1.0);

        // A slab, not a plate: a grazing view crosses more of the substance.
        vec3 dir = normalize(vWorld - cameraPosition);
        float path = clamp(1.0 / max(abs(dir.y), 0.0001), 1.0, uPathMax);

        // ⭐ TWO PHASES HALF A CYCLE APART, CROSS-FADED. A single back-trace
        // stretches the medium further the older it is and would visibly snap
        // when its age wrapped; vSeed puts each cohort at its own point in the
        // cycle so six mouths never breathe together.
        float ph = uTime / uPeriod + vSeed;
        float t0 = fract(ph) * uPeriod;
        float t1 = fract(ph + 0.5) * uPeriod;
        float phaseMix = 1.0 - abs(2.0 * fract(ph) - 1.0);

        // ⭐ THE STRUCTURE IS PAID FOR ONLY WHERE IT SHOWS: below uFineLo the
        // fragment skips both back-traces and all four fetches.
        float fine = smoothstep(uFineLo, uFineHi, near);
        float gA = 0.0;
        float gB = 0.0;
        if (fine > 0.002) {
          gA = mistMedium(mistBacktrace(d, t0), fine);
          gB = mistMedium(mistBacktrace(d, t1), fine);
        }
        float g = mix(gB, gA, phaseMix);

        // ⭐⭐ THE EYE: the mist goes out INSIDE the rim, exactly as the face's
        // own structure reaches zero inside the pupil. An absence of light, and
        // never a drawn dark disc — this scene's additive idiom for a hole, one
        // plane down. Fully open before the lip, where the pile peaks.
        float gate = smoothstep(uRimR * uGateIn, uRimR * 0.98, r);

        // ⭐ THE LIP IS THE ARRIVING MEDIUM AT ITS DENSEST, not a drawn ring:
        // the cube is the area compression a 2-D sink applies to a parcel.
        float c = clamp(uRimR / r, 0.0, 1.0);
        float pile = uConc * c * c * c;

        // ---- the block this cohort won, if it has ever won one. The mouth and
        // the mist under it swallow on ONE curve and by the SAME amount: they
        // are the same surface seen through the hole and from outside it.
        ${COHORT_GULP_GLSL}
        pile += ${COHORT_GULP_INTERIOR.toFixed(1)} * gulp
          * clamp(uRimR * uGulpR / r, 0.0, 1.0);
        float gain = 1.0 + pile;

        // ⭐⭐ THE WAKE: just downstream the substance is THINNER, because what
        // was flowing there has been taken. It is the only term that says the
        // mist is consumed rather than merely stirred, and it is what keeps the
        // dividing streamline's stagnation point from drawing a second, false
        // convergence behind the mouth.
        float along = dot(d, vDrift);
        float across = dot(d, vec2(-vDrift.y, vDrift.x));
        float wake = exp(-across * across / (2.0 * uWakeW * uWakeW))
          * smoothstep(0.0, uRimR * 1.2, along)
          * (1.0 - smoothstep(uRimR * 2.5, uWakeLen, along));

        // ⚠️ NO GROUND TERM. The patch is the mist BEING TAKEN and nothing
        // else; the substance simply being there is the haze's job.
        float v = uFil * g * (uContrastFar + uContrastNear * near) * gain * fine;
        v = max(v * gate, 0.0) * (1.0 - uWake * wake) * path * uAmp;
        if (v < 0.0015) discard;
        ${COHORT_CONTEXT_ENERGY_GLSL}
        // Energy multiplies RGB and NEVER alpha — the house idiom that keeps
        // additive damping linear, and what stops the mist fighting an
        // inspection the way the mark above it refuses to.
        gl_FragColor = vec4(uColor * v * cohortEnergy, min(v, 1.0));
      }
    `,
  });
}

/* -------------------------------------------------------------------------- *
 * The haze: the substance simply being there.
 * -------------------------------------------------------------------------- */

/** The brighter sheet's weight — a few percent of the mesh's brightness. */
export const MIST_HAZE_BASE = 0.03;

/**
 * The ground's sampling frequency, in tile-widths per world unit.
 *
 * ⚠️ IT IS NOT THE PLAN'S `0.085 * 0.40`. The preview's sheets scale the medium
 * frequency per sheet before the ground's own 0.40 — `across: 0.085 * scale`
 * with `scale` 0.6 and 0.45 — so the two sheets read the tile at 0.0204 and
 * 0.0153, not at 0.034. Measured from `lab/scene.js`; the plan's table dropped
 * the per-sheet scale. At 0.0204 the tile repeats every 49 wu, which is what
 * makes the ground read as slow patchiness rather than as grain.
 */
export const MIST_HAZE_GRAIN = 0.085 * 0.6 * 0.4;

/**
 * Where the sheets start to dissolve, and where they are gone, as a fraction of
 * the colony's own elliptical footprint.
 *
 * ⭐ AN ELLIPSE AND NOT A CIRCLE, because the colony is one: `COLONY_ELLIPSE_X`
 * and `COLONY_ELLIPSE_Z` stretch the scatter 1.25 / 0.85, and a circular fade
 * over an elliptical colony would leave the sheet's edge visible off the long
 * axis and cut the short one short. ⚠️ THE SHEET MUST HAVE NO EDGE ANYWHERE: a
 * visible rim turns the substance into a plate, which is the register this
 * whole round is refusing.
 */
export const MIST_HAZE_EDGE_IN = 1.35;

/** The other end of that fade. Nothing is drawn past it. */
export const MIST_HAZE_EDGE_OUT = 2;

/**
 * The colony's own XZ radii, which the fade above is measured in.
 * 115 x 78.2 wu — the same numbers the preview used, derived rather than typed.
 */
export const MIST_HAZE_ELLIPSE: readonly [number, number] = [
  COLONY_RADIUS * COLONY_ELLIPSE_X,
  COLONY_RADIUS * COLONY_ELLIPSE_Z,
];

/**
 * The sheets, deepest last: how far under `COLONY_Y` each lies, how strong it
 * is, and how coarsely it reads the tile.
 *
 * ⭐⭐ TWO SHEETS AT DIFFERENT DEPTHS AND DIFFERENT SCALES ARE WHAT MAKE THE
 * SUBSTANCE READ AS DEEP. One sheet is a floor; two, seen through each other at
 * any angle but straight down, are a volume with nothing volumetric in it. They
 * sit BELOW the patch's own floor (`MIST_FLOOR_DEPTH`), so the intake is always
 * the nearest thing to the membrane.
 *
 * ⚠️ HOW MANY OF THEM ARE DRAWN IS A QUALITY DECISION, not a constant here: the
 * plan puts `mistHazeSheets` on the `QualityCascade` at 2 / 1 / 0, and the
 * numbers are T6's to measure.
 */
export interface MistHazeSheet {
  /** World units below the colony plane. */
  readonly depth: number;
  /** Its weight, before the grazing path. */
  readonly base: number;
  /** Tile widths per world unit. */
  readonly grain: number;
}

export const MIST_HAZE_SHEETS: readonly MistHazeSheet[] = [
  { depth: MIST_FLOOR_DEPTH + 4.5, base: MIST_HAZE_BASE, grain: MIST_HAZE_GRAIN },
  {
    depth: MIST_FLOOR_DEPTH + 11,
    base: MIST_HAZE_BASE * 0.75,
    grain: 0.085 * 0.45 * 0.4,
  },
];

/**
 * One haze sheet: the mist simply being there, at ONE fetch per fragment.
 *
 * ⭐⭐⭐ THE FIELD IS SECONDARY, AND THIS IS THE DRAW THAT HAS TO PROVE IT. It
 * covers the whole space under the colony at a few percent of the mesh's
 * brightness with NO structure at all — no filaments, no back-trace, no sinks,
 * no time. One `texture2D`, a soft elliptical fade so the sheet has no edge
 * anywhere, the grazing-path thickening, and out. That is deliberately the
 * cheapest possible program: the preview measured the whole mist layer at
 * +0.6 ms with a FULL-PLANE floor, and the sheets are the part of it that is
 * paid for over the entire screen.
 *
 * ⚠️ NO PROXIMITY EXEMPTION HERE, unlike the patch. The exemption measures the
 * camera against ONE instance origin — "the camera came for this" — and a sheet
 * 230 wu across is not a thing anybody comes for. It is passive context and it
 * is damped like passive context.
 *
 * ⚠️ AND NO `uTime`: the preview's haze does not animate, and it should not.
 * Motion in the far field is exactly what would pull focus from the mesh.
 */
export function makeMistHazeMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthTest: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    // Seen from below as often as from above: the camera goes under the plane.
    side: THREE.DoubleSide,
    uniforms: {
      uNoise: { value: makeMistNoiseTexture() },
      uColor: { value: new THREE.Color().setRGB(...MIST_COLOR) },
      uBase: { value: MIST_HAZE_BASE },
      uGrain: { value: MIST_HAZE_GRAIN },
      uEllipse: {
        value: new THREE.Vector2(MIST_HAZE_ELLIPSE[0], MIST_HAZE_ELLIPSE[1]),
      },
      uEdgeIn: { value: MIST_HAZE_EDGE_IN },
      uEdgeOut: { value: MIST_HAZE_EDGE_OUT },
      uPathMax: { value: MIST_PATH_MAX },
      uAmp: { value: MIST_AMP },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;

      void main() {
        // No instancing and no lanes: one sheet is one draw of one plane, laid
        // flat by its own mesh. The world point is all the fragment needs.
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;

      uniform sampler2D uNoise;
      uniform vec3 uColor;
      uniform vec2 uEllipse;
      uniform float uEdgeIn;
      uniform float uEdgeOut;
      uniform float uBase;
      uniform float uGrain;
      uniform float uPathMax;
      uniform float uAmp;

      varying vec3 vWorld;

      void main() {
        vec2 q = vWorld.xz;
        // ⚠️ THE SHEET HAS NO EDGE ANYWHERE. The fade is measured on the
        // colony's OWN ellipse, so it dissolves at the same proportion off
        // every axis instead of showing a rim off the long one.
        float rho = length(q / uEllipse);
        float edge = 1.0 - smoothstep(uEdgeIn, uEdgeOut, rho);
        if (edge <= 0.0) discard;
        // A slab, not a plate.
        vec3 dir = normalize(vWorld - cameraPosition);
        float path = clamp(1.0 / max(abs(dir.y), 0.0001), 1.0, uPathMax);
        // ⭐ ONE FETCH, AND THE WHOLE PROGRAM REACHES ITS RETURN WITH THAT ONE.
        // The third channel is the tile's slowest lattice, which is what makes
        // this patchiness rather than grain.
        float ground = texture2D(uNoise, q * uGrain).b;
        float v = uBase * (0.70 + 0.60 * ground) * edge * path * uAmp;
        if (v < 0.0015) discard;
        gl_FragColor = vec4(uColor * v, min(v, 1.0));
      }
    `,
  });
}
