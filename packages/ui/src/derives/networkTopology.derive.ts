// packages/ui/src/derives/networkTopology.derive.ts
// Pure data shapers for the P2P "colony" network. No React, no three.js —
// unit-tested directly. Everything is a pure function of
// (peers, seed, roster, producers).

import { mulberry32, CHAIN_Y } from '../layout';
import {
  latencyToRadius01, peerAngle, PEER_INNER_RADIUS, PEER_OUTER_RADIUS,
} from './peers.derive';
import type { Vec3, NetworkNode, NetworkEdge, NetworkTopology, EdgeKind } from '../types';
import type { ProducerStanding } from './blockProducers.derive';
import type { NetworkRosterRecord, RosterNodeState, Peer } from '@cknerv/types';
import { colonyStats } from './colonyStats';

/** Peer-independent inferred-node count (seeded ±). Tune live. */
export const COLONY_INFERRED_COUNT = 240;
export const COLONY_INFERRED_JITTER = 30;
/** XZ extent of the colony volume; the measured core sits well inside. */
export const COLONY_RADIUS = 92;
export const COLONY_ELLIPSE_X = 1.25;    // echo the cells-canopy footprint
export const COLONY_ELLIPSE_Z = 0.85;
export const COLONY_Y = CHAIN_Y;         // colony centered on the chain plane
/** How deep the slab of ghosts and sighted nodes is, either side of the plane.
 *
 *  ⭐ THE MESH HAS TO READ AS A SURFACE, because a POW cohort is a HOLE in it.
 *  The colony plane is the boundary between two universes — the cell canopy
 *  above, the other one below — and an opening is only legible in a membrane.
 *  Seen on the approved preview: at 14 the scatter reads as a VOLUME the marks
 *  float inside; at 6 it reads as a membrane the marks are cut into. So 6 is
 *  where that flipped by eye, a starting value to be judged live, not a
 *  measurement of anything.
 *
 *  Thinning it does not starve `scatterInferred`, which was the one risk: the
 *  min-spacing rejection now has less height to escape into. Measured over 40
 *  seeds, the accepted count at 6 is IDENTICAL to the count at 14 (210–268,
 *  which is exactly the jittered target every time), because this disc is
 *  nowhere near a 2-D jam at spacing 6 even with no height at all. */
export const COLONY_Y_THICKNESS = 6;
export const COLONY_MIN_SPACING = 6;     // min distance between inferred nodes
export const COLONY_KNN = 4;             // geometric base degree
export const COLONY_LONGRANGE_PROB = 0.35; // expected long-range links / node
export const LOCAL_ANCHOR_OFFSET = 30;   // local sits ~this far off-center
export const LOCAL_ID_FALLBACK = 'ckb:local';

export function dist2(a: Vec3, b: Vec3): number {
  const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
  return dx * dx + dy * dy + dz * dz;
}

/** Local node's seeded anchor — offset from center so it isn't a hub. */
export function localAnchor(seed: number): Vec3 {
  const rng = mulberry32(seed >>> 0);
  const a = rng() * Math.PI * 2;
  return [
    Math.cos(a) * LOCAL_ANCHOR_OFFSET * COLONY_ELLIPSE_X,
    COLONY_Y,
    Math.sin(a) * LOCAL_ANCHOR_OFFSET * COLONY_ELLIPSE_Z,
  ];
}

/** Measured peer position: latency→radius, id-hash→angle, around the anchor. */
export function measuredPeerPos(anchor: Vec3, p: Peer): Vec3 {
  const t = latencyToRadius01(p.latency_ms);
  const r = PEER_INNER_RADIUS + t * (PEER_OUTER_RADIUS - PEER_INNER_RADIUS);
  const a = peerAngle(p.node_id);
  return [
    anchor[0] + Math.cos(a) * r * COLONY_ELLIPSE_X,
    COLONY_Y,
    anchor[2] + Math.sin(a) * r * COLONY_ELLIPSE_Z,
  ];
}

/**
 * Peer-INDEPENDENT inferred node scatter — rejection sampling with a min-spacing
 * constraint over the elliptical colony disc. Pure function of `seed` ONLY: this
 * is what makes the ⭐ churn-stability invariant hold. Never reference peers here.
 */
export function scatterInferred(seed: number): Vec3[] {
  // decorrelate this stream from localAnchor's stream
  const rng = mulberry32((seed ^ 0x9e3779b1) >>> 0);
  const target = COLONY_INFERRED_COUNT + Math.floor((rng() - 0.5) * 2 * COLONY_INFERRED_JITTER);
  const out: Vec3[] = [];
  const min2 = COLONY_MIN_SPACING * COLONY_MIN_SPACING;
  const maxAttempts = target * 40;
  let attempts = 0;
  while (out.length < target && attempts < maxAttempts) {
    attempts += 1;
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * COLONY_RADIUS;   // sqrt → uniform over the disc
    const cand: Vec3 = [
      Math.cos(a) * r * COLONY_ELLIPSE_X,
      COLONY_Y + (rng() - 0.5) * COLONY_Y_THICKNESS,
      Math.sin(a) * r * COLONY_ELLIPSE_Z,
    ];
    let ok = true;
    for (let i = 0; i < out.length; i++) {
      if (dist2(out[i], cand) < min2) { ok = false; break; }
    }
    if (ok) out.push(cand);
  }
  return out;
}

/** Mixing constants for a sighted node's placement hashes.
 *
 *  `peerAngle` runs its own `h * 31 + charCode` stream and supplies the ANGLE.
 *  Reusing that stream for the radius would stand every sighted node on one
 *  spiral, so radius and height each mix the id under a different odd
 *  multiplier and finish with an avalanche — three uncorrelated draws from one
 *  id, which is the whole placement budget a node with no link to us earns. */
const SIGHTED_RADIUS_MIX = 0x27220a95;
const SIGHTED_Y_MIX = 0x165667b1;

