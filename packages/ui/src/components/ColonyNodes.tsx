// ColonyNodes — the P2P "colony" rendered as ONE glow-node primitive across
// four honesty classes and five stops of one confidence gradient (never five
// visual languages):
//   • inferred ghosts   — ONE faint additive <points> cloud (~240 minus the
//     staged count): a "possible network" haze. Each point is the SAME soft
//     core+halo radial as the measured halo, drawn small and — this is the
//     part that has to hold — under the additive clip, so it stays haze
//     instead of a white speck the eye reads as a node. Non-selectable.
//   • attested nodes    — ONE more <points> draw at a stop directly above the
//     haze: a node the CHAIN proves exists and cannot name. It is the exact
//     inverse of the faintest roster rung — certain existence, zero identity —
//     so it rests near the haze on this axis on purpose and asserts its
//     presence on the OTHER one (see the rings below). Clickable, because the
//     chain has real things to say about it.
//   • roster nodes      — THREE more <points> draws off the same factory, one
//     per rung of the crawler's evidence gradient (it reached the node / it
//     only remembers reaching it / the network names it and nobody has ever
//     had an answer out of it). Every rung is a stop brighter than the ghosts
//     and below the measured core, at 1.3x to 3.1x their diameter: the tiers
//     have to separate in FOOTPRINT, because brightness clips and the inferred
//     edges pile light onto every junction they cross — and in the footprint
//     a viewer SEES, which the sprite diameter alone does not predict. Real identity, invented
//     position, no link of ours — so they are clickable through ONE instanced
//     invisible hit mesh sized from those same marks, and every edge they
//     carry stays inferred fiction.
//   • measured nodes    — one bright, saturated, larger glow-halo per real peer:
//     a billboarded plane carrying that same core+halo shader,
//     gently breathing, with an invisible solid sphere hit-target so it stays
//     clickable (a camera-facing plane raycasts poorly). The honest "measured
//     core."
// The local "you" is NOT drawn here: the colony's local node is pinned onto the
// galaxy's labeled CkbNodeAnchor (App feeds inferredTopology its world pos), so
// that single cyan anchor is the one "you" and the measured belts converge on it.
//
// ⭐ AND ONE SECOND AXIS, which is the only thing in this file that is not a
// stop on the confidence gradient: the PRODUCER RINGS. The gradient answers "how
// do we know this node exists" and spends both brightness and footprint doing
// it; mining answers "what does this node do", so it is drawn in the one channel
// left — motion. A ring whose radius is that producer's share of the recent
// window charges between blocks and discharges on the block it wins, and the
// candidates a build-string join narrows to carry a 1/N arc of that same ring
// rather than an edge, because an edge here means "talks to" and a candidate tie
// means "may be the same machine". See `producerRingMaterial`.
//
// A new block stamps a radial brightness shockwave at the colony flood's entry
// node. It brightens these existing topology nodes while ColonyEdges carries the
// graph-accurate surge and ColonyCourierLayer supplies the moving glint. The Cell
// field keeps only delivery/commit feedback; the broad wave belongs here.
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import {
  cellCanvasCursor,
  NETWORK_PEER_PICK_FLAG,
} from '../derives/cellInteraction.derive';
import { useSimFrame } from '../tweaks/useSimFrame';
import { useSimClock } from '../tweaks/SimClockScope';
import { LIVE } from '../tweaks/liveTweaks';
import { phaseFor, rateFor } from './GlowNode';
import { CkbSelectionReticle } from './CellGalaxy';
import { colonyFrame } from '../tweaks/colonyFrame';
import {
  PEER_COLORS,
  peerColorKind,
  rotYLocalToWorldXZ,
} from '../derives/peers.derive';
import type { RosterNodeState } from '@cknerv/types';
import type { NetworkNode, NetworkTopology, NodeKind, Vec3 } from '../types';
import type { ColonyFlood } from '../derives/networkFlood.derive';
import type { ProducerStanding } from '../derives/blockProducers.derive';
import { consensusBlockColor } from '../derives/consensusFlow.derive';
import {
  makeShockwaveUniforms,
  SHOCKWAVE_SLOTS,
  writeShockwaveSlot,
  type ShockwaveUniforms,
} from '../materials/shockwaveMaterial';
import {
  makeMeasuredPeerHalosMaterial,
  makePeerCloudMaterial,
  peerCloudHitRadius,
  PEER_CLOUD_ADVERTISED_TONE,
  PEER_CLOUD_ATTESTED_TONE,
  PEER_CLOUD_SIGHTED_DARK_TONE,
  PEER_CLOUD_SIGHTED_TONE,
  type PeerCloudTone,
} from '../materials/peerNodeMaterial';
import {
  makeProducerRingMaterial,
  producerAnnulusHit,
  producerRingRadius,
  PRODUCER_RING_FIRE_S,
  PRODUCER_RING_HIT_BAND,
  PRODUCER_RING_MIN_RADIUS,
  PRODUCER_RING_SHARE_RADIUS,
  PRODUCER_RING_UNFIRED,
} from '../materials/producerRingMaterial';
import { attestedNodeId, ATTESTED_ID_PREFIX } from '../derives/networkTopology.derive';
import { producerOriginStats } from '../derives/producerOriginStats';

// Measured core: bright, saturated, larger than the ghost haze.
const MEASURED_SIZE = 1.4;

/** Selection id prefix for a sighted node — the colony's third dialect beside
 *  `peer:` (measured) and the bare chain-node id. */
const SIGHTED_SELECTION_PREFIX = 'sighted:';

/** Selection id prefix for an attested node — the colony's FOURTH dialect.
 *
 *  ⚠️ IT IS NOT THE GRAPH ID'S PREFIX, and the difference is deliberate rather
 *  than sloppy. The graph files a producer under `attested:<key>`, named for the
 *  RUNG — how the fact was obtained — which is settled and belongs to the
 *  topology. A selection id names what the user is looking at, and the word for
 *  that is `MINER`, which the app already stamps as a role elsewhere. Keeping
 *  them apart means the card's vocabulary can be re-decided without touching one
 *  line of the graph, and the graph's namespace can never be read as a claim
 *  about what a node does.
 *
 *  The key after the prefix is the payout key, NOT the node id — a card asks the
 *  live producer view for its standing, and the view is keyed on that. */
export const MINER_SELECTION_PREFIX = 'miner:';

/** The stops this tier draws, FAINTEST FIRST — which is also the order the
 *  clouds mount in, so the DOM reads in the same direction the eye does. One
 *  table: the draw split, the mount order and every pick radius below are all
 *  read off it, so a stop cannot be retuned in one of those places and not the
 *  others. */
export const SIGHTED_STOPS = {
  advertised: PEER_CLOUD_ADVERTISED_TONE,
  remembered: PEER_CLOUD_SIGHTED_DARK_TONE,
  reached: PEER_CLOUD_SIGHTED_TONE,
} as const;

export type SightedStop = keyof typeof SIGHTED_STOPS;

const SIGHTED_STOP_ORDER = Object.keys(SIGHTED_STOPS) as SightedStop[];

/** Which stop each rung of the crawler's gradient draws at.
 *
 *  Exhaustive by TYPE rather than by habit: a rung grown upstream widens
 *  `RosterNodeState` and stops this file compiling until somebody says what it
 *  looks like, which is the same gate `STAGEABLE_ROSTER_STATES` holds on the
 *  staging side. Neither half is any use alone — a rung that stages with no
 *  mark stands an invisible target, a mark no rung reaches is dead paint — so
 *  the two are checked against each other rather than trusted to stay in step. */
const STOP_BY_ROSTER_STATE: Readonly<Record<RosterNodeState, SightedStop>> = {
  reachable: 'reached',
  verified_unavailable: 'remembered',
  advertised_unverified: 'advertised',
};

/** ⭐ THE LADDER FALLS THROUGH TO ITS FAINTEST RUNG, EVERYWHERE. That direction
 *  is load-bearing rather than stylistic: the predecessor asked
 *  `reachable !== false`, so a node whose state was missing — an older record,
 *  a rung nobody has taught this file about yet — rendered at the brightness
 *  reserved for a peer the crawler dialed this round. Brightness on this axis
 *  is a claim about how the fact was obtained, and an unknown must always cost
 *  it, never gain it. In production nothing reaches here at all: a state with
 *  no mark never leaves `stageSighted`. This is what that gate leaks INTO if it
 *  ever fails, which is the only reason it names the faintest stop rather than
 *  throwing. */
export const SIGHTED_FALLTHROUGH_STOP: SightedStop = 'advertised';

/** Which stop one staged node draws at. Exported so the fallthrough can be
 *  tested against a state this file has never heard of, which is the only way
 *  to tell the guard apart from its inverse. */
