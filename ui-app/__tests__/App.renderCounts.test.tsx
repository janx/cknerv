// What App's fan-out actually costs, counted rather than argued.
//
// `App.sceneRoots.test.tsx` reads the source and pins the SHAPE of the memo
// contract — hoisted overlays, honest dep lists, refs where a per-block scalar
// would otherwise travel as a prop. It cannot see the one thing that decides
// whether any of it works: whether the memo bails. One fresh object per App
// render defeats every `memo` below it silently — nothing throws, nothing
// warns, the roots simply keep re-running — and the only instrument that sees
// it is a render count.
//
// So: the real App, the real reducers, the real publish paths, with each root
// replaced by a `memo` that records why it re-rendered. An idle poll must
// reach no scene root at all; a block must reach each of them once, for the
// pulse, and for nothing else.

import { cleanup, render, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@react-three/fiber', async () => (
  await import('./helpers/appHarness')
).fiberMock());
vi.mock('@react-three/drei', async () => (
  await import('./helpers/appHarness')
).dreiMock());
vi.mock('@cknerv/ui', async (importOriginal) => (
  await import('./helpers/appHarness')
).uiMock(await importOriginal() as Record<string, unknown>));
vi.mock('@cknerv/cache', async (importOriginal) => (
  await import('./helpers/appHarness')
).cacheMock(await importOriginal() as Record<string, unknown>));
vi.mock('../src/connect', async (importOriginal) => (
  await import('./helpers/appHarness')
).connectMock(await importOriginal() as Record<string, unknown>));
vi.mock('../src/Tweaks', async () => (
  await import('./helpers/appHarness')
).tweaksMock());
vi.mock('../src/Jukebox', async () => (
  await import('./helpers/appHarness')
).jukeboxMock());

import { livePulseDepartureDelayS } from '@cknerv/ui';
import App from '../src/App';
import {
  resetTweaksPanelForTest,
  toggleTweaksPanel,
} from '../src/tweaks-panel';
import {
  appProps,
  cellSemantics,
  disableEnrichment,
  enableEnrichment,
  mempoolTick,
  peersPoll,
  pushBlock,
  pushChain,
  pushHealth,
  renderCount,
  renderSummary,
  resetHarness,
  resetRenders,
  propOf,
  pushSemantics,
  renderReasons,
  seedCaches,
  selectCell,
  sourceStatus,
  useRealNodeHealth,
  KNOWN_PRODUCERS,
} from './helpers/appHarness';

/** Mount, let the connectors open and the camera frame land, then start
 *  counting from the standing tree. */
async function mountApp(options: {
  /** Open a Cell card before the window opens. */
  card?: number | null;
  /** Run the REAL node-health poll at this cadence instead of the capture-
   *  only stand-in; the caller owns `fetch` and the clock. */
  nodeHealthPollMs?: number;
} = {}) {
  resetHarness();
  seedCaches();
  if (options.nodeHealthPollMs !== undefined) {
    useRealNodeHealth(options.nodeHealthPollMs);
  }
  render(<App {...appProps()} />);
  await act(async () => { await Promise.resolve(); });
  if (options.card != null) await selectCell(options.card);
  resetRenders();
}

beforeEach(() => { resetHarness(); disableEnrichment(); });
afterEach(() => { cleanup(); resetHarness(); disableEnrichment(); });

/** Every root a memo is supposed to hold. The dossier is only mounted with a
 *  card open, so it counts 0 either way when the contract holds. */
const ROOTS = ['CellGalaxy', 'NetworkColony', 'CellInspectionOverlay'] as const;

describe.each([
  ['at rest', null],
  ['with a Cell card open', 1],
] as const)('the idle polls reach no scene root (%s)', (_label, card) => {
  it('holds every root through three mempool ticks', async () => {
    await mountApp({ card });

    for (let i = 0; i < 3; i += 1) await pushChain(mempoolTick(i + 1));

    // The HUD prints the mempool, so it renders; nothing below it does.
    expect(renderCount('HudOverlay'), renderSummary()).toBe(3);
    for (const root of ROOTS) {
      expect(renderCount(root), renderSummary()).toBe(0);
    }
  });

  it('holds every root through three peers polls', async () => {
    await mountApp({ card });

    for (let i = 0; i < 3; i += 1) await pushChain(peersPoll());

    expect(renderCount('HudOverlay'), renderSummary()).toBe(3);
    for (const root of ROOTS) {
      expect(renderCount(root), renderSummary()).toBe(0);
    }
  });

  it('holds every root through three node-health polls', async () => {
    await mountApp({ card });

    for (let i = 0; i < 3; i += 1) await pushHealth(1_000 + i);

    for (const root of ROOTS) {
      expect(renderCount(root), renderSummary()).toBe(0);
    }
  });
});

describe('a block reaches each root at most once', () => {
  it('spends the block on the pulse batch and on nothing else', async () => {
    await mountApp();

    await pushBlock(101, KNOWN_PRODUCERS[0]);

    for (const root of ROOTS) {
      expect(renderCount(root), renderSummary()).toBeLessThanOrEqual(1);
    }
  });
});


