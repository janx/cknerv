import { describe, expect, it } from 'vitest';
import {
  constellationLayout,
  constellationPlacement,
  type ConstellationPanel,
} from '../../src/derives/cellConstellation.derive';
import {
  CONSTELLATION_ANCHOR_X_PARTS,
  CONSTELLATION_ANCHOR_Y_PARTS,
  CONSTELLATION_EDGE,
  CONSTELLATION_PANELS,
  CONSTELLATION_SAFE_TOP,
  CONSTELLATION_STAGES,
  constellationChipReserved,
  railsForStage,
} from '../fixtures/cellConstellationMatrix';

const PANELS = CONSTELLATION_PANELS as readonly ConstellationPanel[];

describe('cell constellation viewport matrix', () => {
  it('finds a routed seat for three and four panels across supported stage shapes', () => {
    const unavailable: string[] = [];
    for (const [stageWidth, stageHeight] of CONSTELLATION_STAGES) {
      for (const xPart of CONSTELLATION_ANCHOR_X_PARTS) {
        for (const yPart of CONSTELLATION_ANCHOR_Y_PARTS) {
          const anchorX = stageWidth * xPart; const anchorY = stageHeight * yPart;
          const reserved = constellationChipReserved(anchorX, anchorY, stageWidth);
          for (const count of [3, 4]) {
            const layout = constellationLayout({
              panels: PANELS.slice(0, count), anchorX, anchorY, stageWidth, stageHeight,
              reserved, safeTop: CONSTELLATION_SAFE_TOP, edge: CONSTELLATION_EDGE,
            });
            if (layout.placements.length !== count) {
              const geometric = constellationPlacement({
                panels: PANELS.slice(0, count), anchorX, anchorY, stageWidth, stageHeight,
                reserved, safeTop: CONSTELLATION_SAFE_TOP, edge: CONSTELLATION_EDGE,
              });
              unavailable.push(`${stageWidth}x${stageHeight} @${xPart},${yPart}, ${count}`
                + ` (${geometric.length === count ? 'route' : 'geometry'})`);
            }
            const reticle = {
              left: anchorX - 46, top: anchorY - 46, right: anchorX + 46, bottom: anchorY + 46,
            };
            for (const panel of layout.placements) {
              const label = panel.route?.label;
              if (!label || label.inPanel) continue;
              const labelBox = {
                left: label.x - label.width / 2, top: label.y - label.height / 2,
                right: label.x + label.width / 2, bottom: label.y + label.height / 2,
              };
              const overlap = Math.max(0, Math.min(labelBox.right, reticle.right)
                - Math.max(labelBox.left, reticle.left))
                * Math.max(0, Math.min(labelBox.bottom, reticle.bottom)
                  - Math.max(labelBox.top, reticle.top));
              expect(overlap, `${stageWidth}x${stageHeight} @${xPart},${yPart}, ${count}`)
                .toBe(0);
            }
          }
        }
      }
    }
    expect(unavailable).toEqual([]);
  });

  // RED until P2 — the bounded router and its caps.
  it.fails('solves every geometry in the sweep inside a pointer interaction', () => {
    // Measured 2026-09-11 over this exact sweep: p50 11 ms, p90 151 ms,
    // p99 1,081 ms, max 3,874 ms, and the eight slowest cases were all
    // four-panel ones between 0.55 s and 3.9 s. A selection that takes four
    // seconds to answer is a selection that has already been abandoned.
    const slow: string[] = [];
    let solved = 0;
    for (const [stageWidth, stageHeight] of CONSTELLATION_STAGES) {
      for (const xPart of CONSTELLATION_ANCHOR_X_PARTS) {
        for (const yPart of CONSTELLATION_ANCHOR_Y_PARTS) {
          const anchorX = stageWidth * xPart; const anchorY = stageHeight * yPart;
          const reserved = constellationChipReserved(anchorX, anchorY, stageWidth);
          for (const count of [2, 3, 4]) {
            for (const withRails of [false, true]) {
              const obstacles = withRails ? railsForStage(stageWidth) : [];
              if (withRails && obstacles.length === 0) continue;
              solved += 1;
              const started = performance.now();
              constellationLayout({
                panels: PANELS.slice(0, count), anchorX, anchorY, stageWidth, stageHeight,
                reserved, obstacles,
                safeTop: CONSTELLATION_SAFE_TOP, edge: CONSTELLATION_EDGE,
              });
              const elapsed = performance.now() - started;
              if (elapsed > 40) {
                slow.push(`${stageWidth}x${stageHeight} @${xPart},${yPart} n${count}`
                  + `${withRails ? ' rails' : ''}: ${elapsed.toFixed(1)}ms`);
              }
            }
          }
        }
      }
    }
    expect(solved).toBe(243);
    expect(slow).toEqual([]);
  });
});
