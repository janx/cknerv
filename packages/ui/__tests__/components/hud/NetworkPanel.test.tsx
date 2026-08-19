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
    expect(t).toContain('节点场');
    expect(t).toContain('47');
    expect(t).toContain('44 / 47');     // head consensus
    expect(t).toContain('0.201.0');     // majority version
    expect(t).toContain('×3 other');    // version spread
    expect(t).toContain('84ms');        // ping median
    expect(t).toContain('12');          // ping min
    expect(container.querySelector('[data-network-detail-mode="local"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-network-detail-mode]')).toHaveLength(1);
  });

  it('extends complete local diagnostics into the indexed crawler scope', () => {
    const { getByLabelText, container } = render(
      <NetworkPanel
        {...props}
        colonyCount={128}
        enrichmentSource={enrichmentSource}
        networkAtlas={networkAtlas}
      />,
    );

    expect(getByLabelText('Network atlas').getAttribute(
      'data-network-atlas-state',
    )).toBe('ready');
    const text = container.textContent ?? '';
    expect(text).toContain('NETWORK ATLAS');
    expect(text).toContain('LATEST 3 NODE SAMPLE · BOUNDED');
    expect(text).toContain('9 reachable / 12 dialed');
    expect(text).toContain('SG 2 · US 1');
    // Direct-node detail remains available and is explicitly scoped as local.
    expect(text).toContain('LOCAL NODE VIEW');
    expect(text).toContain('0.201.0');
    expect(text).toContain('×3 other');
    expect(text).toContain('84ms');
    expect(text).toContain('12–210');
    expect(text).toContain('~128 nodes · inferred');
    expect(text).not.toContain('INDEXED');
    expect(text).not.toContain('CKBADGER');
    expect(container.querySelector('[data-network-local-context]')).not.toBeNull();
    expect(container.querySelector('[data-network-detail-mode="local"]')).toBeNull();
    expect(container.querySelectorAll('[data-network-detail-mode]')).toHaveLength(1);
    expect(Array.from(container.querySelectorAll('[data-scope-stage]')).map(
      (stage) => stage.getAttribute('data-scope-stage'),
    )).toEqual(['local-node', 'indexed-atlas']);
  });

  it('keeps direct peer diagnostics without a usable atlas record', () => {
    const { queryByLabelText, container } = render(
      <NetworkPanel {...props} enrichmentSource={enrichmentSource} />,
    );
    expect(queryByLabelText('Network atlas')).toBeNull();
    expect(container.querySelector('[data-network-detail-mode="local"]')).not.toBeNull();
    expect(container.textContent).toContain('0.201.0');
  });

  it('dims stale atlas data without dimming direct-node diagnostics', () => {
    const { container } = render(
      <NetworkPanel
        {...props}
        enrichmentSource={{ ...enrichmentSource, status: 'stale' }}
        networkAtlas={networkAtlas}
      />,
    );

    expect((container.querySelector('[data-scope-stage="local-node"]') as HTMLElement).style.opacity).toBe('');
    expect((container.querySelector('[data-scope-stage="indexed-atlas"]') as HTMLElement).style.opacity).toBe('0.68');
  });
});
