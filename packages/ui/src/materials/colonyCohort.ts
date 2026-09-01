import * as THREE from 'three';
import { PEER_NETWORK_PALETTE } from '../visualPalette';

/**
 * The two faces of a POW cohort's mark, and nothing else.
 *
 * ⭐⭐⭐ A COHORT IS A ONE-WAY VERTICAL THROAT THROUGH THE COLONY PLANE, and
 * the whole form follows from that one sentence. Energy enters from BELOW the
 * slab — continuously, as an analytic field (`makeCohortIntakeMaterial`) —
 * and converges on a centre that is an ordinary member of the peer mesh with
 * its own middle refused (`makeCohortCoreMaterial`). The block leaves ABOVE
 * AND OUTWARD, briefly, as an event. Two faces, one axis, TWO CADENCES: the
 * intake never stops and never flares, the emission is a keyed instant, and a
 * viewer can tell which is which because they do not share a clock.
 *
 * ⭐ "BELOW" IS THE ONLY READING THE SCENE MAKES AVAILABLE, which is what
 * keeps it from being decoration. The colony slab is a 16:1 plate at
 * `Y ∈ [15, 29]`, the cells canopy sits above it at 38, and under `Y ≈ 15`
 * NOTHING WHATSOEVER IS DRAWN — the one empty region in the scene. A volume
 * hanging there cannot be mistaken for part of anything else, and the axis it
 * hangs on is the colony's own rotation axis, so it turns and parallaxes with
 * the plate for free.
 *
 * ⭐⭐ NOTHING HERE DRAWS THE EMITTING FACE, and that absence is the design
 * rather than a gap in it. `ColonyEdges`' outward surge and
 * `BlockDeliveryLayer`'s upward carrier already fire from the winning cohort's
 * own node, both keyed on `attestedOrigin`; a third mark for the same instant
 * would be a second opinion about an event two layers already agree on.
 *
 * ⭐⭐ BOTH FACES ARE ADDITIVE, UNLIT AND DEPTH-READ-ONLY, AND NO DARK PIXEL IS
 * EVER DRAWN. The throat is unlit because bright structure REFUSES TO FILL it
 * — `smoothstep(0, uRefuse, r)` on the centre, a radial profile with no edge
 * on the intake — which is this scene's own additive idiom for a hole. What
 * this replaced spent five register violations on the same idea: the only
 * normal-blended object, the only dark one, the only textured one (this
 * scene's sole `fbm`), the only oriented one and the only screen-locked one —
 * and could still be seen through by any colony edge behind it. The accepted
 * cost of the swap is that nothing behind a cohort is occluded any more.
 *
 * ⚠️ WHICH MAKES THE UNLIT MIDDLE SOMETHING OTHER LAYERS CAN BREAK. With no
 * shadow and no depth write there is nothing to reject a bright line laid
 * across the axis; it is simply added to it. `COHORT_LINK_STOP_R` below is
 * where that is paid for: a cohort's own links end at its rim, in
 * `ColonyEdges`, and the throat stays empty from every camera.
 *
 * The design argument for each face sits on its own factory below; read it
 * before touching either.
 *
 * It remains continuous idle behaviour. It takes no block pulse, flood or
 * shockwave. A cohort's recent share changes only the speed of the crests
 * running down the throat, never the size or brightness of its mark.
 */

/**
 * The peer mesh's breathing cadence, and this file's one clock rate.
 *
 * ⭐ IT IS THE MESH'S NUMBER RATHER THAN THIS MARK'S. A cohort is a peer that
 * mines, so its centre inhales on the beat every stop around it keeps. The
 * DEPTH travels with it and is not a constant here: the centre takes the peer
 * halo's own 0.78/0.22 inline. (The accreting void had a shallower one of its
 * own, `COHORT_BREATHE_DEPTH` 0.1, whose only reason was to keep a
 * continuously accreting mark from competing with the measured belt. It went
 * with the void, and nothing in this file wants it back.)
 */
export const COHORT_BREATHE_HZ = 1.2;

/* -------------------------------------------------------------------------- *
 * Shared by both faces — the proximity exemption.
 * -------------------------------------------------------------------------- */

/**
 * A cohort keeps its light when the camera comes to it.
 *
 * ⭐⭐⭐ WITHOUT THIS THE MARK IS DIMMEST EXACTLY WHERE IT IS INSPECTED.
 * `cellDetailPeerContextEnergy` winds passive peer context down to
 * `CELL_DETAIL_VIEW_PEER_CONTEXT_FLOOR` — 0.28 — as the camera closes in, and
 * `NetworkColony` hands this layer the same number it hands every other
 * passive peer draw. So a cohort flown to loses 72 % of its light at the one
 * range anybody ever looks at it from, which is also the range every
 * screenshot is taken at. The damping is right for what it was written for: a
 * hundred passive stops receding behind the subject. It is wrong for the
 * object the camera came for.
 *
 * The precedent is `makeMeasuredPeerHalosMaterial`'s
 * `mix(uContextEnergy, 1.0, vPeerSelected)` — a peer that IS the subject is
 * exempt from the recession. A cohort carries no selection lane, so proximity
 * stands in for one: the camera being here is the same statement as a click.
 *
 * ⚠️⚠️ IT MUST MEASURE FROM `cameraPosition`, AND `length(vOrigin)` IS THE
 * TRAP. `vOrigin` is `modelMatrix * instanceMatrix * vec4(0, 0, 0, 1)` — WORLD
 * space — so `length(vOrigin)` is the cohort's distance from the world ORIGIN:
 * a per-cohort constant spanning ±115 wu across a colony centred near
 * (0, 22, 0), with no relationship to where the camera is. It compiles, it
 * runs, and the exemption then either never fires or fires permanently
 * depending only on where that cohort happens to stand. `cameraPosition` is a
 * three.js built-in and is already in world space.
 *
 * ⭐ IT READS THE ORIGIN AND NEVER THE MARCHED POINT OR THE QUAD CORNER. The
 * far lip of a twenty-unit funnel is twenty units further from the camera than
 * its throat, so a per-fragment distance would bring the volume up before its
 * centre and fade the two faces of one mark apart. One distance per instance,
 * and both faces read that one.
 *
 * ⭐ IT ONLY EVER ADDS LIGHT. `mix(uContextEnergy, 1.0, k)` with `k` in
 * [0, 1] lies between its own two ends, so the result is never below
 * `uContextEnergy` and never above 1 — at every distance, for every context
 * energy. The exemption cannot dim anything, which is what makes it safe to
 * apply unconditionally rather than behind a mode.
 */

/**
 * Within this distance of the camera, the exemption is complete.
 *
 * ⭐ INSIDE `CELL_DETAIL_VIEW_NEAR_DISTANCE` (82), where the damping has
 * already bottomed out — so the exemption's band strictly CONTAINS the
 * damping's, and there is no range at which the mark is receding while the
 * exemption has not yet started.
 */
export const COHORT_CONTEXT_EXEMPT_NEAR = 70;

/**
 * Beyond this distance nothing is exempt, and a cohort is damped exactly like
 * every other passive stop around it.
 *
 * ⭐ OUTSIDE `CELL_DETAIL_VIEW_FAR_DISTANCE` (148), where the damping has not
 * begun — the other half of the containment above. In the overview a cohort
 * carries no privilege at all; what distinguishes it there is the twenty world
 * units of moving volume hanging under it.
 */
export const COHORT_CONTEXT_EXEMPT_FAR = 150;

/**
 * The exemption itself, as ONE string pasted into both programs.
 *
 * ⭐ ONE STRING AND TWO USE SITES, SO THE TWO FACES CANNOT DRIFT APART. They
 * are one mark: a funnel that came up while its centre stayed damped would be
 * a worse artefact than the bug this fixes. `cohortContextEnergy.test.ts`
 * asserts this exact text is inside both fragment sources.
 *
 * It leaves `cohortEnergy` in scope. Both fragments multiply that into RGB and
 * NEVER into alpha — the house idiom that keeps additive damping linear.
 */
export const COHORT_CONTEXT_ENERGY_GLSL = /* glsl */ `float cohortEnergy = mix(
          uContextEnergy,
          1.0,
          1.0 - smoothstep(
            ${COHORT_CONTEXT_EXEMPT_NEAR.toFixed(1)},
            ${COHORT_CONTEXT_EXEMPT_FAR.toFixed(1)},
            distance(cameraPosition, vOrigin)
          )
        );`;

/* -------------------------------------------------------------------------- *
 * The vertical throat — a cohort's INTAKE face.
 * -------------------------------------------------------------------------- */

