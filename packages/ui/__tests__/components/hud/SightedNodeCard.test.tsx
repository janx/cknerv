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
} from '../../../src/components/hud/SightedNodeCard';
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
    ...overrides,
  };
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
});
