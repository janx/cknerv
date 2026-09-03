import { describe, expect, it } from 'vitest';
import { applyChainMutation, emptyChainCache } from '@cknerv/cache';
import type {
  BlockProducer, ChainEntry, Mutation, NetworkRosterRecord, ProducerLedger,
  ProducerLedgerRow, RosterNode,
} from '@cknerv/types';
import {
  deriveBlockProducers,
  producerCandidates,
  producerKeysSignature,
  producerLedgerIsCoherent,
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

function view(
  chain: ChainEntry,
  r?: NetworkRosterRecord | null,
  ledger?: ProducerLedger | null,
): BlockProducerView {
  const derived = deriveBlockProducers(chain, r, ledger);
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
    // it, and PEER·02's `TOP` would name the wrong miner.
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

/* ─────────────────────────── the indexer's week ─────────────────────────── */

/** A key in the shape the chain reports one, so the join below is made on the
 *  identity both sides actually carry: a 32-byte lock script hash. */
const LEDGER_KEY_A = `0x${'a'.repeat(64)}`;
const LEDGER_KEY_B = `0x${'b'.repeat(64)}`;

/** A ledger with its window stated. Every figure is constructed — the live
 *  chart moves with the pools and the week rolls at midnight UTC+8 — except
 *  the balance, which is the one value worth carrying verbatim: 9.82e15
 *  shannons was READ off the live top miner on 2026-09-02 and is above
 *  `Number.MAX_SAFE_INTEGER`, which is why it is a string all the way down. */
function ledgerWith(
  rows: ProducerLedgerRow[], over: Partial<ProducerLedger> = {},
): ProducerLedger {
  return {
    window_days: 7,
    from_date: '2026-08-26',
    to_date: '2026-09-01',
    total_blocks: 1_000,
    fetched_at_ms: 1_700_000_500_000,
    indexed_tip: 20_337_488,
    rows,
    ...over,
  };
}

/** A fully resolved row: the window figures AND the per-address lookup that
 *  can fail on its own. */
function ledgerRow(
  key: string, blocks: number, over: Partial<ProducerLedgerRow> = {},
): ProducerLedgerRow {
  return {
    key,
    blocks,
    address: `ckb1${key.slice(2, 12)}`,
    balance_shannons: '9820183392640200',
    live_cells: 155_450,
    tx_count: 4_094_449,
    ...over,
  };
}

/** The other kind of row: the address lookup did not answer, so everything
 *  below the window figures is ABSENT — the keys are missing from the wire,
 *  not null and not zero. */
function bareLedgerRow(key: string, blocks: number): ProducerLedgerRow {
  return { key, blocks };
}

describe('blockProducers ledger join', () => {
  const rows = [
    producer({ key: LEDGER_KEY_A, blocks: 6 }),
    producer({ key: '0xwindow-only', blocks: 2 }),
  ];

  it('hangs the week on the producer the week and the window both name', () => {
    const v = view(
      chainWith(rows), null,
      ledgerWith([ledgerRow(LEDGER_KEY_A, 250), bareLedgerRow(LEDGER_KEY_B, 10)]),
    );
    const both = standingFor(v, LEDGER_KEY_A);
    // The two windows on one standing, each beside the denominator it was
    // counted over: a quarter of the week, three quarters of the last eight
    // blocks, and nothing anywhere divides one by the other.
    expect(both.blocks).toBe(6);
    expect(both.windowBlocks).toBe(8);
    expect(both.share).toBeCloseTo(6 / 8, 12);
    expect(both.ledger?.blocks).toBe(250);
    expect(both.ledger?.share).toBeCloseTo(250 / 1_000, 12);
    expect(v.ledgerWindow).toEqual({
      days: 7,
      fromDate: '2026-08-26',
      toDate: '2026-09-01',
      totalBlocks: 1_000,
      fetchedAtMs: 1_700_000_500_000,
      indexedTip: 20_337_488,
    });
  });

  it('keeps ledger null for a producer the window knows and the week does not', () => {
    const v = view(chainWith(rows), null, ledgerWith([ledgerRow(LEDGER_KEY_A, 250)]));
    // Brand new, or too small to make the row cap. Either way the week has no
    // reading of it, and a zero would be a reading.
    expect(standingFor(v, '0xwindow-only').ledger).toBeNull();
    expect(standingFor(v, LEDGER_KEY_A).ledger).not.toBeNull();
  });

  it('stands a producer the week names and the window has lost', () => {
    // ⭐ THE FAILURE THE WHOLE LEG EXISTS FOR. A cohort used to vanish the
    // moment its producer's last block left the 240-block ring — and for the
    // first minute of every boot, and after every reorg, since the ring is
    // cleared and refilled a block at a time. The week can still see it.
    const v = view(
      chainWith(rows), null,
      ledgerWith([ledgerRow(LEDGER_KEY_A, 250), ledgerRow(LEDGER_KEY_B, 120)]),
    );
    expect(v.staging.map((p) => p.key)).toContain(LEDGER_KEY_B);
    const only = standingFor(v, LEDGER_KEY_B);
    expect(only.blocks).toBe(0);
    // Zero OF THE LIVE WINDOW, so the standing still states which window it
    // holds none of, and `0/0` never happens.
    expect(only.windowBlocks).toBe(8);
    expect(only.share).toBe(0);
    expect(only.ledger?.blocks).toBe(120);
    expect(only.ledger?.share).toBeCloseTo(120 / 1_000, 12);
    // As of the LEDGER, not a block: the week says this identity was
    // producing and says nothing about when it last did.
    expect(only.lastSeenMs).toBe(1_700_000_500_000);
    expect(only.message).toBe('');
    // It declared nothing because none of its blocks is in the window to have
    // carried a declaration — the same sentence a silent miner gets.
    expect(fanReason(only)).toBe('no_declaration');
  });

  it('stands the week even when the window is empty, which is the boot case', () => {
    const v = view(
      chainWith([]), null,
      ledgerWith([ledgerRow(LEDGER_KEY_A, 250), ledgerRow(LEDGER_KEY_B, 120)]),
    );
    expect(v.staging.map((p) => p.key)).toEqual([LEDGER_KEY_A, LEDGER_KEY_B]);
    expect(v.windowBlocks).toBe(0);
    for (const standing of v.staging) {
      expect(standing.blocks).toBe(0);
      // `0 / 0` is NaN and a NaN share reaches a Float32 lane and a printed
      // percentage without anything throwing. It is written, not divided.
      expect(standing.share).toBe(0);
      expect(Number.isNaN(standing.share)).toBe(false);
    }
  });

  it('carries an absent lookup as absent, and never as zero', () => {
    const v = view(
      chainWith(rows), null, ledgerWith([bareLedgerRow(LEDGER_KEY_A, 250)]),
    );
    const week = standingFor(v, LEDGER_KEY_A).ledger;
    // The window figures survived the failed address lookup; everything the
    // lookup would have filled is null. A card printing `0 CKB` over any of
    // these would state something the source did not.
    expect(week?.blocks).toBe(250);
    expect(week?.address).toBeNull();
    expect(week?.balanceShannons).toBeNull();
    expect(week?.liveCells).toBeNull();
    expect(week?.txCount).toBeNull();
    expect(week?.lastRewardShannons).toBeNull();
    expect(week?.lastRewardBlock).toBeNull();
  });

  it('passes the balance through as the string it arrived as', () => {
    const v = view(
      chainWith(rows), null,
      ledgerWith([ledgerRow(LEDGER_KEY_A, 250, {
        last_reward_shannons: '71011833086', last_reward_block: 20_337_476,
      })]),
    );
    const week = standingFor(v, LEDGER_KEY_A).ledger;
    // ⚠️ 9,820,183,392,640,200 > 9,007,199,254,740,991. Anything that touched
    // this with `Number()` on the way through would hand the formatter a
    // figure that looks right and is not.
    expect(week?.balanceShannons).toBe('9820183392640200');
    expect(BigInt(week?.balanceShannons ?? '0')).toBeGreaterThan(
      BigInt(Number.MAX_SAFE_INTEGER),
    );
    expect(week?.lastRewardShannons).toBe('71011833086');
    expect(week?.lastRewardBlock).toBe(20_337_476);
  });

  it('stages the union in key order, whichever window a key came from', () => {
    // The staging order is a function of WHICH producers exist and of nothing
    // else — a ledger-only key lands at its own place, not at the tail, so the
    // colony's cache key does not depend on which window found a producer.
    const v = view(
      chainWith([producer({ key: '0xbb', blocks: 1 })]), null,
      ledgerWith([ledgerRow('0xcc', 5), ledgerRow('0xaa', 9)]),
    );
    expect(v.staging.map((p) => p.key)).toEqual(['0xaa', '0xbb', '0xcc']);
  });

  it('reads back by the week when there is a week, and by the ring when not', () => {
    const chain = chainWith([
      producer({ key: '0xaa', blocks: 9 }), producer({ key: '0xbb', blocks: 1 }),
    ]);
    const week = ledgerWith([ledgerRow('0xbb', 400), ledgerRow('0xaa', 100)]);
    // With a week, `TOP` is the top of the WEEK: the producer holding most of
    // the last 240 blocks is not the producer that took the week.
    expect(view(chain, null, week).ranked.map((p) => p.key)).toEqual(['0xbb', '0xaa']);
    // Without one, it is the ring, exactly as it has always been.
    expect(view(chain, null).ranked.map((p) => p.key)).toEqual(['0xaa', '0xbb']);
    // …and a producer the week does not name reads as zero of it, however
    // much of the ring it holds. Its recency is still on `blocks`.
    const partial = view(chain, null, ledgerWith([ledgerRow('0xbb', 400)]));
    expect(partial.ranked.map((p) => p.key)).toEqual(['0xbb', '0xaa']);
    expect(partial.ranked[1].blocks).toBe(9);
    // Ties fall through to the key, so the reading order is total either way.
    const tied = view(chain, null, ledgerWith([ledgerRow('0xbb', 7), ledgerRow('0xaa', 7)]));
    expect(tied.ranked.map((p) => p.key)).toEqual(['0xaa', '0xbb']);
  });

  it('is the same standings twice, over the union as over the window', () => {
    const v = view(
      chainWith(rows), null,
      ledgerWith([ledgerRow(LEDGER_KEY_A, 250), ledgerRow(LEDGER_KEY_B, 120)]),
    );
    expect(v.ranked).toHaveLength(v.staging.length);
    for (const standing of v.ranked) expect(v.staging).toContain(standing);
  });

  it('never lets a ledger-only standing into a candidate stamp', () => {
    // §9.2 through the new door: a standing that declared nothing has a
    // withheld fan, so it can put no peer in `candidacyByPeer` — the fan gate
    // is decided for both halves of the union by one call.
    const v = view(
      chainWith([producer({ key: '0xrare', blocks: 5, message: RARE_BUILD })]),
      splitRoster(3, 40),
      ledgerWith([ledgerRow(LEDGER_KEY_B, 120)]),
    );
    expect([...v.candidacyByPeer.keys()]).toEqual(['Qmr0000', 'Qmr0001', 'Qmr0002']);
    for (const stamp of v.candidacyByPeer.values()) {
      expect(stamp.producerKeys).toEqual(['0xrare']);
    }
  });
});

describe('blockProducers ledger coherence', () => {
  const chain = chainWith([producer({ key: '0xaa', blocks: 4 })]);
  /** What the view looks like with no week at all — the fallback every refusal
   *  below has to land back on, byte for byte. */
  const withoutLedger = JSON.stringify(deriveBlockProducers(chain, null));

  /** A record the derive must refuse, and the whole view it must refuse it
   *  into: the one before ledgers existed. */
  function refuses(name: string, ledger: ProducerLedger): void {
    expect(producerLedgerIsCoherent(ledger), name).toBe(false);
    const v = view(chain, null, ledger);
    expect(v.ledgerWindow, name).toBeNull();
    expect(standingFor(v, '0xaa').ledger, name).toBeNull();
    expect(JSON.stringify(deriveBlockProducers(chain, null, ledger)), name)
      .toBe(withoutLedger);
  }

  it('accepts the shape the adapter actually ships', () => {
    const week = ledgerWith([ledgerRow('0xaa', 600), bareLedgerRow('0xbb', 2)]);
    expect(producerLedgerIsCoherent(week)).toBe(true);
    // `<=`, not `==`: the row cap cuts the tail off a long week on purpose, so
    // the rows are a PREFIX of the total and never meant to add up to it.
    expect(week.rows.reduce((sum, row) => sum + row.blocks, 0))
      .toBeLessThan(week.total_blocks);
  });

  it('refuses a week nobody produced in, because every share divides by it', () => {
    // `total_blocks: 0` alone makes every share Infinity or NaN, and a NaN
    // share reaches a Float32 lane and a printed percentage without throwing.
    refuses('zero total', ledgerWith([ledgerRow('0xaa', 5)], { total_blocks: 0 }));
    refuses('negative total', ledgerWith([ledgerRow('0xaa', 5)], { total_blocks: -1 }));
    refuses(
      'fractional total',
      ledgerWith([ledgerRow('0xaa', 5)], { total_blocks: 1.5 }),
    );
  });

  it('refuses rows that do not fit the week they claim to be part of', () => {
    refuses('sum over total', ledgerWith(
      [ledgerRow('0xaa', 600), ledgerRow('0xbb', 500)], { total_blocks: 1_000 },
    ));
  });

  it('refuses a row that took no blocks, or a fraction of one', () => {
    refuses('zero blocks', ledgerWith([ledgerRow('0xaa', 0)]));
    refuses('negative blocks', ledgerWith([ledgerRow('0xaa', -3)]));
    refuses('fractional blocks', ledgerWith([ledgerRow('0xaa', 2.5)]));
  });

  it('refuses a blank key, and a key that appears twice', () => {
    // The same two refusals the 240-block window makes, and for the same
    // reason: a keyless row is blocks with nobody behind them, and a repeat
    // would be one producer counted twice against one denominator.
    refuses('blank key', ledgerWith([ledgerRow('', 5)]));
    refuses('duplicate key', ledgerWith([ledgerRow('0xaa', 5), ledgerRow('0xaa', 6)]));
  });

  it('refuses a shannon figure BigInt could not read', () => {
    // ⚠️ `BigInt('12 CKB')` throws, and it would throw inside a render. The
    // check is here so the conversion is total at every call site downstream.
    refuses('lettered balance', ledgerWith([
      ledgerRow('0xaa', 5, { balance_shannons: '98 CKB' }),
    ]));
    refuses('signed balance', ledgerWith([
      ledgerRow('0xaa', 5, { balance_shannons: '-1' }),
    ]));
    // An empty string is refused for the same reason a blank key is:
    // `BigInt('')` is `0n`, so a balance nobody read would become a zero.
    refuses('empty balance', ledgerWith([
      ledgerRow('0xaa', 5, { balance_shannons: '' }),
    ]));
    refuses('lettered reward', ledgerWith([
      ledgerRow('0xaa', 5, { last_reward_shannons: '0x1f' }),
    ]));
    // …and an absent one is not a refusal: it is the row whose address lookup
    // failed, which is the shape the adapter ships on purpose.
    expect(producerLedgerIsCoherent(ledgerWith([bareLedgerRow('0xaa', 5)]))).toBe(true);
  });

  it('treats no ledger, a null ledger and rows that are not an array alike', () => {
    expect(producerLedgerIsCoherent(null)).toBe(false);
    expect(producerLedgerIsCoherent(undefined)).toBe(false);
    refuses('rows not an array', ledgerWith(
      undefined as unknown as ProducerLedgerRow[],
    ));
  });

  it('does not parse the key, only counts by it', () => {
    // The adapter refuses a key that is not `0x`-prefixed; this side
    // deliberately does not, because nothing here parses a key. A client that
    // started validating the shape would be the one place a devnet spelling
    // could empty the colony.
    expect(producerLedgerIsCoherent(ledgerWith([ledgerRow('devnet-producer', 5)])))
      .toBe(true);
  });
});

describe('blockProducers ledger fallback', () => {
  const chain = chainWith([
    producer({ key: '0xaa', blocks: 5, message: RARE_BUILD }),
    producer({ key: '0xbb', blocks: 3, message: STOCK_BUILD }),
  ]);

  it('is byte-identical with no ledger, however the absence is spelled', () => {
    // The fallback is a test, not a hope: absent, null and undefined are one
    // view, and it is the view this file produced before ledgers existed.
    const r = splitRoster(3, 40);
    const bare = JSON.stringify(deriveBlockProducers(chain, r));
    expect(JSON.stringify(deriveBlockProducers(chain, r, null))).toBe(bare);
    expect(JSON.stringify(deriveBlockProducers(chain, r, undefined))).toBe(bare);
    // And every standing says so in the type rather than by omission.
    for (const standing of view(chain, r).staging) expect(standing.ledger).toBeNull();
    expect(view(chain, r).ledgerWindow).toBeNull();
  });

  it('refuses an incoherent WINDOW whether or not a week arrived', () => {
    // The window's identity is not weakened by having a second window beside
    // it: shares that are not parts of the whole they are drawn against stay
    // undrawable, and a valid week cannot rescue them.
    const broken = { ...chain, producer_window_blocks: 9 };
    const week = ledgerWith([ledgerRow('0xaa', 600)]);
    expect(deriveBlockProducers(broken, null)).toBeNull();
    expect(deriveBlockProducers(broken, null, week)).toBeNull();
  });

  it('is a pure function of its three inputs and mutates none of them', () => {
    const r = splitRoster(4, 40);
    const week = ledgerWith([ledgerRow('0xaa', 600), ledgerRow(LEDGER_KEY_B, 120)]);
    expect(JSON.stringify(deriveBlockProducers(chain, r, week)))
      .toEqual(JSON.stringify(deriveBlockProducers(chain, r, week)));
    const chainBefore = JSON.stringify(chain);
    const rosterBefore = JSON.stringify(r);
    const weekBefore = JSON.stringify(week);
    deriveBlockProducers(chain, r, week);
    expect(JSON.stringify(chain)).toBe(chainBefore);
    expect(JSON.stringify(r)).toBe(rosterBefore);
    expect(JSON.stringify(week)).toBe(weekBefore);
  });
});

describe('producerKeysSignature', () => {
  const chain = chainWith([
    producer({ key: '0xbb', blocks: 5 }), producer({ key: '0xaa', blocks: 3 }),
  ]);

  it('is the staged key set, in staging order, NUL-joined', () => {
    const v = view(chain, null);
    expect(producerKeysSignature(v)).toBe(['0xaa', '0xbb'].join('\u0000'));
    // Byte-identical to what App spelled inline before this function existed,
    // which is what makes the move a refactor rather than a re-key.
    expect(producerKeysSignature(v)).toBe(v.staging.map((p) => p.key).join('\u0000'));
  });

  it('⭐ ignores everything a block moves, which is the property App keys on', () => {
    // Stronger than the field-by-field text check `App.sceneRoots.test.tsx`
    // used to run over the inline expression: these two views differ in every
    // tally, every share, every message, every fan, every ledger figure and in
    // their whole `ranked` order — and the colony may not rebuild for any of
    // it, because none of it moves a node.
    const before = view(
      chainWith([
        producer({ key: '0xaa', blocks: 5, message: RARE_BUILD }),
        producer({ key: '0xbb', blocks: 4, message: '' }),
      ]),
      splitRoster(3, 40),
      ledgerWith([ledgerRow('0xaa', 600), ledgerRow('0xbb', 100)]),
    );
    const after = view(
      chainWith([
        producer({ key: '0xaa', blocks: 1, message: '' }),
        producer({ key: '0xbb', blocks: 90, message: RARE_BUILD }),
      ]),
      splitRoster(1, 40),
      ledgerWith([ledgerRow('0xbb', 900), bareLedgerRow('0xaa', 2)]),
    );
    expect(after.ranked.map((p) => p.key)).not.toEqual(before.ranked.map((p) => p.key));
    expect(producerKeysSignature(after)).toBe(producerKeysSignature(before));
  });

  it('⭐ carries a ledger-only cohort into the set the topology stages', () => {
    // The union reaching the attested tier is the whole point of the wiring:
    // `inferredTopology` stages one node per staged key, and this signature is
    // the memo key that decides when it runs.
    const withoutWeek = producerKeysSignature(view(chain, null));
    const withWeek = producerKeysSignature(
      view(chain, null, ledgerWith([ledgerRow('0xcc', 400)])),
    );
    expect(withoutWeek).toBe(['0xaa', '0xbb'].join('\u0000'));
    expect(withWeek).toBe(['0xaa', '0xbb', '0xcc'].join('\u0000'));
    expect(withWeek).not.toBe(withoutWeek);
    // A week that names only producers the ring already holds adds no key, so
    // the ledger's arrival does not rebuild the colony by itself.
    expect(producerKeysSignature(
      view(chain, null, ledgerWith([ledgerRow('0xaa', 400)])),
    )).toBe(withoutWeek);
  });

  it('collapses absent, null and empty onto one signature', () => {
    // `inferredTopology` emits a byte-identical topology for all three, so a
    // signature that told them apart would rebuild the colony for no move.
    expect(producerKeysSignature(null)).toBe('');
    expect(producerKeysSignature(undefined)).toBe('');
    expect(producerKeysSignature(view(chainWith([])))).toBe('');
  });
});
