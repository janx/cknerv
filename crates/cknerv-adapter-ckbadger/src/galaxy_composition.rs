//! Bounded ckbadger discovery for the CellGalaxy display reservoir.
//!
//! ckbadger ranks/indexes outpoints efficiently; it never becomes structural
//! truth. The caller passes these candidates to a canonical CKB hydrator
//! before any Cell crosses the shared enrichment wire boundary.

use std::collections::{HashSet, VecDeque};

use anyhow::{anyhow, Context};
use futures::{stream, StreamExt};
use reqwest::StatusCode;
use serde::de::DeserializeOwned;
use serde::Deserialize;
use url::Url;

use cknerv_core::{
    ChainAnchor, GalaxyCellCandidate, GalaxyCompositionCandidates, GalaxyCompositionTarget,
    OutPoint,
};

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

    let mut dao = discover_dao(client, api_base, overfetch(target.dao), &mut seen).await?;
    let mut typed = discover_typed(client, api_base, overfetch(target.typed), &mut seen).await?;
    let mut plain = discover_plain(client, api_base, overfetch(target.plain), &mut seen).await?;
    // The index can advance while the validated compatibility anchor remains
    // fixed. Never attach a Cell born beyond the block that proves this record.
    dao.retain(|candidate| candidate.birth_block <= anchor.block);
    typed.retain(|candidate| candidate.birth_block <= anchor.block);
    plain.retain(|candidate| candidate.birth_block <= anchor.block);

    Ok(GalaxyCompositionCandidates {
        source: "ckbadger".to_string(),
        as_of: anchor,
        updated_at_ms,
        target,
        dao,
        typed,
        plain,
    })
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
    let mut dao = if want_dao > 0 {
        top_up_dao(client, api_base, tail, want_dao).await?
    } else {
        Vec::new()
    };
    let mut typed = if want_typed > 0 {
        top_up_typed(client, api_base, tail, want_typed).await?
    } else {
        Vec::new()
    };
    // Same rule as discovery: never attach a Cell born beyond the block
    // that proves this record.
    dao.retain(|candidate| candidate.birth_block <= anchor.block);
    typed.retain(|candidate| candidate.birth_block <= anchor.block);
    Ok(GalaxyCompositionCandidates {
        source: "ckbadger".to_string(),
        as_of: anchor,
        updated_at_ms,
        target: GalaxyCompositionTarget {
            dao: want_dao,
            typed: want_typed,
            plain: 0,
        },
        dao,
        typed,
        plain: Vec::new(),
    })
}

async fn top_up_dao(
    client: &reqwest::Client,
    api_base: &Url,
    tail: &mut CandidateTail,
    want: usize,
) -> anyhow::Result<Vec<GalaxyCellCandidate>> {
    let mut found = Vec::with_capacity(want);
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
    Ok(found)
}

async fn top_up_typed(
    client: &reqwest::Client,
    api_base: &Url,
    tail: &mut CandidateTail,
    want: usize,
) -> anyhow::Result<Vec<GalaxyCellCandidate>> {
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
        return Ok(Vec::new());
    }

    let mut found = Vec::with_capacity(want);
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
    Ok(found)
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
) -> anyhow::Result<Vec<GalaxyCellCandidate>> {
    let mut candidates = Vec::with_capacity(desired);
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

    candidates.sort_by(|left, right| {
        right
            .capacity
            .cmp(&left.capacity)
            .then_with(|| right.birth_block.cmp(&left.birth_block))
            .then_with(|| left.out_point.tx_hash.cmp(&right.out_point.tx_hash))
            .then_with(|| left.out_point.index.cmp(&right.out_point.index))
    });
    candidates.truncate(desired);
    Ok(candidates)
}

async fn discover_typed(
    client: &reqwest::Client,
    api_base: &Url,
    desired: usize,
    seen: &mut HashSet<OutPoint>,
) -> anyhow::Result<Vec<GalaxyCellCandidate>> {
    if desired == 0 {
        return Ok(Vec::new());
    }
    let mut url = endpoint(api_base, "assets")?;
    url.query_pairs_mut()
        .append_pair("limit", &ASSET_GROUP_LIMIT.to_string())
        .append_pair("sort_key", "capacity")
        .append_pair("sort_direction", "desc");
    let assets: CursorPage<GalaxyAssetResponse> = fetch_json(client, url, "top assets").await?;
    validate_page_size(assets.data.len(), ASSET_GROUP_LIMIT, "top assets")?;
    let asset_hashes: Vec<_> = assets
        .data
        .into_iter()
        .map(|asset| asset.id)
        .filter(|hash| is_hash32(hash))
        .collect();

    let mut groups: Vec<_> = stream::iter(asset_hashes.into_iter().enumerate().map(
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
    .await
    .into_iter()
    .collect::<anyhow::Result<Vec<_>>>()?;
    groups.sort_by_key(|(rank, _)| *rank);

    Ok(interleave_groups(
        groups.into_iter().map(|(_, group)| group).collect(),
        desired,
        seen,
    ))
}

async fn discover_plain(
    client: &reqwest::Client,
    api_base: &Url,
    desired: usize,
    seen: &mut HashSet<OutPoint>,
) -> anyhow::Result<Vec<GalaxyCellCandidate>> {
    if desired == 0 {
        return Ok(Vec::new());
    }
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

    let mut groups: Vec<_> = stream::iter(address_hashes.into_iter().enumerate().map(
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
    .await
    .into_iter()
    .collect::<anyhow::Result<Vec<_>>>()?;
    groups.sort_by_key(|(rank, _)| *rank);

    Ok(interleave_groups(
        groups.into_iter().map(|(_, group)| group).collect(),
        desired,
        seen,
    ))
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
mod tests {
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
    use std::sync::Arc;

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
        assert_eq!(first.dao.len(), 200, "pages until the ask is covered");
        let second = top_up(&client, &api, anchor(), &mut tail, 150, 0, 1)
            .await
            .unwrap();
        assert_eq!(second.dao.len(), 200);

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

        let got = top_up(&client, &api, anchor(), &mut tail, 50, 0, 1)
            .await
            .unwrap();
        assert!(
            got.dao
                .iter()
                .all(|c| !c.out_point.tx_hash.ends_with("0000")
                    || c.out_point.tx_hash != format!("0x{:064x}", 0)),
            "nothing from the emitted prefix"
        );
        assert_eq!(got.dao.len(), 100, "the whole first page was already ours");
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
        assert_eq!(got.typed.len(), 300, "three pages, one ask covered");
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
        assert_eq!(overfetch(1_800), 2_250);
        assert_eq!(overfetch(2_400), 3_000);
    }
}
