import { DATA_HEX_TRUNCATION_MARKER } from '@cknerv/types';
import type { AssetKind, Cell, CellTag, LockKind, ShapeSeed } from '@cknerv/types';

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
  object: 6,
  identity: 7,
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
  // Violet for a made thing, cyan-teal for a name. Both sit in the two
  // regions this palette had not spent; the closest neighbour either has is
  // 0.35 away, which is wider than the native/sudt pair the galaxy already
  // ships.
  object: [0.72, 0.38, 0.95],
  identity: [0.32, 0.88, 0.86],
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
  const withoutMarker = dataHex.endsWith(DATA_HEX_TRUNCATION_MARKER)
    ? dataHex.slice(0, -1)
    : dataHex;
  const body = withoutMarker.startsWith('0x')
    ? withoutMarker.slice(2)
    : withoutMarker;
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

/** How far a collection may rotate its class accent, in turns.
 *
 *  Small on purpose. The accent's first job is to say which CLASS a cell
 *  belongs to, and a free per-collection colour would dissolve the palette
 *  the discipline matrix keeps apart — spore green wandering into the object
 *  violet it is supposed to be distinguishable from. A seventh of a turn is
 *  enough for a Nervape swarm to read as one family against another green
 *  swarm beside it, and far too little to read as a different class.
 *  The cartouche can afford three times this ([`MINT_MARK_MAX_HUE_SHIFT`]);
 *  it is a mark ON a body whose own colour still says the class. */
export const COLLECTION_ACCENT_HUE_SPAN = 0.07;

function mixWord(value: number): number {
  let mixed = value >>> 0;
  mixed ^= mixed >>> 16;
  mixed = Math.imul(mixed, 0x7feb_352d);
  mixed ^= mixed >>> 15;
  mixed = Math.imul(mixed, 0x846c_a68b);
  mixed ^= mixed >>> 16;
  return mixed >>> 0;
}

/** The collection channel's signed lean, in [-1, 1]; 0 for a cell with no kin.
 *
 *  THE hue law, and deliberately the only one: every surface a collection
 *  touches — the galaxy body, the braid-LOD cartouche, the detail portrait —
 *  scales THIS number rather than hashing the collection again its own way.
 *  Two cells the chain calls kin therefore cannot disagree anywhere, which is
 *  a property the wire seed alone does not buy: M2a derived the portrait's
 *  tint from the enrichment collection STRING, so the same collection reached
 *  two surfaces through two different hashes.
 *
 *  A `[0, 0]` seed is a real collection like any other — absence is the key
 *  being absent, never a value. */
export function collectionHueLean(seed: ShapeSeed | null | undefined): number {
  if (seed === null || seed === undefined) return 0;
  const word = mixWord((seed[0] >>> 0) ^ mixWord((seed[1] >>> 0) ^ 0x9e37_79b1));
  return (mixWord(word) / 0x1_0000_0000) * 2 - 1;
}

/** Rotate an accent's hue by `turns`, keeping saturation and lightness.
 *
 *  Every surface that tints by collection turns its hue HERE — the galaxy's
 *  CPU-written colours and the portrait's alike — so two views of one
 *  collection cannot drift onto two implementations that merely agree today.
 *  Plain numbers rather than a `THREE.Color`, because the derives are pure
 *  and the galaxy's colours never become one. */
export function rotateAccentHue(
  accent: CellVisualAccent,
  turns: number,
): CellVisualAccent {
  if (turns === 0) return accent;
  const [r, g, b] = accent;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const span = max - min;
  // Grey has no hue to rotate, so there is nothing a collection could say.
  if (span <= 1e-9) return accent;
  const saturation = lightness > 0.5
    ? span / (2 - max - min)
    : span / (max + min);
  let hue: number;
  if (max === r) hue = ((g - b) / span + (g < b ? 6 : 0)) / 6;
  else if (max === g) hue = ((b - r) / span + 2) / 6;
  else hue = ((r - g) / span + 4) / 6;
  hue = (((hue + turns) % 1) + 1) % 1;

  const q = lightness < 0.5
    ? lightness * (1 + saturation)
    : lightness + saturation - lightness * saturation;
  const p = 2 * lightness - q;
  const channel = (t: number): number => {
    const shifted = ((t % 1) + 1) % 1;
    if (shifted < 1 / 6) return p + (q - p) * 6 * shifted;
    if (shifted < 1 / 2) return q;
    if (shifted < 2 / 3) return p + (q - p) * (2 / 3 - shifted) * 6;
    return p;
  };
  return [channel(hue + 1 / 3), channel(hue), channel(hue - 1 / 3)];
}

export function accentFor(
  asset: AssetKind,
  tag: CellTag | null,
  collectionSeed?: ShapeSeed | null,
): CellVisualAccent {
  // A renderer-owned tag displaces the class accent entirely, and it is a
  // different channel with its own palette — a collection has no standing to
  // rotate it. Kinship shifts the CLASS colour or nothing.
  const tagged = tag && TAG_ACCENT[tag];
  if (tagged) return tagged;
  return rotateAccentHue(
    ASSET_ACCENT[asset],
    collectionHueLean(collectionSeed) * COLLECTION_ACCENT_HUE_SPAN,
  );
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
    accent: accentFor(asset, cell.tag, cell.collection_seed),
  };
}

// Cell point sizes in world units. A stable per-id range prevents the far field
// from becoming an evenly punched dot screen; tags remain larger landmarks.
const GENERIC_CELL_POINT_SIZE = 1.35;
const TAGGED_CELL_POINT_SIZE = 2.75;

/** A Cell's presentation size (world units) — the ONE number every layer
 *  that draws a sprite AT a Cell reads: the body writes it into `aSize`, the
 *  write flare shares that buffer, and a landing flash resolves it from the
 *  cache for its own geometry. Pure in the id and the tag, so it may be
 *  recomputed anywhere and always agrees with the body. */
export function cellPointSize(cell: Pick<Cell, 'id' | 'tag'>): number {
  let hash = Math.imul(cell.id >>> 0, 0x9e3779b1) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b) >>> 0;
  const u = ((hash >>> 8) & 0xffff) / 0xffff;
  const morphology = 0.58 + 0.72 * u * u
    + (cell.tag === null && u > 0.975 ? 0.48 : 0);
  return (cell.tag === null ? GENERIC_CELL_POINT_SIZE : TAGGED_CELL_POINT_SIZE)
    * morphology;
}
