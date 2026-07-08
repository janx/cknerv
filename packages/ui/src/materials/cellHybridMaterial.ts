import * as THREE from 'three';
import { HASH11_GLSL, BIRTH_DEATH_GLSL } from './cellEnvelope.glsl';
import { makeShockwaveUniforms, SHOCKWAVE_SLOTS } from './shockwaveMaterial';

/**
 * Single-peak Gaussian cloud baseline + block shockwave for each cell.
 *
 * - Resting state: one central Gaussian peak anchored at sprite center + a
 *   faint outer halo wash. The cell's brightest pixel always sits at sprite
 *   center (= fabric endpoint at cell.pos_seed), so fiber glow and cell glow
 *   share the same Gaussian language and blend additively at junctions.
 * - The nerve-pulse discharge flare no longer lives here — it renders in a
 *   separate additive layer (materials/cellFlareMaterial.ts) so a pulse never
 *   modulates the cell body's own brightness.
 *
 * The block shockwave is handled here, on the actual cell body. It never
 * creates a separate point beside the cell: the shader uses the anchored cell
 * position, then brightens and expands that same sprite as the wave crosses it.
 */

// Tunable feel constants — collected here so reviewers find them in one place.
const HYBRID_BASE_PX_PER_WU = 2.0; // sprite world→screen multiplier — ~2× halo outer-glow size; cell body (gl_PointCoord ≤ 0.5) renders at roughly halo-equivalent screen weight

