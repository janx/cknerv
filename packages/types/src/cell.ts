// Cell-galaxy projection wire types — TS mirror of
// `cknerv-core::projection::cells`.
//
// `Cell`, `CellDelta`, `CellGalaxySnapshot`, `CellLinkRecord` mirror the
// Rust serializer's `#[serde(rename_all = "snake_case")]` shape. The
// fixture in `tests/fixtures/snapshot_cells.json` pins it on both sides.

import type { ChainAnchor } from './enrichment';
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

/** Why canonical blocks are being replayed instead of followed live.
 *  Mirrors `cknerv_core::ReplayPhase`. */
export type ReplayPhase = 'boot' | 'catchup' | 'reorg' | 'rebuild';

/** Replay progress embedded in a cells snapshot. `phase` is optional on the
 *  wire so snapshots from before replay-cause reporting remain readable. */
export interface ReplayProgress {
  done: number;
  total: number;
  phase?: ReplayPhase;
}

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

// ── display plane — wire contract ────────────────────────────────────
// The display plane answers "who is on stage": a server-owned membership
// of at most `budget.cells` ids drawn from the canonical retained set
// plus curated residents. INVARIANT: display membership is presentation
// policy, never canonical truth — it moves no counters and is never
// persisted.

/** Fixed product budgets for the display plane. Server-owned so the
 *  composition constants (12K cells / 8K nerve screen budget) can be
 *  retuned without a frontend release. Presentation policy, never
 *  canonical truth. */
export interface DisplayBudget {
  cells: number;
  nerve_edges: number;
}

/** Which policy authors the display-plane membership. Mirrors the Rust
 *  `#[serde(rename_all = "snake_case")]` `DisplayMode` enum:
 *  'canonical' fills from the canonical retained set; 'composed' blends
 *  a curated reservoir (e.g. ckbadger) with canonical fill. */
export type DisplayMode = 'canonical' | 'composed';

/** Where the current display-plane membership came from and how fresh
 *  it is. `source`/`as_of` are null in canonical mode. Presentation
 *  provenance only — asserts nothing about canonical truth. */
export interface DisplayProvenance {
  mode: DisplayMode;
  source: string | null;
  as_of: ChainAnchor | null;
  updated_at_ms: number;
}

/** Snapshot section describing the display plane ("who is on stage").
 *  `members` is set-semantics and mixes canonical ids with resident
 *  ids; `residents` carries full payloads only for members outside the
 *  canonical retained set. Display membership is presentation policy,
 *  never canonical truth: it feeds no counters and is excluded from
 *  persistence. */
export interface DisplaySection {
  budget: DisplayBudget;
  members: number[];
  residents: Cell[];
  provenance: DisplayProvenance;
}

export interface CellGalaxySnapshot {
  cells: Cell[];
  last_pulse_at_ms: number;
  /** Tx-link history shipped from the backend so the frontend can
   *  rebuild the full tx DAG on bootstrap. */
  recent_links?: CellLinkRecord[];
  /** Canonical births represented by the current observation/rebuild window. */
  total_births?: number;
  /** Real chain deaths represented by the current observation/rebuild window.
   *  Excludes `CELL_CAP` evictions. */
  total_deaths?: number;
  /** Historical replay progress; present while seeding or rebuilding. */
  backfill?: ReplayProgress | null;
  /** Display-plane membership ("who is on stage"). Presentation policy,
   *  never canonical truth. Absent until the server staffs the plane
   *  (S1), mirroring the Rust `skip_serializing_if` on `display`. */
  display?: DisplaySection;
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
  | {
      type: 'backfill';
      done: number;
      total: number;
      active: boolean;
      /** Optional only for compatibility with older projection streams. */
      phase?: ReplayPhase;
    }
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
    }
  /** Display-plane membership patch ("who is on stage"). `enter_ids`
   *  reference canonical retained cells (same-stream ordering guarantees
   *  their births already arrived); `enter_cells` carry full payloads for
   *  resident members outside that set; `provenance` rides along only on
   *  mode/health changes. Presentation policy, never canonical truth. */
  | {
      type: 'display';
      enter_ids: number[];
      enter_cells: Cell[];
      exit_ids: number[];
      provenance?: DisplayProvenance | null;
    };

/** Delta paired with the revision that produced it. The Rust side ships
 *  these inside `{kind: "delta", deltas: [{revision, delta}, ...]}`
 *  frames. */
export interface RevisionedCellDelta {
  revision: number;
  delta: CellDelta;
}
