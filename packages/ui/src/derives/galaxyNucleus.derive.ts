import * as THREE from 'three';
import type { Cell } from '@cknerv/types';
import { deriveCellVisual } from './cellVisual.derive';
import {
  CONSENSUS_BRAID_PALETTE,
  CONSENSUS_BRAID_TAU,
  consensusBraidContributorColor,
  consensusBraidAgreementResolution,
  deriveConsensusBraidTopology,
  consensusBraidPoint,
} from './consensusBraid.derive';
import {
  consensusMemoryEvidenceBindings,
  type ConsensusMemoryEvidenceIdentity,
} from './consensusMemoryEvidence.derive';
import { consensusMemoryEvidenceFocusScale } from '../nerve/consensusMemoryTrace';

export interface GalaxyNucleusBuffers {
  linePos: Float32Array;
  lineCol: Float32Array;
  nodePos: Float32Array;
  nodeSize: Float32Array;
  nodeAlpha: Float32Array;
  nodeResolve: Float32Array;
}

export interface GalaxyNucleusCursor {
  lineVertices: number;
  nodes: number;
}

export interface GalaxyNucleusRecallResponse {
  role: 'source' | 'target';
  strength: number;
  phase: number;
  convergence: number;
  evidence?: readonly (ConsensusMemoryEvidenceIdentity & {
    convergence: number;
  })[];
  evidenceFocusSourceId?: number | null;
}

export interface GalaxyConsensusKnot {
  x: number;
  y: number;
  z: number;
  size: number;
  alpha: number;
}

/** Cached local-space representation of A for one Cell. */
export interface GalaxyConsensusBraid {
  /** xyz xyz per segment. */
  segments: number[];
  /** rgb rgb per segment. */
  colors: number[];
  /** 0 = visible at mid LOD, 1 = reserved for near LOD. */
  detailWeights: number[];
  knots: GalaxyConsensusKnot[];
  /** Capacity-derived physical presence shared with the detail portrait. */
  presenceScale: number;
}

const lerp = (from: number, to: number, amount: number): number => (
  from + (to - from) * amount
);

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function circularUnitDistance(left: number, right: number): number {
  const direct = Math.abs(left - right);
  return Math.min(direct, 1 - direct);
}

/** Build once per immutable Cell; frame updates only copy into fixed buffers. */
export function deriveGalaxyConsensusBraid(cell: Cell): GalaxyConsensusBraid {
  const visual = deriveCellVisual(cell);
  const topology = deriveConsensusBraidTopology(visual, cell.birth_block);
  const specs = topology.specs;
  const segments: number[] = [];
  const colors: number[] = [];
  const detailWeights: number[] = [];
  const knots: GalaxyConsensusKnot[] = [];
  const point = new THREE.Vector3();
  const next = new THREE.Vector3();
  const previous = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const left = new THREE.Vector3();
  const right = new THREE.Vector3();
  const reference = new THREE.Vector3(0, 0, 1);
  const fallback = new THREE.Vector3(0, 1, 0);
  const steps = 64;

  const addSegment = (
    from: THREE.Vector3,
    to: THREE.Vector3,
    color: readonly [number, number, number],
    detailWeight: number,
  ) => {
    segments.push(from.x, from.y, from.z, to.x, to.y, to.z);
    colors.push(...color, ...color);
    detailWeights.push(detailWeight);
  };

  for (let strand = 0; strand < specs.length; strand += 1) {
    const spec = specs[strand];
    for (let segment = 0; segment < steps; segment += 1) {
      const t0 = segment / steps * CONSENSUS_BRAID_TAU;
      const t1 = (segment + 1) / steps * CONSENSUS_BRAID_TAU;
      consensusBraidPoint(spec, t0, point);
      consensusBraidPoint(spec, t1, next);
      const spectral = 0.5 + 0.5 * Math.sin(t0 * 1.4 + strand * 1.7);
      const contributor = consensusBraidContributorColor(strand, spectral);
      const color: readonly [number, number, number] = [
        lerp(contributor[0], visual.accent[0], 0.025),
        lerp(contributor[1], visual.accent[1], 0.025),
        lerp(contributor[2], visual.accent[2], 0.025),
      ];
      addSegment(point, next, color, 0);

      const stitchPeriod = Math.max(8, 16 - Math.round(visual.payload * 6));
      if ((segment + strand * 3) % stitchPeriod !== 0) continue;
      consensusBraidPoint(spec, t0 - 0.006, previous);
      consensusBraidPoint(spec, t0 + 0.006, next);
      tangent.subVectors(next, previous).normalize();
      normal.crossVectors(tangent, reference);
      if (normal.lengthSq() < 0.01) normal.crossVectors(tangent, fallback);
      normal.normalize().multiplyScalar(0.02 + visual.payload * 0.008);
      consensusBraidPoint(spec, t0, point);
      left.copy(point).add(normal);
      right.copy(point).sub(normal);
      addSegment(left, right, CONSENSUS_BRAID_PALETTE.paleGold, 0.72);
    }
  }

  // Production uses the exact same agreement constellation as the portrait;
  // only its contributor curves are sampled more coarsely for batching.
  for (const agreement of topology.agreements) {
    point.fromArray(agreement.pointA);
    next.fromArray(agreement.pointB);
    addSegment(point, next, CONSENSUS_BRAID_PALETTE.pale, 0.9);
    knots.push({
      x: agreement.midpoint[0],
      y: agreement.midpoint[1],
      z: agreement.midpoint[2],
      size: 0.045 + visual.payload * 0.018,
      alpha: 0.9,
    });
  }

  return {
    segments,
    colors,
    detailWeights,
    knots,
    presenceScale: topology.presenceScale,
  };
}

