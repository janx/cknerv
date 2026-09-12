// A constellation with a DOM, driven frame by frame.
//
// The frame writer only ever speaks through elements: a leader is dashed
// because a `<g>` carries `data-cell-leader-degraded`, a plate is seated
// because a host got a transform. Every question about what the reader SAW is
// therefore a question about this tree, and the suites that ask it want the
// same tree — the four instruments at the measures the live capture reported,
// the rails from the same capture, and one anchor that moves.
import {
  advanceConstellationFrame,
  createCellConstellationHandles,
  type CellConstellationHandles,
} from '../../src/components/hud/cellConstellationFrame';
import type { ConstellationSlot } from '../../src/derives/cellConstellation.derive';
import type { HudOcclusionRect } from '../../src/components/hudOcclusion';
import {
  CONSTELLATION_CHIP_HEIGHT,
  CONSTELLATION_CHIP_WIDTH,
  CONSTELLATION_EDGE,
  CONSTELLATION_PANELS,
  CONSTELLATION_SAFE_TOP,
  railsForStage,
} from '../fixtures/cellConstellationMatrix';

export interface ConstellationStage {
  handles: CellConstellationHandles;
  slots: readonly ConstellationSlot[];
  hosts: { [slot: string]: HTMLDivElement };
  groups: { [slot: string]: SVGGElement };
}

/** The writer's own DOM, complete enough that every write it makes lands
 *  somewhere a test can read. `seatClock` is pinned at zero so a travel never
 *  starts inside a probe that is measuring routes. */
export function constellationStage(count: number): ConstellationStage {
  const handles = createCellConstellationHandles();
  const hosts: { [slot: string]: HTMLDivElement } = {};
  const groups: { [slot: string]: SVGGElement } = {};
  const slots: ConstellationSlot[] = [];
  const svg = (name: string) => document.createElementNS('http://www.w3.org/2000/svg', name);
  for (const panel of CONSTELLATION_PANELS.slice(0, count)) {
    const host = document.createElement('div');
    const group = svg('g') as SVGGElement;
    hosts[panel.slot] = host;
    groups[panel.slot] = group;
    slots.push(panel.slot);
    const handle = handles.panels[panel.slot];
    handle.host = host;
    handle.present = true;
    handle.height = panel.height;
    handle.width = panel.width;
    const leader = handles.leaders[panel.slot];
    leader.group = group;
    leader.under = svg('path') as SVGPathElement;
    leader.over = svg('path') as SVGPathElement;
    leader.dot = svg('circle') as SVGCircleElement;
    leader.label = document.createElement('span');
    handle.fallbackLabel = document.createElement('span');
    group.append(leader.under, leader.over, leader.dot);
  }
  handles.root = document.createElement('div');
  handles.reticle = document.createElement('div');
  handles.chip = document.createElement('div');
  handles.maskGroup = svg('g') as SVGGElement;
  handles.chipWidth = CONSTELLATION_CHIP_WIDTH;
  handles.chipHeight = CONSTELLATION_CHIP_HEIGHT;
  handles.seatClock = () => 0;
  return { handles, slots, hosts, groups };
}

/** A budget meter that never runs out. A probe about ROUTING may not have its
 *  frames cut short by a slice, and the writer's own slicing is measured by
 *  the suites that are about slices. */
export function generousClock(): () => number {
  let now = 0;
  return () => { now += 0.02; return now; };
}

export interface ConstellationDriftOptions {
  stageWidth: number;
  stageHeight: number;
  anchorX: number;
  anchorY: number;
  /** Pixels the anchor moves per frame, along x. */
  rate: number;
  frames: number;
  rails?: readonly HudOcclusionRect[];
  /** Called after every frame, with the frame's 1-based serial. */
  onFrame?: (frame: number, anchorX: number, anchorY: number) => void;
  now?: () => number;
}

/** Drive the writer across `frames` frames of drift. Nothing is asserted here;
 *  the caller's `onFrame` reads whatever it came for. */
export function driftConstellation(
  stage: ConstellationStage,
  options: ConstellationDriftOptions,
): void {
  const rails = options.rails ?? railsForStage(options.stageWidth);
  const now = options.now ?? generousClock();
  for (let frame = 1; frame <= options.frames; frame += 1) {
    const anchorX = options.anchorX + options.rate * (frame - 1);
    advanceConstellationFrame(
      stage.handles, anchorX, options.anchorY,
      options.stageWidth, options.stageHeight,
      CONSTELLATION_SAFE_TOP, CONSTELLATION_EDGE, rails, 0, frame, now,
    );
    options.onFrame?.(frame, anchorX, options.anchorY);
  }
}

/** How many of this stage's leaders are showing the dashed fallback, read off
 *  the groups the injected sheet reads. */
export function dashedLeaders(stage: ConstellationStage): number {
  let dashed = 0;
  for (const slot of stage.slots) {
    if (stage.groups[slot].dataset.cellLeaderDegraded === 'true') dashed += 1;
  }
  return dashed;
}

/** How many plates are seated this frame — the denominator of a per-plate
 *  reading. A plate the writer has withdrawn is not a plate whose leader the
 *  reader could have been shown. */
export function seatedPlates(stage: ConstellationStage): number {
  let seated = 0;
  for (const slot of stage.slots) {
    if (stage.handles.panels[slot].positionedHost !== null) seated += 1;
  }
  return seated;
}
