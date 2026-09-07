// Turning the cells projection's script census into panel bars.
//
// Two independent facts meet here for the first time. The census says which
// script identities the retained set holds and how many cells each one holds;
// it deliberately names none of them, because the cells projection reports
// only what the node said. The registry names identities; it counts nothing,
// because it comes from an optional index whose scope is the whole chain
// rather than this galaxy. Joined on `code_hash` + `hash_type`, neither has to
// trust the other's scope, and either can be missing.

import type {
  EnrichmentSourceStatus,
  ScriptCensus,
  ScriptCount,
  ScriptFamilyCensusRecord,
  ScriptId,
  ScriptRegistryRecord,
} from '@cknerv/types';
import { QUALITATIVE_BUCKET_COLORS } from '../components/hud/hudTheme';
import { CONTENT_BANDS, midTruncate } from '../components/hud/cellFormat';
import {
  anchoredRecordVisualState,
  type AnchoredRecordVisualState,
} from './anchoredRecord.derive';

export interface ScriptFamilyBucket {
  key: string;
  label: string;
  count: number;
  color: string;
  /** False when nothing named this family and the label is its code hash. */
  named: boolean;
  /** How many script families the segment stands for. 1 for every real
   *  family; the folded remainder carries its member count so a legend can
   *  say how much it is summarizing. */
  families: number;
}

/** How many families a bar names before the rest collapse into one segment.
 *  The census ranks 24; a legend of 24 names is not a bar, it is a list.
 *
 *  Six, not four, since the bars started counting the STAGE: the retained
 *  window is 99% plain CKB, where a fifth and sixth rank are sub-percent
 *  slivers, but the curated stage is a deliberate mix and those ranks are
 *  real families a reader can see. Bounded by the ramp below — a named
 *  segment with no colour of its own is worse than a folded one. */
export const SCRIPT_BAR_FAMILIES = 6;

/** Coloured by rank rather than by a hash of the identity: the census ranking
 *  is stable (ties break on the code hash), so rank-colouring is stable too,
 *  and it guarantees neighbouring segments differ — which hashing does not.
 *
 *  Which is exactly why the slots come from the house's qualitative ramp and
 *  not from `CONTENT_BANDS`: a slot here is POSITIONAL. Rank 0 is not
 *  "consensus content", it is just first, and painting it in the consensus
 *  band would tell a reader something about the family that the bar does not
 *  know. The peer atlas's country and version bars hand out the same slots for
 *  the same reason, and they hand out the same six.
 *
 *  What was here instead: `cyanWire` and `orange` — the two halves of the
 *  instrument's own chrome — then `caution`, a SEMANTIC health tone naming a
 *  script family, then three literals, the first of them a copy of
 *  `CONTENT_BANDS.script` down to the digit. Four rows of a six-row table
 *  borrowing from three layers that all mean something else. */
const RANK_COLORS = QUALITATIVE_BUCKET_COLORS;

/** Everything these bars paint, in one table: the six rank slots off the house
 *  ramp, then the three segments that are NOT slots and so are the three that
 *  do carry a meaning. Written out as the bar a READER sees rather than as the
 *  two tables it is assembled from, because that is the thing
 *  `hudDiscipline.test.ts` has to be able to walk — a stacked strip is legible
 *  or not as a whole, and a matrix that only saw half of it would have missed
 *  every finding below.
 *
 *  `native` — a cell with no type script is not an unnamed family, it is bare
 *  CKB, and plain consensus content wears the consensus's own colour. That is
 *  the house's one sanctioned borrow from the identity layer, spelled through
 *  the band the way `ASSET_COLORS.native` and `LOCK_COLORS.sighash` already
 *  spell it rather than through the wire token.
 *
 *  `rest` — everything past the named ranks: a family nothing could place,
 *  which is the band the whole house paints that in. It was already exactly
 *  this value, typed out.
 *
 *  `unidentified` — cells whose identity cknerv could not read at all: a gap in
 *  its own records, and the last segment of the bar, sitting directly against
 *  `rest`. It claimed to be "kept visually distinct" from that neighbour while
 *  sitting 32.5 from it, inside the separation floor — two adjacent segments of
 *  a 6px bar with no boundary a reader could find. The claim was the right one
 *  and the value was not, so the value moved: the same quiet blue-slate family,
 *  one clear step deeper (relative luminance 0.018 against `rest`'s 0.052),
 *  which is also what it MEANS — a hole in the records is less than a family
 *  too small to name. It stays 52.4 from the `trackGround` channel it is drawn
 *  on, so it still reads as a segment rather than as a gap in the bar; going
 *  deeper still would have bought separation from `rest` by spending it against
 *  the track. */
