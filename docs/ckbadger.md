# ckbadger Enrichment

ckbadger is an optional, read-only indexed enrichment source for cknerv. It
adds bounded Cell, transaction, asset, DAO, protocol, fork, activity, history,
and network context to the semantics pipeline. The direct CKB JSON-RPC adapter
remains the only source of structural chain truth: ckbadger data cannot create,
spend, or replace a canonical Cell.

## Configuration

`cknerv init` includes this block in `cknerv.toml`, commented out by default:

```toml
# [ckbadger]
# api_url = "http://127.0.0.1:8101/api/v1"
# max_lag_blocks = 12
```

Uncomment all three lines to enable enrichment. Section presence enables the
source and `api_url` is required. The URL must already include either:

- `/api/v1` for a direct per-network service, such as
  `http://127.0.0.1:8101/api/v1`.
- `/api/<network>/v1` for an orchestrator proxy, such as
  `http://127.0.0.1:8100/api/mainnet/v1`.

`max_lag_blocks` defaults to `12`. It controls when a hash-compatible,
non-syncing source is labeled `stale`; stale anchored data remains explicitly
marked instead of being treated as canonical. Omitting the entire section keeps
the original CKB-only dashboard behavior.

The browser receives only `{ enabled, source }` in its runtime config. The
ckbadger API URL stays server-side, and the browser talks only to cknerv.

## Architecture and Trust Boundary

ckbadger enters through a separate additive path:

```text
CKB node JSON-RPC                         optional ckbadger HTTP API
      |                                              |
      v                                              v
CkbDirectAdapter                              EnrichmentSource
      |                                 block-height/hash validation
      v                                              |
canonical Mutation stream                           v
      |                                    EnrichmentEvent stream
      v                                              |
cknerv-server <-------------------------- SemanticsProjection
      |
      v
HTTP/WS API -> @cknerv/cache -> @cknerv/ui
```

Optional indexed sources implement `cknerv_server::EnrichmentSource`.
Enrichment-aware projections own an independent revision and replay ring;
their revision advances only when semantics or source health changes. Canonical
reorg and rebuild mutations invalidate anchored enrichment records without
allowing the enrichment source to mutate the chain entity or Cell projection.

The implementation lives in
[`crates/cknerv-adapter-ckbadger/`](../crates/cknerv-adapter-ckbadger/).
Source-specific camelCase DTOs stay inside that crate. Core, server, cache, and
UI contracts remain normalized and source-agnostic.

## HTTP and WebSocket Routes

| Method | Path | Behavior |
|---|---|---|
| `GET` | `/api/projections/semantics/snapshot` | Source health and currently available bounded semantics; present even when enrichment is disabled |
| `WS` | `/api/projections/semantics/stream?since=<rev>` | Independent semantics snapshot/delta stream |
| `GET` | `/api/enrichment/cells/:tx_hash/:output_index` | Resolve one selected Cell lazily; returns `404 enrichment_disabled` without a configured source |
| `GET` | `/api/enrichment/transactions/:tx_hash` | Resolve the selected Cell's origin transaction lazily |

The SPA does not include the optional semantics stream in its required startup
`Promise.all`. In CKB-only mode it neither connects to that stream nor renders
the additional HUD sections, so enrichment cannot block the base dashboard.

## Canonical Compatibility

Before accepting indexed data, cknerv reads the indexed tip, selects a block in
its retained canonical evidence window, and requires ckbadger to return the
same hash at that height. A mismatch marks the source `incompatible`.
Lag and reachability are reported separately as `syncing`, `stale`, or `error`
without affecting the direct CKB adapter.

Every successful lazy or aggregate result re-reads the exact validated
ckbadger block immediately before admission and requires its height and hash to
remain unchanged. The server then checks that anchor against its current direct
CKB evidence before applying the event. Together these fences close both a
same-height source reorg during the HTTP fetch and a direct-chain reorg racing
the result. Canonical reorg and rebuild events also prune or clear unsafe
semantic records. Active deep-fork diagnostics are the deliberate exception:
because the index is incompatible by definition, they prove ckbadger's
reported live-chain tip/hash directly instead of reusing the normal indexed
anchor.

