// Pulse cascade scheduling. For each `link` delta (one new tx), the packets
// depart from the cells the tx CONSUMED — each dying cell's own address — and
// arrive at the newborn outputs. An origin is carried BY VALUE (a world
// position, not an id): the consumed cell may hold no adjacency any more and
// may have left every client map, so an id would be a promise the stage
// cannot keep. `path` therefore stays live staged cells only, and the
// renderer walks it hop-by-hop over fibres the viewer can actually see.

import type { Cell, CellLink, CellLinkEndpointAnchor } from '@cknerv/types';
import { fnv1a } from '../geometry/edgeBezier';
import type { NeighborGraph } from '../geometry/neighborGraph';
import {
  buildOriginEntryIndex,
  type OriginEntryIndex,
} from '../geometry/originEntry';
import {
  shortestPathsToTargets,
  DEFAULT_MAX_HOPS,
  type RouteScratch,
} from '../geometry/pathRouter';
import { consensusPacketColor } from '../derives/consensusFlow.derive';
import type { PulseStatsSink, RescueKind } from './pulseStats';

/** Base time the spike spends traversing one hop (cell-to-cell) in
 *  ms. Each individual pulse picks its own hop time around this base
 *  via a deterministic [0.7, 1.4] scale, so a cascade's pulses don't
 *  all march in lockstep.
 *
 *  What the eye reads is the spike's speed across the disc, and that is
 *  this number divided by the length of one fabric edge — so it is a
 *  constant tuned against the fabric's scale, not an independent one.
 *  Correcting the k-NN search shortened the median edge 5.47 -> 1.89
 *  world units and lengthened the median route 11 -> 23 hops, which at
 *  73 ms/hop dropped the median pulse from 55.1 to 24.6 world units per
 *  second: the same journey, crawling. 33 ms restores 55.0. */
export const HOP_MS_BASE = 33;
/** The fabric scale `HOP_MS_BASE` is pinned to, in world units, published so
 *  a leg that rides no fabric edge — the ghost hop from a dead cell's address
 *  to its entry node — can still be timed in the fabric's own stride instead
 *  of a second, independently-drifting speed. */
export const MEDIAN_FABRIC_EDGE_LEN = 1.89;
/** Maximum extra delay (ms) injected before a pulse fires. Each
 *  pulse picks a random offset in [0, this) so siblings of one
 *  cascade don't all start simultaneously. */
export const PULSE_START_JITTER_MS = 300;

/** Maximum pulses we will queue per CellLink. A tx with 4 inputs and
 *  4 outputs would otherwise emit (#origins) × 4 paths; capping keeps
 *  the visual noise manageable for batch txs. */
export const MAX_PULSES_PER_LINK = 6;

/** Per-link cap on how many consumed inputs originate a pulse. Several
 *  tributaries converging on the new tx is the goal, but a 30-input
 *  consolidation must not fire 30 cascades. 2 holds the pulse density the
 *  retired sibling proxy produced at the same value. */
export const MAX_ORIGINS_PER_LINK = 2;

/** The cell a packet left, carried BY VALUE. A position cannot be
 *  extinguished by gc or lose a stage race the way an id can, and the
 *  consumed cell is by definition the one that is leaving. */
export interface PulseOrigin {
  /** World address of the consumed cell (`helix_seed_for(id)`). */
  pos: [number, number, number];
  /** Identity of the consumed cell: animation seed and stats key, never a
   *  path node. */
  anchorId: number;
  /** False when the server derived the anchor from the outpoint alone —
   *  the address is exact, the content unknown. */
  resolved: boolean;
}

