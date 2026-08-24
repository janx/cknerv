import { describe, it, expect } from 'vitest';
import { pickOrigin, floodArrivalTimes, colonyFlood, clampHeroDelayS, FLOOD_DURATION_S, HERO_MIN_FRAC, HERO_MAX_FRAC } from '../src/derives/networkFlood.derive';
import { buildAdjacency, inferredTopology } from '../src/derives/networkTopology.derive';
import type { NetworkEdge, NetworkNode, NetworkTopology } from '../src/types';
import type { NetworkRosterRecord, Peer, RosterNode } from '@cknerv/types';

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
    version: '0.116.1',
    country: 'Unknown',
    asn: 'Unknown',
    reachable: true,
    last_seen_ms: 1_700_000_000_000,
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
