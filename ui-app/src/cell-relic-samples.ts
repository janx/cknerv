import type { AssetKind, Cell, CellGalaxySnapshot, LockKind } from '@cknerv/types';
import { observedLabDataBytes } from './cell-form-lab-selection';

const ASSET_ORDER: AssetKind[] = [
  'native', 'sudt', 'xudt', 'dao', 'spore', 'object', 'identity', 'other',
];
const LOCK_ORDER: LockKind[] = ['sighash', 'multisig', 'acp', 'omnilock', 'other'];

export type RelicSampleBasis = 'asset' | 'lock' | 'capacity' | 'data' | 'hash';

export interface RelicSample {
  cell: Cell;
  basis: RelicSampleBasis;
  role: string;
}

function byVisualInterest(a: Cell, b: Cell): number {
  const dataDelta = observedLabDataBytes(b) - observedLabDataBytes(a);
  if (dataDelta !== 0) return dataDelta;
  const capacityDelta = b.capacity - a.capacity;
  if (capacityDelta !== 0) return capacityDelta;
  return a.id - b.id;
}

function representativeOrder(cells: Cell[]): Cell[] {
  const sorted = [...cells].sort((a, b) => (
    a.capacity - b.capacity
    || observedLabDataBytes(a) - observedLabDataBytes(b)
    || a.id - b.id
  ));
  const middle = Math.floor((sorted.length - 1) / 2);
  const ordered: Cell[] = [];
  for (let distance = 0; distance < sorted.length; distance += 1) {
    const left = middle - distance;
    const right = middle + distance;
    if (left >= 0) ordered.push(sorted[left]);
    if (distance > 0 && right < sorted.length) ordered.push(sorted[right]);
  }
  return ordered;
}

/**
 * Select unique, real Cells for A-direction calibration. Taxonomies come first,
 * followed by semantic extremes and evenly distributed hash identities.
 */
export function selectRelicSamples(
  snapshot: CellGalaxySnapshot,
  limit = 12,
): RelicSample[] {
  if (limit <= 0 || snapshot.cells.length === 0) return [];
  const samples: RelicSample[] = [];
  const used = new Set<number>();
  const add = (basis: RelicSampleBasis, role: string, candidates: Cell[]) => {
    if (samples.length >= limit) return;
    const cell = candidates.find((candidate) => !used.has(candidate.id));
    if (!cell) return;
    used.add(cell.id);
    samples.push({ cell, basis, role });
  };

  for (const asset of ASSET_ORDER) {
    const candidates = representativeOrder(
      snapshot.cells.filter((cell) => (cell.asset_kind ?? 'other') === asset),
    );
    add('asset', `ASSET / ${asset.toUpperCase()}`, candidates);
  }

  add(
    'data',
    'CONTENT / HIGH',
    [...snapshot.cells].sort((a, b) => (
      observedLabDataBytes(b) - observedLabDataBytes(a) || a.id - b.id
    )),
  );
  add(
    'capacity',
    'MASS / HIGH',
    [...snapshot.cells].sort((a, b) => b.capacity - a.capacity || a.id - b.id),
  );
  add(
    'capacity',
    'MASS / LOW',
    [...snapshot.cells].sort((a, b) => a.capacity - b.capacity || a.id - b.id),
  );

  for (const lock of LOCK_ORDER) {
    const candidates = snapshot.cells
      .filter((cell) => (cell.lock_kind ?? 'other') === lock)
      .sort(byVisualInterest);
    add('lock', `LOCK / ${lock.toUpperCase()}`, candidates);
  }

  const byHash = [...snapshot.cells].sort((a, b) => (
    a.content_hash.localeCompare(b.content_hash) || a.id - b.id
  ));
  const stride = Math.max(1, Math.floor(byHash.length / Math.max(1, limit)));
  for (let offset = 0; offset < byHash.length && samples.length < limit; offset += stride) {
    const hash = byHash[offset]?.content_hash.replace(/^0x/, '').slice(0, 4).toUpperCase() ?? '0000';
    add('hash', `HASH / ${hash}`, byHash.slice(offset).concat(byHash.slice(0, offset)));
  }
  for (const cell of byHash) {
    add('hash', `HASH / ${cell.content_hash.replace(/^0x/, '').slice(0, 4).toUpperCase()}`, [cell]);
  }

  return samples;
}