export interface Pulse {
  /** Local evidence identity of the CellLink that produced this pulse. */
  linkSeq: number;
  /** Canonical block height of that link, used for immediate reorg pruning. */
  linkBlock: number;
  /** Live staged cells in path order. path[0] = the node the packet enters
   *  the fabric at, path[last] = a new output cell. Length ≥ 2, or ≥ 1 when
   *  `origin` is present: `origin.pos → path[0]` is itself a renderable hop,
   *  so an entry node that IS the destination still carries a packet. */
  path: number[];
  /** Wall-clock-ish ms when the pulse fired (caller's clock). */
  bornAtMs: number;
  /** Hash-stable A packet colour, preserved from departure to write seal. */
  color: [number, number, number];
  /** Per-pulse start delay (ms) — random offset in [0, JITTER) so a
   *  cascade's many pulses don't all depart at the same instant. */
  startDelayMs: number;
  /** Per-pulse hop duration (ms). Picked from a deterministic
   *  [0.7×, 1.4×] scale around HOP_MS_BASE so each pulse travels
   *  at its own pace. */
  hopMs: number;
  /** The dying cell this packet departed. Absent only where the link names
   *  no consumed input at all (cellbase, records persisted before inputs
   *  were anchored) — those enter from the tissue rim on the rescue path. */
  origin?: PulseOrigin;
  /** Set on block-guarantee rescue pulses (≤1 per block): the origin
   *  honesty this pulse fell back to. Absent on normal cascade pulses.
   *  Overflow eviction sheds rescue pulses last. */
  rescue?: RescueKind;
}

export interface PulsePlanningOptions {
  maxHops?: number;
  maxPulsesPerLink?: number;
  maxOriginsPerLink?: number;
  /** Shared per-batch entry index, passed as a THUNK so the stage-wide grid
   *  is built on first use: most blocks carry only a cellbase link, which
   *  names no origin and must not pay for a grid nobody queries. Absent →
   *  planPulses memoizes one of its own for this call. */
  entryIndex?: () => OriginEntryIndex;
  /** Route-search scratch (typed-array BFS state + neighbour cache). Absent
   *  → the router's shared default, which every graph can use. */
  routeScratch?: RouteScratch;
}

/** Derive pulse start delay + hop duration from a deterministic seed
 *  (so replays produce the same animation). `originKey` is the pulse's
 *  ORIGIN IDENTITY — the consumed cell's anchor id on the main path, the
 *  routed source node where no anchor exists (rim rescue). Deliberately NOT
 *  the fabric entry node: entry follows stage churn, and the same spend must
 *  not re-time itself between two clients. Exported for the rescue pass,
 *  which stamps its one pulse per block the same way. */
export function pulseTiming(
  link: CellLink,
  originKey: number,
  dst: number,
): { startDelayMs: number; hopMs: number } {
  const seed = fnv1a(`${link.tx_hash}\x00${originKey}\x00${dst}`);
  const u1 = (seed & 0xffff) / 0x10000;          // [0, 1)
  const u2 = ((seed >>> 16) & 0xffff) / 0x10000; // [0, 1)
  return {
    startDelayMs: u1 * PULSE_START_JITTER_MS,
    hopMs: HOP_MS_BASE * (0.7 + u2 * 0.7),       // [0.7×, 1.4×]
  };
}

/**
 * Plan all pulses for one new CellLink. Pure: returns a fresh array.
 *
 * Origins are the link's INPUT anchors — an anchor is input-side iff its id
 * is NOT one of this tx's newborns. Sound across id families: outputs always
 * carry projection-sequential ids below 2^52 while derived and retired-
 * resident ids are at or above it, and a tx cannot spend its own output.
 * Anchors are taken in wire order (the server's death pass, deterministic)
 * up to `MAX_ORIGINS_PER_LINK`.
 *
 * Each origin enters the fabric at the live node the entry index picks for
 * its address, and one BFS from there routes to every `to_ids` at once.
 * Pulses with no graph path (or path > maxHops) are silently dropped — they
 * wouldn't read visually anyway. Total emitted pulses are capped at
 * `MAX_PULSES_PER_LINK`.
 */
