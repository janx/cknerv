use std::collections::HashSet;

use anyhow::{Context, Result};
use async_trait::async_trait;
use serde_json::Value;
use url::Url;

use cknerv_core::{
    composition_id_for_outpoint, helix_seed_for, AssetKind, Cell, GalaxyCellCandidate,
    GalaxyCompositionCandidates, GalaxyCompositionRecord, GalaxyCompositionTopUp, OutPoint,
    TxOutputInfo, COMPOSITION_ID_MASK, COMPOSITION_ID_PREFIX,
};
use cknerv_server::GalaxyCompositionHydrator;

use crate::block_fetch::parse_output_info;
use crate::rpc::RpcClient;

const LIVE_CELL_BATCH_SIZE: usize = 64;

pub struct CkbGalaxyCompositionHydrator {
    rpc: RpcClient,
    batch_size: usize,
}

impl CkbGalaxyCompositionHydrator {
    pub fn new(rpc_url: Url) -> Self {
        Self {
            rpc: RpcClient::new(rpc_url),
            batch_size: LIVE_CELL_BATCH_SIZE,
        }
    }

    async fn hydrate_bucket(
        &self,
        candidates: &[GalaxyCellCandidate],
        target: usize,
        class: CompositionClass,
        admitted_outpoints: &mut HashSet<OutPoint>,
        admitted_ids: &mut HashSet<u64>,
    ) -> Result<Vec<Cell>> {
        let mut cells = Vec::with_capacity(target);
        for batch in candidates.chunks(self.batch_size) {
            if cells.len() >= target {
                break;
            }
            let pending: Vec<_> = batch
                .iter()
                .filter(|candidate| !admitted_outpoints.contains(&candidate.out_point))
                .collect();
            let out_points: Vec<_> = pending
                .iter()
                .map(|candidate| candidate.out_point.clone())
                .collect();
            let live = self
                .rpc
                .get_live_cells(&out_points, true)
                .await
                .context("validate CellGalaxy composition candidates through CKB")?;

            for (candidate, result) in pending.into_iter().zip(live) {
                if cells.len() >= target {
                    break;
                }
                let Some(result) = result else {
                    continue;
                };
                let Some(output) = parse_live_cell_output(&result, &candidate.out_point)? else {
                    continue;
                };
                if output.capacity != candidate.capacity || !class.accepts(output.asset_kind) {
                    continue;
                }

                let id = allocate_composition_id(&candidate.out_point, admitted_ids);
                admitted_outpoints.insert(candidate.out_point.clone());
                cells.push(Cell {
                    id,
                    // Indexed membership refresh is not a chain Birth event.
                    // Zero keeps the shader fully settled without inventing a
                    // wall-clock timestamp that ckbadger's summary does not expose.
                    born_at_ms: 0,
                    death_at_ms: None,
                    birth_block: candidate.birth_block,
                    tag: None,
                    pos_seed: helix_seed_for(id),
                    out_point: candidate.out_point.clone(),
                    capacity: output.capacity,
                    data_hex: output.data_hex,
                    data_bytes: output.data_bytes,
                    content_hash: output.content_hash,
                    lock_shape_seed: output.lock_shape_seed,
                    type_shape_seed: output.type_shape_seed,
                    data_shape_seed: output.data_shape_seed,
                    lock_kind: output.lock_kind,
                    asset_kind: output.asset_kind,
                    // Node-derived like every other field here: the hydrator
                    // re-reads each indexed candidate with `get_live_cell`, so
                    // a staged Cell's script identity comes from the chain, not
                    // from the index that merely pointed at it.
                    lock_script: output.lock_script,
                    type_script: output.type_script,
                });
            }
        }
        Ok(cells)
    }
}

#[async_trait]
impl GalaxyCompositionHydrator for CkbGalaxyCompositionHydrator {
    async fn hydrate_galaxy_top_up(
        &self,
        candidates: GalaxyCompositionCandidates,
    ) -> Result<GalaxyCompositionTopUp> {
        // Same fence as a full composition, two classes instead of three
        // (plain is never topped up — D5).
        let mut admitted_outpoints = HashSet::with_capacity(candidates.target.total());
        let mut admitted_ids = HashSet::with_capacity(candidates.target.total());
        let dao = self
            .hydrate_bucket(
                &candidates.dao,
                candidates.target.dao,
                CompositionClass::Dao,
                &mut admitted_outpoints,
                &mut admitted_ids,
            )
            .await?;
        let typed = self
            .hydrate_bucket(
                &candidates.typed,
                candidates.target.typed,
                CompositionClass::Typed,
                &mut admitted_outpoints,
                &mut admitted_ids,
            )
            .await?;
        tracing::debug!(
            target: "cknerv-adapter-ckb",
            dao = dao.len(),
            typed = typed.len(),
            offered_dao = candidates.dao.len(),
            offered_typed = candidates.typed.len(),
            "validated a CellGalaxy composition top-up through the CKB node"
        );
        Ok(GalaxyCompositionTopUp {
            source: candidates.source,
            as_of: candidates.as_of,
            updated_at_ms: candidates.updated_at_ms,
            dao,
            typed,
        })
    }

