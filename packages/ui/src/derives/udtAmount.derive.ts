import { DATA_HEX_TRUNCATION_MARKER } from '@cknerv/types';
import type { AssetKind, Cell } from '@cknerv/types';

/** sUDT/xUDT output data opens with a u128 little-endian balance. The field is
 *  the FIRST 16 bytes, which is what makes the amount decodable from a
 *  `data_hex` the producer capped: the truncation marker only ever eats the
 *  TAIL, so a cell that really holds 16+ bytes always ships this prefix. */
export const UDT_AMOUNT_BYTES = 16;

/** One bead per thousands-group of the written amount, and no more than the
 *  braid can space out legibly. u128 runs to 39 digits — 13 groups — so the
 *  very top of the range saturates rather than turning into a dotted line. */
export const UDT_MAX_BEADS = 12;

const UDT_ASSET_KINDS: readonly AssetKind[] = ['sudt', 'xudt'];

const HEX_PREFIX = /^[0-9a-fA-F]+$/;

/** The two families whose cell data IS a quantity. Anything else — including a
 *  spore that happens to open with 16 bytes — reads its data generically. */
export function isUdtAssetKind(kind: AssetKind | undefined): boolean {
  return kind !== undefined && UDT_ASSET_KINDS.includes(kind);
}

/** Decode the token balance a udt cell carries, or null when this cell is not
 *  a token cell, does not claim 16 bytes, or shipped a prefix we cannot read.
 *  Null is a first-class answer: the caller keeps the generic mark channel
 *  rather than inventing a quantity. */
export function decodeUdtAmount(cell: Cell): bigint | null {
  if (!isUdtAssetKind(cell.asset_kind)) return null;
  if (!Number.isFinite(cell.data_bytes) || cell.data_bytes < UDT_AMOUNT_BYTES) return null;
  const hex = cell.data_hex;
  if (typeof hex !== 'string') return null;
  const observed = hex.endsWith(DATA_HEX_TRUNCATION_MARKER) ? hex.slice(0, -1) : hex;
  if (!observed.startsWith('0x')) return null;
  const prefix = observed.slice(2, 2 + UDT_AMOUNT_BYTES * 2);
  if (prefix.length < UDT_AMOUNT_BYTES * 2 || !HEX_PREFIX.test(prefix)) return null;
  let amount = 0n;
  for (let index = UDT_AMOUNT_BYTES - 1; index >= 0; index -= 1) {
    amount = (amount << 8n) | BigInt(Number.parseInt(prefix.slice(index * 2, index * 2 + 2), 16));
  }
  return amount;
}

/** How a quantity becomes a bead train. Magnitude only: decimals are unknown
 *  at galaxy scope, and on a per-group scale they are a constant offset the
 *  detail view's exact `amount`/`decimals` readout already supplies. */
export interface UdtQuantitySignature {
  /** Decimal digits of the raw on-chain amount. */
  digits: number;
  /** Beads on the train — one per thousands-group, the way the number reads
   *  when it is written down. */
  beadCount: number;
  /** Leading-significand tightening in [0.8, 1.2]: within one magnitude, a
   *  9.9x amount wears fatter beads than a 1.0x one. */
  beadScale: number;
}

export function udtQuantitySignature(amount: bigint): UdtQuantitySignature {
  const text = amount.toString();
  const digits = text.length;
  const beadCount = Math.max(1, Math.min(UDT_MAX_BEADS, Math.ceil(digits / 3)));
  const significand = amount === 0n
    ? 1
    : Number.parseFloat(`${text[0]}.${text.slice(1, 3) || '0'}`);
  const beadScale = Math.max(0.8, Math.min(1.2, 0.8 + ((significand - 1) / 9) * 0.4));
  return { digits, beadCount, beadScale };
}

/** The quantity a cell's braid should count out, or null when it has none. */
export function cellUdtQuantitySignature(cell: Cell): UdtQuantitySignature | null {
  const amount = decodeUdtAmount(cell);
  return amount === null ? null : udtQuantitySignature(amount);
}
