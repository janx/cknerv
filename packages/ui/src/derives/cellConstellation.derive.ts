/**
 * Where a selected Cell's instruments stand, and how each one reaches it.
 *
 * The contract, since the 2026-09-11 repair: geometry alone decides. A
 * candidate is a seat set; `hardValid` is the only gate it must pass, and the
 * squeeze is escalated only when no candidate at the current squeeze passes
 * it — a gap of 16 px is always tried before any height is taken back, and a
 * leader that cannot be drawn is never a reason to compress a plate or to
 * withdraw one. Every seated plate then receives a route: the canonical
 * orthogonal one where the router finds it, and otherwise a DEGRADED route,
 * the straight leader from the reticle ring to the nearest point of the plate,
 * snapped to two legs where that is clear of the plate body and the reticle.
 * `route.degraded` says which, `layout.leaders` says whether any leader in the
 * layout is a fallback, and `status` is now a statement about room only:
 * `unavailable` means no seat set exists, never that no line could be drawn.
 * Candidates are still tried in score order and the first fully clean one
 * wins, so wherever today's router succeeds the picture is unchanged; when
 * none is clean the candidate with the fewest degraded leaders wins.
 */
import type { HudOcclusionRect } from '../components/hudOcclusion';

export type ConstellationQuadrant = 'tl' | 'tr' | 'bl' | 'br';
export type ConstellationSlot = 'analysis' | 'specimen' | 'reader' | 'trace';
export type ConstellationTemplate = 'split-left' | 'split-right' | 'expand-left'
  | 'expand-right' | 'fold-above' | 'fold-below' | 'distributed';

export const CONSTELLATION_ORDER: readonly ConstellationSlot[] = [
  'analysis', 'specimen', 'reader', 'trace',
];
export const CONSTELLATION_RETICLE_PX = 92;
export const CONSTELLATION_MIN_GAP_PX = 16;
export const CONSTELLATION_PREFERRED_GAP_PX = 24;
export const CONSTELLATION_MIN_HEIGHT_PX = 168;
export const CONSTELLATION_STACK_MIN_PX = 120;
export const CONSTELLATION_HOLD_MARGIN_PX = 96;
export const CONSTELLATION_ROUTE_CLEARANCE_PX = 8;
export const CONSTELLATION_ROUTE_MAX_BENDS = 3;

/**
 * How far the Cell must travel before a stage that had no room for its
 * instruments is asked again.
 *
 * An `unavailable` verdict is a statement about the stage, not about the
 * half-pixel the anchor happens to occupy, and re-deriving it every frame
 * costs a full candidate enumeration for an answer that cannot change. The
 * trade is latency against work: at 24 px the constellation appears within
 * about a tenth of a second of the Cell reaching a part of the stage that has
 * room for it, at a fortieth of the solves a per-frame re-ask would cost. A
 * geometry change — a viewport, a rail, a panel height — re-asks immediately
 * whatever this says.
 */
export const CONSTELLATION_UNAVAILABLE_RESOLVE_PX = 24;

export interface ConstellationPanel {
  slot: ConstellationSlot;
  width: number;
  height: number;
  labelWidth?: number;
  labelHeight?: number;
}
export interface ConstellationPoint { x: number; y: number }
export interface ConstellationLabelPlacement {
  x: number; y: number; width: number; height: number; inPanel: boolean;
}
export interface ConstellationRoute {
  points: readonly ConstellationPoint[];
  label: ConstellationLabelPlacement;
  /** True when the canonical orthogonal router could not reach this plate and
   * the straight fallback leader was drawn instead. The marks draw a degraded
   * leader dashed, because a fallback that looks like the real thing is a
   * lie about what the layout knows. */
  degraded: boolean;
}
export interface ConstellationPlacement {
  slot: ConstellationSlot;
  quadrant: ConstellationQuadrant;
  x: number; y: number; width: number; height: number;
  capped: boolean;
  route?: ConstellationRoute;
}
export interface ConstellationLayout {
  /** Room, and only room. `unavailable` means no seat set passes `hardValid`
   * on this stage; it never means a line could not be drawn. */
  status: 'normal' | 'compressed' | 'unavailable';
  template: ConstellationTemplate | null;
  placements: ConstellationPlacement[];
  masks: HudOcclusionRect[];
  /** `degraded` when at least one leader in this layout is the fallback. */
  leaders: 'clean' | 'degraded';
}
interface Box { x: number; y: number; width: number; height: number }
interface Candidate { template: ConstellationTemplate; placements: ConstellationPlacement[] }

export interface ConstellationWorkStats {
  fullSolves: number;
  lockedReuses: number;
  candidatesBuilt: number;
  candidatesValidated: number;
  routeOrders: number;
  fastRouteAttempts: number;
  searchedRouteAttempts: number;
  cursorSlices: number;
  cursorMaxSliceMs: number;
  cursorPending: number;
  cursorCancels: number;
  cursorForcedCatchUps: number;
  cursorFullStarts: number;
  cursorLockedStarts: number;
  cursorLandings: number;
  cursorProvisionalFrames: number;
}

const constellationWorkStats: ConstellationWorkStats = {
  fullSolves: 0,
  lockedReuses: 0,
  candidatesBuilt: 0,
  candidatesValidated: 0,
  routeOrders: 0,
  fastRouteAttempts: 0,
  searchedRouteAttempts: 0,
  cursorSlices: 0,
  cursorMaxSliceMs: 0,
  cursorPending: 0,
  cursorCancels: 0,
  cursorForcedCatchUps: 0,
  cursorFullStarts: 0,
  cursorLockedStarts: 0,
  cursorLandings: 0,
  cursorProvisionalFrames: 0,
};

export function observeConstellationCursorStart(locked: boolean): void {
  constellationWorkStats.cursorPending = 1;
  if (locked) constellationWorkStats.cursorLockedStarts += 1;
  else constellationWorkStats.cursorFullStarts += 1;
}
export function observeConstellationCursorCancel(): void {
  constellationWorkStats.cursorCancels += 1;
  constellationWorkStats.cursorPending = 0;
}
export function observeConstellationCursorSlice(elapsedMs: number, forced: boolean): void {
  constellationWorkStats.cursorSlices += 1;
  constellationWorkStats.cursorMaxSliceMs = Math.max(
    constellationWorkStats.cursorMaxSliceMs, elapsedMs,
  );
  if (forced) constellationWorkStats.cursorForcedCatchUps += 1;
}
export function observeConstellationCursorLanding(): void {
  constellationWorkStats.cursorLandings += 1;
  constellationWorkStats.cursorPending = 0;
}

export function observeConstellationProvisionalFrame(): void {
  constellationWorkStats.cursorProvisionalFrames += 1;
}

export function snapshotConstellationWorkStats(): ConstellationWorkStats {
  return { ...constellationWorkStats };
}

export function resetConstellationWorkStats(): void {
  for (const key of Object.keys(constellationWorkStats) as Array<keyof ConstellationWorkStats>) {
    constellationWorkStats[key] = 0;
  }
}

export interface ConstellationLock {
  quadrant: { [slot: string]: ConstellationQuadrant | undefined };
  template: ConstellationTemplate | null;
  placements: { [slot: string]: ConstellationPlacement | undefined };
  geometryKey: string;
  anchorX: number;
  anchorY: number;
}
export function createConstellationLock(): ConstellationLock {
  return { quadrant: {}, template: null, placements: {}, geometryKey: '', anchorX: 0, anchorY: 0 };
}
export function resetConstellationLock(lock: ConstellationLock): void {
  for (const key of Object.keys(lock.quadrant)) delete lock.quadrant[key];
  for (const key of Object.keys(lock.placements)) delete lock.placements[key];
  lock.template = null;
  lock.geometryKey = '';
  lock.anchorX = 0;
  lock.anchorY = 0;
}

export interface ConstellationInput {
  anchorX: number; anchorY: number;
  stageWidth: number; stageHeight: number;
  panels: readonly ConstellationPanel[];
  obstacles?: readonly HudOcclusionRect[];
  reserved?: readonly HudOcclusionRect[];
  safeTop: number; edge: number;
  lock?: ConstellationLock;
}

export function constellationKeepoutPx(stageWidth: number, stageHeight: number): number {
  const short = Math.min(
    Number.isFinite(stageWidth) ? stageWidth : 0,
    Number.isFinite(stageHeight) ? stageHeight : 0,
  );
  return Math.round(Math.max(92, Math.min(120, short * 0.16)));
}

