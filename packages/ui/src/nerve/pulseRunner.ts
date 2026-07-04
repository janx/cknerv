// Pulse cascade scheduling. For each `link` delta (one new tx),
// figure out which alive cells should "fire" as sources, find paths
// through the spatial neighbour graph to the new tx's outputs, and
// emit `Pulse` records that the renderer walks hop-by-hop.

import type { Cell, CellLink } from '@cknerv/types';
import { fnv1a } from '../geometry/edgeBezier';
import type { NeighborGraph } from '../geometry/neighborGraph';
import { shortestPath, DEFAULT_MAX_HOPS } from '../geometry/pathRouter';
import type { PulseStatsSink } from './pulseStats';

/** Base time the spike spends traversing one hop (cell-to-cell) in
 *  ms. Each individual pulse picks its own hop time around this base
 *  via a deterministic [0.7, 1.4] scale, so a cascade's pulses don't
 *  all march in lockstep. */
export const HOP_MS_BASE = 73;
/** Maximum extra delay (ms) injected before a pulse fires. Each
 *  pulse picks a random offset in [0, this) so siblings of one
 *  cascade don't all start simultaneously. */
export const PULSE_START_JITTER_MS = 300;

/** Maximum pulses we will queue per CellLink. A tx with 4 inputs and
 *  4 outputs would otherwise emit (#alive parent siblings) × 4 × 4
 *  paths; capping keeps the visual noise manageable for batch txs. */
export const MAX_PULSES_PER_LINK = 6;

/** Per-parent cap on how many surviving sibling cells we treat as
 *  pulse sources. Multiple tributaries converging on the new tx is
 *  the goal but we don't need to fire from every alive sibling. */
export const MAX_SOURCES_PER_PARENT = 2;

/** Color palette echoes the legacy nervePulseScheduler so existing
 *  users / tag-tinted UI stays visually consistent. Keyed on the four
 *  known runtime tag values; unknown tags fall back to
 *  `PULSE_GENERIC_COLOR`. */
export const PULSE_COLOR_BY_TAG: Record<string, [number, number, number]> = {
  ckbloom: [0.94, 0.67, 0.99],
  dex:     [0.99, 0.83, 0.30],
  cf:      [0.99, 0.64, 0.69],
  wallet:  [0.43, 0.91, 0.72],
};
export const PULSE_GENERIC_COLOR: [number, number, number] = [1.0, 0.85, 0.62];

export interface Pulse {
  /** Cells in path order (length ≥ 2). path[0] = source (an alive
   *  sibling of a consumed input), path[last] = a new output cell. */
  path: number[];
  /** Wall-clock-ish ms when the pulse fired (caller's clock). */
  bornAtMs: number;
  /** Pulse colour (kind-tinted). */
  color: [number, number, number];
  /** Per-pulse start delay (ms) — random offset in [0, JITTER) so a
   *  cascade's many pulses don't all depart at the same instant. */
  startDelayMs: number;
  /** Per-pulse hop duration (ms). Picked from a deterministic
   *  [0.7×, 1.4×] scale around HOP_MS_BASE so each pulse travels
   *  at its own pace. */
  hopMs: number;
}

export interface PulsePlanningOptions {
  maxHops?: number;
  maxPulsesPerLink?: number;
  maxSourcesPerParent?: number;
}

/** Derive pulse start delay + hop duration from a deterministic seed
 *  (so replays produce the same animation). The hashed string mixes
 *  tx_hash + source/target ids so siblings differ. */
function pulseTiming(
  link: CellLink,
  src: number,
  dst: number,
): { startDelayMs: number; hopMs: number } {
  const seed = fnv1a(`${link.tx_hash}\x00${src}\x00${dst}`);
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
 * For each parent tx hash referenced by the link, find UP TO
 * MAX_SOURCES_PER_PARENT alive cells whose `out_point.tx_hash` matches,
 * and route a path from each of those source cells to each of the
 * link's `to_ids`. Pulses with no graph path (or path > maxHops) are
 * silently dropped — they wouldn't read visually anyway.
 *
 * Total emitted pulses are capped at `MAX_PULSES_PER_LINK`.
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
  const maxSourcesPerParent =
    typeof optionsOrMaxHops === 'number'
      ? MAX_SOURCES_PER_PARENT
      : optionsOrMaxHops.maxSourcesPerParent ?? MAX_SOURCES_PER_PARENT;
  if (link.to_ids.length === 0) {
    stats?.bump('no-outputs');
    return [];
  }

  const color: [number, number, number] =
    (link.tag !== null && PULSE_COLOR_BY_TAG[link.tag]) ||
    PULSE_GENERIC_COLOR;

  // Collect candidate source cells: alive cells whose birth tx_hash
  // is one of the link's parent_tx_hashes.
  const sources: number[] = [];
  if (link.parents.length > 0) {
    const parentSet = new Set(link.parents);
    let perParent = new Map<string, number>();
    for (const [id, cell] of cells) {
      if (link.to_ids.includes(id)) continue; // don't pulse from self-loops
      const tx = cell.out_point.tx_hash;
      if (!parentSet.has(tx)) continue;
      const used = perParent.get(tx) ?? 0;
      if (used >= maxSourcesPerParent) continue;
      sources.push(id);
      perParent.set(tx, used + 1);
    }
  }
  if (sources.length === 0) {
    stats?.bump(link.parents.length === 0 ? 'no-parents' : 'no-source');
    return [];
  }

  const pulses: Pulse[] = [];
  outer: for (const src of sources) {
    for (const dst of link.to_ids) {
      if (pulses.length >= maxPulsesPerLink) break outer;
      if (src === dst) continue;
      const missing =
        !graph.adjacency.has(src) || !graph.adjacency.has(dst);
      const path = shortestPath(graph, src, dst, maxHops);
      if (!path || path.length < 2) {
        stats?.bumpPath(missing ? 'endpoint-missing' : 'no-path');
        continue;
      }
      const { startDelayMs, hopMs } = pulseTiming(link, src, dst);
      pulses.push({ path, bornAtMs: nowMs, color, startDelayMs, hopMs });
    }
  }
  stats?.bump(pulses.length > 0 ? 'fired' : 'all-paths-failed');
  return pulses;
}
