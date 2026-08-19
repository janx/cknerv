// Bridge edges — the 次级神经, and the only stroke in this scene that speaks
// two registers.
//
// ## Why a mixed stroke is legitimate at all (user ruling, 2026-08-19)
//
// The core is ACTUAL language: one mark IS one Cell, one stroke IS one
// proximity relation between two named Cells. The halo is SYMBOLIC language:
// one mark stands for roughly fourteen unresolved Cells, one stroke for
// unresolved connections in aggregate. An edge with one end on a Cell and one
// end in the halo is therefore not a false claim about two individuals — it
// is a symbol in the mixed register: "this real Cell adjoins, and is
// continuous with, the unresolved mass." That is aggregate-true, carries
// exactly the halo's own truth status, and is precisely the 连续过渡 the
// transition band exists to express. The earlier blanket ban in
// `populationFieldPlacement.ts` is superseded; see that file's header for the
// invariants that replaced it.
//
// ## What keeps it honest is HOW it is drawn, not whether
//
//   1. The ACTUAL end may speak fabric: a knot, the fabric's width class, the
//      host's lifecycle.
//   2. The SYMBOLIC end must stay in halo idiom — matte, thin, fading into
//      the mass, singling out no individual. No endpoint emphasis of any kind
//      there: a halo point must never look like a node with edges radiating
//      from it, which is also why one host's several bridges are forced apart
//      ({@link BRIDGE_ANCHOR_SEPARATION}) instead of converging on one point.
//   3. **No actual-register SYSTEM may traverse a bridge.** Bridges are
//      render-only. They are absent from the routing/neighbour graph
//      (`pathRouter` — a pulse must never route into the halo), from pulse
//      planning, from reinforcement and warm routes, from the inspection
//      field, from recall/memory traces, and from picking (the layer's mesh
//      answers no raycast and is not in `ScreenSpaceHitIndex`). This module
//      is a leaf: it produces a render list and nothing consumes it but the
//      layer that draws it.
//
// ## What this module is
//
// A pure function of (staged Cells, the halo's placed buffers). No three, no
// React, no clock — the layer around it is Canvas-bound and untestable, so
// every decision that can be made here is made here.
//
// Two invariants the tests pin:
//
//   * **Anchor prefix.** The lowest quality preset draws only the first
//     `populationCapMul = 0.25` of the placed points, so a bridge whose far
//     end sits past that prefix would dangle into nothing the moment the
//     cascade steps down. Every anchor index is therefore below
//     `floor(count * BRIDGE_ANCHOR_PREFIX)`. The walk scatters early indices
//     across the whole field — it seeds filaments by rejection sampling
//     against the density law rather than sweeping — so this costs coverage
//     nowhere.
//   * **Determinism.** A living Cell's bridges are a pure function of its id
//     and the halo buffers, so they never move frame to frame. Churn only
//     adds and removes hosts. Every ordering in here is total (no reliance on
//     Map iteration order), and the one place population size can displace an
//     existing host is the global budget's cut line, which is a host removal
//     and retracts through the ordinary lifecycle.
//
// ⚠️ Cell ids span BOTH the sequential-small range and the 2^52 range that
// galaxy composition mints. Nothing here packs an id into 32 bits: identity
// stays a `number`, and the only hash of an id goes through its decimal
// string (`fnv1a`), where a collision can reorder two candidates but can
// never merge two Cells.

import { fnv1a } from './edgeBezier';
import {
  POPULATION_FIELD_COMPLEMENT_KNEE,
  populationSegmentsForPointPrefix,
} from './populationFieldPlacement';
import { tissueSampleAt } from '../helix';

/**
 * Share of the placed point buffer a bridge may anchor in.
 *
 * Exactly the lowest quality preset's `populationCapMul` (see
 * `tweaks/qualityPresets.ts`). The preset trims the halo by DRAW RANGE over
 * the full buffer, so an anchor past this prefix is drawn at `high` and gone
 * at `low` — a stroke ending in empty space at the one moment the machine is
 * already struggling. Bound to the preset rather than restated: if the floor
 * preset ever draws less, this has to follow it down.
 */
export const BRIDGE_ANCHOR_PREFIX = 0.25;

