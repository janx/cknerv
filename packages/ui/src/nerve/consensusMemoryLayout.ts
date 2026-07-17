export const MEMORY_SOURCE_LABEL_GAP_PX = 38;
export const MEMORY_SOURCE_LABEL_MAX_SHIFT_PX = 48;
export const MEMORY_SOURCE_LABEL_RADIAL_SHIFT_PX = 28;
export const MEMORY_LABEL_TOTAL_MAX_SHIFT_PX = 64;
export const MEMORY_LABEL_VIEWPORT_MARGIN_PX = 10;
export const MEMORY_LABEL_HUD_GAP_PX = 6;

export interface ConsensusMemoryScreenRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface ConsensusMemoryLabelSideOptions {
  x: number;
  y: number;
  width: number;
  height: number;
  preferredSide: 'left' | 'right';
  viewportWidth: number;
  obstacles?: readonly ConsensusMemoryScreenRect[];
  viewportMarginPx?: number;
  obstacleGapPx?: number;
  horizontalOffsetPx?: number;
}

export interface ConsensusMemoryLabelPlacementOptions
  extends ConsensusMemoryLabelSideOptions {
  viewportHeight: number;
  desiredShiftPx: number;
  maxShiftPx?: number;
}

export interface ConsensusMemoryLabelPlacement {
  side: 'left' | 'right';
  shift: number;
  rect: ConsensusMemoryScreenRect;
}

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

function overlapArea(
  a: ConsensusMemoryScreenRect,
  b: ConsensusMemoryScreenRect,
): number {
  const width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  return width * height;
}

function consensusMemoryLabelRect(
  x: number,
  y: number,
  width: number,
  height: number,
  side: 'left' | 'right',
  horizontalOffsetPx: number,
): ConsensusMemoryScreenRect {
  const offset = Math.max(0, horizontalOffsetPx);
  const nearestX = side === 'left' ? x - offset : x + offset;
  return {
    left: side === 'left' ? nearestX - width : nearestX,
    right: side === 'left' ? nearestX : nearestX + width,
    top: y - height / 2,
    bottom: y + height / 2,
  };
}

/**
 * Keep endpoint copy in the open scene rather than under a HUD panel. The
 * semantic side remains preferred; it flips only when the alternative has
 * materially less viewport overflow or measured DOM overlap.
 */
export function chooseConsensusMemoryLabelSide({
  x,
  y,
  width,
  height,
  preferredSide,
  viewportWidth,
  obstacles = [],
  viewportMarginPx = MEMORY_LABEL_VIEWPORT_MARGIN_PX,
  obstacleGapPx = MEMORY_LABEL_HUD_GAP_PX,
  horizontalOffsetPx = 0,
}: ConsensusMemoryLabelSideOptions): 'left' | 'right' {
  const safeWidth = Math.max(0, Number.isFinite(width) ? width : 0);
  const safeHeight = Math.max(0, Number.isFinite(height) ? height : 0);
  const margin = Math.max(0, viewportMarginPx);
  const gap = Math.max(0, obstacleGapPx);
  const viewport = Number.isFinite(viewportWidth) && viewportWidth > 0
    ? viewportWidth
    : Number.POSITIVE_INFINITY;

  const score = (side: 'left' | 'right'): number => {
    const rect = consensusMemoryLabelRect(
      x,
      y,
      safeWidth,
      safeHeight,
      side,
      horizontalOffsetPx,
    );
    const overflow = Math.max(0, margin - rect.left)
      + Math.max(0, rect.right - (viewport - margin));
    const obstruction = obstacles.reduce((total, obstacle) => total + overlapArea(
      rect,
      {
        left: obstacle.left - gap,
        top: obstacle.top - gap,
        right: obstacle.right + gap,
        bottom: obstacle.bottom + gap,
      },
    ), 0);
    // Viewport overflow is categorical; DOM overlap then decides between two
    // in-bounds candidates. A tiny tie cost preserves the semantic direction.
    return overflow * 100_000
      + obstruction
      + (side === preferredSide ? 0 : 0.001);
  };

  return score('left') <= score('right') ? 'left' : 'right';
}

