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
 *  1. a normal-blended aperture that actually removes light from the scene;
 *  2. an additive phenomenon around it: a white-hot photon ring, a flattened
 *     asymmetric accretion disc, lensed polar arcs, and matter dragged out of
 *     otherwise empty space along accelerating spiral trajectories.
 *
 * It remains continuous idle behaviour. It takes no block pulse, flood, or
 * shockwave; the colony's existing outward surge already identifies the cohort
 * that produced a block. A cohort's recent share changes only the speed of the
 * infall, never the size or brightness of its mark.
 */

/** Radius of the opaque event horizon in world units. */
export const COHORT_HORIZON_R = 0.96;

/** Final point of an infall, safely inside the event horizon. */
export const COHORT_THROAT_R = COHORT_HORIZON_R * 0.48;

/** Major radius of the projected accretion disc. */
export const COHORT_RIM_R = 1.42;

/** Gaussian half-width of the accretion disc. */
export const COHORT_RIM_SIGMA = 0.25;

/** Vertical compression that makes the disc read as a tilted plane. */
export const COHORT_DISC_FLATTEN = 0.38;

/** Peak additive brightness of the disc. */
export const COHORT_RIM_AMP = 1.45;

/** Mean radius at which matter first becomes visible in the surrounding void. */
export const COHORT_MOTE_BIRTH_R = 4.2;

/** Gaussian half-width of a mote head. */
export const COHORT_MOTE_SIGMA = 0.2;

/** Peak additive brightness of infalling matter. */
export const COHORT_MOTE_AMP = 1.08;

/** Outer billboard extent, including the longest mote tail at birth. */
export const COHORT_MARK_HALF_EXTENT = 5.5;

/** The aperture pass only covers the shadow and its immediate gravity well. */
export const COHORT_SHADOW_HALF_EXTENT = COHORT_HORIZON_R * 1.7;

/** Infall cycles per second for a cohort holding the whole producer window. */
export const COHORT_INFALL_HZ = 0.4;

/** A cohort with a small share still accretes; share changes rate, not state. */
export const COHORT_INFALL_FLOOR = 0.32;

/** Above one means matter accelerates as it approaches the throat. */
export const COHORT_INFALL_EASE = 2.45;

/** Turns added between the outer void and the throat. */
export const COHORT_SWIRL_TURNS = 1.6;

/** Slow rotation of brightness structure within the standing disc. */
export const COHORT_RIM_SPIN_HZ = 0.035;

/** Broad, faint lensing atmosphere that makes the aperture discoverable. */
export const COHORT_VEIL_AMP = 0.15;

/** Number of independently paced pieces of matter around each cohort. */
export const COHORT_MOTES = 18;

/** Number of faint spiral filaments connecting the void to the disc. */
export const COHORT_STREAMS = 4;

/** The event horizon and disc are one selectable mark. */
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
 * The centre is almost opaque while a shallow outer well darkens clutter that
 * would otherwise visually bridge across the horizon. `depthWrite` remains off
 * so the billboard does not become an invisible rectangular occluder.
 */
