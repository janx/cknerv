// The SIGHTED card — the crawler-only dialect of the floating inspection
// constellation.
//
// The dossier body is the SERVER-AUTHORED sample from
// `tests/fixtures/enrichment_samples.json`, the same one the plate's own suite
// reads, so a contract change on the Rust side lands here rather than in a
// hand-written stand-in that agrees with nothing.

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  PeerSightingLookup,
  PeerSightingRecord,
  RosterNode,
} from '@cknerv/types';
import SightedNodeCard, {
  SIGHTED_NODE_ACCENT,
  sightedNodeDialect,
  sightedNodeSpokenWord,
} from '../../../src/components/hud/SightedNodeCard';
import MinerNodeCard, {
  MINER_NODE_ACCENT,
} from '../../../src/components/hud/MinerNodeCard';
import {
  PRODUCER_FAN_WITHHELD_TEXT,
  peerCandidacyText,
} from '../../../src/components/hud/producerReadout';
import type {
  PeerMiningCandidacy,
  ProducerFan,
  ProducerFanWithheld,
  ProducerStanding,
} from '../../../src/derives/blockProducers.derive';
import { HUD_COLORS } from '../../../src/components/hud/hudTheme';
import { PEER_NETWORK_HEX } from '../../../src/visualPalette';

const __dirname = dirname(fileURLToPath(import.meta.url));
const samples = JSON.parse(
  readFileSync(
    resolve(__dirname, '..', '..', '..', '..', '..', 'tests', 'fixtures', 'enrichment_samples.json'),
    'utf8',
  ),
) as { peer_sightings: Record<string, PeerSightingLookup> };

const sighted = samples.peer_sightings.sighted;
if (sighted?.state !== 'sighted') {
  throw new Error('enrichment_samples.json is missing a sighted peer sample');
}
const RECORD: PeerSightingRecord = sighted.sighting;

const LAST_SEEN_MS = 1_700_000_000_000;
/** Five minutes after the crawler last named the node, so the header age is a
 *  round number a reader can check by eye. */
const NOW_MS = LAST_SEEN_MS + 300_000;

/** A multiaddr long enough that the card has to shorten it — the point of the
 *  row is that the full value survives in the title. */
const LONG_ADDR = '/ip4/203.0.113.44/tcp/8115/p2p/QmSightedAlpha0123456789abcdef';

function rosterNode(overrides: Partial<RosterNode> = {}): RosterNode {
  return {
    node_id: 'QmSightedAlpha0123456789',
    addr: LONG_ADDR,
    state: 'reachable',
    version: '0.116.1',
    country: 'Germany',
    asn: 'AS24940',
    last_reachable_ms: LAST_SEEN_MS,
    last_advertised_ms: LAST_SEEN_MS,
    last_observed_ms: LAST_SEEN_MS,
    latest_positive_observed_ms: LAST_SEEN_MS,
    ...overrides,
  };
}

/** A peer the network names and nobody has ever had an answer out of. Every
 *  field the crawler only holds for a node it reached is absent — not
 *  `'Unknown'`, which is its word for a lookup that came back empty on a node
 *  it DID reach — because there was never a dial to read them off. */
function hearsayNode(overrides: Partial<RosterNode> = {}): RosterNode {
  return rosterNode({
    state: 'advertised_unverified',
    version: undefined,
    country: undefined,
    asn: undefined,
    last_reachable_ms: undefined,
    rtt_ms: undefined,
    last_observed_ms: LAST_SEEN_MS - 120_000,
    ...overrides,
  });
}

/** jsdom hands inline colours back in `rgb()` form, so read the constant the
 *  card and the point cloud share through the same conversion. */
function rgbOf(hex: string): string {
  const h = hex.replace('#', '');
  const channel = (at: number) => parseInt(h.slice(at, at + 2), 16);
  return `rgb(${channel(0)}, ${channel(2)}, ${channel(4)})`;
}

afterEach(cleanup);

function renderCard(props: Partial<Parameters<typeof SightedNodeCard>[0]> = {}) {
  return render(
    <SightedNodeCard
      node={props.node ?? rosterNode()}
      layoutSide="left"
      nowMs={NOW_MS}
      sighting={props.sighting}
      candidacy={props.candidacy}
      onClose={props.onClose ?? (() => {})}
    />,
  );
}

