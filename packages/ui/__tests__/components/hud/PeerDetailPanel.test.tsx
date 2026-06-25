import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import type { ChainEntry, Peer } from '@cknerv/types';
import PeerDetailPanel from '../../../src/components/hud/PeerDetailPanel';

afterEach(cleanup);

const peer: Peer = { node_id: 'p1', addr: '10.0.0.1:8115', direction: 'outbound', version: '0.201.0', latency_ms: 84, best_known: 16204880, connected_ms: 3_725_000 };
const chain = { tip: 16204887 } as unknown as ChainEntry;

describe('PeerDetailPanel', () => {
  it('renders peer fields, computed sync + uptime, and closes', () => {
    const onClose = vi.fn();
    const { container, getByRole } = render(<PeerDetailPanel peer={peer} chain={chain} onClose={onClose} />);
    const t = container.textContent ?? '';
    expect(t).toContain('PEER');
    expect(t).toContain('对端');
    expect(t).toContain('10.0.0.1:8115');
    expect(t).toContain('OUTBOUND');
    expect(t).toContain('84 ms');
    expect(t).toContain('7 BEHIND');   // 16204887 - 16204880
    expect(t).toContain('1h 2m');      // 3,725,000ms = 62m5s -> 1h 2m
    getByRole('button', { name: 'close' }).click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
