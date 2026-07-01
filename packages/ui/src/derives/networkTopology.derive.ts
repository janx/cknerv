// packages/ui/src/derives/networkTopology.derive.ts
// Pure data shapers for the P2P "colony" network. No React, no three.js —
// unit-tested directly. Everything is a pure function of (peers, seed).

import { mulberry32, CHAIN_Y } from '../layout';
import {
  latencyToRadius01, peerAngle, PEER_INNER_RADIUS, PEER_OUTER_RADIUS,
} from './peers.derive';
import type { Vec3, NetworkNode, NetworkEdge, NetworkTopology, EdgeKind } from '../types';
import type { Peer } from '@cknerv/types';

/** Peer-independent inferred-node count (seeded ±). Tune live. */
export const COLONY_INFERRED_COUNT = 240;
export const COLONY_INFERRED_JITTER = 30;
/** XZ extent of the colony volume; the measured core sits well inside. */
export const COLONY_RADIUS = 92;
export const COLONY_ELLIPSE_X = 1.25;    // echo the cells-canopy footprint
export const COLONY_ELLIPSE_Z = 0.85;
export const COLONY_Y = CHAIN_Y;         // colony centered on the chain plane
export const COLONY_Y_THICKNESS = 14;    // shallow vertical spread
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
