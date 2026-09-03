import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, it, expect } from 'vitest';
import type { EnrichmentSourceStatus, NetworkAtlasRecord } from '@cknerv/types';
import NetworkPanel from '../../../src/components/hud/NetworkPanel';
import type {
  BlockProducerView,
  ProducerLedgerWindow,
  ProducerStanding,
} from '../../../src/derives/blockProducers.derive';
import { HUD_COLORS } from '../../../src/components/hud/hudTheme';

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
  // …and the census beside it, on a DIFFERENT population: 42 of those 61 are
  // peers the crawler holds a verification for, and that is the number the two
  // strips under the bar are folded against.
  indexed_peers: 42,
  countries: [{ label: 'SG', count: 28 }, { label: 'US', count: 14 }],
  versions: [{ label: '0.119.0', count: 30 }, { label: '0.118.0', count: 12 }],
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
    // The reach bar. It was five rows of one number each — `Named by the
    // network` and the four cohorts under it — and the numbers are all still
    // here, in a fifth of the height: three of them as segments of the bar,
    // the total in its caption, and the fifth on the hover, where it belongs
    // because it cuts across two of the segments rather than joining them.
    expect(text).toContain('NAMED BY THE NETWORK · 61 PEERS');
    expect(text).toContain('NO ANSWER 51 · ANOTHER CHAIN 1 · THIS CHAIN 9');
    expect(text).not.toContain('Known nodes');
    expect(text).not.toContain('Named by the network61');

    // The census that replaced a 64-row sample: the denominator rides the
    // first strip it belongs to, and the caveat it used to carry is gone
    // because there is no longer anything to caveat.
    expect(text).toContain('COUNTRIES · ALL 42 VERIFIED PEERS');
    expect(text).toContain('SG 28 · US 14');
    expect(text).toContain('CLIENT VERSIONS');
    expect(text).not.toContain('SAMPLE');
    expect(text).not.toContain('BOUNDED');

    // Two axes left with the bars nobody was reading them off. How far each
    // dial got was a decomposition of a rung this panel no longer draws as a
    // rung, and which cloud a peer sits in was never a question this panel was
    // being asked.
    expect(text).not.toContain('HANDSHAKE');
    expect(text).not.toContain('ADDRESSES DIALED');
    expect(text).not.toContain('AUTONOMOUS SYSTEMS');
    expect(container.querySelectorAll('[data-handshake-rung]')).toHaveLength(0);

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

  it('keeps a cohort that resolved to zero, because zero is the reading', () => {
    // The live mainnet answer for two of these cohorts is `0`, and it is a
    // RESULT: nobody answered from another chain, nobody is being held from an
    // earlier round. A cohort that disappeared on zero would make that crawl
    // and a crawl that has stopped reporting those cohorts look identical —
    // which is the exact class of silence this whole readout was rebuilt out
    // of.
    //
    // The rule survived the change of mechanism and the mechanism is the whole
    // reason it needs stating again: five rows kept a zero visible by being
    // rows, and a zero SEGMENT is zero pixels wide. So the legend prints every
    // cohort rather than only the ones that fired, which also means what it
    // prints always adds up to the number in its own caption — a reader can
    // check that nothing was folded away, because nothing ever is.
    //
    // Guard, stated plainly so it is not softened by accident: filter the
    // legend on a truthy count and this goes red.
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
    expect(text).toContain('NAMED BY THE NETWORK · 136 PEERS');
    expect(text).toContain('NO ANSWER 79 · ANOTHER CHAIN 0 · THIS CHAIN 57');
    // What the legend prints IS the caption's total, so the reader's own check
    // is the one asserted here rather than a restatement of the string above.
    expect([79, 0, 57].reduce((sum, count) => sum + count, 0)).toBe(136);
    // And the cross-cut, on the hover, at zero — the row that used to say
    // `Verified, not reached 0` costs no line now and still says it.
    const bar = container.querySelector<HTMLElement>('[data-network-atlas-rows] > *');
    expect(bar?.title).toContain('0 of them are still held verified from an earlier round');
    // Structurally, so a segment cannot be hidden by rendering an empty bar.
    const segments = Array.from(
      container.querySelectorAll<HTMLElement>('[data-reach-segment]'),
    );
    expect(segments.map((segment) => segment.dataset.reachSegment))
      .toEqual(['exhausted', 'foreign', 'reachable']);
    expect(segments[1].style.width).toBe('0%');
  });

  it('draws the round as three widths of the peers it considered', () => {
    const { container } = render(
      <NetworkPanel
        {...props}
        enrichmentSource={enrichmentSource}
        networkAtlas={networkAtlas}
      />,
    );
    const text = container.textContent ?? '';

    // The denominator is the thing a reader must not get wrong. This bar
    // totals every peer the network named; the strips under it total only the
    // peers the crawler holds verified, which is a smaller set on the same
    // panel. Both captions state their own number, in their own words for what
    // it counts, because the two are stacked and neither may be read as the
    // other's.
    expect(text).toContain('NAMED BY THE NETWORK · 61 PEERS');
    expect(text).toContain('COUNTRIES · ALL 42 VERIFIED PEERS');

    // The bar is the whole partition, least evidence first. This is the
    // assertion that fails if anybody re-sorts it by size the way the two
    // qualitative strips below are sorted — which would leave the same three
    // numbers saying something else entirely.
    const segments = Array.from(
      container.querySelectorAll<HTMLElement>('[data-reach-segment]'),
    );
    expect(segments.map((segment) => segment.dataset.reachSegment)).toEqual([
      'exhausted',
      'foreign',
      'reachable',
    ]);
    // Widths are shares of the peers the round considered, never of any other
    // count on the panel — and they are all of it, which is what the adapter's
    // and the derive's partition guards exist to promise.
    expect(segments[0].style.width).toBe(`${(51 / 61) * 100}%`);
    expect(segments[2].style.width).toBe(`${(9 / 61) * 100}%`);
    expect(segments.reduce((sum, segment) => sum + parseFloat(segment.style.width), 0))
      .toBeCloseTo(100, 9);
  });

  it('ranks the reach bar in brightness, where the strips below it do not', () => {
    // The bar is ordinal and the two strips under it are not, so they may not
    // wear one colour language. A hash-assigned hue scrambles a progression;
    // one hue stepping in brightness IS the progression. It is also the second
    // thing telling a reader that this bar's denominator is not theirs —
    // unrelated hues means qualitative, one hue ramping means ordinal.
    const { container } = render(
      <NetworkPanel
        {...props}
        enrichmentSource={enrichmentSource}
        networkAtlas={networkAtlas}
      />,
    );

    // jsdom drops the alpha channel when it is exactly 1, so the top segment
    // comes back as `rgb(…)` while the two below it are `rgba(…)`. Both forms
    // are read rather than one, because a parser that only knew `rgba` would
    // report the brightest segment as missing.
    const paint = (background: string) => {
      const match = /rgba?\((\d+), ?(\d+), ?(\d+)(?:, ?([\d.]+))?\)/.exec(background);
      expect(match, background).not.toBeNull();
      return {
        rgb: `${match![1]},${match![2]},${match![3]}`,
        alpha: match![4] === undefined ? 1 : Number(match![4]),
      };
    };

    const steps = Array.from(
      container.querySelectorAll<HTMLElement>('[data-reach-segment]'),
    ).map((segment) => paint(segment.style.background));

    // One hue, and it is the peer plane's own wire: this bar is about peers
    // being dialed, on the peer panel.
    expect(new Set(steps.map((step) => step.rgb)).size).toBe(1);
    expect(steps[0].rgb).toBe(
      HUD_COLORS.peerWire.replace('#', '').match(/../g)!
        .map((pair) => parseInt(pair, 16)).join(','),
    );
    // Climbing, so the further the crawler got the brighter its segment. Asked
    // as a STRICT increase: an equal pair is two cohorts a reader cannot rank,
    // which is the whole failure a hashed ramp would have shipped.
    for (let i = 1; i < steps.length; i += 1) {
      expect(steps[i].alpha).toBeGreaterThan(steps[i - 1].alpha);
    }
    expect(steps[steps.length - 1].alpha).toBe(1);

    // And the strips below speak the other language, with no member in common:
    // every segment there is an opaque slot of the qualitative ramp, and none
    // of them is this hue.
    const qualitative = Array.from(
      container.querySelectorAll<HTMLElement>('[data-network-atlas-rows] > div'),
    ).slice(-2).flatMap((strip) => Array.from(strip.querySelectorAll<HTMLElement>('span')));
    expect(qualitative.length).toBe(4);
    for (const segment of qualitative) {
      const slot = paint(segment.style.background);
      expect(slot.alpha).toBe(1);
      expect(slot.rgb).not.toBe(steps[0].rgb);
    }
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
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.title).toContain('Crawler atlas · round 7 · as of #100');
    }
    // The bar says what each of its segments counts on the same hover, because
    // three widths of one number are only readable if a reader can tell which
    // cohort each one is — and it carries the count that is NOT a segment
    // there too, worded on its own verb so nothing invites adding it in.
    expect(rows[0]?.title).toContain('every peer the round considered');
    expect(rows[0]?.title).toContain('identified itself on a different network');
    expect(rows[0]?.title).toContain(
      '33 of them are still held verified from an earlier round',
    );
    // The strips keep their whole bucket list behind the same provenance.
    expect(rows[1]?.title).toContain('SG 28 · US 14');
    expect(rows[2]?.title).toContain('0.119.0 30 · 0.118.0 12');
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

