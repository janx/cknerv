export type SceneColor = readonly [number, number, number];

/**
 * The scene's EVENT accents: the colours that mean something happened, as
 * opposed to the colours a body is made of.
 *
 * ⭐ THE TISSUE SIDE OF THE PALETTE ALWAYS PASSED; THE ACCENT SIDE DID NOT.
 * The 2026-09-04 census counted, outside this file, four violets for "memory"
 * (0.66/0.32/0.82 · 0.4/0.2/1 · 0.54/0.38/1 · 0.38/0.12/0.78), three golds for
 * "agreement", five pale whites and two cyans — most of them typed into a
 * shader as a bare `vec3` and none of them named. A palette is a small set of
 * hues each meaning one thing; the rose family met that bar and this one did
 * not.
 *
 * The values are chosen from the family, never invented, and by two rules:
 *
 *  • the WEIGHT of use — the braid's gold and cyan are read by name in four
 *    files already, so they are the ones that stay;
 *  • and B2's ruling about warmth. The organism is rose. `memoryViolet` is the
 *    warm-side violet of the four, and it is the one already named for the
 *    meaning, so it is the violet — the braid's blue-violet went the way the
 *    braid's cold pale went, for the same reason: on rose tissue a cold accent
 *    says "network", and the peer plane is elsewhere. The peer plane keeps its
 *    OWN violet (`PEER_NETWORK_HEX.version`) and is not touched by this.
 *
 * ⚠️ `gold` is one accent at TWO STOPS, not two accents. `consensusFlow`
 * ramps one into the other; the pair is `tissueRose`/`veinRose`, not a second
 * hue. The pale pair is different — `pale` is COLD and `warmPale` is its warm
 * twin, and which one a surface wears is B2's decision about what that surface
 * is (a specimen under instruments, or a body in tissue).
 */
export const SCENE_ACCENT_PALETTE = {
  violet: [0.66, 0.32, 0.82],
  gold: [0.86, 0.61, 0.25],
  paleGold: [1, 0.84, 0.5],
  pale: [0.72, 0.96, 1],
  warmPale: [1, 0.9, 0.72],
  cyan: [0.1, 0.82, 1],
} as const satisfies Record<string, SceneColor>;

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
  /** The scene's one violet, read from the accent set rather than restated —
   *  the tissue's memory and an event's memory are the same meaning. */
  memoryViolet: SCENE_ACCENT_PALETTE.violet,
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
 * while a block event temporarily carries that block's A-lane hue.
 *
 * It lives here rather than beside the anchor because it has two readers that
 * must never drift apart: `CellGalaxy` paints the icosahedron with it, and the
 * floating `NodeSelfCard` tints its frame from the same constant, so the card
 * and the thing the card is about are the same colour. (It used to name a
 * third reader — a palette file in a sibling repo that no longer exists — and
 * that is the only reason this line ever mentioned keeping anything in sync.)
 */
export const CHAIN_ANCHOR_HEX = {
  edge: '#7df9ff',
  halo: '#22d3ee',
  fill: '#0e7490',
} as const;
