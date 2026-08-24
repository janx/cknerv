// Pure data shapers for the peer colony + NETWORK HUD. No React,
// no three.js — unit-tested directly.

import type { ChainEntry, ChainNode, Peer, PeerDirection } from '@cknerv/types';
import type { Vec3 } from '../types';
import { CONTACT_WAVE_SCALE } from '../ui/topologyConstants';
import {
  PEER_NETWORK_PALETTE,
  type SceneColor,
} from '../visualPalette';

/** Latency at/above this (ms) maps to the outer rim. */
export const PEER_LATENCY_CAP_MS = 400;
/** Annulus radius bounds (pre-ellipse), matching the chain-node scatter band. */
export const PEER_INNER_RADIUS = 34;
export const PEER_OUTER_RADIUS = 56;
/** Lag (blocks) at which a peer's sync proximity bottoms out. */
export const PEER_SYNC_LAG_FLOOR = 2000;

/** Normalize latency to [0,1]. null/undefined → 0.5 (unknown = mid ring). */
export function latencyToRadius01(latencyMs: number | null | undefined): number {
  if (latencyMs == null || !Number.isFinite(latencyMs)) return 0.5;
  const c = Math.min(Math.max(latencyMs, 0), PEER_LATENCY_CAP_MS);
  return c / PEER_LATENCY_CAP_MS;
}

/** Deterministic angle [0, 2π) from a node id — stable per peer. */
export function peerAngle(nodeId: string): number {
  let h = 0;
  for (let i = 0; i < nodeId.length; i += 1) h = (h * 31 + nodeId.charCodeAt(i)) >>> 0;
  return ((h % 100000) / 100000) * Math.PI * 2;
}

/** Sync proximity [0,1]: 1 at/above tip, → 0 as the peer lags. Unknown → 0.5. */
export function syncProximity(bestKnown: number | null | undefined, tip: number): number {
  if (bestKnown == null || !Number.isFinite(bestKnown)) return 0.5;
  if (tip <= 0) return 1;
  const lag = Math.max(0, tip - bestKnown);
  return Math.max(0, 1 - lag / PEER_SYNC_LAG_FLOOR);
}

/** Crystal radius from sync proximity [0,1]: in-sync peers render larger.
 *  Range ≈ 0.55 (lagging) .. 1.65 (at tip) — well under the LOCAL node's 2.5. */
export function peerCrystalSize(sync: number): number {
  return 0.55 + sync * 1.1;
}

/** Pre-fade brightness multiplier from sync proximity [0,1]: in-sync peers
 *  glow brighter. Multiplied by the churn fade alpha at render time. */
export function peerCrystalBrightness(sync: number): number {
  return 0.45 + sync * 0.5;
}

/** Cubic ease-out: fast launch, decelerate to rest. The "thrown" courier velocity —
 *  the block is flung off the sender and coasts to a stop at the receiver. */
export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/** Accelerate-in carrier easing: some launch velocity (0.15) plus acceleration,
 *  so the signal is fastest at the Cell-field boundary, unlike easeOutCubic.
 *  f(0)=0, f(1)=1; slope grows from 0.15 to 1.85 (accelerating). */
export function easeInLob(t: number): number {
  return 0.15 * t + 0.85 * t * t;
}

export interface Delivery {
  /** Stable per-node key for the pooled protocol-carrier child. */
  key: string;
  /** Launch position in the COLONY's rotating frame (the coordinates the
   *  topology stores). The renderer carries it through the live colony
   *  rotation each frame (`rotYLocalToWorldXZ` at `colonyFrame.rotationY`),
   *  which is what keeps the gather glyph glued to its turning node. The
   *  production hero origin sits ON the rotation axis, so its colony and
   *  world positions coincide. */
  from: Vec3;
  /** Landing in WORLD space, pinned at plan time (plan-time colony rotation
   *  applied to the launch, then clamped to the plan-time tissue ellipse). */
  to: Vec3;
  /** Age (s since pulse) at which this node starts its delivery. */
  startAge: number;
  hero: boolean;
}

/** The Cell-tissue footprint a delivery must land on, as seen at plan time.
 *  `halfX`/`halfZ` are the galaxy-LOCAL ellipse half-extents (helix.ts owns
 *  them); `rotationY` is the galaxy group's live y-rotation, because the
 *  ellipse turns with the tissue while workers hold fixed world positions. */
export interface DeliveryLandingField {
  halfX: number;
  halfZ: number;
  rotationY: number;
}