/**
 * A POW cohort is a one-way vertical throat through the colony plane. Energy
 * enters from BELOW the slab, continuously, as an analytic field; the block
 * leaves above and outward, briefly, as an event two existing layers already
 * draw. Two faces, one axis, two cadences.
 *
 * "Below" is the only reading the scene makes available. The colony slab is a
 * 16:1 plate at `Y ∈ [15, 29]`, the cells canopy sits above it at 38, and under
 * `Y ≈ 15` NOTHING is drawn at all — it is the one empty region in the scene,
 * so a volume hanging there cannot be mistaken for part of anything else.
 *
 * ⭐ IT IS AN ANALYTIC VOLUME, NOT A SURFACE AND NOT PARTICLES. Both
 * alternatives were built and both failed: nested lathe shells read as a stack
 * of discs (the bead look, already rejected once), and smoothing them out read
 * as smoke — continuous but structureless, so nothing carried the motion. One
 * camera-facing instanced quad per cohort is a BOUNDING PROXY; the ray is
 * rebuilt in world space and marched through a closed-form density.
 *
 * ⭐⭐⭐ IT ACCUMULATES OPTICAL DEPTH, NOT EMISSION. With pure emission the ray
 * integrates the whole chord, and at the default camera it crosses roughly one
 * and a half crest periods and averages them into a featureless glow.
 * Extinction makes the near face dominate, which is what leaves a crest
 * legible after the integral.
 *
 * ⭐⭐ THE STEP ABSORBS EXACTLY, so the sum is an OPACITY and not a running
 * total that happens to look like one. `a = 1 - exp(-dA)` is the fraction this
 * step really absorbs, and `sum` and `trans` then move by the same amount in
 * opposite directions: `sum + trans == 1` after every step, however deep the
 * step is, so `sum < 1` always and `uAmp` is a fraction of a bounded quantity.
 *
 * ⚠️ IT WAS WRITTEN `sum += dA * trans` FIRST, AND THAT IS NOT BOUNDED. That
 * is the LEFT-endpoint rule for `∫ e^-s ds`: it over-estimates a decreasing
 * integrand by about `dA²/2` a step, and at 28 steps across a 20-unit reach
 * `dA` passes 1.1 near the throat. Measured supremum over a swept ray set:
 * `1.516` at the shipped constants and `6.19` at `uDensity` 20, against
 * `0.998` and `1.000` for the form above. The rule also makes the density knob
 * NON-MONOTONE in crest contrast — 2.62:1 at `uDensity` 0.25, down to 1.29:1
 * at 2, back up to 1.89:1 at 20, because once `trans` collapses in one step
 * the sum degenerates into a point sample of the first sample's density. A
 * tuner chasing contrast would walk through that dead zone and out the far
 * side into an unbounded, meaningless image. Both are pinned in
 * `materials/cohortIntake.test.ts`.
 *
 * The KNEE below is therefore a safety net and not the bound, which is what a
 * knee should be. It is still never a scale: a scale that bought the same
 * ceiling would cost 91 % of the light everywhere the mark was not clipping.
 *
 * ⭐ THE FUNNEL'S AXIS IS THE COLONY'S ROTATION AXIS (world Y), so the local
 * coordinate is just `p - throat`: no matrix, and the volume parallaxes and
 * turns with the colony for free.
 *
 * Share keeps the single meaning it has always had on this layer — how fast
 * the crests run — and never moves geometry, size or brightness.
 */

/** How far below its node the throat reaches, in world units. */
export const COHORT_INTAKE_REACH = 20;

/** Radius of the intake's mouth, at the bottom of that reach. */
export const COHORT_INTAKE_MOUTH = 6;

/**
 * Radius at the throat itself — where the funnel converges on the node.
 *
 * ⚠️ THE `_INTAKE_` IN THE MIDDLE IS LOAD-BEARING HISTORY. A plain
 * `COHORT_THROAT_R` was taken, in this same file, by the accreting void's
 * inner gas coordinate — 0.12 wu, measured against an event horizon, and not
 * this quantity at all. The two coexisted for two legs. The void is gone and
 * the short name is free again, but renaming this would silently re-point
 * every reference that ever meant the other one, so it keeps the name it was
 * born with.
 */
export const COHORT_INTAKE_THROAT_R = 0.5;

/** Below one, the wall is convex: it opens fast and then converges slowly. */
export const COHORT_INTAKE_FLARE = 0.75;

/** Above one, crests accelerate INTO the throat rather than drift evenly. */
export const COHORT_INTAKE_WARP = 1.3;

/** Crests per unit of warped height — how many bands are in flight at once. */
export const COHORT_INTAKE_CRESTS = 3.2;

/** Crest speed for a cohort holding the whole producer window. */
export const COHORT_INTAKE_RATE = 0.23;

/** Gaussian half-width of one crest, in phase units. */
export const COHORT_INTAKE_SIGMA = 0.1;

/** Density between crests. Never zero: the funnel is a MEDIUM, not a stack of
 *  shells, and the trough is what keeps it reading as one continuous body. */
export const COHORT_INTAKE_FLOOR = 0.22;

/**
 * Peak additive amplitude, before the knee.
 *
 * ⚠️ IT IS PAIRED WITH `COHORT_INTAKE_DENSITY` AND NEITHER MOVES ALONE. The
 * two together hold the funnel's light roughly constant while trading the one
 * property this design actually rests on: density is contrast, amplitude is
 * brightness, and the pair is chosen so that raising the first pays for the
 * second. Measured live on the real GPU, integrated light over the whole
 * funnel moves 1855 against the previous 1743 — 6 % — for a crest ratio that
 * roughly doubles.
 *
 * ⚠️ 0.74 with density 0.95 was the lab's number and it was a SMOOTH CONE. At
 * the camera the user inspects from, the axial profile at those constants has
 * no local maximum anywhere along the funnel: the crests did not merely read
 * weakly, they were not present in the image at all. That is the searchlight
 * failure mode this design names as its main risk, and it was shipping.
 */
export const COHORT_INTAKE_AMP = 1.8;

/**
 * Extinction per unit of density along the ray.
 *
 * ⭐⭐⭐ THIS IS THE CONTRAST KNOB, AND CONTRAST IS THE WHOLE DESIGN. A still
 * of a funnel narrowing to a bright point is ambiguous between a searchlight
 * and a drain; only travelling crests decide it. The exact absorption step
 * makes crest contrast fall MONOTONICALLY as this rises — measured live at
 * 0.15/0.25/0.30/0.40/0.60/0.95 giving 3.91/3.03/3.02/2.51/2.05/(none) at the
 * inspection camera — so low density is what keeps the near face dominant and
 * the crests separate.
 *
 * ⭐ AND THE FLOOR IS NOT ZERO. Taken far enough down the medium turns
 * optically thin, the march degenerates towards a plain emission integral, and
 * the plan's original objection returns: the ray averages the whole chord and
 * the structure goes back into a glow. 0.25 sits where the crests are fully
 * separated while the supremum still leaves the mark 2x under the additive
 * clip; 0.15 buys a little more ratio for a peak at 52 % of clip, which is
 * headroom this mark has to spend on being ADDED to a lit scene.
 */
export const COHORT_INTAKE_DENSITY = 0.25;

/** ⭐ FLUX CONSERVATION, not a brightness ramp: the same throughput squeezed
 *  into a narrower cross-section has to get denser, and that — not a painted
 *  gradient — is what makes the convergence read as a convergence. */
export const COHORT_INTAKE_GATHER = 0.8;

/** Radial falloff exponent. There is no edge anywhere in the volume. */
export const COHORT_INTAKE_EDGE = 3;

/**
 * Turns of helical twist per revolution.
 *
 * ⚠️ MUST BE AN INTEGER. `theta` comes from `atan(z, x)` and wraps by exactly
 * one turn across the −x seam, so the phase jumps by `uHelix` there; only an
 * integral jump is invisible under `fract`. Zero by default: at one turn with a
 * facing fade the funnel read as a wisp of smoke.
 */
export const COHORT_INTAKE_HELIX = 0;

/** Swirl of that helix about the axis, per second. Inert while helix is 0. */
export const COHORT_INTAKE_SWIRL = 0.055;

/**
 * Samples along the clipped chord. The one real perf lever in this layer.
 *
 * ⭐⭐⭐ 20, AND THE EIGHT STEPS IT GAVE UP WERE BUYING NOTHING. Cost is linear
 * in this number at about 0.0145 ms a step, so 28 put the pair above the two
 * draws it replaced; the question was what the extra steps bought. Measured on
 * the real GPU at the inspection camera, against the 28-step frame:
 * ZERO pixels differ by more than one 8-bit code at 20, at 16, or even at 12,
 * and the first visible change is at 6. The density is analytic and smooth, so
 * the absorption integral has already converged long before 20 — the step
 * count was over-provisioned against a banding risk that this integrand does
 * not have. 20 keeps a 2x margin over the 10 steps where the first sub-code
 * differences appear at all.
 */
export const COHORT_INTAKE_STEPS = 20;

/** Compile-time ceiling on the march. The loop is bounded by a literal so the
 *  program is legal under ESSL 1.00 as well; `uSteps` rides inside it. */
export const COHORT_INTAKE_MAX_STEPS = 48;

/** Soft knee on the accumulated amplitude. ⭐ A KNEE AND NEVER A SCALE. */
export const COHORT_CLIP_KNEE = 0.92;

/** Crest speed for a cohort holding none of the window. Share moves the rate
 *  between this and 1 and touches nothing else: `0.62 + 0.38 * share`. */
export const COHORT_INTAKE_RATE_FLOOR = 0.62;

/**
 * Half-extent of the bounding quad, in world units.
 *
 * The volume is a cylinder of radius `uMouth` and height `uReach` hanging below
 * the throat, so its bounding sphere is centred half a reach down and has this
 * radius. A camera-facing square of the same half-extent covers that sphere's
 * silhouette from every direction. Everything the square adds beyond the
 * volume discards in the ray clip before the march — about 83 % of its area.
 */
