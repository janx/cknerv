import { describe, expect, it } from 'vitest';
import {
  ROUTE_CANDIDATE_CAP,
  ROUTE_GRID_PAIR_CAP,
  ROUTE_GRID_POINT_CAP,
  ROUTE_ORDER_CAP,
  constellationLayout,
  constellationPlacement,
  resetConstellationWorkStats,
  snapshotConstellationWorkStats,
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

  it('solves every geometry in the sweep inside a pointer interaction', () => {
    // Measured 2026-09-11 over this exact sweep, before P2: p50 11 ms,
    // p90 151 ms, p99 1,081 ms, max 3,874 ms, and the eight slowest cases were
    // all four-panel ones between 0.55 s and 3.9 s. A selection that takes four
    // seconds to answer is a selection that has already been abandoned. The
    // bound that holds this is the router's: two route orders, thirteen grid
    // pairs per plate, and a corridor around each one.
    //
    // Three bounds, because a millisecond on a shared machine is not one
    // thing. The caps are read back off the work they bounded, which is exact.
    // The routed sweep is measured against the same sweep without routing,
    // which normalises the machine away. And a two-second absolute bound
    // catches the failure the review actually found — a single solve of one to
    // four SECONDS — without pretending to resolve anything finer.
    //
    // The honest cost measurement is min-of-5 per case, taken on 2026-09-12 on
    // a machine at load average 24: three panels p99 7.3 / max 7.5 ms, four
    // panels p99 34.6 / max 40.0 ms, nothing over 40. The plan's exit criterion
    // is 40 ms; this suite cannot assert it and say something true.
    const budgetMs = 2000;
    const slow: string[] = [];
    const overCap: string[] = [];
    let solved = 0;
    let widestSearch = 0;
    let routedMs = 0;
    let geometryMs = 0;
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
              // Best of two, and measured beside the SAME sweep with routing
              // switched off. Geometry enumeration is identical in both passes
              // and is not what P2 bounded, so the ratio between them is the
              // router's own cost and it survives whatever else the machine is
              // doing — which matters, because this exact sweep's slowest case
              // measured 59 ms alone and 414 ms inside a full parallel
              // `pnpm test` on the same machine at the same hour.
              const input = {
                panels: PANELS.slice(0, count), anchorX, anchorY, stageWidth, stageHeight,
                reserved, obstacles,
                safeTop: CONSTELLATION_SAFE_TOP, edge: CONSTELLATION_EDGE,
              };
              let elapsed = Number.POSITIVE_INFINITY;
              let bare = Number.POSITIVE_INFINITY;
              for (let attempt = 0; attempt < 2; attempt += 1) {
                resetConstellationWorkStats();
                const started = performance.now();
                constellationLayout(input);
                elapsed = Math.min(elapsed, performance.now() - started);
                const bareStarted = performance.now();
                constellationPlacement(input);
                bare = Math.min(bare, performance.now() - bareStarted);
              }
              routedMs += elapsed;
              geometryMs += bare;
              const stats = snapshotConstellationWorkStats();
              const where = `${stageWidth}x${stageHeight} @${xPart},${yPart} n${count}`
                + (withRails ? ' rails' : '');
              // The caps, read back off the work they bounded. No start-end
              // pair walks more than ROUTE_GRID_POINT_CAP points, no plate
              // offers more than ROUTE_GRID_PAIR_CAP pairs to the search, and
              // no candidate is routed in more than ROUTE_ORDER_CAP orders.
              if (stats.routeGridPoints > ROUTE_GRID_POINT_CAP * stats.searchedRouteAttempts) {
                overCap.push(`${where}: ${stats.routeGridPoints} points over`
                  + ` ${stats.searchedRouteAttempts} pairs`);
              }
              const pairCeiling = ROUTE_GRID_PAIR_CAP * count * ROUTE_ORDER_CAP
                * ROUTE_CANDIDATE_CAP * 2;
              if (stats.searchedRouteAttempts > pairCeiling) {
                overCap.push(`${where}: ${stats.searchedRouteAttempts} searched pairs`
                  + ` over ${pairCeiling}`);
              }
              if (stats.routeOrders > ROUTE_ORDER_CAP * ROUTE_CANDIDATE_CAP * 2) {
                overCap.push(`${where}: ${stats.routeOrders} route orders`);
              }
              widestSearch = Math.max(widestSearch, stats.routeGridPoints);
              if (elapsed > budgetMs) {
                slow.push(`${stageWidth}x${stageHeight} @${xPart},${yPart} n${count}`
                  + `${withRails ? ' rails' : ''}: ${elapsed.toFixed(1)}ms`);
              }
            }
          }
        }
      }
    }
    expect(solved).toBe(243);
    expect(overCap).toEqual([]);
    expect(widestSearch).toBeGreaterThan(0);
    expect(slow).toEqual([]);
    // What routing costs on top of the enumeration it cannot change: 1.34 over
    // the whole sweep, measured 2026-09-12. The bound is three times that, so
    // a contended run cannot fail it while a router that starts searching
    // again will.
    const ratio = routedMs / geometryMs;
    expect(ratio, `routed/geometry = ${ratio.toFixed(2)}`).toBeLessThan(4);
  });
});
