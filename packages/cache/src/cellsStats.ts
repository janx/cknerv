// Aggregate statistics over the retained Cell map. The reducer maintains
// these incrementally (O(touched ids) per batch) via `adjustCellsStats`;
// `aggregateCellsStats` remains the reference full-scan implementation and
// the equivalence-test oracle. Moved here from @cknerv/ui's derive layer so
// the reducer can own the upkeep — the ui module re-exports for
// compatibility.
//
// Two script censuses meet in this module and must never be confused. The
// RETAINED-window one rides `CellsStats.scripts` and is adopted from the
// backend, which is the only side holding that population. The STAGE one is
// the `StageScriptTally` at the bottom, counted here, because the staged set
// is the population this cache holds in full. See `CellsStats.scripts`.

import type {
  AssetKind,
  Cell,
  CellKindKey,
  CellViewStats,
  LockKind,
  ScriptCensus,
  ScriptCount,
  ScriptId,
} from '@cknerv/types';

/** Re-exported from `@cknerv/types`, where it moved once the SERVER took
 *  over the bucketing: the wire's `by_kind` object is keyed by exactly this
 *  union, so one definition has to bind both sides. */
export type { CellKindKey } from '@cknerv/types';

export interface CellsStats {
  /** Canonical births in the backend's current observation/rebuild window,
   *  unaffected by CELL_CAP eviction or local GC. */
  born: number;
  /** Cells still alive within the observation window (`born - dead`). May
   *  exceed the local `cells` map after backend cap eviction. */
  live: number;
  /** Real chain deaths in that observation window. CELL_CAP evictions are
   *  excluded — those cells are still alive on chain. */
  dead: number;
  /** Per-kind breakdown of cells *currently in the galaxy view* (i.e. alive
   *  in the local cache). This stays a galaxy-view stat: at the configured
   *  CELL_CAP it may understate true on-chain per-kind counts, but no per-kind chain
   *  counter exists yet and the panel uses this for visual decomposition,
   *  not for chain accounting. */
  byKind: Record<CellKindKey, number>;
  /** Sum of `capacity` over locally-alive cells (galaxy-view, see byKind). */
  capacityShannons: number;
  /** # of alive cells in the local cache — the sampled "in view" set
   *  (≤ CELL_CAP). Distinct from `live` (the observation-window count). */
  inView: number;
  /** # of in-view alive cells carrying non-empty output data (`data_hex` past `0x`). */
  dataBearing: number;
  /** Lock-script-family breakdown of in-view alive cells. A galaxy-view
   *  sample (≤ CELL_CAP), same scope as `inView`; cells lacking `lock_kind`
   *  bucket into `other`. */
  byLock: Record<LockKind, number>;
  /** Asset/type-script-family breakdown of in-view alive cells. Galaxy-view
   *  sample like `byLock`; cells lacking `asset_kind` bucket into `other`. */
  byAsset: Record<AssetKind, number>;
  /** The same alive set counted by script identity rather than by the four
   *  lock families and seven asset families cknerv pins itself.
   *
   *  RETAINED-WINDOW scope, and therefore adopted wholesale from the backend
   *  and never counted here: this cache holds the staged subset, so a local
   *  scan would report the stage under the retained window's name. It
   *  refreshes on snapshots and on the backend's own block-cadence
   *  `script_census` delta.
   *
   *  The other half of that rule is `StageScriptTally` at the bottom of this
   *  module. A census that CLAIMS stage scope is exactly what local counting
   *  is right for — the staged set is the one population this cache holds
   *  whole — so that one is counted here and never adopted. The failure this
   *  pair guards against was never the counting; it was the label. Neither
   *  census may ever appear under the other's scope. */
  scripts: ScriptCensus;
}

/** A census with nothing in it — the shape the panel gets before the backend
 *  has sent one, and the only honest local answer to a question only the
 *  backend can count. */
export function emptyScriptCensus(): ScriptCensus {
  return {
    locks: [],
    locks_tail_cells: 0,
    locks_tail_scripts: 0,
    types: [],
    types_tail_cells: 0,
    types_tail_scripts: 0,
    types_absent: 0,
    unidentified: 0,
  };
}

