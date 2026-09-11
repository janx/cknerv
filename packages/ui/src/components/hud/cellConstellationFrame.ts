import {
  constellationChip,
  constellationLayout,
  constellationLayoutHardValid,
  constellationLayoutCursor,
  constellationLockedLayoutCursor,
  observeConstellationChipRelocation,
  observeConstellationCursorCancel,
  observeConstellationCursorLanding,
  observeConstellationProvisionalFrame,
  observeConstellationCursorSlice,
  observeConstellationCursorStart,
  observeConstellationRefineDropped,
  observeConstellationRefineLanding,
  observeConstellationRefineStart,
  observeConstellationSeatTween,
  observeConstellationUnavailableHold,
  createConstellationLock,
  refineConstellationRoutesCursor,
  revalidateConstellationLayoutForAnchor,
  constellationHeldRoomPx,
  CONSTELLATION_RETICLE_PX,
  CONSTELLATION_ROUTE_CLEARANCE_PX,
  CONSTELLATION_SEAT_TRAVEL_MIN_PX,
  CONSTELLATION_UNAVAILABLE_RESOLVE_PX,
  type ConstellationChipInput,
  type ConstellationChipPlacement,
  type ConstellationChipPosition,
  type ConstellationLayout,
  type ConstellationLock,
  type ConstellationPanel,
  type ConstellationPlacement,
  type ConstellationSlot,
  type ConstellationInput,
} from '../../derives/cellConstellation.derive';
import type { HudOcclusionRect } from '../hudOcclusion';
import { HUD_MOTION } from './hudTheme';
import {
  FRAME_BUDGET_PANEL_SOLVE,
  announceFrameBudgetWork,
  beginFrameBudget,
  clearFrameBudgetWork,
  frameBudgetRemainingMs,
  mayStartFrameWork,
  spendFrameBudget,
} from '../../nerve/frameBudget';
import {
  PERFORMANCE_PROBE_LABELS,
  beginCpuProbe,
  endCpuProbe,
} from '../../tweaks/performanceProbeStore';

const PANEL_SLICE_BUDGET = 1.6;
const PANEL_FIRST_PAINT_DEADLINE_FRAMES = 3;

/** One axis of a CSS cubic bezier, whose first and last control points are
 *  pinned at 0 and 1 — so a curve is two numbers an axis, and this is the
 *  polynomial for either of them. */
function bezierAxis(first: number, second: number, t: number): number {
  const rest = 1 - t;
  return 3 * rest * rest * t * first + 3 * rest * t * t * second + t * t * t;
}

/** The four control numbers of a `cubic-bezier(...)` string, or the straight
 *  line, because a keyword easing is not a curve this can sample. */
function readCubicBezier(easing: string): readonly [number, number, number, number] {
  const numbers = easing.match(/-?\d*\.?\d+/g);
  if (numbers?.length !== 4) return [0, 0, 1, 1];
  return [Number(numbers[0]), Number(numbers[1]), Number(numbers[2]), Number(numbers[3])];
}

/**
 * The HUD's one bezier, sampled rather than declared.
 *
 * A CSS `transition` cannot carry this. The plates are positioned by a
 * transform written sixty times a second from outside React — the galaxy turns
 * under a selected Cell for as long as it is open — so a transition on that
 * property would be re-triggered by every drift frame and the instruments would
 * swim rather than travel. So the curve is READ OUT of `HUD_MOTION.enterEase`,
 * the same string the stylesheet transitions with, and evaluated here: there is
 * still exactly one bezier in this HUD.
 *
 * Bisection rather than Newton: twenty halvings put the parameter inside a
 * millionth, it cannot diverge on a curve whose start is nearly flat, and it
 * costs a few hundred nanoseconds for at most four plates a frame.
 */
const SEAT_EASE = readCubicBezier(HUD_MOTION.enterEase);
function seatEase(progress: number): number {
  if (!(progress > 0)) return 0;
  if (progress >= 1) return 1;
  let low = 0;
  let high = 1;
  let t = progress;
  for (let step = 0; step < 20; step += 1) {
    if (bezierAxis(SEAT_EASE[0], SEAT_EASE[2], t) < progress) low = t;
    else high = t;
    t = (low + high) / 2;
  }
  return bezierAxis(SEAT_EASE[1], SEAT_EASE[3], t);
}

/**
 * A seat the reader is watching travel.
 *
 * `from` is where the plate stood when the landing arrived — which may itself
 * be a point on the way somewhere else, because a landing during a travel
 * retargets from wherever the plate has got to rather than from where it set
 * out. `to` is the seat that landed.
 *
 * x, y and height move together on ONE eased parameter, and that is the only
 * way a plate which grew UPWARD keeps its bottom edge: y and height both
 * change, and their sum is constant through the travel exactly when one curve
 * drives both. The width is not here; it is written at once.
 */
interface ConstellationSeatTween {
  fromX: number;
  fromY: number;
  fromHeight: number;
  toX: number;
  toY: number;
  toHeight: number;
  startedMs: number;
}

interface ConstellationFrameRequest {
  connectorKey: string;
  layoutKey: string;
  /** Panel/content identity for safely validating a presentation across a
   * viewport or HUD-rail change. The validator still checks every current
   * bound, obstacle, route and label before anything is shown. */
  panelKey: string;
  chipX: number;
  chipY: number;
  /** The chip measure this request was built from, so the reuse test can read
   * it without rebuilding the layout signature that encodes it. */
  chipWidth: number;
  chipHeight: number;
  input: ConstellationInput;
}

interface ConstellationLayoutJob {
  request: ConstellationFrameRequest;
  cursor: Generator<void, ConstellationLayout | null>;
  lockedOnly: boolean;
}

/**
 * A second look at the leaders of a constellation that is already on screen.
 *
 * It carries the request it was routed for — whose anchor may be half a pixel
 * behind the live one by the time it lands — the seats it is allowed to write
 * to, and how many fallback leaders the reader was shown when it started, so
 * the landing can say how many it took back.
 */
interface ConstellationRefineJob {
  request: ConstellationFrameRequest;
  cursor: Generator<void, ConstellationLayout | null>;
  placements: readonly ConstellationPlacement[];
  degradedAtStart: number;
}

export interface ConstellationPanelHandle {
  host: HTMLDivElement | null;
  /** The exact DOM host that has received a complete, valid placement. */
  positionedHost: HTMLDivElement | null;
  fallbackLabel: HTMLElement | null;
  width: number;
  height: number;
  present: boolean;
  /** Where this plate was last WRITTEN, and to which host. It is kept here so
   * a travel never has to read a transform back out of the DOM, and so a
   * replacement DOM node — which has no seat of its own — is placed at once
   * rather than flown in from the seat of the node it replaced. */
  seatX: number;
  seatY: number;
  seatHeight: number;
  seatHost: HTMLDivElement | null;
  /** The seat this plate is HEADING for, which is the seat it stands on
   * whenever nothing is travelling.
   *
   * ⚠️ A landing is a seat change when it differs from THIS, never when the
   * placement key differs: `placementSignature` carries the height, so a plate
   * that only grew has a new key and the same seat, and growing in place lands
   * in one frame and must not travel anywhere. */
  targetX: number;
  targetY: number;
  targetHeight: number;
  /** The travel in flight, or null. */
  tween: ConstellationSeatTween | null;
}
export interface ConstellationLeaderHandle {
  /** The <g> the two strokes, the endpoint and the mask live in. The writer
   * marks it `data-cell-leader-degraded` so the injected sheet can dash a
   * fallback leader without anything re-rendering. */
  group: SVGGElement | null;
  under: SVGPathElement | null;
  over: SVGPathElement | null;
  dot: SVGCircleElement | null;
  label: HTMLElement | null;
  labelWidth: number;
  labelHeight: number;
}
export interface CellConstellationHandles {
  root: HTMLDivElement | null;
  panels: { [slot: string]: ConstellationPanelHandle };
  leaders: { [slot: string]: ConstellationLeaderHandle };
  maskGroup: SVGGElement | null;
  reticle: HTMLElement | null;
  chip: HTMLElement | null;
  chipWidth: number;
  chipHeight: number;
  /** Which of the chip's four listed positions was last written. It is state
   * only so a relocation can be counted once per move instead of once per
   * frame; nothing reads it to decide anything. */
  chipPosition: ConstellationChipPosition | '';
  lock: ConstellationLock;
  visible: boolean;
  leaving: boolean;
  /** Compatibility alias; invalidation clears all three signatures. */
  frameKey: string;
  layoutKey: string;
  connectorKey: string;
  placementKey: string;
  maskKey: string;
  lastLayout: ConstellationLayout | null;
  lastSpecimen: ConstellationPlacement | null;
  quadrant: { [slot: string]: string | undefined };
  quadrantListeners: Set<() => void>;
  layoutJob: ConstellationLayoutJob | null;
  /** The background second look at a degraded set of leaders. It never runs
   * beside a layout job and never survives one starting. */
  refineJob: ConstellationRefineJob | null;
  /** `layoutKey|placementKey` of the picture a refinement has already finished
   * for, whatever it found. Without it a layout the refinement cannot improve
   * would be re-refined on every frame the Cell stands still. */
  refinedKey: string;
  desiredRequest: ConstellationFrameRequest | null;
  /** The last request `prepareRequest` built, with the HUD occlusion version
   * it was built from. A frame whose anchor bucket, stage, chip, rails and
   * measured panel heights all match it asks nothing new, and gets this object
   * back rather than a fresh one — no panel copy, no signature strings, no
   * rect key. It is dropped by `invalidateConstellationFrame`, which is also
   * where the private lock is reset from, so the lock clone it carries can
   * never outlive the lock it was taken from. */
  lastRequest: ConstellationFrameRequest | null;
  lastRequestObstacleVersion: number;
  layoutPendingFrames: number;
  appliedAnchorX: number;
  appliedAnchorY: number;
  provisionalBaseLayout: ConstellationLayout | null;
  provisionalBaseLayoutKey: string;
  provisionalBasePanelKey: string;
  provisionalBaseAnchorX: number;
  provisionalBaseAnchorY: number;
  provisionalVisible: boolean;
  /** Panel or SVG attributes differ from the last canonical layout. */
  presentationDirty: boolean;
  /** Camera motion has hidden routes while retaining the latest panel seats. */
  motionSuspended: boolean;
  /** No frame writer will ever seat these plates. The review labs and the
   * component tests render the dossier standing still, with no anchor to
   * place it; a detached channel lets every instrument register and measure
   * itself exactly as it does live, and the plates stand in flow, visible,
   * instead of waiting at `visibility: hidden` for a seat that never comes. */
  detached: boolean;
  /** The visitor asked for stillness. `CellInspectionOverlay` keeps this
   * current from `useReducedMotion` — a `useFrame` callback is not a component
   * and cannot hold a hook — and a seat change is then written at once. */
  reducedMotion: boolean;
  /**
   * The travel's own clock, in milliseconds.
   *
   * ⚠️ It is NOT the slice budget's `now`, and it is a field rather than a
   * parameter on purpose. `HUD_MOTION.seat` is 240 real milliseconds, while
   * the `now` the writer slices its solver with is a budget meter that the
   * tests deliberately advance by a twentieth of a millisecond a reading (it
   * would take 4,800 readings to cross one travel) and that the frame budget
   * may hand out in any size at all. A travel is also stepped from four
   * entrances — the frame, the drain, the motion suspend and the landing that
   * starts it — and threading a clock argument through all of them would put a
   * time parameter on functions with nothing else to do with time. A test sets
   * this field and drives 240 ms in as many frames as it likes.
   */
  seatClock: () => number;
  /** The visibility the writer last ASKED the leaders for. A travelling seat
   * overrules it — a leader drawn to where a plate is GOING is a lie about
   * where the instrument is — and this is what says what to restore when the
   * travel is over. */
  leadersWanted: boolean;
}

