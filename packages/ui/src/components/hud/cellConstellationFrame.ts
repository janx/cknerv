// The DOM half of the constellation: the channel between the anchor in the
// R3F tree and the instruments outside the Canvas, and the one function that
// writes a frame through it.
//
// Same bargain `sceneInspection` strikes for a single card, and for the same
// reason: the anchor must inherit the colony's transform to project the cell,
// the panels are DOM in a different renderer, and nothing on the path between
// them may allocate or read layout sixty times a second. What is different is
// the count — three or four boxes, a reticle, a name chip and three labelled
// leaders instead of one card and one tether — which is exactly why the write
// is gated on a signature rather than done unconditionally.

import {
  constellationLeader,
  constellationPlacement,
  createConstellationLock,
  CONSTELLATION_RETICLE_PX,
  type ConstellationLock,
  type ConstellationPanel,
  type ConstellationPlacement,
  type ConstellationSlot,
} from '../../derives/cellConstellation.derive';
import type { HudOcclusionRect } from '../hudOcclusion';

/** One instrument's channel: the box the frame writer moves, and the height
 *  its own content asked for. Width is declared by the dialect — a hex dump is
 *  seventy-three monospace characters and a register's longest row is 336 px,
 *  so neither is a measurement — and height is measured, because it is the
 *  whole of what varies between one Cell and the next. */
export interface ConstellationPanelHandle {
  host: HTMLDivElement | null;
  width: number;
  height: number;
  /** Mounted at all. A Cell holding no bytes has no reader, and the walk must
   *  not reserve a room for an instrument that is not there. */
  present: boolean;
}

export interface ConstellationLeaderHandle {
  /** Two strokes: a near-black one under a rose one. A single hairline over
   *  the galaxy's brightest nebula is invisible, which is the same problem a
   *  map label solves the same way. */
  under: SVGLineElement | null;
  over: SVGLineElement | null;
  dot: SVGCircleElement | null;
  /** The module tag, riding the line. */
  label: HTMLElement | null;
}

export interface CellConstellationHandles {
  /** The layer-sized container. Owns opacity (the one entrance and the one
   *  exit) and is the dismiss boundary — it is `pointer-events: none`, so a
   *  press that lands on it landed on one of its instruments. */
  root: HTMLDivElement | null;
  panels: { [slot: string]: ConstellationPanelHandle };
  leaders: { [slot: string]: ConstellationLeaderHandle };
  reticle: HTMLElement | null;
  chip: HTMLElement | null;
  /** The chip's own box, measured. The mark on the cell is a reticle AND its
   *  label, and an instrument that clears the reticle can still land on the
   *  name — measured live at 1920, a 376 px chip under a cell at x=960 reached
   *  66 px into the reader standing to its lower right. */
  chipWidth: number;
  chipHeight: number;
  lock: ConstellationLock;
  visible: boolean;
  leaving: boolean;
  /** Last committed signature — clearing forces the next frame to write. */
  frameKey: string;
  /** The specimen's last seat. The portrait channel needs the origin of the
   *  box the braid is scissored into, and a gated frame still owes it the
   *  answer it gave last time rather than nothing. */
  lastSpecimen: ConstellationPlacement | null;
  /** Which quadrant each instrument last took, for the React side. A panel
   *  wants to know so its head can point its close control away from the cell;
   *  nothing else reads it. */
  quadrant: { [slot: string]: string | undefined };
  quadrantListeners: Set<() => void>;
}

export const CONSTELLATION_SLOTS: readonly ConstellationSlot[] = [
  'analysis',
  'specimen',
  'reader',
  'trace',
];

/** The measures the instruments are drawn at. Constants rather than a ladder:
 *  the three-rung width ladder, the notch column and the 640 px compact floor
 *  all existed to fit three panels into one box, and there is no box now. */
export const CONSTELLATION_WIDTH: { [slot: string]: number } = {
  analysis: 440,
  specimen: 280,
  reader: 408,
  trace: 560,
};

/** …and the floor under a stage too narrow to hold one at its own measure.
 *  Below this the register stops being a register — its longest row, a label,
 *  a badge and a mid-truncated hash, measures 336 px. */
export const CONSTELLATION_MIN_WIDTH_PX = 336;

