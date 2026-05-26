import * as THREE from 'three';
import { HASH11_GLSL, BIRTH_DEATH_GLSL, FLASH_ENV_GLSL } from './cellEnvelope.glsl';
import { makeShockwaveUniforms, SHOCKWAVE_SLOTS } from './shockwaveMaterial';

/**
 * Single-peak Gaussian cloud baseline + discharge-arm flash for each cell.
 *
 * - Resting state: one central Gaussian peak anchored at sprite center + a
 *   faint outer halo wash. The cell's brightest pixel always sits at sprite
 *   center (= fabric endpoint at cell.pos_seed), so fiber glow and cell glow
 *   share the same Gaussian language and blend additively at junctions.
 * - Flash state (vFlashAge in [0, 0.5s]): central core flashes white-hot and
 *   ARM_DEFAULT asymmetric discharge arms briefly extend then decay.
 *
 * The block shockwave is handled here, on the actual cell body. It never
 * creates a separate point beside the cell: the shader uses the anchored cell
 * position, then brightens and expands that same sprite as the wave crosses it.
 */

// Tunable feel constants — collected here so reviewers find them in one place.
const ARMS_DEFAULT         = 3;
const HYBRID_BASE_PX_PER_WU = 2.0; // sprite world→screen multiplier — ~2× halo outer-glow size; cell body (gl_PointCoord ≤ 0.5) renders at roughly halo-equivalent screen weight