function value(container: HTMLElement, row: string): string {
  return container.querySelector(`[data-sighted-probe-value="${row}"]`)?.textContent ?? '';
}

function row(container: HTMLElement, name: string): Element | null {
  return container.querySelector(`[data-sighted-probe-fact="${name}"]`);
}

function minerValue(container: HTMLElement, at: string): string {
  return container.querySelector(`[data-miner-probe-value="${at}"]`)?.textContent ?? '';
}

describe('SightedNodeCard header', () => {
  it('names the node by its first eight characters and dates the sighting', () => {
    const { container } = renderCard();
    const text = container.textContent ?? '';
    expect(text).toContain('SIGHTED // QmSighte');
    expect(container.querySelector('[data-sighted-probe-last-seen]')?.textContent)
      .toBe('LAST SEEN 5m 0s');
    expect(text).toContain('SGHT·01');
  });

  it('keeps the whole id reachable behind the shortened one', () => {
    const { container } = renderCard();
    const title = container.querySelector('[data-sighted-probe-module="header"] span');
    expect(title?.getAttribute('title')).toBe('QmSightedAlpha0123456789');
  });

  it('states the absence of a link in steel, never in the alarm colour', () => {
    const { container } = renderCard();
    const badge = container.querySelector<HTMLElement>('[data-sighted-probe-link="none"]');
    expect(badge?.textContent).toBe('NOT LINKED');
    // Having no link to a crawler-named node is this card's normal condition.
    expect(badge?.style.color).toBe(rgbOf(HUD_COLORS.dim));
    expect(badge?.style.color).not.toBe(rgbOf(HUD_COLORS.caution));
  });

  // ⚠️ THE MASTHEAD IS THE CARD'S ONE CLAIM THAT CAN GO FALSE. Every other
  // line says nothing rather than guessing, but a heading is not optional, and
  // SIGHTED over a node nobody has spoken to is the sentence the whole tier
  // exists to refuse.
  it('never calls a peer sighted when nobody has ever had an answer out of it', () => {
    const { container } = renderCard({ node: hearsayNode() });
    const text = container.textContent ?? '';
    expect(text).toContain('ADVERTISED // QmSighte');
    expect(text).not.toContain('SIGHTED // QmSighte');
    expect(container.querySelector('[data-sighted-probe-card]')?.getAttribute('aria-label'))
      .toBe('Advertised node QmSighte probe');
    expect(container.querySelector('[data-sighted-probe-card]')
      ?.getAttribute('data-sighted-probe-dialect')).toBe('advertised');
    // …and the rung that WAS answered keeps the word it earned.
    cleanup();
    const answered = renderCard();
    expect(answered.container.textContent ?? '').toContain('SIGHTED // QmSighte');
    expect(answered.container.querySelector('[data-sighted-probe-card]')
      ?.getAttribute('aria-label')).toBe('Sighted node QmSighte probe');
    expect(answered.container.querySelector('[data-sighted-probe-card]')
      ?.getAttribute('data-sighted-probe-dialect')).toBe('verified');
  });

  it('reads the dialect off the record\'s own discriminant, not off a gap', () => {
    // `verified_unavailable` is a peer the crawler SPOKE to and could not
    // reach this round, so it routinely arrives with no dial time and often
    // no fresh anything. Sorting the dialects by "has an rtt" would have put
    // the same peer on different sides on different rounds, and called a peer
    // that answered last week hearsay.
    expect(sightedNodeDialect('reachable')).toBe('verified');
    expect(sightedNodeDialect('verified_unavailable')).toBe('verified');
    expect(sightedNodeDialect('advertised_unverified')).toBe('advertised');
    expect(sightedNodeSpokenWord('verified_unavailable')).toBe('Sighted');
    expect(sightedNodeSpokenWord('advertised_unverified')).toBe('Advertised');

    const remembered = rosterNode({ state: 'verified_unavailable', rtt_ms: undefined });
    const { container } = renderCard({ node: remembered });
    expect(container.textContent).toContain('SIGHTED // QmSighte');
    expect(row(container, 'version')).not.toBeNull();
  });

  it('wears the sighted tier tint its own point cloud is drawn with', () => {
    expect(SIGHTED_NODE_ACCENT).toBe(PEER_NETWORK_HEX.scaffold);
    const { container } = renderCard();
    const heading = container.querySelector<HTMLElement>(
      '[data-sighted-probe-module="header"] span',
    );
    expect(heading?.style.color).toBe(rgbOf(SIGHTED_NODE_ACCENT));
  });
});

