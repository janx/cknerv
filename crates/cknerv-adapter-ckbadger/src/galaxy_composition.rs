//! Bounded ckbadger discovery for the CellGalaxy display reservoir.
//!
//! ckbadger ranks/indexes outpoints efficiently; it never becomes structural
//! truth. The caller passes these candidates to a canonical CKB hydrator
//! before any Cell crosses the shared enrichment wire boundary.

use std::collections::{HashMap, HashSet, VecDeque};

use anyhow::{anyhow, Context};
use futures::{stream, StreamExt};
use reqwest::StatusCode;
use serde::de::DeserializeOwned;
use serde::Deserialize;
use url::Url;

use cknerv_core::{
    ChainAnchor, GalaxyCellCandidate, GalaxyCompositionCandidates, GalaxyCompositionTarget,
    OutPoint, ScriptId,
};

use crate::source::hash_type_wire;

const PAGE_LIMIT: usize = 100;
const ASSET_GROUP_LIMIT: usize = 64;
const ADDRESS_GROUP_LIMIT: usize = 48;
const GROUP_FETCH_CONCURRENCY: usize = 8;
// `/cells/live` is indexed by script and ordered by creation position, not by
// capacity. Sampling three bounded pages per high-capacity asset lets cknerv
// rank the individual Cells by CKBytes without asking ckbadger to change.
const TYPED_CELL_PAGES_PER_GROUP: usize = 3;
const PLAIN_CELL_PAGES_PER_GROUP: usize = 1;
const CANDIDATE_OVERFETCH_NUMERATOR: usize = 5;
const CANDIDATE_OVERFETCH_DENOMINATOR: usize = 4;

pub(crate) async fn discover(
    client: &reqwest::Client,
    api_base: &Url,
    anchor: ChainAnchor,
    target_total: usize,
    updated_at_ms: u64,
) -> anyhow::Result<GalaxyCompositionCandidates> {
    let target = GalaxyCompositionTarget::for_total(target_total);
    let mut seen = HashSet::with_capacity(target.total().saturating_mul(2));

    let mut dao = discover_dao(client, api_base, overfetch(target.dao), &mut seen).await;
    let mut typed = discover_typed(client, api_base, overfetch(target.typed), &mut seen).await;
    let mut plain = discover_plain(client, api_base, overfetch(target.plain), &mut seen).await;
    // The index can advance while the validated compatibility anchor remains
    // fixed. Never attach a Cell born beyond the block that proves this record.
    for walk in [&mut dao, &mut typed, &mut plain] {
        walk.candidates
            .retain(|candidate| candidate.birth_block <= anchor.block);
    }

    let stopped = [("dao", &dao), ("typed", &typed), ("plain", &plain)];
    for (class, walk) in stopped {
        if let Some(error) = walk.stopped_by.as_ref() {
            tracing::warn!(
                target: "cknerv-adapter-ckbadger",
                class,
                collected = walk.candidates.len(),
                "the index stopped a CellGalaxy composition class short: {error:#}"
            );
        }
    }
    // A class that fails is dropped, not fatal: a short class is already
    // the case the composition policy handles, by filling that shortage
    // from matching canonical retained Cells. Voiding the whole
    // composition because one index walk failed costs the stage the two
    // classes that answered perfectly well.
    //
    // What must NOT be published is a composition that curates nobody.
    // That would flip the display plane to composed and mark the
    // capability landed, so a stage holding no curated Cell at all would
    // hold that way — the plane only re-arms the composition when it
    // degrades. An empty walk that failed therefore stays an error, and
    // the supervisor retries it.
    if dao.candidates.is_empty() && typed.candidates.is_empty() && plain.candidates.is_empty() {
        if let Some(error) = dao
            .stopped_by
            .take()
            .or_else(|| typed.stopped_by.take())
            .or_else(|| plain.stopped_by.take())
        {
            return Err(error);
        }
    }

    Ok(GalaxyCompositionCandidates {
        source: "ckbadger".to_string(),
        as_of: anchor,
        updated_at_ms,
        target,
        dao: dao.candidates,
        typed: typed.candidates,
        plain: plain.candidates,
    })
}

/// What one class's bounded walk produced, and what stopped it.
///
/// A walk keeps whatever it had already collected when it failed. The
/// composition is a bounded sample rather than a complete set, so cells
/// already in hand are worth exactly as much as they would have been had
/// the next page succeeded; discarding them buys nothing.
#[derive(Default)]
struct ClassWalk {
    candidates: Vec<GalaxyCellCandidate>,
    stopped_by: Option<anyhow::Error>,
}

impl ClassWalk {
    /// A class that never got past its own head request: no groups to
    /// walk, so nothing was collected.
    fn stopped(error: anyhow::Error) -> Self {
        Self {
            candidates: Vec::new(),
            stopped_by: Some(error),
        }
    }
}

/// How far a single top-up call may page before giving up its turn. Not
/// a depth limit — the cursors persist, so the next call resumes where
/// this one stopped. It only stops one tick from monopolising the index
/// when a class is deep and the answers are sparse.
const MAX_PAGES_PER_TOP_UP: usize = 8;

/// Where each class's paging has reached, so a top-up walks DEEPER into
/// the ranking instead of re-reading the head. Persisted across calls on
/// the source; the cost of answering a shortfall is then proportional to
/// the shortfall, not to the size of the composition.
#[derive(Default)]
pub(crate) struct CandidateTail {
    dao_cursor: Option<String>,
    dao_exhausted: bool,
    typed_groups: Vec<TypedGroup>,
    /// Round-robin position, so one large asset cannot starve the rest.
    typed_next: usize,
    /// Every outpoint this source has already handed to the display
    /// plane — through the initial composition or an earlier top-up.
    /// Offering one twice would spend a node round-trip on a cell the
    /// plane declines by outpoint anyway (invariant I4).
    emitted: HashSet<OutPoint>,
}

#[derive(Default)]
struct TypedGroup {
    type_script_hash: String,
    cursor: Option<String>,
    exhausted: bool,
}

impl CandidateTail {
    /// Remember what a full discovery just handed out, so the tail
    /// resumes past it instead of re-offering the head.
    pub(crate) fn note_emitted<'a>(&mut self, candidates: impl Iterator<Item = &'a OutPoint>) {
        for out_point in candidates {
            self.emitted.insert(out_point.clone());
        }
    }

    /// How many outpoints this tail has claimed. A claim is what makes a
    /// candidate invisible to every later top-up, so "was it claimed" is the
    /// question an ordering test has to be able to ask.
    #[cfg(test)]
    pub(crate) fn claimed(&self) -> usize {
        self.emitted.len()
    }
}

/// Walk deeper for `want_dao` / `want_typed` more candidates of each
/// class, resuming from wherever the last call stopped.
///
/// Returns them in the [`GalaxyCompositionCandidates`] shape the
/// canonical hydrator already speaks, with `target` carrying what was
/// asked for. The plain bucket stays empty: plain slots are fed by the
/// canonical fallback stream, not curated (D5).
pub(crate) async fn top_up(
    client: &reqwest::Client,
    api_base: &Url,
    anchor: ChainAnchor,
    tail: &mut CandidateTail,
    want_dao: usize,
    want_typed: usize,
    updated_at_ms: u64,
) -> anyhow::Result<GalaxyCompositionCandidates> {
    // Same rule as discovery — never attach a Cell born beyond the block that
    // proves this record — enforced INSIDE the walk, because the anchor is
    // known before the walk starts and the tail claims a candidate the moment
    // it takes one. Rejecting after the walk marked young cells emitted and
    // then dropped them, which made them invisible to every later top-up until
    // a full re-discovery reset the tail.
    let mut dao = if want_dao > 0 {
        top_up_dao(client, api_base, tail, want_dao, anchor.block).await
    } else {
        ClassWalk::default()
    };
    let mut typed = if want_typed > 0 {
        top_up_typed(client, api_base, tail, want_typed, anchor.block).await
    } else {
        ClassWalk::default()
    };

    for (class, walk) in [("dao", &dao), ("typed", &typed)] {
        if let Some(error) = walk.stopped_by.as_ref() {
            tracing::warn!(
                target: "cknerv-adapter-ckbadger",
                class,
                collected = walk.candidates.len(),
                "the index stopped a CellGalaxy top-up class short: {error:#}"
            );
        }
    }
    // Same rule as discovery, and one extra reason to keep what a failed
    // walk collected: the tail marks a candidate emitted as it takes it,
    // so dropping the class would claim depth for cells nobody was ever
    // handed. A turn that collected nothing and failed is reported, so
    // the supervisor logs why the shortfall is not closing.
    if dao.candidates.is_empty() && typed.candidates.is_empty() {
        if let Some(error) = dao.stopped_by.take().or_else(|| typed.stopped_by.take()) {
            return Err(error);
        }
    }

    Ok(GalaxyCompositionCandidates {
        source: "ckbadger".to_string(),
        as_of: anchor,
        updated_at_ms,
        target: GalaxyCompositionTarget {
            dao: want_dao,
            typed: want_typed,
            plain: 0,
        },
        dao: dao.candidates,
        typed: typed.candidates,
        plain: Vec::new(),
    })
}

async fn top_up_dao(
    client: &reqwest::Client,
    api_base: &Url,
    tail: &mut CandidateTail,
    want: usize,
    max_birth_block: u64,
) -> ClassWalk {
    let mut found = Vec::with_capacity(want);
    let stopped_by = walk_dao_tail(client, api_base, tail, want, max_birth_block, &mut found)
        .await
        .err();
    ClassWalk {
        candidates: found,
        stopped_by,
    }
}

async fn walk_dao_tail(
    client: &reqwest::Client,
    api_base: &Url,
    tail: &mut CandidateTail,
    want: usize,
    max_birth_block: u64,
    found: &mut Vec<GalaxyCellCandidate>,
) -> anyhow::Result<()> {
    for _ in 0..MAX_PAGES_PER_TOP_UP {
        if found.len() >= want {
            break;
        }
        if tail.dao_exhausted {
            // The index has been walked end to end. Start over from the
            // head: deposits made since are new, and `emitted` skips
            // everything already handed out.
            tail.dao_exhausted = false;
            tail.dao_cursor = None;
            break;
        }
        let mut url = endpoint(api_base, "dao/deposits")?;
        {
            let mut query = url.query_pairs_mut();
            query
                .append_pair("status", "0")
                .append_pair("limit", &PAGE_LIMIT.to_string());
            if let Some(cursor) = tail.dao_cursor.as_deref() {
                query.append_pair("cursor", cursor);
            }
        }
        let page: CursorPage<DaoDepositResponse> =
            fetch_json(client, url, "DAO deposit tail").await?;
        validate_page_size(page.data.len(), PAGE_LIMIT, "DAO deposit tail")?;
        for deposit in page.data {
            if deposit.status != "deposited" {
                continue;
            }
            let candidate = candidate(
                deposit.tx_hash,
                deposit.output_index,
                deposit.capacity,
                deposit.deposit_block_number,
                "DAO deposit",
            )?;
            // Before the claim, never after it: a candidate the anchor
            // rejects must stay UNCLAIMED, or it is lost to every later
            // top-up while the record that would have carried it is proven
            // by an older block.
            if candidate.birth_block > max_birth_block {
                continue;
            }
            if found.len() >= want {
                // Past the ask. Leave the rest of this page UNCLAIMED —
                // marking a candidate emitted without delivering it would
                // burn tail depth on a cell nobody ever saw.
                break;
            }
            if tail.emitted.insert(candidate.out_point.clone()) {
                found.push(candidate);
            }
        }
        if page.has_more {
            tail.dao_cursor = Some(next_cursor(page.next_cursor, "DAO deposit tail")?);
        } else {
            tail.dao_exhausted = true;
            break;
        }
    }
    Ok(())
}

async fn top_up_typed(
    client: &reqwest::Client,
    api_base: &Url,
    tail: &mut CandidateTail,
    want: usize,
    max_birth_block: u64,
) -> ClassWalk {
    let mut found = Vec::with_capacity(want);
    let stopped_by = walk_typed_tail(client, api_base, tail, want, max_birth_block, &mut found)
        .await
        .err();
    ClassWalk {
        candidates: found,
        stopped_by,
    }
}

