import type { AssetKind, Cell, LockKind, ShapeSeed } from '@cknerv/types';

export const CONTROLLED_RELIC_CAMERAS = ['front', 'side', 'three-quarter'] as const;
export type ControlledRelicCamera = (typeof CONTROLLED_RELIC_CAMERAS)[number];

export type ControlledRelicAxis =
  | 'type'
  | 'lock'
  | 'data-content'
  | 'data-size'
  | 'capacity'
  | 'collection'
  | 'fallback';

export interface ControlledRelicVariant {
  /** Lab-only counterfactual derived from one observed Cell. */
  cell: Cell;
  axis: ControlledRelicAxis;
  role: string;
  sourceCellId: number;
  synthetic: true;
}

export interface ControlledRelicRow {
  axis: ControlledRelicAxis;
  title: string;
  variants: readonly ControlledRelicVariant[];
}

const TYPE_FAMILIES: readonly AssetKind[] = [
  'native',
  'sudt',
  'xudt',
  'dao',
  'spore',
  'other',
  'object',
  'identity',
];
const LOCK_FAMILIES: readonly LockKind[] = [
  'sighash',
  'multisig',
  'acp',
  'omnilock',
  'other',
];

const TYPE_SEEDS: Record<Exclude<AssetKind, 'native'>, ShapeSeed> = {
  sudt: [0x1020_3040, 0x5060_7080],
  xudt: [0x1122_3344, 0x5566_7788],
  dao: [0x1234_abcd, 0x5678_ef01],
  spore: [0x1357_9bdf, 0x2468_ace0],
  other: [0x0bad_c0de, 0xfeed_face],
  object: [0x0b1e_c701, 0x4ac7_ed02],
  identity: [0x1de4_71fa, 0x5ea1_ed03],
};
const LOCK_SEEDS: Record<LockKind, ShapeSeed> = {
  sighash: [0x3141_5926, 0x5358_9793],
  multisig: [0x2718_2818, 0x2845_9045],
  acp: [0x1618_0339, 0x8874_9894],
  omnilock: [0x6a09_e667, 0xbb67_ae85],
  other: [0x3c6e_f372, 0xa54f_f53a],
};
/** Digests of live mainnet Spore Cluster ids — the first is Nervape's
 *  `0xd5852c19…`, the two after it are other clusters the node returns. Real
 *  ones because the claim on screen is that real collections separate. */
const COLLECTION_SEEDS: readonly (readonly [string, ShapeSeed])[] = [
  ['NERVAPE', [0xc5eb_230e, 0xcdd6_2018]],
  ['CLUSTER B', [0x9482_0ee0, 0x12ad_cca5]],
  ['CLUSTER C', [0x37bd_9b1f, 0xa7f9_1e37]],
];

const DATA_SEEDS: readonly ShapeSeed[] = [
  [0x1111_2222, 0x3333_4444],
  [0xaaaa_bbbb, 0xcccc_dddd],
  [0x0123_4567, 0x89ab_cdef],
];

function variant(
  source: Cell,
  axis: ControlledRelicAxis,
  role: string,
  overrides: Partial<Cell>,
): ControlledRelicVariant {
  return {
    cell: { ...source, ...overrides },
    axis,
    role,
    sourceCellId: source.id,
    synthetic: true,
  };
}

/** Build a controlled single-variable matrix from one observed Cell. These
 * counterfactuals never enter a cache and intentionally retain the source id,
 * so the lab cannot imply that it observed additional on-chain Cells. */
export function controlledRelicRows(source: Cell): ControlledRelicRow[] {
  const typeVariants = TYPE_FAMILIES.map((family) => variant(
    source,
    'type',
    `FAMILY / ${family.toUpperCase()}`,
    {
      asset_kind: family,
      type_shape_seed: family === 'native' ? null : TYPE_SEEDS[family],
    },
  ));
  typeVariants.push(
    variant(source, 'type', 'XUDT / EXACT B', {
      asset_kind: 'xudt',
      type_shape_seed: [0xfedc_ba98, 0x7654_3210],
    }),
  );

  const lockVariants = LOCK_FAMILIES.map((family) => variant(
    source,
    'lock',
    `FAMILY / ${family.toUpperCase()}`,
    { lock_kind: family, lock_shape_seed: LOCK_SEEDS[family] },
  ));

  const dataContentVariants = DATA_SEEDS.map((seed, index) => variant(
    source,
    'data-content',
    `SAME 256 B / ${String.fromCharCode(65 + index)}`,
    {
      data_hex: `0x${String(index + 1).padStart(2, '0').repeat(32)}`,
      data_bytes: 256,
      data_shape_seed: seed,
    },
  ));

  const dataSizeVariants = [0, 8, 256, 65_536].map((bytes) => variant(
    source,
    'data-size',
    `SIZE / ${bytes.toLocaleString()} B`,
    {
      data_hex: bytes === 0 ? '0x' : '0x' + '5a'.repeat(Math.min(bytes, 32)),
      data_bytes: bytes,
      data_shape_seed: DATA_SEEDS[0],
    },
  ));

  const capacityVariants = [61e8, 6_100e8, 1_000_000e8].map((capacity) => variant(
    source,
    'capacity',
    `CAP / ${(capacity / 1e8).toLocaleString()} CKB`,
    { capacity },
  ));

  // The crafted family is held CONSTANT here — a cartouche only exists for
  // one, and pinning it is what leaves `collection_seed` as the single thing
  // that moves. Same item, shown as if it belonged to three families and to
  // none: the hue and the glyph move, the outline does not.
  const collectionVariants = [
    variant(source, 'collection', 'SOLE / NO CLUSTER', {
      asset_kind: 'spore',
      type_shape_seed: TYPE_SEEDS.spore,
      collection_seed: undefined,
    }),
    ...COLLECTION_SEEDS.map(([name, seed]) => variant(
      source,
      'collection',
      `CLUSTER / ${name}`,
      { asset_kind: 'spore', type_shape_seed: TYPE_SEEDS.spore, collection_seed: seed },
    )),
  ];

  const fallbackVariants = [
    variant(source, 'fallback', 'ZERO / LOCK+DATA', {
      lock_shape_seed: [0, 0],
      data_shape_seed: [0, 0],
    }),
    variant(source, 'fallback', 'ZERO / TYPE+LOCK+DATA', {
      asset_kind: 'xudt',
      type_shape_seed: [0, 0],
      lock_shape_seed: [0, 0],
      data_shape_seed: [0, 0],
    }),
  ];

  return [
    { axis: 'type', title: 'TYPE · MACRO CARRIER', variants: typeVariants },
    { axis: 'lock', title: 'LOCK · BRAID TOPOLOGY', variants: lockVariants },
    { axis: 'data-content', title: 'DATA-CONTENT · SAME LENGTH', variants: dataContentVariants },
    { axis: 'data-size', title: 'DATA-SIZE · SAME SEED FAMILY', variants: dataSizeVariants },
    { axis: 'capacity', title: 'CAPACITY · PRESENCE ONLY', variants: capacityVariants },
    { axis: 'collection', title: 'COLLECTION · KINSHIP ONLY', variants: collectionVariants },
    { axis: 'fallback', title: 'FALLBACK · ZERO-SEED DIAGNOSTIC', variants: fallbackVariants },
  ];
}
