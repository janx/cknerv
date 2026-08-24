import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { render, renderHook } from '@testing-library/react';
import { Canvas } from '@react-three/fiber';
import ColonyNodes, { useStableList } from '../../src/components/ColonyNodes';
import { inferredTopology } from '../../src/derives/networkTopology.derive';
import { colonyFlood } from '../../src/derives/networkFlood.derive';
import type { NetworkNode } from '../../src/types';
import type { NetworkRosterRecord, Peer, RosterNode } from '@cknerv/types';

function source(file: string): string {
  return readFileSync(resolve(process.cwd(), `src/components/${file}`), 'utf8');
}

function peer(node_id: string): Peer {
  return {
    node_id, addr: '1.2.3.4:8115', direction: 'outbound', version: '0.116.1', connected_ms: 0,
  };
}

function rosterNode(node_id: string, reachable: boolean): RosterNode {
  return {
    node_id,
    addr: '/ip4/10.0.0.1/tcp/8115',
    version: '0.116.1',
    country: 'Unknown',
    asn: 'Unknown',
    reachable,
    last_seen_ms: 1_700_000_000_000,
  };
}

const ROSTER: NetworkRosterRecord = {
  source: 'ckbadger',
  as_of: { block: 12_000_000, hash: '0xabc' },
  updated_at_ms: 1_700_000_000_000,
  crawl_round: 3,
  truncated: true,
  entries: Array.from({ length: 12 }, (_, i) => rosterNode(
    `Qm${String(i).padStart(4, '0')}`, i % 3 !== 0,
  )),
};

