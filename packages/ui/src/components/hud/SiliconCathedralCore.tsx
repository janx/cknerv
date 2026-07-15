import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { Cell } from '@cknerv/types';
import { deriveCellVisual } from '../../derives/cellVisual.derive';
import { makePhotonicCrystalMaterial } from '../../materials/photonicCrystalMaterial';

const TAU = Math.PI * 2;
const WINDOW_CAPACITY = 12;

function withBarycentric(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  let result = geometry;
  if (result.index) result = result.toNonIndexed();
  result.computeVertexNormals();
  const count = result.getAttribute('position').count;
  const bary = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 3) {
    bary.set([1, 0, 0, 0, 1, 0, 0, 0, 1], i * 3);
  }
  result.setAttribute('aBary', new THREE.BufferAttribute(bary, 3));
  return result;
}

function makeLevelMaterial(): LineMaterial {
  const material = new LineMaterial({
    linewidth: 0.7,
    opacity: 0.55,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  material.color.setRGB(0.25, 0.79, 1.0);
  material.worldUnits = false;
  return material;
}

/** Axial direction: a hash-grown crystalline sanctuary with suspended data panes. */
export default function SiliconCathedralCore({
  cell,
  reducedMotion,
}: {
  cell: Cell;
  reducedMotion: boolean;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const finsRef = useRef<THREE.InstancedMesh>(null);
  const windowsRef = useRef<THREE.InstancedMesh>(null);
  const visual = useMemo(() => deriveCellVisual(cell), [cell]);
  const built = useMemo(() => {
    const sideCount = 5 + Math.min(4, Math.round(visual.lockClass));
    const centralGeometry = withBarycentric(new THREE.ConeGeometry(0.14, 1.28, sideCount, 1, false));
    const crownGeometry = withBarycentric(new THREE.OctahedronGeometry(0.135, 0));
    const finGeometry = withBarycentric(new THREE.ConeGeometry(0.072, 0.78, 3, 1, false));
    const centralMaterial = makePhotonicCrystalMaterial(visual, {
      opacity: 0.9,
      depthWrite: false,
    });
    const crownMaterial = makePhotonicCrystalMaterial(visual, {
      opacity: 1,
      layer: 0.9,
      depthWrite: false,
    });
    const finMaterial = makePhotonicCrystalMaterial(visual, {
      opacity: 0.48,
      layer: 0.3,
      doubleSided: true,
      depthWrite: false,
    });
    const windowGeometry = new THREE.BoxGeometry(0.13, 0.018, 0.055);
    const windowMaterial = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.72,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const beamGeometry = new THREE.BoxGeometry(0.008, 1.16, 0.008);
    const beamMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0.38, 0.9, 1.0),
      transparent: true,
      opacity: 0.22,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });

    const levels: number[] = [];
    const levelPositions: number[] = [];
    const levelCount = 3 + (Math.round(visual.assetClass) % 3);
    for (let level = 0; level < levelCount; level += 1) {
      const y = -0.42 + (level / Math.max(1, levelCount - 1)) * 0.84;
      const radius = 0.19 + level * 0.034;
      levels.push(y);
      for (let side = 0; side < sideCount; side += 1) {
        const a = (side / sideCount) * TAU;
        const b = ((side + 1) / sideCount) * TAU;
        levelPositions.push(
          Math.cos(a) * radius, y, Math.sin(a) * radius,
          Math.cos(b) * radius, y, Math.sin(b) * radius,
        );
      }
    }
    const levelGeometry = new LineSegmentsGeometry();
    levelGeometry.setPositions(levelPositions);
    levelGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1.1);
    const levelMaterial = makeLevelMaterial();
    const levelLines = new LineSegments2(levelGeometry, levelMaterial);
    levelLines.frustumCulled = false;
    levelLines.renderOrder = 1;
    return {
      sideCount,
      levels,
      centralGeometry,
      crownGeometry,
      finGeometry,
      centralMaterial,
      crownMaterial,
      finMaterial,
      windowGeometry,
      windowMaterial,
      beamGeometry,
      beamMaterial,
      levelGeometry,
      levelMaterial,
      levelLines,
    };
  }, [visual]);

  const structuralWindows = 2 + Math.min(4, Math.round(visual.lockClass));
  const windowCount = Math.min(
    WINDOW_CAPACITY,
    structuralWindows + Math.round(visual.payload * (WINDOW_CAPACITY - structuralWindows)),
  );
  const heightScale = visual.assetClass > 2.5 && visual.assetClass < 3.5 ? 1.28 : 1.12;
  const widthScale = visual.assetClass > 0.5 && visual.assetClass < 2.5 ? 1.06 : 0.94;
  const presence = 1.04 + (visual.mass - 0.84) * 0.34;

  useEffect(() => {
    const mesh = finsRef.current;
    if (!mesh) return;
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const finScale = new THREE.Vector3();
    for (let i = 0; i < built.sideCount; i += 1) {
      const angle = (i / built.sideCount) * TAU + visual.seeds[0] * 0.35;
      const radius = 0.3 + visual.seeds[i % 4] * 0.03;
      position.set(Math.cos(angle) * radius, -0.15, Math.sin(angle) * radius);
      quaternion.setFromEuler(new THREE.Euler(
        Math.cos(angle) * -0.22,
        -angle,
        Math.sin(angle) * 0.22,
      ));
      finScale.set(0.72, 0.84 + visual.seeds[(i + 1) % 4] * 0.24, 0.72);
      matrix.compose(position, quaternion, finScale);
      mesh.setMatrixAt(i, matrix);
    }
    mesh.count = built.sideCount;
    mesh.instanceMatrix.needsUpdate = true;
  }, [built.sideCount, visual.seeds]);

  useEffect(() => {
    const mesh = windowsRef.current;
    if (!mesh) return;
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const size = new THREE.Vector3();
    const cyan = new THREE.Color(0.3, 0.88, 1.0);
    const violet = new THREE.Color(0.64, 0.37, 1.0);
    for (let i = 0; i < windowCount; i += 1) {
      const row = Math.floor(i / 2);
      const side = i % 2 === 0 ? -1 : 1;
      const y = -0.3 + (row / Math.max(1, Math.ceil(windowCount / 2) - 1)) * 0.6;
      position.set(side * (0.11 + (row % 2) * 0.035), y, 0.105 * Math.sin(row * 1.7));
      quaternion.setFromEuler(new THREE.Euler(0, row * 0.32 + visual.seeds[2], side * 0.08));
      size.setScalar(0.72 + (i % 3) * 0.12);
      matrix.compose(position, quaternion, size);
      mesh.setMatrixAt(i, matrix);
      mesh.setColorAt(i, i % 3 === 0 ? violet : cyan);
    }
    mesh.count = windowCount;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [visual.seeds, windowCount]);

  useFrame((state) => {
    const time = reducedMotion ? 0 : state.clock.elapsedTime;
    built.centralMaterial.uniforms.uTime.value = time;
    built.crownMaterial.uniforms.uTime.value = time;
    built.finMaterial.uniforms.uTime.value = time;
    built.levelMaterial.resolution.set(state.size.width, state.size.height);
    if (groupRef.current) {
      groupRef.current.rotation.y = visual.seeds[3] * TAU + time * 0.045;
      groupRef.current.rotation.z = (visual.seeds[1] - 0.5) * 0.08;
    }
  });

  useEffect(() => () => {
    built.centralGeometry.dispose();
    built.crownGeometry.dispose();
    built.finGeometry.dispose();
    built.centralMaterial.dispose();
    built.crownMaterial.dispose();
    built.finMaterial.dispose();
    built.windowGeometry.dispose();
    built.windowMaterial.dispose();
    built.beamGeometry.dispose();
    built.beamMaterial.dispose();
    built.levelGeometry.dispose();
    built.levelMaterial.dispose();
  }, [built]);

  return (
    <group
      ref={groupRef}
      scale={[presence * widthScale, presence * heightScale, presence * widthScale]}
    >
      <primitive object={built.levelLines} />
      <mesh geometry={built.beamGeometry} material={built.beamMaterial} renderOrder={1} />
      <instancedMesh
        ref={finsRef}
        args={[built.finGeometry, built.finMaterial, 9]}
        frustumCulled={false}
        renderOrder={2}
      />
      <mesh geometry={built.centralGeometry} material={built.centralMaterial} renderOrder={3} />
      <mesh
        position={[0, 0.43, 0]}
        geometry={built.crownGeometry}
        material={built.crownMaterial}
        renderOrder={4}
      />
      <instancedMesh
        ref={windowsRef}
        args={[built.windowGeometry, built.windowMaterial, WINDOW_CAPACITY]}
        frustumCulled={false}
        renderOrder={5}
      />
    </group>
  );
}
