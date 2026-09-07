// ⟨close pose⟩ The halo's point prefix on the overview↔detail curve.
//
// The layer's two other ceilings are pose-blind: the ⟨D-3⟩ fill budget bounds
// the beads' and capsules' device-pixel footprint, and ⟨D-2⟩ bounds the
// one-pixel hairline's count on a dense buffer. A close camera adds no
// primitive — it magnifies the ones there are — so ten wheel notches in, or the
// cohort dolly, took the three halo draws from 5.0 to 8–10 ms and the scoped
// scene pass from 7.6 to 16–17 ms·GHz, 43 fps at 1 GHz (review B3).
//
// So the point prefix folds along the ref this layer already takes, and what is
// pinned here is the WIRING the pure helper's own tests cannot see: that the
// overview pose is byte-identical to the pre-fold path, that BOTH stroke
// classes follow the folded prefix without a second camera-keyed law, that the
// SPRITE does not follow it (the level belongs to the tier, ⟨D-9⟩), and that a
// dolly re-cuts while a settled camera does not.
//
// Its own harness rather than a shared one, deliberately: this lever and ⟨D-2⟩
// are both under an eye gate and each has to be revertible without touching the
// other's test file.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import CellPopulationField from '../../src/components/CellPopulationField';
import {
  resetPopulationPlacement,
  setPopulationPlacement,
  type PopulationPlacementSnapshot,
} from '../../src/geometry/populationPlacementStore';
import { POPULATION_CLOSE_POSE_PREFIX_FLOOR } from '../../src/tweaks/qualityPresets';

const frames = vi.hoisted(() => ({
  callback: null as ((state: unknown) => void) | null,
}));

vi.mock('@react-three/fiber', () => ({
  useFrame: (callback: (state: unknown) => void) => {
    frames.callback = callback;
  },
}));

/** 40 points on one chain, with the PROMOTED strand at the head of it and the
 *  residual filaments behind: each half is monotone non-decreasing in its
 *  larger endpoint on its own — which is what makes
 *  `populationSegmentsForPointPrefix` exact on each — and both halves still
 *  draw something once the fold has taken 60 % of the beads, which is the
 *  point of putting the strand first. */
const POINTS = 40;
const BACKBONE_SEGMENTS = 10;
const RESIDUAL_SEGMENTS = 29;

function pairs(from: number, to: number): Uint32Array {
  const out = new Uint32Array((to - from) * 2);
  for (let i = from; i < to; i += 1) {
    out[(i - from) * 2] = i;
    out[(i - from) * 2 + 1] = i + 1;
  }
  return out;
}

function chainPlacement(): PopulationPlacementSnapshot {
  const positions = new Float32Array(POINTS * 3);
  const weights = new Float32Array(POINTS);
  for (let i = 0; i < POINTS; i += 1) {
    positions[i * 3] = i;
    weights[i] = 1;
  }
  return {
    positions,
    segments: pairs(0, BACKBONE_SEGMENTS + RESIDUAL_SEGMENTS),
    backboneSegments: pairs(0, BACKBONE_SEGMENTS),
    backboneSegmentCount: BACKBONE_SEGMENTS,
    residualSegments: pairs(BACKBONE_SEGMENTS, BACKBONE_SEGMENTS + RESIDUAL_SEGMENTS),
    residualSegmentCount: RESIDUAL_SEGMENTS,
    backboneComponents: 1,
    weights,
    count: POINTS,
    segmentCount: BACKBONE_SEGMENTS + RESIDUAL_SEGMENTS,
    streamlines: 1,
    work: 0,
  };
}

interface Drawn { points: number; segments: number; backbone: number }

function stats(): {
  drawn: Drawn;
  taper: { sizeMin: number; sizeMax: number; minPointPx: number };
} {
  const read = (window as unknown as Record<string, unknown>)
    .__populationFieldStats as (() => {
      drawn: Drawn;
      taper: { sizeMin: number; sizeMax: number; minPointPx: number };
    }) | undefined;
  if (!read) throw new Error('the layer published no stats');
  return read();
}

const drawn = (): Drawn => stats().drawn;

/** One frame at the reference DPR — ⟨D-2⟩'s lever is inert at 1×, so every
 *  count below is this task's own. */
function frameAt(pixelRatio = 1): void {
  const callback = frames.callback;
  if (!callback) throw new Error('the layer registered no frame callback');
  act(() => {
    callback({
      gl: { getPixelRatio: () => pixelRatio },
      size: { width: 1920, height: 1080 },
    });
  });
}

/** The camera's own place on the curve, exactly as `CellDetailViewTracker`
 *  writes it: a plain ref the caller owns and the frame loop reads. */
const focusRef = { current: 0 };

beforeEach(() => {
  frames.callback = null;
  focusRef.current = 0;
  resetPopulationPlacement();
  setPopulationPlacement(chainPlacement());
});

