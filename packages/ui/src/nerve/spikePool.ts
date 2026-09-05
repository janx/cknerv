// Batched sprite pool for travelling consensus packets.
//
// A single Points mesh with N slots; each slot is an additive sprite with
// per-instance position, color, size, alpha, and "white-bias" (how much
// the sprite's core leans toward white-hot vs. its baseline tint). One
// shader serves both:
//
// The soft halo keeps motion readable at galaxy scale. Live traffic carries a
// four-point data lozenge; historical recall carries a segmented round phase
// knot, so remembered information cannot read as a fresh write — or a logo.
// One draw call carries both glyphs.
//
// Per-instance shader attributes:
//   aColor      — base sprite tint (RGB linear)
//   aSize       — world-units sphere radius (projected to pixels via depth)
//   aAlpha      — additive intensity multiplier
//   aWhiteBias  — [0, 1] core whiteness (0 = halo only, 1 = white core)
//   aGlyphMode  — 0 = live data lozenge, 1 = consensus-memory phase knot
//
// Geometry: positions are stored in the standard `position` attribute.
// Sprites are procedural screen-aligned glyphs — no texture lookup.

import * as THREE from 'three';

import type { Vec3 } from '../types';
import { SCENE_ACCENT_PALETTE } from '../visualPalette';

function streamAttribute(
  array: Float32Array,
  itemSize: number,
): THREE.BufferAttribute {
  return new THREE.BufferAttribute(array, itemSize)
    .setUsage(THREE.StreamDrawUsage);
}