export function cohortIntakeHalfExtent(mouth: number, reach: number): number {
  return Math.sqrt(mouth * mouth + (reach * 0.5) * (reach * 0.5));
}

/**
 * The same radius at the shipped mouth and reach: 11.662 world units.
 *
 * ⚠️ IT IS A FUNCTION OF BOTH AND THE LAYER HAS TO KEEP IT ONE. `cohortMouth`
 * and `cohortReach` are live knobs, and a proxy that stayed at this value
 * while the volume grew would crop the funnel against its own bounding quad —
 * the ray clip inside would still be exact, but the pixels carrying the far
 * side of the mouth would never be rasterised to run it. `ColonyCohorts`
 * therefore re-derives `uHalf` through the function above every frame; this
 * constant is what the material is BUILT with, not the last word on it.
 */
export const COHORT_INTAKE_HALF_EXTENT = cohortIntakeHalfExtent(
  COHORT_INTAKE_MOUTH,
  COHORT_INTAKE_REACH,
);

/**
 * One cohort's intake, as an instanced raymarched volume.
 *
 * ⚠️ THE GEOMETRY MUST BE `PlaneGeometry(1, 1)`. This quad carries its world
 * extent in the `uHalf` UNIFORM rather than baked into the geometry — because
 * the shader builds the quad from raw `position` and camera axes, which no
 * model matrix ever touches, so both `mesh.scale` and a scaled instance matrix
 * are silently ignored. A unit plane with the extent baked in would render one
 * world unit across and look like nothing at all. ⚠️ THE TWO MATERIALS THIS
 * FILE USED TO SHIP DID THE OPPOSITE — they baked their extent into
 * `PlaneGeometry(half * 2, half * 2)` and read `position` as world units,
 * which is exactly why they never met this trap — so a habit carried over from
 * them renders the funnel 3.7x too big. (It cost a full lab round; it hit two
 * materials at once.)
 *
 * `aSeed` changes only when the cohort set moves; `aShare` is rewritten in
 * place whenever the producer window does.
 */
export function makeCohortIntakeMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthTest: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    uniforms: {
      uColor: {
        value: new THREE.Color().setRGB(...PEER_NETWORK_PALETTE.scaffold),
      },
      uTime: { value: 0 },
      uContextEnergy: { value: 1 },
      uHalf: { value: COHORT_INTAKE_HALF_EXTENT },
      uRateFloor: { value: COHORT_INTAKE_RATE_FLOOR },
      uAmp: { value: COHORT_INTAKE_AMP },
      uReach: { value: COHORT_INTAKE_REACH },
      uMouth: { value: COHORT_INTAKE_MOUTH },
      uThroatR: { value: COHORT_INTAKE_THROAT_R },
      uFlare: { value: COHORT_INTAKE_FLARE },
      uWarp: { value: COHORT_INTAKE_WARP },
      uCrests: { value: COHORT_INTAKE_CRESTS },
      uRate: { value: COHORT_INTAKE_RATE },
      uSigma: { value: COHORT_INTAKE_SIGMA },
      uFloor: { value: COHORT_INTAKE_FLOOR },
      uGather: { value: COHORT_INTAKE_GATHER },
      uEdge: { value: COHORT_INTAKE_EDGE },
      uHelix: { value: COHORT_INTAKE_HELIX },
      uSwirl: { value: COHORT_INTAKE_SWIRL },
      uSteps: { value: COHORT_INTAKE_STEPS },
      uKnee: { value: COHORT_CLIP_KNEE },
      uDensity: { value: COHORT_INTAKE_DENSITY },
    },
    vertexShader: /* glsl */ `
      attribute float aSeed;
      attribute float aShare;

      uniform float uHalf;
      uniform float uReach;
      uniform float uRateFloor;

      varying vec3 vWorld;
      varying vec3 vOrigin;
      varying float vSeed;
      varying float vRateScale;

      void main() {
        vSeed = aSeed;
        // Share has one visual meaning: how fast this throat's crests run.
        vRateScale = mix(uRateFloor, 1.0, clamp(aShare, 0.0, 1.0));
        // ⭐ THE THROAT IS DERIVED HERE AND IS NEVER A CPU UNIFORM. The
        // colony turns about world Y under this layer, so a throat written
        // once a frame from the CPU would lag the rotation and drag every
        // funnel off the node it belongs to. The instance origin IS the
        // throat, exactly, on whatever frame the GPU is drawing.
        vec4 anchor = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        vOrigin = anchor.xyz;
        // The quad is a bounding proxy, so it is centred on the VOLUME —
        // half a reach below the throat — not on the throat. Offsetting the
        // mesh instead and adding the reach back would give the same point
        // one operation later and only while the instance matrix stays a
        // pure translation.
        vec3 centre = anchor.xyz - vec3(0.0, uReach * 0.5, 0.0);
        vec3 cameraRight = vec3(
          viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]
        );
        vec3 cameraUp = vec3(
          viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]
        );
        // ⚠️ uHalf IS A UNIFORM AND HAS TO BE — see the factory's comment.
        vWorld = centre
          + (cameraRight * position.x + cameraUp * position.y) * uHalf * 2.0;
        gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;

      uniform vec3 uColor;
      uniform float uTime;
      uniform float uContextEnergy;
      uniform float uAmp;
      uniform float uReach;
      uniform float uMouth;
      uniform float uThroatR;
      uniform float uFlare;
      uniform float uWarp;
      uniform float uCrests;
      uniform float uRate;
      uniform float uSigma;
      uniform float uFloor;
      uniform float uGather;
      uniform float uEdge;
      uniform float uHelix;
      uniform float uSwirl;
      uniform float uSteps;
      uniform float uKnee;
      uniform float uDensity;

      varying vec3 vWorld;
      varying vec3 vOrigin;
      varying float vSeed;
      varying float vRateScale;

      const float TAU = 6.28318530718;

      /** Radius of the wall at height h, 0 at the throat and 1 at the mouth. */
      float intakeRadiusAt(float h) {
        return uThroatR + (uMouth - uThroatR) * pow(max(h, 0.0), uFlare);
      }

      /** The whole form, in closed form, at one point of the funnel frame. */
      float intakeDensityAt(vec3 rel) {
        float h = -rel.y / uReach;
        if (h < 0.0 || h > 1.0) return 0.0;
        float rho = length(rel.xz);
        float R = intakeRadiusAt(h);
        float q = rho / max(R, 0.001);
        float radial = exp(-q * q * uEdge);
        float s = pow(max(h, 0.0), uWarp);
        float theta = atan(rel.z, rel.x);
        float w = fract(
          s * uCrests
            + uHelix * (theta / TAU + uTime * uSwirl)
            + uTime * uRate * vRateScale
            + vSeed
        );
        float dw = min(w, 1.0 - w);
        float crest = uFloor
          + (1.0 - uFloor) * exp(-(dw * dw) / (2.0 * uSigma * uSigma));
        float gather = pow(uMouth / max(R, 0.001), uGather);
        float mouthFade = 1.0 - smoothstep(0.74, 1.0, h);
        float throatFade = smoothstep(0.0, 0.10, h);
        return radial * crest * gather * mouthFade * throatFade;
      }

      void main() {
        vec3 rayOrigin = cameraPosition;
        vec3 rayDir = normalize(vWorld - rayOrigin);
        vec3 rel0 = rayOrigin - vOrigin;

        // Clip the ray to the y slab intersected with the bounding cylinder
        // before marching anything. Most of the quad leaves here.
        float t0 = 0.0;
        float t1 = 1e9;
        if (abs(rayDir.y) > 1e-6) {
          float ta = (0.0 - rel0.y) / rayDir.y;
          float tb = (-uReach - rel0.y) / rayDir.y;
          t0 = max(t0, min(ta, tb));
          t1 = min(t1, max(ta, tb));
        } else if (rel0.y > 0.0 || rel0.y < -uReach) {
          discard;
        }
        float a = dot(rayDir.xz, rayDir.xz);
        float b = 2.0 * dot(rel0.xz, rayDir.xz);
        float c = dot(rel0.xz, rel0.xz) - uMouth * uMouth;
        float disc = b * b - 4.0 * a * c;
        if (disc <= 0.0 || a < 1e-9) discard;
        float sq = sqrt(disc);
        t0 = max(t0, (-b - sq) / (2.0 * a));
        t1 = min(t1, (-b + sq) / (2.0 * a));
        if (t1 <= t0) discard;

        // ⭐⭐⭐ EXTINCTION IS WHAT KEEPS THE STRUCTURE. Pure emission
        // integrates the whole chord and averages the crests into a glow.
        float steps = uSteps;
        float dt = (t1 - t0) / steps;
        float sum = 0.0;
        float trans = 1.0;
        for (int i = 0; i < ${COHORT_INTAKE_MAX_STEPS}; i++) {
          if (float(i) >= steps) break;
          vec3 p = rel0 + rayDir * (t0 + (float(i) + 0.5) * dt);
          float dA = intakeDensityAt(p) * dt * uDensity;
          // ⭐ THE EXACT EMISSION-ABSORPTION STEP, and never sum += dA * trans.
          // Here a is the fraction this step actually absorbs, so the pair
          // telescopes: sum + trans stays exactly 1 however deep the step is.
          // It costs nothing — exp(-dA) was already needed for trans.
          // (No backticks in this comment: one would close the literal.)
          float a = 1.0 - exp(-dA);
          sum += a * trans;
          trans *= 1.0 - a;
          if (trans < 0.004) break;
        }
        float amp = uAmp * sum;
        if (amp < 0.0015) discard;
        // ⭐ A SOFT KNEE, NEVER A SCALE: a scale that bought this ceiling
        // would cost 91 % of the light everywhere the mark was not clipping.
        amp = uKnee * (1.0 - exp(-amp / uKnee));
        ${COHORT_CONTEXT_ENERGY_GLSL}
        // Additive blending uses source alpha as its factor. Keeping context
        // energy in RGB only preserves linear scene-focus damping — and the
        // exemption above rides that same channel, so a cohort the camera has
        // come to keeps its light without its alpha ever moving.
        gl_FragColor = vec4(uColor * amp * cohortEnergy, amp);
      }
    `,
  });
}

