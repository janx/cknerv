// Where the three instruments stand when they stand apart.
//
// The cell card was one grid holding CELL SCAN, SCAN·01 and SCAN·02 in three
// tracks, and every complaint about it came from the same mechanism: side by
// side, ONE column decides the height and the others are left with a
// remainder. The remainder was a transparent hole enclosed by plates (21 % of
// the bare card's box), or bordered emptiness under the reader's foot line
// (58 % of that plate on a one-row payload), or — on an 11" iPad in landscape
// Safari, where the docked row squeezed to 236 px — a 280 px specimen square
// overflowing its row into the reader plate by 35.5 measured pixels.
//
// Unwelded there is no shared height to fight over: each instrument is exactly
// as tall as what it has to say. What replaces the grid is this — a pure
// placement over the stage, run once per frame, that puts each instrument in
// its own quadrant around the cell and keeps all of them off the cell itself.
//
// Pure and scalar on purpose. It runs inside the frame loop sixty times a
// second, so it may not allocate per call beyond the one result object the
// caller owns and re-uses; and it lives here rather than in the overlay so a
// test can drive every stage this instrument has ever been read on without a
// browser.

import type { HudOcclusionRect } from '../components/hudOcclusion';

/** The four rooms around a cell. A quadrant is a DIAGONAL: the instrument's
 *  corner nearest the cell is the corner that sits on the keep-out ring, which
 *  is what makes the leader a straight run from the reticle to that corner and
 *  nothing else. */
export type ConstellationQuadrant = 'tl' | 'tr' | 'bl' | 'br';

/** The instruments, in the order they are placed. The order is a priority and
 *  not a preference: the widest and tallest surface picks its room first,
 *  because a register that has to settle for what three smaller panels left it
 *  is the one that ends up half off the stage. */
export type ConstellationSlot = 'analysis' | 'specimen' | 'reader' | 'trace';

export const CONSTELLATION_ORDER: readonly ConstellationSlot[] = [
  'analysis',
  'specimen',
  'reader',
  'trace',
];

export interface ConstellationPanel {
  slot: ConstellationSlot;
  width: number;
  height: number;
}

export interface ConstellationPlacement {
  slot: ConstellationSlot;
  quadrant: ConstellationQuadrant;
  x: number;
  y: number;
  width: number;
  /** What the panel may actually stand in. Equal to its asked height wherever
   *  the band allows; capped at the band where it does not, and the panel
   *  scrolls inside the difference. Only the register ever reaches this. */
  height: number;
  /** The band could not hold this panel's content — it is showing part of
   *  itself and owes the reader a scrollbar. */
  capped: boolean;
}

/**
 * The clear field the cell keeps, in px of radius.
 *
 * LAW 1, and the one guarantee the welded card could not make: the thing being
 * inspected is never covered by the thing inspecting it. A card is placed
 * BESIDE its cell and is routinely wider than the gap to it, so at 1920 the
 * 728 px dossier stands on the neighbourhood its own tether comes from.
 *
 * Scaled off the SHORT side of the stage, because the disc is a hole in the
 * composition and a hole is judged against the smaller dimension: 120 px is a
 * seventh of a 1080 desktop and would be a fifth of an iPad's 688 band. The
 * floor is the reticle plus a finger — a disc smaller than the mark inside it
 * is not a clear field, it is a halo.
 */
export function constellationKeepoutPx(
  stageWidth: number,
  stageHeight: number,
): number {
  const short = Math.min(
    Number.isFinite(stageWidth) ? stageWidth : 0,
    Number.isFinite(stageHeight) ? stageHeight : 0,
  );
  return Math.round(Math.max(92, Math.min(120, short * 0.16)));
}

/**
 * The reticle's own box.
 *
 * A fixed measure rather than the cell's screen footprint × some factor, which
 * is what a viewfinder normally is. Two reasons, and the second is the one
 * that decides it: a staged cell is a point sprite whose footprint is one to
 * three pixels at the overview pose (measured: the pick disc reads +1 px in x
 * and 0 in y), so a proportional reticle would be a proportional nothing; and
 * the mark is also the thing a finger aims at when it wants the cell back from
 * under a panel, so its floor is `TOUCH_TARGET_MIN_PX` and its resting size is
 * comfortably over it.
 */
