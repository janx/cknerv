import { describe, expect, it } from 'vitest';
import { applyChainMutation, emptyChainCache } from '@cknerv/cache';
import type {
  BlockProducer, ChainEntry, Mutation, NetworkRosterRecord, RosterNode,
} from '@cknerv/types';
import {
  deriveBlockProducers,
  producerCandidates,
  PRODUCER_FAN_MAX_CANDIDATES,
  PRODUCER_FAN_MAX_SHARE_OF_VERSIONED,
  PRODUCER_FAN_MIN_CANDIDATES,
  PRODUCER_VERSION_MIN_CHARS,
  type BlockProducerView,
  type ProducerStanding,
} from '../../src/derives/blockProducers.derive';

/** A build string long enough to be a fingerprint, in the shape mainnet
 *  actually declares. Never a live count and never a live hash — the crawl and
 *  the pools both drift, so every number below is constructed. */
const RARE_BUILD = '0.209.0 (aaaaaaa 2026-07-30)';
const STOCK_BUILD = '0.209.0 (bbbbbbb 2026-07-29)';

function producer(over: Partial<BlockProducer> & { key: string }): BlockProducer {
  return { message: RARE_BUILD, blocks: 1, last_seen_ms: 1_700_000_000_000, ...over };
}

/** A chain entity whose producer window is self-consistent by construction:
 *  the denominator is the sum of the numerators, which is the identity the
 *  derive refuses to draw shares without. */
function chainWith(
  producers: BlockProducer[], over: Partial<ChainEntry> = {},
): ChainEntry {
  const counted = producers.reduce((sum, p) => sum + p.blocks, 0);
  return {
    ...emptyChainCache(),
    producers,
    producer_window: producers.flatMap((p, i) => Array<number>(p.blocks).fill(i)),
    producer_window_blocks: counted,
    ...over,
  };
}

function rosterNode(over: Partial<RosterNode> & { node_id: string }): RosterNode {
  return {
    addr: '/ip4/10.0.0.1/tcp/8115',
    state: 'reachable',
    version: STOCK_BUILD,
    country: 'Unknown',
    asn: 'Unknown',
    last_reachable_ms: 1_700_000_000_000,
    last_advertised_ms: 1_700_000_060_000,
    last_observed_ms: 1_700_000_000_000,
    latest_positive_observed_ms: 1_700_000_065_000,
    ...over,
  };
}

function roster(entries: RosterNode[]): NetworkRosterRecord {
  return {
    source: 'ckbadger',
    as_of: { block: 12_000_000, hash: '0xabc' },
    updated_at_ms: 1_700_000_000_000,
    crawl_round: 1,
    truncated: false,
    entries,
  };
}

/** `n` rows on `version`, with ids that sort ascending as the crawler sends
 *  them. `tag` keeps two cohorts from colliding on id. */
function cohort(tag: string, n: number, version?: string): RosterNode[] {
  return Array.from({ length: n }, (_, i) => rosterNode({
    node_id: `Qm${tag}${String(i).padStart(4, '0')}`,
    ...(version === undefined ? { version: undefined } : { version }),
  }));
}

/** A roster where `rare` peers run RARE_BUILD and `stock` peers run
 *  STOCK_BUILD — the live asymmetry in miniature, with no live numbers in it. */
function splitRoster(rare: number, stock: number): NetworkRosterRecord {
  return roster([...cohort('r', rare, RARE_BUILD), ...cohort('s', stock, STOCK_BUILD)]);
}

function view(chain: ChainEntry, r?: NetworkRosterRecord | null): BlockProducerView {
  const derived = deriveBlockProducers(chain, r);
  expect(derived).not.toBeNull();
  return derived as BlockProducerView;
}

function standingFor(v: BlockProducerView, key: string): ProducerStanding {
  const found = v.staging.find((p) => p.key === key);
  expect(found).toBeDefined();
  return found as ProducerStanding;
}