export const CONSTELLATION_SLOTS: readonly ConstellationSlot[] = [
  'analysis', 'specimen', 'reader', 'trace',
];
export const CONSTELLATION_WIDTH: { [slot: string]: number } = {
  analysis: 440, specimen: 280, reader: 408, trace: 560,
};
export const CONSTELLATION_MIN_WIDTH_PX = 336;

export function createCellConstellationHandles(
  options: { detached?: boolean } = {},
): CellConstellationHandles {
  const panels: { [slot: string]: ConstellationPanelHandle } = {};
  const leaders: { [slot: string]: ConstellationLeaderHandle } = {};
  for (const slot of CONSTELLATION_SLOTS) {
    panels[slot] = {
      host: null, positionedHost: null, fallbackLabel: null,
      width: CONSTELLATION_WIDTH[slot] ?? 408,
      height: 0, present: false,
      seatX: Number.NaN, seatY: Number.NaN, seatHeight: Number.NaN, seatHost: null,
      targetX: Number.NaN, targetY: Number.NaN, targetHeight: Number.NaN,
      tween: null,
    };
    leaders[slot] = {
      group: null, under: null, over: null, dot: null, label: null,
      labelWidth: slot === 'specimen' ? 78 : 62, labelHeight: 20,
    };
  }
  return {
    root: null, panels, leaders, maskGroup: null, reticle: null, chip: null,
    chipWidth: 0, chipHeight: 0, chipPosition: '', lock: createConstellationLock(),
    visible: false, leaving: false, frameKey: '', layoutKey: '', connectorKey: '',
    placementKey: '', maskKey: '',
    lastLayout: null, lastSpecimen: null, quadrant: {}, quadrantListeners: new Set(),
    layoutJob: null, refineJob: null, refinedKey: '', desiredRequest: null,
    lastRequest: null, lastRequestObstacleVersion: -1,
    layoutPendingFrames: 0,
    appliedAnchorX: Number.NaN, appliedAnchorY: Number.NaN,
    provisionalBaseLayout: null,
    provisionalBaseLayoutKey: '',
    provisionalBasePanelKey: '',
    provisionalBaseAnchorX: Number.NaN, provisionalBaseAnchorY: Number.NaN,
    provisionalVisible: false, presentationDirty: false, motionSuspended: false,
    detached: options.detached === true,
    reducedMotion: false,
    seatClock: () => performance.now(),
    leadersWanted: false,
  };
}

const QUANTUM_PX = 0.5;
const bucket = (value: number): number => Math.round(value / QUANTUM_PX);
const scratchPanels: ConstellationPanel[] = [];
const scratchReserved: HudOcclusionRect[] = [];
const chipBox: HudOcclusionRect = { left: 0, top: 0, right: 0, bottom: 0 };
const chipInput: ConstellationChipInput = {
  anchorX: 0, anchorY: 0, stageWidth: 0, stageHeight: 0, edge: 0,
  chipWidth: 0, chipHeight: 0,
};

/**
 * Where the name chip stands this frame, from the one function that decides it.
 *
 * `placements` is what the chip must keep out of: nothing on a fresh request,
 * where the chip reserves its preferred position and the plates are seated
 * around it, and the seats that are on screen everywhere else, where the chip
 * is the thing that yields. The scratch input is filled in place because this
 * is read on every frame, including frames that do no other work.
 */
function chipPlacement(
  handles: CellConstellationHandles,
  anchorX: number, anchorY: number,
  stageWidth: number, stageHeight: number, edge: number,
  placements: readonly ConstellationPlacement[],
): ConstellationChipPlacement {
  chipInput.anchorX = anchorX; chipInput.anchorY = anchorY;
  chipInput.stageWidth = stageWidth; chipInput.stageHeight = stageHeight;
  chipInput.edge = edge;
  chipInput.chipWidth = handles.chipWidth; chipInput.chipHeight = handles.chipHeight;
  return constellationChip(chipInput, placements);
}

const EMPTY_PLACEMENTS: readonly ConstellationPlacement[] = [];
/** The seats the chip has to keep out of: the picture on screen, or nothing at
 * all before there is one. */
function seatedPlacements(
  handles: CellConstellationHandles,
): readonly ConstellationPlacement[] {
  return handles.lastLayout?.placements ?? EMPTY_PLACEMENTS;
}

function collectPanels(handles: CellConstellationHandles, stageWidth: number,
  edge: number): ConstellationPanel[] {
  scratchPanels.length = 0;
  const room = Math.max(CONSTELLATION_MIN_WIDTH_PX, stageWidth - edge * 2);
  for (const slot of CONSTELLATION_SLOTS) {
    const panel = handles.panels[slot];
    if (!panel?.present || panel.height <= 0) continue;
    const leader = handles.leaders[slot];
    scratchPanels.push({
      slot,
      width: Math.min(panel.width, room),
      height: panel.height,
      labelWidth: leader.labelWidth,
      labelHeight: leader.labelHeight,
    });
  }
  return scratchPanels;
}
function rectKey(rects: readonly HudOcclusionRect[]): string {
  let key = '';
  for (const rect of rects) {
    key += `|${bucket(rect.left)},${bucket(rect.top)},${bucket(rect.right)},${bucket(rect.bottom)}`;
  }
  return key;
}
function layoutSignature(stageWidth: number, stageHeight: number, safeTop: number,
  edge: number, panels: readonly ConstellationPanel[], handles: CellConstellationHandles,
  obstacles: readonly HudOcclusionRect[], obstacleVersion: number): string {
  let key = `${bucket(stageWidth)},${bucket(stageHeight)},${bucket(safeTop)},${bucket(edge)}`;
  for (const panel of panels) {
    key += `|${panel.slot}:${bucket(panel.width)}:${bucket(panel.height)}:${bucket(panel.labelWidth ?? 0)}:${bucket(panel.labelHeight ?? 0)}`;
  }
  return key + `|c${bucket(handles.chipWidth)},${bucket(handles.chipHeight)}|h${obstacleVersion}`
    + rectKey(obstacles);
}
function panelSignature(panels: readonly ConstellationPanel[],
  handles: CellConstellationHandles): string {
  let key = '';
  for (const panel of panels) {
    key += `|${panel.slot}:${bucket(panel.width)}:${bucket(panel.height)}:${bucket(panel.labelWidth ?? 0)}:${bucket(panel.labelHeight ?? 0)}`;
  }
  return key + `|c${bucket(handles.chipWidth)},${bucket(handles.chipHeight)}`;
}
function pathData(points: readonly { x: number; y: number }[]): string {
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
}
function placementSignature(placements: readonly ConstellationPlacement[]): string {
  return placements.map((panel) =>
    `${panel.slot}:${bucket(panel.x)},${bucket(panel.y)},${bucket(panel.width)},${bucket(panel.height)}`,
  ).join('|');
}
function notifyQuadrants(handles: CellConstellationHandles): void {
  handles.quadrantListeners.forEach((listener) => listener());
}
function writeMasks(handles: CellConstellationHandles, masks: readonly HudOcclusionRect[]): void {
  const group = handles.maskGroup;
  if (!group) return;
  const nodes: SVGRectElement[] = [];
  for (const mask of masks) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    node.setAttribute('x', `${mask.left}`);
    node.setAttribute('y', `${mask.top}`);
    node.setAttribute('width', `${Math.max(0, mask.right - mask.left)}`);
    node.setAttribute('height', `${Math.max(0, mask.bottom - mask.top)}`);
    node.setAttribute('fill', 'black');
    nodes.push(node);
  }
  group.replaceChildren(...nodes);
}
function clearAbsent(handles: CellConstellationHandles, present: ReadonlySet<string>): void {
  for (const slot of CONSTELLATION_SLOTS) {
    if (present.has(slot)) continue;
    const panel = handles.panels[slot];
    if (panel.host) panel.host.style.visibility = 'hidden';
    panel.positionedHost = null;
    // An instrument that is not in this picture has no seat to travel from;
    // the next one it appears in places it outright.
    panel.tween = null;
    panel.seatHost = null;
    panel.targetX = Number.NaN;
    panel.targetY = Number.NaN;
    const leader = handles.leaders[slot];
    leader.under?.setAttribute('d', '');
    leader.over?.setAttribute('d', '');
    if (leader.group) leader.group.dataset.cellLeaderDegraded = 'false';
    if (leader.dot) leader.dot.style.display = 'none';
    if (leader.label) leader.label.style.display = 'none';
    writeFallback(handles.panels[slot].fallbackLabel, false);
  }
}

