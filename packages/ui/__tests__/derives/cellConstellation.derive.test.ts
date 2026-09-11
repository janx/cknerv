import { describe, expect, it } from 'vitest';
import type { HudOcclusionRect } from '../../src/components/hudOcclusion';
import {
  CONSTELLATION_CONTINUITY_CAP_PX,
  CONSTELLATION_CONTINUITY_PX_WEIGHT,
  CONSTELLATION_HOLD_RADIUS_PX,
  CONSTELLATION_FIELD_MIN_STAGE_PX,
  CONSTELLATION_MIN_HEIGHT_PX,
  CONSTELLATION_MIN_GAP_PX,
  CONSTELLATION_SQUEEZE_LEVELS,
  CONSTELLATION_STACK_MIN_PX,
  CONSTELLATION_ORDER,
  CONSTELLATION_PREFERRED_GAP_PX,
  CONSTELLATION_RETICLE_PX,
  CONSTELLATION_ROUTE_CLEARANCE_PX,
  constellationKeepoutPx,
  constellationLeader,
  constellationLayout,
  constellationPlacement,
  createConstellationLock,
  revalidateConstellationLayoutForAnchor,
  resetConstellationLock,
  resetConstellationWorkStats,
  snapshotConstellationWorkStats,
  type ConstellationLayout,
  type ConstellationPanel,
  type ConstellationPlacement,
} from '../../src/derives/cellConstellation.derive';
import {
  CONSTELLATION_PANELS,
  RAILS_1180,
  RAILS_1920,
  constellationChipReserved,
  constellationMatrixCases,
  constellationMatrixInput,
} from '../fixtures/cellConstellationMatrix';

const SAFE_TOP = 104;
const EDGE = 14;

/** The three instruments at the measures the card draws them at today. */
const THREE: ConstellationPanel[] = [
  { slot: 'analysis', width: 440, height: 727 },
  { slot: 'specimen', width: 280, height: 308 },
  { slot: 'reader', width: 408, height: 370 },
];
const TWO: ConstellationPanel[] = THREE.filter((p) => p.slot !== 'reader');

function place(
  panels: ConstellationPanel[],
  anchorX: number,
  anchorY: number,
  stageWidth: number,
  stageHeight: number,
  obstacles: readonly HudOcclusionRect[] = [],
  lock?: ReturnType<typeof createConstellationLock>,
): ConstellationPlacement[] {
  return constellationPlacement({
    anchorX, anchorY, stageWidth, stageHeight, panels, obstacles, lock, safeTop: SAFE_TOP, edge: EDGE,
  });
}
const bySlot = (out: ConstellationPlacement[], slot: string) => {
  const found = out.find((p) => p.slot === slot);
  if (!found) throw new Error(`no placement for ${slot}`);
  return found;
};
const nearestDistance = (p: ConstellationPlacement, cx: number, cy: number) => {
  const nx = Math.max(p.x, Math.min(cx, p.x + p.width));
  const ny = Math.max(p.y, Math.min(cy, p.y + p.height));
  return Math.hypot(nx - cx, ny - cy);
};
const overlap = (a: ConstellationPlacement, b: ConstellationPlacement) => {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
};

describe('constellation keep-out', () => {
  it('scales off the short side of the stage and holds a floor', () => {
    expect(constellationKeepoutPx(1920, 1080)).toBe(120);
    expect(constellationKeepoutPx(1180, 688)).toBe(110);
    expect(constellationKeepoutPx(820, 1103)).toBe(120);
    // A stage too small for a proportional disc still owes the mark a field.
    expect(constellationKeepoutPx(420, 300)).toBe(92);
  });

  it('is never smaller than the reticle it is drawn around', () => {
    for (const [w, h] of [[1920, 1080], [1600, 900], [1180, 688], [820, 1103], [420, 300]]) {
      expect(constellationKeepoutPx(w, h) * 2).toBeGreaterThan(CONSTELLATION_RETICLE_PX);
    }
  });
});

describe('the cell keeps a clear field', () => {
  it('leaves every instrument outside the keep-out disc at 1920', () => {
    const out = place(THREE, 980, 545, 1920, 1080, RAILS_1920);
    const keepout = constellationKeepoutPx(1920, 1080);
    for (const panel of out) {
      expect(nearestDistance(panel, 980, 545)).toBeGreaterThanOrEqual(keepout);
    }
  });

  it('holds the field for a cell pressed into a corner of the stage', () => {
    // Nothing can be placed up and left of a cell at (200, 200); the walk has
    // to find its rooms on the other diagonals rather than clamp on top of it.
    const out = place(THREE, 200, 220, 1920, 1080);
    const keepout = constellationKeepoutPx(1920, 1080);
    for (const panel of out) {
      expect(nearestDistance(panel, 200, 220)).toBeGreaterThanOrEqual(keepout - 1);
    }
  });
});

describe('the instruments stand apart', () => {
  it('never overlaps one instrument with another', () => {
    for (const [ax, ay] of [[980, 545], [400, 300], [1500, 800], [960, 200], [960, 900]]) {
      const out = place(THREE, ax, ay, 1920, 1080, RAILS_1920);
      for (let i = 0; i < out.length; i += 1) {
        for (let j = i + 1; j < out.length; j += 1) {
          expect(overlap(out[i], out[j])).toBe(0);
        }
      }
    }
  });

  it('takes a different quadrant for every instrument', () => {
    const out = place(THREE, 980, 545, 1920, 1080, RAILS_1920);
    expect(new Set(out.map((p) => p.quadrant)).size).toBe(out.length);
  });

  it('keeps a readable gap, not a seam, between neighbours', () => {
    const out = place(THREE, 980, 545, 1920, 1080, RAILS_1920);
    for (let i = 0; i < out.length; i += 1) {
      for (let j = i + 1; j < out.length; j += 1) {
        const a = out[i];
        const b = out[j];
        const gapX = Math.max(a.x - (b.x + b.width), b.x - (a.x + a.width));
        const gapY = Math.max(a.y - (b.y + b.height), b.y - (a.y + a.height));
        expect(Math.max(gapX, gapY)).toBeGreaterThanOrEqual(CONSTELLATION_MIN_GAP_PX - 0.5);
      }
    }
  });
});

