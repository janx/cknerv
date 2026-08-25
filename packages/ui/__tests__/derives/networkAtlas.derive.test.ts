import { describe, expect, it } from 'vitest';
import {
  PEER_PROBE_HANDSHAKE_AXIS,
  type EnrichmentSourceStatus,
  type NetworkAtlasRecord,
} from '@cknerv/types';
import {
  deriveNetworkAtlasVisual,
  NETWORK_ATLAS_STALE_AFTER_MS,
  networkAtlasVisualState,
} from '../../src/derives/networkAtlas.derive';
import { CONTENT_BANDS } from '../../src/components/hud/cellFormat';
import { ORDINAL_DEPTH_RAMP, QUALITATIVE_BUCKET_COLORS } from '../../src/components/hud/hudTheme';

// One round's outcome matrix written out, so every equality below has a
// coherent record to be broken against: 9 answered on this network, 51 ran
// their address list out (33 of them still holding an earlier verification),
// 1 answered from somewhere else. 9 + 51 + 1 = 61 considered, and 9 + 33 = 42
// held verified.
const record: NetworkAtlasRecord = {
  source: 'ckbadger',
  as_of: { block: 100, hash: `0x${'aa'.repeat(32)}` },
  updated_at_ms: 1,
  crawl_round: 7,
  crawl_finished_at_s: 1_700_000_000,
  candidate_peers: 61,
  last_round_reachable: 9,
  foreign_peers: 1,
  exhausted_candidates: 51,
  verified_unavailable_peers: 33,
  verified_retained_peers: 42,
  new_verified_peers: 3,
  // …and the address histogram beside that matrix, on its OWN population: those
  // 61 peers were dialed on 95 addresses between them. 18 + 60 + 5 + 2 + 1 + 9
  // is 95, and the top rung is the 9 peers that identified.
  address_attempts: 95,
  handshake_depth: [
    { result: 'dial_request_failed', attempts: 18 },
    { result: 'no_authenticated_session_before_deadline', attempts: 60 },
    { result: 'authenticated_session_without_identify_before_deadline', attempts: 5 },
    { result: 'malformed_identify', attempts: 2 },
    { result: 'foreign_network', attempts: 1 },
    { result: 'same_network_identified', attempts: 9 },
  ],
  indexed_peers: 42,
  countries: [
    { label: 'US', count: 14 },
    { label: 'SG', count: 28 },
  ],
  versions: [
    { label: '0.118.0', count: 12 },
    { label: '0.119.0', count: 30 },
  ],
  asns: [
    { label: 'AS2 Example', count: 2 },
    { label: 'AS1 Example', count: 40 },
  ],
};

const source: EnrichmentSourceStatus = {
  source: 'ckbadger',
  status: 'ready',
  capabilities: ['network_atlas'],
  validated_anchor: { block: 101, hash: `0x${'bb'.repeat(32)}` },
};

