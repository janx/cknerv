// Path finding through the spatial neighbour graph. A pulse travels
// hop-by-hop from a source cell to a target cell along the graph's
// edges. We use plain BFS — every edge has unit weight (we only care
// about hop count, not Euclidean distance), capped at MAX_HOPS so a
// pulse from one halo edge to the other doesn't grind the visual.
//
// The searches run over a typed-array SCRATCH (see `RouteScratch`) rather
// than a `Set` of visited ids and a `Map` of parents. Origins and outputs
// are hash-placed, so one search walks about half of the 12,000-node stage
// before it finds its targets; measured on the real builder's graph the
// Set/Map walk cost 1.7–2.8 ms per search and the per-neighbour `Set`
// iteration plus `Map` lookups were most of it, not the bookkeeping. The
// scratch keeps a dense slot per id and a cached neighbour-slot array per
// node, so the hot loop is typed-array reads only: 0.5–0.7 ms per search,
// byte-identical results (pinned against the Set/Map reference in the tests).

import { FIELD_HALF_X, FIELD_HALF_Z } from '../helix';
import type { NeighborAdjacency } from './neighborGraph';

/** Maximum hops a pulse will travel. Has to be high enough that
 *  paths spanning distant tissue lobes can complete; short hop caps
 *  trap successful pulses inside one local cluster.
 *
 *  This is a REACH budget spent in a currency the router cannot see:
 *  BFS weights every edge as one hop regardless of its length, so the
 *  world distance a budget buys is set entirely by how long the fabric's
 *  edges are. The fabric's k-NN search used to answer from a truncated,
 *  direction-biased slice of each neighbourhood, which made its edges
 *  ~2.9x longer than the true nearest neighbours; 40 hops was calibrated
 *  against those. With the search corrected the same 40 hops reach a
 *  third as far, and pulses that used to arrive now die in flight.
 *
 *  Measured on the corrected graph over random source/target pairs, at
 *  the 12,000-Cell stage and the 50,000-Cell reservoir:
 *
 *    maxHops    40      60      80
 *    12,000   96.4%  100.0%  100.0%
 *    50,000   70.0%   99.3%  100.0%
 *
 *  80 is the first value that completes every pair at both populations,
 *  and it matches the measured hop inflation (median 11 -> 23 hops at
 *  12,000, 15 -> 28 at 50,000) rather than merely covering it. A failed
 *  route costs the same BFS either way — the frontier empties on the
 *  graph, not on the cap. */
export const DEFAULT_MAX_HOPS = 80;

// ── typed-array search scratch ───────────────────────────────────────
//
// Cell ids span two families — small sequential ids and derived ids at or
// above 2^52 — so an id is never packed into 32 bits: the scratch assigns
// each id a dense SLOT on first sight (`slotOf` is the only Map in the
// engine, consulted once per id per graph change, not once per visit) and
// every per-node array below is indexed by slot. Slots are append-only, so
// a slot's meaning never changes underneath a cached neighbour array; the
// registry is compacted only when it has grown well past the live graph.
//
// The neighbour cache is what makes the walk cheap, and its validity rests
// on ONE invariant of `NeighborGraph`: an adjacency `Set` instance never
// changes content once published — a change REPLACES the instance. Both
// worker deserializers already keep it (a reused instance is one the worker
// proved unchanged), and the eager living-mesh mutators copy on write. The
// cache therefore keys on the `Set` instance a slot's array was built from
// (plus its size, as a cheap second witness), and a graph change costs one
// O(degree) rebuild per node actually expanded — never a rebuild per block.

/** Initial slot capacity; grows by doubling as ids are first seen. */
const ROUTE_SCRATCH_INITIAL_CAPACITY = 1024;
/** Registry compaction threshold: once the append-only slot registry holds
 *  more than twice the live node count plus this slack (departed ids from
 *  stage churn), it is rebuilt lazily from the next search's graph. */
const ROUTE_SCRATCH_COMPACT_SLACK = 8192;

/** Search scratch. Internal fields, exposed so the engine functions in this
 *  module can index them without an indirection per visit; construct with
 *  {@link createRouteScratch} and treat the contents as opaque elsewhere. */