afterEach(() => {
  cleanup();
  resetPopulationPlacement();
});

describe('⟨close pose⟩ the halo folds its point prefix toward the detail camera', () => {
  it('draws every bead at the overview, and with no ref at all', () => {
    // The pose the eye judges this layer at, and the pose every default
    // capture is taken from: the fold may not touch it. An absent ref reads as
    // the overview too — the knob's default is today's picture.
    render(<CellPopulationField active gainRef={{ current: 1 }} />);
    frameAt();
    expect(drawn()).toEqual({
      points: POINTS,
      segments: RESIDUAL_SEGMENTS,
      backbone: BACKBONE_SEGMENTS,
    });
  });

  it('folds to the floor at the detail camera, and both stroke classes follow it', () => {
    render(
      <CellPopulationField
        active
        gainRef={{ current: 1 }}
        cellDetailViewFocusRef={focusRef}
      />,
    );
    focusRef.current = 1;
    frameAt();
    // 40 beads × 0.4 = 16, and each stroke class keeps the segments whose
    // larger endpoint is under that prefix — 10 promoted (endpoints 1…10) and
    // 5 residual (11…15) — from ONE multiplier on the beads, which is what
    // "no second camera-keyed law on the stroke classes" means in counts.
    expect(POPULATION_CLOSE_POSE_PREFIX_FLOOR).toBe(0.4);
    expect(drawn()).toEqual({ points: 16, segments: 5, backbone: 10 });
  });

  it('travels along the curve instead of stepping onto it', () => {
    render(
      <CellPopulationField
        active
        gainRef={{ current: 1 }}
        cellDetailViewFocusRef={focusRef}
      />,
    );
    let previous = POINTS + 1;
    for (const focus of [0, 0.25, 0.5, 0.75, 1]) {
      focusRef.current = focus;
      frameAt();
      const { points } = drawn();
      expect(points).toBeLessThan(previous);
      previous = points;
    }
    // …and back out again: a dolly out restores the field it folded.
    focusRef.current = 0;
    frameAt();
    expect(drawn().points).toBe(POINTS);
  });

  it('leaves the sprite where the tier put it', () => {
    // ⟨D-9⟩: the sprite compensates a TIER, because a tier draws a thinner
    // field from the same camera and would otherwise state a smaller amount.
    // A close pose is the reader moving in, so the fold spends fill and says
    // nothing about the amount — the taper may not move with it.
    render(
      <CellPopulationField
        active
        gainRef={{ current: 1 }}
        cellDetailViewFocusRef={focusRef}
      />,
    );
    frameAt();
    const overview = stats().taper;
    focusRef.current = 1;
    frameAt();
    expect(drawn().points).toBe(16);
    expect(stats().taper).toEqual(overview);
  });

  it('does nothing at all while the camera is settled', () => {
    // The file's whole claim is that a settled frame is three draws. The focus
    // is the one key term that never ends on its own, so it is keyed on an
    // epsilon like the tier and not on equality.
    render(
      <CellPopulationField
        active
        gainRef={{ current: 1 }}
        cellDetailViewFocusRef={focusRef}
      />,
    );
    // 0.5206 and 0.5210 straddle a rounding boundary of this fixture's prefix
    // — 27.5056 beads against 27.496 — so a trim that RAN on the second frame
    // would draw 27 and one that was skipped draws 28. The two poses are
    // 0.0004 apart, inside the epsilon, which is the whole assertion: the check
    // is on the trim actually not running, not on the answer being stable.
    focusRef.current = 0.5206;
    frameAt();
    const settled = drawn();
    expect(settled.points).toBe(28);
    focusRef.current = 0.521;
    frameAt();
    expect(drawn()).toEqual(settled);
    // …and a real move re-cuts, to the very count the skipped frame refused.
    focusRef.current = 0.53;
    frameAt();
    expect(drawn().points).toBe(27);
  });

  it('reads the curve by ref and keys the trim on it, beside the other two terms', () => {
    const field = readFileSync(
      resolve(process.cwd(), 'src/components/CellPopulationField.tsx'),
      'utf8',
    );
    // One law, one place: the component asks the helper that states the
    // measurement rather than carrying a floor of its own.
    expect(field).toContain('populationClosePosePrefixMul(');
    // The trim's argument is still the tier alone — everything else it needs
    // arrives by ref — and the key GAINED a term rather than losing one.
    expect(field).toContain('applyTrim(capMul)');
    expect(field).toContain('Math.abs(capMul - capApplied.current) > 0.0005');
    expect(field).toContain('Math.abs(focus - focusApplied.current) > 0.0005');
    // …and the sprite is still computed from the tier cap.
    expect(field).toContain('populationSpriteMulForCap(capMul)');
  });
});
