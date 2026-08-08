import type { Cell } from '@cknerv/types';
import { HUD_COLORS } from './hudTheme';

export function formatCkb(shannons: number): string {
  return `${(shannons / 100_000_000).toFixed(2)} CKB`;
}

export function midTruncate(s: string, head: number, tail: number): string {
  if (s.length <= head + tail + 1) return s;
  return `${s.slice(0, head)}…${s.slice(s.length - tail)}`;
}

export function formatOutpoint(txHash: string, index: number): string {
  return `${midTruncate(txHash, 6, 8)}#${index}`;
}

/** Keeps `0x` + first N hex chars; appends `…` for any tail. */
export function formatDataHex(hex: string, charLimit: number): string {
  if (hex.length <= charLimit + 1) return hex;
  return `${hex.slice(0, charLimit)}…`;
}

export function formatCellKind(k: Cell['tag']): string {
  if (k === null) return 'GENERIC';
  return k.toUpperCase();
}

/** Humanized elapsed span, largest-two-units. Clamps negatives to 0s. */
/** Chain block reference in the HUD's grouped house style (`#20,100,194`).
 *  Locale pinned so grouping cannot drift with the viewer's runtime. */
export function formatBlockRef(block: number): string {
  return `#${block.toLocaleString('en-US')}`;
}

export function formatAge(bornAtMs: number, nowMs: number): string {
  const ms = Math.max(0, nowMs - bornAtMs);
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

/** Byte count of a `0x` hex string. A trailing `…` (upstream truncation)
 *  yields an `N B+` marker so the user knows it was clipped. */
export function formatDataSize(hex: string): string {
  const truncated = hex.endsWith('…');
  const body = (truncated ? hex.slice(0, -1) : hex).replace(/^0x/, '');
  const bytes = Math.floor(body.length / 2);
  return `${bytes} B${truncated ? '+' : ''}`;
}

/** Format one exact integer token amount with validated decimal places. */
export function formatSemanticAssetAmount(
  value: string,
  decimals?: number,
): string {
  try {
    const amount = BigInt(value);
    if (decimals == null || decimals === 0) return amount.toString();
    if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > 255) {
      return value;
    }
    const negative = amount < 0n;
    const digits = (negative ? -amount : amount)
      .toString()
      .padStart(decimals + 1, '0');
    const whole = digits.slice(0, -decimals);
    const fraction = digits.slice(-decimals).replace(/0+$/, '');
    return `${negative ? '−' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
  } catch {
    return value;
  }
}

const LOCK_LABEL: Record<string, string> = {
  sighash: 'Sighash',
  multisig: 'Multisig',
  acp: 'Anyone Can Pay',
  omnilock: 'Omnilock',
  other: 'Custom lock',
};
const ASSET_LABEL: Record<string, string> = {
  native: 'Native CKB',
  sudt: 'sUDT',
  xudt: 'xUDT',
  dao: 'Nervos DAO',
  spore: 'Spore',
  other: 'Custom type',
};

export function formatLockKind(k: Cell['lock_kind']): string {
  return k ? (LOCK_LABEL[k] ?? k) : 'Unknown';
}
export function formatAssetKind(k: Cell['asset_kind']): string {
  return k ? (ASSET_LABEL[k] ?? k) : 'Unknown';
}

// Shared lock/asset family palette — the SINGLE source used by BOTH the CELLS
// panel (CellsPanel byAsset/byLock bars) and the cell-detail panel, so a given
// lock/asset family renders the same color in either place.
export const LOCK_COLORS: Record<string, string> = {
  sighash: HUD_COLORS.cyanWire, multisig: HUD_COLORS.orange, acp: HUD_COLORS.caution,
  omnilock: '#9d7bd8', other: '#33424f',
};
export const ASSET_COLORS: Record<string, string> = {
  native: HUD_COLORS.cyanWire, sudt: HUD_COLORS.orange, xudt: '#ffb84d',
  dao: HUD_COLORS.caution, spore: '#9d7bd8', other: '#33424f',
};
