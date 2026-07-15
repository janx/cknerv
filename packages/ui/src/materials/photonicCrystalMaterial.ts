import * as THREE from 'three';
import type { CellVisualDescriptor } from '../derives/cellVisual.derive';

interface PhotonicCrystalOptions {
  opacity?: number;
  layer?: number;
  doubleSided?: boolean;
  depthWrite?: boolean;
}

/**
 * Obsidian/iridescent crystal material for the selected Cell's sculptural seed.
 * It is deliberately textureless: facet light, thin-film color and quiet scan
 * planes are generated from stable Cell attributes in one small shader.
 */
export function makePhotonicCrystalMaterial(
  visual: CellVisualDescriptor,
  options: PhotonicCrystalOptions = {},
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSeed: { value: new THREE.Vector4(...visual.seeds) },
      uAccent: { value: new THREE.Color(...visual.accent) },
      uOpacity: { value: options.opacity ?? 0.9 },
      uLayer: { value: options.layer ?? 0 },
    },
    transparent: true,
    depthWrite: options.depthWrite ?? true,
    depthTest: true,
    side: options.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
    blending: THREE.NormalBlending,
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
      uniform float uLayer;
      varying vec3 vBary;
      varying vec3 vNormal;
      varying vec3 vView;
      varying vec3 vLocal;

      float lineBand(float value, float centre, float width) {
        return 1.0 - smoothstep(width * 0.35, width, abs(value - centre));
      }

      void main() {
        vec3 N = normalize(vNormal);
        vec3 V = normalize(vView);
        float ndv = abs(dot(N, V));
        float fresnel = pow(1.0 - ndv, 2.6);
        float baryMin = min(min(vBary.x, vBary.y), vBary.z);
        float facet = 1.0 - smoothstep(0.0, 0.045, baryMin);

        // A constrained thin-film palette: ice cyan → ultraviolet, without a
        // full rainbow or warm metallic body tint.
        float phase = fresnel * 4.8
          + dot(normalize(vLocal + 0.0001), vec3(1.7, 2.3, 3.1))
          + dot(uSeed, vec4(1.0, 1.6, 2.2, 2.8));
        float interference = 0.5 + 0.5 * cos(phase * 2.2);
        vec3 ice = vec3(0.22, 0.86, 1.0);
        vec3 violet = vec3(0.56, 0.35, 1.0);
        vec3 film = mix(violet, ice, interference);
        film = mix(film, uAccent, 0.055);

        float faceLight = 0.5 + 0.5 * dot(N, normalize(vec3(-0.32, 0.74, 0.58)));
        float scanCoord = fract(
          vLocal.y * (3.5 + uSeed.y * 2.0)
          + uSeed.z
          - floor(uTime * 0.65 + uSeed.w * 5.0) * 0.07
        );
        float scan = lineBand(scanCoord, 0.5, 0.055) * (0.35 + 0.65 * fresnel);

        vec3 obsidian = mix(
          vec3(0.004, 0.012, 0.03),
          vec3(0.016, 0.062, 0.105),
          faceLight
        );
        obsidian *= 1.0 + uLayer * 0.55;
        vec3 col = obsidian;
        col += film * faceLight * (0.055 + uLayer * 0.04);
        col += film * (fresnel * (0.62 + uLayer * 0.2));
        col += film * facet * (0.34 + uLayer * 0.24);
        col += mix(ice, vec3(0.82, 0.92, 1.0), 0.5) * scan * 0.16;

        float alpha = 0.66
          + fresnel * 0.25
          + facet * 0.11
          + scan * 0.06;
        alpha = min(1.0, alpha) * uOpacity;
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });
}