function markWrittenRange(
  attribute: THREE.BufferAttribute,
  writtenCount: number,
): void {
  attribute.clearUpdateRanges();
  attribute.addUpdateRange(0, writtenCount * attribute.itemSize);
  attribute.needsUpdate = true;
}

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
  glyph: 'packet' | 'memory';
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
  private readonly glyphModes: Float32Array;
  private readonly dynamicAttributes: THREE.BufferAttribute[];
  private writtenCount = 0;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.positions = new Float32Array(capacity * 3);
    this.colors = new Float32Array(capacity * 3);
    this.sizes = new Float32Array(capacity);
    this.alphas = new Float32Array(capacity);
    this.whiteBias = new Float32Array(capacity);
    this.glyphModes = new Float32Array(capacity);

    const positionAttribute = streamAttribute(this.positions, 3);
    const colorAttribute = streamAttribute(this.colors, 3);
    const sizeAttribute = streamAttribute(this.sizes, 1);
    const alphaAttribute = streamAttribute(this.alphas, 1);
    const whiteBiasAttribute = streamAttribute(this.whiteBias, 1);
    const glyphModeAttribute = streamAttribute(this.glyphModes, 1);
    this.dynamicAttributes = [
      positionAttribute,
      colorAttribute,
      sizeAttribute,
      alphaAttribute,
      whiteBiasAttribute,
      glyphModeAttribute,
    ];

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', positionAttribute);
    this.geometry.setAttribute('aColor', colorAttribute);
    this.geometry.setAttribute('aSize', sizeAttribute);
    this.geometry.setAttribute('aAlpha', alphaAttribute);
    this.geometry.setAttribute('aWhiteBias', whiteBiasAttribute);
    this.geometry.setAttribute('aGlyphMode', glyphModeAttribute);
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
        attribute float aGlyphMode;

        uniform float uViewportHeight;
        uniform float uPixelRatio;

        varying vec3  vColor;
        varying float vAlpha;
        varying float vWhiteBias;
        varying float vGlyphMode;

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
          vGlyphMode  = aGlyphMode;
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;

        varying vec3  vColor;
        varying float vAlpha;
        varying float vWhiteBias;
        varying float vGlyphMode;

        void main() {
          if (vAlpha < 0.001) discard;
          vec2 uv = (gl_PointCoord - 0.5) * 2.0;
          float r = length(uv);
          if (r > 1.0) discard;

          // Live packet: a sharp four-point lozenge nested in a restrained
          // circular field. A fine inner contour keeps it legible through bloom.
          float diamondD = abs(uv.x) + abs(uv.y);
          float packetCore = pow(max(0.0, 1.0 - diamondD), 5.0);
          float packetContour = exp(-pow((diamondD - 0.43) / 0.075, 2.0))
            * (1.0 - smoothstep(0.62, 0.9, r));

          // Historical recall: a circular phase knot with interrupted rings.
          // It reads as sampled information/resonance, never as the live
          // lozenge and never as a second Cell body.
          float angle = atan(uv.y, uv.x);
          float phaseCore = pow(max(0.0, 1.0 - r / 0.28), 4.0) * 0.78;
          float phaseRingA = exp(-pow((r - 0.43) / 0.055, 2.0));
          float phaseRingB = exp(-pow((r - 0.72) / 0.038, 2.0));
          float phaseGateA = 0.18 + 0.82
            * smoothstep(0.18, 0.7, abs(sin(angle * 3.0 + 0.45)));
          float phaseGateB = 0.2 + 0.8
            * smoothstep(0.2, 0.74, abs(cos(angle * 4.0 - 0.3)));
          float phaseContour = (phaseRingA * phaseGateA
            + phaseRingB * phaseGateB * 0.68) * 1.35;

          float core = mix(packetCore, phaseCore, vGlyphMode);
          float contour = mix(packetContour, phaseContour, vGlyphMode);
          float halo = pow(max(0.0, 1.0 - r), 2.1) * 0.38;

          // Resolve toward the same pale consensus light as A's agreement
          // knots, while preserving the transaction colour around the contour.
          float whiteAmount = core * mix(vWhiteBias, 0.42, vGlyphMode);
          vec3 baseCol = mix(vColor, vec3(${SCENE_ACCENT_PALETTE.pale.join(', ')}), whiteAmount);

          float intensity = (core + contour * 0.42 + halo) * vAlpha;
          if (intensity < 0.005) discard;

          gl_FragColor = vec4(baseCol * intensity, intensity);
        }
      `,
    });

    this.mesh = new THREE.Points(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    // Hidden until a frame writes a sprite: an empty pool submits no
    // zero-count Points draw (endFrame re-shows it when writtenCount > 0).
    this.mesh.visible = false;
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
    return this.pushValues(
      slot.position[0],
      slot.position[1],
      slot.position[2],
      slot.color,
      slot.size,
      slot.alpha,
      slot.whiteBias,
      slot.glyph,
    );
  }

  /** Allocation-free hot-path form for callers that already hold sampled
   * coordinates in scratch buffers. */
  pushValues(
    x: number,
    y: number,
    z: number,
    color: Vec3,
    size: number,
    alpha: number,
    whiteBias: number,
    glyph: 'packet' | 'memory',
  ): boolean {
    if (this.writtenCount >= this.capacity) return false;
    const i = this.writtenCount;
    this.positions[i * 3 + 0] = x;
    this.positions[i * 3 + 1] = y;
    this.positions[i * 3 + 2] = z;
    this.colors[i * 3 + 0]    = color[0];
    this.colors[i * 3 + 1]    = color[1];
    this.colors[i * 3 + 2]    = color[2];
    this.sizes[i]             = size;
    this.alphas[i]            = alpha;
    this.whiteBias[i]         = whiteBias;
    this.glyphModes[i]        = glyph === 'memory' ? 1 : 0;
    this.writtenCount += 1;
    return true;
  }

  /** Finalize the draw range and upload only the slots written this frame. */
  endFrame(viewportHeight: number, pixelRatio: number): void {
    this.material.uniforms.uViewportHeight.value = viewportHeight;
    this.material.uniforms.uPixelRatio.value = pixelRatio;
    this.geometry.setDrawRange(0, this.writtenCount);
    this.mesh.visible = this.writtenCount > 0; // never a zero-count draw
    if (this.writtenCount === 0) return;
    for (const attribute of this.dynamicAttributes) {
      markWrittenRange(attribute, this.writtenCount);
    }
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
