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
/**
 * The shortest move a seat is TRAVELLED to rather than simply written.
 *
 * A travel costs the leaders. A line drawn to where a plate is GOING points at
 * nothing while it is on the way, so every leader is down for `HUD_MOTION.seat`
 * from the moment any plate starts moving. That is the right trade for a
 * re-composition — the constellation steps after its Cell about every
 * `CONSTELLATION_HOLD_RADIUS_PX` and the reader's eye has something to follow —
 * and the wrong one for a nudge, where there is nothing to follow and a quarter
 * of a second without a leader costs more than the jump it saved. So the floor
 * is the smallest distance this composition treats as a distance at all: the
 * minimum gap it will leave between two instruments. A move no wider than the
 * thinnest gap on the stage is written and forgotten. Raising it leaves more
 * small re-seats as jumps; lowering it takes every leader down more often, for
 * less.
 */
export const CONSTELLATION_SEAT_TRAVEL_MIN_PX = CONSTELLATION_MIN_GAP_PX;
/**
 * The shortest a cappable instrument is allowed to be while any composition
 * short of the last one is still on offer.
 *
 * An instrument that is capped scrolls, so a floor is not about what fits — it
 * is about what can be READ without scrolling for every line. 168 px is about
 * five rows of the register plus its head, which is the smallest a scan reads
 * as a list rather than as a slot. Below it the plate stops being an
 * instrument and becomes a label with a scrollbar.
 *
 * Until 2026-09-12 this constant was dead: `panelHeight` floored every rung of
 * the squeeze ladder at `CONSTELLATION_STACK_MIN_PX`, so the effective minimum
 * was 120 px everywhere and F8 of the 2026-09-11 review recorded it. What
 * changes is the crowded stages where the old floor was actually reached:
 * 1180 x 663 with four instruments went from four 120 px plates to four 168 px
 * ones, 1280 x 800 and 820 x 1078 from a 136 px reader to a 168 px one, and 48
 * of the 162 matrix layouts move, all of them toward taller plates.
 *
 * ⚠️ 1024 x 600 — the case the review named — does NOT change, and that is the
 * point of the ladder's last rung. Its band is 482 px tall with the Cell in the
 * middle: 142 px of room above the reticle and 232 below, which holds a 120 px
 * instrument above and one below and holds no 168 px one at all. So every rung
 * with the readable floor fails, the last rung answers with the 120 px stack
 * minimum, and the picture is byte for byte the one that shipped. A higher
 * floor can ask a stage to re-compose; it can never take its constellation
 * away.
 */
export const CONSTELLATION_MIN_HEIGHT_PX = 168;
/**
 * The shortest a cappable instrument is allowed to be on the LAST squeeze
 * level, where the question has stopped being "can this be read" and become
 * "is there a seat set at all".
 */
export const CONSTELLATION_STACK_MIN_PX = 120;
export const CONSTELLATION_ROUTE_CLEARANCE_PX = 8;
export const CONSTELLATION_ROUTE_MAX_BENDS = 3;

/** One rung of the compression ladder: how much of its asked height a cappable
 * instrument keeps, and how short it may be made at this rung. */
export interface ConstellationSqueezeLevel { ratio: number; floor: number }

/**
 * How much height the solver takes back at each level of compression, and how
 * short an instrument may be cut at each.
 *
 * Compression is escalated only when NO candidate at the current level seats,
 * so the ladder is read top to bottom and stops at the first rung with an
 * answer. The first five rungs floor every cappable plate at the READABLE
 * minimum: an instrument the reader cannot read is not an answer while another
 * arrangement exists. The sixth is the answer of last resort — the same
 * 0.16 ratio at the 120 px stack minimum that shipped before 2026-09-12 — so
 * no stage can lose a constellation to the higher floor, it can only be asked
 * to re-compose before it is cut that far.
 *
 * The fifth rung is what the extra floor costs and what it buys: a plate that
 * used to be cut to 120 px at ratio 0.4 is now either seated at 168 px there
 * or seated at 168 px one rung lower, where a taller neighbour gives up its
 * own height instead. Measured over the 162-case matrix: 22 layouts move, all
 * of them toward taller plates, and none becomes `unavailable`.
 */
export const CONSTELLATION_SQUEEZE_LEVELS: readonly ConstellationSqueezeLevel[] = [
  { ratio: 1, floor: CONSTELLATION_MIN_HEIGHT_PX },
  { ratio: 0.76, floor: CONSTELLATION_MIN_HEIGHT_PX },
  { ratio: 0.56, floor: CONSTELLATION_MIN_HEIGHT_PX },
  { ratio: 0.4, floor: CONSTELLATION_MIN_HEIGHT_PX },
  { ratio: 0.16, floor: CONSTELLATION_MIN_HEIGHT_PX },
  { ratio: 0.16, floor: CONSTELLATION_STACK_MIN_PX },
];

/**
 * The narrowest stage that gets a keep-out FIELD around the selected Cell.
 *
 * Below it the instruments stand at the reticle's own clearance, because a
 * field wide enough to read as one would leave no room for a plate; at and
 * above it the Cell keeps a proportional field (`constellationKeepoutPx`) so
 * the reticle has air around it and the leaders have somewhere to bend. 1280
 * is the narrowest stage this product treats as a desktop one, and it is the
 * width at which a 440 px register plus a 280 px specimen plus two gaps and a
 * 120 px field still fit side by side.
 *
 * It has four readers: the three candidate enumerators and `anchorKeepoutPx`,
 * which is what any path that offers a held seat back to the solver measures
 * against. They were four separate literals until 2026-09-12 (F8).
 */
export const CONSTELLATION_FIELD_MIN_STAGE_PX = 1280;

/**
 * How far the Cell may travel from the anchor its seats were solved at before
 * the constellation is asked to step after it.
 *
 * Inside this radius the held seats are reused verbatim and the re-solve's
 * continuity reference is the held seat itself, so an instrument stands
 * perfectly still while the reader reads and the galaxy turns underneath.
 * Outside it the reference becomes the held seat plus the anchor delta, so the
 * constellation follows the Cell AS A GROUP rather than re-deriving a fresh
 * composition: it steps about once every radius of travel, and the plates keep
 * their relative arrangement across the step. The trade is how far the Cell may
 * drift from its instruments before they come with it; 160 px is a little under
 * two reticle diameters, which is the distance at which the leaders start to
 * read as long rather than as a constellation.
 */
export const CONSTELLATION_HOLD_RADIUS_PX = 160;

/**
 * What one pixel of seat movement costs the scorer, in the same currency as
 * every other term.
 *
 * Continuity is the strongest preference the scorer has, and deliberately so:
 * a plate the reader is reading may not be moved for a tidier composition. It
 * stays below the height term (4 pt per pixel of compression), so an
 * arrangement that keeps an instrument at its asked height still beats one
 * that holds a seat and cuts 100 px off a plate to do it.
 *
 * 2 is a measurement, not the plan's proposal of 1. The term it has to beat is
 * the HUD overlap preference, which is 1 pt per 80 px² — a 440 px register
 * standing over the right-hand rails of a 1920 stage scores about 1,400 there,
 * where three plates held perfectly still score at most 3 × the cap. At 1 pt/px
 * that preference wins and the whole constellation crosses the stage rather
 * than stand on a rail it is already allowed to draw over, which is the
 * teleport this phase exists to remove: probe E's rightward drift kept a
 * 734 px jump at 1 pt/px and 1.5, and a 749 px one on the diagonal. From 2
 * upwards every re-seat in the probe is a pure group step — each plate moves
 * exactly the anchor's own travel and no more — and the picture is identical
 * at 2, 3 and 4, so this is a plateau and not a knife edge.
 */
export const CONSTELLATION_CONTINUITY_PX_WEIGHT = 2;

/**
 * The most one plate's movement may cost, in pixels of distance.
 *
 * Past this distance a seat is not "further from where it was", it is
 * somewhere else entirely, and letting the term keep growing would make a
 * layout that puts one plate across the stage arbitrarily worse than one that
 * puts two plates half a stage away. Capping it keeps the term a preference
 * for holding still rather than a veto on re-composing, and it is what lets a
 * genuine side flip happen at all when the held side runs out of room. At
 * 1 pt/px the cap is 400 points a plate.
 */
export const CONSTELLATION_CONTINUITY_CAP_PX = 400;

/**
 * How far outside the straight line between an outlet and a plate edge the
 * orthogonal search is allowed to look.
 *
 * Every point the search can reach lies inside this corridor, so an obstacle
 * that does not touch it can neither block a leg nor contribute a coordinate,
 * and dropping those shrinks both the grid and every clearance walk. The plan
 * proposed twice the route clearance plus the reticle radius — 62 px — and the
 * oracle says that is wrong for this geometry: the winning leaders of the 149
 * clean matrix layouts step up to 617 px off the straight line to get around a
 * plate, and a 62 px corridor moved 53 of them and left 13 with a fallback
 * where a real route existed. 640 px is the smallest round bound above that
 * measured worst case. It leaves a 1920 px stage almost unrestricted, which is
 * honest: on the stages this product supports the corridor is insurance, not a
 * saving, and it earns its cost back only where a stage is much larger than
 * the distance a leader travels.
 */
export const ROUTE_SEARCH_MARGIN_PX = 640;

/**
 * The most grid points one start–end pair may examine before its route is
 * abandoned.
 *
 * The orthogonal search is quadratic in the number of distinct obstacle edges
 * inside the corridor, and a stage with five rails and four plates presents
 * enough of them that one pair can walk thousands of points. 1,600 covers a
 * forty-by-forty grid, which is above the largest a clean matrix layout was
 * measured to need; past it the answer is not getting better, only later. A
 * pair that runs out degrades, and `routeCapHits` says it happened.
 */
export const ROUTE_GRID_POINT_CAP = 1600;

/**
 * How many start–end pairs of one plate may enter the grid search.
 *
 * The fast two-leg pass has already tried all 96; the grid search only runs
 * for a plate no straight-and-bend line reached, and it used to run for every
 * one of the 96 again — the single dearest thing the router did. The pairs are
 * chosen by their Manhattan lower bound, which is a strict lower bound on the
 * length of any route between them, so the cap keeps the shortest routes that
 * could possibly exist. 13 is where the measurement put it: across the clean
 * matrix layouts the winning pair's rank reaches 12 at the 91st percentile
 * (and 40 once), so a cap of 4 as the plan proposed moved 49 layouts while 13
 * moves 7. Lower it and more plates take the fallback leader; raise it and the
 * four-panel tail goes back over the interaction budget — which is why the
 * background refinement, which is not on the interaction path, raises it to
 * `ROUTE_REFINE_GRID_PAIR_CAP` and loses none of them.
 */
export const ROUTE_GRID_PAIR_CAP = 13;

/**
 * How many route orders one candidate geometry may be tried in.
 *
 * The order plates are routed in matters because each route becomes an
 * obstacle for the next. The preferred order is the one today's clean layouts
 * route in; when it leaves a plate unreachable, that plate is tried first
 * instead, which is the single change that can help it. Beyond those two the
 * permutations are a search over 6 or 24 orders for a layout that has already
 * said it is crowded, and the review measured it at seconds per solve. This
 * bounds the `first` effort only; the background refinement walks those
 * permutations behind `ROUTE_REFINE_ORDER_CAP`, where the latency is nobody's.
 */
