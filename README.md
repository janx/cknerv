# cknerv

Chain-generic visualization for CKB — *the nervous system through which
chain state becomes observable*. A local-first "weather station" that
renders a live CKB chain (mainnet, testnet, or devnet) as a 3D cell
galaxy: every UTXO is a cell, every block a pulse, every transaction a
nerve impulse through the field.

Extracted from `ckb-rcg/simulator/` so the same R3F visualization serves
both the RCG simulator (via the simulator's `SimulatorAdapter`) and any
real CKB node (via this repo's `cknerv` CLI + `CkbDirectAdapter`).

**Status:** v0.1 — working standalone CLI. Boots against a local CKB
node, polls its JSON-RPC, and serves a self-contained dashboard SPA that
streams the chain live as a 3D cell galaxy — cells, block pulses, and
cell→cell nerve pulses, with click-to-inspect cell/node detail panels.
Verified end-to-end against a live mainnet node (see
`crates/cknerv-cli/SMOKE.md`).

## Quick start

```bash
# Build the CLI (build.rs invokes `pnpm -F cknerv-ui-app build` + rust-embeds the SPA)
cargo build --release -p cknerv-cli

# Point it at a local CKB node (auto-detects http://localhost:8114) and
# auto-open the dashboard at http://localhost:7001:
./target/release/cknerv

# Explicit RPC + port, no auto-open:
./target/release/cknerv --rpc http://localhost:8114 --port 7001 --no-open
```

Flags: `--rpc <URL>` (default `http://localhost:8114`), `--port <N>`
(default `7001`), `--no-open`, `--workdir <PATH>` (default `~/.cknerv`).
`Ctrl-C` shuts down cleanly. cknerv only issues **read** RPCs
(`get_tip_block_number`, `get_block_by_number`, `get_blockchain_info`,
`tx_pool_info`, `local_node_info`) — it never writes to or controls the
node.

## Architecture

A data **Adapter** pushes chain-generic `Mutation`s into `cknerv-server`'s
pipeline; the server reduces them into a `Chain` entity + a `CellGalaxy`
projection and streams snapshots/deltas over HTTP/WS to the SPA. The SPA
renders the same R3F primitives regardless of where the mutations came
from.

```
data source ──▶ Adapter ──▶ cknerv-server ──▶ HTTP/WS ──▶ @cknerv/ui SPA
   (CKB node)   (CkbDirect)   (Chain entity +              (cell galaxy,
                              CellGalaxy projection)        chain HUD, …)
```

Two `Adapter` implementations exist today, proving the source-agnostic
design:
- **`CkbDirectAdapter`** (this repo) — polls a CKB node's JSON-RPC.
- **`SimulatorAdapter`** (in `ckb-rcg/simulator/`) — wraps the simulator's
  `SimEvent` bus.

Both satisfy the same `cknerv_server::Adapter` trait and drive the same
unchanged server + UI.

## Layout

| Path | What |
|---|---|
| `crates/cknerv-core/` | Chain-generic types, `Mutation` enum, `Projection` trait, `CellGalaxy` projection, `helix_seed` (Rust + TS parity-tested) |
| `crates/cknerv-server/` | axum HTTP/WS server + `Adapter` trait + `ServerBuilder` + entity store + persistence |
| `crates/cknerv-adapter-ckb/` | `CkbDirectAdapter` — CKB JSON-RPC poller |
| `crates/cknerv-adapter-ckbadger/` | *(deferred — gated on ckbadger publishing its WS feed schema; not yet a workspace member)* |
| `crates/cknerv-cli/` | The `cknerv` binary: clap CLI + rust-embedded SPA + browser auto-open |
| `packages/types/` | `@cknerv/types` — TS mirror of `cknerv-core` wire types |
| `packages/cache/` | `@cknerv/cache` — WS client (entity/projection streams) + reducers |
| `packages/ui/` | `@cknerv/ui` — React + R3F primitives (CellGalaxy, CellLifeDetail3D, HUDs, materials, geometry, GoL cell-life) |
| `ui-app/` | The CLI's default SPA — minimal single-page assembly of `@cknerv/ui` primitives, built by `cknerv-cli`'s build.rs |
| `tests/fixtures/` | Cross-language JSON fixtures (helix_seed, mutation samples, snapshots) — pin Rust ↔ TS wire parity |

## Build + Test

```bash
cargo test --all                 # Rust workspace (cknerv-core + cknerv-server + cknerv-adapter-ckb)
pnpm install                     # link workspace packages
pnpm test                        # TS workspace (@cknerv/{types,cache,ui})
pnpm typecheck                   # tsc --noEmit across packages
cargo build --release -p cknerv-cli   # full build incl. SPA embed
```

Cross-language parity (`helix_seed`, wire shapes) is enforced by
`crates/cknerv-core/tests/{helix_parity,wire_shape}.rs` (Rust) +
`packages/{types,ui}/__tests__/*` (TS), both reading the shared
`tests/fixtures/`.

## HTTP / WS API (served by cknerv-server)

| Method | Path | Returns |
|---|---|---|
| GET | `/api/entities/chain/snapshot` | `{revision, chain, chain_nodes}` — Chain entity (tip, epoch, mempool, recent blocks/tx) + registered nodes |
| WS  | `/api/entities/chain/stream?since=<rev>` | snapshot/delta/lagged frames |
| GET | `/api/projections/cells/snapshot` | `{revision, snapshot}` — cell galaxy field |
| WS  | `/api/projections/cells/stream?since=<rev>` | snapshot/delta/lagged frames |

The `cknerv` CLI mounts these alongside the embedded SPA (served on any
non-API path) on a single port.

## Known limitations (v0.1)

- The 3D cell-life avatar (`CellLifeDetail3D`) is not mounted in `ui-app/`;
  clicking a cell shows the `CellDetailHud` text panel only.
- No persist-on-exit — state rehydrates from the live chain each boot.
- ckbadger adapter deferred until ckbadger publishes its WS feed schema.

## License

GPL-3.0 — see LICENSE.
