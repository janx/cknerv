// L2 + L3 — Sprite pool for action potentials and synaptic boutons.
//
// A single Points mesh with N slots; each slot is an additive sprite with
// per-instance position, color, size, alpha, and "white-bias" (how much
// the sprite's core leans toward white-hot vs. its baseline tint). One
// shader serves both:
//
//   • Action potential (L2): a moving sprite that walks along an axon
//     trail. High whiteBias for the bright Na+ surge core, large size,
//     short-lived per spike.
//   • Synaptic bouton (L3): a stationary sprite at axon endpoints.
//     Low whiteBias (just the colored halo, no white-hot core),
//     smaller size, persists for the axon's life with a brief
//     post-arrival brightening.
//   • Saltatory leap node (miner pulse): like an action potential
//     but multiple per pulse, each with its own offset arrival time.
//
// Per-instance shader attributes:
//   aColor      — base sprite tint (RGB linear)
//   aSize       — world-units sphere radius (projected to pixels via depth)
//   aAlpha      — additive intensity multiplier
//   aWhiteBias  — [0, 1] core whiteness (0 = halo only, 1 = white core)
//
// Geometry: positions are stored in the standard `position` attribute
// since this is a Points mesh. Sprites are screen-aligned circular
// gradients drawn entirely in the fragment shader — no texture lookup.

import * as THREE from 'three';

import type { Vec3 } from '../types';

export interface SpikeSlotWrite {
  position: Vec3;
  color: Vec3;
  /** World-units radius. Projected to pixels via 1/depth in the
   *  vertex shader. Typical: 0.6 (bouton) → 1.6 (peak action potential). */
  size: number;
  /** [0, 1] additive multiplier. */
  alpha: number;
  /** [0, 1] white-core mixing factor. 0 = colored halo only,
   *  1 = bright white core. */
  whiteBias: number;
}

/**
 * Imperative Points-based sprite pool. Single mesh, single draw call.
 */
export class SpikePool {
  readonly capacity: number;
  readonly mesh: THREE.Points;
  readonly material: THREE.ShaderMaterial;
  private readonly geometry: THREE.BufferGeometry;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly sizes: Float32Array;
  private readonly alphas: Float32Array;
  private readonly whiteBias: Float32Array;
  private writtenCount = 0;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.positions = new Float32Array(capacity * 3);
    this.colors = new Float32Array(capacity * 3);
    this.sizes = new Float32Array(capacity);
    this.alphas = new Float32Array(capacity);
    this.whiteBias = new Float32Array(capacity);

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('aColor', new THREE.BufferAttribute(this.colors, 3));
    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1));
    this.geometry.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphas, 1));
    this.geometry.setAttribute('aWhiteBias', new THREE.BufferAttribute(this.whiteBias, 1));
    this.geometry.setDrawRange(0, 0);
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 500);

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uViewportHeight: { value: 1 },
        uPixelRatio:     { value: 1 },
      },
      transparent: true,
      depthWrite:  false,
      blending:    THREE.AdditiveBlending,
      toneMapped:  false,
      vertexShader: /* glsl */ `
        attribute vec3  aColor;
        attribute float aSize;
        attribute float aAlpha;
        attribute float aWhiteBias;

        uniform float uViewportHeight;
        uniform float uPixelRatio;

        varying vec3  vColor;
        varying float vAlpha;
        varying float vWhiteBias;

        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          // Project a world-units sphere of radius aSize into pixels.
          // Standard perspective formula: pixelRadius = worldRadius * (h/2) / -mv.z
          float pixelRadius = aSize * (uViewportHeight * 0.5) / max(0.01, -mv.z);
          // Sprite spans 2 × radius; multiply by DPR so points stay
          // crisp on HiDPI. Floor at 2 px so far-away sprites remain
          // visible rather than shrinking to nothing.
          gl_PointSize = max(2.0, pixelRadius * 2.0 * uPixelRatio);

          vColor      = aColor;
          vAlpha      = aAlpha;
          vWhiteBias  = aWhiteBias;
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;

        varying vec3  vColor;
        varying float vAlpha;
        varying float vWhiteBias;

        void main() {
          if (vAlpha < 0.001) discard;
          vec2 uv = gl_PointCoord - 0.5;
          float r = length(uv) * 2.0;
          if (r > 1.0) discard;

          // Bright tight core + softer outer halo.
          float core = pow(1.0 - r, 7.0);
          float halo = pow(1.0 - r, 1.6) * 0.55;

          // Mix toward white in the core region — only when whiteBias > 0.
          // Action-potential sprites have whiteBias~1 (visible Na+ surge);
          // boutons have whiteBias~0 (colored halo, no white-hot center).
          float whiteAmount = core * vWhiteBias;
          vec3 baseCol = mix(vColor, vec3(1.0), whiteAmount);

          float intensity = (core + halo) * vAlpha;
          if (intensity < 0.005) discard;

          gl_FragColor = vec4(baseCol * intensity, intensity);
        }
      `,
    });

    this.mesh = new THREE.Points(this.geometry, this.material);
    this.mesh.frustumCulled = false;
  }

  /** Reset the write cursor at the start of each frame. */
  beginFrame(): void {
    this.writtenCount = 0;
  }

  /**
   * Append one active sprite. Returns true if accepted, false if the
   * pool is full. Caller should iterate active sprites in priority
   * order (newest / brightest first) so overflow drops the least
   * important.
   */
  push(slot: SpikeSlotWrite): boolean {
    if (this.writtenCount >= this.capacity) return false;
    const i = this.writtenCount;
    this.positions[i * 3 + 0] = slot.position[0];
    this.positions[i * 3 + 1] = slot.position[1];
    this.positions[i * 3 + 2] = slot.position[2];
    this.colors[i * 3 + 0]    = slot.color[0];
    this.colors[i * 3 + 1]    = slot.color[1];
    this.colors[i * 3 + 2]    = slot.color[2];
    this.sizes[i]             = slot.size;
    this.alphas[i]            = slot.alpha;
    this.whiteBias[i]         = slot.whiteBias;
    this.writtenCount += 1;
    return true;
  }

  /** Mark dirty + finalize draw range. */
  endFrame(viewportHeight: number, pixelRatio: number): void {
    this.material.uniforms.uViewportHeight.value = viewportHeight;
    this.material.uniforms.uPixelRatio.value = pixelRatio;
    this.geometry.setDrawRange(0, this.writtenCount);
    (this.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('aColor') as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('aSize') as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('aAlpha') as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('aWhiteBias') as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
