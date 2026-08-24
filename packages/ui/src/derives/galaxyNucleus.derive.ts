import type { Cell } from '@cknerv/types';
import { deriveCellVisual, rotateAccentHue } from './cellVisual.derive';
import {
  CONSENSUS_BRAID_PALETTE,
  consensusBraidContributorColor,
  consensusBraidAgreementResolution,
  consensusBraidPathPoint,
  deriveConsensusBraidTopology,
} from './consensusBraid.derive';
import {
  CELL_MORPHOLOGY_MAX_SEGMENTS,
  type MorphologyPoint3,
} from './cellMorphology.derive';
import {
  consensusMemoryEvidenceBindings,
  type ConsensusMemoryEvidenceIdentity,
} from './consensusMemoryEvidence.derive';
import { consensusMemoryEvidenceFocusScale } from '../nerve/consensusMemoryTrace';
import { consensusMemoryCoreEnergy } from './consensusMemoryCore.derive';
import { consensusMemoryExpandedVisibility } from './consensusMemoryLod.derive';
import {
  CELL_EXPANDED_DETAIL_THRESHOLD,
  CELL_HOVER_FOCUS,
} from './cellInteraction.derive';

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

const GALAXY_BRAID_PATH_SEGMENTS = 60;

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
  const topology = deriveConsensusBraidTopology(cell);
  const segments: number[] = [];
  const colors: number[] = [];
  const detailWeights: number[] = [];
  const knots: GalaxyConsensusKnot[] = [];

  const addSegment = (
    from: MorphologyPoint3,
    to: MorphologyPoint3,
    color: readonly [number, number, number],
    detailWeight: number,
  ) => {
    segments.push(...from, ...to);
    colors.push(...color, ...color);
    detailWeights.push(detailWeight);
  };

  const markSegmentCount = topology.dataMarks.reduce(
    (count, mark) => count + (mark.kind === 'double_knot' ? 3 : 2),
    0,
  );
  // The cartouche is reserved BEFORE the paths are apportioned. A five-strand
  // lock at full data density already lands on 420 exactly, so an outline
  // added after this line would throw for the densest crafted cells; taken
  // out of the reserve it costs three path segments and nobody sees it.
  const mintMarkSegmentCount = topology.mintMark === null
    ? 0
    : topology.mintMark.points.length - 1;
  const auxiliarySegmentCount = topology.crossings.length
    + markSegmentCount
    + topology.agreements.length
    + mintMarkSegmentCount;
  const pathCount = topology.strands.length + 1;
  const pathSegments = Math.max(1, Math.min(
    GALAXY_BRAID_PATH_SEGMENTS,
    Math.floor((CELL_MORPHOLOGY_MAX_SEGMENTS - auxiliarySegmentCount) / pathCount),
  ));

  const addPath = (
    points: readonly MorphologyPoint3[],
    strand: number,
    detailWeight: number,
  ) => {
    for (let segment = 0; segment < pathSegments; segment += 1) {
      const t0 = segment / pathSegments;
      const t1 = (segment + 1) / pathSegments;
      const point = consensusBraidPathPoint(points, t0);
      const next = consensusBraidPathPoint(points, t1);
      const spectral = 0.5 + 0.5 * Math.sin(t0 * Math.PI * 2 * 1.4 + strand * 1.7);
      const contributor = consensusBraidContributorColor(strand, spectral);
      const color: readonly [number, number, number] = [
        lerp(contributor[0], visual.accent[0], 0.025),
        lerp(contributor[1], visual.accent[1], 0.025),
        lerp(contributor[2], visual.accent[2], 0.025),
      ];
      addSegment(point, next, color, detailWeight);
    }
  };

  // The macro type carrier and lock strands remain legible at mid LOD.
  addPath(topology.carrier, 0, 0);
  for (const strand of topology.strands) {
    addPath(strand.points, strand.index, strand.index === 0 ? 0 : 0.08);
  }

  // Lock crossings and data code are resolved by the existing near-LOD fade.
  for (const crossing of topology.crossings) {
    addSegment(
      crossing.pointA,
      crossing.pointB,
      consensusBraidContributorColor(crossing.pair, 0.82),
      0.76,
    );
  }
  for (const mark of topology.dataMarks) {
    addSegment(mark.point, mark.midpoint, CONSENSUS_BRAID_PALETTE.paleGold, 0.82);
    addSegment(mark.midpoint, mark.peerPoint, CONSENSUS_BRAID_PALETTE.paleGold, 0.82);
    if (mark.kind === 'double_knot') {
      addSegment(mark.point, mark.peerPoint, CONSENSUS_BRAID_PALETTE.gold, 0.86);
    }
  }

  // Production uses the exact same agreement constellation as the portrait.
  for (const agreement of topology.agreements) {
    addSegment(agreement.pointA, agreement.pointB, CONSENSUS_BRAID_PALETTE.pale, 0.9);
    knots.push({
      x: agreement.midpoint[0],
      y: agreement.midpoint[1],
      z: agreement.midpoint[2],
      size: 0.045 + topology.genome.data.density * 0.018,
      alpha: 0.9,
    });
  }

  // The maker's mark rides the same near-LOD fade as the rest of the code —
  // and since M2b it rides its collection's tint out here too. The galaxy
  // used to stamp every cartouche flat gold because a collection was only
  // ever a name a detail panel had loaded; `collection_seed` is on the Cell,
  // so the constellation reads at the distance the swarm is actually seen
  // from. It costs no vertex attribute: these colours are CPU-written.
  if (topology.mintMark !== null) {
    const { points, hueShift } = topology.mintMark;
    const mark = rotateAccentHue(CONSENSUS_BRAID_PALETTE.gold, hueShift);
    for (let step = 0; step < points.length - 1; step += 1) {
      addSegment(points[step], points[step + 1], mark, 0.88);
    }
  }

  if (detailWeights.length > CELL_MORPHOLOGY_MAX_SEGMENTS) {
    throw new Error('Cell Morphology V2 exceeded the production segment budget');
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
  interactionFocus = 0,
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
  const midVisibility = smoothstep(CELL_EXPANDED_DETAIL_THRESHOLD, 0.7, detail);
  const nearVisibility = consensusMemoryExpandedVisibility(detail);
  const life = cell.death_at_ms === null ? 1 : 0.56;
  const [originX, originY, originZ] = cell.pos_seed;
  const recallStrength = Math.max(0, Math.min(1, recall?.strength ?? 0));
  const recallPhase = ((recall?.phase ?? 0) % 1 + 1) % 1;
  const recallConvergence = Math.max(0, Math.min(1, recall?.convergence ?? 0));
  const focus = Number.isFinite(interactionFocus)
    ? Math.max(0, Math.min(1, interactionFocus))
    : 0;
  // The compact core already owns an interrupted focus ring. When camera LOD
  // has handed the Cell over to its real braid, carry that same interaction
  // directly through the contributor paths so hover cannot disappear with the
  // softened light. Hover reaches full signal at the shared 0.46 focus target;
  // selection adds a restrained lock increment instead of changing topology.
  const hoverSignal = smoothstep(0.02, CELL_HOVER_FOCUS, focus);
  const selectionSignal = smoothstep(CELL_HOVER_FOCUS, 1, focus);
  const interactionStrength = hoverSignal * 0.42 + selectionSignal * 0.18;
  const coreEnergy = consensusMemoryCoreEnergy(
    recallStrength,
    recallConvergence,
  );
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
    // Same gate as the interaction term below, for the same reason: with no
    // recall on this Cell every consumer of the read head multiplies it by
    // zero, so the resting LOD rewrite must not pay a distance and a Gaussian
    // per segment to arrive there.
    const readHead = recall === null
      ? 0
      : Math.exp(
        -Math.pow(circularUnitDistance(segmentPhase, recallPhase) / 0.055, 2),
      );
    const targetRead = recall?.role === 'target'
      ? coreEnergy.reading
        * readHead
        * (evidenceFocusSourceId === null ? 1 : 0.22)
        * nearVisibility
      : 0;
    const sourceRead = recall?.role === 'source'
      ? recallStrength * readHead
      : 0;
    const agreementRead = recall?.role === 'target' && weight > 0.7
      ? coreEnergy.retained * nearVisibility
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
    // Keep the resting 12 Hz LOD rewrite on its previous cheap path: the
    // interrupted phase work is paid only while hover/selection is active.
    const interactionEnergy = interactionStrength === 0
      ? 0
      : interactionStrength * (
        0.38 + 0.62 * smoothstep(
          -0.3,
          0.66,
          Math.sin(segmentPhase * Math.PI * 4 + cell.id * 0.17),
        )
      ) * midVisibility * life;
    const interactionTint = segmentPhase < 0.5
      ? CONSENSUS_BRAID_PALETTE.paleGold
      : CONSENSUS_BRAID_PALETTE.cyan;
    for (let endpoint = 0; endpoint < 2; endpoint += 1) {
      const source = sourceOffset + endpoint * 3;
      const target = lineVertices * 3;
      buffers.linePos[target] = originX + braid.segments[source] * scale;
      buffers.linePos[target + 1] = originY + braid.segments[source + 1] * scale;
      buffers.linePos[target + 2] = originZ + braid.segments[source + 2] * scale;
      buffers.lineCol[target] = braid.colors[source]
        * baseVisibility * baseVisibilityScale
        + memoryTint[0] * memoryEnergy
        + interactionTint[0] * interactionEnergy;
      buffers.lineCol[target + 1] = braid.colors[source + 1]
        * baseVisibility * baseVisibilityScale
        + memoryTint[1] * memoryEnergy
        + interactionTint[1] * interactionEnergy;
      buffers.lineCol[target + 2] = braid.colors[source + 2]
        * baseVisibility * baseVisibilityScale
        + memoryTint[2] * memoryEnergy
        + interactionTint[2] * interactionEnergy;
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
    const knotEnergy = consensusMemoryCoreEnergy(recallStrength, resolved);
    const recallAlpha = recall?.role === 'target'
      ? knot.alpha
        * (knotEnergy.reading * 0.12 + knotEnergy.retained * 0.88)
        * evidenceFocusScale
        * nearVisibility
        * life
      : 0;
    buffers.nodePos[nodes * 3] = originX + knot.x * scale;
    buffers.nodePos[nodes * 3 + 1] = originY + knot.y * scale;
    buffers.nodePos[nodes * 3 + 2] = originZ + knot.z * scale;
    buffers.nodeSize[nodes] = knot.size * scale * 2
      * (1 + (
        knotEnergy.reading * 0.12
          + knotEnergy.retained * 1.18
      ) * evidenceFocusScale);
    const contextScale = evidenceFocusSourceId === null
      ? 1
      : 0.22 + evidenceFocusScale * 0.78;
    buffers.nodeAlpha[nodes] = Math.max(
      knot.alpha * nearVisibility * life * contextScale,
      recallAlpha,
    );
    buffers.nodeResolve[nodes] = recall?.role === 'target'
      ? knotEnergy.retained * evidenceFocusScale
      : 0;
    nodes += 1;
  }

  cursor.lineVertices = lineVertices;
  cursor.nodes = nodes;
  return cursor;
}