/** The reason a fan was withheld, or `'drawn'`. Reading it this way keeps
 *  every gate assertion below on the discriminant rather than on a boolean
 *  plus a field that only exists on one branch. */
function fanReason(standing: ProducerStanding): string {
  return standing.fan.drawn ? 'drawn' : standing.fan.reason;
}

describe('blockProducers staging set', () => {
  /** The signature App keys its topology memo on, spelled here so the
   *  assertions below are about the thing the colony actually rebuilds on. */
  const stagingSig = (v: BlockProducerView) => v.staging.map((p) => p.key).join('\u0000');

  it('stages in key order, whatever order the wire sent', () => {
    const rows = [
      producer({ key: '0xcc', blocks: 4 }),
      producer({ key: '0xaa', blocks: 9 }),
      producer({ key: '0xbb', blocks: 4 }),
    ];
    const forward = view(chainWith(rows));
    expect(forward.staging.map((p) => p.key)).toEqual(['0xaa', '0xbb', '0xcc']);
    // The wire's own order is first-appearance in a rolling ring, so it
    // reshuffles as producers blink in and out of the window. The staging
    // order may not follow it.
    const reversed = view(chainWith([...rows].reverse()));
    expect(reversed.staging.map((p) => p.key)).toEqual(forward.staging.map((p) => p.key));
  });

  it('reads back in share order, over the very same standings', () => {
    const v = view(chainWith([
      producer({ key: '0xaa', blocks: 2 }),
      producer({ key: '0xbb', blocks: 9 }),
      producer({ key: '0xcc', blocks: 2 }),
    ]));
    expect(v.staging.map((p) => p.key)).toEqual(['0xaa', '0xbb', '0xcc']);
    expect(v.ranked.map((p) => p.key)).toEqual(['0xbb', '0xaa', '0xcc']);
    // Permutations of one another over the SAME objects, which is what lets a
    // card `find` in either without having to know which: a share and the
    // window it was divided by can never come off two different readings.
    expect(v.ranked).toHaveLength(v.staging.length);
    for (const standing of v.ranked) expect(v.staging).toContain(standing);
  });

  it('⭐ two miners swapping rank moves nothing the colony is keyed on', () => {
    // ⚠️⚠️ THE FAILURE THIS PINS, and it is not the one a block-count key
    // already guards. The staging array was ordered by BLOCKS, so a swap
    // between two neighbouring shares — which a rolling window produces
    // constantly, and which changes NO miner's membership — re-sequenced an
    // identical set. An identical set in a new sequence is a new signature, a
    // missed scaffold cache, and a full O(V² log V) colony rebuild on the
    // render path; land it mid-wave and `ColonyEdges` gets fresh surge lanes
    // under an in-flight wavefront.
    const before = view(chainWith([
      producer({ key: '0xaa', blocks: 5 }),
      producer({ key: '0xbb', blocks: 4 }),
      producer({ key: '0xcc', blocks: 1 }),
    ]));
    const after = view(chainWith([
      producer({ key: '0xaa', blocks: 4 }),
      producer({ key: '0xbb', blocks: 5 }),
      producer({ key: '0xcc', blocks: 1 }),
    ]));
    expect(after.staging.map((p) => p.key)).toEqual(before.staging.map((p) => p.key));
    expect(stagingSig(after)).toBe(stagingSig(before));

    // …and the swap still CROSSES, on the half that is allowed to move. A fix
    // that froze both orders would have hidden the overtake rather than routed
    // it, and MESH·02's `TOP` would name the wrong miner.
    expect(before.ranked[0].key).toBe('0xaa');
    expect(after.ranked[0].key).toBe('0xbb');
  });

  it('…and a miner entering or leaving the window does move the signature', () => {
    // The other half: the SET is what the geometry follows — one node per key,
    // one displaced ghost each — so a changed set has to re-key.
    const two = view(chainWith([
      producer({ key: '0xaa', blocks: 5 }), producer({ key: '0xbb', blocks: 4 }),
    ]));
    const three = view(chainWith([
      producer({ key: '0xaa', blocks: 5 }), producer({ key: '0xbb', blocks: 4 }),
      producer({ key: '0xcc', blocks: 1 }),
    ]));
    expect(stagingSig(three)).not.toBe(stagingSig(two));
    // A newcomer lands at its own place in the key order rather than at the
    // tail, so the staging array stays a function of the set alone.
    const middle = view(chainWith([
      producer({ key: '0xaa', blocks: 5 }), producer({ key: '0xbb', blocks: 4 }),
      producer({ key: '0xab', blocks: 1 }),
    ]));
    expect(middle.staging.map((p) => p.key)).toEqual(['0xaa', '0xab', '0xbb']);
  });

  it('stands every producer in the window, whether or not its fan is drawable', () => {
    const chain = chainWith([
      producer({ key: '0xrare', blocks: 6, message: RARE_BUILD }),
      producer({ key: '0xstock', blocks: 3, message: STOCK_BUILD }),
      producer({ key: '0xquiet', blocks: 1, message: '' }),
    ]);
    const v = view(chain, splitRoster(3, 40));
    expect(v.staging).toHaveLength(3);
    expect(fanReason(standingFor(v, '0xrare'))).toBe('drawn');
    expect(fanReason(standingFor(v, '0xstock'))).toBe('modal');
    expect(fanReason(standingFor(v, '0xquiet'))).toBe('no_declaration');
  });

  it('carries every share with the window it was measured over', () => {
    const v = view(chainWith([
      producer({ key: '0xaa', blocks: 6 }),
      producer({ key: '0xbb', blocks: 2 }),
    ]));
    expect(v.windowBlocks).toBe(8);
    for (const standing of v.staging) {
      expect(standing.windowBlocks).toBe(8);
      expect(standing.share).toBeCloseTo(standing.blocks / 8, 12);
    }
    // The shares of one window are the window.
    const total = v.staging.reduce((sum, p) => sum + p.share, 0);
    expect(total).toBeCloseTo(1, 12);
  });

  it('passes the declared message through verbatim', () => {
    const declared = `${RARE_BUILD} bpool`;
    const v = view(chainWith([producer({ key: '0xaa', message: declared })]));
    expect(standingFor(v, '0xaa').message).toBe(declared);
  });
});

