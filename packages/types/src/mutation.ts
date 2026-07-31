// Chain-generic mutation discriminated union — TS mirror of
// `cknerv-core::mutation::Mutation`.
//
// Wire shape: `#[serde(tag = "type", rename_all = "snake_case")]` on the
// Rust side, so every variant carries a `type` discriminant. The fixture
// in `tests/fixtures/mutation_samples.json` pins each variant on both
// sides.

import type { EpochInfo, Peer } from './entity';
import type { OutPoint, TxOutputInfo } from './outpoint';

export type Mutation =
  | {
      type: 'block_mined';
      number: number;
      hash: string;
      tx_count: number;
      size?: number;
      at: number;
    }
  /** Invalidates the formerly-canonical suffix before replacement blocks
   *  are replayed. */
  | {
      type: 'chain_reorganized';
      from_block: number;
    }
  /** The common ancestor fell outside retained history. Consumers discard
   *  unsafe derived state before the adapter replays a fresh canonical
   *  window beginning at `from_block`. */
  | {
      type: 'chain_rebuild';
      from_block: number;
    }
  | {
      type: 'tx_landed';
      tx_hash: string;
      block: number;
      at: number;
      /** Outpoints consumed by this tx — each kills the matching cell in
       *  the cell-galaxy projection. */
      inputs: OutPoint[];
      /** Newly-produced outputs — each births a fresh cell. */
      outputs: TxOutputInfo[];
    }
  | {
      type: 'chain_mempool_updated';
      pending: number;
      proposed: number;
      orphan: number;
      total_tx_size: number;
      total_tx_cycles: number;
      min_fee_rate: number;
    }
  | {
      type: 'chain_info_updated';
      epoch: EpochInfo;
      median_time_ms: number;
      difficulty: string;
      chain_name: string;
    }
  /** Opaque tag for the cell at `out_point`. cknerv-core's cell galaxy
   *  stores it as a string and ships it to consumers; meaning is the
   *  emitter's concern. */
  | {
      type: 'cell_tagged';
      out_point: OutPoint;
      tag: string;
      at: number;
    }
  /** Register a chain node into the server's `chain_nodes` list.
   *  Idempotent: re-registering the same `id` updates `label` and
   *  `is_miner` if changed, otherwise no-op. Single-node adapters emit
   *  this once at startup; multi-node profiles emit once per node. */
  | {
      type: 'chain_node_registered';
      id: string;
      label: string;
      is_miner: boolean;
      at: number;
    }
  /** Records that target-driven historical replay found enough live cells
   *  (or reached genesis). Projection metadata only; it does not alter the
   *  chain entity. */
  | {
      type: 'cell_hydration_completed';
      target: number;
      available: number;
      from_block: number;
      at_tip: number;
    }
  | {
      type: 'peers_updated';
      peers: Peer[];
    }
  | {
      type: 'chain_sync_updated';
      ibd: boolean;
      best_known_block: number;
    }
  | {
      type: 'chain_node_info_updated';
      id: string;
      version: string;
      connections: number;
    };

/** Mutation paired with the EntityStore revision that produced it. Matches
 *  `cknerv-core::mutation::RevisionedMutation`. */
export interface RevisionedMutation {
  revision: number;
  mutation: Mutation;
}
