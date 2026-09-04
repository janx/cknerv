// Where the colony's placement meets the mark's radii — the ONE place the two
// files can be compared, because neither is allowed to import the other.
//
// ⭐⭐ THE KEEP-OUT IS A TOPOLOGY NUMBER AND THE MARK'S RADII ARE MATERIAL
// NUMBERS, AND THAT SPLIT IS THE POINT. `networkTopology.derive.ts` is a pure
// data shaper with no React and no three.js; `materials/colonyLens.ts`
// constructs a `ShaderMaterial`. A derive that imported the material to read one
// float would drag three into every topology test, so `COHORT_KEEP_OUT_R` is
// stated in the derive with its argument written out — and the argument is
// arithmetic ABOUT constants that live over here. Restated numbers drift; this
// file is what stops them, by importing both sides and checking the inequality
// each half was chosen to satisfy.
//
// ⭐⭐⭐ AND SINCE 2026-09-03 EVERY RADIUS ON THIS MARK IS A MULTIPLE OF ONE
// MASS. The composed aperture had a picked outer radius (3.0), a picked hole
// (1.6) and a pick sphere that was half of the first; the lensed mark has a
// Schwarzschild radius and four numbers that FOLLOW from it — the shadow at
// 3√3/2 horizons, the ISCO at 3, and then the two the rest of the colony reads.
// So the chain below is not four tuned values that happen to be ordered: it is
// two derivations, one literal and one topology constant, in the order the
// geometry puts them.
//
// The live failure it exists for (2026-09-02, T6): the six cohorts' nearest
// non-cohort neighbours stood at 1.274 / 2.355 / 4.602 / 5.337 / 7.794 / 8.247
// wu. The nearest was a clickable sighted peer INSIDE the drawn mark and inside
// the cohort's own pick sphere; hover named the cohort there while the click
// opened the peer, and one cohort's own centre opened a neighbour's card from
// one of two azimuths. The colony now keeps the disc empty instead.
import { describe, expect, it } from 'vitest';
import {
  COHORT_DISC_IN,
  COHORT_DISC_OUT_FAR,
  COHORT_HIT_RADIUS,
  COHORT_HORIZON,
  COHORT_LENS_FAR_GLOW_R,
  COHORT_LINK_STOP_R,
  COHORT_MASS_FLOOR,
  COHORT_SHADOW_RATIO,
  cohortShadowRadius,
} from '../../src/materials/colonyLens';
import {
  peerCloudHitRadius,
  PEER_CLOUD_GHOST_TONE,
  PEER_CLOUD_SIGHTED_DARK_TONE,
  PEER_CLOUD_SIGHTED_TONE,
} from '../../src/materials/peerNodeMaterial';
import { COHORT_KEEP_OUT_R } from '../../src/derives/networkTopology.derive';

