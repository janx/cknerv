// CellNucleusPortrait — the cell-detail hero: a dedicated <Canvas> (its own
// WebGL context, alive only while a cell is selected) rendering the DATA-DRIVEN
// SPECIMEN built from specimenMorphology(cell): warm structure (line segments +
// nucleus nodes) + green data organelles, slowly rotating, dimming as the cell
// dies. Galaxy untouched. The marker probe walks the anatomical landmarks: each
// frame it derives the probe state (probeScan, keyed off the shared scanEpochMs),
// projects the active landmark to 2D for the DOM overlay (probeRef, read in
// Task 11), and flares the nearest node (+ a body ring on the 'body' landmark).
import { useEffect, useMemo, useRef, type MutableRefObject } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Cell } from '@cknerv/types';
import { specimenMorphology, LANDMARK_FIELDS } from '../../derives/specimenMorphology';
import type { Vec3 } from '../../derives/specimenKit';
import { probeScan, type ProbeState } from './probeScan';
import { makeNucleusPointMaterial } from '../../materials/cellNucleusMaterial';
import { makeOrganelleMaterial } from '../../materials/organelleMaterial';

const ROT_RAD_PER_S = 0.28;
export const SCAN_PERIOD_S = 4.2;   // shared with CellDetailPanel scan chrome

// --- probe highlight tuning (restrained; live-tune knobs) ---
const FLARE_SIZE_GAIN = 1.6;    // nearest-node size multiplier at full lock
const FLARE_ALPHA_GAIN = 0.4;   // nearest-node alpha boost at full lock
const BODY_RING_INNER = 0.82;   // body-landmark ring, in framed-unit radius
const BODY_RING_OUTER = 0.9;
const BODY_RING_OPACITY = 0.5;  // ring peak opacity at full lock

// probeRef payload: the active landmark projected to screen space, read each
// frame by the Task-11 DOM overlay (marker + readout). Screen px, origin top-left.
export interface ProbeScreen { x: number; y: number; visible: boolean; index: number; lockT: number; traveling: boolean }

// reused scratch — never allocate a THREE temp inside useFrame (alloc-churn lesson)
const _projV = new THREE.Vector3();

function buildPoints(nodes: { x: number; y: number; z: number; s: number; a: number }[]) {
  const g = new THREE.BufferGeometry(); const c = nodes.length;
  const pos = new Float32Array(c * 3), size = new Float32Array(c), alpha = new Float32Array(c);
  nodes.forEach((n, i) => { pos[i * 3] = n.x; pos[i * 3 + 1] = n.y; pos[i * 3 + 2] = n.z; size[i] = n.s * 2.0; alpha[i] = n.a; });
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  g.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  return g;
}

