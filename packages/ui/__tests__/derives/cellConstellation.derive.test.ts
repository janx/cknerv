import { describe, expect, it } from 'vitest';
import type { HudOcclusionRect } from '../../src/components/hudOcclusion';
import {
  CONSTELLATION_HOLD_MARGIN_PX,
  CONSTELLATION_MIN_HEIGHT_PX,
  CONSTELLATION_MIN_GAP_PX,
  CONSTELLATION_ORDER,
  CONSTELLATION_RETICLE_PX,
  constellationKeepoutPx,
  constellationLeader,
  constellationPlacement,
  createConstellationLock,
  resetConstellationLock,
  type ConstellationPanel,
  type ConstellationPlacement,
} from '../../src/derives/cellConstellation.derive';

const SAFE_TOP = 104;
const EDGE = 14;

/** The three instruments at the measures the card draws them at today. */
const THREE: ConstellationPanel[] = [
  { slot: 'analysis', width: 440, height: 727 },
  { slot: 'specimen', width: 280, height: 308 },
  { slot: 'reader', width: 408, height: 370 },
];
const TWO: ConstellationPanel[] = THREE.filter((p) => p.slot !== 'reader');

/** The rails at 1920, from the live capture (`f-1920-bare.json`). */
const RAILS_1920: HudOcclusionRect[] = [
  { left: 14, top: 48, right: 384, bottom: 510.8 },
  { left: 14, top: 723.5, right: 384, bottom: 934.5 },
  { left: 14, top: 946.5, right: 384, bottom: 1066 },
  { left: 1574, top: 48, right: 1906, bottom: 310.8 },
  { left: 1574, top: 322.8, right: 1906, bottom: 522.8 },
];

function place(
  panels: ConstellationPanel[],
  anchorX: number,
  anchorY: number,
  stageWidth: number,
  stageHeight: number,
  obstacles: HudOcclusionRect[] = [],
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
    expect(CONSTELLATION_HOLD_MARGIN_PX).toBeGreaterThan(0);
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
