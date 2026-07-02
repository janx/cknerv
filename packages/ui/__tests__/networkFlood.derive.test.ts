import { describe, it, expect } from 'vitest';
import { pickOrigin, floodArrivalTimes, colonyFlood, clampHeroDelayS, FLOOD_DURATION_S, HERO_MIN_FRAC, HERO_MAX_FRAC } from '../src/derives/networkFlood.derive';
import { inferredTopology } from '../src/derives/networkTopology.derive';
import type { Peer } from '@cknerv/types';

function peer(p: Partial<Peer>): Peer {
  return { node_id: 'Qm', addr: '1.2.3.4:8115', direction: 'outbound', version: '0.1', connected_ms: 0, ...p };
}
const peers = [peer({ node_id: 'A', latency_ms: 40 }), peer({ node_id: 'B', latency_ms: 220 })];
const topo = inferredTopology(peers, 0xc0ffee, 'ckb:local');

describe('graph flood', () => {
  it('pickOrigin is deterministic per nonce, never local, and reshuffles across nonces', () => {
    expect(pickOrigin(topo, 7)).toBe(pickOrigin(topo, 7));
    expect(pickOrigin(topo, 7)).not.toBe('ckb:local');
    const winners = new Set([1, 2, 3, 4, 5, 6, 7, 8].map((n) => pickOrigin(topo, n)));
    expect(winners.size).toBeGreaterThan(1);
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