export interface RouteScratch {
  /** id → slot, the one hash lookup of the engine. */
  slotOf: Map<number, number>;
  /** slot → id. Float64 on purpose (2^52-family ids). */
  ids: Float64Array;
  slotCount: number;
  /** Bumped per search; a slot is visited (or a target) iff its stamp is
   *  the current epoch, so no per-search clearing ever happens. */
  epoch: number;
  visitedEpoch: Int32Array;
  targetEpoch: Int32Array;
  /** slot → parent slot in the current search's discovery tree. */
  parent: Int32Array;
  /** BFS queue of slots; a search pushes each slot at most once. */
  queue: Int32Array;
  /** slot → the position the rescue's scores read. Float64, because the
   *  scores have to stay bit-identical to the closures they replace: a
   *  `pos_seed` is a double, and a rounded copy of one is a different argmax.
   *  Meaningful only where `posStamp[slot] === posGeneration`. */
  posX: Float64Array;
  posY: Float64Array;
  posZ: Float64Array;
  posStamp: Int32Array;
  /** One bit per slot: the publish of the current generation holds the id.
   *  This is the rescue's validity gate — what the caller used to pass as a
   *  predicate, answered out of the scratch instead. */
  validBits: Uint32Array;
  /** The publish the table was resolved against, and the generation counting
   *  it. A rescue over a NEW publish resolves what it reaches again; one over
   *  the publish already in the table touches no hash at all. */
  posSource: ReadonlyMap<number, RescuePositioned> | null;
  posGeneration: number;
  /** slot → neighbour slots in the adjacency Set's own iteration order,
   *  or null before the node was first expanded. */
  neighbourSlots: (Int32Array | null)[];
  /** The Set instance `neighbourSlots[slot]` was built from. */
  neighbourSource: (ReadonlySet<number> | null)[];
  /** Nodes holding a cached neighbour array right now. Zero means the next
   *  walk is COLD: every node it expands builds its array from scratch, which
   *  is ~7 ms of a ~9 ms full-stage search. */
  cachedNodes: number;
  /** Neighbour arrays built since this scratch was created. A warm walk
   *  builds only the nodes whose adjacency `Set` the last topology commit
   *  replaced; a cold one builds every node it expands. */
  neighbourBuilds: number;
  /** Times {@link beginSearch} threw the slot registry away. It takes the
   *  whole neighbour cache with it — every cached array holds SLOT indices
   *  and a compaction renumbers slots — so this counts the cold cliffs the
   *  cache's own validity rule cannot prevent. */
  compactions: number;
}

export function createRouteScratch(
  capacity: number = ROUTE_SCRATCH_INITIAL_CAPACITY,
): RouteScratch {
  const cap = Math.max(16, Math.floor(capacity));
  return {
    slotOf: new Map(),
    ids: new Float64Array(cap),
    slotCount: 0,
    epoch: 0,
    visitedEpoch: new Int32Array(cap),
    targetEpoch: new Int32Array(cap),
    parent: new Int32Array(cap),
    queue: new Int32Array(cap),
    posX: new Float64Array(cap),
    posY: new Float64Array(cap),
    posZ: new Float64Array(cap),
    posStamp: new Int32Array(cap),
    validBits: new Uint32Array((cap + 31) >> 5),
    posSource: null,
    posGeneration: 0,
    neighbourSlots: [],
    neighbourSource: [],
    cachedNodes: 0,
    neighbourBuilds: 0,
    compactions: 0,
  };
}

/** True while the router's per-node neighbour cache is empty — the next walk
 *  rebuilds an array for every node it expands. Only a boot or a compaction
 *  leaves it this way: an ordinary topology commit keeps the `Set` instance
 *  of every node it did not change, so its searches stay warm. */
export function routeCacheCold(
  scratch: RouteScratch = defaultRouteScratch(),
): boolean {
  return scratch.cachedNodes === 0;
}

/** Neighbour arrays built so far — the direct size of what a walk paid for
 *  cache misses. Cumulative for the scratch's lifetime; read it around a step
 *  and the difference is that step's rebuild count. */
export function routeCacheBuilds(
  scratch: RouteScratch = defaultRouteScratch(),
): number {
  return scratch.neighbourBuilds;
}

/** Compactions so far. Cumulative for the scratch's lifetime; a compaction
 *  needs the registry to pass `2 x liveNodeCount + ROUTE_SCRATCH_COMPACT_SLACK`
 *  slots, so on a ~12,000-node stage it is a session-scale event and not a
 *  per-block one. */
