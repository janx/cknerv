import { describe, expect, it } from 'vitest';
import {
  POPULATION_CLOSE_POSE_PREFIX_FLOOR,
  POPULATION_FIELD_FILL_REF_DPR,
  POPULATION_HAIRLINE_DENSE_PREFIX,
  QUALITY_PRESETS,
  getQualityRuntimeSnapshot,
  populationClosePosePrefixMul,
  populationFieldFillPixelRatio,
  populationHairlinePrefix,
  populationSpriteMulForCap,
  setAdaptiveQuality,
  setAdaptiveQualityLocked,
  setQualityMode,
  subscribeQualityRuntime,
} from '../../src/tweaks/qualityPresets';
import {
  POPULATION_FIELD_POINT_SIZE_MAX,
  populationPointDrawn,
  populationPointFootprint,
} from '../../src/materials/populationFieldMaterial';

describe('QUALITY_PRESETS', () => {
  it('high preserves the production DPR, stars, particles, and rails', () => {
    expect(QUALITY_PRESETS.high).toEqual({
      maxDpr: 2,
      starsCount: 2000,
      particleCapMul: 1,
      dischargeArms: 3,
      activeSamplesPerHop: 12,
      nucleusNearCap: 12,
      populationCapMul: 1,
      // ⭐ THE ONE FIELD A POW COHORT READS, and it moves the PRECISION of an
      // image and never its presence: the lensed mark computes every pixel by
      // tracing a ray around a mass, so this is the steps that ray may take. At
      // 40 a cohort is the same cohort with a coarser photon ring; a tier that
      // dropped the draw would be a tier that lied about a producer.
      cohortLensSteps: 96,
      memorySignal: {
        coreMinPx: 24,
        compactLinePx: 0.55,
        energyScale: 1,
        expandedLineScale: 1,
      },
    });
  });

  it('med reduces transient runtime capacity without changing Galaxy membership', () => {
    expect(QUALITY_PRESETS.med.maxDpr).toBe(1.5);
    expect(QUALITY_PRESETS.med.starsCount).toBeLessThanOrEqual(700);
    expect(QUALITY_PRESETS.med.particleCapMul).toBe(0.5);
    expect(QUALITY_PRESETS.med).not.toHaveProperty('cellGalaxyMul');
    expect(QUALITY_PRESETS.med.dischargeArms).toBe(2);
    expect(QUALITY_PRESETS.med.activeSamplesPerHop).toBeGreaterThanOrEqual(10);
    expect(QUALITY_PRESETS.med).not.toHaveProperty('passiveEdgeCap');
    expect(QUALITY_PRESETS.med).not.toHaveProperty('passiveSamplesPerEdge');
    expect(QUALITY_PRESETS.med).not.toHaveProperty('passiveAnimationFps');
    expect(QUALITY_PRESETS.med.nucleusNearCap).toBe(8);
    // ⚠️ A STARTING VALUE, NOT YET MEASURED: what the trace costs at a close
    // camera on the reference GPU is the number nobody has, and the live leg
    // owns it. What is pinned is the ORDER — precision falls with the tier — and
    // that no tier reaches zero, because the mark is never gated.
    expect(QUALITY_PRESETS.med.cohortLensSteps).toBe(64);
    expect(QUALITY_PRESETS.med.cohortLensSteps)
      .toBeLessThan(QUALITY_PRESETS.high.cohortLensSteps);
    expect(QUALITY_PRESETS.med.memorySignal).toEqual({
      coreMinPx: 24,
      compactLinePx: 0.62,
      energyScale: 0.94,
      expandedLineScale: 1.06,
    });
  });

  it('low caps DPR at one and drops visual capacity hard', () => {
    expect(QUALITY_PRESETS.low.maxDpr).toBe(1);
    expect(QUALITY_PRESETS.low.starsCount).toBeLessThanOrEqual(250);
    expect(QUALITY_PRESETS.low.particleCapMul).toBeLessThan(0.5);
    expect(QUALITY_PRESETS.low).not.toHaveProperty('cellGalaxyMul');
    expect(QUALITY_PRESETS.low.dischargeArms).toBe(1);
    expect(QUALITY_PRESETS.low.activeSamplesPerHop).toBeGreaterThanOrEqual(8);
    expect(QUALITY_PRESETS.low).not.toHaveProperty('passiveEdgeCap');
    expect(QUALITY_PRESETS.low).not.toHaveProperty('passiveSamplesPerEdge');
    expect(QUALITY_PRESETS.low).not.toHaveProperty('passiveAnimationFps');
    expect(QUALITY_PRESETS.low.nucleusNearCap).toBe(4);
    expect(QUALITY_PRESETS.low.cohortLensSteps).toBe(40);
    expect(QUALITY_PRESETS.low.cohortLensSteps)
      .toBeLessThan(QUALITY_PRESETS.med.cohortLensSteps);
    // ⛔ AND IT IS STILL A TRACE. Below about two dozen steps a ray that lingers
    // near the photon sphere stops resolving into a ring at all, so the floor is
    // a precision and never an off switch.
    expect(QUALITY_PRESETS.low.cohortLensSteps).toBeGreaterThan(24);
    expect(QUALITY_PRESETS.low.memorySignal).toEqual({
      coreMinPx: 24,
      compactLinePx: 0.72,
      energyScale: 0.86,
      expandedLineScale: 1.15,
    });
  });

  it('never sheds memory semantics when the renderer reduces ambience', () => {
    const signals = Object.values(QUALITY_PRESETS).map(
      (preset) => preset.memorySignal,
    );

    expect(new Set(signals.map((signal) => signal.coreMinPx))).toEqual(
      new Set([24]),
    );
    expect(signals[2].compactLinePx).toBeGreaterThan(signals[1].compactLinePx);
    expect(signals[1].compactLinePx).toBeGreaterThan(signals[0].compactLinePx);
    expect(signals[2].energyScale).toBeLessThan(signals[0].energyScale);
  });
});