export const CONSTELLATION_RETICLE_PX = 92;

/** What a second instrument in the same quadrant costs.
 *
 * Not a bar. Three panels want three rooms and a cell in a corner of the stage
 * has two, so exclusivity is a rule that cannot always be kept — and a rule
 * that cannot be kept becomes an overlap, which is the one thing this layout
 * exists to prevent. Sharing a quadrant is what the iPad landscape case does:
 * the specimen and the reader stack on the right of the cell, staggered by the
 * separation step so they still read as two instruments. */
const CONSTELLATION_SHARE_PX = 90;

/** What must stand between two instruments before they read as two. The user's
 *  direction was 「三个panel相互分开，不挨着」 — apart, NOT touching — and a
 *  seam of a few pixels is exactly what "touching" looks like: the eye reads
 *  two plates with a hairline between them as one plate with a rule in it. */
export const CONSTELLATION_MIN_GAP_PX = 16;

/** The least an instrument may be shrunk to before shrinking stops being an
 *  answer. A head, a rule and a few rows: under this a capped panel is a
 *  scrollbar with a title on it, and moving it somewhere else — even somewhere
 *  worse — is the better trade. */
export const CONSTELLATION_MIN_HEIGHT_PX = 168;

/** …and what it may be shrunk to when it is SHARING a room, where the
 *  alternative is not a shorter instrument but two in the same place. */
export const CONSTELLATION_STACK_MIN_PX = 120;

/** Which instruments may give height back.
 *
 *  The register and the reader scroll, so a short stage takes it out of them.
 *  The specimen may not: it is a window at a fixed scale, and a capped window
 *  is a clipped braid — the one thing 280 px of width is there to prevent. The
 *  trace is a ledger and scrolls like the rest. */
function cappable(slot: ConstellationSlot): boolean {
  return slot !== 'specimen';
}

/** How far past the keep-out ring an instrument's near corner is set, before
 *  anything is clamped or settled. Enough that the leader is a line and not a
 *  join. */
const CONSTELLATION_LEADER_PX = 26;

/** Quadrant preferences, as a penalty rather than a rule.
 *
 * The specimen wants to be up and the reader wants to be down — that is the
 * order the card is read in, and it is the order the scan walks: what the thing
 * is, then what it holds. But it is a preference and not a law, because a cell
 * near the top edge of the stage has no upper quadrant to give, and an
 * instrument placed by preference into a room it does not fit is worse than one
 * placed by room into a room it does. So it is worth a quarter of a fit.
 */
function quadrantBias(slot: ConstellationSlot, quadrant: ConstellationQuadrant): number {
  const top = quadrant === 'tl' || quadrant === 'tr';
  if (slot === 'specimen') return top ? 0 : 0.25;
  if (slot === 'reader') return top ? 0.25 : 0;
  return 0;
}

interface Box { x: number; y: number; width: number; height: number }

function intersectionArea(a: Box, b: Box): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

function obstacleArea(box: Box, obstacle: HudOcclusionRect): number {
  return intersectionArea(box, {
    x: obstacle.left,
    y: obstacle.top,
    width: obstacle.right - obstacle.left,
    height: obstacle.bottom - obstacle.top,
  });
}

/** How far the box reaches INTO the cell's clear field, in px. Zero is the
 *  only acceptable answer and the scorer treats it as such; the number matters
 *  only for choosing the least bad room when every room is bad. */
function keepoutBite(box: Box, cx: number, cy: number, radius: number): number {
  const nx = Math.max(box.x, Math.min(cx, box.x + box.width));
  const ny = Math.max(box.y, Math.min(cy, box.y + box.height));
  const distance = Math.hypot(nx - cx, ny - cy);
  return distance >= radius ? 0 : radius - distance;
}

function clamp(value: number, low: number, high: number): number {
  return high < low ? low : Math.max(low, Math.min(high, value));
}

