# ckbadger Enrichment

ckbadger is an optional, read-only indexed enrichment source for cknerv. It
adds bounded Cell, transaction, asset, DAO, protocol, fork, activity, history,
network, and CellGalaxy-composition context to the semantics pipeline. The direct CKB JSON-RPC adapter
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

CellGalaxy composition has one additional trust fence. ckbadger discovers and
ranks bounded outpoint candidates, then `CkbGalaxyCompositionHydrator` batch
reads every candidate with the local node's read-only `get_live_cell` RPC. A
candidate is admitted only when it is still live, its capacity matches the
indexed hint, and its node-derived type-script taxonomy matches its requested
class. The node also supplies the real output data, content hash, lock class,
and deterministic position seed. No ckbadger payload is converted directly
into a displayable Cell.

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

Capabilities are used only when ckbadger advertises them. The dashboard fuses
validated fields into domain readouts instead of prefixing titles with the data
source. Scope labels distinguish local or retained-Galaxy observations from
whole-chain and whole-network context, while the global source-health chip
retains operational provenance. cknerv does not reinterpret bounded samples as
global chain truth.

### CellGalaxy Composition

With `galaxy_composition`, cknerv refreshes one non-persisted resting display
reservoir at most once every 15 minutes. Its target is 6,000 Cells — the curated core of the browser's fixed
12,000-Cell field, with canonical retained Cells filling the remainder (the
reservoir itself is far larger). At the default target the requested classes are exactly:

- 1,800 active Nervos DAO deposit Cells (30%).
- 2,400 non-DAO Cells with a non-empty type script (40%).
- 1,800 plain Cells without a type script (30%).

ckbadger's existing APIs provide the bounded discovery work:

- DAO candidates come from paginated `dao/deposits?status=0` results and are
  ranked by capacity after validating the deposited state.
- Typed candidates start from `assets` sorted by owned capacity. cknerv samples
  up to three pages of `cells/live?type_script_hash=...` for each of 64 leading
  assets, ranks Cells by individual capacity, and interleaves asset groups so a
  single script cannot monopolize the Galaxy.
- Plain candidates start from both `addresses/top` and 30-day
  `addresses/active` results. Bounded `cells/live?lock_script_hash=...` pages
  are filtered to null type scripts, ranked within each address, and
  interleaved across addresses.

Candidate discovery deliberately uses the index for the work a CKB node cannot
perform efficiently. Final Cell materialization deliberately uses the node for
the authority the index must not own. If one class is sparse after live-cell
validation, the UI fills that shortage from matching canonical retained Cells,
then spills remaining vacancies toward DAO and typed Cells. With sufficient
candidates, the visible result remains exactly 30:40:30.

This record changes only the shared Cell/body and passive-fibre display subset.
It never enters `CellGalaxySnapshot`, never increments Cell counters, and never
emits `birth`, `death`, `link`, or `pulse` deltas. The complete canonical Cell
map and neighbour graph continue to plan and render live nerve routes. Endpoints
from the newest canonical block temporarily replace resting entries inside
their own class quota, so exact Cell flashes remain visible without changing
the ratio. The broad new-block pulse still follows the canonical
`BlockMined -> CellDelta::Pulse -> lastPulseAtMs` path and is independent of
composition refreshes.

When ckbadger is disabled, unavailable, or has not completed the first
composition refresh, CellGalaxy retains its original canonical-prefix display
behavior. A failed refresh leaves the last good anchored record in place; a
canonical reorg prunes it through the normal semantics anchor guard.

### Selected Cell and Origin Transaction

Selecting a Cell resolves its indexed context on demand, including script and
asset identity, actual output-data bytes, deterministic content analysis,
DAO/code-cell context, and exact occupied-capacity composition when available.
The normalized content record preserves the exact data size, a bounded raw-byte
preview, whether that preview is complete, deterministic decode kind and
summary, byte-exact half-open segment ranges with meanings and human values,
and a bounded set of source heuristics. A deterministic `udt_amount` decode can
trigger one parallel token-identity lookup for that outpoint. Ordinary, DAO,
dep-group, and code Cells do not trigger that token lookup.

