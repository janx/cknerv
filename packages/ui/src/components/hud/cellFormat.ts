import type { Cell } from '@cknerv/types';

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

const LOCK_LABEL: Record<string, string> = {
  sighash: 'sighash', multisig: 'multisig', acp: 'acp', omnilock: 'omnilock', other: 'other',
};
const ASSET_LABEL: Record<string, string> = {
  native: 'native', sudt: 'sUDT', xudt: 'xUDT', dao: 'DAO', spore: 'Spore', other: 'other',
};

export function formatLockKind(k: Cell['lock_kind']): string {
  return k ? (LOCK_LABEL[k] ?? k) : '—';
}
export function formatAssetKind(k: Cell['asset_kind']): string {
  return k ? (ASSET_LABEL[k] ?? k) : '—';
}

// Family colors — reuse the CELLS-panel palette (CellsPanel byLock/byAsset).
export const LOCK_COLORS: Record<string, string> = {
  sighash: '#27FF5A', multisig: '#4dd6ff', acp: '#ffb84d', omnilock: '#9d7bd8', other: '#7C8794',
};
export const ASSET_COLORS: Record<string, string> = {
  native: '#E8E8E8', sudt: '#FF9830', xudt: '#ffb84d', dao: '#27FF5A', spore: '#ff6ba6', other: '#7C8794',
};
