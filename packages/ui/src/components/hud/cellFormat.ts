import type { Cell } from '@cknerv/types';
import type { ByteBudgetSegmentKey } from '../../derives/cellByteBudget.derive';
import type { CellIdentityProofKind } from '../../derives/cellIdentityProof.derive';
import { HUD_COLORS } from './hudTheme';

const SHANNONS_PER_CKB = 100_000_000n;

const CKB_TIERS: ReadonlyArray<{ threshold: bigint; suffix: string }> = [
  { threshold: 1_000_000_000n * SHANNONS_PER_CKB, suffix: 'G·CKB' },
  { threshold: 1_000_000n * SHANNONS_PER_CKB, suffix: 'M·CKB' },
  { threshold: 1_000n * SHANNONS_PER_CKB, suffix: 'K·CKB' },
];

/** Every CKB quantity on the HUD reads in one family — `61 CKB`,
 *  `12.5 K·CKB`, `57.86 G·CKB` — so a Cell, a DAO total, and the whole
 *  chain's live capacity are the same unit at different magnitudes. Byte
 *  prefixes, not finance ones: 1 CKB is 1 CKByte of purchasable state, so
 *  these double as state sizes. Amounts under 1,000 CKB keep their exact
 *  figure to the hundredth.
 *
 *  ⭐ THE MAGNITUDE BINDS TO THE UNIT WITH `·`, NOT WITH A SPACE. `12.5 K CKB`
 *  put the same amount of air between the number and its prefix as between the
 *  prefix and the unit, so a row read as three tokens where there are two: a
 *  figure, and the unit it is counted in. The house separator closes the unit
 *  up — the same mark, and the same job, as `CKB·01`'s.
 *
 *  ⚠️ It can therefore ABUT the phrase separator, as in
 *  `+1.42 M·CKB · +0.017% / 24H`. That reads correctly and is the point: the
 *  tight mark is inside a token, the spaced one is between them. */
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

/** A transaction hash, in the ONE truncation this card spells one in.
 *
 * The masthead's outpoint and ORIGIN TX's line name the same transaction on
 * the same dossier, and they used to shorten it two different ways —
 * `0x2f4e…70391cb4` up top against `0x2f4e53fb…391cb4` six rows down. Two
 * truncations of one hash read as two hashes, which is the whole complaint:
 * a reader comparing them cannot see that they agree.
 *
 * Six head and eight tail: the `0x` and two bytes at the front, four at the
 * back — enough of the tail that two hashes sharing a prefix still differ.
 * A SCRIPT hash is a different subject and keeps its own (12, 9): it is an
 * identity a reader matches against a registry, not a transaction they look
 * up beside this one. */
export function formatTxHash(txHash: string): string {
  return midTruncate(txHash, 6, 8);
}

export function formatOutpoint(txHash: string, index: number): string {
  return `${formatTxHash(txHash)}#${index}`;
}

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

/** The HUD's one byte-size family — `102 B`, `6,947 B` — grouped with the
 *  locale pinned so the figure cannot drift with the viewer's runtime.
 *
 *  It takes an EXACT count, never a hex window. A `data_hex` that ends in
 *  DATA_HEX_TRUNCATION_MARKER is a bounded PREVIEW of the bytes; the size of
 *  the data is carried separately and in full (`Cell.data_bytes`), so a
 *  clipped preview never clips the number beside it. What is partial is the
 *  observation, and the content window is where that is said. */
export function formatDataSize(bytes: number): string {
  const exact = Number.isFinite(bytes) ? Math.max(0, Math.trunc(bytes)) : 0;
  return `${exact.toLocaleString('en-US')} B`;
}

/** The unrounded CKB reading of a shannon amount, for the `title` under a
 *  `formatCkb` figure that had to round. Two decimals is where CKB stops
 *  being interesting; below that the shannon count itself is the evidence,
 *  which is what the fallback prints when the amount is not a number at
 *  all. */
export function formatExactCkb(shannons: number | bigint | string): string {
  try {
    const amount = BigInt(shannons);
    const negative = amount < 0n;
    const absolute = negative ? -amount : amount;
    const whole = absolute / SHANNONS_PER_CKB;
    const hundredths = (absolute % SHANNONS_PER_CKB) / 1_000_000n;
    return `${negative ? '−' : ''}${whole.toLocaleString('en-US')}${
      hundredths === 0n ? '' : `.${hundredths.toString().padStart(2, '0')}`
    } CKB`;
  } catch {
    return `${shannons} sh`;
  }
}