The scan field displays the exact raw token amount with validated decimals,
name, and symbol when available. A source-neutral **INDEX LAYER** inside the
same scan window reports availability and lag; source health remains in the
global status strip. Cell inspection is not docked in a fixed HUD rail and has
no tab or popup shell. A physical cage, moving scan plane, and semantic orbits
surround the selected canonical Cell. A larger **CELL SCAN** reuses the same
code-native Cell artwork with its flowing-light scan and supports pointer-drag
orbiting for inspection from different angles. That nested gesture owns the
pointer until release: the Cell Scan camera moves while the Galaxy camera
remains fixed. Clicking beyond the rendered detail satellites or pressing
Escape exits inspection.

Identity, the combined scan/index evidence, and lineage render as independently
spaced satellites rather than one continuous panel. Every satellite follows the
same projected point, flips as a constellation around viewport edges, and stays
connected to the Cell. Ambient HUD rails dim while the scan is active so the
Cell remains the single visual focus. The selected-Cell satellites are
deliberately no-scroll summaries. The Cell Scan and portrait own the exact
WHERE / WHAT / WHEN identity proofs; **CONSENSUS MEMORY** does not repeat their
outpoint, content-hash, and birth-anchor rows. It presents the remembered Cell
content directly, without a nested **CELL CONTENT** frame. Without
an optional source it renders the direct CKB node's real data prefix as bytes
and conservative printable ASCII, including exact observed size or explicit
truncation; it does not invent local content guesses. With validated indexed
content it upgrades in place to **INDEX ANALYSIS**, preferring indexed bytes,
showing the full logical size and completeness, and making deterministic
segments navigable while moving the paged raw-byte window to and highlighting
their exact byte ranges. The same bounded window keeps every retained raw byte
inspectable. Deterministic meanings and values, heuristic evidence, protocol
roles, and resolved asset value remain independently labeled. If an indexed
record has analysis but no raw payload, the direct-node prefix stays visible
and is explicitly labeled as such.

The same memory satellite retains a one-glance causal provenance line;
activating recall temporarily opens **MEMORY TRACE** as a separate evidence
satellite. The scan's **INDEX LAYER**
keeps owner, creation and proof anchors, resolved asset identity, lock/type
script identity with code hash type and args, occupied-byte composition, and
only the primary protocol facet. It does not duplicate content analysis or
stack every decoded facet or origin-transaction field into the scan window.
Values remain bounded by the shared wire types; arbitrary source JSON does not
enter the browser.

One billboarded semantic orbit appears around the selected canonically
validated Cell:
inner CAP/LOCK/TYPE/DATA arcs show its occupied-byte breakdown, and an outer
notched arc marks a resolved asset. Composition refresh does not prefetch these
details: the selected outpoint still resolves lazily through the existing Cell
detail endpoint. A stale source dims the orbit, while an invalid or missing
anchor suppresses it.

The transaction route adds the selected Cell's origin transaction, participant
capacity deltas, and proposal/commit lifecycle when the source provides them.

### Asset Ecosystem

With `asset_ecosystem`, cknerv refreshes one bounded aggregate response at most
once every 30 seconds after a usable source probe. The semantics stream carries
exact capacities normalized to shannons, whole-byte knowledge size,
basis-point category shares, and a bounded list of top indexed assets.

`COMMON KNOWLEDGE BASE` owns one capacity-detail slot beneath its canonical
chain rows; `CELL MESH` remains focused on Cell metabolism and lifecycle
counts. In CKB-only mode the capacity slot shows **GALAXY WINDOW** with retained
capacity plus the retained asset/lock taxonomy. A valid ckbadger record upgrades
that slot into one scoped hierarchy: **CHAIN CAPACITY** gives the whole-chain
overview, then **GALAXY WINDOW** nests every base retained datum beneath it. This
keeps the enhanced view a semantic superset without presenting two independent
capacity panels. Indexed totals are never extrapolated from the retained Cell
reservoir. Only the whole-chain scope dims when the source is stale or its own
refresh is more than 90 seconds old; direct-node Galaxy data remains at full
strength. Until the source and anchor are usable, the standalone base view
remains visible. Both capacity scopes share the canonical CKB label/value
columns; their hierarchy rail sits outside those columns instead of indenting
the data differently from the rows above and below.

