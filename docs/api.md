# HTTP and WebSocket API

The routes the CLI serves, the frames the two streams carry, and the reorg,
rebuild, and replay behavior a client has to handle. The normative protocol
contract is
[Design and Architecture §8](architecture.md#8-http-and-websocket-protocol).

The CLI serves the API and embedded SPA on one localhost port. Non-API paths
fall back to the SPA.

By default every `/api/*` route, the WebSocket upgrades included, is served
only to loopback. A request whose `Origin` header names anything but `localhost`, a
`*.localhost` name, an address in `127.0.0.0/8`, or `::1` is answered
`403 {"error":"forbidden_origin"}`; one whose `Host` header names anything
else is answered `403 {"error":"forbidden_host"}`. Browsers apply no CORS to
WebSockets, so without this any page the operator has open could read the
chain and cell streams, and a rebound DNS name could reach the plain routes.
A client that sends no `Origin` at all — curl, a monitor, the crate's own
smoke tests — is unaffected, and so is the Vite dev proxy, which rewrites the
host to `localhost:7001` and forwards `Origin: http://localhost:5173`. The
SPA bytes and `/runtime-config.js` are outside the guard.

Setting `[dashboard].hosted` to a service name explicitly publishes all these
read-only routes. Public Host/Origin headers and absent Origin are accepted,
including cross-origin WS readers; there is no authentication or wildcard
HTTP CORS. The listener stays on loopback behind a same-machine HTTPS reverse
proxy. See [hosted dashboards](configuration.md#hosted-dashboards).

`/runtime-config.js` assigns `{buildVersion, hosted, galaxy, enrichment}` to
`window.__CKNERV_RUNTIME_CONFIG__`. `hosted` is the configured name or `null`,
and it does not contain the RPC endpoint. The registered node keeps ID
`ckb:local` and carries that name in its existing `label` field. Renaming it
uses the existing registration/upsert path; snapshot and WS shapes stay the
same. Upstream detail failures keep their status and error code with a public
diagnostic summary; underlying exception details stay in server logs.

| Method | Path | Shape |
|---|---|---|
| `GET` | `/api/health` | `{ build_version, uptime_s, degraded, revision, tip, tip_age_ms, replay_active, mutation_ring_len, reducer_alive, adapters, projections, quarantined_projections, enrichment }` |
| `GET` | `/api/entities/chain/snapshot` | `{ revision, chain, chain_nodes, peers }` |
| `WS` | `/api/entities/chain/stream?since=<rev>` | snapshot, delta, lagged, or heartbeat frames |
| `GET` | `/api/projections/cells/snapshot` | `{ revision, snapshot }` where `snapshot.cells` is the staged set, not the whole retained galaxy |
| `GET` | `/api/projections/cells/snapshot.bin` | Columnar little-endian snapshot (~9x smaller); revision patched into the header and mirrored in `x-snapshot-revision` |
| `WS` | `/api/projections/cells/stream?since=<rev>` | snapshot, delta, lagged, or heartbeat frames |
| `GET` | `/api/cells/:tx_hash/:output_index/data` | One Cell's complete output data read from the node; canonical, so it answers in every mode; immutable-cached, `413` over 2 MiB |
| `GET` | `/api/projections/semantics/snapshot` | Optional indexed-enrichment snapshot; present even when disabled |
| `WS` | `/api/projections/semantics/stream?since=<rev>` | Independent optional semantics snapshot/delta stream |
| `GET` | `/api/enrichment/cells/:tx_hash/:output_index` | Lazily resolve one selected Cell; `404 enrichment_disabled` when absent |
| `GET` | `/api/enrichment/transactions/:tx_hash` | Lazily resolve one origin transaction |
| `GET` | `/api/enrichment/peers/:node_id` | Lazily resolve one linked peer's crawler sighting; `200` says either `sighted` or `unsighted`, `404 enrichment_disabled` when no source is configured |

The projection route name for the cell galaxy is literally `cells`
(`CellGalaxy::name()`).

A cells snapshot carries the rows the display plane has staged, not every
retained Cell — on mainnet the retained set runs about four times the stage,
and the renderer never draws the remainder. Membership still resolves
completely: staged Cells the canonical map does not hold ride the display
section as residents. What the rest of the galaxy contributes travels as
`snapshot.stats`, an aggregate over the **full** retained set — per-lock,
per-asset, and per-kind counts plus a census of the script identities that set
holds — so panel numbers do not move when the rows do. Both wire forms carry
it: the JSON snapshot as a field, the columnar buffer in its tail. The census
is refreshed at most once per block through its own `script_census` delta;
a server without the segment still works, and the browser falls back to
counting whatever rows arrived.

The optional `semantics` projection and lazy enrichment routes are documented
in [ckbadger.md](ckbadger.md), including their independent revision,
canonical-anchor checks, refresh intervals, UI behavior, and failure isolation.
One of its records, `script_registry`, names the identities that census counts;
the browser joins the two planes on `(code_hash, hash_type)`. Another,
`script_family_census`, counts the whole chain's live Cells by script family,
each family classified by ckbadger's own inventory — its token registry and
its object and identity standards — so the chain panel's `CELL CENSUS` bar
splits the chain by what ckbadger's Inventory pages call a token, an object
and an identity.

Both WebSocket routes emit
`{"kind":"heartbeat","revision":<last-confirmed-revision>}` every five seconds
when no data frame is needed. `@cknerv/cache` reports each transport as
connecting, live, retrying, resyncing, or stale; the default dashboard treats
15 seconds without a valid data/heartbeat frame as stale. This browser
freshness state is displayed separately from CKB IBD/tip sync, so a quiet chain
cannot look disconnected and a frozen dashboard cannot look nominal.

Each entry in `snapshot.recent_links` keeps `from_ids` / `to_ids` for causal
ordering plus compact `endpoint_anchors` containing each endpoint's `id`,
`pos_seed`, `content_hash`, and `resolved`. These immutable anchors preserve
the observed transaction's spatial and content evidence after a bounded full
Cell record is garbage-collected; they do not preserve the complete Cell
payload. An input the projection never retained still gets an anchor, derived
from its outpoint alone: `resolved: false`, an exact id and position, an empty
`content_hash`, and no entry in `from_ids`.

The CKB adapter validates its last canonical block hash on every poll. On a
same-height replacement, tip regression, or changed ancestor beneath an
advancing tip, it walks saved height/hash anchors backward to the highest
common ancestor and emits `{"type":"chain_reorganized","from_block":N}`
before replaying canonical blocks from `N`.

In response, the cells stream emits
`{"type":"link_prune","from_block":N}` before its Cell rollback deltas.
Consumers must discard retained causal links and queued visual events whose
`block >= N`; replacement-chain links then arrive as ordinary `link` deltas.
This keeps inspection, memory recall, and live pulses tied only to the current
canonical chain.

The browser cache also captures a compact visual witness (`id`, `pos_seed`,
`content_hash`) for suffix Cells at the instant `link_prune` arrives, before
rollback GC removes them. The scene renders those real records as one short
fractured invalidation echo; only subsequent real `birth` deltas can trigger
the replacement re-entry animation. No synthetic fork, transaction, or Cell
payload is invented or retained for the effect.

Canonical anchors and the Cell birth/death undo journals retain a compact
48-block exact-rollback window (plus one parent anchor needed to prove the
rollback boundary). If no common ancestor survives inside that window, the
adapter emits `{"type":"chain_rebuild","from_block":N}`. Chain rings are
cleared, the Cell projection emits `link_prune` from block `0` plus GC/stats
reset deltas, and a fresh target-sized Cell reservoir is hydrated in a progress
envelope. This avoids retaining every boot-time birth/death snapshot while
still refusing to keep an unprovable orphan state. Cell IDs remain monotonic
across the rebuild so queued visual work cannot alias newly replayed Cells.

The cells snapshot and delta stream expose the replay cause as
`phase: "boot" | "catchup" | "reorg" | "rebuild"`. The dashboard gives
each operation its own language and color instead of presenting every replay
as boot seeding. A regressed tip with no replacement suffix yet remains
visible as a reorg waiting state; transient block-visibility gaps keep their
original phase until replay completes. Older frames without `phase` are read
as `boot`.
