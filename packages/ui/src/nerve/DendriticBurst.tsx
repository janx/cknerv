// Consensus write seal — a protocol glyph stamped at a Cell when one real
// transaction packet reaches its output.
//
// Each seal is a procedural, billboarded double ring: counter-rotated arc
// breaks represent independent contributors; six agreement nodes close the
// result around an early central knot. It expands, then contracts into a quiet
// memory latch that shows the written information remains part of the field.
//
// The component owns a small Points pool (64 slots). The flow orchestrator writes
// the most-recent arrival timestamp per target cell into a shared
// `arrivalRef: Map<cellId, sceneSeconds>`; this component drains the
// map each frame, allocates a slot per fresh entry, and lets the burst
// run its course.
//
// Distinct from `cellFlashRef`: the seal records completed protocol work in
// space, while the Cell flash is only a brief energy response.

import { useEffect, useMemo, useRef } from 'react';
import { useSimFrame } from '../tweaks/useSimFrame';
import { useSimClock } from '../tweaks/SimClockScope';
import * as THREE from 'three';

import { useCellGalaxy } from '../hooks/cellGalaxyContext';
import {
  CONSENSUS_WRITE_SEAL_LIFETIME_S,
  consensusWriteSealState,
} from '../derives/consensusFlow.derive';

const BURST_PEAK_RADIUS = 1.9;
const BURST_POOL_CAP = 64;

interface BurstSlot {
  cellId: number;
  firedAt: number;
  /** RGB identity shared with the source packet and traversed route. */
  color: [number, number, number];
}

export interface ConsensusWriteSealProps {
  /** Map cell.id → most-recent scene-seconds at which a packet
   *  arrived at this Cell. Written by the flow orchestrator each frame; this
   *  component diffs against `lastSeenRef` to detect fresh arrivals. */
  arrivalRef: React.RefObject<Map<number, { firedAt: number; color: [number, number, number] }>>;
}

/** Legacy public type kept while consumers move to ConsensusWriteSeal. */
export type DendriticBurstProps = ConsensusWriteSealProps;