function panelHostIsPositioned(panel: ConstellationPanelHandle): boolean {
  return panel.host !== null
    && panel.positionedHost === panel.host
    && panel.host.style.visibility !== 'hidden';
}

/** WHERE a plate stands, and the one record of it. Split from the size below
 *  so the clamped-height presentation can tell a plate about its new rows
 *  without taking the transform away from a travel that owns it. */
function writePanelPosition(
  panel: ConstellationPanelHandle,
  host: HTMLDivElement,
  x: number,
  y: number,
): void {
  host.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  panel.seatX = x;
  panel.seatY = y;
  panel.seatHost = host;
}

/** HOW BIG a plate is drawn, and whether its content is cut. The width is
 *  always the answer's width — nothing about a seat change makes a plate a
 *  different width — and the height is the one the caller is drawing at, which
 *  during a travel is a point on the way to the landed one. */
function writePanelSize(
  panel: ConstellationPanelHandle,
  host: HTMLDivElement,
  width: number,
  height: number,
  capped: boolean,
): void {
  host.style.width = `${width}px`;
  host.style.height = `${height}px`;
  host.dataset.cellPanelCapped = capped ? 'true' : 'false';
  panel.seatHeight = height;
}

/**
 * Seat one plate, and say whether the reader is going to watch it get there.
 *
 * The one rule, and every path that writes a plate goes through it: a seat that
 * MOVED under a plate already standing on screen is travelled to, from wherever
 * that plate has got to, over `HUD_MOTION.seat`. Everything else is written at
 * once — a first paint, a replacement DOM node, a plate the writer had
 * withdrawn, a visitor who asked for stillness, a move under
 * `CONSTELLATION_SEAT_TRAVEL_MIN_PX`, and a plate that only grew.
 *
 * ⚠️ The comparison is the SEAT, not the placement key. `placementSignature`
 * carries the height, so a plate that grew has a new key and the same seat, and
 * growing in place lands in one frame: it must be written and not travelled to.
 * A plate that grew UPWARD did move its top, and is a genuine journey — a short
 * one, which is why y and the height travel on the same parameter and its
 * bottom edge stays where the reader left it.
 */
function writePanelPlacement(
  handles: CellConstellationHandles,
  panel: ConstellationPanelHandle,
  placement: ConstellationPlacement,
  placementChanged: boolean,
): boolean {
  const host = panel.host;
  if (!host) return false;
  if (handles.reducedMotion && panel.tween) {
    // Stillness was asked for in the middle of a journey: the plate is at the
    // seat it was going to, now.
    writeSeatTweenAt(panel, panel.tween, 1);
    panel.tween = null;
  }
  // A new selection or reopened slot owns fresh DOM even when its dimensions
  // happen to reproduce the previous placement signature. It is not seated
  // until this exact host receives every placement field — and it has nowhere
  // to travel from until it has been seated once.
  const standing = panel.positionedHost === host
    && panel.seatHost === host
    && host.style.visibility !== 'hidden'
    && Number.isFinite(panel.targetX)
    && Number.isFinite(panel.targetY);
  const travel = standing && !handles.reducedMotion
    && Math.hypot(placement.x - panel.targetX, placement.y - panel.targetY)
      >= CONSTELLATION_SEAT_TRAVEL_MIN_PX;
  if (travel) {
    panel.tween = {
      fromX: panel.seatX,
      fromY: panel.seatY,
      fromHeight: Number.isFinite(panel.seatHeight) ? panel.seatHeight : placement.height,
      toX: placement.x,
      toY: placement.y,
      toHeight: placement.height,
      startedMs: handles.seatClock(),
    };
    // The width and the cut are the answer's, from this frame. Only the three
    // quantities that carry the plate across the stage are travelled.
    host.style.width = `${placement.width}px`;
    host.dataset.cellPanelCapped = placement.capped ? 'true' : 'false';
    host.dataset.cellPanelQuadrant = placement.quadrant;
    writeSeatTweenAt(panel, panel.tween, 0);
  } else if (placementChanged || panel.positionedHost !== host) {
    writePanelSize(panel, host, placement.width, placement.height, placement.capped);
    host.dataset.cellPanelQuadrant = placement.quadrant;
    if (panel.tween) {
      // A journey is in flight and this is not a new one: the clamped
      // presentation writing measured rows into a plate on its way somewhere,
      // or a landing correcting its destination by less than a gap. The rows go
      // in at once — a measurement that arrived is not a thing to animate — and
      // the journey keeps its clock and takes the corrected seat.
      panel.tween.fromHeight = placement.height;
      panel.tween.toHeight = placement.height;
      panel.tween.toX = placement.x;
      panel.tween.toY = placement.y;
    } else {
      writePanelPosition(panel, host, placement.x, placement.y);
    }
  }
  if (travel || placementChanged || panel.positionedHost !== host) {
    panel.targetX = placement.x;
    panel.targetY = placement.y;
    panel.targetHeight = placement.height;
  }
  panel.positionedHost = host;
  host.style.visibility = 'visible';
  return travel;
}

/** One re-composition is one thing to watch, however many instruments it
 *  carries: the count is per seat change, and the leaders go down together. */
function noteSeatTravel(handles: CellConstellationHandles, travelling: boolean): void {
  if (!travelling) return;
  observeConstellationSeatTween();
  applyLeaderVisibility(handles);
}

function seatTweenActive(handles: CellConstellationHandles): boolean {
  for (const slot of CONSTELLATION_SLOTS) {
    if (handles.panels[slot].tween) return true;
  }
  return false;
}

function writeSeatTweenAt(
  panel: ConstellationPanelHandle,
  tween: ConstellationSeatTween,
  eased: number,
): void {
  const host = panel.host;
  if (!host) return;
  const x = tween.fromX + (tween.toX - tween.fromX) * eased;
  const y = tween.fromY + (tween.toY - tween.fromY) * eased;
  const height = tween.fromHeight + (tween.toHeight - tween.fromHeight) * eased;
  writePanelPosition(panel, host, x, y);
  host.style.height = `${height}px`;
  panel.seatHeight = height;
}

/**
 * Step every travel in flight and write what it says this frame.
 *
 * Called from the top of every frame the writer owns, including the frames it
 * does no other work on: a travel is 240 ms of real time and the frames that
 * carry it are mostly frames the constellation has nothing else to say. When
 * the last one finishes, the leaders are drawn again — with the routes of the
 * layout the plates have just arrived at, which the landing already wrote and
 * this restores — and the ordinary settled path re-anchors them to the live
 * anchor on the frames after, exactly as it does for a picture that never moved.
 */
function advanceSeatTweens(handles: CellConstellationHandles): void {
  let ended = false;
  let now = Number.NaN;
  for (const slot of CONSTELLATION_SLOTS) {
    const panel = handles.panels[slot];
    const tween = panel.tween;
    if (!tween) continue;
    if (!Number.isFinite(now)) now = handles.seatClock();
    const progress = HUD_MOTION.seat > 0 ? (now - tween.startedMs) / HUD_MOTION.seat : 1;
    if (!(progress < 1)) {
      writeSeatTweenAt(panel, tween, 1);
      panel.tween = null;
      ended = true;
      continue;
    }
    writeSeatTweenAt(panel, tween, seatEase(progress));
  }
  // The routes on screen are already the ones the plates have just arrived at:
  // the landing wrote them, and every settled frame since re-anchored them to
  // the live anchor behind the journey. Nothing to redraw — only to show.
  if (ended && !seatTweenActive(handles)) applyLeaderVisibility(handles);
}

/** Put every travel at its end at once. Camera motion takes this: the leaders
 *  are down for the whole motion window anyway, so there is nothing left for
 *  the travel to protect, and a plate still drifting when the camera stops
 *  would be a second motion on top of the one the visitor made. */
function snapSeatTweens(handles: CellConstellationHandles): void {
  let snapped = false;
  for (const slot of CONSTELLATION_SLOTS) {
    const panel = handles.panels[slot];
    const tween = panel.tween;
    if (!tween) continue;
    writeSeatTweenAt(panel, tween, 1);
    panel.tween = null;
    snapped = true;
  }
  if (snapped) applyLeaderVisibility(handles);
}

/** Stop every travel where it has got to, and let that be the seat. The
 *  picture is being re-asked, so the plate stays under the reader's eye rather
 *  than jumping to a seat the next solve may not agree with; the landing after
 *  this travels from here. */
function dropSeatTweens(handles: CellConstellationHandles): void {
  let dropped = false;
  for (const slot of CONSTELLATION_SLOTS) {
    const panel = handles.panels[slot];
    if (!panel.tween) continue;
    panel.tween = null;
    panel.targetX = panel.seatX;
    panel.targetY = panel.seatY;
    panel.targetHeight = panel.seatHeight;
    dropped = true;
  }
  if (dropped) applyLeaderVisibility(handles);
}