    async fn hydrate_galaxy_composition(
        &self,
        candidates: GalaxyCompositionCandidates,
    ) -> Result<GalaxyCompositionRecord> {
        let mut admitted_outpoints = HashSet::with_capacity(candidates.target.total());
        let mut admitted_ids = HashSet::with_capacity(candidates.target.total());
        let dao = self
            .hydrate_bucket(
                &candidates.dao,
                candidates.target.dao,
                CompositionClass::Dao,
                &mut admitted_outpoints,
                &mut admitted_ids,
            )
            .await?;
        let typed = self
            .hydrate_bucket(
                &candidates.typed,
                candidates.target.typed,
                CompositionClass::Typed,
                &mut admitted_outpoints,
                &mut admitted_ids,
            )
            .await?;
        let plain = self
            .hydrate_bucket(
                &candidates.plain,
                candidates.target.plain,
                CompositionClass::Plain,
                &mut admitted_outpoints,
                &mut admitted_ids,
            )
            .await?;

        tracing::info!(
            target: "cknerv-adapter-ckb",
            dao = dao.len(),
            typed = typed.len(),
            plain = plain.len(),
            "validated CellGalaxy composition through the CKB node"
        );
        Ok(GalaxyCompositionRecord {
            source: candidates.source,
            as_of: candidates.as_of,
            updated_at_ms: candidates.updated_at_ms,
            dao,
            typed,
            plain,
        })
    }
}

#[derive(Clone, Copy)]
enum CompositionClass {
    Dao,
    Typed,
    Plain,
}

impl CompositionClass {
    fn accepts(self, asset_kind: AssetKind) -> bool {
        match self {
            Self::Dao => asset_kind == AssetKind::Dao,
            Self::Typed => !matches!(asset_kind, AssetKind::Dao | AssetKind::Native),
            Self::Plain => asset_kind == AssetKind::Native,
        }
    }
}

fn parse_live_cell_output(result: &Value, out_point: &OutPoint) -> Result<Option<TxOutputInfo>> {
    let Some(cell) = result.get("cell").filter(|value| !value.is_null()) else {
        return Ok(None);
    };
    let output = cell
        .get("output")
        .with_context(|| format!("live Cell {:?} omitted output", out_point))?;
    let data = cell
        .get("data")
        .and_then(|value| value.get("content"))
        .and_then(Value::as_str)
        .with_context(|| format!("live Cell {:?} omitted data.content", out_point))?;
    parse_output_info(output, data, &format!("live Cell {:?}", out_point)).map(Some)
}

