import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { Cell } from '@cknerv/types';
import { deriveCellVisual, type CellVisualDescriptor } from '../../derives/cellVisual.derive';
import { hashToBytes, seededRng } from '../../derives/specimenKit';
import { makePhotonicCrystalMaterial } from '../../materials/photonicCrystalMaterial';

const TAU = Math.PI * 2;
const PACKET_CAPACITY = 12;

interface OrbitSpec {
  major: number;
  minor: number;
  p: number;
  q: number;
  phase: number;
  rotation: THREE.Quaternion;
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

function coreGeometry(visual: CellVisualDescriptor): THREE.BufferGeometry {
  const sides = 5 + (Math.round(visual.assetClass) % 4);
  const positions: number[] = [];
  const top: [number, number, number] = [
    (visual.seeds[0] - 0.5) * 0.07,
    0.48,
    (visual.seeds[1] - 0.5) * 0.05,
  ];
  const bottom: [number, number, number] = [
    (visual.seeds[2] - 0.5) * 0.06,
    -0.42,
    (visual.seeds[3] - 0.5) * 0.05,
  ];
  const ring: Array<[number, number, number]> = [];
  for (let i = 0; i < sides; i += 1) {
    const angle = (i / sides) * TAU + visual.seeds[3] * 0.32;
    const word = visual.seeds[i % 4];
    const radius = 0.255 + word * 0.075;
    ring.push([
      Math.cos(angle) * radius,
      (word - 0.5) * 0.085,
      Math.sin(angle) * radius,
    ]);
  }
  for (let i = 0; i < sides; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % sides];
    positions.push(...top, ...a, ...b);
    positions.push(...bottom, ...b, ...a);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 0.58);
  return withBarycentric(geometry);
}

function orbitPoint(spec: OrbitSpec, angle: number, target = new THREE.Vector3()): THREE.Vector3 {
  const t = angle + spec.phase;
  const radial = spec.major + spec.minor * Math.cos(spec.q * t);
  target.set(
    radial * Math.cos(spec.p * t),
    radial * Math.sin(spec.p * t),
    spec.minor * Math.sin(spec.q * t),
  );
  return target.applyQuaternion(spec.rotation);
}

function ringCount(lockClass: number): number {
  if (lockClass > 2.5 && lockClass < 3.5) return 2;
  if (lockClass > 0.5 && lockClass < 1.5) return 3;
  return 1;
}

function keepOrbitSegment(
  visual: CellVisualDescriptor,
  ring: number,
  segment: number,
  steps: number,
): boolean {
  const f = segment / steps;
  if (visual.lockClass > 1.5 && visual.lockClass < 2.5 && ring === 0) {
    return f < 0.08 || f > 0.27; // ACP: one calm, legible opening
  }
  if (visual.lockClass > 2.5 && visual.lockClass < 3.5 && ring > 0) {
    return (Math.floor(segment / 6) + ring) % 3 !== 0; // Omnilock: phased segments
  }
  if (visual.lockClass > 3.5) {
    const word = Math.floor(visual.seeds[(ring + segment) % 4] * 997);
    return (word + segment * 7 + ring * 11) % 9 > 1; // unresolved gaps
  }
  return true;
}

function buildOrbitGeometry(visual: CellVisualDescriptor): {
  geometry: LineSegmentsGeometry;
  specs: OrbitSpec[];
} {
  const count = ringCount(visual.lockClass);
  const specs: OrbitSpec[] = [];
  const positions: number[] = [];
  const colors: number[] = [];
  const from = new THREE.Vector3();
  const to = new THREE.Vector3();
  const cyan = new THREE.Color(0.24, 0.84, 1.0);
  const violet = new THREE.Color(0.52, 0.34, 1.0);
  const color = new THREE.Color();
  const steps = 160;
  const asset = Math.round(visual.assetClass);
  let knotP = 1;
  let knotQ = 2 + (asset % 3);
  if (visual.lockClass > 0.5 && visual.lockClass < 1.5) {
    knotP = 2; knotQ = 3;
  } else if (visual.lockClass > 2.5 && visual.lockClass < 3.5) {
    knotP = 2; knotQ = 5;
  } else if (visual.lockClass > 3.5) {
    knotP = 3; knotQ = 4 + (asset % 2);
  }

  for (let ring = 0; ring < count; ring += 1) {
    const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(
      0.18 + ring * 0.11 + (visual.seeds[(ring + 1) % 4] - 0.5) * 0.2,
      visual.seeds[(ring + 2) % 4] * 0.9 + ring * 0.16,
      -0.12 + ring * 0.09,
    ));
    const spec: OrbitSpec = {
      major: 0.49 + ring * 0.045 + visual.seeds[ring % 4] * 0.018,
      minor: (knotP === 1 ? 0.085 : 0.125)
        + ring * 0.012
        + visual.seeds[(ring + 3) % 4] * 0.014,
      p: knotP,
      q: knotQ + (ring % 2),
      phase: visual.seeds[ring % 4] * TAU,
      rotation,
    };
    specs.push(spec);

    for (let i = 0; i < steps; i += 1) {
      if (!keepOrbitSegment(visual, ring, i, steps)) continue;
      orbitPoint(spec, (i / steps) * TAU, from);
      orbitPoint(spec, ((i + 1) / steps) * TAU, to);
      positions.push(from.x, from.y, from.z, to.x, to.y, to.z);
      for (const t of [i / steps, (i + 1) / steps]) {
        const spectral = 0.5 + 0.5 * Math.sin(t * TAU + ring * 1.7 + visual.seeds[2] * TAU);
        color.copy(violet).lerp(cyan, spectral);
        colors.push(color.r, color.g, color.b);
      }
    }
  }

  const geometry = new LineSegmentsGeometry();
  geometry.setPositions(positions);
  geometry.setColors(colors);
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1.2);
  return { geometry, specs };
}