/** Bucket an opaque tag string into the exhaustive four-known-keys union. */
export function cellKindKey(tag: string | null): CellKindKey {
  return tag === 'wallet' || tag === 'dex' || tag === 'cf' || tag === 'ckbloom'
    ? tag
    : 'generic';
}

export function emptyCellsStats(totalBirths = 0, totalDeaths = 0): CellsStats {
  return {
    born: totalBirths,
    live: totalBirths - totalDeaths,
    dead: totalDeaths,
    byKind: { wallet: 0, dex: 0, cf: 0, ckbloom: 0, generic: 0 },
    capacityShannons: 0,
    inView: 0,
    dataBearing: 0,
    byLock: { sighash: 0, multisig: 0, acp: 0, omnilock: 0, other: 0 },
    byAsset: {
      native: 0, sudt: 0, xudt: 0, dao: 0, spore: 0, other: 0, object: 0, identity: 0,
    },
    scripts: emptyScriptCensus(),
  };
}

/** Small fixed-shape copy so a copy-on-write batch can mutate a draft. */
export function cloneCellsStats(stats: CellsStats): CellsStats {
  return {
    born: stats.born,
    live: stats.live,
    dead: stats.dead,
    byKind: { ...stats.byKind },
    capacityShannons: stats.capacityShannons,
    inView: stats.inView,
    dataBearing: stats.dataBearing,
    byLock: { ...stats.byLock },
    byAsset: { ...stats.byAsset },
    // Shared by reference: the census is replaced wholesale by the backend,
    // never edited in place, so a draft can point at the same record.
    scripts: stats.scripts,
  };
}

/** Add (`sign` +1) or remove (−1) one ALIVE cell's contribution in place. */
function addCellContribution(stats: CellsStats, cell: Cell, sign: 1 | -1): void {
  stats.capacityShannons += sign * cell.capacity;
  stats.inView += sign;
  if (cell.data_hex !== '0x' && cell.data_hex.length > 2) {
    stats.dataBearing += sign;
  }
  stats.byLock[cell.lock_kind ?? 'other'] += sign;
  stats.byAsset[cell.asset_kind ?? 'other'] += sign;
  stats.byKind[cellKindKey(cell.tag)] += sign;
}

/**
 * Replace one Cell's contribution in a mutable stats draft: `before`/`after`
 * are the cache's initial and final values for one touched id (either may be
 * absent). Dead cells contribute nothing, exactly like the reference scan's
 * `death_at_ms !== null` skip — so deaths subtract, revivals add, and GC of
 * an already-dead record is a no-op.
 */
export function adjustCellsStats(
  stats: CellsStats,
  before: Cell | undefined,
  after: Cell | undefined,
): void {
  if (before !== undefined && before.death_at_ms === null) {
    addCellContribution(stats, before, -1);
  }
  if (after !== undefined && after.death_at_ms === null) {
    addCellContribution(stats, after, 1);
  }
}

/** Adopt the server's aggregate segment as the hydration seed.
 *
 * The counters the server does NOT send — born/live/dead — come from the
 * snapshot's own `total_births`/`total_deaths`, so there is exactly one copy
 * of each number on the wire. Everything else is a rename: the wire uses the
 * Rust field names, the cache its own.
 *
 * ⚠️ Scope-independent by contract. The segment always describes the server's
 * FULL retained set, so it stays correct once the snapshot stops carrying
 * every retained row — which is the entire reason it exists. Seeding from a
 * scan of the rows that DID arrive would silently start counting the stage
 * instead of the galaxy.
 */
export function adoptCellViewStats(
  stats: CellViewStats,
  totalBirths: number,
  totalDeaths: number,
): CellsStats {
  return {
    born: totalBirths,
    live: totalBirths - totalDeaths,
    dead: totalDeaths,
    byKind: { ...stats.by_kind },
    capacityShannons: stats.capacity_shannons,
    inView: stats.in_view,
    dataBearing: stats.data_bearing,
    byLock: { ...stats.by_lock },
    byAsset: { ...stats.by_asset },
    // Absent from snapshots produced before the census existed.
    scripts: stats.scripts ?? emptyScriptCensus(),
  };
}