describe('blockProducers window identity', () => {
  /** §9.6 in machine-checkable form: `sum(producers[].blocks) ===
   *  producer_window_blocks`. Both reducers assert it after every push; the
   *  derive refuses to draw a window that lost it, because the numerators
   *  would be drawn as parts of a whole they are not parts of. */
  it('refuses a window whose numerators do not add up to its denominator', () => {
    const chain = chainWith([producer({ key: '0xaa', blocks: 3 })]);
    expect(deriveBlockProducers(chain, null)).not.toBeNull();
    expect(deriveBlockProducers(
      { ...chain, producer_window_blocks: 4 }, null,
    )).toBeNull();
    expect(deriveBlockProducers(
      { ...chain, producer_window_blocks: 2 }, null,
    )).toBeNull();
  });

  it('refuses a row with no key, a repeated key, or no blocks behind it', () => {
    expect(deriveBlockProducers(chainWith([producer({ key: '' })]), null)).toBeNull();
    expect(deriveBlockProducers(chainWith([
      producer({ key: '0xaa', blocks: 1 }), producer({ key: '0xaa', blocks: 2 }),
    ]), null)).toBeNull();
    expect(deriveBlockProducers(chainWith([
      producer({ key: '0xaa', blocks: 0 }),
    ]), null)).toBeNull();
  });

  it('accepts an empty window as an empty view rather than as a refusal', () => {
    const v = view(chainWith([]));
    expect(v.staging).toEqual([]);
    expect(v.ranked).toEqual([]);
    expect(v.windowBlocks).toBe(0);
    expect(v.candidacyByPeer.size).toBe(0);
  });

  it('accepts the window the real chain reducer builds, and only that window', () => {
    const minedBy = (number: number, key: string, message: string): Mutation => ({
      type: 'block_mined',
      number,
      hash: `0xb${number}`,
      tx_count: 0,
      at: number * 1000,
      producer_key: key,
      producer_message: message,
    });
    let chain = emptyChainCache();
    const keys = ['0xaa', '0xbb', '0xaa', '0xcc', '0xaa', '0xaa'];
    keys.forEach((key, i) => {
      chain = applyChainMutation(chain, minedBy(i + 1, key, RARE_BUILD));
    });
    const v = view(chain, null);
    expect(v.windowBlocks).toBe(keys.length);
    expect(v.staging.map((p) => [p.key, p.blocks])).toEqual([
      ['0xaa', 4], ['0xbb', 1], ['0xcc', 1],
    ]);
    expect(v.ranked.map((p) => [p.key, p.blocks])).toEqual([
      ['0xaa', 4], ['0xbb', 1], ['0xcc', 1],
    ]);
    // And a block the adapter could not attribute moves neither half of the
    // fraction, which is what keeps the identity exact.
    const unattributed: Mutation = {
      type: 'block_mined', number: 7, hash: '0xb7', tx_count: 0, at: 7000,
    };
    expect(view(applyChainMutation(chain, unattributed), null).windowBlocks)
      .toBe(keys.length);
  });
});

