import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import type { Cell } from '@cknerv/types';

// The embedded portrait spins a real WebGL context — stub it in jsdom.
vi.mock('../../../src/components/hud/CellNucleusPortrait', () => ({
  default: ({ contentHash }: { contentHash: string }) => (
    <div data-testid="portrait" data-hash={contentHash} />
  ),
  SCAN_PERIOD_S: 4.0,
}));

import CellDetailPanel from '../../../src/components/hud/CellDetailPanel';

afterEach(() => { cleanup(); vi.useRealTimers(); });

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
    expect(t).toContain('ALIVE');          // STATE
    expect(t).toContain('3h 12m');         // AGE
    expect(t).toContain('#16204800');      // BORN
    expect(t).toContain('#2');             // SOURCE index
    expect(t).toContain('11 B');           // DATA — 22 hex chars = 11 bytes
  });

  it('shows DYING for a dead cell', () => {
    const dead = { ...base, death_at_ms: 5000 };
    const { container } = render(<CellDetailPanel cell={dead} onClose={() => {}} />);
    expect(container.textContent ?? '').toContain('DYING');
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