/** Landings may not sit past this normalized ellipse radius. 1.0 is the
 *  nominal tissue rim: the released front is a small local ripple (the
 *  peer-plane wave divided by CONTACT_WAVE_SCALE), so a landing out past the
 *  rim would release its whole ring over empty space and the worker's commit
 *  would never be seen touching tissue. Workers ring the galaxy WIDER than the tissue on x
 *  (chain ellipse 1.25 vs tissue 60), so far-rim landings are common, not a
 *  degenerate case. */
export const DELIVERY_LANDING_MAX_NORM = 1.0;

/** three.js `group.rotation.y = θ` carries a LOCAL xz into WORLD as
 *  (x·cosθ + z·sinθ, −x·sinθ + z·cosθ) — the map
 *  consensusRouteHopWorldPosition already uses for the live-verified route
 *  camera. This pair is that map and its exact inverse, single-sourced so a
 *  rotating-frame projection can never again re-derive the convention with
 *  the sign flipped (the world→local family did exactly that, and every
 *  consumer drifted from the true frame by 2θ as the group turned). */
export function rotYLocalToWorldXZ(
  x: number,
  z: number,
  rotationY: number,
): [number, number] {
  const c = Math.cos(rotationY);
  const s = Math.sin(rotationY);
  return [x * c + z * s, -x * s + z * c];
}

/** Exact inverse of `rotYLocalToWorldXZ` — projects a WORLD xz into the
 *  local frame of a group whose `rotation.y` stands at `rotationY`. */
export function rotYWorldToLocalXZ(
  x: number,
  z: number,
  rotationY: number,
): [number, number] {
  const c = Math.cos(rotationY);
  const s = Math.sin(rotationY);
  return [x * c - z * s, x * s + z * c];
}

/** Pull a world-xz landing radially (in the tissue's local frame) back onto
 *  the footprint. Radial, not nearest-point: an over-rim worker throws its
 *  block INWARD toward the galaxy, which is also what keeps the lob's travel
 *  axis honest about where the commit went. Inside the rim, positions pass
 *  through untouched. */
function clampLandingToField(
  x: number,
  z: number,
  field: DeliveryLandingField,
): [number, number] {
  const [lx, lz] = rotYWorldToLocalXZ(x, z, field.rotationY);
  const norm = Math.hypot(lx / field.halfX, lz / field.halfZ);
  if (norm <= DELIVERY_LANDING_MAX_NORM) return [x, z];
  const k = DELIVERY_LANDING_MAX_NORM / norm;
  return rotYLocalToWorldXZ(lx * k, lz * k, field.rotationY);
}

/** Build one delivery per delivering node: the local/hero node(s) (offered from
 *  `localOrigins` at `localStartAge`) plus every rendered peer that has an
 *  arrival. Each rises from its node to `cellsY`, landing at its own xz when
 *  that is on the tissue and at the nearest radially-inward rim point when it
 *  is not (see `clampLandingToField`). `colonyRotationY` is the colony
 *  group's rotation as of plan time: launches are stored colony-frame (see
 *  `Delivery.from`), but the LANDING is a world point, so the launch is
 *  carried into world before the ellipse judges it — the same plan-time pin
 *  the field's own `rotationY` already applies on the galaxy side. Pure. */
export function planDeliveries(
  localOrigins: Vec3[],
  localStartAge: number,
  posById: Map<string, Vec3>,
  arrivals: Record<string, number>,
  cellsY: number,
  field: DeliveryLandingField,
  colonyRotationY = 0,
): Delivery[] {
  const out: Delivery[] = [];
  const land = (from: Vec3): [number, number] => {
    const [wx, wz] = rotYLocalToWorldXZ(from[0], from[2], colonyRotationY);
    return clampLandingToField(wx, wz, field);
  };
  localOrigins.forEach((from, i) => {
    const [x, z] = land(from);
    out.push({
      key: `local:${i}`,
      from,
      to: [x, cellsY, z],
      startAge: localStartAge,
      hero: true,
    });
  });
  for (const [id, from] of posById) {
    const a = arrivals[id];
    if (a === undefined) continue;
    const [x, z] = land(from);
    out.push({
      key: `peer:${id}`,
      from,
      to: [x, cellsY, z],
      startAge: a,
      hero: false,
    });
  }
  return out;
}

export interface DeliveryPhaseConfig {
  /** Pre-roll contributor gather before launch (rides the legacy beam window). */
  chargeDur: number;
  /** Carrier transit (node → Cell field) duration. */
  lobDur: number;
  /** Field-commit duration. */
  ingestDur: number;
}
export type DeliveryPhaseName = 'idle' | 'gather' | 'lob' | 'ingest' | 'done';
export interface DeliveryPhaseState {
  phase: DeliveryPhaseName;
  /** 0→1 within gather / lob / ingest; 0 for idle; 1 for done. */
  t: number;
}