/**
 * How far a bridge may reach for its anchor, in world units.
 *
 * Bridges are local hand-offs, not spokes. The fabric's own strokes run
 * 2.19 wu at the median and 4.05 at p90 (measured post-k-NN-fix), so this
 * sits just past the fabric's p90: a bridge is allowed to be a long fabric
 * edge and no longer. Anything further and the stroke stops reading as tissue
 * continuing and starts reading as a cable thrown at the halo.
 */
export const BRIDGE_ANCHOR_REACH = 5;

/**
 * Highest drawn-fabric degree a Cell may have and still be a host.
 *
 * The complaint that opened this line of work was rim Cells standing
 * nerve-less. The passive selection is a fixed 8,000-edge SCREEN budget over
 * up to 12,000 staged Cells, so a large share of the field carries no drawn
 * fibre at all — those are the Cells a bridge is for. Degree is counted in
 * the DRAWN passive graph, not the full k-NN graph: a Cell whose neighbours
 * exist but were never selected looks exactly as bare as one with no
 * neighbours, and the eye is what this fixes.
 */
export const BRIDGE_MAX_HOST_DEGREE = 2;

/**
 * Coverage above which a Cell may not host.
 *
 * `populationComplementAcceptance` reaches zero at `2 × KNEE`: past that the
 * halo places nothing, because the addressable Cells already occupy the
 * tissue. A bridge from there would have to reach across exactly the ground
 * the complement cleared. Derived from the complement rather than restated,
 * and deliberately NOT a radius — the thing worth defending is Cells, not a
 * circle.
 */
export const BRIDGE_HOST_COVERAGE_CEILING =
  2 * POPULATION_FIELD_COMPLEMENT_KNEE;

/**
 * Component sizes, in placed points, that sort an anchor into a strand, a
 * thread, or dust.
 *
 * A bridge should merge INTO a filament, not land on a fragment. Component
 * sizes are measured over the anchor prefix's own segments, so the number is
 * what survives at EVERY preset — at `high` a component can only be larger.
 * The dust floor matches the halo's own (`components ≥ 8`, the guard the
 * placement's run-length work is bounded by); the strand tier is the measured
 * median component size of the prefix.
 *
 * ⭐ Re-measured after the halo's tissue-keyed length and fork ramps, which
 * shorten the outer bands' filaments and fork them harder: the prefix's median
 * component is **still exactly 21** (its mean fell 27.7 -> 27.2). The ramps
 * redistribute the tail rather than the middle, so this tier did not have to
 * move — and it was checked rather than assumed, because a stale tier boundary
 * would silently re-rank every anchor in the field.
 */
export const BRIDGE_DUST_COMPONENT = 8;
export const BRIDGE_STRAND_COMPONENT = 21;

/**
 * Minimum spacing between two anchors of the SAME host, in world units.
 *
 * Without it a host's two or three bridges converge on whichever point is
 * nearest, and a halo point with three strokes radiating from it is exactly
 * the lit junction the symbolic register is not allowed to have. Half the
 * reach: far enough that the strokes fan, near enough that a sparse
 * neighbourhood still fills its quota.
 */
export const BRIDGE_ANCHOR_SEPARATION = BRIDGE_ANCHOR_REACH * 0.5;