describe('producerCandidates join', () => {
  it('matches a roster version found inside the declared message', () => {
    const joined = producerCandidates(
      [producer({ key: '0xrare', message: `${RARE_BUILD} bpool` })],
      splitRoster(3, 5),
    );
    expect(joined.get('0xrare')?.map((n) => n.node_id))
      .toEqual(['Qmr0000', 'Qmr0001', 'Qmr0002']);
  });

  it('gives every keyed producer an entry, empty when nothing matched', () => {
    const joined = producerCandidates([
      producer({ key: '0xrare', message: RARE_BUILD }),
      producer({ key: '0xalien', message: 'something-else-entirely' }),
    ], splitRoster(2, 2));
    expect(joined.has('0xalien')).toBe(true);
    expect(joined.get('0xalien')).toEqual([]);
  });

  it('takes the LONGEST match, so a prefix version cannot win', () => {
    const long = '0.209.0 (aaaaaaa 2026-07-30)';
    const short = '0.209.0';
    const r = roster([
      rosterNode({ node_id: 'Qmlong0', version: long }),
      rosterNode({ node_id: 'Qmlong1', version: long }),
      rosterNode({ node_id: 'Qmshort0', version: short }),
      rosterNode({ node_id: 'Qmshort1', version: short }),
    ]);
    // Both strings are inside the message; only the specific one may win.
    const joined = producerCandidates([producer({ key: '0xaa', message: long })], r);
    expect(joined.get('0xaa')?.map((n) => n.node_id)).toEqual(['Qmlong0', 'Qmlong1']);
    // …and the short one still wins where it is the only one present.
    const onlyShort = producerCandidates([producer({ key: '0xaa', message: short })], r);
    expect(onlyShort.get('0xaa')?.map((n) => n.node_id)).toEqual(['Qmshort0', 'Qmshort1']);
  });

  it('never lets a degenerate version string join itself to everything', () => {
    // `''.includes` is vacuously true, and a one-character version is inside
    // most messages ever written. Neither is a fingerprint.
    const junk = roster([
      rosterNode({ node_id: 'Qmjunk0', version: '' }),
      rosterNode({ node_id: 'Qmjunk1', version: '0' }),
      rosterNode({ node_id: 'Qmjunk2', version: ' '.repeat(PRODUCER_VERSION_MIN_CHARS + 2) }),
    ]);
    const joined = producerCandidates(
      [producer({ key: '0xaa', message: `${RARE_BUILD} 0` })], junk,
    );
    expect(joined.get('0xaa')).toEqual([]);
    // They are not in the modal gate's denominator either — counting a junk
    // row there would let a fleet of them dilute a real build under the gate.
    expect(view(chainWith([producer({ key: '0xaa' })]), junk).versionedRosterSize).toBe(0);
  });

  it('skips a row the crawler never reached, and a repeat of one it did', () => {
    const r = roster([
      rosterNode({ node_id: 'Qmr0', version: RARE_BUILD }),
      rosterNode({ node_id: 'Qmr0', version: RARE_BUILD }),
      rosterNode({ node_id: 'Qmnever', state: 'advertised_unverified', version: undefined }),
    ]);
    const v = view(chainWith([producer({ key: '0xaa', message: RARE_BUILD })]), r);
    expect(v.versionedRosterSize).toBe(1);
    expect(producerCandidates([producer({ key: '0xaa' })], r)).toEqual(
      new Map([['0xaa', [r.entries[0]]]]),
    );
  });

  it('orders candidates by node_id however the crawler ordered its rows', () => {
    const shuffled = roster([
      rosterNode({ node_id: 'QmC', version: RARE_BUILD }),
      rosterNode({ node_id: 'QmA', version: RARE_BUILD }),
      rosterNode({ node_id: 'QmB', version: RARE_BUILD }),
      ...cohort('s', 40, STOCK_BUILD),
    ]);
    const joined = producerCandidates([producer({ key: '0xaa' })], shuffled);
    expect(joined.get('0xaa')?.map((n) => n.node_id)).toEqual(['QmA', 'QmB', 'QmC']);
  });
});

