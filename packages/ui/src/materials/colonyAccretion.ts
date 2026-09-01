import * as THREE from 'three';
import { PEER_NETWORK_PALETTE } from '../visualPalette';

/**
 * A mining cohort is rendered as an accreting void, not as another peer stop.
 *
 * The previous single additive pass could only leave the centre unlit. That
 * works against an empty background, but a colony edge behind the billboard
 * still shone straight through it, turning the silhouette back into a cyan
 * ring. The new mark therefore has two deliberately different passes:
 *
 *  1. a normal-blended optical depression that softly removes light from the
 *     scene without stamping a flat black disc over the mesh;
 *  2. an additive phenomenon around it: a cyan-white photon ring, a flattened
 *     asymmetric accretion disc, lensed polar arcs, a disturbed energy field,
 *     and continuous gas collapsing through that field into the aperture.
 *
 * The aperture stays semantically distinct, but its resting visual grammar is
 * the peer mesh's own: the same soft halo exponent and amplitude, the same
 * 1.2-radian breathing cadence, and the same scaffold cyan. Cold white is only
 * mixed into the photon crest rather than worn as a permanent event signal.
 *
 * It remains continuous idle behaviour. It takes no block pulse, flood, or
 * shockwave; the colony's existing outward surge already identifies the cohort
 * that produced a block. A cohort's recent share changes only the speed of the
 * infall, never the size or brightness of its mark.
 */

/** Radius of the central optical depression in world units. */
export const COHORT_HORIZON_R = 0.25;

/** Inner endpoint of the gas coordinate, safely inside the gravity depression. */
export const COHORT_THROAT_R = COHORT_HORIZON_R * 0.48;

/** Major radius of the projected accretion disc. */
export const COHORT_RIM_R = 1.15;

/** Gaussian half-width of the accretion disc. */
export const COHORT_RIM_SIGMA = 0.32;

/** Gaussian half-width of the white photon ring around the aperture. */
export const COHORT_PHOTON_SIGMA = 0.21;

/** Vertical compression that makes the disc read as a tilted plane. */
export const COHORT_DISC_FLATTEN = 0.38;

/** Peak additive brightness of the disc. */
export const COHORT_RIM_AMP = 1.45;

/** Outer radius at which the gaseous inflow condenses out of the void. */
export const COHORT_GAS_BIRTH_R = 3.35;

/** Peak additive density of the gaseous inflow. */
export const COHORT_GAS_AMP = 0.72;

/** Peak additive brightness of the turbulent field displaced by the sink. */
export const COHORT_FIELD_AMP = 0.38;

/** Outer billboard extent, including the whole gaseous inflow. */
export const COHORT_MARK_HALF_EXTENT = 3.7;

/** The normal-blended pass only covers the depression and its immediate well. */
export const COHORT_SHADOW_HALF_EXTENT = COHORT_HORIZON_R * 2;

/** Gas-advection rate for a cohort holding the whole producer window. */
export const COHORT_INFALL_HZ = 0.4;

/** A cohort with a small share still accretes; share changes rate, not state. */
export const COHORT_INFALL_FLOOR = 0.32;

/** Above one stretches the gas inward, expressing gravitational acceleration. */
export const COHORT_INFALL_EASE = 2.45;

/** Slow rotation of brightness structure within the standing disc. */
export const COHORT_RIM_SPIN_HZ = 0.035;

/** Strength of the peer-style cyan halo that seats the aperture in the mesh. */
export const COHORT_MESH_HALO_AMP = 0.62;

/** Cold-white share of the photon crest; the balance remains scaffold cyan. */
export const COHORT_PHOTON_WHITE_MIX = 0.62;

/** POW cohorts breathe on the measured-peer cadence, but with less contrast. */
export const COHORT_BREATHE_HZ = 1.2;
export const COHORT_BREATHE_DEPTH = 0.1;

/** Keeps the light-removing centre a deep cyan member of the peer palette. */
export const COHORT_VOID_TINT = 0.024;

/** The gravity depression and disc are one selectable mark. */
export const COHORT_HIT_RADIUS = COHORT_RIM_R;

