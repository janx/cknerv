# cknerv CLI — Smoke Test

Manual + programmatic verification that `cknerv` correctly visualizes a
running CKB chain. Run before tagging a cknerv release or after any change
to `cknerv-adapter-ckb`, `cknerv-server`, or the SPA.

## Prerequisites

- A running CKB node with JSON-RPC enabled (default `http://localhost:8114`).
  Any of: local devnet, Nervos pudge testnet node, or mainnet node.
- `cknerv` binary built: `cargo build -p cknerv-cli --release`
- A browser (for the visual checklist).

## Quick start

```bash
# Against the default local node (:8114):
./target/release/cknerv

# Against an explicit RPC + port:
./target/release/cknerv run --rpc http://localhost:8114 --port 7001

# Headless (no browser auto-open):
./target/release/cknerv run --no-open
```

## Endpoint shapes

cknerv-server exposes two chain-generic snapshot endpoints. Verify the JSON
shape before scripting against it — the grep/parse patterns below depend on
this structure.

`GET /api/entities/chain/snapshot` — envelope `{revision, chain, chain_nodes}`.
`tip` is **nested under `chain`**, not at the top level:

```json
{
  "revision": 87,
  "chain": {
    "tip": 19431450,
    "total_blocks": 19,
    "total_txs": 35,
    "reorgs": 0,
    "epoch": { "number": 14268, "index": 509, "length": 1800 },
    "mempool": { "pending": 4, "proposed": 0, "orphan": 0, "min_fee_rate": 1000 },
    "recent_blocks": [ { "number": 19431432, "hash": "0xbc65…" } ],
    "recent_tx_hashes": [ { "block": 19431432, "tx_hash": "0x8cf5…" } ],
    "chain_name": "ckb"
  },
  "chain_nodes": [ { "id": "ckb:local", "label": "ckb-local", "is_miner": false } ]
}
```

`GET /api/projections/cells/snapshot` — envelope `{revision, snapshot}`.
The rows live under `snapshot.cells` and carry the *staged* set, not the whole
retained galaxy; whole-galaxy aggregates live under `snapshot.stats`, and
cumulative counters are `snapshot.total_births` / `snapshot.total_deaths`. This
procedure's 100-Cell target is far below the 12,000-Cell stage, so every
retained Cell is staged here and counting rows is exact:

```json
{
  "revision": 87,
  "snapshot": {
    "cells": [ { "id": 0, "born_at_ms": 0, "death_at_ms": null, "birth_block": 19431432, "tag": null, "out_point": { "...": "..." }, "capacity": 0, "data_hex": "0x", "content_hash": "0x…" } ],
    "total_births": 58,
    "total_deaths": 10,
    "last_pulse_at_ms": 0,
    "recent_links": [],
    "stats": { "in_view": 48, "data_bearing": 3, "capacity_shannons": 0, "by_kind": {}, "by_lock": {}, "by_asset": {}, "scripts": { "...": "..." } }
  }
}
```

(The projection name in the route path is literally `cells` — it is
`CellGalaxy::name()`.)

The corresponding required WebSocket routes are:

- `/api/entities/chain/stream?since=<revision>`
- `/api/projections/cells/stream?since=<revision>`

`GET /api/projections/semantics/snapshot` is always available when the CLI
registers its built-in optional projection. With no `[ckbadger]` section its
source status is `disabled`, and
`GET /api/enrichment/cells/:tx_hash/:output_index` returns
`404 enrichment_disabled`, as does
`GET /api/enrichment/transactions/:tx_hash`. Neither condition affects the
required routes.

