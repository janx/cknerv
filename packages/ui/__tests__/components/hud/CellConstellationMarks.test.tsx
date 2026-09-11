import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CellConstellationLeaders } from '../../../src/components/hud/CellConstellationMarks';
import {
  commitConstellationFrame,
  createCellConstellationHandles,
} from '../../../src/components/hud/cellConstellationFrame';
import type { ConstellationSlot } from '../../../src/derives/cellConstellation.derive';
import { HUD_THEME_STYLE_ID, injectHudTheme } from '../../../src/components/hud/hudTheme';
import { RAILS_1180 } from '../../fixtures/cellConstellationMatrix';

afterEach(cleanup);

describe('CellConstellationLeaders', () => {
  it('covers the stage with a masked, non-interactive path layer', () => {
    const handles = createCellConstellationHandles();
    const { container } = render(
      <CellConstellationLeaders handles={handles} slots={['analysis', 'specimen', 'reader']} />,
    );
    const svg = container.querySelector('svg[data-cell-constellation-leaders="true"]');
    expect(svg?.getAttribute('width')).toBe('100%');
    expect(svg?.getAttribute('height')).toBe('100%');
    expect((svg as SVGElement).style.pointerEvents).toBe('none');
    expect(container.querySelector('[data-cell-constellation-mask-cuts="true"]')).not.toBeNull();
    expect(container.querySelectorAll('path')).toHaveLength(6);
    expect(container.querySelectorAll('[data-cell-leader-label]')).toHaveLength(3);
    for (const slot of ['analysis', 'specimen', 'reader']) {
      expect(container.querySelectorAll(`[data-cell-leader-label="${slot}"]`)).toHaveLength(1);
    }
  });

  it('removes the path and label when a module closes', () => {
    const handles = createCellConstellationHandles();
    const { container, rerender } = render(
      <CellConstellationLeaders handles={handles} slots={['analysis', 'specimen']} />,
    );
    rerender(<CellConstellationLeaders handles={handles} slots={['specimen']} />);
    expect(container.querySelector('[data-cell-leader="analysis"]')).toBeNull();
    expect(container.querySelector('[data-cell-leader-label="analysis"]')).toBeNull();
    expect(container.querySelectorAll('[data-cell-leader="specimen"]')).toHaveLength(1);
  });
});

describe('a leader that is only a fallback says so', () => {
  function wired(slots: readonly ConstellationSlot[]) {
    const handles = createCellConstellationHandles();
    for (const [slot, height] of [
      ['analysis', 717], ['specimen', 314], ['reader', 340],
    ] as const) {
      if (!slots.includes(slot)) continue;
      handles.panels[slot].host = document.createElement('div');
      handles.panels[slot].present = true;
      handles.panels[slot].height = height;
    }
    handles.root = document.createElement('div');
    handles.reticle = document.createElement('div');
    handles.chip = document.createElement('div');
    return handles;
  }
  const SLOTS: readonly ConstellationSlot[] = ['analysis', 'specimen', 'reader'];
  const degradedMarks = (container: HTMLElement) => SLOTS.map((slot) =>
    container.querySelector(`[data-cell-leader="${slot}"]`)
      ?.getAttribute('data-cell-leader-degraded'));

  it('marks the leaders the router could not draw, and only those', () => {
    // 1180 x 663 with the measured iPad rails, the Cell at 0.22 of the width:
    // the reticle stands over the left rail and no route leaves it. Every plate
    // still gets its seat and its line — dashed, because the line is a fallback.
    const handles = wired(SLOTS);
    const { container } = render(
      <CellConstellationLeaders handles={handles} slots={SLOTS} />,
    );
    commitConstellationFrame(
      handles, 1180 * 0.22, 663 * 0.25, 1180, 663, 104, 14, RAILS_1180, 1,
    );

    expect(handles.lastLayout?.status).not.toBe('unavailable');
    expect(handles.lastLayout?.leaders).toBe('degraded');
    expect(handles.root?.dataset.cellConstellationLeaders).toBe('degraded');
    expect(degradedMarks(container)).toContain('true');
    for (const slot of SLOTS) {
      const placement = handles.lastLayout?.placements.find((panel) => panel.slot === slot);
      expect(
        container.querySelector(`[data-cell-leader="${slot}"]`)
          ?.getAttribute('data-cell-leader-degraded'),
        slot,
      ).toBe(placement?.route?.degraded ? 'true' : 'false');
    }
  });

  it('leaves a routed leader unmarked, and the same group solid', () => {
    const handles = wired(SLOTS);
    const { container } = render(
      <CellConstellationLeaders handles={handles} slots={SLOTS} />,
    );
    commitConstellationFrame(handles, 960, 540, 1920, 1080, 104, 14, [], 1);

    expect(handles.lastLayout?.leaders).toBe('clean');
    expect(handles.root?.dataset.cellConstellationLeaders).toBe('clean');
    expect(degradedMarks(container)).toEqual(['false', 'false', 'false']);
  });

  it('dashes only the rose stroke of a fallback, in the sheet and not in a render', () => {
    // The dash is one rule keyed on the attribute the writer sets, so switching
    // it never touches React. The near-black stroke beneath stays solid.
    injectHudTheme(document);
    const sheet = document.getElementById(HUD_THEME_STYLE_ID)?.textContent ?? '';
    expect(sheet).toContain(
      '[data-cell-leader-degraded="true"] [data-cell-leader-stroke="over"]{stroke-dasharray:4 3}',
    );
    expect(sheet).not.toContain('[data-cell-leader-stroke="under"]{stroke-dasharray');
  });
});
