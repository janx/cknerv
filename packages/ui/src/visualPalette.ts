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

/** Cold, synthetic colour family for the peer data plane. */
export const PEER_NETWORK_HEX = {
  scaffold: '#5577FF',
  outbound: '#58E7FF',
  inbound: '#547FFF',
  version: '#A866FF',
  coldWhite: '#B8F5FF',
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