/** Reference full-scan aggregation — the fallback hydration path for a server
 *  with no aggregate segment, and the equivalence oracle for both the
 *  reducer's incremental upkeep and the server's aggregation. */
export function aggregateCellsStats(
  cells: ReadonlyMap<number, Cell>,
  totalBirths: number,
  totalDeaths: number,
): CellsStats {
  const stats = emptyCellsStats(totalBirths, totalDeaths);
  for (const cell of cells.values()) {
    if (cell.death_at_ms !== null) continue;
    addCellContribution(stats, cell, 1);
  }
  return stats;
}

// ── stage-scoped script census ───────────────────────────────────────────
//
// The panel called STAGE SAMPLE has to describe the stage. `CellsStats.scripts`
// above cannot: the backend aggregates it over its whole retained window
// (~50k rows, 99% plain CKB), while the stage is a curated 12,000 whose whole
// point is that its mix differs. So this census is counted where the staged
// set actually lives — here — and carries a STAGE scope tag wherever it is
// shown.
//
// Edge semantics mirror `crates/cknerv-core/src/projection/cells_stats.rs`
// (`ScriptTally`) exactly, so the two censuses stay comparable line for line:
// an unset (all-zero / omitted) script counts as `unidentified`, an absent
// type script counts as `types_absent`, and both roles rank most-cells-first
// with ties on the code hash, cut at `STAGE_CENSUS_CAP` with tail counters.
//
// ONE deliberate divergence: the backend skips dead cells, this does not. The
// staged set decides who is on stage, and a corpse inside its death-animation
// window is still on it. This census counts the stage, not the living.

/** How deep the census ranks before it stops. Pinned to the backend's own
 *  `CENSUS_CAP`: two censuses cut at different depths would make one bar mean
 *  different things depending on which scope filled it. */
export const STAGE_CENSUS_CAP = 24;

/** One identity's running count. Mutable by design — a tally is rebuilt
 *  copy-on-write per batch and only ever read through `stageScriptCensus`. */
export interface StageScriptEntry {
  script: ScriptId;
  count: number;
}

/**
 * Running tallies for the stage census: the two maps and two counters the
 * backend's `ScriptTally` keeps, keyed by `code_hash:hash_type`.
 *
 * Deliberately NOT a `ScriptCensus`. A census is ranked and cut; re-ranking
 * on every delta would be work nobody asked for, so `stageScriptCensus`
 * ranks once per distinct tally, at read time.
 */
export interface StageScriptTally {
  readonly locks: ReadonlyMap<string, StageScriptEntry>;
  readonly types: ReadonlyMap<string, StageScriptEntry>;
  /** Staged cells carrying no type script at all. */
  readonly typesAbsent: number;
  /** Staged cells whose script identity is unreadable. Kept out of the ranked
   *  lists so a gap in cknerv's own records cannot show up as a family. */
  readonly unidentified: number;
}

/** The writable form the reducer's copy-on-write path mutates. */
export interface MutableStageScripts {
  locks: Map<string, StageScriptEntry>;
  types: Map<string, StageScriptEntry>;
  typesAbsent: number;
  unidentified: number;
}

/** Two identities are one bucket iff both fields match. Hex is lowercased so
 *  a differently-cased code hash cannot open a second bucket for one script. */
function scriptCensusKey(script: ScriptId): string {
  return `${script.code_hash.toLowerCase()}:${script.hash_type}`;
}

/** True for the all-zero code hash — what a cell whose script cknerv could
 *  not parse carries. Mirrors Rust `ScriptId::is_unset`; an omitted script is
 *  the same condition, since the wire skips serializing an unset one. */
function scriptUnset(script: ScriptId): boolean {
  const hex = script.code_hash.startsWith('0x')
    ? script.code_hash.slice(2)
    : script.code_hash;
  if (hex.length === 0) return true;
  for (let i = 0; i < hex.length; i += 1) {
    if (hex[i] !== '0') return false;
  }
  return true;
}

export function emptyStageScripts(): StageScriptTally {
  return { locks: new Map(), types: new Map(), typesAbsent: 0, unidentified: 0 };
}

