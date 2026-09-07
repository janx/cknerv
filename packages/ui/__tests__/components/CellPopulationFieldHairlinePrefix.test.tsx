// ⟨D-2⟩ The residual-hairline pass on a buffer denser than the reference.
//
// ⟨D-3⟩ holds the beads' and the capsules' device-pixel FILL to the reference
// budget, because both are sized in drawing-buffer pixels. The hairline pass is
// the element it cannot reach: a `gl.LINES` stroke is one device pixel by
// construction, so it writes no footprint and its cost is geometric — it rides
// the buffer untouched. Live at 1920×1080 @2× that made it the most expensive
// draw in the frame, 2.47 ms of a 7.59 ms scoped scene pass.
//
// So on a dense buffer it takes the first HALF of the point prefix, while the
// beads and the capsule backbone keep the whole of it. What is pinned here is
// the WIRING of that law, which the pure helper's own tests cannot see: which
// of the three draws takes the reduced prefix and which two do not, that a 1×
// buffer is byte-identical to the pre-D-2 path, and that the trim is keyed on
// the buffer density as well as on the tier — a tier crossfade caps the
// renderer at the preset's own `maxDpr`, so `high → low` on a 2× display
// crosses the reference and the range has to be re-cut on that frame.
//
// The component is Canvas-bound only through `useFrame` (the
// CellIdentityProofMarkers precedent), and its placement arrives from a store
// with a test seam, so a mocked r3f plus a published placement hands the test
// the very draw ranges the renderer reads.
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

const frames = vi.hoisted(() => ({
  callback: null as ((state: unknown) => void) | null,
}));

vi.mock('@react-three/fiber', () => ({
  useFrame: (callback: (state: unknown) => void) => {
    frames.callback = callback;
  },
}));

/** 40 points on one chain. The residual half owns the first 29 segments and the
 *  promoted half the last 10, so each is monotone non-decreasing in its larger
 *  endpoint on its own — which is what makes `populationSegmentsForPointPrefix`
 *  exact on each — and a point prefix P keeps `min(P - 1, 29)` hairlines. */
const POINTS = 40;
const RESIDUAL_SEGMENTS = 29;
const BACKBONE_SEGMENTS = 10;

function chainPlacement(): PopulationPlacementSnapshot {
  const positions = new Float32Array(POINTS * 3);
  const weights = new Float32Array(POINTS);
  for (let i = 0; i < POINTS; i += 1) {
    positions[i * 3] = i;
    weights[i] = 1;
  }
  const pairs = (from: number, to: number): Uint32Array => {
    const out = new Uint32Array((to - from) * 2);
    for (let i = from; i < to; i += 1) {
      out[(i - from) * 2] = i;
      out[(i - from) * 2 + 1] = i + 1;
    }
    return out;
  };
  const residualSegments = pairs(0, RESIDUAL_SEGMENTS);
  const backboneSegments = pairs(RESIDUAL_SEGMENTS, RESIDUAL_SEGMENTS + BACKBONE_SEGMENTS);
  return {
    positions,
    segments: pairs(0, RESIDUAL_SEGMENTS + BACKBONE_SEGMENTS),
    backboneSegments,
    backboneSegmentCount: BACKBONE_SEGMENTS,
    residualSegments,
    residualSegmentCount: RESIDUAL_SEGMENTS,
    backboneComponents: 1,
    weights,
    count: POINTS,
    segmentCount: RESIDUAL_SEGMENTS + BACKBONE_SEGMENTS,
    streamlines: 1,
    work: 0,
  };
}

interface Drawn { points: number; segments: number; backbone: number }

/** What the three draws would submit, read off the live geometries through the
 *  layer's own dev counter. */
function drawn(): Drawn {
  const stats = (window as unknown as Record<string, unknown>)
    .__populationFieldStats as (() => { drawn: Drawn }) | undefined;
  if (!stats) throw new Error('the layer published no stats');
  return stats().drawn;
}

/** One frame at a given renderer DPR. */
function frameAt(pixelRatio: number): void {
  const callback = frames.callback;
  if (!callback) throw new Error('the layer registered no frame callback');
  act(() => {
    callback({
      gl: { getPixelRatio: () => pixelRatio },
      size: { width: 1920, height: 1080 },
    });
  });
}

beforeEach(() => {
  frames.callback = null;
  resetPopulationPlacement();
  setPopulationPlacement(chainPlacement());
});

afterEach(() => {
  cleanup();
  resetPopulationPlacement();
});

describe('⟨D-2⟩ the halo hairlines take half the point prefix on a dense buffer', () => {
  it('draws every hairline at dpr 1 — the reference path is untouched', () => {
    render(<CellPopulationField active gainRef={{ current: 1 }} />);
    frameAt(1);
    expect(drawn()).toEqual({
      points: POINTS,
      segments: RESIDUAL_SEGMENTS,
      backbone: BACKBONE_SEGMENTS,
    });
  });

  it('halves the hairline prefix at dpr 2, and only the hairlines', () => {
    render(<CellPopulationField active gainRef={{ current: 1 }} />);
    frameAt(2);
    // The beads and the promoted strands keep the WHOLE prefix: what a dense
    // buffer spends is filament density, never reach and never the strands
    // that carry the read.
    expect(drawn()).toEqual({
      points: POINTS,
      // Point prefix 40 → hairline prefix 20 → the chain's segments whose
      // larger endpoint is under 20, i.e. 19 of the 29.
      segments: 19,
      backbone: BACKBONE_SEGMENTS,
    });
  });

  it('re-cuts the range when a tier crossfade carries the dpr across the reference', () => {
    // `high` caps the renderer at 2 and `low` at 1, so the tier and the buffer
    // density move together — and the density moves on a frame where the tier
    // multiplier may already have settled. Keying the trim on the tier alone
    // left the 2× range on screen at 1× and vice versa.
    render(<CellPopulationField active gainRef={{ current: 1 }} />);
    frameAt(2);
    expect(drawn().segments).toBe(19);
    frameAt(1);
    expect(drawn().segments).toBe(RESIDUAL_SEGMENTS);
    frameAt(2);
    expect(drawn().segments).toBe(19);
    // …and a dpr that moves INSIDE one regime is not a change to re-cut for.
    frameAt(3);
    expect(drawn().segments).toBe(19);
  });

  it('never lets a hairline hang off a bead that is not drawn', () => {
    // The prefix rule is the whole safety argument, and it has to survive the
    // second prefix: the hairline prefix is a SUB-prefix of the point prefix,
    // so every segment kept still has both endpoints inside the beads.
    render(<CellPopulationField active gainRef={{ current: 1 }} />);
    for (const dpr of [1, 1.5, 2, 3]) {
      frameAt(dpr);
      const { points, segments } = drawn();
      // On this chain the last kept hairline reaches point `segments`.
      expect(segments).toBeLessThanOrEqual(points);
      expect(segments).toBeGreaterThan(0);
    }
  });

  it('states the law where the fill budget states its own, and keys the trim on it', () => {
    const field = readFileSync(
      resolve(process.cwd(), 'src/components/CellPopulationField.tsx'),
      'utf8',
    );
    // One law, one place: the component asks the helper beside ⟨D-3⟩'s fill
    // budget rather than carrying a second multiplier of its own.
    expect(field).toContain('populationHairlinePrefix(');
    // And the trim's key is the tier AND the density — a settled page still
    // does no work, because denseness is a boolean and it does not move.
    expect(field).toContain('Math.abs(capMul - capApplied.current) > 0.0005');
    expect(field).toContain('denseBuffer !== denseApplied.current');
  });
});