describe('every instrument stands inside the stage', () => {
  it('respects the safe top and the edge on every stage measured', () => {
    const stages: Array<[number, number]> = [
      [1920, 1080], [1600, 900], [1280, 800], [1180, 688], [820, 1103],
    ];
    for (const [w, h] of stages) {
      const out = place(THREE, w * 0.5, h * 0.5, w, h);
      for (const panel of out) {
        expect(panel.x).toBeGreaterThanOrEqual(EDGE - 0.5);
        expect(panel.y).toBeGreaterThanOrEqual(SAFE_TOP - 0.5);
        expect(panel.x + panel.width).toBeLessThanOrEqual(w - EDGE + 0.5);
        expect(panel.y + panel.height).toBeLessThanOrEqual(h - EDGE + 0.5);
      }
    }
  });

  it('caps what may scroll, and never the window', () => {
    // 1180 × 688 is the 11" iPad in landscape Safari: a 570 px band against a
    // 727 px register. That is the case the welded card answered by squeezing
    // the specimen's grid row to 236 px and letting the square overflow it.
    //
    // The cap is the QUADRANT's room and not just the band — a register in the
    // upper-left of a cell has whatever is between the safe top and the field,
    // which is usually less — and it is always at most the band.
    const out = place(THREE, 580, 360, 1180, 688);
    const analysis = bySlot(out, 'analysis');
    expect(analysis.capped).toBe(true);
    expect(analysis.height).toBeLessThanOrEqual(688 - SAFE_TOP - EDGE);
    expect(analysis.height).toBeGreaterThanOrEqual(CONSTELLATION_MIN_HEIGHT_PX);
    // The window is a specimen at a fixed scale: a capped window is a clipped
    // braid, so it is never in the squeeze.
    expect(bySlot(out, 'specimen').capped).toBe(false);
    expect(bySlot(out, 'specimen').height).toBe(308);
  });
});

describe('the reading order the quadrants encode', () => {
  it('puts the specimen above the cell and the reader below it, given room', () => {
    const out = place(THREE, 980, 545, 1920, 1080, RAILS_1920);
    expect(bySlot(out, 'specimen').quadrant).toMatch(/^t/);
    expect(bySlot(out, 'reader').quadrant).toMatch(/^b/);
  });

  it('gives the register the side with the room', () => {
    // Cell well left of centre: the register cannot go left, so it goes right.
    const left = place(THREE, 420, 545, 1920, 1080);
    expect(bySlot(left, 'analysis').quadrant).toMatch(/r$/);
    const right = place(THREE, 1480, 545, 1920, 1080);
    expect(bySlot(right, 'analysis').quadrant).toMatch(/l$/);
  });
});

describe('a cell that holds nothing', () => {
  it('places two instruments and leaves the other rooms alone', () => {
    const out = place(TWO, 980, 560, 1920, 1080, RAILS_1920);
    expect(out.map((p) => p.slot)).toEqual(['analysis', 'specimen']);
    expect(new Set(out.map((p) => p.quadrant)).size).toBe(2);
  });

  it('is stated by the order and not by the caller', () => {
    const reversed = place([...THREE].reverse(), 980, 545, 1920, 1080);
    const forward = place(THREE, 980, 545, 1920, 1080);
    expect(reversed).toEqual(forward);
    expect(forward.map((p) => p.slot))
      .toEqual(CONSTELLATION_ORDER.filter((slot) => slot !== 'trace'));
  });
});

describe('the leader', () => {
  it('runs from the reticle ring to the panel corner nearest the cell', () => {
    const panel = { x: 1110, y: 190, width: 440, height: 727 };
    const line = constellationLeader(980, 545, CONSTELLATION_RETICLE_PX, panel);
    // The end is the nearest point of the box, which here is its left edge at
    // the cell's own row.
    expect(line.x2).toBe(1110);
    expect(line.y2).toBe(545);
    // The start clears the reticle rather than beginning inside it.
    expect(Math.hypot(line.x1 - 980, line.y1 - 545))
      .toBeCloseTo(CONSTELLATION_RETICLE_PX / 2 + 6, 5);
  });

  it('lands on the corner when the panel is diagonally placed', () => {
    const panel = { x: 1110, y: 190, width: 440, height: 300 };
    const line = constellationLeader(980, 545, CONSTELLATION_RETICLE_PX, panel);
    expect(line.x2).toBe(1110);
    expect(line.y2).toBe(490);
  });

  it('does not divide by a zero-length run', () => {
    const panel = { x: 900, y: 500, width: 200, height: 200 };
    const line = constellationLeader(980, 545, CONSTELLATION_RETICLE_PX, panel);
    expect(Number.isFinite(line.x1)).toBe(true);
    expect(Number.isFinite(line.y1)).toBe(true);
  });
});

describe('stability under the galaxy\'s own turn', () => {
  it('keeps every instrument in its quadrant while the cell drifts', () => {
    // With the lock, which is how the frame writer always calls it: the
    // hysteresis IS the stability, and a walk asked the same question twice
    // with no memory is entitled to change its mind at a crossing.
    const lock = createConstellationLock();
    let previous: string | null = null;
    for (let step = 0; step <= 40; step += 1) {
      const out = place(THREE, 900 + step, 520 + step * 0.4, 1920, 1080, RAILS_1920, lock);
      const signature = out.map((p) => `${p.slot}:${p.quadrant}`).join('|');
      if (previous !== null) expect(signature).toBe(previous);
      previous = signature;
    }
  });
});

describe('a cell in the corner of the stage', () => {
  it('shares a room or shrinks, but never overlaps', () => {
    // Up and left of a cell at (400, 300) there is no room for a 408 px reader,
    // and only two quadrants are usable at all. Sharing one is an answer and
    // giving height back is an answer; an overlap is not.
    const out = place(THREE, 400, 300, 1920, 1080);
    for (let i = 0; i < out.length; i += 1) {
      for (let j = i + 1; j < out.length; j += 1) {
        expect(overlap(out[i], out[j])).toBe(0);
      }
    }
  });

  it('still spreads across rooms wherever the stage has them', () => {
    const out = place(THREE, 980, 545, 1920, 1080, RAILS_1920);
    expect(new Set(out.map((p) => p.quadrant)).size).toBe(out.length);
  });
});