export function sightedStop(node: NetworkNode): SightedStop {
  const state = node.sighted?.state;
  // `RosterNodeState` is a claim about the wire, not a check on it — a decoded
  // record can carry a rung this build has never heard of — so the lookup is
  // allowed to miss, and the miss has to land somewhere named.
  const named = state === undefined
    ? undefined
    : (STOP_BY_ROSTER_STATE as Partial<Record<string, SightedStop>>)[state];
  return named ?? SIGHTED_FALLTHROUGH_STOP;
}

/** A staged node's invisible hit sphere IS its mark: every stop hands its own
 *  world diameter to `peerCloudHitRadius`, so the brighter stops carry the
 *  larger targets and a retune of one moves the other with it. The target is
 *  the footprint, never a generous pick disc — the Cell canopy yields this
 *  pixel through NETWORK_PEER_PICK_FLAG, so it is taken from that layer. */
export const SIGHTED_HIT_RADII = Object.fromEntries(
  SIGHTED_STOP_ORDER.map((stop) => [stop, peerCloudHitRadius(SIGHTED_STOPS[stop])]),
) as Readonly<Record<SightedStop, number>>;

function sightedHitRadius(node: NetworkNode): number {
  return SIGHTED_HIT_RADII[sightedStop(node)];
}

/** The staged nodes split into one bucket per stop, faintest first.
 *
 *  ⭐ ONE PASS, ONE BUCKET EACH — a partition BY CONSTRUCTION rather than N
 *  filters that have to add up to each other's complement. The hit mesh walks
 *  the staged list WHOLE and hands every instance the radius of its own stop,
 *  so a node in no bucket would stand an invisible target with no mark over it
 *  and a node in two would be double-booked. Exported because that property is
 *  the one thing about this split worth a test, and a loop inside a component
 *  cannot be asked about it. */
export function partitionByStop(
  sighted: readonly NetworkNode[],
): Readonly<Record<SightedStop, NetworkNode[]>> {
  const groups = {} as Record<SightedStop, NetworkNode[]>;
  for (const stop of SIGHTED_STOP_ORDER) groups[stop] = [];
  for (const node of sighted) groups[sightedStop(node)].push(node);
  return groups;
}

/** Keep handing back the list a point buffer was already built from, for as long
 *  as `matches` holds pairwise. Every topology rebuild re-splits the node list
 *  into fresh arrays; a cloud that keys its geometry on one of them pays a GPU
 *  delete/alloc/upload for points that did not move. What "did not move" MEANS
 *  differs per tier, so each caller supplies its own test. Exported for
 *  out-of-band testing — nothing outside this file renders a colony cloud. */
export function useStableList<T>(next: T[], matches: (a: T, b: T) => boolean): T[] {
  const held = useRef(next);
  const prev = held.current;
  if (prev !== next) {
    let unchanged = prev.length === next.length;
    for (let i = 0; unchanged && i < next.length; i += 1) unchanged = matches(prev[i], next[i]);
    if (!unchanged) held.current = next;
  }
  return held.current;
}

const sameNodeObject = (a: NetworkNode, b: NetworkNode): boolean => a === b;
const sameNodeId = (a: NetworkNode, b: NetworkNode): boolean => a.id === b.id;

/** Every draw this file splits the colony into, in mount order.
 *
 *  `anchor` is a real answer and not a hole: the local "you" is drawn by the
 *  galaxy's labeled CkbNodeAnchor, which App pins the colony's local node onto,
 *  so this file's answer to "what does `local` look like" is "somebody else's
 *  mark, deliberately". A bucket that names it is what keeps that sentence
 *  checkable instead of a comment. */
export const COLONY_DRAWS = ['haze', 'attested', 'sighted', 'measured', 'anchor'] as const;

export type ColonyDraw = typeof COLONY_DRAWS[number];

/** Which draw each rung of the colony ladder gets.
 *
 *  ⭐⭐ THE MISSING GATE, PUT IN. `RosterNodeState` has had one for as long as
 *  the sighted tier has existed (`STOP_BY_ROSTER_STATE`, above: a rung grown
 *  upstream widens the type and stops this file compiling until somebody says
 *  what it looks like). `NodeKind` had NONE — no `Record<NodeKind, …>`, no
 *  switch, every consumer opting IN by literal — and it cost exactly what a
 *  missing gate costs: when `attested` was added, widening the type broke
 *  nothing at all, and the new rung silently rendered as nothing. That was the
 *  right behaviour for that commit and it was arrived at by luck, which is the
 *  part worth fixing.
 *
 *  ⭐ SO THE TABLE HAS TO BE LOAD-BEARING, or it is decoration that drifts. The
 *  three `.filter(n => n.kind === …)` passes this replaced could each be right
 *  while the set of them left a rung out; `partitionByKind` cannot, because
 *  every node is placed exactly once by looking its kind up HERE. A kind added
 *  upstream now stops this file compiling until somebody has answered the
 *  question, and the answer may perfectly well be "the galaxy draws it".
 *
 *  It is a claim about OUR OWN derive rather than about the wire — every node in
 *  the colony is built by `inferredTopology`, in this repo, from this type — so
 *  unlike the roster table it has no faintest rung to fall through to. A kind
 *  with no draw is drawn by nobody, which is the honest state and never a
 *  borrowed mark that would say something false. */
const DRAW_BY_NODE_KIND: Readonly<Record<NodeKind, ColonyDraw>> = {
  inferred: 'haze',
  attested: 'attested',
  sighted: 'sighted',
  measured: 'measured',
  local: 'anchor',
};

/** The colony's nodes split one bucket per draw, in ONE pass.
 *
 *  A partition by construction, for the same reason `partitionByStop` is one:
 *  a node in no bucket is a node nothing draws, and a node in two is drawn
 *  twice. Exported because that property is the only thing about this split
 *  worth a test, and a loop inside a component cannot be asked about it. */
export function partitionByKind(
  nodes: readonly NetworkNode[],
): Readonly<Record<ColonyDraw, NetworkNode[]>> {
  const groups = {} as Record<ColonyDraw, NetworkNode[]>;
  for (const draw of COLONY_DRAWS) groups[draw] = [];
  for (const node of nodes) {
    // `NodeKind` is a compile-time claim this file now holds a gate on, so the
    // lookup cannot miss in production. A hand-built node in a lab or a test
    // can still carry a kind nobody named; it is drawn by nobody rather than
    // dropped into a bucket whose mark would misdescribe it.
    const draw = (DRAW_BY_NODE_KIND as Partial<Record<string, ColonyDraw>>)[node.kind];
    if (draw !== undefined) groups[draw].push(node);
  }
  return groups;
}

/** An attested node's BODY target — its point sprite, exactly as a sighted
 *  stop's hit sphere is its own.
 *
 *  ⭐ IT IS ONE OF THIS NODE'S TWO TARGETS, not the whole of it, and the
 *  difference was found on a real GPU rather than argued from the source. This
 *  radius alone made the producer the smallest target in the colony — 0.375
 *  world units, under the faintest roster rung's 0.425 — while it wore the
 *  largest mark in it, a ring drawn from 1.4 out to 3.0. A 13-pixel hover sweep
 *  of the whole canvas found forty peers and zero producers. The file's own
 *  rule ("a staged node's invisible hit sphere IS its mark") had been applied
 *  to the sprite, and for a producer the mark is the RING — so the ring's
 *  stroke is a target too (`stagedPickBounds`).
 *
 *  ⚠️ THE BODY KEEPS ITS OWN TARGET ANYWAY. Annulus OR body, never annulus
 *  instead of body: a user who aims at the node itself must still hit the node,
 *  and the hole the ring encloses is where that happens. */
export const ATTESTED_HIT_RADIUS = peerCloudHitRadius(PEER_CLOUD_ATTESTED_TONE);

/** One clickable staged node: where it stands, how big its mark is, and what
 *  selecting it says. Three targets, one shape — see `stagedPickTargets`. */
export interface StagedPickTarget {
  /** The node's graph id. It is also the hover word this layer publishes, so
   *  it has to be the id every other layer would recognise. A producer's ring
   *  carries the SAME id as its body: they are two ways to press one node, and
   *  the hover word may not depend on which one the pointer found. */
  readonly id: string;
  /** What `onSelect` is handed. The tiers speak different dialects and the hit
   *  mesh must not have to know which. */
  readonly selectionId: string;
  readonly pos: Vec3;
  /** A SOLID target's world radius — its own mark — or `null` when this target
   *  is the hollow ring annulus below. */
  readonly bodyRadius: number | null;
  /** The producer share the RING ANNULUS's radius follows, or `null` when this
   *  target is a solid body. Exactly one of the two is ever non-null.
   *
   *  ⭐ THE SHARE AND NOT A RADIUS, because the radius is the ring material's
   *  to compute: it is resolved through `producerRingRadius` against the same
   *  two live knobs the vertex shader sizes the quad from, so a retune moves
   *  the stroke and its tolerance together. Storing a radius here would be the
   *  second constant this whole change exists to remove. */
  readonly ringShare: number | null;
}

