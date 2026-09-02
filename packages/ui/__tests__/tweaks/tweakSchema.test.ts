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
  // The seventeen `cohort*` knobs are the POW channel — one aperture per
  // cohort, drawn as two faces of one hole, over the mist that hole is
  // drinking — whose defaults live on `colonyCohort` and `colonyMist`
  // under the same one-authority rule the shockwave knobs follow. `cohortApR`
  // is THE size parameter and the first one a tuner reaches for; `cohortPupil`
  // is read by BOTH faces, which is what makes the halo's hole the same hole.
  // ⭐⭐ `cohortLevel` is the one knob with TWO consumers: it is where the
  // window stops showing wall and starts showing the medium's surface AND the
  // top of the mound the mist is lifted into, which are one surface seen two
  // ways, so `ColonyCohorts` writes it into the face's `uLevel` and the patch's
  // in the same frame off one read.
  // ⚠️ `cohortRimAmp` came down 1.05 → 0.42 with the mist: the preview's drawn
  // lip is FAINT because the bright edge of the mouth is the medium piling up
  // at it (`uConc * (R/r)³` on the patch), not a ring. T2b measured what the
  // deferral cost — the lip peaking at 2.86 pre-knee against the window's 1.44
  // — and left it to the commit that mounts the pile.
  // ⚠️ `cohortIntake` (sink strength k, wu²/s) and `cohortIntakeAmp` (the
  // face's skirt brightness) are different quantities with adjacent names; the
  // panel labels them 'cohort sink k' and 'cohort intake amp'.
  // ⚠️ `cohortPupil` is 1 and not a fraction of the ring any more: the hole
  // REACHES the lip, the way the approved preview draws it, so the pupil and
  // the rim are one radius (1.6 wu) rather than two. Its knob still runs to
  // 1.5, which is how a tuner finds out whether the lip wants to sit inside or
  // outside the throat.
  // The eight raymarch knobs they replaced (reach 20, mouth 6, intake amp 1.8,
  // density 0.25, crests 3.2, crest hz 0.23, gather 0.8, core amp 0.62) went
  // with the marched vertical throat that owned every one of them, exactly as
  // the five `hole*` knobs before them (rim 1.45, gas 0.72, field 0.38, infall
  // 0.4, spin 0.035) went with the accreting void.
  peer: { ambientAmp: 0.22, ambientSpeed: 0.05, ambientSigma: 0.17, surgeAmp: 1.1, surgeSigma: 0.13, surgeEase: 0.12, colorBoost: 3.75, alphaBoost: 2.75, sizeBoost: 0.5, trailBoost: 0.18, colorCeil: 1.4, alphaCeil: 1.1, flameWidth: 0.7, flameMinLen: 0.7, flameMaxLen: 2.5, flameBloom: 0.7, glintBloomOpacity: 0.55, glintPlumeOpacity: 0.3, cohortApR: 3.0, cohortPupil: 1, cohortRimAmp: 0.42, cohortIntakeAmp: 0.72, cohortStriae: 88, cohortStriaAmp: 0.38, cohortHaloR: 1.35, cohortHaloBias: 0.3, cohortMistAmp: 1, cohortHazeAmp: 1, cohortInteriorAmp: 1.15, cohortGather: 1.8, cohortIntake: 12, cohortSwirl: 1.4, cohortReach: 14, cohortLevel: 0.7, cohortWake: 0.35 },
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
