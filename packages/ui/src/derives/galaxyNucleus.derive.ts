import * as THREE from 'three';
import type { Cell } from '@cknerv/types';
import { deriveCellVisual } from './cellVisual.derive';
import {
  CONSENSUS_BRAID_PALETTE,
  CONSENSUS_BRAID_TAU,
  consensusBraidContributorColor,
  consensusBraidPoint,
  consensusBraidSpecs,
} from './consensusBraid.derive';

export interface GalaxyNucleusBuffers {
  linePos: Float32Array;
  lineCol: Float32Array;
  nodePos: Float32Array;
  nodeSize: Float32Array;
  nodeAlpha: Float32Array;
}

export interface GalaxyNucleusCursor {
  lineVertices: number;
  nodes: number;
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
}

const lerp = (from: number, to: number, amount: number): number => (
  from + (to - from) * amount
);

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Build once per immutable Cell; frame updates only copy into fixed buffers. */
export function deriveGalaxyConsensusBraid(cell: Cell): GalaxyConsensusBraid {
  const visual = deriveCellVisual(cell);
  const specs = consensusBraidSpecs(visual);
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

  const agreementSamples = 40;
  const agreementsPerPair = 1 + Math.round(visual.payload);
  const sampleA = new THREE.Vector3();
  const sampleB = new THREE.Vector3();
  const midpoint = new THREE.Vector3();
  for (let pair = 0; pair < specs.length - 1; pair += 1) {
    const candidates: Array<{
      distanceSq: number;
      indexA: number;
      indexB: number;
      pointA: THREE.Vector3;
      pointB: THREE.Vector3;
    }> = [];
    for (let indexA = 0; indexA < agreementSamples; indexA += 1) {
      consensusBraidPoint(
        specs[pair],
        indexA / agreementSamples * CONSENSUS_BRAID_TAU,
        sampleA,
      );
      for (let indexB = 0; indexB < agreementSamples; indexB += 1) {
        consensusBraidPoint(
          specs[pair + 1],
          indexB / agreementSamples * CONSENSUS_BRAID_TAU,
          sampleB,
        );
        const distanceSq = sampleA.distanceToSquared(sampleB);
        if (distanceSq > 0.04) continue;
        candidates.push({
          distanceSq,
          indexA,
          indexB,
          pointA: sampleA.clone(),
          pointB: sampleB.clone(),
        });
      }
    }
    candidates.sort((leftCandidate, rightCandidate) => (
      leftCandidate.distanceSq - rightCandidate.distanceSq
    ));
    const chosen: typeof candidates = [];
    for (const candidate of candidates) {
      if (chosen.some((existing) => (
        Math.abs(existing.indexA - candidate.indexA) < 6
        || Math.abs(existing.indexB - candidate.indexB) < 6
      ))) continue;
      chosen.push(candidate);
      if (chosen.length >= agreementsPerPair) break;
    }
    for (const agreement of chosen) {
      addSegment(
        agreement.pointA,
        agreement.pointB,
        CONSENSUS_BRAID_PALETTE.pale,
        0.9,
      );
      midpoint.addVectors(agreement.pointA, agreement.pointB).multiplyScalar(0.5);
      knots.push({
        x: midpoint.x,
        y: midpoint.y,
        z: midpoint.z,
        size: 0.045 + visual.payload * 0.018,
        alpha: 0.9,
      });
    }
  }

  return { segments, colors, detailWeights, knots };
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
  );
  const midVisibility = smoothstep(0.02, 0.7, detail);
  const nearVisibility = smoothstep(0.38, 1, detail);
  const life = cell.death_at_ms === null ? 1 : 0.56;
  const [originX, originY, originZ] = cell.pos_seed;

  for (
    let segment = 0;
    segment * 6 + 5 < braid.segments.length && lineVertices + 2 <= lineVertexCap;
    segment += 1
  ) {
    const sourceOffset = segment * 6;
    const weight = braid.detailWeights[segment] ?? 0;
    const visibility = lerp(midVisibility, nearVisibility, weight) * life;
    for (let endpoint = 0; endpoint < 2; endpoint += 1) {
      const source = sourceOffset + endpoint * 3;
      const target = lineVertices * 3;
      buffers.linePos[target] = originX + braid.segments[source] * scale;
      buffers.linePos[target + 1] = originY + braid.segments[source + 1] * scale;
      buffers.linePos[target + 2] = originZ + braid.segments[source + 2] * scale;
      buffers.lineCol[target] = braid.colors[source] * visibility;
      buffers.lineCol[target + 1] = braid.colors[source + 1] * visibility;
      buffers.lineCol[target + 2] = braid.colors[source + 2] * visibility;
      lineVertices += 1;
    }
  }

  for (const knot of braid.knots) {
    if (nodes >= nodeCap) break;
    buffers.nodePos[nodes * 3] = originX + knot.x * scale;
    buffers.nodePos[nodes * 3 + 1] = originY + knot.y * scale;
    buffers.nodePos[nodes * 3 + 2] = originZ + knot.z * scale;
    buffers.nodeSize[nodes] = knot.size * scale * 2;
    buffers.nodeAlpha[nodes] = knot.alpha * nearVisibility * life;
    nodes += 1;
  }

  cursor.lineVertices = lineVertices;
  cursor.nodes = nodes;
  return cursor;
}