/** Mixing constants for an ATTESTED node's placement hashes — its own pair,
 *  and the separateness is the point rather than the constants.
 *
 *  Same reasoning as the pair above, one rung along: decorrelated draws from
 *  one key, no two of them sharing a stream. What is new is why they are not
 *  simply `peerAngle` + the sighted mixes.
 *
 *  ⭐ THERE ARE TWO OF THEM, NOT THREE, and the missing one is the height. An
 *  attested node has no height draw at all — it stands exactly on the colony
 *  plane, for the reasons on `attestedPos` — so the third mix that used to
 *  supply one (`ATTESTED_Y_MIX`) is deleted rather than left unread. A dead
 *  constant is an invitation to put the stream back.
 *
 *  1. A TIER'S MIXES ARE ITS PLACEMENT'S IDENTITY. Shared, a future retune of
 *     the sighted scatter would silently drag every producer with it, and a
 *     producer's place has to be a fact about a lock hash and not about how the
 *     crawler's tier happens to be tuned today.
 *  2. THE INPUT IS A DIFFERENT SHAPE. The pair above was chosen against base58
 *     peer ids — `placementHash01`'s avalanche exists because short base58 ids
 *     leave the low bits nearly constant. A producer key is a fixed 66
 *     characters over a 16-symbol alphabet behind a constant `0x`, so two keys
 *     share long runs of identical characters far more often than two peer ids
 *     do. It earns its own constants and its own decorrelation test.
 *  3. `peerAngle` IS THE PEERS' HASH. An attested node has no peer id and is
 *     not on the peer belt; borrowing the measured tier's angle stream for a
 *     lock script hash is the same category error as borrowing a roster mark. */
const ATTESTED_ANGLE_MIX = 0xcc9e2d51;
const ATTESTED_RADIUS_MIX = 0x1b873593;

/** [0,1) from an id under `mix`. Pure, order-independent, and stable for the
 *  life of the id — an id-placed node must land on the same spot after a
 *  reconnect, a crawl round, a rolled producer window, or a roster that arrived
 *  in another order.
 *
 *  Shared by every tier the colony places from an id, which is why it is named
 *  for the job and not for one of them: each tier brings its OWN mixes (see the
 *  two blocks above) and this supplies only the avalanche they all need. */
