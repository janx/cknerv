export const CELL_SELECTION_PREFIX = 'cell:';
/** Match R3F's stationary-click tolerance, which it otherwise applies only
 * to missed clicks. Successful raycast hits must reject drag-generated clicks
 * explicitly — and so must every other surface that has to tell a click from
 * the start of a camera drag, since the camera lives under all of them. */
export const CELL_CLICK_MAX_POINTER_DELTA_PX = 2;
/**
 * The same tolerance for a FINGER, and it is a different number because a
 * finger is a different instrument.
 *
 * A mouse reports the pixel it is on. A fingertip covers about 8-10 mm of
 * glass — on an 11" iPad, 40-50 CSS px — and the browser hands the page one
 * point out of that whole contact patch, recomputed from the centroid on
 * every frame the finger is down. The centroid moves as the finger settles
 * and again as it lifts, so a tap that the reader experienced as perfectly
 * still routinely travels 3-10 px. Measured on the shipped build at
 * 1180x763 @dpr2 with a cell under the pointer: a 5 px slip was refused, an
 * 8.6 px slip was refused, and only 0 px and 2 px selected anything.
 *
 * 10 px is the platform's own answer to the same question — Chromium's touch
 * slop is 8 dp and iOS's is about 10 pt — so a gesture this application calls
 * a drag is one the operating system underneath it would also call a drag.
 */
export const CELL_TOUCH_CLICK_MAX_POINTER_DELTA_PX = 10;

/**
 * How far a press may travel and still be a click, for the pointer that is
 * actually asking.
 *
 * ⭐ THE POINTER'S OWN TYPE, NOT A MEDIA QUERY. `(pointer: coarse)` describes
 * the machine's PRIMARY input; `PointerEvent.pointerType` describes the thing
 * touching the glass right now. On an iPad with a Magic Keyboard both exist,
 * and the reader switches between them mid-session without telling anyone —
 * a media query answers that page one way for the whole session and is wrong
 * for half of it. This is asked per gesture and is never stale.
 *
 * `pen` is precise and takes the mouse's tolerance: an Apple Pencil lands
 * where it is pointed, and a reader who reached for one did so to be exact.
 * An absent or unknown type is a mouse — that is what R3F's own synthetic
 * events carry when nothing said otherwise, and the tight tolerance is the
 * conservative answer for a picker whose whole job is not to select the wrong
 * thing.
 */
export function pointerClickSlopPx(pointerType?: string | null): number {
  return pointerType === 'touch'
    ? CELL_TOUCH_CLICK_MAX_POINTER_DELTA_PX
    : CELL_CLICK_MAX_POINTER_DELTA_PX;
}

/**
 * The pointer type carried by an event whose TYPE does not promise one.
 *
 * R3F declares a click as `ThreeEvent<MouseEvent>` and then dispatches
 * something wider: it builds the synthetic event by copying every
 * non-function property off the DOM event it was given (`for (let prop in
 * event)`, `events.ts`), and the DOM event behind a click is the `pointerup`
 * — a `PointerEvent`. So `pointerType` is there at runtime and absent from
 * the type, which is exactly the shape a structural read answers: ask for it,
 * accept a string, and treat anything else as a genuine mouse event that
 * never had one.
 *
 * The parameter is `unknown` rather than a shape with one optional field,
 * because that shape is a WEAK TYPE and TypeScript refuses to pass it an
 * event that declares none of its properties — which is every event this
 * function exists to read.
 */
export function eventPointerType(event: unknown): string | undefined {
  if (event === null || typeof event !== 'object') return undefined;
  const { pointerType } = event as { pointerType?: unknown };
  return typeof pointerType === 'string' ? pointerType : undefined;
}
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
/**
 * The smallest disc a FINGER may aim at, whatever the Cell draws.
 *
 * Measured on the shipped build at 1180x763 @dpr2, in the default overview
 * pose: the disc around a cell the picker was reporting survived +1 px in x
 * and 0 px in y. That is the honest visual radius — at this distance a Cell
 * is a point sprite a pixel or two across — and it is a target no hand can
 * hit. A fingertip covers 40-50 CSS px of this screen, so a tap does not
 * name a pixel; it names a neighbourhood, and the only question worth
 * answering is which Cell is nearest the middle of it.
 *
 * `find` already answers exactly that — nearest centre, tie-broken by depth
 * — so the floor is a query-time argument and nothing about the field
 * changes. 22 px of radius is Apple's 44 pt minimum as a diameter.
 *
 * ⚠️ IT MUST STAY UNDER {@link CELL_PICK_FOCUS_PAD_CEILING_PX}, and that is
 * load-bearing twice. The index admits entries within the pad ceiling of the
 * viewport, so an entry a floored query can reach was admitted; and the
 * drift envelope is budgeted against `maxRadiusPx +` that ceiling, which
 * bounds a floored disc for the same reason. A floor above it would make
 * both statements false and neither would fail loudly.
 */
export const CELL_TOUCH_PICK_MIN_RADIUS_PX = 22;

/** The pick floor for the pointer that is asking. A mouse gets none: it
 *  reports the pixel it is on, and a picker that widened every disc for it
 *  would answer with a Cell the reader was not pointing at. */