export const SCRIPT_FAMILY_COLORS: Record<string, string> = {
  ...Object.fromEntries(RANK_COLORS.map((hex, slot) => [`slot${slot}`, hex])),
  native: CONTENT_BANDS.consensus,
  rest: CONTENT_BANDS.unlisted,
  unidentified: '#182634',
};

const REST_COLOR = SCRIPT_FAMILY_COLORS.rest;
const UNIDENTIFIED_COLOR = SCRIPT_FAMILY_COLORS.unidentified;

function registryKey(codeHash: string, hashType: string): string {
  return `${codeHash.toLowerCase()}:${hashType}`;
}

/** Index a registry record for lookup by identity. */
export function scriptNameIndex(
  registry: ScriptRegistryRecord | null | undefined,
): Map<string, string> {
  const index = new Map<string, string>();
  for (const entry of registry?.entries ?? []) {
    index.set(registryKey(entry.code_hash, entry.hash_type), entry.name);
  }
  return index;
}

/** The name for one identity, or its code hash when nothing named it. A code
 *  hash is a worse label than a name and a much better one than a guess. */
export function scriptLabel(
  script: ScriptId,
  names: Map<string, string>,
): { label: string; named: boolean } {
  const name = names.get(registryKey(script.code_hash, script.hash_type));
  if (name) return { label: name, named: true };
  return { label: midTruncate(script.code_hash, 6, 3), named: false };
}

interface Ranked {
  buckets: ScriptFamilyBucket[];
  restCells: number;
  restScripts: number;
}

/** Order the merged families, name the first `limit` of them in rank hues
 *  and fold the rest into one count. Sorting is stable on the key, so a bar
 *  drawn twice from the same census is the same bar. */
function rankBuckets(merged: ScriptFamilyBucket[], limit: number): Ranked {
  merged.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  const rest = merged.slice(limit);
  return {
    buckets: merged.slice(0, limit).map((bucket, index) => ({
      ...bucket,
      color: RANK_COLORS[index % RANK_COLORS.length],
    })),
    restCells: rest.reduce((sum, bucket) => sum + bucket.count, 0),
    restScripts: rest.length,
  };
}

function rank(
  entries: ScriptCount[],
  names: Map<string, string>,
  limit: number,
): Ranked {
  // Merge identities that share a name before cutting. A family can be
  // deployed more than once — mainnet runs three Default Multisig versions
  // and two xUDTs — and the census counts each deployment separately because
  // they are separate scripts. On a bar they are one family, and repeating
  // the same label twice reads as a bug rather than as two versions.
  const merged: ScriptFamilyBucket[] = [];
  const byLabel = new Map<string, ScriptFamilyBucket>();
  for (const entry of entries) {
    const identity = scriptLabel(entry.script, names);
    // Only names merge: two unnamed identities have different code hashes,
    // so they are already distinct labels and must stay distinct segments.
    const existing = identity.named ? byLabel.get(identity.label) : undefined;
    if (existing) {
      existing.count += entry.count;
      continue;
    }
    const bucket: ScriptFamilyBucket = {
      key: registryKey(entry.script.code_hash, entry.script.hash_type),
      ...identity,
      count: entry.count,
      color: REST_COLOR,
      families: 1,
    };
    merged.push(bucket);
    if (identity.named) byLabel.set(identity.label, bucket);
  }
  // Merging can reorder: two small versions of one family may outrank a
  // single larger script.
  return rankBuckets(merged, limit);
}