export function createCellConstellationHandles(): CellConstellationHandles {
  const panels: { [slot: string]: ConstellationPanelHandle } = {};
  const leaders: { [slot: string]: ConstellationLeaderHandle } = {};
  for (const slot of CONSTELLATION_SLOTS) {
    panels[slot] = {
      host: null,
      width: CONSTELLATION_WIDTH[slot] ?? 408,
      height: 0,
      present: false,
    };
    leaders[slot] = { under: null, over: null, dot: null, label: null };
  }
  return {
    root: null,
    panels,
    leaders,
    reticle: null,
    chip: null,
    chipWidth: 0,
    chipHeight: 0,
    lock: createConstellationLock(),
    visible: false,
    leaving: false,
    frameKey: '',
    lastSpecimen: null,
    quadrant: {},
    quadrantListeners: new Set(),
  };
}

/** Half-pixel bucket, as the single-card chassis uses: the galaxy autorotates,
 *  so every coordinate here drifts a fraction of a pixel forever and a gate
 *  finer than the eye turns that into a write per frame for as long as an
 *  instrument is open. */
const QUANTUM_PX = 0.5;
const bucket = (value: number): number => Math.round(value / QUANTUM_PX);

/** Scratch, module-scope, re-used. One selection exists at a time — the same
 *  argument the portrait channel is a singleton on. */
const scratchPanels: ConstellationPanel[] = [];
/** …and the obstacles the walk is given: the HUD's rails, plus the name chip,
 *  which is not a rail and is not the reticle and would otherwise be the one
 *  mark on the stage nothing composes around. */
const scratchObstacles: HudOcclusionRect[] = [];
const chipBox: HudOcclusionRect = { left: 0, top: 0, right: 0, bottom: 0 };

function collectPanels(
  handles: CellConstellationHandles,
  stageWidth: number,
  edge: number,
): ConstellationPanel[] {
  scratchPanels.length = 0;
  const room = Math.max(CONSTELLATION_MIN_WIDTH_PX, stageWidth - edge * 2);
  for (const slot of CONSTELLATION_SLOTS) {
    const panel = handles.panels[slot];
    if (!panel?.present || panel.height <= 0) continue;
    scratchPanels.push({
      slot,
      width: Math.min(panel.width, room),
      height: panel.height,
    });
  }
  return scratchPanels;
}

function frameSignature(
  anchorX: number,
  anchorY: number,
  stageWidth: number,
  stageHeight: number,
  panels: readonly ConstellationPanel[],
): string {
  let key = `${bucket(anchorX)},${bucket(anchorY)},${bucket(stageWidth)},${bucket(stageHeight)}`;
  for (const panel of panels) key += `|${panel.slot}:${bucket(panel.width)}:${bucket(panel.height)}`;
  return key;
}

function notifyQuadrants(handles: CellConstellationHandles): void {
  handles.quadrantListeners.forEach((listener) => listener());
}

/**
 * Write one frame: every instrument, the reticle, the chip and every leader.
 *
 * Gated on the signature above, so a constellation merely drifting under the
 * galaxy's own turn costs one string build and a comparison. When it does
 * write, it writes everything — there is no second gate of the kind the single
 * card has for its connector, because a leader here is four numbers on an SVG
 * line rather than a gradient, two glows and a pair of cleared edges.
 *
 * Returns the specimen's placement, or null, because the portrait channel needs
 * the origin of the box the braid is scissored into and this is the only place
 * that knows it.
 */