/**
 * Forget where every plate stood.
 *
 * A DIFFERENT Cell is a different constellation, not a re-seating of this one:
 * its instruments arrive at their seats with the overlay's own entrance, and
 * nothing travels across the stage from the Cell the reader just closed. The
 * overlay calls this beside `resetConstellationLock`, which is the same
 * statement about the same event.
 */
export function resetConstellationSeats(handles: CellConstellationHandles): void {
  for (const slot of CONSTELLATION_SLOTS) {
    const panel = handles.panels[slot];
    panel.tween = null;
    panel.seatHost = null;
    panel.seatX = Number.NaN;
    panel.seatY = Number.NaN;
    panel.seatHeight = Number.NaN;
    panel.targetX = Number.NaN;
    panel.targetY = Number.NaN;
    panel.targetHeight = Number.NaN;
  }
}

/** The one place a leader's strokes, endpoint, tag and fallback mark are
 * written. A degraded leader is marked on its group so the injected sheet can
 * dash it without React touching the tree. */
function writeLeader(handles: CellConstellationHandles,
  placement: ConstellationPlacement): void {
  const leader = handles.leaders[placement.slot];
  const route = placement.route;
  if (!route || !leader) return;
  const d = pathData(route.points);
  leader.under?.setAttribute('d', d);
  leader.over?.setAttribute('d', d);
  if (leader.group) {
    leader.group.dataset.cellLeaderDegraded = route.degraded ? 'true' : 'false';
  }
  const end = route.points[route.points.length - 1];
  if (leader.dot) {
    leader.dot.style.display = '';
    leader.dot.setAttribute('cx', `${end.x}`);
    leader.dot.setAttribute('cy', `${end.y}`);
  }
  if (leader.label) {
    leader.label.style.display = route.label.inPanel ? 'none' : '';
    if (!route.label.inPanel) {
      leader.label.style.transform =
        `translate3d(${route.label.x}px, ${route.label.y}px, 0) translate(-50%, -50%)`;
    }
  }
  writeFallback(handles.panels[placement.slot].fallbackLabel, route.label.inPanel);
}

/**
 * The specimen seat the portrait is scissored into — where the plate IS, not
 * where it is going.
 *
 * The braid is painted on the main canvas beneath the whole DOM HUD and cut to
 * the specimen's transparent window, so the scene needs the panel's origin
 * every frame it moves. A travelling seat moves it on every one of them, and a
 * scissor left at the landed seat would draw the braid a plate's width away
 * from the plate for a quarter of a second.
 */
function currentSpecimenPlacement(
  handles: CellConstellationHandles,
  placement: ConstellationPlacement | null = handles.lastSpecimen,
): ConstellationPlacement | null {
  const panel = handles.panels.specimen;
  if (!(placement?.slot === 'specimen' && panel.present && panelHostIsPositioned(panel))) {
    return null;
  }
  if (!panel.tween) return placement;
  return { ...placement, x: panel.seatX, y: panel.seatY, height: panel.seatHeight };
}

function allPresentPanelHostsPositioned(handles: CellConstellationHandles): boolean {
  for (const slot of CONSTELLATION_SLOTS) {
    const panel = handles.panels[slot];
    if (panel.present && panel.height > 0 && !panelHostIsPositioned(panel)) return false;
  }
  return true;
}

/** Whether the published layout is fully on screen. An `unavailable` layout
 * has no host to position and is complete the moment it lands; reading it as
 * "not published yet" is what made a roomless stage re-solve every frame. */
function layoutFullyPresented(handles: CellConstellationHandles): boolean {
  return allPresentPanelHostsPositioned(handles)
    || handles.lastLayout?.status === 'unavailable';
}

/**
 * Keep finished seats on screen while the next layout is still being solved.
 *
 * A plate is withdrawn only when the Cell has walked into its seat — the
 * reticle would be underneath it — or when the seat has left the stage. Every
 * other plate stays exactly where the reader last saw it.
 *
 * A plate whose CONTENT changed height is given the new height here, clamped to
 * the room the old placement had: the stage edge, or the top of the next plate
 * down its column less the gap. Writing the measured height without the clamp
 * would let a growing register run under the plate beneath it for the frames
 * the solve takes; refusing to write it at all leaves the reader's new rows
 * behind a plate that has not been told about them. Clamped, the instrument
 * shows what it can and scrolls the rest, and nothing on the stage overlaps.
 *
 * The leaders come with it wherever they can be carried: a height change is not
 * an anchor change, so a leader whose plate did not move is still exactly
 * right, and `revalidateConstellationLayoutForAnchor` says so for the whole set
 * against the boxes as presented. When it cannot — the grown plate now stands
 * in its own leader's way — every leader is hidden, because a leader that ends
 * inside a plate is a lie about where the instrument is.
 */
function holdStaleSeats(
  handles: CellConstellationHandles,
  request: ConstellationFrameRequest,
): ConstellationPlacement | null {
  const layout = handles.provisionalBaseLayout ?? handles.lastLayout;
  if (!layout) { setLeadersVisible(handles, false); return null; }
  const { anchorX, anchorY, stageWidth, stageHeight, safeTop, edge } = request.input;
  const core = CONSTELLATION_RETICLE_PX / 2 + CONSTELLATION_ROUTE_CLEARANCE_PX;
  const kept: ConstellationPlacement[] = [];
  for (const placement of layout.placements) {
    const panel = handles.panels[placement.slot];
    if (!panel?.host) continue;
    const nearestX = Math.max(placement.x, Math.min(anchorX, placement.x + placement.width));
    const nearestY = Math.max(placement.y, Math.min(anchorY, placement.y + placement.height));
    const standingOnTheCell = Math.hypot(nearestX - anchorX, nearestY - anchorY) < core;
    const offStage = placement.x < edge - 0.5 || placement.y < safeTop - 0.5
      || placement.x + placement.width > stageWidth - edge + 0.5
      || placement.y + placement.height > stageHeight - edge + 0.5;
    if (standingOnTheCell || offStage) {
      panel.host.style.visibility = 'hidden';
      panel.positionedHost = null;
      continue;
    }
    kept.push(placement);
  }
  const presented = kept.map((placement, index) => {
    const measured = handles.panels[placement.slot].height;
    if (measured <= 0 || Math.abs(measured - placement.height) < 0.5) return placement;
    // The room this seat has is the derive's answer, not a second opinion:
    // `constellationHeldRoomPx` is what `growInPlaceSeats` grows into, so the
    // plate drawn here is the plate the solve behind it will land. `kept` is
    // the LANDED layout's placements, never a travelling plate's live position:
    // the room a seat has is a fact about the seats, and measuring it from a
    // plate halfway across the stage would clamp a growing instrument to the
    // gap it happens to have this frame.
    const room = constellationHeldRoomPx(request.input, kept, index);
    const height = Math.min(measured, Math.max(placement.height, room));
    if (Math.abs(height - placement.height) < 0.5) return placement;
    return { ...placement, height, capped: height < measured - 0.5 };
  });
  let specimen: ConstellationPlacement | null = null;
  let grew = false;
  let travelling = false;
  for (let index = 0; index < presented.length; index += 1) {
    const placement = presented[index];
    if (placement !== kept[index]) {
      if (writePanelPlacement(handles, handles.panels[placement.slot], placement, true)) {
        travelling = true;
      }
      grew = true;
    }
    if (placement.slot === 'specimen') specimen = placement;
  }
  noteSeatTravel(handles, travelling);
  // Only a HEIGHT change earns this second look. Every other way of arriving
  // here — a viewport, a rail, an instrument opening — has already had the same
  // question asked of the same base layout by `showValidatedProvisional` and
  // has already been told no, and asking it twice a frame is the one thing this
  // path may not cost. Measured 2026-09-12 on probe I without the guard: three
  // of 400 drifting frames stopped landing inside their slice.
  const carried = grew && presented.length === layout.placements.length
    && presented.length === request.input.panels.length
    && Number.isFinite(handles.appliedAnchorX)
    ? revalidateConstellationLayoutForAnchor(
      request.input, { ...layout, placements: presented },
      handles.appliedAnchorX, handles.appliedAnchorY,
    )
    : null;
  if (!carried) {
    setLeadersVisible(handles, false);
    return currentSpecimenPlacement(handles, specimen);
  }
  for (const placement of carried.placements) writeLeader(handles, placement);
  const nextMaskKey = rectKey(carried.masks);
  if (nextMaskKey !== handles.maskKey) {
    handles.maskKey = nextMaskKey;
    writeMasks(handles, carried.masks);
  }
  setLeadersVisible(handles, true);
  return currentSpecimenPlacement(handles, specimen);
}
/**
 * Ask for the leaders. A travelling seat overrules the answer.
 *
 * A leader is a line from the Cell to where an instrument IS. While a plate is
 * crossing the stage the routes on screen are the ones solved for where it is
 * GOING, so drawing them would point at nothing for a quarter of a second —
 * which is why `HUD_MOTION.seat` is as short as it is. What is asked for is
 * remembered, and restored the moment the last plate arrives.
 */
