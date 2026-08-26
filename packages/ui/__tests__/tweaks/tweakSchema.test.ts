import { describe, it, expect } from 'vitest';
import { galaxySchema, deliverySchema, peerSchema, cellSchema, nerveSchema, FOLDER_LABELS } from '../../src/tweaks/tweakSchema';

// Zero-drift guard: these are the EXACT literals the code shipped before the panel.
// If a default changes, the untouched-panel baseline shifts — this test must fail.
const EXPECTED_DEFAULTS = {
  // Halved from the original 0.0025 when the peer colony began
  // counter-rotating (2026-08-24): the two planes shear at twice the knob,
  // so the shipped tempo came down with it.
  galaxy: { rotationRate: 0.00125 },
  // waveWidth is 0.55/CONTACT_WAVE_SCALE — the one delivery default that is
  // derived rather than a hand literal, deliberately: the crest must rescale
  // with the ring (baseline shifted 0.14 → 0.1375 when the hand-rounding was
  // replaced by the derivation, 2026-08-14; → 0.06875 when the scale went
  // 4 → 8 to halve the ring's radius, 2026-08-15 — speed, both reaches and
  // the width all moved with it).
  delivery: { heroSize: 1.16, peerSize: 0.46, ingestDur: 1.2, glyphBloom: 1.6, glyphCompress: 0.45, coreSize: 1.4, trailWidth: 0.55, trailLenBase: 1.0, trailLenGain: 1.6, trailOpacity: 0.6, inhaleAmount: 0.55, waveSpeed: 4.5, waveWidth: 0.55 / 8, waveOpacity: 2.0, waveFalloff: 0.5, waveReachHero: 6.5, waveReachPeer: 4.25, waveWake: 0.14, waveSegments: 0.55, peerPunchScale: 0.7, igniteKHero: 8, igniteKPeer: 3, igniteMax: 300, igniteRipple: 0.015 },
  // The five `intake*` knobs are the mining channel, whose defaults live on
  // `colonyIntakeMotes` under the same one-authority rule the shockwave knobs
  // follow. `intakeSpeed` is a WORLD speed and `intakeEase` above 1 is the
  // accelerating-inward travel that separates a mote from a thrown courier.
  peer: { ambientAmp: 0.22, ambientSpeed: 0.05, ambientSigma: 0.17, surgeAmp: 1.1, surgeSigma: 0.13, surgeEase: 0.12, colorBoost: 3.75, alphaBoost: 2.75, sizeBoost: 0.5, trailBoost: 0.18, colorCeil: 1.4, alphaCeil: 1.1, flameWidth: 0.7, flameMinLen: 0.7, flameMaxLen: 2.5, flameBloom: 0.7, glintBloomOpacity: 0.55, glintPlumeOpacity: 0.3, intakeAmp: 0.8, intakeSpeed: 4.5, intakeWidth: 0.55, intakeEase: 1.8, intakeSpentS: 0.5 },
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
      galaxy: 'Galaxy', delivery: 'Consensus carrier', peer: 'Peer mesh', cell: 'Cell structure', nerve: 'Nerve fabric',
    });
  });
});