const clamp = (value: number, low: number, high: number): number => (
  high < low ? low : Math.max(low, Math.min(high, value))
);
const boxOf = (p: ConstellationPlacement): Box => ({
  x: p.x, y: p.y, width: p.width, height: p.height,
});
const rectBox = (r: HudOcclusionRect): Box => ({
  x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top,
});
const rectOf = (b: Box): HudOcclusionRect => ({
  left: b.x, top: b.y, right: b.x + b.width, bottom: b.y + b.height,
});
const intersectionArea = (a: Box, b: Box): number => {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
};
const expanded = (b: Box, by: number): Box => ({
  x: b.x - by, y: b.y - by, width: b.width + by * 2, height: b.height + by * 2,
});
const nearestDistance = (b: Box, x: number, y: number): number => Math.hypot(
  clamp(x, b.x, b.x + b.width) - x,
  clamp(y, b.y, b.y + b.height) - y,
);
const quadrantFor = (b: Box, x: number, y: number): ConstellationQuadrant => {
  const left = b.x + b.width / 2 < x;
  const top = b.y + b.height / 2 < y;
  return `${top ? 't' : 'b'}${left ? 'l' : 'r'}` as ConstellationQuadrant;
};
const orderedPanels = (panels: readonly ConstellationPanel[]): ConstellationPanel[] => (
  CONSTELLATION_ORDER
    .map((slot) => panels.find((panel) => panel.slot === slot))
    .filter((panel): panel is ConstellationPanel => panel !== undefined)
);
const cappable = (slot: ConstellationSlot): boolean => slot !== 'specimen';
function panelHeight(panel: ConstellationPanel, squeeze: number): number {
  if (!cappable(panel.slot)) return panel.height;
  const floor = Math.min(panel.height, CONSTELLATION_STACK_MIN_PX);
  return Math.min(panel.height, Math.max(floor, panel.height * squeeze));
}
function placement(panel: ConstellationPanel, height: number, x: number, y: number,
  ax: number, ay: number): ConstellationPlacement {
  const base = { x, y, width: panel.width, height };
  return {
    slot: panel.slot, quadrant: quadrantFor(base, ax, ay), ...base,
    capped: height < panel.height - 0.5,
  };
}

function templateForSides(sides: readonly string[]): ConstellationTemplate {
  const set = new Set(sides);
  if (set.size <= 2 && set.has('l') && set.has('r')) {
    return sides[0] === 'l' ? 'split-left' : 'split-right';
  }
  if (set.size === 1 && set.has('t')) return 'fold-above';
  if (set.size === 1 && set.has('b')) return 'fold-below';
  return 'distributed';
}

/** One bounded whole-group candidate. L/R are vertical columns and T/B use
 * compact horizontal shelves. At four panels the exhaustive set has only 256
 * members, including mixed shelf-and-column layouts. */
function distributedCandidate(
  input: ConstellationInput,
  panels: readonly ConstellationPanel[],
  sides: readonly ('l' | 'r' | 't' | 'b')[],
  squeeze: number,
  gap: number,
): Candidate | null {
  const groups = { l: [] as ConstellationPanel[], r: [] as ConstellationPanel[],
    t: [] as ConstellationPanel[], b: [] as ConstellationPanel[] };
  panels.forEach((panel, index) => groups[sides[index]].push(panel));
  const out: ConstellationPlacement[] = [];
  const minY = input.safeTop; const maxY = input.stageHeight - input.edge;
  const minX = input.edge; const maxX = input.stageWidth - input.edge;
  const coreGap = (input.stageWidth >= 1280
    ? constellationKeepoutPx(input.stageWidth, input.stageHeight)
    : CONSTELLATION_RETICLE_PX / 2 + CONSTELLATION_ROUTE_CLEARANCE_PX) + gap;
  const reserved = input.reserved ?? [];
  for (const side of ['l', 'r'] as const) {
    const group = groups[side];
    if (group.length === 0) continue;
    const columnWidth = Math.max(...group.map((panel) => panel.width));
    const heights = group.map((panel) => panelHeight(panel, squeeze));
    const total = heights.reduce((sum, value) => sum + value, 0) + gap * (group.length - 1);
    if (total > maxY - minY + 0.5) return null;
    let y = clamp(input.anchorY - total / 2, minY, maxY - total);
    let columnEdge = side === 'l'
      ? input.anchorX - coreGap - columnWidth
      : input.anchorX + coreGap;
    for (const claim of reserved) {
      const crossesColumn = columnEdge < claim.right && columnEdge + columnWidth > claim.left;
      if (!crossesColumn || y >= claim.bottom || y + total <= claim.top) continue;
      const shiftedEdge = side === 'l'
        ? claim.left - gap - columnWidth
        : claim.right + gap;
      if (shiftedEdge >= minX - 0.5 && shiftedEdge + columnWidth <= maxX + 0.5) {
        columnEdge = shiftedEdge;
        continue;
      }
      const above = claim.top - gap - total;
      const below = claim.bottom + gap;
      const aboveFits = above >= minY; const belowFits = below + total <= maxY;
      if (aboveFits && (!belowFits || Math.abs(above - y) <= Math.abs(below - y))) y = above;
      else if (belowFits) y = below;
    }
    const columnXs = group.map((panel) => side === 'l'
      ? columnEdge + columnWidth - panel.width
      : columnEdge);
    for (let index = 0; index < group.length; index += 1) {
      const panel = group[index];
      const x = columnXs[index];
      if (x < minX - 0.5 || x + panel.width > maxX + 0.5) return null;
      out.push(placement(panel, heights[index], x, y, input.anchorX, input.anchorY));
      y += heights[index] + gap;
    }
  }
  for (const side of ['t', 'b'] as const) {
    const group = groups[side];
    if (group.length === 0) continue;
    const rows = shelfRows(group, maxX - minX, gap);
    if (!rows) return null;
    const rowHeights = rows.map((row) => Math.max(
      ...row.map((panel) => panelHeight(panel, squeeze)),
    ));
    const totalHeight = rowHeights.reduce((sum, height) => sum + height, 0)
      + gap * Math.max(0, rows.length - 1);
    const topEdge = Math.min(input.anchorY - coreGap,
      ...reserved.map((box) => box.top - gap));
    const bottomEdge = Math.max(input.anchorY + coreGap,
      ...reserved.map((box) => box.bottom + gap));
    const hasSideColumn = groups.l.length > 0 || groups.r.length > 0;
    let y = side === 't'
      ? (hasSideColumn ? minY : topEdge - totalHeight)
      : (hasSideColumn ? maxY - totalHeight : bottomEdge);
    if (y < minY - 0.5 || y + totalHeight > maxY + 0.5) return null;
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex]; const rowHeight = rowHeights[rowIndex];
      const rowWidth = row.reduce((sum, panel) => sum + panel.width, 0)
        + gap * Math.max(0, row.length - 1);
      let x = clamp(input.anchorX - rowWidth / 2, minX, maxX - rowWidth);
      for (const panel of row) {
        const height = panelHeight(panel, squeeze);
        out.push(placement(panel, height, x, y + rowHeight - height,
          input.anchorX, input.anchorY));
        x += panel.width + gap;
      }
      y += rowHeight + gap;
    }
  }
  // A mixed layout may overlap a shelf in y while remaining clear in x. Move
  // each complete side column to the nearest channel formed by the individual
  // shelf edges instead of reserving the shelf's full-height bounding box.
  for (const side of ['l', 'r'] as const) {
    const slots = new Set(groups[side].map((panel) => panel.slot));
    if (slots.size === 0) continue;
    const column = out.filter((panel) => slots.has(panel.slot));
    const others = out.filter((panel) => !slots.has(panel.slot));
    const firstX = Math.min(...column.map((panel) => panel.x));
    const lastRight = Math.max(...column.map((panel) => panel.x + panel.width));
    const columnWidth = lastRight - firstX;
    const firstY = Math.min(...column.map((panel) => panel.y));
    const lastBottom = Math.max(...column.map((panel) => panel.y + panel.height));
    const columnHeight = lastBottom - firstY;
    const validAt = (candidateX: number, candidateY: number) => {
      if (candidateX < minX - 0.5 || candidateX + columnWidth > maxX + 0.5) return false;
      if (candidateY < minY - 0.5 || candidateY + columnHeight > maxY + 0.5) return false;
      return column.every((panel) => {
        const moved = {
          ...boxOf(panel),
          x: panel.x + candidateX - firstX,
          y: panel.y + candidateY - firstY,
        };
        return reserved.every((claim) => intersectionArea(moved, rectBox(claim)) === 0)
          && others.every((other) => intersectionArea(
            expanded(moved, gap / 2), expanded(boxOf(other), gap / 2),
          ) <= 0.25);
      });
    };
    if (validAt(firstX, firstY)) continue;
    const xCandidates = [firstX, minX, maxX - columnWidth, ...others.flatMap((panel) => [
      panel.x - gap - columnWidth, panel.x + panel.width + gap,
    ])].filter((value, index, values) => values.indexOf(value) === index);
    const yCandidates = [firstY, minY, maxY - columnHeight, ...others.flatMap((panel) => [
      panel.y - gap - columnHeight, panel.y + panel.height + gap,
    ])].filter((value, index, values) => values.indexOf(value) === index);
    const positions = xCandidates.flatMap((x) => yCandidates.map((y) => ({ x, y })))
      .sort((a, b) => Math.hypot(a.x + columnWidth / 2 - input.anchorX,
        a.y + columnHeight / 2 - input.anchorY)
        - Math.hypot(b.x + columnWidth / 2 - input.anchorX,
          b.y + columnHeight / 2 - input.anchorY));
    const next = positions.find(({ x, y }) => validAt(x, y));
    if (next) {
      for (const panel of column) {
        panel.x += next.x - firstX;
        panel.y += next.y - firstY;
      }
    }
  }
  out.sort((a, b) => CONSTELLATION_ORDER.indexOf(a.slot) - CONSTELLATION_ORDER.indexOf(b.slot));
  return { template: templateForSides(sides), placements: out };
}

