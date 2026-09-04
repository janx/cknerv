import { describe, it, expect } from 'vitest';
import {
  localAnchor, measuredPeerPos, COLONY_Y, LOCAL_ANCHOR_OFFSET, COLONY_ELLIPSE_X, COLONY_ELLIPSE_Z,
  scatterInferred, COLONY_INFERRED_COUNT, COLONY_INFERRED_JITTER, COLONY_MIN_SPACING,
  COLONY_RADIUS, COLONY_Y_THICKNESS, inferredTopology, ensureConnectedFrom, sightedPos,
  STAGEABLE_ROSTER_STATES, ATTESTED_ID_PREFIX, attestedNodeId, attestedPos, stageAttested,
  COHORT_KEEP_OUT_R, cohortKeepOutPos,
} from '../src/derives/networkTopology.derive';
import { colonyFlood } from '../src/derives/networkFlood.derive';
import { deriveBlockProducers, type ProducerStanding } from '../src/derives/blockProducers.derive';
import {
  latencyToRadius01, peerAngle, PEER_INNER_RADIUS, PEER_OUTER_RADIUS,
} from '../src/derives/peers.derive';
import { emptyChainCache } from '@cknerv/cache';
import type {
  BlockProducer, ChainEntry, NetworkRosterRecord, Peer, RosterNode, RosterNodeState,
} from '@cknerv/types';
import { FIELD_HALF_X, FIELD_HALF_Z } from '../src/helix';
import type { NetworkNode, Vec3 } from '../src/types';

function peer(p: Partial<Peer>): Peer {
  return { node_id: 'Qm', addr: '1.2.3.4:8115', direction: 'outbound', version: '0.116.1', connected_ms: 0, ...p };
}

function rosterNode(p: Partial<RosterNode> & { node_id: string }): RosterNode {
  return {
    addr: '/ip4/10.0.0.1/tcp/8115',
    state: 'reachable',
    version: '0.116.1',
    country: 'Unknown',
    asn: 'Unknown',
    last_reachable_ms: 1_700_000_000_000,
    last_advertised_ms: 1_700_000_060_000,
    last_observed_ms: 1_700_000_000_000,
    latest_positive_observed_ms: 1_700_000_065_000,
    ...p,
  };
}

/** A roster record around `entries`, in the ascending-node_id order the wire
 *  contract pins (the derive must not depend on it — see the order test). */
function roster(
  entries: RosterNode[], over: Partial<NetworkRosterRecord> = {},
): NetworkRosterRecord {
  return {
    source: 'ckbadger',
    as_of: { block: 12_000_000, hash: '0xabc' },
    updated_at_ms: 1_700_000_000_000,
    crawl_round: 1,
    truncated: false,
    entries,
    ...over,
  };
}

/** N sighted rows with ids that sort ascending, as the crawler sends them. */
function sightedRoster(n: number, over: Partial<RosterNode> = {}): RosterNode[] {
  return Array.from({ length: n }, (_, i) => rosterNode({
    node_id: `Qm${String(i).padStart(4, '0')}`, ...over,
  }));
}

describe('networkTopology placement', () => {
  it('localAnchor is deterministic and offset from center on the chain plane', () => {
    const a = localAnchor(0xc0ffee);
    expect(a).toEqual(localAnchor(0xc0ffee));        // deterministic
    expect(a[1]).toBeCloseTo(COLONY_Y, 6);           // on the plane
    const rXZ = Math.hypot(a[0] / COLONY_ELLIPSE_X, a[2]);  // de-squash X to get base radius
    expect(rXZ).toBeGreaterThan(LOCAL_ANCHOR_OFFSET * 0.5); // genuinely offset, not centered
    expect(localAnchor(0xc0ffee)).not.toEqual(localAnchor(0xbeef)); // seed-sensitive
  });

  it('stands the whole belt outside the tissue rim, about the galaxy\u2019s axis', () => {
    // D-1: the measured peers were the only colony marks drawn INSIDE the
    // canopy, and additive cyan over rose is white — so the top of the
    // honesty ladder was the one rung that did not wear the family hue. The
    // belt clears the tissue's own footprint now, at every angle and at the
    // FASTEST ping, which is the inner radius and therefore the hard case.
    // The colony's ellipse is what decides it, and z is the tight axis.
    //
    // ⭐ AND IT IS THE WORLD FRAME IT CLEARS IT IN. The first cut hung the
    // belt off the local anchor, which stands ~30 wu off the axis, so this
    // same sweep passed while a third of the ring lay over the canopy in the
    // only frame anyone looks at. There is no anchor to pass now, and this
    // reading is the tissue's own.
    const fastest = peer({ node_id: 'A', latency_ms: 0 });
    let worst = Infinity;
    for (let i = 0; i < 360; i += 1) {
      // sweep the angle by walking the id, since the angle is id-hashed
      const p = { ...fastest, node_id: `peer-${i}` };
      const pos = measuredPeerPos(p);
      worst = Math.min(worst, Math.hypot(pos[0] / FIELD_HALF_X, pos[2] / FIELD_HALF_Z));
      // The belt's own centre, stated as the closed form it is: an ellipse
      // about (0,0) with no offset term. A centre 30 wu off the axis — which
      // is what hanging the belt off the local anchor gives — fails here at
      // every one of these angles.
      const a = peerAngle(p.node_id);
      const r = PEER_INNER_RADIUS;
      expect(pos[0]).toBeCloseTo(Math.cos(a) * r * COLONY_ELLIPSE_X, 9);
      expect(pos[2]).toBeCloseTo(Math.sin(a) * r * COLONY_ELLIPSE_Z, 9);
    }

    expect(worst).toBeGreaterThan(1.02);
    // …and the arithmetic that decides it, stated so a change to either
    // ellipse fails here rather than in a screenshot.
    expect(PEER_INNER_RADIUS * COLONY_ELLIPSE_Z).toBeGreaterThan(FIELD_HALF_Z * 1.02);
    expect(PEER_INNER_RADIUS * COLONY_ELLIPSE_X).toBeGreaterThan(FIELD_HALF_X * 1.02);
    expect(PEER_OUTER_RADIUS).toBeGreaterThan(PEER_INNER_RADIUS);
  });

  it('measuredPeerPos places a peer at latency-radius about the colony axis', () => {
    const p = peer({ node_id: 'A', latency_ms: 400 }); // >= cap → outer ring
    const pos = measuredPeerPos(p);
    // de-squash BOTH ellipse axes to recover the base (circular) radius r.
    const dxz = Math.hypot(pos[0] / COLONY_ELLIPSE_X, pos[2] / COLONY_ELLIPSE_Z);
    const t = latencyToRadius01(400);
    const expectedR = PEER_INNER_RADIUS + t * (PEER_OUTER_RADIUS - PEER_INNER_RADIUS);
    expect(dxz).toBeCloseTo(expectedR, 4);
    expect(pos[1]).toBeCloseTo(COLONY_Y, 6);
  });
});

describe('scatterInferred (⭐ seed-only, churn-stable)', () => {
  it('is deterministic and count is within the seeded band', () => {
    const a = scatterInferred(0xc0ffee);
    const b = scatterInferred(0xc0ffee);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThanOrEqual(COLONY_INFERRED_COUNT - COLONY_INFERRED_JITTER);
    expect(a.length).toBeLessThanOrEqual(COLONY_INFERRED_COUNT + COLONY_INFERRED_JITTER);
  });

  it('respects the min-spacing constraint', () => {
    const pts = scatterInferred(0xc0ffee);
    const min2 = COLONY_MIN_SPACING * COLONY_MIN_SPACING;
    // spot-check the first 40 against all others
    for (let i = 0; i < Math.min(40, pts.length); i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const dx = pts[i][0] - pts[j][0], dy = pts[i][1] - pts[j][1], dz = pts[i][2] - pts[j][2];
        expect(dx * dx + dy * dy + dz * dz).toBeGreaterThanOrEqual(min2 - 1e-6);
      }
    }
  });

  it('different seeds give different scaffolds', () => {
    expect(scatterInferred(0xc0ffee)).not.toEqual(scatterInferred(0xbeef));
  });
});

describe('inferredTopology assembly', () => {
  const seed = 0xc0ffee;
  const peers = [
    peer({ node_id: 'A', latency_ms: 40, direction: 'outbound' }),
    peer({ node_id: 'B', latency_ms: 180, direction: 'inbound' }),
    peer({ node_id: 'C', latency_ms: 400, direction: 'outbound' }),
  ];

  it('has one local node, the measured peers, and the inferred scaffold', () => {
    const t = inferredTopology(peers, seed, 'ckb:local');
    expect(t.provenance).toBe('inferred');
    expect(t.localId).toBe('ckb:local');
    expect(t.nodes.filter((n) => n.kind === 'local')).toHaveLength(1);
    expect(t.nodes.filter((n) => n.kind === 'measured')).toHaveLength(3);
    expect(t.nodes.filter((n) => n.kind === 'inferred').length).toBeGreaterThanOrEqual(200);
  });

  it('honesty: measured nodes carry a peer, inferred never do; only local↔peer edges are measured', () => {
    const t = inferredTopology(peers, seed, 'ckb:local');
    for (const n of t.nodes) {
      if (n.kind === 'measured') expect(n.peer).toBeDefined();
      if (n.kind === 'inferred') { expect(n.peer).toBeUndefined(); expect(n.id.startsWith('inf:')).toBe(true); }
    }
    const measuredEdges = t.edges.filter((e) => e.kind === 'measured');
    for (const e of measuredEdges) {
      const involvesLocal = e.a === 'ckb:local' || e.b === 'ckb:local';
      expect(involvesLocal).toBe(true);
    }
    // every real peer has a measured edge to local
    for (const p of peers) {
      expect(measuredEdges.some((e) => e.a === p.node_id || e.b === p.node_id)).toBe(true);
    }
  });

  it('is one connected component (no islands)', () => {
    const t = inferredTopology(peers, seed, 'ckb:local');
    const seen = new Set<string>();
    const stack = [t.nodes[0].id];
    while (stack.length) {
      const u = stack.pop()!;
      if (seen.has(u)) continue;
      seen.add(u);
      for (const { to } of t.adjacency.get(u) ?? []) if (!seen.has(to)) stack.push(to);
    }
    expect(seen.size).toBe(t.nodes.length);
  });

  it('⭐ adding/removing a peer leaves the inferred scaffold byte-identical', () => {
    const t3 = inferredTopology(peers, seed, 'ckb:local');
    const t2 = inferredTopology(peers.slice(0, 2), seed, 'ckb:local');
    const inf = (t: ReturnType<typeof inferredTopology>) => ({
      nodes: t.nodes.filter((n) => n.kind === 'inferred'),
      edges: t.edges.filter((e) => e.kind === 'inferred' && e.a.startsWith('inf:') && e.b.startsWith('inf:')),
    });
    expect(inf(t2)).toEqual(inf(t3));  // inferred↔inferred unaffected by the peer set
  });
});

