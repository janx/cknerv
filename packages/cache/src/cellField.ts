// CellField — mutable columnar (SoA) mirror of the cells cache, the client
// half of the P2 columnar data plane. The pure reducers keep their value
// semantics; a consumer OWNS one CellField and feeds it each cache
// generation through `syncCellFieldFromCache`, which applies the reducer's
// `cellChanges` journal (or rebuilds when the journal chain is broken).
// Renderers then read columns instead of walking Maps of objects; JS `Cell`
// objects are only materialized at interaction boundaries.
//
// ⚠️ Cell ids span BOTH sequential-small and 2^52 ranges (ckbadger
// composition ids). Ids live exclusively in Float64Array columns and f64
// hash keys — never 32-bit-pack a cell id.

import type { AssetKind, Cell, LockKind, ScriptId } from '@cknerv/types';
import type { CellGalaxyCache } from './cellsReducer';
import {
  COLUMNAR_ASSET_KINDS,
  COLUMNAR_LOCK_KINDS,
  CELLS_COLUMNAR_NO_SCRIPT,
  CELLS_COLUMNAR_NO_TAG,
  type CellsColumnarView,
} from './cellsColumnar';

/** dataFlag bit: cell data beyond "0x". */
export const CELL_FIELD_HAS_DATA = 1;

const EMPTY_SLOT = -1;

/** Mutable columnar store. Treat every array as owned by the field: read
 *  freely, write only through the functions in this module. A slot is live
 *  iff `id[slot]` is not NaN; freed slots recycle through an internal free
 *  list and bump `generation[slot]` so stale slot handles can't alias a
 *  reused slot. */
export interface CellField {
  /** Live row count. */
  size: number;
  /** Allocated slot capacity (columns length). */
  capacity: number;
  /** High-water mark: slots `[0, slotEnd)` have been allocated at least
   *  once; iteration scans this range and skips NaN ids. */
  slotEnd: number;
  /** f64 columns — NaN id marks a free slot; NaN deathAtMs means alive. */
  id: Float64Array;
  bornAtMs: Float64Array;
  deathAtMs: Float64Array;
  capacityShannons: Float64Array;
  posX: Float32Array;
  posY: Float32Array;
  posZ: Float32Array;
  birthBlock: Uint32Array;
  outPointIndex: Uint32Array;
  dataBytes: Uint32Array;
  lockShapeSeed0: Uint32Array;
  lockShapeSeed1: Uint32Array;
  typeShapeSeed0: Uint32Array;
  typeShapeSeed1: Uint32Array;
  dataShapeSeed0: Uint32Array;
  dataShapeSeed1: Uint32Array;
  lockKind: Uint8Array;
  assetKind: Uint8Array;
  flags: Uint8Array;
  /** Bumped when a slot is freed; a (slot, generation) pair is a safe
   *  cross-frame handle. */
  generation: Uint32Array;
  /** String side columns, slot-indexed. Bulk consumers must not read these
   *  per-row per-frame; they exist for interaction-boundary materialization
   *  and identity-visual seeds. */
  tag: (string | null)[];
  txHash: string[];
  contentHash: string[];
  dataHex: string[];
  /** Script identity, slot-indexed; `undefined` is the JSON path's absent
   *  key. Dictionary-backed on the wire, so these hold a handful of shared
   *  objects rather than one per row — never mutate one in place. */
  lockScript: (ScriptId | undefined)[];
  typeScript: (ScriptId | undefined)[];
  /** False after a columnar (numeric-only) hydration: string columns hold
   *  placeholders until the JSON path or a detail fetch fills them. Script
   *  identity is NOT in that bucket — it rides a dictionary, so the columnar
   *  hydrator fills it like the tags. The production sync path (from the Map
   *  cache) always leaves this true. */
  stringsHydrated: boolean;
  /** `cellsToken` of the cache generation this field last mirrored, or null
   *  before the first sync. */
  syncToken: object | null;
  /** Free-list stack of recyclable slots. */
  freeSlots: number[];
  /** Open-addressing id→slot hash (see hash functions below). */
  hashKeys: Float64Array;
  hashSlots: Int32Array;
  /** Live keys in the hash (== size). */
  hashSize: number;
  /** Tombstones currently in the hash table. */
  hashTombstones: number;
}

