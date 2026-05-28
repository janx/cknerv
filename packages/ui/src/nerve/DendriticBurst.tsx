// Dendritic burst — radial calcium-transient ring at a cell when a nerve
// pulse's depolarization band lands on it.
//
// Each burst is a billboarded ring sprite that expands outward from the
// target cell over ~0.6 s and fades, mimicking the dendritic arbor's
// post-synaptic Ca²⁺ wave seen in fluorescence imaging. Mounted inside
// the rotating cells-galaxy group so the ring rides with the canopy.
//
// The component owns a small Points pool (32 slots). NervePulses writes
// the most-recent arrival timestamp per target cell into a shared
// `arrivalRef: Map<cellId, sceneSeconds>`; this component drains the
// map each frame, allocates a slot per fresh entry, and lets the burst
// run its course.
//
// Distinct from `cellFlashRef` (which lights the cell's hybrid + halo
// briefly): the burst is a *spatial* ring around the cell, not a
// brightening of the cell itself. The two layers compose visually.

import { useEffect, useMemo, useRef } from 'react';
import { useSimFrame } from '../tweaks/useSimFrame';
import { simClock } from '../tweaks/simClock';
import * as THREE from 'three';

import { useCellGalaxy } from '../hooks/cellGalaxyContext';

const BURST_LIFETIME_S = 0.6;
const BURST_PEAK_RADIUS = 4.5;
const BURST_POOL_CAP = 64;

interface BurstSlot {
  cellId: number;
  firedAt: number;
  /** RGB tint for this burst (matches the source pulse's kind colour). */
  color: [number, number, number];
}

export interface DendriticBurstProps {
  /** Map cell.id → most-recent scene-seconds at which a pulse band
   *  arrived at this cell. Written by NervePulses each frame; this
   *  component diffs against `lastSeenRef` to detect fresh arrivals. */
  arrivalRef: React.RefObject<Map<number, { firedAt: number; color: [number, number, number] }>>;
}

