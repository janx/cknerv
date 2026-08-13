import type { ReactNode } from 'react';
import type { Cell } from '@cknerv/types';
import { emptyCellsCache } from '@cknerv/cache';
import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CellGalaxyProvider } from '../../src/hooks/cellGalaxyContext';
import ConsensusMemoryMarkers from '../../src/nerve/ConsensusMemoryMarkers';
import type {
  ConsensusMemoryTraceFocus,
  ConsensusMemoryTraceFocusSource,
} from '../../src/nerve/consensusMemoryTrace';
import {
  CONSENSUS_MEMORY_SOURCE_HANDOFF_SECONDS,
  deriveConsensusMemorySourceHandoff,
} from '../../src/nerve/consensusMemorySourceHandoff';
import {
  deriveConsensusMemoryDistancePresentation,
} from '../../src/nerve/consensusMemoryDistancePresentation';
import { simClock } from '../../src/tweaks/simClock';

const simFrameMock = vi.hoisted(() => ({
  callback: null as null | (() => void),
}));

vi.mock('@react-three/drei', () => ({
  Html: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('../../src/tweaks/useSimFrame', () => ({
  useSimFrame: (callback: () => void) => {
    simFrameMock.callback = callback;
  },
}));

function cell(id: number, hashDigit: string): Cell {
  return {
    id,
    born_at_ms: 0,
    death_at_ms: null,
    birth_block: 1,
    tag: null,
    pos_seed: [id, id + 1, id + 2],
    out_point: { tx_hash: `0x${id}`, index: 0 },
    capacity: 0,
    data_hex: '0x',
    content_hash: `0x${hashDigit.repeat(64)}`,
  };
}

function focusSource(
  id: number,
  hashDigit: string,
  startsAtSec: number,
  arrivesAtSec: number,
  targetId = 5,
): ConsensusMemoryTraceFocusSource {
  return {
    id,
    contentHash: `0x${hashDigit.repeat(64)}`,
    outPoint: { tx_hash: `0x${id}`, index: 0 },
    birthBlock: 1,
    startsAtSec,
    arrivesAtSec,
    routes: [{
      targetId,
      path: [id, id + 20, targetId],
      color: [0.2, 0.8, 1],
      hopCount: 2,
      hopMs: (arrivesAtSec - startsAtSec) * 500,
      startsAtSec,
      arrivesAtSec,
    }],
  };
}

function focus(overrides: Partial<ConsensusMemoryTraceFocus> = {}): ConsensusMemoryTraceFocus {
  return {
    key: '7:1',
    linkSeq: 7,
    linkBlock: 99,
    sourceKind: 'witness',
    sources: [focusSource(8, 'a', 1.1, 1.8)],
    consumedInputs: [],
    routedSourceCount: 1,
    targetIds: [5],
    startedAtSec: 1,
    endsAtSec: 4,
    evidenceFocusSourceId: null,
    routeHopFocus: null,
    ...overrides,
  };
}

describe('ConsensusMemoryMarkers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throttles endpoint rect reads to the shared 250ms hud measure cadence', () => {
    const cache = emptyCellsCache();
    cache.cells.set(8, cell(8, 'a'));
    cache.cells.set(5, cell(5, 'b'));
    const nowSpy = vi.spyOn(performance, 'now').mockReturnValue(10_000);
    const rectSpy = vi.spyOn(Element.prototype, 'getBoundingClientRect');

    render(
      <CellGalaxyProvider value={cache}>
        <ConsensusMemoryMarkers focus={focus()} />
      </CellGalaxyProvider>,
    );
    act(() => simFrameMock.callback?.());
    const measuredCalls = rectSpy.mock.calls.length;
    expect(measuredCalls).toBeGreaterThan(0);

    // Frames inside the 250ms window reuse cached rects: the frame loop
    // itself performs zero layout reads.
    act(() => simFrameMock.callback?.());
    act(() => simFrameMock.callback?.());
    expect(rectSpy.mock.calls.length).toBe(measuredCalls);

    nowSpy.mockReturnValue(10_250);
    act(() => simFrameMock.callback?.());
    expect(rectSpy.mock.calls.length).toBeGreaterThan(measuredCalls);
  });

  it('a focusless resting view performs zero forced-layout reads', () => {
    const cache = emptyCellsCache();
    const nowSpy = vi.spyOn(performance, 'now').mockReturnValue(30_000);
    const rectSpy = vi.spyOn(Element.prototype, 'getBoundingClientRect');
    const querySpy = vi.spyOn(document, 'querySelectorAll');

    render(
      <CellGalaxyProvider value={cache}>
        <ConsensusMemoryMarkers focus={null} />
      </CellGalaxyProvider>,
    );
    const rectBaseline = rectSpy.mock.calls.length;
    const queryBaseline = querySpy.mock.calls.length;

    // Frames at rest — including one past the 250ms cadence — must not touch
    // layout: with no markers, nobody consumes the measured rects.
    act(() => simFrameMock.callback?.());
    nowSpy.mockReturnValue(30_500);
    act(() => simFrameMock.callback?.());
    expect(rectSpy.mock.calls.length).toBe(rectBaseline);
    expect(querySpy.mock.calls.length).toBe(queryBaseline);
  });

  it('remeasures immediately when the marker set changes inside the window', () => {
    const cache = emptyCellsCache();
    cache.cells.set(8, cell(8, 'a'));
    cache.cells.set(9, cell(9, 'c'));
    cache.cells.set(5, cell(5, 'b'));
    vi.spyOn(performance, 'now').mockReturnValue(20_000);
    const rectSpy = vi.spyOn(Element.prototype, 'getBoundingClientRect');

    const view = render(
      <CellGalaxyProvider value={cache}>
        <ConsensusMemoryMarkers focus={focus()} />
      </CellGalaxyProvider>,
    );
    act(() => simFrameMock.callback?.());
    const measuredCalls = rectSpy.mock.calls.length;

    // Same viewport, same frozen clock — only the marker set changed. Stale
    // rects must never be indexed against a different marker array.
    view.rerender(
      <CellGalaxyProvider value={cache}>
        <ConsensusMemoryMarkers focus={focus({
          key: '8:1',
          sources: [
            focusSource(8, 'a', 1.1, 1.8),
            focusSource(9, 'c', 1.32, 2.02),
          ],
          consumedInputs: [],
          routedSourceCount: 2,
        })} />
      </CellGalaxyProvider>,
    );
    act(() => simFrameMock.callback?.());
    expect(rectSpy.mock.calls.length).toBeGreaterThan(measuredCalls);
  });

  it('binds honest source and record labels to retained Cell endpoints', () => {
    const cache = emptyCellsCache();
    cache.cells.set(8, cell(8, 'a'));
    cache.cells.set(5, cell(5, 'b'));

    const { container } = render(
      <CellGalaxyProvider value={cache}>
        <ConsensusMemoryMarkers focus={focus()} />
      </CellGalaxyProvider>,
    );

    const source = container.querySelector('[data-memory-endpoint="source"]');
    const target = container.querySelector('[data-memory-endpoint="target"]');
    expect(source?.getAttribute('data-memory-source-kind')).toBe('witness');
    expect(source?.textContent).toContain('LINEAGE WITNESS');
    expect(source?.textContent).toContain('谱系见证');
    expect(source?.textContent).toContain('AAAAAAAAAA');
    expect(target?.textContent).toContain('SHARED RECORD');
    expect(target?.textContent).toContain('共识记录');
    expect(target?.textContent).toContain('BBBBBBBBBB');
    expect(target?.querySelectorAll('circle')).toHaveLength(0);
  });

  it('never fabricates a marker when the planned endpoint is absent', () => {
    const cache = emptyCellsCache();
    cache.cells.set(5, cell(5, 'b'));

    const { container } = render(
      <CellGalaxyProvider value={cache}>
        <ConsensusMemoryMarkers focus={focus()} />
      </CellGalaxyProvider>,
    );

    expect(container.querySelector('[data-memory-endpoint="source"]')).toBeNull();
    expect(container.querySelector('[data-memory-endpoint="target"]')).not.toBeNull();
  });

  it('distinguishes an exact retained transaction input from a lineage witness', () => {
    const cache = emptyCellsCache();
    cache.cells.set(8, cell(8, 'a'));
    cache.cells.set(5, cell(5, 'b'));

    const { container } = render(
      <CellGalaxyProvider value={cache}>
        <ConsensusMemoryMarkers focus={focus({ sourceKind: 'input' })} />
      </CellGalaxyProvider>,
    );

    const source = container.querySelector('[data-memory-endpoint="source"]');
    expect(source?.getAttribute('data-memory-source-kind')).toBe('input');
    expect(source?.textContent).toContain('RETAINED INPUT');
    expect(source?.textContent).toContain('交易输入');
  });

  it('numbers every routed witness and summarizes the real convergence count', () => {
    const cache = emptyCellsCache();
    cache.cells.set(8, cell(8, 'a'));
    cache.cells.set(9, cell(9, 'c'));
    cache.cells.set(5, cell(5, 'b'));

    const { container } = render(
      <CellGalaxyProvider value={cache}>
        <ConsensusMemoryMarkers focus={focus({
          sources: [
            focusSource(8, 'a', 1.1, 1.8),
            focusSource(9, 'c', 1.32, 2.02),
          ],
          consumedInputs: [],
          routedSourceCount: 2,
        })} />
      </CellGalaxyProvider>,
    );

    const sources = container.querySelectorAll('[data-memory-endpoint="source"]');
    expect(sources).toHaveLength(2);
    expect(sources[0].textContent).toContain('01/02');
    expect(sources[1].textContent).toContain('02/02');
    expect(sources[1].getAttribute('data-memory-source-index')).toBe('2');
    expect(container.querySelector('[data-memory-endpoint="target"]')?.textContent)
      .toContain('02 WITNESSES');
  });

  it('reduces only subordinate endpoint copy as the record frame widens', () => {
    const cache = emptyCellsCache();
    cache.cells.set(8, cell(8, 'a'));
    cache.cells.set(5, cell(5, 'b'));
    const distancePresentationRef = {
      current: deriveConsensusMemoryDistancePresentation(184),
    };
    const { container } = render(
      <CellGalaxyProvider value={cache}>
        <ConsensusMemoryMarkers
          focus={focus({ evidenceFocusSourceId: 8 })}
          evidenceFocusSourceId={8}
          distancePresentationRef={distancePresentationRef}
        />
      </CellGalaxyProvider>,
    );

    act(() => simFrameMock.callback?.());
    const source = container.querySelector<HTMLElement>(
      '[data-memory-endpoint="source"]',
    )!;
    const target = container.querySelector<HTMLElement>(
      '[data-memory-endpoint="target"]',
    )!;
    expect(source.dataset.memoryDistanceLod).toBe('compact');
    expect(source.querySelector<HTMLElement>(
      '[data-memory-label-metadata]',
    )?.style.display).toBe('');
    expect(source.querySelector<HTMLElement>(
      '[data-memory-label-source-content]',
    )?.style.display).toBe('none');
    expect(source.querySelector('[data-memory-route-proof="true"]'))
      .not.toBeNull();
    expect(target.querySelector<HTMLElement>(
      '[data-memory-label-target-content]',
    )?.style.display).toBe('none');

    distancePresentationRef.current =
      deriveConsensusMemoryDistancePresentation(208);
    act(() => simFrameMock.callback?.());
    expect(source.dataset.memoryDistanceLod).toBe('signal');
    expect(source.querySelector<HTMLElement>(
      '[data-memory-label-metadata]',
    )?.style.display).toBe('none');
    expect(source.querySelector('[data-memory-route-proof="true"]'))
      .not.toBeNull();
    expect(source.textContent).toContain('LINEAGE WITNESS');
    expect(target.textContent).toContain('SHARED RECORD');
  });

  it('marks the selected real source while retaining the target as context', () => {
    const cache = emptyCellsCache();
    cache.cells.set(8, cell(8, 'a'));
    cache.cells.set(9, cell(9, 'c'));
    cache.cells.set(5, cell(5, 'b'));
    const traceFocus = focus({
      sources: [
        focusSource(8, 'a', 1.1, 1.8),
        focusSource(9, 'c', 1.32, 2.02),
      ],
      consumedInputs: [],
      routedSourceCount: 2,
      evidenceFocusSourceId: 9,
    });
    const { container } = render(
      <CellGalaxyProvider value={cache}>
        <ConsensusMemoryMarkers focus={traceFocus} evidenceFocusSourceId={9} />
      </CellGalaxyProvider>,
    );

    const sources = container.querySelectorAll('[data-memory-endpoint="source"]');
    expect(sources[0].getAttribute('data-memory-evidence-focus')).toBe('passive');
    expect(sources[1].getAttribute('data-memory-evidence-focus')).toBe('active');
    expect(sources[1].getAttribute('data-memory-source-id')).toBe('9');
    expect(sources[1].getAttribute('data-memory-route')).toBe('9>29>5');
    expect(sources[1].getAttribute('data-memory-route-hops')).toBe('2');
    expect(sources[1].querySelector('[data-memory-route-proof="true"]')?.textContent)
      .toContain('CELL #9 · H02 · 700 MS');
    expect(container.querySelector('[data-memory-endpoint="target"]')
      ?.getAttribute('data-memory-evidence-focus')).toBe('context');
  });

  it('hands endpoint emphasis from the departing source to the arriving source', () => {
    const cache = emptyCellsCache();
    cache.cells.set(8, cell(8, 'a'));
    cache.cells.set(9, cell(9, 'c'));
    cache.cells.set(5, cell(5, 'b'));
    const traceFocus = focus({
      sources: [
        focusSource(8, 'a', 1.1, 1.8),
        focusSource(9, 'c', 1.32, 2.02),
      ],
      consumedInputs: [],
      routedSourceCount: 2,
      evidenceFocusSourceId: 9,
    });
    const sourceHandoff = deriveConsensusMemorySourceHandoff(
      {
        traceKey: traceFocus.key,
        sourceId: 8,
        targetCellId: 5,
        cellId: 5,
        hopIndex: 2,
      },
      {
        traceKey: traceFocus.key,
        sourceId: 9,
        targetCellId: 5,
        cellId: 5,
        hopIndex: 2,
      },
      2.2,
    )!;
    const { container } = render(
      <CellGalaxyProvider value={cache}>
        <ConsensusMemoryMarkers
          focus={traceFocus}
          evidenceFocusSourceId={9}
          sourceHandoffRef={{ current: sourceHandoff }}
        />
      </CellGalaxyProvider>,
    );

    act(() => {
      simClock.elapsedSec = 2.2 + CONSENSUS_MEMORY_SOURCE_HANDOFF_SECONDS / 2;
      simFrameMock.callback?.();
    });
    const departing = container.querySelector<HTMLElement>(
      '[data-memory-source-id="8"]',
    )!;
    const arriving = container.querySelector<HTMLElement>(
      '[data-memory-source-id="9"]',
    )!;
    expect(departing.getAttribute('data-memory-evidence-focus')).toBe('departing');
    expect(arriving.getAttribute('data-memory-evidence-focus')).toBe('arriving');
    expect(departing.getAttribute('data-memory-source-handoff-progress')).toBe('0.500');
    expect(Number(departing.style.opacity)).toBeCloseTo(Number(arriving.style.opacity));

    act(() => {
      simClock.elapsedSec = sourceHandoff.endsAtSec;
      simFrameMock.callback?.();
    });
    expect(departing.getAttribute('data-memory-evidence-focus')).toBe('passive');
    expect(arriving.getAttribute('data-memory-evidence-focus')).toBe('active');
    expect(arriving.getAttribute('data-memory-source-handoff')).toBe('idle');
  });

  it('retains endpoint DOM across a same-route replay but not changed geometry', () => {
    const cache = emptyCellsCache();
    cache.cells.set(8, cell(8, 'a'));
    cache.cells.set(5, cell(5, 'b'));
    const firstFocus = focus();
    const view = render(
      <CellGalaxyProvider value={cache}>
        <ConsensusMemoryMarkers focus={firstFocus} />
      </CellGalaxyProvider>,
    );

    act(() => {
      simClock.elapsedSec = 2;
      simFrameMock.callback?.();
    });
    const firstTarget = view.container.querySelector<HTMLElement>(
      '[data-memory-endpoint="target"]',
    )!;
    expect(Number(firstTarget.style.opacity)).toBeGreaterThan(0);

    const replayFocus = focus({
      key: '7:2',
      startedAtSec: 2.1,
      endsAtSec: 5,
      visualContinuity: {
        mode: 'floor',
        floorStrength: 0.75,
        endsAtSec: 2.26,
      },
    });
    view.rerender(
      <CellGalaxyProvider value={cache}>
        <ConsensusMemoryMarkers focus={replayFocus} />
      </CellGalaxyProvider>,
    );
    const replayTarget = view.container.querySelector<HTMLElement>(
      '[data-memory-endpoint="target"]',
    )!;
    expect(replayTarget).toBe(firstTarget);
    expect(replayTarget.dataset.memoryTraceContinuity).toBe('floor');
    expect(Number(replayTarget.style.opacity)).toBeGreaterThan(0);

    const changedFocus = focus({
      key: '8:1',
      sources: [{
        ...focusSource(8, 'a', 2.1, 2.8),
        routes: [{
          ...focusSource(8, 'a', 2.1, 2.8).routes[0],
          path: [8, 28, 30, 5],
          hopCount: 3,
        }],
      }],
      startedAtSec: 2.1,
      endsAtSec: 5,
    });
    view.rerender(
      <CellGalaxyProvider value={cache}>
        <ConsensusMemoryMarkers focus={changedFocus} />
      </CellGalaxyProvider>,
    );
    const changedTarget = view.container.querySelector<HTMLElement>(
      '[data-memory-endpoint="target"]',
    )!;
    expect(changedTarget).not.toBe(firstTarget);
    expect(changedTarget.style.opacity).toBe('0');
  });

  it('keeps departing and arriving records as independent endpoint layers', () => {
    const cache = emptyCellsCache();
    cache.cells.set(8, cell(8, 'a'));
    cache.cells.set(5, cell(5, 'b'));
    cache.cells.set(9, cell(9, 'c'));
    cache.cells.set(6, cell(6, 'd'));
    const departingFocus = focus();
    const arrivingFocus = focus({
      key: '8:6:1',
      sources: [focusSource(9, 'c', 2, 2.5, 6)],
      targetIds: [6],
      startedAtSec: 2,
      endsAtSec: 5,
      visualContinuity: {
        mode: 'entry',
        floorStrength: 0,
        startedAtSec: 2.1,
        endsAtSec: 2.5,
      },
    });
    const { container } = render(
      <CellGalaxyProvider value={cache}>
        <ConsensusMemoryMarkers
          focus={departingFocus}
          recordTransition="departing"
        />
        <ConsensusMemoryMarkers
          focus={arrivingFocus}
          recordTransition="arriving"
        />
      </CellGalaxyProvider>,
    );

    const departing = container.querySelectorAll<HTMLElement>(
      '[data-memory-record-transition="departing"]',
    );
    const arriving = container.querySelectorAll<HTMLElement>(
      '[data-memory-record-transition="arriving"]',
    );
    expect(departing).toHaveLength(2);
    expect(arriving).toHaveLength(2);
    expect(departing[0].dataset.memoryRecordBridge).toBe('independent');
    expect(arriving[0].dataset.memoryRecordBridge).toBe('independent');
    expect(departing[0].dataset.memoryRoute).toBe('8>28>5');
    expect(arriving[0].dataset.memoryRoute).toBe('9>29>6');
    expect(container.querySelector('[data-memory-route="5>9"]')).toBeNull();

    act(() => {
      simClock.elapsedSec = 2.5;
      simFrameMock.callback?.();
    });
    expect(arriving[0].dataset.memoryRecordTransition).toBe('native');
    expect(arriving[0].dataset.memoryRecordBridge).toBe('none');
  });
});
