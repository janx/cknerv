import * as THREE from 'three';
import { HASH11_GLSL, BIRTH_DEATH_GLSL, FLASH_ENV_GLSL } from './cellEnvelope.glsl';

/** Default contributor-rail count (overridden per-frame by the quality preset). */
const PROTOCOL_RAILS_DEFAULT = 3;
/** Screen-size basis. MUST match HYBRID_BASE_PX_PER_WU in cellHybridMaterial so
 *  the flare's sprite footprint lines up exactly over the cell it overlays. */
const FLARE_BASE_PX_PER_WU = 2.0;

/**
 * Protocol-write Points material. Straight contributor rails converge on an
 * interrupted pair of agreement loops and a central four-way knot. It remains
 * a separate additive layer over the steady Cell body, but deliberately avoids
 * sparks, tendrils, membranes, and other carbon-biological motion.
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
      // Compatibility name: this now controls contributor rails, not sparks.
      uDischargeArms:  { value: PROTOCOL_RAILS_DEFAULT },
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
      uniform float uViewportHeight; // drawing-buffer height (CSS height × DPR)

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

      mat2 rotate2(float angle) {
        float c = cos(angle);
        float s = sin(angle);
        return mat2(c, -s, s, c);
      }

      float segmentDistance(vec2 p, vec2 a, vec2 b) {
        vec2 pa = p - a;
        vec2 ba = b - a;
        float h = clamp(dot(pa, ba) / max(dot(ba, ba), 0.0001), 0.0, 1.0);
        return length(pa - ba * h);
      }

      // A local Cell write in the same language as the galaxy routes:
      // contributors arrive on signed rails, two interrupted loops reconcile,
      // and the pale central knot records agreement.
      vec4 protocolWrite(vec2 uv, float t, float railCount, float flashAge) {
        float env = flashEnv(flashAge);
        if (env <= 0.0) return vec4(0.0);

        const float TAU = 6.28318530718;
        vec3 gold = vec3(0.86, 0.61, 0.25);
        vec3 cyan = vec3(0.10, 0.82, 1.00);
        vec3 violet = vec3(0.40, 0.20, 1.00);
        vec3 pale = vec3(0.72, 0.96, 1.00);
        float eventPhase = clamp(flashAge / 0.5, 0.0, 1.0);
        float dC = length(uv);
        float angle = atan(uv.y, uv.x);

        // Counter-rotated interrupted agreement loops. The gaps make the event
        // read as a protocol resolving in stages, never as a generic halo.
        float outerRadius = 0.12 + eventPhase * 0.17;
        float innerRadius = 0.18 + eventPhase * 0.10;
        float outerBand = exp(-pow((dC - outerRadius) / 0.014, 2.0));
        float innerBand = exp(-pow((dC - innerRadius) / 0.011, 2.0));
        float outerGate = 0.18 + 0.82 * smoothstep(
          -0.28,
          0.62,
          sin(angle * 3.0 + eventPhase * 4.2 + vSeed)
        );
        float innerGate = 0.16 + 0.84 * smoothstep(
          -0.34,
          0.58,
          sin(angle * 3.0 - eventPhase * 4.8 - vSeed * 0.73)
        );
        float outer = outerBand * outerGate * env;
        float inner = innerBand * innerGate * env;

        // The agreement knot is an open diamond plus a restrained pale core.
        vec2 knotUv = rotate2(0.18 + eventPhase * 0.22) * uv;
        float diamondRadius = abs(knotUv.x) + abs(knotUv.y);
        float knot = exp(-pow((diamondRadius - 0.061) / 0.009, 2.0)) * env;
        float core = exp(-pow(dC / 0.034, 2.0)) * env;

        vec3 col = gold * outer * 0.9 + cyan * inner * 1.05;
        col += pale * (knot * 1.05 + core * 1.25);
        float alpha = outer * 0.72 + inner * 0.72 + knot + core;

        // One to three straight contributor rails resolve inward. Hash changes
        // only their orientation; their grammar and lane colours stay canonical.
        int A = int(railCount);
        float baseAngle = hash11(vSeed + 2.7) * TAU + t * 0.035;
        for (int i = 0; i < 3; i++) {
          if (i >= A) break;
          float fi = float(i);
          float railAngle = baseAngle + fi * 2.39996323;
          vec2 direction = vec2(cos(railAngle), sin(railAngle));
          float resolve = smoothstep(fi * 0.055, 0.32 + fi * 0.055, eventPhase);
          vec2 railStart = direction * mix(0.34, 0.075, resolve);
          vec2 railEnd = direction * 0.055;
          float rail = exp(-pow(segmentDistance(uv, railStart, railEnd) / 0.009, 2.0));
          float node = exp(-pow(length(uv - railStart) / 0.018, 2.0));
          float railGate = env * smoothstep(0.0, 0.1, resolve);
          vec3 lane = gold;
          if (i == 1) lane = cyan;
          if (i == 2) lane = mix(violet, cyan, 0.24);
          col += lane * (rail * 0.72 + node * 0.92) * railGate;
          alpha += (rail * 0.48 + node * 0.7) * railGate;
        }
        return vec4(col, alpha);
      }

      void main() {
        vec2 uv = gl_PointCoord - 0.5;
        if (length(uv) > 0.5) discard;
        if (vDeathRamp >= 1.0) discard;

        float liveGate = (vDeathRamp < 0.001) ? 1.0 : (1.0 - vDeathRamp);
        vec4 writeSignal = protocolWrite(uv, uTime, uDischargeArms, vFlashAge);
        // Birth-scale so a freshly-born cell doesn't pop a full protocol seal.
        writeSignal *= clamp(vBirthRamp, 0.0, 1.0);
        writeSignal *= liveGate;

        float a = writeSignal.a * (1.0 - vDeathRamp);
        if (a < 0.005) discard;
        gl_FragColor = vec4(writeSignal.rgb * a, a);
      }
    `,
  });
}