function makeHashKeys(capacity: number): Float64Array {
  return new Float64Array(capacity).fill(Number.NaN);
}

function tableCapacityFor(slots: number): number {
  // Power of two ≥ 2× requested live count keeps load ≤ 0.5 after a rehash.
  let capacity = 64;
  while (capacity < slots * 2) capacity *= 2;
  return capacity;
}

export function createCellField(initialCapacity = 1024): CellField {
  const capacity = Math.max(16, initialCapacity);
  const hashCapacity = tableCapacityFor(capacity);
  return {
    size: 0,
    capacity,
    slotEnd: 0,
    id: new Float64Array(capacity),
    bornAtMs: new Float64Array(capacity),
    deathAtMs: new Float64Array(capacity),
    capacityShannons: new Float64Array(capacity),
    posX: new Float32Array(capacity),
    posY: new Float32Array(capacity),
    posZ: new Float32Array(capacity),
    birthBlock: new Uint32Array(capacity),
    outPointIndex: new Uint32Array(capacity),
    dataBytes: new Uint32Array(capacity),
    lockShapeSeed0: new Uint32Array(capacity),
    lockShapeSeed1: new Uint32Array(capacity),
    typeShapeSeed0: new Uint32Array(capacity),
    typeShapeSeed1: new Uint32Array(capacity),
    dataShapeSeed0: new Uint32Array(capacity),
    dataShapeSeed1: new Uint32Array(capacity),
    lockKind: new Uint8Array(capacity),
    assetKind: new Uint8Array(capacity),
    flags: new Uint8Array(capacity),
    generation: new Uint32Array(capacity),
    tag: new Array(capacity).fill(null),
    txHash: new Array(capacity).fill(''),
    contentHash: new Array(capacity).fill(''),
    dataHex: new Array(capacity).fill(''),
    lockScript: new Array(capacity).fill(undefined),
    typeScript: new Array(capacity).fill(undefined),
    stringsHydrated: true,
    syncToken: null,
    freeSlots: [],
    hashKeys: makeHashKeys(hashCapacity),
    hashSlots: new Int32Array(hashCapacity).fill(EMPTY_SLOT),
    hashSize: 0,
    hashTombstones: 0,
  };
}

// ——— id→slot open-addressing hash ———
//
// Keys are f64 cell ids (exact for the full 2^52 range). NaN marks an empty
// bucket, Infinity a tombstone; both compare unequal to every real id, so
// the probe loop needs no special-casing on the compare path.

/** Mix a (≤2^53) non-negative id into a 32-bit hash. The id is split into
 *  exact 26-bit halves first — every arithmetic step stays lossless. */
function hashCellId(id: number): number {
  const lo = id % 0x4000000;
  const hi = Math.floor(id / 0x4000000);
  let h = Math.imul(lo, 0x9e3779b1) ^ Math.imul(hi, 0x85ebca77);
  h ^= h >>> 15;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 13;
  return h >>> 0;
}

/** Slot of `id`, or -1. */
export function cellFieldSlotOf(field: CellField, id: number): number {
  const keys = field.hashKeys;
  const mask = keys.length - 1;
  let index = hashCellId(id) & mask;
  for (;;) {
    const key = keys[index];
    if (key === id) return field.hashSlots[index];
    if (Number.isNaN(key)) return EMPTY_SLOT;
    index = (index + 1) & mask;
  }
}

function hashInsert(field: CellField, id: number, slot: number): void {
  const keys = field.hashKeys;
  const mask = keys.length - 1;
  let index = hashCellId(id) & mask;
  let insertAt = -1;
  for (;;) {
    const key = keys[index];
    if (key === id) {
      field.hashSlots[index] = slot;
      return;
    }
    if (Number.isNaN(key)) {
      const target = insertAt >= 0 ? insertAt : index;
      if (insertAt >= 0) field.hashTombstones -= 1;
      keys[target] = id;
      field.hashSlots[target] = slot;
      field.hashSize += 1;
      return;
    }
    if (insertAt < 0 && key === Number.POSITIVE_INFINITY) insertAt = index;
    index = (index + 1) & mask;
  }
}

