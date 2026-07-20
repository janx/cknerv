import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import type { Cell, CellLink } from '@cknerv/types';
import type { ConsensusMemoryTraceReadout } from '../../../src/nerve/consensusMemoryTrace';

// The embedded portrait spins a real WebGL context — stub it in jsdom.
vi.mock('../../../src/components/hud/CellNucleusPortrait', () => ({
  default: ({ cell, focusField, traceReadout, traceResponseRef, traceEvidenceFocusSourceId }: {
    cell: { content_hash: string };
    focusField?: string | null;
    traceReadout?: { stage: string } | null;
    traceResponseRef?: { current: unknown };
    traceEvidenceFocusSourceId?: number | null;
  }) => (
    <div
      data-testid="portrait"
      data-hash={cell.content_hash}
      data-focus={focusField ?? ''}
      data-trace-stage={traceReadout?.stage ?? ''}
      data-response-ref={traceResponseRef ? 'true' : 'false'}
      data-evidence-focus-source={traceEvidenceFocusSourceId ?? ''}
    />
  ),
  SCAN_PERIOD_S: 4.2,
}));

import CellDetailPanel from '../../../src/components/hud/CellDetailPanel';

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

const base: Cell = {
  id: 4242, born_at_ms: 0, death_at_ms: null, birth_block: 16204800,
  tag: 'wallet', pos_seed: [0, 0, 0],
  out_point: { tx_hash: '0x' + 'ab'.repeat(32), index: 2 },
  capacity: 12300000000, data_hex: '0xdeadbeefcafe1234567890',
  content_hash: '0x' + '11'.repeat(32), lock_kind: 'omnilock', asset_kind: 'xudt',
};

function traceReadout(
  overrides: Partial<ConsensusMemoryTraceReadout> = {},
): ConsensusMemoryTraceReadout {
  const value = {
    key: `18:${base.id}:1`,
    targetCellId: base.id,
    sourceKind: 'input' as const,
    stage: 'reading' as const,
    sourceCount: 2,
    arrivedSourceCount: 0,
    resolvedSourceCount: 0,
    ...overrides,
  };
  return {
    ...value,
    evidence: overrides.evidence ?? Array.from(
      { length: value.sourceCount },
      (_, index) => ({
        sourceId: index + 11,
        ordinal: index + 1,
        contentHash: `0x${String(index + 1).repeat(64)}`,
        state: index < value.resolvedSourceCount
          ? 'resolved' as const
          : index < value.arrivedSourceCount
            ? 'arrived' as const
            : 'routing' as const,
        sourceOutPoint: {
          tx_hash: `0x${String(index + 1).repeat(64)}`,
          index,
        },
        sourceBirthBlock: 100 + index,
        route: [index + 11, 99, base.id],
        hopCount: 2,
        routeDurationMs: 520 + index * 80,
      }),
    ),
  };
}

