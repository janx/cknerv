// Chain outpoint and tx-output payload types — TS mirror of
// `cknerv-core::outpoint`. Wire shape is byte-stable across the
// Rust and TS boundary; consumers must keep field names + types in
// sync with `crates/cknerv-core/src/outpoint.rs`.

import type { LockKind, AssetKind } from './cell';

export interface OutPoint {
  tx_hash: string;
  index: number;
}

export interface TxOutputInfo {
  capacity: number;
  /** Hex-encoded output data, capped at 1024 source bytes (= 2050
   *  characters including the `0x` prefix). When the source data
   *  exceeds the cap `DATA_HEX_TRUNCATION_MARKER` is appended so consumers
   *  can detect truncation. */
  data_hex: string;
  /** CKB-canonical BLAKE2b-256 of `CellOutput.as_slice() ++ raw_data_bytes`
   *  using the `ckb-default-hash` personalization. Stable across reloads
   *  and identical to what the chain itself computes for this cell.
   *  66 chars including the `0x` prefix. */
  content_hash: string;
  /** Lock-script family. Optional: old persisted state may lack it
   *  (mirrors Rust `#[serde(default)]`). */
  lock_kind?: LockKind;
  /** Asset/type-script family. Optional: old persisted state may lack
   *  it (mirrors Rust `#[serde(default)]`). */
  asset_kind?: AssetKind;
}
