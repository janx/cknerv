import { describe, it, expect } from 'vitest';
import { attestedOrigin, pickOrigin, floodArrivalTimes, colonyFlood, clampHeroDelayS, FLOOD_DURATION_S, HERO_MIN_FRAC, HERO_MAX_FRAC } from '../src/derives/networkFlood.derive';
import { attestedNodeId, buildAdjacency, inferredTopology } from '../src/derives/networkTopology.derive';
import {
  producerOriginStats,
  resetProducerOriginStats,
  snapshotProducerOriginStats,
} from '../src/derives/producerOriginStats';
import { deriveBlockProducers, type ProducerStanding } from '../src/derives/blockProducers.derive';
import {
  applyCellDelta, emptyCellsCache, emptyChainCache, fromCellsSnapshot,
} from '@cknerv/cache';
import type { NetworkEdge, NetworkNode, NetworkTopology } from '../src/types';
import type {
  BlockProducer, ChainEntry, NetworkRosterRecord, Peer, RosterNode,
} from '@cknerv/types';

function peer(p: Partial<Peer>): Peer {
  return { node_id: 'Qm', addr: '1.2.3.4:8115', direction: 'outbound', version: '0.1', connected_ms: 0, ...p };
}
const peers = [peer({ node_id: 'A', latency_ms: 40 }), peer({ node_id: 'B', latency_ms: 220 })];
const topo = inferredTopology(peers, 0xc0ffee, 'ckb:local');

/** A crawler roster of `n` rows, the shape `stageSighted` reads. */
function roster(n: number): NetworkRosterRecord {
  const entries: RosterNode[] = Array.from({ length: n }, (_, i) => ({
    node_id: `Qm${String(i).padStart(4, '0')}`,
    addr: '/ip4/10.0.0.1/tcp/8115',
    state: 'reachable',
    version: '0.116.1',
    country: 'Unknown',
    asn: 'Unknown',
    last_reachable_ms: 1_700_000_000_000,
    last_advertised_ms: 1_700_000_060_000,
    last_observed_ms: 1_700_000_000_000,
    latest_positive_observed_ms: 1_700_000_065_000,
  }));
  return {
    source: 'ckbadger',
    as_of: { block: 12_000_000, hash: '0xabc' },
    updated_at_ms: 1_700_000_000_000,
    crawl_round: 1,
    truncated: false,
    entries,
  };
}

/** The linear-scan Dijkstra `floodArrivalTimes` used to be, kept verbatim as the
 *  ORACLE. Arrival times and predecessors are read by the delivery schedule, the
 *  node flashes and the edge-pulse directions, so the settle order is contract,
 *  not an implementation detail — this is what pins it. */
function referenceFlood(
  topology: NetworkTopology, originId: string,
): { arrival: Map<string, number>; predecessor: Map<string, string | null> } {
  const arrival = new Map<string, number>();
  const predecessor = new Map<string, string | null>();
  const visited = new Set<string>();
  for (const n of topology.nodes) { arrival.set(n.id, Infinity); predecessor.set(n.id, null); }
  arrival.set(originId, 0);
  for (let iter = 0; iter < topology.nodes.length; iter++) {
    let u: string | null = null, best = Infinity;
    for (const [id, d] of arrival) if (!visited.has(id) && d < best) { best = d; u = id; }
    if (u === null || best === Infinity) break;
    visited.add(u);
    for (const { to, weight } of topology.adjacency.get(u) ?? []) {
      if (visited.has(to)) continue;
      const nd = best + weight;
      if (nd < (arrival.get(to) ?? Infinity)) { arrival.set(to, nd); predecessor.set(to, u); }
    }
  }
  return { arrival, predecessor };
}

function graph(ids: string[], links: [string, string, number][], localId: string): NetworkTopology {
  const nodes: NetworkNode[] = ids.map((id) => ({ id, kind: 'inferred', pos: [0, 0, 0] }));
  const edges: NetworkEdge[] = links.map(([a, b, weight]) => ({ a, b, kind: 'inferred', weight }));
  return { provenance: 'inferred', localId, nodes, edges, adjacency: buildAdjacency(nodes, edges) };
}

/** Integer weights over a ring plus two chord families: equal-cost routes are
 *  everywhere, so this pins the settle ORDER and not merely the distances. It
 *  borrows no colony constant — a layout retune must not be able to move it. */
