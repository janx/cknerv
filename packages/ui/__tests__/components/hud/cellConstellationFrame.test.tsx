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

  it('returns no specimen while changed geometry keeps the old root hidden', () => {
    const { handles } = wired();
    expect(commit(handles)).not.toBeNull();
    handles.panels.analysis.height += 40;
    let tick = 0;
    const now = () => { tick += 2; return tick; };
    const specimen = advanceConstellationFrame(
      handles, 960, 540, 1920, 1080, SAFE_TOP, EDGE, [], 1, 1, now,
    );
    expect(handles.root?.style.opacity).toBe('0');
    expect(specimen).toBeNull();
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

  it('hides the whole old plate when an anchor enters its panel geometry', () => {
    const { handles } = wired();
    expect(commit(handles)).not.toBeNull();
    const analysis = handles.lastLayout!.placements.find((panel) => panel.slot === 'analysis')!;
    let tick = 0;
    const now = () => { tick += 0.25; return tick; };
    const specimen = advanceConstellationFrame(
      handles,
      analysis.x + analysis.width / 2,
      analysis.y + analysis.height / 2,
      1920, 1080, SAFE_TOP, EDGE, [], 0, 1, now,
    );
    expect(handles.root?.style.opacity).toBe('0');
    expect(specimen).toBeNull();
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
