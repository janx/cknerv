# Configuration

What `cknerv init` writes into `cknerv.toml`, how each value is resolved, and
which budgets are fixed rather than configurable. The merge rules are
[Design and Architecture §13.2](architecture.md#132-configuration-merge), and
the work directory those files live in is described in
[the README](../README.md#work-directory-structure).

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
neighbor_k = 5
max_edge_length = 42.0
max_hops = 80

[galaxy.pulses]
link_ring_capacity = 512
max_pulses_per_link = 6
max_origins_per_link = 2
max_active_pulses = 256
```

The generated ckbadger block is fully commented out, so a new work directory
keeps the direct CKB-only behavior. Setup and endpoint details live in
[ckbadger.md](ckbadger.md).

Profile defaults are resolved in `crates/cknerv-cli/src/config.rs`. Every
profile retains the built-in 50,000-Cell live reservoir (the renderer's
ceiling — not a knob). At an empty boot, the adapter anchors the current tip,
scans canonical blocks in reverse until it has identified that many outputs
still live at the anchor (or reaches genesis), then replays the cached window
once in ascending order.

`profile` currently selects no numbers: every profile resolves to the one
value set the SPA's own bundled defaults are pinned to, because a per-profile
delta that trailed a frontend retune twice shipped a galaxy nobody had
visually accepted. The seam is kept for a deliberate divergence, which would
arrive with its own parity fixture. Backfill is deliberately absent from
`cknerv.toml`; legacy `[backfill]` sections are ignored. Use
`--backfill-blocks N` only as a one-run hard scan limit for diagnostics.

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
transport, source-health, warning, and replay status remain visible. The bar
folds to two rows when its one-row layout would not fit the viewport. That is
a measurement, not a screen size: the HUD renders a hidden copy of the row at
its natural width and folds when the room runs out, so an 11-inch iPad in
landscape keeps one row and a 10.2-inch one folds, and on today's content the
fold lands at about 1,100 pixels. Folded, identity and status stay in the
first row, while runtime controls occupy a horizontally scrollable second
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