/** Pure per-node delivery phase from `localAge` (= ageSincePulse − startAge):
 *  gather over [−chargeDur, 0), lob over [0, lobDur), ingest over
 *  [lobDur, lobDur+ingestDur), done after. `idle` before the gather window
 *  keeps a far-future delivery hidden. */
export function deliveryPhase(localAge: number, cfg: DeliveryPhaseConfig): DeliveryPhaseState {
  const { chargeDur, lobDur, ingestDur } = cfg;
  if (localAge < -chargeDur) return { phase: 'idle', t: 0 };
  if (localAge < 0) {
    return { phase: 'gather', t: chargeDur > 1e-9 ? (localAge + chargeDur) / chargeDur : 1 };
  }
  if (localAge < lobDur) {
    return { phase: 'lob', t: lobDur > 1e-9 ? localAge / lobDur : 1 };
  }
  if (localAge < lobDur + ingestDur) {
    return { phase: 'ingest', t: ingestDur > 1e-9 ? (localAge - lobDur) / ingestDur : 1 };
  }
  return { phase: 'done', t: 1 };
}

/**
 * Age (s since pulse) at which EVERY delivery has reached `done`. deliveryPhase
 * windows are contiguous and end at `startAge + lobDur + ingestDur`, and ages
 * only advance, so past this horizon the pulse can never render another carrier
 * and the layer may retire it. 0 for an empty plan → retire immediately. Pure.
 */
export function deliveryScheduleHorizon(
  deliveries: Delivery[],
  cfg: DeliveryPhaseConfig,
): number {
  if (deliveries.length === 0) return 0;
  let maxStart = -Infinity;
  for (const d of deliveries) maxStart = Math.max(maxStart, d.startAge);
  return maxStart + cfg.lobDur + cfg.ingestDur;
}

export interface ContactRelease {
  /** Seed-glyph scale: 1 at contact → 0 once the ring has been released. */
  glyphScale: number;
  /** Seed-glyph opacity, on the same short window as `glyphScale`. */
  glyphOpacity: number;
  /** Compact core at the landing: searing onset, resolved before the end. */
  coreOpacity: number;
  /** Contracting pre-release ring: 1 at its widest → 0 at the landing. */
  inhaleRadius: number;
  /** Strength of that ring; nonzero only inside the pre-release window. */
  inhaleOpacity: number;
  /** Expanding front intensity across the whole window. */
  frontOpacity: number;
  /** 0 = white-hot contact, 1 = resolved into the Cell field's own tissue. */
  colorT: number;
}

/** Fraction of the contact phase the seed glyph takes to release. */
const RELEASE_WINDOW = 0.35;
/** Fraction the pre-release ring contracts over — short, so the drawn breath
 *  lands just before the front leaves rather than reading as its own event. */
const INHALE_WINDOW = 0.14;
/** Fraction the front takes to reach full strength. Non-zero so the front
 *  grows out of the contact core instead of appearing beside it. */
const FRONT_ONSET = 0.05;

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** Clamped smoothstep over [0,1]. ONE easing shapes both ends of a front —
 *  its strength onset (contactRelease) and its reach extinction
 *  (contactFrontState) — so the two halves of the same edge can never drift
 *  apart in separate private copies. */
export function smoothUnit(value: number): number {
  const u = clampUnit(value);
  return u * u * (3 - 2 * u);
}

/** Per-frame Cell-contact envelope for one delivered block (t∈[0,1]).
 *
 *  The whole handoff is one idea — compression then release — and this is its
 *  second half: the carrier's seed ring collapses, a small ring is drawn INWARD
 *  to the landing, a compact core sears, and the front leaves. Front RADIUS is
 *  deliberately absent: the renderer drives it from a shared wave speed in real
 *  seconds so every worker's front belongs to one wave field, and this envelope
 *  supplies only strengths.
 *
 *  THE INVARIANT: every opacity and the glyph scale reach EXACTLY 0 at t=1, so
 *  the phase→done hard-hide has nothing left to blink off. Pure. */