function makeOrbitMaterial(linewidth: number, opacity: number): LineMaterial {
  const material = new LineMaterial({
    linewidth,
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

function assetScale(assetClass: number): [number, number, number] {
  if (assetClass > 0.5 && assetClass < 1.5) return [1.12, 0.78, 1.12];
  if (assetClass > 1.5 && assetClass < 2.5) return [1.16, 0.84, 0.94];
  if (assetClass > 2.5 && assetClass < 3.5) return [0.76, 1.24, 0.76];
  if (assetClass > 3.5 && assetClass < 4.5) return [1.08, 1.0, 1.08];
  if (assetClass > 4.5) return [0.86, 1.14, 0.9];
  return [1, 1.04, 1];
}

/** A sparse, sculptural silicon life form: crystal seed + shards + light orbits. */
export default function PhotonicSeed({
  cell,
  reducedMotion,
}: {
  cell: Cell;
  reducedMotion: boolean;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const shardsRef = useRef<THREE.InstancedMesh>(null);
  const packetsRef = useRef<THREE.InstancedMesh>(null);
  const visual = useMemo(() => deriveCellVisual(cell), [cell]);
  const built = useMemo(() => {
    const core = coreGeometry(visual);
    const inner = withBarycentric(new THREE.OctahedronGeometry(0.165, 0));
    const shard = withBarycentric(new THREE.TetrahedronGeometry(0.25, 0));
    const packet = new THREE.OctahedronGeometry(0.027, 0);
    const coreMaterial = makePhotonicCrystalMaterial(visual, {
      opacity: 0.9,
      depthWrite: false,
    });
    const innerMaterial = makePhotonicCrystalMaterial(visual, {
      opacity: 1,
      layer: 1,
      depthWrite: false,
    });
    const shardMaterial = makePhotonicCrystalMaterial(visual, {
      opacity: 0.5,
      layer: 0.35,
      doubleSided: true,
      depthWrite: false,
    });
    const packetMaterial = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.82,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const orbits = buildOrbitGeometry(visual);
    const orbitGlowMaterial = makeOrbitMaterial(2.6, 0.085);
    const orbitCoreMaterial = makeOrbitMaterial(0.64, 0.62);
    const orbitGlow = new LineSegments2(orbits.geometry, orbitGlowMaterial);
    const orbitCore = new LineSegments2(orbits.geometry, orbitCoreMaterial);
    orbitGlow.frustumCulled = false;
    orbitCore.frustumCulled = false;
    orbitGlow.renderOrder = 0;
    orbitCore.renderOrder = 1;
    return {
      core,
      inner,
      shard,
      packet,
      coreMaterial,
      innerMaterial,
      shardMaterial,
      packetMaterial,
      orbitGeometry: orbits.geometry,
      orbitSpecs: orbits.specs,
      orbitGlowMaterial,
      orbitCoreMaterial,
      orbitGlow,
      orbitCore,
    };
  }, [visual]);

  const shardCount = [5, 6, 7, 4, 8, 3][Math.round(visual.assetClass)] ?? 4;
  const packetCount = visual.payload <= 0
    ? 0
    : Math.min(PACKET_CAPACITY, Math.max(1, Math.round(visual.payload * PACKET_CAPACITY)));
  const scale = assetScale(visual.assetClass);
  const massScale = 1.12 + (visual.mass - 0.84) * 0.28;

  useEffect(() => {
    const mesh = shardsRef.current;
    if (!mesh) return;
    const r = seededRng(hashToBytes(cell.content_hash), 0xf070);
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const direction = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const twist = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const shardScale = new THREE.Vector3();
    for (let i = 0; i < shardCount; i += 1) {
      const azimuth = (i / shardCount) * TAU + visual.seeds[0] * TAU + (r() - 0.5) * 0.35;
      const elevation = (r() - 0.5) * 1.05;
      direction.set(
        Math.cos(azimuth) * Math.cos(elevation),
        Math.sin(elevation),
        Math.sin(azimuth) * Math.cos(elevation),
      ).normalize();
      position.copy(direction).multiplyScalar(0.39 + r() * 0.11);
      quaternion.setFromUnitVectors(up, direction);
      twist.setFromAxisAngle(direction, r() * TAU);
      quaternion.multiply(twist);
      shardScale.set(0.2 + r() * 0.11, 0.86 + r() * 0.38, 0.13 + r() * 0.09);
      matrix.compose(position, quaternion, shardScale);
      mesh.setMatrixAt(i, matrix);
    }
    mesh.count = shardCount;
    mesh.instanceMatrix.needsUpdate = true;
  }, [cell.content_hash, shardCount, visual.seeds]);

  useEffect(() => {
    const mesh = packetsRef.current;
    if (!mesh) return;
    const cyan = new THREE.Color(0.42, 0.92, 1.0);
    const violet = new THREE.Color(0.64, 0.42, 1.0);
    for (let i = 0; i < packetCount; i += 1) {
      mesh.setColorAt(i, i % 3 === 0 ? violet : cyan);
    }
    mesh.count = packetCount;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [packetCount]);

  useFrame((state) => {
    const time = reducedMotion ? 0 : state.clock.elapsedTime;
    built.coreMaterial.uniforms.uTime.value = time;
    built.innerMaterial.uniforms.uTime.value = time;
    built.shardMaterial.uniforms.uTime.value = time;
    built.orbitGlowMaterial.resolution.set(state.size.width, state.size.height);
    built.orbitCoreMaterial.resolution.set(state.size.width, state.size.height);
    if (groupRef.current) {
      groupRef.current.rotation.y = visual.seeds[1] * TAU + time * 0.055;
      groupRef.current.rotation.z = (visual.seeds[2] - 0.5) * 0.22;
    }

    const packets = packetsRef.current;
    const primaryOrbit = built.orbitSpecs[0];
    if (!packets || !primaryOrbit || packetCount === 0) return;
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const packetScale = new THREE.Vector3();
    for (let i = 0; i < packetCount; i += 1) {
      const angle = visual.seeds[3] * TAU
        + (i / packetCount) * TAU
        + time * (0.18 + visual.seeds[0] * 0.08);
      orbitPoint(primaryOrbit, angle, position);
      const pulse = 0.7 + 0.3 * ((i + Math.floor(time * 2)) % 3 === 0 ? 1 : 0);
      packetScale.setScalar(pulse);
      matrix.compose(position, quaternion, packetScale);
      packets.setMatrixAt(i, matrix);
    }
    packets.instanceMatrix.needsUpdate = true;
  });

  useEffect(() => () => {
    built.core.dispose();
    built.inner.dispose();
    built.shard.dispose();
    built.packet.dispose();
    built.coreMaterial.dispose();
    built.innerMaterial.dispose();
    built.shardMaterial.dispose();
    built.packetMaterial.dispose();
    built.orbitGeometry.dispose();
    built.orbitGlowMaterial.dispose();
    built.orbitCoreMaterial.dispose();
  }, [built]);

  return (
    <group ref={groupRef} scale={[scale[0] * massScale, scale[1] * massScale, scale[2] * massScale]}>
      <primitive object={built.orbitGlow} />
      <primitive object={built.orbitCore} />
      <instancedMesh
        ref={shardsRef}
        args={[built.shard, built.shardMaterial, 8]}
        frustumCulled={false}
        renderOrder={2}
      />
      <mesh geometry={built.core} material={built.coreMaterial} renderOrder={3} />
      <mesh geometry={built.inner} material={built.innerMaterial} renderOrder={4} />
      <instancedMesh
        ref={packetsRef}
        args={[built.packet, built.packetMaterial, PACKET_CAPACITY]}
        frustumCulled={false}
        renderOrder={5}
      />
    </group>
  );
}