export interface ConstellationLock {
  /** The quadrant each instrument is standing in, held across frames.
   *
   *  ⚠️ MUTATED IN PLACE by the solver, exactly as `SceneInspectorPlacementLock`
   *  is: this runs in the frame loop and a fresh object per frame is a fresh
   *  allocation sixty times a second. The caller owns it and clears it when the
   *  selection changes — a different cell may open anywhere on screen and owes
   *  nobody the rooms the last one chose.
   */
  quadrant: { [slot: string]: ConstellationQuadrant | undefined };
}

export function createConstellationLock(): ConstellationLock {
  return { quadrant: {} };
}

export function resetConstellationLock(lock: ConstellationLock): void {
  for (const key of Object.keys(lock.quadrant)) lock.quadrant[key] = undefined;
}

/**
 * What a better room has to be worth before an instrument moves to it.
 *
 * The galaxy turns under the cell about half a pixel a frame, so every scored
 * quantity here drifts continuously and two quadrants' penalties cross
 * sooner or later. Without a margin the register changes corners mid-read,
 * which is the same failure `settleInspectorSide` exists for one rank up.
 * Measured against the drift: 96 px of penalty is about two minutes of turn at
 * the overview pose, and no ordinary re-frame gets near it.
 */
export const CONSTELLATION_HOLD_MARGIN_PX = 96;

export interface ConstellationInput {
  anchorX: number;
  anchorY: number;
  stageWidth: number;
  stageHeight: number;
  /** The instruments to place, in any order — `CONSTELLATION_ORDER` decides
   *  who picks first, not the caller's array. */
  panels: readonly ConstellationPanel[];
  obstacles?: readonly HudOcclusionRect[];
  /** Boxes that are not rails and not instruments, and that nothing may stand
   *  on: the name chip under the reticle is the whole population today.
   *
   *  ⚠️ NOT AN OBSTACLE. A rail is worth `area ÷ 900` — a 131 × 25 crossing
   *  costs 3.6 px of regret, which never moved anything, and the chip carrying
   *  the Cell's own id spent the first live run printed across the reader's
   *  header. A reserved box is separated from exactly as another instrument is,
   *  and scored as heavily. */
  reserved?: readonly HudOcclusionRect[];
  /** The HUD's own two reservations, handed in rather than imported so the
   *  derive stays free of the component that owns them. */
  safeTop: number;
  edge: number;
  /** Held quadrants, mutated in place. Omit for a one-shot answer. */
  lock?: ConstellationLock;
}

interface SettleContext {
  anchorX: number;
  anchorY: number;
  keepout: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  placed: readonly ConstellationPlacement[];
  reserved: readonly Box[];
}

/**
 * Bring one box to rest: inside the stage, outside the cell's field, off every
 * instrument already standing.
 *
 * A fixpoint rather than one pass of each, because the three constraints move
 * each other — a box pushed off a neighbour lands outside the stage, the clamp
 * puts it back, and back is onto the neighbour. Six rounds is well past what
 * any stage this instrument runs on needs (measured: two, worst case, at
 * 820 × 1103 with three panels), and the loop exits the moment nothing moved.
 *
 * ⭐ THE KEEP-OUT IS CLEARED ON ONE AXIS AT A TIME, by the WHOLE radius. A box
 * placed on the diagonal clears the disc by `reach × √2` and needs none of
 * this; a box that has since been clamped or folded is somewhere the diagonal
 * never put it, and the only escape that is true regardless of where the other
 * axis ended up is to take the box fully past the disc in one of them.
 */
