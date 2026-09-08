import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  dimHudPanelsUnder,
  hudHoleFromRects,
  measureHudOcclusionRectsForTest,
} from '../../src/components/hudOcclusion';

/** jsdom lays nothing out, so every element is told what box it has. */
function panel(
  box: { left: number; top: number; right: number; bottom: number },
  parent: HTMLElement = document.body,
): HTMLElement {
  const element = document.createElement('div');
  element.setAttribute('data-hud-occlusion', 'true');
  element.getBoundingClientRect = () => ({
    ...box,
    width: box.right - box.left,
    height: box.bottom - box.top,
    x: box.left,
    y: box.top,
    toJSON: () => box,
  }) as DOMRect;
  parent.appendChild(element);
  return element;
}

/** The reader clips to the viewport the way the route camera does, so the
 *  stage has to have one: jsdom's default 1024×768 would crop a right rail at
 *  1920 out of existence. */
function stage(width: number, height: number): void {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: height, configurable: true });
}

beforeEach(() => {
  stage(1920, 1080);
});

afterEach(() => {
  dimHudPanelsUnder(null);
  document.body.replaceChildren();
});

describe('useHudOcclusionRects measurement', () => {
  it('reads every HUD occluder', () => {
    panel({ left: 14, top: 48, right: 384, bottom: 519 });
    panel({ left: 1574, top: 48, right: 1906, bottom: 519 });

    expect(measureHudOcclusionRectsForTest()).toEqual([
      { left: 14, top: 48, right: 384, bottom: 519 },
      { left: 1574, top: 48, right: 1906, bottom: 519 },
    ]);
  });

  it('drops an occluder that is inside an inspection layer', () => {
    // `ConsensusMemoryTracePlate` carries the occlusion attribute and renders
    // INSIDE the cell card. Left in the reading it is an obstacle that moves
    // with the card, so the solver would push the card away from a rect that
    // follows it — a card walking off the screen chasing its own trace
    // ledger. Anything inside an inspection layer is not an obstacle to
    // inspection.
    const layer = document.createElement('div');
    layer.setAttribute('data-scene-inspection-layer', 'true');
    document.body.appendChild(layer);
    panel({ left: 14, top: 48, right: 384, bottom: 519 });
    panel({ left: 600, top: 300, right: 900, bottom: 700 }, layer);

    expect(measureHudOcclusionRectsForTest()).toEqual([
      { left: 14, top: 48, right: 384, bottom: 519 },
    ]);
  });

  it('drops a box with no area', () => {
    panel({ left: 200, top: 200, right: 200, bottom: 400 });

    expect(measureHudOcclusionRectsForTest()).toEqual([]);
  });

  it('clips a panel to the viewport and drops one that has left it', () => {
    // A rail half off a narrowed screen occludes only the half still on it.
    stage(1200, 800);
    panel({ left: 1000, top: 48, right: 1500, bottom: 900 });
    panel({ left: 1300, top: 48, right: 1500, bottom: 519 });

    expect(measureHudOcclusionRectsForTest()).toEqual([
      { left: 1000, top: 48, right: 1200, bottom: 800 },
    ]);
  });

  it('publishes one array, kept current in place', () => {
    // The frame loop holds this reference for as long as a card is open, so a
    // measurement may not hand back a new array: the identity is the contract.
    panel({ left: 14, top: 48, right: 384, bottom: 519 });
    const first = measureHudOcclusionRectsForTest();
    document.body.replaceChildren();
    panel({ left: 20, top: 60, right: 300, bottom: 400 });
    const second = measureHudOcclusionRectsForTest();

    expect(second).toBe(first);
    expect(second).toEqual([{ left: 20, top: 60, right: 300, bottom: 400 }]);
  });
});