function setLeadersVisible(handles: CellConstellationHandles, visible: boolean): void {
  handles.leadersWanted = visible;
  applyLeaderVisibility(handles);
}
function applyLeaderVisibility(handles: CellConstellationHandles): void {
  const travelling = seatTweenActive(handles);
  const visible = handles.leadersWanted && !travelling;
  const visibility = visible ? '' : 'hidden';
  for (const slot of CONSTELLATION_SLOTS) {
    const leader = handles.leaders[slot];
    if (leader.under) leader.under.style.visibility = visibility;
    if (leader.over) leader.over.style.visibility = visibility;
    if (leader.dot) leader.dot.style.visibility = visibility;
    if (leader.label) leader.label.style.visibility = visibility;
    // The in-panel fallback is not a leader: it is the instrument's own name,
    // set in its head, and it travels WITH the plate. A journey takes the line
    // down and gives it back; it does not un-write what the route asked for.
    if (!visible && !travelling) writeFallback(handles.panels[slot].fallbackLabel, false);
  }
}
function writeFallback(label: HTMLElement | null, visible: boolean): void {
  if (!label) return;
  label.style.visibility = visible ? 'visible' : 'hidden';
  label.style.position = visible ? 'static' : 'absolute';
  label.style.maxWidth = visible ? '90px' : '0';
  label.style.padding = visible ? '1px 5px' : '0';
  label.style.borderWidth = visible ? '1px' : '0';
}

function cloneLock(lock: ConstellationLock): ConstellationLock {
  const placements: ConstellationLock['placements'] = {};
  for (const slot of Object.keys(lock.placements)) {
    const panel = lock.placements[slot];
    if (panel) placements[slot] = { ...panel, route: undefined };
  }
  return {
    quadrant: { ...lock.quadrant },
    template: lock.template,
    placements,
    // The held route points are immutable once published; sharing the arrays
    // costs nothing and the clone is read, never written through.
    routes: { ...lock.routes },
    geometryKey: lock.geometryKey,
    shapeKey: lock.shapeKey,
    anchorX: lock.anchorX,
    anchorY: lock.anchorY,
  };
}

function publishLock(target: ConstellationLock, source: ConstellationLock): void {
  resetLockObject(target);
  target.template = source.template;
  target.geometryKey = source.geometryKey;
  target.shapeKey = source.shapeKey;
  target.anchorX = source.anchorX;
  target.anchorY = source.anchorY;
  Object.assign(target.quadrant, source.quadrant);
  Object.assign(target.routes, source.routes);
  for (const slot of Object.keys(source.placements)) {
    const panel = source.placements[slot];
    if (panel) target.placements[slot] = { ...panel, route: undefined };
  }
}

function resetLockObject(lock: ConstellationLock): void {
  for (const slot of Object.keys(lock.quadrant)) delete lock.quadrant[slot];
  for (const slot of Object.keys(lock.placements)) delete lock.placements[slot];
  for (const slot of Object.keys(lock.routes)) delete lock.routes[slot];
  lock.template = null;
  lock.geometryKey = '';
  lock.shapeKey = '';
  lock.anchorX = 0;
  lock.anchorY = 0;
}

/**
 * Does the last request still describe this frame exactly?
 *
 * Everything a signature would encode, compared as numbers: the half-pixel
 * anchor bucket the connector key is built from, the stage box, the chip
 * measure, the HUD occlusion version and its rectangles, and every present
 * panel's measured width, height and label. No allocation, no string. A still
 * Cell answers `true` here every frame and the writer's whole request path
 * becomes a handful of comparisons.
 */
function requestStillDescribes(
  handles: CellConstellationHandles,
  anchorX: number,
  anchorY: number,
  stageWidth: number,
  stageHeight: number,
  safeTop: number,
  edge: number,
  obstacles: readonly HudOcclusionRect[],
  obstacleVersion: number,
): boolean {
  const last = handles.lastRequest;
  if (!last || handles.lastRequestObstacleVersion !== obstacleVersion) return false;
  const input = last.input;
  if (input.stageWidth !== stageWidth || input.stageHeight !== stageHeight
    || input.safeTop !== safeTop || input.edge !== edge) return false;
  if (bucket(anchorX) !== bucket(input.anchorX)
    || bucket(anchorY) !== bucket(input.anchorY)) return false;
  if (last.chipWidth !== handles.chipWidth || last.chipHeight !== handles.chipHeight) return false;
  const frozen = input.obstacles ?? [];
  if (frozen.length !== obstacles.length) return false;
  for (let index = 0; index < obstacles.length; index += 1) {
    const rect = obstacles[index]; const held = frozen[index];
    if (rect.left !== held.left || rect.top !== held.top
      || rect.right !== held.right || rect.bottom !== held.bottom) return false;
  }
  const room = Math.max(CONSTELLATION_MIN_WIDTH_PX, stageWidth - edge * 2);
  let count = 0;
  for (const slot of CONSTELLATION_SLOTS) {
    const panel = handles.panels[slot];
    if (!panel?.present || panel.height <= 0) continue;
    const held = input.panels[count];
    if (!held || held.slot !== slot || held.height !== panel.height
      || held.width !== Math.min(panel.width, room)) return false;
    const leader = handles.leaders[slot];
    if (held.labelWidth !== leader.labelWidth || held.labelHeight !== leader.labelHeight) {
      return false;
    }
    count += 1;
  }
  return count === input.panels.length;
}

function prepareRequest(
  handles: CellConstellationHandles,
  anchorX: number,
  anchorY: number,
  stageWidth: number,
  stageHeight: number,
  safeTop: number,
  edge: number,
  obstacles: readonly HudOcclusionRect[],
  obstacleVersion: number,
): ConstellationFrameRequest {
  if (requestStillDescribes(
    handles, anchorX, anchorY, stageWidth, stageHeight, safeTop, edge,
    obstacles, obstacleVersion,
  )) return handles.lastRequest as ConstellationFrameRequest;
  const panels = collectPanels(handles, stageWidth, edge).map((panel) => ({ ...panel }));
  // The request reserves the chip's PREFERRED position and nothing else. A
  // solve that re-composes seats its plates around the chip; a solve that
  // carries held seats relocates the chip against them inside the derive, and
  // hands the moved rectangle back on `layout.chip`. Keeping the request at the
  // preferred position is what makes `requestStillDescribes` complete: the
  // claim is a function of the anchor bucket, the stage and the chip measure,
  // all of which it already compares, and of no seat that could move under it.
  const chip = chipPlacement(
    handles, anchorX, anchorY, stageWidth, stageHeight, edge, EMPTY_PLACEMENTS,
  );
  const chipX = chip.x; const chipY = chip.y;
  const reserved: HudOcclusionRect[] = [];
  if (handles.chipWidth > 0 && handles.chipHeight > 0) {
    reserved.push({
      left: chip.left, right: chip.right, top: chip.top, bottom: chip.bottom,
    });
  }
  const frozenObstacles = obstacles.map((rect) => ({ ...rect }));
  const layoutKey = layoutSignature(
    stageWidth, stageHeight, safeTop, edge, panels, handles, frozenObstacles, obstacleVersion,
  );
  const connectorKey = `${bucket(anchorX)},${bucket(anchorY)}|${layoutKey}`;
  const request: ConstellationFrameRequest = {
    connectorKey,
    layoutKey,
    panelKey: panelSignature(panels, handles),
    chipX,
    chipY,
    chipWidth: handles.chipWidth,
    chipHeight: handles.chipHeight,
    input: {
      anchorX, anchorY, stageWidth, stageHeight, panels,
      obstacles: frozenObstacles, reserved, safeTop, edge,
      lock: cloneLock(handles.lock),
    },
  };
  handles.lastRequest = request;
  handles.lastRequestObstacleVersion = obstacleVersion;
  return request;
}

/**
 * The two marks that say which Cell this is, written from the live anchor.
 *
 * The chip's rectangle comes from `constellationChip` and nowhere else, so
 * what the reader sees and what the layout reserved are the same rectangle.
 * A write at a position other than the preferred one is a relocation, counted
 * once per move rather than once per frame: the chip standing beside the Cell
 * through a whole reading is one relocation, not six hundred.
 */
function writeMovingMarks(
  handles: CellConstellationHandles,
  anchorX: number,
  anchorY: number,
  chip: ConstellationChipPlacement,
): void {
  if (handles.reticle) {
    const half = CONSTELLATION_RETICLE_PX / 2;
    handles.reticle.style.transform =
      `translate3d(${anchorX - half}px, ${anchorY - half}px, 0)`;
  }
  if (chip.position !== handles.chipPosition) {
    if (!chip.preferred) observeConstellationChipRelocation();
    handles.chipPosition = chip.position;
  }
  if (handles.chip) {
    handles.chip.style.transform =
      `translate3d(${chip.x}px, ${chip.y}px, 0) translateX(-50%)`;
  }
}

function cancelLayoutJob(handles: CellConstellationHandles): void {
  handles.layoutJob?.cursor.return({
    status: 'unavailable', template: null, placements: [], masks: [], leaders: 'clean',
  });
  if (handles.layoutJob) observeConstellationCursorCancel();
  handles.layoutJob = null;
  handles.desiredRequest = null;
  handles.layoutPendingFrames = 0;
  clearFrameBudgetWork(FRAME_BUDGET_PANEL_SOLVE);
}

function cancelRefineJob(handles: CellConstellationHandles): void {
  if (!handles.refineJob) return;
  handles.refineJob.cursor.return(null);
  handles.refineJob = null;
}

function degradedLeaders(layout: ConstellationLayout): number {
  let count = 0;
  for (const placement of layout.placements) {
    if (placement.route?.degraded === true) count += 1;
  }
  return count;
}

/** The same seats, to the pixel — not to the half-pixel bucket the signatures
 * round to. A refinement may write a route only to the plate it measured. */
function samePlacements(
  a: readonly ConstellationPlacement[],
  b: readonly ConstellationPlacement[],
): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    const one = a[index]; const other = b[index];
    if (one.slot !== other.slot || one.x !== other.x || one.y !== other.y
      || one.width !== other.width || one.height !== other.height) return false;
  }
  return true;
}

