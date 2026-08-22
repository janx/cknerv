import { DATA_HEX_TRUNCATION_MARKER } from '@cknerv/types';
import type { Cell } from '@cknerv/types';
import { HUD_COLORS } from './hudTheme';

const SHANNONS_PER_CKB = 100_000_000n;

const CKB_TIERS: ReadonlyArray<{ threshold: bigint; suffix: string }> = [
  { threshold: 1_000_000_000n * SHANNONS_PER_CKB, suffix: 'G CKB' },
  { threshold: 1_000_000n * SHANNONS_PER_CKB, suffix: 'M CKB' },
  { threshold: 1_000n * SHANNONS_PER_CKB, suffix: 'K CKB' },
];

/** Every CKB quantity on the HUD reads in one family — `61 CKB`,
 *  `12.5 K CKB`, `57.86 G CKB` — so a Cell, a DAO total, and the whole
 *  chain's live capacity are the same unit at different magnitudes. Byte
 *  prefixes, not finance ones: 1 CKB is 1 CKByte of purchasable state, so
 *  these double as state sizes. Amounts under 1,000 CKB keep their exact
 *  figure to the hundredth. */
export function formatCkb(shannons: number | bigint, signed = false): string {
  const amount = typeof shannons === 'bigint'
    ? shannons
    : BigInt(Math.round(shannons));
  const negative = amount < 0n;
  const absolute = negative ? -amount : amount;
  const tier = CKB_TIERS.find((candidate) => absolute >= candidate.threshold)
    ?? { threshold: SHANNONS_PER_CKB, suffix: 'CKB' };
  const hundredths = (absolute * 100n + tier.threshold / 2n) / tier.threshold;
  const whole = hundredths / 100n;
  const fraction = (hundredths % 100n)
    .toString()
    .padStart(2, '0')
    .replace(/0+$/, '');
  const body = `${whole.toLocaleString('en-US')}${fraction ? `.${fraction}` : ''} ${tier.suffix}`;
  const sign = negative ? '−' : signed && amount > 0n ? '+' : '';
  return `${sign}${body}`;
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

/** A wall-clock instant, in UTC, spelled `2026-08-15 05:47 UTC`. Assembled
 *  from the epoch parts by hand: every locale prints this differently and a
 *  HUD that says when a deposit happened must say the same thing on every
 *  machine. Minutes are the floor — nothing on this surface is a stopwatch. */
export function formatWallClock(ms: number): string {
  if (!Number.isFinite(ms)) return 'UNKNOWN';
  const at = new Date(ms);
  const stamp = at.getTime();
  if (Number.isNaN(stamp)) return 'UNKNOWN';
  const pad = (value: number, width = 2) => String(value).padStart(width, '0');
  return `${pad(at.getUTCFullYear(), 4)}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())} ${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())} UTC`;
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