function hashRemove(field: CellField, id: number): boolean {
  const keys = field.hashKeys;
  const mask = keys.length - 1;
  let index = hashCellId(id) & mask;
  for (;;) {
    const key = keys[index];
    if (key === id) {
      keys[index] = Number.POSITIVE_INFINITY;
      field.hashSlots[index] = EMPTY_SLOT;
      field.hashSize -= 1;
      field.hashTombstones += 1;
      return true;
    }
    if (Number.isNaN(key)) return false;
    index = (index + 1) & mask;
  }
}

function rehash(field: CellField, minCapacity: number): void {
  const oldKeys = field.hashKeys;
  const oldSlots = field.hashSlots;
  const capacity = tableCapacityFor(Math.max(minCapacity, field.hashSize));
  field.hashKeys = makeHashKeys(capacity);
  field.hashSlots = new Int32Array(capacity).fill(EMPTY_SLOT);
  field.hashSize = 0;
  field.hashTombstones = 0;
  for (let i = 0; i < oldKeys.length; i += 1) {
    const key = oldKeys[i];
    if (!Number.isNaN(key) && key !== Number.POSITIVE_INFINITY) {
      hashInsert(field, key, oldSlots[i]);
    }
  }
}

function maybeRehash(field: CellField): void {
  const used = field.hashSize + field.hashTombstones;
  if (used * 10 >= field.hashKeys.length * 7) {
    rehash(field, field.hashSize * 2);
  }
}

// ——— column storage ———

function growColumns(field: CellField, minCapacity: number): void {
  let capacity = field.capacity;
  while (capacity < minCapacity) capacity *= 2;
  if (capacity === field.capacity) return;

  const growTyped = <T extends Float64Array | Float32Array | Uint32Array | Uint8Array>(
    old: T,
    make: (n: number) => T,
  ): T => {
    const next = make(capacity);
    next.set(old as ArrayLike<number>);
    return next;
  };
  field.id = growTyped(field.id, (n) => new Float64Array(n));
  field.bornAtMs = growTyped(field.bornAtMs, (n) => new Float64Array(n));
  field.deathAtMs = growTyped(field.deathAtMs, (n) => new Float64Array(n));
  field.capacityShannons = growTyped(field.capacityShannons, (n) => new Float64Array(n));
  field.posX = growTyped(field.posX, (n) => new Float32Array(n));
  field.posY = growTyped(field.posY, (n) => new Float32Array(n));
  field.posZ = growTyped(field.posZ, (n) => new Float32Array(n));
  field.birthBlock = growTyped(field.birthBlock, (n) => new Uint32Array(n));
  field.outPointIndex = growTyped(field.outPointIndex, (n) => new Uint32Array(n));
  field.dataBytes = growTyped(field.dataBytes, (n) => new Uint32Array(n));
  field.lockShapeSeed0 = growTyped(field.lockShapeSeed0, (n) => new Uint32Array(n));
  field.lockShapeSeed1 = growTyped(field.lockShapeSeed1, (n) => new Uint32Array(n));
  field.typeShapeSeed0 = growTyped(field.typeShapeSeed0, (n) => new Uint32Array(n));
  field.typeShapeSeed1 = growTyped(field.typeShapeSeed1, (n) => new Uint32Array(n));
  field.dataShapeSeed0 = growTyped(field.dataShapeSeed0, (n) => new Uint32Array(n));
  field.dataShapeSeed1 = growTyped(field.dataShapeSeed1, (n) => new Uint32Array(n));
  field.lockKind = growTyped(field.lockKind, (n) => new Uint8Array(n));
  field.assetKind = growTyped(field.assetKind, (n) => new Uint8Array(n));
  field.flags = growTyped(field.flags, (n) => new Uint8Array(n));
  field.generation = growTyped(field.generation, (n) => new Uint32Array(n));
  field.tag.length = capacity;
  field.txHash.length = capacity;
  field.contentHash.length = capacity;
  field.dataHex.length = capacity;
  field.lockScript.length = capacity;
  field.typeScript.length = capacity;
  for (let i = field.capacity; i < capacity; i += 1) {
    field.tag[i] = null;
    field.txHash[i] = '';
    field.contentHash[i] = '';
    field.dataHex[i] = '';
    field.lockScript[i] = undefined;
    field.typeScript[i] = undefined;
  }
  field.capacity = capacity;
}