export function placementHash01(nodeId: string, mix: number): number {
  let h = (0x811c9dc5 ^ mix) >>> 0;
  for (let i = 0; i < nodeId.length; i += 1) {
    h = Math.imul(h ^ nodeId.charCodeAt(i), mix);
  }
  // Short base58 ids leave the low bits nearly constant without this.
  h ^= h >>> 15;
  h = Math.imul(h, 0x2545f491);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/** Where the scene stands a sighted node: the same elliptical disc the ghost
 *  scatter fills, sampled purely from the id. It is placement, never geography
 *  and never latency — the crawler observed a node, not a location. */
export function sightedPos(nodeId: string): Vec3 {
  const a = peerAngle(nodeId);
  const r = Math.sqrt(placementHash01(nodeId, SIGHTED_RADIUS_MIX)) * COLONY_RADIUS;
  return [
    Math.cos(a) * r * COLONY_ELLIPSE_X,
    COLONY_Y + (placementHash01(nodeId, SIGHTED_Y_MIX) - 0.5) * COLONY_Y_THICKNESS,
    Math.sin(a) * r * COLONY_ELLIPSE_Z,
  ];
}

/** The namespace an attested node's graph id wears.
 *
 *  ⭐ THE PREFIX IS THE COLLISION GUARD, and it is doing a job no dedup could.
 *  `buildAdjacency`, the flood and the hit meshes all key on `NetworkNode.id`,
 *  so two nodes under one string would merge their edges and share one target.
 *  A lock script hash and a base58 peer id cannot collide today — but that is a
 *  fact about two alphabets, and the graph's correctness should not rest on
 *  one. Behind `attested:` the ids cannot meet whatever upstream does to either
 *  vocabulary, exactly as `inf:<n>` keeps the ghosts out of both.
 *
 *  ⚠️ It is a DATA namespace, not the card's word. §7.1's `MINER` is still an
 *  open user ruling; this is named for the rung, which is settled. */
export const ATTESTED_ID_PREFIX = 'attested:';

/** The graph id the colony files a producer under. Exported because the flood
 *  has to find that node from a producer key carried on a block pulse, and a
 *  lookup built by re-concatenating the prefix at the call site is a second
 *  copy of this rule. */
export function attestedNodeId(producerKey: string): string {
  return `${ATTESTED_ID_PREFIX}${producerKey}`;
}

/** Where the scene stands an attested node: the same elliptical disc the ghosts
 *  and the sighted tier occupy, sampled purely from the producer key. Stable
 *  for the life of the key — the window rolls, the share moves every block, and
 *  the node does not budge.
 *
 *  ⭐ NOT THE CENTROID OF ITS CANDIDATES, and the temptation was real: the
 *  producer would sit inside its own narrowed cluster with a short local
 *  tether. It fails twice. A centroid MOVES when the crawl round changes, so
 *  the one placement invariant every id-hashed node in this file holds — same
 *  spot after a reconnect, a re-crawl, a reordered roster — would be the one
 *  thing producers did not; and standing a producer among its candidates is
 *  itself a soft spatial accusation, drawn out of a join of two self-declared
 *  strings. Let the fan do the talking and keep placement mute.
 *
 *  Like `sightedPos` this is placement and never geography: the chain says
 *  something made these blocks, not where it is.
 *
 *  ⭐⭐ EXACTLY IN THE PLANE — the one colony tier that gets no height draw,
 *  and it is the mark's form that demands it rather than tidiness. A cohort is
 *  drawn as a DISC LYING IN the colony plane, and what makes that disc state
 *  the plane at all is that every cohort foreshortens IDENTICALLY: give each
 *  one a private height and the agreement is gone, and each mark is just an
 *  ellipse somewhere. Below the plane the same constant does a second job: the
 *  intake is ONE floor at a fixed depth under the membrane, and one floor
 *  cannot sit a fixed depth under six different heights.
 *
 *  So the height STREAM is gone, not flattened at the draw site — see
 *  `ATTESTED_Y_MIX`'s deletion above. Nothing about the placement invariant
 *  moves: Y is now a constant, which is at least as stable under a reconnect,
 *  a re-crawl or a rolled window as the hash it replaces. */
export function attestedPos(producerKey: string): Vec3 {
  const a = placementHash01(producerKey, ATTESTED_ANGLE_MIX) * Math.PI * 2;
  const r = Math.sqrt(placementHash01(producerKey, ATTESTED_RADIUS_MIX)) * COLONY_RADIUS;
  return [
    Math.cos(a) * r * COLONY_ELLIPSE_X,
    COLONY_Y,
    Math.sin(a) * r * COLONY_ELLIPSE_Z,
  ];
}

/** The rungs of the roster's gradient this colony has a mark for.
 *
 *  ⭐ EVERY RUNG THE RECORD REPORTS NOW HAS ONE. Two of them mean the crawler
 *  dialed the node and it answered — one this round, one an earlier one — and
 *  the third means nobody ever has. That third rung waited outside for a
 *  commit because borrowing a mark that says "somebody answered this" is the
 *  one thing the tier exists to prevent; it did not wait because it is less
 *  real. It has a real id, a real address, a real advertise window and a typed
 *  reason the dial failed, and the space it now fills was being filled by
 *  invented `inf:` ghosts on a seeded scatter. So this is a fiction being
 *  displaced by evidence, one node for one node, rather than a colony growing.
 *
 *  This is a SET rather than a list of exclusions on purpose: a rung added
 *  upstream is one the scene has no mark for by definition, so it must have to
 *  be named here before it can be drawn. Exported because that is only half
 *  the gate — the scene's own stop table is the other half, and the two are
 *  checked against each other rather than trusted to stay in step. */
export const STAGEABLE_ROSTER_STATES: ReadonlySet<RosterNodeState> = new Set<RosterNodeState>([
  'reachable', 'verified_unavailable', 'advertised_unverified',
]);

/**
 * The crawler's roster as stageable nodes, in the order it sent them.
 *
 * MEASURED WINS: an entry we hold a live link to is already on stage with its
 * real position and its real edge, so the sighted copy is dropped rather than
 * standing a second marker for one node. The local node is dropped for the
 * same reason. A repeated id inside one roster is dropped too — the cap and
 * the ordering are the server's contract, but a duplicate would double-book an
 * instance in the hit mesh, so tolerate it here.
 *
 * A row whose state this colony has no mark for is dropped as well; see
 * `STAGEABLE_ROSTER_STATES` for why that is a gate and not an oversight.
 *
 * `localId` is cknerv's own key for the endpoint (`ckb:local`), which is not a
 * vocabulary the crawler speaks: roster rows carry base58 p2p ids, the same
 * ones `Peer.node_id` uses. So `localP2pId` — the local node's
 * `p2p_node_id` — is what actually excludes us. Without it, a publicly
 * crawlable cknerv node stands a SIGHTED marker for ITSELF, with a card that
 * says we have never spoken to it.
 */
export function stageSighted(
  roster: NetworkRosterRecord | null | undefined,
  peers: Peer[],
  localId: string,
  localP2pId?: string | null,
): NetworkNode[] {
  if (!roster || roster.entries.length === 0) return [];
  const linked = new Set<string>([localId]);
  if (localP2pId) linked.add(localP2pId);
  for (const p of peers) linked.add(p.node_id);
  const out: NetworkNode[] = [];
  const staged = new Set<string>();
  for (const entry of roster.entries) {
    if (!STAGEABLE_ROSTER_STATES.has(entry.state)) continue;
    if (linked.has(entry.node_id) || staged.has(entry.node_id)) continue;
    staged.add(entry.node_id);
    out.push({
      id: entry.node_id, kind: 'sighted', pos: sightedPos(entry.node_id), sighted: entry,
    });
  }
  return out;
}

/**
 * The chain's recent producers as stageable nodes, in the order the producer
 * derive stood them up (blocks descending, key ascending — a total order that
 * does not renumber when a tail producer blinks out of the window).
 *
 * ONE NODE PER PRODUCER, ALWAYS ANONYMOUS. Nothing here reads the roster, the
 * peer list or the candidate fan, and that is the whole discipline: the node is
 * created from the chain's evidence alone, so however strong a producer's fan
 * is, it can never become a point on a named peer.
 *
 * ⭐ THERE IS DELIBERATELY NO MEASURED-WINS DEDUP HERE — the one right next
 * door in `stageSighted` — and the reason is not that a collision is unlikely.
 * That dedup drops a roster row we already hold a link to because both markers
 * would be the SAME NODE: one entity, two dots. A producer and a peer are never
 * KNOWN to be the same entity. The chain attests that something made these
 * blocks; the crawler attests that something answered a dial; nothing joins the
 * two, and the fingerprint join deliberately yields a set rather than a member.
 * Folding them would therefore make the accusation this tier exists to avoid,
 * and would make it by DELETING a producer the chain proved exists. So the
 * double-count is real, disclosed in copy rather than repaired in geometry, and
 * every producer stands. What a shared graph id WOULD break is the adjacency
 * map, and `ATTESTED_ID_PREFIX` fixes that without dropping anybody.
 *
 * Two gates remain, and both are second locks on a door upstream already
 * bolted. A keyless producer does not stage: `deriveBlockProducers` refuses a
 * whole window containing one, because blocks with nobody behind them are not a
 * producer we may not draw — they are an unanswered question, and subtracting
 * them would be inventing the answer. A repeated key stages once, for the same
 * reason `stageSighted` tolerates a duplicated roster row: the wire's contract
 * says it cannot happen, and a double-booked hit-mesh instance is not the way
 * to find out it did.
 *
 * ⚠️ THE ORDER IT IS HANDED IS THE ORDER IT STAGES, and that order goes on to be
 * node order, scaffold cache key and flood tie-break. So the array reaching here
 * has to be sequenced by something only the SET can move: `BlockProducerView`'s
 * `staging`, which is key-ascending — never `ranked`, which is ordered by a
 * number every block changes.
 */
export function stageAttested(
  producers?: readonly ProducerStanding[] | null,
): NetworkNode[] {
  if (!producers || producers.length === 0) return [];
  const out: NetworkNode[] = [];
  const staged = new Set<string>();
  for (const producer of producers) {
    if (producer.key.length === 0 || staged.has(producer.key)) continue;
    staged.add(producer.key);
    out.push({
      id: attestedNodeId(producer.key),
      kind: 'attested',
      pos: attestedPos(producer.key),
      // The standing by reference, never a copy: its blocks, share and fan move
      // every block, and a copy taken at staging time would be a stale share
      // printed beside a live window.
      attested: producer,
    });
  }
  return out;
}

/* -------------------------------------------------- the cohorts' keep-out */

/**
 * How far every OTHER node stands clear of an attested position, in world
 * units, measured in XZ.
 *
 * ⭐⭐⭐ A COHORT IS A HOLE IN THE MEMBRANE, AND NOBODY MAY STAND IN THE HOLE.
 * The mark is a mass lying in the plane, drawn as the image light makes around
 * it, and the one thing a viewer aims at is the shadow in the middle. A peer
 * standing inside it is a second target inside the first: two marks over one
 * pixel, and a click that has to pick. Measured live on 2026-09-02 (T6), the six
 * cohorts' nearest non-cohort neighbours stood at 1.274 / 2.355 / 4.602 / 5.337
 * / 7.794 / 8.247 wu, and the nearest of them was a SIGHTED — clickable — peer
 * 1.274 wu away: inside the drawn mark (the aperture's 1.6 wu hole at the time,
 * the shadow's 2.0 wu now) and inside the cohort's own pick sphere. Both marks resolved to their own cards, but at
 * that peer's projected centre the HOVER readout named the cohort while the
 * CLICK opened the peer, and one cohort's own centre opened its neighbour's card
 * from one of two camera azimuths. So the fix is placement, not pick radius:
 * the colony keeps the disc empty and the ambiguity has nowhere to occur.
 * ⚠️ THE PICK RADIUS HAS SINCE GROWN TO 2.0 wu (2026-09-03, the lensed form:
 * the target is the SHADOW), which spends half of the daylight this radius used
 * to leave — 1.0 wu of clearance to the brightest sighted peer's own sphere,
 * now 0.5. Still clear, and measured in `cohortKeepOut.test.ts` rather than
 * assumed; a further growth of either radius has to move this one too.
 *
 * ⭐ 3.5 = `COHORT_LINK_STOP_R` 3.0 + 0.5, AND BOTH HALVES ARE LOAD-BEARING.
 * 3.0 is where `ColonyEdges` ends every link incident on a cohort, which is
 * itself outside the disc's inner edge (the ISCO, 2.31 wu) so no link ends on
 * the bright ring the mark computes there. A node displaced to exactly 3.0
 * would therefore have its own link trimmed to nothing —
 * `colonyEdgePositions` guards `len > 0` so it writes no NaN, but the drawn
 * segment would be a point, and a peer beside a cohort would look unlinked.
 * 0.5 wu is the margin that keeps the stub a line.
 * ⭐ MEASURED LIVE THE SAME DAY, ON THE SAME SIX COHORTS. The nearest
 * non-cohort distances went 2.355 / 1.274 / 4.602 / 8.247 / 5.337 / 7.794 wu →
 * 3.598 / 3.527 / 4.602 / 8.247 / 5.337 / 7.794: two neighbours stepped aside
 * and four were already clear (one of them the 4.602 wu peer, which stands 3.764
 * wu away in XZ — 2.65 wu of that distance was height, which is why this radius
 * is measured in the plane and the 3-D number understates it). Minimum XZ
 * clearance over all 258 staged nodes: exactly 3.500. All twelve hole clicks
 * (six cohorts × two azimuths 90° apart, including the one that had failed)
 * opened their own card, all six nearest clickable neighbours opened theirs, and
 * no hover named a cohort at a peer's centre. The shortest cohort link left is
 * that displaced peer's own, 3.527 wu long with 1.763 wu drawn — no degenerate
 * segment anywhere.
 *
 * ⚠️ THE NUMBER IS RESTATED HERE RATHER THAN IMPORTED, and the layering is the
 * reason. This file is a pure data shaper — no React, no three.js — and
 * `materials/colonyLens.ts` constructs a `ShaderMaterial`; importing it would
 * drag three into every topology test to read one float. Placement belongs to
 * the topology and the mark's radii belong to the material, so the two are
 * pinned against each other from a third place instead:
 * `__tests__/materials/cohortKeepOut.test.ts` imports BOTH files and asserts
 * the whole chain — `HIT 2.0 < DISC_IN 2.31 < LINK_STOP 3.0 < KEEP_OUT 3.5` —
 * so no two of them can drift apart silently.
 *
 * ⚠️ IT DOES NOT APPLY TO THE LOCAL OR MEASURED NODES. A measured peer's
 * radius IS a measurement — `latencyToRadius01` of its round trip — so moving
 * one would print a latency nobody observed, and the local node is the anchor
 * the whole measured belt is scattered around. The keep-out only ever moves
 * nodes whose position is already an invented placement: the ghost scatter and
 * the id-hashed staged tiers (`sighted`, which is every roster rung including
 * `advertised_unverified`). A measured peer inside a cohort's disc is a real
 * overlap and stays one.
 */
export const COHORT_KEEP_OUT_R = 3.5;

/** How many times a node may be pushed before the closed form finishes the job.
 *
 *  One push is enough for one disc: the node lands exactly on that cohort's
 *  keep-out circle. Two cohorts closer than `2 * COHORT_KEEP_OUT_R` have
 *  overlapping discs, and clearing one can drop a node into the other, so the
 *  push repeats — always away from the disc the node is DEEPEST inside, which
 *  is the choice that cannot depend on the producer list's order.
 *
 *  ⚠️ THAT LOOP IS NOT PROVABLY MONOTONE, so it does not get to be the whole
 *  answer. Two discs a little over one radius apart can hand a node back and
 *  forth; the loop is bounded here and `cohortKeepOutSweep` finishes any node
 *  the bound leaves inside, in closed form and in one step. That is what makes
 *  "no staged node stands within `COHORT_KEEP_OUT_R` of a cohort" a
 *  postcondition of this file rather than an observation about today's data. */
export const COHORT_KEEP_OUT_STEPS = 8;

/** A node this far inside the circle counts as on it. The push lands the node
 *  ON the boundary, and `c + (d/|d|) * R` re-measured against `c` can come back
 *  a few ULP short of `R` — without this the loop would push the same node off
 *  the same circle eight times and the sweep would then run with `t = 0`. */
const KEEP_OUT_EPS = 1e-9;
const KEEP_OUT_INSIDE_R2 = (COHORT_KEEP_OUT_R - KEEP_OUT_EPS) ** 2;

/** The direction stream for a node standing on a cohort's exact centre — its
 *  own mix, for the same reason every other placement stream here has one. */
const KEEP_OUT_ANGLE_MIX = 0x7feb352d;

/** Order among centres that cannot be the array's own, for the one case where
 *  two discs are equally deep: their coordinates. `attestedPos` is a hash over
 *  a 66-character key, so an exact tie is not something the chain can produce —
 *  but "deepest disc" has to be a function of the SET of producers, and a tie
 *  broken by index would make it a function of their order. */
function centreBefore(a: Vec3, b: Vec3): boolean {
  return a[0] !== b[0] ? a[0] < b[0] : a[2] < b[2];
}

/** Index of the cohort a point stands deepest inside, or -1 when it is clear of
 *  all of them. Every disc has the same radius, so "deepest" is simply
 *  "nearest centre". XZ only: the keep-out is about the hole a viewer aims into
 *  and the hole lies in the plane. */
function deepestCohort(x: number, z: number, centres: readonly Vec3[]): number {
  let best = -1;
  let bestD2 = KEEP_OUT_INSIDE_R2;
  for (let i = 0; i < centres.length; i += 1) {
    const c = centres[i];
    const dx = x - c[0];
    const dz = z - c[2];
    const d2 = dx * dx + dz * dz;
    if (d2 < bestD2 || (best >= 0 && d2 === bestD2 && centreBefore(c, centres[best]))) {
      best = i;
      bestD2 = d2;
    }
  }
  return best;
}

/** How far along `(ux, uz)` a point has to travel to be past the far side of
 *  EVERY disc the ray meets — the closed form of "keep pushing until it is
 *  out". Beyond the largest exit parameter the ray is outside every circle by
 *  construction, so this terminates in one step for any number of overlaps.
 *  Exported for out-of-band testing: on real placement the bounded loop above
 *  clears every node long before this is reached. */
export function cohortKeepOutSweep(
  x: number, z: number, ux: number, uz: number, centres: readonly Vec3[],
): number {
  const r2 = COHORT_KEEP_OUT_R * COHORT_KEEP_OUT_R;
  let t = 0;
  for (const c of centres) {
    const fx = x - c[0];
    const fz = z - c[2];
    const b = fx * ux + fz * uz;
    const disc = b * b - (fx * fx + fz * fz - r2);
    if (disc <= 0) continue;
    const exit = -b + Math.sqrt(disc);
    if (exit > t) t = exit;
  }
  return t;
}

/** One node's position with the cohorts' discs taken out of it: unchanged (the
 *  same array, by reference) when it already stands clear, and otherwise pushed
 *  radially away from the cohort it is deepest inside, out to the keep-out
 *  circle, at its own height.
 *
 *  ⭐ Y IS CARRIED, NEVER RECOMPUTED. The slab is what makes the colony read as
 *  a membrane; a node that stepped aside AND changed height would be a second,
 *  invisible edit riding on a click fix.
 *
 *  ⭐ IT IS A PURE FUNCTION OF (position, id, the set of attested positions).
 *  Nothing about peers, latency, the crawl round or the producers' standings
 *  enters, so a node moves when and only when a cohort appears over it — which
 *  is the behaviour, not a side effect: the hole opens and the peer steps
 *  aside. */
export function cohortKeepOutPos(
  pos: Vec3, nodeId: string, centres: readonly Vec3[],
): Vec3 {
  if (centres.length === 0) return pos;
  let x = pos[0];
  let z = pos[2];
  let ux = 0;
  let uz = 0;
  let steps = 0;
  while (steps < COHORT_KEEP_OUT_STEPS) {
    const i = deepestCohort(x, z, centres);
    if (i < 0) break;
    const c = centres[i];
    let dx = x - c[0];
    let dz = z - c[2];
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d > 0) {
      dx /= d;
      dz /= d;
    } else {
      // Exactly on a centre: there is no "away" to push along, so the node's
      // own placement hash supplies one. Same id, same direction, forever.
      const a = placementHash01(nodeId, KEEP_OUT_ANGLE_MIX) * Math.PI * 2;
      dx = Math.cos(a);
      dz = Math.sin(a);
    }
    ux = dx;
    uz = dz;
    x = c[0] + dx * COHORT_KEEP_OUT_R;
    z = c[2] + dz * COHORT_KEEP_OUT_R;
    steps += 1;
  }
  if (steps === 0) return pos;
  if (deepestCohort(x, z, centres) >= 0) {
    const t = cohortKeepOutSweep(x, z, ux, uz, centres);
    x += ux * t;
    z += uz * t;
  }
  return [x, pos[1], z];
}

