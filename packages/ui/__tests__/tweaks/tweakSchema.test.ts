import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { galaxySchema, deliverySchema, peerSchema, cellSchema, nerveSchema, FOLDER_LABELS } from '../../src/tweaks/tweakSchema';
import { applyTweaks, LIVE } from '../../src/tweaks/liveTweaks';
import {
  fabricTwigViewEnergy,
  haloThreadViewLevel,
} from '../../src/nerve/fabricLuminance';
import {
  BODY_DEPTH_HALF_SPREAD,
  GALAXY_RADIANCE_IDENTITY,
  bodyDepthEnergyValue,
  galaxyRadianceGain,
} from '../../src/materials/cellHybridMaterial';
import {
  populationEmissionForGain,
  populationFibreEmissionForGain,
} from '../../src/materials/populationFieldMaterial';
import {
  CELL_DETAIL_VIEW_NEAR_DISTANCE,
  cellDetailViewFocus,
} from '../../src/derives/sceneView.derive';

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
  // The nineteen `cohort*` knobs are the POW channel — ONE LENSED MASS PER
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
  // ⭐⭐⭐ `cohortMassAnchor` 0.6, `cohortMassFloor` 0.45 AND `cohortHand` 1 ARE
  // THE ONLY PER-COHORT KNOBS IN THE FOLDER, added 2026-09-04. Every other one
  // is a GLOBAL uniform — one horizon, one disc, one palette for the whole
  // colony — so until these, seven cohorts were seven copies of one picture.
  // The anchor is the WEEK SHARE at which a cohort is full size (today's top,
  // and the largest a single pool plausibly holds), so the accepted form is a
  // CEILING and everyone else folds down from it; the floor is the smallest a
  // cohort may be drawn, chosen so a 2 % cohort's nucleus still out-foots a
  // ghost peer. ⚠️ A FLOOR OF 1 IS THE OFF SWITCH — every mass clamps to 1 and
  // the colony draws exactly what it drew before the lane was written, which is
  // what makes the A/B for the whole channel a single knob.
  //
  // ⭐ `cohortSteps` 96 IS THE `high` TIER'S OWN VALUE, deliberately: the
  // cascade's `cohortLensSteps` is 96 / 64 / 40, and `ColonyCohorts` reads the
  // TIER while this knob sits at its default and the KNOB the moment it moves.
  // A default that differed from the tier would make an untouched panel change
  // what the scene draws, which is the one thing this file exists to forbid.
  peer: { ambientAmp: 0.22, ambientSpeed: 0.05, ambientSigma: 2, surgeAmp: 1.1, surgeSigma: 1.5, surgeEase: 0.12, colorBoost: 3.75, alphaBoost: 2.75, sizeBoost: 0.5, trailBoost: 0.18, colorCeil: 1.4, alphaCeil: 1.1, flameWidth: 0.7, flameMinLen: 0.7, flameMaxLen: 2.5, flameBloom: 0.7, glintBloomOpacity: 0.55, glintPlumeOpacity: 0.3, cohortHorizon: 0.77, cohortDiscOut: 28, cohortDiscAmp: 1.5, cohortBeam: 0.45, cohortFarAmp: 0.45, cohortFarFall: 1, cohortFarStreak: 1, cohortFarSwirl: 2.4, cohortGlow: 0.35, cohortWarmth: 0, cohortUnfold: 50, cohortSteps: 96, cohortIntake: 12, cohortSwirl: 1.4, cohortOrbit: 1.2, cohortMotes: 1, cohortMassAnchor: 0.6, cohortMassFloor: 0.45, cohortHand: 1 },
  //
  // ⭐⭐⭐ `fabricTwigOverview` 1, `haloThreadOverview` 1 AND `bodyDepthEnergy`
  // 0 ARE THE OFF POSITIONS OF THE THREE ⟨D-10⟩ ART-DIRECTION KNOBS, added
  // 2026-09-05. Each answers one of the 09-05 review's readings about the wide
  // camera — the fabric reads as wool, the corona out-structures the core, the
  // far half is brighter than the near — and none of them is a defect with a
  // right answer, so none of them ships turned on. At these three values every
  // pixel is what it was: 1 makes both view multipliers exactly 1 at every
  // camera, and 0 makes the depth term exactly 1 at every depth. The A/B
  // captures decide, and this row is what says the panel has not decided for
  // them. ⚠️ The three ranges are deliberately bounded well short of nothing
  // (0.3 / 0.3 / 0.6): each is a treatment, and a knob that can erase its own
  // layer is a bug report waiting to be filed.
  //
  // ⭐⭐ `galaxyRadiance` 1 IS THE IDENTITY of ⟨ruling 22⟩'s knob, added
  // 2026-09-05 beside them and for the same reason: the ruling says the cells
  // galaxy is the canvas's first focus and must read radiant, and no capture
  // can settle how much light that is. 1 multiplies the tissue's and the
  // halo's emitted alpha by one, so the shipped picture is exactly the shipped
  // picture until the eye moves it.
  cell: { fabricAlpha: 0.15, warmth: 0.12, centerDim: 0.3, activeColorR: 1.0, activeColorG: 1.0, activeColorB: 1.0, fabricWidth: 2.5, activeWidth: 4.6, reinforceAmount: 0.34, reinforceGain: 1.6, reinforceHalfLife: 3.0, fabricStaggerThreshold: 1500, fabricCohortSize: 750, fabricCohortInterval: 0.25, fabricTwigOverview: 1, haloThreadOverview: 1, bodyDepthEnergy: 0, galaxyRadiance: 1 },
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

