import {
  constellationLayout,
  createConstellationLock,
  CONSTELLATION_RETICLE_PX,
  type ConstellationLayout,
  type ConstellationLock,
  type ConstellationPanel,
  type ConstellationPlacement,
  type ConstellationSlot,
} from '../../derives/cellConstellation.derive';
import type { HudOcclusionRect } from '../hudOcclusion';

export interface ConstellationPanelHandle {
  host: HTMLDivElement | null;
  fallbackLabel: HTMLElement | null;
  width: number;
  height: number;
  present: boolean;
}
export interface ConstellationLeaderHandle {
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
      host: null, fallbackLabel: null, width: CONSTELLATION_WIDTH[slot] ?? 408,
      height: 0, present: false,
    };
    leaders[slot] = {
      under: null, over: null, dot: null, label: null,
      labelWidth: slot === 'specimen' ? 78 : 62, labelHeight: 20,
    };
  }
  return {
    root: null, panels, leaders, maskGroup: null, reticle: null, chip: null,
    chipWidth: 0, chipHeight: 0, lock: createConstellationLock(),
    visible: false, leaving: false, frameKey: '', layoutKey: '', connectorKey: '',
    placementKey: '', maskKey: '',
    lastLayout: null, lastSpecimen: null, quadrant: {}, quadrantListeners: new Set(),
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
    const leader = handles.leaders[slot];
    leader.under?.setAttribute('d', '');
    leader.over?.setAttribute('d', '');
    if (leader.dot) leader.dot.style.display = 'none';
    if (leader.label) leader.label.style.display = 'none';
    writeFallback(handles.panels[slot].fallbackLabel, false);
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
  const panels = collectPanels(handles, stageWidth, edge);
  scratchReserved.length = 0;
  const chipX = handles.chipWidth > 0
    ? Math.max(edge + handles.chipWidth / 2,
      Math.min(stageWidth - edge - handles.chipWidth / 2, anchorX))
    : anchorX;
  const chipBelow = anchorY + CONSTELLATION_RETICLE_PX / 2 + 12;
  const chipY = chipBelow + handles.chipHeight <= stageHeight - edge
    ? chipBelow
    : anchorY - CONSTELLATION_RETICLE_PX / 2 - 12 - handles.chipHeight;
  if (handles.chipWidth > 0 && handles.chipHeight > 0) {
    chipBox.left = chipX - handles.chipWidth / 2;
    chipBox.right = chipX + handles.chipWidth / 2;
    chipBox.top = chipY;
    chipBox.bottom = chipBox.top + handles.chipHeight;
    scratchReserved.push(chipBox);
  }
  const nextLayoutKey = layoutSignature(
    stageWidth, stageHeight, safeTop, edge, panels, handles, obstacles, obstacleVersion,
  );
  const nextConnectorKey = `${bucket(anchorX)},${bucket(anchorY)}|${nextLayoutKey}`;
  if (nextConnectorKey === handles.connectorKey) return handles.lastSpecimen;

  const layout = constellationLayout({
    anchorX, anchorY, stageWidth, stageHeight, panels, obstacles,
    reserved: scratchReserved, safeTop, edge, lock: handles.lock,
  });
  handles.frameKey = nextConnectorKey;
  handles.connectorKey = nextConnectorKey;
  handles.layoutKey = nextLayoutKey;
  handles.lastLayout = layout;
  const nextPlacementKey = placementSignature(layout.placements);
  const placementChanged = nextPlacementKey !== handles.placementKey;
  handles.placementKey = nextPlacementKey;
  const nextMaskKey = rectKey(layout.masks);
  const maskChanged = nextMaskKey !== handles.maskKey;
  handles.maskKey = nextMaskKey;
  if (handles.root) {
    handles.root.dataset.cellConstellationStatus = layout.status;
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
    if (placementChanged && panel.host) {
      panel.host.style.transform = `translate3d(${current.x}px, ${current.y}px, 0)`;
      panel.host.style.width = `${current.width}px`;
      panel.host.style.height = `${current.height}px`;
      panel.host.dataset.cellPanelCapped = current.capped ? 'true' : 'false';
      panel.host.dataset.cellPanelQuadrant = current.quadrant;
    }
    const route = current.route;
    const leader = handles.leaders[current.slot];
    if (!route || !leader) continue;
    const d = pathData(route.points);
    leader.under?.setAttribute('d', d);
    leader.over?.setAttribute('d', d);
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
    writeFallback(panel.fallbackLabel, route.label.inPanel);
  }
  if (maskChanged) writeMasks(handles, layout.masks);
  if (handles.reticle) {
    const half = CONSTELLATION_RETICLE_PX / 2;
    handles.reticle.style.transform = `translate3d(${anchorX - half}px, ${anchorY - half}px, 0)`;
  }
  if (handles.chip) {
    handles.chip.style.transform =
      `translate3d(${chipX}px, ${chipY}px, 0) translateX(-50%)`;
  }
  handles.lastSpecimen = specimen;
  if (quadrantsMoved) notifyQuadrants(handles);
  return specimen;
}

export function setConstellationVisible(handles: CellConstellationHandles, visible: boolean): void {
  if (visible === handles.visible) return;
  handles.visible = visible;
  if (handles.root) handles.root.style.opacity = visible ? '1' : '0';
}
export function invalidateConstellationFrame(handles: CellConstellationHandles): void {
  handles.frameKey = '';
  handles.layoutKey = '';
  handles.connectorKey = '';
  handles.placementKey = '';
  handles.maskKey = '';
}