async fn walk_typed_tail(
    client: &reqwest::Client,
    api_base: &Url,
    tail: &mut CandidateTail,
    want: usize,
    max_birth_block: u64,
    found: &mut Vec<GalaxyCellCandidate>,
) -> anyhow::Result<()> {
    if tail.typed_groups.is_empty() {
        let mut url = endpoint(api_base, "assets")?;
        url.query_pairs_mut()
            .append_pair("limit", &ASSET_GROUP_LIMIT.to_string())
            .append_pair("sort_key", "capacity")
            .append_pair("sort_direction", "desc");
        let assets: CursorPage<GalaxyAssetResponse> = fetch_json(client, url, "top assets").await?;
        validate_page_size(assets.data.len(), ASSET_GROUP_LIMIT, "top assets")?;
        tail.typed_groups = assets
            .data
            .into_iter()
            .map(|asset| asset.id)
            .filter(|hash| is_hash32(hash))
            .map(|type_script_hash| TypedGroup {
                type_script_hash,
                cursor: None,
                exhausted: false,
            })
            .collect();
        tail.typed_next = 0;
    }
    if tail.typed_groups.is_empty() {
        return Ok(());
    }

    let mut requests = 0;
    // Round-robin: one page per group per turn, so the shortfall is
    // spread across assets instead of drained from the largest one. Most
    // groups run out within a few pages, so a fair walk is also the only
    // way to reach the long tail at all.
    while found.len() < want && requests < MAX_PAGES_PER_TOP_UP {
        if tail.typed_groups.iter().all(|group| group.exhausted) {
            for group in &mut tail.typed_groups {
                group.exhausted = false;
                group.cursor = None;
            }
            break;
        }
        let index = tail.typed_next % tail.typed_groups.len();
        tail.typed_next = index + 1;
        if tail.typed_groups[index].exhausted {
            continue;
        }
        let (hash, cursor) = {
            let group = &tail.typed_groups[index];
            (group.type_script_hash.clone(), group.cursor.clone())
        };
        let mut url = endpoint(api_base, "cells/live")?;
        {
            let mut query = url.query_pairs_mut();
            query
                .append_pair("type_script_hash", &hash)
                .append_pair("limit", &PAGE_LIMIT.to_string());
            if let Some(cursor) = cursor.as_deref() {
                query.append_pair("cursor", cursor);
            }
        }
        let page: CursorPage<GalaxyCellResponse> =
            fetch_json(client, url, "live Cell tail").await?;
        validate_page_size(page.data.len(), PAGE_LIMIT, "live Cell tail")?;
        requests += 1;
        for cell in page.data {
            if cell.type_script_hash.as_deref() != Some(hash.as_str()) {
                continue;
            }
            let candidate = candidate(
                cell.tx_hash,
                cell.output_index,
                cell.capacity,
                cell.created_at_block,
                "live Cell",
            )?;
            // As above: the anchor rejects before the tail claims.
            if candidate.birth_block > max_birth_block {
                continue;
            }
            if found.len() >= want {
                break; // as above: never claim what is not delivered
            }
            if tail.emitted.insert(candidate.out_point.clone()) {
                found.push(candidate);
            }
        }
        let group = &mut tail.typed_groups[index];
        if page.has_more {
            group.cursor = Some(next_cursor(page.next_cursor, "live Cell tail")?);
        } else {
            group.exhausted = true;
        }
    }
    Ok(())
}

fn overfetch(target: usize) -> usize {
    target
        .saturating_mul(CANDIDATE_OVERFETCH_NUMERATOR)
        .div_ceil(CANDIDATE_OVERFETCH_DENOMINATOR)
}

async fn discover_dao(
    client: &reqwest::Client,
    api_base: &Url,
    desired: usize,
    seen: &mut HashSet<OutPoint>,
) -> ClassWalk {
    let mut candidates = Vec::with_capacity(desired);
    let stopped_by = walk_dao(client, api_base, desired, seen, &mut candidates)
        .await
        .err();

    candidates.sort_by(|left, right| {
        right
            .capacity
            .cmp(&left.capacity)
            .then_with(|| right.birth_block.cmp(&left.birth_block))
            .then_with(|| left.out_point.tx_hash.cmp(&right.out_point.tx_hash))
            .then_with(|| left.out_point.index.cmp(&right.out_point.index))
    });
    candidates.truncate(desired);
    ClassWalk {
        candidates,
        stopped_by,
    }
}

/// The DAO walk itself. Kept `Result`-shaped so a page failure stops the
/// walk exactly where it happened, leaving the caller holding every
/// candidate collected up to that point.
async fn walk_dao(
    client: &reqwest::Client,
    api_base: &Url,
    desired: usize,
    seen: &mut HashSet<OutPoint>,
    candidates: &mut Vec<GalaxyCellCandidate>,
) -> anyhow::Result<()> {
    let mut cursor = None;

    while candidates.len() < desired {
        let mut url = endpoint(api_base, "dao/deposits")?;
        {
            let mut query = url.query_pairs_mut();
            query
                .append_pair("status", "0")
                .append_pair("limit", &PAGE_LIMIT.to_string());
            if let Some(cursor) = cursor.as_deref() {
                query.append_pair("cursor", cursor);
            }
        }
        let page: CursorPage<DaoDepositResponse> = fetch_json(client, url, "DAO deposits").await?;
        validate_page_size(page.data.len(), PAGE_LIMIT, "DAO deposits")?;

        for deposit in page.data {
            if deposit.status != "deposited" {
                continue;
            }
            let candidate = candidate(
                deposit.tx_hash,
                deposit.output_index,
                deposit.capacity,
                deposit.deposit_block_number,
                "DAO deposit",
            )?;
            if seen.insert(candidate.out_point.clone()) {
                candidates.push(candidate);
            }
        }
        if candidates.len() >= desired || !page.has_more {
            break;
        }
        cursor = Some(next_cursor(page.next_cursor, "DAO deposits")?);
    }

    Ok(())
}

/// The typed class's head: the leading assets by owned capacity, which
/// define the groups the walk then pages through. Without it there are no
/// groups to walk, so a failure here is a class that collected nothing.
async fn top_asset_hashes(client: &reqwest::Client, api_base: &Url) -> anyhow::Result<Vec<String>> {
    let mut url = endpoint(api_base, "assets")?;
    url.query_pairs_mut()
        .append_pair("limit", &ASSET_GROUP_LIMIT.to_string())
        .append_pair("sort_key", "capacity")
        .append_pair("sort_direction", "desc");
    let assets: CursorPage<GalaxyAssetResponse> = fetch_json(client, url, "top assets").await?;
    validate_page_size(assets.data.len(), ASSET_GROUP_LIMIT, "top assets")?;
    Ok(assets
        .data
        .into_iter()
        .map(|asset| asset.id)
        .filter(|hash| is_hash32(hash))
        .collect())
}

/// One row of ckbadger's capacity-ranked inventory, reduced to the two
/// things a composition needs from it: where the asset's cells are, and how
/// much of the typed budget it has earned.
///
/// The roster IS this ranking (D1) — `GET /assets?sort_key=capacity` is the
/// same page the inventory UI shows, so the stage's typed class becomes that
/// page read top to bottom. Rank order is the vector's order.
// Built here, consumed by the weighted walk (T4).
#[allow(dead_code)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RankedAsset {
    /// Whatever ckbadger keys this asset by — a type-script hash for a token
    /// contract, a cluster id for spore, a collection id for m-nft and
    /// identity. Only [`AssetStandard`] knows which, and reading every one of
    /// them as a script hash is exactly what starved the old walk: for 40 of
    /// 64 groups `cells/live?type_script_hash=<id>` answered `{"data":[]}`
    /// with HTTP 200, which is a success carrying nothing.
    pub(crate) id: String,
    pub(crate) standard: AssetStandard,
    /// Shannons of live capacity the asset occupies. The weight the typed
    /// budget is divided by, never a display figure.
    pub(crate) owned_capacity: u64,
}

/// How an asset's live cells are reached (D3). The row's
/// `(assetType, standard)` pair decides it.
///
/// `assetType` carries the routing; `standard` only disambiguates inside
/// `object` and `identity`. A token standard cknerv has never heard of still
/// keys its cells by a type-script hash, so routing every `token` row to the
/// contract pager is the honest reading — not a guess.
// Built here, consumed by the weighted walk (T4).
#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum AssetStandard {
    /// `args` is the issuer, so one contract is one type script covering
    /// thousands of cells: `cells/live?type_script_hash=<id>` pages it.
    Token,
    /// `id` is a cluster id. Items come from `/spore/clusters/{id}/spores`
    /// and each item's `sporeId` is its own script's `args`.
    Spore,
    /// `id` is a collection id. Items come from `/assets/objects/{id}/items`
    /// and each item's `nftId` is its `args`.
    MNft,
    /// `id` is a synthetic ASCII collection id addressing nothing on chain
    /// (`0x646f746269745f…` is `"dotbit_collection"` in hex). What pages the
    /// cells is the family's `(code_hash, hash_type)`, which only the census
    /// knows.
    Identity(IdentityStandard),
}

/// The three identity collections ckbadger publishes, each 1:1 with one
/// script family.
///
/// Spellings are ckbadger's own, probed live on 2026-08-23: `dotbit`,
/// `bit_cell`, `did_ckb`. `did_ckb` is only visible through
/// `/assets?type=identity` — it holds zero capacity, so it never reaches the
/// top-64 page — and its underscore spelling is not the `did` an earlier
/// draft assumed.
// Built here, consumed by the weighted walk (T4).
#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum IdentityStandard {
    DotBit,
    BitCell,
    DidCkb,
}

// Built here, consumed by the weighted walk (T4).
#[allow(dead_code)]
impl AssetStandard {
    /// The routing decision, or `None` for a pair with no mechanism behind
    /// it.
    ///
    /// There is deliberately no `Unsupported` variant: an asset cknerv cannot
    /// reach must not reach the roster at all, because the roster's whole
    /// second job is to be the denominator of the weighted split (D4). A row
    /// that can never yield a cell but still holds capacity would silently
    /// shrink every other asset's share.
    fn classify(asset_type: &str, standard: &str) -> Option<Self> {
        Some(match (asset_type, standard) {
            ("token", _) => Self::Token,
            ("object", "spore") => Self::Spore,
            ("object", "m-nft") => Self::MNft,
            ("identity", "dotbit") => Self::Identity(IdentityStandard::DotBit),
            ("identity", "bit_cell") => Self::Identity(IdentityStandard::BitCell),
            ("identity", "did_ckb") => Self::Identity(IdentityStandard::DidCkb),
            _ => return None,
        })
    }
}

/// The typed class's head: ckbadger's inventory ranked by occupied capacity,
/// one page, in the index's own order.
///
/// A row cknerv cannot route, cannot address, or whose weight will not parse
/// is dropped with a `warn!` naming it — never in silence. The old head
/// filtered eleven m-nft collections through `is_hash32` without a word,
/// which is why the gap took a live measurement to find rather than a log
/// line to read.
// Built here, consumed by the weighted walk (T4).
#[allow(dead_code)]
pub(crate) async fn ranked_assets(
    client: &reqwest::Client,
    api_base: &Url,
) -> anyhow::Result<Vec<RankedAsset>> {
    let mut url = endpoint(api_base, "assets")?;
    url.query_pairs_mut()
        .append_pair("limit", &ASSET_GROUP_LIMIT.to_string())
        .append_pair("sort_key", "capacity")
        .append_pair("sort_direction", "desc");
    let assets: CursorPage<RankedAssetResponse> = fetch_json(client, url, "ranked assets").await?;
    validate_page_size(assets.data.len(), ASSET_GROUP_LIMIT, "ranked assets")?;

    let mut roster = Vec::with_capacity(assets.data.len());
    for asset in assets.data {
        let Some(standard) = AssetStandard::classify(&asset.asset_type, &asset.standard) else {
            tracing::warn!(
                target: "cknerv-adapter-ckbadger",
                asset_type = %asset.asset_type,
                standard = %asset.standard,
                "the inventory ranked an asset cknerv has no way to reach; \
                 it is excluded from the roster and from the split"
            );
            continue;
        };
        // A token's id must be a script hash, because that is the request it
        // becomes. The other three families are addressed by collection id,
        // which is 24 bytes for m-nft and ASCII for identity — `is_hash32`
        // gating the whole roster is what dropped them before the first
        // request.
        let addressable = match standard {
            AssetStandard::Token => is_hash32(&asset.id),
            _ => is_collection_id(&asset.id),
        };
        if !addressable {
            tracing::warn!(
                target: "cknerv-adapter-ckbadger",
                asset_type = %asset.asset_type,
                standard = %asset.standard,
                "the inventory ranked an asset with an unusable id; \
                 it is excluded from the roster and from the split"
            );
            continue;
        }
        let Ok(owned_capacity) = asset.owned_capacity.parse::<u64>() else {
            tracing::warn!(
                target: "cknerv-adapter-ckbadger",
                asset_type = %asset.asset_type,
                standard = %asset.standard,
                owned_capacity = %asset.owned_capacity,
                "the inventory ranked an asset whose occupied capacity will not \
                 parse; it is excluded from the roster and from the split"
            );
            continue;
        };
        roster.push(RankedAsset {
            id: asset.id,
            standard,
            owned_capacity,
        });
    }
    Ok(roster)
}

/// A collection id is `0x` + an even number of hex digits, at most 32 bytes.
///
/// Looser than [`is_hash32`] because these ids are not hashes — an m-nft
/// collection is 24 bytes, `.bit`'s is a padded ASCII string — and stricter
/// than "any string" because the id is spliced into a URL **path**, where a
/// separator or a dot segment would address something other than the
/// collection.
// Built here, consumed by the weighted walk (T4).
#[allow(dead_code)]
fn is_collection_id(value: &str) -> bool {
    let Some(body) = value.strip_prefix("0x") else {
        return false;
    };
    !body.is_empty()
        && body.len() <= 64
        && body.len() % 2 == 0
        && body.as_bytes().iter().all(u8::is_ascii_hexdigit)
}

