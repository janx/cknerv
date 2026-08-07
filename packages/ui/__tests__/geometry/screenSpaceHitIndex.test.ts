import { describe, expect, it } from 'vitest';
import { ScreenSpaceHitIndex } from '../../src/geometry/screenSpaceHitIndex';

describe('ScreenSpaceHitIndex', () => {
  it('finds a sprite across bucket boundaries using its visual radius', () => {
    const index = new ScreenSpaceHitIndex(8, 32);
    index.begin(128, 96);
    index.insert(3, 31, 40, 12, 0.2);

    expect(index.find(40, 40)?.index).toBe(3);
    expect(index.find(50, 40)).toBeNull();
  });

  it('uses screen distance first and depth for near-equal overlaps', () => {
    const index = new ScreenSpaceHitIndex(8, 32);
    index.begin(128, 96);
    index.insert(1, 64, 48, 10, 0.6);
    index.insert(2, 64.2, 48, 10, 0.1);

    expect(index.find(64, 48)?.index).toBe(2);
    index.insert(4, 66, 48, 10, -0.2);
    expect(index.find(64, 48)?.index).toBe(2);
  });

  it('reuses storage across viewport rebuilds and rejects stale entries', () => {
    const index = new ScreenSpaceHitIndex(4, 16);
    index.begin(100, 100);
    index.insert(0, 20, 20, 8, 0);
    expect(index.find(20, 20)?.index).toBe(0);

    index.begin(50, 50);
    index.insert(1, 40, 40, 5, 0);
    expect(index.find(20, 20)).toBeNull();
    expect(index.find(40, 40)?.index).toBe(1);
  });
});
