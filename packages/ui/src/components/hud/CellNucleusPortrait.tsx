// CellNucleusPortrait — the cell-detail hero: a dedicated <Canvas> (its own
// WebGL context, alive only while a cell is selected) rendering the DATA-DRIVEN
// SPECIMEN built from specimenMorphology(cell): warm GLOWING branch veins (two
// additive Line2 passes — a wide halo + a bright core) + nucleus nodes + green
// data organelles, slowly rotating, dimming as the cell dies. Galaxy untouched.
//
// The marker probe walks the anatomical landmarks: each frame it derives the
// probe state (probeScan, keyed off the shared scanEpochMs), projects the active
// landmark to 2D for the DOM overlay (probeRef), and highlights it. TWO phases:
//  · SCANNING — the probe auto-walks the landmarks top→out.
//  · INTERACTIVE (scan done) — the auto-walk stops; the caller drives a SELECTED
//    landmark (selectedField), which we highlight + reticle; and endpoints become
//    clickable: we project ALL landmarks to lsRef each frame and hit-test clicks
//    on the canvas, reporting the picked field via onSelectField (cross-highlight
//    with the panel rows).
import { useEffect, useMemo, useRef, type MutableRefObject, type MouseEvent as ReactMouseEvent } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { Cell } from '@cknerv/types';
import { specimenMorphology, LANDMARK_FIELDS, type LandmarkField } from '../../derives/specimenMorphology';
import type { Vec3 } from '../../derives/specimenKit';
import { probeScan, type ProbeState } from './probeScan';
import { makeNucleusPointMaterial } from '../../materials/cellNucleusMaterial';
import { makeOrganelleMaterial } from '../../materials/organelleMaterial';

const ROT_RAD_PER_S = 0.28;
export const SCAN_PERIOD_S = 4.2;   // shared with CellDetailPanel scan chrome

// --- branch veins (fat glowing lines; live-tune knobs). Widths are WORLD units
//     (specimen framed to radius ≈ 1), so thickness is zoom-stable. ---
const BRANCH_CORE_W = 0.012;       // bright core vein width
const BRANCH_GLOW_W = 0.034;       // wider faint halo pass under the core
const BRANCH_GLOW_OPACITY = 0.45;  // halo opacity as a fraction of the core's

// --- probe highlight tuning (restrained; live-tune knobs) ---
const FLARE_SIZE_GAIN = 1.7;       // nearest-node size multiplier at full lock
const FLARE_ALPHA_GAIN = 0.45;     // nearest-node alpha boost at full lock
const BODY_PULSE_SIZE = 0.35;      // whole-organism shimmer (STATE landmark)
const BODY_PULSE_ALPHA = 0.3;
const HIT_R = 26;                  // endpoint click hit-test radius (screen px)

// probeRef payload: the active landmark projected to screen space, read each
// frame by the SpecimenProbe DOM overlay (reticle + readout). Screen px, top-left.
export interface ProbeScreen { x: number; y: number; visible: boolean; index: number; lockT: number; traveling: boolean }
// per-landmark projected screen position + its field, for click hit-testing.
export interface LandmarkScreen { x: number; y: number; field: LandmarkField }

// reused scratch — never allocate a THREE temp inside useFrame (alloc-churn lesson)
const _projV = new THREE.Vector3();

function buildPoints(nodes: { x: number; y: number; z: number; s: number; a: number }[]) {
  const g = new THREE.BufferGeometry(); const c = nodes.length;
  const pos = new Float32Array(c * 3), size = new Float32Array(c), alpha = new Float32Array(c);
  nodes.forEach((n, i) => { pos[i * 3] = n.x; pos[i * 3 + 1] = n.y; pos[i * 3 + 2] = n.z; size[i] = n.s * 2.2; alpha[i] = n.a; });
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  g.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  return g;
}