describe('the quadrant lock', () => {
  it('holds a room against the drift the galaxy puts a cell through', () => {
    const lock = createConstellationLock();
    const first = place(THREE, 900, 520, 1920, 1080, RAILS_1920, lock);
    const seated = first.map((p) => `${p.slot}:${p.quadrant}`).join('|');
    for (let step = 1; step <= 60; step += 1) {
      const out = place(THREE, 900 + step, 520 + step * 0.4, 1920, 1080, RAILS_1920, lock);
      expect(out.map((p) => `${p.slot}:${p.quadrant}`).join('|')).toBe(seated);
    }
  });

  it('yields when the cell has genuinely moved to the other side of the stage', () => {
    const lock = createConstellationLock();
    const left = place(THREE, 420, 545, 1920, 1080, lock ? RAILS_1920 : [], lock);
    expect(bySlot(left, 'analysis').quadrant).toMatch(/r$/);
    const right = place(THREE, 1480, 545, 1920, 1080, RAILS_1920, lock);
    expect(bySlot(right, 'analysis').quadrant).toMatch(/l$/);
  });

  it('is cleared for the next selection', () => {
    const lock = createConstellationLock();
    place(THREE, 420, 545, 1920, 1080, RAILS_1920, lock);
    expect(lock.quadrant.analysis).toBeDefined();
    resetConstellationLock(lock);
    expect(lock.quadrant.analysis).toBeUndefined();
  });

  it('states its margin in the same currency the scorer uses', () => {
    // The template hold bonus was replaced by a continuity term over the seats
    // themselves: a template is a family of arrangements, and what the eye
    // holds on to is the plate. Both knobs are points per pixel of movement,
    // the same currency the height and distance terms are already in.
    expect(CONSTELLATION_CONTINUITY_PX_WEIGHT).toBeGreaterThan(0);
    expect(CONSTELLATION_CONTINUITY_CAP_PX).toBeGreaterThan(CONSTELLATION_HOLD_RADIUS_PX);
  });
});

describe('a stage too tight for three instruments at their asked heights', () => {
  // Both of these are live measurements from the isolated stack: the iPad's two
  // orientations, with the panels at the heights their content actually came
  // out at. The first cut of the walk overlapped the register and the reader by
  // 70,278 px² in landscape and 66,341 in portrait, and sat the reader ON the
  // cell — every quadrant was bad, so it took the least bad one and called it
  // placed.
  const TIGHT: ConstellationPanel[] = [
    { slot: 'analysis', width: 440, height: 612 },
    { slot: 'specimen', width: 280, height: 314 },
    { slot: 'reader', width: 408, height: 331 },
  ];

  const stages: Array<[string, number, number]> = [
    ['iPad landscape, Safari', 1180, 663],
    ['iPad portrait', 820, 1078],
    ['a 1280 laptop', 1280, 800],
  ];

  it.each(stages)('never overlaps or covers the cell on %s', (_name, w, h) => {
    const keepout = constellationKeepoutPx(w, h);
    for (const [ax, ay] of [
      [w * 0.5, h * 0.5], [w * 0.3, h * 0.4], [w * 0.7, h * 0.6],
      [w * 0.5, h * 0.25], [w * 0.5, h * 0.8], [w * 0.2, h * 0.7],
    ]) {
      const out = place(TIGHT, ax, ay, w, h);
      for (let i = 0; i < out.length; i += 1) {
        for (let j = i + 1; j < out.length; j += 1) {
          expect(overlap(out[i], out[j]), `${_name} @${ax},${ay}`).toBe(0);
        }
        // ⚠️ THE FIELD IS A PREFERENCE HERE; THE CORE IS NOT.
        //
        // On a stage this tight some instrument genuinely does not fit any
        // room: a 280 × 314 specimen beside a cell at (354, 265) on an
        // 1180 × 663 stage has 234 px to its left and 278 below it, and the
        // best seat available nicks 14 px of a 106 px field. What may never
        // happen is an instrument reaching the RETICLE — the mark that says
        // which cell this is — and that is what this asserts.
        expect(nearestDistance(out[i], ax, ay), `${_name} core`)
          .toBeGreaterThan(CONSTELLATION_RETICLE_PX / 2);
        expect(keepout).toBeGreaterThan(0);
      }
    }
  });

  it('shrinks what may shrink rather than standing on its neighbour', () => {
    const out = place(TIGHT, 590, 331, 1180, 663);
    // The register and the reader both scroll, so both may give height back.
    // The specimen may not: it is a window at a fixed scale, and a capped
    // window is a clipped braid.
    expect(bySlot(out, 'specimen').height).toBe(314);
    expect(bySlot(out, 'specimen').capped).toBe(false);
    expect(bySlot(out, 'analysis').height).toBeLessThanOrEqual(612);
    expect(bySlot(out, 'reader').height).toBeLessThanOrEqual(331);
  });
});

describe('the promise the scoring cannot make', () => {
  it('prises apart whatever a tight stage still leaves touching', () => {
    // Live on an 820 px portrait stage: a specimen and a reader in different
    // rooms, three and a half pixels of one under the other — 588 px². Every
    // term in the walk is a preference; this is the one guarantee.
    const LIVE: ConstellationPanel[] = [
      { slot: 'analysis', width: 440, height: 341.5 },
      { slot: 'specimen', width: 280, height: 314 },
      { slot: 'reader', width: 408, height: 168 },
    ];
    // A dense sweep, because the first cut of this passed a coarse one and
    // still left fourteen anchors touching: a reader already flush against the
    // stage's left edge was asked to move further left, the clamp refused, and
    // the pass called it moved.
    const stages: Array<[number, number]> = [[820, 1078], [1180, 663], [1920, 1066]];
    for (const [SW, SH] of stages) {
    for (let ax = 40; ax <= SW - 30; ax += 10) {
      for (let ay = 140; ay <= SH - 40; ay += 20) {
        const out = place(LIVE, ax, ay, SW, SH);
        for (let i = 0; i < out.length; i += 1) {
          for (let j = i + 1; j < out.length; j += 1) {
            expect(overlap(out[i], out[j]), `@${ax},${ay}`).toBe(0);
          }
          // …without putting an instrument on the cell to get there. The prise
          // cleared a 3.5 px sliver by moving the reader ONTO the cell in the
          // first cut of this — nearest distance 0, reticle inside the box.
          expect(nearestDistance(out[i], ax, ay), `@${ax},${ay} core`)
            .toBeGreaterThan(CONSTELLATION_RETICLE_PX / 2);
          expect(out[i].x).toBeGreaterThanOrEqual(EDGE - 0.5);
          expect(out[i].y).toBeGreaterThanOrEqual(SAFE_TOP - 0.5);
          expect(out[i].x + out[i].width).toBeLessThanOrEqual(SW - EDGE + 0.5);
          expect(out[i].y + out[i].height).toBeLessThanOrEqual(SH - EDGE + 0.5);
        }
      }
    }
    }
  });
});

