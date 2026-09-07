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
/// The most index pages one ranked asset may cost a single composition,
/// whatever share of the class the split says it earned.
///
/// `/cells/live` is indexed by script and ordered by creation position, not by
/// capacity, so sampling a few bounded pages per asset lets cknerv rank the
/// individual Cells by CKBytes without asking ckbadger to change. It is also
/// the ceiling on a collection's item list, for the plainer reason that every
/// item listed there costs a request of its own.
const MAX_PAGES_PER_ASSET: usize = 3;
const PLAIN_CELL_PAGES_PER_GROUP: usize = 1;
const CANDIDATE_OVERFETCH_NUMERATOR: usize = 5;
const CANDIDATE_OVERFETCH_DENOMINATOR: usize = 4;

pub(crate) async fn discover(
    client: &reqwest::Client,
    api_base: &Url,
    anchor: ChainAnchor,
    target_total: usize,
    identity_families: &HashMap<IdentityStandard, ScriptId>,
    updated_at_ms: u64,
) -> anyhow::Result<GalaxyCompositionCandidates> {
    let target = GalaxyCompositionTarget::for_total(target_total);
    let mut seen = HashSet::with_capacity(target.total().saturating_mul(2));

    let mut dao = discover_dao(client, api_base, overfetch(target.dao), &mut seen).await;
    let mut typed = discover_typed(
        client,
        api_base,
        overfetch(target.typed),
        identity_families,
        &mut seen,
    )
    .await;
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
    /// The ranked roster this tail is walking, one entry per asset, in the
    /// inventory's own order — the same ranking, and the same weights, that
    /// a full composition divides its typed class by (D4).
    assets: Vec<AssetTail>,
    /// Set when a full discovery lands. See [`CandidateTail::note_emitted`]
    /// for what the tail does about it, and why it is not simply a rewind.
    roster_stale: bool,
    /// Every outpoint this source has already handed to the display
    /// plane — through the initial composition or an earlier top-up.
    /// Offering one twice would spend a node round-trip on a cell the
    /// plane declines by outpoint anyway (invariant I4).
    emitted: HashSet<OutPoint>,
}

/// One ranked asset's place in the tail: where its paging has reached, and
/// how much of the class it has actually delivered since the roster was
/// taken.
struct AssetTail {
    asset: RankedAsset,
    cursor: AssetCursor,
    /// This asset has been walked end to end.
    exhausted: bool,
    /// Candidates handed out, which is what the next turn's deficit is
    /// measured against — so the tail converges on the same
    /// capacity-weighted mix discovery composes.
    delivered: usize,
}

/// Where one asset's paging has reached, in whichever terms its standard
/// pages (D3). Three shapes because the three mechanisms resume differently,
/// and a cursor into the wrong one addresses nothing.
enum AssetCursor {
    /// A token contract: `cells/live` pages the group by its script hash.
    Contract { cursor: Option<String> },
    /// A collection: the item list's cursor, the deployed version discovered
    /// for it, and the items listed but not yet resolved.
    Collection {
        cursor: Option<String>,
        settled: Option<DeployedScript>,
        /// Items this walk has paid a list request for and not yet spent a
        /// lookup on. A collection's page costs one request and its contents
        /// cost a hundred, so a turn that stops mid-page must keep the rest:
        /// letting the cursor move past them would throw away a request that
        /// was already made.
        pending: VecDeque<String>,
        /// The item list itself has run out. The asset is exhausted once
        /// this is true AND `pending` has drained.
        listed_out: bool,
    },
    /// An identity family: `cells/by-script` pages its one script.
    Family { cursor: Option<String> },
}

impl AssetCursor {
    fn for_standard(standard: AssetStandard) -> Self {
        match standard {
            AssetStandard::Token => Self::Contract { cursor: None },
            AssetStandard::Spore | AssetStandard::MNft => Self::Collection {
                cursor: None,
                settled: None,
                pending: VecDeque::new(),
                listed_out: false,
            },
            AssetStandard::Identity(_) => Self::Family { cursor: None },
        }
    }

    /// Whether this cursor still addresses the standard it was made for. An
    /// id that changed families across a roster refresh keeps its slot but
    /// not its position.
    fn addresses(&self, standard: AssetStandard) -> bool {
        matches!(
            (self, standard),
            (Self::Contract { .. }, AssetStandard::Token)
                | (
                    Self::Collection { .. },
                    AssetStandard::Spore | AssetStandard::MNft
                )
                | (Self::Family { .. }, AssetStandard::Identity(_))
        )
    }
}

impl AssetTail {
    /// Back to this asset's head, keeping what the walk learned about it.
    ///
    /// `delivered` is deliberately NOT reset: it measures this asset's share
    /// of the curated population, which a rewind does not undo. Zeroing it
    /// would make the tail believe the ranking's head was starving and pour
    /// the next turn into pages it has already handed out. Nor is a
    /// collection's discovered version reset — that is a property of the
    /// collection, not of the walk's position in it.
    fn rewind(&mut self) {
        self.exhausted = false;
        self.cursor = match &self.cursor {
            AssetCursor::Collection { settled, .. } => AssetCursor::Collection {
                cursor: None,
                settled: *settled,
                pending: VecDeque::new(),
                listed_out: false,
            },
            _ => AssetCursor::for_standard(self.asset.standard),
        };
    }
}

impl CandidateTail {
    /// Remember what a full discovery just handed out, so the tail
    /// resumes past it instead of re-offering the head.
    pub(crate) fn note_emitted<'a>(&mut self, candidates: impl Iterator<Item = &'a OutPoint>) {
        for out_point in candidates {
            self.emitted.insert(out_point.clone());
        }
        // A full discovery just re-read the inventory ranking and re-staged
        // the whole typed class from it, so this is the tail's sync point:
        // the roster it holds is a composition old, and its delivered counts
        // measure a population that no longer exists. The next turn re-takes
        // the ranking and zeroes those counts — but CARRIES EACH CURSOR
        // ACROSS, because rewinding them would send the tail back over the
        // very head the discovery has just handed out.
        self.roster_stale = true;
    }

    /// How many outpoints this tail has claimed. A claim is what makes a
    /// candidate invisible to every later top-up, so "was it claimed" is the
    /// question an ordering test has to be able to ask.
    #[cfg(test)]
    pub(crate) fn claimed(&self) -> usize {
        self.emitted.len()
    }
}

/// One top-up turn's request budget, counted in CELLS rather than in pages.
///
/// An index page buys up to [`PAGE_LIMIT`] candidates for one request; a
/// collection's item lookup buys exactly one. Pricing both against the same
/// ceiling is the only way [`MAX_PAGES_PER_TOP_UP`] still bounds a turn that
/// walks collections as well as contracts — eight pages of item lookups
/// would be eight hundred requests, not eight.
struct TurnBudget {
    spent: usize,
    limit: usize,
}

impl TurnBudget {
    fn new(pages: usize) -> Self {
        Self {
            spent: 0,
            limit: pages.saturating_mul(PAGE_LIMIT),
        }
    }

    fn is_spent(&self) -> bool {
        self.spent >= self.limit
    }

    fn spend_page(&mut self) {
        self.spent = self.spent.saturating_add(PAGE_LIMIT);
    }

    fn spend_lookup(&mut self) {
        self.spent = self.spent.saturating_add(1);
    }
}

/// Walk deeper for `want_dao` / `want_typed` more candidates of each
/// class, resuming from wherever the last call stopped.
///
/// Returns them in the [`GalaxyCompositionCandidates`] shape the
/// canonical hydrator already speaks, with `target` carrying what was
/// asked for. The plain bucket stays empty: plain slots are fed by the
/// canonical fallback stream, not curated (D5).
#[allow(clippy::too_many_arguments)]
pub(crate) async fn top_up(
    client: &reqwest::Client,
    api_base: &Url,
    anchor: ChainAnchor,
    tail: &mut CandidateTail,
    want_dao: usize,
    want_typed: usize,
    identity_families: &HashMap<IdentityStandard, ScriptId>,
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
        top_up_typed(
            client,
            api_base,
            tail,
            want_typed,
            anchor.block,
            identity_families,
        )
        .await
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
    identity_families: &HashMap<IdentityStandard, ScriptId>,
) -> ClassWalk {
    let mut found = Vec::with_capacity(want);
    let stopped_by = walk_typed_tail(
        client,
        api_base,
        tail,
        want,
        max_birth_block,
        identity_families,
        &mut found,
    )
    .await
    .err();
    ClassWalk {
        candidates: found,
        stopped_by,
    }
}

/// The typed shortfall, served in rank-priority order.
///
/// Each asset's SHARE of the population the class would hold once this turn
/// lands — `delivered_total + want`, split by the same capacity weights
/// discovery uses — minus what it has already delivered, is its deficit.
/// Walking the deficits from the top means a high-ranked asset that has
/// fallen behind is filled before a low-ranked one that has not, which is
/// what keeps the tail from drifting away from the mix the composition
/// established.
///
/// Two passes. The first serves deficits, so the mix converges; the second
/// spends whatever is left of the turn from the top of the ranking, so a
/// budget is never returned unspent while assets still hold candidates.
async fn walk_typed_tail(
    client: &reqwest::Client,
    api_base: &Url,
    tail: &mut CandidateTail,
    want: usize,
    max_birth_block: u64,
    identity_families: &HashMap<IdentityStandard, ScriptId>,
    found: &mut Vec<GalaxyCellCandidate>,
) -> anyhow::Result<()> {
    // The roster is re-taken when the tail has none — the first turn of a
    // process — and again on the first turn after a full discovery.
    if tail.assets.is_empty() || tail.roster_stale {
        refresh_roster(client, api_base, tail).await?;
    }
    if tail.assets.is_empty() {
        return Ok(());
    }
    if tail.assets.iter().all(|asset| asset.exhausted) {
        // The ranking has been walked end to end. Start over from the head:
        // deposits made since are new, and `emitted` skips everything
        // already handed out. This turn hands out nothing; the next resumes
        // at the head.
        for asset in &mut tail.assets {
            asset.rewind();
        }
        return Ok(());
    }

    let shares = tail_shares(&tail.assets, want);
    let mut budget = TurnBudget::new(MAX_PAGES_PER_TOP_UP);
    for pass in [Pass::Deficit, Pass::Remainder] {
        // By index, not by iterator: the step below takes `&mut tail`, so
        // the asset it walks cannot also be borrowed by the loop.
        #[allow(clippy::needless_range_loop)]
        for index in 0..tail.assets.len() {
            if found.len() >= want || budget.is_spent() {
                break;
            }
            if tail.assets[index].exhausted {
                continue;
            }
            let take = match pass {
                Pass::Deficit => shares[index].saturating_sub(tail.assets[index].delivered),
                Pass::Remainder => want,
            }
            .min(want - found.len());
            if take == 0 {
                continue;
            }
            let until = found.len() + take;
            step_asset(
                client,
                api_base,
                tail,
                index,
                until,
                max_birth_block,
                identity_families,
                &mut budget,
                found,
            )
            .await?;
        }
        if found.len() >= want || budget.is_spent() {
            break;
        }
    }
    Ok(())
}

