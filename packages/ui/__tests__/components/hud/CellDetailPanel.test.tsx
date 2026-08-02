import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import type { Cell, CellLink } from '@cknerv/types';
import type { ConsensusMemoryTraceReadout } from '../../../src/nerve/consensusMemoryTrace';
import type {
  CellIdentityBindingPhase,
  CellIdentityProofBinding,
} from '../../../src/derives/cellIdentityProof.derive';
import { PROBE_STEP_S } from '../../../src/components/hud/probeScan';

// The embedded portrait spins a real WebGL context — stub it in jsdom.
vi.mock('../../../src/components/hud/CellNucleusPortrait', () => ({
  default: ({ cell, focusField, traceReadout, traceResponseRef, traceEvidenceFocusSourceId, identityProofBinding, onIdentityProofRead }: {
    cell: { content_hash: string };
    focusField?: string | null;
    traceReadout?: { stage: string } | null;
    traceResponseRef?: { current: unknown };
    traceEvidenceFocusSourceId?: number | null;
    identityProofBinding?: CellIdentityProofBinding | null;
    onIdentityProofRead?: (
      kind: 'address' | 'content' | 'anchor',
    ) => void;
  }) => (
    <div
      data-testid="portrait"
      data-hash={cell.content_hash}
      data-focus={focusField ?? ''}
      data-trace-stage={traceReadout?.stage ?? ''}
      data-response-ref={traceResponseRef ? 'true' : 'false'}
      data-evidence-focus-source={traceEvidenceFocusSourceId ?? ''}
      data-identity-phase={identityProofBinding?.phase ?? 'idle'}
      data-identity-count={identityProofBinding?.resolvedKinds.length ?? 0}
    >
      {(['address', 'content', 'anchor'] as const).map((kind) => (
        <button
          key={kind}
          type="button"
          data-testid={`${kind}-proof-read-resolved`}
          onClick={() => onIdentityProofRead?.(kind)}
        />
      ))}
    </div>
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

function identityBinding(
  phase: CellIdentityBindingPhase = 'verified',
): CellIdentityProofBinding {
  return {
    cellId: base.id,
    resolvedKinds: ['address', 'content', 'anchor'],
    phase,
    revision: 3,
    changedAtMs: 100,
    lastResolvedKind: 'anchor',
    reducedMotion: true,
  };
}

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
    expect(getByTestId('portrait').getAttribute('data-focus')).toBe('');
    expect((container.firstElementChild as HTMLElement).style.animation)
      .toContain('cknerv-cell-consensus-enter');
  });

  it('keeps auxiliary portrait focus off while the entry decoder advances', () => {
    const performanceNow = vi.spyOn(performance, 'now').mockReturnValue(0);
    const { container, getByTestId } = render(
      <CellDetailPanel cell={base} onClose={() => {}} />,
    );

    expect(getByTestId('portrait').getAttribute('data-focus')).toBe('');
    performanceNow.mockReturnValue(PROBE_STEP_S * 2.5 * 1000);
    act(() => {
      vi.advanceTimersByTime(80);
    });
    expect(container.textContent).toContain('READING IDENTITY');
    expect(getByTestId('portrait').getAttribute('data-focus')).toBe('');
    performanceNow.mockRestore();
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

  it('reports each exact Cell proof only after the portrait resolves it', () => {
    vi.stubGlobal('matchMedia', () => ({
      matches: true,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    const onIdentityProofRead = vi.fn();
    const { getByRole, getByTestId } = render(
      <CellDetailPanel
        cell={base}
        onIdentityProofRead={onIdentityProofRead}
        onClose={() => {}}
      />,
    );

    for (const kind of ['address', 'content', 'anchor'] as const) {
      fireEvent.click(getByRole('button', { name: `inspect ${kind}` }));
      fireEvent.click(getByTestId(`${kind}-proof-read-resolved`));
    }
    expect(onIdentityProofRead.mock.calls).toEqual([
      ['address', base.id, true],
      ['content', base.id, true],
      ['anchor', base.id, true],
    ]);
  });

  it('binds causal recall to all three resolved identity facets', () => {
    vi.stubGlobal('matchMedia', () => ({
      matches: true,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    const origin: CellLink = {
      seq: 18,
      tx_hash: base.out_point.tx_hash,
      block: base.birth_block,
      from_ids: [1, 2],
      to_ids: [base.id],
      endpoint_anchors: [],
      parents: [],
      tag: base.tag,
      at_ms: 12_000,
    };
    const onTraceWrite = vi.fn();
    const partial: CellIdentityProofBinding = {
      ...identityBinding(),
      resolvedKinds: ['address'],
      phase: 'collecting',
      revision: 1,
      lastResolvedKind: 'address',
    };
    const props = {
      cell: base,
      recentLinks: [origin],
      traceSource: 'input' as const,
      onTraceWrite,
      onClose: () => {},
    };
    const { container, getByRole, getByTestId, rerender } = render(
      <CellDetailPanel {...props} identityProofBinding={partial} />,
    );

    const recall = getByRole('button', { name: 'recall causal path' });
    expect((recall as HTMLButtonElement).disabled).toBe(true);
    expect(container.querySelector('[data-memory-identity-binding="true"]')
      ?.getAttribute('data-memory-identity-count')).toBe('1');
    expect(container.querySelector('[data-memory-identity-proof="address"]')
      ?.getAttribute('data-memory-identity-proof-state')).toBe('resolved');
    expect(container.querySelector('[data-memory-identity-proof="content"]')
      ?.getAttribute('data-memory-identity-proof-state')).toBe('pending');
    expect(container.textContent).toContain(
      'VERIFY WHERE / WHAT / WHEN TO RECALL',
    );
    expect(getByTestId('portrait').getAttribute('data-identity-count')).toBe('1');

    rerender(
      <CellDetailPanel
        {...props}
        identityProofBinding={identityBinding()}
      />,
    );
    expect((
      getByRole('button', { name: 'recall causal path' }) as HTMLButtonElement
    ).disabled).toBe(false);
    expect(container.textContent).toContain(
      'IDENTITY BOUND · MEMORY ROUTE READY',
    );
    fireEvent.click(getByRole('button', { name: 'recall causal path' }));
    expect(onTraceWrite).toHaveBeenCalledWith(origin.seq);

    rerender(
      <CellDetailPanel
        {...props}
        identityProofBinding={identityBinding('retained')}
      />,
    );
    expect(container.textContent).toContain(
      'RETAINED MEMORY · REPLAY CAUSAL PATH',
    );
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
      endpoint_anchors: [],
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
      endpoint_anchors: [],
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
        identityProofBinding={identityBinding('recalling')}
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
      endpoint_anchors: [],
      parents: [],
      tag: base.tag,
      at_ms: 12_000,
    };
    const props = {
      cell: base,
      recentLinks: [origin],
      tracedWriteSeq: origin.seq,
      traceSource: 'input' as const,
      identityProofBinding: identityBinding('recalling'),
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
      endpoint_anchors: [],
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
      identityProofBinding: identityBinding('recalling'),
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

  it('previews a scene agreement in the ledger without replacing the locked evidence route', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
    const origin: CellLink = {
      seq: 18,
      tx_hash: base.out_point.tx_hash,
      block: base.birth_block,
      from_ids: [1, 2],
      to_ids: [base.id],
      endpoint_anchors: [],
      parents: [],
      tag: base.tag,
      at_ms: 12_000,
    };
    const lockedHop = {
      traceKey: `18:${base.id}:1`,
      sourceId: 11,
      targetCellId: base.id,
      cellId: base.id,
      hopIndex: 2,
    };
    const props = {
      cell: base,
      recentLinks: [origin],
      tracedWriteSeq: origin.seq,
      traceSource: 'input' as const,
      identityProofBinding: identityBinding('recalling'),
      traceReadout: traceReadout(),
      traceEvidenceFocusSourceId: 11,
      traceRouteHopLock: lockedHop,
      onTraceEvidenceFocusChange: vi.fn(),
      onTraceRouteHopLockChange: vi.fn(),
      onTraceWrite: () => {},
      onClose: () => {},
    };
    const { container, getByTestId, rerender } = render(
      <CellDetailPanel {...props} traceEvidencePreviewSourceId={12} />,
    );
    const locked = container.querySelector<HTMLElement>(
      '[data-memory-evidence="1"]',
    )!;
    const preview = container.querySelector<HTMLElement>(
      '[data-memory-evidence="2"]',
    )!;

    expect(locked.getAttribute('data-memory-evidence-focus')).toBe('retained');
    expect(locked.getAttribute('aria-pressed')).toBe('true');
    expect(locked.getAttribute('aria-expanded')).toBe('true');
    expect(locked.closest('[data-memory-evidence-wrapper]')?.querySelector(
      '[data-memory-evidence-route-ledger="true"]',
    )).not.toBeNull();
    expect(preview.getAttribute('data-memory-evidence-focus')).toBe('preview');
    expect(preview.getAttribute('data-memory-evidence-scene-preview')).toBe('true');
    expect(preview.getAttribute('aria-pressed')).toBe('false');
    expect(preview.getAttribute('aria-expanded')).toBe('false');
    expect(preview.textContent).toContain('INSPECT');
    expect(getByTestId('portrait').getAttribute('data-evidence-focus-source')).toBe('11');

    rerender(<CellDetailPanel {...props} traceEvidencePreviewSourceId={11} />);
    expect(container.querySelector('[data-memory-evidence="1"]')
      ?.getAttribute('data-memory-evidence-focus')).toBe('active');
    expect(container.querySelector('[data-memory-evidence-focus="retained"]'))
      .toBeNull();
    expect(container.querySelector(
      '[data-memory-evidence-scene-preview="true"]',
    )).toBeNull();

    rerender(<CellDetailPanel {...props} traceEvidencePreviewSourceId={null} />);
    expect(container.querySelector('[data-memory-evidence="1"]')
      ?.getAttribute('data-memory-evidence-focus')).toBe('active');
    expect(container.querySelector('[data-memory-evidence="2"]')
      ?.getAttribute('data-memory-evidence-focus')).toBe('passive');
    expect(container.querySelector(
      '[data-memory-evidence-scene-preview="true"]',
    )).toBeNull();
    expect(container.querySelector('[data-memory-evidence-route-lock="locked"]')
      ?.getAttribute('data-memory-evidence-route-cell')).toBe(String(base.id));
  });

  it('separates route preview from lock and steps a locked inspector by keyboard', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
    const origin: CellLink = {
      seq: 18,
      tx_hash: base.out_point.tx_hash,
      block: base.birth_block,
      from_ids: [1],
      to_ids: [base.id],
      endpoint_anchors: [],
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
      identityProofBinding: identityBinding('recalling'),
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
    const transitPulseKey = '18:4242:1:11:4242:1:99';
    const transitInspector = container.querySelector<HTMLElement>(
      '[data-memory-evidence-route-hop-inspector="true"]',
    )!;
    expect(lockedTransit.getAttribute('data-memory-evidence-route-pulse-key'))
      .toBe(transitPulseKey);
    expect(transitInspector.getAttribute('data-memory-evidence-route-pulse-key'))
      .toBe(transitPulseKey);
    expect(lockedTransit.style.animation)
      .toContain('cknerv-route-hop-lock-pulse 480ms');
    expect(transitInspector.querySelector<HTMLElement>(
      '[data-memory-evidence-route-pulse-surface="true"]',
    )?.style.animation)
      .toContain('cknerv-route-hop-lock-pulse 480ms');
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
    const targetInspector = container.querySelector<HTMLElement>(
      '[data-memory-evidence-route-hop-inspector="true"]',
    )!;
    expect(lockedTarget.getAttribute('data-memory-evidence-route-pulse-key'))
      .toBe('18:4242:1:11:4242:2:4242');
    expect(targetInspector.getAttribute('data-memory-evidence-route-pulse-key'))
      .toBe(lockedTarget.getAttribute('data-memory-evidence-route-pulse-key'));
    fireEvent.keyDown(lockedTarget, { key: 'Escape' });
    expect(onTraceRouteHopLockChange).toHaveBeenLastCalledWith(null);
    expect(onTraceRouteHopFocusChange).toHaveBeenLastCalledWith(null);
    expect(container.querySelector('[data-memory-evidence-route-ledger="true"]'))
      .not.toBeNull();

    const alternateTargetFocus = {
      ...targetFocus,
      sourceId: 12,
    };
    rerender(
      <CellDetailPanel
        {...props}
        traceEvidenceFocusSourceId={12}
        traceRouteHopFocus={alternateTargetFocus}
        traceRouteHopLock={alternateTargetFocus}
      />,
    );
    expect(container.querySelector('[data-memory-evidence="2"]')
      ?.getAttribute('aria-expanded')).toBe('true');
    expect(Array.from(container.querySelectorAll(
      '[data-memory-evidence-route-cell]',
    )).map((node) => node.getAttribute('data-memory-evidence-route-cell')))
      .toEqual(['12', '99', String(base.id)]);
  });

  it('keeps every retained hop inspectable inside a bounded route ledger', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
    const origin: CellLink = {
      seq: 18,
      tx_hash: base.out_point.tx_hash,
      block: base.birth_block,
      from_ids: [1],
      to_ids: [base.id],
      endpoint_anchors: [],
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
        identityProofBinding={identityBinding('recalling')}
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
    const ledgerViewport = ledger?.querySelector<HTMLElement>(
      '[data-memory-evidence-route-scroll-viewport="true"]',
    );
    const ledgerScroll = ledger?.querySelector<HTMLElement>(
      '[data-memory-evidence-route-scroll="true"]',
    );
    const cells = ledger?.querySelectorAll('[data-memory-evidence-route-cell]');
    expect(ledger?.textContent).toContain('41 CELLS · H40');
    expect((ledger as HTMLElement).style.display).toBe('flex');
    expect(ledgerScroll?.classList.contains(
      'cknerv-memory-route-ledger-scroll',
    )).toBe(true);
    expect(ledgerViewport?.classList.contains(
      'cknerv-memory-route-ledger-viewport',
    )).toBe(true);
    expect(ledgerViewport?.querySelector(
      '[data-memory-evidence-route-scroll-position="true"]',
    )).not.toBeNull();
    expect(ledgerScroll?.contains(cells?.[0] ?? null)).toBe(true);
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
    const lockedLensCell = lens.querySelector<HTMLElement>(
      '[data-memory-evidence-route-lock="locked"]',
    )!;
    expect(ledgerScroll?.contains(inspector)).toBe(true);
    expect(lockedLensCell.getAttribute('data-memory-evidence-route-pulse-key'))
      .toBe(inspector.getAttribute('data-memory-evidence-route-pulse-key'));
    expect(lockedLensCell.style.animation).toBe('');
    expect(inspector.querySelector<HTMLElement>(
      '[data-memory-evidence-route-pulse-surface="true"]',
    )?.style.animation).toBe('');
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

    Object.defineProperties(ledgerScroll!, {
      clientHeight: { configurable: true, value: 72 },
      scrollHeight: { configurable: true, value: 147 },
      scrollTop: { configurable: true, writable: true, value: 0 },
    });
    Object.defineProperties(inspector, {
      offsetTop: { configurable: true, value: 70 },
      offsetHeight: { configurable: true, value: 62 },
    });
    fireEvent.scroll(ledgerScroll!);
    expect(ledgerViewport?.getAttribute(
      'data-memory-evidence-route-scrollable',
    )).toBe('true');
    expect(ledgerViewport?.getAttribute(
      'data-memory-evidence-route-scroll-before',
    )).toBe('false');
    expect(ledgerViewport?.getAttribute(
      'data-memory-evidence-route-scroll-after',
    )).toBe('true');
    expect(ledgerViewport?.style.getPropertyValue(
      '--route-ledger-scroll-progress',
    )).toBe('0.00%');

    fireEvent.resize(window);
    expect(ledgerScroll?.scrollTop).toBe(65);
    expect(ledgerViewport?.style.getPropertyValue(
      '--route-ledger-scroll-progress',
    )).toBe('86.67%');

    ledgerScroll!.scrollTop = 37.5;
    fireEvent.scroll(ledgerScroll!);
    expect(ledgerViewport?.getAttribute(
      'data-memory-evidence-route-scroll-before',
    )).toBe('true');
    expect(ledgerViewport?.getAttribute(
      'data-memory-evidence-route-scroll-after',
    )).toBe('true');
    expect(ledgerViewport?.style.getPropertyValue(
      '--route-ledger-scroll-progress',
    )).toBe('50.00%');

    ledgerScroll!.scrollTop = 75;
    fireEvent.scroll(ledgerScroll!);
    expect(ledgerViewport?.getAttribute(
      'data-memory-evidence-route-scroll-before',
    )).toBe('true');
    expect(ledgerViewport?.getAttribute(
      'data-memory-evidence-route-scroll-after',
    )).toBe('false');
    expect(ledgerViewport?.style.getPropertyValue(
      '--route-ledger-scroll-progress',
    )).toBe('100.00%');

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

    ledgerScroll!.scrollTop = 0;
    const steppedFocus = {
      ...lockedFocus,
      cellId: route[21],
      hopIndex: 21,
    };
    rerender(panel(steppedFocus));
    expect(ledgerScroll?.scrollTop).toBe(65);
    expect(ledgerViewport?.style.getPropertyValue(
      '--route-ledger-scroll-progress',
    )).toBe('86.67%');

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
      endpoint_anchors: [],
      parents: ['0xparent'],
      tag: base.tag,
      at_ms: 12_000,
    };
    const { container } = render(
      <CellDetailPanel
        cell={base}
        recentLinks={[origin]}
        traceSource="witness"
        identityProofBinding={identityBinding()}
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
