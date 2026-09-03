# ckbadger Enrichment

ckbadger is an optional, read-only indexed enrichment source for cknerv. It
adds bounded Cell, transaction, asset, DAO, protocol, fork, activity, history,
and network context to the semantics pipeline, and it curates the CellGalaxy
display plane through a separate server-side path (see below). The direct CKB
JSON-RPC adapter remains the only source of structural chain truth: ckbadger
data cannot create, spend, or replace a canonical Cell.

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
      |                                              |
      |                            +-----------------+-----------------+
      |                            v                                   v
      |                   SemanticsProjection            display-plane reservoir
      |                   (HUD context records)     (internal Mutation, see below)
      v                            |                                   |
cknerv-server <------------------- +                                   |
      |    <--------------------------------------------------------- +
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

Validated composition input is display-plane input rather than a semantic
record, so it takes the second branch above. After the ordinary anchor guard,
the server installs it into its own canonical stream as the server-internal
`Mutation::GalaxyReservoirReplaced` (a whole composition) or
`Mutation::GalaxyReservoirToppedUp` (an additive supply), which only the cells
projection consumes. Neither variant reaches the entity wire, enters the
canonical Cell map, or moves counters; they change only which Cells the display
plane stages. Routing them through the canonical stream is what keeps display
membership ordered against the births, deaths, and reorgs it is staged against.

## HTTP and WebSocket Routes

| Method | Path | Behavior |
|---|---|---|
| `GET` | `/api/projections/semantics/snapshot` | Source health and currently available bounded semantics; present even when enrichment is disabled |
| `WS` | `/api/projections/semantics/stream?since=<rev>` | Independent semantics snapshot/delta stream |
| `GET` | `/api/projections/cells/snapshot` | The staged canonical Cells **and** the display plane's `display` section, plus a statistics segment covering the whole retained set; present in every mode |
| `WS` | `/api/projections/cells/stream?since=<rev>` | Canonical Cell deltas **and** `display` membership patches, in one revision order |
| `GET` | `/api/enrichment/cells/:tx_hash/:output_index` | Resolve one selected Cell lazily; returns `404 enrichment_disabled` without a configured source |
| `GET` | `/api/enrichment/transactions/:tx_hash` | Resolve the selected Cell's origin transaction lazily |
| `GET` | `/api/enrichment/peers/:node_id` | Resolve one linked peer's crawler sighting lazily; `200` for both a sighting and an honest silence, `404 enrichment_disabled` without a configured source |

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

A refresh that returns the answer already published is not republished.
ckbadger re-stamps `as_of` and `updated_at_ms` on every successful fetch
whether or not the underlying fact moved, so the semantics projection compares
each aggregate against the copy it holds — ignoring exactly those two stamps —
and withholds the delta when the content matches. An idle chain therefore costs
no revisions, no replay-ring entries, and no broadcast frames for the
whole-chain aggregates. Records the HUD ages on a wall clock re-stamp anyway on
a refresh floor set at half the browser's own stale threshold, so a panel that
prints `LIVE · UPDATED Xs AGO` never dims merely because the answer was stable.
The network roster keeps its stricter gate: it publishes only when its crawl
round advances.

## Capabilities

Capabilities are used only when ckbadger advertises them. The dashboard fuses
validated fields into domain readouts instead of prefixing titles with the data
source. Scope labels distinguish local or retained-Galaxy observations from
whole-chain and whole-network context, while the global source-health chip
retains operational provenance. cknerv does not reinterpret bounded samples as
global chain truth.

### CellGalaxy Composition

The display plane — "who is on stage" — is decided entirely server-side and is
present in every mode, so enabling or disabling ckbadger changes only which
Cells the server stages, never the shape, cadence, or cost of what the browser
receives. The server owns the display budget (12,000 Cells and an 8,000-edge
nerve screen budget) and ships it in the `display` section of the cells
snapshot; the browser reads its budget from there rather than from a client
constant.

Those 12,000 seats answer to two standing laws. 1,200 of them are the **tip
window** — the youngest live canonical Cells, ranked by birth height, slid by
every younger birth and refilled from the next-youngest when one dies. It is
maintained from the canonical stream alone and needs no ckbadger at all, which
is why the no-enrichment product is not "the latest Cells as of boot" but "the
latest Cells, continuously": without a reservoir the window takes the whole
resting field. The remaining 10,800 are the **curated field**, and everything
below about classes and quotas is measured on that field rather than on the
budget.

#### Mechanism and policy

Two questions live behind the display plane, and they are answered in different
places. *Who is on stage, and what do they look like* — the member set, staged
payloads, the budget, the activity FIFO, the recency index behind the tip
window, the coalesced delta — belongs to the stage. *Who should be* —
composition classes, the 20:70:10 quota, admission ranking, the displacement
ratchet, refill queues — belongs to a `CompositionPolicy`. There are two
policies: prefix staffing (which holds no state at all, because the window is
then the whole resting field) and curated staffing (everything above). The
stage knows nothing about classes; its canonical mirror carries each Cell's
`asset_kind`, which is chain fact, and the policy interprets it.

