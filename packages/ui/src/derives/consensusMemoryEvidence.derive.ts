import { fnv1a } from '../geometry/edgeBezier';

export interface ConsensusMemoryEvidenceIdentity {
  sourceId: number;
  ordinal: number;
  contentHash: string;
}
export interface ConsensusMemoryEvidenceBinding {
  evidenceIndex: number;
  sourceId: number;
  ordinal: number;
  contentHash: string;
  knotIndex: number;
}

export const CONSENSUS_MEMORY_EVIDENCE_COLORS = [
  [0.18, 0.82, 1],
  [0.58, 0.38, 1],
  [0.38, 0.68, 1],
] as const;

function greatestCommonDivisor(left: number, right: number): number {
  let a = Math.abs(Math.trunc(left));
  let b = Math.abs(Math.trunc(right));
  while (b !== 0) [a, b] = [b, a % b];
  return a;
}

/** A compact chain-derived identity for the evidence ledger. */
export function consensusMemoryEvidenceFingerprint(contentHash: string): string {
  const body = contentHash.replace(/^0x/i, '').toUpperCase();
  if (body.length <= 12) return body || 'UNAVAILABLE';
  return `${body.slice(0, 7)}·${body.slice(-4)}`;
}

export function consensusMemoryEvidenceColor(
  evidenceIndex: number,
): readonly [number, number, number] {
  const index = Number.isFinite(evidenceIndex)
    ? Math.max(0, Math.trunc(evidenceIndex))
    : 0;
  return CONSENSUS_MEMORY_EVIDENCE_COLORS[
    index % CONSENSUS_MEMORY_EVIDENCE_COLORS.length
  ];
}

export function consensusMemoryEvidenceCssColor(evidenceIndex: number): string {
  const color = consensusMemoryEvidenceColor(evidenceIndex);
  return `rgb(${color.map((channel) => Math.round(channel * 255)).join(' ')})`;
}

/**
 * Bind each real source identity to one canonical agreement knot. Hash seeding
 * makes the assignment target-specific and stable; coprime probing keeps the
 * first bindings unique whenever the existing topology has enough knots.
 */
export function consensusMemoryEvidenceBindings(
  targetContentHash: string,
  evidence: readonly ConsensusMemoryEvidenceIdentity[],
  agreementCount: number,
): ConsensusMemoryEvidenceBinding[] {
  const count = Number.isFinite(agreementCount)
    ? Math.max(0, Math.trunc(agreementCount))
    : 0;
  if (count === 0 || evidence.length === 0) return [];

  const occupied = new Set<number>();
  return evidence.map((source, evidenceIndex) => {
    const seed = fnv1a(
      `agreement:${targetContentHash}\x00${source.sourceId}\x00${source.contentHash}`,
    );
    let knotIndex = seed % count;
    if (occupied.size < count && occupied.has(knotIndex)) {
      let step = count <= 1 ? 1 : 1 + ((seed >>> 8) % (count - 1));
      while (greatestCommonDivisor(step, count) !== 1) {
        step = step % count + 1;
      }
      while (occupied.has(knotIndex)) knotIndex = (knotIndex + step) % count;
    }
    occupied.add(knotIndex);
    return {
      evidenceIndex,
      sourceId: source.sourceId,
      ordinal: source.ordinal,
      contentHash: source.contentHash,
      knotIndex,
    };
  });
}