export function contactRelease(t: number): ContactRelease {
  const u = clampUnit(t);
  const released = clampUnit(1 - u / RELEASE_WINDOW);
  const drawn = clampUnit(u / INHALE_WINDOW);
  return {
    glyphScale: Math.pow(released, 0.7),
    glyphOpacity: Math.pow(released, 1.2),
    coreOpacity: Math.exp(-9 * u) * (1 - u),
    inhaleRadius: 1 - easeInLob(drawn),
    inhaleOpacity: Math.sin(Math.PI * drawn) * (1 - u),
    // Linear life on purpose: the renderer's 1/r falloff already dims a front
    // as it spreads, and curving the time decay on top of it killed the front
    // long before it had crossed anything.
    frontOpacity: (1 - u) * smoothUnit(u / FRONT_ONSET),
    colorT: easeOutCubic(u),
  };
}

// ————— The released front's spatial algebra —————
//
// Everything below is the geometry of one expanding contact ring, extracted
// from the renderer's frame callback so it can be numerically tested: jsdom
// cannot run an R3F frame loop, and source-string assertions cannot catch a
// front that silently extinguishes early or never completes.

/** Front radius at the instant of release. Also anchors the 1/r falloff away
 *  from its singularity. Both are on the front's divided scale. */
export const CONTACT_FRONT_START_RADIUS = 2.4 / CONTACT_WAVE_SCALE;
export const CONTACT_FRONT_FALLOFF_REFERENCE = 24 / CONTACT_WAVE_SCALE;
/** Crest widening RATE — fraction of the width per second of travel — so a
 *  front never reads as a rigid decal. Deliberately NOT divided by
 *  CONTACT_WAVE_SCALE: it multiplies a width that is already scale-divided,
 *  so the widening rescales with the ring by construction. (Dividing it too
 *  flattened the crest toward a fixed width over its whole life instead of the
 *  tuned ×1.54 — proportionally stiffer than the peer-plane wave it mirrors,
 *  by exactly the scale.) */
export const CONTACT_FRONT_WIDTH_GROW_RATE = 0.45;
/** Fraction of a front's reach where its extinction begins. */
export const CONTACT_FRONT_REACH_KNEE = 0.72;
/** Ceiling on the crest half-width as a fraction of the crest radius. Without
 *  it a young front — radius still a world unit or two — is mostly crest, and
 *  the release reads as a soft doughnut instead of a thin ring leaving. */
export const CONTACT_FRONT_WIDTH_RADIUS_CAP = 0.22;

/** The live knobs the front algebra runs on (renderer refreshes per frame). */
export interface ContactFrontLive {
  /** Shared field speed (world units/s) every front expands at. */
  speed: number;
  /** Crest half-width basis at the moment of release (world units). */
  width: number;
  /** Exponent of the 1/r falloff. */
  falloffPower: number;
  /** Ingest window (s). A front only renders inside it, so reach is clamped
   *  to what the window can complete — see contactFrontReachCeiling. */
  windowS: number;
}

export interface ContactFrontState {
  crestRadius: number;
  crestHalfWidth: number;
  /** 1 until the reach knee, easing to exactly 0 at the (clamped) reach. */
  reachFade: number;
  /** 1/r-family dimming of the expanding ring. */
  falloff: number;
}

/** The largest reach a front can fully extinguish inside the ingest window.
 *  A reach configured past this would die by the time envelope mid-flight,
 *  knee unplayed — a structurally different ending from every other front —
 *  so contactFrontState clamps to it. Pure. */
export function contactFrontReachCeiling(speed: number, windowS: number): number {
  return CONTACT_FRONT_START_RADIUS + speed * windowS;
}

/** A crest may never be a large fraction of its own radius. */
export function contactCrestHalfWidth(width: number, crestRadius: number): number {
  return Math.min(width, crestRadius * CONTACT_FRONT_WIDTH_RADIUS_CAP);
}

/** Pure spatial state of one released front, `contactAgeS` seconds after
 *  release. Radius comes from real seconds at the shared wave speed — never
 *  from a normalized scale — so every worker's front belongs to the same
 *  expanding field. Reach is extinction, not a stop: a clamped RADIUS would
 *  freeze the front mid-field and break the one-speed reading, so the fade
 *  goes to zero while the radius keeps its speed. Strengths (time envelope,
 *  opacity knobs, hero punch) stay with the renderer. Pure. */
export function contactFrontState(
  contactAgeS: number,
  reach: number,
  live: ContactFrontLive,
): ContactFrontState {
  const crestRadius = CONTACT_FRONT_START_RADIUS + live.speed * contactAgeS;
  const cappedReach = Math.min(
    reach,
    contactFrontReachCeiling(live.speed, live.windowS),
  );
  const reachFade = 1 - smoothUnit(
    (crestRadius - cappedReach * CONTACT_FRONT_REACH_KNEE)
      / (cappedReach * (1 - CONTACT_FRONT_REACH_KNEE)),
  );
  return {
    crestRadius,
    crestHalfWidth: contactCrestHalfWidth(
      live.width * (1 + CONTACT_FRONT_WIDTH_GROW_RATE * contactAgeS),
      crestRadius,
    ),
    reachFade,
    falloff: Math.pow(
      CONTACT_FRONT_FALLOFF_REFERENCE
        / (CONTACT_FRONT_FALLOFF_REFERENCE + crestRadius),
      live.falloffPower,
    ),
  };
}

