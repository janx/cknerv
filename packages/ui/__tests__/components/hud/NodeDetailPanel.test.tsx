import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import type { ChainEntry, ChainNode } from '@cknerv/types';
import NodeDetailPanel from '../../../src/components/hud/NodeDetailPanel';

afterEach(cleanup);

const node: ChainNode = { id: 'ckb:0123456789abcdef', label: 'local', is_miner: false, version: '0.201.0', connections: 47 };
const chain = { tip: 16204887, chain_name: 'ckb', epoch: { number: 11042, index: 842, length: 1800 } } as unknown as ChainEntry;

describe('NodeDetailPanel', () => {
  it('renders node fields and closes', () => {
    const onClose = vi.fn();
    const { container, getByRole } = render(<NodeDetailPanel node={node} chain={chain} onClose={onClose} />);
    const t = container.textContent ?? '';
    expect(t).toContain('NODE');
    expect(t).toContain('节点');
    expect(t).toContain('local');
    expect(t).toContain('OBSERVER');
    expect(t).toContain('ckb');
    expect(t).toContain('11042.842/1800');
    getByRole('button', { name: 'close' }).click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
