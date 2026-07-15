import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { Cell } from '@cknerv/types';
import {
  deriveCellVisual,
  type CellVisualDescriptor,
} from '../../derives/cellVisual.derive';
import { makePhotonicCrystalMaterial } from '../../materials/photonicCrystalMaterial';
import { makePsionicArchitectureMaterial } from '../../materials/psionicArchitectureMaterial';

const TAU = Math.PI * 2;
const MAX_BUTTRESSES = 5;
const MAX_PANELS = 6;
const MAX_PACKETS = 14;

interface FieldSpec {
  radius: number;
  squash: number;
  centreY: number;
  phase: number;
  depth: number;
}

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

function makeButtressGeometry(visual: CellVisualDescriptor): THREE.BufferGeometry {
  const lean = (visual.seeds[0] - 0.5) * 0.045;
  const shape = new THREE.Shape();
  shape.moveTo(0.065 + lean, -0.42);
  shape.bezierCurveTo(-0.25 + lean, -0.29, -0.39 + lean, 0.08, -0.14 + lean, 0.43);
  shape.bezierCurveTo(-0.09 + lean, 0.5, -0.02 + lean, 0.47, 0.005 + lean, 0.38);
  shape.lineTo(0.035 + lean, 0.29);
  shape.bezierCurveTo(-0.14 + lean, 0.08, -0.12 + lean, -0.18, 0.105 + lean, -0.32);
  shape.lineTo(0.13 + lean, -0.39);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.065,
    steps: 1,
    curveSegments: 7,
    bevelEnabled: true,
    bevelSegments: 1,
    bevelSize: 0.008,
    bevelThickness: 0.008,
  });
  geometry.translate(0, 0, -0.0325);
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 0.72);
  return withBarycentric(geometry);
}

function makePanelGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-0.09, -0.028);
  shape.lineTo(0.048, -0.048);
  shape.lineTo(0.095, 0.012);
  shape.lineTo(-0.045, 0.055);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.026,
    steps: 1,
    bevelEnabled: true,
    bevelSegments: 1,
    bevelSize: 0.005,
    bevelThickness: 0.005,
  });
  geometry.translate(0, 0, -0.013);
  return withBarycentric(geometry);
}

function makeSuspendedCoreGeometry(visual: CellVisualDescriptor): THREE.BufferGeometry {
  const sides = 5 + (Math.round(visual.assetClass) % 3);
  const levels = [
    { y: -0.18, radius: 0.035, x: -0.025, z: 0.015 },
    { y: -0.105, radius: 0.13, x: -0.045, z: -0.01 },
    { y: 0.035, radius: 0.095, x: 0.03, z: 0.018 },
    { y: 0.17, radius: 0.145, x: 0.018, z: -0.014 },
    { y: 0.255, radius: 0.032, x: 0.06, z: 0.01 },
  ];
  const rings = levels.map((level, levelIndex) => Array.from({ length: sides }, (_, side) => {
    const angle = (side / sides) * TAU
      + visual.seeds[(levelIndex + side) % 4] * 0.18
      + levelIndex * 0.08;
    const radius = level.radius * (0.9 + visual.seeds[(side + 1) % 4] * 0.18);
    return new THREE.Vector3(
      level.x + Math.cos(angle) * radius,
      level.y,
      level.z + Math.sin(angle) * radius,
    );
  }));
  const positions: number[] = [];
  for (let level = 0; level < rings.length - 1; level += 1) {
    for (let side = 0; side < sides; side += 1) {
      const next = (side + 1) % sides;
      const a = rings[level][side];
      const b = rings[level][next];
      const c = rings[level + 1][next];
      const d = rings[level + 1][side];
      positions.push(...a.toArray(), ...b.toArray(), ...c.toArray());
      positions.push(...a.toArray(), ...c.toArray(), ...d.toArray());
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.03, 0), 0.42);
  return withBarycentric(geometry);
}