function expandCandidate(
  input: ConstellationInput,
  panels: readonly ConstellationPanel[],
  direction: 'left' | 'right',
  squeeze: number,
  gap: number,
): Candidate | null {
  const near = panels.filter((panel) => panel.slot === 'specimen' || panel.slot === 'reader');
  const far = panels.filter((panel) => panel.slot === 'analysis' || panel.slot === 'trace');
  if (near.length === 0 || far.length === 0) return null;
  const keepout = input.stageWidth >= 1280
    ? constellationKeepoutPx(input.stageWidth, input.stageHeight)
    : CONSTELLATION_RETICLE_PX / 2 + CONSTELLATION_ROUTE_CLEARANCE_PX;
  const reserved = input.reserved ?? [];
  const columns = [near, far];
  const widths = columns.map((column) => Math.max(...column.map((panel) => panel.width)));
  const nearX = direction === 'right'
    ? Math.max(input.anchorX + keepout + gap, ...reserved.map((box) => box.right + gap))
    : Math.min(input.anchorX - keepout - gap - widths[0],
      ...reserved.map((box) => box.left - gap - widths[0]));
  const farX = direction === 'right'
    ? nearX + widths[0] + gap : nearX - gap - widths[1];
  if (Math.min(nearX, farX) < input.edge - 0.5
    || Math.max(nearX + widths[0], farX + widths[1]) > input.stageWidth - input.edge + 0.5) return null;
  const out: ConstellationPlacement[] = [];
  for (let columnIndex = 0; columnIndex < columns.length; columnIndex += 1) {
    const column = columns[columnIndex];
    const heights = column.map((panel) => panelHeight(panel, squeeze));
    const total = heights.reduce((sum, value) => sum + value, 0) + gap * (column.length - 1);
    if (total > input.stageHeight - input.safeTop - input.edge + 0.5) return null;
    let y = clamp(input.anchorY - total / 2, input.safeTop, input.stageHeight - input.edge - total);
    for (let index = 0; index < column.length; index += 1) {
      const panel = column[index];
      const x = (columnIndex === 0 ? nearX : farX)
        + (direction === 'left' ? widths[columnIndex] - panel.width : 0);
      out.push(placement(panel, heights[index], x, y, input.anchorX, input.anchorY));
      y += heights[index] + gap;
    }
  }
  out.sort((a, b) => CONSTELLATION_ORDER.indexOf(a.slot) - CONSTELLATION_ORDER.indexOf(b.slot));
  return { template: direction === 'right' ? 'expand-right' : 'expand-left', placements: out };
}

function shelfRows(panels: readonly ConstellationPanel[], maxWidth: number,
  gap: number): ConstellationPanel[][] | null {
  const rows: ConstellationPanel[][] = [];
  const widths: number[] = [];
  for (const panel of [...panels].sort((a, b) => b.width - a.width)) {
    if (panel.width > maxWidth + 0.5) return null;
    const rowIndex = rows.findIndex((_row, index) => (
      widths[index] + gap + panel.width <= maxWidth + 0.5
    ));
    if (rowIndex < 0) {
      rows.push([panel]); widths.push(panel.width);
    } else {
      rows[rowIndex].push(panel); widths[rowIndex] += gap + panel.width;
    }
  }
  return rows;
}

/** True fold candidate: each half may contain several horizontal shelves.
 * This covers the 820px portrait trace case where no side column fits and no
 * single top/bottom row can hold all four instruments. */
function foldCandidate(input: ConstellationInput, panels: readonly ConstellationPanel[],
  topSlots: ReadonlySet<ConstellationSlot>, squeeze: number, gap: number): Candidate | null {
  const top = panels.filter((panel) => topSlots.has(panel.slot));
  const bottom = panels.filter((panel) => !topSlots.has(panel.slot));
  if (top.length === 0 || bottom.length === 0) return null;
  const maxWidth = input.stageWidth - input.edge * 2;
  const topRows = shelfRows(top, maxWidth, gap);
  const bottomRows = shelfRows(bottom, maxWidth, gap);
  if (!topRows || !bottomRows) return null;
  const heightOf = (rows: readonly ConstellationPanel[][]): number => rows.reduce(
    (sum, row) => sum + Math.max(...row.map((panel) => panelHeight(panel, squeeze))),
    gap * Math.max(0, rows.length - 1),
  );
  const topHeight = heightOf(topRows); const bottomHeight = heightOf(bottomRows);
  const core = (input.stageWidth >= 1280
    ? constellationKeepoutPx(input.stageWidth, input.stageHeight)
    : CONSTELLATION_RETICLE_PX / 2 + CONSTELLATION_ROUTE_CLEARANCE_PX) + gap;
  const reserved = input.reserved ?? [];
  const topEdge = Math.min(input.anchorY - core, ...reserved.map((box) => box.top - gap));
  const bottomEdge = Math.max(input.anchorY + core, ...reserved.map((box) => box.bottom + gap));
  if (topEdge - topHeight < input.safeTop - 0.5
    || bottomEdge + bottomHeight > input.stageHeight - input.edge + 0.5) return null;
  const out: ConstellationPlacement[] = [];
  const placeRows = (rows: readonly ConstellationPanel[][], above: boolean) => {
    let y = above ? topEdge : bottomEdge;
    const orderedRows = above ? [...rows].reverse() : rows;
    for (const row of orderedRows) {
      const rowHeight = Math.max(...row.map((panel) => panelHeight(panel, squeeze)));
      if (above) y -= rowHeight;
      const rowWidth = row.reduce((sum, panel) => sum + panel.width, 0) + gap * (row.length - 1);
      let x = clamp(input.anchorX - rowWidth / 2, input.edge, input.stageWidth - input.edge - rowWidth);
      for (const panel of row) {
        const height = panelHeight(panel, squeeze);
        const py = above ? y + rowHeight - height : y;
        out.push(placement(panel, height, x, py, input.anchorX, input.anchorY));
        x += panel.width + gap;
      }
      if (above) y -= gap; else y += rowHeight + gap;
    }
  };
  placeRows(topRows, true); placeRows(bottomRows, false);
  out.sort((a, b) => CONSTELLATION_ORDER.indexOf(a.slot) - CONSTELLATION_ORDER.indexOf(b.slot));
  return {
    template: top.length >= bottom.length ? 'fold-above' : 'fold-below',
    placements: out,
  };
}

function pairwiseClear(placements: readonly ConstellationPlacement[], gap: number): boolean {
  for (let i = 0; i < placements.length; i += 1) {
    for (let j = i + 1; j < placements.length; j += 1) {
      if (intersectionArea(expanded(boxOf(placements[i]), gap / 2),
        expanded(boxOf(placements[j]), gap / 2)) > 0.25) return false;
    }
  }
  return true;
}

function subtractBox(source: Box, cut: Box): Box[] {
  const ix = Math.max(source.x, cut.x); const iy = Math.max(source.y, cut.y);
  const ir = Math.min(source.x + source.width, cut.x + cut.width);
  const ib = Math.min(source.y + source.height, cut.y + cut.height);
  if (ir <= ix || ib <= iy) return [source];
  const result: Box[] = [];
  if (iy > source.y) result.push({ x: source.x, y: source.y, width: source.width, height: iy - source.y });
  if (ib < source.y + source.height) result.push({ x: source.x, y: ib, width: source.width, height: source.y + source.height - ib });
  if (ix > source.x) result.push({ x: source.x, y: iy, width: ix - source.x, height: ib - iy });
  if (ir < source.x + source.width) result.push({ x: ir, y: iy, width: source.x + source.width - ir, height: ib - iy });
  return result.filter((box) => box.width > 0.5 && box.height > 0.5);
}

/** HUD portions covered by an inspection panel are dimmed and are no longer a
 * visible obstacle. Subtraction keeps tablet target edges reachable and keeps
 * the SVG mask from cutting the final approach. */
function visibleHudBoxes(obstacles: readonly HudOcclusionRect[], panels: readonly Box[]): Box[] {
  let result = obstacles.map(rectBox);
  for (const panel of panels) result = result.flatMap((box) => subtractBox(box, panel));
  return result;
}
const pointInside = (point: ConstellationPoint, box: Box): boolean => (
  point.x > box.x + 0.1 && point.x < box.x + box.width - 0.1
  && point.y > box.y + 0.1 && point.y < box.y + box.height - 0.1
);
function segmentClear(a: ConstellationPoint, b: ConstellationPoint, obstacles: readonly Box[]): boolean {
  if (Math.abs(a.x - b.x) < 0.01) {
    const lo = Math.min(a.y, b.y); const hi = Math.max(a.y, b.y);
    return obstacles.every((box) => a.x <= box.x + 0.1 || a.x >= box.x + box.width - 0.1
      || hi <= box.y + 0.1 || lo >= box.y + box.height - 0.1);
  }
  if (Math.abs(a.y - b.y) < 0.01) {
    const lo = Math.min(a.x, b.x); const hi = Math.max(a.x, b.x);
    return obstacles.every((box) => a.y <= box.y + 0.1 || a.y >= box.y + box.height - 0.1
      || hi <= box.x + 0.1 || lo >= box.x + box.width - 0.1);
  }
  return false;
}
function simplify(points: ConstellationPoint[]): ConstellationPoint[] {
  for (let index = points.length - 2; index > 0; index -= 1) {
    const a = points[index - 1]; const b = points[index]; const c = points[index + 1];
    if ((Math.abs(a.x - b.x) < 0.01 && Math.abs(b.x - c.x) < 0.01)
      || (Math.abs(a.y - b.y) < 0.01 && Math.abs(b.y - c.y) < 0.01)) points.splice(index, 1);
  }
  return points;
}