describe('ColonyNodes sighted tier', () => {
  const peers = [peer('A'), peer('B')];
  const topology = inferredTopology(peers, 0xc0ffee, 'ckb:local', undefined, ROSTER);
  const cf = colonyFlood(topology, 1);

  it('mounts a staged roster inside an r3f Canvas without throwing', () => {
    expect(() => render(
      <Canvas>
        <ColonyNodes
          topology={topology}
          cf={cf}
          blockPulseAtMs={0}
          selectedId={`sighted:${ROSTER.entries[1].node_id}`}
          onSelect={() => {}}
          localVersion="0.116.1"
        />
      </Canvas>,
    )).not.toThrow();
  });

  it('mounts unchanged when no crawler ever spoke', () => {
    const bare = inferredTopology(peers, 0xc0ffee, 'ckb:local');
    expect(() => render(
      <Canvas>
        <ColonyNodes
          topology={bare}
          cf={colonyFlood(bare, 1)}
          blockPulseAtMs={0}
          selectedId={null}
          onSelect={() => {}}
          localVersion="0.116.1"
        />
      </Canvas>,
    )).not.toThrow();
  });

  it('draws the tier as point clouds only — ZERO new vertex attributes', () => {
    const nodes = source('ColonyNodes.tsx');
    // Cloned from the ghost cloud: one `position` buffer per draw, and the
    // reachable/unreachable split is two draws off one factory rather than a
    // per-point attribute. The attribute budget is at a cliff (13 custom slots)
    // and this tier must never spend one.
    expect(nodes).toContain("g.setAttribute('position', new THREE.BufferAttribute(pos, 3))");
    expect(nodes).toContain('makePeerCloudMaterial(shockwaveUniforms, tone)');
    expect(nodes).toContain('tone={PEER_CLOUD_SIGHTED_TONE}');
    expect(nodes).toContain('tone={PEER_CLOUD_SIGHTED_DARK_TONE}');
    expect(nodes).not.toContain('InstancedBufferAttribute(sighted');
    // …and it rides the same wave + context damping the ghost cloud gets.
    expect(nodes).toContain('mat.uniforms.uContextEnergy.value = contextEnergyRef?.current ?? 1');
  });

  it('picks through ONE instanced hit mesh on the existing arbitration path', () => {
    const nodes = source('ColonyNodes.tsx');
    // One instanced raycast target for the whole tier, flagged so the Cell
    // picker yields the pixel — no second arbitration path.
    expect(nodes).toContain('const hitUserData = useMemo(() => ({ [NETWORK_PEER_PICK_FLAG]: true }), [])');
    expect(nodes).toContain('<instancedMesh');
    expect(nodes).toContain('new THREE.MeshBasicMaterial({ visible: false })');
    expect(nodes).toContain('mesh.computeBoundingSphere()');
    expect(nodes).toContain('onSelect(`${SIGHTED_SELECTION_PREFIX}${id}`)');
    expect(nodes).toContain('e.stopPropagation()');
  });

  it('sizes every hit sphere from the mark its own stop draws', () => {
    const nodes = source('ColonyNodes.tsx');
    // A pick target that does not track the sprite is a target the user cannot
    // see: they aim at the glow and press on nothing. One unit sphere, scaled
    // per instance out of the same tone the cloud draws, so retuning a stop
    // moves its target with it — and the reachable stop's larger glow carries
    // the larger sphere rather than one flat radius for the whole tier.
    expect(nodes).toContain('peerCloudHitRadius(PEER_CLOUD_SIGHTED_TONE)');
    expect(nodes).toContain('peerCloudHitRadius(PEER_CLOUD_SIGHTED_DARK_TONE)');
    expect(nodes).toContain('new THREE.SphereGeometry(1, 8, 8)');
    expect(nodes).toContain('SCRATCH_MATRIX.makeScale(radius, radius, radius)');
    expect(nodes).toContain('SCRATCH_MATRIX.setPosition(');
    expect(nodes).not.toContain('const SIGHTED_SIZE');
  });

  it('keeps the measured tier off the same two allocations', () => {
    const nodes = source('ColonyNodes.tsx');
    // ⚠️ Wrapping data in a NEW InstancedBufferAttribute orphans its GL
    // buffer, and both measured walks run on every roster round and every
    // selection. The wrappers are built once for a capacity; the walks write
    // through `.array` and mark them.
    expect(nodes).toContain('const lanes = useMemo(() => ({');
    expect(nodes).toContain('lanes.color.array as Float32Array');
    expect(nodes).toContain('lanes.selected.array as Float32Array');
    expect(nodes).toContain('lanes.selected.needsUpdate = true');
    expect(nodes).toContain(
      "if (mesh.geometry.getAttribute('aPeerColor') !== lanes.color) {",
    );
    expect(nodes).not.toMatch(
      /'aPeer[A-Za-z]+',\s*\n?\s*new THREE\.InstancedBufferAttribute/,
    );
    // And one unit sphere for every measured hit target rather than 128
    // triangles and a GL buffer per peer, for geometry with no per-node
    // parameter at all. ⚠️ r3f v8's unmount disposes an object's own
    // properties, so without the opt-out one peer leaving the roster would
    // free the geometry every other peer is still drawing.
    expect(nodes).toContain(
      'const MEASURED_HIT_GEOMETRY = new THREE.SphereGeometry(1, 8, 8)',
    );
    expect(nodes).toContain('geometry={MEASURED_HIT_GEOMETRY}');
    expect(nodes).toContain('scale={MEASURED_SIZE}');
    expect(nodes).toContain('dispose={null}');
    expect(nodes).not.toContain('<sphereGeometry');
  });

  it('keeps the shared hover word instance-aware in both directions', () => {
    const nodes = source('ColonyNodes.tsx');
    // Every hover write and retraction is resolved from e.instanceId, and a
    // word that is no longer ours is left alone — r3f cancels the stale
    // instance before entering the next one, so it belongs to a live target.
    expect(nodes).toContain('const id = idAt(e.instanceId)');
    expect(nodes).toContain('gl.domElement.dataset.peerNodeHover = id');
    expect(nodes).toContain(
      'if (id !== undefined && gl.domElement.dataset.peerNodeHover === id)',
    );
    // churn + unmount guards: a retired or unmounted node never strands a hand.
    expect(nodes).toContain('ownedRef.current.has(hovered)');
    expect(nodes).toContain('!previous.has(hovered)');
  });
});