describe('blockProducers informativeness gates', () => {
  const rare = (blocks = 5): BlockProducer => (
    producer({ key: '0xrare', blocks, message: RARE_BUILD })
  );

  it('draws a fan that narrows without naming', () => {
    const v = view(chainWith([rare()]), splitRoster(3, 40));
    const standing = standingFor(v, '0xrare');
    expect(standing.fan.drawn).toBe(true);
    if (!standing.fan.drawn) return;
    expect(standing.fan.matchedVersion).toBe(RARE_BUILD);
    expect(standing.fan.candidates).toHaveLength(3);
    expect(standing.fan.shareOfVersioned).toBeCloseTo(3 / 43, 12);
  });

  it('withholds a singular join — one candidate is a name, not a narrowing', () => {
    const v = view(chainWith([rare()]), splitRoster(1, 40));
    const standing = standingFor(v, '0xrare');
    expect(fanReason(standing)).toBe('singular');
    if (standing.fan.drawn) return;
    expect(standing.fan.matched).toBe(1);
    // ⭐ The identity of that one peer is not in the value at all, so a
    // consumer that disagreed with the gate could not draw it anyway.
    expect(JSON.stringify(standing.fan)).not.toContain('Qmr0000');
  });

  it('withholds the modal build — the release everybody runs teaches nothing', () => {
    const stock = producer({ key: '0xstock', blocks: 5, message: STOCK_BUILD });
    const v = view(chainWith([stock]), splitRoster(3, 40));
    const standing = standingFor(v, '0xstock');
    expect(fanReason(standing)).toBe('modal');
    if (standing.fan.drawn) return;
    expect(standing.fan.matched).toBe(40);
    expect(standing.fan.shareOfVersioned)
      .toBeGreaterThanOrEqual(PRODUCER_FAN_MAX_SHARE_OF_VERSIONED);
    expect(JSON.stringify(standing.fan)).not.toContain('Qms0000');
  });

  it('withholds a crowd — many lines leaving one node is a haze, not evidence', () => {
    // Sized so the modal gate cannot be what fires: the build is a small
    // fraction of a large versioned roster, and only the ceiling refuses it.
    const wide = PRODUCER_FAN_MAX_CANDIDATES + 1;
    const rest = Math.ceil(wide / PRODUCER_FAN_MAX_SHARE_OF_VERSIONED);
    const v = view(chainWith([rare()]), splitRoster(wide, rest));
    const standing = standingFor(v, '0xrare');
    expect(fanReason(standing)).toBe('crowd');
    if (standing.fan.drawn) return;
    expect(standing.fan.shareOfVersioned)
      .toBeLessThan(PRODUCER_FAN_MAX_SHARE_OF_VERSIONED);
    expect(standing.fan.matched).toBe(wide);
  });

  it('draws the widest fan the ceiling allows, and refuses one peer more', () => {
    const rest = Math.ceil(
      (PRODUCER_FAN_MAX_CANDIDATES + 1) / PRODUCER_FAN_MAX_SHARE_OF_VERSIONED,
    );
    const atCeiling = view(chainWith([rare()]), splitRoster(PRODUCER_FAN_MAX_CANDIDATES, rest));
    expect(fanReason(standingFor(atCeiling, '0xrare'))).toBe('drawn');
    const over = view(chainWith([rare()]), splitRoster(PRODUCER_FAN_MAX_CANDIDATES + 1, rest));
    expect(fanReason(standingFor(over, '0xrare'))).toBe('crowd');
  });

  it('draws the narrowest fan the floor allows, and refuses one peer fewer', () => {
    const rest = Math.ceil(
      PRODUCER_FAN_MIN_CANDIDATES / PRODUCER_FAN_MAX_SHARE_OF_VERSIONED,
    );
    const atFloor = view(chainWith([rare()]), splitRoster(PRODUCER_FAN_MIN_CANDIDATES, rest));
    expect(fanReason(standingFor(atFloor, '0xrare'))).toBe('drawn');
    const under = view(chainWith([rare()]), splitRoster(PRODUCER_FAN_MIN_CANDIDATES - 1, rest));
    expect(fanReason(standingFor(under, '0xrare'))).not.toBe('drawn');
  });

  it('reports the modal build as modal even though it is also a crowd', () => {
    // Both gates hold on the live shape. "This is the build everybody runs" is
    // the reason; "too many lines to draw" is a consequence of it, and the
    // card has to print the reason.
    const stock = producer({ key: '0xstock', blocks: 5, message: STOCK_BUILD });
    const v = view(chainWith([stock]), splitRoster(1, PRODUCER_FAN_MAX_CANDIDATES + 4));
    expect(fanReason(standingFor(v, '0xstock'))).toBe('modal');
  });
});