/**
 * How many of a host's ranked anchor candidates it may draw from.
 *
 * ⚠️ MEASURED, and the reason this exists: taking the nearest qualifying
 * anchor puts NINE strokes on one halo point, because bare Cells cluster and
 * they all agree on which point is nearest. 1,500 bridges landed on 832
 * distinct anchors. That is precisely the lit junction the symbolic register
 * forbids — worse than the fabric's, since a fabric junction at least IS a
 * Cell.
 *
 * The fix has to stay a pure function of one Cell: a global "anchor already
 * taken" set would make an existing bridge re-target whenever some other Cell
 * elsewhere is born or dies, which is exactly the frame-to-frame wobble this
 * class must not have. So each host rotates into its own ranked pool by a
 * hash of its id. Cells that agree on the ranking disagree on the entry
 * point, and nothing crosses between hosts.
 *
 * The pool is the host's BEST-TIER candidates (widened only when that tier
 * cannot fill the host's quota), so the rotation decides among anchors that
 * are already equally good and the strand preference survives it — a pool cut
 * by rank alone hands the rotation dust and thread candidates as readily as
 * strand ones, which measured as no strand preference at all.
 *
 * The rotation alone still left eight strokes on one point at the tail, so it
 * is only half the answer; {@link BRIDGE_LANDING_MIN} is the other half.
 *
 * ⚠️ The MINIMUM is the part that is not obvious. A best tier of two or three
 * candidates gives the rotation nothing to rotate through, and those thin
 * neighbourhoods are exactly where bare Cells clump. Measured over the real
 * placement and a 12,000-Cell stage: without the minimum, 6.3% of strokes
 * land on dust and the worst convergence is 9 landings inside 0.25 wu; with
 * it, 11.3% and 7. The convergence is a doctrinal ceiling and the dust share
 * is a preference — the preference gives way, and 11.3% is still 1.7x better
 * than the prefix's own 19.3% baseline.
 *
 * ⚠️ Re-measured after the halo's tissue-keyed length and fork ramps, one
 * recipe throughout (12,000 staged Cells, all degree 0): without the minimum
 * 5.8% -> **4.4%** on dust at a worst convergence of 9 -> 7; with it, 10.8% ->
 * **9.4%** at 6 -> 6, against a prefix baseline of 19.3% -> 19.4%. Every arm
 * improved and the trade the constant makes is unchanged in shape. The gain is
 * the halo's, not this module's: shorter, bushier outer filaments give the
 * ranking more distinct non-dust components to choose between near each host.
 */
export const BRIDGE_ANCHOR_POOL = 32;
export const BRIDGE_ANCHOR_POOL_MIN = 8;

/**
 * Where along the anchor's own fibre a bridge actually ends.
 *
 * A bridge does not terminate AT a placed halo point. It terminates part-way
 * along one of that point's segments, at a parameter drawn from the host's
 * id. Two reasons, and the first is structural rather than aesthetic:
 *
 *   1. **"A halo point must never look like a node with edges radiating from
 *      it."** Terminating on points measured EIGHT strokes converging on one
 *      point even after the pool rotation, because bare Cells cluster and a
 *      thin neighbourhood offers few good anchors. Landing part-way along a
 *      segment turns a discrete set of ~26K possible endings into a
 *      continuum: two hosts that agree on the fibre still land apart, and no
 *      halo VERTEX is ever an endpoint at all.
 *   2. It is what "merges into a strand" literally means. The stroke ends on
 *      the fibre, mid-run, where the halo has no endpoint convention to
 *      violate.
 *
 * Kept off both ends of the segment so the landing can never drift back onto
 * a vertex through float error or through a short segment.
 */
export const BRIDGE_LANDING_MIN = 0.2;
export const BRIDGE_LANDING_MAX = 0.8;

/**
 * Global bridge budget, and the allocation it is drawn from.
 *
 * The class owns its allocation and does not borrow from
 * `NERVE_SCREEN_BUDGET`: 1,600 live bridges × 4 Bezier samples = 6,400
 * capsule segments in ONE draw call, against the passive fabric's 8,000
 * edges × 4 = 32,000. The layer allocates 2,000 bridges' worth so retracting
 * strokes have somewhere to live during churn; past that the emit clips
 * dying strokes, never live ones — the fabric's own rule.
 */
export const BRIDGE_BUDGET = 1_600;
export const BRIDGE_ALLOCATION_BRIDGES = 2_000;

/**
 * Share of the budget spent on BREADTH before any host gets a second stroke.
 *
 * ⚠️ MEASURED: at 12,000 staged Cells the fixed 8,000-edge screen budget
 * leaves 3,651 Cells (30% of the field) with no drawn fibre at all — that is
 * the composition working as designed, not a defect, and it is far more bare
 * Cells than any bridge budget can arborise. Spending the whole budget at
 * three strokes a host reaches 533 of them; one stroke first reaches 960 and
 * still leaves 640 strokes to arborise the barest (measured: 613 hosts at one
 * stroke, 54 at two, 293 at three). The 次级神经 is a plexus,
 * not a felt, and breadth is what the "Cells standing nerve-less" complaint
 * was actually about.
 */
export const BRIDGE_BREADTH_SHARE = 0.6;