function settleBox(
  x: number,
  y: number,
  width: number,
  height: number,
  quadrant: ConstellationQuadrant,
  ctx: SettleContext,
): { x: number; y: number } {
  const left = quadrant === 'tl' || quadrant === 'bl';
  const above = quadrant === 'tl' || quadrant === 'tr';
  let px = x;
  let py = y;
  for (let round = 0; round < 6; round += 1) {
    let moved = false;
    const cx = clamp(px, ctx.minX, ctx.maxX - width);
    const cy = clamp(py, ctx.minY, ctx.maxY - height);
    if (cx !== px || cy !== py) { px = cx; py = cy; moved = true; }

    const box: Box = { x: px, y: py, width, height };
    if (keepoutBite(box, ctx.anchorX, ctx.anchorY, ctx.keepout) > 0.5) {
      const wantX = left
        ? ctx.anchorX - ctx.keepout - width
        : ctx.anchorX + ctx.keepout;
      const wantY = above
        ? ctx.anchorY - ctx.keepout - height
        : ctx.anchorY + ctx.keepout;
      const fitsX = wantX >= ctx.minX && wantX + width <= ctx.maxX;
      const fitsY = wantY >= ctx.minY && wantY + height <= ctx.maxY;
      const costX = Math.abs(wantX - px);
      const costY = Math.abs(wantY - py);
      const takeX = fitsX && (!fitsY || costX <= costY);
      if (takeX) { px = wantX; moved = true; } else if (fitsY) { py = wantY; moved = true; } else if (costX <= costY) { px = wantX; moved = true; } else { py = wantY; moved = true; }
    }

    for (const other of [...ctx.placed, ...ctx.reserved]) {
      const gap = CONSTELLATION_MIN_GAP_PX;
      const oL = other.x - gap;
      const oT = other.y - gap;
      const oR = other.x + other.width + gap;
      const oB = other.y + other.height + gap;
      if (px >= oR || px + width <= oL || py >= oB || py + height <= oT) continue;
      // ⭐ FOUR WAYS OUT, TRIED IN THE PANEL'S OWN DIRECTION FIRST.
      //
      // The cheapest escape is the wrong rule and it deadlocks: a reader in the
      // upper-right of a cell at (400, 300) is cheapest to push LEFT, which
      // puts the cell inside its box, which the keep-out then pushes right
      // again — 26,730 px² of overlap after six rounds of that. A panel leans
      // away from the cell by construction, so the first thing to try is
      // further that way, and the last thing is back across the cell.
      const outward: Array<[number, number]> = left
        ? [[oL - width, py], [px, above ? oT - height : oB], [px, above ? oB : oT - height], [oR, py]]
        : [[oR, py], [px, above ? oT - height : oB], [px, above ? oB : oT - height], [oL - width, py]];
      const holds = (nx: number, ny: number) => nx >= ctx.minX && nx + width <= ctx.maxX
        && ny >= ctx.minY && ny + height <= ctx.maxY;
      let pick: [number, number] | null = null;
      for (const option of outward) {
        if (!holds(option[0], option[1])) continue;
        if (keepoutBite(
          { x: option[0], y: option[1], width, height },
          ctx.anchorX, ctx.anchorY, ctx.keepout,
        ) > 0.5) continue;
        pick = option;
        break;
      }
      if (!pick) for (const option of outward) if (holds(option[0], option[1])) { pick = option; break; }
      if (!pick) pick = outward[0];
      px = pick[0]; py = pick[1]; moved = true;
    }
    if (!moved) break;
  }
  // ⚠️ THE STAGE HAS THE LAST WORD, AND IT HAS TO BE SAID HERE.
  // Both escapes above may deliberately step outside the stage — the keep-out
  // push takes the cheaper violation when neither axis fits, the separation
  // takes the cheapest option when none of the four holds — and each relies on
  // the NEXT round's clamp to bring it back. On the last round there is no next
  // round, and a 440 px register beside a cell at x=410 on an 820 px stage came
  // out at x=−150: half off the screen, which is worse than any overlap it was
  // escaping.
  let fx = clamp(px, ctx.minX, ctx.maxX - width);
  let fy = clamp(py, ctx.minY, ctx.maxY - height);

  // …and that clamp can put the cell back inside the box, which is the one
  // thing this layout exists to prevent. Measured: a reader clamped to the
  // stage edge on an iPad came to rest exactly `reach` from the cell — the
  // signature of a box that now SPANS the anchor in one axis, so its nearest
  // point is the anchor's own row. Try each axis's full-radius escape against
  // the clamp and keep whichever bites least; the scorer sees what is left and
  // can still prefer another room.
  if (keepoutBite({ x: fx, y: fy, width, height }, ctx.anchorX, ctx.anchorY, ctx.keepout) > 0.5) {
    const wantX = clamp(
      left ? ctx.anchorX - ctx.keepout - width : ctx.anchorX + ctx.keepout,
      ctx.minX,
      ctx.maxX - width,
    );
    const wantY = clamp(
      above ? ctx.anchorY - ctx.keepout - height : ctx.anchorY + ctx.keepout,
      ctx.minY,
      ctx.maxY - height,
    );
    let bestBite = keepoutBite({ x: fx, y: fy, width, height }, ctx.anchorX, ctx.anchorY, ctx.keepout);
    for (const candidate of [{ x: wantX, y: fy }, { x: fx, y: wantY }]) {
      const bite = keepoutBite(
        { x: candidate.x, y: candidate.y, width, height },
        ctx.anchorX, ctx.anchorY, ctx.keepout,
      );
      if (bite < bestBite - 0.01) { bestBite = bite; fx = candidate.x; fy = candidate.y; }
    }
  }
  return { x: fx, y: fy };
}