/** A transaction fee sits three to five orders of magnitude below the CKB the
 *  rest of the HUD counts in: `formatCkb` renders a 1,000-shannon fee as
 *  `0 CKB`, which is not a rounding, it is a different claim. Below one CKB
 *  the shannon count itself IS the reading; at or above it the house CKB
 *  grammar takes over, so a fee and a capacity never disagree about units.
 *  Returns null when the source stated something that is not a plain unsigned
 *  decimal — an unparsed figure is never printed as if it were a number. */
export function formatFeeShannons(value: string): string | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const amount = BigInt(trimmed);
  if (amount >= SHANNONS_PER_CKB) return formatCkb(amount);
  return `${amount.toLocaleString('en-US')} SHANNON${amount === 1n ? '' : 'S'}`;
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
  object: 'Digital Object',
  identity: 'Identity',
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

// ——— The content palette ———————————————————————————————————————————————
//
// A lock family, an asset family and the census's class mix are CONTENT: they
// name what a thing IS and say nothing about whether it is well. So they draw
// from their own bands and never from the reserved layers — semantics
// (`nominal`/`caution`/`warning`/`danger`/`crit`, which name a state and only
// a state) or chrome (`orange`, the instrument's own frame). Half this table
// used to be borrowed: multisig and sUDT wore chrome orange, ACP and DAO wore
// caution yellow, so an ordinary wallet cell lit its whole card in the two
// colors the HUD raises alarms with.
//
// Six bands, and the band names the nature of the thing:
//   consensus  cyanWire   the default lock, bare CKB, a Cell's own data
//   authority  #6E7CFF    authorization past the default signature
//   script     #9D7BD8    script-defined identity (omnilock, spore objects)
//   token      #3FC9A6    an issued fungible token
//   value      lockedGold value held under lock — DAO, capacity, amounts
//   artifact   #E06BC8    a crafted object, minted one at a time
//   identity   #3E6BE8    a cell whose job is to name somebody
//   unlisted   #33424F    a family nothing could name
//
// A band carries at most two steps, and kinds that share a nature share a band
// across axes on purpose: the plainest lock and the plainest asset are both
// cyan, the most programmable of each is both violet. That is what keeps this
// a house palette instead of a rainbow with one hue per key.
//
// Every member clears an RGB distance of 40 from every semantic tone, from
// chrome orange and from both mesh identity wires. `hudDiscipline.test.ts`
// walks these tables and fails any future member that slides back onto a
// reserved hue; `sighash`/`native` are the one allowlisted borrow, because
// plain consensus content IS the consensus's own color.
export const CONTENT_BANDS = {
  consensus: HUD_COLORS.cyanWire,
  authority: '#6E7CFF',
  /** Second step of the authority band: a signature lock anyone may pay into. */
  authorityOpen: '#9FC4FF',
  script: '#9D7BD8',
  token: '#3FC9A6',
  /** Second step of the token band: the extensible standard beside the simple
   *  one. Held a long way up the band because sUDT and xUDT are adjacent
   *  segments in the CELLS asset bar, where two neighbouring steps have to be
   *  told apart with no label between them. */
  tokenExtended: '#95EAD3',
  value: HUD_COLORS.lockedGold,
  /** A digital object: a Spore cluster, an M-NFT, a COTA item, a CKBFS file.
   *  Magenta is the one strong hue the house had not spent, and these are
   *  the one nature that rhymes with nothing else on the other axis — a
   *  thing somebody made, rather than a rule about who may spend it. */
  artifact: '#E06BC8',
  /** A cell that names somebody: `.bit`, did:ckb. Deliberately a blue near
   *  `authority`, because it rhymes across axes the way the palette's other
   *  pairs do — authority answers "who may", identity answers "who is" —
   *  while staying 56 apart, which is past the separation floor. */
  identity: '#3E6BE8',
  /** The unremarkable majority in a mix bar — quiet by design, near the HUD's
   *  own dim, because "bare CKB" is the background against which the rest reads. */
  plain: '#607789',
  unlisted: '#33424F',
} as const;

