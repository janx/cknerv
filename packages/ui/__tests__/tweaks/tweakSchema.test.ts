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
  // The sixteen `cohort*` knobs are the POW channel — ONE LENSED MASS PER
  // COHORT plus the specks falling into it — whose defaults live on
  // `colonyLens`, `colonyMotes` and `colonyMist` under the same one-authority
  // rule the shockwave knobs follow.
  //
  // ⚠️ FIFTEEN WERE RETIRED ON 2026-09-03 AND TWO SURVIVED, which is the whole
  // shape of the form change. The composed aperture's ten (`cohortApR`,
  // `cohortPupil`, `cohortRimAmp` 0.42, `cohortIntakeAmp` 0.72, `cohortStriae`
  // 88, `cohortStriaAmp` 0.38, `cohortHaloR` 1.35, `cohortHaloBias` 0.3,
  // `cohortInteriorAmp` 1.15, `cohortLevel` 0.7) each moved a PART of a picture
  // that is now COMPUTED rather than assembled — a radius, a hole, a lip, a
  // grain, a window — and the mist patch's five (`cohortMistAmp` 1,
  // `cohortGather` 1.8, `cohortReach` 14, `cohortWake` 0.35,
  // `cohortShareFloor` 0.35) went with the draw they weighed. Before them, the
  // marched throat's eight (reach 20, mouth 6, intake amp 1.8, density 0.25,
  // crests 3.2, crest hz 0.23, gather 0.8, core amp 0.62) and the accreting
  // void's five (rim 1.45, gas 0.72, field 0.38, infall 0.4, spin 0.035) went
  // the same way, with the forms that owned them.
  //
  // ⭐ `cohortIntake` (the sink's k, wu²/s) and `cohortSwirl` (the
  // vortex-to-sink ratio) survive UNCHANGED at 12 and 1.4 because they are
  // facts about the SUBSTANCE, and the substance is the one thing the lensed
  // disc kept: the same `MIST_SINK_K` and `MIST_SWIRL` the retired patch drank
  // at. ⚠️ `cohortIntake` now reaches BOTH draws — the disc's back-trace at `k`
  // and the specks at 4/3 of it, which is `COHORT_MOTE_K` 16 over this 12, so
  // an untouched panel still ships exactly what the two materials do.
  //
  // ⭐⭐ `cohortHorizon` 0.77 IS THE SIZE PARAMETER, and every other radius on
  // the mark is a multiple of it: the shadow at 3√3/2 (2.0 wu, which is also the
  // pick target), the ISCO at 3 (2.31 wu). It is the first knob a tuner reaches
  // for, and it is the one whose default a screenshot of the approved preview
  // pins.
  //
  // ⭐ `cohortSteps` 96 IS THE `high` TIER'S OWN VALUE, deliberately: the
  // cascade's `cohortLensSteps` is 96 / 64 / 40, and `ColonyCohorts` reads the
  // TIER while this knob sits at its default and the KNOB the moment it moves.
  // A default that differed from the tier would make an untouched panel change
  // what the scene draws, which is the one thing this file exists to forbid.
  peer: { ambientAmp: 0.22, ambientSpeed: 0.05, ambientSigma: 0.17, surgeAmp: 1.1, surgeSigma: 0.13, surgeEase: 0.12, colorBoost: 3.75, alphaBoost: 2.75, sizeBoost: 0.5, trailBoost: 0.18, colorCeil: 1.4, alphaCeil: 1.1, flameWidth: 0.7, flameMinLen: 0.7, flameMaxLen: 2.5, flameBloom: 0.7, glintBloomOpacity: 0.55, glintPlumeOpacity: 0.3, cohortHorizon: 0.77, cohortDiscOut: 28, cohortDiscAmp: 1.5, cohortBeam: 0.45, cohortFarAmp: 0.5, cohortFarArms: 0.6, cohortFarStreak: 1, cohortFarSwirl: 2.4, cohortGlow: 0.35, cohortWarmth: 0, cohortUnfold: 50, cohortSteps: 96, cohortIntake: 12, cohortSwirl: 1.4, cohortOrbit: 1.2, cohortMotes: 1 },
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
