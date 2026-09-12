import type { BridgeHostSourceCell } from '../../src/geometry/bridgeEdges';
import { buildNeighborGraph, type NeighborEdge } from '../../src/geometry/neighborGraph';
import { buildPassiveNeighborGraph } from '../../src/geometry/passiveNeighborGraph';
import { helixSeedF64 } from '../../src/helix';

/**
 * The bench's stage, chained.
 *
 * `benchmarks/rendering/cpu.ts` measures the bridge over 12,000 `helixSeedF64`
 * Cells with k = 5, `maxEdgeLength` 42 and a passive budget of 8,000; lane L2
 * measured the host sync over that same stage churned by blocks of 40 deaths
 * and 40 births. This builds that sequence so a test can read the same thing
 * the probe and the bench read, rather than a shape invented for the test.
 *
 * What each block hands the sync is what the owner publishes:
 * `displayBridgeCellsRef` is the immutable DISPLAY list — it still carries the
 * Cells that died this block, because the stage draws their exit fade — and
 * `displayBridgePassiveRef` is the DRAWN passive selection, which is built
 * over the living ones alone. So each block here kills 40 Cells and keeps them
 * published for that one block, births 40, and rebuilds the graph with the
 * previous selection as `preferredEdges`, which is how the landing does it.
 */

export const BRIDGE_CHAIN_SIZE = 12_000;
export const BRIDGE_CHAIN_K = 5;
export const BRIDGE_CHAIN_MAX_EDGE_LENGTH = 42;
export const BRIDGE_CHAIN_PASSIVE_BUDGET = 8_000;
export const BRIDGE_CHAIN_BLOCKS = 16;
/** Deaths and births per block — lane L2's churn, and mainnet's order. */
export const BRIDGE_CHAIN_CHURN = 40;

export interface BridgeHostChainBlock {
  /** The immutable display publication: living Cells plus this block's dead. */
  readonly cells: readonly BridgeHostSourceCell[];
  /** The DRAWN passive selection over the living ones. */
  readonly edges: readonly NeighborEdge[];
}

interface ChainCell extends BridgeHostSourceCell {
  death_at_ms: number | null;
}

function stagedCell(id: number): ChainCell {
  return { id, death_at_ms: null, pos_seed: helixSeedF64(id) };
}

let cached: readonly BridgeHostChainBlock[] | null = null;

/**
 * Block 0 is the cold stage; blocks 1…{@link BRIDGE_CHAIN_BLOCKS} are chained
 * landings. Built once per process — it is ~7 s of real k-NN work, and every
 * test in a file wants the same sequence.
 */
export function bridgeHostChain(): readonly BridgeHostChainBlock[] {
  if (cached !== null) return cached;
  const topology = {
    k: BRIDGE_CHAIN_K,
    maxEdgeLength: BRIDGE_CHAIN_MAX_EDGE_LENGTH,
  };
  let staged = new Map<number, ChainCell>();
  for (let i = 1; i <= BRIDGE_CHAIN_SIZE; i += 1) staged.set(i, stagedCell(i));

  const blocks: BridgeHostChainBlock[] = [];
  let previous: readonly NeighborEdge[] | undefined;
  let nextId = BRIDGE_CHAIN_SIZE + 1;
  for (let block = 0; block <= BRIDGE_CHAIN_BLOCKS; block += 1) {
    if (block > 0) {
      // Last block's dead are collected; this block's are published one more
      // time, dead, exactly as the display list carries an exit fade.
      const living = new Map<number, ChainCell>();
      for (const cell of staged.values()) {
        if (cell.death_at_ms == null) living.set(cell.id, cell);
      }
      let killed = 0;
      for (const cell of living.values()) {
        if (killed >= BRIDGE_CHAIN_CHURN) break;
        // A death REPLACES the record, as the reducer's arm does; a published
        // block must still read as it did when it was published.
        living.set(cell.id, { ...cell, death_at_ms: block * 1_000 });
        killed += 1;
      }
      for (let i = 0; i < BRIDGE_CHAIN_CHURN; i += 1) {
        const born = stagedCell(nextId);
        nextId += 1;
        living.set(born.id, born);
      }
      staged = living;
    }
    const graph = buildNeighborGraph(staged, topology);
    const passive = buildPassiveNeighborGraph(graph, {
      edgeBudget: BRIDGE_CHAIN_PASSIVE_BUDGET,
      preferredEdges: previous,
    });
    previous = passive.edges;
    blocks.push({ cells: [...staged.values()], edges: passive.edges });
  }
  cached = blocks;
  return blocks;
}

/**
 * What one sync left behind, small enough to commit: the word it said, the
 * size of the registry, the degree histogram and a 64-bit digest of every
 * `(id, degree)` pair in id order. The digest is the hosts and the degrees —
 * the histogram and the count are there so a failure says WHERE.
 */
export interface BridgeHostDigest {
  moved: boolean;
  hosts: number;
  degrees: number[];
  digest: string;
}

export function digestBridgeHosts(
  registry: { hosts: ReadonlyMap<number, { id: number; degree: number }> },
  moved: boolean,
): BridgeHostDigest {
  const ids = [...registry.hosts.keys()].sort((a, b) => a - b);
  const degrees: number[] = [];
  // Two FNV-1a lanes with different offsets: a 32-bit digest over 12,000
  // pairs is thin for a golden, and two are free.
  let low = 0x811c9dc5;
  let high = 0x01000193;
  for (const id of ids) {
    const degree = registry.hosts.get(id)!.degree;
    degrees[degree] = (degrees[degree] ?? 0) + 1;
    for (const byte of `${id}:${degree};`) {
      const code = byte.charCodeAt(0);
      low = Math.imul(low ^ code, 0x01000193) >>> 0;
      high = Math.imul(high ^ code, 0x85ebca6b) >>> 0;
    }
  }
  for (let i = 0; i < degrees.length; i += 1) degrees[i] ??= 0;
  return {
    moved,
    hosts: ids.length,
    degrees,
    digest: `${low.toString(16).padStart(8, '0')}${high.toString(16).padStart(8, '0')}`,
  };
}
