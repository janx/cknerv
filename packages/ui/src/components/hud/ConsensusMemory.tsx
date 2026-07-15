import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { Cell } from '@cknerv/types';
import { deriveCellVisual } from '../../derives/cellVisual.derive';
import {
  CONSENSUS_BRAID_PALETTE,
  CONSENSUS_BRAID_TAU,
  consensusBraidContributorColor,
  consensusBraidBirthPhase,
  consensusBraidLayerOpacity,
  consensusBraidPoint,
  consensusBraidSpecs,
  type ConsensusBraidField,
  type ConsensusBraidSpec,
} from '../../derives/consensusBraid.derive';

const TAU = CONSENSUS_BRAID_TAU;
const MAX_PACKETS = 14;
const PACKET_MATRIX = new THREE.Matrix4();
const PACKET_POSITION = new THREE.Vector3();
const PACKET_TANGENT = new THREE.Vector3();
const PACKET_QUATERNION = new THREE.Quaternion();
const PACKET_SCALE = new THREE.Vector3();
const X_AXIS = new THREE.Vector3(1, 0, 0);

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

/** Multiple contributor streams become one stable record only at their knots. */
export default function ConsensusMemory({
  cell,
  reducedMotion,
  focusField = null,
}: {
  cell: Cell;
  reducedMotion: boolean;
  focusField?: ConsensusBraidField | null;
}) {
  const rootRef = useRef<THREE.Group>(null);
  const packetsRef = useRef<THREE.InstancedMesh>(null);
  const visual = useMemo(() => deriveCellVisual(cell), [cell]);
  const built = useMemo(() => {
    const specs = consensusBraidSpecs(visual);
    const count = specs.length;
    const ribbonPositions: number[] = [];
    const ribbonColors: number[] = [];
    const streamPositions: number[] = [];
    const streamColors: number[] = [];
    const stitchPositions: number[] = [];
    const stitchColors: number[] = [];
    const agreementPositions: number[] = [];
    const agreementColors: number[] = [];
    const knotPositions: number[] = [];
    const knotColors: number[] = [];
    const gold = new THREE.Color(...CONSENSUS_BRAID_PALETTE.gold);
    const paleGold = new THREE.Color(...CONSENSUS_BRAID_PALETTE.paleGold);
    const cyan = new THREE.Color(...CONSENSUS_BRAID_PALETTE.cyan);
    const violet = new THREE.Color(...CONSENSUS_BRAID_PALETTE.violet);
    const pale = new THREE.Color(...CONSENSUS_BRAID_PALETTE.pale);
    const color = new THREE.Color();
    const centre = new THREE.Vector3();
    const before = new THREE.Vector3();
    const after = new THREE.Vector3();
    const tangent = new THREE.Vector3();
    const normal = new THREE.Vector3();
    const reference = new THREE.Vector3(0, 0, 1);
    const fallback = new THREE.Vector3(0, 1, 0);
    const left0 = new THREE.Vector3();
    const right0 = new THREE.Vector3();
    const left1 = new THREE.Vector3();
    const right1 = new THREE.Vector3();
    const mid0 = new THREE.Vector3();
    const mid1 = new THREE.Vector3();
    const steps = 208;
    const width = 0.012 + visual.payload * 0.01;

    const frame = (
      spec: ConsensusBraidSpec,
      t: number,
      left: THREE.Vector3,
      right: THREE.Vector3,
    ) => {
      consensusBraidPoint(spec, t, centre);
      consensusBraidPoint(spec, t - 0.002, before);
      consensusBraidPoint(spec, t + 0.002, after);
      tangent.subVectors(after, before).normalize();
      normal.crossVectors(tangent, reference);
      if (normal.lengthSq() < 0.01) normal.crossVectors(tangent, fallback);
      normal.normalize().multiplyScalar(width);
      left.copy(centre).add(normal);
      right.copy(centre).sub(normal);
    };

    for (let strand = 0; strand < count; strand += 1) {
      const spec = specs[strand];
      for (let segment = 0; segment < steps; segment += 1) {
        const t0 = (segment / steps) * TAU;
        const t1 = ((segment + 1) / steps) * TAU;
        frame(spec, t0, left0, right0);
        frame(spec, t1, left1, right1);
        mid0.addVectors(left0, right0).multiplyScalar(0.5);
        mid1.addVectors(left1, right1).multiplyScalar(0.5);
        ribbonPositions.push(
          ...left0.toArray(), ...right0.toArray(), ...left1.toArray(),
          ...right0.toArray(), ...right1.toArray(), ...left1.toArray(),
        );
        for (let vertex = 0; vertex < 6; vertex += 1) {
          const convergence = 1 - Math.min(1, centre.length() / 0.55);
          const spectral = 0.5 + 0.5 * Math.sin(t0 * 1.4 + strand * 1.7 + vertex * 0.1);
          const contributor = consensusBraidContributorColor(strand, spectral);
          color.setRGB(contributor[0], contributor[1], contributor[2]);
          if (convergence > 0.68) {
            color.lerp(pale, (convergence - 0.68) * 0.9);
          }
          ribbonColors.push(color.r, color.g, color.b);
        }
        streamPositions.push(...mid0.toArray(), ...mid1.toArray());
        if (strand % 3 === 0) color.copy(paleGold).lerp(gold, 0.26);
        else if (strand % 3 === 1) color.copy(pale).lerp(cyan, 0.36);
        else color.copy(cyan).lerp(violet, 0.42);
        streamColors.push(color.r, color.g, color.b, color.r, color.g, color.b);

        const stitchPeriod = Math.max(8, 18 - Math.round(visual.payload * 8));
        if ((segment + strand * 3) % stitchPeriod === 0) {
          stitchPositions.push(...left0.toArray(), ...right0.toArray());
          color.copy(gold).lerp(paleGold, segment % 2 ? 0.22 : 0.65);
          stitchColors.push(color.r, color.g, color.b, color.r, color.g, color.b);
        }
      }
    }

    // Consensus is not an arbitrary centre ornament. For each neighboring
    // contributor pair, locate their closest genuinely independent samples;
    // only those spatial agreements receive a bridge and a luminous knot.
    const agreementSamples = 72;
    const agreementsPerPair = 1 + Math.round(visual.payload * 2);
    const sampleA = new THREE.Vector3();
    const sampleB = new THREE.Vector3();
    const knot = new THREE.Vector3();
    for (let pair = 0; pair < specs.length - 1; pair += 1) {
      const candidates: Array<{
        distanceSq: number;
        indexA: number;
        indexB: number;
        pointA: THREE.Vector3;
        pointB: THREE.Vector3;
      }> = [];
      for (let indexA = 0; indexA < agreementSamples; indexA += 1) {
        consensusBraidPoint(specs[pair], indexA / agreementSamples * TAU, sampleA);
        for (let indexB = 0; indexB < agreementSamples; indexB += 1) {
          consensusBraidPoint(specs[pair + 1], indexB / agreementSamples * TAU, sampleB);
          const distanceSq = sampleA.distanceToSquared(sampleB);
          if (distanceSq > 0.035) continue;
          candidates.push({
            distanceSq,
            indexA,
            indexB,
            pointA: sampleA.clone(),
            pointB: sampleB.clone(),
          });
        }
      }
      candidates.sort((left, right) => left.distanceSq - right.distanceSq);
      const chosen: typeof candidates = [];
      for (const candidate of candidates) {
        const tooClose = chosen.some((existing) => (
          Math.abs(existing.indexA - candidate.indexA) < 8
          || Math.abs(existing.indexB - candidate.indexB) < 8
        ));
        if (tooClose) continue;
        chosen.push(candidate);
        if (chosen.length >= agreementsPerPair) break;
      }
      for (let index = 0; index < chosen.length; index += 1) {
        const agreement = chosen[index];
        agreementPositions.push(
          ...agreement.pointA.toArray(),
          ...agreement.pointB.toArray(),
        );
        color.copy(pale).lerp(paleGold, (pair + index) % 2 === 0 ? 0.46 : 0.16);
        agreementColors.push(color.r, color.g, color.b, color.r, color.g, color.b);
        knot.addVectors(agreement.pointA, agreement.pointB).multiplyScalar(0.5);
        knotPositions.push(...knot.toArray());
        knotColors.push(color.r, color.g, color.b);
      }
    }

    const ribbonGeometry = new THREE.BufferGeometry();
    ribbonGeometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(ribbonPositions, 3),
    );
    ribbonGeometry.setAttribute(
      'color',
      new THREE.Float32BufferAttribute(ribbonColors, 3),
    );
    ribbonGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1.1);
    const ribbonMaterial = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: Math.max(0.25, 0.38 - (count - 3) * 0.05),
      blending: THREE.NormalBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
      toneMapped: false,
    });
    const streamGeometry = new LineSegmentsGeometry();
    streamGeometry.setPositions(streamPositions);
    streamGeometry.setColors(streamColors);
    streamGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1.1);
    const streamGlowMaterial = makeLineMaterial(4.8, 0.045);
    const streamCoreMaterial = makeLineMaterial(0.72, 0.74 - (count - 3) * 0.1);
    const streamGlow = new LineSegments2(streamGeometry, streamGlowMaterial);
    const streamCore = new LineSegments2(streamGeometry, streamCoreMaterial);
    streamGlow.frustumCulled = false;
    streamCore.frustumCulled = false;
    streamGlow.renderOrder = 1;
    streamCore.renderOrder = 2;
    const stitchGeometry = new LineSegmentsGeometry();
    stitchGeometry.setPositions(stitchPositions);
    stitchGeometry.setColors(stitchColors);
    stitchGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1.1);
    const stitchGlowMaterial = makeLineMaterial(3.4, 0.055);
    const stitchCoreMaterial = makeLineMaterial(0.64, 0.72);
    const stitchGlow = new LineSegments2(stitchGeometry, stitchGlowMaterial);
    const stitchCore = new LineSegments2(stitchGeometry, stitchCoreMaterial);
    stitchGlow.frustumCulled = false;
    stitchCore.frustumCulled = false;
    stitchGlow.renderOrder = 2;
    stitchCore.renderOrder = 3;

    const agreementGeometry = new LineSegmentsGeometry();
    agreementGeometry.setPositions(agreementPositions);
    agreementGeometry.setColors(agreementColors);
    agreementGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 0.8);
    const agreementGlowMaterial = makeLineMaterial(8.4, 0.13);
    const agreementCoreMaterial = makeLineMaterial(1.3, 0.96);
    const agreementGlow = new LineSegments2(agreementGeometry, agreementGlowMaterial);
    const agreementCore = new LineSegments2(agreementGeometry, agreementCoreMaterial);
    agreementGlow.frustumCulled = false;
    agreementCore.frustumCulled = false;
    agreementGlow.renderOrder = 4;
    agreementCore.renderOrder = 5;

    const knotGeometry = new THREE.BufferGeometry();
    knotGeometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(knotPositions, 3),
    );
    knotGeometry.setAttribute(
      'color',
      new THREE.Float32BufferAttribute(knotColors, 3),
    );
    knotGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 0.5);
    const knotGlowMaterial = new THREE.PointsMaterial({
      size: 0.058,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: 0.18,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const knotCoreMaterial = new THREE.PointsMaterial({
      size: 0.014,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: 0.98,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const packetGeometry = new THREE.BoxGeometry(0.03, 0.006, 0.012);
    const packetMaterial = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    return {
      specs,
      ribbonGeometry,
      ribbonMaterial,
      streamGeometry,
      streamGlowMaterial,
      streamCoreMaterial,
      streamGlow,
      streamCore,
      stitchGeometry,
      stitchGlowMaterial,
      stitchCoreMaterial,
      stitchGlow,
      stitchCore,
      agreementGeometry,
      agreementGlowMaterial,
      agreementCoreMaterial,
      agreementGlow,
      agreementCore,
      knotGeometry,
      knotGlowMaterial,
      knotCoreMaterial,
      packetGeometry,
      packetMaterial,
    };
  }, [visual]);

  // Every live Cell has at least one ledger packet even when data_hex is empty;
  // additional packets encode observed payload density.
  const packetCount = Math.min(
    MAX_PACKETS,
    Math.max(1, Math.round(visual.payload * MAX_PACKETS)),
  );
  const presence = 1.02 + (visual.mass - 0.84) * 0.32;
  const birthPhase = consensusBraidBirthPhase(cell.birth_block);
  const life = cell.death_at_ms === null ? 1 : 0.52;

  useEffect(() => {
    const mesh = packetsRef.current;
    if (!mesh) return;
    const cyan = new THREE.Color(0.36, 0.92, 1);
    const gold = new THREE.Color(0.96, 0.72, 0.31);
    for (let i = 0; i < packetCount; i += 1) {
      mesh.setColorAt(i, i % 3 === 0 ? gold : cyan);
    }
    mesh.count = packetCount;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [packetCount]);

  useFrame((state, deltaSeconds) => {
    const time = reducedMotion ? 0 : state.clock.elapsedTime;
    for (const material of [
      built.streamGlowMaterial,
      built.streamCoreMaterial,
      built.stitchGlowMaterial,
      built.stitchCoreMaterial,
      built.agreementGlowMaterial,
      built.agreementCoreMaterial,
    ]) {
      material.resolution.set(state.size.width, state.size.height);
    }

    const target = consensusBraidLayerOpacity(focusField, built.specs.length);
    const blend = reducedMotion
      ? 1
      : 1 - Math.exp(-Math.min(0.1, deltaSeconds) * 11);
    const approach = (material: { opacity: number }, opacity: number) => {
      material.opacity += (opacity - material.opacity) * blend;
    };
    approach(built.ribbonMaterial, target.ribbon * life);
    approach(built.streamGlowMaterial, target.streamGlow * life);
    approach(built.streamCoreMaterial, target.streamCore * life);
    approach(built.stitchGlowMaterial, target.stitchGlow * life);
    approach(built.stitchCoreMaterial, target.stitchCore * life);
    approach(built.agreementGlowMaterial, target.agreementGlow * life);
    approach(built.agreementCoreMaterial, target.agreementCore * life);
    approach(built.knotGlowMaterial, target.knotGlow * life);
    approach(built.knotCoreMaterial, target.knotCore * life);
    approach(built.packetMaterial, target.packet * life);

    if (rootRef.current) {
      rootRef.current.rotation.y = (visual.seeds[2] - 0.5) * 0.34
        + Math.sin(time * 0.12) * 0.12;
      rootRef.current.rotation.x = (visual.seeds[0] - 0.5) * 0.24;
      const statePulse = focusField === 'state' && life === 1 && !reducedMotion
        ? 1 + Math.sin(time * 2.2) * 0.025
        : 1;
      rootRef.current.scale.setScalar(presence * statePulse);
    }
    const mesh = packetsRef.current;
    if (!mesh || packetCount === 0 || built.specs.length === 0) return;
    for (let i = 0; i < packetCount; i += 1) {
      const spec = built.specs[i % built.specs.length];
      const t = (
        birthPhase
        + i / packetCount * TAU
        + time * (0.065 + visual.payload * 0.03)
      ) % TAU;
      consensusBraidPoint(spec, t, PACKET_POSITION);
      consensusBraidPoint(spec, t + 0.003, PACKET_TANGENT)
        .sub(PACKET_POSITION)
        .normalize();
      PACKET_QUATERNION.setFromUnitVectors(X_AXIS, PACKET_TANGENT);
      PACKET_SCALE.setScalar((i + Math.floor(time * 2)) % 4 === 0 ? 1.2 : 0.7);
      PACKET_MATRIX.compose(PACKET_POSITION, PACKET_QUATERNION, PACKET_SCALE);
      mesh.setMatrixAt(i, PACKET_MATRIX);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  useEffect(() => () => {
    built.ribbonGeometry.dispose();
    built.ribbonMaterial.dispose();
    built.streamGeometry.dispose();
    built.streamGlowMaterial.dispose();
    built.streamCoreMaterial.dispose();
    built.stitchGeometry.dispose();
    built.stitchGlowMaterial.dispose();
    built.stitchCoreMaterial.dispose();
    built.agreementGeometry.dispose();
    built.agreementGlowMaterial.dispose();
    built.agreementCoreMaterial.dispose();
    built.knotGeometry.dispose();
    built.knotGlowMaterial.dispose();
    built.knotCoreMaterial.dispose();
    built.packetGeometry.dispose();
    built.packetMaterial.dispose();
  }, [built]);

  return (
    <group ref={rootRef} scale={presence}>
      <mesh
        geometry={built.ribbonGeometry}
        material={built.ribbonMaterial}
        frustumCulled={false}
      />
      <primitive object={built.streamGlow} />
      <primitive object={built.streamCore} />
      <primitive object={built.stitchGlow} />
      <primitive object={built.stitchCore} />
      <primitive object={built.agreementGlow} />
      <primitive object={built.agreementCore} />
      <points
        geometry={built.knotGeometry}
        material={built.knotGlowMaterial}
        frustumCulled={false}
        renderOrder={6}
      />
      <points
        geometry={built.knotGeometry}
        material={built.knotCoreMaterial}
        frustumCulled={false}
        renderOrder={7}
      />
      <instancedMesh
        ref={packetsRef}
        args={[built.packetGeometry, built.packetMaterial, MAX_PACKETS]}
        frustumCulled={false}
        renderOrder={8}
      />
    </group>
  );
}
