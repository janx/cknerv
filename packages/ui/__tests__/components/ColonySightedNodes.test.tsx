import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { render, renderHook } from '@testing-library/react';
import { Canvas } from '@react-three/fiber';
import ColonyNodes, {
  ATTESTED_HIT_RADIUS,
  COLONY_DRAWS,
  MINER_SELECTION_PREFIX,
  partitionByKind,
  partitionByStop,
  producerRingInstances,
  SIGHTED_FALLTHROUGH_STOP,
  SIGHTED_HIT_RADII,
  SIGHTED_STOPS,
  sightedStop,
  stagedPickBounds,
  stagedPickTargets,
  useStableList,
  type ColonyDraw,
  type SightedStop,
  type StagedPickTarget,
} from '../../src/components/ColonyNodes';
import {
  attestedNodeId,
  inferredTopology,
  STAGEABLE_ROSTER_STATES,
} from '../../src/derives/networkTopology.derive';
import { colonyFlood } from '../../src/derives/networkFlood.derive';
import {
  peerCloudHitRadius,
  PEER_CLOUD_ADVERTISED_TONE,
  PEER_CLOUD_ATTESTED_TONE,
  PEER_CLOUD_GHOST_TONE,
  type PeerCloudTone,
} from '../../src/materials/peerNodeMaterial';
import {
  makeProducerRingMaterial,
  producerAnnulusHit,
  producerRingRadius,
  PRODUCER_RING_HIT_BAND,
  PRODUCER_RING_MIN_RADIUS,
  PRODUCER_RING_SHARE_RADIUS,
  PRODUCER_RING_WIDTH,
} from '../../src/materials/producerRingMaterial';
import type { ProducerStanding } from '../../src/derives/blockProducers.derive';
import type { NetworkNode, NodeKind, Vec3 } from '../../src/types';
import type {
  NetworkRosterRecord, Peer, RosterNode, RosterNodeState,
} from '@cknerv/types';

function source(file: string): string {
  return readFileSync(resolve(process.cwd(), `src/components/${file}`), 'utf8');
}

function materialSource(): string {
  return readFileSync(resolve(process.cwd(), 'src/materials/peerNodeMaterial.ts'), 'utf8');
}

/** The whole ladder, faintest first — the haze the tier sits on top of, then
 *  every stop the tier itself draws. The haze is not one of `SIGHTED_STOPS`
 *  (it is not staged and cannot be picked), but it IS the rung below them, so
 *  the separation tests have to include it or the tier could quietly sink into
 *  the fiction underneath it. */
const LADDER: readonly (readonly [string, PeerCloudTone])[] = [
  ['ghost', PEER_CLOUD_GHOST_TONE],
  ...(Object.entries(SIGHTED_STOPS) as [SightedStop, PeerCloudTone][]),
];

/** The three uniforms the factory actually resolves, with the same fallbacks —
 *  a tone that omits a field is asking for the ghost's, and comparing declared
 *  fields alone would let a stop go dark by leaving one out. */
const restingDim = (t: PeerCloudTone) => t.dim ?? PEER_CLOUD_GHOST_TONE.dim;
const eventDim = (t: PeerCloudTone) => t.event ?? restingDim(t);
const coreExp = (t: PeerCloudTone) => t.coreExp ?? 2.0;
const diameter = (t: PeerCloudTone) => t.size ?? PEER_CLOUD_GHOST_TONE.size;

/** The sprite's radial profile, transcribed from the fragment shader (pinned
 *  against it below). `r` runs 0 at the centre to 1 at the sprite's edge. */
const shapeAt = (r: number, exp: number) => (
  (1 - r) ** exp + 0.42 * (1 - r) ** 1.6
);

/**
 * How much of the sprite's RADIUS is a saturated plateau — the measurement the
 * axis has failed on before, and the one brightness alone cannot fix.
 *
 * Additive blending multiplies colour by alpha, so a stop's resting light goes
 * as `shape² · dim²`, and the scaffold hue's blue channel is exactly 1.0. The
 * plateau is therefore everywhere `shape · dim >= 1`, and it ends where the
 * profile crosses `1/dim`. A stop resting under the clip has none at all.
 */
function plateauFraction(tone: PeerCloudTone): number {
  const dim = restingDim(tone);
  const exp = coreExp(tone);
  let last = 0;
  for (let step = 0; step <= 1000; step += 1) {
    const r = step / 1000;
    if (shapeAt(r, exp) * dim >= 1) last = r;
  }
  return last;
}

/** A visibility floor in the same units the profile is measured in: the light
 *  a stop puts down at radius `r` is `(shape · dim)²`, so a mark stops being a
 *  mark where `shape · dim` falls under this. Its exact value only scales every
 *  answer below together; nothing here depends on which floor is chosen. */
const VISIBILITY_FLOOR = 0.05;

/**
 * ⭐ THE MARK, IN WORLD UNITS — WHICH IS NOT `size`.
 *
 * `size` is the sprite the shader rasterises; what a viewer sees is the disc
 * inside it where the profile is still above the floor, and that fraction moves
 * with BOTH `dim` and `coreExp`. A stop with a tight 3.5 core throws away far
 * more of its sprite than one on the soft 2.0 default, so two stops can be a
 * clean 1.4x apart in declared diameter and land a single pixel apart on the
 * screen. That is not a hypothetical: it is what the first cut of the hearsay
 * stop did, and only a rendered measurement caught it.
 */
function visibleExtent(tone: PeerCloudTone): number {
  const dim = restingDim(tone);
  const exp = coreExp(tone);
  let edge = 0;
  for (let step = 0; step <= 2000; step += 1) {
    const r = step / 2000;
    if (shapeAt(r, exp) * dim >= VISIBILITY_FLOOR) edge = r;
  }
  return edge * diameter(tone);
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
    state: reachable ? 'reachable' : 'verified_unavailable',
    version: '0.116.1',
    country: 'Unknown',
    asn: 'Unknown',
    last_reachable_ms: 1_700_000_000_000,
    last_advertised_ms: 1_700_000_060_000,
    last_observed_ms: 1_700_000_000_000,
    latest_positive_observed_ms: 1_700_000_065_000,
  };
}

/** The rung the crawler has never had an answer out of. Its absences are the
 *  point: no version, no reach clock, no dial — the roster row for a peer
 *  nobody has spoken to carries an identity, an address and an advertise
 *  window, and nothing that would require a dial to learn. */
