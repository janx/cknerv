import * as THREE from 'three';
import { BIRTH_DEATH_GLSL, FLASH_ENV_GLSL } from './cellEnvelope.glsl';

// Mean per-cell idle rotation rate (radians per second around the local Y axis).
// Each cell's rotation is offset by aRotPhase so the canopy reads as alive
// rather than synchronized.
const ROT_RATE_BASE = 0.18;

// Brightness multiplier at the flash envelope's peak. flashEnv(age) returns
// values in [0, 1]; the final brightness factor is (1 + (uFlashPeak − 1) * flashEnv).
// 2.4 mirrors GlowNode's flash_green target intensity.
const FLASH_PEAK = 2.4;

export function makeCellShellMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    uniforms: {
      uTime:       { value: 0 },
      uBirthDurS:  { value: 0.5 },
      uDeathDurS:  { value: 0.6 },
      uRotRate:    { value: ROT_RATE_BASE },
      uFlashPeak:  { value: FLASH_PEAK },
      uOpacity:    { value: 0.5 },
    },
    vertexShader: /* glsl */ `
      attribute vec3 aPos;
      attribute vec3 aColor;
      attribute float aBornAt;
      attribute float aDeathAt;
      attribute float aFlashAt;
      attribute float aRotPhase;
      attribute float aSize;

      uniform float uTime;
      uniform float uBirthDurS;
      uniform float uDeathDurS;
      uniform float uRotRate;

      varying vec3  vColor;
      varying float vBirthRamp;
      varying float vDeathRamp;
      varying float vFlashAge;

      ${BIRTH_DEATH_GLSL}

      void main() {
        float birthRamp = clamp((uTime - aBornAt) / uBirthDurS, 0.0, 1.0);
        float deathRamp = clamp((uTime - aDeathAt) / uDeathDurS, 0.0, 1.0);
        float scale = birthEase(birthRamp) * (1.0 - deathEase(deathRamp));

        // Per-cell Y-axis rotation. position is the canonical local edge endpoint
        // from truncatedOctahedron.ts; aPos is the cell's world center.
        float ang = uTime * uRotRate + aRotPhase;
        float c = cos(ang);
        float s = sin(ang);
        vec3 rotated = vec3(
          c * position.x + s * position.z,
          position.y,
          -s * position.x + c * position.z
        );
        vec3 worldPos = aPos + rotated * aSize * scale;

        vec4 modelWorldPos = modelMatrix * vec4(worldPos, 1.0);
        vec4 viewPos = viewMatrix * modelWorldPos;
        gl_Position = projectionMatrix * viewPos;

        vColor     = aColor;
        vBirthRamp = birthRamp;
        vDeathRamp = deathRamp;
        vFlashAge  = uTime - aFlashAt;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;

      uniform float uTime;
      uniform float uFlashPeak;
      uniform float uOpacity;

      varying vec3  vColor;
      varying float vBirthRamp;
      varying float vDeathRamp;
      varying float vFlashAge;

      ${FLASH_ENV_GLSL}

      void main() {
        if (vDeathRamp >= 1.0) discard;

        // Brightness goes from 1.0 → uFlashPeak at the flash envelope's peak.
        float flashBoost = 1.0 + (uFlashPeak - 1.0) * flashEnv(vFlashAge);

        // Life gate: pre-birth invisible, mid-life full, in-death fading out.
        float lifeGate = vBirthRamp * (1.0 - vDeathRamp);

        vec3 col = vColor * flashBoost * lifeGate;

        // Additive blending; alpha is the modulation factor.
        gl_FragColor = vec4(
          col * uOpacity,
          lifeGate * uOpacity
        );
      }
    `,
  });
}