export function routeCacheCompactions(
  scratch: RouteScratch = defaultRouteScratch(),
): number {
  return scratch.compactions;
}

let sharedScratch: RouteScratch | null = null;

/** The module's shared scratch — the default every search uses when the
 *  caller passes none. Sharing across graphs is sound: slots are per id and
 *  the neighbour cache validates against the Set instance it was built
 *  from, so a different graph simply misses the cache. */
export function defaultRouteScratch(): RouteScratch {
  return (sharedScratch ??= createRouteScratch());
}

function growRouteScratch(scratch: RouteScratch): void {
  const cap = scratch.ids.length * 2;
  const ids = new Float64Array(cap);
  ids.set(scratch.ids);
  scratch.ids = ids;
  const grow = (a: Int32Array): Int32Array => {
    const b = new Int32Array(cap);
    b.set(a);
    return b;
  };
  const growF = (a: Float64Array): Float64Array => {
    const b = new Float64Array(cap);
    b.set(a);
    return b;
  };
  scratch.visitedEpoch = grow(scratch.visitedEpoch);
  scratch.targetEpoch = grow(scratch.targetEpoch);
  scratch.parent = grow(scratch.parent);
  scratch.queue = grow(scratch.queue);
  scratch.posX = growF(scratch.posX);
  scratch.posY = growF(scratch.posY);
  scratch.posZ = growF(scratch.posZ);
  scratch.posStamp = grow(scratch.posStamp);
  // Slots keep their numbers, so the bitset's words keep their meaning.
  const bits = new Uint32Array((cap + 31) >> 5);
  bits.set(scratch.validBits);
  scratch.validBits = bits;
}

function slotFor(scratch: RouteScratch, id: number): number {
  const known = scratch.slotOf.get(id);
  if (known !== undefined) return known;
  if (scratch.slotCount === scratch.ids.length) growRouteScratch(scratch);
  const slot = scratch.slotCount;
  scratch.slotCount = slot + 1;
  scratch.ids[slot] = id;
  scratch.slotOf.set(id, slot);
  scratch.neighbourSlots.push(null);
  scratch.neighbourSource.push(null);
  return slot;
}

/** Open a search: bump the epoch and compact the registry when stage churn
 *  has left it holding far more departed ids than live ones. */
function beginSearch(scratch: RouteScratch, liveNodeCount: number): number {
  if (
    scratch.slotCount > 2 * liveNodeCount + ROUTE_SCRATCH_COMPACT_SLACK
    || scratch.epoch === 0x7fffffff
  ) {
    const fresh = createRouteScratch(
      Math.max(ROUTE_SCRATCH_INITIAL_CAPACITY, liveNodeCount + 256),
    );
    scratch.slotOf = fresh.slotOf;
    scratch.ids = fresh.ids;
    scratch.slotCount = 0;
    scratch.epoch = 0;
    scratch.visitedEpoch = fresh.visitedEpoch;
    scratch.targetEpoch = fresh.targetEpoch;
    scratch.parent = fresh.parent;
    scratch.queue = fresh.queue;
    scratch.posX = fresh.posX;
    scratch.posY = fresh.posY;
    scratch.posZ = fresh.posZ;
    scratch.posStamp = fresh.posStamp;
    scratch.validBits = fresh.validBits;
    scratch.posSource = null;
    scratch.posGeneration = 0;
    scratch.neighbourSlots = [];
    scratch.neighbourSource = [];
    // The cache dies with the registry: a cached array holds slot indices and
    // every slot has just been renumbered, so no entry survives — the ones
    // whose adjacency never changed included.
    scratch.cachedNodes = 0;
    scratch.compactions += 1;
  }
  scratch.epoch += 1;
  return scratch.epoch;
}

/** Neighbour slots of `slot`, in the Set's own iteration order — the order
 *  the Set/Map walk expanded in, which is what keeps first-discovery parents
 *  (and therefore every path) identical. Rebuilt only when the Set instance
 *  behind the node changed. May grow the scratch: callers re-read the typed
 *  arrays afterwards. */