#[derive(Clone, Copy)]
enum Pass {
    /// Every asset up to the share its rank has earned.
    Deficit,
    /// Whatever is left of the ask, from the top down.
    Remainder,
}

/// Re-take the inventory ranking, carrying each surviving asset's cursor
/// across by id.
///
/// The weights are what the split divides by, and they drift as capacity
/// aggregates move (R4), so a tail that never re-read them would walk a
/// ranking as old as the process. Cursors survive the refresh because they
/// address the index, not the ranking; `delivered` does not, because the
/// composition that triggered the refresh has just replaced the population
/// those counts measured.
async fn refresh_roster(
    client: &reqwest::Client,
    api_base: &Url,
    tail: &mut CandidateTail,
) -> anyhow::Result<()> {
    let roster = ranked_assets(client, api_base).await?;
    let mut carried: HashMap<String, AssetCursor> = tail
        .assets
        .drain(..)
        .map(|entry| (entry.asset.id, entry.cursor))
        .collect();
    tail.assets = roster
        .into_iter()
        .map(|asset| {
            let cursor = carried
                .remove(&asset.id)
                .filter(|cursor| cursor.addresses(asset.standard))
                .unwrap_or_else(|| AssetCursor::for_standard(asset.standard));
            AssetTail {
                asset,
                cursor,
                exhausted: false,
                delivered: 0,
            }
        })
        .collect();
    tail.roster_stale = false;
    Ok(())
}

/// What each asset would hold of the class once this turn lands, by the same
/// capacity weights discovery composes with.
fn tail_shares(assets: &[AssetTail], want: usize) -> Vec<usize> {
    let delivered: usize = assets.iter().map(|asset| asset.delivered).sum();
    let weights: Vec<u64> = assets
        .iter()
        .map(|asset| asset.asset.owned_capacity)
        .collect();
    proportional(&weights, delivered.saturating_add(want))
}

#[allow(clippy::too_many_arguments)]
async fn step_asset(
    client: &reqwest::Client,
    api_base: &Url,
    tail: &mut CandidateTail,
    index: usize,
    until: usize,
    max_birth_block: u64,
    identity_families: &HashMap<IdentityStandard, ScriptId>,
    budget: &mut TurnBudget,
    found: &mut Vec<GalaxyCellCandidate>,
) -> anyhow::Result<()> {
    match tail.assets[index].asset.standard {
        AssetStandard::Token => {
            step_contract(
                client,
                api_base,
                tail,
                index,
                until,
                max_birth_block,
                budget,
                found,
            )
            .await
        }
        AssetStandard::Spore | AssetStandard::MNft => {
            step_collection(
                client,
                api_base,
                tail,
                index,
                until,
                max_birth_block,
                budget,
                found,
            )
            .await
        }
        AssetStandard::Identity(standard) => match identity_families.get(&standard).copied() {
            Some(family) => {
                step_family(
                    client,
                    api_base,
                    tail,
                    index,
                    until,
                    max_birth_block,
                    &family,
                    budget,
                    found,
                )
                .await
            }
            None => {
                // The census cannot name this family yet (R1). Nothing to
                // page, so the asset has nothing to give this turn — and
                // saying so is what lets the rewind check see the whole
                // ranking as spent rather than waiting on a row that can
                // never answer.
                tail.assets[index].exhausted = true;
                Ok(())
            }
        },
    }
}

/// A token contract, paged by its script hash.
#[allow(clippy::too_many_arguments)]
async fn step_contract(
    client: &reqwest::Client,
    api_base: &Url,
    tail: &mut CandidateTail,
    index: usize,
    until: usize,
    max_birth_block: u64,
    budget: &mut TurnBudget,
    found: &mut Vec<GalaxyCellCandidate>,
) -> anyhow::Result<()> {
    while found.len() < until && !budget.is_spent() {
        let hash = tail.assets[index].asset.id.clone();
        let AssetCursor::Contract { cursor } = &tail.assets[index].cursor else {
            return Ok(());
        };
        let cursor = cursor.clone();
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
        budget.spend_page();
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
            if found.len() >= until {
                break; // as above: never claim what is not delivered
            }
            take_candidate(tail, index, candidate, found);
        }
        let entry = &mut tail.assets[index];
        if page.has_more {
            let next = next_cursor(page.next_cursor, "live Cell tail")?;
            if let AssetCursor::Contract { cursor } = &mut entry.cursor {
                *cursor = Some(next);
            }
        } else {
            entry.exhausted = true;
            break;
        }
    }
    Ok(())
}

/// An identity family, paged by its one type script.
#[allow(clippy::too_many_arguments)]
async fn step_family(
    client: &reqwest::Client,
    api_base: &Url,
    tail: &mut CandidateTail,
    index: usize,
    until: usize,
    max_birth_block: u64,
    family: &ScriptId,
    budget: &mut TurnBudget,
    found: &mut Vec<GalaxyCellCandidate>,
) -> anyhow::Result<()> {
    let code_hash = family.code_hash_hex();
    while found.len() < until && !budget.is_spent() {
        let AssetCursor::Family { cursor } = &tail.assets[index].cursor else {
            return Ok(());
        };
        let cursor = cursor.clone();
        let mut url = endpoint(api_base, "cells/by-script")?;
        {
            let mut query = url.query_pairs_mut();
            query
                .append_pair("code_hash", &code_hash)
                .append_pair("hash_type", hash_type_wire(family.hash_type).as_str())
                .append_pair("script_kind", "type")
                .append_pair("limit", &PAGE_LIMIT.to_string());
            if let Some(cursor) = cursor.as_deref() {
                query.append_pair("cursor", cursor);
            }
        }
        let page: CursorPage<ByScriptCellResponse> =
            fetch_json(client, url, "identity family tail").await?;
        validate_page_size(page.data.len(), PAGE_LIMIT, "identity family tail")?;
        budget.spend_page();
        for cell in page.data {
            // The endpoint matches lock OR type and ignores an unknown
            // parameter in silence, so the filter is re-checked per row.
            if cell.matched_script_kind.as_deref() != Some("type")
                || cell.type_code_hash.as_deref() != Some(code_hash.as_str())
            {
                continue;
            }
            let candidate = candidate(
                cell.tx_hash,
                cell.output_index,
                cell.capacity,
                cell.created_at_block,
                "identity family cell",
            )?;
            if candidate.birth_block > max_birth_block {
                continue;
            }
            if found.len() >= until {
                break;
            }
            take_candidate(tail, index, candidate, found);
        }
        let entry = &mut tail.assets[index];
        if page.has_more {
            let next = next_cursor(page.next_cursor, "identity family tail")?;
            if let AssetCursor::Family { cursor } = &mut entry.cursor {
                *cursor = Some(next);
            }
        } else {
            entry.exhausted = true;
            break;
        }
    }
    Ok(())
}

/// A collection: list items, then resolve them one lookup at a time.
///
/// The pending queue is what makes this resume rather than restart. An item
/// page is one request and its contents are a hundred, so a turn that meets
/// its ask halfway through a page keeps the rest — the alternative is paying
/// for a page and moving the cursor past most of it.
#[allow(clippy::too_many_arguments)]
async fn step_collection(
    client: &reqwest::Client,
    api_base: &Url,
    tail: &mut CandidateTail,
    index: usize,
    until: usize,
    max_birth_block: u64,
    budget: &mut TurnBudget,
    found: &mut Vec<GalaxyCellCandidate>,
) -> anyhow::Result<()> {
    let Some(family) = collection_family(tail.assets[index].asset.standard) else {
        return Ok(());
    };
    let path = family.path(&tail.assets[index].asset.id);
    while found.len() < until && !budget.is_spent() {
        let AssetCursor::Collection {
            cursor,
            settled,
            pending,
            listed_out,
        } = &mut tail.assets[index].cursor
        else {
            return Ok(());
        };
        let Some(item_args) = pending.pop_front() else {
            if *listed_out {
                tail.assets[index].exhausted = true;
                break;
            }
            let next = fetch_collection_item_page(
                client,
                api_base,
                family.kind,
                &path,
                cursor.as_deref(),
                family.subject,
                pending,
            )
            .await?;
            budget.spend_page();
            match next {
                Some(next) => *cursor = Some(next),
                None => *listed_out = true,
            }
            continue;
        };
        let settled_now = *settled;
        let resolved = resolve_one_item(
            client,
            api_base,
            &item_args,
            family.versions,
            settled_now,
            family.subject,
            budget,
        )
        .await?;
        let Some((version, candidate)) = resolved else {
            // Melted between the index and the walk, or on a deployment
            // that is not pinned. Either way there is no cell to offer.
            continue;
        };
        if let AssetCursor::Collection { settled, .. } = &mut tail.assets[index].cursor {
            *settled = Some(version);
        }
        if candidate.birth_block > max_birth_block {
            continue;
        }
        take_candidate(tail, index, candidate, found);
    }
    Ok(())
}