interface NearestCellCandidate {
  id: number;
  d2: number;
  order: number;
}

interface IndexedNearestCell {
  id: number;
  pos_seed: readonly [number, number, number];
}

export interface CellNearestIndex {
  readonly bucketSize: number;
  readonly cells: readonly IndexedNearestCell[];
  readonly next: readonly number[];
  readonly rows: ReadonlyMap<number, ReadonlyMap<number, number>>;
  readonly count: number;
  readonly minBx: number;
  readonly maxBx: number;
  readonly minBz: number;
  readonly maxBz: number;
  /** Tombstoned ids (incrementally maintained shared index). Walkers skip
   * them; the shared maintainer rebuilds once they outgrow a small share of
   * the entries. A plain build has none. */
  readonly dead: ReadonlySet<number>;
}

const CELL_NEAREST_BUCKET_SIZE = 6;

/** Build once per Cell-set revision, then serve every peer/local delivery from
 * the same exact xz index. Input order is retained for deterministic ties. */
export function buildCellNearestIndex(
  cells: Iterable<{
    id: number;
    pos_seed: readonly [number, number, number];
  }>,
  bucketSize = CELL_NEAREST_BUCKET_SIZE,
): CellNearestIndex {
  const safeBucketSize = Number.isFinite(bucketSize) && bucketSize > 0
    ? bucketSize
    : CELL_NEAREST_BUCKET_SIZE;
  const rows = new Map<number, Map<number, number>>();
  const indexedCells: IndexedNearestCell[] = [];
  const next: number[] = [];
  let minBx = Infinity;
  let maxBx = -Infinity;
  let minBz = Infinity;
  let maxBz = -Infinity;
  for (const cell of cells) {
    const x = cell.pos_seed[0];
    const z = cell.pos_seed[2];
    const bx = Math.floor(x / safeBucketSize);
    const bz = Math.floor(z / safeBucketSize);
    let row = rows.get(bx);
    if (!row) {
      row = new Map();
      rows.set(bx, row);
    }
    const order = indexedCells.length;
    indexedCells.push(cell);
    next.push(row.get(bz) ?? -1);
    row.set(bz, order);
    minBx = Math.min(minBx, bx);
    maxBx = Math.max(maxBx, bx);
    minBz = Math.min(minBz, bz);
    maxBz = Math.max(maxBz, bz);
  }
  return {
    bucketSize: safeBucketSize,
    cells: indexedCells,
    next,
    rows,
    count: indexedCells.length,
    minBx,
    maxBx,
    minBz,
    maxBz,
    dead: new Set<number>(),
  };
}

/** Max-heap ordering: farther candidates are worse; input order breaks exact
 * distance ties so the result preserves the stable ordering of the previous
 * full-sort implementation. */
function nearestCandidateWorse(
  left: NearestCellCandidate,
  right: NearestCellCandidate,
): boolean {
  return left.d2 > right.d2
    || (left.d2 === right.d2 && left.order > right.order);
}

function siftNearestCandidateDown(
  heap: NearestCellCandidate[],
  start: number,
): void {
  let index = start;
  while (true) {
    const left = index * 2 + 1;
    if (left >= heap.length) return;
    const right = left + 1;
    const worseChild = right < heap.length
      && nearestCandidateWorse(heap[right], heap[left])
      ? right
      : left;
    if (!nearestCandidateWorse(heap[worseChild], heap[index])) return;
    [heap[index], heap[worseChild]] = [heap[worseChild], heap[index]];
    index = worseChild;
  }
}

function considerNearestCandidate(
  nearest: NearestCellCandidate[],
  limit: number,
  candidate: IndexedNearestCell,
  order: number,
  lx: number,
  lz: number,
): void {
  const dx = candidate.pos_seed[0] - lx;
  const dz = candidate.pos_seed[2] - lz;
  const d2 = dx * dx + dz * dz;
  if (nearest.length < limit) {
    nearest.push({ id: candidate.id, d2, order });
    let index = nearest.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (!nearestCandidateWorse(nearest[index], nearest[parent])) break;
      [nearest[index], nearest[parent]] = [nearest[parent], nearest[index]];
      index = parent;
    }
    return;
  }
  const worst = nearest[0];
  if (d2 < worst.d2 || (d2 === worst.d2 && order < worst.order)) {
    worst.id = candidate.id;
    worst.d2 = d2;
    worst.order = order;
    siftNearestCandidateDown(nearest, 0);
  }
}