/**
 * Write a finished refinement over the leaders that are on screen.
 *
 * Routes, labels, masks and the lock's held routes — and nothing else. No seat
 * moves, no host is positioned or hidden, no signature that describes geometry
 * changes, because the geometry did not. Two things can still stop it: the
 * seats it routed for are no longer the seats on screen, in which case it is
 * dropped outright; or the Cell has drifted inside its half-pixel bucket since
 * it started, in which case its routes are carried to the live anchor through
 * the same re-anchor path the locked router uses, and dropped if they will not
 * go.
 */
function applyRefinedRoutes(
  handles: CellConstellationHandles,
  job: ConstellationRefineJob,
  refined: ConstellationLayout,
  latest: ConstellationFrameRequest,
): void {
  const current = handles.lastLayout;
  if (!current || !samePlacements(current.placements, job.placements)
    || !samePlacements(refined.placements, job.placements)) {
    observeConstellationRefineDropped();
    return;
  }
  let applied = refined;
  if (latest.input.anchorX !== job.request.input.anchorX
    || latest.input.anchorY !== job.request.input.anchorY) {
    const carried = revalidateConstellationLayoutForAnchor(
      latest.input, refined, job.request.input.anchorX, job.request.input.anchorY,
    );
    if (!carried || !samePlacements(carried.placements, job.placements)) {
      observeConstellationRefineDropped();
      return;
    }
    applied = carried;
  }
  handles.lastLayout = applied;
  if (handles.provisionalBaseLayout === current) {
    handles.provisionalBaseLayout = applied;
    handles.provisionalBaseAnchorX = latest.input.anchorX;
    handles.provisionalBaseAnchorY = latest.input.anchorY;
  }
  handles.appliedAnchorX = latest.input.anchorX;
  handles.appliedAnchorY = latest.input.anchorY;
  const nextMaskKey = rectKey(applied.masks);
  if (nextMaskKey !== handles.maskKey) {
    handles.maskKey = nextMaskKey;
    writeMasks(handles, applied.masks);
  }
  if (handles.root) handles.root.dataset.cellConstellationLeaders = applied.leaders;
  for (const placement of applied.placements) {
    writeLeader(handles, placement);
    if (placement.slot === 'specimen') handles.lastSpecimen = placement;
    // The lock carries proven lines across the Cell's next move. A refined
    // leader is the best proof the router has; a plate the refinement still
    // could not reach holds nothing, because a fallback is rebuilt from the
    // anchor and never reused.
    const route = placement.route;
    if (route && !route.degraded) handles.lock.routes[placement.slot] = route.points;
    else delete handles.lock.routes[placement.slot];
  }
  // `prepareRequest` hands back the SAME request object while nothing moves,
  // and that object carries a clone of the lock taken before this write. Refresh
  // it, or the next locked solve routes from the leaders this just replaced.
  if (handles.lastRequest) {
    handles.lastRequest.input.lock = cloneLock(handles.lock);
  }
  observeConstellationRefineLanding(job.degradedAtStart - degradedLeaders(applied));
}

/**
 * Look again for the leaders first paint could not afford to find.
 *
 * One refinement is started per landed picture that shows a fallback leader,
 * advanced at the ordinary interaction slice against the same ledger the
 * locked cursor uses, and never at the first-paint allowance: the
 * constellation is already on screen and nothing is waiting for this.
 *
 * It is keyed on the SEATS, not on the anchor. A selected Cell drifts
 * continuously — the canopy turns at 12 % while a Cell is open — so a
 * refinement gated on a still anchor would never get the frames it needs, and
 * the dashed leaders it exists to take back would survive every reading. So it
 * runs on a settled frame and on a drifting frame whose locked solve landed on
 * the same seats, and its routes are carried to the live anchor when it lands.
 * `budgetMs` is what is left of the constellation's own interaction slice: on
 * a drifting frame the locked solve has already spent some of it, and the two
 * together may not cost more than one.
 */
function advanceRefinement(
  handles: CellConstellationHandles,
  request: ConstellationFrameRequest,
  now: () => number,
  budgetMs: number = PANEL_SLICE_BUDGET,
): void {
  let job = handles.refineJob;
  if (job && (job.request.layoutKey !== request.layoutKey
    || handles.lastLayout === null
    || !samePlacements(handles.lastLayout.placements, job.placements))) {
    cancelRefineJob(handles);
    job = null;
  }
  if (!job) {
    const layout = handles.lastLayout;
    if (!layout || layout.leaders !== 'degraded' || layout.placements.length === 0) return;
    const key = `${request.layoutKey}|${handles.placementKey}`;
    if (handles.refinedKey === key) return;
    job = {
      request,
      cursor: refineConstellationRoutesCursor(request.input, layout),
      placements: layout.placements,
      degradedAtStart: degradedLeaders(layout),
    };
    handles.refineJob = job;
    observeConstellationRefineStart();
  }
  announceFrameBudgetWork(FRAME_BUDGET_PANEL_SOLVE, budgetMs);
  if (!mayStartFrameWork(FRAME_BUDGET_PANEL_SOLVE, budgetMs)) return;
  const started = now();
  const sliceProbe = beginCpuProbe(PERFORMANCE_PROBE_LABELS.inspectionLayoutSlice);
  const available = frameBudgetRemainingMs(FRAME_BUDGET_PANEL_SOLVE);
  const allowance = Math.min(budgetMs, available || budgetMs);
  let step = job.cursor.next();
  while (!step.done && now() - started < allowance) step = job.cursor.next();
  const elapsed = now() - started;
  spendFrameBudget(FRAME_BUDGET_PANEL_SOLVE, elapsed);
  observeConstellationCursorSlice(elapsed, false);
  endCpuProbe(sliceProbe);
  if (!step.done) return;
  handles.refineJob = null;
  handles.refinedKey = `${job.request.layoutKey}|${handles.placementKey}`;
  clearFrameBudgetWork(FRAME_BUDGET_PANEL_SOLVE);
  if (step.value === null) return;
  applyRefinedRoutes(handles, job, step.value, request);
}

/**
 * Keep the selected Cell's marks and completed panel seats usable while its
 * camera moves, but remove every leader stroke, endpoint and label. No request
 * is prepared and no route is revalidated here, so motion consumes none of the
 * panel solve budget. Clearing only the connector signature forces the first
 * settled frame through current geometry validation even when the anchor has
 * returned to the same half-pixel bucket.
 */
export function suspendConstellationFrame(
  handles: CellConstellationHandles,
  anchorX: number,
  anchorY: number,
  stageWidth: number,
  stageHeight: number,
  edge: number,
): ConstellationPlacement | null {
  // A travel has nothing left to protect here: the leaders are down for the
  // whole motion window, and a plate still crossing the stage when the camera
  // stops would be a second motion on top of the visitor's own.
  snapSeatTweens(handles);
  // The camera is moving and no solve runs here, but the seats on screen are
  // still the seats the chip has to keep out of, so it is computed against
  // them by the same function the layout uses.
  writeMovingMarks(handles, anchorX, anchorY, chipPlacement(
    handles, anchorX, anchorY, stageWidth, stageHeight, edge, seatedPlacements(handles),
  ));
  if (!handles.motionSuspended) {
    cancelLayoutJob(handles);
    cancelRefineJob(handles);
    handles.frameKey = '';
    handles.connectorKey = '';
    handles.presentationDirty = true;
    handles.provisionalVisible = false;
    handles.motionSuspended = true;
  }
  setLeadersVisible(handles, false);
  for (const slot of CONSTELLATION_SLOTS) {
    const panel = handles.panels[slot];
    if (panel.host && !panelHostIsPositioned(panel)) panel.host.style.visibility = 'hidden';
  }
  // The reticle and identity chip remain useful even when a first selection or
  // a newly opened slot has no legal panel seat yet.
  setConstellationVisible(handles, true);
  if (handles.root) handles.root.dataset.cellConstellationMotion = 'moving';
  return currentSpecimenPlacement(handles);
}

function applyLayout(handles: CellConstellationHandles,
  request: ConstellationFrameRequest, layout: ConstellationLayout): ConstellationPlacement | null {
  const previousLayoutKey = handles.layoutKey;
  handles.frameKey = request.connectorKey;
  handles.connectorKey = request.connectorKey;
  handles.layoutKey = request.layoutKey;
  handles.lastLayout = layout;
  handles.appliedAnchorX = request.input.anchorX;
  handles.appliedAnchorY = request.input.anchorY;
  handles.provisionalBaseLayout = layout;
  handles.provisionalBaseLayoutKey = request.layoutKey;
  handles.provisionalBasePanelKey = request.panelKey;
  handles.provisionalBaseAnchorX = request.input.anchorX;
  handles.provisionalBaseAnchorY = request.input.anchorY;
  handles.provisionalVisible = false;
  handles.presentationDirty = false;
  setConstellationVisible(handles, true);
  setLeadersVisible(handles, true);
  publishLock(handles.lock, request.input.lock as ConstellationLock);
  const nextPlacementKey = placementSignature(layout.placements);
  const placementChanged = nextPlacementKey !== handles.placementKey;
  handles.placementKey = nextPlacementKey;
  // A new PICTURE earns a new second look — new seats, or a new geometry to
  // seat them in. A landing that put the same seats back does not: a drifting
  // Cell lands one of those on every frame, and clearing the key there would
  // start the same refinement over again forever, each one cancelled by the
  // next before it could finish.
  if (placementChanged || previousLayoutKey !== request.layoutKey) {
    handles.refinedKey = '';
  }
  const nextMaskKey = rectKey(layout.masks);
  const maskChanged = nextMaskKey !== handles.maskKey;
  handles.maskKey = nextMaskKey;
  if (handles.root) {
    handles.root.dataset.cellConstellationStatus = layout.status;
    handles.root.dataset.cellConstellationLeaders = layout.leaders;
    if (layout.template) handles.root.dataset.cellConstellationTemplate = layout.template;
    else delete handles.root.dataset.cellConstellationTemplate;
  }
  const present = new Set(layout.placements.map((panel) => panel.slot));
  clearAbsent(handles, present);
  let specimen: ConstellationPlacement | null = null;
  let quadrantsMoved = false;
  let travelling = false;
  for (const current of layout.placements) {
    const panel = handles.panels[current.slot];
    if (current.slot === 'specimen') specimen = current;
    if (handles.quadrant[current.slot] !== current.quadrant) {
      handles.quadrant[current.slot] = current.quadrant;
      quadrantsMoved = true;
    }
    if (writePanelPlacement(handles, panel, current, placementChanged)) travelling = true;
    writeLeader(handles, current);
  }
  if (maskChanged) writeMasks(handles, layout.masks);
  handles.lastSpecimen = specimen;
  noteSeatTravel(handles, travelling);
  if (quadrantsMoved) notifyQuadrants(handles);
  return currentSpecimenPlacement(handles, specimen);
}