export default function ConsensusWriteSeal({ arrivalRef }: ConsensusWriteSealProps) {
  const simClock = useSimClock();
  const cellsCache = useCellGalaxy();
  const meshRef = useRef<THREE.Points>(null);
  const slotsRef = useRef<BurstSlot[]>([]);
  const lastSeenRef = useRef<Map<number, number>>(new Map());

  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(BURST_POOL_CAP * 3), 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(BURST_POOL_CAP * 3), 3));
    g.setAttribute('aRadius', new THREE.BufferAttribute(new Float32Array(BURST_POOL_CAP), 1));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(BURST_POOL_CAP), 1));
    g.setAttribute('aCore', new THREE.BufferAttribute(new Float32Array(BURST_POOL_CAP), 1));
    g.setAttribute('aSpin', new THREE.BufferAttribute(new Float32Array(BURST_POOL_CAP), 1));
    g.setAttribute('aMemory', new THREE.BufferAttribute(new Float32Array(BURST_POOL_CAP), 1));
    g.setDrawRange(0, 0);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 200);
    return g;
  }, []);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
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
          attribute float aRadius;
          attribute float aAlpha;
          attribute float aCore;
          attribute float aSpin;
          attribute float aMemory;
          uniform float uPeakRadius;
          uniform float uViewportHeight;
          uniform float uPixelRatio;
          varying float vAlpha;
          varying float vCore;
          varying float vSpin;
          varying float vMemory;
          varying vec3  vColor;
          void main() {
            vAlpha = aAlpha;
            vCore = aCore;
            vSpin = aSpin;
            vMemory = aMemory;
            vColor = aColor;
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_Position = projectionMatrix * mv;
            // Pure CPU lifecycle supplies an eased radius in [0, 1].
            float radius = uPeakRadius * aRadius;
            float pixelSize = radius * (uViewportHeight * 0.5) / -mv.z;
            float memoryFloorPx = 18.0 * vMemory * uPixelRatio;
            gl_PointSize = max(2.0, max(pixelSize * 2.0 * uPixelRatio, memoryFloorPx));
          }
        `,
        fragmentShader: /* glsl */ `
          precision highp float;
          varying float vAlpha;
          varying float vCore;
          varying float vSpin;
          varying float vMemory;
          varying vec3  vColor;
          void main() {
            if (vAlpha <= 0.001) discard;
            vec2 p = (gl_PointCoord - 0.5) * 2.0;
            float r = length(p);
            if (r > 1.0) discard;
            float theta = atan(p.y, p.x);

            // Two interrupted contributor rings rotate against one another.
            float outerGate = smoothstep(0.18, 0.48,
              abs(sin((theta + vSpin) * 3.0)));
            float innerGate = smoothstep(0.16, 0.44,
              abs(sin((theta - vSpin * 0.72) * 3.0 + 1.05)));
            float outerWidth = mix(0.035, 0.065, vMemory);
            float innerWidth = mix(0.028, 0.052, vMemory);
            float outer = exp(-pow((r - 0.78) / outerWidth, 2.0)) * outerGate;
            float inner = exp(-pow((r - 0.57) / innerWidth, 2.0)) * innerGate * 0.62;

            // Six compact agreement nodes bridge the two contributor rings.
            // Their tangential footprint avoids the visual grammar of a
            // cardinal targeting reticle.
            float agreementAngle = exp(-pow(abs(sin((theta + 0.37) * 3.0)) / 0.075, 2.0));
            float agreementBand = exp(-pow((r - 0.68) / 0.045, 2.0));
            float agreements = agreementAngle * agreementBand * 0.92;

            // The central knot announces write completion, then returns at a
            // lower intensity inside the contracted memory latch.
            float diamond = 1.0 - smoothstep(0.07, 0.15, abs(p.x) + abs(p.y));
            float knot = diamond * vCore;
            float halo = exp(-pow((r - 0.70) / 0.17, 2.0)) * 0.07;
            float glyph = outer + inner + agreements + knot + halo;
            float intensity = min(1.35, glyph) * vAlpha;
            if (intensity < 0.008) discard;

            vec3 pale = vec3(0.72, 0.96, 1.0);
            // Agreement nodes and the early knot resolve locally; once the
            // write contracts into persistent memory, the full seal becomes
            // pale consensus light rather than retaining the moving gold hue.
            float paleMix = clamp(
              inner * 0.35 + agreements * 0.55 + knot + vMemory * 0.72,
              0.0,
              1.0
            );
            vec3 color = mix(vColor, pale, paleMix);
            gl_FragColor = vec4(color * intensity, intensity);
          }
        `,
      }),
    [],
  );

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
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
          if (entry.firedAt >= now - CONSENSUS_WRITE_SEAL_LIFETIME_S) {
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
      (s) => now - s.firedAt < CONSENSUS_WRITE_SEAL_LIFETIME_S,
    );

    // 2. Write per-active-seal point attributes.
    const posArr = geometry.attributes.position.array as Float32Array;
    const colArr = geometry.attributes.aColor.array as Float32Array;
    const radiusArr = geometry.attributes.aRadius.array as Float32Array;
    const alphaArr = geometry.attributes.aAlpha.array as Float32Array;
    const coreArr = geometry.attributes.aCore.array as Float32Array;
    const spinArr = geometry.attributes.aSpin.array as Float32Array;
    const memoryArr = geometry.attributes.aMemory.array as Float32Array;
    const cellsMap = cellsCache.cells;
    let written = 0;
    for (const slot of slotsRef.current) {
      if (written >= BURST_POOL_CAP) break;
      const cell = cellsMap.get(slot.cellId);
      if (!cell) continue;
      const ageS = now - slot.firedAt;
      const seal = consensusWriteSealState(ageS);
      if (!seal.visible) continue;
      posArr[written * 3 + 0] = cell.pos_seed[0];
      posArr[written * 3 + 1] = cell.pos_seed[1];
      posArr[written * 3 + 2] = cell.pos_seed[2];
      colArr[written * 3 + 0] = slot.color[0];
      colArr[written * 3 + 1] = slot.color[1];
      colArr[written * 3 + 2] = slot.color[2];
      radiusArr[written] = seal.radius;
      alphaArr[written] = seal.opacity;
      coreArr[written] = seal.core;
      const cellPhase = ((slot.cellId % 4096) * 0.61803398875 % 1) * Math.PI * 2;
      spinArr[written] = seal.rotation + cellPhase;
      memoryArr[written] = seal.memory;
      written += 1;
    }
    geometry.setDrawRange(0, written);
    (geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (geometry.attributes.aColor as THREE.BufferAttribute).needsUpdate = true;
    (geometry.attributes.aRadius as THREE.BufferAttribute).needsUpdate = true;
    (geometry.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true;
    (geometry.attributes.aCore as THREE.BufferAttribute).needsUpdate = true;
    (geometry.attributes.aSpin as THREE.BufferAttribute).needsUpdate = true;
    (geometry.attributes.aMemory as THREE.BufferAttribute).needsUpdate = true;

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