/* -------------------------------------------------------------------------- *
 * The vertical throat — a cohort's CENTRE.
 * -------------------------------------------------------------------------- */

/**
 * The point the intake converges on, drawn as an ordinary member of the peer
 * mesh — and then refused at its own middle.
 *
 * ⭐ THE PROFILE IS THE PEER FAMILY'S OWN, NOT A NEW ONE. Same core exponent,
 * same skirt exponent and weight, same breathing cadence and depth as
 * `makePeerHaloMaterial`. A cohort is a peer that mines; nothing about the
 * resting grammar of a stop should have to be re-learned to read it, and the
 * one thing that distinguishes it — the funnel hanging below — is structure
 * and footprint rather than hue or heat.
 *
 * ⭐ IT IS DELIBERATELY NOT THE BRIGHTEST PIXEL ON SCREEN. The standing law
 * from R16: PRESENCE IS SIZE AND STRUCTURE, NOT A SATURATED CORE. The whole
 * mark is legible at a fraction of the light the old aperture spent, because
 * what identifies it is twenty world units of moving volume, not a hot dot.
 *
 * ⭐⭐⭐ AND IT MUST STAY UNDER 1.0 IN EVERY CHANNEL. Additive blending applies
 * source alpha to RGB, so the screen receives `uColor * shape²`; the scaffold
 * cyan is `#1AD1FF`, whose BLUE IS EXACTLY FULL, so a shape reaching 1.0 clips
 * that channel flat and the mark's structure becomes literally invisible
 * inside a white-cyan blob. R16's T7 spent a whole live leg discovering this
 * from the far side. The resting supremum here is 0.3359, pinned in
 * `materials/cohortCore.test.ts`, which puts 0.113 on the screen — nearly 9x
 * under the clip.
 *
 * ⚠️ AND THE PROBE CHANNEL IS BLUE, NOT RED. R16's rule said red, because on
 * a mark that was already blown out blue carried no information. This mark is
 * nowhere near clipping, so the channel to measure is the one with the most
 * signal, and on `#1AD1FF` that is blue by about 4x over red — red sits near
 * the noise floor at 7/255. Red is the right probe only for a mark suspected
 * of clipping; blue is the right probe for one that is not.
 *
 * ⭐ THE THROAT IS REFUSED, NOT PAINTED DARK. `smoothstep(0, uRefuse, r)` takes
 * the profile to EXACTLY zero on the axis, so the convergence point is the one
 * place bright structure declines to fill. That is this scene's own additive
 * idiom for a hole: no dark pixel is ever drawn, and nothing behind the mark is
 * removed.
 */

/**
 * Peak additive amplitude of the centre, before the breathe.
 *
 * ⚠️⚠️ 0.34 WAS NOT A DIM CENTRE, IT WAS EFFECTIVELY NO CENTRE. Measured live
 * and isolated on the real GPU, in the same frame as the funnel it is compared
 * against, it came to 1/17 of the intake by peak and **1/346 BY INTEGRATED
 * LIGHT** — and that is a correctness problem, not a matter of taste, because
 * `COHORT_HIT_RADIUS` is anchored on this face. The
 * pick target was 1.15 world units of nothing: the links already stop short of
 * the centre so the throat stays unlit, so at 0.34 there was no longer
 * anything drawn where the node a viewer aims at actually stands.
 *
 * ⭐ 0.62 IS STILL NOT THE BRIGHTEST PIXEL, AND MUST NOT BECOME ONE. It reads
 * at 1/5.2 of the intake by peak and 1/99 by integrated light — a 3.5x gain in
 * the light ratio, both halves measured in one frame: a ring with an
 * unlit middle, plainly visible at rest, and an order of magnitude short of
 * the funnel that is what identifies the mark. The standing law is unmoved —
 * PRESENCE IS SIZE AND STRUCTURE, NOT A SATURATED CORE.
 *
 * ⚠️ THE KNOB'S CEILING IS THE GUARD, AND IT IS GENUINELY AT THE EDGE — but
 * of the ANALYTIC bound, not of the image. `core <= 1`, `halo <= 0.42`,
 * `refuse <= 1` and `breathe <= 1` give `shape <= amp * 1.42`, so that bound
 * reaches the clip at amp 0.704 and `cohortCoreAmp` stops at 0.7 to stay
 * under it however the knobs are combined. The bound is loose by 2.6x,
 * though, because `core + halo` peaks at `r = 0` where `refuse` is exactly
 * zero and the two can never be at their maxima together: the real profile
 * peaks at 0.542 of the amplitude, so the IMAGE would not clip until 1.845.
 * 0.62 measures at 9.8 % of full scale on the real GPU. Both numbers are
 * true and they answer different questions — do not quote the loose one as
 * the distance to the clip, or the tight one as a licence to raise the knob.
 *
 * ⚠️ EVERY RATIO ABOVE IS FRAME-DEPENDENT TO A FEW PER CENT, because the
 * producer set moves under a live chain and each cohort's funnel is a
 * different size on screen. Compare the two faces WITHIN ONE FRAME or the
 * comparison drifts by more than the effect being measured.
 */
export const COHORT_CORE_AMP = 0.62;

/** Half-extent of the centre's billboard, in world units. */
export const COHORT_CORE_HALF = 2.3;

/**
 * The cohort's pick radius, in world units. `ColonyNodes` re-exports it as
 * `ATTESTED_HIT_RADIUS`, and it is the whole of what a viewer aims at.
 *
 * ⭐ IT IS DERIVED FROM THE FACE THAT ACTUALLY HAS A FOOTPRINT. It used to be
 * `COHORT_RIM_R`, the accreting void's disc, and that disc no longer exists.
 * The intake cannot supply the number either: it is twenty world units of
 * volume hanging BELOW the node, and a sphere that covered it would put a wall
 * of invisible target in front of the colony. The centre is the only face left
 * with a bounded on-screen extent, so the target comes off it.
 *
 * ⭐ HALF that extent, and not all of it, because the billboard is a BOUNDING
 * SQUARE around a radial profile. `pow(1-r,4) + pow(1-r,1.6)*0.42` is 37 % of
 * its own peak at `r = 0.5`, under a tenth of it past `r = 0.75`, and exactly
 * zero at the rim; half the extent puts the target's edge on pixels that are
 * still plainly lit rather than out in the tail where there is nothing to aim
 * at. There is still exactly ONE number — no annulus, no second radius.
 *
 * ⭐ And `2.3 * 0.5` is `1.15` EXACTLY, which is the radius this layer has
 * been picking with all along: the change is one of derivation, not of
 * behaviour, so every press, hover and miss stays bit-identical while the
 * number finally comes from a mark that is on screen. Pinned both ways in
 * `components/ColonySightedNodes.test.tsx`.
 */
export const COHORT_HIT_RADIUS = COHORT_CORE_HALF * 0.5;

/**
 * Radius, as a fraction of the billboard's half-extent, over which the profile
 * climbs out of the throat. Zero at the axis; fully lit beyond it.
 */
export const COHORT_CORE_REFUSE = 0.3;

/**
 * How far short of a cohort's centre its own links stop, in world units.
 *
 * ⭐⭐⭐ A LINK RUNNING TO THE CENTRE FILLS THE ONE PLACE THIS WHOLE FORM KEEPS
 * EMPTY. The throat is not painted dark — `smoothstep(0, uRefuse, r)` takes the
 * centre's profile to exactly zero on the axis, and the hole is that refusal
 * and nothing else. There is no shadow left to hide anything: every face here
 * is additive and depth-read-only, so a bright line laid across the axis is
 * simply added to it, and the convergence stops being a convergence. `ColonyEdges`
 * therefore ends a cohort's links out here rather than at its node.
 *
 * ⭐ IT IS `COHORT_HIT_RADIUS`, BY DERIVATION AND NOT BY COINCIDENCE. A mark is
 * allowed exactly one number for where it ends, and this layer must not invent
 * a second: the pick target and the link stop are the same claim measured for
 * two consumers — a viewer's aim and a line's end. Let them drift and the
 * colony says two different things about one edge, either a target reaching
 * past where the links stop or links stopping past where anything can be hit.
 * So the radius comes from the face that has a footprint (the centre, half its
 * billboard extent — 1.15 wu), through the constant that already says so.
 *
 * ⭐ AND IT CLEARS THE REFUSAL BY 1.67x. The well is
 * `COHORT_CORE_REFUSE * COHORT_CORE_HALF` = 0.69 wu wide; a link ending at 1.15
 * plugs into pixels that are still plainly lit — 37 % of the centre's own peak
 * at `r = 0.5` — while never reaching the part that is dark on purpose. Both
 * halves of that are pinned in `components/colonyEdgesCohortStop.test.ts`.
 */