describe('cloud point buffers outlive the rebuilds that do not move them', () => {
  const sameObject = (a: NetworkNode, b: NetworkNode) => a === b;
  const sameId = (a: NetworkNode, b: NetworkNode) => a.id === b.id;
  const ghostsOf = (t: ReturnType<typeof inferredTopology>) => t.nodes.filter((n) => n.kind === 'inferred');
  const sightedOf = (t: ReturnType<typeof inferredTopology>) => t.nodes.filter((n) => n.kind === 'sighted');
  const measured = (node_id: string, latency_ms: number) => ({ ...peer(node_id), latency_ms });

  it('a peer ping that moves the measured belt leaves the 240-point ghost cloud alone', () => {
    const before = ghostsOf(inferredTopology([measured('A', 40)], 0xc0ffee, 'ckb:local', undefined, ROSTER));
    const after = ghostsOf(inferredTopology([measured('A', 220)], 0xc0ffee, 'ckb:local', undefined, ROSTER));
    expect(after).not.toBe(before);           // the topology really did rebuild
    const held = renderHook(({ list }) => useStableList(list, sameObject), {
      initialProps: { list: before },
    });
    held.rerender({ list: after });
    expect(held.result.current).toBe(before); // …and the geometry key did not
  });

  it('the two tiers test different things: ghosts by object, sighted by id', () => {
    // A ghost is the derive's cached scaffold object; a reseed keeps every
    // `inf:n` id while moving every point, so only identity is safe there. A
    // sighted node is re-staged from the crawler's row every build, so identity
    // is never held — but `sightedPos` is a pure function of the id, so the id
    // is exactly what its points follow.
    const original: NetworkNode[] = [
      { id: 'inf:0', kind: 'inferred', pos: [0, 0, 0] },
      { id: 'inf:1', kind: 'inferred', pos: [1, 0, 0] },
    ];
    const reseeded: NetworkNode[] = original.map((n) => ({ ...n, pos: [9, 9, 9] }));
    const byObject = renderHook(({ list }) => useStableList(list, sameObject), {
      initialProps: { list: original },
    });
    byObject.rerender({ list: reseeded });
    expect(byObject.result.current).toBe(reseeded);
    const byId = renderHook(({ list }) => useStableList(list, sameId), {
      initialProps: { list: original },
    });
    byId.rerender({ list: original.map((n) => ({ ...n })) });
    expect(byId.result.current).toBe(original);
  });

  it('a fresh crawl round holds the sighted buffer; a roster that changed who is on it does not', () => {
    const staged = (roster: NetworkRosterRecord) => sightedOf(
      inferredTopology([measured('A', 40)], 0xc0ffee, 'ckb:local', undefined, roster),
    );
    const rounds = {
      ...ROSTER,
      crawl_round: ROSTER.crawl_round + 1,
      entries: ROSTER.entries.map((e) => ({ ...e, last_seen_ms: e.last_seen_ms + 60_000 })),
    };
    const shorter = { ...ROSTER, entries: ROSTER.entries.slice(0, 8) };
    const first = staged(ROSTER);
    const held = renderHook(({ list }) => useStableList(list, sameId), {
      initialProps: { list: first },
    });
    held.rerender({ list: staged(rounds) });
    expect(held.result.current).toBe(first);
    held.rerender({ list: staged(shorter) });
    expect(held.result.current).not.toBe(first);
  });

  it('each cloud keys its buffer on the held list, under its own tier’s test', () => {
    const nodes = source('ColonyNodes.tsx');
    expect(nodes).toContain('const inferred = useStableList(staged, sameNodeObject)');
    expect(nodes).toContain('const points = useStableList(nodes, sameNodeId)');
    // …and the geometry follows the held list, never the freshly split one.
    expect(nodes).toContain('}, [inferred]);');
    expect(nodes).toContain('}, [points]);');
  });
});
