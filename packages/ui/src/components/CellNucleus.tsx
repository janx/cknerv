// CellNucleus — the LOD identity-nucleus layer. Renders the "fuller" dendrite
// nucleus (curved branches + glowing seed-core mass + soft inner glow, grown from
// content_hash) ONLY for the handful of cells the camera is close to, and writes a
// per-cell `detail` factor into the glow geometry so those cells' white-hot peak
// fades and the nucleus reads. Far cells → detail 0 → the galaxy glow is
// byte-identical to before. Camera-driven → raw useFrame (works while paused).
//
// Three merged layers: curved branch LineSegments + tight core Points + soft glow
// Points. Rebuilt each frame for the near set (cheap — only a few cells). Lives
// inside CellGalaxy's rotating group, so nucleus geometry shares the cells' frame.
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { dendriteNucleus, type DendriteNucleus } from '../derives/dendriteNucleus';
import { makeNucleusPointMaterial } from '../materials/cellNucleusMaterial';
import type { Cell } from '@cknerv/types';

const CRYSTAL_R = 0.14;   // matches CellCrystal — dendrite local units scale by this
const NEAR_DIST = 2.5;    // camera distance at/inside which detail = 1  (tunable, calibrate live)
const FAR_DIST = 8.0;     // camera distance beyond which detail = 0
const MAX_NEAR = 12;      // cap cells rendered in full nucleus detail
const MAX_SEG = 480;      // per-cell segment cap (fuller dendrite emits ~300-405)
const MAX_CORE = 100;     // per-cell tight-core cap
const MAX_GLOW = 4;       // per-cell soft-glow cap
const LINE_WARM: [number, number, number] = [1.0, 0.72, 0.42];

interface Props {
  cellsListRef: { readonly current: Cell[] };
  drawCountRef: { readonly current: number };
  groupRef: { readonly current: THREE.Group | null };
  detailAttr: THREE.BufferAttribute;
}