/** The keep-out over a whole staged tier. Nodes that already stand clear are
 *  handed back as the SAME objects, and a tier with nothing to move is handed
 *  back as the same array — so a colony whose producers cover nobody keeps
 *  precisely the geometry, and the object identities, it had.
 *
 *  ⭐ APPLIED WHERE THE CLOUD MEETS THE PEERS, NEVER INSIDE `scatterInferred`.
 *  The scatter stays a pure function of the seed alone and stays cached, which
 *  is what the ⭐ churn-stability invariant rests on: peers arriving and
 *  leaving still cannot move a ghost. What CAN move one is a producer appearing
 *  — the attested keys are part of the scaffold's cache key already, and the
 *  ghosts a cohort's disc covers step aside with the sighted peers. */
export function keepClearOfCohorts(
  staged: NetworkNode[], attested: readonly NetworkNode[],
): NetworkNode[] {
  if (attested.length === 0 || staged.length === 0) return staged;
  const centres = attested.map((n) => n.pos);
  let moved = false;
  const out = staged.map((node) => {
    const pos = cohortKeepOutPos(node.pos, node.id, centres);
    if (pos === node.pos) return node;
    moved = true;
    return { ...node, pos };
  });
  return moved ? out : staged;
}

export function buildAdjacency(
  nodes: NetworkNode[], edges: NetworkEdge[],
): Map<string, { to: string; weight: number }[]> {
  const adj = new Map<string, { to: string; weight: number }[]>();
  for (const n of nodes) adj.set(n.id, []);
  for (const e of edges) {
    adj.get(e.a)?.push({ to: e.b, weight: e.weight });
    adj.get(e.b)?.push({ to: e.a, weight: e.weight });
  }
  return adj;
}