function visitNearestBucket(
  index: CellNearestIndex,
  bx: number,
  bz: number,
  nearest: NearestCellCandidate[],
  limit: number,
  lx: number,
  lz: number,
): void {
  let candidateIndex = index.rows.get(bx)?.get(bz) ?? -1;
  while (candidateIndex >= 0) {
    const candidate = index.cells[candidateIndex];
    if (!index.dead.has(candidate.id)) {
      considerNearestCandidate(
        nearest,
        limit,
        candidate,
        candidateIndex,
        lx,
        lz,
      );
    }
    candidateIndex = index.next[candidateIndex];
  }
}

/** Exact nearest-k query over expanding spatial-hash rings. Once the current
 * worst candidate is nearer than every point outside the scanned rectangle,
 * later buckets cannot affect the result. */
export function nearestCellIdsFromIndex(
  landing: [number, number],
  rotationY: number,
  index: CellNearestIndex,
  k: number,
): number[] {
  const limit = Number.isFinite(k)
    ? Math.min(index.count, Math.max(0, Math.floor(k)))
    : k === Number.POSITIVE_INFINITY
      ? index.count
      : 0;
  if (limit === 0 || index.count === 0) return [];

  const [lx, lz] = rotYWorldToLocalXZ(landing[0], landing[1], rotationY);
  const originBx = Math.floor(lx / index.bucketSize);
  const originBz = Math.floor(lz / index.bucketSize);
  const maxRadius = Math.max(
    Math.abs(originBx - index.minBx),
    Math.abs(originBx - index.maxBx),
    Math.abs(originBz - index.minBz),
    Math.abs(originBz - index.maxBz),
  );
  const nearest: NearestCellCandidate[] = [];

  for (let radius = 0; radius <= maxRadius; radius += 1) {
    if (radius === 0) {
      visitNearestBucket(
        index, originBx, originBz, nearest, limit, lx, lz,
      );
    } else {
      const minBx = originBx - radius;
      const maxBx = originBx + radius;
      const minBz = originBz - radius;
      const maxBz = originBz + radius;
      for (let bx = minBx; bx <= maxBx; bx += 1) {
        visitNearestBucket(index, bx, minBz, nearest, limit, lx, lz);
        visitNearestBucket(index, bx, maxBz, nearest, limit, lx, lz);
      }
      for (let bz = minBz + 1; bz < maxBz; bz += 1) {
        visitNearestBucket(index, minBx, bz, nearest, limit, lx, lz);
        visitNearestBucket(index, maxBx, bz, nearest, limit, lx, lz);
      }
    }

    if (nearest.length < limit) continue;
    const left = (originBx - radius) * index.bucketSize;
    const right = (originBx + radius + 1) * index.bucketSize;
    const bottom = (originBz - radius) * index.bucketSize;
    const top = (originBz + radius + 1) * index.bucketSize;
    const outsideDistance = Math.min(
      lx - left,
      right - lx,
      lz - bottom,
      top - lz,
    );
    // Strict comparison preserves input-order tie semantics for points exactly
    // on the next ring's boundary.
    if (outsideDistance * outsideDistance > nearest[0].d2) break;
  }

  nearest.sort((a, b) => a.d2 - b.d2 || a.order - b.order);
  return nearest.map((entry) => entry.id);
}

export interface CellWithinRadius {
  id: number;
  /** Exact xz distance from the query centre (already square-rooted). */
  dist: number;
}

/**
 * Every indexed Cell within `radius` of a LOCAL-frame xz centre, in Cell-map
 * input order — the same set, order, and distances the old full-map walk
 * produced, but visiting only the O(radius²/bucket²) covered buckets. Bucket
 * chains iterate newest→oldest, so entries are re-sorted by input order to
 * keep first-N-in-scan-order cap semantics byte-identical. Pure.
 */
