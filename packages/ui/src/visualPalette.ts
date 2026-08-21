export type SceneColor = readonly [number, number, number];

/**
 * Warm, living colour family for the Cell field. These values restore the
 * rose/crimson/amber language that made the galaxy read as a brain rather than
 * another network diagram.
 */
export const CELL_GALAXY_PALETTE = {
  tissueRose: [1.0, 0.40, 0.44],
  veinCrimson: [0.48, 0.06, 0.16],
  veinRose: [0.72, 0.12, 0.24],
  synapseAmber: [1.0, 0.55, 0.15],
  ember: [1.0, 0.52, 0.28],
  warmWhite: [1.0, 0.93, 0.85],
  memoryViolet: [0.66, 0.32, 0.82],
} as const satisfies Record<string, SceneColor>;

/**
 * Bright, synthetic colour family for the peer data plane. The scaffold
 * restores the earlier Cell galaxy's consensus-cyan, while measured nodes lift
 * toward ice-cyan, sky-blue, or pale ultraviolet. Confidence still comes from
 * opacity/size, so brighter hues improve legibility without flattening the
 * observed-vs-inferred hierarchy.
 */
export const PEER_NETWORK_HEX = {
  scaffold: '#1AD1FF',
  outbound: '#7DF9FF',
  inbound: '#5EB9FF',
  version: '#B69CFF',
  coldWhite: '#D8FAFF',
} as const;

function rgbFromHex(hex: `#${string}`): SceneColor {
  const value = Number.parseInt(hex.slice(1), 16);
  return [
    ((value >> 16) & 0xff) / 0xff,
    ((value >> 8) & 0xff) / 0xff,
    (value & 0xff) / 0xff,
  ];
}

export const PEER_NETWORK_PALETTE = {
  scaffold: rgbFromHex(PEER_NETWORK_HEX.scaffold),
  outbound: rgbFromHex(PEER_NETWORK_HEX.outbound),
  inbound: rgbFromHex(PEER_NETWORK_HEX.inbound),
  version: rgbFromHex(PEER_NETWORK_HEX.version),
  coldWhite: rgbFromHex(PEER_NETWORK_HEX.coldWhite),
} as const satisfies Record<string, SceneColor>;

/**
 * Cyan family for the structural chain anchor (the CKB icosahedron). The
 * anchor reads as "structural backbone / chain truth" and stays visually
 * distinct from the Cell consensus field. Its resting structure remains cyan
 * while a block event temporarily carries that block's A-lane hue. Kept in
 * sync with the `ckb` entry of `_rcg/glowNodePalette.ts` — tune both together.
 * It lives here rather than beside the anchor because the floating NODE card
 * tints itself from the same constant: card and icosahedron cannot drift.
 */
export const CHAIN_ANCHOR_HEX = {
  edge: '#7df9ff',
  halo: '#22d3ee',
  fill: '#0e7490',
} as const;
