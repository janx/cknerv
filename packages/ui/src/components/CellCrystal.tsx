// CellCrystal — the warm faceted crystal CONTAINER layer (one InstancedMesh)
// that replaces the cyan truncated-octahedron wireframe cage. Each cell is a
// small translucent warm crystal (faces + facet edges, via cellCrystalMaterial)
// holding its warm glow. Sibling of the glow Points inside CellGalaxy's rotating
// canopy group; reads cells from the cells projection; rebuilds per-instance
// data only on the cells-Map identity change.
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useCellGalaxy } from '../hooks/cellGalaxyContext';
import { useSimFrame } from '../tweaks/useSimFrame';
import { simClock } from '../tweaks/simClock';
import {
  INSTANCE_CAPACITY,
  BIRTH_DURATION_MS,
  DEATH_DURATION_MS,
} from '../geometry/cellPositions';
import { makeCellCrystalMaterial } from '../materials/cellCrystalMaterial';
import type { Cell } from '@cknerv/types';

// Crystal circumradius (world units). Sits a touch larger than the old shell so
// it visually contains the warm glow. Tunable — first-increment default.
const CRYSTAL_R = 0.14;

/** Flat-shaded icosahedron with a per-triangle barycentric attribute so the
 *  material can draw the facet edges. Non-indexed → flat facets + independent
 *  bary per vertex. */
function makeCrystalGeometry(): THREE.BufferGeometry {
  let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(CRYSTAL_R, 0);
  g = g.toNonIndexed();
  g.computeVertexNormals();
  const n = g.getAttribute('position').count; // multiple of 3 (triangles)
  const bary = new Float32Array(n * 3);
  for (let i = 0; i < n; i += 3) bary.set([1, 0, 0, 0, 1, 0, 0, 0, 1], i * 3);
  g.setAttribute('aBary', new THREE.BufferAttribute(bary, 3));
  return g;
}

const WARM: [number, number, number] = [1.0, 0.85, 0.62]; // warm-white crystal (asset accent later)

export default function CellCrystal() {
  const cache = useCellGalaxy();
  const geom = useMemo(() => makeCrystalGeometry(), []);
  const material = useMemo(() => makeCellCrystalMaterial(), []);
  useEffect(() => () => { geom.dispose(); material.dispose(); }, [geom, material]);

  const meshRef = useRef<THREE.InstancedMesh>(null);
  const colorArr = useMemo(() => new Float32Array(INSTANCE_CAPACITY * 3), []);
  const bornArr = useMemo(() => new Float32Array(INSTANCE_CAPACITY), []);
  const deathArr = useMemo(() => new Float32Array(INSTANCE_CAPACITY), []);
  const rotArr = useMemo(() => new Float32Array(INSTANCE_CAPACITY), []);

  useEffect(() => {
    const m = meshRef.current; if (!m) return;
    geom.setAttribute('aColor', new THREE.InstancedBufferAttribute(colorArr, 3));
    geom.setAttribute('aBornAt', new THREE.InstancedBufferAttribute(bornArr, 1));
    geom.setAttribute('aDeathAt', new THREE.InstancedBufferAttribute(deathArr, 1));
    geom.setAttribute('aRotPhase', new THREE.InstancedBufferAttribute(rotArr, 1));
    material.uniforms.uBirthDurS.value = BIRTH_DURATION_MS / 1000;
    material.uniforms.uDeathDurS.value = DEATH_DURATION_MS / 1000;
  }, [geom, material, colorArr, bornArr, deathArr, rotArr]);

  const lastCellsRef = useRef<Map<number, Cell> | null>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useSimFrame(() => {
    const m = meshRef.current; if (!m) return;
    const now = simClock.elapsedSec;
    const sceneStartWallMs = Date.now() - now * 1000;
    const toScene = (ms: number) => (ms - sceneStartWallMs) / 1000;
    material.uniforms.uTime.value = now;

    if (cache.cells !== lastCellsRef.current) {
      let i = 0;
      for (const c of cache.cells.values()) {
        if (i >= INSTANCE_CAPACITY) break;
        colorArr[i * 3] = WARM[0]; colorArr[i * 3 + 1] = WARM[1]; colorArr[i * 3 + 2] = WARM[2];
        bornArr[i] = toScene(c.born_at_ms);
        deathArr[i] = c.death_at_ms == null ? 1e9 : toScene(c.death_at_ms);
        rotArr[i] = (c.id * 0.61803) % 6.2831853; // deterministic per-cell phase (unsynced turn)
        dummy.position.set(c.pos_seed[0], c.pos_seed[1], c.pos_seed[2]);
        dummy.scale.setScalar(1);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        m.setMatrixAt(i, dummy.matrix);
        i++;
      }
      m.count = i;
      m.instanceMatrix.needsUpdate = true;
      (geom.getAttribute('aColor') as THREE.InstancedBufferAttribute).needsUpdate = true;
      (geom.getAttribute('aBornAt') as THREE.InstancedBufferAttribute).needsUpdate = true;
      (geom.getAttribute('aDeathAt') as THREE.InstancedBufferAttribute).needsUpdate = true;
      (geom.getAttribute('aRotPhase') as THREE.InstancedBufferAttribute).needsUpdate = true;
      lastCellsRef.current = cache.cells;
    }
  });

  return <instancedMesh ref={meshRef} args={[geom, material, INSTANCE_CAPACITY]} frustumCulled={false} renderOrder={1} />;
}
