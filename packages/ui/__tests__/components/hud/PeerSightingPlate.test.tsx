// The DOSSIER plate — the crawler's account of a node, on either card.
//
// The sighting body is the SERVER-AUTHORED sample from
// `tests/fixtures/enrichment_samples.json`, so a contract change on the Rust
// side lands here rather than in a hand-written stand-in that agrees with
// nothing.

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  PeerAdvertisedEvidence,
  PeerProbeResult,
  PeerSightingLookup,
  PeerSightingRecord,
} from '@cknerv/types';
import PeerSightingPlate, {
  formatNetworkSpan,
  type PeerSightingPlateProps,
} from '../../../src/components/hud/PeerSightingPlate';

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

const advertisedSample = samples.peer_sightings.advertised_unverified;
if (advertisedSample?.state !== 'unsighted' || !advertisedSample.advertised) {
  throw new Error('enrichment_samples.json is missing an advertised-unverified peer sample');
}
/** The rung below a sighting, as the server actually writes it. */
const ADVERTISED: PeerAdvertisedEvidence = advertisedSample.advertised;
const ADVERTISED_AT_MS = ADVERTISED.last_advertised_at_ms;
if (ADVERTISED_AT_MS === undefined) {
  throw new Error('the advertised-unverified sample is the one that HAS an advertise clock');
}

/** One minute after the crawler last saw the node, so every age in the plate
 *  is a round number a reader can check by eye. */
const NOW_MS = RECORD.last_seen_ms + 60_000;

afterEach(cleanup);

function renderPlate(props: Partial<PeerSightingPlateProps> = {}) {
  return render(
    <PeerSightingPlate
      phase="ready"
      record={RECORD}
      module="LINK·05"
      nowMs={NOW_MS}
      {...props}
    />,
  );
}

function row(container: HTMLElement, name: string): string {
  return container.querySelector(`[data-sighting-row="${name}"]`)?.textContent ?? '';
}

/** The row's VALUE alone. A row's text includes captions that deliberately
 *  name the unit they are not ("…, NOT PEERS"), so a unit assertion has to
 *  read the number's own words rather than the whole row's. */
function value(container: HTMLElement, name: string): string {
  return container.querySelector(`[data-sighting-value="${name}"]`)?.textContent ?? '';
}