export function cellIdsWithinRadiusFromIndex(
  localX: number,
  localZ: number,
  radius: number,
  index: CellNearestIndex,
): CellWithinRadius[] {
  if (!Number.isFinite(radius) || radius <= 0 || index.count === 0) return [];
  const radiusSq = radius * radius;
  const minBx = Math.max(index.minBx, Math.floor((localX - radius) / index.bucketSize));
  const maxBx = Math.min(index.maxBx, Math.floor((localX + radius) / index.bucketSize));
  const minBz = Math.max(index.minBz, Math.floor((localZ - radius) / index.bucketSize));
  const maxBz = Math.min(index.maxBz, Math.floor((localZ + radius) / index.bucketSize));
  const hits: Array<{ id: number; d2: number; order: number }> = [];
  for (let bx = minBx; bx <= maxBx; bx += 1) {
    const row = index.rows.get(bx);
    if (!row) continue;
    for (let bz = minBz; bz <= maxBz; bz += 1) {
      let candidateIndex = row.get(bz) ?? -1;
      while (candidateIndex >= 0) {
        const candidate = index.cells[candidateIndex];
        if (index.dead.has(candidate.id)) {
          candidateIndex = index.next[candidateIndex];
          continue;
        }
        const dx = candidate.pos_seed[0] - localX;
        const dz = candidate.pos_seed[2] - localZ;
        const d2 = dx * dx + dz * dz;
        if (d2 <= radiusSq) {
          hits.push({ id: candidate.id, d2, order: candidateIndex });
        }
        candidateIndex = index.next[candidateIndex];
      }
    }
  }
  hits.sort((a, b) => a.order - b.order);
  return hits.map((hit) => ({ id: hit.id, dist: Math.sqrt(hit.d2) }));
}

let sharedNearestIndexToken: unknown = Symbol('unset');
let sharedNearestIndexValue: CellNearestIndex | null = null;
/** Journal chain: cellsToken the shared index was last synced to. */
let sharedNearestIndexIds: Set<number> | null = null;
/** Rebuild once tombstones outgrow this share of appended entries. */
const SHARED_NEAREST_TOMBSTONE_SHARE = 0.12;

interface MutableNearestIndex {
  bucketSize: number;
  cells: IndexedNearestCell[];
  next: number[];
  rows: Map<number, Map<number, number>>;
  count: number;
  minBx: number;
  maxBx: number;
  minBz: number;
  maxBz: number;
  dead: Set<number>;
}

function appendToNearestIndex(
  index: MutableNearestIndex,
  cell: { id: number; pos_seed: readonly [number, number, number] },
): void {
  const bx = Math.floor(cell.pos_seed[0] / index.bucketSize);
  const bz = Math.floor(cell.pos_seed[2] / index.bucketSize);
  let row = index.rows.get(bx);
  if (!row) {
    row = new Map();
    index.rows.set(bx, row);
  }
  const order = index.cells.length;
  index.cells.push(cell);
  index.next.push(row.get(bz) ?? -1);
  row.set(bz, order);
  index.count = index.cells.length;
  index.minBx = Math.min(index.minBx, bx);
  index.maxBx = Math.max(index.maxBx, bx);
  index.minBz = Math.min(index.minBz, bz);
  index.maxBz = Math.max(index.maxBz, bz);
}

/** Minimal journal shape the shared index chains on (matches the cache's
 * `CellChangeSet` fields it needs). */
export interface NearestIndexJournal {
  readonly reset: boolean;
  readonly baseToken: object | null;
  readonly born: readonly number[];
  readonly removed: readonly number[];
}

/**
 * One nearest index shared across consumers (delivery ignition + galaxy
 * local ignition today), keyed on `cellsToken` and maintained INCREMENTALLY
 * from the reducer journal: births append (O(1) bucket insert), removals
 * tombstone (walkers skip; a reborn id un-tombstones — `pos_seed` is a pure
 * function of the id, so the retained entry is exact), and any journal gap,
 * reset, or tombstone overgrowth falls back to one full rebuild. Survivor
 * entry order equals retained-map order, preserving the input-order
 * first-N cap semantics the walkers sort back to.
 */