/** Small copy so a batch can mutate a draft. Bounded by the number of
 *  DISTINCT scripts on stage (a few dozen — the identity is a code hash, not
 *  an outpoint), never by the 12,000 bodies. */
export function cloneStageScripts(tally: StageScriptTally): MutableStageScripts {
  const copy = (source: ReadonlyMap<string, StageScriptEntry>) => {
    const out = new Map<string, StageScriptEntry>();
    for (const [key, entry] of source) {
      out.set(key, { script: entry.script, count: entry.count });
    }
    return out;
  };
  return {
    locks: copy(tally.locks),
    types: copy(tally.types),
    typesAbsent: tally.typesAbsent,
    unidentified: tally.unidentified,
  };
}

function bump(
  bucket: Map<string, StageScriptEntry>,
  script: ScriptId,
  sign: 1 | -1,
): void {
  const key = scriptCensusKey(script);
  const entry = bucket.get(key);
  if (entry === undefined) {
    if (sign > 0) bucket.set(key, { script, count: 1 });
    return;
  }
  entry.count += sign;
  // A family that left the stage entirely leaves no zero-count ghost behind:
  // the ranked list would carry a name for nothing, and the tail counters
  // would count a family holding no cells.
  if (entry.count <= 0) bucket.delete(key);
}

/** Add (`sign` +1) or remove (−1) one staged cell's contribution in place. */
function addStageContribution(
  tally: MutableStageScripts,
  cell: Cell,
  sign: 1 | -1,
): void {
  const lock = cell.lock_script;
  if (lock === undefined || scriptUnset(lock)) tally.unidentified += sign;
  else bump(tally.locks, lock, sign);

  const type = cell.type_script;
  if (type === undefined) tally.typesAbsent += sign;
  else if (scriptUnset(type)) tally.unidentified += sign;
  else bump(tally.types, type, sign);
}

/**
 * Replace one staged id's contribution: `before`/`after` are the payload the
 * stage resolved for that id before and after the batch, either of which may
 * be absent (not staged, or staged with no record this cache was ever sent).
 * Unlike `adjustCellsStats` there is no death filter — see the module note.
 */
export function adjustStageScripts(
  tally: MutableStageScripts,
  before: Cell | undefined,
  after: Cell | undefined,
): void {
  if (before !== undefined) addStageContribution(tally, before, -1);
  if (after !== undefined) addStageContribution(tally, after, 1);
}

/** Whether two payloads for one id would tally identically. The lifecycle
 *  patches that dominate a live stream — death, tag — rewrite the record but
 *  not its scripts, and swapping a contribution for its equal would turn over
 *  the tally identity (and with it the memoized census) every block. */
export function sameStageContribution(
  before: Cell | undefined,
  after: Cell | undefined,
): boolean {
  if (before === after) return true;
  if (before === undefined || after === undefined) return false;
  return (
    scriptRoleEquals(before.lock_script, after.lock_script)
    && scriptRoleEquals(before.type_script, after.type_script)
  );
}

/** Script identity comparison at census granularity: two unset scripts are
 *  the same bucket (`unidentified`) however they were spelled. */
function scriptRoleEquals(
  a: ScriptId | undefined,
  b: ScriptId | undefined,
): boolean {
  // Absent-vs-unset matters for the TYPE role — absent is `types_absent`,
  // unset is `unidentified` — so presence is compared before content.
  if ((a === undefined) !== (b === undefined)) return false;
  if (a === undefined || b === undefined) return true;
  if (scriptUnset(a) && scriptUnset(b)) return true;
  return (
    a.code_hash.toLowerCase() === b.code_hash.toLowerCase()
    && a.hash_type === b.hash_type
  );
}

/** Full-scan tally over a staged membership — the snapshot seed and the
 *  equivalence oracle for the reducer's incremental upkeep. `resolve` is the
 *  stage's own canonical-first lookup; a member it comes up empty for
 *  contributes nothing, because a census counts records, not ids. */
export function aggregateStageScripts(
  members: Iterable<number>,
  resolve: (id: number) => Cell | undefined,
): StageScriptTally {
  const tally = cloneStageScripts(emptyStageScripts());
  for (const id of members) {
    const cell = resolve(id);
    if (cell !== undefined) addStageContribution(tally, cell, 1);
  }
  return tally;
}