describe('network atlas visual derivation', () => {
  it('ranks all three census fingerprints without exposing individual peers', () => {
    const visual = deriveNetworkAtlasVisual(record);
    expect(visual?.countries.map(({ label, count }) => ({ label, count }))).toEqual([
      { label: 'SG', count: 28 },
      { label: 'US', count: 14 },
    ]);
    expect(visual?.versions[0].label).toBe('0.119.0');
    // The axis a 64-row sample could not have answered: one operator holding
    // most of the fleet is a fact about the network, and it only exists once
    // the buckets are counted over the whole verified set.
    expect(visual?.asns[0].label).toBe('AS1 Example');
    expect(visual?.asns[0].count).toBe(40);
    expect(record).not.toHaveProperty('peers');
  });

  it('rejects buckets that disagree with the peers they claim to describe', () => {
    // Each strip is drawn as its buckets' share of ONE population, so a
    // histogram that does not add up to that population draws bars of the
    // wrong width rather than a short bar. Short, over, and — the case that
    // matters most — a multi-label histogram, which is exactly the shape
    // upstream's `protocols` has and the reason nothing reads it.
    expect(deriveNetworkAtlasVisual({
      ...record,
      countries: [{ label: 'SG', count: 28 }],
    })).toBeNull();
    expect(deriveNetworkAtlasVisual({
      ...record,
      versions: [{ label: '0.119.0', count: 43 }],
    })).toBeNull();
    expect(deriveNetworkAtlasVisual({
      ...record,
      asns: record.asns.map((bucket) => ({ ...bucket, count: bucket.count * 2 })),
    })).toBeNull();
    // And an axis that arrives empty is not a strip to skip: it is a record
    // whose three histograms no longer describe one population.
    expect(deriveNetworkAtlasVisual({ ...record, asns: [] })).toBeNull();
  });

  it('rejects a round whose outcomes do not add up to its candidates', () => {
    // The three ways a completed candidate can end ARE the candidates —
    // upstream reads all four counts off one disjoint outcome matrix, so this
    // is an equality and not a bound. A cohort short and a cohort over both
    // have to bite: loosen it to `<=` and a round that lost a whole cohort on
    // the way out still publishes a ladder, with rungs that quietly stop
    // describing the number above them.
    expect(deriveNetworkAtlasVisual({ ...record, exhausted_candidates: 50 })).toBeNull();
    expect(deriveNetworkAtlasVisual({ ...record, foreign_peers: 2 })).toBeNull();
    expect(deriveNetworkAtlasVisual({ ...record, candidate_peers: 60 })).toBeNull();
  });

  it('rejects a round whose verified peers do not split in two', () => {
    // A peer the crawler still holds a verification for was either reached
    // this round or it was not, and there is no third case. This is what lets
    // the ladder print the unavailable count beside the reachable one without
    // implying it is a further part of the candidates.
    expect(deriveNetworkAtlasVisual({ ...record, verified_unavailable_peers: 32 })).toBeNull();
    expect(deriveNetworkAtlasVisual({ ...record, verified_unavailable_peers: 34 })).toBeNull();
    expect(deriveNetworkAtlasVisual({
      ...record,
      new_verified_peers: record.verified_retained_peers + 1,
    })).toBeNull();
  });

  it('lays the round dials along the whole handshake axis, in the axis order', () => {
    const visual = deriveNetworkAtlasVisual(record);

    expect(visual?.handshake.map((rung) => rung.result))
      .toEqual([...PEER_PROBE_HANDSHAKE_AXIS]);
    expect(visual?.handshake.map((rung) => rung.attempts))
      .toEqual([18, 60, 5, 2, 1, 9]);
    // On its own population, which is NOT any peer count in the same record.
    expect(visual?.handshake.reduce((sum, rung) => sum + rung.attempts, 0))
      .toBe(record.address_attempts);
    expect(record.address_attempts).toBeGreaterThan(record.candidate_peers);
  });

  it('rejects dials that do not add up to the dials the round says it made', () => {
    // The partition, and the whole claim the strip makes: its segments are ALL
    // of the segments. Upstream derives `addressAttempts` by summing these six,
    // so the equality can only break two ways — the wire ceasing to mean what
    // it says, and a SEVENTH result arriving that this build has no bucket for.
    // Both directions bite, because each segment is drawn as a share of the
    // total this record states and a wrong total draws every OTHER bar wrong.
    const rungs = record.handshake_depth;
    expect(deriveNetworkAtlasVisual({
      ...record,
      handshake_depth: rungs.map((rung, index) => (
        index === 1 ? { ...rung, attempts: rung.attempts - 1 } : rung
      )),
    })).toBeNull();
    expect(deriveNetworkAtlasVisual({
      ...record,
      handshake_depth: rungs.map((rung, index) => (
        index === 3 ? { ...rung, attempts: rung.attempts + 1 } : rung
      )),
    })).toBeNull();
    // A seventh rung upstream, seen from in here: the total grows and the six
    // do not.
    expect(deriveNetworkAtlasVisual({
      ...record,
      address_attempts: record.address_attempts + 4,
    })).toBeNull();
    // …and the record these three are mutations OF has to pass, or none of them
    // is evidence about the rule.
    expect(deriveNetworkAtlasVisual(record)?.handshake).toHaveLength(6);
  });

  it('rejects an axis that is not this axis, in this order', () => {
    // The ordinal, enforced rather than assumed. `dial refused → no session →
    // session without identify → unreadable identify → another chain →
    // identified` is a progression, the bar draws it left to right, and a
    // reader puts two segments in order by where they sit. Reorder the rungs
    // and the same six numbers say something else.
    const rungs = record.handshake_depth;
    const swapped = [...rungs];
    [swapped[1], swapped[3]] = [swapped[3], swapped[1]];
    expect(deriveNetworkAtlasVisual({ ...record, handshake_depth: swapped })).toBeNull();

    // Reversed outright — the same six rungs and the same total, so what is
    // refused here is the ORDER and nothing else.
    expect(deriveNetworkAtlasVisual({
      ...record,
      handshake_depth: [...rungs].reverse(),
    })).toBeNull();

    // A rung missing, a rung twice, and `unknown` — cknerv's own word for an
    // observation it could not read on one peer, which is never a bucket of a
    // round's histogram. One check catches all three.
    expect(deriveNetworkAtlasVisual({
      ...record,
      address_attempts: record.address_attempts - rungs[3].attempts,
      handshake_depth: rungs.filter((_, index) => index !== 3),
    })).toBeNull();
    expect(deriveNetworkAtlasVisual({
      ...record,
      handshake_depth: rungs.map((rung, index) => (
        index === 4 ? { ...rungs[3], attempts: rung.attempts } : rung
      )),
    })).toBeNull();
    expect(deriveNetworkAtlasVisual({
      ...record,
      handshake_depth: rungs.map((rung, index) => (
        index === 0 ? { result: 'unknown' as const, attempts: rung.attempts } : rung
      )),
    })).toBeNull();
  });

  it('keeps a rung no dial ended on, where the label strips refuse one', () => {
    // The two histograms disagree about zero on purpose. A country with no
    // peers in it is a country nobody named, so `deriveBuckets` refuses one and
    // upstream never emits one. This histogram always answers with all six
    // counters, and "no dial ended with an unreadable identify" is a RESULT —
    // an axis that dropped its quiet rungs would render a clean round and a
    // build that stopped counting them identically.
    const quiet = {
      ...record,
      address_attempts: record.address_attempts - 3,
      handshake_depth: record.handshake_depth.map((rung) => (
        rung.result === 'malformed_identify' || rung.result === 'foreign_network'
          ? { ...rung, attempts: 0 }
          : rung
      )),
    };
    const visual = deriveNetworkAtlasVisual(quiet);
    expect(visual?.handshake).toHaveLength(6);
    expect(visual?.handshake.filter((rung) => rung.attempts === 0).map((rung) => rung.result))
      .toEqual(['malformed_identify', 'foreign_network']);

    // The proof that this is the opposite rule and not the same one: a zero in
    // a label histogram still refuses the record.
    expect(deriveNetworkAtlasVisual({
      ...record,
      countries: [...record.countries, { label: 'NZ', count: 0 }],
    })).toBeNull();
  });

  it('colours the handshake axis by position, out of a ramp that ranks', () => {
    // The strips beside it hash a label into a slot, because a country has no
    // order. This one has nothing BUT order, so it takes the ordinal ramp — and
    // the two vocabularies share no member, which is half of what tells a
    // reader the bar is counting a different population.
    const visual = deriveNetworkAtlasVisual(record);
    const painted = visual?.handshake.map((rung) => rung.color) ?? [];

    expect(painted).toEqual([...ORDINAL_DEPTH_RAMP]);
    expect(painted.filter((color) => QUALITATIVE_BUCKET_COLORS.includes(color))).toEqual([]);
    // Position, not identity: the colour is the index, so a rung that moved
    // would take its neighbour's step rather than carrying its own along.
    const reversed = deriveNetworkAtlasVisual({
      ...record,
      handshake_depth: [...record.handshake_depth].reverse(),
    });
    expect(reversed).toBeNull();
  });

  it('never asserts the round clock against the index clock', () => {
    // `indexed_peers` and `verified_retained_peers` mean the same words on two
    // different clocks: a scan of the crawler's node store as the request
    // arrived, against what the last round's matrix added up to when it
    // finished. They agree in every steady state and nothing promises they
    // must, so a record where a round landed between the two reads still
    // renders — with the buckets counted against their own number, which is
    // the one their caption states.
    const midRound = {
      ...record,
      indexed_peers: 43,
      countries: [{ label: 'SG', count: 43 }],
      versions: [{ label: '0.119.0', count: 43 }],
      asns: [{ label: 'AS1 Example', count: 43 }],
    };
    expect(deriveNetworkAtlasVisual(midRound)?.countries[0].count).toBe(43);
  });

  it('colours all three bars out of one ramp that means nothing', () => {
    // Two claims at once. Every bucket takes a slot of the shared ramp — the
    // countries and the versions used to hold two arrays that agreed on three
    // of their five values anyway, and the ramp is the house's now, handed out
    // by rank on the STAGE script bar for the same reason it is handed out by
    // hash here — and none of them lands on a content band, because a country
    // is not an asset class and a bar that said it was would be lying in a way
    // a reader cannot see.
    const visual = deriveNetworkAtlasVisual(record);
    const painted = [
      ...visual?.countries ?? [],
      ...visual?.versions ?? [],
      ...visual?.asns ?? [],
    ].map((bucket) => bucket.color);
    expect(painted).toHaveLength(6);
    expect(painted.every((color) => QUALITATIVE_BUCKET_COLORS.includes(color))).toBe(true);
    const bands = new Set<string>(Object.values(CONTENT_BANDS));
    expect(QUALITATIVE_BUCKET_COLORS.filter((color) => bands.has(color))).toEqual([]);
  });

  it('requires the capability, usable source, and compatible anchor', () => {
    expect(networkAtlasVisualState(source, record, 1)).toBe('ready');
    expect(networkAtlasVisualState({ ...source, capabilities: [] }, record, 1))
      .toBeNull();
    expect(networkAtlasVisualState({ ...source, status: 'error' }, record, 1))
      .toBeNull();
    expect(networkAtlasVisualState({
      ...source,
      validated_anchor: { block: 100, hash: `0x${'cc'.repeat(32)}` },
    }, record, 1)).toBeNull();
  });

  it('dims the atlas when its minute refresh stops', () => {
    expect(networkAtlasVisualState(
      source,
      record,
      record.updated_at_ms + NETWORK_ATLAS_STALE_AFTER_MS + 1,
    )).toBe('stale');
  });
});