/**
 * Find the nearest screen-space lane around a Cell anchor. Side changes and
 * short leader bends are allowed, but viewport bounds and measured HUD panels
 * remain hard visual constraints whenever a clear candidate exists.
 */
export function placeConsensusMemoryLabel({
  x,
  y,
  width,
  height,
  preferredSide,
  viewportWidth,
  viewportHeight,
  desiredShiftPx,
  maxShiftPx = MEMORY_LABEL_TOTAL_MAX_SHIFT_PX,
  obstacles = [],
  viewportMarginPx = MEMORY_LABEL_VIEWPORT_MARGIN_PX,
  obstacleGapPx = MEMORY_LABEL_HUD_GAP_PX,
  horizontalOffsetPx = 0,
}: ConsensusMemoryLabelPlacementOptions): ConsensusMemoryLabelPlacement {
  const safeWidth = Math.max(0, Number.isFinite(width) ? width : 0);
  const safeHeight = Math.max(0, Number.isFinite(height) ? height : 0);
  const margin = Math.max(0, viewportMarginPx);
  const gap = Math.max(0, obstacleGapPx);
  const limit = Math.max(0, maxShiftPx);
  const safeDesiredShift = Number.isFinite(desiredShiftPx) ? desiredShiftPx : 0;
  const viewportRight = Number.isFinite(viewportWidth) && viewportWidth > 0
    ? viewportWidth - margin
    : Number.POSITIVE_INFINITY;
  const viewportBottom = Number.isFinite(viewportHeight) && viewportHeight > 0
    ? viewportHeight - margin
    : Number.POSITIVE_INFINITY;
  const viewportMinShift = Number.isFinite(viewportHeight) && viewportHeight > 0
    ? Math.max(-limit, margin + safeHeight / 2 - y)
    : -limit;
  const viewportMaxShift = Number.isFinite(viewportHeight) && viewportHeight > 0
    ? Math.min(limit, viewportHeight - margin - safeHeight / 2 - y)
    : limit;
  const hasViewportLane = viewportMinShift <= viewportMaxShift;
  const lower = hasViewportLane ? viewportMinShift : -limit;
  const upper = hasViewportLane ? viewportMaxShift : limit;
  const clampShift = (value: number): number => Math.max(lower, Math.min(upper, value));
  const candidates = new Set<number>([
    clampShift(safeDesiredShift),
    clampShift(0),
    lower,
    upper,
  ]);
  for (const obstacle of obstacles) {
    candidates.add(clampShift(obstacle.top - gap - safeHeight / 2 - y));
    candidates.add(clampShift(obstacle.bottom + gap + safeHeight / 2 - y));
  }

  let best: ConsensusMemoryLabelPlacement | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const side of ['left', 'right'] as const) {
    for (const shift of candidates) {
      const rect = consensusMemoryLabelRect(
        x,
        y + shift,
        safeWidth,
        safeHeight,
        side,
        horizontalOffsetPx,
      );
      const overflow = Math.max(0, margin - rect.left)
        + Math.max(0, rect.right - viewportRight)
        + Math.max(0, margin - rect.top)
        + Math.max(0, rect.bottom - viewportBottom);
      const obstruction = obstacles.reduce((total, obstacle) => total + overlapArea(
        rect,
        {
          left: obstacle.left - gap,
          top: obstacle.top - gap,
          right: obstacle.right + gap,
          bottom: obstacle.bottom + gap,
        },
      ), 0);
      const score = overflow * 1_000_000_000
        + (obstruction > 0 ? 10_000_000 : 0)
        + obstruction * 1_000
        + Math.abs(shift - safeDesiredShift)
        + (side === preferredSide ? 0 : 0.001);
      if (score < bestScore) {
        bestScore = score;
        best = { side, shift, rect };
      }
    }
  }

  return best ?? {
    side: preferredSide,
    shift: clampShift(safeDesiredShift),
    rect: consensusMemoryLabelRect(
      x,
      y + clampShift(safeDesiredShift),
      safeWidth,
      safeHeight,
      preferredSide,
      horizontalOffsetPx,
    ),
  };
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