export const COHORT_LINK_STOP_R = COHORT_HIT_RADIUS;

/**
 * One cohort's centre, as an instanced camera-facing billboard.
 *
 * ⚠️ THE GEOMETRY MUST BE `PlaneGeometry(1, 1)`, for the same reason the
 * intake's must: the quad is rebuilt from raw `position` and the view matrix's
 * camera axes, which no model matrix ever touches, so `mesh.scale` and a scaled
 * instance matrix are both silently ignored and the extent has to ride the
 * `uHalf` UNIFORM. ⚠️ THE TWO MATERIALS THIS FILE USED TO SHIP DID THE
 * OPPOSITE — they baked their extent into `PlaneGeometry(half * 2, half * 2)`
 * and read `position` as world units, which is precisely why they never met
 * this trap — so a quad inherited from that habit renders the mark 3.7x too
 * big. Both draws in the layer take ONE shared unit plane now, which is what
 * makes the rule structural rather than remembered.
 *
 * `aSeed` is the same per-instance lane the intake reads, consumed differently:
 * the intake wants turns of crest phase and takes it raw, the breathe wants
 * radians and takes it times TAU.
 */
export function makeCohortCoreMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthTest: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    uniforms: {
      uColor: {
        value: new THREE.Color().setRGB(...PEER_NETWORK_PALETTE.scaffold),
      },
      uTime: { value: 0 },
      uContextEnergy: { value: 1 },
      uHalf: { value: COHORT_CORE_HALF },
      uAmp: { value: COHORT_CORE_AMP },
      uRefuse: { value: COHORT_CORE_REFUSE },
      uBreatheHz: { value: COHORT_BREATHE_HZ },
    },
    vertexShader: /* glsl */ `
      attribute float aSeed;

      uniform float uHalf;

      varying vec2 vUv;
      varying vec3 vOrigin;
      varying float vPhase;

      const float TAU = 6.28318530718;

      void main() {
        vUv = uv;
        // The seed is a fraction of a turn on both faces of this mark; the
        // breathe measures its phase in radians, so it takes a whole turn.
        vPhase = aSeed * TAU;
        vec4 origin = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        // The instance's own world point, carried to the fragment for the
        // proximity exemption. It is the SAME quantity the intake's vOrigin
        // carries -- one distance per instance, read identically by both
        // faces, and never the quad corner, which would fade a mark's rim in
        // ahead of its middle. (No backticks in a GLSL comment: one closes
        // the template literal, and the error it raises is a TS parse error
        // pointing at the shader.)
        vOrigin = origin.xyz;
        vec3 cameraRight = vec3(
          viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]
        );
        vec3 cameraUp = vec3(
          viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]
        );
        // ⚠️ uHalf IS A UNIFORM AND HAS TO BE — see the factory's comment.
        vec3 world = origin.xyz
          + (cameraRight * position.x + cameraUp * position.y) * uHalf * 2.0;
        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;

      uniform vec3 uColor;
      uniform float uTime;
      uniform float uContextEnergy;
      uniform float uAmp;
      uniform float uRefuse;
      uniform float uBreatheHz;

      varying vec2 vUv;
      varying vec3 vOrigin;
      varying float vPhase;

      void main() {
        float r = length(vUv - 0.5) * 2.0;
        if (r > 1.0) discard;
        // The peer mesh's own resting profile, exponent for exponent. The
        // clamps are not decoration: pow with a negative base is undefined in
        // GLSL, and the guard that proves it cannot see the discard above.
        float core = pow(max(1.0 - r, 0.0), 4.0);
        float halo = pow(max(1.0 - r, 0.0), 1.6) * 0.42;
        // ⭐ THE THROAT, UNLIT. Exactly zero on the axis — a refusal to fill,
        // not a dark disc laid over the scene. ⚠️ The max() keeps edge0 below
        // edge1 if a knob ever drives uRefuse to zero; smoothstep with
        // edge0 >= edge1 is UNDEFINED in GLSL ES and has rendered nothing at
        // all on this project's own driver once already.
        float refuse = smoothstep(0.0, max(uRefuse, 0.001), r);
        float breathe = 0.78 + 0.22 * sin(uTime * uBreatheHz + vPhase);
        float shape = (core + halo) * refuse * uAmp * breathe;
        if (shape < 0.0015) discard;
        ${COHORT_CONTEXT_ENERGY_GLSL}
        // Additive blending uses source alpha as its factor. Keeping context
        // energy in RGB only preserves linear scene-focus damping — and the
        // exemption above rides that same channel, so a cohort the camera has
        // come to keeps its light without its alpha ever moving.
        gl_FragColor = vec4(uColor * shape * cohortEnergy, shape);
      }
    `,
  });
}

/* -------------------------------------------------------------------------- *
 * The aperture — a cohort's mark as a hole in the colony plane.
 * -------------------------------------------------------------------------- */

/**
 * The mark IS the aperture, and it is drawn as two faces of one hole.
 *
 * ⭐⭐⭐ A PLANET BLOCKS THE BACKGROUND; A HOLE BENDS IT. Every volumetric form
 * this feature tried put a 20–40 world-unit body next to a mesh built from 1–2
 * wu sprites and thin lines, and each read as a landscape feature rather than
 * as a junction — a searchlight, a cooling tower, a drain. What survived every
 * round was the aperture itself, so this drops the volume entirely and draws
 * only the opening.
 *
 * 1. `makeCohortFaceMaterial` — a disc LYING IN THE COLONY PLANE: a bright rim,
 *    a small dark pupil, and a fine radial intake grain. ⭐ It draws a CIRCLE;
 *    every ellipse a viewer sees is projection, and because all cohorts
 *    foreshorten identically that agreement is what makes the colony plane
 *    itself legible.
 * 2. `makeCohortAuraMaterial` — a small camera-facing quad whose halo carries
 *    THE SAME HOLE, cut by crossing the view ray with the colony plane. ⚠️ It
 *    is not decoration: below roughly 15° of elevation it is the only thing
 *    keeping the mark from reading as a dash among the peer links.
 *
 * ⭐ ORIENTATION IS SHARED WITH THE COLONY'S OWN PLANE AND IS NEVER PER-COHORT.
 * The plane's normal is world Y, which is also the colony's rotation axis, so
 * the face needs no matrix of its own and turns with the plate for free. The
 * register violation this stays clear of is a mark with an axis a viewer could
 * read as pointing somewhere; a circle in the shared plane has none.
 *
 * ⚠️ 「从下方汲取能量」 IS NOT EXPRESSED HERE, AND THAT IS A DECISION. Measured
 * in the lab: a sub-plane shaft gated through the hole is invisible except from
 * directly overhead, and ungated it is a searchlight in miniature. It does not
 * earn a draw, so it is not in this file — do not smuggle a substitute in.
 */

/**
 * The outer radius of the mark, in world units. ⭐ THE size parameter: every
 * other length here is a fraction of it.
 *
 * Measured sweet spot of a 2.4–3.8 band: 6.0 wu across, with a bright ring at
 * 1.68 wu against a sighted peer's 1.5. Below 2.4 the structure stops resolving
 * at the app camera; above 4 the mark starts to dominate the colony.
 */
export const COHORT_AP_R = 3.0;

/** Rim radius, as a fraction of `COHORT_AP_R` — 0.84 wu at the shipped size. */
export const COHORT_AP_RIM_FRAC = 0.28;

/**
 * Pupil radius, as a fraction of the RIM radius. A small dark pupil: 0.52 wu.
 *
 * ⭐ BOTH FACES READ THIS ONE NUMBER, which is what makes the aura's hole and
 * the face's the same hole rather than two that were tuned to agree.
 */
export const COHORT_AP_PUPIL_FRAC = 0.62;

/**
 * Depth of the shared breathe, as a fraction. The RATE is `COHORT_BREATHE_HZ` —
 * this file has one clock and the aperture does not get a second one.
 *
 * ⚠️ THE LAB SOURCE HARD-CODED 1.1 Hz HERE and that would have been a second
 * cadence in a file whose whole argument is that the intake and the emission
 * are told apart by NOT sharing a clock. The depth travels per-face (the centre
 * carries 0.22 inline); the rate does not.
 */
export const COHORT_AP_BREATHE_DEPTH = 0.09;

/* ------------------------------------------------------------------ the face */

/** Softness of the pupil's edge, as a fraction of the pupil radius. */
export const COHORT_FACE_PUPIL_SOFT = 0.5;

/** Gaussian half-width of the rim, as a fraction of the rim radius. */
export const COHORT_FACE_RIM_W = 0.34;