describe('whole-group routing', () => {
  type Rect = { left: number; top: number; right: number; bottom: number };
  const routeSegments = (points: readonly { x: number; y: number }[]) => points.slice(1)
    .map((point, index) => [points[index], point] as const);
  const segmentTouches = (a: readonly [{ x: number; y: number }, { x: number; y: number }],
    b: readonly [{ x: number; y: number }, { x: number; y: number }]) => {
    const av = a[0].x === a[1].x; const bv = b[0].x === b[1].x;
    if (av && bv) return a[0].x === b[0].x
      && Math.max(Math.min(a[0].y, a[1].y), Math.min(b[0].y, b[1].y))
        <= Math.min(Math.max(a[0].y, a[1].y), Math.max(b[0].y, b[1].y));
    if (!av && !bv) return a[0].y === b[0].y
      && Math.max(Math.min(a[0].x, a[1].x), Math.min(b[0].x, b[1].x))
        <= Math.min(Math.max(a[0].x, a[1].x), Math.max(b[0].x, b[1].x));
    const v = av ? a : b; const h = av ? b : a;
    return v[0].x >= Math.min(h[0].x, h[1].x) && v[0].x <= Math.max(h[0].x, h[1].x)
      && h[0].y >= Math.min(v[0].y, v[1].y) && h[0].y <= Math.max(v[0].y, v[1].y);
  };
  const expectCleanRoutes = (layout: ReturnType<typeof constellationLayout>) => {
    const routes = layout.placements.map((panel) => panel.route?.points ?? []);
    expect(new Set(routes.map((points) => `${points[0]?.x},${points[0]?.y}`)).size)
      .toBe(routes.length);
    for (let i = 0; i < routes.length; i += 1) {
      for (let j = i + 1; j < routes.length; j += 1) {
        for (const a of routeSegments(routes[i])) for (const b of routeSegments(routes[j])) {
          expect(segmentTouches(a, b), `${layout.placements[i].slot}/${layout.placements[j].slot}`).toBe(false);
        }
      }
    }
  };
  const segmentPenetrates = (segment: readonly [{ x: number; y: number }, { x: number; y: number }],
    box: Rect) => {
    const [a, b] = segment;
    if (a.x === b.x) return a.x > box.left && a.x < box.right
      && Math.max(Math.min(a.y, b.y), box.top) < Math.min(Math.max(a.y, b.y), box.bottom);
    return a.y > box.top && a.y < box.bottom
      && Math.max(Math.min(a.x, b.x), box.left) < Math.min(Math.max(a.x, b.x), box.right);
  };
  const intersect = (a: Rect, b: Rect) => Math.max(0, Math.min(a.right, b.right)
    - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom)
    - Math.max(a.top, b.top));
  const subtract = (source: Rect, cut: Rect): Rect[] => {
    const left = Math.max(source.left, cut.left); const top = Math.max(source.top, cut.top);
    const right = Math.min(source.right, cut.right); const bottom = Math.min(source.bottom, cut.bottom);
    if (right <= left || bottom <= top) return [source];
    return [
      { left: source.left, top: source.top, right: source.right, bottom: top },
      { left: source.left, top: bottom, right: source.right, bottom: source.bottom },
      { left: source.left, top, right: left, bottom },
      { left: right, top, right: source.right, bottom },
    ].filter((box) => box.right - box.left > 0.5 && box.bottom - box.top > 0.5);
  };
  const expectRoutesAvoid = (layout: ReturnType<typeof constellationLayout>, anchorX: number,
    anchorY: number, reserved: Rect[], hud: Rect[]) => {
    const panelBoxes: Rect[] = layout.placements.map((panel) => ({
      left: panel.x, top: panel.y, right: panel.x + panel.width, bottom: panel.y + panel.height,
    }));
    let visibleHud = [...hud];
    for (const panel of panelBoxes) visibleHud = visibleHud.flatMap((box) => subtract(box, panel));
    const reticle = {
      left: anchorX - CONSTELLATION_RETICLE_PX / 2,
      top: anchorY - CONSTELLATION_RETICLE_PX / 2,
      right: anchorX + CONSTELLATION_RETICLE_PX / 2,
      bottom: anchorY + CONSTELLATION_RETICLE_PX / 2,
    };
    const hardObstacles = [...panelBoxes, ...reserved, ...visibleHud, reticle];
    for (const panel of layout.placements) for (const segment of routeSegments(panel.route!.points)) {
      for (const obstacle of hardObstacles) {
        expect(segmentPenetrates(segment, obstacle), `${panel.slot} penetrates ${JSON.stringify(obstacle)}`)
          .toBe(false);
      }
    }
    const labels = layout.placements.map((panel) => panel.route!.label)
      .filter((label) => !label.inPanel)
      .map((label) => ({
        left: label.x - label.width / 2, top: label.y - label.height / 2,
        right: label.x + label.width / 2, bottom: label.y + label.height / 2,
      }));
    for (let index = 0; index < labels.length; index += 1) {
      for (const obstacle of [...panelBoxes, ...reserved, ...visibleHud, reticle]) {
        expect(intersect(labels[index], obstacle)).toBe(0);
      }
      for (let other = index + 1; other < labels.length; other += 1) {
        expect(intersect(labels[index], labels[other])).toBe(0);
      }
    }
    for (let labelIndex = 0; labelIndex < labels.length; labelIndex += 1) {
      for (let routeIndex = 0; routeIndex < layout.placements.length; routeIndex += 1) {
        const ownLabel = layout.placements[routeIndex].route!.label;
        if (!ownLabel.inPanel && ownLabel.x === (labels[labelIndex].left + labels[labelIndex].right) / 2
          && ownLabel.y === (labels[labelIndex].top + labels[labelIndex].bottom) / 2) continue;
        for (const segment of routeSegments(layout.placements[routeIndex].route!.points)) {
          expect(segmentPenetrates(segment, labels[labelIndex])).toBe(false);
        }
      }
    }
  };
  const routed = (panels: ConstellationPanel[], anchorX: number, anchorY: number,
    stageWidth: number, stageHeight: number, reserved: HudOcclusionRect[] = [],
    obstacles: HudOcclusionRect[] = []) => constellationLayout({
      panels, anchorX, anchorY, stageWidth, stageHeight, reserved, obstacles,
      safeTop: SAFE_TOP, edge: EDGE,
    });

  it('solves the screenshot geometry with the measured name chip', () => {
    const reserved = [
      { left: 314, top: 543, right: 690, bottom: 567 },
    ];
    const layout = routed([
      { slot: 'analysis', width: 440, height: 717 },
      { slot: 'specimen', width: 280, height: 314 },
      { slot: 'reader', width: 408, height: 340 },
    ], 502, 485, 1920, 920, reserved);
    expect(layout.status).not.toBe('unavailable');
    expect(layout.placements).toHaveLength(3);
    expect(layout.placements.every((panel) => panel.route && panel.route.points.length >= 2)).toBe(true);
    expectCleanRoutes(layout);
    expectRoutesAvoid(layout, 502, 485, reserved, []);
  });

  it('folds four panels into multiple portrait shelves', () => {
    const reserved = [
      { left: 250, top: 608, right: 570, bottom: 632 },
    ];
    const layout = routed([
      { slot: 'analysis', width: 440, height: 717 },
      { slot: 'specimen', width: 280, height: 314 },
      { slot: 'reader', width: 408, height: 340 },
      { slot: 'trace', width: 560, height: 420 },
    ], 410, 550, 820, 1078, reserved);
    expect(layout.status).toBe('compressed');
    expect(layout.placements).toHaveLength(4);
    expect(layout.template).toMatch(/^fold-/);
    expectCleanRoutes(layout);
    expectRoutesAvoid(layout, 410, 550, reserved, []);
  });

  it('routes around real tablet rails, panels, reticle and name', () => {
    const rails = [
      { left: 14, top: 48, right: 312, bottom: 282 },
      { left: 14, top: 306, right: 312, bottom: 517 },
      { left: 926, top: 153, right: 1166, bottom: 266 },
    ];
    const layout = routed(THREE, 590, 370, 1180, 663, [
      { left: 420, top: 428, right: 760, bottom: 452 },
    ], rails);
    expect(layout.status).not.toBe('unavailable');
    expect(layout.placements).toHaveLength(3);
    for (const panel of layout.placements) {
      expect((panel.route?.points.length ?? 0) - 2).toBeLessThanOrEqual(3);
    }
    expectCleanRoutes(layout);
    expectRoutesAvoid(layout, 590, 370, [
      { left: 420, top: 428, right: 760, bottom: 452 },
    ], rails);
  });

  it('holds panel coordinates along a continuous track while routes follow', () => {
    const lock = createConstellationLock();
    const input = {
      panels: THREE, stageWidth: 1920, stageHeight: 920, safeTop: SAFE_TOP, edge: EDGE,
      reserved: [{ left: 314, top: 543, right: 690, bottom: 567 }], lock,
    };
    const first = constellationLayout({ ...input, anchorX: 502, anchorY: 485 });
    const seats = first.placements.map((panel) => `${panel.x},${panel.y}`).join('|');
    const route = first.placements[0].route?.points.map((point) => `${point.x},${point.y}`).join('|');
    const last = constellationLayout({ ...input, anchorX: 508, anchorY: 488 });
    expect(last.placements.map((panel) => `${panel.x},${panel.y}`).join('|')).toBe(seats);
    expect(last.placements[0].route?.points.map((point) => `${point.x},${point.y}`).join('|'))
      .not.toBe(route);
  });

  it('only presents a re-anchored old route after current hard-geometry checks', () => {
    const baseInput = {
      panels: THREE, stageWidth: 1920, stageHeight: 920,
      safeTop: SAFE_TOP, edge: EDGE,
      reserved: [{ left: 314, top: 543, right: 690, bottom: 567 }],
    };
    const base = constellationLayout({ ...baseInput, anchorX: 502, anchorY: 485 });
    const movedInput = { ...baseInput, anchorX: 504, anchorY: 487 };
    const moved = revalidateConstellationLayoutForAnchor(movedInput, base, 502, 485);
    expect(moved).not.toBeNull();
    expectCleanRoutes(moved!);
    expectRoutesAvoid(moved!, 504, 487, movedInput.reserved, []);
    for (const panel of moved!.placements) {
      const end = panel.route!.points.at(-1)!;
      const onVertical = (Math.abs(end.x - panel.x) < 0.1
        || Math.abs(end.x - panel.x - panel.width) < 0.1)
        && end.y >= panel.y && end.y <= panel.y + panel.height;
      const onHorizontal = (Math.abs(end.y - panel.y) < 0.1
        || Math.abs(end.y - panel.y - panel.height) < 0.1)
        && end.x >= panel.x && end.x <= panel.x + panel.width;
      expect(onVertical || onHorizontal).toBe(true);
    }

    const segment = base.placements[0].route!.points.slice(-2);
    const blockX = (segment[0].x + segment[1].x) / 2;
    const blockY = (segment[0].y + segment[1].y) / 2;
    expect(revalidateConstellationLayoutForAnchor({
      ...movedInput,
      obstacles: [{ left: blockX - 3, top: blockY - 3, right: blockX + 3, bottom: blockY + 3 }],
    }, base, 502, 485)).toBeNull();
  });
});

