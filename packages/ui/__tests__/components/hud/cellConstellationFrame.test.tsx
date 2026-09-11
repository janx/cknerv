// The channel between the anchor and the instruments, and the two bugs the
// live leg found in it that no unit test could have missed twice.
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Cell } from '@cknerv/types';
import CellDetailPanel from '../../../src/components/hud/CellDetailPanel';
import ConstellationPanel from '../../../src/components/hud/ConstellationPanel';
import {
  CellConstellationLeaders,
  CellReticle,
} from '../../../src/components/hud/CellConstellationMarks';
import {
  CONSTELLATION_WIDTH,
  advanceConstellationFrame,
  commitConstellationFrame,
  createCellConstellationHandles,
  invalidateConstellationFrame,
  setConstellationVisible,
  suspendConstellationFrame,
} from '../../../src/components/hud/cellConstellationFrame';
import {
  resetConstellationWorkStats,
  snapshotConstellationWorkStats,
} from '../../../src/derives/cellConstellation.derive';
import { RAILS_1920 } from '../../fixtures/cellConstellationMatrix';

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
    handles.leaders[slot].under = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    handles.leaders[slot].over = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    handles.leaders[slot].dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    handles.leaders[slot].label = document.createElement('span');
  }
  return { handles, hosts };
}

const commit = (handles: ReturnType<typeof wired>['handles'], x = 960, y = 540) =>
  commitConstellationFrame(handles, x, y, 1920, 1080, SAFE_TOP, EDGE, []);

