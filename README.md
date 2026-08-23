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
./target/release/cknerv purge -C myviz --confirm
```

`-C/--workdir <PATH>` selects the work directory. It contains:

- `cknerv.toml`: local config.
- `data/`: derived dashboard state, including `cknerv-state.json`.

Config priority is **CLI args > `cknerv.toml` > built-in defaults**. Historical
hydration targets the built-in live-cell reservoir (50,000 — not a config
knob; the renderer caps there, so a larger reservoir would be wasted and a
smaller one only degrades); the `--backfill-blocks` flag is an optional
one-run hard scan limit and is intentionally not persisted in
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
`cknerv` binary via `crates/cknerv-cli/build.rs`, which reruns the pnpm build
whenever `ui-app/`, `packages/{ui,cache,types}/src`, or `pnpm-lock.yaml`
changes — otherwise a TS-only edit would leave a stale bundle inside the
binary.

For `cargo check` / clippy / rust-analyzer cycles, where that pnpm build is
pure latency, `CKNERV_SKIP_UI_BUILD=1` reuses whatever `ui-app/dist` is already
on disk (it refuses to skip if there is none, and prints a cargo warning each
time it fires). Never set it when producing a release binary.

```bash
CKNERV_SKIP_UI_BUILD=1 cargo clippy --workspace --all-targets
```

The normative Canvas visual, quality, performance, and acceptance contract is
documented in [`docs/canvas-rendering.md`](docs/canvas-rendering.md).

### Optional Jukebox

The dashboard includes an optional four-track SoundCloud Jukebox labeled
`Vocal A`, `Vocal B`, `Piano A`, and `Piano B` for versions of
`TSUBASA WO KUDASAI` and `Komm, süsser Tod`, collapsed into a small floating
`SND·06` chip in the bottom-right corner: an equalizer mark, a `BGM` label, and
the panels' own corner brackets. The closed chip never names a track. Until the
Jukebox has been opened once its equalizer idles slowly and ticks with each
arriving block; opening it retires the motion for the rest of the page's life,
as does `prefers-reduced-motion`.
SoundCloud is not contacted
and no audio is loaded during dashboard startup. Clicking the chip replaces it
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
chip. The feature requires internet access, keeps playback independent of chain
events and visual timing — the closed chip's idle equalizer tick is the one
chain-driven detail, and it stops once the Jukebox has been opened — and is
subject to SoundCloud's terms and regional availability.

## Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| CLI | Rust, clap, rust-embed | Workdir commands, config merge, embedded dashboard server |
| Server | Rust, axum, tokio | HTTP/WS API, mutation reducer, projection registry, persistence |
| CKB adapter | Rust, reqwest, CKB JSON-RPC types | Read-only node polling, boot backfill, block/tx normalization |
| Optional enrichment | Rust, reqwest | Canonically anchored indexed context from ckbadger; see [`docs/ckbadger.md`](docs/ckbadger.md) |
| Types/cache | TypeScript, Vitest | Wire-type twins, pure reducers, WebSocket clients |
| UI | React 18, Vite, React Three Fiber, drei, three.js | 3D cell galaxy, HUDs, Cell-tethered detail constellations, nerve overlays |

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
  CellGalaxy composition additionally uses ckbadger only to discover/rank
  outpoints, then batch-validates and materializes every displayed candidate
  through the local CKB node's read-only `get_live_cell` RPC — full
  compositions and incremental top-ups alike. That validated input is
  display-plane input, not semantics: it enters the server's own canonical
  stream as a server-internal mutation the browser never sees, so display
  membership stays ordered against the births and reorgs it is staged
  against. The cells projection also publishes the script identities it is
  currently holding through a shared sink, and names for them return on the
  semantics stream; ckbadger still cannot write anything that projection
  reads.

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
the current schema, delete it with `cknerv purge --confirm` and let cknerv
rehydrate from the live node.

## HTTP / WS API

The CLI serves the API and embedded SPA on one localhost port. Non-API paths
fall back to the SPA.

| Method | Path | Shape |
|---|---|---|
| `GET` | `/api/health` | `{ build_version, uptime_s, degraded, revision, tip, tip_age_ms, reducer_alive, adapters, projections, quarantined_projections, enrichment }` |
| `GET` | `/api/entities/chain/snapshot` | `{ revision, chain, chain_nodes }` |
| `WS` | `/api/entities/chain/stream?since=<rev>` | snapshot, delta, lagged, or heartbeat frames |
| `GET` | `/api/projections/cells/snapshot` | `{ revision, snapshot }` where `snapshot.cells` is the staged set, not the whole retained galaxy |
| `GET` | `/api/projections/cells/snapshot.bin` | Columnar little-endian snapshot (~9x smaller); revision patched into the header and mirrored in `x-snapshot-revision` |
| `WS` | `/api/projections/cells/stream?since=<rev>` | snapshot, delta, lagged, or heartbeat frames |
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
in [`docs/ckbadger.md`](docs/ckbadger.md), including their independent revision,
canonical-anchor checks, refresh intervals, UI behavior, and failure isolation.
One of its records, `script_registry`, names the identities that census counts;
the browser joins the two planes on `(code_hash, hash_type)`.

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
recent_links_cap = 2048

[galaxy.topology]
neighbor_k = 4
max_edge_length = 28.0
max_hops = 40

[galaxy.pulses]
link_ring_capacity = 128
max_pulses_per_link = 6
max_origins_per_link = 2
max_active_pulses = 256
```

The generated ckbadger block is fully commented out, so a new work directory
keeps the direct CKB-only behavior. Setup and endpoint details live in
[`docs/ckbadger.md`](docs/ckbadger.md).