describe('CellDetailPanel', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(3 * 3600_000 + 12 * 60_000)); });

  it('renders header, portrait, and real decoded fields', () => {
    const { container, getByTestId } = render(<CellDetailPanel cell={base} onClose={() => {}} />);
    const t = container.textContent ?? '';
    expect(t).toContain('CELL');
    expect(t).toContain('细胞');
    expect(t).toContain('共识细胞');       // CJK title
    expect(getByTestId('portrait').getAttribute('data-hash')).toBe(base.content_hash);
    expect(t).toContain('omnilock');       // LOCK
    expect(t).toContain('xUDT');           // ASSET
    expect(t).toContain('123.00 CKB');     // CAPACITY
    expect(t).toContain('LIVE');           // STATE
    expect(t).toContain('3h 12m');         // AGE
    expect(t).toContain('#16204800');      // COMMIT / block anchor
    expect(t).toContain('#2');             // immutable address index
    expect(t).toContain('11 B');           // DATA — 22 hex chars = 11 bytes
    expect(t).toContain('ƒ3:4:7');         // ASSET → frequency family
    expect(t).toContain('5 paths');        // LOCK → contributor paths
    expect(t).toContain('8 knots');        // DATA → agreement-node target
    expect(t).toContain('共识细胞');       // CJK title stays (no re-subset)
    expect(t).toContain('CONSENSUS MEMORY');
    expect(t).toContain('共识记忆');
    expect(t).toContain('ADDRESS');
    expect(t).toContain('CONTENT');
    expect(t).toContain('ANCHOR');
    expect(t).not.toContain('WRITE OBSERVED');
    expect(getByTestId('portrait').getAttribute('data-focus')).toBe('capacity');
    expect((container.firstElementChild as HTMLElement).style.animation)
      .toContain('cknerv-cell-consensus-enter');
  });

  it('reduced motion freezes decoding: mapped identity + stable fingerprint, all rows shown', () => {
    // stub matchMedia so useReducedMotion() reports reduced — deterministic path
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
    const { container } = render(<CellDetailPanel cell={base} onClose={() => {}} />);
    const t = container.textContent ?? '';
    expect(t).toContain('CONTENT IDENTITY MAPPED');
    expect(t).toContain('1111111111111111 · 1111111111');
    expect(t).toContain('omnilock');                              // decoded rows still present
    expect(t).toContain('11 B');
    expect((container.firstElementChild as HTMLElement).style.animation).toBe('');
  });

  it('lets decoded rows directly focus the corresponding A layer', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
    const { getByTestId, getByText } = render(
      <CellDetailPanel cell={base} onClose={() => {}} />,
    );

    fireEvent.click(getByText(/xUDT · ƒ3:4:7/));
    expect(getByTestId('portrait').getAttribute('data-focus')).toBe('asset');
  });

  it('maps memory facets back onto the matching A layers', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
    const { getByTestId, getByRole } = render(
      <CellDetailPanel cell={base} onClose={() => {}} />,
    );

    fireEvent.click(getByRole('button', { name: 'inspect content' }));
    expect(getByTestId('portrait').getAttribute('data-focus')).toBe('data');
    fireEvent.click(getByRole('button', { name: 'inspect anchor' }));
    expect(getByTestId('portrait').getAttribute('data-focus')).toBe('born');
    fireEvent.click(getByRole('button', { name: 'inspect address' }));
    expect(getByTestId('portrait').getAttribute('data-focus')).toBe('state');
  });

  it('shows SPENT for a consumed cell without biological death language', () => {
    const dead = { ...base, death_at_ms: 5000 };
    const { container } = render(<CellDetailPanel cell={dead} onClose={() => {}} />);
    expect(container.textContent ?? '').toContain('SPENT');
    expect(container.textContent ?? '').not.toContain('DYING');
  });

  it('shows retained write evidence only for the exact Cell origin', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
    const origin: CellLink = {
      seq: 18,
      tx_hash: base.out_point.tx_hash,
      block: base.birth_block,
      from_ids: [1, 2],
      to_ids: [base.id],
      parents: [],
      tag: base.tag,
      at_ms: 12_000,
    };
    const { container } = render(
      <CellDetailPanel cell={base} recentLinks={[origin]} onClose={() => {}} />,
    );
    const t = container.textContent ?? '';
    expect(t).toContain('WRITE OBSERVED');
    expect(t).toContain(`#${base.birth_block} · 2→1`);
    expect(container.querySelector('[data-write-observed="true"]')).not.toBeNull();
  });

  it('requests a display-only causal recall and marks the selected trace', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
    const onTraceWrite = vi.fn();
    const origin: CellLink = {
      seq: 18,
      tx_hash: base.out_point.tx_hash,
      block: base.birth_block,
      from_ids: [1, 2],
      to_ids: [base.id],
      parents: [],
      tag: base.tag,
      at_ms: 12_000,
    };
    const { container, getByRole } = render(
      <CellDetailPanel
        cell={base}
        recentLinks={[origin]}
        tracedWriteSeq={origin.seq}
        traceSource="input"
        traceReadout={traceReadout()}
        onTraceWrite={onTraceWrite}
        onClose={() => {}}
      />,
    );

    fireEvent.click(getByRole('button', { name: 'exit causal recall' }));
    expect(onTraceWrite).toHaveBeenCalledWith(origin.seq);
    expect(container.textContent).toContain('READING RETAINED RECORD · EXIT');
    expect(container.textContent).toContain('SCANNING RETAINED RECORD');
    expect(container.textContent).toContain('EVIDENCE 0/2');
    const trace = container.querySelector('[data-trace-selected="true"]');
    expect(trace).not.toBeNull();
    expect(trace?.getAttribute('data-trace-source')).toBe('input');
    expect(trace?.getAttribute('data-trace-state')).toBe('active');
    expect(trace?.getAttribute('data-trace-stage')).toBe('reading');
    expect(container.querySelector('[data-memory-read-state="reading"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-memory-evidence]')).toHaveLength(2);
    expect(container.textContent).toContain('EVIDENCE → AGREEMENT');
    expect(container.textContent).toContain('1111111·1111');
  });

  it('advances the explanatory rail through the same convergence stages as the Cell', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
    const origin: CellLink = {
      seq: 18,
      tx_hash: base.out_point.tx_hash,
      block: base.birth_block,
      from_ids: [1, 2],
      to_ids: [base.id],
      parents: [],
      tag: base.tag,
      at_ms: 12_000,
    };
    const props = {
      cell: base,
      recentLinks: [origin],
      tracedWriteSeq: origin.seq,
      traceSource: 'input' as const,
      traceResponseRef: { current: null },
      onTraceWrite: () => {},
      onClose: () => {},
    };
    const { container, rerender } = render(
      <CellDetailPanel {...props} traceReadout={traceReadout()} />,
    );

    rerender(<CellDetailPanel
      {...props}
      traceReadout={traceReadout({
        stage: 'converging',
        arrivedSourceCount: 1,
      })}
    />);
    expect(container.textContent).toContain('RECONCILING EVIDENCE');
    expect(container.textContent).toContain('ARRIVED 1/2');
    expect(container.textContent).toContain('CONVERGING 1/2 EVIDENCE · EXIT');
    expect(container.querySelector('[data-memory-stage="reading"]')
      ?.getAttribute('data-memory-stage-state')).toBe('past');
    expect(container.querySelector('[data-memory-stage="converging"]')
      ?.getAttribute('data-memory-stage-state')).toBe('active');
    expect(container.querySelector('[data-testid="portrait"]')
      ?.getAttribute('data-trace-stage')).toBe('converging');
    expect(container.querySelector('[data-testid="portrait"]')
      ?.getAttribute('data-response-ref')).toBe('true');
    expect(container.querySelector('[data-memory-evidence="1"]')
      ?.getAttribute('data-memory-evidence-state')).toBe('arrived');
    expect(container.querySelector('[data-memory-evidence="2"]')
      ?.getAttribute('data-memory-evidence-state')).toBe('routing');
    expect(container.querySelector('[data-memory-evidence="1"]')
      ?.getAttribute('data-memory-evidence-knot')).toMatch(/^\d+$/);

    rerender(<CellDetailPanel
      {...props}
      traceReadout={traceReadout({
        stage: 'locked',
        arrivedSourceCount: 2,
        resolvedSourceCount: 2,
      })}
    />);
    expect(container.textContent).toContain('CONSENSUS RECORD RESOLVED');
    expect(container.textContent).toContain('VERIFIED 2/2');
    expect(container.textContent).toContain('CONSENSUS LOCKED · EXIT');
    expect(container.querySelector('[data-memory-stage="locked"]')
      ?.getAttribute('data-memory-stage-state')).toBe('active');
    expect(container.querySelector('[data-memory-read-state="locked"]')
      ?.getAttribute('data-memory-resolved')).toBe('2');
    expect(container.querySelector('[data-testid="portrait"]')
      ?.getAttribute('data-trace-stage')).toBe('locked');
    expect(Array.from(container.querySelectorAll('[data-memory-evidence]')).every(
      (node) => node.getAttribute('data-memory-evidence-state') === 'resolved',
    )).toBe(true);
  });

  it('focuses one real evidence source by pointer or keyboard and forwards it to the portrait', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
    const origin: CellLink = {
      seq: 18,
      tx_hash: base.out_point.tx_hash,
      block: base.birth_block,
      from_ids: [1, 2],
      to_ids: [base.id],
      parents: [],
      tag: base.tag,
      at_ms: 12_000,
    };
    const onTraceEvidenceFocusChange = vi.fn();
    const onTraceRouteHopFocusChange = vi.fn();
    const onTraceRouteHopLockChange = vi.fn();
    const props = {
      cell: base,
      recentLinks: [origin],
      tracedWriteSeq: origin.seq,
      traceSource: 'input' as const,
      traceReadout: traceReadout(),
      onTraceWrite: () => {},
      onTraceEvidenceFocusChange,
      onTraceRouteHopFocusChange,
      onTraceRouteHopLockChange,
      onClose: () => {},
    };
    const { container, rerender, getByTestId } = render(
      <CellDetailPanel {...props} />,
    );
    const first = container.querySelector<HTMLElement>('[data-memory-evidence="1"]')!;
    const second = container.querySelector<HTMLElement>('[data-memory-evidence="2"]')!;

    expect(first.tagName).toBe('BUTTON');
    expect(first.getAttribute('data-memory-evidence-focus')).toBe('idle');
    fireEvent.pointerEnter(first);
    expect(onTraceEvidenceFocusChange).toHaveBeenLastCalledWith(11);

    rerender(<CellDetailPanel {...props} traceEvidenceFocusSourceId={11} />);
    expect(container.querySelector('[data-memory-evidence="1"]')
      ?.getAttribute('data-memory-evidence-focus')).toBe('active');
    expect(container.querySelector('[data-memory-evidence="2"]')
      ?.getAttribute('data-memory-evidence-focus')).toBe('passive');
    expect(getByTestId('portrait').getAttribute('data-evidence-focus-source')).toBe('11');
    const proof = container.querySelector('[data-memory-evidence-route-proof="true"]');
    expect(proof?.textContent).toContain('CELL #11 → #4242');
    expect(proof?.textContent).toContain('02 HOPS · 520 MS');
    expect(proof?.textContent).toContain('SOURCE 0x1111…11111111#0 · BLOCK #100');
    expect(container.querySelector('[data-memory-evidence="1"]')
      ?.getAttribute('data-memory-evidence-route')).toBe('11>99>4242');
    expect(container.querySelector('[data-memory-evidence="1"]')
      ?.getAttribute('data-memory-evidence-source-outpoint'))
      .toBe(`0x${'1'.repeat(64)}#0`);
    const activeFirst = container.querySelector<HTMLElement>('[data-memory-evidence="1"]')!;
    expect(activeFirst.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(activeFirst);
    expect(activeFirst.getAttribute('aria-expanded')).toBe('true');
    const routeLedger = container.querySelector('[data-memory-evidence-route-ledger="true"]');
    expect(routeLedger?.textContent).toContain('03 CELLS · H02');
    const routeCells = routeLedger?.querySelectorAll('[data-memory-evidence-route-cell]');
    expect(Array.from(routeCells ?? []).map((node) => (
      node.getAttribute('data-memory-evidence-route-cell')
    ))).toEqual(['11', '99', '4242']);
    expect(routeCells?.[0].getAttribute('data-memory-evidence-route-role')).toBe('source');
    expect(routeCells?.[1].getAttribute('data-memory-evidence-route-hop')).toBe('1');
    expect(routeCells?.[2].getAttribute('data-memory-evidence-route-role')).toBe('target');
    expect(routeCells?.[1].tagName).toBe('BUTTON');
    fireEvent.pointerEnter(routeCells![1]);
    expect(onTraceRouteHopFocusChange).toHaveBeenLastCalledWith({
      traceKey: `18:${base.id}:1`,
      sourceId: 11,
      targetCellId: base.id,
      cellId: 99,
      hopIndex: 1,
    });
    rerender(<CellDetailPanel
      {...props}
      traceEvidenceFocusSourceId={11}
      traceRouteHopFocus={{
        traceKey: `18:${base.id}:1`,
        sourceId: 11,
        targetCellId: base.id,
        cellId: 99,
        hopIndex: 1,
      }}
    />);
    const focusedTransit = container.querySelector<HTMLElement>(
      '[data-memory-evidence-route-cell="99"]',
    )!;
    expect(focusedTransit.getAttribute('data-memory-evidence-route-focus')).toBe('preview');
    expect(focusedTransit.getAttribute('aria-pressed')).toBe('false');
    expect(container.querySelector('[data-memory-evidence-route-ledger="true"]')
      ?.textContent).toContain('H01 · CELL #99');
    expect(onTraceEvidenceFocusChange).toHaveBeenLastCalledWith(11);
    fireEvent.pointerLeave(focusedTransit, { relatedTarget: routeLedger });
    expect(onTraceRouteHopFocusChange).toHaveBeenLastCalledWith(null);
    focusedTransit.focus();
    expect(onTraceRouteHopFocusChange).toHaveBeenLastCalledWith({
      traceKey: `18:${base.id}:1`,
      sourceId: 11,
      targetCellId: base.id,
      cellId: 99,
      hopIndex: 1,
    });
    activeFirst.focus();
    expect(onTraceRouteHopFocusChange).toHaveBeenLastCalledWith(null);
    expect(onTraceEvidenceFocusChange).toHaveBeenLastCalledWith(11);
    fireEvent.click(routeLedger!);
    expect(container.querySelector('[data-memory-evidence-route-ledger="true"]')).not.toBeNull();
    fireEvent.keyDown(activeFirst, { key: 'Escape' });
    expect(activeFirst.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('[data-memory-evidence-route-ledger="true"]')).toBeNull();
    fireEvent.click(activeFirst);
    expect(activeFirst.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(activeFirst);
    expect(activeFirst.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('[data-memory-evidence-route-ledger="true"]')).toBeNull();

    fireEvent.pointerLeave(container.querySelector('[data-memory-evidence-wrapper="1"]')!);
    expect(onTraceEvidenceFocusChange).toHaveBeenLastCalledWith(11);
    fireEvent.blur(activeFirst);
    expect(onTraceEvidenceFocusChange).toHaveBeenLastCalledWith(null);
    second.focus();
    expect(document.activeElement).toBe(second);
    expect(onTraceEvidenceFocusChange).toHaveBeenLastCalledWith(12);
    fireEvent.pointerEnter(container.querySelector('[data-memory-evidence="1"]')!);
    expect(onTraceEvidenceFocusChange).toHaveBeenLastCalledWith(11);
    fireEvent.pointerLeave(container.querySelector('[data-memory-evidence="1"]')!);
    expect(onTraceEvidenceFocusChange).toHaveBeenLastCalledWith(12);
    fireEvent.blur(second);
    expect(onTraceEvidenceFocusChange).toHaveBeenLastCalledWith(null);
  });

  it('separates route preview from lock and steps a locked inspector by keyboard', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
    const origin: CellLink = {
      seq: 18,
      tx_hash: base.out_point.tx_hash,
      block: base.birth_block,
      from_ids: [1],
      to_ids: [base.id],
      parents: [],
      tag: base.tag,
      at_ms: 12_000,
    };
    const onTraceRouteHopFocusChange = vi.fn();
    const onTraceRouteHopLockChange = vi.fn();
    const props = {
      cell: base,
      recentLinks: [origin],
      tracedWriteSeq: origin.seq,
      traceSource: 'input' as const,
      traceReadout: traceReadout(),
      traceEvidenceFocusSourceId: 11,
      onTraceEvidenceFocusChange: vi.fn(),
      onTraceRouteHopFocusChange,
      onTraceRouteHopLockChange,
      onTraceWrite: () => {},
      onClose: () => {},
    };
    const transitFocus = {
      traceKey: `18:${base.id}:1`,
      sourceId: 11,
      targetCellId: base.id,
      cellId: 99,
      hopIndex: 1,
    };
    const targetFocus = {
      ...transitFocus,
      cellId: base.id,
      hopIndex: 2,
    };
    const { container, rerender } = render(<CellDetailPanel {...props} />);
    fireEvent.click(container.querySelector('[data-memory-evidence="1"]')!);

    const transit = container.querySelector<HTMLElement>(
      '[data-memory-evidence-route-cell="99"]',
    )!;
    fireEvent.pointerEnter(transit);
    expect(onTraceRouteHopFocusChange).toHaveBeenLastCalledWith(transitFocus);
    expect(transit.getAttribute('data-memory-evidence-route-focus')).toBe('idle');
    fireEvent.click(transit);
    expect(onTraceRouteHopLockChange).toHaveBeenLastCalledWith(transitFocus);

    rerender(
      <CellDetailPanel
        {...props}
        traceRouteHopFocus={transitFocus}
        traceRouteHopLock={transitFocus}
      />,
    );
    const lockedTransit = container.querySelector<HTMLElement>(
      '[data-memory-evidence-route-cell="99"]',
    )!;
    expect(lockedTransit.getAttribute('data-memory-evidence-route-focus')).toBe('locked');
    expect(lockedTransit.getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector<HTMLButtonElement>('[data-memory-evidence="2"]')
      ?.disabled).toBe(true);
    expect(container.textContent).toContain('LOCK H01 · CELL #99');
    expect(container.textContent).toContain('←/→ STEP · ESC RELEASE');

    fireEvent.keyDown(lockedTransit, { key: 'ArrowRight' });
    expect(onTraceRouteHopLockChange).toHaveBeenLastCalledWith(targetFocus);
    expect(onTraceRouteHopFocusChange).toHaveBeenLastCalledWith(targetFocus);
    expect(document.activeElement).toBe(container.querySelector(
      `[data-memory-evidence-route-cell="${base.id}"]`,
    ));

    rerender(
      <CellDetailPanel
        {...props}
        traceRouteHopFocus={targetFocus}
        traceRouteHopLock={targetFocus}
      />,
    );
    const lockedTarget = container.querySelector<HTMLElement>(
      `[data-memory-evidence-route-cell="${base.id}"]`,
    )!;
    fireEvent.keyDown(lockedTarget, { key: 'Escape' });
    expect(onTraceRouteHopLockChange).toHaveBeenLastCalledWith(null);
    expect(onTraceRouteHopFocusChange).toHaveBeenLastCalledWith(null);
    expect(container.querySelector('[data-memory-evidence-route-ledger="true"]'))
      .not.toBeNull();
  });

  it('keeps every retained hop inspectable inside a bounded route ledger', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
    const origin: CellLink = {
      seq: 18,
      tx_hash: base.out_point.tx_hash,
      block: base.birth_block,
      from_ids: [1],
      to_ids: [base.id],
      parents: [],
      tag: base.tag,
      at_ms: 12_000,
    };
    const route = Array.from({ length: 41 }, (_, index) => (
      index === 0 ? 11 : index === 40 ? base.id : 1_000 + index
    ));
    const baseline = traceReadout({ sourceCount: 1 });
    const readout = traceReadout({
      sourceCount: 1,
      evidence: [{
        ...baseline.evidence[0],
        route,
        hopCount: 40,
        routeDurationMs: 10_000,
      }],
    });
    const transitRecord: Cell = {
      ...base,
      id: route[20],
      birth_block: 16_200_020,
      death_at_ms: 24_000,
      out_point: { tx_hash: `0x${'55'.repeat(32)}`, index: 1 },
      content_hash: `0x${'55'.repeat(32)}`,
    };
    const onTraceRouteHopFocusChange = vi.fn();
    const onTraceRouteHopLockChange = vi.fn();
    const routeCellById = new Map([[transitRecord.id, transitRecord]]);
    const panel = (lockedFocus: {
      traceKey: string;
      sourceId: number;
      targetCellId: number;
      cellId: number;
      hopIndex: number;
    } | null = null, records: ReadonlyMap<number, Cell> = routeCellById) => (
      <CellDetailPanel
        cell={base}
        routeCellById={records}
        recentLinks={[origin]}
        tracedWriteSeq={origin.seq}
        traceSource="input"
        traceReadout={readout}
        traceEvidenceFocusSourceId={11}
        traceRouteHopFocus={lockedFocus}
        traceRouteHopLock={lockedFocus}
        onTraceEvidenceFocusChange={() => {}}
        onTraceRouteHopFocusChange={onTraceRouteHopFocusChange}
        onTraceRouteHopLockChange={onTraceRouteHopLockChange}
        onTraceWrite={() => {}}
        onClose={() => {}}
      />
    );
    const { container, rerender } = render(panel());

    fireEvent.click(container.querySelector('[data-memory-evidence="1"]')!);
    const ledger = container.querySelector('[data-memory-evidence-route-ledger="true"]');
    const cells = ledger?.querySelectorAll('[data-memory-evidence-route-cell]');
    expect(ledger?.textContent).toContain('41 CELLS · H40');
    expect(cells).toHaveLength(41);
    expect(cells?.[0].getAttribute('data-memory-evidence-route-cell')).toBe('11');
    expect(cells?.[40].getAttribute('data-memory-evidence-route-cell')).toBe(String(base.id));
    expect((ledger?.querySelector('[data-memory-evidence-route-cells="true"]') as HTMLElement)
      .style.maxHeight).toBe('48px');

    const lockedFocus = {
      traceKey: readout.key,
      sourceId: 11,
      targetCellId: base.id,
      cellId: route[20],
      hopIndex: 20,
    };
    rerender(panel(lockedFocus));
    const lens = container.querySelector<HTMLElement>(
      '[data-memory-evidence-route-mode="lens"]',
    )!;
    const lensCells = lens.querySelectorAll('[data-memory-evidence-route-cell]');
    expect(lens.getAttribute('data-memory-evidence-route-window-start')).toBe('18');
    expect(lens.getAttribute('data-memory-evidence-route-window-end')).toBe('22');
    expect(lens.getAttribute('data-memory-evidence-route-hidden-before')).toBe('18');
    expect(lens.getAttribute('data-memory-evidence-route-hidden-after')).toBe('18');
    expect(Array.from(lensCells).map((node) => (
      node.getAttribute('data-memory-evidence-route-hop')
    ))).toEqual(['18', '19', '20', '21', '22']);
    expect(lens.textContent).toContain('18 PRIOR');
    expect(lens.textContent).toContain('18 NEXT');
    const progress = container.querySelector<HTMLElement>(
      '[data-memory-evidence-route-progress="true"]',
    )!;
    expect(progress.getAttribute('aria-valuenow')).toBe('20');
    expect(progress.getAttribute('aria-valuemax')).toBe('40');
    expect(progress.getAttribute('data-memory-evidence-route-progress-value'))
      .toBe('0.5000');
    expect(progress.querySelector<HTMLElement>(
      '[data-memory-evidence-route-progress-marker="true"]',
    )?.style.left).toBe('50%');
    const inspector = container.querySelector<HTMLElement>(
      '[data-memory-evidence-route-hop-inspector="true"]',
    )!;
    expect(inspector.getAttribute('data-memory-evidence-route-hop-role'))
      .toBe('transit');
    expect(inspector.getAttribute('data-memory-evidence-route-hop-semantic'))
      .toBe('display-carrier');
    expect(inspector.getAttribute('data-memory-evidence-route-hop-record'))
      .toBe('available');
    expect(inspector.getAttribute('data-memory-evidence-route-hop-content-hash'))
      .toBe(transitRecord.content_hash);
    expect(inspector.getAttribute('data-memory-evidence-route-hop-distance-source'))
      .toBe('20');
    expect(inspector.getAttribute('data-memory-evidence-route-hop-distance-target'))
      .toBe('20');
    expect(inspector.textContent).toContain('DISPLAY CARRIER');
    expect(inspector.textContent).toContain('VISUAL LANE · NO CAUSAL CLAIM');
    expect(inspector.textContent).toContain('5555555·5555');
    expect(inspector.textContent).toContain('BLOCK #16200020 · SPENT');

    fireEvent.keyDown(lens.querySelector(
      '[data-memory-evidence-route-hop="20"]',
    )!, { key: 'ArrowRight' });
    expect(onTraceRouteHopLockChange).toHaveBeenLastCalledWith({
      ...lockedFocus,
      cellId: route[21],
      hopIndex: 21,
    });
    expect(onTraceRouteHopFocusChange).toHaveBeenLastCalledWith({
      ...lockedFocus,
      cellId: route[21],
      hopIndex: 21,
    });

    const sourceFocus = {
      ...lockedFocus,
      cellId: route[0],
      hopIndex: 0,
    };
    rerender(panel(sourceFocus));
    const sourceInspector = container.querySelector<HTMLElement>(
      '[data-memory-evidence-route-hop-inspector="true"]',
    )!;
    expect(sourceInspector.getAttribute('data-memory-evidence-route-hop-role'))
      .toBe('source');
    expect(sourceInspector.getAttribute('data-memory-evidence-route-hop-record'))
      .toBe('evidence-only');
    expect(sourceInspector.textContent).toContain('EVIDENCE SOURCE');
    expect(sourceInspector.textContent).toContain('REAL RETAINED EVIDENCE');

    const targetFocus = {
      ...lockedFocus,
      cellId: route[40],
      hopIndex: 40,
    };
    rerender(panel(targetFocus));
    const targetInspector = container.querySelector<HTMLElement>(
      '[data-memory-evidence-route-hop-inspector="true"]',
    )!;
    expect(targetInspector.getAttribute('data-memory-evidence-route-hop-role'))
      .toBe('target');
    expect(targetInspector.getAttribute('data-memory-evidence-route-hop-record'))
      .toBe('available');
    expect(targetInspector.textContent).toContain('MAINTAINED RECORD');
    expect(targetInspector.textContent).toContain('REAL TARGET RECORD');
    expect(targetInspector.textContent).toContain('BLOCK #16204800 · LIVE');

    rerender(panel(lockedFocus, new Map()));
    const missingInspector = container.querySelector<HTMLElement>(
      '[data-memory-evidence-route-hop-inspector="true"]',
    )!;
    expect(missingInspector.getAttribute('data-memory-evidence-route-hop-record'))
      .toBe('unavailable');
    expect(missingInspector.textContent).toContain('UNAVAILABLE');
    expect(missingInspector.textContent).toContain('OUT OF VIEW');
  });

  it('labels surviving parent evidence as a lineage witness, not an input', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
    const origin: CellLink = {
      seq: 19,
      tx_hash: base.out_point.tx_hash,
      block: base.birth_block,
      from_ids: [1],
      to_ids: [base.id],
      parents: ['0xparent'],
      tag: base.tag,
      at_ms: 12_000,
    };
    const { container } = render(
      <CellDetailPanel
        cell={base}
        recentLinks={[origin]}
        traceSource="witness"
        onTraceWrite={() => {}}
        onClose={() => {}}
      />,
    );

    expect(container.textContent).toContain('RECALL LINEAGE WITNESS');
    expect(container.querySelector('[data-trace-source="witness"]')).not.toBeNull();
  });

  it('tolerates missing lock/asset with an em dash', () => {
    const bare = { ...base, lock_kind: undefined, asset_kind: undefined };
    const { container } = render(<CellDetailPanel cell={bare} onClose={() => {}} />);
    expect(container.textContent ?? '').toContain('—');
  });

  it('close button fires onClose', () => {
    const onClose = vi.fn();
    const { getByRole } = render(<CellDetailPanel cell={base} onClose={onClose} />);
    getByRole('button', { name: 'close' }).click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