/** The world radii one pick target occupies: a solid ball out to `outer` when
 *  `inner` is zero, and the hollow band between the two otherwise. */
export interface StagedPickBounds {
  readonly inner: number;
  readonly outer: number;
}

/**
 * Where one target's surface stands, resolved against the ring knobs in force.
 *
 * A body is a ball from the centre out to its own mark. A producer's ring is a
 * BAND: `PRODUCER_RING_HIT_BAND` either side of wherever the stroke is being
 * drawn this frame, which is `producerRingRadius` of its share and nothing
 * else. The hole inside stays empty on purpose — the ring's interior belongs to
 * whatever stands there, and a producer's own body target is one of the things
 * that stands there.
 *
 * Pure, and exported to be tested directly: an r3f pick surface cannot be
 * asked in jsdom what it is clickable at, so this is where that coverage lives.
 */
export function stagedPickBounds(
  target: StagedPickTarget,
  ringMinRadius: number = PRODUCER_RING_MIN_RADIUS,
  ringShareRadius: number = PRODUCER_RING_SHARE_RADIUS,
): StagedPickBounds {
  if (target.ringShare === null) return { inner: 0, outer: target.bodyRadius ?? 0 };
  const radius = producerRingRadius(target.ringShare, ringMinRadius, ringShareRadius);
  return {
    inner: Math.max(0, radius - PRODUCER_RING_HIT_BAND),
    outer: radius + PRODUCER_RING_HIT_BAND,
  };
}

/** Every staged node the colony lets you click, in mount order.
 *
 *  ⭐ ONE LIST, ONE HIT MESH, TWO TIERS. Hundreds of one-mesh-per-node targets
 *  are the wrong shape for the raycaster; so is a second instanced mesh per
 *  tier, which would pay a second bounding-sphere reject on every raycast and
 *  keep a second copy of the hover-ownership guards. It also fixes a hole the
 *  per-tier arrangement would have left: the sighted mesh only mounts when a
 *  crawler has spoken, and ckbadger is OPTIONAL — a cknerv with no crawler at
 *  all still has producers, and they would have been unclickable.
 *
 *  Sighted bodies first, then attested bodies, then the ring annuli, so
 *  instance indices stay where they were for a colony that has no producers —
 *  and so a `find` by selection id reaches a producer's BODY before its ring,
 *  which is what keeps the selection reticle the size of the node rather than
 *  the size of the ring.
 *
 *  ⭐⭐ THE ANNULI ARE BUILT FROM THE RING PLAN ITSELF, which is the whole
 *  answer to "how do the mark and the target stay one thing". They take the
 *  ring's own `pos` and the ring's own `share`, so an instance nobody draws has
 *  no target, a producer the colony is standing no node for has neither, and
 *  the two cannot end up at different places or different sizes.
 *
 *  ⚠️ A CANDIDATE ARC IS NOT A PRODUCER TARGET, and `fires` is the field that
 *  says so. An arc stands on a CANDIDATE PEER and means "may be the same
 *  machine"; clicking that peer must open its own PEER / SIGHTED card, which
 *  carries the `MINER?` stamp and its denominator, and must never open the
 *  MINER card — a set of one is refused outright precisely so no arrangement of
 *  this scene reads as an identification. Note that an arc carries the
 *  PRODUCER's key, so filtering on `producerKey` would have made every
 *  candidate a producer target; `fires` is the one field that separates a
 *  producer's own ring from a slice of it standing on somebody else. */
export function stagedPickTargets(
  sighted: readonly NetworkNode[],
  attested: readonly NetworkNode[],
  rings: readonly ProducerRingInstance[],
): StagedPickTarget[] {
  const out: StagedPickTarget[] = [];
  for (const node of sighted) {
    out.push({
      id: node.id,
      selectionId: `${SIGHTED_SELECTION_PREFIX}${node.id}`,
      pos: node.pos,
      bodyRadius: sightedHitRadius(node),
      ringShare: null,
    });
  }
  for (const node of attested) {
    // The selection carries the PAYOUT KEY, which is what a card resolves a
    // standing from; the hover word stays the graph id. `attested` is present
    // on every node this tier stages, and the id is the key behind its
    // namespace either way, so neither reading can go missing.
    const key = node.attested?.key ?? node.id.slice(ATTESTED_ID_PREFIX.length);
    out.push({
      id: node.id,
      selectionId: `${MINER_SELECTION_PREFIX}${key}`,
      pos: node.pos,
      bodyRadius: ATTESTED_HIT_RADIUS,
      ringShare: null,
    });
  }
  for (const ring of rings) {
    if (!ring.fires) continue;
    out.push({
      id: attestedNodeId(ring.producerKey),
      selectionId: `${MINER_SELECTION_PREFIX}${ring.producerKey}`,
      pos: ring.pos,
      bodyRadius: null,
      ringShare: ring.share,
    });
  }
  return out;
}

// Measured node tint = the real peer palette: version-mismatch (violet) wins,
// else connection direction — single-sourced via peerColorKind (see the
// value-keyed memo in MeasuredNode).

/**
 * The inferred scaffold as a single additive point cloud. `position` is
 * allocated once (this component owns the geometry) and never mutated. Per-block
 * state stays in shared uniforms, so every in-flight wave crosses the same fixed
 * topology without rebuilding the point buffer.
 */
function InferredCloud({
  staged,
  contextEnergyRef,
  shockwaveUniforms,
}: {
  /** The haze bucket of `partitionByKind`. The ghosts are the derive's CACHED
   *  scaffold objects, pushed into the node list by reference and handed back
   *  untouched until the seed or a staged tail changes — so object identity is
   *  exactly the test for "these points stand where they stood", and it is the
   *  only test that survives a reseed (which keeps every `inf:n` id while
   *  moving every point). */
  staged: NetworkNode[];
  contextEnergyRef?: { readonly current: number };
  shockwaveUniforms: ShockwaveUniforms;
}) {
  const simClock = useSimClock();
  const gl = useThree((state) => state.gl);
  const inferred = useStableList(staged, sameNodeObject);

  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(inferred.length * 3);
    inferred.forEach((n, i) => {
      pos[i * 3] = n.pos[0];
      pos[i * 3 + 1] = n.pos[1];
      pos[i * 3 + 2] = n.pos[2];
    });
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    return g;
  }, [inferred]);

  const mat = useMemo(
    () => makePeerCloudMaterial(shockwaveUniforms),
    [shockwaveUniforms],
  );

  // Dispose the geometry whenever it is rebuilt (and on unmount).
  useEffect(() => () => geom.dispose(), [geom]);
  // The material is memoized on [] (stable for the component's life), so dispose
  // it on UNMOUNT ONLY — tearing it down on a geometry rebuild would dispose the
  // live, reused material and force a needless shader recompile on every re-clone.
  useEffect(() => () => mat.dispose(), [mat]);
  useSimFrame(() => {
    mat.uniforms.uTime.value = simClock.elapsedSec;
    mat.uniforms.uContextEnergy.value = contextEnergyRef?.current ?? 1;
    // The sprite is sized in world units, so it needs the live drawing buffer:
    // a window resize or a quality-tier DPR change moves it under the material.
    mat.uniforms.uViewportHeight.value = gl.domElement.height;
  });

  // Non-selectable: an explicit no-op raycast so the ghost cloud can NEVER be
  // picked. r3f's pointer events already skip it (no handlers), but — unlike a
  // plain Object3D — THREE.Points ships a real default raycast, so guard it
  // defensively. Only the measured nodes carry onClick → onSelect('peer:…').
  return <points geometry={geom} material={mat} frustumCulled={false} raycast={() => null} />;
}

/**
 * One stop's worth of staged nodes as a single additive point cloud — the
 * ghost cloud's pattern, cloned: `position` only, one shared material, the same
 * wave uniforms and the same context-energy damping. The tone (brightness,
 * size, core falloff) is a creation-time uniform rather than a per-point
 * attribute, because the vertex-attribute budget sits at a cliff and one more
 * Points draw is cheaper than a slot — which is why a THIRD stop cost this
 * tier one draw call and not one byte of vertex layout, and a FOURTH (the
 * attested rung, on a tier of its own) cost the same.
 *
 * Named for what it draws rather than for one of its callers: the crawler's
 * three rungs and the chain's one are the same construction at a different
 * stop, and the day they stopped being one component is the day a stop could
 * quietly acquire a second visual language.
 *
 * Its raycast is a no-op too: the pixel belongs to the instanced hit mesh below,
 * so the visible sprite never competes with it.
 */