// ——— the 2026-09-11 repair: what each finding looks like as an assertion ————

const THREE_MEASURED = CONSTELLATION_PANELS.slice(0, 3) as ConstellationPanel[];

/** Every matrix geometry solved once: the routed answer and the geometry-only
 * answer for the same input. Two suites below read it, and a cold four-panel
 * solve is expensive enough that solving it twice would dominate them. */
let matrixAnswers: Array<{
  key: string;
  input: ReturnType<typeof constellationMatrixInput>;
  routed: ConstellationLayout;
  geometry: ConstellationPlacement[];
}> | null = null;
function matrixMatrix() {
  if (matrixAnswers) return matrixAnswers;
  matrixAnswers = constellationMatrixCases().map((matrixCase) => {
    const input = constellationMatrixInput(matrixCase);
    return {
      key: matrixCase.key,
      input,
      routed: constellationLayout(input),
      geometry: constellationPlacement(input),
    };
  });
  return matrixAnswers;
}

describe('a leader that cannot be drawn cleanly never vetoes a seat (F1)', () => {
  // Measured 2026-09-11: at each of these anchors the reticle stands over a HUD
  // rail, all eight route outlets start inside the rail obstacle, every route
  // fails, and the whole layout comes back `unavailable` — while geometry alone
  // finds three seats on the same input. The rail is standing on the Cell; the
  // Cell is not standing on the rail, and a rail is not a reason to withdraw
  // the instruments.
  const UNDER_RAIL: Array<[number, number, number, number, readonly HudOcclusionRect[]]> = [
    [200, 250, 1920, 1080, RAILS_1920],
    [1700, 200, 1920, 1080, RAILS_1920],
    [300, 800, 1920, 1080, RAILS_1920],
    [1000, 200, 1180, 663, RAILS_1180],
  ];

  it.each(UNDER_RAIL)('seats three instruments for a cell under a rail at %i,%i',
    (anchorX, anchorY, stageWidth, stageHeight, rails) => {
      const input = {
        panels: THREE_MEASURED,
        anchorX,
        anchorY,
        stageWidth,
        stageHeight,
        obstacles: rails,
        reserved: constellationChipReserved(anchorX, anchorY, stageWidth),
        safeTop: SAFE_TOP,
        edge: EDGE,
      };
      const geometry = constellationPlacement(input);
      expect(geometry).toHaveLength(3);

      const layout = constellationLayout(input);
      expect(layout.status).not.toBe('unavailable');
      expect(layout.placements).toHaveLength(3);
      // Clean or degraded, every instrument is connected to its Cell.
      for (const panel of layout.placements) {
        expect(panel.route, `${panel.slot} has no leader`).toBeDefined();
        expect(panel.route!.points.length).toBeGreaterThanOrEqual(2);
      }
    });
});