describe('PeerSightingPlate absence', () => {
  it('renders nothing at all when no source was asked', () => {
    const { container } = renderPlate({ phase: 'disabled', record: null });
    expect(container.innerHTML).toBe('');
  });

  it('holds the frame while the lookup is still in flight', () => {
    const { container } = renderPlate({ phase: 'loading', record: null });
    expect(container.querySelector('[data-sighting-plate]')).not.toBeNull();
    expect(container.querySelector('[data-sighting-absence]')?.textContent)
      .toContain('ASKING THE CRAWLER');
    expect(container.querySelector('[data-sighting-row="exposure"]')).toBeNull();
    // Nothing was observed, so nothing carries an observation stamp.
    expect(container.querySelector('[data-sighting-stamp]')).toBeNull();
  });

  it('waits on the source anchor before claiming anything', () => {
    const { container } = renderPlate({ phase: 'waiting', record: null });
    expect(container.textContent).toContain('WAITING FOR THE SOURCE ANCHOR');
  });

  it('says a node was never seen from outside, and means it', () => {
    const { container } = renderPlate({
      phase: 'unsighted',
      record: null,
      reason: 'never_sighted',
    });
    expect(container.querySelector('[data-sighting-phase="unsighted"]')
      ?.getAttribute('data-sighting-reason')).toBe('never_sighted');
    expect(container.textContent).toContain('NO CRAWLER SIGHTING');
    expect(container.textContent).toContain('NEVER SEEN FROM OUTSIDE');
  });

  it('separates a source with no crawler from a crawler with no sighting', () => {
    const { container } = renderPlate({
      phase: 'unsighted',
      record: null,
      reason: 'no_crawler',
    });
    expect(container.textContent).toContain('NO CRAWLER ON SOURCE');
    expect(container.textContent).not.toContain('NEVER SEEN FROM OUTSIDE');
  });

  it('admits when the id itself is the thing the crawler cannot read', () => {
    const { container } = renderPlate({
      phase: 'unsighted',
      record: null,
      reason: 'unreadable_node_id',
    });
    expect(container.textContent).toContain('NO CRAWLER SIGHTING');
    expect(container.textContent).toContain('THIS ID CANNOT BE KEYED TO THE CRAWLER');
  });

  it('separates a peer nobody has named from one nobody could dial', () => {
    // The whole point of the rung. Both are absences of a sighting and they
    // are not the same statement: `never_sighted` is a crawler that holds
    // nothing at all under this id, and this is a crawler that holds the
    // peer's addresses and dials them every round without ever getting an
    // identify back. Printing "NEVER SEEN FROM OUTSIDE" over a peer the
    // network is actively naming is the falsehood this task removed.
    const { container } = renderPlate({
      phase: 'unsighted',
      record: null,
      reason: 'advertised_unverified',
      advertised: ADVERTISED,
      nowMs: ADVERTISED_AT_MS + 120_000,
    });
    const plate = container.querySelector('[data-sighting-phase="unsighted"]');
    expect(plate?.getAttribute('data-sighting-reason')).toBe('advertised_unverified');
    expect(container.textContent).toContain('NAMED BY THE NETWORK, NEVER VERIFIED');
    expect(container.textContent).not.toContain('NEVER SEEN FROM OUTSIDE');
    expect(container.textContent).not.toContain('NO CRAWLER SIGHTING');
    // The typed reason, and the clock the report is dated by — an unverified
    // peer has no sighting to be stamped by, so this is the only one it has.
    const exposure = row(container, 'exposure');
    expect(exposure).toContain('NO HANDSHAKE BEFORE THE DEADLINE');
    expect(exposure).toContain('LAST NAMED 2M 0S AGO');
    expect(exposure).toContain('2 ROUNDS EXHAUSTED');
    // The rung and the reason answer one question between them, so they are
    // on ONE element. They were two apart for a commit, which cost nothing
    // visible and made every oracle that asked the plate for the rung read
    // `null` while passing.
    expect(plate?.getAttribute('data-sighting-probe'))
      .toBe('no_authenticated_session_before_deadline');
  });

  it('names the clock it dated the report by, and never the wrong one', () => {
    // Two clocks now reach this line and they are two sentences. The
    // advertise clock is what the rung is about and wins wherever it exists;
    // a peer the crawler holds no gossiped alias for has never been named by
    // anybody, so printing LAST NAMED over the observation clock would date
    // the report with an event that did not happen. Upstream answers the
    // second for every peer it answers about at all, which is why dropping
    // the stamp is not the alternative.
    const unnamed: PeerAdvertisedEvidence = { ...ADVERTISED };
    delete unnamed.last_advertised_at_ms;
    const { container } = renderPlate({
      phase: 'unsighted',
      record: null,
      reason: 'advertised_unverified',
      advertised: unnamed,
      nowMs: unnamed.latest_positive_observed_ms + 120_000,
    });
    const exposure = row(container, 'exposure');
    expect(exposure).toContain('LAST OBSERVED 2M 0S AGO');
    expect(exposure).not.toContain('LAST NAMED');
    // And the sample that HAS been named still says so, off its own clock —
    // which is a different moment in the fixture on purpose, so a mapper that
    // read either field into the other would move the age it prints.
    expect(ADVERTISED.latest_positive_observed_ms).not.toBe(ADVERTISED_AT_MS);
    const named = renderPlate({
      phase: 'unsighted',
      record: null,
      reason: 'advertised_unverified',
      advertised: ADVERTISED,
      nowMs: ADVERTISED_AT_MS + 120_000,
    });
    expect(row(named.container, 'exposure')).toContain('LAST NAMED 2M 0S AGO');
  });

  it('says where the furthest dial went, and out of how many', () => {
    // The one fact on the mirror a node cannot read off its own config: that
    // states what it BOUND, and this is the address the network is telling
    // everybody to dial. The denominator rides with it because a rung alone
    // does not say how hard anybody tried — one refusal out of one is a dead
    // entry in the gossip, one out of nine is a node answering nowhere.
    const { container } = renderPlate({
      phase: 'unsighted',
      record: null,
      reason: 'advertised_unverified',
      advertised: ADVERTISED,
    });
    const exposure = row(container, 'exposure');
    expect(ADVERTISED.furthest_address).toBeTruthy();
    expect(exposure).toContain('DIALED AT');
    expect(exposure).toContain('198.51.100.4');
    expect(exposure).toContain(`FURTHEST OF ${ADVERTISED.dialed_address_count}`);
  });

  it('keeps the port when a real multiaddr is too long to print whole', () => {
    // The only part of the address an operator can act on is the transport
    // and the PORT. A multiaddr ends in `/p2p/<id>` — the node this plate is
    // already about — so an evenly-split truncation spends its whole budget
    // spelling the subject twice and hides the one number that matters.
    const long: PeerAdvertisedEvidence = {
      ...ADVERTISED,
      furthest_address:
        '/ip6/::ffff:203.0.113.168/tcp/8114/p2p/QmNRAvtC6L85hwp6vWnqaKonJw3dz1q39B4nXVQErzC4Hx',
    };
    const { container } = renderPlate({
      phase: 'unsighted',
      record: null,
      reason: 'advertised_unverified',
      advertised: long,
    });
    const exposure = row(container, 'exposure');
    expect(exposure).toContain('/ip6/::ffff:203.0.113.168/tcp/8114');
    expect(exposure).toContain('…');
  });

  it('states the count alone rather than inventing a place for the rung', () => {
    const withoutAddress: PeerAdvertisedEvidence = { ...ADVERTISED };
    delete withoutAddress.furthest_address;
    const { container } = renderPlate({
      phase: 'unsighted',
      record: null,
      reason: 'advertised_unverified',
      advertised: withoutAddress,
    });
    const exposure = row(container, 'exposure');
    expect(exposure).toContain('3 ADDRESSES DIALED');
    expect(exposure).not.toContain('DIALED AT');
  });

  it('drops the denominator when one address is the whole population', () => {
    const single: PeerAdvertisedEvidence = { ...ADVERTISED, dialed_address_count: 1 };
    const { container } = renderPlate({
      phase: 'unsighted',
      record: null,
      reason: 'advertised_unverified',
      advertised: single,
    });
    const exposure = row(container, 'exposure');
    expect(exposure).toContain('DIALED AT');
    expect(exposure).not.toContain('FURTHEST OF');
  });

  it('renders no verified-only row over a peer nobody verified', () => {
    // The whole point of the dialect. None of these exists for a peer the
    // crawler never authenticated — upstream refuses to fabricate them and so
    // does this — so the body is the subset it can actually fill, and a row
    // that leaked through would be a fact with no observation under it.
    const { container } = renderPlate({
      phase: 'unsighted',
      record: null,
      reason: 'advertised_unverified',
      advertised: ADVERTISED,
    });
    const rows = Array.from(container.querySelectorAll('[data-sighting-row]'))
      .map((node) => node.getAttribute('data-sighting-row'));
    expect(rows).toEqual(['exposure', 'crowd-inbound']);
    for (const absent of ['whereabouts', 'network-age', 'identify', 'crowd-outbound']) {
      expect(container.querySelector(`[data-sighting-row="${absent}"]`)).toBeNull();
    }
    // And no observation stamp: nothing here was sighted.
    expect(container.querySelector('[data-sighting-stamp]')).toBeNull();
  });

  it('counts the peers that name an unverified peer, in the same words', () => {
    const { container } = renderPlate({
      phase: 'unsighted',
      record: null,
      reason: 'advertised_unverified',
      advertised: ADVERTISED,
    });
    expect(value(container, 'crowd-inbound'))
      .toBe(`${ADVERTISED.advertiser_peer_count} PEERS`);
    expect(row(container, 'crowd-inbound')).toContain('GOSSIP, NOT LINKS');
  });

  it('stands the crowd row down for an unverified peer nobody can count', () => {
    const uncounted: PeerAdvertisedEvidence = { ...ADVERTISED };
    delete uncounted.advertiser_peer_count;
    const { container } = renderPlate({
      phase: 'unsighted',
      record: null,
      reason: 'advertised_unverified',
      advertised: uncounted,
    });
    expect(container.querySelector('[data-sighting-row="crowd-inbound"]')).toBeNull();
    expect(container.textContent).not.toContain('ADVERTISED BY');
  });

  it('gives every rung of the handshake its own sentence', () => {
    // The axis is ordinal and each rung is a different diagnosis with a
    // different fix. Collapsing any two of them into one phrase — most
    // temptingly the two middle ones — would throw away the only part of
    // this report an operator can act on, and nothing else here would notice.
    const sentences = new Map<PeerProbeResult | undefined, string>();
    const rungs: (PeerProbeResult | undefined)[] = [
      undefined,
      'dial_request_failed',
      'no_authenticated_session_before_deadline',
      'authenticated_session_without_identify_before_deadline',
      'malformed_identify',
      'foreign_network',
      'same_network_identified',
      'unknown',
    ];
    for (const rung of rungs) {
      const { container } = renderPlate({
        phase: 'unsighted',
        record: null,
        reason: 'advertised_unverified',
        advertised: { ...ADVERTISED, furthest_result: rung },
      });
      // The sentence is the EXPOSURE row's VALUE — the row that asks whether
      // the outside can reach this node, answering with how far it got.
      const value = container.querySelector('[data-sighting-value="exposure"]');
      expect(value, `no exposure row for ${rung}`).not.toBeNull();
      sentences.set(rung, value?.textContent ?? '');
      cleanup();
    }
    expect(new Set(sentences.values()).size).toBe(rungs.length);
    // Two that must never merge: nothing answered on the wire, versus
    // something answered, completed a secure handshake and then went quiet.
    expect(sentences.get('no_authenticated_session_before_deadline'))
      .toBe('NO HANDSHAKE BEFORE THE DEADLINE');
    expect(sentences.get('authenticated_session_without_identify_before_deadline'))
      .toBe('IT OPENED A SESSION AND NEVER SAID WHO IT WAS');
    // A peer on another chain DID answer, so no sentence here may claim
    // nobody reached it.
    expect(sentences.get('foreign_network')).toBe('IT ANSWERED, FROM ANOTHER CHAIN');
    // And "nobody has tried yet" is not a failed dial.
    expect(sentences.get(undefined)).toBe('NO COMPLETED ROUND HAS TRIED IT YET');
  });

  it('drops the exhausted-round clause rather than printing a zero', () => {
    const { container } = renderPlate({
      phase: 'unsighted',
      record: null,
      reason: 'advertised_unverified',
      advertised: { ...ADVERTISED, consecutive_exhausted_rounds: 0 },
    });
    expect(row(container, 'exposure')).toContain('LAST NAMED');
    expect(container.textContent).not.toContain('EXHAUSTED');
  });

  it('keeps the true headline when the reason arrives without its evidence', () => {
    // A source that names this state and sends no payload has still said
    // something true. Falling back to the never-sighted line would swap it
    // for something false.
    const { container } = renderPlate({
      phase: 'unsighted',
      record: null,
      reason: 'advertised_unverified',
    });
    expect(container.textContent).toContain('NAMED BY THE NETWORK, NEVER VERIFIED');
    expect(container.textContent).not.toContain('NEVER SEEN FROM OUTSIDE');
    // …and nothing under it. The rows are the evidence, so no evidence is no
    // rows rather than rows full of blanks.
    expect(container.querySelectorAll('[data-sighting-row]')).toHaveLength(0);
    expect(container.querySelector('[data-sighting-plate]')
      ?.getAttribute('data-sighting-probe')).toBeNull();
  });

  it('reports a fault in the source\'s own words, quietly', () => {
    const { container } = renderPlate({
      phase: 'error',
      record: null,
      message: 'validated anchor expired',
    });
    const line = container.querySelector('[data-sighting-absence] div');
    expect(line?.textContent).toBe('validated anchor expired');
    expect((line as HTMLElement).style.color).toBe('rgb(255, 48, 48)');
  });

  it('falls back to its own words when the fault carried none', () => {
    const { container } = renderPlate({ phase: 'error', record: null });
    expect(container.textContent).toContain('CRAWLER SIGHTING UNAVAILABLE');
  });
});