// ── collections: items, and the cells behind them ─────────────────

/// How many item pages one collection walk may read per call. Bounded like
/// every other walk here; the cursors that make a later call resume deeper
/// arrive with the top-up parity work (T5).
#[allow(dead_code)] // read by the weighted walk (T4)
const ITEM_PAGES_PER_GROUP: usize = 3;

/// Molecule `hash_type` discriminants — the chain's own byte, which is what
/// goes into a script's hash preimage. Not the JSON-RPC spelling
/// (`data`/`type`/`data1`/`data2`) that the same value takes on the wire.
const MOLECULE_HASH_TYPE_TYPE: u8 = 1;
const MOLECULE_HASH_TYPE_DATA1: u8 = 2;

/// A deployed script version: the pair an item's own type script is built
/// from.
///
/// `hash_type` is the molecule discriminant rather than [`HashType`] because
/// this byte is hashed, and a spelling is not a byte.
#[allow(dead_code)] // read by the weighted walk (T4)
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct DeployedScript {
    code_hash: &'static str,
    hash_type: u8,
}

/// Every deployed Spore version cknerv knows, newest first.
///
/// Duplicated on purpose from `cknerv-adapter-ckb`'s
/// `script_taxonomy::classify_asset` Spore arm — the two adapters must not
/// depend on each other, and the cost of the lists drifting apart is bounded:
/// a version missing here costs one cluster one composition, and its items
/// still reach the stage through block-following. Keep them in step when
/// either changes.
///
/// A cluster does not say which version its items use, so the walk tries
/// these against the cluster's first item and caches whichever answers
/// (D3).
const SPORE_VERSIONS: &[DeployedScript] = &[
    DeployedScript {
        code_hash: "0x4a4dce1df3dffff7f8b2cd7dff7303df3b6150c9788cb75dcf6747247132b9f5",
        hash_type: MOLECULE_HASH_TYPE_DATA1,
    },
    DeployedScript {
        code_hash: "0x7366a61534fa7c7e6225ecc0d828ea3b5366adec2b58206f2ee84995fe030075",
        hash_type: MOLECULE_HASH_TYPE_DATA1,
    },
    DeployedScript {
        code_hash: "0xbbad126377d45f90a8ee120da988a2d7332c78ba8fd679aab478a19d6c133494",
        hash_type: MOLECULE_HASH_TYPE_DATA1,
    },
    DeployedScript {
        code_hash: "0x598d793defef36e2eeba54a9b45130e4ca92822e1d193671f490950c3b856080",
        hash_type: MOLECULE_HASH_TYPE_DATA1,
    },
    DeployedScript {
        code_hash: "0x685a60219309029d01310311dba953d67029170ca4848a4ff638e57002130a0d",
        hash_type: MOLECULE_HASH_TYPE_DATA1,
    },
    DeployedScript {
        code_hash: "0x0bbe768b519d8ea7b96d58f1182eb7e6ef96c541fbd9526975077ee09f049058",
        hash_type: MOLECULE_HASH_TYPE_DATA1,
    },
    DeployedScript {
        code_hash: "0x0b1f412fbae26853ff7d082d422c2bdd9e2ff94ee8aaec11240a5b34cc6e890f",
        hash_type: MOLECULE_HASH_TYPE_TYPE,
    },
    DeployedScript {
        code_hash: "0xcfba73b58b6f30e70caed8a999748781b164ef9a1e218424a6fb55ebf641cb33",
        hash_type: MOLECULE_HASH_TYPE_TYPE,
    },
];

/// The deployed M-NFT versions. One today, mainnet, verified live on
/// 2026-08-23; the walk runs the same discovery loop over it, so a testnet
/// deployment is one entry away.
const MNFT_VERSIONS: &[DeployedScript] = &[DeployedScript {
    code_hash: "0x2b24f0d644ccbdd77bbf86b27c8cca02efa0ad051e447c212636d9ee7acaaec9",
    hash_type: MOLECULE_HASH_TYPE_TYPE,
}];

/// A script's hash: blake2b-256 under the `ckb-default-hash` personalization
/// over the molecule-serialized `Script` table.
///
/// This is the one piece of chain arithmetic in the adapter, and it earns its
/// place. For item-keyed families — Spore, M-NFT — the `args` are the item's
/// own id, so every item has its own type script and its hash addresses that
/// item's CURRENT live cell through `cells/live`, transfers and all. The
/// index cannot answer that question: an item row carries the MINT
/// transaction, and ckbadger stores no output index for spore objects at all.
///
/// The table is three fields — `code_hash: Byte32`, `hash_type: byte`,
/// `args: Bytes` — so the header is a full size and three offsets, and only
/// the last field's length varies.
fn type_script_hash_for(code_hash: &[u8; 32], hash_type_molecule: u8, args: &[u8]) -> String {
    const HEADER: usize = 4 + 4 * 3; // full_size, then one offset per field
    let offsets = [
        HEADER,
        HEADER + code_hash.len(),
        HEADER + code_hash.len() + 1,
    ];
    // A molecule `Bytes` is its own length followed by the raw bytes.
    let full_size = offsets[2] + 4 + args.len();

    let mut table = Vec::with_capacity(full_size);
    table.extend_from_slice(&(full_size as u32).to_le_bytes());
    for offset in offsets {
        table.extend_from_slice(&(offset as u32).to_le_bytes());
    }
    table.extend_from_slice(code_hash);
    table.push(hash_type_molecule);
    table.extend_from_slice(&(args.len() as u32).to_le_bytes());
    table.extend_from_slice(args);
    debug_assert_eq!(table.len(), full_size);

    let mut digest = [0u8; 32];
    let mut hasher = blake2b_ref::Blake2bBuilder::new(32)
        .personal(b"ckb-default-hash")
        .build();
    hasher.update(&table);
    hasher.finalize(&mut digest);
    hex_with_prefix(&digest)
}