/** How many bridges one host gets, by its drawn-fabric degree. A Cell with no
 *  fibre at all is the case this class exists for and gets the most; a Cell
 *  that already has two gets one, as a continuation rather than a substitute.
 *
 *  ⚠️ This is a CEILING the budget fills from the top, not a promise. The
 *  k-th bridge of a host is a pure function of (cell id, halo buffers, k), so
 *  a budget that reaches fewer k's draws a prefix of the same set — it never
 *  re-targets a stroke that is already on screen. */
export function bridgesForDegree(degree: number): number {
  if (degree <= 0) return 3;
  if (degree === 1) return 2;
  return 1;
}

/** One staged Cell, as this module needs it. Position is galaxy-local — the
 *  same frame the halo is placed in and the same rotating group both are
 *  drawn in, so no transform is involved anywhere in this file. */
export interface BridgeHostCell {
  id: number;
  x: number;
  y: number;
  z: number;
  /** Degree in the DRAWN passive fabric graph. */
  degree: number;
}

/** The halo's placed buffers, read-only. This module never writes them and
 *  never asks the placement for anything extra: filament identity is
 *  RE-DERIVED here by union-find rather than exported from the worker, so the
 *  halo's one-shot pass, its payload and its prefix invariant are untouched. */
export interface BridgeAnchorField {
  positions: Float32Array;
  weights: Float32Array;
  segments: Uint32Array;
  count: number;
  segmentCount: number;
}

/** One drawn bridge. `from` is the actual end (the Cell), `to` the symbolic
 *  end — a point part-way along one of the anchor's fibres, never the anchor
 *  vertex itself. `(cellId, anchorIndex)` is the record's identity. */
export interface BridgeEdge {
  cellId: number;
  fromX: number;
  fromY: number;
  fromZ: number;
  /** The placed halo point that identified this landing. Always below the
   *  index's prefix limit; so is the segment's other endpoint. */
  anchorIndex: number;
  /** The anchor's incident fibre the landing sits on, as an index into the
   *  placement's segment buffer, or -1 when the anchor had none and the
   *  landing fell back to the vertex. */
  anchorSegment: number;
  toX: number;
  toY: number;
  toZ: number;
  /** The placement taper weight AT the landing (interpolated along the
   *  fibre), so the stroke can end at the local fibre brightness instead of
   *  at a constant. */
  anchorWeight: number;
  /** Size of the anchor's filament component within the anchor prefix. */
  componentSize: number;
}

export interface BridgeSelection {
  bridges: BridgeEdge[];
  /** Cells that received at least one bridge. */
  hosts: number;
  /** Cells that passed the degree + coverage gates — the population the
   *  budget is rationing. Counted in full; the anchor search stops at the
   *  budget, so this is deliberately NOT "cells with halo in reach". */
  considered: number;
}

/**
 * The anchor side, prepared once per halo placement.
 *
 * The halo buffers are written once and never touched again, so everything
 * that depends only on them — the prefix bound, filament components, the
 * spatial grid — is computed once here and reused by every rebuild. Building
 * it per topology build would pay a union-find over 26K points and a grid
 * fill on every block.
 */
export interface BridgeAnchorIndex {
  field: BridgeAnchorField;
  /** Exclusive upper bound on a legal anchor index. */
  limit: number;
  /** Segments of the placement whose BOTH endpoints are below `limit` — the
   *  fibres drawn at every quality preset, and the only ones a bridge may
   *  land on. */
  prefixSegments: number;
  /** Component size for each anchor in `[0, limit)`. */
  componentSize: Int32Array;
  /** CSR: anchor → the prefix segments incident to it. */
  incidentStart: Int32Array;
  incidentSegments: Int32Array;
  cellSize: number;
  minX: number;
  minZ: number;
  cols: number;
  rows: number;
  /** CSR-style bucket layout over the anchor prefix. */
  bucketStart: Int32Array;
  bucketItems: Int32Array;
}

const EMPTY_INDEX_ARRAY = new Int32Array(0);

/** Union-find over the anchor prefix's own segments. Path-halving find, union
 *  by size; the roots' sizes become each member's component size. */
