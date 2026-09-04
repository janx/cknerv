import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CAMERA_HALO_EXTENT,
  CAMERA_HOLE_MARGIN_PX,
  CAMERA_RIM_EXTENT,
  fitCameraToHole,
} from '../src/camera-hole-fit';

const UI_SRC = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../packages/ui/src',
);

/**
 * The stages the round put in scope, with the HUD rects measured at `25c7d5a`
 * (report A-12's table). `hole` is `[leftRailRight, rightPanelLeft]`.
 */
const STAGES = [
  { width: 1920, height: 1080, hole: { left: 384, right: 1574 } },
  { width: 1600, height: 900, hole: { left: 384, right: 1254 } },
  { width: 1440, height: 900, hole: { left: 384, right: 1094 } },
  { width: 1280, height: 800, hole: { left: 394, right: 934 } },
  { width: 1100, height: 760, hole: { left: 394, right: 754 } },
  { width: 900, height: 700, hole: { left: 394, right: 554 } },
] as const;

/**
 * An INDEPENDENT reading of how wide a form lands, derived rather than sampled:
 * the extreme of an ellipse along a horizontal screen direction is
 * `sqrt((a·ux)² + (b·uz)²)`, the direction at the default pose's 45° azimuth is
 * `(1,0,−1)/√2`, and a world half-extent `e` at distance `d` covers
 * `e·H / (2·d·tan(fov/2))` pixels — no viewport width in it, because the
 * horizontal field is the vertical one times the aspect and the width cancels.
 *
 * It is orthographic, so it UNDER-states the true span: perspective spreads the
 * near half of the ellipse further than it compresses the far half. That makes
 * it exactly the right instrument for a floor — a fit that satisfies this is
 * not necessarily tight, but a fit that violates it is certainly wrong.
 */
function orthographicHalfWidth(
  extent: { halfX: number; halfZ: number },
  distance: number,
  viewportHeight: number,
  fov: number,
): number {
  const support = Math.hypot(extent.halfX, extent.halfZ) / Math.SQRT2;
  return (support * viewportHeight) / (2 * distance * Math.tan((fov * Math.PI) / 360));
}