/** The linkless half of the colony: the ghost scatter plus every staged node,
 *  and their internal edges. Immutable and shared across `inferredTopology`
 *  calls. `nodes` runs ghosts first, then sighted, then attested — the
 *  historical order with one tail appended, so `ghostCount` still splits the
 *  fiction from the evidence. */
interface InferredScaffold {
  nodes: readonly NetworkNode[];
  edges: readonly NetworkEdge[];
  ghostCount: number;
}

// Single-slot memo: the scaffold is a pure function of (`seed`, sighted ids,
// attested keys), the app uses one seed for its lifetime, and rebuilding it is
// the O(V² log V) part of the topology (scatter rejection sampling + per-node
// kNN sorts). Latency-driven rebuilds of the measured overlay reuse the cached
// scaffold untouched, and so does a fresh crawl round that named the same
// nodes.
//
// ⭐ THE PRODUCER TAIL IS KEYED ON ITS KEYS AND NOTHING ELSE, and that is what
// keeps this a cache at all. A producer's blocks, share and fan move on EVERY
// BLOCK while its key does not, so a key that read the standings would miss
// once a block and pay a full rebuild every ~10 seconds — the geometry
// re-derived because a numerator moved.
//
// ⭐⭐ AND ITS SEQUENCE IS PART OF THE KEY, WHICH IS WHY THE ARRAY MAY NOT BE
// SEQUENCED BY A TALLY. `stagedKey` is order-sensitive on purpose and cannot
// safely be anything else: the build below walks `nodes` BY INDEX, so a
// permuted tail draws a different `rng()` for each long-range link and comes
// out with different edges. An order-insensitive key would hand back a
// scaffold whose edges disagree with the order it was asked for — a cache that
// lies rather than one that misses. The defence sits one level up instead:
// `deriveBlockProducers` sequences the staging array by KEY, so its order is
// already a function of the id set, and an order-sensitive key misses only
// when the set really moved.
let scaffoldCacheSeed: number | null = null;
let scaffoldCacheSightedKey: string | null = null;
let scaffoldCacheAttestedKey: string | null = null;
let scaffoldCache: InferredScaffold | null = null;