describe('the four radii of a POW cohort, in the order the geometry puts them', () => {
  it('⭐⭐⭐ HIT 2.0 < DISC_IN 2.31 < LINK_STOP 3.0 < KEEP_OUT 3.5', () => {
    // The whole chain in one line, because each step is a different consumer
    // asking a different question and the answers must not cross:
    //
    //   HIT       what a viewer is unmistakably aiming at — the SHADOW;
    //   DISC_IN   where the disc starts to shine — the ISCO, a fact about
    //             orbits, and the reason the film's hole has a gap in it;
    //   LINK_STOP where a cohort's own links end, outside the computed image;
    //   KEEP_OUT  the closest the colony will let anything clickable stand.
    expect(COHORT_HIT_RADIUS).toBeLessThan(COHORT_DISC_IN);
    expect(COHORT_DISC_IN).toBeLessThan(COHORT_LINK_STOP_R);
    expect(COHORT_LINK_STOP_R).toBeLessThan(COHORT_KEEP_OUT_R);
    // …at the values the form ships with.
    expect(COHORT_HIT_RADIUS).toBeCloseTo(2.0005, 4);
    expect(COHORT_DISC_IN).toBeCloseTo(2.31, 12);
    expect(COHORT_LINK_STOP_R).toBe(3);
    expect(COHORT_KEEP_OUT_R).toBe(3.5);
  });

  it('⭐ derives the pick sphere from the MASS and never from the quad', () => {
    // ⭐⭐ THE TARGET IS THE SHADOW — 3√3/2 horizons, the impact parameter of
    // the last ray that escapes — and it is derived rather than typed, so a
    // retune of the mass moves the target with the picture. The approved
    // preview's own literal was 2.0; this is 2.0005, which is the same number
    // with one fewer place for it to disagree.
    expect(COHORT_HIT_RADIUS).toBe(cohortShadowRadius(COHORT_HORIZON));
    expect(COHORT_SHADOW_RATIO).toBeCloseTo(2.598, 3);
    // ⚠️ AND THE QUAD IS 64 WORLD UNITS ACROSS, so "the mark's own extent" is
    // not a target anybody could mean: the far halo has no edge to aim at, the
    // near disc reaches 28 wu, and both would swallow a neighbour's clicks
    // whole. The hit sphere is the same at every camera because the topology
    // does not know where the camera is — a target that folded with the drawn
    // form would move under the cursor as the user dollied.
    expect(COHORT_HIT_RADIUS).toBeLessThan(COHORT_KEEP_OUT_R);
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

  // The two hit spheres, which is what the whole placement change was about: a
  // displaced peer stands outside the computed image AND its own pick sphere no
  // longer reaches the cohort's, so a hover and a click cannot name two
  // different marks over one pixel.
  it('⭐ no pair of pick spheres can overlap across the keep-out', () => {
    const brightestSighted = peerCloudHitRadius(PEER_CLOUD_SIGHTED_TONE);
    expect(brightestSighted).toBe(1);
    expect(COHORT_HIT_RADIUS + brightestSighted).toBeLessThanOrEqual(COHORT_KEEP_OUT_R);
    // ⚠️ HALF A WORLD UNIT OF DAYLIGHT, DOWN FROM 1.0 — the target grew from
    // 1.5 to 2.0 with the form and the keep-out did not move with it. That is
    // the margin a retune of either has to come past, and it is measured here
    // rather than assumed anywhere.
    expect(COHORT_KEEP_OUT_R - COHORT_HIT_RADIUS - brightestSighted)
      .toBeCloseTo(0.4995, 4);
  });

  // ⭐⭐⭐ AND SINCE 2026-09-04 THE MASS IS PER COHORT, so every radius above is
  // multiplied by a factor in [`COHORT_MASS_FLOOR`, 1] — every radius except
  // the three the TOPOLOGY reads, which stay sized for the maximum. That split
  // is what these two inequalities are about: the floor was chosen so the
  // smallest mark the data can produce is still a mark, and the target it
  // stands behind is still bigger than it.
  it('⭐ keeps the smallest cohort a lesser peer and never a vanished one', () => {
    // A floor cohort's arms still reach past the radius its own links stop at,
    // so the mesh's lines end INSIDE its atmosphere rather than two units short
    // of a mark with nothing around it.
    expect(COHORT_DISC_OUT_FAR * COHORT_MASS_FLOOR).toBeCloseTo(6.3, 10);
    expect(COHORT_DISC_OUT_FAR * COHORT_MASS_FLOOR)
      .toBeGreaterThan(COHORT_LINK_STOP_R);

    // ⭐⭐ THE NUCLEUS AGAINST THE PEER MESH'S OWN YARDSTICKS, which are world
    // DIAMETERS. `exp(-t²)` falls to a tenth of its peak at t = 1.52, so the
    // visible footprint is `2 · 1.52 · r · m` — 0.96 wu at the floor. It
    // out-foots a ghost (0.65) and sits under a dark sighted peer (1.5): a
    // lesser peer, which is what a cohort with 2 % of the week is.
    const nucleus = (mass: number): number =>
      2 * 1.52 * COHORT_LENS_FAR_GLOW_R * mass;
    expect(nucleus(COHORT_MASS_FLOOR)).toBeCloseTo(0.958, 3);
    expect(nucleus(COHORT_MASS_FLOOR)).toBeGreaterThan(PEER_CLOUD_GHOST_TONE.size);
    expect(nucleus(COHORT_MASS_FLOOR))
      .toBeLessThan(PEER_CLOUD_SIGHTED_DARK_TONE.size ?? 1.5);
    // …and at full mass it is a sighted peer's own sprite, which is the size
    // the far form was cut to on 2026-09-03.
    expect(nucleus(1)).toBeCloseTo(2.13, 2);
    expect(PEER_CLOUD_GHOST_TONE.size).toBe(0.65);

    // ⚠️ THE TARGET IS NEVER SMALLER THAN THE IMAGE. `COHORT_HIT_RADIUS` does
    // not fold — the topology does not know where the camera is, and a target
    // that shrank with the week would move under the cursor as the ledger
    // refreshed — so the hit sphere CONTAINS the smallest shadow the near form
    // can draw (0.90 wu inside a 2.0 wu target) with room to spare.
    const smallestShadow = cohortShadowRadius(COHORT_HORIZON) * COHORT_MASS_FLOOR;
    expect(smallestShadow).toBeCloseTo(0.9, 2);
    expect(smallestShadow).toBeLessThan(COHORT_HIT_RADIUS);
    expect(COHORT_HIT_RADIUS).toBe(cohortShadowRadius(COHORT_HORIZON));
    // …and the whole chain above is unchanged by the mass, because none of it
    // reads one.
    expect(COHORT_LINK_STOP_R).toBe(3);
    expect(COHORT_MASS_FLOOR).toBeGreaterThan(0);
    expect(COHORT_MASS_FLOOR).toBeLessThan(1);
  });
});