function StagedCloud({
  nodes,
  tone,
  contextEnergyRef,
  shockwaveUniforms,
}: {
  nodes: NetworkNode[];
  tone: PeerCloudTone;
  contextEnergyRef?: { readonly current: number };
  shockwaveUniforms: ShockwaveUniforms;
}) {
  const simClock = useSimClock();
  const gl = useThree((state) => state.gl);

  // Unlike the ghosts, these node objects are re-staged from the crawler's row
  // on every build, so identity says nothing. Their POSITIONS are `sightedPos`
  // of the id and nothing else — the same fact the derive's scaffold cache is
  // keyed on — so the id sequence is what this buffer follows. A round that
  // adds, drops or reorders a node changes it, and so does one that moves a
  // node up or down the gradient (it changes clouds); a round that only
  // refreshed last_seen does not.
  const points = useStableList(nodes, sameNodeId);

  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(points.length * 3);
    points.forEach((n, i) => {
      pos[i * 3] = n.pos[0];
      pos[i * 3 + 1] = n.pos[1];
      pos[i * 3 + 2] = n.pos[2];
    });
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    return g;
  }, [points]);

  const mat = useMemo(
    () => makePeerCloudMaterial(shockwaveUniforms, tone),
    [shockwaveUniforms, tone],
  );

  useEffect(() => () => geom.dispose(), [geom]);
  useEffect(() => () => mat.dispose(), [mat]);
  useSimFrame(() => {
    mat.uniforms.uTime.value = simClock.elapsedSec;
    mat.uniforms.uContextEnergy.value = contextEnergyRef?.current ?? 1;
    mat.uniforms.uViewportHeight.value = gl.domElement.height;
  });

  return <points geometry={geom} material={mat} frustumCulled={false} raycast={() => null} />;
}

/** How much of its own radius the hit mesh's 8×8 unit sphere actually covers.
 *
 *  The geometry is a polyhedron whose VERTICES sit on the sphere, so its faces
 *  dip inside it — deepest in the middle of a face, by a conservative
 *  `cos(π/8)²` of the radius. A solid body has always paid that quietly and it
 *  costs a target nobody measures a few percent. A BAND cannot pay it: a
 *  nine-pixel ring that loses three of them in eight places is thin exactly
 *  where somebody happens to aim. So an annulus instance is inflated until its
 *  faces reach its true outer radius and `producerAnnulusHit` cuts the surplus
 *  back off. The geometry over-covers; the arithmetic decides where the edge
 *  is, and it decides it as a circle. */
const HIT_SPHERE_INSCRIBED = Math.cos(Math.PI / 8) ** 2;

/** Scratch for the pick filter below. Module scope for the same reason three's
 *  own raycast keeps its own: a raycast runs on every pointer move. */
const SCRATCH_HITS: THREE.Intersection[] = [];
const SCRATCH_INSTANCE = new THREE.Matrix4();
const SCRATCH_CENTER = new THREE.Vector3();
const SCRATCH_TOWARDS = new THREE.Vector3();
const BASE_INSTANCED_RAYCAST = THREE.InstancedMesh.prototype.raycast;

/**
 * Every staged node's INTERACTION surface, once for the whole colony: ONE
 * instanced invisible hit mesh over both staged tiers, and the reticle for the
 * selected one. The visible marks are the point clouds and the rings above;
 * nothing here is drawn at all.
 *
 * Hundreds of one-mesh-per-node targets would be the wrong shape for the
 * raycaster, so a single InstancedMesh answers once and hands back
 * `e.instanceId`. The invisible MATERIAL keeps that raycast alive while the
 * renderer skips the draw (the MeasuredNode/anchor trick), and the mesh carries
 * NETWORK_PEER_PICK_FLAG so the Cell picker yields the pixel — the existing
 * arbitration path, not a new one.
 *
 * ⭐ THE NAMED AND THE PROVED ARE CLICKABLE AND THE HAZE IS NOT, because the
 * difference is what each one has to say. A ghost is invented and answers
 * "nothing". A node the network names carries aliases the crawler tried, how
 * far each dial got, how many rounds running it has failed and how many
 * independent peers name it. A node the CHAIN attests carries how many of the
 * recent blocks it made, out of how many, what it declared it was running, and
 * which crawled peers — if any — that narrows to. Paying for that is one
 * instance, and the instance costs an `instanceMatrix` row plus a
 * bounding-sphere reject on each raycast. What it does spend is SCREEN: the
 * target is the mark, so it takes exactly its own glow from the Cell canopy
 * below and not one pixel more, and the faintest stop draws the smallest mark
 * precisely because it has the weakest claim.
 *
 * ⭐⭐ AND FOR A PRODUCER THE MARK IS THE RING, which is the one place this
 * layer needs more than a sphere. `InstancedMesh.raycast` answers with a solid
 * ball per instance, and a ball at the ring's radius would swallow everything
 * inside the dominant producer's ring. So the instance is scaled to the band's
 * OUTER edge and one comparison cuts the hole back out of it: a ray closer to
 * the node than the band's inner edge is dropped before it reaches `intersects`
 * at all, so the interior falls through to whatever stands there — a sighted
 * peer, a ghost, a Cell, the producer's own body, or nothing.
 *
 * ⚠️ AND THE ANNULUS COMPETES AT ITS OWN DEPTH, not at the front of that ball.
 * The ring is a billboard standing at the node's own distance; the ball's near
 * face is up to a couple of world units closer, and left alone it would have
 * won the distance sort against every mark that happened to lie under the
 * stroke. The hit is re-stamped onto the plane the ring is actually drawn on,
 * so two overlapping marks resolve by which one is really in front.
 */