describe('quality runtime ownership', () => {
  it('manual mode wins immediately and blocks stale adaptive writes', () => {
    let notifications = 0;
    const unsubscribe = subscribeQualityRuntime(() => { notifications += 1; });

    setQualityMode('low');
    expect(getQualityRuntimeSnapshot()).toMatchObject({
      mode: 'low', effective: 'low', source: 'manual',
    });
    setAdaptiveQuality('high');
    expect(getQualityRuntimeSnapshot().effective).toBe('low');

    setQualityMode('auto');
    expect(getQualityRuntimeSnapshot()).toMatchObject({
      mode: 'auto', effective: 'low', source: 'adaptive',
    });
    setAdaptiveQuality('med');
    expect(getQualityRuntimeSnapshot().effective).toBe('med');
    expect(notifications).toBeGreaterThanOrEqual(3);

    unsubscribe();
    // Restore module state for tests that mount production components later.
    setAdaptiveQuality('high');
  });

  it('publishes the calibration lock and counts only real tier switches', () => {
    setQualityMode('auto');
    setAdaptiveQuality('high');
    const before = getQualityRuntimeSnapshot().switches;

    setAdaptiveQuality('med');
    expect(getQualityRuntimeSnapshot().switches).toBe(before + 1);
    setAdaptiveQuality('med'); // republishing the same tier is not a switch
    expect(getQualityRuntimeSnapshot().switches).toBe(before + 1);

    setAdaptiveQualityLocked(true);
    expect(getQualityRuntimeSnapshot()).toMatchObject({
      mode: 'auto', effective: 'med', locked: true, switches: before + 1,
    });

    // Choosing a mode by hand is the one thing that clears the lock, and it
    // is not an automatic switch.
    setQualityMode('low');
    expect(getQualityRuntimeSnapshot().locked).toBe(false);
    setAdaptiveQualityLocked(true);
    expect(getQualityRuntimeSnapshot().locked).toBe(false);
    setQualityMode('auto');
    expect(getQualityRuntimeSnapshot()).toMatchObject({
      mode: 'auto', locked: false, switches: before + 1,
    });

    setAdaptiveQuality('high');
  });
});