describe('blockProducers withheld reasons', () => {
  const rows = [
    producer({ key: '0xrare', blocks: 5, message: RARE_BUILD }),
    producer({ key: '0xquiet', blocks: 1, message: '' }),
  ];

  it('says NO ROSTER, not NO MATCH, when there is no roster to ask', () => {
    for (const absent of [null, undefined, roster([])]) {
      const v = view(chainWith(rows), absent);
      // Every producer still stages — existence is a fact about the chain, and
      // the crawler has no vote in it.
      expect(v.staging).toHaveLength(2);
      expect(v.versionedRosterSize).toBe(0);
      expect(v.candidacyByPeer.size).toBe(0);
      expect(fanReason(standingFor(v, '0xrare'))).toBe('roster_absent');
    }
  });

  it('separates a roster holding no builds from a roster that disagrees', () => {
    const blind = roster(cohort('n', 5, undefined));
    expect(fanReason(standingFor(view(chainWith(rows), blind), '0xrare')))
      .toBe('roster_unversioned');
    // A roster that DOES hold builds and none of them is this one is a
    // different sentence: both sides answered and the answers did not meet.
    const other = roster(cohort('s', 5, STOCK_BUILD));
    expect(fanReason(standingFor(view(chainWith(rows), other), '0xrare')))
      .toBe('no_match');
  });

  it('separates a miner that said nothing from a build nobody runs', () => {
    const v = view(chainWith(rows), roster(cohort('s', 5, STOCK_BUILD)));
    expect(fanReason(standingFor(v, '0xquiet'))).toBe('no_declaration');
    expect(fanReason(standingFor(v, '0xrare'))).toBe('no_match');
  });

  it('keeps the producer silent on its own even when the crawler is silent too', () => {
    // The miner's silence is a fact about this producer that no crawl could
    // change; a roster reason is the same sentence for every producer at once.
    const v = view(chainWith(rows), null);
    expect(fanReason(standingFor(v, '0xquiet'))).toBe('no_declaration');
  });
});