export function makeColonyHorizonMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthTest: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    toneMapped: false,
    uniforms: {
      uVoidColor: { value: new THREE.Color().setRGB(0.0008, 0.002, 0.006) },
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
        float outer = uHorizon * 1.62;
        if (rw > outer) discard;

        float core = 1.0 - smoothstep(
          uHorizon * 0.88,
          uHorizon * 1.035,
          rw
        );
        float well = 1.0 - smoothstep(uHorizon * 0.92, outer, rw);
        float alpha = (
          core * 0.985
          + (1.0 - core) * well * 0.42
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
      uDiscFlatten: { value: COHORT_DISC_FLATTEN },
      uBirth: { value: COHORT_MOTE_BIRTH_R },
      uMoteSigma: { value: COHORT_MOTE_SIGMA },
      uEase: { value: COHORT_INFALL_EASE },
      uInfallFloor: { value: COHORT_INFALL_FLOOR },
      uVeil: { value: COHORT_VEIL_AMP },
      uRimAmp: { value: COHORT_RIM_AMP },
      uMoteAmp: { value: COHORT_MOTE_AMP },
      uInfall: { value: COHORT_INFALL_HZ },
      uSwirl: { value: COHORT_SWIRL_TURNS },
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
      uniform float uDiscFlatten;
      uniform float uRimAmp;
      uniform float uBirth;
      uniform float uMoteSigma;
      uniform float uMoteAmp;
      uniform float uEase;
      uniform float uInfall;
      uniform float uInfallFloor;
      uniform float uSwirl;
      uniform float uSpin;
      uniform float uVeil;
      varying vec2 vUv;
      varying float vShare;
      varying float vSeed;

      const float TAU = 6.28318530718;
      const int MOTES = ${COHORT_MOTES};
      const int STREAMS = ${COHORT_STREAMS};

      float hash11(float n) {
        return fract(sin(n * 127.1 + 311.7) * 43758.5453123);
      }

      float gaussian(float distanceToCentre, float sigma) {
        float d = distanceToCentre / max(sigma, 0.002);
        return exp(-d * d);
      }

      float angleDistance(float a, float b) {
        return abs(atan(sin(a - b), cos(a - b)));
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

        // Share has one visual meaning: how quickly this aperture consumes.
        float rate = uInfall * mix(
          uInfallFloor,
          1.0,
          clamp(vShare, 0.0, 1.0)
        );
        float throat = max(uThroat, 0.02);
        float span = max(uBirth / throat - 1.0, 0.001);

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

        // A tight photon ring and two lensed caps make the aperture read as a
        // gravity well rather than a flat icon, even before a mote moves.
        float photon = gaussian(
          rw - uHorizon * 1.075,
          uRimSigma * 0.24
        ) * (0.72 + 0.28 * cos(discAngle * 2.0)) * uRimAmp;
        float polar = pow(
          clamp(abs(discP.y) / max(rw, 0.001), 0.0, 1.0),
          4.0
        );
        float lens = gaussian(
          rw - uHorizon * 1.22,
          uRimSigma * 0.42
        ) * polar * uRimAmp * 0.9;

        // Faint filaments are born in unconnected space, not on topology
        // edges. Their spiral tightens toward the disc and advances at the same
        // rate as the motes, so there is one coherent accretion motion.
        float polarAngle = atan(pw.y, pw.x);
        float spiralProgress = (
          uBirth / max(rw, throat) - 1.0
        ) / span;
        float streamWindow = smoothstep(
          uHorizon * 1.05,
          uRim * 1.45,
          rw
        ) * (1.0 - smoothstep(uBirth * 0.86, uBirth * 1.03, rw));
        float streams = 0.0;
        for (int k = 0; k < STREAMS; k++) {
          float fk = float(k);
          float streamSeed = hash11(fk * 13.7 + vSeed * 41.0);
          float targetAngle = streamSeed * TAU
            + uSwirl * TAU * spiralProgress
            - uTime * rate * TAU * (0.07 + 0.035 * streamSeed);
          float width = mix(
            0.07,
            0.14,
            clamp((rw - uRim) / max(uBirth - uRim, 0.01), 0.0, 1.0)
          );
          float distanceToStream = angleDistance(polarAngle, targetAngle) * rw;
          streams += gaussian(distanceToStream, width)
            * (0.48 + 0.52 * streamSeed);
        }
        streams *= streamWindow * 0.16;

        // Independent matter streaks accelerate down the same spiral. The
        // anisotropic tail points back into the void, making direction visible
        // from a still frame instead of relying on brightness modulation.
        float motes = 0.0;
        if (rw < uBirth * 1.05 + uMoteSigma * 5.2) {
          for (int k = 0; k < MOTES; k++) {
            float fk = float(k);
            float birth = uBirth * mix(
              0.82,
              1.05,
              hash11(fk * 2.9 + vSeed * 23.0)
            );
            float pace = 0.68 + 0.64 * hash11(fk * 5.3 + vSeed * 19.0);
            float t = fract(
              uTime * rate * pace
              + hash11(fk + vSeed * 37.0)
            );
            float fall = pow(t, uEase);
            float moteRadius = mix(birth, throat, fall);
            float moteSpan = max(birth / throat - 1.0, 0.001);
            float moteAngle = hash11(
              fk * 1.7 + vSeed * 11.0 + 3.1
            ) * TAU + uSwirl * TAU * (
              birth / max(moteRadius, throat) - 1.0
            ) / moteSpan;
            vec2 centre = vec2(cos(moteAngle), sin(moteAngle)) * moteRadius;
            vec2 radial = centre / max(moteRadius, 0.001);
            vec2 tangent = vec2(-radial.y, radial.x);
            float turning = 0.28 + 0.84 * clamp(
              throat / max(moteRadius, throat),
              0.0,
              1.0
            );
            vec2 flow = normalize(-radial + tangent * turning);
            vec2 trail = -flow;
            vec2 crossAxis = vec2(-trail.y, trail.x);
            vec2 delta = pw - centre;
            float along = dot(delta, trail);
            float across = dot(delta, crossAxis);
            float head = gaussian(length(delta), uMoteSigma * 0.78);
            float tailGate = smoothstep(0.0, uMoteSigma * 0.34, along)
              * (1.0 - smoothstep(
                uMoteSigma * 3.6,
                uMoteSigma * 5.2,
                along
              ));
            float tail = gaussian(across, uMoteSigma * 0.5)
              * exp(-max(along, 0.0) / max(uMoteSigma * 2.8, 0.001))
              * tailGate;
            float born = smoothstep(0.0, 0.12, t);
            float gravity = mix(0.46, 1.0, fall);
            motes += (head + tail * 0.76) * born * gravity;
          }
        }

        float veil = uVeil * exp(
          -(rw * rw) / max(10.0 * uRim * uRim, 0.001)
        );
        float horizon = smoothstep(
          uHorizon * 0.92,
          uHorizon * 1.03,
          rw
        );
        float edge = 1.0 - smoothstep(uHalf * 0.9, uHalf, rw);

        float cold = rim * 0.68
          + lens * 0.58
          + streams
          + motes * uMoteAmp
          + veil;
        float hot = photon * 1.18 + rim * 0.38 + lens * 0.82;
        float amp = (cold + hot) * horizon * edge;
        if (amp < 0.002) discard;

        vec3 light = (uColor * cold + uHotColor * hot) * horizon * edge;
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