describe('inferredTopology with an explicit localPos (pinned to the galaxy anchor)', () => {
  const seed = 0xc0ffee;
  // A world position distinct from the seed-only localAnchor(seed): stands in for
  // the galaxy's labeled CkbNodeAnchor position App now feeds the colony.
  const localPos: Vec3 = [12, 25, -7];
  const peers = [
    peer({ node_id: 'A', latency_ms: 40, direction: 'outbound' }),
    peer({ node_id: 'B', latency_ms: 400, direction: 'inbound' }), // >= cap → outer ring
  ];

  it('places the local node exactly at localPos (not the seed fallback)', () => {
    const t = inferredTopology(peers, seed, 'ckb:local', localPos);
    const local = t.nodes.find((n) => n.kind === 'local')!;
    expect(local.pos).toEqual(localPos);
    expect(local.pos).not.toEqual(localAnchor(seed)); // genuinely overrides the fallback
  });

  it('scatters measured peers about the colony axis, wherever the local node stands', () => {
    // ⭐ THE BELT'S CENTRE IS NOT OURS. It was, and the eccentricity that
    // bought — the anchor is ~30 wu off the axis by design — put a third of
    // the ring back over the canopy the belt had just been moved out of. The
    // radius is still our latency to each peer; the centre is the organism.
    const t = inferredTopology(peers, seed, 'ckb:local', localPos);
    const b = t.nodes.find((n) => n.id === 'B')!;
    // de-squash BOTH ellipse axes to recover the base (circular) radius
    const rAroundAxis = Math.hypot(
      b.pos[0] / COLONY_ELLIPSE_X,
      b.pos[2] / COLONY_ELLIPSE_Z,
    );
    const tRad = latencyToRadius01(400);
    const expectedR = PEER_INNER_RADIUS + tRad * (PEER_OUTER_RADIUS - PEER_INNER_RADIUS);
    expect(rAroundAxis).toBeCloseTo(expectedR, 4);
    expect(b.pos).toEqual(measuredPeerPos(peers[1]));
    // …and moving the local node moves the local node, not the belt. `localPos`
    // is a long way off both the axis and the seeded anchor, and the peer does
    // not budge; the LINK to it is what carries where we stand.
    const seeded = inferredTopology(peers, seed, 'ckb:local');
    expect(seeded.nodes.find((n) => n.id === 'B')!.pos).toEqual(b.pos);
    expect(t.nodes.find((n) => n.kind === 'local')!.pos)
      .not.toEqual(seeded.nodes.find((n) => n.kind === 'local')!.pos);
    expect(t.edges.some((e) => e.kind === 'measured' && e.a === 'ckb:local' && e.b === 'B')).toBe(true);
  });

  it('⭐ leaves the inferred scaffold byte-identical to the seed-only build (localPos never touches it)', () => {
    const withPos = inferredTopology(peers, seed, 'ckb:local', localPos);
    const noPos = inferredTopology(peers, seed, 'ckb:local'); // localAnchor(seed) fallback
    const inf = (t: ReturnType<typeof inferredTopology>) => ({
      nodes: t.nodes.filter((n) => n.kind === 'inferred'),
      edges: t.edges.filter((e) => e.kind === 'inferred' && e.a.startsWith('inf:') && e.b.startsWith('inf:')),
    });
    expect(inf(withPos)).toEqual(inf(noPos)); // inferred↔inferred unaffected by localPos
  });
});

describe('inferredTopology zero-peers edge case (an isolated node)', () => {
  const seed = 0xc0ffee;

  it('yields exactly one local node, zero measured nodes, and the full inferred scaffold', () => {
    const t = inferredTopology([], seed, 'ckb:local');
    expect(t.nodes.filter((n) => n.kind === 'local')).toHaveLength(1);
    expect(t.nodes.filter((n) => n.kind === 'measured')).toHaveLength(0); // no peers observed
    expect(t.nodes.filter((n) => n.kind === 'inferred').length).toBeGreaterThanOrEqual(200); // scaffold intact
  });

  it('is one connected component — the isolated local is still stitched into the scaffold', () => {
    const t = inferredTopology([], seed, 'ckb:local');
    // traverse the adjacency from the isolated local node itself: if it's genuinely
    // relayed into the colony, the reached set is EVERY node (no islands, local not orphaned).
    const seen = new Set<string>();
    const stack = [t.localId];
    while (stack.length) {
      const u = stack.pop()!;
      if (seen.has(u)) continue;
      seen.add(u);
      for (const { to } of t.adjacency.get(u) ?? []) if (!seen.has(to)) stack.push(to);
    }
    // starting from local, reaching EVERY node proves local is not orphaned AND there are no islands.
    expect(seen.size).toBe(t.nodes.length);
  });
});

describe('ensureConnectedFrom (multi-island bridge branch)', () => {
  // The real inferred scaffold is always already connected, so the bridge branch
  // never fires in production. Here we hand-build two disconnected clusters over
  // the scaffold range (start=0) — A={n0,n1}, B={n2,n3} — and force c=2, asserting
  // it bridges the islands into a single component.
  const node = (id: string, x: number): NetworkNode => ({ id, kind: 'inferred', pos: [x, 0, 0] });

  it('adds bridging edge(s) that unify the two disconnected clusters', () => {
    const nodes: NetworkNode[] = [node('n0', 0), node('n1', 1), node('n2', 10), node('n3', 11)];
    // partial adjacency: n0–n1 and n2–n3 only (two islands, no bridge between them)
    const adj = new Map<string, { to: string; weight: number }[]>([
      ['n0', [{ to: 'n1', weight: 1 }]],
      ['n1', [{ to: 'n0', weight: 1 }]],
      ['n2', [{ to: 'n3', weight: 1 }]],
      ['n3', [{ to: 'n2', weight: 1 }]],
    ]);
    const added: Array<[number, number]> = [];
    ensureConnectedFrom(nodes, 0, adj, (i, j) => { added.push([i, j]); });

    // it bridged at all (would stay empty if the c>1 branch never fired)
    expect(added.length).toBeGreaterThanOrEqual(1);
    // …and at least one added edge crosses island A={0,1} ↔ island B={2,3}
    const inA = (k: number) => k === 0 || k === 1;
    const inB = (k: number) => k === 2 || k === 3;
    const crosses = added.some(([i, j]) => (inA(i) && inB(j)) || (inB(i) && inA(j)));
    expect(crosses).toBe(true);

    // apply the bridge(s) and confirm the whole set is now ONE component
    for (const [i, j] of added) {
      adj.get(nodes[i].id)!.push({ to: nodes[j].id, weight: 1 });
      adj.get(nodes[j].id)!.push({ to: nodes[i].id, weight: 1 });
    }
    const seen = new Set<string>();
    const stack = [nodes[0].id];
    while (stack.length) {
      const u = stack.pop()!;
      if (seen.has(u)) continue;
      seen.add(u);
      for (const { to } of adj.get(u) ?? []) if (!seen.has(to)) stack.push(to);
    }
    expect(seen.size).toBe(nodes.length);
  });

  it('is a no-op when the scaffold is already one component (no spurious edges)', () => {
    const nodes: NetworkNode[] = [node('n0', 0), node('n1', 1), node('n2', 2)];
    const adj = new Map<string, { to: string; weight: number }[]>([
      ['n0', [{ to: 'n1', weight: 1 }]],
      ['n1', [{ to: 'n0', weight: 1 }, { to: 'n2', weight: 1 }]],
      ['n2', [{ to: 'n1', weight: 1 }]],
    ]);
    const added: Array<[number, number]> = [];
    ensureConnectedFrom(nodes, 0, adj, (i, j) => { added.push([i, j]); });
    expect(added).toEqual([]); // single component → early return, nothing bridged
  });
});

describe('scaffold reuse across measured-overlay rebuilds', () => {
  it('reuses the exact inferred node/edge objects when only latencies change', () => {
    const before = inferredTopology([peer({ node_id: 'A', latency_ms: 40 })], 0xc0ffee, 'ckb:local');
    const after = inferredTopology([peer({ node_id: 'A', latency_ms: 220 })], 0xc0ffee, 'ckb:local');
    const infNodes = (t: ReturnType<typeof inferredTopology>) => t.nodes.filter((n) => n.kind === 'inferred');
    const infEdges = (t: ReturnType<typeof inferredTopology>) => t.edges.filter(
      (e) => e.a.startsWith('inf:') && e.b.startsWith('inf:'),
    );
    const nodesA = infNodes(before);
    const nodesB = infNodes(after);
    expect(nodesB).toHaveLength(nodesA.length);
    for (let i = 0; i < nodesA.length; i++) expect(nodesB[i]).toBe(nodesA[i]); // same objects, not copies
    const edgesA = infEdges(before);
    const edgesB = infEdges(after);
    expect(edgesB).toHaveLength(edgesA.length);
    for (let i = 0; i < edgesA.length; i++) expect(edgesB[i]).toBe(edgesA[i]);
    // …while the measured overlay genuinely moved with the new latency.
    expect(before.nodes.find((n) => n.id === 'A')!.pos)
      .not.toEqual(after.nodes.find((n) => n.id === 'A')!.pos);
  });
});