Source health keeps its own five-second probe cadence. Aggregate capabilities
have independent due times, allow at most one request in flight per capability,
and share a three-request concurrency bound. A slow or failing aggregate
therefore cannot delay health probing, serialize unrelated due aggregates, or
degrade canonical routes. Work that cannot start within the bound waits for a
later probe so it receives fresh canonical context rather than queueing a stale
one.

## Capabilities

Capabilities are used only when ckbadger advertises them. Every indexed view is
labeled separately from direct node observations; cknerv does not reinterpret
bounded samples as global chain truth.

### Selected Cell and Origin Transaction

Selecting a Cell resolves its indexed context on demand, including script and
asset identity, data analysis, DAO/code-cell context, and exact occupied
capacity composition when available. A deterministic `udt_amount` decode can
trigger one parallel token-identity lookup for that outpoint. Ordinary, DAO,
dep-group, and code Cells do not trigger that token lookup.

The HUD displays the exact raw token amount with indexed decimals, name, and
symbol when available. One billboarded semantic orbit appears around the
selected canonical Cell: inner CAP/LOCK/TYPE/DATA arcs show its occupied-byte
breakdown, and an outer notched arc marks a resolved asset. There is no
background Cell sweep or base-Galaxy retaxonomization. A stale source dims the
orbit, while an invalid or missing anchor suppresses it.

The transaction route adds the selected Cell's origin transaction, participant
capacity deltas, and proposal/commit lifecycle when the source provides them.

### Asset Ecosystem

With `asset_ecosystem`, cknerv refreshes one bounded aggregate response at most
once every 30 seconds after a usable source probe. The semantics stream carries
exact capacities normalized to shannons, whole-byte knowledge size,
basis-point category shares, and a bounded list of top indexed assets.

`CELL MESH` has one capacity-detail slot. In CKB-only mode it shows retained
Galaxy capacity plus the retained asset/lock taxonomy. A valid ckbadger record
upgrades that same slot to **INDEXED CHAIN CAPACITY** instead of appending a
second capacity view. Indexed totals are never extrapolated from the retained
Cell reservoir. The enhanced view dims when the source is stale or its own
refresh is more than 90 seconds old; until the source and anchor are usable,
the base retained view remains visible.

### DAO State

With `dao_state`, cknerv refreshes the fixed-shape `dao/statistics` singleton at
most once every 60 seconds. Its `statistics_block` cannot be ahead of the last
block/hash anchor proven by cknerv. If ckbadger advances between probe and
fetch, the newer singleton is withheld until the next successful probe.

The normalized record keeps locked, pending-withdrawal,
unclaimed-compensation, and optional signed 24-hour change values as exact
integer shannons, with estimated APC in basis points. `COMMON KNOWLEDGE BASE`
renders a separate **INDEXED NERVOS DAO** snapshot with both the statistics
block and compatibility anchor. It does not reinterpret the values as retained
Galaxy counts or invent a gauge denominator. The section is absent with
unusable proof and dims after three missed minute refreshes.

### Protocol Era

With `protocol_era`, cknerv refreshes the fixed-size `hardforks` timeline at
most once every five minutes. The adapter maps the direct CKB chain name to
ckbadger's mainnet/testnet vocabulary, rejects a different response network,
and validates bounded unique events in strictly increasing activation-epoch
order.

Only the newest activated edition and earliest upcoming edition cross the
shared wire boundary. Summaries, dates, resource links, and the full source
catalogue do not. Both the timeline tip block and tip epoch must be covered by
cknerv's validated block anchor and direct canonical epoch. A timeline that
advances between probe and fetch is withheld until the next proof.

`COMMON KNOWLEDGE BASE` adds a compact **IDX MEEPO·24**-style badge to the
canonical `Epoch` row, with exact activation coordinates in its accessible
tooltip. It never replaces the direct epoch value, adds panel height, or
creates scene objects. The badge is absent in CKB-only and custom/devnet modes,
is suppressed with unusable proof, and dims after three missed refresh windows.

### Fork Watch

With `fork_watch`, cknerv refreshes the fixed-shape `forks/recent` response at
most once every 15 seconds. Only the newest persisted event inside ckbadger's
explicit recent window and the matching active deep-fork status cross the
adapter boundary. An ordinary event's fork point and new canonical tip must be
covered by the proven block/hash anchor; its old orphaned tip may be higher.

An active deep fork makes the indexed database incompatible by definition, so
that diagnostic is admitted only when ckbadger's reported live-chain tip and
hash exactly match cknerv's retained canonical evidence. All other semantics
from an incompatible source remain cleared.