function fastOrthogonalRoute(start: ConstellationPoint, end: ConstellationPoint,
  obstacles: readonly Box[]): ConstellationPoint[] | null {
  const horizontalFirst = [start, { x: end.x, y: start.y }, end];
  if (segmentClear(horizontalFirst[0], horizontalFirst[1], obstacles)
    && segmentClear(horizontalFirst[1], horizontalFirst[2], obstacles)) {
    return simplify(horizontalFirst);
  }
  const verticalFirst = [start, { x: start.x, y: end.y }, end];
  if (segmentClear(verticalFirst[0], verticalFirst[1], obstacles)
    && segmentClear(verticalFirst[1], verticalFirst[2], obstacles)) {
    return simplify(verticalFirst);
  }
  return null;
}

interface OrthogonalGuide { xIndex: number; yIndex: number; verticalFirst: boolean }
const orthogonalGuideCache = new Map<string, OrthogonalGuide>();

function* orthogonalRouteSteps(start: ConstellationPoint, end: ConstellationPoint,
  obstacles: readonly Box[], bounds: Box,
  guideKey?: string): Generator<void, ConstellationPoint[] | null> {
  if (obstacles.some((box) => pointInside(start, box) || pointInside(end, box))) return null;
  const fast = fastOrthogonalRoute(start, end, obstacles);
  if (fast) return fast;
  const xs = new Set<number>([start.x, end.x, bounds.x, bounds.x + bounds.width]);
  const ys = new Set<number>([start.y, end.y, bounds.y, bounds.y + bounds.height]);
  obstacles.forEach((box) => {
    xs.add(clamp(box.x, bounds.x, bounds.x + bounds.width));
    xs.add(clamp(box.x + box.width, bounds.x, bounds.x + bounds.width));
    ys.add(clamp(box.y, bounds.y, bounds.y + bounds.height));
    ys.add(clamp(box.y + box.height, bounds.y, bounds.y + bounds.height));
  });
  const xValues = [...xs]; const yValues = [...ys];
  let best: ConstellationPoint[] | null = null;
  let least = Number.POSITIVE_INFINITY;
  let bestOrdinal = Number.POSITIVE_INFINITY;
  let bestGuide: OrthogonalGuide | null = null;
  const consider = (
    points: ConstellationPoint[], ordinal: number,
    guide: OrthogonalGuide | null = null,
  ) => {
    const simplified = simplify(points);
    if (simplified.length - 2 > CONSTELLATION_ROUTE_MAX_BENDS) return;
    const cost = routeLength(simplified);
    if (cost > least || (cost === least && ordinal >= bestOrdinal)) return;
    for (let index = 1; index < simplified.length; index += 1) {
      if (!segmentClear(simplified[index - 1], simplified[index], obstacles)) return;
    }
    least = cost; bestOrdinal = ordinal; bestGuide = guide; best = simplified;
  };
  let directOrdinal = 0;
  let quantum = 0;
  for (const x of xValues) {
    const a = { x, y: start.y };
    if (!segmentClear(start, a, obstacles)) continue;
    consider([start, a, { x, y: end.y }, end], directOrdinal);
    directOrdinal += 1;
    if ((quantum += 1) % 8 === 0) yield;
  }
  for (const y of yValues) {
    const a = { x: start.x, y };
    if (!segmentClear(start, a, obstacles)) continue;
    consider([start, a, { x: end.x, y }, end], directOrdinal);
    directOrdinal += 1;
    if ((quantum += 1) % 8 === 0) yield;
  }
  if (best) return best;
  const clearHorizontalStarts = new Map(xValues.map((x) => {
    const first = { x, y: start.y };
    return [x, segmentClear(start, first, obstacles)] as const;
  }));
  const clearVerticalStarts = new Map(yValues.map((y) => {
    const first = { x: start.x, y };
    return [y, segmentClear(start, first, obstacles)] as const;
  }));
  const clearLeg = (a: ConstellationPoint, b: ConstellationPoint) => (
    (Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01)
    || segmentClear(a, b, obstacles)
  );
  const considerGrid = (xIndex: number, yIndex: number, verticalFirst: boolean) => {
    const x = xValues[xIndex]; const y = yValues[yIndex];
    if (x === undefined || y === undefined) return;
    const ordinal = (xIndex * yValues.length + yIndex) * 2
      + (verticalFirst ? 1 : 0);
    const middle = { x, y };
    if (!verticalFirst) {
      const h1 = { x, y: start.y }; const beforeEnd = { x: end.x, y };
      if (clearHorizontalStarts.get(x)
        && clearLeg(h1, middle) && clearLeg(middle, beforeEnd)
        && clearLeg(beforeEnd, end)) {
        consider([start, h1, middle, beforeEnd, end], ordinal, {
          xIndex, yIndex, verticalFirst,
        });
      }
      return;
    }
    const v1 = { x: start.x, y }; const beforeEnd = { x, y: end.y };
    if (clearVerticalStarts.get(y)
      && clearLeg(v1, middle) && clearLeg(middle, beforeEnd)
      && clearLeg(beforeEnd, end)) {
      consider([start, v1, middle, beforeEnd, end], ordinal, {
        xIndex, yIndex, verticalFirst,
      });
    }
  };
  const cachedGuide = guideKey ? orthogonalGuideCache.get(guideKey) : undefined;
  if (cachedGuide) considerGrid(
    cachedGuide.xIndex, cachedGuide.yIndex, cachedGuide.verticalFirst,
  );
  for (let xIndex = 0; xIndex < xValues.length; xIndex += 1) {
    const x = xValues[xIndex];
    for (let yIndex = 0; yIndex < yValues.length; yIndex += 1) {
    const y = yValues[yIndex];
    // Manhattan distance is a strict lower bound on routeLength. Once a
    // direct route exists, reject most x×y grid points before allocating and
    // simplifying their five-point paths or walking obstacles segment-wise.
    const lowerBound = Math.abs(x - start.x) + Math.abs(y - start.y)
      + Math.abs(end.x - x) + Math.abs(end.y - y);
    if (lowerBound <= least) {
      considerGrid(xIndex, yIndex, false);
      considerGrid(xIndex, yIndex, true);
    }
    if ((quantum += 1) % 8 === 0) yield;
    }
  }
  if (guideKey && bestGuide) {
    if (!orthogonalGuideCache.has(guideKey) && orthogonalGuideCache.size >= 512) {
      const oldest = orthogonalGuideCache.keys().next().value as string | undefined;
      if (oldest !== undefined) orthogonalGuideCache.delete(oldest);
    }
    orthogonalGuideCache.set(guideKey, bestGuide);
  }
  return best;
}

function routeEndpoints(panel: Box, ax: number, ay: number): ConstellationPoint[] {
  const xs = [0.25, 0.5, 0.75].map((part) => panel.x + panel.width * part);
  const ys = [0.25, 0.5, 0.75].map((part) => panel.y + panel.height * part);
  return [
    ...ys.map((y) => ({ x: panel.x, y })),
    ...ys.map((y) => ({ x: panel.x + panel.width, y })),
    ...xs.map((x) => ({ x, y: panel.y })),
    ...xs.map((x) => ({ x, y: panel.y + panel.height })),
  ].sort((a, b) => Math.hypot(a.x - ax, a.y - ay) - Math.hypot(b.x - ax, b.y - ay));
}
function routeLength(points: readonly ConstellationPoint[]): number {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += Math.abs(points[index].x - points[index - 1].x)
      + Math.abs(points[index].y - points[index - 1].y);
  }
  return total + Math.max(0, points.length - 2) * 18;
}
function labelForRoute(points: readonly ConstellationPoint[], width: number, height: number,
  obstacles: readonly Box[], bounds: Box): ConstellationLabelPlacement {
  for (let index = points.length - 1; index > 0; index -= 1) {
    const a = points[index - 1]; const b = points[index];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const needed = Math.abs(a.x - b.x) < 0.01 ? height + 16 : width + 16;
    if (length < needed) continue;
    const x = (a.x + b.x) / 2; const y = (a.y + b.y) / 2;
    const box = { x: x - width / 2, y: y - height / 2, width, height };
    if (box.x < bounds.x || box.y < bounds.y
      || box.x + width > bounds.x + bounds.width || box.y + height > bounds.y + bounds.height) continue;
    if (obstacles.some((obstacle) => intersectionArea(box, obstacle) > 0.1)) continue;
    return { x, y, width, height, inPanel: false };
  }
  return { x: 0, y: 0, width, height, inPanel: true };
}