describe('SightedNodeCard record', () => {
  it('prints the crawler row it was handed, address shortened but intact', () => {
    const { container } = renderCard();
    expect(value(container, 'addr')).toContain('…');
    expect(value(container, 'addr').length).toBeLessThan(LONG_ADDR.length);
    expect(
      container.querySelector('[data-sighted-probe-value="addr"]')?.getAttribute('title'),
    ).toBe(LONG_ADDR);
    expect(value(container, 'version')).toBe('0.116.1');
    expect(container.textContent).toContain('SGHT·02');
  });

  it('reads the round trip as the crawler\'s own dial, never as a ping', () => {
    const { container } = renderCard({ node: rosterNode({ rtt_ms: 41 }) });
    expect(value(container, 'dial')).toBe('41 MS');
    const text = container.textContent ?? '';
    expect(text).toContain('THEIR DIAL');
    expect(text).not.toContain('PING');
  });

  it('prints no dial row at all when the crawler recorded none', () => {
    const { container } = renderCard();
    expect(row(container, 'dial')).toBeNull();
    expect(container.textContent).not.toContain('THEIR DIAL');
  });

  it('leaves the address a short one alone', () => {
    const { container } = renderCard({
      node: rosterNode({ addr: '/ip4/10.0.0.1/tcp/8115' }),
    });
    expect(value(container, 'addr')).toBe('/ip4/10.0.0.1/tcp/8115');
  });

  it('renders no verified-only row over a peer nobody verified', () => {
    // The dialect, and the thing it exists to prevent. VERSION and THEIR DIAL
    // are read off a verification that does not exist here, so they are not
    // absent-as-a-dash and not absent-as-"Unknown" — they are not rows. A
    // dash would say the crawler looked and found nothing; the crawler never
    // looked, because it never got a packet out of this node.
    const { container } = renderCard({ node: hearsayNode() });
    expect(row(container, 'version')).toBeNull();
    expect(row(container, 'dial')).toBeNull();
    const text = container.textContent ?? '';
    expect(text).not.toContain('VERSION');
    expect(text).not.toContain('THEIR DIAL');
    expect(text).not.toContain('Unknown');
  });

  it('swaps them for the one clock a peer nobody answered actually has', () => {
    // Three clocks ride the roster row and none may stand in for another.
    // This is the crawler TRYING, which is what dates a failure — not the
    // network NAMING (the dossier's stamp, a statement about the network) and
    // certainly not the crawler SEEING, which never happened.
    const { container } = renderCard({ node: hearsayNode() });
    expect(row(container, 'tried')).not.toBeNull();
    expect(value(container, 'tried')).toBe('7m 0s');
    expect(container.textContent).toContain('LAST TRIED');
    expect(container.textContent).toContain('THE LAST COMPLETED ROUND THAT DIALED IT');
    // …and it is not the masthead's sighting clock wearing another label.
    expect(container.querySelector('[data-sighted-probe-last-seen]')).toBeNull();
  });

  it('prints no attempt row when no completed round has named one', () => {
    const { container } = renderCard({
      node: hearsayNode({ last_observed_ms: undefined }),
    });
    expect(row(container, 'tried')).toBeNull();
    expect(container.textContent).not.toContain('LAST TRIED');
    // The address is what a candidate IS, so that row is always there.
    expect(row(container, 'addr')).not.toBeNull();
  });

  it('keeps the two dialects\' rows disjoint', () => {
    // No row may be in both sets. If one ever is, the two dialects have
    // stopped being dialects and become one row list with holes in it.
    const answered = renderCard();
    const verifiedRows = Array.from(
      answered.container.querySelectorAll('[data-sighted-probe-fact]'),
    ).map((node) => node.getAttribute('data-sighted-probe-fact'));
    cleanup();
    const hearsay = renderCard({ node: hearsayNode() });
    const advertisedRows = Array.from(
      hearsay.container.querySelectorAll('[data-sighted-probe-fact]'),
    ).map((node) => node.getAttribute('data-sighted-probe-fact'));

    expect(verifiedRows).toEqual(['addr', 'version']);
    expect(advertisedRows).toEqual(['addr', 'tried']);
    const shared = verifiedRows.filter((name) => advertisedRows.includes(name));
    expect(shared).toEqual(['addr']);
  });
});

