import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import type { Cell } from '@cknerv/types';
import CellDetailPanel from '../../../src/components/hud/CellDetailPanel';

afterEach(cleanup);

const cell: Cell = {
  id: 4242, born_at_ms: 0, death_at_ms: null, birth_block: 16204800,
  tag: 'wallet', pos_seed: [0, 0, 0],
  out_point: { tx_hash: '0x' + 'ab'.repeat(32), index: 2 },
  capacity: 12300000000, data_hex: '0xdeadbeefcafe1234567890', content_hash: '0x' + '00'.repeat(32),
};

describe('CellDetailPanel', () => {
  it('renders the cell fields and closes', () => {
    const onClose = vi.fn();
    const { container, getByRole } = render(<CellDetailPanel cell={cell} onClose={onClose} />);
    const t = container.textContent ?? '';
    expect(t).toContain('CELL');
    expect(t).toContain('细胞');
    expect(t).toContain('WALLET');         // KIND
    expect(t).toContain('#16204800');      // BLOCK
    expect(t).toContain('#2');             // OUTPOINT index
    expect(t).toContain('ALIVE');          // STATE
    expect(t).toContain('123.00 CKB');     // CAPACITY
    getByRole('button', { name: 'close' }).click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