/**
 * One pass of the walk, at one squeeze.
 *
 * Greedy over `CONSTELLATION_ORDER`: each instrument scores all
 * four quadrants, takes the best one still free, and becomes an obstacle for
 * everyone after it. Greedy rather than exhaustive because there are at most
 * four panels and four rooms and it runs in a frame — and because a STABLE
 * answer matters more than an optimal one, which is what the lock is for.
 *
 * The score is a penalty, and every term is in the same currency (pixels of
 * regret) so they can be added:
 *
 *   · reaching into the cell's clear field, ×6 — Law 1, and the reason the
 *     whole layout exists
 *   · standing on another instrument, area ÷ 260 — what a fold could not undo
 *   · standing on a HUD rail, area ÷ 900 — allowed, and the rails dim for it,
 *     but it is the last thing to spend
 *   · not fitting the room at all, the shortfall in either axis
 *   · the slot's own bias, in fractions of the panel's own measure
 */
function walkOnce(
  input: ConstellationInput,
  squeeze: number,
  lock: ConstellationLock | undefined,
): ConstellationPlacement[] {
  const {
    anchorX, anchorY, stageWidth, stageHeight, panels, safeTop, edge,
  } = input;
  const obstacles = input.obstacles ?? [];
  const reserved: Box[] = (input.reserved ?? []).map((claim) => ({
    x: claim.left,
    y: claim.top,
    width: claim.right - claim.left,
    height: claim.bottom - claim.top,
  }));
  const keepout = constellationKeepoutPx(stageWidth, stageHeight);
  const reach = keepout * Math.SQRT1_2 + CONSTELLATION_LEADER_PX;
  const band = Math.max(0, stageHeight - safeTop - edge);
  const placed: ConstellationPlacement[] = [];
  const occupancy: { [quadrant: string]: number } = {};
  /** Height already spoken for in each room, so the second instrument in one
   *  asks for what is LEFT rather than for the whole of it. Without this the
   *  two share a quadrant, both cap to the full room, and stand on each other
   *  — 70,278 px² of it, measured live on an 11" iPad in landscape. */
  const spent: { [quadrant: string]: number } = {};

  const ordered = CONSTELLATION_ORDER
    .map((slot) => panels.find((panel) => panel.slot === slot))
    .filter((panel): panel is ConstellationPanel => panel !== undefined);

  for (const panel of ordered) {
    const width = panel.width;
    const mayCap = cappable(panel.slot);
    const ctx: SettleContext = {
      anchorX,
      anchorY,
      keepout,
      minX: edge,
      minY: safeTop,
      maxX: stageWidth - edge,
      maxY: stageHeight - edge,
      placed,
      reserved,
    };
    let best: ConstellationPlacement | null = null;
    let bestPenalty = Number.POSITIVE_INFINITY;
    const held = lock?.quadrant[panel.slot];
    let heldPenalty = Number.POSITIVE_INFINITY;
    let heldPlacement: ConstellationPlacement | null = null;

    for (const quadrant of ['tl', 'tr', 'bl', 'br'] as const) {
      const left = quadrant === 'tl' || quadrant === 'bl';
      const above = quadrant === 'tl' || quadrant === 'tr';
      // ⚠️ THE ROOM IS MEASURED FROM THE FULL RADIUS, NOT FROM THE REACH.
      //
      // `reach` is the DIAGONAL seat — a corner set there clears the disc by
      // reach × √2. But a panel wider than either side of the cell gets clamped
      // horizontally until it spans the anchor, and then its nearest point is
      // the anchor's own row: a 440 px register beside a cell at x=410 on an
      // 820 px stage came to rest exactly `reach` from the cell, 9 px inside a
      // 120 px field, with no horizontal escape left to take. Sizing the room
      // by the radius is what lets the vertical clearance alone be enough.
      const roomX = left ? anchorX - keepout - edge : stageWidth - edge - anchorX - keepout;
      // ⭐ A ROOM THAT CLEARS SIDEWAYS MAY SPAN THE CELL'S ROW.
      //
      // A quadrant is a diagonal, and requiring both axes of it is stricter
      // than the field itself is: a panel entirely to the left of the disc
      // never touches it, whatever its height. Requiring both cost the register
      // half the screen — with a cell at 960 × 540 on a 1920 stage, the corner
      // rooms are 316 above and 406 below against a 962 px band, so a 660 px
      // dossier scrolled a third of itself away with the whole band free. The
      // BESIDE composition, which is what the old card did, recovered.
      const spans = roomX >= width;
      const roomY = (spans
        ? band
        : (above ? anchorY - keepout - safeTop : stageHeight - edge - anchorY - keepout))
        - (spent[quadrant] ?? 0);
      // A panel that may scroll asks its room for what it can have rather than
      // for what it wants. A panel that may not asks for what it is.
      const floor = (spent[quadrant] ?? 0) > 0
        ? CONSTELLATION_STACK_MIN_PX
        : CONSTELLATION_MIN_HEIGHT_PX;
      const asked = mayCap
        ? Math.max(floor, panel.height * squeeze)
        : panel.height;
      const height = mayCap
        ? Math.max(floor, Math.min(asked, band, Math.max(roomY, 0)))
        : Math.min(asked, band);
      const capped = height < panel.height - 0.5;
      const shortfall = Math.max(0, width - roomX) + Math.max(0, height - roomY);
      const seat = settleBox(
        left ? anchorX - reach - width : anchorX + reach,
        above ? anchorY - reach - height : anchorY + reach,
        width,
        height,
        quadrant,
        ctx,
      );
      const box: Box = { x: seat.x, y: seat.y, width, height };
      // ⭐ THE FIELD IS A PREFERENCE WITH A HARD CORE; A NEIGHBOUR IS NEVER
      // STOOD ON.
      //
      // These two were the wrong way round. A 120 px bite cost 720 and a
      // 68,544 px² overlap cost 264, so on a stage where every room was bad the
      // walk chose to put two instruments in the same place rather than let one
      // reach into the cell's field — and on an 820 px portrait stage with the
      // cell high, every room IS bad: 46 px above it, and 276 either side
      // against a 280 px specimen.
      //
      // The trade the design actually wants is the other one. The disc is a
      // clear FIELD, not the cell: a bite at its edge leaves the ~2 px sprite
      // and its reticle untouched, and a reader can still see what it selected.
      // Two instruments in one place is unreadable at any depth. So overlap is
      // weighed six times heavier, and the core — a bite deep enough to reach
      // the reticle itself — is what stays effectively absolute.
      const bite = keepoutBite(box, anchorX, anchorY, keepout);
      const core = Math.max(0, bite - (keepout - CONSTELLATION_RETICLE_PX / 2 - 8));
      // ⚠️ AND SHRINKING HAS TO COST, OR THE SCORER STOPS PREFERRING ROOM.
      //
      // `shortfall` is what a panel could not fit — and a capped panel always
      // fits, by construction, so capping silently made every quadrant look
      // perfect. Measured at 1920: a register that had 660 px of content and a
      // 962 px band chose an upper room with 400 and scrolled a third of
      // itself away, with a lower room standing empty. What was given up is
      // the thing to weigh.
      let penalty = shortfall
        + Math.max(0, panel.height - height) * 0.6
        + quadrantBias(panel.slot, quadrant) * (width + height) * 0.25
        + (occupancy[quadrant] ?? 0) * CONSTELLATION_SHARE_PX
        + bite * 6 + core * 120;
      for (const other of placed) penalty += intersectionArea(box, other) / 40;
      for (const claim of reserved) penalty += intersectionArea(box, claim) / 40;
      for (const obstacle of obstacles) penalty += obstacleArea(box, obstacle) / 900;
      const placement: ConstellationPlacement = {
        slot: panel.slot, quadrant, x: seat.x, y: seat.y, width, height, capped,
      };
      if (quadrant === held) { heldPenalty = penalty; heldPlacement = placement; }
      if (penalty < bestPenalty) { bestPenalty = penalty; best = placement; }
    }

    // Hysteresis: the room an instrument is already standing in keeps it until
    // a better one is better by a real margin.
    if (heldPlacement && bestPenalty > heldPenalty - CONSTELLATION_HOLD_MARGIN_PX) {
      best = heldPlacement;
    }
    if (!best) {
      // Unreachable: four quadrants are always scored. Belt and braces so the
      // walk cannot drop an instrument on the floor if that ever changes.
      const fallback = Math.min(panel.height, band);
      const seat = settleBox(anchorX + reach, anchorY + reach, width, fallback, 'br', ctx);
      best = {
        slot: panel.slot,
        quadrant: 'br',
        ...seat,
        width,
        height: fallback,
        capped: fallback < panel.height - 0.5,
      };
    }
    occupancy[best.quadrant] = (occupancy[best.quadrant] ?? 0) + 1;
    spent[best.quadrant] = (spent[best.quadrant] ?? 0)
      + best.height + CONSTELLATION_MIN_GAP_PX;
    placed.push(best);
  }
  return placed;
}

