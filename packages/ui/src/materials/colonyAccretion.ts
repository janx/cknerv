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