/// Linear probing over the reservoir's admitted set; the unprobed id is the
/// outpoint's own, so a bucket that admits an outpoint first places it where
/// every other producer would.
fn allocate_composition_id(out_point: &OutPoint, admitted: &mut HashSet<u64>) -> u64 {
    let mut id = composition_id_for_outpoint(&out_point.tx_hash, out_point.index);
    while !admitted.insert(id) {
        id = COMPOSITION_ID_PREFIX | (id.wrapping_add(1) & COMPOSITION_ID_MASK);
    }
    id
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    use axum::{routing::post, Json, Router};

    const DAO_TYPE_HASH: &str =
        "0x82d76d1b75fe2fd9a27dfbaa65a039221a380d76c926f378d3f81cf3e7e13f2e";

    /// A CKB node that answers `get_live_cell` batches: every outpoint
    /// whose tx hash starts with `0xde` is spent, the rest are live DAO
    /// cells of the requested capacity.
    async fn spawn_node(capacity: u64) -> (Url, tokio::task::JoinHandle<()>, Arc<AtomicUsize>) {
        let batches = Arc::new(AtomicUsize::new(0));
        let counted = batches.clone();
        let app = Router::new().route(
            "/",
            post(move |Json(body): Json<Value>| {
                let counted = counted.clone();
                async move {
                    counted.fetch_add(1, Ordering::Relaxed);
                    let requests = body.as_array().cloned().unwrap_or_default();
                    let out: Vec<Value> = requests
                        .iter()
                        .map(|req| {
                            let tx_hash = req["params"][0]["tx_hash"].as_str().unwrap_or_default();
                            let cell = if tx_hash.starts_with("0xde") {
                                Value::Null
                            } else {
                                serde_json::json!({
                                    "output": {
                                        "capacity": format!("0x{capacity:x}"),
                                        "lock": {
                                            "code_hash": format!("0x{}", "00".repeat(32)),
                                            "hash_type": "type",
                                            "args": "0x"
                                        },
                                        "type": {
                                            "code_hash": DAO_TYPE_HASH,
                                            "hash_type": "type",
                                            "args": "0x"
                                        }
                                    },
                                    "data": { "content": "0x", "hash": format!("0x{}", "00".repeat(32)) }
                                })
                            };
                            serde_json::json!({
                                "jsonrpc": "2.0",
                                "id": req["id"],
                                "result": { "cell": cell, "status": "live" }
                            })
                        })
                        .collect();
                    Json(Value::Array(out))
                }
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let handle = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        (
            Url::parse(&format!("http://{address}/")).unwrap(),
            handle,
            batches,
        )
    }

    fn tail_candidate(prefix: &str, i: usize, capacity: u64) -> GalaxyCellCandidate {
        GalaxyCellCandidate {
            out_point: OutPoint {
                tx_hash: format!("0x{prefix}{i:062x}"),
                index: 0,
            },
            capacity,
            birth_block: 10,
        }
    }

    fn supply(dao: Vec<GalaxyCellCandidate>, want: usize) -> GalaxyCompositionCandidates {
        GalaxyCompositionCandidates {
            source: "ckbadger".into(),
            as_of: cknerv_core::ChainAnchor {
                block: 100,
                hash: "0xanchor".into(),
            },
            updated_at_ms: 1,
            target: cknerv_core::GalaxyCompositionTarget {
                dao: want,
                typed: 0,
                plain: 0,
            },
            dao,
            typed: Vec::new(),
            plain: Vec::new(),
        }
    }

    /// A candidate spent between discovery and validation is dropped and
    /// the batch keeps going — the tail is stale by construction, so one
    /// dead entry must not cost the whole turn.
    #[tokio::test]
    async fn top_up_skips_candidates_that_died_since_discovery() {
        let (rpc, node, _) = spawn_node(500).await;
        let hydrator = CkbGalaxyCompositionHydrator::new(rpc);
        let candidates: Vec<_> = (0..10)
            .map(|i| tail_candidate(if i % 2 == 0 { "de" } else { "ab" }, i, 500))
            .collect();

        let top_up = hydrator
            .hydrate_galaxy_top_up(supply(candidates, 10))
            .await
            .unwrap();
        assert_eq!(top_up.dao.len(), 5, "the five live ones survive");
        assert!(top_up.typed.is_empty());
        assert!(top_up
            .dao
            .iter()
            .all(|cell| cell.out_point.tx_hash.starts_with("0xab")));
        assert!(top_up.dao.iter().all(|cell| {
            cell.data_bytes == 0
                && cell.lock_shape_seed != [0, 0]
                && cell.type_shape_seed.is_some_and(|seed| seed != [0, 0])
                && cell.data_shape_seed == [0x44f4_c697, 0x44d5_f8c5]
        }));
        node.abort();
    }

    /// Validation stops as soon as the ask is covered, so an oversized
    /// offer never turns into unbounded node work.
    #[tokio::test]
    async fn top_up_stops_once_the_ask_is_covered() {
        let (rpc, node, batches) = spawn_node(500).await;
        let hydrator = CkbGalaxyCompositionHydrator::new(rpc);
        let candidates: Vec<_> = (0..1_000).map(|i| tail_candidate("ab", i, 500)).collect();

        let top_up = hydrator
            .hydrate_galaxy_top_up(supply(candidates, 100))
            .await
            .unwrap();
        assert_eq!(top_up.dao.len(), 100);
        assert!(
            batches.load(Ordering::Relaxed) <= 100 / LIVE_CELL_BATCH_SIZE + 1,
            "stopped at the ask instead of walking all 1000"
        );
        node.abort();
    }

    /// A candidate whose on-chain capacity no longer matches what the
    /// index reported is refused — the node is the authority.
    #[tokio::test]
    async fn top_up_refuses_a_candidate_the_node_disagrees_with() {
        let (rpc, node, _) = spawn_node(500).await;
        let hydrator = CkbGalaxyCompositionHydrator::new(rpc);
        let candidates: Vec<_> = (0..4).map(|i| tail_candidate("ab", i, 999)).collect();

        let top_up = hydrator
            .hydrate_galaxy_top_up(supply(candidates, 4))
            .await
            .unwrap();
        assert!(top_up.is_empty(), "stale capacity is not a live cell");
        node.abort();
    }

    #[test]
    fn composition_ids_are_stable_safe_integers_and_collision_resolved() {
        let out_point = OutPoint {
            tx_hash: format!("0x{}", "11".repeat(32)),
            index: 7,
        };
        let mut first = HashSet::new();
        let id = allocate_composition_id(&out_point, &mut first);
        let mut second = HashSet::new();
        assert_eq!(id, allocate_composition_id(&out_point, &mut second));
        assert!(id >= COMPOSITION_ID_PREFIX);
        assert!(id < (1_u64 << 53));

        let next = allocate_composition_id(&out_point, &mut first);
        assert_ne!(id, next);
    }

    #[test]
    fn class_validation_is_exact() {
        assert!(CompositionClass::Dao.accepts(AssetKind::Dao));
        assert!(CompositionClass::Typed.accepts(AssetKind::Xudt));
        assert!(CompositionClass::Typed.accepts(AssetKind::Other));
        assert!(CompositionClass::Plain.accepts(AssetKind::Native));
        assert!(!CompositionClass::Typed.accepts(AssetKind::Dao));
        assert!(!CompositionClass::Plain.accepts(AssetKind::Other));
    }
}