export function sharedCellNearestIndex(
  cellsToken: unknown,
  cells:
    | ReadonlyMap<number, { id: number; pos_seed: readonly [number, number, number] }>
    | Iterable<{ id: number; pos_seed: readonly [number, number, number] }>,
  journal?: NearestIndexJournal,
): CellNearestIndex {
  if (sharedNearestIndexValue !== null && sharedNearestIndexToken === cellsToken) {
    return sharedNearestIndexValue;
  }
  const mutable = sharedNearestIndexValue as MutableNearestIndex | null;
  const ids = sharedNearestIndexIds;
  const chained = mutable !== null
    && ids !== null
    && journal !== undefined
    && !journal.reset
    && journal.baseToken !== null
    && journal.baseToken === sharedNearestIndexToken
    && mutable.dead.size + journal.removed.length
      <= mutable.cells.length * SHARED_NEAREST_TOMBSTONE_SHARE;
  if (chained) {
    for (const id of journal.removed) {
      if (ids.has(id)) mutable.dead.add(id);
    }
    // Born positions resolve through the iterable's Map form when available;
    // otherwise fall back to a rebuild (production passes the retained Map).
    const lookup = cells instanceof Map
      ? cells as ReadonlyMap<number, { id: number; pos_seed: readonly [number, number, number] }>
      : null;
    if (lookup !== null || journal.born.length === 0) {
      for (const id of journal.born) {
        const cell = lookup!.get(id);
        if (!cell) continue;
        if (ids.has(id)) {
          mutable.dead.delete(id);
          continue;
        }
        appendToNearestIndex(mutable, cell);
        ids.add(id);
      }
      sharedNearestIndexToken = cellsToken;
      return sharedNearestIndexValue!;
    }
  }
  const iterable = cells instanceof Map
    ? (cells as ReadonlyMap<number, { id: number; pos_seed: readonly [number, number, number] }>).values()
    : cells as Iterable<{ id: number; pos_seed: readonly [number, number, number] }>;
  sharedNearestIndexValue = buildCellNearestIndex(iterable);
  sharedNearestIndexToken = cellsToken;
  sharedNearestIndexIds = new Set(
    sharedNearestIndexValue.cells.map((cell) => cell.id),
  );
  return sharedNearestIndexValue;
}

/** The `k` Cell ids nearest (in the xz plane) to a carrier `landing`,
 *  nearest first. Cells live in the galaxy group's rotating LOCAL frame
 *  (`pos_seed`), so the world landing is projected back through the group's
 *  `rotationY` before comparing. Used to illuminate the Cells a carrier reaches so
 *  the galaxy visibly RECEIVES each delivery (sparse-rim-safe: "nearest k"
 *  always finds cells, unlike a fixed radius). Pure. O(n log min(k,n)) time
 *  and O(min(k,n)) memory — called per block, not per frame. */
export function nearestCellIds(
  landing: [number, number],
  rotationY: number,
  cells: Iterable<{ id: number; pos_seed: [number, number, number] }>,
  k: number,
): number[] {
  return nearestCellIdsFromIndex(
    landing,
    rotationY,
    buildCellNearestIndex(cells),
    k,
  );
}

export type PeerColorKind = PeerDirection | 'version';

/** Color class: version-mismatch wins, else direction. */
export function peerColorKind(peer: Peer, localVersion: string): PeerColorKind {
  if (localVersion && peer.version && peer.version !== localVersion) return 'version';
  return peer.direction;
}

/** RGB triples (0..1) for each color class. */
export const PEER_COLORS: Readonly<Record<PeerColorKind, SceneColor>> = {
  outbound: PEER_NETWORK_PALETTE.outbound,
  inbound: PEER_NETWORK_PALETTE.inbound,
  version: PEER_NETWORK_PALETTE.version,
};

export interface PeerChurn {
  joined: Peer[];
  dropped: Peer[];
  stable: Peer[];
}

/** Diff two peer lists keyed by node_id. */
export function peerChurnDiff(prev: Peer[], next: Peer[]): PeerChurn {
  const prevIds = new Set(prev.map((p) => p.node_id));
  const nextIds = new Set(next.map((p) => p.node_id));
  return {
    joined: next.filter((p) => !prevIds.has(p.node_id)),
    dropped: prev.filter((p) => !nextIds.has(p.node_id)),
    stable: next.filter((p) => prevIds.has(p.node_id)),
  };
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export interface NetworkSummary {
  peerCount: number;
  outbound: number;
  inbound: number;
  version: string;
  connections: number;
  medianPingMs: number | null;
  syncLabel: string;
  bestKnown: number;
}

/** Summarize the network for the NETWORK HUD. */
export function summarizeNetwork(
  peers: Peer[],
  chain: ChainEntry,
  local: ChainNode | undefined,
): NetworkSummary {
  const outbound = peers.filter((p) => p.direction === 'outbound').length;
  const pings = peers
    .map((p) => p.latency_ms)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  const best = chain.best_known_block;
  let syncLabel: string;
  if (chain.ibd) syncLabel = 'IBD';
  else if (best > chain.tip) syncLabel = `SYNCING ${best - chain.tip} behind`;
  else syncLabel = 'AT TIP';
  return {
    peerCount: peers.length,
    outbound,
    inbound: peers.length - outbound,
    version: local?.version ?? '',
    connections: local?.connections ?? peers.length,
    medianPingMs: pings.length ? median(pings) : null,
    syncLabel,
    bestKnown: best,
  };
}
