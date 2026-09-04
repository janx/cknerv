// A panel under a card that cannot clear it gives way (the user's ruling of
// 2026-09-05, extending A3 from the CELL SCAN square to the whole card).
//
// Every box below is a live measurement (`runs/C0/measure.json`): the 1,000 px
// stage, where the HUD leaves a 434 px hole and the card's own floor is 640, and
// the 1,920 px stage, where the card stands clear and only its transparent
// window can print a panel on the specimen.
//
// jsdom lays nothing out, so every box here is declared — the panels' before
// the render (the hole is measured from them), the card's after it.
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Cell } from '@cknerv/types';
import CellInspectionOverlay, {
  createCellInspectionHandles,
} from '../../src/components/CellInspectionOverlay';
import { cellCardStandsOnHud } from '../../src/components/hud/CellDetailPanel';
import { HUD_DIM_SAMPLE_MS } from '../../src/components/hudOcclusion';

interface Box { left: number; top: number; right: number; bottom: number }

function stubRect(element: HTMLElement, box: Box): HTMLElement {
  element.getBoundingClientRect = () => ({
    ...box,
    width: box.right - box.left,
    height: box.bottom - box.top,
    x: box.left,
    y: box.top,
    toJSON: () => box,
  }) as DOMRect;
  return element;
}

/** A HUD module, with the attribute both the hole and the dim read it by. */
function panel(name: string, box: Box): HTMLElement {
  const element = document.createElement('div');
  element.setAttribute('data-hud-occlusion', 'true');
  element.setAttribute('data-hud-panel-name', name);
  document.body.appendChild(element);
  return stubRect(element, box);
}

function stage(width: number, height: number): void {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: height, configurable: true });
}

const cell: Cell = {
  id: 4242, born_at_ms: 0, death_at_ms: null, birth_block: 16204800,
  tag: 'wallet', pos_seed: [0, 0, 0],
  out_point: { tx_hash: `0x${'ab'.repeat(32)}`, index: 2 },
  capacity: 12300000000, data_hex: '0x', data_bytes: 0,
  content_hash: `0x${'11'.repeat(32)}`, lock_kind: 'omnilock', asset_kind: 'native',
  lock_shape_seed: [1, 2], type_shape_seed: null, data_shape_seed: [3, 4],
};

/** Mount the card, then declare where it and its window ended up, then let the
 *  sampler run once. The first sample reads jsdom's zero box and marks
 *  nothing, which is the same thing a real card's first frame does before the
 *  solver has placed it. */
function openCard(card: Box, square: Box): void {
  const { container } = render(
    <CellInspectionOverlay
      handles={createCellInspectionHandles()}
      cell={cell}
      recentLinks={[]}
      onClose={() => {}}
    />,
  );
  stubRect(
    container.querySelector('[data-cell-inspection-overlay]') as HTMLElement,
    card,
  );
  stubRect(
    container.querySelector('[data-cell-scan-window="true"]') as HTMLElement,
    square,
  );
  act(() => { vi.advanceTimersByTime(HUD_DIM_SAMPLE_MS); });
}