/**
 * The last word on the one thing that may never happen.
 *
 * Even after the retries a stage can leave a sliver — measured live on an
 * 820 px portrait stage, 588 px² of a specimen's right edge under a reader's
 * left, three and a half pixels of it. Every scoring term in the walk is a
 * preference, and a preference cannot promise. This can: each pair that still
 * overlaps is prised apart along the axis it overlaps LEAST, moving the later
 * instrument, clamped to the stage.
 *
 * It may cost a few pixels of the cell's field, and that is the trade this
 * layout has already made everywhere else — a bite at the edge of a 120 px disc
 * leaves the sprite and its reticle untouched; two instruments in one place are
 * unreadable at any depth.
 */
function prise(placed: ConstellationPlacement[], input: ConstellationInput): void {
  const minX = input.edge;
  const minY = input.safeTop;
  const maxX = input.stageWidth - input.edge;
  const maxY = input.stageHeight - input.edge;
  for (let round = 0; round < 4; round += 1) {
    let moved = false;
    for (let i = 0; i < placed.length; i += 1) {
      for (let j = i + 1; j < placed.length; j += 1) {
        const a = placed[i];
        const b = placed[j];
        const ox = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
        const oy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
        if (ox <= 0 || oy <= 0) continue;
        // ⚠️ ALL FOUR WAYS OUT, AND THE ONE THAT ACTUALLY WORKS.
        //
        // "Move along the axis it overlaps least, in the direction it already
        // leans" left 14 anchors of an 820 px stage still touching: a reader
        // already flush against the stage's left edge is asked to move further
        // left, the clamp refuses, and the pass calls it moved. Every candidate
        // is clamped FIRST and judged by what is left.
        const options = [
          { x: clamp(a.x - b.width, minX, maxX - b.width), y: b.y },
          { x: clamp(a.x + a.width, minX, maxX - b.width), y: b.y },
          { x: b.x, y: clamp(a.y - b.height, minY, maxY - b.height) },
          { x: b.x, y: clamp(a.y + a.height, minY, maxY - b.height) },
        ];
        let pick = options[0];
        let least = Number.POSITIVE_INFINITY;
        for (const option of options) {
          const rest = intersectionArea(
            { x: option.x, y: option.y, width: b.width, height: b.height },
            a,
          );
          const travel = Math.abs(option.x - b.x) + Math.abs(option.y - b.y);
          const score = rest * 1000 + travel;
          if (score < least) { least = score; pick = option; }
        }
        b.x = pick.x;
        b.y = pick.y;
        moved = true;
      }
    }
    if (!moved) break;
  }
}

