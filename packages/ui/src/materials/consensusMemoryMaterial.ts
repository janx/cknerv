import * as THREE from 'three';
import type { CellVisualDescriptor } from '../derives/cellVisual.derive';

interface MaterialOptions {
  opacity?: number;
  doubleSided?: boolean;
}

/** Segmented dark ceramic whose electrum edges conduct a restrained psi glow. */
export function makeMemoryCarapaceMaterial(
  visual: CellVisualDescriptor,
  options: MaterialOptions = {},
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSeed: { value: new THREE.Vector4(...visual.seeds) },
      uAccent: { value: new THREE.Color(...visual.accent) },
      uOpacity: { value: options.opacity ?? 0.94 },
    },
    transparent: true,
    depthWrite: true,
    depthTest: true,
    side: options.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
    toneMapped: false,
    vertexShader: /* glsl */ `
      attribute vec3 aBary;
      varying vec3 vBary;
      varying vec3 vNormal;
      varying vec3 vView;
      varying vec3 vLocal;

      void main() {
        vec3 p = position;
        vec3 n = normal;
        #ifdef USE_INSTANCING
          p = (instanceMatrix * vec4(p, 1.0)).xyz;
          n = normalize(mat3(instanceMatrix) * n);
        #endif
        vec4 world = modelMatrix * vec4(p, 1.0);
        vBary = aBary;
        vLocal = position;
        vNormal = normalize(mat3(modelMatrix) * n);
        vView = normalize(cameraPosition - world.xyz);
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform float uTime;
      uniform vec4 uSeed;
      uniform vec3 uAccent;
      uniform float uOpacity;
      varying vec3 vBary;
      varying vec3 vNormal;
      varying vec3 vView;
      varying vec3 vLocal;

      float band(float value, float centre, float width) {
        return 1.0 - smoothstep(width * 0.28, width, abs(value - centre));
      }

      void main() {
        vec3 N = normalize(vNormal);
        vec3 V = normalize(vView);
        float ndv = abs(dot(N, V));
        float fresnel = pow(1.0 - ndv, 2.7);
        float baryMin = min(min(vBary.x, vBary.y), vBary.z);
        float edge = 1.0 - smoothstep(0.0, 0.052, baryMin);
        float light = 0.5 + 0.5 * dot(N, normalize(vec3(-0.44, 0.7, 0.56)));

        vec3 voidCeramic = vec3(0.003, 0.008, 0.018);
        vec3 midnight = vec3(0.018, 0.035, 0.064);
        vec3 electrum = mix(vec3(0.76, 0.52, 0.19), uAccent, 0.04);
        vec3 paleGold = vec3(0.96, 0.79, 0.43);
        vec3 psi = vec3(0.12, 0.78, 1.0);

        float ceremonial = 0.5 + 0.5 * sin(
          vLocal.x * (13.0 + uSeed.x * 5.0)
          - abs(vLocal.y) * 9.0
          + uSeed.z * 6.2831
        );
        float seam = band(
          fract(vLocal.x * 3.2 + vLocal.y * 5.5 + uSeed.y),
          0.5,
          0.055
        );
        float phase = 0.5 + 0.5 * sin(uTime * 0.42 + uSeed.w * 6.2831);

        vec3 col = mix(voidCeramic, midnight, 0.34 + light * 0.48);
        col += mix(electrum, paleGold, ceremonial) * edge * (0.1 + light * 0.09);
        col += electrum * (0.16 + light * 0.28 + ceremonial * 0.055);
        col += psi * fresnel * (0.34 + phase * 0.08);
        col += psi * seam * (0.035 + fresnel * 0.09);

        float alpha = 0.82 + edge * 0.13 + fresnel * 0.05;
        gl_FragColor = vec4(col, min(1.0, alpha) * uOpacity);
      }
    `,
  });
}

/** Translucent contributor field; additive overlap creates the shared memory. */
export function makeMemoryLobeMaterial(
  visual: CellVisualDescriptor,
  options: MaterialOptions = {},
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSeed: { value: new THREE.Vector4(...visual.seeds) },
      uOpacity: { value: options.opacity ?? 0.68 },
    },
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    vertexShader: /* glsl */ `
      varying vec3 vLocal;
      varying vec3 vNormal;
      varying vec3 vView;
      varying vec3 vWorld;

      void main() {
        vec3 p = position;
        vec3 n = normal;
        #ifdef USE_INSTANCING
          p = (instanceMatrix * vec4(p, 1.0)).xyz;
          n = normalize(mat3(instanceMatrix) * n);
        #endif
        vec4 world = modelMatrix * vec4(p, 1.0);
        vLocal = position;
        vNormal = normalize(mat3(modelMatrix) * n);
        vView = normalize(cameraPosition - world.xyz);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform float uTime;
      uniform vec4 uSeed;
      uniform float uOpacity;
      varying vec3 vLocal;
      varying vec3 vNormal;
      varying vec3 vView;
      varying vec3 vWorld;

      void main() {
        vec3 N = normalize(vNormal);
        vec3 V = normalize(vView);
        float fresnel = pow(1.0 - abs(dot(N, V)), 3.0);
        float phaseA = 0.5 + 0.5 * sin(
          vLocal.x * (8.0 + uSeed.x * 3.0)
          + vLocal.y * 5.0
          - uTime * 0.72
          + uSeed.z * 6.2831
        );
        float phaseB = 0.5 + 0.5 * sin(
          dot(vWorld, vec3(8.0, 11.0, 6.0))
          + uTime * 0.46
          + uSeed.w * 5.0
        );
        float filament = pow(max(0.0, phaseA * phaseB), 4.0);
        float axialFade = smoothstep(1.0, 0.12, abs(vLocal.x));
        vec3 violet = vec3(0.18, 0.08, 0.62);
        vec3 cyan = vec3(0.08, 0.72, 1.0);
        vec3 whitePsi = vec3(0.62, 0.94, 1.0);
        vec3 col = mix(violet, cyan, 0.6 + phaseB * 0.25);
        col = mix(col, whitePsi, filament * 0.48);
        float alpha = (
          fresnel * (0.009 + phaseA * 0.008)
          + filament * 0.035
          + axialFade * 0.004
        ) * uOpacity;
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });
}