describe('PeerSightingPlate sighting', () => {
  it('stamps the observation age from the card\'s clock', () => {
    const { container } = renderPlate();
    expect(container.querySelector('[data-sighting-stamp]')?.textContent)
      .toBe('SIGHTED 1M 0S AGO');
    expect(container.textContent).toContain('LINK·05');
  });

  it('prints the two facts local RPC can never know', () => {
    const { container } = renderPlate();
    expect(row(container, 'whereabouts'))
      .toContain('DE · AS24940 Hetzner Online GmbH');
  });

  it('renders an unresolved location honestly rather than hiding it', () => {
    const { container } = renderPlate({
      record: { ...RECORD, country: 'Unknown', asn: 'Unknown' },
    });
    const value = container.querySelector('[data-sighting-value="whereabouts"]') as HTMLElement;
    expect(value.textContent).toBe('Unknown · Unknown');
    expect(value.style.color).toBe('rgb(124, 135, 148)');
  });

  it('calls a dialable node public, and prints both vantages\' round trips', () => {
    const { container } = renderPlate({ liveRttMs: 84 });
    const exposure = row(container, 'exposure');
    expect(exposure).toContain('PUBLIC · DIALED FROM OUTSIDE');
    expect(exposure).toContain('THEIR DIAL 41 MS · OUR PING 84 MS');
  });

  it('dates the last successful dial when nobody can reach the node now', () => {
    const { container } = renderPlate({
      record: {
        ...RECORD,
        reachable: false,
        last_reachable_at_ms: RECORD.last_seen_ms - 7_200_000,
      },
    });
    const exposure = row(container, 'exposure');
    expect(exposure).toContain('UNREACHABLE FROM OUTSIDE');
    expect(exposure).toContain('LAST DIAL 2H 1M AGO');
  });

  it('says so when no dial ever landed', () => {
    const record = { ...RECORD, reachable: false };
    delete record.last_reachable_at_ms;
    const { container } = renderPlate({ record });
    expect(row(container, 'exposure')).toContain('NO SUCCESSFUL DIAL ON RECORD');
  });

  it('pairs the network\'s memory of the node against our own link', () => {
    const { container } = renderPlate({ linkAgeMs: 3_725_000 });
    const age = row(container, 'network-age');
    expect(age).toContain('ON NET 1 YR 7 MO');
    expect(age).toContain('WE HAVE HELD THIS LINK 1H 2M');
  });

  it('leaves the pairing out where there is no link to pair with', () => {
    const { container } = renderPlate({ variant: 'self' });
    expect(row(container, 'network-age')).not.toContain('WE HAVE HELD THIS LINK');
  });

  it('confirms an agreeing version quietly', () => {
    const { container } = renderPlate({ liveVersion: RECORD.client_version });
    const identify = row(container, 'identify');
    expect(identify).toContain('AGREES WITH THE LIVE RPC VERSION');
    expect((container.querySelector('[data-sighting-value="identify"]') as HTMLElement).style.color)
      .toBe('rgb(124, 135, 148)');
  });

  it('shows both strings and takes the caution tint when they disagree', () => {
    const { container } = renderPlate({ liveVersion: '0.201.0' });
    const identify = row(container, 'identify');
    expect(identify).toContain(RECORD.client_version);
    expect(identify).toContain('LIVE RPC SAYS 0.201.0');
    expect((container.querySelector('[data-sighting-value="identify"]') as HTMLElement).style.color)
      .toBe('rgb(246, 226, 1)');
  });

  it('reads the address book from both ends, in two units that cannot swap', () => {
    // The row this replaces printed ONE number for a relationship with two
    // ends, and upstream deleted the number under it. Both directions are
    // answerable now and they are neither the same measurement nor the same
    // unit: peers that gossip this node, and addresses this node gossiped. A
    // peer is advertised under every alias anybody ever saw it at, so the
    // second runs several times the first — printing either under the other's
    // label would misstate the network by an unbounded factor and read just
    // as confidently.
    const { container } = renderPlate();
    expect(row(container, 'crowd-inbound')).toContain('ADVERTISED BY');
    expect(row(container, 'crowd-outbound')).toContain('ADVERTISES');
    // The VALUES, where the unit is the number's own word and a swap would be
    // silent. Read separately from the rows above, because both captions name
    // the unit they are NOT.
    expect(value(container, 'crowd-inbound')).toBe(`${RECORD.advertiser_peer_count} PEERS`);
    expect(value(container, 'crowd-outbound')).toBe('5,727 ADDRESSES');
    // The unit is never left to be inferred from a bare number.
    expect(RECORD.advertised_address_count).not.toBe(RECORD.advertiser_peer_count);
  });

  it('calls the crowd gossip rather than a drawing of who is connected', () => {
    // Upstream is explicit that `knownPeers` is address-book gossip and not a
    // live topology edge. This plate hangs beside a scene that draws points
    // joined by lines, which is exactly where a reader supplies the wrong
    // sentence unless the row says otherwise.
    const { container } = renderPlate();
    expect(row(container, 'crowd-inbound')).toContain('GOSSIP, NOT LINKS');
    expect(row(container, 'crowd-outbound')).toContain('NOT PEERS');
  });

  it('states one and many in the units they are counted in', () => {
    const { container } = renderPlate({
      record: { ...RECORD, advertiser_peer_count: 1, advertised_address_count: 1 },
    });
    expect(value(container, 'crowd-inbound')).toBe('1 PEER');
    expect(value(container, 'crowd-outbound')).toBe('1 ADDRESS');
  });

  it('stands each direction down on its own when nobody can say', () => {
    // Absent has to read as "nobody can say" and never as a zero, an empty
    // row, or a number inferred from the other direction. The two are
    // separately absent because they are separately answerable: the outbound
    // counter is nested inside a verification, so a peer can have one and not
    // the other.
    const record = { ...RECORD };
    delete record.advertised_address_count;
    const { container } = renderPlate({ record });
    expect(container.querySelector('[data-sighting-row="crowd-inbound"]')).not.toBeNull();
    expect(container.querySelector('[data-sighting-row="crowd-outbound"]')).toBeNull();
    expect(container.textContent).not.toContain('ADVERTISES');

    cleanup();
    const silent = { ...RECORD };
    delete silent.advertiser_peer_count;
    delete silent.advertised_address_count;
    const quiet = renderPlate({ record: silent });
    expect(quiet.container.querySelector('[data-sighting-row="crowd-inbound"]')).toBeNull();
    expect(quiet.container.querySelector('[data-sighting-row="crowd-outbound"]')).toBeNull();
    expect(quiet.container.textContent).not.toContain('ADVERTISED BY');
  });

  it('never prints a zero where nobody counted, and prints one where they did', () => {
    const { container } = renderPlate({
      record: { ...RECORD, advertiser_peer_count: 0, advertised_address_count: 0 },
    });
    // A crawler that answered with an empty list has said zero, and zero is a
    // report — the row that stands down is the one with no answer at all.
    expect(value(container, 'crowd-inbound')).toBe('0 PEERS');
    expect(value(container, 'crowd-outbound')).toBe('0 ADDRESSES');
  });
});