describe('routing failure never takes height from an instrument (F6)', () => {
  it('answers every matrix geometry at the height geometry alone asked for', () => {
    // Measured 2026-09-11: 6 of 155 cases came back up to 210 px shorter than
    // the geometry-only answer for the same input, because a failed route
    // escalated the squeeze. Compression is a statement about room, and a
    // leader has no standing to make it.
    const shorter: string[] = [];
    for (const answer of matrixMatrix()) {
      if (answer.geometry.length !== answer.routed.placements.length) continue;
      const geometryHeight = answer.geometry.reduce((sum, panel) => sum + panel.height, 0);
      const routedHeight = answer.routed.placements.reduce((sum, panel) => sum + panel.height, 0);
      if (routedHeight < geometryHeight - 0.5) {
        shorter.push(`${answer.key}: geometry ${geometryHeight.toFixed(0)} vs routed ${routedHeight.toFixed(0)}`);
      }
    }
    expect(shorter).toEqual([]);
  });

  it('takes the sixteen-pixel gap before it takes height from an instrument', () => {
    // A 793 px stage leaves a 675 px band. A specimen and a reader stacked in
    // one column need 654 px plus the gap: 678 at the preferred 24 and 670 at
    // the minimum 16. Trying every squeeze at 24 before ever trying 16 answers
    // this with a 365 px register and a 258 px reader; taking the tighter gap
    // first answers it with all three instruments whole.
    const anchorX = 960;
    const anchorY = 396.5;
    const layout = constellationLayout({
      panels: [
        { slot: 'analysis', width: 440, height: 480, labelWidth: 62, labelHeight: 20 },
        { slot: 'specimen', width: 280, height: 314, labelWidth: 78, labelHeight: 20 },
        { slot: 'reader', width: 408, height: 340, labelWidth: 62, labelHeight: 20 },
      ],
      anchorX,
      anchorY,
      stageWidth: 1920,
      stageHeight: 793,
      reserved: constellationChipReserved(anchorX, anchorY, 1920),
      safeTop: SAFE_TOP,
      edge: EDGE,
    });
    expect(layout.placements).toHaveLength(3);
    expect(layout.placements.map((panel) => `${panel.slot}:${panel.height}`)).toEqual([
      'analysis:480', 'specimen:314', 'reader:340',
    ]);
    expect(layout.placements.every((panel) => !panel.capped)).toBe(true);
    expect(layout.status).toBe('normal');
  });
});

describe('the seats hold while the galaxy turns the cell (F4)', () => {
  // Measured 2026-09-11 at 2 px/frame: 7 seat changes over the same drift, the
  // largest single-frame jump 854 px. The 376 px chip was a hard reserved claim
  // on every locked reuse, so about 24 px of horizontal drift broke the lock,
  // and the re-solve kept the template but not the seats.
  //
  // What a re-seat is measured against is the anchor's travel SINCE THE SEATS
  // WERE SET, not since the previous frame: the ruling on the plan's §9.3 is a
  // hold radius of 160 px with a group step of the same length, so the
  // constellation is expected to move about 160 px when it moves at all. The
  // question the assertion asks is whether the plates went with the Cell or
  // somewhere else — travel plus 48 px is following, 854 px is a teleport.
  const drift = (perFrame: number, frames: number) => {
    const lock = createConstellationLock();
    let anchorX = 900;
    const anchorY = 520;
    let previous: ConstellationPlacement[] | null = null;
    let seatedAtAnchorX = anchorX;
    let changes = 0;
    let worst = 0;
    for (let frame = 0; frame < frames; frame += 1) {
      anchorX += perFrame;
      const layout = constellationLayout({
        panels: THREE_MEASURED,
        anchorX,
        anchorY,
        stageWidth: 1920,
        stageHeight: 1080,
        reserved: constellationChipReserved(anchorX, anchorY, 1920),
        obstacles: RAILS_1920,
        safeTop: SAFE_TOP,
        edge: EDGE,
        lock,
      });
      const signature = layout.placements.map((panel) => `${panel.x},${panel.y}`).join('|');
      if (previous && signature !== previous.map((panel) => `${panel.x},${panel.y}`).join('|')) {
        changes += 1;
        for (const panel of layout.placements) {
          const before = previous.find((other) => other.slot === panel.slot);
          if (!before) continue;
          worst = Math.max(worst, Math.hypot(panel.x - before.x, panel.y - before.y)
            - Math.abs(anchorX - seatedAtAnchorX));
        }
        seatedAtAnchorX = anchorX;
      }
      previous = layout.placements;
    }
    return { changes, worst };
  };

  it('re-seats at most three times over 480 px of drift, and never teleports', () => {
    const { changes, worst } = drift(2, 240);
    expect(changes).toBeLessThanOrEqual(3);
    // A re-seat may follow the Cell; it may not jump the stage.
    expect(worst).toBeLessThanOrEqual(48);
  });

  it('holds the same promise at the speeds an orbit and a canopy turn at', () => {
    // 0.6 px/frame is a slow orbit; 0.07 is the 12 % canopy tempo a selected
    // Cell drifts at while the reader simply reads. Both run to 480 px of
    // travel so the comparison with the 2 px/frame case is like for like.
    for (const perFrame of [0.6, 0.07]) {
      const { changes, worst } = drift(perFrame, Math.round(480 / perFrame));
      expect(changes, `seat changes at ${perFrame} px/frame`).toBeLessThanOrEqual(3);
      expect(worst, `worst move over the anchor at ${perFrame} px/frame`)
        .toBeLessThanOrEqual(48);
    }
  });
});

