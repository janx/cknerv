# cknerv

cknerv is a local-first CKB visualization "weather station". It connects to a
read-only CKB JSON-RPC node, reduces chain activity into chain-generic
mutations, and renders the live chain as a 3D cell galaxy: every UTXO is a
cell, every block is a pulse, and every transaction is a causal nerve path
through the field.

The project was extracted from `ckb-rcg/simulator/` so the same React Three
Fiber visualization can be driven by different data sources: the standalone
`cknerv` CLI uses a direct CKB JSON-RPC adapter, while the simulator can feed
the same server/UI pipeline through its own adapter.

**Status:** v0.1. The standalone CLI boots against a local CKB node, polls
read-only JSON-RPC methods, serves an embedded dashboard SPA, streams live
HTTP/WS snapshots and deltas, and checkpoints derived state after target-driven
Cell hydration and on clean shutdown so the next run resumes from the saved tip
and recent canonical hash anchors instead of replaying the same history.
See [`crates/cknerv-cli/SMOKE.md`](crates/cknerv-cli/SMOKE.md) for the manual
smoke procedure and an observed live-node run.

## Principles

- **CKB Native**: make CKB's cell model visible. Chain data is the source of
  truth; the galaxy is a derived view over real blocks, transactions, and
  outpoints.
- **Local First**: the useful default is a local CKB node plus a local
  dashboard. No hosted service, indexer dependency, or RPC middleware is
  required for the current live visualization.
- **Chain Generic**: adapters are replaceable. The server and UI consume
  `Mutation`s and projections, not source-specific APIs.
- **Agent Friendly**: wire shapes, routes, fixtures, and tests are kept explicit
  so humans and agents can safely extend the system together.

## Quick Start

Prerequisites:

- Rust stable with `rustfmt` and `clippy` (`rust-toolchain.toml` pins stable).
- pnpm 9 (`package.json` declares `packageManager: pnpm@9.0.0`).
- A CKB node with JSON-RPC enabled, defaulting to `http://localhost:8114`.

```bash
pnpm install --frozen-lockfile
cargo build --release -p cknerv-cli

# Scaffold a work directory. This writes cknerv.toml and creates data/.
./target/release/cknerv init -C myviz

# Run the embedded dashboard from that work directory.
./target/release/cknerv run -C myviz

# Bare `cknerv` defaults to `run` in the current directory.
./target/release/cknerv
```

Useful run options:

```bash
./target/release/cknerv run --rpc http://localhost:8114 --port 7001
./target/release/cknerv run --no-open
./target/release/cknerv run --backfill-blocks 5000
./target/release/cknerv prune -C myviz --confirm
```

`-C/--workdir <PATH>` selects the work directory. It contains:

- `cknerv.toml`: local config.
- `data/`: derived dashboard state, including `cknerv-state.json`.

Config priority is **CLI args > `cknerv.toml` > built-in defaults**. Historical
hydration targets the resolved `galaxy.cell_cap`; the `--backfill-blocks` flag
is an optional one-run hard scan limit and is intentionally not persisted in
`cknerv.toml`. The CKB node is accessed read-only; cknerv polls node state and
never submits transactions.

## Development

Run the Rust server/CLI:

```bash
cargo run -p cknerv-cli -- run --no-open --port 7001
```

Run the Vite app against that server:

```bash
pnpm -F cknerv-ui-app dev
```

The Vite dev server uses port `5181` and proxies `/api` plus WebSocket traffic
to `http://localhost:7001`. Release builds embed `ui-app/dist` into the
`cknerv` binary via `crates/cknerv-cli/build.rs`.

### Optional Jukebox

The dashboard includes an optional four-track SoundCloud Jukebox labeled
`Vocal A`, `Vocal B`, `Piano A`, and `Piano B` for versions of
`TSUBASA WO KUDASAI` and `Komm, süsser Tod`, collapsed into a small floating
button in the bottom-right corner. SoundCloud is not contacted
and no audio is loaded during dashboard startup. Clicking the button replaces it
with SoundCloud's official HTML5 player and requests playback of the selected
track; browser autoplay policy may still require a second tap, especially on
mobile. The Jukebox offers `SINGLE ∞` and `RANDOM ∞` playback modes and
defaults to single-track repeat. Single mode repeats the selected track forever;
random mode chooses a different random track after each song and continues
forever. The Arianne vocal upload fades from `05:55` to `06:00`, then either
returns to the beginning in single mode or advances to a random track; this is
parent-page playback control, so the native SoundCloud timeline still reflects
the source recording's full length. The visible player is scaled and darkened
inside a compact cknerv HUD shell, while its native controls and SoundCloud
attribution remain intact.
Closing the Jukebox removes the player, stops playback, and restores the floating
button. The feature requires internet access, remains independent of chain
events and visual timing, and is subject to SoundCloud's terms and regional
availability.

## Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| CLI | Rust, clap, rust-embed | Workdir commands, config merge, embedded dashboard server |
| Server | Rust, axum, tokio | HTTP/WS API, mutation reducer, projection registry, persistence |
| CKB adapter | Rust, reqwest, CKB JSON-RPC types | Read-only node polling, boot backfill, block/tx normalization |
| Optional enrichment | Rust, reqwest | Canonically anchored indexed context from ckbadger; see [`docs/ckbadger.md`](docs/ckbadger.md) |
| Types/cache | TypeScript, Vitest | Wire-type twins, pure reducers, WebSocket clients |
| UI | React 18, Vite, React Three Fiber, drei, three.js | 3D cell galaxy, HUDs, cell-life detail panels, nerve overlays |

## Architecture

cknerv keeps source-specific chain ingestion separate from the chain-generic
dashboard pipeline. The direct CKB adapter remains the sole producer of
structural chain truth. Optional indexed enrichment is additive and can never
create, spend, or replace a canonical Cell.

```text
CKB node JSON-RPC
      |
      v
CkbDirectAdapter
      |
      v
Mutation stream
      |
      v
cknerv-server
  - Chain entity store
  - projection registry
  - mutation replay ring
  - persistence
      |
      v
HTTP/WS API
      |
      v
@cknerv/cache reducers
      |
      v
@cknerv/ui React + R3F cell galaxy
```

The primary public seams are:

- Data sources implement `cknerv_server::Adapter` and emit
  `cknerv_core::Mutation` values.
- Server projections implement `cknerv_core::Projection` and expose snapshots
  plus deltas through `/api/projections/:name/...`.
- Optional indexed sources implement `cknerv_server::EnrichmentSource`.
  Enrichment-aware projections own an independent revision/ring, while
  canonical reorg/rebuild mutations only invalidate their anchored records.
  Source health probing runs independently from bounded per-capability
  refreshes, and every successful ckbadger result must re-prove its validated
  block/hash anchor immediately before it enters the semantics projection.

The current workspace ships `CkbDirectAdapter`, which polls CKB JSON-RPC and
emits chain-generic mutations. It also includes optional ckbadger enrichment;
its architecture, trust boundary, capabilities, and limits are documented in
[`docs/ckbadger.md`](docs/ckbadger.md).

## Repository Layout

| Path | Purpose |
|---|---|
| `crates/cknerv-core/` | Chain-generic wire types, `Mutation`, `Projection`, `CellGalaxy`, deterministic helix positioning, and bounded replay ring. |
| `crates/cknerv-server/` | axum HTTP/WS server, `Adapter` trait, `ServerBuilder`, entity store, projection registry, replay streams, and persistence. |
| `crates/cknerv-adapter-ckb/` | `CkbDirectAdapter`: read-only CKB JSON-RPC polling, boot backfill, block/tx normalization, content hash parity. |
| `crates/cknerv-adapter-ckbadger/` | Optional read-only indexed enrichment adapter; see [`docs/ckbadger.md`](docs/ckbadger.md). |
| `crates/cknerv-cli/` | `cknerv` binary, clap CLI, config/workdir commands, embedded SPA serving, runtime config injection, browser auto-open. |
| `packages/types/` | `@cknerv/types`: TypeScript twins of the Rust wire shapes. |
| `packages/cache/` | `@cknerv/cache`: pure reducers plus entity/projection WebSocket clients. |
| `packages/ui/` | `@cknerv/ui`: React + R3F primitives, HUDs, materials, geometry, cell-life detail views, and nerve overlays. |
| `ui-app/` | Default SPA assembled from `@cknerv/ui`; embedded by the CLI release build. |
| `tests/fixtures/` | Cross-language fixtures for Rust <-> TypeScript wire-shape and helix parity tests. |

