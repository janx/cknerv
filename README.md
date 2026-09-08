# cknerv

cknerv is a local-first CKB visualization. It gives the blocks, transactions,
cells, and peers of CKB — an [eternal digital realm](https://github.com/janx/ckbadger/blob/main/docs/prompts/WORLD_VIEW.md) sustained by continuous work — a visible body.

What it draws is a dual structure. One layer lives in the digital world: the
living "world brain" woven from common knowledge cells and links, the hub where activity is coordinated. The other lives in the physical world: the peer-to-peer network of the distributed CKB full nodes that carry it. The two are inseparable — two faces of one body, each wearing a different form in its own world.

cknerv reads from two sources. A CKB node on its own drives the basic view. The full visualization also needs ckbadger, which supplies the richer statistics and queries the panels are built on. Both are meant to run on the same machine with cknerv side by side. That machine can also serve remote viewers: set `[dashboard].hosted` to a service name and publish the dashboard through a same-machine HTTPS reverse proxy. See [hosted dashboards](docs/configuration.md#hosted-dashboards).

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

`cknerv init -C <workdir>` creates `cknerv.toml` and `data/`. Running cknerv
adds the derived state files:

```text
<workdir>/
├── cknerv.toml                     # Sole local config file
└── data/
    ├── cknerv-state.json           # Derived chain/projection checkpoint
    └── galaxy-composition.json     # With ckbadger only: the curated stage, remembered across runs
```

`cknerv-state.json` is written when boot replay completes and on graceful
shutdown (SIGINT or SIGTERM). Unreadable, corrupt, or older-schema state is
rebuilt automatically on the next launch. To force a fresh hydration, stop
cknerv and run `cknerv purge -C <workdir> --confirm`; this clears all derived
`data/` contents while preserving `cknerv.toml`. See
[persistence and local state](docs/development.md#persistence-and-local-state)
for restore eligibility and the current limitations on backups when running
an older binary.

## Considering

Things considered and not built. Each is listed with the question it still
has to answer rather than as a plan; nothing here is promised, and the order
is not a ranking.

- **Fiber channels**: ckbadger already indexes every Fiber channel with its
  funding outpoint, participants, state, and timeline, and a channel opening
  or closing already counts as a PROTOCOL event in the ACTIVITY rows. The
  channel itself is not drawn. Its funding Cell is a real outpoint the node
  can re-affirm, so it could stand in the world brain like any other Cell;
  but the payments that cross it never touch the chain, and its two ends are
  addresses, which the peer mesh cannot place. What a channel looks like in a
  body drawn from chain data, and whether a local Fiber node's own view of
  the channel graph earns a place as a third local source, are the open
  questions. Even the channel-wide counts wait on a bounded endpoint; see
  [`docs/ckbadger.md`](docs/ckbadger.md#known-limits).
- **The mempool as a place**: cknerv polls the node's transaction pool, and
  CKB·01 prints two counts, pending and proposed. What waits there is the one
  thing the node knows that is not yet common knowledge: transitions the
  chain has not confirmed and may never. CKB commits in two steps — a
  transaction is proposed in one block and committed in a later one — so a
  waiting transaction has a real intermediate state of its own. Where those
  stand, Cells not yet born drawn as something less than a Cell, and how one
  is un-drawn when the pool lets it go, are open.
- **RGB++ and the Bitcoin end of the wormhole**: the world view calls RGB++ a
  wormhole between Bitcoin and CKB. An RGB++ Cell's lock names a Bitcoin
  UTXO, and ckbadger recognizes those locks; cknerv draws such a Cell like any
  other. Bitcoin has no presence in cknerv, and cknerv has no Bitcoin node to
  check an anchor against, so drawing the far end would break the rule that
  the stage shows only what the local node has affirmed. Whether the binding
  becomes a mark on the Cell, a second physical-world layer beside the peer
  mesh, or stays unmarked is undecided.
- **Issuance and the treasury**: this README opens by calling CKB a realm
  sustained by continuous work. The product of that work is CKByte, minted
  every block by primary and secondary issuance and divided between block
  producers, Nervos DAO depositors, and — until the community treasury
  exists — the burn. DAO·05 shows the depositors' side. Nothing shows the
  energy input itself: how much matter an epoch mints and where it goes.
  Whether that is a readout on CKB·01 or a visible flow, matter entering the
  body at the producers and settling into the DAO, is undecided.
- **The whole live set**: the galaxy stages a bounded sample of the newest
  and the curated, and the panels count the rest from aggregate statistics.
  Mainnet's live set is far larger than anything the stage holds, and beyond
  those numbers it has no presence. Whether there is a level of detail at
  which the whole set can be seen — a density the eye reads as a population,
  without pretending each grain is a Cell the node has affirmed — is open.
- **An address lens**: today the only way into a Cell is to click it. The
  world view puts all of an owner's activities and assets under its address,
  and ckbadger already answers for one — its Cells, assets, activities, and
  Fiber channels. A lens that takes an address, lock hash, outpoint, or
  transaction hash and lights what it owns across the galaxy is the obvious
  way in, with one honesty problem: the galaxy stages a sample, so most of
  what an address owns is not on stage, and the lens has to say what it
  cannot show.
- **Time**: everything drawn is the present plus a short journal of recent
  blocks. The epochs the world view calls the realm's clock — constant in
  real-world time however the blocks inside them pace — are two readouts on
  CKB·01, and the branches NC-Max absorbed as uncles are not shown at all.
  Walking backward, to an earlier block or through a whole epoch, is cheap
  inside the journal and a different thing past it: the chain's history is in
  the index, but the galaxy's is not, and the stage would have to be
  recomposed for a moment the node no longer holds as live.
- **A light client as the node**: Local First assumes a full node. CKB's
  light client syncs headers and only the Cells of the scripts it is told to
  watch, and it is the practical choice for anyone not keeping a full node.
  A cknerv over one would see the whole arrow of time and only the part of
  the world brain it was pointed at, a body honest about being partially
  sighted. Whether the adapter boundary can carry that — a chain with every
  block and a galaxy with only some of its Cells — is the question.

## License

GPL-3.0. See [`LICENSE`](LICENSE).

The HUD fonts bundled under `packages/ui/src/fonts/` are separately
licensed — six faces under the SIL Open Font License 1.1, plus one
public-domain face. Their notices and the full license text are in
[`THIRD_PARTY_LICENSES.md`](THIRD_PARTY_LICENSES.md).
