import { describe, it, expect } from 'vitest';
import {
  localAnchor, measuredPeerPos, COLONY_Y, LOCAL_ANCHOR_OFFSET, COLONY_ELLIPSE_X, COLONY_ELLIPSE_Z,
  scatterInferred, COLONY_INFERRED_COUNT, COLONY_INFERRED_JITTER, COLONY_MIN_SPACING,
  COLONY_RADIUS, COLONY_Y_THICKNESS, inferredTopology, ensureConnectedFrom, sightedPos,
} from '../src/derives/networkTopology.derive';
import { colonyFlood } from '../src/derives/networkFlood.derive';
import {
  latencyToRadius01, peerAngle, PEER_INNER_RADIUS, PEER_OUTER_RADIUS,
} from '../src/derives/peers.derive';
import type { NetworkRosterRecord, Peer, RosterNode } from '@cknerv/types';
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

  it('measuredPeerPos places a peer at latency-radius around the anchor', () => {
    const anchor = localAnchor(0xc0ffee);
    const p = peer({ node_id: 'A', latency_ms: 400 }); // >= cap → outer ring
    const pos = measuredPeerPos(anchor, p);
    // de-squash BOTH ellipse axes to recover the base (circular) radius r.
    const dxz = Math.hypot((pos[0] - anchor[0]) / COLONY_ELLIPSE_X, (pos[2] - anchor[2]) / COLONY_ELLIPSE_Z);
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

  it('scatters measured peers around localPos (distance = latency radius), NOT around localAnchor(seed)', () => {
    const t = inferredTopology(peers, seed, 'ckb:local', localPos);
    const b = t.nodes.find((n) => n.id === 'B')!;
    // de-squash BOTH ellipse axes to recover the base (circular) radius around localPos
    const rAroundLocalPos = Math.hypot(
      (b.pos[0] - localPos[0]) / COLONY_ELLIPSE_X,
      (b.pos[2] - localPos[2]) / COLONY_ELLIPSE_Z,
    );
    const tRad = latencyToRadius01(400);
    const expectedR = PEER_INNER_RADIUS + tRad * (PEER_OUTER_RADIUS - PEER_INNER_RADIUS);
    expect(rAroundLocalPos).toBeCloseTo(expectedR, 4); // placed around localPos
    // exact: the peer is measuredPeerPos(localPos, …), and it moved OFF the
    // seed-only anchor — proving localPos, not localAnchor(seed), is the anchor.
    expect(b.pos).toEqual(measuredPeerPos(localPos, peers[1]));
    expect(b.pos).not.toEqual(measuredPeerPos(localAnchor(seed), peers[1]));
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

  // ⭐ The record reports three rungs of the crawler's gradient and this colony
  // owns marks for two. `sighted` is a tier whose name says the crawler dialed
  // the node and it answered — the bright stop this round, the dim one an
  // earlier round — and a peer nobody has ever got an answer out of is real
  // without being that. Staging it would put hearsay under a mark reserved for
  // a peer somebody has spoken to, on the honesty ladder whose whole reason for
  // existing is that it does not.
  it('stages the rungs it has a mark for and leaves the hearsay off stage', () => {
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
    expect(sightedOf(t).map((n) => n.id)).toEqual(['Qm0000', 'Qm0001']);
    // And it is off stage rather than anonymous: nothing invents a ghost in
    // its place, so the row simply rides the record unstaged.
    expect(t.nodes.filter((n) => n.id === 'Qm0002')).toHaveLength(0);
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