function PickableStagedNodes({
  targets,
  selectedId,
  onSelect,
}: {
  targets: StagedPickTarget[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const gl = useThree((state) => state.gl);
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const hitUserData = useMemo(() => ({ [NETWORK_PEER_PICK_FLAG]: true }), []);
  // The BODY, never the ring: a producer has two targets under one selection
  // id, and a reticle sized from the annulus would be a circle drawn around the
  // ring instead of around the node. Bodies are planned first, so this would
  // find the right one anyway; asking for it means a later reorder cannot
  // quietly change the answer.
  const selected = useMemo(
    () => targets.find(
      (t) => t.selectionId === selectedId && t.bodyRadius !== null,
    ) ?? null,
    [selectedId, targets],
  );

  // A UNIT sphere: each instance is scaled to its own target's extent below.
  const geometry = useMemo(() => new THREE.SphereGeometry(1, 8, 8), []);
  const material = useMemo(() => new THREE.MeshBasicMaterial({ visible: false }), []);
  useEffect(() => () => {
    geometry.dispose();
    material.dispose();
  }, [geometry, material]);

  const capacity = Math.max(1, targets.length);
  // Where each instance's surface stands, in the mesh's own units — read by the
  // raycast filter, which only ever has an `instanceId` to go on. Allocated per
  // capacity and written in place, the same discipline the instanced lanes
  // elsewhere in this file keep.
  const hitBounds = useMemo(() => ({
    inner: new Float32Array(capacity),
    outer: new Float32Array(capacity),
  }), [capacity]);
  const hitBoundsRef = useRef(hitBounds);
  hitBoundsRef.current = hitBounds;
  const targetsRef = useRef(targets);
  targetsRef.current = targets;
  // The ring knobs the placement below was last resolved against, so a live
  // retune can be noticed without keeping a leva subscription here.
  const ringKnobsRef = useRef<[number, number]>([NaN, NaN]);
  const hasAnnulusRef = useRef(false);

  // Per-instance placement, written once per topology — and again only when a
  // ring knob moves under it.
  const applyInstances = () => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const ringMinRadius = LIVE.peer.ringRadiusMin;
    const ringShareRadius = LIVE.peer.ringRadiusShare;
    ringKnobsRef.current = [ringMinRadius, ringShareRadius];
    const list = targetsRef.current;
    const bounds = hitBoundsRef.current;
    let hasAnnulus = false;
    mesh.count = list.length;
    list.forEach((target, index) => {
      const { inner, outer } = stagedPickBounds(target, ringMinRadius, ringShareRadius);
      bounds.inner[index] = inner;
      bounds.outer[index] = outer;
      if (inner > 0) hasAnnulus = true;
      // A hollow band gets the inflation its faces need; a solid body is sized
      // exactly at its mark, as it always has been.
      const scale = inner > 0 ? outer / HIT_SPHERE_INSCRIBED : outer;
      SCRATCH_MATRIX.makeScale(scale, scale, scale);
      SCRATCH_MATRIX.setPosition(target.pos[0], target.pos[1], target.pos[2]);
      mesh.setMatrixAt(index, SCRATCH_MATRIX);
    });
    hasAnnulusRef.current = hasAnnulus;
    mesh.instanceMatrix.needsUpdate = true;
    // An instanced raycast rejects on the bounding sphere first, and three
    // computes that ONCE and caches it — so the volume left over from the
    // previous matrices would answer for these. A producer's annulus is several
    // times the widest sphere this mesh used to hold, which makes getting this
    // wrong the difference between a clickable colony and a colony where NO
    // staged node can be picked at all, producers included.
    mesh.computeBoundingSphere();
  };

  useEffect(() => {
    applyInstances();
    // `applyInstances` reads the live targets through a ref, so it is stable in
    // everything this effect is keyed on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targets, capacity, hitBounds]);

  // ⭐ THE MARK AND THE TARGET MOVE TOGETHER, INCLUDING UNDER A LIVE RETUNE.
  // The ring's radius uniforms are refreshed from these two knobs every frame,
  // so a drag on either reshapes rings already on screen; a plan captured at
  // memo time would leave the target behind and re-open, mid-tuning, exactly
  // the gap between mark and target this whole surface exists to close. Raw
  // `useFrame` rather than the sim clock — this is pointer behaviour, and a
  // paused scene is still a scene somebody is tuning.
  useFrame(() => {
    if (!hasAnnulusRef.current) return;
    const [minRadius, shareRadius] = ringKnobsRef.current;
    if (LIVE.peer.ringRadiusMin === minRadius
      && LIVE.peer.ringRadiusShare === shareRadius) return;
    applyInstances();
  });

  /**
   * The hit test: three's own instanced raycast, with the ring holes cut out.
   *
   * Everything that makes the answer correct — the mesh bounding-sphere reject,
   * the per-instance test, `instanceId` — is three's, and this only ever
   * REMOVES hits from it. What it removes is a ray that struck a producer's
   * annulus inside the hole, which in screen terms is a ray landing within the
   * ring rather than on it. The perpendicular distance from the pointer ray to
   * the node is the screen-space radius the ring is billboarded at, so one
   * comparison answers it at any camera angle with no plane to keep in sync.
   */
  const hitRaycast = useMemo(() => function stagedNodesRaycast(
    this: THREE.InstancedMesh,
    raycaster: THREE.Raycaster,
    intersects: THREE.Intersection[],
  ): void {
    SCRATCH_HITS.length = 0;
    BASE_INSTANCED_RAYCAST.call(this, raycaster, SCRATCH_HITS);
    const list = targetsRef.current;
    const bounds = hitBoundsRef.current;
    const { ray } = raycaster;
    // The mesh's own frame is a rotation in production (the colony counter-
    // rotates and is never scaled), but a bound written in mesh units has to be
    // compared against a WORLD distance either way. Resolved lazily, so a
    // colony with no producers never pays for it.
    let worldScale = -1;
    for (const hit of SCRATCH_HITS) {
      const index = hit.instanceId;
      if (index === undefined) continue;
      const target = list[index];
      if (target === undefined) continue;
      if (target.ringShare !== null) {
        if (worldScale < 0) worldScale = this.matrixWorld.getMaxScaleOnAxis();
        this.getMatrixAt(index, SCRATCH_INSTANCE);
        SCRATCH_CENTER.setFromMatrixPosition(SCRATCH_INSTANCE)
          .applyMatrix4(this.matrixWorld);
        if (!producerAnnulusHit(
          ray.distanceToPoint(SCRATCH_CENTER),
          bounds.inner[index] * worldScale,
          bounds.outer[index] * worldScale,
        )) continue;
        // Re-stamped onto the billboard the ring is drawn on — see the note on
        // this component. `hit.face` / `hit.uv` describe the sphere that stood
        // in for it and nothing downstream reads them.
        hit.distance = SCRATCH_TOWARDS.copy(SCRATCH_CENTER)
          .sub(ray.origin)
          .dot(ray.direction);
        ray.at(hit.distance, hit.point);
      }
      intersects.push(hit);
    }
    SCRATCH_HITS.length = 0;
  }, []);

  const syncCursor = () => {
    const canvas = gl.domElement;
    canvas.style.cursor = cellCanvasCursor(
      canvas.dataset.cellPickerHover !== undefined,
      canvas.dataset.cellCausalNavigationHover !== undefined,
      canvas.dataset.peerNodeHover !== undefined,
    );
  };

  // Which ids this layer is allowed to clear: the hover word is shared with the
  // measured peers and the chain anchor, so we only ever retract our own.
  const ownedRef = useRef<ReadonlySet<string>>(new Set());
  useEffect(() => {
    const canvas = gl.domElement;
    const previous = ownedRef.current;
    ownedRef.current = new Set(targets.map((t) => t.id));
    // A roster round can retire a node while the pointer is still on it, and no
    // pointer-out ever fires for a node that stopped existing. So can a
    // producer leaving the rolling window.
    const hovered = canvas.dataset.peerNodeHover;
    if (hovered === undefined || ownedRef.current.has(hovered) || !previous.has(hovered)) return;
    delete canvas.dataset.peerNodeHover;
    syncCursor();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, targets]);
  // …and the same guard for the layer's own unmount (gl is stable for the
  // canvas's life, so this cleanup runs on unmount only).
  useEffect(() => () => {
    const canvas = gl.domElement;
    const hovered = canvas.dataset.peerNodeHover;
    if (hovered === undefined || !ownedRef.current.has(hovered)) return;
    delete canvas.dataset.peerNodeHover;
    canvas.style.cursor = cellCanvasCursor(
      canvas.dataset.cellPickerHover !== undefined,
      canvas.dataset.cellCausalNavigationHover !== undefined,
      false,
    );
  }, [gl]);

  const targetAt = (instanceId: number | undefined): StagedPickTarget | undefined => (
    instanceId === undefined ? undefined : targets[instanceId]
  );

  return (
    <group>
      <instancedMesh
        ref={meshRef}
        args={[geometry, material, capacity]}
        frustumCulled={false}
        userData={hitUserData}
        raycast={hitRaycast}
        onClick={(e) => {
          const target = targetAt(e.instanceId);
          if (target === undefined) return;
          e.stopPropagation();
          onSelect(target.selectionId);
        }}
        onPointerOver={(e) => {
          const id = targetAt(e.instanceId)?.id;
          if (id === undefined) return;
          gl.domElement.dataset.peerNodeHover = id;
          syncCursor();
        }}
        onPointerOut={(e) => {
          // r3f v8 cancels the stale instance BEFORE it enters the new one, so
          // by the time a word belongs to somebody else it is somebody else's
          // hand — retracting it here would strand the cursor on a live target.
          const id = targetAt(e.instanceId)?.id;
          if (id !== undefined && gl.domElement.dataset.peerNodeHover === id) {
            delete gl.domElement.dataset.peerNodeHover;
          }
          syncCursor();
        }}
      />
      {selected ? (
        <group position={selected.pos}>
          <CkbSelectionReticle size={(selected.bodyRadius ?? 0) * 2.4} />
        </group>
      ) : null}
    </group>
  );
}

/** One instance of the producer ring material: a whole ring for a producer, or
 *  one candidate's slice of that same ring, standing on the candidate. */
export interface ProducerRingInstance {
  /** Stable per-instance identity. Not used by the GPU; it is what a test can
   *  read the plan by, and what the fire lane is remapped through. */
  readonly key: string;
  /** Whose ring this is. An arc carries the PRODUCER's key, never the peer's —
   *  the arc is a slice of the producer's claim, not a claim about the peer. */
  readonly producerKey: string;
  readonly pos: Vec3;
  /** The producer's share of the window. The radius, and nothing else. */
  readonly share: number;
  /** First turn of the ring this instance covers, in [0,1). */
  readonly arcStart: number;
  /** Turns it covers: 1 for a producer's whole ring, 1/N for a candidate. */
  readonly arcSweep: number;
  /** Whether this instance may ever discharge. Only a producer's own ring can:
   *  a candidate is not KNOWN to have mined anything, and a discharging arc
   *  would be exactly the accusation the whole fan construction refuses. */
  readonly fires: boolean;
}

/**
 * The ring plan: one instance per staged producer, plus one arc per candidate
 * of every producer whose fan T4 already decided may be drawn.
 *
 * ⭐⭐ READ THE STANDINGS FROM THE VIEW, NEVER FROM `node.attested`. The App's
 * topology memo is keyed on the producer KEY SET alone — it has to be, or the
 * colony's geometry rebuilds once a block and truncates every in-flight wave —
 * so `inferredTopology` is not re-invoked when a tally moves, and the standing
 * hanging off a staged node is the one captured at the last key-set change.
 * Stale between changes. The node is the authority on IDENTITY and PLACEMENT;
 * the view is the authority on the window. Same split `selectedSighted` already
 * draws, asking the live roster rather than the row on the node.
 *
 * ⭐ THE ARCS OF ONE FAN COMPOSE EXACTLY ONE RING. N candidates, 1/N turns
 * each, laid end to end from 0 — so six peers each show sixty degrees, and the
 * six of them overlaid are one whole producer. That is the claim the join
 * actually supports ("the machine is somewhere in this set") drawn as the thing
 * it is, and it is why a candidate mark is not an edge: an edge in this colony
 * means "talks to", and this means "may be the same machine".
 *
 * ⚠️ A CANDIDATE THIS COLONY IS NOT STANDING A NODE FOR IS DROPPED, AND THE
 * REMAINING ARCS KEEP THEIR OWN SLOTS. The roster is a bounded sample and the
 * staging set is smaller still, so a fan can name a peer with nowhere to stand.
 * Re-dividing the ring among the ones that are left would redraw N as M and
 * make the claim look narrower than it is; leaving gaps says "and some of them
 * are not on this stage", which is true.
 */
export function producerRingInstances(
  producers: readonly ProducerStanding[] | null | undefined,
  posById: ReadonlyMap<string, Vec3>,
): ProducerRingInstance[] {
  if (!producers || producers.length === 0) return [];
  const out: ProducerRingInstance[] = [];
  for (const producer of producers) {
    const pos = posById.get(`${ATTESTED_ID_PREFIX}${producer.key}`);
    // A producer the colony is not standing a node for has no ring: the ring
    // is drawn AROUND a node, and there is no node.
    if (pos === undefined) continue;
    out.push({
      key: producer.key,
      producerKey: producer.key,
      pos,
      share: producer.share,
      arcStart: 0,
      arcSweep: 1,
      fires: true,
    });
    // T4 applied the four gates; this reads the verdict and never re-litigates
    // it. A withheld fan carries a count and no identities at all, so there is
    // nothing here to draw even if somebody wanted to.
    if (!producer.fan.drawn) continue;
    const total = producer.fan.candidates.length;
    producer.fan.candidates.forEach((candidate, index) => {
      const at = posById.get(candidate.node_id);
      if (at === undefined) return;
      out.push({
        key: `${producer.key}|${candidate.node_id}`,
        producerKey: producer.key,
        pos: at,
        share: producer.share,
        arcStart: index / total,
        arcSweep: 1 / total,
        fires: false,
      });
    });
  }
  return out;
}

/**
 * Every producer ring and every candidate arc in ONE additive instanced draw.
 *
 * ⭐ THE RHYTHM IS THE MARK. All producers charge from the same instant — one
 * shared uniform, stamped on the block that just landed — and exactly one
 * discharges, on the block it won. That is proof of work drawn as what it is,
 * and it costs one uniform and one per-instance stamp.
 *
 * The fire lane is kept in a ref keyed by PRODUCER KEY rather than by instance
 * index, and both writers go through one helper. Indices move: the staging
 * order is blocks-descending, so the block that arms a discharge is frequently
 * the same block that reorders the list under it, and a lane written by index
 * would land a producer's win on whoever took its slot.
 */
function ProducerRings({
  instances,
  cf,
  blockPulseAtMs,
  backfillActive,
  contextEnergyRef,
}: {
  instances: ProducerRingInstance[];
  cf: ColonyFlood;
  blockPulseAtMs: number;
  backfillActive: boolean;
  contextEnergyRef?: { readonly current: number };
}) {
  const simClock = useSimClock();
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const material = useMemo(() => makeProducerRingMaterial(), []);
  // A UNIT quad: the vertex shader sizes it from `aShare`, so a live retune of
  // the radius moves every ring next frame with no buffer rewrite.
  const geometry = useMemo(() => new THREE.PlaneGeometry(2, 2), []);
  const capacity = Math.max(1, instances.length);

  // ⚠️ Wrapping data in a NEW InstancedBufferAttribute is what orphans its GL
  // buffer, and the static walk runs on every block. The WRAPPERS persist for a
  // capacity; the walks write through `.array` and mark them.
  const lanes = useMemo(() => ({
    share: new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1),
    fireAt: new THREE.InstancedBufferAttribute(
      new Float32Array(capacity).fill(PRODUCER_RING_UNFIRED), 1,
    ),
    arcStart: new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1),
    arcSweep: new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1),
  }), [capacity]);

  // producer key → the absolute simClock second it last discharged. Pruned to
  // the decay window, so it cannot grow with the chain.
  const firedRef = useRef(new Map<string, number>());
  const instancesRef = useRef(instances);
  instancesRef.current = instances;

  // The one writer of the fire lane, called from both effects below. Reading
  // the map by key is what survives a reorder landing in the same flush as a
  // discharge.
  const writeFireLane = () => {
    const fired = firedRef.current;
    const lane = lanes.fireAt.array as Float32Array;
    instancesRef.current.forEach((instance, index) => {
      lane[index] = instance.fires
        ? fired.get(instance.producerKey) ?? PRODUCER_RING_UNFIRED
        : PRODUCER_RING_UNFIRED;
    });
    lanes.fireAt.needsUpdate = true;
  };

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    mesh.count = instances.length;
    const share = lanes.share.array as Float32Array;
    const arcStart = lanes.arcStart.array as Float32Array;
    const arcSweep = lanes.arcSweep.array as Float32Array;
    instances.forEach((instance, index) => {
      SCRATCH_MATRIX.makeTranslation(instance.pos[0], instance.pos[1], instance.pos[2]);
      mesh.setMatrixAt(index, SCRATCH_MATRIX);
      share[index] = instance.share;
      arcStart[index] = instance.arcStart;
      arcSweep[index] = instance.arcSweep;
    });
    mesh.instanceMatrix.needsUpdate = true;
    lanes.share.needsUpdate = true;
    lanes.arcStart.needsUpdate = true;
    lanes.arcSweep.needsUpdate = true;
    // The lane a block writes, rewritten from the same map: a producer that
    // discharged half a second ago keeps its flash across a re-plan.
    writeFireLane();
    // Bound on the first pass and again only when a capacity change built new
    // lanes. The geometry outlives the InstancedMesh (a capacity change
    // rebuilds the mesh through `args`), so it can still hold the previous set.
    if (mesh.geometry.getAttribute('aShare') !== lanes.share) {
      mesh.geometry.setAttribute('aShare', lanes.share);
      mesh.geometry.setAttribute('aFireAt', lanes.fireAt);
      mesh.geometry.setAttribute('aArcStart', lanes.arcStart);
      mesh.geometry.setAttribute('aArcSweep', lanes.arcSweep);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instances, lanes]);

  // Per-block: everyone's charge restarts, and the producer the flood is
  // entering through — which is the producer the chain named on this block, or
  // nobody — discharges. `t0` is captured HERE, in this owner's own effect, the
  // way every per-block armer in the colony captures its own: simClock is
  // constant across React's effect flush, so the stamps are synced without a
  // parent ref that a child could read before it was written.
  const lastPulseRef = useRef(blockPulseAtMs);
  useEffect(() => {
    if (blockPulseAtMs <= lastPulseRef.current) return;
    // Consume while backfilling so a historical backlog cannot replay as one
    // strobe of discharges when live mode resumes.
    lastPulseRef.current = blockPulseAtMs;
    if (backfillActive) return;

    const t0 = simClock.elapsedSec;
    material.uniforms.uChargeSince.value = t0;
    const fired = firedRef.current;
    // Forget a stamp once its flash is long over — measured against the LIVE
    // duration the shader is drawing with, so raising the knob cannot prune a
    // discharge that is still on screen.
    const forgetAfterS = Math.max(PRODUCER_RING_FIRE_S, LIVE.peer.ringFireS) * 4;
    for (const [key, at] of fired) {
      if (t0 - at > forgetAfterS) fired.delete(key);
    }
    // ⭐ THE WINNER IS THE FLOOD'S OWN ENTRY NODE, not a second lookup. The
    // flood already resolved the block's producer key against the staged
    // colony (`attestedOrigin`), and asking that question twice is how the ring
    // and the wave would come to disagree about which block this was. An
    // anonymous block enters through a ghost and no ring fires — which is the
    // truth: nobody we can name won it.
    if (cf.entryId !== null && cf.entryId.startsWith(ATTESTED_ID_PREFIX)) {
      fired.set(cf.entryId.slice(ATTESTED_ID_PREFIX.length), t0);
    }
    writeFireLane();
    // cf/backfillActive are recomputed in the same render that advances
    // blockPulseAtMs; use the pulse as the sole event edge.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blockPulseAtMs]);

  useEffect(() => () => geometry.dispose(), [geometry]);
  // Memoized on [] (stable for this component's life) → dispose on UNMOUNT
  // ONLY, or every capacity change would force a shader recompile.
  useEffect(() => () => material.dispose(), [material]);

  useSimFrame(() => {
    material.uniforms.uTime.value = simClock.elapsedSec;
    material.uniforms.uContextEnergy.value = contextEnergyRef?.current ?? 1;
    material.uniforms.uRingMinRadius.value = LIVE.peer.ringRadiusMin;
    material.uniforms.uRingShareRadius.value = LIVE.peer.ringRadiusShare;
    material.uniforms.uRingWidth.value = LIVE.peer.ringWidth;
    material.uniforms.uRingDim.value = LIVE.peer.ringDim;
    material.uniforms.uRingCharge.value = LIVE.peer.ringCharge;
    material.uniforms.uChargeTau.value = LIVE.peer.ringChargeTau;
    material.uniforms.uFireS.value = LIVE.peer.ringFireS;
    material.uniforms.uFireAmp.value = LIVE.peer.ringFireAmp;
    material.uniforms.uArcFallback.value = LIVE.peer.ringArcFallback;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, capacity]}
      frustumCulled={false}
      // ⚠️ A ring quad is centred on its own node and many times the node's
      // mark across, so a live raycast here would sit in front of that node's
      // hit sphere and swallow every click aimed at it.
      raycast={() => null}
    />
  );
}