// Shared lock/asset family palette — the SINGLE source used by BOTH the CELLS
// panel (CellsPanel byAsset/byLock bars) and the cell-detail panel, so a given
// lock/asset family renders the same color in either place.
export const LOCK_COLORS: Record<string, string> = {
  sighash: CONTENT_BANDS.consensus, multisig: CONTENT_BANDS.authority,
  acp: CONTENT_BANDS.authorityOpen, omnilock: CONTENT_BANDS.script,
  other: CONTENT_BANDS.unlisted,
};
export const ASSET_COLORS: Record<string, string> = {
  native: CONTENT_BANDS.consensus, sudt: CONTENT_BANDS.token,
  xudt: CONTENT_BANDS.tokenExtended, dao: CONTENT_BANDS.value,
  spore: CONTENT_BANDS.script, other: CONTENT_BANDS.unlisted,
  object: CONTENT_BANDS.artifact, identity: CONTENT_BANDS.identity,
};

/** The census's three-class partition, in the chain-capacity bar's category
 *  hues (DAO, token-like, bare CKB) so the stage-versus-chain mix bars and
 *  the whole-chain capacity bar read as one color system —
 *  `assetEcosystem.derive.ts` reads these very values rather than keeping a
 *  second copy that could drift.
 *
 *  It said that while it was three-quarters true: the three named classes read
 *  from here and the FALLBACK — the branch that fires for a category nothing
 *  in this table names — spelled a bright cyan of its own, so the ONE bucket
 *  the bar knows least about was the loudest thing in it. It takes
 *  `CONTENT_BANDS.unlisted` now, with the rest of the house's unnamed
 *  families. */
export const CLASS_MIX_COLORS = {
  dao: CONTENT_BANDS.value, typed: CONTENT_BANDS.token, plain: CONTENT_BANDS.plain,
} as const;

// One cell's bytes, decomposed. Each segment wears the content band of the
// axis it measures, so the bar says the same four words the register above it
// does: CAP is value, LOCK is authorization, TYPE is the token family, DATA is
// knowledge. It used to wear chrome orange, nominal green and caution yellow
// at once — a four-segment bar carrying three reserved layers, which made
// every cell's byte composition look like a status readout with an opinion
// about the Cell's health.
//
// The LOCK segment takes the authority BAND rather than the cyan the default
// lock borrows: cyan belongs to the DATA segment here, and one bar cannot
// spend the same color twice.
//
// Why it lives in this file rather than beside the bar that draws it: TWO
// surfaces decompose a cell into these same four numbers — `CellByteBudget`'s
// stacked bar in the dossier, and the composition orbit `CellSemanticOrbit`
// draws around the selected Cell on stage — and for the life of both they
// painted one decomposition in two unrelated palettes, the orbit's capacity
// arc landing 34.4 from chrome orange. A table two layers have to share
// belongs where both may read it, which is here: the scene's derive already
// reaches into this file for the asset bands, and a derive that imported the
// DOM component would have the dependency graph upside down.
export const SEGMENT_COLORS: Record<ByteBudgetSegmentKey, string> = {
  cap: CONTENT_BANDS.value,
  lock: CONTENT_BANDS.authority,
  type: CONTENT_BANDS.token,
  data: CONTENT_BANDS.consensus,
};