export function planPulses(
  link: CellLink,
  cells: ReadonlyMap<number, Cell>,
  graph: NeighborGraph,
  optionsOrMaxHops: PulsePlanningOptions | number = DEFAULT_MAX_HOPS,
  nowMs: number = link.at_ms,
  stats?: PulseStatsSink,
): Pulse[] {
  const maxHops =
    typeof optionsOrMaxHops === 'number'
      ? optionsOrMaxHops
      : optionsOrMaxHops.maxHops ?? DEFAULT_MAX_HOPS;
  const maxPulsesPerLink =
    typeof optionsOrMaxHops === 'number'
      ? MAX_PULSES_PER_LINK
      : optionsOrMaxHops.maxPulsesPerLink ?? MAX_PULSES_PER_LINK;
  const maxOriginsPerLink =
    typeof optionsOrMaxHops === 'number'
      ? MAX_ORIGINS_PER_LINK
      : optionsOrMaxHops.maxOriginsPerLink ?? MAX_ORIGINS_PER_LINK;
  const sharedEntryIndex =
    typeof optionsOrMaxHops === 'number'
      ? undefined
      : optionsOrMaxHops.entryIndex;
  const routeScratch =
    typeof optionsOrMaxHops === 'number'
      ? undefined
      : optionsOrMaxHops.routeScratch;
  if (link.to_ids.length === 0) {
    stats?.bump('no-outputs');
    return [];
  }

  const origins: CellLinkEndpointAnchor[] = [];
  for (const anchor of link.endpoint_anchors) {
    if (origins.length >= maxOriginsPerLink) break;
    if (link.to_ids.includes(anchor.id)) continue; // output-side anchor
    origins.push(anchor);
  }
  if (origins.length === 0) {
    // Nothing consumed to depart from: a cellbase, or a record persisted
    // before inputs were anchored. The block guarantee decides separately
    // whether the block still lights.
    stats?.bump('no-origin');
    return [];
  }

  const color = consensusPacketColor(link.tx_hash, link.tag);
  let ownIndex: OriginEntryIndex | null = null;
  const entryIndex =
    sharedEntryIndex ?? (() => (ownIndex ??= buildOriginEntryIndex(cells, graph)));

  const pulses: Pulse[] = [];
  outer: for (const anchor of origins) {
    if (pulses.length >= maxPulsesPerLink) break;
    // `entryFor` leaves along the anchor's OWN surviving adjacency when it
    // still has one (a corpse the graph has not pruned yet), so the packet
    // departs down a real — retracting — edge; otherwise the grid answers.
    // It never returns the anchor itself: path[0] must be a live cell.
    const entry = entryIndex().entryFor(anchor.id, anchor.pos_seed);
    // One BFS per origin covers every output of this tx; per-target results
    // are byte-identical to routing each (entry, dst) pair separately.
    const pathsByDst =
      entry === null
        ? null
        : shortestPathsToTargets(
          graph,
          entry,
          link.to_ids,
          maxHops,
          routeScratch,
        );
    // One ghost per origin, shared by its destinations — nothing mutates it.
    const origin: PulseOrigin = {
      pos: [anchor.pos_seed[0], anchor.pos_seed[1], anchor.pos_seed[2]],
      anchorId: anchor.id,
      resolved: anchor.resolved,
    };
    for (const dst of link.to_ids) {
      if (pulses.length >= maxPulsesPerLink) break outer;
      // Cannot happen — T2's id families are disjoint — but a tx that spent
      // its own newborn would otherwise pulse a cell into itself.
      if (anchor.id === dst) continue;
      // A stage holding no eligible node at all fails the same way an
      // absent destination does: there is nothing to route between.
      const missing = entry === null || !graph.adjacency.has(dst);
      const path = pathsByDst?.get(dst) ?? null;
      // Length 1 = the entry node IS the destination; the ghost hop
      // origin → dst carries that packet on its own.
      if (!path || path.length < 1) {
        stats?.bumpPath(missing ? 'endpoint-missing' : 'no-path');
        continue;
      }
      const { startDelayMs, hopMs } = pulseTiming(link, anchor.id, dst);
      pulses.push({
        linkSeq: link.seq,
        linkBlock: link.block,
        path,
        bornAtMs: nowMs,
        color,
        startDelayMs,
        hopMs,
        origin,
      });
      stats?.bumpOrigin(origin.resolved ? 'origin-retained' : 'origin-derived');
    }
  }
  stats?.bump(pulses.length > 0 ? 'fired' : 'all-paths-failed');
  return pulses;
}