function neighbourSlotsOf(
  scratch: RouteScratch,
  slot: number,
  neighbours: ReadonlySet<number>,
): Int32Array {
  const cached = scratch.neighbourSlots[slot];
  if (
    cached !== null
    && scratch.neighbourSource[slot] === neighbours
    && cached.length === neighbours.size
  ) {
    return cached;
  }
  const built = new Int32Array(neighbours.size);
  let k = 0;
  for (const id of neighbours) built[k++] = slotFor(scratch, id);
  if (cached === null) scratch.cachedNodes += 1;
  scratch.neighbourBuilds += 1;
  scratch.neighbourSlots[slot] = built;
  scratch.neighbourSource[slot] = neighbours;
  return built;
}

/** `[ids[root], …, ids[slot]]` along the discovery tree. */
function pathToRoot(
  scratch: RouteScratch,
  slot: number,
  rootSlot: number,
): number[] {
  const { ids, parent } = scratch;
  const path = [ids[slot]];
  let walk = slot;
  while (walk !== rootSlot) {
    walk = parent[walk];
    path.push(ids[walk]);
  }
  path.reverse();
  return path;
}

/**
 * Shortest hop-count path from `source` to `target` through the
 * neighbour graph. Returns null if no path exists within `maxHops`,
 * or if either endpoint is missing from the graph.
 *
 * Path includes both endpoints, so a direct neighbour pair returns
 * `[source, target]` of length 2 (= 1 hop).
 */
/**
 * Shortest paths from one `source` to EVERY requested target in a single BFS
 * traversal. Byte-identical per-target results to calling `shortestPath` once
 * per target — the expansion order (and therefore each first-discovery parent
 * chain) does not depend on the target set — but the frontier is walked once
 * instead of once per target, which is what a multi-output tx costs today.
 * Unreachable / missing / beyond-maxHops targets are simply absent from the
 * returned map. Stops as soon as every reachable requested target is found.
 * The missing-endpoint early returns touch no scratch.
 */
export function shortestPathsToTargets(
  graph: NeighborAdjacency,
  source: number,
  targets: readonly number[],
  maxHops: number = DEFAULT_MAX_HOPS,
  scratch: RouteScratch = defaultRouteScratch(),
): Map<number, number[]> {
  const found = new Map<number, number[]>();
  const adjacency = graph.adjacency;
  let wanted = 0;
  for (const target of targets) {
    if (target === source) {
      found.set(target, [source]);
      continue;
    }
    if (adjacency.has(target)) wanted += 1;
  }
  if (!adjacency.has(source) || wanted === 0) return found;

  const epoch = beginSearch(scratch, adjacency.size);
  let remaining = 0;
  for (const target of targets) {
    if (target === source || !adjacency.has(target)) continue;
    const slot = slotFor(scratch, target);
    if (scratch.targetEpoch[slot] !== epoch) {
      scratch.targetEpoch[slot] = epoch;
      remaining += 1;
    }
  }
  const sourceSlot = slotFor(scratch, source);
  let { ids, visitedEpoch, targetEpoch, parent, queue } = scratch;
  visitedEpoch[sourceSlot] = epoch;
  parent[sourceSlot] = -1;
  queue[0] = sourceSlot;
  let head = 0;
  let tail = 1;
  let levelEnd = 1;
  for (let depth = 0; depth < maxHops; depth++) {
    while (head < levelEnd) {
      const cur = queue[head++];
      const neighbours = adjacency.get(ids[cur]);
      if (neighbours === undefined) continue;
      const nb = neighbourSlotsOf(scratch, cur, neighbours);
      ({ ids, visitedEpoch, targetEpoch, parent, queue } = scratch);
      for (let i = 0; i < nb.length; i++) {
        const slot = nb[i];
        if (visitedEpoch[slot] === epoch) continue;
        visitedEpoch[slot] = epoch;
        parent[slot] = cur;
        if (targetEpoch[slot] === epoch) {
          found.set(ids[slot], pathToRoot(scratch, slot, sourceSlot));
          if (--remaining === 0) return found;
        }
        queue[tail++] = slot;
      }
    }
    if (tail === levelEnd) return found;
    levelEnd = tail;
  }
  return found;
}

