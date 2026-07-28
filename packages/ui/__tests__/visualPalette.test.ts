import { describe, expect, it } from 'vitest';
import {
  CELL_GALAXY_PALETTE,
  PEER_NETWORK_HEX,
  PEER_NETWORK_PALETTE,
} from '../src/visualPalette';

describe('scene palette contrast', () => {
  it('keeps the Cell field warm and tissue-like', () => {
    expect(CELL_GALAXY_PALETTE.tissueRose[0])
      .toBeGreaterThan(CELL_GALAXY_PALETTE.tissueRose[2]);
    expect(CELL_GALAXY_PALETTE.veinCrimson[0])
      .toBeGreaterThan(CELL_GALAXY_PALETTE.veinCrimson[2]);
    expect(CELL_GALAXY_PALETTE.synapseAmber[0])
      .toBeGreaterThan(CELL_GALAXY_PALETTE.synapseAmber[2]);
  });

  it('keeps the peer plane cold and synthetic', () => {
    expect(PEER_NETWORK_HEX.scaffold).toBe('#5577FF');
    expect(PEER_NETWORK_PALETTE.scaffold[2])
      .toBeGreaterThan(PEER_NETWORK_PALETTE.scaffold[0]);
    expect(PEER_NETWORK_PALETTE.outbound[2])
      .toBeGreaterThan(PEER_NETWORK_PALETTE.outbound[0]);
    expect(PEER_NETWORK_PALETTE.version[2])
      .toBeGreaterThan(PEER_NETWORK_PALETTE.version[0]);
  });
});