Freshness is the stage's own law rather than the policy's, and the two never
argue over a seat: tip churn displaces only tip members, moves no class count,
and takes no ratchet victim.

Policies answer synchronously, acting on the stage they are handed. That is a
hard constraint rather than a style choice: the stage has to be self-consistent
within a single mutation, because a snapshot taken right after it and the delta
emitted by it must agree.

#### Composing, then holding

With `galaxy_composition`, cknerv composes one non-persisted resting display
reservoir. Its target is the whole curated field — the browser's fixed
12,000-Cell stage less the 1,200 the tip window standingly holds. Curating
fewer would leave the difference to canonical fallback, which is the
plain-heavy boot the top-up then has to undo; curating more would spend index
pages and node batches on Cells that have no seat to go to. At the default
target the requested classes are exactly:

- 2,160 active Nervos DAO deposit Cells (20% of the field).
- 7,560 non-DAO Cells with a non-empty type script (70%).
- 1,080 plain Cells without a type script (10%).

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
validation, the server fills that shortage from matching canonical retained
Cells, then spills remaining vacancies toward DAO and typed Cells. With
sufficient candidates, the visible result remains exactly 20:70:10. A reservoir
Cell whose outpoint is also retained canonically is staged under its canonical
identity, so one outpoint is never on stage twice.

Membership reaches the browser as the cells projection's `display` section plus
`display` deltas carrying `enter_cells` (the full record of every Cell joining
the stage, canonical and resident alike — a snapshot ships the stage rather
than the retained map, so a client holds no record it was not sent) and
`exit_ids`. Ordinary churn is a handful of records; a refresh or a mode change
ships the transition whole. The plane changes only the
shared Cell/body and passive-fibre display subset: it never enters the canonical
Cell map, never increments Cell counters, and never emits `birth`, `death`,
`link`, or `pulse` deltas. The complete canonical Cell map and neighbour graph
continue to plan and render live nerve routes. Endpoints from the newest
canonical block temporarily replace resting entries inside their own class
quota, so exact Cell flashes remain visible without changing the ratio. The
broad new-block pulse still follows the canonical
`BlockMined -> CellDelta::Pulse -> lastPulseAtMs` path and is independent of
composition refreshes.

#### Holding the composition: demand, not a timer

A composition drifts. Curated Cells get spent, and every vacancy they leave used
to be refilled by whatever the canonical fallback stream had — which on mainnet
is over 99% plain. The old correction was to re-derive the whole membership
every 15 minutes. That is expensive, it churns membership that was fine, and it
leaves up to a quarter of an hour of Cells on stage that the chain has already
spent.

The plane instead publishes what it is short of, per class, and that shortfall
is answered directly:

- **Spends are seen exactly.** A staged Cell outside the retained map is, by
  definition, an outpoint the canonical index does not hold — so its spend
  arrives as a transaction input that resolves to nothing. The display plane now
  gets a look at every such input and retires the Cell it recognizes. Canonical
  truth does not move: no death delta, no counter, no map edit.
- **The shortfall is measured against the ideal quota**, not against the ratio a
  given composition happened to land on. On mainnet the composition lands near
  1.8K/2.8K/7.3K because DAO and typed candidates run out; measured against its
  own targets that would read as no shortfall at all.
- **Supply walks deeper** rather than re-reading the head. The source keeps
  where each class's paging reached and resumes from there, skipping what it has
  already handed out. One turn is bounded — a few pages and a few hundred
  candidates per class — so a large opening gap arrives as a series of quiet
  ticks rather than one stall.
- **Arrivals enter by a one-way ratchet.** The stage is always exactly full, so
  a curated Cell entering needs someone to give way, and the giver is drawn only
  from the canonical-fallback members of whichever class is furthest over its
  own quota. A curated Cell can therefore never be displaced by another curated
  Cell: the ratio climbs monotonically toward 20:70:10 instead of oscillating,
  and a class holding nothing but curated members simply yields nobody.
  Displaced members return to the front of their own refill queue.

Three deliberate limits, each visible in the product:

- **Plain is not curated.** The shortfall covers DAO and typed only; plain
  vacancies keep being filled from the canonical fallback stream. Convergence
  works by DAO and typed displacing plain's over-allocation, so the ratio still
  reaches 20:70:10 — that final 10% is simply canonical membership, and
  supplying it costs nothing. It is NOT what keeps recent on-chain births
  visible: the refill queues are seeded in admission order, so a plain vacancy
  is filled from the oldest Cell the server still holds, not the newest. That
  job belongs to the tip window, which is ranked by birth height and does it
  standingly.