/** How hard the rim burns, before the knee. */
export const COHORT_FACE_RIM_AMP = 1.05;

/** How far the rim tips toward cold white at its own peak. */
export const COHORT_FACE_HOT_MIX = 0.45;

/** Amplitude of the intake skirt, from the rim out to `COHORT_AP_R`. */
export const COHORT_FACE_INTAKE_AMP = 0.72;

/**
 * Fall-off exponent across the skirt. ⭐ THE SMOOTH HALO HAS TO OUTREACH THE
 * GRAIN, or the silhouette stops being a clean ellipse.
 */
export const COHORT_FACE_INTAKE_GAMMA = 2.4;

/**
 * Fill just outside the rim, so the pupil is a hole in a LIT SURFACE and not a
 * gap between two rings.
 */
export const COHORT_FACE_INTAKE_CORE = 0.6;

/**
 * ⭐⭐⭐ THE NUMBER OF RADIAL STRIAE, AND THE ONE LAW THAT DECIDES WHETHER THIS
 * MARK IS A GRAIN OR A SUNFLOWER.
 *
 * Measured over 48 variants and four sweeps: at 44 striae or fewer, radial
 * structure on a small bright mark reads as a STAR — regardless of the
 * modulation's sign (additive, subtractive or symmetric), its contrast
 * (0.22–0.9) or its reach. Nothing else recovers it. COUNT IS THE ONLY ESCAPE:
 * past roughly 64 the striae stop being countable and become a texture, which
 * is what a medium being drawn inward actually looks like.
 *
 * `COHORT_FACE_STRIAE_FLOOR` is that measured floor, exported so the law is
 * visible in the source and pinned in `materials/cohortAperture.test.ts`.
 */
export const COHORT_FACE_STRIAE = 88;

/** The measured floor the count above must never fall below. See it for why. */
export const COHORT_FACE_STRIAE_FLOOR = 64;

/**
 * Depth of the stria modulation.
 *
 * ⭐⭐⭐ IT IS PURELY SUBTRACTIVE, AND THAT IS WHAT KEEPS THE SILHOUETTE ROUND.
 * `COHORT_FACE_STRIA_LIFT` at 1 makes the modulation `1 + amt * (cos-bump - 1)`,
 * which lies in `[1 - amt, 1]` — the striae can only ever REMOVE light. A
 * mean-preserving or additive modulation displaces the iso-brightness contour
 * OUTWARD wherever a stria sits, so the outline scallops and the mark reads as
 * a sunflower; that happened in every variant of the first two sweeps. Taking
 * light away instead leaves the outline exactly where the smooth halo put it
 * and carves the grain into the interior.
 */
export const COHORT_FACE_STRIA_AMP = 0.38;

/** 1 = purely subtractive, 0.5 = symmetric, 0 = purely additive. See above. */
export const COHORT_FACE_STRIA_LIFT = 1;

/** Where the grain fades in, as a fraction of the skirt. */
export const COHORT_FACE_STRIA_R0 = 0.02;

/** Where it is completely gone — well inside the smooth halo. */
export const COHORT_FACE_STRIA_R1 = 0.9;

/** Width of each of those two fades. */
export const COHORT_FACE_STRIA_W = 0.08;

/**
 * Azimuthal drift of the grain, in turns per second.
 *
 * ⚠️ IT IS NOT A SHARE LANE AND MUST NOT BECOME ONE WITHOUT A MEASUREMENT.
 * At 88 striae a drift of 0.022 turns/s carries one stria past a fixed azimuth
 * every 0.52 s — a rate a viewer could read. But the grain prefilters to
 * nothing past roughly 25 wu (see `uAa`), so any rate written here is legible
 * only in close-up, which is why the shipped form leaves share out of both
 * aperture programs entirely.
 */
export const COHORT_FACE_DRIFT = 0.022;

/**
 * ONE broad inward swell, and never crests: structure ACROSS the flow reads as
 * the layers of an object, which is the reading this form exists to avoid.
 */
export const COHORT_FACE_SWELL = 0.16;

/** How fast that one swell runs inward, in turns per second. */
export const COHORT_FACE_SWELL_RATE = 0.4;

/**
 * Prefilter strength for the grain, against its own screen footprint.
 *
 * ⭐ IT IS WHAT MAKES THE GRAIN A ZOOM-IN DETAIL RATHER THAN SCENE-SCALE NOISE.
 * 88 striae across a 6 wu mark alias into moiré the moment the mark is small on
 * screen; `dFdx`/`dFdy` give the footprint of one plane unit, and the grain is
 * damped by `exp(-0.16 * dph²)` as that footprint approaches a stria's width.
 * Past roughly 25 wu it prefilters to nothing and the face is a smooth ring.
 */
export const COHORT_FACE_AA = 1;

/** The face's own amplitude, before the knee. */
export const COHORT_FACE_AMP = 1;

/**
 * Half-extent of the face's quad, in world units.
 *
 * The face is a disc of radius `apR` lying in the plane, and the quad is a
 * SQUARE in that same plane, so it needs no margin at all: a square of
 * half-extent `apR` strictly contains the disc, and the 21.5 % of its area
 * outside discards on the first line of the fragment.
 *
 * ⚠️ IT IS A FUNCTION AND THE LAYER HAS TO KEEP IT ONE, exactly as
 * `cohortIntakeHalfExtent` is. If a knob drives `uApR` while `uHalf` stays,
 * the face crops against its own quad — the ray clip inside stays exact, but
 * the pixels carrying the rim are never rasterised to run it.
 */
export function cohortFaceHalfExtent(apR: number): number {
  return apR;
}

/** The same extent at the shipped radius: 3 world units. */
export const COHORT_FACE_HALF = cohortFaceHalfExtent(COHORT_AP_R);

/* ------------------------------------------------------------------ the aura */

/** The aura's own amplitude, before the knee. */
export const COHORT_AURA_AMP = 1;

/** Fall-off exponent of the halo, from the mark's centre outward. */
export const COHORT_AURA_HALO_EXP = 1.7;

/** Halo radius, as a multiple of `COHORT_AP_R` — 4.05 wu at the shipped size. */
export const COHORT_AURA_HALO_R = 1.35;

/**
 * How far the halo is weighted DOWNWARD in world Y.
 *
 * ⭐ THE ONLY CUE FOR "THE ENERGY IS UNDER THE PLANE" THAT COSTS NO SILHOUETTE.
 * It is a gradient inside a glow that is already there, so there is no cone, no
 * stub and nothing that can read as a beam, and it vanishes on its own from
 * overhead — where "below" is not a direction a viewer can see.
 */
export const COHORT_AURA_HALO_BIAS = 0.3;

/** How fast that bias falls off upward, in units of the halo radius. */
export const COHORT_AURA_HALO_BIAS_K = 0.55;

/**
 * The halo's own hole, in units of the aperture's pupil.
 *
 * ⭐⭐⭐ THE HALO HAS THE SAME HOLE, AND ONE TEST RESOLVES A CONFLICT THAT
 * OTHERWISE HAS NO ANSWER. A halo strong enough to stop the mark collapsing
 * into a dash at 12° of elevation also floods the pupil at 30° and kills the
 * one cue the whole form rests on. Cutting it with the aperture's own pupil
 * settles it EXACTLY, because the cut is computed by crossing the view ray with
 * the colony plane: from above, the ray lands inside the pupil and the halo is
 * cut, so the mark is a ring; at grazing incidence almost no ray lands in the
 * pupil at all, so the halo fills in and the mark stays a blob. The hole is
 * therefore never restated — it is the same disc, in the same plane, about the
 * same centre, read through a different ray.
 */
export const COHORT_AURA_PUPIL_SCALE = 1.35;

/** How far the halo tips toward cold white. Far less than the rim: the halo is
 *  support, and a white halo would compete with the structure it supports. */
export const COHORT_AURA_HOT_MIX = 0.1;

/**
 * The aura's soft knee — and the one number on this layer that is NOT the lab's.
 *
 * ⚠️⚠️⚠️ TWO ADDITIVE DRAWS OF ONE MARK SHARE A CEILING, AND NEITHER CAN SEE IT.
 * Additive blending takes source alpha as its factor, so each draw contributes
 * `uColor * shape²`, and blue is EXACTLY 1.0 in both `scaffold` and `coldWhite`
 * — so the blue a pixel receives is exactly `shapeFace² + shapeAura²`. The lab
 * kneed both faces at `COHORT_CLIP_KNEE` because it measured them one at a
 * time. Swept together over 700 cameras, their SUM reaches **1.067** in blue at
 * every distance from 8 to 300 wu: at low elevation the rim's near and far arcs
 * fold onto the halo's own peak, and the mark's brightest ring clips to flat
 * white-cyan with its structure gone. That is the failure that has already cost
 * this feature a full live leg.
 *
 * ⭐ SO THE TWO KNEES ARE A PYTHAGOREAN PAIR: `sqrt(1 - COHORT_CLIP_KNEE²)`.
 * Since `k * (1 - exp(-s / k)) < k` strictly for every finite input, the two
 * shapes lie STRICTLY inside the unit circle, so `shapeFace² + shapeAura² < 1`
 * at every pixel, every camera, every time and every knob setting. The ceiling
 * is arithmetic rather than a swept observation, which is what a ceiling this
 * expensive should be. Measured, it lands at 0.850 in blue.
 *
 * ⭐ THE FACE KEEPS `COHORT_CLIP_KNEE` UNTOUCHED, so the whole correction is
 * taken out of the halo and none of it out of the mark's structure. What that
 * costs is measured and small: the halo's peak drops, but the LIT AREA it
 * contributes at low elevation — the job it is actually here for — falls only
 * from 421 to 383 wu², 91 % of the lab's. A knee, never a scale.
 */