describe('the frame writer', () => {
  it('does not invalidate geometry when mark components merely rerender', () => {
    const { handles } = wired();
    const view = render(<>
      <CellConstellationLeaders handles={handles} slots={['analysis', 'specimen']} />
      <CellReticle handles={handles} />
    </>);
    handles.layoutKey = 'stable-layout';
    handles.connectorKey = 'stable-connector';

    view.rerender(<>
      <CellConstellationLeaders handles={handles} slots={['analysis', 'specimen']} />
      <CellReticle handles={handles} />
    </>);

    expect(handles.layoutKey).toBe('stable-layout');
    expect(handles.connectorKey).toBe('stable-connector');
  });

  it('mounts replacement leader refs hidden inside an active motion window', () => {
    const { handles } = wired();
    handles.motionSuspended = true;
    const view = render(
      <CellConstellationLeaders handles={handles} slots={['analysis', 'specimen']} />,
    );

    expect(handles.motionSuspended).toBe(true);
    expect(handles.leaders.analysis.under?.style.visibility).toBe('hidden');
    expect(handles.leaders.analysis.over?.style.visibility).toBe('hidden');
    expect(handles.leaders.analysis.dot?.style.visibility).toBe('hidden');
    expect(handles.leaders.analysis.label?.style.visibility).toBe('hidden');

    view.rerender(
      <CellConstellationLeaders handles={handles} slots={['analysis', 'specimen']} />,
    );
    expect(handles.motionSuspended).toBe(true);
    expect(handles.leaders.analysis.label?.style.visibility).toBe('hidden');
  });

  it('slices a frozen canonical solve and coalesces anchor drift without partial publication', () => {
    const { handles } = wired();
    for (const [slot, height] of [['reader', 370], ['trace', 420]] as const) {
      handles.panels[slot].present = true;
      handles.panels[slot].height = height;
    }
    let tick = 0;
    const now = () => { tick += 2; return tick; };
    const advance = (x: number, frame: number) => advanceConstellationFrame(
      handles, x, 331, 1180, 663, SAFE_TOP, EDGE, [], 0, frame, now,
    );

    expect(advance(590, 1)).toBeNull();
    const firstJob = handles.layoutJob;
    expect(firstJob).not.toBeNull();
    expect(handles.lastLayout).toBeNull();
    // Anchor motion updates the desired request but does not restart the
    // expensive first solve. No incomplete layout has reached the handles.
    expect(advance(591, 2)).toBeNull();
    expect(handles.layoutJob).toBe(firstJob);
    expect(handles.lastLayout).toBeNull();

    let specimen = null;
    let provisionalFrames = 0;
    let landedX = 0;
    for (let frame = 3; frame < 80; frame += 1) {
      landedX = 590 + frame;
      specimen = advance(landedX, frame);
      if (handles.provisionalVisible) provisionalFrames += 1;
    }
    expect(specimen?.slot).toBe('specimen');
    expect(provisionalFrames).toBeGreaterThan(0);
    expect(handles.leaders.analysis.over?.style.visibility).toBe('');

    let settleFrame = 80;
    while (!handles.connectorKey.startsWith(`${Math.round(landedX / 0.5)},`)
      && settleFrame < 200) {
      specimen = advance(landedX, settleFrame);
      settleFrame += 1;
    }
    expect(handles.connectorKey.startsWith(`${Math.round(landedX / 0.5)},`)).toBe(true);

    const canonical = createCellConstellationHandles();
    for (const [slot, height] of [
      ['analysis', 620], ['specimen', 308], ['reader', 370], ['trace', 420],
    ] as const) {
      canonical.panels[slot].present = true;
      canonical.panels[slot].height = height;
    }
    commitConstellationFrame(canonical, 590, 331, 1180, 663, SAFE_TOP, EDGE, []);
    commitConstellationFrame(canonical, landedX, 331, 1180, 663, SAFE_TOP, EDGE, []);
    expect(handles.lastLayout).toEqual(canonical.lastLayout);
  });

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
      expect(leader.over?.getAttribute('d')).toMatch(/^M /);
      expect(leader.dot?.getAttribute('cx')).not.toBeNull();
      if (leader.label?.style.display !== 'none') {
        expect(leader.label?.style.transform).toMatch(/^translate3d\(/);
      }
    }
    // The window is never capped — a clipped braid is the one thing 280 px of
    // width exists to prevent.
    expect(hosts.specimen.dataset.cellPanelCapped).toBe('false');
    // The reticle is centred on the cell; the chip hangs under it.
    expect(handles.reticle?.style.transform).toBe('translate3d(914px, 494px, 0)');
    expect(handles.chip?.style.transform)
      .toBe('translate3d(960px, 598px, 0) translateX(-50%)');
  });

  it('keeps panel seats while drift updates the routed leaders', () => {
    const { handles, hosts } = wired();
    commit(handles);
    hosts.analysis.style.transform = 'SENTINEL';
    const before = handles.leaders.analysis.over?.getAttribute('d');

    // Under the half-pixel bucket: the galaxy autorotates, so every coordinate
    // here drifts forever and a gate finer than the eye is a write per frame
    // for as long as an instrument is open.
    commit(handles, 960.2, 540.1);
    expect(hosts.analysis.style.transform).toBe('SENTINEL');

    commit(handles, 980, 540);
    expect(hosts.analysis.style.transform).toBe('SENTINEL');
    expect(handles.leaders.analysis.over?.getAttribute('d')).not.toBe(before);
  });

  it('restores the applied leaders when an in-flight anchor returns to its old bucket', () => {
    const { handles } = wired();
    commit(handles, 960, 540);
    const route = handles.leaders.analysis.over?.getAttribute('d');
    expect(route).toMatch(/^M /);

    let tick = 0;
    const now = () => { tick += 2; return tick; };
    advanceConstellationFrame(
      handles, 980, 540, 1920, 1080, SAFE_TOP, EDGE, [], 0, 1, now,
    );
    expect(handles.leaders.analysis.over?.style.visibility).toBe('');
    expect(handles.leaders.analysis.over?.getAttribute('d')).not.toBe(route);
    const provisionalRoute = handles.leaders.analysis.over?.getAttribute('d');
    handles.provisionalBaseLayout!.placements
      .find((panel) => panel.slot === 'analysis')!.route = undefined;
    advanceConstellationFrame(
      handles, 982, 540, 1920, 1080, SAFE_TOP, EDGE, [], 0, 2, now,
    );
    expect(handles.leaders.analysis.over?.style.visibility).toBe('hidden');
    expect(handles.leaders.analysis.over?.getAttribute('d')).toBe(provisionalRoute);
    expect(handles.presentationDirty).toBe(true);
    advanceConstellationFrame(
      handles, 960, 540, 1920, 1080, SAFE_TOP, EDGE, [], 0, 3, now,
    );
    expect(handles.layoutJob).toBeNull();
    expect(handles.leaders.analysis.over?.style.visibility).toBe('');
    expect(handles.leaders.analysis.over?.getAttribute('d')).toBe(route);
  });

  it('hides every leader label throughout motion and restores the same connector safely', () => {
    const { handles } = wired();
    commit(handles, 960, 540);
    const route = handles.leaders.analysis.over?.getAttribute('d');
    const fallback = document.createElement('span');
    handles.panels.analysis.fallbackLabel = fallback;
    fallback.style.visibility = 'visible';
    resetConstellationWorkStats();

    for (let frame = 0; frame < 20; frame += 1) {
      suspendConstellationFrame(handles, 980 + frame, 540, 1920, 1080, EDGE);
    }
    expect(handles.motionSuspended).toBe(true);
    expect(handles.layoutJob).toBeNull();
    expect(handles.connectorKey).toBe('');
    expect(handles.leaders.analysis.over?.style.visibility).toBe('hidden');
    expect(handles.leaders.analysis.label?.style.visibility).toBe('hidden');
    expect(fallback.style.visibility).toBe('hidden');
    expect(handles.root?.style.opacity).toBe('1');
    expect(handles.reticle?.style.transform).toBe('translate3d(953px, 494px, 0)');
    expect(snapshotConstellationWorkStats()).toEqual({
      fullSolves: 0,
      lockedReuses: 0,
      candidatesBuilt: 0,
      candidatesValidated: 0,
      routeOrders: 0,
      fastRouteAttempts: 0,
      searchedRouteAttempts: 0,
      degradedRoutes: 0,
      routeGridPoints: 0,
      routeCapHits: 0,
      unavailableHolds: 0,
      refineStarts: 0,
      refineLandings: 0,
      refineUpgrades: 0,
      refineDropped: 0,
      seatTweens: 0,
      chipRelocations: 0,
      cursorSlices: 0,
      cursorMaxSliceMs: 0,
      cursorPending: 0,
      cursorCancels: 0,
      cursorForcedCatchUps: 0,
      cursorFullStarts: 0,
      cursorLockedStarts: 0,
      cursorLandings: 0,
      cursorProvisionalFrames: 0,
    });

    // Returning to the exact canonical bucket must stay hidden until the
    // settled call has revalidated it; the cleared connector key prevents the
    // old same-key fast return from leaving it hidden forever.
    suspendConstellationFrame(handles, 960, 540, 1920, 1080, EDGE);
    expect(handles.leaders.analysis.over?.style.visibility).toBe('hidden');
    advanceConstellationFrame(
      handles, 960, 540, 1920, 1080, SAFE_TOP, EDGE, [], 0, 1,
    );
    expect(handles.motionSuspended).toBe(false);
    expect(handles.leaders.analysis.over?.style.visibility).toBe('');
    expect(handles.leaders.analysis.over?.getAttribute('d')).toBe(route);
  });

  it('cancels route work during motion and resolves a panel close after settling', () => {
    const { handles } = wired();
    commit(handles, 960, 540);
    let tick = 0;
    const now = () => { tick += 2; return tick; };
    advanceConstellationFrame(
      handles, 980, 540, 1920, 1080, SAFE_TOP, EDGE, [], 0, 1, now,
    );
    expect(handles.layoutJob).not.toBeNull();

    handles.panels.analysis.present = false;
    handles.panels.analysis.height = 0;
    suspendConstellationFrame(handles, 982, 540, 1920, 1080, EDGE);
    expect(handles.layoutJob).toBeNull();
    expect(handles.leaders.specimen.over?.style.visibility).toBe('hidden');

    let frame = 2;
    while ((!handles.connectorKey || handles.layoutJob) && frame < 80) {
      advanceConstellationFrame(
        handles, 982, 540, 1920, 1080, SAFE_TOP, EDGE, [], 0, frame, now,
      );
      frame += 1;
    }
    expect(frame).toBeLessThan(80);
    expect(handles.lastLayout?.placements.map((panel) => panel.slot)).toEqual(['specimen']);
    expect(handles.leaders.analysis.over?.getAttribute('d')).toBe('');
    expect(handles.leaders.specimen.over?.style.visibility).toBe('');
    expect(handles.root?.style.opacity).toBe('1');
  });

  it('keeps reused panel seats but never reused routes across a new selection', () => {
    const { handles, hosts } = wired();
    commit(handles, 960, 540);
    const oldSeat = hosts.analysis.style.transform;
    const oldRoute = handles.leaders.analysis.over?.getAttribute('d');

    // The App reuses this channel across selected Cells. Invalidation forgets
    // every route signature, while the completed seats remain a usable holding
    // presentation during motion instead of snapping the new dossier to 0,0.
    invalidateConstellationFrame(handles);
    handles.visible = false; // the new overlay root's entrance state
    suspendConstellationFrame(handles, 740, 420, 1920, 1080, EDGE);
    expect(hosts.analysis.style.transform).toBe(oldSeat);
    expect(handles.root?.style.opacity).toBe('1');
    expect(handles.leaders.analysis.over?.style.visibility).toBe('hidden');

    let tick = 0;
    const now = () => { tick += 2; return tick; };
    let frame = 1;
    while ((!handles.connectorKey || handles.layoutJob) && frame < 80) {
      advanceConstellationFrame(
        handles, 740, 420, 1920, 1080, SAFE_TOP, EDGE, [], 0, frame, now,
      );
      frame += 1;
    }
    expect(frame).toBeLessThan(80);
    expect(handles.leaders.analysis.over?.style.visibility).toBe('');
    expect(handles.leaders.analysis.over?.getAttribute('d')).not.toBe(oldRoute);
  });

  it('keeps fresh selection hosts hidden until that exact DOM is positioned', () => {
    const { handles } = wired();
    expect(commit(handles, 960, 540)).not.toBeNull();
    const previousHosts = {
      analysis: handles.panels.analysis.host,
      specimen: handles.panels.specimen.host,
    };
    for (const slot of ['analysis', 'specimen'] as const) {
      const fresh = document.createElement('div');
      fresh.style.visibility = 'hidden';
      handles.panels[slot].host = fresh;
      expect(handles.panels[slot].positionedHost).toBe(previousHosts[slot]);
    }
    invalidateConstellationFrame(handles);
    handles.visible = false;

    // The old layout and portrait coordinates belong to the unmounted hosts.
    // Motion may show the reticle/chip, but must not fade fresh plates in at
    // their CSS origin or keep drawing the old specimen scissor.
    expect(suspendConstellationFrame(handles, 740, 420, 1920, 1080, EDGE)).toBeNull();
    expect(handles.root?.style.opacity).toBe('1');
    expect(handles.reticle?.style.transform).toBe('translate3d(694px, 374px, 0)');
    expect(handles.panels.analysis.host?.style.visibility).toBe('hidden');
    expect(handles.panels.specimen.host?.style.visibility).toBe('hidden');

    let tick = 0;
    const now = () => { tick += 2; return tick; };
    let specimen = null;
    let frame = 1;
    while ((!handles.connectorKey || handles.layoutJob) && frame < 80) {
      specimen = advanceConstellationFrame(
        handles, 740, 420, 1920, 1080, SAFE_TOP, EDGE, [], 0, frame, now,
      );
      frame += 1;
    }
    expect(frame).toBeLessThan(80);
    expect(specimen?.slot).toBe('specimen');
    for (const slot of ['analysis', 'specimen'] as const) {
      const panel = handles.panels[slot];
      expect(panel.positionedHost).toBe(panel.host);
      expect(panel.host?.style.visibility).toBe('visible');
      expect(panel.host?.style.transform).toMatch(/^translate3d\(/);
    }
  });

  it('positions a replacement host even when the connector key is unchanged', () => {
    const { handles } = wired();
    expect(commit(handles, 960, 540)).not.toBeNull();
    const connectorKey = handles.connectorKey;
    const fresh = document.createElement('div');
    fresh.style.visibility = 'hidden';
    handles.panels.analysis.host = fresh;

    // Layout effects normally invalidate the frame when refs change. Keep the
    // old key here to make the writer robust to a same-frame ref replacement.
    expect(commit(handles, 960, 540)).not.toBeNull();
    expect(handles.connectorKey).toBe(connectorKey);
    expect(handles.panels.analysis.positionedHost).toBe(fresh);
    expect(fresh.style.visibility).toBe('visible');
    expect(fresh.style.transform).toMatch(/^translate3d\(/);
  });

  it('releases a positioned host when its panel unmounts', () => {
    const handles = createCellConstellationHandles();
    const view = render(
      <ConstellationPanel
        slot="analysis"
        handles={handles}
        title="SCAN"
        onClose={() => undefined}
        closeTitle="Close"
      >
        body
      </ConstellationPanel>,
    );
    const host = handles.panels.analysis.host;
    expect(host).not.toBeNull();
    handles.panels.analysis.positionedHost = host;

    view.unmount();
    expect(handles.panels.analysis.host).toBeNull();
    expect(handles.panels.analysis.positionedHost).toBeNull();
    expect(handles.panels.analysis.present).toBe(false);
  });

  it('hides only a newly opened slot during motion and seats it after stopping', () => {
    const { handles, hosts } = wired();
    expect(commit(handles)).not.toBeNull();
    const reader = document.createElement('div');
    reader.style.visibility = 'hidden';
    handles.panels.reader.host = reader;
    handles.panels.reader.present = true;
    handles.panels.reader.height = 370;
    invalidateConstellationFrame(handles);

    expect(suspendConstellationFrame(handles, 980, 540, 1920, 1080, EDGE)?.slot)
      .toBe('specimen');
    expect(hosts.analysis.style.visibility).toBe('visible');
    expect(hosts.specimen.style.visibility).toBe('visible');
    expect(reader.style.visibility).toBe('hidden');

    let tick = 0;
    const now = () => { tick += 2; return tick; };
    let frame = 1;
    while ((!handles.connectorKey || handles.layoutJob) && frame < 80) {
      advanceConstellationFrame(
        handles, 980, 540, 1920, 1080, SAFE_TOP, EDGE, [], 0, frame, now,
      );
      frame += 1;
    }
    expect(frame).toBeLessThan(80);
    expect(reader.style.visibility).toBe('visible');
    expect(reader.style.transform).toMatch(/^translate3d\(/);
    expect(handles.panels.reader.positionedHost).toBe(reader);
  });

  it('shows marks but no unplaced panel for a first selection during motion', () => {
    const { handles, hosts } = wired();
    for (const host of Object.values(hosts)) host.style.visibility = 'hidden';

    expect(suspendConstellationFrame(handles, 620, 360, 1280, 800, EDGE)).toBeNull();
    expect(handles.lastLayout).toBeNull();
    expect(handles.root?.style.opacity).toBe('1');
    expect(handles.reticle?.style.transform).toBe('translate3d(574px, 314px, 0)');
    expect(handles.chip?.style.transform).toBe('translate3d(620px, 418px, 0) translateX(-50%)');
    expect(hosts.analysis.style.visibility).toBe('hidden');
    expect(hosts.specimen.style.visibility).toBe('hidden');
  });

  it('clears the portrait seat immediately when specimen closes during motion', () => {
    const { handles } = wired();
    expect(commit(handles)).not.toBeNull();
    handles.panels.specimen.present = false;
    handles.panels.specimen.height = 0;

    expect(suspendConstellationFrame(handles, 970, 540, 1920, 1080, EDGE)).toBeNull();
    expect(handles.leaders.analysis.over?.style.visibility).toBe('hidden');
  });

  it('keeps the root visible and every host seated while a height change re-solves', () => {
    // Until 2026-09-11 this hid the WHOLE root — reticle, chip, plates and the
    // portrait — from the frame a panel's content changed height until the full
    // re-solve landed, which on a four-panel stage was hundreds of frames. A
    // measurement arriving is not a reason to withdraw the reading.
    const { handles, hosts } = wired();
    expect(commit(handles)).not.toBeNull();
    const seats = {
      analysis: hosts.analysis.style.transform,
      specimen: hosts.specimen.style.transform,
    };
    handles.panels.analysis.height += 40;
    let tick = 0;
    const now = () => { tick += 2; return tick; };
    const specimen = advanceConstellationFrame(
      handles, 960, 540, 1920, 1080, SAFE_TOP, EDGE, [], 1, 1, now,
    );
    expect(handles.root?.style.opacity).toBe('1');
    expect(hosts.analysis.style.transform).toBe(seats.analysis);
    expect(hosts.specimen.style.transform).toBe(seats.specimen);
    expect(hosts.analysis.style.visibility).toBe('visible');
    expect(hosts.specimen.style.visibility).toBe('visible');
    expect(specimen?.slot).toBe('specimen');
    // The seats are still honest; the leaders belong to the old anchor and are
    // the one thing that may not be shown.
    expect(handles.leaders.analysis.over?.style.visibility).toBe('hidden');
  });

  it('keeps a geometry-validated presentation visible while a larger viewport resolves', () => {
    const { handles } = wired();
    const original = commitConstellationFrame(
      handles, 720, 450, 1440, 900, SAFE_TOP, EDGE, [], 0,
    );
    expect(original).not.toBeNull();
    let tick = 0;
    const now = () => { tick += 2; return tick; };

    const provisional = advanceConstellationFrame(
      handles, 720, 450, 1920, 1080, SAFE_TOP, EDGE, [], 0, 1, now,
    );

    expect(provisional).not.toBeNull();
    expect(handles.provisionalVisible).toBe(true);
    expect(handles.root?.style.opacity).toBe('1');
    expect(handles.layoutJob).not.toBeNull();
  });

  it('keeps valid plates and the portrait while an old leader cannot be reconnected', () => {
    const { handles, hosts } = wired();
    expect(commit(handles)).not.toBeNull();
    const canonicalPanel = hosts.analysis.style.transform;
    const canonicalRoute = handles.leaders.analysis.over?.getAttribute('d');
    handles.provisionalBaseLayout = structuredClone(handles.lastLayout!);
    const analysis = handles.provisionalBaseLayout!.placements
      .find((panel) => panel.slot === 'analysis')!;
    analysis.x += 2;
    analysis.route = undefined;
    let tick = 0;
    const now = () => { tick += 2; return tick; };

    const specimen = advanceConstellationFrame(
      handles, 962, 540, 1920, 1080, SAFE_TOP, EDGE, [], 0, 1, now,
    );

    expect(specimen?.slot).toBe('specimen');
    expect(handles.root?.style.opacity).toBe('1');
    expect(handles.leaders.analysis.over?.style.visibility).toBe('hidden');
    expect(hosts.analysis.style.transform).not.toBe(canonicalPanel);
    expect(handles.presentationDirty).toBe(true);
    expect(handles.layoutJob).not.toBeNull();

    advanceConstellationFrame(
      handles, 960, 540, 1920, 1080, SAFE_TOP, EDGE, [], 0, 2, now,
    );
    expect(hosts.analysis.style.transform).toBe(canonicalPanel);
    expect(handles.leaders.analysis.over?.getAttribute('d')).toBe(canonicalRoute);
  });

  it('hides only the plate an anchor has walked into, and keeps the rest seated', () => {
    const { handles, hosts } = wired();
    expect(commit(handles)).not.toBeNull();
    const analysis = handles.lastLayout!.placements.find((panel) => panel.slot === 'analysis')!;
    const specimenSeat = hosts.specimen.style.transform;
    let tick = 0;
    const now = () => { tick += 0.25; return tick; };
    const specimen = advanceConstellationFrame(
      handles,
      analysis.x + analysis.width / 2,
      analysis.y + analysis.height / 2,
      1920, 1080, SAFE_TOP, EDGE, [], 0, 1, now,
    );
    // The Cell is now standing inside the register's seat, so that ONE plate is
    // withdrawn. The reticle, the chip and every other instrument stay: the
    // reader's answer has not stopped being true because the camera moved.
    expect(handles.root?.style.opacity).toBe('1');
    expect(hosts.analysis.style.visibility).toBe('hidden');
    expect(hosts.specimen.style.visibility).toBe('visible');
    expect(hosts.specimen.style.transform).toBe(specimenSeat);
    expect(specimen?.slot).toBe('specimen');
  });

  it('invalidates after an in-place HUD rectangle mutation', () => {
    const { handles } = wired();
    const obstacles = [{ left: 10, top: 120, right: 200, bottom: 300 }];
    commitConstellationFrame(handles, 960, 540, 1920, 1080, SAFE_TOP, EDGE, obstacles, 1);
    const before = handles.lastLayout?.masks.map((rect) => rect.right).join(',');
    obstacles[0].right = 260;
    commitConstellationFrame(handles, 960, 540, 1920, 1080, SAFE_TOP, EDGE, obstacles, 2);
    expect(handles.lastLayout?.masks.map((rect) => rect.right).join(',')).not.toBe(before);
  });

  it('updates the reticle and chip after every instrument closes', () => {
    const { handles } = wired();
    commit(handles);
    for (const slot of ['analysis', 'specimen'] as const) {
      handles.panels[slot].present = false;
      handles.panels[slot].height = 0;
    }
    invalidateConstellationFrame(handles);
    expect(commit(handles, 800, 420)).toBeNull();
    expect(handles.reticle?.style.transform).toBe('translate3d(754px, 374px, 0)');
    expect(handles.leaders.analysis.over?.getAttribute('d')).toBe('');
  });

  it('still answers with the specimen seat on a frame it skipped', () => {
    // The portrait channel asks every frame; a gated frame owes it the answer
    // it gave last time rather than nothing, or the braid stops being drawn.
    const { handles } = wired();
    const first = commit(handles);
    handles.leaders.analysis.over?.setAttribute('d', 'SENTINEL');
    expect(commit(handles)).toEqual(first);
    expect(handles.leaders.analysis.over?.getAttribute('d')).toBe('SENTINEL');
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

describe('how long a selection waits for its instruments (F3)', () => {
  it('paints four instruments within three frames on a real clock', () => {
    // Measured 2026-09-11 before P2: a cold four-panel solve cost p99 1,081 ms
    // and up to 3,874 ms, and the writer spends it 1.6 ms at a time, so the
    // reader watched an empty stage for hundreds of frames after opening
    // MEMORY TRACE. The router's caps are what let this land in three.
    //
    // The scenario is the real one: a Cell is already open with three
    // instruments and the reader arms MEMORY TRACE. The three frames are
    // counted from the moment the fourth plate reports its height.
    //
    // Best of three attempts, for the same reason the sweep gate takes the
    // cheaper of two solves: the writer spends a REAL clock against a fixed
    // per-frame allowance, so on a busy machine this counts the scheduler as
    // much as the work.
    //
    // The target is three frames; the gate is twenty. That gap is measurement,
    // not slack. The writer's first three frames are worth 1.6 + 1.6 + 8 =
    // 11.2 ms of slicing and this exact solve measured 10.3 ms at its cheapest
    // on 2026-09-12, so it lands on the third frame when the machine is quiet.
    // Under load average 24 it took four; inside a full parallel `pnpm test`,
    // seven. None of those is a statement about the code, and a gate that
    // cannot tell them apart must not pretend to. What it can tell apart is
    // the regression the review found: p99 1,081 ms and up to 3,874 ms, which
    // is HUNDREDS of frames of empty stage after arming MEMORY TRACE.
    const attempt = (): number => {
      const handles = createCellConstellationHandles();
      for (const [slot, height] of [
        ['analysis', 717], ['specimen', 314], ['reader', 340], ['trace', 420],
      ] as const) {
        handles.panels[slot].host = document.createElement('div');
        handles.panels[slot].present = slot !== 'trace';
        handles.panels[slot].height = slot === 'trace' ? 0 : height;
      }
      handles.root = document.createElement('div');
      handles.reticle = document.createElement('div');
      handles.chip = document.createElement('div');
      let frame = 0;
      while (handles.lastLayout === null && frame < 60) {
        frame += 1;
        advanceConstellationFrame(
          handles, 960, 540, 1920, 1080, SAFE_TOP, EDGE, RAILS_1920, 0, frame,
        );
      }
      expect(handles.lastLayout?.placements).toHaveLength(3);

      handles.panels.trace.present = true;
      handles.panels.trace.height = 420;
      let waited = 0;
      while (handles.lastLayout?.placements.length !== 4 && waited < 60) {
        waited += 1;
        frame += 1;
        advanceConstellationFrame(
          handles, 960, 540, 1920, 1080, SAFE_TOP, EDGE, RAILS_1920, 0, frame,
        );
      }
      expect(handles.lastLayout?.placements).toHaveLength(4);
      return waited;
    };
    const waits = [attempt(), attempt(), attempt()];
    expect(Math.min(...waits), `frames to four instruments: ${waits.join(', ')}`)
      .toBeLessThanOrEqual(20);
  });
});

describe('a stage with no legal seat is quiet (F2)', () => {
  function tiny() {
    const handles = createCellConstellationHandles();
    for (const [slot, height] of [
      ['analysis', 620], ['specimen', 308], ['reader', 340],
    ] as const) {
      handles.panels[slot].host = document.createElement('div');
      handles.panels[slot].present = true;
      handles.panels[slot].height = height;
    }
    handles.root = document.createElement('div');
    handles.reticle = document.createElement('div');
    handles.chip = document.createElement('div');
    return handles;
  }

  it('lands once, holds, and never blinks the root', () => {
    // Measured 2026-09-11 on 640 × 480 over 240 frames: 80 full solves, 80
    // landings and 159 root opacity flips at a STANDING anchor. The verdict was
    // reached and then thrown away every frame, because an `unavailable`
    // landing leaves no positioned host and the writer read that as "not
    // published yet". A stage with no room says so once.
    const handles = tiny();
    resetConstellationWorkStats();
    let tick = 0;
    const now = () => { tick += 0.4; return tick; };
    const opacities: string[] = [];
    let flips = 0;
    for (let frame = 1; frame <= 240; frame += 1) {
      advanceConstellationFrame(handles, 320, 240, 640, 480, SAFE_TOP, EDGE, [], 0, frame, now);
      const opacity = handles.root!.style.opacity;
      if (opacities.length && opacities[opacities.length - 1] !== opacity) flips += 1;
      opacities.push(opacity);
    }
    const stats = snapshotConstellationWorkStats();
    expect(handles.root?.dataset.cellConstellationStatus).toBe('unavailable');
    expect(handles.lastLayout?.placements).toHaveLength(0);
    // At most one full solve per sixty frames.
    expect(stats.fullSolves).toBeLessThanOrEqual(4);
    expect(flips).toBe(0);
    expect(handles.root?.style.opacity).toBe('1');
    // …and the two marks that say WHICH Cell this is keep tracking it.
    expect(handles.reticle?.style.transform).toBe('translate3d(274px, 194px, 0)');
    expect(handles.chip?.style.transform).toBe('translate3d(320px, 298px, 0) translateX(-50%)');
  });

  it('re-solves once the cell has genuinely moved on', () => {
    const handles = tiny();
    let tick = 0;
    const now = () => { tick += 0.4; return tick; };
    for (let frame = 1; frame <= 120; frame += 1) {
      advanceConstellationFrame(handles, 320, 240, 640, 480, SAFE_TOP, EDGE, [], 0, frame, now);
    }
    resetConstellationWorkStats();
    for (let frame = 121; frame <= 240; frame += 1) {
      advanceConstellationFrame(handles, 420, 240, 640, 480, SAFE_TOP, EDGE, [], 0, frame, now);
    }
    expect(snapshotConstellationWorkStats().fullSolves).toBeGreaterThanOrEqual(1);
    expect(handles.reticle?.style.transform).toBe('translate3d(374px, 194px, 0)');
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

describe('a dossier with no frame writer', () => {
  it('stands its plates in flow, visible, instead of waiting for a seat', () => {
    // The review labs and the component tests render CellDetailPanel with no
    // channel handed in, so nothing will ever seat its hosts. Since 1901530d a
    // fresh host waits at `visibility: hidden` for the writer to place that
    // exact DOM node — correct on the stage, and a dossier nobody can see in
    // a lab. A detached channel says nobody is coming, and the plates stand.
    const { container } = render(<CellDetailPanel cell={cell} onClose={() => {}} />);
    const hosts = Array.from(container.querySelectorAll<HTMLElement>('[data-cell-constellation-panel]'));
    expect(hosts.length).toBeGreaterThan(0);
    for (const host of hosts) {
      expect(host.style.visibility).toBe('visible');
      expect(host.style.position).toBe('relative');
    }
  });

  it('keeps a live channel hidden until the writer seats that host', () => {
    const handles = createCellConstellationHandles();
    const { container } = render(<CellDetailPanel cell={cell} handles={handles} onClose={() => {}} />);
    const host = container.querySelector<HTMLElement>('[data-cell-constellation-panel="analysis"]');
    expect(host?.style.visibility).toBe('hidden');
    expect(handles.detached).toBe(false);
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

describe('what the writer asks for, and how often (P2)', () => {
  it('asks the same question with the same object when nothing moved', () => {
    // The request carried four signature strings and a copy of every panel,
    // rebuilt on every frame of a Cell that was standing still. Nothing about
    // that frame had changed, so nothing about the request had either.
    const { handles } = wired();
    commit(handles, 960, 540);
    const first = handles.lastRequest;
    expect(first).not.toBeNull();

    commit(handles, 960, 540);
    expect(handles.lastRequest).toBe(first);

    // Inside the half-pixel bucket the request still stands — but the reticle
    // is written from the live anchor, not from the request's.
    commit(handles, 960.2, 540);
    expect(handles.lastRequest).toBe(first);
    expect(handles.reticle?.style.transform).toBe('translate3d(914.2px, 494px, 0)');

    // A measured height is a new question.
    handles.panels.analysis.height += 1;
    commit(handles, 960, 540);
    expect(handles.lastRequest).not.toBe(first);
  });

  it('drops the held request when the channel is invalidated', () => {
    // The request carries a clone of the private lock, and the overlay resets
    // that lock in the same breath as it invalidates the frame.
    const { handles } = wired();
    commit(handles, 960, 540);
    expect(handles.lastRequest).not.toBeNull();
    invalidateConstellationFrame(handles);
    expect(handles.lastRequest).toBeNull();
  });

  it('counts the frames it held an empty verdict on', () => {
    const handles = createCellConstellationHandles();
    for (const [slot, height] of [
      ['analysis', 620], ['specimen', 308], ['reader', 340],
    ] as const) {
      handles.panels[slot].host = document.createElement('div');
      handles.panels[slot].present = true;
      handles.panels[slot].height = height;
    }
    handles.root = document.createElement('div');
    handles.reticle = document.createElement('div');
    handles.chip = document.createElement('div');
    resetConstellationWorkStats();
    let tick = 0;
    const now = () => { tick += 0.4; return tick; };
    for (let frame = 1; frame <= 60; frame += 1) {
      advanceConstellationFrame(handles, 320, 240, 640, 480, SAFE_TOP, EDGE, [], 0, frame, now);
    }
    const stats = snapshotConstellationWorkStats();
    expect(stats.fullSolves).toBe(1);
    // One verdict, and every frame after the couple it took to reach it is a
    // hold. Measured 2026-09-11 before P1: 20 full solves per 60 frames.
    expect(stats.unavailableHolds).toBeGreaterThanOrEqual(55);
    expect(stats.unavailableHolds).toBeLessThanOrEqual(59);
  });
});

describe('a second look at the leaders first paint could not draw (P2b)', () => {
  // The stage this is about is the shipping desktop one. P2's router caps
  // brought a four-panel first paint from seconds to milliseconds and cost
  // twelve of the 149 clean matrix leaders their canonical route; ten of the
  // twelve are 1920-wide under the HUD rails at the 0.22 and 0.78 anchors.
  // The refinement is what gives them back, after the reader already has a
  // constellation to look at.
  function railed(
    stageHeight: number,
    slots: ReadonlyArray<readonly [string, number]> = [
      ['analysis', 717], ['specimen', 314], ['reader', 340],
    ],
  ) {
    const handles = createCellConstellationHandles();
    for (const [slot, height] of slots) {
      handles.panels[slot].host = document.createElement('div');
      handles.panels[slot].present = true;
      handles.panels[slot].height = height;
      handles.leaders[slot].group = document.createElementNS(
        'http://www.w3.org/2000/svg', 'g',
      ) as SVGGElement;
      handles.leaders[slot].under = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      handles.leaders[slot].over = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      handles.leaders[slot].dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      handles.leaders[slot].label = document.createElement('span');
    }
    handles.root = document.createElement('div');
    handles.reticle = document.createElement('div');
    handles.chip = document.createElement('div');
    // The measured chip, so this writer run reproduces the matrix case of the
    // same name exactly — the oracle and this test are looking at one picture.
    handles.chipWidth = 376;
    handles.chipHeight = 24;
    return { handles, stageHeight };
  }

  /**
   * One frame on a clock that ticks a whole millisecond per reading, so the
   * 1.6 ms slice buys exactly two steps of the cursor whatever the machine is
   * doing. The tests that need a refinement to still be IN FLIGHT on the next
   * frame use this; a real clock would let a fast machine finish a 5 ms search
   * inside one 1.6 ms slice and there would be nothing left to cancel.
   */
  function crawl(
    handles: ReturnType<typeof railed>['handles'],
    anchorX: number, anchorY: number, stageHeight: number, frame: number,
  ): void {
    let tick = 0;
    advanceConstellationFrame(
      handles, anchorX, anchorY, 1920, stageHeight, SAFE_TOP, EDGE, RAILS_1920, 0, frame,
      () => { tick += 1; return tick; },
    );
  }

  /** Frames until `done`, driving the writer on a real clock. */
  function run(
    handles: ReturnType<typeof railed>['handles'],
    anchorX: number, anchorY: number, stageHeight: number,
    limit: number, done: () => boolean, from = 0,
  ): number {
    let frame = from;
    while (!done() && frame - from < limit) {
      frame += 1;
      advanceConstellationFrame(
        handles, anchorX, anchorY, 1920, stageHeight, SAFE_TOP, EDGE, RAILS_1920, 0, frame,
      );
    }
    return frame;
  }

  it('paints a fallback leader first and replaces it with a real one', () => {
    // 1920x920 under the rails at 0.78, 0.25 — `1920x920@0.78,0.25 n3 rails`,
    // one of the twelve. First paint routes two of the three plates and the
    // third takes the dashed fallback; the refinement finds the third line in
    // 30,912 grid points, about 5.5 ms of search on a quiet machine, spent
    // 1.6 ms at a time behind a constellation that is already on screen.
    const { handles, stageHeight } = railed(920);
    const anchorX = 1920 * 0.78; const anchorY = 920 * 0.25;
    resetConstellationWorkStats();
    // The first-paint gate is twenty frames and the target is three, for the
    // reason the four-panel gate beside it carries: the writer spends a REAL
    // clock against a fixed per-frame allowance, so on a loaded machine this
    // counts the scheduler. Three-panel solves measured 7 ms at their dearest
    // on 2026-09-12, against 1.6 + 1.6 + 8 ms of slicing in three frames.
    const painted = run(handles, anchorX, anchorY, stageHeight, 20,
      () => handles.lastLayout !== null);
    expect(painted, `frames to first paint: ${painted}`).toBeLessThanOrEqual(20);
    expect(handles.lastLayout?.placements).toHaveLength(3);
    expect(handles.lastLayout?.leaders).toBe('degraded');
    expect(handles.root?.dataset.cellConstellationLeaders).toBe('degraded');
    const fallbacks = ['analysis', 'specimen', 'reader'].filter(
      (slot) => handles.leaders[slot].group?.dataset.cellLeaderDegraded === 'true',
    );
    expect(fallbacks).toHaveLength(1);
    const dashed = fallbacks[0];
    const before = handles.leaders[dashed].over?.getAttribute('d');
    const seats = handles.lastLayout?.placements.map(
      (panel) => `${panel.slot}:${panel.x},${panel.y},${panel.width},${panel.height}`,
    );
    const hosts = ['analysis', 'specimen', 'reader'].map(
      (slot) => handles.panels[slot].host?.style.transform,
    );

    const settled = run(handles, anchorX, anchorY, stageHeight, 60,
      () => handles.lastLayout?.leaders === 'clean', painted);
    expect(handles.lastLayout?.leaders, `frames to a clean leader set: ${settled - painted}`)
      .toBe('clean');
    expect(settled - painted).toBeLessThanOrEqual(60);
    const stats = snapshotConstellationWorkStats();
    expect(stats.refineStarts).toBe(1);
    expect(stats.refineLandings).toBe(1);
    expect(stats.refineUpgrades).toBe(1);
    expect(stats.refineDropped).toBe(0);
    // The picture changed where it had to and nowhere else.
    expect(handles.root?.dataset.cellConstellationLeaders).toBe('clean');
    expect(handles.leaders[dashed].group?.dataset.cellLeaderDegraded).toBe('false');
    expect(handles.leaders[dashed].over?.getAttribute('d')).not.toBe(before);
    // Not one seat moved, and no host was written to.
    expect(handles.lastLayout?.placements.map(
      (panel) => `${panel.slot}:${panel.x},${panel.y},${panel.width},${panel.height}`,
    )).toEqual(seats);
    expect(['analysis', 'specimen', 'reader'].map(
      (slot) => handles.panels[slot].host?.style.transform,
    )).toEqual(hosts);
  });

  it('never moves a seat, and stops asking once it has answered', () => {
    // 1920x1080 under the rails at 0.22, 0.25 — also one of the twelve, and
    // the one that proves the seat rule. Its refinement walks all six orders
    // and finds nothing: at the seats P2's first paint chose there IS no clean
    // route, and P1's clean answer lived at DIFFERENT seats, which a refinement
    // may not go and get. What it must do is finish, change nothing, and not
    // ask again.
    const { handles, stageHeight } = railed(1080);
    const anchorX = 1920 * 0.22; const anchorY = 1080 * 0.25;
    resetConstellationWorkStats();
    const painted = run(handles, anchorX, anchorY, stageHeight, 20,
      () => handles.lastLayout !== null);
    expect(handles.lastLayout?.leaders).toBe('degraded');
    const seats = handles.lastLayout?.placements.map(
      (panel) => `${panel.slot}:${panel.x},${panel.y},${panel.width},${panel.height}`,
    );
    const hosts = ['analysis', 'specimen', 'reader'].map(
      (slot) => handles.panels[slot].host?.style.transform,
    );
    run(handles, anchorX, anchorY, stageHeight, 90,
      () => snapshotConstellationWorkStats().refineStarts > 0
        && handles.refineJob === null, painted);
    const stats = snapshotConstellationWorkStats();
    expect(stats.refineStarts).toBe(1);
    expect(stats.refineLandings).toBe(0);
    expect(stats.refineDropped).toBe(0);
    expect(handles.lastLayout?.leaders).toBe('degraded');
    expect(handles.lastLayout?.placements.map(
      (panel) => `${panel.slot}:${panel.x},${panel.y},${panel.width},${panel.height}`,
    )).toEqual(seats);
    expect(['analysis', 'specimen', 'reader'].map(
      (slot) => handles.panels[slot].host?.style.transform,
    )).toEqual(hosts);
    // Thirty more settled frames, and it does not start over.
    for (let frame = 0; frame < 30; frame += 1) {
      advanceConstellationFrame(
        handles, anchorX, anchorY, 1920, stageHeight, SAFE_TOP, EDGE, RAILS_1920, 0,
        painted + 200 + frame,
      );
    }
    expect(snapshotConstellationWorkStats().refineStarts).toBe(1);
  });

  /**
   * `1920x920@0.78,0.25 n3 rails` — one of the twelve leaders P2's caps cost —
   * with the Cell drifting for the whole run. `perFrame` is the drift and
   * `clock` decides whether a frame's work is measured honestly or a whole
   * millisecond per reading, which is how a refinement is kept in flight.
   */
  function drifter(stageHeight: number, handles: ReturnType<typeof railed>['handles']) {
    const anchorY = 920 * 0.25;
    let anchorX = 1920 * 0.78;
    let resolves = 0;
    const step = (perFrame: number, frame: number, real: boolean): void => {
      anchorX += perFrame;
      // The anchor moves every frame, so the request has to be rebuilt every
      // frame; inside a half-pixel bucket the writer would otherwise hand back
      // the one it has.
      handles.lastRequest = null;
      const before = handles.connectorKey;
      let tick = 0;
      advanceConstellationFrame(
        handles, anchorX, anchorY, 1920, stageHeight, SAFE_TOP, EDGE, RAILS_1920, 0, frame,
        real ? undefined : () => { tick += 1; return tick; },
      );
      if (before && handles.connectorKey !== before) resolves += 1;
    };
    const until = (
      perFrame: number, limit: number, done: () => boolean, from: number, real = true,
    ): number => {
      let frame = from;
      while (!done() && frame - from < limit) { frame += 1; step(perFrame, frame, real); }
      return frame;
    };
    return {
      until, step,
      get anchorX() { return anchorX; },
      get resolves() { return resolves; },
    };
  }

  it('keeps looking while the canopy turns the cell under it', () => {
    // The galaxy never stops: a selected Cell's canopy turns at 12 %, so the
    // anchor drifts about 0.07 px a frame for as long as the reader reads, and
    // crosses a half-pixel bucket every seventh frame or so. A refinement gated
    // on a still anchor would never get the frames it needs, and the dashed
    // leader it exists to take back would survive every reading.
    const { handles, stageHeight } = railed(920);
    const cell = drifter(stageHeight, handles);
    resetConstellationWorkStats();
    const painted = cell.until(0.07, 20, () => handles.lastLayout !== null, 0);
    expect(handles.lastLayout?.leaders).toBe('degraded');
    const seats = handles.lastLayout?.placements.map(
      (panel) => `${panel.slot}:${panel.x},${panel.y},${panel.width},${panel.height}`,
    );
    const settled = cell.until(
      0.07, 60, () => handles.lastLayout?.leaders === 'clean', painted,
    );
    expect(handles.lastLayout?.leaders, `frames: ${settled - painted}`).toBe('clean');
    expect(settled - painted).toBeLessThanOrEqual(60);
    const stats = snapshotConstellationWorkStats();
    expect(stats.refineStarts).toBe(1);
    expect(stats.refineLandings).toBe(1);
    expect(stats.refineUpgrades).toBe(1);
    expect(stats.refineDropped).toBe(0);
    // Not one seat moved while it looked.
    expect(handles.lastLayout?.placements.map(
      (panel) => `${panel.slot}:${panel.x},${panel.y},${panel.width},${panel.height}`,
    )).toEqual(seats);
    // And every leader starts at an outlet of the anchor the reticle is on NOW,
    // not the one the refinement was routed for several pixels ago.
    const outlets = new Set([
      cell.anchorX + 52, cell.anchorX - 52, cell.anchorX - 18, cell.anchorX + 18,
    ].map((value) => value.toFixed(4)));
    for (const placement of handles.lastLayout?.placements ?? []) {
      expect(outlets.has(placement.route!.points[0].x.toFixed(4)),
        `${placement.slot} starts at ${placement.route!.points[0].x}`).toBe(true);
    }
  });

  it('survives the locked re-solves a drifting cell runs under it', () => {
    // The mechanism the test above depends on, made deterministic. At 0.6 px a
    // frame — a slow orbit, and what probe I drifts at — EVERY frame leaves the
    // settled branch, runs a locked solve and lands the same seats again. The
    // refinement is started once, before the drift begins, on the clock that
    // ticks a whole millisecond a reading so it is certainly still in flight;
    // then it crosses one of those frames per drifting frame. If a locked
    // re-solve cancelled it, the next frame would start a second one.
    const { handles, stageHeight } = railed(920);
    const cell = drifter(stageHeight, handles);
    resetConstellationWorkStats();
    const painted = cell.until(0, 20, () => handles.lastLayout !== null, 0);
    expect(handles.lastLayout?.leaders).toBe('degraded');
    cell.step(0, painted + 1, false);
    expect(handles.refineJob).not.toBeNull();
    expect(cell.resolves).toBe(0);
    const settled = cell.until(
      0.6, 60, () => handles.lastLayout?.leaders === 'clean', painted + 1,
    );
    expect(handles.lastLayout?.leaders, `frames: ${settled - painted}`).toBe('clean');
    expect(cell.resolves, 'locked re-solves while it looked').toBeGreaterThan(0);
    const stats = snapshotConstellationWorkStats();
    expect(stats.refineStarts).toBe(1);
    expect(stats.refineLandings).toBe(1);
    expect(stats.refineUpgrades).toBe(1);
    expect(stats.refineDropped).toBe(0);
  });

  it('carries a refinement that finished after the cell drifted inside its bucket', () => {
    const { handles, stageHeight } = railed(920);
    const anchorX = 1920 * 0.78; const anchorY = 920 * 0.25;
    resetConstellationWorkStats();
    const painted = run(handles, anchorX, anchorY, stageHeight, 20,
      () => handles.lastLayout !== null);
    // One frame of refinement, then the Cell moves a fifth of a pixel: the same
    // half-pixel bucket, so the same connector key and no new solve, but the
    // routes now being searched belong to an anchor the reticle has left.
    crawl(handles, anchorX, anchorY, stageHeight, painted + 1);
    expect(handles.refineJob).not.toBeNull();
    const drifted = anchorX + 0.2;
    // The request is only rebuilt when something it describes changed; drop it
    // so this frame carries the moved anchor into a new one.
    handles.lastRequest = null;
    const landed = run(handles, drifted, anchorY, stageHeight, 60,
      () => handles.lastLayout?.leaders === 'clean', painted + 1);
    const stats = snapshotConstellationWorkStats();
    expect(stats.refineLandings, `frames: ${landed - painted}`).toBe(1);
    expect(stats.refineDropped).toBe(0);
    expect(handles.lastLayout?.leaders).toBe('clean');
    // Every leader starts at an outlet of the anchor the reticle is on NOW.
    const outlets = new Set([
      drifted + 52, drifted - 52, drifted - 18, drifted + 18,
    ].map((value) => value.toFixed(4)));
    for (const placement of handles.lastLayout?.placements ?? []) {
      expect(outlets.has(placement.route!.points[0].x.toFixed(4)),
        `${placement.slot} starts at ${placement.route!.points[0].x}`).toBe(true);
    }
  });

  it('drops a refinement when the cell leaves the picture it was routed for', () => {
    const { handles, stageHeight } = railed(920);
    const anchorX = 1920 * 0.78; const anchorY = 920 * 0.25;
    resetConstellationWorkStats();
    const painted = run(handles, anchorX, anchorY, stageHeight, 20,
      () => handles.lastLayout !== null);
    crawl(handles, anchorX, anchorY, stageHeight, painted + 1);
    expect(handles.refineJob).not.toBeNull();
    // Past the 160 px hold radius: a new solve owns this frame.
    advanceConstellationFrame(
      handles, anchorX - 400, anchorY, 1920, stageHeight, SAFE_TOP, EDGE, RAILS_1920, 0,
      painted + 2,
    );
    expect(handles.refineJob).toBeNull();
    const stats = snapshotConstellationWorkStats();
    expect(stats.refineStarts).toBe(1);
    expect(stats.refineLandings).toBe(0);
    expect(stats.refineDropped).toBe(0);
    expect(stats.refineUpgrades).toBe(0);
  });

  it('drops a refinement when an instrument changes height under it', () => {
    const { handles, stageHeight } = railed(920);
    const anchorX = 1920 * 0.78; const anchorY = 920 * 0.25;
    resetConstellationWorkStats();
    const painted = run(handles, anchorX, anchorY, stageHeight, 20,
      () => handles.lastLayout !== null);
    crawl(handles, anchorX, anchorY, stageHeight, painted + 1);
    expect(handles.refineJob).not.toBeNull();
    handles.panels.reader.height = 380;
    advanceConstellationFrame(
      handles, anchorX, anchorY, 1920, stageHeight, SAFE_TOP, EDGE, RAILS_1920, 0, painted + 2,
    );
    expect(handles.refineJob).toBeNull();
    expect(snapshotConstellationWorkStats().refineLandings).toBe(0);
  });

  it('drops a refinement when the channel is invalidated or the camera moves', () => {
    for (const stop of ['invalidate', 'motion'] as const) {
      const { handles, stageHeight } = railed(920);
      const anchorX = 1920 * 0.78; const anchorY = 920 * 0.25;
      resetConstellationWorkStats();
      const painted = run(handles, anchorX, anchorY, stageHeight, 20,
        () => handles.lastLayout !== null);
      crawl(handles, anchorX, anchorY, stageHeight, painted + 1);
      expect(handles.refineJob, stop).not.toBeNull();
      if (stop === 'invalidate') invalidateConstellationFrame(handles);
      else suspendConstellationFrame(handles, anchorX, anchorY, 1920, stageHeight, EDGE);
      expect(handles.refineJob, stop).toBeNull();
      expect(snapshotConstellationWorkStats().refineLandings, stop).toBe(0);
    }
  });
});