- **A retired Cell is not revived by a reorg.** Canonical rollback revives
  canonical Cells through the ordinary birth path, but a staged Cell retired by
  a spend stays retired. Showing one fewer of the Cells we could have shown is a
  different sample; showing a Cell that has been spent is a lie, and the next
  top-up fills the slot anyway.
- **The periodic full refresh is off by default.** The composition runs once to
  staff the stage and then holds; a reorg at or below its anchor degrades the
  plane and makes it due again. With no periodic re-rank, the resting set is
  "the head of each class at the moment its slot was filled" rather than "the
  current head" — a Cell that has since slipped down the capacity ranking stays
  on stage as long as it is alive. Configuring a cadence restores the old
  behaviour, whose meaning is now narrower: a pure re-rank against the current
  index ordering.

#### Without a composition

Without ckbadger — disabled, unavailable, or before the first composition —
the plane stages the canonical insertion-order prefix instead, with
the same reserved activity pool putting each block's real endpoints on stage.
The browser cannot tell the two modes apart except through the section's
`provenance` (`mode`, `source`, `as_of`), which is what the source-health chip
reads. A content-identical refresh is suppressed outright: no delta, no
membership churn. A failed refresh leaves the last good record staged; a
canonical reorg or rebuild past its anchor drops the reservoir and returns the
plane to canonical staffing in one coalesced delta, re-arming that suppression
so the next composition applies even if its content is unchanged.

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

The PSIONIC BRAID portrait uses the same record only as a detachable
explanation layer. Resolved script family/name labels, exact deterministic
half-open data ranges, and byte-boundary ticks sit above the canonical Cell
morphology. The occupied CAP/LOCK/TYPE/DATA breakdown is hidden in the default
portrait and appears as separated arcs only while CAPACITY or DATA is focused,
so it cannot be mistaken for part of the braid; heuristic guesses never create
geometry. Before either semantic visual is admitted, each indexed
`script_hash` is converted to the same two big-endian shape-seed words used by
the direct CKB adapter and compared with the selected Cell's canonical lock/type
seed. A mismatch suppresses the semantic visual and appears through the
inspector's semantic error state. Losing, staling, or replacing the source only
withdraws or dims these optional layers: carrier points, crossings, data-knot
mask, scale, motion, and the galaxy near-LOD cache remain unchanged.

The transaction route adds the selected Cell's origin transaction, participant
capacity deltas, and proposal/commit lifecycle when the source provides them.

### Asset Ecosystem

With `asset_ecosystem`, cknerv refreshes one bounded aggregate response at most
once every 30 seconds after a usable source probe. The semantics stream carries
exact capacities normalized to shannons, whole-byte knowledge size,
basis-point category shares, and a bounded list of top indexed assets.

Capacity is split by scope across two surfaces. **CHAIN CAPACITY** is a
fused readout inside `COMMON KNOWLEDGE BASE`, in the same header system as
`TX HORIZON` and `ACTIVITY`: everything true of the whole chain — indexed
live capacity, knowledge bytes, the validated live-Cell census, category
shares, top assets — under one stated anchor, with the census row carrying
its own anchor whenever it differs. **STAGE SAMPLE** (`STAGE·07`) is an
independent panel holding everything true of this dashboard's local slice:
retained capacity, the rendered→retained→observed population funnel, the
stage-versus-chain composition disclosure, the asset/lock taxonomy, and the
medium legend. It is hidden by default and docks beside `CKB·01` when
summoned from the panel menu, as does the `RENDER STATS` (`GL·08`) panel.
Every CKB quantity on the HUD reads in one `K/M/G·CKB` family (`12.5 K·CKB`,
`57.86 G·CKB` — byte prefixes, since 1 CKB buys exactly 1 CKByte of state),
with exact figures on value tooltips. The magnitude binds to the unit with
the house separator rather than a space, so a figure and the unit it is
counted in read as two tokens instead of three. The unit's Chinese name —
字节元 — is spoken once in the whole HUD, on the cell dossier's `CKBYTE` zone,
which is the one surface whose subject IS the unit; every rail row counting in
it is read for its number and carries the `CKB` suffix alone. In CKB-only mode
the chain readout is simply absent; the stage panel never wears the chain's
header.
Indexed totals are never extrapolated from the retained Cell reservoir.
Only whole-chain context dims when the source is stale or its own refresh
is more than 90 seconds old; direct-node stage data remains at full
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
disappears in CKB-only mode and dims after three missed refreshes.

### Network Atlas

With `network_atlas`, cknerv checks the crawler summary at most once every 60
seconds. A usable crawl triggers exactly one `network/distributions` request.
The atlas asks for no peers at all: upstream folds versions and countries over
its whole verified set now, so cknerv no longer draws a 64-row sample and no
longer has to caption one. The adapter validates the round's counters and each
histogram against the population it claims to partition. Peer IDs and addresses
never enter the shared wire contract.

