// The halo look the scene's node layers share. The `GlowNode` component this
// grew out of is gone — CellGalaxy and ColonyNodes draw their own instanced
// geometry and reach in here only for the halo material and the per-id
// phase/rate hashes that keep their breathing out of lockstep.

import * as THREE from 'three';
import {
  makeCompressionUniforms,
  PEER_COMPRESSION_GLSL,
} from '../materials/peerNodeMaterial';
import { PEER_LAUNCH_SENTINEL } from '../derives/peers.derive';

export interface Palette {
  /** Wireframe + halo tint. */
  edge: string;
  halo: string;
  /** Faint translucent fill for the solid faces — kept very low alpha so
   *  the wireframe edges dominate and the form reads as a clean shape. */
  fill: string;
}

/**
 * The anchor's halo. It also holds the breath: over the charge window before
 * the anchor's own delivery hop leaves (`uLaunchAt`, the block's local
 * receive instant) the quad draws in and its light concentrates, and both
 * let go over the release after — the same envelope every measured peer's
 * halo runs (`PEER_COMPRESSION_GLSL`), so the hero differs from a peer in
 * scale and reach and never in shape. A caller that schedules no launch
 * leaves the sentinel in place and the envelope is exactly 0.
 */
export function makeHaloMaterial(palette: Palette): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uPhase: { value: 0 },
      uIntensity: { value: 1 },
      uColor: { value: new THREE.Color(palette.halo) },
      uLaunchAt: { value: PEER_LAUNCH_SENTINEL },
      ...makeCompressionUniforms(),
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying float vHeld;
      uniform float uTime;
      uniform float uLaunchAt;
      uniform float uCompressDepth;
      ${PEER_COMPRESSION_GLSL}
      void main() {
        vUv = uv;
        // The held breath: the extent draws in toward the launch, lets go after.
        float held = peerCompressionGl(uTime - uLaunchAt);
        vHeld = held;
        vec3 drawn = position * (1.0 - uCompressDepth * held);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(drawn, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      varying float vHeld;
      uniform float uTime;
      uniform float uPhase;
      uniform float uIntensity;
      uniform float uCompressGain;
      uniform vec3 uColor;
      void main() {
        vec2 uv = vUv - 0.5;
        float r = length(uv) * 2.0;
        if (r > 1.0) discard;
        // Tight bright core + soft halo trailing out to the edge.
        float core = pow(1.0 - r, 4.0);
        float halo = pow(1.0 - r, 1.6) * 0.42;
        float breathe = 0.78 + 0.22 * sin(uTime * 1.2 + uPhase);
        // …concentrated by the held breath, short of conservation.
        float a = (core + halo) * uIntensity * breathe * (1.0 + uCompressGain * vHeld);
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
