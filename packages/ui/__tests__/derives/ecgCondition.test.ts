import { describe, it, expect } from 'vitest';
import { ecgCondition } from '../../src/derives/ecgCondition';

const T = 8000; // target interval ms

describe('ecgCondition', () => {
  it('FINE when recent intervals near target', () => {
    expect(ecgCondition([8000, 7800, 8200], T, 1000)).toBe('FINE');
  });
  it('CAUTION when intervals run ~2x target', () => {
    expect(ecgCondition([16000, 17000], T, 1000)).toBe('CAUTION');
  });
  it('DANGER when intervals run >2.5x target', () => {
    expect(ecgCondition([30000, 28000], T, 1000)).toBe('DANGER');
  });
  it('FLATLINE when no block for > flatline factor x target', () => {
    expect(ecgCondition([8000], T, 8000 * 7)).toBe('FLATLINE');
  });
  it('FINE on empty history with a fresh block', () => {
    expect(ecgCondition([], T, 0)).toBe('FINE');
  });
  it('SYNCING overrides everything when the syncing flag is set', () => {
    // a stale last-block age that would otherwise FLATLINE must read as SYNCING
    expect(ecgCondition([8000], T, 8000 * 7, true)).toBe('SYNCING');
    expect(ecgCondition([8000, 7800], T, 1000, true)).toBe('SYNCING');
    expect(ecgCondition([], T, 0, true)).toBe('SYNCING');
  });
});