The round's five peer counts are one disjoint outcome matrix read five ways,
not five independent measurements, and the adapter checks them as equalities:
`reachablePeers + exhaustedCandidates + foreignPeers` is exactly
`candidatePeers`, and `reachablePeers + verifiedUnavailablePeers` is exactly
`verifiedRetainedPeers`. The first is what lets the panel draw those three
outcomes as three widths of one bar — three parts that did not close would be
drawn as shares of a whole they are not the parts of. The second is why
`verifiedUnavailablePeers` may not be a fourth width: it cuts across the
exhausted and foreign cohorts rather than joining them, so it is never added to
them. `distributions.verifiedRetained` is carried separately as
`indexed_peers`: it means the same words as the round's count on a different
clock — a node-store scan as the request arrived, against what the round's
matrix added up to when it finished — so the two are never asserted against
each other.

The round's other counters are deliberately unread. `addressAttempts` and
`addressObservations` count ADDRESSES rather than peers — a peer is dialed once
per address anybody advertised for it — and cknerv drew them for a day as a bar
naming how far each dial got. It is gone at the user's word that the panel was
not being asked that question, and the wire fields went with it rather than
lingering as slots nothing reads. `nonSuccessfulAddressAttempts`,
`malformedAddresses`, `peerOutcomes` and `discovery` were never read.
`distributions.asns` is unread for the same reason as the bar it fed;
`distributions.protocols` never could be read, because upstream counts one row
per protocol per peer, so it adds up to a multiple of the fleet rather than to
it and no proportional strip can be drawn from it.

`PEER MESH` always keeps the local CKB node's directly measured peer count and
head consensus as primary truth, plus a catch-up row that appears only while our
own tip trails the best known head. Per-peer client version and RTT belong to
the floating PEER and NODE cards, never to this rail. A valid atlas record adds
a reach bar and country and client-version strips as more rows of that same
panel rather than a titled sub-section: one network read at two distances, near
rows measured over our own links and far rows indexed by the crawl. The shared
`Crawler atlas · round N · as of #block` provenance waits on hover, which is
also where a bar's whole segment list and a strip's whole bucket list wait.

The reach bar is `NAMED BY THE NETWORK · N PEERS`, three segments running from
the peers no dial ever got an answer out of, through the peers that answered
from another chain, to the peers that answered from this one. It is never
sorted by size: the progression is the reading. It states its own total because
that total is not the panel's — the two strips under it are folded against
`indexed_peers`, the smaller set the crawler holds verified — and it is painted
in one hue stepping in brightness where those strips are painted in unrelated
hues, so two stacked proportional bars cannot be read into each other. **A
cohort that resolves to zero stays on screen**: zero is a result, and a cohort
that vanished on it would make a healthy crawl and a broken one look identical.
A zero segment is zero pixels wide, so the legend under the bar prints all
three counts rather than only the ones that fired — which also means what it
prints always adds up to the number in its own caption, and a reader can check
that nothing was folded away.

`verifiedUnavailablePeers` is on that bar's hover rather than in it. It is the
one count here that cuts across two of the three segments instead of joining
them, so it can never be a fourth width, and the hover is where it costs no
line — the same place every other number on these rows says what it counts.

What may appear here at all is a fact about the NETWORK; what may not is a fact
about the crawl that read it. The median crawler dial went because it measured
the crawler's distance from the fleet, the frontier state because it is the run
loop's own, the newly-verified count because it is the crawler's knowledge
changing rather than the network's shape. The address histogram stays because a
dial that never opened is a dead address in the network's gossip and a session
that opened and went quiet is a live node that will not say who it is — the
crawler is the instrument there, not the subject. Enrichment is strictly additive: when the crawler is
unconfigured, empty, disabled, or canonically unusable those rows are simply
absent and the panel is its measured rows alone. It creates no scene nodes or
edges, and staleness dims the indexed rows and adds a single `ATLAS STALE` line
after three missed minute refreshes.

The median crawler RTT left with the sample it was drawn from. It measured the
crawler's own distance from the fleet rather than anything about the fleet, and
it was the last number here that a bounded page could answer — keeping it would
have put a 64-row median inside a block of census figures with no way for a
reader to tell which was which. The crawler's per-peer dial still appears on the
SIGHTED node card, where it is a statement about one peer it dialed.

`network/protocols` counts are answered by the same route and deliberately
unread: upstream counts one row per protocol per peer, so the buckets add up to
a multiple of the population rather than to it, and a proportional strip drawn
from them would state a denominator they do not have.

The bounded `network/peers` page now has one reader, the roster, and it is also
the only writer of the peer-route health the DOSSIER consults. The
newest-advertised-first ordering invariant moved there with it: which peers land
inside a bounded slice is decided entirely by the order they arrive in, and the
roster is the only reader still taking a slice.