/// `0x`-prefixed lowercase hex, the form every hash on this wire takes.
fn hex_with_prefix(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(2 + bytes.len() * 2);
    out.push_str("0x");
    for byte in bytes {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

/// Reads `0x`-prefixed hex into bytes. `None` for anything that is not an
/// even run of hex digits — the index's strings are input, not truth.
fn hex_bytes(value: &str) -> Option<Vec<u8>> {
    let body = value.strip_prefix("0x")?;
    if body.len() % 2 != 0 {
        return None;
    }
    (0..body.len() / 2)
        .map(|i| u8::from_str_radix(body.get(i * 2..i * 2 + 2)?, 16).ok())
        .collect()
}

fn hash32_bytes(value: &str) -> Option<[u8; 32]> {
    let bytes = hex_bytes(value)?;
    <[u8; 32]>::try_from(bytes.as_slice()).ok()
}

/// What one collection's walk produced, and what stopped it.
///
/// [`ClassWalk`]'s shape one level down, for the same reason: a page that
/// fails stops this collection where it stands, and everything already
/// resolved is worth exactly what it would have been worth had the next page
/// answered. `melted` is not an error — it is how many items no longer had a
/// live cell by the time the walk asked, which is the difference between a
/// short collection and a broken one.
#[allow(dead_code)] // read by the weighted walk (T4)
#[derive(Default)]
pub(crate) struct GroupWalk {
    pub(crate) candidates: Vec<GalaxyCellCandidate>,
    pub(crate) melted: usize,
    pub(crate) stopped_by: Option<anyhow::Error>,
}

/// One row of a collection's item list, reduced to the `args` of the item's
/// own type script. `None` for an item that is no longer live.
trait CollectionRow {
    fn live_args(self) -> Option<String>;
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SporeItemResponse {
    /// The spore's type-script `args`, which is also its identity.
    spore_id: String,
}

impl CollectionRow for SporeItemResponse {
    fn live_args(self) -> Option<String> {
        // `/spore/clusters/{id}/spores` filters to live spores server-side,
        // so every row that arrives here is one.
        Some(self.spore_id)
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ObjectItemResponse {
    /// The item's type-script `args` — 28 bytes for M-NFT.
    nft_id: String,
    /// Unlike the spore list, this one serves dead rows too, so the filter
    /// is this walk's job. A row that does not say defaults to dead: an item
    /// the index will not call live is not one to spend a lookup on.
    #[serde(default)]
    is_live: bool,
}

impl CollectionRow for ObjectItemResponse {
    fn live_args(self) -> Option<String> {
        self.is_live.then_some(self.nft_id)
    }
}

/// Pages one collection's item list, appending each live item's `args`.
///
/// `Result`-shaped so a failing page stops the collection exactly where it
/// happened, leaving the caller holding every item read up to that point.
async fn walk_collection_items<T: DeserializeOwned + CollectionRow>(
    client: &reqwest::Client,
    api_base: &Url,
    path: &str,
    max_pages: usize,
    subject: &str,
    args: &mut Vec<String>,
) -> anyhow::Result<()> {
    let mut cursor: Option<String> = None;
    for _ in 0..max_pages {
        let mut url = endpoint(api_base, path)?;
        {
            let mut query = url.query_pairs_mut();
            query.append_pair("limit", &PAGE_LIMIT.to_string());
            if let Some(cursor) = cursor.as_deref() {
                query.append_pair("cursor", cursor);
            }
        }
        let page: CursorPage<T> = fetch_json(client, url, subject).await?;
        validate_page_size(page.data.len(), PAGE_LIMIT, subject)?;
        for row in page.data {
            if let Some(item_args) = row.live_args() {
                args.push(item_args);
            }
        }
        if !page.has_more {
            break;
        }
        cursor = Some(next_cursor(page.next_cursor, subject)?);
    }
    Ok(())
}

/// One item's current live cell, or `None` if the item has melted.
///
/// `limit=1` because an item-keyed script addresses exactly one cell: the
/// hash is a row key, not a group key (D2).
async fn resolve_item_cell(
    client: &reqwest::Client,
    api_base: &Url,
    type_script_hash: &str,
    subject: &str,
) -> anyhow::Result<Option<GalaxyCellCandidate>> {
    let mut url = endpoint(api_base, "cells/live")?;
    url.query_pairs_mut()
        .append_pair("type_script_hash", type_script_hash)
        .append_pair("limit", "1");
    let page: CursorPage<GalaxyCellResponse> = fetch_json(client, url, subject).await?;
    validate_page_size(page.data.len(), 1, subject)?;
    let Some(cell) = page.data.into_iter().next() else {
        return Ok(None);
    };
    if cell.type_script_hash.as_deref() != Some(type_script_hash) {
        return Ok(None);
    }
    // Everything the candidate carries comes from THIS row. The item row's
    // own transaction is the mint — measured live on an M-NFT item whose
    // list entry claimed block 6,140,203 while its live cell was born at
    // 13,889,070 — and a spore item carries no output index at all.
    Ok(Some(candidate(
        cell.tx_hash,
        cell.output_index,
        cell.capacity,
        cell.created_at_block,
        "collection item cell",
    )?))
}

/// Turns a collection's items into candidates, one lookup each, discovering
/// the collection's deployed script version on the way.
///
/// The version is discovered rather than declared: a cluster does not say
/// which Spore deployment its items use, so the first item that resolves
/// under any candidate settles it for the rest of the collection. An item
/// that resolves under none is indistinguishable from one that melted, so
/// discovery simply moves on to the next item — a collection whose whole
/// prefix has burned still finds its version at the first survivor.
async fn resolve_collection_items(
    client: &reqwest::Client,
    api_base: &Url,
    args: &[String],
    versions: &[DeployedScript],
    settled: &mut Option<DeployedScript>,
    subject: &str,
    walk: &mut GroupWalk,
) -> anyhow::Result<()> {
    for item_args in args {
        let Some(item_args) = hex_bytes(item_args) else {
            // An id that is not hex is not an `args`; it cannot address a
            // cell, and one bad row is not a reason to abandon the rest.
            walk.melted += 1;
            continue;
        };
        let attempts: &[DeployedScript] = match settled.as_ref() {
            Some(version) => std::slice::from_ref(version),
            None => versions,
        };
        let mut resolved = None;
        for version in attempts {
            let Some(code_hash) = hash32_bytes(version.code_hash) else {
                continue;
            };
            let hash = type_script_hash_for(&code_hash, version.hash_type, &item_args);
            if let Some(found) = resolve_item_cell(client, api_base, &hash, subject).await? {
                *settled = Some(*version);
                resolved = Some(found);
                break;
            }
        }
        match resolved {
            Some(found) => walk.candidates.push(found),
            None => walk.melted += 1,
        }
    }
    Ok(())
}

/// Every live cell the walk can reach for one Spore cluster.
///
/// `settled` is the cluster's discovered script version, carried in by the
/// caller so a second call skips discovery entirely.
#[allow(dead_code)] // called by the weighted walk (T4)
pub(crate) async fn fetch_spore_group(
    client: &reqwest::Client,
    api_base: &Url,
    cluster_id: &str,
    settled: &mut Option<DeployedScript>,
    max_pages: usize,
) -> GroupWalk {
    fetch_collection_group(
        client,
        api_base,
        &format!("spore/clusters/{cluster_id}/spores"),
        SPORE_FAMILY,
        settled,
        max_pages,
    )
    .await
}

/// Every live cell the walk can reach for one M-NFT collection.
#[allow(dead_code)] // called by the weighted walk (T4)
pub(crate) async fn fetch_mnft_group(
    client: &reqwest::Client,
    api_base: &Url,
    collection_id: &str,
    settled: &mut Option<DeployedScript>,
    max_pages: usize,
) -> GroupWalk {
    fetch_collection_group(
        client,
        api_base,
        &format!("assets/objects/{collection_id}/items"),
        MNFT_FAMILY,
        settled,
        max_pages,
    )
    .await
}

/// Which item list a collection is paged through. The row shapes differ; the
/// per-item resolution after them does not.
#[derive(Clone, Copy)]
enum CollectionKind {
    Spore,
    Object,
}

/// Everything that differs between the two collection families, so the walk
/// below can be written once.
#[derive(Clone, Copy)]
struct CollectionFamily {
    kind: CollectionKind,
    versions: &'static [DeployedScript],
    subject: &'static str,
}

const SPORE_FAMILY: CollectionFamily = CollectionFamily {
    kind: CollectionKind::Spore,
    versions: SPORE_VERSIONS,
    subject: "spore cluster items",
};

const MNFT_FAMILY: CollectionFamily = CollectionFamily {
    kind: CollectionKind::Object,
    versions: MNFT_VERSIONS,
    subject: "object collection items",
};

async fn fetch_collection_group(
    client: &reqwest::Client,
    api_base: &Url,
    path: &str,
    family: CollectionFamily,
    settled: &mut Option<DeployedScript>,
    max_pages: usize,
) -> GroupWalk {
    let CollectionFamily {
        kind,
        versions,
        subject,
    } = family;
    let mut walk = GroupWalk::default();
    let mut args = Vec::new();
    let listed = match kind {
        CollectionKind::Spore => {
            walk_collection_items::<SporeItemResponse>(
                client, api_base, path, max_pages, subject, &mut args,
            )
            .await
        }
        CollectionKind::Object => {
            walk_collection_items::<ObjectItemResponse>(
                client, api_base, path, max_pages, subject, &mut args,
            )
            .await
        }
    };
    // Items already listed are still worth resolving even if the page after
    // them failed — the same rule the class walks obey, one level down.
    walk.stopped_by = listed.err();
    if let Err(error) = resolve_collection_items(
        client, api_base, &args, versions, settled, subject, &mut walk,
    )
    .await
    {
        walk.stopped_by.get_or_insert(error);
    }
    report_collection_walk(path, args.len(), &walk);
    walk
}

/// What a collection walk found, said once per collection.
///
/// A few melted items are ordinary attrition and belong at `debug`. A
/// collection that listed items and resolved NONE of them is the shape a
/// stale version list takes — the pinned deployments no longer include the
/// one this collection uses — and that is worth a `warn`, because it is the
/// difference between a collection the stage is sampling thinly and one it
/// cannot see at all.
fn report_collection_walk(path: &str, listed: usize, walk: &GroupWalk) {
    if listed > 0 && walk.candidates.is_empty() {
        tracing::warn!(
            target: "cknerv-adapter-ckbadger",
            collection = %path,
            listed,
            "a collection listed items but not one of them resolved to a live cell; \
             its deployed script version may not be among the pinned ones"
        );
    } else if walk.melted > 0 {
        tracing::debug!(
            target: "cknerv-adapter-ckbadger",
            collection = %path,
            listed,
            resolved = walk.candidates.len(),
            melted = walk.melted,
            "collection items that no longer had a live cell were skipped"
        );
    }
}

// ── identity: the family behind a collection ──────────────────────

/// The script family each identity collection stands for, by the name the
/// registry gives it.
///
/// ckbadger has no collection → code hash route (probed: `/scripts/{id}`
/// 404, `/cells/by-script?family_id=` 400), and the collection ids are
/// synthetic ASCII. What does know the pair is the census: cknerv has already
/// observed these scripts on stage, and the registry can name them. Names are
/// ckbadger's catalogue spellings, read live on 2026-08-23.
fn identity_standard_for_name(name: &str) -> Option<IdentityStandard> {
    match name {
        ".bit Account" => Some(IdentityStandard::DotBit),
        ".bit Cell" => Some(IdentityStandard::BitCell),
        "did:ckb" => Some(IdentityStandard::DidCkb),
        _ => None,
    }
}

/// Joins the census against the registry: which `(code_hash, hash_type)` each
/// identity collection means.
///
/// Pure, and pure on purpose — the census and the name lookup both live in
/// `source.rs`, and this is the only part of the question worth testing.
/// `name_of` answers for a `0x`-prefixed code hash.
///
/// A family with several deployed versions on stage contributes the first the
/// census reports; the walk pages one version per composition and the others
/// keep reaching the stage the way they do today, through block-following.
/// A standard absent from the result is one this composition cannot page —
/// the cold-start case (R1), where the census has not yet seen the family.
#[allow(dead_code)] // called by the weighted walk (T4)
pub(crate) fn identity_families(
    observed: &[ScriptId],
    name_of: impl Fn(&str) -> Option<&str>,
) -> HashMap<IdentityStandard, ScriptId> {
    let mut families = HashMap::new();
    for script in observed {
        if script.is_unset() {
            continue;
        }
        let code_hash = script.code_hash_hex();
        let Some(name) = name_of(&code_hash) else {
            continue;
        };
        let Some(standard) = identity_standard_for_name(name) else {
            continue;
        };
        families.entry(standard).or_insert(*script);
    }
    families
}

/// One row of `/cells/by-script`. The live-cell shape plus the two fields
/// that say what actually matched.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ByScriptCellResponse {
    tx_hash: String,
    output_index: i32,
    capacity: String,
    created_at_block: i64,
    type_code_hash: Option<String>,
    matched_script_kind: Option<String>,
}

/// Every live cell of one identity family, paged by its script.
///
/// `.bit Account`'s 6,310 live cells all share ONE type script — `args` is
/// the account, but the script is the family — so there is no item list to
/// walk and no hash to compute: these rows ARE the live cells (D2).
///
/// `/cells/by-script` matches lock OR type, so `script_kind=type` is asked
/// for AND re-checked per row, alongside the code hash. An index that ignored
/// the parameter would otherwise hand the typed class a page of lock matches,
/// and unknown query parameters here are ignored in silence.
#[allow(dead_code)] // called by the weighted walk (T4)
pub(crate) async fn fetch_identity_group(
    client: &reqwest::Client,
    api_base: &Url,
    family: &ScriptId,
    max_pages: usize,
) -> GroupWalk {
    let mut walk = GroupWalk::default();
    walk.stopped_by =
        walk_identity_family(client, api_base, family, max_pages, &mut walk.candidates)
            .await
            .err();
    walk
}

async fn walk_identity_family(
    client: &reqwest::Client,
    api_base: &Url,
    family: &ScriptId,
    max_pages: usize,
    candidates: &mut Vec<GalaxyCellCandidate>,
) -> anyhow::Result<()> {
    let code_hash = family.code_hash_hex();
    let mut cursor: Option<String> = None;
    for _ in 0..max_pages {
        let mut url = endpoint(api_base, "cells/by-script")?;
        {
            let mut query = url.query_pairs_mut();
            query
                .append_pair("code_hash", &code_hash)
                // CKB's JSON-RPC spelling, which is what this endpoint reads
                // and what `HashType` already serializes to.
                .append_pair("hash_type", hash_type_wire(family.hash_type).as_str())
                .append_pair("script_kind", "type")
                .append_pair("limit", &PAGE_LIMIT.to_string());
            if let Some(cursor) = cursor.as_deref() {
                query.append_pair("cursor", cursor);
            }
        }
        let page: CursorPage<ByScriptCellResponse> =
            fetch_json(client, url, "identity family cells").await?;
        validate_page_size(page.data.len(), PAGE_LIMIT, "identity family cells")?;
        for cell in page.data {
            if cell.matched_script_kind.as_deref() != Some("type")
                || cell.type_code_hash.as_deref() != Some(code_hash.as_str())
            {
                continue;
            }
            candidates.push(candidate(
                cell.tx_hash,
                cell.output_index,
                cell.capacity,
                cell.created_at_block,
                "identity family cell",
            )?);
        }
        if !page.has_more {
            break;
        }
        cursor = Some(next_cursor(page.next_cursor, "identity family cells")?);
    }
    Ok(())
}

async fn discover_typed(
    client: &reqwest::Client,
    api_base: &Url,
    desired: usize,
    seen: &mut HashSet<OutPoint>,
) -> ClassWalk {
    if desired == 0 {
        return ClassWalk::default();
    }
    let asset_hashes = match top_asset_hashes(client, api_base).await {
        Ok(hashes) => hashes,
        Err(error) => return ClassWalk::stopped(error),
    };

    let results: Vec<_> = stream::iter(asset_hashes.into_iter().enumerate().map(
        |(rank, type_script_hash)| async move {
            let cells = fetch_live_group(
                client,
                api_base,
                "type_script_hash",
                &type_script_hash,
                LiveClass::Typed(&type_script_hash),
                TYPED_CELL_PAGES_PER_GROUP,
            )
            .await?;
            Ok::<_, anyhow::Error>((rank, cells))
        },
    ))
    .buffer_unordered(GROUP_FETCH_CONCURRENCY)
    .collect::<Vec<_>>()
    .await;
    let (mut groups, stopped_by) = partition_groups(results);
    groups.sort_by_key(|(rank, _)| *rank);

    ClassWalk {
        candidates: interleave_groups(
            groups.into_iter().map(|(_, group)| group).collect(),
            desired,
            seen,
        ),
        stopped_by,
    }
}

/// Keep the groups that answered and remember the first failure. One
/// unreadable asset or address is a thinner sample of the class, not a
/// reason to abandon every group that was read.
fn partition_groups(
    results: Vec<anyhow::Result<(usize, Vec<GalaxyCellCandidate>)>>,
) -> (
    Vec<(usize, Vec<GalaxyCellCandidate>)>,
    Option<anyhow::Error>,
) {
    let mut groups = Vec::with_capacity(results.len());
    let mut stopped_by: Option<anyhow::Error> = None;
    for result in results {
        match result {
            Ok(group) => groups.push(group),
            Err(error) => {
                if stopped_by.is_none() {
                    stopped_by = Some(error);
                }
            }
        }
    }
    (groups, stopped_by)
}

async fn discover_plain(
    client: &reqwest::Client,
    api_base: &Url,
    desired: usize,
    seen: &mut HashSet<OutPoint>,
) -> ClassWalk {
    if desired == 0 {
        return ClassWalk::default();
    }
    let address_hashes = match plain_address_hashes(client, api_base).await {
        Ok(hashes) => hashes,
        Err(error) => return ClassWalk::stopped(error),
    };

    let results: Vec<_> = stream::iter(address_hashes.into_iter().enumerate().map(
        |(rank, lock_script_hash)| async move {
            let cells = fetch_live_group(
                client,
                api_base,
                "lock_script_hash",
                &lock_script_hash,
                LiveClass::Plain(&lock_script_hash),
                PLAIN_CELL_PAGES_PER_GROUP,
            )
            .await?;
            Ok::<_, anyhow::Error>((rank, cells))
        },
    ))
    .buffer_unordered(GROUP_FETCH_CONCURRENCY)
    .collect::<Vec<_>>()
    .await;
    let (mut groups, stopped_by) = partition_groups(results);
    groups.sort_by_key(|(rank, _)| *rank);

    ClassWalk {
        candidates: interleave_groups(
            groups.into_iter().map(|(_, group)| group).collect(),
            desired,
            seen,
        ),
        stopped_by,
    }
}

/// The plain class's head: the addresses whose live Cells the walk pages
/// through, drawn from both the largest holders and the recently active.
async fn plain_address_hashes(
    client: &reqwest::Client,
    api_base: &Url,
) -> anyhow::Result<Vec<String>> {
    let mut top_url = endpoint(api_base, "addresses/top")?;
    top_url
        .query_pairs_mut()
        .append_pair("limit", &ADDRESS_GROUP_LIMIT.to_string());
    let mut active_url = endpoint(api_base, "addresses/active")?;
    active_url
        .query_pairs_mut()
        .append_pair("limit", &ADDRESS_GROUP_LIMIT.to_string())
        .append_pair("days", "30");
    let (top, active) = tokio::try_join!(
        fetch_json::<Vec<GalaxyAddressResponse>>(client, top_url, "top addresses"),
        fetch_json::<Vec<GalaxyAddressResponse>>(client, active_url, "active addresses")
    )?;
    validate_page_size(top.len(), ADDRESS_GROUP_LIMIT, "top addresses")?;
    validate_page_size(active.len(), ADDRESS_GROUP_LIMIT, "active addresses")?;

    let mut address_hashes = Vec::with_capacity(top.len() + active.len());
    let mut known_addresses = HashSet::with_capacity(top.len() + active.len());
    for address in top.into_iter().chain(active) {
        if is_hash32(&address.lock_script_hash)
            && known_addresses.insert(address.lock_script_hash.clone())
        {
            address_hashes.push(address.lock_script_hash);
        }
    }
    Ok(address_hashes)
}

#[derive(Clone, Copy)]
enum LiveClass<'a> {
    Typed(&'a str),
    Plain(&'a str),
}

async fn fetch_live_group(
    client: &reqwest::Client,
    api_base: &Url,
    filter_name: &str,
    filter_value: &str,
    class: LiveClass<'_>,
    max_pages: usize,
) -> anyhow::Result<Vec<GalaxyCellCandidate>> {
    let mut group = Vec::with_capacity(PAGE_LIMIT.saturating_mul(max_pages));
    let mut cursor = None;
    for _ in 0..max_pages {
        let mut url = endpoint(api_base, "cells/live")?;
        {
            let mut query = url.query_pairs_mut();
            query
                .append_pair(filter_name, filter_value)
                .append_pair("limit", &PAGE_LIMIT.to_string());
            if let Some(cursor) = cursor.as_deref() {
                query.append_pair("cursor", cursor);
            }
        }
        let page: CursorPage<GalaxyCellResponse> = fetch_json(client, url, "live Cells").await?;
        validate_page_size(page.data.len(), PAGE_LIMIT, "live Cells")?;

        for cell in page.data {
            let class_matches = match class {
                LiveClass::Typed(expected) => cell.type_script_hash.as_deref() == Some(expected),
                LiveClass::Plain(expected) => {
                    cell.type_script_hash.is_none() && cell.lock_script_hash == expected
                }
            };
            if !class_matches {
                continue;
            }
            group.push(candidate(
                cell.tx_hash,
                cell.output_index,
                cell.capacity,
                cell.created_at_block,
                "live Cell",
            )?);
        }
        if !page.has_more {
            break;
        }
        cursor = Some(next_cursor(page.next_cursor, "live Cells")?);
    }
    group.sort_by(|left, right| {
        right
            .capacity
            .cmp(&left.capacity)
            .then_with(|| right.birth_block.cmp(&left.birth_block))
            .then_with(|| left.out_point.tx_hash.cmp(&right.out_point.tx_hash))
            .then_with(|| left.out_point.index.cmp(&right.out_point.index))
    });
    Ok(group)
}

fn interleave_groups(
    groups: Vec<Vec<GalaxyCellCandidate>>,
    desired: usize,
    seen: &mut HashSet<OutPoint>,
) -> Vec<GalaxyCellCandidate> {
    let mut groups: Vec<VecDeque<_>> = groups.into_iter().map(VecDeque::from).collect();
    let mut selected = Vec::with_capacity(desired);
    while selected.len() < desired {
        let mut progressed = false;
        for group in &mut groups {
            while let Some(candidate) = group.pop_front() {
                if seen.insert(candidate.out_point.clone()) {
                    selected.push(candidate);
                    progressed = true;
                    break;
                }
            }
            if selected.len() >= desired {
                break;
            }
        }
        if !progressed {
            break;
        }
    }
    selected
}

fn candidate(
    tx_hash: String,
    output_index: i32,
    capacity: String,
    birth_block: i64,
    subject: &str,
) -> anyhow::Result<GalaxyCellCandidate> {
    if !is_hash32(&tx_hash) {
        return Err(anyhow!(
            "ckbadger returned an invalid {subject} transaction hash"
        ));
    }
    let index = u32::try_from(output_index)
        .with_context(|| format!("ckbadger returned an invalid {subject} output index"))?;
    let capacity = capacity
        .parse::<u64>()
        .with_context(|| format!("ckbadger returned an invalid {subject} capacity"))?;
    let birth_block = u64::try_from(birth_block)
        .with_context(|| format!("ckbadger returned an invalid {subject} birth block"))?;
    Ok(GalaxyCellCandidate {
        out_point: OutPoint { tx_hash, index },
        capacity,
        birth_block,
    })
}

async fn fetch_json<T: DeserializeOwned>(
    client: &reqwest::Client,
    url: Url,
    subject: &str,
) -> anyhow::Result<T> {
    let response = client
        .get(url)
        .send()
        .await
        .with_context(|| format!("fetch ckbadger {subject}"))?;
    if response.status() == StatusCode::NOT_FOUND {
        return Err(anyhow!("ckbadger {subject} endpoint is unavailable"));
    }
    if !response.status().is_success() {
        return Err(anyhow!(
            "ckbadger {subject} returned HTTP {}",
            response.status()
        ));
    }
    response
        .json()
        .await
        .with_context(|| format!("decode ckbadger {subject}"))
}

fn endpoint(api_base: &Url, relative: &str) -> anyhow::Result<Url> {
    api_base
        .join(relative)
        .with_context(|| format!("join ckbadger endpoint {relative:?}"))
}

fn validate_page_size(actual: usize, limit: usize, subject: &str) -> anyhow::Result<()> {
    if actual > limit {
        return Err(anyhow!(
            "ckbadger {subject} exceeded the requested page limit"
        ));
    }
    Ok(())
}

fn next_cursor(cursor: Option<String>, subject: &str) -> anyhow::Result<String> {
    let cursor = cursor
        .filter(|cursor| !cursor.is_empty() && cursor.len() <= 512)
        .ok_or_else(|| anyhow!("ckbadger {subject} omitted a bounded next cursor"))?;
    if cursor.chars().any(char::is_control) {
        return Err(anyhow!("ckbadger {subject} returned an invalid cursor"));
    }
    Ok(cursor)
}

fn is_hash32(value: &str) -> bool {
    value.len() == 66
        && value.starts_with("0x")
        && value.as_bytes()[2..].iter().all(u8::is_ascii_hexdigit)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CursorPage<T> {
    data: Vec<T>,
    #[serde(default)]
    has_more: bool,
    next_cursor: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DaoDepositResponse {
    tx_hash: String,
    output_index: i32,
    capacity: String,
    deposit_block_number: i64,
    status: String,
}

#[derive(Debug, Deserialize)]
struct GalaxyAssetResponse {
    id: String,
}

/// One inventory row, in full. Kept apart from [`GalaxyAssetResponse`] — which
/// reads the same endpoint for `id` alone — because the old walk's group key
/// stays in service until the weighted walk replaces it (T4).
#[allow(dead_code)] // read by the weighted walk (T4)
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RankedAssetResponse {
    id: String,
    asset_type: String,
    standard: String,
    /// A decimal string of shannons. ckbadger prints capacity as text
    /// everywhere, and the totals here run past what a JSON number carries
    /// exactly.
    owned_capacity: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GalaxyAddressResponse {
    lock_script_hash: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GalaxyCellResponse {
    tx_hash: String,
    output_index: i32,
    capacity: String,
    lock_script_hash: String,
    type_script_hash: Option<String>,
    created_at_block: i64,
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    fn candidate_at(group: u8, rank: u32, capacity: u64) -> GalaxyCellCandidate {
        GalaxyCellCandidate {
            out_point: OutPoint {
                tx_hash: format!("0x{group:02x}{rank:062x}"),
                index: rank,
            },
            capacity,
            birth_block: u64::from(rank),
        }
    }

    // ── T3: the candidate tail ────────────────────────────────────

    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Mutex};

    use axum::extract::Query;
    use axum::routing::get;
    use axum::{Json, Router};
    use std::collections::BTreeMap;

    /// A mock index holding `dao_total` deposits and two asset groups,
    /// paged 100 at a time exactly like ckbadger.
    async fn spawn_index(
        dao_total: usize,
        typed_per_group: usize,
    ) -> (Url, tokio::task::JoinHandle<()>, Arc<AtomicUsize>) {
        let requests = Arc::new(AtomicUsize::new(0));
        let counted = requests.clone();
        let dao_counted = requests.clone();
        let asset_counted = requests.clone();
        let app = Router::new()
            .route(
                "/api/v1/dao/deposits",
                get(move |Query(q): Query<BTreeMap<String, String>>| {
                    let counted = dao_counted.clone();
                    async move {
                        counted.fetch_add(1, Ordering::Relaxed);
                        let from: usize =
                            q.get("cursor").and_then(|c| c.parse().ok()).unwrap_or(0);
                        let to = (from + PAGE_LIMIT).min(dao_total);
                        let data: Vec<_> = (from..to)
                            .map(|i| {
                                serde_json::json!({
                                    "txHash": format!("0x{i:064x}"),
                                    "outputIndex": 0,
                                    "capacity": "100000000000",
                                    "depositBlockNumber": 10,
                                    "status": "deposited",
                                })
                            })
                            .collect();
                        Json(serde_json::json!({
                            "data": data,
                            "hasMore": to < dao_total,
                            "nextCursor": if to < dao_total { Some(to.to_string()) } else { None },
                        }))
                    }
                }),
            )
            .route(
                "/api/v1/assets",
                get(move || {
                    let counted = asset_counted.clone();
                    async move {
                        counted.fetch_add(1, Ordering::Relaxed);
                        Json(serde_json::json!({
                            "data": [
                                { "id": format!("0x{:064x}", 0xaa) },
                                { "id": format!("0x{:064x}", 0xbb) },
                            ],
                            "hasMore": false,
                            "nextCursor": None::<String>,
                        }))
                    }
                }),
            )
            .route(
                "/api/v1/cells/live",
                get(move |Query(q): Query<BTreeMap<String, String>>| {
                    let counted = counted.clone();
                    async move {
                        counted.fetch_add(1, Ordering::Relaxed);
                        let hash = q.get("type_script_hash").cloned().unwrap_or_default();
                        let from: usize =
                            q.get("cursor").and_then(|c| c.parse().ok()).unwrap_or(0);
                        let to = (from + PAGE_LIMIT).min(typed_per_group);
                        // Tag the tx hash with the group's last two hex
                        // digits so the test can tell them apart, while
                        // keeping it a valid 32-byte hash.
                        let tag = &hash[hash.len() - 2..];
                        let data: Vec<_> = (from..to)
                            .map(|i| {
                                serde_json::json!({
                                    "txHash": format!("0x{tag}{i:062x}"),
                                    "outputIndex": 0,
                                    "capacity": "200000000000",
                                    "createdAtBlock": 10,
                                    "typeScriptHash": hash,
                                    "lockScriptHash": format!("0x{:064x}", 0xcc),
                                })
                            })
                            .collect();
                        Json(serde_json::json!({
                            "data": data,
                            "hasMore": to < typed_per_group,
                            "nextCursor": if to < typed_per_group { Some(to.to_string()) } else { None },
                        }))
                    }
                }),
            );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let handle = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        (
            // Trailing slash: `Url::join` replaces the last segment
            // without one. The source normalizes this itself.
            Url::parse(&format!("http://{address}/api/v1/")).unwrap(),
            handle,
            requests,
        )
    }

    fn anchor() -> ChainAnchor {
        ChainAnchor {
            block: 100,
            hash: "0xanchor".into(),
        }
    }

    /// Successive calls walk DEEPER — the cursor persists, so the second
    /// turn never re-offers what the first one handed out.
    #[tokio::test]
    async fn the_tail_resumes_where_the_last_turn_stopped() {
        let (api, server, _) = spawn_index(1_000, 1_000).await;
        let client = reqwest::Client::new();
        let mut tail = CandidateTail::default();

        let first = top_up(&client, &api, anchor(), &mut tail, 150, 0, 1)
            .await
            .unwrap();
        assert_eq!(first.dao.len(), 150, "exactly the ask, never a page more");
        let second = top_up(&client, &api, anchor(), &mut tail, 150, 0, 1)
            .await
            .unwrap();
        assert_eq!(second.dao.len(), 150);

        let overlap = first
            .dao
            .iter()
            .filter(|c| second.dao.iter().any(|o| o.out_point == c.out_point))
            .count();
        assert_eq!(overlap, 0, "the second turn is strictly deeper");
        server.abort();
    }

    /// What a full discovery already handed out is skipped, so a node
    /// round-trip is never spent on a cell the plane declines anyway.
    #[tokio::test]
    async fn the_tail_skips_what_discovery_already_emitted() {
        let (api, server, _) = spawn_index(300, 0).await;
        let client = reqwest::Client::new();
        let mut tail = CandidateTail::default();
        tail.note_emitted(
            (0..100)
                .map(|i| OutPoint {
                    tx_hash: format!("0x{i:064x}"),
                    index: 0,
                })
                .collect::<Vec<_>>()
                .iter(),
        );

        let got = top_up(&client, &api, anchor(), &mut tail, 200, 0, 1)
            .await
            .unwrap();
        assert!(
            got.dao
                .iter()
                .all(|c| !c.out_point.tx_hash.ends_with("0000")
                    || c.out_point.tx_hash != format!("0x{:064x}", 0)),
            "nothing from the emitted prefix"
        );
        assert_eq!(
            got.dao.len(),
            200,
            "skipping the emitted page, not stopping at it"
        );
        server.abort();
    }

    /// A class walked end to end rewinds instead of wedging: deposits
    /// made since are new, and `emitted` keeps the rest from repeating.
    #[tokio::test]
    async fn an_exhausted_tail_rewinds_to_the_head() {
        let (api, server, _) = spawn_index(150, 0).await;
        let client = reqwest::Client::new();
        let mut tail = CandidateTail::default();

        let first = top_up(&client, &api, anchor(), &mut tail, 500, 0, 1)
            .await
            .unwrap();
        assert_eq!(first.dao.len(), 150, "the whole index");
        assert!(tail.dao_exhausted);

        // Nothing new to give, but the cursor is reset for next time.
        let second = top_up(&client, &api, anchor(), &mut tail, 500, 0, 1)
            .await
            .unwrap();
        assert!(second.dao.is_empty());
        assert!(!tail.dao_exhausted && tail.dao_cursor.is_none(), "rewound");
        let third = top_up(&client, &api, anchor(), &mut tail, 500, 0, 1)
            .await
            .unwrap();
        assert!(third.dao.is_empty(), "everything is already emitted");
        server.abort();
    }

    /// Typed walks the asset groups round-robin, so one large asset can
    /// never drain the whole turn.
    #[tokio::test]
    async fn typed_spreads_its_turn_across_groups() {
        let (api, server, requests) = spawn_index(0, 1_000).await;
        let client = reqwest::Client::new();
        let mut tail = CandidateTail::default();

        let got = top_up(&client, &api, anchor(), &mut tail, 0, 250, 1)
            .await
            .unwrap();
        assert_eq!(got.typed.len(), 250, "exactly the ask");
        let from_a = got
            .typed
            .iter()
            .filter(|c| c.out_point.tx_hash.starts_with("0xaa"))
            .count();
        let from_b = got
            .typed
            .iter()
            .filter(|c| c.out_point.tx_hash.starts_with("0xbb"))
            .count();
        assert!(
            from_a > 0 && from_b > 0,
            "both groups contributed: {from_a}/{from_b}"
        );
        assert!(requests.load(Ordering::Relaxed) <= MAX_PAGES_PER_TOP_UP + 1);
        server.abort();
    }

    /// One turn is bounded even when the ask is enormous — the shortfall
    /// simply takes more turns.
    #[tokio::test]
    async fn one_turn_pages_at_most_the_bound() {
        let (api, server, requests) = spawn_index(100_000, 0).await;
        let client = reqwest::Client::new();
        let mut tail = CandidateTail::default();

        let got = top_up(&client, &api, anchor(), &mut tail, 100_000, 0, 1)
            .await
            .unwrap();
        assert_eq!(got.dao.len(), MAX_PAGES_PER_TOP_UP * PAGE_LIMIT);
        assert_eq!(requests.load(Ordering::Relaxed), MAX_PAGES_PER_TOP_UP);
        server.abort();
    }

    /// Candidates born past the proving anchor never attach (same rule
    /// discovery obeys).
    #[tokio::test]
    async fn candidates_born_past_the_anchor_are_dropped() {
        let (api, server, _) = spawn_index(100, 0).await;
        let client = reqwest::Client::new();
        let mut tail = CandidateTail::default();
        let early = ChainAnchor {
            block: 5,
            hash: "0xearly".into(),
        };
        let got = top_up(&client, &api, early, &mut tail, 50, 0, 1)
            .await
            .unwrap();
        assert!(got.dao.is_empty(), "every mock deposit is at block 10");
        server.abort();
    }

    /// …and a candidate the anchor rejects is never CLAIMED on the way out.
    ///
    /// The tail marks a candidate emitted the moment the walk takes one, so
    /// rejecting after the walk spent the claim on a cell nobody was handed:
    /// once the tail wrapped back to the head, `emitted` skipped every one of
    /// them and they stayed invisible until a full re-discovery reset it.
    /// Here the anchor catches up between turns and the same deposits must
    /// still be on offer.
    #[tokio::test]
    async fn a_candidate_the_anchor_rejects_is_not_claimed() {
        let (api, server, _) = spawn_index(100, 0).await;
        let client = reqwest::Client::new();
        let mut tail = CandidateTail::default();
        let early = ChainAnchor {
            block: 5,
            hash: "0xearly".into(),
        };

        let rejected = top_up(&client, &api, early, &mut tail, 100, 0, 1)
            .await
            .unwrap();
        assert!(rejected.dao.is_empty(), "every mock deposit is at block 10");

        // One page was the whole index, so the tail is exhausted; the next
        // turn only rewinds (it never re-reads within the same call).
        let rewind = top_up(&client, &api, anchor(), &mut tail, 100, 0, 1)
            .await
            .unwrap();
        assert!(rewind.dao.is_empty(), "the rewind turn hands out nothing");

        // The anchor has caught up. Nothing was claimed by the walk that
        // rejected them, so the whole index is offerable again.
        let taken = top_up(&client, &api, anchor(), &mut tail, 100, 0, 1)
            .await
            .unwrap();
        assert_eq!(
            taken.dao.len(),
            100,
            "a rejected candidate must survive for the anchor that accepts it"
        );
        server.abort();
    }

    #[test]
    fn interleaving_preserves_group_diversity_and_deduplicates() {
        let duplicate = candidate_at(1, 0, 100);
        let groups = vec![
            vec![duplicate.clone(), candidate_at(1, 1, 90)],
            vec![duplicate, candidate_at(2, 1, 80)],
            vec![candidate_at(3, 0, 70)],
        ];
        let mut seen = HashSet::new();
        let selected = interleave_groups(groups, 4, &mut seen);
        let capacities: Vec<_> = selected.iter().map(|cell| cell.capacity).collect();
        assert_eq!(capacities, vec![100, 80, 70, 90]);
    }

    #[test]
    fn composition_overfetch_is_bounded() {
        assert_eq!(overfetch(0), 0);
        assert_eq!(overfetch(1_200), 1_500);
        assert_eq!(overfetch(3_900), 4_875);
    }

    // ── T2: the ranked roster ─────────────────────────────────────

    /// Serves one fixed `/assets` page, so a test can state the inventory
    /// row by row and read back what the roster made of it.
    async fn spawn_roster(page: serde_json::Value) -> (Url, tokio::task::JoinHandle<()>) {
        let app = Router::new().route(
            "/api/v1/assets",
            get(move || {
                let page = page.clone();
                async move { Json(page) }
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let handle = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        (
            Url::parse(&format!("http://{address}/api/v1/")).unwrap(),
            handle,
        )
    }

    fn asset_row(
        id: &str,
        asset_type: &str,
        standard: &str,
        owned_capacity: &str,
    ) -> serde_json::Value {
        serde_json::json!({
            "id": id,
            "assetType": asset_type,
            "standard": standard,
            "ownedCapacity": owned_capacity,
            // Fields the roster ignores, present because ckbadger sends them.
            "name": "ignored",
            "holdersCount": 12,
        })
    }

    /// The shapes are ckbadger's own, taken from the live top-64 on
    /// 2026-08-23: a 32-byte token hash, a 32-byte cluster id, a 24-byte
    /// m-nft collection id, and identity's 32 ASCII bytes in hex
    /// (`"dotbit_collection…"`).
    const TOKEN_ID: &str = "0xb5fdb4e8ad52f5e3ed4a294c8d1eb2eb6a4e8f2c3d5a6b7c8d9e0f1a2b3c4d5e";
    const CLUSTER_ID: &str = "0xb09a7b74f08afe5246b415f134fcda946207d761ef92f315ca563cc9dd22c315";
    const MNFT_ID: &str = "0x8f67efedd50c61c9dd332defd4051f08a02d797700000014";
    const DOTBIT_ID: &str = "0x646f746269745f636f6c6c656374696f6e5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f";

    /// The roster is the inventory page: every family it can reach, in
    /// ckbadger's rank order, carrying the weight that will divide the typed
    /// budget.
    #[tokio::test]
    async fn the_roster_keeps_the_inventory_rank_and_routes_every_family() {
        let (api, server) = spawn_roster(serde_json::json!({
            "data": [
                asset_row(TOKEN_ID, "token", "xudt_compatible", "3466360209983049"),
                asset_row(DOTBIT_ID, "identity", "dotbit", "138989821996213"),
                asset_row(CLUSTER_ID, "object", "spore", "109067222027837"),
                asset_row(MNFT_ID, "object", "m-nft", "4400000000000"),
            ],
            "hasMore": false,
            "nextCursor": None::<String>,
        }))
        .await;
        let client = reqwest::Client::new();

        let roster = ranked_assets(&client, &api).await.unwrap();

        assert_eq!(
            roster,
            vec![
                RankedAsset {
                    id: TOKEN_ID.to_string(),
                    standard: AssetStandard::Token,
                    owned_capacity: 3_466_360_209_983_049,
                },
                RankedAsset {
                    id: DOTBIT_ID.to_string(),
                    standard: AssetStandard::Identity(IdentityStandard::DotBit),
                    owned_capacity: 138_989_821_996_213,
                },
                RankedAsset {
                    id: CLUSTER_ID.to_string(),
                    standard: AssetStandard::Spore,
                    owned_capacity: 109_067_222_027_837,
                },
                RankedAsset {
                    id: MNFT_ID.to_string(),
                    standard: AssetStandard::MNft,
                    owned_capacity: 4_400_000_000_000,
                },
            ],
            "rank order is ckbadger's, and every row routes to a mechanism \
             that reaches its cells"
        );
        server.abort();
    }

    /// Both `.bit` collections and `did:ckb` route, under ckbadger's own
    /// spellings. `did_ckb` is the one an earlier draft got wrong — probed
    /// live, the standard carries the underscore.
    #[tokio::test]
    async fn every_identity_collection_routes_to_its_family() {
        let (api, server) = spawn_roster(serde_json::json!({
            "data": [
                asset_row(DOTBIT_ID, "identity", "dotbit", "138989821996213"),
                asset_row(&format!("0x{:064x}", 0xb1), "identity", "bit_cell", "13932991471586"),
                asset_row(&format!("0x{:064x}", 0xd1), "identity", "did_ckb", "0"),
            ],
            "hasMore": false,
            "nextCursor": None::<String>,
        }))
        .await;
        let client = reqwest::Client::new();

        let standards: Vec<_> = ranked_assets(&client, &api)
            .await
            .unwrap()
            .into_iter()
            .map(|asset| asset.standard)
            .collect();

        assert_eq!(
            standards,
            vec![
                AssetStandard::Identity(IdentityStandard::DotBit),
                AssetStandard::Identity(IdentityStandard::BitCell),
                AssetStandard::Identity(IdentityStandard::DidCkb),
            ]
        );
        server.abort();
    }

    /// A row cknerv cannot reach, cannot address, or cannot weigh leaves the
    /// roster entirely — which is what keeps it out of the denominator the
    /// weighted split divides by. A malformed row must never cost the walk
    /// the rows around it either.
    #[tokio::test]
    async fn an_unreachable_or_malformed_row_leaves_the_roster() {
        let (api, server) = spawn_roster(serde_json::json!({
            "data": [
                asset_row(TOKEN_ID, "token", "xudt", "100"),
                // No mechanism reaches a COTA collection today.
                asset_row(&format!("0x{:064x}", 0xc0), "object", "cota", "999999999"),
                // An identity standard cknerv has never seen.
                asset_row(&format!("0x{:064x}", 0xd0), "identity", "ens", "888888888"),
                // A token id that is not a script hash is not a request.
                asset_row("0xdeadbeef", "token", "xudt", "777777777"),
                // An id that would address something other than the collection.
                asset_row("0x../../secrets", "object", "spore", "666666666"),
                // Capacity that will not parse is not a weight.
                asset_row(CLUSTER_ID, "object", "spore", "one hundred"),
                asset_row(MNFT_ID, "object", "m-nft", "50"),
            ],
            "hasMore": false,
            "nextCursor": None::<String>,
        }))
        .await;
        let client = reqwest::Client::new();

        let roster = ranked_assets(&client, &api).await.unwrap();

        assert_eq!(
            roster
                .iter()
                .map(|asset| (asset.id.as_str(), asset.standard, asset.owned_capacity))
                .collect::<Vec<_>>(),
            vec![
                (TOKEN_ID, AssetStandard::Token, 100),
                (MNFT_ID, AssetStandard::MNft, 50),
            ],
            "the five unusable rows are gone and the two good ones survive them"
        );
        server.abort();
    }

    /// A page longer than what was asked for is an index disagreeing with
    /// its own limit — the same guard every other walk in this file applies.
    #[tokio::test]
    async fn a_roster_page_past_the_limit_is_refused() {
        let data: Vec<_> = (0..=ASSET_GROUP_LIMIT)
            .map(|i| asset_row(&format!("0x{i:064x}"), "token", "xudt", "1"))
            .collect();
        let (api, server) = spawn_roster(serde_json::json!({
            "data": data,
            "hasMore": false,
            "nextCursor": None::<String>,
        }))
        .await;
        let client = reqwest::Client::new();

        let error = ranked_assets(&client, &api)
            .await
            .expect_err("a page past the limit is not a roster");
        assert!(error.to_string().contains("ranked assets"), "got: {error}");
        server.abort();
    }

    // ── T3: computed hashes, collections, identity families ───────

    /// Live-verified against ckbadger and the CKB node on 2026-08-23.
    ///
    /// A Nervape spore: `sporeId` IS the item's type-script `args`, and the
    /// hash computed from it addressed the item's CURRENT live cell —
    /// outpoint `0x5b8da118…:0` — even though the item had been transferred
    /// away from its mint transaction `0xb0f45a8b…`. That transfer is the
    /// whole argument for computing the hash rather than reading the item
    /// row's `txHash`.
    #[test]
    fn the_spore_script_hash_matches_the_chain() {
        let code_hash =
            hash32_bytes("0x4a4dce1df3dffff7f8b2cd7dff7303df3b6150c9788cb75dcf6747247132b9f5")
                .unwrap();
        let args = hex_bytes("0x041e9872a9972ab578ff1531035614338efbebe1cc55148cb382d8a7561f1e37")
            .unwrap();
        assert_eq!(
            type_script_hash_for(&code_hash, MOLECULE_HASH_TYPE_DATA1, &args),
            "0x25bfb1642f6036b461aa58cb410c8429f99bf08257afae94f14125c2dcf6bb2a"
        );
    }

    /// The same arithmetic over 28-byte `args`, where the molecule table is
    /// 81 bytes rather than the spore case's 85.
    ///
    /// Obtained on 2026-08-23 by taking the first item of the live M-NFT
    /// collection `0x8f67efedd50c…00000014` (`nftId` IS the `args`),
    /// computing this hash, and asking the live index
    /// `GET /cells/live?type_script_hash=0x42b89d9c…&limit=1`. It answered
    /// with outpoint `0xcad471ef…:16`, capacity 13400000000, born at block
    /// 13,889,070, `typeCodeHash` equal to the M-NFT code hash below.
    ///
    /// The same probe is why the candidate is built from that row and not
    /// from the item row: the item list reported `createdAtBlock` 6,140,203
    /// for this item, while the transaction it names is in block 13,889,070.
    #[test]
    fn the_mnft_script_hash_matches_the_chain() {
        let code_hash =
            hash32_bytes("0x2b24f0d644ccbdd77bbf86b27c8cca02efa0ad051e447c212636d9ee7acaaec9")
                .unwrap();
        let args = hex_bytes("0x8f67efedd50c61c9dd332defd4051f08a02d79770000001400000000").unwrap();
        assert_eq!(args.len(), 28, "an M-NFT id is 28 bytes, not a hash");
        assert_eq!(
            type_script_hash_for(&code_hash, MOLECULE_HASH_TYPE_TYPE, &args),
            "0x42b89d9c02628401a418ad43fef0076811fca04042d9a2dbfa433d28c0604a13"
        );
    }

    /// The pinned M-NFT deployment is the one those live cells carry.
    #[test]
    fn the_pinned_mnft_version_is_the_deployed_one() {
        assert_eq!(
            MNFT_VERSIONS,
            &[DeployedScript {
                code_hash: "0x2b24f0d644ccbdd77bbf86b27c8cca02efa0ad051e447c212636d9ee7acaaec9",
                hash_type: MOLECULE_HASH_TYPE_TYPE,
            }]
        );
    }

    /// Every pinned code hash must be a code hash. A typo here would spend a
    /// request per item on a version that can never match.
    #[test]
    fn every_pinned_version_is_addressable() {
        for version in SPORE_VERSIONS.iter().chain(MNFT_VERSIONS) {
            assert!(
                hash32_bytes(version.code_hash).is_some(),
                "unusable pinned code hash: {}",
                version.code_hash
            );
        }
    }

    /// Serves one collection's item list and a fixed set of live cells keyed
    /// by type-script hash, recording every hash the walk asked about.
    async fn spawn_collection(
        items: serde_json::Value,
        live: BTreeMap<String, serde_json::Value>,
    ) -> (Url, tokio::task::JoinHandle<()>, Arc<Mutex<Vec<String>>>) {
        let asked = Arc::new(Mutex::new(Vec::new()));
        let logged = asked.clone();
        let spore_items = items.clone();
        let object_items = items;
        let app = Router::new()
            .route(
                "/api/v1/spore/clusters/:id/spores",
                get(move || {
                    let page = spore_items.clone();
                    async move { Json(page) }
                }),
            )
            .route(
                "/api/v1/assets/objects/:id/items",
                get(move || {
                    let page = object_items.clone();
                    async move { Json(page) }
                }),
            )
            .route(
                "/api/v1/cells/live",
                get(move |Query(q): Query<BTreeMap<String, String>>| {
                    let live = live.clone();
                    let logged = logged.clone();
                    async move {
                        let hash = q.get("type_script_hash").cloned().unwrap_or_default();
                        logged.lock().unwrap().push(hash.clone());
                        let data: Vec<_> = live.get(&hash).cloned().into_iter().collect();
                        Json(serde_json::json!({
                            "data": data,
                            "hasMore": false,
                            "nextCursor": None::<String>,
                        }))
                    }
                }),
            );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let handle = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        (
            Url::parse(&format!("http://{address}/api/v1/")).unwrap(),
            handle,
            asked,
        )
    }

    fn hash_under(version: &DeployedScript, args: &str) -> String {
        type_script_hash_for(
            &hash32_bytes(version.code_hash).unwrap(),
            version.hash_type,
            &hex_bytes(args).unwrap(),
        )
    }

    fn live_cell(hash: &str, tag: u8, capacity: u64, block: u64) -> serde_json::Value {
        serde_json::json!({
            "txHash": format!("0x{tag:02x}{:062x}", block),
            "outputIndex": 3,
            "capacity": capacity.to_string(),
            "createdAtBlock": block,
            "typeScriptHash": hash,
            "lockScriptHash": format!("0x{:064x}", 0xcc),
        })
    }

    const SPORE_A: &str = "0x041e9872a9972ab578ff1531035614338efbebe1cc55148cb382d8a7561f1e37";
    const SPORE_B: &str = "0x06444024948c8ba0bac5cac96bcf167618b5d1925df54ed8220c20631ac13579";
    const SPORE_C: &str = "0x5564d32594c100f922c1b4e9014f6be3e4070196ff6da2b40b3c834745d6827e";

    /// The end-to-end shape: cluster items → computed hash → live outpoint.
    ///
    /// The cluster's deployed version is discovered on the first item by
    /// trying the pinned list in order, then cached — so the two items after
    /// it cost one request each, not eight. An item whose lookup comes back
    /// empty melted between the index and the walk; it is counted, not
    /// mourned.
    #[tokio::test]
    async fn a_spore_cluster_resolves_its_items_and_settles_on_one_version() {
        // Third in the pinned list, so discovery has to walk past two.
        let deployed = SPORE_VERSIONS[2];
        let mut live = BTreeMap::new();
        live.insert(
            hash_under(&deployed, SPORE_A),
            live_cell(&hash_under(&deployed, SPORE_A), 0xa1, 90_000_000_000, 4_100),
        );
        // SPORE_B has no live cell at all: melted.
        live.insert(
            hash_under(&deployed, SPORE_C),
            live_cell(&hash_under(&deployed, SPORE_C), 0xc3, 70_000_000_000, 4_300),
        );
        let (api, server, asked) = spawn_collection(
            serde_json::json!({
                "data": [
                    { "sporeId": SPORE_A, "txHash": format!("0x{:064x}", 0xdead), "isLive": true },
                    { "sporeId": SPORE_B, "txHash": format!("0x{:064x}", 0xdead), "isLive": true },
                    { "sporeId": SPORE_C, "txHash": format!("0x{:064x}", 0xdead), "isLive": true },
                ],
                "total": 3,
                "hasMore": false,
                "nextCursor": None::<String>,
            }),
            live,
        )
        .await;
        let client = reqwest::Client::new();
        let mut settled = None;

        let walk = fetch_spore_group(
            &client,
            &api,
            "0xb09a7b74f08afe5246b415f134fcda946207d761ef92f315ca563cc9dd22c315",
            &mut settled,
            ITEM_PAGES_PER_GROUP,
        )
        .await;

        assert!(walk.stopped_by.is_none());
        assert_eq!(settled, Some(deployed), "the winning version is cached");
        assert_eq!(walk.melted, 1, "the item with no live cell is counted");
        assert_eq!(
            walk.candidates
                .iter()
                .map(|c| (c.capacity, c.birth_block, c.out_point.index))
                .collect::<Vec<_>>(),
            vec![(90_000_000_000, 4_100, 3), (70_000_000_000, 4_300, 3)],
            "capacity, birth and index all come from the live cell row"
        );

        let asked = asked.lock().unwrap().clone();
        assert_eq!(
            asked.len(),
            5,
            "three probes to discover the version, then one lookup per item: {asked:?}"
        );
        assert_eq!(
            &asked[..3],
            &[
                hash_under(&SPORE_VERSIONS[0], SPORE_A),
                hash_under(&SPORE_VERSIONS[1], SPORE_A),
                hash_under(&SPORE_VERSIONS[2], SPORE_A),
            ],
            "discovery tries the pinned versions in order"
        );
        assert_eq!(
            &asked[3..],
            &[
                hash_under(&deployed, SPORE_B),
                hash_under(&deployed, SPORE_C),
            ],
            "after discovery every item costs exactly one lookup"
        );
        server.abort();
    }

    /// A cluster whose deployment is not in the pinned list resolves nothing
    /// and says so, rather than looking like an empty cluster.
    #[tokio::test]
    async fn a_cluster_on_an_unpinned_version_resolves_nothing() {
        let (api, server, asked) = spawn_collection(
            serde_json::json!({
                "data": [{ "sporeId": SPORE_A }],
                "hasMore": false,
                "nextCursor": None::<String>,
            }),
            BTreeMap::new(),
        )
        .await;
        let client = reqwest::Client::new();
        let mut settled = None;

        let walk = fetch_spore_group(
            &client,
            &api,
            &format!("0x{:064x}", 0xb0),
            &mut settled,
            ITEM_PAGES_PER_GROUP,
        )
        .await;

        assert!(walk.candidates.is_empty());
        assert_eq!(walk.melted, 1);
        assert_eq!(settled, None, "nothing answered, so nothing is cached");
        assert_eq!(
            asked.lock().unwrap().len(),
            SPORE_VERSIONS.len(),
            "every pinned version was tried"
        );
        server.abort();
    }

    const MNFT_A: &str = "0x8f67efedd50c61c9dd332defd4051f08a02d79770000001400000000";
    const MNFT_DEAD: &str = "0x8f67efedd50c61c9dd332defd4051f08a02d79770000001400000001";

    /// `/assets/objects/{id}/items` serves dead rows too, so the filter is
    /// this walk's job. A burned item must not even cost a lookup.
    #[tokio::test]
    async fn an_object_collection_skips_its_dead_items() {
        let deployed = MNFT_VERSIONS[0];
        let mut live = BTreeMap::new();
        live.insert(
            hash_under(&deployed, MNFT_A),
            live_cell(
                &hash_under(&deployed, MNFT_A),
                0x11,
                13_400_000_000,
                13_889_070,
            ),
        );
        // The dead item's cell is present in the index, to prove the walk
        // never asks for it rather than merely not finding it.
        live.insert(
            hash_under(&deployed, MNFT_DEAD),
            live_cell(
                &hash_under(&deployed, MNFT_DEAD),
                0x22,
                13_400_000_000,
                12_521_230,
            ),
        );
        let (api, server, asked) = spawn_collection(
            serde_json::json!({
                "data": [
                    { "nftId": MNFT_A, "standard": "m-nft", "isLive": true, "outputIndex": None::<u32> },
                    { "nftId": MNFT_DEAD, "standard": "m-nft", "isLive": false },
                ],
                "hasMore": false,
                "nextCursor": None::<String>,
            }),
            live,
        )
        .await;
        let client = reqwest::Client::new();
        let mut settled = None;

        let walk = fetch_mnft_group(
            &client,
            &api,
            "0x8f67efedd50c61c9dd332defd4051f08a02d797700000014",
            &mut settled,
            ITEM_PAGES_PER_GROUP,
        )
        .await;

        assert_eq!(walk.candidates.len(), 1);
        assert_eq!(walk.candidates[0].birth_block, 13_889_070);
        assert_eq!(walk.melted, 0, "a dead row is not a melted item");
        assert_eq!(
            asked.lock().unwrap().clone(),
            vec![hash_under(&deployed, MNFT_A)],
            "the dead item never became a request"
        );
        server.abort();
    }

    /// Serves `/cells/by-script`, recording the query it was asked with.
    async fn spawn_by_script(
        rows: serde_json::Value,
    ) -> (Url, tokio::task::JoinHandle<()>, Arc<Mutex<Vec<String>>>) {
        let asked = Arc::new(Mutex::new(Vec::new()));
        let logged = asked.clone();
        let app = Router::new().route(
            "/api/v1/cells/by-script",
            get(move |request: axum::extract::Request| {
                let rows = rows.clone();
                let logged = logged.clone();
                async move {
                    logged
                        .lock()
                        .unwrap()
                        .push(request.uri().query().unwrap_or_default().to_string());
                    Json(serde_json::json!({
                        "data": rows,
                        "total": 2,
                        "hasMore": false,
                        "nextCursor": None::<String>,
                    }))
                }
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let handle = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        (
            Url::parse(&format!("http://{address}/api/v1/")).unwrap(),
            handle,
            asked,
        )
    }

    /// `/cells/by-script` matches lock OR type, and an unknown query
    /// parameter is ignored in silence — so `script_kind=type` is asked for
    /// AND re-checked, alongside the code hash. The hash type goes on the
    /// wire in CKB's JSON-RPC spelling.
    #[tokio::test]
    async fn an_identity_family_takes_only_rows_its_own_type_script_matched() {
        let family = ScriptId::parse(&format!("0x{:064x}", 0xbb), "data1").unwrap();
        let code_hash = family.code_hash_hex();
        let (api, server, asked) = spawn_by_script(serde_json::json!([
            {
                "txHash": format!("0x{:064x}", 0x01),
                "outputIndex": 1,
                "capacity": "23699989753",
                "createdAtBlock": 13_337_986,
                "lockScriptHash": format!("0x{:064x}", 0xcc),
                "typeScriptHash": format!("0x{:064x}", 0x51),
                "typeCodeHash": code_hash,
                "matchedScriptKind": "type",
            },
            {
                // The same code hash, matched as a LOCK.
                "txHash": format!("0x{:064x}", 0x02),
                "outputIndex": 0,
                "capacity": "10000000000",
                "createdAtBlock": 13_337_987,
                "lockScriptHash": code_hash,
                "typeScriptHash": None::<String>,
                "typeCodeHash": None::<String>,
                "matchedScriptKind": "lock",
            },
            {
                // Matched as a type, but not this family's type.
                "txHash": format!("0x{:064x}", 0x03),
                "outputIndex": 0,
                "capacity": "10000000000",
                "createdAtBlock": 13_337_988,
                "lockScriptHash": format!("0x{:064x}", 0xcc),
                "typeScriptHash": format!("0x{:064x}", 0x53),
                "typeCodeHash": format!("0x{:064x}", 0xfe),
                "matchedScriptKind": "type",
            },
        ]))
        .await;
        let client = reqwest::Client::new();

        let walk = fetch_identity_group(&client, &api, &family, 1).await;

        assert!(walk.stopped_by.is_none());
        assert_eq!(
            walk.candidates
                .iter()
                .map(|c| c.birth_block)
                .collect::<Vec<_>>(),
            vec![13_337_986],
            "only the row this family's own type script matched"
        );

        let query = asked.lock().unwrap()[0].clone();
        assert!(
            query.contains("hash_type=data1"),
            "the wire spelling is CKB's own, got: {query}"
        );
        assert!(query.contains("script_kind=type"), "got: {query}");
        assert!(
            query.contains(&format!("code_hash={code_hash}")),
            "got: {query}"
        );
        server.abort();
    }

    fn script(byte: u8, hash_type: &str) -> ScriptId {
        ScriptId::parse(&format!("0x{byte:02x}{:062x}", 0), hash_type).unwrap()
    }

    /// The join that makes an identity collection pageable: the census says
    /// which scripts are on stage, the registry names them, and the name is
    /// what identifies the family.
    #[test]
    fn identity_families_resolve_by_the_name_the_registry_gives_them() {
        let dotbit = script(0xa1, "type");
        let bit_cell = script(0xa2, "type");
        let did = script(0xa3, "type");
        let observed = vec![
            script(0x00, "type"), // an unparsed script carries the unset id
            dotbit,
            script(0xa9, "data1"), // named, but not an identity family
            bit_cell,
            did,
        ];
        let families = identity_families(&observed, |code_hash| {
            match code_hash {
                _ if code_hash == dotbit.code_hash_hex() => Some(".bit Account"),
                _ if code_hash == bit_cell.code_hash_hex() => Some(".bit Cell"),
                _ if code_hash == did.code_hash_hex() => Some("did:ckb"),
                _ if code_hash == script(0xa9, "data1").code_hash_hex() => Some("Simple UDT"),
                // The census has seen scripts the registry cannot name.
                _ => None,
            }
        });

        assert_eq!(families.len(), 3);
        assert_eq!(families[&IdentityStandard::DotBit], dotbit);
        assert_eq!(families[&IdentityStandard::BitCell], bit_cell);
        assert_eq!(families[&IdentityStandard::DidCkb], did);
    }

    /// Cold start (R1): a family the census has not observed yet is simply
    /// absent, and its collection contributes nothing this composition
    /// rather than pretending to.
    #[test]
    fn an_unobserved_identity_family_stays_absent() {
        let dotbit = script(0xa1, "type");
        let families = identity_families(&[dotbit], |_| Some(".bit Account"));
        assert_eq!(families.len(), 1);
        assert!(!families.contains_key(&IdentityStandard::BitCell));
        assert!(!families.contains_key(&IdentityStandard::DidCkb));

        assert!(
            identity_families(&[], |_| Some(".bit Account")).is_empty(),
            "an empty census names nothing"
        );
    }

    /// A family deployed more than once contributes the version the census
    /// reported first; the rest keep reaching the stage through
    /// block-following, as they do today.
    #[test]
    fn a_family_with_two_deployments_contributes_the_first_observed() {
        let first = script(0xa1, "type");
        let second = script(0xa2, "type");
        let families = identity_families(&[first, second], |_| Some(".bit Account"));
        assert_eq!(families[&IdentityStandard::DotBit], first);
    }

    // ── one class failing ─────────────────────────────────────────

    /// A full-composition mock. `dao_ok_pages` deposit pages answer, and
    /// every page past that returns HTTP 500 — the shape a stale
    /// secondary index takes when the server refuses to serve the row
    /// rather than skipping it. `serve_assets` switches the typed
    /// class's head request off the same way.
    pub(crate) async fn spawn_composition_index(
        dao_ok_pages: usize,
        serve_assets: bool,
    ) -> (Url, tokio::task::JoinHandle<()>) {
        fn live_page(tag: &str, lock: String, typed: Option<String>) -> serde_json::Value {
            let data: Vec<_> = (0..PAGE_LIMIT)
                .map(|i| {
                    serde_json::json!({
                        "txHash": format!("0x{tag}{i:062x}"),
                        "outputIndex": 0,
                        "capacity": "200000000000",
                        "createdAtBlock": 10,
                        "typeScriptHash": typed,
                        "lockScriptHash": lock,
                    })
                })
                .collect();
            serde_json::json!({ "data": data, "hasMore": false, "nextCursor": None::<String> })
        }

        let app = Router::new()
            // The two the SOURCE needs around a composition — `probe` sets the
            // validated anchor from them, and every enrichment rechecks the
            // anchor through `blocks/{n}`. The composition walks below ignore
            // them; `source.rs`'s tests drive the whole `enrich_*` path
            // against this same index.
            .route(
                "/api/v1/statistics/network",
                get(|| async {
                    Json(serde_json::json!({
                        "syncStatus": { "isSyncing": false, "syncedBlock": 100 }
                    }))
                }),
            )
            .route(
                "/api/v1/blocks/:number",
                get(
                    |axum::extract::Path(number): axum::extract::Path<u64>| async move {
                        Json(serde_json::json!({
                            "number": number,
                            "hash": format!("0xblock{number}"),
                        }))
                    },
                ),
            )
            .route(
                "/api/v1/dao/deposits",
                get(
                    move |Query(q): Query<BTreeMap<String, String>>| async move {
                        let page: usize = q.get("cursor").and_then(|c| c.parse().ok()).unwrap_or(0);
                        if page >= dao_ok_pages {
                            return (
                                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                                Json(serde_json::json!({
                                    "error": "internal_error",
                                    "message": "dao_by_status_block stale status",
                                })),
                            );
                        }
                        let data: Vec<_> = (0..PAGE_LIMIT)
                            .map(|i| {
                                serde_json::json!({
                                    "txHash": format!("0xda{:02x}{i:060x}", page),
                                    "outputIndex": 0,
                                    "capacity": "100000000000",
                                    "depositBlockNumber": 10,
                                    "status": "deposited",
                                })
                            })
                            .collect();
                        (
                            axum::http::StatusCode::OK,
                            Json(serde_json::json!({
                                "data": data,
                                "hasMore": true,
                                "nextCursor": Some((page + 1).to_string()),
                            })),
                        )
                    },
                ),
            )
            .route(
                "/api/v1/assets",
                get(move || async move {
                    if !serve_assets {
                        return (
                            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                            Json(serde_json::json!({ "error": "internal_error" })),
                        );
                    }
                    (
                        axum::http::StatusCode::OK,
                        Json(serde_json::json!({
                            "data": [
                                { "id": format!("0x{:064x}", 0xaa) },
                                { "id": format!("0x{:064x}", 0xbb) },
                            ],
                            "hasMore": false,
                            "nextCursor": None::<String>,
                        })),
                    )
                }),
            )
            .route(
                "/api/v1/addresses/top",
                get(|| async {
                    Json(serde_json::json!([
                        { "lockScriptHash": format!("0x{:064x}", 0xc1) },
                        { "lockScriptHash": format!("0x{:064x}", 0xc2) },
                    ]))
                }),
            )
            .route(
                "/api/v1/addresses/active",
                get(|| async {
                    Json(serde_json::json!([
                        { "lockScriptHash": format!("0x{:064x}", 0xc3) },
                        { "lockScriptHash": format!("0x{:064x}", 0xc4) },
                    ]))
                }),
            )
            .route(
                "/api/v1/cells/live",
                get(|Query(q): Query<BTreeMap<String, String>>| async move {
                    if let Some(hash) = q.get("type_script_hash") {
                        let tag = hash[hash.len() - 2..].to_string();
                        return Json(live_page(
                            &tag,
                            format!("0x{:064x}", 0xcc),
                            Some(hash.clone()),
                        ));
                    }
                    let lock = q.get("lock_script_hash").cloned().unwrap_or_default();
                    let tag = lock[lock.len() - 2..].to_string();
                    Json(live_page(&tag, lock, None))
                }),
            );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let handle = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        (
            Url::parse(&format!("http://{address}/api/v1/")).unwrap(),
            handle,
        )
    }

    /// The live regression this guards: ckbadger's DAO index held a stale
    /// secondary-index row and returned HTTP 500 partway through the
    /// deposit walk. DAO is discovered first, so its `?` voided a whole
    /// composition whose typed and plain classes were answering
    /// perfectly — and the display plane, never receiving a reservoir,
    /// staffed the stage in canonical insertion order, which on mainnet
    /// is over 99% plain CKB. A class that fails is a short class, which
    /// the composition policy already staffs from canonical Cells.
    #[tokio::test]
    async fn a_failing_class_does_not_void_the_whole_composition() {
        let (api, server) = spawn_composition_index(1, true).await;
        let client = reqwest::Client::new();

        let got = discover(&client, &api, anchor(), 1_000, 7)
            .await
            .expect("one broken class is not a broken composition");

        assert_eq!(
            got.dao.len(),
            PAGE_LIMIT,
            "the page that answered before the failure is kept"
        );
        assert!(!got.typed.is_empty(), "typed answered and must be staged");
        assert!(!got.plain.is_empty(), "plain answered and must be staged");
        server.abort();
    }

    /// The other half of the rule. A composition that curates nobody must
    /// NOT be published: it would flip the display plane to composed and
    /// mark the capability landed, so a stage holding no curated Cell at
    /// all would hold that way — the plane only re-arms the composition
    /// when it degrades. Failing keeps the supervisor retrying.
    #[tokio::test]
    async fn a_composition_that_curates_nobody_is_an_error() {
        // No DAO page answers, the typed head fails, and every address
        // group resolves to cells born past the anchor.
        let (api, server) = spawn_composition_index(0, false).await;
        let client = reqwest::Client::new();

        let error = discover(
            &client,
            &api,
            ChainAnchor {
                block: 0,
                hash: "0x0".into(),
            },
            1_000,
            7,
        )
        .await
        .expect_err("nothing curated is not a publishable composition");

        assert!(
            error.to_string().contains("DAO deposits"),
            "the first failure is reported, got: {error}"
        );
        server.abort();
    }
}