export function makeCellHybridMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime:            { value: 0 },
      uBirthDurS:       { value: 0.5 },
      uDeathDurS:       { value: 0.6 },
      uViewportHeight:  { value: 800 },
      ...makeShockwaveUniforms(),
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    vertexShader: /* glsl */ `
      attribute vec3  aColor;
      attribute float aBornAt;
      attribute float aDeathAt;
      attribute float aSize;
      attribute float aDetail;  // LOD: 0 for all far cells (glow unchanged); ramps →1 as the camera nears, softening the white-hot peak so the nucleus shows

      uniform float uTime;
      uniform float uBirthDurS;
      uniform float uDeathDurS;
      uniform float uViewportHeight;
      uniform float uShockwaveAt[${SHOCKWAVE_SLOTS}];
      uniform vec2  uShockwaveOriginXZ[${SHOCKWAVE_SLOTS}];
      uniform float uShockwaveSpeed;
      uniform float uShockwaveDurS;
      uniform float uShockwaveBandBase;
      uniform float uShockwaveBandGrow;
      uniform float uShockwaveSizeBoost;
      uniform float uShockwaveTrailBoost;

      varying vec3  vColor;
      varying float vDeathRamp;
      varying float vSeed;
      varying float vShockwave;
      varying float vDetail;

      ${BIRTH_DEATH_GLSL}

      float shockwaveAtVertex(vec2 worldXZ) {
        float total = 0.0;
        for (int i = 0; i < ${SHOCKWAVE_SLOTS}; i++) {
          float age = uTime - uShockwaveAt[i];
          if (age < 0.0 || age >= uShockwaveDurS) continue;
          float ringR = uShockwaveSpeed * age;
          float dist = length(worldXZ - uShockwaveOriginXZ[i]);
          float bandWidth = uShockwaveBandBase + uShockwaveBandGrow * age;
          float band = exp(-pow((dist - ringR) / bandWidth, 2.0));
          float behind = max(0.0, ringR - dist);
          float trail = exp(-behind / max(bandWidth * 3.2, 0.001)) * step(dist, ringR);
          float t = age / uShockwaveDurS;
          // Asymmetric envelope: rises like sin, then drops fast.
          // smoothstep(0.3, 1.0, t) starts attenuating once the wave is past
          // its early peak, and the (1 - t) linear factor stacks a steady
          // decay so brightness keeps dropping through the back half.
          float life = sin(3.14159265 * t) * (1.0 - smoothstep(0.3, 1.0, t)) * (1.0 - t);
          total += (band + trail * uShockwaveTrailBoost) * life;
        }
        return total;
      }

      void main() {
        vColor = aColor;
        vDetail = aDetail;
        float birthRamp = clamp((uTime - aBornAt) / uBirthDurS, 0.0, 1.0);
        float deathRamp = clamp((uTime - aDeathAt) / uDeathDurS, 0.0, 1.0);
        float bEase = birthEase(birthRamp);
        float dEase = deathEase(deathRamp);
        float scale = bEase * (1.0 - dEase);

        vDeathRamp = deathRamp;
        vSeed      = float(gl_VertexID) * 0.61803 + aBornAt * 0.137;

        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vec4 viewPos  = viewMatrix * worldPos;
        vShockwave = shockwaveAtVertex(worldPos.xz);
        gl_Position   = projectionMatrix * viewPos;
        gl_PointSize  = aSize * ${HYBRID_BASE_PX_PER_WU.toFixed(1)} * (1.0 + vShockwave * uShockwaveSizeBoost) * scale * (uViewportHeight * 0.5 / max(-viewPos.z, 0.001));
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;

      uniform float uTime;
      uniform float uShockwaveColorBoost;
      uniform float uShockwaveAlphaBoost;
      uniform float uShockwaveColorCeil;
      uniform float uShockwaveAlphaCeil;
      uniform float uShockwaveTrailBoost;

      varying vec3  vColor;
      varying float vDeathRamp;
      varying float vSeed;
      varying float vShockwave;
      varying float vDetail;

      // hash11 — small deterministic scrambler. Used for per-cell decorrelation.
      ${HASH11_GLSL}

      // Single central Gaussian peak + faint outer halo wash. The cell's
      // brightest point is anchored at sprite center (= fabric endpoint at
      // cell.pos_seed), which makes the fiber-to-cell connection visually
      // continuous: cell glow and fiber glow are both Gaussian, so they
      // blend additively at the meeting point and form one bright knot.
      //
      // Per-cell variation comes from per-tag color (vColor) and sprite size
      // (aSize).
      vec4 cloud(vec2 uv, float t) {
        float dC = length(uv);

        // Breath: non-translating sigma pulsation so the cell feels alive
        // without the centroid moving. Amplitude small enough that the
        // sprite's brightest pixel stays clearly at center.
        float br     = 0.7 + 0.6 * hash11(vSeed + 7.7);
        float breath = 1.0 + 0.08 * sin(t * br + vSeed);
        float sigma  = 0.10 * breath;
        // LOD peak suppression: near cells (vDetail→1) lose the white-hot core so
        // the nucleus reads; far cells (vDetail=0) are byte-identical to before.
        float peak   = exp(-pow(dC / sigma, 2.0)) * (1.0 - vDetail * 0.92);

        // Color: white-hot at peak center → vColor (per-tag hue) → warm-orange
        // shoulder. No red→burned-black wet-flesh gradient.
        vec3 hot  = mix(vColor, vec3(1.0, 0.97, 0.86), 0.7);
        vec3 warm = mix(vColor, vec3(1.0, 0.65, 0.30), 0.4);
        vec3 col  = mix(warm, hot, peak);

        // Outer halo wash for boundary continuity — very faint full-sprite
        // glow that anchors the cell's footprint when peak alone is too
        // tight at distance.
        float wash = exp(-pow(dC / 0.32, 2.0)) * 0.18 * (1.0 - vDetail * 0.45);
        col += vColor * wash;

        return vec4(col, peak + wash);
      }

      void main() {
        vec2 uv = gl_PointCoord - 0.5;
        if (length(uv) > 0.5) discard;

        float t = uTime;
        if (vDeathRamp >= 1.0) discard;

        vec4 base = cloud(uv, t);

        float shock = vShockwave;
        float shockCore = min(1.0, shock);
        float shockWash = exp(-pow(length(uv) / 0.42, 2.0)) * shock * uShockwaveTrailBoost;
        vec3 shockTint = mix(base.rgb, vec3(1.0, 0.96, 0.80), min(1.0, shockCore * 0.85));

        // Soft-knee the wave's brightness/alpha: same onset slope as the old
        // linear (1 + BOOST*shock), but the bright leading edge saturates toward
        // a warm ceiling instead of railing past white and hard-clipping (see
        // shockwaveMaterial.ts). shock=0 → factor 1.0, so resting cells are
        // untouched. This is the de-glare; the wave's reach/force is preserved.
        float shockColorK = 1.0 + uShockwaveColorCeil * (1.0 - exp(-shock * uShockwaveColorBoost / max(uShockwaveColorCeil, 0.001)));
        float shockAlphaK = 1.0 + uShockwaveAlphaCeil * (1.0 - exp(-shock * uShockwaveAlphaBoost / max(uShockwaveAlphaCeil, 0.001)));

        vec3  col = shockTint * shockColorK + vColor * shockWash;
        float a   = (base.a * shockAlphaK + shockWash) * (1.0 - vDeathRamp);
        if (a < 0.005) discard;
        gl_FragColor = vec4(col * a, a);
      }
    `,
  });
}
