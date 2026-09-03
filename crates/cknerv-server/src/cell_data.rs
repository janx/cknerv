//! Source-agnostic boundary for ONE Cell output's complete data.
//!
//! Everything else in this server ships a Cell's data as a bounded prefix
//! beside its true length: the direct adapter caps `data_hex` at 1 KiB, an
//! index caps its content preview at 4 KiB, and `Cell.data_bytes` states how
//! much was left behind. That is the right trade for a projection carrying
//! ten thousand Cells at once and the wrong one for the single Cell a reader
//! has opened, where the payload IS the subject.
//!
//! So this is [`crate::GalaxyCompositionHydrator`]'s seam turned around: a
//! point lookup rather than a bulk validation, answered on demand and never
//! in the background. Nothing read here enters the mutation stream, the
//! enrichment stream, a projection, or the persisted snapshot — the answer
//! goes straight back out of the route that asked for it.
//!
//! The whole thing rests on one property of an outpoint: its bytes never
//! change. A transaction output is written once and afterwards only spent,
//! so `(tx_hash, index)` names the same payload forever, whether the Cell is
//! still live or has been consumed. That is what lets the route promise an
//! immutable answer, and it is why the reader is a plain lookup with no
//! anchor to validate and no staleness to report.

use async_trait::async_trait;

use cknerv_core::OutPoint;

/// One Cell output's complete data, exactly as the chain holds it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CellOutputData {
    /// The whole payload — not a prefix, and not hex: the route hands these
    /// bytes straight to the client as an octet stream.
    pub bytes: Vec<u8>,
    /// CKB's own data hash, `0x` + 64 hex characters.
    ///
    /// For empty data this is the ZERO hash rather than the BLAKE2b of an
    /// empty slice; that is the chain's own convention, and an implementation
    /// that hand-rolled the hash instead of asking `CellOutput::calc_data_hash`
    /// would disagree with the node about every dataless Cell on the stage.
    pub data_hash: String,
    /// Whether the output is still unspent. A dead Cell's bytes are exactly as
    /// true as a live one's — the flag says which question the node had to
    /// answer to produce them, not how much the answer can be trusted.
    pub live: bool,
}

/// Reads one Cell output's data from whatever holds chain truth.
///
/// Deliberately not part of [`crate::EnrichmentSource`]: chain bytes are
/// canonical, and an index is not entitled to be asked for them. The route
/// this trait feeds therefore exists in CKB-only mode, where the whole
/// enrichment surface is absent.
#[async_trait]
pub trait CellDataReader: Send + Sync + 'static {
    /// Read the complete output data at `out_point`.
    ///
    /// The two failure shapes are kept apart on purpose, because the route
    /// answers them with different status codes and the browser draws them
    /// differently:
    ///
    ///   * `Ok(None)` — chain truth was consulted and knows no such output.
    ///     A permanent, honest absence: a 404, and a reader that stops asking.
    ///   * `Err(_)` — the source could not be asked, or answered something
    ///     that made no sense. A fact about our window rather than about the
    ///     chain: a 502, and a reader that may try again.
    async fn read_output_data(
        &self,
        out_point: &OutPoint,
    ) -> anyhow::Result<Option<CellOutputData>>;
}

/// The largest payload the route will hand back in one response.
///
/// A valve, not a budget: a whole CKB block is around 600 KB, so nothing the
/// chain actually carries comes near this. It exists so that a malformed
/// answer, or a future chain with a far larger data limit, cannot turn one
/// browser request into an unbounded allocation on both sides of the wire.
pub const CELL_DATA_MAX_BYTES: usize = 2 * 1024 * 1024;

/// How many of these reads may be in flight toward the source at once.
///
/// Two, because this route is driven by a human opening one Cell at a time,
/// and the node it reads from is the same node the canonical adapter is
/// following block by block. The browser caches what it is handed, so the
/// steady-state rate here is a handful of requests per inspection; the
/// permit exists to keep a reload storm from competing with the chain poll.
pub const CELL_DATA_IN_FLIGHT: usize = 2;