/// One item's current live cell and the version that found it, or `None` if
/// no pinned deployment answers for it.
async fn resolve_one_item(
    client: &reqwest::Client,
    api_base: &Url,
    item_args: &str,
    versions: &[DeployedScript],
    settled: Option<DeployedScript>,
    subject: &str,
    budget: &mut TurnBudget,
) -> anyhow::Result<Option<(DeployedScript, GalaxyCellCandidate)>> {
    let Some(item_args) = hex_bytes(item_args) else {
        return Ok(None);
    };
    let attempts: &[DeployedScript] = match settled.as_ref() {
        Some(version) => std::slice::from_ref(version),
        None => versions,
    };
    for version in attempts {
        let Some(code_hash) = hash32_bytes(version.code_hash) else {
            continue;
        };
        let hash = type_script_hash_for(&code_hash, version.hash_type, &item_args);
        budget.spend_lookup();
        if let Some(found) = resolve_item_cell(client, api_base, &hash, subject).await? {
            return Ok(Some((*version, found)));
        }
    }
    Ok(None)
}

/// Claim a candidate for one asset, if the tail has not handed it out
/// before. The claim and the delivery are the same act — that is the whole
/// invariant.
fn take_candidate(
    tail: &mut CandidateTail,
    index: usize,
    candidate: GalaxyCellCandidate,
    found: &mut Vec<GalaxyCellCandidate>,
) {
    if tail.emitted.insert(candidate.out_point.clone()) {
        found.push(candidate);
        tail.assets[index].delivered += 1;
    }
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

/// One row of ckbadger's capacity-ranked inventory, reduced to the two
/// things a composition needs from it: where the asset's cells are, and how
/// much of the typed budget it has earned.
///
/// The roster IS this ranking (D1) — `GET /assets?sort_key=capacity` is the
/// same page the inventory UI shows, so the stage's typed class becomes that
/// page read top to bottom. Rank order is the vector's order.
#[derive(Debug, Clone, PartialEq, Eq)]
struct RankedAsset {
    /// Whatever ckbadger keys this asset by — a type-script hash for a token
    /// contract, a cluster id for spore, a collection id for m-nft and
    /// identity. Only [`AssetStandard`] knows which, and reading every one of
    /// them as a script hash is exactly what starved the old walk: for 40 of
    /// 64 groups `cells/live?type_script_hash=<id>` answered `{"data":[]}`
    /// with HTTP 200, which is a success carrying nothing.
    id: String,
    standard: AssetStandard,
    /// Shannons of live capacity the asset occupies. The weight the typed
    /// budget is divided by, never a display figure.
    owned_capacity: u64,
}

/// How an asset's live cells are reached (D3). The row's
/// `(assetType, standard)` pair decides it.
///
/// `assetType` carries the routing; `standard` only disambiguates inside
/// `object` and `identity`. A token standard cknerv has never heard of still
/// keys its cells by a type-script hash, so routing every `token` row to the
/// contract pager is the honest reading — not a guess.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AssetStandard {
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
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum IdentityStandard {
    DotBit,
    BitCell,
    DidCkb,
}

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
async fn ranked_assets(
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
fn is_collection_id(value: &str) -> bool {
    let Some(body) = value.strip_prefix("0x") else {
        return false;
    };
    !body.is_empty()
        && body.len() <= 64
        && body.len() % 2 == 0
        && body.as_bytes().iter().all(u8::is_ascii_hexdigit)
}

/// One ranked asset's slice of a composition's request budget.
///
/// Two numbers because the two families spend differently. A token contract
/// is a group key: one page buys a hundred cells. A collection is an item
/// list, and every item on it costs a `cells/live` lookup of its own — so a
/// collection's real price is counted in ITEMS, and leaving that unbounded
/// would let one row of the roster spend thousands of requests answering for
/// a share it was never allocated.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct GroupBudget {
    /// Index pages this asset's walk may read.
    pages: usize,
    /// Per-item lookups a collection walk may spend inside those pages.
    items: usize,
}

impl GroupBudget {
    /// What one asset's provisional slot count buys it.
    ///
    /// Overfetched like the class itself: hydration drops dead outpoints and
    /// capacity mismatches, so a walk that collects exactly its target
    /// delivers less than its target.
    fn for_target(target: usize) -> Self {
        let items = overfetch(target);
        Self {
            pages: items.div_ceil(PAGE_LIMIT).clamp(1, MAX_PAGES_PER_ASSET),
            items: items.min(MAX_PAGES_PER_ASSET.saturating_mul(PAGE_LIMIT)),
        }
    }
}

// ── the distribution law ──────────────────────────────────────────

/// Divide `total` slots over `weights`, never handing an entry more than its
/// `supply` (D4).
///
/// Largest-remainder proportional targets, then a fixed point: every entry
/// whose target overshoots what it actually holds is clamped to its supply,
/// and the shortfall re-normalizes over the entries still open. wCKB is the
/// case that makes redistribution a law rather than a patch — it ranks first
/// on the live inventory with 19.4% of the top-64 capacity and exactly twelve
/// live cells, so without it a fifth of the typed class would simply
/// evaporate.
///
/// Monotone with rank: `floor(total × wᵢ / Σw)` never decreases as `wᵢ` grows,
/// and where two floors tie the larger weight also carries the larger
/// remainder — so a higher-ranked asset never receives fewer slots than a
/// lower-ranked one of no greater weight. Equal weights break by index, which
/// IS rank order.
///
/// **Termination.** Each round either commits — nothing overshot, so every
/// open entry takes its target and the loop ends — or clamps at least one
/// entry that was open when the round began. A clamped entry never reopens
/// and there are only `count` entries to clamp, so at most `count` rounds can
/// clamp, and the round after the last of them must either commit or find
/// nothing open. `count + 1` rounds is the proof, not a safety valve.
fn allocate(weights: &[u64], supply: &[usize], total: usize) -> Vec<usize> {
    let count = weights.len().min(supply.len());
    let mut allocation = vec![0usize; count];
    let mut clamped = vec![false; count];
    let mut remaining = total;

    for _ in 0..=count {
        if remaining == 0 {
            break;
        }
        let open: Vec<usize> = (0..count).filter(|index| !clamped[*index]).collect();
        let pool: u128 = open.iter().map(|index| u128::from(weights[*index])).sum();
        // A zero-weight entry earns nothing: the weights are occupied
        // capacity, and an asset occupying none has no claim on a class
        // divided by capacity. A pool of zero leaves no one to divide by,
        // which ends the split rather than spreading it evenly.
        if open.is_empty() || pool == 0 {
            break;
        }
        let targets = largest_remainder(remaining, &open, weights, pool);
        let overshot: Vec<usize> = open
            .iter()
            .copied()
            .zip(&targets)
            .filter(|(index, target)| **target > supply[*index])
            .map(|(index, _)| index)
            .collect();
        if overshot.is_empty() {
            for (index, target) in open.into_iter().zip(targets) {
                allocation[index] = target;
            }
            break;
        }
        for index in overshot {
            // `supply < target` for everything that overshot and the targets
            // sum to `remaining`, so this subtraction cannot go under.
            allocation[index] = supply[index];
            clamped[index] = true;
            remaining -= supply[index];
        }
    }
    allocation
}

/// The proportional split with nothing to clamp against — what an asset would
/// earn if every asset could fill its share. It buys the walk's request
/// budget; the slots themselves are allocated again, over what was collected.
fn proportional(weights: &[u64], total: usize) -> Vec<usize> {
    allocate(weights, &vec![usize::MAX; weights.len()], total)
}

/// `remaining` shared over `open` in proportion to `weights`: floors first,
/// then the leftover to the largest remainders, ties to the lower index —
/// which is the higher rank.
///
/// `u128` because the product is a class budget times a mountain of shannons:
/// today's leading asset alone occupies 3.5 × 10¹⁵, and ten thousand slots of
/// that overflows a `u64` by an order of magnitude.
fn largest_remainder(remaining: usize, open: &[usize], weights: &[u64], pool: u128) -> Vec<usize> {
    let total = remaining as u128;
    let mut targets = Vec::with_capacity(open.len());
    let mut remainders: Vec<(u128, usize)> = Vec::with_capacity(open.len());
    let mut floors: u128 = 0;
    for (slot, index) in open.iter().enumerate() {
        let scaled = total * u128::from(weights[*index]);
        let share = scaled / pool;
        targets.push(share as usize);
        remainders.push((scaled % pool, slot));
        floors += share;
    }
    remainders.sort_by(|left, right| right.0.cmp(&left.0).then_with(|| left.1.cmp(&right.1)));
    let mut leftover = total - floors;
    for (_, slot) in remainders {
        if leftover == 0 {
            break;
        }
        targets[slot] += 1;
        leftover -= 1;
    }
    targets
}

// ── collections: items, and the cells behind them ─────────────────

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
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct DeployedScript {
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
#[derive(Default)]
struct GroupWalk {
    candidates: Vec<GalaxyCellCandidate>,
    melted: usize,
    stopped_by: Option<anyhow::Error>,
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

/// One page of a collection's item list, appending each live item's `args`
/// and answering with the cursor that follows it — `None` at the end of the
/// list.
///
/// The unit both callers work in: a composition reads a few of these in a
/// row, a top-up reads exactly one and keeps the rest of what it bought
/// (`AssetCursor::Collection::pending`).
async fn fetch_item_page<T: DeserializeOwned + CollectionRow>(
    client: &reqwest::Client,
    api_base: &Url,
    path: &str,
    cursor: Option<&str>,
    subject: &str,
    args: &mut VecDeque<String>,
) -> anyhow::Result<Option<String>> {
    let mut url = endpoint(api_base, path)?;
    {
        let mut query = url.query_pairs_mut();
        query.append_pair("limit", &PAGE_LIMIT.to_string());
        if let Some(cursor) = cursor {
            query.append_pair("cursor", cursor);
        }
    }
    let page: CursorPage<T> = fetch_json(client, url, subject).await?;
    validate_page_size(page.data.len(), PAGE_LIMIT, subject)?;
    for row in page.data {
        if let Some(item_args) = row.live_args() {
            args.push_back(item_args);
        }
    }
    if !page.has_more {
        return Ok(None);
    }
    Ok(Some(next_cursor(page.next_cursor, subject)?))
}

/// The same page read, with the row shape chosen by the family.
async fn fetch_collection_item_page(
    client: &reqwest::Client,
    api_base: &Url,
    kind: CollectionKind,
    path: &str,
    cursor: Option<&str>,
    subject: &str,
    args: &mut VecDeque<String>,
) -> anyhow::Result<Option<String>> {
    match kind {
        CollectionKind::Spore => {
            fetch_item_page::<SporeItemResponse>(client, api_base, path, cursor, subject, args)
                .await
        }
        CollectionKind::Object => {
            fetch_item_page::<ObjectItemResponse>(client, api_base, path, cursor, subject, args)
                .await
        }
    }
}

/// Pages one collection's item list, appending each live item's `args`.
///
/// `Result`-shaped so a failing page stops the collection exactly where it
/// happened, leaving the caller holding every item read up to that point.
async fn walk_collection_items(
    client: &reqwest::Client,
    api_base: &Url,
    kind: CollectionKind,
    path: &str,
    max_pages: usize,
    subject: &str,
    args: &mut VecDeque<String>,
) -> anyhow::Result<()> {
    let mut cursor: Option<String> = None;
    for _ in 0..max_pages {
        cursor = fetch_collection_item_page(
            client,
            api_base,
            kind,
            path,
            cursor.as_deref(),
            subject,
            args,
        )
        .await?;
        if cursor.is_none() {
            break;
        }
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
async fn fetch_spore_group(
    client: &reqwest::Client,
    api_base: &Url,
    cluster_id: &str,
    settled: &mut Option<DeployedScript>,
    budget: GroupBudget,
) -> GroupWalk {
    fetch_collection_group(
        client,
        api_base,
        &SPORE_FAMILY.path(cluster_id),
        SPORE_FAMILY,
        settled,
        budget,
    )
    .await
}

/// Every live cell the walk can reach for one M-NFT collection.
async fn fetch_mnft_group(
    client: &reqwest::Client,
    api_base: &Url,
    collection_id: &str,
    settled: &mut Option<DeployedScript>,
    budget: GroupBudget,
) -> GroupWalk {
    fetch_collection_group(
        client,
        api_base,
        &MNFT_FAMILY.path(collection_id),
        MNFT_FAMILY,
        settled,
        budget,
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

impl CollectionFamily {
    /// Where this family's item list lives. The routes are nested — a flat
    /// probe 404s — which is most of why the collections looked unreachable.
    fn path(&self, id: &str) -> String {
        match self.kind {
            CollectionKind::Spore => format!("spore/clusters/{id}/spores"),
            CollectionKind::Object => format!("assets/objects/{id}/items"),
        }
    }
}

/// The collection family behind a ranked asset, or `None` for a standard
/// that is not paged through an item list at all.
fn collection_family(standard: AssetStandard) -> Option<CollectionFamily> {
    match standard {
        AssetStandard::Spore => Some(SPORE_FAMILY),
        AssetStandard::MNft => Some(MNFT_FAMILY),
        _ => None,
    }
}

async fn fetch_collection_group(
    client: &reqwest::Client,
    api_base: &Url,
    path: &str,
    family: CollectionFamily,
    settled: &mut Option<DeployedScript>,
    budget: GroupBudget,
) -> GroupWalk {
    let CollectionFamily {
        kind,
        versions,
        subject,
    } = family;
    let mut walk = GroupWalk::default();
    let mut args = VecDeque::new();
    let listed = walk_collection_items(
        client,
        api_base,
        kind,
        path,
        budget.pages,
        subject,
        &mut args,
    )
    .await;
    // Items already listed are still worth resolving even if the page after
    // them failed — the same rule the class walks obey, one level down.
    walk.stopped_by = listed.err();
    // The item budget bites HERE rather than at the page: a list page is one
    // request, resolving what it lists is a hundred. An asset allocated a
    // dozen slots reads its collection's head and stops, and the items past
    // it are where the tail resumes.
    let listed_items = args.len();
    args.truncate(budget.items);
    let args: Vec<String> = args.into();
    if let Err(error) = resolve_collection_items(
        client, api_base, &args, versions, settled, subject, &mut walk,
    )
    .await
    {
        walk.stopped_by.get_or_insert(error);
    }
    report_collection_walk(path, listed_items, args.len(), &walk);
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
fn report_collection_walk(path: &str, listed: usize, resolved_from: usize, walk: &GroupWalk) {
    if resolved_from > 0 && walk.candidates.is_empty() {
        tracing::warn!(
            target: "cknerv-adapter-ckbadger",
            collection = %path,
            listed,
            attempted = resolved_from,
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
pub(crate) fn identity_standard_for_name(name: &str) -> Option<IdentityStandard> {
    match name {
        ".bit Account" => Some(IdentityStandard::DotBit),
        ".bit Cell" => Some(IdentityStandard::BitCell),
        "did:ckb" => Some(IdentityStandard::DidCkb),
        _ => None,
    }
}

/// The same table read the other way, so a deferred collection can be named
/// in a log rather than counted in one. Exhaustive on purpose: a fourth
/// identity standard must not be able to reach the roster nameless.
fn identity_standard_name(standard: IdentityStandard) -> &'static str {
    match standard {
        IdentityStandard::DotBit => ".bit Account",
        IdentityStandard::BitCell => ".bit Cell",
        IdentityStandard::DidCkb => "did:ckb",
    }
}

/// Joins the census against the registry: which `(code_hash, hash_type)` each
/// identity collection means.
///
/// Pure, and pure on purpose — the census and the name lookup both live in
/// `source.rs`, and this is the only part of the question worth testing.
/// `name_of` answers for a `0x`-prefixed code hash; its name outlives the
/// hash it was asked about, because the caller's answers come from a lookup
/// table rather than from the string it passed in.
///
/// A family with several deployed versions on stage contributes the first the
/// census reports; the walk pages one version per composition and the others
/// keep reaching the stage the way they do today, through block-following.
/// A standard absent from the result is one this composition cannot page —
/// the cold-start case (R1), where the census has not yet seen the family.
pub(crate) fn identity_families<'name>(
    observed: &[ScriptId],
    name_of: impl Fn(&str) -> Option<&'name str>,
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
async fn fetch_identity_group(
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

/// The typed class: ckbadger's inventory page, read top to bottom.
///
/// Every ranked asset is walked through the mechanism its standard names
/// (D3), and the class is then divided among them in proportion to the
/// capacity they occupy (D4) — twice. The first split is provisional and buys
/// each asset its request budget; the second runs over what the walks
/// actually collected, so an asset that ran dry gives its shortfall back to
/// the rest instead of taking it off the stage.
async fn discover_typed(
    client: &reqwest::Client,
    api_base: &Url,
    desired: usize,
    identity_families: &HashMap<IdentityStandard, ScriptId>,
    seen: &mut HashSet<OutPoint>,
) -> ClassWalk {
    if desired == 0 {
        return ClassWalk::default();
    }
    // Without a roster there are no assets to walk, so a failure here is a
    // class that collected nothing.
    let roster = match ranked_assets(client, api_base).await {
        Ok(roster) => roster,
        Err(error) => return ClassWalk::stopped(error),
    };
    report_roster(&roster, identity_families);
    if roster.is_empty() {
        return ClassWalk::default();
    }

    let weights: Vec<u64> = roster.iter().map(|asset| asset.owned_capacity).collect();
    let provisional = proportional(&weights, desired);
    // The futures are built before the stream rather than by it: a closure
    // that borrows the roster and returns an async block cannot be
    // higher-ranked over the borrow, and `buffer_unordered` asks for exactly
    // that.
    let jobs: Vec<_> = roster
        .iter()
        .zip(provisional)
        .enumerate()
        .map(|(rank, (asset, target))| async move {
            let walk = walk_ranked_asset(
                client,
                api_base,
                asset,
                GroupBudget::for_target(target),
                identity_families,
            )
            .await;
            (rank, walk)
        })
        .collect();
    let mut walks: Vec<(usize, GroupWalk)> = stream::iter(jobs)
        .buffer_unordered(GROUP_FETCH_CONCURRENCY)
        .collect::<Vec<_>>()
        .await;
    walks.sort_by_key(|(rank, _)| *rank);

    // The first failure in RANK order, never in completion order: which cause
    // a class reports must not depend on which request happened to finish
    // first. One asset stopping short is a thinner class, not a broken one —
    // the same rule the classes themselves obey, one level down.
    let stopped_by = walks
        .iter_mut()
        .find_map(|(_, walk)| walk.stopped_by.take());

    // Rank decides who keeps an outpoint two assets both offered, and the
    // shared `seen` keeps the typed class off what DAO already took. Both
    // happen BEFORE the allocation counts anything, so a duplicate can never
    // be allocated a slot it then fails to fill.
    let mut staged: HashSet<OutPoint> = HashSet::with_capacity(desired);
    for (_, walk) in &mut walks {
        walk.candidates.retain(|candidate| {
            !seen.contains(&candidate.out_point) && staged.insert(candidate.out_point.clone())
        });
    }

    let collected: Vec<usize> = walks
        .iter()
        .map(|(_, walk)| walk.candidates.len())
        .collect();
    let allocation = allocate(&weights, &collected, desired);

    let mut candidates = Vec::with_capacity(desired.min(staged.len()));
    for ((_, walk), take) in walks.into_iter().zip(allocation) {
        // The pager's own order within an asset: capacity-desc for a token
        // contract, item order for a collection (D4.3).
        for candidate in walk.candidates.into_iter().take(take) {
            seen.insert(candidate.out_point.clone());
            candidates.push(candidate);
        }
    }
    ClassWalk {
        candidates,
        stopped_by,
    }
}

/// One ranked asset's live cells, by whichever route its standard makes
/// reachable (D3).
async fn walk_ranked_asset(
    client: &reqwest::Client,
    api_base: &Url,
    asset: &RankedAsset,
    budget: GroupBudget,
    identity_families: &HashMap<IdentityStandard, ScriptId>,
) -> GroupWalk {
    match asset.standard {
        AssetStandard::Token => {
            let mut walk = GroupWalk::default();
            match fetch_live_group(
                client,
                api_base,
                "type_script_hash",
                &asset.id,
                LiveClass::Typed(&asset.id),
                budget.pages,
            )
            .await
            {
                Ok(candidates) => walk.candidates = candidates,
                Err(error) => walk.stopped_by = Some(error),
            }
            walk
        }
        AssetStandard::Spore => {
            let mut settled = None;
            fetch_spore_group(client, api_base, &asset.id, &mut settled, budget).await
        }
        AssetStandard::MNft => {
            let mut settled = None;
            fetch_mnft_group(client, api_base, &asset.id, &mut settled, budget).await
        }
        // An identity collection the census has not resolved yet contributes
        // nothing and costs nothing. `report_roster` has already named it.
        AssetStandard::Identity(standard) => match identity_families.get(&standard) {
            Some(family) => fetch_identity_group(client, api_base, family, budget.pages).await,
            None => GroupWalk::default(),
        },
    }
}

/// What the inventory ranking actually offered this composition, said once.
///
/// The old head dropped forty of sixty-four groups without a word — eleven
/// filtered by a hash-shaped guard, twenty-nine answered `{"data":[]}` with
/// HTTP 200 — so the gap took a live measurement to find rather than a log
/// line to read. A roster the operator cannot see is a roster nobody can
/// check, which is why this is `info` and not `debug`.
fn report_roster(roster: &[RankedAsset], identity_families: &HashMap<IdentityStandard, ScriptId>) {
    let summary = roster_summary(roster, identity_families);
    tracing::info!(
        target: "cknerv-adapter-ckbadger",
        assets = summary.assets,
        tokens = summary.tokens,
        spore = summary.spore,
        mnft = summary.mnft,
        identity = summary.identity,
        "the inventory ranking is this composition's typed roster"
    );
    if !summary.deferred.is_empty() {
        // Cold start (R1). The census is what names identity families and it
        // has not named these yet, so their collections wait for the next
        // composition rather than pretending to be empty.
        tracing::warn!(
            target: "cknerv-adapter-ckbadger",
            deferred = %summary.deferred.join(", "),
            "the census has not yet named these identity families; their \
             ranked collections contribute nothing to this composition"
        );
    }
}

/// The roster counted by family — what the log line carries, separated from
/// the logging so the counting can be asserted on without a subscriber.
#[derive(Debug, Default, PartialEq, Eq)]
struct RosterSummary {
    assets: usize,
    tokens: usize,
    spore: usize,
    mnft: usize,
    identity: usize,
    /// Identity families on the roster the census cannot name yet, by the
    /// name the registry gives them.
    deferred: Vec<&'static str>,
}

fn roster_summary(
    roster: &[RankedAsset],
    identity_families: &HashMap<IdentityStandard, ScriptId>,
) -> RosterSummary {
    let mut summary = RosterSummary {
        assets: roster.len(),
        ..RosterSummary::default()
    };
    for asset in roster {
        match asset.standard {
            AssetStandard::Token => summary.tokens += 1,
            AssetStandard::Spore => summary.spore += 1,
            AssetStandard::MNft => summary.mnft += 1,
            AssetStandard::Identity(standard) => {
                summary.identity += 1;
                let name = identity_standard_name(standard);
                if !identity_families.contains_key(&standard) && !summary.deferred.contains(&name) {
                    summary.deferred.push(name);
                }
            }
        }
    }
    summary
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

/// One inventory row, in full: the whole of what `/assets` says about an
/// asset that the composition has any use for.
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
                                asset_row(&format!("0x{:064x}", 0xaa), "token", "xudt", "600"),
                                asset_row(&format!("0x{:064x}", 0xbb), "token", "sudt", "400"),
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

        let first = top_up(
            &client,
            &api,
            anchor(),
            &mut tail,
            150,
            0,
            &HashMap::new(),
            1,
        )
        .await
        .unwrap();
        assert_eq!(first.dao.len(), 150, "exactly the ask, never a page more");
        let second = top_up(
            &client,
            &api,
            anchor(),
            &mut tail,
            150,
            0,
            &HashMap::new(),
            1,
        )
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

        let got = top_up(
            &client,
            &api,
            anchor(),
            &mut tail,
            200,
            0,
            &HashMap::new(),
            1,
        )
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

        let first = top_up(
            &client,
            &api,
            anchor(),
            &mut tail,
            500,
            0,
            &HashMap::new(),
            1,
        )
        .await
        .unwrap();
        assert_eq!(first.dao.len(), 150, "the whole index");
        assert!(tail.dao_exhausted);

        // Nothing new to give, but the cursor is reset for next time.
        let second = top_up(
            &client,
            &api,
            anchor(),
            &mut tail,
            500,
            0,
            &HashMap::new(),
            1,
        )
        .await
        .unwrap();
        assert!(second.dao.is_empty());
        assert!(!tail.dao_exhausted && tail.dao_cursor.is_none(), "rewound");
        let third = top_up(
            &client,
            &api,
            anchor(),
            &mut tail,
            500,
            0,
            &HashMap::new(),
            1,
        )
        .await
        .unwrap();
        assert!(third.dao.is_empty(), "everything is already emitted");
        server.abort();
    }

    /// A typed turn is divided by the SAME capacity weights a full
    /// composition divides by, so a top-up cannot drift the stage's mix away
    /// from the one discovery established. Weights 600/400 over 250 slots
    /// want 150 and 100.
    #[tokio::test]
    async fn a_typed_turn_serves_each_asset_its_weighted_deficit() {
        let (api, server, requests) = spawn_index(0, 1_000).await;
        let client = reqwest::Client::new();
        let mut tail = CandidateTail::default();

        let got = top_up(
            &client,
            &api,
            anchor(),
            &mut tail,
            0,
            250,
            &HashMap::new(),
            1,
        )
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
        assert_eq!(
            (from_a, from_b),
            (150, 100),
            "three fifths to the heavier asset, two fifths to the lighter"
        );
        assert!(requests.load(Ordering::Relaxed) <= MAX_PAGES_PER_TOP_UP + 1);
        // A second turn resumes deeper and holds the same proportions, so
        // the mix is a property of the tail rather than of its first call.
        let again = top_up(
            &client,
            &api,
            anchor(),
            &mut tail,
            0,
            250,
            &HashMap::new(),
            1,
        )
        .await
        .unwrap();
        assert_eq!(again.typed.len(), 250);
        assert_eq!(
            again
                .typed
                .iter()
                .filter(|c| c.out_point.tx_hash.starts_with("0xaa"))
                .count(),
            150,
            "and the roster was taken once, not once per turn"
        );
        server.abort();
    }

    /// One turn is bounded even when the ask is enormous — the shortfall
    /// simply takes more turns.
    #[tokio::test]
    async fn one_turn_pages_at_most_the_bound() {
        let (api, server, requests) = spawn_index(100_000, 0).await;
        let client = reqwest::Client::new();
        let mut tail = CandidateTail::default();

        let got = top_up(
            &client,
            &api,
            anchor(),
            &mut tail,
            100_000,
            0,
            &HashMap::new(),
            1,
        )
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
        let got = top_up(&client, &api, early, &mut tail, 50, 0, &HashMap::new(), 1)
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

        let rejected = top_up(&client, &api, early, &mut tail, 100, 0, &HashMap::new(), 1)
            .await
            .unwrap();
        assert!(rejected.dao.is_empty(), "every mock deposit is at block 10");

        // One page was the whole index, so the tail is exhausted; the next
        // turn only rewinds (it never re-reads within the same call).
        let rewind = top_up(
            &client,
            &api,
            anchor(),
            &mut tail,
            100,
            0,
            &HashMap::new(),
            1,
        )
        .await
        .unwrap();
        assert!(rewind.dao.is_empty(), "the rewind turn hands out nothing");

        // The anchor has caught up. Nothing was claimed by the walk that
        // rejected them, so the whole index is offerable again.
        let taken = top_up(
            &client,
            &api,
            anchor(),
            &mut tail,
            100,
            0,
            &HashMap::new(),
            1,
        )
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

    /// The two class targets a full-size composition actually asks for —
    /// dao and typed at the stage budget — and what each costs in
    /// discovery once the 125% overfetch is on top.
    #[test]
    fn composition_overfetch_is_bounded() {
        assert_eq!(overfetch(0), 0);
        assert_eq!(overfetch(2_400), 3_000);
        assert_eq!(overfetch(8_400), 10_500);
        // Rounds up: a target of one still costs a candidate to miss on.
        assert_eq!(overfetch(1), 2);
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

    /// What a pager test wants: the page cap, and no item cap at all, so
    /// each assertion is about the pager rather than about the budget.
    const WHOLE_LIST: GroupBudget = GroupBudget {
        pages: MAX_PAGES_PER_ASSET,
        items: usize::MAX,
    };

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
            WHOLE_LIST,
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
            WHOLE_LIST,
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
            WHOLE_LIST,
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

    // ── T4: the weighted split, and the walk that obeys it ────────

    /// A clean split: four equal weights over a total that divides, so every
    /// entry gets exactly its quarter and nothing rides on the remainder.
    #[test]
    fn a_clean_split_is_exactly_proportional() {
        assert_eq!(
            allocate(&[1, 1, 1, 1], &[100, 100, 100, 100], 40),
            vec![10, 10, 10, 10]
        );
        assert_eq!(
            allocate(&[6_000, 3_000, 1_000], &[100, 100, 100], 100),
            vec![60, 30, 10]
        );
    }

    /// Monotone with rank, which is what makes "the stage's typed class is
    /// the inventory page, top to bottom" true of the result and not just of
    /// the intention. Equal weights break by index, so rank still decides.
    #[test]
    fn a_heavier_entry_never_receives_fewer_slots() {
        let weights = [9_000_u64, 9_000, 5_000, 5_000, 1, 0];
        let supply = vec![10_000; weights.len()];
        let allocation = allocate(&weights, &supply, 997);
        for pair in allocation.windows(2) {
            assert!(
                pair[0] >= pair[1],
                "rank order was broken: {allocation:?} for {weights:?}"
            );
        }
        assert_eq!(
            allocation.iter().sum::<usize>(),
            997,
            "every slot is spent: {allocation:?}"
        );
        assert_eq!(*allocation.last().unwrap(), 0, "a zero weight earns zero");
        // Equal weights are separated by index alone, and the leftover goes
        // up the ranking.
        assert!(allocation[0] >= allocation[1]);
        assert!(allocation[2] >= allocation[3]);
    }

    /// The wCKB case — the one that makes redistribution a law rather than a
    /// patch. It ranks FIRST on the live inventory with 19.4% of the top-64
    /// capacity and holds exactly twelve live cells; without the shortfall
    /// re-normalizing, a fifth of the typed class would evaporate into an
    /// asset that cannot fill it.
    #[test]
    fn an_exhausted_asset_keeps_what_it_has_and_gives_back_the_rest() {
        // 19.4% / 80.6%, over the class's 7,800 slots.
        let weights = [194_u64, 806];
        let allocation = allocate(&weights, &[12, 100_000], 7_800);
        assert_eq!(
            allocation,
            vec![12, 7_788],
            "wCKB takes the twelve it has and hands back 1,501 slots"
        );

        // And the redistribution is itself proportional: three assets, the
        // first clamped, the other two splitting what it could not take.
        assert_eq!(
            allocate(&[500, 300, 200], &[10, 1_000, 1_000], 100),
            vec![10, 54, 36]
        );
    }

    /// Degeneracies, each of which the live roster can produce: an asset
    /// occupying no capacity, a roster that is empty, an ask of nothing, and
    /// an ask larger than everything on offer.
    #[test]
    fn the_split_survives_its_degenerate_inputs() {
        assert_eq!(allocate(&[0, 0], &[50, 50], 20), vec![0, 0]);
        assert_eq!(allocate(&[5, 0], &[50, 50], 20), vec![20, 0]);
        assert_eq!(allocate(&[], &[], 20), Vec::<usize>::new());
        assert_eq!(allocate(&[7, 3], &[50, 50], 0), vec![0, 0]);

        let everything = allocate(&[7, 3, 1], &[4, 9, 2], 10_000);
        assert_eq!(
            everything,
            vec![4, 9, 2],
            "an ask past the supply takes the supply and stops"
        );
        assert_eq!(everything.iter().sum::<usize>(), 15);
    }

    /// The budget an asset's provisional share buys it, and the two ceilings
    /// that keep one row of the roster from spending a composition.
    #[test]
    fn a_group_budget_is_bounded_in_pages_and_in_items() {
        assert_eq!(
            GroupBudget::for_target(0),
            GroupBudget { pages: 1, items: 0 }
        );
        assert_eq!(
            GroupBudget::for_target(12),
            GroupBudget {
                pages: 1,
                items: 15
            }
        );
        assert_eq!(
            GroupBudget::for_target(120),
            GroupBudget {
                pages: 2,
                items: 150
            }
        );
        assert_eq!(
            GroupBudget::for_target(100_000),
            GroupBudget {
                pages: MAX_PAGES_PER_ASSET,
                items: MAX_PAGES_PER_ASSET * PAGE_LIMIT,
            },
            "no asset outgrows the per-asset ceiling, whatever it is owed"
        );
    }

    /// The roster the log line carries, counted. A roster the operator
    /// cannot see is a roster nobody can check — the old head dropped forty
    /// of sixty-four groups in silence.
    #[test]
    fn the_roster_log_counts_every_family_and_names_what_is_deferred() {
        let roster = vec![
            ranked(TOKEN_ID, AssetStandard::Token, 4_000),
            ranked(CLUSTER_ID, AssetStandard::Spore, 3_000),
            ranked(
                DOTBIT_ID,
                AssetStandard::Identity(IdentityStandard::DotBit),
                2_000,
            ),
            ranked(MNFT_ID, AssetStandard::MNft, 1_000),
        ];
        assert_eq!(
            roster_summary(&roster, &HashMap::new()),
            RosterSummary {
                assets: 4,
                tokens: 1,
                spore: 1,
                mnft: 1,
                identity: 1,
                deferred: vec![".bit Account"],
            }
        );

        let mut families = HashMap::new();
        families.insert(IdentityStandard::DotBit, identity_family());
        assert!(
            roster_summary(&roster, &families).deferred.is_empty(),
            "a named family is not deferred"
        );
    }

    /// Every identity standard can be named, and the name it is given is the
    /// one the join reads back.
    #[test]
    fn an_identity_standard_and_its_registry_name_agree_both_ways() {
        for standard in [
            IdentityStandard::DotBit,
            IdentityStandard::BitCell,
            IdentityStandard::DidCkb,
        ] {
            let name = identity_standard_name(standard);
            assert_eq!(identity_standard_for_name(name), Some(standard), "{name}");
        }
    }

    fn ranked(id: &str, standard: AssetStandard, owned_capacity: u64) -> RankedAsset {
        RankedAsset {
            id: id.to_string(),
            standard,
            owned_capacity,
        }
    }

    fn identity_family() -> ScriptId {
        ScriptId::parse(&format!("0x{:064x}", 0xbb), "type").unwrap()
    }

    /// How much of each family the diverse index has to offer.
    #[derive(Clone, Copy)]
    struct DiverseShape {
        token_cells: usize,
        spore_items: usize,
        /// How many items the cluster serves per item-list page.
        spore_page_size: usize,
        /// When set, the cluster's item list serves this many items on its
        /// first page and answers HTTP 500 for every page after it.
        spore_breaks_after: Option<usize>,
        mnft_items: usize,
        identity_rows: usize,
        /// A DAO deposit that IS the first token cell, so the shared `seen`
        /// has something real to catch.
        dao_collides_with_token: bool,
    }

    impl Default for DiverseShape {
        fn default() -> Self {
            Self {
                token_cells: 20,
                spore_items: 30,
                spore_page_size: PAGE_LIMIT,
                spore_breaks_after: None,
                mnft_items: 2,
                identity_rows: 8,
                dao_collides_with_token: false,
            }
        }
    }

    fn spore_arg(index: usize) -> String {
        format!("0x{index:064x}")
    }

    /// 28 bytes, the width of an M-NFT id.
    fn mnft_arg(index: usize) -> String {
        format!("0x{index:056x}")
    }

    fn tagged_cell(tag: u8, index: usize, hash: Option<String>, lock: String) -> serde_json::Value {
        serde_json::json!({
            "txHash": format!("0x{tag:02x}{index:062x}"),
            "outputIndex": 0,
            // Descending, so a capacity-desc pager has a stable order.
            "capacity": (200_000_000_000_u64 - index as u64).to_string(),
            "createdAtBlock": 10,
            "typeScriptHash": hash,
            "lockScriptHash": lock,
        })
    }

    const TOKEN_TAG: u8 = 0xa1;
    const SPORE_TAG: u8 = 0xb2;
    const IDENTITY_TAG: u8 = 0xc3;
    const MNFT_TAG: u8 = 0xd4;
    const DAO_TAG: u8 = 0xe5;
    const PLAIN_TAG: u8 = 0xf6;
    const PLAIN_LOCK: &str = "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";

    /// Which ranked asset each candidate came from, by the tag its mock
    /// stamped on the transaction hash.
    fn by_asset(candidates: &[GalaxyCellCandidate]) -> BTreeMap<u8, usize> {
        let mut tally = BTreeMap::new();
        for candidate in candidates {
            let tag = u8::from_str_radix(&candidate.out_point.tx_hash[2..4], 16).unwrap();
            *tally.entry(tag).or_insert(0) += 1;
        }
        tally
    }

    /// One inventory page carrying all four mechanisms, and every endpoint
    /// behind them: a token contract, a spore cluster, a `.bit` family and an
    /// m-nft collection, plus the DAO and plain heads a full composition
    /// walks.
    async fn spawn_diverse_index(
        shape: DiverseShape,
    ) -> (Url, tokio::task::JoinHandle<()>, Arc<Mutex<Vec<String>>>) {
        // Every cursor the cluster's item list was asked with, "head" for
        // the request that carried none.
        let listed = Arc::new(Mutex::new(Vec::new()));
        let logged = listed.clone();
        let mut live: BTreeMap<String, serde_json::Value> = BTreeMap::new();
        let spore_version = SPORE_VERSIONS[0];
        for index in 0..shape.spore_items.max(shape.spore_breaks_after.unwrap_or(0)) {
            let hash = hash_under(&spore_version, &spore_arg(index));
            live.insert(
                hash.clone(),
                tagged_cell(SPORE_TAG, index, Some(hash), PLAIN_LOCK.to_string()),
            );
        }
        for index in 0..shape.mnft_items {
            let hash = hash_under(&MNFT_VERSIONS[0], &mnft_arg(index));
            live.insert(
                hash.clone(),
                tagged_cell(MNFT_TAG, index, Some(hash), PLAIN_LOCK.to_string()),
            );
        }

        let token_cells = shape.token_cells;
        let app = Router::new()
            .route(
                "/api/v1/assets",
                get(move || async move {
                    Json(serde_json::json!({
                        "data": [
                            asset_row(TOKEN_ID, "token", "xudt", "4000"),
                            asset_row(CLUSTER_ID, "object", "spore", "3000"),
                            asset_row(DOTBIT_ID, "identity", "dotbit", "2000"),
                            asset_row(MNFT_ID, "object", "m-nft", "1000"),
                        ],
                        "hasMore": false,
                        "nextCursor": None::<String>,
                    }))
                }),
            )
            .route(
                "/api/v1/spore/clusters/:id/spores",
                get(move |Query(q): Query<BTreeMap<String, String>>| {
                    let logged = logged.clone();
                    async move {
                        logged
                            .lock()
                            .unwrap()
                            .push(q.get("cursor").cloned().unwrap_or_else(|| "head".into()));
                        let page: usize = q.get("cursor").and_then(|c| c.parse().ok()).unwrap_or(0);
                        if let Some(first) = shape.spore_breaks_after {
                            if page > 0 {
                                return (
                                    axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                                    Json(serde_json::json!({ "error": "internal_error" })),
                                );
                            }
                            return (
                                axum::http::StatusCode::OK,
                                Json(serde_json::json!({
                                    "data": (0..first)
                                        .map(|i| serde_json::json!({ "sporeId": spore_arg(i) }))
                                        .collect::<Vec<_>>(),
                                    "hasMore": true,
                                    "nextCursor": Some("1".to_string()),
                                })),
                            );
                        }
                        let from = page * shape.spore_page_size;
                        let to = (from + shape.spore_page_size).min(shape.spore_items);
                        (
                            axum::http::StatusCode::OK,
                            Json(serde_json::json!({
                                "data": (from..to)
                                    .map(|i| serde_json::json!({ "sporeId": spore_arg(i) }))
                                    .collect::<Vec<_>>(),
                                "hasMore": to < shape.spore_items,
                                "nextCursor": if to < shape.spore_items {
                                    Some((page + 1).to_string())
                                } else {
                                    None
                                },
                            })),
                        )
                    }
                }),
            )
            .route(
                "/api/v1/assets/objects/:id/items",
                get(move || async move {
                    Json(serde_json::json!({
                        "data": (0..shape.mnft_items)
                            .map(|i| serde_json::json!({ "nftId": mnft_arg(i), "isLive": true }))
                            .collect::<Vec<_>>(),
                        "hasMore": false,
                        "nextCursor": None::<String>,
                    }))
                }),
            )
            .route(
                "/api/v1/cells/by-script",
                get(move || async move {
                    Json(serde_json::json!({
                        "data": (0..shape.identity_rows)
                            .map(|i| serde_json::json!({
                                "txHash": format!("0x{IDENTITY_TAG:02x}{i:062x}"),
                                "outputIndex": 0,
                                "capacity": "23699989753",
                                "createdAtBlock": 10,
                                "lockScriptHash": PLAIN_LOCK,
                                "typeScriptHash": format!("0x{:064x}", 0x51 + i),
                                "typeCodeHash": identity_family().code_hash_hex(),
                                "matchedScriptKind": "type",
                            }))
                            .collect::<Vec<_>>(),
                        "hasMore": false,
                        "nextCursor": None::<String>,
                    }))
                }),
            )
            .route(
                "/api/v1/dao/deposits",
                get(move || async move {
                    let tag = if shape.dao_collides_with_token {
                        TOKEN_TAG
                    } else {
                        DAO_TAG
                    };
                    Json(serde_json::json!({
                        "data": [serde_json::json!({
                            "txHash": format!("0x{tag:02x}{:062x}", 0),
                            "outputIndex": 0,
                            "capacity": "100000000000",
                            "depositBlockNumber": 10,
                            "status": "deposited",
                        })],
                        "hasMore": false,
                        "nextCursor": None::<String>,
                    }))
                }),
            )
            .route(
                "/api/v1/addresses/top",
                get(|| async { Json(serde_json::json!([{ "lockScriptHash": PLAIN_LOCK }])) }),
            )
            .route(
                "/api/v1/addresses/active",
                get(|| async { Json(serde_json::json!([])) }),
            )
            .route(
                "/api/v1/cells/live",
                get(move |Query(q): Query<BTreeMap<String, String>>| {
                    let live = live.clone();
                    async move {
                        if let Some(hash) = q.get("type_script_hash") {
                            if hash == TOKEN_ID {
                                return Json(serde_json::json!({
                                    "data": (0..token_cells)
                                        .map(|i| tagged_cell(
                                            TOKEN_TAG,
                                            i,
                                            Some(TOKEN_ID.to_string()),
                                            PLAIN_LOCK.to_string(),
                                        ))
                                        .collect::<Vec<_>>(),
                                    "hasMore": false,
                                    "nextCursor": None::<String>,
                                }));
                            }
                            return Json(serde_json::json!({
                                "data": live.get(hash).cloned().into_iter().collect::<Vec<_>>(),
                                "hasMore": false,
                                "nextCursor": None::<String>,
                            }));
                        }
                        Json(serde_json::json!({
                            "data": (0..4)
                                .map(|i| tagged_cell(PLAIN_TAG, i, None, PLAIN_LOCK.to_string()))
                                .collect::<Vec<_>>(),
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
            listed,
        )
    }

    fn resolved_families() -> HashMap<IdentityStandard, ScriptId> {
        HashMap::from([(IdentityStandard::DotBit, identity_family())])
    }

    /// The whole point of the work: a typed class made of four different
    /// mechanisms, divided by the capacity each asset occupies.
    ///
    /// Weights 4000/3000/2000/1000 over 33 slots want 13/10/7/3, but the
    /// m-nft collection holds only two items — so it takes both and hands
    /// back its shortfall, which re-normalizes over the three assets still
    /// holding candidates and lands at 14/10/7/2.
    #[tokio::test]
    async fn the_typed_class_is_the_inventory_page_split_by_capacity() {
        let (api, server, _listed) = spawn_diverse_index(DiverseShape::default()).await;
        let client = reqwest::Client::new();
        let mut seen = HashSet::new();

        let walk = discover_typed(&client, &api, 33, &resolved_families(), &mut seen).await;

        assert!(walk.stopped_by.is_none(), "every asset answered");
        assert_eq!(
            by_asset(&walk.candidates),
            BTreeMap::from([
                (TOKEN_TAG, 14),
                (SPORE_TAG, 10),
                (IDENTITY_TAG, 7),
                (MNFT_TAG, 2)
            ]),
            "the exhausted collection's shortfall re-normalized over the rest"
        );
        assert_eq!(walk.candidates.len(), 33, "and the class is full");
        // Rank order, asset by asset: the inventory page read top to bottom.
        assert!(
            walk.candidates[..14]
                .iter()
                .all(|c| c.out_point.tx_hash.starts_with("0xa1")),
            "the leading asset's cells lead the class"
        );
        server.abort();
    }

    /// Cold start (R1): the census has not named `.bit` yet, so that
    /// collection contributes nothing — and the class still fills, because
    /// the slots it could not take re-normalize like any other shortfall.
    #[tokio::test]
    async fn an_unresolved_identity_costs_the_class_nothing() {
        let (api, server, _listed) = spawn_diverse_index(DiverseShape::default()).await;
        let client = reqwest::Client::new();
        let mut seen = HashSet::new();

        let walk = discover_typed(&client, &api, 33, &HashMap::new(), &mut seen).await;

        assert_eq!(
            by_asset(&walk.candidates),
            BTreeMap::from([(TOKEN_TAG, 18), (SPORE_TAG, 13), (MNFT_TAG, 2)]),
            "no `.bit` cells, and the two assets with supply absorbed its share"
        );
        assert_eq!(walk.candidates.len(), 33, "the class is still full");
        assert!(
            walk.stopped_by.is_none(),
            "a deferred family is not a failure"
        );
        server.abort();
    }

    /// A collection whose item list fails partway keeps everything it had
    /// already listed, and the class reports what stopped it — the same rule
    /// the classes obey, one level down.
    #[tokio::test]
    async fn a_failing_collection_keeps_its_partial_and_says_so() {
        let (api, server, _listed) = spawn_diverse_index(DiverseShape {
            // Two pages of budget, and the second one answers HTTP 500.
            spore_breaks_after: Some(4),
            ..DiverseShape::default()
        })
        .await;
        let client = reqwest::Client::new();
        let mut seen = HashSet::new();

        // 400 slots buys the cluster a two-page item budget, so the walk
        // reaches the page that breaks.
        let walk = discover_typed(&client, &api, 400, &resolved_families(), &mut seen).await;

        let error = walk.stopped_by.expect("the broken page is reported");
        assert!(
            error.to_string().contains("spore cluster items"),
            "got: {error}"
        );
        let tally = by_asset(&walk.candidates);
        assert_eq!(
            tally.get(&SPORE_TAG),
            Some(&4),
            "the four items it listed before the failure are kept: {tally:?}"
        );
        assert_eq!(
            tally.get(&TOKEN_TAG),
            Some(&20),
            "the rest answered in full"
        );
        assert_eq!(tally.get(&IDENTITY_TAG), Some(&8));
        assert_eq!(tally.get(&MNFT_TAG), Some(&2));
        server.abort();
    }

    /// The shared `seen` spans the classes, so a Cell that is both a DAO
    /// deposit and a ranked asset's cell is staged once — and the typed
    /// class's allocation counts what it can actually deliver, not what it
    /// found.
    #[tokio::test]
    async fn one_outpoint_is_staged_once_across_the_whole_composition() {
        let (api, server, _listed) = spawn_diverse_index(DiverseShape {
            dao_collides_with_token: true,
            ..DiverseShape::default()
        })
        .await;
        let client = reqwest::Client::new();

        let got = discover(&client, &api, anchor(), 40, &resolved_families(), 7)
            .await
            .expect("a composition");

        let shared = OutPoint {
            tx_hash: format!("0x{TOKEN_TAG:02x}{:062x}", 0),
            index: 0,
        };
        let staged = got
            .dao
            .iter()
            .chain(&got.typed)
            .chain(&got.plain)
            .filter(|candidate| candidate.out_point == shared)
            .count();
        assert_eq!(staged, 1, "DAO took it first and typed did not repeat it");
        assert!(
            got.dao.iter().any(|c| c.out_point == shared),
            "and DAO is the class that kept it"
        );
        assert!(
            got.typed.len() <= overfetch(got.target.typed),
            "the class never oversteps its overfetched target: {} > {}",
            got.typed.len(),
            overfetch(got.target.typed)
        );
        assert!(!got.typed.is_empty() && !got.plain.is_empty());
        server.abort();
    }

    // ── T5: the tail walks the same ranking ───────────────────────

    /// A row of ranked token contracts, each serving a fixed page of live
    /// cells tagged with its own rank. What a long ranking looks like from
    /// the tail's side.
    async fn spawn_ranked_contracts(
        weights: Vec<u64>,
        cells_per_asset: usize,
    ) -> (Url, tokio::task::JoinHandle<()>, Arc<AtomicUsize>) {
        let rosters = Arc::new(AtomicUsize::new(0));
        let counted = rosters.clone();
        let listed = weights.clone();
        let app = Router::new()
            .route(
                "/api/v1/assets",
                get(move || {
                    let counted = counted.clone();
                    let listed = listed.clone();
                    async move {
                        counted.fetch_add(1, Ordering::Relaxed);
                        Json(serde_json::json!({
                            "data": listed
                                .iter()
                                .enumerate()
                                .map(|(rank, weight)| asset_row(
                                    &format!("0x{rank:064x}"),
                                    "token",
                                    "xudt",
                                    &weight.to_string(),
                                ))
                                .collect::<Vec<_>>(),
                            "hasMore": false,
                            "nextCursor": None::<String>,
                        }))
                    }
                }),
            )
            .route(
                "/api/v1/cells/live",
                get(move |Query(q): Query<BTreeMap<String, String>>| async move {
                    let hash = q.get("type_script_hash").cloned().unwrap_or_default();
                    let rank = u8::from_str_radix(&hash[hash.len() - 2..], 16).unwrap_or(0);
                    let from: usize = q.get("cursor").and_then(|c| c.parse().ok()).unwrap_or(0);
                    let to = (from + PAGE_LIMIT).min(cells_per_asset);
                    Json(serde_json::json!({
                        "data": (from..to)
                            .map(|i| tagged_cell(rank, i, Some(hash.clone()), PLAIN_LOCK.into()))
                            .collect::<Vec<_>>(),
                        "hasMore": to < cells_per_asset,
                        "nextCursor": if to < cells_per_asset { Some(to.to_string()) } else { None },
                    }))
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
            rosters,
        )
    }

    /// Two heavy assets and thirty-eight almost weightless ones. The
    /// shortfall of rank #2 is served before rank #40 is looked at, because
    /// the deficit each asset carries is its share of the ranking — not its
    /// turn in a round-robin, which is what the tail used to walk.
    #[tokio::test]
    async fn a_deficit_at_the_head_is_served_before_the_long_tail() {
        let mut weights = vec![1_000_u64, 900];
        weights.extend(std::iter::repeat_n(1, 38));
        let (api, server, _) = spawn_ranked_contracts(weights, 100).await;
        let client = reqwest::Client::new();
        let mut tail = CandidateTail::default();

        let got = top_up(
            &client,
            &api,
            anchor(),
            &mut tail,
            0,
            100,
            &HashMap::new(),
            1,
        )
        .await
        .unwrap();

        assert_eq!(got.typed.len(), 100, "exactly the ask");
        assert_eq!(
            by_asset(&got.typed),
            BTreeMap::from([(0, 52), (1, 47), (2, 1)]),
            "the two heavy ranks took the turn; rank #40 has ample supply \
             and was never reached"
        );
        server.abort();
    }

    /// The tail bootstraps its own roster, so a top-up that arrives before
    /// any full discovery still walks the ranking rather than nothing. The
    /// ranking is taken once and then kept — until a discovery replaces the
    /// population it was measuring.
    #[tokio::test]
    async fn the_tail_takes_the_ranking_once_and_keeps_it() {
        let (api, server, rosters) = spawn_ranked_contracts(vec![600, 400], 1_000).await;
        let client = reqwest::Client::new();
        let mut tail = CandidateTail::default();
        assert!(tail.assets.is_empty(), "nothing has been discovered yet");

        let first = top_up(
            &client,
            &api,
            anchor(),
            &mut tail,
            0,
            50,
            &HashMap::new(),
            1,
        )
        .await
        .unwrap();
        assert_eq!(first.typed.len(), 50);
        assert_eq!(tail.assets.len(), 2, "the roster bootstrapped itself");
        assert_eq!(rosters.load(Ordering::Relaxed), 1);

        let second = top_up(
            &client,
            &api,
            anchor(),
            &mut tail,
            0,
            50,
            &HashMap::new(),
            1,
        )
        .await
        .unwrap();
        assert_eq!(second.typed.len(), 50);
        assert_eq!(
            rosters.load(Ordering::Relaxed),
            1,
            "a second turn resumes; it does not re-read the ranking"
        );

        // A full composition lands. The ranking is now a composition old and
        // the delivered counts measure a population that has been replaced,
        // so the next turn re-takes it — and still walks DEEPER, because the
        // cursors are carried across rather than rewound.
        tail.note_emitted(second.typed.iter().map(|c| &c.out_point));
        let third = top_up(
            &client,
            &api,
            anchor(),
            &mut tail,
            0,
            50,
            &HashMap::new(),
            1,
        )
        .await
        .unwrap();
        assert_eq!(
            rosters.load(Ordering::Relaxed),
            2,
            "the ranking was re-taken"
        );
        assert_eq!(
            tail.assets.iter().map(|a| a.delivered).sum::<usize>(),
            third.typed.len(),
            "the delivered counts restarted from the composition"
        );
        let overlap = third
            .typed
            .iter()
            .filter(|c| {
                first
                    .typed
                    .iter()
                    .chain(&second.typed)
                    .any(|o| o.out_point == c.out_point)
            })
            .count();
        assert_eq!(overlap, 0, "and the walk is still strictly deeper");
        server.abort();
    }

    /// A ranking walked end to end rewinds instead of wedging — the same
    /// rule the DAO tail obeys, and for the same reason: cells minted since
    /// are new, and `emitted` keeps the rest from repeating.
    #[tokio::test]
    async fn an_exhausted_ranking_rewinds_to_its_head() {
        let (api, server, _) = spawn_ranked_contracts(vec![1, 1], 3).await;
        let client = reqwest::Client::new();
        let mut tail = CandidateTail::default();

        let first = top_up(
            &client,
            &api,
            anchor(),
            &mut tail,
            0,
            100,
            &HashMap::new(),
            1,
        )
        .await
        .unwrap();
        assert_eq!(first.typed.len(), 6, "both assets, end to end");
        assert!(tail.assets.iter().all(|asset| asset.exhausted));

        let rewind = top_up(
            &client,
            &api,
            anchor(),
            &mut tail,
            0,
            100,
            &HashMap::new(),
            1,
        )
        .await
        .unwrap();
        assert!(rewind.typed.is_empty(), "the rewind turn hands out nothing");
        assert!(
            tail.assets.iter().all(|asset| !asset.exhausted),
            "and every cursor is back at its head"
        );
        assert!(
            tail.assets.iter().all(|asset| asset.delivered == 3),
            "the delivered counts survive: a rewind does not un-stage a cell"
        );

        let third = top_up(
            &client,
            &api,
            anchor(),
            &mut tail,
            0,
            100,
            &HashMap::new(),
            1,
        )
        .await
        .unwrap();
        assert!(third.typed.is_empty(), "everything is already emitted");
        server.abort();
    }

    /// The claim and the delivery are the same act. A candidate the anchor
    /// rejects is never claimed, so it survives for the anchor that accepts
    /// it — and the rows past the ask are not claimed either.
    #[tokio::test]
    async fn the_tail_claims_only_what_it_delivered() {
        let (api, server, _) = spawn_ranked_contracts(vec![600, 400], 100).await;
        let client = reqwest::Client::new();
        let mut tail = CandidateTail::default();
        let early = ChainAnchor {
            block: 5,
            hash: "0xearly".into(),
        };

        let rejected = top_up(&client, &api, early, &mut tail, 0, 100, &HashMap::new(), 1)
            .await
            .unwrap();
        assert!(rejected.typed.is_empty(), "every mock cell is at block 10");
        assert_eq!(
            tail.claimed(),
            0,
            "an anchor-rejected candidate must survive for the anchor that accepts it"
        );

        // Two hundred cells are on offer and thirty are asked for. The other
        // hundred and seventy were read but never handed out, and claiming
        // them would burn tail depth on cells nobody saw.
        let mut fresh = CandidateTail::default();
        let taken = top_up(
            &client,
            &api,
            anchor(),
            &mut fresh,
            0,
            30,
            &HashMap::new(),
            1,
        )
        .await
        .unwrap();
        assert_eq!(taken.typed.len(), 30);
        assert_eq!(fresh.claimed(), 30, "the claim is exactly the delivery");
        server.abort();
    }

    /// A collection resumes rather than restarts: its item list is read from
    /// where the last turn stopped, and the items a turn paid for but did not
    /// need are kept for the next one instead of being paged past.
    #[tokio::test]
    async fn a_collection_resumes_its_item_list_across_turns() {
        let (api, server, listed) = spawn_diverse_index(DiverseShape {
            spore_page_size: 5,
            ..DiverseShape::default()
        })
        .await;
        let client = reqwest::Client::new();
        let mut tail = CandidateTail::default();

        let first = top_up(
            &client,
            &api,
            anchor(),
            &mut tail,
            0,
            20,
            &resolved_families(),
            1,
        )
        .await
        .unwrap();
        let after_first = listed.lock().unwrap().clone();
        let second = top_up(
            &client,
            &api,
            anchor(),
            &mut tail,
            0,
            20,
            &resolved_families(),
            1,
        )
        .await
        .unwrap();
        let after_second = listed.lock().unwrap().clone();

        assert!(
            by_asset(&first.typed).get(&SPORE_TAG).copied().unwrap_or(0) > 0
                && by_asset(&second.typed)
                    .get(&SPORE_TAG)
                    .copied()
                    .unwrap_or(0)
                    > 0,
            "the cluster contributed to both turns"
        );
        assert_eq!(
            after_second
                .iter()
                .filter(|cursor| *cursor == "head")
                .count(),
            1,
            "the head of the item list was read once, on the first turn: \
             {after_second:?}"
        );
        assert!(
            after_second.len() > after_first.len(),
            "and the second turn read further into it: {after_first:?} then {after_second:?}"
        );
        let overlap = second
            .typed
            .iter()
            .filter(|c| first.typed.iter().any(|o| o.out_point == c.out_point))
            .count();
        assert_eq!(overlap, 0, "nothing was offered twice");
        server.abort();
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
                                asset_row(&format!("0x{:064x}", 0xaa), "token", "xudt", "600"),
                                asset_row(&format!("0x{:064x}", 0xbb), "token", "sudt", "400"),
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

        let got = discover(&client, &api, anchor(), 1_000, &HashMap::new(), 7)
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
            &HashMap::new(),
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