describe('SightedNodeCard footer', () => {
  it('says what the scene is not claiming, once and dimly', () => {
    const { container } = renderCard();
    const footer = container.querySelector<HTMLElement>('[data-sighted-probe-footer]');
    expect(footer?.textContent).toBe('NO LIVE LINK · POSITION IS SCENE PLACEMENT');
    expect(footer?.style.color).toBe(rgbOf(HUD_COLORS.dim));
  });
});

describe('SightedNodeCard dossier', () => {
  it('draws no plate when the source advertised no crawler lookup', () => {
    const { container } = renderCard();
    expect(container.querySelector('[data-sighting-plate]')).toBeNull();
  });

  it('waits under its own line while the lookup is still out', () => {
    const { container } = renderCard({
      sighting: { phase: 'waiting', record: null },
    });
    expect(container.textContent).toContain('WAITING FOR THE SOURCE ANCHOR');
    expect(container.textContent).toContain('SGHT·03');
  });

  it('states an honest never-seen rather than a blank plate', () => {
    const { container } = renderCard({
      sighting: { phase: 'unsighted', record: null, reason: 'never_sighted' },
    });
    expect(container.querySelector('[data-sighting-variant="sighted"]')).not.toBeNull();
    expect(container.textContent).toContain('NO CRAWLER SIGHTING');
    expect(container.textContent).toContain('NEVER SEEN FROM OUTSIDE');
  });

  it('prints the crawler dossier in the dialect for a subject we cannot reach', () => {
    const { container } = renderCard({
      node: rosterNode({ rtt_ms: 41 }),
      sighting: { phase: 'ready', record: RECORD },
    });
    expect(container.querySelector('[data-sighting-variant="sighted"]')).not.toBeNull();
    expect(container.querySelector('[data-sighting-row="whereabouts"]')).not.toBeNull();
    expect(container.querySelector('[data-sighting-row="exposure"]')).not.toBeNull();
    expect(container.querySelector('[data-sighting-row="network-age"]')).not.toBeNull();
    // CROWD stands down: upstream deleted the outbound count this row read,
    // and the list that replaced it counts the other direction.
    expect(container.querySelector('[data-sighting-row="crowd"]')).toBeNull();
    // Nothing live stands on the other side of this card, so there is no
    // second version to cross-check the crawler's against.
    expect(container.querySelector('[data-sighting-row="identify"]')).toBeNull();
    expect(container.textContent).not.toContain('NO LIVE VERSION TO CHECK AGAINST');
    // …and the dial prints once, in the RECORD row that had it instantly.
    expect((container.textContent ?? '').match(/THEIR DIAL/g)).toHaveLength(1);
  });
});