describe('fitCameraToHole', () => {
  it('restates the field ellipse and the halo edge as the scene declares them', () => {
    // The three numbers this module fits to live in @cknerv/ui and are not on
    // its public surface. Restating them is the bargain; this is the price.
    const helix = readFileSync(join(UI_SRC, 'helix.ts'), 'utf8');
    const placement = readFileSync(
      join(UI_SRC, 'geometry/populationFieldPlacement.ts'),
      'utf8',
    );

    expect(helix).toContain('export const FIELD_HALF_X = 60;');
    expect(helix).toContain('export const FIELD_HALF_Z = 54;');
    expect(placement).toContain('export const POPULATION_FIELD_OUTER_EDGE = 1.6;');
    expect(CAMERA_RIM_EXTENT).toEqual({ halfX: 60, halfZ: 54 });
    expect(CAMERA_HALO_EXTENT.halfX).toBeCloseTo(96, 6);
    expect(CAMERA_HALO_EXTENT.halfZ).toBeCloseTo(86.4, 6);
  });

  it.each(STAGES)(
    'fits the composition into the $width×$height hole',
    ({ width, height, hole }) => {
      const fit = fitCameraToHole({
        hole, viewportWidth: width, viewportHeight: height, fov: 50,
      });
      const holeWidth = hole.right - hole.left;
      const available = holeWidth - CAMERA_HOLE_MARGIN_PX * 2;

      // One form at every width — the halo, never the rim. There is no
      // fallback, because a fallback lowers a requirement and a requirement
      // lowered at a threshold is a step in the galaxy's size.
      if (!fit.saturated) {
        // At that distance the halo is inside the hole by the independent
        // reading above.
        expect(orthographicHalfWidth(CAMERA_HALO_EXTENT, fit.distance, height, 50) * 2)
          .toBeLessThanOrEqual(available + 0.5);
      } else {
        // The two laptop stages the controls' 400 ceiling decides instead of
        // the hole. The RIM is still whole at 1100 — it wants 319 of the 400 —
        // which is what the dropped fallback existed to protect.
        expect(fit.distance).toBe(400);
        expect(holeWidth).toBeLessThan(700);
      }
      // The pose keeps the default's own direction: only its length is fitted.
      expect(fit.position[0] - fit.targetX).toBeCloseTo(fit.position[2], 6);
      expect((fit.position[1] / (fit.position[2] || 1))).toBeCloseTo(70 / 110, 6);
    },
  );

  it('pins the table it solves, and it climbs', () => {
    // Regression pins, so a change to the projection announces itself. The
    // table is also the rule: read down the distances and they only ever go
    // up. The first cut fell back to the rim under a 1,100 px hole and this
    // column read 215 · 153 · 184 · 218 · 319 · 400 — a 1.4× jump in the
    // galaxy's size between 1920 and 1600, from a resize.
    const table = STAGES.map(({ width, height, hole }) => {
      const fit = fitCameraToHole({
        hole, viewportWidth: width, viewportHeight: height, fov: 50,
      });
      return `${width}:${fit.saturated ? 'far' : 'hole'}:${fit.distance.toFixed(1)}:${fit.targetX.toFixed(1)}`;
    });

    expect(table).toEqual([
      '1920:hole:215.4:-4.9',
      '1600:hole:244.1:-6.7',
      '1440:hole:294.3:-8.0',
      '1280:hole:349.1:-13.5',
      '1100:far:400.0:-16.2',
      '900:far:400.0:-17.6',
    ]);
  });

  it('never comes closer as the hole narrows, at any width', () => {
    // The one property the fit owes a reader who drags a window edge: the
    // subject does not change size in the other direction, ever, and it never
    // jumps. Swept in 10 px steps across the whole range the HUD can produce,
    // so a threshold hidden anywhere in it fails here. Below ~610 px of hole
    // the halo does not fit at any reachable distance and the fit saturates at
    // the controls' far limit — the corona goes under the panels because the
    // camera stopped, not because the fit changed its mind about the subject.
    let previous: number | null = null;
    let sawSaturation = false;
    for (let holeWidth = 1600; holeWidth >= 100; holeWidth -= 10) {
      const left = 979 - holeWidth / 2;
      const fit = fitCameraToHole({
        hole: { left, right: left + holeWidth },
        viewportWidth: 1920,
        viewportHeight: 1080,
        fov: 50,
      });
      if (previous !== null) {
        expect(fit.distance).toBeGreaterThanOrEqual(previous);
        // …and no step either: 10 px of hole moves the camera by at most 1.7 %
        // of where it stood, everywhere in the range.
        expect(fit.distance - previous).toBeLessThanOrEqual(previous * 0.05);
      }
      expect(fit.saturated).toBe(fit.distance >= 400);
      sawSaturation ||= fit.saturated;
      previous = fit.distance;
    }
    expect(sawSaturation).toBe(true);
    expect(previous).toBe(400);
  });

  it('keeps the rim whole where the halo no longer fits', () => {
    // What the dropped rim fallback existed to protect, protected by the
    // ceiling instead: at 1100×760 the fit saturates because the HALO wants
    // more than 400, but the silhouette itself wants only 319, so it stands
    // clear inside the hole at the pose the reader actually gets.
    const stage = { viewportWidth: 1100, viewportHeight: 760, fov: 50 } as const;
    const hole = { left: 394, right: 754 };
    const halo = fitCameraToHole({ hole, ...stage });
    const rim = fitCameraToHole({ hole, ...stage, extent: CAMERA_RIM_EXTENT });

    expect(halo.saturated).toBe(true);
    expect(rim.saturated).toBe(false);
    expect(rim.distance).toBeLessThan(halo.distance);
    expect(orthographicHalfWidth(CAMERA_RIM_EXTENT, halo.distance, 760, 50) * 2)
      .toBeLessThanOrEqual(hole.right - hole.left - CAMERA_HOLE_MARGIN_PX * 2);
  });

  it('aims the galaxy\'s axis at the hole, not at the viewport', () => {
    // The point aimed is `(0, ·, 0)` — the helix's own centre, and the local
    // node's chain anchor, which projected to the exact horizontal centre of
    // the VIEWPORT at every azimuth because it sat on the orbit axis. A hole
    // 19 px right of that centre now moves it 19 px; the frame is aimed at the
    // hole. Moving the target right carries the whole rig right, so the axis
    // goes left: the two move against each other, monotonically.
    const at = (left: number, right: number) => fitCameraToHole({
      hole: { left, right }, viewportWidth: 1920, viewportHeight: 1080, fov: 50,
    });
    const leftOfCentre = at(346, 1536).targetX;
    const hudHole = at(384, 1574).targetX;
    const rightOfCentre = at(500, 1690).targetX;

    expect(leftOfCentre).toBeGreaterThan(hudHole);
    expect(hudHole).toBeGreaterThan(rightOfCentre);
    // A symmetric hole leaves the aim where the constant pose had it.
    expect(at(365, 1555).targetX).toBeCloseTo(0, 1);
  });

  it.each(STAGES)(
    'puts the galaxy\'s axis on the $width×$height hole\'s centre',
    ({ width, height, hole }) => {
      // Derived independently, in closed form. The axis is `(0,·,0)`; with the
      // camera at `T + d·u` and `u.x === u.z`, its lateral offset in view space
      // is `−targetX/√2` and its depth is `targetX·u.x + d`, so its pixel
      // offset from the screen centre is that ratio times `H / 2tan(fov/2)`.
      const fit = fitCameraToHole({
        hole, viewportWidth: width, viewportHeight: height, fov: 50,
      });
      const rayLength = Math.hypot(110, 70, 110);
      const ux = 110 / rayLength;
      const scale = height / (2 * Math.tan((50 * Math.PI) / 360));
      const lateral = -fit.targetX / Math.SQRT2;
      const depth = fit.targetX * ux + fit.distance;
      const axisPx = width / 2 + (lateral / depth) * scale;

      expect(axisPx).toBeCloseTo((hole.left + hole.right) / 2, 0);
    },
  );

  it('scales the distance with the viewport height, not its width', () => {
    // The projected size of a world extent carries the viewport's HEIGHT and
    // not its width — the horizontal field is the vertical one times the
    // aspect, and the width cancels. So the same hole on a shorter stage is a
    // closer camera, and the same hole on a wider stage is the same camera.
    const short = fitCameraToHole({
      hole: { left: 384, right: 1574 },
      viewportWidth: 1920, viewportHeight: 540, fov: 50,
    });
    const tall = fitCameraToHole({
      hole: { left: 384, right: 1574 },
      viewportWidth: 1920, viewportHeight: 1080, fov: 50,
    });
    const wide = fitCameraToHole({
      hole: { left: 1000, right: 2190 },
      viewportWidth: 3152, viewportHeight: 1080, fov: 50,
    });

    expect(short.distance).toBeLessThan(tall.distance);
    expect(short.distance).toBeGreaterThan(tall.distance / 2.2);
    // Same 1,190 px hole, same height, a stage 1,232 px wider: the same pose.
    expect(wide.distance).toBeCloseTo(tall.distance, 0);
  });
});