/** Cache key for one staged tail. Positions, edges and the ghost count all
 *  follow from the ids alone, so ids alone decide whether the geometry can be
 *  reused (each tier's live payload rides along separately — see
 *  `inferredTopology`).
 *
 *  ⭐ THE TWO TAILS ARE KEYED SEPARATELY, never joined into one string. The id
 *  namespaces make an accidental merge unlikely on their own — `attested:` is a
 *  prefix no base58 peer id wears — but that would leave this memo's
 *  correctness resting on a string constant chosen three functions away, and a
 *  cache that starts lying when somebody shortens a prefix is not one worth
 *  keeping. Joined, `sighted=[X] attested=[Y]` and `sighted=[X,Y] attested=[]`
 *  can be ONE key: the same node count, so the same ghost count, but Y standing
 *  at `attestedPos` in one build and at `sightedPos` in the other. The tails are
 *  re-staged live and the EDGES are not, so the damage would not even surface as
 *  a node in the wrong place — it would surface as a cached edge pointing at an
 *  id that is no longer in the node list. Two fields, two comparisons, and no
 *  reliance on the alphabet.
 *
 *  ⚠️ IT IS A SEQUENCE, NOT A SET, and it must stay one — see the note above
 *  the cache slots. Sorting the ids here would let two genuinely different
 *  scaffolds share a key. The stability this memo wants is bought by handing it
 *  a sequence only the set can move, which is what `staging` is. */
function stagedKey(staged: readonly NetworkNode[]): string {
  return staged.map((n) => n.id).join('\u0000');
}