function latticeTopology(): NetworkTopology {
  const ids = Array.from({ length: 64 }, (_, i) => `n${String(i).padStart(2, '0')}`);
  const links: [string, string, number][] = [];
  for (let i = 0; i < 64; i += 1) {
    links.push([ids[i], ids[(i + 1) % 64], 1]);
    links.push([ids[i], ids[(i + 16) % 64], 2]);
    links.push([ids[i], ids[(i * 7 + 11) % 64], 3]);
  }
  // Two nodes nobody links: the flood must leave them at Infinity, no sender.
  return graph([...ids, 'island-a', 'island-b'], links, 'n00');
}

describe('graph flood', () => {
  it('pickOrigin is deterministic per nonce, never local, and reshuffles across nonces', () => {
    expect(pickOrigin(topo, 7)).toBe(pickOrigin(topo, 7));
    expect(pickOrigin(topo, 7)).not.toBe('ckb:local');
    const winners = new Set([1, 2, 3, 4, 5, 6, 7, 8].map((n) => pickOrigin(topo, n)));
    expect(winners.size).toBeGreaterThan(1);
  });

  it('pickOrigin never singles out a NAMED node — the origin is always anonymous', () => {
    // Both named tiers on stage at once: two measured peers we hold a link to,
    // and 24 sighted rows a crawler handed us. An origin is the claim "the
    // block entered the network HERE", and nothing observable backs it — so it
    // may only ever land on the anonymous scatter, never on an identity whose
    // card carries real facts.
    const named = inferredTopology(peers, 0xc0ffee, 'ckb:local', undefined, roster(24));
    const kindById = new Map(named.nodes.map((n) => [n.id, n.kind]));
    expect(new Set(kindById.values())).toEqual(new Set(['local', 'measured', 'inferred', 'sighted']));
    for (let nonce = 0; nonce < 512; nonce += 1) {
      expect(kindById.get(pickOrigin(named, nonce))).toBe('inferred');
    }
  });

  it('a scatter-less topology still picks a non-local origin (fallback intact)', () => {
    // Labs and fixtures stand a colony with no ghosts at all; the anonymity
    // rule must narrow the choice, never collapse it back onto us.
    const bare = { ...topo, nodes: topo.nodes.filter((n) => n.kind === 'local' || n.kind === 'measured') };
    expect(bare.nodes.map((n) => n.kind).sort()).toEqual(['local', 'measured', 'measured']);
    for (let nonce = 0; nonce < 32; nonce += 1) {
      expect(pickOrigin(bare, nonce)).not.toBe('ckb:local');
    }
  });

  it('arrival times: origin = 0, all nodes reachable, monotonic along predecessors', () => {
    const origin = pickOrigin(topo, 3);
    const { arrival, predecessor } = floodArrivalTimes(topo, origin);
    expect(arrival.get(origin)).toBe(0);
    for (const n of topo.nodes) expect(Number.isFinite(arrival.get(n.id)!)).toBe(true); // no islands
    // each non-origin node arrives strictly after its predecessor
    for (const n of topo.nodes) {
      const pre = predecessor.get(n.id);
      if (pre) expect(arrival.get(n.id)!).toBeGreaterThan(arrival.get(pre)!);
    }
  });

  it('local is never first (arrival > 0), i.e. the block reaches us partway', () => {
    const { arrival } = floodArrivalTimes(topo, pickOrigin(topo, 5));
    expect(arrival.get('ckb:local')!).toBeGreaterThan(0);
  });

  it('a hand-checked graph pins every distance AND every tie-break by hand', () => {
    // o─1─a─2─c─1─e─0─f    o─1─b─2─c   a─5─d   b─3─d   d─1─e   x: nobody
    // `a` and `b` both arrive at 1 and `a` is listed first, so `c` (3 either
    // way) records `a`; `d` improves 6→4 and records `b`; `e` takes c's 4 and
    // refuses d's 5; the zero-weight hop carries `f` along at 4.
    const g = graph(
      ['o', 'a', 'b', 'c', 'd', 'e', 'f', 'x'],
      [['o', 'a', 1], ['o', 'b', 1], ['a', 'c', 2], ['b', 'c', 2], ['a', 'd', 5],
        ['b', 'd', 3], ['c', 'e', 1], ['d', 'e', 1], ['e', 'f', 0]],
      'o',
    );
    const { arrival, predecessor } = floodArrivalTimes(g, 'o');
    expect([...arrival.entries()]).toEqual([
      ['o', 0], ['a', 1], ['b', 1], ['c', 3], ['d', 4], ['e', 4], ['f', 4], ['x', Infinity],
    ]);
    expect([...predecessor.entries()]).toEqual([
      ['o', null], ['a', 'o'], ['b', 'o'], ['c', 'a'], ['d', 'b'], ['e', 'c'], ['f', 'e'], ['x', null],
    ]);
  });

  it('matches the linear-scan oracle entry for entry, in key order, on a tie-dense graph', () => {
    const lattice = latticeTopology();
    for (const origin of ['n00', 'n37', 'n63', 'island-a']) {
      const got = floodArrivalTimes(lattice, origin);
      const want = referenceFlood(lattice, origin);
      expect([...got.arrival.entries()]).toEqual([...want.arrival.entries()]);
      expect([...got.predecessor.entries()]).toEqual([...want.predecessor.entries()]);
    }
  });

  it('matches the oracle on the real colony, scatter and roster and all', () => {
    const named = inferredTopology(peers, 0xc0ffee, 'ckb:local', undefined, roster(24));
    for (const t of [topo, named]) {
      for (let nonce = 0; nonce < 6; nonce += 1) {
        const origin = pickOrigin(t, nonce);
        const got = floodArrivalTimes(t, origin);
        const want = referenceFlood(t, origin);
        expect([...got.arrival.entries()]).toEqual([...want.arrival.entries()]);
        expect([...got.predecessor.entries()]).toEqual([...want.predecessor.entries()]);
      }
    }
  });

  it('an origin the node list never mentioned still floods, with no predecessor row of its own', () => {
    // Not reachable from any caller today — pinned because the maps then carry
    // different key sets, which is the one place the two outputs disagree.
    const g = graph(['a', 'b'], [['a', 'b', 2]], 'a');
    g.adjacency.set('ghost', [{ to: 'a', weight: 1 }]);
    const got = floodArrivalTimes(g, 'ghost');
    const want = referenceFlood(g, 'ghost');
    expect([...got.arrival.entries()]).toEqual([...want.arrival.entries()]);
    expect([...got.predecessor.entries()]).toEqual([...want.predecessor.entries()]);
    expect(got.arrival.get('ghost')).toBe(0);
    expect(got.predecessor.has('ghost')).toBe(false);
  });
});