describe('the galaxy overlay holds through a block', () => {
  // L6-2: `livePulseDelayS` is a continuous function of which peer produced
  // the block, so the overlay element — and with it the whole canopy — turned
  // over on 78 % of real blocks and on 100 % of alternating ones.
  it('keeps one overlay identity across 59 alternating producers', async () => {
    await mountApp();

    for (let i = 0; i < 59; i += 1) {
      await pushBlock(200 + i, KNOWN_PRODUCERS[i % 2]);
    }

    expect(
      renderReasons('CellGalaxy').filter((keys) => keys.includes('overlay')),
      renderSummary(),
    ).toEqual([]);
    expect(renderCount('CellGalaxy'), renderSummary()).toBe(0);
  });

  it('still departs with the delay the colony measured for this block', async () => {
    // The scalar left the props; it must not have left the picture. The
    // nerve's ref and the colony's own flood are two readings of one fact —
    // when the local node receives this block — so they have to agree on
    // every block, including the ones where the producer changed.
    await mountApp();

    for (let i = 0; i < 6; i += 1) {
      await pushBlock(300 + i, KNOWN_PRODUCERS[i % 2]);
      const delayRef = propOf('NeuralNetwork', 'livePulseDelaySRef') as
        { readonly current: number } | undefined;
      const flood = propOf('NetworkColony', 'cf') as
        { localReceiveDelayS: number };
      expect(delayRef?.current).toBe(
        livePulseDepartureDelayS(flood.localReceiveDelayS),
      );
    }
  });
});

describe('the semantic marker keys on what it reads', () => {
  async function mountWithMarker() {
    enableEnrichment();
    await mountApp();
    await pushSemantics([sourceStatus()]);
    await pushSemantics([cellSemantics(1)]);
    await selectCell(1);
    resetRenders();
  }

  it('answers a source status change', async () => {
    await mountWithMarker();

    await pushSemantics([sourceStatus({ status: 'stale' })]);

    expect(renderCount('CellSemanticOrbit'), renderSummary())
      .toBeGreaterThanOrEqual(1);
  });

  it('holds through a probe round that only restamps the source', async () => {
    await mountWithMarker();

    await pushSemantics([sourceStatus({ last_success_at_ms: 1234567899000 })]);

    expect(renderCount('CellSemanticOrbit'), renderSummary()).toBe(0);
    expect(renderCount('CellGalaxy'), renderSummary()).toBe(0);
  });
});


describe('an idle publish that carries nothing reaches nobody', () => {
  // A body the derive reads as a live node: every adapter alive, no
  // quarantine, a tip that moved a moment ago.
  const LIVE_BODY = {
    degraded: false,
    adapters: [{ name: 'ckb', alive: true }],
    tip_age_ms: 1_200,
    quarantined_projections: [],
  };
  const POLL_MS = 250;

  function serving(body: unknown) {
    return vi.fn(async () => new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
  }

  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('spends nothing on node-health polls that say what the last one said', async () => {
    // The channel re-derives its whole reading every 2 s and hands React a
    // fresh object whose only moving part is a freshness stamp with no
    // rendered output while the node is live (report L6-6). Every one of those
    // was an App render and, before T3, two scene-root renders under it.
    vi.useFakeTimers();
    const fetchStub = serving(LIVE_BODY);
    vi.stubGlobal('fetch', fetchStub);
    await mountApp({ nodeHealthPollMs: POLL_MS });
    // The first poll runs on connect and lands during the mount — the node
    // channel starts at `null`, which is silence rather than health, so that
    // one IS a reading. The window opens after it.
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    resetRenders();

    // One poll per `act`: React coalesces every update inside one of them,
    // so three polls folded into a single window would read as one render
    // whether or not each of them published.
    for (let i = 0; i < 3; i += 1) {
      await act(async () => { await vi.advanceTimersByTimeAsync(POLL_MS); });
    }

    expect(fetchStub.mock.calls.length, 'the poll never ran').toBeGreaterThanOrEqual(4);
    expect(renderCount('App'), renderSummary()).toBe(0);
    expect(renderCount('HudOverlay'), renderSummary()).toBe(0);
  });

  it('spends one render on an enrichment probe round with nothing selected', async () => {
    // The publish itself is App's to pay: the semantics cache is App state.
    // What it must not also pay is the three selection lookups each writing a
    // fresh idle object into state for a selection that does not exist
    // (report L6-7).
    enableEnrichment();
    await mountApp();
    await pushSemantics([sourceStatus()]);
    resetRenders();

    await pushSemantics([sourceStatus({ last_success_at_ms: 1234567899000 })]);

    expect(renderCount('App'), renderSummary()).toBe(1);
  });
});


describe('leva is mounted when it is asked for', () => {
  afterEach(() => { resetTweaksPanelForTest(); });

  it('leaves the bridge unmounted on a page nobody has asked to tune', async () => {
    // `TweakSync` is five `useControls` over five full schemas, and it is an
    // unmemoized child of App, so it re-ran on every App render — 3.6 ms of a
    // block frame in a dev profile for a panel nobody opened.
    resetTweaksPanelForTest();
    await mountApp();

    await pushBlock(400, KNOWN_PRODUCERS[0]);

    expect(renderCount('TweakSync'), renderSummary()).toBe(0);
  });

  it('mounts it in the same gesture that opens the panel', async () => {
    resetTweaksPanelForTest();
    await mountApp();

    act(() => { toggleTweaksPanel(); });

    expect(renderCount('TweakSync'), renderSummary()).toBeGreaterThanOrEqual(1);
  });

  it('has it standing from the first frame with ?dev=1', async () => {
    resetTweaksPanelForTest('?dev=1');
    render(<App {...appProps()} />);
    await act(async () => { await Promise.resolve(); });

    expect(renderCount('TweakSync'), renderSummary()).toBeGreaterThanOrEqual(1);
  });
});