describe('SightedNodeCard discipline', () => {
  it('speaks only its own DOM vocabulary', () => {
    const { container } = renderCard({
      sighting: { phase: 'ready', record: RECORD },
    });
    const html = container.innerHTML;
    expect(html).not.toContain('data-cell-');
    expect(html).not.toContain('data-peer-');
    expect(html).not.toContain('data-node-');
    expect(html).toContain('data-sighted-probe-card');
  });

  it('reveals nothing: every fact is on the first frame and none is a control', () => {
    const { container } = renderCard({
      node: rosterNode({ rtt_ms: 41 }),
      sighting: { phase: 'ready', record: RECORD },
    });
    // No facet buttons, no progressive plates — the close affordance is the
    // card's only interactive element, and it is a role, not a <button>.
    expect(container.querySelectorAll('button')).toHaveLength(0);
    expect(container.querySelectorAll('[role="button"]')).toHaveLength(1);
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
    for (const name of ['addr', 'version', 'dial']) {
      expect(row(container, name)).not.toBeNull();
    }
  });

  it('carries the crawler\'s evidence on the plate that speaks for all three cards', () => {
    // The rows an unverified peer fills — how far the dial got, at which
    // address, out of how many, and how much of the network still repeats it
    // — belong to the DOSSIER and not to the RECORD above it. That plate
    // serves the peer and mirror dialects too, and neither of them has a
    // record of its own; printing the same evidence in both places would give
    // one crawler two voices on one card.
    const advertisedSample = samples.peer_sightings.advertised_unverified;
    if (advertisedSample?.state !== 'unsighted' || !advertisedSample.advertised) {
      throw new Error('enrichment_samples.json is missing an advertised-unverified sample');
    }
    const { container } = renderCard({
      node: hearsayNode(),
      sighting: {
        phase: 'unsighted',
        record: null,
        reason: 'advertised_unverified',
        advertised: advertisedSample.advertised,
      },
    });
    expect(container.querySelector('[data-sighting-row="exposure"]')).not.toBeNull();
    expect(container.querySelector('[data-sighting-row="crowd-inbound"]')).not.toBeNull();
    expect(container.textContent).toContain('NAMED BY THE NETWORK, NEVER VERIFIED');
    // …and the RECORD above it repeats none of it.
    const record = container.querySelector('[data-sighted-probe-module="record"]');
    expect(record?.textContent).not.toContain('DIALED AT');
    expect(record?.textContent).not.toContain('LAST NAMED');
    expect(record?.textContent).not.toContain('ADVERTISED BY');
  });
});

// ——— The MINER card, and the one mining sentence its neighbours may carry ———
//
// It lives in this file rather than one of its own for the reason T6 and T7
// both landed on: `CellDetailPanel.test.tsx` races the real `performance.now`
// that vitest's fake clock does not cover, and a NEW test file anywhere in this
// package can turn it red without touching a line of its source. It is also the
// right neighbour on the merits — the sighted card is the miner card's closest
// sibling, both of them dialects for a node this dashboard has never spoken to,
// and the two of them are where the difference between "somebody named it" and
// "the chain proved it" has to stay legible.

