import * as THREE from 'three';
import {
  makeShockwaveUniforms,
  SHOCKWAVE_SIGNAL_GLSL,
  SHOCKWAVE_UNIFORMS_GLSL,
  type ShockwaveUniforms,
} from './shockwaveMaterial';
import { PEER_NETWORK_PALETTE } from '../visualPalette';

/**
 * Shared fragment response for the P2P brightness shockwave. Passive context
 * can be subdued during Cell inspection, while a real block event retains its
 * full energy and carrier hue.
 */
const PEER_SHOCKWAVE_RESPONSE_GLSL = /* glsl */ `
  vec4 peerShockwaveResponse(
    vec3 baseColor,
    float shape,
    float halo,
    float passiveEnergy,
    float eventScale
  ) {
    float shock = vShockwave;
    vec3 waveColor = shock > 0.0001
      ? vShockwaveCarrier / shock
      : vec3(0.72, 0.96, 1.0);
    float colorExtra = uShockwaveColorCeil
      * (1.0 - exp(
        -shock * uShockwaveColorBoost
          / max(uShockwaveColorCeil, 0.001)
      ));
    float alphaExtra = uShockwaveAlphaCeil
      * (1.0 - exp(
        -shock * uShockwaveAlphaBoost
          / max(uShockwaveAlphaCeil, 0.001)
      ));
    vec3 shockTint = mix(
      baseColor,
      waveColor,
      min(1.0, shock * 0.85)
    );
    float wash = halo * shock * uShockwaveTrailBoost * eventScale;
    float passiveShape = shape * eventScale;
    float passive = shape * passiveEnergy;
    float eventAlpha = shape * alphaExtra * eventScale + wash;
    vec3 color = baseColor * passive
      + shockTint * shape * colorExtra * eventScale
      + waveColor * wash;
    // AdditiveBlending applies alpha to RGB again. The passive context weight
    // therefore belongs in color only; retaining the unscaled shape in alpha
    // makes the requested context energy linear and leaves events untouched.
    return vec4(color, passiveShape + eventAlpha);
  }
`;

function sharedShockwave(
  uniforms?: ShockwaveUniforms,
): ShockwaveUniforms {
  return uniforms ?? makeShockwaveUniforms();
}

/**
 * One draw for every inferred peer node. The point itself is the topology
 * record; the wave only changes its size/brightness and never emits decorative
 * particles beside it.
 */
export function makePeerCloudMaterial(
  uniforms?: ShockwaveUniforms,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uColor: {
        value: new THREE.Color().setRGB(...PEER_NETWORK_PALETTE.scaffold),
      },
      uDim: { value: 0.9 },
      uSize: { value: 5.5 },
      uContextEnergy: { value: 1 },
      ...sharedShockwave(uniforms),
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uSize;
      ${SHOCKWAVE_UNIFORMS_GLSL}

      varying float vShockwave;
      varying vec3 vShockwaveCarrier;

      ${SHOCKWAVE_SIGNAL_GLSL}

      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vec4 wave = shockwaveSignalAt(world.xz);
        vShockwave = wave.a;
        vShockwaveCarrier = wave.rgb;
        vec4 view = viewMatrix * world;
        gl_PointSize = uSize
          * (1.0 + min(1.0, vShockwave) * uShockwaveSizeBoost)
          * (300.0 / max(-view.z, 0.001));
        gl_Position = projectionMatrix * view;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;

      uniform vec3 uColor;
      uniform float uDim;
      uniform float uContextEnergy;
      ${SHOCKWAVE_UNIFORMS_GLSL}

      varying float vShockwave;
      varying vec3 vShockwaveCarrier;

      ${PEER_SHOCKWAVE_RESPONSE_GLSL}

      void main() {
        float r = length(gl_PointCoord - 0.5) * 2.0;
        if (r > 1.0) discard;
        float core = pow(1.0 - r, 2.0);
        float halo = pow(1.0 - r, 1.6) * 0.42;
        vec4 signal = peerShockwaveResponse(
          uColor,
          core + halo,
          halo,
          uDim * uContextEnergy,
          uDim
        );
        gl_FragColor = signal;
      }
    `,
  });
}

/**
 * Camera-facing halo for one measured peer. It uses the same radial primitive
 * as GlowNode at rest, but samples the shared block wave in world XZ so the
 * measured core and inferred scaffold form one continuous front.
 */
export function makePeerHaloMaterial(
  color: THREE.ColorRepresentation,
  uniforms?: ShockwaveUniforms,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uPhase: { value: 0 },
      uIntensity: { value: 1 },
      uColor: { value: new THREE.Color(color) },
      uContextEnergy: { value: 1 },
      ...sharedShockwave(uniforms),
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying float vShockwave;
      varying vec3 vShockwaveCarrier;

      uniform float uTime;
      ${SHOCKWAVE_UNIFORMS_GLSL}

      ${SHOCKWAVE_SIGNAL_GLSL}

      void main() {
        vUv = uv;
        vec4 center = modelMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        vec4 wave = shockwaveSignalAt(center.xz);
        vShockwave = wave.a;
        vShockwaveCarrier = wave.rgb;
        vec3 expanded = position
          * (1.0 + min(1.0, vShockwave) * uShockwaveSizeBoost);
        gl_Position = projectionMatrix
          * modelViewMatrix
          * vec4(expanded, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;

      varying vec2 vUv;
      varying float vShockwave;
      varying vec3 vShockwaveCarrier;

      uniform float uTime;
      uniform float uPhase;
      uniform float uIntensity;
      uniform float uContextEnergy;
      uniform vec3 uColor;
      ${SHOCKWAVE_UNIFORMS_GLSL}

      ${PEER_SHOCKWAVE_RESPONSE_GLSL}

      void main() {
        float r = length(vUv - 0.5) * 2.0;
        if (r > 1.0) discard;
        float core = pow(1.0 - r, 4.0);
        float halo = pow(1.0 - r, 1.6) * 0.42;
        float breathe = 0.78 + 0.22 * sin(uTime * 1.2 + uPhase);
        float intensity = uIntensity * breathe;
        vec4 signal = peerShockwaveResponse(
          uColor,
          core + halo,
          halo,
          intensity * uContextEnergy,
          intensity
        );
        gl_FragColor = signal;
      }
    `,
  });
}