function SpecimenScene({ cell, reducedMotion, scanEpochMs, probeRef }: {
  cell: Cell; reducedMotion: boolean; scanEpochMs: number; probeRef?: MutableRefObject<ProbeScreen>;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const built = useMemo(() => {
    const m = specimenMorphology(cell);
    const lineGeom = new THREE.BufferGeometry();
    const lp = new Float32Array(m.segments.length);
    for (let i = 0; i < m.segments.length; i++) lp[i] = m.segments[i];
    lineGeom.setAttribute('position', new THREE.BufferAttribute(lp, 3));
    const tint = m.viability < 1 ? new THREE.Color(0.6, 0.65, 0.7) : new THREE.Color(m.tint[0], m.tint[1], m.tint[2]);
    const lineMat = new THREE.LineBasicMaterial({ color: tint, transparent: true, opacity: 0.5 * (0.5 + 0.5 * m.viability), blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const nodeGeom = buildPoints(m.nodes), orgGeom = buildPoints(m.organelles);
    const nodeMat = makeNucleusPointMaterial(0.4); nodeMat.uniforms.uWarmth.value = 1;
    const orgMat = makeOrganelleMaterial();
    // probe highlight: retain the node aSize/aAlpha base so each frame writes
    // fresh-from-base (never accumulates); a body ring lights on the 'body' landmark.
    const nodeSizeAttr = nodeGeom.getAttribute('aSize') as THREE.BufferAttribute;
    const nodeAlphaAttr = nodeGeom.getAttribute('aAlpha') as THREE.BufferAttribute;
    const nodeBaseSize = Float32Array.from(nodeSizeAttr.array as Float32Array);
    const nodeBaseAlpha = Float32Array.from(nodeAlphaAttr.array as Float32Array);
    const ringGeom = new THREE.RingGeometry(BODY_RING_INNER, BODY_RING_OUTER, 64);
    const ringMat = new THREE.MeshBasicMaterial({ color: tint, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    return { m, lineGeom, lineMat, nodeGeom, nodeMat, orgGeom, orgMat, nodeSizeAttr, nodeAlphaAttr, nodeBaseSize, nodeBaseAlpha, ringGeom, ringMat };
  }, [cell]);

  // ordered PRESENT landmarks (organelle may be absent) + each one's nearest node.
  // Landmarks/nodes are frozen local coords (memoized per cell) → nearest is static.
  const probe = useMemo(() => {
    const L = built.m.landmarks;
    const order = LANDMARK_FIELDS
      .map((f) => ({ field: f, pos: L[f] }))
      .filter((e): e is { field: (typeof LANDMARK_FIELDS)[number]; pos: Vec3 } => e.pos !== null);
    const nodes = built.m.nodes;
    const nearest = order.map((e) => {
      let best = -1, bd = Infinity;
      for (let i = 0; i < nodes.length; i++) {
        const dx = nodes[i].x - e.pos[0], dy = nodes[i].y - e.pos[1], dz = nodes[i].z - e.pos[2];
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bd) { bd = d; best = i; }
      }
      return best;
    });
    return { order, nearest };
  }, [built]);

  useEffect(() => () => {
    built.lineGeom.dispose(); built.lineMat.dispose(); built.nodeGeom.dispose();
    built.nodeMat.dispose(); built.orgGeom.dispose(); built.orgMat.dispose();
    built.ringGeom.dispose(); built.ringMat.dispose();
  }, [built]);

  useFrame((state) => {
    const vh = state.size.height, p11 = state.camera.projectionMatrix.elements[5];
    for (const mat of [built.nodeMat, built.orgMat]) { mat.uniforms.uViewportHeight.value = vh; mat.uniforms.uProjY.value = p11; }
    const g = groupRef.current;
    if (g && !reducedMotion) g.rotation.y = state.clock.elapsedTime * ROT_RAD_PER_S;

    // marker probe: derive the scan state, project the active landmark, highlight it
    const order = probe.order;
    if (order.length === 0) return;
    const now = reducedMotion ? 0 : performance.now();
    const st: ProbeState = probeScan(scanEpochMs, now, order.length, reducedMotion);
    const ai = Math.min(st.activeIndex, order.length - 1);
    const active = order[ai];

    // project the (rotated) landmark to screen px for the DOM overlay
    _projV.set(active.pos[0], active.pos[1], active.pos[2]);
    if (g) _projV.applyMatrix4(g.matrixWorld);
    _projV.project(state.camera);
    if (probeRef?.current) {
      const pr = probeRef.current;
      pr.x = (_projV.x * 0.5 + 0.5) * state.size.width;
      pr.y = (-_projV.y * 0.5 + 0.5) * state.size.height;
      pr.visible = !st.traveling;
      pr.index = st.activeIndex;
      pr.lockT = st.lockT;
      pr.traveling = st.traveling;
    }

    // nearest-node flare: reset to base every frame, pop only the locked node
    const sizeArr = built.nodeSizeAttr.array as Float32Array;
    const alphaArr = built.nodeAlphaAttr.array as Float32Array;
    sizeArr.set(built.nodeBaseSize);
    alphaArr.set(built.nodeBaseAlpha);
    const ni = probe.nearest[ai];
    if (!st.traveling && ni >= 0) {
      sizeArr[ni] = built.nodeBaseSize[ni] * (1 + FLARE_SIZE_GAIN * st.lockT);
      alphaArr[ni] = Math.min(1, built.nodeBaseAlpha[ni] + FLARE_ALPHA_GAIN * st.lockT);
    }
    built.nodeSizeAttr.needsUpdate = true;
    built.nodeAlphaAttr.needsUpdate = true;

    // body ring: only lit while 'body' is the active landmark, tracking the lock
    // (lockT is already 0 during travel, so it fades correctly on hand-off)
    built.ringMat.opacity = active.field === 'body' ? st.lockT * BODY_RING_OPACITY : 0;
  });

  return (
    <>
      <group ref={groupRef}>
        <lineSegments geometry={built.lineGeom} material={built.lineMat} frustumCulled={false} />
        <points geometry={built.orgGeom} material={built.orgMat} frustumCulled={false} renderOrder={2} />
        <points geometry={built.nodeGeom} material={built.nodeMat} frustumCulled={false} renderOrder={3} />
      </group>
      {/* body ring — sibling of the rotating group so it never goes edge-on;
          a flat annulus at the origin in the XY plane, facing the fixed camera. */}
      <mesh geometry={built.ringGeom} material={built.ringMat} frustumCulled={false} renderOrder={1} />
    </>
  );
}

export default function CellNucleusPortrait({ cell, reducedMotion, scanEpochMs, probeRef }: {
  cell: Cell; reducedMotion: boolean; scanEpochMs: number; probeRef?: MutableRefObject<ProbeScreen>;
}) {
  return (
    <div style={{ width: '100%', aspectRatio: '1 / 1', pointerEvents: 'none' }}>
      <Canvas gl={{ alpha: true, antialias: true }} camera={{ position: [0, 0, 3], fov: 40, near: 0.1, far: 20 }}
        style={{ background: 'transparent' }} frameloop={reducedMotion ? 'demand' : 'always'}>
        <SpecimenScene cell={cell} reducedMotion={reducedMotion} scanEpochMs={scanEpochMs} probeRef={probeRef} />
      </Canvas>
    </div>
  );
}
