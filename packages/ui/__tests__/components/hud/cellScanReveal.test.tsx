// The CELL SCAN reveal is a 2.4s walk that used to be a `setState` at the top
// of a 1500-line card: 30 ticks × the whole dossier (the DECODE rebuild, the
// 32 hex spans of content memory, every plate and every ghost) on the click
// frame, sharing a thread with the braid build and WebGL. These pins hold the
// shape that replaced it — the walk lives in a clock the LEAVES subscribe to,
// so a tick can reach a fact, a status line or the sweep, and nothing else.
//
// What the walk LOOKS like is pinned next door in CellDetailPanel.test.tsx
// (stage timings, ghost opacity, layout invariance); this file only pins who
// gets woken, and by what.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import type { Cell, EnrichmentSourceStatus } from '@cknerv/types';
import { PROBE_STEP_S } from '../../../src/components/hud/probeScan';
import {
  cellScanFrameAt,
  SCAN_TICK_MS,
} from '../../../src/components/hud/cellScanClock';

const { portraitBodyRender } = vi.hoisted(() => ({
  portraitBodyRender: vi.fn(),
}));

// Deliberately NOT memoized, unlike the panel's own portrait shield: this mock
// renders exactly when the panel body renders, so its call count IS the body's
// render count.
vi.mock('../../../src/components/hud/CellNucleusPortrait', () => ({
  default: (props: { scanEpochMs?: number }) => {
    portraitBodyRender(props.scanEpochMs);
    return <div data-testid="cell-nucleus-portrait" />;
  },
}));

import CellDetailPanel from '../../../src/components/hud/CellDetailPanel';

const PANEL_SOURCE = readFileSync(
  resolve(process.cwd(), 'src/components/hud/CellDetailPanel.tsx'),
  'utf8',
);

const base: Cell = {
  id: 4242, born_at_ms: 0, death_at_ms: null, birth_block: 16204800,
  tag: 'wallet', pos_seed: [0, 0, 0],
  out_point: { tx_hash: '0x' + 'ab'.repeat(32), index: 2 },
  capacity: 12300000000, data_hex: '0xdeadbeefcafe1234567890',
  data_bytes: 11,
  content_hash: '0x' + '11'.repeat(32), lock_kind: 'omnilock', asset_kind: 'xudt',
  lock_shape_seed: [1, 2], type_shape_seed: null, data_shape_seed: [3, 4],
  lock_script: { code_hash: `0x${'7c'.repeat(32)}`, hash_type: 'type' },
};

const source: EnrichmentSourceStatus = {
  source: 'ckbadger',
  status: 'ready',
  capabilities: [],
  lag_blocks: 1,
};

/** The lattice count the plate header tracks, as a number. It stopped being
 *  printed — `LOCKED · A-LATTICE 6/6` in nominal green sat directly under the
 *  live flag, telemetry in the colour of a chain fact — but the walk still
 *  publishes it on the status node for anything watching. */