/** Ranked censuses, one per distinct tally. The tally is immutable once the
 *  batch that built it returns, so the answer cannot go stale; a tally that
 *  survives a batch unchanged keeps its census, and the ranking cost is paid
 *  only when the stage's script mix actually moved. */
const censusMemo = new WeakMap<StageScriptTally, ScriptCensus>();

/** Rank one role by cell count and cut it at [`STAGE_CENSUS_CAP`], returning
 *  what the cut dropped. Ties break on the code hash so the same stage always
 *  produces the same list — a census that reshuffled between frames would
 *  make the panel's bars flicker for no chain reason. Same rule as the
 *  backend's `rank_and_cut`, with `hash_type` added as a final discriminator
 *  (the backend leaves the order of two deployments of one code hash under
 *  different hash types unspecified; here it is pinned). */
function rankAndCut(
  bucket: ReadonlyMap<string, StageScriptEntry>,
): { ranked: ScriptCount[]; tailCells: number; tailScripts: number } {
  const ranked: ScriptCount[] = [];
  for (const entry of bucket.values()) {
    ranked.push({ script: entry.script, count: entry.count });
  }
  ranked.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    if (a.script.code_hash !== b.script.code_hash) {
      return a.script.code_hash < b.script.code_hash ? -1 : 1;
    }
    if (a.script.hash_type === b.script.hash_type) return 0;
    return a.script.hash_type < b.script.hash_type ? -1 : 1;
  });
  const tail = ranked.slice(STAGE_CENSUS_CAP);
  return {
    ranked: ranked.slice(0, STAGE_CENSUS_CAP),
    tailCells: tail.reduce((sum, entry) => sum + entry.count, 0),
    tailScripts: tail.length,
  };
}

/** The stage census in the shape every consumer of the backend's census
 *  already reads. Built on first read of a given tally, then memoized. */
export function stageScriptCensus(tally: StageScriptTally): ScriptCensus {
  const memoized = censusMemo.get(tally);
  if (memoized !== undefined) return memoized;
  const locks = rankAndCut(tally.locks);
  const types = rankAndCut(tally.types);
  const census: ScriptCensus = {
    locks: locks.ranked,
    locks_tail_cells: locks.tailCells,
    locks_tail_scripts: locks.tailScripts,
    types: types.ranked,
    types_tail_cells: types.tailCells,
    types_tail_scripts: types.tailScripts,
    types_absent: tally.typesAbsent,
    unidentified: tally.unidentified,
  };
  censusMemo.set(tally, census);
  return census;
}

// ── stage-scoped population tally ────────────────────────────────────────
//
// The population field (`deriveCellPopulationField` in @cknerv/ui) reports
// how many staged members are ALIVE, split by which home resolved them —
// canonical retained record or display-lane resident — and by the three
// disjoint bins the chain census reports, so the stage's curation can be
// disclosed beside the chain's real composition. It used to count that by
// walking all 12,000 members (two Map lookups each, plus a 12,000-entry Set
// for the render prefix) on every batch that touched a Cell. The reducer
// already visits exactly the ids whose staged payload a batch could have
// moved, with the before and after record in hand, so the tally is kept
// here, in that same pass, and the derive reads five integers.
//
// Two deliberate differences from `StageScriptTally` above, both inherited
// from what the field discloses: dead members contribute NOTHING (a corpse
// inside its death-animation window is on stage but is not population — the
// same `death_at_ms !== null` skip as `adjustCellsStats`), and the count is
// keyed on which home resolved the member, because retained and resident
// coverage are reported as two numbers.

/** The three disjoint bins the chain census reports. A DAO Cell always
 *  carries a type script, so testing DAO first is what keeps them disjoint. */
export type CellPopulationClass = 'dao' | 'typedNonDao' | 'plain';

export function cellPopulationClass(
  cell: Pick<Cell, 'asset_kind' | 'type_shape_seed'>,
): CellPopulationClass {
  if (cell.asset_kind === 'dao') return 'dao';
  // `type_shape_seed` is explicitly null for a Cell with no type script, and
  // is always present — unlike the optional `type_script`, which older
  // persisted records can lack.
  if (cell.type_shape_seed !== null) return 'typedNonDao';
  return 'plain';
}

