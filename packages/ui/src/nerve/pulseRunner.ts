// Pulse cascade scheduling. For each `link` delta (one new tx),
// figure out which alive cells should "fire" as sources, find paths
// through the spatial neighbour graph to the new tx's outputs, and
// emit `Pulse` records that the renderer walks hop-by-hop.

import type { Cell, CellLink } from '@cknerv/types';
import { fnv1a } from '../geometry/edgeBezier';
import type { NeighborGraph } from '../geometry/neighborGraph';
import { shortestPathsToTargets, DEFAULT_MAX_HOPS } from '../geometry/pathRouter';
import { consensusPacketColor } from '../derives/consensusFlow.derive';
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

export interface Pulse {
  /** Local evidence identity of the CellLink that produced this pulse. */
  linkSeq: number;
  /** Canonical block height of that link, used for immediate reorg pruning. */
  linkBlock: number;
  /** Cells in path order (length ≥ 2). path[0] = source (an alive
   *  sibling of a consumed input), path[last] = a new output cell. */
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
}

export interface PulsePlanningOptions {
  maxHops?: number;
  maxPulsesPerLink?: number;
  maxSourcesPerParent?: number;
  /** Shared per-batch source index (see `collectLinkSourceIndex`). When
   *  present, planPulses selects sources from it instead of walking the whole
   *  Cell map — same result, one O(cells) scan per batch instead of per link. */
  sourceIndex?: LinkSourceIndex;
}

export interface LinkSourceIndex {
  /** parent tx hash → candidate source Cell ids, in Cell-map scan order.
   *  Buckets are UNCAPPED: per-parent caps and self-loop exclusion stay
   *  per-link, because a later link may exclude an earlier candidate as one
   *  of its own outputs. */
  byTx: Map<string, number[]>;
  /** Cell id → relative scan position, restoring the cross-parent
   *  interleaving the original full-map walk produced. */
  scanSeq: Map<number, number>;
}

/**
 * One shared O(cells) prescan for a whole link batch. Replaces the full-map
 * walk planPulses used to run per link (the dominant per-block main-thread
 * cost on busy chains) with a single pass that buckets candidate sources by
 * parent tx hash. Selection through the index is byte-identical to the
 * original scan; an equivalence test locks the two paths together. Pure.
 */
export function collectLinkSourceIndex(
  links: readonly CellLink[],
  cells: ReadonlyMap<number, Cell>,
): LinkSourceIndex {
  const wanted = new Set<string>();
  for (const link of links) {
    if (link.to_ids.length === 0) continue;
    for (const parentTx of link.parents) wanted.add(parentTx);
  }
  const byTx = new Map<string, number[]>();
  const scanSeq = new Map<number, number>();
  if (wanted.size === 0) return { byTx, scanSeq };
  for (const [id, cell] of cells) {
    const tx = cell.out_point.tx_hash;
    if (!wanted.has(tx)) continue;
    let bucket = byTx.get(tx);
    if (!bucket) {
      bucket = [];
      byTx.set(tx, bucket);
    }
    bucket.push(id);
    scanSeq.set(id, scanSeq.size);
  }
  return { byTx, scanSeq };
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
  const sourceIndex =
    typeof optionsOrMaxHops === 'number'
      ? undefined
      : optionsOrMaxHops.sourceIndex;
  if (link.to_ids.length === 0) {
    stats?.bump('no-outputs');
    return [];
  }

  const color = consensusPacketColor(link.tx_hash, link.tag);

  // Collect candidate source cells: alive cells whose birth tx_hash
  // is one of the link's parent_tx_hashes. Selection semantics (Cell-map scan
  // order, per-parent cap AFTER self-loop exclusion) are identical on both
  // paths; the index path just skips the full-map walk.
  const sources: number[] = [];
  if (link.parents.length > 0 && sourceIndex) {
    const picked: Array<{ id: number; seq: number }> = [];
    const parentSet = new Set(link.parents);
    for (const parentTx of parentSet) {
      const bucket = sourceIndex.byTx.get(parentTx);
      if (!bucket) continue;
      let used = 0;
      for (const id of bucket) {
        if (used >= maxSourcesPerParent) break;
        if (link.to_ids.includes(id)) continue; // don't pulse from self-loops
        picked.push({ id, seq: sourceIndex.scanSeq.get(id) ?? 0 });
        used += 1;
      }
    }
    picked.sort((a, b) => a.seq - b.seq);
    for (const pick of picked) sources.push(pick.id);
  } else if (link.parents.length > 0) {
    const parentSet = new Set(link.parents);
    const perParent = new Map<string, number>();
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
    if (pulses.length >= maxPulsesPerLink) break;
    // One BFS per source covers every output of this tx; per-target results
    // are byte-identical to routing each (src, dst) pair separately.
    const pathsByDst = shortestPathsToTargets(graph, src, link.to_ids, maxHops);
    for (const dst of link.to_ids) {
      if (pulses.length >= maxPulsesPerLink) break outer;
      if (src === dst) continue;
      const missing =
        !graph.adjacency.has(src) || !graph.adjacency.has(dst);
      const path = pathsByDst.get(dst) ?? null;
      if (!path || path.length < 2) {
        stats?.bumpPath(missing ? 'endpoint-missing' : 'no-path');
        continue;
      }
      const { startDelayMs, hopMs } = pulseTiming(link, src, dst);
      pulses.push({
        linkSeq: link.seq,
        linkBlock: link.block,
        path,
        bornAtMs: nowMs,
        color,
        startDelayMs,
        hopMs,
      });
    }
  }
  stats?.bump(pulses.length > 0 ? 'fired' : 'all-paths-failed');
  return pulses;
}
