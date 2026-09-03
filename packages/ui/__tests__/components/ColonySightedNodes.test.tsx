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
  sameStagedPoint,
  sightedStop,
  stagedPickTargets,
  useStableList,
  type ColonyDraw,
  type SightedStop,
} from '../../src/components/ColonyNodes';
import {
  attestedNodeId,
  COHORT_KEEP_OUT_R,
  COLONY_MIN_SPACING,
  inferredTopology,
  STAGEABLE_ROSTER_STATES,
} from '../../src/derives/networkTopology.derive';
import { colonyFlood } from '../../src/derives/networkFlood.derive';
import ColonyCohorts, {
  COHORT_MARK_CAP,
  cohortMarks,
  cohortPxScale,
  cohortStepCount,
  sameCohortMark,
} from '../../src/components/ColonyCohorts';
import { PEER_NETWORK_PALETTE } from '../../src/visualPalette';
import { COHORT_NEVER_WON } from '../../src/materials/colonyCohort';
import {
  COHORT_DISC_IN,
  COHORT_DISC_OUT,
  COHORT_HIT_RADIUS,
  COHORT_HORIZON,
  COHORT_LENS_QUAD_R,
  COHORT_LENS_STEPS,
  COHORT_LINK_STOP_R,
  COHORT_UNFOLD_HI,
  cohortDiscInner,
  cohortShadowRadius,
  makeCohortLensMaterial,
} from '../../src/materials/colonyLens';
import {
  COHORT_MOTES_PER_COHORT,
  COHORT_MOTE_K,
  makeCohortMotesMaterial,
} from '../../src/materials/colonyMotes';
import { MIST_SINK_K } from '../../src/materials/colonyMist';
import { QUALITY_PRESETS } from '../../src/tweaks/qualityPresets';

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

  it('the two tiers test different things: ghosts by object, sighted by id and place', () => {
    // A ghost is the derive's cached scaffold object; a reseed keeps every
    // `inf:n` id while moving every point, so only identity is safe there. A
    // sighted node is re-staged from the crawler's row every build, so identity
    // is never held — its id and the place that id landed on are what its
    // points follow (⭐ the place, because the cohorts' keep-out can move a
    // node without changing its id; pinned on its own below).
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

  // ⭐⭐ THE ONE CASE THE ID COMPARISON GOT WRONG, and it is the case this
  // session's whole change is about. A producer appearing over a sighted peer
  // pushes that peer clear of the cohort's hole (`COHORT_KEEP_OUT_R`) under the
  // SAME node id — so a comparator that read ids alone would hold the buffer
  // and leave the peer drawn inside a mouth it had already stepped out of,
  // while the hit sphere (which follows the topology directly) had moved.
  it('⭐ a cohort opening over a sighted peer releases the buffer, id unchanged', () => {
    const build = (producers?: ProducerStanding[]) => sightedOf(inferredTopology(
      [measured('A', 40)], 0xc0ffee, 'ckb:local', undefined, ROSTER, undefined, producers,
    ));
    const bare = build();
    // Staging producers cannot add, drop or reorder a sighted peer — only move
    // one, which is exactly the change an id comparison cannot see.
    expect(build([standing(producerKey('a'), 0.5), standing(producerKey('b'), 0.5)])
      .map((n) => n.id)).toEqual(bare.map((n) => n.id));
    const held = renderHook(({ list }) => useStableList(list, sameStagedPoint), {
      initialProps: { list: bare },
    });
    // A rebuild that moved nobody still holds the buffer…
    held.rerender({ list: bare.map((n) => ({ ...n })) });
    expect(held.result.current).toBe(bare);
    // …and one where a single peer stepped clear of a new hole does not.
    const stepped: NetworkNode[] = bare.map((n) => ({ ...n }));
    stepped[0] = {
      ...stepped[0],
      pos: [stepped[0].pos[0] + COHORT_KEEP_OUT_R, stepped[0].pos[1], stepped[0].pos[2]],
    };
    expect(stepped.map((n) => n.id)).toEqual(bare.map((n) => n.id));
    held.rerender({ list: stepped });
    expect(held.result.current).toBe(stepped);
  });

  it('each cloud keys its buffer on the held list, under its own tier’s test', () => {
    const nodes = source('ColonyNodes.tsx');
    expect(nodes).toContain('const inferred = useStableList(staged, sameNodeObject)');
    expect(nodes).toContain('const points = useStableList(nodes, sameStagedPoint)');
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
    // T7 stands a mark from a key and reads its share off a lane; the week is
    // never in the geometry, so every standing here carries none.
    ledger: null,
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
    // kind, and a cohort's mark is the aperture `ColonyCohorts` draws. This
    // file stands its hit sphere and nothing else.
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
    // MASS now — the apparent radius of the SHADOW, which is the one part of a
    // lensed mark a viewer can be in no doubt about.
    expect(ATTESTED_HIT_RADIUS).toBe(COHORT_HIT_RADIUS);
    expect(ATTESTED_HIT_RADIUS).toBe(cohortShadowRadius(COHORT_HORIZON));
    expect(ATTESTED_HIT_RADIUS).toBeCloseTo(2.0005, 4);
    // Bigger than the 0.9 the subsumed point sprite stood, bigger than the 1.15
    // the deleted centre gave it, and bigger than the aperture's own 1.5: the
    // mark grew and the target grew with it.
    expect(ATTESTED_HIT_RADIUS).toBeGreaterThan(0.9);
    expect(ATTESTED_HIT_RADIUS).toBeGreaterThan(1.15);
    expect(ATTESTED_HIT_RADIUS).toBeGreaterThan(1.5);
    // ⭐⭐ AND IT MAY EXCEED EVERY RUNG OF THE LADDER, which the old mark was
    // forbidden to do. A larger target used to read as a confidence claim
    // because every stop bought light and footprint together; a black hole is
    // not a stop, so there is no rung for it to tie and nothing about its size
    // that says how well the node is known.
    for (const stop of Object.values(SIGHTED_HIT_RADII)) {
      expect(ATTESTED_HIT_RADIUS).toBeGreaterThan(stop);
    }
    // ⚠️⚠️ AND WHAT BOUNDS IT IS THE KEEP-OUT AND NO LONGER `COLONY_MIN_SPACING`.
    // The spacing rule only ever covered the inferred scatter; a SIGHTED peer's
    // placement is a hash and is bounded by nothing, which is how a clickable
    // peer once came to stand 1.274 wu from a cohort's centre.
    // `COHORT_KEEP_OUT_R` empties a 3.5 wu disc around every attested position,
    // so the closest a rival target may stand is 3.5 and two spheres of 2.0 and
    // 1.0 still clear each other by half a unit. `cohortKeepOut.test.ts` owns
    // the whole chain; what is pinned here is that this file's target is the
    // material's number and not a second one.
    expect(ATTESTED_HIT_RADIUS + Math.max(...Object.values(SIGHTED_HIT_RADII)))
      .toBeLessThanOrEqual(COHORT_KEEP_OUT_R);
    // ⭐ AND IT IS STRICTLY INSIDE THE DISC'S INNER EDGE, so a viewer aiming at
    // the middle of the mark is aiming at the black disc rather than at the
    // brightest ring on it.
    expect(ATTESTED_HIT_RADIUS).toBeLessThan(COHORT_DISC_IN);
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


/** A POW cohort is a MASS IN THE MEMBRANE: one ray-traced quad per cohort in
 *  which the whole image — shadow, photon ring, the far side of the disc folded
 *  over the top — is computed, plus the specks of the same substance falling
 *  into it. */
describe('what a POW cohort looks like', () => {
  const peers = [peer('A'), peer('B')];
  const producers = [
    standing(producerKey('a'), 0.56),
    standing(producerKey('b'), 0.02),
  ];
  const topology = inferredTopology(
    peers, 0xc0ffee, 'ckb:local', undefined, ROSTER, undefined, producers,
  );
  /** The exact shader strings a driver receives, not comments describing them. */
  const lensFragment = () => makeCohortLensMaterial().fragmentShader;
  const lensVertex = () => makeCohortLensMaterial().vertexShader;
  const motesVertex = () => makeCohortMotesMaterial().vertexShader;

  it('mounts a colony of cohorts inside an r3f Canvas without throwing', () => {
    expect(() => render(
      <Canvas>
        <ColonyCohorts topology={topology} producersRef={{ current: producers }} />
      </Canvas>,
    )).not.toThrow();
  });

  it('stands one mark on every cohort the colony stages, and on nothing else', () => {
    const marks = cohortMarks(topology);
    const cohorts = topology.nodes.filter((n) => n.kind === 'attested');
    expect(cohorts).toHaveLength(producers.length);
    expect(marks.map((m) => m.nodeId)).toEqual(cohorts.map((n) => n.id));
    for (const mark of marks) {
      expect(mark.pos).toEqual(cohorts.find((n) => n.id === mark.nodeId)?.pos);
      expect(mark.nodeId).toBe(`attested:${mark.producerKey}`);
      // A per-cohort de-sync, so six discs do not breathe on one beat. It is a
      // fraction of a TURN: the medium's two-phase clock takes it as a phase
      // offset and the specks' hash takes it as a seed.
      expect(mark.seed).toBeGreaterThanOrEqual(0);
      expect(mark.seed).toBeLessThan(1);
    }
    expect(new Set(marks.map((m) => m.seed)).size).toBe(marks.length);
  });

  it('is TWO draws — the lensed mass, then the specks falling into it', () => {
    const layer = source('ColonyCohorts.tsx');
    // ⚠️ IT WAS THREE UNTIL 2026-09-03: a disc lying in the plane, a
    // camera-facing halo carrying the same hole, and a patch of mist under the
    // plane the hole was drinking. All three were parts of a picture that is now
    // COMPUTED, and the two that remain are not parts of anything — the lens is
    // the whole image and the motes are the one thing an image cannot state: how
    // fast the substance is moving.
    expect(layer.match(/<instancedMesh/g)).toHaveLength(1);
    expect(layer.match(/<points/g)).toHaveLength(1);
    expect(layer).toContain('args={[lensGeometry, lensMaterial, capacity]}');
    expect(layer).toContain('geometry={motesGeometry}');
    expect(layer).toContain('material={motesMaterial}');
    expect(layer).toContain('lensMesh.count = marks.length;');
    // ⚠️ …and the geometry carries the same number rather than the `Infinity` an
    // `InstancedBufferGeometry` ships with. This renderer reads the MESH's count
    // (the `isInstancedMesh` branch wins in `renderBufferDirect`), so the two
    // must be written in one place or a reader finds two answers to "how many
    // instances does this draw".
    expect(layer).toContain('lensGeometry.instanceCount = marks.length;');
    // ⭐⭐ THE SPECKS ARE ONE DRAW FOR THE WHOLE COLONY AND ARE NOT INSTANCED:
    // one vertex per mote, sized for the cap and never rebuilt, because their
    // `aGulp` is a 96-wide COPY and a rebuild would drop every live stamp.
    expect(layer).toContain('buildCohortMotesGeometry(COHORT_MARK_CAP),');
    expect(COHORT_MOTES_PER_COHORT).toBe(96);
    // ⚠️⚠️ RENDER ORDER IS THE DESIGN. The lens is the colony's ONE
    // normally-blended draw and it occludes by DRAW ORDER, so 1 puts it strictly
    // above the edges and the nodes (both 0) — three sorts EQUAL render orders
    // by depth, and each of those layers is a single draw with one z for the
    // whole colony, so a tie would let the ghost cloud shine through a shadow
    // whenever its centre sat nearer. 2 puts the specks above the disc, whose
    // alpha reaches 0.85 exactly where they are brightest.
    const lensDraw = layer.indexOf('ref={lensMeshRef}');
    const motesDraw = layer.indexOf('geometry={motesGeometry}');
    expect(lensDraw).toBeGreaterThan(-1);
    expect(motesDraw).toBeGreaterThan(lensDraw);
    expect(layer.indexOf('renderOrder={1}')).toBeGreaterThan(lensDraw);
    expect(layer.indexOf('renderOrder={1}')).toBeLessThan(motesDraw);
    expect(layer.indexOf('renderOrder={2}')).toBeGreaterThan(motesDraw);
    expect(layer).not.toContain('renderOrder={0}');
    // Neither is ever a pick target; the node's own hit sphere is. The quad is
    // 64 wu across and overlaps its neighbours', so it is the one that would
    // hurt most.
    expect(layer.match(/raycast=\{\(\) => null\}/g)).toHaveLength(2);
    // ⭐ …and neither may be frustum-culled: the lens's bound is its instance
    // origin and the motes' comes from the SEATS, while both programs move
    // pixels tens of world units away from those points.
    expect(layer.match(/frustumCulled=\{false\}/g)).toHaveLength(2);
    // Each pass carries its own GPU timer label, because the two fail
    // differently: the lens's cost is fill × steps, the motes' is a vertex
    // count with no texture at all.
    expect(PERFORMANCE_PROBE_LABELS.colonyCohortLens).toBe('colony.cohort.lens');
    expect(PERFORMANCE_PROBE_LABELS.colonyCohortMotes).toBe('colony.cohort.motes');
    expect(layer).toContain('PERFORMANCE_PROBE_LABELS.colonyCohortLens');
    expect(layer).toContain('PERFORMANCE_PROBE_LABELS.colonyCohortMotes');
    // ⚠️ AND NOTHING OF THE RETIRED FORMS IS LEFT TO DRAW A THIRD. The
    // accreting void's disc and horizon went two revisions ago, the marched
    // throat's intake and centre with the aperture, and the aperture's own two
    // faces and the mist patch beside them went with this one.
    expect(layer).not.toMatch(/colonyAccretion(Horizon|Disc)/);
    expect(layer).not.toMatch(/\bmakeCohort(Face|Aura|Intake|IntakePatch|Core)Material\b/);
    expect(PERFORMANCE_PROBE_LABELS).not.toHaveProperty('colonyCohortFace');
    expect(PERFORMANCE_PROBE_LABELS).not.toHaveProperty('colonyCohortAura');
    expect(PERFORMANCE_PROBE_LABELS).not.toHaveProperty('colonyMistPatch');
  });

  it('draws the intake as the IMAGE of a mass, never as a surface beside it', () => {
    // ⛔⛔⛔ THE ONE RULE TWENTY-FIVE ROUNDS PAID FOR. A column, plume, funnel or
    // pillar under the mouth reads as a searchlight at every brightness profile
    // that was tried — up close, as a saucer with a tractor beam — and only
    // SURFACES BEING DRAWN ever read as intake. The lensed disc IS such a
    // surface: the far side of it folded over the top of the shadow is the
    // substance seen from outside, moving. What this pins is that the layer did
    // not smuggle a volume back in beside it.
    const layer = source('ColonyCohorts.tsx');
    // ⚠️ COMMENTS STRIPPED FIRST: the header names every rejected form in order
    // to refuse it, and prose the compiler drops must not be able to fail an
    // assertion about code.
    const code = layer.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/plume|pillar|funnel/i);
    // ⚠️ `beam` LEFT THIS LIST WITH THE APERTURE, and the reason is worth
    // writing down: the lensed form has a term called BEAMING — the relativistic
    // brightening of the disc's approaching side, `cohortBeam` — which is a fact
    // about a rotating disc and the opposite of a searchlight. The three volume
    // words are what the rule was ever about.
    expect(peerSchema).toHaveProperty('cohortBeam');
    // ⚠️⚠️ A UNIT QUAD, AND THE EXTENT RIDES `uQuadR`. The vertex program
    // rebuilds the quad from the CAMERA's axes, so neither `mesh.scale` nor a
    // scaled instance matrix touches it and a geometry carrying an extent would
    // be a number nothing reads. ⭐ AND A SCALED INSTANCE WOULD MOVE THE QUAD
    // WITHOUT MOVING THE MASS — the trace runs in world space from the
    // instance's own origin, so the mark would become a window onto a hole
    // standing somewhere else.
    expect(layer.match(/new THREE\.PlaneGeometry\([^)]*\)/g))
      .toEqual(['new THREE.PlaneGeometry(1, 1)']);
    expect(layer).toContain('new THREE.InstancedBufferGeometry()');
    expect(layer).toContain('SCRATCH_MATRIX.makeTranslation(');
    expect(layer).not.toMatch(/makeScale|\.scale\.set|setScalar/);
    const lens = makeCohortLensMaterial();
    expect(lens.uniforms.uQuadR.value).toBe(COHORT_LENS_QUAD_R);
    expect(COHORT_LENS_QUAD_R).toBe(32);
    expect(lensVertex()).toContain('* uQuadR * 2.0');
    // ⛔ AND NOTHING IS EVER DRAWN OFF THE COLONY PLANE. The disc plane IS the
    // membrane — the trace's plane crossing is `y * prevY < 0.0` about the
    // instance's own origin — and a mote's offset from its seat has y = 0
    // exactly. There is no term in either program that could lift one out.
    expect(lensFragment()).toContain('float y = pnow.y - c.y;');
    expect(motesVertex())
      .toContain('vec3 local = aOrigin + vec3(cos(theta) * r, 0.0, sin(theta) * r);');
  });

  it('is drawn on NO EDGE of this colony, which is the whole of this revision', () => {
    // ⭐⭐ An earlier cut planned its geometry by walking `topology.edges` and
    // drawing matter along each of a cohort's own links. That says the energy
    // arrives over the network. The planner cannot reach an edge now — it walks
    // nodes and nothing else — and a mass in the plane the links already lie in
    // says nothing about where anything came from.
    const layer = source('ColonyCohorts.tsx');
    expect(layer).not.toContain('topology.edges');
    expect(layer).not.toContain('lineSegments');
    expect(layer).toContain("if (node.kind !== 'attested') continue;");
    // …and the traffic runs the other way: `ColonyEdges` reads the mark's own
    // stop radius so a cohort's links end outside the computed image, rather
    // than this layer reading an edge.
    expect(source('ColonyEdges.tsx')).toContain('COHORT_LINK_STOP_R');
    expect(COHORT_LINK_STOP_R).toBe(3);
    expect(COHORT_LINK_STOP_R).toBeGreaterThan(COHORT_DISC_IN);
  });

  it('is the colony’s ONE normally-blended draw, and mounts LAST because of it', () => {
    // ⚠️⚠️ THIS IS THE REGISTER THE MARK RECLAIMED, AND IT IS NOT A RELAPSE.
    // What the aperture replaced was a normal-blended optical depression, and
    // the five violations it was retired for were: the scene's only
    // non-additive object, its only DARK one, its only textured one, its only
    // oriented one and its only screen-locked one. The lens is non-additive
    // again — deliberately, because a SHADOW is a place where light is REMOVED
    // and an additive draw can only fail to add — and it is textured, because
    // the substance it shows is the mist's own tile. The other three still
    // stand: it has no orientation of its own (the quad faces the camera and
    // carries no meaning), it is not screen-locked (every radius is in world
    // units), and its darkness is a CONSEQUENCE of the trace rather than a
    // painted disc. Nothing draws black here: a captured ray simply never
    // reaches anything that shines.
    const lens = makeCohortLensMaterial();
    const motes = makeCohortMotesMaterial();
    expect(lens.blending).toBe(THREE.NormalBlending);
    expect(lens.premultipliedAlpha).toBe(true);
    expect(motes.blending).toBe(THREE.AdditiveBlending);
    for (const material of [lens, motes]) {
      expect(material.transparent).toBe(true);
      expect(material.depthTest).toBe(true);
      expect(material.depthWrite).toBe(false);
      expect(material.toneMapped).toBe(false);
    }
    // The horizon is a REFUSAL and never a painted disc: `captured` sets the
    // alpha and no colour is written for it at all — and the alpha it sets is
    // the hole gate of the closeness, so the dark arrives over the last part
    // of the band and never as a pupil in a small far mark.
    expect(lensFragment()).toContain('if (r < rs) { captured = true; break; }');
    expect(lensFragment()).toMatch(/if \(captured\) \{\s*acc\.a = smoothstep\(/);
    expect(lensFragment()).not.toContain('acc.a = closeness;');
    // ⚠️⚠️ AND BECAUSE IT OCCLUDES BY DRAW ORDER, THE MOUNT IS PART OF THE
    // DESIGN. It darkens what drew BEFORE it and nothing after, so it goes after
    // the edges and the nodes and before the courier and the delivery, which fly
    // above the plane and must not be darkened by a hole they pass over.
    const network = source('NetworkColony.tsx');
    const edges = network.indexOf('<ColonyEdges');
    const nodes = network.indexOf('<ColonyNodes');
    const cohorts = network.indexOf('<ColonyCohorts');
    const courier = network.indexOf('<ColonyCourierLayer');
    const delivery = network.indexOf('<BlockDeliveryLayer');
    expect(edges).toBeGreaterThan(-1);
    expect(nodes).toBeGreaterThan(edges);
    expect(cohorts).toBeGreaterThan(nodes);
    expect(courier).toBeGreaterThan(cohorts);
    expect(delivery).toBeGreaterThan(courier);
  });

  it('folds on PIXELS PER WORLD UNIT, measured off the DRAWING BUFFER', () => {
    // ⭐⭐⭐ ONE NUMBER FOLDS THE WHOLE FORM, and it is pixels per world unit
    // rather than distance — because the same distance is a different picture on
    // a 1440p screen and a phone, and because a dolly and a zoom must fold
    // identically. The layer writes the scale and each program divides it by its
    // own distance to the camera.
    const layer = source('ColonyCohorts.tsx');
    expect(cohortPxScale(1440, 2.4142)).toBeCloseTo(0.5 * 1440 * 2.4142, 9);
    // ⚠️⚠️ DOUBLE THE DPR AND IT DOUBLES. The drawing buffer's height is what a
    // world unit is projected onto, so a quality tier that lowers `maxDpr`
    // halves it — and a mark folded on CSS pixels would UNFOLD into the film's
    // hole exactly as the machine admitted it could not afford one.
    expect(cohortPxScale(2880, 2.4142)).toBeCloseTo(2 * cohortPxScale(1440, 2.4142), 9);
    expect(cohortPxScale(1440, 4.8284)).toBeCloseTo(2 * cohortPxScale(1440, 2.4142), 9);
    // …and it really is the DEVICE height, off the canvas, never `state.size`.
    expect(layer).toContain('gl.domElement.height,');
    expect(layer).toContain('camera.projectionMatrix.elements[5],');
    // ⚠️ Comments stripped, because the paragraph beside the write NAMES the
    // CSS size it refuses and prose the compiler drops must not fail a claim
    // about code.
    expect(layer.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''))
      .not.toContain('state.size');
    // Both programs are handed the same number in the same frame, so nothing can
    // unfold on its own schedule.
    expect(layer).toContain('lens.uPxScale.value = pxScale;');
    expect(layer).toContain('motes.uPxScale.value = pxScale;');
    expect(layer).toContain('motes.uViewportHeight.value = gl.domElement.height;');
    for (const stage of [lensFragment(), motesVertex()]) {
      expect(stage).toContain('uniform float uPxScale;');
      expect(stage).toContain('uUnfoldLo');
      expect(stage).toContain('uUnfoldHi');
    }
    // ⚠️ AND IT SHIPS ABSURDLY LARGE, so a material drawn before the layer's
    // first frame is UNFOLDED rather than invisible: a uniform nobody wrote
    // shows up as the wrong form and never as an empty scene.
    expect(makeCohortLensMaterial().uniforms.uPxScale.value).toBe(1e6);
    expect(makeCohortMotesMaterial().uniforms.uPxScale.value).toBe(1e6);
  });

  it('takes its step count from the quality tier, and the knob overrides it', () => {
    // ⭐⭐⭐ THE PRECISION IS ALL A TIER MAY TOUCH. A cohort at 40 steps is the
    // same cohort with a coarser photon ring; a cohort that is not drawn is a
    // producer the scene is lying about — so nothing here is gated on the tier
    // except this one number.
    expect(QUALITY_PRESETS.high.cohortLensSteps).toBe(96);
    expect(QUALITY_PRESETS.med.cohortLensSteps).toBe(64);
    expect(QUALITY_PRESETS.low.cohortLensSteps).toBe(40);
    expect(QUALITY_PRESETS.high.cohortLensSteps).toBe(COHORT_LENS_STEPS);
    // The knob ships at the high tier's own value, so an untouched panel is
    // transparent: whatever the cascade decided is what draws.
    expect(peerSchema.cohortSteps.value).toBe(COHORT_LENS_STEPS);
    for (const tier of [96, 64, 40]) {
      expect(cohortStepCount(tier, COHORT_LENS_STEPS)).toBe(tier);
    }
    // …and the moment it moves, the tuner's number wins — which is what makes
    // the one measurement the live leg has to take possible to take.
    expect(cohortStepCount(64, 128)).toBe(128);
    expect(cohortStepCount(40, 24)).toBe(24);
    const layer = source('ColonyCohorts.tsx');
    expect(layer).toContain(
      'lens.uSteps.value = cohortStepCount(tierSteps, LIVE.peer.cohortSteps);',
    );
    expect(layer).toContain('QUALITY_PRESETS[quality].cohortLensSteps;');
    // ⛔ AND THE PRESENCE OF THE MARK IS NEVER GATED: no tier drops the draw,
    // the specks or the occlusion.
    expect(layer).not.toMatch(/quality[^\n]*\?\s*<|if \(quality/);
    // The loop's static bound is above the knob's ceiling, so no setting can be
    // silently truncated by the compiler's own cap.
    expect(peerSchema.cohortSteps.max).toBeLessThanOrEqual(160);
    expect(lensFragment()).toContain('for (int i = 0; i < 160; i++)');
    expect(lensFragment()).toContain('if (i >= uSteps) break;');
  });

  it('gives every live knob a uniform, and re-derives every radius from the MASS', () => {
    const layer = source('ColonyCohorts.tsx');
    // The retired channels are gone from both the schema and the frame loop;
    // nothing reads a knob that no longer has a material.
    const retired = [
      'holeRim', 'holeGas', 'holeField', 'holeInfall', 'holeSpin',
      'cohortMouth', 'cohortAmp', 'cohortDensity',
      'cohortCrests', 'cohortRate', 'cohortCoreAmp',
      // …and the composed aperture's own ten, plus the mist patch's five.
      'cohortApR', 'cohortPupil', 'cohortRimAmp', 'cohortIntakeAmp',
      'cohortStriae', 'cohortStriaAmp', 'cohortHaloR', 'cohortHaloBias',
      'cohortInteriorAmp', 'cohortLevel',
      'cohortMistAmp', 'cohortGather', 'cohortReach', 'cohortWake',
      'cohortShareFloor',
    ];
    for (const knob of retired) {
      expect(peerSchema, knob).not.toHaveProperty(knob);
      expect(layer, knob).not.toContain(`LIVE.peer.${knob}`);
    }
    // ⚠️ TWO NAMES SURVIVED THE FORM CHANGE AND THEY MEAN EXACTLY WHAT THEY
    // MEANT: `cohortIntake` is the sink's k in wu²/s and `cohortSwirl` is the
    // vortex-to-sink ratio. They are facts about the SUBSTANCE, and the
    // substance is the one thing the lensed disc kept from the patch.
    expect(peerSchema.cohortIntake.value).toBe(MIST_SINK_K);
    expect(peerSchema.cohortSwirl.value).toBe(1.4);
    const knobs = [
      'cohortHorizon', 'cohortDiscOut', 'cohortDiscAmp', 'cohortBeam',
      'cohortFarAmp', 'cohortFarArms', 'cohortFarStreak', 'cohortFarSwirl',
      'cohortGlow', 'cohortWarmth', 'cohortUnfold',
      'cohortSteps', 'cohortIntake', 'cohortSwirl', 'cohortOrbit',
      'cohortMotes',
    ] as const;
    for (const knob of knobs) {
      expect(peerSchema, knob).toHaveProperty(knob);
      expect(layer, knob).toContain(`LIVE.peer.${knob}`);
    }
    // …and the folder holds those sixteen and nothing else `cohort`-shaped.
    expect(Object.keys(peerSchema).filter((key) => key.startsWith('cohort')).sort())
      .toEqual([...knobs].sort());

    // ⭐⭐⭐ THE MASS IS THE SIZE PARAMETER AND EVERY OTHER RADIUS IS A MULTIPLE
    // OF IT, so the horizon knob is READ ONCE and written three times: the mass
    // itself, the disc's inner edge (3 horizons — the ISCO) and the radius a
    // speck vanishes at (2.6 horizons — the shadow's apparent edge). A knob that
    // moved one without the others would grow the shadow out through its own
    // accretion disc, or leave the specks winking out on the silhouette instead
    // of behind it. This is the same law `uHalf` kept on the retired quads, and
    // it has shipped broken on this layer once already.
    expect(layer).toContain('const horizon = LIVE.peer.cohortHorizon;');
    expect([...layer.matchAll(/LIVE\.peer\.cohortHorizon/g)]).toHaveLength(1);
    expect(layer).toContain('lens.uHorizon.value = horizon;');
    expect(layer).toContain('lens.uDiscIn.value = cohortDiscInner(horizon);');
    expect(layer).toContain('motes.uShadowR.value = cohortShadowRadius(horizon);');
    expect(cohortDiscInner(COHORT_HORIZON)).toBe(COHORT_DISC_IN);
    expect(cohortShadowRadius(COHORT_HORIZON)).toBe(COHORT_HIT_RADIUS);
    // …and they really are functions of the knob, not of the constants.
    expect(cohortDiscInner(1)).toBe(3);
    expect(cohortShadowRadius(1)).toBeCloseTo(2.598, 3);

    // ⭐⭐ THE FOLD'S BAND AND THE SUBSTANCE'S TWO NUMBERS REACH BOTH DRAWS, off
    // one read apiece, so the disc and the specks in it cannot unfold or flow at
    // two different rates.
    for (const [read, writes] of [
      ['const unfoldHi = LIVE.peer.cohortUnfold;', ['lens.uUnfoldHi.value = unfoldHi;', 'motes.uUnfoldHi.value = unfoldHi;']],
      ['const sinkK = LIVE.peer.cohortIntake;', ['lens.uK.value = sinkK;', 'motes.uK.value = sinkK * COHORT_MOTE_K_GAIN;']],
      ['const swirl = LIVE.peer.cohortSwirl;', ['lens.uSwirl.value = swirl;', 'motes.uSwirl.value = swirl;']],
    ] as const) {
      expect(layer).toContain(read);
      for (const write of writes) expect(layer).toContain(write);
    }
    // ⚠️ AND THE SPECKS TAKE A MULTIPLE OF THE DISC'S k RATHER THAN THE SAME
    // NUMBER. The approved preview pushed the TRACKED thing a third faster than
    // the field — 16 against 12 — so the knob carries the ratio and an untouched
    // panel ships exactly what the two materials do.
    expect(layer).toContain('const COHORT_MOTE_K_GAIN = COHORT_MOTE_K / MIST_SINK_K;');
    expect(COHORT_MOTE_K / MIST_SINK_K).toBeCloseTo(4 / 3, 12);
    expect(peerSchema.cohortIntake.value * (COHORT_MOTE_K / MIST_SINK_K))
      .toBeCloseTo(COHORT_MOTE_K, 12);

    // ⭐ THE WARM LERP IS CPU-SIDE AND PER-DRAW, so it is recomputed only when
    // the knob moves — and it moves the disc's three stops and the specks'
    // colour together, because they are one substance at one temperature.
    expect(layer).toContain('if (warmth !== warmthRef.current) {');
    expect(layer).toContain('const stops = cohortDiscStops(warmth);');
    expect(layer).toContain('motes.uColor.value.setRGB(...cohortMoteColor(warmth));');
  });

  it('cannot be mistaken for the canopy contact wave, and structurally cannot become one', () => {
    // ⚠️⚠️ The nearest thing on stage to "a form around a point" is the Cell
    // canopy's block contact wave, which draws expanding pale ellipses across
    // the tissue. The load-bearing difference is the RADIUS: that one grows from
    // its own age and this one never grows at all — every radius here is a
    // multiple of a mass that only a knob and the CAMERA move.
    const layer = source('ColonyCohorts.tsx');
    for (const glsl of [lensFragment(), motesVertex()]) {
      expect(glsl).not.toMatch(/u(?:Horizon|DiscIn|DiscOut|QuadR|ShadowR)\s*[+*/-]?=/);
    }
    // …and on the CPU side every size uniform is written from a knob only. A
    // clock in one of these lines is how a mark starts to breathe in size, which
    // is the wave's whole grammar and never this one's.
    const sizeWrites = layer
      .split('\n')
      .filter((line) => /\bu(?:Horizon|DiscIn|DiscOut|ShadowR)\.value/.test(line))
      .map((line) => line.trim());
    expect(sizeWrites).toEqual([
      'lens.uHorizon.value = horizon;',
      'lens.uDiscIn.value = cohortDiscInner(horizon);',
      'lens.uDiscOut.value = LIVE.peer.cohortDiscOut;',
      'motes.uShadowR.value = cohortShadowRadius(horizon);',
    ]);
    for (const line of sizeWrites) {
      expect(line).not.toMatch(/elapsed|simClock|performance\.now|Date\.now/);
    }
    // ⭐ The contact wave grows because its OWNER rescales every instance from
    // the front's age, once a frame. This layer writes a translation and never a
    // scale, so there is no arrangement of it that expands.
    expect(source('BlockDeliveryLayer.tsx'))
      .toContain('const extent = crestRadius / CONTACT_WAVE_CREST_UV;');
    expect(layer).toContain('SCRATCH_MATRIX.makeTranslation(');
    expect(layer).not.toMatch(/makeScale|\.scale\.set|setScalar/);
  });

  it('cannot be mistaken for a courier glint either', () => {
    const layer = source('ColonyCohorts.tsx');
    const courier = source('ColonyCourierLayer.tsx');
    // A courier is a billboarded bloom plus a comet plume, fired ONCE per block,
    // travelling OUTWARD down the propagation tree and tinted that block's
    // carrier hue. This has no head to stretch, no plume texture and no carrier
    // hue — it fires on the same pulse and answers it IN PLACE, with the one
    // colour ramp the substance has ever had.
    expect(layer).not.toMatch(/makeCourier|Sprite|easeOutCubic/);
    expect(courier).toContain('makeCourierPlumeTexture');
    expect(layer).not.toContain('consensusBlockColor');
    expect(courier).toContain('consensusBlockColor(blockPulseAtMs)');
    // The mark's own light is a peer token where it meets the mesh: the far
    // halo IS the mark as the mesh sees it, so its hue is `scaffold`.
    expect(readFileSync(
      resolve(process.cwd(), 'src/materials/colonyLens.ts'), 'utf8',
    )).toContain('PEER_NETWORK_PALETTE.scaffold');
    expect(makeCohortLensMaterial().uniforms.uRimColor.value.b)
      .toBeCloseTo(PEER_NETWORK_PALETTE.scaffold[2], 6);
  });

  it('takes no shockwave and no flood OBJECT, either of which would flare every cohort at once', () => {
    // ⚠️ THE FRONT CROSSES THE WHOLE COLONY ON EVERY BLOCK, so a wave-receptive
    // mining mark would flare for every cohort as it passed — the scene showing
    // six of them discharging on a block exactly one of them won. This half of
    // the invariant did NOT move when the layer learned which block is its own:
    // what it gained was one STRING, pinned in the test below, and what it still
    // refuses is every input whose shape is "a fact about the whole colony".
    const layer = source('ColonyCohorts.tsx');
    // The compiled GLSL, not the comment above it that says so.
    for (const glsl of [lensFragment(), motesVertex()]) {
      expect(glsl).not.toMatch(/[Ss]hockwave/i);
    }
    expect(layer).not.toMatch(/shockwaveMaterial|shockwaveUniforms/);
    // ⚠️ NOR THE FLOOD ITSELF. `cf` carries an arrival time for EVERY node in
    // the colony, and a per-cohort answer built out of a colony-wide fact is the
    // exact failure this layer exists not to have. The file may NAME
    // `ColonyFlood` in its prose — the argument for the gate is an argument
    // about where one of its strings comes from — and it may not import the
    // type, because taking the object is how the colony-wide fact would get in.
    expect(layer).not.toContain("from '../derives/networkFlood.derive'");
    const network = source('NetworkColony.tsx');
    const open = network.indexOf('<ColonyCohorts');
    expect(open).toBeGreaterThan(-1);
    expect(network.slice(open, network.indexOf('/>', open)))
      .not.toMatch(/\bcf=|arrivals=|posById=|pulseRef=/);
  });

  it('keys its ONE block input to the flood’s own origin, and stamps it on the shader’s clock', () => {
    // ⭐⭐⭐ THIS TEST USED TO SAY 「takes no pulse and no flood at all」, and the
    // argument under it was sound and TOO SMALL. It held that a layer with no
    // per-block input is structurally incapable of discharging for the wrong
    // cohort — true, and a weaker guarantee than the one available, because it
    // also made the layer incapable of answering at all. The POW cohort is the
    // junction between two worlds: it draws energy in continuously AND wins a
    // block, and a mark that cannot be told which block is its own cannot
    // swallow.
    //
    // What replaces abstinence is KEYING, at the same strength: `entryId` is
    // `attested:<key>` exactly when the chain named a producer this colony
    // stands a node for, and `CohortMark.nodeId` is that same string from the
    // same `attestedNodeId`, so the gate is one string equality against the id
    // the wave itself leaves from. The BEHAVIOUR is pinned in
    // `colonyCohortShares.test.ts`; what is pinned HERE is the shape of the
    // input and the wiring that drives it, which is what makes the behaviour
    // reachable at all.
    const layer = source('ColonyCohorts.tsx');
    const network = source('NetworkColony.tsx');

    // ⚠️ ONE STRING AND TWO SCALARS, AND THE MOUNT HANDS OVER NOTHING ELSE.
    const open = network.indexOf('<ColonyCohorts');
    expect(open).toBeGreaterThan(-1);
    const mount = network.slice(open, network.indexOf('/>', open));
    expect(mount).toContain('entryId={cf.entryId}');
    expect(mount).toContain('blockPulseAtMs={blockPulseAtMs}');
    expect(mount).toContain('backfillActive={backfillActive}');
    // …and the layer's own type says so: a string, never a flood.
    expect(layer).toContain('entryId?: string | null;');
    // …and the compare is against the MARK's own id, so nothing but an attested
    // identity can reach a mark.
    expect(layer).toContain('marks.findIndex((mark) => mark.nodeId === entryId)');
    expect(attestedNodeId('0xdeadbeef')).toBe('attested:0xdeadbeef');
    expect(cohortMarks(topology)[0].nodeId)
      .toBe(attestedNodeId(cohortMarks(topology)[0].producerKey));

    // ⚠️ CONSUME-THEN-BAIL, IN THAT ORDER. A restore gap replays a backlog of
    // pulses; taking the edge without stamping is what stops the backlog
    // discharging as six gulps in a row the moment `backfill` clears, and a bail
    // that forgot to consume would fire LATE instead — a gulp with no block,
    // which is worse than a gulp missed. The ORDER is the whole gate, so it is
    // the order that is asserted.
    const gate = layer.slice(
      layer.indexOf('if (blockPulseAtMs <= lastPulseRef.current) return;'),
    );
    const consume = gate.indexOf('lastPulseRef.current = blockPulseAtMs;');
    const bail = gate.indexOf('if (backfillActive) return;');
    const stamp = gate.indexOf('cohortWinStamp(');
    expect(consume).toBeGreaterThan(-1);
    expect(bail).toBeGreaterThan(consume);
    expect(stamp).toBeGreaterThan(bail);
    // …and it is the courier's gate word for word, because there is exactly one
    // right answer to a replayed backlog and every layer in this colony that
    // reads the pulse has to give it. A copy that drifted is a layer that
    // strobes on a reconnect.
    const courier = source('ColonyCourierLayer.tsx');
    for (const line of [
      'if (blockPulseAtMs <= lastPulseRef.current) return;',
      'lastPulseRef.current = blockPulseAtMs;',
      'if (backfillActive) return;',
    ]) {
      expect([line, courier.includes(line)]).toEqual([line, true]);
    }
    // ⚠️ ON THE EDGE, which is what makes the deps list correct rather than
    // merely quiet: a re-render carrying the same pulse stamps nothing.
    expect(layer).toContain('}, [blockPulseAtMs]);');

    // ⭐⭐⭐ ONE CLOCK, AND IT IS DECIDABLE IN ONE FILE. The envelope is
    // `uTime - vGulp`; `uTime` is written from `simClock.elapsedSec` in the sim
    // frame and the stamp reads `elapsedSec` off THE SAME `useSimClock()`
    // object, two hundred lines apart in ONE component. A `performance.now()`
    // stamp would not merely shift the flare — the difference would be hundreds
    // of thousands, and `exp(-age / 0.45)` of that is zero, so the mouth would
    // never move and no test on the shader alone would notice.
    // ⚠️ COMMENTS STRIPPED FIRST, because these are claims about what the
    // program DOES: the header argues at length about the wall clock it refuses
    // and names the very call it is counting, and prose the compiler drops must
    // not be able to pass — or fail — an assertion about code.
    const code = layer.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect([...code.matchAll(/useSimClock\(\)/g)]).toHaveLength(1);
    expect(code).toContain('const simClock = useSimClock();');
    expect(code).toContain('const at = simClock.elapsedSec;');
    expect(code).toContain('const elapsed = simClock.elapsedSec;');
    expect(code).toContain('lens.uTime.value = elapsed;');
    expect(code).toContain('motes.uTime.value = elapsed;');
    expect(code).not.toMatch(/performance\.now|Date\.now/);
    // …and the pulse's own wall-clock ms never reaches the stamp itself.
    const stamped = code.slice(code.indexOf('const index = cohortWinStamp('));
    expect(stamped.slice(0, stamped.indexOf('\n'))).not.toContain('blockPulseAtMs');

    // ⭐⭐ THE WIN IS HELD AGAINST THE NODE ID AND RE-LAID UNDER EVERY PLAN. A
    // lane is indexed by POSITION and the staged set reshuffles, so a walk that
    // left it alone would hand whoever takes a slot the moment its previous
    // occupant won — discharging for the wrong cohort through the back door of
    // a re-plan rather than through a bad key.
    expect(layer).toContain('const wonAtRef = useRef<Map<string, number>>(new Map());');
    expect(layer)
      .toContain('cohortWinLane(marks, wonAtRef.current, lanes.gulp.array as Float32Array);');
    // Keyed off the MARK's id and not off `entryId`, so the map and the lane
    // cannot disagree about which cohort was stamped.
    expect(layer).toContain('wonAtRef.current.set(marks[index].nodeId, at);');

    // ⚠️ AND IT WRITES A BUFFER, NEVER A STATE. All three props already reach
    // this layer's parent on every block, so nothing here is a new React render
    // — and had any of it become state, the memoized colony subtree would
    // re-render once a block and the argument on `ProducerSharesRef` would have
    // been undone by the very layer it was written for.
    expect(layer).not.toMatch(/useState|useReducer/);

    // ⚠️⚠️ AND THE DELIVERY PULSE REF WAS THE OTHER CANDIDATE, REFUSED ON TWO
    // MEASURED FACTS. `NetworkColony` already stamps `{ at, entryId, color }`
    // for `BlockDeliveryLayer` — the sim seconds and the entry id this lane
    // needs, at no new prop. But it carries that block's CARRIER HUE into a
    // layer pinned not to know `consensusBlockColor` exists, and it is
    // DESTRUCTIVELY consumed: the delivery layer nulls it, calls itself the
    // ref's only reader, and `deliveryScheduleHorizon` returns 0 for an empty
    // delivery list — so on a topology with no local node and no arrivals that
    // retire lands in the same frame as the stamp. A second reader of a ref
    // whose retire policy belongs to another layer is a gulp that stops with no
    // diff to point at.
    expect(layer).not.toContain('pulseRef');
    expect(source('BlockDeliveryLayer.tsx')).toContain('pulseRef.current = null;');
    expect(readFileSync(resolve(process.cwd(), 'src/derives/peers.derive.ts'), 'utf8'))
      .toContain('if (deliveries.length === 0) return 0;');
  });

  it('spends the share lane on BOTH draws, at the two widths they can read', () => {
    // ⭐⭐⭐ THE SHARE IS A RATE AND THE SINK'S k IS A RATE — wu²/s in
    // `r0² = r² + k·τ` — so it becomes a SPEED and the pile that speed leaves at
    // the disc's inner edge. Under the composed form only the mist patch had a
    // rate to spend it on and both aperture programs refused the lane; the lens
    // inherited the patch's job along with its three lanes, and the specks are
    // parcels of the same substance, so both consume it now.
    const lens = makeCohortLensMaterial();
    expect(lensVertex()).toContain('attribute float aShare;');
    expect(lensVertex()).toContain('uniform float uShareFloor;');
    expect(lensVertex()).toContain('uniform float uShareMax;');
    expect(lensFragment()).toContain('varying float vShareF;');
    expect(lens.uniforms.uShareMax.value).toBe(1);

    // ⚠️⚠️ THE SPECKS CANNOT READ THE SAME LANE, and that is a property of the
    // geometry rather than a choice. A `THREE.Points` draw has one vertex per
    // MOTE, so a per-instance attribute would be read by the first
    // ninety-sixth of the colony's specks and by garbage after it. The layer
    // therefore runs `mistShareFactor` on the CPU and writes the ANSWER into
    // `aStrength` — same function, same floor, one width apart.
    expect(motesVertex()).toContain('attribute float aStrength;');
    expect(motesVertex()).not.toContain('aShare');
    const layer = source('ColonyCohorts.tsx');
    expect([...layer.matchAll(/mistShareFactor\(/g)]).toHaveLength(2);

    // ⭐⭐ ONE BIND, ON THE LENS'S GEOMETRY, OF THE LANE OBJECT ITSELF — never a
    // fresh wrapper around `lanes.share.array`, which would be a second GL
    // buffer with the first one orphaned.
    expect([...layer.matchAll(/setAttribute\('aShare'/g)]).toHaveLength(1);
    expect(layer).toContain("lensGeometry.setAttribute('aShare', lanes.share);");
    expect(layer).not.toMatch(/setAttribute\('aShare',\s*new /);
    expect(layer).toContain("lensGeometry.setAttribute('aSeed', lanes.seed);");
    expect(lensVertex()).toContain('attribute float aSeed;');
    // The lane is still written in place off the window's ref and still marked
    // ONCE for the whole walk — and the walk hands back the maximum the shader
    // divides by, so the two cannot be computed from different lists.
    expect(layer).toContain('shareMaxRef.current = cohortShareLane(marks, producers, share);');
    expect(layer).toContain('lanes.share.needsUpdate = true;');
    expect(layer).toContain('lens.uShareMax.value = shareMaxRef.current;');
  });

  it('lays the GULP lane as ONE wrapper on the quad and a 96-wide COPY on the specks', () => {
    const layer = source('ColonyCohorts.tsx');
    // ⚠️⚠️⚠️ ZERO WOULD READ AS "WON AT BOOT" AND FLARE THE WHOLE COLONY ON
    // LOAD. The lane holds the SIM SECOND of the block each cohort won and the
    // envelope is a function of `uTime - aGulp`; an unfilled `Float32Array` is
    // all zeros, and `uTime` also starts at zero. R16 shipped exactly that.
    // `cohortGulp.test.ts` measures the sentinel's silence over every clock a
    // session reaches; this is where the ALLOCATION is pinned — on BOTH
    // buffers, since the specks' copy is filled by `buildCohortMotesGeometry`.
    expect(COHORT_NEVER_WON).toBe(-1e6);
    expect(layer).toContain('new Float32Array(capacity).fill(COHORT_NEVER_WON),');

    // ⭐⭐ ONE WRAPPER PER LANE, AND THE WRAPPER IS THE IDENTITY THREE UPLOADS
    // BY. A second `InstancedBufferAttribute` around the same array is a second
    // GL buffer, and the first one is then orphaned — which is why the lanes are
    // built exactly once, inside the capacity memo, and bound rather than
    // rebuilt. Exactly THREE constructions in the file, one per lane.
    expect([...layer.matchAll(/new THREE\.InstancedBufferAttribute\(/g)]).toHaveLength(3);
    expect([...layer.matchAll(/setAttribute\('aGulp'/g)]).toHaveLength(1);
    expect([...layer.matchAll(/setAttribute\('aSeed'/g)]).toHaveLength(1);
    expect(layer).not.toMatch(/setAttribute\('aGulp',\s*new /);
    expect(layer).not.toMatch(/setAttribute\('aSeed',\s*new /);

    // ⭐⭐⭐ AND THE SPECKS TAKE THE SAME VALUE, WIDENED — never the same object.
    // Handing a Points geometry the instanced wrapper would read one cohort's
    // stamp for the first ninety-sixth of the colony's motes and garbage after
    // it, which is a bug with no diff to point at. `stampCohortMotes` is called
    // in the SAME two places the instanced lane is written: the re-lay under a
    // plan and the stamp on a pulse.
    expect([...layer.matchAll(/stampCohortMotes\(/g)]).toHaveLength(2);
    expect(layer).toContain('stampCohortMotes(motesGeometry, index, at);');
    expect(layer).toContain('wonAtRef.current.get(mark.nodeId) ?? COHORT_NEVER_WON,');
    expect([...layer.matchAll(/lanes\.gulp\.needsUpdate = true;/g)]).toHaveLength(2);
    expect(lensVertex()).toContain('attribute float aGulp;');
    expect(motesVertex()).toContain('attribute float aGulp;');
    // ⚠️ THE LIVE OBJECT CANNOT BE REACHED FROM HERE, AND THAT IS WHY THIS IS A
    // SOURCE TEST. `Canvas` never commits its r3f tree under jsdom — `onCreated`
    // does not fire, the scene stays empty and no geometry exists to compare —
    // which is exactly why the mount test above only asserts that it does not
    // throw. The invariant is pinned where it is decidable; the BEHAVIOUR of the
    // widening is measured on real geometry in `colonyCohortShares.test.ts`.
  });

  it('reads no standing at all in its plan, so a window that moved cannot move a mark', () => {
    // ⭐⭐ THE SPLIT THAT KEEPS THE GEOMETRY STILL. A cohort's blocks and share
    // change on EVERY block while its key, its placement and its seed do not,
    // so a plan that read the window would rewrite this layer's instance
    // matrices once a block for a numerator that moved.
    expect(cohortMarks.length).toBeLessThanOrEqual(2); // (topology, cap)
    const layer = source('ColonyCohorts.tsx');
    expect(layer).toContain('const plan = useMemo(() => cohortMarks(topology), [topology]);');
    // The share reaches its lane off the window's REF, once per identity
    // change, never off a prop that would re-render the memoized colony once a
    // block.
    expect(layer).toContain('}, [producersRef, writeShares]);');
    expect(layer).toContain('if (live === writtenSharesRef.current) return;');
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

    // ⚠️ …and a mark whose NODE MOVED must break it. A reseed keeps every id
    // while moving every point, so a test on ids alone would call an entirely
    // rearranged colony unchanged and leave these masses hanging in the space
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

  it('needs no rotation maths, because only its seat turns with the colony', () => {
    // The courier and the delivery stand OUTSIDE the counter-rotating group and
    // carry every point and axis through `colonyFrame.rotationY` themselves,
    // because their billboard bases are world-frame. This one rides the group:
    // the instance matrix carries a translation and the group turns it.
    const layer = source('ColonyCohorts.tsx');
    expect(layer).toContain('SCRATCH_MATRIX.makeTranslation(');
    expect(layer).not.toContain('SCRATCH_MATRIX.makeScale(');
    expect(layer).not.toContain('colonyFrame');
    expect(source('ColonyCourierLayer.tsx')).toContain('colonyFrame.rotationY');
    // ⭐ AND THE ORIGIN IS READ IN THE VERTEX SHADER, on whatever frame the GPU
    // is drawing, so the mark parallaxes and turns with the colony for free and
    // a CPU-written origin can never lag behind the rotation.
    expect(lensVertex())
      .toContain('vec4 origin = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);');
    expect(Object.keys(makeCohortLensMaterial().uniforms)).not.toContain('uOrigin');
    // ⭐⭐ AND THE SUBSTANCE IS SAMPLED IN THE COLONY'S OWN FRAME, which is the
    // one thing this port could not take from the lab: the lab's scene has an
    // identity model matrix, and here a cohort's WORLD position sweeps several
    // world units a second. A medium sampled at a world point would stream past
    // its own mouth. The quad carries the colony's axes and the instance's
    // colony-frame seat instead, and the specks lay their whole fall out in that
    // frame — the model matrix reaching a mote exactly once, to measure how far
    // away the camera is.
    expect(lensVertex()).toContain('vFrameX = (modelMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xz;');
    expect(lensVertex()).toContain('vSeat = seat.xz;');
    expect(motesVertex()).toContain('vec3 seat = (modelMatrix * vec4(aOrigin, 1.0)).xyz;');
    expect([...motesVertex().matchAll(/modelMatrix/g)]).toHaveLength(1);
  });
});