/** Build (or reuse) the linkless scaffold. The construction order — kNN edges,
 *  long-range links, connectivity bridges — and the rng stream are
 *  byte-identical to the pre-cache inline build, so every downstream layout
 *  and the ⭐ churn-stability invariant are preserved exactly.
 *
 *  Sighted AND attested nodes are laid into the SAME graph as the ghosts: a
 *  crawler tells us a node exists, never who it talks to, and the chain attests
 *  that something made a block, never who it talks to either. So their edges
 *  are the identical geometric fiction and every one of them stays
 *  `kind: 'inferred'` — the chain's certainty is about EXISTENCE, and inventing
 *  an edge kind for it would put that certainty on links nothing observed.
 *  With both tails empty this is the pre-roster build, node for node and edge
 *  for edge. */
function inferredScaffold(
  seed: number, sighted: readonly NetworkNode[], attested: readonly NetworkNode[],
): InferredScaffold {
  const sightedCacheKey = stagedKey(sighted);
  const attestedCacheKey = stagedKey(attested);
  if (
    scaffoldCache !== null && scaffoldCacheSeed === seed
    && scaffoldCacheSightedKey === sightedCacheKey
    && scaffoldCacheAttestedKey === attestedCacheKey
  ) {
    colonyStats.observeScaffold(true);
    return scaffoldCache;
  }
  // The expensive half, counted where it is paid: the review that asked how
  // often this fires could only answer "unmeasurable" (`colonyStats`).
  colonyStats.observeScaffold(false);
  const infPts = scatterInferred(seed);
  // ⭐ Prefix fill: staged nodes take the ghosts' places one for one, and the
  // ghosts that remain are the FIRST points of the untouched seed-pure scatter.
  // Nothing is re-rolled and nothing is re-parameterized, so a ghost never
  // moves when the roster grows — the cloud only gets shorter from the tail.
  //
  // Producers subtract from the same tail on the same terms: a fiction is
  // replaced by a certainty, the colony's population does not inflate, and
  // because the scatter itself is never touched, ⭐ churn-stability survives a
  // producer appearing, leaving, or being re-tallied.
  const ghostCount = Math.max(0, infPts.length - sighted.length - attested.length);
  //
  // ⭐ AND A GHOST THE DISC COVERS STEPS ASIDE — see `keepClearOfCohorts`. The
  // scatter itself is still untouched and still seed-pure; the keep-out is a
  // pure function applied where the cloud becomes staged nodes, so it is the
  // ATTESTED KEYS that move a ghost and never a peer.
  const nodes: NetworkNode[] = keepClearOfCohorts(
    infPts.slice(0, ghostCount).map((pos, n): NetworkNode => (
      { id: `inf:${n}`, kind: 'inferred', pos }
    )),
    attested,
  );
  for (const s of sighted) nodes.push(s);
  for (const a of attested) nodes.push(a);

  const edges: NetworkEdge[] = [];
  const seen = new Set<string>();
  const key = (i: number, j: number) => (i < j ? `${i}:${j}` : `${j}:${i}`);
  const add = (i: number, j: number, kind: EdgeKind) => {
    if (i === j) return;
    const k = key(i, j);
    if (seen.has(k)) return;
    seen.add(k);
    edges.push({ a: nodes[i].id, b: nodes[j].id, kind, weight: Math.sqrt(dist2(nodes[i].pos, nodes[j].pos)) });
  };

  // kNN base degree over the scaffold.
  const rng = mulberry32((seed ^ 0x85ebca77) >>> 0);
  const kNearestInf = (localI: number, k: number): number[] => {
    const ds: { j: number; d: number }[] = [];
    for (let j = 0; j < nodes.length; j++) if (j !== localI) ds.push({ j, d: dist2(nodes[localI].pos, nodes[j].pos) });
    ds.sort((a, b) => a.d - b.d);
    return ds.slice(0, k).map((o) => o.j);
  };
  for (let i = 0; i < nodes.length; i++) {
    for (const j of kNearestInf(i, COLONY_KNN)) add(i, j, 'inferred');
  }
  // Long-range small-world links.
  for (let i = 0; i < nodes.length; i++) {
    if (rng() < COLONY_LONGRANGE_PROB && nodes.length > 1) {
      add(i, Math.floor(rng() * nodes.length), 'inferred');
    }
  }
  // Connectivity: bridge any island to its nearest node in component 0.
  ensureConnectedFrom(nodes, 0, buildAdjacency(nodes, edges), add);

  scaffoldCacheSeed = seed;
  scaffoldCacheSightedKey = sightedCacheKey;
  scaffoldCacheAttestedKey = attestedCacheKey;
  scaffoldCache = { nodes, edges, ghostCount };
  return scaffoldCache;
}

/** `localP2pId` is the local node's base58 `p2p_node_id`, the name the crawler
 *  would file US under. It is only ever used to exclude ourselves from the
 *  sighted tier — `localId` is cknerv's server-local key and never matches a
 *  roster row. Optional so every existing caller keeps working; a node whose
 *  server reported no identity simply has no id to be excluded by.
 *
 *  `producers` is the chain's recent producer window, already joined by
 *  `deriveBlockProducers` and in its STAGING order — key-ascending, and a pure
 *  function of which miners exist. Handing it the `ranked` view instead would
 *  re-sequence this whole build whenever two miners swapped rank: a full
 *  O(V² log V) scaffold rebuild for a set that did not change. Optional for the
 *  same reason as the arguments above and with one more behind it: `null`,
 *  `undefined` and `[]` all produce a topology byte-identical to the
 *  pre-producer build — same nodes, same order, same edges, same rng stream —
 *  so a devnet that has not mined, a boot whose window is still empty and a
 *  caller that never learned about producers are one code path rather than
 *  three. */
