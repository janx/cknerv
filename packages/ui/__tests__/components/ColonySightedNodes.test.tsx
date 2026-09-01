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
import ColonyCohorts, {
  COHORT_MARK_CAP,
  cohortMarks,
  sameCohortMark,
} from '../../src/components/ColonyCohorts';
import {
  COHORT_CORE_AMP,
  COHORT_CORE_HALF,
  COHORT_HIT_RADIUS,
  COHORT_INTAKE_HALF_EXTENT,
  COHORT_INTAKE_MOUTH,
  COHORT_INTAKE_REACH,
  cohortIntakeHalfExtent,
  makeCohortCoreMaterial,
  makeCohortIntakeMaterial,
} from '../../src/materials/colonyCohort';
import { peerSchema } from '../../src/tweaks/tweakSchema';
import { PERFORMANCE_PROBE_LABELS } from '../../src/tweaks/performanceProbeStore';
import {
  peerCloudHitRadius,
  PEER_CLOUD_ADVERTISED_TONE,
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
    // ⭐ `cohort`, NOT `attested`: the table names the LAYER that claims a
    // kind, and a cohort's mark is the black hole `ColonyCohorts` draws.
    // This file stands its hit sphere and nothing else.
    expect(buckets.cohort).toEqual([KIND_SAMPLE.attested]);
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

  // ⭐⭐ THE RUNG HAS NO STOP ON THE CLOUD'S AXIS AT ALL, AND THAT IS THE
  // DECISION. It had one — wedged between the invented haze and the faintest
  // named stop, wide and dim — and it could not survive beside a black hole:
  // an additive point sprite is brightest at its own CENTRE, which is exactly
  // the pixel an event horizon needs empty. Keeping it would have been
  // arithmetically identical to filling the hole with light.
  it('leaves the confidence ladder alone, because a black hole was never a rung of it', () => {
    const material = materialSource();
    expect(material).not.toContain('PEER_CLOUD_ATTESTED_TONE');
    // The ladder those five stops make is unchanged rather than re-spaced: it
    // answers "how well do we know this node", a black hole answers "what does
    // it do", and a mark on the second axis was never a step on the first.
    expect(Object.keys(SIGHTED_STOPS)).toEqual(['advertised', 'remembered', 'reached']);
    expect(LADDER).toHaveLength(4);
    // …and this file no longer draws the rung at all.
    const nodes = source('ColonyNodes.tsx');
    expect(nodes).not.toContain('nodes={attested}');
    expect(nodes).not.toMatch(/setAttribute\('a(Attested|Producer|Miner|Cohort)/);
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
    // ⚠️ THE TARGET IS THE MARK, AND IT HAS TO BE BIG ENOUGH TO PRESS. At
    // 0.375 world units this was the SMALLEST target in the colony, under the
    // faintest roster rung's 0.425, and a full-canvas 13-pixel hover sweep of
    // the running app found forty peers and not one miner. It comes off the
    // cohort's CENTRE now — half that billboard's extent — which is the only
    // face with a bounded on-screen footprint: the intake is twenty world
    // units of volume hanging below the plane, and a target that covered it
    // would be a wall of invisible quad in front of the colony.
    expect(ATTESTED_HIT_RADIUS).toBe(COHORT_HIT_RADIUS);
    expect(ATTESTED_HIT_RADIUS).toBe(COHORT_CORE_HALF * 0.5);
    // ⭐ …and it is 1.15 EXACTLY, the radius the accreting void's disc gave
    // it, so re-deriving the number off a mark that still exists changed no
    // press, no hover and no miss.
    expect(ATTESTED_HIT_RADIUS).toBe(1.15);
    // Bigger than the 0.9 the subsumed point sprite stood, which is the floor
    // this revision was given.
    expect(ATTESTED_HIT_RADIUS).toBeGreaterThan(0.9);
    // ⭐⭐ AND IT MAY NOW EXCEED EVERY RUNG OF THE LADDER, which the old mark
    // was forbidden to do. A larger target used to read as a confidence claim
    // because every stop bought light and footprint together; a black hole is
    // not a stop, so there is no rung for it to tie and nothing about its size
    // that says how well the node is known.
    for (const stop of Object.values(SIGHTED_HIT_RADII)) {
      expect(ATTESTED_HIT_RADIUS).toBeGreaterThan(stop);
    }
    // …and it stops well inside the billboard it is taken from, where the
    // profile is still plainly lit rather than out in its own tail.
    expect(ATTESTED_HIT_RADIUS).toBeLessThan(COHORT_CORE_HALF);
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


/** A POW cohort is a vertical throat: an intake hanging below the colony
 *  plane, and the centre it converges on. */
describe('what a POW cohort looks like', () => {
  const peers = [peer('A'), peer('B')];
  const producers = [
    standing(producerKey('a'), 0.56),
    standing(producerKey('b'), 0.02),
  ];
  const topology = inferredTopology(
    peers, 0xc0ffee, 'ckb:local', undefined, ROSTER, undefined, producers,
  );
  const throatSource = () => readFileSync(
    resolve(process.cwd(), 'src/materials/colonyCohort.ts'),
    'utf8',
  );
  /** The exact shader strings a driver receives, not comments describing them. */
  const intakeFragment = () => makeCohortIntakeMaterial().fragmentShader;
  const intakeVertex = () => makeCohortIntakeMaterial().vertexShader;
  const coreFragment = () => makeCohortCoreMaterial().fragmentShader;

  it('mounts a colony of cohorts inside an r3f Canvas without throwing', () => {
    expect(() => render(
      <Canvas>
        <ColonyCohorts topology={topology} producersRef={{ current: producers }} />
      </Canvas>,
    )).not.toThrow();
  });

  it('stands one throat on every cohort the colony stages, and on nothing else', () => {
    const marks = cohortMarks(topology);
    const cohorts = topology.nodes.filter((n) => n.kind === 'attested');
    expect(cohorts).toHaveLength(producers.length);
    expect(marks.map((m) => m.nodeId)).toEqual(cohorts.map((n) => n.id));
    for (const mark of marks) {
      expect(mark.pos).toEqual(cohorts.find((n) => n.id === mark.nodeId)?.pos);
      expect(mark.nodeId).toBe(`attested:${mark.producerKey}`);
      // A per-cohort de-sync, so six funnels do not run their crests on one
      // beat. It is a fraction of a TURN, which is what both faces want: the
      // intake takes it raw as crest phase, the centre's breathe times TAU.
      expect(mark.seed).toBeGreaterThanOrEqual(0);
      expect(mark.seed).toBeLessThan(1);
    }
    expect(new Set(marks.map((m) => m.seed)).size).toBe(marks.length);
  });

  it('is TWO instanced draws and no more — the intake, then the centre over it', () => {
    const layer = source('ColonyCohorts.tsx');
    // Two meshes, two materials, one shared quad, and both counts written from
    // the same staged list — so a cohort cannot wear one face without the
    // other, whichever way the plan moves.
    expect(layer.match(/<instancedMesh/g)).toHaveLength(2);
    expect(layer).toContain('args={[quad, intakeMaterial, capacity]}');
    expect(layer).toContain('args={[quad, coreMaterial, capacity]}');
    expect(layer).toContain('intakeMesh.count = marks.length;');
    expect(layer).toContain('coreMesh.count = marks.length;');
    // ⭐ Order, and only order: both passes are additive, so this moves no
    // pixel. It is the composition the two faces read in — a funnel running
    // into a point rather than a point laid across a funnel.
    const intakeDraw = layer.indexOf('ref={intakeMeshRef}');
    const coreDraw = layer.indexOf('ref={coreMeshRef}');
    expect(intakeDraw).toBeGreaterThan(-1);
    expect(coreDraw).toBeGreaterThan(intakeDraw);
    expect(layer.indexOf('renderOrder={1}')).toBeGreaterThan(intakeDraw);
    expect(layer.indexOf('renderOrder={1}')).toBeLessThan(coreDraw);
    expect(layer.indexOf('renderOrder={2}')).toBeGreaterThan(coreDraw);
    // Neither is ever a pick target; the node's own hit sphere is.
    expect(layer.match(/raycast=\{\(\) => null\}/g)).toHaveLength(2);
    // Each pass carries its own GPU timer label, so the march can be measured
    // against the billboard it is drawn beside rather than mixed with it.
    expect(PERFORMANCE_PROBE_LABELS.colonyCohortIntake).toBe('colony.cohort.intake');
    expect(PERFORMANCE_PROBE_LABELS.colonyCohortCore).toBe('colony.cohort.core');
    expect(layer).toContain('PERFORMANCE_PROBE_LABELS.colonyCohortIntake');
    expect(layer).toContain('PERFORMANCE_PROBE_LABELS.colonyCohortCore');
    expect(layer).not.toMatch(/colonyAccretion(Horizon|Disc)/);
  });

  it('is drawn on NO EDGE of this colony, which is the whole of this revision', () => {
    // ⭐⭐ An earlier cut planned its geometry by walking `topology.edges` and
    // drawing matter along each of a cohort's own links. That says the energy
    // arrives over the network. The planner cannot reach an edge now — it
    // walks nodes and nothing else — and the intake hangs in the one region of
    // this scene where nothing whatsoever is drawn: below the colony slab.
    const layer = source('ColonyCohorts.tsx');
    expect(layer).not.toContain('topology.edges');
    expect(layer).not.toContain('lineSegments');
    expect(layer).toContain("if (node.kind !== 'attested') continue;");
    // The volume is a body of revolution about the colony's own Y, hanging
    // BELOW its throat: the fragment's height coordinate is negative-y, and it
    // is exactly zero outside the slab it reaches through.
    expect(intakeFragment()).toContain('float h = -rel.y / uReach;');
    expect(intakeFragment()).toContain('if (h < 0.0 || h > 1.0) return 0.0;');
    expect(COHORT_INTAKE_REACH).toBeGreaterThan(COHORT_INTAKE_MOUTH);
  });

  it('is ADDITIVE on both faces, so the layer has no second blend mode left', () => {
    // ⚠️⚠️ THIS IS THE REGISTER VIOLATION THAT COST THE OLD MARK ITS PLACE IN
    // THE MESH. What this replaced drew a normal-blended optical depression —
    // the scene's only non-additive object, its only dark one, its only
    // textured one (the whole scene's sole `fbm`), its only oriented one and
    // its only screen-locked one. All five went together.
    const intake = makeCohortIntakeMaterial();
    const core = makeCohortCoreMaterial();
    for (const material of [intake, core]) {
      expect(material.blending).toBe(THREE.AdditiveBlending);
      expect(material.transparent).toBe(true);
      expect(material.depthTest).toBe(true);
      expect(material.depthWrite).toBe(false);
      expect(material.toneMapped).toBe(false);
    }
    const layer = source('ColonyCohorts.tsx');
    const material = throatSource();
    expect(layer).not.toContain('NormalBlending');
    expect(material).not.toContain('NormalBlending');
    // …and nothing left in the file can paint one: no void tint to blend
    // toward, and no noise volume to texture it with. (The file's prose still
    // NAMES the violations it retired, which is why this reads the compiled
    // programs and the GLSL definitions rather than the whole text.)
    expect(material).not.toContain('uVoidColor');
    expect(material).not.toContain('float fbm3(');
    expect(material).not.toContain('float valueNoise3(');
    for (const glsl of [intakeFragment(), coreFragment(), intakeVertex()]) {
      expect(glsl).not.toMatch(/fbm|valueNoise|hash31/);
    }
    // Both faces end on the same additive contract: colour scaled by the
    // amplitude, energy in RGB only so scene-focus damping stays linear under
    // a blend factor that is the source alpha. ⭐ The energy is `cohortEnergy`
    // rather than `uContextEnergy` because the proximity exemption sits
    // between them — one shared expression pasted into both programs, so a
    // cohort the camera has flown to keeps its light on BOTH faces at once.
    // `materials/cohortContextEnergy.test.ts` owns that tie; what this says is
    // that neither face has quietly gone back to the raw uniform, and that
    // neither one puts the energy in alpha.
    expect(intakeFragment())
      .toContain('gl_FragColor = vec4(uColor * amp * cohortEnergy, amp);');
    expect(coreFragment())
      .toContain('gl_FragColor = vec4(uColor * shape * cohortEnergy, shape);');
    for (const glsl of [intakeFragment(), coreFragment()]) {
      expect([...glsl.matchAll(/\buContextEnergy\b/g)]).toHaveLength(2);
    }
  });

  it('leaves the throat UNLIT rather than painting it dark', () => {
    // ⭐ The darkness at the convergence is bright structure declining to fill
    // — this scene's own additive idiom for a hole. `smoothstep(0, uRefuse, r)`
    // takes the centre's profile to EXACTLY zero on the axis, so no dark pixel
    // is drawn anywhere and nothing behind the mark is removed. The accepted
    // cost, stated when the depression went: nothing behind a cohort is
    // occluded any more.
    expect(coreFragment())
      .toContain('float refuse = smoothstep(0.0, max(uRefuse, 0.001), r);');
    expect(coreFragment())
      .toContain('float shape = (core + halo) * refuse * uAmp * breathe;');
    const core = makeCohortCoreMaterial();
    expect(core.uniforms.uRefuse.value).toBeGreaterThan(0);
    // The intake converges on the same point and does not fill it either: its
    // density carries a throat fade that is zero at h = 0.
    expect(intakeFragment())
      .toContain('float throatFade = smoothstep(0.0, 0.10, h);');
    expect(intakeFragment())
      .toContain('return radial * crest * gather * mouthFade * throatFade;');
  });

  it('hands BOTH quads a unit plane, because the extent rides a uniform', () => {
    // ⚠️⚠️ A hand-built billboard IGNORES `mesh.scale`. Both vertex programs
    // rebuild their quad from raw `position` and the camera axes, which no
    // model matrix ever touches — so a scale on the mesh or on the instance
    // matrix is silently dropped and the world extent has to ride `uHalf`.
    // The two materials this layer used to draw did the opposite, baking their
    // extent into `PlaneGeometry(half * 2, half * 2)`; a quad carried over
    // from that habit renders the intake 3.7x too big. (It cost a full lab
    // round, and it hit both materials at once.)
    const layer = source('ColonyCohorts.tsx');
    expect(layer.match(/new THREE\.PlaneGeometry\([^)]*\)/g))
      .toEqual(['new THREE.PlaneGeometry(1, 1)']);
    expect(layer).toContain('const quad = useMemo(() => new THREE.PlaneGeometry(1, 1), []);');
    // ⭐ ONE geometry, TWO extents, five world units apart — which is what
    // makes the rule structural rather than remembered: there is no geometry
    // in this layer that could carry an extent, right or wrong.
    expect(makeCohortIntakeMaterial().uniforms.uHalf.value)
      .toBe(COHORT_INTAKE_HALF_EXTENT);
    expect(makeCohortCoreMaterial().uniforms.uHalf.value).toBe(COHORT_CORE_HALF);
    expect(COHORT_INTAKE_HALF_EXTENT).toBeCloseTo(11.6619, 4);
    expect(COHORT_CORE_HALF).toBe(2.3);
    for (const stage of [intakeVertex(), makeCohortCoreMaterial().vertexShader]) {
      expect(stage).toContain('uniform float uHalf;');
      expect(stage).toContain('* uHalf * 2.0');
    }
  });

  it('gives every live knob a uniform, and re-derives the proxy from the two that size it', () => {
    const layer = source('ColonyCohorts.tsx');
    // The retired accreting-void channel is gone from both the schema and the
    // frame loop; nothing reads a knob that no longer has a material.
    for (const retired of ['holeRim', 'holeGas', 'holeField', 'holeInfall', 'holeSpin']) {
      expect(peerSchema).not.toHaveProperty(retired);
      expect(layer).not.toContain(`LIVE.peer.${retired}`);
    }
    const knobs = [
      'cohortReach', 'cohortMouth', 'cohortAmp', 'cohortDensity',
      'cohortCrests', 'cohortRate', 'cohortGather', 'cohortCoreAmp',
    ] as const;
    for (const knob of knobs) {
      expect(peerSchema, knob).toHaveProperty(knob);
      expect(layer, knob).toContain(`LIVE.peer.${knob}`);
    }
    // ⚠️ `uHalf` IS NOT AN INDEPENDENT NUMBER. It is the bounding-sphere
    // radius of a cylinder of radius `mouth` and height `reach`, so a knob
    // that grew either one while the proxy stayed put would crop the funnel
    // against its own quad — the ray clip inside stays exact, but the pixels
    // carrying the far side of the mouth would never be rasterised to run it.
    expect(layer).toContain('intake.uHalf.value = cohortIntakeHalfExtent(mouth, reach);');
    expect(cohortIntakeHalfExtent(COHORT_INTAKE_MOUTH, COHORT_INTAKE_REACH))
      .toBe(COHORT_INTAKE_HALF_EXTENT);
    expect(cohortIntakeHalfExtent(12, 40)).toBeCloseTo(Math.hypot(12, 20), 12);
    // ⭐ `cohortDensity` is the CREST-CONTRAST knob and the first one a tuner
    // reaches for, so its range has to span the region contrast actually
    // moves through — measured 2.5:1 near 0.25, falling monotonically to 1:1
    // as the medium goes opaque.
    expect(peerSchema.cohortDensity.min).toBeLessThanOrEqual(0.15);
    expect(peerSchema.cohortDensity.max).toBeGreaterThanOrEqual(2);
    // ⚠️⚠️ AND THE CENTRE'S KNOB MAY NOT REACH A CLIPPED MARK. Additive
    // blending hands the screen `uColor * shape²`; the scaffold cyan's blue is
    // exactly full, and the centre's analytic ceiling is `amp * 1.42` — so at
    // `amp = 1/1.42` the mark's structure vanishes inside a flat blob. R16
    // spent a whole live leg finding that out from the far side.
    expect(peerSchema.cohortCoreAmp.value).toBe(COHORT_CORE_AMP);
    expect(peerSchema.cohortCoreAmp.max).toBeLessThan(1 / 1.42);
  });

  it('cannot be mistaken for the canopy contact wave, and structurally cannot become one', () => {
    // ⚠️⚠️ The nearest thing on stage to "a form around a point" is the Cell
    // canopy's block contact wave, which draws expanding pale ellipses across
    // the tissue. The load-bearing difference is the RADIUS: that one grows
    // from its own age and this one never grows at all.
    const fragment = intakeFragment();
    // Every extent is a uniform; the clock reaches crest phase and swirl and
    // never writes or rescales one of them.
    expect(fragment).not.toMatch(/u(?:Reach|Mouth|Half|ThroatR)\s*[+*/-]?=/);
    const layer = source('ColonyCohorts.tsx');
    // …and on the CPU side the three size uniforms are written from knobs
    // only. A clock in one of these lines is how a mark starts to breathe in
    // size, which is the wave's whole grammar and never this one's.
    const sizeWrites = layer
      .split('\n')
      .filter((line) => /\bu(?:Reach|Mouth|Half)\.value/.test(line))
      .map((line) => line.trim());
    expect(sizeWrites).toEqual([
      'intake.uReach.value = reach;',
      'intake.uMouth.value = mouth;',
      'intake.uHalf.value = cohortIntakeHalfExtent(mouth, reach);',
    ]);
    // …and the two the third is derived from come from knobs, not a clock.
    expect(layer).toContain('const reach = LIVE.peer.cohortReach;');
    expect(layer).toContain('const mouth = LIVE.peer.cohortMouth;');
    for (const line of sizeWrites) {
      expect(line).not.toMatch(/elapsed|simClock|performance\.now|Date\.now/);
    }
    // ⭐ The contact wave grows because its OWNER rescales every instance from
    // the front's age, once a frame. This layer writes a translation and never
    // a scale, so there is no arrangement of it that expands.
    expect(source('BlockDeliveryLayer.tsx'))
      .toContain('const extent = crestRadius / CONTACT_WAVE_CREST_UV;');
    expect(layer).toContain('SCRATCH_MATRIX.makeTranslation(');
    expect(layer).not.toMatch(/makeScale|\.scale\.set|setScalar/);
  });

  it('cannot be mistaken for a courier glint either', () => {
    const material = throatSource();
    const layer = source('ColonyCohorts.tsx');
    const courier = source('ColonyCourierLayer.tsx');
    // A courier is a billboarded bloom plus a comet plume, fired ONCE per
    // block, travelling OUTWARD down the propagation tree and tinted that
    // block's carrier hue. This has no head to stretch, no plume texture, no
    // pulse to fire from and no carrier hue.
    expect(layer).not.toMatch(/makeCourier|Sprite|easeOutCubic/);
    expect(courier).toContain('makeCourierPlumeTexture');
    expect(material).toContain('PEER_NETWORK_PALETTE.scaffold');
    expect(material).not.toContain('consensusBlockColor');
    expect(layer).not.toContain('consensusBlockColor');
    expect(courier).toContain('consensusBlockColor(blockPulseAtMs)');
  });

  it('never samples the block shockwave, which would flare every cohort at once', () => {
    // ⚠️ The front crosses the WHOLE colony on every block. A wave-receptive
    // mining mark would flare for every cohort as it passed — the scene showing
    // six of them discharging on a block exactly one of them won.
    const layer = source('ColonyCohorts.tsx');
    // The compiled GLSL, not the comment above it that says so.
    expect(intakeFragment()).not.toMatch(/[Ss]hockwave/i);
    expect(coreFragment()).not.toMatch(/[Ss]hockwave/i);
    // …and nothing in either file can import one.
    expect(throatSource()).not.toMatch(/^import .*shockwave/im);
    expect(layer).not.toMatch(/shockwaveMaterial|shockwaveUniforms/);
  });

  it('takes no pulse and no flood at all, so it cannot fire for the wrong cohort', () => {
    // ⭐ The win is ALREADY DRAWN: on the block a cohort makes, the colony's
    // own outward surge erupts from that very node, off `cf.entryId`. A layer
    // with no per-block input is structurally incapable of discharging for
    // anybody, right or wrong — which is a stronger guarantee than a lookup
    // that happens to agree with the flood's.
    const layer = source('ColonyCohorts.tsx');
    expect(layer).not.toContain('blockPulseAtMs');
    expect(layer).not.toContain('backfillActive');
    expect(layer).not.toContain('cf.entryId');
    expect(layer).not.toContain('ColonyFlood');
    // The mount passes none of the three either.
    const network = source('NetworkColony.tsx');
    const open = network.indexOf('<ColonyCohorts');
    const close = network.indexOf('/>', open);
    expect(open).toBeGreaterThan(-1);
    expect(network.slice(open, close)).not.toMatch(/cf=|blockPulseAtMs=|backfillActive=/);
  });

  it('says the share as a RATE and never a second time as size or light', () => {
    // ⭐ A cohort holding more of the window runs its crests FASTER; every
    // funnel is the same size and the same brightness, whoever it belongs to.
    // Saying the share twice would say one fact twice — and would make a
    // cohort with four blocks look like a rounding error rather than one that
    // made four blocks, which is why the rate has a floor rather than reaching
    // zero.
    const vertex = intakeVertex();
    expect(vertex)
      .toContain('vRateScale = mix(uRateFloor, 1.0, clamp(aShare, 0.0, 1.0));');
    // aShare reaches the rate scale and nothing else: 1 declaration, 1 read.
    expect(vertex.match(/aShare/g)).toHaveLength(2);
    for (const statement of vertex.split(';')) {
      if (!statement.includes('aShare') || statement.includes('attribute')) continue;
      expect([statement.trim().slice(0, 60), statement.includes('uRateFloor')])
        .toEqual([statement.trim().slice(0, 60), true]);
    }
    // …and on the far side, the varying reaches the crest PHASE and nothing
    // else: not an amplitude, not a radius, not a step count.
    const fragment = intakeFragment();
    expect(fragment.match(/vRateScale/g)).toHaveLength(2);
    expect(fragment).toContain('+ uTime * uRate * vRateScale');
  });

  it('reads no standing at all in its plan, so a window that moved cannot move a throat', () => {
    // ⭐⭐ THE SPLIT THAT KEEPS THE GEOMETRY STILL. A cohort's blocks and share
    // change on EVERY block while its key, its placement and its seed do not,
    // so a plan that read the window would rewrite this layer's instance
    // matrices once a block for a numerator that moved.
    expect(cohortMarks.length).toBeLessThanOrEqual(2); // (topology, cap)
    const layer = source('ColonyCohorts.tsx');
    expect(layer).toContain('const plan = useMemo(() => cohortMarks(topology), [topology]);');
    // The share reaches the GPU through a lane written in place instead — off
    // the window's REF, once per identity change, never off a prop that would
    // re-render the memoized colony once a block — and the lane is marked
    // ONCE for the whole walk.
    expect(layer).toContain('}, [producersRef, writeShares]);');
    expect(layer).toContain('if (live === writtenSharesRef.current) return;');
    expect(layer).toContain('lanes.share.needsUpdate = true;');
    expect(layer).not.toContain('[lanes, marks, producers]');
    expect(layer).not.toMatch(/useMemo\([^)]*producers[^)]*\)/);
  });

  it('holds its buffers across a rebuild that moved nothing it draws', () => {
    const later = inferredTopology(
      [{ ...peer('A'), latency_ms: 220 }, peer('B')],
      0xc0ffee, 'ckb:local', undefined, ROSTER, undefined, producers,
    );
    const before = cohortMarks(topology);
    const after = cohortMarks(later);
    expect(after).not.toBe(before);
    expect(before.every((mark, i) => sameCohortMark(mark, after[i]))).toBe(true);
    const held = renderHook(({ list }) => useStableList(list, sameCohortMark), {
      initialProps: { list: before },
    });
    held.rerender({ list: after });
    expect(held.result.current).toBe(before);

    // ⚠️ …and a throat whose NODE MOVED must break it. A reseed keeps every id
    // while moving every point, so a test on ids alone would call an entirely
    // rearranged colony unchanged and leave these funnels hanging in the space
    // the old one used to occupy.
    const [mark] = before;
    expect(sameCohortMark(mark, { ...mark, pos: [...mark.pos] as Vec3 })).toBe(true);
    expect(sameCohortMark(mark, {
      ...mark, pos: [mark.pos[0] + 1, mark.pos[1], mark.pos[2]],
    })).toBe(false);
  });

  it('stands nothing at all for a colony with no cohorts in its window', () => {
    const bare = inferredTopology(peers, 0xc0ffee, 'ckb:local', undefined, ROSTER);
    expect(cohortMarks(bare)).toEqual([]);
    // …and it is a NO DRAW rather than an empty one. A material that never
    // enters the scene graph is never compiled, and a devnet nobody mines or a
    // review lab that passes no window would otherwise carry an empty vertex
    // program for the whole life of the scene.
    expect(source('ColonyCohorts.tsx'))
      .toContain('if (marks.length === 0) return null;');
    expect(() => render(
      <Canvas><ColonyCohorts topology={bare} /></Canvas>,
    )).not.toThrow();
  });

  it('stops at a cap and says so, rather than sizing a buffer off the wire', () => {
    const marks = cohortMarks(topology, 1);
    expect(marks).toHaveLength(1);
    expect(COHORT_MARK_CAP).toBeGreaterThan(marks.length);
    const layer = source('ColonyCohorts.tsx');
    expect(layer).toContain('cappedLogged.current = true;');
    expect(layer).toContain('console.warn(');
  });

  it('needs no rotation maths, because only its origin turns with the colony', () => {
    // The courier and the delivery stand OUTSIDE the counter-rotating group
    // and carry every point and axis through `colonyFrame.rotationY`
    // themselves, because their billboard bases are world-frame. This one
    // rides the group: the instance matrix carries a translation, the group
    // turns it, and the quad is rebuilt from the view matrix — so there is no
    // basis for a rotation to have to undo.
    expect(source('ColonyCohorts.tsx')).not.toContain('colonyFrame');
    expect(source('ColonyCourierLayer.tsx')).toContain('colonyFrame.rotationY');
    const material = throatSource();
    expect(material).toContain('viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]');
    expect(source('ColonyCohorts.tsx')).toContain('SCRATCH_MATRIX.makeTranslation(');
    expect(source('ColonyCohorts.tsx')).not.toContain('SCRATCH_MATRIX.makeScale(');
    // ⭐ AND THE FUNNEL'S AXIS IS THE COLONY'S OWN. The throat is read off the
    // instance origin in the VERTEX shader, on whatever frame the GPU is
    // drawing, so the volume parallaxes and turns with the colony for free and
    // a CPU-written origin can never lag behind the rotation.
    expect(intakeVertex()).toContain(
      'vec4 anchor = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);',
    );
    expect(Object.keys(makeCohortIntakeMaterial().uniforms)).not.toContain('uOrigin');
  });
});