const BILLBOARD_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec4 origin = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    vec3 cameraRight = vec3(
      viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]
    );
    vec3 cameraUp = vec3(
      viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]
    );
    vec3 world = origin.xyz
      + cameraRight * position.x
      + cameraUp * position.y;
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`;

/**
 * The light-removing half of the mark.
 *
 * Normal blending is essential: additive black is mathematically a no-op.
 * The tiny centre is optically deep while a very short outer well darkens
 * clutter that would otherwise visually bridge across the throat. `depthWrite`
 * remains off so the billboard does not become an invisible rectangular
 * occluder.
 */
export function makeColonyHorizonMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthTest: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    toneMapped: false,
    uniforms: {
      uVoidColor: {
        value: new THREE.Color().setRGB(
          PEER_NETWORK_PALETTE.scaffold[0] * COHORT_VOID_TINT,
          PEER_NETWORK_PALETTE.scaffold[1] * COHORT_VOID_TINT,
          PEER_NETWORK_PALETTE.scaffold[2] * COHORT_VOID_TINT,
        ),
      },
      uContextEnergy: { value: 1 },
      uHalf: { value: COHORT_SHADOW_HALF_EXTENT },
      uHorizon: { value: COHORT_HORIZON_R },
    },
    vertexShader: BILLBOARD_VERTEX_SHADER,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform vec3 uVoidColor;
      uniform float uContextEnergy;
      uniform float uHalf;
      uniform float uHorizon;
      varying vec2 vUv;

      void main() {
        vec2 p = (vUv - 0.5) * 2.0;
        float rw = length(p) * uHalf;
        float outer = uHorizon * 1.42;
        if (rw > outer) discard;

        // No opaque plateau and no hard circular cut-out: the centre is a
        // graded optical depth whose last few percent feather into the mesh.
        float sink = 1.0 - smoothstep(0.0, uHorizon * 0.98, rw);
        float core = pow(max(sink, 0.0), 0.82);
        float pupil = exp(-pow(
          rw / max(uHorizon * 0.36, 0.001),
          2.0
        ));
        float well = 1.0 - smoothstep(uHorizon * 0.72, outer, rw);
        float alpha = (
          core * 0.70
          + pupil * 0.12
          + (1.0 - core) * well * 0.08
        ) * uContextEnergy;
        if (alpha < 0.002) discard;
        gl_FragColor = vec4(uVoidColor, alpha);
      }
    `,
  });
}

/**
 * The luminous half of the mark. Every cohort is one instance of one quad;
 * all motion is evaluated from simulation time in the shader. `aSeed` changes
 * only when the cohort set moves, while `aShare` is updated in place whenever
 * the producer window changes.
 */
