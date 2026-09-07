# Development

Running cknerv from a checkout, what it is built from, how the pieces fit,
what each crate and package owns, what it leaves on disk, and what it does not
try to be. The normative design contract is
[Design and Architecture](architecture.md); this is the working orientation
beside it.

## Running from a Checkout

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
documented in [Canvas Design and Rendering Architecture](canvas-rendering.md).

The dashboard's optional SoundCloud Jukebox — the floating `SND·06` chip in
the bottom-right corner — is documented in [Jukebox](jukebox.md).

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

## Architecture in Outline

The full design contract — domain model, server runtime, protocol, browser
data layer, budgets, and extension guide — is
[Design and Architecture](architecture.md). In outline:

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
- Optional indexed sources implement `cknerv_server::EnrichmentSource` and
  travel a second, additive pipeline: their projection owns an independent
  revision and ring, every record has to re-prove its canonical block/hash
  anchor immediately before it commits, and a display candidate is only ever
  a suggestion the local node revalidates through `get_live_cell` before it
  reaches the stage. The discipline is
  [Design and Architecture §9](architecture.md#9-optional-enrichment-architecture);
  the source itself is [ckbadger.md](ckbadger.md).

The current workspace ships one adapter, `CkbDirectAdapter`, which polls CKB
JSON-RPC and emits chain-generic mutations, plus that optional ckbadger
enrichment beside it.

## Tech Stack

| Layer | Built with | Where |
|---|---|---|
| Domain core | Rust, serde | `crates/cknerv-core/` |
| Server | Rust, axum, tokio | `crates/cknerv-server/` |
| CKB adapter | Rust, reqwest, CKB JSON-RPC types | `crates/cknerv-adapter-ckb/` |
| Optional enrichment | Rust, reqwest | `crates/cknerv-adapter-ckbadger/` |
| CLI | Rust, clap, rust-embed | `crates/cknerv-cli/` |
| Types and cache | TypeScript, Vitest | `packages/types/`, `packages/cache/` |
| UI | React 18, Vite, React Three Fiber, drei, three.js | `packages/ui/`, `ui-app/` |

What each of them owns is the [Repository Layout](#repository-layout) table
below.

## Repository Layout

| Path | Owns |
|---|---|
| `crates/cknerv-core/` | Chain-generic wire types, `Mutation`, `Projection`, `CellGalaxy`, deterministic helix positioning, and bounded replay ring. |
| `crates/cknerv-server/` | axum HTTP/WS server, `Adapter` trait, `ServerBuilder`, entity store, projection registry, replay streams, and persistence. |
| `crates/cknerv-adapter-ckb/` | `CkbDirectAdapter`: read-only CKB JSON-RPC polling, boot backfill, block/tx normalization, content hash parity. |
| `crates/cknerv-adapter-ckbadger/` | Optional read-only indexed enrichment adapter; see [ckbadger.md](ckbadger.md). |
| `crates/cknerv-cli/` | `cknerv` binary, clap CLI, config/workdir commands, embedded SPA serving, runtime config injection, browser auto-open. |
| `packages/types/` | `@cknerv/types`: TypeScript twins of the Rust wire shapes. |
| `packages/cache/` | `@cknerv/cache`: pure reducers plus entity/projection WebSocket clients. |
| `packages/ui/` | `@cknerv/ui`: React + R3F primitives, HUDs, materials, geometry, cell-life detail views, and nerve overlays. |
| `ui-app/` | Default SPA assembled from `@cknerv/ui`; embedded by the CLI release build. |
| `tests/fixtures/` | Cross-language fixtures for Rust <-> TypeScript wire-shape and helix parity tests. |

The dependency direction, including what each directory must *not* own, is
[Design and Architecture §3](architecture.md#3-repository-layers-and-dependency-direction).

## Persistence and Local State

Operationally: what cknerv writes into the work directory, when it trusts what
it finds there, and how to throw it away. The full contract — file format,
what is deliberately ephemeral, restore eligibility — is
[Design and Architecture §12](architecture.md#12-persistence-and-recovery).

When boot replay completes, and again on any graceful stop — SIGINT (Ctrl-C)
or the SIGTERM `systemctl stop` and `docker stop` send — `cknerv-server`
persists the chain entity and registered projections to:

```text
<workdir>/data/cknerv-state.json
```

On the next boot, the CLI first peeks at the saved tip and completed Cell
target. It restores the file only when that target satisfies the built-in
reservoir target; otherwise it starts a fresh hydration and replaces the
checkpoint when that replay completes. A valid restored tip skips historical
hydration, and the normal forward poll processes the complete downtime gap.

Persistence is best-effort: unreadable, corrupt, or older-schema state is
discarded and the server starts empty. State written by a *newer* schema than
the running build is the one thing that is never deleted — it is renamed beside
itself as `cknerv-state.json.schema<N>.bak`, where `N` is the schema that wrote
it, so running an older binary once does not destroy what a newer one saved.
`cknerv purge --confirm` deletes derived `data/` state while preserving
`cknerv.toml`.

The current schema is v5, which added canonical per-component Cell morphology
seeds and the complete output-data byte length. Schema-v4 state is
incompatible: run `cknerv purge --confirm` before the first v5 launch, then let
cknerv rebuild the derived state from the configured node.

Optional semantics are intentionally not persisted. They are bounded in memory
and rehydrated from the configured source, so changing optional enrichment does
not change the persistence schema or require `cknerv purge`.

The curated stage is the one exception, and it keeps its own file. With
ckbadger enabled the server writes the composition it last proved to
`<workdir>/data/galaxy-composition.json`, and a resuming boot feeds those
outpoints back through the same node revalidation a fresh composition goes
through — every one re-read against the node, dead ones dropped — so a warm
boot stages a proven set in seconds instead of curating one from nothing. The
file carries its own schema version: an older one is discarded, while one
written by a *newer* build is renamed beside itself as
`galaxy-composition.json.schema<N>.bak` rather than deleted, the same way
`cknerv-state.json` is. The trust boundary does not move either way: nothing
reaches the stage that the node has not just re-affirmed. A boot that rebuilds
canonical state rebuilds the stage with it.

## Known Limits

- The cell galaxy tracks a bounded reservoir of the newest observed live Cells,
  not the full global live-cell set. Startup scans a recent canonical suffix
  deep enough to fill the 50,000-Cell reservoir (or all the way to genesis); a
  complete live set beyond that cap would require an indexer.
  `--backfill-blocks` can impose a smaller diagnostic hard limit. After a
  deep-reorg rebuild, Cell TOTAL/DEAD counters are likewise reconstructed from
  the hydrated observation window.
- Which Cells are on stage is decided server-side in every mode and streamed
  as the cells projection's display membership, so the browser runs one code
  path whatever the source situation:
  - Without enrichment the server stages the newest live Cells and keeps
    sliding with the chain tip.
  - With ckbadger enrichment it holds a 1,200-Cell tip window of the newest
    births beside a 10,800-Cell curated field staged at
    DAO:typed:plain = 20:70:10, seeded in one pass from a node-revalidated
    reservoir composed at that same field size, with canonical retained Cells
    filling any remainder. The composition is then held by demand rather than
    by a timer — the plane publishes what it is short of per class, spends of
    staged Cells are detected exactly, and bounded top-ups walk deeper into
    each class and enter by a one-way ratchet — so the steady-state cost is
    proportional to churn.
  - In both modes each block's real transaction endpoints take a reserved
    slice of the stage, and canonical Cells and the complete canonical
    neighbour graph still own new-block pulses, live nerve routes, counters,
    and reorg behavior.

  A snapshot ships that stage and nothing else, so the galaxy-wide numbers the
  panels show come from the aggregate statistics segment rather than from the
  rows that arrived. See
  [Design and Architecture §6.4](architecture.md#64-display-plane) and
  [ckbadger.md](ckbadger.md#cellgalaxy-composition).
- The CKB adapter is read-only JSON-RPC polling. There is no bundled CKB node,
  indexer, or transaction submitter.

ckbadger-specific capability limits are documented in
[ckbadger.md](ckbadger.md#known-limits), and the structural tradeoffs behind
these — bounded windows, purge-over-migrate, the loopback-only boundary — are
[Design and Architecture §19](architecture.md#19-known-tradeoffs-and-limits).