export const ROUTE_ORDER_CAP = 2;

/**
 * How many seat sets one squeeze/gap bucket may route.
 *
 * Geometry enumeration stays exhaustive, because it is what decides where the
 * instruments stand and nothing may quietly drop a seat set; routing a
 * candidate is far dearer than building one, so only the best twelve by score
 * are ever routed. Twelve is what the scoring shipped with; it is named here
 * because it is a cost gate, not a detail of the selection. It is also the
 * bound that is NOT binding: measured over the 162 matrix layouts on
 * 2026-09-12, enumerating and validating a four-plate stage is itself p90
 * 8 ms and up to 35 ms, which is now the larger half of a slow solve.
 */
export const ROUTE_CANDIDATE_CAP = 12;

/**
 * How many route orders one REFINEMENT may try.
 *
 * The refinement runs behind an already-painted constellation, so it may spend
 * what first paint may not: the whole permutation set, 6 orders at three
 * plates and 24 at four, starting from `preferredRouteOrder` so a layout that
 * is already reachable in the ordinary order costs exactly one pass. 24 is not
 * a compromise — it is the measured requirement. Over the 149 layouts the
 * router reached cleanly before P2's caps, the winning order is the first one
 * in 109 cases but reaches index 23 in two, and walking to index 23 is
 * precisely the seconds-long solve first paint may not pay for.
 */
export const ROUTE_REFINE_ORDER_CAP = 24;

/**
 * How many start–end pairs of one plate may enter a REFINEMENT's grid search.
 *
 * `ROUTE_GRID_PAIR_CAP` (13) is what a first paint can afford; the winning
 * pair's rank over the clean set reaches 40, so 41 is the smallest cap that
 * loses nothing. It costs: at 41 the four-panel first-paint tail measured
 * 82 ms p99, which is why first paint does not have it. A refinement is
 * sliced at 1.6 ms a frame behind a picture the reader is already reading, so
 * it pays the same cost in latency the reader cannot see.
 */
export const ROUTE_REFINE_GRID_PAIR_CAP = 41;

/**
 * The total grid points one refinement may examine before it stops and keeps
 * the best answer it has.
 *
 * `ROUTE_GRID_POINT_CAP` bounds one start–end pair; this bounds the whole
 * refinement — every pair, of every plate, in every order it tries. It is the
 * only bound on a `refine` pass that cannot be defeated by presenting it with
 * more work, and it is what makes "the refinement costs at most N" a statement
 * rather than a hope. 320,000 is a measurement, not a round number. The plan
 * proposed 250,000, and at that value two of the twelve leaders P2's caps cost
 * ran out of budget several orders short of the line that rescues them. Over
 * the whole matrix the dearest refinement that SUCCEEDS spends 270,219 points
 * and about 100 ms of search, so 320,000 clears the worst measured success with
 * room — and still stops the one case that would otherwise walk 585,057 points
 * to find nothing (1180x663 at 0.78, 0.25 with four plates). Spent 1.6 ms at a
 * time that is about a second of wall clock behind a constellation the reader
 * already has. When the budget runs out the best attempt so far is kept, which
 * is never worse than the picture that is up.
 */
export const ROUTE_REFINE_POINT_BUDGET = 320_000;

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

/**
 * How much of the route clearance a RE-ANCHORED leader may give back.
 *
 * The canonical router draws its lines against obstacles expanded by
 * `CONSTELLATION_ROUTE_CLEARANCE_PX`, and the shortest legal line hugs that
 * expanded edge exactly — which is what F7 of the 2026-09-11 review measured:
 * a one-pixel move of the Cell pushed about a fifth of the matrix's leaders a
 * fraction of a pixel inside an obstacle they had been touching, the
 * re-anchor returned null, and the leaders disappeared until the locked cursor
 * landed. A leader that vanishes on a pixel of drift is a leader that vanishes
 * whenever the galaxy turns.
 *
 * So carrying a PROVEN line across a move judges it three pixels more kindly
 * than drawing a new one, and may slide the leg that follows the translated
 * head by up to the same three to clear something. The trade is visible and
 * small: a carried leader may pass 5 px from a plate where a fresh one keeps
 * 8. What it buys is the leader staying on screen. The target plate and the
 * reticle are NOT given the tolerance — a line that entered the plate it
 * points at, or the ring it leaves from, would be wrong rather than tight.
 *
 * The canonical router never sees this, so the oracle is untouched: only the
 * locked path's route reuse and the presentation re-anchor go through here.
 */
export const REVALIDATE_TOLERANCE_PX = 3;

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
/** Which of the four listed positions the name chip took. The suffixed two are
 * the same vertical side, slid horizontally to clear a held plate. */
export type ConstellationChipPosition =
  'below' | 'above' | 'below-shifted' | 'above-shifted';
/** What deciding where the chip stands needs to know. The chip is the one
 * claim the inspection layer reserves for itself, so its size travels with the
 * request rather than with the panels. */