describe('PeerSightingPlate dialects', () => {
  it('reads a peer\'s dossier with its whereabouts first', () => {
    const { container } = renderPlate();
    const rows = Array.from(container.querySelectorAll('[data-sighting-row]'))
      .map((node) => node.getAttribute('data-sighting-row'));
    expect(rows).toEqual([
      'whereabouts',
      'exposure',
      'network-age',
      'identify',
      'crowd-inbound',
      'crowd-outbound',
    ]);
    expect(container.textContent).not.toContain('HOW THE NETWORK SEES YOU');
  });

  it('turns the same plate into a mirror, exposure first', () => {
    const { container } = renderPlate({ variant: 'self', module: 'SELF·04' });
    const rows = Array.from(container.querySelectorAll('[data-sighting-row]'))
      .map((node) => node.getAttribute('data-sighting-row'));
    expect(rows[0]).toBe('exposure');
    expect(container.querySelector('[data-sighting-caption]')?.textContent)
      .toBe('HOW THE NETWORK SEES YOU');
    expect(container.textContent).toContain('SELF·04');
  });

  it('keeps the mirror caption even when nobody has seen us', () => {
    const { container } = renderPlate({
      variant: 'self',
      phase: 'unsighted',
      record: null,
      reason: 'never_sighted',
    });
    expect(container.textContent).toContain('HOW THE NETWORK SEES YOU');
    expect(container.textContent).toContain('NO CRAWLER SIGHTING');
  });

  it('drops the rows that compare a crawler-only subject with itself', () => {
    const { container } = renderPlate({ variant: 'sighted', module: 'SGHT·03' });
    const rows = Array.from(container.querySelectorAll('[data-sighting-row]'))
      .map((node) => node.getAttribute('data-sighting-row'));
    // No live RPC stands on the other side, so IDENTIFY could only set the
    // crawler's version against the crawler's version.
    expect(rows).toEqual([
      'whereabouts',
      'exposure',
      'network-age',
      'crowd-inbound',
      'crowd-outbound',
    ]);
    expect(container.textContent).not.toContain('NO LIVE VERSION TO CHECK AGAINST');
    // The dial belongs to the host card's own RECORD row in this dialect,
    // which had it off the roster before this lookup was even sent.
    expect(container.textContent).not.toContain('THEIR DIAL');
    expect(container.textContent).toContain('SGHT·03');
  });

  it('speaks its own namespace — neither the cell nor the peer dialect', () => {
    const { container } = renderPlate({ variant: 'self' });
    expect(container.innerHTML).not.toContain('data-cell-');
    expect(container.innerHTML).not.toContain('data-peer-');
    expect(container.querySelector('[data-sighting-plate]')).not.toBeNull();
  });
});