describe('MinerNodeCard', () => {
  /** A payout lock hash — 0x and 64 hex, the shape the chain actually reports.
   *  Nothing here parses it; the card prints it and groups by it. */
  const PRODUCER_KEY = `0x${'eb0c0007'}${'9f76e90b'.repeat(7)}`;

  /** Interior spacing on purpose. T1 strips the control padding mainnet miners
   *  wrap a message in and leaves the inside exactly as declared, so anything
   *  still in there is the miner's own and this card may not tidy it. */
  const DECLARED = '0.209.0 (d166e28 2026-07-29)  bpool';

  function drawnFan(candidates = 4): ProducerFan {
    return {
      drawn: true,
      matchedVersion: DECLARED.trim(),
      candidates: Array.from({ length: candidates }, (_, index) => rosterNode({
        node_id: `QmCandidate${index}`,
      })),
      shareOfVersioned: candidates / VERSIONED_ROSTER_SIZE,
    };
  }

  function withheldFan(
    reason: ProducerFanWithheld,
    matched: number,
  ): ProducerFan {
    return {
      drawn: false,
      reason,
      matchedVersion: matched > 0 ? DECLARED.trim() : null,
      matched,
      shareOfVersioned: matched / Math.max(1, VERSIONED_ROSTER_SIZE),
    };
  }

  /** Peers the crawler holds a build for. Deliberately not any live crawl size
   *  — the crawl drifts and the producer set drifts with the pools, so every
   *  number in this suite is a shape rather than a reading. */
  const VERSIONED_ROSTER_SIZE = 32;

  function standing(overrides: Partial<ProducerStanding> = {}): ProducerStanding {
    const blocks = overrides.blocks ?? 96;
    const windowBlocks = overrides.windowBlocks ?? 200;
    return {
      role: 'producer',
      key: PRODUCER_KEY,
      message: DECLARED,
      blocks,
      windowBlocks,
      share: blocks / windowBlocks,
      lastSeenMs: LAST_SEEN_MS,
      fan: drawnFan(),
      ...overrides,
    };
  }

  function renderMiner(overrides: Partial<ProducerStanding> = {}, versioned = VERSIONED_ROSTER_SIZE) {
    return render(
      <MinerNodeCard
        subject={{ producer: standing(overrides), versionedRosterSize: versioned }}
        layoutSide="left"
        nowMs={NOW_MS}
        onClose={() => {}}
      />,
    );
  }

  it('wears the one masthead its evidence earns, and neither of the other two', () => {
    const { container } = renderMiner();
    const text = container.textContent ?? '';
    // The word is MINER — already in the lexicon, since `NodeSelfCard` stamps
    // the same role on the local node — and the key head stands where the
    // other dialects put an id head.
    expect(text).toContain('MINER // eb0c0007');
    // A wrong masthead is itself a shipped lie: we hold no link, so it cannot
    // say PEER, and no crawler has ever answered for this node, so it cannot
    // say SIGHTED.
    expect(text).not.toContain('PEER //');
    expect(text).not.toContain('SIGHTED');
    expect(text).not.toContain('ADVERTISED');
    // And the evidence class beside it, which is the strongest sentence on the
    // card — a crawl is hearsay and a block is proof.
    expect(container.querySelector('[data-miner-probe-evidence="chain"]')?.textContent)
      .toBe('CHAIN ATTESTED');
    expect(container.querySelector('[data-miner-probe-last-block]')?.textContent)
      .toBe('LAST BLOCK 5m 0s');
    expect(text).toContain('MINE·01');
  });

  it('is drawn in the colour of its own mark on stage', () => {
    // The point cloud and the ring both fall back to the peer mesh's scaffold
    // token, so the card and the thing the card is about cannot drift apart.
    // It is the sighted card's accent too, and deliberately: the rung belongs
    // to the peer mesh rather than standing beside it, and what tells the
    // tiers apart out there is the ring, not the hue.
    expect(MINER_NODE_ACCENT).toBe(PEER_NETWORK_HEX.scaffold);
    expect(MINER_NODE_ACCENT).toBe(SIGHTED_NODE_ACCENT);
  });

  it('states the blocks, the window and the share on one line', () => {
    const { container } = renderMiner();
    expect(minerValue(container, 'blocks')).toBe('96 / 200 BLK · 48%');
  });

  it('never prints a share without the window it was measured over', () => {
    // ⭐ §9.6, structurally rather than as a string match: every element on the
    // card whose own text reaches a percentage also reaches the window. Split
    // the fraction and the percentage into two spans — the natural way
    // somebody makes this row narrower — and the leaf carrying `48%` alone
    // fails here, which is the assertion the string above cannot make.
    //
    // It is checked over a MATRIX rather than one standing, because the branch
    // that would lose the window is the small-share one.
    for (const blocks of [1, 7, 96, 199, 200]) {
      const { container } = renderMiner({ blocks });
      const withPercent = Array.from(container.querySelectorAll<HTMLElement>('*'))
        .filter((element) => (element.textContent ?? '').includes('%'));
      expect(withPercent.length).toBeGreaterThan(0);
      for (const element of withPercent) {
        expect(element.textContent).toContain('BLK');
      }
      cleanup();
    }
  });

  it('says a share is small rather than saying it is none', () => {
    // One block of a two-hundred-block window rounds to zero, and `0%` beside
    // a row saying the producer took one of them is the card contradicting
    // itself on one line.
    const { container } = renderMiner({ blocks: 1 });
    expect(minerValue(container, 'blocks')).toBe('1 / 200 BLK · <1%');
  });

  it('prints what the miner said about itself, verbatim and marked as a claim', () => {
    const { container } = renderMiner();
    expect(container.querySelector('[data-miner-probe-declared]')?.textContent)
      .toBe('SELF-DECLARED');
    const message = container.querySelector<HTMLElement>('[data-miner-probe-message]');
    // Byte for byte, interior spacing included. Both sides of the join below
    // are self-declared, so a node advertising a version string containing a
    // producer's whole message wins the join outright — the gates bound the
    // shape of that claim and never its honesty, which is what this stamp is
    // for rather than decoration.
    expect(message?.textContent).toBe(DECLARED);
    expect(message?.style.whiteSpace).toBe('pre-wrap');
  });

  it('drops the message row when the miner said nothing, rather than dashing it', () => {
    const { container } = renderMiner({
      message: '',
      fan: withheldFan('no_declaration', 0),
    });
    expect(container.querySelector('[data-miner-probe-fact="message"]')).toBeNull();
    expect(container.querySelector('[data-miner-probe-declared]')).toBeNull();
  });

  it('prints the payout key and invents no address for it', () => {
    const { container } = renderMiner();
    const key = container.querySelector('[data-miner-probe-value="key"]');
    expect(key?.getAttribute('title')).toBe(PRODUCER_KEY);
    expect(container.textContent).toContain('PAYOUT LOCK HASH');
    // The encoded CKB address and the operator name are crawler enrichment and
    // nothing in this feature fetches them. A card that computed one would be
    // inventing the single thing it exists to refuse to invent.
    expect(container.textContent).not.toContain('ckb1');
    expect(container.textContent).not.toContain('ADDRESS');
  });

  it('names the population its build fraction is counted against', () => {
    const { container } = renderMiner();
    // ⚠️ The denominator is the peers we hold a BUILD for, which is the
    // population the numerator is drawn from and the one the modal gate
    // divided by. The crawler's wider known set counts peers we hold no build
    // for, so `matched` over that would be a fraction whose halves count
    // different things — and a reader working out the percentage would get a
    // number that contradicts the verdict on the same line.
    expect(minerValue(container, 'build')).toBe(`4 OF ${VERSIONED_ROSTER_SIZE}`);
    expect(container.textContent).toContain('PEERS THE CRAWLER HOLDS A BUILD FOR');
    expect(container.querySelector('[data-miner-probe-narrowing]')?.getAttribute('data-miner-probe-narrowing'))
      .toBe('drawn');
    expect(container.querySelector('[data-miner-probe-narrowed]')).toBeNull();
  });

  it('hands a withheld fan no identities to leak', () => {
    // The withheld branch of `ProducerFan` carries a count and no roster rows
    // at all, so this is a property of the type — asserted here because the
    // card is where a leak would show.
    const { container } = renderMiner({ fan: withheldFan('modal', 27) });
    expect(container.textContent).not.toContain('QmCandidate');
    expect(container.querySelector('[data-miner-probe-narrowed]')?.textContent)
      .toBe('NOT NARROWED');
    expect(minerValue(container, 'build')).toBe(`27 OF ${VERSIONED_ROSTER_SIZE}`);
  });

  it.each([
    ['no_declaration', 0, 'THIS MINER WROTE NO BUILD INTO ITS BLOCKS', false],
    ['roster_absent', 0, 'NO CRAWLER ROSTER HERE TO COMPARE AGAINST', false],
    ['roster_unversioned', 0, 'THE ROSTER NAMES PEERS AND HOLDS A BUILD FOR NONE', false],
    ['no_match', 0, 'NO PEER WE HOLD A BUILD FOR IS RUNNING THIS ONE', true],
    ['singular', 1, 'A SET OF ONE IS A NAME, NOT A NARROWING', true],
    ['modal', 27, 'THIS IS THE BUILD ALMOST EVERY PEER WE SEE RUNS', true],
    ['crowd', 11, 'TOO MANY PEERS RUN IT FOR THE SET TO BE EVIDENCE', true],
  ] as ReadonlyArray<[ProducerFanWithheld, number, string, boolean]>)(
    'says %s in its own words', (reason, matched, sentence, hasFraction) => {
      // ⭐ Seven reasons, seven different facts about the world, all of which
      // render as no fan. "We hold no builds to compare against", "nobody we
      // hold a build for runs this one" and "this is the build they all run"
      // are not one sentence, and blurring them would be the failure this
      // card's sibling refuses when it will not print `Unknown` for a field
      // that is not there.
      const versioned = reason === 'roster_absent' || reason === 'roster_unversioned'
        ? 0
        : VERSIONED_ROSTER_SIZE;
      const { container } = renderMiner(
        { message: reason === 'no_declaration' ? '' : DECLARED, fan: withheldFan(reason, matched) },
        versioned,
      );
      const narrowing = container.querySelector('[data-miner-probe-narrowing]');
      expect(narrowing?.getAttribute('data-miner-probe-narrowing')).toBe(reason);
      expect(narrowing?.textContent).toBe(sentence);
      expect(container.querySelector('[data-miner-probe-narrowed]')?.textContent)
        .toBe('NOT NARROWED');
      // …and the three that have no honest denominator print no fraction. A
      // silent miner has a versioned roster and a matched count of zero, and
      // `0 OF 32` would say we asked thirty-two peers — but the join never ran.
      expect(minerValue(container, 'build')).toBe(
        hasFraction ? `${matched} OF ${versioned}` : '—',
      );
      const denominatorNamed = (container.textContent ?? '')
        .includes('PEERS THE CRAWLER HOLDS A BUILD FOR');
      expect(denominatorNamed).toBe(hasFraction);
    },
  );

  it('keeps the seven reasons seven distinct sentences', () => {
    const sentences = Object.values(PRODUCER_FAN_WITHHELD_TEXT);
    expect(sentences).toHaveLength(7);
    expect(new Set(sentences).size).toBe(7);
  });

  it('states the three things the scene cannot say for itself', () => {
    const { container } = renderMiner();
    // The third clause is the double-count, disclosed rather than hidden: one
    // node per producer means that if the real machine is also a peer on
    // stage, the colony is drawing it twice, and that is inherent to keeping
    // every producer anonymous.
    expect(container.querySelector('[data-miner-probe-footer]')?.textContent)
      .toBe('POSITION IS SCENE PLACEMENT · NODE NOT OBSERVED · MAY ALSO STAND AS A PEER ABOVE');
  });

  it('carries none of the instruments that need a link, a dial or a height', () => {
    const { container } = renderMiner();
    const text = container.textContent ?? '';
    for (const absent of ['COMPASS', 'PING', 'SYNC LADDER', 'UPTIME', 'LINKED ·', 'VERSION', 'COUNTRY']) {
      expect(text).not.toContain(absent);
    }
    expect(container.querySelector('[data-peer-probe-compass]')).toBeNull();
    expect(container.querySelector('[data-peer-probe-ping]')).toBeNull();
    // Three plates and one honesty line — less than any other dialect, which
    // is the honest amount for a subject nobody has ever addressed.
    expect(container.querySelectorAll('[data-miner-probe-module]')).toHaveLength(3);
  });
});

