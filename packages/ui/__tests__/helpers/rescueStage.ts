import {
  buildNeighborGraph,
  type NeighborGraph,
} from '../../src/geometry/neighborGraph';
import type { RescuePositioned } from '../../src/geometry/pathRouter';
import { helixSeedF64 } from '../../src/helix';

/**
 * The bench's stage as the RESCUE sees it: 12,000 `helixSeedF64` Cells with
 * k = 5 and `maxEdgeLength` 42 (`benchmarks/rendering/cpu.ts`, and the same
 * numbers `helpers/bridgeHostChain.ts` chains the bridge over), plus the forty
 * dark blocks lane L2 timed the rescue with.
 *
 * A dark block is one whose every link dropped: `planRescuePulse` then picks a
 * destination among the newborn outputs and scores every reachable node either
 * by proximity to the consumed coin's anchor (`anchored`) or by rim entry along
 * the destination's outward radial (`rim`). The four shapes below are the ones
 * the live plan reaches:
 *
 *  - an anchored rescue whose consumed coin has LEFT the stage (the common
 *    one: `endpoint_anchors` carries its position after the cell is gone),
 *  - an anchored rescue whose coin is still placed on the stage,
 *  - two rim rescues, which name no origin at all.
 *
 * From case 20 on, a ninth of the stage is missing from the cells map while
 * staying in the graph — the live lag between a topology commit and the cells
 * publish, and what the rescue's validity gate is for.
 */
export const RESCUE_STAGE_SIZE = 12_000;
export const RESCUE_STAGE_K = 5;
export const RESCUE_STAGE_MAX_EDGE_LENGTH = 42;
export const RESCUE_STAGE_BLOCKS = 40;

export interface RescueStageCell extends RescuePositioned {
  id: number;
  death_at_ms: number | null;
  pos_seed: readonly [number, number, number];
}

export interface RescueDarkBlock {
  /** Case index, so a failing row names itself. */
  readonly index: number;
  readonly kind: 'anchored' | 'rim';
  /** The link's first routable output. */
  readonly dst: number;
  /** The consumed coin's address, present only for an anchored rescue. */
  readonly anchor: readonly [number, number, number] | null;
  /** The cells map as the plan sees it — the whole stage, or the stage with a
   *  ninth of it already gone from the publish the graph was built from. */
  readonly cells: ReadonlyMap<number, RescueStageCell>;
}

export interface RescueStage {
  readonly graph: NeighborGraph;
  readonly cells: ReadonlyMap<number, RescueStageCell>;
  /** The stage minus every ninth id, still whole in the graph. */
  readonly lagged: ReadonlyMap<number, RescueStageCell>;
  readonly blocks: readonly RescueDarkBlock[];
}

let cached: RescueStage | null = null;

/** Built once per process — the k-NN build is ~0.4 s and every case wants the
 *  same graph. */
export function rescueStage(): RescueStage {
  if (cached !== null) return cached;
  const cells = new Map<number, RescueStageCell>();
  for (let id = 0; id < RESCUE_STAGE_SIZE; id++) {
    cells.set(id, { id, death_at_ms: null, pos_seed: helixSeedF64(id) });
  }
  const graph = buildNeighborGraph(
    { values: () => cells.values() },
    { k: RESCUE_STAGE_K, maxEdgeLength: RESCUE_STAGE_MAX_EDGE_LENGTH },
  );
  const lagged = new Map<number, RescueStageCell>();
  for (const [id, cell] of cells) if (id % 9 !== 0) lagged.set(id, cell);

  // A small LCG, so the forty blocks are the same forty on every machine.
  let seed = 0x2f6e2b1;
  const rnd = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const blocks: RescueDarkBlock[] = [];
  for (let index = 0; index < RESCUE_STAGE_BLOCKS; index++) {
    const source = index < 20 ? cells : lagged;
    let dst = Math.floor(rnd() * RESCUE_STAGE_SIZE);
    while (!source.has(dst) || (graph.adjacency.get(dst)?.size ?? 0) === 0) {
      dst = (dst + 1) % RESCUE_STAGE_SIZE;
    }
    const coin = Math.floor(rnd() * RESCUE_STAGE_SIZE);
    const shape = index % 4;
    blocks.push({
      index,
      kind: shape === 0 || shape === 2 ? 'anchored' : 'rim',
      dst,
      anchor: shape === 0
        ? helixSeedF64(RESCUE_STAGE_SIZE + coin) // the coin left the stage
        : shape === 2
          ? helixSeedF64(coin)
          : null,
      cells: source,
    });
  }
  cached = { graph, cells, lagged, blocks };
  return cached;
}