function allocateSlot(field: CellField): number {
  const recycled = field.freeSlots.pop();
  if (recycled !== undefined) return recycled;
  if (field.slotEnd >= field.capacity) growColumns(field, field.capacity + 1);
  const slot = field.slotEnd;
  field.slotEnd += 1;
  return slot;
}

const LOCK_KIND_CODES: Record<LockKind, number> = {
  sighash: 0,
  multisig: 1,
  acp: 2,
  omnilock: 3,
  other: 4,
};
const ASSET_KIND_CODES: Record<AssetKind, number> = {
  native: 0,
  sudt: 1,
  xudt: 2,
  dao: 3,
  spore: 4,
  other: 5,
  object: 6,
  identity: 7,
};

function writeCellColumns(field: CellField, slot: number, cell: Cell): void {
  field.id[slot] = cell.id;
  field.bornAtMs[slot] = cell.born_at_ms;
  field.deathAtMs[slot] = cell.death_at_ms ?? Number.NaN;
  field.capacityShannons[slot] = cell.capacity;
  field.posX[slot] = cell.pos_seed[0];
  field.posY[slot] = cell.pos_seed[1];
  field.posZ[slot] = cell.pos_seed[2];
  field.birthBlock[slot] = cell.birth_block;
  field.outPointIndex[slot] = cell.out_point.index;
  field.dataBytes[slot] = cell.data_bytes;
  field.lockShapeSeed0[slot] = cell.lock_shape_seed[0];
  field.lockShapeSeed1[slot] = cell.lock_shape_seed[1];
  field.typeShapeSeed0[slot] = cell.type_shape_seed?.[0] ?? 0;
  field.typeShapeSeed1[slot] = cell.type_shape_seed?.[1] ?? 0;
  field.dataShapeSeed0[slot] = cell.data_shape_seed[0];
  field.dataShapeSeed1[slot] = cell.data_shape_seed[1];
  field.lockKind[slot] = LOCK_KIND_CODES[cell.lock_kind ?? 'other'];
  field.assetKind[slot] = ASSET_KIND_CODES[cell.asset_kind ?? 'other'];
  field.flags[slot] = cell.data_bytes > 0 ? CELL_FIELD_HAS_DATA : 0;
  field.tag[slot] = cell.tag;
  field.txHash[slot] = cell.out_point.tx_hash;
  field.contentHash[slot] = cell.content_hash;
  field.dataHex[slot] = cell.data_hex;
  field.lockScript[slot] = cell.lock_script;
  field.typeScript[slot] = cell.type_script;
}

/** Insert or overwrite `cell`; returns its slot. */
export function cellFieldUpsert(field: CellField, cell: Cell): number {
  const existing = cellFieldSlotOf(field, cell.id);
  if (existing !== EMPTY_SLOT) {
    writeCellColumns(field, existing, cell);
    return existing;
  }
  const slot = allocateSlot(field);
  writeCellColumns(field, slot, cell);
  hashInsert(field, cell.id, slot);
  field.size += 1;
  maybeRehash(field);
  return slot;
}

/** Remove `id` if present; frees its slot and bumps the slot generation. */
export function cellFieldRemove(field: CellField, id: number): boolean {
  const slot = cellFieldSlotOf(field, id);
  if (slot === EMPTY_SLOT) return false;
  hashRemove(field, id);
  field.id[slot] = Number.NaN;
  field.tag[slot] = null;
  field.txHash[slot] = '';
  field.contentHash[slot] = '';
  field.dataHex[slot] = '';
  field.lockScript[slot] = undefined;
  field.typeScript[slot] = undefined;
  field.generation[slot] += 1;
  field.freeSlots.push(slot);
  field.size -= 1;
  return true;
}