// ── rescue-origin selection (block-guarantee pulses) ─────────────────
//
// When every link of a non-empty block dropped, the rescue pass fires one
// pulse for the block's best link — but the honest origin may not exist
// anywhere in the system (a spend of coins born before the retained
// window). Instead of picking an origin point and praying a route exists,
// selection is DST-ROOTED: BFS outward from the destination and pick the
// reachable node that maximizes a caller-supplied score. Every hop of the
// returned path is a real adjacency edge by construction, which is what
// survives the frame loop's per-hop edge gate.
//
// It is the planner's largest single grain, because the argmax is over the
// WHOLE reachable component: 12,000 nodes on the bench stage, scored once
// each. The walk cannot stop at some margin past `RESCUE_MIN_HOPS` — both
// scores get BETTER with distance from the destination (proximity to a coin
// that may be anywhere on the stage, rim-wardness along an outward radial),
// so there is no depth past which the rest of the component is provably
// worse. Measured over the forty dark blocks of `__tests__/fixtures/
// rescueOriginChain.json`: the chosen origin sits 7 to 44 hops out, median
// 18, and a cap at `RESCUE_MIN_HOPS + 4` would move 30 of the 40 answers.
// So the grain is paid down per NODE instead: the score is arithmetic on the
// scratch's own position table (`RescueScoreSpec`), which asks the publish
// once per node reached and nothing at all on a second attempt over the same
// publish — 0.87x the closure form on a new publish and 0.63x on a repeat,
// over the 12,000-Cell stage (interleaved A/B, min of 15, load 2.3).

/** Hop ceiling for rescue routes. Deliberately below DEFAULT_MAX_HOPS: a
 *  rescue pulse is one deliberate inbound flow, not a cascade — ~48 hops
 *  ≈ 1.6 s at HOP_MS_BASE. Held at 0.6 of DEFAULT_MAX_HOPS across the
 *  fabric's rescale, so the rescue keeps reaching the same distance into
 *  the tissue that it was tuned to reach. */
export const RESCUE_MAX_HOPS = 48;

/** Prefer origins at least this many hops out when any exist, so the
 *  travel reads as an arrival rather than a twitch beside the newborn.
 *  Distance is the point, so this rides the fabric's scale too: 3 hops
 *  spanned ~16 world units on the old long-edged graph and would span
 *  ~6 on the corrected one. */
export const RESCUE_MIN_HOPS = 6;

/** Minimal position shape the rescue scores need. Both `Cell` and
 *  `NeighborGraphCell` satisfy it structurally. */
export interface RescuePositioned {
  pos_seed: readonly [number, number, number];
}

/** How the rescue ranks a node, in a form the walk can evaluate without
 *  leaving its typed arrays — the two scores this module owns, each carrying
 *  the publish its positions come from.
 *
 *  A dark block's BFS reaches the whole stage (12,000 nodes on the bench
 *  fixture), and a closure score cost it two hash lookups on `cells` and two
 *  calls per node; the spec costs one lookup per node per PUBLISH and none
 *  thereafter, because the scratch keeps the resolved position and the
 *  membership bit. Membership in `cells` is the validity gate — the same
 *  predicate every caller passed, which is why a spec needs no `valid`. */
export type RescueScoreSpec =
  | {
    readonly kind: 'anchor';
    readonly cells: ReadonlyMap<number, RescuePositioned>;
    readonly x: number;
    readonly y: number;
    readonly z: number;
  }
  | {
    readonly kind: 'rim';
    readonly cells: ReadonlyMap<number, RescuePositioned>;
    readonly dirX: number;
    readonly dirZ: number;
  };

/** Either of the module's own scores, or any function of an id — the general
 *  form, which pays a call per visited node and is what a test or a future
 *  ladder rung reaches for. */
export type RescueScore = RescueScoreSpec | ((id: number) => number);

/** {@link anchorProximityScore} as a spec: prefer the node nearest the
 *  consumed coin's true address. */
export function anchorProximity(
  cells: ReadonlyMap<number, RescuePositioned>,
  anchorPos: readonly [number, number, number],
): RescueScoreSpec {
  return {
    kind: 'anchor',
    cells,
    x: anchorPos[0],
    y: anchorPos[1],
    z: anchorPos[2],
  };
}

/** {@link rimEntryScore} as a spec: prefer the most rim-ward node in `dstId`'s
 *  outward radial. The radial is read once here, exactly as the closure reads
 *  it once at construction. */