export function makeColonyAccretionMaterial(): THREE.ShaderMaterial {
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
      uHotColor: {
        value: new THREE.Color().setRGB(...PEER_NETWORK_PALETTE.coldWhite),
      },
      uTime: { value: 0 },
      uContextEnergy: { value: 1 },
      uHalf: { value: COHORT_MARK_HALF_EXTENT },
      uHorizon: { value: COHORT_HORIZON_R },
      uThroat: { value: COHORT_THROAT_R },
      uRim: { value: COHORT_RIM_R },
      uRimSigma: { value: COHORT_RIM_SIGMA },
      uPhotonSigma: { value: COHORT_PHOTON_SIGMA },
      uDiscFlatten: { value: COHORT_DISC_FLATTEN },
      uBirth: { value: COHORT_GAS_BIRTH_R },
      uEase: { value: COHORT_INFALL_EASE },
      uInfallFloor: { value: COHORT_INFALL_FLOOR },
      uMeshHaloAmp: { value: COHORT_MESH_HALO_AMP },
      uPhotonWhiteMix: { value: COHORT_PHOTON_WHITE_MIX },
      uBreatheHz: { value: COHORT_BREATHE_HZ },
      uBreatheDepth: { value: COHORT_BREATHE_DEPTH },
      uRimAmp: { value: COHORT_RIM_AMP },
      uGasAmp: { value: COHORT_GAS_AMP },
      uFieldAmp: { value: COHORT_FIELD_AMP },
      uInfall: { value: COHORT_INFALL_HZ },
      uSpin: { value: COHORT_RIM_SPIN_HZ },
    },
    vertexShader: /* glsl */ `
      attribute float aShare;
      attribute float aSeed;
      varying vec2 vUv;
      varying float vShare;
      varying float vSeed;
      void main() {
        vUv = uv;
        vShare = aShare;
        vSeed = aSeed;
        vec4 origin = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        vec3 cameraRight = vec3(
          viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]
        );
        vec3 cameraUp = vec3(
          viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]
        );
        vec3 world = origin.xyz
          + cameraRight * position.x
          + cameraUp * position.y;
        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform vec3 uColor;
      uniform vec3 uHotColor;
      uniform float uTime;
      uniform float uContextEnergy;
      uniform float uHalf;
      uniform float uHorizon;
      uniform float uThroat;
      uniform float uRim;
      uniform float uRimSigma;
      uniform float uPhotonSigma;
      uniform float uDiscFlatten;
      uniform float uRimAmp;
      uniform float uBirth;
      uniform float uGasAmp;
      uniform float uFieldAmp;
      uniform float uEase;
      uniform float uInfall;
      uniform float uInfallFloor;
      uniform float uSpin;
      uniform float uMeshHaloAmp;
      uniform float uPhotonWhiteMix;
      uniform float uBreatheHz;
      uniform float uBreatheDepth;
      varying vec2 vUv;
      varying float vShare;
      varying float vSeed;

      const float TAU = 6.28318530718;

      float gaussian(float distanceToCentre, float sigma) {
        float d = distanceToCentre / max(sigma, 0.002);
        return exp(-d * d);
      }

      float hash31(vec3 p) {
        p = fract(p * 0.1031);
        p += dot(p, p.yzx + 33.33);
        return fract((p.x + p.y) * p.z);
      }

      float valueNoise3(vec3 p) {
        vec3 cell = floor(p);
        vec3 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);

        float n000 = hash31(cell + vec3(0.0, 0.0, 0.0));
        float n100 = hash31(cell + vec3(1.0, 0.0, 0.0));
        float n010 = hash31(cell + vec3(0.0, 1.0, 0.0));
        float n110 = hash31(cell + vec3(1.0, 1.0, 0.0));
        float n001 = hash31(cell + vec3(0.0, 0.0, 1.0));
        float n101 = hash31(cell + vec3(1.0, 0.0, 1.0));
        float n011 = hash31(cell + vec3(0.0, 1.0, 1.0));
        float n111 = hash31(cell + vec3(1.0, 1.0, 1.0));

        float x00 = mix(n000, n100, f.x);
        float x10 = mix(n010, n110, f.x);
        float x01 = mix(n001, n101, f.x);
        float x11 = mix(n011, n111, f.x);
        return mix(
          mix(x00, x10, f.y),
          mix(x01, x11, f.y),
          f.z
        );
      }

      float fbm3(vec3 p) {
        float density = valueNoise3(p) * 0.57;
        p = p * 2.03 + vec3(17.1, 9.2, 13.7);
        density += valueNoise3(p) * 0.30;
        p = p * 2.01 + vec3(8.3, 19.1, 4.7);
        density += valueNoise3(p) * 0.13;
        return density;
      }

      mat2 rotate2(float angle) {
        float c = cos(angle);
        float s = sin(angle);
        return mat2(c, -s, s, c);
      }

      void main() {
        vec2 p = (vUv - 0.5) * 2.0;
        float rq = length(p);
        if (rq > 1.0) discard;
        vec2 pw = p * uHalf;
        float rw = rq * uHalf;
        // Beyond the gas birth radius every additive term below is zero or
        // a Gaussian tail under 1e-18 — the field and gas windows close
        // EXACTLY at uBirth, the mesh halo at 1.9 uRim, and the rim, photon
        // and lens Gaussians sit 6.5, 14 and 17 sigma out — so the closing
        // amp < 0.002 test discarded this annulus (18 % of the quad's area)
        // after running the whole body. Same pixels, without the body; the
        // bound is pinned in materials/colonyAccretion.test.ts.
        if (rw > uBirth) discard;

        // Share has one visual meaning: how quickly this aperture consumes.
        float rate = uInfall * mix(
          uInfallFloor,
          1.0,
          clamp(vShare, 0.0, 1.0)
        );
        float throat = max(uThroat, 0.02);

        // Each disc has a stable shallow screen-space tilt. Its silhouette is
        // fixed; only the hot structure within it turns.
        float orientation = (vSeed - 0.5) * 0.72;
        vec2 discP = rotate2(orientation) * pw;
        vec2 discQ = vec2(discP.x, discP.y / max(uDiscFlatten, 0.08));
        float discRadius = length(discQ);
        float discAngle = atan(discQ.y, discQ.x)
          + vSeed * TAU
          - uTime * uSpin * TAU;
        float rimRadius = uRim * (
          1.0
          + 0.065 * sin(discAngle * 3.0 + 0.8)
          + 0.035 * sin(discAngle * 5.0 - 1.7)
        );
        float discBand = gaussian(discRadius - rimRadius, uRimSigma);
        float approaching = pow(
          0.5 + 0.5 * cos(discAngle - 0.38),
          2.4
        );
        float rim = discBand * (0.34 + 1.02 * approaching) * uRimAmp;

        // A broad photon collar and two lensed caps make the deliberately tiny
        // throat read as a gravity well rather than a black dot. Most of the
        // central mark is luminous boundary now, not event-horizon area.
        float photon = gaussian(
          rw - uHorizon * 1.28,
          uPhotonSigma
        ) * (0.82 + 0.18 * cos(discAngle * 2.0)) * uRimAmp;
        float polar = pow(
          clamp(abs(discP.y) / max(rw, 0.001), 0.0, 1.0),
          4.0
        );
        float lens = gaussian(
          rw - uHorizon * 1.68,
          uPhotonSigma * 0.82
        ) * polar * uRimAmp * 0.9;

        // The sink first disturbs the ambient energy field. Two unrelated,
        // slowly counter-evolving noise volumes interfere into broken
        // caustics; there is no polar wave, angular lane or repeating curve.
        vec2 fieldP = pw / max(uBirth, 0.01);
        float gasRadial = clamp(
          (rw - throat) / max(uBirth - throat, 0.01),
          0.0,
          1.0
        );
        float fieldClock = uTime * rate * 0.18;
        vec2 seedOffset = vec2(vSeed * 7.3, -vSeed * 5.7);
        float fieldA = fbm3(vec3(
          fieldP * 2.25 + seedOffset,
          fieldClock + vSeed * 9.7
        ));
        vec2 crossedField = rotate2(1.91 + vSeed * 0.7) * fieldP;
        float fieldB = fbm3(vec3(
          crossedField * 2.85 - seedOffset * 0.61,
          -fieldClock * 0.83 + vSeed * 13.1
        ));
        vec2 fieldWarp = vec2(fieldA - 0.5, fieldB - 0.5);
        float fieldRidges = 1.0 - smoothstep(
          0.035,
          0.19,
          abs(fieldA - fieldB)
        );
        float fieldBreakup = smoothstep(0.38, 0.70, max(fieldA, fieldB));
        float fieldWindow = smoothstep(
          uRim * 0.72,
          uRim * 1.18,
          rw
        ) * (1.0 - smoothstep(uBirth * 0.74, uBirth, rw));
        float fieldFlicker = 0.78 + 0.22 * sin(
          uTime * 0.72 + fieldA * 9.0 + fieldB * 7.0
        );
        float disturbance = fieldRidges
          * fieldBreakup
          * fieldWindow
          * fieldFlicker
          * uFieldAmp;

        // Gas is a continuous volume back-traced through that turbulent field.
        // A feature of flowPhase travels toward lower radius as time rises;
        // the non-linear radial map makes it accelerate on approach. Cartesian
        // domain warping breaks the volume into smoke-like billows without
        // ever converting radius into a spiral angle.
        float flowTravel = pow(gasRadial, uEase);
        float flowPhase = flowTravel * 5.2 + uTime * rate * 1.16;
        vec2 gasPlane = fieldP * 3.7
          + fieldWarp * (0.82 + gasRadial * 1.18);
        vec3 gasCoord = vec3(
          gasPlane,
          flowPhase + vSeed * 11.0
        );
        float billow = fbm3(gasCoord);
        float fineGas = valueNoise3(vec3(
          gasPlane * 2.43 + vec2(fieldB, -fieldA),
          flowPhase * 1.37 + vSeed * 17.0
        ));
        float densityShape = billow * 0.78 + fineGas * 0.22;
        float gasBody = smoothstep(0.43, 0.69, densityShape);
        float gasWisps = pow(
          smoothstep(0.54, 0.79, densityShape),
          1.22
        );
        float gasWindow = smoothstep(
          uHorizon * 1.08,
          uHorizon * 1.78,
          rw
        ) * (1.0 - smoothstep(uBirth * 0.78, uBirth, rw));
        float gasGravity = mix(
          0.28,
          1.08,
          pow(1.0 - gasRadial, 0.58)
        );
        float gas = (
          gasBody * 0.48 + gasWisps * 0.52
        ) * gasWindow * gasGravity * uGasAmp;
        float absorptionHeat = gaussian(
          rw - uHorizon * 1.72,
          uPhotonSigma * 1.25
        );
        float gasHeat = gas * (
          pow(1.0 - gasRadial, 1.7) * 0.34
          + absorptionHeat * 0.26
        );

        // Seat the exceptional aperture in the ordinary peer mesh. This is
        // the exact skirt profile used by peerNodeMaterial; unlike the old
        // Gaussian veil it ends near the node instead of tinting the whole
        // infall field as a separate aura.
        float haloR = clamp(rw / max(uRim * 1.9, 0.001), 0.0, 1.0);
        float meshHalo = pow(1.0 - haloR, 1.6) * 0.42 * uMeshHaloAmp;
        float restBreathe = 1.0 - uBreatheDepth * (
          0.5 + 0.5 * sin(uTime * uBreatheHz + vSeed * TAU)
        );
        float horizon = smoothstep(
          uHorizon * 0.92,
          uHorizon * 1.03,
          rw
        );
        float edge = 1.0 - smoothstep(uHalf * 0.9, uHalf, rw);

        float cold = (rim * 0.68
          + lens * 0.58
          + meshHalo) * restBreathe
          + disturbance * 0.74
          + gas;
        float hot = (
          photon * 1.18 + rim * 0.38 + lens * 0.82
        ) * restBreathe + disturbance * 0.12 + gasHeat;
        float amp = (cold + hot) * horizon * edge;
        if (amp < 0.002) discard;

        vec3 photonColor = mix(uColor, uHotColor, uPhotonWhiteMix);
        vec3 light = (
          uColor * cold + photonColor * hot
        ) * horizon * edge;
        // Additive blending uses source alpha as its factor. Keeping context
        // energy in RGB only preserves linear scene-focus damping.
        gl_FragColor = vec4(
          light * uContextEnergy,
          min(amp, 1.0)
        );
      }
    `,
  });
}

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
 * ⚠️ THE MARCHED SUM IS NOT BOUNDED BY 1, and the design note that said it was
 * is simply wrong. `sum += dA * trans` is a LEFT-endpoint quadrature of
 * `∫ e^-s ds`, whose exact value is `1 - trans` and therefore under 1; but the
 * rule over-estimates a decreasing integrand by about `dA²/2` a step, and at
 * 28 steps across a 20-unit reach `dA` reaches ~1.6 near the throat. Measured
 * supremum over a swept ray set at the shipped constants: `sum ≈ 1.51`, rising
 * with `uDensity`. What actually bounds the output is the KNEE below, which is
 * why it is a knee and never a scale — a scale would cost 91 % of the light to
 * buy the same ceiling. The bound is pinned in `materials/cohortIntake.test.ts`.
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
 * ⚠️ NOT `COHORT_THROAT_R`, which is already taken by the accreting void's
 * inner gas coordinate and means something else entirely (0.12 wu against the
 * old horizon). The two coexist until the void is deleted.
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

