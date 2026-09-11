// The one description of the stages, anchors, instruments and rails the
// constellation suites measure against.
//
// Three suites used to carry their own copy of these numbers and they had
// already drifted apart: the matrix suite's panels had no label measures, so
// its routes were solved for labels the writer never draws. This module is the
// single statement, and the oracle fixture in `cellConstellationOracle.json` is
// generated from exactly these inputs.
import type { HudOcclusionRect } from '../../src/components/hudOcclusion';
import type { ConstellationPanel } from '../../src/derives/cellConstellation.derive';

export const CONSTELLATION_SAFE_TOP = 104;
export const CONSTELLATION_EDGE = 14;
export const CONSTELLATION_CHIP_WIDTH = 376;
export const CONSTELLATION_CHIP_HEIGHT = 24;

/** The four instruments at the measures the live capture reported, with the
 * label each leader carries — `SCAN·01`/`SCAN·02`/`SCAN·03` at 62 px and
 * `CELL SCAN` at 78. */
export const CONSTELLATION_PANELS: readonly ConstellationPanel[] = [
  { slot: 'analysis', width: 440, height: 717, labelWidth: 62, labelHeight: 20 },
  { slot: 'specimen', width: 280, height: 314, labelWidth: 78, labelHeight: 20 },
  { slot: 'reader', width: 408, height: 340, labelWidth: 62, labelHeight: 20 },
  { slot: 'trace', width: 560, height: 420, labelWidth: 62, labelHeight: 20 },
];

/** The rails at 1920, from the live capture (`f-1920-bare.json`). */
export const RAILS_1920: readonly HudOcclusionRect[] = [
  { left: 14, top: 48, right: 384, bottom: 510.8 },
  { left: 14, top: 723.5, right: 384, bottom: 934.5 },
  { left: 14, top: 946.5, right: 384, bottom: 1066 },
  { left: 1574, top: 48, right: 1906, bottom: 310.8 },
  { left: 1574, top: 322.8, right: 1906, bottom: 522.8 },
];

/** The rails at 1180, the 11" iPad in landscape Safari. */
export const RAILS_1180: readonly HudOcclusionRect[] = [
  { left: 14, top: 48, right: 312, bottom: 282 },
  { left: 14, top: 306, right: 312, bottom: 517 },
  { left: 926, top: 153, right: 1166, bottom: 266 },
];

export const CONSTELLATION_STAGES: ReadonlyArray<readonly [number, number]> = [
  [1920, 1080], [1920, 920], [1440, 900], [1280, 800], [1180, 663], [820, 1078],
];
export const CONSTELLATION_ANCHOR_X_PARTS: readonly number[] = [0.22, 0.5, 0.78];
export const CONSTELLATION_ANCHOR_Y_PARTS: readonly number[] = [0.25, 0.5, 0.75];

/** Only these stages have a measured rail set; the others are solved bare. */
export const CONSTELLATION_RAILED_STAGES: ReadonlyArray<readonly [number, number]> = [
  [1920, 1080], [1920, 920], [1180, 663],
];

export function railsForStage(stageWidth: number): readonly HudOcclusionRect[] {
  if (stageWidth === 1920) return RAILS_1920;
  if (stageWidth === 1180) return RAILS_1180;
  return [];
}

/** The name chip's claim, clamped exactly as the writer clamps it: centred
 * under the reticle and pushed inside the stage edges. */
export function constellationChipReserved(
  anchorX: number,
  anchorY: number,
  stageWidth: number,
): HudOcclusionRect[] {
  const left = Math.max(
    CONSTELLATION_EDGE,
    Math.min(
      stageWidth - CONSTELLATION_EDGE - CONSTELLATION_CHIP_WIDTH,
      anchorX - CONSTELLATION_CHIP_WIDTH / 2,
    ),
  );
  return [{
    left,
    top: anchorY + 58,
    right: left + CONSTELLATION_CHIP_WIDTH,
    bottom: anchorY + 58 + CONSTELLATION_CHIP_HEIGHT,
  }];
}

export interface ConstellationMatrixCase {
  key: string;
  stageWidth: number;
  stageHeight: number;
  xPart: number;
  yPart: number;
  anchorX: number;
  anchorY: number;
  count: number;
  withRails: boolean;
  panels: readonly ConstellationPanel[];
  obstacles: readonly HudOcclusionRect[];
  reserved: readonly HudOcclusionRect[];
}

/** Six stages × nine anchors × three and four panels, bare, plus the same
 * anchors on the three stages whose rails were measured. 162 cases. */
export function constellationMatrixCases(): ConstellationMatrixCase[] {
  const cases: ConstellationMatrixCase[] = [];
  const railed = new Set(CONSTELLATION_RAILED_STAGES.map(([w, h]) => `${w}x${h}`));
  for (const withRails of [false, true]) {
    for (const [stageWidth, stageHeight] of CONSTELLATION_STAGES) {
      if (withRails && !railed.has(`${stageWidth}x${stageHeight}`)) continue;
      for (const xPart of CONSTELLATION_ANCHOR_X_PARTS) {
        for (const yPart of CONSTELLATION_ANCHOR_Y_PARTS) {
          const anchorX = stageWidth * xPart;
          const anchorY = stageHeight * yPart;
          for (const count of [3, 4]) {
            cases.push({
              key: `${stageWidth}x${stageHeight}@${xPart},${yPart} n${count}`
                + (withRails ? ' rails' : ''),
              stageWidth,
              stageHeight,
              xPart,
              yPart,
              anchorX,
              anchorY,
              count,
              withRails,
              panels: CONSTELLATION_PANELS.slice(0, count),
              obstacles: withRails ? railsForStage(stageWidth) : [],
              reserved: constellationChipReserved(anchorX, anchorY, stageWidth),
            });
          }
        }
      }
    }
  }
  return cases;
}

export function constellationMatrixInput(matrixCase: ConstellationMatrixCase) {
  return {
    panels: matrixCase.panels,
    anchorX: matrixCase.anchorX,
    anchorY: matrixCase.anchorY,
    stageWidth: matrixCase.stageWidth,
    stageHeight: matrixCase.stageHeight,
    obstacles: matrixCase.obstacles,
    reserved: matrixCase.reserved,
    safeTop: CONSTELLATION_SAFE_TOP,
    edge: CONSTELLATION_EDGE,
  };
}