/** How much of the walk's answer is two instruments in the same place. */
function overlapArea(placed: readonly ConstellationPlacement[]): number {
  let total = 0;
  for (let i = 0; i < placed.length; i += 1) {
    for (let j = i + 1; j < placed.length; j += 1) {
      total += intersectionArea(placed[i], placed[j]);
    }
  }
  return total;
}

/**
 * Place every instrument, and say where each one went.
 *
 * ⭐ THE WALK IS GREEDY, SO IT NEEDS A WAY TO TAKE BACK.
 *
 * Each instrument picks the best room still free and becomes an obstacle for
 * everyone after it — stable, cheap, and unable to undo a choice that turns out
 * to have been too generous. On an 820 px portrait stage with the cell high in
 * it, the register takes 612 px of the only usable room and the reader, placed
 * third with 46 px left, has nowhere to be: 48,960 px² of overlap, and no
 * amount of scoring inside one pass can fix it, because the mistake was made
 * before the reader was considered.
 *
 * So the pass is repeated with the shrinkable instruments asking for less — two
 * retries, at 60 % and 40 % of what they wanted — and the first clean answer
 * wins; if none is clean, the least-overlapping one does. That is the sentence
 * this layout is built on, made operational: shrink what may shrink rather than
 * standing on your neighbour. The specimen is never in the squeeze, because a
 * capped window is a clipped braid.
 */