describe('the halo participates in the cascade', () => {
  // The defect this closes: the halo's two draws measured 4.77 ms of GPU per
  // frame at 3840x2160 against 0.60 ms for the whole rest of the scene, and
  // no preset field reached it — high and low measured 5.38 and 5.36 ms. A
  // controller that can dim the picture but not speed it up steps down twice
  // and never climbs back, which is exactly what a live machine reported.
  it('draws the whole placement at high, so the reference picture is unchanged', () => {
    expect(QUALITY_PRESETS.high.populationCapMul).toBe(1);
  });

  it('buys real frames on the way down, monotonically', () => {
    expect(QUALITY_PRESETS.med.populationCapMul)
      .toBeLessThan(QUALITY_PRESETS.high.populationCapMul);
    expect(QUALITY_PRESETS.low.populationCapMul)
      .toBeLessThan(QUALITY_PRESETS.med.populationCapMul);
    // Cost is linear in primitive count, so the share IS the saving. Anything
    // above this leaves the step-down too small to escape a dip.
    expect(QUALITY_PRESETS.low.populationCapMul).toBeLessThanOrEqual(0.25);
  });

  it('keeps the layer present at every preset — a population, never absent', () => {
    for (const preset of ['high', 'med', 'low'] as const) {
      expect(QUALITY_PRESETS[preset].populationCapMul).toBeGreaterThan(0);
    }
  });
});

describe('the halo keeps its reach and spends its level', () => {
  // D-9: `populationCapMul` is a UNIFORM DENSITY prefix, and density in this
  // layer is the compressed statement of how much of the chain is unresolved —
  // so a quarter-prefix does not draw the same picture more cheaply, it draws
  // a smaller claim, and mainnet at `low` read as a stage that had retained
  // its whole scope.
  const cover = (capMul: number) =>
    capMul * populationSpriteMulForCap(capMul) ** 2;

  it('leaves the count as the cost lever, untouched', () => {
    // Cost is linear in primitive count and near-flat in sprite area; the
    // prefix is the whole saving and the compensation may not eat it.
    expect(QUALITY_PRESETS.high.populationCapMul).toBe(1);
    expect(QUALITY_PRESETS.med.populationCapMul).toBe(0.5);
    expect(QUALITY_PRESETS.low.populationCapMul).toBe(0.25);
  });

  it('grows the sprite as the count falls, and by less than half', () => {
    expect(populationSpriteMulForCap(1)).toBe(1);
    // Radius x1.19 at med, x1.41 at low: area x1.41 and x2.
    expect(populationSpriteMulForCap(0.5)).toBeCloseTo(1.189, 3);
    expect(populationSpriteMulForCap(0.25)).toBeCloseTo(1.414, 3);
    for (const mul of [0.25, 0.5]) {
      const area = populationSpriteMulForCap(mul) ** 2;
      expect(area, 'the area compensation ate the count saving')
        .toBeLessThan(1 / mul);
    }
  });

  it('spends the LEVEL and keeps the REACH', () => {
    // Total drawn light — count x area — is what a reader sees as level.
    expect(cover(1)).toBeCloseTo(1, 6);
    expect(cover(0.5)).toBeCloseTo(Math.sqrt(0.5), 6);
    expect(cover(0.25)).toBeCloseTo(0.5, 6);
    // Monotone: each tier down is dimmer than the one above, which is what
    // makes the control legible at all.
    expect(cover(0.25)).toBeLessThan(cover(0.5));
    expect(cover(0.5)).toBeLessThan(cover(1));
    // …and NOT constant, which is the opposite failure: full compensation
    // (`capMul ** -0.5`) would make the tiers indistinguishable.
    expect(cover(0.25)).toBeLessThan(0.9);
    // The reach: every sprite is bigger, so the thin outer fringe a quarter
    // prefix leaves behind is drawn wider rather than fading out of the frame.
    expect(populationSpriteMulForCap(0.25)).toBeGreaterThan(1);
  });

  it('never asks for a zero or negative radius', () => {
    expect(Number.isFinite(populationSpriteMulForCap(0))).toBe(true);
    expect(populationSpriteMulForCap(0)).toBeGreaterThan(0);
  });
});

