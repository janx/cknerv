// The lock carries the line it last proved, not the line the last full solve
// drew.
//
// A composition is chosen once and then held for a whole reading — the reader
// stays inside `CONSTELLATION_HOLD_RADIUS_PX` of the anchor it was chosen at
// for 160 px of drift — while the LEADERS are re-proven on every locked
// landing. Asking the router to slide a freshly proven line by the whole
// accumulated delta is asking the wrong question, and measured 2026-09-12 at
// 0.6 px a frame beside the HUD rails it was the wrong answer about half the
// time: of ~1,000 dashed plate-frames per 600-frame drift, 486 were plates
// holding a line the router failed to carry again on every single frame.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  advanceConstellationFrame,
} from '../../../src/components/hud/cellConstellationFrame';
import {
  resetConstellationWorkStats,
  snapshotConstellationWorkStats,
} from '../../../src/derives/cellConstellation.derive';
import { resetFrameBudget } from '../../../src/nerve/frameBudget';
import {
  constellationStage,
  dashedLeaders,
  driftConstellation,
  generousClock,
  seatedPlates,
} from '../../helpers/constellationStage';
import {
  CONSTELLATION_EDGE,
  CONSTELLATION_SAFE_TOP,
  railsForStage,
} from '../../fixtures/cellConstellationMatrix';

beforeEach(() => {
  resetFrameBudget();
  resetConstellationWorkStats();
});

