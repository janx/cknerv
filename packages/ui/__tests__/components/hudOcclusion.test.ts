import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { measureHudOcclusionRectsForTest } from '../../src/components/hudOcclusion';

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