function segments(points: readonly ConstellationPoint[]): Array<[ConstellationPoint, ConstellationPoint]> {
  const result: Array<[ConstellationPoint, ConstellationPoint]> = [];
  for (let index = 1; index < points.length; index += 1) result.push([points[index - 1], points[index]]);
  return result;
}
function segmentsTouch(a: [ConstellationPoint, ConstellationPoint],
  b: [ConstellationPoint, ConstellationPoint]): boolean {
  const [a1, a2] = a; const [b1, b2] = b;
  const av = Math.abs(a1.x - a2.x) < 0.01; const bv = Math.abs(b1.x - b2.x) < 0.01;
  if (av && bv) {
    return Math.abs(a1.x - b1.x) < 0.01
      && Math.max(Math.min(a1.y, a2.y), Math.min(b1.y, b2.y))
        <= Math.min(Math.max(a1.y, a2.y), Math.max(b1.y, b2.y)) + 0.01;
  }
  if (!av && !bv) {
    return Math.abs(a1.y - b1.y) < 0.01
      && Math.max(Math.min(a1.x, a2.x), Math.min(b1.x, b2.x))
        <= Math.min(Math.max(a1.x, a2.x), Math.max(b1.x, b2.x)) + 0.01;
  }
  const vertical = av ? a : b; const horizontal = av ? b : a;
  return vertical[0].x >= Math.min(horizontal[0].x, horizontal[1].x) - 0.01
    && vertical[0].x <= Math.max(horizontal[0].x, horizontal[1].x) + 0.01
    && horizontal[0].y >= Math.min(vertical[0].y, vertical[1].y) - 0.01
    && horizontal[0].y <= Math.max(vertical[0].y, vertical[1].y) + 0.01;
}

function routeOutsideReticle(points: readonly ConstellationPoint[], ax: number, ay: number,
  radius: number): Array<[ConstellationPoint, ConstellationPoint]> {
  const result: Array<[ConstellationPoint, ConstellationPoint]> = [];
  for (const [a, b] of segments(points)) {
    const vertical = Math.abs(a.x - b.x) < 0.01;
    if (vertical && a.x >= ax - radius && a.x <= ax + radius) {
      const lo = Math.min(a.y, b.y); const hi = Math.max(a.y, b.y);
      if (lo < ay - radius) result.push([{ x: a.x, y: lo }, { x: a.x, y: Math.min(hi, ay - radius) }]);
      if (hi > ay + radius) result.push([{ x: a.x, y: Math.max(lo, ay + radius) }, { x: a.x, y: hi }]);
    } else if (!vertical && a.y >= ay - radius && a.y <= ay + radius) {
      const lo = Math.min(a.x, b.x); const hi = Math.max(a.x, b.x);
      if (lo < ax - radius) result.push([{ x: lo, y: a.y }, { x: Math.min(hi, ax - radius), y: a.y }]);
      if (hi > ax + radius) result.push([{ x: Math.max(lo, ax + radius), y: a.y }, { x: hi, y: a.y }]);
    } else result.push([a, b]);
  }
  return result.filter(([a, b]) => Math.hypot(a.x - b.x, a.y - b.y) > 0.5);
}

/**
 * The fallback leader, for a plate the canonical router could not reach.
 *
 * It is the straight line the constellation drew before it had a router: out
 * of the reticle ring, into the nearest point of the plate. Where the two
 * orthogonal legs of that line clear the plate's own body and the reticle box
 * it is snapped to them, so it reads as a leader and not as a stray diagonal;
 * otherwise the straight line stands. It claims no outlet and is no obstacle
 * to the plates routed after it: a fallback that could veto its neighbours
 * would spread one failure across the whole constellation. Its tag falls back
 * into the plate's own head, because a line with a bend this arbitrary has no
 * leg long enough to carry one honestly.
 */
function degradedRoute(input: ConstellationInput, target: Box,
  labelWidth: number, labelHeight: number): ConstellationRoute {
  const line = constellationLeader(
    input.anchorX, input.anchorY, CONSTELLATION_RETICLE_PX, target,
  );
  const start = { x: line.x1, y: line.y1 };
  const end = { x: line.x2, y: line.y2 };
  const label = { x: 0, y: 0, width: labelWidth, height: labelHeight, inPanel: true };
  const blockers: Box[] = [target, {
    x: input.anchorX - CONSTELLATION_RETICLE_PX / 2,
    y: input.anchorY - CONSTELLATION_RETICLE_PX / 2,
    width: CONSTELLATION_RETICLE_PX,
    height: CONSTELLATION_RETICLE_PX,
  }];
  for (const bend of [{ x: end.x, y: start.y }, { x: start.x, y: end.y }]) {
    const points = simplify([start, bend, end]);
    let clear = true;
    for (let index = 1; index < points.length && clear; index += 1) {
      clear = segmentClear(points[index - 1], points[index], blockers);
    }
    if (clear) return { points, label, degraded: true };
  }
  return { points: [start, end], label, degraded: true };
}

interface RoutedOrder {
  masks: HudOcclusionRect[];
  /** How many plates in this attempt got the fallback leader. */
  degraded: number;
  routes: Array<ConstellationRoute | undefined>;
}

function* addRoutesInOrderSteps(input: ConstellationInput,
  placements: ConstellationPlacement[],
  order: readonly number[]): Generator<void, RoutedOrder> {
  const panelBoxes = placements.map(boxOf);
  const hud = visibleHudBoxes(input.obstacles ?? [], panelBoxes);
  const reserved = (input.reserved ?? []).map(rectBox);
  const bounds: Box = {
    x: input.edge + CONSTELLATION_ROUTE_CLEARANCE_PX,
    y: input.safeTop + CONSTELLATION_ROUTE_CLEARANCE_PX,
    width: input.stageWidth - input.edge * 2 - CONSTELLATION_ROUTE_CLEARANCE_PX * 2,
    height: input.stageHeight - input.safeTop - input.edge - CONSTELLATION_ROUTE_CLEARANCE_PX * 2,
  };
  const masks = [...panelBoxes, ...reserved, ...hud].map(rectOf);
  const reticle: Box = {
    x: input.anchorX - CONSTELLATION_RETICLE_PX / 2,
    y: input.anchorY - CONSTELLATION_RETICLE_PX / 2,
    width: CONSTELLATION_RETICLE_PX,
    height: CONSTELLATION_RETICLE_PX,
  };
  const placedLabels: Box[] = [];
  const priorRoutes: ConstellationPoint[][] = [];
  const usedOutlets = new Set<string>();
  let degraded = 0;
  for (const placementIndex of order) {
    const placement = placements[placementIndex];
    const panel = input.panels.find((candidate) => candidate.slot === placement.slot);
    const target = panelBoxes[placementIndex];
    const priorRouteSegments = priorRoutes.flatMap((route) =>
      routeOutsideReticle(route, input.anchorX, input.anchorY, CONSTELLATION_RETICLE_PX / 2));
    const priorRouteBoxes = priorRouteSegments.map(([a, b]) => ({
      x: Math.min(a.x, b.x) - 4,
      y: Math.min(a.y, b.y) - 4,
      width: Math.max(8, Math.abs(a.x - b.x) + 8),
      height: Math.max(8, Math.abs(a.y - b.y) + 8),
    }));
    const obstacles = [
      ...panelBoxes.filter((box) => box !== target), ...reserved, ...hud, ...placedLabels,
      ...priorRouteBoxes,
    ].map((box) => expanded(box, CONSTELLATION_ROUTE_CLEARANCE_PX));
    // The target itself stays at its exact boundary: the route may land on an
    // edge but may never enter the body and emerge at another edge.
    obstacles.push(target);
    obstacles.push(reticle);
    const radius = CONSTELLATION_RETICLE_PX / 2 + 6;
    const outlet = 18;
    const starts: ConstellationPoint[] = [
      { x: input.anchorX + radius, y: input.anchorY - outlet },
      { x: input.anchorX + radius, y: input.anchorY + outlet },
      { x: input.anchorX - radius, y: input.anchorY - outlet },
      { x: input.anchorX - radius, y: input.anchorY + outlet },
      { x: input.anchorX - outlet, y: input.anchorY + radius },
      { x: input.anchorX + outlet, y: input.anchorY + radius },
      { x: input.anchorX - outlet, y: input.anchorY - radius },
      { x: input.anchorX + outlet, y: input.anchorY - radius },
    ].filter((point) => !usedOutlets.has(`${point.x},${point.y}`))
      .sort((a, b) => Math.hypot(a.x - (target.x + target.width / 2), a.y - (target.y + target.height / 2))
        - Math.hypot(b.x - (target.x + target.width / 2), b.y - (target.y + target.height / 2)));
    const endpoints = routeEndpoints(target, input.anchorX, input.anchorY);
    let best: ConstellationPoint[] | null = null;
    let bestLength = Number.POSITIVE_INFINITY;
    let bestOrdinal = Number.POSITIVE_INFINITY;
    const crossesPrior = (route: readonly ConstellationPoint[]) => {
      const outside = routeOutsideReticle(route, input.anchorX, input.anchorY,
        CONSTELLATION_RETICLE_PX / 2);
      return outside.some((segment) => priorRouteSegments.some((other) => segmentsTouch(segment, other)));
    };
    const pairs: Array<{
      start: ConstellationPoint;
      end: ConstellationPoint;
      lowerBound: number;
      ordinal: number;
    }> = [];
    let ordinal = 0;
    for (const start of starts) for (const end of endpoints) {
      const aligned = Math.abs(start.x - end.x) < 0.01
        || Math.abs(start.y - end.y) < 0.01;
      pairs.push({
        start,
        end,
        lowerBound: Math.abs(start.x - end.x) + Math.abs(start.y - end.y)
          + (aligned ? 0 : 18),
        ordinal,
      });
      ordinal += 1;
    }
    pairs.sort((a, b) => a.lowerBound - b.lowerBound || a.ordinal - b.ordinal);
    let fastQuantum = 0;
    for (const pair of pairs) {
      if (pair.lowerBound > bestLength) break;
      constellationWorkStats.fastRouteAttempts += 1;
      const route = fastOrthogonalRoute(pair.start, pair.end, obstacles);
      if (route && !crossesPrior(route)) {
        const length = routeLength(route);
        if (length < bestLength || (length === bestLength && pair.ordinal < bestOrdinal)) {
          best = route;
          bestLength = length;
          bestOrdinal = pair.ordinal;
        }
      }
      if ((fastQuantum += 1) % 8 === 0) yield;
    }
    if (!best) {
      routeSearch:
      for (let startIndex = 0; startIndex < starts.length; startIndex += 1) {
        const start = starts[startIndex];
        for (let endIndex = 0; endIndex < endpoints.length; endIndex += 1) {
        const end = endpoints[endIndex];
        constellationWorkStats.searchedRouteAttempts += 1;
        const route = yield* orthogonalRouteSteps(
          start, end, obstacles, bounds,
          `${placement.slot}:${startIndex}:${endIndex}:${obstacles.length}`,
        );
        if (route && !crossesPrior(route)) { best = route; break routeSearch; }
        }
      }
    }
    if (!best) {
      placement.route = degradedRoute(
        input, target, panel?.labelWidth ?? 70, panel?.labelHeight ?? 20,
      );
      degraded += 1;
      yield;
      continue;
    }
    usedOutlets.add(`${best[0].x},${best[0].y}`);
    const priorLabelRouteBoxes = priorRoutes.flatMap((route) => segments(route).map(([a, b]) => ({
      x: Math.min(a.x, b.x) - 3,
      y: Math.min(a.y, b.y) - 3,
      width: Math.max(6, Math.abs(a.x - b.x) + 6),
      height: Math.max(6, Math.abs(a.y - b.y) + 6),
    })));
    const label = labelForRoute(best, panel?.labelWidth ?? 70, panel?.labelHeight ?? 20,
      [...panelBoxes, ...reserved, ...hud, reticle, ...placedLabels, ...priorLabelRouteBoxes], bounds);
    placement.route = { points: best, label, degraded: false };
    if (!label.inPanel) placedLabels.push({
      x: label.x - label.width / 2, y: label.y - label.height / 2,
      width: label.width, height: label.height,
    });
    priorRoutes.push(best);
    yield;
  }
  return { masks, degraded, routes: placements.map((panel) => panel.route) };
}

