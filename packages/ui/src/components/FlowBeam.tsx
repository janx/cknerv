import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useSimFrame } from '../tweaks/useSimFrame';
import { simClock } from '../tweaks/simClock';
import { bezierControl } from '../geometry/edgeBezier';
import type { Vec3 } from '../types';

export interface FlowStyle {
  /** World-space size of each particle sprite. */
  particleSize: number;
  /** Particle count per belt (≈ density). */
  count: number;
  /** Drift speed in lengths/sec; sign chooses the baseline direction. */
  speed: number;
  /** Max perpendicular jitter (belt width), world units. */
  jitter: number;
  /** Base per-particle brightness multiplier. */
  intensity: number;
}

interface FlowBeamProps {
  from: Vec3;
  to: Vec3;
  /** Color for forward-drifting particles (those that emerge from `from`). */
  colorSource: THREE.Color;
  /** Color for backward-drifting particles (those that emerge from `to`). */
  colorTarget: THREE.Color;
  style: FlowStyle;
  /** Deterministic Bezier-control seed — same edge curves the same way. */
  seed: number;
  /** Twinkle phase offset so belts don't pulse in lockstep. */
  phase?: number;
  /** Per-frame overall intensity multiplier (churn fade + block surge). Read
   *  every frame so the parent animates without React re-renders. Default 1. */
  intensityRef?: React.MutableRefObject<number>;
}

/** Soft radial sprite shared by every belt; built lazily so importing this
 *  module from a jsdom test (canvas 2d stubbed) doesn't trip on a real ctx.
 *  Module-level + cached → never disposed (lives for the app lifetime). */
let cachedSpriteTexture: THREE.Texture | null = null;
function getSpriteTexture(): THREE.Texture {
  if (cachedSpriteTexture) return cachedSpriteTexture;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(
    size / 2, size / 2, 0, size / 2, size / 2, size / 2,
  );
  grad.addColorStop(0.0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.6)');
  grad.addColorStop(0.8, 'rgba(255,255,255,0.12)');
  grad.addColorStop(1.0, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  cachedSpriteTexture = tex;
  return tex;
}

/**
 * One bidirectional particle belt drifting along a curved quadratic Bezier
 * from `from` to `to`: half the particles flow forward (source color), half
 * backward (target color), each with a random offset, perpendicular jitter,
 * and a twinkle phase. Reads as continuous data-packet exchange rather than a
 * static line. Ported from ckb-rcg's FlowEdge with a per-frame `intensityRef`.
 */
export default function FlowBeam({
  from,
  to,
  colorSource,
  colorTarget,
  style,
  seed,
  phase = 0,
  intensityRef,
}: FlowBeamProps) {
  const pointsRef = useRef<THREE.Points>(null);
  const fallbackIntensity = useRef(1);

  // Deterministic Bezier control point — particles drift along the curve.
  const ctrl = useMemo(
    () => bezierControl(from[0], from[1], from[2], to[0], to[1], to[2], seed),
    [from, to, seed],
  );

  // Per-particle params generated once; only positions + colors rewrite/frame.
  const { geometry, ts, dirSigns, jitters, baseAlphas, shimmerPhases } = useMemo(() => {
    const N = style.count;
    const positions = new Float32Array(N * 3);
    const colors = new Float32Array(N * 3);
    const ts = new Float32Array(N);
    const dirSigns = new Float32Array(N);
    const jitters = new Float32Array(N * 3);
    const baseAlphas = new Float32Array(N);
    const shimmerPhases = new Float32Array(N);
    for (let i = 0; i < N; i += 1) {
      ts[i] = Math.random();
      // Half drift forward, half backward — bidirectional exchange.
      dirSigns[i] = i < N / 2 ? 1 : -1;
      jitters[i * 3 + 0] = (Math.random() - 0.5) * 2 * style.jitter;
      jitters[i * 3 + 1] = (Math.random() - 0.5) * 2 * style.jitter;
      jitters[i * 3 + 2] = (Math.random() - 0.5) * 2 * style.jitter;
      baseAlphas[i] = 0.35 + Math.random() * 0.65;
      shimmerPhases[i] = Math.random() * Math.PI * 2;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return { geometry: g, ts, dirSigns, jitters, baseAlphas, shimmerPhases };
  }, [style.count, style.jitter]);

  const material = useMemo(
    () =>
      new THREE.PointsMaterial({
        map: getSpriteTexture(),
        size: style.particleSize,
        sizeAttenuation: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
        vertexColors: true,
      }),
    [style.particleSize],
  );

  // Dispose the per-belt geometry + material on unmount (the shared sprite
  // texture is intentionally never disposed). three.js dispose() is idempotent,
  // so this is safe even if r3f also disposes the props-assigned objects.
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  useSimFrame(() => {
    const points = pointsRef.current;
    if (!points) return;
    const k = (intensityRef ?? fallbackIntensity).current;
    const t = simClock.elapsedSec;
    const drift = t * style.speed;
    const posAttr = geometry.attributes.position.array as Float32Array;
    const colAttr = geometry.attributes.color.array as Float32Array;
    const fx = from[0], fy = from[1], fz = from[2];
    const tx = to[0], ty = to[1], tz = to[2];
    const cx = ctrl[0], cy = ctrl[1], cz = ctrl[2];
    const N = ts.length;
    for (let i = 0; i < N; i += 1) {
      // Drift along the curve, wrapping at 1; direction sign per particle.
      let local = ts[i] + drift * dirSigns[i];
      local -= Math.floor(local);
      // Inlined quadratic Bezier B(local) to skip per-particle allocation.
      const u = 1 - local;
      const u2 = u * u;
      const ut2 = 2 * u * local;
      const t2 = local * local;
      posAttr[i * 3 + 0] = u2 * fx + ut2 * cx + t2 * tx + jitters[i * 3 + 0];
      posAttr[i * 3 + 1] = u2 * fy + ut2 * cy + t2 * ty + jitters[i * 3 + 1];
      posAttr[i * 3 + 2] = u2 * fz + ut2 * cz + t2 * tz + jitters[i * 3 + 2];
      // Twinkle: squared sin amplifies bright peaks / dim valleys.
      const s = Math.sin(t * 1.6 + shimmerPhases[i] + phase);
      const shimmer = s * s * 0.85 + 0.15;
      const a = baseAlphas[i] * shimmer * style.intensity * k;
      const c = dirSigns[i] === 1 ? colorSource : colorTarget;
      colAttr[i * 3 + 0] = c.r * a;
      colAttr[i * 3 + 1] = c.g * a;
      colAttr[i * 3 + 2] = c.b * a;
    }
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.color.needsUpdate = true;
  });

  return <points ref={pointsRef} geometry={geometry} material={material} />;
}
