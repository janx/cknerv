// The channel between the anchor and the instruments, and the two bugs the
// live leg found in it that no unit test could have missed twice.
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Cell } from '@cknerv/types';
import CellDetailPanel from '../../../src/components/hud/CellDetailPanel';
import {
  CONSTELLATION_WIDTH,
  commitConstellationFrame,
  createCellConstellationHandles,
  invalidateConstellationFrame,
  setConstellationVisible,
} from '../../../src/components/hud/cellConstellationFrame';

afterEach(cleanup);

const SAFE_TOP = 104;
const EDGE = 14;

const cell: Cell = {
  id: 4242, born_at_ms: 0, death_at_ms: null, birth_block: 16204800,
  tag: 'wallet', pos_seed: [0, 0, 0],
  out_point: { tx_hash: `0x${'ab'.repeat(32)}`, index: 2 },
  capacity: 12300000000, data_hex: '0xdeadbeefcafe1234567890', data_bytes: 11,
  content_hash: `0x${'11'.repeat(32)}`, lock_kind: 'omnilock', asset_kind: 'xudt',
  lock_shape_seed: [1, 2], type_shape_seed: null, data_shape_seed: [3, 4],
};

function wired() {
  const handles = createCellConstellationHandles();
  const hosts: Record<string, HTMLDivElement> = {};
  for (const slot of ['analysis', 'specimen'] as const) {
    const host = document.createElement('div');
    hosts[slot] = host;
    handles.panels[slot].host = host;
    handles.panels[slot].present = true;
    handles.panels[slot].height = slot === 'analysis' ? 620 : 308;
  }
  handles.root = document.createElement('div');
  handles.reticle = document.createElement('div');
  handles.chip = document.createElement('div');
  for (const slot of ['analysis', 'specimen'] as const) {
    handles.leaders[slot].under = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    handles.leaders[slot].over = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    handles.leaders[slot].dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    handles.leaders[slot].label = document.createElement('span');
  }
  return { handles, hosts };
}

const commit = (handles: ReturnType<typeof wired>['handles'], x = 960, y = 540) =>
  commitConstellationFrame(handles, x, y, 1920, 1080, SAFE_TOP, EDGE, []);

