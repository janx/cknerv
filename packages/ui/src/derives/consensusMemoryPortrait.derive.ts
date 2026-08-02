import type {
  ConsensusMemoryCellResponse,
  ConsensusMemoryTraceReadout,
} from '../nerve/consensusMemoryTrace';
import type { ConsensusBraidLayerOpacity } from './consensusBraid.derive';
import { consensusMemoryCoreEnergy } from './consensusMemoryCore.derive';

const clampUnit = (value: number): number => Math.max(0, Math.min(1, value));

/**
 * Prefer the main Canvas' exact frame response. The stage-derived fallback is
 * used for reduced-motion/demand rendering and isolated portrait consumers;
 * it preserves semantics without inventing additional evidence.
 */
export function consensusMemoryPortraitResponse(
  readout: ConsensusMemoryTraceReadout | null,
  frameResponse: ConsensusMemoryCellResponse | null,
): ConsensusMemoryCellResponse | null {
  if (frameResponse?.role === 'target') return frameResponse;
  if (!readout) return null;

  const sourceCount = Math.max(1, readout.sourceCount);
  const arrived = clampUnit(readout.arrivedSourceCount / sourceCount);
  const resolved = clampUnit(readout.resolvedSourceCount / sourceCount);
  const convergence = readout.stage === 'locked'
    ? 1
    : readout.stage === 'converging'
      ? clampUnit(resolved + Math.max(0, arrived - resolved) * 0.55)
      : 0;
  const phase = readout.stage === 'reading'
    ? 0.16
    : readout.stage === 'converging'
      ? 0.46 + convergence * 0.18
      : 0.88;

  return {
    role: 'target',
    strength: 1,
    phase,
    convergence,
    evidence: readout.evidence.map((source) => ({
      sourceId: source.sourceId,
      ordinal: source.ordinal,
      contentHash: source.contentHash,
      convergence: source.state === 'resolved'
        ? 1
        : source.state === 'arrived'
          ? 0.5
          : 0,
    })),
  };
}

/** Transfer energy from the resting braid into reading and verified layers. */
export function consensusMemoryPortraitLayerOpacity(
  base: ConsensusBraidLayerOpacity,
  strength: number,
  convergence: number,
): ConsensusBraidLayerOpacity {
  const recall = clampUnit(strength);
  const { reading: readEnergy, retained: agreementEnergy } =
    consensusMemoryCoreEnergy(recall, convergence);
  return {
    ribbon: base.ribbon * (1 - recall * 0.7),
    streamGlow: Math.max(
      base.streamGlow * (1 - recall * 0.56),
      readEnergy * 0.045,
    ),
    // Ambient conduction yields to the evidence read-head instead of looking
    // like a second, unobserved chain event.
    streamFlow: base.streamFlow * (1 - recall * 0.72),
    streamCore: Math.max(
      base.streamCore * (1 - recall * 0.72),
      readEnergy * 0.28,
    ),
    stitchGlow: Math.max(
      base.stitchGlow * (1 - recall * 0.62),
      agreementEnergy * 0.085,
    ),
    stitchCore: Math.max(
      base.stitchCore * (1 - recall * 0.7),
      agreementEnergy * 0.56,
    ),
    agreementGlow: Math.max(
      base.agreementGlow * (1 - recall * 0.55),
      recall * 0.035 + agreementEnergy * 0.2,
    ),
    agreementCore: Math.max(
      base.agreementCore * (1 - recall * 0.74),
      recall * 0.24 + agreementEnergy * 0.74,
    ),
    knotGlow: Math.max(
      base.knotGlow * (1 - recall * 0.58),
      recall * 0.08 + agreementEnergy * 0.34,
    ),
    knotCore: Math.max(
      base.knotCore * (1 - recall * 0.72),
      recall * 0.28 + agreementEnergy * 0.72,
    ),
    packet: base.packet * (1 - recall * 0.58),
  };
}
