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

import App from '../src/App';
import {
  appProps,
  mempoolTick,
  peersPoll,
  pushBlock,
  pushChain,
  pushHealth,
  renderCount,
  renderSummary,
  resetHarness,
  resetRenders,
  seedCaches,
  selectCell,
  KNOWN_PRODUCERS,
} from './helpers/appHarness';

/** Mount, let the connectors open and the camera frame land, then start
 *  counting from the standing tree. */
async function mountApp(openCardOn: number | null = null) {
  resetHarness();
  seedCaches();
  render(<App {...appProps()} />);
  await act(async () => { await Promise.resolve(); });
  if (openCardOn !== null) await selectCell(openCardOn);
  resetRenders();
}

beforeEach(() => { resetHarness(); });
afterEach(() => { cleanup(); resetHarness(); });

/** Every root a memo is supposed to hold. The dossier is only mounted with a
 *  card open, so it counts 0 either way when the contract holds. */
const ROOTS = ['CellGalaxy', 'NetworkColony', 'CellInspectionOverlay'] as const;

describe.each([
  ['at rest', null],
  ['with a Cell card open', 1],
] as const)('the idle polls reach no scene root (%s)', (_label, card) => {
  it('holds every root through three mempool ticks', async () => {
    await mountApp(card);

    for (let i = 0; i < 3; i += 1) await pushChain(mempoolTick(i + 1));

    // The HUD prints the mempool, so it renders; nothing below it does.
    expect(renderCount('HudOverlay'), renderSummary()).toBe(3);
    for (const root of ROOTS) {
      expect(renderCount(root), renderSummary()).toBe(0);
    }
  });

  it('holds every root through three peers polls', async () => {
    await mountApp(card);

    for (let i = 0; i < 3; i += 1) await pushChain(peersPoll());

    expect(renderCount('HudOverlay'), renderSummary()).toBe(3);
    for (const root of ROOTS) {
      expect(renderCount(root), renderSummary()).toBe(0);
    }
  });

  it('holds every root through three node-health polls', async () => {
    await mountApp(card);

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