function componentSizesForPrefix(
  field: BridgeAnchorField,
  limit: number,
  prefixSegments: number,
): Int32Array {
  const parent = new Int32Array(limit);
  const size = new Int32Array(limit);
  for (let i = 0; i < limit; i += 1) {
    parent[i] = i;
    size[i] = 1;
  }
  const find = (start: number): number => {
    let node = start;
    while (parent[node] !== node) {
      parent[node] = parent[parent[node]];
      node = parent[node];
    }
    return node;
  };
  for (let s = 0; s < prefixSegments; s += 1) {
    const a = field.segments[s * 2];
    const b = field.segments[s * 2 + 1];
    if (a >= limit || b >= limit) continue;
    const rootA = find(a);
    const rootB = find(b);
    if (rootA === rootB) continue;
    const [big, small] = size[rootA] >= size[rootB]
      ? [rootA, rootB]
      : [rootB, rootA];
    parent[small] = big;
    size[big] += size[small];
  }
  const out = new Int32Array(limit);
  for (let i = 0; i < limit; i += 1) out[i] = size[find(i)];
  return out;
}

/** CSR of point → incident prefix segments. Two passes, no per-point array. */
function incidentSegmentsForPrefix(
  field: BridgeAnchorField,
  limit: number,
  prefixSegments: number,
): { incidentStart: Int32Array; incidentSegments: Int32Array } {
  const incidentStart = new Int32Array(limit + 1);
  for (let s = 0; s < prefixSegments; s += 1) {
    const a = field.segments[s * 2];
    const b = field.segments[s * 2 + 1];
    if (a >= limit || b >= limit) continue;
    incidentStart[a + 1] += 1;
    incidentStart[b + 1] += 1;
  }
  for (let i = 0; i < limit; i += 1) {
    incidentStart[i + 1] += incidentStart[i];
  }
  const cursor = incidentStart.slice(0, limit);
  const incidentSegments = new Int32Array(incidentStart[limit]);
  for (let s = 0; s < prefixSegments; s += 1) {
    const a = field.segments[s * 2];
    const b = field.segments[s * 2 + 1];
    if (a >= limit || b >= limit) continue;
    incidentSegments[cursor[a]] = s;
    cursor[a] += 1;
    incidentSegments[cursor[b]] = s;
    cursor[b] += 1;
  }
  return { incidentStart, incidentSegments };
}

/** Prepare the anchor side. Pure in `field`. */
export function buildBridgeAnchorIndex(
  field: BridgeAnchorField,
  anchorPrefix: number = BRIDGE_ANCHOR_PREFIX,
): BridgeAnchorIndex {
  const limit = Math.max(0, Math.min(
    field.count,
    Math.floor(field.count * anchorPrefix),
  ));
  if (limit === 0) {
    return {
      field,
      limit: 0,
      prefixSegments: 0,
      componentSize: EMPTY_INDEX_ARRAY,
      incidentStart: EMPTY_INDEX_ARRAY,
      incidentSegments: EMPTY_INDEX_ARRAY,
      cellSize: BRIDGE_ANCHOR_REACH,
      minX: 0,
      minZ: 0,
      cols: 0,
      rows: 0,
      bucketStart: EMPTY_INDEX_ARRAY,
      bucketItems: EMPTY_INDEX_ARRAY,
    };
  }

  // Every segment in this prefix has BOTH endpoints below `limit` — the
  // larger index of a segment is the newest point at the moment it was
  // written, which is what makes `populationSegmentsForPointPrefix` a binary
  // search in the first place, and what makes these exactly the fibres the
  // lowest preset still draws.
  const prefixSegments = populationSegmentsForPointPrefix(
    field.segments,
    field.segmentCount,
    limit,
  );
  const componentSize = componentSizesForPrefix(field, limit, prefixSegments);
  const incident = incidentSegmentsForPrefix(field, limit, prefixSegments);

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < limit; i += 1) {
    const x = field.positions[i * 3];
    const z = field.positions[i * 3 + 2];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  // One bucket per reach, so a query is exactly the 3x3 neighbourhood.
  const cellSize = BRIDGE_ANCHOR_REACH;
  const cols = Math.max(1, Math.floor((maxX - minX) / cellSize) + 1);
  const rows = Math.max(1, Math.floor((maxZ - minZ) / cellSize) + 1);
  const buckets = cols * rows;
  const bucketStart = new Int32Array(buckets + 1);
  const bucketOf = (i: number): number => {
    const col = Math.min(
      cols - 1,
      Math.max(0, Math.floor((field.positions[i * 3] - minX) / cellSize)),
    );
    const row = Math.min(
      rows - 1,
      Math.max(0, Math.floor((field.positions[i * 3 + 2] - minZ) / cellSize)),
    );
    return row * cols + col;
  };
  for (let i = 0; i < limit; i += 1) bucketStart[bucketOf(i) + 1] += 1;
  for (let b = 0; b < buckets; b += 1) bucketStart[b + 1] += bucketStart[b];
  const cursor = bucketStart.slice(0, buckets);
  const bucketItems = new Int32Array(limit);
  for (let i = 0; i < limit; i += 1) {
    const b = bucketOf(i);
    bucketItems[cursor[b]] = i;
    cursor[b] += 1;
  }

  return {
    field,
    limit,
    prefixSegments,
    componentSize,
    incidentStart: incident.incidentStart,
    incidentSegments: incident.incidentSegments,
    cellSize,
    minX,
    minZ,
    cols,
    rows,
    bucketStart,
    bucketItems,
  };
}