/** Peak additive amplitude, before the knee. */
export const COHORT_INTAKE_AMP = 0.66;

/** Extinction per unit of density along the ray. */
export const COHORT_INTAKE_DENSITY = 0.95;

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

/** Samples along the clipped chord. The one real perf lever in this layer. */
export const COHORT_INTAKE_STEPS = 28;

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
export const COHORT_INTAKE_HALF_EXTENT = Math.sqrt(
  COHORT_INTAKE_MOUTH * COHORT_INTAKE_MOUTH
    + (COHORT_INTAKE_REACH * 0.5) * (COHORT_INTAKE_REACH * 0.5),
);

/**
 * One cohort's intake, as an instanced raymarched volume.
 *
 * ⚠️ THE GEOMETRY MUST BE `PlaneGeometry(1, 1)`. Unlike the two billboards
 * above it, this quad carries its world extent in the `uHalf` UNIFORM rather
 * than baked into the geometry — because the shader builds the quad from raw
 * `position` and camera axes, which no model matrix ever touches, so both
 * `mesh.scale` and a scaled instance matrix are silently ignored. A unit plane
 * with the extent baked in would render one world unit across and look like
 * nothing at all. (This cost a full lab round; it hit two materials at once.)
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
          sum += dA * trans;
          trans *= exp(-dA);
          if (trans < 0.004) break;
        }
        float amp = uAmp * sum;
        if (amp < 0.0015) discard;
        // ⭐ A SOFT KNEE, NEVER A SCALE: a scale that bought this ceiling
        // would cost 91 % of the light everywhere the mark was not clipping.
        amp = uKnee * (1.0 - exp(-amp / uKnee));
        // Additive blending uses source alpha as its factor. Keeping context
        // energy in RGB only preserves linear scene-focus damping.
        gl_FragColor = vec4(uColor * amp * uContextEnergy, amp);
      }
    `,
  });
}
