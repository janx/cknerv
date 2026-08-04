import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, it, expect } from 'vitest';
import type { EnrichmentSourceStatus, NetworkAtlasRecord } from '@cknerv/types';
import NetworkPanel from '../../../src/components/hud/NetworkPanel';

afterEach(cleanup);

const props = {
  summary: { peerCount: 47, outbound: 8, inbound: 39, version: '0.201.0', connections: 47, medianPingMs: 84, syncLabel: 'AT TIP', bestKnown: 16204887 },
  consensus: { atTip: 44, behind: 2, ahead: 1, unknown: 0, total: 47, aheadRatio: 0.021, maxAhead: 1 },
  ping: { medianMs: 84, minMs: 12, maxMs: 210 },
  vers: { majorityVersion: '0.201.0', majorityCount: 44, otherCount: 3, total: 47 },
  syncRatio: 0.974,
};

const enrichmentSource: EnrichmentSourceStatus = {
  source: 'ckbadger',
  status: 'ready',
  capabilities: ['network_atlas'],
  validated_anchor: { block: 100, hash: `0x${'aa'.repeat(32)}` },
};

const networkAtlas: NetworkAtlasRecord = {
  source: 'ckbadger',
  as_of: enrichmentSource.validated_anchor!,
  updated_at_ms: Date.now(),
  crawl_round: 7,
  crawl_finished_at_s: 1_700_000_000,
  total_known: 42,
  last_round_dialed: 12,
  last_round_reachable: 9,
  new_nodes: 3,
  frontier_drained: true,
  sample_size: 3,
  sample_reachable: 2,
  sample_truncated: true,
  median_rtt_ms: 18,
  countries: [{ label: 'SG', count: 2 }, { label: 'US', count: 1 }],
  versions: [{ label: '0.119.0', count: 2 }, { label: '0.118.0', count: 1 }],
};

describe('NetworkPanel', () => {
  it('renders the full fleet telemetry', () => {
    const { container } = render(<NetworkPanel {...props} />);
    const t = container.textContent ?? '';
    expect(t).toContain('PEER MESH');
    expect(t).toContain('全节点网络');
    expect(t).toContain('47');
    expect(t).toContain('44 / 47');     // head consensus
    expect(t).toContain('0.201.0');     // majority version
    expect(t).toContain('×3 other');    // version spread
    expect(t).toContain('84ms');        // ping median
    expect(t).toContain('12');          // ping min
  });

  it('adds crawler context as a clearly separate bounded sample', () => {
    const { getByLabelText, container } = render(
      <NetworkPanel
        {...props}
        enrichmentSource={enrichmentSource}
        networkAtlas={networkAtlas}
      />,
    );

    expect(getByLabelText('Indexed network atlas').getAttribute(
      'data-network-atlas-state',
    )).toBe('ready');
    const text = container.textContent ?? '';
    expect(text).toContain('INDEXED NETWORK ATLAS');
    expect(text).toContain('CKBADGER CRAWLER · LATEST 3 SAMPLE · BOUNDED');
    expect(text).toContain('9 reachable / 12 dialed');
    expect(text).toContain('SG 2 · US 1');
  });

  it('keeps the current peer panel unchanged without an atlas record', () => {
    const { queryByLabelText } = render(
      <NetworkPanel {...props} enrichmentSource={enrichmentSource} />,
    );
    expect(queryByLabelText('Indexed network atlas')).toBeNull();
  });
});
