import { describe, expect, it } from 'vitest';
import {
  CELL_GALAXY_PALETTE,
  PEER_NETWORK_HEX,
  PEER_NETWORK_PALETTE,
  type SceneColor,
} from '../src/visualPalette';

const relativeLuminance = (color: SceneColor): number => {
  const linear = color.map((channel) => (
    channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4
  ));
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
};

describe('scene palette contrast', () => {
  it('keeps the Cell field warm and tissue-like', () => {
    expect(CELL_GALAXY_PALETTE.tissueRose[0])
      .toBeGreaterThan(CELL_GALAXY_PALETTE.tissueRose[2]);
    expect(CELL_GALAXY_PALETTE.veinCrimson[0])
      .toBeGreaterThan(CELL_GALAXY_PALETTE.veinCrimson[2]);
    expect(CELL_GALAXY_PALETTE.synapseAmber[0])
      .toBeGreaterThan(CELL_GALAXY_PALETTE.synapseAmber[2]);
  });

  it('keeps the peer plane bright, cold, and synthetic', () => {
    expect(PEER_NETWORK_HEX.scaffold).toBe('#1AD1FF');
    expect(PEER_NETWORK_PALETTE.scaffold[2])
      .toBeGreaterThan(PEER_NETWORK_PALETTE.scaffold[0]);
    expect(PEER_NETWORK_PALETTE.outbound[2])
      .toBeGreaterThan(PEER_NETWORK_PALETTE.outbound[0]);
    expect(PEER_NETWORK_PALETTE.version[2])
      .toBeGreaterThan(PEER_NETWORK_PALETTE.version[0]);
    expect(Object.values(PEER_NETWORK_PALETTE).every(
      (color) => relativeLuminance(color) >= 0.4,
    )).toBe(true);
  });
});