### DAO State

With `dao_state`, cknerv refreshes the fixed-shape `dao/statistics` singleton
once every 60 seconds after the first valid snapshot. Its `statistics_block`
cannot be ahead of the last block/hash anchor proven by cknerv. If ckbadger
advances between probe and fetch, the newer singleton is withheld. While no
valid snapshot is available yet, newer canonical block evidence wakes an
immediate probe and DAO retry; the five-second source probe remains the
fallback when no chain update arrives. `DAO·05` therefore does not inherit a
fixed cold-start delay or the full steady-state minute cadence.

The normalized record keeps locked, pending-withdrawal,
unclaimed-compensation, and optional signed 24-hour change values as exact
integer shannons, with estimated APC in basis points. A validated record renders
as the independent `DAO·05` **NERVOS DAO** panel immediately to the right of
`CKB·01`, with both the statistics block and compatibility anchor. It does not
reinterpret the values as retained Galaxy counts or invent a gauge denominator.
The panel is absent with unusable proof, dims after three missed minute
refreshes, and can be controlled independently from the top-bar `PANELS` menu.

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

`COMMON KNOWLEDGE BASE` adds a compact **MEEPO·24**-style badge to the canonical
`Epoch` row, with exact activation coordinates in its accessible tooltip. It
never replaces the direct epoch value, adds panel height, or creates scene
objects. The badge is absent in CKB-only and custom/devnet modes, is suppressed
with unusable proof, and dims after three missed refresh windows.

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
renders **ACTIVITY · LATEST N** with a fingerprint and four recent rows. At
viewport heights of 860 pixels or less, the rows fold away while the fingerprint
remains. This is a latest sample, not a global distribution. It disappears with
an unusable anchor and dims when stale or more than 45 seconds old.

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

On taller viewports, `COMMON KNOWLEDGE BASE` renders **TX HORIZON · N/24H**
with exact current-hour and current-day counts. At 860 pixels or less it folds
to a header-only **TX HORIZON · H…/D…** section so the CKB panel order remains
canonical chain data, fused capacity, **TX HORIZON**, then **ACTIVITY**. It
never replaces direct TPS or cumulative transaction totals, disappears in
CKB-only mode, and dims after three missed refreshes.

### Network Atlas

With `network_atlas`, cknerv checks the crawler summary at most once every 60
seconds. A usable crawl triggers exactly one `network/nodes?limit=64` request.
The adapter validates the counters and newest-first sample, then reduces it to
country and version buckets, reachable count, and median RTT. Peer IDs and
addresses never enter the shared wire contract.

`PEER MESH` always keeps the local CKB node's directly measured peer count,
head consensus, and sync ratio as primary truth. Its detail slot shows local
version, ping, and inferred-colony diagnostics in CKB-only mode. A valid atlas
record turns that slot into a **LOCAL NODE VIEW → NETWORK ATLAS** scope rail.
All direct-node diagnostics remain visible, while the network-wide stage adds
known-node, crawl, RTT, country, and client-version context with explicit
`LATEST N SAMPLE` and `BOUNDED` labels. This is one progressive information flow
rather than two adjacent network panels, and it creates no scene nodes or edges.
The standalone base detail returns when the crawler is unconfigured, empty,
disabled, or canonically unusable. Staleness dims only the network-wide stage
after three missed minute refreshes.

## Persistence

Optional semantics are bounded in memory and intentionally not persisted. They
are rehydrated from the configured source, so enabling, disabling, or changing
ckbadger does not alter the persistence schema and does not require
`cknerv prune`.

## Known Limits

- Direct CKB ingestion retains at most the first 1,024 Cell-data bytes. The
  indexed content record retains at most the first 4,096 bytes while preserving
  the exact total size and an explicit completeness flag. Larger payloads can
  therefore be analyzed by ckbadger but are not transferred in full to the
  dashboard.
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
- `cells/live` is creation-position ordered and exposes no per-Cell capacity
  sort. Typed composition therefore ranks a bounded three-page sample from each
  of the 64 highest-capacity asset groups; it is deliberately a diverse ranked
  display sample, not a claim to contain the globally largest typed Cells.