describe('sighted nodes (the crawler names a bounded few)', () => {
  const seed = 0xc0ffee;
  const peers = [
    peer({ node_id: 'A', latency_ms: 40, direction: 'outbound' }),
    peer({ node_id: 'B', latency_ms: 180, direction: 'inbound' }),
  ];
  type Topology = ReturnType<typeof inferredTopology>;
  const ghostsOf = (t: Topology) => t.nodes.filter((n) => n.kind === 'inferred');
  const sightedOf = (t: Topology) => t.nodes.filter((n) => n.kind === 'sighted');

  it('stages every roster row as a sighted node carrying that row', () => {
    const rows = sightedRoster(5);
    const t = inferredTopology(peers, seed, 'ckb:local', undefined, roster(rows));
    const sighted = sightedOf(t);
    expect(sighted.map((n) => n.id)).toEqual(rows.map((r) => r.node_id));
    for (const n of sighted) {
      // the crawler's own row, by reference — no copy to go stale
      expect(n.sighted).toBe(rows.find((r) => r.node_id === n.id));
      expect(n.peer).toBeUndefined();       // identity is real, the link is not
    }
    for (const g of ghostsOf(t)) expect(g.sighted).toBeUndefined(); // ghosts stay anonymous
  });

  // ⭐ Every rung the record reports now has a mark, INCLUDING the one that
  // means nobody has ever had an answer out of this peer — which the scene
  // used to leave off stage and fill the same space with invented ghosts. What
  // stays true is the shape of the gate: staging is a set of rungs the colony
  // can draw, so a rung nobody has drawn a mark for still has to be named here
  // before it can appear.
  it('stages every rung it has a mark for, hearsay included', () => {
    const rows = [
      rosterNode({ node_id: 'Qm0000', state: 'reachable' }),
      rosterNode({ node_id: 'Qm0001', state: 'verified_unavailable' }),
      rosterNode({
        node_id: 'Qm0002',
        state: 'advertised_unverified',
        version: undefined,
        country: undefined,
        asn: undefined,
        last_reachable_ms: undefined,
      }),
    ];
    const t = inferredTopology(peers, seed, 'ckb:local', undefined, roster(rows));
    expect(sightedOf(t).map((n) => n.id)).toEqual(['Qm0000', 'Qm0001', 'Qm0002']);
    // The hearsay row rides through by reference with its absences intact:
    // nothing here fills a version or a reach clock the crawler never had.
    const hearsay = sightedOf(t).find((n) => n.id === 'Qm0002')!;
    expect(hearsay.sighted).toBe(rows[2]);
    expect(hearsay.sighted!.version).toBeUndefined();
    expect(hearsay.sighted!.last_reachable_ms).toBeUndefined();
  });

  // ⚠️ The gate is a SET of what can be drawn, never a list of exclusions:
  // a rung grown upstream is one nothing here has a mark for by definition, so
  // it must stay off stage until somebody draws one. Asking with a state this
  // build has never heard of is the only way to tell that gate from its
  // inverse — a `!== 'foreignNetwork'` filter passes every other test in this
  // file and stages the next rung upstream invents.
  it('leaves a rung it has no mark for off stage entirely', () => {
    const alien = {
      ...rosterNode({ node_id: 'Qm0001' }), state: 'quantum_entangled',
    } as unknown as RosterNode;
    const rows = [rosterNode({ node_id: 'Qm0000' }), alien];
    const t = inferredTopology(peers, seed, 'ckb:local', undefined, roster(rows));
    expect(sightedOf(t).map((n) => n.id)).toEqual(['Qm0000']);
    // Off stage rather than anonymous: nothing invents a ghost in its place,
    // so the row simply rides the record unstaged.
    expect(t.nodes.filter((n) => n.id === 'Qm0001')).toHaveLength(0);
    expect(STAGEABLE_ROSTER_STATES.has('quantum_entangled' as RosterNodeState)).toBe(false);
  });

  // ⭐ THE THIRD RUNG THINS THE FICTION, IT DOES NOT GROW THE COLONY. Staging
  // is prefix displacement — one real identity for one invented ghost — so
  // the population a viewer sees is the same before and after, with a larger
  // share of it true. A change that made hearsay ADD to the cloud instead would
  // pass every other assertion in this file.
  it('trading ghosts for hearsay keeps the colony exactly the same size', () => {
    const scatter = scatterInferred(seed);
    const verifiedOnly = roster(sightedRoster(20));
    const withHearsay = roster([
      ...sightedRoster(20),
      ...Array.from({ length: 60 }, (_, i) => rosterNode({
        node_id: `Qm9${String(i).padStart(3, '0')}`,
        state: 'advertised_unverified',
        version: undefined,
        country: undefined,
        asn: undefined,
        last_reachable_ms: undefined,
      })),
    ]);
    const before = inferredTopology(peers, seed, 'ckb:local', undefined, verifiedOnly);
    const after = inferredTopology(peers, seed, 'ckb:local', undefined, withHearsay);
    const population = (t: Topology) => ghostsOf(t).length + sightedOf(t).length;
    expect(population(before)).toBe(scatter.length);
    expect(population(after)).toBe(scatter.length);
    expect(sightedOf(after)).toHaveLength(80);
    expect(ghostsOf(after)).toHaveLength(ghostsOf(before).length - 60);
    // …and the ghosts that stayed are the same ghosts, standing where they
    // stood: displacement comes off the TAIL of the untouched scatter.
    ghostsOf(after).forEach((g, i) => {
      expect(g.id).toBe(`inf:${i}`);
      expect(g.pos).toEqual(scatter[i]);
    });
  });

  it('dedupe: measured wins, local is excluded, and a repeat is staged once', () => {
    const rows = [
      rosterNode({ node_id: 'A' }),          // already on stage as a measured peer
      rosterNode({ node_id: 'ckb:local' }),  // that is us
      ...sightedRoster(3),
      rosterNode({ node_id: 'Qm0001' }),     // a duplicate inside one roster
    ];
    const t = inferredTopology(peers, seed, 'ckb:local', undefined, roster(rows));
    expect(sightedOf(t).map((n) => n.id)).toEqual(['Qm0000', 'Qm0001', 'Qm0002']);
    expect(t.nodes.filter((n) => n.id === 'A')).toHaveLength(1);
    expect(t.nodes.find((n) => n.id === 'A')!.kind).toBe('measured');
    expect(t.nodes.filter((n) => n.id === 'ckb:local')).toHaveLength(1);
    expect(t.nodes.find((n) => n.id === 'ckb:local')!.kind).toBe('local');
  });

  // `ckb:local` is cknerv's server-local key, not a name the crawler speaks:
  // a roster row naming US carries our base58 p2p id. A publicly crawlable
  // cknerv node therefore finds ITSELF in the roster and — before
  // `localP2pId` — stood a sighted marker for itself, with a card saying we
  // have never spoken to it.
  it('excludes the local node under the p2p id the crawler files it by', () => {
    const localP2pId = 'QmSelf';
    const rows = [...sightedRoster(2), rosterNode({ node_id: localP2pId })];
    const t = inferredTopology(
      peers, seed, 'ckb:local', undefined, roster(rows), localP2pId,
    );
    expect(sightedOf(t).map((n) => n.id)).toEqual(['Qm0000', 'Qm0001']);
    expect(t.nodes.filter((n) => n.id === localP2pId)).toHaveLength(0);
  });

  // The other half of the pin: without the argument the same roster still
  // stages the row, so it is the parameter doing the work above and not the
  // `ckb:local` exclusion that was already there.
  it('stages that same row when no local p2p id is supplied', () => {
    const localP2pId = 'QmSelf';
    const rows = [...sightedRoster(2), rosterNode({ node_id: localP2pId })];
    const t = inferredTopology(peers, seed, 'ckb:local', undefined, roster(rows));
    expect(sightedOf(t).map((n) => n.id)).toEqual(['Qm0000', 'Qm0001', localP2pId]);
  });

  it('places a sighted node purely from its id — roster order and round cannot move it', () => {
    const rows = sightedRoster(6);
    const forward = inferredTopology(peers, seed, 'ckb:local', undefined, roster(rows));
    const reversed = inferredTopology(
      peers, seed, 'ckb:local', undefined,
      roster([...rows].reverse(), { crawl_round: 9, updated_at_ms: 42 }),
    );
    const placed = (t: Topology) => new Map(sightedOf(t).map((n) => [n.id, n.pos]));
    expect(placed(reversed)).toEqual(placed(forward));

    const one = forward.nodes.find((n) => n.id === rows[0].node_id)!;
    expect(one.pos).toEqual(sightedPos(rows[0].node_id));
    // angle is the measured belt's own id hash; radius sits inside the disc and
    // height inside the colony's shallow slab.
    const angle = peerAngle(rows[0].node_id);
    const x = one.pos[0] / COLONY_ELLIPSE_X;
    const z = one.pos[2] / COLONY_ELLIPSE_Z;
    expect(Math.atan2(z, x)).toBeCloseTo(Math.atan2(Math.sin(angle), Math.cos(angle)), 6);
    expect(Math.hypot(x, z)).toBeLessThanOrEqual(COLONY_RADIUS);
    expect(Math.abs(one.pos[1] - COLONY_Y)).toBeLessThanOrEqual(COLONY_Y_THICKNESS / 2);
  });

  it('angle and radius are drawn from different mixes (no id spiral)', () => {
    // Reusing peerAngle's stream for the radius would stand every sighted node
    // on one spiral arm; a shared hash shows up as correlation here.
    const ids = Array.from({ length: 400 }, (_, i) => `Qm${String(i).padStart(4, '0')}`);
    const angles = ids.map((id) => peerAngle(id));
    const radii01 = ids.map((id) => {
      const pos = sightedPos(id);
      const r = Math.hypot(pos[0] / COLONY_ELLIPSE_X, pos[2] / COLONY_ELLIPSE_Z) / COLONY_RADIUS;
      return r * r;  // undo the sqrt: this is the raw hash
    });
    const mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length;
    const ma = mean(angles);
    const mr = mean(radii01);
    let cov = 0, va = 0, vr = 0;
    for (let i = 0; i < ids.length; i++) {
      const da = angles[i] - ma, dr = radii01[i] - mr;
      cov += da * dr; va += da * da; vr += dr * dr;
    }
    expect(Math.abs(cov / Math.sqrt(va * vr))).toBeLessThan(0.15);
  });

  it('⭐ ghost fill is a prefix of the untouched scatter, and 256 leaves none', () => {
    const scatter = scatterInferred(seed);           // the seed's own target, never re-rolled
    expect(ghostsOf(inferredTopology(peers, seed, 'ckb:local'))).toHaveLength(scatter.length);

    const some = inferredTopology(peers, seed, 'ckb:local', undefined, roster(sightedRoster(40)));
    const kept = ghostsOf(some);
    expect(kept).toHaveLength(scatter.length - 40);  // one for one
    kept.forEach((g, i) => {
      expect(g.id).toBe(`inf:${i}`);                 // prefix, not a reshuffle
      expect(g.pos).toEqual(scatter[i]);             // and nobody moved
    });
    expect(kept.length + sightedOf(some).length).toBe(scatter.length);

    // At the 256 cap the ghosts are nearly spent (this seed's target is 264).
    const capped = inferredTopology(peers, seed, 'ckb:local', undefined, roster(sightedRoster(256)));
    expect(ghostsOf(capped)).toHaveLength(scatter.length - 256);
    expect(sightedOf(capped)).toHaveLength(256);

    // Past the target the ghosts run out and the cloud is all sighted: total
    // population is max(target, sightedCount), never the sum. The cap lives
    // upstream, so the derive simply tolerates a longer roster.
    const many = inferredTopology(peers, seed, 'ckb:local', undefined, roster(sightedRoster(300)));
    expect(ghostsOf(many)).toHaveLength(0);
    expect(sightedOf(many)).toHaveLength(300);
    expect(many.nodes).toHaveLength(300 + peers.length + 1);  // sighted + measured + local
  });

  it('no roster and a roster of nobody both yield exactly today’s topology', () => {
    const base = inferredTopology(peers, seed, 'ckb:local');
    // bust the single-slot scaffold cache so the comparisons below are genuine
    // rebuilds rather than the same objects handed back.
    inferredTopology(peers, seed, 'ckb:local', undefined, roster(sightedRoster(40)));

    for (const record of [null, roster([])]) {
      const t = inferredTopology(peers, seed, 'ckb:local', undefined, record);
      expect(t.nodes).toEqual(base.nodes);
      expect(t.edges).toEqual(base.edges);
      expect(sightedOf(t)).toHaveLength(0);
    }
  });

  it('emergent demotion: a dropped link reappears as its crawler ghost, in place', () => {
    const id = 'Qm0002';
    const rows = sightedRoster(5);
    const linked = inferredTopology(
      [...peers, peer({ node_id: id, latency_ms: 60 })], seed, 'ckb:local', undefined, roster(rows),
    );
    expect(linked.nodes.filter((n) => n.id === id)).toHaveLength(1);   // never two markers
    expect(linked.nodes.find((n) => n.id === id)!.kind).toBe('measured');

    const dropped = inferredTopology(peers, seed, 'ckb:local', undefined, roster(rows));
    const node = dropped.nodes.find((n) => n.id === id)!;
    expect(node.kind).toBe('sighted');
    expect(node.peer).toBeUndefined();
    expect(node.pos).toEqual(sightedPos(id));        // its hash place, waiting for it
  });

  it('every edge a sighted node carries stays inferred fiction', () => {
    const rows = sightedRoster(30);
    const t = inferredTopology(peers, seed, 'ckb:local', undefined, roster(rows));
    const ids = new Set(rows.map((r) => r.node_id));
    const touching = t.edges.filter((e) => ids.has(e.a) || ids.has(e.b));
    expect(touching.length).toBeGreaterThan(0);
    for (const e of touching) expect(e.kind).toBe('inferred');  // we never observed a link
    for (const id of ids) expect((t.adjacency.get(id) ?? []).length).toBeGreaterThan(0);
  });

  it('the flood reaches the sighted tier and relays through it', () => {
    const rows = sightedRoster(30);
    const t = inferredTopology(peers, seed, 'ckb:local', undefined, roster(rows));
    const cf = colonyFlood(t, 7);
    for (const r of rows) {
      expect(Number.isFinite(cf.colonyArrivalS[r.node_id])).toBe(true);
    }
    // …and they are not leaves-only: at least one sighted node passes the front on.
    const predecessors = new Set(Object.values(cf.colonyPredecessor));
    expect(rows.some((r) => predecessors.has(r.node_id))).toBe(true);
  });

  it('a fresh crawl round updates the staged rows without moving anybody', () => {
    const first = sightedRoster(8);
    const before = inferredTopology(peers, seed, 'ckb:local', undefined, roster(first));
    const second = sightedRoster(8, {
      state: 'verified_unavailable', last_reachable_ms: 9,
    });
    const after = inferredTopology(
      peers, seed, 'ckb:local', undefined, roster(second, { crawl_round: 2 }),
    );
    // The scaffold cache holds geometry, not the crawler's report: a node going
    // dark has to cross even though the id set (and the cache key) is unchanged.
    expect(
      sightedOf(after).every((n) => n.sighted!.state === 'verified_unavailable'),
    ).toBe(true);
    expect(sightedOf(before).every((n) => n.sighted!.state === 'reachable')).toBe(true);
    expect(sightedOf(after).map((n) => n.pos)).toEqual(sightedOf(before).map((n) => n.pos));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ATTESTED NODES — the rung whose existence is certain and whose identity is
// zero. Every key below is CONSTRUCTED. ⚠️ The live producer set drifts with
// the pools and the crawl drifts with the round, so nothing here pins a real
// hash or a real count.
// ─────────────────────────────────────────────────────────────────────────────

/** A lock-script-hash-shaped key: `0x` + 64 hex, the shape §5.2 emits.
 *
 *  `tag` is hex-encoded per character and zero-padded, which keeps distinct
 *  tags on distinct keys — a helper that quietly folded two tags together would
 *  make the placement tests below assert their own bug. */
function producerKey(tag: string): string {
  const encoded = [...tag].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
  return `0x${encoded.padEnd(64, '0').slice(0, 64)}`;
}

/** One producer's standing. `fan` is always withheld here: T5 never reads it,
 *  and a drawn fan would smuggle roster rows into a staging test that is
 *  supposed to prove staging cannot see them. */
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
    // T5 never reads the week either; a standing carries it, and staging is a
    // function of the key alone whether or not one is there.
    ledger: null,
    ...over,
  };
}

/** `n` producers on distinct constructed keys. */
function standings(n: number, over: Partial<ProducerStanding> = {}): ProducerStanding[] {
  return Array.from({ length: n }, (_, i) => standing({
    key: producerKey('0123456789abcdef'[i % 16] + String(i)),
    ...over,
  }));
}

describe('attestedPos (⭐ pure hash of the producer key, and never a centroid)', () => {
  const keys = Array.from({ length: 400 }, (_, i) => producerKey(
    `${'0123456789abcdef'[i % 16]}${'0123456789abcdef'[(i * 7) % 16]}${i}`,
  ));

  it('stands inside the same elliptical disc as everybody else', () => {
    for (const key of keys.slice(0, 60)) {
      const pos = attestedPos(key);
      const x = pos[0] / COLONY_ELLIPSE_X;
      const z = pos[2] / COLONY_ELLIPSE_Z;
      expect(Math.hypot(x, z)).toBeLessThanOrEqual(COLONY_RADIUS);
    }
    // The height is not "inside the slab", it is exactly the plane — pinned on
    // its own below, because that is a claim about the mark's form and not
    // about the disc this tier shares with the others.
  });

  // ⭐⭐ THE PLANE IS THE POINT. The mark is a disc LYING IN the colony plane,
  // and what makes that disc state the plane is that every cohort foreshortens
  // identically; a private height per cohort turns the agreement into six
  // unrelated ellipses. Under the plane the same constant carries the intake:
  // one mist floor at a fixed depth below the membrane cannot sit a fixed depth
  // below six different heights. So this is exact equality on purpose — a
  // tolerance here would let a height stream creep back in unnoticed.
  it('lies exactly in the colony plane, for every key', () => {
    for (const key of keys) expect(attestedPos(key)[1]).toBe(COLONY_Y);
    expect(new Set(keys.map((k) => attestedPos(k)[1])).size).toBe(1);
  });

  it('is a pure function of the key — stable, and blind to everything else', () => {
    const key = producerKey('ab');
    expect(attestedPos(key)).toEqual(attestedPos(key));
    expect(attestedPos(key)).not.toEqual(attestedPos(producerKey('ac')));
  });

  // ⭐ THE PLACEMENT IS MUTE. §2.4 rejected standing a narrowed producer at the
  // centroid of its candidates: a centroid moves when the crawl round changes,
  // which is the one invariant every id-hashed node in this file holds, and
  // standing a producer among its suspects is a soft spatial accusation. So the
  // only input is the key — not the fan, not the share, not the window.
  it('the window rolling and the fan changing move a producer nowhere', () => {
    const key = producerKey('be');
    const fresh = standing({ key, blocks: 1, windowBlocks: 1 });
    const rolled = standing({
      key,
      blocks: 137,
      windowBlocks: 240,
      lastSeenMs: 1_900_000_000_000,
      message: 'something else entirely',
      fan: {
        drawn: true,
        matchedVersion: '0.209.0 (aaaaaaa 2026-07-30)',
        candidates: [rosterNode({ node_id: 'Qm0000' }), rosterNode({ node_id: 'Qm0001' })],
        shareOfVersioned: 0.1,
      },
    });
    expect(stageAttested([rolled])[0].pos).toEqual(stageAttested([fresh])[0].pos);
    expect(stageAttested([rolled])[0].pos).toEqual(attestedPos(key));
  });

  // The sighted tier's own spiral test, run against the hex-shaped keys this
  // tier actually receives: a fixed `0x` behind 64 symbols out of an alphabet
  // of 16 is a much narrower input than a base58 peer id, so the decorrelation
  // has to be shown here rather than inherited.
  //
  // ⭐ TWO DRAWS, NOT THREE. This used to carry a height stream and correlate
  // all three pairs. The height is gone (the test above says where it went), so
  // the only correlation left to refute is the one this test was written for:
  // an angle and a radius off the same hash would stand every producer on one
  // spiral arm.
  it('angle and radius are two uncorrelated draws (no key spiral)', () => {
    const angleOf = (key: string) => {
      const pos = attestedPos(key);
      return Math.atan2(pos[2] / COLONY_ELLIPSE_Z, pos[0] / COLONY_ELLIPSE_X);
    };
    const radiusOf = (key: string) => {
      const pos = attestedPos(key);
      const r = Math.hypot(pos[0] / COLONY_ELLIPSE_X, pos[2] / COLONY_ELLIPSE_Z) / COLONY_RADIUS;
      return r * r;              // undo the sqrt: this is the raw hash
    };
    const corr = (xs: number[], ys: number[]) => {
      const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
      const mx = mean(xs), my = mean(ys);
      let c = 0, vx = 0, vy = 0;
      for (let i = 0; i < xs.length; i += 1) {
        const dx = xs[i] - mx, dy = ys[i] - my;
        c += dx * dy; vx += dx * dx; vy += dy * dy;
      }
      return Math.abs(c / Math.sqrt(vx * vy));
    };
    const angles = keys.map(angleOf);
    const radii = keys.map(radiusOf);
    expect(corr(angles, radii)).toBeLessThan(0.15);
    // …and distinct keys land on distinct places rather than piling up — which
    // now rests on the two XZ draws alone, since the height no longer separates
    // anything.
    expect(new Set(keys.map((k) => attestedPos(k).join(','))).size).toBe(keys.length);
  });

  // Its own mixes, not the sighted tier's. Sharing them would look identical in
  // every test above and would tie a producer's place to how the crawler's tier
  // happens to be tuned — so ask the one question that can tell them apart.
  it('does not borrow the sighted tier’s placement function', () => {
    const shared = producerKey('cd');
    expect(attestedPos(shared)).not.toEqual(sightedPos(shared));
  });
});

describe('stageAttested (⭐ one node per producer, always anonymous)', () => {
  it('stands one node per producer, in the order the producer derive sent them', () => {
    const producers = standings(4);
    const staged = stageAttested(producers);
    expect(staged).toHaveLength(4);
    expect(staged.map((n) => n.id)).toEqual(producers.map((p) => attestedNodeId(p.key)));
    staged.forEach((node, i) => {
      expect(node.kind).toBe('attested');
      expect(node.pos).toEqual(attestedPos(producers[i].key));
      // the standing by reference — a copy would print a stale share beside a
      // live window on the very next block.
      expect(node.attested).toBe(producers[i]);
    });
  });

  it('no producers at all is not an empty tier but no tier', () => {
    expect(stageAttested()).toEqual([]);
    expect(stageAttested(null)).toEqual([]);
    expect(stageAttested([])).toEqual([]);
  });

  // §9.1, STRUCTURALLY. The guarantee is not that this file remembers to leave
  // an identity out — it is that `ProducerStanding` has no field one could land
  // in, and that the node carries nothing beside it. Pin the whole key set, so
  // a later edit that adds `node_id`/`addr`/`country`/`asn`/`version` to either
  // shape has to come through this test to do it.
  it('⭐ an attested node carries no id, address, country, ASN or version', () => {
    const [node] = stageAttested(standings(1));
    expect(Object.keys(node).sort()).toEqual(['attested', 'id', 'kind', 'pos']);
    expect(node.peer).toBeUndefined();
    expect(node.sighted).toBeUndefined();
    expect(Object.keys(node.attested!).sort()).toEqual([
      'blocks', 'fan', 'key', 'ledger', 'lastSeenMs', 'message', 'role', 'share',
      'windowBlocks',
    ].sort());
    const identityish = /node_id|addr|country|asn|version|host|ip|peer/i;
    for (const field of Object.keys(node.attested!)) expect(field).not.toMatch(identityish);
    // ⚠️ `ledger` came through this test, which is what it is for. What it
    // adds is the indexer's WEEK on the same payout identity — blocks, a
    // share, a balance — and one name that would trip the regex above if it
    // were run one level down: `address`. That is a `ckb1…` PAYOUT address,
    // which is the identity `key` already is, rendered under a network prefix;
    // it is not `RosterNode.addr`, which is a machine on the internet. §9.1 is
    // about the second kind, and the shape of the first is pinned where it is
    // built (`__tests__/derives/blockProducers.derive.test.ts`).
    expect(node.attested!.ledger).toBeNull();
    // and the graph id is the payout key under a namespace, never a peer name
    expect(node.id).toBe(`${ATTESTED_ID_PREFIX}${node.attested!.key}`);
  });

  // §9.8's shape: a producer with no key does not stage. `deriveBlockProducers`
  // already refuses a whole window carrying one — blocks with nobody behind
  // them are an unanswered question, not a producer we may not draw — so this
  // is the second lock rather than the first.
  it('a keyless producer does not stage, and a repeated key stages once', () => {
    const staged = stageAttested([
      standing({ key: '' }),
      standing({ key: producerKey('aa') }),
      standing({ key: producerKey('aa'), blocks: 3 }),
    ]);
    expect(staged.map((n) => n.id)).toEqual([attestedNodeId(producerKey('aa'))]);
    expect(staged[0].attested!.blocks).toBe(10);      // the first row wins
  });

  // ⭐ NO MEASURED-WINS, DELIBERATELY. `stageSighted` drops a roster row we
  // already hold a link to because both markers would be the SAME node. A
  // producer and a peer are never known to be the same node — that is the whole
  // §2.6 double-count — so folding them would make the accusation this tier
  // exists to avoid, and would make it by deleting a producer the chain proved
  // exists. A key and a base58 id cannot collide in the field; ask anyway, so
  // the rule is pinned rather than merely unexercised.
  it('never folds a producer onto a peer, even one wearing the same string', () => {
    const shared = producerKey('ff');
    const t = inferredTopology(
      [peer({ node_id: shared, latency_ms: 40 })], 0xc0ffee, 'ckb:local', undefined,
      roster([rosterNode({ node_id: shared })]), undefined,
      [standing({ key: shared })],
    );
    const wearing = t.nodes.filter((n) => n.id === shared || n.id === attestedNodeId(shared));
    expect(wearing.map((n) => n.kind).sort()).toEqual(['attested', 'measured']);
    // the namespace is what keeps the graph's keying safe under that collision
    expect(new Set(t.nodes.map((n) => n.id)).size).toBe(t.nodes.length);
  });
});

/** XZ distance from `p` to the nearest cohort centre — the metric the keep-out
 *  is written in, because a cohort is a hole a viewer aims INTO and the hole
 *  lies in the colony plane. `Infinity` when no cohort is standing. */
function nearestDisc(p: Vec3, discs: readonly Vec3[]): number {
  let best = Infinity;
  for (const c of discs) best = Math.min(best, Math.hypot(p[0] - c[0], p[2] - c[2]));
  return best;
}

/**
 * Six producers, the first of which stands ON the given point.
 *
 * A cohort's mark is a pure hash of its payout key, so the way to put one on a
 * fixed point is to look for a key that lands there. At a 3.5 wu keep-out over
 * a 92 wu elliptical disc that is about one key in seven hundred, so a few
 * thousand tries always finds one and the search is deterministic.
 *
 * The peer used to be the free end of this fixture (the belt hung off a
 * `localPos` the test could choose); it is not free any more — the belt is
 * about the axis and a peer's mark is its latency and its id. So the COHORT
 * moved to the peer.
 */
function cohortOnTheBelt(at: Vec3): ProducerStanding[] {
  for (let i = 0; i < 40_000; i += 1) {
    const key = producerKey(`belt${i}`);
    if (nearestDisc(at, [attestedPos(key)]) < COHORT_KEEP_OUT_R - 0.25) {
      return [standing({ key }), ...sixProducersFor('onbelt').slice(0, 5)];
    }
  }
  throw new Error('no producer key lands on the belt');
}

/** Six ordinary producers under one tag. (`sixProducers` inside the T5 block
 *  is the same shape; this is the file-level twin the fixture above needs.) */
function sixProducersFor(tag: string): ProducerStanding[] {
  return Array.from({ length: 6 }, (_, i) => standing({ key: producerKey(`${tag}m${i}`) }));
}

/** Whether a point already stands clear of every cohort's keep-out disc. */
function clearOfEvery(p: Vec3, discs: readonly Vec3[]): boolean {
  return nearestDisc(p, discs) >= COHORT_KEEP_OUT_R - 1e-9;
}

describe('attested nodes in the colony (⭐ ghost displacement, one for one)', () => {
  const seed = 0xc0ffee;
  const peers = [
    peer({ node_id: 'A', latency_ms: 40, direction: 'outbound' }),
    peer({ node_id: 'B', latency_ms: 180, direction: 'inbound' }),
  ];
  type Topology = ReturnType<typeof inferredTopology>;
  const ghostsOf = (t: Topology) => t.nodes.filter((n) => n.kind === 'inferred');
  const sightedOf = (t: Topology) => t.nodes.filter((n) => n.kind === 'sighted');
  const attestedOf = (t: Topology) => t.nodes.filter((n) => n.kind === 'attested');

  /** Every edge endpoint is a node that is actually standing. The one oracle
   *  that catches a scaffold cache hitting when it must not: the tails are
   *  re-staged live while the cached EDGES are not, so a wrong hit surfaces
   *  here as an edge pointing at an id nobody wears. */
  const expectEdgesClosed = (t: Topology) => {
    const ids = new Set(t.nodes.map((n) => n.id));
    for (const e of t.edges) {
      expect(ids.has(e.a)).toBe(true);
      expect(ids.has(e.b)).toBe(true);
    }
  };

  // §9.4. A fiction is replaced by a certainty; the colony does not inflate.
  it('⭐ staging producers displaces ghosts one for one and grows nothing', () => {
    const scatter = scatterInferred(seed);
    const before = inferredTopology(peers, seed, 'ckb:local', undefined, roster(sightedRoster(20)));
    const after = inferredTopology(
      peers, seed, 'ckb:local', undefined, roster(sightedRoster(20)), undefined, standings(6),
    );
    const population = (t: Topology) => ghostsOf(t).length + sightedOf(t).length + attestedOf(t).length;
    expect(population(before)).toBe(scatter.length);
    expect(population(after)).toBe(scatter.length);
    expect(attestedOf(after)).toHaveLength(6);
    expect(ghostsOf(after)).toHaveLength(ghostsOf(before).length - 6);
    expect(after.nodes).toHaveLength(before.nodes.length);   // total colony count unchanged
  });

  // §9.5, the half that is easy to lose: the ghosts that stay are the SAME
  // ghosts, standing where they stood. Displacement comes off the tail of an
  // untouched seed-pure scatter — nothing is re-rolled or re-parameterized.
  //
  // ⚠️ THIS TEST ONCE SAID "no ghost moves" FULL STOP, and since the cohorts'
  // keep-out that sentence is false — deliberately, and in exactly one way. A
  // cohort is a HOLE in the membrane and the hole has to be empty, so a ghost
  // the disc `COHORT_KEEP_OUT_R` opens over steps aside to the circle at its
  // own height. Every ghost outside every disc is still byte-identical to the
  // seed-pure scatter, which is the claim the ⭐ churn-stability invariant
  // actually needs: the scatter is untouched and cached, and what moves a ghost
  // is a producer KEY appearing — never a peer (pinned on its own below).
  it('⭐ a ghost moves only where a cohort opens over it, and never otherwise', () => {
    const scatter = scatterInferred(seed);
    const rows = roster(sightedRoster(12));
    const none = inferredTopology(peers, seed, 'ckb:local', undefined, rows);
    const three = inferredTopology(peers, seed, 'ckb:local', undefined, rows, undefined, standings(3));
    const two = inferredTopology(peers, seed, 'ckb:local', undefined, rows, undefined, standings(2));
    for (const t of [none, three, two]) {
      const discs = attestedOf(t).map((n) => n.pos);
      ghostsOf(t).forEach((g, i) => {
        expect(g.id).toBe(`inf:${i}`);
        if (clearOfEvery(scatter[i], discs)) {
          expect(g.pos).toEqual(scatter[i]);      // byte-identical, as it always was
          return;
        }
        expect(g.pos[1]).toBe(scatter[i][1]);      // the height is carried, never redrawn
        expect(nearestDisc(g.pos, discs)).toBeGreaterThanOrEqual(COHORT_KEEP_OUT_R - 1e-9);
      });
      expectEdgesClosed(t);
    }
    // With no producers there is no disc, so this is the old assertion intact.
    expect(attestedOf(none)).toHaveLength(0);
    ghostsOf(none).forEach((g, i) => expect(g.pos).toEqual(scatter[i]));
    expect(ghostsOf(three)).toHaveLength(ghostsOf(none).length - 3);
    expect(ghostsOf(two)).toHaveLength(ghostsOf(none).length - 2);
  });

  // Sighted and attested subtract from the same tail, additively — neither tier
  // is a special case of the other and neither double-spends a ghost.
  it('both tails come off one scatter, and past the end the ghosts simply run out', () => {
    const scatter = scatterInferred(seed);
    const t = inferredTopology(
      peers, seed, 'ckb:local', undefined, roster(sightedRoster(40)), undefined, standings(10),
    );
    expect(ghostsOf(t)).toHaveLength(scatter.length - 50);

    const overflowing = inferredTopology(
      peers, seed, 'ckb:local', undefined, roster(sightedRoster(scatter.length)), undefined, standings(5),
    );
    expect(ghostsOf(overflowing)).toHaveLength(0);
    expect(attestedOf(overflowing)).toHaveLength(5);
    expectEdgesClosed(overflowing);
  });

  // The producer tail is appended LAST, so with no producers every index in the
  // node array is exactly where it has always been. Absent, null and empty are
  // one path rather than three.
  it('no producers yields exactly today’s topology, node for node and edge for edge', () => {
    const rows = roster(sightedRoster(15));
    const base = inferredTopology(peers, seed, 'ckb:local', undefined, rows);
    // bust the single-slot memo so the comparisons below are genuine rebuilds
    inferredTopology(peers, seed, 'ckb:local', undefined, rows, undefined, standings(4));
    for (const producers of [undefined, null, []]) {
      const t = inferredTopology(peers, seed, 'ckb:local', undefined, rows, undefined, producers);
      expect(t.nodes).toEqual(base.nodes);
      expect(t.edges).toEqual(base.edges);
      expect(attestedOf(t)).toHaveLength(0);
    }
  });

  // ⭐ THE MEMO IS KEYED ON KEYS, NOT ON STANDINGS. A producer's blocks, share
  // and fan move on every block while its key does not, so a key that read the
  // standings would miss once a block and re-derive the O(V² log V) geometry
  // because a numerator moved. Object identity of the cached ghost objects is
  // the oracle: same objects means the scaffold was reused.
  it('re-tallying a producer crosses without rebuilding the scaffold', () => {
    const rows = roster(sightedRoster(9));
    const keys = standings(3).map((p) => p.key);
    const first = inferredTopology(
      peers, seed, 'ckb:local', undefined, rows, undefined,
      keys.map((key) => standing({ key, blocks: 4, windowBlocks: 12 })),
    );
    const retallied = inferredTopology(
      peers, seed, 'ckb:local', undefined, rows, undefined,
      keys.map((key, i) => standing({ key, blocks: 1 + i, windowBlocks: 6 })),
    );
    const a = ghostsOf(first), b = ghostsOf(retallied);
    expect(b).toHaveLength(a.length);
    for (let i = 0; i < a.length; i += 1) expect(b[i]).toBe(a[i]);   // same objects
    // …while the live tally genuinely crossed, exactly as a fresh crawl round does
    expect(attestedOf(retallied).map((n) => n.attested!.blocks)).toEqual([1, 2, 3]);
    expect(attestedOf(first).map((n) => n.attested!.blocks)).toEqual([4, 4, 4]);
    expect(attestedOf(retallied).map((n) => n.pos)).toEqual(attestedOf(first).map((n) => n.pos));
  });

  // The other half of the memo: a changed producer SET has to miss. Keyed on
  // the sighted ids alone it would hit, hand back a scaffold with the wrong
  // ghost count, and wire edges to ids nobody wears.
  it('a changed producer set rebuilds even when the roster is identical', () => {
    const rows = roster(sightedRoster(9));
    const three = inferredTopology(peers, seed, 'ckb:local', undefined, rows, undefined, standings(3));
    const ghostsThree = ghostsOf(three).length;
    const four = inferredTopology(peers, seed, 'ckb:local', undefined, rows, undefined, standings(4));
    expect(ghostsOf(four)).toHaveLength(ghostsThree - 1);
    expect(attestedOf(four)).toHaveLength(4);
    expectEdgesClosed(four);
    // and back the other way, through the same single slot
    const backToThree = inferredTopology(peers, seed, 'ckb:local', undefined, rows, undefined, standings(3));
    expect(ghostsOf(backToThree)).toHaveLength(ghostsThree);
    expectEdgesClosed(backToThree);
  });

  // A matrix walked through the SINGLE-SLOT memo, asserting the one property a
  // wrong hit always breaks. Cheaper than enumerating the ways a key can be
  // wrong, and it does not care which way it was wrong.
  it('every combination of the two tails leaves the graph closed', () => {
    for (const sightedCount of [0, 5, 20]) {
      for (const producerCount of [0, 1, 6]) {
        const t = inferredTopology(
          peers, seed, 'ckb:local', undefined,
          sightedCount === 0 ? null : roster(sightedRoster(sightedCount)),
          undefined,
          producerCount === 0 ? undefined : standings(producerCount),
        );
        expect(sightedOf(t)).toHaveLength(sightedCount);
        expect(attestedOf(t)).toHaveLength(producerCount);
        expectEdgesClosed(t);
      }
    }
  });

  // The chain says something made a block. It never says who that something
  // talks to — so an attested node's edges are the identical declared fiction a
  // ghost's are, and inventing an edge kind for the chain's certainty would put
  // that certainty on links nothing observed.
  it('every edge an attested node carries stays inferred fiction', () => {
    const producers = standings(8);
    const t = inferredTopology(
      peers, seed, 'ckb:local', undefined, roster(sightedRoster(20)), undefined, producers,
    );
    const ids = new Set(producers.map((p) => attestedNodeId(p.key)));
    const touching = t.edges.filter((e) => ids.has(e.a) || ids.has(e.b));
    expect(touching.length).toBeGreaterThan(0);
    for (const e of touching) expect(e.kind).toBe('inferred');
    for (const id of ids) expect((t.adjacency.get(id) ?? []).length).toBeGreaterThan(0);
  });

  it('the flood reaches the attested tier and relays through it', () => {
    const producers = standings(10);
    const t = inferredTopology(
      peers, seed, 'ckb:local', undefined, roster(sightedRoster(20)), undefined, producers,
    );
    const cf = colonyFlood(t, 7);
    for (const p of producers) {
      expect(Number.isFinite(cf.colonyArrivalS[attestedNodeId(p.key)])).toBe(true);
    }
    const predecessors = new Set(Object.values(cf.colonyPredecessor));
    expect(producers.some((p) => predecessors.has(attestedNodeId(p.key)))).toBe(true);
  });

  // ⭐ THE PAYLOAD BELONGS TO EXACTLY ONE RUNG, and this is the derive's half
  // of that. Widening `NodeKind` broke no switch — every consumer in the scene
  // opted IN by literal rather than switching exhaustively — so the compiler
  // never asked what an attested node looks like, and for one commit nothing
  // painted the rung at all. `DRAW_BY_NODE_KIND` in `ColonyNodes` is the gate
  // that now asks; what stays here is the question that gate cannot answer,
  // which is whether the standing ever lands on a node of another kind.
  it('carries its standing on its own rung and on no other tier’s', () => {
    const t = inferredTopology(
      peers, seed, 'ckb:local', undefined, roster(sightedRoster(20)), undefined, standings(6),
    );
    const staged = attestedOf(t);
    expect(staged).toHaveLength(6);
    for (const bucket of ['local', 'measured', 'inferred', 'sighted'] as const) {
      for (const node of t.nodes.filter((n) => n.kind === bucket)) {
        expect(node.attested).toBeUndefined();
      }
    }
    for (const node of staged) {
      expect(node.id.startsWith('inf:')).toBe(false);
      expect(node.sighted).toBeUndefined();
    }
  });

  // The seam with the producer derive: what it hands over stages verbatim,
  // including its order, and a window that does not add up stages nothing
  // because there is no view to stage from.
  const wire = (key: string, blocks: number): BlockProducer => (
    { key, message: '0.209.0 (aaaaaaa 2026-07-30)', blocks, last_seen_ms: 1_700_000_000_000 }
  );
  const chainOf = (rows: BlockProducer[]): ChainEntry => ({
    ...emptyChainCache(),
    producers: rows,
    producer_window: rows.flatMap((p, i) => Array<number>(p.blocks).fill(i)),
    producer_window_blocks: rows.reduce((sum, p) => sum + p.blocks, 0),
  });

  it('stages the producer derive’s STAGING view, in its own order', () => {
    // The tallies are deliberately the wrong way round for the key order: the
    // 9-block producer sorts LAST here, so a build that had followed the shares
    // would stand the tier in the other order and this would catch it.
    const chain = chainOf([wire(producerKey('bb'), 9), wire(producerKey('aa'), 3)]);
    const view = deriveBlockProducers(chain, null)!;
    expect(view).not.toBeNull();
    const t = inferredTopology(
      peers, seed, 'ckb:local', undefined, null, undefined, view.staging,
    );
    // Key ascending, whatever the wire sent and whatever the window says.
    expect(attestedOf(t).map((n) => n.attested!.key)).toEqual([producerKey('aa'), producerKey('bb')]);
    expect(attestedOf(t).map((n) => n.attested!.blocks)).toEqual([3, 9]);
    // …while the reading order is the other one, on the same standings.
    expect(view.ranked.map((p) => p.key)).toEqual([producerKey('bb'), producerKey('aa')]);

    // A window that contradicts itself yields no view at all — and a scene
    // handed `null` stands no producers rather than shares of a wrong whole.
    const broken = deriveBlockProducers({ ...chain, producer_window_blocks: 11 }, null);
    expect(broken).toBeNull();
    expect(attestedOf(inferredTopology(
      peers, seed, 'ckb:local', undefined, null, undefined, broken?.staging,
    ))).toHaveLength(0);
  });

  // ⚠️⚠️ THE SCAFFOLD MEMO IS THE THING THIS ORDER EXISTS TO PROTECT, so the
  // assertion is on the cache and not on a proxy for it. `inferredScaffold` is
  // a single slot keyed on the two staged tails' id SEQUENCES, and it owns the
  // O(V² log V) half of the build — the rejection scatter and a kNN sort per
  // node. Its hit is observable exactly once: the ghost nodes and the scaffold
  // edges are handed back BY REFERENCE, while both tails are re-staged fresh
  // every call. Two miners trading rank must not cost that rebuild.
  it('⭐ a rank swap between two miners reuses the cached scaffold', () => {
    const before = deriveBlockProducers(
      chainOf([wire(producerKey('aa'), 5), wire(producerKey('bb'), 4)]), null,
    )!;
    const after = deriveBlockProducers(
      chainOf([wire(producerKey('aa'), 4), wire(producerKey('bb'), 5)]), null,
    )!;
    expect(before.ranked[0].key).not.toBe(after.ranked[0].key); // the swap is real
    const build = (view: typeof before) => inferredTopology(
      peers, seed, 'ckb:local', undefined, null, undefined, view.staging,
    );
    const first = build(before);
    const second = build(after);
    const ghost = (t: typeof first) => t.nodes.filter((n) => n.kind === 'inferred');
    // Identity, not equality: an equal-looking ghost would prove the build is
    // deterministic and say nothing about whether it ran again.
    expect(ghost(second)[0]).toBe(ghost(first)[0]);
    expect(second.edges[0]).toBe(first.edges[0]);
    expect(second.nodes.map((n) => n.id)).toEqual(first.nodes.map((n) => n.id));
    // …and the live tally still crossed into the tier that was reused.
    expect(attestedOf(second).map((n) => n.attested!.blocks)).toEqual([4, 5]);
    expect(attestedOf(first).map((n) => n.attested!.blocks)).toEqual([5, 4]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE COHORTS' KEEP-OUT — a cohort is a HOLE in the membrane, and the hole has
// to be empty. Live on 2026-09-02 (T6) the six cohorts' nearest non-cohort
// neighbours stood at 1.274 / 2.355 / 4.602 / 5.337 / 7.794 / 8.247 wu: the
// nearest was a clickable sighted peer INSIDE the drawn hole (1.6) and inside
// the cohort's own pick sphere (1.5), the hover there named the cohort while
// the click opened the peer, and one cohort's own hole opened its neighbour's
// card from one of two camera azimuths. These pin the placement that makes all
// of that impossible — and pin what it is NOT allowed to disturb.
// ─────────────────────────────────────────────────────────────────────────────
describe('the cohorts’ keep-out (⭐ nobody stands in the hole)', () => {
  const rows = roster([
    ...sightedRoster(10),
    ...sightedRoster(8, { state: 'verified_unavailable' }).map((r) => ({ ...r, node_id: `${r.node_id}u` })),
    ...sightedRoster(8, { state: 'advertised_unverified' }).map((r) => ({ ...r, node_id: `${r.node_id}a` })),
  ]);
  const twoPeers = [
    peer({ node_id: 'A', latency_ms: 40, direction: 'outbound' }),
    peer({ node_id: 'B', latency_ms: 180, direction: 'inbound' }),
  ];
  /** Six producers whose keys are a function of `tag` alone — the live count. */
  const sixProducers = (tag: string) => Array.from({ length: 6 }, (_, i) => standing({
    key: producerKey(`${tag}m${i}`),
  }));

  // The sweep the plan asked for, run on the pure function so it can afford all
  // 240 ghosts and 160 sighted placements at 40 different seeds. The wiring
  // that carries it into a real colony is the test after this one.
  it('⭐ over 40 seeds no ghost and no sighted placement stands inside a disc', () => {
    let moved = 0;
    let total = 0;
    let minClear = Infinity;
    let overlappingPairs = 0;
    for (let seed = 1; seed <= 40; seed += 1) {
      const discs = sixProducers(seed.toString(16)).map((p) => attestedPos(p.key));
      for (let i = 0; i < discs.length; i += 1) {
        for (let j = i + 1; j < discs.length; j += 1) {
          if (nearestDisc(discs[i], [discs[j]]) < 2 * COHORT_KEEP_OUT_R) overlappingPairs += 1;
        }
      }
      const ghosts = scatterInferred(seed);
      // ⭐ THE CLOUD ITSELF IS UNTOUCHED. The keep-out is applied where the
      // scatter becomes staged nodes, never inside `scatterInferred`, so the
      // rejection sampler still accepts exactly what T1 measured (210–268).
      expect(ghosts.length).toBeGreaterThanOrEqual(210);
      expect(ghosts.length).toBeLessThanOrEqual(268);
      const placements: [Vec3, string][] = ghosts.map((p, n) => [p, `inf:${n}`]);
      for (let k = 0; k < 160; k += 1) {
        const id = `Qm${seed}s${k}`;
        placements.push([sightedPos(id), id]);
      }
      for (const [p, id] of placements) {
        total += 1;
        const out = cohortKeepOutPos(p, id, discs);
        if (out !== p) {
          moved += 1;
          // ⭐ EXACTLY ON THE CIRCLE, every time: a node is pushed to the rim of
          // the disc that took it and stands outside every other, so the
          // NEAREST disc of a displaced node is always the keep-out radius.
          expect(nearestDisc(out, discs)).toBeCloseTo(COHORT_KEEP_OUT_R, 9);
        }
        minClear = Math.min(minClear, nearestDisc(out, discs));
      }
    }
    expect(minClear).toBeGreaterThanOrEqual(COHORT_KEEP_OUT_R - 1e-9);
    // Measured 2026-09-02: 89 of 15 911 placements move (0.56 %) and 3 of the
    // 600 centre pairs overlap. Bounded loosely on purpose — these are facts
    // about a hash over constructed keys, not a contract anybody may rely on.
    expect(moved).toBeGreaterThan(0);
    expect(moved / total).toBeLessThan(0.05);
    expect(overlappingPairs).toBeGreaterThan(0);
  });

  it('⭐ the assembled colony comes out clear — ghosts, sighted, remembered and advertised alike', () => {
    for (const tag of ['aa', 'bb', 'cc', 'dd']) {
      const t = inferredTopology(
        twoPeers, 0xc0ffee, 'ckb:local', undefined, rows, undefined, sixProducers(tag),
      );
      const discs = t.nodes.filter((n) => n.kind === 'attested').map((n) => n.pos);
      expect(discs).toHaveLength(6);
      const staged = t.nodes.filter((n) => n.kind === 'inferred' || n.kind === 'sighted');
      expect(staged.length).toBeGreaterThan(200);
      for (const n of staged) {
        expect(nearestDisc(n.pos, discs)).toBeGreaterThanOrEqual(COHORT_KEEP_OUT_R - 1e-9);
      }
      // Every rung the crawler reports is in there, so "advertised" is covered
      // by name and not by the fact that it happens to stage as `sighted`.
      const states = new Set(t.nodes.filter((n) => n.kind === 'sighted').map((n) => n.sighted!.state));
      expect(states).toEqual(new Set(['reachable', 'verified_unavailable', 'advertised_unverified']));
    }
  });

  it('⭐ a node the discs do not cover is byte-identical with and without producers', () => {
    let touched = 0;
    for (const tag of ['aa', 'bb', 'cc', 'dd', 'ee', 'ff']) {
      const bare = inferredTopology(twoPeers, 0xc0ffee, 'ckb:local', undefined, rows);
      const withCohorts = inferredTopology(
        twoPeers, 0xc0ffee, 'ckb:local', undefined, rows, undefined, sixProducers(tag),
      );
      const discs = withCohorts.nodes.filter((n) => n.kind === 'attested').map((n) => n.pos);
      const before = new Map(bare.nodes.map((n) => [n.id, n.pos] as const));
      for (const n of withCohorts.nodes) {
        // The staged tiers only: `local` and `measured` are deliberately outside
        // the keep-out and have their own test below.
        if (n.kind !== 'inferred' && n.kind !== 'sighted') continue;
        const was = before.get(n.id);
        if (!was) continue;                      // a ghost the tail cut, not a move
        if (clearOfEvery(was, discs)) {
          expect(n.pos).toEqual(was);            // untouched, to the last bit
          continue;
        }
        touched += 1;
        expect(n.pos[1]).toBe(was[1]);           // ⭐ the height is carried, never redrawn
        expect(nearestDisc(n.pos, discs)).toBeCloseTo(COHORT_KEEP_OUT_R, 9);
      }
    }
    // The test would pass vacuously if no disc ever covered anybody.
    expect(touched).toBeGreaterThan(0);
  });

  // ⭐ THE ANSWER IS A FUNCTION OF THE PRODUCER SET, NEVER OF ITS SEQUENCE.
  // Everything else in this file is order-sensitive on purpose — the node
  // array, the scaffold's cache key, the long-range rng — so a displacement
  // that read the list's order would be a placement that moved when two miners
  // swapped rank. The tie between two equally deep discs is broken on their
  // coordinates for exactly this reason.
  it('⭐ the displacement is blind to the order the producers arrive in', () => {
    const producers = sixProducers('zz');
    const posById = (t: ReturnType<typeof inferredTopology>) => new Map(
      t.nodes.map((n) => [n.id, n.pos] as const),
    );
    const forward = posById(inferredTopology(
      twoPeers, 0xbeef, 'ckb:local', undefined, rows, undefined, producers,
    ));
    for (const order of [[...producers].reverse(), [producers[3], ...producers.filter((_, i) => i !== 3)]]) {
      const other = posById(inferredTopology(
        twoPeers, 0xbeef, 'ckb:local', undefined, rows, undefined, order,
      ));
      expect([...other.keys()].sort()).toEqual([...forward.keys()].sort());
      for (const [id, pos] of forward) expect(other.get(id)).toEqual(pos);
    }
  });

  it('steps straight out, keeps its height, and hands a clear node back untouched', () => {
    const c: Vec3 = [10, COLONY_Y, -4];
    const inside: Vec3 = [10.4, 19.5, -4.3];
    const out = cohortKeepOutPos(inside, 'QmSomebody', [c]);
    expect(out[1]).toBe(19.5);
    expect(Math.hypot(out[0] - c[0], out[2] - c[2])).toBeCloseTo(COHORT_KEEP_OUT_R, 12);
    // radial, so a peer beside a mark reads as having stepped back from it
    expect(Math.atan2(out[2] - c[2], out[0] - c[0]))
      .toBeCloseTo(Math.atan2(inside[2] - c[2], inside[0] - c[0]), 12);
    // A node already clear comes back as the SAME array — nothing downstream
    // re-uploads a buffer because a producer appeared on the far side of the
    // colony.
    const clear: Vec3 = [30, 21, -4];
    expect(cohortKeepOutPos(clear, 'QmSomebody', [c])).toBe(clear);
    expect(cohortKeepOutPos(clear, 'QmSomebody', [])).toBe(clear);
  });

  it('a node on a cohort’s exact centre takes its own placement hash for the direction', () => {
    const c: Vec3 = [10, COLONY_Y, -4];
    const centred: Vec3 = [c[0], 20.7, c[2]];
    const a = cohortKeepOutPos(centred, 'QmSomebody', [c]);
    const b = cohortKeepOutPos(centred, 'QmOther', [c]);
    for (const p of [a, b]) {
      expect(p[1]).toBe(20.7);
      expect(Math.hypot(p[0] - c[0], p[2] - c[2])).toBeCloseTo(COHORT_KEEP_OUT_R, 12);
    }
    // Same id, same direction, forever; a different id, a different one.
    expect(cohortKeepOutPos(centred, 'QmSomebody', [c])).toEqual(a);
    expect(b).not.toEqual(a);
  });

  // ⚠️ TWO COHORTS CLOSER THAN `2 * COHORT_KEEP_OUT_R` HAVE OVERLAPPING DISCS,
  // and clearing one can drop a node into the other. Three deeply nested discs
  // here — far tighter than `attestedPos` produces — because the bound and the
  // closed-form finish exist for a case the real data almost never reaches.
  it('⭐ overlapping discs still let every node out, whatever the order', () => {
    const a: Vec3 = [0, COLONY_Y, 0];
    const b: Vec3 = [COHORT_KEEP_OUT_R * 0.6, COLONY_Y, 0];
    const d: Vec3 = [-COHORT_KEEP_OUT_R * 0.5, COLONY_Y, COHORT_KEEP_OUT_R * 0.4];
    const discs = [a, b, d];
    for (let i = 0; i < 400; i += 1) {
      const t = (i / 400) * Math.PI * 2;
      const p: Vec3 = [Math.cos(t) * (i % 7) * 0.9, 19 + (i % 5), Math.sin(t) * (i % 5) * 1.1];
      const out = cohortKeepOutPos(p, `probe:${i}`, discs);
      expect(nearestDisc(out, discs)).toBeGreaterThanOrEqual(COHORT_KEEP_OUT_R - 1e-9);
      expect(out[1]).toBe(p[1]);
    }
    const probe: Vec3 = [0.2, 20.1, -0.1];
    const first = cohortKeepOutPos(probe, 'probe', [a, b, d]);
    for (const perm of [[d, a, b], [b, d, a], [d, b, a], [b, a, d]]) {
      expect(cohortKeepOutPos(probe, 'probe', perm)).toEqual(first);
    }
  });

  // ⚠️ THE MEASURED BELT IS NOT PLACEMENT, IT IS A MEASUREMENT. A peer's radius
  // is `latencyToRadius01` of its round trip and its angle is its id, so
  // pushing one off a cohort would print a latency or a bearing nobody
  // observed. Both cases are FORCED here rather than hoped for: the peer's
  // position is fixed now (the belt is about the axis), so the COHORT is the
  // free end — `cohortOnTheBelt` searches payout keys for a mark that stands
  // on top of the peer, and the assertion is that the peer does not give way
  // to it.
  it('⚠️ a measured peer and the local node stay put, even standing on a cohort', () => {
    const p = peer({ node_id: 'QmMeasured', latency_ms: 90, direction: 'outbound' });
    const pos = measuredPeerPos(p);
    const producers = cohortOnTheBelt(pos);
    const centre = attestedPos(producers[0].key);
    expect(nearestDisc(pos, [centre])).toBeLessThan(COHORT_KEEP_OUT_R);  // it IS on the mark
    const localPos: Vec3 = [12, COLONY_Y, -9];
    const t = inferredTopology([p], 0xc0ffee, 'ckb:local', localPos, rows, undefined, producers);
    const measured = t.nodes.find((n) => n.kind === 'measured')!;
    expect(measured.pos).toEqual(pos);                                // not moved off it

    const onAMark = attestedPos(producers[1].key);
    const u = inferredTopology([], 0xc0ffee, 'ckb:local', onAMark, rows, undefined, producers);
    expect(u.nodes.find((n) => n.kind === 'local')!.pos).toBe(onAMark);
  });

  // ⭐ THE INVARIANT THE KEEP-OUT HAD TO SURVIVE. `scatterInferred` is still a
  // pure function of the seed and still cached; the displacement is applied
  // where the cloud meets the staged tiers and reads only the attested
  // positions. So peers arriving and leaving still move nobody — with six
  // cohorts standing, which is the case the old test could not cover.
  it('⭐ churn-stability holds with cohorts standing: a peer coming or going moves nobody', () => {
    const producers = sixProducers('ch');
    const three = [
      peer({ node_id: 'A', latency_ms: 40, direction: 'outbound' }),
      peer({ node_id: 'B', latency_ms: 180, direction: 'inbound' }),
      peer({ node_id: 'C', latency_ms: 300, direction: 'outbound' }),
    ];
    const cloud = (t: ReturnType<typeof inferredTopology>) => t.nodes
      .filter((n) => n.kind !== 'local' && n.kind !== 'measured')
      .map((n) => [n.id, n.pos] as const);
    const many = inferredTopology(three, 0xc0ffee, 'ckb:local', undefined, rows, undefined, producers);
    const few = inferredTopology(three.slice(0, 1), 0xc0ffee, 'ckb:local', undefined, rows, undefined, producers);
    expect(cloud(few)).toEqual(cloud(many));
  });
});
