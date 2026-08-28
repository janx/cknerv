import { describe, it, expect } from 'vitest';
import { galaxySchema, deliverySchema, peerSchema, cellSchema, nerveSchema, FOLDER_LABELS } from '../../src/tweaks/tweakSchema';

// Zero-drift guard: these are the EXACT literals the code shipped before the panel.
// If a default changes, the untouched-panel baseline shifts — this test must fail.
const EXPECTED_DEFAULTS = {
  // Halved from the original 0.0025 when the peer colony began
  // counter-rotating (2026-08-24): the two planes shear at twice the knob,
  // so the shipped tempo came down with it.
  galaxy: { rotationRate: 0.00125 },
  // waveWidth is 3.2/CONTACT_WAVE_SCALE — the one delivery default that is
  // derived rather than a hand literal, deliberately: the crest must rescale
  // with the ring (baseline shifted 0.14 → 0.1375 when the hand-rounding was
  // replaced by the derivation, 2026-08-14; → 0.06875 when the scale went
  // 4 → 8 to halve the ring's radius, 2026-08-15 — speed, both reaches and
  // the width all moved with it; → 0.4 when the crest went soft, 2026-08-28).
  // The hop knobs (mote / plume / hop opacities) are the courier form at the
  // block's own weight (2026-08-28: the glyph, streak, sear and inhale knobs
  // left with the glyph dialect). The two breath knobs are the halo
  // compression that replaced the glyph's gather: extent to 0.55, light
  // ×1.8 (COMPRESS_DEPTH / COMPRESS_GAIN on peers.derive, same day).
  // The front went soft the same day, to be legible at the overview camera:
  // crest 0.55 → 3.2 on the front's scale (0.069 → 0.40 wu, a hairline to
  // ≥2.5 px), wake 0.14 → 0.45, gaps 0.55 → 0.3, opacity 2.0 → 0.9 for the
  // extra area; and the fibre flush arrived with its two knobs (amp 1.0 = a
  // full core-floor reclaim at the crest, mix 0.6 toward the front's hue).
  // The landing flashes replaced the k-nearest ignition the same day (the
  // `ignite*` knobs left with it): three budgets — per hero front 128, per
  // peer front 24, per pulse 300 (the old `igniteMax`) — and the flash's own
  // window 0.45 s and sprite 2.2× the Cell's presentation size
  // (LANDING_FLASH_* on landingFlashMaterial, one authority).
  delivery: { ingestDur: 1.2, compressDepth: 0.45, compressGain: 0.8, moteHero: 2.2, motePeer: 1.3, plumeWidth: 1.0, plumeMinLen: 0.9, plumeMaxLen: 4.0, hopBloomOpacity: 1.0, hopPlumeOpacity: 0.75, waveSpeed: 4.5, waveWidth: 3.2 / 8, waveOpacity: 0.9, waveFalloff: 0.5, waveReachHero: 6.5, waveReachPeer: 4.25, waveWake: 0.45, waveSegments: 0.3, peerPunchScale: 0.7, flushAmp: 1.0, flushMix: 0.6, landingHero: 128, landingPeer: 24, landingMax: 300, landingDur: 0.45, landingSize: 2.2 },
  // The five `hole*` knobs are the POW channel — one accreting void per cohort
  // — whose defaults live on `colonyAccretion` under the same one-authority
  // rule the shockwave knobs follow. `holeInfall` is a RATE and the only thing
  // a cohort's share scales; `holeSpin` may go negative because which way a
  // disc turns is arbitrary.
  peer: { ambientAmp: 0.22, ambientSpeed: 0.05, ambientSigma: 0.17, surgeAmp: 1.1, surgeSigma: 0.13, surgeEase: 0.12, colorBoost: 3.75, alphaBoost: 2.75, sizeBoost: 0.5, trailBoost: 0.18, colorCeil: 1.4, alphaCeil: 1.1, flameWidth: 0.7, flameMinLen: 0.7, flameMaxLen: 2.5, flameBloom: 0.7, glintBloomOpacity: 0.55, glintPlumeOpacity: 0.3, holeRim: 1.45, holeGas: 0.72, holeField: 0.38, holeInfall: 0.4, holeSpin: 0.035 },
  cell: { fabricAlpha: 0.15, warmth: 0.12, centerDim: 0.3, activeColorR: 1.0, activeColorG: 1.0, activeColorB: 1.0, fabricWidth: 2.5, activeWidth: 4.6, reinforceAmount: 0.34, reinforceGain: 1.6, reinforceHalfLife: 3.0, fabricStaggerThreshold: 1500, fabricCohortSize: 750, fabricCohortInterval: 0.25 },
  nerve: { screenBudget: 8_000, coverageShare: 0.55, trunkShare: 0.72, twigShare: 0.18 },
} as const;

const schemas = { galaxy: galaxySchema, delivery: deliverySchema, peer: peerSchema, cell: cellSchema, nerve: nerveSchema };

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

  it('exposes protocol-oriented folder labels', () => {
    expect(FOLDER_LABELS).toEqual({
      galaxy: 'Galaxy', delivery: 'Block impact', peer: 'Peer mesh', cell: 'Cell structure', nerve: 'Nerve fabric',
    });
  });
});