describe('NetworkPanel producers', () => {
  /** Shapes, never live counts: the producer set drifts with the pools and the
   *  window rolls, so nothing here is a reading of any real chain. */
  function standing(blocks: number, windowBlocks: number, at: number): ProducerStanding {
    return {
      role: 'producer',
      key: `0x${String(at).repeat(4).padEnd(64, '0')}`,
      message: '0.209.0 (d166e28 2026-07-29)',
      blocks,
      windowBlocks,
      share: blocks / windowBlocks,
      lastSeenMs: 1_700_000_000_000,
      fan: { drawn: false, reason: 'modal', matchedVersion: null, matched: 0, shareOfVersioned: 0 },
      ledger: null,
    };
  }

  /** A view with BOTH of the derive's orders on it, built the way the derive
   *  builds them: one set of standings, sequenced two ways. `staging` is key
   *  ascending because a colony cache key may not follow a tally; `ranked` is
   *  the reading order, and it is the one `TOP` is a reading of. The two are
   *  the same standings twice, exactly as the derive hands them over. */
  function view(shares: readonly number[]): BlockProducerView {
    const windowBlocks = shares.reduce((sum, blocks) => sum + blocks, 0);
    const staging = shares
      .map((blocks, at) => standing(blocks, windowBlocks, at))
      .sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0));
    return {
      windowBlocks,
      staging,
      ranked: staging.slice().sort((left, right) => (
        right.blocks - left.blocks
          || (left.key < right.key ? -1 : left.key > right.key ? 1 : 0)
      )),
      versionedRosterSize: 32,
      candidacyByPeer: new Map(),
      // The window's row, which is what this row printed before an indexer's
      // week could reach it. `weekView` below is the other branch.
      ledgerWindow: null,
    };
  }

  /** The week an indexer counted, in the shape ckbadger sends: complete UTC+8
   *  days ending yesterday, and every block it attributed in them. */
  const WEEK: ProducerLedgerWindow = {
    days: 7,
    fromDate: '2026-08-26',
    toDate: '2026-09-01',
    totalBlocks: 67_800,
    fetchedAtMs: 1_756_800_000_000,
    indexedTip: 20_337_488,
  };

  /** The same two orders over a set the WEEK names, with `ranked` sequenced by
   *  the week's blocks — which is what the derive does whenever a coherent
   *  ledger exists, and therefore the only shape this row can be handed one
   *  in. The window numbers are deliberately unrelated to the week's, and
   *  shorter: a boot has five blocks in its ring and seven days behind it, and
   *  the standings the week names and the window does not hold `blocks 0`. */
  function weekView(
    weekBlocks: readonly number[],
    windowShares: readonly number[] = [],
  ): BlockProducerView {
    const windowBlocks = windowShares.reduce((sum, blocks) => sum + blocks, 0);
    const staging = weekBlocks
      .map((blocks, at) => ({
        ...standing(windowShares[at] ?? 0, Math.max(1, windowBlocks), at),
        windowBlocks,
        share: windowBlocks === 0 ? 0 : (windowShares[at] ?? 0) / windowBlocks,
        ledger: {
          blocks,
          share: blocks / WEEK.totalBlocks,
          address: null,
          balanceShannons: null,
          liveCells: null,
          txCount: null,
          lastRewardShannons: null,
          lastRewardBlock: null,
        },
      }))
      .sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0));
    return {
      windowBlocks,
      staging,
      ranked: staging.slice().sort((left, right) => (
        (right.ledger?.blocks ?? 0) - (left.ledger?.blocks ?? 0)
          || (left.key < right.key ? -1 : left.key > right.key ? 1 : 0)
      )),
      versionedRosterSize: 32,
      candidacyByPeer: new Map(),
      ledgerWindow: WEEK,
    };
  }

  it('says who is making the blocks, with the window the share is taken over', () => {
    const { container } = render(
      <NetworkPanel {...props} producers={view([96, 48, 32, 24])} />,
    );
    const row = container.querySelector('[data-network-producers]');
    expect(row?.textContent).toContain('POW COHORTS');
    expect(row?.textContent).toContain('4 · TOP 48% · 200 BLK');
    cleanup();

    // ⭐ `TOP` IS A READING OF THE SHARES, not of whatever stands first in the
    // colony. The staging array is sequenced by KEY — a cache key over the
    // geometry may not follow a number every block moves — so its head is
    // simply the lowest key, and a row that read it would print one miner's
    // percentage under another miner's name with nothing on screen to say so.
    const unsorted = render(
      <NetworkPanel {...props} producers={view([40, 120, 40])} />,
    ).container.querySelector('[data-network-producers]');
    expect(unsorted?.textContent).toContain('3 · TOP 60% · 200 BLK');
  });

  it('counts cohorts rather than miners, because a payout address is not a machine', () => {
    // ⭐⭐ A CORRECTION, NOT A RENAME. Every number in this row is keyed on a
    // PAYOUT LOCK HASH, and a payout lock hash names where the reward goes —
    // one address pays every rig a pool runs. `MINERS` therefore counted
    // machines nothing here has evidence about. Counted as cohorts the number
    // is exact again: six payout identities is six cohorts, whatever each of
    // them contains.
    const { container } = render(
      <NetworkPanel {...props} producers={view([96, 104])} />,
    );
    const row = container.querySelector('[data-network-producers]')?.textContent ?? '';
    expect(row).toMatch(/POW COHORTS/i);
    // No surface here may claim a machine, and `PRODUCER` is the derive's own
    // name for the fact — an internal vocabulary is not a reason for a panel to
    // speak a dialect nothing else on screen speaks.
    expect(row).not.toMatch(/\bMINERS?\b/i);
    expect(container.textContent).not.toMatch(/producer/i);
    // ⚠️ AND IT FITS, MEASURED RATHER THAN HOPED. `StatRow` is `nowrap` at a
    // fixed 17px height, so the panel's 53% cut cannot be spent from here: the
    // label runs 91px at `HUD_TYPE.tech` with this row's 1.6 tracking, the
    // widest value this row can print is ~143px, and the measure is 272px.
    const stat = container.querySelector('[data-network-producers] > div') as HTMLElement;
    expect(stat.style.whiteSpace).toBe('nowrap');
    expect(stat.style.height).toBe('17px');
  });

  it('never prints the top share without that window', () => {
    // ⭐ §9.6, structurally: every element in the row whose own text reaches a
    // percentage also reaches the window. Break `TOP 48%` and `200 BLK` into
    // two spans — the obvious way to tint the units — and the leaf carrying
    // the percentage alone fails here.
    for (const shares of [[96, 48, 32, 24], [1, 199], [200]]) {
      const { container } = render(<NetworkPanel {...props} producers={view(shares)} />);
      const row = container.querySelector('[data-network-producers]') as HTMLElement;
      const withPercent = Array.from(row.querySelectorAll<HTMLElement>('*'))
        .filter((element) => (element.textContent ?? '').includes('%'));
      expect(withPercent.length).toBeGreaterThan(0);
      for (const element of withPercent) expect(element.textContent).toContain('BLK');
      cleanup();
    }
  });

  it('reports an empty window as an empty window, and claims no top', () => {
    // A fresh boot, a devnet nobody has mined and the first block after a reorg
    // all look like this. A row that vanished on zero would make them
    // indistinguishable from a dashboard that has stopped reporting producers.
    const { container } = render(<NetworkPanel {...props} producers={view([])} />);
    const row = container.querySelector('[data-network-producers]');
    expect(row?.textContent).toContain('0 · 0 BLK');
    expect(row?.textContent).not.toContain('TOP');
  });

  it('prints nothing at all when the derive refused the window', () => {
    // `deriveBlockProducers` yields null when the numerators do not add up to
    // the denominator, and a refusal is not a zero: drawing part of a whole the
    // parts are not parts of makes every number on the row wrong.
    const { container } = render(<NetworkPanel {...props} producers={null} />);
    expect(container.querySelector('[data-network-producers]')).toBeNull();
    cleanup();
    expect(render(<NetworkPanel {...props} />).container
      .querySelector('[data-network-producers]')).toBeNull();
  });

  it('needs no crawler to say it', () => {
    // Local-first, and load-bearing: the producers are read off the chain by
    // this node, so the row stands with the enrichment source absent entirely
    // while the atlas below it does not.
    const { container } = render(
      <NetworkPanel {...props} producers={view([96, 104])} />,
    );
    expect(container.querySelector('[data-network-producers]')).not.toBeNull();
    expect(container.querySelectorAll('[data-network-detail-mode]')).toHaveLength(0);
  });

  it('reads the week when an indexer counted one, in the week\'s own unit', () => {
    // ⭐⭐ THE ROW THAT STOPS COLLAPSING. The 240-block window is emptied by
    // every reorg and by every rebuild, so a minute after a boot this row
    // honestly said `2 · TOP 60% · 5 BLK` — two cohorts, because two of them
    // had landed the five blocks this node had seen. The week names seven from
    // the first frame and keeps naming them through a fork that closed after
    // the days it counts did.
    const { container } = render(
      <NetworkPanel
        {...props}
        producers={weekView([41_824, 8_909, 7_570, 6_797, 1_537, 1_159, 2], [3, 2])}
      />,
    );
    const row = container.querySelector('[data-network-producers]');
    expect(row?.textContent).toContain('POW COHORTS');
    expect(row?.textContent).toContain('7 · TOP 62% · 7 D');
    // …and `TOP` is the WEEK's share, off the standing `ranked` put first —
    // which the derive already sequenced by the week's blocks, so the
    // percentage and the window beside it are one reading by construction.
    expect(row?.textContent).not.toContain('BLK');
  });

  it('states its window whichever window it is reading', () => {
    // §9.6 on the other branch: every element whose own text reaches a
    // percentage also reaches the unit of the window that percentage is of.
    // Break `TOP 62%` and `7 D` into two spans and the leaf carrying the
    // percentage alone fails here, exactly as it does for `240 BLK`.
    const { container } = render(
      <NetworkPanel {...props} producers={weekView([41_824, 8_909], [3, 2])} />,
    );
    const row = container.querySelector('[data-network-producers]') as HTMLElement;
    const withPercent = Array.from(row.querySelectorAll<HTMLElement>('*'))
      .filter((element) => (element.textContent ?? '').includes('%'));
    expect(withPercent.length).toBeGreaterThan(0);
    for (const element of withPercent) expect(element.textContent).toMatch(/\d+ D\b/);
  });

  it('keeps the window it gave up, whole, in the title', () => {
    // ⚠️ ONE ROW HOLDS ONE WINDOW, so when the week takes the row the 240
    // blocks this node read for ITSELF would simply vanish — and with them the
    // only figure on this panel that nothing but this machine vouches for. It
    // moves into the title instead, in the same string it prints as a row.
    //
    // ⭐ AND ITS COUNT IS TWO, NOT SEVEN. The standing set is the UNION of the
    // two windows now, so five of these cohorts hold `blocks 0` — the week
    // names them and the ring has never seen them. A window sentence that
    // counted the whole set would report five cohorts into a window that holds
    // none of them.
    const { container } = render(
      <NetworkPanel
        {...props}
        producers={weekView([41_824, 8_909, 7_570, 6_797, 1_537, 1_159, 2], [3, 2])}
      />,
    );
    const title = container.querySelector('[data-network-producers] > div')
      ?.getAttribute('title') ?? '';
    expect(title).toContain('7 complete days');
    expect(title).toContain('2026-08-26 to 2026-09-01');
    expect(title).toContain('67,800 BLK');
    expect(title).toContain('2 · TOP 60% · 5 BLK');
  });

  it('falls back to the window when the week names nobody', () => {
    // A ledger with a positive total and no rows passes every check the derive
    // makes, and there is then no week share to print. The row says what this
    // node can see for itself, which is the true smaller statement.
    const { container } = render(
      <NetworkPanel {...props} producers={{ ...view([96, 104]), ledgerWindow: WEEK }} />,
    );
    expect(container.querySelector('[data-network-producers]')?.textContent)
      .toContain('2 · TOP 52% · 200 BLK');
  });

  it('says neither of the two words it may not say, on either branch', () => {
    // ⚠️ THE VOCABULARY GUARD, ASKED OF BOTH ROWS. `MINER` claims a machine
    // this row has no evidence about; `PRODUCER` is the derive's own name for
    // the fact and no reader has ever seen it. The week is a new string in an
    // old slot, which is the kind of edit that reintroduces a word.
    for (const producers of [view([96, 104]), weekView([41_824, 8_909], [3, 2])]) {
      const { container } = render(<NetworkPanel {...props} producers={producers} />);
      const text = container.textContent ?? '';
      expect(text).toMatch(/POW COHORTS/);
      expect(text).not.toMatch(/\bMINERS?\b/i);
      expect(text).not.toMatch(/producer/i);
      cleanup();
    }
  });

  it('spends one row on it, and does not spend the height the panel got back', () => {
    // ⚠️ PEER·02 was cut by 53% when five StatRows became a percentage bar, and
    // that saving is not this feature's to spend. One row, and no second bar:
    // the ranking a producer bar would draw is already drawn out on the stage,
    // as the radius of every producer's ring.
    const bare = render(<NetworkPanel {...props} />).container;
    const bars = bare.querySelectorAll('div').length;
    cleanup();
    const withProducers = render(
      <NetworkPanel {...props} producers={view([96, 104])} />,
    ).container;
    const row = withProducers.querySelector('[data-network-producers]') as HTMLElement;
    // One StatRow inside one wrapper, and nothing else.
    expect(row.children).toHaveLength(1);
    expect(row.querySelectorAll('div')).toHaveLength(1);
    expect(withProducers.querySelectorAll('div').length).toBe(bars + 2);
  });
});