// ——— The durability ramp ————————————————————————————————————————————————
//
// WHERE a digital object's content physically lives, as five steps of one
// ORDINAL: fully on the chain, split across two chains, leaning on a
// decentralized network somebody else keeps up, or depending on one operator's
// HTTPS server — and `unknown`, which means NOT YET MEASURED.
//
// It is a ramp rather than a set of bands, and that is the whole reason it is
// its own table. A lock family and an asset family are NOMINAL: omnilock is
// not more than sighash, it is other than it, so they draw from
// `CONTENT_BANDS` where a band names a nature. A durability tier is ordered —
// on-chain outranks BTC+CKB outranks IPFS outranks somebody's server — so the
// colour has to rank, and a reader has to be able to put two of these in order
// with no legend in front of them.
//
// What it must NOT be is the severity ladder. The tiers shipped as
// `nominal → cyanWire → caution → ember → dim`, which is four reserved layers
// spliced into one ordinal: the middle of it read left to right as the HUD's
// own gradient for something going wrong, and the block that draws it rails
// and washes a whole card in the tier's colour. So an ordinary Spore hosted on
// IPFS wore caution yellow and a Spore on a web server wore `ember` as a
// border — the treatment a degraded state gets everywhere else, for a fact
// that is not a fault. Storage on somebody's server is a WEAKER PROMISE, not
// an alarm, and the palette has no business raising one on its behalf. It cost
// `ember` its own rule as well, which is that it is never an accent, never a
// border, only ever a reading.
//
// So the ramp is cold-and-bright to ash, on an axis the reserve does not own:
// permanence is lit, dependence on somebody else fades toward the plate. Every
// step clears every reserved hue, and the tightest adjacent pair is 51.4 —
// past the separation floor — so it ranks without a legend and no rung reads
// as a verdict.
//
// The second rung is `#95EAD3` to the digit, which is also
// `CONTENT_BANDS.tokenExtended`. It is written out here rather than read from
// the band, on purpose and against this file's usual instinct: two independent
// decisions happen to have landed on one pale teal, and wiring them together
// would mean that widening the sUDT/xUDT edge on the CELLS asset bar silently
// moved a durability rung and could collapse this ramp's ordering. A shared
// VALUE is a coincidence; a shared NAME would be a claim that a BTC+CKB object
// is an extended token, which it is not. `hudDiscipline.test.ts` holds the
// coincidence on the record so it cannot drift into either a defect or a
// dependency unnoticed.
export const STORAGE_TIER_COLORS: Readonly<Record<string, string>> = {
  /** Never leaves the chain: on-chain data or `ckbfs://`. The brightest cold
   *  ink the palette has, because this is the only tier that promises nothing
   *  outside consensus. */
  pure_ckb: HUD_COLORS.cyanInk,
  /** Two chains instead of one, both of them permanent — a step down the ramp
   *  in brightness only, because nothing here depends on anybody. */
  btc_ckb: '#95EAD3',
  /** IPFS, Arweave: persists as long as a network somebody else runs keeps
   *  hosting it. The first rung where the promise is somebody else's. */
  decentralized_mixture: '#6FA9B8',
  /** One operator's `https://`. They can stop paying, and then the content is
   *  gone — so this is the ash end of the ramp, not the loud end. */
  centralized_mixture: '#4A6270',
  /** NOT YET MEASURED, emphatically not "off-chain". It takes the band the
   *  whole house gives a thing nothing could place, because that is exactly
   *  what it is: unread, and quiet about it. */
  unknown: CONTENT_BANDS.unlisted,
};

// ——— The three proofs a Cell offers about itself ————————————————————————
//
// WHERE it sits, WHAT it holds, WHEN it was born — one triad, drawn on two
// surfaces that never see each other's source: the scene glyph whose three
// arms point at the proofs, and the derive that writes the label beside each
// one. WHEN was promoted to `goldInk` on both; the other two stayed literals
// in both files, so a triad was two-thirds named and one-third typed twice.
//
// The values do not move here. What moves is where they live: a colour drawn
// by two files is a table, and the table is the thing the palette holds.
export const IDENTITY_PROOF_COLORS: Readonly<Record<CellIdentityProofKind, string>> = {
  /** WHERE — the outpoint locator. */
  address: '#9DF7FF',
  /** WHAT — the content address. */
  content: '#C7A7FF',
  /** WHEN — the birth anchor. The bright gold text tier, which is what a
   *  label is, and which the whole birth-anchor family already reads. */
  anchor: HUD_COLORS.goldInk,
};

/** The smallest marks on the specimen artwork: the role glyphs pinned to the
 *  braid in `CellSemanticMorphologyOverlay`, drawn as scene points AND as the
 *  DOM label beside each one.
 *
 *  A facet glyph is not one of the four byte axes and no content band names
 *  it, so this is its own value rather than a borrow — but it is drawn from
 *  two dialects in one file, which is why it is a name and not a literal. */
export const FACET_GLYPH_COLOR = '#FEF3C7';

/** A small protocol-family accent for a typed asset. Identity remains the
 *  exact type hash; this only says which standard's rules the cell is playing
 *  by, so it is a category palette like any other and walks the same reserve.
 *
 *  It lived in `cellSemantics.derive.ts` as three literals returned from a
 *  branch, which is a palette with no table — nothing could walk it, and
 *  nothing did. */
export const ASSET_STANDARD_ACCENTS = {
  xudt: '#C8FF72',
  sudt: '#72FFD4',
  /** A typed asset whose standard we do not recognise. */
  other: '#D8B4FF',
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
