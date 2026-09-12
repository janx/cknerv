import type { Cell } from '@cknerv/types';
import type { PassiveSelection } from '../../src/geometry/neighborGraph';
import { bridgeHostChain } from './bridgeHostChain';

/**
 * The bench's stage as the FABRIC sees it.
 *
 * `bridgeHostChain()` already builds the sequence the bench and lane L2
 * measure — 12,000 `helixSeedF64` Cells, k = 5, `maxEdgeLength` 42, a passive
 * budget of 8,000, churned by blocks of 40 deaths and 40 births — and caches
 * it for the process. The fabric wants the same blocks in the two shapes its
 * handles take: the staged Cell map (endpoints come from `pos_seed`) and the
 * drawn passive selection. Nothing is rebuilt here; this is the same 7 s of
 * k-NN work, read the other way round.
 */
export interface FabricStageBlock {
  readonly cells: ReadonlyMap<number, Cell>;
  readonly selection: PassiveSelection;
}

/** The fields beyond `id`/`pos_seed` that no fabric path reads, filled so the
 *  map is a real `Cell` map and not a cast. */
function stagedCell(
  id: number,
  pos: readonly [number, number, number],
  dead: number | null,
): Cell {
  return {
    id,
    born_at_ms: 0,
    death_at_ms: dead,
    birth_block: 1,
    tag: null,
    pos_seed: [pos[0], pos[1], pos[2]],
    out_point: { tx_hash: `0x${id.toString(16)}`, index: 0 },
    capacity: 0,
    data_hex: '0x',
    data_bytes: 0,
    content_hash: `0x${String(id).padStart(64, '0')}`,
    lock_shape_seed: [1, 2],
    type_shape_seed: null,
    data_shape_seed: [3, 4],
  };
}

let cached: readonly FabricStageBlock[] | null = null;

/** Block 0 is the cold stage; the rest are chained landings. */
export function fabricStageChain(): readonly FabricStageBlock[] {
  if (cached !== null) return cached;
  const blocks = bridgeHostChain().map((block): FabricStageBlock => {
    const cells = new Map<number, Cell>();
    for (const cell of block.cells) {
      cells.set(cell.id, stagedCell(cell.id, cell.pos_seed, cell.death_at_ms));
    }
    return { cells, selection: { edges: [...block.edges] } };
  });
  cached = blocks;
  return blocks;
}