export function commitConstellationFrame(
  handles: CellConstellationHandles,
  anchorX: number,
  anchorY: number,
  stageWidth: number,
  stageHeight: number,
  safeTop: number,
  edge: number,
  obstacles: readonly HudOcclusionRect[],
): ConstellationPlacement | null {
  const panels = collectPanels(handles, stageWidth, edge);
  if (panels.length === 0) return null;
  const key = frameSignature(anchorX, anchorY, stageWidth, stageHeight, panels)
    + `|c${bucket(handles.chipWidth)}`;
  if (key === handles.frameKey) return handles.lastSpecimen ?? null;
  handles.frameKey = key;

  // The chip hangs under the reticle and the walk composes around it, so the
  // name of the thing being inspected is never printed under an instrument.
  // RESERVED and not an obstacle: a rail is worth a fraction of its area and
  // never moved anything, and the first live run printed the chip across the
  // reader's own header.
  scratchObstacles.length = 0;
  if (handles.chipWidth > 0) {
    chipBox.left = anchorX - handles.chipWidth / 2;
    chipBox.right = anchorX + handles.chipWidth / 2;
    chipBox.top = anchorY + CONSTELLATION_RETICLE_PX / 2 + 12;
    chipBox.bottom = chipBox.top + handles.chipHeight;
    scratchObstacles.push(chipBox);
  }

  const placements = constellationPlacement({
    anchorX,
    anchorY,
    stageWidth,
    stageHeight,
    panels,
    obstacles,
    reserved: scratchObstacles,
    safeTop,
    edge,
    lock: handles.lock,
  });

  let specimen: ConstellationPlacement | null = null;
  let quadrantsMoved = false;
  for (const placement of placements) {
    const handle = handles.panels[placement.slot];
    const host = handle?.host;
    if (placement.slot === 'specimen') specimen = placement;
    if (handles.quadrant[placement.slot] !== placement.quadrant) {
      handles.quadrant[placement.slot] = placement.quadrant;
      quadrantsMoved = true;
    }
    if (host) {
      host.style.transform = `translate3d(${placement.x}px, ${placement.y}px, 0)`;
      host.style.width = `${placement.width}px`;
      host.style.height = `${placement.height}px`;
      // The register is the only instrument that can outgrow the band, and it
      // is told so rather than left to discover it: a capped panel scrolls and
      // owes the reader a rail, an uncapped one must never grow one.
      host.dataset.cellPanelCapped = placement.capped ? 'true' : 'false';
      host.dataset.cellPanelQuadrant = placement.quadrant;
    }
    const leader = handles.leaders[placement.slot];
    if (leader) {
      const line = constellationLeader(
        anchorX,
        anchorY,
        CONSTELLATION_RETICLE_PX,
        placement,
      );
      for (const stroke of [leader.under, leader.over]) {
        if (!stroke) continue;
        stroke.setAttribute('x1', `${line.x1}`);
        stroke.setAttribute('y1', `${line.y1}`);
        stroke.setAttribute('x2', `${line.x2}`);
        stroke.setAttribute('y2', `${line.y2}`);
      }
      if (leader.dot) {
        leader.dot.setAttribute('cx', `${line.x2}`);
        leader.dot.setAttribute('cy', `${line.y2}`);
      }
      if (leader.label) {
        // 0.52 rather than the midpoint: a label exactly halfway sits on the
        // reticle's own ring for the shortest runs, and the runs are shortest
        // on the smallest stages, which is where it matters most.
        const lx = line.x1 + (line.x2 - line.x1) * 0.52;
        const ly = line.y1 + (line.y2 - line.y1) * 0.52;
        leader.label.style.transform = `translate3d(${lx}px, ${ly}px, 0) translate(-50%, -50%)`;
      }
    }
  }
  if (handles.reticle) {
    const half = CONSTELLATION_RETICLE_PX / 2;
    handles.reticle.style.transform = `translate3d(${anchorX - half}px, ${anchorY - half}px, 0)`;
  }
  if (handles.chip) {
    handles.chip.style.transform =
      `translate3d(${anchorX}px, ${anchorY + CONSTELLATION_RETICLE_PX / 2 + 12}px, 0) translateX(-50%)`;
  }
  handles.lastSpecimen = specimen;
  if (quadrantsMoved) notifyQuadrants(handles);
  return specimen;
}

/** Show or hide the whole constellation in one write. The cell has left the
 *  frustum, or come back into it; every instrument answers together, because
 *  they are readings of one thing. */
export function setConstellationVisible(
  handles: CellConstellationHandles,
  visible: boolean,
): void {
  if (visible === handles.visible) return;
  handles.visible = visible;
  if (handles.root) handles.root.style.opacity = visible ? '1' : '0';
}

/** A fresh element inherits none of what the gate assumes it kept. */
export function invalidateConstellationFrame(
  handles: CellConstellationHandles,
): void {
  handles.frameKey = '';
}