/** Strand / thread / dust, low is better. Expresses "prefer longer filaments"
 *  as a rank rather than as a score with mixed units. */
function componentTier(size: number): number {
  if (size >= BRIDGE_STRAND_COMPONENT) return 0;
  if (size >= BRIDGE_DUST_COMPONENT) return 1;
  return 2;
}

/** One halo point a host could reach, as ranked. Exported only so
 *  {@link planHostBridges} can take a caller-owned scratch array. */
export interface AnchorCandidate {
  index: number;
  distanceSq: number;
  tier: number;
}

function collectAnchorCandidates(
  index: BridgeAnchorIndex,
  x: number,
  z: number,
  reach: number,
  out: AnchorCandidate[],
): void {
  out.length = 0;
  if (index.limit === 0) return;
  const reachSq = reach * reach;
  const col = Math.floor((x - index.minX) / index.cellSize);
  const row = Math.floor((z - index.minZ) / index.cellSize);
  for (let r = row - 1; r <= row + 1; r += 1) {
    if (r < 0 || r >= index.rows) continue;
    for (let c = col - 1; c <= col + 1; c += 1) {
      if (c < 0 || c >= index.cols) continue;
      const bucket = r * index.cols + c;
      const start = index.bucketStart[bucket];
      const end = index.bucketStart[bucket + 1];
      for (let slot = start; slot < end; slot += 1) {
        const point = index.bucketItems[slot];
        const dx = index.field.positions[point * 3] - x;
        const dz = index.field.positions[point * 3 + 2] - z;
        const distanceSq = dx * dx + dz * dz;
        if (distanceSq > reachSq) continue;
        out.push({
          index: point,
          distanceSq,
          tier: componentTier(index.componentSize[point]),
        });
      }
    }
  }
  // Total order: strand before dust, then nearest, then the placement's own
  // index. No two candidates compare equal, so the result cannot depend on
  // the bucket walk that produced them.
  out.sort((a, b) => (
    a.tier - b.tier
    || a.distanceSq - b.distanceSq
    || a.index - b.index
  ));
}

interface HostCandidate {
  cell: BridgeHostCell;
  order: number;
}

export interface BridgeSelectionOptions {
  budget?: number;
  reach?: number;
  maxHostDegree?: number;
  coverageCeiling?: number;
  breadthShare?: number;
  /** Cell id → `resolvedCoverage`, reused across rebuilds. `tissueSampleAt`
   *  is ~1.1 µs and a Cell's position never moves, so the caller keeps this
   *  for the Cell's lifetime and the whole selection stays off the frame. */
  coverageCache?: Map<number, number>;
  /** Cell id → its planned bridges, valid while its degree is unchanged.
   *  A host's plan depends on nothing but (id, position, degree, halo), and
   *  ordinary block churn moves a small minority of degrees — measured, this
   *  turns a 19 ms rebuild into a 2 ms one. Invalidate by discarding the map
   *  whenever the anchor index is rebuilt. */
  planCache?: Map<number, BridgeHostPlan>;
}

export interface BridgeHostPlan {
  degree: number;
  picks: BridgeEdge[];
}

/** `resolvedCoverage` at a Cell — how much of the tissue there the addressable
 *  Cells already occupy. Memoised through the caller's cache when supplied.
 *
 *  The default envelope edge, deliberately: `resolvedCoverage` is the density
 *  under `TISSUE_ENVELOPE_EDGE` whatever edge the caller asks for, so naming
 *  the halo's 1.6 here would suggest a dependence that does not exist. */