## Work Directory Structure

`cknerv init -C <workdir>` creates the local runtime workspace:

```text
<workdir>/
├── cknerv.toml              # Sole local config file
└── data/
    └── cknerv-state.json    # Derived chain/projection state, written on clean shutdown
```

The state file is derived data. If it is stale, corrupt, or no longer matches
the current schema, delete it with `cknerv prune --confirm` and let cknerv
rehydrate from the live node.

## HTTP / WS API

The CLI serves the API and embedded SPA on one localhost port. Non-API paths
fall back to the SPA.

| Method | Path | Shape |
|---|---|---|
| `GET` | `/api/entities/chain/snapshot` | `{ revision, chain, chain_nodes }` |
| `WS` | `/api/entities/chain/stream?since=<rev>` | snapshot, delta, lagged, or heartbeat frames |
| `GET` | `/api/projections/cells/snapshot` | `{ revision, snapshot }` where `snapshot.cells` is the live cell set |
| `WS` | `/api/projections/cells/stream?since=<rev>` | snapshot, delta, lagged, or heartbeat frames |
| `GET` | `/api/projections/semantics/snapshot` | Optional indexed-enrichment snapshot; present even when disabled |
| `WS` | `/api/projections/semantics/stream?since=<rev>` | Independent optional semantics snapshot/delta stream |
| `GET` | `/api/enrichment/cells/:tx_hash/:output_index` | Lazily resolve one selected Cell; `404 enrichment_disabled` when absent |
| `GET` | `/api/enrichment/transactions/:tx_hash` | Lazily resolve one origin transaction |

The projection route name for the cell galaxy is literally `cells`
(`CellGalaxy::name()`).

The optional `semantics` projection and lazy enrichment routes are documented
in [`docs/ckbadger.md`](docs/ckbadger.md), including their independent revision,
canonical-anchor checks, refresh intervals, UI behavior, and failure isolation.

Both WebSocket routes emit
`{"kind":"heartbeat","revision":<last-confirmed-revision>}` every five seconds
when no data frame is needed. `@cknerv/cache` reports each transport as
connecting, live, retrying, resyncing, or stale; the default dashboard treats
15 seconds without a valid data/heartbeat frame as stale. This browser
freshness state is displayed separately from CKB IBD/tip sync, so a quiet chain
cannot look disconnected and a frozen dashboard cannot look nominal.

Each entry in `snapshot.recent_links` keeps `from_ids` / `to_ids` for causal
ordering plus compact `endpoint_anchors` containing each endpoint's `id`,
`pos_seed`, and `content_hash`. These immutable anchors preserve the observed
transaction's spatial and content evidence after a bounded full Cell record is
garbage-collected; they do not preserve the complete Cell payload.

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

## Configuration

`cknerv init` writes a commented `cknerv.toml` template:

```toml
[ckb]
rpc_url = "http://localhost:8114"

# Optional indexed semantics; disabled in the generated file.
# See docs/ckbadger.md before enabling.
# [ckbadger]
# api_url = "http://127.0.0.1:8101/api/v1"
# max_lag_blocks = 12

[dashboard]
port = 7001
open = true

[galaxy]
profile = "auto" # auto, devnet, testnet, mainnet, custom
cell_cap = 20000
recent_links_cap = 2048

[galaxy.topology]
neighbor_k = 4
max_edge_length = 28.0
max_hops = 40

[galaxy.pulses]
link_ring_capacity = 128
max_pulses_per_link = 6
max_sources_per_parent = 2
max_active_pulses = 256
```

The generated ckbadger block is fully commented out, so a new work directory
keeps the direct CKB-only behavior. Setup and endpoint details live in
[`docs/ckbadger.md`](docs/ckbadger.md).

Profile defaults are resolved in `crates/cknerv-cli/src/config.rs`. `devnet`
targets 2,000 retained live Cells; the other profiles target 20,000. At an
empty boot, the adapter anchors the current tip, scans canonical blocks in
reverse until it has identified that many outputs still live at the anchor (or
reaches genesis), then replays the cached window once in ascending order.
`mainnet` also uses sparser topology and lower pulse caps to reduce visual
noise. Backfill is deliberately absent from `cknerv.toml`; legacy `[backfill]`
sections are ignored. Use `--backfill-blocks N` only as a one-run hard scan
limit for diagnostics.