export function cellPickFloorPx(pointerType?: string | null): number {
  return pointerType === 'touch' ? CELL_TOUCH_PICK_MIN_RADIUS_PX : 0;
}

/** Ceiling on how many px focus can add to a Cell's pick disc. Focus reaches
 * the disc through `focusedBraidScale` alone, which drives a fully selected
 * braid at a 24 px screen radius; capacity presence scales that by at most
 * ~1.14 and the expanded-detail branch adds its own pad on top. The screen
 * index admits entries within this distance of the viewport so the two
 * focused discs can be padded at query time rather than re-projected. */
export const CELL_PICK_FOCUS_PAD_CEILING_PX = 34;
/** How many slots may cross the expanded-detail line before the picker stops
 * repairing entries and re-projects the field. One LOD tick can move at most
 * the near cap out and the near cap in — 24 slots at the largest preset — so
 * a diff past this is not a tick, it is a lane rewritten, and a rebuild is
 * both cheaper and the honest answer. */
export const CELL_PICK_DETAIL_PATCH_LIMIT = 32;
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

/** The colony's twin of `cellGalaxyRotationScaleTarget`, at the same
 *  inspection tempo: a peer, sighted or miner card tethers to a node INSIDE
 *  the counter-rotating colony group, so its selection slows that group the way
 *  a Cell selection slows the canopy. A chain-node selection (bare id) stays
 *  at full speed — its anchor is world-mounted and never rides the colony.
 *
 *  ⭐ The test is "does the subject ride the colony", never "does a card exist
 *  for it": the reticle alone is enough to want the turn eased, and a producer
 *  stands in the same rotating group everything else on this list does. */
const COLONY_MOUNTED_SELECTIONS = ['peer:', 'sighted:', 'miner:'];

export function networkColonyRotationScaleTarget(
  selectedNetId: string | null,
): number {
  return selectedNetId !== null
    && COLONY_MOUNTED_SELECTIONS.some((prefix) => selectedNetId.startsWith(prefix))
    ? CELL_INSPECTION_GALAXY_ROTATION_SCALE
    : 1;
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

/** Every gate the picker's screen index can be stale on, as ONE record the
 *  raycast refills in place — same names as `CellPickRebuildReason`, which
 *  counts them — so asking what to do about them allocates nothing. */
export interface CellPickStaleReasons {
  pointerdown: boolean;
  fieldVersion: boolean;
  sizeEpoch: boolean;
  count: boolean;
  detailEpoch: boolean;
  viewport: boolean;
  spin: boolean;
  camera: boolean;
  projection: boolean;
}

/** `rebuild` re-projects the field; `patch` repairs the entries whose LOD
 *  crossed and leaves the rest; `defer` answers off the index as it stands and
 *  leaves it stale for the first at-rest raycast to rebuild; `reuse` is an
 *  index nothing has invalidated. */
export type CellPickRebuildDecision = 'reuse' | 'patch' | 'defer' | 'rebuild';

/**
 * What a raycast should do about the gates that are open — the picker's whole
 * staleness policy, out of the closure so it can be read as a table.
 *
 * Inside a motion window the camera is moving under the index every frame, and
 * hover probes are dropped by the motion gate anyway, so re-projecting twelve
 * thousand cells to answer the few raycasts that do get through buys a truth
 * that is stale again before it is read. Two families never take that trade:
 *
 * - MEMBERSHIP (`fieldVersion`, `sizeEpoch`, `count`). A stale index over a
 *   changed field answers with ids that no longer mean what they meant.
 * - The SPACE the query is expressed in (`viewport`, `projection`). `find` is
 *   asked in the LIVE CSS-pixel frame; an index built in another one is not
 *   the previous frame's truth, it is a different coordinate system. These are
 *   the picker's two exact compares for exactly this reason.
 *
 * `pointerdown` is the third, and it is the one the plan's default would have
 * deferred: a suspended picker still raycasts presses and clicks precisely so
 * a click during motion lands on the cell under it (`isCellPickPointerAction`),
 * and deferring the press would give that back. It also buys nothing at the
 * gesture start it was aimed at — the motion sentinel settles once per frame,
 * so the press that OPENS a drag is seen at rest and rebuilds regardless.
 *
 * What is left — `camera` and `spin` — is the camera POSE, whose error the
 * drift envelope already bounds in pixels, and which the gesture's own
 * pointerdown rebuilt at the press.
 */
export function cellPickRebuildDecision(
  reasons: CellPickStaleReasons,
  motionActive: boolean,
): CellPickRebuildDecision {
  if (reasons.fieldVersion || reasons.sizeEpoch || reasons.count) {
    return 'rebuild';
  }
  if (reasons.viewport || reasons.projection || reasons.pointerdown) {
    return 'rebuild';
  }
  if (reasons.camera || reasons.spin) {
    return motionActive ? 'defer' : 'rebuild';
  }
  // Detail reaches the index across one line and the near set that crosses it
  // is capped, so a bump is a handful of discs that changed width in a field
  // that did not move.
  return reasons.detailEpoch ? 'patch' : 'reuse';
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