/** The last segment of a bar: Cells nobody here can name. On the stage that
 *  is `unidentified` — an identity cknerv could not read, a gap in its own
 *  records. On the chain it is `unlisted` — a script the index has no family
 *  for. Two different facts, so two different words; one hue, because a
 *  reader meets them the same way, as the part of the bar that has no name. */
interface UnnamedTail {
  key: 'unidentified' | 'unlisted';
  count: number;
}

function withRest(
  buckets: ScriptFamilyBucket[],
  restCells: number,
  restScripts: number,
  tail: UnnamedTail | null,
): ScriptFamilyBucket[] {
  const out = [...buckets];
  if (restCells > 0) {
    // Says how many families it stands for. A nameless remainder is exactly
    // the "other" bucket this census replaced.
    out.push({
      key: 'rest',
      label: `+${restScripts} more`,
      count: restCells,
      color: REST_COLOR,
      named: false,
      families: restScripts,
    });
  }
  if (tail && tail.count > 0) {
    out.push({
      key: tail.key,
      label: tail.key,
      count: tail.count,
      color: UNIDENTIFIED_COLOR,
      named: false,
      families: 1,
    });
  }
  return out;
}

/** The ASSETS bar's shape, for either scope: bare CKB first — a cell with no
 *  type script is not an unnamed family, it is CKB itself — then the type
 *  families ranked past it, the fold, and the unnamed tail. */
function assetBar(
  plainCells: number,
  ranked: (limit: number) => Ranked,
  limit: number,
  tailCells: number,
  tailScripts: number,
  tail: UnnamedTail | null,
): ScriptFamilyBucket[] {
  const plain: ScriptFamilyBucket[] = plainCells > 0
    ? [{
      key: 'native',
      label: 'CKB',
      count: plainCells,
      color: SCRIPT_FAMILY_COLORS.native,
      named: true,
      families: 1,
    }]
    : [];
  // The plain segment spends one of the bar's colours, so it also spends one
  // of its named slots: at `limit === RANK_COLORS.length` the offset below
  // would otherwise wrap the last type family back onto CKB's own hue, and
  // two segments of one colour in one bar is a bar that reads as a bug.
  const { buckets, restCells, restScripts } = ranked(Math.max(0, limit - plain.length));
  return [
    ...plain,
    ...withRest(
      // Rank colours start past the plain segment so it never shares one.
      buckets.map((bucket, index) => ({
        ...bucket,
        color: RANK_COLORS[(index + plain.length) % RANK_COLORS.length],
      })),
      restCells + tailCells,
      restScripts + tailScripts,
      tail,
    ),
  ];
}

/** Lock families of the retained set, ranked, with the census's own tail
 *  folded into the remainder so the bar sums to every alive cell. */
export function lockFamilyBuckets(
  census: ScriptCensus,
  registry: ScriptRegistryRecord | null | undefined,
  limit = SCRIPT_BAR_FAMILIES,
): ScriptFamilyBucket[] {
  const names = scriptNameIndex(registry);
  const { buckets, restCells, restScripts } = rank(census.locks, names, limit);
  return withRest(
    buckets,
    restCells + census.locks_tail_cells,
    restScripts + census.locks_tail_scripts,
    { key: 'unidentified', count: census.unidentified },
  );
}

/** Type-script families, with plain cells carried as their own segment: a
 *  cell with no type script is not an unnamed family, it is CKB itself. */
export function assetFamilyBuckets(
  census: ScriptCensus,
  registry: ScriptRegistryRecord | null | undefined,
  limit = SCRIPT_BAR_FAMILIES,
): ScriptFamilyBucket[] {
  const names = scriptNameIndex(registry);
  return assetBar(
    census.types_absent,
    (cut) => rank(census.types, names, cut),
    limit,
    census.types_tail_cells,
    census.types_tail_scripts,
    null,
  );
}

// ——— The chain by the index's own menu ———————————————————————————————
//
// The index counts the whole chain's live Cells by family, and the adapter
// says, for each family, which of the index's Inventory pages its cells are
// listed under — Tokens, Objects, Identities — from the index's own token
// registry and its object and identity standards. CELL CENSUS draws the
// chain in that vocabulary rather than family by
// family: CKB, the three inventories, the DAO, and SCRIPTS for every typed
// Cell that is none of those. What the record cannot place it says so
// explicitly — bare CKB as `types_absent`, the DAO from the census's own
// partition, and the typed Cells the index has no family for as
// `types_unlisted` — so the bar sums to `live_cells` without a bucket
// invented on this side.