function latticeLit(container: HTMLElement): number {
  const status = container.querySelector(
    '[data-cell-identity-scan-status="true"]',
  ) as HTMLElement;
  return Number(/^(\d+)\//.exec(status.dataset.cellScanLattice ?? '')?.[1] ?? -1);
}

/** Whether the walk has locked, from the same node. */
function latticeClassified(container: HTMLElement): boolean {
  return container.querySelector<HTMLElement>(
    '[data-cell-identity-scan-status="true"]',
  )?.dataset.cellScanClassified === 'true';
}

function factState(container: HTMLElement, field: string): string | null {
  return container.querySelector(`[data-cell-detail-field="${field}"]`)
    ?.getAttribute('data-cell-detail-field-state') ?? null;
}

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('the scan reveal runs on a clock the leaves hold', () => {
  beforeEach(() => {
    portraitBodyRender.mockClear();
    vi.useFakeTimers();
  });

  it('keeps every timer and every walking value out of the card body', () => {
    // The card body may schedule nothing at all: both timer calls live in
    // cellScanClock.ts, which owns one interval per open panel.
    expect(PANEL_SOURCE).not.toMatch(/\bsetInterval\s*\(/);
    expect(PANEL_SOURCE).not.toMatch(/\bsetTimeout\s*\(/);
    // …and no state at the top of the card is allowed to hold the walk. Two of
    // the three `useState`s the body keeps are moved by a CLICK and never by a
    // tick — the selected facet, and which decoded segment CKBYTES is standing
    // on, and on which Cell. The third is moved by the BROWSER reporting a
    // layout: the analysis plate's measured height, which the reader under the
    // scan square is sized from (the user's ruling of 2026-09-05). It is a
    // measurement and not the walk — a ResizeObserver plus a window `resize`,
    // guarded so an unchanged height re-renders nothing — and
    // `useCanvasClientRect` is its precedent.
    // The count is pinned rather than the absence of a clock, because a fourth
    // state added without a named gesture or a named measurement behind it is
    // how a walking value gets back into a body that renders once per
    // selection.
    const stateDeclarations = PANEL_SOURCE.match(/useState[<(]/g) ?? [];
    expect(stateDeclarations).toHaveLength(3);
    expect(PANEL_SOURCE).toContain('const [selectedFieldState, setSelectedFieldState] = useState<');
    expect(PANEL_SOURCE).toContain('const [segmentFocus, setSegmentFocus] = useState<');
    expect(PANEL_SOURCE).toContain('const [plateHeightPx, setPlateHeightPx] = useState(0);');
  });

  it('renders the card body once while the walk lights the whole dossier', () => {
    const performanceNow = vi.spyOn(performance, 'now').mockReturnValue(0);
    const { container } = render(
      <CellDetailPanel
        cell={base}
        semanticSource={source}
        semanticPhase="loading"
        onClose={() => {}}
      />,
    );
    const analysis = container.querySelector(
      '[data-cell-inspection-satellite="analysis"]',
    ) as HTMLElement;
    const rendersAtOpen = portraitBodyRender.mock.calls.length;
    expect(rendersAtOpen).toBeGreaterThan(0);
    expect(latticeLit(container)).toBe(0);
    expect(factState(container, 'lock')).toBe('scanning');
    expect(analysis.getAttribute('data-cellular-scan-progress')).toBe('0');
    expect(analysis.getAttribute('data-cellular-scan-state')).toBe('scanning');

    // One interval, and it is the clock's — the walk no longer needs a second
    // timer standing by to come and stop it.
    expect(vi.getTimerCount()).toBe(1);

    // Walk it, tick by tick, exactly as the panel's own clock does.
    const progressSeen = new Set<string>();
    for (let atMs = SCAN_TICK_MS; atMs <= 2720; atMs += SCAN_TICK_MS) {
      performanceNow.mockReturnValue(atMs);
      act(() => { vi.advanceTimersByTime(SCAN_TICK_MS); });
      progressSeen.add(analysis.getAttribute('data-cellular-scan-progress') ?? '');
    }

    // The reveal genuinely happened, in ink and in the sweep…
    expect(latticeLit(container)).toBe(6);
    expect(factState(container, 'data')).toBe('resolved');
    expect(latticeClassified(container)).toBe(true);
    // …and the progress readout retired with the walk it was reporting on.
    expect(container.textContent).not.toContain('SCANNING');
    expect(analysis.getAttribute('data-cellular-scan-state')).toBe('locked');
    expect(progressSeen.size).toBeGreaterThan(10);
    const beam = container.querySelector(
      '[data-cellular-scan-beam]',
    ) as HTMLElement;
    expect(beam.style.transform).toBe('translate3d(100%,0,0)');
    // …and the 1500-line body never re-ran for any of it.
    expect(portraitBodyRender).toHaveBeenCalledTimes(rendersAtOpen);
    // The walk retires its own interval at the end of the last step.
    expect(vi.getTimerCount()).toBe(0);
    performanceNow.mockRestore();
  });

  it('hands reduced motion the finished card with no clock at all', () => {
    vi.stubGlobal('matchMedia', () => ({
      matches: true,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    const { container } = render(
      <CellDetailPanel cell={base} onClose={() => {}} />,
    );

    expect(vi.getTimerCount()).toBe(0);
    expect(latticeLit(container)).toBe(6);
    expect(latticeClassified(container)).toBe(true);
    expect(container.textContent).not.toContain('SCANNING');
    expect(factState(container, 'lock')).toBe('resolved');
    expect(factState(container, 'data')).toBe('resolved');
    const analysis = container.querySelector(
      '[data-cell-inspection-satellite="analysis"]',
    ) as HTMLElement;
    expect(analysis.getAttribute('data-cellular-scan-state')).toBe('locked');
    expect(analysis.getAttribute('data-cellular-scan-progress')).toBe('100');
    const causal = container.querySelector(
      '[data-consensus-memory-reveal="causal"]',
    ) as HTMLElement | null;
    if (causal) expect(causal.style.opacity).toBe('1');
  });

  it('restarts the walk from zero when the subject changes mid-scan', () => {
    const performanceNow = vi.spyOn(performance, 'now').mockReturnValue(0);
    const { container, rerender } = render(
      <CellDetailPanel cell={base} onClose={() => {}} />,
    );
    const analysis = container.querySelector(
      '[data-cell-inspection-satellite="analysis"]',
    ) as HTMLElement;

    performanceNow.mockReturnValue(PROBE_STEP_S * 4.6 * 1000);
    act(() => { vi.advanceTimersByTime(SCAN_TICK_MS); });
    expect(latticeLit(container)).toBe(5);

    // A different Cell is a different scan. The epoch moves with the subject,
    // and the card is painted scanning from zero in the SAME render that
    // brought the new Cell in — no frame of the old lattice survives it.
    rerender(
      <CellDetailPanel cell={{ ...base, id: 77 }} onClose={() => {}} />,
    );
    expect(latticeLit(container)).toBe(0);
    expect(factState(container, 'lock')).toBe('scanning');
    expect(analysis.getAttribute('data-cellular-scan-state')).toBe('scanning');
    expect(analysis.getAttribute('data-cellular-scan-progress')).toBe('0');

    performanceNow.mockReturnValue(PROBE_STEP_S * 5.6 * 1000);
    act(() => { vi.advanceTimersByTime(SCAN_TICK_MS); });
    expect(latticeLit(container)).toBe(1);
    performanceNow.mockRestore();
  });

  it('lets late enrichment extend the walk without replaying it', () => {
    const performanceNow = vi.spyOn(performance, 'now').mockReturnValue(0);
    const { container, rerender } = render(
      <CellDetailPanel cell={base} onClose={() => {}} />,
    );

    // Five landmarks into a bare Cell's six-step walk.
    performanceNow.mockReturnValue(PROBE_STEP_S * 4.6 * 1000);
    act(() => { vi.advanceTimersByTime(SCAN_TICK_MS); });
    expect(latticeLit(container)).toBe(5);

    // The index answers mid-walk, which adds its two enrichment steps. The
    // walk's END moves; its START must not — a reader watching the lattice
    // light does not get it taken away and replayed.
    rerender(
      <CellDetailPanel
        cell={base}
        semanticSource={source}
        semanticPhase="ready"
        onClose={() => {}}
      />,
    );
    expect(latticeLit(container)).toBe(5);
    expect(factState(container, 'lock')).toBe('resolved');
    expect(vi.getTimerCount()).toBe(1);
    const semantics = () => container.querySelector(
      '[data-cell-semantics-phase]',
    ) as HTMLElement;
    expect(semantics().style.opacity).toBe('0');

    // …and the two extra steps still land where the walk always said they
    // would, measured from the original epoch: the context stage at step 7,
    // 1.965s after the Cell was selected — not 1.965s after the index replied.
    performanceNow.mockReturnValue(PROBE_STEP_S * 6.6 * 1000);
    act(() => { vi.advanceTimersByTime(SCAN_TICK_MS); });
    expect(latticeLit(container)).toBe(6);
    expect(latticeClassified(container)).toBe(true);
    expect(semantics().style.opacity).toBe('1');
    performanceNow.mockRestore();
  });
});

describe('cellScanFrameAt', () => {
  const LANDMARKS = 6;
  const at = (steps: number) => cellScanFrameAt(
    0,
    steps * PROBE_STEP_S * 1000,
    LANDMARKS,
    false,
  );

  it('lights one landmark per step, 55% of the way into each', () => {
    expect(at(0).lit).toBe(0);
    expect(at(0.5).lit).toBe(0);
    expect(at(0.6).lit).toBe(1);
    expect(at(4.6).lit).toBe(5);
    expect(at(5.6).lit).toBe(6);
  });

  it('locks the lattice at the END of the last step, not at its light', () => {
    expect(at(5.6).classified).toBe(false);
    expect(at(6).classified).toBe(true);
    expect(at(6).pct).toBe(100);
    expect(at(6).memoryProgress).toBe(1);
  });

  it('keeps counting steps past the lock, for the enrichment stages', () => {
    // The two enrichment gates are steps 7 and 8 of the same counter, so a
    // stage can never disagree with the fact above it about which step it is.
    expect(at(6.6).lit).toBe(7);
    expect(at(7.6).lit).toBe(8);
  });

  it('answers a settled walk for reduced motion, at any instant', () => {
    const frame = cellScanFrameAt(0, 0, LANDMARKS, true);
    expect(frame.classified).toBe(true);
    expect(frame.pct).toBe(100);
    expect(frame.memoryProgress).toBe(1);
    expect(frame.lit).toBeGreaterThan(LANDMARKS + 2);
  });
});
