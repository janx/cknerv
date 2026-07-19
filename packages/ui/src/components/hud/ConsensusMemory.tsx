import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { Cell } from '@cknerv/types';
import { deriveCellVisual } from '../../derives/cellVisual.derive';
import {
  consensusMemoryPortraitLayerOpacity,
  consensusMemoryPortraitResponse,
} from '../../derives/consensusMemoryPortrait.derive';
import {
  consensusMemoryEvidenceBindings,
  consensusMemoryEvidenceColor,
  consensusMemoryEvidenceCssColor,
} from '../../derives/consensusMemoryEvidence.derive';
import {
  CONSENSUS_BRAID_PALETTE,
  CONSENSUS_BRAID_TAU,
  consensusBraidAgreementResolution,
  consensusBraidContributorColor,
  consensusBraidLayerOpacity,
  consensusBraidPoint,
  deriveConsensusBraidTopology,
  type ConsensusBraidField,
  type ConsensusBraidSpec,
} from '../../derives/consensusBraid.derive';
import {
  consensusMemoryEvidenceFocusScale,
  type ConsensusMemoryCellResponseRef,
  type ConsensusMemoryTraceReadout,
} from '../../nerve/consensusMemoryTrace';

const TAU = CONSENSUS_BRAID_TAU;
const MAX_PACKETS = 14;
const PACKET_MATRIX = new THREE.Matrix4();
const PACKET_POSITION = new THREE.Vector3();
const PACKET_TANGENT = new THREE.Vector3();
const PACKET_QUATERNION = new THREE.Quaternion();
const PACKET_SCALE = new THREE.Vector3();
const X_AXIS = new THREE.Vector3(1, 0, 0);
const READ_HEAD_TRAIL = 5;
const READ_HEAD_MATRIX = new THREE.Matrix4();
const READ_HEAD_POSITION = new THREE.Vector3();
const READ_HEAD_TANGENT = new THREE.Vector3();
const READ_HEAD_QUATERNION = new THREE.Quaternion();
const READ_HEAD_SCALE = new THREE.Vector3();

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
  traceReadout = null,
  traceResponseRef,
  traceEvidenceFocusSourceId = null,
}: {
  cell: Cell;
  reducedMotion: boolean;
  focusField?: ConsensusBraidField | null;
  traceReadout?: ConsensusMemoryTraceReadout | null;
  traceResponseRef?: ConsensusMemoryCellResponseRef;
  traceEvidenceFocusSourceId?: number | null;
}) {
  const rootRef = useRef<THREE.Group>(null);
  const packetsRef = useRef<THREE.InstancedMesh>(null);
  const readHeadsRef = useRef<THREE.InstancedMesh>(null);
  const focusedKnotRef = useRef<THREE.Group>(null);
  const focusedKnotOuterMaterialRef = useRef<THREE.MeshBasicMaterial>(null);
  const focusedKnotInnerMaterialRef = useRef<THREE.MeshBasicMaterial>(null);
  const evidenceLabelRefs = useRef<Array<HTMLDivElement | null>>([]);
  const recallStrengthRef = useRef(0);
  const recallConvergenceRef = useRef(0);
  const recallPhaseRef = useRef(0);
  const visual = useMemo(() => deriveCellVisual(cell), [cell]);
  const built = useMemo(() => {
    const topology = deriveConsensusBraidTopology(visual, cell.birth_block);
    const specs = topology.specs;
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

    // The constellation is canonical A topology. This portrait may draw the
    // paths at higher resolution, but it cannot invent different agreements
    // from the production galaxy LOD.
    for (const agreement of topology.agreements) {
      agreementPositions.push(...agreement.pointA, ...agreement.pointB);
      color.copy(pale).lerp(
        paleGold,
        (agreement.pair + agreement.ordinal) % 2 === 0 ? 0.46 : 0.16,
      );
      agreementColors.push(color.r, color.g, color.b, color.r, color.g, color.b);
      knotPositions.push(...agreement.midpoint);
      knotColors.push(color.r, color.g, color.b);
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
    const readHeadGeometry = new THREE.OctahedronGeometry(0.048, 0);
    const readHeadMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color(...CONSENSUS_BRAID_PALETTE.cyan),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    return {
      specs,
      agreementMidpoints: topology.agreements.map((agreement) => (
        [...agreement.midpoint] as [number, number, number]
      )),
      presenceScale: topology.presenceScale,
      birthPhase: topology.birthPhase,
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
      agreementBaseColors: new Float32Array(agreementColors),
      agreementGlowMaterial,
      agreementCoreMaterial,
      agreementGlow,
      agreementCore,
      knotGeometry,
      knotBaseColors: new Float32Array(knotColors),
      knotGlowMaterial,
      knotCoreMaterial,
      packetGeometry,
      packetMaterial,
      readHeadGeometry,
      readHeadMaterial,
    };
  }, [cell.birth_block, visual]);

  // Every live Cell has at least one ledger packet even when data_hex is empty;
  // additional packets encode observed payload density.
  const packetCount = Math.min(
    MAX_PACKETS,
    Math.max(1, Math.round(visual.payload * MAX_PACKETS)),
  );
  const presence = built.presenceScale;
  const birthPhase = built.birthPhase;
  const life = cell.death_at_ms === null ? 1 : 0.52;
  const evidenceBindings = useMemo(() => consensusMemoryEvidenceBindings(
    cell.content_hash,
    traceReadout?.targetCellId === cell.id ? traceReadout.evidence : [],
    built.agreementMidpoints.length,
  ), [
    built.agreementMidpoints.length,
    cell.content_hash,
    cell.id,
    traceReadout,
  ]);
  const focusedEvidenceBinding = useMemo(() => (
    traceEvidenceFocusSourceId === null
      ? null
      : evidenceBindings.find(
        (binding) => binding.sourceId === traceEvidenceFocusSourceId,
      ) ?? null
  ), [evidenceBindings, traceEvidenceFocusSourceId]);

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

    const blend = reducedMotion
      ? 1
      : 1 - Math.exp(-Math.min(0.1, deltaSeconds) * 11);
    const frameTarget = traceResponseRef?.current ?? null;
    const response = consensusMemoryPortraitResponse(
      traceResponseRef ? null : traceReadout,
      frameTarget?.targetCellId === cell.id ? frameTarget.response : null,
    );
    const responseStrength = Math.max(0, Math.min(1, response?.strength ?? 0));
    const responseConvergence = Math.max(
      0,
      Math.min(1, response?.convergence ?? 0),
    );
    recallStrengthRef.current += (
      responseStrength - recallStrengthRef.current
    ) * blend;
    recallConvergenceRef.current += (
      responseConvergence - recallConvergenceRef.current
    ) * blend;
    if (response) recallPhaseRef.current = response.phase;
    const recallStrength = recallStrengthRef.current;
    const recallConvergence = recallConvergenceRef.current;
    const focusedKnot = focusedKnotRef.current;
    if (focusedKnot) {
      const pulse = reducedMotion ? 1 : 0.94 + Math.sin(time * 3.1) * 0.06;
      focusedKnot.scale.setScalar(pulse);
      focusedKnot.rotation.z = reducedMotion ? 0 : time * 0.28;
    }
    if (focusedKnotOuterMaterialRef.current) {
      focusedKnotOuterMaterialRef.current.opacity += (
        recallStrength * 0.58 - focusedKnotOuterMaterialRef.current.opacity
      ) * blend;
    }
    if (focusedKnotInnerMaterialRef.current) {
      focusedKnotInnerMaterialRef.current.opacity += (
        recallStrength * 0.94 - focusedKnotInnerMaterialRef.current.opacity
      ) * blend;
    }
    evidenceLabelRefs.current.forEach((label, index) => {
      if (!label) return;
      const binding = evidenceBindings[index];
      const evidenceConvergence = binding
        ? response?.evidence?.[binding.evidenceIndex]?.convergence ?? 0
        : 0;
      const evidenceFocusScale = consensusMemoryEvidenceFocusScale(
        binding?.sourceId ?? null,
        traceEvidenceFocusSourceId,
      );
      label.style.opacity = (
        recallStrength * (0.42 + Math.max(0, Math.min(1, evidenceConvergence)) * 0.58)
        * evidenceFocusScale
      ).toFixed(3);
    });
    const target = consensusMemoryPortraitLayerOpacity(
      consensusBraidLayerOpacity(focusField, built.specs.length),
      recallStrength,
      recallConvergence,
    );
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

    // The exact canonical agreements used by production A turn from each
    // source's cool identity lane into pale-gold verified knots.
    const agreementColorAttribute = built.agreementGeometry.getAttribute(
      'instanceColorStart',
    ) as THREE.InterleavedBufferAttribute | undefined;
    const agreementColors = agreementColorAttribute?.data.array as
      | Float32Array
      | undefined;
    const agreementCount = Math.floor(built.agreementBaseColors.length / 6);
    if (
      agreementColorAttribute
      && agreementColors
      && agreementColors.length === built.agreementBaseColors.length
    ) {
      for (let index = 0; index < agreementCount; index += 1) {
        const binding = evidenceBindings.find(
          (candidate) => candidate.knotIndex === index,
        );
        const evidenceConvergence = binding
          ? response?.evidence?.[binding.evidenceIndex]?.convergence
          : undefined;
        const resolved = typeof evidenceConvergence === 'number'
          && Number.isFinite(evidenceConvergence)
          ? Math.max(0, Math.min(1, evidenceConvergence))
          : consensusBraidAgreementResolution(
            index,
            agreementCount,
            recallConvergence,
          );
        const evidenceColor = binding
          ? consensusMemoryEvidenceColor(binding.evidenceIndex)
          : CONSENSUS_BRAID_PALETTE.cyan;
        const evidenceFocusScale = consensusMemoryEvidenceFocusScale(
          binding?.sourceId ?? null,
          traceEvidenceFocusSourceId,
        );
        const structureScale = 1
          - recallStrength * (1 - evidenceFocusScale) * 0.82;
        const memoryMix = recallStrength
          * (0.72 + resolved * 0.28)
          * evidenceFocusScale;
        for (let endpoint = 0; endpoint < 2; endpoint += 1) {
          for (let channel = 0; channel < 3; channel += 1) {
            const offset = index * 6 + endpoint * 3 + channel;
            const cold = evidenceColor[channel];
            const gold = CONSENSUS_BRAID_PALETTE.paleGold[channel];
            const memoryColor = cold + (gold - cold) * resolved;
            const baseline = built.agreementBaseColors[offset] * structureScale;
            const colorTarget = baseline
              + (memoryColor - baseline) * memoryMix;
            agreementColors[offset] += (colorTarget - agreementColors[offset]) * blend;
          }
        }
      }
      agreementColorAttribute.data.needsUpdate = true;
    }

    const knotColorAttribute = built.knotGeometry.getAttribute(
      'color',
    ) as THREE.BufferAttribute;
    const knotColors = knotColorAttribute.array as Float32Array;
    const knotCount = Math.floor(built.knotBaseColors.length / 3);
    for (let index = 0; index < knotCount; index += 1) {
      const binding = evidenceBindings.find(
        (candidate) => candidate.knotIndex === index,
      );
      const evidenceConvergence = binding
        ? response?.evidence?.[binding.evidenceIndex]?.convergence
        : undefined;
      const resolved = typeof evidenceConvergence === 'number'
        && Number.isFinite(evidenceConvergence)
        ? Math.max(0, Math.min(1, evidenceConvergence))
        : consensusBraidAgreementResolution(
          index,
          knotCount,
          recallConvergence,
        );
      const evidenceColor = binding
        ? consensusMemoryEvidenceColor(binding.evidenceIndex)
        : CONSENSUS_BRAID_PALETTE.cyan;
      const evidenceFocusScale = consensusMemoryEvidenceFocusScale(
        binding?.sourceId ?? null,
        traceEvidenceFocusSourceId,
      );
      const structureScale = 1
        - recallStrength * (1 - evidenceFocusScale) * 0.86;
      const memoryMix = recallStrength
        * (0.78 + resolved * 0.22)
        * evidenceFocusScale;
      for (let channel = 0; channel < 3; channel += 1) {
        const offset = index * 3 + channel;
        const cold = evidenceColor[channel];
        const gold = CONSENSUS_BRAID_PALETTE.paleGold[channel];
        const memoryColor = cold + (gold - cold) * resolved;
        const baseline = built.knotBaseColors[offset] * structureScale;
        const colorTarget = baseline + (memoryColor - baseline) * memoryMix;
        knotColors[offset] += (colorTarget - knotColors[offset]) * blend;
      }
    }
    knotColorAttribute.needsUpdate = knotCount > 0;
    built.knotGlowMaterial.size = 0.058 * (
      1 + recallStrength * (0.1 + recallConvergence * 0.42)
    );
    built.knotCoreMaterial.size = 0.014 * (
      1 + recallStrength * (0.18 + recallConvergence * 0.82)
    );

    // One flattened read head traverses the same contributor order used by
    // the production buffer writer. A short lozenge trail makes the scan
    // legible at portrait scale without adding a second topology.
    const readHeads = readHeadsRef.current;
    const scanEnergy = recallStrength
      * (1 - recallConvergence * 0.9)
      * (traceEvidenceFocusSourceId === null ? 1 : 0.22);
    if (readHeads && built.specs.length > 0 && scanEnergy > 0.01) {
      readHeads.count = READ_HEAD_TRAIL;
      built.readHeadMaterial.opacity = Math.min(1, scanEnergy * 0.96);
      for (let trail = 0; trail < READ_HEAD_TRAIL; trail += 1) {
        const unit = (
          recallPhaseRef.current - trail * 0.012 + 1
        ) % 1;
        const flattened = unit * built.specs.length;
        const strand = Math.min(
          built.specs.length - 1,
          Math.floor(flattened),
        );
        const t = (flattened - strand) * TAU;
        const spec = built.specs[strand];
        consensusBraidPoint(spec, t, READ_HEAD_POSITION);
        consensusBraidPoint(spec, t + 0.003, READ_HEAD_TANGENT)
          .sub(READ_HEAD_POSITION)
          .normalize();
        READ_HEAD_QUATERNION.setFromUnitVectors(X_AXIS, READ_HEAD_TANGENT);
        const tailScale = 1 - trail / (READ_HEAD_TRAIL + 0.25);
        READ_HEAD_SCALE.set(2.15, 0.72, 0.72).multiplyScalar(tailScale);
        READ_HEAD_MATRIX.compose(
          READ_HEAD_POSITION,
          READ_HEAD_QUATERNION,
          READ_HEAD_SCALE,
        );
        readHeads.setMatrixAt(trail, READ_HEAD_MATRIX);
      }
      readHeads.instanceMatrix.needsUpdate = true;
    } else if (readHeads) {
      readHeads.count = 0;
      built.readHeadMaterial.opacity = 0;
    }

    if (rootRef.current) {
      rootRef.current.rotation.y = (visual.seeds[2] - 0.5) * 0.34
        + Math.sin(time * 0.12) * 0.12;
      rootRef.current.rotation.x = (visual.seeds[0] - 0.5) * 0.24;
      const statePulse = focusField === 'state'
        && recallStrength < 0.01
        && life === 1
        && !reducedMotion
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
    built.readHeadGeometry.dispose();
    built.readHeadMaterial.dispose();
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
      <instancedMesh
        ref={readHeadsRef}
        args={[built.readHeadGeometry, built.readHeadMaterial, READ_HEAD_TRAIL]}
        frustumCulled={false}
        renderOrder={9}
      />
      {focusedEvidenceBinding ? (
        <group
          ref={focusedKnotRef}
          position={built.agreementMidpoints[focusedEvidenceBinding.knotIndex]}
        >
          <mesh renderOrder={11}>
            <ringGeometry args={[0.048, 0.054, 18]} />
            <meshBasicMaterial
              ref={focusedKnotOuterMaterialRef}
              color={consensusMemoryEvidenceCssColor(
                focusedEvidenceBinding.evidenceIndex,
              )}
              transparent
              opacity={0}
              blending={THREE.AdditiveBlending}
              depthTest={false}
              depthWrite={false}
              toneMapped={false}
            />
          </mesh>
          <mesh rotation={[0, 0, Math.PI / 4]} renderOrder={12}>
            <ringGeometry args={[0.025, 0.032, 4]} />
            <meshBasicMaterial
              ref={focusedKnotInnerMaterialRef}
              color="#E9FCFF"
              transparent
              opacity={0}
              blending={THREE.AdditiveBlending}
              depthTest={false}
              depthWrite={false}
              toneMapped={false}
            />
          </mesh>
        </group>
      ) : null}
      {evidenceBindings.map((binding, index) => {
        const evidence = traceReadout?.evidence[binding.evidenceIndex];
        if (!evidence) return null;
        const sourceColor = consensusMemoryEvidenceCssColor(binding.evidenceIndex);
        const focusState = traceEvidenceFocusSourceId === null
          ? 'idle'
          : traceEvidenceFocusSourceId === binding.sourceId
            ? 'active'
            : 'passive';
        const resolved = evidence.state === 'resolved';
        const stateGlyph = resolved
          ? '✓'
          : evidence.state === 'arrived'
            ? '·'
            : '↗';
        const offsetX = index % 2 === 0 ? '7px' : 'calc(-100% - 7px)';
        const offsetY = index % 3 === 0 ? '-13px' : index % 3 === 1 ? '3px' : '-3px';
        return (
          <Html
            key={`${traceReadout?.key}:${binding.sourceId}`}
            position={built.agreementMidpoints[binding.knotIndex]}
            zIndexRange={[5, 5]}
            occlude={false}
            style={{ pointerEvents: 'none' }}
          >
            <div
              ref={(node) => { evidenceLabelRefs.current[index] = node; }}
              data-memory-knot-evidence={binding.ordinal}
              data-memory-knot-index={binding.knotIndex + 1}
              data-memory-knot-state={evidence.state}
              data-memory-knot-focus={focusState}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 3,
                padding: '1px 3px 1px 2px',
                borderLeft: `1px solid ${sourceColor}`,
                background: focusState === 'active'
                  ? `linear-gradient(90deg, ${sourceColor}30, rgba(0, 3, 12, .84))`
                  : 'rgba(0, 3, 12, .74)',
                boxShadow: focusState === 'active'
                  ? `0 0 11px ${sourceColor}66`
                  : `0 0 7px ${sourceColor}33`,
                color: resolved ? '#FFD79A' : '#C9F8FF',
                fontFamily: '"JetBrains Mono Local", ui-monospace, monospace',
                fontSize: 6.4,
                lineHeight: 1.1,
                letterSpacing: 0.35,
                opacity: 0,
                transform: `translate(${offsetX}, ${offsetY})`,
                whiteSpace: 'nowrap',
              }}
            >
              <span style={{ color: sourceColor }}>
                {String(binding.ordinal).padStart(2, '0')}
              </span>
              <span>◇K{String(binding.knotIndex + 1).padStart(2, '0')}</span>
              <span style={{ color: resolved ? '#FFD79A' : sourceColor }}>
                {stateGlyph}
              </span>
            </div>
          </Html>
        );
      })}
    </group>
  );
}
