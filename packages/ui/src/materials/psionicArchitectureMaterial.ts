import * as THREE from 'three';
import type { CellVisualDescriptor } from '../derives/cellVisual.derive';

interface PsionicArchitectureOptions {
  opacity?: number;
  layer?: number;
  doubleSided?: boolean;
}

/** Dark architectural shell with restrained champagne-metal edges and psi light. */
export function makePsionicArchitectureMaterial(
  visual: CellVisualDescriptor,
  options: PsionicArchitectureOptions = {},
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
    depthWrite: false,
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
      uniform float uLayer;
      varying vec3 vBary;
      varying vec3 vNormal;
      varying vec3 vView;
      varying vec3 vLocal;

      float band(float value, float centre, float width) {
        return 1.0 - smoothstep(width * 0.35, width, abs(value - centre));
      }

      void main() {
        vec3 N = normalize(vNormal);
        vec3 V = normalize(vView);
        float ndv = abs(dot(N, V));
        float fresnel = pow(1.0 - ndv, 2.8);
        float baryMin = min(min(vBary.x, vBary.y), vBary.z);
        float edge = 1.0 - smoothstep(0.0, 0.052, baryMin);
        float light = 0.5 + 0.5 * dot(N, normalize(vec3(-0.42, 0.72, 0.55)));

        vec3 midnight = vec3(0.004, 0.011, 0.026);
        vec3 cobalt = vec3(0.015, 0.055, 0.09);
        vec3 champagne = vec3(0.78, 0.61, 0.3);
        vec3 ivory = vec3(0.88, 0.82, 0.56);
        vec3 psi = vec3(0.16, 0.82, 1.0);
        champagne = mix(champagne, uAccent, 0.035);

        float scanCoord = fract(
          vLocal.y * (4.0 + uSeed.y * 2.0)
          + uSeed.z
          - floor(uTime * 0.45 + uSeed.w * 5.0) * 0.055
        );
        float scan = band(scanCoord, 0.5, 0.045);
        float plateTone = 0.5 + 0.5 * sin(
          dot(vLocal, vec3(3.1, 5.3, 2.7)) + dot(uSeed, vec4(1.1, 1.7, 2.3, 2.9))
        );

        vec3 col = mix(midnight, cobalt, 0.18 + light * (0.68 + uLayer * 0.1));
        col += mix(champagne, ivory, plateTone) * light * (0.09 + uLayer * 0.045);
        col += champagne * edge * (0.46 + uLayer * 0.16);
        col += psi * fresnel * (0.42 + uLayer * 0.1);
        col += psi * scan * (0.09 + fresnel * 0.1);

        float alpha = 0.7 + fresnel * 0.2 + edge * 0.1 + scan * 0.03;
        gl_FragColor = vec4(col, min(1.0, alpha) * uOpacity);
      }
    `,
  });
}
