// A rail an instrument stands on gives way — and only that rail.
//
// The rule the user ruled on (2026-09-05) was written for one card, which meant
// one box, which meant one question: does the CELL SCAN square print a panel on
// the specimen, or is the whole card standing on the HUD? The instruments came
// apart on 2026-09-10, so the question is per-instrument now: three or four
// boxes scattered around a cell, each claiming what it actually covers.
//
// ⭐ WHY NOT A UNION. The obvious reduction — one rectangle around the lot —
// dims rails that nothing covers, because the constellation deliberately leaves
// the middle of itself empty for the cell. At 1920 the register sits right of
// the cell and the reader below-left; their union spans the whole stage and
// would take the light from both rails while standing on neither.
//
// jsdom lays nothing out, so every box here is declared — the panels' before the
// render, the instruments' after it.
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Cell } from '@cknerv/types';
import CellInspectionOverlay, {
  createCellInspectionHandles,
} from '../../src/components/CellInspectionOverlay';
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

/** A HUD module, with the attribute the dim reads it by. */
function panel(name: string, box: Box): HTMLElement {
  const element = document.createElement('div');
  element.setAttribute('data-hud-occlusion', 'true');
  element.setAttribute('data-hud-panel-name', name);
  document.body.appendChild(element);
  return stubRect(element, box);
}

const cell: Cell = {
  id: 4242, born_at_ms: 0, death_at_ms: null, birth_block: 16204800,
  tag: 'wallet', pos_seed: [0, 0, 0],
  out_point: { tx_hash: `0x${'ab'.repeat(32)}`, index: 2 },
  capacity: 12300000000, data_hex: '0x', data_bytes: 0,
  content_hash: `0x${'11'.repeat(32)}`, lock_kind: 'omnilock', asset_kind: 'native',
  lock_shape_seed: [1, 2], type_shape_seed: null, data_shape_seed: [3, 4],
};

/**
 * Open the constellation, then declare where the walk put each instrument, then
 * let the sampler run once.
 *
 * The first sample reads jsdom's zero boxes and marks nothing, which is exactly
 * what a real first frame does before the walk has placed anything.
 */
function openConstellation(seats: Partial<Record<string, Box>>): HTMLElement {
  const { container } = render(
    <CellInspectionOverlay
      handles={createCellInspectionHandles()}
      cell={cell}
      recentLinks={[]}
      onClose={() => {}}
    />,
  );
  for (const [slot, box] of Object.entries(seats)) {
    const host = container.querySelector<HTMLElement>(
      `[data-cell-constellation-panel="${slot}"]`,
    );
    expect(host, `no ${slot} instrument mounted`).not.toBeNull();
    stubRect(host as HTMLElement, box as Box);
  }
  act(() => { vi.advanceTimersByTime(HUD_DIM_SAMPLE_MS); });
  return container as HTMLElement;
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

describe('a rail an instrument stands on', () => {
  it('gives way for the rail that is covered, and no other', () => {
    // The 1,180 × 688 stage — an 11" iPad in landscape Safari, where the walk
    // has to stand the register on the left rail because the hole is 614 and
    // the register is 440 plus its reach. The specimen and the reader are on
    // the right of the cell, clear of everything.
    panel('chain', { left: 14, top: 48, right: 312, bottom: 282 });
    panel('dao', { left: 14, top: 306, right: 312, bottom: 517 });
    const cells = panel('cells', { left: 926, top: 153, right: 1166, bottom: 266 });

    openConstellation({
      analysis: { left: 14, top: 104, right: 454, bottom: 674 },
      specimen: { left: 758, top: 300, right: 1038, bottom: 608 },
    });

    // CKB·01 and DAO·05 are under the register; CELL·03 is under nothing — the
    // specimen sits below it, and its own box is what answers for it.
    expect(dimmedNames()).toEqual(['chain', 'dao']);
    expect(cells.dataset.hudDim).toBeUndefined();
  });

  it('takes no light for the gap the constellation leaves around the cell', () => {
    // The reduction this rule exists to refuse. At 1,920 the register is right
    // of the cell and the specimen up-left of it; a union rectangle around the
    // two spans 1,238 px and covers both rails, and neither instrument is
    // standing on either.
    const chain = panel('chain', { left: 14, top: 48, right: 384, bottom: 511 });
    const cells = panel('cells', { left: 1574, top: 322, right: 1906, bottom: 522 });

    openConstellation({
      analysis: { left: 1110, top: 190, right: 1550, bottom: 917 },
      specimen: { left: 596, top: 150, right: 876, bottom: 458 },
    });

    expect(dimmedNames()).toEqual([]);
    expect(chain.dataset.hudDim).toBeUndefined();
    expect(cells.dataset.hudDim).toBeUndefined();
  });

  it('answers for the specimen through the instrument that holds it', () => {
    // A3's own case, one layer out. The CELL SCAN window is transparent — the
    // braid is painted in the SCENE, beneath the whole DOM HUD — so a rail
    // between the canvas and it prints across the specimen. The window is
    // inside the specimen's instrument, so the instrument's box is the claim.
    const chain = panel('chain', { left: 14, top: 48, right: 384, bottom: 511 });

    const container = openConstellation({
      specimen: { left: 300, top: 150, right: 580, bottom: 458 },
    });

    expect(container.querySelector('[data-cell-scan-window="true"]')).not.toBeNull();
    expect(dimmedNames()).toEqual(['chain']);
    expect(chain.dataset.hudDim).toBe('true');
  });

  it('gives the light back when the constellation closes', () => {
    const chain = panel('chain', { left: 14, top: 48, right: 384, bottom: 511 });

    openConstellation({
      analysis: { left: 100, top: 104, right: 540, bottom: 700 },
    });
    expect(chain.dataset.hudDim).toBe('true');

    act(() => { cleanup(); });
    expect(dimmedNames()).toEqual([]);
  });
});
