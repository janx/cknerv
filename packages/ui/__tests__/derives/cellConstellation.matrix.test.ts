import { describe, expect, it } from 'vitest';
import {
  constellationLayout,
  constellationPlacement,
  type ConstellationPanel,
} from '../../src/derives/cellConstellation.derive';

const PANELS: ConstellationPanel[] = [
  { slot: 'analysis', width: 440, height: 717 },
  { slot: 'specimen', width: 280, height: 314 },
  { slot: 'reader', width: 408, height: 340 },
  { slot: 'trace', width: 560, height: 420 },
];

describe('cell constellation viewport matrix', () => {
  it('finds a routed seat for three and four panels across supported stage shapes', () => {
    const unavailable: string[] = [];
    const stages = [
      [1920, 1080], [1920, 920], [1440, 900], [1280, 800], [1180, 663], [820, 1078],
    ] as const;
    for (const [stageWidth, stageHeight] of stages) {
      for (const xPart of [0.22, 0.5, 0.78]) for (const yPart of [0.25, 0.5, 0.75]) {
        const anchorX = stageWidth * xPart; const anchorY = stageHeight * yPart;
        const chipWidth = 376;
        const chipLeft = Math.max(14, Math.min(stageWidth - 14 - chipWidth, anchorX - chipWidth / 2));
        const reserved = [{
          left: chipLeft, top: anchorY + 58,
          right: chipLeft + chipWidth, bottom: anchorY + 82,
        }];
        for (const count of [3, 4]) {
          const layout = constellationLayout({
            panels: PANELS.slice(0, count), anchorX, anchorY, stageWidth, stageHeight,
            reserved, safeTop: 104, edge: 14,
          });
          if (layout.placements.length !== count) {
            const geometric = constellationPlacement({
              panels: PANELS.slice(0, count), anchorX, anchorY, stageWidth, stageHeight,
              reserved, safeTop: 104, edge: 14,
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
    expect(unavailable).toEqual([]);
  });
});