describe('blockProducers candidacy stamps', () => {
  it('stamps only peers of a drawn fan, and always with the set size', () => {
    const v = view(chainWith([
      producer({ key: '0xrare', blocks: 5, message: RARE_BUILD }),
      producer({ key: '0xstock', blocks: 3, message: STOCK_BUILD }),
    ]), splitRoster(3, 40));
    expect([...v.candidacyByPeer.keys()]).toEqual(['Qmr0000', 'Qmr0001', 'Qmr0002']);
    for (const stamp of v.candidacyByPeer.values()) {
      expect(stamp.role).toBe('candidate');
      expect(stamp.oneOf).toBe(3);
      expect(stamp.oneOf).toBeGreaterThanOrEqual(PRODUCER_FAN_MIN_CANDIDATES);
      expect(stamp.version).toBe(RARE_BUILD);
    }
    // ⚠️ §9.2: nothing on a named node ever says it IS a producer. The stamp's
    // role is the literal `'candidate'` and there is no second value for it.
    const stamped = JSON.stringify([...v.candidacyByPeer.values()]);
    expect(stamped).not.toContain('"producer"');
  });

  it('names both producers when two payout identities declare one build', () => {
    const v = view(chainWith([
      producer({ key: '0xaa', blocks: 5, message: RARE_BUILD }),
      producer({ key: '0xbb', blocks: 4, message: `${RARE_BUILD} bpool` }),
    ]), splitRoster(3, 40));
    const stamp = v.candidacyByPeer.get('Qmr0000');
    expect(stamp?.producerKeys).toEqual(['0xaa', '0xbb']);
    // A peer reports one build, so every producer that lists it lists the same
    // peers alongside it — the set size cannot depend on which producer asked.
    expect(stamp?.oneOf).toBe(3);
  });

  it('never stamps the one peer of a singular join', () => {
    const v = view(
      chainWith([producer({ key: '0xrare', blocks: 5, message: RARE_BUILD })]),
      splitRoster(1, 40),
    );
    expect(v.candidacyByPeer.size).toBe(0);
  });
});

describe('blockProducers determinism', () => {
  it('is a pure function of its two inputs', () => {
    const chain = chainWith([
      producer({ key: '0xaa', blocks: 5, message: RARE_BUILD }),
      producer({ key: '0xbb', blocks: 5, message: STOCK_BUILD }),
    ]);
    const r = splitRoster(4, 40);
    expect(JSON.stringify(deriveBlockProducers(chain, r)))
      .toEqual(JSON.stringify(deriveBlockProducers(chain, r)));
  });

  it('does not mutate the chain entity or the roster record it was handed', () => {
    const chain = chainWith([
      producer({ key: '0xbb', blocks: 1, message: RARE_BUILD }),
      producer({ key: '0xaa', blocks: 9, message: RARE_BUILD }),
    ]);
    const r = splitRoster(3, 40);
    const chainBefore = JSON.stringify(chain);
    const rosterBefore = JSON.stringify(r);
    deriveBlockProducers(chain, r);
    producerCandidates(chain.producers, r);
    expect(JSON.stringify(chain)).toBe(chainBefore);
    expect(JSON.stringify(r)).toBe(rosterBefore);
  });
});