function SpecimenScene({ cell, reducedMotion, scanEpochMs, probeRef, interactive, selectedField, lsRef }: {
  cell: Cell; reducedMotion: boolean; scanEpochMs: number; probeRef?: MutableRefObject<ProbeScreen>;
  interactive: boolean; selectedField: LandmarkField | null; lsRef: MutableRefObject<LandmarkScreen[]>;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const built = useMemo(() => {
    const m = specimenMorphology(cell);
    const tint = m.viability < 1 ? new THREE.Color(0.6, 0.65, 0.7) : new THREE.Color(m.tint[0], m.tint[1], m.tint[2]);
    const baseOpacity = 0.62 * (0.5 + 0.5 * m.viability);
    const segGeom = new LineSegmentsGeometry();
    segGeom.setPositions(m.segments);
    const mkLineMat = (width: number, opacity: number) => {
      const mat = new LineMaterial({ linewidth: width, worldUnits: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
      mat.color.copy(tint); mat.opacity = opacity; mat.resolution.set(300, 300);
      return mat;
    };
    const glowMat = mkLineMat(BRANCH_GLOW_W, baseOpacity * BRANCH_GLOW_OPACITY);
    const coreMat = mkLineMat(BRANCH_CORE_W, baseOpacity);
    const glowLine = new LineSegments2(segGeom, glowMat); glowLine.frustumCulled = false; glowLine.renderOrder = 0;
    const coreLine = new LineSegments2(segGeom, coreMat); coreLine.frustumCulled = false; coreLine.renderOrder = 1;
    const nodeGeom = buildPoints(m.nodes), orgGeom = buildPoints(m.organelles);
    const nodeMat = makeNucleusPointMaterial(0.4); nodeMat.uniforms.uWarmth.value = 1;
    const orgMat = makeOrganelleMaterial();
    const nodeSizeAttr = nodeGeom.getAttribute('aSize') as THREE.BufferAttribute;
    const nodeAlphaAttr = nodeGeom.getAttribute('aAlpha') as THREE.BufferAttribute;
    const nodeBaseSize = Float32Array.from(nodeSizeAttr.array as Float32Array);
    const nodeBaseAlpha = Float32Array.from(nodeAlphaAttr.array as Float32Array);
    return { m, segGeom, glowMat, coreMat, glowLine, coreLine, nodeGeom, nodeMat, orgGeom, orgMat, nodeSizeAttr, nodeAlphaAttr, nodeBaseSize, nodeBaseAlpha };
  }, [cell]);

  // ordered PRESENT landmarks (organelle may be absent) + each one's nearest node.
  const probe = useMemo(() => {
    const L = built.m.landmarks;
    const order = LANDMARK_FIELDS
      .map((f) => ({ field: f, pos: L[f] }))
      .filter((e): e is { field: LandmarkField; pos: Vec3 } => e.pos !== null);
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
    built.segGeom.dispose(); built.glowMat.dispose(); built.coreMat.dispose();
    built.nodeGeom.dispose(); built.nodeMat.dispose(); built.orgGeom.dispose(); built.orgMat.dispose();
  }, [built]);

  useFrame((state) => {
    const vh = state.size.height, p11 = state.camera.projectionMatrix.elements[5];
    for (const mat of [built.nodeMat, built.orgMat]) { mat.uniforms.uViewportHeight.value = vh; mat.uniforms.uProjY.value = p11; }
    built.glowMat.resolution.set(state.size.width, state.size.height);
    built.coreMat.resolution.set(state.size.width, state.size.height);
    const g = groupRef.current;
    if (g && !reducedMotion) g.rotation.y = state.clock.elapsedTime * ROT_RAD_PER_S;

    const order = probe.order;
    if (order.length === 0) return;

    // project ALL landmarks → lsRef (DOM hit-testing) every frame (they rotate).
    const w = state.size.width, h = state.size.height, arr = lsRef.current;
    for (let i = 0; i < order.length; i++) {
      _projV.set(order[i].pos[0], order[i].pos[1], order[i].pos[2]);
      if (g) _projV.applyMatrix4(g.matrixWorld);
      _projV.project(state.camera);
      arr[i] = { x: (_projV.x * 0.5 + 0.5) * w, y: (-_projV.y * 0.5 + 0.5) * h, field: order[i].field };
    }
    arr.length = order.length;

    // pick the active landmark: INTERACTIVE → the caller's selection (or none);
    // else → the auto-scan walk.
    let ai = -1, lockT = 1, showReticle = false;
    if (interactive) {
      ai = selectedField ? order.findIndex((e) => e.field === selectedField) : -1;
      showReticle = ai >= 0;
    } else {
      const now = reducedMotion ? 0 : performance.now();
      const st: ProbeState = probeScan(scanEpochMs, now, order.length, reducedMotion);
      ai = Math.min(st.activeIndex, order.length - 1);
      lockT = st.lockT; showReticle = !st.traveling;
    }
    const activeField = ai >= 0 ? order[ai].field : null;

    // feed the DOM reticle
    if (probeRef?.current) {
      const pr = probeRef.current;
      if (ai >= 0 && showReticle) {
        pr.x = arr[ai].x; pr.y = arr[ai].y; pr.visible = true; pr.index = ai; pr.lockT = lockT; pr.traveling = false;
      } else { pr.visible = false; }
    }

    // highlight: reset nodes to base, then flare the active node / body pulse.
    const sizeArr = built.nodeSizeAttr.array as Float32Array;
    const alphaArr = built.nodeAlphaAttr.array as Float32Array;
    sizeArr.set(built.nodeBaseSize);
    alphaArr.set(built.nodeBaseAlpha);
    if (ai >= 0) {
      if (activeField === 'body') {
        const gs = 1 + BODY_PULSE_SIZE * lockT, ga = BODY_PULSE_ALPHA * lockT;
        for (let i = 0; i < sizeArr.length; i++) {
          sizeArr[i] = built.nodeBaseSize[i] * gs;
          alphaArr[i] = Math.min(1, built.nodeBaseAlpha[i] + ga);
        }
      } else {
        const ni = probe.nearest[ai];
        if (ni >= 0) {
          sizeArr[ni] = built.nodeBaseSize[ni] * (1 + FLARE_SIZE_GAIN * lockT);
          alphaArr[ni] = Math.min(1, built.nodeBaseAlpha[ni] + FLARE_ALPHA_GAIN * lockT);
        }
      }
    }
    built.nodeSizeAttr.needsUpdate = true;
    built.nodeAlphaAttr.needsUpdate = true;
  });

  return (
    <group ref={groupRef}>
      <primitive object={built.glowLine} />
      <primitive object={built.coreLine} />
      <points geometry={built.orgGeom} material={built.orgMat} frustumCulled={false} renderOrder={2} />
      <points geometry={built.nodeGeom} material={built.nodeMat} frustumCulled={false} renderOrder={3} />
    </group>
  );
}

export default function CellNucleusPortrait({ cell, reducedMotion, scanEpochMs, probeRef, interactive = false, selectedField = null, onSelectField }: {
  cell: Cell; reducedMotion: boolean; scanEpochMs: number; probeRef?: MutableRefObject<ProbeScreen>;
  interactive?: boolean; selectedField?: LandmarkField | null; onSelectField?: (f: LandmarkField) => void;
}) {
  const lsRef = useRef<LandmarkScreen[]>([]);
  // endpoint click: pick the nearest projected landmark within HIT_R → report it.
  const handleClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (!interactive || !onSelectField) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left, py = e.clientY - rect.top;
    const arr = lsRef.current;
    let best = -1, bd = HIT_R * HIT_R;
    for (let i = 0; i < arr.length; i++) {
      const dx = arr[i].x - px, dy = arr[i].y - py, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = i; }
    }
    if (best >= 0) onSelectField(arr[best].field);
  };
  return (
    <div style={{ width: '100%', aspectRatio: '1 / 1', pointerEvents: interactive ? 'auto' : 'none', cursor: interactive ? 'crosshair' : 'default' }} onClick={handleClick}>
      <Canvas gl={{ alpha: true, antialias: true }} camera={{ position: [0, 0, 3], fov: 40, near: 0.1, far: 20 }}
        style={{ background: 'transparent' }} frameloop={reducedMotion ? 'demand' : 'always'}>
        <SpecimenScene cell={cell} reducedMotion={reducedMotion} scanEpochMs={scanEpochMs} probeRef={probeRef}
          interactive={interactive} selectedField={selectedField} lsRef={lsRef} />
      </Canvas>
    </div>
  );
}
