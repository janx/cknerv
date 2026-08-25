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
      nowMs: ADVERTISED.last_advertised_at_ms + 120_000,
    });
    expect(container.querySelector('[data-sighting-phase="unsighted"]')
      ?.getAttribute('data-sighting-reason')).toBe('advertised_unverified');
    expect(container.textContent).toContain('NAMED BY THE NETWORK, NEVER VERIFIED');
    expect(container.textContent).not.toContain('NEVER SEEN FROM OUTSIDE');
    expect(container.textContent).not.toContain('NO CRAWLER SIGHTING');
    // The typed reason, and the clock the report is dated by — an unverified
    // peer has no sighting to be stamped by, so this is the only one it has.
    expect(container.textContent).toContain('NO HANDSHAKE BEFORE THE DEADLINE');
    expect(container.textContent).toContain('LAST NAMED 2m 0s AGO');
    expect(container.textContent).toContain('2 ROUNDS EXHAUSTED');
    expect(container.querySelector('[data-sighting-absence]')
      ?.getAttribute('data-sighting-probe'))
      .toBe('no_authenticated_session_before_deadline');
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
      // The absence block is one headline div followed by its caption divs.
      const lines = Array.from(container.querySelectorAll('[data-sighting-absence] > div'))
        .map((node) => node.textContent ?? '');
      expect(lines.length).toBe(3);
      sentences.set(rung, lines[1]);
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
    expect(container.textContent).toContain('LAST NAMED');
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
      .toBe('SIGHTED 1m 0s AGO');
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
    expect(exposure).toContain('LAST DIAL 2h 1m AGO');
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
    expect(age).toContain('WE HAVE HELD THIS LINK 1h 2m');
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

  it('labels the address-book figure as the sample it is', () => {
    // The count is optional on the record now, so this is a record with one
    // — a source that can still answer the OUTBOUND question. ckbadger no
    // longer can: it deleted `knownPeers` and answers with the peers that
    // named THIS node instead, which is the same relationship read from the
    // other end and would print this sentence backwards.
    const { container } = renderPlate({ record: { ...RECORD, known_peers_count: 45 } });
    const crowd = row(container, 'crowd');
    expect(crowd).toContain('~45 PEERS IN ADDRESS BOOK');
    expect(crowd).toContain('SAMPLED');
  });

  it('stands the crowd row down entirely when nobody can say', () => {
    // The committed sample is what the adapter actually produces, and it
    // carries no count. Absent has to read as "nobody can say" and never as
    // a zero, an empty row, or a number inferred from the other direction.
    expect(RECORD.known_peers_count).toBeUndefined();
    const { container } = renderPlate();
    expect(container.querySelector('[data-sighting-row="crowd"]')).toBeNull();
    expect(container.textContent).not.toContain('ADDRESS BOOK');
    expect(container.textContent).not.toContain('CROWD');
  });
});

describe('PeerSightingPlate dialects', () => {
  it('reads a peer\'s dossier with its whereabouts first', () => {
    const { container } = renderPlate();
    const rows = Array.from(container.querySelectorAll('[data-sighting-row]'))
      .map((node) => node.getAttribute('data-sighting-row'));
    // CROWD stands down: no source can answer the outbound question today.
    expect(rows).toEqual(['whereabouts', 'exposure', 'network-age', 'identify']);
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
    expect(rows).toEqual(['whereabouts', 'exposure', 'network-age']);
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