describe('⟨D-3⟩ the population field spends no more device-pixel fill at high dpr than at the reference', () => {
  it('is the true ratio at or below the reference dpr — the 1× path is byte-identical', () => {
    expect(POPULATION_FIELD_FILL_REF_DPR).toBe(1);
    expect(populationFieldFillPixelRatio(0.5)).toBe(0.5);
    expect(populationFieldFillPixelRatio(1)).toBe(1);
  });

  it('caps the sizing dpr above the reference so a 2× buffer sizes as a 1× one', () => {
    expect(populationFieldFillPixelRatio(2)).toBe(1);
    expect(populationFieldFillPixelRatio(3)).toBe(1);
  });

  it('holds the point pass device-pixel fill to the dpr-1 budget (down 4× at dpr 2)', () => {
    // A footprint-bound bead (between the min and max clamps): its drawn size
    // is the footprint, and fill scales as its square.
    const cssHeight = 1080;
    const size = POPULATION_FIELD_POINT_SIZE_MAX;
    const viewDistance = 60;
    const drawn1 = populationPointDrawn(
      populationPointFootprint(size, cssHeight * 1, viewDistance),
      1,
    );
    // dpr 2 the pre-D-3 way: the device viewport is 2× and the clamps ×2, so
    // the bead is twice the linear footprint — 4× the device-pixel fill.
    const drawn2Uncapped = populationPointDrawn(
      populationPointFootprint(size, cssHeight * 2, viewDistance),
      2,
    );
    // dpr 2 with the D-3 budget: sized as if the buffer were the reference DPR.
    const fill = populationFieldFillPixelRatio(2);
    const drawn2Capped = populationPointDrawn(
      populationPointFootprint(size, cssHeight * fill, viewDistance),
      fill,
    );
    expect(drawn2Uncapped).toBeCloseTo(drawn1 * 2, 6);
    expect(drawn2Capped).toBe(drawn1);
    expect(drawn2Capped).toBeLessThan(drawn2Uncapped);
  });
});

describe('⟨D-2⟩ the hairline pass takes half the point prefix on a dense buffer', () => {
  it('draws the whole prefix at or below the reference dpr — the 1× path is byte-identical', () => {
    // The one-device-pixel pass is the element ⟨D-3⟩'s fill budget cannot
    // reach, so this is the lever that bounds it — and like ⟨D-3⟩ it may not
    // touch a single 1× display.
    expect(populationHairlinePrefix(105_000, 1, POPULATION_FIELD_FILL_REF_DPR))
      .toBe(105_000);
    expect(populationHairlinePrefix(105_000, 0.5)).toBe(105_000);
    expect(populationHairlinePrefix(0, 1)).toBe(0);
  });

  it('takes the first half above the reference — at 1.5× as at 2×', () => {
    // Denseness is a boolean, not a curve: 1.5 (the `med` ceiling) and 2 (the
    // `high` one) are both "above the reference" and both cut the same way.
    expect(POPULATION_HAIRLINE_DENSE_PREFIX).toBe(0.5);
    expect(populationHairlinePrefix(105_000, 1.5)).toBe(52_500);
    expect(populationHairlinePrefix(105_000, 2)).toBe(52_500);
    expect(populationHairlinePrefix(105_000, 3)).toBe(52_500);
    // Rounded, like every other prefix this layer computes.
    expect(populationHairlinePrefix(7, 2)).toBe(4);
    expect(populationHairlinePrefix(0, 2)).toBe(0);
  });

  it('is a SUB-prefix of the point prefix, at every tier and every dpr', () => {
    // The whole safety argument: `populationSegmentsForPointPrefix` is exact on
    // a prefix of the points, and a strand may never hang off a bead that is
    // not drawn. The hairline prefix is inside the bead prefix, so the same
    // binary search covers it unchanged.
    for (const capMul of [1, 0.5, 0.25, 0.03]) {
      const points = Math.round(105_000 * capMul);
      for (const dpr of [0.75, 1, 1.5, 2, 2.625, 3]) {
        const hairline = populationHairlinePrefix(points, dpr);
        expect(hairline).toBeGreaterThanOrEqual(0);
        expect(hairline).toBeLessThanOrEqual(points);
      }
    }
  });

  it('reads a non-finite ratio as "not dense" and keeps the whole prefix', () => {
    // `resolvePointSpritePixelRatio` already guards the call site; a lever that
    // can only ever REMOVE filaments must not be armed by a NaN either way.
    expect(populationHairlinePrefix(105_000, Number.NaN)).toBe(105_000);
  });
});