/** Injected so the instanced port and the historical per-node CPU loop share
 * one definition of the measured core's brightness envelope. */
export const MEASURED_PEER_BRIGHTNESS = 1.6;

/**
 * Every measured peer halo in ONE instanced draw. Replaces one drei Billboard
 * plus one single-quad mesh (and two frame subscribers) per peer: the
 * billboard is rebuilt from the view matrix's camera axes — exactly the
 * orientation the follow-Billboard's camera quaternion produced — and the
 * per-node breathe (rate/phase) plus intensity envelope move from per-material
 * uniforms into instanced attributes evaluated against one shared uTime.
 * Selection keeps its context-energy exemption through aPeerSelected.
 */
export function makeMeasuredPeerHalosMaterial(
  uniforms?: ShockwaveUniforms,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uContextEnergy: { value: 1 },
      ...sharedShockwave(uniforms),
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    vertexShader: /* glsl */ `
      attribute vec3 aPeerColor;
      attribute float aPeerPhase;
      attribute float aPeerRate;
      attribute float aPeerSelected;

      varying vec2 vUv;
      varying float vShockwave;
      varying vec3 vShockwaveCarrier;
      varying vec3 vPeerColor;
      varying float vPeerPhase;
      varying float vPeerRate;
      varying float vPeerSelected;

      uniform float uTime;
      ${SHOCKWAVE_UNIFORMS_GLSL}

      ${SHOCKWAVE_SIGNAL_GLSL}

      void main() {
        vUv = uv;
        vPeerColor = aPeerColor;
        vPeerPhase = aPeerPhase;
        vPeerRate = aPeerRate;
        vPeerSelected = aPeerSelected;
        vec4 origin = modelMatrix
          * instanceMatrix
          * vec4(0.0, 0.0, 0.0, 1.0);
        vec4 wave = shockwaveSignalAt(origin.xz);
        vShockwave = wave.a;
        vShockwaveCarrier = wave.rgb;
        float expand = 1.0 + min(1.0, vShockwave) * uShockwaveSizeBoost;
        // The follow-Billboard applied the camera's world quaternion; the
        // view matrix's row axes are that same frame, so the silhouette is
        // identical with zero per-frame CPU.
        vec3 cameraRight = vec3(
          viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]
        );
        vec3 cameraUp = vec3(
          viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]
        );
        vec3 world = origin.xyz
          + (cameraRight * position.x + cameraUp * position.y) * expand;
        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;

      varying vec2 vUv;
      varying float vShockwave;
      varying vec3 vShockwaveCarrier;
      varying vec3 vPeerColor;
      varying float vPeerPhase;
      varying float vPeerRate;
      varying float vPeerSelected;

      uniform float uTime;
      uniform float uContextEnergy;
      ${SHOCKWAVE_UNIFORMS_GLSL}

      ${PEER_SHOCKWAVE_RESPONSE_GLSL}

      void main() {
        float r = length(vUv - 0.5) * 2.0;
        if (r > 1.0) discard;
        float core = pow(1.0 - r, 4.0);
        float halo = pow(1.0 - r, 1.6) * 0.42;
        // The historical CPU envelope, verbatim: intensity uniform carried
        // MEASURED_PEER_BRIGHTNESS * (0.85 + 0.15 * sin(t * rate + phase)).
        float envelope = ${MEASURED_PEER_BRIGHTNESS.toFixed(1)}
          * (0.85 + 0.15 * sin(uTime * vPeerRate + vPeerPhase));
        float breathe = 0.78 + 0.22 * sin(uTime * 1.2 + vPeerPhase);
        float intensity = envelope * breathe;
        float contextEnergy = mix(uContextEnergy, 1.0, vPeerSelected);
        vec4 signal = peerShockwaveResponse(
          vPeerColor,
          core + halo,
          halo,
          intensity * contextEnergy,
          intensity
        );
        gl_FragColor = signal;
      }
    `,
  });
}