describe('the route anchor in the lock', () => {
  it('advances with the routes a locked landing proved, while the seats keep theirs', () => {
    const stage = constellationStage(3);
    const now = generousClock();
    const rails = railsForStage(1920);
    const frame = (anchorX: number, serial: number) => advanceConstellationFrame(
      stage.handles, anchorX, 270, 1920, 1080,
      CONSTELLATION_SAFE_TOP, CONSTELLATION_EDGE, rails, 0, serial, now,
    );
    // Frames enough for the first composition to land and for the lock to hold
    // it. From there the two anchors are different numbers.
    for (let serial = 1; serial <= 40; serial += 1) frame(600 + serial * 0.6, serial);
    const solvedAt = stage.handles.lock.anchorX;
    expect(Number.isFinite(solvedAt)).toBe(true);
    expect(Object.keys(stage.handles.lock.routes).length).toBeGreaterThan(0);

    for (let serial = 41; serial <= 120; serial += 1) frame(600 + serial * 0.6, serial);
    expect(stage.handles.lock.anchorX).toBe(solvedAt);
    expect(stage.handles.lock.routeAnchorX).toBeGreaterThan(solvedAt + 30);
    expect(Math.abs(stage.handles.lock.routeAnchorX - (600 + 120 * 0.6)))
      .toBeLessThanOrEqual(1);
    expect(stage.handles.lock.routeAnchorY).toBe(270);
  });

  it('starts a route anchor where the composition was solved', () => {
    const stage = constellationStage(3);
    const now = generousClock();
    for (let serial = 1; serial <= 30; serial += 1) {
      advanceConstellationFrame(
        stage.handles, 960, 540, 1920, 1080,
        CONSTELLATION_SAFE_TOP, CONSTELLATION_EDGE, [], 0, serial, now,
      );
    }
    expect(stage.handles.lock.routeAnchorX).toBe(stage.handles.lock.anchorX);
    expect(stage.handles.lock.routeAnchorY).toBe(stage.handles.lock.anchorY);
  });

  it('never carries a line it has stopped being able to prove', () => {
    // The lock holds proven lines. A plate the locked landing could not reach
    // is being SHOWN the fallback, so the line it used to have is not a line
    // any more — and re-offering it on the next frame only buys the router the
    // same failure again. Measured over four rail-adjacent drifts: 486, 251,
    // 55 and 48 dashed plate-frames per 600 frames were exactly that.
    for (const [width, height, part, direction, count] of [
      [1920, 1080, 0.22, 1, 3], [1920, 1080, 0.78, -1, 3],
      [1920, 1080, 0.22, 1, 4], [1920, 1080, 0.78, -1, 4],
    ] as const) {
      resetFrameBudget();
      resetConstellationWorkStats();
      const stage = constellationStage(count);
      let dashedHoldingALine = 0;
      let dashedPlateFrames = 0;
      driftConstellation(stage, {
        stageWidth: width, stageHeight: height,
        anchorX: width * part, anchorY: height * 0.25,
        rate: 0.6 * direction, frames: 600,
        onFrame: () => {
          for (const slot of stage.slots) {
            if (stage.groups[slot].dataset.cellLeaderDegraded !== 'true') continue;
            dashedPlateFrames += 1;
            if (stage.handles.lock.routes[slot]) dashedHoldingALine += 1;
          }
        },
      });
      expect(dashedPlateFrames,
        `${width}x${height}@${part} n${count}: nothing was dashed, so nothing was measured`)
        .toBeGreaterThan(100);
      // One frame's grace: the landing that degrades a plate and the frame
      // that reads the lock are the same frame in only one order.
      expect(dashedHoldingALine,
        `${width}x${height}@${part} n${count}: ${dashedHoldingALine} of ${dashedPlateFrames}`)
        .toBeLessThanOrEqual(1);
    }
  }, 240000);

  it('keeps the leader a refinement took back for the rest of the reading', () => {
    // 1920×920, the Cell a quarter down and 78 % across — under the right-hand
    // rails — drifting inward at 0.6 px a frame with three instruments up.
    // This is one of the twelve leaders P2's route caps cost and one of the
    // nine the background refinement can recover (the oracle names all of
    // them). Before this task the recovery was lost again within a few frames
    // and re-bought 243 times over the same 600; now it is bought once.
    const stage = constellationStage(3);
    let plateFrames = 0;
    driftConstellation(stage, {
      stageWidth: 1920, stageHeight: 920,
      anchorX: 1920 * 0.78, anchorY: 920 * 0.25,
      rate: -0.6, frames: 600,
      onFrame: () => { plateFrames += seatedPlates(stage); },
    });
    const stats = snapshotConstellationWorkStats();
    expect(stats.refineUpgrades).toBeGreaterThan(0);
    expect(dashedLeaders(stage)).toBe(0);
    expect(plateFrames).toBeGreaterThan(1500);
    // 501 of 1,770 plate-frames dashed before this task, 260 after.
    expect(stats.degradedRoutes / plateFrames).toBeLessThanOrEqual(0.18);
  }, 120000);

  it('gives a plate that just went dashed a second look', () => {
    // `refinedKey` says "this picture has already had its second look". A
    // landing that put the same seats back keeps it — a drifting Cell lands one
    // of those every frame, and clearing it there would restart the same
    // refinement forever — but the same seats with a leader that has gone
    // dashed are a different picture, and the refinement is the only thing
    // that can take that leader back.
    const stage = constellationStage(3);
    let transitions = 0;
    let keptTheKey = 0;
    let solidLast: Record<string, boolean> = {};
    let fullSolvesLast = 0;
    driftConstellation(stage, {
      stageWidth: 1920, stageHeight: 1080,
      anchorX: 1920 * 0.78, anchorY: 1080 * 0.25,
      rate: -0.6, frames: 600,
      onFrame: () => {
        const fullSolves = snapshotConstellationWorkStats().fullSolves;
        const recomposed = fullSolves !== fullSolvesLast;
        fullSolvesLast = fullSolves;
        const solidNow: Record<string, boolean> = {};
        for (const slot of stage.slots) {
          const dashed = stage.groups[slot].dataset.cellLeaderDegraded === 'true';
          solidNow[slot] = !dashed;
          // A new composition is a new picture and clears the key by itself;
          // this case is about the ones that hold their seats.
          if (dashed && solidLast[slot] === true && !recomposed) {
            transitions += 1;
            if (stage.handles.refinedKey !== '') keptTheKey += 1;
          }
        }
        solidLast = solidNow;
      },
    });
    expect(transitions, 'no leader went from solid to dashed, so nothing was measured')
      .toBeGreaterThan(0);
    expect(keptTheKey).toBe(0);
  }, 120000);
});