export function rimEntry(
  cells: ReadonlyMap<number, RescuePositioned>,
  dstId: number,
): RescueScoreSpec {
  let dirX = 0;
  let dirZ = 0;
  const dst = cells.get(dstId);
  if (dst) {
    const ex = dst.pos_seed[0] / FIELD_HALF_X;
    const ez = dst.pos_seed[2] / FIELD_HALF_Z;
    const len = Math.hypot(ex, ez);
    if (len > 1e-9) {
      dirX = ex / len;
      dirZ = ez / len;
    }
  }
  return { kind: 'rim', cells, dirX, dirZ };
}

export interface RescueOriginOptions {
  maxHops?: number;
  minHops?: number;
  /** Nodes failing this predicate are neither origins NOR intermediate
   *  hops — the BFS refuses to traverse them. The renderer's per-hop gate
   *  extinguishes a pulse whose hop endpoints are missing from the cells
   *  map, so the caller passes cells-membership here and the whole path is
   *  renderable at plan time by construction. A SPEC score carries that
   *  membership itself and needs none. */
  valid?: (id: number) => boolean;
  /** Search scratch; the module's shared one when absent. */
  scratch?: RouteScratch;
}

/** Point the scratch's position table at a publish. Same instance as last
 *  time → every slot the table already holds stays valid, which is what makes
 *  a block's second rescue attempt free; a different instance → a new
 *  generation, and what the next walk reaches is resolved against it.
 *
 *  Keying on the instance is the rule the neighbour cache already lives by
 *  one level up: a published Cell map is replaced, never edited (the reducer
 *  copies on write), so an unchanged instance is a publish that has not moved. */
function beginPositions(
  scratch: RouteScratch,
  cells: ReadonlyMap<number, RescuePositioned>,
): void {
  if (scratch.posSource === cells) return;
  scratch.posSource = cells;
  if (scratch.posGeneration === 0x7fffffff) {
    scratch.posStamp.fill(0);
    scratch.posGeneration = 0;
  }
  scratch.posGeneration += 1;
}

/**
 * BFS outward from `dst`, score every reachable valid node, and return the
 * highest-scoring origin's tree path `origin → … → dst`. Nodes at least
 * `minHops` out are preferred as a set (when any exist) even over a
 * higher-scoring closer node. Returns null when `dst` is absent from the
 * graph or no valid node is reachable from it.
 *
 * Deterministic for a given graph CONTENT regardless of adjacency-set
 * insertion order: equal scores break toward the lower node id.
 */