function hearsayNode(node_id: string): RosterNode {
  return {
    node_id,
    addr: '/ip4/10.0.0.2/tcp/8115',
    state: 'advertised_unverified',
    last_advertised_ms: 1_700_000_060_000,
    last_observed_ms: 1_700_000_000_000,
    latest_positive_observed_ms: 1_700_000_065_000,
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

  // ⭐⭐ The predecessor asked `n.sighted?.reachable !== false`, so ANY node
  // whose answer was not literally `false` — a state this build has no name
  // for, a row from an older record, a node with no crawler row at all — drew
  // at the brightness reserved for a peer the crawler dialed this round. That
  // is a default that hands out the strongest claim on the ladder to whatever
  // it cannot read. The direction has to be the other one, and the only way to
  // tell the two apart is to ask about a rung this file has never heard of.
  it('never lets a stop it cannot name reach for a brighter mark', () => {
    const node = (sighted?: RosterNode): NetworkNode => ({
      id: 'Qm0000', kind: 'sighted', pos: [0, 0, 0], sighted,
    });
    expect(sightedStop(node(rosterNode('Qm0000', true)))).toBe('reached');
    expect(sightedStop(node(rosterNode('Qm0000', false)))).toBe('remembered');
    expect(sightedStop(node(hearsayNode('Qm0000')))).toBe('advertised');
    // A rung upstream grew and nothing here has been taught to draw, and a
    // node carrying no crawler row at all (every other tier in the colony).
    const unnamed = {
      ...rosterNode('Qm0000', true), state: 'quantum_entangled',
    } as unknown as RosterNode;
    for (const unreadable of [node(unnamed), node(undefined)]) {
      expect(sightedStop(unreadable)).toBe(SIGHTED_FALLTHROUGH_STOP);
    }
  });

  // …and the fallthrough is only worth anything if the stop it names really is
  // the faintest one. Naming a stop is what the guard above checks; being the
  // bottom of the ladder is a property of the NUMBERS, and a retune that
  // reordered them would leave the guard reading correctly while it handed an
  // unreadable rung the brightest mark on the tier.
  it('and the stop it falls through to is provably the bottom of the ladder', () => {
    const floor = SIGHTED_STOPS[SIGHTED_FALLTHROUGH_STOP];
    for (const [name, tone] of Object.entries(SIGHTED_STOPS)) {
      if (name === SIGHTED_FALLTHROUGH_STOP) continue;
      expect(restingDim(tone)).toBeGreaterThan(restingDim(floor));
      expect(diameter(tone)).toBeGreaterThan(diameter(floor));
    }
  });

  // ⭐ TWO HALVES OF ONE GATE, CHECKED AGAINST EACH OTHER. The derive decides
  // which rungs may be staged; this file decides what each one looks like.
  // A rung that stages with no mark of its own falls through and stands an
  // invisible hit target under somebody else's glow; a mark no rung can reach
  // is paint nothing will ever wear. Both halves pass their own tests while
  // disagreeing, so the disagreement is what has to be asserted.
  it('every rung that can be staged has its own mark, and no mark is unreachable', () => {
    const staged = [...STAGEABLE_ROSTER_STATES];
    const stops = staged.map((state) => sightedStop({
      id: 'Qm0000',
      kind: 'sighted',
      pos: [0, 0, 0],
      sighted: { ...rosterNode('Qm0000', true), state },
    }));
    // No two rungs share a mark — which is also how a rung added to the
    // staging set and forgotten here shows up, since it would fall through
    // onto the faintest stop and collide with the rung that owns it.
    expect(new Set(stops).size).toBe(staged.length);
    // …and every mark this file draws belongs to a rung that can reach it.
    expect([...stops].sort()).toEqual(Object.keys(SIGHTED_STOPS).sort());
  });

  // The hit mesh walks the staged list WHOLE and gives every instance the
  // radius of its own stop, so the split has to be a partition: a node in no
  // bucket stands an invisible target with no mark over it, and a node in two
  // is double-booked.
  it('assigns every staged node exactly one stop, whatever its row says', () => {
    const rows: RosterNode[] = [
      rosterNode('Qm0000', true),
      rosterNode('Qm0001', false),
      hearsayNode('Qm0002'),
      { ...rosterNode('Qm0003', true), state: 'quantum_entangled' } as unknown as RosterNode,
    ];
    const staged: NetworkNode[] = rows.map((sighted, i) => ({
      id: `Qm000${i}`, kind: 'sighted', pos: [0, 0, 0], sighted,
    }));
    const buckets = partitionByStop(staged);
    // Every stop the tier draws gets a bucket, even an empty one — the mount
    // decides emptiness, the split never silently omits a rung.
    expect(Object.keys(buckets).sort()).toEqual(Object.keys(SIGHTED_STOPS).sort());
    const drawn = Object.values(buckets).flat();
    expect(drawn).toHaveLength(staged.length);              // nobody dropped
    expect(new Set(drawn).size).toBe(staged.length);        // nobody twice
    for (const node of staged) {
      expect(buckets[sightedStop(node)]).toContain(node);   // …and in its own
    }
    // The hit mesh sizes from the same guard, so every staged node has a
    // radius and it is the one its own cloud draws.
    for (const [stop, nodes] of Object.entries(buckets)) {
      for (const node of nodes) {
        expect(SIGHTED_HIT_RADII[sightedStop(node)])
          .toBe(peerCloudHitRadius(SIGHTED_STOPS[stop as SightedStop]));
      }
    }
  });

  it('draws the tier as point clouds only — ZERO new vertex attributes', () => {
    const nodes = source('ColonyNodes.tsx');
    // Cloned from the ghost cloud: one `position` buffer per draw, and the
    // whole gradient is one draw per stop off one factory rather than a
    // per-point attribute. The attribute budget is at a cliff (13 custom slots)
    // and this tier must never spend one — which is why a third stop cost a
    // draw call and nothing else.
    expect(nodes).toContain("g.setAttribute('position', new THREE.BufferAttribute(pos, 3))");
    expect(nodes).toContain('makePeerCloudMaterial(shockwaveUniforms, tone)');
    expect(nodes).toContain('tone={SIGHTED_STOPS[stop]}');
    // …and the clouds are mounted off the same partition the hit mesh is
    // sized from. A component cannot be asked in jsdom what it drew, so this
    // is the only place the two can be held to one split.
    expect(nodes).toContain('const byStop = useMemo(() => partitionByStop(sighted), [sighted])');
    expect(nodes).toContain('SIGHTED_STOP_ORDER.map((stop) => (byStop[stop].length > 0 ? (');
    expect(nodes).not.toContain('InstancedBufferAttribute(sighted');
    expect(nodes).not.toMatch(/setAttribute\('a(Sighted|Stop|Tone)/);
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
    // ⭐ ONE mesh for BOTH staged tiers, so the dialect rides the target rather
    // than being concatenated at the click. Two meshes would pay a second
    // bounding-sphere reject per raycast and keep a second copy of the hover
    // guards — and, because the sighted layer only mounts when a crawler has
    // spoken and the crawler is optional, would have left a cknerv with
    // producers and no roster unable to click any of them.
    expect(nodes).toContain('onSelect(target.selectionId)');
    expect(nodes).toContain('stagedPickTargets(sighted, attested, ringInstances)');
    expect(nodes).not.toContain('onSelect(`${SIGHTED_SELECTION_PREFIX}${id}`)');
    expect(nodes).toContain('e.stopPropagation()');
  });

  it('sizes every hit sphere from the mark its own stop draws', () => {
    const nodes = source('ColonyNodes.tsx');
    // A pick target that does not track the sprite is a target the user cannot
    // see: they aim at the glow and press on nothing. One unit sphere, scaled
    // per instance out of the same tone the cloud draws, so retuning a stop
    // moves its target with it — and the brighter stops carry the larger
    // spheres rather than one flat radius for the whole tier.
    for (const [stop, tone] of Object.entries(SIGHTED_STOPS)) {
      expect(SIGHTED_HIT_RADII[stop as SightedStop]).toBe(peerCloudHitRadius(tone));
      expect(SIGHTED_HIT_RADII[stop as SightedStop]).toBe(diameter(tone) / 2);
    }
    expect(nodes).toContain('peerCloudHitRadius(SIGHTED_STOPS[stop])');
    expect(nodes).toContain('new THREE.SphereGeometry(1, 8, 8)');
    expect(nodes).toContain('SCRATCH_MATRIX.makeScale(scale, scale, scale)');
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
    expect(nodes).toContain('const id = targetAt(e.instanceId)?.id');
    expect(nodes).toContain('gl.domElement.dataset.peerNodeHover = id');
    expect(nodes).toContain(
      'if (id !== undefined && gl.domElement.dataset.peerNodeHover === id)',
    );
    // churn + unmount guards: a retired or unmounted node never strands a hand.
    expect(nodes).toContain('ownedRef.current.has(hovered)');
    expect(nodes).toContain('!previous.has(hovered)');
  });
});

/**
 * The confidence axis itself. Everything here is arithmetic on the tone table,
 * because the axis has failed TWICE in the source rather than on the screen:
 * once with every stop driven past the additive clip (so all of them rendered
 * as the same white-cyan pixel and the gradient existed only in the constants),
 * and once with a stop that passed the clip on a soft core and spread a
 * saturated plateau across 42% of its sprite radius. Neither cut had a test
 * that could tell.
 */
describe('the confidence axis separates where the eye reads it', () => {
  it('every rung of the ladder is strictly above the one below it', () => {
    // ⭐ FOOTPRINT IS THE AXIS THE EYE SORTS ON, because brightness clips and
    // the inferred edges pile light onto every junction they cross. Light is
    // asserted alongside it and goes as dim SQUARED — additive blending applies
    // alpha to colour a second time — so intuition about "a bit brighter" is
    // wrong here by construction.
    for (let i = 1; i < LADDER.length; i += 1) {
      const [belowName, below] = LADDER[i - 1];
      const [aboveName, above] = LADDER[i];
      const step = `${belowName} → ${aboveName}`;
      expect([step, diameter(above) > diameter(below)]).toEqual([step, true]);
      expect([step, restingDim(above) > restingDim(below)]).toEqual([step, true]);
      // …and on a block wave too. Only the haze ever names an `event` apart
      // from its rest — it recedes at rest and must not go quiet on a wave —
      // so a stop that simply inherited its own rest could be out-shouted from
      // underneath for the length of every block.
      expect([step, eventDim(above) > eventDim(below)]).toEqual([step, true]);
    }
  });

  it('no two stops are within a hair of each other on either axis', () => {
    // Convergence, not inversion: two stops that pass the ordering test above
    // by 0.01 are one stop as far as a viewer is concerned. Each step is at
    // least a quarter again as much footprint and a fifth again as much light.
    for (let i = 1; i < LADDER.length; i += 1) {
      const [belowName, below] = LADDER[i - 1];
      const [aboveName, above] = LADDER[i];
      const step = `${belowName} → ${aboveName}`;
      const footprint = diameter(above) / diameter(below);
      const light = (restingDim(above) / restingDim(below)) ** 2;
      expect([step, footprint >= 1.25]).toEqual([step, true]);
      expect([step, light >= 1.2]).toEqual([step, true]);
    }
  });

  it('no stop spreads a saturated plateau across its sprite', () => {
    // ⚠️ THIS IS THE SECOND CUT'S FAILURE, WRITTEN DOWN. A stop resting above
    // the additive clip is saturated everywhere its profile stays over 1/dim,
    // and brightness cannot fix that — it clips. Only a tighter core can. The
    // tone that failed (dim 1.95 on the default 2.0 core) held 42% of its
    // radius flat; every stop shipped since keeps it under a fifth.
    for (const [name, tone] of LADDER) {
      expect([name, plateauFraction(tone) <= 0.2]).toEqual([name, true]);
    }
    // The haze rests so far under the clip that it has no plateau at all —
    // that is what makes it haze rather than a white speck the eye reads as a
    // node — and the stop directly above it is nearly as restrained.
    expect(plateauFraction(PEER_CLOUD_GHOST_TONE)).toBe(0);
    expect(plateauFraction(SIGHTED_STOPS.advertised)).toBeLessThan(0.1);
    // …and the failing tone is still caught, which is the only proof this
    // measurement is measuring anything.
    expect(plateauFraction({ dim: 1.95, size: 2.0 })).toBeGreaterThan(0.4);
  });

  it('separates on the mark a viewer sees, not on the sprite it is cut from', () => {
    // The same ladder as above, re-asked against the disc that is actually
    // visible. It has to hold here too, because this is the one the eye reads.
    const marks = LADDER.map(([name, tone]) => [name, visibleExtent(tone)] as const);
    for (let i = 1; i < marks.length; i += 1) {
      const step = `${marks[i - 1][0]} → ${marks[i][0]}`;
      expect([step, marks[i][1] / marks[i - 1][1] >= 1.25]).toEqual([step, true]);
    }
  });

  // ⭐⭐ THE WEAKEST RUNG LEANS TOWARD THE HAZE, AND THAT IS A MEASURED CALL.
  // Its declared diameter was first set to keep the ladder of SPRITES even
  // (0.65 · 1.05 · 1.5 · 2.0), and at the default camera that drew a mark one
  // device pixel off the stop above it, indistinguishable once the colony's
  // depth spread was taken in. What fixed it was pulling the stop DOWN the
  // ladder, which is also where it belongs on the argument: it is the rung
  // nobody has ever had an answer out of, so it should read nearer the invented
  // haze than the peers that answered. Both halves of that are this assertion —
  // and the rejected 1.05 sits at 0.64 of the span, which is the wrong side.
  it('places the hearsay stop below the midpoint between haze and answered', () => {
    const span = (a: PeerCloudTone, b: PeerCloudTone) => (
      Math.log(visibleExtent(b) / visibleExtent(a))
    );
    const position = span(PEER_CLOUD_GHOST_TONE, SIGHTED_STOPS.advertised)
      / span(PEER_CLOUD_GHOST_TONE, SIGHTED_STOPS.remembered);
    expect(position).toBeGreaterThan(0.2);
    expect(position).toBeLessThan(0.5);
  });

  it('reads its profile off the shader it is claiming to model', () => {
    // The arithmetic above is worthless if the fragment shader stops matching
    // it. One core term carrying the tone's own exponent, one fixed skirt.
    const material = materialSource();
    expect(material).toContain('float core = pow(1.0 - r, uCoreExp);');
    expect(material).toContain('float halo = pow(1.0 - r, 1.6) * 0.42;');
    expect(material).toContain('uCoreExp: { value: stop.coreExp ?? 2.0 }');
    // …and the tone reaches the shader as UNIFORMS, so no stop can ever cost
    // the vertex-attribute budget a slot.
    expect(material).toContain('uDim: { value: stop.dim ?? PEER_CLOUD_GHOST_TONE.dim }');
    expect(material).toContain('uSize: { value: stop.size ?? PEER_CLOUD_GHOST_TONE.size }');
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
      entries: ROSTER.entries.map((e) => ({
        ...e, last_reachable_ms: (e.last_reachable_ms ?? 0) + 60_000,
      })),
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

/** A producer standing, as the live view hands one over. `candidates` null is a
 *  fan T4 withheld — the shape that carries a count and no identities. */
function standing(
  key: string,
  share: number,
  candidates: RosterNode[] | null = null,
): ProducerStanding {
  return {
    role: 'producer',
    key,
    message: '0.209.0 (7e31f75 2026-07-30)',
    blocks: Math.max(1, Math.round(share * 240)),
    windowBlocks: 240,
    share,
    lastSeenMs: 1_700_000_000_000,
    fan: candidates === null
      ? {
        drawn: false,
        reason: 'modal',
        matchedVersion: '0.209.0 (7e31f75 2026-07-30)',
        matched: 40,
        shareOfVersioned: 0.9,
      }
      : {
        drawn: true,
        matchedVersion: '0.209.0 (7e31f75 2026-07-30)',
        candidates,
        shareOfVersioned: candidates.length / 57,
      },
  };
}

const producerKey = (tag: string) => `0x${tag.repeat(64).slice(0, 64)}`;

function ringSource(): string {
  return readFileSync(
    resolve(process.cwd(), 'src/materials/producerRingMaterial.ts'),
    'utf8',
  );
}

/**
 * The chain's rung, and the one moment `NodeKind` acquires the compile-time
 * gate its sibling `RosterNodeState` has always had.
 */
describe('ColonyNodes attested tier', () => {
  const peers = [peer('A'), peer('B')];
  const producers = [
    standing(producerKey('a'), 0.56),
    standing(producerKey('b'), 0.02),
  ];
  const topology = inferredTopology(
    peers, 0xc0ffee, 'ckb:local', undefined, ROSTER, undefined, producers,
  );

  it('mounts a staged producer window inside an r3f Canvas without throwing', () => {
    expect(() => render(
      <Canvas>
        <ColonyNodes
          topology={topology}
          cf={colonyFlood(topology, 1, producers[0].key)}
          blockPulseAtMs={0}
          selectedId={`${MINER_SELECTION_PREFIX}${producers[0].key}`}
          onSelect={() => {}}
          localVersion="0.116.1"
          producers={producers}
        />
      </Canvas>,
    )).not.toThrow();
  });

  // ⭐⭐ THE GATE THAT WAS MISSING. `rg NodeKind` used to hit only `types.ts`:
  // no table, no switch, every consumer opting IN by literal — so widening the
  // type to add `attested` broke nothing at all and the new rung rendered as
  // nothing. That was right, and it was luck. The record below is the gate;
  // this sample is typed by the SAME union, so a rung grown upstream stops both
  // the source and this test compiling until somebody has said what it is.
  const KIND_SAMPLE: Readonly<Record<NodeKind, NetworkNode>> = {
    local: { id: 'ckb:local', kind: 'local', pos: [0, 0, 0] },
    measured: { id: 'QmM', kind: 'measured', pos: [1, 0, 0], peer: peer('QmM') },
    inferred: { id: 'inf:0', kind: 'inferred', pos: [2, 0, 0] },
    sighted: {
      id: 'QmS', kind: 'sighted', pos: [3, 0, 0], sighted: rosterNode('QmS', true),
    },
    attested: {
      id: attestedNodeId(producerKey('a')),
      kind: 'attested',
      pos: [4, 0, 0],
      attested: producers[0],
    },
  };

  it('gives every rung of NodeKind a draw, and leaves no draw unreachable', () => {
    const sample = Object.values(KIND_SAMPLE);
    const buckets = partitionByKind(sample);
    // Every draw gets a bucket, even an empty one — the mount decides
    // emptiness; the split never silently omits one.
    expect(Object.keys(buckets).sort()).toEqual([...COLONY_DRAWS].sort());
    const drawn = Object.values(buckets).flat();
    expect(drawn).toHaveLength(sample.length);          // nobody dropped
    expect(new Set(drawn).size).toBe(sample.length);    // nobody twice
    // …and no draw in the list is paint nothing will ever wear. Same
    // two-halves check `STOP_BY_ROSTER_STATE` gets, one type up.
    const used = COLONY_DRAWS.filter((draw) => buckets[draw].length > 0);
    expect([...used].sort()).toEqual([...COLONY_DRAWS].sort());
    // The rungs land where this file says they land, one at a time.
    expect(buckets.haze).toEqual([KIND_SAMPLE.inferred]);
    expect(buckets.attested).toEqual([KIND_SAMPLE.attested]);
    expect(buckets.sighted).toEqual([KIND_SAMPLE.sighted]);
    expect(buckets.measured).toEqual([KIND_SAMPLE.measured]);
    // `local` is not a hole: the galaxy's labeled anchor draws it, which is a
    // real answer to "what does this kind look like" and the one this file
    // gives. Nothing here mounts off that bucket.
    expect(buckets.anchor).toEqual([KIND_SAMPLE.local]);
  });

  it('draws a kind it has never heard of by nobody, rather than borrowing a mark', () => {
    // Unlike the roster table there is no faintest rung to fall through to:
    // these are DRAWS, and a kind with no draw is the honest state — exactly
    // the state `attested` itself was in between being staged and being
    // painted. Silently sorting it into a bucket would hand it a mark that
    // says something false about it.
    const unknown = {
      id: 'x', kind: 'quantum_entangled', pos: [0, 0, 0],
    } as unknown as NetworkNode;
    const buckets = partitionByKind([KIND_SAMPLE.inferred, unknown]);
    expect(Object.values(buckets).flat()).toEqual([KIND_SAMPLE.inferred]);
  });

  // ⭐⭐ THE ONE THING §3.4 CANNOT HAVE, STATED. Every other stop on this axis
  // buys legibility with footprint and is held to a quarter-again step by the
  // convergence test further down. This rung cannot be: ghost → hearsay is only
  // 1.35x of visible extent end to end, so anything inserted between them is
  // ~1.16x on both sides whatever the numbers. Reaching PAST the hearsay stop
  // to make room would assert identification an anonymous node has none of.
  // So the axis gives it a ceiling and a floor, and the RING is its mark.
  it('brackets the attested stop between the haze and the faintest named rung', () => {
    for (const field of [restingDim, diameter, eventDim] as const) {
      expect(field(PEER_CLOUD_ATTESTED_TONE)).toBeGreaterThan(field(PEER_CLOUD_GHOST_TONE));
      expect(field(PEER_CLOUD_ATTESTED_TONE)).toBeLessThan(field(PEER_CLOUD_ADVERTISED_TONE));
    }
    // It rests UNDER the additive clip, like the haze and unlike every named
    // stop: the point is a body and a pick target, and asserting presence is
    // the ring's job on the other channel.
    expect(plateauFraction(PEER_CLOUD_ATTESTED_TONE)).toBe(0);
    // …and it is NOT one of the crawler's stops, so the ladder those are held
    // to is unchanged by its existence.
    expect(Object.values(SIGHTED_STOPS)).not.toContain(PEER_CLOUD_ATTESTED_TONE);
  });

  it('stands one hit target per staged node across BOTH tiers, sized from its own mark', () => {
    const sighted = topology.nodes.filter((n) => n.kind === 'sighted');
    const attested = topology.nodes.filter((n) => n.kind === 'attested');
    const targets = stagedPickTargets(sighted, attested, []);
    expect(attested).toHaveLength(producers.length);
    expect(targets).toHaveLength(sighted.length + attested.length);
    // Sighted first, so a colony with no producers keeps every instance index
    // exactly where it was.
    expect(targets.slice(0, sighted.length).map((t) => t.id))
      .toEqual(sighted.map((n) => n.id));
    for (const target of targets.slice(0, sighted.length)) {
      expect(target.selectionId).toBe(`sighted:${target.id}`);
    }
    // ⭐ The producer's selection carries the PAYOUT KEY, not the graph id: the
    // graph is named for the rung and the selection for what a user is looking
    // at, and a card looks a standing up by key.
    for (const [index, target] of targets.slice(sighted.length).entries()) {
      expect(target.id).toBe(attestedNodeId(producers[index].key));
      expect(target.selectionId).toBe(`${MINER_SELECTION_PREFIX}${producers[index].key}`);
      expect(target.bodyRadius).toBe(ATTESTED_HIT_RADIUS);
      expect(target.ringShare).toBeNull();
    }
    // The BODY target is the sprite and nothing else. It is deliberately the
    // smallest thing on this list — an anonymous rung buys no footprint on the
    // confidence axis — and it is why the ring's own stroke has to be a target
    // too; see 'the ring stroke is the producer's target' below.
    expect(ATTESTED_HIT_RADIUS).toBe(peerCloudHitRadius(PEER_CLOUD_ATTESTED_TONE));
    expect(ATTESTED_HIT_RADIUS).toBeLessThan(SIGHTED_HIT_RADII.advertised);
  });

  it('draws the rung as a point cloud at its own stop — ZERO new vertex attributes', () => {
    const nodes = source('ColonyNodes.tsx');
    // The fourth cloud off the one factory, exactly as the third was: a tone is
    // a creation-time uniform, so a stop can never cost a slot.
    expect(nodes).toContain('tone={PEER_CLOUD_ATTESTED_TONE}');
    expect(nodes).toContain('nodes={attested}');
    expect(nodes).not.toMatch(/setAttribute\('a(Attested|Producer|Miner)/);
    // …and it is wave-receptive like every other node here: same shockwave
    // uniforms, same context damping, no exemption.
    expect(nodes).toContain('shockwaveUniforms={shockwaveUniforms}');
  });
});

/**
 * The second axis — the one thing in this file that is not a stop on the
 * confidence gradient.
 */
describe('the producer rings', () => {
  const posById = new Map<string, Vec3>([
    [attestedNodeId(producerKey('a')), [1, 0, 0]],
    [attestedNodeId(producerKey('b')), [2, 0, 0]],
    ['QmC0', [10, 0, 0]],
    ['QmC1', [11, 0, 0]],
    ['QmC2', [12, 0, 0]],
  ]);
  const candidates = ['QmC0', 'QmC1', 'QmC2'].map((id) => rosterNode(id, true));

  it('gives every staged producer one whole ring, sized by its share alone', () => {
    const producers = [standing(producerKey('a'), 0.56), standing(producerKey('b'), 0.02)];
    const rings = producerRingInstances(producers, posById);
    expect(rings).toHaveLength(2);
    expect(rings.map((r) => r.share)).toEqual([0.56, 0.02]);
    expect(rings.map((r) => r.arcSweep)).toEqual([1, 1]);
    expect(rings.map((r) => r.arcStart)).toEqual([0, 0]);
    // Only a producer's own ring may ever discharge. A candidate is not KNOWN
    // to have mined anything, and a discharging arc would be exactly the
    // accusation the fan construction exists to refuse.
    expect(rings.every((r) => r.fires)).toBe(true);
  });

  // ⭐⭐⭐ THE STANDING COMES FROM THE VIEW, NOT FROM THE NODE. The App's
  // topology memo is keyed on the producer KEY SET alone and has to be, so
  // `inferredTopology` is not re-invoked when a tally moves and the standing
  // hanging off a staged node is whatever it was at the last key-set change.
  // A ring drawn from the node would be the right size about ten seconds ago.
  it('sizes a ring from the live window, never from the standing on the node', () => {
    const stale = [standing(producerKey('a'), 0.1)];
    const topology = inferredTopology(
      [peer('A')], 0xc0ffee, 'ckb:local', undefined, null, undefined, stale,
    );
    const node = topology.nodes.find((n) => n.kind === 'attested')!;
    expect(node.attested!.share).toBe(0.1);
    const places = new Map<string, Vec3>([[node.id, node.pos]]);
    // Same key set — so the topology above is exactly what App would still be
    // holding — with the window moved on underneath it.
    const live = [standing(producerKey('a'), 0.62)];
    expect(producerRingInstances(live, places)[0].share).toBe(0.62);
  });

  it('cuts a drawn fan into N arcs that compose exactly one ring', () => {
    const producers = [standing(producerKey('a'), 0.4, candidates)];
    const rings = producerRingInstances(producers, posById);
    const arcs = rings.filter((r) => !r.fires);
    expect(arcs).toHaveLength(candidates.length);
    // Every arc is 1/N of a turn, laid end to end from 0 — six peers showing
    // sixty degrees each, and the N of them overlaid are one whole producer.
    // That is the claim the join actually supports, drawn as the thing it is.
    for (const [index, arc] of arcs.entries()) {
      expect(arc.arcSweep).toBeCloseTo(1 / candidates.length, 12);
      expect(arc.arcStart).toBeCloseTo(index / candidates.length, 12);
      // The arc carries the PRODUCER's share and the PRODUCER's key: it is a
      // slice of the producer's ring standing on a peer, never a claim the
      // peer itself makes.
      expect(arc.share).toBe(0.4);
      expect(arc.producerKey).toBe(producerKey('a'));
      expect(arc.fires).toBe(false);
    }
    const covered = arcs.reduce((sum, arc) => sum + arc.arcSweep, 0);
    expect(covered).toBeCloseTo(1, 12);
    // …and each arc stands on its own candidate.
    expect(arcs.map((a) => a.pos)).toEqual(candidates.map((c) => posById.get(c.node_id)));
  });

  it('draws no fan at all where T4 withheld one, and never re-litigates a gate', () => {
    const rings = producerRingInstances([standing(producerKey('a'), 0.56)], posById);
    expect(rings.every((r) => r.fires)).toBe(true);
    expect(rings).toHaveLength(1);
  });

  // ⚠️ The roster is a bounded sample and the staging set is smaller still, so
  // a fan can name a peer with nowhere to stand. Re-dividing the ring among the
  // survivors would redraw N as M and make the claim look narrower than it is.
  it('leaves a gap for a candidate this colony is not standing a node for', () => {
    const producers = [standing(producerKey('a'), 0.4, candidates)];
    const partial = new Map(posById);
    partial.delete('QmC1');
    const arcs = producerRingInstances(producers, partial).filter((r) => !r.fires);
    expect(arcs).toHaveLength(2);
    // The survivors keep their OWN slots — 0/3 and 2/3, with 1/3 simply empty.
    expect(arcs.map((a) => a.arcStart)).toEqual([0, 2 / 3]);
    expect(arcs.every((a) => a.arcSweep === 1 / 3)).toBe(true);
  });

  it('has no ring for a producer the colony is not standing a node for', () => {
    // A pulse's producer and the colony's window are two readings of one
    // rolling window taken at different moments; a producer can be in one and
    // not the other. The ring is drawn AROUND a node, and there is no node.
    expect(producerRingInstances([standing(producerKey('z'), 0.5)], posById)).toEqual([]);
    expect(producerRingInstances(null, posById)).toEqual([]);
    expect(producerRingInstances(undefined, posById)).toEqual([]);
    expect(producerRingInstances([], posById)).toEqual([]);
  });

  it('charges everybody from one stamp and discharges exactly the winner', () => {
    const nodes = source('ColonyNodes.tsx');
    const ring = ringSource();
    // One shared uniform for the charge — that IS "all of them grinding on the
    // same parent block since the same instant" — and one per-instance stamp
    // for the win. Nothing has to be told that story.
    expect(ring).toContain('uChargeSince');
    expect(nodes).toContain('material.uniforms.uChargeSince.value = t0');
    expect(ring).toContain('1.0 - exp(-waited / max(uChargeTau, 0.05))');
    // ⭐ NEVER A FILL. Nobody knows when the next block lands, so a charge that
    // COMPLETED would assert an interval the chain never promised — the plate
    // this repo has already paid for once.
    expect(ring).not.toMatch(/charge\s*=\s*clamp\(waited/);

    // The winner is the flood's own entry node. Asking that question twice is
    // how the ring and the wave would come to disagree about which block this
    // was, and an anonymous block enters through a ghost so no ring fires.
    expect(nodes).toContain('cf.entryId.startsWith(ATTESTED_ID_PREFIX)');
    expect(nodes).toContain('fired.set(cf.entryId.slice(ATTESTED_ID_PREFIX.length), t0)');
    // t0 captured in this owner's OWN pulse effect, consume-then-bail on
    // backfill — the same shape every per-block armer in the colony holds.
    expect(nodes).toContain('const t0 = simClock.elapsedSec;');
    expect(nodes).toContain('if (backfillActive) return;');
    // The fire lane is keyed by PRODUCER KEY and written by one helper: the
    // staging order is blocks-descending, so the block that arms a discharge is
    // frequently the block that reorders the list under it.
    expect(nodes).toContain('fired.get(instance.producerKey) ?? PRODUCER_RING_UNFIRED');
    expect(nodes.match(/lanes\.fireAt\.needsUpdate = true/g)).toHaveLength(1);
  });

  // ⚠️ Every other material in this neighbourhood samples the block shockwave.
  // This one must not: the front crosses the whole colony on every block, so a
  // ring that answered it would brighten for EVERY producer — the scene showing
  // six machines discharging on a block exactly one of them won.
  it('stays silent on the block wave that lights every other layer', () => {
    const ring = ringSource();
    for (const reach of [
      "from './shockwaveMaterial'",
      'SHOCKWAVE_UNIFORMS_GLSL',
      'shockwaveSignalAt',
      'vShockwave',
    ]) {
      // …and the same words are asserted PRESENT next door, so this is a
      // measurement rather than four strings that were never going to appear.
      expect([reach, ring.includes(reach)]).toEqual([reach, false]);
      expect([reach, materialSource().includes(reach)]).toEqual([reach, true]);
    }
  });

  it('draws in the mesh\'s own token and invents no hue', () => {
    const ring = ringSource();
    expect(ring).toContain("import { PEER_NETWORK_PALETTE } from '../visualPalette'");
    expect(ring).toContain('setRGB(...PEER_NETWORK_PALETTE.scaffold)');
    // hudDiscipline holds this for the package; asserted here too because the
    // "no new hue" ruling is about THIS layer and a reader looks for it here.
    expect(ring).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it('keeps the documented arc→alpha fallback one knob away, not one rewrite', () => {
    const ring = ringSource();
    // §11's open item is a live-tune decision, so it ships as a live tune. At 0
    // a candidate carries its 1/N arc; at 1 it carries the whole ring at 1/N of
    // the light. A producer's own ring has sweep 1 and is identical either way.
    expect(ring).toContain('float sweep = mix(vArcSweep, 1.0, uArcFallback);');
    expect(ring).toContain('float dim = mix(1.0, vArcSweep, uArcFallback);');
    expect(source('ColonyNodes.tsx'))
      .toContain('material.uniforms.uArcFallback.value = LIVE.peer.ringArcFallback');
  });

  it('never lets a ring quad swallow the click aimed at the node inside it', () => {
    // The quad is centred on its own node and many times the node's mark
    // across, so a live raycast here would sit in front of that node's hit
    // sphere. The visible marks never compete with the pick layer.
    const nodes = source('ColonyNodes.tsx');
    const rings = nodes.indexOf('function ProducerRings(');
    const guard = nodes.indexOf('raycast={() => null}', rings);
    expect(rings).toBeGreaterThan(0);
    expect(guard).toBeGreaterThan(rings);
  });
});

/**
 * THE MARK IS ALSO THE TARGET — the half of "a staged node's invisible hit
 * sphere IS its mark" that the attested rung was missing.
 *
 * ⭐⭐ FOUND ON A REAL GPU, NOT IN THE SOURCE, and nothing in this suite could
 * have found it: no test here knows how big anything is on screen. A full-canvas
 * 13-pixel hover sweep of the running app came back with forty peers and ZERO
 * producers. The arithmetic underneath was plain once measured — the producer's
 * only target was its point sprite at 0.375 world units, UNDER the faintest
 * roster rung's 0.425 and therefore the smallest target in the colony, while
 * the ring around it was drawn from 1.4 out to 3.0. The node wearing the
 * largest mark in the scene was the hardest thing in it to click.
 *
 * The ruling: the ring's STROKE is a target, its INTERIOR is not. Everything
 * below is that sentence, in numbers.
 */
describe("the ring stroke is the producer's target", () => {
  /** CSS pixels per world unit at the default camera. Read off the plan's own
   *  measured ring radii (8-17 px drawn for world radii of 1.4-3.0, which agree
   *  to within a percent). A yardstick for an order-of-magnitude check on the
   *  ONE number this feature had to guess — never a claim about a camera, and
   *  never something a later retune has to keep true. */
  const PX_PER_WORLD = 5.7;

  const KEY = producerKey('a');
  const NODE_ID = attestedNodeId(KEY);
  const CANDIDATE_IDS = ['Qm0001', 'Qm0002', 'Qm0004'];
  const candidates = CANDIDATE_IDS.map((id) => rosterNode(id, true));
  const places = new Map<string, Vec3>([
    [NODE_ID, [1, 0, 0]],
    ...CANDIDATE_IDS.map((id, i): [string, Vec3] => [id, [10 + i, 0, 0]]),
  ]);

  /** The colony as App composes it: the ring plan first, the pick plan cut from
   *  it. Building them in that order here is the point of the fixture. */
  function stage(share: number, fan: RosterNode[] | null) {
    const producers = [standing(KEY, share, fan)];
    const topology = inferredTopology(
      [peer('A')], 0xc0ffee, 'ckb:local', undefined, ROSTER, undefined, producers,
    );
    const sighted = topology.nodes.filter((n) => n.kind === 'sighted');
    const attested = topology.nodes.filter((n) => n.kind === 'attested');
    const posById = new Map<string, Vec3>(topology.nodes.map((n) => [n.id, n.pos]));
    const rings = producerRingInstances(producers, posById);
    return {
      producers, topology, sighted, attested, rings,
      targets: stagedPickTargets(sighted, attested, rings),
    };
  }

  const annulus = (share: number): StagedPickTarget => ({
    id: NODE_ID,
    selectionId: `${MINER_SELECTION_PREFIX}${KEY}`,
    pos: [0, 0, 0],
    bodyRadius: null,
    ringShare: share,
  });

  it('cuts every annulus from the very list that draws the rings', () => {
    const { rings, targets } = stage(0.62, null);
    const drawn = rings.filter((r) => r.fires);
    const annuli = targets.filter((t) => t.ringShare !== null);
    expect(drawn).toHaveLength(1);
    // One target per DRAWN ring, standing where that ring stands, sized by the
    // share that ring is sized by. There is no second source for either.
    expect(annuli).toHaveLength(drawn.length);
    expect(annuli.map((t) => t.pos)).toEqual(drawn.map((r) => r.pos));
    expect(annuli.map((t) => t.ringShare)).toEqual(drawn.map((r) => r.share));
    expect(annuli.map((t) => t.selectionId))
      .toEqual(drawn.map((r) => `${MINER_SELECTION_PREFIX}${r.producerKey}`));
    // …so a producer the colony stands no node for has neither ring nor target.
    expect(producerRingInstances([standing(producerKey('z'), 0.5)], places)).toEqual([]);
    expect(stagedPickTargets([], [], []).filter((t) => t.ringShare !== null)).toEqual([]);
  });

  it('follows the same share-scaled radius the ring is drawn at, under a retune too', () => {
    const material = makeProducerRingMaterial();
    // The vertex shader sizes the quad from these two uniforms; the annulus is
    // resolved from the same two numbers through `producerRingRadius`. Their
    // ZERO-DRIFT seeds are what makes "the same radius" checkable at rest.
    expect(material.uniforms.uRingMinRadius.value).toBe(PRODUCER_RING_MIN_RADIUS);
    expect(material.uniforms.uRingShareRadius.value).toBe(PRODUCER_RING_SHARE_RADIUS);
    material.dispose();
    expect(producerRingRadius(0)).toBe(PRODUCER_RING_MIN_RADIUS);
    expect(producerRingRadius(1)).toBe(PRODUCER_RING_MIN_RADIUS + PRODUCER_RING_SHARE_RADIUS);
    // The band is centred exactly on the stroke, at every share…
    for (const share of [0, 0.02, 0.25, 0.62, 1]) {
      const { inner, outer } = stagedPickBounds(annulus(share));
      expect((inner + outer) / 2).toBeCloseTo(producerRingRadius(share), 12);
      expect(outer - inner).toBeCloseTo(2 * PRODUCER_RING_HIT_BAND, 12);
    }
    // …and under a live retune of either knob, which is the case a plan
    // captured at memo time would have got wrong while somebody was tuning.
    const retuned = stagedPickBounds(annulus(0.62), 4, 8);
    expect((retuned.inner + retuned.outer) / 2)
      .toBeCloseTo(producerRingRadius(0.62, 4, 8), 12);
    const nodes = source('ColonyNodes.tsx');
    // Both halves read the SAME two knobs — the ring's uniforms and the pick
    // plan's radii — which is the whole of "one source".
    expect(nodes).toContain('material.uniforms.uRingMinRadius.value = LIVE.peer.ringRadiusMin');
    expect(nodes).toContain('material.uniforms.uRingShareRadius.value = LIVE.peer.ringRadiusShare');
    expect(nodes).toContain('const ringMinRadius = LIVE.peer.ringRadiusMin');
    expect(nodes).toContain('const ringShareRadius = LIVE.peer.ringRadiusShare');
    // …and the pick surface notices a drag on either, rather than waiting for
    // the next topology rebuild to catch up.
    expect(nodes).toContain('if (LIVE.peer.ringRadiusMin === minRadius');
    expect(nodes).toContain('&& LIVE.peer.ringRadiusShare === shareRadius) return;');
  });

  it('is a band on the stroke and never the disc inside it', () => {
    const { inner, outer } = stagedPickBounds(annulus(0.62));
    const radius = producerRingRadius(0.62);
    expect(inner).toBeGreaterThan(0);
    // The ruling, as four samples: the middle of the ring belongs to whatever
    // stands there, the stroke belongs to the producer, and past the tolerance
    // it is somebody else's pixel again.
    expect(producerAnnulusHit(0, inner, outer)).toBe(false);
    expect(producerAnnulusHit(inner * 0.99, inner, outer)).toBe(false);
    expect(producerAnnulusHit(radius, inner, outer)).toBe(true);
    expect(producerAnnulusHit(outer * 1.01, inner, outer)).toBe(false);
    // A REJECTED alternative, kept measurable: the full disc would have taken
    // the whole interior off everything standing in it, and on the dominant
    // producer that interior is most of a 17-pixel circle.
    expect(inner * PX_PER_WORLD).toBeGreaterThan(10);
  });

  it('is a band a pointer can land on, over a stroke that is not', () => {
    // The one number this feature had to guess. A tolerance of ±0.8 world units
    // is 1.6 across — about nine CSS pixels, the ordinary allowance a hairline
    // gets in any interface, and the middle of the 8-12 px it was aimed at.
    expect(2 * PRODUCER_RING_HIT_BAND * PX_PER_WORLD).toBeGreaterThanOrEqual(8);
    expect(2 * PRODUCER_RING_HIT_BAND * PX_PER_WORLD).toBeLessThanOrEqual(12);
    // The drawn stroke is a Gaussian sigma, and on its own it is nowhere near
    // clickable — which is why the target is a tolerance and not the stroke.
    expect(2 * PRODUCER_RING_WIDTH * PX_PER_WORLD).toBeLessThan(4);
    expect(PRODUCER_RING_HIT_BAND / PRODUCER_RING_WIDTH).toBeGreaterThan(2);
    // …and the band alone is wider than the whole mark of the rung this node's
    // own sprite used to sit UNDER. That inversion is the defect.
    const { inner, outer } = stagedPickBounds(annulus(0.62));
    expect(outer - inner).toBeGreaterThan(2 * SIGHTED_HIT_RADII.advertised);
    expect(ATTESTED_HIT_RADIUS).toBeLessThan(SIGHTED_HIT_RADII.advertised);
  });

  it('never closes over the body target inside it, at any share', () => {
    // ⚠️ ANNULUS OR BODY, never annulus instead of body. A user aiming at the
    // node itself must still hit the node, and the hole is where that happens —
    // so the tolerance may never reach in as far as the sprite, at the smallest
    // ring this colony can draw or any larger one.
    for (const share of [0, 0.001, 0.02, 0.25, 0.62, 1]) {
      expect(stagedPickBounds(annulus(share)).inner).toBeGreaterThan(ATTESTED_HIT_RADIUS);
    }
    const { targets } = stage(0.62, null);
    const mine = targets.filter((t) => t.selectionId === `${MINER_SELECTION_PREFIX}${KEY}`);
    expect(mine).toHaveLength(2);
    expect(mine.map((t) => t.id)).toEqual([NODE_ID, NODE_ID]);
    // The BODY is planned first, so a `find` by selection id reaches the node's
    // own radius — a reticle drawn at the annulus would circle the ring.
    expect(mine[0].bodyRadius).toBe(ATTESTED_HIT_RADIUS);
    expect(mine[0].ringShare).toBeNull();
    expect(mine[1].bodyRadius).toBeNull();
    expect(mine[1].ringShare).toBe(0.62);
    expect(source('ColonyNodes.tsx'))
      .toContain("(t) => t.selectionId === selectedId && t.bodyRadius !== null,");
    // Exactly one of the two fields is ever set, across every tier.
    for (const target of targets) {
      expect([target.bodyRadius === null, target.ringShare === null]).toEqual(
        [target.bodyRadius === null, !(target.bodyRadius === null)],
      );
    }
  });

  // ⚠️⚠️ AN ARC IS NOT A PRODUCER TARGET. It stands on a CANDIDATE PEER and
  // means "may be the same machine"; clicking that peer must open its own
  // PEER / SIGHTED card, which carries the `MINER?` stamp and the size of the
  // set. Note that an arc carries the PRODUCER's key and the PRODUCER's share —
  // filtering the pick plan on either would have turned every candidate into a
  // MINER target, which is the exact identification the fan refuses to make.
  it('gives a candidate arc no producer target at all', () => {
    const { rings, targets, sighted } = stage(0.4, candidates);
    const arcs = rings.filter((r) => !r.fires);
    expect(arcs).toHaveLength(candidates.length);
    expect(arcs.every((a) => a.producerKey === KEY && a.share === 0.4)).toBe(true);
    const annuli = targets.filter((t) => t.ringShare !== null);
    expect(annuli).toHaveLength(1);
    expect(annuli[0].id).toBe(NODE_ID);
    // No target stands where an arc stands, other than that peer's own body.
    for (const arc of arcs) {
      const here = targets.filter((t) => t.pos === arc.pos);
      expect(here).toHaveLength(1);
      expect(here[0].ringShare).toBeNull();
      expect(here[0].selectionId).toBe(`sighted:${here[0].id}`);
      expect(here[0].selectionId.startsWith(MINER_SELECTION_PREFIX)).toBe(false);
    }
    // …and every candidate the colony IS standing a node for is still a plain
    // sighted target, at its own stop's radius.
    const staged = sighted.filter((n) => CANDIDATE_IDS.includes(n.id));
    expect(staged.length).toBeGreaterThan(0);
    for (const node of staged) {
      const target = targets.find((t) => t.id === node.id)!;
      expect(target.selectionId).toBe(`sighted:${node.id}`);
      expect(target.bodyRadius).toBe(SIGHTED_HIT_RADII[sightedStop(node)]);
    }
    expect(source('ColonyNodes.tsx')).toContain('if (!ring.fires) continue;');
  });

  it('is the same band from any camera angle, because a billboard has no plane', () => {
    // The ring faces the camera, so the world points that project onto its
    // stroke are the ones standing a ring-radius off the node ACROSS THE VIEW —
    // which is the perpendicular distance from the pointer ray to that node,
    // and nothing that has to be kept in sync with an orientation.
    const { inner, outer } = stagedPickBounds(annulus(0.62));
    const radius = producerRingRadius(0.62);
    const node = new THREE.Vector3(3, -2, 5);
    const looks = [[0, 0, -1], [1, 0.2, -1], [0.4, 0.9, -0.2], [-0.7, -0.3, 0.6]];
    for (const look of looks) {
      const direction = new THREE.Vector3(look[0], look[1], look[2]).normalize();
      const side = new THREE.Vector3(0.31, 0.77, 0.55)
        .cross(direction).normalize();
      const eye = node.clone().addScaledVector(direction, -40);
      const at = (off: number) => producerAnnulusHit(
        new THREE.Ray(eye.clone().addScaledVector(side, off), direction)
          .distanceToPoint(node),
        inner, outer,
      );
      expect([look, at(0)]).toEqual([look, false]);
      expect([look, at(inner * 0.9)]).toEqual([look, false]);
      expect([look, at(radius)]).toEqual([look, true]);
      expect([look, at(outer * 1.1)]).toEqual([look, false]);
    }
  });

  it('keeps ONE hit mesh, and re-bounds it over the annulus every time it moves', () => {
    const nodes = source('ColonyNodes.tsx');
    // ⚠️ three computes an InstancedMesh's bounding sphere ONCE and caches it,
    // and rejects every raycast against it before looking at an instance. The
    // annulus is several times the widest sphere this mesh used to hold, so a
    // stale volume here does not cost producers their clicks — it costs EVERY
    // staged node its click, silently.
    const walk = nodes.indexOf('const applyInstances = () => {');
    const after = nodes.indexOf('useEffect(() => {\n    applyInstances();', walk);
    expect(walk).toBeGreaterThan(0);
    expect(after).toBeGreaterThan(walk);
    const body = nodes.slice(walk, after);
    expect(body).toContain('mesh.setMatrixAt(index, SCRATCH_MATRIX)');
    expect(body).toContain('mesh.computeBoundingSphere()');
    expect(body).toContain('outer / HIT_SPHERE_INSCRIBED');
    // One walk writes the matrices AND the bounds the filter reads, so the two
    // cannot describe different spheres.
    expect(body).toContain('bounds.inner[index] = inner');
    expect(body).toContain('bounds.outer[index] = outer');
    expect(nodes.match(/mesh\.computeBoundingSphere\(\)/g)).toHaveLength(1);
    // Still ONE instanced mesh over both staged tiers, on the existing
    // arbitration path — the annulus is a filter on three's own raycast, not a
    // second target layer with its own reject and its own hover guards.
    expect(nodes.match(/<instancedMesh/g)).toHaveLength(3);
    expect(nodes).toContain('BASE_INSTANCED_RAYCAST.call(this, raycaster, SCRATCH_HITS)');
    expect(nodes).toContain('const hitUserData = useMemo(() => ({ [NETWORK_PEER_PICK_FLAG]: true }), [])');
    expect(nodes).toContain('raycast={hitRaycast}');
  });

  it('resolves the annulus at the depth the ring is drawn at', () => {
    // ⚠️ The instance is a BALL and the ring is a BILLBOARD. The ball's near
    // face stands up to a couple of world units in front of the node, so left
    // alone it would win the distance sort against anything that happened to
    // lie under the stroke. The hit is re-stamped onto the plane the ring is
    // actually on, so two overlapping marks resolve by which is really nearer.
    const nodes = source('ColonyNodes.tsx');
    expect(nodes).toContain('hit.distance = SCRATCH_TOWARDS.copy(SCRATCH_CENTER)');
    expect(nodes).toContain('.dot(ray.direction);');
    expect(nodes).toContain('ray.at(hit.distance, hit.point);');
  });
});