const routeOrderCache: Array<readonly (readonly number[])[] | undefined> = [];

function routeOrders(count: number): readonly (readonly number[])[] {
  const cached = routeOrderCache[count];
  if (cached) return cached;
  const canonical = Array.from({ length: count }, (_value, index) => index);
  const result: number[][] = [];
  const visit = (prefix: number[], remaining: number[]) => {
    if (remaining.length === 0) { result.push(prefix); return; }
    for (let index = 0; index < remaining.length; index += 1) {
      visit([...prefix, remaining[index]], [
        ...remaining.slice(0, index), ...remaining.slice(index + 1),
      ]);
    }
  };
  visit([], canonical);
  if (count === 3) {
    const preferred = [[0, 2, 1], [0, 1, 2], [1, 2, 0], [2, 0, 1]];
    const preferredKeys = new Set(preferred.map((order) => order.join(',')));
    const ordered = [...preferred, ...result.filter((order) => !preferredKeys.has(order.join(',')))];
    routeOrderCache[count] = ordered;
    return ordered;
  }
  if (count !== 4) {
    routeOrderCache[count] = result;
    return result;
  }
  const preferred = [
    [0, 2, 3, 1], [0, 2, 1, 3], [0, 1, 3, 2], [0, 1, 2, 3],
    [0, 3, 1, 2], [0, 3, 2, 1], [1, 0, 3, 2], [1, 2, 3, 0],
    [2, 0, 3, 1], [2, 3, 0, 1], [2, 3, 1, 0], [3, 0, 1, 2], [3, 0, 2, 1],
  ];
  const preferredKeys = new Set(preferred.map((order) => order.join(',')));
  const ordered = [...preferred, ...result.filter((order) => !preferredKeys.has(order.join(',')))];
  routeOrderCache[count] = ordered;
  return ordered;
}

/** Every plate leaves here with a route. The first order that reaches all of
 * them cleanly wins, exactly as before; if none does, the order that needed
 * the fewest fallbacks wins, and its routes are written back. */
function* addRoutesSteps(input: ConstellationInput,
  placements: ConstellationPlacement[]): Generator<void, RoutedOrder> {
  let best: RoutedOrder | null = null;
  for (const order of routeOrders(placements.length)) {
    constellationWorkStats.routeOrders += 1;
    for (const panel of placements) panel.route = undefined;
    const attempt = yield* addRoutesInOrderSteps(input, placements, order);
    if (attempt.degraded === 0) return attempt;
    if (!best || attempt.degraded < best.degraded) best = attempt;
    // A route order is the smallest useful canonical unit: its later panels
    // depend on the exact paths chosen for its earlier panels. Yield between
    // orders so the Canvas path can budget the search without changing that
    // dependency or the winning order.
    yield;
  }
  const winner = best ?? { masks: [], degraded: 0, routes: [] };
  for (let index = 0; index < placements.length; index += 1) {
    placements[index].route = winner.routes[index];
  }
  return winner;
}

function hardValid(input: ConstellationInput, placements: readonly ConstellationPlacement[], gap: number): boolean {
  if (placements.length !== input.panels.length || !pairwiseClear(placements, gap)) return false;
  const core = CONSTELLATION_RETICLE_PX / 2 + CONSTELLATION_ROUTE_CLEARANCE_PX;
  const reserved = (input.reserved ?? []).map(rectBox);
  return placements.every((panel) => {
    const box = boxOf(panel);
    return box.x >= input.edge - 0.5 && box.y >= input.safeTop - 0.5
      && box.x + box.width <= input.stageWidth - input.edge + 0.5
      && box.y + box.height <= input.stageHeight - input.edge + 0.5
      && nearestDistance(box, input.anchorX, input.anchorY) >= core - 0.5
      && reserved.every((claim) => intersectionArea(box, claim) === 0);
  });
}

export function constellationLayoutHardValid(
  input: ConstellationInput,
  layout: ConstellationLayout,
): boolean {
  return hardValid(input, layout.placements, CONSTELLATION_MIN_GAP_PX);
}

/**
 * Re-anchor an already published layout without running the route search.
 *
 * This is a presentation-only result: callers must continue the canonical
 * cursor and replace it when that cursor lands.  Every translated route is
 * checked against the current hard geometry, HUD/chip claims, reticle and the
 * other routes before it is returned.  A failed check deliberately yields
 * `null`, so stale geometry is never made visible merely to avoid a blank
 * frame.
 */
