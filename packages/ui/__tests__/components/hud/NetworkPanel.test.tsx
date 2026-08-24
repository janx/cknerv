import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, it, expect } from 'vitest';
import type { EnrichmentSourceStatus, NetworkAtlasRecord } from '@cknerv/types';
import NetworkPanel from '../../../src/components/hud/NetworkPanel';

afterEach(cleanup);

const props = {
  summary: { peerCount: 47, outbound: 8, inbound: 39, version: '0.201.0', connections: 47, medianPingMs: 84, syncLabel: 'AT TIP', bestKnown: 16204887 },
  consensus: { atTip: 44, behind: 2, ahead: 1, unknown: 0, total: 47, aheadRatio: 0.021, maxAhead: 1 },
  syncRatio: 1,
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
  last_round_attempted: 12,
  last_round_reachable: 9,
  new_nodes: 3,
  sample_size: 3,
  sample_reachable: 2,
  sample_truncated: true,
  median_rtt_ms: 18,
  countries: [{ label: 'SG', count: 2 }, { label: 'US', count: 1 }],
  versions: [{ label: '0.119.0', count: 2 }, { label: '0.118.0', count: 1 }],
};

describe('NetworkPanel', () => {
  it('renders the measured fleet aggregate', () => {
    const { container } = render(<NetworkPanel {...props} />);
    const t = container.textContent ?? '';
    expect(t).toContain('PEER MESH');
    expect(t).toContain('节点场');
    expect(t).toContain('47');
    expect(t).toContain('44 / 47');       // head consensus
    expect(t).toContain('44 AT-TIP');
    expect(t).toContain('#16,204,887');   // the height the legend is judged from
    expect(container.querySelectorAll('[data-network-detail-mode]')).toHaveLength(0);
  });

  it('never repeats the per-peer telemetry the cards already carry', () => {
    const expectNoLocalView = (container: HTMLElement) => {
      const t = container.textContent ?? '';
      expect(t).not.toContain('LOCAL NODE VIEW');
      expect(t).not.toContain('Peer RTT');
      expect(t).not.toContain('Ping');
      expect(t).not.toContain('Client');
      expect(t).not.toContain('0.201.0');  // majority client version — PEER/NODE card
      expect(t).not.toContain('84ms');     // fleet ping median — PEER card
      expect(container.querySelector('[data-network-local-context]')).toBeNull();
      expect(container.querySelector('[data-network-detail-mode="local"]')).toBeNull();
    };

    // Gone in CKB-only mode…
    expectNoLocalView(render(<NetworkPanel {...props} />).container);
    cleanup();
    // …and gone from the enriched scope rail it used to open.
    expectNoLocalView(render(
      <NetworkPanel {...props} enrichmentSource={enrichmentSource} networkAtlas={networkAtlas} />,
    ).container);
  });

  it('keeps the atlas to network shape, not crawler operations', () => {
    const { container } = render(
      <NetworkPanel
        {...props}
        enrichmentSource={enrichmentSource}
        networkAtlas={networkAtlas}
      />,
    );

    expect(container.querySelector('[data-network-detail-mode="indexed"]')
      ?.getAttribute('data-network-atlas-state')).toBe('ready');
    const text = container.textContent ?? '';
    expect(text).toContain('Known nodes');
    expect(text).toContain('Median RTT');
    expect(text).toContain('18ms');
    // The sample denominator rides the strip it qualifies.
    expect(text).toContain('SAMPLE COUNTRIES · 3 NODES · BOUNDED');
    expect(text).toContain('SG 2 · US 1');
    expect(text).toContain('SAMPLE CLIENT VERSIONS');

    expect(text).not.toContain('Last crawl');
    expect(text).not.toContain('Latest sample');
    expect(text).not.toContain('9 reachable / 12 dialed');
    expect(text).not.toContain('LATEST 3 NODE SAMPLE');
    expect(text).not.toContain('FRONTIER');
    expect(text).not.toContain('NEW');
    expect(text).not.toContain('INDEXED');
    expect(text).not.toContain('CKBADGER');
  });

  it('folds the atlas into the panel flow instead of framing a sub-section', () => {
    const { container, queryByLabelText } = render(
      <NetworkPanel
        {...props}
        enrichmentSource={enrichmentSource}
        networkAtlas={networkAtlas}
      />,
    );

    // One subject, one flow: no title, no rail, no framed stage of its own.
    const text = container.textContent ?? '';
    expect(text).not.toContain('NETWORK ATLAS');
    expect(text).not.toContain('ATLAS');
    expect(queryByLabelText('Network atlas')).toBeNull();
    expect(container.querySelectorAll('[data-scope-stage]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-scope-connector]')).toHaveLength(0);
    const atlas = container.querySelector('[data-network-detail-mode="indexed"]') as HTMLElement;
    expect(atlas.tagName).toBe('DIV');
    expect(atlas.style.borderTop).toBe('');

    // Provenance stopped spending a line and moved onto hover — every atlas
    // element can still answer where its numbers came from.
    expect(text).not.toContain('ROUND 7');
    expect(text).not.toContain('AS OF #100');
    const rows = Array.from(
      container.querySelectorAll<HTMLElement>('[data-network-atlas-rows] > *'),
    );
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(row.title).toContain('Crawler atlas · round 7 · as of #100');
    }
    // The strips keep their bucket detail behind the same provenance.
    expect(rows[2]?.title).toContain('SG 2 · US 1');
    expect(rows[3]?.title).toContain('0.119.0 2 · 0.118.0 1');
  });

  it('speaks measured network truth only — the scene colony is STAGE·07\'s', () => {
    const { container } = render(
      <NetworkPanel
        {...props}
        enrichmentSource={enrichmentSource}
        networkAtlas={networkAtlas}
      />,
    );
    const text = container.textContent ?? '';
    expect(text).not.toContain('colony');
    expect(text).not.toContain('Colony');
    expect(text).not.toContain('inferred');
  });

  it('reports catch-up only while we are short of the best known head', () => {
    const { container } = render(<NetworkPanel {...props} syncRatio={0.972} />);
    expect(container.querySelector('[data-network-sync="catching-up"]')).not.toBeNull();
    expect(container.textContent).toContain('Syncing');
    expect(container.textContent).toContain('97.2% of #16,204,887');
  });

  it('hides the catch-up row at the tip', () => {
    for (const syncRatio of [1, 0.999, 0.99999]) {
      const { container } = render(<NetworkPanel {...props} syncRatio={syncRatio} />);
      expect(container.querySelector('[data-network-sync]')).toBeNull();
      expect(container.textContent).not.toContain('Syncing');
      expect(container.textContent).not.toContain('Sync ratio');
      cleanup();
    }
  });

  it('adds nothing at all without a usable atlas record', () => {
    const { container } = render(
      <NetworkPanel {...props} enrichmentSource={enrichmentSource} />,
    );
    expect(container.querySelectorAll('[data-network-detail-mode]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-scope-stage]')).toHaveLength(0);
    expect(container.textContent).toContain('Head consensus');
  });

  it('says nothing about freshness until the atlas is actually stale', () => {
    const { container } = render(
      <NetworkPanel
        {...props}
        enrichmentSource={enrichmentSource}
        networkAtlas={networkAtlas}
      />,
    );

    expect(container.textContent).not.toContain('STALE');
    expect(container.querySelector('[data-network-atlas-caution]')).toBeNull();
    expect((container.querySelector('[data-network-atlas-rows]') as HTMLElement)
      .style.opacity).toBe('1');
  });

  it('dims a stale atlas and marks it with one caution line', () => {
    const { container } = render(
      <NetworkPanel
        {...props}
        enrichmentSource={{ ...enrichmentSource, status: 'stale' }}
        networkAtlas={networkAtlas}
      />,
    );

    expect(container.querySelector('[data-network-detail-mode="indexed"]')
      ?.getAttribute('data-network-atlas-state')).toBe('stale');
    const caution = container.querySelectorAll('[data-network-atlas-caution]');
    expect(caution).toHaveLength(1);
    expect(caution[0]?.textContent).toBe('ATLAS STALE · AS OF #100');
    // The rows dim; the exception itself stays at full strength.
    expect((container.querySelector('[data-network-atlas-rows]') as HTMLElement)
      .style.opacity).toBe('0.68');
    expect((caution[0] as HTMLElement).style.opacity).toBe('');
  });

  it('points the at-tip tally with a mark rather than a borrowed glyph', () => {
    // The tally opened with `▲`, which Google's `latin` range does not reach
    // and no face in `src/fonts` carries. The word `AT-TIP` was always the
    // carrier; the triangle is a mark now and stays out of the a11y tree.
    const { container } = render(<NetworkPanel {...props} />);

    expect(container.textContent).toContain('44 AT-TIP');
    expect(container.textContent).not.toMatch(/[\u25B2\u25BC]/);
    const mark = container.querySelector('[data-direction-mark]');
    expect(mark?.getAttribute('data-direction-mark')).toBe('up');
    expect(mark?.getAttribute('aria-hidden')).toBe('true');
  });
});