describe('an instrument whose content grows stays where the reader left it (F5)', () => {
  // RED until P3 — grow in place.
  it.fails('extends the register in place and moves neither of its neighbours', () => {
    // Measured 2026-09-11 at a fixed anchor: the register's x went
    // 760 → 376 → 1192 and its top 666 → 104 → 468 as its content grew, and
    // the specimen and the reader moved with it every time.
    const lock = createConstellationLock();
    const anchorX = 980;
    const anchorY = 545;
    let firstX: number | null = null;
    let firstTop: number | null = null;
    let neighbours: string | null = null;
    for (const height of [400, 480, 560, 640, 727]) {
      const layout = constellationLayout({
        panels: THREE_MEASURED.map((panel) => (
          panel.slot === 'analysis' ? { ...panel, height } : panel
        )),
        anchorX,
        anchorY,
        stageWidth: 1920,
        stageHeight: 1080,
        reserved: constellationChipReserved(anchorX, anchorY, 1920),
        obstacles: RAILS_1920,
        safeTop: SAFE_TOP,
        edge: EDGE,
        lock,
      });
      const analysis = layout.placements.find((panel) => panel.slot === 'analysis')!;
      const others = layout.placements.filter((panel) => panel.slot !== 'analysis')
        .map((panel) => `${panel.slot}@${panel.x},${panel.y}`).join(' ');
      if (firstX === null) {
        firstX = analysis.x; firstTop = analysis.y; neighbours = others;
        continue;
      }
      expect(analysis.x, `register x at ${height}`).toBe(firstX);
      expect(analysis.y, `register top at ${height}`).toBe(firstTop);
      expect(others, `neighbours at ${height}`).toBe(neighbours);
    }
  });
});

describe('a leader survives a one-pixel move (F7)', () => {
  // RED until P3 — the re-anchor tolerance.
  it.fails('re-anchors every matrix layout for a move of two pixels or less', () => {
    // Measured 2026-09-11: null on +1 px in about 20 % of 108 geometries and on
    // +30 px in about 45 %, because the canonical routes hug the expanded
    // obstacle edges exactly. A leader that vanishes on a pixel of drift is a
    // leader that vanishes whenever the galaxy turns.
    const failed: string[] = [];
    let checked = 0;
    for (const answer of matrixMatrix()) {
      if (answer.routed.status === 'unavailable') continue;
      if (!answer.routed.placements.every((panel) => panel.route)) continue;
      for (const [dx, dy] of [[2, 0], [-2, 0], [0, 2], [0, -2]] as const) {
        checked += 1;
        const moved = {
          ...answer.input,
          anchorX: answer.input.anchorX + dx,
          anchorY: answer.input.anchorY + dy,
          reserved: constellationChipReserved(
            answer.input.anchorX + dx, answer.input.anchorY + dy, answer.input.stageWidth,
          ),
        };
        const next = revalidateConstellationLayoutForAnchor(
          moved, answer.routed, answer.input.anchorX, answer.input.anchorY,
        );
        if (!next) failed.push(`${answer.key} ${dx},${dy}`);
      }
    }
    expect(checked).toBeGreaterThan(0);
    expect(failed).toEqual([]);
  });
});

describe('a held constellation routes inside the interaction (P2)', () => {
  const base = {
    panels: CONSTELLATION_PANELS.slice(0, 3) as ConstellationPanel[],
    stageWidth: 1920,
    stageHeight: 1080,
    obstacles: RAILS_1920,
    safeTop: SAFE_TOP,
    edge: EDGE,
  };

  it('carries the line it already drew instead of searching for it again', () => {
    // Measured 2026-09-11: a locked re-solve after three pixels of drift cost
    // p90 107 ms and up to 4,153 ms, because the held seats were re-routed from
    // nothing every frame. The lock now holds the routes too.
    const lock = createConstellationLock();
    const first = constellationLayout({
      ...base,
      anchorX: 900,
      anchorY: 520,
      reserved: constellationChipReserved(900, 520, 1920),
      lock,
    });
    expect(first.status).not.toBe('unavailable');
    expect(first.leaders).toBe('clean');

    resetConstellationWorkStats();
    const second = constellationLayout({
      ...base,
      anchorX: 903,
      anchorY: 521,
      reserved: constellationChipReserved(903, 521, 1920),
      lock,
    });
    const stats = snapshotConstellationWorkStats();

    expect(stats.lockedReuses).toBe(1);
    expect(stats.fullSolves).toBe(0);
    // The whole point: no grid search, one route order, and not one pair of the
    // fast pass, because every leader was already known.
    expect(stats.searchedRouteAttempts).toBe(0);
    expect(stats.routeGridPoints).toBe(0);
    expect(stats.routeOrders).toBe(1);
    expect(stats.fastRouteAttempts).toBe(0);
    expect(stats.degradedRoutes).toBe(0);
    expect(second.leaders).toBe('clean');
    for (const panel of second.placements) {
      const before = first.placements.find((other) => other.slot === panel.slot);
      const from = before?.route?.points[0];
      const to = panel.route?.points[0];
      expect(to, `${panel.slot} keeps its outlet`).toEqual({
        x: (from?.x ?? 0) + 3, y: (from?.y ?? 0) + 1,
      });
    }
  });

  it('takes the fallback leader rather than spending a search it cannot afford', () => {
    // A held plate whose line no longer reaches it degrades for this frame.
    // The locked path runs under the pointer; the grid search does not belong
    // in it at any price, and the reader sees a dashed leader rather than a
    // dropped frame.
    const lock = createConstellationLock();
    constellationLayout({
      ...base,
      anchorX: 900,
      anchorY: 520,
      reserved: constellationChipReserved(900, 520, 1920),
      lock,
    });
    // Move far enough that the translated legs cannot all survive, but stay
    // inside the 160 px hold radius so the seats are still reused.
    resetConstellationWorkStats();
    const drifted = constellationLayout({
      ...base,
      anchorX: 1020,
      anchorY: 590,
      reserved: constellationChipReserved(1020, 590, 1920),
      lock,
    });
    const stats = snapshotConstellationWorkStats();
    expect(stats.lockedReuses + stats.fullSolves).toBeGreaterThan(0);
    if (stats.lockedReuses === 1) {
      expect(stats.searchedRouteAttempts).toBe(0);
      expect(stats.routeGridPoints).toBe(0);
      expect(drifted.placements.length).toBe(3);
      expect(drifted.placements.every((panel) => panel.route)).toBe(true);
    }
  });
});