describe('dimHudPanelsUnder', () => {
  it('marks only the panels the transparent window stands on', () => {
    const rail = panel({ left: 14, top: 48, right: 384, bottom: 519 });
    const clear = panel({ left: 1574, top: 48, right: 1906, bottom: 519 });

    // The CELL SCAN square at 250–545 × 95–390, the box the 1000×720 capture
    // read a chain tip and a byte budget across.
    expect(dimHudPanelsUnder({ left: 250, top: 95, right: 545, bottom: 390 }))
      .toBe(1);
    expect(rail.dataset.hudDim).toBe('true');
    expect(clear.dataset.hudDim).toBeUndefined();
  });

  it('gives the light back when the window moves off', () => {
    const rail = panel({ left: 14, top: 48, right: 384, bottom: 519 });
    dimHudPanelsUnder({ left: 250, top: 95, right: 545, bottom: 390 });
    expect(rail.dataset.hudDim).toBe('true');

    expect(dimHudPanelsUnder({ left: 700, top: 95, right: 995, bottom: 390 }))
      .toBe(0);
    expect(rail.dataset.hudDim).toBeUndefined();
  });

  it('gives the light back when the card closes', () => {
    const rail = panel({ left: 14, top: 48, right: 384, bottom: 519 });
    dimHudPanelsUnder({ left: 250, top: 95, right: 545, bottom: 390 });

    expect(dimHudPanelsUnder(null)).toBe(0);
    expect(rail.dataset.hudDim).toBeUndefined();
  });

  it('never dims a panel that is part of a card', () => {
    // The trace ledger travels with the card, so the square can never be
    // "standing on" it in the sense that matters — and dimming a plate of the
    // card the reader is looking at would be the card fighting itself.
    const layer = document.createElement('div');
    layer.setAttribute('data-scene-inspection-layer', 'true');
    document.body.appendChild(layer);
    const trace = panel({ left: 300, top: 100, right: 500, bottom: 300 }, layer);

    expect(dimHudPanelsUnder({ left: 250, top: 95, right: 545, bottom: 390 }))
      .toBe(0);
    expect(trace.dataset.hudDim).toBeUndefined();
  });

  it('counts a touching edge as clear', () => {
    // Same rule the placement solver settles a card to: a square whose left
    // edge IS the rail's right edge is beside it, not on it — which is exactly
    // where A1 puts the card when the room allows.
    const rail = panel({ left: 14, top: 48, right: 384, bottom: 519 });

    expect(dimHudPanelsUnder({ left: 384, top: 95, right: 679, bottom: 390 }))
      .toBe(0);
    expect(rail.dataset.hudDim).toBeUndefined();
  });
});

describe('hudHoleFromRects', () => {
  // The inspector's live clearance. The overview camera reserves rail width
  // independently of these panels' changing heights (useHudCameraFrame).
  const RAILS = [
    { left: 14, top: 48, right: 384, bottom: 519 },
    { left: 1574, top: 48, right: 1906, bottom: 519 },
  ];

  it('reads the hole between the rails', () => {
    expect(hudHoleFromRects(RAILS, 1920, 1080)).toEqual({ left: 384, right: 1574 });
  });

  it('ignores a panel that is not level with the stage', () => {
    // The status strip runs the whole width across the top; it is not a wall
    // the composition has to fit between, and taking it as one would report a
    // hole of zero at every viewport.
    const strip = { left: 0, top: 0, right: 1920, bottom: 48 };

    expect(hudHoleFromRects([...RAILS, strip], 1920, 1080))
      .toEqual({ left: 384, right: 1574 });
  });

  it('takes the innermost edge on each side', () => {
    const dao = { left: 14, top: 560, right: 300, bottom: 900 };
    const chain = { left: 14, top: 48, right: 384, bottom: 519 };

    expect(hudHoleFromRects([dao, chain], 1920, 1080).left).toBe(384);
  });

  it('answers the full viewport when the HUD has laid nothing out', () => {
    expect(hudHoleFromRects([], 1920, 1080)).toEqual({ left: 0, right: 1920 });
  });

  it('reads what the reader measured, in the same units', () => {
    // The two halves of the same rule: the rects are measured here and the
    // hole is derived here, so a clip or an exclusion the reader applies is
    // already in the hole. A rail inside an inspection layer is not a wall.
    panel({ left: 14, top: 48, right: 384, bottom: 519 });
    panel({ left: 1574, top: 48, right: 1906, bottom: 519 });
    const layer = document.createElement('div');
    layer.setAttribute('data-scene-inspection-layer', 'true');
    document.body.appendChild(layer);
    panel({ left: 900, top: 300, right: 1200, bottom: 700 }, layer);

    expect(hudHoleFromRects(measureHudOcclusionRectsForTest(), 1920, 1080))
      .toEqual({ left: 384, right: 1574 });
  });
});