export function constellationPlacement(
  input: ConstellationInput,
): ConstellationPlacement[] {
  let best = walkOnce(input, 1, input.lock);
  let bestOverlap = overlapArea(best);
  if (bestOverlap > 0) {
    for (const squeeze of [0.6, 0.4]) {
      const attempt = walkOnce(input, squeeze, input.lock);
      const overlap = overlapArea(attempt);
      if (overlap < bestOverlap) { best = attempt; bestOverlap = overlap; }
      if (bestOverlap === 0) break;
    }
  }
  if (bestOverlap > 0) prise(best, input);
  // ⚠️ The lock is written from the ACCEPTED pass only: a retry that was thrown
  // away must not tell the next frame which rooms this one chose.
  if (input.lock) {
    for (const placement of best) input.lock.quadrant[placement.slot] = placement.quadrant;
  }
  return best;
}

/**
 * Where a leader starts and ends: from the reticle's ring, to the corner of
 * the instrument nearest the cell.
 *
 * The end is the box's nearest point, which for a diagonally-placed panel IS
 * its near corner — so the line lands on the corner the eye already reads as
 * the panel's beginning, and it keeps landing there when a clamp has slid the
 * panel sideways and the nearest point has become the middle of an edge.
 */
export function constellationLeader(
  anchorX: number,
  anchorY: number,
  reticlePx: number,
  panel: { x: number; y: number; width: number; height: number },
): { x1: number; y1: number; x2: number; y2: number } {
  const x2 = Math.max(panel.x, Math.min(anchorX, panel.x + panel.width));
  const y2 = Math.max(panel.y, Math.min(anchorY, panel.y + panel.height));
  const dx = x2 - anchorX;
  const dy = y2 - anchorY;
  const length = Math.hypot(dx, dy);
  if (length < 1) return { x1: anchorX, y1: anchorY, x2, y2 };
  const start = reticlePx / 2 + 6;
  return {
    x1: anchorX + (dx / length) * start,
    y1: anchorY + (dy / length) * start,
    x2,
    y2,
  };
}