export function revalidateConstellationLayoutForAnchor(
  input: ConstellationInput,
  layout: ConstellationLayout,
  previousAnchorX: number,
  previousAnchorY: number,
): ConstellationLayout | null {
  // A layout is presentation-compatible only with the same instruments. The
  // caller may deliberately reuse it across a viewport/HUD change, because
  // every current bound and obstacle is checked below, but equal panel counts
  // must never let (for example) a removed reader masquerade as a new trace.
  if (input.panels.length !== layout.placements.length) return null;
  for (const panel of input.panels) {
    const prior = layout.placements.find((placement) => placement.slot === panel.slot);
    if (!prior || Math.abs(prior.width - panel.width) > 0.1
      || prior.height > panel.height + 0.1) return null;
  }
  if (!hardValid(input, layout.placements, CONSTELLATION_MIN_GAP_PX)) return null;
  const dx = input.anchorX - previousAnchorX;
  const dy = input.anchorY - previousAnchorY;
  const panelBoxes = layout.placements.map(boxOf);
  const hud = visibleHudBoxes(input.obstacles ?? [], panelBoxes);
  const reserved = (input.reserved ?? []).map(rectBox);
  const bounds: Box = {
    x: input.edge + CONSTELLATION_ROUTE_CLEARANCE_PX,
    y: input.safeTop + CONSTELLATION_ROUTE_CLEARANCE_PX,
    width: input.stageWidth - input.edge * 2 - CONSTELLATION_ROUTE_CLEARANCE_PX * 2,
    height: input.stageHeight - input.safeTop - input.edge - CONSTELLATION_ROUTE_CLEARANCE_PX * 2,
  };
  const reticle: Box = {
    x: input.anchorX - CONSTELLATION_RETICLE_PX / 2,
    y: input.anchorY - CONSTELLATION_RETICLE_PX / 2,
    width: CONSTELLATION_RETICLE_PX,
    height: CONSTELLATION_RETICLE_PX,
  };
  const translated: ConstellationPlacement[] = [];
  const outsideRoutes: Array<Array<[ConstellationPoint, ConstellationPoint]>> = [];
  for (let placementIndex = 0; placementIndex < layout.placements.length; placementIndex += 1) {
    const current = layout.placements[placementIndex];
    const old = current.route?.points;
    if (!old || old.length < 2) return null;
    // A fallback leader is a pure function of the anchor and the plate, so it
    // is rebuilt rather than translated: its start is on the reticle ring at
    // whatever angle the plate lies, which no outlet check would accept.
    if (current.route?.degraded) {
      const panel = input.panels.find((candidate) => candidate.slot === current.slot);
      translated.push({
        ...current,
        route: degradedRoute(
          input, panelBoxes[placementIndex],
          panel?.labelWidth ?? current.route.label.width,
          panel?.labelHeight ?? current.route.label.height,
        ),
      });
      outsideRoutes.push([]);
      continue;
    }
    let translatedPoints = old.map((point) => ({ ...point }));
    translatedPoints[0].x += dx;
    translatedPoints[0].y += dy;
    const firstWasVertical = Math.abs(old[0].x - old[1].x) < 0.01;
    if (firstWasVertical) translatedPoints[1].x = translatedPoints[0].x;
    else translatedPoints[1].y = translatedPoints[0].y;
    translatedPoints = simplify(translatedPoints);
    const target = panelBoxes[placementIndex];
    const radius = CONSTELLATION_RETICLE_PX / 2 + 6;
    const outlet = 18;
    const validStarts = [
      { x: input.anchorX + radius, y: input.anchorY - outlet },
      { x: input.anchorX + radius, y: input.anchorY + outlet },
      { x: input.anchorX - radius, y: input.anchorY - outlet },
      { x: input.anchorX - radius, y: input.anchorY + outlet },
      { x: input.anchorX - outlet, y: input.anchorY + radius },
      { x: input.anchorX + outlet, y: input.anchorY + radius },
      { x: input.anchorX - outlet, y: input.anchorY - radius },
      { x: input.anchorX + outlet, y: input.anchorY - radius },
    ];
    const obstacles = [
      ...panelBoxes.filter((_box, index) => index !== placementIndex),
      ...reserved,
      ...hud,
    ].map((box) => expanded(box, CONSTELLATION_ROUTE_CLEARANCE_PX));
    obstacles.push(target, reticle);
    // Canonical routing leaves a twelve-pixel channel around prior segments
    // (four-pixel stroke box plus the eight-pixel route clearance).
    obstacles.push(...outsideRoutes.flatMap((route) => route.map(([a, b]) => ({
      x: Math.min(a.x, b.x) - 12,
      y: Math.min(a.y, b.y) - 12,
      width: Math.abs(a.x - b.x) + 24,
      height: Math.abs(a.y - b.y) + 24,
    }))));
    const candidateValid = (candidate: ConstellationPoint[]) => {
      if (candidate.length < 2 || candidate.length - 2 > CONSTELLATION_ROUTE_MAX_BENDS) return false;
      if (!validStarts.some((start) => Math.hypot(
        start.x - candidate[0].x, start.y - candidate[0].y,
      ) < 0.1)) return false;
      const candidateEnd = candidate[candidate.length - 1];
      const endsOnTarget = (
        (Math.abs(candidateEnd.x - target.x) < 0.1
          || Math.abs(candidateEnd.x - target.x - target.width) < 0.1)
          && candidateEnd.y >= target.y - 0.1
          && candidateEnd.y <= target.y + target.height + 0.1
      ) || (
        (Math.abs(candidateEnd.y - target.y) < 0.1
          || Math.abs(candidateEnd.y - target.y - target.height) < 0.1)
          && candidateEnd.x >= target.x - 0.1
          && candidateEnd.x <= target.x + target.width + 0.1
      );
      if (!endsOnTarget) return false;
      if (candidate.some((point) => point.x < bounds.x - 0.1 || point.y < bounds.y - 0.1
        || point.x > bounds.x + bounds.width + 0.1
        || point.y > bounds.y + bounds.height + 0.1)) return false;
      for (let pointIndex = 1; pointIndex < candidate.length; pointIndex += 1) {
        if (!segmentClear(candidate[pointIndex - 1], candidate[pointIndex], obstacles)) return false;
      }
      return true;
    };
    let points = candidateValid(translatedPoints) ? translatedPoints : null;
    // If translating only the moving leg is obstructed, reconnect one of the
    // eight current outlets to a later point on the already proven route. The
    // fast two-bend router is bounded by this tiny set; this is still a
    // provisional answer and never changes the canonical winning route.
    for (const start of validStarts) {
      for (let join = 1; points === null && join < old.length; join += 1) {
        const prefix = fastOrthogonalRoute(start, old[join], obstacles);
        if (!prefix) continue;
        const candidate = simplify([
          ...prefix.slice(0, -1),
          ...old.slice(join).map((point) => ({ ...point })),
        ]);
        if (candidateValid(candidate)) points = candidate;
      }
      if (points) break;
    }

    // The old polyline can be entirely on the wrong side after a discontinuous
    // camera jump. A final bounded fast pass tries the canonical outlet and
    // panel-edge sets without entering the exhaustive orthogonal grid search.
    if (points === null) {
      const endpoints = routeEndpoints(target, input.anchorX, input.anchorY);
      fastSearch:
      for (const start of validStarts) {
        for (const endpoint of endpoints) {
          const candidate = fastOrthogonalRoute(start, endpoint, obstacles);
          if (candidate && candidateValid(candidate)) {
            points = candidate;
            break fastSearch;
          }
        }
      }
    }
    if (!points) return null;
    const outside = routeOutsideReticle(
      points, input.anchorX, input.anchorY, CONSTELLATION_RETICLE_PX / 2,
    );
    outsideRoutes.push(outside);
    translated.push({
      ...current,
      route: {
        points,
        label: { ...current.route!.label },
        degraded: false,
      },
    });
  }

  const allRouteBoxes = outsideRoutes.flatMap((route) => route.map(([a, b]) => ({
    x: Math.min(a.x, b.x) - 3,
    y: Math.min(a.y, b.y) - 3,
    width: Math.max(6, Math.abs(a.x - b.x) + 6),
    height: Math.max(6, Math.abs(a.y - b.y) + 6),
  })));
  const placedLabels: Box[] = [];
  for (const current of translated) {
    // A fallback leader's tag already sits in its plate's head, and its own
    // route was rebuilt above; there is nothing here to re-place.
    if (current.route?.degraded) continue;
    const panel = input.panels.find((candidate) => candidate.slot === current.slot);
    const ownRouteBoxes = routeOutsideReticle(
      current.route?.points ?? [], input.anchorX, input.anchorY, CONSTELLATION_RETICLE_PX / 2,
    ).map(([a, b]) => ({
      x: Math.min(a.x, b.x) - 3, y: Math.min(a.y, b.y) - 3,
      width: Math.max(6, Math.abs(a.x - b.x) + 6),
      height: Math.max(6, Math.abs(a.y - b.y) + 6),
    }));
    const otherRoutes = allRouteBoxes.filter((box) => !ownRouteBoxes.some((own) =>
      box.x === own.x && box.y === own.y && box.width === own.width && box.height === own.height));
    const label = labelForRoute(
      current.route?.points ?? [], panel?.labelWidth ?? 70, panel?.labelHeight ?? 20,
      [...panelBoxes, ...reserved, ...hud, reticle, ...placedLabels, ...otherRoutes], bounds,
    );
    if (current.route) {
      current.route = { points: current.route.points, label, degraded: false };
    }
    if (!label.inPanel) placedLabels.push({
      x: label.x - label.width / 2, y: label.y - label.height / 2,
      width: label.width, height: label.height,
    });
  }
  return {
    ...layout,
    placements: translated,
    masks: [...panelBoxes, ...reserved, ...hud].map(rectOf),
  };
}
function scoreCandidate(input: ConstellationInput, candidate: Candidate): number {
  let score = candidate.template === input.lock?.template ? -CONSTELLATION_HOLD_MARGIN_PX : 0;
  const hud = (input.obstacles ?? []).map(rectBox);
  for (const panel of candidate.placements) {
    score += Math.abs(panel.height - (input.panels.find((p) => p.slot === panel.slot)?.height ?? panel.height)) * 4;
    score += Math.hypot(panel.x + panel.width / 2 - input.anchorX,
      panel.y + panel.height / 2 - input.anchorY) * 0.08;
    for (const obstacle of hud) score += intersectionArea(boxOf(panel), obstacle) / 80;
  }
  const preference: Record<ConstellationTemplate, number> = {
    'split-left': 0, 'split-right': 1, 'expand-right': 2, 'expand-left': 3,
    'fold-above': 4, 'fold-below': 5, distributed: 6,
  };
  return score + preference[candidate.template] * 0.01;
}

/** Stable top-12 selection equivalent to `filter().sort(score).slice(0, 12)`.
 * Scoring each candidate once avoids thousands of repeated score/map walks on
 * a cold four-panel solve while retaining generation order as the tie-break. */
