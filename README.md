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
HTTP/WS snapshots and deltas, and persists derived state on clean shutdown so
the next run resumes from the saved tip and recent canonical hash anchors
instead of replaying the same backfill.
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

Config priority is **CLI args > `cknerv.toml` > built-in defaults**. The CKB
node is accessed read-only; cknerv polls node state and never submits
transactions.

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

## Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| CLI | Rust, clap, rust-embed | Workdir commands, config merge, embedded dashboard server |
| Server | Rust, axum, tokio | HTTP/WS API, mutation reducer, projection registry, persistence |
| CKB adapter | Rust, reqwest, CKB JSON-RPC types | Read-only node polling, boot backfill, block/tx normalization |
| Types/cache | TypeScript, Vitest | Wire-type twins, pure reducers, WebSocket clients |
| UI | React 18, Vite, React Three Fiber, drei, three.js | 3D cell galaxy, HUDs, cell-life detail panels, nerve overlays |

## Architecture

cknerv keeps source-specific chain ingestion separate from the chain-generic
dashboard pipeline.

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

Two public seams matter most:

- Data sources implement `cknerv_server::Adapter` and emit
  `cknerv_core::Mutation` values.
- Server projections implement `cknerv_core::Projection` and expose snapshots
  plus deltas through `/api/projections/:name/...`.

The current workspace ships `CkbDirectAdapter`, which polls CKB JSON-RPC and
emits chain-generic mutations. A ckbadger adapter is planned but deferred until
its feed schema is available.

## Repository Layout

| Path | Purpose |
|---|---|
| `crates/cknerv-core/` | Chain-generic wire types, `Mutation`, `Projection`, `CellGalaxy`, deterministic helix positioning, and bounded replay ring. |
| `crates/cknerv-server/` | axum HTTP/WS server, `Adapter` trait, `ServerBuilder`, entity store, projection registry, replay streams, and persistence. |
| `crates/cknerv-adapter-ckb/` | `CkbDirectAdapter`: read-only CKB JSON-RPC polling, boot backfill, block/tx normalization, content hash parity. |
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

The projection route name for the cell galaxy is literally `cells`
(`CellGalaxy::name()`).

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

Canonical anchors and the Cell birth/death undo journals are bounded by the
configured `[backfill].blocks` horizon (plus one parent anchor needed to prove
the rollback boundary). If no common ancestor survives inside that window, the
adapter emits `{"type":"chain_rebuild","from_block":N}`. Chain rings are
cleared, the Cell projection emits `link_prune` from block `0` plus GC/stats
reset deltas, and blocks `N..=tip` are replayed in a progress envelope. This
avoids both unbounded journals and silently retaining an unprovable orphan
state. Cell IDs remain monotonic across the rebuild so queued visual work
cannot alias newly replayed Cells.

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

[dashboard]
port = 7001
open = true

[backfill]
blocks = 2000

[galaxy]
profile = "auto" # auto, devnet, testnet, mainnet, custom
cell_cap = 5000
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

Profile defaults are resolved in `crates/cknerv-cli/src/config.rs`. `devnet`
uses a smaller cell cap and shorter default backfill; `mainnet` uses sparser
topology and lower pulse caps to reduce visual noise; `auto`, `testnet`, and
`custom` start from balanced defaults.

`recent_links_cap` retains authoritative causal evidence for inspection and
memory recall. `pulses.link_ring_capacity` bounds only newly-arrived animation
events; snapshot history is never replayed as live traffic.

`backfill.blocks` also sets the exact reorg rollback and controlled-rebuild
horizon. Setting it to `0` keeps legacy tip-only historical replay behavior;
cknerv still retains a minimal two-block live rollback journal.

## Persistence

On Ctrl-C/SIGINT, the CLI asks `cknerv-server` to persist the chain entity and
registered projections to:

```text
<workdir>/data/cknerv-state.json
```

On the next boot, the server hydrates that file before adapters start. The CKB
adapter peeks the restored tip, skips boot backfill when a valid persisted tip
exists, and lets the normal forward poll catch up any downtime gap.

Persistence is best-effort: unreadable, corrupt, or schema-mismatched state is
discarded and the server starts empty. `cknerv prune --confirm` deletes derived
`data/` state while preserving `cknerv.toml`.

Persistence schema v3 adds durable Cell-link endpoint anchors. Existing
schema-v2 state is incompatible; run `cknerv prune --confirm` before the first
v3 launch, then let cknerv rebuild the derived state from the configured node.

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

- The cell galaxy tracks a bounded recent live-cell projection, not the full
  global live-cell set. The boot backfill depth is controlled by
  `--backfill-blocks` or `[backfill].blocks`; a full live set would require an
  indexer. After a deep-reorg rebuild, Cell TOTAL/DEAD counters are likewise
  reconstructed from that bounded observation window.
- The CKB adapter is read-only JSON-RPC polling. There is no bundled CKB node,
  indexer, or transaction submitter.
- The ckbadger adapter is deferred until ckbadger publishes a stable feed
  schema.

## License

GPL-3.0. See [`LICENSE`](LICENSE).
