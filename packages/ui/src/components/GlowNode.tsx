// The halo look the scene's node layers share. The `GlowNode` component this
// grew out of is gone — CellGalaxy and ColonyNodes draw their own instanced
// geometry and reach in here only for the halo material and the per-id
// phase/rate hashes that keep their breathing out of lockstep.

import * as THREE from 'three';

export interface Palette {
  /** Wireframe + halo tint. */
  edge: string;
  halo: string;
  /** Faint translucent fill for the solid faces — kept very low alpha so
   *  the wireframe edges dominate and the form reads as a clean shape. */
  fill: string;
}

export function makeHaloMaterial(palette: Palette): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uPhase: { value: 0 },
      uIntensity: { value: 1 },
      uColor: { value: new THREE.Color(palette.halo) },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      uniform float uTime;
      uniform float uPhase;
      uniform float uIntensity;
      uniform vec3 uColor;
      void main() {
        vec2 uv = vUv - 0.5;
        float r = length(uv) * 2.0;
        if (r > 1.0) discard;
        // Tight bright core + soft halo trailing out to the edge.
        float core = pow(1.0 - r, 4.0);
        float halo = pow(1.0 - r, 1.6) * 0.42;
        float breathe = 0.78 + 0.22 * sin(uTime * 1.2 + uPhase);
        float a = (core + halo) * uIntensity * breathe;
        gl_FragColor = vec4(uColor * a, a);
      }
    `,
  });
}

export function phaseFor(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) {
    h = (h * 31 + id.charCodeAt(i)) >>> 0;
  }
  return ((h % 1000) / 1000) * Math.PI * 2;
}

export function rateFor(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) {
    h = (h * 17 + id.charCodeAt(i)) >>> 0;
  }
  return (h % 1000) / 1000;
}