function hostCoverage(
  cell: BridgeHostCell,
  cache: Map<number, number> | undefined,
): number {
  const cached = cache?.get(cell.id);
  if (cached !== undefined) return cached;
  const coverage = tissueSampleAt(cell.x, cell.z).resolvedCoverage;
  cache?.set(cell.id, coverage);
  return coverage;
}

interface BridgeLanding {
  x: number;
  y: number;
  z: number;
  weight: number;
  segment: number;
}

/**
 * Where on the anchor's own fibre the stroke ends.
 *
 * One of the anchor's incident prefix segments, chosen by the host's hash, at
 * a parameter also drawn from it — so hosts that agree on a fibre still land
 * apart, and no drawn halo VERTEX is ever a bridge endpoint. An anchor with
 * no incident prefix segment (an isolated placed point) falls back to the
 * vertex; there is nothing else to land on, and the tier ranking has already
 * pushed those to the bottom of every pool.
 *
 * The second hash mix is `fnv1a` over the pair rather than a shift of the
 * first, so a host's several anchors do not all take the same parameter.
 */
function landOnAnchorFibre(
  index: BridgeAnchorIndex,
  anchorIndex: number,
  hostHash: number,
): BridgeLanding {
  const positions = index.field.positions;
  const start = index.incidentStart[anchorIndex];
  const end = index.incidentStart[anchorIndex + 1];
  const vertex: BridgeLanding = {
    x: positions[anchorIndex * 3],
    y: positions[anchorIndex * 3 + 1],
    z: positions[anchorIndex * 3 + 2],
    weight: index.field.weights[anchorIndex],
    segment: -1,
  };
  const degree = end - start;
  if (degree <= 0) return vertex;
  const mixed = fnv1a(`${hostHash}.${anchorIndex}`);
  const segment = index.incidentSegments[start + (mixed % degree)];
  const a = index.field.segments[segment * 2];
  const b = index.field.segments[segment * 2 + 1];
  // Away from the anchor, so the landing is always on the run rather than
  // creeping back toward the vertex that selected it.
  const far = a === anchorIndex ? b : a;
  const u = BRIDGE_LANDING_MIN
    + (BRIDGE_LANDING_MAX - BRIDGE_LANDING_MIN)
      * (((mixed >>> 8) & 0xff) / 0xff);
  return {
    x: vertex.x + (positions[far * 3] - vertex.x) * u,
    y: vertex.y + (positions[far * 3 + 1] - vertex.y) * u,
    z: vertex.z + (positions[far * 3 + 2] - vertex.z) * u,
    weight: vertex.weight
      + (index.field.weights[far] - vertex.weight) * u,
    segment,
  };
}

/**
 * Every bridge one host would draw if the budget were unbounded, in the order
 * the budget fills them.
 *
 * Pure in (cell, index, reach) — no other host, and no budget, is an input.
 * That is what makes the k-th bridge stable: churn elsewhere can change how
 * MANY of these are drawn, never which ones they are.
 */
export function planHostBridges(
  cell: BridgeHostCell,
  index: BridgeAnchorIndex,
  reach: number = BRIDGE_ANCHOR_REACH,
  scratch: AnchorCandidate[] = [],
): BridgeEdge[] {
  collectAnchorCandidates(index, cell.x, cell.z, reach, scratch);
  if (scratch.length === 0) return [];
  const want = bridgesForDegree(cell.degree);
  // The pool: this host's best tier, widened past it only when that tier is
  // too thin to fill the quota.
  let bestTier = 0;
  while (
    bestTier < scratch.length
    && scratch[bestTier].tier === scratch[0].tier
  ) bestTier += 1;
  const pool = Math.min(
    scratch.length,
    BRIDGE_ANCHOR_POOL,
    Math.max(want, bestTier, BRIDGE_ANCHOR_POOL_MIN),
  );
  const hash = fnv1a(`${cell.id}`);
  const rotation = hash % pool;
  const separationSq = BRIDGE_ANCHOR_SEPARATION * BRIDGE_ANCHOR_SEPARATION;
  const picks: BridgeEdge[] = [];
  for (let step = 0; step < pool && picks.length < want; step += 1) {
    const anchor = scratch[(rotation + step) % pool];
    const landing = landOnAnchorFibre(index, anchor.index, hash);
    let tooClose = false;
    for (const picked of picks) {
      const dx = picked.toX - landing.x;
      const dz = picked.toZ - landing.z;
      if (dx * dx + dz * dz < separationSq) {
        tooClose = true;
        break;
      }
    }
    if (tooClose) continue;
    picks.push({
      cellId: cell.id,
      fromX: cell.x,
      fromY: cell.y,
      fromZ: cell.z,
      anchorIndex: anchor.index,
      anchorSegment: landing.segment,
      toX: landing.x,
      toY: landing.y,
      toZ: landing.z,
      anchorWeight: landing.weight,
      componentSize: index.componentSize[anchor.index],
    });
  }
  return picks;
}