/** Drop every row (columns stay allocated; generations of live slots bump). */
export function clearCellField(field: CellField): void {
  for (let slot = 0; slot < field.slotEnd; slot += 1) {
    if (!Number.isNaN(field.id[slot])) {
      field.generation[slot] += 1;
      field.tag[slot] = null;
      field.txHash[slot] = '';
      field.contentHash[slot] = '';
      field.dataHex[slot] = '';
      field.lockScript[slot] = undefined;
      field.typeScript[slot] = undefined;
    }
    field.id[slot] = Number.NaN;
  }
  field.size = 0;
  field.slotEnd = 0;
  field.freeSlots.length = 0;
  field.hashKeys.fill(Number.NaN);
  field.hashSlots.fill(EMPTY_SLOT);
  field.hashSize = 0;
  field.hashTombstones = 0;
  field.stringsHydrated = true;
  field.syncToken = null;
}

/** Materialize slot `slot` into a fresh JSON-path-shaped `Cell`. Interaction
 *  boundaries only — never call per row per frame. */
export function materializeCellAt(field: CellField, slot: number): Cell {
  const death = field.deathAtMs[slot];
  const lockScript = field.lockScript[slot];
  const typeScript = field.typeScript[slot];
  return {
    id: field.id[slot],
    born_at_ms: field.bornAtMs[slot],
    death_at_ms: Number.isNaN(death) ? null : death,
    birth_block: field.birthBlock[slot],
    tag: field.tag[slot],
    pos_seed: [field.posX[slot], field.posY[slot], field.posZ[slot]],
    out_point: {
      tx_hash: field.txHash[slot],
      index: field.outPointIndex[slot],
    },
    capacity: field.capacityShannons[slot],
    data_hex: field.dataHex[slot],
    data_bytes: field.dataBytes[slot],
    content_hash: field.contentHash[slot],
    lock_shape_seed: [field.lockShapeSeed0[slot], field.lockShapeSeed1[slot]],
    type_shape_seed: typeScript === undefined
      ? null
      : [field.typeShapeSeed0[slot], field.typeShapeSeed1[slot]],
    data_shape_seed: [field.dataShapeSeed0[slot], field.dataShapeSeed1[slot]],
    lock_kind: COLUMNAR_LOCK_KINDS[field.lockKind[slot]] ?? 'other',
    asset_kind: COLUMNAR_ASSET_KINDS[field.assetKind[slot]] ?? 'other',
    // Absent stays absent, as on the wire and in `columnarCellAt`.
    ...(lockScript === undefined ? {} : { lock_script: lockScript }),
    ...(typeScript === undefined ? {} : { type_script: typeScript }),
  };
}

export interface CellFieldSyncResult {
  mode: 'noop' | 'incremental' | 'rebuild';
  upserts: number;
  removals: number;
}

/**
 * Bring `field` in step with one cache generation. Idempotent per
 * generation (`cellsToken` match short-circuits). Applies the reducer's
 * `cellChanges` journal when its base matches the field's last synced
 * generation; any break in the chain — snapshot reset, skipped generation,
 * first sync — falls back to one full rebuild from the Map.
 */
export function syncCellFieldFromCache(
  field: CellField,
  cache: CellGalaxyCache,
): CellFieldSyncResult {
  if (field.syncToken === cache.cellsToken) {
    return { mode: 'noop', upserts: 0, removals: 0 };
  }
  const changes = cache.cellChanges;
  const chained =
    !changes.reset
    && changes.baseToken !== null
    && changes.baseToken === field.syncToken;
  if (!chained) {
    clearCellField(field);
    for (const cell of cache.cells.values()) cellFieldUpsert(field, cell);
    field.syncToken = cache.cellsToken;
    return { mode: 'rebuild', upserts: field.size, removals: 0 };
  }
  let removals = 0;
  for (const id of changes.removed) {
    if (cellFieldRemove(field, id)) removals += 1;
  }
  let upserts = 0;
  for (const id of changes.updated) {
    const cell = cache.cells.get(id);
    if (cell !== undefined) {
      cellFieldUpsert(field, cell);
      upserts += 1;
    }
  }
  field.syncToken = cache.cellsToken;
  return { mode: 'incremental', upserts, removals };
}

