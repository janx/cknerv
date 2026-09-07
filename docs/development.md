# Development

Running cknerv from a checkout, what it is built from, how the pieces fit, and
what each crate and package owns. The normative design contract is
[Design and Architecture](architecture.md); this document is the working
orientation beside it.

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

The full gate — formatting, clippy, both test suites, and the release build —
is in the [Build and Test](../README.md#build-and-test) section of the README.

The normative Canvas visual, quality, performance, and acceptance contract is
documented in [Canvas Design and Rendering Architecture](canvas-rendering.md).

The dashboard's optional SoundCloud Jukebox — the floating `SND·06` chip in
the bottom-right corner — is documented in [Jukebox](jukebox.md).

## Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| CLI | Rust, clap, rust-embed | Workdir commands, config merge, embedded dashboard server |
| Server | Rust, axum, tokio | HTTP/WS API, mutation reducer, projection registry, persistence |
| CKB adapter | Rust, reqwest, CKB JSON-RPC types | Read-only node polling, boot backfill, block/tx normalization |
| Optional enrichment | Rust, reqwest | Canonically anchored indexed context from ckbadger; see [ckbadger.md](ckbadger.md) |
| Types/cache | TypeScript, Vitest | Wire-type twins, pure reducers, WebSocket clients |
| UI | React 18, Vite, React Three Fiber, drei, three.js | 3D cell galaxy, HUDs, Cell-tethered detail constellations, nerve overlays |

## Architecture

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
[ckbadger.md](ckbadger.md).

## Repository Layout

| Path | Purpose |
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

The layer-by-layer dependency direction, including what each directory must
*not* own, is [Design and Architecture §3](architecture.md#3-repository-layers-and-dependency-direction).
