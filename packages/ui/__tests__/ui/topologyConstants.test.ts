import { describe, expect, it } from 'vitest';
import {
  BEAM_GROW_DUR_S,
  BEAM_STRIKE_DUR_S,
  BLOCK_COMMIT_DELAY_S,
  BLOCK_HIGHLIGHT_DELAY_S,
  SHOCKWAVE_FIRE_DELAY_S,
  SHOCKWAVE_SPEED,
  MAX_BLOCK_HIGHLIGHTS,
} from '../../src/ui/topologyConstants';

describe('topologyConstants', () => {
  it('derives Cell commit timing from the carrier phases', () => {
    expect(BLOCK_COMMIT_DELAY_S).toBeCloseTo(
      BEAM_GROW_DUR_S + BEAM_STRIKE_DUR_S,
      9,
    );
    expect(SHOCKWAVE_FIRE_DELAY_S).toBe(BLOCK_COMMIT_DELAY_S);
  });

  it('BEAM_GROW_DUR_S and BEAM_STRIKE_DUR_S are positive', () => {
    expect(BEAM_GROW_DUR_S).toBeGreaterThan(0);
    expect(BEAM_STRIKE_DUR_S).toBeGreaterThan(0);
  });

  it('offsets every ledger-visible acknowledgement past the commit', () => {
    expect(BLOCK_HIGHLIGHT_DELAY_S).toBeCloseTo(BLOCK_COMMIT_DELAY_S + 0.15, 9);
    expect(BLOCK_HIGHLIGHT_DELAY_S).toBeGreaterThan(BLOCK_COMMIT_DELAY_S);
  });

  it('SHOCKWAVE_SPEED and MAX_BLOCK_HIGHLIGHTS remain at their documented values', () => {
    expect(SHOCKWAVE_SPEED).toBe(36);
    expect(MAX_BLOCK_HIGHLIGHTS).toBe(256);
  });
});