/**
 * Hydrate from a columnar snapshot buffer — numeric columns, tags and script
 * identity (all three dictionary- or column-backed); the per-row string
 * columns get placeholders and `stringsHydrated` drops to false until the
 * JSON path or a detail fetch fills them. Tested capability for the P3 boot
 * path; the production sync path today is `syncCellFieldFromCache`.
 */
export function hydrateCellFieldFromColumnar(
  field: CellField,
  view: CellsColumnarView,
): void {
  clearCellField(field);
  growColumns(field, view.rowCount);
  // Bulk inserts below skip the per-insert load check; size the table for
  // the whole row set up front so probe chains stay short throughout.
  rehash(field, view.rowCount);
  for (let i = 0; i < view.rowCount; i += 1) {
    const slot = allocateSlot(field);
    field.id[slot] = view.id[i];
    field.bornAtMs[slot] = view.bornAtMs[i];
    field.deathAtMs[slot] = view.deathAtMs[i];
    field.capacityShannons[slot] = view.capacity[i];
    field.posX[slot] = view.posX[i];
    field.posY[slot] = view.posY[i];
    field.posZ[slot] = view.posZ[i];
    field.birthBlock[slot] = view.birthBlock[i];
    field.outPointIndex[slot] = view.outPointIndex[i];
    field.dataBytes[slot] = view.dataBytes[i];
    field.lockShapeSeed0[slot] = view.lockShapeSeed0[i];
    field.lockShapeSeed1[slot] = view.lockShapeSeed1[i];
    field.typeShapeSeed0[slot] = view.typeShapeSeed0[i];
    field.typeShapeSeed1[slot] = view.typeShapeSeed1[i];
    field.dataShapeSeed0[slot] = view.dataShapeSeed0[i];
    field.dataShapeSeed1[slot] = view.dataShapeSeed1[i];
    field.lockKind[slot] = view.lockKind[i];
    field.assetKind[slot] = view.assetKind[i];
    field.flags[slot] = view.dataFlag[i] === 1 ? CELL_FIELD_HAS_DATA : 0;
    const tagCode = view.tagIndex[i];
    field.tag[slot] =
      tagCode === CELLS_COLUMNAR_NO_TAG ? null : view.tags[tagCode] ?? null;
    const lockRef = view.lockScriptRef[i];
    const typeRef = view.typeScriptRef[i];
    field.lockScript[slot] =
      lockRef === CELLS_COLUMNAR_NO_SCRIPT ? undefined : view.scripts[lockRef - 1];
    field.typeScript[slot] =
      typeRef === CELLS_COLUMNAR_NO_SCRIPT ? undefined : view.scripts[typeRef - 1];
    hashInsert(field, view.id[i], slot);
    field.size += 1;
  }
  maybeRehash(field);
  field.stringsHydrated = false;
  field.syncToken = null;
}

/** Typed-array bytes retained by the field (the string and script side
 *  columns excluded — JS string and object storage isn't measurable from
 *  here). Telemetry for the 1.5M memory-budget rehearsal. */
export function cellFieldColumnBytes(field: CellField): number {
  return (
    field.id.byteLength
    + field.bornAtMs.byteLength
    + field.deathAtMs.byteLength
    + field.capacityShannons.byteLength
    + field.posX.byteLength
    + field.posY.byteLength
    + field.posZ.byteLength
    + field.birthBlock.byteLength
    + field.outPointIndex.byteLength
    + field.dataBytes.byteLength
    + field.lockShapeSeed0.byteLength
    + field.lockShapeSeed1.byteLength
    + field.typeShapeSeed0.byteLength
    + field.typeShapeSeed1.byteLength
    + field.dataShapeSeed0.byteLength
    + field.dataShapeSeed1.byteLength
    + field.lockKind.byteLength
    + field.assetKind.byteLength
    + field.flags.byteLength
    + field.generation.byteLength
    + field.hashKeys.byteLength
    + field.hashSlots.byteLength
  );
}
