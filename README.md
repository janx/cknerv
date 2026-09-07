# cknerv

cknerv is a local-first CKB visualization. It gives the blocks, transactions,
cells, and peers of CKB — an
[eternal digital realm](https://github.com/janx/ckbadger/blob/main/docs/prompts/WORLD_VIEW.md)
sustained by continuous work — a visible body.

What it draws is a dual structure. One layer lives in the digital world: the
consensus nerve network woven from Common Knowledge Cells, the hub where
activity is coordinated. The other lives in the physical world: the
peer-to-peer network of the CKB nodes that carry it. The two are inseparable —
two faces of one body, each wearing a different form in its own world.

cknerv reads from two sources. A CKB node on its own drives the basic view. The
full dashboard also needs ckbadger, which supplies the richer statistics and
queries the panels are built on. Both are meant to run on your own machine.

## Principles

- **CKB Native**: make CKB's cell model visible. Chain data is the source of
  truth; the visualization is a derived view over real blocks, transactions,
  and outpoints.
- **Local First**: the useful default is a local CKB node plus a local
  dashboard, and the full version only adds a local ckbadger beside them.
- **Agent Friendly**: wire shapes, routes, fixtures, and tests are kept
  explicit so humans and agents can safely extend the system together.

## Quick Start

Prerequisites:

- Rust stable with `rustfmt` and `clippy` (`rust-toolchain.toml` pins stable).
- pnpm 9 (`package.json` declares `packageManager: pnpm@9.0.0`).
- A CKB node with JSON-RPC enabled, defaulting to `http://localhost:8114`.
- For the full dashboard, a local ckbadger service; see
  [`docs/ckbadger.md`](docs/ckbadger.md).

```bash
pnpm install --frozen-lockfile
cargo build --release -p cknerv-cli

# Scaffold a work directory. This writes cknerv.toml and creates data/.
./target/release/cknerv init -C mynerv

# Run the embedded dashboard from that work directory.
./target/release/cknerv run -C mynerv

# Bare `cknerv` defaults to `run` in the current directory.
./target/release/cknerv
```

Useful run options:

```bash
./target/release/cknerv run --rpc http://localhost:8114 --port 7001
./target/release/cknerv run --no-open
./target/release/cknerv run --backfill-blocks 5000
./target/release/cknerv purge -C mynerv --confirm
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

## Documentation

- [`docs/development.md`](docs/development.md): running the stack from a
  checkout, the build and test gate, the tech stack, the architecture in
  outline, what each crate and package owns, persistence behavior, and the
  known limits.
- [`docs/architecture.md`](docs/architecture.md): the normative design
  contract — domain model, server runtime, protocol, browser data layer,
  budgets, and extension guide.
- [`docs/api.md`](docs/api.md): the HTTP and WebSocket routes, the frames the
  streams carry, and the reorg, rebuild, and replay behavior a client has to
  handle.
- [`docs/configuration.md`](docs/configuration.md): the generated
  `cknerv.toml`, how each value resolves, and which budgets are fixed rather
  than configurable.
- [`docs/canvas-rendering.md`](docs/canvas-rendering.md): the normative Canvas
  visual, quality, performance, and acceptance contract.
- [`docs/ckbadger.md`](docs/ckbadger.md): the optional enrichment source — its
  setup, trust boundary, capabilities, and limits.
- [`docs/jukebox.md`](docs/jukebox.md): the dashboard's optional SoundCloud
  Jukebox, the floating `SND·06` chip in the bottom-right corner.

## Work Directory Structure

`cknerv init -C <workdir>` creates the local runtime workspace:

```text
<workdir>/
├── cknerv.toml                     # Sole local config file
└── data/
    ├── cknerv-state.json           # Derived chain/projection state, written on clean shutdown
    └── galaxy-composition.json     # With ckbadger only: the curated stage, remembered across runs
```

Both files hold derived data. If either is stale, corrupt, or no longer
matches the current schema, delete it with `cknerv purge --confirm` and let
cknerv rehydrate from the live node.

## License

GPL-3.0. See [`LICENSE`](LICENSE).

The HUD fonts bundled under `packages/ui/src/fonts/` are separately
licensed — six faces under the SIL Open Font License 1.1, plus one
public-domain face. Their notices and the full license text are in
[`THIRD_PARTY_LICENSES.md`](THIRD_PARTY_LICENSES.md).
