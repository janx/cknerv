import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { render, renderHook } from '@testing-library/react';
import { Canvas } from '@react-three/fiber';
import ColonyIntakeMotes, {
  COLONY_INTAKE_SEGMENT_CAP,
  colonyIntakeSegments,
  sameIntakeSegment,
} from '../../src/components/ColonyIntakeMotes';
import ColonyNodes, {
  ATTESTED_HIT_RADIUS,
  COLONY_DRAWS,
  MINER_SELECTION_PREFIX,
  partitionByKind,
  partitionByStop,
  SIGHTED_FALLTHROUGH_STOP,
  SIGHTED_HIT_RADII,
  SIGHTED_STOPS,
  sightedStop,
  stagedPickTargets,
  useStableList,
  type ColonyDraw,
  type SightedStop,
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
  PEER_CLOUD_SIGHTED_DARK_TONE,
  PEER_CLOUD_SIGHTED_TONE,
  type PeerCloudTone,
} from '../../src/materials/peerNodeMaterial';
import type { ProducerStanding } from '../../src/derives/blockProducers.derive';
import type { NetworkNode, NetworkTopology, NodeKind, Vec3 } from '../../src/types';
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
    // miners and no roster unable to click any of them.
    expect(nodes).toContain('onSelect(target.selectionId)');
    expect(nodes).toContain('stagedPickTargets(sighted, attested)');
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

  // ⭐⭐ THE ONE RUNG WHOSE TWO FIELDS ARE ANSWERING DIFFERENT QUESTIONS.
  // Everywhere else on this axis, brightness and footprint move together and
  // the convergence test above holds each step to a quarter again of both.
  // This rung is not a step: `dim` is the identification claim and it has
  // none, so it stays wedged between the invented haze and the faintest named
  // stop; `size` is the pick target, and the chain has a card's worth to say
  // about this node, so it is large enough to press. Held as two assertions
  // because it is two claims.
  it('keeps the attested rung anonymous on the axis that means identification', () => {
    for (const field of [restingDim, eventDim] as const) {
      expect(field(PEER_CLOUD_ATTESTED_TONE)).toBeGreaterThan(field(PEER_CLOUD_GHOST_TONE));
      expect(field(PEER_CLOUD_ATTESTED_TONE)).toBeLessThan(field(PEER_CLOUD_ADVERTISED_TONE));
    }
    // It rests UNDER the additive clip, like the haze and unlike every named
    // stop: what a viewer gets is a wide soft pool, never a bright nucleus.
    expect(plateauFraction(PEER_CLOUD_ATTESTED_TONE)).toBe(0);
    // …and it is NOT one of the crawler's stops, so the ladder those are held
    // to is unchanged by its existence.
    expect(Object.values(SIGHTED_STOPS)).not.toContain(PEER_CLOUD_ATTESTED_TONE);
  });

  it('buys footprint without buying light, which is what no rung ever does', () => {
    // ⭐⭐ THIS IS WHY A SIZE STEP HERE CANNOT READ AS A CONFIDENCE CLAIM, and
    // it is a property rather than a promise. On the crawler's ladder a bigger
    // mark is ALWAYS a brighter one — 'every rung of the ladder is strictly
    // above the one below it' asserts exactly that, on both fields at once. So
    // a mark that is WIDER than a stop while resting DIMMER than it matches no
    // rung and can be mistaken for none. The attested tone is that mark
    // against every stop it out-sizes.
    const outsized = LADDER.filter(
      ([, tone]) => diameter(PEER_CLOUD_ATTESTED_TONE) > diameter(tone),
    );
    // Not vacuous, and this is the half the old tone failed: at 0.75 it
    // out-sized only the invented haze, which is a perfectly legal rung — and
    // an unclickable mark.
    const named = outsized.filter(([, tone]) => tone !== PEER_CLOUD_GHOST_TONE);
    expect(named.length).toBeGreaterThan(0);
    for (const [name, tone] of named) {
      expect([name, restingDim(PEER_CLOUD_ATTESTED_TONE) < restingDim(tone)])
        .toEqual([name, true]);
    }
    // The haze is the one stop it out-sizes AND out-shines, and that pair is
    // honest rather than an exception: a node the chain proves outranks an
    // invented one on every reading there is.
    expect(diameter(PEER_CLOUD_ATTESTED_TONE)).toBeGreaterThan(diameter(PEER_CLOUD_GHOST_TONE));
    expect(restingDim(PEER_CLOUD_ATTESTED_TONE)).toBeGreaterThan(restingDim(PEER_CLOUD_GHOST_TONE));
    // And the mark a viewer sees lands between the two stops that mean somebody
    // got a packet back — big enough to aim at, and never the largest thing on
    // the stage. That still belongs to the peer the crawler reached this round.
    const mark = visibleExtent(PEER_CLOUD_ATTESTED_TONE);
    expect(mark).toBeGreaterThan(visibleExtent(PEER_CLOUD_SIGHTED_DARK_TONE));
    expect(mark).toBeLessThan(visibleExtent(PEER_CLOUD_SIGHTED_TONE));
  });

  it('stands one hit target per staged node across BOTH tiers, sized from its own mark', () => {
    const sighted = topology.nodes.filter((n) => n.kind === 'sighted');
    const attested = topology.nodes.filter((n) => n.kind === 'attested');
    const targets = stagedPickTargets(sighted, attested);
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
    }
    // ⚠️ THE TARGET IS THE SPRITE, AND IT HAS TO BE BIG ENOUGH TO PRESS. At
    // 0.375 world units this was the SMALLEST target in the colony, under the
    // faintest roster rung's 0.425, and a full-canvas 13-pixel hover sweep of
    // the running app found forty peers and not one miner. No unit test can
    // see a pixel, so what is pinned here is the ordering the measurement
    // implied: the node the chain proves and can say a card's worth about is
    // never a harder target than the node nobody has ever answered.
    expect(ATTESTED_HIT_RADIUS).toBe(peerCloudHitRadius(PEER_CLOUD_ATTESTED_TONE));
    expect(ATTESTED_HIT_RADIUS).toBeGreaterThan(SIGHTED_HIT_RADII.advertised);
    expect(ATTESTED_HIT_RADIUS).toBeGreaterThan(SIGHTED_HIT_RADII.remembered);
    // …and still never the largest: a peer the crawler reached this round is
    // the best-known thing on the stage and keeps the biggest target on it.
    expect(ATTESTED_HIT_RADIUS).toBeLessThan(SIGHTED_HIT_RADII.reached);
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

describe('the block wave reports where it started', () => {
  it('observes on the pulse edge that stamps the wave, and only there', () => {
    const nodes = source('ColonyNodes.tsx');
    // ⭐ NOT inside `colonyFlood`, which is a memo App re-runs on every topology
    // rebuild — counted there, one block would be counted many times. The edge
    // this owner already guards with `blockPulseAtMs` fires once per block.
    expect(nodes).toContain('producerOriginStats.observeWave(cf.entryId);');
    expect(nodes.match(/producerOriginStats\.observeWave\(/g)).toHaveLength(1);
    expect(nodes).toContain('if (blockPulseAtMs <= lastPulseRef.current) return;');
    // The id the FLOOD chose, so what is counted is where the scene actually
    // started the wave — the only thing a viewer can see, and the only thing
    // the oracle is about.
    const armed = nodes.indexOf('producerOriginStats.observeWave(cf.entryId);');
    const edge = nodes.lastIndexOf('lastPulseRef.current = blockPulseAtMs;', armed);
    expect(edge).toBeGreaterThan(0);
    expect(armed).toBeGreaterThan(edge);
    // A backfill catch-up consumes the pulse and stamps nothing, so it is
    // counted as itself rather than as a wave that never started.
    expect(nodes).toContain('producerOriginStats.observeSuppressed();');
    expect(nodes.match(/producerOriginStats\.observeSuppressed\(\)/g)).toHaveLength(1);
    // An instrument, not a feature: nothing here renders it, and it costs the
    // render path one increment on an edge it was already handling.
    expect(nodes).not.toMatch(/producerOriginStats\.(waves|attested|anonymous|byProducer)/);
    expect(nodes).not.toContain('snapshotProducerOriginStats');
  });
});

/**
 * THE MINING CHANNEL, second cut. The first one gave mining the motion channel
 * and then spent it on brightness modulation of a static ring — nothing
 * travelled, so nothing was absorbed — and a hard geometric circle was neither
 * of this scene's two primitives. What travels now is a mote, on the miner's
 * own links, drawn in.
 */
describe('what a mining node draws in', () => {
  const peers = [peer('A'), peer('B')];
  const producers = [
    standing(producerKey('a'), 0.56),
    standing(producerKey('b'), 0.02),
  ];
  const topology = inferredTopology(
    peers, 0xc0ffee, 'ckb:local', undefined, ROSTER, undefined, producers,
  );
  const intakeSource = () => readFileSync(
    resolve(process.cwd(), 'src/materials/colonyIntakeMotes.ts'),
    'utf8',
  );

  it('mounts a colony of miners inside an r3f Canvas without throwing', () => {
    expect(() => render(
      <Canvas>
        <ColonyIntakeMotes
          topology={topology}
          producers={producers}
          cf={colonyFlood(topology, 1, producers[0].key)}
          blockPulseAtMs={0}
        />
      </Canvas>,
    )).not.toThrow();
  });

  it('draws a stream on every link a miner has, and on no other link', () => {
    const segments = colonyIntakeSegments(topology);
    const minerIds = new Set(
      topology.nodes.filter((n) => n.kind === 'attested').map((n) => n.id),
    );
    expect(minerIds.size).toBe(producers.length);
    // One segment per (link, miner) pair — the whole incidence, nothing else.
    const expected = topology.edges.flatMap((e) => (
      [[e.a, e.b], [e.b, e.a]].filter(([to]) => minerIds.has(to))
    ));
    expect(segments).toHaveLength(expected.length);
    expect(segments.length).toBeGreaterThan(0);
    for (const seg of segments) {
      expect(minerIds.has(seg.nodeId)).toBe(true);
      expect(minerIds.has(seg.fromId) && seg.fromId === seg.nodeId).toBe(false);
    }
    // Every miner the colony stands is fed; a miner with no stream would be a
    // node the scene says nothing about.
    expect(new Set(segments.map((s) => s.nodeId))).toEqual(minerIds);
  });

  it('points every stream INWARD, and bakes that into the buffer rather than a sign', () => {
    const segments = colonyIntakeSegments(topology);
    const posById = new Map(topology.nodes.map((n) => [n.id, n.pos] as const));
    for (const seg of segments) {
      // `to` is the miner's own node and `from` is the far end of a real link.
      expect(seg.to).toEqual(posById.get(seg.nodeId));
      expect(seg.from).toEqual(posById.get(seg.fromId));
      expect(seg.length).toBeGreaterThan(0);
      expect(seg.phase).toBeGreaterThanOrEqual(0);
      expect(seg.phase).toBeLessThan(1);
    }
    // ⭐ DIRECTION IS THE VERTEX ORDER. The far end is param 0, the node is
    // param 1, and the shader only ever travels 0 → 1 — so there is no sign to
    // get backwards and no arrangement of this material that draws a mote
    // leaving. That is what makes "inward" structural rather than tuned.
    const layer = source('ColonyIntakeMotes.tsx');
    expect(layer).toContain('param[2 * i] = 0;');
    expect(layer).toContain('param[2 * i + 1] = 1;');
    expect(intakeSource()).toContain('float travel = pow(u, uEase);');
    expect(intakeSource()).toContain('float d = (vParam - travel) / sigma;');
  });

  it('feeds both ends of a link between two miners rather than picking one', () => {
    const a = attestedNodeId(producerKey('a'));
    const b = attestedNodeId(producerKey('b'));
    const twoMiners: NetworkTopology = {
      provenance: 'inferred',
      localId: 'ckb:local',
      nodes: [
        { id: a, kind: 'attested', pos: [0, 0, 0] as Vec3, attested: producers[0] },
        { id: b, kind: 'attested', pos: [3, 0, 4] as Vec3, attested: producers[1] },
      ],
      edges: [{ a, b, kind: 'inferred', weight: 5 }],
      adjacency: new Map(),
    };
    const segments = colonyIntakeSegments(twoMiners);
    expect(segments.map((s) => s.nodeId).sort()).toEqual([a, b].sort());
    // …and each one measures the same link, from its own end.
    for (const seg of segments) expect(seg.length).toBeCloseTo(5, 10);
  });

  it('reads no standing at all, so a window that moved cannot move the geometry', () => {
    // ⭐⭐ THE SPLIT THAT KEEPS THE BUFFERS STILL. A miner's blocks and share
    // change on EVERY block while its key, its placement and its links do not,
    // so a plan that read the window would rebuild this layer once a block —
    // and a rebuilt buffer takes the fire lane with it, which is exactly how
    // the colony's edge surge learned to truncate its own wavefront.
    expect(colonyIntakeSegments.length).toBeLessThanOrEqual(2); // (topology, cap)
    const layer = source('ColonyIntakeMotes.tsx');
    expect(layer).toContain('const plan = useMemo(() => colonyIntakeSegments(topology), [topology]);');
    // The share reaches the GPU through a lane written in place instead.
    expect(layer).toContain("geom.getAttribute('aShare') as THREE.BufferAttribute");
    expect(layer).toContain('}, [geom, producers, segments]);');
    expect(layer).not.toMatch(/useMemo\([^)]*producers[^)]*\)/);
    // …and the plan is walked in EDGE order, so two miners swapping places in
    // the standings renumbers nothing.
    expect(layer).toContain('for (const edge of topology.edges) {');
  });

  it('holds its buffers across a rebuild that moved nothing it draws', () => {
    // The colony rebuilds its topology on every peer poll. A measured ping
    // moves no miner and no link of one, so the plan must be the same plan.
    const later = inferredTopology(
      [{ ...peer('A'), latency_ms: 220 }, peer('B')],
      0xc0ffee, 'ckb:local', undefined, ROSTER, undefined, producers,
    );
    const before = colonyIntakeSegments(topology);
    const after = colonyIntakeSegments(later);
    expect(after).not.toBe(before);
    expect(after).toHaveLength(before.length);
    expect(before.every((seg, i) => sameIntakeSegment(seg, after[i]))).toBe(true);
    const held = renderHook(({ list }) => useStableList(list, sameIntakeSegment), {
      initialProps: { list: before },
    });
    held.rerender({ list: after });
    expect(held.result.current).toBe(before);

    // ⚠️ …and a stream whose ENDS MOVED must break it. A reseed keeps every
    // `inf:n` id while moving every point, so a test on ids alone would call an
    // entirely rearranged colony unchanged and leave these lines hanging in the
    // space the old one used to occupy — the same trap the ghost cloud names on
    // its own held list, which is why it holds by object identity.
    const [seg] = before;
    expect(sameIntakeSegment(seg, { ...seg, from: [...seg.from] as Vec3 })).toBe(true);
    expect(sameIntakeSegment(seg, {
      ...seg, from: [seg.from[0] + 1, seg.from[1], seg.from[2]],
    })).toBe(false);
    expect(sameIntakeSegment(seg, {
      ...seg, to: [seg.to[0], seg.to[1], seg.to[2] - 1],
    })).toBe(false);
  });

  it('stands no geometry at all for a colony with no miners in its window', () => {
    const bare = inferredTopology(peers, 0xc0ffee, 'ckb:local', undefined, ROSTER);
    expect(colonyIntakeSegments(bare)).toEqual([]);
  });

  it('stops at a cap and says so, rather than sizing a buffer off the wire', () => {
    const segments = colonyIntakeSegments(topology, 3);
    expect(segments).toHaveLength(3);
    expect(COLONY_INTAKE_SEGMENT_CAP).toBeGreaterThan(segments.length);
    const layer = source('ColonyIntakeMotes.tsx');
    expect(layer).toContain('cappedLogged.current = true;');
    expect(layer).toContain('console.warn(');
  });

  // ⚠️⚠️ THE ONE READING THAT WOULD INVERT THE MEANING. A courier glint says
  // "a block is ARRIVING here"; this says "this node is DRAWING energy in".
  // Six differences ship, and the ones asserted here are the four a later edit
  // could quietly undo.
  it('cannot be mistaken for a courier glint, and mostly cannot become one', () => {
    const material = intakeSource();
    const layer = source('ColonyIntakeMotes.tsx');
    const courier = source('ColonyCourierLayer.tsx');

    // FORM. A band on the line primitive itself: no quad to billboard, no head
    // to stretch, so it is structurally incapable of growing the plume that
    // makes a courier a courier. The courier's own machinery, for contrast.
    expect(layer).toContain('<lineSegments');
    expect(layer).not.toContain('InstancedMesh');
    expect(layer).not.toMatch(/PlaneGeometry|Sprite|makeCourier/);
    expect(courier).toContain('makeCourierPlumeTexture');

    // MOTION. Ease IN — slow off the far end, accelerating into the node —
    // against the courier's easeOutCubic fling.
    expect(material).toContain('pow(u, uEase)');
    expect(layer).not.toContain('easeOutCubic');
    expect(courier).toContain('easeOutCubic(t)');

    // WHEN. Continuous, driven by the clock alone. The courier's whole
    // existence is an age measured from a stamped pulse.
    expect(material).toContain('fract(uTime * rate + vPhase)');
    expect(courier).toContain('simClock.elapsedSec - pulse.at');

    // COLOUR. The mesh's own scaffold token, never the block's carrier hue —
    // which is what a courier is tinted with, per block.
    expect(material).toContain('PEER_NETWORK_PALETTE.scaffold');
    expect(material).not.toContain('consensusBlockColor');
    expect(layer).not.toContain('consensusBlockColor');
    expect(courier).toContain('consensusBlockColor(blockPulseAtMs)');
  });

  it('never samples the block shockwave, which would feed every miner at once', () => {
    // ⚠️ The front crosses the WHOLE colony on every block. A wave-receptive
    // intake would surge for every miner as it passed — the scene showing six
    // machines being fed by a block exactly one of them won. The point cloud
    // underneath stays fully wave-receptive; this layer answers only its own
    // clock and its own node's win.
    const material = intakeSource();
    const layer = source('ColonyIntakeMotes.tsx');
    expect(material).not.toMatch(/[Ss]hockwave/);
    expect(layer).not.toMatch(/shockwaveMaterial|shockwaveUniforms/);
  });

  it('spends the winner and nobody else, off the flood the wave itself used', () => {
    const layer = source('ColonyIntakeMotes.tsx');
    // The entry node the flood ALREADY chose, not a second lookup of the same
    // key: asking twice is how this layer and the wave would come to disagree
    // about which block it was. An anonymous block enters through a ghost and
    // spends nothing.
    expect(layer).toContain("if (cf.entryId === null || !cf.entryId.startsWith(ATTESTED_ID_PREFIX)) return;");
    expect(layer).toContain('if (seg.nodeId !== winner) return;');
    // Its own t0, its own pulse edge, consume-then-bail on backfill — the
    // flood-sync contract every per-block armer in this colony keeps.
    expect(layer).toContain('if (blockPulseAtMs <= lastPulseRef.current) return;');
    const consume = layer.indexOf('lastPulseRef.current = blockPulseAtMs;');
    const bail = layer.indexOf('if (backfillActive) return;');
    expect(consume).toBeGreaterThan(-1);
    expect(bail).toBeGreaterThan(consume);
    expect(layer).toContain('const t0 = simClock.elapsedSec;');
    expect(layer).toContain('}, [blockPulseAtMs]);');
    // One update-range mark for the whole walk, never one per write.
    expect(layer).toContain('if (stamped) attr.needsUpdate = true;');
  });

  it('says the share as a RATE and never a second time as brightness', () => {
    // ⭐ A miner holding more of the window pulls FASTER; every mote is the
    // same width and the same light whoever it belongs to. Encoding the share
    // twice would say one fact twice — and would make a miner with four blocks
    // look like a rounding error rather than a machine that made four blocks,
    // which is why the rate has a floor rather than reaching zero.
    const material = intakeSource();
    const rate = material.slice(material.indexOf('float rate = uSpeed'));
    expect(rate).toContain('mix(uRateFloor, 1.0, clamp(vShare, 0.0, 1.0))');
    // vShare reaches the rate and nothing else: not the amplitude, not the
    // width, not the birth ramp.
    expect(material.match(/vShare/g)).toHaveLength(4); // 2 declarations, 1 assign, 1 read
    expect(material).not.toMatch(/uAmp[^;]*vShare|uWidth[^;]*vShare/);
  });

  it('needs no rotation maths at all, because it is drawn on the links themselves', () => {
    // The courier and the delivery both stand OUTSIDE the counter-rotating
    // group and carry every point and axis through `colonyFrame.rotationY`
    // themselves, because their billboard bases are world-frame. A mark drawn
    // on a link has no basis to rebuild: it rides the group transform for
    // free. (Where it mounts is the rotation contract's own test.)
    expect(source('ColonyIntakeMotes.tsx')).not.toContain('colonyFrame');
    expect(source('ColonyCourierLayer.tsx')).toContain('colonyFrame.rotationY');
  });
});
