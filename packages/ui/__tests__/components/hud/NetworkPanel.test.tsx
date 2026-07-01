import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, it, expect } from 'vitest';
import NetworkPanel from '../../../src/components/hud/NetworkPanel';

afterEach(cleanup);

const props = {
  summary: { peerCount: 47, outbound: 8, inbound: 39, version: '0.201.0', connections: 47, medianPingMs: 84, syncLabel: 'AT TIP', bestKnown: 16204887 },
  consensus: { atTip: 44, behind: 2, ahead: 1, unknown: 0, total: 47, aheadRatio: 0.021, maxAhead: 1 },
  ping: { medianMs: 84, minMs: 12, maxMs: 210 },
  vers: { majorityVersion: '0.201.0', majorityCount: 44, otherCount: 3, total: 47 },
  syncRatio: 0.974,
};

describe('NetworkPanel', () => {
  it('renders the full fleet telemetry', () => {
    const { container } = render(<NetworkPanel {...props} />);
    const t = container.textContent ?? '';
    expect(t).toContain('NEURAL MESH');
    expect(t).toContain('神经元');
    expect(t).toContain('47');
    expect(t).toContain('44 / 47');     // head consensus
    expect(t).toContain('0.201.0');     // majority version
    expect(t).toContain('×3 other');    // version spread
    expect(t).toContain('84ms');        // ping median
    expect(t).toContain('12');          // ping min
  });
});
