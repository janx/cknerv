//! cknerv adapter for local CKB nodes via JSON-RPC.
//!
//! Implements [`cknerv_server::Adapter`] by polling CKB's JSON-RPC
//! endpoint at a configurable interval. Emits chain-generic
//! [`cknerv_core::Mutation`]s into the server's pipeline:
//! - `ChainNodeRegistered` once on startup
//! - `BlockMined` + `TxLanded` per new canonical block
//! - `ChainReorganized` before replaying a changed canonical suffix
//! - `ChainRebuild` before a bounded replay when no retained common ancestor
//!   can be proven
//! - `ChainInfoUpdated` + `ChainMempoolUpdated` when those snapshots change
//!
//! Mirrors `simulator/src/telemetry/chain_poll.rs` so the same on-chain
//! data emits byte-identical mutations from either source. The
//! `content_hash` computation is the linchpin — see [`content_hash`]
//! for the parity-tested algorithm.

pub mod adapter;
mod backfill;
pub mod block_fetch;
pub mod content_hash;
mod network;
pub mod poll;
pub mod rpc;
mod script_taxonomy;

pub use adapter::CkbDirectAdapter;