/**
 * EVERY measured peer's glow-halo in one instanced draw. Replaces the
 * per-peer drei Billboard + single-quad mesh (two frame subscribers and a
 * fresh Euler per peer per frame): the shader rebuilds the camera-facing
 * quad from the view matrix and evaluates the per-node breathe from
 * instanced rate/phase against one shared clock. Per-peer identity (tint,
 * phase, rate, selection) rides instanced attributes rewritten only when
 * the measured set or the selection changes.
 */
function MeasuredPeerHalos({
  measured,
  localVersion,
  selectedId,
  contextEnergyRef,
  shockwaveUniforms,
}: {
  measured: NetworkNode[];
  localVersion: string;
  selectedId: string | null;
  contextEnergyRef?: { readonly current: number };
  shockwaveUniforms: ShockwaveUniforms;
}) {
  const simClock = useSimClock();
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const material = useMemo(
    () => makeMeasuredPeerHalosMaterial(shockwaveUniforms),
    [shockwaveUniforms],
  );
  const geometry = useMemo(() => {
    const plane = new THREE.PlaneGeometry(MEASURED_SIZE * 6, MEASURED_SIZE * 6);
    return plane;
  }, []);
  const capacity = Math.max(1, measured.length);

  // The four per-peer lanes, allocated once for a capacity and rewritten in
  // place. ⚠️ Wrapping data in a NEW InstancedBufferAttribute is what orphans
  // its GL buffer, and both walks below run on every roster round and every
  // selection — so the WRAPPER is what has to persist, not just the array.
  const lanes = useMemo(() => ({
    color: new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3),
    phase: new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1),
    rate: new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1),
    selected: new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1),
  }), [capacity]);

  // Static per-peer identity: rewritten only when the measured set (or a
  // version tint input) changes — the topology memo is churn-stable.
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    mesh.count = measured.length;
    const color = lanes.color.array as Float32Array;
    const phase = lanes.phase.array as Float32Array;
    const rate = lanes.rate.array as Float32Array;
    measured.forEach((node, index) => {
      SCRATCH_MATRIX.makeTranslation(node.pos[0], node.pos[1], node.pos[2]);
      mesh.setMatrixAt(index, SCRATCH_MATRIX);
      const [r, g, b] = PEER_COLORS[peerColorKind(node.peer!, localVersion)];
      color[index * 3] = r;
      color[index * 3 + 1] = g;
      color[index * 3 + 2] = b;
      phase[index] = phaseFor(node.id);
      rate[index] = 0.7 + 0.6 * rateFor(node.id);
    });
    mesh.instanceMatrix.needsUpdate = true;
    lanes.color.needsUpdate = true;
    lanes.phase.needsUpdate = true;
    lanes.rate.needsUpdate = true;
    // Bound on the first pass and again only when a capacity change built new
    // lanes. The geometry outlives the InstancedMesh (a capacity change
    // rebuilds the mesh through `args`), so it can still be holding the
    // previous set.
    if (mesh.geometry.getAttribute('aPeerColor') !== lanes.color) {
      mesh.geometry.setAttribute('aPeerColor', lanes.color);
      mesh.geometry.setAttribute('aPeerPhase', lanes.phase);
      mesh.geometry.setAttribute('aPeerRate', lanes.rate);
      mesh.geometry.setAttribute('aPeerSelected', lanes.selected);
    }
  }, [lanes, localVersion, measured]);

  useEffect(() => {
    if (!meshRef.current) return;
    const selected = lanes.selected.array as Float32Array;
    measured.forEach((node, index) => {
      selected[index] = selectedId === `peer:${node.peer!.node_id}` ? 1 : 0;
    });
    lanes.selected.needsUpdate = true;
  }, [lanes, measured, selectedId]);

  useEffect(() => () => {
    geometry.dispose();
    material.dispose();
  }, [geometry, material]);

  // The single frame subscriber the whole measured belt now costs.
  useSimFrame(() => {
    material.uniforms.uTime.value = simClock.elapsedSec;
    material.uniforms.uContextEnergy.value = contextEnergyRef?.current ?? 1;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, capacity]}
      frustumCulled={false}
    />
  );
}