export interface ConstellationChipInput {
  anchorX: number; anchorY: number;
  stageWidth: number; stageHeight: number;
  edge: number;
  chipWidth: number; chipHeight: number;
}
export interface ConstellationChipPlacement {
  /** Centre x of the chip: what the transform writes, with the chip's own
   * `translateX(-50%)` doing the rest. */
  x: number;
  /** Top y of the chip. */
  y: number;
  left: number; top: number; right: number; bottom: number;
  position: ConstellationChipPosition;
  /** True when this is where the chip stands with nothing in its way — under
   * the Cell, or above it where the stage has no room below. A false here is a
   * relocation, and the writer counts it. */
  preferred: boolean;
  /** True when the rectangle touches no plate. False means every listed
   * position was blocked; the chip stands on its preferred one and the caller
   * decides what to do about the plate underneath it. */
  clear: boolean;
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
  /** Where the name chip stands for THIS layout: the preferred position on a
   * fresh solve, and the position that clears the held plates on a layout the
   * lock carried. Absent when the caller reserved no chip at all. */
  chip?: ConstellationChipPlacement;
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
  /** Plates that left a PUBLISHED layout carrying the fallback leader. A
   * degraded route built during an attempt that lost is not counted: this
   * says what the reader saw, not how hard the router worked. */
  degradedRoutes: number;
  /** Grid points examined by `orthogonalRouteSteps`, summed over every pair
   * it searched. Bounded per pair by `ROUTE_GRID_POINT_CAP` and per plate by
   * `ROUTE_GRID_PAIR_CAP`. */
  routeGridPoints: number;
  /** How often one of the four router caps — grid points, grid pairs, route
   * orders, candidates — actually stopped a search that wanted to continue.
   * Zero over a sweep means the caps are only insurance; a rising count on one
   * stage names the geometry that needs a wider bound. */
  routeCapHits: number;
  /** Frames on which an `unavailable` verdict was held rather than re-derived
   * because the Cell had not travelled `CONSTELLATION_UNAVAILABLE_RESOLVE_PX`
   * from where the stage last said it had no room. */
  unavailableHolds: number;
  /** Refinements started behind a landed, degraded constellation. */
  refineStarts: number;
  /** Refinements that finished and were applied to the picture on screen. */
  refineLandings: number;
  /** Leaders that went from the dashed fallback to a canonical route because
   * a refinement found the line first paint could not afford to look for. */
  refineUpgrades: number;
  /** Refinements that finished against seats the writer had already moved on
   * from, and were therefore thrown away. A refinement may never write a route
   * to a plate that is no longer where it was routed for. */
  refineDropped: number;
  /** Seat changes the frame writer animated instead of writing at once. */
  seatTweens: number;
  /** Times the name chip moved off its preferred position to clear a held
   * plate instead of breaking the seat lock. One relocation is one MOVE, not
   * one frame: the chip standing beside the Cell for a whole reading is one. */
  chipRelocations: number;
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
  degradedRoutes: 0,
  routeGridPoints: 0,
  routeCapHits: 0,
  unavailableHolds: 0,
  refineStarts: 0,
  refineLandings: 0,
  refineUpgrades: 0,
  refineDropped: 0,
  seatTweens: 0,
  chipRelocations: 0,
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

/** The frame writer held an `unavailable` verdict instead of re-deriving it. */
export function observeConstellationUnavailableHold(): void {
  constellationWorkStats.unavailableHolds += 1;
}

/** A refinement was started behind a landed constellation with at least one
 * fallback leader. */
export function observeConstellationRefineStart(): void {
  constellationWorkStats.refineStarts += 1;
}

/** A refinement landed and its routes were written. `upgrades` is how many
 * leaders stopped being the dashed fallback because of it. */
export function observeConstellationRefineLanding(upgrades: number): void {
  constellationWorkStats.refineLandings += 1;
  constellationWorkStats.refineUpgrades += Math.max(0, upgrades);
}

/** A finished refinement was discarded because the seats it was routed for
 * are no longer the seats on screen. */
export function observeConstellationRefineDropped(): void {
  constellationWorkStats.refineDropped += 1;
}

/** A landing moved seats the reader was already reading, and the frame writer
 * travelled to them over `HUD_MOTION.seat` instead of writing them at once.
 * Counted per SEAT CHANGE, not per plate: one re-composition that moves three
 * instruments together is one tween, because it is one thing to watch. */
export function observeConstellationSeatTween(): void {
  constellationWorkStats.seatTweens += 1;
}

/** The name chip was written somewhere other than its preferred position, to
 * clear a plate the reader is reading. Counted per MOVE, not per frame: a chip
 * that stands beside the Cell for two hundred frames is one relocation. */
export function observeConstellationChipRelocation(): void {
  constellationWorkStats.chipRelocations += 1;
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
  /** The line the last full solve drew to each held plate, from the anchor it
   * was solved at (`anchorX`/`anchorY`). The locked path carries these across
   * the Cell's move instead of searching for them again, which is what keeps a
   * drifting frame inside the pointer interaction — and what keeps the leader
   * itself still, instead of finding a new path every half pixel. Points only:
   * the label is re-placed from the route that survives. */
  routes: { [slot: string]: readonly ConstellationPoint[] | undefined };
  /** The anchor `routes` were last PROVEN at, which is not the anchor the
   * seats were solved at.
   *
   * A composition is chosen once and then held for the whole reading — the
   * reader is inside `CONSTELLATION_HOLD_RADIUS_PX` of it for 160 px of drift
   * — while the leaders are re-proven on every locked landing. Carrying them
   * from the composition's anchor asks the router to slide a line by the whole
   * accumulated delta; carrying them from here asks it to slide by the half
   * pixel the Cell actually moved. Measured 2026-09-12 beside the HUD rails at
   * 0.6 px a frame: 53–79 % of plate-frames took the dashed fallback from the
   * one question, 0 % from the other. */
  routeAnchorX: number;
  routeAnchorY: number;
  geometryKey: string;
  /** The same question WITHOUT the panel heights: the stage, the safe top, the
   * edge, each instrument's slot and width, the rails and the chip's measure.
   * Equal shape keys and different geometry keys is exactly one thing — the
   * content of an instrument grew or shrank — and it is the one change the
   * constellation answers by extending a plate rather than re-composing. */
  shapeKey: string;
  anchorX: number;
  anchorY: number;
}
export function createConstellationLock(): ConstellationLock {
  return {
    quadrant: {}, template: null, placements: {}, routes: {},
    routeAnchorX: 0, routeAnchorY: 0,
    geometryKey: '', shapeKey: '', anchorX: 0, anchorY: 0,
  };
}
export function resetConstellationLock(lock: ConstellationLock): void {
  for (const key of Object.keys(lock.quadrant)) delete lock.quadrant[key];
  for (const key of Object.keys(lock.placements)) delete lock.placements[key];
  for (const key of Object.keys(lock.routes)) delete lock.routes[key];
  lock.template = null;
  lock.geometryKey = '';
  lock.shapeKey = '';
  lock.anchorX = 0;
  lock.anchorY = 0;
  lock.routeAnchorX = 0;
  lock.routeAnchorY = 0;
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
/**
 * How tall one instrument stands at one rung of the compression ladder.
 *
 * A plate shorter than it asked for is `capped` and scrolls; a plate that was
 * never cappable (the specimen, whose window is a square) is handed back
 * untouched at every rung. A plate whose asked height is already below the
 * rung's floor keeps it: a floor raises nothing, it only refuses to cut.
 */
function panelHeight(panel: ConstellationPanel, level: ConstellationSqueezeLevel): number {
  if (!cappable(panel.slot)) return panel.height;
  const floor = Math.min(panel.height, level.floor);
  return Math.min(panel.height, Math.max(floor, panel.height * level.ratio));
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
  squeeze: ConstellationSqueezeLevel,
  gap: number,
): Candidate | null {
  const groups = { l: [] as ConstellationPanel[], r: [] as ConstellationPanel[],
    t: [] as ConstellationPanel[], b: [] as ConstellationPanel[] };
  panels.forEach((panel, index) => groups[sides[index]].push(panel));
  const out: ConstellationPlacement[] = [];
  const minY = input.safeTop; const maxY = input.stageHeight - input.edge;
  const minX = input.edge; const maxX = input.stageWidth - input.edge;
  const coreGap = (input.stageWidth >= CONSTELLATION_FIELD_MIN_STAGE_PX
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
  squeeze: ConstellationSqueezeLevel,
  gap: number,
): Candidate | null {
  const near = panels.filter((panel) => panel.slot === 'specimen' || panel.slot === 'reader');
  const far = panels.filter((panel) => panel.slot === 'analysis' || panel.slot === 'trace');
  if (near.length === 0 || far.length === 0) return null;
  const keepout = input.stageWidth >= CONSTELLATION_FIELD_MIN_STAGE_PX
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
  topSlots: ReadonlySet<ConstellationSlot>, squeeze: ConstellationSqueezeLevel,
  gap: number): Candidate | null {
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
  const core = (input.stageWidth >= CONSTELLATION_FIELD_MIN_STAGE_PX
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
  allObstacles: readonly Box[], bounds: Box,
  guideKey?: string,
  budget: RouteGridBudget | null = null): Generator<void, ConstellationPoint[] | null> {
  if (budget !== null && budget.points <= 0) return null;
  if (allObstacles.some((box) => pointInside(start, box) || pointInside(end, box))) return null;
  const fast = fastOrthogonalRoute(start, end, allObstacles);
  if (fast) return fast;
  // The corridor. Every point this search can reach lies inside it, so an
  // obstacle that does not touch it can neither block a leg nor contribute a
  // useful coordinate, and both the grid and every `segmentClear` walk shrink
  // from stage-sized to corridor-sized.
  const searchBox: Box = {
    x: Math.max(bounds.x, Math.min(start.x, end.x) - ROUTE_SEARCH_MARGIN_PX),
    y: Math.max(bounds.y, Math.min(start.y, end.y) - ROUTE_SEARCH_MARGIN_PX),
    width: 0,
    height: 0,
  };
  searchBox.width = Math.min(bounds.x + bounds.width,
    Math.max(start.x, end.x) + ROUTE_SEARCH_MARGIN_PX) - searchBox.x;
  searchBox.height = Math.min(bounds.y + bounds.height,
    Math.max(start.y, end.y) + ROUTE_SEARCH_MARGIN_PX) - searchBox.y;
  const obstacles = allObstacles.filter((box) => (
    box.x < searchBox.x + searchBox.width + 0.5 && box.x + box.width > searchBox.x - 0.5
    && box.y < searchBox.y + searchBox.height + 0.5 && box.y + box.height > searchBox.y - 0.5
  ));
  const left = searchBox.x; const right = searchBox.x + searchBox.width;
  const top = searchBox.y; const foot = searchBox.y + searchBox.height;
  const xs = new Set<number>([start.x, end.x, left, right]);
  const ys = new Set<number>([start.y, end.y, top, foot]);
  obstacles.forEach((box) => {
    xs.add(clamp(box.x, left, right));
    xs.add(clamp(box.x + box.width, left, right));
    ys.add(clamp(box.y, top, foot));
    ys.add(clamp(box.y + box.height, top, foot));
  });
  const xValues = [...xs]; const yValues = [...ys];
  let gridPoints = 0;
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
    gridPoints += 1;
    const a = { x, y: start.y };
    if (!segmentClear(start, a, obstacles)) continue;
    consider([start, a, { x, y: end.y }, end], directOrdinal);
    directOrdinal += 1;
    if ((quantum += 1) % 8 === 0) yield;
  }
  for (const y of yValues) {
    gridPoints += 1;
    const a = { x: start.x, y };
    if (!segmentClear(start, a, obstacles)) continue;
    consider([start, a, { x: end.x, y }, end], directOrdinal);
    directOrdinal += 1;
    if ((quantum += 1) % 8 === 0) yield;
  }
  constellationWorkStats.routeGridPoints += gridPoints;
  if (budget !== null) budget.points -= gridPoints;
  if (best) return best;
  // The two-leg passes above are linear in the coordinate set and always run;
  // the cap governs the quadratic sweep below, counting what they already
  // spent so a corridor dense enough to exhaust it on its own searches no
  // grid at all.
  let capped = false;
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
  sweep:
  for (let xIndex = 0; xIndex < xValues.length; xIndex += 1) {
    const x = xValues[xIndex];
    for (let yIndex = 0; yIndex < yValues.length; yIndex += 1) {
    if (gridPoints >= ROUTE_GRID_POINT_CAP
      || (budget !== null && budget.points <= 0)) { capped = true; break sweep; }
    gridPoints += 1;
    constellationWorkStats.routeGridPoints += 1;
    if (budget !== null) budget.points -= 1;
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
  if (capped) constellationWorkStats.routeCapHits += 1;
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

/** Where a leader may leave the reticle: eight outlets on the ring, the same
 * eight the canonical router offers and the only ones a re-anchored route may
 * start from. */
function routeOutlets(anchorX: number, anchorY: number): ConstellationPoint[] {
  const radius = CONSTELLATION_RETICLE_PX / 2 + 6;
  const outlet = 18;
  return [
    { x: anchorX + radius, y: anchorY - outlet },
    { x: anchorX + radius, y: anchorY + outlet },
    { x: anchorX - radius, y: anchorY - outlet },
    { x: anchorX - radius, y: anchorY + outlet },
    { x: anchorX - outlet, y: anchorY + radius },
    { x: anchorX + outlet, y: anchorY + radius },
    { x: anchorX - outlet, y: anchorY - radius },
    { x: anchorX + outlet, y: anchorY - radius },
  ];
}

interface ReanchorContext {
  anchorX: number; anchorY: number;
  previousAnchorX: number; previousAnchorY: number;
  target: Box;
  /** Everything the route must miss, already expanded by the caller — the
   * other plates, the chip claim, the visible rails, the labels and the routes
   * that were drawn before this one. A carried line is judged against these
   * shrunk by `REVALIDATE_TOLERANCE_PX`. */
  obstacles: readonly Box[];
  /** The target plate and the reticle, at their exact bounds. These get no
   * tolerance: a leader may land on the plate's edge and leave the ring, and
   * it may enter neither. */
  exact: readonly Box[];
  bounds: Box;
}

/**
 * Carry one already-proven route across a move of the anchor.
 *
 * Four attempts, cheapest first, and every one of them is judged by the same
 * `valid` predicate: the route leaves one of the eight outlets, lands on the
 * target's boundary, stays inside the stage and clears every obstacle it is
 * given — the moveable ones shrunk by `REVALIDATE_TOLERANCE_PX`, the target
 * and the reticle exact. First the whole polyline is translated at its head
 * and the leg that follows is snapped back to its axis — the ordinary
 * one-pixel orbit frame. Then that same leg is slid along its own axis by up
 * to the tolerance, which is the smallest thing that rescues a line the move
 * pressed against something. Then an outlet is reconnected to a later point of
 * the proven route, which rescues a leader whose first leg alone has been
 * blocked. Last a bounded two-leg pass over the outlets and the plate's own
 * edge points, for a camera jump that left the old line on the wrong side
 * entirely. Nothing here enters the orthogonal grid search, and `null` means
 * the caller must route or degrade this plate.
 */
function reanchorRoutePoints(
  old: readonly ConstellationPoint[],
  context: ReanchorContext,
): ConstellationPoint[] | null {
  if (old.length < 2) return null;
  const { target } = context;
  // ⚠️ THE STAGE, NOT THE ROUTER'S SEARCH BOX.
  //
  // `bounds` is the corridor the GRID search may put a bend in — the stage
  // inset by the route clearance — and the fast two-leg pass, which draws most
  // of the clean leaders, never consults it. Judging a carried line by it
  // therefore refused lines the router itself had drawn: a leader landing on a
  // plate edge within 8 px of the stage edge could never be re-anchored, in
  // any direction, however small the move. Measured 2026-09-12 over the
  // matrix, that was 53 of 648 two-pixel moves on its own.
  const bounds = expanded(context.bounds, CONSTELLATION_ROUTE_CLEARANCE_PX);
  // A carried line is judged three pixels more kindly than a drawn one; the
  // target and the reticle keep their exact bounds. `expanded` by a negative
  // amount can invert a small box, which `pointInside` and `segmentClear`
  // read as "blocks nothing" — the right answer for something the tolerance
  // has shrunk away entirely.
  const obstacles: Box[] = [
    ...context.obstacles.map((box) => expanded(box, -REVALIDATE_TOLERANCE_PX)),
    ...context.exact,
  ];
  const outlets = routeOutlets(context.anchorX, context.anchorY);
  const valid = (candidate: ConstellationPoint[]): boolean => {
    if (candidate.length < 2 || candidate.length - 2 > CONSTELLATION_ROUTE_MAX_BENDS) return false;
    if (!outlets.some((start) => Math.hypot(
      start.x - candidate[0].x, start.y - candidate[0].y,
    ) < 0.1)) return false;
    const end = candidate[candidate.length - 1];
    const endsOnTarget = (
      (Math.abs(end.x - target.x) < 0.1
        || Math.abs(end.x - target.x - target.width) < 0.1)
        && end.y >= target.y - 0.1 && end.y <= target.y + target.height + 0.1
    ) || (
      (Math.abs(end.y - target.y) < 0.1
        || Math.abs(end.y - target.y - target.height) < 0.1)
        && end.x >= target.x - 0.1 && end.x <= target.x + target.width + 0.1
    );
    if (!endsOnTarget) return false;
    if (candidate.some((point) => point.x < bounds.x - 0.1 || point.y < bounds.y - 0.1
      || point.x > bounds.x + bounds.width + 0.1
      || point.y > bounds.y + bounds.height + 0.1)) return false;
    for (let index = 1; index < candidate.length; index += 1) {
      if (!segmentClear(candidate[index - 1], candidate[index], obstacles)) return false;
    }
    return true;
  };
  let translated = old.map((point) => ({ ...point }));
  translated[0].x += context.anchorX - context.previousAnchorX;
  translated[0].y += context.anchorY - context.previousAnchorY;
  if (Math.abs(old[0].x - old[1].x) < 0.01) translated[1].x = translated[0].x;
  else translated[1].y = translated[0].y;
  const snapped = translated.map((point) => ({ ...point }));
  translated = simplify(translated);
  if (valid(translated)) return translated;
  // The leg that follows the translated head, slid along its own axis — and
  // then each interior leg after it, for a line with more than one bend.
  //
  // Sliding a leg means moving BOTH its ends along the axis it does not run
  // on. The legs either side of it are perpendicular by construction, so they
  // only get longer or shorter: nothing cascades, the line stays orthogonal,
  // and the last point stays on the plate's edge (`valid` re-checks that it
  // did not slide off the end of one). The head itself never moves, because it
  // has to stay on an outlet of the ring.
  for (let leg = 1; leg + 1 < snapped.length; leg += 1) {
    // The leg's own axis: a vertical leg may move in x, a horizontal one in y.
    const vertical = Math.abs(snapped[leg].x - snapped[leg + 1].x) < 0.01;
    for (const offset of [1, -1, 2, -2, REVALIDATE_TOLERANCE_PX, -REVALIDATE_TOLERANCE_PX]) {
      const slid = snapped.map((point) => ({ ...point }));
      if (vertical) { slid[leg].x += offset; slid[leg + 1].x += offset; }
      else { slid[leg].y += offset; slid[leg + 1].y += offset; }
      const candidate = simplify(slid);
      if (valid(candidate)) return candidate;
    }
  }
  for (const start of outlets) {
    for (let join = 1; join < old.length; join += 1) {
      const prefix = fastOrthogonalRoute(start, old[join], obstacles);
      if (!prefix) continue;
      const candidate = simplify([
        ...prefix.slice(0, -1),
        ...old.slice(join).map((point) => ({ ...point })),
      ]);
      if (valid(candidate)) return candidate;
    }
  }
  const endpoints = routeEndpoints(target, context.anchorX, context.anchorY);
  for (const start of outlets) {
    for (const endpoint of endpoints) {
      const candidate = fastOrthogonalRoute(start, endpoint, obstacles);
      if (candidate && valid(candidate)) return candidate;
    }
  }
  return null;
}

interface RoutedOrder {
  masks: HudOcclusionRect[];
  /** How many plates in this attempt got the fallback leader. */
  degraded: number;
  /** Index into `placements` of the first plate this attempt could not reach,
   * in the order it walked them. It is the one plate a second order can help,
   * by putting it first while the stage is still empty of routes. */
  firstDegradedIndex: number | null;
  routes: Array<ConstellationRoute | undefined>;
}

/**
 * How hard the router is allowed to look.
 *
 * `first` owns first paint and is P2 exactly: one preferred order, one retry,
 * thirteen grid pairs per plate. Its answer is what the reader sees within
 * three frames of a selection, and nothing here may change it by a byte.
 * `refine` runs behind a constellation that is already on screen, where
 * latency is invisible and only the picture matters: the whole permutation
 * set, forty-one grid pairs, and one total point budget for the lot.
 */
export type RouteEffort = 'first' | 'refine';

/** Grid points a whole refinement may still spend. Mutated as they are spent,
 * shared by every pair of every plate of every order in one pass. */
interface RouteGridBudget { points: number }

interface RouteEffortProfile {
  /** How many route orders this pass may try. */
  orderCap: number;
  /** How many start–end pairs of one plate may enter the grid search. */
  gridPairCap: number;
  /** Walk the permutations, rather than the preferred order and one retry. */
  permute: boolean;
  budget: RouteGridBudget | null;
}

function routeEffortProfile(effort: RouteEffort): RouteEffortProfile {
  return effort === 'refine'
    ? {
      orderCap: ROUTE_REFINE_ORDER_CAP,
      gridPairCap: ROUTE_REFINE_GRID_PAIR_CAP,
      permute: true,
      budget: { points: ROUTE_REFINE_POINT_BUDGET },
    }
    : {
      orderCap: ROUTE_ORDER_CAP,
      gridPairCap: ROUTE_GRID_PAIR_CAP,
      permute: false,
      budget: null,
    };
}

interface RouteMode {
  /** Held routes from the last published layout, by slot, with the anchor
   * they were solved for. A plate whose held route still reaches it after the
   * anchor moved keeps that route and costs almost nothing. */
  held?: {
    routes: { [slot: string]: readonly ConstellationPoint[] | undefined };
    anchorX: number;
    anchorY: number;
  };
  /** Stay out of the orthogonal grid search: try the fast two-leg pass and
   * then degrade. The locked path runs inside a pointer interaction and has a
   * held picture to fall back on; it may not spend a search there. */
  fastOnly?: boolean;
  /** Default `first`. */
  effort?: RouteEffort;
}

function* addRoutesInOrderSteps(input: ConstellationInput,
  placements: ConstellationPlacement[],
  order: readonly number[], mode: RouteMode,
  profile: RouteEffortProfile): Generator<void, RoutedOrder> {
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
  let firstDegradedIndex: number | null = null;
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
    // Everything a NEW line must clear, at the full route clearance. A line
    // that is merely being carried across the Cell's move is judged against
    // these shrunk by `REVALIDATE_TOLERANCE_PX`, which is why they are kept
    // apart from the two that get no tolerance at all.
    const softObstacles = [
      ...panelBoxes.filter((box) => box !== target), ...reserved, ...hud, ...placedLabels,
      ...priorRouteBoxes,
    ].map((box) => expanded(box, CONSTELLATION_ROUTE_CLEARANCE_PX));
    // The target itself stays at its exact boundary: the route may land on an
    // edge but may never enter the body and emerge at another edge.
    const exactObstacles: Box[] = [target, reticle];
    const obstacles = [...softObstacles, ...exactObstacles];
    const starts: ConstellationPoint[] = routeOutlets(input.anchorX, input.anchorY)
      .filter((point) => !usedOutlets.has(`${point.x},${point.y}`))
      .sort((a, b) => Math.hypot(a.x - (target.x + target.width / 2), a.y - (target.y + target.height / 2))
        - Math.hypot(b.x - (target.x + target.width / 2), b.y - (target.y + target.height / 2)));
    let best: ConstellationPoint[] | null = null;
    let bestLength = Number.POSITIVE_INFINITY;
    let bestOrdinal = Number.POSITIVE_INFINITY;
    const crossesPrior = (route: readonly ConstellationPoint[]) => {
      const outside = routeOutsideReticle(route, input.anchorX, input.anchorY,
        CONSTELLATION_RETICLE_PX / 2);
      return outside.some((segment) => priorRouteSegments.some((other) => segmentsTouch(segment, other)));
    };
    // A route the last published layout already proved, carried across the
    // anchor's move. Every current obstacle still judges it; what the reuse
    // saves is the search that would find the same line again, and what it
    // buys the reader is a leader that does not twitch to a new path each
    // time the galaxy turns half a pixel.
    const heldPoints = mode.held?.routes[placement.slot];
    if (heldPoints !== undefined && heldPoints.length >= 2) {
      const reanchored = reanchorRoutePoints(heldPoints, {
        anchorX: input.anchorX,
        anchorY: input.anchorY,
        previousAnchorX: mode.held?.anchorX ?? input.anchorX,
        previousAnchorY: mode.held?.anchorY ?? input.anchorY,
        target,
        obstacles: softObstacles,
        exact: exactObstacles,
        bounds,
      });
      if (reanchored && !crossesPrior(reanchored)) best = reanchored;
    }
    const endpoints = best ? [] : routeEndpoints(target, input.anchorX, input.anchorY);
    const pairs: Array<{
      start: ConstellationPoint;
      end: ConstellationPoint;
      startIndex: number;
      endIndex: number;
      lowerBound: number;
      ordinal: number;
    }> = [];
    let ordinal = 0;
    for (let startIndex = 0; startIndex < starts.length; startIndex += 1) {
      const start = starts[startIndex];
      for (let endIndex = 0; endIndex < endpoints.length; endIndex += 1) {
      const end = endpoints[endIndex];
      const aligned = Math.abs(start.x - end.x) < 0.01
        || Math.abs(start.y - end.y) < 0.01;
      pairs.push({
        start,
        end,
        startIndex,
        endIndex,
        lowerBound: Math.abs(start.x - end.x) + Math.abs(start.y - end.y)
          + (aligned ? 0 : 18),
        ordinal,
      });
      ordinal += 1;
      }
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
    if (!best && !mode.fastOnly) {
      // The fast pass has already tried every pair and found no two-leg line.
      // Only the shortest few are worth threading a bend through, so the cap
      // takes them by their Manhattan lower bound — then walks them in the
      // router's own start-then-endpoint order, so a plate whose winning pair
      // the cap did not cut is routed exactly as it was before the cap existed.
      const searchable = pairs.slice(0, profile.gridPairCap)
        .sort((a, b) => a.ordinal - b.ordinal);
      for (let index = 0; index < searchable.length; index += 1) {
        const pair = searchable[index];
        constellationWorkStats.searchedRouteAttempts += 1;
        const route = yield* orthogonalRouteSteps(
          pair.start, pair.end, obstacles, bounds,
          `${placement.slot}:${pair.startIndex}:${pair.endIndex}:${obstacles.length}`,
          profile.budget,
        );
        if (route && !crossesPrior(route)) { best = route; break; }
      }
      if (!best && pairs.length > searchable.length) constellationWorkStats.routeCapHits += 1;
    }
    if (!best) {
      placement.route = degradedRoute(
        input, target, panel?.labelWidth ?? 70, panel?.labelHeight ?? 20,
      );
      degraded += 1;
      if (firstDegradedIndex === null) firstDegradedIndex = placementIndex;
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
  return {
    masks, degraded, firstDegradedIndex, routes: placements.map((panel) => panel.route),
  };
}

const routeOrderCache: Array<readonly number[] | undefined> = [];

/**
 * The order plates are routed in when nothing has failed yet.
 *
 * Each route becomes an obstacle for the ones after it, so the order is a real
 * choice and the router used to search all of them — 6 permutations at three
 * plates, 24 at four, each one a full routing pass. These two are the heads of
 * the preference lists that search shipped with, and they are what today's
 * clean layouts route in: the register first, then the reader, then the trace,
 * then the specimen, so the instruments that carry the longest lines claim
 * their channel while the stage is still empty.
 */
function preferredRouteOrder(count: number): readonly number[] {
  const cached = routeOrderCache[count];
  if (cached) return cached;
  const order = count === 3 ? [0, 2, 1]
    : count === 4 ? [0, 2, 3, 1]
      : Array.from({ length: count }, (_value, index) => index);
  routeOrderCache[count] = order;
  return order;
}

/** The one order a failure earns: the plate that could not be reached goes
 * first, where nothing else has claimed a channel yet, and the rest keep their
 * relative places. `null` when it is already first and there is nothing to
 * change. */
function retryRouteOrder(
  order: readonly number[], firstDegradedIndex: number,
): readonly number[] | null {
  if (order.length === 0 || order[0] === firstDegradedIndex) return null;
  return [firstDegradedIndex, ...order.filter((index) => index !== firstDegradedIndex)];
}

const refineOrderCache: Array<readonly (readonly number[])[] | undefined> = [];

/**
 * Every order a refinement may try, best first.
 *
 * This is the permutation list the router shipped with before P2 capped it,
 * preserved exactly: the preference heads that today's clean layouts route in,
 * then the orders that were measured to rescue the awkward ones, then the rest
 * of the permutations. Its first entry IS `preferredRouteOrder`, so a
 * refinement that succeeds immediately costs one pass and reproduces first
 * paint's own answer.
 */
function refineRouteOrders(count: number): readonly (readonly number[])[] {
  const cached = refineOrderCache[count];
  if (cached) return cached;
  const permutations: number[][] = [];
  const visit = (prefix: number[], remaining: number[]) => {
    if (remaining.length === 0) { permutations.push(prefix); return; }
    for (let index = 0; index < remaining.length; index += 1) {
      visit([...prefix, remaining[index]], [
        ...remaining.slice(0, index), ...remaining.slice(index + 1),
      ]);
    }
  };
  visit([], Array.from({ length: count }, (_value, index) => index));
  const preferred = count === 3
    ? [[0, 2, 1], [0, 1, 2], [1, 2, 0], [2, 0, 1]]
    : count === 4
      ? [
        [0, 2, 3, 1], [0, 2, 1, 3], [0, 1, 3, 2], [0, 1, 2, 3],
        [0, 3, 1, 2], [0, 3, 2, 1], [1, 0, 3, 2], [1, 2, 3, 0],
        [2, 0, 3, 1], [2, 3, 0, 1], [2, 3, 1, 0], [3, 0, 1, 2], [3, 0, 2, 1],
      ]
      : [];
  const preferredKeys = new Set(preferred.map((order) => order.join(',')));
  const ordered = [
    ...preferred,
    ...permutations.filter((order) => !preferredKeys.has(order.join(','))),
  ];
  refineOrderCache[count] = ordered;
  return ordered;
}

/**
 * Every plate leaves here with a route.
 *
 * One loop, two efforts. It always starts from `preferredRouteOrder`, returns
 * the moment an order reaches every plate cleanly, and otherwise keeps the
 * attempt with the fewest fallback leaders — ties to the earlier order, which
 * is the router's own preference. What the effort decides is where the next
 * order comes from and how many there may be: `first` earns exactly one retry,
 * the failing plate moved to the front, for `ROUTE_ORDER_CAP` attempts in all;
 * `refine` walks the permutation list until it runs out, hits
 * `ROUTE_REFINE_ORDER_CAP`, or spends its grid-point budget.
 */
function* addRoutesSteps(input: ConstellationInput,
  placements: ConstellationPlacement[], mode: RouteMode = {}): Generator<void, RoutedOrder> {
  const profile = routeEffortProfile(mode.effort ?? 'first');
  const orders = profile.permute ? refineRouteOrders(placements.length) : null;
  let orderIndex = 0;
  let order: readonly number[] | null = preferredRouteOrder(placements.length);
  let best: RoutedOrder | null = null;
  let attempts = 0;
  while (order !== null && attempts < profile.orderCap) {
    constellationWorkStats.routeOrders += 1;
    // A route order is the smallest useful canonical unit: its later plates
    // depend on the exact paths chosen for its earlier ones. Yield between
    // orders so the Canvas path can budget the search without changing any of
    // them.
    if (attempts > 0) yield;
    for (const panel of placements) panel.route = undefined;
    const attempt: RoutedOrder = yield* addRoutesInOrderSteps(
      input, placements, order, mode, profile,
    );
    attempts += 1;
    if (best === null || attempt.degraded < best.degraded) best = attempt;
    if (attempt.degraded === 0) break;
    if (profile.budget !== null && profile.budget.points <= 0) break;
    if (orders !== null) {
      orderIndex += 1;
      order = orderIndex < orders.length ? orders[orderIndex] : null;
    } else {
      order = attempt.firstDegradedIndex === null || mode.fastOnly
        ? null
        : retryRouteOrder(order, attempt.firstDegradedIndex);
    }
  }
  const winner = best as RoutedOrder;
  // A cap, an exhausted order list or a spent budget stopped a search that
  // still had a fallback leader in its answer.
  if (winner.degraded > 0) constellationWorkStats.routeCapHits += 1;
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

/**
 * Where the name chip stands, given the plates that are already on screen.
 *
 * The chip carries the Cell's identity and it follows the reticle, so it is
 * the one part of the inspection layer that moves every frame — and, being a
 * hard claim the plates must keep out of, the one that used to break the seat
 * lock every twenty-odd pixels of drift. It yields instead. Four positions are
 * tried in order:
 *
 *   1. centred below the reticle — where it has always stood;
 *   2. centred above it;
 *   3. below, slid left or right by the smallest amount that clears every
 *      plate without leaving the stage;
 *   4. above, slid likewise.
 *
 * The first that touches no plate wins. When none does, the chip stands on its
 * preferred position anyway with `clear: false`, and the caller — the locked
 * path — takes that as its cue to give the seats up and solve again. A
 * position that would put the chip outside the stage is not offered at all,
 * which is how the flip above the Cell near the bottom edge happens: `below`
 * is simply not in the list there.
 *
 * Pure, and cheap enough to call on every frame: no allocation beyond the one
 * answer, and the plate loop is at most four plates times four positions.
 */
export function constellationChip(
  input: ConstellationChipInput,
  placements: readonly ConstellationPlacement[],
): ConstellationChipPlacement {
  const width = input.chipWidth; const height = input.chipHeight;
  const centre = width > 0
    ? clamp(input.anchorX, input.edge + width / 2, input.stageWidth - input.edge - width / 2)
    : input.anchorX;
  const belowTop = input.anchorY + CONSTELLATION_RETICLE_PX / 2 + 12;
  const aboveTop = input.anchorY - CONSTELLATION_RETICLE_PX / 2 - 12 - height;
  const belowFits = belowTop + height <= input.stageHeight - input.edge;
  const aboveFits = aboveTop >= input.edge;
  const at = (x: number, top: number, position: ConstellationChipPosition,
    preferred: boolean, clear: boolean): ConstellationChipPlacement => ({
    x, y: top,
    left: x - width / 2, top, right: x + width / 2, bottom: top + height,
    position, preferred, clear,
  });
  // The position the chip takes with nothing in its way, which is exactly what
  // the writer wrote before it learned to yield: below unless the stage has no
  // room below, and above otherwise.
  const fallback = belowFits
    ? at(centre, belowTop, 'below', true, false)
    : at(centre, aboveTop, 'above', true, false);
  if (width <= 0 || height <= 0 || placements.length === 0) {
    return { ...fallback, clear: true };
  }
  const boxes = placements.map(boxOf);
  const lowX = input.edge + width / 2;
  const highX = input.stageWidth - input.edge - width / 2;
  const touches = (x: number, top: number): boolean => boxes.some((box) => intersectionArea(
    { x: x - width / 2, y: top, width, height }, box,
  ) > 0);
  const shifted = (top: number): number | null => {
    // Every offset that puts the chip fully past one plate, and the smallest
    // of them that clears them all and stays inside the stage clamp.
    const options: number[] = [];
    for (const box of boxes) {
      options.push(box.x - width / 2 - centre, box.x + box.width + width / 2 - centre);
    }
    options.sort((a, b) => Math.abs(a) - Math.abs(b));
    for (const offset of options) {
      const x = centre + offset;
      if (x < lowX - 0.5 || x > highX + 0.5) continue;
      if (!touches(x, top)) return x;
    }
    return null;
  };
  if (belowFits && !touches(centre, belowTop)) {
    return at(centre, belowTop, 'below', true, true);
  }
  if (aboveFits && !touches(centre, aboveTop)) {
    return at(centre, aboveTop, 'above', belowFits === false, true);
  }
  if (belowFits) {
    const x = shifted(belowTop);
    if (x !== null) return at(x, belowTop, 'below-shifted', false, true);
  }
  if (aboveFits) {
    const x = shifted(aboveTop);
    if (x !== null) return at(x, aboveTop, 'above-shifted', false, true);
  }
  return fallback;
}

/** The chip measure a layout input carries. Every caller reserves exactly one
 * claim and that claim is the chip, so its size is read back off the claim
 * rather than duplicated in a second field that could disagree with it. */
function chipInputOf(input: ConstellationInput): ConstellationChipInput | null {
  const claim = (input.reserved ?? [])[0];
  if (!claim) return null;
  const chipWidth = claim.right - claim.left;
  const chipHeight = claim.bottom - claim.top;
  if (chipWidth <= 0 || chipHeight <= 0) return null;
  return {
    anchorX: input.anchorX, anchorY: input.anchorY,
    stageWidth: input.stageWidth, stageHeight: input.stageHeight,
    edge: input.edge, chipWidth, chipHeight,
  };
}

/**
 * The same input, with the chip moved out of the way of plates that are
 * already seated.
 *
 * Used by every path that re-validates HELD placements — the locked reuse, the
 * presentation re-anchor, and the hard-validity question the frame writer asks
 * before it keeps a stale picture. A fresh solve never comes through here: it
 * reserves the preferred position and seats its plates around it, which is
 * what keeps a first paint identical to the one before this rule existed.
 */
function heldChipInput(
  input: ConstellationInput,
  placements: readonly ConstellationPlacement[],
): { input: ConstellationInput; chip: ConstellationChipPlacement | null } {
  const measure = chipInputOf(input);
  if (!measure) return { input, chip: null };
  const chip = constellationChip(measure, placements);
  return {
    input: {
      ...input,
      reserved: [{
        left: chip.left, top: chip.top, right: chip.right, bottom: chip.bottom,
      }],
    },
    chip,
  };
}

export function constellationLayoutHardValid(
  input: ConstellationInput,
  layout: ConstellationLayout,
): boolean {
  const held = heldChipInput(input, layout.placements);
  return hardValid(held.input, layout.placements, CONSTELLATION_MIN_GAP_PX);
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
  request: ConstellationInput,
  layout: ConstellationLayout,
  previousAnchorX: number,
  previousAnchorY: number,
): ConstellationLayout | null {
  // These are held seats, so the chip yields to them exactly as it does on the
  // locked path: the claim this validates, routes around and masks is the
  // chip's relocated rectangle, not the one centred under a Cell that has
  // since drifted onto a plate.
  const held = heldChipInput(request, layout.placements);
  const input = held.input;
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
    const target = panelBoxes[placementIndex];
    const softObstacles = [
      ...panelBoxes.filter((_box, index) => index !== placementIndex),
      ...reserved,
      ...hud,
    ].map((box) => expanded(box, CONSTELLATION_ROUTE_CLEARANCE_PX));
    // Canonical routing leaves a twelve-pixel channel around prior segments
    // (four-pixel stroke box plus the eight-pixel route clearance).
    softObstacles.push(...outsideRoutes.flatMap((route) => route.map(([a, b]) => ({
      x: Math.min(a.x, b.x) - 12,
      y: Math.min(a.y, b.y) - 12,
      width: Math.abs(a.x - b.x) + 24,
      height: Math.abs(a.y - b.y) + 24,
    }))));
    const points = reanchorRoutePoints(old, {
      anchorX: input.anchorX,
      anchorY: input.anchorY,
      previousAnchorX,
      previousAnchorY,
      target,
      obstacles: softObstacles,
      exact: [target, reticle],
      bounds,
    });
    if (!points) return null;
    // ⚠️ CLIPPED AGAINST BOTH RINGS, THE CELL'S OLD ONE AND ITS NEW ONE.
    //
    // Near the reticle the eight outlets fan out and the leaders necessarily
    // cross each other's channels, which is why a route is an obstacle only
    // where it runs OUTSIDE the ring. Move the Cell two pixels and a segment
    // that was under the old ring is suddenly outside the new one, and a
    // neighbour's leader that never had to miss it is refused — measured
    // 2026-09-12: exactly one of the 648 two-pixel moves in the matrix, and it
    // would be every leader that leaves its outlet alongside another. A
    // segment that was inside the ring when it was drawn stays exempt.
    const outside = routeOutsideReticle(
      points, input.anchorX, input.anchorY, CONSTELLATION_RETICLE_PX / 2,
    ).flatMap(([a, b]) => routeOutsideReticle(
      [a, b], previousAnchorX, previousAnchorY, CONSTELLATION_RETICLE_PX / 2,
    ));
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
    ...(held.chip ? { chip: held.chip } : {}),
  };
}
/** Where each instrument stood when the reader last saw it, in the frame the
 * scorer is being asked about. Null when there is nothing to be continuous
 * with — a first selection, or a lock that holds a different set of
 * instruments than the one being solved for. */
type ContinuityReference = { [slot: string]: ConstellationPoint | undefined } | null;

/**
 * The seats a re-solve is asked to stay near, and the rule for where they are.
 *
 * Inside `CONSTELLATION_HOLD_RADIUS_PX` of the anchor the lock was solved at,
 * the reference is the held seat itself, so a Cell that drifts under the
 * reader's eye moves and its instruments do not. Beyond it the reference is
 * the held seat carried by the anchor's own delta, so the constellation steps
 * after the Cell as a group and arrives in the arrangement it left in. Only a
 * lock holding EXACTLY this slot set qualifies: a layout that gained or lost
 * an instrument is a new composition, not a moved one.
 */
function continuityReference(
  input: ConstellationInput,
  panels: readonly ConstellationPanel[],
): ContinuityReference {
  const lock = input.lock;
  if (!lock || lock.template === null) return null;
  let heldCount = 0;
  for (const slot of Object.keys(lock.placements)) {
    if (lock.placements[slot]) heldCount += 1;
  }
  if (heldCount !== panels.length) return null;
  if (!panels.every((panel) => lock.placements[panel.slot] !== undefined)) return null;
  const dx = input.anchorX - lock.anchorX;
  const dy = input.anchorY - lock.anchorY;
  const stepping = Math.hypot(dx, dy) > CONSTELLATION_HOLD_RADIUS_PX;
  const reference: { [slot: string]: ConstellationPoint | undefined } = {};
  for (const panel of panels) {
    const held = lock.placements[panel.slot] as ConstellationPlacement;
    reference[panel.slot] = stepping
      ? { x: held.x + dx, y: held.y + dy }
      : { x: held.x, y: held.y };
  }
  return reference;
}

function scoreCandidate(
  input: ConstellationInput,
  candidate: Candidate,
  reference: ContinuityReference,
): number {
  let score = 0;
  const hud = (input.obstacles ?? []).map(rectBox);
  for (const panel of candidate.placements) {
    score += Math.abs(panel.height - (input.panels.find((p) => p.slot === panel.slot)?.height ?? panel.height)) * 4;
    score += Math.hypot(panel.x + panel.width / 2 - input.anchorX,
      panel.y + panel.height / 2 - input.anchorY) * 0.08;
    for (const obstacle of hud) score += intersectionArea(boxOf(panel), obstacle) / 80;
    // Holding a seat is worth more than any composition preference, up to the
    // point where the seat is not the same seat any more. This replaces the
    // template hold bonus outright: a template is a family of arrangements,
    // and what the reader's eye holds on to is the plate, not the family.
    const held = reference?.[panel.slot];
    if (held) {
      score += Math.min(
        CONSTELLATION_CONTINUITY_CAP_PX,
        Math.hypot(panel.x - held.x, panel.y - held.y),
      ) * CONSTELLATION_CONTINUITY_PX_WEIGHT;
    }
  }
  const preference: Record<ConstellationTemplate, number> = {
    'split-left': 0, 'split-right': 1, 'expand-right': 2, 'expand-left': 3,
    'fold-above': 4, 'fold-below': 5, distributed: 6,
  };
  return score + preference[candidate.template] * 0.01;
}

/** Stable top-`ROUTE_CANDIDATE_CAP` selection, equivalent to
 * `filter().sort(score).slice(0, cap)`. Scoring each candidate once avoids
 * thousands of repeated score/map walks on a cold four-panel solve while
 * retaining generation order as the tie-break. Geometry enumeration stays
 * exhaustive; this is the gate on how many seat sets are ever ROUTED.
 *
 * It yields every 32 candidates because it is the longest unbroken stretch the
 * solve has: a four-plate bucket presents 271 seat sets and validating and
 * scoring all of them was measured at 7.4 ms in one generator step, which the
 * Canvas has no way to fit inside a frame. */
function* bestCandidatesSteps(
  input: ConstellationInput,
  candidates: readonly Candidate[],
  gap: number,
  reference: ContinuityReference,
): Generator<void, Candidate[]> {
  const best: Array<{ candidate: Candidate; score: number; ordinal: number }> = [];
  let dropped = false;
  for (let ordinal = 0; ordinal < candidates.length; ordinal += 1) {
    const candidate = candidates[ordinal];
    constellationWorkStats.candidatesValidated += 1;
    if ((ordinal & 31) === 31) yield;
    if (!hardValid(input, candidate.placements, gap)) continue;
    const entry = { candidate, score: scoreCandidate(input, candidate, reference), ordinal };
    let at = best.length;
    while (at > 0) {
      const prior = best[at - 1];
      if (prior.score < entry.score
        || (prior.score === entry.score && prior.ordinal < entry.ordinal)) break;
      at -= 1;
    }
    if (at >= ROUTE_CANDIDATE_CAP) { dropped = true; continue; }
    best.splice(at, 0, entry);
    if (best.length > ROUTE_CANDIDATE_CAP) { best.pop(); dropped = true; }
  }
  if (dropped) constellationWorkStats.routeCapHits += 1;
  return best.map(({ candidate }) => candidate);
}
const keyPart = (value: number) => Math.round(value * 2);
/**
 * Everything the layout question is made of EXCEPT how tall the instruments
 * are: the stage, the safe area, each instrument's slot and width, the rails,
 * and the chip's measure.
 *
 * Two requests with the same shape key and different geometry keys differ in
 * exactly one way — an instrument's content grew or shrank — which is the one
 * change `growInPlaceSeats` may answer without re-composing.
 */
function geometryShapeKey(
  input: ConstellationInput, panels: readonly ConstellationPanel[],
): string {
  let key = `${keyPart(input.stageWidth)},${keyPart(input.stageHeight)}`
    + `,${keyPart(input.safeTop)},${keyPart(input.edge)}`;
  for (const panel of panels) key += `|${panel.slot}:${keyPart(panel.width)}`;
  for (const rect of input.obstacles ?? []) {
    key += `|${keyPart(rect.left)},${keyPart(rect.top)},${keyPart(rect.right)},${keyPart(rect.bottom)}`;
  }
  for (const rect of input.reserved ?? []) {
    key += `|r${keyPart(rect.right - rect.left)},${keyPart(rect.bottom - rect.top)}`;
  }
  return key;
}
function geometryKey(input: ConstellationInput, panels: readonly ConstellationPanel[]): string {
  let key = geometryShapeKey(input, panels);
  for (const panel of panels) key += `|h${keyPart(panel.height)}`;
  return key;
}
/**
 * How far the enumeration keeps a plate from the Cell.
 *
 * `hardValid` accepts any plate more than the reticle's own clearance away —
 * 54 px — because that is the last line before a plate is standing ON the
 * Cell. Every composition the solver BUILDS keeps much more than that: the
 * keep-out field where the stage is wide enough for one, and the reticle
 * clearance otherwise, plus the gap. The difference matters to anything that
 * offers a seat back to the solver: a seat placed on the validity line is
 * broken again by the next pixel of drift, and the frame after that, which is
 * a re-solve every few frames and a plate that will not stand still. Measured
 * without this margin: 126 full solves over 240 drifting frames where three
 * had been enough.
 *
 * (`CONSTELLATION_FIELD_MIN_STAGE_PX` is the same threshold the three
 * candidate enumerators read; this is its fourth site.)
 */
function anchorKeepoutPx(input: ConstellationInput): number {
  return (input.stageWidth >= CONSTELLATION_FIELD_MIN_STAGE_PX
    ? constellationKeepoutPx(input.stageWidth, input.stageHeight)
    : CONSTELLATION_RETICLE_PX / 2 + CONSTELLATION_ROUTE_CLEARANCE_PX)
    + CONSTELLATION_MIN_GAP_PX;
}

/**
 * The shortest single-axis move that makes one box legal again, or null.
 *
 * "Legal" is the geometry half of `hardValid` for one plate: inside the stage,
 * off the Cell, and clear of everything given. The offsets considered are the
 * ones that put the box exactly past an edge of something it overlaps, which
 * is the complete set of minimal answers along either axis, so the first that
 * clears everything is the smallest there is.
 */
function slideToClear(
  box: Box,
  blockers: readonly Box[],
  input: ConstellationInput,
  axis: 'both' | 'y' = 'both',
): Box | null {
  const minX = input.edge; const minY = input.safeTop;
  const maxX = input.stageWidth - input.edge; const maxY = input.stageHeight - input.edge;
  const core = anchorKeepoutPx(input);
  const all: Box[] = [...blockers, {
    x: input.anchorX - core, y: input.anchorY - core, width: core * 2, height: core * 2,
  }];
  const fits = (moved: Box): boolean => moved.x >= minX - 0.5 && moved.y >= minY - 0.5
    && moved.x + moved.width <= maxX + 0.5 && moved.y + moved.height <= maxY + 0.5
    && all.every((other) => intersectionArea(moved, other) <= 0.25);
  if (fits(box)) return box;
  // `axis: 'y'` is the column question: a neighbour that has to get out of a
  // growing plate's way slides ALONG the column it shares with it, because a
  // sideways move there is not "the same arrangement, one plate further down",
  // it is a different composition.
  const sideways = axis === 'both';
  const options: Array<{ dx: number; dy: number }> = [];
  if (sideways) options.push(
    { dx: minX - box.x, dy: 0 }, { dx: maxX - box.width - box.x, dy: 0 },
  );
  options.push({ dx: 0, dy: minY - box.y }, { dx: 0, dy: maxY - box.height - box.y });
  for (const other of all) {
    if (sideways) {
      options.push({ dx: other.x - (box.x + box.width), dy: 0 });
      options.push({ dx: other.x + other.width - box.x, dy: 0 });
    }
    options.push({ dx: 0, dy: other.y - (box.y + box.height) });
    options.push({ dx: 0, dy: other.y + other.height - box.y });
  }
  options.sort((a, b) => (Math.abs(a.dx) + Math.abs(a.dy)) - (Math.abs(b.dx) + Math.abs(b.dy)));
  for (const option of options) {
    const moved = {
      x: box.x + option.dx, y: box.y + option.dy, width: box.width, height: box.height,
    };
    if (fits(moved)) return moved;
  }
  return null;
}

const GROW_COLUMN_GAP_PX = CONSTELLATION_MIN_GAP_PX;
const sharesGrowColumn = (a: Box, b: Box): boolean => (
  b.x - GROW_COLUMN_GAP_PX < a.x + a.width && b.x + b.width + GROW_COLUMN_GAP_PX > a.x
);
/**
 * How close to the Cell one plate's vertical span may come.
 *
 * `hardValid` measures the distance from the box to the anchor as a hypotenuse,
 * so a plate whose x-span is already further from the anchor than the reticle
 * clearance needs no vertical room at all, and one standing over the Cell needs
 * the whole of it.
 */
function cellVerticalClearance(input: ConstellationInput, box: Box): number {
  const core = CONSTELLATION_RETICLE_PX / 2 + CONSTELLATION_ROUTE_CLEARANCE_PX;
  const dx = Math.max(box.x - input.anchorX, input.anchorX - (box.x + box.width), 0);
  return dx >= core ? 0 : Math.sqrt(core * core - dx * dx);
}
/** The tallest this plate may be drawn keeping its TOP edge: down to the stage
 * edge, the top of the next plate in its column less the gap, or the Cell. */
function growRoomBelow(
  input: ConstellationInput, boxes: readonly Box[], index: number,
): number {
  const box = boxes[index];
  let limit = input.stageHeight - input.edge;
  // The Cell stops a plate only where the plate stands OVER it: a column well
  // to one side is already further from the anchor than the clearance and the
  // vertical room it needs is none.
  const clearance = cellVerticalClearance(input, box);
  if (clearance > 0 && box.y < input.anchorY) limit = Math.min(limit, input.anchorY - clearance);
  for (let other = 0; other < boxes.length; other += 1) {
    if (other === index || !sharesGrowColumn(box, boxes[other])) continue;
    if (boxes[other].y >= box.y + box.height - 0.5) {
      limit = Math.min(limit, boxes[other].y - GROW_COLUMN_GAP_PX);
    }
  }
  return limit - box.y;
}
/** The highest this plate's TOP edge may go keeping its bottom: the safe top,
 * the bottom of the plate above it in its column plus the gap, or the Cell. */
function growTopAbove(
  input: ConstellationInput, boxes: readonly Box[], index: number,
): number {
  const box = boxes[index];
  let limit = input.safeTop;
  const clearance = cellVerticalClearance(input, box);
  if (clearance > 0 && box.y + box.height > input.anchorY) {
    limit = Math.max(limit, input.anchorY + clearance);
  }
  for (let other = 0; other < boxes.length; other += 1) {
    if (other === index || !sharesGrowColumn(box, boxes[other])) continue;
    if (boxes[other].y + boxes[other].height <= box.y + 0.5) {
      limit = Math.max(limit, boxes[other].y + boxes[other].height + GROW_COLUMN_GAP_PX);
    }
  }
  return limit;
}

/**
 * The tallest one already-seated plate may be DRAWN at without overlapping
 * anything, keeping the top edge it has.
 *
 * The frame writer's answer to a measurement that arrives while a solve is
 * still running: the plate is given the height its content now asks for,
 * clamped to this, so the reader sees the new rows at once and nothing on the
 * stage is covered. It is the same room `growInPlaceSeats` grows into, which is
 * what makes the presentation and the answer behind it agree — a plate drawn
 * taller here than the solve will seat it would shrink back on landing.
 */
export function constellationHeldRoomPx(
  input: ConstellationInput,
  placements: readonly ConstellationPlacement[],
  index: number,
): number {
  return growRoomBelow(input, placements.map(boxOf), index);
}

/**
 * Extend the instruments that grew, where they stand.
 *
 * The one change a reader makes without asking for it: the register's scan
 * reveals another twenty rows, the reader loads its bytes, enrichment lands on
 * a bare Cell. Until 2026-09-12 any of those re-composed the whole
 * constellation around the new heights — F5 of the review measured the register
 * going x 760 -> 376 -> 1192 and top 666 -> 104 -> 468 as it grew from 400 to
 * 560 px, with the specimen and the reader travelling with it, every time,
 * while the reader was reading.
 *
 * So a height change is answered by moving as little as possible, in this order
 * for each instrument that changed:
 *
 *   1. shrink, or grow downward: the x and the TOP edge are kept and the plate
 *      extends toward its asked height, as far as the stage edge or the next
 *      plate below it less the gap allows. Growing downward is the only move
 *      that leaves the content the reader is looking at where it was.
 *   2. grow upward: if the room below cannot reach the asked height, the BOTTOM
 *      edge is kept and the plate extends up instead — but only if that reaches
 *      the asked height. Moving the top is worth it to stop an instrument
 *      scrolling; it is not worth it to scroll a little less.
 *   3. slide one neighbour: if a plate in the same column is what stands in the
 *      way, and moving it along the column by the smallest amount that clears
 *      lets the growth reach the asked height, it moves. One plate, once.
 *   4. stay, and scroll: the top and x are kept and the height takes whatever
 *      room is below it. The instrument caps, which is what `capped` has always
 *      meant — the plate scrolls and the fade marks the cut — and nothing on
 *      the stage moves.
 *
 * The answer must then pass `hardValid` against the chip RELOCATED for it
 * (`heldChipInput`), like every other held path; when it does not, the caller
 * falls through to the full solve, which carries the continuity term against
 * these same seats. The lock's anchor is deliberately not moved: these seats
 * were solved for that anchor and the Cell has not gone anywhere.
 */
function growInPlaceSeats(
  input: ConstellationInput,
  panels: readonly ConstellationPanel[],
  held: readonly ConstellationPlacement[],
): ConstellationPlacement[] | null {
  const gap = CONSTELLATION_MIN_GAP_PX;
  const boxes: Box[] = held.map((seat, index) => ({
    x: seat.x, y: seat.y, width: panels[index].width, height: seat.height,
  }));
  const roomBelow = (index: number): number => growRoomBelow(input, boxes, index);
  const topAbove = (index: number): number => growTopAbove(input, boxes, index);
  for (let index = 0; index < panels.length; index += 1) {
    const asked = panels[index].height;
    const box = boxes[index];
    if (asked <= box.height + 0.5) { box.height = asked; continue; }
    const down = roomBelow(index);
    if (asked <= down + 0.5) { box.height = asked; continue; }
    const bottom = box.y + box.height;
    if (bottom - asked >= topAbove(index) - 0.5) {
      box.y = bottom - asked; box.height = asked; continue;
    }
    // One neighbour, once, along the column. The plate it would have to be is
    // whichever one sets the limit that failed, below first because growing
    // down is the move that keeps the reader's place.
    const wanted: Box = { ...box, height: asked };
    let slid = false;
    for (const other of [...boxes.keys()].filter((candidate) => candidate !== index
      && sharesGrowColumn(box, boxes[candidate]))) {
      const blockers = boxes
        .filter((_seat, at) => at !== index && at !== other)
        .map((seat) => expanded(seat, gap))
        .concat(expanded(wanted, gap), (input.reserved ?? []).map(rectBox));
      const moved = slideToClear(boxes[other], blockers, input, 'y');
      if (!moved) continue;
      const before = boxes[other];
      boxes[other] = moved;
      if (asked <= roomBelow(index) + 0.5) { box.height = asked; slid = true; break; }
      const room = box.y + box.height - asked;
      if (room >= topAbove(index) - 0.5) {
        box.y = room; box.height = asked; slid = true; break;
      }
      boxes[other] = before;
    }
    if (slid) continue;
    // Nothing moves: the instrument takes the room it has and scrolls the rest.
    box.height = Math.max(box.height, Math.min(asked, down));
  }
  return panels.map((panel, index) => {
    const seat = placement(
      panel, boxes[index].height, boxes[index].x, boxes[index].y,
      input.anchorX, input.anchorY,
    );
    seat.quadrant = held[index].quadrant;
    return seat;
  });
}

/**
 * The three answers a re-solve already has.
 *
 * A full solve enumerates compositions from scratch, which is right for a
 * first selection and wrong for a Cell the reader has been reading: the seats
 * on screen are an answer, and they are the answer the eye is holding. So the
 * candidate set gains the picture that is up (verbatim), the same picture
 * carried by the Cell's own move (translated), and the same picture with each
 * plate that no longer fits slid the shortest distance along one axis that
 * makes it fit (repaired). They are candidates, not shortcuts: each one passes
 * `hardValid` at the current gap like every other, and each is scored like
 * every other — they simply start from where the reader left off.
 *
 * A lock over the same geometry qualifies, and so does one whose only
 * difference is a HEIGHT: an instrument whose content grew is still standing
 * where the reader left it, and a full solve that runs because grow-in-place
 * could not place it must still be able to hold on to those seats. Such a
 * candidate carries the ASKED height, clamped to the room between its held top
 * and the stage edge — the taller plate at the seat it already has — and it is
 * `capped` when the clamp bites, exactly as the enumerated arrangements are. A
 * stage or a rail that changed is a different question altogether and offers
 * nothing back.
 */
function heldCandidates(
  input: ConstellationInput,
  panels: readonly ConstellationPanel[],
  key: string,
): Candidate[] {
  const lock = input.lock;
  if (!lock || lock.template === null) return [];
  if (lock.geometryKey !== key && lock.shapeKey !== geometryShapeKey(input, panels)) return [];
  let heldCount = 0;
  for (const slot of Object.keys(lock.placements)) {
    if (lock.placements[slot]) heldCount += 1;
  }
  if (heldCount !== panels.length) return [];
  if (!panels.every((panel) => lock.placements[panel.slot] !== undefined)) return [];
  const held = panels.map((panel) => lock.placements[panel.slot] as ConstellationPlacement);
  // A seat offered back carries the height it was seated at, unless the
  // heights are what changed — then it carries what the instrument is now
  // asking for, clamped to the room between its held top and the stage edge.
  // Anything else would offer the solver a plate of a size nobody asked for.
  const grew = lock.geometryKey !== key;
  const heightAt = (index: number, y: number): number => (grew
    ? Math.min(panels[index].height, input.stageHeight - input.edge - y)
    : held[index].height);
  const seat = (index: number, x: number, y: number, keepQuadrant: boolean) => {
    const next = placement(
      panels[index], heightAt(index, y), x, y, input.anchorX, input.anchorY,
    );
    if (keepQuadrant) next.quadrant = held[index].quadrant;
    return next;
  };
  // A held seat is offered back only while it is still a seat this composition
  // would have CHOSEN — every plate outside the Cell's keep-out field, not
  // merely outside the line `hardValid` draws at the reticle's own clearance.
  // Without it the answer nearest the held seats is repeatedly the one that
  // has just barely stopped being illegal, and the constellation nudges after
  // the Cell every few frames instead of stepping after it once.
  const keepout = anchorKeepoutPx(input) - 0.5;
  const roomy = (placements: readonly ConstellationPlacement[]): boolean => placements.every(
    (panel) => nearestDistance(boxOf(panel), input.anchorX, input.anchorY) >= keepout,
  );
  const offer = (candidate: Candidate, into: Candidate[]) => {
    if (roomy(candidate.placements)) into.push(candidate);
  };
  const out: Candidate[] = [];
  offer({
    template: lock.template,
    placements: held.map((seated, index) => seat(index, seated.x, seated.y, true)),
  }, out);
  const dx = input.anchorX - lock.anchorX;
  const dy = input.anchorY - lock.anchorY;
  if (Math.hypot(dx, dy) > 0.5) {
    offer({
      template: lock.template,
      placements: held.map((seated, index) => seat(index, seated.x + dx, seated.y + dy, true)),
    }, out);
  }
  const reserved = (input.reserved ?? []).map(rectBox);
  const repaired: ConstellationPlacement[] = [];
  let anyMoved = false;
  for (let index = 0; index < held.length; index += 1) {
    // Each plate is repaired against its NEIGHBOURS AS THEY STAND, so the
    // answer is "this one plate moved" and never a cascade nobody asked for.
    const blockers = [
      ...held.filter((_seated, other) => other !== index)
        .map((seated) => expanded(boxOf(seated), CONSTELLATION_MIN_GAP_PX)),
      ...reserved,
    ];
    const slid = slideToClear(
      { ...boxOf(held[index]), height: heightAt(index, held[index].y) }, blockers, input,
    );
    if (!slid) return out;
    const moved = Math.abs(slid.x - held[index].x) > 0.5
      || Math.abs(slid.y - held[index].y) > 0.5;
    if (moved) anyMoved = true;
    repaired.push(seat(index, slid.x, slid.y, !moved));
  }
  if (anyMoved) offer({ template: lock.template, placements: repaired }, out);
  return out;
}

function* lockedLayoutSteps(
  input: ConstellationInput,
  withRoutes: boolean,
): Generator<void, ConstellationLayout | null> {
  const panels = orderedPanels(input.panels);
  const key = geometryKey(input, panels);
  const lock = input.lock;
  if (lock?.template !== null && lock !== undefined
    && Math.hypot(input.anchorX - lock.anchorX, input.anchorY - lock.anchorY)
      <= CONSTELLATION_HOLD_RADIUS_PX) {
    const previousSlots = Object.keys(lock.placements).filter((slot) => lock.placements[slot]);
    const sameSlots = panels.every((panel) => lock.placements[panel.slot] !== undefined)
      && panels.length === previousSlots.length;
    const removedOnly = panels.every((panel) => lock.placements[panel.slot] !== undefined)
      && panels.length < previousSlots.length;
    // Only the heights changed, and the instruments are the same ones. That is
    // the one question a growing plate asks, and it is answered by extending
    // the plate rather than by composing the stage again.
    const grewOnly = lock.geometryKey !== key && sameSlots
      && lock.shapeKey === geometryShapeKey(input, panels);
    if (lock.geometryKey === key || removedOnly || grewOnly) {
      const sameGeometry = lock.geometryKey === key;
      const heldSeats = panels.map(
        (panel) => lock.placements[panel.slot] as ConstellationPlacement,
      );
      const placements = grewOnly
        ? growInPlaceSeats(input, panels, heldSeats)
        : panels.map((panel, index) => {
          const seated = heldSeats[index];
          const next = placement(panel, sameGeometry ? seated.height : panel.height,
            seated.x, seated.y, input.anchorX, input.anchorY);
          next.quadrant = seated.quadrant;
          return next;
        });
      // The chip yields before the seats do. It is the one claim that moves
      // with the Cell, and a held plate is worth more than the chip's
      // preferred position: relocating it costs the reader a chip that stands
      // beside the Cell instead of under it, where breaking the lock costs
      // them the whole constellation jumping. Only when no listed position is
      // clear does this fall through to the full solve.
      const held = placements === null ? null : heldChipInput(input, placements);
      if (placements !== null && held !== null
        && hardValid(held.input, placements, CONSTELLATION_MIN_GAP_PX)) {
        // Route reuse and the fast two-leg pass, and nothing else. This runs
        // inside a pointer interaction on a Cell the reader is already looking
        // at: a plate whose held line no longer reaches it takes the fallback
        // leader for this frame rather than spending a grid search, and the
        // canonical solve behind it will hand back the real route.
        const routed = withRoutes
          ? yield* addRoutesSteps(held.input, placements, {
            fastOnly: true,
            held: {
              routes: lock.routes,
              anchorX: lock.routeAnchorX,
              anchorY: lock.routeAnchorY,
            },
          })
          : null;
        constellationWorkStats.lockedReuses += 1;
        constellationWorkStats.degradedRoutes += routed?.degraded ?? 0;
        if (routed) {
          // What this landing proved is what the next frame carries. The seats
          // keep the anchor their composition was chosen at — that is what the
          // 160 px hold radius and the continuity reference are measured from —
          // and the lines keep this one, so a frame's carry is the half pixel
          // the Cell moved rather than everything it has moved since.
          //
          // A plate that took the fallback holds nothing: a degraded leader is
          // a pure function of the anchor and the plate, rebuilt and never
          // reused, and leaving a stale line in the lock would ask the next
          // frame to carry a line the reader is not being shown.
          lock.routeAnchorX = input.anchorX;
          lock.routeAnchorY = input.anchorY;
          for (const panel of placements) {
            if (panel.route && !panel.route.degraded) {
              lock.routes[panel.slot] = panel.route.points;
            } else delete lock.routes[panel.slot];
          }
        }
        if (grewOnly) {
          // The lock now holds the grown seats at the SAME anchor: the plates
          // answer a new question and the Cell has not moved. The lines were
          // re-proven against the grown boxes just above, and one that no
          // longer reaches its plate degraded for this frame and is taken back
          // by the refinement behind it.
          lock.geometryKey = key;
          for (const panel of placements) {
            lock.placements[panel.slot] = { ...panel, route: undefined };
            lock.quadrant[panel.slot] = panel.quadrant;
          }
        }
        return {
          status: placements.some((panel) => panel.capped) ? 'compressed' : 'normal',
          template: lock.template,
          placements,
          masks: routed?.masks ?? [],
          leaders: (routed?.degraded ?? 0) > 0 ? 'degraded' : 'clean',
          ...(held.chip ? { chip: held.chip } : {}),
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
  // What the reader is already looking at, and where the scorer is asked to
  // keep it. Null on a first selection and whenever the lock holds a different
  // set of instruments, which is why the matrix and the oracle — neither of
  // which locks — are solved exactly as they were before this existed.
  const reference = continuityReference(input, panels);
  const alreadySeated = heldCandidates(input, panels, key);
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
  for (const squeeze of CONSTELLATION_SQUEEZE_LEVELS) {
    let seatedAtThisSqueeze = false;
    for (const gap of [CONSTELLATION_PREFERRED_GAP_PX, CONSTELLATION_MIN_GAP_PX]) {
      const candidates: Candidate[] = [];
      // Held seats are offered first and at the asked heights only: if nothing
      // fits at this squeeze, the composition has to change and holding a seat
      // is no longer the question. They lead the list so a tie with a freshly
      // enumerated arrangement is settled in favour of standing still.
      if (squeeze.ratio === 1) candidates.push(...alreadySeated);
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
      const feasible = yield* bestCandidatesSteps(input, candidates, gap, reference);
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
  // A fresh solve reserved the preferred position and seated its plates around
  // it, so that is where the chip stands. Relocation is the locked path's
  // business, and a composition that has just been chosen has no held plate to
  // yield to.
  const measure = chipInputOf(input);
  const chip = measure ? constellationChip(measure, []) : null;
  if (!best) {
    return {
      status: 'unavailable', template: null, placements: [], masks: [], leaders: 'clean',
      ...(chip ? { chip } : {}),
    };
  }
  const result: ConstellationLayout = {
    status: best.placements.some((panel) => panel.capped) ? 'compressed' : 'normal',
    template: best.template, placements: best.placements, masks: bestMasks,
    leaders: bestDegraded > 0 ? 'degraded' : 'clean',
    ...(chip ? { chip } : {}),
  };
  constellationWorkStats.degradedRoutes += bestDegraded;
  if (input.lock) {
    input.lock.template = best.template; input.lock.geometryKey = key;
    input.lock.shapeKey = geometryShapeKey(input, panels);
    input.lock.anchorX = input.anchorX; input.lock.anchorY = input.anchorY;
    input.lock.routeAnchorX = input.anchorX; input.lock.routeAnchorY = input.anchorY;
    for (const slot of Object.keys(input.lock.placements)) delete input.lock.placements[slot];
    for (const slot of Object.keys(input.lock.routes)) delete input.lock.routes[slot];
    for (const panel of best.placements) {
      input.lock.placements[panel.slot] = { ...panel, route: undefined };
      input.lock.quadrant[panel.slot] = panel.quadrant;
      // A fallback leader is not a route the locked path may carry: it is a
      // pure function of the anchor and the plate and is rebuilt, not reused.
      if (panel.route && !panel.route.degraded) {
        input.lock.routes[panel.slot] = panel.route.points;
      }
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

/**
 * Look again for the lines first paint could not afford to find.
 *
 * A refinement takes a landed layout and re-routes its plates AT THE SEATS
 * THEY ALREADY OCCUPY, with the `refine` effort: every route order, forty-one
 * grid pairs a plate, one shared point budget. It never enumerates a candidate,
 * never moves a seat, never changes a height and never withdraws an instrument
 * — the geometry on screen is the geometry it routes. It returns a layout with
 * the same placements and strictly fewer fallback leaders, or `null` when it
 * could not do better than the picture it was given, which is the ordinary
 * answer and costs the caller nothing to ignore.
 *
 * `constellationWorkStats.degradedRoutes` is deliberately NOT adjusted here:
 * it counts fallback leaders that reached the reader, and these did. What a
 * refinement took back is `refineUpgrades`.
 */
export function* refineConstellationRoutesCursor(
  input: ConstellationInput,
  layout: ConstellationLayout,
): Generator<void, ConstellationLayout | null> {
  const degradedBefore = layout.placements.filter(
    (panel) => panel.route?.degraded === true,
  ).length;
  if (degradedBefore === 0) return null;
  if (layout.placements.length !== input.panels.length) return null;
  for (const panel of input.panels) {
    if (!layout.placements.some((seat) => seat.slot === panel.slot)) return null;
  }
  const placements = layout.placements.map((seat) => ({ ...seat, route: undefined }));
  const routed = yield* addRoutesSteps(input, placements, { effort: 'refine' });
  if (routed.degraded >= degradedBefore) return null;
  return {
    status: layout.status,
    template: layout.template,
    placements,
    masks: routed.masks,
    leaders: routed.degraded > 0 ? 'degraded' : 'clean',
  };
}

/** The refinement drained in one go, for tests and non-frame callers. */
export function refineConstellationRoutes(
  input: ConstellationInput,
  layout: ConstellationLayout,
): ConstellationLayout | null {
  const steps = refineConstellationRoutesCursor(input, layout);
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
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