/** Write a geometry-validated presentation route without publishing its
 * signatures or lock. The canonical cursor remains the only state commit. */
function applyProvisionalRoutes(
  handles: CellConstellationHandles,
  layout: ConstellationLayout,
  provisional = true,
): ConstellationPlacement | null {
  setConstellationVisible(handles, true);
  setLeadersVisible(handles, true);
  const nextPlacementKey = placementSignature(layout.placements);
  const placementChanged = nextPlacementKey !== handles.placementKey;
  handles.placementKey = nextPlacementKey;
  const nextMaskKey = rectKey(layout.masks);
  if (nextMaskKey !== handles.maskKey) {
    handles.maskKey = nextMaskKey;
    writeMasks(handles, layout.masks);
  }
  if (handles.root) {
    handles.root.dataset.cellConstellationStatus = layout.status;
    handles.root.dataset.cellConstellationLeaders = layout.leaders;
    if (layout.template) handles.root.dataset.cellConstellationTemplate = layout.template;
    else delete handles.root.dataset.cellConstellationTemplate;
  }
  let specimen: ConstellationPlacement | null = null;
  let quadrantsMoved = false;
  let travelling = false;
  const present = new Set(layout.placements.map((panel) => panel.slot));
  clearAbsent(handles, present);
  for (const current of layout.placements) {
    if (current.slot === 'specimen') specimen = current;
    const panel = handles.panels[current.slot];
    if (handles.quadrant[current.slot] !== current.quadrant) {
      handles.quadrant[current.slot] = current.quadrant;
      quadrantsMoved = true;
    }
    if (writePanelPlacement(handles, panel, current, placementChanged)) travelling = true;
    writeLeader(handles, current);
  }
  handles.provisionalVisible = provisional;
  handles.presentationDirty = provisional;
  noteSeatTravel(handles, travelling);
  if (quadrantsMoved) notifyQuadrants(handles);
  return currentSpecimenPlacement(handles, specimen);
}

/** Publish only already-completed panel geometry while its leaders cannot be
 * reconnected safely to the current anchor. The caller has run hardValid for
 * the current request first. This keeps the dossier and portrait available on
 * a very low-frame-rate renderer without ever exposing a stale route. */
function applyPanelPresentation(
  handles: CellConstellationHandles,
  layout: ConstellationLayout,
): ConstellationPlacement | null {
  setConstellationVisible(handles, true);
  setLeadersVisible(handles, false);
  handles.provisionalVisible = false;
  handles.presentationDirty = true;
  const nextPlacementKey = placementSignature(layout.placements);
  const placementChanged = nextPlacementKey !== handles.placementKey;
  handles.placementKey = nextPlacementKey;
  if (handles.root) {
    handles.root.dataset.cellConstellationStatus = layout.status;
    handles.root.dataset.cellConstellationLeaders = layout.leaders;
    if (layout.template) handles.root.dataset.cellConstellationTemplate = layout.template;
    else delete handles.root.dataset.cellConstellationTemplate;
  }
  const present = new Set(layout.placements.map((panel) => panel.slot));
  clearAbsent(handles, present);
  let specimen: ConstellationPlacement | null = null;
  let quadrantsMoved = false;
  let travelling = false;
  for (const current of layout.placements) {
    if (current.slot === 'specimen') specimen = current;
    const panel = handles.panels[current.slot];
    if (handles.quadrant[current.slot] !== current.quadrant) {
      handles.quadrant[current.slot] = current.quadrant;
      quadrantsMoved = true;
    }
    if (writePanelPlacement(handles, panel, current, placementChanged)) travelling = true;
  }
  noteSeatTravel(handles, travelling);
  if (quadrantsMoved) notifyQuadrants(handles);
  return currentSpecimenPlacement(handles, specimen);
}

function showValidatedProvisional(
  handles: CellConstellationHandles,
  request: ConstellationFrameRequest,
): ConstellationPlacement | null | undefined {
  const base = handles.provisionalBaseLayout;
  if (!base || request.panelKey !== handles.provisionalBasePanelKey
    || !Number.isFinite(handles.provisionalBaseAnchorX)) return undefined;
  const validated = revalidateConstellationLayoutForAnchor(
    request.input, base, handles.provisionalBaseAnchorX, handles.provisionalBaseAnchorY,
  );
  if (!validated) return undefined;
  // Advance the safe presentation seed with the moving anchor. That keeps
  // ordinary one-pixel orbit frames on the cheap translated-leg check instead
  // of reconnecting an ever-growing delta from the last canonical landing.
  handles.provisionalBaseLayout = validated;
  handles.provisionalBaseAnchorX = request.input.anchorX;
  handles.provisionalBaseAnchorY = request.input.anchorY;
  return applyProvisionalRoutes(handles, validated);
}

export function commitConstellationFrame(
  handles: CellConstellationHandles,
  anchorX: number,
  anchorY: number,
  stageWidth: number,
  stageHeight: number,
  safeTop: number,
  edge: number,
  obstacles: readonly HudOcclusionRect[],
  obstacleVersion = 0,
): ConstellationPlacement | null {
  advanceSeatTweens(handles);
  const request = prepareRequest(
    handles, anchorX, anchorY, stageWidth, stageHeight, safeTop, edge,
    obstacles, obstacleVersion,
  );
  // The marks track the live anchor, not the request's: a reused request is
  // one whose HALF-PIXEL bucket matched, and the reticle owes the Cell the
  // pixel it is actually on. The chip is measured against the seats on screen,
  // so it yields to them exactly as the locked layout's claim does.
  writeMovingMarks(handles, anchorX, anchorY, chipPlacement(
    handles, anchorX, anchorY, stageWidth, stageHeight, edge, seatedPlacements(handles),
  ));
  if (request.connectorKey === handles.connectorKey && layoutFullyPresented(handles)) {
    return currentSpecimenPlacement(handles);
  }
  cancelRefineJob(handles);
  const layout = constellationLayout(request.input);
  return applyLayout(handles, request, layout);
}

function startLayoutJob(
  request: ConstellationFrameRequest,
  lockedOnly = false,
): ConstellationLayoutJob {
  observeConstellationCursorStart(lockedOnly);
  return {
    request,
    cursor: lockedOnly
      ? constellationLockedLayoutCursor(request.input)
      : constellationLayoutCursor(request.input),
    lockedOnly,
  };
}

/**
 * Advance the canonical layout under the shared per-frame ledger.
 *
 * Geometry changes cancel immediately. Anchor-only changes are coalesced: the
 * active cursor finishes to produce a valid lock seed, then the latest anchor
 * starts from that seed. This prevents continuous camera drift from restarting
 * an expensive first solve forever. Only a result for the latest connector key
 * is published, so a partial or stale route never reaches the DOM.
 */