function fieldCount(lockClass: number): number {
  if (lockClass > 0.5 && lockClass < 1.5) return 3;
  if (lockClass > 2.5 && lockClass < 3.5) return 2;
  if (lockClass > 3.5) return 2;
  return 1;
}

function architectureScale(assetClass: number): [number, number, number] {
  if (assetClass > 0.5 && assetClass < 1.5) return [1.14, 0.86, 1.06];
  if (assetClass > 1.5 && assetClass < 2.5) return [1.1, 0.93, 0.9];
  if (assetClass > 2.5 && assetClass < 3.5) return [0.82, 1.2, 0.82];
  if (assetClass > 3.5 && assetClass < 4.5) return [1.12, 1.04, 1.12];
  if (assetClass > 4.5) return [0.94, 1.08, 0.92];
  return [1, 1, 1];
}

function keepFieldSegment(
  visual: CellVisualDescriptor,
  ring: number,
  segment: number,
  steps: number,
): boolean {
  const f = segment / steps;
  if (visual.lockClass > 1.5 && visual.lockClass < 2.5 && ring === 0) {
    return f < 0.12 || f > 0.34;
  }
  if (visual.lockClass > 2.5 && visual.lockClass < 3.5) {
    return (Math.floor(segment / 7) + ring) % 3 !== 1;
  }
  if (visual.lockClass > 3.5) {
    const word = Math.floor(visual.seeds[(segment + ring) % 4] * 991);
    return (word + segment * 5 + ring * 7) % 10 > 1;
  }
  return true;
}

function fieldPoint(
  spec: FieldSpec,
  angle: number,
  target = new THREE.Vector3(),
): THREE.Vector3 {
  const t = angle + spec.phase;
  const ripple = Math.sin(t * 3 + spec.phase) * 0.008;
  const radius = spec.radius + ripple;
  return target.set(
    Math.cos(t) * radius,
    spec.centreY + Math.sin(t) * radius * spec.squash,
    Math.sin(t) * radius * spec.depth,
  );
}