// ——— ⟨D-10⟩ The three art-direction knobs ——————————————————————————————
//
// Each answers one reading from the 09-05 review about the wide camera, each
// is a knob because the reading is a question for the eye and not a defect,
// and each DEFAULTS TO TODAY'S PICTURE. That last property is the one this
// chapter is really about: a knob that shipped turned on would have decided
// the question the A/B exists to ask.
describe('three knobs that default to the picture that shipped', () => {
  it('the twig law is the identity at its default, at every camera', () => {
    const shipped = cellSchema.fabricTwigOverview.value;
    expect(shipped).toBe(1);
    for (const focus of [0, 0.25, 0.5, 0.75, 1]) {
      expect(fabricTwigViewEnergy(shipped, focus)).toBe(1);
    }
  });

  it('…and off the default it spends light at the OVERVIEW and returns it up close', () => {
    // The whole shape of the treatment: quietest where report D measured the
    // fabric reading as wool (coherence 0.164 against a 0.111 noise floor),
    // full weight inside `CELL_DETAIL_VIEW_NEAR_DISTANCE` where a reader is
    // looking at one neighbourhood rather than at the whole disc.
    expect(fabricTwigViewEnergy(0.55, 0)).toBeCloseTo(0.55, 10);
    expect(fabricTwigViewEnergy(0.55, 1)).toBe(1);
    expect(fabricTwigViewEnergy(0.55, cellDetailViewFocus(CELL_DETAIL_VIEW_NEAR_DISTANCE)))
      .toBe(1);
    // Monotone in the camera, and never above 1: this is a SPEND, so no
    // setting of it can make anything brighter than it is today.
    let previous = -1;
    for (let i = 0; i <= 20; i += 1) {
      const value = fabricTwigViewEnergy(0.55, i / 20);
      expect(value).toBeGreaterThanOrEqual(previous);
      expect(value).toBeLessThanOrEqual(1);
      previous = value;
    }
  });

  it('the halo thread law is the same shape, and is also the identity by default', () => {
    const shipped = cellSchema.haloThreadOverview.value;
    expect(shipped).toBe(1);
    for (const focus of [0, 0.5, 1]) {
      expect(haloThreadViewLevel(shipped, focus)).toBe(1);
    }
    expect(haloThreadViewLevel(0.6, 0)).toBeCloseTo(0.6, 10);
    expect(haloThreadViewLevel(0.6, 1)).toBe(1);
  });

  it('the depth term is exactly 1 at every depth while its knob is 0', () => {
    const shipped = cellSchema.bodyDepthEnergy.value;
    expect(shipped).toBe(0);
    for (const ratio of [0.6, 0.7, 1, 1.3, 1.4]) {
      expect(bodyDepthEnergyValue(ratio, shipped)).toBe(1);
    }
  });

  it('…and off zero it spends the FAR half and never touches the near one', () => {
    // Report D-4's own measurement is the calibration: near rim 119 view
    // units, centre 171, far rim 223 — ±0.30 of the centre distance, which is
    // `BODY_DEPTH_HALF_SPREAD`.
    const near = 1 - BODY_DEPTH_HALF_SPREAD;
    const far = 1 + BODY_DEPTH_HALF_SPREAD;
    expect(bodyDepthEnergyValue(near, 0.4)).toBeCloseTo(1, 10);
    expect(bodyDepthEnergyValue(1, 0.4)).toBeCloseTo(0.8, 10);
    expect(bodyDepthEnergyValue(far, 0.4)).toBeCloseTo(0.6, 10);
    // ⚠️ NEVER ABOVE 1, at any depth or any amount. That is what keeps this a
    // spend on emitted alpha rather than an alpha-over wash: nothing is added,
    // so the black between the bodies stays exactly black.
    for (let i = 0; i <= 20; i += 1) {
      const amount = (i / 20) * cellSchema.bodyDepthEnergy.max;
      for (let d = 0; d <= 20; d += 1) {
        const value = bodyDepthEnergyValue(0.5 + d / 10, amount);
        expect(value).toBeLessThanOrEqual(1);
        // …and never gone. The knob's ceiling is 0.6 for exactly this reason:
        // at 1 the far rim would reach zero, and a treatment that can erase
        // half of its own layer is not a treatment.
        expect(value).toBeGreaterThanOrEqual(1 - cellSchema.bodyDepthEnergy.max);
        expect(value).toBeGreaterThan(0);
      }
    }
    // Monotone: near ≥ far, which is the whole claim.
    let previous = 2;
    for (let i = 0; i <= 20; i += 1) {
      const value = bodyDepthEnergyValue(0.7 + (i / 20) * 0.6, 0.4);
      expect(value).toBeLessThanOrEqual(previous);
      previous = value;
    }
  });

  it('all three are reachable through the tweak store, and nothing else is', () => {
    // A knob nobody can turn is a comment. `applyTweaks` is the panel's one
    // writer, and `LIVE.cell` is what the three consumers read each frame.
    const before = {
      twig: LIVE.cell.fabricTwigOverview,
      halo: LIVE.cell.haloThreadOverview,
      depth: LIVE.cell.bodyDepthEnergy,
    };
    try {
      applyTweaks(LIVE, {
        cell: {
          fabricTwigOverview: 0.42,
          haloThreadOverview: 0.58,
          bodyDepthEnergy: 0.36,
        },
      });
      expect(LIVE.cell.fabricTwigOverview).toBe(0.42);
      expect(LIVE.cell.haloThreadOverview).toBe(0.58);
      expect(LIVE.cell.bodyDepthEnergy).toBe(0.36);
    } finally {
      applyTweaks(LIVE, {
        cell: {
          fabricTwigOverview: before.twig,
          haloThreadOverview: before.halo,
          bodyDepthEnergy: before.depth,
        },
      });
    }
    expect(LIVE.cell.fabricTwigOverview).toBe(1);
    expect(LIVE.cell.haloThreadOverview).toBe(1);
    expect(LIVE.cell.bodyDepthEnergy).toBe(0);
  });

  it('each knob has exactly one consumer, and it is the one the plan names', () => {
    // Cross-file tolls: this file cannot check itself, so each claim is read
    // off the surface that would have to change for it to stop being true.
    const read = (relative: string) => readFileSync(
      resolve(process.cwd(), 'src', relative),
      'utf8',
    );
    const fabric = read('nerve/NeuralFabric.tsx');
    // The MESH tier takes the twig gain; the trunk keeps the plain one. That
    // asymmetry is the treatment — the tier that carries the structure never
    // dims — so both halves are pinned.
    expect(fabric).toContain('fabricTwigViewEnergy(twig, focus)');
    expect(fabric).toContain('fabric.material.color.setRGB(twigGain, twigGain, twigGain)');
    expect(fabric).toContain('trunk.material.color.setRGB(energyGain, energyGain, energyGain)');

    const halo = read('components/CellPopulationField.tsx');
    // Both stroke classes, and the BEADS not at all: the beads are the same
    // matter as a Cell body, and separating them is the seam this design
    // exists to remove.
    expect(halo).toContain('haloThreadViewLevel(');
    expect(halo).toMatch(/populationFibreEmissionForGain\([\s\S]{0,60}\) \* threadLevel/);
    expect(halo).toContain('uDepthEnergy.value = LIVE.cell.bodyDepthEnergy');
    expect(halo).not.toMatch(/uEmission\.value = populationEmissionForGain\(gain\) \*/);

    // The knob's OTHER consumer: the 12K resting cells. The body material
    // DECLARES and READS uDepthEnergy, but the frame loop in CellGalaxy is what
    // feeds it the knob — without this write the parked knob (c) reaches only
    // the halo beads, not the tissue it was named for (REVIEW B1-1). The body's
    // own material handle, so it cannot pass on the halo's write alone.
    const galaxy = read('components/CellGalaxy.tsx');
    expect(galaxy).toContain('hybridMaterial.uniforms.uDepthEnergy.value = LIVE.cell.bodyDepthEnergy');

    // …and the depth law is ONE law in one file, read by both body materials.
    const bodies = read('materials/cellHybridMaterial.ts');
    const field = read('materials/populationFieldMaterial.ts');
    expect(bodies).toContain('export const BODY_DEPTH_ENERGY_GLSL');
    expect(bodies).toContain('${BODY_DEPTH_ENERGY_GLSL}');
    expect(bodies).toContain('base.a *= vDepthDim;');
    expect(field).toMatch(/BODY_DEPTH_ENERGY_GLSL,[\s\S]{0,80}from '\.\/cellHybridMaterial'/);
    expect(field).toContain('${BODY_DEPTH_ENERGY_GLSL}');
    // ⟨D-7⟩ symmetric size-energy, still the depth knob's one consumer (* depthDim).
    expect(field).toContain('vEnergy = min(shrink * shrink, 1.0 / (shrink * shrink)) * depthDim;');
    // No second copy of the law anywhere: a twin would be a place for the two
    // body layers to disagree about where the front of the galaxy is.
    expect(field).not.toContain('float bodyDepthEnergy(');
  });

  it('the galaxy\'s radiance is the identity at its default ⟨ruling 22⟩', () => {
    // The knob ships parked, like the three above it: at 1 every multiplier in
    // both body materials is exactly 1, so the shipped frame is byte-for-byte
    // the shipped frame and the eye is what moves it.
    expect(cellSchema.galaxyRadiance.value).toBe(GALAXY_RADIANCE_IDENTITY);
    expect(galaxyRadianceGain(cellSchema.galaxyRadiance.value)).toBe(1);
    for (const gain of [0.05, 0.17, 0.5, 1]) {
      expect(populationEmissionForGain(gain, cellSchema.galaxyRadiance.value))
        .toBe(populationEmissionForGain(gain));
      expect(populationFibreEmissionForGain(gain, cellSchema.galaxyRadiance.value))
        .toBe(populationFibreEmissionForGain(gain));
    }
    // A knob that changes nothing at any setting is a comment: both ends of
    // the range move the layer, in the direction they say.
    const { min, max } = cellSchema.galaxyRadiance;
    expect(populationEmissionForGain(1, min)).toBeLessThan(populationEmissionForGain(1));
    expect(populationEmissionForGain(1, max)).toBeGreaterThan(populationEmissionForGain(1));
    expect(populationEmissionForGain(1, max))
      .toBeCloseTo(populationEmissionForGain(1) * max, 10);
    // A panel mid-edit is not an input validator: nonsense reads as the
    // identity rather than as a black scene.
    for (const nonsense of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      expect(galaxyRadianceGain(nonsense)).toBe(GALAXY_RADIANCE_IDENTITY);
    }
  });

  it('…and it reaches the tissue and the halo, and nothing else', () => {
    // ⚠️ The fence is the ruling's own boundary. The peer mesh is the canvas's
    // SECOND focus with a tier ladder of its own, the colony has its own
    // light, and an event reclaims headroom ABOVE the resting field on
    // purpose — a gain that reached any of them would be this knob quietly
    // becoming a scene-wide exposure control.
    const root = resolve(process.cwd(), 'src');
    const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
      .flatMap((entry) => {
        const at = join(dir, entry.name);
        if (entry.isDirectory()) return walk(at);
        return /\.tsx?$/.test(entry.name) ? [at] : [];
      });
    // ⚠️ The fence reads CODE, not prose. `visualPalette.ts` argues the
    // two-focus rule and names this knob in the argument; a rule that made
    // naming a constant in a comment an offence would be a rule against the
    // way this codebase documents itself. Block and line comments come out
    // first — GLSL's included, since both materials carry their shaders in
    // template literals — and what is left is what the gain can actually
    // reach.
    const code = (source: string) => source
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    const wearers = walk(root)
      .filter((file) => /galaxyRadiance|uRadiance|GALAXY_RADIANCE/
        .test(code(readFileSync(file, 'utf8'))))
      .map((file) => relative(root, file).replace(/\\/g, '/'))
      .sort();

    expect(wearers).toEqual([
      'components/CellGalaxy.tsx',
      'components/CellPopulationField.tsx',
      'materials/cellHybridMaterial.ts',
      'materials/populationFieldMaterial.ts',
      'tweaks/tweakSchema.ts',
    ]);

    const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8');
    // The law is stated ONCE and both materials read it — the same bargain the
    // depth term strikes one chapter up.
    expect(read('materials/cellHybridMaterial.ts'))
      .toContain('export function galaxyRadianceGain');
    expect(read('materials/populationFieldMaterial.ts'))
      .toMatch(/galaxyRadianceGain,[\s\S]{0,80}from '\.\/cellHybridMaterial'/);
    expect(read('materials/populationFieldMaterial.ts'))
      .not.toContain('export function galaxyRadianceGain');
    // The body's uniform is WIRED, not merely declared: a uniform nobody
    // writes is a knob that does nothing, and this codebase has one already.
    expect(read('components/CellGalaxy.tsx'))
      .toContain('uRadiance.value = galaxyRadianceGain(LIVE.cell.galaxyRadiance)');
    // …and it lands on the RESTING body, above the event terms.
    const body = read('materials/cellHybridMaterial.ts');
    expect(body).toContain('base.a *= uRadiance;');
    expect(body.indexOf('base.a *= uRadiance;'))
      .toBeLessThan(body.indexOf('float a   = base.a * (1.0 - vDeathRamp);'));
  });
});