/**
 * Choose the bridge set.
 *
 * Hosts are ranked barest-first (drawn-fabric degree), then by a hash of the
 * id so the budget's cut line scatters across the field instead of walking
 * one arm of the galaxy, then by the id itself so the order is total and no
 * Map's iteration order can reach the result.
 *
 * The budget is then spent in two passes over that one order: every planned
 * host gets its first stroke before any host gets its second. A host
 * displaced past the cut when the population changes is a host REMOVAL and
 * retracts through the layer's ordinary lifecycle; a host that gains a second
 * stroke gains it as a birth. Neither ever moves a stroke already on screen.
 */
export function selectBridgeEdges(
  cells: Iterable<BridgeHostCell>,
  index: BridgeAnchorIndex,
  options: BridgeSelectionOptions = {},
): BridgeSelection {
  const budget = options.budget ?? BRIDGE_BUDGET;
  const reach = options.reach ?? BRIDGE_ANCHOR_REACH;
  const maxHostDegree = options.maxHostDegree ?? BRIDGE_MAX_HOST_DEGREE;
  const coverageCeiling = options.coverageCeiling
    ?? BRIDGE_HOST_COVERAGE_CEILING;
  const breadthShare = options.breadthShare ?? BRIDGE_BREADTH_SHARE;
  const bridges: BridgeEdge[] = [];
  if (index.limit === 0 || budget <= 0) {
    return { bridges, hosts: 0, considered: 0 };
  }

  const candidates: HostCandidate[] = [];
  for (const cell of cells) {
    if (cell.degree > maxHostDegree) continue;
    if (hostCoverage(cell, options.coverageCache) > coverageCeiling) continue;
    candidates.push({ cell, order: fnv1a(`${cell.id}`) });
  }
  candidates.sort((a, b) => (
    a.cell.degree - b.cell.degree
    || a.order - b.order
    || (a.cell.id < b.cell.id ? -1 : a.cell.id > b.cell.id ? 1 : 0)
  ));

  // Plan only as many hosts as the breadth pass can pay for. The anchor
  // search is the expensive half — a grid query plus a sort per host — and
  // planning all 6,959 eligible Cells measured 68 ms against 25 for this, or
  // 4 ms once the plan cache is warm.
  const breadth = Math.max(1, Math.floor(budget * breadthShare));
  const scratch: AnchorCandidate[] = [];
  const planCache = options.planCache;
  const plans: BridgeEdge[][] = [];
  for (const candidate of candidates) {
    if (plans.length >= breadth) break;
    const cell = candidate.cell;
    const cached = planCache?.get(cell.id);
    const picks = cached !== undefined && cached.degree === cell.degree
      ? cached.picks
      : planHostBridges(cell, index, reach, scratch);
    planCache?.set(cell.id, { degree: cell.degree, picks });
    if (picks.length > 0) plans.push(picks);
  }

  for (const picks of plans) bridges.push(picks[0]);
  for (const picks of plans) {
    for (let k = 1; k < picks.length; k += 1) {
      if (bridges.length >= budget) break;
      bridges.push(picks[k]);
    }
    if (bridges.length >= budget) break;
  }

  return { bridges, hosts: plans.length, considered: candidates.length };
}

/** Identity of one bridge in the layer's persistent lifecycle map. The Cell id
 *  stays a decimal string — never a 32-bit pack — so a 2^52-range composition
 *  id round-trips exactly. */
export function bridgeKey(cellId: number, anchorIndex: number): string {
  return `${cellId}#${anchorIndex}`;
}