export default function DendriticBurst({ arrivalRef }: DendriticBurstProps) {
  const cellsCache = useCellGalaxy();
  const meshRef = useRef<THREE.Points>(null);
  const slotsRef = useRef<BurstSlot[]>([]);
  const lastSeenRef = useRef<Map<number, number>>(new Map());

  const spriteTex = useMemo(() => {
    // Hollow ring sprite: bright thin annulus, transparent core,
    // soft outer fade. Drawn once into a 64×64 canvas.
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const cx = size / 2;
    const cy = size / 2;
    const img = ctx.createImageData(size, size);
    const data = img.data;
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const dx = x - cx;
        const dy = y - cy;
        const r = Math.hypot(dx, dy) / (size / 2);
        // Ring profile: 0 at r=0, peak at r=0.78, fade by r=1.
        const ringPeak = 0.78;
        const w = 0.16;
        const ring = Math.exp(-Math.pow((r - ringPeak) / w, 2));
        // Tail fade past 1.0 (clipped by canvas anyway).
        const a = Math.min(1, ring);
        const i = (y * size + x) * 4;
        data[i + 0] = 255;
        data[i + 1] = 255;
        data[i + 2] = 255;
        data[i + 3] = Math.floor(a * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, []);

  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(BURST_POOL_CAP * 3), 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(BURST_POOL_CAP * 3), 3));
    g.setAttribute('aAge', new THREE.BufferAttribute(new Float32Array(BURST_POOL_CAP), 1));
    g.setDrawRange(0, 0);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 200);
    return g;
  }, []);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uMap:           { value: spriteTex },
          uPeakRadius:    { value: BURST_PEAK_RADIUS },
          uViewportHeight:{ value: 1 },
          uPixelRatio:    { value: 1 },
        },
        transparent: true,
        depthWrite:  false,
        blending:    THREE.AdditiveBlending,
        toneMapped:  false,
        vertexShader: /* glsl */ `
          attribute vec3  aColor;
          attribute float aAge;     // [0, 1] burst lifetime parameter
          uniform float uPeakRadius;
          uniform float uViewportHeight;
          uniform float uPixelRatio;
          varying float vAge;
          varying vec3  vColor;
          void main() {
            vAge = aAge;
            vColor = aColor;
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_Position = projectionMatrix * mv;
            // Sprite size grows linearly with age. uPeakRadius is in
            // world units; convert to pixels via the standard
            // perspective-projection PointsMaterial trick.
            float radius = uPeakRadius * aAge;
            float pixelSize = radius * (uViewportHeight * 0.5) / -mv.z;
            gl_PointSize = max(2.0, pixelSize * 2.0 * uPixelRatio);
          }
        `,
        fragmentShader: /* glsl */ `
          precision highp float;
          uniform sampler2D uMap;
          varying float vAge;
          varying vec3  vColor;
          void main() {
            if (vAge <= 0.0 || vAge >= 1.0) discard;
            vec4 tex = texture2D(uMap, gl_PointCoord);
            // Bell envelope on age: ramp up fast, then taper.
            float env = sin(vAge * 3.14159);
            // Dimmer near birth so the ring "expands out of nothing"
            // rather than popping in at full size.
            float startup = smoothstep(0.0, 0.12, vAge);
            float a = tex.a * env * startup;
            if (a < 0.01) discard;
            gl_FragColor = vec4(vColor * a, a);
          }
        `,
      }),
    [spriteTex],
  );

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
      spriteTex.dispose();
    },
    [geometry, material, spriteTex],
  );

  useSimFrame((state) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const now = simClock.elapsedSec;

    // 1. Drain fresh arrivals from arrivalRef into our slot pool.
    const arrivalMap = arrivalRef.current;
    const lastSeen = lastSeenRef.current;
    if (arrivalMap) {
      for (const [cellId, entry] of arrivalMap) {
        const prev = lastSeen.get(cellId) ?? -1;
        if (entry.firedAt > prev) {
          lastSeen.set(cellId, entry.firedAt);
          // Only schedule if it's a fresh future arrival (or just-fired).
          if (entry.firedAt >= now - BURST_LIFETIME_S) {
            slotsRef.current.push({
              cellId,
              firedAt: entry.firedAt,
              color: entry.color,
            });
          }
        }
      }
    }
    // Cap pool: drop oldest if over capacity.
    if (slotsRef.current.length > BURST_POOL_CAP) {
      slotsRef.current = slotsRef.current.slice(-BURST_POOL_CAP);
    }
    // Evict expired.
    slotsRef.current = slotsRef.current.filter(
      (s) => now - s.firedAt < BURST_LIFETIME_S,
    );

    // 2. Write per-active-burst point attributes.
    const posArr = geometry.attributes.position.array as Float32Array;
    const colArr = geometry.attributes.aColor.array as Float32Array;
    const ageArr = geometry.attributes.aAge.array as Float32Array;
    const cellsMap = cellsCache.cells;
    let written = 0;
    for (const slot of slotsRef.current) {
      if (written >= BURST_POOL_CAP) break;
      const cell = cellsMap.get(slot.cellId);
      if (!cell) continue;
      const age = (now - slot.firedAt) / BURST_LIFETIME_S;
      if (age <= 0 || age >= 1) continue;
      posArr[written * 3 + 0] = cell.pos_seed[0];
      posArr[written * 3 + 1] = cell.pos_seed[1];
      posArr[written * 3 + 2] = cell.pos_seed[2];
      colArr[written * 3 + 0] = slot.color[0];
      colArr[written * 3 + 1] = slot.color[1];
      colArr[written * 3 + 2] = slot.color[2];
      ageArr[written] = age;
      written += 1;
    }
    geometry.setDrawRange(0, written);
    (geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (geometry.attributes.aColor as THREE.BufferAttribute).needsUpdate = true;
    (geometry.attributes.aAge as THREE.BufferAttribute).needsUpdate = true;

    material.uniforms.uViewportHeight.value = state.size.height;
    material.uniforms.uPixelRatio.value = state.viewport.dpr ?? 1;
  });

  return (
    <points
      ref={meshRef}
      geometry={geometry}
      material={material}
      frustumCulled={false}
      renderOrder={2}
    />
  );
}