/** Live population of the staged set. Immutable once the batch that built it
 *  returns; identity-stable across batches that move none of its numbers. */
export interface StagePopulationTally {
  /** Alive staged members resolved to their canonical retained record. */
  readonly retainedLive: number;
  /** Alive staged members resolved from the display lane's resident map. */
  readonly residentLive: number;
  /** Alive staged members per census bin. The three sum to
   *  `retainedLive + residentLive`. */
  readonly dao: number;
  readonly typedNonDao: number;
  readonly plain: number;
}

/** The writable form the reducer's copy-on-write path mutates. */
export type MutableStagePopulation = {
  -readonly [K in keyof StagePopulationTally]: StagePopulationTally[K];
};

export function emptyStagePopulation(): StagePopulationTally {
  return { retainedLive: 0, residentLive: 0, dao: 0, typedNonDao: 0, plain: 0 };
}

/** Five-integer copy so a batch can mutate a draft. */
export function cloneStagePopulation(
  tally: StagePopulationTally,
): MutableStagePopulation {
  return {
    retainedLive: tally.retainedLive,
    residentLive: tally.residentLive,
    dao: tally.dao,
    typedNonDao: tally.typedNonDao,
    plain: tally.plain,
  };
}

/** Add (`sign` +1) or remove (−1) one staged record's contribution in place.
 *  `canonical` says which home resolved it. Dead records contribute nothing. */
function addStagePopulationContribution(
  tally: MutableStagePopulation,
  cell: Cell,
  canonical: boolean,
  sign: 1 | -1,
): void {
  if (cell.death_at_ms !== null) return;
  if (canonical) tally.retainedLive += sign;
  else tally.residentLive += sign;
  tally[cellPopulationClass(cell)] += sign;
}

/**
 * Replace one staged id's contribution: `before`/`after` are the payload the
 * stage resolved for that id before and after the batch (either may be
 * absent — off stage, or staged with no record this cache was ever sent),
 * and the two flags say whether the canonical map supplied each one.
 */
export function adjustStagePopulation(
  tally: MutableStagePopulation,
  before: Cell | undefined,
  beforeCanonical: boolean,
  after: Cell | undefined,
  afterCanonical: boolean,
): void {
  if (before !== undefined) {
    addStagePopulationContribution(tally, before, beforeCanonical, -1);
  }
  if (after !== undefined) {
    addStagePopulationContribution(tally, after, afterCanonical, 1);
  }
}

/** Whether two payloads for one id would tally identically, so the batches
 *  that dominate a live stream and move nothing here — a tag, a re-shipped
 *  record with the same class, a pulse — keep the tally's identity. A death
 *  is NOT one of those: it moves a live count, which is the whole point. */
export function sameStagePopulationContribution(
  before: Cell | undefined,
  beforeCanonical: boolean,
  after: Cell | undefined,
  afterCanonical: boolean,
): boolean {
  if (before === undefined || before.death_at_ms !== null) {
    return after === undefined || after.death_at_ms !== null;
  }
  if (after === undefined || after.death_at_ms !== null) return false;
  return (
    beforeCanonical === afterCanonical
    && cellPopulationClass(before) === cellPopulationClass(after)
  );
}

/** Full-scan tally over a staged membership, resolved canonical-first the
 *  way the stage itself resolves it — the snapshot seed and the equivalence
 *  oracle for the reducer's incremental upkeep. A member neither map holds
 *  contributes nothing: the field counts records, not ids. */
export function aggregateStagePopulation(
  members: Iterable<number>,
  cells: ReadonlyMap<number, Cell>,
  residents: ReadonlyMap<number, Cell>,
): StagePopulationTally {
  const tally = cloneStagePopulation(emptyStagePopulation());
  for (const id of members) {
    const canonical = cells.get(id);
    const cell = canonical ?? residents.get(id);
    if (cell !== undefined) {
      addStagePopulationContribution(tally, cell, canonical !== undefined, 1);
    }
  }
  return tally;
}
