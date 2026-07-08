import { describe, it, expect } from 'vitest';
import { galaxySchema, deliverySchema, peerSchema, cellSchema, FOLDER_LABELS } from '../../src/tweaks/tweakSchema';

// Zero-drift guard: these are the EXACT literals the code shipped before the panel.
// If a default changes, the untouched-panel baseline shifts — this test must fail.
const EXPECTED_DEFAULTS = {
  galaxy: { rotationRate: 0.0025, colorBoost: 3.75, alphaBoost: 2.75, sizeBoost: 0.5, trailBoost: 0.18, colorCeil: 1.4, alphaCeil: 1.1 },
  delivery: { heroSize: 0.82, peerSize: 0.5, ingestDur: 0.5, ingestPull: 2.2, bolusBloom: 2.1, flashSize: 4.4, trailWidth: 0.85, trailLenBase: 1.2, trailLenGain: 2.0, trailOpacity: 0.85, ringMax: 6.5, recoil: 0.22, peerPunchScale: 0.55, igniteKHero: 8, igniteKPeer: 3, igniteMax: 300, igniteRipple: 0.015 },
  peer: { ambientAmp: 0.22, ambientSpeed: 0.05, ambientSigma: 0.17, surgeAmp: 1.1, surgeSigma: 0.13, surgeEase: 0.12, flameWidth: 0.7, flameMinLen: 0.7, flameMaxLen: 2.5, flameBloom: 0.7, glintBloomOpacity: 0.55, glintPlumeOpacity: 0.3 },
  cell: { fabricAlpha: 0.12, warmth: 0.12, centerDim: 0.3, activeColorR: 1.0, activeColorG: 0.55, activeColorB: 0.15, fabricWidth: 2.5, activeWidth: 3.4, reinforceAmount: 0.34, reinforceGain: 1.6, reinforceHalfLife: 3.0 },
} as const;

const schemas = { galaxy: galaxySchema, delivery: deliverySchema, peer: peerSchema, cell: cellSchema };

describe('tweakSchema', () => {
  it('every default equals the exact shipped literal (zero-drift)', () => {
    for (const [folder, expected] of Object.entries(EXPECTED_DEFAULTS)) {
      const schema = (schemas as any)[folder];
      for (const [key, value] of Object.entries(expected)) {
        expect(schema[key], `${folder}.${key}`).toBeDefined();
        expect(schema[key].value, `${folder}.${key}`).toBe(value);
      }
      // no stray keys beyond the expected set
      expect(Object.keys(schema).sort()).toEqual(Object.keys(expected).sort());
    }
  });

  it('every knob has min <= value <= max and a positive step', () => {
    for (const schema of Object.values(schemas)) {
      for (const [key, def] of Object.entries(schema)) {
        expect(def.min, key).toBeLessThanOrEqual(def.value);
        expect(def.value, key).toBeLessThanOrEqual(def.max);
        expect(def.step, key).toBeGreaterThan(0);
      }
    }
  });

  it('exposes organism-lexicon folder labels', () => {
    expect(FOLDER_LABELS).toEqual({
      galaxy: 'Galaxy 共识记忆', delivery: 'Block delivery', peer: 'Peer mesh 对端', cell: 'Cell mesh 细胞',
    });
  });
});