Profile defaults are resolved in `crates/cknerv-cli/src/config.rs`. Every
profile retains the built-in 50,000-Cell live reservoir (the renderer's
ceiling — not a knob). At an empty boot, the adapter anchors the current tip,
scans canonical blocks in reverse until it has identified that many outputs
still live at the anchor (or reaches genesis), then replays the cached window
once in ascending order.
`mainnet` also uses sparser topology and lower pulse caps to reduce visual
noise. Backfill is deliberately absent from `cknerv.toml`; legacy `[backfill]`
sections are ignored. Use `--backfill-blocks N` only as a one-run hard scan
limit for diagnostics.

The dashboard's manual Cell-count controller tops out at the built-in
50,000-Cell visual ceiling. AUTO renders the server-shipped display budget —
a fixed 12,000-Cell structural budget, with render quality adjusting
presentation only (DPR, effects, sampling), never composition — and the
passive nervous system draws a fixed 8,000-nerve screen budget regardless of
field size. The manual controller is a presentation clamp on that stage.
The manual controller keeps its full range but cannot display records the
server did not retain. A checkpoint recorded against a smaller historical
hydration target is invalidated automatically, so the next launch rebuilds
the full reservoir once. Legacy fixed-window checkpoints are treated the
same way. No manual purge is needed.

The top bar keeps a `PANELS` menu immediately after the build version. It
independently controls `CKB·01`, `ECG·04`, `CELL MESH`, and `PEER MESH`, plus
the optional `DAO·05` panel when validated DAO data is available, while
transport, source-health, warning, and replay status remain visible. At widths
of 1,280 pixels or less the bar becomes two rows: identity and status stay in
the first row, while runtime controls occupy a horizontally scrollable second
row. The left HUD uses one bounded layout: CKB and DAO form a top row, with DAO
immediately to the right of CKB, while `ECG·04` is always anchored at the
bottom-left. The upper panels scroll within the remaining height, so they
cannot overlap the pulse panel.

`recent_links_cap` retains authoritative causal evidence for inspection and
memory recall. `pulses.link_ring_capacity` bounds only newly-arrived animation
events; snapshot history is never replayed as live traffic.

The exact reorg journal is independently bounded to 48 blocks. Deeper changes
trigger a controlled target-driven rebuild. A one-run `--backfill-blocks 0`
keeps legacy tip-only historical replay behavior; cknerv still retains the
exact rollback journal. Ordinary downtime catch-up always processes every
missing block so spends and births in the middle of the gap cannot be lost.

## Persistence

When boot replay completes, and again on any graceful stop — SIGINT (Ctrl-C)
or the SIGTERM `systemctl stop` and `docker stop` send — `cknerv-server`
persists the chain entity and registered projections to:

```text
<workdir>/data/cknerv-state.json
```

On the next boot, the CLI first peeks at the saved tip and completed Cell target.
It restores the file only when that target satisfies the built-in reservoir
target; otherwise it starts a fresh hydration and replaces the checkpoint when
that replay completes. A valid restored tip skips historical hydration, and the
normal forward poll processes the complete downtime gap.

Persistence is best-effort: unreadable, corrupt, or schema-mismatched state is
discarded and the server starts empty. `cknerv purge --confirm` deletes derived
`data/` state while preserving `cknerv.toml`.

Persistence schema v5 adds canonical per-component Cell morphology seeds and
the complete output-data byte length. Existing schema-v4 state is incompatible;
run `cknerv purge --confirm` before the first v5 launch, then let cknerv rebuild
the derived state from the configured node.

Optional semantics are intentionally not persisted. They are bounded in memory
and rehydrated from the configured source, so changing optional enrichment does
not change the persistence schema or require `cknerv purge`.

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
  deep enough to fill the 50,000-Cell reservoir (or all the way to genesis); a
  complete global
  live set beyond that cap would require an indexer. `--backfill-blocks` can
  impose a smaller diagnostic hard limit. After a deep-reorg rebuild, Cell
  TOTAL/DEAD counters are likewise reconstructed from the hydrated observation
  window.
- Which Cells are on stage is decided server-side in every mode and streamed as
  the cells projection's display membership, so the browser runs one code path
  whatever the source situation. Without enrichment the server stages the
  newest live Cells and keeps sliding with the chain tip; with optional
  ckbadger enrichment it holds a 1,200-Cell tip window of the newest births
  beside a 10,800-Cell curated field staged at DAO:typed:plain = 20:70:10,
  seeded in one pass from a node-revalidated reservoir composed at that same
  field size (canonical retained Cells fill any remainder). The
  composition is held by demand rather than by a timer: the plane publishes what
  it is short of per class, spends of staged Cells are detected exactly, and
  bounded top-ups walk deeper into each class and enter by a one-way ratchet, so
  the steady-state cost is proportional to churn. In both modes each block's
  real transaction endpoints take a reserved slice of the stage. A snapshot
  ships that stage and nothing else, so the galaxy-wide numbers the panels show
  come from the aggregate statistics segment instead of from the rows that
  arrived. Canonical Cells and the complete canonical neighbour graph still own
  new-block pulses, live nerve routes, counters, and reorg behavior. See
  [`docs/ckbadger.md`](docs/ckbadger.md#cellgalaxy-composition).
- The CKB adapter is read-only JSON-RPC polling. There is no bundled CKB node,
  indexer, or transaction submitter.

ckbadger-specific capability limits are documented in
[`docs/ckbadger.md`](docs/ckbadger.md#known-limits).

## License

GPL-3.0. See [`LICENSE`](LICENSE).
