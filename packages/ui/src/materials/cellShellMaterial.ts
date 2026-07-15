import * as THREE from 'three';
import { BIRTH_DEATH_GLSL, FLASH_ENV_GLSL } from './cellEnvelope.glsl';
import { makeShockwaveUniforms, SHOCKWAVE_SLOTS } from './shockwaveMaterial';

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
      ...makeShockwaveUniforms(),
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
      varying vec2  vWorldXZ;

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
        vWorldXZ   = modelWorldPos.xz;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;

      uniform float uTime;
      uniform float uFlashPeak;
      uniform float uOpacity;
      uniform float uShockwaveAt[${SHOCKWAVE_SLOTS}];
      uniform vec2  uShockwaveOriginXZ[${SHOCKWAVE_SLOTS}];
      uniform vec3  uShockwaveColor[${SHOCKWAVE_SLOTS}];
      uniform float uShockwaveSpeed;
      uniform float uShockwaveDurS;
      uniform float uShockwaveBandBase;
      uniform float uShockwaveBandGrow;
      uniform float uShockwaveColorBoost;
      uniform float uShockwaveAlphaBoost;
      uniform float uShockwaveColorCeil;
      uniform float uShockwaveAlphaCeil;
      uniform float uShockwaveTrailBoost;

      varying vec3  vColor;
      varying float vBirthRamp;
      varying float vDeathRamp;
      varying float vFlashAge;
      varying vec2  vWorldXZ;

      ${FLASH_ENV_GLSL}

      vec4 shockwave() {
        float total = 0.0;
        vec3 carrier = vec3(0.0);
        for (int i = 0; i < ${SHOCKWAVE_SLOTS}; i++) {
          float age = uTime - uShockwaveAt[i];
          if (age < 0.0 || age >= uShockwaveDurS) continue;
          float ringR = uShockwaveSpeed * age;
          float dist = length(vWorldXZ - uShockwaveOriginXZ[i]);
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
          float signal = (band + trail * uShockwaveTrailBoost) * life;
          total += signal;
          carrier += uShockwaveColor[i] * signal;
        }
        return vec4(carrier, total);
      }

      void main() {
        if (vDeathRamp >= 1.0) discard;

        // Brightness goes from 1.0 → uFlashPeak at the flash envelope's peak.
        float flashBoost = 1.0 + (uFlashPeak - 1.0) * flashEnv(vFlashAge);
        vec4 shockwaveSignal = shockwave();
        float shock = shockwaveSignal.a;
        vec3 waveColor = shock > 0.0001
          ? shockwaveSignal.rgb / shock
          : vec3(0.72, 0.96, 1.0);
        // Soft-knee the wave's brightness/alpha: same onset slope as the old
        // linear (1 + BOOST*shock), but the bright leading edge saturates toward
        // a warm ceiling instead of railing past white and hard-clipping (see
        // shockwaveMaterial.ts). shock=0 → factor 1.0.
        float shockBoost = 1.0 + uShockwaveColorCeil * (1.0 - exp(-shock * uShockwaveColorBoost / max(uShockwaveColorCeil, 0.001)));
        float shockAlpha = 1.0 + uShockwaveAlphaCeil * (1.0 - exp(-shock * uShockwaveAlphaBoost / max(uShockwaveAlphaCeil, 0.001)));

        // Life gate: pre-birth invisible, mid-life full, in-death fading out.
        float lifeGate = vBirthRamp * (1.0 - vDeathRamp);

        // The shell inherits the same per-block carrier hue as the far core.
        // shock=0 leaves resting and local-write feedback untouched.
        vec3 shockTint = mix(vColor, waveColor, min(1.0, shock * 0.85));
        vec3 col = shockTint * flashBoost * shockBoost * lifeGate;

        // Additive blending; alpha is the modulation factor.
        gl_FragColor = vec4(
          col * uOpacity,
          lifeGate * uOpacity * shockAlpha
        );
      }
    `,
  });
}