The roster asks that route once per rung of the crawler's evidence gradient —
`state=reachable`, then `state=verifiedUnavailable`, then
`state=advertisedUnverified` — and gives each request only what the 256-node
stage budget has left. Unscoped, the page is one list sorted by advertise time,
which mixes the rungs: asking it for 256 rows of a network larger than that
returns whoever the gossip mentioned most recently, with no guarantee that a
single peer the crawler has actually spoken to is inside it. Asking rung by rung
makes "every verified peer, then hearsay with what is left" a property of the
request rather than a policy in a comment, and it also stops the two states the
roster never names from spending budget on their way to being dropped. A rung
the budget never reached is a roster that does not name everything the crawler
holds, which is what `truncated` reports — the only way that flag can be raised
with no cursor behind it.

Within the hearsay rung the order is upstream's own, newest positively-observed
first, and it is knowingly not the right weight. The honest measure of hearsay
is how many independent peers named the node, and that lives on the per-peer
detail route rather than on the list row, so ranking by it would cost one
request per candidate. What the list row can say is worth something: the
observation clock separates peers something still touches from peers nothing
has touched in a while, and inside a single round it degenerates into a peer-id
prefix — arbitrary, but the same arbitrary set every round, so the colony does
not reshuffle its identities every minute.

Every row carries its own `state`, and all three are rungs the colony has a
mark for: `advertised_unverified` stages as the faintest of them, because a
peer nobody has ever got an answer out of is still a real peer and drawing it
is what replaced a rung the scene used to invent.

The `state=` word matches upstream's dial result and nothing else. Upstream is
explicit that it neither filters nor reinterprets the separate participation
evidence beside it, so these three rungs are three answers about dialing — and
one consequence is worth stating plainly: a peer the crawler has never managed
to dial, but which the local node is in a live session with, reports
`no_completed_observation` permanently and is named by no roster. On a publicly
reachable host that hides exactly the peers upstream grew this evidence to
reveal. The ruling that the roster does not name that state stands; the
question of whether dialability should remain the axis is open.

The optional fields are where that gradient is spelled out, and absent is not
`"Unknown"`. Upstream builds a peer's version, country, ASN, reach clock and
dial out of its verified node record and answers `null` for all five when it
holds none — while for a peer it DID reach whose geolocation lookup came back
empty it writes the word `"Unknown"` itself. Two different true sentences:
nobody has ever spoken to this node, versus somebody did and could not place it.
The roster carries each through as it arrived rather than folding both into the
word, because the fold prints the crawler's verdict over a peer it never dialed.

Four clocks ride every row and none may stand in for another.
`last_reachable_ms` is when the crawler SAW the node and is absent for one it
never did; `last_advertised_ms` is when the network last NAMED it;
`last_observed_ms` is when the crawler last TRIED it, which is what dates a
failure; `latest_positive_observed_ms` is the newest of every positive channel
at once — gossip, target-centric evidence, a direct session, or the crawler's
own identification.

The last of the four is the one that is required, and it took that job from the
advertise clock. A peer met through a session nobody gossiped has no advertise
moment, so upstream answers `null` there rather than inventing one; it never
answers `null` for the maximum, because a candidate with no positive evidence
to take a maximum over is a request it refuses outright. The advertise clock
therefore becomes optional and is read if it is there — dropping a verified,
dialable, named peer out of the colony over a clock no reader draws would be a
worse answer than the missing clock. It is also the key upstream sorts this
page by, which makes it the axis the roster's own cut was made along.

### Peer Sighting

With `peer_sighting`, selecting one peer resolves that single node's crawler
dossier on demand through `GET /api/enrichment/peers/:node_id`: country, ASN,
client version, opened protocols, first and last sighting, public
reachability, and dial RTT. This is the one thing local RPC cannot answer —
how the network sees a node from outside, including our own. The lookup is a
point read; the atlas remains the only bounded whole-network sample, and
neither one puts a peer identity into the streamed contract.

The address book is now read from both ends, under two names and two units.
Upstream deleted the outbound peer count the record used to carry and answers
with `advertisers[]`, which names the peers that named THIS node — the same
relationship read from the other end, so the old slot is gone rather than
filled by it. In its place the record carries `advertiser_peer_count` (how many
distinct peers advertised this node) and `advertised_address_count` (how many
addresses this node advertised to the crawler, off the verification's own
`discovery` counters). They are never interchangeable: one counts peers and the
other counts addresses, and a peer is advertised under every alias anybody has
seen it at, so the second runs several times the number of peers behind it.

⚠️ `advertiser_peer_count` is a count of DISTINCT ADVERTISERS and not the
length of `advertisers[]`. Upstream used to rebuild that list by scanning node
records for the ones naming this peer, which yielded one row per advertiser; it
now keeps durable target-centric evidence keyed by advertiser AND alias, so one
peer gossiping this node under three aliases writes three rows. Live, 5772 rows
stand for 3145 advertisers. The adapter reads the id and counts the set, and a
row whose id it cannot read stands the whole count down rather than being
skipped — a rename of that key would take every row with it, and a skipping
count would answer zero over a peer the whole gossip layer repeats.

