export const MEMORY_SOURCE_LABEL_GAP_PX = 38;
export const MEMORY_SOURCE_LABEL_MAX_SHIFT_PX = 48;
export const MEMORY_SOURCE_LABEL_RADIAL_SHIFT_PX = 28;

export interface ConsensusMemoryLabelAnchor {
  id: number;
  x?: number;
  y: number;
  width?: number;
  side?: 'left' | 'right';
}

function horizontalRange(anchor: ConsensusMemoryLabelAnchor): [number, number] {
  const x = anchor.x ?? 0;
  const width = Math.max(0, anchor.width ?? 1);
  return anchor.side === 'right' ? [x, x + width] : [x - width, x];
}

function labelsCollide(
  a: ConsensusMemoryLabelAnchor,
  b: ConsensusMemoryLabelAnchor,
  gap: number,
): boolean {
  if (Math.abs(a.y - b.y) >= gap) return false;
  const [aMin, aMax] = horizontalRange(a);
  const [bMin, bMax] = horizontalRange(b);
  return aMin < bMax && bMin < aMax;
}

/**
 * Resolve only real screen-space collisions. Isolated labels remain at their
 * Cell anchor; a crowded group is spread symmetrically around its original
 * centre and bounded so its leader never becomes a detached HUD element.
 */
export function layoutConsensusMemorySourceLabels(
  anchors: readonly ConsensusMemoryLabelAnchor[],
  minGapPx: number = MEMORY_SOURCE_LABEL_GAP_PX,
  maxShiftPx: number = MEMORY_SOURCE_LABEL_MAX_SHIFT_PX,
): Map<number, number> {
  const shifts = new Map(anchors.map(({ id }) => [id, 0]));
  const valid = anchors
    .filter(({ x = 0, y }) => Number.isFinite(x) && Number.isFinite(y))
    .slice()
    .sort((a, b) => a.y - b.y || a.id - b.id);
  const gap = Math.max(0, minGapPx);
  const maxShift = Math.max(0, maxShiftPx);

  const remaining = new Set(valid.map((_, index) => index));
  while (remaining.size > 0) {
    const seed = remaining.values().next().value as number;
    const queue = [seed];
    const component: number[] = [];
    remaining.delete(seed);
    while (queue.length > 0) {
      const current = queue.shift()!;
      component.push(current);
      for (const candidate of [...remaining]) {
        if (!labelsCollide(valid[current], valid[candidate], gap)) continue;
        remaining.delete(candidate);
        queue.push(candidate);
      }
    }
    const group = component.map((index) => valid[index])
      .sort((a, b) => a.y - b.y || a.id - b.id);
    if (group.length > 1) {
      const placed: number[] = [group[0].y];
      for (let index = 1; index < group.length; index += 1) {
        placed.push(Math.max(group[index].y, placed[index - 1] + gap));
      }
      const centreCorrection = placed.reduce(
        (sum, y, index) => sum + y - group[index].y,
        0,
      ) / group.length;
      group.forEach((anchor, index) => {
        const rawShift = placed[index] - centreCorrection - anchor.y;
        shifts.set(anchor.id, Math.max(-maxShift, Math.min(maxShift, rawShift)));
      });
    }
  }

  return shifts;
}
