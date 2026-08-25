// The peer sighting lookup, driven against the SERVER-AUTHORED bodies.
//
// Every response body here is a sample the Rust serializer wrote into
// `tests/fixtures/enrichment_samples.json`, so a contract change on the
// server breaks these assertions instead of silently reaching the plate.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { PeerSightingLookup } from '@cknerv/types';

import {
  cachedPeerSighting,
  clearPeerSightingMemo,
  fetchPeerSighting,
} from '../src/semanticsClient';

const __dirname = dirname(fileURLToPath(import.meta.url));
const samples = JSON.parse(
  readFileSync(
    resolve(__dirname, '..', '..', '..', 'tests', 'fixtures', 'enrichment_samples.json'),
    'utf8',
  ),
) as { peer_sightings: Record<string, PeerSightingLookup> };

function body(name: string): PeerSightingLookup {
  const sample = samples.peer_sightings[name];
  expect(sample, `enrichment_samples.json is missing ${name}`).toBeDefined();
  return sample;
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const NODE_ID = 'QmagxSv7GNwKXQE7mi1iDjFHghjUpbqjBgqSot7PmMJqHA';

beforeEach(() => clearPeerSightingMemo());
afterEach(() => {
  vi.unstubAllGlobals();
  clearPeerSightingMemo();
});

describe('fetchPeerSighting', () => {
  it('routes the lookup through cknerv under the peer\'s own id', async () => {
    const sighted = body('sighted');
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(sighted));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchPeerSighting(NODE_ID, {
      baseUrl: 'http://127.0.0.1:17001/',
    })).resolves.toEqual(sighted);
    expect(fetchMock).toHaveBeenCalledWith(
      `http://127.0.0.1:17001/api/enrichment/peers/${NODE_ID}`,
      { signal: undefined },
    );
  });

  it('escapes an id the local peer list handed us verbatim', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(body('unreadable_node_id')));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchPeerSighting('ckb:local')).resolves.toEqual({
      state: 'unsighted',
      reason: 'unreadable_node_id',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/enrichment/peers/ckb%3Alocal',
      { signal: undefined },
    );
  });

  it('keeps each silence distinct from the others', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(body('never_sighted')))
      .mockResolvedValueOnce(jsonResponse(body('no_crawler')));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchPeerSighting('QmNeverSeen')).resolves.toEqual({
      state: 'unsighted',
      reason: 'never_sighted',
    });
    await expect(fetchPeerSighting('QmNoCrawler')).resolves.toEqual({
      state: 'unsighted',
      reason: 'no_crawler',
    });
  });

  it('carries the evidence under an absence through untouched', async () => {
    // `advertised_unverified` is the one absence with a payload, and the
    // plate's two captions are the only thing that reads it. A client that
    // narrowed the answer to its `reason` would leave the plate with a
    // headline and nothing to qualify it — and nothing else here would fail.
    const advertised = body('advertised_unverified');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(advertised)));

    const outcome = await fetchPeerSighting('QmAdvertised');

    expect(outcome).toEqual(advertised);
    if (outcome.state !== 'unsighted') throw new Error('expected an absence');
    expect(outcome.reason).toBe('advertised_unverified');
    expect(outcome.advertised?.furthest_result)
      .toBe('no_authenticated_session_before_deadline');
    expect(outcome.advertised?.consecutive_exhausted_rounds).toBe(2);
    // The rest of the payload has to survive the trip too: the address the
    // furthest dial went to, how many were dialed, and how many peers still
    // name it. A client that carried only the two fields it was written for
    // would silently drop the rows added after it.
    expect(outcome.advertised?.furthest_address).toBe('/ip4/198.51.100.4/tcp/8115');
    expect(outcome.advertised?.dialed_address_count).toBe(3);
    expect(outcome.advertised?.advertiser_peer_count).toBe(6);
  });

  it('reads a disabled source off the 404 rather than calling it an absence', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(
      { error: 'enrichment_disabled', message: 'no enrichment source is configured' },
      404,
    )));

    await expect(fetchPeerSighting(NODE_ID)).resolves.toEqual({ state: 'disabled' });
  });

  it('surfaces a source fault with the message the server sent', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(
      { error: 'enrichment_unavailable', message: 'validated anchor expired' },
      503,
    )));

    await expect(fetchPeerSighting(NODE_ID))
      .rejects.toThrow('validated anchor expired');
  });

  it('falls back to the status when a fault carries no message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 502 })));

    await expect(fetchPeerSighting(NODE_ID))
      .rejects.toThrow('Peer enrichment failed with HTTP 502');
  });

  it('treats a body with no state as a fault, never as a sighting', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ sighting: {} })));

    await expect(fetchPeerSighting(NODE_ID))
      .rejects.toThrow('Peer sighting response carried no state');
  });

  it('passes the abort signal through and lets the rejection surface', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn().mockRejectedValue(new DOMException('Aborted', 'AbortError'));
    vi.stubGlobal('fetch', fetchMock);

    const pending = fetchPeerSighting(NODE_ID, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toThrow('Aborted');
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/enrichment/peers/${NODE_ID}`,
      { signal: controller.signal },
    );
  });
});

describe('peer sighting session memo', () => {
  it('answers a repeat visit without asking the server again', async () => {
    const sighted = body('sighted');
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(sighted));
    vi.stubGlobal('fetch', fetchMock);

    expect(cachedPeerSighting(NODE_ID, 'ckbadger:ready')).toBeNull();
    await fetchPeerSighting(NODE_ID, { cacheIdentity: 'ckbadger:ready' });
    expect(cachedPeerSighting(NODE_ID, 'ckbadger:ready')).toEqual(sighted);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('remembers a silence too — it is an answer', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(body('never_sighted'))));

    await fetchPeerSighting('QmNeverSeen', { cacheIdentity: 'ckbadger:ready' });
    expect(cachedPeerSighting('QmNeverSeen', 'ckbadger:ready'))
      .toEqual({ state: 'unsighted', reason: 'never_sighted' });
  });

  it('forgets everything when the source identity changes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(body('sighted'))));

    await fetchPeerSighting(NODE_ID, { cacheIdentity: 'ckbadger:ready' });
    expect(cachedPeerSighting(NODE_ID, 'ckbadger:stale')).toBeNull();
    // …and the old identity does not come back to life behind it.
    expect(cachedPeerSighting(NODE_ID, 'ckbadger:ready')).toBeNull();
  });

  it('leaves the memo untouched when no identity is offered', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(body('sighted'))));

    await fetchPeerSighting(NODE_ID);
    expect(cachedPeerSighting(NODE_ID, 'ckbadger:ready')).toBeNull();
  });

  it('holds only the most recent entries, oldest first out', async () => {
    // One fresh Response per call: a body is readable exactly once.
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(body('never_sighted'))));

    for (let i = 0; i < 70; i += 1) {
      await fetchPeerSighting(`QmPeer${i}`, { cacheIdentity: 'ckbadger:ready' });
    }
    expect(cachedPeerSighting('QmPeer0', 'ckbadger:ready')).toBeNull();
    expect(cachedPeerSighting('QmPeer5', 'ckbadger:ready')).toBeNull();
    expect(cachedPeerSighting('QmPeer69', 'ckbadger:ready')).not.toBeNull();
    expect(cachedPeerSighting('QmPeer6', 'ckbadger:ready')).not.toBeNull();
  });
});