export default function CellNucleus({ cellsListRef, drawCountRef, groupRef, detailAttr }: Props) {
  const lineCap = MAX_NEAR * MAX_SEG * 2;
  const coreCap = MAX_NEAR * MAX_CORE;
  const glowCap = MAX_NEAR * MAX_GLOW;

  const linePos = useMemo(() => new Float32Array(lineCap * 3), [lineCap]);
  const lineCol = useMemo(() => new Float32Array(lineCap * 3), [lineCap]);
  const corePos = useMemo(() => new Float32Array(coreCap * 3), [coreCap]);
  const coreSize = useMemo(() => new Float32Array(coreCap), [coreCap]);
  const coreAlpha = useMemo(() => new Float32Array(coreCap), [coreCap]);
  const glowPos = useMemo(() => new Float32Array(glowCap * 3), [glowCap]);
  const glowSize = useMemo(() => new Float32Array(glowCap), [glowCap]);
  const glowAlpha = useMemo(() => new Float32Array(glowCap), [glowCap]);

  const mkPoints = (pos: Float32Array, size: Float32Array, alpha: Float32Array) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
    g.setDrawRange(0, 0); g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    return g;
  };
  const lineGeom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(linePos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(lineCol, 3));
    g.setDrawRange(0, 0); g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    return g;
  }, [linePos, lineCol]);
  const coreGeom = useMemo(() => mkPoints(corePos, coreSize, coreAlpha), [corePos, coreSize, coreAlpha]);
  const glowGeom = useMemo(() => mkPoints(glowPos, glowSize, glowAlpha), [glowPos, glowSize, glowAlpha]);

  const lineMat = useMemo(() => new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), []);
  const coreMat = useMemo(() => makeNucleusPointMaterial(0.26), []); // tight bright pinpoint
  const glowMat = useMemo(() => makeNucleusPointMaterial(0.46), []); // soft mass
  useEffect(() => () => { lineGeom.dispose(); coreGeom.dispose(); glowGeom.dispose(); lineMat.dispose(); coreMat.dispose(); glowMat.dispose(); }, [lineGeom, coreGeom, glowGeom, lineMat, coreMat, glowMat]);

  const cache = useRef<Map<string, DendriteNucleus>>(new Map());
  const near = useRef<{ cell: Cell; detail: number; dist: number }[]>([]);
  const tmp = useMemo(() => new THREE.Vector3(), []);
  const camPos = useMemo(() => new THREE.Vector3(), []);

  useFrame((state) => {
    const group = groupRef.current;
    const cells = cellsListRef.current;
    const count = Math.min(drawCountRef.current ?? 0, cells?.length ?? 0);
    const detailArr = detailAttr.array as Float32Array;
    if (!group || !cells || count === 0) return;
    state.camera.getWorldPosition(camPos);
    const gm = group.matrixWorld;
    const vh = state.size.height;
    const p11 = state.camera.projectionMatrix.elements[5]; // 1/tan(fov/2) → points sized as true world diameters
    coreMat.uniforms.uViewportHeight.value = vh; coreMat.uniforms.uProjY.value = p11;
    glowMat.uniforms.uViewportHeight.value = vh; glowMat.uniforms.uProjY.value = p11;

    // 1. per-cell LOD detail (drives glow peak suppression) + collect near cells
    near.current.length = 0;
    for (let i = 0; i < count; i++) {
      const c = cells[i];
      tmp.set(c.pos_seed[0], c.pos_seed[1], c.pos_seed[2]).applyMatrix4(gm);
      const dist = tmp.distanceTo(camPos);
      let detail = (FAR_DIST - dist) / (FAR_DIST - NEAR_DIST);
      detail = detail < 0 ? 0 : detail > 1 ? 1 : detail;
      detailArr[i] = detail;
      if (detail > 0.02) near.current.push({ cell: c, detail, dist });
    }
    detailAttr.needsUpdate = true;

    // 2. nearest MAX_NEAR
    near.current.sort((a, b) => a.dist - b.dist);
    if (near.current.length > MAX_NEAR) near.current.length = MAX_NEAR;

    // 3. build merged geometry (group-local coords = same frame as the cells)
    let lv = 0, cv = 0, gv = 0;
    for (const n of near.current) {
      let d = cache.current.get(n.cell.content_hash);
      if (!d) { d = dendriteNucleus(n.cell.content_hash); cache.current.set(n.cell.content_hash, d); }
      const ox = n.cell.pos_seed[0], oy = n.cell.pos_seed[1], oz = n.cell.pos_seed[2];
      const cr = LINE_WARM[0] * n.detail, cg = LINE_WARM[1] * n.detail, cb = LINE_WARM[2] * n.detail;
      const segs = d.segments;
      for (let s = 0; s + 5 < segs.length && lv + 2 <= lineCap; s += 6) {
        linePos[lv * 3] = ox + segs[s] * CRYSTAL_R; linePos[lv * 3 + 1] = oy + segs[s + 1] * CRYSTAL_R; linePos[lv * 3 + 2] = oz + segs[s + 2] * CRYSTAL_R;
        lineCol[lv * 3] = cr; lineCol[lv * 3 + 1] = cg; lineCol[lv * 3 + 2] = cb; lv++;
        linePos[lv * 3] = ox + segs[s + 3] * CRYSTAL_R; linePos[lv * 3 + 1] = oy + segs[s + 4] * CRYSTAL_R; linePos[lv * 3 + 2] = oz + segs[s + 5] * CRYSTAL_R;
        lineCol[lv * 3] = cr; lineCol[lv * 3 + 1] = cg; lineCol[lv * 3 + 2] = cb; lv++;
      }
      for (const nd of d.cores) {
        if (cv >= coreCap) break;
        corePos[cv * 3] = ox + nd.x * CRYSTAL_R; corePos[cv * 3 + 1] = oy + nd.y * CRYSTAL_R; corePos[cv * 3 + 2] = oz + nd.z * CRYSTAL_R;
        coreSize[cv] = nd.s * CRYSTAL_R * 2.0; coreAlpha[cv] = n.detail; cv++;
      }
      for (const gl of d.glows) {
        if (gv >= glowCap) break;
        glowPos[gv * 3] = ox + gl.x * CRYSTAL_R; glowPos[gv * 3 + 1] = oy + gl.y * CRYSTAL_R; glowPos[gv * 3 + 2] = oz + gl.z * CRYSTAL_R;
        glowSize[gv] = gl.s * CRYSTAL_R * 2.0; glowAlpha[gv] = gl.a * n.detail; gv++;
      }
    }

    lineGeom.setDrawRange(0, lv); coreGeom.setDrawRange(0, cv); glowGeom.setDrawRange(0, gv);
    (lineGeom.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (lineGeom.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    for (const geom of [coreGeom, glowGeom]) {
      (geom.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      (geom.getAttribute('aSize') as THREE.BufferAttribute).needsUpdate = true;
      (geom.getAttribute('aAlpha') as THREE.BufferAttribute).needsUpdate = true;
    }
  });

  return (
    <group>
      <lineSegments geometry={lineGeom} material={lineMat} frustumCulled={false} renderOrder={2} />
      <points geometry={glowGeom} material={glowMat} frustumCulled={false} renderOrder={2} />
      <points geometry={coreGeom} material={coreMat} frustumCulled={false} renderOrder={3} />
    </group>
  );
}