When `[ckbadger]` is configured, the additional WebSocket route is
`/api/projections/semantics/stream?since=<revision>`. Its revision is independent
from chain/cells and source health should settle to `ready`, `syncing`, `stale`,
`incompatible`, or `error` without interrupting either required stream.
After selecting or copying a retained Cell outpoint, both lazy routes should
return anchored records. The transaction response should include its block,
fee/cycles when available, a `transaction_io` action, and a
`transaction_lifecycle` action when the ckbadger lifecycle endpoint is
available. A deterministically decoded UDT Cell should additionally include an
`asset` with the same type-script hash plus its exact raw amount and available
standard/name/symbol/decimals. The semantics snapshot should then contain both
records without changing the chain snapshot revision.
Once the source is ready, the semantics snapshot should also gain an
`asset_ecosystem` and a `dao_state`. The DAO record's `statistics_block` must
not exceed its `as_of.block`; capacities and optional signed 24-hour change are
exact shannon strings, while estimated APC is in basis points. It refreshes
independently from every other aggregate.
The snapshot should also gain `fork_watch`. A clear source window has neither
`recent_reorg` nor `deep_fork`; otherwise every fork point and tip must be at or
below `as_of.block`, except that an old/indexed branch tip may be higher. An
active deep fork must match its persisted deep event, while its live-chain tip
and hash must equal `as_of`. This indexed history refreshes independently and
must not change the canonical chain revision or `reorgs` count.
The semantics snapshot should also gain an
`activity_feed` containing at most eight newest-first, anchor-bounded compact
signatures. It is refreshed independently and must not contain participant
addresses or arbitrary protocol metadata.
It should also gain `transaction_horizon`, whose hourly/daily arrays contain at
most 24/14 non-negative counts and which contains no source bucket labels. Its
`as_of` is a compatibility anchor rather than a claim that the independently
cached summary was generated at that exact block. This summary refreshes
independently and must not change canonical chain state.
If ckbadger's network crawler is enabled and has completed a round, the snapshot
should additionally gain `network_atlas`. Its `sample_size` must be at most 64;
country/version bucket totals must each equal that sample size; and no peer ID
or address should appear. With the crawler disabled, `network_atlas` stays
absent while all other configured enrichment capabilities continue normally.
The same crawler also supplies `network_roster`, the atlas's twin and the only
streamed record that names peers: at most 256 entries, each carrying a base58
`node_id` the peer lookup can be keyed by, ordered by that id so one known set
arrives as the same list round after round. `truncated` says the crawler knows
more nodes than the roster names. A roster is published only when its
`crawl_round` advances, and it clears with the crawler.
The snapshot should also gain `galaxy_composition`. With the default 6,000
visible budget and sufficient indexed candidates it contains 1,800 `dao`,
2,400 `typed`, and 1,800 `plain` Cells. Every entry must carry a real outpoint,
node-derived content hash, and matching asset taxonomy. Replacing this record
must not change the canonical cells projection revision or counters.

Each route emits a `{"kind":"heartbeat","revision":N}` frame after roughly
five seconds without a data frame. A heartbeat confirms browser transport
freshness; it does not imply that the CKB node tip advanced.

When `recent_links` is non-empty, each link must include
`endpoint_anchors: [{id, pos_seed, content_hash, resolved}, ...]` in
inputs-then-outputs order. The anchors remain available after the bounded full
Cell records age out. A `resolved: false` anchor was derived from a consumed
outpoint the projection never held, so it names an address but carries no
content and does not appear in `from_ids`.

## Programmatic smoke (no browser)

Boot cknerv pointed at a live node, then poll its HTTP API to confirm the
chain entity advances and cells accumulate. Note the `chain.tip` JSON path
(`tip` is nested under `chain`) and the `snapshot.cells` array path.