const SCRATCH_MATRIX = new THREE.Matrix4();

/**
 * The measured tier's hit target, once for the whole colony: a UNIT sphere and
 * an invisible material, scaled to the mark at each node — the sighted tier's
 * own construction, which has to be module scope here because that tier is one
 * instanced mesh and this one is a component per peer.
 *
 * A hit target has no per-node parameter, so a fresh 128-triangle sphere and a
 * fresh material per measured peer was a GL buffer and a material record per
 * peer, allocated and orphaned on every roster churn.
 *
 * ⚠️ `dispose={null}` on the mesh below is what keeps this shared: r3f v8's
 * unmount walks an object's own properties and disposes each one, so a single
 * peer leaving the roster would otherwise free the geometry every other peer
 * is still drawing.
 */
const MEASURED_HIT_GEOMETRY = new THREE.SphereGeometry(1, 8, 8);
const MEASURED_HIT_MATERIAL = new THREE.MeshBasicMaterial({ visible: false });

/**
 * One measured peer's INTERACTION surface: the invisible solid hit-target
 * (a camera-facing plane raycasts poorly) and the selection reticle. The
 * visible halo itself is drawn by MeasuredPeerHalos in one instanced pass.
 *
 * The hit mesh carries NETWORK_PEER_PICK_FLAG so the Cell picker can yield
 * the pixel (a nearer Cell would otherwise win every distance sort), and it
 * advertises itself through the shared canvas-cursor arbitration — the same
 * dataset-flag contract the Cell picker and causal lens already follow.
 */
function MeasuredNode({
  node,
  selected,
  onSelect,
}: {
  node: NetworkNode;
  selected: boolean;
  onSelect: (id: string | null) => void;
}) {
  const gl = useThree((state) => state.gl);
  const peerId = node.peer!.node_id;
  const hitUserData = useMemo(() => ({ [NETWORK_PEER_PICK_FLAG]: true }), []);

  const syncCursor = () => {
    const canvas = gl.domElement;
    canvas.style.cursor = cellCanvasCursor(
      canvas.dataset.cellPickerHover !== undefined,
      canvas.dataset.cellCausalNavigationHover !== undefined,
      canvas.dataset.peerNodeHover !== undefined,
    );
  };

  // Churn can unmount a hovered peer without a pointer-out; never leave the
  // canvas advertising a hand for a node that no longer exists.
  useEffect(() => () => {
    const canvas = gl.domElement;
    if (canvas.dataset.peerNodeHover !== peerId) return;
    delete canvas.dataset.peerNodeHover;
    canvas.style.cursor = cellCanvasCursor(
      canvas.dataset.cellPickerHover !== undefined,
      canvas.dataset.cellCausalNavigationHover !== undefined,
      false,
    );
  }, [gl, peerId]);

  return (
    <group position={node.pos}>
      {/* An invisible MATERIAL keeps the raycast (the Raycaster never
          consults material.visible) while the renderer skips the draw. */}
      <mesh
        userData={hitUserData}
        geometry={MEASURED_HIT_GEOMETRY}
        material={MEASURED_HIT_MATERIAL}
        scale={MEASURED_SIZE}
        dispose={null}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(`peer:${peerId}`);
        }}
        onPointerOver={() => {
          gl.domElement.dataset.peerNodeHover = peerId;
          syncCursor();
        }}
        onPointerOut={() => {
          if (gl.domElement.dataset.peerNodeHover === peerId) {
            delete gl.domElement.dataset.peerNodeHover;
          }
          syncCursor();
        }}
      />
      {selected ? <CkbSelectionReticle size={MEASURED_SIZE * 2.4} /> : null}
    </group>
  );
}