describe('the mining stamp a named node may carry', () => {
  function candidacy(oneOf: number): PeerMiningCandidacy {
    return {
      role: 'candidate',
      oneOf,
      version: '0.209.0 (d166e28 2026-07-29)',
      producerKeys: ['0xfeed'],
    };
  }

  it('asks rather than states, and says how large the set is', () => {
    const { container } = renderCard({ candidacy: candidacy(6) });
    const stamp = container.querySelector('[data-mining-candidacy]');
    expect(stamp?.textContent).toBe('MINER? · 1 OF 6 ON THIS BUILD');
    // ⭐ §9.2: no surface may say a peer IS a producer. The `?` and the
    // denominator are the whole point, so the sentence is checked for both
    // rather than for the word.
    expect(stamp?.textContent).toContain('MINER?');
    expect(stamp?.textContent).not.toMatch(/MINER(?!\?)/);
  });

  it('refuses a set of one outright', () => {
    // §9.3. `candidacyByPeer` is built only from fans that cleared the minimum,
    // so this cannot arrive from the derive — refusing it in the sentence is
    // what makes "a set of size one never renders a tie" a property of the
    // rendering rather than of whoever builds the index today.
    expect(peerCandidacyText(candidacy(1))).toBeNull();
    const { container } = renderCard({ candidacy: candidacy(1) });
    expect(container.querySelector('[data-mining-candidacy]')).toBeNull();
  });

  it('is absent from a card whose node is in no drawn fan', () => {
    const { container } = renderCard();
    expect(container.querySelector('[data-mining-candidacy]')).toBeNull();
    expect(container.textContent).not.toContain('MINER');
  });

  it('stays out of the record, which prints the crawler and nothing derived', () => {
    const { container } = renderCard({ candidacy: candidacy(3) });
    const record = container.querySelector('[data-sighted-probe-module="record"]');
    expect(record?.textContent).not.toContain('MINER?');
    expect(
      container.querySelector('[data-sighted-probe-module="header"] [data-mining-candidacy]'),
    ).not.toBeNull();
  });
});
