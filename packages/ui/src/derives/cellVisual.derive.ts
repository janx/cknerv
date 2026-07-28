import type { AssetKind, Cell, CellTag, LockKind } from '@cknerv/types';

export type CellVisualAccent = readonly [number, number, number];
export type CellVisualSeeds = readonly [number, number, number, number];

/** Compact, renderer-facing description of one on-chain Cell. */
export interface CellVisualDescriptor {
  /** Stable numeric taxonomy consumed by the schema profile. */
  assetClass: number;
  /** Stable numeric taxonomy consumed by the witness field. */
  lockClass: number;
  /** Log-compressed physical mass in [0.84, 1.20]. */
  mass: number;
  /** Observed data density in [0, 1]. `data_hex` may be truncated. */
  payload: number;
  /** Four deterministic [0, 1] genome words from content_hash. */
  seeds: CellVisualSeeds;
  /** Small semantic accent; structure remains the primary encoding. */
  accent: CellVisualAccent;
}

const ASSET_CLASS: Record<AssetKind, number> = {
  native: 0,
  sudt: 1,
  xudt: 2,
  dao: 3,
  spore: 4,
  other: 5,
};

const LOCK_CLASS: Record<LockKind, number> = {
  sighash: 0,
  multisig: 1,
  acp: 2,
  omnilock: 3,
  other: 4,
};

const ASSET_ACCENT: Record<AssetKind, CellVisualAccent> = {
  native: [1.0, 0.68, 0.35],
  sudt: [0.98, 0.77, 0.28],
  xudt: [0.94, 0.48, 0.68],
  dao: [0.62, 0.78, 1.0],
  spore: [0.66, 0.92, 0.45],
  other: [1.0, 0.48, 0.42],
};

const TAG_ACCENT: Record<string, CellVisualAccent> = {
  ckbloom: [0.94, 0.67, 0.99],
  dex: [0.99, 0.83, 0.30],
  cf: [0.99, 0.64, 0.69],
  wallet: [0.43, 0.91, 0.72],
};

/** Only explicit, renderer-owned tags displace the galaxy's generic rose.
 * Unknown chain-generic tags retain the Cell field's default body colour. */
export function hasCellTagAccent(tag: CellTag | null): boolean {
  return tag !== null && Object.hasOwn(TAG_ACCENT, tag);
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/** Number of bytes visibly present in the wire payload. */
export function observedDataBytes(dataHex: string): number {
  const withoutEllipsis = dataHex.endsWith('…') ? dataHex.slice(0, -1) : dataHex;
  const body = withoutEllipsis.startsWith('0x')
    ? withoutEllipsis.slice(2)
    : withoutEllipsis;
  return Math.floor(body.length / 2);
}

/**
 * Parse four independent 32-bit words from the canonical content hash.
 * Invalid/legacy hashes degrade deterministically to zero rather than
 * introducing runtime randomness into a Cell's identity.
 */
export function contentHashSeeds(contentHash: string): CellVisualSeeds {
  const body = contentHash.startsWith('0x') ? contentHash.slice(2) : contentHash;
  const word = (offset: number): number => {
    const parsed = Number.parseInt(body.slice(offset, offset + 8), 16);
    return Number.isFinite(parsed) ? (parsed >>> 0) / 0xffff_ffff : 0;
  };
  return [word(0), word(8), word(16), word(24)];
}

/** Capacity is physical presence, but logarithmic so whales do not dominate. */
export function capacityMass(capacityShannons: number): number {
  const ckb = Math.max(0, capacityShannons / 1e8);
  const normalized = clamp01(
    Math.log2(1 + ckb / 61) / Math.log2(1 + 1_000_000 / 61),
  );
  return 0.84 + normalized * 0.36;
}

/** Log-compressed density of the observed (possibly truncated) data prefix. */
export function payloadDensity(dataHex: string): number {
  return clamp01(Math.log2(1 + observedDataBytes(dataHex)) / 10);
}

export function accentFor(asset: AssetKind, tag: CellTag | null): CellVisualAccent {
  return (tag && TAG_ACCENT[tag]) || ASSET_ACCENT[asset];
}

export function deriveCellVisual(cell: Cell): CellVisualDescriptor {
  const asset = cell.asset_kind ?? 'other';
  const lock = cell.lock_kind ?? 'other';
  return {
    assetClass: ASSET_CLASS[asset],
    lockClass: LOCK_CLASS[lock],
    mass: capacityMass(cell.capacity),
    payload: payloadDensity(cell.data_hex),
    seeds: contentHashSeeds(cell.content_hash),
    accent: accentFor(asset, cell.tag),
  };
}
