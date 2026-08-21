export const CELL_SELECTION_PREFIX = 'cell:';
export const CELL_HOVER_FOCUS = 0.46;
export const CELL_SELECTED_FOCUS = 1;
export const CELL_INSPECTION_GALAXY_ROTATION_SCALE = 0.12;
export const CONSENSUS_BRAID_BASE_SCALE = 0.3;
export const CONSENSUS_BRAID_LOCAL_RADIUS = 0.55;
/** Fine expanded braids need a small screen-space acquisition area: their
 * luminous lines are readable before their exact pixels are easy to acquire. */
export const CELL_EXPANDED_PICK_MIN_RADIUS_PX = 14;
export const CELL_EXPANDED_PICK_PADDING_PX = 5;
export const CELL_EXPANDED_DETAIL_THRESHOLD = 0.02;
/** Camera-distance LOD is perceptual state, not motion. Sampling it at 12 Hz
 *  keeps rotation/animation on the render clock while avoiding a full Cell
 *  field transform + GPU attribute upload on every frame. */
export const CELL_NUCLEUS_LOD_REFRESH_HZ = 12;
export const CELL_NUCLEUS_LOD_REFRESH_INTERVAL_S = 1 / CELL_NUCLEUS_LOD_REFRESH_HZ;

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

/** Selection slows the canopy without freezing it into a diagram. */
export function cellGalaxyRotationScaleTarget(
  selectedCellId: number | null,
): number {
  return selectedCellId === null ? 1 : CELL_INSPECTION_GALAXY_ROTATION_SCALE;
}

/** Smoothly enter and leave inspection tempo without a visible speed step. */
export function dampCellGalaxyRotationScale(
  current: number,
  target: number,
  deltaSeconds: number,
): number {
  const from = Number.isFinite(current) ? clamp01(current) : 1;
  const to = Number.isFinite(target) ? clamp01(target) : 1;
  const delta = Math.max(0, Math.min(0.1, deltaSeconds));
  const next = to + (from - to) * Math.exp(-5.2 * delta);
  return Math.abs(next - to) < 0.001 ? to : next;
}

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

/** Resolve the shared canvas cursor from independent scene interaction layers. */
export function cellCanvasCursor(
  cellPickerOwnsCursor: boolean,
  causalNavigationOwnsCursor: boolean,
  networkPeerOwnsCursor: boolean,
): '' | 'pointer' {
  return !cellPickerOwnsCursor
    && !causalNavigationOwnsCursor
    && !networkPeerOwnsCursor
    ? ''
    : 'pointer';
}

/** Stamped on a network-layer node's invisible hit mesh (`object.userData`) so
 * the Cell picker can recognise it on its own pointer ray without either layer
 * importing the other's scene graph. ONE flag covers every such node — the
 * measured peers and the labeled local chain anchor alike — so the arbitration
 * stays a single path instead of one branch per node kind. */
export const NETWORK_PEER_PICK_FLAG = 'networkPeerPick';

/** True when the pointer ray also passes through a network node's hit sphere.
 * Those hit spheres are small and the Cell canopy's screen-space pick discs are
 * generous, so distance-sorted picking alone hands the pixel to an ambient Cell
 * almost every time; but the network nodes are deliberate, labeled targets, so
 * the Cell layer yields — it neither selects nor stops propagation, and the
 * event walks on to the node. */
export function pointerRayOwnedByNetworkPeer(
  intersections: ReadonlyArray<{
    object: { userData?: Record<string, unknown> };
  }>,
): boolean {
  return intersections.some(
    (hit) => hit.object.userData?.[NETWORK_PEER_PICK_FLAG] === true,
  );
}

/**
 * Resolve a Cell's screen-space acquisition radius.
 *
 * Compact lights retain their exact visible footprint so dense far-field
 * Cells do not steal one another's pointer. Once the canonical braid is
 * actually rendered, give its fine lines a bounded pixel pad and a modest
 * minimum target. Closest-screen-centre selection still resolves overlaps.
 */
export function cellPickRadiusPx(
  pointRadiusPx: number,
  braidRadiusPx: number,
  detail: number,
): number {
  const pointRadius = Number.isFinite(pointRadiusPx)
    ? Math.max(0, pointRadiusPx)
    : 0;
  const braidRadius = Number.isFinite(braidRadiusPx)
    ? Math.max(0, braidRadiusPx)
    : 0;
  const visibleRadius = Math.max(pointRadius, braidRadius);
  if (!Number.isFinite(detail) || detail <= CELL_EXPANDED_DETAIL_THRESHOLD) {
    return visibleRadius;
  }
  return Math.max(
    visibleRadius,
    CELL_EXPANDED_PICK_MIN_RADIUS_PX,
    braidRadius + CELL_EXPANDED_PICK_PADDING_PX,
  );
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
 * distant hover/selection states grow only enough to reach a 13–24 px radius.
 */
export function focusedBraidScale(
  viewDistance: number,
  viewportHeight: number,
  projectionY: number,
  focus: number,
): number {
  const amount = clamp01(focus);
  if (amount === 0) return CONSENSUS_BRAID_BASE_SCALE;
  const targetRadiusPx = 8 + amount * 16;
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

/** Final A scale shared by drawing and screen-space hit testing. */
export function consensusBraidRenderScale(
  viewDistance: number,
  viewportHeight: number,
  projectionY: number,
  focus: number,
  presenceScale: number,
): number {
  return focusedBraidScale(
    viewDistance,
    viewportHeight,
    projectionY,
    focus,
  ) * Math.max(0, presenceScale);
}