```bash
SMOKE_WORKDIR=$(mktemp -d /tmp/cknerv-smoke.XXXXXX)
./target/release/cknerv init -C "$SMOKE_WORKDIR"
# Keep this smoke quick while still exercising target-driven hydration.
sed -i 's/cell_cap = 20000/cell_cap = 100/' "$SMOKE_WORKDIR/cknerv.toml"
./target/release/cknerv run -C "$SMOKE_WORKDIR" \
  --rpc http://localhost:8114 --no-open --port 17001 \
  > /tmp/cknerv_smoke.log 2>&1 &
CKNERV_PID=$!
STATE_FILE="$SMOKE_WORKDIR/data/cknerv-state.json"
for _ in $(seq 1 60); do
  test -s "$STATE_FILE" && break
  sleep 1
done
test -s "$STATE_FILE"

# 1. Chain entity reflects the real chain. tip is nested under .chain
TIP1=$(curl -s http://localhost:17001/api/entities/chain/snapshot \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['chain']['tip'])")
echo "tip after 5s: $TIP1"

# Cross-check: cknerv's tip should equal the node's get_tip_block_number
NODE_TIP=$(curl -s -X POST -H "content-type: application/json" \
  --data '{"jsonrpc":"2.0","method":"get_tip_block_number","params":[],"id":1}' \
  http://localhost:8114 | python3 -c "import sys,json; print(int(json.load(sys.stdin)['result'],16))")
echo "node tip: $NODE_TIP  (should be ≈ $TIP1; cknerv may trail by a block or two — async ingest)"

# 2. Wait for the chain to advance (devnet ~5s/block; testnet/mainnet ~10s)
sleep 30
TIP2=$(curl -s http://localhost:17001/api/entities/chain/snapshot \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['chain']['tip'])")
echo "tip after 35s: $TIP2"
# Assert: TIP2 > TIP1 (chain advanced) — unless the chain itself is idle

# 3. Cells accumulated. The cell set is snapshot.cells (an array)
CELLS=$(curl -s http://localhost:17001/api/projections/cells/snapshot \
  | python3 -c "import sys,json; print(sum(c['death_at_ms'] is None for c in json.load(sys.stdin)['snapshot']['cells']))")
echo "live cells observed: $CELLS  (target: 100, or fewer only if genesis was reached)"

kill -INT $CKNERV_PID
wait $CKNERV_PID

# 4. Graceful shutdown persisted a valid derived-state file.
test -s "$STATE_FILE"
SAVED_TIP=$(python3 -c \
  "import json,sys; print(json.load(open(sys.argv[1]))['entities']['chain']['tip'])" \
  "$STATE_FILE")
HYDRATED_TARGET=$(python3 -c \
  "import json,sys; print(json.load(open(sys.argv[1]))['projections']['cells']['hydrated_cell_target'])" \
  "$STATE_FILE")
echo "persisted tip: $SAVED_TIP"
echo "persisted Cell target: $HYDRATED_TARGET  (must be 100)"

# 5. Restart from the same workdir and confirm resume, not boot backfill.
./target/release/cknerv run -C "$SMOKE_WORKDIR" \
  --rpc http://localhost:8114 --no-open --port 17001 \
  > /tmp/cknerv_smoke_resume.log 2>&1 &
CKNERV_PID=$!
sleep 5
grep -F "restored state found (tip $SAVED_TIP)" /tmp/cknerv_smoke_resume.log
RESUMED_TIP=$(curl -s http://localhost:17001/api/entities/chain/snapshot \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['chain']['tip'])")
echo "tip after resume: $RESUMED_TIP  (must be >= persisted tip)"

kill -INT $CKNERV_PID
wait $CKNERV_PID
```

Pass criteria:

- chain snapshot returns a `chain.tip` matching the node's `get_tip_block_number`
  (cknerv may trail by a block or two — it ingests blocks asynchronously)
- tip advances over the observation window (if the chain is producing blocks)
- cells projection reaches the configured 100-live-Cell target, unless the
  reverse scan reached genesis with fewer globally available Cells
- persisted `projections.cells.hydrated_cell_target` is `100`
- after boot replay completes, `data/cknerv-state.json` exists before shutdown
- no panics in cknerv's stdout (`grep -iE "panic|error|fatal" /tmp/cknerv_smoke.log`)
- clean SIGINT shutdown persists a non-empty state file, exits, frees the port,
  and leaves no orphan process
- restart logs the restored tip, skips boot backfill, and serves a tip greater
  than or equal to the persisted tip

## Visual checklist (browser)

Open `http://localhost:7001` (or whatever `--port` you used):

