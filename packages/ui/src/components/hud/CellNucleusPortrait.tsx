// CellNucleusPortrait — the cell-detail hero: a dedicated <Canvas> (its own
// WebGL context, alive only while a cell is selected) rendering the DATA-DRIVEN
// SPECIMEN built from specimenMorphology(cell): warm structure (line segments +
// nucleus nodes) + green data organelles, slowly rotating, dimming as the cell
// dies. Galaxy untouched. The scan probe (beam) is added back in Task 10 — the
// scanEpochMs prop is kept for it even though this component now ignores it.
import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Cell } from '@cknerv/types';
import { specimenMorphology } from '../../derives/specimenMorphology';
import { makeNucleusPointMaterial } from '../../materials/cellNucleusMaterial';
import { makeOrganelleMaterial } from '../../materials/organelleMaterial';

const ROT_RAD_PER_S = 0.28;
export const SCAN_PERIOD_S = 4.2;   // shared with CellDetailPanel + probe

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

function SpecimenScene({ cell, reducedMotion }: { cell: Cell; reducedMotion: boolean }) {
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
    return { m, lineGeom, lineMat, nodeGeom, nodeMat, orgGeom, orgMat };
  }, [cell]);

  useEffect(() => () => {
    built.lineGeom.dispose(); built.lineMat.dispose(); built.nodeGeom.dispose();
    built.nodeMat.dispose(); built.orgGeom.dispose(); built.orgMat.dispose();
  }, [built]);

  useFrame((state) => {
    const vh = state.size.height, p11 = state.camera.projectionMatrix.elements[5];
    for (const mat of [built.nodeMat, built.orgMat]) { mat.uniforms.uViewportHeight.value = vh; mat.uniforms.uProjY.value = p11; }
    if (groupRef.current && !reducedMotion) groupRef.current.rotation.y = state.clock.elapsedTime * ROT_RAD_PER_S;
  });

  return (
    <group ref={groupRef}>
      <lineSegments geometry={built.lineGeom} material={built.lineMat} frustumCulled={false} />
      <points geometry={built.orgGeom} material={built.orgMat} frustumCulled={false} renderOrder={2} />
      <points geometry={built.nodeGeom} material={built.nodeMat} frustumCulled={false} renderOrder={3} />
    </group>
  );
}

export default function CellNucleusPortrait({ cell, reducedMotion }: { cell: Cell; reducedMotion: boolean; scanEpochMs: number }) {
  return (
    <div style={{ width: '100%', aspectRatio: '1 / 1', pointerEvents: 'none' }}>
      <Canvas gl={{ alpha: true, antialias: true }} camera={{ position: [0, 0, 3], fov: 40, near: 0.1, far: 20 }}
        style={{ background: 'transparent' }} frameloop={reducedMotion ? 'demand' : 'always'}>
        <SpecimenScene cell={cell} reducedMotion={reducedMotion} />
      </Canvas>
    </div>
  );
}