The dashboard's manual Cell-count controller tops out at the built-in
20,000-Cell visual ceiling. AUTO keeps a stable 6,000-Cell structural budget
(or the complete field when `cell_cap` is smaller); adaptive quality changes
DPR and transient effect sampling without rebuilding Galaxy membership. The
manual controller keeps its full range but cannot display records the server
did not retain. Increasing `cell_cap` invalidates a checkpoint whose recorded
hydration target is too small, so the next launch automatically rebuilds the
larger reservoir. Legacy fixed-window checkpoints are treated the same way. No
manual prune is needed.

The top bar keeps a `PANELS` visibility toggle immediately after the build
version. It hides or restores the four main HUD panels while leaving transport,
source-health, warning, and replay status visible. At widths of 1,280 pixels or
less the bar becomes two rows: identity and status stay in the first row, while
runtime controls occupy a horizontally scrollable second row. The left HUD uses
one bounded vertical rail; `PULSE` stays pinned at its bottom and the CKB readout
scrolls only when its fused capacity, DAO, horizon, and activity sections exceed
the remaining height, so the panels cannot overlap.

`recent_links_cap` retains authoritative causal evidence for inspection and
memory recall. `pulses.link_ring_capacity` bounds only newly-arrived animation
events; snapshot history is never replayed as live traffic.

The exact reorg journal is independently bounded to 48 blocks. Deeper changes
trigger a controlled target-driven rebuild. A one-run `--backfill-blocks 0`
keeps legacy tip-only historical replay behavior; cknerv still retains the
exact rollback journal. Ordinary downtime catch-up always processes every
missing block so spends and births in the middle of the gap cannot be lost.

## Persistence

When boot replay completes, and again on Ctrl-C/SIGINT, `cknerv-server`
persists the chain entity and registered projections to:

```text
<workdir>/data/cknerv-state.json
```

On the next boot, the CLI first peeks at the saved tip and completed Cell target.
It restores the file only when that target satisfies the current `cell_cap`;
otherwise it starts a fresh adaptive hydration and replaces the checkpoint when
that replay completes. A valid restored tip skips historical hydration, and the
normal forward poll processes the complete downtime gap.

Persistence is best-effort: unreadable, corrupt, or schema-mismatched state is
discarded and the server starts empty. `cknerv prune --confirm` deletes derived
`data/` state while preserving `cknerv.toml`.

Persistence schema v3 adds durable Cell-link endpoint anchors. Existing
schema-v2 state is incompatible; run `cknerv prune --confirm` before the first
v3 launch, then let cknerv rebuild the derived state from the configured node.

Optional semantics are intentionally not persisted. They are bounded in memory
and rehydrated from the configured source, so changing optional enrichment does
not change the persistence schema or require `cknerv prune`.

## Build and Test

```bash
pnpm install --frozen-lockfile

cargo fmt --all -- --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --all

pnpm test
pnpm typecheck

cargo build --release -p cknerv-cli
```

Cross-language contracts are covered by paired Rust and TypeScript tests that
read shared fixtures under `tests/fixtures/`. When a wire shape, mutation,
snapshot, or deterministic helix output changes, update the Rust type, the TS
twin, the fixtures, and both sides of the tests together.

## Known Limits

- The cell galaxy tracks a bounded reservoir of the newest observed live Cells,
  not the full global live-cell set. Startup scans a recent canonical suffix
  deep enough to fill `cell_cap` (or all the way to genesis); a complete global
  live set beyond that cap would require an indexer. `--backfill-blocks` can
  impose a smaller diagnostic hard limit. After a deep-reorg rebuild, Cell
  TOTAL/DEAD counters are likewise reconstructed from the hydrated observation
  window.
- The CKB adapter is read-only JSON-RPC polling. There is no bundled CKB node,
  indexer, or transaction submitter.

ckbadger-specific capability limits are documented in
[`docs/ckbadger.md`](docs/ckbadger.md#known-limits).

## License

GPL-3.0. See [`LICENSE`](LICENSE).
