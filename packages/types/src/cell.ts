// Cell-galaxy projection wire types — TS mirror of
// `cknerv-core::projection::cells`.
//
// `Cell`, `CellDelta`, `CellGalaxySnapshot`, `CellLinkRecord` mirror the
// Rust serializer's `#[serde(rename_all = "snake_case")]` shape. The
// fixture in `tests/fixtures/snapshot_cells.json` pins it on both sides.

import type { OutPoint } from './outpoint';

/** Free-form tag string assigned by an external emitter. Known values
 *  in the simulator: "wallet" | "dex" | "cf" | "ckbloom". cknerv-core's
 *  cell-galaxy projection treats this opaquely; palette mapping lives
 *  at the SPA. */
export type CellTag = string;

/** Lock-script family classification. Mirrors the Rust
 *  `#[serde(rename_all = "snake_case")]` `LockKind` enum. */
export type LockKind = 'sighash' | 'multisig' | 'acp' | 'omnilock' | 'other';

/** Asset/type-script family classification. Mirrors the Rust
 *  `#[serde(rename_all = "snake_case")]` `AssetKind` enum. */
export type AssetKind = 'native' | 'sudt' | 'xudt' | 'dao' | 'spore' | 'other';

export interface Cell {
  id: number;
  born_at_ms: number;
  death_at_ms: number | null;
  birth_block: number;
  tag: CellTag | null;
  pos_seed: [number, number, number];
  out_point: OutPoint;
  capacity: number;       // shannons; UI converts to CKB
  data_hex: string;       // may end with "…" if upstream truncated
  /** CKB-canonical BLAKE2b-256 of CellOutput + data. Stable, 66-char
   *  0x-prefixed hex. Seeds the per-cell CellLifeAvatar. */
  content_hash: string;
  /** Lock-script family. Optional: old persisted state may lack it
   *  (mirrors Rust `#[serde(default)]`). */
  lock_kind?: LockKind;
  /** Asset/type-script family. Optional: old persisted state may lack
   *  it (mirrors Rust `#[serde(default)]`). */
  asset_kind?: AssetKind;
}

/**
 * Compact immutable evidence captured when a transaction link is observed.
 * The full Cell may leave the bounded live projection; this anchor keeps its
 * real scene position and maintained-content identity.
 */
export interface CellLinkEndpointAnchor {
  id: number;
  pos_seed: [number, number, number];
  content_hash: string;
}

/** Wire shape of one entry in the snapshot's `recent_links` history.
 *  Mirrors the Rust `CellLinkRecord` struct. */
export interface CellLinkRecord {
  tx_hash: string;
  block: number;
  from_ids: number[];
  to_ids: number[];
  endpoint_anchors: CellLinkEndpointAnchor[];
  parents: string[];
  tag: CellTag | null;
  at_ms: number;
}

export interface CellGalaxySnapshot {
  cells: Cell[];
  last_pulse_at_ms: number;
  /** Tx-link history shipped from the backend so the frontend can
   *  rebuild the full tx DAG on bootstrap. */
  recent_links?: CellLinkRecord[];
  /** Cumulative count of cells ever-born on chain. */
  total_births?: number;
  /** Cumulative count of real chain deaths (input cells consumed by a
   *  landed tx). Excludes `CELL_CAP` evictions. */
  total_deaths?: number;
  /** Boot-time backfill progress; present only while the server is
   *  seeding the recent live-cell set. */
  backfill?: { done: number; total: number } | null;
}

/** Causal-edge entry kept in the live cache after `applyCellDelta`. */
export interface CellLink {
  /** Monotonic seq assigned when the link is appended. */
  seq: number;
  tx_hash: string;
  block: number;
  from_ids: number[];
  to_ids: number[];
  endpoint_anchors: CellLinkEndpointAnchor[];
  parents: string[];
  tag: CellTag | null;
  at_ms: number;
}

/** Delta wire shape — one entry inside the projection-stream frames. */
export type CellDelta =
  | { type: 'birth'; cell: Cell }
  | { type: 'death'; id: number; at_ms: number }
  | { type: 'tag'; id: number; tag: CellTag }
  | { type: 'gc'; ids: number[] }
  | { type: 'pulse'; at_ms: number }
  | { type: 'stats'; total_births: number; total_deaths: number }
  | { type: 'backfill'; done: number; total: number; active: boolean }
  /** Reorg invalidation boundary: discard every causal link at or above it. */
  | { type: 'link_prune'; from_block: number }
  | {
      type: 'link';
      tx_hash: string;
      block: number;
      from_ids: number[];
      to_ids: number[];
      endpoint_anchors: CellLinkEndpointAnchor[];
      parents: string[];
      tag: CellTag | null;
      at_ms: number;
    };

/** Delta paired with the revision that produced it. The Rust side ships
 *  these inside `{kind: "delta", deltas: [{revision, delta}, ...]}`
 *  frames. */
export interface RevisionedCellDelta {
  revision: number;
  delta: CellDelta;
}