/**
 * Composes the colony: the inferred ghost cloud + the attested rung + the
 * sighted tier + one measured glow-node per real peer, unified as a single glow
 * primitive on a confidence gradient — and, on the second axis, the producer
 * rings. The local "you" is drawn by the galaxy (its labeled CkbNodeAnchor),
 * NOT here. This owner stamps one shared ring-buffer slot per block so inferred
 * and measured nodes cannot drift or cancel an older in-flight wave.
 */
export default function ColonyNodes({
  topology,
  cf,
  blockPulseAtMs,
  backfillActive = false,
  selectedId,
  onSelect,
  localVersion,
  producers,
  contextEnergyRef,
}: {
  topology: NetworkTopology;
  cf: ColonyFlood;
  blockPulseAtMs: number;
  backfillActive?: boolean;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  localVersion: string;
  /** ⭐⭐ THE LIVE WINDOW, and the only thing here allowed to say what a
   *  producer's standing is. The staged node carries the standing it had at the
   *  last KEY-SET change, because that is what the topology memo is keyed on
   *  and it must be — anything a block moves would rebuild the colony's
   *  geometry once a block and truncate every wave in flight. So the node is
   *  identity and placement; this is blocks, share, window and fan. Optional:
   *  a scene with no producers, a devnet that has not mined and a caller that
   *  never learned about producers are one code path. */
  producers?: readonly ProducerStanding[] | null;
  contextEnergyRef?: { readonly current: number };
}) {
  const simClock = useSimClock();
  // ONE pass, one bucket per draw, off the one table that says what each rung
  // of `NodeKind` looks like.
  const byKind = useMemo(() => partitionByKind(topology.nodes), [topology]);
  const measured = byKind.measured;
  const sighted = byKind.sighted;
  const attested = byKind.attested;
  // A crawler that could not reach a node this round still knows it exists, and
  // a node it has never reached is still one the network keeps naming. Both are
  // real, dimmer information, and each costs one extra draw rather than a slot.
  const byStop = useMemo(() => partitionByStop(sighted), [sighted]);
  // The ring plan follows PLACEMENT from the topology and every NUMBER from the
  // live view — see `producerRingInstances`.
  const posById = useMemo(() => {
    const m = new Map<string, Vec3>();
    for (const n of topology.nodes) m.set(n.id, n.pos);
    return m;
  }, [topology]);
  const ringInstances = useMemo(
    () => producerRingInstances(producers, posById),
    [producers, posById],
  );
  // ⭐ THE PICK PLAN IS DOWNSTREAM OF THE RING PLAN, and that ordering is the
  // whole guarantee: a producer's ring stroke is clickable because the very
  // list that draws it is the list the target is cut from. It re-plans once per
  // attributed block, which is when the ring plan re-plans anyway — a share
  // moves, so a radius moves, so a target moves with it.
  const pickTargets = useMemo(
    () => stagedPickTargets(sighted, attested, ringInstances),
    [sighted, attested, ringInstances],
  );
  const shockwaveUniforms = useMemo(() => makeShockwaveUniforms(), []);
  const shockwaveSlotRef = useRef(0);
  const lastPulseRef = useRef(blockPulseAtMs);

  useEffect(() => {
    if (blockPulseAtMs <= lastPulseRef.current) return;
    lastPulseRef.current = blockPulseAtMs;
    // Consume while backfilling so a historical backlog cannot replay as one
    // network-wide strobe when live mode resumes.
    if (backfillActive) {
      producerOriginStats.observeSuppressed();
      return;
    }

    const origin = topology.nodes.find((node) => node.id === cf.entryId)
      ?? topology.nodes.find((node) => node.id === topology.localId);
    if (!origin) return;

    // ⭐ THE ORIGIN'S ONLY OBSERVABLE, counted where the wave is actually
    // armed. It is one integer on an edge this owner already handles, and it
    // is the only way anything outside the render can answer the question the
    // origin change was made to answer: over a few dozen blocks, do the waves
    // erupting from a producer's node come out at that producer's share of the
    // window? Counted here rather than inside `colonyFlood`, which is a memo
    // that re-runs on every topology rebuild and would count one block many
    // times; and counted as ARMED rather than as finished, because a key-set
    // change landing mid-wave truncates it and a truncated wave still fired.
    producerOriginStats.observeWave(cf.entryId);

    const slot = shockwaveSlotRef.current;
    shockwaveSlotRef.current = (slot + 1) % SHOCKWAVE_SLOTS;
    // The shockwave shader measures distance in WORLD xz (modelMatrix ×
    // position), while `origin.pos` is a colony-frame topology coordinate —
    // carry it through the counter-rotation as it stands at stamp time. The
    // pin drifts ≤ ~0.02 rad over the wave's life at the default rate, the
    // same tolerance the delivery plan already accepts for the tissue rim.
    writeShockwaveSlot(
      shockwaveUniforms.uShockwaveAt.value,
      shockwaveUniforms.uShockwaveOriginXZ.value,
      shockwaveUniforms.uShockwaveColor.value,
      slot,
      simClock.elapsedSec,
      rotYLocalToWorldXZ(origin.pos[0], origin.pos[2], colonyFrame.rotationY),
      consensusBlockColor(blockPulseAtMs),
    );
    // cf/topology/backfillActive are recomputed in the same render that advances
    // blockPulseAtMs; use the pulse as the sole event edge.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blockPulseAtMs]);

  // These values are shared by every peer material. Refreshing them here lets a
  // panel drag reshape waves already in flight instead of only the next block.
  useSimFrame(() => {
    shockwaveUniforms.uShockwaveColorBoost.value = LIVE.peer.colorBoost;
    shockwaveUniforms.uShockwaveAlphaBoost.value = LIVE.peer.alphaBoost;
    shockwaveUniforms.uShockwaveColorCeil.value = LIVE.peer.colorCeil;
    shockwaveUniforms.uShockwaveAlphaCeil.value = LIVE.peer.alphaCeil;
    shockwaveUniforms.uShockwaveSizeBoost.value = LIVE.peer.sizeBoost;
    shockwaveUniforms.uShockwaveTrailBoost.value = LIVE.peer.trailBoost;
  });

  // NB: no local "you" node is rendered here — the visible local node is the
  // galaxy's labeled CkbNodeAnchor (App pins the colony's local node onto it via
  // inferredTopology's localPos). The measured belts converge on that same point.
  // That is why `byKind.anchor` is a bucket nothing below reads: the table owes
  // every kind an answer, and for `local` the answer is somebody else's mark.

  return (
    <group>
      <InferredCloud
        staged={byKind.haze}
        contextEnergyRef={contextEnergyRef}
        shockwaveUniforms={shockwaveUniforms}
      />
      {/* Faintest first, and a stop with nobody standing at it is not drawn at
          all: an all-reachable roster costs one cloud, not three, two of them
          empty. */}
      {SIGHTED_STOP_ORDER.map((stop) => (byStop[stop].length > 0 ? (
        <StagedCloud
          key={stop}
          nodes={byStop[stop]}
          tone={SIGHTED_STOPS[stop]}
          contextEnergyRef={contextEnergyRef}
          shockwaveUniforms={shockwaveUniforms}
        />
      ) : null))}
      {/* The chain's rung, on the same construction at its own stop. It is
          WAVE-RECEPTIVE like every other node here — a producer receives a
          block exactly as anything else at that distance does, which is the
          half of the 2026-08-24 ruling that was always true. */}
      {attested.length > 0 ? (
        <StagedCloud
          nodes={attested}
          tone={PEER_CLOUD_ATTESTED_TONE}
          contextEnergyRef={contextEnergyRef}
          shockwaveUniforms={shockwaveUniforms}
        />
      ) : null}
      {/* The second axis. No producers ⇒ no draw, not an empty one. */}
      {ringInstances.length > 0 ? (
        <ProducerRings
          instances={ringInstances}
          cf={cf}
          blockPulseAtMs={blockPulseAtMs}
          backfillActive={backfillActive}
          contextEnergyRef={contextEnergyRef}
        />
      ) : null}
      {/* No crawler and no producers: the whole staged tier costs the scene
          nothing at all — not an empty draw, not an idle hit mesh. */}
      {pickTargets.length > 0 ? (
        <PickableStagedNodes
          targets={pickTargets}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      ) : null}
      <MeasuredPeerHalos
        measured={measured}
        localVersion={localVersion}
        selectedId={selectedId}
        contextEnergyRef={contextEnergyRef}
        shockwaveUniforms={shockwaveUniforms}
      />
      {measured.map((n) => (
        <MeasuredNode
          key={n.id}
          node={n}
          selected={selectedId === `peer:${n.peer!.node_id}`}
          onSelect={onSelect}
        />
      ))}
    </group>
  );
}
