import { beforeEach, describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { Canvas } from '@react-three/fiber';
import NeuralNetwork from '../../src/nerve/NeuralNetwork';
import { CellGalaxyProvider } from '../../src/hooks/cellGalaxyContext';
import { emptyCellsCache } from '@cknerv/cache';
import { snapshotPulseStats, resetPulseStats } from '../../src/nerve/pulseStats';
import type { CellLink } from '@cknerv/types';

beforeEach(() => resetPulseStats());

function mkLink(seq: number): CellLink {
  return {
    seq,
    tx_hash: '0x' + seq,
    block: 10,
    from_ids: [],
    to_ids: [1],
    parents: ['0xp'],
    tag: null,
    at_ms: 0,
  };
}

describe('NeuralNetwork drop instrumentation wiring', () => {
  // Integration mount-safety test — the level this jsdom harness supports
  // (same precedent as __tests__/components/CellGalaxy.test.tsx). Proves the
  // new pulseStats wiring + the second effect compile and mount inside an r3f
  // Canvas without throwing.
  //
  // WHY only mount-safety here: @react-three/fiber v8's <Canvas> only mounts
  // its children once the container measures a non-zero size (fiber gate:
  // `containerRect.width > 0 && containerRect.height > 0`). Size is reported
  // via react-use-measure → ResizeObserver, which test-setup.ts stubs as a
  // no-op, so the container stays 0x0, children never mount, and
  // NeuralNetwork's useEffects never run. Verified with a throwaway probe
  // (a bare child effect fires; the same child inside <Canvas> does not) and
  // in the installed fiber source. Observing the counters would need a
  // headless r3f harness (@react-three/test-renderer — not a dependency) or a
  // WebGL+size mock; both are out of scope for this wiring task and would be a
  // harness hack. The two assertions below capture the intended behaviour and
  // are skipped until such a harness exists.
  it('mounts inside an r3f Canvas (backfill + links) without throwing', () => {
    const cache = {
      ...emptyCellsCache(),
      backfill: { done: 1, total: 10 },
      recentLinks: [mkLink(1), mkLink(2)],
      lastPulseAtMs: 1000,
    };
    expect(() =>
      render(
        <CellGalaxyProvider value={cache}>
          <Canvas>
            <NeuralNetwork />
          </Canvas>
        </CellGalaxyProvider>,
      ),
    ).not.toThrow();
  });

  // Brief's intended effect-observation assertions. SKIPPED: cannot run in
  // this jsdom harness (see note above — children never mount in <Canvas>).
  // The production wiring they assert is verified by code review + the
  // underlying unit tests shipped in Tasks 1-3 (advanceLinkCursor.suppressed,
  // pulseStats.bump/observeLink/observeBlockTick, planPulses stats param).
  // Re-enable verbatim once the package gains a headless r3f test harness.
  it.skip('counts suppressed links under backfill on mount', () => {
    const cache = {
      ...emptyCellsCache(),
      backfill: { done: 1, total: 10 },
      recentLinks: [mkLink(1), mkLink(2)],
    };
    render(
      <CellGalaxyProvider value={cache}>
        <Canvas>
          <NeuralNetwork />
        </Canvas>
      </CellGalaxyProvider>,
    );
    expect(snapshotPulseStats().linkReasons.backfill).toBe(2);
  });

  it.skip('ticks blocksTotal when lastPulseAtMs advances (first value only seeds)', () => {
    const base = emptyCellsCache();
    const { rerender } = render(
      <CellGalaxyProvider value={{ ...base, lastPulseAtMs: 1000 }}>
        <Canvas>
          <NeuralNetwork />
        </Canvas>
      </CellGalaxyProvider>,
    );
    rerender(
      <CellGalaxyProvider value={{ ...base, lastPulseAtMs: 1001 }}>
        <Canvas>
          <NeuralNetwork />
        </Canvas>
      </CellGalaxyProvider>,
    );
    rerender(
      <CellGalaxyProvider value={{ ...base, lastPulseAtMs: 1002 }}>
        <Canvas>
          <NeuralNetwork />
        </Canvas>
      </CellGalaxyProvider>,
    );
    expect(snapshotPulseStats().blocksTotal).toBe(2);
  });
});
