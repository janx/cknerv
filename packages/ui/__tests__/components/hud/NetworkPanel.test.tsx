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
  // One round's outcome matrix: 9 answered here, 51 ran their addresses out
  // (33 still holding an earlier verification), 1 answered from another chain.
  candidate_peers: 61,
  last_round_reachable: 9,
  foreign_peers: 1,
  exhausted_candidates: 51,
  verified_unavailable_peers: 33,
  verified_retained_peers: 42,
  new_verified_peers: 3,
  indexed_peers: 42,
  countries: [{ label: 'SG', count: 28 }, { label: 'US', count: 14 }],
  versions: [{ label: '0.119.0', count: 30 }, { label: '0.118.0', count: 12 }],
  asns: [{ label: 'AS1 Example', count: 40 }, { label: 'AS2 Example', count: 2 }],
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
    // The ladder. `Known nodes` was one number for the set the crawler holds
    // verified, under a name that read as the much larger set it had heard of
    // — and that larger set is a number now, so all of them are named.
    expect(text).toContain('Named by the network61');
    expect(text).toContain('Answered, this chain9');
    expect(text).toContain('Answered, another chain1');
    expect(text).toContain('No answer this round51');
    expect(text).toContain('Verified, not reached33');
    expect(text).not.toContain('Known nodes');

    // The census that replaced a 64-row sample: the denominator rides the
    // first strip it belongs to, and the caveat it used to carry is gone
    // because there is no longer anything to caveat.
    expect(text).toContain('COUNTRIES · ALL 42 VERIFIED PEERS');
    expect(text).toContain('SG 28 · US 14');
    expect(text).toContain('CLIENT VERSIONS');
    expect(text).toContain('AUTONOMOUS SYSTEMS');
    expect(text).toContain('AS1 Example 40');
    expect(text).not.toContain('SAMPLE');
    expect(text).not.toContain('BOUNDED');

    // The median dial left with the page it was drawn from. It measured the
    // crawler's own distance from the fleet rather than anything about the
    // fleet, and it was the last number here a bounded sample could answer —
    // keeping it would have meant keeping the sample beside a census with no
    // way for a reader to tell which was which.
    expect(text).not.toContain('Median RTT');
    expect(text).not.toContain('18ms');

    expect(text).not.toContain('Last crawl');
    expect(text).not.toContain('Latest sample');
    expect(text).not.toContain('9 reachable / 12 dialed');
    expect(text).not.toContain('LATEST 3 NODE SAMPLE');
    expect(text).not.toContain('FRONTIER');
    expect(text).not.toContain('INDEXED');
    expect(text).not.toContain('CKBADGER');
  });

  it('keeps a rung that resolved to zero, because zero is the reading', () => {
    // The live mainnet answer for two of these rungs is `0`, and it is a
    // RESULT: nobody answered from another chain, nobody is being held from an
    // earlier round. A row that disappeared on zero would make that crawl and
    // a crawl that has stopped reporting those cohorts look identical — which
    // is the exact class of silence this whole readout was rebuilt out of.
    //
    // Guard, stated plainly so it is not softened by accident: put a truthy
    // test in front of any ladder row and this goes red.
    const quiet: NetworkAtlasRecord = {
      ...networkAtlas,
      candidate_peers: 136,
      last_round_reachable: 57,
      foreign_peers: 0,
      exhausted_candidates: 79,
      verified_unavailable_peers: 0,
      verified_retained_peers: 57,
      new_verified_peers: 0,
    };
    const { container } = render(
      <NetworkPanel
        {...props}
        enrichmentSource={enrichmentSource}
        networkAtlas={quiet}
      />,
    );

    const text = container.textContent ?? '';
    expect(text).toContain('Answered, another chain0');
    expect(text).toContain('Verified, not reached0');
    // And structurally, so a row cannot be hidden by rendering an empty one.
    const rows = Array.from(
      container.querySelectorAll<HTMLElement>('[data-network-atlas-rows] > *'),
    );
    expect(rows.slice(0, 5).map((row) => row.textContent)).toEqual([
      'Named by the network136',
      'Answered, this chain57',
      'Answered, another chain0',
      'No answer this round79',
      'Verified, not reached0',
    ]);
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
    expect(rows).toHaveLength(8);
    for (const row of rows) {
      expect(row.title).toContain('Crawler atlas · round 7 · as of #100');
    }
    // Each ladder rung says what it counts on the same hover, because five
    // rungs of one number are only a ladder if a reader can tell which
    // population each one is a slice of — and the fifth is a slice of the two
    // above it rather than of the first.
    expect(rows[0]?.title).toContain('every peer the round considered');
    expect(rows[2]?.title).toContain('identified itself on a different network');
    expect(rows[4]?.title).toContain('not a further part of the peers considered');
    // The strips keep their whole bucket list behind the same provenance.
    expect(rows[5]?.title).toContain('SG 28 · US 14');
    expect(rows[6]?.title).toContain('0.119.0 30 · 0.118.0 12');
    expect(rows[7]?.title).toContain('AS1 Example 40 · AS2 Example 2');
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