export function inferredTopology(
  peers: Peer[], seed: number, localId: string = LOCAL_ID_FALLBACK, localPos?: Vec3,
  roster?: NetworkRosterRecord | null, localP2pId?: string | null,
  producers?: readonly ProducerStanding[] | null,
): NetworkTopology {
  colonyStats.observeTopologyBuild();
  // 1) local anchor. When a `localPos` is supplied (App pins it onto the galaxy's
  //    labeled CkbNodeAnchor so there's a single "you"), it IS the local node's
  //    position AND the anchor the measured peers scatter around. Otherwise fall
  //    back to the seed-only localAnchor(seed) — preserving every existing caller.
  //    NB: this only moves the local + measured core; the ghost scatter behind
  //    the cloud stays seed-ONLY (and cached), so the ⭐ churn-stability
  //    invariant holds regardless of peers OR localPos.
  const anchor = localPos ?? localAnchor(seed);
  const nodes: NetworkNode[] = [{ id: localId, kind: 'local', pos: anchor }];
  const localIdx = 0;

  // 2) measured core overlaid (peer-dependent)
  const measuredIdx: number[] = [];
  for (const p of peers) {
    measuredIdx.push(nodes.length);
    nodes.push({ id: p.node_id, kind: 'measured', pos: measuredPeerPos(anchor, p), peer: p });
  }

  // 3) the linkless cloud (cached): shared immutable node/edge objects appended
  //    after the measured core, preserving the historical node order (local,
  //    measured…, ghosts…, sighted…, attested…) and edge order (cloud internals
  //    first, then measured spokes, then relay stitches). Sighted nodes are
  //    staged from the roster the crawler sent, minus anyone we already hold a
  //    link to; attested nodes are staged from the chain's producer window and
  //    subtracted from nobody. The producer tail is LAST so that with no
  //    producers every index in this array is exactly where it has always been.
  const infStart = nodes.length;
  const attested = stageAttested(producers);
  // The cohorts are staged FIRST because every other invented placement has to
  // stand clear of them: a cohort is a hole in the membrane and the hole has to
  // be empty (`COHORT_KEEP_OUT_R`). The measured belt above is deliberately not
  // put through it — a peer's radius is its latency, not a placement.
  const sighted = keepClearOfCohorts(
    stageSighted(roster, peers, localId, localP2pId), attested,
  );
  const scaffold = inferredScaffold(seed, sighted, attested);
  for (let i = 0; i < scaffold.ghostCount; i += 1) nodes.push(scaffold.nodes[i]);
  // The cache holds GEOMETRY, not the reports behind it: both tails are
  // re-staged every build, so a node going unreachable, a fresher last_seen, or
  // a producer's share moving with the newest block crosses without an
  // O(V² log V) rebuild. Ids are what the cache is keyed on, so neither tail
  // can ever disagree with the cached edges about who is standing where.
  for (const n of sighted) nodes.push(n);
  for (const n of attested) nodes.push(n);
  const edges: NetworkEdge[] = scaffold.edges.slice();

  // 4) measured edges local↔peer (observed) + stitch core into the cloud.
  //    These pairs (local/measured ↔ anything) cannot collide with the
  //    scaffold's internal set, and each is constructed at most once below,
  //    so no cross-set dedup is needed. The relay stitch may land on a sighted
  //    node — it is the same declared fiction either way.
  const addEdge = (i: number, j: number, kind: EdgeKind) => {
    if (i === j) return;
    edges.push({ a: nodes[i].id, b: nodes[j].id, kind, weight: Math.sqrt(dist2(nodes[i].pos, nodes[j].pos)) });
  };
  for (const mi of measuredIdx) addEdge(localIdx, mi, 'measured');
  const nearestCloudNode = (i: number): number => {
    let best = -1, bestD = Infinity;
    for (let j = infStart; j < nodes.length; j++) {
      const d = dist2(nodes[i].pos, nodes[j].pos);
      if (d < bestD) { bestD = d; best = j; }
    }
    return best;
  };
  for (const i of [localIdx, ...measuredIdx]) {
    const j = nearestCloudNode(i);
    if (j >= 0) addEdge(i, j, 'inferred'); // relay edge into the colony (not "observed")
  }

  return { provenance: 'inferred', localId, nodes, edges, adjacency: buildAdjacency(nodes, edges) };
}

/** Union islands (restricted to nodes at index ≥ `start`) into one component by
 *  bridging each extra island's representative to the nearest node in component 0.
 *  Exported for out-of-band testing: the real inferred scaffold is always already
 *  connected, so this multi-island bridge branch never fires in production. */
export function ensureConnectedFrom(
  nodes: NetworkNode[], start: number,
  adj: Map<string, { to: string; weight: number }[]>,
  add: (i: number, j: number, kind: EdgeKind) => void,
): void {
  const idxById = new Map(nodes.map((n, i) => [n.id, i]));
  const comp = new Map<string, number>();
  let c = 0;
  for (let i = start; i < nodes.length; i++) {
    const id = nodes[i].id;
    if (comp.has(id)) continue;
    const stack = [id];
    while (stack.length) {
      const u = stack.pop()!;
      if (comp.has(u)) continue;
      comp.set(u, c);
      for (const { to } of adj.get(u) ?? []) if ((idxById.get(to) ?? -1) >= start && !comp.has(to)) stack.push(to);
    }
    c += 1;
  }
  if (c <= 1) return;
  // connect representative of each component>0 to nearest node in component 0
  const comp0 = nodes.filter((n) => comp.get(n.id) === 0);
  for (let k = 1; k < c; k++) {
    const rep = nodes.find((n) => comp.get(n.id) === k)!;
    let best = comp0[0], bestD = Infinity;
    for (const q of comp0) { const d = dist2(rep.pos, q.pos); if (d < bestD) { bestD = d; best = q; } }
    add(idxById.get(rep.id)!, idxById.get(best.id)!, 'inferred');
  }
}