- [ ] Topology renders within ~5s of opening
- [ ] The chain panel shows tip > 0, epoch, mempool stats
- [ ] The CELL MESH panel shows a cell count
- [ ] Cells appear in the galaxy as the chain advances
- [ ] Clicking a cell selects it (selection ring appears)
- [ ] No errors in browser DevTools console
- [ ] Tip advances steadily (watch the chain panel's tip readout)
- [ ] After ~30 min: chain entity tip matches `curl get_tip_block_number`
- [ ] No transport warning banner remains after both streams connect
- [ ] On an idle chain, transport remains nominal for more than 15 seconds
- [ ] DevTools Network → WS shows both streams receiving a heartbeat about
      every five seconds when there are no data frames
- [ ] Stop cknerv while leaving the page open: transport becomes
      `DATA RETRYING`, then `DATA STALE` / `DATA FROZEN` after about 15 seconds
- [ ] Restart cknerv on the same port: both streams reconnect and return to
      `DATA LIVE` without reloading the page
- [ ] CKB node sync/IBD state remains visually separate from transport health

With a local ckbadger service configured:

- [ ] The top strip shows `CKBADGER` with ready/syncing/stale state and lag
- [ ] Once ready, the semantics snapshot gains `asset_ecosystem` with exact
      shannon capacities, byte knowledge size, and basis-point shares
- [ ] The semantics snapshot gains `dao_state` with a statistics block no
      newer than its validated anchor, exact shannon values, and basis-point APC
- [ ] The semantics snapshot gains `fork_watch`; any recent/deep event is
      canonical-tip anchored, and a clear recent window replaces an older event
- [ ] The semantics snapshot gains an `activity_feed` of at most eight
      newest-first entries whose blocks do not exceed its validated anchor
- [ ] The semantics snapshot gains anchored `transaction_horizon` with at most
      24 hourly / 14 daily count buckets and no localized source labels
- [ ] With ckbadger's crawler enabled, the semantics snapshot gains a
      `network_atlas` whose sample is at most 64 and contains no peer identities
- [ ] It also gains a `network_roster` of at most 256 entries at the atlas's
      round, every `node_id` base58 and the list ordered by it; a refresh at the
      same `crawl_round` publishes no second roster delta
- [ ] The semantics snapshot gains an anchored `script_registry` naming only the
      identities the cells projection's census reports, with `unresolved`
      counting the rest; `STAGE SAMPLE` then spells its lock/asset bars with
      those names instead of the four pinned families
- [ ] With the crawler disabled, `network_atlas` and `network_roster` both
      remain absent while source health, Cell detail, ecosystem, DAO, and
      activity enrichment still work
- [ ] The semantics snapshot gains an anchored `galaxy_composition`; at the
      default visible budget its DAO:typed:plain lengths are 1800:2400:1800
- [ ] The resting Cell points and passive fibres use that composition, while a
      new block still advances `last_pulse_at_ms`, emits its network pulse, and
      produces live nerve routes over canonical Cells; newest link endpoints
      remain visible inside their class quotas
- [ ] Delaying or failing one aggregate endpoint leaves the source probe and
      other due aggregate refreshes responsive; no capability overlaps its own
      in-flight request
- [ ] `COMMON KNOWLEDGE BASE` shows `INDEXED NERVOS DAO` with its statistics
      block, anchor, fixed DAO totals, APC, and available 24-hour deltas
- [ ] `COMMON KNOWLEDGE BASE` keeps only the canonical `Reorgs` count;
      `fork_watch` remains available through semantics without changing it
- [ ] `COMMON KNOWLEDGE BASE` shows a separately labeled
      `INDEXED ACTIVITY · LATEST N` fingerprint and recent activity rows
- [ ] At 768px viewport height, the activity fingerprint remains but its rows
      fold away, and the transaction horizon folds into a header-only
      `TX HORIZON · H…/D…` section; `COMMON KNOWLEDGE BASE` does not overlap
      `PULSE`
- [ ] `CELL MESH` replaces its retained-capacity detail with a labeled
      `INDEXED CHAIN CAPACITY` bar and bounded top-asset list, without showing
      duplicate capacity views
- [ ] `PEER MESH` appends known nodes, median RTT, and sample-size-labeled
      country/version strips as plain rows of the panel — no `NETWORK ATLAS`
      heading, provenance on hover — while retaining direct peer count and head
      consensus and adding no crawler scene objects
- [ ] A same-height block hash mismatch shows `INCOMPATIBLE`; chain/cells keep moving
- [ ] A same-height replacement that occurs after an enrichment payload is
      fetched is rejected by the final anchor check and never appears in the
      semantics snapshot
- [ ] Clicking a Cell lazily adds address, script names, occupied-byte
      composition, and available DAO/code-cell/data facets
- [ ] The selected Cell gains one CAP/LOCK/TYPE/DATA composition orbit; it is
      absent before semantics resolve and visibly dimmer while ckbadger is stale
- [ ] Selecting a deterministically decoded UDT Cell shows its token
      name/symbol/amount and adds the outer asset notch without scanning other Cells
- [ ] Stopping ckbadger changes only the optional source state; the galaxy,
      chain stream, cells stream, and required bootstrap remain operational
- [ ] Removing `[ckbadger]` restores the original HUD with no source chip or
      indexed-context/ecosystem/fork-watch/DAO/activity/transaction-horizon/
      network-atlas section
      and requires no purge

## Canonical correction checklist (disposable devnet or mock only)

Do not manufacture a reorg against a public or valued node. Use a disposable
devnet or deterministic mock source that can replace a known suffix.

For a shallow reorg within the 48-block exact rollback window:

- [ ] The chain stream emits `chain_reorganized` before replacement
      `block_mined` mutations
- [ ] The cells stream emits `link_prune` before rollback `death`, `birth`,
      `gc`, or `stats` deltas
- [ ] The HUD enters the reorg presentation and the reorg counter increments
- [ ] Invalidated real Cell witnesses briefly fracture inward
- [ ] Only replacement-chain `birth` deltas produce Cell re-entry
- [ ] Orphaned causal links, selections, and queued pulses do not return
- [ ] After replay, both transport channels return to `DATA LIVE`

For a correction deeper than the retained canonical-anchor window:

- [ ] The chain stream emits `chain_rebuild`
- [ ] The cells stream emits `link_prune` from block `0`, followed by reset
      deltas and a replay envelope with `phase: "rebuild"`
- [ ] The rebuild HUD clears when replay completes
- [ ] Cell totals and links describe only the rebuilt observation window

## Target chains

| Chain | RPC | Notes |
|---|---|---|
| Local devnet | http://localhost:8114 | Fastest; ~5s/block if miner running |
| Pudge testnet | (your pudge node) | Real tx traffic; ~10s/block |
| Mainnet | (your mainnet node) | Real production traffic |

## Persistence scope

- Derived state is persisted on any graceful stop — SIGINT (Ctrl-C) or the
  SIGTERM a service manager sends — and restored on the next boot. Abrupt
  termination, including SIGKILL, is not a persistence boundary.
- Corrupt or schema-mismatched state is discarded and rebuilt from the
  configured node. For an intentional incompatible schema change, run
  `cknerv purge --confirm` as documented in the repository README.

## Observed run (2026-05-27)

Programmatic smoke executed against the user's live local CKB node
(`http://localhost:8114`, a mainnet/testnet-cadence node, ~12s/block) using
a non-default port to avoid collisions:

```bash
./target/release/cknerv run --no-open --port 17031 > /tmp/cknerv_smoke.log 2>&1 &
```

Live node was reachable and actively producing blocks throughout. cknerv
connected read-only (the node was never touched). Observed timeline:

| Checkpoint | cknerv `chain.tip` | node `get_tip_block_number` | revision | total_blocks | total_txs | cells (alive) | total_births | total_deaths |
|---|---|---|---|---|---|---|---|---|
| boot + ~6s | 19431432 | 19431432 (exact match) | 5 | 1 | 1 | 1 | 1 | 0 |
| + ~60s | 19431437 | 19431437 (exact match) | 31 | 6 | 12 | 20 | 20 | 0 |
| + ~120s | 19431450 | 19431452 (trails by 2 blocks) | 87 | 19 | 35 | 48 | 58 | 10 |

Findings:

- **Tip advanced** steadily over the ~2-minute window
  (19431432 → 19431437 → 19431450), ~5 blocks per 60s — consistent with a
  ~12s block interval. No stall.
- **cknerv mirrored the node tip accurately.** At the first two checkpoints
  cknerv's `chain.tip` exactly equalled the node's `get_tip_block_number`.
  At the third it trailed by 2 blocks — expected, since the SPA-server
  ingests blocks asynchronously and the cross-check RPC was issued a beat
  after cknerv's snapshot was read. cknerv catches up; it does not drift.
- **Cells accumulated** with real birth/death dynamics: 1 → 20 → 48 alive,
  with cumulative `total_births` 1 → 20 → 58 and `total_deaths` 0 → 0 → 10.
  The death counter advancing confirms the projection is observing inputs
  consumed by landed txs, not just appending new outputs.
- **0 reorgs** observed; epoch held at number 14268 throughout.
- **No panics, errors, or warnings.** Full stdout/stderr log over the run
  contained only the two startup INFO lines plus the shutdown line — a
  `grep -iE "panic|error|fatal|warn"` matched nothing.
- **Clean SIGINT shutdown.** `kill -INT` produced
  `cknerv::server: Ctrl-C received, shutting down...` in the log; the
  process exited, port 17031 was released, and no orphan `cknerv` process
  remained (`pgrep -f target/release/cknerv` → empty).

Result: PASS. cknerv faithfully mirrors a live, advancing CKB chain
(tip + epoch + mempool + cell birth/death) and shuts down cleanly.