describe('the frame writer', () => {
  it('moves and sizes every instrument, and marks the cell', () => {
    const { handles, hosts } = wired();

    const specimen = commit(handles);

    expect(specimen?.slot).toBe('specimen');
    for (const slot of ['analysis', 'specimen'] as const) {
      expect(hosts[slot].style.transform).toMatch(/^translate3d\(/);
      expect(hosts[slot].style.width).toBe(`${CONSTELLATION_WIDTH[slot]}px`);
      // The height the walk WROTE, which is the asked height or the room the
      // chosen quadrant had — a register in the upper-left of a cell gets what
      // is between the safe top and the field, and scrolls the rest.
      expect(Number.parseFloat(hosts[slot].style.height))
        .toBeLessThanOrEqual(handles.panels[slot].height);
      expect(Number.parseFloat(hosts[slot].style.height)).toBeGreaterThan(0);
      expect(hosts[slot].dataset.cellPanelQuadrant).toMatch(/^(tl|tr|bl|br)$/);
      expect(hosts[slot].dataset.cellPanelCapped).toMatch(/^(true|false)$/);
      const leader = handles.leaders[slot];
      expect(leader.over?.getAttribute('x1')).not.toBeNull();
      expect(leader.dot?.getAttribute('cx')).toBe(leader.over?.getAttribute('x2'));
      expect(leader.label?.style.transform).toMatch(/^translate3d\(/);
    }
    // The window is never capped — a clipped braid is the one thing 280 px of
    // width exists to prevent.
    expect(hosts.specimen.dataset.cellPanelCapped).toBe('false');
    // The reticle is centred on the cell; the chip hangs under it.
    expect(handles.reticle?.style.transform).toBe('translate3d(914px, 494px, 0)');
    expect(handles.chip?.style.transform)
      .toBe('translate3d(960px, 598px, 0) translateX(-50%)');
  });

  it('writes nothing for a constellation that has only drifted', () => {
    const { handles, hosts } = wired();
    commit(handles);
    hosts.analysis.style.transform = 'SENTINEL';

    // Under the half-pixel bucket: the galaxy autorotates, so every coordinate
    // here drifts forever and a gate finer than the eye is a write per frame
    // for as long as an instrument is open.
    commit(handles, 960.2, 540.1);
    expect(hosts.analysis.style.transform).toBe('SENTINEL');

    commit(handles, 980, 540);
    expect(hosts.analysis.style.transform).not.toBe('SENTINEL');
  });

  it('still answers with the specimen seat on a frame it skipped', () => {
    // The portrait channel asks every frame; a gated frame owes it the answer
    // it gave last time rather than nothing, or the braid stops being drawn.
    const { handles } = wired();
    const first = commit(handles);
    expect(commit(handles)).toEqual(first);
  });

  it('caps only what the band cannot hold, and says so on the host', () => {
    const { handles, hosts } = wired();
    handles.panels.analysis.height = 900;
    invalidateConstellationFrame(handles);

    commitConstellationFrame(handles, 580, 360, 1180, 688, SAFE_TOP, EDGE, []);

    expect(Number.parseFloat(hosts.analysis.style.height))
      .toBeLessThanOrEqual(688 - 104 - 14);
    expect(hosts.analysis.dataset.cellPanelCapped).toBe('true');
    expect(hosts.specimen.dataset.cellPanelCapped).toBe('false');
  });
});

describe('the entrance the channel outlives', () => {
  it('asserts opacity on a root that has never been shown', () => {
    const { handles } = wired();

    setConstellationVisible(handles, true);
    expect(handles.root?.style.opacity).toBe('1');
    setConstellationVisible(handles, false);
    expect(handles.root?.style.opacity).toBe('0');
  });

  it('⚠️ writes the answer again when the ELEMENT changed, not just the answer', () => {
    // App creates the channel once and re-uses it for every Cell, so
    // `visible` outlives the element it was true of. React mounts each
    // selection's root at `opacity: 0` and the writer only writes on a change:
    // measured live, the seventh Cell opened placed correctly, sized correctly,
    // tracking its cell correctly, and completely invisible.
    const { handles } = wired();
    setConstellationVisible(handles, true);

    const second = document.createElement('div');
    second.style.opacity = '0';
    handles.root = second;
    handles.visible = false; // what the overlay's own effect does on cell.id

    setConstellationVisible(handles, true);
    expect(second.style.opacity).toBe('1');
  });
});

describe('what an instrument reports about its own height', () => {
  it('⚠️ counts its head and its hairlines, not just its body', () => {
    // The walk writes the number straight onto the host, so it has to be what
    // the WHOLE instrument needs. Measured live at 1920: a 664.6 px register in
    // a 664.6 px host left its scroller 632, and the bottom 33 px of every
    // instrument was clipped silently — an uncapped panel does not scroll.
    const handles = createCellConstellationHandles();
    const { container } = render(
      <CellDetailPanel cell={cell} handles={handles} onClose={() => {}} />,
    );
    const head = container.querySelector('[data-cell-panel-head="analysis"]') as HTMLElement;
    const content = container.querySelector('[data-cell-panel-content="analysis"]') as HTMLElement;
    expect(head).not.toBeNull();
    expect(content).not.toBeNull();

    // jsdom lays nothing out, so both boxes measure zero — what is observable
    // is that the reported height is the SUM plus the plate's two hairlines,
    // and a zero-height body still reports the frame it is drawn in.
    expect(handles.panels.analysis.present).toBe(true);
    expect(handles.panels.analysis.height).toBe(2);
  });
});
