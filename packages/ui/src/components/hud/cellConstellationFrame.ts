import {
  constellationLayout,
  constellationLayoutHardValid,
  constellationLayoutCursor,
  constellationLockedLayoutCursor,
  observeConstellationCursorCancel,
  observeConstellationCursorLanding,
  observeConstellationProvisionalFrame,
  observeConstellationCursorSlice,
  observeConstellationCursorStart,
  createConstellationLock,
  revalidateConstellationLayoutForAnchor,
  CONSTELLATION_RETICLE_PX,
  CONSTELLATION_ROUTE_CLEARANCE_PX,
  CONSTELLATION_UNAVAILABLE_RESOLVE_PX,
  type ConstellationLayout,
  type ConstellationLock,
  type ConstellationPanel,
  type ConstellationPlacement,
  type ConstellationSlot,
  type ConstellationInput,
} from '../../derives/cellConstellation.derive';
import type { HudOcclusionRect } from '../hudOcclusion';
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

interface ConstellationFrameRequest {
  connectorKey: string;
  layoutKey: string;
  /** Panel/content identity for safely validating a presentation across a
   * viewport or HUD-rail change. The validator still checks every current
   * bound, obstacle, route and label before anything is shown. */
  panelKey: string;
  chipX: number;
  chipY: number;
  input: ConstellationInput;
}

interface ConstellationLayoutJob {
  request: ConstellationFrameRequest;
  cursor: Generator<void, ConstellationLayout | null>;
  lockedOnly: boolean;
}

export interface ConstellationPanelHandle {
  host: HTMLDivElement | null;
  /** The exact DOM host that has received a complete, valid placement. */
  positionedHost: HTMLDivElement | null;
  fallbackLabel: HTMLElement | null;
  width: number;
  height: number;
  present: boolean;
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
  desiredRequest: ConstellationFrameRequest | null;
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
}

export const CONSTELLATION_SLOTS: readonly ConstellationSlot[] = [
  'analysis', 'specimen', 'reader', 'trace',
];
export const CONSTELLATION_WIDTH: { [slot: string]: number } = {
  analysis: 440, specimen: 280, reader: 408, trace: 560,
};
export const CONSTELLATION_MIN_WIDTH_PX = 336;

export function createCellConstellationHandles(): CellConstellationHandles {
  const panels: { [slot: string]: ConstellationPanelHandle } = {};
  const leaders: { [slot: string]: ConstellationLeaderHandle } = {};
  for (const slot of CONSTELLATION_SLOTS) {
    panels[slot] = {
      host: null, positionedHost: null, fallbackLabel: null,
      width: CONSTELLATION_WIDTH[slot] ?? 408,
      height: 0, present: false,
    };
    leaders[slot] = {
      group: null, under: null, over: null, dot: null, label: null,
      labelWidth: slot === 'specimen' ? 78 : 62, labelHeight: 20,
    };
  }
  return {
    root: null, panels, leaders, maskGroup: null, reticle: null, chip: null,
    chipWidth: 0, chipHeight: 0, lock: createConstellationLock(),
    visible: false, leaving: false, frameKey: '', layoutKey: '', connectorKey: '',
    placementKey: '', maskKey: '',
    lastLayout: null, lastSpecimen: null, quadrant: {}, quadrantListeners: new Set(),
    layoutJob: null, desiredRequest: null,
    layoutPendingFrames: 0,
    appliedAnchorX: Number.NaN, appliedAnchorY: Number.NaN,
    provisionalBaseLayout: null,
    provisionalBaseLayoutKey: '',
    provisionalBasePanelKey: '',
    provisionalBaseAnchorX: Number.NaN, provisionalBaseAnchorY: Number.NaN,
    provisionalVisible: false, presentationDirty: false, motionSuspended: false,
  };
}

const QUANTUM_PX = 0.5;
const bucket = (value: number): number => Math.round(value / QUANTUM_PX);
const scratchPanels: ConstellationPanel[] = [];
const scratchReserved: HudOcclusionRect[] = [];
const chipBox: HudOcclusionRect = { left: 0, top: 0, right: 0, bottom: 0 };

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