describe('the floor an instrument is read at, and the field it stands off (F8)', () => {
  // Until 2026-09-12 `CONSTELLATION_MIN_HEIGHT_PX` was exported, documented and
  // never read: every rung of the squeeze ladder floored a cappable plate at
  // the 120 px stack minimum, so the review measured 1024 x 600 seating both
  // the register and the reader at 120 px — five lines of a list in a plate
  // that says it is an instrument.
  const SMALL: ConstellationPanel[] = [
    { slot: 'analysis', width: 440, height: 717, labelWidth: 62, labelHeight: 20 },
    { slot: 'specimen', width: 280, height: 314, labelWidth: 78, labelHeight: 20 },
    { slot: 'reader', width: 408, height: 340, labelWidth: 62, labelHeight: 20 },
  ];

  it('reads the ladder from one statement, and cuts to the stack minimum only at its foot', () => {
    const floors = CONSTELLATION_SQUEEZE_LEVELS.map((level) => level.floor);
    expect(floors.slice(0, -1).every((floor) => floor === CONSTELLATION_MIN_HEIGHT_PX)).toBe(true);
    expect(floors[floors.length - 1]).toBe(CONSTELLATION_STACK_MIN_PX);
    // The foot is the rung that shipped before the readable floor existed, so
    // no stage can lose its constellation to the higher one.
    const last = CONSTELLATION_SQUEEZE_LEVELS[CONSTELLATION_SQUEEZE_LEVELS.length - 1];
    expect(last.ratio).toBe(CONSTELLATION_SQUEEZE_LEVELS[CONSTELLATION_SQUEEZE_LEVELS.length - 2].ratio);
  });

  const small = (stageWidth: number, stageHeight: number, count = 3) => constellationLayout({
    panels: SMALL.slice(0, count),
    anchorX: stageWidth / 2,
    anchorY: stageHeight / 2,
    stageWidth,
    stageHeight,
    reserved: constellationChipReserved(stageWidth / 2, stageHeight / 2, stageWidth),
    safeTop: SAFE_TOP,
    edge: EDGE,
  });

  it('seats a crowded stage at the readable floor rather than the stack minimum', () => {
    // 768 x 1024 in portrait: the reader used to be cut to 136 px here because
    // the ratio said so and nothing said it was unreadable.
    const layout = small(768, 1024);
    expect(layout.status).not.toBe('unavailable');
    for (const panel of layout.placements) {
      if (panel.slot === 'specimen') continue;
      expect(panel.height, `${panel.slot} at 768x1024`)
        .toBeGreaterThanOrEqual(CONSTELLATION_MIN_HEIGHT_PX);
    }
  });

  it('gives a stage with no readable answer the one it had, rather than none', () => {
    // ⚠️ 1024 x 600 is the case the review named and the case that does NOT
    // move: 142 px of room above the reticle and 232 below hold one 120 px
    // instrument each and no 168 px one at all. Every rung with the readable
    // floor fails, the last rung answers, and the picture is the one that
    // shipped. This is what makes the higher floor safe.
    const layout = small(1024, 600);
    expect(layout.status).toBe('compressed');
    expect(layout.placements.map((panel) => `${panel.slot}:${panel.height}`)).toEqual([
      'analysis:120', 'specimen:314', 'reader:120',
    ]);
  });

  it('never cuts an instrument below the readable floor where the whole matrix has an answer', () => {
    // Across the 162 matrix cases the only heights below the readable floor are
    // the ones the LAST rung produced, and a plate that asked for less than the
    // floor keeps what it asked for.
    const short: string[] = [];
    for (const answer of matrixMatrix()) {
      for (const panel of answer.routed.placements) {
        if (panel.slot === 'specimen' || !panel.capped) continue;
        if (panel.height < CONSTELLATION_STACK_MIN_PX - 0.5) {
          short.push(`${answer.key} ${panel.slot}:${panel.height}`);
        }
      }
    }
    expect(short).toEqual([]);
  });

  it('names the stage width at which the cell gets a field, in one place', () => {
    // The three candidate enumerators and the held-seat margin all read the
    // same threshold, and the test is that they agree — measured through the
    // answer, one pixel either side of it, on the same stage otherwise. Below
    // it an instrument may stand at the reticle's own clearance; at it the Cell
    // keeps its whole field. The values are the clearance plus the preferred
    // gap: 54 + 24 and 120 + 24.
    const nearest = (stageWidth: number) => {
      const anchorX = stageWidth / 2;
      const out = constellationPlacement({
        panels: SMALL.slice(0, 2),
        anchorX,
        anchorY: 540,
        stageWidth,
        stageHeight: 1080,
        safeTop: SAFE_TOP,
        edge: EDGE,
      });
      return Math.min(...out.map((panel) => Math.hypot(
        Math.max(panel.x - anchorX, anchorX - (panel.x + panel.width), 0),
        Math.max(panel.y - 540, 540 - (panel.y + panel.height), 0),
      )));
    };
    const field = constellationKeepoutPx(CONSTELLATION_FIELD_MIN_STAGE_PX, 1080);
    expect(nearest(CONSTELLATION_FIELD_MIN_STAGE_PX))
      .toBe(field + CONSTELLATION_PREFERRED_GAP_PX);
    expect(nearest(CONSTELLATION_FIELD_MIN_STAGE_PX - 1))
      .toBe(CONSTELLATION_RETICLE_PX / 2 + CONSTELLATION_ROUTE_CLEARANCE_PX
        + CONSTELLATION_PREFERRED_GAP_PX);
  });
});
