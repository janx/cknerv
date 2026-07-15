export const CELL_SELECTION_PREFIX = 'cell:';
export const CELL_HOVER_FOCUS = 0.46;
export const CELL_SELECTED_FOCUS = 1;
export const CONSENSUS_BRAID_BASE_SCALE = 0.3;
export const CONSENSUS_BRAID_LOCAL_RADIUS = 0.55;
/** Camera-distance LOD is perceptual state, not motion. Sampling it at 12 Hz
 *  keeps rotation/animation on the render clock while avoiding a full Cell
 *  field transform + GPU attribute upload on every frame. */
export const CELL_NUCLEUS_LOD_REFRESH_HZ = 12;
export const CELL_NUCLEUS_LOD_REFRESH_INTERVAL_S = 1 / CELL_NUCLEUS_LOD_REFRESH_HZ;

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

/** Interaction and topology changes bypass the cadence so semantic focus is
 *  immediate; passive camera-distance selection may wait for the next sample. */
export function cellNucleusLodRefreshDue(
  elapsedSeconds: number,
  cellsChanged: boolean,
  interactionChanged: boolean,
): boolean {
  return cellsChanged
    || interactionChanged
    || elapsedSeconds >= CELL_NUCLEUS_LOD_REFRESH_INTERVAL_S;
}

/** Decode the public `cell:<id>` selection contract without accepting junk. */
export function selectedCellNumericId(selection: string | null | undefined): number | null {
  if (!selection?.startsWith(CELL_SELECTION_PREFIX)) return null;
  const encoded = selection.slice(CELL_SELECTION_PREFIX.length);
  if (!/^\d+$/.test(encoded)) return null;
  const id = Number(encoded);
  return Number.isSafeInteger(id) && id >= 0 ? id : null;
}

/** Selected wins over hover; both remain one continuous focus envelope. */
export function cellFocusTarget(
  cellId: number,
  selectedCellId: number | null,
  hoveredCellId: number | null,
): number {
  if (cellId === selectedCellId) return CELL_SELECTED_FOCUS;
  if (cellId === hoveredCellId) return CELL_HOVER_FOCUS;
  return 0;
}

/** Frame-rate-independent focus easing with a quicker attack than release. */
export function dampCellFocus(current: number, target: number, deltaSeconds: number): number {
  const delta = Math.max(0, Math.min(0.1, deltaSeconds));
  const rate = target > current ? 13 : 6.5;
  const next = target + (current - target) * Math.exp(-rate * delta);
  return Math.abs(next - target) < 0.001 ? target : clamp01(next);
}

/**
 * Keep an interacted braid legible in screen space without turning it into a
 * giant world-space object. Nearby Cells retain the canonical physical scale;
 * distant hover/selection states grow only enough to reach a 13–19 px radius.
 */
export function focusedBraidScale(
  viewDistance: number,
  viewportHeight: number,
  projectionY: number,
  focus: number,
): number {
  const amount = clamp01(focus);
  if (amount === 0) return CONSENSUS_BRAID_BASE_SCALE;
  const targetRadiusPx = 8 + amount * 11;
  const pixelsPerScale = (
    Math.max(1, viewportHeight) * 0.5
    * Math.max(0.001, projectionY)
    * CONSENSUS_BRAID_LOCAL_RADIUS
    / Math.max(0.001, viewDistance)
  );
  const screenScale = Math.min(6, targetRadiusPx / pixelsPerScale);
  const eased = amount * amount * (3 - 2 * amount);
  return Math.max(
    CONSENSUS_BRAID_BASE_SCALE,
    CONSENSUS_BRAID_BASE_SCALE
      + (Math.max(CONSENSUS_BRAID_BASE_SCALE, screenScale)
        - CONSENSUS_BRAID_BASE_SCALE) * eased,
  );
}