export const COHORT_AURA_KNEE = Math.sqrt(1 - COHORT_CLIP_KNEE ** 2);

/**
 * Half-extent of the aura's camera-facing quad, in world units.
 *
 * ⭐ THE 1.06 IS A PERSPECTIVE MARGIN AND NOT A GUESS. The halo is measured by
 * the PERPENDICULAR DISTANCE FROM THE VIEW RAY to the cohort, and for a camera
 * `D` from the mark a fragment sitting `d` out on the quad has a ray that
 * passes at `d / sqrt(1 + d²/D²)` — strictly LESS than `d`. So a quad of
 * half-extent exactly `haloR` leaves the halo's outer edge off its own quad.
 * The margin needed is `1 / sqrt(1 - (haloR/D)²)`, which is 1.062 at `D` = 12
 * wu — nearer than the orbit reaches. Beyond 12.2 wu the margin is slack.
 *
 * ⚠️ A FUNCTION FOR THE SAME REASON `cohortIntakeHalfExtent` IS ONE: `uApR` and
 * `uHaloR` are both live knobs, and a quad left behind crops the halo it
 * carries.
 */
export function cohortAuraHalfExtent(apR: number, haloR: number): number {
  return apR * haloR * 1.06;
}

/** The same extent at the shipped radius and halo: 4.293 world units. */
export const COHORT_AURA_HALF = cohortAuraHalfExtent(
  COHORT_AP_R,
  COHORT_AURA_HALO_R,
);

/**
 * One cohort's face, as an instanced disc lying in the colony plane.
 *
 * ⚠️ THE GEOMETRY MUST BE `PlaneGeometry(1, 1)` — the SAME shared unit plane
 * the other draws in this layer take. The vertex shader lays it into the
 * instance's own XZ and scales it by the `uHalf` UNIFORM, so `mesh.scale` and a
 * scaled instance matrix are both irrelevant, exactly as they are for the two
 * billboards above. Two triangles are enough: the disc is flat, and the lab's
 * 64x6 ring existed only to demonstrate a bowl that was rejected at every
 * amplitude tested.
 *
 * ⭐ NO MATRIX AND NO ORIENTATION LANE. The plane's normal is world Y, which is
 * the colony's rotation axis, so laying the quad into local XZ and letting
 * `modelMatrix * instanceMatrix` carry it is all the orientation this mark ever
 * has. Rotation about Y maps that local plane onto the colony plane and
 * preserves lengths inside it, which is why `length(vP)` here and the aura's
 * ray/plane crossing measure the same radius about the same centre.
 *
 * ⚠️ THAT TIE ASSUMES THE INSTANCE MATRIX CARRIES NO SCALE. `ColonyCohorts`
 * builds it with `makeTranslation`; a scaled instance would move the face's
 * radius without moving the aura's, and the one hole would become two.
 *
 * `aSeed` is the same per-instance lane the other faces read. There is NO
 * `aShare` lane: share means rate on this layer, and neither aperture program
 * has a rate share could drive that survives the grain's own prefilter.
 */
export function makeCohortFaceMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthTest: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    // The disc lies IN the plane, so it is seen from below as often as from
    // above. It is the only draw in this layer that needs both faces.
    side: THREE.DoubleSide,
    uniforms: {
      uColor: {
        value: new THREE.Color().setRGB(...PEER_NETWORK_PALETTE.scaffold),
      },
      uHot: {
        value: new THREE.Color().setRGB(...PEER_NETWORK_PALETTE.coldWhite),
      },
      uTime: { value: 0 },
      uContextEnergy: { value: 1 },
      uHalf: { value: COHORT_FACE_HALF },
      uApR: { value: COHORT_AP_R },
      uRimFrac: { value: COHORT_AP_RIM_FRAC },
      uPupilFrac: { value: COHORT_AP_PUPIL_FRAC },
      uPupilSoft: { value: COHORT_FACE_PUPIL_SOFT },
      uRimW: { value: COHORT_FACE_RIM_W },
      uRimAmp: { value: COHORT_FACE_RIM_AMP },
      uHotMix: { value: COHORT_FACE_HOT_MIX },
      uInAmp: { value: COHORT_FACE_INTAKE_AMP },
      uInGamma: { value: COHORT_FACE_INTAKE_GAMMA },
      uInCore: { value: COHORT_FACE_INTAKE_CORE },
      uStriae: { value: COHORT_FACE_STRIAE },
      uStriaAmp: { value: COHORT_FACE_STRIA_AMP },
      uStriaLift: { value: COHORT_FACE_STRIA_LIFT },
      uStriaR0: { value: COHORT_FACE_STRIA_R0 },
      uStriaR1: { value: COHORT_FACE_STRIA_R1 },
      uStriaW: { value: COHORT_FACE_STRIA_W },
      uDrift: { value: COHORT_FACE_DRIFT },
      uSwell: { value: COHORT_FACE_SWELL },
      uSwellRate: { value: COHORT_FACE_SWELL_RATE },
      uAa: { value: COHORT_FACE_AA },
      uAmp: { value: COHORT_FACE_AMP },
      uKnee: { value: COHORT_CLIP_KNEE },
      uBreatheDepth: { value: COHORT_AP_BREATHE_DEPTH },
      uBreatheHz: { value: COHORT_BREATHE_HZ },
    },
    vertexShader: /* glsl */ `
      attribute float aSeed;

      uniform float uHalf;

      varying vec2 vP;
      varying vec3 vOrigin;
      varying float vSeed;

      void main() {
        vSeed = aSeed;
        // The instance's own world point, for the proximity exemption. It is
        // the SAME quantity every other face in this layer carries.
        vec4 origin = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        vOrigin = origin.xyz;
        // ⚠️ uHalf IS A UNIFORM AND HAS TO BE — see the factory's comment.
        // The unit plane is laid into the instance's local XZ, which the
        // colony's rotation about world Y keeps parallel to the colony plane.
        vec3 local = vec3(position.x, 0.0, position.y) * uHalf * 2.0;
        // The offset from the cohort's centre, in the plane. A rotation about
        // Y preserves its length, so this is the same radius the aura reads
        // off its ray/plane crossing.
        vP = local.xz;
        vec4 world = modelMatrix * instanceMatrix * vec4(local, 1.0);
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;

      uniform vec3 uColor;
      uniform vec3 uHot;
      uniform float uTime;
      uniform float uContextEnergy;
      uniform float uApR;
      uniform float uRimFrac;
      uniform float uPupilFrac;
      uniform float uPupilSoft;
      uniform float uRimW;
      uniform float uRimAmp;
      uniform float uHotMix;
      uniform float uInAmp;
      uniform float uInGamma;
      uniform float uInCore;
      uniform float uStriae;
      uniform float uStriaAmp;
      uniform float uStriaLift;
      uniform float uStriaR0;
      uniform float uStriaR1;
      uniform float uStriaW;
      uniform float uDrift;
      uniform float uSwell;
      uniform float uSwellRate;
      uniform float uAa;
      uniform float uAmp;
      uniform float uKnee;
      uniform float uBreatheDepth;
      uniform float uBreatheHz;

      varying vec2 vP;
      varying vec3 vOrigin;
      varying float vSeed;

      const float TAU = 6.28318530718;

      float sq(float x) { return x * x; }

      void main() {
        float r = length(vP);
        // The quad is a square and the mark is a disc: 21.5 % of the
        // fragments are corner and leave here.
        if (r > uApR) discard;

        float rimR = max(uApR * uRimFrac, 0.02);
        float rho = r / rimR;
        float pup = max(uPupilFrac, 0.02);

        // ⭐⭐⭐ THE PUPIL, AND IT REACHES EXACTLY ZERO. It is an absence of
        // light and never a drawn dark disc — the same additive idiom the
        // centre's refusal uses. ⚠️ The clamp keeps edge0 strictly below
        // edge1: at uPupilSoft = 0 the two edges would be equal, and
        // smoothstep with edge0 >= edge1 is UNDEFINED in GLSL ES and has
        // rendered nothing at all on this project's own driver once already.
        float pupil = smoothstep(
          pup * (1.0 - clamp(uPupilSoft, 0.02, 0.98)),
          pup,
          rho
        );
        float rim = exp(-sq((rho - 1.0) / max(uRimW, 0.02)));

        // The intake skirt, from the rim out to the mark's edge.
        float outer = max(uApR / rimR, 1.2);
        float uu = clamp((rho - 1.0) / (outer - 1.0), 0.0, 1.0);
        float skirt = pow(1.0 - uu, max(uInGamma, 0.2));
        float fill = uInCore * exp(-sq((rho - 1.0) / 0.85));

        // ---- the grain: a modulation of the SAME light, running radially
        // inward. A continuous cosine in azimuth, never beads and never
        // particles.
        float th = atan(vP.y, vP.x);
        float ph = uStriae * th + (uTime * uDrift + vSeed) * TAU;
        // Prefiltered against its own screen footprint, so the grain is a
        // zoom-in detail and never scene-scale noise.
        vec2 footX = dFdx(vP);
        vec2 footY = dFdy(vP);
        float foot = max(length(footX), length(footY));
        float dph = uStriae * foot / max(r, 1e-3);
        float pre = mix(1.0, exp(-0.16 * dph * dph), clamp(uAa, 0.0, 1.0));
        // A bell envelope, so the grain is gone before the outer boundary.
        float striaW = max(uStriaW, 0.02);
        float striaAmt = uStriaAmp
          * smoothstep(uStriaR0, uStriaR0 + striaW, uu)
          * (1.0 - smoothstep(uStriaR1, uStriaR1 + striaW, uu));
        // ⭐⭐⭐ SUBTRACTIVE. With uStriaLift at 1 this lies in [1 - amt, 1],
        // so a stria can only ever REMOVE light and the outer iso-brightness
        // contour stays exactly where the smooth halo put it. An additive or
        // mean-preserving modulation pushes that contour outward under every
        // stria, and the mark reads as a sunflower.
        float stria = 1.0
          + striaAmt * pre * ((0.5 + 0.5 * cos(ph)) - uStriaLift);

        // ONE broad inward swell. Never crests: structure ACROSS the flow
        // reads as the layers of an object.
        float swell = 1.0
          + uSwell * cos(uu * 1.10 * TAU + (uTime * uSwellRate + vSeed) * TAU);

        float intake = uInAmp * (skirt + fill) * swell * stria;

        float breathe = 1.0 - uBreatheDepth
          + uBreatheDepth * sin(uTime * uBreatheHz + vSeed * TAU);
        float shape = (rim * uRimAmp + intake) * pupil * uAmp * breathe;
        if (shape < 0.0018) discard;
        // ⭐ A KNEE AND NEVER A SCALE. See COHORT_AURA_KNEE for why the aura's
        // is the Pythagorean partner of this one.
        shape = uKnee * (1.0 - exp(-shape / uKnee));
        ${COHORT_CONTEXT_ENERGY_GLSL}
        vec3 tint = mix(uColor, uHot, uHotMix * rim * pupil);
        // Energy multiplies RGB and NEVER alpha — the house idiom that keeps
        // additive damping linear.
        gl_FragColor = vec4(tint * shape * cohortEnergy, shape);
      }
    `,
  });
}