⚠️ Neither is a topology edge. Upstream is explicit that this is address-book
gossip: a peer that advertises another's address may never have spoken to it.
The `CROWD` rows say so.

`advertiser_peer_count` is absent, never zero, when the source did not send the
list at all — the count is the fact, so "nobody can say" and "nobody names it"
have to stay apart. `advertised_address_count` is absent for every peer with no
verification, because the counter is nested inside the crawler's authenticated
observation.

cknerv holds the base58 node id CKB's `get_peers` reports and the crawler is
keyed by the multihash bytes behind it, so the adapter decodes the id before
asking. The source-specific camelCase DTO and its unix-second clocks stay
inside the adapter; the shared `PeerSightingRecord` counts milliseconds like
every other cknerv wire type, and carries `last_seen_ms` so every row drawn
from it can be stamped with its own observation age instead of passing for
live link telemetry.

The route distinguishes four true statements, and only the first is an
absence of configuration:

- no source configured — `404 enrichment_disabled`, exactly as the Cell and
  transaction routes answer it;
- `200 {"state":"unsighted","reason":…}` — the lookup succeeded and there is
  no sighting. `never_sighted` means the source was asked and holds nothing at
  all under this id — not a verification, and not even an address somebody
  advertised (a source running with its crawler switched off looks the same
  from here and means the same thing); `unreadable_node_id` means the local
  node's id for this peer could not be turned into the source's key, so
  nothing was asked; `no_crawler` means the configured source has no crawler
  at all. Never having been seen from outside is real information about a
  node, so it is reported rather than discarded as a 404;
- `200 {"state":"unsighted","reason":"advertised_unverified","advertised":…}`
  — the network names this peer and nobody outside could get an identify out
  of it. Still an absence of a sighting, and the only one with evidence under
  it: when anything last observed the peer, when the network last named it if
  it ever did, how far the furthest of its dials got and at which address, how
  many of the peer's addresses that round dialed, how many completed rounds in
  a row have ended without a verification, and how many distinct peers still
  name it. This is the ordinary state of a node behind NAT — it dials out and
  cannot be dialed back — so cknerv can hold a live link to a peer that is
  permanently in it.

  The two clocks are two sentences and the plate says which one it used.
  `last_advertised_at_ms` is when the network named the peer and is absent for
  one the crawler holds no gossiped alias for; `latest_positive_observed_ms` is
  the newest of every positive channel at once and is the one upstream
  guarantees, so no report here is undated. Filling the first from the second
  would date the report with an event that did not happen;
- `200 {"state":"sighted","sighting":…}` — the record.

An unreachable source, a malformed answer, an upstream store error, or a
canonical anchor that moved during the fetch is `503 enrichment_unavailable`:
absence never papers over a fault. So is a point lookup that 404s while the
crawler's own peer list route is not answering — that pair means the peer API
this build asks for is gone, which is a fault about cknerv rather than a
verdict on a node. The ckbadger adapter reads that from the list route the
atlas and roster already refresh every 60 seconds, so it costs no extra
request. The record rides the same validated anchor
and re-read fence as the network atlas, but it never enters the semantics
projection — it describes a network node rather than a chain object, and the
set of peers belongs to the network.

### Chain Census

With `chain_census`, cknerv refreshes ckbadger's `cells/live-summary` singleton
once every 30 seconds. The source maintains that record incrementally from
birth and spend across live sync, bulk build, and reorg, so the response is a
fixed-size read in constant work and never a scan of live cells.

The record's anchor is **not** the compatibility anchor the probe validated: a
census states an exact count at one specific block, so the block it is anchored
at has to be the one the counts are true at. cknerv therefore proves the
summary's own `tip.block`/`tip.hash` pair against the local node's retained
canonical evidence and admits the counts only when that exact pair is one this
chain still holds. A tip ahead of the retained window, or a same-height block
with a different hash, yields no record rather than an approximate one — the
count would otherwise describe a chain this dashboard is not on.

The source has no synthesized default: it answers `503` while the aggregate is
initializing (bulk sync, or a reorg withdrew the record) and `500` on a corrupt
one. Both mean cknerv publishes no census, never a zero. A zero is a claim
about the chain, and a source declining to answer is not making one.

`classes` — `dao`, `typedNonDao`, `plain` — are mutually exclusive and must sum
to `liveCells` exactly. cknerv re-checks that partition at the adapter boundary
rather than trusting it, and rejects the whole record when it does not hold: an
approximate partition cannot be disclosed as a chain composition. A response
without classes still yields a usable count. `dataBearing` is orthogonal to
that partition and is the whole-chain twin of the retained window's own
data-bearing count.

Enabling this capability requires a from-genesis ckbadger re-sync; an instance
that predates the aggregate answers `503` indefinitely, which cknerv treats as
the ordinary "no record" state.

### Script Registry