/**
 * Append one cached braid to fixed-capacity group-local buffers. Mid LOD shows
 * contributor paths; near LOD resolves stitches, agreement bridges and knots.
 */
export function writeGalaxyConsensusBraidBuffers(
  cell: Cell,
  braid: GalaxyConsensusBraid,
  detail: number,
  scale: number,
  buffers: GalaxyNucleusBuffers,
  cursor: GalaxyNucleusCursor,
  recall: GalaxyNucleusRecallResponse | null = null,
): GalaxyNucleusCursor {
  let lineVertices = cursor.lineVertices;
  let nodes = cursor.nodes;
  const lineVertexCap = Math.min(
    Math.floor(buffers.linePos.length / 3),
    Math.floor(buffers.lineCol.length / 3),
  );
  const nodeCap = Math.min(
    Math.floor(buffers.nodePos.length / 3),
    buffers.nodeSize.length,
    buffers.nodeAlpha.length,
    buffers.nodeResolve.length,
  );
  const midVisibility = smoothstep(0.02, 0.7, detail);
  const nearVisibility = smoothstep(0.38, 1, detail);
  const life = cell.death_at_ms === null ? 1 : 0.56;
  const [originX, originY, originZ] = cell.pos_seed;
  const recallStrength = Math.max(0, Math.min(1, recall?.strength ?? 0));
  const recallPhase = ((recall?.phase ?? 0) % 1 + 1) % 1;
  const recallConvergence = Math.max(0, Math.min(1, recall?.convergence ?? 0));
  const segmentCount = Math.max(1, Math.floor(braid.segments.length / 6));
  const evidenceBindings = recall?.role === 'target'
    ? consensusMemoryEvidenceBindings(
      cell.content_hash,
      recall.evidence ?? [],
      braid.knots.length,
    )
    : [];
  const evidenceFocusSourceId = recall?.role === 'target'
    ? recall.evidenceFocusSourceId ?? null
    : null;

  for (
    let segment = 0;
    segment * 6 + 5 < braid.segments.length && lineVertices + 2 <= lineVertexCap;
    segment += 1
  ) {
    const sourceOffset = segment * 6;
    const weight = braid.detailWeights[segment] ?? 0;
    const baseVisibility = lerp(midVisibility, nearVisibility, weight) * life;
    const segmentPhase = (segment + 0.5) / segmentCount;
    const phaseDistance = circularUnitDistance(segmentPhase, recallPhase);
    const readHead = Math.exp(-Math.pow(phaseDistance / 0.055, 2));
    const targetRead = recall?.role === 'target'
      ? recallStrength * readHead * (evidenceFocusSourceId === null ? 1 : 0.22)
      : 0;
    const sourceRead = recall?.role === 'source'
      ? recallStrength * readHead
      : 0;
    const agreementRead = recall?.role === 'target' && weight > 0.7
      ? recallStrength * recallConvergence
      : 0;
    const baseVisibilityScale = recall?.role === 'target'
      ? 1 - recallStrength * 0.62
      : 1;
    const memoryEnergy = (targetRead * 1.12 + sourceRead * 0.58 + agreementRead * 0.82)
      * life;
    const memoryTint: readonly [number, number, number] = agreementRead > 0
      ? CONSENSUS_BRAID_PALETTE.paleGold
      : recall?.role === 'source'
        ? CONSENSUS_BRAID_PALETTE.violet
        : CONSENSUS_BRAID_PALETTE.cyan;
    for (let endpoint = 0; endpoint < 2; endpoint += 1) {
      const source = sourceOffset + endpoint * 3;
      const target = lineVertices * 3;
      buffers.linePos[target] = originX + braid.segments[source] * scale;
      buffers.linePos[target + 1] = originY + braid.segments[source + 1] * scale;
      buffers.linePos[target + 2] = originZ + braid.segments[source + 2] * scale;
      buffers.lineCol[target] = braid.colors[source]
        * baseVisibility * baseVisibilityScale
        + memoryTint[0] * memoryEnergy;
      buffers.lineCol[target + 1] = braid.colors[source + 1]
        * baseVisibility * baseVisibilityScale
        + memoryTint[1] * memoryEnergy;
      buffers.lineCol[target + 2] = braid.colors[source + 2]
        * baseVisibility * baseVisibilityScale
        + memoryTint[2] * memoryEnergy;
      lineVertices += 1;
    }
  }

  for (let knotIndex = 0; knotIndex < braid.knots.length; knotIndex += 1) {
    const knot = braid.knots[knotIndex];
    if (nodes >= nodeCap) break;
    const binding = evidenceBindings.find(
      (candidate) => candidate.knotIndex === knotIndex,
    );
    const evidenceFocusScale = consensusMemoryEvidenceFocusScale(
      binding?.sourceId ?? null,
      evidenceFocusSourceId,
    );
    const evidenceResolution = binding
      ? recall?.evidence?.[binding.evidenceIndex]?.convergence
      : undefined;
    const resolved = typeof evidenceResolution === 'number'
      && Number.isFinite(evidenceResolution)
      ? Math.max(0, Math.min(1, evidenceResolution))
      : consensusBraidAgreementResolution(
        knotIndex,
        braid.knots.length,
        recallConvergence,
      );
    const recallAlpha = recall?.role === 'target'
      ? knot.alpha
        * recallStrength
        * (0.12 + resolved * 0.88)
        * evidenceFocusScale
        * life
      : 0;
    buffers.nodePos[nodes * 3] = originX + knot.x * scale;
    buffers.nodePos[nodes * 3 + 1] = originY + knot.y * scale;
    buffers.nodePos[nodes * 3 + 2] = originZ + knot.z * scale;
    buffers.nodeSize[nodes] = knot.size * scale * 2
      * (1 + recallStrength * (0.12 + resolved * 1.18) * evidenceFocusScale);
    const contextScale = evidenceFocusSourceId === null
      ? 1
      : 0.22 + evidenceFocusScale * 0.78;
    buffers.nodeAlpha[nodes] = Math.max(
      knot.alpha * nearVisibility * life * contextScale,
      recallAlpha,
    );
    buffers.nodeResolve[nodes] = recall?.role === 'target'
      ? recallStrength * resolved * evidenceFocusScale
      : 0;
    nodes += 1;
  }

  cursor.lineVertices = lineVertices;
  cursor.nodes = nodes;
  return cursor;
}