describe('formatNetworkSpan', () => {
  it('remembers a membership in the units it was measured in', () => {
    expect(formatNetworkSpan(0)).toBe('UNDER AN HOUR');
    expect(formatNetworkSpan(5 * 3_600_000)).toBe('5 H');
    expect(formatNetworkSpan(9 * 86_400_000)).toBe('9 D');
    expect(formatNetworkSpan(425 * 86_400_000)).toBe('1 YR 2 MO');
    expect(formatNetworkSpan(366 * 86_400_000)).toBe('1 YR');
    expect(formatNetworkSpan(420 * 86_400_000)).toBe('1 YR 1 MO');
    expect(formatNetworkSpan(90 * 86_400_000)).toBe('3 MO');
  });

  it('never runs backwards on a clock that disagrees with the source', () => {
    expect(formatNetworkSpan(-5_000)).toBe('UNDER AN HOUR');
  });
});

describe('PeerSightingPlate integrity', () => {
  it('never draws a frame with nothing inside it', () => {
    // Should not be reachable — but an empty plate would be the one thing on
    // either card that claims a module number and then says nothing.
    const { container } = renderPlate({ record: null });
    expect(container.querySelector('[data-sighting-absence]')?.textContent)
      .toContain('CRAWLER SIGHTING UNAVAILABLE');
  });
});
