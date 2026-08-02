/**
 * Camera-distance hierarchy for the shared Cell / peer scene.
 *
 * The overview needs enough peer energy to explain the network plane. Once the
 * camera crosses into Cell-detail range, the persistent Cell fabric becomes the
 * subject: its screen weight rises while only the peer plane's passive context
 * recedes. Event layers apply their own energy and deliberately bypass this
 * presentation scale.
 */
export const CELL_DETAIL_VIEW_NEAR_DISTANCE = 82;
export const CELL_DETAIL_VIEW_FAR_DISTANCE = 148;
export const CELL_DETAIL_VIEW_FABRIC_ENERGY_GAIN = 1.48;
export const CELL_DETAIL_VIEW_FABRIC_WIDTH_SCALE = 1.22;
export const CELL_DETAIL_VIEW_PEER_CONTEXT_FLOOR = 0.28;

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

/** 0 in the overview, 1 in a close Cell-detail view, with a smooth handoff. */
export function cellDetailViewFocus(cameraTargetDistance: number): number {
  if (!Number.isFinite(cameraTargetDistance)) return 0;
  const t = clamp01(
    (cameraTargetDistance - CELL_DETAIL_VIEW_NEAR_DISTANCE)
      / (CELL_DETAIL_VIEW_FAR_DISTANCE - CELL_DETAIL_VIEW_NEAR_DISTANCE),
  );
  const overview = t * t * (3 - 2 * t);
  return 1 - overview;
}

/** Global colour gain for the passive Cell fabric only. */
export function cellDetailFabricEnergyGain(focus: number): number {
  const detail = clamp01(focus);
  return 1 + (CELL_DETAIL_VIEW_FABRIC_ENERGY_GAIN - 1) * detail;
}

/** Screen-space width scale for the passive Cell fabric only. */
export function cellDetailFabricWidthScale(focus: number): number {
  const detail = clamp01(focus);
  return 1 + (CELL_DETAIL_VIEW_FABRIC_WIDTH_SCALE - 1) * detail;
}

/** Passive peer base/ambient energy. Block surges and selected nodes bypass it. */
export function cellDetailPeerContextEnergy(focus: number): number {
  const detail = clamp01(focus);
  return 1 - (1 - CELL_DETAIL_VIEW_PEER_CONTEXT_FLOOR) * detail;
}