function bestCandidates(
  input: ConstellationInput,
  candidates: readonly Candidate[],
  gap: number,
): Candidate[] {
  const best: Array<{ candidate: Candidate; score: number; ordinal: number }> = [];
  for (let ordinal = 0; ordinal < candidates.length; ordinal += 1) {
    const candidate = candidates[ordinal];
    constellationWorkStats.candidatesValidated += 1;
    if (!hardValid(input, candidate.placements, gap)) continue;
    const entry = { candidate, score: scoreCandidate(input, candidate), ordinal };
    let at = best.length;
    while (at > 0) {
      const prior = best[at - 1];
      if (prior.score < entry.score
        || (prior.score === entry.score && prior.ordinal < entry.ordinal)) break;
      at -= 1;
    }
    if (at >= 12) continue;
    best.splice(at, 0, entry);
    if (best.length > 12) best.pop();
  }
  return best.map(({ candidate }) => candidate);
}
function geometryKey(input: ConstellationInput, panels: readonly ConstellationPanel[]): string {
  const part = (value: number) => Math.round(value * 2);
  let key = `${part(input.stageWidth)},${part(input.stageHeight)},${part(input.safeTop)},${part(input.edge)}`;
  for (const panel of panels) key += `|${panel.slot}:${part(panel.width)}:${part(panel.height)}`;
  for (const rect of input.obstacles ?? []) {
    key += `|${part(rect.left)},${part(rect.top)},${part(rect.right)},${part(rect.bottom)}`;
  }
  for (const rect of input.reserved ?? []) {
    key += `|r${part(rect.right - rect.left)},${part(rect.bottom - rect.top)}`;
  }
  return key;
}
function* lockedLayoutSteps(
  input: ConstellationInput,
  withRoutes: boolean,
): Generator<void, ConstellationLayout | null> {
  const panels = orderedPanels(input.panels);
  const key = geometryKey(input, panels);
  const lock = input.lock;
  if (lock?.template !== null && lock !== undefined
    && Math.hypot(input.anchorX - lock.anchorX, input.anchorY - lock.anchorY) <= 160) {
    const previousSlots = Object.keys(lock.placements).filter((slot) => lock.placements[slot]);
    const removedOnly = panels.every((panel) => lock.placements[panel.slot] !== undefined)
      && panels.length < previousSlots.length;
    if (lock.geometryKey === key || removedOnly) {
      const sameGeometry = lock.geometryKey === key;
      const placements = panels.map((panel) => {
        const held = lock.placements[panel.slot] as ConstellationPlacement;
        const next = placement(panel, sameGeometry ? held.height : panel.height, held.x, held.y,
          input.anchorX, input.anchorY);
        next.quadrant = held.quadrant;
        return next;
      });
      if (hardValid(input, placements, CONSTELLATION_MIN_GAP_PX)) {
        const routed = withRoutes ? yield* addRoutesSteps(input, placements) : null;
        constellationWorkStats.lockedReuses += 1;
        return {
          status: placements.some((panel) => panel.capped) ? 'compressed' : 'normal',
          template: lock.template,
          placements,
          masks: routed?.masks ?? [],
          leaders: (routed?.degraded ?? 0) > 0 ? 'degraded' : 'clean',
        };
      }
    }
  }
  return null;
}

function* solveLayoutSteps(
  input: ConstellationInput,
  withRoutes: boolean,
): Generator<void, ConstellationLayout> {
  const panels = orderedPanels(input.panels);
  if (panels.length === 0) {
    return { status: 'normal', template: null, placements: [], masks: [], leaders: 'clean' };
  }
  const held = yield* lockedLayoutSteps(input, withRoutes);
  if (held) return held;
  const key = geometryKey(input, panels);
  constellationWorkStats.fullSolves += 1;
  let best: Candidate | null = null;
  let bestMasks: HudOcclusionRect[] = [];
  let bestDegraded = 0;
  // The best answer found so far that needed at least one fallback leader. It
  // is used only if no candidate anywhere routes cleanly, so a clean picture
  // is never traded for a tidier fallback.
  let fallback: {
    candidate: Candidate; masks: HudOcclusionRect[]; degraded: number;
    routes: Array<ConstellationRoute | undefined>;
  } | null = null;
  // Squeeze outer, gap inner. Compression is escalated only when NO candidate
  // at the current squeeze passes `hardValid` at either gap — never because a
  // leader could not be drawn, and never before the 16 px gap has been tried.
  for (const squeeze of [1, 0.76, 0.56, 0.4, 0.16]) {
    let seatedAtThisSqueeze = false;
    for (const gap of [CONSTELLATION_PREFERRED_GAP_PX, CONSTELLATION_MIN_GAP_PX]) {
      const candidates: Candidate[] = [];
      const right = expandCandidate(input, panels, 'right', squeeze, gap);
      const left = expandCandidate(input, panels, 'left', squeeze, gap);
      if (right) candidates.push(right);
      if (left) candidates.push(left);
      const count = 4 ** panels.length; const symbols = ['l', 'r', 't', 'b'] as const;
      for (let encoded = 0; encoded < count; encoded += 1) {
        let value = encoded; const sides: Array<'l' | 'r' | 't' | 'b'> = [];
        for (let index = 0; index < panels.length; index += 1) {
          sides.push(symbols[value % 4]); value = Math.floor(value / 4);
        }
        const candidate = distributedCandidate(input, panels, sides, squeeze, gap);
        if (candidate) candidates.push(candidate);
        if ((encoded & 31) === 31) yield;
      }
      const foldCount = 2 ** panels.length;
      for (let encoded = 1; encoded < foldCount - 1; encoded += 1) {
        const topSlots = new Set<ConstellationSlot>();
        panels.forEach((panel, index) => {
          if ((encoded & (1 << index)) !== 0) topSlots.add(panel.slot);
        });
        const candidate = foldCandidate(input, panels, topSlots, squeeze, gap);
        if (candidate) candidates.push(candidate);
        if ((encoded & 31) === 31) yield;
      }
      constellationWorkStats.candidatesBuilt += candidates.length;
      const feasible = bestCandidates(input, candidates, gap);
      if (feasible.length > 0) seatedAtThisSqueeze = true;
      for (const candidate of feasible) {
        if (!withRoutes) { best = candidate; bestMasks = []; break; }
        const routed = yield* addRoutesSteps(input, candidate.placements);
        // `feasible` is already sorted by its deterministic geometry score.
        // Take the first candidate whose internally shortest bounded routes are
        // all valid; trying lower-ranked geometry after that only adds latency
        // to a pointer interaction.
        if (routed.degraded === 0) {
          best = candidate; bestMasks = routed.masks; bestDegraded = 0;
          break;
        }
        if (!fallback || routed.degraded < fallback.degraded) {
          fallback = {
            candidate, masks: routed.masks, degraded: routed.degraded, routes: routed.routes,
          };
        }
      }
      if (best) break;
    }
    if (best || seatedAtThisSqueeze) break;
  }
  if (!best && fallback) {
    // Nothing routed cleanly anywhere. The seats are still real, so the
    // constellation stands, with the fewest fallback leaders it could manage.
    best = fallback.candidate;
    bestMasks = fallback.masks;
    bestDegraded = fallback.degraded;
    for (let index = 0; index < best.placements.length; index += 1) {
      best.placements[index].route = fallback.routes[index];
    }
  }
  if (!best) {
    return { status: 'unavailable', template: null, placements: [], masks: [], leaders: 'clean' };
  }
  const result: ConstellationLayout = {
    status: best.placements.some((panel) => panel.capped) ? 'compressed' : 'normal',
    template: best.template, placements: best.placements, masks: bestMasks,
    leaders: bestDegraded > 0 ? 'degraded' : 'clean',
  };
  if (input.lock) {
    input.lock.template = best.template; input.lock.geometryKey = key;
    input.lock.anchorX = input.anchorX; input.lock.anchorY = input.anchorY;
    for (const slot of Object.keys(input.lock.placements)) delete input.lock.placements[slot];
    for (const panel of best.placements) {
      input.lock.placements[panel.slot] = { ...panel, route: undefined };
      input.lock.quadrant[panel.slot] = panel.quadrant;
    }
  }
  return result;
}

function solveLayout(input: ConstellationInput, withRoutes: boolean): ConstellationLayout {
  const steps = solveLayoutSteps(input, withRoutes);
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}

/** Canonical layout as resumable work. Draining this iterator is byte-for-byte
 * equivalent to `constellationLayout`; Canvas advances it under the shared
 * frame ledger while tests and non-frame callers retain the synchronous API. */
export function constellationLayoutCursor(
  input: ConstellationInput,
): Generator<void, ConstellationLayout> {
  return solveLayoutSteps(input, true);
}

/** Only the held-placement path. A caller may drain this at a presentation
 * deadline because failure returns `null` rather than falling through into the
 * expensive candidate solve. */
export function constellationLockedLayoutCursor(
  input: ConstellationInput,
): Generator<void, ConstellationLayout | null> {
  return lockedLayoutSteps(input, true);
}
export function constellationLayout(input: ConstellationInput): ConstellationLayout {
  return solveLayout(input, true);
}
export function constellationPlacement(input: ConstellationInput): ConstellationPlacement[] {
  return solveLayout(input, false).placements;
}
export function constellationLeader(anchorX: number, anchorY: number, reticlePx: number,
  panel: { x: number; y: number; width: number; height: number }):
  { x1: number; y1: number; x2: number; y2: number } {
  const x2 = clamp(anchorX, panel.x, panel.x + panel.width);
  const y2 = clamp(anchorY, panel.y, panel.y + panel.height);
  const dx = x2 - anchorX; const dy = y2 - anchorY; const length = Math.hypot(dx, dy);
  if (length < 1) return { x1: anchorX, y1: anchorY, x2, y2 };
  const start = reticlePx / 2 + 6;
  return { x1: anchorX + dx / length * start, y1: anchorY + dy / length * start, x2, y2 };
}