With `script_registry`, cknerv asks the index what the script identities its own
galaxy is holding are called, at most once every five minutes. The question is
"what is on my galaxy", not "what exists on CKB": the cells projection publishes
the `(code_hash, hash_type)` pairs it currently holds through a shared sink, an
empty observed set asks nothing at all, and the deduplicated hashes — at most
256 — go out as one batched `scripts/lookup`. An index with a thousand families
still produces a record sized by what cknerv observed.

`scripts/lookup` uses a transaction hash to disambiguate a code hash that
several deployed scripts share, which happens only for data-hash scripts. A
census is a set of identities with no transaction attached, so cknerv asks
without that context and reads each entry's `resolutionState` to learn when it
mattered. An entry that is not `resolved` is dropped rather than guessed at, and
so is one named "Unknown": `resolved` means "I found the deployment", not "I
know what it is", and measured on a live mainnet galaxy 8 of 29 identities come
back that way. Passing those through would print "Unknown" as a script family
while reporting nothing unresolved, which is the exact failure this capability
exists to end.

The lookup route carries no descriptions, so descriptions and family websites
come from the bounded `scripts` catalogue joined by name — measured unique
across its 66 families. A catalogue failure costs those two fields and nothing
else. The canonical anchor is proved before the lookup and re-proved before the
record is admitted, like every other capability.

The record carries the resolved entries plus `unresolved`, a count of observed
identities the index had no name for. They are counted rather than listed: the
panel already holds those code hashes from the cells projection's census, so the
record only has to say that asking produced nothing.

`STAGE SAMPLE` joins the two planes in the browser on `(code_hash, hash_type)`
and renders the real families in its **ASSETS** and **LOCKS** bars in place
of the four lock and seven asset families cknerv pins itself — never beside them.
Without a census at all, from a backend predating it or a galaxy restored from
older state, the pinned families remain rather than an empty panel. A family
nothing named keeps its code hash as its label. Losing the index therefore costs
names, not counts: the bars still show the true distribution, spelled in hashes.

### Producer Ledger

With `producer_ledger`, cknerv reads ckbadger's miner-address distribution
every 120 seconds and turns it into a week of block production. It is the twin
of the canonical producer window, not a replacement: the window is 240
attributed blocks of recency, emptied by every reorg and rebuild and empty for
the first minute of a boot, and this is completed days of size, warm from the
first frame. Both are published and each states its own window, because "62% of
a week" and "60% of the last five blocks" are different sentences.

The join is exact and is the reason the capability can exist at all. cknerv
names a producer by the hash of the cellbase witness lock script, and ckbadger
keys its miner records by that same hash, so a ledger row and a window entry
are the same identity by string equality — nothing here is matched by name,
address or heuristic.

One refresh is **`1 + N + 1` requests**, sequential, N being the rows kept
after the 16-row cap: `charts/miner-address-distribution` once, then
`addresses/{lock_hash}` once per row for the payout balance, live-cell count
and transaction count, then one `blocks/{tip-12}` for the reward sample. At the
live mainnet row count of seven that is nine requests every two minutes, and
the ceiling is eighteen. They run sequentially under the 4-second client
timeout, and the supervisor holds one refresh in flight per capability, so a
slow index delays this ledger and nothing else.

The record carries **no chain anchor**, and is the only aggregate here that
does not. A seven-day total over completed days is not a statement about the
canonical tip, so anchoring it would let a three-block reorg discard a week the
reorg never touched — and would do it at the exact moment the 240-block window
it stands beside has also just been cleared. `indexed_tip` says how far the
source had indexed when it answered, which dates the answer without pretending
it is anchored to a block. A rebuild still clears it and the next refresh
republishes.

Field discipline follows the crawler routes, which have cost this adapter two
schema breaks: only the fields that are printed are declared. Upstream also
sends `title`, `minerName` and `percentage`, and none of the three is read.
`percentage` in particular is a share, and a share is computed where it is
printed against the denominator it belongs to — the ledger carries `blocks` and
`total_blocks` and divides at the point of print, so there is exactly one place
a share can be computed and exactly one window it can be computed over. The
block detail's two miner fields are decoded through their own struct rather
than added to the compatibility anchor's, so a rename there can cost the reward
sample and can never cost the anchor.

Balances are **decimal strings** end to end. The live top miner held
9,826,509,274,171,764 shannons on 2026-09-02 against a JavaScript
`Number.MAX_SAFE_INTEGER` of 9,007,199,254,740,991; the browser divides with
`BigInt`. The same is true of the sampled reward.

Coherence is checked before the record is admitted, and each refusal names the
rule it broke: `total_blocks` positive, every row's `blocks` positive, every
key non-empty and `0x`-prefixed, no duplicate keys, and `sum(blocks) <=
total_blocks` over every row upstream sent — before the cap, because the cap is
this side's budget rather than a claim about the window. A refusal is a warning
and a retry on the next cadence tick, and the ledger already published stays:
a week of block production does not stop being true because one refresh could
not read it. Rows are ordered blocks-descending then key-ascending so an
unchanged chart compares equal refresh after refresh, and capped at 16 — twice
the live row count of seven, and the bound on what one refresh may cost, since
every row is one more address lookup.