function makeLineMaterial(width: number, opacity: number): LineMaterial {
  const material = new LineMaterial({
    linewidth: width,
    opacity,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  material.vertexColors = true;
  material.worldUnits = false;
  return material;
}

function buildButtressLayout(visual: CellVisualDescriptor): {
  matrices: THREE.Matrix4[];
  tips: THREE.Vector3[];
} {
  const count = 3 + (Math.round(visual.assetClass) % 3);
  const baseAngles = [0, Math.PI, 1.72, -1.72, 0.88];
  const matrices: THREE.Matrix4[] = [];
  const tips: THREE.Vector3[] = [];
  for (let i = 0; i < count; i += 1) {
    const hero = i < 2;
    const angle = baseAngles[i] + (visual.seeds[i % 4] - 0.5) * 0.14;
    const radius = 0.13 + visual.seeds[(i + 1) % 4] * 0.025;
    const position = i === 0
      ? new THREE.Vector3(-0.12, -0.02, 0.025)
      : i === 1
        ? new THREE.Vector3(0.14, -0.075, 0.035)
        : new THREE.Vector3(
          Math.cos(angle) * radius,
          -0.025 + (visual.seeds[(i + 2) % 4] - 0.5) * 0.035,
          Math.sin(angle) * radius - 0.035,
        );
    const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(
      (visual.seeds[(i + 3) % 4] - 0.5) * 0.08,
      angle,
      (visual.seeds[(i + 1) % 4] - 0.5) * 0.09,
    ));
    const scale = new THREE.Vector3(
      (i === 0 ? 0.94 : i === 1 ? 0.8 : 0.69)
        * (0.9 + visual.seeds[(i + 2) % 4] * 0.18),
      (i === 0 ? 1.04 : i === 1 ? 0.72 : 0.82)
        * (0.9 + visual.seeds[(i + 3) % 4] * 0.2),
      hero ? 0.92 : 0.8,
    );
    const matrix = new THREE.Matrix4().compose(position, quaternion, scale);
    matrices.push(matrix);
    tips.push(new THREE.Vector3(-0.11, 0.42, 0).applyMatrix4(matrix));
  }
  return { matrices, tips };
}

/** Original alien sanctuary: curved shell, levitated content core and psi field. */
export default function PsionicSanctum({
  cell,
  reducedMotion,
}: {
  cell: Cell;
  reducedMotion: boolean;
}) {
  const rootRef = useRef<THREE.Group>(null);
  const fieldRef = useRef<THREE.Group>(null);
  const coreRef = useRef<THREE.Group>(null);
  const buttressRef = useRef<THREE.InstancedMesh>(null);
  const panelRef = useRef<THREE.InstancedMesh>(null);
  const packetsRef = useRef<THREE.InstancedMesh>(null);
  const visual = useMemo(() => deriveCellVisual(cell), [cell]);
  const built = useMemo(() => {
    const buttressGeometry = makeButtressGeometry(visual);
    const panelGeometry = makePanelGeometry();
    const coreGeometry = makeSuspendedCoreGeometry(visual);
    const innerGeometry = withBarycentric(new THREE.DodecahedronGeometry(0.068, 0));
    const baseGeometry = withBarycentric(new THREE.CylinderGeometry(
      0.235,
      0.29,
      0.06,
      6 + (Math.round(visual.assetClass) % 3),
      1,
      false,
    ));
    const buttressMaterial = makePsionicArchitectureMaterial(visual, {
      opacity: 0.9,
      doubleSided: true,
    });
    const panelMaterial = makePsionicArchitectureMaterial(visual, {
      opacity: 0.72,
      layer: 0.55,
      doubleSided: true,
    });
    const coreMaterial = makePhotonicCrystalMaterial(visual, {
      opacity: 0.94,
      layer: 0.45,
      doubleSided: true,
      depthWrite: false,
    });
    const innerMaterial = makePhotonicCrystalMaterial(visual, {
      opacity: 1,
      layer: 1.35,
      depthWrite: false,
    });

    const layout = buildButtressLayout(visual);
    const fieldSpecs: FieldSpec[] = [];
    const linePositions: number[] = [];
    const lineColors: number[] = [];
    const cyan = new THREE.Color(0.18, 0.84, 1);
    const pale = new THREE.Color(0.74, 0.94, 1);
    const gold = new THREE.Color(0.72, 0.57, 0.3);
    const violet = new THREE.Color(0.56, 0.33, 1);
    const color = new THREE.Color();
    const from = new THREE.Vector3();
    const to = new THREE.Vector3();
    const steps = 144;
    const count = fieldCount(visual.lockClass);
    for (let ring = 0; ring < count; ring += 1) {
      const spec: FieldSpec = {
        radius: 0.35 + ring * 0.065 + visual.seeds[ring % 4] * 0.012,
        squash: 0.22 + ring * 0.035,
        centreY: -0.24 + ring * 0.035,
        phase: visual.seeds[(ring + 1) % 4] * 0.22,
        depth: 0.46 + ring * 0.05,
      };
      fieldSpecs.push(spec);
      for (let i = 0; i < steps; i += 1) {
        if (!keepFieldSegment(visual, ring, i, steps)) continue;
        const angle = (i / steps) * TAU;
        const next = ((i + 1) / steps) * TAU;
        fieldPoint(spec, angle, from);
        fieldPoint(spec, next, to);
        linePositions.push(...from.toArray(), ...to.toArray());
        for (const t of [angle, next]) {
          const spectral = 0.5 + 0.5 * Math.cos(t + visual.seeds[2] * TAU);
          color.copy(violet).lerp(cyan, spectral);
          if (ring === 0) color.lerp(pale, 0.28);
          lineColors.push(color.r, color.g, color.b);
        }
      }
    }

    // Buttress tips feed the suspended content core through visible conduits.
    for (let i = 0; i < layout.tips.length; i += 1) {
      const tip = layout.tips[i];
      const midpoint = tip.clone().lerp(new THREE.Vector3(0.015, 0.055, 0), 0.55);
      midpoint.z += (visual.seeds[i % 4] - 0.5) * 0.1;
      linePositions.push(
        ...tip.toArray(), ...midpoint.toArray(),
        ...midpoint.toArray(), 0.015, 0.055, 0,
      );
      const conduit = gold.clone().lerp(cyan, 0.58 + visual.seeds[i % 4] * 0.2);
      for (let vertex = 0; vertex < 4; vertex += 1) {
        lineColors.push(conduit.r, conduit.g, conduit.b);
      }
    }

    const lineGeometry = new LineSegmentsGeometry();
    lineGeometry.setPositions(linePositions);
    lineGeometry.setColors(lineColors);
    lineGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1.1);
    const lineGlowMaterial = makeLineMaterial(3.6, 0.075);
    const lineCoreMaterial = makeLineMaterial(0.66, 0.68);
    const lineGlow = new LineSegments2(lineGeometry, lineGlowMaterial);
    const lineCore = new LineSegments2(lineGeometry, lineCoreMaterial);
    lineGlow.frustumCulled = false;
    lineCore.frustumCulled = false;
    lineGlow.renderOrder = 0;
    lineCore.renderOrder = 1;

    const packetGeometry = new THREE.BoxGeometry(0.038, 0.008, 0.015);
    const packetMaterial = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.88,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    return {
      buttressGeometry,
      panelGeometry,
      coreGeometry,
      innerGeometry,
      baseGeometry,
      buttressMaterial,
      panelMaterial,
      coreMaterial,
      innerMaterial,
      buttressMatrices: layout.matrices,
      fieldSpecs,
      lineGeometry,
      lineGlowMaterial,
      lineCoreMaterial,
      lineGlow,
      lineCore,
      packetGeometry,
      packetMaterial,
    };
  }, [visual]);

  const panelCount = 3 + (Math.round(visual.assetClass) % 4);
  const packetCount = visual.payload <= 0
    ? 0
    : Math.min(MAX_PACKETS, Math.max(1, Math.round(visual.payload * MAX_PACKETS)));
  const presence = 1.28 + (visual.mass - 0.84) * 0.28;
  const profile = architectureScale(visual.assetClass);

  useEffect(() => {
    const mesh = buttressRef.current;
    if (!mesh) return;
    for (let i = 0; i < built.buttressMatrices.length; i += 1) {
      mesh.setMatrixAt(i, built.buttressMatrices[i]);
    }
    mesh.count = built.buttressMatrices.length;
    mesh.instanceMatrix.needsUpdate = true;
  }, [built.buttressMatrices]);

  useEffect(() => {
    const mesh = panelRef.current;
    if (!mesh) return;
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    for (let i = 0; i < panelCount; i += 1) {
      const angle = (i / panelCount) * TAU + visual.seeds[0] * 0.7;
      const radius = 0.33 + visual.seeds[(i + 1) % 4] * 0.045;
      position.set(
        Math.cos(angle) * radius,
        -0.12 + (i / Math.max(1, panelCount - 1)) * 0.34
          + (visual.seeds[(i + 2) % 4] - 0.5) * 0.05,
        Math.sin(angle) * radius,
      );
      quaternion.setFromEuler(new THREE.Euler(
        (visual.seeds[(i + 3) % 4] - 0.5) * 0.28,
        -angle,
        (i % 2 === 0 ? 1 : -1) * (0.12 + visual.seeds[i % 4] * 0.14),
      ));
      scale.setScalar(0.74 + visual.seeds[(i + 1) % 4] * 0.34);
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(i, matrix);
    }
    mesh.count = panelCount;
    mesh.instanceMatrix.needsUpdate = true;
  }, [panelCount, visual.seeds]);

  useEffect(() => {
    const mesh = packetsRef.current;
    if (!mesh) return;
    const cyan = new THREE.Color(0.4, 0.94, 1);
    const gold = new THREE.Color(0.92, 0.74, 0.36);
    for (let i = 0; i < packetCount; i += 1) {
      mesh.setColorAt(i, i % 4 === 0 ? gold : cyan);
    }
    mesh.count = packetCount;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [packetCount]);

  useFrame((state) => {
    const time = reducedMotion ? 0 : state.clock.elapsedTime;
    built.buttressMaterial.uniforms.uTime.value = time;
    built.panelMaterial.uniforms.uTime.value = time;
    built.coreMaterial.uniforms.uTime.value = time;
    built.innerMaterial.uniforms.uTime.value = time;
    built.lineGlowMaterial.resolution.set(state.size.width, state.size.height);
    built.lineCoreMaterial.resolution.set(state.size.width, state.size.height);
    if (rootRef.current) {
      rootRef.current.rotation.y = (visual.seeds[1] - 0.5) * 0.38 + time * 0.025;
      rootRef.current.rotation.z = (visual.seeds[2] - 0.5) * 0.08;
    }
    if (fieldRef.current) fieldRef.current.rotation.z = time * 0.018;
    if (coreRef.current) {
      coreRef.current.position.y = Math.sin(time * 0.62 + visual.seeds[0] * TAU) * 0.012;
      coreRef.current.rotation.y = time * 0.12 + visual.seeds[3] * 0.55;
    }

    const mesh = packetsRef.current;
    const spec = built.fieldSpecs[0];
    if (!mesh || !spec || packetCount === 0) return;
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    for (let i = 0; i < packetCount; i += 1) {
      const angle = (i / packetCount) * TAU
        + visual.seeds[3] * TAU
        + time * (0.12 + visual.payload * 0.08);
      fieldPoint(spec, angle, position);
      quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), angle + Math.PI / 2);
      scale.setScalar((i + Math.floor(time * 2)) % 4 === 0 ? 1.2 : 0.72);
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(i, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  useEffect(() => () => {
    built.buttressGeometry.dispose();
    built.panelGeometry.dispose();
    built.coreGeometry.dispose();
    built.innerGeometry.dispose();
    built.baseGeometry.dispose();
    built.buttressMaterial.dispose();
    built.panelMaterial.dispose();
    built.coreMaterial.dispose();
    built.innerMaterial.dispose();
    built.lineGeometry.dispose();
    built.lineGlowMaterial.dispose();
    built.lineCoreMaterial.dispose();
    built.packetGeometry.dispose();
    built.packetMaterial.dispose();
  }, [built]);

  return (
    <group
      ref={rootRef}
      scale={[presence * profile[0], presence * profile[1], presence * profile[2]]}
    >
      <group ref={fieldRef}>
        <primitive object={built.lineGlow} />
        <primitive object={built.lineCore} />
        <instancedMesh
          ref={packetsRef}
          args={[built.packetGeometry, built.packetMaterial, MAX_PACKETS]}
          frustumCulled={false}
          renderOrder={6}
        />
      </group>
      <instancedMesh
        ref={buttressRef}
        args={[built.buttressGeometry, built.buttressMaterial, MAX_BUTTRESSES]}
        frustumCulled={false}
        renderOrder={2}
      />
      <mesh
        position={[0, -0.36, 0]}
        scale={[1, 1, 0.72]}
        geometry={built.baseGeometry}
        material={built.buttressMaterial}
        renderOrder={2}
      />
      <instancedMesh
        ref={panelRef}
        args={[built.panelGeometry, built.panelMaterial, MAX_PANELS]}
        frustumCulled={false}
        renderOrder={3}
      />
      <group ref={coreRef} position={[0, 0.035, 0]}>
        <mesh geometry={built.coreGeometry} material={built.coreMaterial} renderOrder={4} />
        <mesh
          position={[0.015, 0.055, 0]}
          geometry={built.innerGeometry}
          material={built.innerMaterial}
          renderOrder={5}
        />
      </group>
    </group>
  );
}
