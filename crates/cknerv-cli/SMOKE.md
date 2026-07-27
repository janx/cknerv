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
The cell set lives under `snapshot.cells`; cumulative counters are
`snapshot.total_births` / `snapshot.total_deaths`:

```json
{
  "revision": 87,
  "snapshot": {
    "cells": [ { "id": 0, "born_at_ms": 0, "death_at_ms": null, "birth_block": 19431432, "tag": null, "out_point": { "...": "..." }, "capacity": 0, "data_hex": "0x", "content_hash": "0x…" } ],
    "total_births": 58,
    "total_deaths": 10,
    "last_pulse_at_ms": 0,
    "recent_links": []
  }
}
```

(The projection name in the route path is literally `cells` — it is
`CellGalaxy::name()`.)

The corresponding WebSocket routes are:

- `/api/entities/chain/stream?since=<revision>`
- `/api/projections/cells/stream?since=<revision>`

Each route emits a `{"kind":"heartbeat","revision":N}` frame after roughly
five seconds without a data frame. A heartbeat confirms browser transport
freshness; it does not imply that the CKB node tip advanced.

When `recent_links` is non-empty, each link must include
`endpoint_anchors: [{id, pos_seed, content_hash}, ...]` in
`from_ids`-then-`to_ids` order. The anchors remain available after the bounded
full Cell records age out.

## Programmatic smoke (no browser)

Boot cknerv pointed at a live node, then poll its HTTP API to confirm the
chain entity advances and cells accumulate. Note the `chain.tip` JSON path
(`tip` is nested under `chain`) and the `snapshot.cells` array path.

```bash
SMOKE_WORKDIR=$(mktemp -d /tmp/cknerv-smoke.XXXXXX)
./target/release/cknerv init -C "$SMOKE_WORKDIR"
./target/release/cknerv run -C "$SMOKE_WORKDIR" \
  --rpc http://localhost:8114 --no-open --port 17001 \
  > /tmp/cknerv_smoke.log 2>&1 &
CKNERV_PID=$!
sleep 5

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
  | python3 -c "import sys,json; print(len(json.load(sys.stdin)['snapshot']['cells']))")
echo "cells observed: $CELLS"

kill -INT $CKNERV_PID
wait $CKNERV_PID

# 4. Graceful shutdown persisted a valid derived-state file.
STATE_FILE="$SMOKE_WORKDIR/data/cknerv-state.json"
test -s "$STATE_FILE"
SAVED_TIP=$(python3 -c \
  "import json,sys; print(json.load(open(sys.argv[1]))['entities']['chain']['tip'])" \
  "$STATE_FILE")
echo "persisted tip: $SAVED_TIP"

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
- cells projection returns a non-empty `snapshot.cells` set once the chain
  has tx activity
- no panics in cknerv's stdout (`grep -iE "panic|error|fatal" /tmp/cknerv_smoke.log`)
- clean SIGINT shutdown persists a non-empty state file, exits, frees the port,
  and leaves no orphan process
- restart logs the restored tip, skips boot backfill, and serves a tip greater
  than or equal to the persisted tip

## Visual checklist (browser)

Open `http://localhost:7001` (or whatever `--port` you used):

- [ ] Topology renders within ~5s of opening
- [ ] CkbNetworkHud shows tip > 0, epoch, mempool stats
- [ ] CellsHud shows a cell count
- [ ] Cells appear in the galaxy as the chain advances
- [ ] Clicking a cell selects it (selection ring appears)
- [ ] No errors in browser DevTools console
- [ ] Tip advances steadily (watch CkbNetworkHud's tip readout)
- [ ] After ~30 min: chain entity tip matches `curl get_tip_block_number`
- [ ] Status strip reaches `DATA LIVE`; no transport warning banner remains
- [ ] On an idle chain, `DATA LIVE` remains live for more than 15 seconds
- [ ] DevTools Network → WS shows both streams receiving a heartbeat about
      every five seconds when there are no data frames
- [ ] Stop cknerv while leaving the page open: transport becomes
      `DATA RETRYING`, then `DATA STALE` / `DATA FROZEN` after about 15 seconds
- [ ] Restart cknerv on the same port: both streams reconnect and return to
      `DATA LIVE` without reloading the page
- [ ] CKB node sync/IBD state remains visually separate from transport health

## Canonical correction checklist (disposable devnet or mock only)

Do not manufacture a reorg against a public or valued node. Use a disposable
devnet or deterministic mock source that can replace a known suffix.

For a shallow reorg within the configured backfill window:

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

- Derived state is persisted on graceful Ctrl-C and restored on the next boot.
  Abrupt termination, including SIGKILL, is not a persistence boundary.
- Corrupt or schema-mismatched state is discarded and rebuilt from the
  configured node. For an intentional incompatible schema change, run
  `cknerv prune --confirm` as documented in the repository README.

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
