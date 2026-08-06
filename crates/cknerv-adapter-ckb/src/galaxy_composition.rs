use std::collections::HashSet;

use anyhow::{Context, Result};
use async_trait::async_trait;
use serde_json::Value;
use url::Url;

use cknerv_core::{
    helix_seed_for, AssetKind, Cell, GalaxyCellCandidate, GalaxyCompositionCandidates,
    GalaxyCompositionRecord, OutPoint, TxOutputInfo,
};
use cknerv_server::GalaxyCompositionHydrator;

use crate::block_fetch::parse_output_info;
use crate::rpc::RpcClient;

const LIVE_CELL_BATCH_SIZE: usize = 64;
const COMPOSITION_ID_PREFIX: u64 = 1_u64 << 52;
const COMPOSITION_ID_MASK: u64 = (1_u64 << 51) - 1;

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
                    content_hash: output.content_hash,
                    lock_kind: output.lock_kind,
                    asset_kind: output.asset_kind,
                });
            }
        }
        Ok(cells)
    }
}

#[async_trait]
impl GalaxyCompositionHydrator for CkbGalaxyCompositionHydrator {
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

fn allocate_composition_id(out_point: &OutPoint, admitted: &mut HashSet<u64>) -> u64 {
    let mut hash = 0xcbf29ce484222325_u64;
    for byte in out_point.tx_hash.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    for byte in out_point.index.to_le_bytes() {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    let mut id = COMPOSITION_ID_PREFIX | (hash & COMPOSITION_ID_MASK);
    while !admitted.insert(id) {
        id = COMPOSITION_ID_PREFIX | (id.wrapping_add(1) & COMPOSITION_ID_MASK);
    }
    id
}

#[cfg(test)]
mod tests {
    use super::*;

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