Three absences are distinguished. A **404 on the chart** is "this source
computes no miner distribution": the supervisor publishes a clear, once, and
the panel falls back to the window it never stopped holding. Any other non-2xx
is a fault. A **failed address record** costs that row's balance side and
nothing else — the row keeps its window figures, the other rows are filled, and
an absent balance is never rendered as a zero one, because "not looked up, or
looked up and refused" is not "holds nothing".

In the browser the ledger is reached **through the live capability list**, which
no other pushed record needs. Every other aggregate expires on a clock or on an
anchor and this one has neither, so nothing in the client would ever age a week
out: a source that stops declaring `producer_ledger` is what stops feeding one.

The two windows meet in one derive. `deriveBlockProducers` joins the ledger onto
the canonical window by key, and the standing set is their UNION — a producer the
week names and the ring has lost stands with zero window blocks and its week
beside it, a producer the ring holds and the week does not carries no ledger at
all. Ranking reads exactly one of them, the week when there is a week and the
ring when there is not, and neither numerator is ever divided by the other's
denominator. Coherence is re-checked on this side rather than trusted from the
adapter, with one rule the adapter does not need: every shannon string has to be
digits, because `BigInt` is what reads them and `BigInt('12 CKB')` throws inside
a render. An incoherent record is treated as absent, so the worst a bad one can
cost is the view every build before the ledger had.

Three surfaces read the join, and only the last of them is a HUD readout. The
**colony** takes the union as its cohort set, so an aperture stays cut into the
peer membrane through a boot, a reorg and a quiet half hour — the hole used to
close with its producer's last block. The **intake** under that aperture takes
the week's share as a rate, because the sink's strength is one
(`canvas-rendering.md` §10.1). And the **cohort card** grows a fourth plate,
`WEEK`: the week's blocks and share, the payout address, the harvest that
address holds with its live-cell and transaction counts, and the sampled reward
when this refresh sampled this cohort. ⚠️ The implied hashrate printed beside
them is NOT ckbadger's. `statistics/network.hashRate` is never read; the client
multiplies the share by its own estimate off the chain's difficulty and its own
observed block intervals, so the plate mixes an indexed share with a local
measurement and states both windows rather than importing a third. The plate is
absent when no week reached the view at all and dashes its rows when a week
names other cohorts, and `PEER·02` states the week in its row while keeping the
240-block window in that row's title. No pool name appears on any of them,
because there is none to print.

## Persistence

Optional semantics are bounded in memory and intentionally not persisted. They
are rehydrated from the configured source, so enabling, disabling, or changing
ckbadger does not alter the persistence schema and does not require
`cknerv purge`. Display membership is likewise never persisted: a restart
re-derives it from the restored canonical Cells and upgrades to composed
staffing once the first refresh lands.

## Known Limits

- Direct CKB ingestion retains at most the first 1,024 Cell-data bytes. The
  indexed content record retains at most the first 4,096 bytes while preserving
  the exact total size and an explicit completeness flag. Larger payloads can
  therefore be analyzed by ckbadger but are not transferred in full to the
  dashboard.
- Transaction participants expose exact capacity deltas only when every
  attributed input and output includes capacity.
- Selected-transaction protocol activities are not populated because ckbadger
  does not expose an efficient per-transaction activity lookup. cknerv avoids
  N+1 background scraping and does not relabel latest samples or historical
  chart points as current chain truth.
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
- `dao/deposits` ignores `sort_key`/`sort_direction`, so DAO ranking is done by
  cknerv over the pages it has fetched — "the largest of the first N in cursor
  order", not the globally largest deposits. This is measured, not assumed. It
  is also why top-ups do not need a ranked endpoint: a top-up asks for another
  live Cell of a class, not for a rank, and mainnet supply (~21k live deposits,
  ~64k typed Cells across 53 asset groups) is several times the quota either
  way.
- ckbadger's miner records carry a `minerName`, and it is `null` for every
  miner on mainnet — all seven of them, measured 2026-09-02. There is no
  upstream pool registry behind the field, so the producer ledger names a
  cohort by its lock hash and its payout address and never by a pool. Nothing
  else anywhere maps a producer to a pool or to a peer either; the self-declared
  client build string stays what it is.
- The producer ledger's reward is a **sample, not a stream**. ckbadger's block
  list carries no miner fields at all, and its block detail names the miner
  immediately but carries `miningReward` only once the cellbase that pays it
  has matured, about eleven blocks later. One refresh therefore reads one block
  twelve deep and fills at most one row — the one whose payout address that
  block names. An absent reward on a row says "this refresh did not sample this
  producer", never "this producer was not paid", and a producer whose own
  address lookup failed cannot be sampled at all, because the block detail
  names its miner only by address.
