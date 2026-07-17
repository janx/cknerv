import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import type { Cell, CellLink } from '@cknerv/types';

// The embedded portrait spins a real WebGL context — stub it in jsdom.
vi.mock('../../../src/components/hud/CellNucleusPortrait', () => ({
  default: ({ cell, focusField }: {
    cell: { content_hash: string };
    focusField?: string | null;
  }) => (
    <div
      data-testid="portrait"
      data-hash={cell.content_hash}
      data-focus={focusField ?? ''}
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
        onTraceWrite={onTraceWrite}
        onClose={() => {}}
      />,
    );

    fireEvent.click(getByRole('button', { name: 'recall causal path' }));
    expect(onTraceWrite).toHaveBeenCalledWith(origin.seq);
    expect(container.textContent).toContain('TRACE SELECTED · RECALL AGAIN');
    const trace = container.querySelector('[data-trace-selected="true"]');
    expect(trace).not.toBeNull();
    expect(trace?.getAttribute('data-trace-source')).toBe('input');
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
