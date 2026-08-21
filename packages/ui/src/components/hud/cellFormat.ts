import { DATA_HEX_TRUNCATION_MARKER } from '@cknerv/types';
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

/** Byte count of a `0x` hex string. A trailing DATA_HEX_TRUNCATION_MARKER
 *  (upstream truncation) yields an `N B+` marker so the user knows it was
 *  clipped. The `…` this function's display siblings append is a separate,
 *  UI-side elision. */
export function formatDataSize(hex: string): string {
  const truncated = hex.endsWith(DATA_HEX_TRUNCATION_MARKER);
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

/** Nothing named this script. Deliberately not "custom": an unrecognized
 *  script is one we cannot name, which is a different claim from one nobody
 *  else can either. */
const UNLISTED = 'UNLISTED';
/** The cell carries no taxonomy at all (persisted before it existed). */
const UNKNOWN = 'UNKNOWN';

// The scripts cknerv can name from the node alone, spelled exactly as the
// script index spells them, so an enriched and a CKB-only dashboard say the
// same word about the same script. This is NOT a catalogue of the ecosystem's
// scripts — naming those is the index's job (`SemanticScript.name`), and the
// families below are only the ones whose code hashes cknerv itself pins.
const LOCK_LABEL: Record<string, string> = {
  sighash: 'Default Lock',
  multisig: 'Default Multisig',
  acp: 'Anyone-Can-Pay Lock',
  omnilock: 'OMNI Lock',
  other: UNLISTED,
};
const ASSET_LABEL: Record<string, string> = {
  native: 'Native CKB',
  sudt: 'Simple UDT',
  xudt: 'xUDT',
  dao: 'Nervos DAO',
  spore: 'Spore',
  other: UNLISTED,
};

export function formatLockKind(k: Cell['lock_kind']): string {
  return k ? (LOCK_LABEL[k] ?? k) : UNKNOWN;
}
export function formatAssetKind(k: Cell['asset_kind']): string {
  return k ? (ASSET_LABEL[k] ?? k) : UNKNOWN;
}

/** One identity for a cell's lock/type script, in priority order:
 *  the index's own family name, then the built-in table above, then an
 *  honest unlisted marker carrying the code hash we could not resolve.
 *
 *  The index knows ~66 script families; the built-in table knows 4. Whenever
 *  both have an opinion they agree, so this reads as one vocabulary that
 *  simply covers more ground when the index is reachable. */
export function formatScriptIdentity(
  builtin: string,
  script?: { name?: string; code_hash?: string } | null,
): string {
  const indexed = script?.name?.trim();
  if (indexed) return indexed;
  if (builtin !== UNLISTED && builtin !== UNKNOWN) return builtin;
  const codeHash = script?.code_hash;
  return codeHash ? `${UNLISTED} · ${midTruncate(codeHash, 6, 3)}` : builtin;
}

/** True once something actually named the script, so callers can stop
 *  rendering it in the unrecognized-family colour. */
export function isScriptNamed(
  kind: Cell['lock_kind'] | Cell['asset_kind'],
  script?: { name?: string } | null,
): boolean {
  return Boolean(script?.name?.trim()) || (Boolean(kind) && kind !== 'other');
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

/** The census's three-class partition, in the chain-capacity bar's category
 *  hues (DAO, token-like, bare CKB) so the stage-versus-chain mix bars and
 *  the whole-chain capacity bar read as one color system. */
export const CLASS_MIX_COLORS = {
  dao: '#ff9d52', typed: '#78f2b3', plain: '#607789',
} as const;

/** Capacity in CKBytes. 1 CKB buys exactly 1 byte of on-chain state, so a
 *  capacity is a byte count and both capacity ledgers spell it in one unit
 *  family — CK-KB/CK-MB/CK-GB — instead of the chain side counting coins
 *  while the stage side counts bytes. */
export function formatCkBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return `${bytes} CK-B`;
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} CK-GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} CK-MB`;
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(1)} CK-KB`;
  return `${Math.round(bytes)} CK-B`;
}

/** Palette colour for a script identity. A script the index named is a known
 *  script even when cknerv's own table could not place it, so it drops the
 *  near-black unrecognized-family swatch for plain ink — present, but
 *  claiming no family colour it has not earned. */
export function scriptIdentityColor(
  kind: Cell['lock_kind'] | Cell['asset_kind'],
  palette: Record<string, string>,
  script?: { name?: string } | null,
): string {
  if (!kind) return HUD_COLORS.dim;
  if (kind === 'other' && isScriptNamed(kind, script)) return HUD_COLORS.ink;
  return palette[kind] ?? HUD_COLORS.dim;
}
