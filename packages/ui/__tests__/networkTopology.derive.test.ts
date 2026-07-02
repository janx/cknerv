import { describe, it, expect } from 'vitest';
import {
  localAnchor, measuredPeerPos, COLONY_Y, LOCAL_ANCHOR_OFFSET, COLONY_ELLIPSE_X, COLONY_ELLIPSE_Z,
  scatterInferred, COLONY_INFERRED_COUNT, COLONY_INFERRED_JITTER, COLONY_MIN_SPACING,
  inferredTopology, ensureConnectedFrom,
} from '../src/derives/networkTopology.derive';
import { latencyToRadius01, PEER_INNER_RADIUS, PEER_OUTER_RADIUS } from '../src/derives/peers.derive';
import type { Peer } from '@cknerv/types';
import type { NetworkNode, Vec3 } from '../src/types';

function peer(p: Partial<Peer>): Peer {
  return { node_id: 'Qm', addr: '1.2.3.4:8115', direction: 'outbound', version: '0.116.1', connected_ms: 0, ...p };
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