export function makeCellHybridMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime:            { value: 0 },
      uBirthDurS:       { value: 0.5 },
      uDeathDurS:       { value: 0.6 },
      uViewportHeight:  { value: 800 },
      uDischargeArms:   { value: ARMS_DEFAULT },
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
      attribute float aFlashAt;
      attribute float aSize;

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
      varying float vBirthRamp;
      varying float vDeathRamp;
      varying float vFlashAge;
      varying float vSeed;
      varying float vShockwave;

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
        float birthRamp = clamp((uTime - aBornAt) / uBirthDurS, 0.0, 1.0);
        float deathRamp = clamp((uTime - aDeathAt) / uDeathDurS, 0.0, 1.0);
        float bEase = birthEase(birthRamp);
        float dEase = deathEase(deathRamp);
        float scale = bEase * (1.0 - dEase);

        vBirthRamp = birthRamp;
        vDeathRamp = deathRamp;
        vFlashAge  = uTime - aFlashAt;
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
      uniform float uDischargeArms;
      uniform float uShockwaveColorBoost;
      uniform float uShockwaveAlphaBoost;
      uniform float uShockwaveTrailBoost;

      varying vec3  vColor;
      varying float vBirthRamp;
      varying float vDeathRamp;
      varying float vFlashAge;
      varying float vSeed;
      varying float vShockwave;

      // hash11 — small deterministic scrambler. Used for per-cell decorrelation.
      ${HASH11_GLSL}

      ${FLASH_ENV_GLSL}

      // Single central Gaussian peak + faint outer halo wash. The cell's
      // brightest point is anchored at sprite center (= fabric endpoint at
      // cell.pos_seed), which makes the fiber-to-cell connection visually
      // continuous: cell glow and fiber glow are both Gaussian, so they
      // blend additively at the meeting point and form one bright knot.
      //
      // Per-cell variation comes from per-tag color (vColor) and sprite size
      // (aSize). uDischargeArms drives the discharge() helper below.
      vec4 cloud(vec2 uv, float t) {
        float dC = length(uv);

        // Breath: non-translating sigma pulsation so the cell feels alive
        // without the centroid moving. Amplitude small enough that the
        // sprite's brightest pixel stays clearly at center.
        float br     = 0.7 + 0.6 * hash11(vSeed + 7.7);
        float breath = 1.0 + 0.08 * sin(t * br + vSeed);
        float sigma  = 0.10 * breath;
        float peak   = exp(-pow(dC / sigma, 2.0));

        // Color: white-hot at peak center → vColor (per-tag hue) → warm-orange
        // shoulder. No red→burned-black wet-flesh gradient.
        vec3 hot  = mix(vColor, vec3(1.0, 0.97, 0.86), 0.7);
        vec3 warm = mix(vColor, vec3(1.0, 0.65, 0.30), 0.4);
        vec3 col  = mix(warm, hot, peak);

        // Outer halo wash for boundary continuity — very faint full-sprite
        // glow that anchors the cell's footprint when peak alone is too
        // tight at distance.
        float wash = exp(-pow(dC / 0.32, 2.0)) * 0.18;
        col += vColor * wash;

        return vec4(col, peak + wash);
      }

      // Discharge — central white-hot core + ARM asymmetric arms during the
      // flash window. Matches the same firing event the LCL-amber pulse
      // on the fabric just delivered.
      vec4 discharge(vec2 uv, float t, float armCount, float flashAge) {
        float env = flashEnv(flashAge);
        if (env <= 0.0) return vec4(0.0);

        // White-hot core
        float dC   = length(uv);
        float core = exp(-pow(dC / 0.06, 2.0));
        vec3 col   = vec3(1.0, 0.99, 0.95) * core * env * 1.4;
        float alpha = core * env * 1.2;

        // Asymmetric arms — each at its own base angle + own slow rotation
        // rate. Arm length scales with the env. Each arm sampled along ~10
        // small Gaussian dots; near the core the dots are big and bright,
        // tip dots are small.
        int A = int(armCount);
        for (int i = 0; i < 3; i++) {
          if (i >= A) break;
          float fi   = float(i);
          float armSeed = vSeed * 23.0 + fi * 1.93;
          float baseAng = armSeed;
          float armRate = (mod(fi, 2.0) < 0.5) ? 0.30 : -0.20;
          float ang     = baseAng + t * armRate;
          // Length envelope: grows then shrinks across the flash window.
          float lenMax = 0.32 + 0.08 * sin(t * 0.6 + armSeed);
          float len    = lenMax * env;
          float perpAmp = 0.04 * sin(t * 0.5 + armSeed);

          for (int s = 1; s <= 10; s++) {
            float t01 = float(s) / 10.0;
            float r0  = 0.04 + (len - 0.04) * t01;
            float perp = perpAmp * sin(t01 * 4.0 + t * 1.2);
            vec2 p     = vec2(
              cos(ang) * r0 - sin(ang) * perp,
              sin(ang) * r0 + cos(ang) * perp
            );
            float dotR = (0.030 * (1.0 - t01) + 0.005);
            float dD   = length(uv - p);
            float dG   = exp(-pow(dD / dotR, 2.0));
            float aT   = env * (1.0 - t01);
            col   += mix(vColor, vec3(1.0, 0.95, 0.78), 0.7) * dG * aT;
            alpha += dG * aT * 0.7;
          }
        }
        return vec4(col, alpha);
      }

      void main() {
        vec2 uv = gl_PointCoord - 0.5;
        if (length(uv) > 0.5) discard;

        float t = uTime;
        if (vDeathRamp >= 1.0) discard;

        vec4 base = cloud(uv, t);
        // Discharge only outside the death window (a dying cell shouldn't fire).
        float liveGate = (vDeathRamp < 0.001) ? 1.0 : (1.0 - vDeathRamp);
        vec4 disc = discharge(uv, t, uDischargeArms, vFlashAge);
        // During birth, scale discharge by birthRamp so a freshly-born cell
        // doesn't pop with a full discharge before it has even ramped up.
        disc *= clamp(vBirthRamp, 0.0, 1.0);
        disc *= liveGate;

        float shock = vShockwave;
        float shockCore = min(1.0, shock);
        float shockWash = exp(-pow(length(uv) / 0.42, 2.0)) * shock * uShockwaveTrailBoost;
        vec3 shockTint = mix(base.rgb, vec3(1.0, 0.96, 0.80), min(1.0, shockCore * 0.85));

        vec3  col = shockTint * (1.0 + shock * uShockwaveColorBoost) + disc.rgb + vColor * shockWash;
        float a   = (base.a * (1.0 + shock * uShockwaveAlphaBoost) + disc.a + shockWash) * (1.0 - vDeathRamp);
        if (a < 0.005) discard;
        gl_FragColor = vec4(col * a, a);
      }
    `,
  });
}
