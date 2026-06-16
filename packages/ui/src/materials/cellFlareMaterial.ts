import * as THREE from 'three';
import { HASH11_GLSL, BIRTH_DEATH_GLSL, FLASH_ENV_GLSL } from './cellEnvelope.glsl';

/** Default discharge arm count (overridden per-frame from the quality preset). */
const FLARE_ARMS_DEFAULT = 3;
/** Screen-size basis. MUST match HYBRID_BASE_PX_PER_WU in cellHybridMaterial so
 *  the flare's sprite footprint lines up exactly over the cell it overlays. */
const FLARE_BASE_PX_PER_WU = 2.0;

/**
 * Discharge-only Points material: the white-hot core + asymmetric spark arms a
 * nerve pulse used to paint directly onto the cell sprite. Rendered as a
 * SEPARATE additive layer (sharing the cell BufferGeometry) so the cell body's
 * own brightness no longer changes when a pulse arrives — the cue still blooms
 * at the same spot, decoupled from the cell's value/tag encoding.
 *
 * Reads the shared `aFlashAt` attribute → `vFlashAge`; gated by birth/death so
 * unborn/dead cells never flare. No cloud, no shockwave — those stay on the
 * cell body material.
 */
export function makeCellFlareMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime:           { value: 0 },
      uBirthDurS:      { value: 0.5 },
      uDeathDurS:      { value: 0.6 },
      uViewportHeight: { value: 800 },
      uDischargeArms:  { value: FLARE_ARMS_DEFAULT },
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

      varying vec3  vColor;
      varying float vBirthRamp;
      varying float vDeathRamp;
      varying float vFlashAge;
      varying float vSeed;

      ${BIRTH_DEATH_GLSL}

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

        vec4 viewPos = viewMatrix * modelMatrix * vec4(position, 1.0);
        gl_Position  = projectionMatrix * viewPos;
        // Same base point size as the cell body (minus the shockwave boost,
        // a cell-body-only effect) so the arms register over their cell.
        gl_PointSize = aSize * ${FLARE_BASE_PX_PER_WU.toFixed(1)} * scale * (uViewportHeight * 0.5 / max(-viewPos.z, 0.001));
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;

      uniform float uTime;
      uniform float uDischargeArms;

      varying vec3  vColor;
      varying float vBirthRamp;
      varying float vDeathRamp;
      varying float vFlashAge;
      varying float vSeed;

      ${HASH11_GLSL}
      ${FLASH_ENV_GLSL}

      // Central white-hot core + ARM asymmetric arms during the flash window.
      // Identical math to the discharge() that used to live on the cell body.
      vec4 discharge(vec2 uv, float t, float armCount, float flashAge) {
        float env = flashEnv(flashAge);
        if (env <= 0.0) return vec4(0.0);

        float dC   = length(uv);
        float core = exp(-pow(dC / 0.06, 2.0));
        vec3 col   = vec3(1.0, 0.99, 0.95) * core * env * 1.4;
        float alpha = core * env * 1.2;

        int A = int(armCount);
        for (int i = 0; i < 3; i++) {
          if (i >= A) break;
          float fi   = float(i);
          float armSeed = vSeed * 23.0 + fi * 1.93;
          float baseAng = armSeed;
          float armRate = (mod(fi, 2.0) < 0.5) ? 0.30 : -0.20;
          float ang     = baseAng + t * armRate;
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
        if (vDeathRamp >= 1.0) discard;

        float liveGate = (vDeathRamp < 0.001) ? 1.0 : (1.0 - vDeathRamp);
        vec4 disc = discharge(uv, uTime, uDischargeArms, vFlashAge);
        // Birth-scale so a freshly-born cell doesn't pop a full flare; gate off
        // the death window.
        disc *= clamp(vBirthRamp, 0.0, 1.0);
        disc *= liveGate;

        float a = disc.a * (1.0 - vDeathRamp);
        if (a < 0.005) discard;
        gl_FragColor = vec4(disc.rgb * a, a);
      }
    `,
  });
}