function writePanelPlacement(
  panel: ConstellationPanelHandle,
  placement: ConstellationPlacement,
  placementChanged: boolean,
): void {
  const host = panel.host;
  if (!host) return;
  // A new selection or reopened slot owns fresh DOM even when its dimensions
  // happen to reproduce the previous placement signature. It is not seated
  // until this exact host receives every placement field.
  if (placementChanged || panel.positionedHost !== host) {
    host.style.transform = `translate3d(${placement.x}px, ${placement.y}px, 0)`;
    host.style.width = `${placement.width}px`;
    host.style.height = `${placement.height}px`;
    host.dataset.cellPanelCapped = placement.capped ? 'true' : 'false';
    host.dataset.cellPanelQuadrant = placement.quadrant;
  }
  panel.positionedHost = host;
  host.style.visibility = 'visible';
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

function currentSpecimenPlacement(
  handles: CellConstellationHandles,
  placement: ConstellationPlacement | null = handles.lastSpecimen,
): ConstellationPlacement | null {
  return placement?.slot === 'specimen'
    && handles.panels.specimen.present
    && panelHostIsPositioned(handles.panels.specimen)
    ? placement
    : null;
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
 * other plate stays exactly where the reader last saw it. Its leaders are
 * hidden by the caller, because a leader belongs to an anchor and this one is
 * stale; a seat does not.
 */
function holdStaleSeats(
  handles: CellConstellationHandles,
  request: ConstellationFrameRequest,
): ConstellationPlacement | null {
  const layout = handles.provisionalBaseLayout ?? handles.lastLayout;
  if (!layout) return null;
  const { anchorX, anchorY, stageWidth, stageHeight, safeTop, edge } = request.input;
  const core = CONSTELLATION_RETICLE_PX / 2 + CONSTELLATION_ROUTE_CLEARANCE_PX;
  let specimen: ConstellationPlacement | null = null;
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
    if (placement.slot === 'specimen') specimen = placement;
  }
  return currentSpecimenPlacement(handles, specimen);
}
function setLeadersVisible(handles: CellConstellationHandles, visible: boolean): void {
  const visibility = visible ? '' : 'hidden';
  for (const slot of CONSTELLATION_SLOTS) {
    const leader = handles.leaders[slot];
    if (leader.under) leader.under.style.visibility = visibility;
    if (leader.over) leader.over.style.visibility = visibility;
    if (leader.dot) leader.dot.style.visibility = visibility;
    if (leader.label) leader.label.style.visibility = visibility;
    if (!visible) writeFallback(handles.panels[slot].fallbackLabel, false);
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
    geometryKey: lock.geometryKey,
    anchorX: lock.anchorX,
    anchorY: lock.anchorY,
  };
}

function publishLock(target: ConstellationLock, source: ConstellationLock): void {
  resetLockObject(target);
  target.template = source.template;
  target.geometryKey = source.geometryKey;
  target.anchorX = source.anchorX;
  target.anchorY = source.anchorY;
  Object.assign(target.quadrant, source.quadrant);
  for (const slot of Object.keys(source.placements)) {
    const panel = source.placements[slot];
    if (panel) target.placements[slot] = { ...panel, route: undefined };
  }
}

function resetLockObject(lock: ConstellationLock): void {
  for (const slot of Object.keys(lock.quadrant)) delete lock.quadrant[slot];
  for (const slot of Object.keys(lock.placements)) delete lock.placements[slot];
  lock.template = null;
  lock.geometryKey = '';
  lock.anchorX = 0;
  lock.anchorY = 0;
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
  const panels = collectPanels(handles, stageWidth, edge).map((panel) => ({ ...panel }));
  const chipX = handles.chipWidth > 0
    ? Math.max(edge + handles.chipWidth / 2,
      Math.min(stageWidth - edge - handles.chipWidth / 2, anchorX))
    : anchorX;
  const chipBelow = anchorY + CONSTELLATION_RETICLE_PX / 2 + 12;
  const chipY = chipBelow + handles.chipHeight <= stageHeight - edge
    ? chipBelow
    : anchorY - CONSTELLATION_RETICLE_PX / 2 - 12 - handles.chipHeight;
  const reserved: HudOcclusionRect[] = [];
  if (handles.chipWidth > 0 && handles.chipHeight > 0) {
    reserved.push({
      left: chipX - handles.chipWidth / 2,
      right: chipX + handles.chipWidth / 2,
      top: chipY,
      bottom: chipY + handles.chipHeight,
    });
  }
  const frozenObstacles = obstacles.map((rect) => ({ ...rect }));
  const layoutKey = layoutSignature(
    stageWidth, stageHeight, safeTop, edge, panels, handles, frozenObstacles, obstacleVersion,
  );
  const connectorKey = `${bucket(anchorX)},${bucket(anchorY)}|${layoutKey}`;
  return {
    connectorKey,
    layoutKey,
    panelKey: panelSignature(panels, handles),
    chipX,
    chipY,
    input: {
      anchorX, anchorY, stageWidth, stageHeight, panels,
      obstacles: frozenObstacles, reserved, safeTop, edge,
      lock: cloneLock(handles.lock),
    },
  };
}

function writeMovingMarks(
  handles: CellConstellationHandles,
  anchorX: number,
  anchorY: number,
  chipX: number,
  chipY: number,
): void {
  if (handles.reticle) {
    const half = CONSTELLATION_RETICLE_PX / 2;
    handles.reticle.style.transform =
      `translate3d(${anchorX - half}px, ${anchorY - half}px, 0)`;
  }
  if (handles.chip) {
    handles.chip.style.transform =
      `translate3d(${chipX}px, ${chipY}px, 0) translateX(-50%)`;
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
  const chipX = handles.chipWidth > 0
    ? Math.max(edge + handles.chipWidth / 2,
      Math.min(stageWidth - edge - handles.chipWidth / 2, anchorX))
    : anchorX;
  const chipBelow = anchorY + CONSTELLATION_RETICLE_PX / 2 + 12;
  const chipY = chipBelow + handles.chipHeight <= stageHeight - edge
    ? chipBelow
    : anchorY - CONSTELLATION_RETICLE_PX / 2 - 12 - handles.chipHeight;
  writeMovingMarks(handles, anchorX, anchorY, chipX, chipY);
  if (!handles.motionSuspended) {
    cancelLayoutJob(handles);
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
  for (const current of layout.placements) {
    const panel = handles.panels[current.slot];
    if (current.slot === 'specimen') specimen = current;
    if (handles.quadrant[current.slot] !== current.quadrant) {
      handles.quadrant[current.slot] = current.quadrant;
      quadrantsMoved = true;
    }
    writePanelPlacement(panel, current, placementChanged);
    writeLeader(handles, current);
  }
  if (maskChanged) writeMasks(handles, layout.masks);
  handles.lastSpecimen = specimen;
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
  const present = new Set(layout.placements.map((panel) => panel.slot));
  clearAbsent(handles, present);
  for (const current of layout.placements) {
    if (current.slot === 'specimen') specimen = current;
    const panel = handles.panels[current.slot];
    if (handles.quadrant[current.slot] !== current.quadrant) {
      handles.quadrant[current.slot] = current.quadrant;
      quadrantsMoved = true;
    }
    writePanelPlacement(panel, current, placementChanged);
    writeLeader(handles, current);
  }
  handles.provisionalVisible = provisional;
  handles.presentationDirty = provisional;
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
  for (const current of layout.placements) {
    if (current.slot === 'specimen') specimen = current;
    const panel = handles.panels[current.slot];
    if (handles.quadrant[current.slot] !== current.quadrant) {
      handles.quadrant[current.slot] = current.quadrant;
      quadrantsMoved = true;
    }
    writePanelPlacement(panel, current, placementChanged);
  }
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
  const request = prepareRequest(
    handles, anchorX, anchorY, stageWidth, stageHeight, safeTop, edge,
    obstacles, obstacleVersion,
  );
  writeMovingMarks(
    handles,
    request.input.anchorX,
    request.input.anchorY,
    request.chipX,
    request.chipY,
  );
  if (request.connectorKey === handles.connectorKey && layoutFullyPresented(handles)) {
    return currentSpecimenPlacement(handles);
  }
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
  const desired = prepareRequest(
    handles, anchorX, anchorY, stageWidth, stageHeight, safeTop, edge,
    obstacles, obstacleVersion,
  );
  writeMovingMarks(
    handles,
    desired.input.anchorX,
    desired.input.anchorY,
    desired.chipX,
    desired.chipY,
  );
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
    handles.desiredRequest = desired;
    setConstellationVisible(handles, true);
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
    return handles.lastSpecimen;
  }

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
      // still where the reader's eyes are. Keep them, hide the leaders, and
      // withdraw only a plate the Cell has walked into. The root's opacity
      // belongs to the off-screen test and to the exit, both in the overlay.
      setLeadersVisible(handles, false);
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
  if (!handles.motionSuspended && handles.root) {
    delete handles.root.dataset.cellConstellationMotion;
  }
}
