// Where the colony's placement meets the mark's radii — the ONE place the two
// files can be compared, because neither is allowed to import the other.
//
// ⭐⭐ THE KEEP-OUT IS A TOPOLOGY NUMBER AND THE MARK'S RADII ARE MATERIAL
// NUMBERS, AND THAT SPLIT IS THE POINT. `networkTopology.derive.ts` is a pure
// data shaper with no React and no three.js; `materials/colonyCohort.ts`
// constructs `ShaderMaterial`s. A derive that imported the material to read one
// float would drag three into every topology test, so `COHORT_KEEP_OUT_R` is
// stated in the derive with its argument written out — and the argument is
// arithmetic ABOUT constants that live over here. Restated numbers drift; this
// file is what stops them, by importing both sides and checking the inequality
// each half was chosen to satisfy.
//
// The live failure it exists for (2026-09-02, T6): the six cohorts' nearest
// non-cohort neighbours stood at 1.274 / 2.355 / 4.602 / 5.337 / 7.794 / 8.247
// wu. The nearest was a clickable sighted peer INSIDE the drawn hole and inside
// the cohort's own pick sphere; hover named the cohort there while the click
// opened the peer, and one cohort's hole opened a neighbour's card from one of
// two azimuths. The colony now keeps the disc empty instead.
import { describe, expect, it } from 'vitest';
import {
  COHORT_AP_R,
  COHORT_HIT_RADIUS,
  COHORT_LINK_STOP_R,
  COHORT_RIM_R,
} from '../../src/materials/colonyCohort';
import { peerCloudHitRadius, PEER_CLOUD_SIGHTED_TONE } from '../../src/materials/peerNodeMaterial';
import { COHORT_KEEP_OUT_R } from '../../src/derives/networkTopology.derive';

describe('COHORT_KEEP_OUT_R against the mark it is keeping clear of', () => {
  // The two the plan named, and they are the whole contract: the disc the
  // colony empties has to contain everything the mark reaches for.
  it('⭐ clears the mark’s outer edge by half a world unit, and swallows the pick sphere', () => {
    expect(COHORT_AP_R + 0.5).toBeLessThanOrEqual(COHORT_KEEP_OUT_R);
    expect(COHORT_HIT_RADIUS).toBeLessThan(COHORT_KEEP_OUT_R);
    // Not a coincidence to be discovered later: 3.5 IS 3.0 + 0.5.
    expect(COHORT_KEEP_OUT_R - COHORT_AP_R).toBeCloseTo(0.5, 12);
  });

  // ⚠️ THE HALF UNIT IS THE LINK'S STUB, NOT A ROUND NUMBER. `ColonyEdges`
  // trims every link incident on a cohort back by `COHORT_LINK_STOP_R`, so a
  // peer displaced to exactly that radius would have its own link trimmed to a
  // point. `colonyEdgePositions` guards `len > 0` and writes no NaN — the
  // standing trap it was written against — but the peer would look unlinked.
  it('⚠️ leaves a link from a displaced peer something to draw', () => {
    expect(COHORT_LINK_STOP_R).toBeLessThan(COHORT_KEEP_OUT_R);
    expect(COHORT_KEEP_OUT_R - COHORT_LINK_STOP_R).toBeCloseTo(0.5, 12);
  });

  // The hole and the two hit spheres, which is what the whole change is about:
  // a displaced peer stands outside the drawn opening AND its own pick sphere
  // no longer reaches the cohort's, so a hover and a click cannot name two
  // different marks over one pixel.
  it('⭐ no hole, and no pair of pick spheres, can overlap across the keep-out', () => {
    expect(COHORT_RIM_R).toBeLessThan(COHORT_KEEP_OUT_R);
    const brightestSighted = peerCloudHitRadius(PEER_CLOUD_SIGHTED_TONE);
    expect(brightestSighted).toBe(1);
    expect(COHORT_HIT_RADIUS + brightestSighted).toBeLessThanOrEqual(COHORT_KEEP_OUT_R);
    // 1.0 wu of daylight between the two spheres at the closest a peer may now
    // stand — measured here so a retune of either radius has to come past it.
    expect(COHORT_KEEP_OUT_R - COHORT_HIT_RADIUS - brightestSighted).toBeCloseTo(1, 12);
  });
});