/**
 * One cohort's aura, as an instanced camera-facing billboard.
 *
 * ⭐ IT DOES THE ONE THING A PLANE-LYING QUAD CANNOT: keep the mark's AREA when
 * the plane is seen edge-on. Below roughly 15° of elevation the face collapses
 * to a bright horizontal sliver and is then indistinguishable from a peer link;
 * the halo is view-independent, so the mark stays a blob at every elevation.
 *
 * ⭐⭐⭐ AND IT CARRIES THE SAME HOLE, cut by crossing the view ray with the
 * colony plane rather than by restating the face's pupil. From above, a ray
 * through the middle of the mark lands inside the pupil and the halo is cut, so
 * the mark reads as a ring; at grazing incidence almost no ray lands in the
 * pupil, so the halo fills in and the mark stays solid. One test, and the mark
 * does the right thing at every elevation.
 *
 * ⚠️ THE GEOMETRY MUST BE `PlaneGeometry(1, 1)`, for the reason its two
 * billboard neighbours above give: the quad is rebuilt from raw `position` and
 * the view matrix's camera axes, which no model matrix ever touches, so the
 * extent has to ride the `uHalf` UNIFORM.
 *
 * ⛔ NOTHING IS DRAWN ABOVE THE COLONY PLANE and nothing is marched below it.
 * The lab carried a short converging medium under the slab behind a switch; it
 * was measured invisible except from directly overhead and is not in this file.
 *
 * `aSeed` is the same per-instance lane the face reads, and there is no
 * `aShare` lane — see `makeCohortFaceMaterial`.
 */
export function makeCohortAuraMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthTest: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    uniforms: {
      uColor: {
        value: new THREE.Color().setRGB(...PEER_NETWORK_PALETTE.scaffold),
      },
      uHot: {
        value: new THREE.Color().setRGB(...PEER_NETWORK_PALETTE.coldWhite),
      },
      uTime: { value: 0 },
      uContextEnergy: { value: 1 },
      uHalf: { value: COHORT_AURA_HALF },
      uApR: { value: COHORT_AP_R },
      uRimFrac: { value: COHORT_AP_RIM_FRAC },
      uPupilFrac: { value: COHORT_AP_PUPIL_FRAC },
      uHaloExp: { value: COHORT_AURA_HALO_EXP },
      uHaloR: { value: COHORT_AURA_HALO_R },
      uHaloBias: { value: COHORT_AURA_HALO_BIAS },
      uHaloBiasK: { value: COHORT_AURA_HALO_BIAS_K },
      uHaloPupil: { value: COHORT_AURA_PUPIL_SCALE },
      uHotMix: { value: COHORT_AURA_HOT_MIX },
      uAmp: { value: COHORT_AURA_AMP },
      uKnee: { value: COHORT_AURA_KNEE },
      uBreatheDepth: { value: COHORT_AP_BREATHE_DEPTH },
      uBreatheHz: { value: COHORT_BREATHE_HZ },
    },
    vertexShader: /* glsl */ `
      attribute float aSeed;

      uniform float uHalf;

      varying vec3 vWorld;
      varying vec3 vOrigin;
      varying float vSeed;

      void main() {
        vSeed = aSeed;
        vec4 origin = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        vOrigin = origin.xyz;
        vec3 cameraRight = vec3(
          viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]
        );
        vec3 cameraUp = vec3(
          viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]
        );
        // ⚠️ uHalf IS A UNIFORM AND HAS TO BE — see the factory's comment.
        vWorld = origin.xyz
          + (cameraRight * position.x + cameraUp * position.y) * uHalf * 2.0;
        gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;

      uniform vec3 uColor;
      uniform vec3 uHot;
      uniform float uTime;
      uniform float uContextEnergy;
      uniform float uApR;
      uniform float uRimFrac;
      uniform float uPupilFrac;
      uniform float uHaloExp;
      uniform float uHaloR;
      uniform float uHaloBias;
      uniform float uHaloBiasK;
      uniform float uHaloPupil;
      uniform float uHotMix;
      uniform float uAmp;
      uniform float uKnee;
      uniform float uBreatheDepth;
      uniform float uBreatheHz;

      varying vec3 vWorld;
      varying vec3 vOrigin;
      varying float vSeed;

      const float TAU = 6.28318530718;

      void main() {
        vec3 ro = cameraPosition;
        vec3 rd = normalize(vWorld - ro);

        // ---- the halo, measured from the COHORT and not from the quad, so it
        // stays concentric with the aperture however the billboard is turned.
        vec3 oc = vOrigin - ro;
        float tc = dot(oc, rd);
        float perp = length(oc - rd * tc);
        float hR = max(uApR * uHaloR, 0.05);
        if (perp > hR) discard;
        float hx = clamp(perp / hR, 0.0, 1.0);
        float halo = pow(1.0 - hx, max(uHaloExp, 0.2));

        // ⭐⭐⭐ THE SAME HOLE, CUT BY THE RAY/PLANE CROSSING. The radius below
        // is the aperture's own pupil scaled once, and the distance it is
        // compared against is measured in the colony plane about the cohort's
        // own centre — which is the very quantity the face calls length(vP).
        // The two holes are therefore one hole seen through two rays, and
        // there is no second radius anywhere for them to drift apart on.
        float rimR = max(uApR * uRimFrac, 0.02);
        float pupR = rimR * max(uPupilFrac, 0.05) * max(uHaloPupil, 0.1);
        if (abs(rd.y) > 1e-5) {
          float tp = (vOrigin.y - ro.y) / rd.y;
          if (tp > 0.0) {
            float planeR = length((ro + rd * tp).xz - vOrigin.xz);
            halo *= smoothstep(pupR * 0.45, pupR, planeR);
          }
        }

        // Weighted downward in world Y: a gradient inside a glow that is
        // already there, so it adds no silhouette and cannot read as a beam.
        float dy = vWorld.y - vOrigin.y;
        halo *= 1.0 - uHaloBias * smoothstep(
          -hR * uHaloBiasK * 0.35,
          hR * max(uHaloBiasK, 0.05),
          dy
        );

        float breathe = 1.0 - uBreatheDepth
          + uBreatheDepth * sin(uTime * uBreatheHz + vSeed * TAU);
        float shape = halo * uAmp * breathe;
        if (shape < 0.0018) discard;
        // ⭐ The Pythagorean partner of the face's knee, so the two draws sum
        // strictly inside the unit circle. See COHORT_AURA_KNEE.
        shape = uKnee * (1.0 - exp(-shape / uKnee));
        ${COHORT_CONTEXT_ENERGY_GLSL}
        vec3 tint = mix(uColor, uHot, uHotMix);
        gl_FragColor = vec4(tint * shape * cohortEnergy, shape);
      }
    `,
  });
}