describe('⟨close pose⟩ the halo folds its point prefix on the detail camera', () => {
  it('draws the whole prefix at the overview — the default pose is byte-identical', () => {
    // The fold's own reference point, and the one the eye judges the layer at:
    // focus 0 is every pose the review's default captures were taken from.
    expect(populationClosePosePrefixMul(0)).toBe(1);
    // An unwired caller reads 0 through the prop's `?? 0`, and a curve that has
    // not been written yet reads the same. Both are the overview.
    expect(populationClosePosePrefixMul(-0.5)).toBe(1);
    expect(populationClosePosePrefixMul(Number.NaN)).toBe(1);
    expect(populationClosePosePrefixMul(Number.NEGATIVE_INFINITY)).toBe(1);
  });

  it('reaches the floor at the detail camera and saturates there', () => {
    expect(POPULATION_CLOSE_POSE_PREFIX_FLOOR).toBe(0.4);
    expect(populationClosePosePrefixMul(1)).toBe(POPULATION_CLOSE_POSE_PREFIX_FLOOR);
    expect(populationClosePosePrefixMul(1.4)).toBe(POPULATION_CLOSE_POSE_PREFIX_FLOOR);
  });

  it('is the straight line between them, so a dolly travels rather than steps', () => {
    // `cellDetailViewFocus` is already a smoothstep of camera distance, so the
    // fold needs no easing of its own — it inherits the curve's. What it may
    // not have is a knee: a step in the count is a step in the picture.
    expect(populationClosePosePrefixMul(0.5)).toBeCloseTo(0.7, 12);
    expect(populationClosePosePrefixMul(0.25)).toBeCloseTo(0.85, 12);
    expect(populationClosePosePrefixMul(0.75)).toBeCloseTo(0.55, 12);
    let previous = populationClosePosePrefixMul(0);
    for (let step = 1; step <= 100; step += 1) {
      const mul = populationClosePosePrefixMul(step / 100);
      expect(mul).toBeLessThanOrEqual(previous);
      expect(mul).toBeGreaterThanOrEqual(POPULATION_CLOSE_POSE_PREFIX_FLOOR);
      expect(mul).toBeLessThanOrEqual(1);
      previous = mul;
    }
  });

  it('takes its floor as an argument, so a re-ruling is one number', () => {
    // The floor is art direction under an eye gate: D-3 option (B) is a
    // different number in the same law, never a second law.
    expect(populationClosePosePrefixMul(1, 0.7)).toBe(0.7);
    expect(populationClosePosePrefixMul(0.5, 0.7)).toBeCloseTo(0.85, 12);
    expect(populationClosePosePrefixMul(0, 0.7)).toBe(1);
  });

  it('composes with the tier and with ⟨D-2⟩ as ONE prefix chain', () => {
    // The layer's cost levers multiply on the same axis and in this order:
    // tier → pose → (dense buffer). Each stage is a prefix of the last, so the
    // hairline range stays a sub-prefix of the beads at every combination and
    // no strand can hang off a bead that is not drawn.
    for (const capMul of [1, 0.5, 0.25, 0.03]) {
      for (const focus of [0, 0.25, 0.5, 1]) {
        const tierPoints = Math.round(105_000 * capMul);
        const points = Math.round(
          tierPoints * populationClosePosePrefixMul(focus),
        );
        expect(points).toBeLessThanOrEqual(tierPoints);
        for (const dpr of [1, 2]) {
          const hairline = populationHairlinePrefix(points, dpr);
          expect(hairline).toBeGreaterThanOrEqual(0);
          expect(hairline).toBeLessThanOrEqual(points);
        }
      }
    }
  });

  it('leaves the sprite compensation to the TIER, which is the only thing that claims an amount', () => {
    // ⟨D-9⟩: a tier draws a quarter of the field from the SAME camera, so the
    // sprite pays the level back or the halo states a smaller amount. A close
    // pose is the reader moving in, and the fold has no business in that
    // channel — `populationSpriteMulForCap` reads the tier and only the tier.
    expect(populationSpriteMulForCap(0.25)).toBeCloseTo(0.25 ** -0.25, 12);
    expect(populationSpriteMulForCap(1)).toBe(1);
  });
});