Fork-watch records remain available through the optional semantics snapshot and
stream for diagnostics, but the default dashboard does not render an indexed
fork panel. `COMMON KNOWLEDGE BASE` keeps only the direct adapter's canonical
`Reorgs` count, avoiding a second fork summary with different scope. Indexed
records never increment that canonical counter, trigger rollback, change chain
revision, or create scene objects.

### Recent Activity

With `activity_feed`, cknerv requests exactly eight entries from the bounded
latest-activity endpoint at most once every 15 seconds. The adapter validates
newest-first block order, anchor bounds, transaction hashes, timestamps, and
participant and nested-item limits. It normalizes each entry to a compact
transfer, DAO, token, object, identity, script, or protocol signature.
Participant addresses and arbitrary source JSON do not cross the wire boundary.

If the chain advances between probe and fetch, an unanchored leading prefix is
withheld until a later probe proves its block hash. `COMMON KNOWLEDGE BASE`
renders **INDEXED ACTIVITY · LATEST N** with a fingerprint and four recent
rows. At viewport heights of 860 pixels or less, the rows fold away while the
fingerprint remains. This is a latest sample, not a global distribution. It
disappears with an unusable anchor and dims when stale or more than 45 seconds
old.

### Transaction Horizon

With `transaction_horizon`, cknerv refreshes the cached
`statistics/tx-stats` summary at most once every 60 seconds. At most 24 hourly
and 14 daily buckets cross the shared wire boundary, ordered oldest to newest,
and all counts must be non-negative and JSON-safe. Localized bucket labels and
timezone text do not cross the boundary. Current-hour and current-day values
remain explicitly source-defined indexed buckets rather than being converted
to browser-local time.

Because this summary has no block coordinate and its network summary has a
separate cache, the adapter first requires the validated block's successor to
remain absent from the indexed store, then re-reads the validated block as the
final admission fence. Otherwise the summary waits for a later proof.

On taller viewports, `COMMON KNOWLEDGE BASE` renders **INDEXED TX HORIZON ·
N/24H** with exact current-hour and current-day counts. At 860 pixels or less it
folds into an **IDX H…/D…** badge in the direct `Tps 60s` row. It never replaces
direct TPS or cumulative transaction totals, disappears in CKB-only mode, and
dims after three missed refreshes.

### Network Atlas

With `network_atlas`, cknerv checks the crawler summary at most once every 60
seconds. A usable crawl triggers exactly one `network/nodes?limit=64` request.
The adapter validates the counters and newest-first sample, then reduces it to
country and version buckets, reachable count, and median RTT. Peer IDs and
addresses never enter the shared wire contract.

`PEER MESH` always keeps the local CKB node's directly measured peer count,
head consensus, and sync ratio as primary truth. Its detail slot shows local
version, ping, and inferred-colony diagnostics in CKB-only mode. A valid atlas
record upgrades that slot to **INDEXED NETWORK ATLAS**, with explicit `LATEST N
SAMPLE` and `BOUNDED` labels, instead of appending a second network summary. It
creates no scene nodes or edges. The base detail returns when the crawler is
unconfigured, empty, disabled, or canonically unusable; stale indexed detail
dims after three missed minute refreshes.

## Persistence

Optional semantics are bounded in memory and intentionally not persisted. They
are rehydrated from the configured source, so enabling, disabling, or changing
ckbadger does not alter the persistence schema and does not require
`cknerv prune`.

## Known Limits

- Transaction participants expose exact capacity deltas only when every
  attributed input and output includes capacity.
- Selected-transaction protocol activities and an exact global Cell census are
  not populated because ckbadger does not expose an efficient per-transaction
  activity lookup or one bounded current-census response. cknerv avoids N+1
  background scraping and does not relabel latest samples or historical chart
  points as current chain truth.
- The script-utilization chart is not polled because its response is cumulative
  and unbounded rather than a fixed-size current view.
- The 24-hour activity summary is not polled because its `scriptCounts` map has
  no explicit entry bound, even though its hourly window is fixed. cknerv uses
  the separately bounded latest-activity endpoint instead.
- Fiber aggregate statistics are not polled because the current endpoint scans
  every indexed channel per request. cknerv can add them when ckbadger exposes
  a pre-aggregated bounded singleton.