export function rescueOrigin(
  graph: NeighborAdjacency,
  dst: number,
  score: RescueScore,
  options: RescueOriginOptions = {},
): number[] | null {
  const maxHops = options.maxHops ?? RESCUE_MAX_HOPS;
  const minHops = options.minHops ?? RESCUE_MIN_HOPS;
  const valid = options.valid;
  const scratch = options.scratch ?? defaultRouteScratch();
  const adjacency = graph.adjacency;
  if (!adjacency.has(dst)) return null;

  // One walk, three shapes of score: 0 = anchor proximity, 1 = rim entry,
  // -1 = a caller's function. The kind is read ONCE, so the hot loop tests an
  // integer rather than dispatching on a union per node.
  const spec = typeof score === 'function' ? null : score;
  const scoreFn = typeof score === 'function' ? score : null;
  const kind = spec === null ? -1 : spec.kind === 'anchor' ? 0 : 1;
  const ax = spec !== null && spec.kind === 'anchor' ? spec.x : 0;
  const ay = spec !== null && spec.kind === 'anchor' ? spec.y : 0;
  const az = spec !== null && spec.kind === 'anchor' ? spec.z : 0;
  const dirX = spec !== null && spec.kind === 'rim' ? spec.dirX : 0;
  const dirZ = spec !== null && spec.kind === 'rim' ? spec.dirZ : 0;
  const hasDir = dirX !== 0 || dirZ !== 0;
  const source = spec === null ? null : spec.cells;

  // parent[slot] = the neighbour one hop closer to dst, so the origin's
  // parent chain IS the pulse path in travel order — no reverse needed.
  // The position table is opened AFTER the compaction check: a compaction
  // renumbers every slot, and a stamp carried across one would name a table
  // entry that now belongs to a different Cell.
  const epoch = beginSearch(scratch, adjacency.size);
  if (source !== null) beginPositions(scratch, source);
  const generation = scratch.posGeneration;
  const dstSlot = slotFor(scratch, dst);
  let { ids, visitedEpoch, parent, queue } = scratch;
  let { posX, posY, posZ, posStamp, validBits } = scratch;
  visitedEpoch[dstSlot] = epoch;
  parent[dstSlot] = -1;
  queue[0] = dstSlot;
  let head = 0;
  let tail = 1;
  let levelEnd = 1;
  // Ties break on ids, never on slots — slots are assignment order.
  let bestAnySlot = -1;
  let bestAnyId = -1;
  let bestAnyScore = Number.NEGATIVE_INFINITY;
  let bestFarSlot = -1;
  let bestFarId = -1;
  let bestFarScore = Number.NEGATIVE_INFINITY;
  for (let depth = 1; depth <= maxHops; depth++) {
    // The near set answers only for a search that never reaches minHops at
    // all, so once one far candidate stands the whole `bestAny` ladder is
    // dead — and `depth` is level-invariant, so neither test belongs per node.
    const far = depth >= minHops;
    const nearStillCounts = bestFarSlot === -1;
    while (head < levelEnd) {
      const cur = queue[head++];
      const neighbours = adjacency.get(ids[cur]);
      if (neighbours === undefined) continue;
      const nb = neighbourSlotsOf(scratch, cur, neighbours);
      ({ ids, visitedEpoch, parent, queue } = scratch);
      ({ posX, posY, posZ, posStamp, validBits } = scratch);
      for (let i = 0; i < nb.length; i++) {
        const slot = nb[i];
        if (visitedEpoch[slot] === epoch) continue;
        visitedEpoch[slot] = epoch;
        const id = ids[slot];
        if (valid && !valid(id)) continue; // never traverse THROUGH it either
        let s: number;
        if (kind < 0) {
          s = scoreFn!(id);
        } else {
          // The table answers both questions at once: a slot resolved in this
          // generation carries its Cell's position, or its bit says the
          // publish does not hold the id — which is the validity gate, and a
          // node failing it is not traversed THROUGH either.
          let px: number;
          let py: number;
          let pz: number;
          const word = slot >> 5;
          const bit = 1 << (slot & 31);
          if (posStamp[slot] === generation) {
            if ((validBits[word] & bit) === 0) continue;
            px = posX[slot];
            py = posY[slot];
            pz = posZ[slot];
          } else {
            posStamp[slot] = generation;
            const cell = source!.get(id);
            if (cell === undefined) {
              validBits[word] &= ~bit;
              continue;
            }
            validBits[word] |= bit;
            px = posX[slot] = cell.pos_seed[0];
            py = posY[slot] = cell.pos_seed[1];
            pz = posZ[slot] = cell.pos_seed[2];
          }
          if (kind === 0) {
            const dx = px - ax;
            const dy = py - ay;
            const dz = pz - az;
            s = -(dx * dx + dy * dy + dz * dz);
          } else {
            const ex = px / FIELD_HALF_X;
            const ez = pz / FIELD_HALF_Z;
            const rf = Math.hypot(ex, ez);
            if (rf < 1e-9 || !hasDir) s = rf;
            else {
              const cos = (ex * dirX + ez * dirZ) / rf;
              s = rf * (0.5 + 0.5 * Math.max(0, cos));
            }
          }
        }
        parent[slot] = cur;
        queue[tail++] = slot;
        if (
          nearStillCounts
          && (s > bestAnyScore || (s === bestAnyScore && id < bestAnyId))
        ) {
          bestAnySlot = slot;
          bestAnyId = id;
          bestAnyScore = s;
        }
        if (
          far
          && (s > bestFarScore || (s === bestFarScore && id < bestFarId))
        ) {
          bestFarSlot = slot;
          bestFarId = id;
          bestFarScore = s;
        }
      }
    }
    if (tail === levelEnd) break;
    levelEnd = tail;
  }
  const originSlot = bestFarSlot !== -1 ? bestFarSlot : bestAnySlot;
  if (originSlot === -1) return null;

  const path = [ids[originSlot]];
  let walk = originSlot;
  while (walk !== dstSlot) {
    walk = parent[walk];
    path.push(ids[walk]);
  }
  return path;
}