describe('colonyFlood schedule', () => {
  it('arrivals/senders cover ONLY measured peers; colony maps cover all nodes', () => {
    const f = colonyFlood(topo, 4);
    expect(Object.keys(f.arrivals).sort()).toEqual(['A', 'B']);       // measured only
    expect(Object.keys(f.senders).sort()).toEqual(['A', 'B']);
    expect(Object.keys(f.colonyArrivalS).length).toBe(topo.nodes.length); // all nodes
    expect(f.entryId).not.toBe('ckb:local');
  });

  it('hero (local) timing is clamped partway into the flood window', () => {
    const f = colonyFlood(topo, 4);
    expect(f.localReceiveDelayS).toBeGreaterThanOrEqual(FLOOD_DURATION_S * HERO_MIN_FRAC - 1e-6);
    expect(f.localReceiveDelayS).toBeLessThanOrEqual(FLOOD_DURATION_S * HERO_MAX_FRAC + 1e-6);
  });

  it('clampHeroDelayS pins the hero band exactly (a swapped/mistyped bound would bite)', () => {
    // band = [FLOOD_DURATION_S·HERO_MIN_FRAC, FLOOD_DURATION_S·HERO_MAX_FRAC] = [0.3, 1.7]
    expect(clampHeroDelayS(0)).toBe(0.3);   // below the floor → clamped up to MIN
    expect(clampHeroDelayS(5)).toBe(1.7);   // above the ceiling → clamped down to MAX
    expect(clampHeroDelayS(1.0)).toBe(1.0); // inside the band → passes through unchanged
  });

  it('empty/lone topology → inert schedule', () => {
    const lone = inferredTopology([], 0xc0ffee, 'ckb:local');
    // lone still has the inferred scaffold; a topology with a single node is the true degenerate:
    const single = { ...lone, nodes: [lone.nodes[0]], edges: [], adjacency: new Map([[lone.nodes[0].id, []]]) };
    const f = colonyFlood(single as typeof lone, 1);
    expect(f).toEqual({ entryId: null, localReceiveDelayS: 0, arrivals: {}, senders: {}, colonyArrivalS: {}, colonyPredecessor: {} });
  });

  it('zero-peers colony → no measured-worker boluses (arrivals {}), but the local hero still feeds her + colony floods every node', () => {
    // NOT the degenerate single-node case above: the full inferred scaffold is present,
    // there are simply no MEASURED peers — so no worker boluses. The LOCAL HERO still
    // feeds the queen (via localReceiveDelayS / the localOrigins delivery downstream).
    const lone = inferredTopology([], 0xc0ffee, 'ckb:local');
    const f = colonyFlood(lone, 1);
    expect(f.arrivals).toEqual({});  // no measured workers → no worker boluses (hero still feeds her)
    expect(f.senders).toEqual({});   // …and thus no senders either
    // the colony still floods visually: EVERY node gets a finite colony-arrival time.
    expect(Object.keys(f.colonyArrivalS).length).toBe(lone.nodes.length);
    for (const n of lone.nodes) expect(Number.isFinite(f.colonyArrivalS[n.id])).toBe(true);
    expect(f.entryId).not.toBe('ckb:local'); // origin is a real (inferred) node, not us
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE ORIGIN THE CHAIN NAMES.
//
// §4.2: relay is still unreported and origin is now reported, so the
// 2026-08-24 ruling (`45270d0`, a named node may receive a wave and never
// source one) is AMENDED rather than excepted — `attested` is a third evidence
// class, certain in existence and empty of identity. The tests below ask both
// halves: the chain's name is honoured when the colony is standing a node for
// it, and NOTHING ELSE about the old behaviour moves.
//
// ⚠️ Every key here is CONSTRUCTED. The live producer set drifts with the
// pools and the crawl drifts with the round; nothing below pins a real hash or
// a real count.
// ─────────────────────────────────────────────────────────────────────────────

/** A lock-script-hash-shaped key: `0x` + 64 hex, the shape the adapter emits.
 *  Hex-encoded per character so two distinct tags cannot fold onto one key. */
function producerKey(tag: string): string {
  const encoded = [...tag].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
  return `0x${encoded.padEnd(64, '0').slice(0, 64)}`;
}

/** One producer's standing. The fan is always WITHHELD: the flood never reads a
 *  fan, and a drawn one would smuggle roster rows into a test about where a
 *  wave starts. */
function standing(over: Partial<ProducerStanding> & { key: string }): ProducerStanding {
  const blocks = over.blocks ?? 10;
  const windowBlocks = over.windowBlocks ?? 100;
  return {
    role: 'producer',
    message: '0.209.0 (aaaaaaa 2026-07-30)',
    blocks,
    windowBlocks,
    share: blocks / windowBlocks,
    lastSeenMs: 1_700_000_000_000,
    fan: { drawn: false, reason: 'roster_absent', matchedVersion: null, matched: 0, shareOfVersioned: 0 },
    ...over,
  };
}

function standings(n: number): ProducerStanding[] {
  return Array.from({ length: n }, (_, i) => standing({ key: producerKey(`p${i}`) }));
}

/** The colony the rest of this section floods: two measured peers, a crawl
 *  round of 24 sighted rows, six producers standing on the ghosts' places. */
const PRODUCERS = standings(6);
const mined = inferredTopology(
  peers, 0xc0ffee, 'ckb:local', undefined, roster(24), undefined, PRODUCERS,
);
/** Today's colony — the same scene with no producers at all. */
const unmined = inferredTopology(peers, 0xc0ffee, 'ckb:local', undefined, roster(24));

describe('flood origin: the chain names it (⭐ §4.2, amending 45270d0)', () => {
  const kindById = new Map(mined.nodes.map((n) => [n.id, n.kind]));

  it('⭐ no producer key ⇒ the flood is what it was before producers existed', () => {
    // The whole fallback contract in one comparison: with nothing resolved, the
    // third argument may not perturb the origin, the arrival scale, the hero
    // clamp or a single map entry. Absent, null and the empty string are one
    // answer — absence — and none of them is a key.
    for (const t of [topo, unmined, mined]) {
      for (let nonce = 0; nonce < 24; nonce += 1) {
        const today = colonyFlood(t, nonce);
        expect(today.entryId).toBe(pickOrigin(t, nonce));
        for (const absent of [undefined, null, ''] as const) {
          expect(colonyFlood(t, nonce, absent)).toEqual(today);
        }
      }
    }
  });

  it('an unnamed wave still starts on the ANONYMOUS scatter, producers on stage or not', () => {
    // The ruling's own test, re-run with the new rung present: staging
    // producers must not quietly hand `pickOrigin` a fourth candidate pool.
    expect(new Set(kindById.values()))
      .toEqual(new Set(['local', 'measured', 'inferred', 'sighted', 'attested']));
    for (let nonce = 0; nonce < 512; nonce += 1) {
      expect(kindById.get(pickOrigin(mined, nonce))).toBe('inferred');
      expect(kindById.get(colonyFlood(mined, nonce).entryId!)).toBe('inferred');
    }
  });

  it('⭐ a staged producer key IS the origin, whatever the nonce would have chosen', () => {
    for (const producer of PRODUCERS) {
      const id = attestedNodeId(producer.key);
      const chosen = new Set<string | null>();
      for (const nonce of [0, 1, 7, 41, 512, 20_259_445]) {
        const f = colonyFlood(mined, nonce, producer.key);
        chosen.add(f.entryId);
        expect(f.entryId).toBe(id);
        // it really is the source: it arrives at t=0 and has no sender
        expect(f.colonyArrivalS[id]).toBe(0);
        expect(f.colonyPredecessor[id]).toBeNull();
        // …and the wave still travels — local is never first
        expect(f.colonyArrivalS['ckb:local']).toBeGreaterThan(0);
        expect(f.localReceiveDelayS).toBeGreaterThanOrEqual(FLOOD_DURATION_S * HERO_MIN_FRAC - 1e-6);
      }
      // the chain decided, not the rng: one origin across every nonce
      expect(chosen.size).toBe(1);
    }
  });

  it('⭐ THE RULING STANDS for measured and sighted — neither can be named into an origin', () => {
    // A key is matched against the `attested:` namespace AND the rung, not
    // against the node list at large. Handing this function a peer's base58 id
    // or a ghost's `inf:n` therefore resolves nothing, and the wave falls back
    // to the anonymous pick rather than pinning a claim on a real identity.
    for (const node of mined.nodes) {
      if (node.kind === 'attested') continue;
      expect(attestedOrigin(mined, node.id)).toBeNull();
      expect(colonyFlood(mined, 9, node.id)).toEqual(colonyFlood(mined, 9));
    }
    // and no measured peer is ever handed `arrivals[id] = 0`, which is the
    // reading that would launch a delivery carrier into the canopy at t=0
    for (const producer of PRODUCERS) {
      const f = colonyFlood(mined, 9, producer.key);
      for (const arrival of Object.values(f.arrivals)) expect(arrival).toBeGreaterThan(0);
    }
  });

  it('a producer wearing a measured peer’s own string cannot make that peer the source', () => {
    // The one collision the namespace exists for. Both nodes stand; the origin
    // is the attested one, and the measured peer RECEIVES the wave — which is
    // exactly the half of the ruling that was always true.
    const shared = producerKey('collision');
    const t = inferredTopology(
      [peer({ node_id: shared, latency_ms: 40 })], 0xc0ffee, 'ckb:local', undefined,
      null, undefined, [standing({ key: shared })],
    );
    const f = colonyFlood(t, 3, shared);
    expect(f.entryId).toBe(attestedNodeId(shared));
    expect(f.entryId).not.toBe(shared);
    expect(f.arrivals[shared]).toBeGreaterThan(0);
  });
});

describe('flood origin: a key the colony cannot stand on (⚠️ a LIVE path)', () => {
  it('⭐ a key present but not staged falls back, and invents no node', () => {
    // Ordinary, not corrupt: the pulse's producer and the colony's producer
    // window are two readings of one rolling window taken at different moments
    // on different streams, so a producer that fired this wave and then left
    // the window before this render is a Tuesday.
    const departed = producerKey('left-the-window');
    expect(mined.nodes.some((n) => n.id === attestedNodeId(departed))).toBe(false);
    expect(attestedOrigin(mined, departed)).toBeNull();
    for (let nonce = 0; nonce < 24; nonce += 1) {
      const f = colonyFlood(mined, nonce, departed);
      expect(f).toEqual(colonyFlood(mined, nonce));
      expect(f.entryId).toBe(pickOrigin(mined, nonce));
    }
    // nothing was added to the graph on the way past
    expect(Object.keys(colonyFlood(mined, 3, departed).colonyArrivalS))
      .toHaveLength(mined.nodes.length);
  });

  it('a colony with no producers at all reads every key as absence', () => {
    // A devnet that has not mined, a boot whose window is still empty, a chain
    // stream that has not arrived yet. Every one of them is a wave with no
    // name, and none of them is an error.
    for (const producer of PRODUCERS) {
      expect(attestedOrigin(unmined, producer.key)).toBeNull();
      expect(colonyFlood(unmined, 5, producer.key)).toEqual(colonyFlood(unmined, 5));
    }
  });

  it('a malformed key resolves to nothing rather than throwing', () => {
    for (const junk of ['', 'attested:', 'inf:0', 'ckb:local', '0x', PRODUCERS[0].key.slice(2)]) {
      expect(attestedOrigin(mined, junk)).toBeNull();
    }
  });
});

describe('flood origin: the resync path (⚠️ the fallback runs in production)', () => {
  it('a mid-session resync drops the name and the wave returns to the scatter', () => {
    const key = PRODUCERS[0].key;
    const pulsed = applyCellDelta(emptyCellsCache(), {
      type: 'pulse', at_ms: 1_000, producer_key: key,
    });
    expect(colonyFlood(mined, pulsed.lastPulseAtMs, pulsed.lastPulseProducerKey).entryId)
      .toBe(attestedNodeId(key));

    // lag → markLagged → reconnect `?since=0` → server re-snapshot, with the
    // tree already mounted. The restored stamp is a REAL pulse edge, and the
    // snapshot knows when the server last pulsed and nothing about who earned
    // it — so the producer is cleared rather than carried across a stamp that
    // belongs to a different block.
    const resynced = fromCellsSnapshot(9, { cells: [], last_pulse_at_ms: 5_000 }, {}, pulsed);
    expect(resynced.lastPulseProducerKey).toBeNull();
    const after = colonyFlood(mined, resynced.lastPulseAtMs, resynced.lastPulseProducerKey);
    expect(after).toEqual(colonyFlood(mined, resynced.lastPulseAtMs));
    expect(after.entryId).toBe(pickOrigin(mined, resynced.lastPulseAtMs));
    expect(mined.nodes.find((n) => n.id === after.entryId)!.kind).toBe('inferred');
  });

  it('a block that named nobody is anonymous, not the last name repeated', () => {
    const named = applyCellDelta(emptyCellsCache(), {
      type: 'pulse', at_ms: 1_000, producer_key: PRODUCERS[1].key,
    });
    const anonymous = applyCellDelta(named, { type: 'pulse', at_ms: 2_000 });
    expect(anonymous.lastPulseProducerKey).toBeNull();
    const f = colonyFlood(mined, anonymous.lastPulseAtMs, anonymous.lastPulseProducerKey);
    expect(f.entryId).not.toBe(attestedNodeId(PRODUCERS[1].key));
    expect(f).toEqual(colonyFlood(mined, anonymous.lastPulseAtMs));
  });
});

describe('the producer signature the topology memo is keyed on', () => {
  /** A chain whose window holds `blocks[i]` blocks for producer `i`. */
  function chainWith(blocks: number[]): ChainEntry {
    const producers: BlockProducer[] = blocks.map((count, i) => ({
      key: producerKey(`p${i}`),
      message: '0.209.0 (aaaaaaa 2026-07-30)',
      blocks: count,
      last_seen_ms: 1_700_000_000_000 + i,
    }));
    return {
      ...emptyChainCache(),
      producers,
      producer_window: producers.flatMap((p, i) => Array<number>(p.blocks).fill(i)),
      producer_window_blocks: blocks.reduce((s, b) => s + b, 0),
    };
  }
  const keySet = (chain: ChainEntry) => (
    deriveBlockProducers(chain, null)!.staging.map((p) => p.key).join(' ')
  );

  // ⚠️⚠️ THE FAILURE THIS PINS. A block bumps its producer's count and re-divides
  // every share against the window, so the STANDINGS move on every block while
  // the KEY SET does not. App keys the topology memo on the key set alone; had
  // it keyed on anything a block moves, the colony would rebuild once a block
  // because a numerator moved — and ColonyEdges owns its line geometry on
  // `[topology]`, so that rebuild lands new surge lanes under an in-flight wave
  // and truncates the wavefront.
  it('⭐ a block landing on an existing producer does not move the key set', () => {
    const before = chainWith([9, 5, 3]);
    const after = chainWith([10, 5, 3]);          // one more block for the leader
    expect(keySet(after)).toBe(keySet(before));
    // …while the standings genuinely moved, which is the half that must cross
    const shares = (chain: ChainEntry) => deriveBlockProducers(chain, null)!.staging
      .map((p) => [p.blocks, p.windowBlocks, p.share] as const);
    expect(shares(after)).not.toEqual(shares(before));
  });

  it('⭐ …nor does one miner overtaking another, which is a set that did not change', () => {
    // ⚠️ THE SECOND DOOR INTO THE SAME FAILURE, and the one a field-by-field key
    // cannot close: the staging array's ORDER. While it was sequenced by
    // blocks, a swap between two neighbouring shares — the commonest thing a
    // rolling window does that is not a block for the leader — re-sequenced an
    // identical set and re-keyed the whole colony.
    const before = chainWith([9, 5, 3]);
    const after = chainWith([5, 9, 3]);            // p0 and p1 trade places
    expect(keySet(after)).toBe(keySet(before));
    // The swap is real: the standings moved even though nobody joined or left.
    const tallies = (chain: ChainEntry) => deriveBlockProducers(chain, null)!.staging
      .map((p) => p.blocks);
    expect(tallies(after)).not.toEqual(tallies(before));
    // …and the reading order is where it is allowed to show.
    const top = (chain: ChainEntry) => deriveBlockProducers(chain, null)!.ranked[0].key;
    expect(top(after)).not.toBe(top(before));
  });

  it('…and a producer entering or leaving the window does move it', () => {
    // The other half: the key set is what the GEOMETRY follows (one node per
    // key, one displaced ghost each), so a changed set has to re-key.
    expect(keySet(chainWith([9, 5, 3, 1]))).not.toBe(keySet(chainWith([9, 5, 3])));
    expect(keySet(chainWith([9, 5]))).not.toBe(keySet(chainWith([9, 5, 3])));
  });

  it('⭐ the live tally reaches the nodes whenever the topology IS rebuilt', () => {
    // T5 hangs the standing on the node by reference and re-stages both tails
    // on every call, so the window the nodes carry is the window as it stood
    // when the memo last ran — never a copy taken when the tier was created.
    const view = (chain: ChainEntry) => deriveBlockProducers(chain, null)!.staging;
    const rows = roster(9);
    const first = inferredTopology(
      peers, 0xc0ffee, 'ckb:local', undefined, rows, undefined, view(chainWith([9, 5, 3])),
    );
    const later = inferredTopology(
      peers, 0xc0ffee, 'ckb:local', undefined, rows, undefined, view(chainWith([10, 5, 3])),
    );
    const tally = (t: typeof first) => t.nodes
      .filter((n) => n.kind === 'attested')
      .map((n) => [n.attested!.blocks, n.attested!.windowBlocks]);
    expect(tally(first)).toEqual([[9, 17], [5, 17], [3, 17]]);
    expect(tally(later)).toEqual([[10, 18], [5, 18], [3, 18]]);
    // and the geometry did not move under them
    expect(later.nodes.map((n) => n.id)).toEqual(first.nodes.map((n) => n.id));
    expect(later.nodes.map((n) => n.pos)).toEqual(first.nodes.map((n) => n.pos));
  });
});

/**
 * ⭐ THE ORIGIN CHANGE'S ONLY OBSERVABLE.
 *
 * "The wave starts where the block was made" is a claim about a DISTRIBUTION,
 * and the honest test of it is live: over a few dozen blocks the fraction of
 * waves erupting from the dominant producer's node should approach its share of
 * the window. Nothing on the page could answer that — a wave is a stamp in a
 * uniform and two seconds of light — so the change shipped verifiable only by
 * watching, which is not verification. The counter below is what a probe reads
 * instead, and everything here is the arithmetic it has to get right.
 */
describe('__producerOriginStats — where the wave started', () => {
  const KEY_A = `0x${'a'.repeat(64)}`;
  const KEY_B = `0x${'b'.repeat(64)}`;

  function fresh() {
    resetProducerOriginStats();
    return producerOriginStats;
  }

  it('splits every wave into the chain\'s name or the anonymous scatter', () => {
    const stats = fresh();
    stats.observeWave(attestedNodeId(KEY_A));
    stats.observeWave(attestedNodeId(KEY_A));
    stats.observeWave(attestedNodeId(KEY_B));
    stats.observeWave('inf:37');
    stats.observeWave(null);
    const snap = snapshotProducerOriginStats();
    expect(snap.waves).toBe(5);
    expect(snap.attested).toBe(3);
    expect(snap.anonymous).toBe(2);
    // The split is exhaustive by construction: an origin is the chain's name or
    // it is not, and the "not" bucket is where a block that named nobody, a
    // producer that left the window, and a resync's producer-less stamp all
    // land — which is exactly what the screen shows for each of them.
    expect(snap.attested + snap.anonymous).toBe(snap.waves);
    expect(snap.attestedRatePct).toBeCloseTo(60, 12);
  });

  it('tallies origins per producer key, which is the oracle', () => {
    const stats = fresh();
    // A stand-in for a window one producer dominates: the tally over waves is
    // the number the live pass compares against that producer's share.
    for (let i = 0; i < 13; i += 1) stats.observeWave(attestedNodeId(KEY_A));
    for (let i = 0; i < 7; i += 1) stats.observeWave(attestedNodeId(KEY_B));
    const snap = snapshotProducerOriginStats();
    expect(snap.byProducer).toEqual({ [KEY_A]: 13, [KEY_B]: 7 });
    expect(snap.byProducer[KEY_A] / snap.waves).toBeCloseTo(0.65, 12);
    // The key is the PAYOUT key the standing is filed under, never the graph
    // id — a probe joins it against the producer view and must not have to
    // know this colony's namespace.
    expect(Object.keys(snap.byProducer).every((k) => !k.startsWith('attested:'))).toBe(true);
    // An anonymous wave belongs to nobody and names nobody.
    stats.observeWave('inf:1');
    expect(snapshotProducerOriginStats().byProducer).toEqual({ [KEY_A]: 13, [KEY_B]: 7 });
  });

  // ⚠️ A TRUNCATED WAVE STILL FIRED. A genuine key-set change — a tail producer
  // entering or leaving the 240-block window — rebuilds the topology, and a
  // rebuild landing mid-wave truncates the wave in flight. That is expected
  // occasionally and it may not disturb the tally, so there is nothing in this
  // counter that could notice: it counts at the instant a wave is armed and
  // never looks back to ask whether it finished crossing.
  it('counts what fired, and has no notion of what completed', () => {
    const stats = fresh();
    stats.observeWave(attestedNodeId(KEY_A));
    const mid = snapshotProducerOriginStats();
    // Whatever a rebuild does to the scene, the counter has already answered
    // and there is no second call that could take it back.
    expect(Object.keys(stats)).not.toContain('observeWaveCompleted');
    expect(snapshotProducerOriginStats()).toEqual(mid);
  });

  it('counts a suppressed pulse apart from a wave', () => {
    const stats = fresh();
    stats.observeSuppressed();
    stats.observeSuppressed();
    stats.observeWave(attestedNodeId(KEY_A));
    const snap = snapshotProducerOriginStats();
    // A backfill catch-up consumes the pulse and stamps no wave on purpose, so
    // it is neither an origin nor a missing one. Kept apart so a probe can tell
    // "nothing is arriving" from "everything is being replayed".
    expect(snap.suppressed).toBe(2);
    expect(snap.waves).toBe(1);
  });

  it('hands back a detached snapshot and zeroes cleanly', () => {
    const stats = fresh();
    stats.observeWave(attestedNodeId(KEY_A));
    const before = snapshotProducerOriginStats();
    stats.observeWave(attestedNodeId(KEY_A));
    // The snapshot is a copy, not a window onto the live counters — a probe
    // that reads twice around a wait is comparing two moments.
    expect(before.waves).toBe(1);
    expect(before.byProducer).toEqual({ [KEY_A]: 1 });
    expect(snapshotProducerOriginStats().byProducer).toEqual({ [KEY_A]: 2 });
    resetProducerOriginStats();
    expect(snapshotProducerOriginStats()).toEqual({
      waves: 0,
      attested: 0,
      anonymous: 0,
      suppressed: 0,
      byProducer: {},
      attestedRatePct: 0,
    });
  });

  it('agrees with the flood about what an attested origin looks like', () => {
    // Not a transcription of the prefix: the counter classifies the id the
    // FLOOD chose, so the two have to read the same namespace or the tally
    // would quietly call every wave anonymous.
    const producers: ProducerStanding[] = [standing({ key: KEY_A })];
    const topology = inferredTopology(
      peers, 0xc0ffee, 'ckb:local', undefined, roster(6), undefined, producers,
    );
    const cf = colonyFlood(topology, 1, KEY_A);
    expect(cf.entryId).toBe(attestedNodeId(KEY_A));
    const stats = fresh();
    stats.observeWave(cf.entryId);
    expect(snapshotProducerOriginStats().byProducer).toEqual({ [KEY_A]: 1 });
    // …and the fallback the same way: a key this colony stands no node for
    // enters through the scatter, and the counter calls it what it is.
    const anonymous = colonyFlood(topology, 1, `0x${'c'.repeat(64)}`);
    expect(anonymous.entryId).not.toBe(null);
    stats.observeWave(anonymous.entryId);
    const snap = snapshotProducerOriginStats();
    expect(snap.waves).toBe(2);
    expect(snap.anonymous).toBe(1);
  });
});