/** One hue per word, and the words are ones the HUD already speaks: the
 *  activity feed names what a transaction did with the same six, so a token
 *  is token-coloured whether it moved or merely exists. Spelled through the
 *  bands rather than by value, so the two surfaces cannot drift on a word
 *  they share. */
export const INVENTORY_COLORS: Record<string, string> = {
  native: CONTENT_BANDS.consensus,
  token: CONTENT_BANDS.token,
  object: CONTENT_BANDS.artifact,
  identity: CONTENT_BANDS.identity,
  dao: CONTENT_BANDS.value,
  script: CONTENT_BANDS.script,
};

const INVENTORY_LABELS: Record<string, string> = {
  native: 'CKB',
  token: 'TOKENS',
  object: 'OBJECTS',
  identity: 'IDENTITIES',
  dao: 'DAO',
  script: 'SCRIPTS',
};

/** The whole chain's live Cells by the index's menu, in a fixed order a
 *  reader can learn once: CKB, TOKENS, OBJECTS, IDENTITIES, DAO, SCRIPTS.
 *  The DAO's own family is among the named type families, so its count
 *  comes off the scripts rather than being drawn twice; the typed Cells the
 *  index has no family for are scripts too — Cells of some script nobody
 *  here can name — and join that segment rather than standing as a tail. */
export function chainInventoryBuckets(record: ScriptFamilyCensusRecord): ScriptFamilyBucket[] {
  const sums = { token: 0, object: 0, identity: 0, other: 0 };
  for (const family of record.families) {
    if (family.kind !== 'type') continue;
    const inventory = family.inventory === 'token' || family.inventory === 'object' || family.inventory === 'identity'
      ? family.inventory
      : 'other';
    sums[inventory] += family.live_cells;
  }
  const scripts = Math.max(0, sums.other - record.types_dao) + record.types_unlisted;
  const bucket = (key: string, count: number): ScriptFamilyBucket => ({
    key,
    label: INVENTORY_LABELS[key],
    count,
    color: INVENTORY_COLORS[key],
    named: true,
    families: 1,
  });
  return [
    bucket('native', record.types_absent),
    bucket('token', sums.token),
    bucket('object', sums.object),
    bucket('identity', sums.identity),
    bucket('dao', record.types_dao),
    bucket('script', scripts),
  ];
}

/** Three refreshes of the record's two-minute cadence: a composition that
 *  moves by tens of Cells a block is not news, and a bar that dimmed on one
 *  missed refresh would be dimming over nothing. Twinned in `cknerv-core`
 *  (`SCRIPT_FAMILY_CENSUS_CLIENT_PATIENCE_MS`), which floors the record's
 *  re-stamp at half of this. */
export const SCRIPT_FAMILY_CENSUS_STALE_AFTER_MS = 360_000;

export type ScriptFamilyCensusVisualState = AnchoredRecordVisualState;

/** Whether the chain bars may be drawn, and whether dimmed — the one law
 *  every anchored aggregate answers to. */
export function scriptFamilyCensusVisualState(
  source: EnrichmentSourceStatus,
  record: ScriptFamilyCensusRecord,
  nowMs = Date.now(),
): ScriptFamilyCensusVisualState | null {
  return anchoredRecordVisualState(source, record, SCRIPT_FAMILY_CENSUS_STALE_AFTER_MS, nowMs);
}

/** Whether anything has been counted by identity yet — a pre-census backend,
 *  a galaxy restored from state written before identities existed, or a
 *  session whose stage has not been composed. Until then the panel keeps the
 *  families cknerv classifies on its own rather than showing an empty bar. */
export function hasScriptCensus(
  census: ScriptCensus | undefined,
): census is ScriptCensus {
  return Boolean(
    census
      && (census.locks.length > 0
        || census.types.length > 0
        || census.types_absent > 0
        || census.unidentified > 0),
  );
}