/**
 * L2 rim-entry score: prefer the most rim-ward node in the destination's
 * outward radial direction. Radial fraction is measured on the tissue
 * ellipse (`FIELD_HALF_X/Z` — the helix module is the sole rim authority),
 * alignment as the cosine against dst's outward radial, floored at 0 so
 * opposite-side rim nodes score as mere mid-field:
 *
 *   score(n) = rf(n) × (0.5 + 0.5 · max(0, cos(θ(n) − θ(dst))))
 *
 * A dst at the exact ellipse centre has no radial; score degrades to rf.
 */
export function rimEntryScore(
  cells: ReadonlyMap<number, RescuePositioned>,
  dstId: number,
): (id: number) => number {
  let dirX = 0;
  let dirZ = 0;
  const dst = cells.get(dstId);
  if (dst) {
    const ex = dst.pos_seed[0] / FIELD_HALF_X;
    const ez = dst.pos_seed[2] / FIELD_HALF_Z;
    const len = Math.hypot(ex, ez);
    if (len > 1e-9) {
      dirX = ex / len;
      dirZ = ez / len;
    }
  }
  const hasDir = dirX !== 0 || dirZ !== 0;
  return (id) => {
    const cell = cells.get(id);
    if (!cell) return Number.NEGATIVE_INFINITY;
    const ex = cell.pos_seed[0] / FIELD_HALF_X;
    const ez = cell.pos_seed[2] / FIELD_HALF_Z;
    const rf = Math.hypot(ex, ez);
    if (rf < 1e-9 || !hasDir) return rf;
    const cos = (ex * dirX + ez * dirZ) / rf;
    return rf * (0.5 + 0.5 * Math.max(0, cos));
  };
}

/**
 * L1 anchored score: prefer the node nearest a link's input anchor — the
 * true position of the consumed coin (`endpoint_anchors` carries its
 * `pos_seed` even after the cell left every client map).
 */
export function anchorProximityScore(
  cells: ReadonlyMap<number, RescuePositioned>,
  anchorPos: readonly [number, number, number],
): (id: number) => number {
  return (id) => {
    const cell = cells.get(id);
    if (!cell) return Number.NEGATIVE_INFINITY;
    const dx = cell.pos_seed[0] - anchorPos[0];
    const dy = cell.pos_seed[1] - anchorPos[1];
    const dz = cell.pos_seed[2] - anchorPos[2];
    return -(dx * dx + dy * dy + dz * dz);
  };
}

/**
 * Defensive fallback for the rescue destination: the in-graph cell nearest
 * a position (a newborn's output anchor). Only consulted when none of a
 * link's `to_ids` made it into the graph — the pulse then lands beside the
 * newborn's true position instead of nowhere. Degree-0 nodes are skipped
 * (the live graph really holds them after death pruning; an isolated
 * destination would fail the whole rescue while a connected node sits
 * marginally farther). Ties break toward the lower id. Returns null on an
 * empty graph.
 */
export function nearestGraphNode(
  cells: ReadonlyMap<number, RescuePositioned>,
  graph: NeighborAdjacency,
  pos: readonly [number, number, number],
): number | null {
  let best = -1;
  let bestDistSq = Number.POSITIVE_INFINITY;
  for (const [id, neighbours] of graph.adjacency) {
    if (neighbours.size === 0) continue;
    const cell = cells.get(id);
    if (!cell) continue;
    const dx = cell.pos_seed[0] - pos[0];
    const dy = cell.pos_seed[1] - pos[1];
    const dz = cell.pos_seed[2] - pos[2];
    const d = dx * dx + dy * dy + dz * dz;
    if (d < bestDistSq || (d === bestDistSq && id < best)) {
      best = id;
      bestDistSq = d;
    }
  }
  return best === -1 ? null : best;
}

export function shortestPath(
  graph: NeighborAdjacency,
  source: number,
  target: number,
  maxHops: number = DEFAULT_MAX_HOPS,
  scratch: RouteScratch = defaultRouteScratch(),
): number[] | null {
  if (source === target) return [source];
  if (!graph.adjacency.has(source) || !graph.adjacency.has(target)) {
    return null;
  }
  // One engine for every route: the single-target search is the
  // multi-target one asked for one target.
  return shortestPathsToTargets(graph, source, [target], maxHops, scratch)
    .get(target) ?? null;
}