export function advanceConstellationFrame(
  handles: CellConstellationHandles,
  anchorX: number,
  anchorY: number,
  stageWidth: number,
  stageHeight: number,
  safeTop: number,
  edge: number,
  obstacles: readonly HudOcclusionRect[],
  obstacleVersion = 0,
  frameToken?: number,
  now: () => number = () => performance.now(),
): ConstellationPlacement | null {
  handles.motionSuspended = false;
  if (handles.root) delete handles.root.dataset.cellConstellationMotion;
  beginFrameBudget(frameToken);
  // Before anything else the frame might decide, and on every frame including
  // the ones it decides nothing on: a travel is 240 real milliseconds and most
  // of the frames that carry it are frames the constellation is settled on.
  advanceSeatTweens(handles);
  const desired = prepareRequest(
    handles, anchorX, anchorY, stageWidth, stageHeight, safeTop, edge,
    obstacles, obstacleVersion,
  );
  writeMovingMarks(handles, anchorX, anchorY, chipPlacement(
    handles, anchorX, anchorY, stageWidth, stageHeight, edge, seatedPlacements(handles),
  ));
  handles.desiredRequest = desired;
  // An `unavailable` verdict is a statement about the stage, not about the
  // half pixel the anchor stands on. Hold it while the Cell drifts inside
  // CONSTELLATION_UNAVAILABLE_RESOLVE_PX of where it was asked, and write only
  // the two marks that say which Cell this is. A geometry change re-asks at
  // once, because `layoutKey` carries the viewport, the rails and every panel
  // measure.
  if (handles.lastLayout?.status === 'unavailable'
    && desired.layoutKey === handles.layoutKey
    && Math.hypot(anchorX - handles.appliedAnchorX, anchorY - handles.appliedAnchorY)
      < CONSTELLATION_UNAVAILABLE_RESOLVE_PX) {
    cancelLayoutJob(handles);
    cancelRefineJob(handles);
    handles.desiredRequest = desired;
    setConstellationVisible(handles, true);
    observeConstellationUnavailableHold();
    return null;
  }
  if (desired.connectorKey === handles.connectorKey && layoutFullyPresented(handles)) {
    cancelLayoutJob(handles);
    setConstellationVisible(handles, true);
    if (handles.lastLayout && handles.presentationDirty) {
      handles.provisionalBaseLayout = handles.lastLayout;
      handles.provisionalBaseLayoutKey = handles.layoutKey;
      handles.provisionalBasePanelKey = desired.panelKey;
      handles.provisionalBaseAnchorX = handles.appliedAnchorX;
      handles.provisionalBaseAnchorY = handles.appliedAnchorY;
      applyProvisionalRoutes(handles, handles.lastLayout, false);
    } else setLeadersVisible(handles, true);
    // The one frame a refinement may run on: the picture is complete, the Cell
    // is where the picture was solved for, and nothing is pending.
    advanceRefinement(handles, desired, now);
    // Not `handles.lastSpecimen`: most of a journey's frames are settled ones,
    // and the portrait is owed where the plate IS on each of them.
    return currentSpecimenPlacement(handles);
  }

  // Past here the frame is asking a new question — the geometry changed, the
  // Cell moved to another bucket, or a host is not seated yet — and a solve is
  // about to start. A refinement belongs to the SEATS that are up rather than
  // to the anchor they were solved at, so a Cell that has only moved keeps it
  // and a geometry change takes it away. The seat-change cancel is
  // `advanceRefinement`'s own: it compares the seats to the pixel.
  if (desired.layoutKey !== handles.layoutKey) cancelRefineJob(handles);

  const geometryPending = desired.layoutKey !== handles.layoutKey;
  const provisionalGeometryValid = handles.provisionalBaseLayout !== null
    && desired.panelKey === handles.provisionalBasePanelKey
    && constellationLayoutHardValid(desired.input, handles.provisionalBaseLayout);
  let provisional = showValidatedProvisional(handles, desired);
  let panelPresentation: ConstellationPlacement | null | undefined;
  let heldSeats: ConstellationPlacement | null | undefined;
  if (provisional === undefined) {
    if (provisionalGeometryValid) {
      panelPresentation = applyPanelPresentation(
        handles, handles.provisionalBaseLayout as ConstellationLayout,
      );
    } else {
      // The held seats no longer answer the current request, but they are
      // still where the reader's eyes are. Keep them at the height their
      // content now asks for, withdraw only a plate the Cell has walked into,
      // and show the leaders that can still be carried. The root's opacity
      // belongs to the off-screen test and to the exit, both in the overlay.
      handles.provisionalVisible = false;
      handles.presentationDirty = true;
      setConstellationVisible(handles, true);
      heldSeats = holdStaleSeats(handles, desired);
    }
  }

  let job = handles.layoutJob;
  if (job && job.request.layoutKey !== desired.layoutKey) {
    job.cursor.return({
      status: 'unavailable', template: null, placements: [], masks: [], leaders: 'clean',
    });
    observeConstellationCursorCancel();
    job = null;
    handles.layoutJob = null;
  }
  if (!job) {
    job = startLayoutJob(desired, handles.lastLayout !== null && !geometryPending);
    handles.layoutJob = job;
  }
  // A FULL solve is a new composition by definition: whatever it lands will not
  // be the seats a pending refinement was routed for, so the refinement goes
  // now rather than be dropped when it finishes. A LOCKED solve is the same
  // seats at a new anchor, and the refinement survives it — including the
  // frames where it does not finish inside the slice.
  if (!job.lockedOnly) cancelRefineJob(handles);
  announceFrameBudgetWork(FRAME_BUDGET_PANEL_SOLVE, PANEL_SLICE_BUDGET);
  handles.layoutPendingFrames += 1;
  if (!mayStartFrameWork(FRAME_BUDGET_PANEL_SOLVE, PANEL_SLICE_BUDGET)) {
    if (handles.provisionalVisible) observeConstellationProvisionalFrame();
    return provisional ?? panelPresentation ?? heldSeats ?? null;
  }

  const started = now();
  const sliceProbe = beginCpuProbe(PERFORMANCE_PROBE_LABELS.inspectionLayoutSlice);
  const available = frameBudgetRemainingMs(FRAME_BUDGET_PANEL_SOLVE);
  // A first/full solve may consume the larger reserved slice after three
  // frames. Anchor-only routing stays on the steady interaction budget while
  // its independently validated presentation route remains visible.
  const allowance = !job.lockedOnly
    && handles.layoutPendingFrames >= PANEL_FIRST_PAINT_DEADLINE_FRAMES
    ? Math.max(PANEL_SLICE_BUDGET, Math.min(8, available))
    : Math.min(PANEL_SLICE_BUDGET, available || PANEL_SLICE_BUDGET);
  let landed: ConstellationPlacement | null | undefined;
  while (true) {
    let step = job.cursor.next();
    while (!step.done && now() - started < allowance) {
      step = job.cursor.next();
    }
    if (!step.done) break;

    handles.layoutJob = null;
    const completedRequest = job.request;
    // Always retain the private canonical lock. A stale first solve becomes
    // the seed for the latest anchor instead of being regenerated from zero.
    if (step.value === null) {
      // The bounded locked deadline path could not route the current geometry.
      // Continue with a normal resumable solve on the following frame; never
      // drain its candidate fallback inside this deadline callback.
      job = startLayoutJob(completedRequest);
      handles.layoutJob = job;
      break;
    }
    publishLock(handles.lock, completedRequest.input.lock as ConstellationLock);
    handles.provisionalBaseLayout = step.value;
    handles.provisionalBaseLayoutKey = completedRequest.layoutKey;
    handles.provisionalBasePanelKey = completedRequest.panelKey;
    handles.provisionalBaseAnchorX = completedRequest.input.anchorX;
    handles.provisionalBaseAnchorY = completedRequest.input.anchorY;
    const latest = handles.desiredRequest as ConstellationFrameRequest;
    if (completedRequest.connectorKey === latest.connectorKey) {
      landed = applyLayout(handles, completedRequest, step.value);
      clearFrameBudgetWork(FRAME_BUDGET_PANEL_SOLVE);
      handles.layoutPendingFrames = 0;
      break;
    }

    provisional = showValidatedProvisional(handles, latest);
    latest.input.lock = cloneLock(handles.lock);
    job = startLayoutJob(latest, true);
    handles.layoutJob = job;
    announceFrameBudgetWork(FRAME_BUDGET_PANEL_SOLVE, PANEL_SLICE_BUDGET);
    if (now() - started >= allowance) break;
  }
  const elapsed = now() - started;
  spendFrameBudget(FRAME_BUDGET_PANEL_SOLVE, elapsed);
  observeConstellationCursorSlice(elapsed, false);
  endCpuProbe(sliceProbe);
  if (landed !== undefined) observeConstellationCursorLanding();
  else if (handles.provisionalVisible) observeConstellationProvisionalFrame();
  // The locked cursor may have given up inside the loop and handed the frame to
  // a full solve; that is the same new composition as above.
  if (handles.layoutJob !== null && !handles.layoutJob.lockedOnly) {
    cancelRefineJob(handles);
  } else if (landed !== undefined && desired.layoutKey === handles.layoutKey
    && layoutFullyPresented(handles)) {
    // The Cell moved and the locked path put the same seats back. The picture
    // is complete and nothing is pending, so a refinement that was already
    // looking at those seats keeps looking, on what the solve left of the
    // slice — the two together may not cost more than one interaction slice.
    const left = PANEL_SLICE_BUDGET - elapsed;
    if (left > 0.1) advanceRefinement(handles, desired, now, left);
  }
  return landed === undefined
    ? (provisional ?? panelPresentation ?? heldSeats ?? null)
    : landed;
}

export function setConstellationVisible(handles: CellConstellationHandles, visible: boolean): void {
  if (visible === handles.visible) return;
  handles.visible = visible;
  if (handles.root) handles.root.style.opacity = visible ? '1' : '0';
}
export function invalidateConstellationFrame(handles: CellConstellationHandles): void {
  cancelLayoutJob(handles);
  cancelRefineJob(handles);
  // The picture is being asked again — a viewport, a rail, an instrument that
  // opened or measured itself taller. Whatever was travelling stops where it
  // has got to and that becomes its seat, so the answer this invalidation is
  // waiting for travels from under the reader's eye rather than from a seat
  // nothing is standing on. A NEW CELL is not this event: the overlay calls
  // `resetConstellationSeats` for that, and its instruments arrive.
  dropSeatTweens(handles);
  handles.refinedKey = '';
  handles.frameKey = '';
  handles.layoutKey = '';
  handles.connectorKey = '';
  handles.placementKey = '';
  handles.maskKey = '';
  handles.appliedAnchorX = Number.NaN;
  handles.appliedAnchorY = Number.NaN;
  handles.provisionalBaseLayout = null;
  handles.provisionalBaseLayoutKey = '';
  handles.provisionalBasePanelKey = '';
  handles.provisionalBaseAnchorX = Number.NaN;
  handles.provisionalBaseAnchorY = Number.NaN;
  handles.provisionalVisible = false;
  handles.presentationDirty = false;
  handles.lastRequest = null;
  handles.lastRequestObstacleVersion = -1;
  if (!handles.motionSuspended && handles.root) {
    delete handles.root.dataset.cellConstellationMotion;
  }
}
