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
  ScriptCensus,
  ScriptCount,
  ScriptId,
  ScriptRegistryRecord,
} from '@cknerv/types';
import { HUD_COLORS } from '../components/hud/hudTheme';
import { midTruncate } from '../components/hud/cellFormat';

export interface ScriptFamilyBucket {
  key: string;
  label: string;
  count: number;
  color: string;
  /** False when nothing named this family and the label is its code hash. */
  named: boolean;
}

/** How many families a bar names before the rest collapse into one segment.
 *  The census ranks 24; a legend of 24 names is not a bar, it is a list. */
export const SCRIPT_BAR_FAMILIES = 4;

/** Coloured by rank rather than by a hash of the identity: the census ranking
 *  is stable (ties break on the code hash), so rank-colouring is stable too,
 *  and it guarantees neighbouring segments differ — which hashing does not. */
const RANK_COLORS = [
  HUD_COLORS.cyanWire,
  HUD_COLORS.orange,
  HUD_COLORS.caution,
  '#9d7bd8',
  '#ffb84d',
  '#72ffd4',
];
/** Everything past the named ranks. */
const REST_COLOR = '#33424f';
/** Cells whose identity cknerv could not read at all — a gap in its own
 *  records, kept visually distinct from a script it simply cannot name. */
const UNIDENTIFIED_COLOR = '#22303a';

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

function rank(
  entries: ScriptCount[],
  names: Map<string, string>,
  limit: number,
): { buckets: ScriptFamilyBucket[]; restCells: number; restScripts: number } {
  const head = entries.slice(0, limit);
  const rest = entries.slice(limit);
  return {
    buckets: head.map((entry, index) => ({
      key: registryKey(entry.script.code_hash, entry.script.hash_type),
      ...scriptLabel(entry.script, names),
      count: entry.count,
      color: RANK_COLORS[index % RANK_COLORS.length],
    })),
    restCells: rest.reduce((sum, entry) => sum + entry.count, 0),
    restScripts: rest.length,
  };
}

function withRest(
  buckets: ScriptFamilyBucket[],
  restCells: number,
  restScripts: number,
  unidentified: number,
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
    });
  }
  if (unidentified > 0) {
    out.push({
      key: 'unidentified',
      label: 'unidentified',
      count: unidentified,
      color: UNIDENTIFIED_COLOR,
      named: false,
    });
  }
  return out;
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
    census.unidentified,
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
  const { buckets, restCells, restScripts } = rank(census.types, names, limit);
  const plain: ScriptFamilyBucket[] = census.types_absent > 0
    ? [{
      key: 'native',
      label: 'CKB',
      count: census.types_absent,
      color: HUD_COLORS.cyanWire,
      named: true,
    }]
    : [];
  return [
    ...plain,
    ...withRest(
      // Rank colours start past the plain segment so it never shares one.
      buckets.map((bucket, index) => ({
        ...bucket,
        color: RANK_COLORS[(index + plain.length) % RANK_COLORS.length],
      })),
      restCells + census.types_tail_cells,
      restScripts + census.types_tail_scripts,
      0,
    ),
  ];
}

/** Whether the backend has counted anything by identity yet. Before it has —
 *  a pre-census backend, or a galaxy restored from state written before
 *  identities existed — the panel keeps its old four-family bars rather than
 *  showing an empty one. */
export function hasScriptCensus(census: ScriptCensus | undefined): boolean {
  return Boolean(
    census
      && (census.locks.length > 0
        || census.types.length > 0
        || census.types_absent > 0
        || census.unidentified > 0),
  );
}