const dimmedNames = (): string[] => Array.from(
  document.querySelectorAll<HTMLElement>(
    '[data-hud-occlusion="true"][data-hud-dim="true"]',
  ),
  (element) => element.getAttribute('data-hud-panel-name') ?? '?',
);

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('a panel under a card that cannot clear it', () => {
  it('gives way for every panel a compact card stands on at a 434 hole', () => {
    // The 1,000 x 720 stage, measured: the left rail ends at 312, the right
    // rail begins at 746 — a 434 px hole — and the card the ladder hands back
    // is its 640 floor, wider than the stage by 206. Note where the square is:
    // clear of both rails, so A3's rule alone would mark nothing at all here.
    stage(1000, 720);
    panel('chain', { left: 14, top: 76, right: 312, bottom: 302 });
    panel('dao', { left: 14, top: 357.96875, right: 312, bottom: 585.5 });
    panel('pulse', { left: 14, top: 597.5, right: 312, bottom: 706 });
    const cells = panel('cells', { left: 746, top: 76, right: 986, bottom: 187 });
    const peers = panel('peers', { left: 746, top: 199, right: 986, bottom: 290 });
    expect(cellCardStandsOnHud(434)).toBe(true);

    openCard(
      { left: 346, top: 104, right: 986, bottom: 706 },
      { left: 346, top: 104, right: 626, bottom: 384 },
    );

    // CELL·03 and PEER·02, and only those: the card's left edge stands clear
    // of the chain rail's right edge by 34 px, and DAO·05 and PULSE·04 are
    // under it in neither sense.
    expect(dimmedNames()).toEqual(['cells', 'peers']);
    expect(cells.dataset.hudDim).toBe('true');
    expect(peers.dataset.hudDim).toBe('true');
  });

  it('leaves a panel alone at an 802 hole, even under the card', () => {
    // A stage that CAN hold the card (802 of hole against a 728 card), with
    // the card overlapping the chain rail anyway — the placement lock holds a
    // card's offset across a resize, so this is a frame the app really reaches.
    // The assertion is which box gives the panels their orders, not whether
    // the solver would have chosen this one.
    stage(1440, 900);
    const chain = panel('chain', { left: 14, top: 48, right: 384, bottom: 519 });
    const cells = panel('cells', { left: 1186, top: 48, right: 1426, bottom: 159 });
    expect(cellCardStandsOnHud(802)).toBe(false);

    openCard(
      { left: 330, top: 104, right: 1058, bottom: 886 },
      { left: 458, top: 104, right: 738, bottom: 384 },
    );

    // The card covers 54 px of the rail and the rail keeps its light: an
    // opaque card is not read through, and A3's rule reads the window alone.
    expect(dimmedNames()).toEqual([]);
    expect(chain.dataset.hudDim).toBeUndefined();
    expect(cells.dataset.hudDim).toBeUndefined();
  });

  it('dims what the square stands on at a wide hole, and nothing else', () => {
    // A3, unchanged: the 1,920 stage with the card on the left of its anchor,
    // so the transparent window reaches the chain rail. The rail gives way;
    // the right rail, which the card does not reach, does not.
    stage(1920, 993);
    const chain = panel('chain', { left: 14, top: 48, right: 384, bottom: 519.1875 });
    const cells = panel('cells', { left: 1574, top: 48, right: 1906, bottom: 246 });

    openCard(
      { left: 200, top: 104, right: 1056, bottom: 979 },
      { left: 328, top: 104, right: 608, bottom: 384 },
    );

    expect(dimmedNames()).toEqual(['chain']);
    expect(chain.dataset.hudDim).toBe('true');
    expect(cells.dataset.hudDim).toBeUndefined();
  });

  it('gives the light back when the card closes', () => {
    stage(1000, 720);
    panel('chain', { left: 14, top: 76, right: 312, bottom: 302 });
    const cells = panel('cells', { left: 746, top: 76, right: 986, bottom: 187 });
    // PEER·02 is what makes the hole 434 rather than 688: the hole is measured
    // over the stage's middle band, and CELL·03 ends 29 px above it.
    panel('peers', { left: 746, top: 199, right: 986, bottom: 290 });

    openCard(
      { left: 346, top: 104, right: 986, bottom: 706 },
      { left: 346, top: 104, right: 626, bottom: 384 },
    );
    expect(cells.dataset.hudDim).toBe('true');

    act(() => { cleanup(); });
    expect(dimmedNames()).toEqual([]);
  });
});

describe('cellCardStandsOnHud', () => {
  it('turns at the card\'s own floor, not at a window width', () => {
    // 640 is the compact card's floor; a hole of exactly 640 holds it.
    expect(cellCardStandsOnHud(639)).toBe(true);
    expect(cellCardStandsOnHud(640)).toBe(false);
    expect(cellCardStandsOnHud(1190)).toBe(false);
    // A hole nobody has measured yet is not a stage that cannot hold a card.
    expect(cellCardStandsOnHud(Number.NaN)).toBe(false);
  });
});
