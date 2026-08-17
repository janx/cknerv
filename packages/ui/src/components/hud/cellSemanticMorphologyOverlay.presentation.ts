import type { ConsensusBraidField } from '../../derives/consensusBraid.derive';
import type { CellSemanticKnowledgeSegment } from '../../derives/cellSemanticMorphology.derive';

const MAX_KNOWLEDGE_ARC_GAP = 0.01;
const RELATIVE_KNOWLEDGE_ARC_GAP = 0.2;

export interface CellSemanticKnowledgeArcWindow {
  start: number;
  end: number;
}

/** The occupied-byte explanation is contextual evidence, not part of the
 * canonical braid. Keep it absent from the default portrait. */
export function cellSemanticKnowledgeRingVisible(
  focusField: ConsensusBraidField | null,
): boolean {
  return focusField === 'capacity' || focusField === 'data';
}

/** Inset both ends so adjacent byte roles read as separate arcs instead of
 * one unexplained construction circle. Tiny roles retain sixty percent of
 * their span rather than being swallowed by the fixed visual gap. */
export function cellSemanticKnowledgeArcWindow(
  segment: Pick<CellSemanticKnowledgeSegment, 'bytes' | 'start' | 'end'>,
): CellSemanticKnowledgeArcWindow | null {
  const span = segment.end - segment.start;
  if (segment.bytes <= 0 || !Number.isFinite(span) || span <= 0) return null;
  const gap = Math.min(MAX_KNOWLEDGE_ARC_GAP, span * RELATIVE_KNOWLEDGE_ARC_GAP);
  return {
    start: segment.start + gap,
    end: segment.end - gap,
  };
}
